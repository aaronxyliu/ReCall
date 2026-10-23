import {analyze} from '../../src/analysis/lexical.mjs';
import {Analyzer} from '../../src/engine/analyzer.mjs';
import {checkModuleMap,solvedRelationships} from '../modules/index.mjs';
import {checkInventory,integer,hash,artifact,sameInput,groups} from '../../src/shared/artifacts.mjs';

export const graphDigest=g=>hash({input:g.inputDigest,functions:g.functions,edges:g.edges,options:g.options,modulePlan:g.modulePlanDigest});
export function checkGraph(g,inventory){
 artifact(g,'recall.graph/v1');sameInput(g.inputDigest,inventory.inputDigest);
 if(g.graphDigest!==graphDigest(g))throw Error('Modified relationship graph');
 const ids=new Set(inventory.functions.map(f=>f.id));
 if(g.functions.length!==ids.size||new Set(g.functions.map(f=>f.id)).size!==ids.size||g.functions.some(f=>!ids.has(f.id)))throw Error('Graph/function inventory mismatch');
 for(const e of g.edges)if(!ids.has(e.from)||!ids.has(e.to))throw Error('Graph edge references an unknown function');
 return g;
}
export function buildGraph(inventory,{moduleMap=null,siblingWindow=2,includeContainment=true}={}){
 checkInventory(inventory);integer(siblingWindow,'siblingWindow');if(typeof includeContainment!=='boolean')throw Error('includeContainment must be Boolean');
 const edges=[],seen=new Set(),diagnostics=[];
 const add=e=>{if(e.from===e.to)return;const k=JSON.stringify([e.from,e.to,e.kind]);if(!seen.has(k)){seen.add(k);edges.push(e)}};
 if(moduleMap){
  checkModuleMap(moduleMap,inventory);let result=solvedRelationships(moduleMap);
  if(!result){const a=new Analyzer({...moduleMap.options,modulePlans:moduleMap.plans});for(const u of moduleMap.units)a.addUnit(u);result=a.solve()}
 result.edges.forEach(add);diagnostics.push(...moduleMap.diagnostics,...result.errors,...result.diagnostics);
 }else {const byUnit=groups(inventory.functions,f=>f.unit);for(const u of inventory.units){
  try{
   const a=analyze(u.code),ids=new Map((byUnit.get(u.id)||[]).map(f=>[f.span.join(':'),f.id]));
   for(const e of a.edges){const from=ids.get(a.functions[e.from].node.range.join(':')),to=ids.get(a.functions[e.to].node.range.join(':'));if(from&&to)add({from,to,kind:e.kind,fromUnit:u.id,toUnit:u.id})}
  }catch(e){diagnostics.push({kind:'local-graph-parse-error',unit:u.id,error:e.message})}
 }
 }
 for(const f of inventory.functions)if(f.parent&&includeContainment)add({from:f.parent,to:f.id,kind:'contains'});
 for(const fs of groups(inventory.functions,f=>JSON.stringify([f.unit,f.parent])).values()){
  fs.sort((a,b)=>a.span[0]-b.span[0]);
  for(let i=0;i<fs.length;i++)for(let d=1;d<=siblingWindow&&i+d<fs.length;d++)add({from:fs[i].id,to:fs[i+d].id,kind:'sibling'});
 }
 const result={schema:'recall.graph/v1',inputDigest:inventory.inputDigest,functions:inventory.functions.map(({id,unit,span})=>({id,unit,span})),edges,options:{mode:moduleMap?'module-aware':'local',siblingWindow,includeContainment},modulePlanDigest:moduleMap?.planDigest||null,diagnostics,policy:'Undirected neighborhood search consumes calls, references, containment, and proximity. Edges are candidates, not identity judgments or a precise call graph.'};
 result.graphDigest=graphDigest(result);return result;
}
