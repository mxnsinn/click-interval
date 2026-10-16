(() => {
  const source = document.getElementById('motdSource');
  const preview = document.getElementById('motdPreview');
  const count = document.getElementById('motdCount');
  const colorRoot = document.getElementById('motdColors');
  const serverIcon = document.getElementById('motdServerIcon');
  const serverName = document.getElementById('motdServerName');
  const colors = [
    ['0','Black','#111111'],['1','Dark blue','#0000aa'],['2','Dark green','#00aa00'],['3','Dark aqua','#00aaaa'],
    ['4','Dark red','#aa0000'],['5','Dark purple','#aa00aa'],['6','Gold','#ffaa00'],['7','Gray','#aaaaaa'],
    ['8','Dark gray','#555555'],['9','Blue','#5555ff'],['a','Green','#55ff55'],['b','Aqua','#55ffff'],
    ['c','Red','#ff5555'],['d','Light purple','#ff55ff'],['e','Yellow','#ffff55'],['f','White','#f0f0f0']
  ];
  const colorMap = Object.fromEntries(colors.map(([code, _name, color]) => [code, color]));
  let magicTimer = null;

  function randomMagic(value) {
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?$%#';
    return [...String(value || '')].map(character => /\s/.test(character) ? character : glyphs[Math.floor(Math.random() * glyphs.length)]).join('');
  }

  function stopMagic() {
    clearInterval(magicTimer);
    magicTimer = null;
  }

  function startMagic() {
    stopMagic();
    if (!preview.querySelector('.motd-magic')) return;
    const tick = () => {
      for (const span of preview.querySelectorAll('.motd-magic')) span.textContent = randomMagic(span.dataset.text);
    };
    tick();
    magicTimer = setInterval(tick, 105);
  }

  function renderPreview() {
    stopMagic();
    preview.replaceChildren();
    const value = source.value.replace(/\\n/g, '\n');
    count.textContent = `${source.value.length} / ${source.maxLength}`;
    if (!value) {
      preview.textContent = 'No message shown';
      preview.classList.add('empty');
      return;
    }
    preview.classList.remove('empty');
    const defaults = () => ({ color: '#aaaaaa', bold: false, italic: false, underline: false, strike: false, magic: false });
    let style = defaults();
    let cursor = 0;
    const pattern = /§([0-9a-fk-or])/ig;
    let match;
    const append = text => {
      if (!text) return;
      const span = document.createElement('span');
      span.textContent = style.magic ? randomMagic(text) : text;
      span.style.color = style.color;
      span.style.fontWeight = style.bold ? '700' : '400';
      span.style.fontStyle = style.italic ? 'italic' : 'normal';
      span.style.textDecoration = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
      if (style.magic) {
        span.className = 'motd-magic';
        span.dataset.text = text;
      }
      preview.append(span);
    };
    while ((match = pattern.exec(value))) {
      append(value.slice(cursor, match.index));
      const code = match[1].toLowerCase();
      if (colorMap[code]) style = { ...defaults(), color: colorMap[code] };
      else if (code === 'k') style.magic = true;
      else if (code === 'l') style.bold = true;
      else if (code === 'm') style.strike = true;
      else if (code === 'n') style.underline = true;
      else if (code === 'o') style.italic = true;
      else if (code === 'r') style = defaults();
      cursor = pattern.lastIndex;
    }
    append(value.slice(cursor));
    startMagic();
  }

  function loadEditorState(payload) {
    const state = payload && typeof payload === 'object' ? payload : { value: payload };
    source.value = String(state.value || '').replace(/\\n/g, '\n').slice(0, source.maxLength);
    serverName.textContent = String(state.serverName || 'Minecraft Server');
    serverIcon.src = String(state.iconDataUrl || 'minecraft-server/renderer/assets/minecraft-default-world.png');
    serverIcon.onerror = () => {
      serverIcon.onerror = null;
      serverIcon.src = 'minecraft-server/renderer/assets/minecraft-default-world.png';
    };
    renderPreview();
  }

  function applyFormat(code) {
    const start = Number.isInteger(source.selectionStart) ? source.selectionStart : source.value.length;
    const end = Number.isInteger(source.selectionEnd) ? source.selectionEnd : start;
    const prefix = `§${code}`;
    const suffix = end > start && code !== 'r' ? '§r' : '';
    const next = `${source.value.slice(0, start)}${prefix}${source.value.slice(start, end)}${suffix}${source.value.slice(end)}`;
    if (next.length > source.maxLength) return;
    source.value = next;
    source.focus();
    source.setSelectionRange(start + prefix.length, end + prefix.length);
    renderPreview();
  }

  for (const [code, name, color] of colors) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.code = code;
    button.title = name;
    button.setAttribute('aria-label', `${name} selected text`);
    button.style.setProperty('--motd-color', color);
    colorRoot.append(button);
  }

  document.querySelector('.motd-toolbar').addEventListener('mousedown', event => {
    if (event.target.closest('[data-code]')) event.preventDefault();
  });
  document.querySelector('.motd-toolbar').addEventListener('click', event => {
    const button = event.target.closest('[data-code]');
    if (button) applyFormat(button.dataset.code);
  });
  document.getElementById('clearFormatting').addEventListener('click', () => {
    source.value = source.value.replace(/§[0-9a-fk-or]/ig, '');
    source.focus();
    renderPreview();
  });
  document.getElementById('clearMotd').addEventListener('click', () => {
    source.value = '';
    source.focus();
    renderPreview();
  });
  document.getElementById('cancelMotd').addEventListener('click', () => window.bridge.closeCurrentWindow());
  document.getElementById('saveMotd').addEventListener('click', () => window.bridge.submitMotdEditor(source.value));
  source.addEventListener('input', renderPreview);
  source.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.bridge.closeCurrentWindow();
    if (event.key === 'Enter' && event.ctrlKey) window.bridge.submitMotdEditor(source.value);
  });
  window.bridge.onMotdEditorValue(loadEditorState);
  loadEditorState(window.bridge.loadMotdEditorValue());
  source.focus();
})();
