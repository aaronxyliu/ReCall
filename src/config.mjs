import path from 'node:path';
import {integer} from './shared/artifacts.mjs';
export const recoveryDefaults={minFeatures:10,featureMetric:'propertyOperations',minAnchors:3,uniqueBundle:true,topK:5,radius:1,maxCodeCharacters:18000,maxRounds:1000,maxValidationCalls:null,minSimilarity:-1,sourceRepresentation:'minified',crossChunk:false,libraryGate:true};
export const modelDefaults={endpoint:'http://127.0.0.1:11434',embeddingModel:'qwen3-embedding:0.6b',validationModel:'qwen3.5:27b',thinking:false,temperature:0,seed:42,numCtx:16384,numPredict:384,embeddingBatch:12,timeoutMs:300000,keepAlive:'60m',cacheDir:null,systemPrompt:null};
export const defaults={recovery:recoveryDefaults,models:modelDefaults,graph:{useModules:true,siblingWindow:2,includeContainment:true},modules:{followDependencies:true,valueLimit:64,eventLimit:50000000,maxFiles:20000,maxBytes:1073741824},bundler:{hint:null},inputs:{references:null,catalog:null,cacheDir:null,registry:'https://registry.npmjs.org',offline:false,timeoutMs:300000,maxFiles:20000,maxBytes:1073741824},execution:{progress:true}};
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' must be an object')}
function keys(value,known,label){object(value,label);for(const key of Object.keys(value))if(!Object.hasOwn(known,key))throw Error('Unknown configuration setting: '+label+'.'+key)}
function bool(value,name){if(typeof value!=='boolean')throw Error(name+' must be Boolean')}
function http(value,name){if(typeof value!=='string'||!['http:','https:'].includes(new URL(value).protocol))throw Error(name+' requires an HTTP(S) URL')}
export function recoveryOptions(options={}) {
 keys(options,recoveryDefaults,'recovery');const o={...recoveryDefaults,...options};
 for(const k of ['minFeatures','minAnchors','topK','radius','maxCodeCharacters','maxRounds'])integer(o[k],k,{min:1});
 if(o.maxValidationCalls!==null)integer(o.maxValidationCalls,'maxValidationCalls',{min:1});
 if(!['propertyOperations','graphNodes'].includes(o.featureMetric))throw Error('Invalid recovery.featureMetric');
 if(!['minified','original'].includes(o.sourceRepresentation))throw Error('Invalid recovery.sourceRepresentation');
 if(!Number.isFinite(o.minSimilarity)||o.minSimilarity< -1||o.minSimilarity>1)throw Error('minSimilarity must be in [-1,1]');
 for(const k of ['uniqueBundle','crossChunk','libraryGate'])bool(o[k],k);return o;
}
export function modelOptions(options={}) {
 keys(options,modelDefaults,'models');const o={...modelDefaults,...options};http(o.endpoint,'models.endpoint');
 for(const k of ['embeddingModel','validationModel'])if(typeof o[k]!=='string'||!o[k])throw Error(k+' is required');
 for(const k of ['numCtx','numPredict','embeddingBatch','timeoutMs'])integer(o[k],k,{min:1});integer(o.seed,'seed');bool(o.thinking,'thinking');
 if(!Number.isFinite(o.temperature)||o.temperature<0)throw Error('Invalid models.temperature');
 if(o.systemPrompt!==null&&typeof o.systemPrompt!=='string')throw Error('models.systemPrompt must be a string');
 if(typeof o.keepAlive!=='string'&&typeof o.keepAlive!=='number')throw Error('Invalid models.keepAlive');
 if(o.cacheDir!==null&&typeof o.cacheDir!=='string')throw Error('models.cacheDir must be a path');return o;
}
export function normalizeConfig(config={}, {baseDir=process.cwd()}={}) {
 keys(config,defaults,'config');const result={};
 for(const [section,values]of Object.entries(defaults)){keys(Object.hasOwn(config,section)?config[section]:{},values,section);result[section]={...values,...config[section]}}
 result.recovery=recoveryOptions(result.recovery);result.models=modelOptions(result.models);
 bool(result.graph.useModules,'graph.useModules');bool(result.graph.includeContainment,'graph.includeContainment');integer(result.graph.siblingWindow,'siblingWindow');
 bool(result.modules.followDependencies,'modules.followDependencies');for(const k of ['valueLimit','eventLimit','maxFiles','maxBytes'])integer(result.modules[k],k,{min:1});
 if(result.bundler.hint!==null&&!['webpack','rspack','esbuild','rollup','rolldown','turbopack','parcel'].includes(result.bundler.hint))throw Error('Unsupported bundler hint');
 bool(result.inputs.offline,'inputs.offline');http(result.inputs.registry,'inputs.registry');for(const k of ['timeoutMs','maxFiles','maxBytes'])integer(result.inputs[k],k,{min:1});bool(result.execution.progress,'execution.progress');
 for(const [section,fields]of [['inputs',['references','catalog','cacheDir']],['models',['cacheDir']]])for(const field of fields){const value=result[section][field];if(value!==null){if(typeof value!=='string'||!value)throw Error(section+'.'+field+' must be a path');result[section][field]=path.resolve(baseDir,value)}}
 return result;
}
