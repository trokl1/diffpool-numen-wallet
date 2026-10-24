import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAddress} from '@polkadot/util-crypto';
import {compactFromU8a,hexToU8a} from '@polkadot/util';
import {expectedTransferCall,assertTransferCall} from '../signing-policy.mjs';
import {native,cancelNativeCalls} from '../bridge.mjs';
const address='nu4FEXNb5ZcKudhNZUhLKSun6eKXHVQVZY2Ff5JCDWyjjMiCE';
test('independent call encoding has fixed pallet/call/Id and exact u128 amounts',()=>{
 for(const amount of [1n,63n,64n,16383n,16384n,1n<<30n,10n**18n,(1n<<128n)-1n]){
  const bytes=hexToU8a(expectedTransferCall(address,amount));
  assert.deepEqual([...bytes.slice(0,3)],[3,3,0]);assert.deepEqual(bytes.slice(3,35),decodeAddress(address));
  assert.equal(compactFromU8a(bytes.slice(35))[1].toString(),amount.toString());
 }
});
test('call verifier rejects all-amount, wrong recipient/amount and out-of-range amounts',()=>{
 for(const amount of ['0','-1','01','1.2',(1n<<128n).toString()])assert.throws(()=>expectedTransferCall(address,amount));
 const call=expectedTransferCall(address,'1');assertTransferCall({method:{toHex:()=>call}},address,'1');
 assert.throws(()=>assertTransferCall({method:{toHex:()=>call.replace('0x0303','0x0304')}},address,'1'));
 assert.throws(()=>assertTransferCall({method:{toHex:()=>call}},address,'2'));
});
test('native cancellation rejects pending results and ignores late secret callbacks',async()=>{
 let id;globalThis.Android={call:(value)=>{id=value;}};
 const pending=native('biometricUnlock');const rejected=assert.rejects(pending,/отменена/);cancelNativeCalls();await rejected;
 globalThis.nativeResult(id,true,'late-public-test-password');
 const next=native('load');globalThis.nativeResult(id,true,'current-encrypted-vault');assert.equal(await next,'current-encrypted-vault');delete globalThis.Android;
});
