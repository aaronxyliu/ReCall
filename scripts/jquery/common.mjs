import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const root = process.cwd();
export const output = path.resolve(root, process.env.EXPERIMENT_OUTPUT || 'results/jquery-4.0.0/minified-no-tree-shaking-mapping-v8');
export const hash = x => crypto.createHash('sha256').update(x).digest('hex');
export function write(p, data) { fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(data,null,2)+'\n'); }
export function read(p) { return JSON.parse(fs.readFileSync(p,'utf8')); }
export const readText = p => fs.readFileSync(p,'utf8');
export const now = () => new Date().toISOString();
const scopeFile=path.join(output,'study-config.json');
export const studyConfiguration=fs.existsSync(scopeFile)?read(scopeFile):null;
export function selectedBuilds(builds){
 const ids=studyConfiguration?.buildIds;
 if(!ids)return builds;
 if(!ids.length||new Set(ids).size!==ids.length)throw new Error('Invalid active build selection');
 const found=builds.filter(b=>ids.includes(b.build??b.id));
 if(found.length!==ids.length)throw new Error('Active selection names missing build profiles');
 return found;
}
