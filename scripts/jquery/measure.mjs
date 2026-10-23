import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {parseModule as parse} from 'meriyah';
const req=createRequire(import.meta.url);
const {extractPOG}=req('../../vendor/debun/fingerprint-collector/pog-generator.js');
const {generatePOGHash}=req('../../vendor/debun/fingerprint-collector/hash-function.js');
export const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export const fnTypes=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
export function children(n){return Object.entries(n).flatMap(([k,v])=>['loc','range'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x&&typeof x.type==='string'):v&&typeof v.type==='string'?[v]:[])}
export function enumerate(code){
 const ast=parse(code,{next:true,ranges:true,loc:true});const functions=[];const parents=new WeakMap();
 function walk(n){for(const c of children(n)){parents.set(c,n);walk(c)}if(fnTypes.has(n.type)){
  const p=parents.get(n);let name=n.id?.name;
  if(!name&&p?.type==='VariableDeclarator')name=p.id.name;
  if(!name&&p?.type==='AssignmentExpression')name=property(p.left);
  if(!name&&['Property','MethodDefinition'].includes(p?.type))name=property(p.key);
  let a=p;while(a&&!['ClassDeclaration','ClassExpression'].includes(a.type))a=parents.get(a);
  let depth=0;let q=p;while(q){if(fnTypes.has(q.type))depth++;q=parents.get(q)}functions.push({node:n,name:name||'<anonymous>',className:a?.id?.name||null,nestingDepth:depth});
 }}walk(ast);
 const bindings=new Map(functions.filter(f=>f.node.id?.name).map(f=>[f.node.id.name,f]));
 function aliases(n){if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&n.right.type==='Identifier'){
 const f=bindings.get(n.right.name);if(f){f.aliases||=[];f.aliases.push(property(n.left));}}
 if(n.type==='Property'&&n.value?.type==='Identifier'){const f=bindings.get(n.value.name);if(f){f.aliases||=[];f.aliases.push(property(n.key));}}
 if(n.type==='ExportSpecifier'){const f=bindings.get(n.local?.name);if(f){f.aliases||=[];f.aliases.push(n.exported?.name);}}
 for(const c of children(n))aliases(c)}aliases(ast);
 return {ast,functions,parents};
}
export function property(n){if(!n)return null;if(n.type==='Identifier')return n.name;if(n.type==='Literal')return String(n.value);if(n.type==='MemberExpression')return n.computed?n.property.type==='Literal'?String(n.property.value):'[]':n.property.name;return null}
export function own(n,visit,top=true,parent=null){if(!top&&fnTypes.has(n.type))return;visit(n,parent);for(const c of children(n))own(c,visit,false,n)}
function strip(n,top=true){if(!n||typeof n!=='object')return n;if(!top&&fnTypes.has(n.type))return n.type==='FunctionDeclaration'?{type:'EmptyStatement'}:{type:'FunctionExpression',id:null,params:[],body:{type:'BlockStatement',body:[]}};let out={};for(const [k,v]of Object.entries(n)){if(['loc','range','raw'].includes(k))continue;out[k]=Array.isArray(v)?v.map(c=>strip(c,false)):strip(v,false)}return out}
export function measure(n){
 let ops=[];own(n.body,(x,parent)=>{
  if(x.type==='MemberExpression')ops.push((parent?.type==='AssignmentExpression'&&parent.left===x?(parent.operator==='='?'write:':'readwrite:'):parent?.type==='UpdateExpression'?'readwrite:':'read:')+property(x));
  if(x.type==='ObjectExpression')for(const p of x.properties)if(p.type==='Property')ops.push('initialize:'+(p.computed&&p.key.type!=='Literal'?'[]':property(p.key)));
 });
 const out={propertyOperations:ops.length,distinctOperationPropertyPairs:new Set(ops).size};
 try{const g=extractPOG(strip(n.body)).nodes;const edges=[];let graphOps=[];for(const v of g.values()){
  graphOps.push(...(v.op||[]).map(o=>o.type+':'+o.value));for(const k of ['next','then','else'])if(v[k]!==undefined&&g.has(v[k]))edges.push([v.id,v[k]]);
 }return {...out,pogHash:generatePOGHash({graph:g,body:n}).hash,graphNodes:g.size,graphEdges:edges.length,graphOperationOccurrences:graphOps.length,distinctGraphOperationPropertyPairs:new Set(graphOps).size,extractionStatus:'ok'}}
 catch(e){return {...out,pogHash:null,extractionStatus:'failed',error:String(e)}}
}
