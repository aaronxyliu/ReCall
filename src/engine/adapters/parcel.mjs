import {constant,key,field} from '../recognition-context.mjs';
export const parcelAdapter={id:'parcel-register',families:['parcel'],apply(context){
 const {nodes,bind,parent,owner,unit,code,diagnostics,registrations,loaders,resolve,uniqueFn,globalPath,table,tableProof,nodesByOwner,protocolNamespace,registry,emit,sameReference,parcelLoaders}=context;
 // Parcel loader identity follows the actual bound global member, never a file-wide regex.
 const parcelRoots=new Map();for(const n of nodes)if(n.type==='MemberExpression'){const p=globalPath(n);if(p&&/\.parcelRequire[\w$]*$/.test(p))parcelRoots.set(p,registry(p))}
 for(const n of nodes)if(n.type==='CallExpression'){
  const candidates=resolve(n.callee);let object=null;for(const x of candidates)if(x.type==='MemberExpression'&&key(x)==='register')object=x.object;
  if(!object&&n.callee.type==='MemberExpression'&&key(n.callee)==='register')object=n.callee.object;
  if(!object||constant(n.arguments[0])==null)continue;const root=globalPath(object),f=uniqueFn(n.arguments[1]);if(root&&parcelRoots.has(root)&&f){const namespace=parcelRoots.get(root);registrations.push({kind:'parcel',namespace,id:constant(n.arguments[0]),node:f,mechanism:'bound-register'});parcelLoaders.push({node:object,namespace})}
 }

}};
