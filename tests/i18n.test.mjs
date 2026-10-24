import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {EN} from '../i18n-en.mjs';
import {t,setLanguage,getLanguage,locale,staticParts} from '../i18n.mjs';
import {parseAmount,validatePassword,validateRecipient,formatAmount} from '../core.mjs';
import {POOL_WALLETS} from '../transfers.mjs';
const require=createRequire(import.meta.url);
const {babelParse,traverse}=require('../node_modules/playwright/lib/transform/babelBundle.js');
const root=new URL('../',import.meta.url),cyr=/[А-Яа-яЁё]/;

test('English catalog is complete for source literals, native dialogs and generated assets',()=>{
 const missing=[],unwrapped=[];let covered=0;
 function check(text){for(const part of staticParts(text)){const key=part.trim();if(cyr.test(key)){covered++;if(!Object.hasOwn(EN,key))missing.push(key);}}}
 for(const file of readdirSync(root).filter(f=>f.endsWith('.mjs')&&!f.startsWith('i18n'))){
  const ast=babelParse(readFileSync(new URL(file,root),'utf8'),file,true);
  traverse(ast,{
   StringLiteral(path){const n=path.node;if(n.value==='Русский')return;if(!cyr.test(n.value))return;check(n.value);if(path.parent.type!=='CallExpression'||path.parent.callee.name!=='t')unwrapped.push(file+':'+n.loc.start.line);},
   TemplateLiteral(path){if(!path.node.quasis.some(q=>cyr.test(q.value.cooked||'')))return;for(const q of path.node.quasis)check(q.value.cooked||'');if(path.parent.type!=='TaggedTemplateExpression'||path.parent.tag.name!=='t')unwrapped.push(file+':'+path.node.loc.start.line);},
  });
 }
 for(const file of readdirSync(new URL('android/src/xyz/diffpool/numen/',root)).filter(f=>f.endsWith('.java'))){
  const source=readFileSync(new URL('android/src/xyz/diffpool/numen/'+file,root),'utf8');
  for(const match of source.matchAll(/"(?:[^"\\]|\\.)*"/g))if(cyr.test(match[0])){check(JSON.parse(match[0]));assert.match(source.slice(Math.max(0,match.index-2),match.index),/t\($/,file+' untranslated native literal');}
 }
 assert.ok(covered>400);assert.deepEqual(missing,[]);assert.deepEqual(unwrapped,[]);
 assert.deepEqual(JSON.parse(readFileSync(new URL('web/language-en.json',root))),EN);
 for(const [key,value] of Object.entries(EN)){assert.ok(value,key);assert.ok(!cyr.test(value),key);assert.ok(!/[<>"'\r\n]/.test(value),'Translation may not introduce HTML or attribute delimiters');}
});

test('language lookup preserves HTML, whitespace and every interpolated user value',()=>{
 try{
  setLanguage('en');assert.equal(getLanguage(),'en');assert.equal(locale(),'en-US');
  const name='Мой кошелёк <script>not code</script>',amount='1.000000000000000001',address=POOL_WALLETS[0].address;
  assert.equal(t`<p>Отправитель: ${name} · ${address}</p><span>Сумма ${amount}</span>`,`<p>Sender: ${name} · ${address}</p><span>Amount ${amount}</span>`);
  assert.equal(t('<input aria-label="Слово 3" placeholder="например //0">'),'<input aria-label="Word 3" placeholder="for example //0">');
  assert.equal(t('  Оценка комиссии: \n'),'  Estimated fee: \n');
  assert.equal(t('УДАЛИТЬ'),'DELETE');assert.equal(POOL_WALLETS[1].name,'POOL · rewards');
  assert.equal(formatAmount(parseAmount(amount)),amount);
  assert.throws(()=>validatePassword('short'),/Password:/);assert.throws(()=>validateRecipient('bad'),/native NUMEN/);
  setLanguage('ru');assert.equal(t('УДАЛИТЬ'),'УДАЛИТЬ');assert.equal(POOL_WALLETS[1].name,'POOL · награды');assert.equal(locale(),'ru-RU');
  assert.throws(()=>validatePassword('short'),/Пароль:/);
  for(const input of ['',null,{},'en-US','EN','<script>'])assert.equal(setLanguage(input),'ru');
 }finally{setLanguage('ru');}
});
