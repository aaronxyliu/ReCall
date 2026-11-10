// Preserve the frozen Meriyah parse whenever possible. Acorn is only a standards-
// compliant fallback for valid JavaScript rejected by Meriyah. TypeScript gets
// a separate normalized runtime AST, retaining original input positions.
import {parseModule as meriyah} from 'meriyah';
import {parse as acorn} from 'acorn';
import {parseTypeScript} from './typescript.mjs';
export function parseModule(code,options={}) {
 let ast,parser='meriyah-6.0.6';
 try {ast=meriyah(code,options)} catch(original) {
  try {ast=acorn(code,{ecmaVersion:'latest',sourceType:'module',ranges:true,locations:true});parser='acorn-8.19.0-fallback'} catch {
   try{return parseTypeScript(code)}catch(typed){
    if(typed.message.startsWith('Unsupported TypeScript'))throw typed;
    throw original;
   }
  }
  const clean=n=>{if(!n||typeof n!=='object')return;delete n.start;delete n.end;for(const [k,v]of Object.entries(n))if(k!=='loc'&&k!=='range'){if(Array.isArray(v))v.forEach(clean);else clean(v)}};clean(ast);
 }
 Object.defineProperty(ast,'__parser',{value:parser});return ast;
}
