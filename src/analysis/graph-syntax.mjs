// Syntax adapters for static graph analysis only. Original inventory bytes and
// function identities are never rewritten or sent to models through this layer.
import path from 'node:path';
import {Parser} from 'acorn';
import {tsPlugin} from '@sveltejs/acorn-typescript';
import {stripTypeScriptTypes} from 'node:module';
import {parse as parseComponent} from 'svelte/compiler';
import {parseModule} from './parse.mjs';
export function graphLanguage(filename){
 const ext=path.extname(filename.replace(/[?#].*$/,''));
 if(ext==='.svelte')return 'component';
 if(['.ts','.mts','.cts'].includes(ext))return 'typescript';
 if(['.json','.css','.scss','.sass','.less','.html','.svg','.md','.map'].includes(ext))return 'asset';
 return 'javascript'; // Preserve extensionless and virtual JavaScript inputs.
}
const blank=s=>s.replace(/[^\r\n]/g,' ');
function typedProgram(text){
 let stripped;
 try{return parseModule(stripTypeScriptTypes(text,{mode:'strip'}),{next:true,ranges:true,loc:false})}catch(error){if(error.code!=='ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')throw error}
 // Parse syntax to locate parameter modifiers exactly; never erase with regex.
 const typed=Parser.extend(tsPlugin()).parse(text,{ecmaVersion:'latest',sourceType:'module',ranges:true});
 const props=[],stack=[typed];while(stack.length){const n=stack.pop();if(n.type==='TSParameterProperty'){const p=n.parameter,name=p.type==='AssignmentPattern'?p.left.name:p.name;if(!name)throw Error('Unsupported parameter property binding');props.push({start:n.start,end:(p.left||p).start,name})}for(const v of Object.values(n))for(const x of Array.isArray(v)?v:[v])if(x?.type)stack.push(x)}
 if(!props.length)throw Error('Unsupported TypeScript runtime syntax; no graph transform applied');
 props.sort((a,b)=>a.start-b.start);
 const chars=text.split('');for(const p of props)for(let i=p.start;i<p.end;i++)if(!/[\r\n]/.test(chars[i]))chars[i]=' ';
 stripped=stripTypeScriptTypes(chars.join(''),{mode:'strip'});
 const ast=parseModule(stripped,{next:true,ranges:true,loc:false});
 const nodes=[ast];while(nodes.length){const n=nodes.pop();if(n.type==='MethodDefinition'&&n.kind==='constructor'){
  const assignments=props.filter(p=>n.value.params.some(x=>x.range[0]===p.end)).map(p=>{
   const statement=parseModule('this.'+p.name+'='+p.name+';',{next:true,ranges:true,loc:false}).body[0];
   const todo=[statement];while(todo.length){const x=todo.pop();x.range=[p.start,p.end];for(const v of Object.values(x))for(const y of Array.isArray(v)?v:[v])if(y?.type)todo.push(y)}return statement;
  });
  const body=n.value.body.body,superIndex=body.findIndex(x=>x.type==='ExpressionStatement'&&x.expression.type==='CallExpression'&&x.expression.callee.type==='Super');if(assignments.length&&superIndex<0&&JSON.stringify(body).includes('\"type\":\"Super\"'))throw Error('Conditional super with parameter properties is not modeled');body.splice(superIndex+1,0,...assignments);
 }for(const v of Object.values(n))for(const x of Array.isArray(v)?v:[v])if(x?.type)nodes.push(x)}
 return ast;
}
export function graphPrograms(code,filename){
 const language=graphLanguage(filename);
 if(language==='asset')return [];
 const parse=(text,typed)=>typed?typedProgram(text):parseModule(text,{next:true,ranges:true,loc:false});
 if(language==='typescript')return [{ast:parse(code,true),scope:'module'}];
 if(language!=='component')return [{ast:parse(code,false),scope:'module'}];
 const root=parseComponent(code,{modern:true,filename});
 return [root.instance,root.module].filter(Boolean).map(script=>{
  const {start,end}=script.content;
  const text=blank(code.slice(0,start))+code.slice(start,end)+blank(code.slice(end));
  const typed=script.attributes.some(a=>a.name==='lang'&&a.value?.some(v=>v.data==='ts'||v.data==='typescript'));
  return {ast:parse(text,typed),scope:script===root.module?'component-module':'component-instance'};
 });
}
