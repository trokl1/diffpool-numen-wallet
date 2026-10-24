package xyz.diffpool.numen;

import android.content.Context;
import android.os.Build;
import android.text.InputType;
import android.view.*;
import android.view.inputmethod.*;
import android.webkit.WebView;

/** No secret export through WebView selection menus, keyboard shortcuts or IME.
 * Public addresses can still be copied via the explicit native allowlist.
 * This is defense in depth, not a sandbox against a compromised keyboard/OS. */
final class SecureWebView extends WebView {
 SecureWebView(Context context){
  super(context);setFilterTouchesWhenObscured(true);
  if(Build.VERSION.SDK_INT>=34)setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES);
 }
 @Override public boolean onFilterTouchEventForSecurity(MotionEvent e){
  if((e.getFlags()&MotionEvent.FLAG_WINDOW_IS_OBSCURED)!=0)return false;
  if(Build.VERSION.SDK_INT>=29&&(e.getFlags()&MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)!=0)return false;
  return super.onFilterTouchEventForSecurity(e);
 }
 private static boolean allowed(int id){return id==android.R.id.paste||id==android.R.id.pasteAsPlainText||id==android.R.id.selectAll;}
 private ActionMode.Callback safeCallback(ActionMode.Callback original){
  return new ActionMode.Callback2(){
   private void prune(Menu menu){for(int i=menu.size()-1;i>=0;i--)if(!allowed(menu.getItem(i).getItemId()))menu.removeItem(menu.getItem(i).getItemId());}
   @Override public boolean onCreateActionMode(ActionMode mode,Menu menu){boolean created=original.onCreateActionMode(mode,menu);prune(menu);return created&&menu.size()>0;}
   @Override public boolean onPrepareActionMode(ActionMode mode,Menu menu){boolean changed=original.onPrepareActionMode(mode,menu);prune(menu);return changed;}
   @Override public boolean onActionItemClicked(ActionMode mode,MenuItem item){return allowed(item.getItemId())&&original.onActionItemClicked(mode,item);}
   @Override public void onDestroyActionMode(ActionMode mode){original.onDestroyActionMode(mode);}
   @Override public void onGetContentRect(ActionMode mode,View view,android.graphics.Rect rect){if(original instanceof ActionMode.Callback2)((ActionMode.Callback2)original).onGetContentRect(mode,view,rect);else super.onGetContentRect(mode,view,rect);}
  };
 }
 @Override public ActionMode startActionMode(ActionMode.Callback callback){return super.startActionMode(safeCallback(callback));}
 @Override public ActionMode startActionMode(ActionMode.Callback callback,int type){return super.startActionMode(safeCallback(callback),type);}
 @Override public boolean dispatchKeyEvent(KeyEvent event){
  int code=event.getKeyCode();
  if(code==KeyEvent.KEYCODE_COPY||code==KeyEvent.KEYCODE_CUT||event.isCtrlPressed()&&(code==KeyEvent.KEYCODE_C||code==KeyEvent.KEYCODE_X))return true;
  return super.dispatchKeyEvent(event);
 }
 @Override public InputConnection onCreateInputConnection(EditorInfo info){
  InputConnection connection=super.onCreateInputConnection(info);
  info.imeOptions|=EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
  if((info.inputType&InputType.TYPE_MASK_CLASS)==InputType.TYPE_CLASS_TEXT){info.inputType|=InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;info.inputType&=~InputType.TYPE_TEXT_FLAG_AUTO_CORRECT;}
  return connection==null?null:new InputConnectionWrapper(connection,false){
   @Override public boolean performContextMenuAction(int id){return allowed(id)&&super.performContextMenuAction(id);}
  };
 }
}
