import {EN} from './i18n-en.mjs';

let language='ru';
export const LANGUAGES=Object.freeze(['ru','en']);
export const getLanguage=()=>language;
export const locale=()=>language==='en'?'en-US':'ru-RU';
export function setLanguage(value){
  language=LANGUAGES.includes(value)?value:'ru';
  if(globalThis.document)document.documentElement.lang=language;
  return language;
}

// Delimiters preserve HTML markup, attribute quoting and whitespace. Lookup is
// exact per static fragment, never a substring replacement across rendered DOM.
export function staticParts(text){return text.split(/([<>"'\r\n])/);}
function translateStatic(source){
  if(language!=='en')return source;
  return staticParts(source).map(part=>{
    const key=part.trim();
    return Object.hasOwn(EN,key)?part.replace(key,()=>EN[key]):part;
  }).join('');
}
// Call only with source literals or as a template tag. Template values are
// preserved verbatim: callers must continue escaping HTML as before.
export function t(source,...values){
  if(typeof source==='string')return translateStatic(source);
  return source.reduce((text,part,index)=>text+translateStatic(part)+(index<values.length?String(values[index]):''),'');
}
