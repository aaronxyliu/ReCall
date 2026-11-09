import {constant} from '../recognition-context.mjs';
const isFn=n=>/^(FunctionExpression|FunctionDeclaration|ArrowFunctionExpression)$/.test(n?.type);
const prop=n=>n?.computed?constant(n.property):n?.property?.name;
const field=n=>n?.computed?constant(n.key):n?.key?.name??constant(n.key);
const children=n=>Object.entries(n).flatMap(([k,v])=>['loc','range'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
// Shared esbuild/Rollup/Rolldown CJS, ESM and export-helper mechanisms.
export function applyHelperSummaries({nodes,bind,owner,fnToken,expr,spec}){
  // Structural helper summaries: use parameter roles and AST operations, never minified names.
  const exportSlots=new Map();
  for(const n of nodes)if(isFn(n)&&n.params[0]?.type==='ObjectPattern')exportSlots.set(fnToken.get(n),new Set(n.params[0].properties.filter(p=>p.type==='Property'&&['s','v','n'].includes(field(p))&&p.value.type==='Identifier').map(p=>bind.get(p.value)).filter(s=>s!=null)));
  for(const n of nodes)if(n.type==='CallExpression'){const token=owner.get(n),f=this.tokens.get(token);if(f&&(n.callee.type==='MemberExpression'&&bind.get(n.callee.object)===f.params[0]&&['s','v','n'].includes(prop(n.callee))||n.callee.type==='Identifier'&&exportSlots.get(token)?.has(bind.get(n.callee))))f.contextExports=true}
  for(const n of nodes)if(isFn(n)){
   const f=this.tokens.get(fnToken.get(n));const p0=n.params[0]?.name;
   if(n.params.length<=4){let nestedReturn=isFn(n.body),invokeParam=false,exports=false,define=false,get=false,defaultRead=false,toDefault=false,forIn=false,commonjsInvocation=false,preloadMarker=false,preloadPromise=false;
    const todo=[n.body];let helperNodes=0,copyAll=null,keysSource=false;while(todo.length&&helperNodes++<512){const q=todo.pop();if(q.type==='ForInStatement')forIn=true;if(q.type==='ReturnStatement'&&isFn(q.argument)||q.type==='ArrowFunctionExpression'&&isFn(q.body))nestedReturn=true;
     if(n.params.length===2&&q.type==='CallExpression'&&q.callee.type==='MemberExpression'&&prop(q.callee)==='keys'&&q.callee.object.type==='Identifier'&&q.callee.object.name==='Object'&&bind.get(q.callee.object)==null&&q.arguments[0]?.type==='Identifier'&&bind.get(q.arguments[0])===bind.get(n.params[0]))keysSource=true;
     if(n.params.length===2&&q.type==='CallExpression'&&q.arguments[0]?.type==='Identifier'&&bind.get(q.arguments[0])===bind.get(n.params[1])&&q.arguments[2]?.type==='ObjectExpression'){
      const getter=q.arguments[2].properties.find(p=>field(p)==='get')?.value,returned=isFn(getter)?getter.body.type==='BlockStatement'&&getter.body.body.length===1&&getter.body.body[0].type==='ReturnStatement'?getter.body.body[0].argument:getter.body:null;
      if(returned?.type==='MemberExpression'&&returned.computed&&returned.object.type==='Identifier'&&bind.get(returned.object)===bind.get(n.params[0]))copyAll={sourceIndex:0,destIndex:1,guard:expr(q.callee)};
     }
     if(q.type==='CallExpression'){const callee=q.callee.type==='SequenceExpression'?q.callee.expressions.at(-1):q.callee;if(n.params[0]?.type==='Identifier'&&bind.get(n.params[0])!=null&&(callee.type==='Identifier'&&bind.get(callee)===bind.get(n.params[0])||callee.type==='MemberExpression'&&callee.object.type==='Identifier'&&bind.get(callee.object)===bind.get(n.params[0]))){invokeParam=true;const x=q.arguments[0],y=q.arguments[1],alloc=x?.type==='MemberExpression'&&prop(x)==='exports'?x.object:null;if(alloc?.type==='AssignmentExpression'&&alloc.right.type==='ObjectExpression'&&alloc.right.properties.some(p=>field(p)==='exports'&&p.value.type==='ObjectExpression')&&y?.type==='Identifier'&&bind.get(y)===bind.get(alloc.left))commonjsInvocation=true}}
     if(q.type==='Literal'&&q.value==='vite:preloadError')preloadMarker=true;
     if(q.type==='CallExpression'&&q.callee.type==='MemberExpression'&&['all','allSettled'].includes(prop(q.callee))&&q.callee.object.type==='Identifier'&&q.callee.object.name==='Promise'&&bind.get(q.callee.object)==null)preloadPromise=true;
     if(q.type==='MemberExpression'){if(prop(q)==='exports')exports=true;if(prop(q)==='defineProperty')define=true;if(prop(q)==='__esModule')defaultRead=true}
     if(q.type==='Property'&&field(q)==='get')get=true;if(q.type==='Property'&&field(q)==='default')toDefault=true;
     todo.push(...children(q))}
    if(todo.length){this.stats.helperBudgetSkips=(this.stats.helperBudgetSkips||0)+1;continue}
    if(nestedReturn&&invokeParam)f.summary=exports&&commonjsInvocation?'commonjs-helper':!exports?'esm-helper':null;
    else if(define&&get&&n.params.length>=3)f.summary='export-one';
    else if(get&&forIn&&n.params.length<=2&&n.params.length>0){
     const bodyNodes=[n.body],returns=new Set(),fresh=new Set(),shapes=[];
     while(bodyNodes.length){const q=bodyNodes.pop();if(q.type==='ReturnStatement'&&q.argument?.type==='Identifier'&&owner.get(q)===fnToken.get(n))returns.add(bind.get(q.argument));if(q.type==='VariableDeclarator'&&q.init?.type==='ObjectExpression'&&!q.init.properties.length)fresh.add(bind.get(q.id));
      if(q.type==='CallExpression'&&q.arguments[2]?.type==='ObjectExpression'){const g=q.arguments[2].properties.find(p=>field(p)==='get')?.value;if(g?.type==='MemberExpression'&&q.arguments[0]?.type==='Identifier'){const mi=n.params.findIndex(p=>bind.get(p)===bind.get(g.object)),di=n.params.findIndex(p=>bind.get(p)===bind.get(q.arguments[0]));if(mi>=0)shapes.push({mapIndex:mi,destIndex:di,destSlot:bind.get(q.arguments[0]),guard:expr(q.callee)})}}
      bodyNodes.push(...children(q));if(bodyNodes.length>1000)break;
     }
     const sh=shapes.find(s=>s.destIndex>=0&&s.destIndex!==s.mapIndex||fresh.has(s.destSlot)&&returns.has(s.destSlot));if(sh){f.summary='export-map';f.exportMap=sh}
    }
    else if(defaultRead&&n.params.length===1)f.summary=toDefault?'to-esm':'interop-default';
    // __toESM has Object.create/getPrototypeOf and a default descriptor. AST metadata below also checks the default literal.
    if(n.params.length>=2&&defaultRead&&(toDefault||spec.code.slice(...n.range).includes('`default`')||spec.code.slice(...n.range).includes('"default"')))f.summary='to-esm';
    if(invokeParam&&preloadMarker&&preloadPromise&&n.params.length>=2)f.summary='preload-import';
    if(copyAll&&keysSource){f.summary='export-all';f.exportAll=copyAll;}
    if(f.summary)this.stats.helpers[f.summary]=(this.stats.helpers[f.summary]||0)+1;
   }
  }

}

// Rollup-style cached CJS wrappers return an already allocated outer namespace.
// Only zero-argument functions whose own returns name the same captured value
// qualify; parameter-dependent/local return values retain ordinary semantics.
export function capturedNamespaceReturn(fn,{bind,owner,token}){
 if(fn.params.length||fn.body.type!=='BlockStatement')return null;
 const todo=[fn.body],returns=[],locals=new Set(),guards=new Set(),initializers=new Set();let count=0;
 while(todo.length&&count++<512){const n=todo.pop();if(isFn(n))continue;
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier')locals.add(bind.get(n.id));
  if(n.type==='IfStatement'&&n.test.type==='Identifier')guards.add(bind.get(n.test));
  if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='Identifier'&&n.right.type==='Literal'&&(n.right.value===1||n.right.value===true))initializers.add(bind.get(n.left));
  if(n.type==='ReturnStatement'&&owner.get(n)===token)returns.push(n.argument);
  todo.push(...children(n));
 }
 if(todo.length||!returns.length||![...guards].some(slot=>slot!=null&&!locals.has(slot)&&initializers.has(slot)))return null;
 const shape=n=>{while(n?.type==='SequenceExpression')n=n.expressions.at(-1);const expression=n,fields=[];while(n?.type==='MemberExpression'&&prop(n)!=null){fields.unshift(prop(n));n=n.object}if(n?.type!=='Identifier'||bind.get(n)==null||locals.has(bind.get(n)))return null;return {expression,key:JSON.stringify([bind.get(n),fields])}};
 const shapes=returns.map(shape);return shapes.every(s=>s&&s.key===shapes[0]?.key)?shapes[0].expression:null;
}
