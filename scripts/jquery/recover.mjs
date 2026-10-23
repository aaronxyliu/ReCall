import fs from 'node:fs';
import path from 'node:path';
import {output,read,write,hash,now,selectedBuilds} from './common.mjs';
import {settings,metadata,embeddings,cosine,validate} from './models.mjs';
import {policies,shouldPromote,stopValidation} from './promotion-policy.mjs';
const promotionPolicy=process.env.PROMOTION_POLICY||'first-positive';
if(!policies.includes(promotionPolicy))throw new Error('Unknown promotion policy: '+promotionPolicy);

// This program deliberately never opens ground-truth.json or source maps.
const data=read(path.join(output,'detector-input.json'));
const {created:inputCreated,...stableInput}=data;
const inputHash=hash(JSON.stringify(stableInput));
const refs=data.sources.flatMap(s=>s.functions);
const sourceEdges=[];let base=0;for(const s of data.sources){sourceEdges.push(...s.edges.map(e=>({...e,from:e.from+base,to:e.to+base})));base+=s.functions.length}
const sourceIndex=new Map(refs.map((f,i)=>[f.id,i]));
function graph(functions,edges){
 const adjacency=functions.map(()=>new Set());
 for(const e of edges){adjacency[e.from].add(e.to);adjacency[e.to].add(e.from)}
 const siblings=new Map();for(let i=0;i<functions.length;i++){const key=functions[i].parent??'root';if(!siblings.has(key))siblings.set(key,[]);siblings.get(key).push(i)}
 for(const group of siblings.values())for(let i=0;i<group.length;i++)for(let d=1;d<=settings.siblingWindow;d++)if(group[i+d]!=null){adjacency[group[i]].add(group[i+d]);adjacency[group[i+d]].add(group[i])}
 return adjacency;
}
function around(index,adjacency){const seen=new Set([index]);let frontier=[index];for(let hop=0;hop<settings.neighborhoodRadius;hop++){const next=[];for(const from of frontier)for(const to of adjacency[from])if(!seen.has(to)){seen.add(to);next.push(to)}frontier=next}seen.delete(index);return seen}
const sg=graph(refs,sourceEdges);
const pogGroups=new Map();for(let i=0;i<refs.length;i++){const f=refs[i];if(f.propertyOperations<10||!f.pogHash)continue;if(!pogGroups.has(f.pogHash))pogGroups.set(f.pogHash,[]);pogGroups.get(f.pogHash).push(i)}
const meta=await metadata();
const eligibleRefs=refs.filter(f=>f.code.length<=settings.maxCodeCharacters);
const se=await embeddings(eligibleRefs,'passage',meta.digests[settings.embedding]);
const sourceVectors=new Map(eligibleRefs.map((f,i)=>[f.id,se.vectors[i]]));
const chosen=process.env.BUILD_IDS?new Set(process.env.BUILD_IDS.split(',')):null;
for(const bundle of selectedBuilds(data.bundles)){
 if(chosen&&!chosen.has(bundle.build))continue;
 const started=performance.now(),dest=path.join(output,'recovery',bundle.build+'.json');
 if(fs.existsSync(dest)&&read(dest).status==='fixed-point'){const previous=read(dest);if(previous.configuration.thinking!==settings.thinking||previous.configuration.promptVersion!==settings.promptVersion||previous.configuration.embeddingPromptVersion!==settings.embeddingPromptVersion||previous.configuration.topK!==settings.topK||(previous.configuration.promotionPolicy||'unique-positive')!==promotionPolicy||previous.inputHash!==inputHash||JSON.stringify(previous.modelDigests)!==JSON.stringify(meta.digests))throw new Error('Existing completed run has different inputs, model digests, or configuration; preserve it before starting a new run.');console.log('already complete',bundle.build);continue}
 const cfg={...settings,promotionPolicy,neighborhoodKinds:['lexically-resolved-call','function-argument','contains','same-parent-ast-order-window-2'],policy:promotionPolicy==='first-positive'?`Evaluate ranked top-${settings.topK} pairs in rank order until first acceptance, then propose that candidate. Preserve round-level strict one-to-one source conflicts. No ground-truth access.`:`Evaluate all top-${settings.topK} pairs; promote only exactly one accepted pair, strict one-to-one source use within a build. No ground-truth access.`};
 const bg=graph(bundle.functions,bundle.edges),accepted=new Map(),used=new Set(),promotions=[],queries=[],pairRecords=[],processed=new Set();
 const bundlePogs=new Map();for(let i=0;i<bundle.functions.length;i++){const f=bundle.functions[i];if(f.propertyOperations<10||!f.pogHash)continue;if(!bundlePogs.has(f.pogHash))bundlePogs.set(f.pogHash,[]);bundlePogs.get(f.pogHash).push(i)}
 for(const [pog,indices] of bundlePogs){const candidates=pogGroups.get(pog);if(indices.length===1&&candidates?.length===1){const b=indices[0],s=candidates[0];accepted.set(b,s);used.add(s);promotions.push({bundleId:bundle.functions[b].id,sourceId:refs[s].id,kind:'pog-anchor',round:0,pogHash:pog,parentBundleIds:[]})}}
 console.log('anchors',bundle.build,accepted.size);
 const eligibleBundles=bundle.functions.filter(f=>f.code.length<=settings.maxCodeCharacters);
 const be=await embeddings(eligibleBundles,'query',meta.digests[settings.embedding]);const bVectors=new Map(eligibleBundles.map((f,i)=>[f.id,be.vectors[i]]));
 let round=0,modelCalls=0,cacheHits=0,modelWallMs=0,rankWallMs=0;
 function checkpoint(status){write(dest,{created:now(),status,build:bundle.build,inputHash,configuration:cfg,modelDigests:meta.digests,sourceFunctions:refs.length,bundleFunctions:bundle.functions.length,anchors:promotions.filter(p=>p.kind==='pog-anchor').length,promotions,queries,pairs:pairRecords,round,modelCalls,cacheHits,modelWallMs,rankWallMs,embedding:{source:se,bundle:{requests:be.requests,wallMs:be.wallMs}},elapsedMs:performance.now()-started,oversizedBundleFunctions:bundle.functions.filter(f=>f.code.length>settings.maxCodeCharacters).map(f=>f.id)})}
 // Do not serialize source embedding arrays in each checkpoint.
 delete se.vectors;
 checkpoint('running');
 while(true){
  round++;const snapshot=new Map(accepted),pending=[];
  for(let bi=0;bi<bundle.functions.length;bi++){
   if(snapshot.has(bi)||!bVectors.has(bundle.functions[bi].id))continue;
   const parents=[...around(bi,bg)].filter(x=>snapshot.has(x));if(!parents.length)continue;
   const candidates=new Set();for(const parent of parents)for(const si of around(snapshot.get(parent),sg))if(!used.has(si)&&sourceVectors.has(refs[si].id))candidates.add(si);
   if(!candidates.size)continue;
   const biFn=bundle.functions[bi];const list=[...candidates].sort((a,b)=>a-b);const state=hash(JSON.stringify([biFn.id,list,parents.map(p=>[p,snapshot.get(p)])]));if(processed.has(state))continue;processed.add(state);
   const rankStart=performance.now();const ranked=list.map(si=>({si,sourceId:refs[si].id,score:cosine(bVectors.get(biFn.id),sourceVectors.get(refs[si].id))})).sort((a,b)=>b.score-a.score||a.si-b.si);const rankMs=performance.now()-rankStart;rankWallMs+=rankMs;
   const top=ranked.slice(0,settings.topK),qid=`${bundle.build}:q${queries.length}`;
   const context=parents.slice(0,8).map(p=>({reference_name:refs[snapshot.get(p)].name,bundle_name:bundle.functions[p].name,reference_code:refs[snapshot.get(p)].code.slice(0,240),bundle_code:bundle.functions[p].code.slice(0,240),relationship:'static-neighborhood accepted correspondence; may include lexical adjacency'}));
   const acceptedPairs=[];
   for(let rank=0;rank<top.length;rank++){
    const candidate=top[rank],result=await validate(biFn,refs[candidate.si],context,meta.digests),verdict=result.verdict;
    if(result.cached)cacheHits++;else{modelCalls++;modelWallMs+=result.wallMs||0}
    const pair={queryId:qid,round,bundleId:biFn.id,sourceId:candidate.sourceId,rank:rank+1,score:candidate.score,decision:result.decision,verdict,reason:result.reason,cacheKey:result.key,requestKey:result.key,batchSize:1,cached:result.cached,wallMs:result.wallMs||null,evalCount:result.response?.eval_count,thinkingCharacters:result.response?.message?.thinking?.length||0,doneReason:result.response?.done_reason};pairRecords.push(pair);if(verdict==='accept')acceptedPairs.push(candidate);
    console.log('pair',bundle.build,round,queries.length,rank+1,verdict,result.cached?'cached':Math.round(result.wallMs||0)+'ms');
    checkpoint('running');
    if(stopValidation(verdict,promotionPolicy))break;
   }
   const promote=shouldPromote(acceptedPairs,promotionPolicy);
   const q={id:qid,round,bundleId:biFn.id,candidates:ranked.map(({si,...r})=>r),topCandidates:top.map(r=>r.sourceId),topK:settings.topK,topThree:top.slice(0,3).map(r=>r.sourceId),parentBundleIds:parents.map(p=>bundle.functions[p].id),rankMs,acceptedCandidates:acceptedPairs.map(c=>c.sourceId),status:promote?'pending':acceptedPairs.length?'ambiguous':'unresolved'};queries.push(q);
   if(promote)pending.push({bi,si:acceptedPairs[0].si,q});checkpoint('running');
  }
  let added=0;
  const sourceCounts=new Map();for(const p of pending)sourceCounts.set(p.si,(sourceCounts.get(p.si)||0)+1);
  for(const p of pending){if(accepted.has(p.bi)||used.has(p.si)||sourceCounts.get(p.si)>1){p.q.status='identity-conflict';continue}accepted.set(p.bi,p.si);used.add(p.si);added++;p.q.status='promoted';promotions.push({bundleId:bundle.functions[p.bi].id,sourceId:refs[p.si].id,kind:'model-recovered-seed',round,queryId:p.q.id,parentBundleIds:p.q.parentBundleIds})}
  checkpoint(added?'running':'fixed-point');console.log('round complete',bundle.build,round,'new',added,'accepted',accepted.size);
  if(!added)break;
 }
}
