import {sourceScopes} from '../../src/analysis/library-scope.mjs';
import {matchingMultiplicity} from '../../src/shared/matches.mjs';
import {performance} from 'node:perf_hooks';
import {astMatch} from '../../src/analysis/ast-match.mjs';
import {minifySourceFunction} from '../../src/analysis/minify.mjs';
import {identifyAnchors,identifyLibraries} from '../pog/index.mjs';
import {identifyBundler} from '../bundler/index.mjs';
import {resolveModules} from '../modules/index.mjs';
import {buildGraph,checkGraph} from '../graph/index.mjs';
import {checkInventory,hash,artifact,sameInput} from '../../src/shared/artifacts.mjs';
import {createModelClient,cosine} from './models.mjs';

import {recoveryDefaults,recoveryOptions,normalizeConfig} from '../../src/config.mjs';
export {recoveryDefaults,recoveryOptions};
function adjacency(graph){const g=new Map(graph.functions.map(f=>[f.id,new Set()]));for(const e of graph.edges){g.get(e.from).add(e.to);g.get(e.to).add(e.from)}return g}
function neighbors(id,g,radius){const seen=new Set([id]);let front=[id];for(let r=0;r<radius;r++){const next=[];for(const u of front)for(const v of g.get(u)||[])if(!seen.has(v)){seen.add(v);next.push(v)}front=next}seen.delete(id);return seen}

export async function recoverFunctions({source,bundle,sourceGraph,bundleGraph,anchors=null,libraries=null,config={},models=null,onCheckpoint=null,onProgress=null,resume=null,signal=null,candidateSelector=null}){
 const started=performance.now(),o=recoveryOptions(Object.fromEntries(Object.entries(config).filter(([key])=>key!=='models')));checkInventory(source);checkInventory(bundle);checkGraph(sourceGraph,source);checkGraph(bundleGraph,bundle);
 if(!anchors)anchors=identifyAnchors(source,bundle,o);
 artifact(anchors,'recall.anchors/v1');sameInput(anchors.sourceDigest,source.inputDigest);sameInput(anchors.bundleDigest,bundle.inputDigest);
 if(anchors.options.minFeatures!==o.minFeatures||anchors.options.featureMetric!==o.featureMetric)throw Error('Anchor options disagree with recovery configuration');
 const sourceIndex=new Map(source.functions.map((f,i)=>[f.id,i])),sm=new Map(source.functions.map(f=>[f.id,f])),bm=new Map(bundle.functions.map(f=>[f.id,f]));
 const scopes=sourceScopes(source),scopeOf=new Map([...scopes].flatMap(([scope,fs])=>fs.map(f=>[f.id,scope])));
 const hasScope=(map,b,scope)=>[...(map.get(b)||[])].some(s=>scopeOf.get(s)===scope);
 for(const edge of sourceGraph.edges)if(scopeOf.get(edge.from)!==scopeOf.get(edge.to))throw Error('Source graph crosses library boundaries; rebuild the source graph');
 let allowed=new Set(sm.keys());
 if(o.libraryGate){
  libraries??=identifyLibraries(source,bundle,o);artifact(libraries,'recall.libraries/v1');sameInput(libraries.sourceDigest,source.inputDigest);sameInput(libraries.bundleDigest,bundle.inputDigest);
  if(['minFeatures','featureMetric','minAnchors','uniqueBundle'].some(k=>libraries.options[k]!==o[k]))throw Error('Library options disagree with recovery configuration');
  if(!source.functions.some(f=>f.library))throw Error('libraryGate requires versioned reference library metadata; use provided-reference mode explicitly if unavailable');
  const detected=new Set(libraries.libraries.filter(x=>x.detected).map(x=>x.libraryScope));
  if(libraries.libraries.some(x=>!x.libraryScope))throw Error('Library detection predates isolation; identify libraries again');
  allowed=new Set(source.functions.filter(f=>detected.has(scopeOf.get(f.id))).map(f=>f.id));
 }
 const sg=adjacency(sourceGraph),bg=adjacency(bundleGraph),accepted=new Map(),promotions=[],queries=[],processed=new Set(),minified=new Map(),vectors=new Map();
 const retain=o.conflictPolicy==='retain';
 const addAccepted=(b,s)=>{if(!accepted.has(b))accepted.set(b,new Set());accepted.get(b).add(s)};
 for(const p of anchors.matches){
  if(!sm.has(p.sourceId)||!bm.has(p.bundleId))throw Error('Unknown anchor function');if(!allowed.has(p.sourceId))continue;
  if(!retain&&hasScope(accepted,p.bundleId,scopeOf.get(p.sourceId)))throw Error('Conflicting anchors for bundled target');
  addAccepted(p.bundleId,p.sourceId);promotions.push({...p,libraryScope:scopeOf.get(p.sourceId),round:0});
 }
 if(candidateSelector!==null&&typeof candidateSelector!=='function')throw Error('candidateSelector must be a function');
 const client=candidateSelector?{config:{provider:'external-neighborhood-selector'},stats:{requests:0}}:models||createModelClient(config.models,{signal});
 const stats={validationCalls:0,embeddingFunctions:0,rounds:0,conflicts:0,astPreRankingChecks:0,astPreRankingAccepted:0},diagnostics=[];let status='fixed-point',firstRound=1,pendingRound=null,lastCheckpoint=performance.now();
 if(resume){
  artifact(resume,'recall.recovery/v1');if(resume.scopePolicy!=='per-library-source/full-bundle-v1')throw Error('Resume predates strict library isolation; start a new run');if((resume.selectionMode||'model')!==(candidateSelector?'external-neighborhood-selector':'model'))throw Error('Resume selection mode changed');sameInput(resume.sourceDigest,source.inputDigest);sameInput(resume.bundleDigest,bundle.inputDigest);
  if(resume.graphDigests.source!==sourceGraph.graphDigest||resume.graphDigests.bundle!==bundleGraph.graphDigest)throw Error('Resume graph mismatch');
  const stable=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['maxRounds','maxValidationCalls','models'].includes(k)));
  if(hash(stable(resume.configuration))!==hash(stable(o)))throw Error('Resume recovery settings changed');
  if(resume.models&&client.config&&hash(resume.models)!==hash(client.config))throw Error('Resume model settings changed');
  if(resume.modelDigests&&client.metadata&&hash(await client.metadata())!==hash(resume.modelDigests))throw Error('Resume model digests changed');
  accepted.clear();promotions.length=0;
  for(const p of resume.promotions){if(!sm.has(p.sourceId)||!bm.has(p.bundleId)||!allowed.has(p.sourceId)||accepted.get(p.bundleId)?.has(p.sourceId)||(!retain&&hasScope(accepted,p.bundleId,scopeOf.get(p.sourceId))))throw Error('Invalid resumed promotion');addAccepted(p.bundleId,p.sourceId);promotions.push(p)}
  queries.push(...resume.queries);diagnostics.push(...resume.diagnostics);for(const state of resume.processedStates||[])processed.add(state);Object.assign(stats,resume.stats);delete stats.model;delete stats.elapsedMs;
  firstRound=resume.pendingRound?.round||resume.nextRound||stats.rounds+1;
  if(o.maxValidationCalls!==null&&o.maxValidationCalls<stats.validationCalls)throw Error('Resume validation budget is below completed work');
 }
 const priorChecks=new Map();if(resume)for(const query of queries)for(const check of query.checks)if(check.reusableAfterMigration!==false&&['accept','reject'].includes(check.verdict))priorChecks.set(JSON.stringify([query.bundleId,check.sourceId]),check);
 const representation=s=>{if(!minified.has(s.id))minified.set(s.id,minifySourceFunction(s.code));return minified.get(s.id)};
 async function vector(fs,role){
  const missing=fs.filter(f=>!vectors.has(role+':'+f.id));
  if(missing.length){const inputs=missing.map(f=>role==='source'&&o.sourceRepresentation==='minified'?'Instruct: Represent this minified JavaScript function for semantic similarity comparison with other minified JavaScript functions. Focus on behavior, allowing for identifier renaming and equivalent syntactic rewrites.\nQuery:'+representation(f):f.code);
   const vs=await client.embed(inputs);if(vs.length!==missing.length)throw Error('Embedding response count mismatch');
   missing.forEach((f,i)=>{cosine(vs[i],vs[i]);vectors.set(role+':'+f.id,vs[i])});stats.embeddingFunctions+=missing.length;
  }
  return fs.map(f=>vectors.get(role+':'+f.id));
 }
 const snapshot=()=>({schema:'recall.recovery/v1',scopePolicy:'per-library-source/full-bundle-v1',libraryScopes:[...scopes.keys()],status,...(resume?.continuation?{continuation:resume.continuation}:{}),sourceDigest:source.inputDigest,bundleDigest:bundle.inputDigest,graphDigests:{source:sourceGraph.graphDigest,bundle:bundleGraph.graphDigest},configuration:o,models:client.config||{provider:'injected'},modelDigests:client.modelDigests||null,promotions,queries,diagnostics,multipleMatches:matchingMultiplicity(promotions),processedStates:[...processed],pendingRound,nextRound:pendingRound?.round||stats.rounds+1,unrecovered:bundle.functions.filter(f=>!accepted.has(f.id)).map(f=>f.id),stats:{...stats,elapsedMs:(resume?.stats.elapsedMs||0)+performance.now()-started,model:Object.fromEntries([...new Set([...Object.keys(resume?.stats.model||{}),...Object.keys(client.stats||{})])].map(k=>[k,(resume?.stats.model?.[k]||0)+(client.stats?.[k]||0)]))},selectionMode:candidateSelector?'external-neighborhood-selector':'model',allocationPolicy:o.conflictPolicy,candidatePolicy:o.astBeforeRanking?'first-ast-hit-immediate-then-top-k-model':'first-accept-ast-then-model',policy:retain?'Stop at first equivalent candidate for each unmatched target within each source library; reuse source identities across distinct targets. No ground truth enters recovery.':candidateSelector?'Externally selected candidate simulation. Caller supplies the decision rule; no embeddings, ranking, validation, or model client. This is not measured model recovery. Each bundled target is settled once per source library; source identities are reusable within and across chunks.':'Heuristic source identity recovery. No oracle or source-map reads; validation is not a semantic equivalence proof. Each bundled target is settled once per source library; source identities are reusable within and across chunks.'});
 if(!resume&&onCheckpoint){status='running';await onCheckpoint(snapshot())}
 if(resume?.status==='fixed-point')return snapshot();
 if(firstRound>o.maxRounds){status='round-limit';return snapshot()}
 for(let round=firstRound;round<=o.maxRounds;round++){
  if(signal?.aborted)throw signal.reason||Error('Recovery interrupted');
  stats.rounds=round;const prior=new Map([...accepted].map(([b,ss])=>[b,new Set(ss)])),pending=round===firstRound&&resume?.pendingRound?resume.pendingRound.proposals.map(({queryIndex,...p})=>({...p,q:queries[queryIndex]})):[];let budgetHit=false,immediateAdded=0;const reserved=new Set(pending.map(p=>JSON.stringify([scopeOf.get(p.sourceId),p.bundleId])));
  targets: for(const libraryScope of scopes.keys())for(const b of bundle.functions){
   if(signal?.aborted)throw signal.reason||Error('Recovery interrupted');
   // A matched target is settled, including anchors. A source identity can
   // identify additional bundled copies in the same or a different chunk.
   if(hasScope(prior,b.id,libraryScope)||reserved.has(JSON.stringify([libraryScope,b.id]))||b.code.length>o.maxCodeCharacters)continue;
   const parents=[...neighbors(b.id,bg,o.radius)].filter(id=>hasScope(prior,id,libraryScope)&&(o.crossChunk||bm.get(id).unit===b.unit));
   if(!parents.length)continue;
   const candidates=new Set();
   for(const parent of parents)for(const parentSource of prior.get(parent))if(scopeOf.get(parentSource)===libraryScope)for(const id of neighbors(parentSource,sg,o.radius))if(scopeOf.get(id)===libraryScope&&allowed.has(id)&&sm.get(id).code.length<=o.maxCodeCharacters)candidates.add(id);
   const list=[...candidates].filter(id=>{try{if(!candidateSelector)representation(sm.get(id));return true}catch(error){if(!diagnostics.some(d=>d.function===id))diagnostics.push({kind:'source-minification-error',function:id,error:error.message});return false}}).sort((a,b)=>sourceIndex.get(a)-sourceIndex.get(b));if(!list.length)continue;
   const state=hash([libraryScope,b.id,list,parents.map(p=>[p,[...prior.get(p)].filter(s=>scopeOf.get(s)===libraryScope).sort()])]);if(processed.has(state))continue;processed.add(state);
   if(candidateSelector){
    const selected=await candidateSelector({bundle:b,candidates:list.map(id=>sm.get(id)),round,libraryScope,parentBundleIds:parents});
    if(selected!==null&&!list.includes(selected))throw Error('External selector returned a function outside the neighborhood');
    const q={bundleId:b.id,round,libraryScope,...(resume?.continuation?{phase:resume.continuation.id}:{}),parentBundleIds:parents,candidates:list.map(sourceId=>({sourceId})),checks:[],status:'unresolved',selection:'external-neighborhood-selector'};queries.push(q);
    if(selected!==null){q.status='pending';pending.push({sourceId:selected,bundleId:b.id,unit:b.unit,round,libraryScope,kind:'externally-selected',parentBundleIds:parents,q})}
    continue;
   }
   if(o.maxValidationCalls!==null&&stats.validationCalls>=o.maxValidationCalls){budgetHit=true;processed.delete(state);break targets}
   if(o.astBeforeRanking){
    let matched=null,checks=0;
    for(const id of list){
     if(signal?.aborted)throw signal.reason||Error('Recovery interrupted');
     const s=sm.get(id);stats.astPreRankingChecks++;checks++;
     if(astMatch(s.code,b.code,{minifiedSource:representation(s)})){matched=s;break}
    }
    if(matched){
     const selected={sourceId:matched.id},result={verdict:'accept',validator:'ast',policy:'alpha-shape-method-aware-unverified-externals-v2',stage:'before-ranking-first-hit'};
     const q={bundleId:b.id,round,libraryScope,...(resume?.continuation?{phase:resume.continuation.id}:{}),parentBundleIds:parents,candidatePoolSize:list.length,selection:'ast-before-ranking',astSearch:'first-hit',astChecks:checks,candidates:[selected],checks:[{...selected,...result}],status:'promoted'};
     queries.push(q);stats.validationCalls++;stats.astPreRankingAccepted++;
     priorChecks.set(JSON.stringify([b.id,matched.id]),result);
     // New AST correspondences are available as anchors immediately, including
     // for later targets in this same pass. They remain AST, not POG, promotions.
     addAccepted(b.id,matched.id);if(!prior.has(b.id))prior.set(b.id,new Set());prior.get(b.id).add(matched.id);
     promotions.push({sourceId:matched.id,bundleId:b.id,unit:b.unit,round,libraryScope,kind:'ast-recovered',validator:'ast',stage:'before-ranking-first-hit',parentBundleIds:parents});immediateAdded++;
     if(onProgress)await onProgress({stage:'recovery',round,libraryScope,recovered:accepted.size,acceptedPairs:promotions.length,targets:bundle.functions.length,validationCalls:stats.validationCalls,astPreRankingChecks:stats.astPreRankingChecks,astPreRankingAccepted:stats.astPreRankingAccepted,validationBreakdown:{astChecks:client.stats?.astChecks||0,astAccepted:client.stats?.astAccepted||0,qwenRequests:client.stats?.validationRequests||0,qwenCacheHits:client.stats?.validationCacheHits||0}});
     if(onCheckpoint&&performance.now()-lastCheckpoint>=120000){pendingRound={round,proposals:pending.map(({q,...p})=>({...p,queryIndex:queries.indexOf(q)}))};await onCheckpoint(snapshot());pendingRound=null;lastCheckpoint=performance.now()}
     continue;
    }
   }
   const sources=list.map(id=>sm.get(id)),sv=await vector(sources,'source'),[bv]=await vector([b],'bundle');
   const ranked=sources.map((s,i)=>({sourceId:s.id,score:cosine(bv,sv[i])})).filter(x=>x.score>=o.minSimilarity).sort((a,b)=>b.score-a.score||sourceIndex.get(a.sourceId)-sourceIndex.get(b.sourceId));
   const q={bundleId:b.id,round,libraryScope,...(resume?.continuation?{phase:resume.continuation.id}:{}),parentBundleIds:parents,candidates:ranked,checks:[],status:'unresolved'};queries.push(q);
   for(const candidate of ranked.slice(0,o.topK)){
    if(retain&&prior.get(b.id)?.has(candidate.sourceId))continue;
    if(signal?.aborted)throw signal.reason||Error('Recovery interrupted');
    const priorCheck=priorChecks.get(JSON.stringify([b.id,candidate.sourceId]));
    if(!priorCheck&&o.maxValidationCalls!==null&&stats.validationCalls>=o.maxValidationCalls){budgetHit=true;break}
    const s=sm.get(candidate.sourceId);let result;
    try{result=priorCheck?{...priorCheck,reusedFromCheckpoint:true}:await client.validate({source:s,bundle:b,minified:representation(s)})}catch(e){if(signal?.aborted)throw signal.reason||e;throw e}
    if(!priorCheck)stats.validationCalls++;if(!['accept','reject','invalid','error'].includes(result.verdict))throw Error('Validator provider returned an invalid verdict contract');
    q.checks.push({sourceId:s.id,score:candidate.score,...result});
    if(retain&&['accept','reject'].includes(result.verdict))priorChecks.set(JSON.stringify([b.id,s.id]),result);
    if(result.verdict==='accept'){q.status='pending';pending.push({sourceId:s.id,bundleId:b.id,unit:b.unit,round,libraryScope,kind:result.validator==='ast'?'ast-recovered':'model-recovered',validator:result.validator||'model',parentBundleIds:parents,q});break}
   }
   if(onProgress)await onProgress({stage:'recovery',round,libraryScope,recovered:accepted.size,acceptedPairs:promotions.length,targets:bundle.functions.length,validationCalls:stats.validationCalls,astPreRankingChecks:stats.astPreRankingChecks,astPreRankingAccepted:stats.astPreRankingAccepted,validationBreakdown:{astChecks:client.stats?.astChecks||0,astAccepted:client.stats?.astAccepted||0,qwenRequests:client.stats?.validationRequests||0,qwenCacheHits:client.stats?.validationCacheHits||0}});
   if(budgetHit){processed.delete(state);break targets}
   if(o.astBeforeRanking&&onCheckpoint&&performance.now()-lastCheckpoint>=120000){pendingRound={round,proposals:pending.map(({q,...p})=>({...p,queryIndex:queries.indexOf(q)}))};await onCheckpoint(snapshot());pendingRound=null;lastCheckpoint=performance.now()}
  }
  if(budgetHit){
   pendingRound={round,proposals:pending.map(({q,...p})=>({...p,queryIndex:queries.indexOf(q)}))};status='budget-exhausted';
   if(onCheckpoint)await onCheckpoint(snapshot());
   if(onProgress)await onProgress({stage:'recovery',round,recovered:accepted.size,acceptedPairs:promotions.length,targets:bundle.functions.length,validationCalls:stats.validationCalls,status});break;
  }
  pendingRound=null;
  let added=immediateAdded;
  for(const {q,...p}of pending){
   if(accepted.get(p.bundleId)?.has(p.sourceId))continue;
   const conflict=hasScope(accepted,p.bundleId,scopeOf.get(p.sourceId));
   if(conflict){stats.conflicts++;if(!retain){q.status='identity-conflict';continue}}
   addAccepted(p.bundleId,p.sourceId);promotions.push(p);q.status='promoted';added++;
  }
  status=budgetHit?'budget-exhausted':!added?'fixed-point':round===o.maxRounds?'round-limit':'running';
  if(onCheckpoint)await onCheckpoint(snapshot());
  if(onProgress)await onProgress({stage:'recovery',round,recovered:accepted.size,acceptedPairs:promotions.length,targets:bundle.functions.length,validationCalls:stats.validationCalls,status});
  if(status!=='running')break;
 }
 if(client.metadata&&stats.validationCalls)await client.metadata();return snapshot();
}

export function preparePipeline({source,bundle,config={}}){
 config=normalizeConfig(config);
 const options=config.recovery,graphOptions=config.graph,resolverOptions=config.modules;
 const libraries=identifyLibraries(source,bundle,options),anchors=identifyAnchors(source,bundle,options),sourceBundler=identifyBundler(source),bundleBundler=identifyBundler(bundle,config.bundler);
 const sourceModules=graphOptions.useModules===false?null:resolveModules(source,{...resolverOptions,isolateLibraries:true,bundler:sourceBundler});
 const bundleModules=graphOptions.useModules===false?null:resolveModules(bundle,{...resolverOptions,isolateLibraries:false,bundler:bundleBundler});
 const sourceGraph=buildGraph(source,{...graphOptions,isolateLibraries:true,moduleMap:sourceModules}),bundleGraph=buildGraph(bundle,{...graphOptions,isolateLibraries:false,moduleMap:bundleModules});
 return {libraries,anchors,sourceBundler,bundleBundler,sourceModules,bundleModules,sourceGraph,bundleGraph,options};
}
export async function runPipeline({source,bundle,config={},models=null,onCheckpoint=null,candidateSelector=null}){
 const prepared=preparePipeline({source,bundle,config});
 const recovery=await recoverFunctions({source,bundle,...prepared,config:{...prepared.options,models:config.models},models,onCheckpoint,candidateSelector});
 return {...prepared,recovery};
}
