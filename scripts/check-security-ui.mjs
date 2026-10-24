// Regression of AUD-01/03/04/05 with local mock transport and PUBLIC test secrets.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {signatureVerify,mnemonicToMiniSecret} from '@polkadot/util-crypto';
import {fixture,PUBLIC_SEED,PASSWORD} from './qa-fixture.mjs';
import {addWallet,encryptVault} from '../core.mjs';
import {walletSettings} from '../settings.mjs';
import {NETWORK,VERSION} from '../config.mjs';
const f=await fixture(),secret=addWallet(null,PUBLIC_SEED,''),store=new Map([
 ['save',await encryptVault(secret,PASSWORD)],['saveSettings',JSON.stringify({...walletSettings(),autoRefresh:false})],
]);
const checks=[],errors=[],rpcCalls=[];let failJournal=false,holdFee=false,releaseFee=null,holdSave=false,releaseSave=null,validFeeQueries=0;
const rawSeed=Buffer.from(mnemonicToMiniSecret(PUBLIC_SEED)).toString('hex'),hash=await f.request(NETWORK.rpc,'chain_getBlockHash',[]);
function checkFee(raw){
 const candidates=[raw];try{candidates.push(f.api.registry.createType('Bytes',raw).toHex());}catch{}
 for(const bytes of candidates){try{const tx=f.api.tx(bytes);if(!tx.isSigned)continue;
  const p=f.api.registry.createType('ExtrinsicPayload',{method:tx.method.toHex(),era:tx.era,nonce:tx.nonce,tip:tx.tip,blockHash:hash,genesisHash:NETWORK.genesis,specVersion:10000,transactionVersion:1,mode:0,metadataHash:null},{version:4});
  if(signatureVerify(p.toU8a({method:true}),tx.signature.toU8a(),tx.signer.toString()).isValid)validFeeQueries++;
 }catch{}}
}
const server=createServer(async(req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile('web/'+file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('nativeQA',async(action,data)=>{
  if(action==='request'){
   const text=JSON.stringify(data);assert.ok(!text.includes(PUBLIC_SEED)&&!text.includes(PASSWORD)&&!text.includes(rawSeed),'secret network egress');rpcCalls.push(data.method);
   assert.notEqual(data.method,'author_submitExtrinsic','adverse scenarios must never submit');
   if(data.method==='state_call'&&data.params[0]==='TransactionPaymentApi_query_info'){checkFee(data.params[1]);if(holdFee)await new Promise(resolve=>releaseFee=resolve);}
   return JSON.stringify({jsonrpc:'2.0',id:1,result:await f.request(data.endpoint,data.method,data.params)});
  }
  if(action==='biometricStatus')return JSON.stringify({available:true,enabled:false});
  if(action==='importFileStatus')return 'none';
  if(['invalidate','cancelImportFile','copy','cancelBiometric'].includes(action))return 'ok';
  if(action.startsWith('load'))return store.get(action.replace('load','save'))||'';
  if(action.startsWith('save')){if(action==='saveHistory'&&failJournal)throw Error('SECURITY_DISK_FAILED');if(action==='save'&&holdSave)await new Promise(resolve=>releaseSave=resolve);if(action==='save'){assert.equal(data.previous,store.get('save')||'');data=data.encrypted;}store.set(action,data);return 'ok';}
  throw Error('Unexpected native action '+action);
 });
 await page.addInitScript(()=>{window.Android={call:(id,action,json)=>window.nativeQA(action,JSON.parse(json)).then(value=>window.nativeResult(id,true,value),error=>window.nativeResult(id,false,error.message))};});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const unlock=async()=>{await page.locator('#unlockPassword').fill(PASSWORD);await page.locator('#unlock').click();await page.locator('#walletSelect').waitFor();};
 const prepare=async()=>{await page.locator('#send').click();await page.locator('#recipient').fill(f.bob);await page.locator('#amount').fill('1');await page.locator('#prepare').click();await page.locator('#confirmPassword').waitFor();};
 await unlock();failJournal=true;await prepare();await page.locator('#sendPassword').fill(PASSWORD);await page.locator('#confirmPassword').click();
 await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('SECURITY_DISK_FAILED'));
 assert.equal(await page.locator('#sendPassword').inputValue(),'');assert.equal(validFeeQueries,0);assert.ok(!store.has('saveHistory'));checks.push('disk failure: no valid fee signature, no broadcast, password cleared');
 await page.locator('#back').click();failJournal=false;await prepare();holdFee=true;
 await page.locator('#sendPassword').fill(PASSWORD);await page.locator('#confirmPassword').click();
 for(let i=0;i<200&&!releaseFee;i++)await page.waitForTimeout(25);assert.ok(releaseFee);
 await page.locator('#back').click();holdFee=false;releaseFee();await page.locator('#walletSelect').waitFor();await page.waitForTimeout(300);
 assert.equal(validFeeQueries,0);assert.ok(!store.has('saveHistory'));checks.push('back during final fee query cancels before real signing');
 // Let a durable native save finish after lock/resume; it must not reopen the UI.
 await page.locator('#addWatch').click();await page.locator('#watchAddress').fill(f.bob);await page.locator('#watchName').fill('Public watch fixture');await page.locator('#watchPassword').fill(PASSWORD);holdSave=true;await page.locator('#saveWatch').click();
 for(let i=0;i<300&&!releaseSave;i++)await page.waitForTimeout(25);assert.ok(releaseSave);
 await page.evaluate(()=>{window.appBackground();window.appResume();});await page.locator('#unlockPassword').waitFor();holdSave=false;releaseSave();await page.waitForTimeout(400);
 assert.equal(await page.locator('#walletSelect').count(),0);await page.locator('#unlockPassword').waitFor();checks.push('late native save cannot unlock a new session');
 await unlock();assert.equal(await page.locator('#walletSelect option').count(),2);checks.push('fresh authentication reads committed vault after cancelled save');
 await page.locator('#settings').click();await page.locator('#settingsPassword').fill('incorrect-password');await page.locator('#showSeed').click();await page.waitForFunction(()=>document.querySelector('#message')?.classList.contains('error'));assert.equal(await page.locator('#settingsPassword').inputValue(),'');
 await page.locator('#settingsPassword').fill(PASSWORD);await page.locator('#showSeed').click();await page.locator('#backupSeed').waitFor();
 assert.equal(await page.locator('#backupSeed').textContent(),PUBLIC_SEED);assert.equal(await page.locator('#backupSeed').evaluate(e=>e.tagName),'DIV');
 const cdp=await page.context().newCDPSession(page);await cdp.send('Accessibility.enable');const ax=await cdp.send('Accessibility.getFullAXTree');assert.ok(!JSON.stringify(ax).includes(PUBLIC_SEED));
 assert.equal(await page.evaluate(()=>{const e=new Event('copy',{bubbles:true,cancelable:true});document.querySelector('#backupSeed').dispatchEvent(e);return e.defaultPrevented;}),true);checks.push('seed display is non-input, excluded from AX tree; copy cancelled');
 await page.clock.install(); // Existing native timers cannot be moved; re-open under virtual clock.
 await page.locator('#back').click();await page.locator('#settings').click();await page.locator('#settingsPassword').fill(PASSWORD);await page.locator('#showSeed').click();await page.locator('#backupSeed').waitFor();
 await page.clock.runFor(60001);await page.locator('#unlockPassword').waitFor();assert.ok(!(await page.content()).includes(PUBLIC_SEED));checks.push('60-second secret reveal timeout clears DOM and locks');
 await unlock();await page.clock.runFor(180001);await page.locator('#unlockPassword').waitFor();checks.push('3-minute inactivity locks without backgrounding');
 assert.equal(validFeeQueries,0);assert.deepEqual(errors,[]);
 const report={version:VERSION,checkedAt:new Date().toISOString(),passed:true,checks,requestsCheckedForSecretEgress:rpcCalls.length,validSignedFeeRequests:0,realBroadcasts:0};
 await mkdir('evidence',{recursive:true});await writeFile('evidence/security-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.close();}
