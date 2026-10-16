const fs = require('fs');

const main = fs.readFileSync('main.js', 'utf8');
const activeIndicator = fs.readFileSync('active-indicator.html', 'utf8');

const checks = {
  iconHasNoGlow: activeIndicator.includes('filter:none') && !activeIndicator.includes('drop-shadow'),
  indicatorsStartTransparent: (main.match(/show: false, opacity: 0/g) || []).length >= 2,
  staleFrameIsHidden: main.includes('targetWindow.setOpacity(0);') && main.includes('targetWindow.hide();'),
  waitsForFreshPaint: main.includes('requestAnimationFrame(() => requestAnimationFrame(resolve))'),
  usesSmoothNativeFade: main.includes('indicatorFadeDurationMs = 160') && main.includes('targetWindow.setOpacity(eased)'),
  activeIndicatorUsesSharedFade: main.includes('await showIndicatorWindow(activeIndicatorWindow);'),
  cpsIndicatorUsesSharedFade: main.includes('await showIndicatorWindow(cpsIndicatorWindow);'),
  indicatorHidesCancelFade: (main.match(/hideIndicatorWindow\(/g) || []).length >= 5
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Indicator overlay checks failed: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
