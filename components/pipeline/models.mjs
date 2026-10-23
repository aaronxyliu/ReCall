import fs from 'node:fs';
import path from 'node:path';
import {hash,writeJSON,readJSON} from '../../src/shared/artifacts.mjs';

import {modelDefaults,modelOptions} from '../../src/config.mjs';
export {modelDefaults,modelOptions};
export function cosine(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length!==b.length||[...a,...b].some(x=>!Number.isFinite(x)))throw Error('Invalid embedding dimensions or values');
 let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}if(!aa||!bb)throw Error('Zero-norm embedding');return dot/Math.sqrt(aa*bb);
}
export function createModelClient(options={}, {signal=null}={}){
 const config=modelOptions(options),memory=new Map(),stats={requests:0,cacheHits:0,embeddingRequests:0,validationRequests:0,wallMs:0,inputTokens:0,outputTokens:0};let digests=null;
 const system=config.systemPrompt??fs.readFileSync(new URL('../../src/analysis/validator-system-prompt.txt',import.meta.url),'utf8');
 async function request(endpoint,body){
  const start=performance.now(),r=await fetch(config.endpoint.replace(/\/$/,'')+'/api/'+endpoint,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]):AbortSignal.timeout(config.timeoutMs)});
  if(!r.ok)throw Error(`Model API ${endpoint}: HTTP ${r.status}`);
  const response=await r.json();stats.requests++;stats.wallMs+=performance.now()-start;return response;
 }
 async function metadata(){
  if(digests)return digests;
  const tags=await request('tags');digests={};
  for(const name of [config.embeddingModel,config.validationModel]){
   const m=tags.models?.find(m=>(m.name||m.model)===name);if(!m?.digest)throw Error('Model metadata/digest unavailable: '+name);digests[name]=m.digest;
  }
  return digests;
 }
 async function cached(endpoint,body){
  const ids=await metadata(),key=hash({endpoint:config.endpoint,modelDigest:ids[body.model],api:endpoint,body});
  if(memory.has(key)){stats.cacheHits++;return memory.get(key)}
  const file=config.cacheDir?path.join(config.cacheDir,endpoint,key+'.json'):null;
  if(file&&fs.existsSync(file)){const entry=readJSON(file);if(entry.key!==key||hash(entry.request)!==hash(body))throw Error('Cache provenance mismatch');memory.set(key,entry.response);stats.cacheHits++;return entry.response}
  const response=await request(endpoint,body);stats[endpoint==='embed'?'embeddingRequests':'validationRequests']++;
  stats.inputTokens+=response.prompt_eval_count||0;stats.outputTokens+=response.eval_count||0;
  memory.set(key,response);if(file)writeJSON(file,{key,request:body,modelDigests:ids,response});return response;
 }
 return {config,stats,metadata,get modelDigests(){return digests?{...digests}:null},
  async embed(inputs){
   const vectors=[];
   for(let i=0;i<inputs.length;i+=config.embeddingBatch){
    const batch=inputs.slice(i,i+config.embeddingBatch),r=await cached('embed',{model:config.embeddingModel,input:batch,truncate:false,keep_alive:config.keepAlive});
    if(!Array.isArray(r.embeddings)||r.embeddings.length!==batch.length)throw Error('Embedding response count mismatch');
    for(const v of r.embeddings){cosine(v,v);vectors.push(v)}
   }
   return vectors;
  },
  async validate({source,bundle,minified}){
   const user=JSON.stringify({source_function:source.code,minified_source_function:minified,bundled_function:bundle.code});
   const r=await cached('chat',{model:config.validationModel,messages:[{role:'system',content:system},{role:'user',content:user}],think:config.thinking,stream:false,keep_alive:config.keepAlive,options:{temperature:config.temperature,num_ctx:config.numCtx,num_predict:config.numPredict,seed:config.seed}});
   const text=r.message?.content?.trim(),verdict=text==='T'?'accept':text==='F'?'reject':'invalid';
   return {verdict,response:r};
  }
 };
}
