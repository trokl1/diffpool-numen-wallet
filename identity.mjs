import {t} from './i18n.mjs';
import {compactAddLength,u8aConcat,u8aToHex} from '@polkadot/util';

// NUMEN runtime-v10000 IdentityInfo, not Substrate's generic Data enum.
// Order/bounds reviewed against runtime/src/identity_info.rs and pinned metadata.
export const IDENTITY_FIELDS=Object.freeze([
  ['display',32],['avatar',128],['bio',2048],['web',64],['email',32],
  ['github',32],['matrix',32],['x',32],['telegram',32],['discord',32],
].map(([key,limit])=>Object.freeze({key,limit})));
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export const emptyIdentity=()=>Object.fromEntries(IDENTITY_FIELDS.map(({key})=>[key,'']));
export function validateIdentity(info){
  if(!info||typeof info!=='object'||Array.isArray(info)||Object.keys(info).length!==IDENTITY_FIELDS.length||IDENTITY_FIELDS.some(({key})=>!Object.hasOwn(info,key)))
    throw Error(t('Неверный состав полей Identity. Обновите профиль из сети.'));
  const result={};
  for(const {key,limit} of IDENTITY_FIELDS){
    const value=info[key];
    if(typeof value!=='string'||encoder.encode(value).length>limit||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)||key!=='bio'&&/[\t\n]/.test(value)||decoder.decode(encoder.encode(value))!==value)
      throw Error(t`Identity: недопустимый текст или превышен лимит UTF-8 для поля ${key} (${limit}).`);
    result[key]=value;
  }
  return result;
}
export function identityBytes(info){const checked=validateIdentity(info);return u8aConcat(...IDENTITY_FIELDS.map(({key})=>compactAddLength(encoder.encode(checked[key]))));}
export const identityHex=info=>u8aToHex(identityBytes(info));
export function identityArgs(info){const checked=validateIdentity(info);return Object.fromEntries(IDENTITY_FIELDS.map(({key})=>[key,u8aToHex(encoder.encode(checked[key]))]));}
export function expectedIdentityCall(info){return u8aToHex(u8aConcat(new Uint8Array([8,1]),identityBytes(info)));}
export function assertIdentityCall(tx,info){
  if(tx.method.toHex()!==expectedIdentityCall(info))throw Error(t('RPC изменил вызов или поля Identity. Подпись запрещена.'));
}
export function identityDeposit(info,basic,perByte){
  for(const value of [basic,perByte])if(!/^\d{1,39}$/.test(String(value))||BigInt(value)>=(1n<<128n))throw Error(t('Неверные параметры залога Identity.'));
  const deposit=BigInt(basic)+BigInt(perByte)*BigInt(identityBytes(info).length);
  if(deposit>=(1n<<128n))throw Error(t('Неверные параметры залога Identity.'));
  return deposit;
}
export function decodeIdentity(registration){
  if(registration.isNone)return {exists:false,info:emptyIdentity(),deposit:'0',judgements:[],fingerprint:registration.toHex()};
  const record=registration.unwrap(),info={};
  try{for(const {key,limit} of IDENTITY_FIELDS){const bytes=record.info[key].toU8a(true);if(bytes.length>limit)throw Error();info[key]=decoder.decode(bytes);}}
  catch{throw Error(t('Identity содержит неподдерживаемые данные. Редактирование заблокировано, чтобы не потерять поля.'));}
  validateIdentity(info);
  if(record.info.toHex()!==identityHex(info))throw Error(t('Неверный состав полей Identity. Обновите профиль из сети.'));
  // Never claim a self-declared name is unique or verified just because it exists.
  const judgements=record.judgements.toJSON();
  if(!Array.isArray(judgements)||judgements.length>1000)throw Error(t('Неверный ответ Identity.'));
  return {exists:true,info,deposit:record.deposit.toString(),judgements,fingerprint:registration.toHex()};
}
