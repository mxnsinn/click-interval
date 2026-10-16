(() => {
  const themes = ['obsidian', 'light', 'crimson', 'ocean', 'rose', 'custom'];
  const defaults = {
    accent: '#1683c7',
    main: '#101010',
    shadow: '#000000',
    text: '#ffffff',
    highlight: '#42a5f5',
    scrollbarTrack: '#191919',
    scrollbarThumb: '#575757',
    scrollbarThumbHover: '#777777'
  };
  const api = window.bridge || window.crosshairPreviewBridge;
  const validColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
  const rgb = value => [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  const hex = channels => `#${channels.map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (left, right, amount) => hex(rgb(left).map((channel, index) => channel + (rgb(right)[index] - channel) * amount));

  const apply = value => {
    const settings = typeof value === 'string' ? { theme: value } : (value || {});
    const theme = themes.includes(settings.theme) ? settings.theme : 'obsidian';
    document.documentElement.dataset.theme = theme;
    for (const property of ['bg', 'surface', 'raised', 'row', 'border', 'border-strong', 'text', 'muted', 'subtle', 'accent', 'accent-bright', 'accent-soft', 'shadow', 'highlight', 'scrollbar-track', 'scrollbar-thumb', 'scrollbar-thumb-hover']) {
      document.documentElement.style.removeProperty(`--theme-${property}`);
    }
    if (theme !== 'custom') return;
    const custom = {
      accent: validColor(settings.customTheme?.accent, defaults.accent),
      main: validColor(settings.customTheme?.main, defaults.main),
      shadow: validColor(settings.customTheme?.shadow, defaults.shadow),
      text: validColor(settings.customTheme?.text, defaults.text),
      highlight: validColor(settings.customTheme?.highlight, defaults.highlight)
    };
    const style = document.documentElement.style;
    style.setProperty('--theme-bg', custom.main);
    style.setProperty('--theme-surface', mix(custom.main, custom.text, .08));
    style.setProperty('--theme-raised', mix(custom.main, custom.text, .14));
    style.setProperty('--theme-row', mix(custom.main, custom.text, .045));
    style.setProperty('--theme-border', mix(custom.main, custom.text, .24));
    style.setProperty('--theme-border-strong', mix(custom.main, custom.text, .42));
    style.setProperty('--theme-text', custom.text);
    style.setProperty('--theme-muted', mix(custom.text, custom.main, .34));
    style.setProperty('--theme-subtle', mix(custom.text, custom.main, .5));
    style.setProperty('--theme-accent', custom.accent);
    style.setProperty('--theme-accent-bright', mix(custom.accent, custom.text, .28));
    style.setProperty('--theme-accent-soft', mix(custom.main, custom.accent, .28));
    style.setProperty('--theme-shadow', custom.shadow);
    style.setProperty('--theme-highlight', custom.highlight);
    style.setProperty('--theme-scrollbar-track', validColor(settings.customTheme?.scrollbarTrack, defaults.scrollbarTrack));
    style.setProperty('--theme-scrollbar-thumb', validColor(settings.customTheme?.scrollbarThumb, defaults.scrollbarThumb));
    style.setProperty('--theme-scrollbar-thumb-hover', validColor(settings.customTheme?.scrollbarThumbHover, defaults.scrollbarThumbHover));
  };

  window.applyClickIntervalTheme = apply;
  try { apply(api?.loadAppSettings?.()); } catch (_) { apply('obsidian'); }
  if (window.bridge?.onAppThemeChanged) window.bridge.onAppThemeChanged(value => apply(value));
})();
