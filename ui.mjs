import {t,getLanguage,setLanguage,locale} from './i18n.mjs';
import QRCode from 'qrcode';
import { NETWORK, VERSION, validateEndpoint } from './config.mjs';
import { initCrypto,newMnemonic,normalizeMnemonic,validatePath,validateRecipient,encryptVault,decryptVault,formatAmount,validatePassword,addWallet,addWatchWallet,pairForWallet,importKey,addKeyWallet,clearSecret } from './core.mjs';
import { TransferHistory,POOL_WALLETS,readTransferCache,writeTransferCache,rememberPage,historyStale } from './transfers.mjs';
import { readContacts,writeContacts,saveContact,contactName } from './contacts.mjs';
import { readHistory,writeHistory,submitOnce } from './history.mjs';
import { Chain } from './chain.mjs';
import { walletSettings } from './settings.mjs';
import {cameraScanner,qrRecipient} from './qr.mjs';
import { native,transport,cancelNativeCalls } from './bridge.mjs';

const $=id=>document.getElementById(id);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shorten=s=>s.slice(0,10)+'…'+s.slice(-8);
let session=0,view=0,address=null,accounts=[],vault='',cache=null,contacts=[],journal=[],journalError=false,contactsError=false;
let settings=walletSettings(),chain=null,prepared=null,biometric={available:false,enabled:false},busySend=false;
let transferPages=[];
// Only the public address survives the system picker; never retain its secret input.
let pendingImportAddress='';
let viewTimer=null,refreshing=false,lastBalanceAttempt={key:'',at:0};
let viewCleanup=null;
let idleTimer=null,secretTimer=null;
const IDLE_LOCK_MS=180000,SECRET_DISPLAY_MS=60000;
const checkView=(s,v)=>{if(s!==session||v!==view)throw Error(t('Операция отменена: экран изменился или кошелёк заблокирован.'));};
function takePassword(id){const input=$(id),value=input?.value||'';if(input)input.value='';return value;}
function touchSession(){clearTimeout(idleTimer);if(address||document.querySelector('[data-secret]'))idleTimer=setTimeout(()=>void lock(),IDLE_LOCK_MS);}
for(const name of ['pointerdown','keydown','input'])document.addEventListener(name,e=>{if(e.isTrusted)touchSession();},true);
// Native WebView independently blocks copy/cut/PROCESS_TEXT. Only public-address
// buttons use the native copy allowlist; paste remains available for imports.
for(const name of ['copy','cut'])document.addEventListener(name,e=>e.preventDefault(),true);
function protectSecrets(){
  for(const id of ['seed','keyText','word3','word9','backupSeed']){const element=$(id);if(element){element.dataset.secret='true';element.setAttribute('aria-hidden','true');element.setAttribute('autocomplete','off');element.setAttribute('spellcheck','false');}}
  touchSession();
}
function expireSecret(){clearTimeout(secretTimer);const s=session,v=view;secretTimer=setTimeout(()=>{if(s===session&&v===view)void lock();},SECRET_DISPLAY_MS);}
const qrIcon='<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 13h2v8h-6v-2M11 3v4M3 11h4M11 11h4v2h-4v4M11 21v-2"/></svg>';
const AUTO_REFRESH_MS=60000;
const alive=(s,v)=>{if(s!==session||v!==undefined&&v!==view||!address)throw Error(t('Операция отменена: кошелёк заблокирован или экран изменился.'));};
function message(text='',error=false){$('message').textContent=text;$('message').className='message'+(error?' error':'');}
function render(html){clearTimeout(viewTimer);clearTimeout(secretTimer);viewTimer=null;const cleanup=viewCleanup;viewCleanup=null;if(cleanup)cleanup();for(const e of document.querySelectorAll('input[type=password],[data-secret]')){if('value' in e)e.value='';else e.textContent='';}view++;$('app').innerHTML=html;protectSecrets();message();}
function scheduleViewRefresh(task,delay=AUTO_REFRESH_MS){
  clearTimeout(viewTimer);const s=session,v=view,owner=address;
  viewTimer=setTimeout(()=>{viewTimer=null;if(s===session&&v===view&&owner===address&&address&&!document.hidden)void task().catch(e=>{if(s===session&&v===view)message(e.message,true);});},delay);
}
function action(id,fn){const button=$(id);if(!button)return;button.onclick=async()=>{if(button.disabled)return;button.disabled=true;const s=session;try{await fn();}catch(e){if(s===session)message(e.message,true);}finally{button.disabled=false;}};}
function languagePicker(redraw){
  const label=document.createElement('label');label.className='language-picker';
  const title=document.createElement('span');title.textContent=t('Язык');
  const select=document.createElement('select');select.id='language';
  for(const [value,name] of [['ru','Русский'],['en','English']]){const option=document.createElement('option');option.value=value;option.textContent=name;option.lang=value;select.append(option);}
  select.value=getLanguage();label.append(title,select);$('app').prepend(label);
  select.onchange=async()=>{
    const previous=getLanguage(),next=select.value,s=session,v=view;select.disabled=true;
    try{await native('saveLanguage',next);checkView(s,v);setLanguage(next);redraw();message(t('Язык сохранён.'));}
    catch(e){if(s===session&&v===view){select.value=previous;message(e.message,true);}}
    finally{select.disabled=false;}
  };
}
function header(title){return t`<div class="top"><div class="brand">${esc(title)}<small>DIFFPOOL · NUMEN</small></div><button id="back" class="small secondary">Назад</button></div>`;}
function back(){action('back',()=>{prepared=null;home();});}
function getChain(){if(!chain)chain=new Chain(settings.endpoint,transport);return chain;}
async function closeChain(){const old=chain;chain=null;if(old)await old.close();}
async function persistJournal(raw){await native('saveHistory',raw);}
async function storeWallet(encrypted,nextAddress,name,adding,password,s,v){
  checkView(s,v);
  await native('save',{encrypted,previous:vault});checkView(s,v);vault=encrypted;biometric.enabled=false;
  const nextContacts=saveContact(adding?contacts:[],name,nextAddress,contacts.some(e=>e.address===nextAddress)?nextAddress:null);
  await native('saveContacts',writeContacts(nextContacts));checkView(s,v);contacts=nextContacts;
  const nextSettings={...settings,selectedAddress:nextAddress};
  await native('saveSettings',JSON.stringify(nextSettings));checkView(s,v);settings=nextSettings;
  pendingImportAddress='';await native('cancelImportFile');checkView(s,v);
  await unlock(password,false,{s,v});
}
async function bioStatus(){try{biometric=JSON.parse(await native('biometricStatus'));}catch{biometric={available:false,enabled:false};}}
function nameOf(addr){return contacts.find(c=>c.address===addr)?.name||t('Мой NUMEN');}
function watchOnly(){return accounts.find(e=>e.address===address)?.type==='watch';}
async function resumeImport(){
  const s=session,v=view;
  try{const selected=await native('importFileStatus');if(s===session&&v===view){if(selected==='selected'&&(address||!vault))keySetup(!!vault,pendingImportAddress);if(selected!=='selected')pendingImportAddress='';}}catch{/* No file picker state to restore. */}
}
function keySetup(adding=false,expected=''){
  let preview='';
  render(t`${header(t('Импорт ключа / JSON'))}<p class="muted">Наш signer JSON (secretPhrase / secretSeed) или 32-байтный secretSeed: 0x + 64 hex-символа. Всё проверяется на телефоне, без отправки ключа в сеть.</p><button id="chooseKeyFile" class="secondary">Выбрать JSON-файл</button><button id="readKeyFile" class="secondary" hidden>Прочитать выбранный JSON</button><label>JSON, seed-фраза или secretSeed<textarea id="keyText" rows="4" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="16384"></textarea></label><label>Какой кошелёк импортируем<select id="keyTarget"><option value="">Другой / сверю адрес вручную</option value="${POOL_WALLETS[0].address}">FEE DiffPool</option><option value="${POOL_WALLETS[2].address}">Личный майнинг</option></select></label><label>Ожидаемый адрес nu…<textarea id="expectedKeyAddress" rows="2" spellcheck="false">${esc(expected)}</textarea></label><label>Локальное имя<input id="keyName" maxlength="60" value="${esc(expected?nameOf(expected):t('Импорт NUMEN'))}"></label><button id="checkKey">Проверить ключ и адрес</button><p id="keyPreview" class="address"></p><label class="check"><input id="keyAddressCheck" type="checkbox">Я сверил(а) полный адрес и сохранил(а) резервную копию ключа.</label><label>${adding?t('Текущий'):t('Новый')} пароль приложения<input id="keyPassword" type="password" autocomplete="off"></label>${adding?'':t('<label>Повтор пароля<input id="keyRepeat" type="password" autocomplete="off"></label>')}<button id="saveKey" disabled>Импортировать с правом отправки</button><p class="foot">Это не перевод монет: импорт даёт приложению доступ к существующему счёту. Не импортируйте рабочий расчётный POOL-ключ без необходимости. JSON содержит секрет; не отправляйте его в чат. Зашифрованный Polkadot JSON не поддерживается.</p>`);
  const s=session,v=view;native('importFileStatus').then(value=>{if(s===session&&v===view)$('readKeyFile').hidden=value!=='selected';}).catch(()=>{});
  function invalidate(){preview='';$('keyPreview').textContent='';$('keyAddressCheck').checked=false;$('saveKey').disabled=true;}
  $('keyText').oninput=invalidate;$('expectedKeyAddress').oninput=invalidate;
  $('keyTarget').onchange=()=>{const target=$('keyTarget').value;$('expectedKeyAddress').value=target;if(target)$('keyName').value=POOL_WALLETS.find(e=>e.address===target).name;invalidate();};
  action('back',async()=>{pendingImportAddress='';await native('cancelImportFile');adding?home():welcome();});
  action('chooseKeyFile',async()=>{const expected=$('expectedKeyAddress').value.trim();pendingImportAddress=expected?validateRecipient(expected):'';await native('chooseImportFile');});
  action('readKeyFile',async()=>{const currentSession=session,currentView=view,raw=await native('readImportFile');if(currentSession!==session||currentView!==view)return;$('keyText').value=raw;$('readKeyFile').hidden=true;invalidate();message(t('Файл прочитан локально. Нажмите «Проверить ключ и адрес».'));});
  action('checkKey',()=>{const entry=importKey($('keyText').value,$('expectedKeyAddress').value.trim());try{preview=entry.address;$('keyPreview').textContent=t('Адрес из ключа: ')+preview;$('keyAddressCheck').checked=false;$('saveKey').disabled=false;}finally{entry.mnemonic='';entry.secretSeed='';}});
  action('saveKey',async()=>{
    const currentSession=session,currentView=view,entry=importKey($('keyText').value,$('expectedKeyAddress').value.trim()),name=contactName($('keyName').value);let password=takePassword('keyPassword'),old=null,next=null;
    try{
    if(entry.address!==preview||!$('keyAddressCheck').checked)throw Error(t('Сначала проверьте ключ и подтвердите полный адрес.'));
    const matches=adding||password===takePassword('keyRepeat');validatePassword(password);if(!matches)throw Error(t('Пароли не совпадают.'));if(adding&&contactsError)throw Error(t('Адресная книга повреждена.'));
      old=adding?await decryptVault(vault,password):null;checkView(currentSession,currentView);
      next=addKeyWallet(old,entry);const encrypted=await encryptVault(next,password);
      await storeWallet(encrypted,entry.address,name,adding,password,currentSession,currentView);message(t('Ключ импортирован. Отправка доступна. Биометрию после изменения хранилища нужно включить заново.'));
    }finally{password='';entry.mnemonic='';entry.secretSeed='';clearSecret(old);clearSecret(next);}
  });
}
function watchSetup(adding=false){
  render(t`${header(t('Добавить по адресу'))}<p class="muted">Только просмотр: баланс, переводы и награды. Ключи не нужны, отправка недоступна. Ключи рабочего пула лучше оставить на сервере.</p><div class="actions"><button id="feePreset" class="secondary">FEE DiffPool</button><button id="poolPreset" class="secondary">POOL · награды</button></div><label>Адрес NUMEN<textarea id="watchAddress" rows="3" spellcheck="false"></textarea></label><label>Локальное имя<input id="watchName" maxlength="60"></label><label>${adding?t('Текущий'):t('Новый')} пароль приложения<input id="watchPassword" type="password" autocomplete="off"></label>${adding?'':t('<label>Повтор пароля<input id="watchRepeat" type="password" autocomplete="off"></label>')}<button id="saveWatch">Добавить для просмотра</button><p class="foot">Имена и список адресов хранятся на телефоне. Историю увидите после нажатия соответствующей кнопки; официальный индексатор узнает запрашиваемый адрес.</p>`);
  action('back',()=>adding?home():welcome());
  ['feePreset','poolPreset'].forEach((id,i)=>action(id,()=>{$('watchAddress').value=POOL_WALLETS[i].address;$('watchName').value=POOL_WALLETS[i].name;}));
  const mine=document.createElement('button');mine.id='minerPreset';mine.className='secondary';mine.textContent=t('Личный майнинг');$('poolPreset').parentElement.after(mine);action('minerPreset',()=>{$('watchAddress').value=POOL_WALLETS[2].address;$('watchName').value=POOL_WALLETS[2].name;});
  action('saveWatch',async()=>{
    const s=session,v=view,nextAddress=validateRecipient($('watchAddress').value),name=contactName($('watchName').value);let password=takePassword('watchPassword'),secret=null,next=null;
    try{
    const matches=adding||password===takePassword('watchRepeat');validatePassword(password);if(!matches)throw Error(t('Пароли не совпадают.'));
    if(adding&&contactsError)throw Error(t('Сначала восстановите адресную книгу.'));
    secret=adding?await decryptVault(vault,password):null;checkView(s,v);next=addWatchWallet(secret,nextAddress);
    const encrypted=await encryptVault(next,password);
    await storeWallet(encrypted,nextAddress,name,adding,password,s,v);
    message(t('Адрес добавлен для просмотра. Приватный ключ не переносился. Биометрию после изменения хранилища нужно включить заново.'));
    }finally{password='';clearSecret(secret);clearSecret(next);}
  });
}

async function networkHistoryScreen(initialKind='transfers'){
  const owner=address,s=session;let kind=initialKind,current=null,anchor=null,index=0,cursors=[null],loading=false,cachedPages=[];
  const api=new TransferHistory(data=>native('historyRequest',data));
  function rowHtml(r){
    if(kind==='rewards')return t`<details class="transfer"><summary><div class="transfer-info"><strong>Блок #${r.height}</strong><small>${esc(new Date(r.timestamp).toLocaleString(locale()))}</small></div><span class="transfer-amount">+${esc(formatAmount(BigInt(r.reward)+BigInt(r.minerFees)))} NUMN</span></summary><div class="transfer-detail"><p>Награда: ${esc(formatAmount(r.reward))} NUMN<br>Комиссии майнеру: ${esc(formatAmount(r.minerFees))} NUMN</p><p class="address">${esc(r.hash)}</p><p>Финализировано по данным индексатора</p></div></details>`;
    const self=r.from===owner&&r.to===owner,incoming=r.to===owner,tx=r.extrinsic;
    return t`<details class="transfer"><summary><div class="transfer-info"><strong>${self?t('Себе'):incoming?t('Входящий'):t('Исходящий')}</strong><small>${esc(new Date(r.timestamp).toLocaleString(locale()))}</small></div><span class="transfer-amount">${self?'':incoming?'+':'−'}${esc(formatAmount(r.amount))} NUMN</span></summary><div class="transfer-detail"><p>Отправитель</p><p class="address">${esc(r.from)}</p><p>Получатель</p><p class="address">${esc(r.to)}</p><p>Блок #${r.height} · финализировано по данным индексатора</p>${tx?t`<p>Транзакция ${r.height}-${tx.index}</p><p class="address">${esc(tx.hash)}</p>${tx.fee!==null?t`<p>Комиссия всей транзакции: ${esc(formatAmount(tx.fee))} NUMN${tx.tip!==null?` · tip ${esc(formatAmount(tx.tip))}`:''}. В пакетной выплате это общая комиссия, не комиссия каждого перевода.</p>`:''}`:t('<p>Событие без подписанной транзакции</p>')}<p class="foot">ID события: ${esc(r.id)}</p></div></details>`;
  }
  function draw(){
    render(t`${header(t('История адреса'))}<p class="address">${esc(nameOf(owner))}<br>${esc(owner)}</p><div class="actions"><button id="transfersTab" ${loading||kind==='transfers'?'disabled':''}>Переводы</button><button id="rewardsTab" ${loading||kind==='rewards'?'disabled':''}>Награды блоков</button></div><p class="foot">Официальный индексатор NUMEN. Только финализированные записи, по 20 за страницу. Переводы — движения native NUMN; награды майнинга отдельно. Это не полный журнал всех изменений баланса (например, резервов и комиссий неуспешных вызовов). Ожидающие отправки — в локальном журнале.</p>${current?t`<p class="foot">Снимок до блока #${current.anchor.height} (${esc(new Date(current.anchor.timestamp).toLocaleString(locale()))}). Загружено ${esc(new Date(current.updatedAt).toLocaleString(locale()))}. Индексатор может отставать.</p>`:''}<button id="reloadTransfers" ${loading?'disabled':''}>Обновить с первой страницы</button><section id="networkRows">${current?(current.rows.length?current.rows.map(rowHtml).join(''):t('<p>В проиндексированной финализированной истории записей нет.</p>')):t('<p>История ещё не загружена.</p>')}</section><p>Страница ${index+1}</p><div class="actions"><button id="previousTransfers" class="secondary" ${loading||index===0?'disabled':''}>Назад по истории</button><button id="nextTransfers" class="secondary" ${loading||!current?.next?'disabled':''}>Следующие 20</button></div>`);
    const tabs=$('transfersTab').parentElement;tabs.classList.add('history-tabs');$('transfersTab').textContent=t('Все');
    for(const [value,label] of [['incoming',t('Входящие')],['outgoing',t('Исходящие')]]){
      const button=document.createElement('button');button.id=value+'Tab';button.textContent=label;button.disabled=loading||kind===value;tabs.insertBefore(button,$('rewardsTab'));action(button.id,()=>networkHistoryScreen(value));
    }
    // Keep the explanation available without pushing the actual transfers off screen.
    const explanation=$('transfersTab').parentElement.nextElementSibling,details=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent=t('Источник и состав истории');explanation.before(details);details.append(summary,explanation);
    back();action('transfersTab',()=>networkHistoryScreen('transfers'));action('rewardsTab',()=>networkHistoryScreen('rewards'));
    action('reloadTransfers',()=>load(0,true));action('previousTransfers',()=>load(index-1));action('nextTransfers',()=>load(index+1));
    if(settings.autoRefresh&&current&&!loading&&index===0)scheduleViewRefresh(()=>load(0,true));
  }
  async function load(target,fresh=false){
    if(loading)return;loading=true;draw();const v=view;message(t('Загружаем страницу истории…'));
    try{
      const nextAnchor=fresh||!anchor?await api.meta():anchor;alive(s,v);
      const cursor=fresh?null:target===index+1?current.next:cursors[target];
      const next=await api.page(owner,kind,nextAnchor,cursor);alive(s,v);
      if(fresh)cursors=[null];else cursors[target]=cursor;
      anchor=nextAnchor;current=next;index=target;
      if(target===0){cachedPages=rememberPage(cachedPages,next);await native('saveTransfers',writeTransferCache(cachedPages));alive(s,v);transferPages=cachedPages;}
      loading=false;draw();
    }catch(e){loading=false;if(s===session&&v===view){draw();message(t('Не удалось обновить историю: ')+e.message+t(' Последняя загруженная страница сохранена.'),true);}}
  }
  draw();const v=view;
  try{cachedPages=readTransferCache(await native('loadTransfers'));alive(s,v);current=cachedPages.find(p=>p.address===owner&&p.kind===kind)||null;anchor=current?.anchor||null;draw();}
  catch(e){if(s!==session||v!==view)return;message(t('Кэш истории недоступен: ')+e.message,true);}
  if(historyStale(current))await load(0,true);
}

function welcome(){
  render(t`<div class="badge">ANDROID · ${VERSION} · ТЕСТОВАЯ ВЕРСИЯ</div><h1>Ваш NUMEN.<br>Ваши ключи.</h1><p class="muted">Нативный кошелёк DiffPool. Адреса nu…, без комиссии разработчика.</p><div class="card"><button id="create">Создать новый кошелёк</button><button id="import" class="secondary">Импортировать NUMEN seed-фразу</button></div><p class="foot">Это отдельное приложение, не обновление Pearl. Seed-фразы и деньги из Pearl не переносятся. Для первых проверок используйте новый счёт и небольшие суммы. Внешний аудит не проводился.</p>`);
  languagePicker(welcome);action('create',()=>setup(true));action('import',()=>setup(false));
  const key=document.createElement('button');key.id='importKeyStart';key.className='secondary';key.textContent=t('Импортировать JSON / secretSeed');$('import').after(key);action('importKeyStart',()=>keySetup());
  const watch=document.createElement('button');watch.id='watchStart';watch.className='secondary';watch.textContent=t('Добавить адрес · только просмотр');$('import').after(watch);action('watchStart',()=>watchSetup());
}
function setup(create,adding=false){
  let generated=create?newMnemonic():'';
  render(t`${header(create?t('Новый кошелёк'):t('Импорт NUMEN'))}<p class="muted">Только sr25519 / NUMEN Mainnet. Путь вывода влияет на адрес. Сравните адрес с прежним кошельком до пополнения.</p><label>Seed-фраза<textarea id="seed" rows="4" autocomplete="off" autocapitalize="none" spellcheck="false" ${create?'readonly':''}>${generated}</textarea></label><label>Путь вывода (обычно пустой)<input id="path" placeholder="например //0" autocomplete="off"></label><label>Название<input id="name" value="Мой NUMEN" maxlength="60"></label><label>Пароль (от 10 символов)<input id="password" type="password" autocomplete="new-password"></label><label>Повтор пароля<input id="repeat" type="password" autocomplete="new-password"></label>${create?t('<p>Запишите фразу офлайн. Для проверки введите слова №3 и №9.</p><input id="word3" aria-label="Слово 3" autocomplete="off"><input id="word9" aria-label="Слово 9" autocomplete="off">'):''}<label class="check"><input id="backupCheck" type="checkbox">Я сохранил(а) фразу. Без неё восстановление после удаления приложения невозможно.</label><button id="saveWallet">Сохранить кошелёк</button><p class="foot">Фраза не отправляется на ноду. Не используйте фразу, опубликованную в чате или интернете.</p>`);
  if(adding){$('password').closest('label').firstChild.textContent=t('Текущий пароль приложения');$('repeat').closest('label').hidden=true;}
  viewCleanup=()=>{generated='';};
  if(create){const display=document.createElement('div');display.id='seed';display.className='secret-display';display.dataset.secret='true';display.setAttribute('aria-hidden','true');display.textContent=generated;$('seed').replaceWith(display);expireSecret();}
  if(!create){const key=document.createElement('button');key.id='importKey';key.className='secondary';key.textContent=t('Вместо фразы: JSON / secretSeed');$('seed').closest('label').before(key);action('importKey',()=>keySetup(adding));}
  action('back',()=>{generated='';adding?home():welcome();});
  action('saveWallet',async()=>{
    const s=session,v=view,path=validatePath($('path').value.trim()),name=contactName($('name').value);let mnemonic=normalizeMnemonic(create?generated:$('seed').value),password=takePassword('password'),oldSecret=null,nextSecret=null;
    try{
    const matches=adding||password===takePassword('repeat');validatePassword(password);if(!matches)throw Error(t('Пароли не совпадают.'));
    if(!$('backupCheck').checked)throw Error(t('Сначала сохраните seed-фразу.'));
    if(create&&($('word3').value.trim()!==generated.split(' ')[2]||$('word9').value.trim()!==generated.split(' ')[8]))throw Error(t('Слова проверки не совпадают.'));
    if(adding&&contactsError)throw Error(t('Сначала восстановите повреждённую адресную книгу.'));
    oldSecret=adding?await decryptVault(vault,password):null;checkView(s,v);nextSecret=addWallet(oldSecret,mnemonic,path);const nextAddress=nextSecret.wallets.at(-1).address;
    const encrypted=await encryptVault(nextSecret,password);
    await storeWallet(encrypted,nextAddress,name,adding,password,s,v);message(t('Кошелёк сохранён. После изменения хранилища биометрию нужно включить заново.'));
    }finally{password='';mnemonic='';clearSecret(oldSecret);clearSecret(nextSecret);}
  });
}
function locked(autoBio=false){
  render(t`<div class="badge">DIFFPOOL NUMEN · ${VERSION}</div><h1>Открыть кошелёк</h1><label>Пароль<input id="unlockPassword" type="password" autocomplete="off"></label><button id="unlock">Открыть</button>${biometric.enabled?t('<button id="bioUnlock" class="secondary">Войти по биометрии</button>'):''}<p class="foot">После входа баланс запрашивается автоматически только при включённом автообновлении. Ключи, адресная книга и журнал защищены на устройстве.</p>`);
  action('unlock',()=>unlock(takePassword('unlockPassword')));action('bioUnlock',async()=>{const s=session,v=view;let password=await native('biometricUnlock');try{checkView(s,v);await unlock(password,true,{s,v});}finally{password='';}});
  languagePicker(()=>locked(false));
  if(autoBio&&biometric.enabled)$('bioUnlock').click();
}
async function unlock(password,notify=true,context={s:session,v:view}){
  const {s,v}=context;checkView(s,v);let secret=null,nextAccounts;
  try{
    // A previously cancelled save may have committed. Always re-read disk before
    // fresh authentication; a late callback cannot reopen the old session.
    const stored=await native('load');checkView(s,v);vault=stored;
    secret=await decryptVault(vault,password);checkView(s,v);
    nextAccounts=secret.wallets.map(e=>({address:e.address,path:e.path,type:e.type||'sr25519',rawSeed:!!e.secretSeed}));
  }finally{password='';clearSecret(secret);}
  const [rawCache,rawBook,rawHistory,rawSettings,rawTransfers]=await Promise.all(['loadCache','loadContacts','loadHistory','loadSettings','loadTransfers'].map(a=>native(a).then(value=>({value})).catch(error=>({error}))));
  if(s!==session||v!==view)throw Error(t('Вход отменён.'));
  accounts=nextAccounts;address=nextAccounts[0].address;cache=null;contacts=[];journal=[];transferPages=[];journalError=false;contactsError=false;
  lastBalanceAttempt={key:'',at:0};
  const warnings=[];
  try{if(rawBook.error)throw rawBook.error;contacts=readContacts(rawBook.value);}catch{contactsError=true;warnings.push(t('Книга повреждена; перезапись запрещена.'));}
  try{if(rawHistory.error)throw rawHistory.error;journal=readHistory(rawHistory.value);}catch{journalError=true;warnings.push(t('Журнал недоступен. Отправка заблокирована.'));}
  try{if(rawSettings.error)throw rawSettings.error;const data=rawSettings.value?JSON.parse(rawSettings.value):{};settings=walletSettings(data);if(data.autoRefreshVersion!==1){await native('saveSettings',JSON.stringify(settings));alive(s,v);}}catch{warnings.push(t('Настройки недоступны; выбран официальный RPC.'));settings=walletSettings();}
  alive(s,v);
  try{if(rawTransfers.error)throw rawTransfers.error;transferPages=readTransferCache(rawTransfers.value);}catch{warnings.push(t('Сохранённая история недоступна; попробуем загрузить заново.'));}
  address=accounts.some(e=>e.address===settings.selectedAddress)?settings.selectedAddress:accounts[0].address;
  try{if(rawCache.error)throw rawCache.error;const data=rawCache.value?JSON.parse(rawCache.value):null;if(data?.address===address&&data.genesis===NETWORK.genesis&&data.endpoint===settings.endpoint)cache=data;}catch{warnings.push(t('Сохранённый баланс недоступен.'));}
  if(cache?.endpoint!==settings.endpoint)cache=null;
  await bioStatus();alive(s,v);home();
  if(warnings.length)message(warnings.join(' '),true);else if(notify)message(settings.autoRefresh?t('Кошелёк открыт. Автообновление включено.'):t('Открыто офлайн. Для свежего баланса нажмите «Обновить» или включите автообновление.'));
  await resumeImport();
}
function home(){
  if(!address)return;
  prepared=null;
  render(t`<div class="top"><div class="brand">NUMEN<small>DIFFPOOL WALLET</small></div><div class="toolbar"><button id="settings" class="small secondary">Настройки</button><button id="lock" class="small secondary">Закрыть</button></div></div><section class="card wallet-overview"><div class="badge">MAINNET · ${VERSION} BETA</div><button id="rename" class="wallet-name">${esc(nameOf(address))} ✎</button><h1 id="balance">${cache?esc(formatAmount(cache.free)):'—'} <small>NUMN</small></h1><div class="address-line"><span id="address" class="compact-address">${esc(shorten(address))}</span><button id="copy" class="small secondary">Копия</button></div><p class="foot" id="lastUpdate">${cache?t('Сохранённый снимок: ')+esc(new Date(cache.updatedAt).toLocaleString(locale()))+t('. Не текущий баланс.'):t('Баланс ещё не проверен.')}</p>${cache?t`<p class="foot">Доступно до комиссии: ${esc(formatAmount(cache.available))} NUMN<br>Резерв/блокировки учитываются. Высота ${cache.height}, финализировано ${cache.finalizedHeight}.</p>`:''}<button id="refresh">Обновить баланс и отправки</button><div class="actions"><button id="receive" class="secondary">Получить</button><button id="send" ${journalError?'disabled':''}>Отправить</button></div></section><section class="card"><h2>Отправки из приложения</h2><p class="foot">Локальный журнал отправок с телефона. Входящие, отправки с других устройств и награды доступны по кнопке истории адреса.</p>${historyRows(5)}<button id="history" class="secondary">Все локальные отправки</button><button id="explorer" class="secondary">Вся история адреса · внутри кошелька</button></section><button id="contacts" class="secondary">Адресная книга · ${contacts.length}</button><p class="foot">RPC: ${esc(settings.endpoint)}<br>Комиссия разработчика: 0%. Сетевая комиссия остаётся.</p>`);
  const networkHistory=document.createElement('section');networkHistory.className='card';networkHistory.id='networkHistory';
  const incomingPage=transferPages.find(p=>p.address===address&&p.kind==='incoming');
  networkHistory.innerHTML=t`<h2>Последние входящие</h2><section id="incomingPreview">${incomingPage?(incomingPage.rows.length?incomingPage.rows.slice(0,3).map(r=>t`<details class="transfer"><summary><div class="transfer-info"><strong>${r.from===address?t('Себе'):t('Входящий')}</strong><small>${esc(new Date(r.timestamp).toLocaleString(locale()))}</small></div><span class="transfer-amount">${r.from===address?'':'+'}${esc(formatAmount(r.amount))} NUMN</span></summary><div class="transfer-detail"><p>Отправитель</p><p class="address">${esc(r.from)}</p><p>Блок #${r.height} · финализировано по данным индексатора</p></div></details>`).join(''):t('<p>В проиндексированной истории входящих пока нет.</p>')):t('<p>Входящие ещё не загружены.</p>')}</section><p id="incomingUpdate" class="foot">${incomingPage?t('Сохранённая история: ')+esc(new Date(incomingPage.updatedAt).toLocaleString(locale()))+'. ':''}Индексатор может отставать от баланса. Полная история — по 20 записей за страницу.</p><div class="actions"><button id="incoming">Все входящие</button></div>`;
  $('app').querySelector('.wallet-overview').after(networkHistory);$('explorer').textContent=t('Все переводы');networkHistory.querySelector('.actions').append($('explorer'));
  action('incoming',()=>networkHistoryScreen('incoming'));
  const auto=document.createElement('button');auto.id='autoBalance';auto.className='secondary';auto.textContent=t('Автообновление · ')+(settings.autoRefresh?t('вкл., раз в минуту'):t('выключено'));networkHistory.append(auto);
  action('autoBalance',async()=>{const s=session,v=view,next={...settings,autoRefresh:!settings.autoRefresh};await native('saveSettings',JSON.stringify(next));alive(s,v);settings=next;if(next.autoRefresh)lastBalanceAttempt={key:'',at:0};home();});
  if(settings.autoRefresh){const key=settings.endpoint+'/'+address,at=lastBalanceAttempt.key===key?lastBalanceAttempt.at:0;scheduleViewRefresh(refresh,Math.max(1000,at+AUTO_REFRESH_MS-Date.now()));}
  action('copy',()=>native('copy',address));action('lock',()=>lock());action('settings',()=>settingsScreen());action('rename',()=>editContact(address,nameOf(address)));
  const picker=document.createElement('section');picker.className='wallet-picker';picker.innerHTML=t`<label>Активный кошелёк<select id="walletSelect">${accounts.map(e=>`<option value="${esc(e.address)}" ${e.address===address?'selected':''}>${esc(nameOf(e.address))} · ${esc(shorten(e.address))}</option>`).join('')}</select></label><div class="actions"><button id="addWallet" class="secondary">+ Создать</button><button id="importWallet" class="secondary">+ Импортировать</button></div>`;$('app').querySelector('.wallet-overview').before(picker);
  $('walletSelect').onchange=async()=>{try{const selected=$('walletSelect').value;if(!accounts.some(e=>e.address===selected))throw Error(t('Неизвестный кошелёк.'));const s=session,v=view,next={...settings,selectedAddress:selected};await native('saveSettings',JSON.stringify(next));alive(s,v);await closeChain();alive(s,v);settings=next;address=selected;cache=null;lastBalanceAttempt={key:'',at:0};home();message(settings.autoRefresh?t('Обновляем баланс и входящие выбранного кошелька.'):t('Кошелёк переключён. Автообновление выключено.'));}catch(e){message(e.message,true);}};
  action('addWallet',()=>setup(true,true));action('importWallet',()=>setup(false,true));
  const watch=document.createElement('button');watch.id='addWatch';watch.className='secondary';watch.textContent=t('+ По адресу · только просмотр');picker.append(watch);action('addWatch',()=>watchSetup(true));
  action('receive',()=>receive());action('send',()=>sendScreen());action('contacts',()=>book());action('history',()=>historyScreen());action('explorer',()=>networkHistoryScreen());action('refresh',refresh);
  const scan=document.createElement('button');scan.id='scanQr';scan.className='icon-button secondary';scan.title=t('Сканировать QR получателя');scan.setAttribute('aria-label',t('Сканировать QR получателя'));scan.innerHTML=qrIcon;scan.disabled=watchOnly();$('copy').after(scan);action('scanQr',()=>scanScreen());
  $('refresh').textContent=t('Обновить баланс и переводы');
  if(watchOnly()){$('send').disabled=true;$('send').textContent=t('Только просмотр');const note=document.createElement('p');note.className='foot';note.textContent=t('Только просмотр · ключ на этом устройстве отсутствует');$('rename').after(note);const key=document.createElement('button');key.id='upgradeWatch';key.className='secondary';key.textContent=t('Импортировать ключ этого адреса');$('send').parentElement.after(key);action('upgradeWatch',()=>keySetup(true,address));}
}
async function refresh(){
  if(refreshing?.s===session&&refreshing?.v===view)return;
  const s=session,v=view,owner=address,run={s,v};refreshing=run;
  lastBalanceAttempt={key:settings.endpoint+'/'+owner,at:Date.now()};message(t('Обновляем баланс и входящие…'));
  try{
  const errors=[];
  await Promise.all([
    (async()=>{try{const snapshot=await getChain().snapshot(owner);alive(s,v);cache={...snapshot,genesis:NETWORK.genesis,endpoint:settings.endpoint};await native('saveCache',JSON.stringify(cache));}catch(e){errors.push(t('Баланс: ')+e.message);}})(),
    (async()=>{try{
      const api=new TransferHistory(data=>native('historyRequest',data)),anchor=await api.meta();alive(s,v);
      const page=await api.page(owner,'incoming',anchor);alive(s,v);
      const pages=rememberPage(transferPages,page);await native('saveTransfers',writeTransferCache(pages));alive(s,v);transferPages=pages;
    }catch(e){errors.push(t('Входящие: ')+e.message);}})(),
  ]);
  alive(s,v);
  if(!journalError&&journal.some(e=>['unknown','submitted'].includes(e.status))){
    try{const updated=await getChain().reconcile(journal,address);alive(s,v);await persistJournal(writeHistory(updated));journal=updated;}catch(e){errors.push(t('Отправки: ')+e.message);}
  }
  alive(s,v);home();message(errors.length?errors.join(' ')+t(' Последние сохранённые данные оставлены.'):t('Баланс проверен. Входящие и журнал отправок обновлены.'),!!errors.length);
  }finally{if(refreshing===run)refreshing=null;}
}
function historyRows(limit=500){
  const statuses={submitted:t('Принято RPC, ещё не подтверждено'),unknown:t('Исход неизвестен — проверьте'),finalized:t('Финализировано · успешно'),failed:t('Финализировано · ошибка выполнения'),expired:t('Срок истёк · в финализированных блоках не найдена')};
  const rows=journal.filter(e=>e.address===address).slice(0,limit);
  return rows.length?rows.map(e=>t`<details class="transfer"><summary><div class="transfer-info"><strong>${esc(shorten(e.recipient))}</strong><small>${esc(statuses[e.status])}</small></div><span class="transfer-amount">−${esc(formatAmount(e.amount))} NUMN</span></summary><div class="transfer-detail"><p class="address">${esc(e.recipient)}</p><p class="address">${esc(e.id)}</p><p>Nonce ${esc(e.nonce)} · ${esc(new Date(e.createdAt).toLocaleString(locale()))}</p>${e.block?t`<p>Блок ${e.block}, extrinsic ${e.block}-${e.extrinsicIndex}</p>`:''}<p>Оценка комиссии: ${esc(formatAmount(e.fee))} NUMN. Это не подтверждение её фактического списания.</p></div></details>`).join(''):t('<p class="muted">Локальных отправок нет. Это не означает, что адрес не использовался.</p>');
}
function historyScreen(){render(t`${header(t('Локальный журнал'))}<p class="foot">Ожидающий перевод блокирует новую отправку до проверки. При сетевой ошибке не создавайте дубликат. Проверяются только финализированные блоки, по 12 за обновление.</p>${historyRows()}<button id="refreshHistory">Проверить отправки</button>`);back();action('refreshHistory',refresh);}
async function receive(){
  const current=address;render(t`${header(t('Получить NUMN'))}<div class="card centered"><canvas id="qr"></canvas><p class="address">${esc(current)}</p><button id="copy">Скопировать адрес</button><button id="shareQr" class="secondary" disabled>Поделиться QR</button></div><p class="foot">QR содержит только публичный адрес, не ключ. Только родной NUMEN Mainnet (nu…). Не отправляйте EVM-токены на этот QR.</p>`);back();action('copy',()=>native('copy',current));
  const s=session,v=view;await QRCode.toCanvas($('qr'),current,{width:280,margin:4,errorCorrectionLevel:'M'});alive(s,v);$('shareQr').disabled=false;
  action('shareQr',async()=>{const png=await QRCode.toDataURL(current,{width:640,margin:4,errorCorrectionLevel:'M'});alive(s,v);await native('shareQr',{address:current,png});});
}
async function scanScreen(draft=null){
  if(watchOnly())throw Error(t('Для перевода выберите кошелёк с ключом.'));
  render(t`${header(t('Сканировать QR'))}<p>Наведите камеру на QR адреса NUMEN.</p><video id="qrCamera" class="qr-camera" autoplay muted playsinline></video><p class="foot">Распознавание только на телефоне. QR подставляет получателя, но не подписывает и не отправляет перевод. Подключение к сайтам (WalletConnect) пока не поддерживается.</p><button id="cancelScan" class="secondary">Отмена</button>`);
  const s=session,v=view,cancel=()=>draft?sendScreen(draft.recipient,draft.amount):home();action('back',cancel);action('cancelScan',cancel);
  const scanner=cameraScanner($('qrCamera'),{
    onRead(value){if(s!==session||v!==view)return;let recipient;try{recipient=qrRecipient(value);}catch(e){message(e.message,true);return;}void sendScreen(recipient,draft?.amount||'').catch(e=>{if(s===session)message(e.message,true);});},
    onError(error){if(s===session&&v===view)message(error,true);},
  });
  viewCleanup=()=>{scanner.stop();void native('endQrScan').catch(()=>{});};
  try{await native('beginQrScan');alive(s,v);await scanner.start();}catch(e){scanner.stop();if(s===session&&v===view)message(e.message,true);}
}
function book(){const entries=[...accounts.map(e=>({address:e.address,name:nameOf(e.address),own:true,watch:e.type==='watch'})),...contacts.filter(e=>!accounts.some(w=>w.address===e.address))];render(t`${header(t('Адресная книга'))}<p class="foot">Названия хранятся только на телефоне. Свои и наблюдаемые кошельки добавляются автоматически.</p>${entries.map((e,i)=>`<button id="contact${i}" class="secondary">${esc(e.name)}${e.watch?t(' · Только просмотр'):e.own?t(' · Мой кошелёк'):''}<br><small>${esc(shorten(e.address))}</small></button>`).join('')}<button id="addContact" ${contactsError?'disabled':''}>Добавить адрес</button>`);back();action('addContact',()=>editContact());entries.forEach((e,i)=>action('contact'+i,()=>editContact(e.address,e.name)));}
function editContact(original='',name=''){
  render(t`${header(t('Запись в книге'))}<label>Название<input id="contactName" value="${esc(name)}" maxlength="60"></label><label>Адрес nu…<textarea id="contactAddress" rows="3">${esc(original)}</textarea></label><button id="saveContact" ${contactsError?'disabled':''}>Сохранить</button>${original?t('<button id="payContact" class="secondary">Отправить на этот адрес</button><label class="check"><input id="deleteContactCheck" type="checkbox">Удалить запись из книги</label><button id="deleteContact" class="secondary danger">Удалить запись</button>'):''}`);back();
  action('saveContact',async()=>{if(contactsError)throw Error(t('Перезапись повреждённой книги запрещена.'));const s=session,v=view,next=saveContact(contacts,$('contactName').value,$('contactAddress').value,contacts.some(e=>e.address===original)?original:null);await native('saveContacts',writeContacts(next));alive(s,v);contacts=next;book();});
  if(accounts.some(e=>e.address===original)){$('contactAddress').readOnly=true;$('deleteContact').hidden=true;$('deleteContactCheck').closest('label').hidden=true;}
  action('payContact',()=>sendScreen(original));action('deleteContact',async()=>{if(contactsError||!$('deleteContactCheck').checked)throw Error(t('Подтвердите удаление записи.'));const s=session,v=view,next=contacts.filter(e=>e.address!==original);await native('saveContacts',writeContacts(next));alive(s,v);contacts=next;book();});
}
async function sendScreen(recipient='',amount=''){
  if(watchOnly())throw Error(t('Этот адрес добавлен только для просмотра. Для отправки импортируйте его собственную seed-фразу.'));
  if(journalError)throw Error(t('Журнал недоступен; отправка заблокирована.'));
  render(t`${header(t('Отправить NUMN'))}<p id="freshBalance" class="muted">Проверяем доступный баланс…</p><label>Получатель nu…<textarea id="recipient" rows="3">${esc(recipient)}</textarea></label><label>Из адресной книги<select id="recipientContact"><option value="">Выберите получателя</option>${contacts.filter(e=>e.address!==address).map(e=>`<option value="${esc(e.address)}">${esc(e.name)}</option>`).join('')}</select></label><label>Сумма NUMN<input id="amount" inputmode="decimal" autocomplete="off"></label><button id="prepare" disabled>Рассчитать комиссию</button><p class="foot">Используется transferKeepAlive: остаток для существования счёта сохраняется. В предпросмотре — оценка сетевой комиссии с резервом 20%, а не дополнительная комиссия кошелька.</p>`);back();
  $('recipientContact').onchange=()=>{$('recipient').value=$('recipientContact').value;};
  $('amount').value=amount;
  const scan=document.createElement('button');scan.id='scanRecipient';scan.className='secondary qr-action';scan.innerHTML=qrIcon+t('<span>Сканировать QR получателя</span>');$('recipient').closest('label').after(scan);
  action('scanRecipient',()=>scanScreen({recipient:$('recipient').value,amount:$('amount').value}));
  const source=document.createElement('p');source.className='foot';source.textContent=t`Списать с: ${nameOf(address)} · ${address}`;$('freshBalance').before(source);
  action('prepare',async()=>{const s=session,v=view;message(t('Повторно проверяем баланс и nonce…'));const next=await getChain().prepare(address,validateRecipient($('recipient').value),$('amount').value,journal);alive(s,v);prepared=next;confirmScreen();});
  const s=session,v=view;
  try{const snapshot=await getChain().snapshot(address);alive(s,v);$('freshBalance').textContent=t`Проверено: ${formatAmount(snapshot.available)} NUMN до комиссии. Блок ${snapshot.height}.`;$('prepare').disabled=false;}catch(e){if(s===session&&v===view){$('freshBalance').textContent=t('Свежий баланс не получен. Вернитесь назад и повторите.');message(e.message,true);}}
}
function confirmScreen(){
  const intent=prepared.intent;
  render(t`${header(t('Проверьте перевод'))}<dl><dt>Сеть</dt><dd>NUMEN Mainnet</dd><dt>Получатель</dt><dd class="address">${esc(intent.recipient)}</dd><dt>Сумма</dt><dd>${formatAmount(intent.amount)} NUMN</dd><dt>Оценка сетевой комиссии</dt><dd>${formatAmount(intent.fee)} NUMN</dd><dt>Баланс проверяется с резервом на комиссию</dt><dd>${formatAmount(intent.feeBudget)} NUMN</dd><dt>Нода</dt><dd>${esc(intent.endpoint)}</dd></dl>${biometric.enabled?t('<button id="confirmBio">Подтвердить биометрией</button>'):''}<label>Пароль для этой отправки<input id="sendPassword" type="password" autocomplete="off"></label><button id="confirmPassword">Подтвердить и отправить</button><p class="foot">Предпросмотр действует не более 90 секунд. Принятие RPC не означает включение в блок. При неизвестном исходе перевод автоматически не повторяется.</p>`);back();
  action('confirmPassword',()=>sendPrepared(false));action('confirmBio',()=>sendPrepared(true));
  const source=document.createElement('p');source.className='address';source.textContent=t`Отправитель: ${nameOf(intent.address)} · ${intent.address}`;$('app').querySelector('dl').before(source);
}
async function sendPrepared(useBio){
  if(busySend||!prepared)throw Error(t('Отправка уже выполняется или отменена.'));
  busySend=true;const s=session,v=view,p=prepared,c=getChain();let pair=null,secret=null,password='';
  try{
    if(useBio){const result=JSON.parse(await native('biometricConfirm',{txid:p.id,address:p.intent.recipient,amount:formatAmount(p.intent.amount),fee:formatAmount(p.intent.feeBudget),total:formatAmount(BigInt(p.intent.amount)+BigInt(p.intent.feeBudget))}));if(result.txid!==p.id)throw Error(t('Подтверждение не относится к этому переводу.'));password=result.password;}
    else password=takePassword('sendPassword');
    alive(s,v);secret=await decryptVault(vault,password);password='';alive(s,v);
    try{pair=pairForWallet(secret,p.intent.address);}finally{clearSecret(secret);secret=null;}
    message(t('Проверяем состояние сети и подписываем на телефоне…'));
    const signed=await c.signPrepared(p,pair,()=>alive(s,v));pair.lock();pair=null;alive(s,v);
    // Once journal save starts, leaving this screen cannot make the transfer reusable.
    prepared=null;
    const result=await submitOnce(c,signed,journal,async raw=>{alive(s);await persistJournal(raw);if(s===session)journal=readHistory(raw);});
    alive(s,v);journal=result.entries;home();message(result.unknown?t('Исход неизвестен. Не повторяйте отправку. ')+result.error:t('Транзакция принята RPC. Дождитесь проверки финализации в журнале.'),result.unknown);
  }finally{password='';clearSecret(secret);if(pair)pair.lock();busySend=false;}
}
function settingsScreen(){
  render(t`${header(t('Настройки'))}<label>HTTPS RPC<input id="endpoint" value="${esc(settings.endpoint)}" autocomplete="off" spellcheck="false"></label><p class="foot">Можно указать свою защищённую ноду NUMEN Mainnet. Она увидит запрашиваемый адрес и подписанные транзакции, но не seed. Майнинговый порт 8010 не подходит. WSS для этой версии не используется. Автоматической смены ноды нет.</p><button id="saveEndpoint">Сохранить и проверить сеть</button><button id="defaultEndpoint" class="secondary">Официальный RPC</button><div class="card"><h2>Защита</h2><p>${biometric.enabled?t('Биометрия включена.'):biometric.available?t('Защищённая биометрия доступна.'):t('Биометрия недоступна; используйте пароль.')}</p><label>Текущий пароль<input id="settingsPassword" type="password" autocomplete="off"></label>${biometric.available&&!biometric.enabled?t('<button id="enableBio">Включить биометрию</button>'):''}${biometric.enabled?t('<button id="disableBio" class="secondary">Отключить биометрию</button>'):''}<button id="showSeed" class="secondary">Показать seed после проверки пароля</button></div><details><summary>Удалить кошелёк с этого телефона</summary><p>Удалятся ключи, книга и журнал. Средства остаются в блокчейне; для восстановления нужна seed-фраза и путь вывода.</p><label>Введите УДАЛИТЬ<input id="deleteText" autocomplete="off"></label><button id="deleteWallet" class="secondary danger">Удалить локальные данные</button></details><p class="foot">${VERSION} beta · Android 9+ с WebView 100+.<br>Seed шифруется PBKDF2/AES-GCM и Android Keystore. Биометрия — per-use CryptoObject, не простой флаг. Нет аналитики, рекламы, внешних скриптов и комиссии разработчика.</p>`);back();
  languagePicker(settingsScreen);
  action('defaultEndpoint',()=>{$('endpoint').value=NETWORK.rpc;});
  const auto=document.createElement('button');auto.id='toggleAutoRefresh';auto.className='secondary';auto.textContent=t('Автообновление баланса и входящих: ')+(settings.autoRefresh?t('вкл.'):t('выкл.'));$('defaultEndpoint').after(auto);
  const autoInfo=document.createElement('p');autoInfo.className='foot';autoInfo.textContent=t('Раз в минуту, только выбранный адрес и открытый экран. При блокировке запросы прекращаются; на экране отправки автообновление не запускается. RPC и индексатор видят запрашиваемый адрес.');auto.after(autoInfo);
  action('toggleAutoRefresh',async()=>{const s=session,v=view,next={...settings,autoRefresh:!settings.autoRefresh};await native('saveSettings',JSON.stringify(next));alive(s,v);settings=next;if(next.autoRefresh)lastBalanceAttempt={key:'',at:0};settingsScreen();});
  if(watchOnly()){$('showSeed').disabled=true;$('showSeed').textContent=t('Только просмотр · seed-фразы здесь нет');}
  else if(accounts.find(e=>e.address===address)?.rawSeed)$('showSeed').textContent=t('Показать secretSeed после проверки пароля');
  action('saveEndpoint',async()=>{const s=session,v=view,endpoint=validateEndpoint($('endpoint').value),candidate=new Chain(endpoint,transport);try{await candidate.connect();alive(s,v);const next={...settings,endpoint};await native('saveSettings',JSON.stringify(next));alive(s,v);await closeChain();alive(s,v);settings=next;chain=candidate;cache=null;settingsScreen();message(t('Сеть проверена, RPC сохранён.'));}catch(e){await candidate.close();throw e;}});
  action('enableBio',async()=>{const s=session,v=view;let password=takePassword('settingsPassword'),secret=null;try{secret=await decryptVault(vault,password);alive(s,v);await native('biometricEnable',password);alive(s,v);await bioStatus();alive(s,v);settingsScreen();}finally{password='';clearSecret(secret);}});
  action('disableBio',async()=>{const s=session,v=view;await native('biometricDisable');alive(s,v);await bioStatus();alive(s,v);settingsScreen();});
  action('showSeed',async()=>{const s=session,v=view;let password=takePassword('settingsPassword'),secret=null;try{secret=await decryptVault(vault,password);password='';alive(s,v);const selected=secret.wallets.find(e=>e.address===address);if(!selected||selected.type==='watch')throw Error(t('Ключ отсутствует.'));render(t`${header(selected.secretSeed?t('Резервный secretSeed'):t('Резервная фраза'))}<p class="address">${esc(address)}</p><p class="error">Секрет выбранного кошелька. Запишите офлайн, не отправляйте его никому. Экран закроется через 60 секунд. Копирование отключено.</p><div id="backupSeed" class="secret-display" data-secret="true" aria-hidden="true">${esc(selected.secretSeed||selected.mnemonic)}</div><p>Путь: ${esc(selected.path||t('(пустой)'))}</p>`);expireSecret();back();}finally{password='';clearSecret(secret);}});
  action('deleteWallet',async()=>{const s=session,v=view;if($('deleteText').value!==t('УДАЛИТЬ'))throw Error(t('Введите УДАЛИТЬ.'));if(journal.some(e=>['unknown','submitted'].includes(e.status)))throw Error(t('Есть непроверенная отправка. Сначала сохраните её хеш и проверьте результат; удаление сейчас заблокировано.'));let password=takePassword('settingsPassword'),secret=null;try{secret=await decryptVault(vault,password);alive(s,v);await native('delete');alive(s,v);vault='';biometric={available:false,enabled:false};await lock();}finally{password='';clearSecret(secret);}});
}
async function lock(){session++;clearTimeout(idleTimer);clearTimeout(secretTimer);cancelNativeCalls();void native('invalidate').catch(()=>{});address=null;accounts=[];cache=null;contacts=[];journal=[];transferPages=[];prepared=null;vault?locked(false):welcome();await closeChain();}
globalThis.appBackground=()=>{void lock();};
globalThis.appResume=()=>{const s=session,v=view;void(async()=>{const language=await native('loadLanguage');checkView(s,v);setLanguage(language);const stored=await native('load');checkView(s,v);vault=stored;if(vault&&!address)locked(true);else await resumeImport();})().catch(()=>{});};
async function start(){setLanguage(await native('loadLanguage'));render(t('<h1>DiffPool NUMEN</h1><p>Подготавливаем криптографию…</p>'));await initCrypto();vault=await native('load');await bioStatus();vault?locked(true):welcome();}
start().catch(e=>{render(t('<h1>Не удалось запустить</h1><p>Нужен Android APK и актуальный System WebView. Данные не отправлялись.</p>'));message(e.message,true);});
