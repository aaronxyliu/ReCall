#!/usr/bin/env node
import {componentsCLI} from './components.mjs';

const args=process.argv.slice(2);
const legacyGraph=args[0]==='graph'&&args.length===3&&!args[1].startsWith('--');
const legacyRecover=args[0]==='recover'&&args.includes('--input');
if(legacyGraph||legacyRecover)await import('./legacy.mjs');
else try{await componentsCLI(args)}catch(e){console.error('ReCall:',e.message);process.exitCode=1}
