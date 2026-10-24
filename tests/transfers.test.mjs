import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initCrypto,addWallet,addWatchWallet,normalizeSecret,pairForWallet,encryptVault,decryptVault} from '../core.mjs';
import {TransferHistory,POOL_WALLETS,parseMeta,parsePage,decodeHistoryResponse,rememberPage,readTransferCache,writeTransferCache,historyStale} from '../transfers.mjs';
import {historyFixture,meta} from '../scripts/history-fixture.mjs';
await initCrypto();const address=POOL_WALLETS[0].address,phrase='bottom drive obey lake curtain smoke basket hold race lonely fit walk';
test('watch-only vault, legacy migration and explicit matching-key upgrade',async()=>{
  const old=addWallet(null,phrase),legacy=JSON.stringify(old),mixed=addWatchWallet(old,address);
  assert.deepEqual(normalizeSecret(JSON.parse(legacy)),old);
  assert.equal(mixed.wallets[1].type,'watch');assert.throws(()=>pairForWallet(mixed,address),/Только просмотр/);
  assert.throws(()=>addWatchWallet(mixed,address));assert.throws(()=>addWatchWallet(old,'nuinvalid'));
  const raw=await encryptVault(mixed,'public-test-password');assert.deepEqual(await decryptVault(raw,'public-test-password'),mixed);
  const watch=addWatchWallet(null,old.wallets[0].address),upgraded=addWallet(watch,phrase);
  assert.equal(upgraded.wallets.length,1);assert.equal(pairForWallet(upgraded,upgraded.wallets[0].address).address,old.wallets[0].address);
  assert.throws(()=>normalizeSecret({...old,wallets:[{...old.wallets[0],type:'unknown'}]}));
});
test('history keyset pages include all same-block batch recipients once, exact amounts',async()=>{
  const fixture=historyFixture(),api=new TransferHistory(fixture.request),anchor=await api.meta(),ids=[];let cursor=null;
  do{const page=await api.page(address,'transfers',anchor,cursor);assert.ok(page.rows.length<=20);ids.push(...page.rows.map(r=>r.id));assert.equal(page.rows[0].amount,'1000000000000000001');cursor=page.next;}while(cursor);
  assert.equal(ids.length,45);assert.equal(new Set(ids).size,45);assert.equal(fixture.state.calls.length,4);
  for(const r of fixture.state.calls.slice(1)){assert.equal(r.variables.anchor,300);assert.equal(r.operation,'transfers');assert.ok(!('offset' in r.variables));}
});
test('history rejects wrong network, address scope, order, unfinalized and changed anchor',async()=>{
  const anchor=parseMeta(meta),fixture=historyFixture(),api=new TransferHistory(fixture.request);
  assert.throws(()=>parseMeta({...meta,genesis:[{hash:'0x'+'00'.repeat(32)}]}));
  const page=await api.page(address,'transfers',anchor),request=fixture.state.calls.at(-1),good=decodeHistoryResponse(await fixture.request(request));
  for(const mutate of [d=>d.rows[0].to.id=d.rows[0].from.id,d=>d.rows[0].block.finalized=false,d=>d.rows[0].amount='1.5',d=>d.rows.reverse(),d=>d.anchorBlock[0].hash='0x'+'00'.repeat(32),d=>d.rows.push(d.rows[0])]){
    const data=structuredClone(good);mutate(data);assert.throws(()=>parsePage(data,address,'transfers',anchor));
  }
  assert.equal(page.next.height,299);assert.throws(()=>decodeHistoryResponse(JSON.stringify({errors:[{message:'oops'}]})));
  assert.throws(()=>decodeHistoryResponse(' '.repeat(65537)));
});
test('mining rewards have separate paged dataset, cached pages stay bounded and scoped',async()=>{
  const fixture=historyFixture(),api=new TransferHistory(fixture.request),anchor=await api.meta();
  const page=await api.page(address,'rewards',anchor),next=await api.page(address,'rewards',anchor,page.next);
  assert.equal(page.rows.length,20);assert.equal(next.rows.length,5);assert.equal(page.rows[0].reward,'16000000000000000000');
  assert.deepEqual(readTransferCache(writeTransferCache([page])),[page]);
  const transfers=await api.page(POOL_WALLETS[1].address,'transfers',anchor),pages=rememberPage([page],transfers);
  assert.equal(pages.length,2);assert.equal(rememberPage(pages,transfers).length,2);
  assert.deepEqual(readTransferCache(writeTransferCache(pages)),pages);
  const corrupt=JSON.parse(writeTransferCache(pages));corrupt.pages[0].rows[0].to=address;assert.throws(()=>readTransferCache(JSON.stringify(corrupt)));
  fixture.state.offline=true;await assert.rejects(api.page(address,'rewards',anchor));assert.equal(page.rows.length,20);
});
test('fixed query assets keep network history bounded and read-only',async()=>{
  const queries=JSON.parse(await readFile('web/history-queries.json','utf8'));
  assert.deepEqual(Object.keys(queries),['meta','transfers','incoming','outgoing','rewards']);
  for(const name of ['transfers','incoming','outgoing','rewards']){assert.match(queries[name],/limit:21/);assert.match(queries[name],/finalized_eq:true/);assert.ok(!queries[name].includes('offset'));}
  assert.match(queries.incoming,/\{to:\{id_eq:\$id\}\}/);assert.match(queries.outgoing,/\{from:\{id_eq:\$id\}\}/);
  for(const query of Object.values(queries))assert.ok(!/mutation|subscription/.test(query));
});

test('incoming/outgoing are paged at source, preserve same-block items and label self transfers once',async()=>{
  for(const kind of ['incoming','outgoing']){
    const f=historyFixture({mixed:true}),api=new TransferHistory(f.request),anchor=await api.meta();let cursor=null,rows=[];
    do{const p=await api.page(address,kind,anchor,cursor);rows.push(...p.rows);cursor=p.next;}while(cursor);
    assert.equal(rows.length,30);assert.equal(new Set(rows.map(r=>r.id)).size,30);
    assert.ok(rows.every(r=>r[kind==='incoming'?'to':'from']===address));
    assert.equal(rows.filter(r=>r.to===address&&r.from===address).length,15);
    assert.deepEqual(f.state.calls.slice(1).map(r=>r.operation),[kind,kind]);
  }
});

test('history cache keeps direction isolated and rejects opposite-direction responses',async()=>{
  const f=historyFixture({mixed:true}),api=new TransferHistory(f.request),anchor=await api.meta();let pages=[];
  for(const kind of ['transfers','incoming','outgoing'])pages=rememberPage(pages,await api.page(address,kind,anchor));
  assert.equal(pages.length,3);assert.deepEqual(readTransferCache(writeTransferCache(pages)),pages);
  const allRequest={...f.state.calls.find(r=>r.operation==='transfers')};
  const all=decodeHistoryResponse(await f.request(allRequest));
  assert.throws(()=>parsePage(all,address,'incoming',anchor));assert.throws(()=>parsePage(all,address,'outgoing',anchor));
});

test('history cache expires after one minute, including a future timestamp after clock correction',()=>{
  assert.equal(historyStale(null,100000),true);assert.equal(historyStale({updatedAt:100000},159999),false);
  assert.equal(historyStale({updatedAt:100000},160000),true);assert.equal(historyStale({updatedAt:100001},100000),true);
});
