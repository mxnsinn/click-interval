const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const consoleCss = read('server-console.css');
const consoleHtml = read('server-console.html');
const consoleJs = read('server-console.js');
const styles = read('styles.css');
const theme = read('theme.css');
const loader = read('theme-loader.js');

const checks = {
  consoleLoadsSharedTheme: consoleHtml.includes('href="theme.css"') && consoleHtml.includes('src="theme-loader.js"'),
  consoleIsUnbranded: consoleHtml.includes('<title>Minecraft Server Console</title>')
    && !consoleHtml.includes('Click Interval')
    && !consoleJs.includes('[Click Interval Console]')
    && !consoleJs.includes('[Assembly Console] Commands'),
  consoleUsesThemeSurfaces: ['--theme-bg', '--theme-surface', '--theme-text', '--theme-border', '--theme-highlight']
    .every(token => consoleCss.includes(token)),
  consoleHasNoFixedNavyShell: !consoleCss.includes('#090a0c') && !consoleCss.includes('#0d0f12'),
  consoleScrollbarIsThemed: ['--theme-scrollbar-track', '--theme-scrollbar-thumb', '--theme-scrollbar-thumb-hover']
    .every(token => consoleCss.includes(token)),
  consoleHasNoStateBadge: !consoleHtml.includes('console-state')
    && !consoleHtml.includes('consoleStateWrap')
    && !consoleCss.includes('.console-state'),
  consoleNamesActiveSession: consoleHtml.includes('id="consoleSessionName"')
    && consoleJs.includes('function updateSession(status)')
    && consoleJs.includes('document.title = `${label} — Server Console`'),
  consoleSimplifiesIpcErrors: consoleJs.includes('Stop the server before changing custom mods.'),
  macroActionListIsThemed: /#macroActionList\s*\{[^}]*var\(--theme-surface\)/s.test(styles)
    && /#macroActionList\s*\{[^}]*var\(--theme-scrollbar-thumb\)/s.test(styles),
  serverSurfaceIsThemed: /\.ms-server-icon\s*\{[^}]*var\(--theme-surface\)/s.test(styles)
    && /\.ms-page\s*\{[^}]*var\(--theme-scrollbar-thumb\)/s.test(styles)
    && /\.ms-check-group\s*\{[^}]*var\(--theme-row\)/s.test(styles),
  paletteDefinesScrollbars: ['obsidian', 'light', 'crimson', 'ocean', 'rose', 'custom'].every(name => {
    const block = theme.match(new RegExp(`(?:\\[data-theme="${name}"\\]|:root,\\[data-theme="${name}"\\])\\{([^}]*)\\}`));
    return block && ['--theme-scrollbar-track', '--theme-scrollbar-thumb', '--theme-scrollbar-thumb-hover']
      .every(token => block[1].includes(token));
  }),
  customScrollbarsAreApplied: ['scrollbarTrack', 'scrollbarThumb', 'scrollbarThumbHover'].every(key => loader.includes(`settings.customTheme?.${key}`)),
  flatControlsStayFlat: theme.includes('.console-window-actions button,.toolbar-actions button,.send-command,.action-toolbar button')
    && theme.includes('.ms-section-tabs,.ms-subtabs,.ms-addon-mode,.ms-protection-tabs')
};

const failed = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name);
if (failed.length) {
  console.error(`Server console theme checks failed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log(`Server console theme checks passed (${Object.keys(checks).length} assertions).`);
