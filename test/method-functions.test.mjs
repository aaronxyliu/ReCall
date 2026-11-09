import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,projectNodes} from '../src/project.mjs';
import {checkInventory,inventoryDigest} from '../src/shared/artifacts.mjs';
import {parseFunctionSyntax} from '../src/analysis/function-syntax.mjs';
import {minifySourceFunction} from '../src/analysis/minify.mjs';
import {astMatch} from '../src/analysis/ast-match.mjs';
import {extractFeatures} from '../components/pog/index.mjs';
import {runPipeline} from '../components/pipeline/index.mjs';

const code='class Example extends Base { #value; constructor(x){super(x);this.#value=x} connect(x){this.delegate.connect(x)} get value(){return this.#value} set value(x){this.#value=x} static async *events(x){yield await x()} #read(){return this.#value} } const obj={async save(x){return x+1},*items(){yield 1},get count(){return 1},set count(x){this.x=x}};';
test('extracts complete methods while preserving function identities and graph spans',()=>{
 const p=createProject({files:[{id:'unit',path:'methods.js',code}]});assert.equal(p.diagnostics.length,0);assert.equal(p.functions.length,10);checkInventory(p);
 for(const f of p.functions){assert(f.codeSpan);assert.equal(f.code,code.slice(...f.codeSpan));assert.equal(f.id,'unit:'+f.span.join(':'));assert(projectNodes(p).has(f.id));assert.doesNotThrow(()=>parseFunctionSyntax(f.code));assert.doesNotThrow(()=>parseFunctionSyntax(minifySourceFunction(f.code)));}
 assert(p.functions.some(f=>f.code.startsWith('static async *events')));assert(p.functions.some(f=>f.code.startsWith('constructor')));assert(p.functions.some(f=>f.code.startsWith('#read')));
 const bad=structuredClone(p);bad.functions[0].codeSpan[0]++;bad.inputDigest=inventoryDigest(bad);assert.throws(()=>checkInventory(bad),/inventory span/);
});
test('method normalization adds no enclosing context and retains private names',()=>{
 for(const code of ['connect(){this.delegate.connect()}','constructor(x){super(x);this.#value=x}','get value(){return this.#value}','#read(){return this.#value}']){
  const compact=minifySourceFunction(code);assert(!compact.startsWith('class'));assert(!compact.includes('__recovery_candidate'));assert(!compact.includes('extends null'));if(code.includes('#value'))assert(compact.includes('#value'));
 }
});
test('method AST matching handles local renaming and preserves method and body distinctions',()=>{
 assert(astMatch('connect(x){this.delegate.connect(x)}','connect(y){this.delegate.connect(y)}'));
 assert(astMatch('constructor(x){super(x);this.#value=x}','constructor(y){super(y);this.#value=y}'));
 assert(astMatch('get value(){return this.#value}','get value(){return this.#value}'));
 assert(!astMatch('connect(x){this.delegate.connect(x)}','disconnect(y){this.delegate.connect(y)}'));
 assert(!astMatch('connect(x){this.delegate.connect(x)}','static connect(y){this.delegate.connect(y)}'));
 assert(!astMatch('connect(x){return x+1}','connect(y){return y+2}'));
 assert(!astMatch('get value(){return this.#left}','get value(){return this.#right}'));
 assert(!astMatch('async connect(x){return x}','connect(y){return y}'));
});
test('isolated private-field arrows and import.meta parse without enclosing context',()=>{
 for(const code of ['event => this.#handleKeydown(event)','resolve => (this.#resolve = resolve)','async function init(){return import.meta.url}','()=>super.connect()']){
  const compact=minifySourceFunction(code);assert.doesNotThrow(()=>parseFunctionSyntax(compact));assert(!compact.startsWith('class'));assert(!compact.includes('__recovery_holder'));assert(astMatch(code,code));
 }
 assert(astMatch('x=>this.#handle(x)','y=>this.#handle(y)'));
 assert(!astMatch('x=>this.#left(x)','y=>this.#right(y)'));
 assert(minifySourceFunction('connect(){return __recovery_candidate}').includes('__recovery_candidate'));
});
test('formerly discarded method enters ranked candidate list and can receive AST validation',async()=>{
 const anchor='anchor(o){o.a;o.b;o.c;o.d;o.e;o.f;o.g;o.h;o.i;o.j}';
 const source=extractFeatures({files:[{id:'s',path:'source.js',code:'class A{'+anchor+'connect(x){this.delegate.connect(x)}}',library:{name:'lib',version:'1'}}]});
 const bundle=extractFeatures({files:[{id:'b',path:'bundle.js',code:'class B{'+anchor+'connect(y){this.delegate.connect(y)}}'}]});
 const seen=[],models={config:{provider:'test'},async embed(xs){seen.push(...xs);return xs.map(()=>[1,1])},async validate({source,bundle,minified}){return {verdict:astMatch(source.code,bundle.code,{minifiedSource:minified})?'accept':'reject',validator:'ast'}}};
 const r=await runPipeline({source,bundle,config:{recovery:{libraryGate:false,conflictPolicy:'retain',topK:3},graph:{useModules:false,siblingWindow:2,includeContainment:true}},models});
 const target=bundle.functions.find(f=>f.name==='connect'),candidate=source.functions.find(f=>f.name==='connect');const q=r.recovery.queries.find(q=>q.bundleId===target.id);assert(q);assert(q.candidates.some(c=>c.sourceId===candidate.id));assert(q.checks.some(c=>c.sourceId===candidate.id&&c.verdict==='accept'));assert(!r.recovery.diagnostics.some(d=>d.kind==='source-minification-error'));assert(seen.every(t=>!t.includes('class A')&&!t.includes('class B')&&!t.includes('extends null')));
});
