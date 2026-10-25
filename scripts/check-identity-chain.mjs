// Public disposable keys and in-memory submissions only; never sends to mainnet.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture,PUBLIC_SEED} from './qa-fixture.mjs';
import {deriveAccount} from '../core.mjs';
import {Chain} from '../chain.mjs';
import {emptyIdentity,identityDeposit,assertIdentityCall} from '../identity.mjs';
import {submitOnce,readHistory,writeHistory} from '../history.mjs';
import {NETWORK,VERSION} from '../config.mjs';
import {signatureVerify,blake2AsU8a} from '@polkadot/util-crypto';
const f=await fixture(),pair=deriveAccount(PUBLIC_SEED),checks=[];let c;
try{
 let feeQueries=0,expensive=false;
 c=new Chain(NETWORK.rpc,async(endpoint,method,params)=>{
   if(method==='state_call'&&params[0]==='TransactionPaymentApi_query_info'){
     feeQueries++;const tx=f.api.tx(params[1]);
     assert.equal(tx.method.section,'identity');assert.equal(tx.method.method,'setIdentity');
     const anchor=await f.request(endpoint,'chain_getBlockHash',[]);
     const payload=f.api.registry.createType('ExtrinsicPayload',{method:tx.method.toHex(),era:tx.era,nonce:tx.nonce,tip:tx.tip,blockHash:anchor,genesisHash:NETWORK.genesis,specVersion:10000,transactionVersion:1,mode:0,metadataHash:null},{version:4});
     const bytes=payload.toU8a({method:true});assert.equal(signatureVerify(bytes.length>256?blake2AsU8a(bytes):bytes,tx.signature.toU8a(),tx.signer.toString()).isValid,false,'fee RPC must never receive valid signatures');
     if(expensive)return f.api.createType('RuntimeDispatchInfo',{weight:{refTime:1000,proofSize:0},class:'Normal',partialFee:'1000000000000000000'}).toHex();
   }
   return f.request(endpoint,method,params);
 });
 const first=await c.identity(f.alice);assert.equal(first.exists,false);
 const info={...emptyIdentity(),display:'0x1234',bio:'Public test\nsecond line',web:'https://example.com',telegram:'@public_test'};
 const p=await c.prepareIdentity(f.alice,info,first.fingerprint,[]);assertIdentityCall(p.tx,info);
 assert.equal(p.intent.deposit,identityDeposit(info,f.api.consts.identity.basicDeposit.toString(),f.api.consts.identity.byteDeposit.toString()).toString());
 assert.equal(p.intent.depositDelta,p.intent.deposit);checks.push('new profile: exact independent SCALE bytes, 0x text, all fields and byte-priced deposit');
 let signs=0;const sign=pair.sign.bind(pair);pair.sign=(...args)=>{signs++;return sign(...args);};
 let guards=0;await assert.rejects(()=>c.signPrepared(p,pair,()=>{if(++guards===4)throw Error('cancelled');}),/cancelled/);assert.equal(signs,0);
 f.state.identity={...emptyIdentity(),display:'Changed elsewhere'};await assert.rejects(()=>c.signPrepared(p,pair),/Профиль Identity изменился/);assert.equal(signs,0);
 const current=await c.identity(f.alice);assert.equal(current.info.display,'Changed elsewhere');assert.equal(current.exists,true);
 await assert.rejects(()=>c.prepareIdentity(f.alice,current.info,current.fingerprint,[]),/не изменились/);
 await assert.rejects(()=>c.prepareIdentity(f.alice,info,first.fingerprint,[]),/Профиль Identity изменился/);checks.push('current profile decoded; no-op/stale edits rejected; cancellation or changed profile cannot sign');
 const update=await c.prepareIdentity(f.alice,info,current.fingerprint,[]);
 assert.equal(update.intent.depositDelta,(BigInt(update.intent.deposit)-BigInt(current.deposit)).toString());
 expensive=true;await assert.rejects(()=>c.signPrepared(update,pair),/Комиссия выросла/);assert.equal(signs,0);expensive=false;
 const signed=await c.signPrepared(update,pair);assert.equal(signs,1);
 await assert.rejects(()=>submitOnce(c,signed,[],async()=>{throw Error('DISK_FAILED');}),/DISK_FAILED/);assert.equal(f.state.submits.length,0);
 let disk='';const result=await submitOnce({broadcast:async signed=>{assert.ok(disk);return c.broadcast(signed);}},signed,[],async raw=>{disk=raw;});
 assert.equal(result.unknown,false);assert.equal(f.state.submits.length,1);assert.deepEqual(f.state.submits[0].info,info);
 const records=readHistory(disk);assert.equal(records[0].kind,'identity');assert.equal(records[0].amount,'0');assert.deepEqual(records[0].info,info);
 await assert.rejects(()=>c.prepare(f.alice,f.bob,'1',records),/Сначала проверьте/);
 await assert.rejects(()=>c.prepareIdentity(f.alice,info,current.fingerprint,records),/Сначала проверьте/);
 const invalid=structuredClone(records);invalid[0].kind='other';assert.throws(()=>writeHistory(invalid));checks.push('valid mock signature, journal durable before broadcast, Identity is not a payment, common pending nonce gate');
 f.state.identity={...info,bio:'x'.repeat(500)};const larger=await c.identity(f.alice);const reduced=await c.prepareIdentity(f.alice,info,larger.fingerprint,[]);assert.ok(BigInt(reduced.intent.depositDelta)<0n);checks.push('smaller profile shows release of reserved deposit');
 const longInfo={...info,display:'Кошелёк Ёж',bio:'Я'.repeat(1024)},long=await c.prepareIdentity(f.alice,longInfo,larger.fingerprint,[]),longSigned=await c.signPrepared(long,pair);
 await submitOnce(c,longSigned,[],async()=>{});assert.deepEqual(f.state.submits[1].info,longInfo);assert.equal(new TextEncoder().encode(longInfo.bio).length,2048);f.state.identity=longInfo;assert.deepEqual((await c.identity(f.alice)).info,longInfo);assert.ok(feeQueries>5);checks.push('Cyrillic name and maximum 2048-byte Cyrillic bio sign and decode unchanged with hashed payload; fee queries contain no valid signatures; increased fee rejects before signing');
 f.state.identity=null;f.state.free=10n**18n;await assert.rejects(()=>c.prepareIdentity(f.alice,info,first.fingerprint,[]),/Недостаточно баланса/);checks.push('insufficient balance blocks reservation and fee before signing');
 assert.equal(f.state.submits.length,2);
 await mkdir('evidence',{recursive:true});const report={version:VERSION,passed:true,checkedAt:new Date().toISOString(),checks,realBroadcasts:0,mockedBroadcasts:2};await writeFile('evidence/identity-chain.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{pair.lock();await c?.close();await f.close();}
