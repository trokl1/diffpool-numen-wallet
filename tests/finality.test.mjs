import test from 'node:test';
import assert from 'node:assert/strict';
import { Chain } from '../chain.mjs';
import { NETWORK } from '../config.mjs';
const record={address:'account',status:'submitted',id:'target',height:100,scanHeight:99,expiry:164};
function mock(finalHeight=180,includedHeight=null,outcome='success'){
  const visited=[];
  const chain=new Chain(NETWORK.rpc,async(_endpoint,method,params)=>{
    if(method==='chain_getFinalizedHead')return 'final';
    if(method==='chain_getHeader')return {number:'0x'+finalHeight.toString(16)};
    if(method==='chain_getBlockHash')return String(params[0]);
    throw Error(method);
  });
  chain.api={rpc:{chain:{getBlock:async(hash)=>{visited.push(Number(hash));return {block:{extrinsics:Number(hash)===includedHeight?[{hash:{toHex:()=>record.id}}]:[]}};}},},query:{system:{events:{at:async()=>[{phase:{isApplyExtrinsic:true,asApplyExtrinsic:{toNumber:()=>0}},event:outcome}]}}},events:{system:{ExtrinsicSuccess:{is:e=>e==='success'},ExtrinsicFailed:{is:e=>e==='failed'}}}};
  return {chain,visited};
}
test('pending transfer expires only after every finalized mortal-era block was checked',async()=>{
  const {chain,visited}=mock();let entries=[structuredClone(record)];
  entries=await chain.reconcile(entries,'account');assert.equal(entries[0].status,'submitted');assert.equal(visited.length,12);
  for(let i=0;i<5;i++)entries=await chain.reconcile(entries,'account');
  assert.equal(entries[0].status,'expired');assert.deepEqual(visited,Array.from({length:65},(_,i)=>100+i));
});
test('finding a hash without an explicit successful event cannot count as success',async()=>{
  const failed=mock(110,103,'failed');const records=await failed.chain.reconcile([record],'account');assert.equal(records[0].status,'failed');assert.equal(records[0].block,103);
  const unknown=mock(110,103,'other');await assert.rejects(unknown.chain.reconcile([record],'account'));
});
test('only finalized blocks are scanned and successful status requires matching extrinsic event',async()=>{
  const {chain,visited}=mock(101,103);const records=await chain.reconcile([record],'account');assert.equal(records[0].status,'submitted');assert.deepEqual(visited,[100,101]);
  const success=mock(110,103);const done=await success.chain.reconcile([record],'account');assert.equal(done[0].status,'finalized');assert.equal(done[0].extrinsicIndex,0);
});
