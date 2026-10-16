const settings = window.bridge.loadAppSettings();
const customThemeDefaults = {
  accent: '#1683c7',
  main: '#101010',
  shadow: '#000000',
  text: '#ffffff',
  highlight: '#42a5f5',
  scrollbarTrack: '#191919',
  scrollbarThumb: '#575757',
  scrollbarThumbHover: '#777777'
};
let customTheme = { ...customThemeDefaults, ...(settings.customTheme || {}) };
document.getElementById('appLanguage').value = settings.language || 'en';
document.getElementById('cpsDisplayMode').value = settings.cpsDisplayMode || 'total';
const ids = ['alwaysOnTop', 'autoUpdate', 'reopenAfterUpdate', 'keepMinecraftServerRunningDuringUpdate', 'showActiveIndicator', 'showCpsIndicator', 'cpsIncludePhysicalClicks', 'showCpsAlways', 'showInputDisplay'];
for (const id of ids) document.getElementById(id).checked = Boolean(settings[id]);
const backgroundToolControls = {
  'auto-clicker': 'backgroundAutoClicker',
  macro: 'backgroundMacro',
  crosshair: 'backgroundCrosshair',
  voice: 'backgroundVoice'
};
const availableTools = window.bridge.getWindowContext()?.availableTools;
if (Array.isArray(availableTools)) {
  for (const [tool, id] of Object.entries(backgroundToolControls)) {
    if (!availableTools.includes(tool)) document.getElementById(id).closest('label').hidden = true;
  }
}
for (const [tool, id] of Object.entries(backgroundToolControls)) {
  document.getElementById(id).checked = Array.isArray(settings.backgroundTools) && settings.backgroundTools.includes(tool);
}
let activeIndicatorPoint = settings.activeIndicatorPoint || null;
let cpsIndicatorPoint = settings.cpsIndicatorPoint || null;
const coordinateLabel = point => point ? `X ${point.x} · Y ${point.y}` : '—';
const updateCoordinateLabels = () => {
  document.getElementById('activeIndicatorCoordinates').textContent = coordinateLabel(activeIndicatorPoint);
  document.getElementById('cpsIndicatorCoordinates').textContent = coordinateLabel(cpsIndicatorPoint);
};
updateCoordinateLabels();
const updateCheckButton = document.getElementById('checkUpdateButton');
const updateCheckStatus = document.getElementById('updateCheckStatus');
let settingsUpdateAvailable = false;
updateCheckButton.addEventListener('click', async () => {
  if (settingsUpdateAvailable) {
    updateCheckButton.disabled = true;
    updateCheckStatus.textContent = 'Starting the updater…';
    const result = await window.bridge.installUpdate();
    if (result?.started === false) {
      updateCheckButton.disabled = false;
      updateCheckStatus.textContent = result.reason || 'The update could not be started.';
    }
    return;
  }
  updateCheckButton.disabled = true;
  updateCheckButton.textContent = 'Checking…';
  updateCheckStatus.textContent = 'Checking for a newer version…';
  window.bridge.checkForUpdates(true);
});
window.bridge.onUpdateStatus(status => {
  if (status.status === 'available') {
    settingsUpdateAvailable = status.canInstall !== false;
    updateCheckButton.disabled = !settingsUpdateAvailable;
    updateCheckButton.classList.toggle('update-ready', settingsUpdateAvailable);
    updateCheckButton.textContent = settingsUpdateAvailable ? `Update to ${status.version}` : 'Update available';
    updateCheckStatus.textContent = settingsUpdateAvailable ? `Version ${status.version} is ready to install.` : `Version ${status.version} is available.`;
  } else if (status.status === 'checking') {
    updateCheckButton.disabled = true;
    updateCheckButton.textContent = 'Checking…';
    updateCheckStatus.textContent = 'Checking for a newer version…';
  } else if (status.status === 'current') {
    settingsUpdateAvailable = false;
    updateCheckButton.disabled = false;
    updateCheckButton.classList.remove('update-ready');
    updateCheckButton.textContent = 'Check for updates';
    updateCheckStatus.textContent = `Version ${status.currentVersion || ''} is up to date.`.trim();
  } else if (status.status === 'error' || status.status === 'not-configured') {
    settingsUpdateAvailable = false;
    updateCheckButton.disabled = false;
    updateCheckButton.classList.remove('update-ready');
    updateCheckButton.textContent = 'Try again';
    updateCheckStatus.textContent = status.message || 'Could not check for updates.';
  }
});
window.bridge.checkForUpdates(false);
const selectedTheme = document.querySelector(`input[name="theme"][value="${settings.theme || 'obsidian'}"]`) || document.querySelector('input[name="theme"]');
selectedTheme.checked = true;
window.applyClickIntervalTheme({ theme: selectedTheme.value, customTheme });

function settingsValue() {
  const value = Object.fromEntries(ids.map(id => [id, document.getElementById(id).checked]));
  value.language = document.getElementById('appLanguage').value;
  value.activeIndicatorPosition = settings.activeIndicatorPosition || 'bottom-right';
  value.activeIndicatorPoint = activeIndicatorPoint;
  value.cpsIndicatorPosition = settings.cpsIndicatorPosition || 'bottom-right';
  value.cpsIndicatorPoint = cpsIndicatorPoint;
  value.cpsDisplayMode = document.getElementById('cpsDisplayMode').value;
  value.backgroundTools = Object.entries(backgroundToolControls).filter(([, id]) => document.getElementById(id).checked).map(([tool]) => tool);
  value.theme = document.querySelector('input[name="theme"]:checked')?.value || 'obsidian';
  value.customTheme = { ...customTheme };
  return value;
}

function markChanged() {
  const value = settingsValue();
  window.bridge.updateSettingsDraft(value);
}

document.getElementById('showActiveIndicator').addEventListener('change', event => {
  document.getElementById('pickActiveIndicatorPosition').disabled = !event.target.checked;
});
document.getElementById('pickActiveIndicatorPosition').disabled = !document.getElementById('showActiveIndicator').checked;
document.getElementById('showCpsIndicator').addEventListener('change', event => {
  document.getElementById('pickCpsIndicatorPosition').disabled = !event.target.checked;
  document.getElementById('cpsIncludePhysicalClicks').disabled = !event.target.checked;
  document.getElementById('showCpsAlways').disabled = !event.target.checked;
  document.getElementById('cpsDisplayMode').disabled = !event.target.checked;
});
document.getElementById('pickCpsIndicatorPosition').disabled = !document.getElementById('showCpsIndicator').checked;
document.getElementById('cpsIncludePhysicalClicks').disabled = !document.getElementById('showCpsIndicator').checked;
document.getElementById('showCpsAlways').disabled = !document.getElementById('showCpsIndicator').checked;
document.getElementById('cpsDisplayMode').disabled = !document.getElementById('showCpsIndicator').checked;

async function pickOverlayPosition(kind) {
  const button = document.getElementById(kind === 'active' ? 'pickActiveIndicatorPosition' : 'pickCpsIndicatorPosition');
  button.disabled = true;
  const result = await window.bridge.pickScreenPoint();
  button.disabled = kind === 'active'
    ? !document.getElementById('showActiveIndicator').checked
    : !document.getElementById('showCpsIndicator').checked;
  if (!result || result.canceled) return;
  const point = { x: Math.round(Number(result.x)), y: Math.round(Number(result.y)) };
  if (kind === 'active') activeIndicatorPoint = point;
  else cpsIndicatorPoint = point;
  updateCoordinateLabels();
  markChanged();
}

document.getElementById('pickActiveIndicatorPosition').addEventListener('click', () => pickOverlayPosition('active'));
document.getElementById('pickCpsIndicatorPosition').addEventListener('click', () => pickOverlayPosition('cps'));
const settingsMain = document.querySelector('main');
const themeGrid = document.querySelector('.theme-grid');
let themeSelectionScrollTop = settingsMain.scrollTop;
const rememberThemeScroll = () => { themeSelectionScrollTop = settingsMain.scrollTop; };
themeGrid.addEventListener('pointerdown', rememberThemeScroll, true);
themeGrid.addEventListener('keydown', rememberThemeScroll, true);
themeGrid.addEventListener('change', () => {
  const restoreScroll = () => { settingsMain.scrollTop = themeSelectionScrollTop; };
  const value = settingsValue();
  window.applyClickIntervalTheme(value);
  restoreScroll();
  requestAnimationFrame(restoreScroll);
});

const customThemeDialog = document.getElementById('customThemeDialog');
const customInputs = {
  accent: document.getElementById('customAccent'),
  main: document.getElementById('customMain'),
  shadow: document.getElementById('customShadow'),
  text: document.getElementById('customText'),
  highlight: document.getElementById('customHighlight'),
  scrollbarTrack: document.getElementById('customScrollbarTrack'),
  scrollbarThumb: document.getElementById('customScrollbarThumb'),
  scrollbarThumbHover: document.getElementById('customScrollbarThumbHover')
};
let customThemeBeforeEdit = null;
function openCustomThemeEditor() {
  if (customThemeDialog.open) return;
  customThemeBeforeEdit = { ...customTheme };
  for (const [key, input] of Object.entries(customInputs)) input.value = customTheme[key];
  customThemeDialog.showModal();
}
function previewCustomTheme() {
  customTheme = Object.fromEntries(Object.entries(customInputs).map(([key, input]) => [key, input.value]));
  window.applyClickIntervalTheme({ theme: 'custom', customTheme });
}
for (const input of Object.values(customInputs)) input.addEventListener('input', previewCustomTheme);
document.getElementById('saveCustomTheme').addEventListener('click', () => {
  previewCustomTheme();
  customThemeDialog.close();
  markChanged();
});
document.getElementById('cancelCustomTheme').addEventListener('click', () => {
  customTheme = { ...(customThemeBeforeEdit || customTheme) };
  customThemeDialog.close();
  window.applyClickIntervalTheme(settingsValue());
});
customThemeDialog.addEventListener('cancel', event => {
  event.preventDefault();
  document.getElementById('cancelCustomTheme').click();
});
document.querySelector('input[name="theme"][value="custom"]').closest('label').addEventListener('click', event => {
  if (event.target.closest('dialog')) return;
  requestAnimationFrame(openCustomThemeEditor);
});

document.getElementById('saveSettings').addEventListener('click', () => {
  window.bridge.saveAppSettings(settingsValue());
});
document.querySelectorAll('main input,main select').forEach(control => control.addEventListener('change', markChanged));
document.getElementById('cancelSettings').addEventListener('click', () => window.bridge.closeCurrentWindow());
addEventListener('keydown', event => {
  if (customThemeDialog.open) return;
  if (event.key === 'Escape') window.bridge.closeCurrentWindow();
  if (event.key === 'Enter') document.getElementById('saveSettings').click();
});
