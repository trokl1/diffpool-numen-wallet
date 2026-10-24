import test from 'node:test';
import assert from 'node:assert/strict';
import {mnemonicToMiniSecret,signatureVerify,decodeAddress} from '@polkadot/util-crypto';
import {NETWORK} from '../config.mjs';
import {initCrypto,importKey,seedEntry,walletEntry,addKeyWallet,addWatchWallet,pairForWallet,encryptVault,decryptVault,normalizeSecret,clearSecret} from '../core.mjs';
await initCrypto();
const phrase='bottom drive obey lake curtain smoke basket hold race lonely fit walk',raw='0x'+Buffer.from(mnemonicToMiniSecret(phrase)).toString('hex'),address=walletEntry(phrase).address;
const json=JSON.stringify({secretPhrase:phrase,secretSeed:raw,ss58Address:address,publicKey:'0x'+Buffer.from(decodeAddress(address)).toString('hex')});
test('32-byte raw seed and BIP39 derive identical sr25519 keys; signatures verify',()=>{
  const entry=importKey(raw,address),secret=addKeyWallet(null,entry),pair=pairForWallet(secret,address);
  const message=new TextEncoder().encode('public NUMEN raw seed signature fixture');
  try{assert.equal(pair.address,address);assert.equal(signatureVerify(message,pair.sign(message),address).isValid,true);}finally{pair.lock();}
});
test('signer JSON validates every public field and agrees across phrase and seed',()=>{
  assert.equal(importKey(json,address).address,address);
  const doc=JSON.parse(json);
  for(const changed of [{...doc,publicKey:'0x'+'11'.repeat(32)},{...doc,ss58Address:seedEntry('0x'+'22'.repeat(32)).address},{...doc,secretSeed:'0x'+'33'.repeat(32)},{...doc,type:'ed25519'},{...doc,genesisHash:'0x'+'00'.repeat(32)},{...doc,ss58Format:42}])assert.throws(()=>importKey(JSON.stringify(changed)));
  assert.throws(()=>importKey(json,seedEntry('0x'+'22'.repeat(32)).address));
});
test('raw importer rejects malformed/expanded keys, public-only and encrypted JSON without leaking input',()=>{
  for(const input of ['0x'+'11'.repeat(64),'0x'+'11'.repeat(31),'11'.repeat(32),JSON.stringify({publicKey:'0x'+'11'.repeat(32)}),JSON.stringify({encoded:'encrypted',encoding:{}}),'x'.repeat(16385),'//Alice',phrase+'///password'])assert.throws(()=>importKey(input));
  assert.throws(()=>importKey('{"secretSeed":"PRIVATE_SENTINEL"'),e=>!e.message.includes('PRIVATE_SENTINEL'));
});
test('explicit SURI derivation is preserved, raw and phrase paths cannot smuggle a password',()=>{
  const derived=importKey(phrase+'//1/soft');assert.equal(derived.path,'//1/soft');assert.equal(derived.address,walletEntry(phrase,'//1/soft').address);
  assert.equal(importKey(raw+'//1').address,seedEntry(raw,'//1').address);
  assert.throws(()=>importKey(raw+'///password'));
});
test('watch upgrade, duplicate rejection, encrypted raw-seed roundtrip and legacy vault survive',async()=>{
  const watch=addWatchWallet(null,address),entry=importKey(raw),upgraded=addKeyWallet(watch,entry);
  assert.equal(upgraded.wallets.length,1);assert.ok(upgraded.wallets[0].secretSeed);assert.throws(()=>addKeyWallet(upgraded,entry));
  const encrypted=await encryptVault(upgraded,'public-test-password');assert.ok(!encrypted.includes(raw));assert.deepEqual(await decryptVault(encrypted,'public-test-password'),upgraded);
  const legacy={network:NETWORK.genesis,type:'sr25519',mnemonic:phrase,path:''};assert.equal(normalizeSecret(legacy).wallets[0].address,address);
  const corrupt=structuredClone(upgraded);corrupt.wallets[0].address=seedEntry('0x'+'22'.repeat(32)).address;assert.throws(()=>normalizeSecret(corrupt));
  clearSecret(upgraded);assert.equal(upgraded.wallets[0].secretSeed,'');
});
