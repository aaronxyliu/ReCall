// Resolve only supplied source units/metadata. No registry, execution or guessed exports.
import path from 'node:path';
export const cleanSourcePath=p=>path.normalize(p.split(/[?#]/,1)[0]);
const inside=(p,r)=>p===r||p.startsWith(r+path.sep);
const commonDirectory=files=>{let r=path.dirname(files[0]);for(const f of files)while(!inside(f,r)&&path.dirname(r)!==r)r=path.dirname(r);return r};
export function packageLayouts(units){
 const groups=new Map();for(const u of units)if(u.library){const key=JSON.stringify([u.environment||'main',u.library.name,u.library.version,u.packageRoot||null]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(u)}
 const layouts=[];for(const us of groups.values()){
  const first=us[0],root=first.packageRoot||commonDirectory(us.map(u=>cleanSourcePath(u.path)));
  // Without explicit roots, never join independent captured packages/versions
  // through a directory that also contains another supplied package.
  if(!first.packageRoot&&units.some(u=>u.library&&JSON.stringify(u.library)!==JSON.stringify(first.library)&&inside(cleanSourcePath(u.path),root)))continue;
  layouts.push({name:first.library.name,version:first.library.version,environment:first.environment||'main',root,info:first.packageInfo||null});
 }return layouts;
}
function exportTarget(value,kind,star=''){
 if(typeof value==='string')return value.replaceAll('*',star);
 if(!value||Array.isArray(value)||typeof value!=='object')return null;
 // Honor declaration order; no guessed environment-specific conditions.
 for(const [condition,target]of Object.entries(value))if(['default',kind==='require'?'require':'import'].includes(condition)){const result=exportTarget(target,kind,star);if(result)return result}
 return null;
}
export function sourcePathCandidates(base,typed=false){const extensions=['.js','.mjs','.cjs',...(typed?['.ts','.mts','.cts']:[])];return [base,...extensions.map(e=>base+e),...extensions.map(e=>path.join(base,'index'+e))]}
export function createSourceResolver(units){
 const exact=new Map(),aliases=new Map(),layouts=packageLayouts(units),key=(env,p)=>env+'|'+path.normalize(p);
 const put=(map,k,u)=>{if(!map.has(k))map.set(k,new Set());map.get(k).add(u)};
 for(const u of units)for(const p of [u.path,...(u.aliasPaths||[])]){put(exact,key(u.environment||'main',p),u);put(aliases,key(u.environment||'main',cleanSourcePath(p)),u)}
 function paths(from,request,kind='import'){
  if(typeof request!=='string'||request.startsWith('node:'))return [];
  if(request.startsWith('.')){const base=path.dirname(cleanSourcePath(from.path)),literal=path.resolve(base,request),clean=path.resolve(base,request.split(/[?#]/,1)[0]);return [...new Set([...(literal!==clean?[literal]:[]),...sourcePathCandidates(clean,/\.(?:[cm]?ts|svelte)$/.test(cleanSourcePath(from.path)))])]}
  const m=/^(@[^/]+\/[^/]+|[^/]+)(?:\/(.*))?$/.exec(request);if(!m||request.startsWith('/')||request.startsWith('#'))return [];
  let packages=layouts.filter(p=>p.name===m[1]&&p.environment===(from.environment||'main'));const own=packages.filter(p=>inside(cleanSourcePath(from.path),p.root));if(own.length===1)packages=own;if(packages.length!==1)return [];
  const pkg=packages[0],sub=m[2]||'',info=pkg.info;let target;
  if(info&&Object.hasOwn(info,'exports')){
   const ex=info.exports,subkey=sub?'./'+sub:'.';
   if(typeof ex==='string'||ex&&typeof ex==='object'&&!Array.isArray(ex)&&!Object.keys(ex).some(k=>k.startsWith('.'))){if(sub)return [];target=exportTarget(ex,kind)}
   else if(ex&&typeof ex==='object'){
    if(Object.hasOwn(ex,subkey))target=exportTarget(ex[subkey],kind);
    else{const patterns=Object.keys(ex).filter(k=>k.includes('*')&&subkey.startsWith(k.split('*')[0])&&subkey.endsWith(k.split('*')[1])).sort((a,b)=>b.length-a.length);if(patterns.length){const pat=patterns[0],[a,b]=pat.split('*');target=exportTarget(ex[pat],kind,subkey.slice(a.length,subkey.length-b.length))}}
   }
   if(!target?.startsWith('./'))return [];
  }else target=sub||((kind!=='require'&&typeof info?.module==='string'?info.module:null)||info?.main||'index');
  const resolved=path.resolve(pkg.root,target);return inside(resolved,pkg.root)?sourcePathCandidates(resolved,/\.(?:[cm]?ts|svelte)$/.test(cleanSourcePath(from.path))):[];
 }
 function resolve(from,request,kind='import'){
  for(const p of paths(from,request,kind)){const k=key(from.environment||'main',p),xs=exact.get(k)||aliases.get(k);if(xs){if(xs.size===1)return [...xs][0];return null}}
  return null;
 }
 return {resolve,paths,layouts};
}
