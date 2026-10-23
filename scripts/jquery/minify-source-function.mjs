import {minify_sync} from 'terser';
import {parseScript} from 'meriyah';

// Same function-isolation and minification settings as the 42-pair experiment.
export const minificationOptions={compress:{passes:2,toplevel:false},mangle:{toplevel:false},format:{comments:false}};
const cache=new Map();
export function minifySourceFunction(code){
 if(cache.has(code))return cache.get(code);
 let binding='__recovery_candidate';while(code.includes(binding))binding+='_';
 const result=minify_sync('const '+binding+' = ('+code+');',minificationOptions);
 const ast=parseScript(result.code,{ranges:true});
 const declaration=ast.body[0];
 if(ast.body.length!==1||declaration.type!=='VariableDeclaration'||declaration.declarations.length!==1)throw Error('Unexpected source-minification wrapper');
 const node=declaration.declarations[0].init;
 if(!['FunctionExpression','ArrowFunctionExpression'].includes(node.type))throw Error('Minification did not retain the root function');
 const minified=result.code.slice(node.range[0],node.range[1]);
 parseScript('('+minified+');');cache.set(code,minified);return minified;
}
