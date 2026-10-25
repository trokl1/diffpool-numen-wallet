import test from 'node:test';
import assert from 'node:assert/strict';
import {compactFromU8a,hexToU8a} from '@polkadot/util';
import {IDENTITY_FIELDS,emptyIdentity,validateIdentity,identityBytes,identityDeposit,expectedIdentityCall,assertIdentityCall,identityArgs} from '../identity.mjs';

test('NUMEN Identity uses fixed field order, independent SCALE bytes and literal 0x text',()=>{
 const info={...emptyIdentity(),display:'0x1234',bio:'Hello\nworld',telegram:'@test'};
 const bytes=hexToU8a(expectedIdentityCall(info));assert.deepEqual([...bytes.slice(0,2)],[8,1]);
 let offset=2;
 for(const {key} of IDENTITY_FIELDS){const [prefix,n]=compactFromU8a(bytes.slice(offset));offset+=prefix;assert.equal(new TextDecoder().decode(bytes.slice(offset,offset+Number(n))),info[key]);offset+=Number(n);}
 assert.equal(offset,bytes.length);assert.equal(identityArgs(info).display,'0x307831323334');
 assert.equal(identityDeposit(emptyIdentity(),'5170000000000000000','10000000000000000'),5270000000000000000n);
 assert.equal(identityDeposit(info,'5','2'),5n+2n*BigInt(identityBytes(info).length));
});
test('Identity limits count UTF-8 bytes, not characters; empty fields and whitespace preserve exact values',()=>{
 assert.equal(validateIdentity({...emptyIdentity(),display:'Я'.repeat(16)}).display.length,16);
 assert.throws(()=>validateIdentity({...emptyIdentity(),display:'Я'.repeat(17)}));
 for(const {key,limit} of IDENTITY_FIELDS){assert.doesNotThrow(()=>validateIdentity({...emptyIdentity(),[key]:'x'.repeat(limit)}));assert.throws(()=>validateIdentity({...emptyIdentity(),[key]:'x'.repeat(limit+1)}));}
 assert.equal(validateIdentity({...emptyIdentity(),bio:' leading\ntrailing '}).bio,' leading\ntrailing ');
 for(const bad of ['bad\u0000','fake\u202e','unpaired\ud800','name\nnext'])assert.throws(()=>validateIdentity({...emptyIdentity(),display:bad}));
 assert.throws(()=>validateIdentity({...emptyIdentity(),extra:'forgotten field'}));
 const missing=emptyIdentity();delete missing.web;assert.throws(()=>validateIdentity(missing));
});
test('Identity call verifier rejects alternate methods, field changes and reordering',()=>{
 const info={...emptyIdentity(),display:'Public name'},hex=expectedIdentityCall(info);
 assertIdentityCall({method:{toHex:()=>hex}},info);
 assert.throws(()=>assertIdentityCall({method:{toHex:()=>hex.replace('0x0801','0x0803')}},info));
 assert.throws(()=>assertIdentityCall({method:{toHex:()=>hex}},{...info,display:'Attacker'}));
 assert.throws(()=>identityDeposit(info,'-1','1'));
});
