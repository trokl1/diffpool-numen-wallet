import {NETWORK} from '../config.mjs';
import {POOL_WALLETS,accountHex} from '../transfers.mjs';
export const HASH='0x'+'12'.repeat(32),TIME='2026-10-24T01:00:00.000Z';
export const meta={genesis:[{hash:NETWORK.genesis}],chainInfos:[{symbol:'NUMN',decimals:18,ss58:14240,head:305,finalizedHead:300}],latest:[{height:300,hash:HASH,timestamp:TIME}]};
export function historyFixture({mixed=false}={}){
  const state={calls:[],offline:false};
  async function request(req){
    state.calls.push(req);if(state.offline)throw Error('history offline');
    if(req.operation==='meta')return JSON.stringify({data:meta});
    const {id,anchor,before,cursor}=req.variables,other=accountHex(POOL_WALLETS[id===accountHex(POOL_WALLETS[0].address)?1:0].address);
    let rows=Array.from({length:45},(_,i)=>({id:String(1000-i).padStart(4,'0'),amount:'1000000000000000001',timestamp:TIME,from:{id:other},to:{id},block:{height:299,hash:HASH,finalized:true},extrinsic:{id:'ext1',hash:HASH,indexInBlock:1,fee:'5',tip:'0',signer:{id:other}}}));
    if(mixed)rows=rows.map((r,i)=>i%3===0?r:{...r,from:{id},to:{id:i%3===1?other:id},extrinsic:{...r.extrinsic,signer:{id}}});
    if(req.operation==='incoming')rows=rows.filter(r=>r.to.id===id);
    if(req.operation==='outgoing')rows=rows.filter(r=>r.from.id===id);
    if(req.operation==='rewards')rows=Array.from({length:25},(_,i)=>({id:'block'+(299-i),height:299-i,hash:HASH,timestamp:TIME,finalized:true,reward:'16000000000000000000',minerFees:'5',author:{id}}));
    rows=rows.filter(r=>{const h=r.height??r.block.height;return h<=anchor&&(h<before||(h===before&&r.id<cursor));}).slice(0,21);
    return JSON.stringify({data:{anchorBlock:[{hash:HASH}],rows}});
  }
  return {state,request};
}
