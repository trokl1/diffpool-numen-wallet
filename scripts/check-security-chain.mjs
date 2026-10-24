// Adversarial RPC tests. ONLY public fixture keys; all submissions are in memory.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {Metadata,TypeRegistry} from '@polkadot/types';
import {compactAddLength,u8aConcat,u8aToHex} from '@polkadot/util';
import {signatureVerify} from '@polkadot/util-crypto';
import {fixture,PUBLIC_SEED} from './qa-fixture.mjs';
import {deriveAccount} from '../core.mjs';
import {Chain} from '../chain.mjs';
import {submitOnce} from '../history.mjs';
import {NETWORK,VERSION} from '../config.mjs';
import {assertSigningPolicy,assertTransferCall} from '../signing-policy.mjs';
const f=await fixture(),pair=deriveAccount(PUBLIC_SEED),checks=[];let chain,evil;
try{
 const feeQueries=[],validOutbound=[];let expensive=false,cancel=false,guardedSigns=0;
 const hash=await f.request(NETWORK.rpc,'chain_getBlockHash',[]);
 function valid(raw){
  for(const candidate of [raw,...(()=>{try{return [f.api.registry.createType('Bytes',raw).toHex()];}catch{return [];}})()]){
   try{const tx=f.api.tx(candidate);if(!tx.isSigned)continue;
    const payload=f.api.registry.createType('ExtrinsicPayload',{method:tx.method.toHex(),era:tx.era,nonce:tx.nonce,tip:tx.tip,blockHash:hash,genesisHash:NETWORK.genesis,specVersion:10000,transactionVersion:1,mode:0,metadataHash:null},{version:4});
    if(signatureVerify(payload.toU8a({method:true}),tx.signature.toU8a(),tx.signer.toString()).isValid)return true;
   }catch{}
  }return false;
 }
 chain=new Chain(NETWORK.rpc,async(endpoint,method,params)=>{
  if(method==='state_call'&&params[0]==='TransactionPaymentApi_query_info'){
   feeQueries.push(params[1]);if(valid(params[1]))validOutbound.push(method);
   if(expensive)return f.api.createType('RuntimeDispatchInfo',{weight:{refTime:1000,proofSize:0},class:'Normal',partialFee:'1000000000000000000'}).toHex();
  }
  return f.request(endpoint,method,params);
 });
 const p=await chain.prepare(f.alice,f.bob,'1',[]);
 assertTransferCall(p.tx,f.bob,p.intent.amount);
 assert.throws(()=>assertTransferCall(f.api.tx.balances.transferAll(f.bob,true),f.bob,p.intent.amount));
 assert.throws(()=>assertTransferCall(p.tx,f.alice,p.intent.amount));checks.push('independent SCALE call/destination/amount validation');
 // Prepared.options is not trusted for nonce, era, fee/tip, genesis or runtime.
 p.options.tip='999999999999';p.options.nonce=999;p.options.blockHash='0x'+'11'.repeat(32);
 const signed=await chain.signPrepared(p,pair),decoded=f.api.tx(signed.hex);
 assert.equal(decoded.tip.toString(),'0');assert.equal(decoded.nonce.toString(),'0');assert.ok(valid(signed.hex));
 assert.equal(validOutbound.length,0);assert.equal(feeQueries.length,2);checks.push('valid local signature; fake-only fee RPC; mutable signing options ignored');
 await assert.rejects(()=>submitOnce(chain,signed,[],async()=>{throw Error('disk failure');}),/disk failure/);
 assert.equal(f.state.submits.length,0);assert.equal(validOutbound.length,0);checks.push('disk failure exposes zero valid signed transactions');
 const originalSign=pair.sign.bind(pair);pair.sign=(...args)=>{guardedSigns++;return originalSign(...args);};
 cancel=true;await assert.rejects(()=>chain.signPrepared(p,pair,()=>{if(cancel)throw Error('cancelled');}),/cancelled/);assert.equal(guardedSigns,0);
 cancel=false;let guards=0;await assert.rejects(()=>chain.signPrepared(p,pair,()=>{if(++guards===4)throw Error('cancelled at final fee');}),/cancelled/);assert.equal(guardedSigns,0);checks.push('cancellation before/after awaits prevents signing');
 expensive=true;await assert.rejects(()=>chain.signPrepared(p,pair),/Комиссия выросла/);assert.equal(guardedSigns,0);expensive=false;checks.push('fee increase rejects before real signature');
 const policyInput={runtimeVersion:f.api.runtimeVersion,runtimeMetadata:f.api.runtimeMetadata,extrinsicVersion:f.api.extrinsicVersion,registry:f.api.registry};
 assertSigningPolicy(policyInput);
 assert.throws(()=>assertSigningPolicy({...policyInput,runtimeVersion:{specName:{toString:()=> 'numen-runtime'},specVersion:{toNumber:()=>10001},transactionVersion:{toNumber:()=>1}}}),/Непроверенный runtime/);
 assert.throws(()=>assertSigningPolicy({...policyInput,registry:{signedExtensions:[...f.api.registry.signedExtensions].reverse()}}),/Непроверенный runtime/);checks.push('unknown runtime and changed extension order rejected');
 const document=f.api.runtimeMetadata.toJSON(),body=document.metadata['v'+f.api.runtimeMetadata.version],balances=body.pallets.find(p=>p.name==='Balances');
 const variants=body.lookup.types.find(t=>t.id===balances.calls.type).type.def.variant.variants;
 variants.find(c=>c.name==='transfer_keep_alive').name='audit_original';variants.find(c=>c.name==='transfer_all').name='transfer_keep_alive';
 const registry=new TypeRegistry(),forged=new Metadata(registry,document);let evilFee=0;
 evil=new Chain('https://malicious-rpc.example',async(endpoint,method,params)=>{
  assert.notEqual(method,'author_submitExtrinsic');
  if(method==='state_getMetadata')return forged.toHex();
  if(method==='state_call'&&params[0]==='Metadata_metadata_at_version')return u8aToHex(u8aConcat(new Uint8Array([1]),compactAddLength(forged.toU8a())));
  if(method==='state_call'&&params[0]==='Metadata_metadata_versions')return registry.createType('Vec<u32>',[16]).toHex();
  if(method==='state_call'&&params[0]==='TransactionPaymentApi_query_info')evilFee++;
  return f.request(endpoint,method,params);
 });
 await assert.rejects(()=>evil.prepare(f.alice,f.bob,'1',[]),/Непроверенный runtime или metadata/);assert.equal(evilFee,0);checks.push('forged transferAll metadata rejected even with correct genesis/runtime/properties');
 let persisted=false;
 const result=await submitOnce({broadcast:async data=>{assert.ok(persisted);return chain.broadcast(data);}},signed,[],async()=>{persisted=true;});
 assert.equal(result.unknown,false);assert.equal(f.state.submits.length,1);assert.equal(f.state.submits[0].amount,'1000000000000000000');assert.equal(f.state.submits[0].recipient,f.bob);checks.push('approved 1 NUMN mock transfer verifies and broadcasts only after durable journal');
 const report={version:VERSION,checkedAt:new Date().toISOString(),passed:true,checks,validSignedFeeRequests:validOutbound.length,mockedBroadcasts:f.state.submits.length,realBroadcasts:0};
 await mkdir('evidence',{recursive:true});await writeFile('evidence/security-chain.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{pair.lock();await chain?.close();await evil?.close();await f.close();}
