// Independent reference acquisition: manifests + lockfiles + integrity-checked npm archives.
import fs from 'node:fs';import path from 'node:path';import YAML from 'yaml';import yarn from '@yarnpkg/lockfile';
import {fetchReference,referenceManifest} from './inputs.mjs';import {hash,readJSON,writeJSON} from '../shared/artifacts.mjs';
const exact=v=>typeof v==='string'&&/^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(v);
export function planProjectReferences({project,manifest='package.json',select=null,lockfile=null}){
 const root=fs.realpathSync(project),mf=path.resolve(root,manifest);if(!mf.startsWith(root+path.sep))throw Error('Manifest must be inside project');
 const pkg=readJSON(mf),declared=pkg.dependencies||{},names=select||Object.keys(declared).sort();if(!names.length||new Set(names).size!==names.length||names.some(n=>!Object.hasOwn(declared,n)))throw Error('Select unique production dependencies from the manifest');
 const candidates=lockfile?[lockfile]:['pnpm-lock.yaml','yarn.lock','package-lock.json'].filter(f=>fs.existsSync(path.join(root,f)));if(candidates.length!==1)throw Error('Specify exactly one lockfile when project has zero or multiple lockfiles');
 const lf=path.resolve(root,candidates[0]);if(!lf.startsWith(root+path.sep))throw Error('Lockfile must be inside project');const text=fs.readFileSync(lf,'utf8');let get,roots,format;
 if(lf.endsWith('pnpm-lock.yaml')){
  format='pnpm';const lock=YAML.parse(text),importer=path.relative(root,path.dirname(mf)).split(path.sep).join('/')||'.',deps=lock.importers?.[importer]?.dependencies;if(!deps)throw Error('Missing pnpm importer: '+importer);
  const value=x=>typeof x==='string'?x:x?.version;
  roots=Object.fromEntries(names.map(n=>{if(deps[n]?.specifier!==undefined&&deps[n].specifier!==declared[n])throw Error('Manifest/lock specifier mismatch: '+n);return[n,n+'@'+value(deps[n])]}));
  get=key=>{const at=key.lastIndexOf('@',key.indexOf('(')<0?key.length:key.indexOf('(')),name=key.slice(0,at),version=key.slice(at+1).split('(')[0],entry=lock.packages?.[name+'@'+version],snapshot=lock.snapshots?.[key]||entry;if(!entry||!snapshot)throw Error('Missing pnpm package: '+key);return {name,version,integrity:entry.resolution?.integrity,dependencies:Object.fromEntries(Object.entries({...snapshot.dependencies,...snapshot.optionalDependencies}).map(([n,v])=>[n,n+'@'+value(v)])),peerDependencies:entry.peerDependencies||{}}};
 }else if(lf.endsWith('yarn.lock')){
  const parsed=YAML.parse(text),modern=!!parsed?.__metadata;format=modern?'yarn-berry':'yarn-classic';const lock=modern?parsed:yarn.parse(text).object,lookup=new Map();for(const [keys,v]of Object.entries(lock))if(keys!=='__metadata')for(const k of keys.split(/,\s*/))lookup.set(k,v);
  const resolve=(n,v)=>{for(const k of [n+'@'+v,n+'@npm:'+v.replace(/^npm:/,'')])if(lookup.has(k))return k;throw Error('Missing Yarn lock resolution: '+n+'@'+v)};
  roots=Object.fromEntries(names.map(n=>[n,resolve(n,declared[n])]));
  get=key=>{const x=lookup.get(key);if(!x)throw Error('Missing Yarn package: '+key);const name=key.slice(0,key.indexOf('@',1));return {name,version:x.version,integrity:modern?null:x.integrity,dependencies:Object.fromEntries(Object.entries({...x.dependencies,...x.optionalDependencies}).map(([n,v])=>[n,resolve(n,v)])),peerDependencies:x.peerDependencies||{}}};
 }else{
  format='npm';const lock=JSON.parse(text);if(!lock.packages)throw Error('npm lockfile v2/v3 required');
  const locate=(from,n)=>{let dir=from;while(true){const k=(dir?dir+'/':'')+'node_modules/'+n;if(lock.packages[k])return k;if(!dir)break;dir=path.posix.dirname(dir);if(dir==='.')dir=''}throw Error('Missing npm dependency: '+n)};
  const importer=path.relative(root,path.dirname(mf)).split(path.sep).join('/');const locked=lock.packages[importer]?.dependencies||{};for(const n of names)if(locked[n]!==declared[n])throw Error('Manifest/lock specifier mismatch: '+n);
  roots=Object.fromEntries(names.map(n=>[n,locate(importer,n)]));get=key=>{const x=lock.packages[key];if(x.link)throw Error('Workspace links require explicit independent source manifests');const name=x.name||key.slice(key.lastIndexOf('node_modules/')+13);return {name,version:x.version,integrity:x.integrity,dependencies:Object.fromEntries(Object.keys({...x.dependencies,...x.optionalDependencies}).map(n=>[n,locate(key,n)])),peerDependencies:x.peerDependencies||{}}};
 }
 const packages={},pending=Object.values(roots);while(pending.length){const key=pending.shift();if(packages[key])continue;const info=get(key);if(!exact(info.version))throw Error('Unsupported non-exact registry reference: '+key);packages[key]=info;pending.push(...Object.values(info.dependencies));if(Object.keys(packages).length>2000)throw Error('Reference dependency closure exceeds 2000 packages')}
 return {schema:'recall.independent-reference-plan/v1',project:root,manifest:mf,manifestSHA256:hash(fs.readFileSync(mf,'utf8')),lockfile:lf,lockfileSHA256:hash(text),format,roots,packages,policy:'Production dependency selection and exact dependency closure from project manifest/lockfile. No source-map inputs. Unresolved peers are explicit; no install scripts executed.'};
}
export async function prepareProjectReferences({output,cacheDir,offline=false,registry, ...options}){
 const plan=planProjectReferences(options);if(fs.existsSync(output))throw Error('Choose a fresh independent-reference output directory');
 const stage=path.resolve(output)+'.preparing';if(fs.existsSync(stage))throw Error('Preparation staging directory already exists');fs.mkdirSync(stage,{recursive:true});
 try{
  const locations=Object.fromEntries(Object.keys(plan.packages).map(k=>[k,path.join(path.resolve(output),'packages',hash(k).slice(0,24))])),files=[],receipts=[];
  for(const [key,pkg]of Object.entries(plan.packages)){
   const source=await fetchReference({name:pkg.name,version:pkg.version},{cacheDir,offline,...(registry?{registry}:{})});
   const archive=fs.readFileSync(path.join(path.dirname(source),'package.tgz'));
   if(pkg.integrity){const {createHash}=await import('node:crypto');if(!pkg.integrity.split(/\s+/).some(s=>{const m=/^(sha512|sha384|sha256|sha1)-(.+)$/.exec(s);return m&&createHash(m[1]).update(archive).digest('base64')===m[2]}))throw Error('Project lockfile archive integrity mismatch: '+key)}
   const dest=path.join(stage,'packages',path.basename(locations[key]));fs.mkdirSync(dest,{recursive:true});
   // Only implementation text and package descriptors enter the inference tree.
   function copy(dir,rel=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name.startsWith('.'))continue;const name=path.join(rel,e.name),src=path.join(dir,e.name);if(e.isDirectory())copy(src,name);else if(e.isFile()&&(e.name==='package.json'||/\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx)$/.test(e.name)&&! /\.d\.(?:ts|mts|cts)$/.test(e.name))){const to=path.join(dest,name);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(src,to)}}}copy(source);
   const manifest=referenceManifest(dest),dependencies=Object.fromEntries(Object.entries(pkg.dependencies).map(([name,k])=>[name,locations[k]]));
   for(const f of manifest.files){const final=path.join(locations[key],path.relative(dest,f.path));files.push({...f,id:hash([key,path.relative(dest,f.path)]),path:final,packageRoot:locations[key],packageInfo:{...f.packageInfo,recallDependencyRoots:dependencies,recallLockedDependencies:true}})}
   receipts.push({key,name:pkg.name,version:pkg.version,archiveSHA256:hash(archive),lockIntegrityVerified:!!pkg.integrity,registryIntegrityVerified:true,unresolvedPeers:Object.keys(pkg.peerDependencies).filter(n=>!dependencies[n]),files:manifest.files.map(f=>({path:path.relative(dest,f.path),sha256:hash(fs.readFileSync(f.path,'utf8'))}))});
  }
  const manifest={roots:Object.values(locations),files};writeJSON(path.join(stage,'source.json'),manifest);writeJSON(path.join(stage,'provenance.json'),{...plan,receipts,sourceManifestSHA256:hash(manifest)});fs.renameSync(stage,path.resolve(output));return {packages:receipts.length,files:files.length,manifest:path.join(path.resolve(output),'source.json')};
 }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e}
}
