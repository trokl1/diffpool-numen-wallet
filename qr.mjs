import jsQR from 'jsqr';
import {validateRecipient} from './core.mjs';

// QR is untrusted input: never open URLs, change RPC, import keys or sign it.
export function qrRecipient(value) {
  if(typeof value!=='string'||value.length>2048)throw Error('QR не содержит адрес NUMEN.');
  const text=value.trim();
  if(/^wc:/i.test(text))throw Error('Это QR подключения к сайту. WalletConnect пока не поддерживается; адрес получателя не изменён.');
  if(!/^nu[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(text))throw Error('Нужен QR с публичным адресом nu… сети NUMEN, не ссылка или ключ.');
  return validateRecipient(text);
}

export function decodeQr(pixels,width,height) {
  return jsQR(pixels,width,height,{inversionAttempts:'attemptBoth'})?.data??null;
}

export function cameraScanner(video,{onRead,onError,mediaDevices=navigator.mediaDevices}) {
  let stopped=false,stream=null,timer=null;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  function stop(){
    stopped=true;clearTimeout(timer);timer=null;
    if(stream)for(const track of stream.getTracks())track.stop();
    stream=null;video.pause();video.srcObject=null;canvas.width=canvas.height=0;
  }
  function frame(){
    if(stopped)return;
    try{
      if(video.readyState>=2&&video.videoWidth&&video.videoHeight){
        const ratio=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
        const width=Math.max(1,Math.round(video.videoWidth*ratio)),height=Math.max(1,Math.round(video.videoHeight*ratio));
        if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
        ctx.drawImage(video,0,0,width,height);
        const value=decodeQr(ctx.getImageData(0,0,width,height).data,width,height);
        if(value!==null)onRead(value);
      }
    }catch{onError('Не удалось прочитать кадр камеры. Закройте сканер и повторите.');stop();}
    if(!stopped)timer=setTimeout(frame,250);
  }
  async function start(){
    try{
      if(!mediaDevices?.getUserMedia)throw Error('unsupported');
      const next=await mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(stopped){for(const track of next.getTracks())track.stop();return;}
      stream=next;video.srcObject=stream;await video.play();
      if(!stopped)frame();
    }catch(e){
      if(!stopped)onError(e?.name==='NotAllowedError'?'Камера не разрешена. Разрешите её для DiffPool NUMEN в настройках Android и повторите.':'Камера недоступна. Адрес можно вставить вручную.');
      stop();
    }
  }
  return {start,stop};
}
