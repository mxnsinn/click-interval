'use strict';
// New disposable worlds only. Never reads or writes live worlds, client profiles, or game saves.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const project = __dirname;
const cache = path.resolve(project, '../../work/dimension-release-native-teaXUF');
const java = 'C:/Program Files/Eclipse Adoptium/jdk-25.0.3.9-hotspot/bin/java.exe';
const artifact = path.join(project, 'dist/LobbyPreviewGuard-Fabric-1.1.0+mc26.2.jar');
const base = path.join(project, 'build/native-fixtures');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function plain(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw Error('Non-plain fixture input: ' + file);
  return file;
}
function copy(source, target, directory = false) {
  plain(source, directory);
  if (directory) fs.cpSync(source, target, {recursive:true,errorOnExist:true,force:false,filter: p => {
    if (fs.lstatSync(p).isSymbolicLink()) throw Error('Linked fixture input refused'); return true;
  }});
  else { fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL); if (digest(source)!==digest(target)) throw Error('Fixture copy mismatch'); }
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
async function fixture(kind) {
  const fixtureRoot = fs.mkdtempSync(path.join(base, kind+'-'));
  if (path.dirname(fixtureRoot) !== base) throw Error('Fixture escaped project');
  const isHolding = kind.startsWith('holding');
  const root = isHolding ? path.join(fixtureRoot,'.click-interval-seamless-restart/holding-fabric') : fixtureRoot;
  if(isHolding) fs.mkdirSync(root,{recursive:true});
  const name = isHolding ? 'HoldingLobby' : kind==='legacy' ? 'MxnsinnLobbyPreview' : kind==='candidate' ? 'LobbyCandidate-01' : kind==='negative' ? 'LobbyCandidate-02' : 'LobbyCandidate-03';
  const world = path.join(root,name);
  fs.mkdirSync(world); fs.mkdirSync(path.join(root,'mods'));
  copy(artifact,path.join(root,'mods/LobbyPreviewGuard.jar'));
  copy(path.join(cache,'mods/fabric-api-0.161.0+26.2.jar'),path.join(root,'mods/fabric-api.jar'));
  for(const folder of ['libraries','versions']) copy(path.join(cache,folder),path.join(root,folder),true);
  copy(path.join(cache,'minecraft-server.jar'),path.join(root,'minecraft-server.jar'));
  copy(path.join(cache,'eula.txt'),path.join(root,'eula.txt'));
  fs.writeFileSync(path.join(world,'.lobby-guard-disposable-test'),'Lobby Guard disposable native fixture v1\n',{flag:'wx'});
  if(kind==='legacy') fs.writeFileSync(path.join(world,'.mxnsinn-lobby-preview'),'MXNSINN Lobby Preview v1\n',{flag:'wx'});
  else {
    fs.writeFileSync(path.join(world,isHolding?'.clickinterval-holding-lobby':'.clickinterval-lobby-candidate'),`Click Interval ${isHolding?'holding lobby':'lobby candidate'} v1\nworld=${name}\n`,{flag:'wx'});
    fs.writeFileSync(path.join(world,'.mxnsinn-lobby-settings.json'),JSON.stringify({version:1,world:kind==='invalid'||kind==='holding-invalid'?'WrongWorld':name,
      spawn:{x:103.5,y:kind==='negative'?-23:85,z:-210.5,yaw:90,pitch:5},bounds:{minX:32,maxX:200,minY:kind==='negative'?-63:60,maxY:150,minZ:-300,maxZ:-100}})+'\n',{flag:'wx'});
  }
  const port = await freePort();
  fs.writeFileSync(path.join(root,'server.properties'),[
    'server-ip=127.0.0.1',`server-port=${port}`,`level-name=${name}`,'online-mode=false','enforce-secure-profile=false',
    'white-list=true','enforce-whitelist=true','max-players=1','enable-rcon=false','enable-query=false','management-server-enabled=false',
    'enable-jmx-monitoring=false','view-distance=2','simulation-distance=2','spawn-protection=0','pause-when-empty-seconds=0',
    'level-type=minecraft:flat','generate-structures=false','generator-settings={"layers":[{"block":"minecraft:air","height":1}],"biome":"minecraft:plains","features":false,"lakes":false}',
    'gamemode=survival','difficulty=normal'
  ].join('\n')+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(root,'whitelist.json'),'[]\n',{flag:'wx'});
  const flag = kind==='invalid'?'mxnsinn.lobby.selftest.inactive':'mxnsinn.lobby.selftest';
  const args = ['-Xms256m','-Xmx1536m','-XX:ActiveProcessorCount=2',`-D${flag}=${kind==='holding-unsafe-spawn'?'false':'true'}`,'-jar',path.join(root,'minecraft-server.jar'),'nogui'];
  const child = spawn(java,args,{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const refusing = kind==='holding-invalid'||kind==='holding-unsafe-spawn';
  const expected = refusing?'HOLDING_LOBBY_UNSAFE':kind==='invalid'?'LOBBY_PREVIEW_INACTIVE_NATIVE_TEST_PASS':'LOBBY_PREVIEW_NATIVE_TEST_PASS';
  let log='',passed=false,stopping=false,timedOut=false;
  function output(chunk) {
    log+=chunk.toString();
    if(!stopping&&log.includes(expected)) {passed=true;stopping=true;child.stdin.write('stop\n');}
  }
  child.stdout.on('data',output);child.stderr.on('data',output);
  child.stdin.on('error',()=>{});
  const code = await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{timedOut=true;child.stdin.write('stop\n');
      const killTimer=setTimeout(()=>child.kill(),15000);killTimer.unref();},120000);
    child.once('error',e=>{clearTimeout(timer);reject(e)});
    child.once('exit',code=>{clearTimeout(timer);resolve(code)});
  });
  fs.writeFileSync(path.join(root,'native-test.log'),log,{flag:'wx'});
  const result={kind,root,pid:child.pid,port,exitCode:code,
    passed:passed&&!timedOut&&(refusing?!log.includes('[LobbyGuard] Holding lobby active:'):code===0),
    artifactSha256:digest(artifact),liveOrClientChanged:false};
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
  if(!result.passed) throw Error('Native fixture failed: '+root+'\n'+log.slice(-4000));
  return result;
}
(async()=>{
  plain(project,true);plain(cache,true);plain(java);plain(artifact);
  fs.mkdirSync(base,{recursive:true});plain(base,true);
  const results=[];
  const cases = process.argv[2] ? [process.argv[2]] : ['legacy','candidate','negative','invalid','holding','holding-invalid','holding-unsafe-spawn'];
  if(cases.some(kind=>!['legacy','candidate','negative','invalid','holding','holding-invalid','holding-unsafe-spawn'].includes(kind))) throw Error('Unknown native fixture');
  for(const kind of cases) results.push(await fixture(kind));
  console.log(JSON.stringify({passed:true,results:results.map(r=>r.root)}));
})().catch(error=>{console.error(error);process.exitCode=1});
