import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {jsonChunks,readJSONFile,writeJSONChunks} from './json.mjs';

export const hash=value=>{const digest=crypto.createHash('sha256');if(typeof value==='string')digest.update(value);else for(const chunk of jsonChunks(value,true))digest.update(chunk);return digest.digest('hex')};
export const readJSON=file=>readJSONFile(file);
export function writeJSON(file,value,{overwrite=false}={}){
 fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';let fd;
 try{
  fd=fs.openSync(temporary,'wx');writeJSONChunks(fd,value);fs.closeSync(fd);fd=undefined;
  if(overwrite)fs.renameSync(temporary,file);else{fs.linkSync(temporary,file);fs.unlinkSync(temporary)}
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true})}
}
export function integer(value,name,{min=0,max=Number.MAX_SAFE_INTEGER}={}){
 if(!Number.isSafeInteger(value)||value<min||value>max)throw Error(`${name} must be an integer in [${min}, ${max}]`);
 return value;
}
export function artifact(value,schema){
 if(!value||value.schema!==schema)throw Error(`Expected ${schema} artifact`);
 return value;
}
export const unitSignature=u=>({id:u.id,path:u.path,environment:u.environment||'main',runtimeGroup:u.runtimeGroup||'manifest-build',sha256:hash(u.code),library:u.library||null,...(u.packageRoot?{packageRoot:u.packageRoot}:{}),...(u.packageInfo?{packageInfo:u.packageInfo}:{}),...(u.aliasPaths?.length?{aliasPaths:u.aliasPaths}:{})});
export const inventoryDigest=x=>hash({units:x.units.map(unitSignature),functions:x.functions.map(f=>[f.id,f.unit,f.span,f.parent,hash(f.code),f.pogHash,f.propertyOperations,f.graphNodes])});
export function checkInventory(x){
 artifact(x,'recall.inventory/v1');
 if(!Array.isArray(x.units)||!Array.isArray(x.functions)||x.inputDigest!==inventoryDigest(x))throw Error('Invalid inventory or changed input digest');
 const units=new Set(),functions=new Set(),unitMap=new Map(x.units.map(u=>[u.id,u]));
 for(const u of x.units){if(units.has(u.id)||typeof u.code!=='string')throw Error('Invalid/duplicate inventory unit');units.add(u.id)}
 for(const f of x.functions){
  if(functions.has(f.id)||!units.has(f.unit)||!Array.isArray(f.span)||typeof f.code!=='string')throw Error('Invalid/duplicate function identity');
  const u=unitMap.get(f.unit);
  if(hash(f.library||null)!==hash(u.library||null))throw Error('Function library ownership disagrees with its source unit');
  const codeSpan=f.codeSpan||f.span;
  if(!Array.isArray(codeSpan)||codeSpan.length!==2||!codeSpan.every(Number.isInteger)||codeSpan[0]<0||codeSpan[0]>f.span[0]||codeSpan[1]!==f.span[1]||u.code.slice(...codeSpan)!==f.code)throw Error('Function body does not match inventory span');
  functions.add(f.id);
 }
 return x;
}
export function loadManifest(input,{baseDir=process.cwd()}={}){
 const filename=typeof input==='string'?path.resolve(input):null;
 const m=filename?readJSON(filename):input,base=filename?path.dirname(filename):path.resolve(baseDir);
 if(!m||!Array.isArray(m.files)||!m.files.length)throw Error('Manifest requires a nonempty files array');
 const seen=new Set();
 const units=m.files.map((entry,i)=>{
  const f=typeof entry==='string'?{path:entry}:entry;
  if(!f||typeof f.path!=='string')throw Error('Each manifest file requires a path');
  const filename=path.resolve(base,f.path),id=f.id||`unit:${hash([f.path,f.environment||'main']).slice(0,20)}`;
  if(seen.has(id))throw Error('Duplicate manifest unit ID: '+id);seen.add(id);
  const library=f.library||m.library||null;
  if(library&&(!library.name||!library.version))throw Error('Library metadata requires name and version');
  return {id,path:filename,code:typeof f.code==='string'?f.code:fs.readFileSync(filename,'utf8'),environment:f.environment||m.environment||'main',runtimeGroup:f.runtimeGroup||m.runtimeGroup||'manifest-build',library,...(f.packageRoot?{packageRoot:path.resolve(base,f.packageRoot)}:{}),...(f.packageInfo?{packageInfo:f.packageInfo}:{}),...(f.aliasPaths?.length?{aliasPaths:f.aliasPaths.map(p=>path.resolve(base,p))}:{})};
 });
 return {units,roots:(m.roots||[base]).map(p=>path.resolve(base,p)),context:m.context||{},origin:filename};
}
export function groups(items,key){const out=new Map();for(const item of items){const k=key(item);if(!out.has(k))out.set(k,[]);out.get(k).push(item)}return out}
export function sameInput(a,b){if(a!==b)throw Error('Artifacts were generated from different input inventories')}
