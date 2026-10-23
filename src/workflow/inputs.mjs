import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {extractFeatures,featureOptions} from '../../components/pog/index.mjs';
import {hash,readJSON,writeJSON,groups,checkInventory} from '../shared/artifacts.mjs';

// Deterministic discovery never follows symlinks or reads dependency installations.
export function discoverJavaScript(directory,{maxFiles=20000,maxBytes=1073741824}={}) {
 const root=fs.realpathSync(directory),files=[];let bytes=0;
 function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(e.name.startsWith('.')||e.name==='node_modules')continue;
  const file=path.join(dir,e.name);
  if(e.isDirectory())visit(file);
  else if(e.isFile()&&/\.(?:js|mjs|cjs)$/i.test(e.name)){
   bytes+=fs.statSync(file).size;files.push({id:'file:'+path.relative(root,file).split(path.sep).join('/'),path:file});
   if(files.length>maxFiles||bytes>maxBytes)throw Error('Input discovery exceeds maxFiles/maxBytes');
  }
 }}visit(root);if(!files.length)throw Error('No .js, .mjs, or .cjs files found in '+root);
 return {roots:[root],files};
}
export function referenceManifest(directory,limits={}) {
 const root=fs.realpathSync(directory),packages=[];
 function visit(dir){
  if(fs.existsSync(path.join(dir,'package.json'))){const p=readJSON(path.join(dir,'package.json'));if(!p.name||!p.version)throw Error('Reference package requires name and version: '+dir);packages.push({dir,library:{name:p.name,version:p.version}});return}
  for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)))if(e.isDirectory()&&!e.name.startsWith('.')&&e.name!=='node_modules')visit(path.join(dir,e.name));
 }visit(root);if(!packages.length)throw Error('No versioned reference packages found in '+root);
 return {roots:packages.map(p=>p.dir),files:packages.flatMap(p=>discoverJavaScript(p.dir,limits).files.map(f=>({...f,id:JSON.stringify([p.library.name,p.library.version,f.id]),library:p.library})))};
}
export function buildCatalog(inventory) {
 checkInventory(inventory);
 const libraries=[...groups(inventory.functions.filter(f=>f.library),f=>JSON.stringify(f.library))].map(([key,functions])=>{
  const library=JSON.parse(key),units=inventory.units.filter(u=>JSON.stringify(u.library)===key);
  return {library,features:functions.filter(f=>f.pogHash).map(f=>({fingerprint:f.pogHash,propertyOperations:f.propertyOperations,graphNodes:f.graphNodes})),localFiles:units.map(u=>({path:u.path,sha256:hash(u.code)}))};
 });
 if(!libraries.length)throw Error('Catalog requires versioned library metadata');
 const catalog={schema:'recall.catalog/v1',libraries};catalog.digest=hash(libraries);return catalog;
}
export function identifyCatalog(catalog,bundle,options={}) {
 if(catalog.schema!=='recall.catalog/v1'||catalog.digest!==hash(catalog.libraries))throw Error('Invalid or modified fingerprint catalog');
 checkInventory(bundle);const o=featureOptions(options);
 const targets=groups(bundle.functions.filter(f=>f.pogHash&&f[o.featureMetric]>=o.minFeatures),f=>f.pogHash);
 return catalog.libraries.map(entry=>{
  const fs=groups(entry.features.filter(f=>f[o.featureMetric]>=o.minFeatures),f=>f.fingerprint);
  let matchedAnchorFunctions=0;
  for(const [fingerprint,refs]of fs){const bs=targets.get(fingerprint)||[];if(refs.length===1&&bs.length&&(!o.uniqueBundle||[...groups(bs,f=>f.unit).values()].some(xs=>xs.length===1)))matchedAnchorFunctions++}
  return {...entry,matchedAnchorFunctions,detected:matchedAnchorFunctions>=o.minAnchors};
 });
}
function verify(bytes,integrity) {
 const valid=typeof integrity==='string'&&integrity.split(/\s+/).some(token=>{const match=/^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/.exec(token);return match&&crypto.createHash(match[1]).update(bytes).digest('base64')===match[2]});
 if(!valid)throw Error('npm archive integrity mismatch or unsupported integrity');
}
export function extractPackageArchive(archive,directory,{maxBytes=1073741824,maxFiles=20000}={}) {
 const data=gunzipSync(archive,{maxOutputLength:maxBytes+maxFiles*1024}),root=path.resolve(directory);let count=0,total=0,nextPath=null;
 for(let offset=0;offset+512<=data.length;){
  const header=data.subarray(offset,offset+512);if(header.every(b=>b===0))break;
  const string=(start,size)=>header.subarray(start,start+size).toString().replace(/\0.*$/s,'');
  const size=parseInt(string(124,12).trim()||'0',8),type=string(156,1)||'0';
  if(!Number.isSafeInteger(size)||size<0||offset+512+size>data.length)throw Error('Invalid npm tar entry size');
  const body=data.subarray(offset+512,offset+512+size);offset+=512+Math.ceil(size/512)*512;
  let name=nextPath||[string(345,155),string(0,100)].filter(Boolean).join('/');nextPath=null;
  if(type==='x'||type==='g'){
   let cursor=0;while(cursor<body.length){const space=body.indexOf(32,cursor),length=Number(body.subarray(cursor,space));if(space<0||!Number.isSafeInteger(length)||length<=0||cursor+length>body.length)throw Error('Invalid npm PAX record');const record=body.subarray(space+1,cursor+length-1).toString();if(record.startsWith('path=')){if(type==='g')throw Error('Global PAX paths unsupported');nextPath=record.slice(5)}if(record.startsWith('size='))throw Error('PAX size overrides unsupported');cursor+=length}continue;
  }
  if(type==='L'){nextPath=body.toString().replace(/\0.*$/s,'');continue}
  if(!['0','5'].includes(type))throw Error('Unsupported npm archive entry (links and special files are excluded)');
  if(!name.startsWith('package/')||name.includes('\\')||name.split('/').includes('..')||name.includes('\0'))throw Error('Unsafe npm archive path');
  const relative=name.slice(8);if(!relative)continue;
  const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep))throw Error('Unsafe npm archive path');
  if(type==='5'){fs.mkdirSync(target,{recursive:true});continue}
  count++;total+=size;if(count>maxFiles||total>maxBytes)throw Error('npm package exceeds maxFiles/maxBytes');
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body,{flag:'wx'});
 }
}
export async function fetchReference(library,{cacheDir,registry='https://registry.npmjs.org',offline=false,timeoutMs=300000,maxFiles=20000,maxBytes=1073741824}={}) {
 if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(library.name)||!/^\d+\.\d+\.\d+(?:[-+][0-9a-z.+-]+)?$/i.test(library.version))throw Error('Reference requires an exact npm package version');
 if(!cacheDir)throw Error('Reference cacheDir is required');
 const key=hash({registry,library}),destination=path.resolve(cacheDir,key),record=path.join(destination,'reference.json');
 if(fs.existsSync(record)){
  const meta=readJSON(record),archive=fs.readFileSync(path.join(destination,'package.tgz'));verify(archive,meta.integrity);
  if(hash(meta.library)!==hash(library)||meta.files.some(f=>!fs.existsSync(path.join(destination,'source',f.path))||hash(fs.readFileSync(path.join(destination,'source',f.path),'utf8'))!==f.sha256))throw Error('Modified npm reference cache');
  return path.join(destination,'source');
 }
 if(offline)throw Error('Reference unavailable offline: '+library.name+'@'+library.version);
 const request=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(timeoutMs)});if(!response.ok)throw Error('Reference request HTTP '+response.status+': '+url);return response};
 const metadata=await(await request(registry.replace(/\/$/,'')+'/'+encodeURIComponent(library.name)+'/'+encodeURIComponent(library.version))).json();
 if(metadata.name!==library.name||metadata.version!==library.version||!metadata.dist?.tarball)throw Error('Registry returned a different package/version');
 const url=new URL(metadata.dist.tarball);if(!['http:','https:'].includes(url.protocol))throw Error('Invalid npm tarball URL');
 const response=await request(url),chunks=[];let length=0;
 for await(const part of response.body){length+=part.length;if(length>maxBytes)throw Error('npm archive exceeds maxBytes');chunks.push(part)}
 const archive=Buffer.concat(chunks),integrity=metadata.dist.integrity||(metadata.dist.shasum?'sha1-'+Buffer.from(metadata.dist.shasum,'hex').toString('base64'):null);verify(archive,integrity);
 fs.mkdirSync(path.dirname(destination),{recursive:true});const temp=fs.mkdtempSync(destination+'-');
 try{
  const source=path.join(temp,'source');fs.mkdirSync(source);extractPackageArchive(archive,source,{maxFiles,maxBytes});
  const pkg=readJSON(path.join(source,'package.json'));if(pkg.name!==library.name||pkg.version!==library.version)throw Error('Archive package/version differs from metadata');
  const files=discoverJavaScript(source,{maxFiles,maxBytes}).files.map(f=>({path:path.relative(fs.realpathSync(source),f.path),sha256:hash(fs.readFileSync(f.path,'utf8'))}));
  fs.writeFileSync(path.join(temp,'package.tgz'),archive);writeJSON(path.join(temp,'reference.json'),{schema:'recall.npm-reference/v1',library,registry,integrity,files});
  if(fs.existsSync(destination))throw Error('Incomplete reference cache exists; remove it before retrying');fs.renameSync(temp,destination);
 }catch(error){fs.rmSync(temp,{recursive:true,force:true});throw error}
 return path.join(destination,'source');
}
export async function prepareInputs({captured=null,sourceManifest=null,bundleManifest=null,references=null,catalog=null,inputs={},recovery={},onProgress=()=>{}}) {
 const bundle=extractFeatures(bundleManifest||discoverJavaScript(captured,inputs));
 if(sourceManifest)return {source:extractFeatures(sourceManifest),bundle};
 if(references)return {source:extractFeatures(referenceManifest(references,inputs)),bundle};
 if(!catalog)throw Error('Supply --references, --source-manifest, or a fingerprint --catalog');
 const selected=identifyCatalog(typeof catalog==='string'?readJSON(catalog):catalog,bundle,recovery),detected=selected.filter(e=>e.detected),files=[],roots=[];
 if(!detected.length)throw Error('No catalog library/version meets the configured anchor threshold; inspect the catalog and captured inputs');
 for(const entry of detected){
  onProgress({stage:'references',library:entry.library});
  if(entry.localFiles?.length&&entry.localFiles.every(f=>fs.existsSync(f.path)&&hash(fs.readFileSync(f.path,'utf8'))===f.sha256)){
   files.push(...entry.localFiles.map(f=>({path:f.path,library:entry.library,id:hash([entry.library,f.path])})));roots.push(...entry.localFiles.map(f=>path.dirname(f.path)));
  }else{
   const directory=await fetchReference(entry.library,inputs),manifest=referenceManifest(directory,inputs);files.push(...manifest.files);roots.push(...manifest.roots);
  }
 }
 return {source:extractFeatures({files,roots}),bundle,catalogSelection:{schema:'recall.catalog-selection/v1',catalogDigest:(typeof catalog==='string'?readJSON(catalog):catalog).digest,libraries:selected.map(({library,matchedAnchorFunctions,detected})=>({library,matchedAnchorFunctions,detected}))}};
}
