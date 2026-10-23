import {enumerate} from './analysis/measure.mjs';
import {loadManifest,inventoryDigest,checkInventory} from './shared/artifacts.mjs';
// Syntax and positional identities are shared; POG generation is optional.
const parsedProjects=new WeakMap();
export function createProject(manifest,options={}) {
 const input=loadManifest(manifest,options),functions=[],diagnostics=[],nodes=new Map();
 const units=input.units.map(unit=>{
  const functionIds=[];
  try{
   const scan=enumerate(unit.code),byNode=new Map(scan.functions.map(f=>[f.node,`${unit.id}:${f.node.range.join(':')}`]));
   for(const f of scan.functions.sort((a,b)=>a.node.range[0]-b.node.range[0]||b.node.range[1]-a.node.range[1])){
    let parent=scan.parents.get(f.node);while(parent&&!byNode.has(parent))parent=scan.parents.get(parent);
    const record={id:byNode.get(f.node),unit:unit.id,file:unit.path,span:f.node.range,name:f.name||'<anonymous>',parent:parent?byNode.get(parent):null,code:unit.code.slice(...f.node.range),library:unit.library,pogHash:null,propertyOperations:0,graphNodes:0,extractionStatus:'not-requested'};
    functionIds.push(record.id);functions.push(record);nodes.set(record.id,f.node);
   }
  }catch(error){diagnostics.push({kind:'parse-error',unit:unit.id,error:error.message})}
  return {...unit,functionIds};
 });
 const project={schema:'recall.inventory/v1',features:'none',units,functions,diagnostics,context:{roots:input.roots,...input.context},policy:'Code-only syntax inventory; no POG computation, source maps, or models.'};
 project.inputDigest=inventoryDigest(project);parsedProjects.set(project,nodes);return project;
}
export function projectNodes(project) {
 checkInventory(project);if(parsedProjects.has(project))return parsedProjects.get(project);
 const nodes=new Map();for(const unit of project.units){try{for(const f of enumerate(unit.code).functions)nodes.set(`${unit.id}:${f.node.range.join(':')}`,f.node)}catch{/* parse failures remain diagnosed in the project */}}
 parsedProjects.set(project,nodes);return nodes;
}
