// Component engine port; historical experiment implementation is retained unchanged.
import path from 'node:path';
// Structural runtime adapters. Lexical AST identities replace app/global spelling.
const fn=n=>/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n?.type);
function staticValue(n){if(n?.type==='Literal'&&['string','number'].includes(typeof n.value))return n.value;if(n?.type==='TemplateLiteral'&&!n.expressions.length)return n.quasis[0].value.cooked;if(n?.type==='BinaryExpression'&&n.operator==='+'){const a=staticValue(n.left),b=staticValue(n.right);if(a!==undefined&&b!==undefined)return a+b}return undefined}
export const constant=n=>{const v=staticValue(n);return v===undefined?null:String(v)};
export const key=n=>n?.computed?constant(n.property):n?.property?.name;
export const field=n=>n?.computed?constant(n.key):n?.key?.name??constant(n.key);
export function recognitionContext({nodes,bind,parent,owner,unit,code}){
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
 return {nodes,bind,parent,owner,unit,code,initial,functionSlot,diagnostics,registrations,loaders,resolve,uniqueFn,globalPath,table,tableProof,nodesByOwner,protocolNamespace,registry,emit,sameReference,parcelLoaders:[]};
}
