import {t} from './i18n.mjs';
import {validateRecipient} from './core.mjs';
export const CONTACT_LIMIT=500;
export function contactName(value){
 const name=String(value).normalize('NFC').trim().replace(/\s+/g,' ');
 if(!name||Array.from(name).length>60||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name))throw Error(t('Название: от 1 до 60 символов без управляющих знаков.'));
 return name;
}
export function readContacts(raw){
 if(!raw)return [];
 const data=JSON.parse(raw);
 if(data.v!==1||!Array.isArray(data.entries)||data.entries.length>CONTACT_LIMIT)throw Error(t('Неверный формат адресной книги.'));
 const entries=[],seen=new Set();
 for(const row of data.entries){
  const address=validateRecipient(row.address),name=contactName(row.name);
  if(seen.has(address))throw Error(t('Повторяющийся адрес в книге.'));seen.add(address);entries.push({address,name});
 }
 return entries;
}
export function writeContacts(entries){return JSON.stringify({v:1,entries:readContacts(JSON.stringify({v:1,entries}))});}
export function saveContact(entries,name,address,original=null){
 const entry={name:contactName(name),address:validateRecipient(address)};
 if(original!==null&&!entries.some(row=>row.address===original))throw Error(t('Запись уже удалена.'));
 if(entries.some(row=>row.address===entry.address&&row.address!==original))throw Error(t('Этот адрес уже сохранён. Откройте его для изменения названия.'));
 const next=entries.filter(row=>row.address!==original);
 if(next.length>=CONTACT_LIMIT)throw Error(t('Можно сохранить не больше 500 адресов.'));
 return [...next,entry];
}
export function deleteContact(entries,address){return entries.filter(row=>row.address!==address);}
