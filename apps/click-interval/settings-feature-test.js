const fs = require('fs');
const read = file => fs.readFileSync(file, 'utf8');
const index = read('index.html');
const settings = read('settings.html');
const renderer = read('renderer.js');
const main = read('main.js');
const updater = read('updater-main.js');
const build = read('build-development-update.ps1');

const requiredSettings = ['alwaysOnTop', 'autoUpdate', 'reopenAfterUpdate', 'showActiveIndicator', 'pickActiveIndicatorPosition', 'backgroundAutoClicker', 'backgroundMacro', 'backgroundCrosshair'];
const checks = {
  settingsButton: index.includes('id="settingsWindow"') && renderer.includes('openSettingsWindow'),
  completeVersionTooltip: renderer.includes("Click Interval V ${initialWindowContext.appVersion || '1.5'}"),
  modalSettingsWindow: main.includes('async function createSettingsWindow') && main.includes('modal: true') && main.includes('publishPopupState(true)'),
  settingsControls: requiredSettings.every(id => settings.includes(`id="${id}"`)),
  windowLevelToggle: main.includes('function applyAppWindowLevel') && main.includes('setAlwaysOnTop(false)'),
  automaticUpdate: main.includes('loadAppSettings().autoUpdate') && main.includes('autoUpdateLaunching'),
  reopenAfterUpdate: main.includes('reopenAfterUpdate: loadAppSettings().reopenAfterUpdate') && updater.includes("'--click-interval-launch'"),
  clickThroughIndicator: main.includes('setIgnoreMouseEvents(true') && main.includes("'bottom-right'"),
  runtimeFilesPackaged: ['settings.html', 'settings.css', 'settings-window.js', 'active-indicator.html'].every(file => build.includes(`'${file}'`))
  ,scrollableSettings: read('settings.css').includes('overflow-y: auto')
  ,unsavedClosePrompt: main.includes('createSettingsUnsavedWindow') && main.includes("choice === 'save'") && read('settings-unsaved.html').includes("Don't save")
  ,themeChoices: ['obsidian','light','crimson','ocean','rose'].every(theme => settings.includes(`value="${theme}"`))
  ,advancedThemeChoices: settings.includes('value="custom"') && !settings.includes('transparent-tinted') && !settings.includes('transparent-light')
  ,customThemeEditor: ['customAccent','customMain','customShadow','customText','customHighlight','customScrollbarTrack','customScrollbarThumb','customScrollbarThumbHover'].every(id => settings.includes(`id="${id}"`))
    && !settings.includes('custom-theme-preview') && !settings.includes('editCustomTheme')
    && read('settings-window.js').includes("closest('label').addEventListener('click'")
  ,customScrollbarTheme: ['scrollbarTrack','scrollbarThumb','scrollbarThumbHover'].every(key => main.includes(`${key}: normalizeColor`))
    && ['--theme-scrollbar-track','--theme-scrollbar-thumb','--theme-scrollbar-thumb-hover'].every(property => read('theme-loader.js').includes(property))
  ,themeAppliesOnlyOnSave: !read('settings-window.js').includes('document.documentElement.dataset.theme = value.theme') && read('settings-window.js').includes('saveAppSettings(settingsValue())')
  ,stableScrollViewport: read('settings.css').includes('height: calc(100vh - 32px)') && read('settings.css').includes('overscroll-behavior: contain')
  ,themeCardsBoundInputs: read('settings.css').includes('inset: 0; width: 100%; height: 100%') && !read('settings.css').includes('pointer-events: none')
  ,themeSelectionKeepsScroll: read('settings-window.js').includes('themeSelectionScrollTop') && read('settings-window.js').includes('requestAnimationFrame(restoreScroll)')
  ,selectableBackgroundTools: main.includes('function toolIsOperational') && main.includes("backgroundTools.includes(tool)") && read('settings-window.js').includes('backgroundToolControls')
  ,inputDisplayEditorDeferred: settings.includes('id="showInputDisplay"')
    && !['openInputDisplaySettings','inputDisplayPage','inputDisplayScale','inputDisplayLingerMs'].some(id => settings.includes(`id="${id}"`))
    && !read('settings-window.js').includes('showInputDisplaySettings')
  ,inputDisplayOverlay: main.includes('async function updateInputDisplay') && read('build-development-update.ps1').includes("'input-display.html'")
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Settings checks failed: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
