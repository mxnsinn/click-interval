const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const renderer = fs.readFileSync('renderer.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const updaterMain = fs.readFileSync('updater-main.js', 'utf8');
const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
const updateLock = fs.readFileSync('update-lock.js', 'utf8');
const updateDownload = fs.readFileSync('update-download.js', 'utf8');
const updateConfig = JSON.parse(fs.readFileSync('update-config.json', 'utf8'));
const updateBuilder = fs.readFileSync('build-development-update.ps1', 'utf8');

const localStage = main.indexOf("release-manifest.json");
const remoteFetch = main.indexOf('fetchBoundedUpdateManifest({');
const versionGuard = updateBuilder.indexOf("Update version '$Version' must match package.json version");
const destinationReplacement = updateBuilder.indexOf('if (Test-Path -LiteralPath $destination)');
const applyStart = updaterMain.indexOf('async function applyDevelopmentUpdate');
const applyEnd = updaterMain.indexOf('async function downloadInstaller');
const applyBlock = updaterMain.slice(applyStart, applyEnd);
const installedVersionValidation = applyBlock.indexOf("const installedPackage = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8'));");
const installedManifestCopy = applyBlock.indexOf('installBytes(releaseManifestRelativePath, releaseManifestBytes)');
const installedManifestValidation = applyBlock.indexOf("const installedRelease = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'));");
const rollbackCatch = applyBlock.indexOf('} catch (error) {');
const checks = {
  stagedReleaseFirst: localStage >= 0 && remoteFetch >= 0 && localStage < remoteFetch,
  renamedElectronSupportsStaging: !main.includes("if (!app.isPackaged && typeof config.stagedUpdatePath") && !main.includes("manifest.developmentUpdate === true && !app.isPackaged"),
  stagedReleaseMustMatchSignal: main.includes("String(stagedRelease?.version || '') === String(manifest.version)") && main.includes("stagedRelease.files.length > 0"),
  remoteUpdateChannelConfigured: /^https:\/\//i.test(updateConfig.manifestUrl) && updateConfig.stagedUpdatePath == null,
  releasePublishesStableSignal: updateBuilder.includes("$latest = Join-Path $updatesRoot 'latest'") && updateBuilder.includes("Move-Item -LiteralPath $latestNext -Destination $latest"),
  stagedNotesReachUpdateUi: main.includes("typeof release.notes === 'string' ? release.notes"),
  stagedUpdatesStayManual: main.includes("manualOnly: release.manualOnly !== false") && updateBuilder.includes('manualOnly = $true'),
  stagedChannelSurvivesUpdate: updateBuilder.includes('$localUpdateConfig.stagedUpdatePath = $latest'),
  remoteManifestIsBounded: main.includes('fetchBoundedUpdateManifest')
    && updateDownload.includes('MAX_UPDATE_MANIFEST_BYTES = 256 * 1024')
    && updateDownload.includes('UPDATE_MANIFEST_TIMEOUT_MS = 15_000'),
  remoteManifestMustBeSigned: main.includes('verifySignedUpdateManifest(signedEnvelope, config.manifestPublicKey)')
    && typeof updateConfig.manifestPublicKey === 'string'
    && updateConfig.manifestPublicKey.length > 40
    && updateBuilder.includes("'update-manifest.js'"),
  concurrentChecksAreCoalesced: main.includes('let updateCheckPromise = null;')
    && main.includes('if (updateCheckPromise) return updateCheckPromise;')
    && main.includes('updateCheckPromise = performUpdateCheck().finally'),
  buildVersionCheckedBeforeReplacement: versionGuard >= 0 && destinationReplacement >= 0 && versionGuard < destinationReplacement,
  installedVersionMismatchRollsBack: installedVersionValidation >= 0 && rollbackCatch >= 0 && installedVersionValidation < rollbackCatch,
  installedManifestIsTransactional: installedManifestCopy >= 0
    && installedManifestValidation > installedManifestCopy
    && installedManifestValidation < rollbackCatch
    && applyBlock.includes("copied.push({ path: relativePath, hadBackup, temporary })")
    && applyBlock.includes('if (copiedFile.hadBackup) {')
    && applyBlock.includes('if (fs.existsSync(backup)) fs.copyFileSync(backup, destination);'),
  freshCheckBeforeInstall: /ipcMain\.handle\('install-update',[\s\S]*?await checkForUpdates\(\{ manual: true \}\)/.test(main),
  errorsOfferRetry: /status\.status === 'error'[\s\S]*?updateButton\.hidden = false[\s\S]*?updateButton\.classList\.add\('check-mode'\)/.test(renderer),
  unavailableNeverAdvertised: !renderer.includes("'Update unavailable'"),
  unavailableResultHidesIcon: /result && result\.started === false[\s\S]*?updateWindowButton\.hidden = true/.test(renderer),
  neutralAtRest: styles.includes('.window-buttons .update-window { position: relative; width: 34px; color: #ccc; }'),
  accentOnlyOnInteraction: styles.includes('.update-window:hover:not(:disabled), .window-buttons .update-window.working')
  ,isolatedUpdateTransactions: updaterMain.includes('acquireUpdateLock(applicationRoot)')
    && updaterMain.includes("path.join(backupContainer, updateLock.transactionId)")
    && updaterMain.includes('`${destination}.update-temp-${updateLock.transactionId}`')
    && updaterMain.includes('fs.rmSync(backupRoot, { recursive: true, force: true })')
    && !main.includes('pruneSuccessfulUpdateBackups()'),
  rollbackNeverDeletesPreexistingFilesWithoutBackup: updaterMain.includes('if (copiedFile.hadBackup) {')
    && updaterMain.includes('else rollbackProblems.push(copiedFile.path);')
    && !updaterMain.includes('if (copiedFile.hadBackup && fs.existsSync(backup)) fs.copyFileSync(backup, destination)\n        else if (fs.existsSync(destination)) fs.unlinkSync(destination);'),
  installedPayloadReverified: updaterMain.includes('The installed file ${file.path} failed verification.')
  ,ordinaryLaunchWaitsForUpdater: bootstrap.includes("process.argv.includes('--update-payload')")
    && bootstrap.includes('isUpdateLockActive(__dirname)')
    && bootstrap.indexOf("require('./updater-main')") < bootstrap.indexOf('isUpdateLockActive(__dirname)')
    && bootstrap.indexOf('isUpdateLockActive(__dirname)') < bootstrap.indexOf("require('./main')"),
  corruptOrDeadLocksRecover: updateLock.includes("reason: 'dead-owner'")
    && updateLock.includes("reason: 'corrupt'")
    && updateLock.includes('removeStaleUpdateLock(snapshot, options)'),
  bootstrapDependencyInstallsFirst: updaterMain.includes("if (normalized === 'update-lock.js') return 0;")
    && updaterMain.includes("if (normalized === 'bootstrap.js') return 1;")
    && updaterMain.includes('for (const file of installFiles)'),
  updaterNeverWritesOverLiveApp: updaterMain.includes("throw new Error('Click Interval is still running. Close it completely, then try the update again.')")
    && updaterMain.includes('const { acquireUpdateLock, processExists, releaseUpdateLock }')
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Update state checks failed: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
