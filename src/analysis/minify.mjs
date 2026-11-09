import {minify_sync} from 'terser';
import {parseScript,parseModule} from 'meriyah';
import {parse} from 'acorn';
import {parseFunctionSyntax} from './function-syntax.mjs';

// Ordinary functions retain the original minification settings. Methods keep
// private names; private-field fragments use formatting only, without context.
export const minificationOptions={compress:{passes:2,toplevel:false},mangle:{toplevel:false},format:{comments:false}};
const cache=new Map();
export function minifySourceFunction(code){
 if(cache.has(code))return cache.get(code);
 let binding='__recovery_candidate';while(code.includes(binding))binding+='_';
 const syntax=parseFunctionSyntax(code);
 if(!syntax.method){
  let classSyntax=false;
  const scan=n=>{if(!n||typeof n!=='object')return;if(['PrivateIdentifier','Super'].includes(n.type))classSyntax=true;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')scan(v)};scan(syntax.root);
  if(classSyntax){
   // A nested arrow can reference private fields/super without its class.
   // A grammar-only holder permits formatting; its text never leaves this call.
   let holder='__recovery_holder';while(code.includes(holder))holder+='_';
   const result=minify_sync('const '+holder+'=class extends null { __recovery_fragment(){const '+binding+'=('+code+');} };',{compress:false,mangle:false,format:{comments:false}});
   const ast=parse(result.code,{ecmaVersion:'latest',ranges:true,checkPrivateFields:false}),cls=ast.body[0]?.declarations?.[0]?.init,node=cls?.body?.body?.[0]?.value?.body?.body?.[0]?.declarations?.[0]?.init;
   if(!['FunctionExpression','ArrowFunctionExpression'].includes(node?.type))throw Error('Formatting did not retain the root function fragment');
   const minified=result.code.slice(node.start,node.end);parseFunctionSyntax(minified);cache.set(code,minified);return minified;
  }
 }
 if(syntax.method){
  // Method bodies may mention super or undeclared private fields from their
  // real class. Parse them without inventing that class's members or bindings.
  // Disable mangling here: Terser otherwise renames private fields in isolation.
  const result=minify_sync('const '+binding+'=class extends null {\n'+code+'\n}',{...minificationOptions,mangle:false});
  const ast=parse(result.code,{ecmaVersion:'latest',ranges:true,checkPrivateFields:false});
  const declaration=ast.body[0],cls=declaration?.declarations?.[0]?.init;
  if(ast.body.length!==1||declaration.type!=='VariableDeclaration'||declaration.declarations.length!==1||cls?.type!=='ClassExpression'||cls.body.body.length!==1||cls.body.body[0].type!=='MethodDefinition')throw Error('Minification did not retain the root method');
  const method=cls.body.body[0],minified=result.code.slice(method.start,method.end);
  parseFunctionSyntax(minified);cache.set(code,minified);return minified;
 }
 const result=minify_sync('const '+binding+' = ('+code+');',minificationOptions);
 let ast;try{ast=parseScript(result.code,{ranges:true})}catch{ast=parseModule(result.code,{ranges:true})}
 const declaration=ast.body[0];
 if(ast.body.length!==1||declaration.type!=='VariableDeclaration'||declaration.declarations.length!==1)throw Error('Unexpected source-minification wrapper');
 const node=declaration.declarations[0].init;
 if(!['FunctionExpression','ArrowFunctionExpression'].includes(node.type))throw Error('Minification did not retain the root function');
 const minified=result.code.slice(node.range[0],node.range[1]);
 parseFunctionSyntax(minified);cache.set(code,minified);return minified;
}
