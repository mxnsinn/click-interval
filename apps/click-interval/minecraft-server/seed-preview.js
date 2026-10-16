'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const os = require('node:os');
const readline = require('node:readline');

const MAX_CHUNKS = 12000;
const MAX_SAMPLES = 4096;
const WORLD_LIMIT = 30000000;
const BIOME_COLORS = Object.freeze({
 ocean:'#3578b5',deep_ocean:'#22568f',cold_ocean:'#3976a0',deep_cold_ocean:'#255782',
 frozen_ocean:'#9bbed2',deep_frozen_ocean:'#6992b4',lukewarm_ocean:'#3e98b2',deep_lukewarm_ocean:'#317a9a',warm_ocean:'#4aafbb',
 river:'#438dd0',frozen_river:'#a3c3d8',beach:'#d5c589',snowy_beach:'#d7d7c3',stony_shore:'#969d92',
 plains:'#88ac54',sunflower_plains:'#a3b456',forest:'#46763e',flower_forest:'#669347',birch_forest:'#6d9a4f',
 old_growth_birch_forest:'#799f51',dark_forest:'#345632',pale_garden:'#8c9b80',jungle:'#387935',sparse_jungle:'#559b3e',bamboo_jungle:'#588d35',
 taiga:'#4e7c68',old_growth_pine_taiga:'#637d53',old_growth_spruce_taiga:'#4c7458',snowy_taiga:'#b5cabb',
 savanna:'#b1aa57',savanna_plateau:'#a2964b',windswept_savanna:'#ad9f65',desert:'#d8c485',
 badlands:'#b67345',eroded_badlands:'#c4814d',wooded_badlands:'#9b7b45',swamp:'#5e7950',mangrove_swamp:'#50704a',
 meadow:'#90b462',cherry_grove:'#c6a0af',grove:'#a8beb0',snowy_plains:'#dce5de',ice_spikes:'#c4dbdc',
 snowy_slopes:'#d6ded7',frozen_peaks:'#dfe7e9',jagged_peaks:'#a9b6ac',stony_peaks:'#929d88',
 windswept_hills:'#879981',windswept_gravelly_hills:'#999e92',windswept_forest:'#607d59',mushroom_fields:'#907aa0',
 dripstone_caves:'#938276',lush_caves:'#5f8454',deep_dark:'#344c50',sulfur_caves:'#a0aa50',
 nether_wastes:'#943f3b',soul_sand_valley:'#725954',crimson_forest:'#a02d49',warped_forest:'#287c7a',basalt_deltas:'#625c65',
 the_end:'#d6d199',end_highlands:'#c9ca91',end_midlands:'#bfc18a',small_end_islands:'#939a71',end_barrens:'#80855e',the_void:'#202124'
});

function decodeNbt(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length > (options.maxUncompressedBytes || 16 * 1024 * 1024)) throw Error('NBT size limit');
  let offset = 0, nodes = 0;
  const take = size => { if (!Number.isSafeInteger(size) || size < 0 || offset + size > buffer.length) throw Error('Truncated NBT'); const at=offset; offset+=size; return at; };
  const u8 = () => buffer.readUInt8(take(1));
  const i32 = () => buffer.readInt32BE(take(4));
  const string = () => { const count=buffer.readUInt16BE(take(2)); return buffer.toString('utf8',take(count),offset); };
  const count = () => { const value=i32(); if(value < 0 || value > 2000000)throw Error('NBT collection limit'); return value; };
  function value(type, depth) {
    if(++nodes > 250000 || depth > 64)throw Error('NBT complexity limit');
    switch(type) {
      case 1:return buffer.readInt8(take(1));
      case 2:return buffer.readInt16BE(take(2));
      case 3:return i32();
      case 4:return buffer.readBigInt64BE(take(8)).toString();
      case 5:return buffer.readFloatBE(take(4));
      case 6:return buffer.readDoubleBE(take(8));
      case 7:{const size=count();return buffer.subarray(take(size),offset);}
      case 8:return string();
      case 9:{const subtype=u8(),size=count();if(subtype===0&&size!==0)throw Error('Invalid NBT list');const result=[];for(let i=0;i<size;i++)result.push(value(subtype,depth+1));return result;}
      case 10:{const result=Object.create(null);let subtype;while((subtype=u8())!==0){const name=string();if(Object.hasOwn(result,name))throw Error('Duplicate NBT key');result[name]=value(subtype,depth+1);}return result;}
      case 11:{const size=count(),result=[];for(let i=0;i<size;i++)result.push(i32());return result;}
      case 12:{const size=count(),result=[];for(let i=0;i<size;i++)result.push(buffer.readBigInt64BE(take(8)).toString());return result;}
      default:throw Error('Unsupported NBT tag');
    }
  }
  const type=u8(); if(type!==10)throw Error('NBT root must be a compound');string();const result=value(type,0);if(offset!==buffer.length)throw Error('Trailing NBT bytes');return result;
}

async function readNbtFile(file, options={}) {
  const stat=await fsp.stat(file);if(!stat.isFile()||stat.size>(options.maxCompressedBytes||4*1024*1024))throw Error('NBT file size limit');
  const compressed=await fsp.readFile(file);if(compressed.length>(options.maxCompressedBytes||4*1024*1024))throw Error('NBT file grew');
  const data=compressed[0]===0x1f&&compressed[1]===0x8b ? zlib.gunzipSync(compressed,{maxOutputLength:options.maxUncompressedBytes||16*1024*1024}) : compressed;
  return decodeNbt(data,options);
}

const WORLDGEN_RESOURCE = /(?:^|\/)data\/[^/]+\/(?:worldgen\/(?:biome|noise|noise_settings|density_function|multi_noise_biome_source_parameter_list)|dimension|dimension_type)\//;
async function packChangesBiomes(folder) {
  let visited=0;
  async function scan(current,relative='') {
    for(const entry of await fsp.readdir(current,{withFileTypes:true})) {
      if(++visited>10000||entry.isSymbolicLink())return true;
      const name=relative+entry.name;
      if(WORLDGEN_RESOURCE.test(name+'/'))return true;
      if(entry.isDirectory()&&await scan(path.join(current,entry.name),name+'/'))return true;
    }
    return false;
  }
  return scan(folder);
}

async function jarChangesBiomes(file) {
  const handle=await fsp.open(file,'r');
  try {
    const stat=await handle.stat();if(stat.size>256*1024*1024)return true;
    const tail=Buffer.alloc(Math.min(stat.size,65557));await handle.read(tail,0,tail.length,stat.size-tail.length);
    let end=-1;for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){end=i;break;}
    if(end<0)return true;
    const size=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
    if(size>8*1024*1024||offset+size>stat.size)return true;
    const directory=Buffer.alloc(size);await handle.read(directory,0,size,offset);
    let at=0,count=0;
    while(at<directory.length) {
      if(++count>100000||at+46>directory.length||directory.readUInt32LE(at)!==0x02014b50)return true;
      const length=directory.readUInt16LE(at+28),extra=directory.readUInt16LE(at+30),comment=directory.readUInt16LE(at+32);
      if(at+46+length+extra+comment>directory.length)return true;
      const name=directory.toString('utf8',at+46,at+46+length);
      if(WORLDGEN_RESOURCE.test(name))return true;
      at+=46+length+extra+comment;
    }
    return false;
  } finally { await handle.close(); }
}

function parseSeed(value) {
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('Seed precision would be lost');
  const text=String(value??'');if(!/^-?\d{1,20}$/.test(text))throw Error('Invalid seed');const seed=BigInt(text);
  if(seed < -(1n<<63n)||seed >= (1n<<63n))throw Error('Seed outside signed64 range');return seed;
}

const metadataCache = new Map();
async function readWorldMapSeedMetadata(options) {
  const root=path.resolve(options.worldRoot),statParts=[];
  for(const relative of ['level.dat','data/minecraft/world_gen_settings.dat','world_gen_settings.dat']) {
    try{const stat=await fsp.stat(path.join(root,relative));statParts.push([relative,stat.size,stat.mtimeMs,stat.ctimeMs]);}
    catch(error){if(error.code!=='ENOENT')throw error;statParts.push([relative,null]);}
  }
  const key=JSON.stringify([root,options.minecraftVersion,statParts]),existing=metadataCache.get(key);
  if(existing&&Date.now()-existing.time<30000)return existing.promise;
  const promise=readMetadataUncached(options);metadataCache.set(key,{time:Date.now(),promise});
  while(metadataCache.size>8)metadataCache.delete(metadataCache.keys().next().value);
  try{return await promise;}catch(error){metadataCache.delete(key);throw error;}
}

async function readMetadataUncached({worldRoot,minecraftVersion}) {
  const resolved=path.resolve(worldRoot);
  const level=await readNbtFile(path.join(resolved,'level.dat'));
  const data=level.Data||level;
  let generation=data.WorldGenSettings;
  let generationFile='level.dat';
  for(const relative of ['data/minecraft/world_gen_settings.dat','world_gen_settings.dat']) {
    try { generation=await readNbtFile(path.join(resolved,relative));generation=generation.data||generation.Data||generation;generationFile=relative;break; }
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  generation=generation?.WorldGenSettings||generation;
  const seedString=parseSeed(generation?.seed??data.RandomSeed).toString();
  const actualVersion=String(data.Version?.Name||minecraftVersion||'');
  const dimensions=generation?.dimensions||{};
  const generators=Object.create(null);
  for(const dimension of ['minecraft:overworld','minecraft:the_nether','minecraft:the_end']) {
    const generator=dimensions[dimension]?.generator;
    const source=generator?.biome_source;
    const expectedPreset=dimension==='minecraft:overworld'?'minecraft:overworld':dimension==='minecraft:the_nether'?'minecraft:nether':null;
    const validSettings=dimension==='minecraft:overworld'?['minecraft:overworld','minecraft:large_biomes','minecraft:amplified']:dimension==='minecraft:the_nether'?['minecraft:nether']:['minecraft:end'];
    if(generator?.type==='minecraft:noise'&&validSettings.includes(generator.settings)
      &&(dimension==='minecraft:the_end'?source?.type==='minecraft:the_end':source?.type==='minecraft:multi_noise'&&source.preset===expectedPreset))generators[dimension]=generator.settings;
  }
  const enabledPacks=Array.isArray(data.DataPacks?.Enabled)?data.DataPacks.Enabled.map(String):[];
  // Local/data packs may replace even vanilla-named generator registries. Never silently assume parity.
  let customWorldPacks=false;
  for(const name of enabledPacks.filter(name=>name.startsWith('file/'))) {
    const relative=name.slice(5);if(!relative||relative.includes('/')||relative.includes('\\')||relative==='..'){customWorldPacks=true;break;}
    const pack=path.join(resolved,'datapacks',relative);
    try { const stat=await fsp.lstat(pack);if(stat.isSymbolicLink()||(stat.isDirectory()?await packChangesBiomes(pack):await jarChangesBiomes(pack)))customWorldPacks=true; }
    catch { customWorldPacks=true; }
  }
  // The app's world folder is directly under the server root; inspect registry resources read-only.
  const mods=path.join(path.dirname(resolved),'mods');
  try {for(const entry of await fsp.readdir(mods,{withFileTypes:true}))if(entry.name.endsWith('.jar')&&(entry.isSymbolicLink()||!entry.isFile()||await jarChangesBiomes(path.join(mods,entry.name))))customWorldPacks=true;}
  catch(error){if(error.code!=='ENOENT')customWorldPacks=true;}
  const worldToken=crypto.createHash('sha256').update(JSON.stringify([resolved,seedString,actualVersion,dimensions,data.WorldGenSettings?.seed||null])).digest('hex').slice(0,24);
  return {seedString,worldToken,minecraftVersion:actualVersion,generators,seedAvailable:true,previewAvailable:actualVersion==='26.2'&&!customWorldPacks&&Object.keys(generators).length>0,generationFile,reason:customWorldPacks?'custom-data-packs':actualVersion!=='26.2'?'unsupported-version':Object.keys(generators).length?'':'unsupported-generator'};
}

function javaInt(value){return BigInt.asIntN(32,BigInt(value));}
function isSlimeChunk(seed,x,z) {
  if(!Number.isInteger(x)||!Number.isInteger(z)||Math.abs(x)>1875000||Math.abs(z)>1875000)throw Error('Invalid chunk coordinate');
  const a=BigInt(x),b=BigInt(z);
  // Preserve each Java int overflow before widening, especially beyond 46340 chunks.
  let state=(BigInt.asIntN(64,parseSeed(seed)+javaInt(a*a*4987142n)+javaInt(a*5947611n)+javaInt(b*b)*4392871n+javaInt(b*389711n))^987234911n^0x5deece66dn)&((1n<<48n)-1n);
  while(true){state=(state*0x5deece66dn+11n)&((1n<<48n)-1n);const bits=Number(state>>17n),value=bits%10;if(bits-value+9<=2147483647)return value===0;}
}

function getSlimeChunks(metadata,request={}) {
  const base={chunks:[],seedAvailable:Boolean(metadata?.seedAvailable),worldToken:metadata?.worldToken||''};
  if(!metadata?.seedAvailable||request.worldToken!==metadata.worldToken)return {...base,available:false};
  if(request.dimension!=='minecraft:overworld')return {...base,available:true};
  const fields=['minChunkX','maxChunkX','minChunkZ','maxChunkZ'];
  if(fields.some(key=>!Number.isInteger(request[key])||Math.abs(request[key])>1875000))throw Error('Invalid slime viewport');
  const width=request.maxChunkX-request.minChunkX+1,height=request.maxChunkZ-request.minChunkZ+1;
  if(width<=0||height<=0||width*height>MAX_CHUNKS)return {...base,available:false,zoomIn:true};
  const chunks=[];for(let z=request.minChunkZ;z<=request.maxChunkZ;z++)for(let x=request.minChunkX;x<=request.maxChunkX;x++)if(isSlimeChunk(metadata.seedString,x,z))chunks.push({x,z});
  return {...base,chunks,available:true};
}

function normalizeViewport(request) {
  for(const key of ['minX','maxX','minZ','maxZ'])if(!Number.isFinite(request[key])||Math.abs(request[key])>WORLD_LIMIT)throw Error('Invalid seed viewport');
  if(request.maxX<=request.minX||request.maxZ<=request.minZ)throw Error('Empty seed viewport');
  let step=4,x,z,width,height;
  do{x=Math.floor(request.minX/step)*step;z=Math.floor(request.minZ/step)*step;width=Math.ceil((request.maxX-x)/step);height=Math.ceil((request.maxZ-z)/step);if(width*height<=MAX_SAMPLES&&width<=128&&height<=128)break;step*=2;}while(step<=1048576);
  if(step>1048576)throw Error('Seed viewport too large');return{x,z,width,height,step};
}

class SeedPreviewEngine {
  constructor({javaPath,serverRoot,workingRoot}) {this.javaPath=javaPath;this.serverRoot=serverRoot;this.workingRoot=workingRoot;this.child=null;this.ready=null;this.active=null;this.pending=null;this.cache=new Map();this.generation=0;this.idle=null;this.closed=false;}
  async preview(metadata,request={}) {
    if(this.closed)throw Error('Seed preview closed');
    if(!metadata?.previewAvailable||request.worldToken!==metadata.worldToken||!metadata.generators[request.dimension])return{available:false,worldToken:metadata?.worldToken||'',reason:metadata?.reason||'unsupported-generator',cells:[]};
    const viewport=normalizeViewport(request),key=JSON.stringify([metadata.worldToken,request.dimension,viewport]);
    clearTimeout(this.idle);
    if(this.cache.has(key)){const value=this.cache.get(key);this.cache.delete(key);this.cache.set(key,value);this.armIdle();return value;}
    // Keep only the latest queued viewport; never accumulate work while panning.
    if(this.pending)this.pending.resolve({available:false,cancelled:true,cells:[],worldToken:this.pending.metadata.worldToken});
    return new Promise((resolve,reject)=>{this.pending={metadata,request,viewport,key,resolve,reject};this.pump();});
  }
  async start() {
    if(this.ready)return this.ready;
    this.ready=(async()=>{
      await fsp.mkdir(this.workingRoot,{recursive:true});
      const helper=path.join(__dirname,'seed-preview','seed-preview.jar');
      const native=path.join(this.serverRoot,'versions','26.2','server-26.2.jar');
      const jars=[helper,native];
      async function scan(folder){for(const entry of await fsp.readdir(folder,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Linked native library');const file=path.join(folder,entry.name);if(entry.isDirectory())await scan(file);else if(file.endsWith('.jar'))jars.push(file);if(jars.length>300)throw Error('Native classpath limit');}}
      await scan(path.join(this.serverRoot,'libraries'));await fsp.access(helper);await fsp.access(native);
      if(this.closed)throw Error('Seed preview closed');
      const child=spawn(this.javaPath,['-Xms64M','-Xmx384M','-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','-Djava.awt.headless=true','-Dlog4j.configurationFile='+path.join(__dirname,'seed-preview','log4j2.xml'),'-cp',jars.join(path.delimiter),'com.clickinterval.map.preview.SeedPreview'],{cwd:this.workingRoot,windowsHide:true,stdio:['pipe','pipe','ignore']});
      this.child=child;try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
      const lines=readline.createInterface({input:child.stdout});
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{child.kill();reject(Error('Seed preview startup timed out'));},45000);
        child.once('error',error=>{clearTimeout(timeout);reject(error);});
        child.once('exit',()=>{clearTimeout(timeout);reject(Error('Seed preview exited'));});
        const onLine=line=>{if(line==='READY'){clearTimeout(timeout);lines.removeListener('line',onLine);resolve();}};lines.on('line',onLine);
      });
      child.on('exit',()=>{if(this.child===child){this.child=null;this.ready=null;if(this.active){clearTimeout(this.active.timeout);this.active.reject(Error('Seed preview exited'));this.active=null;}if(this.pending){this.pending.resolve({available:false,cancelled:true,cells:[],worldToken:this.pending.metadata.worldToken});this.pending=null;}}});
      lines.on('line',line=>{const active=this.active;if(!active)return;if(line.length>600000){child.kill();return;}try{const result=JSON.parse(line);if(result.error||!Array.isArray(result.biomes)||result.biomes.length!==active.viewport.width*active.viewport.height)throw Error('Invalid native preview response');const cells=result.biomes.map((biome,i)=>({x:active.viewport.x+(i%active.viewport.width)*active.viewport.step,z:active.viewport.z+Math.floor(i/active.viewport.width)*active.viewport.step,size:active.viewport.step,color:BIOME_COLORS[String(biome).replace(/^minecraft:/,'')]||'#73796f',biome}));const response={available:true,worldToken:active.metadata.worldToken,kind:'seed-biomes',sampleY:64,cells,bounds:active.viewport};this.cache.set(active.key,response);while(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);clearTimeout(active.timeout);active.resolve(response);this.active=null;this.pump();}catch(error){clearTimeout(active.timeout);active.reject(error);this.active=null;this.pump();}});
    })();
    try{return await this.ready;}catch(error){this.ready=null;this.child?.kill();this.child=null;throw error;}
  }
  async pump(){if(this.active||!this.pending||this.closed)return;const active=this.pending;this.pending=null;this.active=active;try{await this.start();if(this.closed||this.active!==active)return;const child=this.child;active.timeout=setTimeout(()=>{if(this.active!==active||this.child!==child)return;child.kill();active.reject(Error('Seed preview sampling timed out'));this.active=null;},30000);child.stdin.write(JSON.stringify({seed:active.metadata.seedString,dimension:active.request.dimension,generator:active.metadata.generators[active.request.dimension],...active.viewport})+'\n');}catch(error){if(this.active===active){clearTimeout(active.timeout);active.reject(error);this.active=null;}this.pump();}this.armIdle();}
  armIdle(){clearTimeout(this.idle);this.idle=setTimeout(()=>{if(this.active||this.pending){this.armIdle();return;}this.child?.kill();this.child=null;this.ready=null;},30000);this.idle.unref?.();}
  close(){this.closed=true;clearTimeout(this.idle);if(this.active){clearTimeout(this.active.timeout);this.active.resolve({available:false,cancelled:true,cells:[],worldToken:this.active.metadata.worldToken});this.active=null;}if(this.pending){this.pending.resolve({available:false,cancelled:true,cells:[],worldToken:this.pending.metadata.worldToken});this.pending=null;}const child=this.child;this.child=null;this.ready=null;this.cache.clear();if(!child||child.exitCode!==null)return Promise.resolve();return new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
}

module.exports={decodeNbt,readNbtFile,readWorldMapSeedMetadata,parseSeed,isSlimeChunk,getSlimeChunks,normalizeViewport,SeedPreviewEngine,BIOME_COLORS,packChangesBiomes,jarChangesBiomes};
