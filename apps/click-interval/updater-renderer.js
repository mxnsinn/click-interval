const versions = document.getElementById('versions');
const status = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const progressTrack = document.querySelector('.progress-track');

window.updaterBridge.onDetails(payload => {
  document.documentElement.dataset.theme = payload.theme || 'obsidian';
  versions.textContent = `Updating from version ${payload.currentVersion} to version ${payload.targetVersion}`;
});

window.updaterBridge.onProgress(payload => {
  status.textContent = payload.status;
  document.getElementById('cancelUpdate').disabled = payload.cancelable === false;
  const progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
  progressBar.style.width = `${progress}%`;
  progressTrack.setAttribute('aria-valuenow', String(progress));
});

document.getElementById('minimizeUpdater').addEventListener('click', () => window.updaterBridge.windowControl('minimize'));
document.getElementById('closeUpdater').addEventListener('click', () => window.updaterBridge.windowControl('close'));
document.getElementById('cancelUpdate').addEventListener('click', () => {
  document.getElementById('cancelUpdate').disabled = true;
  window.updaterBridge.cancel();
});

window.updaterBridge.ready();
