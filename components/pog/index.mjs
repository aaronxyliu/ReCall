import {createProject,projectNodes} from '../../src/project.mjs';
import {measure} from '../../src/analysis/measure.mjs';
import {inventoryDigest,checkInventory,integer,groups} from '../../src/shared/artifacts.mjs';

export const defaults={minFeatures:10,featureMetric:'propertyOperations',minAnchors:3,uniqueBundle:true};
export function featureOptions(options={}){
 const o={...defaults,...options};integer(o.minFeatures,'minFeatures',{min:1});integer(o.minAnchors,'minAnchors',{min:1});
 if(!['propertyOperations','graphNodes'].includes(o.featureMetric))throw Error('featureMetric must be propertyOperations or graphNodes');
 if(typeof o.uniqueBundle!=='boolean')throw Error('uniqueBundle must be Boolean');return o;
}
export function addFeatures(project){
 checkInventory(project);const nodes=projectNodes(project),diagnostics=[...project.diagnostics];
 const functions=project.functions.map(f=>{
  const node=nodes.get(f.id);if(!node)return f;
  const record={...f,...measure(node)};
  if(record.extractionStatus!=='ok')diagnostics.push({kind:'pog-extraction-failed',function:f.id,error:record.error});return record;
 });
 const result={...project,features:'pog',functions,diagnostics,policy:'Own-body POG features; no source maps or model calls.'};result.inputDigest=inventoryDigest(result);return result;
}
export function extractFeatures(manifest,options={}){return addFeatures(createProject(manifest,options))}
function eligible(inventory,o){return inventory.functions.filter(f=>f.pogHash&&Number(f[o.featureMetric])>=o.minFeatures)}
export function identifyAnchors(source,bundle,options={}){
 checkInventory(source);checkInventory(bundle);const o=featureOptions(options),sg=groups(eligible(source,o),f=>f.pogHash),matches=[],ambiguous=[];
 // Uniqueness and source allocation are scoped to each target chunk.
 for(const [unit,fs]of groups(eligible(bundle,o),f=>f.unit))for(const [fingerprint,bs]of groups(fs,f=>f.pogHash)){
  const ss=sg.get(fingerprint)||[];
  if(ss.length===1&&bs.length===1)matches.push({sourceId:ss[0].id,bundleId:bs[0].id,unit,kind:'pog-anchor',fingerprint});
  else if(ss.length)ambiguous.push({fingerprint,unit,sourceCandidates:ss.length,bundleCandidates:bs.length});
 }
 return {schema:'recall.anchors/v1',sourceDigest:source.inputDigest,bundleDigest:bundle.inputDigest,options:o,matches,ambiguous};
}
export function identifyLibraries(source,bundle,options={}){
 checkInventory(source);checkInventory(bundle);const o=featureOptions(options),bs=groups(eligible(bundle,o),f=>f.pogHash),libraries=[];
 const refs=groups(source.functions.filter(f=>f.library),f=>JSON.stringify(f.library));
 for(const [key,fs]of refs){
  const library=JSON.parse(key),evidence=[];
  for(const [fingerprint,ss]of groups(fs.filter(f=>f.pogHash&&Number(f[o.featureMetric])>=o.minFeatures),f=>f.pogHash)){
   const targets=bs.get(fingerprint)||[];
   // Count distinct reference functions/signatures, never duplicate bundled copies.
   if(ss.length===1&&targets.length&&(!o.uniqueBundle||[...groups(targets,f=>f.unit).values()].some(xs=>xs.length===1)))
    evidence.push({sourceId:ss[0].id,fingerprint,bundleIds:targets.map(f=>f.id)});
  }
  libraries.push({library,matchedAnchorFunctions:evidence.length,detected:evidence.length>=o.minAnchors,evidence});
 }
 return {schema:'recall.libraries/v1',sourceDigest:source.inputDigest,bundleDigest:bundle.inputDigest,options:o,libraries,diagnostics:source.functions.some(f=>f.library)?[]:[{kind:'missing-reference-library-metadata'}],policy:'Configurable anchor-count identification heuristic, not a complete reproduction of DEBUN library/version scoring. All passing versions are retained as candidates.'};
}
