import test from 'node:test';
import assert from 'node:assert/strict';
import { initCrypto,deriveAccount,normalizeMnemonic,validatePath,validateRecipient,parseAmount,formatAmount,spendable,encryptVault,decryptVault,UNIT,normalizeSecret,addWallet,pairForWallet } from '../core.mjs';
import { signatureVerify,encodeAddress } from '@polkadot/util-crypto';
import { NETWORK,validateEndpoint,validateRpc } from '../config.mjs';
import { assertNetwork } from '../chain.mjs';
import { readContacts,saveContact,writeContacts,contactName } from '../contacts.mjs';
import { readHistory,writeHistory,submitOnce } from '../history.mjs';
await initCrypto();
const phrase='bottom drive obey lake curtain smoke basket hold race lonely fit walk';
const alice=deriveAccount(phrase),bob=deriveAccount(phrase,'//1');
test('standard Substrate sr25519 derivation, native NUMEN address and signature',()=>{
  assert.equal(alice.address,'nu4FEXNb5ZcKudhNZUhLKSun6eKXHVQVZY2Ff5JCDWyjjMiCE');
  const bytes=new TextEncoder().encode('NUMEN wallet test');
  assert.equal(signatureVerify(bytes,alice.sign(bytes),alice.address).isValid,true);
  assert.notEqual(alice.address,bob.address);
});
test('reject another SS58 prefix, EVM, altered checksum and junk',()=>{
  assert.equal(validateRecipient(alice.address),alice.address);
  for(const value of [encodeAddress(alice.publicKey,42),'0x'+'12'.repeat(20),alice.address.slice(0,-1)+'A','nuinvalid','<script>'])assert.throws(()=>validateRecipient(value));
});
test('seed/path validation cannot smuggle a secret URI password',()=>{
  assert.equal(normalizeMnemonic('  '+phrase.toUpperCase()+' '),phrase);
  assert.equal(validatePath('//0/soft'),'//0/soft');
  for(const path of ['///password','0x123','//','/x?y','//'+('a'.repeat(33))])assert.throws(()=>validatePath(path));
  assert.throws(()=>normalizeMnemonic('invalid words'));
});
test('integer arithmetic preserves 18 decimals, no floating-point money',()=>{
  assert.equal(parseAmount('1.000000000000000001'),UNIT+1n);
  assert.equal(parseAmount('0,1'),UNIT/10n);assert.equal(formatAmount(UNIT+1n),'1.000000000000000001');
  for(const amount of ['0','-1','1e6','NaN','0.0000000000000000001','01','1.','1,2,3'])assert.throws(()=>parseAmount(amount));
  assert.equal(formatAmount(-1n),'-0.000000000000000001');
});
test('frozen funds and existential deposit never become spendable',()=>{
  assert.equal(spendable({free:'100',frozen:'60'},10n),40n);
  assert.equal(spendable({free:'100',miscFrozen:'30',feeFrozen:'70'},90n),10n);
  assert.equal(spendable({free:'5',frozen:'10'},0n),0n);
});
test('vault authentication, wrong password, tampering and network binding',async()=>{
  const secret={mnemonic:phrase,path:'//1',type:'sr25519',network:NETWORK.genesis};
  const raw=await encryptVault(secret,'public-test-password');
  assert.ok(!raw.includes(phrase));assert.deepEqual(await decryptVault(raw,'public-test-password'),normalizeSecret(secret));
  await assert.rejects(decryptVault(raw,'wrong-password'));
  const obj=JSON.parse(raw);obj.cipher=(obj.cipher[0]==='0'?'1':'0')+obj.cipher.slice(1);
  await assert.rejects(decryptVault(JSON.stringify(obj),'public-test-password'));
  const wrong=await encryptVault({...secret,network:'wrong'},'public-test-password');await assert.rejects(decryptVault(wrong,'public-test-password'));
});
test('multiple independent wallets, explicit source key, duplicate/limit protection',()=>{
  const first=addWallet(null,phrase),second=addWallet(first,phrase,'//1');
  assert.equal(second.wallets.length,2);assert.equal(pairForWallet(second,bob.address).address,bob.address);
  assert.throws(()=>addWallet(second,phrase));assert.throws(()=>pairForWallet(first,bob.address));
  assert.throws(()=>normalizeSecret({...second,wallets:[{...second.wallets[0],address:bob.address}]}));
});
test('network pin and HTTPS-only endpoints',()=>{
  const props={ss58Format:14240,tokenDecimals:18,tokenSymbol:'NUMN'};
  assertNetwork(NETWORK.genesis,props);assertNetwork(NETWORK.genesis,{...props,tokenDecimals:[18],tokenSymbol:['NUMN']});
  assert.throws(()=>assertNetwork('0x'+'00'.repeat(32),props));assert.throws(()=>assertNetwork(NETWORK.genesis,{...props,tokenDecimals:12}));
  assert.equal(validateEndpoint('https://rpc.example.org/'),'https://rpc.example.org');
  for(const url of ['http://192.0.2.1:9944','javascript:alert(1)','https://name:pass@rpc.example.org','https://rpc.example.org/?key=x'])assert.throws(()=>validateEndpoint(url));
});
test('RPC restricts signing/admin methods and runtime APIs',()=>{
  validateRpc('state_call',['Metadata_metadata_versions','0x']);
  validateRpc('author_submitExtrinsic',['0x'+'ab'.repeat(200)]);
  for(const method of ['author_insertKey','author_rotateKeys','personal_sign','system_addReservedPeer'])assert.throws(()=>validateRpc(method,[]));
  assert.throws(()=>validateRpc('state_call',['Unknown_runtime','0x']));assert.throws(()=>validateRpc('author_submitExtrinsic',['my seed']));
});
test('contacts roundtrip with canonical NUMEN addresses and duplicate protection',()=>{
  const book=saveContact([],'Тест',alice.address);assert.deepEqual(readContacts(writeContacts(book)),book);
  assert.throws(()=>saveContact(book,'Duplicate',alice.address));assert.throws(()=>contactName('x\u202ey'));
});
const record={id:'0x'+'11'.repeat(32),address:alice.address,recipient:bob.address,amount:'1',fee:'2',feeBudget:'3',nonce:'0',genesis:NETWORK.genesis,height:100,expiry:164,scanHeight:99,createdAt:1,status:'unknown'};
test('journal is persisted before submit and timeout never frees nonce',async()=>{
  const events=[];const chain={broadcast:async()=>{events.push('submit');throw Error('timeout');}};
  const result=await submitOnce(chain,{record,hash:record.id},[],async raw=>{events.push('persist');assert.equal(readHistory(raw)[0].status,'unknown');});
  assert.deepEqual(events,['persist','submit']);assert.equal(result.unknown,true);
  await assert.rejects(submitOnce(chain,{record,hash:record.id},result.entries,async()=>{}));
});
test('failed persistence means zero broadcasts; RPC acceptance is not finality',async()=>{
  let submits=0;const chain={broadcast:async()=>submits++};
  await assert.rejects(submitOnce(chain,{record,hash:record.id},[],async()=>{throw Error('disk');}));assert.equal(submits,0);
  const result=await submitOnce(chain,{record,hash:record.id},[],async()=>{});assert.equal(submits,1);assert.equal(result.entries[0].status,'submitted');
});
test('corrupt journal bounds cannot silently expire a pending transfer',()=>{
  assert.equal(readHistory(writeHistory([record]))[0].expiry,164);
  for(const row of [{...record,expiry:1},{...record,scanHeight:100000},{...record,status:'success'},{...record,genesis:'wrong'}])assert.throws(()=>writeHistory([row]));
});
