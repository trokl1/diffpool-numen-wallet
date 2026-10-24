package xyz.diffpool.numen;

import static xyz.diffpool.numen.LocaleText.t;

import android.app.Activity;
import android.app.KeyguardManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.function.IntPredicate;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Per-use strong-biometric CryptoObject protects a password envelope, never a boolean gate. */
final class BiometricVault {
 interface Result { void reply(int id, boolean ok, String value); }
 private static final String ALIAS="diffpool.numen.biometric.v1";
 private final Activity activity;
 private final File file, vault;
 private final IntPredicate validSession;
 private final Result result;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private Session active;
 private static final class Session {
  int id; boolean enabling; Cipher cipher; byte[] plaintext, ciphertext, binding;
  String txid,address,amount,fee,total;
  CancellationSignal signal=new CancellationSignal(); Runnable timeout;
 }
 BiometricVault(Activity activity,File vault,IntPredicate validSession,Result result){
  this.activity=activity;this.vault=vault;this.validSession=validSession;this.result=result;
  file=new File(activity.getNoBackupFilesDir(),"biometric-password.bin");
 }
 private KeyStore store() throws Exception {KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);return ks;}
 private int availability(){
  KeyguardManager kg=activity.getSystemService(KeyguardManager.class);
  if(kg==null||!kg.isDeviceSecure())return 11;
  if(Build.VERSION.SDK_INT>=30){BiometricManager m=activity.getSystemService(BiometricManager.class);return m==null?12:m.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);}
  if(Build.VERSION.SDK_INT>=29){BiometricManager m=activity.getSystemService(BiometricManager.class);return m==null?12:m.canAuthenticate();}
  FingerprintManager fp=activity.getSystemService(FingerprintManager.class);
  if(fp!=null&&fp.isHardwareDetected()&&fp.hasEnrolledFingerprints())return 0;
  return 11;
 }
 String status() throws Exception {
  int code=availability();
  return new JSONObject().put("available",code==0).put("enabled",file.exists()&&store().containsAlias(ALIAS))
   .put("reason",code==0?"":t("Добавьте отпечаток или защищённую биометрию и блокировку экрана в настройках Android.")).toString();
 }
 synchronized void remove() throws Exception {new AtomicFile(file).delete();KeyStore ks=store();if(ks.containsAlias(ALIAS))ks.deleteEntry(ALIAS);}
 private SecretKey newKey() throws Exception {
  remove();KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
  KeyGenParameterSpec.Builder spec=new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
   .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
   .setKeySize(256).setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(true)
   .setInvalidatedByBiometricEnrollment(true);
  if(Build.VERSION.SDK_INT>=30)spec.setUserAuthenticationParameters(0,KeyProperties.AUTH_BIOMETRIC_STRONG);
  else spec.setUserAuthenticationValidityDurationSeconds(-1);
  gen.init(spec.build());return gen.generateKey();
 }
 private byte[] binding() throws Exception {
  byte[] bytes=new AtomicFile(vault).readFully();
  try{return MessageDigest.getInstance("SHA-256").digest(bytes);}finally{Arrays.fill(bytes,(byte)0);}
 }
 void enable(int id,String password){
  byte[] plain=password.getBytes(StandardCharsets.UTF_8);
  activity.runOnUiThread(()->start(id,plain,true,null));
 }
 void unlock(int id){activity.runOnUiThread(()->start(id,null,false,null));}
 void confirm(int id,String txid,String address,String amount,String fee,String total){
  Session transaction=new Session();transaction.txid=txid;transaction.address=address;transaction.amount=amount;transaction.fee=fee;transaction.total=total;
  activity.runOnUiThread(()->start(id,null,false,transaction));
 }
 private void start(int id,byte[] plain,boolean enabling,Session transaction){
  if(active!=null){if(plain!=null)Arrays.fill(plain,(byte)0);result.reply(id,false,t("Биометрический запрос уже открыт."));return;}
  Session s=transaction==null?new Session():transaction;s.id=id;s.enabling=enabling;s.plaintext=plain;active=s;
  try{
   if(!validSession.test(s.id)||activity.isFinishing()||activity.isDestroyed())throw new IOException(t("Приложение заблокировано."));
   if(availability()!=0)throw new IOException(t("Нет доступной защищённой биометрии. Настройте её в Android или используйте пароль."));
   s.cipher=Cipher.getInstance("AES/GCM/NoPadding");
   if(enabling){
    if(plain==null||plain.length<10||plain.length>10000)throw new IOException(t("Неверный пароль."));
    s.cipher.init(Cipher.ENCRYPT_MODE,newKey());
   }else{
    byte[] saved=new AtomicFile(file).readFully();
    if(saved.length<29||saved.length>12000)throw new IOException(t("Биометрический вход нужно настроить заново."));
    s.ciphertext=Arrays.copyOfRange(saved,12,saved.length);
    SecretKey key=(SecretKey)store().getKey(ALIAS,null);
    if(key==null)throw new IOException(t("Биометрический ключ недоступен. Войдите по паролю."));
    s.cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Arrays.copyOfRange(saved,0,12)));
    Arrays.fill(saved,(byte)0);
   }
   s.binding=binding();
   BiometricPrompt.Builder prompt=new BiometricPrompt.Builder(activity)
    .setTitle(enabling?t("Включить биометрический вход"):s.txid!=null?t("Подтвердить отправку NUMN"):t("Открыть DiffPool NUMEN"))
    .setSubtitle(s.txid!=null?s.amount+" NUMN":t("Подтвердите отпечатком или защищённой биометрией"))
    .setNegativeButton(t("Отмена"),activity.getMainExecutor(),(dialog,which)->cancel(t("Биометрия отменена. Можно использовать пароль.")));
   if(Build.VERSION.SDK_INT>=30)prompt.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
   if(s.txid!=null)prompt.setDescription(t("Получатель:\n")+s.address+t("\nОценка комиссии: ")+s.fee+t(" NUMN\nВсего: ")+s.total+" NUMN");
   s.timeout=()->cancel(t("Время подтверждения истекло. Попробуйте ещё раз или используйте пароль."));
   handler.postDelayed(s.timeout,90000);
   prompt.build().authenticate(new BiometricPrompt.CryptoObject(s.cipher),s.signal,activity.getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){
    @Override public void onAuthenticationError(int code,CharSequence message){finish(s,false,t("Биометрия: ")+message+t(". Можно использовать пароль."));}
    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult authentication){
     if(active!=s)return;
     try{
      if(!validSession.test(s.id)||activity.isFinishing()||activity.isDestroyed())throw new IOException(t("Приложение заблокировано."));
      if(authentication.getCryptoObject()==null||authentication.getCryptoObject().getCipher()==null)throw new IOException(t("Нет подтверждённой криптографической операции."));
      Cipher authenticated=authentication.getCryptoObject().getCipher();
      // Keystore per-use operations must receive their auth token before updateAAD too.
      authenticated.updateAAD(s.binding);
      if(s.enabling){
       byte[] encrypted=authenticated.doFinal(s.plaintext);
       AtomicFile atomic=new AtomicFile(file);FileOutputStream out=null;
       try{out=atomic.startWrite();out.write(authenticated.getIV());out.write(encrypted);atomic.finishWrite(out);}
       catch(Exception e){if(out!=null)atomic.failWrite(out);throw e;}
       finally{Arrays.fill(encrypted,(byte)0);}
       finish(s,true,"ok");
      }else{
       s.plaintext=authenticated.doFinal(s.ciphertext);
       String password=new String(s.plaintext,StandardCharsets.UTF_8);
       finish(s,true,s.txid==null?password:new JSONObject().put("password",password).put("txid",s.txid).toString());
      }
     }catch(Exception e){finish(s,false,t("Биометрический ключ недоступен. Войдите по паролю и включите биометрию заново."));}
    }
   });
  }catch(Exception e){finish(s,false,t("Не удалось открыть защищённую биометрию. Используйте пароль и настройте её заново."));}
 }
 private void finish(Session s,boolean ok,String value){
  if(active!=s)return;active=null;
  if(s.timeout!=null)handler.removeCallbacks(s.timeout);
  s.signal.cancel();
  if(s.plaintext!=null)Arrays.fill(s.plaintext,(byte)0);
  if(s.ciphertext!=null)Arrays.fill(s.ciphertext,(byte)0);
  if(s.binding!=null)Arrays.fill(s.binding,(byte)0);
  if(s.enabling&&!ok){try{remove();}catch(Exception ignored){}}
  result.reply(s.id,ok,value);
 }
 void cancel(String message){if(Looper.myLooper()!=Looper.getMainLooper()){activity.runOnUiThread(()->cancel(message));return;}if(active!=null)finish(active,false,message);}
}
