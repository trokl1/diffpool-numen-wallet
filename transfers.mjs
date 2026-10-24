import {t} from './i18n.mjs';
// Read model only. Never supplies balance, nonce, signing or payout decisions.
import { decodeAddress,encodeAddress } from '@polkadot/util-crypto';
import { NETWORK } from './config.mjs';
import { validateRecipient } from './core.mjs';
export const HISTORY_API='https://graphql.numen-network.org/graphql';
export const PAGE_SIZE=20;
export const HISTORY_TTL_MS=60000;
export function historyStale(page,now=Date.now()){return !page||now-page.updatedAt>=HISTORY_TTL_MS||page.updatedAt>now;}
export const POOL_WALLETS=Object.freeze([
  {name:'FEE DiffPool',address:'nu4dxPMnaPXN4ZRWJaUM6RnSY8zuhi1NrYiR7Nfh42wB9YAxr'},
  {get name(){return t('POOL · награды');},address:'nu327rmGPkjwfAHWQPB8R87bbnDYbzeX5YK1h7QMfGnq9WWpS'},
  {get name(){return t('Личный майнинг');},address:'nu4NMRnsC8dF6tfva2ZsiD4aV83hZDeeAzB16pNJG6YGwzNfj'},
]);
const bad=()=>{throw Error(t('История: некорректный ответ индексатора.'));};
const height=n=>{if(!Number.isInteger(n)||n<0||n>=2147483647)bad();return n;};
const hash=s=>{if(typeof s!=='string'||!/^0x[0-9a-f]{64}$/.test(s))bad();return s;};
const identifier=s=>{if(typeof s!=='string'||!s.length||s.length>100||!/^[a-zA-Z0-9_-]+$/.test(s))bad();return s;};
const amount=s=>{if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(s)||BigInt(s)>=2n**128n)bad();return s;};
const timestamp=s=>{if(typeof s!=='string'||s.length>40||!Number.isFinite(Date.parse(s)))bad();return s;};
const account=s=>encodeAddress(hash(s),NETWORK.ss58);
export function accountHex(address){return '0x'+Array.from(decodeAddress(validateRecipient(address)),n=>n.toString(16).padStart(2,'0')).join('');}
export function decodeHistoryResponse(raw){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>65536)bad();
  const data=JSON.parse(raw);if(data.errors?.length)throw Error(t('Индексатор истории вернул ошибку. Повторите позже.'));
  if(!data.data||typeof data.data!=='object')bad();return data.data;
}
export function validateAnchor(a){
  height(a.height);hash(a.hash);timestamp(a.timestamp);height(a.head);
  if(a.head<a.height)bad();return {height:a.height,hash:a.hash,timestamp:a.timestamp,head:a.head};
}
export function parseMeta(data){
  const info=data.chainInfos?.[0],latest=data.latest?.[0];
  if(data.genesis?.[0]?.hash!==NETWORK.genesis||info?.symbol!==NETWORK.symbol||info?.decimals!==18||info?.ss58!==NETWORK.ss58)
    throw Error(t('История: индексатор другой сети.'));
  if(!latest)throw Error(t('История ещё не проиндексирована.'));
  height(info.finalizedHead);if(latest.height>info.finalizedHead)bad();
  return validateAnchor({...latest,head:info.head});
}
export function pageRequest(address,kind,anchor,cursor=null){
  if(!['transfers','incoming','outgoing','rewards'].includes(kind))bad();validateAnchor(anchor);
  const before=cursor?height(cursor.height):anchor.height+1,id=cursor?identifier(cursor.id):'';
  if(before>anchor.height+1)bad();
  return {operation:kind,variables:{id:accountHex(address),anchor:anchor.height,before,...(kind!=='rewards'?{cursor:id}:{})}};
}
export function parsePage(data,address,kind,anchor,cursor=null,now=Date.now()){
  const request=pageRequest(address,kind,anchor,cursor);
  if(data.anchorBlock?.[0]?.hash!==anchor.hash)throw Error(t('Снимок истории изменился. Обновите с первой страницы.'));
  if(!Array.isArray(data.rows)||data.rows.length>PAGE_SIZE+1)bad();
  let previous=cursor,seen=new Set();
  const rows=data.rows.map(row=>{
    const id=identifier(row.id),block=kind==='rewards'?row:row.block,bh=height(block?.height);
    if(block.finalized!==true||bh>anchor.height||seen.has(id))bad();seen.add(id);
    if(previous&&(bh>previous.height||(bh===previous.height&&(kind==='rewards'||id>=previous.id))))bad();
    if(bh>=request.variables.before&&(!cursor||bh!==cursor.height))bad();previous={height:bh,id};
    const common={id,height:bh,hash:hash(block.hash),timestamp:timestamp(row.timestamp)};
    if(kind==='rewards'){
      if(account(row.author?.id)!==address)bad();
      return {...common,reward:amount(row.reward),minerFees:amount(row.minerFees)};
    }
    const from=account(row.from?.id),to=account(row.to?.id);
    if(from!==address&&to!==address)bad();
    if(kind==='incoming'&&to!==address||kind==='outgoing'&&from!==address)bad();
    const tx=row.extrinsic;
    const extrinsic=tx?{id:identifier(tx.id),hash:hash(tx.hash),index:height(tx.indexInBlock),fee:tx.fee==null?null:amount(tx.fee),tip:tx.tip==null?null:amount(tx.tip),signer:tx.signer?account(tx.signer.id):null}:null;
    return {...common,from,to,amount:amount(row.amount),extrinsic};
  });
  const items=rows.slice(0,PAGE_SIZE),last=items.at(-1);
  return {v:1,genesis:NETWORK.genesis,address,kind,anchor,updatedAt:now,rows:items,next:rows.length>PAGE_SIZE?{height:last.height,id:last.id}:null};
}
export class TransferHistory{
  constructor(transport){this.transport=transport;}
  async meta(){return parseMeta(decodeHistoryResponse(await this.transport({operation:'meta',variables:{}})));}
  async page(address,kind,anchor,cursor=null){return parsePage(decodeHistoryResponse(await this.transport(pageRequest(address,kind,anchor,cursor))),address,kind,anchor,cursor);}
}
// First page only, six recently opened address/tab pairs; no unbounded disk growth.
export function rememberPage(entries,page){return [page,...entries.filter(p=>p.address!==page.address||p.kind!==page.kind)].slice(0,6);}
export function readTransferCache(raw){
  if(!raw)return [];
  if(raw.length>512000)bad();const cache=JSON.parse(raw);
  if(cache.v!==1||!Array.isArray(cache.pages)||cache.pages.length>6)bad();
  return cache.pages.map(p=>{
    if(p.v!==1||p.genesis!==NETWORK.genesis||!Number.isSafeInteger(p.updatedAt)||p.updatedAt<0||!Array.isArray(p.rows)||p.rows.length>PAGE_SIZE)bad();
    validateRecipient(p.address);validateAnchor(p.anchor);pageRequest(p.address,p.kind,p.anchor,p.next);
    // Round-trip cached normalized rows through the same scope/order/value checks.
    const rows=p.rows.map(r=>p.kind==='rewards'?{...r,finalized:true,author:{id:accountHex(p.address)}}:{...r,block:{height:r.height,hash:r.hash,finalized:true},from:{id:accountHex(r.from)},to:{id:accountHex(r.to)},extrinsic:r.extrinsic?{...r.extrinsic,indexInBlock:r.extrinsic.index,signer:r.extrinsic.signer?{id:accountHex(r.extrinsic.signer)}:null}:null});
    const checked=parsePage({anchorBlock:[{hash:p.anchor.hash}],rows},p.address,p.kind,p.anchor,null,p.updatedAt);
    const last=checked.rows.at(-1);if(p.next&&(!last||p.next.height!==last.height||p.next.id!==last.id||p.rows.length!==PAGE_SIZE))bad();
    return {...checked,next:p.next};
  });
}
export function writeTransferCache(pages){const raw=JSON.stringify({v:1,pages});readTransferCache(raw);return raw;}
