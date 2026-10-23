import fs from 'node:fs';
import path from 'node:path';
import {normalizeConfig} from '../config.mjs';
import {loadManifest,readJSON,hash} from '../shared/artifacts.mjs';
import {discoverJavaScript,referenceManifest} from './inputs.mjs';
import {createModelClient} from '../../components/pipeline/models.mjs';
export async function preflight({captured,sourceManifest,bundleManifest,references,catalog,output,config={},prepareOnly=false,signal=null}) {
 const checks=[];let resolved;
 const check=async(name,fn)=>{try{const detail=await fn();checks.push({name,status:'passed',detail})}catch(error){checks.push({name,status:'failed',error:error.message})}};
 await check('configuration',()=>{resolved=normalizeConfig(config);return 'configuration accepted'});
 await check('runtime',()=>{if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24+ required');return process.version});
 if(resolved){
  await check('captured-inputs',()=>{const m=bundleManifest?loadManifest(bundleManifest):loadManifest(discoverJavaScript(captured,resolved.inputs));return {files:m.units.length}});
  await check('references',()=>{
   if(sourceManifest)return {files:loadManifest(sourceManifest).units.length,mode:'manifest'};
   const directory=references||resolved.inputs.references;if(directory)return {files:referenceManifest(directory,resolved.inputs).files.length,mode:'local'};
   const file=catalog||resolved.inputs.catalog;if(!file)throw Error('Supply local references or a fingerprint catalog');
   const c=readJSON(file);if(c.schema!=='recall.catalog/v1'||c.digest!==hash(c.libraries))throw Error('Invalid fingerprint catalog');return {mode:'catalog',libraries:c.libraries.length,offline:resolved.inputs.offline};
  });
  if(output)await check('output-permissions',()=>{let parent=path.resolve(output);while(!fs.existsSync(parent))parent=path.dirname(parent);if(!fs.statSync(parent).isDirectory())throw Error('Output parent is not a directory');fs.accessSync(parent,fs.constants.W_OK);return 'writable'});
  if(!prepareOnly)await check('models',()=>createModelClient(resolved.models,{signal}).metadata());
 }
 return {schema:'recall.preflight/v1',status:checks.every(c=>c.status==='passed')?'ready':'blocked',checks};
}
