import {constant,key,field} from '../recognition-context.mjs';
export const webpackAdapter={id:'webpack-compatible',families:['webpack','rspack'],apply(context){
 const {nodes,bind,parent,owner,unit,code,diagnostics,registrations,loaders,resolve,uniqueFn,globalPath,table,tableProof,nodesByOwner,protocolNamespace,registry,emit,sameReference,parcelLoaders}=context;
 // Detect loader invocation by module/exports/require roles, including .call receiver.
 for(const n of nodes)if(n.type==='CallExpression'){
  let callee=n.callee,args=n.arguments;if(callee.type==='MemberExpression'&&key(callee)==='call'){callee=callee.object;args=args.slice(1)}
  if(callee.type!=='MemberExpression'||!callee.computed||args.length<3)continue;const [m,e,r]=args;if(!['Identifier','MemberExpression'].includes(m.type)||e.type!=='MemberExpression'||key(e)!=='exports'||!sameReference(m,e.object)||r.type!=='Identifier')continue;
  const loader=uniqueFn(r);if(!loader||loader.params.length!==1)continue;let enclosing=owner.get(n);if(enclosing!==loader)continue;const rows=table(callee.object,true);if(!rows)continue;const tableSlot=callee.object.type==='Identifier'?bind.get(callee.object):null;loaders.push({rows,loader,requireNode:r,tableSlot,mechanism:'bootstrap-loader'})
 }
 // Identify the registry that installs factories into each bootstrap's table.
 for(const l of loaders){const handlers=new Set();for(const n of nodes)if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&(bind.get(n.left.object)===l.tableSlot&&l.tableSlot!=null||n.left.object.type==='MemberExpression'&&key(n.left.object)==='m'&&bind.get(n.left.object.object)===bind.get(l.requireNode))&&n.left.computed)handlers.add(owner.get(n));const roots=new Set();
  for(const n of nodes)if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'){const f=uniqueFn(n.right);if(f&&handlers.has(f)){const root=key(n.left)==='push'?globalPath(n.left.object):globalPath(n.left);if(root)roots.add(root)}}
  const protocols=new Set();for(const h of handlers){const fields=new Set((nodesByOwner.get(h)||[]).map(n=>n.type==='MemberExpression'?key(n):n.type==='Property'?field(n):null));if(fields.has('__webpack_modules__'))protocols.add('esm');else if(fields.has('modules')&&fields.has('ids'))protocols.add('commonjs')}
  l.namespace=roots.size===1?registry([...roots][0]):protocols.size===1?protocolNamespace([...protocols][0]):'bootstrap:'+unit.id+':'+bind.get(l.requireNode);emit(l.rows,l.namespace,l.mechanism);if(roots.size>1)diagnostics.push({kind:'ambiguous-bootstrap-registry',unit:unit.id,roots:[...roots]})
 }
 for(const n of nodes)if(n.type==='CallExpression'){
  if(n.callee.type==='MemberExpression'&&key(n.callee)==='push'&&n.arguments[0]?.type==='ArrayExpression'){
   const a=n.arguments[0],root=globalPath(n.callee.object);if(!root)continue;const rows=table(a.elements[1]);if(a.elements[0]?.type==='ArrayExpression'&&rows&&tableProof(rows)){emit(rows,registry(root),'array-push');continue}
  }

  // Legacy webpackJsonp([chunk IDs], factory table, ...), independent of its name.
  if(n.arguments[0]?.type==='ArrayExpression'&&n.arguments.length>=2){const rows=table(n.arguments[1]);const root=globalPath(n.callee)||(n.callee.type==='Identifier'&&bind.get(n.callee)==null?'global.'+n.callee.name:null);if(rows&&root&&tableProof(rows))emit(rows,registry(root),'legacy-jsonp')}
 }
 // Exported webpack chunks expose a protocol module table, not a global push.
 const exportNames=new Set(nodes.filter(n=>n.type==='ExportNamedDeclaration').flatMap(n=>n.declaration?.declarations?.map(d=>d.id.name)||[]));
 for(const n of nodes){
  if(n.type==='ExportNamedDeclaration'&&exportNames.has('__webpack_ids__'))for(const d of n.declaration?.declarations||[])if(d.id.name==='__webpack_modules__'){const rows=table(d.init);if(rows)emit(rows,protocolNamespace('esm'),'esm-export-table')}
  if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&key(n.left)==='modules'&&n.left.object.type==='Identifier'&&n.left.object.name==='exports'&&bind.get(n.left.object)==null){const rows=table(n.right);if(rows&&tableProof(rows))emit(rows,protocolNamespace('commonjs'),'commonjs-export-table')}
 }

}};
