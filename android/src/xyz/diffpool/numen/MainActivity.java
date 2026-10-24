package xyz.diffpool.numen;

import android.app.Activity;
import android.os.Bundle;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.*;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

public final class MainActivity extends Activity {
 private WebView web;
 private final ExecutorService workers = Executors.newFixedThreadPool(4);
 private final ExecutorService local = Executors.newSingleThreadExecutor();
 private static final String ORIGIN = "https://wallet.local/";
 private static final String ALIAS = "diffpool.numen.vault.v1";
 private volatile boolean foreground = true;
 private volatile android.net.Uri importUri;
 private static final int IMPORT_FILE=8072;
 private BiometricVault biometric;
 private volatile boolean scanningQr=false;
 private PermissionRequest cameraRequest;
 private static final int CAMERA_PERMISSION=8073;

 @Override public void onCreate(Bundle saved) {
  super.onCreate(saved);
  biometric=new BiometricVault(this,vaultFile(),()->foreground,(id,ok,value)->result(id,ok,value));
  boolean qa = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
  if (!qa) getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
  getWindow().setStatusBarColor(Color.rgb(12,17,25));
  getWindow().setNavigationBarColor(Color.rgb(12,17,25));
  web = new WebView(this); web.setBackgroundColor(Color.rgb(12,17,25));
  web.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
  WebView.setWebContentsDebuggingEnabled(qa);
  WebSettings s = web.getSettings();
  s.setJavaScriptEnabled(true); s.setDomStorageEnabled(false);
  s.setAllowFileAccess(false); s.setAllowContentAccess(false);
  s.setAllowFileAccessFromFileURLs(false); s.setAllowUniversalAccessFromFileURLs(false);
  s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  s.setCacheMode(WebSettings.LOAD_NO_CACHE); s.setSaveFormData(false);
  s.setSupportMultipleWindows(false); s.setJavaScriptCanOpenWindowsAutomatically(false);
  CookieManager.getInstance().setAcceptCookie(false);
  web.addJavascriptInterface(new Bridge(), "Android");
  web.setWebViewClient(new WebViewClient() {
   @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
   @Override public void onReceivedSslError(WebView v, SslErrorHandler handler, android.net.http.SslError error) { handler.cancel(); }
   @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
    String url = r.getUrl().toString();
    Map<String,String> headers = new HashMap<>();
    headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
    headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; media-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    if (!url.startsWith(ORIGIN) || !r.getMethod().equals("GET")) return denied();
    String file = url.substring(ORIGIN.length()); if (file.isEmpty()) file = "index.html";
    if (!Arrays.asList("index.html", "app.js", "style.css").contains(file)) return denied();
    try {
     String mime = file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
     return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(file));
    } catch (IOException ex) { return denied(); }
   }
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public void onPermissionRequest(PermissionRequest request){
    String origin=request.getOrigin().toString();
    if(!foreground||!scanningQr||!(ORIGIN.equals(origin)||"https://wallet.local".equals(origin))||request.getResources().length!=1||!PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(request.getResources()[0])){request.deny();return;}
    cancelCameraRequest();cameraRequest=request;
    if(checkSelfPermission(android.Manifest.permission.CAMERA)==android.content.pm.PackageManager.PERMISSION_GRANTED)finishCameraPermission();
    else requestPermissions(new String[]{android.Manifest.permission.CAMERA},CAMERA_PERMISSION);
   }
   @Override public void onPermissionRequestCanceled(PermissionRequest request){if(cameraRequest==request)cameraRequest=null;}
  });
  setContentView(web); web.loadUrl(ORIGIN);
 }
 private WebResourceResponse denied() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
 private void cancelCameraRequest(){if(cameraRequest!=null){PermissionRequest old=cameraRequest;cameraRequest=null;old.deny();}}
 private void finishCameraPermission(){
  PermissionRequest request=cameraRequest;cameraRequest=null;if(request==null)return;
  if(foreground&&scanningQr&&checkSelfPermission(android.Manifest.permission.CAMERA)==android.content.pm.PackageManager.PERMISSION_GRANTED)request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
  else request.deny();
 }
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==CAMERA_PERMISSION)finishCameraPermission();}
 private SecretKey vaultKey() throws Exception {
  KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
  if (!store.containsAlias(ALIAS)) {
   KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
   gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
    .setKeySize(256).setRandomizedEncryptionRequired(true).build()); gen.generateKey();
  }
  return (SecretKey) store.getKey(ALIAS, null);
 }
 private File vaultFile() { return new File(getNoBackupFilesDir(), "vault.bin"); }
 private File historyFile() { return new File(getNoBackupFilesDir(),"history.bin"); }
 private File contactsFile() { return new File(getNoBackupFilesDir(),"address-book.bin"); }
 private synchronized void save(String encrypted, boolean cache) throws Exception {
  saveFile(cache ? new File(getNoBackupFilesDir(),"public-cache.bin") : vaultFile(),encrypted,cache ? 256000 : 32000);
 }
 private synchronized void saveFile(File target,String encrypted,int limit) throws Exception {
  if (encrypted.length() > limit) throw new IOException("Слишком большой файл хранилища");
  Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, vaultKey());
  cipher.updateAAD(("DiffPool NUMEN v1:"+target.getName()).getBytes(StandardCharsets.UTF_8));
  byte[] plain = encrypted.getBytes(StandardCharsets.UTF_8);
  byte[] bytes;
  try { bytes = cipher.doFinal(plain); } finally { Arrays.fill(plain, (byte)0); }
  android.util.AtomicFile file = new android.util.AtomicFile(target);
  FileOutputStream out = null;
  try { out = file.startWrite(); out.write(cipher.getIV()); out.write(bytes); file.finishWrite(out); }
  catch (Exception e) { if (out != null) file.failWrite(out); throw e; }
 }
 private synchronized String load(boolean cache) throws Exception {
  File target=cache ? new File(getNoBackupFilesDir(),"public-cache.bin") : vaultFile();
  return loadFile(target,cache ? 300000 : 40000);
 }
 private synchronized String loadFile(File target,int limit) throws Exception {
  if (!target.exists()) return "";
  byte[] data = new android.util.AtomicFile(target).readFully();
  if (data.length < 29 || data.length > limit) throw new IOException("Хранилище повреждено");
  Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
  cipher.init(Cipher.DECRYPT_MODE, vaultKey(), new GCMParameterSpec(128, Arrays.copyOfRange(data,0,12)));
  cipher.updateAAD(("DiffPool NUMEN v1:"+target.getName()).getBytes(StandardCharsets.UTF_8));
  byte[] plain = cipher.doFinal(Arrays.copyOfRange(data,12,data.length));
  try { return new String(plain, StandardCharsets.UTF_8); } finally { Arrays.fill(plain,(byte)0); }
 }
 private String request(JSONObject data) throws Exception {
  URL endpoint=new URL(data.getString("endpoint"));
  if(!endpoint.getProtocol().equals("https")||endpoint.getHost().isEmpty()||endpoint.getUserInfo()!=null||endpoint.getRef()!=null||endpoint.getQuery()!=null||endpoint.toString().length()>300)throw new IOException("Разрешён только HTTPS RPC без пароля/query.");
  String method=data.getString("method");JSONArray params=data.getJSONArray("params");
  if(!Arrays.asList("rpc_methods","system_chain","system_name","system_version","system_properties","system_health","system_accountNextIndex","chain_getBlockHash","chain_getHeader","chain_getFinalizedHead","chain_getBlock","state_getRuntimeVersion","state_getMetadata","state_getStorage","state_queryStorageAt","state_call","payment_queryInfo","payment_queryFeeDetails","author_submitExtrinsic").contains(method))throw new IOException("RPC-метод запрещён");
  if(params.toString().length()>262144)throw new IOException("Слишком большой RPC-запрос");
  if(method.equals("state_call")&&!params.getString(0).matches("Metadata_metadata(_versions|_at_version)?|TransactionPaymentApi_query_(info|fee_details)"))throw new IOException("Runtime API запрещён");
  boolean submitting=method.equals("author_submitExtrinsic");
  if(submitting&&(params.length()!=1||!params.getString(0).matches("0x([0-9a-fA-F]{2}){10,131072}")))throw new IOException("Неверная транзакция");
  if (!foreground) throw new IOException("Приложение заблокировано");
  String body=new JSONObject().put("jsonrpc","2.0").put("id",1).put("method",method).put("params",params).toString();
  HttpsURLConnection c = (HttpsURLConnection) endpoint.openConnection();
  try {
   c.setInstanceFollowRedirects(false); c.setConnectTimeout(12000); c.setReadTimeout(20000);
   c.setUseCaches(false);c.setRequestProperty("Cache-Control","no-cache, no-store");c.setRequestProperty("Pragma","no-cache");
   c.setRequestMethod("POST"); c.setRequestProperty("Accept", "application/json");
   c.setDoOutput(true); c.setRequestProperty("Content-Type","application/json");
   if(!foreground)throw new IOException("Приложение заблокировано");
   try (OutputStream out=c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
   int status = c.getResponseCode();
   if (status != 200) throw new IOException("RPC: HTTP "+status+(submitting ? ". Исход отправки неизвестен; не повторяйте перевод." : ""));
   try (InputStream in=c.getInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
    byte[] buffer = new byte[8192]; int n;
    while ((n=in.read(buffer)) != -1) { if (out.size()+n > 8000000) throw new IOException("Ответ API слишком большой"); out.write(buffer,0,n); }
    return new String(out.toByteArray(),StandardCharsets.UTF_8);
   }
  } finally { c.disconnect(); }
 }
 private void result(int id, boolean ok, String value) {
  runOnUiThread(() -> { if (!isDestroyed()) web.evaluateJavascript("window.nativeResult && window.nativeResult("+id+","+ok+","+JSONObject.quote(value)+")",null); });
 }
 public final class Bridge {
  @JavascriptInterface public void call(int id, String action, String json) {
   (action.equals("request")||action.equals("historyRequest")?workers:local).execute(() -> {
    try {
     if (!foreground) throw new IOException("Приложение заблокировано");
     String answer;
     switch(action) {
      case "beginQrScan": scanningQr=true;answer="ok";break;
      case "endQrScan": scanningQr=false;runOnUiThread(()->cancelCameraRequest());answer="ok";break;
      case "shareQr": {
       JSONObject data=new JSONObject(json);String address=data.getString("address"),png=data.getString("png");
       if(!address.matches("nu[1-9A-HJ-NP-Za-km-z]{40,60}")||png.length()>400000||!png.startsWith("data:image/png;base64,"))throw new IOException("Неверный QR адреса.");
       byte[] bytes=Base64.decode(png.substring(22),Base64.DEFAULT);
       android.graphics.BitmapFactory.Options bounds=new android.graphics.BitmapFactory.Options();bounds.inJustDecodeBounds=true;
       android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
       if(bounds.outWidth<128||bounds.outWidth>1024||bounds.outHeight!=bounds.outWidth||!"image/png".equals(bounds.outMimeType))throw new IOException("Неверное изображение QR.");
       android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length);
       if(bitmap==null)throw new IOException("Не удалось создать QR.");
       try{
        revokeUriPermission(QrShareProvider.URI,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        android.util.AtomicFile file=new android.util.AtomicFile(QrShareProvider.file(MainActivity.this));FileOutputStream out=null;
        try{out=file.startWrite();if(!bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out))throw new IOException();file.finishWrite(out);}
        catch(Exception e){if(out!=null)file.failWrite(out);throw new IOException("Не удалось подготовить QR.");}
       }finally{bitmap.recycle();}
       runOnUiThread(()->{
        if(!foreground){result(id,false,"Кошелёк заблокирован.");return;}
        android.content.Intent intent=new android.content.Intent(android.content.Intent.ACTION_SEND);intent.setType("image/png");
        intent.putExtra(android.content.Intent.EXTRA_STREAM,QrShareProvider.URI);intent.putExtra(android.content.Intent.EXTRA_TEXT,"Мой адрес NUMEN (NUMN): "+address);
        intent.setClipData(ClipData.newUri(getContentResolver(),"NUMEN address",QrShareProvider.URI));intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try{startActivity(android.content.Intent.createChooser(intent,"Поделиться QR адреса NUMEN"));result(id,true,"opened");}
        catch(Exception e){result(id,false,"Не удалось открыть меню «Поделиться».");}
       });return;
      }
      case "chooseImportFile": {
       runOnUiThread(()->{
        if(!foreground){result(id,false,"Приложение заблокировано");return;}
        importUri=null;
        android.content.Intent intent=new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);intent.setType("*/*");
        intent.putExtra(android.content.Intent.EXTRA_MIME_TYPES,new String[]{"application/json","text/plain","application/octet-stream"});
        intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try{startActivityForResult(intent,IMPORT_FILE);result(id,true,"opened");}catch(Exception e){result(id,false,"Не удалось открыть выбор файла");}
       });return;
      }
      case "importFileStatus": answer=importUri==null?"none":"selected";break;
      case "cancelImportFile": importUri=null;answer="ok";break;
      case "readImportFile": {
       android.net.Uri uri=importUri;importUri=null;
       if(uri==null||!"content".equals(uri.getScheme()))throw new IOException("Сначала выберите JSON-файл");
       try(InputStream in=getContentResolver().openInputStream(uri)){
        if(in==null)throw new IOException();answer=HistoryApi.read(in,16384);
       }catch(Exception e){throw new IOException("Не удалось прочитать JSON: проверьте доступ и размер до 16 КБ.");}
       break;
      }
      case "biometricStatus": answer=biometric.status(); break;
      case "biometricEnable": biometric.enable(id,(String)new JSONTokener(json).nextValue()); return;
      case "biometricUnlock": biometric.unlock(id); return;
      case "biometricConfirm": {
       JSONObject data=new JSONObject(json);
       String txid=data.getString("txid"),address=data.getString("address"),amount=data.getString("amount"),fee=data.getString("fee"),total=data.getString("total");
       if(!txid.matches("0x[0-9a-f]{64}")||!address.matches("nu[1-9A-HJ-NP-Za-km-z]{40,60}")||!amount.matches("[0-9]{1,21}(\\.[0-9]{1,18})?")||!fee.matches("[0-9]{1,21}(\\.[0-9]{1,18})?")||!total.matches("[0-9]{1,22}(\\.[0-9]{1,18})?"))throw new IOException("Неверные данные подтверждения перевода.");
       biometric.confirm(id,txid,address,amount,fee,total);return;
      }
      case "biometricDisable": biometric.cancel("Биометрический вход отключён."); biometric.remove(); answer="ok"; break;
      case "cancelBiometric": biometric.cancel("Биометрия отменена."); answer="ok"; break;
      case "load": answer=load(false); break;
      case "loadCache": answer=load(true); break;
      case "saveCache": save((String)new JSONTokener(json).nextValue(),true); answer="ok"; break;
      case "loadHistory": answer=loadFile(historyFile(),1000000); break;
      case "loadTransfers": answer=loadFile(new File(getNoBackupFilesDir(),"transfers.bin"),520000); break;
      case "saveTransfers": saveFile(new File(getNoBackupFilesDir(),"transfers.bin"),(String)new JSONTokener(json).nextValue(),512000);answer="ok";break;
      case "historyRequest": answer=HistoryApi.request(getAssets(),new JSONObject(json)); break;
      case "saveHistory": saveFile(historyFile(),(String)new JSONTokener(json).nextValue(),900000);answer="ok";break;
      case "loadContacts": answer=loadFile(contactsFile(),300000); break;
      case "saveContacts": {
       String book=(String)new JSONTokener(json).nextValue();JSONObject data=new JSONObject(book);
       if(data.getInt("v")!=1||data.getJSONArray("entries").length()>500)throw new IOException("Неверная адресная книга.");
       saveFile(contactsFile(),book,256000);answer="ok";break;
      }
      case "loadSettings": answer=loadFile(new File(getNoBackupFilesDir(),"settings.bin"),16000);break;
      case "saveSettings": saveFile(new File(getNoBackupFilesDir(),"settings.bin"),(String)new JSONTokener(json).nextValue(),12000);answer="ok";break;
      case "openExplorer": {
       String address=(String)new JSONTokener(json).nextValue();
       if(!address.matches("nu[1-9A-HJ-NP-Za-km-z]{40,60}"))throw new IOException("Неверный адрес");
       runOnUiThread(()->startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,android.net.Uri.parse("https://explorer.numen-network.org/account/"+address))));answer="ok";break;
      }
      case "save": biometric.remove(); save((String)new JSONTokener(json).nextValue(),false); answer="ok"; break;
      case "delete": biometric.cancel("Кошелёк удалён.");biometric.remove();new android.util.AtomicFile(vaultFile()).delete(); new android.util.AtomicFile(contactsFile()).delete();new android.util.AtomicFile(historyFile()).delete();for(String f:new String[]{"public-cache.bin","transfers.bin","settings.bin"})new android.util.AtomicFile(new File(getNoBackupFilesDir(),f)).delete(); KeyStore ks=KeyStore.getInstance("AndroidKeyStore"); ks.load(null); ks.deleteEntry(ALIAS); answer="ok"; break;
      case "request": answer=request(new JSONObject(json)); break;
      case "copy": {
       String text=(String)new JSONTokener(json).nextValue();
       if (!text.matches("nu[1-9A-HJ-NP-Za-km-z]{40,60}|0x[0-9a-f]{64}")) throw new IOException("Можно копировать только адрес и TXID");
       runOnUiThread(() -> {
        ClipboardManager cb=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        cb.setPrimaryClip(ClipData.newPlainText("NUMEN",text));
        web.postDelayed(() -> { if (cb.hasPrimaryClip() && cb.getPrimaryClip()!=null && cb.getPrimaryClip().getItemAt(0).getText()!=null && text.contentEquals(cb.getPrimaryClip().getItemAt(0).getText())) cb.clearPrimaryClip(); },60000);
       }); answer="ok"; break;
      }
      default: throw new IOException("Неизвестная команда");
     }
     result(id,true,answer);
    } catch(Exception e) { result(id,false,e.getMessage()==null ? "Ошибка защищённого хранилища" : e.getMessage()); }
   });
  }
 }
 @Override protected void onPause() { foreground=false;scanningQr=false;cancelCameraRequest();biometric.cancel("Приложение свёрнуто. Войдите снова."); web.evaluateJavascript("window.appBackground && window.appBackground()",null); super.onPause(); }
 @Override protected void onActivityResult(int request,int result,android.content.Intent data){
  super.onActivityResult(request,result,data);
  if(request==IMPORT_FILE){android.net.Uri uri=result==RESULT_OK&&data!=null?data.getData():null;importUri=uri!=null&&"content".equals(uri.getScheme())?uri:null;}
 }
 @Override protected void onResume() { super.onResume(); foreground=true;if(web!=null)web.evaluateJavascript("window.appResume && window.appResume()",null); }
 @Override public void onBackPressed() { web.evaluateJavascript("window.appBackground && window.appBackground()",null); super.onBackPressed(); }
 @Override protected void onDestroy() { biometric.cancel("Приложение закрыто.");workers.shutdownNow();local.shutdownNow(); web.removeJavascriptInterface("Android"); web.destroy(); super.onDestroy(); }
}

