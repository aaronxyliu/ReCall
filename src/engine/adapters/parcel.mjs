import {constant,key,field} from '../recognition-context.mjs';
export const parcelAdapter={id:'parcel-register',families:['parcel'],apply(context){
 const {nodes,bind,parent,owner,unit,code,diagnostics,registrations,loaders,resolve,uniqueFn,globalPath,table,tableProof,nodesByOwner,protocolNamespace,registry,emit,sameReference,parcelLoaders}=context;
 // Parcel's table runtime invokes [factory, dependency-map] entries with
 // (localRequire, module, exports), unlike register()'s (module, exports).
 const memberName=n=>key(n)??(n?.computed&&resolve(n.property).length===1?constant(resolve(n.property)[0]):null);
 function globalRoot(n,seen=new Set()){
  if(!n||seen.has(n))return null;const root=globalPath(n);if(root)return root;seen=new Set(seen).add(n);
  if(n.type==='ObjectExpression'&&!n.properties.length)return 'empty-fallback';
  if(n.type==='ConditionalExpression'){const a=globalRoot(n.consequent,seen),b=globalRoot(n.alternate,seen);return a===b?a:a==='empty-fallback'?b:b==='empty-fallback'?a:null}
  const xs=resolve(n);return xs.length===1&&xs[0]!==n?globalRoot(xs[0],seen):null;
 }
 for(const call of nodes){
  if(call.type!=='CallExpression'||call.callee.type!=='MemberExpression'||key(call.callee)!=='call')continue;
  const entry=call.callee.object;if(entry?.type!=='MemberExpression'||key(entry)!=='0'||entry.object.type!=='MemberExpression')continue;
  const [receiver,localRequire,module,exports]=call.arguments;
  if(localRequire?.type!=='Identifier'||module?.type!=='Identifier'||receiver?.type!=='MemberExpression'||exports?.type!=='MemberExpression'||key(receiver)!=='exports'||key(exports)!=='exports'||!sameReference(receiver.object,module)||!sameReference(exports.object,module))continue;
  const loader=owner.get(call),tables=resolve(entry.object.object).filter(n=>n.type==='ObjectExpression');if(!loader||tables.length!==1)continue;
  const marker=nodes.some(n=>n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&key(n.left)==='isParcelRequire'&&uniqueFn(n.left.object)===loader&&(n.right.type==='Literal'&&n.right.value===true||n.right.type==='UnaryExpression'&&n.right.operator==='!'&&n.right.argument.type==='Literal'&&n.right.argument.value===0));if(!marker)continue;
  const rows=[];let valid=true;
  for(const p of tables[0].properties){
   const id=field(p),tuple=p.value,f=tuple?.type==='ArrayExpression'?uniqueFn(tuple.elements[0]):null,map=tuple?.elements?.[1];
   if(p.type!=='Property'||id==null||!f||map?.type!=='ObjectExpression'){valid=false;break}
   const dependencies={};for(const dependency of map.properties){const name=field(dependency),value=constant(dependency.value);if(dependency.type!=='Property'||name==null){valid=false;break}Object.defineProperty(dependencies,name,{value,enumerable:true});}
   if(!valid)break;rows.push({id,f,dependencies});
  }
  if(!valid||!rows.length)continue;
  const names=new Set();for(const n of nodes)if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&uniqueFn(n.right)===loader){const root=globalRoot(n.left.object),name=memberName(n.left);if(root&&root!=='empty-fallback'&&name&&/^parcelRequire[\w$]*$/.test(name))names.add(root+'.'+name)}
  if(names.size>1){diagnostics.push({kind:'ambiguous-parcel-table-registry',unit:unit.id,span:loader.range});continue}
  const namespace=names.size?registry([...names][0]):'parcel-bootstrap:'+unit.id+':'+loader.range[0];
  for(const row of rows)registrations.push({kind:'parcel',namespace,id:row.id,node:row.f,mechanism:'factory-dependency-table',parameterRoles:'require-module-exports',dependencies:row.dependencies});
  if(loader.id)parcelLoaders.push({node:loader.id,namespace});
 }
 // Parcel loader identity follows the actual bound global member, never a file-wide regex.
 const parcelRoots=new Map();for(const n of nodes)if(n.type==='MemberExpression'){const p=globalPath(n);if(p&&/\.parcelRequire[\w$]*$/.test(p))parcelRoots.set(p,registry(p))}
 for(const n of nodes)if(n.type==='CallExpression'){
  const candidates=resolve(n.callee);let object=null;for(const x of candidates)if(x.type==='MemberExpression'&&key(x)==='register')object=x.object;
  if(!object&&n.callee.type==='MemberExpression'&&key(n.callee)==='register')object=n.callee.object;
  if(!object||constant(n.arguments[0])==null)continue;const root=globalPath(object),f=uniqueFn(n.arguments[1]);if(root&&parcelRoots.has(root)&&f){const namespace=parcelRoots.get(root);registrations.push({kind:'parcel',namespace,id:constant(n.arguments[0]),node:f,mechanism:'bound-register'});parcelLoaders.push({node:object,namespace})}
 }

}};
