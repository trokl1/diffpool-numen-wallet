// RU/EN regression with public test keys and mock transport. No real broadcasts.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {fixture,PUBLIC_SEED,PASSWORD} from './qa-fixture.mjs';
import {historyFixture} from './history-fixture.mjs';
import {VERSION} from '../config.mjs';
const f=await fixture(),history=historyFixture({mixed:true}),store=new Map(),errors=[],checks=[];
let failLanguage=false,holdLanguage=false,releaseLanguage;
const server=createServer(async(req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile('web/'+file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:360,height:850}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('nativeQA',async(action,data)=>{
  if(action==='request')return JSON.stringify({jsonrpc:'2.0',id:1,result:await f.request(data.endpoint,data.method,data.params)});
  if(action==='historyRequest')return history.request(data);
  if(action==='biometricStatus')return JSON.stringify({available:true,enabled:false});
  if(action==='importFileStatus')return 'none';
  if(['invalidate','cancelImportFile','copy','cancelBiometric','shareQr','endQrScan'].includes(action))return 'ok';
  if(action==='beginQrScan')throw Error('Camera unavailable in this test');
  if(action.startsWith('load'))return store.get(action.replace('load','save'))||'';
  if(action.startsWith('save')){
   if(action==='saveLanguage'){assert.ok(['ru','en'].includes(data));if(failLanguage)throw Error('LANGUAGE_WRITE_FAILED');if(holdLanguage)await new Promise(r=>releaseLanguage=r);}
   if(action==='save'){assert.equal(data.previous,store.get('save')||'');data=data.encrypted;}
   store.set(action,data);return 'ok';
  }
  throw Error('Unexpected native action '+action);
 });
 await page.addInitScript(()=>{window.Android={call:(id,action,json)=>window.nativeQA(action,JSON.parse(json)).then(value=>window.nativeResult(id,true,value),e=>window.nativeResult(id,false,e.message))};});
 const url=`http://127.0.0.1:${server.address().port}`;
 const change=async language=>{await page.locator('#language').selectOption(language);await page.waitForFunction(language=>document.documentElement.lang===language&&document.querySelector('#language')?.value===language&&!document.querySelector('#language').disabled,language);};
 const english=async()=>{
  const text=await page.locator('#app').evaluate(node=>{const clone=node.cloneNode(true);clone.querySelectorAll('.language-picker,[data-secret],.wallet-name').forEach(e=>e.remove());return clone.textContent;});
  assert.ok(!/[А-Яа-яЁё]/.test(text.replaceAll('Мой Русский кошелёк','')),text);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'screen must fit mobile width');
 };
 await page.goto(url);await page.locator('#create').waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'ru');
 await change('en');await english();assert.equal(await page.locator('#create').textContent(),'Create a new wallet');
 await page.locator('#create').click();await english();assert.equal(await page.locator('#word3').getAttribute('aria-label'),'Word 3');await page.locator('#back').click();
 await page.locator('#importKeyStart').click();await english();await page.locator('#back').click();
 await page.locator('#watchStart').click();await english();await page.locator('#back').click();checks.push('welcome, create, key import and watch forms localized before first unlock');
 await page.locator('#import').click();await page.locator('#seed').fill(PUBLIC_SEED);await page.locator('#name').fill('Мой Русский кошелёк');await page.locator('#password').fill(PASSWORD);await page.locator('#repeat').fill('wrong');await page.locator('#backupCheck').check();await page.locator('#saveWallet').click();
 await page.waitForFunction(()=>document.querySelector('#message')?.textContent==='Passwords do not match.');
 await page.locator('#password').fill(PASSWORD);await page.locator('#repeat').fill(PASSWORD);await page.locator('#saveWallet').click();await page.locator('#walletSelect').waitFor();
 await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('Balance checked'));
 await english();if((await page.locator('#autoBalance').textContent()).includes('on,'))await page.locator('#autoBalance').click();
 const vault=store.get('save'),contacts=store.get('saveContacts');
 await page.locator('#settings').click();await page.locator('#settingsPassword').fill(PASSWORD);await change('ru');assert.equal(await page.locator('#settingsPassword').inputValue(),'');await change('en');await english();
 failLanguage=true;await page.locator('#language').selectOption('ru');await page.waitForFunction(()=>document.querySelector('#message')?.textContent==='LANGUAGE_WRITE_FAILED');assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('#language').inputValue(),'en');failLanguage=false;
 assert.equal(store.get('save'),vault);assert.equal(store.get('saveContacts'),contacts);checks.push('language changes do not rewrite vault/contact data, clear password inputs and roll back on write failure');
 await mkdir('evidence',{recursive:true});await page.screenshot({path:'evidence/language-settings-en.png',fullPage:true});
 await page.locator('#back').click();assert.match(await page.locator('#rename').textContent(),/Мой Русский кошелёк/);
 await page.locator('#receive').click();await english();assert.equal(await page.locator('.address').textContent(),f.alice);await page.locator('#back').click();
 await page.locator('#incoming').click();await page.waitForFunction(()=>document.querySelectorAll('#networkRows details').length>0);await english();await page.locator('#rewardsTab').click();await page.waitForFunction(()=>document.querySelectorAll('#networkRows details').length>0);await english();await page.locator('#back').click();
 await page.locator('#contacts').click();await english();await page.locator('#back').click();await page.locator('#history').click();await english();await page.locator('#back').click();
 await page.locator('#send').click();await page.locator('#recipient').fill(f.bob);await page.locator('#amount').fill('1');await page.locator('#prepare').click();await page.locator('#confirmPassword').waitFor();await english();assert.ok((await page.locator('dl').textContent()).includes(f.bob));
 await page.locator('#sendPassword').fill(PASSWORD);await page.locator('#confirmPassword').click();await page.locator('#walletSelect').waitFor();assert.equal(f.state.submits.length,1);assert.equal(f.state.submits[0].amount,'1000000000000000000');await english();checks.push('English receive, history, contacts and signed mock transfer; address/amount unchanged');
 await page.locator('#settings').click();holdLanguage=true;await page.locator('#language').selectOption('ru');for(let i=0;i<100&&!releaseLanguage;i++)await page.waitForTimeout(25);assert.ok(releaseLanguage);await page.evaluate(()=>window.appBackground());holdLanguage=false;releaseLanguage();await page.locator('#unlockPassword').waitFor();await page.waitForTimeout(200);assert.equal(await page.locator('#walletSelect').count(),0);
 await page.reload();await page.locator('#unlockPassword').waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'ru');await change('en');await page.reload();await page.locator('#unlockPassword').waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'en');await english();checks.push('late preference save cannot reopen locked wallet; language survives full reload');
 await page.locator('#unlockPassword').fill(PASSWORD);await page.locator('#unlock').click();await page.locator('#walletSelect').waitFor();await page.locator('#settings').click();await page.locator('#settingsPassword').fill(PASSWORD);await page.locator('#showSeed').click();await page.locator('#backupSeed').waitFor();assert.equal(await page.locator('#backupSeed').textContent(),PUBLIC_SEED);await english();assert.equal(await page.locator('#backupSeed').getAttribute('aria-hidden'),'true');checks.push('translated recovery warning preserves secret and clipboard/AX protections');
 assert.deepEqual(errors,[]);const report={version:VERSION,checkedAt:new Date().toISOString(),passed:true,languages:['ru','en'],checks,mockedBroadcasts:1,realBroadcasts:0};await writeFile('evidence/language-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.close();}
