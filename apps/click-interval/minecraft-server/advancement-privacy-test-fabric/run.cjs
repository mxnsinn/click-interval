'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),os=require('node:os');
const {spawn}=require('node:child_process');
const project=__dirname,base=path.join(project,'build/native-fixtures');
const cache=path.resolve(project,'../../work/dimension-release-native-teaXUF');
const live='C:/Users/example/AppData/Roaming/click-interval-beta/minecraft-servers/SMP';
const deployed=path.join(live,'mods/ServerAdvancementSilence-Fabric.jar');
const settings=path.join(live,'SMP/server-advancement-silence.json');
const pin='7f37efa869865e4a224edb0c8ba34a0d8298b8a9599c048cfd389a1a8a1260b1';
const companion=path.join(project,'build/libs/AdvancementPrivacyTest-DO-NOT-DEPLOY-1.0.0-test.jar');
const java='C:/Program Files/Eclipse Adoptium/jdk-25.0.3.9-hotspot/bin/java.exe';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function plain(file,directory=false){const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()))throw Error('Nonordinary input: '+file);}
function copy(source,target,directory=false){plain(source,directory);if(directory)fs.cpSync(source,target,{recursive:true,force:false,errorOnExist:true,filter:p=>{if(fs.lstatSync(p).isSymbolicLink())throw Error('Linked runtime input');return true;}});else{fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);if(hash(source)!==hash(target))throw Error('Copy hash mismatch');}}
async function port(){const s=net.createServer();await new Promise((res,rej)=>{s.once('error',rej);s.listen(0,'127.0.0.1',res)});const p=s.address().port;await new Promise(res=>s.close(res));return p;}
(async()=>{
 plain(project,true);plain(deployed);plain(settings);plain(companion);plain(cache,true);
 const before={jar:hash(deployed),settings:hash(settings)};if(before.jar!==pin)throw Error('Deployed jar does not match pinned production release');
 fs.mkdirSync(base,{recursive:true});plain(base,true);const root=fs.mkdtempSync(path.join(base,'privacy-'));
 if(path.dirname(root)!==base)throw Error('Fixture escaped project');
 const world=path.join(root,'PrivateAdvancementTest');fs.mkdirSync(world);fs.mkdirSync(path.join(root,'mods'));
 copy(deployed,path.join(root,'mods/ServerAdvancementSilence-Fabric.jar'));copy(settings,path.join(world,'server-advancement-silence.json'));
 copy(companion,path.join(root,'mods/AdvancementPrivacyTest.jar'));copy(path.join(cache,'mods/fabric-api-0.161.0+26.2.jar'),path.join(root,'mods/fabric-api.jar'));
 for(const name of ['libraries','versions'])copy(path.join(cache,name),path.join(root,name),true);
 for(const name of ['minecraft-server.jar','eula.txt'])copy(path.join(cache,name),path.join(root,name));
 fs.writeFileSync(path.join(world,'.privacy-disposable-test'),'Private advancement native test v1\n',{flag:'wx'});
 const tcp=await port();
 fs.writeFileSync(path.join(root,'server.properties'),[
  'server-ip=127.0.0.1',`server-port=${tcp}`,'level-name=PrivateAdvancementTest','online-mode=false','enforce-secure-profile=false',
  'white-list=true','enforce-whitelist=true','max-players=1','enable-rcon=false','enable-query=false','management-server-enabled=false',
  'enable-jmx-monitoring=false','view-distance=2','simulation-distance=2','spawn-protection=0','pause-when-empty-seconds=0',
  'level-type=minecraft:flat','generate-structures=false','generator-settings={"layers":[{"block":"minecraft:air","height":1}],"biome":"minecraft:plains","features":false,"lakes":false}',
  'gamemode=survival','difficulty=peaceful'
 ].join('\n')+'\n',{flag:'wx'});fs.writeFileSync(path.join(root,'whitelist.json'),'[]\n',{flag:'wx'});
 const args=['-Xms128m','-Xmx1024m','-XX:ActiveProcessorCount=2','-Dclickinterval.privacy.fixture=true','-jar',path.join(root,'minecraft-server.jar'),'nogui'];
 const child=spawn(java,args,{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let priority;try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);priority=os.getPriority(child.pid);}catch(e){priority=String(e.message);}
 let log='',passed=false,stopping=false,timedOut=false;
 function output(data){log+=data.toString();if(!stopping&&log.includes('ADVANCEMENT_PRIVACY_NATIVE_PASS')){passed=true;stopping=true;child.stdin.write('stop\n');}}
 child.stdout.on('data',output);child.stderr.on('data',output);child.stdin.on('error',()=>{});
 const exitCode=await new Promise((res,rej)=>{const timer=setTimeout(()=>{timedOut=true;child.stdin.write('stop\n');const force=setTimeout(()=>child.kill(),15000);force.unref();},120000);child.once('error',e=>{clearTimeout(timer);rej(e)});child.once('exit',c=>{clearTimeout(timer);res(c)});});
 const logFile=path.join(root,'native.log');fs.writeFileSync(logFile,log,{flag:'wx'});
 const after={jar:hash(deployed),settings:hash(settings)};const unchanged=JSON.stringify(before)===JSON.stringify(after);
 const report={passed:passed&&exitCode===0&&!timedOut&&unchanged,root,pid:child.pid,exitCode,processExited:true,bind:'127.0.0.1',port:tcp,heapMb:1024,cpuWorkers:2,priority,
  productionJarSha256:pin,copiedJarSha256:hash(path.join(root,'mods/ServerAdvancementSilence-Fabric.jar')),companionSha256:hash(companion),copiedSettingsBeforeSha256:before.settings,
  productionBefore:before,productionAfter:after,productionFilesUnchanged:unchanged,logFile,logSha256:hash(logFile),resultFile:path.join(world,'privacy-test-result.json'),liveServerOrClientChanged:false};
 if(fs.existsSync(report.resultFile))report.nativeResults=JSON.parse(fs.readFileSync(report.resultFile,'utf8'));
 fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report));if(!report.passed)throw Error('Privacy fixture failed\n'+log.slice(-6000));
})().catch(error=>{console.error(error);process.exitCode=1;});
