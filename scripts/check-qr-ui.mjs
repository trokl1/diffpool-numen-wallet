// Synthetic camera frames and public test keys only. No real broadcasts.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {PNG} from 'pngjs';
import {fixture,PUBLIC_SEED,PASSWORD} from './qa-fixture.mjs';
import {initCrypto,addWallet,encryptVault} from '../core.mjs';
import {walletSettings} from '../settings.mjs';
import {decodeQr} from '../qr.mjs';
import {VERSION} from '../config.mjs';
await initCrypto();
const network=await fixture(),store=new Map([
  ['save',await encryptVault(addWallet(null,PUBLIC_SEED,''),PASSWORD)],
  ['saveSettings',JSON.stringify({...walletSettings(),autoRefresh:false})],
]),calls=[],shares=[],errors=[];
const server=createServer(async(req,res)=>{
  const file=req.url==='/'?'index.html':req.url.slice(1);
  if(!['index.html','app.js','style.css'].includes(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile('web/'+file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:412,height:915}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('nativeQA',async(action,data)=>{
    calls.push(action);
    if(action==='request'){assert.notEqual(data.method,'author_submitExtrinsic');return JSON.stringify({jsonrpc:'2.0',id:1,result:await network.request(data.endpoint,data.method,data.params)});}
    if(action==='biometricStatus')return JSON.stringify({available:false,enabled:false});
    if(action==='importFileStatus')return 'none';
    if(['beginQrScan','endQrScan','copy','invalidate'].includes(action))return 'ok';
    if(action==='shareQr'){shares.push(data);return 'opened';}
    if(action.startsWith('load'))return store.get(action.replace('load','save'))||'';
    if(action.startsWith('save')){store.set(action,data);return 'ok';}
    throw Error('Unexpected native action '+action);
  });
  await page.addInitScript(()=>{
    window.Android={call:(id,action,json)=>window.nativeQA(action,JSON.parse(json)).then(value=>window.nativeResult(id,true,value),error=>window.nativeResult(id,false,error.message))};
    window.qaStreams=[];window.qaMode='blank';window.qaQr='';
    window.qaFrame=async(value)=>{const image=new Image();image.src=value;await image.decode();const c=window.qaCanvas;c.getContext('2d').drawImage(image,0,0,640,640);};
    navigator.mediaDevices.getUserMedia=async constraints=>{
      if(constraints.audio!==false)throw Error('Microphone must not be requested');
      if(window.qaMode==='deny')throw new DOMException('denied','NotAllowedError');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=640;canvas.getContext('2d').fillStyle='#fff';canvas.getContext('2d').fillRect(0,0,640,640);window.qaCanvas=canvas;
      if(window.qaMode==='qr')await window.qaFrame(window.qaQr);
      const stream=canvas.captureStream(5);window.qaStreams.push(stream);
      if(window.qaMode==='late')await new Promise(resolve=>window.qaReleaseCamera=resolve);
      return stream;
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const unlock=async()=>{await page.locator('#unlockPassword').fill(PASSWORD);await page.locator('#unlock').click();await page.locator('#walletSelect').waitFor();};
  await unlock();await page.locator('#receive').click();await page.waitForFunction(()=>document.querySelector('#shareQr')&&!document.querySelector('#shareQr').disabled);
  await page.locator('#shareQr').click();assert.equal(shares.length,1);assert.equal(shares[0].address,network.alice);
  const png=PNG.sync.read(Buffer.from(shares[0].png.split(',')[1],'base64'));assert.equal(decodeQr(png.data,png.width,png.height),network.alice);
  await mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/qr-receive.png',fullPage:true});
  await page.locator('#back').click();await page.evaluate(()=>window.qaMode='deny');await page.locator('#scanQr').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('не разрешена'));await page.locator('#cancelScan').click();
  await page.evaluate(()=>window.qaMode='blank');await page.locator('#scanQr').click();await page.waitForFunction(()=>document.querySelector('#qrCamera')?.readyState>=2);
  await page.evaluate(data=>window.qaFrame(data),await QRCode.toDataURL('wc:example@2?relay-protocol=irn&symKey=public-fixture',{width:640,margin:4}));
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('WalletConnect'));assert.equal(await page.locator('#recipient').count(),0);
  await page.evaluate(data=>window.qaFrame(data),await QRCode.toDataURL(network.bob,{width:640,margin:4}));
  await page.locator('#recipient').waitFor();assert.equal(await page.locator('#recipient').inputValue(),network.bob);assert.equal(await page.locator('#amount').inputValue(),'');
  assert.ok(await page.evaluate(()=>window.qaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),'scan success stops all camera tracks');
  await page.locator('#amount').fill('1.25');await page.evaluate(()=>window.qaMode='blank');await page.locator('#scanRecipient').click();await page.waitForFunction(()=>document.querySelector('#qrCamera')?.readyState>=2);await page.locator('#cancelScan').click();
  assert.equal(await page.locator('#recipient').inputValue(),network.bob);assert.equal(await page.locator('#amount').inputValue(),'1.25');
  await page.locator('#scanRecipient').click();await page.waitForFunction(()=>document.querySelector('#qrCamera')?.readyState>=2);await page.evaluate(()=>window.appBackground());await page.locator('#unlockPassword').waitFor();
  assert.ok(await page.evaluate(()=>window.qaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),'background stops camera');
  await unlock();await page.evaluate(()=>window.qaMode='late');await page.locator('#scanQr').click();await page.waitForFunction(()=>!!window.qaReleaseCamera);await page.locator('#cancelScan').click();await page.evaluate(()=>window.qaReleaseCamera());
  await page.waitForFunction(()=>window.qaStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));assert.equal(await page.locator('#qrCamera').count(),0);
  assert.equal(network.state.submits.length,0);assert.deepEqual(errors,[]);
  const report={passed:true,version:VERSION,qrShareRoundTrip:true,nativeCameraBridgeInvoked:calls.includes('beginQrScan'),cameraDenial:true,qrPrefillsRecipientOnly:true,walletConnectRejectedWithoutNavigation:true,cancelKeepsDraft:true,cameraStopsAfterSuccessCancelAndLock:true,lateCameraStreamStopped:true,realBroadcasts:0};
  await writeFile('evidence/qr-ui.json',JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();server.close();await network.close();}
