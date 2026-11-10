// Syntax adapters for static graph analysis only. Original inventory bytes and
// function identities are never rewritten or sent to models through this layer.
import path from 'node:path';
import {parse as parseComponent} from 'svelte/compiler';
import {parseModule} from './parse.mjs';
import {parseTypeScript} from './typescript.mjs';
export function graphLanguage(filename){
 const ext=path.extname(filename.replace(/[?#].*$/,''));
 if(ext==='.svelte')return 'component';
 if(['.ts','.mts','.cts'].includes(ext))return 'typescript';
 if(['.json','.css','.scss','.sass','.less','.html','.svg','.md','.map'].includes(ext))return 'asset';
 return 'javascript'; // Preserve extensionless and virtual JavaScript inputs.
}
const blank=s=>s.replace(/[^\r\n]/g,' ');
function typedProgram(text){return parseTypeScript(text)}
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
