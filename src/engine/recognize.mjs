// Structural adapters emit one registration/loader representation.
import {recognitionContext} from './recognition-context.mjs';
import {webpackAdapter} from './adapters/webpack.mjs';
import {turbopackAdapter} from './adapters/turbopack.mjs';
import {parcelAdapter} from './adapters/parcel.mjs';
export {constant} from './recognition-context.mjs';
export const runtimeAdapters=Object.freeze([webpackAdapter,turbopackAdapter,parcelAdapter]);
export function recognize(input,{adapters=runtimeAdapters}={}) {
 const context=recognitionContext(input);
 for(const adapter of adapters){if(typeof adapter.id!=='string'||typeof adapter.apply!=='function')throw Error('Invalid runtime adapter contract');adapter.apply(context)}
 const {registrations,loaders,parcelLoaders,diagnostics}=context;
 validateRecognition({registrations,loaders,parcelLoaders,diagnostics});
 return {registrations,loaders,parcelLoaders,diagnostics};
}

export function validateRecognition(result){
 for(const r of result.registrations){
  if(!['webpack','rspack','turbopack','parcel'].includes(r.kind)||typeof r.namespace!=='string'||!r.namespace||typeof r.id!=='string'||!r.node?.range||!/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(r.node.type)||typeof r.mechanism!=='string')throw Error('Adapter emitted an invalid module registration');
 }
 for(const l of result.loaders)if(!l.namespace||!l.requireNode?.range)throw Error('Adapter emitted an invalid loader binding');
 for(const l of result.parcelLoaders)if(!l.namespace||!l.node?.range)throw Error('Adapter emitted an invalid Parcel loader binding');
 return result;
}
