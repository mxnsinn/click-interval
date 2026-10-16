'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  BoundedChunkQueue,
  BoundedTextBuffer,
  mapWithConcurrency,
  measureDirectoryBounded,
  planMinecraftStartupResources,
  readFileEdges,
  readFileTailUtf8,
  safeJavaMemoryMb
} = require('./minecraft-server/performance-safety');

(async () => {
  const textBuffer = new BoundedTextBuffer(10_000);
  for (let index = 0; index < 100_000; index += 1) textBuffer.append(String(index % 10));
  assert.equal(textBuffer.length, 10_000, 'log buffer must retain only its configured character budget');
  assert.ok(textBuffer.chunks.length < 32, 'tiny stream chunks must be coalesced instead of creating a huge array');
  assert.equal(textBuffer.toString(), '0123456789'.repeat(1000), 'bounded log buffer must retain the newest text');
  assert.equal(textBuffer.drain().length, 10_000);
  assert.equal(textBuffer.length, 0, 'draining a live-log batch must release its retained memory');

  const chunkQueue = new BoundedChunkQueue(100, 4);
  chunkQueue.append('a'.repeat(60), { stream: 'stdout' });
  assert.equal(chunkQueue.append('b'.repeat(60), { stream: 'stderr' }), 20,
    'parser ingress must discard old text once its hard character budget is full');
  assert.equal(chunkQueue.length, 100);
  const firstDrain = chunkQueue.drain(25);
  assert.equal(firstDrain.map((entry) => entry.text).join(''), 'a'.repeat(25),
    'parser ingress must drain in order within a per-turn budget');
  assert.equal(chunkQueue.length, 75);
  assert.equal(chunkQueue.retainLatest(30), 45);
  assert.equal(chunkQueue.drain(30).map((entry) => entry.text).join(''), 'b'.repeat(30),
    'overflow handling must retain the newest process output');

  assert.equal(safeJavaMemoryMb(131_072, 65_536, 65_536), 32_768,
    'a high-memory desktop must still have a sane absolute JVM ceiling');
  assert.ok(safeJavaMemoryMb(32_768, 16_384, 16_384) <= Math.floor(16_384 * 0.7),
    'JVM memory must not exceed 70% of physical RAM');
  assert.ok(safeJavaMemoryMb(8192, 16_384, 3072) <= 2048,
    'JVM memory must respect current free memory and preserve an OS reserve');
  assert.equal(safeJavaMemoryMb(256, 8192, 8192), 512,
    'the safety calculation must retain Minecraft\'s minimum supported allocation');
  assert.equal(safeJavaMemoryMb(2048, 8192, 0), 0,
    'an unknown or exhausted free-memory reading must never be treated as all memory being free');
  assert.equal(safeJavaMemoryMb(2048, 8192, 1800), 0,
    'startup must be refused when a 512 MB heap would consume the Windows safety reserve');

  const antiXrayPlan = planMinecraftStartupResources({
    memoryMb: 2048,
    viewDistance: 25,
    simulationDistance: 10
  }, {
    fabricAntiXrayEnabled: true,
    totalMemoryMb: 131_072,
    freeMemoryMb: 96_000
  });
  assert.equal(antiXrayPlan.config.memoryMb, 2048,
    'the safety check must not silently change the owner\'s memory setting');
  assert.equal(antiXrayPlan.config.viewDistance, 25,
    'the safety check must preserve high-quality server render distance');
  assert.equal(antiXrayPlan.config.simulationDistance, 10,
    'the safety check must preserve the owner\'s simulation distance');
  assert.equal(antiXrayPlan.requiredMemoryMb, 4096,
    'the bounded packet Anti-Xray provider must fit within the supported 4 GB floor');
  assert.equal(antiXrayPlan.recommendedMemoryMb, 6144,
    'a 25-chunk packet Anti-Xray server should recommend 6 GB for exploration headroom');
  assert.equal(antiXrayPlan.canStart, false,
    'the crash-prone 2 GB heap must be rejected without rewriting distance settings');
  const provisionedAntiXrayPlan = planMinecraftStartupResources({
    memoryMb: 4096,
    viewDistance: 25,
    simulationDistance: 10
  }, {
    fabricAntiXrayEnabled: true,
    totalMemoryMb: 131_072,
    freeMemoryMb: 96_000
  });
  assert.equal(provisionedAntiXrayPlan.canStart, true,
    '4 GB should remain available as the lower test target without reducing view distance');
  const starvedAntiXrayPlan = planMinecraftStartupResources({ memoryMb: 2048 }, {
    fabricAntiXrayEnabled: true,
    totalMemoryMb: 8192,
    freeMemoryMb: 3072
  });
  assert.equal(starvedAntiXrayPlan.canStart, false,
    'startup must be refused when the anti-Xray minimum heap cannot be allocated safely');

  let active = 0;
  let maximumActive = 0;
  const mapped = await mapWithConcurrency(Array.from({ length: 80 }, (_, index) => index), 4, async index => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setImmediate(resolve));
    active -= 1;
    return index * 2;
  });
  assert.equal(maximumActive, 4, 'bounded mapper must enforce its concurrency limit');
  assert.equal(mapped[79], 158, 'bounded mapper must preserve input order');

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'server-manager-perf-'));
  try {
    const small = path.join(temporaryRoot, 'small');
    await fs.mkdir(path.join(small, 'nested'), { recursive: true });
    await fs.writeFile(path.join(small, 'a.bin'), Buffer.alloc(123));
    await fs.writeFile(path.join(small, 'nested', 'b.bin'), Buffer.alloc(456));
    const exact = await measureDirectoryBounded(small, { maxEntries: 100, maxDurationMs: 5000, concurrency: 2 });
    assert.equal(exact.bytes, 579, 'bounded directory scan must remain exact for normal server folders');
    assert.equal(exact.truncated, false);

    const large = path.join(temporaryRoot, 'large');
    await fs.mkdir(large, { recursive: true });
    await Promise.all(Array.from({ length: 200 }, (_, index) =>
      fs.writeFile(path.join(large, `${index}.bin`), Buffer.alloc(32))));
    const bounded = await measureDirectoryBounded(large, { maxEntries: 25, maxDurationMs: 5000, concurrency: 3 });
    assert.equal(bounded.entriesVisited, 25, 'directory scan must stop at its hard entry budget');
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.bytes <= 25 * 32);

    const logFile = path.join(temporaryRoot, 'large.log');
    const logLines = Array.from({ length: 2000 }, (_, index) => `line-${String(index).padStart(4, '0')}`).join('\n');
    await fs.writeFile(logFile, logLines);
    const tail = await readFileTailUtf8(logFile, 1024);
    assert.ok(Buffer.byteLength(tail) <= 1024, 'history import must never read an entire unbounded log');
    assert.match(tail, /line-1999$/, 'history import must retain the newest complete log records');

    const edgeFile = path.join(temporaryRoot, 'large.jar');
    await fs.writeFile(edgeFile, Buffer.concat([Buffer.alloc(2048, 1), Buffer.alloc(2048, 2)]));
    const edges = await readFileEdges(edgeFile, 128, 8192);
    assert.equal(edges.length, 256, 'large JAR inspection must retain only bounded head/tail segments');
    assert.ok(edges.subarray(0, 128).every(byte => byte === 1));
    assert.ok(edges.subarray(128).every(byte => byte === 2));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  const mainSource = await fs.readFile(path.join(__dirname, 'minecraft-server', 'main.js'), 'utf8');
  const uiSource = await fs.readFile(path.join(__dirname, 'minecraft-server-ui.js'), 'utf8');
  const rendererSource = await fs.readFile(path.join(__dirname, 'minecraft-server', 'renderer', 'renderer.js'), 'utf8');
  const safetySource = await fs.readFile(path.join(__dirname, 'minecraft-server', 'performance-safety.js'), 'utf8');
  assert.match(mainSource, /MAX_MINECRAFT_STATUS_BYTES/, 'Minecraft status replies must have a hard byte cap');
  assert.match(mainSource, /receivedBytes > MAX_MINECRAFT_STATUS_BYTES/, 'oversized status replies must be rejected before concatenation');
  assert.match(mainSource, /STATUS_RUNNING_TTL_MS/, 'full status builds must be cached while the server runs');
  assert.match(mainSource, /MAX_TIMED_CACHE_ENTRIES/, 'the timed cache must have a cardinality limit');
  assert.match(mainSource, /serverLogIpcTimer = setTimeout\(flushServerLogIpc/, 'server log IPC must be batched');
  assert.match(mainSource, /MAX_SERVER_OUTPUT_PENDING_CHARS = 256 \* 1024/,
    'server stdout and stderr parsing must have a fixed ingress budget');
  assert.match(mainSource, /stream\?\.pause\?\.\(\)/,
    'server process pipes must apply backpressure at the parser high-water mark');
  assert.match(mainSource, /serverOutputIngress\.retainLatest\(SERVER_OUTPUT_FINAL_BUDGET_CHARS\)/,
    'shutdown parsing must keep only a bounded newest output tail');
  assert.match(mainSource, /if \(effectiveMemoryMb < 512\)/,
    'server startup must report and refuse critically low free memory');
  assert.match(mainSource, /PLAYIT_LOG_HYDRATION_ENTRY_LIMIT/,
    'Playit log discovery must have a bounded directory-entry budget');
  assert.match(mainSource, /PLAYIT_LOG_HYDRATION_TOTAL_BYTES/,
    'Playit log hydration must have a total byte budget');
  assert.match(mainSource, /await assertConfiguredServerPortAvailable\(config\)/,
    'the configured bind and port must be admitted immediately before Java spawn');
  assert.match(mainSource, /stat\.size > MAX_PLAYIT_METADATA_BYTES/,
    'Playit metadata reads must have a hard file-size limit');
  assert.match(mainSource, /stat\.size > MAX_PAPER_CONFIG_BYTES/,
    'Paper configuration edits must reject oversized files instead of reading or replacing them');
  assert.match(mainSource, /PRIORITY_NORMAL/, 'the Java child must retain normal scheduling priority');
  assert.doesNotMatch(mainSource, /PRIORITY_BELOW_NORMAL/,
    'the latency-sensitive Minecraft server must never be demoted below the game client');
  assert.match(mainSource, /Fabric Anti-Xray needs at least/,
    'unsafe Fabric Anti-Xray heap settings must be rejected before Java starts');
  assert.match(mainSource,
    /const args = await buildServerJavaArgs\([\s\S]*?finalEffectiveMemoryMb[\s\S]*?finalEffectiveMemoryMb < startupResourcePlan\.requiredMemoryMb[\s\S]*?launchPersistentProcess\(/,
    'the final JVM heap selected after the fresh free-memory sample must satisfy the Anti-Xray floor before spawn');
  assert.match(mainSource, /readFileTailUtf8\(file, HISTORY_LOG_TAIL_BYTES\)/, 'empty-history recovery must read bounded log tails');
  assert.match(mainSource, /readFileEdges\(jarPath/, 'server JAR version checks must not read a full large JAR into memory');
  assert.match(mainSource, /queuePlayerHistoryEvent\(event\.name, 'joined'\)/, 'join/leave history writes must be batched');
  assert.match(mainSource, /restoreFailedPlayerHistoryBatch\(batch, pendingPlayerHistoryEvents\)/,
    'failed player-history batches must remain queued for bounded retry');
  assert.match(mainSource, /getSystemPerformanceProbe\(processId\)/, 'process and adapter metrics must share one bounded PowerShell probe');
  assert.doesNotMatch(mainSource, /await Promise\.all\(entries\.map\(async \(entry\)/,
    'directory measurement must not fan out unbounded filesystem promises');
  assert.match(safetySource, /fs\.opendir\(directory/, 'directory scans must stream entries instead of materializing huge folders');
  assert.doesNotMatch(safetySource, /fs\.readdir\(directory/, 'directory scans must not read an unbounded directory listing into memory');
  assert.match(uiSource, /if \(refreshPending && !force\) return refreshPending/,
    'ordinary embedded refreshes must coalesce while forced post-mutation refreshes can supersede stale work');
  assert.match(uiSource, /PLAYER_SKIN_MAX_CONCURRENCY = 4/, 'skin requests must use bounded concurrency');
  assert.match(uiSource, /refreshTimer = setInterval\([\s\S]*?\}, 10_000\);/,
    'embedded status polling must use the reduced rate');
  assert.match(rendererSource, /if \(statusRequestPending\) return statusRequestPending/, 'standalone status requests must coalesce');
  assert.match(rendererSource, /}, 6000\);/, 'standalone status polling must no longer run every 1.5 seconds');
  assert.match(rendererSource, /MAX_ADDON_RESULTS = 240/,
    'standalone add-on browsing must keep a bounded result accumulator');
  assert.match(rendererSource, /merged\.slice\(-MAX_ADDON_RESULTS\)/,
    'add-on pagination must discard old cards instead of retaining an unbounded list');

  console.log('PASS Minecraft server performance safeguards');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
