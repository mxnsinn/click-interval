const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Hidden, isolated renderer: never attaches to the app, the user's client, or a server.
const root = __dirname;
const work = path.join(root, 'work', 'live-map-improvement');
const requestedDpr = Number(process.env.CLICK_INTERVAL_MAP_TEST_DPR) || 1;
app.commandLine.appendSwitch('force-device-scale-factor', String(Math.max(1, Math.min(2, requestedDpr))));
const suffix = requestedDpr === 1 ? '' : `-dpr${requestedDpr}`;
fs.mkdirSync(work, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(work, 'renderer-test-')));
const dimension = 'minecraft:overworld';
const fixture = {
  serverName: 'Private map regression', serverState: 'running', worldToken: 'private-fixture',
  terrainToken: 'fixture:1', terrainRevision: 1, terrain: [], generatedRegions: [],
  players: [{ name: 'Online', online: true, dimension, x: 0, y: 64, z: 0 }],
  playerRoster: [
    { name: 'Offline', online: false, dimension, x: 95, y: 64, z: 78 },
    { name: 'Unknown', online: false, dimension: '', x: null, y: null, z: null },
    { name: 'Online', online: true, dimension, x: 0, y: 64, z: 0 }
  ],
  markers: [{ id: 'minecraft:spawn', kind: 'spawn', dimension, x: 0, z: 0 }],
  map: { installed: true }, terrainIndex: { total: 100, indexed: 100, complete: true }
};
for (let z = -256; z < 256; z += 16) {
  for (let x = -256; x < 256; x += 16) fixture.terrain.push({ dimension, x, z, y: 64, size: 16, block: 'minecraft:grass_block', color: '#228844' });
}
for (let z = -128; z < 128; z += 16) {
  for (let x = 60000; x < 60256; x += 16) fixture.terrain.push({ dimension, x, z, y: 64, size: 16, block: 'minecraft:stone', color: '#ff3300' });
}
const coverage = Buffer.alloc(128);
coverage[2] = 1 << 4; // Saved but not yet colored chunk (20, 0).
fixture.generatedRegions.push({ dimension, regionX: 0, regionZ: 0, chunks: coverage.toString('base64') });

app.whenReady().then(async () => {
  const requests = { seed: [], slime: [] };
  ipcMain.on('load-app-settings', event => { event.returnValue = {}; });
  ipcMain.handle('world-map:snapshot', () => fixture);
  ipcMain.handle('players:getSkin', () => ({}));
  ipcMain.handle('world-map:seedPreview', (_event, query) => {
    requests.seed.push(query);
    return { available: true, worldToken: fixture.worldToken, kind: 'seed-biomes', cells: [
      { x: -32768, z: -32768, size: 65536, biome: 'minecraft:plains', color: '#506644' }
    ] };
  });
  ipcMain.handle('world-map:stopSeedPreview', () => true);
  ipcMain.handle('world-map:slimeChunks', (_event, query) => {
    requests.slime.push(query);
    return { worldToken: fixture.worldToken, available: true, chunks: [{ x: 0, z: 0 }] };
  });
  const window = new BrowserWindow({ show: false, width: 1200, height: 760,
    webPreferences: { preload: path.join(root, 'world-map-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const errors = [];
  window.webContents.on('console-message', (_event, _level, message) => {
    if (/Uncaught|ReferenceError|TypeError/.test(message)) errors.push(message);
  });
  await window.loadFile(path.join(root, 'world-map.html'));
  await new Promise(resolve => setTimeout(resolve, 700));
  const report = await window.webContents.executeJavaScript(`(async () => {
    const checks = [];
    const check = (name, value) => { if (!value) throw new Error(name); checks.push(name); };
    const rgbaAt = (x, y) => Array.from(context.getImageData(Math.round(x * (window.devicePixelRatio || 1)), Math.round(y * (window.devicePixelRatio || 1)), 1, 1).data);
    check('online-first complete player history', rosterPlayers().map(p => p.name).join(',') === 'Online,Offline,Unknown');
    check('nullable coordinates are not zero', coordinate(null) === '—' && !playerHasPosition(snapshot.playerRoster[1]));
    check('roster head and status for every player', document.querySelectorAll('.player-row .player-head').length === 3 && document.querySelectorAll('.player-row.offline').length === 2);
    check('offline markers hidden by default', dimensionPlayers().length === 1);
    layerSettings.offline = true;
    check('offline marker opt-in excludes unknown position', dimensionPlayers().length === 2);
    layerSettings.offline = false;
    centerX = 73; centerZ = 91;
    Array.from(document.querySelectorAll('.player-row')).find(row => row.textContent.includes('Unknown')).click();
    check('unknown player never snaps camera to origin', centerX === 73 && centerZ === 91);
    check('unknown selection shows honest coordinates', $('selectedX').textContent === '—' && $('selectedDimension').textContent.includes('Offline'));
    check('no technical terrain prose', $('mapBackendLabel').textContent === 'Live map' && $('mapNotice').textContent === '');
    const savedRoster = snapshot.playerRoster;
    snapshot.playerRoster = []; selectedName = ''; layerSettings.players = false; layerSettings.seed = false; layerSettings.structures = false;
    selectedDimension = 'minecraft:overworld'; centerX = 0; centerZ = 0; fittedDimension = selectedDimension + '|manual';
    for (const zoom of [0.073, 0.37, 0.55, 1.25]) {
      scale = zoom; centerX = 0.33; centerZ = 0.7; draw();
      let gaps = 0;
      for (let x = -220; x < 220; x += 3) {
        const p = screenPoint(x, 1);
        if (p.x < AXIS_LEFT_WIDTH + 1 || p.x > canvas.clientWidth - 2) continue;
        const color = rgbaAt(p.x, p.y);
        if (color[0] !== 34 || color[1] !== 136 || color[2] !== 68) gaps++;
      }
      check('gap-free uniform terrain at zoom ' + zoom, gaps === 0);
    }
    const remoteOverview = createTerrainGlobalOverview('minecraft:overworld');
    check('zoom-out overview retains disconnected remote terrain', remoteOverview.bounds.maxX >= 60016);
    centerX = 60128; centerZ = 8; scale = 0.01; draw();
    const remotePixel = screenPoint(60128, 8);
    let remotePainted = false;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const remoteColor = rgbaAt(remotePixel.x + dx, remotePixel.y + dy);
      remotePainted ||= remoteColor[0] > 200 && remoteColor[1] < 100;
    }
    check('remote terrain actually painted at overview zoom', remotePainted);
    const cross = { dimension: 'minecraft:overworld', x: 127, z: 127, size: 4, color: '#ff00ff', y: 64, block: 'minecraft:stone' };
    snapshot.terrain.push(cross); rebuildTerrainIndex();
    check('sample straddling tile boundary indexed on both sides', terrainBuckets.get('minecraft:overworld|0|0').includes(cross) && terrainBuckets.get('minecraft:overworld|1|1').includes(cross));
    const tile = createTerrainTile('minecraft:overworld', 0, 0);
    snapshot.terrain = snapshot.terrain.map(cell => ({ ...cell }));
    rebuildTerrainIndex();
    check('unchanged raster tiles survive snapshot refresh', terrainTiles.get('minecraft:overworld|0|0') === tile);
    snapshot.terrain = snapshot.terrain.map(cell => ({ ...cell })); snapshot.terrain[0].color = '#ffffff'; rebuildTerrainIndex();
    check('changed raster tile invalidates only its tile', !terrainTiles.has('minecraft:overworld|-2|-2') && terrainTiles.get('minecraft:overworld|0|0') === tile);
    centerX = 0; centerZ = 0; scale = 1;
    layerSettings.structures = false; draw();
    const axisX = 37; const axisY = 70;
    const before = rgbaAt(axisX, axisY).join(',');
    const axisWorld = worldPoint(axisX, axisY);
    snapshot.markers = [{ kind: 'spawn', id: 'minecraft:spawn', dimension: selectedDimension, x: axisWorld.x, z: axisWorld.z }];
    layerSettings.structures = true; draw();
    check('structure icons cannot overpaint coordinate axis', rgbaAt(axisX, axisY).join(',') === before);
    layerSettings.hiddenStructures.add('spawn');
    check('individual structure toggle filters map and selection', !markerVisible(snapshot.markers[0]));
    layerSettings.hiddenStructures.clear();
    let gridLines = 0; const originalMove = context.moveTo;
    context.moveTo = function(...args) { gridLines++; return originalMove.apply(this, args); };
    layerSettings.grid = false; drawGrid(); check('chunk outlines absent by default', gridLines === 0);
    layerSettings.grid = true; scale = 0.25; drawGrid(); check('16-block grid visible at four pixels per chunk', gridLines > 50);
    gridLines = 0; scale = 0.249; drawGrid(); check('grid hides only at distant zoom', gridLines === 0);
    context.moveTo = originalMove; layerSettings.grid = false;
    const unchangedLayer = terrainLayer; draw(); const once = terrainLayer;
    let tileDraws = 0; const originalDrawImage = context.drawImage;
    context.drawImage = function(source, ...args) { if (source !== terrainLayer) tileDraws++; return originalDrawImage.call(this, source, ...args); };
    layerSettings.structures = false; draw();
    check('same viewport reuses precomposed terrain instead of rerasterizing', terrainLayer === once && tileDraws === 0);
    context.drawImage = originalDrawImage;
    const edges = [0.073, 0.37, 1.25].every(s => { scale = s; return rasterEdge(screenPoint(128, 0).x) === rasterEdge(screenPoint(0 + 128, 0).x); });
    check('adjacent terrain tiles share exact device-pixel edge', edges);
    const invalid = buildSeedRaster({ available: true, cells: [{ x: 0, z: 0, size: 16, color: '#000000' }, { x: 16, z: 0, size: 32, color: '#000000' }] });
    check('invalid mixed-resolution preview rejected', invalid === null);
    layerSettings.seed = true; layerSettings.slime = true; scale = 1; centerX = 0; centerZ = 0;
    draw(); await new Promise(resolve => setTimeout(resolve, 600));
    check('seed preview remains explicitly biome-only', seedResult?.kind === 'seed-biomes' && $('seedLayer').title.includes('not exact blocks'));
    const pendingPoint = screenPoint(328, 8);
    check('saved-but-uncolored coverage cannot obscure seed biome preview', rgbaAt(pendingPoint.x, pendingPoint.y).slice(0, 3).join(',') === '80,102,68');
    check('slime viewport response bound to current world', slimeResult?.worldToken === snapshot.worldToken);
    const ownSeed = seedRaster; snapshot.worldToken = 'other-world'; terrainLayerKey = ''; draw();
    check('world change invalidates stale seed draw eligibility', seedResult.worldToken !== snapshot.worldToken);
    snapshot.worldToken = 'private-fixture'; snapshot.playerRoster = savedRoster;
    layerSettings.seed = false; layerSettings.slime = false; layerSettings.players = true; layerSettings.structures = true;
    snapshot.markers = [{ kind: 'spawn', id: 'minecraft:spawn', dimension: selectedDimension, x: 0, z: 0 }, { kind: 'structure', id: 'minecraft:mineshaft', dimension: selectedDimension, x: 120, z: -80 }];
    centerX = 0; centerZ = 0; scale = 0.8; render();
    const blankPoint = screenPoint(450, 0);
    check('disabling seed layer removes preview pixels', rgbaAt(blankPoint.x, blankPoint.y).slice(0, 3).join(',') !== '80,102,68');
    const originalTerrain = snapshot.terrain;
    snapshot.terrain = Array.from({ length: 5000 }, (_, index) => ({ dimension: selectedDimension,
      x: (index % 100) * 16, z: Math.floor(index / 100) * 16, size: 16, y: 64, color: '#228844', block: 'minecraft:grass_block' }));
    snapshot.worldToken = 'large-raster-fixture'; rebuildTerrainIndex();
    check('world change cancels previous raster jobs', rasterJobs.size === 0);
    const pendingOverview = createTerrainGlobalOverview(selectedDimension);
    check('large overview queues bounded work instead of blocking input frame', pendingOverview === null && rasterJobs.has('global|' + selectedDimension));
    for (let tries = 0; tries < 100 && !terrainGlobalOverviews.has(selectedDimension); tries++) await new Promise(resolve => setTimeout(resolve, 20));
    check('incremental overview completes with all terrain bounds', terrainGlobalOverviews.get(selectedDimension)?.bounds.maxX === 1600);
    snapshot.worldToken = 'private-fixture'; snapshot.terrain = originalTerrain; rebuildTerrainIndex(); render();
    const priorSnapshot = snapshot;
    const largeSource = { ...snapshot, terrain: Array.from({length: 100000}, (_, i) => ({dimension: selectedDimension, x: (i % 1000) * 16, z: Math.floor(i / 1000) * 16, size: 16, y: 64, color: '#228844'})) };
    let inputYielded = false;
    setTimeout(() => { inputYielded = true; }, 0);
    const indexing = rebuildTerrainIndexAsync(largeSource);
    check('large index keeps previous snapshot until atomic commit', snapshot === priorSnapshot);
    check('large asynchronous index commits successfully', await indexing);
    check('large index yields to input and preserves every sample', inputYielded && terrainCellCount() === 100000);
    const cancelledIndex = rebuildTerrainIndexAsync({...largeSource, worldToken:'cancelled-world'});
    await rebuildTerrainIndexAsync(priorSnapshot);
    check('superseded index cannot overwrite newer world', !await cancelledIndex && snapshot === priorSnapshot);
    const online = snapshot.playerRoster.find(player => player.online);
    online.lastPositionAt = Date.now() - 60000;
    renderPlayers(false);
    check('stale online coordinates are explicitly last known', [...document.querySelectorAll('.player-row')].some(row => row.title.includes('Online; last known location')));
    delete online.lastPositionAt;
    render();
    return { checks, count: checks.length, devicePixelRatio: window.devicePixelRatio, processId: 'isolated renderer' };
  })()`);
  if (errors.length) throw new Error(errors.join('\n'));
  await new Promise(resolve => setTimeout(resolve, 100));
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(work, `renderer-regression${suffix}.png`), image.toPNG());
  const receipt = { ...report, seedRequests: requests.seed.length, slimeRequests: requests.slime.length,
    testedAt: new Date().toISOString(), liveServerTouched: false, gameInputSent: false };
  fs.writeFileSync(path.join(work, `renderer-regression${suffix}.json`), JSON.stringify(receipt, null, 2));
  process.stdout.write(JSON.stringify(receipt) + '\n');
  window.destroy(); app.quit();
}).catch(error => { process.stderr.write(String(error.stack || error) + '\n'); app.exit(1); });
