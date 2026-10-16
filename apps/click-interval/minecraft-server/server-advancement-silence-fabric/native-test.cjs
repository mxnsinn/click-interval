'use strict';
// Fresh project-only disposable world; no live worlds, client profiles or user input.
const fs=require('node:fs'), path=require('node:path'), net=require('node:net'), crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const project=__dirname, base=path.join(project,'build/native-fixtures');
const cache=path.resolve(project,'../../work/dimension-release-native-teaXUF');
const artifact=path.join(project,'dist/ServerAdvancementSilence-Fabric-1.0.0+mc26.2.jar');
const java='C:/Program Files/Eclipse Adoptium/jdk-25.0.3.9-hotspot/bin/java.exe';
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copyTreeChop=process.argv.includes('--treechop');
const sourceSave='C:/Users/example/AppData/Roaming/.minecraft/saves/TreeChopTest';
function snapshot(directory) {
  plain(directory,true);
  const entries=[];
  function visit(folder) {
    for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const file=path.join(folder,entry.name);
      if(entry.isSymbolicLink()) throw Error('Linked save input refused');
      if(entry.isDirectory()) visit(file);
      else {plain(file);entries.push({path:path.relative(directory,file),bytes:fs.statSync(file).size,sha256:digest(file)});}
    }
  }
  visit(directory);return entries;
}
function plain(file,directory=false) {
  const stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())) throw Error('Non-plain fixture input: '+file);
}
function copy(source,target,directory=false) {
  plain(source,directory);
  if(directory) fs.cpSync(source,target,{recursive:true,errorOnExist:true,force:false,filter:p=>{if(fs.lstatSync(p).isSymbolicLink()) throw Error('Linked fixture input');return true;}});
  else {fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);if(digest(source)!==digest(target)) throw Error('Copy mismatch');}
}
async function freePort() {
  const listener=net.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve)); return port;
}
async function run(root,phase,port) {
  const child=spawn(java,['-Xms256m','-Xmx1536m','-XX:ActiveProcessorCount=2',
    '-Dclickinterval.advancementSilence.selftest=true',`-Dclickinterval.advancementSilence.phase=${phase}`,
    '-jar',path.join(root,'minecraft-server.jar'),'nogui'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let log='',passed=false,stopping=false,timedOut=false;
  function output(chunk) {
    log+=chunk.toString();
    if(!stopping&&log.includes(`ADVANCEMENT_SILENCE_NATIVE_TEST_PASS phase=${phase}`)) {passed=true;stopping=true;child.stdin.write('stop\n');}
  }
  child.stdout.on('data',output);child.stderr.on('data',output);child.stdin.on('error',()=>{});
  const exitCode=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{timedOut=true;child.stdin.write('stop\n');const kill=setTimeout(()=>child.kill(),15000);kill.unref();},120000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);resolve(code);});
  });
  fs.writeFileSync(path.join(root,`native-phase-${phase}.log`),log,{flag:'wx'});
  const result={phase,root,pid:child.pid,port,exitCode,passed:passed&&!timedOut&&exitCode===0,artifactSha256:digest(artifact),liveOrClientChanged:false};
  fs.writeFileSync(path.join(root,`result-${phase}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
  if(!result.passed) throw Error('Native fixture failed: '+root+'\n'+log.slice(-6500));
  return result;
}
(async()=>{
  plain(project,true);plain(cache,true);plain(java);plain(artifact);
  fs.mkdirSync(base,{recursive:true});plain(base,true);
  const root=fs.mkdtempSync(path.join(base,'advancement-'));
  if(path.dirname(root)!==base) throw Error('Fixture escaped project');
  fs.mkdirSync(path.join(root,'mods'));
  const before=copyTreeChop?snapshot(sourceSave):null;
  if(copyTreeChop) {
    copy(sourceSave,path.join(root,'AdvancementSilenceTest'),true);
    fs.writeFileSync(path.join(root,'source-before.json'),JSON.stringify(before,null,2)+'\n',{flag:'wx'});
    if(JSON.stringify(snapshot(path.join(root,'AdvancementSilenceTest')))!==JSON.stringify(before)) throw Error('Copied test save mismatch');
  } else fs.mkdirSync(path.join(root,'AdvancementSilenceTest'));
  copy(artifact,path.join(root,'mods/ServerAdvancementSilence.jar'));
  copy(path.join(cache,'mods/fabric-api-0.161.0+26.2.jar'),path.join(root,'mods/fabric-api.jar'));
  for(const folder of ['libraries','versions']) copy(path.join(cache,folder),path.join(root,folder),true);
  copy(path.join(cache,'minecraft-server.jar'),path.join(root,'minecraft-server.jar'));
  copy(path.join(cache,'eula.txt'),path.join(root,'eula.txt'));
  fs.writeFileSync(path.join(root,'AdvancementSilenceTest/.advancement-silence-disposable-test'),'Advancement Silence disposable native fixture v1\n',{flag:'wx'});
  const port=await freePort();
  fs.writeFileSync(path.join(root,'server.properties'),[
    'server-ip=127.0.0.1',`server-port=${port}`,'level-name=AdvancementSilenceTest','online-mode=false','enforce-secure-profile=false',
    'white-list=true','enforce-whitelist=true','max-players=1','enable-rcon=false','enable-query=false','management-server-enabled=false',
    'enable-jmx-monitoring=false','view-distance=2','simulation-distance=2','spawn-protection=0','pause-when-empty-seconds=0',
    'level-type=minecraft:flat','generate-structures=false','generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains","features":false,"lakes":false}',
    'gamemode=survival','difficulty=peaceful'
  ].join('\n')+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(root,'whitelist.json'),'[]\n',{flag:'wx'});
  const results=[];
  try {
    for(const phase of [1,2]) results.push(await run(root,phase,port));
  } finally {
    if(copyTreeChop) {
      const after=snapshot(sourceSave), unchanged=JSON.stringify(before)===JSON.stringify(after);
      fs.writeFileSync(path.join(root,'source-after.json'),JSON.stringify(after,null,2)+'\n',{flag:'wx'});
      fs.writeFileSync(path.join(root,'source-integrity.json'),JSON.stringify({source:sourceSave,sourceUnchanged:unchanged,files:before.length,bytes:before.reduce((sum,file)=>sum+file.bytes,0)},null,2)+'\n',{flag:'wx'});
      if(!unchanged) throw Error('Original test save changed during fixture execution');
    }
  }
  console.log(JSON.stringify({passed:true,root,copiedTreeChopTest:copyTreeChop,results}));
})().catch(error=>{console.error(error);process.exitCode=1;});
