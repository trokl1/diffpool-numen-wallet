package xyz.diffpool.numen;

import android.content.res.AssetManager;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

// Fixed, read-only, bounded GraphQL queries. Caller cannot choose a host or query text.
final class HistoryApi {
 static String read(InputStream in,int limit) throws IOException {
  ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[4096];int n;
  while((n=in.read(buf))!=-1){if(out.size()+n>limit)throw new IOException("Ответ истории слишком большой");out.write(buf,0,n);}
  return new String(out.toByteArray(),StandardCharsets.UTF_8);
 }
 static String request(AssetManager assets,JSONObject data) throws Exception {
  String op=data.getString("operation");JSONObject v=data.getJSONObject("variables"),safe=new JSONObject();
  boolean transfer=op.equals("transfers")||op.equals("incoming")||op.equals("outgoing");
  if(!op.equals("meta")&&!transfer&&!op.equals("rewards"))throw new IOException("Операция истории запрещена");
  if(!op.equals("meta")){
   String id=v.getString("id");long anchor=v.getLong("anchor"),before=v.getLong("before");
   if(!id.matches("0x[0-9a-f]{64}")||anchor<0||anchor>=2147483646L||before<0||before>anchor+1)throw new IOException("Неверные параметры страницы");
   safe.put("id",id).put("anchor",anchor).put("before",before);
   if(transfer){String cursor=v.getString("cursor");if(!cursor.matches("[a-zA-Z0-9_-]{0,100}"))throw new IOException("Неверный курсор");safe.put("cursor",cursor);}
  }
  String query;try(InputStream in=assets.open("history-queries.json")){query=new JSONObject(read(in,16000)).getString(op);}
  String body=new JSONObject().put("query",query).put("variables",safe).toString();
  HttpsURLConnection c=(HttpsURLConnection)new URL("https://graphql.numen-network.org/graphql").openConnection();
  try{
   c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(20000);c.setUseCaches(false);
   c.setRequestMethod("POST");c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Accept","application/json");c.setDoOutput(true);
   try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}
   if(c.getResponseCode()!=200)throw new IOException("История: HTTP "+c.getResponseCode()+". Последние данные сохранены.");
   try(InputStream in=c.getInputStream()){return read(in,65536);}
  }finally{c.disconnect();}
 }
}
