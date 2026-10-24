let sequence=0;
const calls=new Map();
export function native(action,data='') {
  return new Promise((resolve,reject)=>{
    if(!globalThis.Android?.call)return reject(Error('Для хранения ключей нужен Android APK. Браузерный режим не хранит кошелёк.'));
    const id=++sequence,timer=setTimeout(()=>{calls.delete(id);reject(Error(action==='request'?'RPC не ответил. Если это отправка — её исход неизвестен.':'Истекло время операции.'));},action.startsWith('biometric')?100000:40000);
    calls.set(id,{resolve,reject,timer});
    Android.call(id,action,JSON.stringify(data));
  });
}
globalThis.nativeResult=(id,ok,value)=>{
  const call=calls.get(id);if(!call)return;
  clearTimeout(call.timer);calls.delete(id);ok?call.resolve(value):call.reject(Error(value));
};
export async function transport(endpoint,method,params){
  const data=JSON.parse(await native('request',{endpoint,method,params}));
  if(data.jsonrpc!=='2.0'||data.id!==1)throw Error('Некорректный ответ RPC.');
  if(data.error)throw Error(`RPC: ${String(data.error.message).slice(0,250)}`);
  if(!Object.hasOwn(data,'result'))throw Error('В ответе RPC нет результата.');
  return data.result;
}
