import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const jsMime = /^(?:text|application)\/(?:x-)?(?:java|ecma)script(?:\s*;|$)/i;
function webURL(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol)) throw Error('Expected an HTTP(S) URL');
  u.hash = '';
  return u.href;
}
export function parsePageFetchMetadata(text) {
  const normalized = text.replace(/\r\n/g, '\n'), head = normalized.split('\n\n', 1)[0];
  const fields = Object.fromEntries(head.split('\n').map(line => {
    const i = line.indexOf(':');
    return i < 0 ? [] : [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
  }).filter(parts => parts.length === 2));
  if (!fields.url || !fields.parent || !fields.type) throw Error('Missing url, parent, or type in page-fetch metadata');
  const contentType = normalized.split('\n').filter(s => /^< content-type:/i.test(s)).at(-1)?.replace(/^< content-type:\s*/i, '') || '';
  return {url: webURL(fields.url), parent: webURL(fields.parent), resourceType: fields.type, contentType};
}
function mirrorPath(url) {
  const u = new URL(url);
  const segments = u.pathname.split('/').filter(Boolean).map(segment => segment.replace(/[^a-zA-Z0-9._%-]/g, c => encodeURIComponent(c)));
  if (segments.some(s => s === '.' || s === '..')) throw Error('Invalid URL path');
  if (!segments.length || u.pathname.endsWith('/')) segments.push('__index__');
  return path.posix.join('files', sha(u.origin).slice(0, 16), ...segments);
}

/** Offline import of page-fetch response bodies. This does not launch a browser. */
function canonicalFuturePath(value) {
  let parent = path.resolve(value); const tail = [];
  while (!fs.existsSync(parent)) {tail.unshift(path.basename(parent)); const next = path.dirname(parent); if (next === parent) throw Error('Cannot resolve capture output parent'); parent = next;}
  return path.join(fs.realpathSync(parent), ...tail);
}
export function importPageFetch(directory, {output, pageURL = null, maxFiles = 20000, maxBytes = 1073741824} = {}) {
  if (!output) throw Error('Capture import requires an output directory');
  for (const [name, value] of Object.entries({maxFiles, maxBytes})) if (!Number.isSafeInteger(value) || value < 1) throw Error(name + ' must be a positive integer');
  const root = fs.realpathSync(directory), destination = canonicalFuturePath(output);
  if (destination === root || destination.startsWith(root + path.sep)) throw Error('Capture output must be outside the raw page-fetch directory');
  if (fs.existsSync(destination)) throw Error('Capture output exists; choose a fresh directory');
  const diagnostics = [], candidates = [], parents = new Set();
  let count = 0, bytes = 0;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, e.name);
      if (e.isSymbolicLink()) {diagnostics.push({kind:'symlink-skipped', file:path.relative(root,file)}); continue;}
      if (e.isDirectory()) {walk(file); continue;}
      if (!e.isFile() || !e.name.endsWith('.meta')) continue;
      count++; bytes += fs.statSync(file).size;
      if (count > maxFiles || bytes > maxBytes) throw Error('Capture input exceeds maxFiles/maxBytes');
      const rawMeta = fs.readFileSync(file), relative = path.relative(root, file);
      let meta;
      try {meta = parsePageFetchMetadata(rawMeta.toString('utf8'));}
      catch (error) {diagnostics.push({kind:'invalid-metadata', file:relative, error:error.message}); continue;}
      parents.add(meta.parent);
      const bodyPath = file.slice(0, -5);
      if (!fs.existsSync(bodyPath) || !fs.lstatSync(bodyPath).isFile()) {diagnostics.push({kind:'missing-or-nonregular-body', file:relative}); continue;}
      const selected = meta.resourceType.toLowerCase() === 'script' || jsMime.test(meta.contentType);
      if (!selected) continue;
      if (/^(?:text\/html|application\/(?:json|xhtml\+xml))(?:\s*;|$)/i.test(meta.contentType)) {
        diagnostics.push({kind:'non-javascript-response', file:relative, url:meta.url, contentType:meta.contentType}); continue;
      }
      bytes += fs.statSync(bodyPath).size;
      if (bytes > maxBytes) throw Error('Capture input exceeds maxBytes');
      const body = fs.readFileSync(bodyPath);
      candidates.push({...meta, rawFile:path.relative(root, bodyPath), metadataSha256:sha(rawMeta), sha256:sha(body), body});
    }
  }
  walk(root);
  if (!pageURL && parents.size !== 1) throw Error('Capture contains zero or multiple page URLs; pass --page-url to select one captured page');
  const parent = pageURL ? webURL(pageURL) : [...parents][0];
  if (!parents.has(parent)) throw Error('The requested page URL is not present in page-fetch metadata');
  const selected = new Map(); let duplicates = 0;
  for (const entry of candidates.filter(e => e.parent === parent)) {
    const previous = selected.get(entry.url);
    if (previous) {
      if (previous.sha256 !== entry.sha256) throw Error('Conflicting captured bodies for URL ' + entry.url + '; use a fresh capture directory');
      duplicates++; continue;
    }
    selected.set(entry.url, entry);
  }
  const entries = [...selected.values()].sort((a,b) => a.url.localeCompare(b.url));
  if (!entries.length) throw Error('No JavaScript response bodies found for the selected page');
  const byPath = new Map();
  for (const e of entries) {
    e.mirror = mirrorPath(e.url);
    if (!byPath.has(e.mirror)) byPath.set(e.mirror, []);
    byPath.get(e.mirror).push(e);
  }
  const runtimeGroup = 'page-fetch:' + sha(parent).slice(0, 20), files = [], records = [], written = new Set();
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  const temporary = fs.mkdtempSync(destination + '.tmp-');
  try {
    for (const e of entries) {
      const u = new URL(e.url), variants = byPath.get(e.mirror);
      // Keep ordinary relative import paths intact. Query variants get distinct
      // physical paths plus exact virtual aliases; never pick an arbitrary version.
      const relative = variants.length === 1 || !u.search ? e.mirror : e.mirror + '.recall-' + sha(e.url).slice(0, 16) + '.js';
      if (written.has(relative)) throw Error('URL mirror collision: ' + e.url);
      written.add(relative);
      const target = path.join(temporary, relative);
      fs.mkdirSync(path.dirname(target), {recursive:true});fs.writeFileSync(target, e.body, {flag:'wx'});
      const aliases = u.search ? [e.mirror + u.search] : [];
      const item = {id:'capture:' + sha(e.url).slice(0, 24), path:relative, environment:'main', runtimeGroup,
        ...(aliases.length ? {aliasPaths:aliases} : {})};
      files.push(item);
      records.push({...item, url:e.url, rawFile:e.rawFile, sha256:e.sha256, metadataSha256:e.metadataSha256, resourceType:e.resourceType, contentType:e.contentType, bytes:e.body.length});
    }
    for (const [file, variants] of byPath) if (variants.length > 1) diagnostics.push({kind:'query-variants', file, urls:variants.map(e=>e.url)});
    diagnostics.push({kind:'frame-context-unavailable', detail:'page-fetch records the seed page URL, not individual frame or worker realms. This manifest groups responses under one observed page; curate environments for mixed realms.'});
    const manifest = {schema:'recall.capture-input/v1', roots:['files'], files};
    const report = {schema:'recall.page-fetch-import/v1', pageURL:parent, rawDirectory:root, importedScripts:files.length, identicalURLDuplicates:duplicates, modelCalls:0,
      scope:'Saved external JavaScript responses for one page-fetch seed. No automatic lazy-chunk enumeration, inline-script extraction, or inferred frame/worker separation.', records, diagnostics};
    fs.writeFileSync(path.join(temporary,'bundle.json'), json(manifest));
    fs.writeFileSync(path.join(temporary,'capture.json'), json(report));
    fs.renameSync(temporary, destination);
    return {...report, manifest:path.join(destination,'bundle.json')};
  } catch (error) {fs.rmSync(temporary,{recursive:true,force:true}); throw error;}
}
