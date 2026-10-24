import { ApiPromise, HttpProvider } from '@polkadot/api';
import { NETWORK, validateEndpoint, validateRpc } from './config.mjs';
import { validateRecipient, parseAmount, spendable, intentHash } from './core.mjs';

export const KNOWN_EXTENSIONS = new Set(['CheckNonZeroSender','CheckSpecVersion','CheckTxVersion','CheckGenesis','CheckMortality','CheckNonce','CheckWeight','ChargeTransactionPayment','CheckMetadataHash','WeightReclaim']);
export function assertNetwork(genesis, properties) {
  const scalar = v => Array.isArray(v) ? v.length === 1 ? v[0] : undefined : v;
  if (genesis !== NETWORK.genesis || Number(scalar(properties.ss58Format)) !== NETWORK.ss58 || Number(scalar(properties.tokenDecimals)) !== NETWORK.decimals || scalar(properties.tokenSymbol) !== NETWORK.symbol)
    throw Error('Это не проверенная NUMEN Mainnet. Подпись и отправка запрещены.');
}
export class Chain {
  constructor(endpoint, transport) { this.endpoint=validateEndpoint(endpoint); this.transport=transport; this.closed=false; this.api=null; }
  async rpc(method,params=[]) {
    if (this.closed) throw Error('Соединение закрыто.');
    validateRpc(method,params);
    // No automatic endpoint fallback or retry of submitted extrinsics.
    return this.transport(this.endpoint,method,params);
  }
  async connect() {
    if (this.api) return this.api;
    const [genesis,properties] = await Promise.all([this.rpc('chain_getBlockHash',[0]),this.rpc('system_properties')]);
    assertNetwork(genesis,properties);
    const provider = new HttpProvider(this.endpoint,{},0,0);
    provider.send = (method,params) => this.rpc(method,params);
    provider.clone = () => { throw Error('Provider clone is disabled.'); };
    const api = new ApiPromise({provider, noInitWarn:true, throwOnConnect:true});
    api.on('error',()=>{});
    try {
      await api.isReadyOrError;
      if (this.closed) throw Error('Соединение закрыто.');
      assertNetwork(api.genesisHash.toHex(),properties);
      this.api=api;return api;
    } catch (e) { await api.disconnect();throw e; }
  }
  async close() { this.closed=true;if(this.api){await this.api.disconnect();this.api=null;} }
  async snapshot(address) {
    validateRecipient(address);
    const api=await this.connect();
    const [hash,finalized,health,runtime]=await Promise.all([this.rpc('chain_getBlockHash'),this.rpc('chain_getFinalizedHead'),this.rpc('system_health'),this.rpc('state_getRuntimeVersion')]);
    if(runtime.specVersion!==api.runtimeVersion.specVersion.toNumber() || runtime.transactionVersion!==api.runtimeVersion.transactionVersion.toNumber())
      throw Error('Runtime обновился. Переподключитесь к RPC перед переводом.');
    const [header,finalHeader,account,nextNonce]=await Promise.all([this.rpc('chain_getHeader',[hash]),this.rpc('chain_getHeader',[finalized]),api.query.system.account.at(hash,address),this.rpc('system_accountNextIndex',[address])]);
    const data=account.data.toJSON(), ed=api.consts.balances.existentialDeposit.toBigInt();
    return {address, hash, height:Number(BigInt(header.number)), finalizedHeight:Number(BigInt(finalHeader.number)),
      free:account.data.free.toString(), reserved:account.data.reserved.toString(), frozen:String(data.frozen??data.miscFrozen??'0'),
      available:spendable(data,ed).toString(), existentialDeposit:ed.toString(), nonce:account.nonce.toString(), nextNonce:BigInt(nextNonce).toString(),
      syncing:health.isSyncing, specVersion:runtime.specVersion, transactionVersion:runtime.transactionVersion, updatedAt:Date.now()};
  }
  options(snapshot) {
    const api=this.api;
    if(api.extrinsicVersion!==4)throw Error('Неподдерживаемая версия транзакции.');
    for(const extension of api.registry.signedExtensions)if(!KNOWN_EXTENSIONS.has(extension))throw Error(`Непроверенное signed extension: ${extension}`);
    return {blockHash:snapshot.hash,genesisHash:NETWORK.genesis,nonce:snapshot.nonce,
      era:api.registry.createType('ExtrinsicEra',{current:snapshot.height,period:64}),runtimeVersion:api.runtimeVersion,
      signedExtensions:api.registry.signedExtensions,tip:0,version:4};
  }
  async prepare(address,recipient,amountText,journal) {
    validateRecipient(recipient);
    if(address===recipient)throw Error('Получатель совпадает с вашим адресом.');
    if(journal.some(x=>x.address===address&&['submitted','unknown'].includes(x.status)))throw Error('Сначала проверьте предыдущую отправку в истории. Повторный перевод заблокирован.');
    const amount=parseAmount(amountText),snapshot=await this.snapshot(address);
    if(snapshot.syncing||snapshot.height-snapshot.finalizedHeight>32)throw Error('Нода синхронизируется или финализация отстаёт. Отправка недоступна.');
    if(snapshot.nonce!==snapshot.nextNonce)throw Error('В сети уже есть ожидающая транзакция этого счёта. Дождитесь включения.');
    const options=this.options(snapshot),tx=this.api.tx.balances.transferKeepAlive(recipient,amount.toString());
    const fake=this.api.tx(tx.toU8a()).signFake(address,options).toU8a();
    const info=await this.api.call.transactionPaymentApi.queryInfo(fake,fake.length);
    const fee=info.partialFee.toBigInt(),feeBudget=fee+(fee/5n>0n?fee/5n:1n);
    if(amount+feeBudget>BigInt(snapshot.available))throw Error('Недостаточно доступного баланса с учётом комиссии, резерва и блокировок.');
    const intent={address,recipient,amount:amount.toString(),fee:fee.toString(),feeBudget:feeBudget.toString(),nonce:snapshot.nonce,hash:snapshot.hash,height:snapshot.height,
      genesis:NETWORK.genesis,endpoint:this.endpoint,specVersion:snapshot.specVersion,transactionVersion:snapshot.transactionVersion,createdAt:Date.now()};
    return {intent,id:intentHash(intent),snapshot,tx,options};
  }
  async signPrepared(prepared,pair) {
    if(prepared.id!==intentHash(prepared.intent)||pair.address!==prepared.intent.address||prepared.intent.endpoint!==this.endpoint)throw Error('Подтверждение перевода не совпадает.');
    if(Date.now()-prepared.intent.createdAt>90000)throw Error('Предпросмотр устарел. Рассчитайте заново.');
    const now=await this.snapshot(pair.address);
    if(now.syncing||now.height-now.finalizedHeight>32||now.nonce!==prepared.intent.nonce||now.nextNonce!==prepared.intent.nonce||now.height>=prepared.intent.height+32||now.specVersion!==prepared.intent.specVersion||now.transactionVersion!==prepared.intent.transactionVersion)
      throw Error('Состояние сети/nonce изменилось. Рассчитайте перевод заново.');
    if(await this.rpc('chain_getBlockHash',[prepared.intent.height])!==prepared.intent.hash)throw Error('Произошла реорганизация. Рассчитайте перевод заново.');
    if(BigInt(prepared.intent.amount)+BigInt(prepared.intent.feeBudget)>BigInt(now.available))throw Error('Баланс изменился.');
    // Check the actual encoded call again rather than trusting mutable UI labels.
    const tx=this.api.tx.balances.transferKeepAlive(prepared.intent.recipient,prepared.intent.amount);
    if(tx.method.toHex()!==prepared.tx.method.toHex())throw Error('Данные перевода изменены.');
    tx.sign(pair,prepared.options);
    const bytes=tx.toU8a(),info=await this.api.call.transactionPaymentApi.queryInfo(bytes,bytes.length);
    if(info.partialFee.toBigInt()>BigInt(prepared.intent.feeBudget))throw Error('Комиссия выросла. Рассчитайте заново.');
    return {hex:tx.toHex(),hash:tx.hash.toHex(),record:{...prepared.intent,id:tx.hash.toHex(),status:'unknown',scanHeight:prepared.intent.height-1,expiry:Number(prepared.options.era.asMortalEra.death(prepared.intent.height))}};
  }
  async broadcast(signed) {
    const hash=await this.rpc('author_submitExtrinsic',[signed.hex]);
    if(hash!==signed.hash)throw Error('RPC вернул другой хеш. Исход отправки неизвестен.');
    return hash;
  }
  async reconcile(entries,address) {
    const api=await this.connect(),head=await this.rpc('chain_getFinalizedHead');
    const finalHeight=Number(BigInt((await this.rpc('chain_getHeader',[head])).number));
    const next=structuredClone(entries);
    for(const entry of next.filter(x=>x.address===address&&['submitted','unknown'].includes(x.status))){
      const stop=Math.min(finalHeight,entry.expiry,entry.scanHeight+12);
      for(let height=entry.scanHeight+1;height<=stop;height++){
        const hash=await this.rpc('chain_getBlockHash',[height]),block=await api.rpc.chain.getBlock(hash);
        const index=block.block.extrinsics.findIndex(tx=>tx.hash.toHex()===entry.id);
        if(index>=0){
          const events=await api.query.system.events.at(hash);
          const relevant=events.filter(e=>e.phase.isApplyExtrinsic&&e.phase.asApplyExtrinsic.toNumber()===index);
          const success=relevant.some(e=>api.events.system.ExtrinsicSuccess.is(e.event));
          const failed=relevant.some(e=>api.events.system.ExtrinsicFailed.is(e.event));
          if(!success&&!failed)throw Error('Не удалось подтвердить результат транзакции.');
          entry.status=success?'finalized':'failed';entry.block=height;entry.extrinsicIndex=index;entry.blockHash=hash;
          break;
        }
        entry.scanHeight=height;
      }
      // Only expire after checking EVERY finalized block in the mortal era. No blind timer.
      if(['submitted','unknown'].includes(entry.status)&&entry.scanHeight>=entry.expiry)entry.status='expired';
    }
    return next;
  }
}
