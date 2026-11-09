// Filesystem context collection. Never executes scripts, reads maps or uses a model.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {graphPrograms,graphLanguage} from './graph-syntax.mjs';import {constant} from '../engine/recognize.mjs';
import {createSourceResolver,packageLayouts,cleanSourcePath} from './source-resolution.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export function collectContext(entries,{roots=[],follow=true,maxFiles=20000,maxBytes=1024*1024*1024}={}){
 const allowed=(roots.length?roots:entries.map(e=>path.dirname(e.path))).map(p=>fs.realpathSync(p)),inside=p=>{let real;try{real=fs.realpathSync(p)}catch{try{real=path.join(fs.realpathSync(path.dirname(p)),path.basename(p))}catch{return false}}return allowed.some(r=>real===r||real.startsWith(r+path.sep))};
 const seed=entries.map(e=>({...e,environment:e.environment||'main'}));
 for(const pkg of packageLayouts(seed)){
  let root=pkg.root,info=null;
  while(inside(root)){
   const file=path.join(root,'package.json');if(fs.existsSync(file)){try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.name===pkg.name){info=Object.fromEntries(['name','version','main','module','exports'].filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]));break}}catch{/* Invalid metadata never supplies a guessed entry point. */}}
   const parent=path.dirname(root);if(parent===root||!inside(parent))break;root=parent;
  }
  if(!info)root=pkg.root;
  for(const u of seed)if(u.library?.name===pkg.name&&u.library?.version===pkg.version&&u.environment===pkg.environment&&(cleanSourcePath(u.path)===pkg.root||cleanSourcePath(u.path).startsWith(pkg.root+path.sep))){u.packageRoot=root;if(info)u.packageInfo=info}
 }
 const units=[],dependencies=[],diagnostics=[],queue=[...seed],byPath=new Map();let totalBytes=0,resolver=createSourceResolver(seed),resolverDirty=false;
 for(let j=0;j<queue.length;j++){
  const s=queue[j],filename=path.resolve(s.path),key=s.environment+'|'+filename;if(byPath.has(key))continue;
  const code=s.code??fs.readFileSync(s.codeFile||filename,'utf8'),u={...s,id:s.id||'context:'+hash(s.environment+'|'+filename).slice(0,20),path:filename,code,aliasPaths:[...(s.aliasPaths||[])],functions:s.functions??[],sha256:hash(code),contextOnly:s.contextOnly??!s.functions?.length};
  units.push(u);byPath.set(key,u);for(const p of u.aliasPaths)byPath.set(s.environment+'|'+path.resolve(p),u);totalBytes+=Buffer.byteLength(code);
  if(units.length>maxFiles||totalBytes>maxBytes)throw Error('Context collection exceeds maxFiles/maxBytes; no complete graph is claimed');
  if(!follow)continue;let programs;try{programs=graphPrograms(code,filename)}catch(e){diagnostics.push({kind:'context-parse-error',file:filename,error:e.message});continue}
  const todo=programs.map(({ast})=>({n:ast,p:null}));while(todo.length){const {n,p}=todo.pop();let request=null,kind=null,environment=s.environment;
   if(n.type==='ImportDeclaration'||n.type==='ExportNamedDeclaration'&&n.source||n.type==='ExportAllDeclaration'){request=constant(n.source);kind='esm'}
   if(n.type==='ImportExpression'){request=constant(n.source);kind='dynamic-import';if(request==null)diagnostics.push({kind:'computed-dynamic-import',file:filename,span:n.range})}
   if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&['require','importScripts'].includes(n.callee.name)){request=constant(n.arguments[0]);kind=n.callee.name}
   if(n.type==='NewExpression'&&n.callee.type==='Identifier'&&n.callee.name==='URL'&&n.arguments[1]?.type==='MemberExpression'&&n.arguments[1].object.type==='MetaProperty'){request=constant(n.arguments[0]);kind='module-url';if(p?.type==='NewExpression'&&['Worker','SharedWorker'].includes(p.callee.name))environment='worker:'+path.resolve(path.dirname(filename),request||'unknown')}
   if(request!=null&&kind&&!request.startsWith('node:')){
    if(resolverDirty){resolver=createSourceResolver(queue);resolverDirty=false}
    const mode=kind==='require'?'require':'import',known=resolver.resolve(u,request,mode),paths=resolver.paths(u,request,mode);let found=known?.path;
    if(!found)found=paths.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
    if(!found){dependencies.push({from:u.id,request,kind,status:'missing',environment});diagnostics.push({kind:request.startsWith('.')?'missing-relative-dependency':'unresolved-package-import',file:filename,request})}
    else if(graphLanguage(found)==='asset'){dependencies.push({from:u.id,request,kind,status:'non-javascript',environment})}
    else{
     const real=known?path.resolve(found):fs.realpathSync(found);
     if(!inside(real)){diagnostics.push({kind:'dependency-outside-allowed-roots',file:filename,request,resolved:real});dependencies.push({from:u.id,request,kind,status:'outside-roots',environment})}
     else{dependencies.push({from:u.id,request,kind,status:'supplied',resolved:found,environment});if(!queue.some(e=>e.environment===environment&&e.path===found)){const pkg=resolver.layouts.find(p=>p.environment===environment&&(cleanSourcePath(found)===p.root||cleanSourcePath(found).startsWith(p.root+path.sep)));queue.push(known&&known.environment===environment?{...known,environment}:{path:found,...(known?.code!==undefined?{code:known.code}:{}),environment,functions:[],contextOnly:true,...(pkg?{library:{name:pkg.name,version:pkg.version},packageRoot:pkg.root,...(pkg.info?{packageInfo:pkg.info}:{})}:{})});resolverDirty=true}}
    }
   }
   for(const [k,v]of Object.entries(n)){if(['loc','range'].includes(k))continue;for(const c of Array.isArray(v)?v:[v])if(c?.type)todo.push({n:c,p:n})}
  }
 }
 return{units,dependencies,diagnostics,totalBytes,policy:'Static source imports/reexports among supplied files and package metadata, query/fragment aliases, and bounded filesystem context. No registry, guessed barrel exports or computed chunks. Unresolved/ambiguous dependencies stay explicit; worker environments remain partitioned.'};
}
