// Heuristic alpha-shape match, NOT a proof of semantic or source identity.
// External identifiers are consistently renamed without checking their bindings
// (requested experimental policy). Keep properties, literals and scopes intact.
import {parseFunctionSyntax} from './function-syntax.mjs';
import eslintScope from 'eslint-scope';
import {minifySourceFunction} from './minify.mjs';
const cache=new Map();
function canonical(code){
 if(cache.has(code))return cache.get(code);
 let result=null;
 try{
  const {ast,root,method}=parseFunctionSyntax(code);
  const scopes=eslintScope.analyze(ast,{ecmaVersion:2022,sourceType:'script',optimistic:false,ignoreEval:false});
  if(scopes.scopes.some(s=>s.type==='with'||s.directCallToEvalScope))throw Error('Dynamic scope');
  const bindings=new Map(),locals=new Map(),external=new Map();
  for(const scope of scopes.scopes){
   for(const variable of scope.variables)for(const id of variable.identifiers)bindings.set(id,variable);
   for(const ref of scope.references)if(ref.resolved)bindings.set(ref.identifier,ref.resolved);
  }
  const identifier=node=>{
   const variable=bindings.get(node);
   if(variable?.identifiers.includes(root.id))return 'root-self';
   const map=variable?locals:external,key=variable||node.name;
   if(!map.has(key))map.set(key,map.size);
   return (variable?'local:':'external:')+map.get(key);
  };
  function visit(node,parent=null,key=null){
   if(Array.isArray(node))return node.map(n=>visit(n,parent,key));
   if(!node||typeof node!=='object')return typeof node==='bigint'?String(node)+'n':node;
   if(node instanceof RegExp)return {regex:node.source,flags:node.flags};
   if(node.type==='Identifier'){
    const property=(parent?.type==='MemberExpression'&&key==='property'&&!parent.computed)||(['Property','MethodDefinition','PropertyDefinition'].includes(parent?.type)&&key==='key'&&!parent.computed);
    const label=key==='label';
    return {type:'Identifier',name:property||label?node.name:identifier(node)};
   }
   const out={};
   for(const k of Object.keys(node).sort()){
    if(['start','end','range','loc','raw'].includes(k))continue;
    if(node===root&&k==='id')continue;
    // Explicit and shorthand object properties have identical key/value meaning.
    if(k==='shorthand')continue;
    out[k]=visit(node[k],node,k);
   }
   return out;
  }
  result=JSON.stringify(method?{method:{kind:method.kind,static:method.static,computed:method.computed,key:visit(method.key,method,'key')},function:visit(root)}:visit(root));
 }catch{/* Unsupported syntax/scope is inconclusive; the model remains fallback. */}
 cache.set(code,result);return result;
}
export function astMatch(sourceCode,bundleCode,{minifiedSource=null}={}){
 try{
  const source=canonical(minifiedSource??minifySourceFunction(sourceCode));
  const bundle=canonical(minifySourceFunction(bundleCode));
  return source!==null&&bundle!==null&&source===bundle;
 }catch{return false;}
}
