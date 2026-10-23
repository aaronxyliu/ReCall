import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {normalizeConfig} from '../config.mjs';
import {hash,readJSON,writeJSON} from '../shared/artifacts.mjs';
import {prepareInputs} from './inputs.mjs';
import {identifyAnchors,identifyLibraries} from '../../components/pog/index.mjs';
import {identifyBundler} from '../../components/bundler/index.mjs';
import {resolveModules,engineDigest,checkModuleMap} from '../../components/modules/index.mjs';
import {buildGraph} from '../../components/graph/index.mjs';
import {recoverFunctions} from '../../components/pipeline/index.mjs';
import {preflight} from './preflight.mjs';

export function implementationDigest(){
 const files=[];
 for(const directory of ['../','../../components/']){const root=new URL(directory,import.meta.url);for(const name of fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.mjs')||p.endsWith('.txt')).sort())files.push([directory+name,fs.readFileSync(new URL(name,root),'utf8')])}
 return hash(files);
}
export function summarizeRecovery(result,bundle){
 const accepted=new Set(result.promotions.map(p=>p.bundleId)),byBundle=new Map(),reasons={};
 for(const query of result.queries){if(!byBundle.has(query.bundleId))byBundle.set(query.bundleId,[]);byBundle.get(query.bundleId).push(query)}
 const classifications=bundle.functions.filter(f=>!accepted.has(f.id)).map(f=>{
  const queries=byBundle.get(f.id)||[],checks=queries.flatMap(q=>q.checks);
  const reason=queries.length?queries.some(q=>q.status==='identity-conflict')?'identity-conflict':queries.some(q=>q.status==='pending')?'pending-round':checks.some(c=>c.verdict==='error'||c.verdict==='invalid')?'validation-error-or-invalid':checks.length?'model-rejected':'no-ranked-candidate':f.code.length>result.configuration.maxCodeCharacters?'code-size-limit':'unqueried';
  reasons[reason]=(reasons[reason]||0)+1;return {functionId:f.id,reason};
 });
 return {schema:'recall.summary/v1',status:result.status,parsedTargetFunctions:bundle.functions.length,anchorFunctions:result.promotions.filter(p=>p.kind==='pog-anchor').length,modelRecoveredFunctions:result.promotions.filter(p=>p.kind==='model-recovered').length,recoveredFunctions:accepted.size,recoveryCoverage:bundle.functions.length?accepted.size/bundle.functions.length:null,unrecoveredReasons:reasons,unrecovered:classifications,parseFailures:bundle.diagnostics.filter(d=>d.kind==='parse-error'),validationCalls:result.stats.validationCalls,elapsedMs:result.stats.elapsedMs,accuracy:null,policy:'Coverage denominator is enumerated functions in supplied JavaScript; parse failures are reported separately. Accuracy requires independent ground truth. Unqueried is not proof of disconnection.'};
}
function resumeSettings(config){const copy=structuredClone(config);delete copy.execution;delete copy.recovery.maxRounds;delete copy.recovery.maxValidationCalls;return copy}
export async function runDirectory({output,config={},prepareOnly=false,resume=false,onProgress,signal,...input}) {
 const started=performance.now();config=normalizeConfig(config);output=path.resolve(output);
 config.inputs.cacheDir??=path.join(output,'reference-cache');config.models.cacheDir??=path.join(output,'model-cache');
 const progress=event=>{if(onProgress)onProgress({...event,elapsedMs:performance.now()-started})};
 if(fs.existsSync(output)&&fs.readdirSync(output).length&&!resume)throw Error('Output exists; use --resume to continue the same run or choose a new directory');
 fs.mkdirSync(output,{recursive:true});
 const lock=path.join(output,'.recall.lock');let descriptor;
 try{descriptor=fs.openSync(lock,'wx');fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}))}catch{throw Error('Run is locked by another process; inspect .recall.lock before removing a stale lock')}
 const save=(name,value)=>writeJSON(path.join(output,name+'.json'),value,{overwrite:true});
 try{
  const file=path.join(output,'run.json'),previous=fs.existsSync(file)?readJSON(file):null;
  if(previous&&!resume)throw Error('Existing run requires --resume');
  if(previous&&(previous.implementationDigest!==implementationDigest()||previous.node!==process.version||hash(resumeSettings(previous.config))!==hash(resumeSettings(config))))throw Error('Resume settings or tool implementation changed; start a new run');
  if(previous){
   const before=previous.config.recovery,after=config.recovery;
   if(after.maxRounds<before.maxRounds||after.maxValidationCalls!==null&&(before.maxValidationCalls===null||after.maxValidationCalls<before.maxValidationCalls))throw Error('Resume budgets may only be increased');
  }
  progress({stage:'preflight'});const check=await preflight({...input,output,config,prepareOnly,signal});save('preflight',check);
  if(check.status!=='ready')throw Error('Preflight failed: '+check.checks.filter(c=>c.status==='failed').map(c=>c.name+': '+c.error).join('; '));
  progress({stage:'inputs'});const {source,bundle,catalogSelection}=await prepareInputs({...input,references:input.references||config.inputs.references,catalog:input.catalog||config.inputs.catalog,inputs:config.inputs,recovery:config.recovery,onProgress:progress});
  if(previous&&(previous.sourceDigest!==source.inputDigest||previous.bundleDigest!==bundle.inputDigest))throw Error('Resume input files changed; start a new run');
  save('run',{schema:'recall.run/v1',config,node:process.version,implementationDigest:implementationDigest(),sourceDigest:source.inputDigest,bundleDigest:bundle.inputDigest,inputs:input});
  save('resolved-config',config);save('source',source);save('bundle',bundle);if(catalogSelection)save('catalogSelection',catalogSelection);
  const stage=(name,fn)=>{progress({stage:name});const file=path.join(output,name+'.json');if(resume&&fs.existsSync(file))return readJSON(file);const value=fn();if(value!==null)save(name,value);return value};
  const libraries=stage('libraries',()=>identifyLibraries(source,bundle,config.recovery)),anchors=stage('anchors',()=>identifyAnchors(source,bundle,config.recovery));
  const sourceBundler=stage('sourceBundler',()=>identifyBundler(source)),bundleBundler=stage('bundleBundler',()=>identifyBundler(bundle,config.bundler));
  const sourceModules=config.graph.useModules?stage('sourceModules',()=>resolveModules(source,{...config.modules,bundler:sourceBundler})):null;
  const bundleModules=config.graph.useModules?stage('bundleModules',()=>resolveModules(bundle,{...config.modules,bundler:bundleBundler})):null;
  for(const [map,inventory]of [[sourceModules,source],[bundleModules,bundle]])if(map){checkModuleMap(map,inventory);for(const unit of map.units.filter(u=>u.contextOnly))if(!fs.existsSync(unit.path)||hash(fs.readFileSync(unit.path,'utf8'))!==hash(unit.code))throw Error('Resume context files changed; start a new run')}
  const sourceGraph=stage('sourceGraph',()=>buildGraph(source,{...config.graph,moduleMap:sourceModules})),bundleGraph=stage('bundleGraph',()=>buildGraph(bundle,{...config.graph,moduleMap:bundleModules}));
  if(prepareOnly){save('status',{status:'prepared',modelCalls:0});return {status:'prepared'}}
  const checkpoint=path.join(output,'checkpoint.json'),prior=resume&&fs.existsSync(checkpoint)?readJSON(checkpoint):null;
  if(prior){const {checkpointDigest,...state}=prior;if(checkpointDigest!==hash(state))throw Error('Modified or incomplete checkpoint')}
  progress({stage:'recovery',resumed:!!prior});
  const result=await recoverFunctions({source,bundle,sourceGraph,bundleGraph,anchors,libraries,config:{...config.recovery,models:config.models},resume:prior,signal,onProgress:progress,onCheckpoint:r=>save('checkpoint',{...r,checkpointDigest:hash(r)})});
  save('recovery',result);save('recovered-functions',exportRecovered(result,source,bundle));save('summary',summarizeRecovery(result,bundle));save('status',{status:result.status,elapsedMs:performance.now()-started});progress({stage:'finished',recovered:result.promotions.length,targets:bundle.functions.length});return result;
 }catch(error){save('status',{status:signal?.aborted?'interrupted':'failed',error:error.message,elapsedMs:performance.now()-started});throw error}
 finally{if(descriptor!==undefined){fs.closeSync(descriptor);fs.rmSync(lock,{force:true})}}
}

export function exportRecovered(result,source,bundle){
 const sources=new Map(source.functions.map(f=>[f.id,f])),targets=new Map(bundle.functions.map(f=>[f.id,f]));
 return {schema:'recall.function-mapping/v1',sourceDigest:source.inputDigest,bundleDigest:bundle.inputDigest,functions:result.promotions.map(p=>{
  const s=sources.get(p.sourceId),b=targets.get(p.bundleId);
  const location=f=>({id:f.id,file:f.file,span:f.span,name:f.name});
  return {bundle:location(b),source:{...location(s),library:s.library},method:p.kind,round:p.round};
 })};
}
