import {constant} from '../recognition-context.mjs';
const isFn=n=>/^(FunctionExpression|FunctionDeclaration|ArrowFunctionExpression)$/.test(n?.type);
const prop=n=>n?.computed?constant(n.property):n?.property?.name;
const field=n=>n?.computed?constant(n.key):n?.key?.name??constant(n.key);
const children=n=>Object.entries(n).flatMap(([k,v])=>['loc','range'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
// Shared esbuild/Rollup/Rolldown CJS, ESM and export-helper mechanisms.
export function applyHelperSummaries({nodes,bind,owner,fnToken,expr,spec}){
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

}
