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
export function resolveModules(inventory,{bundler=null,followDependencies=true,valueLimit=64,eventLimit=50000000,maxFiles=20000,maxBytes=1024*1024*1024}={}){
 checkInventory(inventory);if(bundler){artifact(bundler,'recall.bundler/v1');sameInput(bundler.inputDigest,inventory.inputDigest)}
 integer(valueLimit,'valueLimit',{min:1});integer(eventLimit,'eventLimit',{min:1});integer(maxFiles,'maxFiles',{min:1});integer(maxBytes,'maxBytes',{min:1});
 if(typeof followDependencies!=='boolean')throw Error('followDependencies must be Boolean');
 const grouped=groups(inventory.functions,f=>f.unit);
 const byUnit=new Map(inventory.units.map(u=>[u.id,(grouped.get(u.id)||[]).map(({id,span})=>({id,span}))]));
 const explicit=inventory.units.map(u=>({...u,functions:byUnit.get(u.id)}));
 const context=collectContext(explicit,{...inventory.context,follow:followDependencies,maxFiles,maxBytes});
 // Preserve all explicit units, even when two files have identical bytes.
 const paths=new Set(explicit.map(u=>u.environment+'|'+u.path));
 const extras=context.units.filter(u=>!paths.has(u.environment+'|'+u.path)).map(u=>({...u,functions:[],contextOnly:true}));
 const units=[...explicit,...extras];
 if(units.length>maxFiles||units.reduce((n,u)=>n+Buffer.byteLength(u.code),0)>maxBytes)throw Error('Resolved inputs exceed maxFiles/maxBytes; increase the explicit resource limits');
 const a=new Analyzer({valueLimit,eventLimit});
 for(const u of units)a.addUnit(u);
 const solved=a.solve();
 const plans=Object.fromEntries(Object.entries(a.recordedPlans).map(([id,p])=>[id,{registrations:p.registrations,loaders:p.loaders.map(({namespace,mechanism,span})=>({namespace,mechanism,span})),parcelLoaders:p.parcelLoaders,diagnostics:p.diagnostics}]));
 const result={schema:'recall.modules/v1',inputDigest:inventory.inputDigest,engineDigest:engineDigest(),options:{followDependencies,valueLimit,eventLimit,maxFiles,maxBytes},bundler:bundler?{family:bundler.family,candidates:bundler.candidates,status:bundler.status}:null,units,plans,moduleGraph:moduleGraph(a),diagnostics:[...context.diagnostics,...solved.errors,...solved.diagnostics],coverage:solved.coverage,contextDependencies:context.dependencies,policy:'Structural adapters select actual registration/export mechanisms; family identification is advisory. Context-only units do not create new matching targets.'};
 result.planDigest=mapDigest(result);solvedStates.set(result,{planDigest:result.planDigest,solved});return result;
}
