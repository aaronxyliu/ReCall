import * as scope from 'eslint-scope';
import {parseModule} from '../../src/analysis/parse.mjs';
import {recognize} from '../../src/engine/recognize.mjs';
import {checkInventory} from '../../src/shared/artifacts.mjs';

export const families=['webpack','rspack','esbuild','rollup','rolldown','turbopack','parcel'];
const fn=n=>/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n?.type);
export function recognitionInput(unit){
 const ast=parseModule(unit.code,{next:true,ranges:true}),bind=new WeakMap(),parent=new WeakMap(),owner=new WeakMap(),nodes=[];
 const scopes=scope.analyze(ast,{ecmaVersion:2022,sourceType:'module',optimistic:true,ignoreEval:true});let slot=0;
 for(const s of scopes.scopes)for(const v of s.variables){const id=slot++;for(const n of v.identifiers)bind.set(n,id);for(const r of v.references)bind.set(r.identifier,id)}
 const todo=[{n:ast,p:null,o:null}];
 while(todo.length){const {n,p,o}=todo.pop();if(p)parent.set(n,p);owner.set(n,o);nodes.push(n);
  for(const [k,v]of Object.entries(n)){if(['loc','range'].includes(k))continue;for(const c of Array.isArray(v)?v:[v])if(c?.type)todo.push({n:c,p:n,o:fn(n)?n:o})}
 }
 return {nodes,bind,parent,owner,unit,code:unit.code};
}
export function identifyBundler(inventory,{hint=null}={}){
 checkInventory(inventory);if(hint&&!families.includes(hint))throw Error('Unsupported bundler hint: '+hint);
 const units=inventory.units.map(u=>{
  try{
   const input=recognitionInput(u),r=recognize(input),candidates=new Set(),evidence=[];
   for(const registration of r.registrations){
    if(registration.kind==='webpack'||registration.kind==='rspack'){candidates.add('webpack');candidates.add('rspack')}
    else if(families.includes(registration.kind))candidates.add(registration.kind);
    evidence.push({kind:'runtime-registration',protocol:registration.kind,mechanism:registration.mechanism,span:registration.node.range});
   }
   const esm=input.nodes.filter(n=>n.type==='ImportDeclaration'||n.type.startsWith('Export'));
   if(!candidates.size&&esm.length){for(const x of ['esbuild','rollup','rolldown'])candidates.add(x);evidence.push({kind:'esm-structure',count:esm.length})}
   if(!candidates.size){
    // Generic CJS/export helpers identify a compatible mechanism, not one brand.
    const helper=input.nodes.find(n=>n.type==='ObjectExpression'&&n.properties.some(p=>(p.key?.name??p.key?.value)==='exports'&&p.value?.type==='ObjectExpression'));
    const getter=input.nodes.find(n=>n.type==='ObjectExpression'&&n.properties.some(p=>(p.key?.name??p.key?.value)==='get'));
    if(helper||getter){for(const x of ['esbuild','rollup','rolldown'])candidates.add(x);evidence.push({kind:helper?'commonjs-helper-shape':'getter-export-helper-shape',span:(helper||getter).range,confidence:'compatible-mechanism-only'})}
   }
   const inferred=[...candidates].sort();
   return {id:u.id,candidates:inferred,status:inferred.length===1?'identified':inferred.length?'ambiguous':'unknown',evidence,diagnostics:r.diagnostics};
  }catch(e){return {id:u.id,candidates:[],status:'unknown',evidence:[],diagnostics:[{kind:'parse-or-recognition-error',error:e.message}]}}
 });
 const candidates=[...new Set(units.flatMap(u=>u.candidates))].sort();
 return {schema:'recall.bundler/v1',inputDigest:inventory.inputDigest,status:hint?'user-specified':candidates.length===1?'identified':candidates.length?'ambiguous':'unknown',family:hint||(candidates.length===1?candidates[0]:null),candidates,hint,units,policy:'Code-only runtime evidence. Webpack-compatible runtimes and native ESM forms may be indistinguishable. A user hint is recorded as supplied metadata, never presented as code-inferred certainty.'};
}
