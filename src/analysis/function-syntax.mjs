import {parse} from 'acorn';

// Wrappers supply grammar only. No enclosing declarations, bindings or values
// are reconstructed, and callers return only the original function/method text.
export function parseFunctionSyntax(code){
 const options={ecmaVersion:'latest',sourceType:'script',ranges:true};
 for(const sourceType of ['script','module'])try{
  const ast=parse('('+code+'\n)',{...options,sourceType,checkPrivateFields:false,allowSuperOutsideMethod:true}),root=ast.body[0]?.expression;
  if(ast.body.length===1&&['FunctionExpression','ArrowFunctionExpression'].includes(root?.type))return {ast,root,method:null};
 }catch{/* A method is not a standalone expression. */}
 const ast=parse('(class extends null {\n'+code+'\n})',{...options,checkPrivateFields:false});
 const cls=ast.body[0]?.expression,method=cls?.body?.body?.[0];
 if(ast.body.length!==1||cls?.type!=='ClassExpression'||cls.body.body.length!==1||method?.type!=='MethodDefinition')throw Error('Expected one function or method');
 return {ast,root:method.value,method};
}
