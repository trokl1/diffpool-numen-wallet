import QRCode from 'qrcode';
import { NETWORK, VERSION, validateEndpoint } from './config.mjs';
import { initCrypto,newMnemonic,normalizeMnemonic,validatePath,validateRecipient,encryptVault,decryptVault,formatAmount,validatePassword,addWallet,addWatchWallet,pairForWallet,importKey,addKeyWallet,clearSecret } from './core.mjs';
import { TransferHistory,POOL_WALLETS,readTransferCache,writeTransferCache,rememberPage,historyStale } from './transfers.mjs';
import { readContacts,writeContacts,saveContact,contactName } from './contacts.mjs';
import { readHistory,writeHistory,submitOnce } from './history.mjs';
import { Chain } from './chain.mjs';
import { walletSettings } from './settings.mjs';
import {cameraScanner,qrRecipient} from './qr.mjs';
import { native,transport } from './bridge.mjs';

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
const qrIcon='<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 13h2v8h-6v-2M11 3v4M3 11h4M11 11h4v2h-4v4M11 21v-2"/></svg>';
const AUTO_REFRESH_MS=60000;
const alive=(s,v)=>{if(s!==session||v!==undefined&&v!==view||!address)throw Error('Операция отменена: кошелёк заблокирован или экран изменился.');};
function message(text='',error=false){$('message').textContent=text;$('message').className='message'+(error?' error':'');}
function render(html){clearTimeout(viewTimer);viewTimer=null;const cleanup=viewCleanup;viewCleanup=null;if(cleanup)cleanup();view++;$('app').innerHTML=html;message();}
function scheduleViewRefresh(task,delay=AUTO_REFRESH_MS){
  clearTimeout(viewTimer);const s=session,v=view,owner=address;
  viewTimer=setTimeout(()=>{viewTimer=null;if(s===session&&v===view&&owner===address&&address&&!document.hidden)void task().catch(e=>{if(s===session&&v===view)message(e.message,true);});},delay);
}
function action(id,fn){const button=$(id);if(!button)return;button.onclick=async()=>{if(button.disabled)return;button.disabled=true;const s=session;try{await fn();}catch(e){if(s===session)message(e.message,true);}finally{button.disabled=false;}};}
function header(title){return `<div class="top"><div class="brand">${esc(title)}<small>DIFFPOOL · NUMEN</small></div><button id="back" class="small secondary">Назад</button></div>`;}
function back(){action('back',()=>{prepared=null;home();});}
function getChain(){if(!chain)chain=new Chain(settings.endpoint,transport);return chain;}
async function closeChain(){const old=chain;chain=null;if(old)await old.close();}
async function persistJournal(raw){await native('saveHistory',raw);}
async function bioStatus(){try{biometric=JSON.parse(await native('biometricStatus'));}catch{biometric={available:false,enabled:false};}}
function nameOf(addr){return contacts.find(c=>c.address===addr)?.name||'Мой NUMEN';}
function watchOnly(){return accounts.find(e=>e.address===address)?.type==='watch';}
async function resumeImport(){
  const s=session,v=view;
  try{const selected=await native('importFileStatus');if(s===session&&v===view){if(selected==='selected'&&(address||!vault))keySetup(!!vault,pendingImportAddress);if(selected!=='selected')pendingImportAddress='';}}catch{/* No file picker state to restore. */}
}
function keySetup(adding=false,expected=''){
  let preview='';
  render(`${header('Импорт ключа / JSON')}<p class="muted">Наш signer JSON (secretPhrase / secretSeed) или 32-байтный secretSeed: 0x + 64 hex-символа. Всё проверяется на телефоне, без отправки ключа в сеть.</p><button id="chooseKeyFile" class="secondary">Выбрать JSON-файл</button><button id="readKeyFile" class="secondary" hidden>Прочитать выбранный JSON</button><label>JSON, seed-фраза или secretSeed<textarea id="keyText" rows="4" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="16384"></textarea></label><label>Какой кошелёк импортируем<select id="keyTarget"><option value="">Другой / сверю адрес вручную</option value="${POOL_WALLETS[0].address}">FEE DiffPool</option><option value="${POOL_WALLETS[2].address}">Личный майнинг</option></select></label><label>Ожидаемый адрес nu…<textarea id="expectedKeyAddress" rows="2" spellcheck="false">${esc(expected)}</textarea></label><label>Локальное имя<input id="keyName" maxlength="60" value="${esc(expected?nameOf(expected):'Импорт NUMEN')}"></label><button id="checkKey">Проверить ключ и адрес</button><p id="keyPreview" class="address"></p><label class="check"><input id="keyAddressCheck" type="checkbox">Я сверил(а) полный адрес и сохранил(а) резервную копию ключа.</label><label>${adding?'Текущий':'Новый'} пароль приложения<input id="keyPassword" type="password" autocomplete="off"></label>${adding?'':'<label>Повтор пароля<input id="keyRepeat" type="password" autocomplete="off"></label>'}<button id="saveKey" disabled>Импортировать с правом отправки</button><p class="foot">Это не перевод монет: импорт даёт приложению доступ к существующему счёту. Не импортируйте рабочий расчётный POOL-ключ без необходимости. JSON содержит секрет; не отправляйте его в чат. Зашифрованный Polkadot JSON не поддерживается.</p>`);
  const s=session,v=view;native('importFileStatus').then(value=>{if(s===session&&v===view)$('readKeyFile').hidden=value!=='selected';}).catch(()=>{});
  function invalidate(){preview='';$('keyPreview').textContent='';$('keyAddressCheck').checked=false;$('saveKey').disabled=true;}
  $('keyText').oninput=invalidate;$('expectedKeyAddress').oninput=invalidate;
  $('keyTarget').onchange=()=>{const target=$('keyTarget').value;$('expectedKeyAddress').value=target;if(target)$('keyName').value=POOL_WALLETS.find(e=>e.address===target).name;invalidate();};
  action('back',async()=>{pendingImportAddress='';await native('cancelImportFile');adding?home():welcome();});
  action('chooseKeyFile',async()=>{const expected=$('expectedKeyAddress').value.trim();pendingImportAddress=expected?validateRecipient(expected):'';await native('chooseImportFile');});
  action('readKeyFile',async()=>{const currentSession=session,currentView=view,raw=await native('readImportFile');if(currentSession!==session||currentView!==view)return;$('keyText').value=raw;$('readKeyFile').hidden=true;invalidate();message('Файл прочитан локально. Нажмите «Проверить ключ и адрес».');});
  action('checkKey',()=>{const entry=importKey($('keyText').value,$('expectedKeyAddress').value.trim());preview=entry.address;$('keyPreview').textContent='Адрес из ключа: '+preview;$('keyAddressCheck').checked=false;$('saveKey').disabled=false;});
  action('saveKey',async()=>{
    const currentSession=session,currentView=view,entry=importKey($('keyText').value,$('expectedKeyAddress').value.trim()),password=$('keyPassword').value,name=contactName($('keyName').value);
    if(entry.address!==preview||!$('keyAddressCheck').checked)throw Error('Сначала проверьте ключ и подтвердите полный адрес.');
    validatePassword(password);if(!adding&&password!==$('keyRepeat').value)throw Error('Пароли не совпадают.');if(adding&&contactsError)throw Error('Адресная книга повреждена.');
    const old=adding?await decryptVault(vault,password):null;let next;
    try{
      next=addKeyWallet(old,entry);const encrypted=await encryptVault(next,password);
      if(currentSession!==session||currentView!==view)throw Error('Импорт отменён: экран изменился.');
      await native('save',encrypted);vault=encrypted;biometric.enabled=false;
      contacts=saveContact(adding?contacts:[],name,entry.address,contacts.some(e=>e.address===entry.address)?entry.address:null);await native('saveContacts',writeContacts(contacts));
      settings={...settings,selectedAddress:entry.address};await native('saveSettings',JSON.stringify(settings));pendingImportAddress='';await native('cancelImportFile');
      if(currentSession!==session||currentView!==view)return;
      $('keyText').value='';await unlock(password,false);message('Ключ импортирован. Отправка доступна. Биометрию после изменения хранилища нужно включить заново.');
    }finally{entry.mnemonic='';entry.secretSeed='';clearSecret(old);clearSecret(next);}
  });
}
function watchSetup(adding=false){
  render(`${header('Добавить по адресу')}<p class="muted">Только просмотр: баланс, переводы и награды. Ключи не нужны, отправка недоступна. Ключи рабочего пула лучше оставить на сервере.</p><div class="actions"><button id="feePreset" class="secondary">FEE DiffPool</button><button id="poolPreset" class="secondary">POOL · награды</button></div><label>Адрес NUMEN<textarea id="watchAddress" rows="3" spellcheck="false"></textarea></label><label>Локальное имя<input id="watchName" maxlength="60"></label><label>${adding?'Текущий':'Новый'} пароль приложения<input id="watchPassword" type="password" autocomplete="off"></label>${adding?'':'<label>Повтор пароля<input id="watchRepeat" type="password" autocomplete="off"></label>'}<button id="saveWatch">Добавить для просмотра</button><p class="foot">Имена и список адресов хранятся на телефоне. Историю увидите после нажатия соответствующей кнопки; официальный индексатор узнает запрашиваемый адрес.</p>`);
  action('back',()=>adding?home():welcome());
  ['feePreset','poolPreset'].forEach((id,i)=>action(id,()=>{$('watchAddress').value=POOL_WALLETS[i].address;$('watchName').value=POOL_WALLETS[i].name;}));
  const mine=document.createElement('button');mine.id='minerPreset';mine.className='secondary';mine.textContent='Личный майнинг';$('poolPreset').parentElement.after(mine);action('minerPreset',()=>{$('watchAddress').value=POOL_WALLETS[2].address;$('watchName').value=POOL_WALLETS[2].name;});
  action('saveWatch',async()=>{
    const s=session,v=view,nextAddress=validateRecipient($('watchAddress').value),name=contactName($('watchName').value),password=$('watchPassword').value;
    validatePassword(password);if(!adding&&password!==$('watchRepeat').value)throw Error('Пароли не совпадают.');
    if(adding&&contactsError)throw Error('Сначала восстановите адресную книгу.');
    const secret=adding?await decryptVault(vault,password):null,encrypted=await encryptVault(addWatchWallet(secret,nextAddress),password);
    if(s!==session||v!==view)throw Error('Добавление отменено.');
    await native('save',encrypted);vault=encrypted;biometric.enabled=false;
    contacts=saveContact(adding?contacts:[],name,nextAddress,contacts.some(e=>e.address===nextAddress)?nextAddress:null);await native('saveContacts',writeContacts(contacts));
    settings={...settings,selectedAddress:nextAddress};await native('saveSettings',JSON.stringify(settings));await unlock(password,false);
    message('Адрес добавлен для просмотра. Приватный ключ не переносился. Биометрию после изменения хранилища нужно включить заново.');
  });
}

async function networkHistoryScreen(initialKind='transfers'){
  const owner=address,s=session;let kind=initialKind,current=null,anchor=null,index=0,cursors=[null],loading=false,cachedPages=[];
  const api=new TransferHistory(data=>native('historyRequest',data));
  function rowHtml(r){
    if(kind==='rewards')return `<details class="transfer"><summary><div class="transfer-info"><strong>Блок #${r.height}</strong><small>${esc(new Date(r.timestamp).toLocaleString())}</small></div><span class="transfer-amount">+${esc(formatAmount(BigInt(r.reward)+BigInt(r.minerFees)))} NUMN</span></summary><div class="transfer-detail"><p>Награда: ${esc(formatAmount(r.reward))} NUMN<br>Комиссии майнеру: ${esc(formatAmount(r.minerFees))} NUMN</p><p class="address">${esc(r.hash)}</p><p>Финализировано по данным индексатора</p></div></details>`;
    const self=r.from===owner&&r.to===owner,incoming=r.to===owner,tx=r.extrinsic;
    return `<details class="transfer"><summary><div class="transfer-info"><strong>${self?'Себе':incoming?'Входящий':'Исходящий'}</strong><small>${esc(new Date(r.timestamp).toLocaleString())}</small></div><span class="transfer-amount">${self?'':incoming?'+':'−'}${esc(formatAmount(r.amount))} NUMN</span></summary><div class="transfer-detail"><p>Отправитель</p><p class="address">${esc(r.from)}</p><p>Получатель</p><p class="address">${esc(r.to)}</p><p>Блок #${r.height} · финализировано по данным индексатора</p>${tx?`<p>Транзакция ${r.height}-${tx.index}</p><p class="address">${esc(tx.hash)}</p>${tx.fee!==null?`<p>Комиссия всей транзакции: ${esc(formatAmount(tx.fee))} NUMN${tx.tip!==null?` · tip ${esc(formatAmount(tx.tip))}`:''}. В пакетной выплате это общая комиссия, не комиссия каждого перевода.</p>`:''}`:'<p>Событие без подписанной транзакции</p>'}<p class="foot">ID события: ${esc(r.id)}</p></div></details>`;
  }
  function draw(){
    render(`${header('История адреса')}<p class="address">${esc(nameOf(owner))}<br>${esc(owner)}</p><div class="actions"><button id="transfersTab" ${loading||kind==='transfers'?'disabled':''}>Переводы</button><button id="rewardsTab" ${loading||kind==='rewards'?'disabled':''}>Награды блоков</button></div><p class="foot">Официальный индексатор NUMEN. Только финализированные записи, по 20 за страницу. Переводы — движения native NUMN; награды майнинга отдельно. Это не полный журнал всех изменений баланса (например, резервов и комиссий неуспешных вызовов). Ожидающие отправки — в локальном журнале.</p>${current?`<p class="foot">Снимок до блока #${current.anchor.height} (${esc(new Date(current.anchor.timestamp).toLocaleString())}). Загружено ${esc(new Date(current.updatedAt).toLocaleString())}. Индексатор может отставать.</p>`:''}<button id="reloadTransfers" ${loading?'disabled':''}>Обновить с первой страницы</button><section id="networkRows">${current?(current.rows.length?current.rows.map(rowHtml).join(''):'<p>В проиндексированной финализированной истории записей нет.</p>'):'<p>История ещё не загружена.</p>'}</section><p>Страница ${index+1}</p><div class="actions"><button id="previousTransfers" class="secondary" ${loading||index===0?'disabled':''}>Назад по истории</button><button id="nextTransfers" class="secondary" ${loading||!current?.next?'disabled':''}>Следующие 20</button></div>`);
    const tabs=$('transfersTab').parentElement;tabs.classList.add('history-tabs');$('transfersTab').textContent='Все';
    for(const [value,label] of [['incoming','Входящие'],['outgoing','Исходящие']]){
      const button=document.createElement('button');button.id=value+'Tab';button.textContent=label;button.disabled=loading||kind===value;tabs.insertBefore(button,$('rewardsTab'));action(button.id,()=>networkHistoryScreen(value));
    }
    // Keep the explanation available without pushing the actual transfers off screen.
    const explanation=$('transfersTab').parentElement.nextElementSibling,details=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent='Источник и состав истории';explanation.before(details);details.append(summary,explanation);
    back();action('transfersTab',()=>networkHistoryScreen('transfers'));action('rewardsTab',()=>networkHistoryScreen('rewards'));
    action('reloadTransfers',()=>load(0,true));action('previousTransfers',()=>load(index-1));action('nextTransfers',()=>load(index+1));
    if(settings.autoRefresh&&current&&!loading&&index===0)scheduleViewRefresh(()=>load(0,true));
  }
  async function load(target,fresh=false){
    if(loading)return;loading=true;draw();const v=view;message('Загружаем страницу истории…');
    try{
      const nextAnchor=fresh||!anchor?await api.meta():anchor;alive(s,v);
      const cursor=fresh?null:target===index+1?current.next:cursors[target];
      const next=await api.page(owner,kind,nextAnchor,cursor);alive(s,v);
      if(fresh)cursors=[null];else cursors[target]=cursor;
      anchor=nextAnchor;current=next;index=target;
      if(target===0){cachedPages=rememberPage(cachedPages,next);await native('saveTransfers',writeTransferCache(cachedPages));alive(s,v);transferPages=cachedPages;}
      loading=false;draw();
    }catch(e){loading=false;if(s===session&&v===view){draw();message('Не удалось обновить историю: '+e.message+' Последняя загруженная страница сохранена.',true);}}
  }
  draw();const v=view;
  try{cachedPages=readTransferCache(await native('loadTransfers'));alive(s,v);current=cachedPages.find(p=>p.address===owner&&p.kind===kind)||null;anchor=current?.anchor||null;draw();}
  catch(e){if(s!==session||v!==view)return;message('Кэш истории недоступен: '+e.message,true);}
  if(historyStale(current))await load(0,true);
}

function welcome(){
  render(`<div class="badge">ANDROID · ${VERSION} · ТЕСТОВАЯ ВЕРСИЯ</div><h1>Ваш NUMEN.<br>Ваши ключи.</h1><p class="muted">Нативный кошелёк DiffPool. Адреса nu…, без комиссии разработчика.</p><div class="card"><button id="create">Создать новый кошелёк</button><button id="import" class="secondary">Импортировать NUMEN seed-фразу</button></div><p class="foot">Это отдельное приложение, не обновление Pearl. Seed-фразы и деньги из Pearl не переносятся. Для первых проверок используйте новый счёт и небольшие суммы. Внешний аудит не проводился.</p>`);
  action('create',()=>setup(true));action('import',()=>setup(false));
  const key=document.createElement('button');key.id='importKeyStart';key.className='secondary';key.textContent='Импортировать JSON / secretSeed';$('import').after(key);action('importKeyStart',()=>keySetup());
  const watch=document.createElement('button');watch.id='watchStart';watch.className='secondary';watch.textContent='Добавить адрес · только просмотр';$('import').after(watch);action('watchStart',()=>watchSetup());
}
function setup(create,adding=false){
  let generated=create?newMnemonic():'';
  render(`${header(create?'Новый кошелёк':'Импорт NUMEN')}<p class="muted">Только sr25519 / NUMEN Mainnet. Путь вывода влияет на адрес. Сравните адрес с прежним кошельком до пополнения.</p><label>Seed-фраза<textarea id="seed" rows="4" autocomplete="off" autocapitalize="none" spellcheck="false" ${create?'readonly':''}>${generated}</textarea></label><label>Путь вывода (обычно пустой)<input id="path" placeholder="например //0" autocomplete="off"></label><label>Название<input id="name" value="Мой NUMEN" maxlength="60"></label><label>Пароль (от 10 символов)<input id="password" type="password" autocomplete="new-password"></label><label>Повтор пароля<input id="repeat" type="password" autocomplete="new-password"></label>${create?'<p>Запишите фразу офлайн. Для проверки введите слова №3 и №9.</p><input id="word3" aria-label="Слово 3" autocomplete="off"><input id="word9" aria-label="Слово 9" autocomplete="off">':''}<label class="check"><input id="backupCheck" type="checkbox">Я сохранил(а) фразу. Без неё восстановление после удаления приложения невозможно.</label><button id="saveWallet">Сохранить кошелёк</button><p class="foot">Фраза не отправляется на ноду. Не используйте фразу, опубликованную в чате или интернете.</p>`);
  if(adding){$('password').closest('label').firstChild.textContent='Текущий пароль приложения';$('repeat').closest('label').hidden=true;}
  if(!create){const key=document.createElement('button');key.id='importKey';key.className='secondary';key.textContent='Вместо фразы: JSON / secretSeed';$('seed').closest('label').before(key);action('importKey',()=>keySetup(adding));}
  action('back',()=>{generated='';adding?home():welcome();});
  action('saveWallet',async()=>{
    const s=session,v=view,mnemonic=normalizeMnemonic($('seed').value),path=validatePath($('path').value.trim()),name=contactName($('name').value),password=$('password').value;
    validatePassword(password);if(!adding&&password!==$('repeat').value)throw Error('Пароли не совпадают.');
    if(!$('backupCheck').checked)throw Error('Сначала сохраните seed-фразу.');
    if(create&&($('word3').value.trim()!==generated.split(' ')[2]||$('word9').value.trim()!==generated.split(' ')[8]))throw Error('Слова проверки не совпадают.');
    if(adding&&contactsError)throw Error('Сначала восстановите повреждённую адресную книгу.');
    const oldSecret=adding?await decryptVault(vault,password):null,nextSecret=addWallet(oldSecret,mnemonic,path),nextAddress=nextSecret.wallets.at(-1).address;
    const encrypted=await encryptVault(nextSecret,password);
    if(s!==session||v!==view)throw Error('Создание отменено.');
    await native('save',encrypted);vault=encrypted;generated='';biometric.enabled=false;
    contacts=saveContact(adding?contacts:[],name,nextAddress,contacts.some(e=>e.address===nextAddress)?nextAddress:null);await native('saveContacts',writeContacts(contacts));
    settings={...settings,selectedAddress:nextAddress};await native('saveSettings',JSON.stringify(settings));
    await unlock(password,false);message('Кошелёк сохранён. Баланс ещё не запрашивался. После изменения хранилища биометрию нужно включить заново.');
  });
}
function locked(autoBio=false){
  render(`<div class="badge">DIFFPOOL NUMEN · ${VERSION}</div><h1>Открыть кошелёк</h1><label>Пароль<input id="unlockPassword" type="password" autocomplete="off"></label><button id="unlock">Открыть</button>${biometric.enabled?'<button id="bioUnlock" class="secondary">Войти по биометрии</button>':''}<p class="foot">После входа баланс запрашивается автоматически только при включённом автообновлении. Ключи, адресная книга и журнал защищены на устройстве.</p>`);
  action('unlock',()=>unlock($('unlockPassword').value));action('bioUnlock',async()=>unlock(await native('biometricUnlock')));
  if(autoBio&&biometric.enabled)$('bioUnlock').click();
}
async function unlock(password,notify=true){
  const s=session,v=view,secret=await decryptVault(vault,password);
  const nextAccounts=secret.wallets.map(e=>({address:e.address,path:e.path,type:e.type||'sr25519',rawSeed:!!e.secretSeed}));clearSecret(secret);
  if(s!==session||v!==view)throw Error('Вход отменён.');
  const [rawCache,rawBook,rawHistory,rawSettings,rawTransfers]=await Promise.all(['loadCache','loadContacts','loadHistory','loadSettings','loadTransfers'].map(a=>native(a).then(value=>({value})).catch(error=>({error}))));
  if(s!==session||v!==view)throw Error('Вход отменён.');
  accounts=nextAccounts;address=nextAccounts[0].address;cache=null;contacts=[];journal=[];transferPages=[];journalError=false;contactsError=false;
  lastBalanceAttempt={key:'',at:0};
  const warnings=[];
  try{if(rawBook.error)throw rawBook.error;contacts=readContacts(rawBook.value);}catch{contactsError=true;warnings.push('Книга повреждена; перезапись запрещена.');}
  try{if(rawHistory.error)throw rawHistory.error;journal=readHistory(rawHistory.value);}catch{journalError=true;warnings.push('Журнал недоступен. Отправка заблокирована.');}
  try{if(rawSettings.error)throw rawSettings.error;const data=rawSettings.value?JSON.parse(rawSettings.value):{};settings=walletSettings(data);if(data.autoRefreshVersion!==1){await native('saveSettings',JSON.stringify(settings));alive(s,v);}}catch{warnings.push('Настройки недоступны; выбран официальный RPC.');settings=walletSettings();}
  alive(s,v);
  try{if(rawTransfers.error)throw rawTransfers.error;transferPages=readTransferCache(rawTransfers.value);}catch{warnings.push('Сохранённая история недоступна; попробуем загрузить заново.');}
  address=accounts.some(e=>e.address===settings.selectedAddress)?settings.selectedAddress:accounts[0].address;
  try{if(rawCache.error)throw rawCache.error;const data=rawCache.value?JSON.parse(rawCache.value):null;if(data?.address===address&&data.genesis===NETWORK.genesis&&data.endpoint===settings.endpoint)cache=data;}catch{warnings.push('Сохранённый баланс недоступен.');}
  if(cache?.endpoint!==settings.endpoint)cache=null;
  await bioStatus();alive(s,v);home();
  if(warnings.length)message(warnings.join(' '),true);else if(notify)message(settings.autoRefresh?'Кошелёк открыт. Автообновление включено.':'Открыто офлайн. Для свежего баланса нажмите «Обновить» или включите автообновление.');
  await resumeImport();
}
function home(){
  if(!address)return;
  prepared=null;
  render(`<div class="top"><div class="brand">NUMEN<small>DIFFPOOL WALLET</small></div><div class="toolbar"><button id="settings" class="small secondary">Настройки</button><button id="lock" class="small secondary">Закрыть</button></div></div><section class="card wallet-overview"><div class="badge">MAINNET · ${VERSION} BETA</div><button id="rename" class="wallet-name">${esc(nameOf(address))} ✎</button><h1 id="balance">${cache?esc(formatAmount(cache.free)):'—'} <small>NUMN</small></h1><div class="address-line"><span id="address" class="compact-address">${esc(shorten(address))}</span><button id="copy" class="small secondary">Копия</button></div><p class="foot" id="lastUpdate">${cache?'Сохранённый снимок: '+esc(new Date(cache.updatedAt).toLocaleString())+'. Не текущий баланс.':'Баланс ещё не проверен.'}</p>${cache?`<p class="foot">Доступно до комиссии: ${esc(formatAmount(cache.available))} NUMN<br>Резерв/блокировки учитываются. Высота ${cache.height}, финализировано ${cache.finalizedHeight}.</p>`:''}<button id="refresh">Обновить баланс и отправки</button><div class="actions"><button id="receive" class="secondary">Получить</button><button id="send" ${journalError?'disabled':''}>Отправить</button></div></section><section class="card"><h2>Отправки из приложения</h2><p class="foot">Локальный журнал отправок с телефона. Входящие, отправки с других устройств и награды доступны по кнопке истории адреса.</p>${historyRows(5)}<button id="history" class="secondary">Все локальные отправки</button><button id="explorer" class="secondary">Вся история адреса · внутри кошелька</button></section><button id="contacts" class="secondary">Адресная книга · ${contacts.length}</button><p class="foot">RPC: ${esc(settings.endpoint)}<br>Комиссия разработчика: 0%. Сетевая комиссия остаётся.</p>`);
  const networkHistory=document.createElement('section');networkHistory.className='card';networkHistory.id='networkHistory';
  const incomingPage=transferPages.find(p=>p.address===address&&p.kind==='incoming');
  networkHistory.innerHTML=`<h2>Последние входящие</h2><section id="incomingPreview">${incomingPage?(incomingPage.rows.length?incomingPage.rows.slice(0,3).map(r=>`<details class="transfer"><summary><div class="transfer-info"><strong>${r.from===address?'Себе':'Входящий'}</strong><small>${esc(new Date(r.timestamp).toLocaleString())}</small></div><span class="transfer-amount">${r.from===address?'':'+'}${esc(formatAmount(r.amount))} NUMN</span></summary><div class="transfer-detail"><p>Отправитель</p><p class="address">${esc(r.from)}</p><p>Блок #${r.height} · финализировано по данным индексатора</p></div></details>`).join(''):'<p>В проиндексированной истории входящих пока нет.</p>'):'<p>Входящие ещё не загружены.</p>'}</section><p id="incomingUpdate" class="foot">${incomingPage?'Сохранённая история: '+esc(new Date(incomingPage.updatedAt).toLocaleString())+'. ':''}Индексатор может отставать от баланса. Полная история — по 20 записей за страницу.</p><div class="actions"><button id="incoming">Все входящие</button></div>`;
  $('app').querySelector('.wallet-overview').after(networkHistory);$('explorer').textContent='Все переводы';networkHistory.querySelector('.actions').append($('explorer'));
  action('incoming',()=>networkHistoryScreen('incoming'));
  const auto=document.createElement('button');auto.id='autoBalance';auto.className='secondary';auto.textContent='Автообновление · '+(settings.autoRefresh?'вкл., раз в минуту':'выключено');networkHistory.append(auto);
  action('autoBalance',async()=>{const s=session,v=view,next={...settings,autoRefresh:!settings.autoRefresh};await native('saveSettings',JSON.stringify(next));alive(s,v);settings=next;if(next.autoRefresh)lastBalanceAttempt={key:'',at:0};home();});
  if(settings.autoRefresh){const key=settings.endpoint+'/'+address,at=lastBalanceAttempt.key===key?lastBalanceAttempt.at:0;scheduleViewRefresh(refresh,Math.max(1000,at+AUTO_REFRESH_MS-Date.now()));}
  action('copy',()=>native('copy',address));action('lock',()=>lock());action('settings',()=>settingsScreen());action('rename',()=>editContact(address,nameOf(address)));
  const picker=document.createElement('section');picker.className='wallet-picker';picker.innerHTML=`<label>Активный кошелёк<select id="walletSelect">${accounts.map(e=>`<option value="${esc(e.address)}" ${e.address===address?'selected':''}>${esc(nameOf(e.address))} · ${esc(shorten(e.address))}</option>`).join('')}</select></label><div class="actions"><button id="addWallet" class="secondary">+ Создать</button><button id="importWallet" class="secondary">+ Импортировать</button></div>`;$('app').querySelector('.wallet-overview').before(picker);
  $('walletSelect').onchange=async()=>{try{const selected=$('walletSelect').value;if(!accounts.some(e=>e.address===selected))throw Error('Неизвестный кошелёк.');const s=session,v=view,next={...settings,selectedAddress:selected};await native('saveSettings',JSON.stringify(next));alive(s,v);await closeChain();alive(s,v);settings=next;address=selected;cache=null;lastBalanceAttempt={key:'',at:0};home();message(settings.autoRefresh?'Обновляем баланс и входящие выбранного кошелька.':'Кошелёк переключён. Автообновление выключено.');}catch(e){message(e.message,true);}};
  action('addWallet',()=>setup(true,true));action('importWallet',()=>setup(false,true));
  const watch=document.createElement('button');watch.id='addWatch';watch.className='secondary';watch.textContent='+ По адресу · только просмотр';picker.append(watch);action('addWatch',()=>watchSetup(true));
  action('receive',()=>receive());action('send',()=>sendScreen());action('contacts',()=>book());action('history',()=>historyScreen());action('explorer',()=>networkHistoryScreen());action('refresh',refresh);
  const scan=document.createElement('button');scan.id='scanQr';scan.className='icon-button secondary';scan.title='Сканировать QR получателя';scan.setAttribute('aria-label','Сканировать QR получателя');scan.innerHTML=qrIcon;scan.disabled=watchOnly();$('copy').after(scan);action('scanQr',()=>scanScreen());
  $('refresh').textContent='Обновить баланс и переводы';
  if(watchOnly()){$('send').disabled=true;$('send').textContent='Только просмотр';const note=document.createElement('p');note.className='foot';note.textContent='Только просмотр · ключ на этом устройстве отсутствует';$('rename').after(note);const key=document.createElement('button');key.id='upgradeWatch';key.className='secondary';key.textContent='Импортировать ключ этого адреса';$('send').parentElement.after(key);action('upgradeWatch',()=>keySetup(true,address));}
}
async function refresh(){
  if(refreshing?.s===session&&refreshing?.v===view)return;
  const s=session,v=view,owner=address,run={s,v};refreshing=run;
  lastBalanceAttempt={key:settings.endpoint+'/'+owner,at:Date.now()};message('Обновляем баланс и входящие…');
  try{
  const errors=[];
  await Promise.all([
    (async()=>{try{const snapshot=await getChain().snapshot(owner);alive(s,v);cache={...snapshot,genesis:NETWORK.genesis,endpoint:settings.endpoint};await native('saveCache',JSON.stringify(cache));}catch(e){errors.push('Баланс: '+e.message);}})(),
    (async()=>{try{
      const api=new TransferHistory(data=>native('historyRequest',data)),anchor=await api.meta();alive(s,v);
      const page=await api.page(owner,'incoming',anchor);alive(s,v);
      const pages=rememberPage(transferPages,page);await native('saveTransfers',writeTransferCache(pages));alive(s,v);transferPages=pages;
    }catch(e){errors.push('Входящие: '+e.message);}})(),
  ]);
  alive(s,v);
  if(!journalError&&journal.some(e=>['unknown','submitted'].includes(e.status))){
    try{const updated=await getChain().reconcile(journal,address);alive(s,v);await persistJournal(writeHistory(updated));journal=updated;}catch(e){errors.push('Отправки: '+e.message);}
  }
  alive(s,v);home();message(errors.length?errors.join(' ')+' Последние сохранённые данные оставлены.':'Баланс проверен. Входящие и журнал отправок обновлены.',!!errors.length);
  }finally{if(refreshing===run)refreshing=null;}
}
function historyRows(limit=500){
  const statuses={submitted:'Принято RPC, ещё не подтверждено',unknown:'Исход неизвестен — проверьте',finalized:'Финализировано · успешно',failed:'Финализировано · ошибка выполнения',expired:'Срок истёк · в финализированных блоках не найдена'};
  const rows=journal.filter(e=>e.address===address).slice(0,limit);
  return rows.length?rows.map(e=>`<details class="transfer"><summary><div class="transfer-info"><strong>${esc(shorten(e.recipient))}</strong><small>${esc(statuses[e.status])}</small></div><span class="transfer-amount">−${esc(formatAmount(e.amount))} NUMN</span></summary><div class="transfer-detail"><p class="address">${esc(e.recipient)}</p><p class="address">${esc(e.id)}</p><p>Nonce ${esc(e.nonce)} · ${esc(new Date(e.createdAt).toLocaleString())}</p>${e.block?`<p>Блок ${e.block}, extrinsic ${e.block}-${e.extrinsicIndex}</p>`:''}<p>Оценка комиссии: ${esc(formatAmount(e.fee))} NUMN. Это не подтверждение её фактического списания.</p></div></details>`).join(''):'<p class="muted">Локальных отправок нет. Это не означает, что адрес не использовался.</p>';
}
function historyScreen(){render(`${header('Локальный журнал')}<p class="foot">Ожидающий перевод блокирует новую отправку до проверки. При сетевой ошибке не создавайте дубликат. Проверяются только финализированные блоки, по 12 за обновление.</p>${historyRows()}<button id="refreshHistory">Проверить отправки</button>`);back();action('refreshHistory',refresh);}
async function receive(){
  const current=address;render(`${header('Получить NUMN')}<div class="card centered"><canvas id="qr"></canvas><p class="address">${esc(current)}</p><button id="copy">Скопировать адрес</button><button id="shareQr" class="secondary" disabled>Поделиться QR</button></div><p class="foot">QR содержит только публичный адрес, не ключ. Только родной NUMEN Mainnet (nu…). Не отправляйте EVM-токены на этот QR.</p>`);back();action('copy',()=>native('copy',current));
  const s=session,v=view;await QRCode.toCanvas($('qr'),current,{width:280,margin:4,errorCorrectionLevel:'M'});alive(s,v);$('shareQr').disabled=false;
  action('shareQr',async()=>{const png=await QRCode.toDataURL(current,{width:640,margin:4,errorCorrectionLevel:'M'});alive(s,v);await native('shareQr',{address:current,png});});
}
async function scanScreen(draft=null){
  if(watchOnly())throw Error('Для перевода выберите кошелёк с ключом.');
  render(`${header('Сканировать QR')}<p>Наведите камеру на QR адреса NUMEN.</p><video id="qrCamera" class="qr-camera" autoplay muted playsinline></video><p class="foot">Распознавание только на телефоне. QR подставляет получателя, но не подписывает и не отправляет перевод. Подключение к сайтам (WalletConnect) пока не поддерживается.</p><button id="cancelScan" class="secondary">Отмена</button>`);
  const s=session,v=view,cancel=()=>draft?sendScreen(draft.recipient,draft.amount):home();action('back',cancel);action('cancelScan',cancel);
  const scanner=cameraScanner($('qrCamera'),{
    onRead(value){if(s!==session||v!==view)return;let recipient;try{recipient=qrRecipient(value);}catch(e){message(e.message,true);return;}void sendScreen(recipient,draft?.amount||'').catch(e=>{if(s===session)message(e.message,true);});},
    onError(error){if(s===session&&v===view)message(error,true);},
  });
  viewCleanup=()=>{scanner.stop();void native('endQrScan').catch(()=>{});};
  try{await native('beginQrScan');alive(s,v);await scanner.start();}catch(e){scanner.stop();if(s===session&&v===view)message(e.message,true);}
}
function book(){const entries=[...accounts.map(e=>({address:e.address,name:nameOf(e.address),own:true,watch:e.type==='watch'})),...contacts.filter(e=>!accounts.some(w=>w.address===e.address))];render(`${header('Адресная книга')}<p class="foot">Названия хранятся только на телефоне. Свои и наблюдаемые кошельки добавляются автоматически.</p>${entries.map((e,i)=>`<button id="contact${i}" class="secondary">${esc(e.name)}${e.watch?' · Только просмотр':e.own?' · Мой кошелёк':''}<br><small>${esc(shorten(e.address))}</small></button>`).join('')}<button id="addContact" ${contactsError?'disabled':''}>Добавить адрес</button>`);back();action('addContact',()=>editContact());entries.forEach((e,i)=>action('contact'+i,()=>editContact(e.address,e.name)));}
function editContact(original='',name=''){
  render(`${header('Запись в книге')}<label>Название<input id="contactName" value="${esc(name)}" maxlength="60"></label><label>Адрес nu…<textarea id="contactAddress" rows="3">${esc(original)}</textarea></label><button id="saveContact" ${contactsError?'disabled':''}>Сохранить</button>${original?'<button id="payContact" class="secondary">Отправить на этот адрес</button><label class="check"><input id="deleteContactCheck" type="checkbox">Удалить запись из книги</label><button id="deleteContact" class="secondary danger">Удалить запись</button>':''}`);back();
  action('saveContact',async()=>{if(contactsError)throw Error('Перезапись повреждённой книги запрещена.');const s=session,v=view,next=saveContact(contacts,$('contactName').value,$('contactAddress').value,contacts.some(e=>e.address===original)?original:null);await native('saveContacts',writeContacts(next));alive(s,v);contacts=next;book();});
  if(accounts.some(e=>e.address===original)){$('contactAddress').readOnly=true;$('deleteContact').hidden=true;$('deleteContactCheck').closest('label').hidden=true;}
  action('payContact',()=>sendScreen(original));action('deleteContact',async()=>{if(contactsError||!$('deleteContactCheck').checked)throw Error('Подтвердите удаление записи.');const s=session,v=view,next=contacts.filter(e=>e.address!==original);await native('saveContacts',writeContacts(next));alive(s,v);contacts=next;book();});
}
async function sendScreen(recipient='',amount=''){
  if(watchOnly())throw Error('Этот адрес добавлен только для просмотра. Для отправки импортируйте его собственную seed-фразу.');
  if(journalError)throw Error('Журнал недоступен; отправка заблокирована.');
  render(`${header('Отправить NUMN')}<p id="freshBalance" class="muted">Проверяем доступный баланс…</p><label>Получатель nu…<textarea id="recipient" rows="3">${esc(recipient)}</textarea></label><label>Из адресной книги<select id="recipientContact"><option value="">Выберите получателя</option>${contacts.filter(e=>e.address!==address).map(e=>`<option value="${esc(e.address)}">${esc(e.name)}</option>`).join('')}</select></label><label>Сумма NUMN<input id="amount" inputmode="decimal" autocomplete="off"></label><button id="prepare" disabled>Рассчитать комиссию</button><p class="foot">Используется transferKeepAlive: остаток для существования счёта сохраняется. В предпросмотре — оценка сетевой комиссии с резервом 20%, а не дополнительная комиссия кошелька.</p>`);back();
  $('recipientContact').onchange=()=>{$('recipient').value=$('recipientContact').value;};
  $('amount').value=amount;
  const scan=document.createElement('button');scan.id='scanRecipient';scan.className='secondary qr-action';scan.innerHTML=qrIcon+'<span>Сканировать QR получателя</span>';$('recipient').closest('label').after(scan);
  action('scanRecipient',()=>scanScreen({recipient:$('recipient').value,amount:$('amount').value}));
  const source=document.createElement('p');source.className='foot';source.textContent=`Списать с: ${nameOf(address)} · ${address}`;$('freshBalance').before(source);
  action('prepare',async()=>{const s=session,v=view;message('Повторно проверяем баланс и nonce…');const next=await getChain().prepare(address,validateRecipient($('recipient').value),$('amount').value,journal);alive(s,v);prepared=next;confirmScreen();});
  const s=session,v=view;
  try{const snapshot=await getChain().snapshot(address);alive(s,v);$('freshBalance').textContent=`Проверено: ${formatAmount(snapshot.available)} NUMN до комиссии. Блок ${snapshot.height}.`;$('prepare').disabled=false;}catch(e){if(s===session&&v===view){$('freshBalance').textContent='Свежий баланс не получен. Вернитесь назад и повторите.';message(e.message,true);}}
}
function confirmScreen(){
  const intent=prepared.intent;
  render(`${header('Проверьте перевод')}<dl><dt>Сеть</dt><dd>NUMEN Mainnet</dd><dt>Получатель</dt><dd class="address">${esc(intent.recipient)}</dd><dt>Сумма</dt><dd>${formatAmount(intent.amount)} NUMN</dd><dt>Оценка сетевой комиссии</dt><dd>${formatAmount(intent.fee)} NUMN</dd><dt>Баланс проверяется с резервом на комиссию</dt><dd>${formatAmount(intent.feeBudget)} NUMN</dd><dt>Нода</dt><dd>${esc(intent.endpoint)}</dd></dl>${biometric.enabled?'<button id="confirmBio">Подтвердить биометрией</button>':''}<label>Пароль для этой отправки<input id="sendPassword" type="password" autocomplete="off"></label><button id="confirmPassword">Подтвердить и отправить</button><p class="foot">Предпросмотр действует не более 90 секунд. Принятие RPC не означает включение в блок. При неизвестном исходе перевод автоматически не повторяется.</p>`);back();
  action('confirmPassword',()=>sendPrepared(false));action('confirmBio',()=>sendPrepared(true));
  const source=document.createElement('p');source.className='address';source.textContent=`Отправитель: ${nameOf(intent.address)} · ${intent.address}`;$('app').querySelector('dl').before(source);
}
async function sendPrepared(useBio){
  if(busySend||!prepared)throw Error('Отправка уже выполняется или отменена.');
  busySend=true;const s=session,v=view,p=prepared,c=getChain();let pair=null;
  try{
    let password;
    if(useBio){const result=JSON.parse(await native('biometricConfirm',{txid:p.id,address:p.intent.recipient,amount:formatAmount(p.intent.amount),fee:formatAmount(p.intent.feeBudget),total:formatAmount(BigInt(p.intent.amount)+BigInt(p.intent.feeBudget))}));if(result.txid!==p.id)throw Error('Подтверждение не относится к этому переводу.');password=result.password;}
    else password=$('sendPassword').value;
    alive(s,v);const secret=await decryptVault(vault,password);password='';alive(s,v);
    try{pair=pairForWallet(secret,p.intent.address);}finally{clearSecret(secret);}
    message('Проверяем состояние сети и подписываем на телефоне…');
    const signed=await c.signPrepared(p,pair);pair.lock();pair=null;alive(s,v);
    // Once journal save starts, leaving this screen cannot make the transfer reusable.
    prepared=null;
    const result=await submitOnce(c,signed,journal,async raw=>{alive(s);await persistJournal(raw);if(s===session)journal=readHistory(raw);});
    alive(s,v);journal=result.entries;home();message(result.unknown?'Исход неизвестен. Не повторяйте отправку. '+result.error:'Транзакция принята RPC. Дождитесь проверки финализации в журнале.',result.unknown);
  }finally{if(pair)pair.lock();busySend=false;}
}
function settingsScreen(){
  render(`${header('Настройки')}<label>HTTPS RPC<input id="endpoint" value="${esc(settings.endpoint)}" autocomplete="off" spellcheck="false"></label><p class="foot">Можно указать свою защищённую ноду NUMEN Mainnet. Она увидит запрашиваемый адрес и подписанные транзакции, но не seed. Майнинговый порт 8010 не подходит. WSS для этой версии не используется. Автоматической смены ноды нет.</p><button id="saveEndpoint">Сохранить и проверить сеть</button><button id="defaultEndpoint" class="secondary">Официальный RPC</button><div class="card"><h2>Защита</h2><p>${biometric.enabled?'Биометрия включена.':biometric.available?'Защищённая биометрия доступна.':'Биометрия недоступна; используйте пароль.'}</p><label>Текущий пароль<input id="settingsPassword" type="password" autocomplete="off"></label>${biometric.available&&!biometric.enabled?'<button id="enableBio">Включить биометрию</button>':''}${biometric.enabled?'<button id="disableBio" class="secondary">Отключить биометрию</button>':''}<button id="showSeed" class="secondary">Показать seed после проверки пароля</button></div><details><summary>Удалить кошелёк с этого телефона</summary><p>Удалятся ключи, книга и журнал. Средства остаются в блокчейне; для восстановления нужна seed-фраза и путь вывода.</p><label>Введите УДАЛИТЬ<input id="deleteText" autocomplete="off"></label><button id="deleteWallet" class="secondary danger">Удалить локальные данные</button></details><p class="foot">${VERSION} beta · Android 9+ с WebView 100+.<br>Seed шифруется PBKDF2/AES-GCM и Android Keystore. Биометрия — per-use CryptoObject, не простой флаг. Нет аналитики, рекламы, внешних скриптов и комиссии разработчика.</p>`);back();
  action('defaultEndpoint',()=>{$('endpoint').value=NETWORK.rpc;});
  const auto=document.createElement('button');auto.id='toggleAutoRefresh';auto.className='secondary';auto.textContent='Автообновление баланса и входящих: '+(settings.autoRefresh?'вкл.':'выкл.');$('defaultEndpoint').after(auto);
  const autoInfo=document.createElement('p');autoInfo.className='foot';autoInfo.textContent='Раз в минуту, только выбранный адрес и открытый экран. При блокировке запросы прекращаются; на экране отправки автообновление не запускается. RPC и индексатор видят запрашиваемый адрес.';auto.after(autoInfo);
  action('toggleAutoRefresh',async()=>{const s=session,v=view,next={...settings,autoRefresh:!settings.autoRefresh};await native('saveSettings',JSON.stringify(next));alive(s,v);settings=next;if(next.autoRefresh)lastBalanceAttempt={key:'',at:0};settingsScreen();});
  if(watchOnly()){$('showSeed').disabled=true;$('showSeed').textContent='Только просмотр · seed-фразы здесь нет';}
  else if(accounts.find(e=>e.address===address)?.rawSeed)$('showSeed').textContent='Показать secretSeed после проверки пароля';
  action('saveEndpoint',async()=>{const s=session,v=view,endpoint=validateEndpoint($('endpoint').value),candidate=new Chain(endpoint,transport);try{await candidate.connect();alive(s,v);const next={...settings,endpoint};await native('saveSettings',JSON.stringify(next));await closeChain();settings=next;chain=candidate;cache=null;settingsScreen();message('Сеть проверена, RPC сохранён.');}catch(e){await candidate.close();throw e;}});
  action('enableBio',async()=>{const s=session,v=view,password=$('settingsPassword').value;await decryptVault(vault,password);alive(s,v);await native('biometricEnable',password);alive(s,v);await bioStatus();alive(s,v);settingsScreen();});
  action('disableBio',async()=>{await native('biometricDisable');await bioStatus();if(address)settingsScreen();});
  action('showSeed',async()=>{const s=session,v=view,secret=await decryptVault(vault,$('settingsPassword').value);try{alive(s,v);const selected=secret.wallets.find(e=>e.address===address);if(!selected||selected.type==='watch')throw Error('Ключ отсутствует.');render(`${header(selected.secretSeed?'Резервный secretSeed':'Резервная фраза')}<p class="address">${esc(address)}</p><p class="error">Секрет выбранного кошелька. Никому его не отправляйте. ${selected.secretSeed?'Это 32-байтный seed; восстановить из него исходную фразу нельзя.':'Другие кошельки могут иметь другие фразы.'}</p><textarea readonly rows="4" id="backupSeed">${esc(selected.secretSeed||selected.mnemonic)}</textarea><p>Путь: ${esc(selected.path||'(пустой)')}</p>`);back();}finally{clearSecret(secret);}});
  action('deleteWallet',async()=>{if($('deleteText').value!=='УДАЛИТЬ')throw Error('Введите УДАЛИТЬ.');if(journal.some(e=>['unknown','submitted'].includes(e.status)))throw Error('Есть непроверенная отправка. Сначала сохраните её хеш и проверьте результат; удаление сейчас заблокировано.');await decryptVault(vault,$('settingsPassword').value);await native('delete');vault='';biometric={available:false,enabled:false};await lock();welcome();});
}
async function lock(){session++;address=null;accounts=[];cache=null;contacts=[];journal=[];transferPages=[];prepared=null;vault?locked(false):welcome();await closeChain();}
globalThis.appBackground=()=>{void lock();};
globalThis.appResume=()=>{if(vault&&!address)locked(true);else void resumeImport();};
async function start(){render('<h1>DiffPool NUMEN</h1><p>Подготавливаем криптографию…</p>');await initCrypto();vault=await native('load');await bioStatus();vault?locked(true):welcome();}
start().catch(e=>{render('<h1>Не удалось запустить</h1><p>Нужен Android APK и актуальный System WebView. Данные не отправлялись.</p>');message(e.message,true);});
