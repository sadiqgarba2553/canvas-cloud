// Each checkout publishes only its own application. No website-repository writes.
import {readFile,writeFile,mkdir,stat,readdir,rename} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export function assertDestination(expected,origin) {
  const match=origin.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  if(!match || /\/bluecloud-website$/i.test(expected) || match[1].toLowerCase()!==expected.toLowerCase())throw Error('Publishing is restricted to this app’s own repository. Website publishing is forbidden.');
}
async function sha(file){const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex');}
async function sum(dir){let total=0;for(const entry of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);total+=entry.isDirectory()?await sum(p):(await stat(p)).size;}return total;}
async function main(){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const config=JSON.parse(await readFile(path.join(root,'release.config.json'),'utf8'));
  const git=(args,extra={})=>spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,...extra});
  const origin=git(['remote','get-url','origin']);if(origin.status)throw Error('An app-specific origin remote is required');
  assertDestination(config.repository,origin.stdout);
  if(process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY!==config.repository)throw Error('Workflow repository differs from the app repository');
  const tag='v'+config.version,out=path.join(root,'.release',tag),mode=process.argv[2];
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(config.version))throw Error('Invalid release version');
  await mkdir(out,{recursive:true});
  const url=name=>`https://github.com/${config.repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
  const manifestPath=path.join(out,'release-manifest.json');
  if(mode==='migrate'||mode==='prepare'){
    const assets=[];const add=async file=>{const s=await stat(file);assets.push({file,name:path.basename(file),size:s.size,sha256:await sha(file)});};
    if(mode==='migrate')for(const asset of config.migration.assets){
      if(!/^[A-Za-z0-9._-]+$/.test(asset.name)||!/^\w{64}$/.test(asset.sha256))throw Error('Invalid migration asset');
      const file=path.join(out,asset.name);let exists=false;try{exists=(await stat(file)).size===asset.size&&await sha(file)===asset.sha256;}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!exists){
        const source=`${config.migration.source}/${encodeURIComponent(asset.name)}`;
        const r=await fetch(source);if(!r.ok)throw Error(`Source download failed: ${asset.name} (${r.status})`);
        const temp=file+'.'+randomUUID()+'.partial';await pipeline(Readable.fromWeb(r.body),createWriteStream(temp,{flags:'wx'}));
        if((await stat(temp)).size!==asset.size||await sha(temp)!==asset.sha256)throw Error('Source package integrity failed: '+asset.name);
        await rename(temp,file);
      }
      await add(file);console.log('Verified migration asset '+asset.name);
    }
    else for(const relative of config.localAssets)await add(path.join(root,relative));
    const source=path.join(out,`${config.sourceName}-${config.version}-source.zip`);
    const archived=git(['archive','--format=zip',`--prefix=${config.sourceName}-${config.version}/`,`--output=${source}`,'HEAD']);if(archived.status)throw Error('Could not archive committed app source');await add(source);
    const binary=assets.find(a=>a.name===config.package.name);if(!binary)throw Error('Managed download or launcher installer is missing');
    const metadata={appId:config.appId,version:config.version,minimumLauncher:config.package.minimumLauncher,platform:'win32',arch:'x64',packageType:config.package.type,...(config.package.executable?{executable:config.package.executable}:{}),size:binary.size,unpackedSize:config.unpackedDirectory?await sum(path.join(root,config.unpackedDirectory)):config.package.unpackedSize,sha256:binary.sha256,url:url(binary.name),repository:config.repository,notes:config.notes};
    if(config.appId==='launcher'&&config.unpackedDirectory)metadata.runtimeIntegrity={asarSHA256:await sha(path.join(root,config.unpackedDirectory,'resources/app.asar')),updaterSHA256:await sha(path.join(root,config.unpackedDirectory,'resources/updater/BlueCloudUpdate.exe'))};
    const meta=path.join(out,'app-release.json');await writeFile(meta,JSON.stringify(metadata,null,2)+'\n');await add(meta);
    const checksums=path.join(out,'SHA256SUMS.txt');await writeFile(checksums,assets.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');await add(checksums);
    const commit=git(['rev-parse','HEAD']).stdout.trim();await writeFile(manifestPath,JSON.stringify({tag,version:config.version,repository:config.repository,commit,assets},null,2)+'\n');
    console.log(`Prepared ${config.repository} ${tag}`);return;
  }
  if(mode!=='publish')throw Error('Use migrate, prepare or publish');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.repository!==config.repository || manifest.commit!==git(['rev-parse','HEAD']).stdout.trim())throw Error('Manifest source commit or repository mismatch');
  let token=process.env.GITHUB_TOKEN;
  if(!token){const c=git(['credential','fill'],{input:'protocol=https\nhost=github.com\n\n'});if(c.status)throw Error('GitHub authentication unavailable');const values=Object.fromEntries(c.stdout.trim().split('\n').map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/\r$/,'')];}));token=values.password;}
  if(!token)throw Error('GitHub authentication unavailable');
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const api=async(endpoint,options={})=>{const r=await fetch(endpoint,{...options,headers:{...headers,...options.headers}});if(!r.ok)throw Error(`GitHub ${r.status}: ${(await r.text()).slice(0,200)}`);return r.status===204?null:r.json();};
  const base=`https://api.github.com/repos/${config.repository}`;
  let release=(await api(base+'/releases?per_page=100')).find(r=>r.tag_name===tag);
  if(release && !release.draft)throw Error('Published release assets are immutable; choose a new version');
  if(!release){const body=await readFile(path.join(root,'RELEASE-NOTES.md'),'utf8');release=await api(base+'/releases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tag_name:tag,target_commitish:manifest.commit,name:config.title,draft:true,prerelease:true,body})});}
  if(release.target_commitish!==manifest.commit)throw Error('Draft targets different source');
  const matches=(a,b)=>a.state==='uploaded'&&a.size===b.size&&(!a.digest||a.digest===`sha256:${b.sha256}`);
  for(const asset of manifest.assets){
    if(await sha(asset.file)!==asset.sha256)throw Error('Local file changed: '+asset.name);
    const existing=release.assets.find(a=>a.name===asset.name);
    if(existing){if(matches(existing,asset))continue;if(existing.state==='starter')await api(`${base}/releases/assets/${existing.id}`,{method:'DELETE'});else throw Error('Different draft asset already exists');}
    const uploaded=await api(release.upload_url.split('{')[0]+'?name='+encodeURIComponent(asset.name),{method:'POST',headers:{'content-type':'application/octet-stream','content-length':String(asset.size)},body:createReadStream(asset.file),duplex:'half'});
    if(!matches(uploaded,asset))throw Error('Server integrity check failed: '+asset.name);console.log('Verified '+asset.name);
  }
  release=await api(`${base}/releases/${release.id}`);
  for(const a of manifest.assets)if(!release.assets.some(r=>r.name===a.name&&matches(r,a)))throw Error('Incomplete release');
  release=await api(`${base}/releases/${release.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({draft:false})});
  console.log('Published '+release.html_url);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
export {main};
