// Derive an inspectable module/chunk graph from solved code-only state.
// Registration intervals locate syntax, not library membership or function matches.
export function moduleGraph(a){
 const modules=[],moduleByKey=new Map(),ranges=new Map(),dependencies=[],seen=new Set();
 function register(key,unit,factories){const info={key,unit,factories};modules.push(info);if(!moduleByKey.has(key))moduleByKey.set(key,[]);moduleByKey.get(key).push(info);for(const token of factories){const f=a.tokens.get(token);if(!f)continue;let rs=ranges.get(unit);if(!rs)ranges.set(unit,rs=[]);rs.push({start:f.span[0],end:f.span[1],key})}}
 for(const [key,instances]of a.modules)for(const m of instances)register(key,m.unit,[m.factory]);
 for(const r of a.rules)if(r.op==='factory'){
  const factories=new Set();for(const t of a.values[r.a]){if(a.tokens.get(t)?.type==='function')factories.add(t);else for(const s of a.objects.get(t)?.values()||[])for(const v of a.values[s])if(a.tokens.get(v)?.type==='function')factories.add(v)}
  const thunk=r.mt.slice(3),unit=[...factories].map(t=>a.tokens.get(t).unit)[0];if(unit)register(thunk,unit,[...factories]);
 }
 const intervals=new Map();for(const [unit,rs]of ranges){const grouped=new Map();for(const r of rs){const k=r.start+':'+r.end;let g=grouped.get(k);if(!g)grouped.set(k,g={start:r.start,end:r.end,keys:[]});g.keys.push(r.key)}intervals.set(unit,[...grouped.values()].sort((x,y)=>x.start-y.start))}
 function owner(c){if(!c.span)return[];const rs=intervals.get(c.unit)||[];let lo=0,hi=rs.length;while(lo<hi){const m=(lo+hi)>>>1;if(rs[m].start<=c.span[0])lo=m+1;else hi=m}const r=rs[lo-1];return r&&r.end>=c.span[1]?r.keys:[]}
 function edge(c,target,kind,instances){const fromModules=owner(c),toUnits=[...new Set(instances.map(m=>m.unit))],e={fromUnit:c.unit,fromModules,toModule:target,toUnits,kind,span:c.span,status:instances.length?'supplied':'not-supplied'};const key=JSON.stringify(e);if(!seen.has(key)){seen.add(key);dependencies.push(e)}}
 for(const c of a.calls)for(const t of a.values[c.a]){
  if(t.startsWith('require:')&&c.literals[0]!=null){const key=t.slice(8)+':'+c.literals[0];edge(c,key,'runtime-require',a.modules.get(key)||[])}
  else if(t.startsWith('contextMethod:')){const m=t.slice(14),split=m.indexOf(':context:'),method=m.slice(0,split),ctx=a.tokens.get(m.slice(split+1));if(ctx&&['r','i'].includes(method)&&c.literals[0]!=null){const key='turbopack:'+ctx.namespace+':'+c.literals[0];edge(c,key,method==='r'?'runtime-require':'runtime-namespace-import',a.modules.get(key)||[])}}
  else if(t.startsWith('thunk:'))edge(c,t,'lazy-commonjs-require',(moduleByKey.get(t)||[]));
  else if(t.startsWith('sourceRequire:')&&c.literals[0]!=null){const u=a.unitById.get(c.unit),target=a.resolvePath(u,c.literals[0]);edge(c,'source:'+c.literals[0],'source-require',target?[{unit:target.id}]:[])}
 }
 for(const l of a.links){const target=a.resolvePath(l.u,l.request);edge({unit:l.u.id,span:null},'esm:'+l.request,l.kind==='star'?'esm-reexport':l.kind==='dynamic'?'literal-dynamic-import':'esm-import',target?[{unit:target.id}]:[])}
 return {policy:'Static module/chunk references among supplied units, not execution or load-order guarantees. Merged factory IDs remain fromModules alternatives; no module-to-library or initialization-function matching. Not-supplied references are retained explicitly.',modules,dependencies};
}
