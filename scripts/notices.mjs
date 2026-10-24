import { readdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
let result=`DiffPool NUMEN ${lock.version}\nNative shell and contacts adapted from Pearl Personal 0.7.0 (ISC).\n\n`+await readFile('LICENSE','utf8');
for(const [directory,info] of Object.entries(lock.packages)){
  if(!directory||info.dev)continue;
  const files=await readdir(directory);
  const licenses=files.filter(f=>/^(licen[cs]e|copying|notice)(\.|$)/i.test(f));
  result+='\n\n============================================================\n'+directory.replace('node_modules/','')+' '+info.version+' ('+(info.license||'see license')+')\n';
  for(const filename of licenses)result+='\n'+await readFile(path.join(directory,filename),'utf8');
}
await writeFile('THIRD-PARTY-NOTICES.txt',result);
