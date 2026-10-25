// Offline layout regression: public watch-only fixture, no network or signing.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {initCrypto,addWatchWallet,encryptVault,formatAmount} from '../core.mjs';
import {NETWORK,VERSION,DONATION_ADDRESS} from '../config.mjs';
await initCrypto();
const password='public-test-password',store=new Map(),errors=[],cases=[];
store.set('save',await encryptVault(addWatchWallet(null,DONATION_ADDRESS),password));
store.set('saveSettings',JSON.stringify({autoRefresh:false,autoRefreshVersion:1}));
const server=createServer(async(req,res)=>{
 const file=req.url==='/'?'index.html':req.url.slice(1);
 if(!['index.html','app.js','style.css'].includes(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile('web/'+file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:360,height:850}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('nativeQA',async(action,data)=>{
  if(action==='biometricStatus')return JSON.stringify({available:false,enabled:false});
  if(action==='importFileStatus')return 'none';
  if(['invalidate','cancelImportFile','cancelBiometric','endQrScan'].includes(action))return 'ok';
  if(action.startsWith('load'))return store.get(action.replace('load','save'))||'';
  if(action.startsWith('save')){store.set(action,data);return 'ok';}
  throw Error('Unexpected action (no network or signing allowed): '+action);
 });
 await page.addInitScript(()=>{window.Android={call:(id,action,json)=>window.nativeQA(action,JSON.parse(json)).then(v=>window.nativeResult(id,true,v),e=>window.nativeResult(id,false,e.message))};});
 await mkdir('evidence',{recursive:true});
 for(const [free,label] of [
  ['1234567890123456789012345','≈ 1234567.890123'],
  [((1n<<128n)-1n).toString(),'≈ 340282366920938463463'],
  ['1','0.000000000000000001'],
  ['100000000000000000000','100'],
  ['0','0'],
 ]){
  store.set('saveCache',JSON.stringify({address:DONATION_ADDRESS,endpoint:NETWORK.rpc,genesis:NETWORK.genesis,free,available:free,height:100,finalizedHeight:100,updatedAt:Date.now()}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#unlockPassword').fill(password);await page.locator('#unlock').click();await page.locator('#balanceValue').waitFor();
  assert.equal(await page.locator('#balanceValue').textContent(),label);
  assert.equal(await page.locator('#balanceDetails').getAttribute('open'),null);
  await page.locator('#balanceDetails summary').click();assert.equal(await page.locator('#exactBalance').textContent(),formatAmount(free)+' NUMN');
  for(const width of [320,360,412,768]){
   await page.setViewportSize({width,height:850});
   const fit=await page.evaluate(()=>{
    const balance=document.querySelector('#balance'),card=document.querySelector('.wallet-overview'),text=document.querySelector('#balanceValue'),range=document.createRange();range.selectNodeContents(text);
    const box=balance.getBoundingClientRect(),cardBox=card.getBoundingClientRect();
    return {page:document.documentElement.scrollWidth<=innerWidth,heading:balance.scrollWidth<=balance.clientWidth,
     text:[...range.getClientRects()].every(r=>r.left>=box.left-1&&r.right<=box.right+1),card:card.scrollWidth<=card.clientWidth,
     withinCard:box.left>=cardBox.left&&box.right<=cardBox.right,font:getComputedStyle(balance).fontSize};
   });
   assert.ok(fit.page&&fit.heading&&fit.text&&fit.card&&fit.withinCard,JSON.stringify({free,width,fit}));cases.push({free,width,label,font:fit.font});
  }
  if(free==='1234567890123456789012345'){await page.setViewportSize({width:320,height:850});await page.locator('.wallet-overview').screenshot({path:'evidence/balance-large-320.png'});}
 }
 await page.locator('#settings').click();await page.locator('#language').selectOption('en');await page.waitForFunction(()=>document.documentElement.lang==='en');await page.locator('#back').click();assert.equal(await page.locator('#balanceDetails summary').textContent(),'Exact balance');
 assert.deepEqual(errors,[]);const report={version:VERSION,checkedAt:new Date().toISOString(),passed:true,networkRequests:0,realBroadcasts:0,cases};await writeFile('evidence/balance-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify({version:VERSION,passed:true,cases:cases.length,networkRequests:0},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
