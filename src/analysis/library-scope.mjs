// Source ownership comes only from supplied reference/package metadata, never maps.
import path from 'node:path';
export function libraryRoot(u){
 if(u.packageRoot)return path.resolve(u.packageRoot);
 const matches=[...u.path.replaceAll('\\','/').matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g)],last=matches.at(-1);
 return last&&last[1]===u.library?.name?u.path.slice(0,last.index+last[0].length):null;
}
export const libraryScope=u=>JSON.stringify([u.environment||'main',u.library?.name||null,u.library?.version||null,libraryRoot(u)]);
export const sameLibrary=(a,b)=>libraryScope(a)===libraryScope(b);
export function sourceScopes(inventory){
 const units=new Map(inventory.units.map(u=>[u.id,u]));
 if(inventory.units.some(u=>u.library)&&inventory.units.some(u=>!u.library))throw Error('Source library isolation requires ownership for every source unit; do not mix labelled and unlabelled references');
 const scopes=new Map();
 for(const f of inventory.functions){const scope=libraryScope(units.get(f.unit));if(!scopes.has(scope))scopes.set(scope,[]);scopes.get(scope).push(f)}
 return scopes;
}
