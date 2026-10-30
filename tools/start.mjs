import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const require=createRequire(import.meta.url);
let electron=process.env.WHENDESK_ELECTRON;
if(!electron){try{electron=require('electron');}catch{const known='D:/when630/whencommand/node_modules/electron/dist/electron.exe';if(fs.existsSync(known))electron=known;}}
if(!electron||!fs.existsSync(electron)){console.error('Electron이 필요합니다. whendesk 폴더에서 npm install을 실행해 주세요.');process.exit(1);}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[root,...process.argv.slice(2)],{cwd:root,env,stdio:'inherit',windowsHide:true});child.on('exit',code=>process.exit(code??1));child.on('error',error=>{console.error(error.message);process.exit(1);});
