import fs from 'node:fs';
import path from 'node:path';
import {output,hash,write,now} from './common.mjs';
import {parseTFVerdict} from './variable-mapping-policy.mjs';
import {minifySourceFunction} from './minify-source-function.mjs';
export const validatorSystemPrompt=fs.readFileSync(new URL('../../notes/jquery/validator-system-prompt.txt',import.meta.url),'utf8');
export const server=process.env.OLLAMA_URL||'http://127.0.0.1:11434';
// Explicit user instruction: disable thinking for the active experiment.
// Embedding ranking uses /api/embed; it has no generated reasoning stage.
export const settings={embedding:'qwen3-embedding:0.6b',validator:process.env.VALIDATOR_MODEL||'qwen3.5:27b',thinking:false,embeddingPromptVersion:'minified-semantic-comparison-v2',promptVersion:'jquery-pilot-v11-three-input-reference-patterns-tf',decisionPolicy:'F only with clear evidence of non-equivalence; otherwise T',num_ctx:16384,num_predict:384,temperature:0,topK:5,maxCodeCharacters:18000,embeddingBatch:12,neighborhoodRadius:1,siblingWindow:2};
const cache=path.join(output,'model-cache');fs.mkdirSync(cache,{recursive:true});
export async function api(endpoint,body,timeout=300000){const start=performance.now();const r=await fetch(server+'/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});const text=await r.text();if(!r.ok)throw new Error(`${endpoint} ${r.status}: ${text.slice(0,500)}`);return {response:JSON.parse(text),wallMs:performance.now()-start}}
export async function metadata(){const [tags,e,v,version]=await Promise.all([fetch(server+'/api/tags').then(r=>r.json()),api('show',{model:settings.embedding}),api('show',{model:settings.validator}),fetch(server+'/api/version').then(r=>r.json())]);const digests={};for(const name of [settings.embedding,settings.validator]){const item=tags.models.find(m=>m.name===name);if(!item)throw new Error('Required model missing '+name);digests[name]=item.digest}const result={created:now(),server,settings,digests,tags,embedding:e.response,validator:v.response,version};write(path.join(output,'model-manifest.json'),result);return result}
let embeddingCache={};const ef=path.join(cache,'embeddings.json');if(fs.existsSync(ef))embeddingCache=JSON.parse(fs.readFileSync(ef));
export const embeddingInstruction='Instruct: Represent this minified JavaScript function for semantic similarity comparison with other minified JavaScript functions. Focus on behavior, allowing for identifier renaming and equivalent syntactic rewrites.\nQuery:';
export function embeddingInput(fn,role){return role==='passage'?embeddingInstruction+minifySourceFunction(fn.code):fn.code;}
export async function embeddings(functions,role,digest){
 const preprocessingStart=performance.now();
 const inputs=functions.map(f=>embeddingInput(f,role)),keys=inputs.map(x=>hash(digest+'\n'+x));const preprocessingMs=performance.now()-preprocessingStart;let requests=0,wallMs=0;
 for(let i=0;i<inputs.length;i+=settings.embeddingBatch){const batch=inputs.slice(i,i+settings.embeddingBatch),ks=keys.slice(i,i+settings.embeddingBatch),missing=ks.map((k,j)=>!embeddingCache[k]?j:-1).filter(j=>j>=0);if(!missing.length)continue;
  const out=await api('embed',{model:settings.embedding,input:missing.map(j=>batch[j]),truncate:false,keep_alive:'60m'});requests++;wallMs+=out.wallMs;
  out.response.embeddings.forEach((v,j)=>{embeddingCache[ks[missing[j]]]=v});write(ef,embeddingCache);
  console.log('embedding',role,Math.min(i+settings.embeddingBatch,inputs.length),'/',inputs.length);
 }
 return {vectors:keys.map(k=>embeddingCache[k]),requests,wallMs,preprocessingMs};
}
export const cosine=(a,b)=>{let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return dot/Math.sqrt(aa*bb)};
export function validatorUserMessage(bundle,source){
 return JSON.stringify({source_function:source.code,minified_source_function:minifySourceFunction(source.code),bundled_function:bundle.code});
}
// Each validation request contains exactly one function pair, including batch callers.
export async function validateBatch(bundle,sources,context,digests){
 const records=[];
 for(const source of sources)records.push(await validate(bundle,source,[],digests));
 return {decisions:records.map(r=>r.decision??null),verdicts:records.map(r=>r.verdict),records,cached:records.every(r=>r.cached)};
}
export async function validate(bundle,source,context,digests){
 const system=validatorSystemPrompt;
 const user=validatorUserMessage(bundle,source);
 const body={model:settings.validator,messages:[{role:'system',content:system},{role:'user',content:user}],think:settings.thinking,stream:false,keep_alive:'60m',options:{temperature:settings.temperature,num_ctx:settings.num_ctx,num_predict:settings.num_predict,seed:42}};
 const key=hash(JSON.stringify({digests,body})),file=path.join(cache,'validations',key+'.json');
 if(fs.existsSync(file))return {...JSON.parse(fs.readFileSync(file)),cached:true};
 let record;try{const result=await api('chat',body);const parsed=parseTFVerdict(result.response.message?.content||'');record={key,created:now(),...parsed,reason:parsed.verdict==='invalid'?'Expected literal T or F':'Three-input judgment with minified-source reference and transformation examples.',wallMs:result.wallMs,request:body,...result};}catch(error){record={key,created:now(),verdict:'error',reason:String(error),request:body}}
 write(file,record);return {...record,cached:false};
}
