// Read-only: public disposable test account; NEVER calls author_submitExtrinsic.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Chain } from '../chain.mjs';
import { NETWORK } from '../config.mjs';
import { initCrypto,deriveAccount } from '../core.mjs';
const calls=[];
const transport=async(endpoint,method,params)=>{
  assert.notEqual(method,'author_submitExtrinsic');calls.push(method);
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(25000)});
  assert.equal(response.status,200);
  const data=await response.json();if(data.error)throw Error(JSON.stringify(data.error));return data.result;
};
await initCrypto();
const pair=deriveAccount('bottom drive obey lake curtain smoke basket hold race lonely fit walk');
const chain=new Chain(NETWORK.rpc,transport);
try{
  const snapshot=await chain.snapshot(pair.address),api=chain.api;
  const options=chain.options(snapshot);
  const recipient=deriveAccount('bottom drive obey lake curtain smoke basket hold race lonely fit walk','//1').address;
  const tx=api.tx.balances.transferKeepAlive(recipient,'1');
  tx.sign(pair,options);
  const fee=await api.call.transactionPaymentApi.queryInfo(tx.toU8a(),tx.toU8a().length);
  const decoded=api.tx(tx.toHex());
  assert.equal(decoded.method.section,'balances');assert.equal(decoded.method.method,'transferKeepAlive');
  assert.equal(decoded.nonce.toString(),snapshot.nonce);
  await mkdir('evidence',{recursive:true});
  await writeFile('evidence/live-readonly.json',JSON.stringify({checkedAt:new Date().toISOString(),network:NETWORK,snapshot,signedExtensions:api.registry.signedExtensions,feeEstimateForOnePlanck:fee.partialFee.toString(),offlineSignedBytes:tx.toU8a().length,eraDeath:Number(options.era.asMortalEra.death(snapshot.height)),calls,noBroadcast:true},null,2));
  console.log(JSON.stringify({snapshot,signedExtensions:api.registry.signedExtensions,fee:fee.partialFee.toString(),expiry:Number(options.era.asMortalEra.death(snapshot.height)),noBroadcast:true},null,2));
}finally{pair.lock();await chain.close();}
