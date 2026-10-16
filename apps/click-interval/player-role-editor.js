(() => {
  const api = window.bridge.minecraftServer;
  const $ = id => document.getElementById(id);
  const COLORS = {
    black: '#000000', dark_blue: '#0000aa', dark_green: '#00aa00', dark_aqua: '#00aaaa',
    dark_red: '#aa0000', dark_purple: '#aa00aa', gold: '#ffaa00', gray: '#aaaaaa',
    dark_gray: '#555555', blue: '#5555ff', green: '#55ff55', aqua: '#55ffff',
    red: '#ff5555', light_purple: '#ff55ff', yellow: '#ffff55', white: '#ffffff'
  };
  const CODE_COLORS = ['black','dark_blue','dark_green','dark_aqua','dark_red','dark_purple','gold','gray','dark_gray','blue','green','aqua','red','light_purple','yellow','white'];
  const CODE_INDEX = '0123456789abcdef';
  const RESERVED = new Set(['owner', 'admin', 'member']);
  let access = null;
  let originalId = new URLSearchParams(location.search).get('role') || '';
  let currentRole = null;
  let busy = false;
  let idEdited = Boolean(originalId);
  let lastFormatTarget = null;

  function splitCommands(value) {
    return [...new Set(String(value || '').split(/[\s,]+/).map(item => item.trim().replace(/^\/+/, '').toLowerCase()).filter(Boolean))];
  }

  function slug(value) {
    const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').slice(0, 32);
    return RESERVED.has(id) ? `${id}-custom` : id;
  }

  function showMessage(message = '') {
    $('editorMessage').textContent = message;
    $('editorMessage').hidden = !message;
  }

  function setBusy(value) {
    busy = value;
    $('saveRole').disabled = value;
    $('deleteRole').disabled = value;
    $('cancelRole').disabled = value;
    $('saveRole').textContent = value ? 'Saving…' : 'Save role';
  }

  function buildColorOptions() {
    $('nameColor').replaceChildren();
    for (const [name, color] of Object.entries(COLORS)) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name.replaceAll('_', ' ');
      option.style.color = color;
      $('nameColor').append(option);
    }
  }

  function buildCommandGroups() {
    $('commandGroups').replaceChildren();
    for (const [id, group] of Object.entries(access?.commandGroups || {})) {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = id;
      const text = document.createElement('span');
      text.textContent = group?.label || id;
      label.append(input, text);
      $('commandGroups').append(label);
    }
  }

  function buildCommandCatalog() {
    const root = $('commandCatalog');
    root.replaceChildren();
    for (const command of access?.commandCatalog || []) {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = command;
      input.dataset.commandRoot = 'true';
      const text = document.createElement('span');
      text.textContent = `/${command}`;
      label.append(input, text);
      root.append(label);
    }
  }

  function defaultRole() {
    return {
      id: '', name: '', builtIn: false, capabilities: [],
      commands: { mode: 'none', groups: [], allow: [], deny: [] },
      tradeDiscountPercent: 0,
      appearance: { enabled: false, color: 'white', prefix: '', suffix: '' }
    };
  }

  function findRole(id) {
    return (access?.roles || []).find(role => String(role.id || '').toLowerCase() === String(id || '').toLowerCase()) || null;
  }

  function fill(role) {
    currentRole = role || defaultRole();
    const capabilities = new Set(currentRole.capabilities || []);
    const commands = currentRole.commands || {};
    const appearance = currentRole.appearance || {};
    $('roleName').value = currentRole.name || '';
    $('roleId').value = currentRole.id || '';
    $('canSpectate').checked = capabilities.has('player.spectate');
    $('canViewCoordinates').checked = capabilities.has('player.coordinates');
    $('canViewDimension').checked = capabilities.has('player.dimension');
    $('canCycleTrades').checked = capabilities.has('trade.reroll');
    $('canShowEntityIds').checked = capabilities.has('entity.labels');
    $('canInspectEntities').checked = capabilities.has('entity.inspect');
    $('canEditEntities').checked = capabilities.has('entity.edit');
    $('canStopServer').checked = capabilities.has('server.stop');
    $('canRestartServer').checked = capabilities.has('server.restart');
    $('canManageProtection').checked = capabilities.has('protection.manage');
    $('canBypassProtection').checked = capabilities.has('protection.bypass');
    $('tradeDiscountPercent').value = String(Math.max(0, Math.min(55, Number(currentRole.tradeDiscountPercent) || 0)));
    $('commandMode').value = commands.mode === 'all' ? 'all' : ((commands.groups || []).length || (commands.allow || []).length || (commands.deny || []).length ? 'allowlist' : 'none');
    for (const input of $('commandGroups').querySelectorAll('input')) input.checked = (commands.groups || []).includes(input.value);
    $('allowedCommands').value = (commands.allow || []).join(', ');
    const allowed = new Set(commands.allow || []);
    for (const input of $('commandCatalog').querySelectorAll('input[data-command-root]')) input.checked = allowed.has(input.value);
    $('deniedCommands').value = (commands.deny || []).join(', ');
    $('appearanceEnabled').checked = appearance.enabled === true;
    $('nameColor').value = COLORS[appearance.color] ? appearance.color : 'white';
    $('tagPrefix').value = String(appearance.prefix || '').replaceAll('§', '&');
    $('tagSuffix').value = String(appearance.suffix || '').replaceAll('§', '&');
    const builtIn = currentRole.builtIn === true || RESERVED.has(currentRole.id);
    $('roleId').disabled = Boolean(currentRole.id);
    $('roleName').disabled = builtIn;
    $('deleteRole').hidden = builtIn || !currentRole.id;
    const owner = currentRole.id === 'owner';
    if (owner) {
      $('canSpectate').checked = true;
      $('canManageProtection').checked = true;
      $('canBypassProtection').checked = true;
      $('commandMode').value = 'all';
      for (const id of ['canSpectate','canManageProtection','canBypassProtection','commandMode']) $(id).disabled = true;
    } else {
      for (const id of ['canSpectate','canViewCoordinates','canViewDimension','canCycleTrades','canShowEntityIds','canInspectEntities','canEditEntities','canStopServer','canRestartServer','canManageProtection','canBypassProtection','commandMode']) $(id).disabled = false;
    }
    $('windowTitle').textContent = currentRole.id ? `Edit ${currentRole.name || currentRole.id}` : 'New Player Role';
    document.title = $('windowTitle').textContent;
    updateVisibility();
    updatePreview();
  }

  function updateVisibility() {
    const commandEditable = $('commandMode').value === 'allowlist' && !$('commandMode').disabled;
    $('commandDetails').hidden = !commandEditable;
    const enabled = $('appearanceEnabled').checked;
    $('appearanceFields').classList.toggle('disabled', !enabled);
    for (const control of $('appearanceFields').querySelectorAll('input,select,button')) control.disabled = !enabled;
  }

  function appendFormatted(root, text, startingColor) {
    let state = { color: startingColor, bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false };
    let chunk = '';
    const flush = () => {
      if (!chunk) return;
      const span = document.createElement('span');
      span.textContent = chunk;
      span.style.color = COLORS[state.color] || COLORS.white;
      for (const key of ['bold','italic','underlined','strikethrough','obfuscated']) if (state[key]) span.classList.add(key);
      root.append(span);
      chunk = '';
    };
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const code = char === '&' && index + 1 < text.length ? text[index + 1].toLowerCase() : '';
      if (!CODE_INDEX.includes(code) && !'klmnor'.includes(code)) { chunk += char; continue; }
      flush();
      index += 1;
      const colorIndex = CODE_INDEX.indexOf(code);
      if (colorIndex >= 0) state = { color: CODE_COLORS[colorIndex], bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false };
      else if (code === 'r') state = { color: startingColor, bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false };
      else if (code === 'l') state.bold = true;
      else if (code === 'o') state.italic = true;
      else if (code === 'n') state.underlined = true;
      else if (code === 'm') state.strikethrough = true;
      else if (code === 'k') state.obfuscated = true;
    }
    flush();
  }

  function updatePreview() {
    const preview = $('tagPreview');
    preview.replaceChildren();
    const base = $('nameColor').value || 'white';
    appendFormatted(preview, `${$('tagPrefix').value || ''}Player${$('tagSuffix').value || ''}`, base);
  }

  function rolePayload() {
    const capabilities = [];
    if ($('canSpectate').checked) capabilities.push('player.spectate');
    if ($('canViewCoordinates').checked) capabilities.push('player.coordinates');
    if ($('canViewDimension').checked) capabilities.push('player.dimension');
    if ($('canCycleTrades').checked) capabilities.push('trade.reroll');
    if ($('canShowEntityIds').checked) capabilities.push('entity.labels');
    if ($('canInspectEntities').checked) capabilities.push('entity.inspect');
    if ($('canEditEntities').checked) capabilities.push('entity.edit');
    if ($('canStopServer').checked) capabilities.push('server.stop');
    if ($('canRestartServer').checked) capabilities.push('server.restart');
    if ($('canManageProtection').checked) capabilities.push('protection.manage');
    if ($('canBypassProtection').checked) capabilities.push('protection.bypass');
    return {
      originalId,
      id: $('roleId').value.trim().toLowerCase(),
      name: $('roleName').value.trim(),
      capabilities,
      tradeDiscountPercent: Number($('tradeDiscountPercent').value),
      commands: {
        mode: $('commandMode').value === 'all' ? 'all' : 'allowlist',
        groups: [...$('commandGroups').querySelectorAll('input:checked')].map(input => input.value),
        allow: [...new Set([
          ...[...$('commandCatalog').querySelectorAll('input[data-command-root]:checked')].map(input => input.value),
          ...splitCommands($('allowedCommands').value)
        ])],
        deny: splitCommands($('deniedCommands').value)
      },
      appearance: {
        enabled: $('appearanceEnabled').checked,
        color: $('nameColor').value,
        prefix: $('tagPrefix').value.replace(/&([0-9a-fk-or])/gi, '§$1'),
        suffix: $('tagSuffix').value.replace(/&([0-9a-fk-or])/gi, '§$1')
      }
    };
  }

  async function load(nextRoleId = originalId) {
    showMessage();
    try {
      access = await api.getPlayerAccess();
      buildCommandGroups();
      buildCommandCatalog();
      originalId = String(nextRoleId || '').toLowerCase();
      idEdited = Boolean(originalId);
      const role = originalId ? findRole(originalId) : null;
      if (originalId && !role) throw new Error('That role no longer exists.');
      fill(role);
    } catch (error) {
      showMessage(error?.message || String(error));
      $('saveRole').disabled = true;
    }
  }

  $('roleName').addEventListener('input', () => {
    if (!idEdited && !$('roleId').disabled) $('roleId').value = slug($('roleName').value);
  });
  $('roleId').addEventListener('input', () => { idEdited = true; });
  $('commandMode').addEventListener('change', updateVisibility);
  $('appearanceEnabled').addEventListener('change', () => { updateVisibility(); updatePreview(); });
  for (const id of ['nameColor','tagPrefix','tagSuffix']) $(id).addEventListener('input', updatePreview);
  for (const id of ['tagPrefix','tagSuffix']) $(id).addEventListener('focus', event => { lastFormatTarget = event.currentTarget; });
  for (const button of document.querySelectorAll('[data-format]')) button.addEventListener('click', () => {
    const target = lastFormatTarget || $('tagPrefix');
    const code = button.dataset.format;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(code, start, end, 'end');
    target.focus();
    updatePreview();
  });

  $('roleForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const payload = rolePayload();
    if (!payload.name || !/^[a-z0-9][a-z0-9._-]*$/.test(payload.id)) { showMessage('Enter a role name and a valid lowercase role ID.'); return; }
    setBusy(true); showMessage();
    try {
      await api.saveAccessRole(payload);
      window.bridge.notifyPlayerAccessChanged();
      window.bridge.closeCurrentWindow();
    } catch (error) {
      showMessage(error?.message || String(error));
      setBusy(false);
    }
  });

  $('deleteRole').addEventListener('click', async () => {
    if (busy || !currentRole?.id || currentRole.builtIn || RESERVED.has(currentRole.id)) return;
    if ($('deleteRole').dataset.confirm !== 'true') {
      $('deleteRole').dataset.confirm = 'true';
      const members = Math.max(0, Number(currentRole.memberCount) || 0);
      $('deleteRole').textContent = members ? `Delete role + ${members} access` : 'Confirm delete';
      showMessage(members
        ? `This also removes the role assignment from ${members} player${members === 1 ? '' : 's'}. Click again to confirm.`
        : 'Click Delete again to confirm.');
      return;
    }
    setBusy(true); showMessage();
    try {
      await api.deleteAccessRole({ roleId: currentRole.id, removeAssignments: true });
      window.bridge.notifyPlayerAccessChanged();
      window.bridge.closeCurrentWindow();
    } catch (error) {
      showMessage(error?.message || String(error));
      setBusy(false);
    }
  });
  $('cancelRole').addEventListener('click', () => window.bridge.closeCurrentWindow());
  window.bridge.onPlayerRoleEditorRole?.(roleId => load(roleId));

  buildColorOptions();
  load();
})();
