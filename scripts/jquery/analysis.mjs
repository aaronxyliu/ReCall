import {enumerate,children,fnTypes,property,hash} from './measure.mjs';
const builtins=new Set(['Object','Array','String','Number','Boolean','Math','JSON','Promise','Symbol','Reflect','Date','Error','TypeError','undefined','NaN','Infinity','console','setTimeout','clearTimeout']);
export function analyze(code){
 const scan=enumerate(code),functions=scan.functions.slice().sort((a,b)=>a.node.range[0]-b.node.range[0]||b.node.range[1]-a.node.range[1]),index=new Map(functions.map((f,i)=>[f.node,i]));
 const scopes=new WeakMap(),calls=[],assignments=[],root={parent:null,kind:'program',bindings:new Map()};
 function names(n){if(!n)return[];if(n.type==='Identifier')return[n.name];if(n.type==='RestElement')return names(n.argument);if(n.type==='AssignmentPattern')return names(n.left);if(n.type==='ObjectPattern')return n.properties.flatMap(p=>names(p.value||p.argument));if(n.type==='ArrayPattern')return n.elements.flatMap(names);return[]}
 function bind(s,name,value){const bs=s.bindings.get(name)||[];bs.push({...value,scope:s,writes:0});s.bindings.set(name,bs)}
 function walk(n,s){scopes.set(n,s);if(n.type==='FunctionDeclaration'&&n.id)bind(s,n.id.name,{target:n});
  if(fnTypes.has(n.type)){const sub={parent:s,kind:'function',bindings:new Map(),fn:n};if(n.type==='FunctionExpression'&&n.id)bind(sub,n.id.name,{target:n});n.params.forEach((p,i)=>names(p).forEach(name=>bind(sub,name,{parameter:i})));for(const c of children(n))walk(c,sub);return}
  if(n.type==='BlockStatement'||n.type==='CatchClause'){const sub={parent:s,kind:'block',bindings:new Map()};if(n.type==='CatchClause')names(n.param).forEach(name=>bind(sub,name,{}));for(const c of children(n))walk(c,sub);return}
  if(n.type==='VariableDeclaration'){let where=s;if(n.kind==='var')while(where.parent&&where.kind!=='function')where=where.parent;for(const d of n.declarations)for(const name of names(d.id))bind(where,name,{init:d.init,declaration:d,target:fnTypes.has(d.init?.type)?d.init:null})}
  if(n.type==='CallExpression'||n.type==='NewExpression')calls.push(n);if(n.type==='AssignmentExpression'||n.type==='UpdateExpression')assignments.push(n);for(const c of children(n))walk(c,s);
 }
 walk(scan.ast,root);
 function lookup(n){if(n?.type!=='Identifier')return null;for(let s=scopes.get(n);s;s=s.parent){const bs=s.bindings.get(n.name);if(bs)return bs.length===1?bs[0]:{ambiguous:true}}return null}
 for(const a of assignments){const b=lookup(a.type==='AssignmentExpression'?a.left:a.argument);if(b&&!b.ambiguous)b.writes++}
 function resolve(n,seen=new Set()){if(!n)return null;if(n.type==='SequenceExpression')return resolve(n.expressions.at(-1),seen);if(fnTypes.has(n.type))return n;if(n.type!=='Identifier')return null;const b=lookup(n);if(!b||b.ambiguous||b.writes||b.parameter!=null||seen.has(b))return null;seen.add(b);return b.target||resolve(b.init,seen)}
 function owner(n){for(let p=n;p;p=scan.parents.get(p))if(fnTypes.has(p.type))return index.get(p);return null}
 const edges=[],unresolved=Array(functions.length).fill(0),callSites=Array.from({length:functions.length},()=>[]);
 function paramToken(n,rootFn){if(n?.type!=='Identifier')return null;const b=lookup(n);return b?.parameter!=null&&b.scope.fn===rootFn?'param'+b.parameter:null}
 function valueRole(n,rootFn,depth=0){if(!n)return'none';if(depth>3)return'expression';const p=paramToken(n,rootFn);if(p)return p;if(n.type==='ThisExpression')return'this';if(n.type==='Identifier')return resolve(n)?'function-ref':builtins.has(n.name)?'builtin:'+n.name:'binding';if(n.type==='Literal')return'literal:'+ (n.value===null?'null':typeof n.value);if(fnTypes.has(n.type))return'function-ref';if(n.type==='MemberExpression')return valueRole(n.object,rootFn,depth+1)+'.'+property(n);return n.type}
 for(const call of calls){const from=owner(call);if(from==null)continue;const body=functions[from].node.body;if(call.range[0]<body.range[0]||call.range[1]>body.range[1])continue;const to=index.get(resolve(call.callee));if(to!=null)edges.push({from,to,kind:'call',span:call.range});else unresolved[from]++;
  call.arguments.forEach((arg,i)=>{const target=index.get(resolve(arg));if(target!=null)edges.push({from,to:target,kind:'function-argument:'+i,span:call.range})});
  const f=functions[from].node;let callee=to!=null?'local-function':valueRole(call.callee,f);callSites[from].push(JSON.stringify([call.type,callee,call.arguments.map(a=>valueRole(a,f))]));
 }
 function norm(n,rootFn,top=false){if(!n)return null;if(fnTypes.has(n.type)&&!top)return['NestedFunction'];if(n.type==='Identifier')return[paramToken(n,rootFn)|| (builtins.has(n.name)?'builtin:'+n.name:'id')];if(n.type==='Literal')return['Literal',n.value===null?'null':typeof n.value,typeof n.value==='bigint'?String(n.value):n.value instanceof RegExp?String(n.value):n.value];
  if(n.type==='MemberExpression')return['Member',property(n),norm(n.object,rootFn),n.computed&&n.property.type!=='Literal'?norm(n.property,rootFn):null];
  if(n.type==='Property')return['Property',n.computed?'computed':property(n.key),norm(n.value,rootFn)];
  const type=fnTypes.has(n.type)?'Function':n.type;const out=[type];if(n.operator)out.push('operator:'+n.operator);if(n.type==='VariableDeclaration')out.push('declaration');
  for(const [key,v]of Object.entries(n)){if(['type','loc','range','raw','id','kind','operator'].includes(key))continue;if(v&&typeof v.type==='string')out.push([key,norm(v,rootFn)]);else if(Array.isArray(v)&&v.some(x=>x?.type))out.push([key,...v.filter(x=>x?.type).map(x=>norm(x,rootFn))]);}return out;
 }
 const salient=new Set(['MemberExpression','CallExpression','NewExpression','ReturnStatement','ThrowStatement','AssignmentExpression','UpdateExpression','ObjectExpression','AwaitExpression','YieldExpression']);
 function relevantDefinitions(rootFn){
  const needed=new Set(),pending=[];
  function reads(n){if(!n)return;if(fnTypes.has(n.type))return;if(n.type==='Identifier'){const p=scan.parents.get(n);if((p?.type==='MemberExpression'&&!p.computed&&p.property===n)||(p?.type==='Property'&&!p.computed&&p.key===n&&p.value!==n)||(p?.type==='VariableDeclarator'&&p.id===n))return;const b=lookup(n);if(b?.declaration&&!needed.has(b.declaration)){needed.add(b.declaration);pending.push(b.declaration)}}for(const c of children(n))reads(c)}
  function seed(n){if(!n||fnTypes.has(n.type))return;if(salient.has(n.type)){reads(n);return}for(const c of children(n))seed(c)}
  seed(rootFn.body);for(let i=0;i<pending.length;i++)reads(pending[i].init);return needed;
 }
 function slice(n,rootFn,needed){if(!n)return null;if(fnTypes.has(n.type))return null;if(salient.has(n.type)||(n.type==='VariableDeclarator'&&needed.has(n)))return norm(n,rootFn);const kept=children(n).map(c=>slice(c,rootFn,needed)).filter(Boolean);if(!kept.length)return null;return [n.type,...kept]}
 function count(n){return 1+children(n).reduce((a,c)=>a+(fnTypes.has(c.type)?1:count(c)),0)}
 function retainedCount(n,needed){if(!n||fnTypes.has(n.type))return 0;if(salient.has(n.type)||(n.type==='VariableDeclarator'&&needed.has(n)))return count(n);const kept=children(n).map(c=>retainedCount(c,needed)).filter(Boolean);return kept.length?1+kept.reduce((a,b)=>a+b,0):0}
 const features=functions.map((f,i)=>{const needed=relevantDefinitions(f.node),full=norm(f.node,f.node,true),compact=['Function',f.node.params.length,slice(f.node.body,f.node,needed)];return {full,compact,fullHash:hash(JSON.stringify(full)),compactHash:hash(JSON.stringify(compact)),fullFeatures:fragments(full),compactFeatures:fragments(compact),callFeatures:bag(callSites[i]),callHash:hash(JSON.stringify(callSites[i].slice().sort())),ownASTNodes:count(f.node.body),compactASTNodes:retainedCount(f.node.body,needed),callSites:callSites[i].length,unresolvedCalls:unresolved[i]}});
 return {...scan,functions,index,edges,features,lookup,resolve};
}
export function bag(a){const out={};for(const x of a)out[x]=(out[x]||0)+1;return out}
function arrayCount(a){return Array.isArray(a)?1+a.reduce((n,x)=>n+arrayCount(x),0):0}
export function fragments(tree){const out=[];function trim(a,depth){if(!Array.isArray(a))return a;return depth? a.map(x=>trim(x,depth-1)):[a[0]]}function walk(a){if(!Array.isArray(a))return;out.push(JSON.stringify(trim(a,2)));for(const x of a)walk(x)}walk(tree);return bag(out)}
export function dice(a,b){let overlap=0,na=0,nb=0;for(const [k,v]of Object.entries(a)){na+=v;overlap+=Math.min(v,b[k]||0)}for(const v of Object.values(b))nb+=v;return na+nb?2*overlap/(na+nb):null}
export function region(center,edges,radius=2){const out=new Set([center]);for(const reverse of [false,true]){let front=new Set([center]),seen=new Set([center]);for(let d=0;d<radius;d++){const next=new Set();for(const e of edges){const from=reverse?e.to:e.from,to=reverse?e.from:e.to;if(front.has(from)&&!seen.has(to)){next.add(to);seen.add(to);out.add(to)}}front=next}}
 return {nodes:[...out].sort((a,b)=>a-b),edges:edges.filter(e=>out.has(e.from)&&out.has(e.to))};}
