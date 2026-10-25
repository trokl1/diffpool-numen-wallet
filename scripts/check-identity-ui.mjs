// Browser end-to-end Identity checks with disposable public keys and mock network.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {fixture,PUBLIC_SEED,PASSWORD} from './qa-fixture.mjs';
import {historyFixture} from './history-fixture.mjs';
import {emptyIdentity} from '../identity.mjs';
import {encryptVault,addWallet,addWatchWallet} from '../core.mjs';
import {VERSION,DONATION_ADDRESS} from '../config.mjs';
import {validateRecipient} from '../core.mjs';
const f=await fixture(),history=historyFixture(),store=new Map(),errors=[],checks=[];
store.set('save',await encryptVault(addWallet(null,PUBLIC_SEED),PASSWORD));
store.set('saveSettings',JSON.stringify({autoRefresh:false,autoRefreshVersion:1}));
store.set('saveContacts',JSON.stringify({v:1,entries:[{address:f.alice,name:'Local alias'}]}));
let hold=false,release,failHistory=false,copied='';
const server=createServer(async(req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile('web/'+file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:360,height:850}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('nativeQA',async(action,data)=>{
  if(action==='request'){if(hold&&['state_queryStorageAt','state_getStorage'].includes(data.method))await new Promise(r=>release=r);return JSON.stringify({jsonrpc:'2.0',id:1,result:await f.request(data.endpoint,data.method,data.params)});}
  if(action==='historyRequest')return history.request(data);
  if(action==='biometricStatus')return JSON.stringify({available:true,enabled:false});
  if(action==='importFileStatus')return 'none';
  if(action==='copy'){copied=data;return 'ok';}
  if(['invalidate','cancelImportFile','cancelBiometric','endQrScan'].includes(action))return 'ok';
  if(action.startsWith('load'))return store.get(action.replace('load','save'))||'';
  if(action.startsWith('save')){if(action==='saveHistory'&&failHistory)throw Error('DISK_FAILED');store.set(action,data);return 'ok';}
  throw Error('Unexpected native action '+action);
 });
 await page.addInitScript(()=>{window.Android={call:(id,action,json)=>window.nativeQA(action,JSON.parse(json)).then(value=>window.nativeResult(id,true,value),e=>window.nativeResult(id,false,e.message))};});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#unlockPassword').waitFor();await page.locator('#unlockPassword').fill(PASSWORD);await page.locator('#unlock').click();await page.locator('#identity').waitFor();
 assert.equal(validateRecipient(DONATION_ADDRESS),'nu4dxPMnaPXN4ZRWJaUM6RnSY8zuhi1NrYiR7Nfh42wB9YAxr');
 assert.ok((await page.locator('#donation .address').textContent()).includes(DONATION_ADDRESS));
 await page.locator('#copyDonation').click();assert.equal(copied,DONATION_ADDRESS);await page.locator('#donate').click();assert.equal(await page.locator('#recipient').inputValue(),DONATION_ADDRESS);assert.equal(await page.locator('#amount').inputValue(),'');assert.equal(f.state.submits.length,0);
 await page.locator('#amount').fill('0.5');await page.locator('#prepare').click();await page.locator('#confirmPassword').waitFor();assert.ok((await page.locator('#app').textContent()).includes(DONATION_ADDRESS));assert.match(await page.locator('#app').textContent(),/0.5 NUMN/);assert.equal(f.state.submits.length,0);await page.locator('#back').click();checks.push('optional donation uses approved FEE address, empty amount, normal fee preview and explicit confirmation; cancel sends nothing');
 await page.locator('#identity').click();await page.locator('#editIdentity').waitFor();assert.match(await page.locator('#identityProfile').textContent(),/ещё не задан/);
 await page.locator('#editIdentity').click();assert.equal(await page.locator('textarea').count(),10);await page.locator('#identity-display').fill('Я'.repeat(17));await page.locator('#identityPublic').check();await page.locator('#prepareIdentity').click();await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('UTF-8'));assert.equal(f.state.submits.length,0);
 await page.locator('#identity-display').fill('Мой кошелёк');await page.locator('#identity-bio').fill('Привет!\nМой профиль');await page.locator('#identity-telegram').fill('@public_test');await page.locator('#prepareIdentity').click();await page.locator('#confirmPassword').waitFor();assert.match(await page.locator('#app').textContent(),/Новый залог Identity/);assert.match(await page.locator('#app').textContent(),/Мой кошелёк/);assert.match(await page.locator('#app').textContent(),/Привет!/);assert.equal(f.state.submits.length,0);await page.locator('#back').click();checks.push('Cyrillic profile create, byte-limit validation, public acknowledgement and deposit preview; cancel signs nothing');
 f.state.identity={...emptyIdentity(),display:'Chain name',web:'https://example.com',avatar:'https://tracking.example/a.png',bio:'<img src=x onerror=alert(1)>'};
 await page.locator('#settings').click();await page.locator('#language').selectOption('en');await page.waitForFunction(()=>document.documentElement.lang==='en');await page.locator('#back').click();assert.match(await page.locator('#donation').textContent(),/Support development/);assert.ok(!/[А-Яа-яЁё]/.test(await page.locator('#donation').textContent()));await page.screenshot({path:'evidence/identity-home-en.png',fullPage:true});
 await page.locator('#identity').click();await page.locator('#editIdentity').waitFor();assert.equal(await page.locator('#identityProfile img').count(),0);assert.equal(await page.locator('#identityProfile a').count(),0);assert.ok(!/[А-Яа-яЁё]/.test(await page.locator('#app').textContent()));
 await mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/identity-view-en.png',fullPage:true});
 await page.locator('#editIdentity').click();assert.equal(await page.locator('#identity-web').inputValue(),'https://example.com');assert.equal(await page.locator('#identity-bio').inputValue(),f.state.identity.bio);
 await page.locator('#identity-display').fill('Updated name');await page.locator('#identityPublic').check();await page.locator('#prepareIdentity').click();await page.locator('#confirmPassword').waitFor();assert.ok(!/[А-Яа-яЁё]/.test(await page.locator('#app').textContent()));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'evidence/identity-confirm-en.png',fullPage:true});
 const vault=store.get('save'),contacts=store.get('saveContacts');failHistory=true;await page.locator('#sendPassword').fill(PASSWORD);await page.locator('#confirmPassword').click();await page.waitForFunction(()=>document.querySelector('#message')?.textContent==='DISK_FAILED');assert.equal(f.state.submits.length,0);failHistory=false;
 await page.locator('#back').click();await page.locator('#identity').click();await page.locator('#editIdentity').click();await page.locator('#identity-display').fill('Updated name');await page.locator('#identityPublic').check();await page.locator('#prepareIdentity').click();await page.locator('#sendPassword').fill(PASSWORD);await page.locator('#confirmPassword').click();await page.locator('#walletSelect').waitFor();
 assert.equal(f.state.submits.length,1);assert.equal(f.state.submits[0].kind,'identity');assert.equal(f.state.submits[0].info.display,'Updated name');assert.equal(f.state.submits[0].info.web,'https://example.com');assert.equal(f.state.submits[0].info.bio,f.state.identity.bio);assert.equal(store.get('save'),vault);assert.equal(store.get('saveContacts'),contacts);
 assert.match(await page.locator('#rename').textContent(),/Local alias/);assert.match(await page.locator('#app').textContent(),/Identity update/);assert.doesNotMatch(await page.locator('#app').textContent(),/−0 NUMN/);checks.push('English edit preserves other fields/local alias/vault; HTML is escaped and avatars not fetched; disk failure blocks broadcast; successful mock journal labels Identity');
 await page.locator('#identity').click();await page.locator('#editIdentity').click();await page.locator('#identity-display').fill('Duplicate attempt');await page.locator('#identityPublic').check();await page.locator('#prepareIdentity').click();await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('previous'));assert.equal(f.state.submits.length,1);await page.locator('#back').click();await page.locator('#editIdentity').waitFor();await page.locator('#back').click();
 hold=true;await page.locator('#identity').click();for(let i=0;i<100&&!release;i++)await page.waitForTimeout(20);assert.ok(release);await page.evaluate(()=>window.appBackground());hold=false;release();await page.locator('#unlockPassword').waitFor();await page.waitForTimeout(150);assert.equal(await page.locator('#editIdentity').count(),0);checks.push('pending Identity blocks another operation; late profile response cannot reopen locked wallet');
 store.set('save',await encryptVault(addWatchWallet(null,f.bob),PASSWORD));store.set('saveHistory','');store.set('saveContacts','');await page.reload();await page.locator('#unlockPassword').fill(PASSWORD);await page.locator('#unlock').click();await page.locator('#identity').click();await page.locator('#editIdentity').waitFor();assert.equal(await page.locator('#editIdentity').isDisabled(),true);assert.match(await page.locator('#identityProfile').textContent(),/Watch-only/);checks.push('watch-only address can view on-chain fields but cannot edit');
 assert.deepEqual(errors,[]);const report={version:VERSION,checkedAt:new Date().toISOString(),passed:true,checks,mockedBroadcasts:1,realBroadcasts:0};await writeFile('evidence/identity-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.close();}
