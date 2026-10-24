import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {qrRecipient,decodeQr} from '../qr.mjs';
import {POOL_WALLETS} from '../transfers.mjs';
const address=POOL_WALLETS[0].address;

test('QR parser accepts only checksummed native NUMEN public addresses',()=>{
  assert.equal(qrRecipient(' \n'+address+'\n'),address);
  for(const input of ['',null,42,'a'.repeat(2049),address.slice(0,-1)+'1','5GrwvaEF5zXb26Fz9rcQpDWS64PsLUru4wwpftFMD5N1GBKo'])assert.throws(()=>qrRecipient(input));
});
test('untrusted QR never opens links, imports seeds, changes RPC or executes a connection request',()=>{
  for(const input of ['https://example.com/'+address,'javascript:alert(1)','numen:'+address+'?amount=1','{"secretSeed":"0x'+'11'.repeat(32)+'"}','bottom drive obey lake curtain smoke basket hold race lonely fit walk'])assert.throws(()=>qrRecipient(input));
  assert.throws(()=>qrRecipient('wc:abc@2?relay-protocol=irn&symKey=secret'),/WalletConnect/);
});
test('our receive QR round-trips through the production decoder',()=>{
  const {data,size}=QRCode.create(address,{errorCorrectionLevel:'M'}).modules;
  const scale=6,side=(size+8)*scale,pixels=new Uint8ClampedArray(side*side*4).fill(255);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(data[y*size+x])for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){
    const index=(((y+4)*scale+yy)*side+(x+4)*scale+xx)*4;pixels[index]=pixels[index+1]=pixels[index+2]=0;
  }
  assert.equal(decodeQr(pixels,side,side),address);
  assert.equal(decodeQr(new Uint8ClampedArray(100*100*4).fill(255),100,100),null);
});
