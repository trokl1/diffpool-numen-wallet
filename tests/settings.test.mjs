import test from 'node:test';
import assert from 'node:assert/strict';
import {walletSettings} from '../settings.mjs';
import {NETWORK} from '../config.mjs';

test('new and legacy wallets enable auto refresh once',()=>{
  for(const input of [{},{autoRefresh:false},{autoRefresh:true}]) {
    const next=walletSettings(input);
    assert.equal(next.autoRefresh,true);
    assert.equal(next.autoRefreshVersion,1);
    assert.equal(next.endpoint,NETWORK.rpc);
    assert.deepEqual(walletSettings(next),next);
  }
});
test('explicit OFF after migration persists without changing RPC or selection',()=>{
  const input={endpoint:'https://wallet.example/rpc',selectedAddress:'selected',autoRefresh:false,autoRefreshVersion:1};
  assert.deepEqual(walletSettings(input),input);
  assert.throws(()=>walletSettings({...input,endpoint:'http://wallet.example'}));
});
