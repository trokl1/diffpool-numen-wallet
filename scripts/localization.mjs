// Generate the native catalog from the same reviewed source used by JavaScript.
import {writeFile} from 'node:fs/promises';
import {EN} from '../i18n-en.mjs';
for(const [source,translated] of Object.entries(EN)){
  if(!source||typeof translated!=='string'||!translated||/[А-Яа-яЁё]/.test(translated))throw Error('Incomplete English translation: '+source);
  if(/[<>"'\r\n]/.test(translated))throw Error('Unsafe static HTML translation: '+source);
}
await writeFile('web/language-en.json',JSON.stringify(EN));
console.log('English catalog: '+Object.keys(EN).length+' phrases');
