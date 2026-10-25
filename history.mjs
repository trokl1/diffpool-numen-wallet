import {t} from './i18n.mjs';
import { validateRecipient } from './core.mjs';
import { NETWORK } from './config.mjs';
import {validateIdentity} from './identity.mjs';
export const PENDING=new Set(['submitted','unknown']);
export function readHistory(raw){
  if(!raw)return [];
  const data=JSON.parse(raw);
  if(data.v!==1||!Array.isArray(data.entries)||data.entries.length>500)throw Error(t('Журнал отправок повреждён. Отправка заблокирована.'));
  const seen=new Set();
  for(const row of data.entries){
    validateRecipient(row.address);validateRecipient(row.recipient);
    if(row.kind!==undefined&&row.kind!=='identity')throw Error(t('Неподдерживаемый тип операции.'));
    if(row.kind==='identity'){
      validateIdentity(row.info);
      if(row.recipient!==row.address||row.amount!=='0'||!/^\d{1,39}$/.test(row.deposit)||! /^-?\d{1,39}$/.test(row.depositDelta))throw Error(t('Повреждена запись Identity в журнале.'));
    }
    if(row.genesis!==NETWORK.genesis||!/^0x[0-9a-f]{64}$/.test(row.id)||seen.has(row.id)||!['unknown','submitted','finalized','failed','expired'].includes(row.status))throw Error(t('Повреждён журнал отправок.'));
    for(const field of ['amount','fee','feeBudget','nonce'])if(!/^\d{1,40}$/.test(row[field]))throw Error(t('Неверная сумма/nonce в журнале.'));
    for(const field of ['height','expiry','scanHeight','createdAt'])if(!Number.isSafeInteger(row[field])||row[field]<0)throw Error(t('Неверная высота в журнале.'));
    if(row.expiry!==row.height+64||row.scanHeight<row.height-1||row.scanHeight>row.expiry)throw Error(t('Неверный диапазон проверки журнала.'));
    seen.add(row.id);
  }
  return data.entries;
}
export function writeHistory(entries){return JSON.stringify({v:1,entries:readHistory(JSON.stringify({v:1,entries}))});}
export async function submitOnce(chain,signed,entries,persist){
  if(entries.some(e=>e.id===signed.hash||e.address===signed.record.address&&PENDING.has(e.status)))throw Error(t('Уже есть ожидающая отправка.'));
  if(entries.length>=500)throw Error(t('Журнал заполнен; сначала экспортируйте и обслужите историю.'));
  const next=[signed.record,...entries];
  // Persist BEFORE network I/O. A crash/timeout must never silently free the nonce.
  await persist(writeHistory(next));
  try{await chain.broadcast(signed);}catch(error){return {entries:next,unknown:true,error:error.message};}
  const submitted=next.map(e=>e.id===signed.hash?{...e,status:'submitted'}:e);
  try{await persist(writeHistory(submitted));}catch{return {entries:next,unknown:true,error:t('RPC принял перевод, но обновить журнал не удалось. Проверьте хеш.')};}
  return {entries:submitted,unknown:false};
}
