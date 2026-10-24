import {t} from './i18n.mjs';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate, mnemonicValidate, decodeAddress, encodeAddress, blake2AsHex } from '@polkadot/util-crypto';
import { NETWORK } from './config.mjs';

export const UNIT = 10n ** 18n;
export const initCrypto = cryptoWaitReady;
export function newMnemonic() { return mnemonicGenerate(12); }
export function normalizeMnemonic(value) {
  const words = String(value).normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');
  if (![12,15,18,21,24].includes(words.split(' ').length) || !mnemonicValidate(words))
    throw Error(t('Неверная seed-фраза NUMEN/Substrate. Проверьте слова и порядок.'));
  return words;
}
export function validatePath(value = '') {
  // No secret URI passwords or arbitrary seed encodings hidden in the path field.
  if (!/^(?:\/{1,2}[a-zA-Z0-9_-]{1,32}){0,8}$/.test(value)) throw Error(t('Путь: например //0 или //1. Поле можно оставить пустым.'));
  return value;
}
export function deriveAccount(mnemonic, path = '') {
  return new Keyring({ type: 'sr25519', ss58Format: NETWORK.ss58 })
    .addFromUri(normalizeMnemonic(mnemonic) + validatePath(path));
}
export function walletEntry(mnemonic,path='') {
  const words=normalizeMnemonic(mnemonic),derivation=validatePath(path),pair=deriveAccount(words,derivation);
  try{return {mnemonic:words,path:derivation,address:pair.address};}finally{pair.lock();}
}
export function seedEntry(value,path='') {
  if(typeof value!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(value.trim()))throw Error(t('secretSeed: нужны ровно 32 байта (0x и 64 hex-символа), не publicKey и не 64-байтный secretKey.'));
  const secretSeed=value.trim().toLowerCase(),derivation=validatePath(path),pair=new Keyring({type:'sr25519',ss58Format:NETWORK.ss58}).addFromUri(secretSeed+derivation);
  try{return {type:'sr25519',secretSeed,path:derivation,address:pair.address};}finally{pair.lock();}
}
function uriEntry(value){
  if(typeof value!=='string'||value.length>1024)throw Error(t('Неверный формат секрета.'));
  const text=value.trim(),slash=text.indexOf('/'),base=slash<0?text:text.slice(0,slash),path=slash<0?'':text.slice(slash);
  validatePath(path);return base.startsWith('0x')?seedEntry(base,path):walletEntry(base,path);
}
export function importKey(value,expectedAddress=''){
  if(typeof value!=='string'||new TextEncoder().encode(value).length>16384)throw Error(t('Файл ключа должен быть не больше 16 КБ.'));
  const text=value.trim();let entry,doc=null;
  if(text.startsWith('{')){
    try{doc=JSON.parse(text);}catch{throw Error(t('Некорректный JSON кошелька.'));}
    if(!doc||typeof doc!=='object'||Array.isArray(doc))throw Error(t('Нужен JSON-объект кошелька.'));
    if('encoded' in doc||'encoding' in doc)throw Error(t('Зашифрованный Polkadot JSON пока не поддерживается. Нужен наш signer JSON с secretPhrase/secretSeed.'));
    for(const field of ['type','cryptoType'])if(doc[field]!=null&&doc[field]!=='sr25519')throw Error(t('Поддерживается только sr25519.'));
    for(const field of ['genesis','genesisHash'])if(doc[field]!=null&&doc[field]!==NETWORK.genesis)throw Error(t('JSON относится к другой сети.'));
    if(doc.ss58Format!=null&&doc.ss58Format!==NETWORK.ss58)throw Error(t('Неверный SS58-префикс.'));
    const phrase=doc.secretPhrase==null?null:uriEntry(doc.secretPhrase),seed=doc.secretSeed==null?null:seedEntry(doc.secretSeed);
    if(!phrase&&!seed)throw Error(t('В JSON нет secretPhrase или secretSeed. Адрес/publicKey не даёт права отправки.'));
    if(phrase&&seed&&phrase.address!==seed.address)throw Error(t('secretPhrase и secretSeed дают разные адреса. Импорт отменён.'));
    entry=phrase||seed;
    for(const field of ['ss58Address','address'])if(doc[field]!=null&&validateRecipient(doc[field])!==entry.address)throw Error(t('Ключ не соответствует адресу в JSON.'));
    if(doc.publicKey!=null){
      if(typeof doc.publicKey!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(doc.publicKey)||encodeAddress(doc.publicKey,NETWORK.ss58)!==entry.address)throw Error(t('Ключ не соответствует publicKey в JSON.'));
    }
  }else entry=uriEntry(text);
  if(expectedAddress&&validateRecipient(expectedAddress)!==entry.address)throw Error(t('Импортируемый ключ относится к другому кошельку. Проверьте файл и адрес.'));
  return entry;
}
export function addKeyWallet(secret,entry){
  return normalizeSecret(secret?{...secret,wallets:[...secret.wallets.filter(e=>!(e.type==='watch'&&e.address===entry.address)),entry]}:{network:NETWORK.genesis,type:'sr25519',wallets:[entry]});
}
export function clearSecret(secret){secret?.wallets?.forEach(e=>{e.mnemonic='';e.secretSeed='';});}
export function normalizeSecret(secret) {
  if(secret.network!==NETWORK.genesis||secret.type!=='sr25519')throw Error(t('Неверная сеть/тип ключа.'));
  const entries=secret.wallets??[{mnemonic:secret.mnemonic,path:secret.path}];
  if(!Array.isArray(entries)||!entries.length||entries.length>20)throw Error(t('Допускается от 1 до 20 кошельков.'));
  const wallets=entries.map(e=>{
    if(e.type==='watch')return {type:'watch',address:validateRecipient(e.address)};
    if(e.type&&e.type!=='sr25519')throw Error(t('Неизвестный тип кошелька.'));
    if(e.secretSeed&&e.mnemonic)throw Error(t('Неоднозначный формат ключа.'));
    const entry=e.secretSeed?seedEntry(e.secretSeed,e.path):walletEntry(e.mnemonic,e.path);if(e.address&&e.address!==entry.address)throw Error(t('Адрес не соответствует ключу.'));return entry;
  });
  if(new Set(wallets.map(w=>w.address)).size!==wallets.length)throw Error(t('Повторяющийся кошелёк.'));
  return {network:NETWORK.genesis,type:'sr25519',wallets};
}
export function addWallet(secret,mnemonic,path='') {
  const entry=walletEntry(mnemonic,path);
  // Importing the matching phrase upgrades a watch entry, without a duplicate address.
  return addKeyWallet(secret,entry);
}
export function addWatchWallet(secret,address) {
  const entry={type:'watch',address:validateRecipient(address)};
  return normalizeSecret(secret?{...secret,wallets:[...secret.wallets,entry]}:{network:NETWORK.genesis,type:'sr25519',wallets:[entry]});
}
export function pairForWallet(secret,address) {
  const wallet=secret.wallets.find(e=>e.address===address);
  if(!wallet||wallet.type==='watch')throw Error(t('Только просмотр: ключ выбранного кошелька отсутствует.'));
  if(wallet.secretSeed){const checked=seedEntry(wallet.secretSeed,wallet.path);if(checked.address!==address)throw Error(t('Ключ не соответствует выбранному адресу.'));return new Keyring({type:'sr25519',ss58Format:NETWORK.ss58}).addFromUri(checked.secretSeed+checked.path);}
  const pair=deriveAccount(wallet.mnemonic,wallet.path);if(pair.address!==address){pair.lock();throw Error(t('Ключ не соответствует выбранному адресу.'));}return pair;
}
export function validateRecipient(value) {
  const address = String(value).trim();
  try {
    const key = decodeAddress(address, false, NETWORK.ss58);
    if (key.length !== 32 || encodeAddress(key, NETWORK.ss58) !== address) throw Error();
    return address;
  } catch { throw Error(t('Нужен родной адрес NUMEN nu… с верной контрольной суммой, не 0x/EVM.')); }
}
export function parseAmount(value) {
  const text = String(value).trim().replace(',', '.');
  if (!/^(0|[1-9]\d{0,20})(?:\.\d{1,18})?$/.test(text)) throw Error(t('Сумма: положительное число, не более 18 знаков после точки.'));
  const [integer, fraction = ''] = text.split('.');
  const amount = BigInt(integer) * UNIT + BigInt(fraction.padEnd(18, '0'));
  if (amount <= 0n || amount >= 2n ** 128n) throw Error(t('Сумма вне допустимого диапазона.'));
  return amount;
}
export function formatAmount(value) {
  const n = BigInt(value), sign = n < 0n ? '-' : '', abs = n < 0n ? -n : n;
  const fraction = (abs % UNIT).toString().padStart(18, '0').replace(/0+$/, '');
  return `${sign}${abs / UNIT}${fraction ? '.' + fraction : ''}`;
}
export function spendable({ free, frozen = '0', miscFrozen = '0', feeFrozen = '0' }, existentialDeposit) {
  const reserve = [frozen, miscFrozen, feeFrozen, existentialDeposit].map(BigInt).reduce((a,b) => a > b ? a : b);
  const available = BigInt(free) - reserve;
  return available > 0n ? available : 0n;
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) throw Error(t('Пароль: от 10 до 256 символов.'));
}
const encoder = new TextEncoder(), decoder = new TextDecoder();
const toHex = bytes => Array.from(bytes, x => x.toString(16).padStart(2,'0')).join('');
function fromHex(value, length) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value) || (length && value.length !== length * 2)) throw Error(t('Хранилище повреждено.'));
  return Uint8Array.from(value.match(/../g), x => parseInt(x,16));
}
async function vaultKey(password, salt) {
  validatePassword(password);
  const data = encoder.encode(password);
  try {
    const key = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations:600000}, key, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
  } finally { data.fill(0); }
}
export async function encryptVault(secret, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await vaultKey(password,salt), plain = encoder.encode(JSON.stringify(secret));
  try {
    const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('DiffPool NUMEN vault v1')}, key, plain);
    return JSON.stringify({v:1,kdf:'pbkdf2-sha256-600000',salt:toHex(salt),iv:toHex(iv),cipher:toHex(new Uint8Array(encrypted))});
  } finally { plain.fill(0); }
}
export async function decryptVault(raw, password) {
  try {
    if (raw.length > 32000) throw Error();
    const data = JSON.parse(raw);
    if (data.v !== 1 || data.kdf !== 'pbkdf2-sha256-600000') throw Error();
    const key = await vaultKey(password,fromHex(data.salt,16));
    const plain = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromHex(data.iv,12),additionalData:encoder.encode('DiffPool NUMEN vault v1')},key,fromHex(data.cipher)));
    try {
      return normalizeSecret(JSON.parse(decoder.decode(plain)));
    } finally { plain.fill(0); }
  } catch { throw Error(t('Неверный пароль или повреждённое хранилище.')); }
}
export function intentHash(value) { return blake2AsHex(encoder.encode(JSON.stringify(value)),256); }
