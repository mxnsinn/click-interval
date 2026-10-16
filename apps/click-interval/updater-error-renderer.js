const errorMessage = document.getElementById('errorMessage');
const errorVersions = document.getElementById('errorVersions');

window.updaterBridge.onErrorDetails(payload => {
  document.documentElement.dataset.theme = payload.theme || 'obsidian';
  errorVersions.textContent = `Version ${payload.currentVersion} to version ${payload.targetVersion}`;
  errorMessage.textContent = payload.message;
});

document.getElementById('minimizeError').addEventListener('click', () => window.updaterBridge.windowControl('minimize'));
document.getElementById('closeError').addEventListener('click', () => window.updaterBridge.windowControl('close'));
document.getElementById('closeErrorButton').addEventListener('click', () => window.updaterBridge.windowControl('close'));
