import {libraryScope} from '../../src/analysis/library-scope.mjs';
import fs from 'node:fs';
import {Analyzer} from '../../src/engine/analyzer.mjs';
import {moduleGraph} from '../../src/engine/module-graph.mjs';
import {collectContext} from '../../src/analysis/context.mjs';
import {checkInventory,hash,artifact,sameInput,unitSignature,integer,groups} from '../../src/shared/artifacts.mjs';

const solvedStates=new WeakMap();
export function solvedRelationships(map){const state=solvedStates.get(map);return state&&state.planDigest===map.planDigest?state.solved:null}
export const engineDigest=()=>{
 const files=[];for(const directory of ['engine','analysis']){const root=new URL('../../src/'+directory+'/',import.meta.url);for(const file of fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.mjs')).sort())files.push([directory+'/'+file,fs.readFileSync(new URL(file,root),'utf8')])}
 return hash(files);
};
export const mapDigest=m=>hash({units:m.units.map(u=>({...unitSignature(u),functions:u.functions})),plans:m.plans,options:m.options,engine:m.engineDigest});
export function checkModuleMap(map,inventory){
 artifact(map,'recall.modules/v1');sameInput(map.inputDigest,inventory.inputDigest);
 if(map.engineDigest!==engineDigest()||map.planDigest!==mapDigest(map))throw Error('Stale or modified module map; resolve modules again');
 const byId=new Map(map.units.map(u=>[u.id,u]));
 for(const u of inventory.units){const x=byId.get(u.id);if(!x||hash(x.code)!==hash(u.code)||x.path!==u.path)throw Error('Module map does not contain the inventory input')}
 return map;
}
export function resolveModules(inventory,{bundler=null,followDependencies=true,isolateLibraries=inventory.units.some(u=>u.library),valueLimit=64,eventLimit=50000000,maxFiles=20000,maxBytes=1024*1024*1024}={}){
 checkInventory(inventory);if(bundler){artifact(bundler,'recall.bundler/v1');sameInput(bundler.inputDigest,inventory.inputDigest)}
 integer(valueLimit,'valueLimit',{min:1});integer(eventLimit,'eventLimit',{min:1});integer(maxFiles,'maxFiles',{min:1});integer(maxBytes,'maxBytes',{min:1});
 if(typeof isolateLibraries!=='boolean')throw Error('isolateLibraries must be Boolean');
 if(typeof followDependencies!=='boolean')throw Error('followDependencies must be Boolean');
 const grouped=groups(inventory.functions,f=>f.unit);
 const byUnit=new Map(inventory.units.map(u=>[u.id,(grouped.get(u.id)||[]).map(({id,span})=>({id,span}))]));
 const explicit=inventory.units.map(u=>({...u,functions:byUnit.get(u.id)}));
 const context=collectContext(explicit,{...inventory.context,follow:followDependencies,isolateLibraries,maxFiles,maxBytes});
 // Preserve all explicit units, even when two files have identical bytes.
 const paths=new Set(explicit.map(u=>u.environment+'|'+u.path));
 const extras=context.units.filter(u=>!paths.has(u.environment+'|'+u.path)).map(u=>({...u,functions:[],contextOnly:true}));
 const contextById=new Map(context.units.map(u=>[u.id,u]));
 const units=[...explicit.map(u=>{const c=contextById.get(u.id);return {...u,...(c?.packageRoot?{packageRoot:c.packageRoot}:{}),...(c?.packageInfo?{packageInfo:c.packageInfo}:{}),...(c?.aliasPaths?.length?{aliasPaths:c.aliasPaths}:{})}}),...extras];
 if(units.length>maxFiles||units.reduce((n,u)=>n+Buffer.byteLength(u.code),0)>maxBytes)throw Error('Resolved inputs exceed maxFiles/maxBytes; increase the explicit resource limits');
 const analysis=solveUnits(units,{valueLimit,eventLimit,isolateLibraries});
 const {solved,plans,moduleIR}=analysis;
 const result={schema:'recall.modules/v1',inputDigest:inventory.inputDigest,engineDigest:engineDigest(),options:{followDependencies,isolateLibraries,valueLimit,eventLimit,maxFiles,maxBytes},bundler:bundler?{family:bundler.family,candidates:bundler.candidates,status:bundler.status}:null,units,plans,moduleGraph:moduleIR,diagnostics:[...context.diagnostics,...solved.errors,...solved.diagnostics],coverage:solved.coverage,contextDependencies:context.dependencies,policy:'Structural adapters select actual registration/export mechanisms; family identification is advisory. Context-only units do not create new matching targets.'};
 result.planDigest=mapDigest(result);solvedStates.set(result,{planDigest:result.planDigest,solved});return result;
}

// Solve source partitions separately, including runtime-shaped published sources.
// This prevents value flow through shared global/registry state across libraries.
export function solveUnits(units,options){
 const batches=options.isolateLibraries?[...groups(units,libraryScope).values()]:[units];
 const results=[],graphs=[],plans={};
 for(const batch of batches){
  const a=new Analyzer(options);for(const u of batch)a.addUnit(u);results.push(a.solve());graphs.push(moduleGraph(a));
  Object.assign(plans,Object.fromEntries(Object.entries(a.recordedPlans).map(([id,p])=>[id,{registrations:p.registrations,loaders:p.loaders.map(({namespace,mechanism,span})=>({namespace,mechanism,span})),parcelLoaders:p.parcelLoaders,diagnostics:p.diagnostics}])));
 }
 const solved={edges:results.flatMap(r=>r.edges),errors:results.flatMap(r=>r.errors),diagnostics:results.flatMap(r=>r.diagnostics),coverage:{parseErrors:results.reduce((n,r)=>n+r.coverage.parseErrors,0),unresolvedImports:results.reduce((n,r)=>n+r.coverage.unresolvedImports,0),status:'partial-static-analysis; convergence is not completeness'}};
 const moduleIR={schema:'recall.module-ir/v1',policy:options.isolateLibraries?'Independent source library graphs; external imports remain unresolved.':'Full supplied bundle module graph without library boundaries.'};
 for(const field of ['modules','dependencies','exports','bindings'])moduleIR[field]=graphs.flatMap(g=>g[field]);
 return {solved,plans,moduleIR};
}
