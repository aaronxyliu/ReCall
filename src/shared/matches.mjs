// Distinct accepted identities, not proposal-event counts. Source duplication
// within and across chunks is supported; report the two scopes separately.
export function matchingMultiplicity(pairs){
 const bundles=new Map(),sources=new Map(),chunkSources=new Map();
 for(const p of pairs){
  for(const [map,key,value]of [[bundles,p.bundleId,p.sourceId],[sources,p.sourceId,p.bundleId],[chunkSources,JSON.stringify([p.unit??p.bundleId.slice(0,p.bundleId.lastIndexOf(':',p.bundleId.lastIndexOf(':')-1)),p.sourceId]),p.bundleId]]){
   if(!map.has(key))map.set(key,new Set());map.get(key).add(value);
  }
 }
 const multi=map=>[...map].filter(([,v])=>v.size>1);
 return {matchedBundledFunctions:bundles.size,matchedSourceFunctions:sources.size,
  bundledFunctionsWithMultipleSources:multi(bundles).length,
  sourceFunctionsWithMultipleTargets:multi(sources).length,
  sourceChunkGroupsWithMultipleTargets:multi(chunkSources).length,
  maxSourcesPerBundledFunction:[...bundles.values()].reduce((n,v)=>Math.max(n,v.size),0),
  bundledAlternatives:multi(bundles).map(([bundleId,s])=>({bundleId,sourceIds:[...s]})),
  sourceChunkAlternatives:multi(chunkSources).map(([key,b])=>({scope:JSON.parse(key),bundleIds:[...b]}))};
}
