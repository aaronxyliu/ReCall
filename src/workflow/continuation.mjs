// Explicit, audited continuation across a static-analysis upgrade. This is not
// ordinary resume compatibility and does not silently bless edited inputs.
import {hash,checkInventory} from '../shared/artifacts.mjs';
import {checkGraph} from '../../components/graph/index.mjs';
const withoutCache=m=>Object.fromEntries(Object.entries(m||{}).filter(([k])=>k!=='cacheDir'));
export function migrateRecovery({prior,oldSource,oldBundle,source,bundle,oldSourceGraph,oldBundleGraph,sourceGraph,bundleGraph,models,implementation}){
 if(prior.schema!=='recall.recovery/v1')throw Error('Unknown prior recovery schema');
 if(prior.checkpointDigest){const {checkpointDigest,...state}=prior;if(checkpointDigest!==hash(state))throw Error('Prior checkpoint checksum mismatch')}
 for(const p of [oldSource,oldBundle,source,bundle])checkInventory(p);
 for(const [g,i]of [[oldSourceGraph,oldSource],[oldBundleGraph,oldBundle],[sourceGraph,source],[bundleGraph,bundle]])checkGraph(g,i);
 if(prior.sourceDigest!==oldSource.inputDigest||prior.bundleDigest!==oldBundle.inputDigest||prior.graphDigests.source!==oldSourceGraph.graphDigest||prior.graphDigests.bundle!==oldBundleGraph.graphDigest)throw Error('Prior artifacts do not match checkpoint');
 for(const [old,next]of [[oldSource,source],[oldBundle,bundle]]){
  const signature=p=>p.units.map(u=>[u.id,u.path,u.environment,u.runtimeGroup,hash(u.code),u.library||null]).sort((a,b)=>a[0].localeCompare(b[0]));
  if(hash(signature(old))!==hash(signature(next)))throw Error('Continuation requires identical supplied units and bytes');
  const oldFunctions=old.functions.map(f=>[f.id,f.unit,f.span,f.parent,f.pogHash,f.propertyOperations,f.graphNodes]).sort((a,b)=>a[0].localeCompare(b[0]));
  const newFunctions=next.functions.map(f=>[f.id,f.unit,f.span,f.parent,f.pogHash,f.propertyOperations,f.graphNodes]).sort((a,b)=>a[0].localeCompare(b[0]));
  if(hash(oldFunctions)!==hash(newFunctions))throw Error('Continuation requires stable function identities, spans and anchor features');
 }
 if(hash(withoutCache(prior.models))!==hash(withoutCache(models)))throw Error('Continuation model settings changed');
 if(prior.pendingRound)throw Error('Finish pending budget-limited round before continuation');
 const sm=new Set(source.functions.map(f=>f.id)),bm=new Set(bundle.functions.map(f=>f.id));
 for(const p of prior.promotions)if(!sm.has(p.sourceId)||!bm.has(p.bundleId))throw Error('Accepted identity missing after upgrade');
 const {checkpointDigest,...state}=structuredClone(prior);
 const continuation={id:'source-resolution-method-v1',at:new Date().toISOString(),priorRecoverySHA256:hash(prior),priorSourceDigest:prior.sourceDigest,priorBundleDigest:prior.bundleDigest,priorGraphDigests:prior.graphDigests,priorImplementation:implementation.prior,newImplementation:implementation.next,preservedAcceptedPairs:prior.promotions.length,preservedQueries:prior.queries.length,priorRounds:prior.stats.rounds,policy:'Preserve all accepted identities; reopen unmatched targets; recompute AST checks, reuse only exact raw model responses. Mixed-phase incremental recovery, not a clean rerun.'};
 return {...state,sourceDigest:source.inputDigest,bundleDigest:bundle.inputDigest,graphDigests:{source:sourceGraph.graphDigest,bundle:bundleGraph.graphDigest},models,queries:state.queries.map(q=>({...q,phase:q.phase||'baseline',checks:q.checks.map(c=>({...c,reusableAfterMigration:false}))})),diagnostics:[],processedStates:[],pendingRound:null,status:'running',nextRound:prior.stats.rounds+1,continuation};
}
