// Narrow continuation for candidate-policy changes; graphs and inputs stay fixed.
import {hash,checkInventory} from '../shared/artifacts.mjs';
import {checkGraph} from '../../components/graph/index.mjs';
export function migrateASTBeforeRanking({prior,source,bundle,sourceGraph,bundleGraph,models,configuration,implementation}){
 if(prior.schema!=='recall.recovery/v1')throw Error('Unknown recovery schema');
 if(prior.checkpointDigest){const {checkpointDigest,...state}=prior;if(checkpointDigest!==hash(state))throw Error('Prior checkpoint checksum mismatch')}
 checkInventory(source);checkInventory(bundle);checkGraph(sourceGraph,source);checkGraph(bundleGraph,bundle);
 if(prior.sourceDigest!==source.inputDigest||prior.bundleDigest!==bundle.inputDigest||prior.graphDigests.source!==sourceGraph.graphDigest||prior.graphDigests.bundle!==bundleGraph.graphDigest)throw Error('AST continuation requires unchanged inventories and graphs');
 const before={oneBundlePerSource:false,neighborhoodOrder:'bundle-first',astBeforeRanking:false,...prior.configuration},after={oneBundlePerSource:false,neighborhoodOrder:'bundle-first',...configuration};if(before.allowCorroboratedAstCopies===false)delete before.allowCorroboratedAstCopies;delete before.models;delete after.models;
 if(before.astBeforeRanking||after.astBeforeRanking!==true)throw Error('AST continuation requires false-to-true policy change');
 before.astBeforeRanking=true;if(hash(Object.entries(before).sort())!==hash(Object.entries(after).sort()))throw Error('AST continuation changes unrelated recovery settings');
 const withoutCache=m=>Object.fromEntries(Object.entries(m||{}).filter(([k])=>k!=='cacheDir'));
 if(hash(Object.entries(withoutCache(prior.models)).sort())!==hash(Object.entries(withoutCache(models)).sort()))throw Error('AST continuation changes model settings');
 if(prior.pendingRound)throw Error('Finish pending round before AST continuation');
 const sm=new Set(source.functions.map(f=>f.id)),bm=new Set(bundle.functions.map(f=>f.id));
 for(const p of prior.promotions)if(!sm.has(p.sourceId)||!bm.has(p.bundleId))throw Error('Unknown accepted identity');
 const {checkpointDigest,...state}=structuredClone(prior);
 const continuation={id:'ast-first-hit-immediate-v2',at:new Date().toISOString(),priorRecoverySHA256:hash(prior),priorImplementation:implementation.prior,newImplementation:implementation.next,preservedAcceptedPairs:prior.promotions.length,preservedQueries:prior.queries.length,priorRounds:prior.stats.rounds,priorContinuation:prior.continuation||null,policy:'Preserve accepted identities, graph artifacts and reusable exact-pair decisions; reopen unmatched targets with immediate first-hit AST anchors before embedding top-k. Incremental continuation, not a clean rerun.'};
 return {...state,configuration:after,models,queries:state.queries.map(q=>({...q,phase:q.phase||'baseline'})),processedStates:[],pendingRound:null,status:'running',nextRound:prior.stats.rounds+1,continuation};
}
