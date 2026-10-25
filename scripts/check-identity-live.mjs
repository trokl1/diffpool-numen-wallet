// Read-only mainnet probe: public profile and fake-signature fee estimate only.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {Chain} from '../chain.mjs';
import {NETWORK,VERSION} from '../config.mjs';
import {identityArgs,identityDeposit,assertIdentityCall} from '../identity.mjs';
const calls=[],owner='nu327rmGPkjwfAHWQPB8R87bbnDYbzeX5YK1h7QMfGnq9WWpS';
const c=new Chain(NETWORK.rpc,async(endpoint,method,params)=>{
 assert.notEqual(method,'author_submitExtrinsic');calls.push(method);
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(25000)});assert.equal(response.status,200);
 const data=await response.json();if(data.error)throw Error(JSON.stringify(data.error));return data.result;
});
try{
 const profile=await c.identity(owner),snapshot=await c.snapshot(owner),api=c.api;
 const tx=api.tx.identity.setIdentity(identityArgs(profile.info));assertIdentityCall(tx,profile.info);
 const deposit=identityDeposit(profile.info,api.consts.identity.basicDeposit.toString(),api.consts.identity.byteDeposit.toString());assert.equal(deposit.toString(),profile.deposit);
 const fake=api.tx(tx.toU8a()).signFake(owner,c.options(snapshot)).toU8a();
 const fee=(await api.call.transactionPaymentApi.queryInfo(fake,fake.length)).partialFee.toString();
 const report={version:VERSION,passed:true,checkedAt:new Date().toISOString(),profile,deposit:deposit.toString(),feeEstimateForSameProfile:fee,readOnly:true,realSignatures:0,realBroadcasts:0,calls};
 await mkdir('evidence',{recursive:true});await writeFile('evidence/identity-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify({version:VERSION,display:profile.info.display,telegram:profile.info.telegram,deposit:profile.deposit,fee,readOnly:true},null,2));
}finally{await c.close();}
