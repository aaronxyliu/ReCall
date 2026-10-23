import path from 'node:path';
// Structural runtime adapters. Lexical AST identities replace app/global spelling.
const fn=n=>/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n?.type);
function staticValue(n){if(n?.type==='Literal'&&['string','number'].includes(typeof n.value))return n.value;if(n?.type==='TemplateLiteral'&&!n.expressions.length)return n.quasis[0].value.cooked;if(n?.type==='BinaryExpression'&&n.operator==='+'){const a=staticValue(n.left),b=staticValue(n.right);if(a!==undefined&&b!==undefined)return a+b}return undefined}
export const constant=n=>{const v=staticValue(n);return v===undefined?null:String(v)};
const key=n=>n?.computed?constant(n.property):n?.property?.name;
const field=n=>n?.computed?constant(n.key):n?.key?.name??constant(n.key);
export function recognize({nodes,bind,parent,owner,unit,code}){
 const initial=new Map(),functionSlot=new Map(),diagnostics=[],registrations=[],loaders=[];const put=(n,v)=>{const s=bind.get(n);if(s!=null){let xs=initial.get(s);if(!xs)initial.set(s,xs=[]);xs.push(v)}};
 for(const n of nodes){if(n.type==='VariableDeclarator'&&n.init)put(n.id,n.init);if(n.type==='AssignmentExpression'&&n.operator==='=')put(n.left,n.right);if(fn(n)&&n.id){put(n.id,n);functionSlot.set(n,bind.get(n.id))}if(fn(n)&&parent.get(n)?.type==='VariableDeclarator')functionSlot.set(n,bind.get(parent.get(n).id))}
 // Bind syntactically immediate bootstrap parameters to the corresponding table argument.
 for(const n of nodes)if(n.type==='CallExpression'){let f=n.callee,args=n.arguments;if(f.type==='UnaryExpression')f=f.argument;if(f.type==='MemberExpression'&&key(f)==='call'){f=f.object;args=args.slice(1)}if(fn(f))f.params.forEach((p,i)=>{if(args[i])put(p,args[i])})}
 // A bounded slot worklist resolves lexical aliases once per unit, including cycles.
 const aliasValues=new Map(),aliasUsers=new Map(),aliasQueue=[];let aliasOverflows=0;
 const addAlias=(slot,value)=>{let vs=aliasValues.get(slot);if(!vs)aliasValues.set(slot,vs=new Set());if(vs.has('TOP')||vs.has(value))return;if(vs.size>=64){vs.clear();vs.add('TOP');aliasOverflows++}else vs.add(value);aliasQueue.push([slot,value])};
 for(const [slot,xs]of initial)for(let x of xs){while(x?.type==='AssignmentExpression'||x?.type==='SequenceExpression')x=x.type==='AssignmentExpression'?x.right:x.expressions.at(-1);if(x?.type==='Identifier'){const src=bind.get(x);if(src!=null){if(!aliasUsers.has(src))aliasUsers.set(src,new Set());aliasUsers.get(src).add(slot)}}else if(x)addAlias(slot,x)}
 for(let q=0;q<aliasQueue.length;q++){if(q>5000000)throw Error('Runtime-recognition alias budget exceeded');const [slot]=aliasQueue[q];for(const dst of aliasUsers.get(slot)||[])for(const v of aliasValues.get(slot))addAlias(dst,v)}
 if(aliasOverflows)diagnostics.push({kind:'runtime-alias-overflow',unit:unit.id,slots:aliasOverflows});
 function resolve(n){while(n?.type==='AssignmentExpression'||n?.type==='SequenceExpression')n=n.type==='AssignmentExpression'?n.right:n.expressions.at(-1);if(n?.type==='Identifier'){const vs=aliasValues.get(bind.get(n));return !vs||vs.has('TOP')?[]:[...vs]}return n?[n]:[]}

 function uniqueFn(n){if(n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&key(n.callee)==='bind')n=n.callee.object;const xs=[...new Set(resolve(n).filter(fn))];return xs.length===1?xs[0]:null}
 // Global registry paths also need fixed-point resolution: recursive alias trees
 // can be exponential even when their source text is small.
 function pathSpec(n){const suffix=[];while(n){if(n.type==='AssignmentExpression'){n=n.left;continue}if(n.type==='LogicalExpression'){n=n.left;continue}if(n.type==='SequenceExpression'){n=n.expressions.at(-1);continue}if(n.type==='MemberExpression'&&key(n)!=null){suffix.unshift(key(n));n=n.object;continue}break}if(n?.type!=='Identifier')return null;const tail=suffix.length?'.'+suffix.join('.'):'';const slot=bind.get(n);if(slot==null)return ['self','window','globalThis','global'].includes(n.name)?{value:'global'+tail}:null;return {slot,suffix:tail}}
 const globalValues=new Map(),globalUsers=new Map(),globalQueue=[];
 function addGlobal(slot,value){const old=globalValues.get(slot);if(old==='AMBIGUOUS'||old===value)return;const next=old==null?value:'AMBIGUOUS';globalValues.set(slot,next);globalQueue.push(slot)}
 for(const [dst,xs]of initial)for(const x of xs){const p=pathSpec(x);if(!p)continue;if(p.value)addGlobal(dst,p.value);else{if(!globalUsers.has(p.slot))globalUsers.set(p.slot,[]);globalUsers.get(p.slot).push({dst,suffix:p.suffix})}}
 for(let q=0;q<globalQueue.length;q++){if(q>5000000)throw Error('Global registry path budget exceeded');const slot=globalQueue[q],v=globalValues.get(slot);for(const {dst,suffix}of globalUsers.get(slot)||[])addGlobal(dst,v==='AMBIGUOUS'||v.length+suffix.length>4096?'AMBIGUOUS':v+suffix)}
 function globalPath(n){const p=pathSpec(n);if(!p)return null;if(p.value)return p.value;const value=globalValues.get(p.slot);return value&&value!=='AMBIGUOUS'?value+p.suffix:null}

 function table(n,allowEmpty=false){const xs=resolve(n).filter(x=>['ObjectExpression','ArrayExpression'].includes(x.type));if(xs.length!==1)return null;const t=xs[0],rows=t.type==='ArrayExpression'?t.elements.map((value,i)=>({id:String(i),value})):t.properties.filter(p=>p.type==='Property').map(p=>({id:field(p),value:p.value}));const result=[];for(const r of rows){if(!r.value)continue;const f=uniqueFn(r.value);if(r.id==null||!f||f.params.length>3)return null;result.push({id:r.id,f})}return result.length||allowEmpty?result:null}
 function tableProof(rows){return rows.some(({f})=>{const ps=f.params.map(p=>bind.get(p));return nodesByOwner.get(f)?.some(n=>n.type==='CallExpression'&&n.callee.type==='Identifier'&&bind.get(n.callee)===ps[2]&&ps[2]!=null||n.type==='MemberExpression'&&n.object.type==='Identifier'&&(bind.get(n.object)===ps[1]&&ps[1]!=null||bind.get(n.object)===ps[0]&&key(n)==='exports'&&ps[0]!=null||bind.get(n.object)===ps[2]&&ps[2]!=null&&['d','r','n','t'].includes(key(n))))})}
 const nodesByOwner=new Map();for(const n of nodes){const o=owner.get(n);if(o){let xs=nodesByOwner.get(o);if(!xs)nodesByOwner.set(o,xs=[]);xs.push(n)}}
 const protocolNamespace=p=>'export-protocol:'+(unit.environment||'main')+':'+(unit.runtimeGroup||path.posix.dirname(unit.path))+':'+p;
 const registry=path=>'registry:'+(unit.environment||'main')+':'+path;
 function emit(rows,namespace,mechanism){for(const {id,f}of rows)registrations.push({kind:'webpack',namespace,id,node:f,mechanism})}
 function sameReference(a,b){if(a?.type!==b?.type)return false;if(a?.type==='Identifier'){const s=bind.get(a),t=bind.get(b);return s!=null?s===t:t==null&&a.name===b.name}if(a?.type==='MemberExpression')return sameReference(a.object,b.object)&&(a.computed&&b.computed?sameReference(a.property,b.property)||constant(a.property)!=null&&constant(a.property)===constant(b.property):key(a)===key(b));return constant(a)!=null&&constant(a)===constant(b)}
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
   // Turbopack registration protocols retain their runtime global, not local names.
   if(root==='global.TURBOPACK'){let ids=[];for(const x of a.elements.slice(1)){if(constant(x)!=null)ids.push(constant(x));else{const f=uniqueFn(x);if(f){for(const id of ids)registrations.push({kind:'turbopack',namespace:'TURBOPACK:'+(unit.environment||'main'),id,node:f,mechanism:'id-factory-sequence'})}ids=[]}}
   }
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
 // Parcel loader identity follows the actual bound global member, never a file-wide regex.
 const parcelRoots=new Map();for(const n of nodes)if(n.type==='MemberExpression'){const p=globalPath(n);if(p&&/\.parcelRequire[\w$]*$/.test(p))parcelRoots.set(p,registry(p))}
 const parcelLoaders=[];for(const n of nodes)if(n.type==='CallExpression'){
  const candidates=resolve(n.callee);let object=null;for(const x of candidates)if(x.type==='MemberExpression'&&key(x)==='register')object=x.object;
  if(!object&&n.callee.type==='MemberExpression'&&key(n.callee)==='register')object=n.callee.object;
  if(!object||constant(n.arguments[0])==null)continue;const root=globalPath(object),f=uniqueFn(n.arguments[1]);if(root&&parcelRoots.has(root)&&f){const namespace=parcelRoots.get(root);registrations.push({kind:'parcel',namespace,id:constant(n.arguments[0]),node:f,mechanism:'bound-register'});parcelLoaders.push({node:object,namespace})}
 }
 return{registrations,loaders,parcelLoaders,diagnostics};
}
