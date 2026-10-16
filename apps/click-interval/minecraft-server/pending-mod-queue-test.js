'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  applyPendingModQueue,
  createBoundedWorldBackup,
  exportClientModBundle,
  getPendingModQueueStatus,
  PendingModError,
  profilePaths,
  queuePendingMods,
  readFabricModDescriptor,
  readResourcePackDescriptor,
  recoverPendingModTransaction,
  rollbackPendingModApplication,
  selectManifestArtifacts,
  validateManifest
} = require('./pending-mod-queue');

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries, { deflate = false } = {}) {
  const normalizedEntries = Array.isArray(entries) ? entries : Object.entries(entries);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, source] of normalizedEntries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(source) ? source : Buffer.from(String(source), 'utf8');
    const compressed = deflate ? zlib.deflateRawSync(data) : data;
    const compressionMethod = deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(normalizedEntries.length, 8);
  end.writeUInt16LE(normalizedEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function fixtureZipEntries(buffer) {
  const endOffset = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(endOffset), 0x06054b50);
  const count = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    entries.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
      centralOffset: offset,
      localOffset,
      dataOffset: localOffset + 30 + localNameLength + localExtraLength,
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24)
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function makeResourcePack(file, {
  minFormat = 84,
  maxFormat = 999,
  entries = {}
} = {}) {
  const metadata = { pack: { description: 'fixture resource pack', min_format: minFormat, max_format: maxFormat } };
  await fs.writeFile(file, makeStoredZip([
    ['pack.mcmeta', JSON.stringify(metadata)],
    ['assets/fixture/lang/en_us.json', '{"fixture":"ok"}'],
    ...Object.entries(entries)
  ]));
}

async function makeFabricJar(file, { id, version = '1.0.0', environment = '*', marker = '' }) {
  const descriptor = {
    schemaVersion: 1,
    id,
    version,
    name: id,
    environment,
    entrypoints: { main: [`test.${id}.Main`] },
    depends: { minecraft: '26.2' }
  };
  await fs.writeFile(file, makeStoredZip({
    'fabric.mod.json': JSON.stringify(descriptor),
    [`test/${id}/Main.class`]: `fixture-${id}-${version}-${marker}`
  }));
}

async function artifactFor(file, {
  key,
  modId = key,
  artifactType = 'fabric-mod',
  resourcePackId = key,
  installTarget = 'server',
  optional = false,
  clientRequired = false,
  serverOnly = installTarget === 'server' && !clientRequired,
  clientOnly = installTarget !== 'server',
  replaceExisting = false,
  requiresWorldBackup = false,
  dependencies = [],
  portableExport = artifactType === 'resource-pack' ? 'reference-only' : 'include',
  minFormat = 84,
  maxFormat = 999
}) {
  const bytes = await fs.readFile(file);
  const extension = artifactType === 'resource-pack' ? '.zip' : '.jar';
  const artifact = {
    key,
    title: key,
    artifactType,
    projectId: `project-${key}`,
    versionId: `version-${key}`,
    version: '1.0.0',
    filename: `${key}${extension}`,
    url: `https://cdn.modrinth.com/data/project-${key}/versions/version-${key}/${key}${extension}`,
    size: bytes.length,
    hashes: {
      sha1: crypto.createHash('sha1').update(bytes).digest('hex'),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sha512: crypto.createHash('sha512').update(bytes).digest('hex')
    },
    installTarget,
    clientRequired,
    serverOnly,
    clientOnly,
    optional,
    replaceExisting,
    requiresWorldBackup,
    dependencies
  };
  if (artifactType === 'resource-pack') {
    artifact.resourcePackId = resourcePackId;
    artifact.resourcePack = { minFormat, maxFormat };
    artifact.distribution = {
      source: 'official-cdn',
      embedInApp: false,
      rehost: false,
      portableExport: 'reference-only',
      localDirectInstall: true
    };
  } else {
    artifact.modId = modId;
    if (portableExport === 'reference-only') {
      artifact.distribution = {
        source: 'official-cdn',
        embedInApp: false,
        rehost: false,
        portableExport,
        localDirectInstall: true
      };
    }
  }
  if (['client-optional', 'client-resource-pack'].includes(installTarget)) {
    artifact.compatibility = { loader: 'fabric', minecraftVersion: '26.2' };
  }
  return artifact;
}

async function writeManifest(file, id, artifacts, extra = {}) {
  const manifest = {
    schemaVersion: 1,
    id,
    target: { loader: 'fabric', minecraftVersion: '26.2' },
    requiredInstalledModIds: [],
    artifacts,
    ...extra
  };
  validateManifest(manifest);
  await fs.writeFile(file, JSON.stringify(manifest, null, 2));
  return manifest;
}

async function makeProfile(root, { worldBytes = 32 } = {}) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'assembly-platform.json'), JSON.stringify({ type: 'fabric', minecraftVersion: '26.2' }));
  await fs.writeFile(path.join(root, 'assembly-config.json'), JSON.stringify({ levelName: 'world' }));
  await fs.mkdir(path.join(root, 'world', 'region'), { recursive: true });
  await fs.writeFile(path.join(root, 'world', 'level.dat'), Buffer.alloc(worldBytes, 0x5a));
  await fs.writeFile(path.join(root, 'world', 'region', 'r.0.0.mca'), Buffer.from('region-fixture'));
  await fs.mkdir(path.join(root, 'mods'), { recursive: true });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, code, `expected ${code}, got ${error?.code}: ${error?.message}`);
    return true;
  });
}

async function main() {
  const work = path.resolve(__dirname, '..', 'work');
  await fs.mkdir(work, { recursive: true });
  const temporaryRoot = await fs.mkdtemp(path.join(work, 'pending-mod-queue-test-'));
  try {
    const releaseManifest = JSON.parse(await fs.readFile(
      path.join(__dirname, 'manifests', 'fabric-26.2-smp-mods.json'),
      'utf8'
    ));
    validateManifest(releaseManifest);
    assert.deepEqual(selectManifestArtifacts(releaseManifest).map(item => item.key),
      ['servercore', 'krypton', 'spark']);
    assert.equal(releaseManifest.artifacts.some(item => item.key === 'lootr'), false);
    assert.equal(releaseManifest.artifacts.some(item => item.clientRequired), false);
    assert.deepEqual(releaseManifest.artifacts
      .filter(item => item.installTarget === 'client-optional')
      .map(item => item.key), [
        'litematica-client',
        'malilib-client',
        'entity-model-features-client',
        'entity-texture-features-client'
      ]);
    assert.deepEqual(releaseManifest.artifacts
      .filter(item => item.installTarget === 'client-resource-pack')
      .map(item => item.key), ['fresh-animations-resource-pack']);
    const releaseFresh = releaseManifest.artifacts.find(item => item.key === 'fresh-animations-resource-pack');
    assert.equal(releaseFresh.releaseType, 'beta');
    assert.equal(releaseFresh.filename, 'FreshAnimations_v1.10.5.zip');
    assert.equal(releaseFresh.versionId, 'RGIzA5em');
    assert.equal(releaseFresh.hashes.sha256, 'cf9f17a2977e171b33cb0b598bc4357dd0383e09c10d5f768ff17c12d0a028ee');
    assert.deepEqual(releaseFresh.resourcePack, { minFormat: 84, maxFormat: 999 });
    assert.deepEqual(releaseFresh.distribution, {
      source: 'official-cdn',
      embedInApp: false,
      rehost: false,
      portableExport: 'reference-only',
      localDirectInstall: true,
      notice: 'Download directly from the official Modrinth CDN for personal local installation. Portable exports retain only this verified reference; do not rehost or redistribute the pack.'
    });
    assert.equal(releaseFresh.officialCompatibility.loader, 'minecraft');
    assert.equal(releaseFresh.license.id, 'LicenseRef-Fresh-Animations-Custom');
    assert.deepEqual(selectManifestArtifacts(releaseManifest, { clientBundleKeys: ['fresh-animations'] })
      .map(item => item.key), [
        'servercore',
        'krypton',
        'spark',
        'fresh-animations-resource-pack',
        'entity-model-features-client',
        'entity-texture-features-client'
      ]);
    assert.throws(() => selectManifestArtifacts(releaseManifest, { clientBundleKeys: ['not-a-bundle'] }),
      error => error?.code === 'unknown-client-bundle');

    const sources = path.join(temporaryRoot, 'sources');
    await fs.mkdir(sources);
    const sourceFiles = {
      lootr: path.join(sources, 'lootr.jar'),
      servercore: path.join(sources, 'servercore.jar'),
      chunky: path.join(sources, 'chunky.jar'),
      litematica: path.join(sources, 'litematica.jar'),
      malilib: path.join(sources, 'malilib.jar'),
      fresh: path.join(sources, 'fresh.zip'),
      emf: path.join(sources, 'emf.jar'),
      etf: path.join(sources, 'etf.jar')
    };
    await makeFabricJar(sourceFiles.lootr, { id: 'lootr' });
    await makeFabricJar(sourceFiles.servercore, { id: 'servercore' });
    await makeFabricJar(sourceFiles.chunky, { id: 'chunky' });
    await makeFabricJar(sourceFiles.litematica, { id: 'litematica', environment: 'client' });
    await makeFabricJar(sourceFiles.malilib, { id: 'malilib', environment: 'client' });
    await makeResourcePack(sourceFiles.fresh);
    await makeFabricJar(sourceFiles.emf, { id: 'entity_model_features', environment: 'client' });
    await makeFabricJar(sourceFiles.etf, { id: 'entity_texture_features', environment: 'client' });
    assert.deepEqual(await readFabricModDescriptor(sourceFiles.lootr), {
      id: 'lootr',
      version: '1.0.0',
      environment: '*',
      depends: { minecraft: '26.2' }
    });
    const lenientFabricJar = path.join(sources, 'lenient-fabric.jar');
    await fs.writeFile(lenientFabricJar, makeStoredZip({
      'fabric.mod.json': '{"schemaVersion":1,"id":"lenient_fixture","version":"1.0.0","description":"line one\nline two","environment":"client","depends":{"minecraft":"26.2"}}'
    }));
    assert.equal((await readFabricModDescriptor(lenientFabricJar)).id, 'lenient_fixture');
    const freshDescriptor = await readResourcePackDescriptor(sourceFiles.fresh);
    assert.equal(freshDescriptor.packFormat, null);
    assert.equal(freshDescriptor.minFormat, 84);
    assert.equal(freshDescriptor.maxFormat, 999);
    assert.equal(freshDescriptor.entryCount, 2);
    const legacyPack = path.join(sources, 'legacy-pack.zip');
    await fs.writeFile(legacyPack, makeStoredZip({
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 84, description: 'legacy fixture' } })
    }));
    const legacyDescriptor = await readResourcePackDescriptor(legacyPack);
    assert.equal(legacyDescriptor.packFormat, 84);
    assert.equal(legacyDescriptor.minFormat, 84);
    assert.equal(legacyDescriptor.maxFormat, 84);
    const unsafePack = path.join(sources, 'unsafe-pack.zip');
    await fs.writeFile(unsafePack, makeStoredZip([
      ['pack.mcmeta', JSON.stringify({ pack: { pack_format: 84, description: 'unsafe' } })],
      ['../escaped.txt', 'must never be extracted']
    ]));
    await expectCode(readResourcePackDescriptor(unsafePack), 'unsafe-resource-pack-entry');

    const deflatedPack = path.join(sources, 'deflated-pack.zip');
    await fs.writeFile(deflatedPack, makeStoredZip({
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 84, description: 'deflated fixture' } }),
      'assets/fixture/data.txt': 'verified compressed payload'
    }, { deflate: true }));
    assert.equal((await readResourcePackDescriptor(deflatedPack)).packFormat, 84);

    const corruptEntryPack = path.join(sources, 'corrupt-entry-pack.zip');
    const corruptEntryBytes = makeStoredZip({
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 84, description: 'CRC fixture' } }),
      'assets/fixture/data.txt': 'checksum protected payload'
    });
    const corruptAsset = fixtureZipEntries(corruptEntryBytes).find(item => item.name.endsWith('data.txt'));
    corruptEntryBytes[corruptAsset.dataOffset] ^= 0xff;
    await fs.writeFile(corruptEntryPack, corruptEntryBytes);
    await expectCode(readResourcePackDescriptor(corruptEntryPack), 'resource-pack-entry-mismatch');

    const forgedHeaderPack = path.join(sources, 'forged-header-pack.zip');
    const forgedHeaderBytes = makeStoredZip({
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 84, description: 'header fixture' } }),
      'assets/fixture/data.txt': 'header protected payload'
    });
    const forgedHeaderAsset = fixtureZipEntries(forgedHeaderBytes).find(item => item.name.endsWith('data.txt'));
    forgedHeaderBytes.writeUInt16LE(8, forgedHeaderAsset.localOffset + 8);
    await fs.writeFile(forgedHeaderPack, forgedHeaderBytes);
    await expectCode(readResourcePackDescriptor(forgedHeaderPack), 'unsafe-resource-pack-entry');

    const forgedSizePack = path.join(sources, 'forged-size-pack.zip');
    const forgedSizeBytes = makeStoredZip({
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 84, description: 'size fixture' } }),
      'assets/fixture/data.txt': 'more than one byte'
    });
    const forgedSizeAsset = fixtureZipEntries(forgedSizeBytes).find(item => item.name.endsWith('data.txt'));
    forgedSizeBytes.writeUInt32LE(1, forgedSizeAsset.localOffset + 22);
    forgedSizeBytes.writeUInt32LE(1, forgedSizeAsset.centralOffset + 24);
    await fs.writeFile(forgedSizePack, forgedSizeBytes);
    await expectCode(readResourcePackDescriptor(forgedSizePack), 'resource-pack-entry-mismatch');

    const ratioPack = path.join(sources, 'unsafe-ratio-pack.zip');
    await fs.writeFile(ratioPack, makeStoredZip({
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 84, description: 'ratio fixture' } }),
      'assets/fixture/bomb.bin': Buffer.alloc(2 * 1024 * 1024)
    }, { deflate: true }));
    await expectCode(readResourcePackDescriptor(ratioPack), 'resource-pack-compression-ratio');

    const artifacts = [
      await artifactFor(sourceFiles.lootr, {
        key: 'lootr', clientRequired: true, serverOnly: false, requiresWorldBackup: true
      }),
      await artifactFor(sourceFiles.servercore, { key: 'servercore' }),
      await artifactFor(sourceFiles.chunky, { key: 'chunky', optional: true }),
      await artifactFor(sourceFiles.litematica, {
        key: 'litematica', installTarget: 'client-optional', optional: true, serverOnly: false,
        dependencies: ['malilib']
      }),
      await artifactFor(sourceFiles.malilib, {
        key: 'malilib', installTarget: 'client-optional', optional: true, serverOnly: false
      }),
      await artifactFor(sourceFiles.fresh, {
        key: 'fresh', artifactType: 'resource-pack', resourcePackId: 'fresh-animations',
        installTarget: 'client-resource-pack', optional: true, serverOnly: false,
        dependencies: ['emf', 'etf']
      }),
      await artifactFor(sourceFiles.emf, {
        key: 'emf', modId: 'entity_model_features', installTarget: 'client-optional',
        optional: true, serverOnly: false, dependencies: ['etf'], portableExport: 'reference-only'
      }),
      await artifactFor(sourceFiles.etf, {
        key: 'etf', modId: 'entity_texture_features', installTarget: 'client-optional',
        optional: true, serverOnly: false, portableExport: 'reference-only'
      })
    ];
    const manifestPath = path.join(temporaryRoot, 'manifest.json');
    const manifest = await writeManifest(manifestPath, 'fixture-queue', artifacts, {
      clientBundles: [{
        key: 'litematica',
        title: 'Litematica',
        available: true,
        target: { loader: 'fabric', minecraftVersion: '26.2' },
        artifactKeys: ['litematica', 'malilib']
      }, {
        key: 'fresh-animations',
        title: 'Fresh Animations',
        available: true,
        target: { loader: 'fabric', minecraftVersion: '26.2' },
        artifactKeys: ['fresh', 'emf', 'etf']
      }],
      clientExternalDependencies: [{
        modId: 'fabric-api',
        title: 'Fabric API',
        projectId: 'fabric-api-project',
        versionId: 'fabric-api-version',
        version: '0.161.0+26.2',
        filename: 'fabric-api.jar',
        url: 'https://cdn.modrinth.com/data/fabric-api-project/versions/fabric-api-version/fabric-api.jar',
        size: 1,
        hashes: {
          sha1: 'a'.repeat(40),
          sha256: 'b'.repeat(64),
          sha512: 'c'.repeat(128)
        },
        bundled: false,
        required: true,
        reason: 'fixture dependency'
      }]
    });
    assert.deepEqual(selectManifestArtifacts(manifest).map(item => item.key), ['lootr', 'servercore']);
    assert.deepEqual(selectManifestArtifacts(manifest, { includeOptionalServer: true }).map(item => item.key),
      ['lootr', 'servercore', 'chunky']);
    assert.deepEqual(selectManifestArtifacts(manifest, { includeClientOptional: true }).map(item => item.key),
      ['lootr', 'servercore', 'litematica', 'malilib', 'fresh', 'emf', 'etf']);
    assert.deepEqual(selectManifestArtifacts(manifest, { clientBundleKeys: ['fresh-animations'] }).map(item => item.key),
      ['lootr', 'servercore', 'fresh', 'emf', 'etf']);
    assert.throws(() => selectManifestArtifacts(manifest, { optionalServerKeys: ['unknown'] }), /optional server mod selection/i);
    const unavailableBundleManifest = structuredClone(manifest);
    unavailableBundleManifest.clientBundles.push({
      key: 'future-pack',
      title: 'Future Pack',
      available: false,
      target: { loader: 'fabric', minecraftVersion: '26.2' },
      artifactKeys: [],
      unavailableReason: 'The exact official artifact has not been verified.',
      expectedArtifacts: [{ title: 'Future Pack', artifactType: 'resource-pack', targetFolder: 'resourcepacks' }]
    });
    validateManifest(unavailableBundleManifest);
    assert.throws(() => selectManifestArtifacts(unavailableBundleManifest, { clientBundleKeys: ['future-pack'] }),
      error => error?.code === 'client-bundle-unavailable');
    const incompleteBundleManifest = structuredClone(manifest);
    incompleteBundleManifest.clientBundles.find(item => item.key === 'fresh-animations').artifactKeys = ['fresh', 'emf'];
    assert.throws(() => validateManifest(incompleteBundleManifest), /omits client dependency etf/i);

    const invalidFlags = structuredClone(manifest);
    invalidFlags.artifacts[0].serverOnly = true;
    assert.throws(() => validateManifest(invalidFlags), /both client-required and server-only/i);
    const invalidClientOnly = structuredClone(manifest);
    invalidClientOnly.artifacts.find(item => item.key === 'servercore').clientOnly = true;
    assert.throws(() => validateManifest(invalidClientOnly), /clientOnly metadata/i);
    const crossBoundaryDependency = structuredClone(manifest);
    crossBoundaryDependency.artifacts.find(item => item.key === 'emf').dependencies = ['servercore'];
    assert.throws(() => validateManifest(crossBoundaryDependency), /server\/client install boundary/i);
    const duplicateId = structuredClone(manifest);
    duplicateId.artifacts[1].modId = 'lootr';
    assert.throws(() => validateManifest(duplicateId), /more than once/i);
    const duplicatePackId = structuredClone(manifest);
    duplicatePackId.artifacts.push({ ...structuredClone(duplicatePackId.artifacts.find(item => item.key === 'fresh')),
      key: 'fresh-copy', filename: 'fresh-copy.zip',
      url: 'https://cdn.modrinth.com/data/project-fresh/versions/version-fresh/fresh-copy.zip' });
    assert.throws(() => validateManifest(duplicatePackId), /repeats resource pack/i);

    const profile = path.join(temporaryRoot, 'profile');
    await makeProfile(profile);
    const downloadFile = async (artifact, destination) => {
      const source = sourceFiles[artifact.key];
      assert.ok(source, `unexpected download ${artifact.key}`);
      await fs.copyFile(source, destination);
    };
    const queued = await queuePendingMods({ profileRoot: profile, manifestPath, downloadFile });
    assert.equal(queued.serverCount, 2);
    assert.equal(queued.clientOptionalCount, 0);
    const queuePaths = profilePaths(profile, manifest.id);
    assert.equal(await fs.stat(path.join(queuePaths.queueFiles, 'server', 'lootr.jar')).then(() => true), true);
    assert.equal(await fs.stat(path.join(queuePaths.queueFiles, 'server', 'servercore.jar')).then(() => true), true);
    await assert.rejects(fs.stat(path.join(queuePaths.queueFiles, 'server', 'chunky.jar')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(queuePaths.queueFiles, 'client-optional', 'litematica.jar')), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(path.join(profile, 'mods')), [], 'download must never touch the live mods folder');
    assert.equal((await getPendingModQueueStatus({ profileRoot: profile, manifestPath })).state, 'ready');

    const requiredClientBundle = await exportClientModBundle({ profileRoot: profile, manifestPath });
    assert.equal(requiredClientBundle.state, 'exported');
    assert.equal(requiredClientBundle.clientRequiredCount, 1);
    assert.equal(requiredClientBundle.clientOptionalCount, 0);
    assert.deepEqual(await fs.readdir(path.join(requiredClientBundle.destination, 'mods')), ['lootr.jar']);
    const requiredBundleManifest = JSON.parse(await fs.readFile(requiredClientBundle.manifest, 'utf8'));
    assert.equal(requiredBundleManifest.externalDependencies[0].modId, 'fabric-api');
    assert.equal(requiredBundleManifest.externalDependencies[0].bundled, false);
    assert.deepEqual(requiredBundleManifest.serverOnlyArtifactsExcluded.map(item => item.key).sort(), ['chunky', 'servercore']);
    assert.match(await fs.readFile(path.join(requiredClientBundle.destination, 'README.txt'), 'utf8'), /Fabric API 0\.161\.0\+26\.2/);
    assert.equal((await exportClientModBundle({ profileRoot: profile, manifestPath })).state, 'already-exported');
    const requiredReadmePath = path.join(requiredClientBundle.destination, 'README.txt');
    const requiredManifestPath = path.join(requiredClientBundle.destination, 'client-bundle.json');
    const originalReadme = await fs.readFile(requiredReadmePath);
    const originalBundleJson = await fs.readFile(requiredManifestPath);
    await fs.writeFile(requiredReadmePath, Buffer.concat([originalReadme, Buffer.from('tampered\n')]));
    await expectCode(exportClientModBundle({ profileRoot: profile, manifestPath }), 'client-bundle-conflict');
    await fs.writeFile(requiredReadmePath, originalReadme);

    const changedBundle = JSON.parse(originalBundleJson.toString('utf8'));
    changedBundle.artifacts[0].version = 'tampered-version';
    await fs.writeFile(requiredManifestPath, JSON.stringify(changedBundle));
    await expectCode(exportClientModBundle({ profileRoot: profile, manifestPath }), 'client-bundle-conflict');
    await fs.writeFile(requiredManifestPath, originalBundleJson);

    const semanticallyIdenticalBundle = JSON.parse(originalBundleJson.toString('utf8'));
    await fs.writeFile(requiredManifestPath, JSON.stringify(semanticallyIdenticalBundle));
    assert.equal((await exportClientModBundle({ profileRoot: profile, manifestPath })).state, 'already-exported');
    await fs.writeFile(requiredManifestPath, originalBundleJson);

    await fs.rm(requiredReadmePath);
    await fs.mkdir(requiredReadmePath);
    await expectCode(exportClientModBundle({ profileRoot: profile, manifestPath }), 'client-bundle-conflict');
    await fs.rmdir(requiredReadmePath);
    await fs.writeFile(requiredReadmePath, originalReadme);

    const manifestBackupPath = path.join(temporaryRoot, 'required-client-bundle-regular.json');
    await fs.rename(requiredManifestPath, manifestBackupPath);
    let manifestSymlinkCreated = false;
    try {
      await fs.symlink(manifestBackupPath, requiredManifestPath, 'file');
      manifestSymlinkCreated = true;
      await expectCode(exportClientModBundle({ profileRoot: profile, manifestPath }), 'client-bundle-conflict');
    } catch (error) {
      if (!manifestSymlinkCreated) assert.ok(['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code), `unexpected symlink error ${error}`);
      else throw error;
    } finally {
      if (manifestSymlinkCreated) await fs.unlink(requiredManifestPath);
      await fs.rename(manifestBackupPath, requiredManifestPath);
    }
    await expectCode(exportClientModBundle({
      profileRoot: profile,
      manifestPath,
      destinationDirectory: path.join(profile, 'mods', 'client-bundle')
    }), 'unsafe-export-path');
    await expectCode(exportClientModBundle({
      profileRoot: profile,
      manifestPath,
      includeClientOptional: true,
      destinationDirectory: path.join(temporaryRoot, 'missing-optional-export')
    }), 'pending-file-missing');

    const freshProfile = path.join(temporaryRoot, 'fresh-profile');
    await makeProfile(freshProfile);
    const freshQueued = await queuePendingMods({
      profileRoot: freshProfile,
      manifestPath,
      clientBundleKeys: ['fresh-animations'],
      downloadFile
    });
    assert.equal(freshQueued.serverCount, 2);
    assert.equal(freshQueued.clientOptionalCount, 3);
    assert.equal(freshQueued.clientModCount, 2);
    assert.equal(freshQueued.clientResourcePackCount, 1);
    const freshQueuePaths = profilePaths(freshProfile, manifest.id);
    assert.deepEqual((await fs.readdir(path.join(freshQueuePaths.queueFiles, 'client-optional'))).sort(),
      ['emf.jar', 'etf.jar']);
    assert.deepEqual(await fs.readdir(path.join(freshQueuePaths.queueFiles, 'client-resource-pack')), ['fresh.zip']);
    assert.deepEqual(await fs.readdir(path.join(freshProfile, 'mods')), [],
      'client bundle downloads must never touch the live server mods folder');

    const freshBundle = await exportClientModBundle({
      profileRoot: freshProfile,
      manifestPath,
      clientBundleKeys: ['fresh-animations']
    });
    assert.equal(freshBundle.clientRequiredCount, 1);
    assert.equal(freshBundle.clientOptionalCount, 3);
    assert.equal(freshBundle.clientResourcePackCount, 1);
    assert.equal(freshBundle.includedCount, 1);
    assert.equal(freshBundle.referencedCount, 3);
    assert.deepEqual(await fs.readdir(path.join(freshBundle.destination, 'mods')), ['lootr.jar']);
    await assert.rejects(fs.stat(path.join(freshBundle.destination, 'resourcepacks')), { code: 'ENOENT' });
    const freshBundleManifest = JSON.parse(await fs.readFile(freshBundle.manifest, 'utf8'));
    assert.deepEqual(freshBundleManifest.selectedClientBundles.map(item => item.key), ['fresh-animations']);
    const exportedFresh = freshBundleManifest.artifacts.find(item => item.key === 'fresh');
    assert.equal(exportedFresh.targetFolder, 'resourcepacks');
    assert.equal(exportedFresh.resourcePackId, 'fresh-animations');
    assert.equal(exportedFresh.minFormat, 84);
    assert.equal(exportedFresh.maxFormat, 999);
    assert.deepEqual(exportedFresh.compatibility, { loader: 'fabric', minecraftVersion: '26.2' });
    assert.equal(exportedFresh.portableExport, 'reference-only');
    assert.equal(exportedFresh.bundled, false);
    assert.deepEqual(exportedFresh.distribution, {
      source: 'official-cdn', embedInApp: false, rehost: false,
      portableExport: 'reference-only', localDirectInstall: true
    });
    for (const key of ['fresh', 'emf', 'etf']) {
      const reference = freshBundleManifest.artifacts.find(item => item.key === key);
      assert.equal(reference.bundled, false);
      assert.equal(reference.portableExport, 'reference-only');
      assert.match(reference.url, /^https:\/\/cdn\.modrinth\.com\//);
      assert.ok(reference.filename && reference.size > 0 && reference.hashes.sha1 && reference.hashes.sha512);
    }
    const freshReadme = await fs.readFile(path.join(freshBundle.destination, 'README.txt'), 'utf8');
    assert.ok(freshReadme.indexOf('Copy every JAR in mods') < freshReadme.indexOf('Copy every ZIP in resourcepacks'));
    assert.match(freshReadme, /without extracting it/i);
    assert.match(freshReadme, /Do not rehost or redistribute it/i);
    assert.match(freshReadme, /fully restart the Minecraft client/i);
    assert.match(freshReadme, /Options > Resource Packs and enable Fresh Animations/i);
    assert.match(freshReadme, /extension packs separately, place each extension above the base/i);
    assert.match(freshReadme, /Save as resourcepacks\/fresh\.zip; size \d+ bytes; SHA-1 [a-f0-9]{40}; SHA-256 [a-f0-9]{64}; SHA-512 [a-f0-9]{128}/i);
    assert.equal((await exportClientModBundle({
      profileRoot: freshProfile,
      manifestPath,
      clientBundleKeys: ['fresh-animations']
    })).state, 'already-exported');
    await fs.writeFile(path.join(freshBundle.destination, 'mods', 'unexpected.jar'), 'conflict');
    await expectCode(exportClientModBundle({
      profileRoot: freshProfile,
      manifestPath,
      clientBundleKeys: ['fresh-animations']
    }), 'client-bundle-conflict');

    await applyPendingModQueue({
      profileRoot: freshProfile,
      manifestPath,
      serverStopped: true,
      worldBackupLimits: { maxBytes: 4096, maxEntries: 100, diskReserveBytes: 1 }
    });
    assert.deepEqual((await fs.readdir(path.join(freshProfile, 'mods'))).sort(), ['lootr.jar', 'servercore.jar'],
      'Fresh Animations, EMF, and ETF must never install into the server mods folder');

    const clientFailureProfile = path.join(temporaryRoot, 'client-failure-profile');
    await makeProfile(clientFailureProfile);
    await expectCode(queuePendingMods({
      profileRoot: clientFailureProfile,
      manifestPath,
      clientBundleKeys: ['fresh-animations'],
      downloadFile: async (artifact, destination) => {
        if (artifact.key === 'fresh') {
          throw new PendingModError('simulated-client-download-failure', 'The optional client pack download failed.');
        }
        await downloadFile(artifact, destination);
      }
    }), 'simulated-client-download-failure');
    const clientFailurePaths = profilePaths(clientFailureProfile, manifest.id);
    const clientFailureState = JSON.parse(await fs.readFile(clientFailurePaths.queueState, 'utf8'));
    assert.equal(clientFailureState.status, 'partial');
    assert.equal(clientFailureState.artifacts.find(item => item.key === 'fresh').status, 'failed');
    assert.equal(clientFailureState.artifacts.find(item => item.key === 'emf').status, 'downloaded-and-verified');
    const serverSubsetStatus = await getPendingModQueueStatus({
      profileRoot: clientFailureProfile,
      manifestPath
    });
    assert.equal(serverSubsetStatus.state, 'ready');
    assert.equal(serverSubsetStatus.serverReady, true);
    const failedClientStatus = await getPendingModQueueStatus({
      profileRoot: clientFailureProfile,
      manifestPath,
      clientBundleKeys: ['fresh-animations']
    });
    assert.equal(failedClientStatus.state, 'partial');
    assert.equal(failedClientStatus.serverReady, true);
    assert.match(failedClientStatus.message, /Required server files are ready/i);
    const serverSubsetBundle = await exportClientModBundle({
      profileRoot: clientFailureProfile,
      manifestPath,
      destinationDirectory: path.join(temporaryRoot, 'server-subset-client-export')
    });
    assert.deepEqual(await fs.readdir(path.join(serverSubsetBundle.destination, 'mods')), ['lootr.jar']);
    await expectCode(exportClientModBundle({
      profileRoot: clientFailureProfile,
      manifestPath,
      destinationDirectory: path.join(temporaryRoot, 'failed-fresh-export'),
      clientBundleKeys: ['fresh-animations']
    }), 'pending-file-missing');
    await applyPendingModQueue({
      profileRoot: clientFailureProfile,
      manifestPath,
      serverStopped: true,
      worldBackupLimits: { maxBytes: 4096, maxEntries: 100, diskReserveBytes: 1 }
    });
    assert.deepEqual((await fs.readdir(path.join(clientFailureProfile, 'mods'))).sort(), ['lootr.jar', 'servercore.jar']);

    const tamperedProfile = path.join(temporaryRoot, 'tampered-fresh-profile');
    await makeProfile(tamperedProfile);
    await queuePendingMods({
      profileRoot: tamperedProfile,
      manifestPath,
      clientBundleKeys: ['fresh-animations'],
      downloadFile
    });
    const tamperedPaths = profilePaths(tamperedProfile, manifest.id);
    const tamperedFreshFile = path.join(tamperedPaths.queueFiles, 'client-resource-pack', 'fresh.zip');
    const tamperedBytes = await fs.readFile(tamperedFreshFile);
    tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
    await fs.writeFile(tamperedFreshFile, tamperedBytes);
    const tamperedDestination = path.join(temporaryRoot, 'tampered-export');
    await expectCode(exportClientModBundle({
      profileRoot: tamperedProfile,
      manifestPath,
      destinationDirectory: tamperedDestination,
      clientBundleKeys: ['fresh-animations']
    }), 'artifact-hash-mismatch');
    await assert.rejects(fs.stat(tamperedDestination), { code: 'ENOENT' });

    const wrongFormatManifest = structuredClone(manifest);
    wrongFormatManifest.id = 'wrong-pack-format';
    wrongFormatManifest.artifacts.find(item => item.key === 'fresh').resourcePack.minFormat = 83;
    const wrongFormatManifestPath = path.join(temporaryRoot, 'wrong-pack-format-manifest.json');
    validateManifest(wrongFormatManifest);
    await fs.writeFile(wrongFormatManifestPath, JSON.stringify(wrongFormatManifest, null, 2));
    const wrongFormatProfile = path.join(temporaryRoot, 'wrong-pack-format-profile');
    await makeProfile(wrongFormatProfile);
    await expectCode(queuePendingMods({
      profileRoot: wrongFormatProfile,
      manifestPath: wrongFormatManifestPath,
      clientBundleKeys: ['fresh-animations'],
      downloadFile
    }), 'artifact-identity-mismatch');
    assert.deepEqual(await fs.readdir(path.join(wrongFormatProfile, 'mods')), []);

    const reclassifiedArtifacts = ['emf', 'etf'].map(key => {
      const artifact = structuredClone(artifacts.find(item => item.key === key));
      artifact.installTarget = 'server';
      artifact.clientOnly = false;
      artifact.serverOnly = true;
      artifact.clientRequired = false;
      artifact.optional = false;
      return artifact;
    });
    const reclassifiedManifestPath = path.join(temporaryRoot, 'reclassified-client-mods-manifest.json');
    const reclassifiedManifest = await writeManifest(
      reclassifiedManifestPath, 'reclassified-client-mods', reclassifiedArtifacts);
    const reclassifiedProfile = path.join(temporaryRoot, 'reclassified-client-mods-profile');
    await makeProfile(reclassifiedProfile);
    await expectCode(queuePendingMods({
      profileRoot: reclassifiedProfile,
      manifestPath: reclassifiedManifestPath,
      downloadFile
    }), 'artifact-environment-mismatch');
    const reclassifiedPaths = profilePaths(reclassifiedProfile, reclassifiedManifest.id);
    const reclassifiedState = JSON.parse(await fs.readFile(reclassifiedPaths.queueState, 'utf8'));
    assert.equal(reclassifiedState.status, 'failed');
    assert.deepEqual(reclassifiedState.artifacts.map(item => item.status), ['failed', 'failed']);
    await fs.mkdir(path.join(reclassifiedPaths.queueFiles, 'server'), { recursive: true });
    await fs.copyFile(sourceFiles.emf, path.join(reclassifiedPaths.queueFiles, 'server', 'emf.jar'));
    await fs.copyFile(sourceFiles.etf, path.join(reclassifiedPaths.queueFiles, 'server', 'etf.jar'));
    await expectCode(applyPendingModQueue({
      profileRoot: reclassifiedProfile,
      manifestPath: reclassifiedManifestPath,
      serverStopped: true
    }), 'artifact-environment-mismatch');
    assert.deepEqual(await fs.readdir(path.join(reclassifiedProfile, 'mods')), []);

    await expectCode(applyPendingModQueue({ profileRoot: profile, manifestPath }), 'server-must-be-stopped');
    const applied = await applyPendingModQueue({
      profileRoot: profile,
      manifestPath,
      serverStopped: true,
      worldBackupLimits: { maxBytes: 4096, maxEntries: 100, diskReserveBytes: 1 }
    });
    assert.equal(applied.state, 'applied');
    assert.equal(applied.installedCount, 2);
    assert.ok(applied.worldBackup?.relativePath, 'Lootr must force a world backup before installation');
    const backupRoot = path.join(profile, ...applied.worldBackup.relativePath.split('/'));
    assert.deepEqual(await fs.readFile(path.join(backupRoot, 'world', 'level.dat')), Buffer.alloc(32, 0x5a));
    assert.deepEqual((await fs.readdir(path.join(profile, 'mods'))).sort(), ['lootr.jar', 'servercore.jar']);
    assert.equal((await applyPendingModQueue({
      profileRoot: profile,
      manifestPath,
      serverStopped: true,
      worldBackupLimits: { maxBytes: 4096, maxEntries: 100, diskReserveBytes: 1 }
    })).state, 'already-applied');
    await expectCode(rollbackPendingModApplication({ profileRoot: profile, serverStopped: true }), 'world-restore-required');
    const rolledBack = await rollbackPendingModApplication({
      profileRoot: profile,
      serverStopped: true,
      confirmWorldUnchangedSinceApply: true
    });
    assert.equal(rolledBack.state, 'rolled-back');
    assert.deepEqual(await fs.readdir(path.join(profile, 'mods')), []);

    const optionalProfile = path.join(temporaryRoot, 'optional-profile');
    await makeProfile(optionalProfile);
    const allQueued = await queuePendingMods({
      profileRoot: optionalProfile,
      manifestPath,
      includeOptionalServer: true,
      includeClientOptional: true,
      downloadFile
    });
    assert.equal(allQueued.serverCount, 3);
    assert.equal(allQueued.optionalServerCount, 1);
    assert.equal(allQueued.clientOptionalCount, 5);
    assert.equal(allQueued.clientModCount, 4);
    assert.equal(allQueued.clientResourcePackCount, 1);
    const fullClientBundle = await exportClientModBundle({
      profileRoot: optionalProfile,
      manifestPath,
      includeClientOptional: true
    });
    assert.equal(fullClientBundle.clientRequiredCount, 1);
    assert.equal(fullClientBundle.clientOptionalCount, 5);
    assert.equal(fullClientBundle.clientResourcePackCount, 1);
    assert.equal(fullClientBundle.includedCount, 3);
    assert.equal(fullClientBundle.referencedCount, 3);
    assert.deepEqual((await fs.readdir(path.join(fullClientBundle.destination, 'mods'))).sort(),
      ['litematica.jar', 'lootr.jar', 'malilib.jar']);
    await assert.rejects(fs.stat(path.join(fullClientBundle.destination, 'resourcepacks')), { code: 'ENOENT' });
    await applyPendingModQueue({
      profileRoot: optionalProfile,
      manifestPath,
      serverStopped: true,
      worldBackupLimits: { maxBytes: 4096, maxEntries: 100, diskReserveBytes: 1 }
    });
    assert.deepEqual((await fs.readdir(path.join(optionalProfile, 'mods'))).sort(), ['lootr.jar', 'servercore.jar']);
    const optionalApply = await applyPendingModQueue({
      profileRoot: optionalProfile,
      manifestPath,
      serverStopped: true,
      optionalServerKeys: ['chunky'],
      worldBackupLimits: { maxBytes: 4096, maxEntries: 100, diskReserveBytes: 1 }
    });
    assert.equal(optionalApply.installedCount, 1);
    assert.deepEqual((await fs.readdir(path.join(optionalProfile, 'mods'))).sort(), ['chunky.jar', 'lootr.jar', 'servercore.jar']);
    assert.ok(!(await fs.readdir(path.join(optionalProfile, 'mods'))).includes('litematica.jar'));
    assert.ok(!(await fs.readdir(path.join(optionalProfile, 'mods'))).includes('malilib.jar'));
    assert.ok(!(await fs.readdir(path.join(optionalProfile, 'mods'))).includes('emf.jar'));
    assert.ok(!(await fs.readdir(path.join(optionalProfile, 'mods'))).includes('etf.jar'));
    assert.ok(!(await fs.readdir(path.join(optionalProfile, 'mods'))).includes('fresh.zip'));

    const conflictProfile = path.join(temporaryRoot, 'conflict-profile');
    await makeProfile(conflictProfile);
    await queuePendingMods({ profileRoot: conflictProfile, manifestPath, downloadFile });
    const conflictingLootr = path.join(conflictProfile, 'mods', 'old-lootr.jar');
    await makeFabricJar(conflictingLootr, { id: 'lootr', version: '0.9.0', marker: 'different' });
    await expectCode(applyPendingModQueue({
      profileRoot: conflictProfile,
      manifestPath,
      serverStopped: true,
      worldBackupLimits: { maxBytes: 4096, maxEntries: 100, diskReserveBytes: 1 }
    }), 'mod-conflict');
    assert.deepEqual(await fs.readdir(path.join(conflictProfile, 'mods')), ['old-lootr.jar']);
    await assert.rejects(fs.stat(path.join(conflictProfile, 'pending-mods', 'world-backups')), { code: 'ENOENT' });

    const tooLargeProfile = path.join(temporaryRoot, 'too-large-profile');
    await makeProfile(tooLargeProfile, { worldBytes: 1024 });
    await queuePendingMods({ profileRoot: tooLargeProfile, manifestPath, downloadFile });
    await expectCode(applyPendingModQueue({
      profileRoot: tooLargeProfile,
      manifestPath,
      serverStopped: true,
      worldBackupLimits: { maxBytes: 100, maxEntries: 100, diskReserveBytes: 1 }
    }), 'world-backup-too-large');
    assert.deepEqual(await fs.readdir(path.join(tooLargeProfile, 'mods')), [], 'backup failure must happen before mods change');

    const replacementSource = path.join(sources, 'replacement.jar');
    await makeFabricJar(replacementSource, { id: 'replaceable', version: '2.0.0' });
    const replacementArtifact = await artifactFor(replacementSource, {
      key: 'replaceable', replaceExisting: true
    });
    const replacementManifestPath = path.join(temporaryRoot, 'replacement-manifest.json');
    await writeManifest(replacementManifestPath, 'replacement-fixture', [replacementArtifact]);
    const replacementProfile = path.join(temporaryRoot, 'replacement-profile');
    await makeProfile(replacementProfile);
    const oldJar = path.join(replacementProfile, 'mods', 'replaceable.jar');
    await makeFabricJar(oldJar, { id: 'replaceable', version: '1.0.0', marker: 'old' });
    const oldBytes = await fs.readFile(oldJar);
    await queuePendingMods({
      profileRoot: replacementProfile,
      manifestPath: replacementManifestPath,
      downloadFile: async (_artifact, destination) => fs.copyFile(replacementSource, destination)
    });
    await applyPendingModQueue({ profileRoot: replacementProfile, manifestPath: replacementManifestPath, serverStopped: true });
    assert.notDeepEqual(await fs.readFile(oldJar), oldBytes);
    const replacementPaths = profilePaths(replacementProfile, 'replacement-fixture');
    const interrupted = JSON.parse(await fs.readFile(replacementPaths.activeTransaction, 'utf8'));
    interrupted.status = 'applying';
    await fs.writeFile(replacementPaths.activeTransaction, JSON.stringify(interrupted, null, 2));
    const recovered = await recoverPendingModTransaction({ profileRoot: replacementProfile, serverStopped: true });
    assert.equal(recovered.state, 'recovered');
    assert.deepEqual(await fs.readFile(oldJar), oldBytes, 'recovery must restore the exact pre-transaction JAR');

    const corruptProfile = path.join(temporaryRoot, 'corrupt-profile');
    await makeProfile(corruptProfile);
    const oneManifestPath = path.join(temporaryRoot, 'one-manifest.json');
    await writeManifest(oneManifestPath, 'corrupt-fixture', [artifacts[1]]);
    await expectCode(queuePendingMods({
      profileRoot: corruptProfile,
      manifestPath: oneManifestPath,
      downloadFile: async (_artifact, destination) => fs.writeFile(destination, Buffer.from('not the published jar'))
    }), 'artifact-size-mismatch');
    const corruptPaths = profilePaths(corruptProfile, 'corrupt-fixture');
    await assert.rejects(fs.stat(path.join(corruptPaths.queueFiles, 'server', 'servercore.jar')), { code: 'ENOENT' });

    const backupOnlyProfile = path.join(temporaryRoot, 'backup-only-profile');
    await makeProfile(backupOnlyProfile);
    const backupOnly = await createBoundedWorldBackup({
      profileRoot: backupOnlyProfile,
      serverStopped: true,
      reasons: ['test'],
      limits: { maxBytes: 4096, maxEntries: 100, diskReserveBytes: 1 }
    });
    assert.equal(backupOnly.ok, true);
    assert.equal(backupOnly.worldPresent, true);

    process.stdout.write('pending mod queue tests passed\n');
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
module.exports = { makeFabricJar, artifactFor, makeProfile, writeManifest };
