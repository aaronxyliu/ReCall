import {parse} from '@typescript-eslint/typescript-estree';
// Normalize an analysis view only. Never rewrite input bytes or function ranges.
const wrappers=new Set(['TSAsExpression','TSTypeAssertion','TSNonNullExpression','TSSatisfiesExpression','TSInstantiationExpression']);
const erased=new Set(['TSInterfaceDeclaration','TSTypeAliasDeclaration','TSDeclareFunction','TSAbstractMethodDefinition','TSIndexSignature']);
const metadata=new Set(['typeAnnotation','typeParameters','typeArguments','returnType','implements','superTypeArguments','superTypeParameters','accessibility','abstract','declare','definite','override','readonly']);
// Constant enums become an analysis-only sequence of object writes. Unlike a
// compiler IIFE this adds no synthetic function identities. Keep original bytes
// and ranges, and retain enum bindings (including const enums) without assuming
// the downstream compiler's const-enum inlining policy.
function enumDeclaration(n){
 const at=x=>({range:[...x.range],loc:x.loc}),id=()=>({type:'Identifier',name:n.id.name,...at(n.id)});
 const literal=(value,node)=>({type:'Literal',value,raw:JSON.stringify(value),...at(node)});
 const assign=(left,right,node)=>({type:'AssignmentExpression',operator:'=',left,right,...at(node)});
 const member=(property,node)=>({type:'MemberExpression',object:id(),property,computed:true,optional:false,...at(node)});
 const values=new Map();
 function constant(x){
  if(x.type==='Literal'&&['number','string'].includes(typeof x.value))return x.value;
  if(x.type==='Identifier'&&values.has(x.name))return values.get(x.name);
  if(x.type==='MemberExpression'&&x.object.type==='Identifier'&&x.object.name===n.id.name){const key=x.computed?constant(x.property):x.property.name;if(values.has(key))return values.get(key);}
  if(x.type==='UnaryExpression'){const v=constant(x.argument);if(typeof v==='number'){if(x.operator==='-')return -v;if(x.operator==='+')return +v;if(x.operator==='~')return ~v;}}
  if(x.type==='BinaryExpression'){
   const a=constant(x.left),b=constant(x.right);
   if(x.operator==='+'&&typeof a==='string'&&typeof b==='string')return a+b;
   if(typeof a==='number'&&typeof b==='number')switch(x.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;case '**':return a**b;case '<<':return a<<b;case '>>':return a>>b;case '>>>':return a>>>b;case '|':return a|b;case '&':return a&b;case '^':return a^b;}
  }
  throw Error('Unsupported TypeScript runtime syntax: nonconstant enum initializer');
 }
 const expressions=[{type:'LogicalExpression',operator:'||',left:id(),right:assign(id(),{type:'ObjectExpression',properties:[],...at(n)},n),...at(n)}];
 let next=0;
 for(const m of n.body.members){
  const name=m.id.type==='Identifier'?m.id.name:m.id.value;
  const value=m.initializer?constant(m.initializer):next;
  if(!['number','string'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw Error('Unsupported TypeScript runtime syntax: invalid enum constant');
  values.set(name,value);next=typeof value==='number'?value+1:undefined;
  const write=assign(member(literal(name,m.id),m),literal(value,m.initializer||m),m);
  expressions.push(typeof value==='number'?assign(member(write,m),literal(name,m.id),m):write);
 }
 expressions.push(id());
 return {type:'VariableDeclaration',kind:'var',declarations:[{type:'VariableDeclarator',id:id(),init:{type:'SequenceExpression',expressions,...at(n)},...at(n)}],...at(n)};
}
export function parseTypeScript(code,{jsx=false}={}){
 let ast;try{ast=parse(code,{range:true,loc:true,sourceType:'module',jsx})}catch(error){if(jsx)throw error;ast=parse(code,{range:true,loc:true,sourceType:'module',jsx:true})}
 function normalize(n){
  if(!n||typeof n!=='object')return n;
  if(wrappers.has(n.type))return normalize(n.expression);
  if(erased.has(n.type)||n.declare||n.type==='MethodDefinition'&&n.value?.type==='TSEmptyBodyFunctionExpression')return null;
  if(n.type==='TSParameterProperty')return normalize(n.parameter);
  if(n.decorators?.length)throw Error('Unsupported TypeScript runtime syntax: decorators');
  if(n.type==='TSEnumDeclaration')return enumDeclaration(n);
  if(['TSModuleDeclaration','TSImportEqualsDeclaration','TSExportAssignment'].includes(n.type))throw Error('Unsupported TypeScript runtime syntax: '+n.type);
  if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(n.type)&&(n.importKind==='type'||n.exportKind==='type'))return null;
  if(['ImportSpecifier','ExportSpecifier'].includes(n.type)&&(n.importKind==='type'||n.exportKind==='type'))return null;
  if(n.type?.startsWith('TS'))throw Error('Unsupported TypeScript syntax: '+n.type);
  const out={};for(const [k,v]of Object.entries(n)){
   if(metadata.has(k)||k==='decorators')continue;
   out[k]=Array.isArray(v)?v.flatMap(x=>{const y=x?.type?normalize(x):x;return x?.type&&y===null?[]:[y]}):v?.type?normalize(v):v;
  }
  if(n.type==='ExportNamedDeclaration'&&n.declaration&&!out.declaration)return null;
  // Type-only named imports must not become side-effect imports.
  if(n.type==='ImportDeclaration'&&n.specifiers.length&&!out.specifiers.length)return null;
  if(n.type==='MethodDefinition'&&n.kind==='constructor'){
   const props=n.value.params.filter(p=>p.type==='TSParameterProperty');
   const statements=props.map(p=>{
    const id=p.parameter.type==='AssignmentPattern'?p.parameter.left:p.parameter;
    if(id.type!=='Identifier')throw Error('Unsupported TypeScript runtime syntax: parameter property binding');
    const at={range:[...p.range],loc:p.loc},identifier=()=>({type:'Identifier',name:id.name,...at});
    return {type:'ExpressionStatement',...at,expression:{type:'AssignmentExpression',operator:'=',...at,left:{type:'MemberExpression',computed:false,optional:false,...at,object:{type:'ThisExpression',...at},property:identifier()},right:identifier()}};
   });
   const body=out.value.body.body,index=body.findIndex(x=>x.type==='ExpressionStatement'&&x.expression.type==='CallExpression'&&x.expression.callee.type==='Super');
   if(statements.length&&index<0&&JSON.stringify(body).includes('"type":"Super"'))throw Error('Unsupported TypeScript runtime syntax: Conditional super with parameter properties');
   body.splice(index+1,0,...statements);
  }
  return out;
 }
 const result=normalize(ast);Object.defineProperty(result,'__parser',{value:'typescript-estree'});return result;
}
