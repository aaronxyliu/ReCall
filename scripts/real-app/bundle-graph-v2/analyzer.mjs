// Code-only, allocation-site, flow-insensitive relationship analysis. No oracle imports.
import path from 'node:path';
import {parseModule} from '../bundling-dataset/parse.mjs';
import * as eslintScope from 'eslint-scope';
import {recognize,constant} from './recognize.mjs';
const isFn=n=>/^(FunctionExpression|FunctionDeclaration|ArrowFunctionExpression)$/.test(n?.type);
const literal=constant;
const prop=n=>n?.computed?literal(n.property):n?.property?.name;
const field=n=>n?.computed?literal(n.key):n?.key?.name??literal(n.key);
const children=n=>Object.entries(n).flatMap(([k,v])=>['loc','range'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
export class Analyzer {
 constructor({valueLimit=64,eventLimit=50000000}={}){
  this.limit=valueLimit;this.eventLimit=eventLimit;this.values=[];this.watch=[];this.rules=[];this.queue=[];this.queued=new Set();this.objects=new Map();this.objectWatch=new Map();this.tokens=new Map();this.modules=new Map();this.units=[];this.unitById=new Map();this.paths=new Map();this.links=[];this.calls=[];this.refs=[];this.errors=[];this.diagnostics=[];this.stats={astNodes:0,modules:{webpack:0,rspack:0,turbopack:0,parcel:0,commonjs:0},helpers:{},events:0,overflowSlots:0};
 }
 slot(){let i=this.values.length;this.values.push(new Set());this.watch.push(new Set());return i}
 enqueue(i){if(!this.queued.has(i)){this.queued.add(i);this.queue.push(i)}}
 add(s,t){const v=this.values[s];if(v.has(t)||v.has('TOP'))return;if(v.size>=this.limit){v.clear();v.add('TOP');this.stats.overflowSlots++}else v.add(t);for(const i of this.watch[s])this.enqueue(i)}
 seed(s,t){this.add(s,t);return s}
 constant(t){return this.seed(this.slot(),t)}
 rule(r,inputs=[]){const i=this.rules.length;this.rules.push(r);for(const s of inputs)if(s!=null)this.watch[s].add(i);this.enqueue(i);return i}
 copy(a,b){if(a!==b)this.rule({op:'copy',a,b},[a])}
 object(t){if(!this.objects.has(t))this.objects.set(t,new Map());return t}
 property(t,k){const ps=this.objects.get(this.object(t));if(!ps.has(k)){ps.set(k,this.slot());for(const i of this.objectWatch.get(t)||[])this.enqueue(i)}return ps.get(k)}
 read(a,k,b){this.rule({op:'read',a,k,b},[a])}
 write(a,k,b){this.rule({op:'write',a,k,b},[a,b])}
 namespace(id){return this.constant(this.object('ns:'+id))}
 register(kind,namespace,id,f){const k=kind+':'+namespace+':'+id;let ms=this.modules.get(k);if(!ms)this.modules.set(k,ms=[]);ms.push(f);this.stats.modules[kind]++;return k}
 resolvePath(u,request){if(!request?.startsWith('.'))return null;const p=path.posix.normalize(path.posix.join(path.posix.dirname(u.path),request));for(const x of [p,p+'.js',p+'.mjs',p+'.cjs',p+'/index.js'])if(this.paths.has(u.environment+'|'+x))return this.paths.get(u.environment+'|'+x);return null}
 addUnit(spec){
  const u={id:spec.id,path:path.posix.normalize(spec.path),environment:spec.environment||'main',runtimeGroup:spec.runtimeGroup,exports:this.object('ns:'+spec.id),cjs:this.object('cm:'+spec.id),unresolved:[],functions:0};this.units.push(u);this.unitById.set(u.id,u);this.paths.set(u.environment+'|'+u.path,u);for(const p of spec.aliasPaths||[])this.paths.set(u.environment+'|'+path.posix.normalize(p),u);
  const initial=this.object('ce:'+u.id);this.seed(this.property(u.cjs,'exports'),initial);
  let ast;try{ast=parseModule(spec.code,{next:true,ranges:true,loc:false})}catch(e){this.errors.push({unit:u.id,error:e.message});return}
  const bind=new WeakMap(),declared=new WeakMap(),owner=new WeakMap(),parent=new WeakMap(),receivers=new WeakMap(),fnToken=new WeakMap(),classToken=new WeakMap(),cache=new WeakMap(),nodes=[],inv=new Map((spec.functions||[]).map(f=>[f.span.join(':'),f]));
  const scopes=eslintScope.analyze(ast,{ecmaVersion:2022,sourceType:'module',optimistic:true,ignoreEval:true});
  for(const sc of scopes.scopes)for(const v of sc.variables){const s=this.slot();for(const n of v.identifiers){bind.set(n,s);let ds=declared.get(n);if(!ds)declared.set(n,ds=[]);ds.push(s)}for(const r of v.references)bind.set(r.identifier,s)}
  const stack=[{n:ast,o:null,r:null,c:null,p:null}];
  while(stack.length){let {n,o,r,c,p}=stack.pop();if(p)parent.set(n,p);if(n.type==='ClassDeclaration'||n.type==='ClassExpression'){c='c:'+u.id+':'+n.range[0];classToken.set(n,c);this.object(c);this.object('i:'+c);this.tokens.set(c,{type:'class',instance:'i:'+c});r='i:'+c}
   if(isFn(n)){const t='f:'+u.id+':'+n.range[0];fnToken.set(n,t);if(n.type!=='ArrowFunctionExpression')r=p?.type==='MethodDefinition'?(p.static?c:'i:'+c):'i:'+t;this.object('i:'+t);this.object(t);const f={type:'function',unit:u.id,inventory:spec.functions?inv.get(n.range.join(':'))?.id:u.id+':'+n.range.join(':'),span:n.range,params:n.params.map(x=>bind.get(x)??this.slot()),ret:this.slot(),summary:null,flow:null};this.tokens.set(t,f);o=t;u.functions++}
   owner.set(n,o);receivers.set(n,r);nodes.push(n);for(const x of children(n).reverse())stack.push({n:x,o,r,c,p:n});
  }
  this.stats.astNodes+=nodes.length;
  const declare=(n,s)=>{for(const d of declared.get(n)||[])this.copy(s,d)};
  const expr=n=>{
   if(!n)return this.slot();if(cache.has(n))return cache.get(n);let s=this.slot();cache.set(n,s);
   if(n.type==='Identifier'){if(bind.has(n))s=bind.get(n);else if(n.name==='module')s=this.constant(u.cjs);else if(n.name==='exports')s=this.constant(initial);else if(['Object','Reflect'].includes(n.name))s=this.constant('builtin:'+n.name);else if(n.name==='require')s=this.constant('sourceRequire:'+u.id);cache.set(n,s);return s}
   if(fnToken.has(n)){this.seed(s,fnToken.get(n));return s}if(classToken.has(n)){this.seed(s,classToken.get(n));return s}
   if(n.type==='ThisExpression'){if(receivers.get(n))this.seed(s,receivers.get(n));return s}
   if(n.type==='Super'){const t=receivers.get(n);if(t)this.read(this.constant(t),'$base',s);return s}
   if(n.type==='MemberExpression'){const k=prop(n);if(k!=null)this.read(expr(n.object),k,s);return s}
   if(n.type==='ObjectExpression'||n.type==='ArrayExpression'){
    const t=this.object('o:'+u.id+':'+n.range[0]);this.seed(s,t);
    if(n.type==='ObjectExpression'){for(const p of n.properties){if(p.type==='SpreadElement')this.rule({op:'spread',a:expr(p.argument),b:s},[expr(p.argument),s]);else if(field(p)!=null&&p.kind!=='set'){const v=expr(p.value);if(p.kind==='get')this.rule({op:'getter',a:v,b:this.property(t,field(p))},[v]);else this.copy(v,this.property(t,field(p)))}}}
    else n.elements.forEach((x,i)=>{if(x)this.copy(expr(x),this.property(t,String(i)))});return s
   }
   if(n.type==='NewExpression'){this.rule({op:'new',a:expr(n.callee),b:s},[expr(n.callee)]);return s}
   if(n.type==='CallExpression'){
    const a=expr(n.callee),args=n.arguments.map(expr),c={op:'call',a,args,b:s,literals:n.arguments.map(literal),array:n.arguments[0]?.type==='ArrayExpression'?n.arguments[0].elements.map(x=>({literal:literal(x),slot:expr(x)})):null,unit:u.id,owner:owner.get(n),span:n.range,immediate:isFn(n.callee),member:n.callee.type==='MemberExpression'?{object:expr(n.callee.object),key:prop(n.callee)}:null};
    this.rule(c,[a,...args,...(c.member?[c.member.object]:[])]);this.calls.push(c);return s
   }
   if(n.type==='ImportExpression'){const request=literal(n.source);if(request!=null)this.links.push({u,request,kind:'dynamic',slot:s});else u.unresolved.push({kind:'nonconstant-dynamic-import',request:null,span:n.range});return s}
   if(n.type==='SequenceExpression'){this.copy(expr(n.expressions.at(-1)),s);return s}
   if(n.type==='AssignmentExpression'){this.copy(expr(n.right),s);return s}
   if(n.type==='ConditionalExpression'){this.copy(expr(n.consequent),s);this.copy(expr(n.alternate),s);return s}
   if(n.type==='LogicalExpression'){this.copy(expr(n.left),s);this.copy(expr(n.right),s);return s}
   if(n.type==='ChainExpression'||n.type==='AwaitExpression')this.copy(expr(n.expression||n.argument),s);
   return s;
  };
  const assign=(n,v)=>{if(n?.type==='Identifier')this.copy(v,expr(n));else if(n?.type==='MemberExpression'&&prop(n)!=null)this.write(expr(n.object),prop(n),v);else if(n?.type==='ObjectPattern'){for(const p of n.properties)if(p.type==='Property'&&field(p)!=null){const q=this.slot();this.read(v,field(p),q);assign(p.value,q)}}else if(n?.type==='AssignmentPattern')assign(n.left,v)};
  // Structural helper summaries: use parameter roles and AST operations, never minified names.
  for(const n of nodes)if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'){const f=this.tokens.get(owner.get(n));if(f&&bind.get(n.callee.object)===f.params[0]&&['s','v','n'].includes(prop(n.callee)))f.contextExports=true}
  for(const n of nodes)if(isFn(n)){
   const f=this.tokens.get(fnToken.get(n));const p0=n.params[0]?.name;
   if(n.params.length<=4){let nestedReturn=isFn(n.body),invokeParam=false,exports=false,define=false,get=false,defaultRead=false,toDefault=false,forIn=false,commonjsInvocation=false;
    const todo=[n.body];let helperNodes=0;while(todo.length&&helperNodes++<512){const q=todo.pop();if(q.type==='ForInStatement')forIn=true;if(q.type==='ReturnStatement'&&isFn(q.argument)||q.type==='ArrowFunctionExpression'&&isFn(q.body))nestedReturn=true;
     if(q.type==='CallExpression'){const callee=q.callee.type==='SequenceExpression'?q.callee.expressions.at(-1):q.callee;if(n.params[0]?.type==='Identifier'&&bind.get(n.params[0])!=null&&(callee.type==='Identifier'&&bind.get(callee)===bind.get(n.params[0])||callee.type==='MemberExpression'&&callee.object.type==='Identifier'&&bind.get(callee.object)===bind.get(n.params[0]))){invokeParam=true;const x=q.arguments[0],y=q.arguments[1],alloc=x?.type==='MemberExpression'&&prop(x)==='exports'?x.object:null;if(alloc?.type==='AssignmentExpression'&&alloc.right.type==='ObjectExpression'&&alloc.right.properties.some(p=>field(p)==='exports'&&p.value.type==='ObjectExpression')&&y?.type==='Identifier'&&bind.get(y)===bind.get(alloc.left))commonjsInvocation=true}}
     if(q.type==='MemberExpression'){if(prop(q)==='exports')exports=true;if(prop(q)==='defineProperty')define=true;if(prop(q)==='__esModule')defaultRead=true}
     if(q.type==='Property'&&field(q)==='get')get=true;if(q.type==='Property'&&field(q)==='default')toDefault=true;
     todo.push(...children(q))}
    if(todo.length){this.stats.helperBudgetSkips=(this.stats.helperBudgetSkips||0)+1;continue}
    if(nestedReturn&&invokeParam)f.summary=exports&&commonjsInvocation?'commonjs-helper':!exports?'esm-helper':null;
    else if(define&&get&&n.params.length===4)f.summary='export-one';
    else if(get&&forIn&&n.params.length<=2&&n.params.length>0){
     const bodyNodes=[n.body],returns=new Set(),fresh=new Set(),shapes=[];
     while(bodyNodes.length){const q=bodyNodes.pop();if(q.type==='ReturnStatement'&&q.argument?.type==='Identifier'&&owner.get(q)===fnToken.get(n))returns.add(bind.get(q.argument));if(q.type==='VariableDeclarator'&&q.init?.type==='ObjectExpression'&&!q.init.properties.length)fresh.add(bind.get(q.id));
      if(q.type==='CallExpression'&&q.arguments[2]?.type==='ObjectExpression'){const g=q.arguments[2].properties.find(p=>field(p)==='get')?.value;if(g?.type==='MemberExpression'&&q.arguments[0]?.type==='Identifier'){const mi=n.params.findIndex(p=>bind.get(p)===bind.get(g.object)),di=n.params.findIndex(p=>bind.get(p)===bind.get(q.arguments[0]));if(mi>=0)shapes.push({mapIndex:mi,destIndex:di,destSlot:bind.get(q.arguments[0]),guard:expr(q.callee)})}}
      bodyNodes.push(...children(q));if(bodyNodes.length>1000)break;
     }
     const sh=shapes.find(s=>s.destIndex>=0&&s.destIndex!==s.mapIndex||fresh.has(s.destSlot)&&returns.has(s.destSlot));if(sh){f.summary='export-map';f.exportMap=sh}
    }
    else if(defaultRead&&n.params.length===1)f.summary='interop-default';
    // __toESM has Object.create/getPrototypeOf and a default descriptor. AST metadata below also checks the default literal.
    if(n.params.length>=2&&defaultRead&&(toDefault||spec.code.slice(...n.range).includes('`default`')||spec.code.slice(...n.range).includes('"default"')))f.summary='to-esm';
    if(f.summary)this.stats.helpers[f.summary]=(this.stats.helpers[f.summary]||0)+1;
   }
  }
  for(const n of nodes)if(isFn(n)){
   const f=this.tokens.get(fnToken.get(n)),body=n.body.type==='BlockStatement'?n.body.body:null;
   const ret=body?.length===1&&body[0].type==='ReturnStatement'?body[0].argument:!body?n.body:null;
   if(!ret)continue;let base=ret;const fields=[];while(base?.type==='MemberExpression'&&prop(base)!=null){fields.unshift(prop(base));base=base.object}
   const index=n.params.findIndex(p=>p.type==='Identifier'&&base?.type==='Identifier'&&bind.get(p)===bind.get(base));
   if(index>=0)f.flow={kind:'parameter',index,fields};else if(ret.type==='Identifier'||isFn(ret)||classToken.has(ret))f.flow={kind:'value',slot:expr(ret)};
  }
  const factory=(n,kind,namespace,id)=>{
   if(!fnToken.has(n))return;const f=this.tokens.get(fnToken.get(n)),mt=this.object('module:'+kind+':'+namespace+':'+id+':'+u.id),et=this.object('exports:'+mt),out=this.property(mt,'exports');this.seed(out,et);this.register(kind,namespace,id,{out,unit:u.id,factory:fnToken.get(n),esm:!!f.contextExports});
   const seed=(i,t)=>{if(f.params[i]!=null)this.seed(f.params[i],t)};
   if(kind==='rspack'||kind==='webpack'){seed(0,mt);seed(1,et);seed(2,'require:'+kind+':'+namespace)}
   if(kind==='parcel'){seed(0,mt);seed(1,et)}
   if(kind==='turbopack'){seed(0,'context:'+namespace+':'+id+':'+u.id);seed(1,mt);seed(2,et);this.tokens.set('context:'+namespace+':'+id+':'+u.id,{type:'context',namespace,id,out,module:mt,unit:u.id})}
  };
  const astOwner=new WeakMap(),fnNodes=new Map(nodes.filter(isFn).map(n=>[fnToken.get(n),n]));for(const n of nodes)astOwner.set(n,fnNodes.get(owner.get(n)));
  const recognition=recognize({nodes,bind,parent,owner:astOwner,unit:u,code:spec.code});this.diagnostics.push(...recognition.diagnostics);
  const recognized=new Set();for(const r of recognition.registrations){const k=r.kind+'|'+r.namespace+'|'+r.id+'|'+r.node.range.join(':');if(recognized.has(k))continue;recognized.add(k);factory(r.node,r.kind,r.namespace,r.id)}
  for(const l of recognition.loaders)this.seed(expr(l.requireNode),'require:webpack:'+l.namespace);
  for(const l of recognition.parcelLoaders)this.seed(expr(l.node),'require:parcel:'+l.namespace);

  for(const n of nodes){
   if(isFn(n)){const s=expr(n);if(n.id)declare(n.id,s);if(n.type==='ArrowFunctionExpression'&&n.body.type!=='BlockStatement')this.copy(expr(n.body),this.tokens.get(fnToken.get(n)).ret)}
   if(classToken.has(n)){const t=classToken.get(n),s=expr(n);if(n.id)declare(n.id,s);if(n.superClass){const b=expr(n.superClass);this.rule({op:'inherit',a:b,t},[b])}for(const m of n.body.body){const k=field(m);if(k!=null&&m.value){const v=expr(m.value);this.copy(v,this.property(m.static?t:'i:'+t,k))}}}
   if(n.type==='VariableDeclarator'&&n.init)assign(n.id,expr(n.init));
   if(n.type==='AssignmentExpression'&&['=','||=','??='].includes(n.operator))assign(n.left,expr(n.right));
   if(n.type==='ReturnStatement'&&owner.get(n))this.copy(expr(n.argument),this.tokens.get(owner.get(n)).ret);
   if(n.type==='CallExpression'||n.type==='NewExpression')expr(n);
   if(n.type==='ImportDeclaration')for(const p of n.specifiers)this.links.push({u,request:n.source.value,kind:'import',key:p.type==='ImportNamespaceSpecifier'?null:p.type==='ImportDefaultSpecifier'?'default':p.imported.name??literal(p.imported),slot:expr(p.local)});
   if(n.type==='ExportDefaultDeclaration')this.copy(expr(n.declaration),this.property(u.exports,'default'));
   if(n.type==='ExportNamedDeclaration'){
    if(n.declaration){const ns=n.declaration.type==='VariableDeclaration'?n.declaration.declarations.map(x=>x.id):[n.declaration.id];for(const x of ns)if(x?.type==='Identifier')this.copy(expr(x),this.property(u.exports,x.name))}
    for(const p of n.specifiers){const out=this.property(u.exports,p.exported.name??literal(p.exported));if(n.source)this.links.push({u,request:n.source.value,kind:'import',key:p.local.name??literal(p.local),slot:out});else this.copy(expr(p.local),out)}
   }
   if(n.type==='ExportAllDeclaration')this.links.push({u,request:n.source.value,kind:'star',slot:this.constant(u.exports)});
   if(n.type==='Identifier'&&owner.get(n)){const p=parent.get(n);if(p&&!(p.type==='MemberExpression'&&!p.computed&&p.property===n)&&!(p.type==='Property'&&!p.computed&&p.key===n&&!p.shorthand)&&!p.type.startsWith('Import')&&p.type!=='ExportSpecifier'&&!(p.type==='VariableDeclarator'&&p.id===n)&&!((isFn(p)||p.type.startsWith('Class'))&&p.id===n))this.refs.push({owner:owner.get(n),slot:expr(n),unit:u.id,span:n.range})}
  }
 }
 getter(a,b){this.rule({op:'getter',a,b},[a])}
 copyObject(a,b){this.rule({op:'spread',a,b},[a,b])}
 moduleRead(kind,namespace,id,b,ruleIndex){const xs=this.modules.get(kind+':'+namespace+':'+id);if(!xs)return false;for(const x of xs){this.watch[x.out].add(ruleIndex);for(const v of this.values[x.out])this.add(b,v)}return true}
 solve(){
  for(const l of this.links){const target=this.resolvePath(l.u,l.request);if(!target){l.u.unresolved.push({kind:'esm',request:l.request});continue}if(l.kind==='star')this.copyObject(this.constant(target.exports),l.slot);else if(l.kind==='dynamic'||l.key==null)this.seed(l.slot,target.exports);else this.copy(this.property(target.exports,l.key),l.slot)}
  // Built-ins may be assigned to minified variables, then called through aliases.
  this.seed(this.property('builtin:Object','defineProperty'),'builtin:defineProperty');
  this.seed(this.property('builtin:Object','assign'),'builtin:assign');
  for(let q=0;q<this.queue.length;q++){
   const i=this.queue[q];this.queued.delete(i);const r=this.rules[i];if(++this.stats.events>this.eventLimit)throw Error('Static analysis event budget exhausted; no partial result is reported');
   const vals=s=>this.values[s]||new Set(),copy=(a,b)=>{this.watch[a].add(i);for(const t of vals(a))this.add(b,t)},read=(t,k,b)=>copy(this.property(t,k),b);
   if(r.op==='copy')copy(r.a,r.b);
   else if(r.op==='read')for(const t of vals(r.a)){
    if(t==='TOP'){this.add(r.b,'TOP');continue}
    if(t.startsWith('require:'))this.add(r.b,'runtimeMethod:'+r.k+':'+t.slice(8));
    else if(t.startsWith('context:')){const ctx=this.tokens.get(t);if(r.k==='e'){for(const v of vals(ctx.out))this.add(r.b,v);this.watch[ctx.out].add(i)}else if(r.k==='m')this.add(r.b,ctx.module);else this.add(r.b,'contextMethod:'+r.k+':'+t)}
    else if(t==='builtin:Object'&&r.k==='defineProperty')this.add(r.b,'builtin:defineProperty');
    else{if(t.startsWith('builtin:')&&!['builtin:defineProperty','builtin:assign'].includes(t)){if(r.k==='prototype'){this.add(r.b,'builtin:Object.prototype')}else if(!(t==='builtin:Object'&&['defineProperty','assign'].includes(r.k)))this.add(r.b,'nativeCallable:'+t+':'+r.k)}read(t,r.k,r.b)};
   }
   else if(r.op==='write'){for(const t of vals(r.a))if(t!=='TOP')copy(r.b,this.property(t,r.k))}
   else if(r.op==='getter')for(const t of vals(r.a)){const f=this.tokens.get(t);if(f?.ret!=null)copy(f.ret,r.b);else if(t==='TOP')this.add(r.b,'TOP')}
   else if(r.op==='spread')for(const a of vals(r.a))for(const b of vals(r.b)){if(a==='TOP'||b==='TOP')continue;let w=this.objectWatch.get(a);if(!w)this.objectWatch.set(a,w=new Set());w.add(i);for(const [k,s]of this.objects.get(a)||[])if(k!=='__esModule')copy(s,this.property(b,k))}
   else if(r.op==='new'){for(const t of vals(r.a))if(this.tokens.has(t))this.add(r.b,'i:'+t)}
   else if(r.op==='inherit')for(const t of vals(r.a)){this.seed(this.property('i:'+r.t,'$base'),'i:'+t);this.copyObject(this.constant('i:'+t),this.constant('i:'+r.t));this.copyObject(this.constant(t),this.constant(r.t))}
   else if(r.op==='call'){
    for(const t of vals(r.a)){
     if(t==='TOP'){this.add(r.b,'TOP');continue}
     const f=this.tokens.get(t),arg=(j)=>r.args[j];
     if(t.startsWith('require:')){const [kind,...ns]=t.slice(8).split(':');if(r.literals[0]!=null)this.moduleRead(kind,ns.join(':'),r.literals[0],r.b,i)}
     else if(t.startsWith('sourceRequire:')){const u=this.unitById.get(r.unit),target=this.resolvePath(u,r.literals[0]);if(target)read(target.cjs,'exports',r.b)}
     else if(t.startsWith('thunk:'))copy(this.tokens.get(t).out,r.b);
     else if(t.startsWith('defaultGetter:'))copy(this.tokens.get(t).out,r.b);
     else if(t.startsWith('contextMethod:')){
      const m=t.slice(14),split=m.indexOf(':context:'),method=m.slice(0,split),ctx=this.tokens.get(m.slice(split+1));if(!ctx)continue;
      if(['r','i'].includes(method)&&r.literals[0]!=null){
       const mods=this.modules.get('turbopack:'+ctx.namespace+':'+r.literals[0])||[];
       if(method==='r')this.moduleRead('turbopack',ctx.namespace,r.literals[0],r.b,i);
       else for(const mod of mods){if(mod.esm)copy(mod.out,r.b);else{const ns=this.object('turbo-interop:'+mod.unit+':'+r.literals[0]);this.add(r.b,ns);this.ruleOnce(r,'interop:'+ns,()=>{this.copyObject(mod.out,this.constant(ns));this.copy(mod.out,this.property(ns,'default'))})}}
      }
      if(['v','n'].includes(method)&&arg(0)!=null){const id=r.literals[1]??ctx.id;for(const mod of this.modules.get('turbopack:'+ctx.namespace+':'+id)||[])if(mod.unit===r.unit)copy(arg(0),mod.out)}
      if(method==='s'&&r.array){const id=r.literals[1]??ctx.id,mods=this.modules.get('turbopack:'+ctx.namespace+':'+id)||[];for(const mod of mods){if(mod.unit!==r.unit)continue;for(const et of vals(mod.out)){const a=r.array;for(let j=0;j<a.length;){const k=a[j]?.literal;if(k==null)break;if(a[j+1]?.literal==='0'){if(a[j+2])copy(a[j+2].slot,this.property(et,k));j+=3}else{if(a[j+1]){this.watch[a[j+1].slot].add(i);for(const g of vals(a[j+1].slot)){const gf=this.tokens.get(g);if(gf?.ret!=null)copy(gf.ret,this.property(et,k))}}j+=2;if(a[j]&&a[j].literal==null)j++}}}}}
     }
     else if(t.startsWith('runtimeMethod:')){
      const [method,kind,...rest]=t.slice(14).split(':'),ns=rest.join(':');
      if(method==='d'&&r.literals[1]!=null&&arg(2)!=null){for(const target of vals(arg(0)))for(const g of vals(arg(2))){const gf=this.tokens.get(g);if(gf?.ret!=null)copy(gf.ret,this.property(target,r.literals[1]))}}
      if(method==='d'&&r.literals[1]==null&&arg(0)!=null&&arg(1)!=null)for(const obj of vals(arg(1))){let w=this.objectWatch.get(obj);if(!w)this.objectWatch.set(obj,w=new Set());w.add(i);for(const [k,s]of this.objects.get(obj)||[])for(const target of vals(arg(0))){this.watch[s].add(i);for(const g of vals(s)){const gf=this.tokens.get(g);if(gf?.ret!=null)copy(gf.ret,this.property(target,k))}}}
      if(method==='n'&&arg(0)!=null){const out=this.slot(),gt='defaultGetter:'+r.unit+':'+r.span[0];if(!this.tokens.has(gt)){this.tokens.set(gt,{out});this.rule({op:'default',a:arg(0),b:out},[arg(0)])}this.add(r.b,gt);copy(this.tokens.get(gt).out,this.property(gt,'a'))}
     }
     else if(t==='builtin:defineProperty'&&arg(0)!=null&&r.literals[1]!=null&&arg(2)!=null)for(const obj of vals(arg(2)))for(const target of vals(arg(0))){read(obj,'value',this.property(target,r.literals[1]));const gs=this.property(obj,'get');this.watch[gs].add(i);for(const g of vals(gs)){const gf=this.tokens.get(g);if(gf?.ret!=null)copy(gf.ret,this.property(target,r.literals[1]))}}
     else if(t==='builtin:assign'&&arg(0)!=null){copy(arg(0),r.b);for(const a of r.args.slice(1))this.ruleOnce(r,'assign:'+a,()=>this.copyObject(a,arg(0)))}
     else if(f?.summary==='commonjs-helper'&&arg(0)!=null){const tok='thunk:'+r.unit+':'+r.span[0];if(!this.tokens.has(tok)){const mt=this.object('cm:'+tok),et=this.object('ce:'+tok),out=this.property(mt,'exports');this.seed(out,et);this.tokens.set(tok,{out});this.rule({op:'factory',a:arg(0),mt,et},[arg(0)])}this.add(r.b,tok)}
     else if(f?.summary==='esm-helper'){} // Its lexical body is already analyzed; initialization membership adds no edge.
     else if(f?.summary==='export-one'&&arg(0)!=null&&r.literals[1]!=null&&arg(2)!=null)for(const target of vals(arg(0)))for(const g of vals(arg(2))){const gf=this.tokens.get(g);if(gf?.ret!=null)copy(gf.ret,this.property(target,r.literals[1]))}
     else if(f?.summary==='export-map'){
      const sh=f.exportMap,map=arg(sh.mapIndex);this.watch[sh.guard].add(i);if(map==null||!vals(sh.guard).has('builtin:defineProperty'))continue;
      if(sh.destIndex<0&&r.exportDest==null)r.exportDest=this.constant(this.object('em:'+r.unit+':'+r.span[0]));const dest=sh.destIndex>=0?arg(sh.destIndex):r.exportDest;if(dest==null)continue;this.watch[dest].add(i);
      if(sh.destIndex<0)for(const t of vals(dest))this.add(r.b,t);
      for(const obj of vals(map)){let w=this.objectWatch.get(obj);if(!w)this.objectWatch.set(obj,w=new Set());w.add(i);for(const [k,s]of this.objects.get(obj)||[]){this.watch[s].add(i);for(const g of vals(s)){const gf=this.tokens.get(g);if(gf?.ret!=null)for(const target of vals(dest))copy(gf.ret,this.property(target,k))}}}
     }
     else if(f?.summary==='interop-default'&&arg(0)!=null)this.ruleOnce(r,'default',()=>this.rule({op:'default',a:arg(0),b:r.b},[arg(0)]));
     else if(f?.summary==='to-esm'&&arg(0)!=null){const tok=this.object('interop:'+r.unit+':'+r.span[0]);this.add(r.b,tok);this.ruleOnce(r,'toesm',()=>{this.copyObject(arg(0),this.constant(tok));this.copy(arg(0),this.property(tok,'default'))})}
     else if(f?.flow&&!r.immediate){
      if(f.flow.kind==='value')copy(f.flow.slot,r.b);
      else if(arg(f.flow.index)!=null)this.ruleOnce(r,'flow:'+t,()=>{let v=arg(f.flow.index);for(const k of f.flow.fields){const next=this.slot();this.read(v,k,next);v=next}this.copy(v,r.b)})
     }
     else if(r.immediate&&f){r.args.forEach((s,j)=>{if(f.params[j]!=null)copy(s,f.params[j])});copy(f.ret,r.b)}
    }
   }
   else if(r.op==='factory')for(const t of vals(r.a)){const f=this.tokens.get(t);if(f){if(f.params[0]!=null)this.add(f.params[0],r.et);if(f.params[1]!=null)this.add(f.params[1],r.mt);if(f.params[2]!=null)this.add(f.params[2],r.et)}else{let w=this.objectWatch.get(t);if(!w)this.objectWatch.set(t,w=new Set());w.add(i);for(const s of this.objects.get(t)?.values()||[]){this.watch[s].add(i);for(const tok of vals(s)){const g=this.tokens.get(tok);if(g?.type==='function'){if(g.params[0]!=null)this.add(g.params[0],r.et);if(g.params[1]!=null)this.add(g.params[1],r.mt);if(g.params[2]!=null)this.add(g.params[2],r.et)}}}}}
   else if(r.op==='default')for(const t of vals(r.a)){const ps=this.objects.get(t);if(ps?.has('default'))read(t,'default',r.b);else this.add(r.b,t);let w=this.objectWatch.get(t);if(!w)this.objectWatch.set(t,w=new Set());w.add(i)}
  }
  const edges=[],seen=new Set(),singleton=s=>{const raw=this.values[s];if(raw.has('TOP')||[...raw].some(t=>t.startsWith('nativeCallable:')||t.startsWith('builtin:')))return null;const vs=[...raw].filter(t=>['function','class'].includes(this.tokens.get(t)?.type));if(vs.length!==1)return null;const t=vs[0],f=this.tokens.get(t);if(f?.type==='class'){const cs=this.values[this.property(f.instance,'constructor')];return cs.size===1?[...cs][0]:null}return f?.type==='function'?t:null};
  const edge=(a,b,kind,site)=>{if(!a||!b||a===b)return;const x=this.tokens.get(a),y=this.tokens.get(b);if(!x?.inventory||!y?.inventory)return;const k=[x.inventory,y.inventory,kind].join('|');if(seen.has(k))return;seen.add(k);edges.push({from:x.inventory,to:y.inventory,fromUnit:x.unit,toUnit:y.unit,kind,span:site.span})};
  let resolvedCalls=0,ambiguousCalls=0,unresolvedCalls=0;
  for(const c of this.calls){const t=singleton(c.a);if(t)resolvedCalls++;else if(this.values[c.a].size>1||this.values[c.a].has('TOP'))ambiguousCalls++;else unresolvedCalls++;edge(c.owner,t,'call',c);for(const a of c.args){const v=singleton(a);edge(c.owner,v,'argument-reference',c);edge(t,v,'callee-callback',c)}}
  for(const r of this.refs)edge(r.owner,singleton(r.slot),'binding-reference',r);
  return {policy:'Code-only singleton modeled targets. Scope-sensitive, flow-insensitive allocation sites; ESM/CJS plus structural runtime adapters. No module membership, oracle, models, dynamic execution, unbounded ordinary argument/return flow or dynamic property guessing. Partial analysis, not a sound JavaScript call graph.',edges,modules:[...this.modules].map(([key,instances])=>({key,instances:instances.map(m=>({unit:m.unit,factory:m.factory}))})),units:this.units.map(u=>({id:u.id,path:u.path,functions:u.functions,unresolved:u.unresolved})),errors:this.errors,diagnostics:this.diagnostics,coverage:{parseErrors:this.errors.length,unresolvedImports:this.units.reduce((n,u)=>n+u.unresolved.length,0),status:'partial-static-analysis; convergence is not completeness'},stats:{...this.stats,slots:this.values.length,rules:this.rules.length,resolvedCalls,ambiguousCalls,unresolvedCalls,rssBytes:process.memoryUsage().rss},converged:true};
 }
 ruleOnce(r,key,fn){if(!r.done)r.done=new Set();if(!r.done.has(key)){r.done.add(key);fn()}}
}
