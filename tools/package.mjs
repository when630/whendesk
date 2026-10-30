import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
let runtime=process.env.WHENDESK_ELECTRON_DIST;
if(!runtime){try{runtime=path.join(path.dirname(require.resolve('electron/package.json')),'dist');}catch{runtime='D:/when630/whencommand/node_modules/electron/dist';}}
if(!fs.existsSync(path.join(runtime,'electron.exe')))throw new Error('Electron Windows 런타임을 찾을 수 없습니다. npm install 또는 WHENDESK_ELECTRON_DIST를 설정하세요.');
const dist=path.join(root,'dist');const destination=path.resolve(dist,'WHENDESK-'+pkg.version+'-win-x64');
if(!destination.startsWith(path.resolve(dist)+path.sep))throw new Error('잘못된 빌드 경로입니다.');
fs.mkdirSync(destination,{recursive:true});
if(!fs.existsSync(path.join(destination,'WHENDESK.exe'))){fs.cpSync(runtime,destination,{recursive:true});fs.renameSync(path.join(destination,'electron.exe'),path.join(destination,'WHENDESK.exe'));}
const appDir=path.join(destination,'resources','app');fs.mkdirSync(appDir,{recursive:true});
for(const folder of ['main','renderer','vendor','assets'])fs.cpSync(path.join(root,folder),path.join(appDir,folder),{recursive:true});
for(const module of ['work','note','calendar','command'])fs.cpSync(path.join(root,'modules',module),path.join(appDir,'modules',module),{recursive:true});
fs.mkdirSync(path.join(appDir,'node_modules'),{recursive:true});fs.cpSync(path.join(root,'node_modules','ical.js'),path.join(appDir,'node_modules','ical.js'),{recursive:true});
const packaged={...pkg};delete packaged.devDependencies;delete packaged.scripts;fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify(packaged,null,2));
for(const file of ['README.md','NOTICE.md'])if(fs.existsSync(path.join(root,file)))fs.copyFileSync(path.join(root,file),path.join(destination,file));
const executable=path.join(destination,'WHENDESK.exe');const hash=crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
fs.writeFileSync(path.join(dist,'build-info.json'),JSON.stringify({name:'WHENDESK',version:pkg.version,platform:'win32-x64',createdAt:new Date().toISOString(),directory:destination,executable,executableSha256:hash,format:'portable-folder',electronVersion:fs.readFileSync(path.join(runtime,'version'),'utf8').trim()},null,2));
console.log(JSON.stringify({directory:destination,executable,version:pkg.version}));
