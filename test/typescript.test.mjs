import {runInNewContext} from 'node:vm';import {minify_sync} from 'terser';
import test from 'node:test';import assert from 'node:assert/strict';
import {extractFeatures,identifyAnchors} from '../components/pog/index.mjs';
import {parseModule} from '../src/analysis/parse.mjs';
import {minifySourceFunction} from '../src/analysis/minify.mjs';
import {graphPrograms} from '../src/analysis/graph-syntax.mjs';
const inventory=(code,path='source.ts')=>extractFeatures({files:[{id:'s',path,code,library:{name:'example',version:'1'}}]});
test('TS runtime AST preserves original function identities and matches JS POG',()=>{
 const body='return x.a+x.b+x.c+x.d+x.e+x.f+x.g+x.h+x.i+x.j;';
 const code='import type {Item} from "types"; type Callback = (v: Item) => void; interface Shape { method(): void }\nexport function compute<T>(x: Item): number {'+body+'}';
 const s=inventory(code),b=inventory('function compute(x){'+body+'}','bundle.js');
 assert.equal(s.diagnostics.length,0);assert.equal(s.functions.length,1);const f=s.functions[0];assert.equal(f.span[0],code.indexOf('function compute'));assert.equal(f.span[1],code.length);assert.equal(f.code,code.slice(...f.span));assert.equal(f.id,'s:'+f.span.join(':'));assert.equal(s.units[0].code,code);assert.equal(f.pogHash,b.functions[0].pogHash);assert.equal(identifyAnchors(s,b).matches.length,1);
});
test('type wrappers and type-only imports do not introduce runtime nodes',()=>{
 const ast=parseModule('import {type X} from "x"; const f = (x: X) => (x as X)!.value satisfies number;');assert.equal(ast.body.length,1);assert.equal(ast.body[0].declarations[0].init.body.type,'MemberExpression');assert(!JSON.stringify(ast).includes('TSAsExpression'));
 const ast2=parseModule('function f([,x]: any[]){return x.a}');assert.equal(ast2.body[0].params[0].elements[0],null);
});
test('typed methods and generic functions can be minified',()=>{
 for(const code of ['function f<T>(x:T):T{return x}','(x: number): number => x+1','public getValue(x: number): number {return x+1}','constructor(public x:number){this.y=x}','constructor(protected x:number){super(x)}','override dispose():void{this.value.dispose()}'])assert.doesNotThrow(()=>minifySourceFunction(code));
 const s=inventory('class C { value(x: number): number {return x+1} }');assert.equal(s.functions.length,1);assert.equal(s.functions[0].code,'value(x: number): number {return x+1}');
});
test('runtime-bearing TS constructs are explicitly diagnosed rather than erased',()=>{
 for(const code of ['enum E { A = compute() } function f(){return E.A}','@decorate class C {f(x:number){return x}}']){const s=inventory(code);assert.equal(s.functions.length,0);assert.match(s.diagnostics[0].error,/Unsupported TypeScript runtime syntax/);}
});
test('constant enums preserve bindings, numeric reverse mappings and original function identities',()=>{
 const code='export enum E { A=-1, B, C=1<<3, D=C|2, S="s", T=S }\nexport function f(x:E){return x===E.D}';
 const ast=parseModule(code),decl=ast.body[0].declaration;assert.equal(decl.type,'VariableDeclaration');
 const writes=decl.declarations[0].init.expressions.slice(1,-1);
 assert.deepEqual(writes.slice(0,4).map(w=>w.left.property.right.value),[-1,0,8,10]);
 assert.deepEqual(writes.slice(4).map(w=>w.right.value),['s','s']);
 const s=inventory(code);assert.equal(s.diagnostics.length,0);assert.equal(s.functions.length,1);assert.equal(s.functions[0].code,'function f(x:E){return x===E.D}');assert.equal(s.functions[0].span[0],code.indexOf('function f'));
 const merged=parseModule('enum E {A=1} enum E {B=2}');assert.equal(merged.body.length,2);assert(merged.body.every(d=>d.declarations[0].init.expressions[0].operator==='||'));
 assert.equal(inventory('declare enum D {A} const enum C {A,B} function f(){return C.B}').functions.length,1);
 assert.doesNotThrow(()=>minifySourceFunction('function f(){enum E {A,B} return E.B}'));
});
test('typed graph parsing preserves offsets and removes type-only dependencies',()=>{
 const code='import type {X} from "types"; function f(x:X){return x.a}';const ast=graphPrograms(code,'source.ts')[0].ast;assert.equal(ast.body.length,1);assert.equal(ast.body[0].range[0],code.indexOf('function f'));
});

test('parameter properties contribute runtime writes without changing constructor identity',()=>{
 const code='class C extends B {constructor(public x:number){super();this.y=x}}';const s=inventory(code);assert.equal(s.diagnostics.length,0);assert.equal(s.functions.length,1);assert.equal(s.functions[0].propertyOperations,2);assert.equal(s.functions[0].code,'constructor(public x:number){super();this.y=x}');
});

test('enum analysis lowering preserves values, reverse mappings and merged declarations',()=>{
 const ast=parseModule('enum E { A=-1, B, C=1<<3, D=C|2, S="s", T=S } enum E { Z=20 } globalThis.result=[E.A,E.B,E.C,E.D,E.S,E.T,E[-1],E[0],E[10],E.Z,E[20],E.s];');
 const code=minify_sync(ast,{parse:{spidermonkey:true},compress:false,mangle:false}).code,context={};runInNewContext(code,context);
 assert.deepEqual(Array.from(context.result),[-1,0,8,10,'s','s','A','B','D',20,'Z',undefined]);
});
