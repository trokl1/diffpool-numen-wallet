// Test-only synthetic network. Metadata comes from the public node; no transaction is forwarded.
import { ApiPromise,HttpProvider } from '@polkadot/api';
import { NETWORK } from '../config.mjs';
import { initCrypto,deriveAccount,UNIT } from '../core.mjs';
import { signatureVerify,blake2AsU8a } from '@polkadot/util-crypto';
import assert from 'node:assert/strict';
import {emptyIdentity,identityArgs,identityDeposit,assertIdentityCall} from '../identity.mjs';
export const PUBLIC_SEED='bottom drive obey lake curtain smoke basket hold race lonely fit walk';
export const PASSWORD='public-test-password';
export async function fixture(){
  await initCrypto();
  const provider=new HttpProvider(NETWORK.rpc,{},0,0),original=provider.send.bind(provider),metadata=new Map();
  provider.send=async(method,params)=>{
    assert.notEqual(method,'author_submitExtrinsic');
    const result=await original(method,params);
    if(method==='state_getMetadata'||method==='state_call')metadata.set(JSON.stringify([method,params]),result);
    return result;
  };
  const api=await ApiPromise.create({provider,noInitWarn:true});
  const [hash,runtime,methods,health]=await Promise.all([original('chain_getBlockHash',[]),original('state_getRuntimeVersion',[]),original('rpc_methods',[]),original('system_health',[])]);
  const header=await original('chain_getHeader',[hash]);
  const alice=deriveAccount(PUBLIC_SEED),bob=deriveAccount(PUBLIC_SEED,'//1');
  const account=api.createType('AccountInfo',{nonce:0,consumers:0,providers:1,sufficients:0,data:{free:(100n*UNIT).toString(),reserved:0,frozen:0,flags:1n<<127n}}).toHex();
  const fee=api.createType('RuntimeDispatchInfo',{weight:{refTime:1000,proofSize:0},class:'Normal',partialFee:'6500000000000000'}).toHex();
  const state={requests:[],submits:[],offline:false,badGenesis:false,nonce:0,identity:null,free:100n*UNIT};
  const identityPrefix=api.query.identity.identityOf.keyPrefix();
  function storage(key){
    if(key.startsWith(identityPrefix))return state.identity===null?null:api.createType(api.registry.createLookupType(api.query.identity.identityOf.creator.meta.type.asMap.value),{
      judgements:[],deposit:identityDeposit(state.identity,api.consts.identity.basicDeposit.toString(),api.consts.identity.byteDeposit.toString()).toString(),info:identityArgs(state.identity),
    }).toHex();
    return state.free===100n*UNIT?account:api.createType('AccountInfo',{nonce:0,consumers:0,providers:1,sufficients:0,data:{free:state.free.toString(),reserved:0,frozen:0,flags:1n<<127n}}).toHex();
  }
  async function request(endpoint,method,params){
    state.requests.push(method);
    if(state.offline)throw Error('QA offline');
    const key=JSON.stringify([method,params]);
    if(metadata.has(key))return metadata.get(key);
    if(method==='chain_getBlockHash')return params[0]===0?(state.badGenesis?'0x'+'00'.repeat(32):NETWORK.genesis):hash;
    if(method==='chain_getHeader')return header;
    if(method==='chain_getFinalizedHead')return hash;
    if(method==='system_properties')return {ss58Format:14240,tokenDecimals:18,tokenSymbol:'NUMN'};
    if(method==='system_health')return {...health,isSyncing:false};
    if(method==='system_chain')return 'NUMEN';
    if(method==='system_name')return 'QA';
    if(method==='system_version')return '0';
    if(method==='system_accountNextIndex')return state.nonce;
    if(method==='rpc_methods')return methods;
    if(method==='state_getRuntimeVersion')return runtime;
    if(method==='state_getStorage')return storage(params[0]);
    if(method==='state_queryStorageAt')return [{block:hash,changes:params[0].map(key=>[key,storage(key)])}];
    if(method==='state_call'&&params[0]==='TransactionPaymentApi_query_info')return fee;
    if(method==='author_submitExtrinsic'){
      const tx=api.tx(params[0]);const identity=tx.method.section==='identity';assert.equal(tx.method.section,identity?'identity':'balances');assert.equal(tx.method.method,identity?'setIdentity':'transferKeepAlive');
      const payload=api.registry.createType('ExtrinsicPayload',{method:tx.method.toHex(),era:tx.era,nonce:tx.nonce,tip:tx.tip,blockHash:hash,genesisHash:NETWORK.genesis,specVersion:runtime.specVersion,transactionVersion:runtime.transactionVersion,mode:0,metadataHash:null},{version:4});
      const bytes=payload.toU8a({method:true});
      assert.equal(signatureVerify(bytes.length>256?blake2AsU8a(bytes):bytes,tx.signature.toU8a(),tx.signer.toString()).isValid,true,'signed call must verify');
      if(identity){
        const info=Object.fromEntries(Object.keys(emptyIdentity()).map(key=>[key,new TextDecoder('utf-8',{fatal:true}).decode(tx.method.args[0][key].toU8a(true))]));assertIdentityCall(tx,info);
        state.submits.push({kind:'identity',hash:tx.hash.toHex(),signer:tx.signer.toString(),info});
      }else state.submits.push({hash:tx.hash.toHex(),signer:tx.signer.toString(),recipient:tx.method.args[0].toString(),amount:tx.method.args[1].toString()});
      return tx.hash.toHex();
    }
    throw Error('Unhandled QA method: '+method+' '+JSON.stringify(params).slice(0,80));
  }
  return {request,state,alice:alice.address,bob:bob.address,api,close:async()=>{alice.lock();bob.lock();await api.disconnect();}};
}
