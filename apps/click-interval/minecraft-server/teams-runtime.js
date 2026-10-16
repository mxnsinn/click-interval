'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertPlainPath } = require('./world-reset');
const MOD_ID = 'serverteams_fabric';
const VERSION = '1.0.5';
const ARTIFACT = `ServerTeams-Fabric-${VERSION}+mc26.2.jar`;
const RELEASES = Object.freeze({
  '1.0.0': 'a0aeae12c47262242ba9f8941251d434a0f8ff72d49581b4bfd7c316802b0a9a',
  '1.0.1': 'cf25fbe7f88eade8173deff7aa5ef72d8ad3026b6651cfa4b9efa4e2884feff2',
  '1.0.2': '8e3941d226e8bd7993148bcd343c8a6ff8fb3f4939a06d8875c266662ae7f4b2',
  '1.0.3': '85ab0cb21a27b6a0a2e6529978a9d76af642677e7b890448eae225b26c82f23f',
  '1.0.4': '923b50c99160c2825b745aeb91be0d776849c7d8d0385dadcdfd4b242d8e76a4',
  '1.0.5': 'fb73442c79342b985d3bab58deeee7a2adcecf628c803249dd768f145a6287b3'
});
const SHA256 = RELEASES[VERSION];
function isSupported(config, platform = {}) {
  const build = String(platform.build || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  const loaderSupported = Boolean(build && (Number(build[1]) > 0 || Number(build[2]) > 19 || (Number(build[2]) === 19 && Number(build[3]) >= 5)));
  return config?.serverType === 'fabric' && platform.verified === true && platform.compatible !== false &&
    String(platform.minecraftVersion || config.serverVersion) === '26.2' && loaderSupported;
}
function isFabricApiVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)\+26\.2$/);
  return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 161));
}
function isTeamsMod(descriptor) {
  return descriptor?.fabricModId === MOD_ID && descriptor.fabricMainEntrypoints?.includes('dev.serverteams.fabric.ServerTeams') &&
    ['26.2', '=26.2'].includes(descriptor.fabricMinecraftDependency) && descriptor.fabricEnvironment !== 'client';
}
function isKnown(descriptor) {
  return isTeamsMod(descriptor) && Object.hasOwn(RELEASES, descriptor.fabricVersion) && RELEASES[descriptor.fabricVersion] === descriptor.sha256;
}
function checkedIndex(index) {
  if (index.partial) throw Error('The mods folder could not be fully checked before preparing Teams.');
  const installed = index.files.filter(entry => entry.descriptor?.fabricModId === MOD_ID);
  if (installed.length > 1) throw Error('Multiple Teams mods are installed. Resolve duplicates while stopped before starting.');
  const apis = index.files.filter(entry => entry.descriptor?.fabricModId === 'fabric-api');
  if (apis.length > 1 || (apis.length && !isFabricApiVersion(apis[0].descriptor.fabricVersion))) throw Error('Teams requires one Fabric API version 0.161.0 or later for Minecraft 26.2.');
  for (const entry of [...installed, ...apis]) {
    if (typeof entry.name !== 'string' || path.basename(entry.name) !== entry.name || /[\\/:]/.test(entry.name)) throw Error('The installed Teams runtime path could not be verified.');
  }
  return { existing: installed[0], api: apis[0] };
}

// Called only inside the manager's stopped-profile start transaction. Saved team
// membership and world data are never opened or changed by this installer.
async function prepareRuntime({ root, mods, artifact, dependency, inspectJar, getIndex, revalidate }) {
  await revalidate(); await assertPlainPath(root, mods);
  const bundled = await inspectJar(artifact);
  if (!isKnown(bundled) || bundled.fabricVersion !== VERSION) throw Error('Bundled Teams runtime failed its integrity check.');
  const { existing, api } = checkedIndex(await getIndex());
  const target = path.join(mods, existing?.name || 'ServerTeams-Fabric.jar');
  await assertPlainPath(root, target);
  if (api) await assertPlainPath(root, path.join(mods, api.name));
  let previous = null;
  try { previous = await inspectJar(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if ((existing && !previous) || (previous && !isKnown(previous))) throw Error('The existing Teams JAR differs from known releases and was left unchanged.');
  if (previous?.sha256 === SHA256 && api) return { installed: true, updated: false, previouslyInstalled: true, backup: '' };

  const temporary = `${target}.teams-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  let backup = '', published = false, dependencyPublished = '';
  await fs.mkdir(mods, { recursive: true });
  try {
    if (!api) {
      if (!dependency) throw Error('Bundled Fabric API is missing. Install Fabric API for Minecraft 26.2 before starting.');
      const checked = await inspectJar(dependency.path);
      if (checked.fabricModId !== 'fabric-api' || checked.sha256 !== dependency.sha256 || !isFabricApiVersion(checked.fabricVersion)) throw Error('Bundled Fabric API failed its integrity check.');
      const destination = path.join(mods, path.basename(dependency.path));
      await revalidate(); await assertPlainPath(root, destination);
      await fs.copyFile(dependency.path, destination, 1); dependencyPublished = destination;
      if ((await inspectJar(destination)).sha256 !== dependency.sha256) throw Error('Fabric API changed during copy.');
    }
    if (previous?.sha256 !== SHA256) {
      await fs.copyFile(artifact, temporary, 1);
      if ((await inspectJar(temporary)).sha256 !== SHA256) throw Error('Teams runtime changed during copy.');
      await revalidate(); await assertPlainPath(root, target);
      const fresh = checkedIndex(await getIndex());
      if (fresh.existing?.name !== existing?.name || !fresh.api) throw Error('The mods folder changed during Teams preparation.');
      if (previous) {
        if ((await inspectJar(target)).sha256 !== previous.sha256) throw Error('The installed Teams runtime changed during preparation.');
        backup = path.join(root, '.click-interval-teams-backups', `${path.basename(target)}-${previous.sha256}.backup`);
        await assertPlainPath(root, backup); await fs.mkdir(path.dirname(backup), { recursive: true });
        try { await fs.copyFile(target, backup, 1); } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        if ((await inspectJar(backup)).sha256 !== previous.sha256) throw Error('The Teams backup failed verification.');
        await fs.rename(temporary, target);
      } else {
        await fs.link(temporary, target);
      }
      published = true;
    }
    await revalidate();
    if ((await inspectJar(target)).sha256 !== SHA256) throw Error('Prepared Teams runtime failed verification.');
    return { installed: true, updated: published, previouslyInstalled: Boolean(previous), backup };
  } catch (error) {
    // Never undo an unrelated external edit made after we installed our bytes.
    try {
      if (published) {
        await assertPlainPath(root, target);
        if ((await inspectJar(target)).sha256 !== SHA256) throw Error('Teams rollback refused because the installed JAR changed.');
        if (backup) { await fs.copyFile(backup, temporary); await fs.rename(temporary, target); }
        else await fs.rm(target);
      }
      if (dependencyPublished) {
        await assertPlainPath(root, dependencyPublished);
        if ((await inspectJar(dependencyPublished)).sha256 !== dependency.sha256) throw Error('Fabric API rollback refused because the installed JAR changed.');
        await fs.rm(dependencyPublished);
      }
    } catch (rollbackError) { throw new AggregateError([error, rollbackError], `${error.message} ${rollbackError.message}`); }
    throw error;
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

module.exports = { MOD_ID, VERSION, ARTIFACT, RELEASES, SHA256, isSupported, isFabricApiVersion, isTeamsMod, prepareRuntime };
