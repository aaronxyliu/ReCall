// Explicit graph-only continuation on frozen matching inventories.
import {hash,checkInventory} from '../shared/artifacts.mjs';
import {checkGraph} from '../../components/graph/index.mjs';
const sorted=x=>Object.entries(x).sort();
export function migrateGraphSyntax({prior,source,bundle,oldSourceGraph,oldBundleGraph,sourceGraph,bundleGraph,models,configuration,implementation}){
 if(prior.schema!=='recall.recovery/v1')throw Error('Unknown recovery schema');
 if(prior.checkpointDigest){const {checkpointDigest,...state}=prior;if(checkpointDigest!==hash(state))throw Error('Prior checkpoint checksum mismatch')}
 checkInventory(source);checkInventory(bundle);
 for(const [g,i]of [[oldSourceGraph,source],[sourceGraph,source],[oldBundleGraph,bundle],[bundleGraph,bundle]])checkGraph(g,i);
 if(prior.sourceDigest!==source.inputDigest||prior.bundleDigest!==bundle.inputDigest||prior.graphDigests.source!==oldSourceGraph.graphDigest||prior.graphDigests.bundle!==oldBundleGraph.graphDigest)throw Error('Graph continuation requires unchanged inventories and verified old graphs');
 const before={...prior.configuration,astBeforeRanking:true},after={...configuration};delete before.models;delete after.models;
 if(configuration.astBeforeRanking!==true||configuration.topK!==3||configuration.minSimilarity!==-1||configuration.conflictPolicy!=='retain'||hash(sorted(before))!==hash(sorted(after)))throw Error('Graph continuation changes unrelated recovery settings');
 const modelSettings=x=>sorted(Object.fromEntries(Object.entries(x||{}).filter(([k])=>k!=='cacheDir')));
 if(hash(modelSettings(prior.models))!==hash(modelSettings(models)))throw Error('Graph continuation changes model settings');
 const sources=new Set(source.functions.map(f=>f.id)),targets=new Set(bundle.functions.map(f=>f.id)),accepted=new Set();
 for(const p of prior.promotions){if(!sources.has(p.sourceId)||!targets.has(p.bundleId)||accepted.has(p.bundleId))throw Error('Invalid prior accepted pair');accepted.add(p.bundleId)}
 const priorSHA=hash(prior),{checkpointDigest,...state}=prior,queries=prior.queries.map(q=>({...q,phase:q.phase||'baseline'})),promotions=[...prior.promotions];let committedPending=0;
 for(const proposal of prior.pendingRound?.proposals||[]){
  const {queryIndex,...p}=proposal,q=queries[queryIndex];
  if(!sources.has(p.sourceId)||!targets.has(p.bundleId)||accepted.has(p.bundleId)||!q||q.bundleId!==p.bundleId||!q.checks.some(c=>c.sourceId===p.sourceId&&c.verdict==='accept'))throw Error('Invalid checkpointed pending decision');
  promotions.push(p);accepted.add(p.bundleId);q.status='promoted';committedPending++;
 }
 const continuation={id:'graph-syntax-v1',at:new Date().toISOString(),priorRecoverySHA256:priorSHA,priorGraphDigests:prior.graphDigests,newGraphDigests:{source:sourceGraph.graphDigest,bundle:bundleGraph.graphDigest},priorImplementation:implementation.prior,newImplementation:implementation.next,preservedAcceptedPairs:prior.promotions.length,committedPendingPairs:committedPending,preservedQueries:prior.queries.length,priorRounds:prior.stats.rounds,priorContinuation:prior.continuation||null,policy:'Frozen matching inventories and initial anchors; preserve accepted/checkpointed positive decisions and exact pair caches; rebuild graphs and reopen unmatched targets. First AST hit with immediate promotion, otherwise top-three semantic validation.'};
 return {...state,models,configuration:after,graphDigests:continuation.newGraphDigests,promotions,queries,processedStates:[],pendingRound:null,status:'running',nextRound:prior.stats.rounds+1,unrecovered:bundle.functions.filter(f=>!accepted.has(f.id)).map(f=>f.id),candidatePolicy:'first-ast-hit-immediate-then-top-k-model',continuation};
}
