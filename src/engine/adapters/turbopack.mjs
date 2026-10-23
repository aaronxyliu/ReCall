import {constant,key,field} from '../recognition-context.mjs';
export const turbopackAdapter={id:'turbopack-context',families:['turbopack'],apply(context){
 const {nodes,unit,globalPath,uniqueFn,registrations}=context;
 for(const node of nodes){
  if(node.type!=='CallExpression'||node.callee.type!=='MemberExpression'||key(node.callee)!=='push'||node.arguments[0]?.type!=='ArrayExpression'||globalPath(node.callee.object)!=='global.TURBOPACK')continue;
  let ids=[];
  for(const value of node.arguments[0].elements.slice(1)){
   if(constant(value)!=null)ids.push(constant(value));
   else {const factory=uniqueFn(value);if(factory)for(const id of ids)registrations.push({kind:'turbopack',namespace:'TURBOPACK:'+(unit.environment||'main'),id,node:factory,mechanism:'id-factory-sequence'});ids=[]}
  }
 }
}};
