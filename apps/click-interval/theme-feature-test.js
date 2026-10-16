const fs = require('fs');
const read = file => fs.readFileSync(file, 'utf8');
const theme = read('theme.css');
const loader = read('theme-loader.js');
const themedPages = ['index.html','settings.html','hotkey.html','message.html','macro-name.html','macro-delete.html','macro-unsaved.html','dropdown.html','settings-unsaved.html','crosshair-preview.html','updater.html','updater-error.html'];
const checks = {
  sixPalettes: ['obsidian','light','crimson','ocean','rose','custom'].every(name => theme.includes(`[data-theme="${name}"]`)),
  persistedLoader: loader.includes('loadAppSettings') && loader.includes('onAppThemeChanged'),
  pageCoverage: themedPages.every(file => read(file).includes('theme.css')),
  controlsCovered: theme.includes('input[type="text"]') && theme.includes('.tool-tab.active') && theme.includes('.macro-library-row') && theme.includes('#options'),
  originalObsidianUntouched: theme.includes(':not([data-theme="obsidian"])') && !theme.includes('html[data-theme],html[data-theme] body'),
  titlebarButtonsRestNormally: theme.includes('.window-buttons button{border:0!important;background:transparent!important}') && theme.includes(':not(#minimizeWindow)'),
  fullColorPalettes: ['#b90824','#0769d5','#d51f7c'].every(color => theme.includes(color)),
  repairedLightPalette: theme.includes('--theme-bg:#f4f6f8') && theme.includes('.background-tool-grid label'),
  transparentThemesRemoved: !theme.includes('transparent-tinted') && !theme.includes('transparent-light') && !loader.includes('transparent-tinted') && !loader.includes('transparent-light'),
  customPalette: loader.includes('customTheme') && loader.includes("style.setProperty('--theme-shadow'") && loader.includes("style.setProperty('--theme-highlight'"),
  radioUsesHighlight: read('styles.css').includes('input[type="radio"]:checked { border-color: var(--theme-highlight') && theme.includes('input[type="radio"]:checked{border-color:var(--theme-highlight)!important'),
  opaqueAppWindows: read('main.js').includes("frame: false,\n    transparent: false,\n    roundedCorners: true,\n    hasShadow: true") && read('main.js').includes("applyNativeTheme(settingsWindow, settingsDraft)"),
  inAppTooltips: read('renderer.js').includes("customTooltip.className = 'custom-tooltip'") && !read('renderer.js').includes('window.bridge.showHoverHint({'),
  iconOnlyHover: theme.includes('color:var(--theme-highlight)!important;background:transparent!important'),
  uniformModalShadow: read('styles.css').includes('.popup-modal-open::after') && !read('styles.css').includes('.popup-modal-open :is('),
  gearOutline: read('index.html').includes('M8 1.5h4l.5 2.1'),
  packaged: read('build-development-update.ps1').includes("'theme-loader.js', 'theme.css'")
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Theme checks failed: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
