import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {graphPrograms} from '../src/analysis/graph-syntax.mjs';import {collectContext} from '../src/analysis/context.mjs';import {Analyzer} from '../src/engine/analyzer.mjs';
test('typed graph syntax preserves original function offsets and rejects unsupported runtime transforms',()=>{
 const code='interface Item { value: number }\nexport function read(x: Item): number { return x.value }';const ast=graphPrograms(code,'x.ts')[0].ast;assert.equal(ast.body[0].declaration.range[0],code.indexOf('function'));assert.throws(()=>graphPrograms('enum Mode { A, B }','x.ts'));assert.throws(()=>graphPrograms('export function broken( {','x.js'));
});
test('component parser finds scripts rather than script-like template comments; scopes remain separate',()=>{
 const code='<!-- <script>invalid</script> --><script context="module">let same=1;</script><script lang="ts">let same:number=2; function f(){return same}</script><p>{same}</p>';
 const p=graphPrograms(code,'view.svelte');assert.equal(p.length,2);assert.equal(p[0].ast.body[1].range[0],code.indexOf('function'));const a=new Analyzer();a.addUnit({id:'view',path:'/view.svelte',code,functions:[]});assert.equal(a.solve().coverage.parseErrors,0);
});
test('mixed metadata, typed modules and component scripts discover dependencies and preserve JS graph edges',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'recall-graph-syntax-'));
 try{
  const put=(name,code)=>{const filename=path.join(root,name);fs.writeFileSync(filename,code);return {id:name,path:filename,code,functions:[]}};
  const meta=put('package.json','{"name":"example"}');const leaf=put('leaf.js','export function target(){return 1}');const typed=put('typed.ts',"import {target} from './leaf.js'; export function caller(x:number){return target()+x}");const component=put('view.svelte',"<script lang='ts'>import {caller} from './typed'; let n:number=1; function use(){return caller(n)}</script><p>{n}</p>");
  const c=collectContext([meta,component],{roots:[root]});assert.equal(c.diagnostics.length,0);assert(c.dependencies.some(d=>d.request==='./typed'&&d.status==='supplied'));assert(c.dependencies.some(d=>d.request==='./leaf.js'&&d.status==='supplied'));
  const a=new Analyzer();for(const u of c.units)a.addUnit(u);const result=a.solve();assert.equal(result.coverage.parseErrors,0);assert(result.diagnostics.some(d=>d.kind==='component-template-not-modeled'));assert(result.units.some(u=>u.path===typed.path));assert(result.units.some(u=>u.path===leaf.path));
  const ast=graphPrograms(typed.code,typed.path)[0].ast;const call=ast.body[1].declaration;const b=new Analyzer();b.addUnit({...leaf,functions:undefined});b.addUnit({...typed,functions:[{id:'caller',span:call.range}]});assert(b.solve().edges.some(e=>e.from==='caller'&&e.kind==='call'));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('constructor parameter properties preserve defaults and emit instance assignments after super',()=>{
 const code='class Base {} class Box extends Base { constructor(public cb: () => void, private n = 1) { super(); } run(){this.cb()} }';
 const ast=graphPrograms(code,'box.ts')[0].ast;const ctor=ast.body[1].body.body[0].value;assert.equal(ctor.range[0],code.indexOf('(public'));assert.equal(ctor.body.body[0].expression.callee.type,'Super');assert.deepEqual(ctor.body.body.slice(1).map(x=>x.expression.left.property.name).sort(),['cb','n']);assert.equal(ctor.params[1].type,'AssignmentPattern');
 assert.throws(()=>graphPrograms('class B extends A {constructor(public x: number){if(x) super();else super();}}','b.ts'),/Conditional super/);
});
