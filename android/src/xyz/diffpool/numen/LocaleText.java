package xyz.diffpool.numen;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.regex.*;
import org.json.JSONObject;

/** Device-local language preference. Contains no account or secret data. */
final class LocaleText {
 private static volatile String language="ru";
 private static JSONObject english=new JSONObject();
 private static AtomicFile preference;
 private static final Pattern PARTS=Pattern.compile("[^<>\"'\\r\\n]+|[<>\"'\\r\\n]");
 static void init(Context context) {
  preference=new AtomicFile(new File(context.getNoBackupFilesDir(),"language.txt"));
  try(InputStream input=context.getAssets().open("language-en.json")){
   ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;
   while((n=input.read(buffer))!=-1){if(out.size()+n>150000)throw new IOException();out.write(buffer,0,n);}
   english=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
  }catch(Exception ignored){english=new JSONObject();}
  try(InputStream input=preference.openRead()){
   // Bounded read even if a corrupted preference is unexpectedly large.
   byte[] bytes=new byte[3];int n=input.read(bytes);
   language=n==2&&bytes[0]=='e'&&bytes[1]=='n'?"en":"ru";
  }catch(Exception ignored){language="ru";}
 }
 static String language(){return language;}
 static synchronized void save(String value) throws IOException {
  if(!value.equals("ru")&&!value.equals("en"))throw new IOException("Unsupported language");
  FileOutputStream out=null;
  try{out=preference.startWrite();out.write(value.getBytes(StandardCharsets.UTF_8));preference.finishWrite(out);language=value;}
  catch(Exception e){if(out!=null)preference.failWrite(out);throw new IOException(t("Не удалось сохранить язык."));}
 }
 // Only called with application-owned literals, never secrets, RPC responses,
 // addresses or amounts. This matches the JS static-fragment lookup exactly.
 static String t(String source){
  if(!language.equals("en"))return source;
  Matcher matcher=PARTS.matcher(source);StringBuilder out=new StringBuilder();
  while(matcher.find()){
   String part=matcher.group(),key=part.trim();
   if(english.has(key)){
    int offset=part.indexOf(key);out.append(part,0,offset).append(english.optString(key)).append(part,offset+key.length(),part.length());
   }else out.append(part);
  }
  return out.toString();
 }
}
