package xyz.diffpool.numen;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

// A single public QR image, not a general file provider. Vault/settings are unreachable.
public final class QrShareProvider extends ContentProvider {
 public static final Uri URI=Uri.parse("content://xyz.diffpool.numen.qr/receive.png");
 static File file(android.content.Context context){return new File(context.getCacheDir(),"public-receive-qr.png");}
 private void check(Uri uri){if(!URI.equals(uri))throw new SecurityException("Unknown QR URI");}
 @Override public boolean onCreate(){return true;}
 @Override public String getType(Uri uri){check(uri);return "image/png";}
 @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){
  check(uri);String[] cols=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;
  MatrixCursor result=new MatrixCursor(cols);Object[] values=new Object[cols.length];
  for(int i=0;i<cols.length;i++)values[i]=OpenableColumns.DISPLAY_NAME.equals(cols[i])?"NUMEN-address.png":OpenableColumns.SIZE.equals(cols[i])?file(getContext()).length():null;
  result.addRow(values);return result;
 }
 @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
  check(uri);if(!"r".equals(mode))throw new SecurityException("Read-only QR");
  return ParcelFileDescriptor.open(file(getContext()),ParcelFileDescriptor.MODE_READ_ONLY);
 }
 @Override public Uri insert(Uri uri,ContentValues values){throw new SecurityException("Read-only QR");}
 @Override public int update(Uri uri,ContentValues values,String selection,String[] args){throw new SecurityException("Read-only QR");}
 @Override public int delete(Uri uri,String selection,String[] args){throw new SecurityException("Read-only QR");}
}
