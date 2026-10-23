// Filesystem context collection. Never executes scripts, reads maps, or accesses a model.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {parseModule} from './parse.mjs';import {constant} from '../engine/recognize.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export function collectContext(entries,{roots=[],follow=true,maxFiles=20000,maxBytes=1024*1024*1024}={}){
 const allowed=(roots.length?roots:entries.map(e=>path.dirname(e.path))).map(p=>fs.realpathSync(p)),inside=p=>allowed.some(r=>p===r||p.startsWith(r+path.sep));
 const units=[],dependencies=[],diagnostics=[],queue=entries.map(e=>({...e,environment:e.environment||'main'})),byPath=new Map(),byHash=new Map();let totalBytes=0;
 for(let j=0;j<queue.length;j++){
  const s=queue[j],filename=path.resolve(s.path),key=s.environment+'|'+filename;if(byPath.has(key))continue;const code=s.code??fs.readFileSync(s.codeFile||filename,'utf8'),digest=hash(code),hashKey=s.environment+'|'+digest;
  if(byHash.has(hashKey)){const old=byHash.get(hashKey);if(s.functions?.length&&!old.functions?.length){old.functions=s.functions;old.id=s.id}old.aliasPaths.push(filename,...(s.aliasPaths||[]));byPath.set(key,old);continue}
  const u={...s,id:s.id||'context:'+hash(s.environment+'|'+filename).slice(0,20),path:filename,code,aliasPaths:[...(s.aliasPaths||[])],functions:s.functions??[],sha256:digest,contextOnly:s.contextOnly??!s.functions?.length};units.push(u);byPath.set(key,u);byHash.set(hashKey,u);for(const p of u.aliasPaths)byPath.set(s.environment+'|'+path.resolve(p),u);totalBytes+=Buffer.byteLength(code);
  if(units.length>maxFiles||totalBytes>maxBytes)throw Error('Context collection budget exceeded; no complete graph is claimed');
  if(!follow)continue;let ast;try{ast=parseModule(code,{next:true,ranges:true,loc:false})}catch(e){diagnostics.push({kind:'context-parse-error',file:filename,error:e.message});continue}
  const todo=[{n:ast,p:null}];while(todo.length){const {n,p}=todo.pop();let request=null,kind=null,environment=s.environment;
   if(n.type==='ImportDeclaration'||n.type==='ExportNamedDeclaration'&&n.source||n.type==='ExportAllDeclaration'){request=constant(n.source);kind='esm'}
   if(n.type==='ImportExpression'){request=constant(n.source);kind='dynamic-import';if(request==null)diagnostics.push({kind:'computed-dynamic-import',file:filename,span:n.range})}
   if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&['require','importScripts'].includes(n.callee.name)){request=constant(n.arguments[0]);kind=n.callee.name}
   if(n.type==='NewExpression'&&n.callee.type==='Identifier'&&n.callee.name==='URL'&&n.arguments[1]?.type==='MemberExpression'&&n.arguments[1].object.type==='MetaProperty'){request=constant(n.arguments[0]);kind='module-url';if(p?.type==='NewExpression'&&['Worker','SharedWorker'].includes(p.callee.name))environment='worker:'+path.resolve(path.dirname(filename),request||'unknown')}
   if(request!=null&&kind){if(!request.startsWith('.')&&kind!=='importScripts'){if(!request.startsWith('node:'))diagnostics.push({kind:'external-or-bare-specifier',file:filename,request});}else{
     const clean=request.split(/[?#]/)[0],base=path.resolve(path.dirname(filename),clean),found=[base,base+'.js',base+'.mjs',base+'.cjs',path.join(base,'index.js')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
     if(!found){dependencies.push({from:u.id,request,kind,status:'missing',environment});diagnostics.push({kind:'missing-relative-dependency',file:filename,request})}
     else if(!/\.[cm]?js$/.test(found)){dependencies.push({from:u.id,request,kind,status:'non-javascript',environment})}
     else{const real=fs.realpathSync(found);if(!inside(real)){diagnostics.push({kind:'dependency-outside-allowed-roots',file:filename,request,resolved:real});dependencies.push({from:u.id,request,kind,status:'outside-roots',environment})}else{dependencies.push({from:u.id,request,kind,status:'supplied',resolved:found,environment});queue.push({path:found,environment,functions:[],contextOnly:true})}}
    }}
   for(const [k,v]of Object.entries(n)){if(['loc','range'].includes(k))continue;for(const c of Array.isArray(v)?v:[v])if(c?.type)todo.push({n:c,p:n})}
  }
 }
 return{units,dependencies,diagnostics,totalBytes,policy:'Analysis context is separate from matchable targets. Static relative ESM, literal dynamic imports, CommonJS and module URL dependencies; no guessed computed chunk filenames or external package resolution. Supplied roots bound collection. Worker URL contexts are partitioned.'};
}
