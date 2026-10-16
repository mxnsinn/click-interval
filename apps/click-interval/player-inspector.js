(() => {
  const api = window.bridge.minecraftServer;
  const inspectorData = window.PlayerInspectorData;
  const $ = id => document.getElementById(id);
  let player = '';
  let loading = false;
  let loadingPlayer = '';
  let playerGeneration = 0;
  let refreshTimer = null;
  let latestResult = null;
  let statistics = null;
  let statisticsPlayer = '';
  let moderationHistory = [];
  let statisticsPageIndex = 0;
  let modelYaw = -18;
  let dragStart = null;
  let renderedModelSignature = '';
  let pendingModelSignature = '';
  let playerViewStatus = null;
  let playerViewLoading = false;
  let playerViewStatusRequest = null;
  let playerViewStatusVersion = 0;
  let playerViewMutation = null;
  let playerViewMutationSequence = 0;
  let lastSuccessfulRefreshAt = 0;
  let profileError = '';
  let statisticsSourceError = '';
  let statisticsRequestVersion = 0;
  let playerHistoryEvents = [];
  let protectionHistoryEvents = [];

  function makeSlots(root, count, section) {
    root.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const slot = document.createElement('div');
      slot.className = 'inventory-slot';
      slot.dataset.section = section;
      slot.dataset.index = String(index);
      const icon = document.createElement('img'); icon.className = 'item-icon'; icon.alt = ''; icon.hidden = true;
      const fallback = document.createElement('span'); fallback.className = 'item-fallback';
      const countLabel = document.createElement('span'); countLabel.className = 'item-count';
      slot.append(icon, fallback, countLabel);
      root.append(slot);
    }
  }

  function initializeSlots() {
    makeSlots($('mainInventory'), 27, 'inventory');
    makeSlots($('hotbarInventory'), 9, 'hotbar');
    makeSlots($('armorInventory'), 4, 'armor');
    makeSlots($('offhandInventory'), 1, 'offhand');
  }

  function renderInventory(items, slotAssets = {}) {
    const placeholders = {
      'armor:0': slotAssets.helmet,
      'armor:1': slotAssets.chestplate,
      'armor:2': slotAssets.leggings,
      'armor:3': slotAssets.boots,
      'offhand:0': slotAssets.offhand
    };
    const itemBySlot = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const section = String(item?.section || '');
      const index = Number(item?.index);
      if (!Number.isInteger(index)) continue;
      itemBySlot.set(`${section}:${index}`, item);
    }
    for (const slot of document.querySelectorAll('.inventory-slot')) {
      const slotKey = `${slot.dataset.section}:${slot.dataset.index}`;
      const item = itemBySlot.get(slotKey);
      const placeholder = placeholders[slotKey] || '';
      const iconDataUrl = String(item?.iconDataUrl || '');
      const iconFingerprint = iconDataUrl ? `${iconDataUrl.length}:${iconDataUrl.slice(-64)}` : '';
      const signature = item
        ? JSON.stringify([item.id || '', item.name || '', Number(item.count) || 1, iconFingerprint])
        : `empty:${placeholder}`;
      if (slot.dataset.renderSignature === signature) continue;
      slot.dataset.renderSignature = signature;
      slot.classList.toggle('filled', Boolean(item));
      slot.title = '';
      slot.classList.toggle('equipment-placeholder', Boolean(!item && placeholder));
      slot.style.backgroundImage = !item && placeholder ? `url("${placeholder}")` : '';
      const icon = slot.querySelector('.item-icon');
      icon.onerror = null;
      icon.hidden = true;
      icon.removeAttribute('src');
      const fallback = slot.querySelector('.item-fallback');
      const countLabel = slot.querySelector('.item-count');
      fallback.textContent = '';
      countLabel.textContent = '';
      if (!item) continue;
      const displayName = item.name || item.id || 'Unknown item';
      slot.title = `${displayName}${Number(item.count) > 1 ? ` × ${item.count}` : ''}`;
      if (item.iconDataUrl) {
        icon.onerror = () => {
          if (slot.dataset.renderSignature !== signature) return;
          icon.hidden = true;
          fallback.textContent = displayName;
        };
        icon.src = item.iconDataUrl;
        icon.hidden = false;
      } else {
        fallback.textContent = displayName;
      }
      countLabel.textContent = Number(item.count) > 1 ? String(item.count) : '';
    }
    const occupied = (items || []).length;
    $('inventoryStatus').textContent = `${occupied} occupied slot${occupied === 1 ? '' : 's'}`;
  }

  function renderIconBar(root, value, assets, kind) {
    const points = Math.max(0, Math.min(20, Number(value) || 0));
    const empty = kind === 'heart' ? assets?.heartContainer : assets?.foodEmpty;
    const full = kind === 'heart' ? assets?.heartFull : assets?.foodFull;
    const half = kind === 'heart' ? assets?.heartHalf : assets?.foodHalf;
    const signature = JSON.stringify([points, empty || '', full || '', half || '', kind]);
    if (root.dataset.renderSignature === signature && root.childElementCount === 10) return;
    root.dataset.renderSignature = signature;
    root.replaceChildren();
    for (let index = 0; index < 10; index += 1) {
      const icon = document.createElement('span');
      icon.className = `minecraft-icon ${kind === 'heart' ? 'heart-fallback' : 'food-fallback'}`;
      const remaining = points - index * 2;
      const overlay = remaining >= 2 ? full : remaining >= 1 ? half : '';
      if (empty || overlay) {
        icon.classList.remove('heart-fallback', 'food-fallback');
        icon.style.backgroundImage = [overlay, empty].filter(Boolean).map(url => `url("${url}")`).join(',');
      } else if (remaining > 0) icon.classList.add('filled');
      root.append(icon);
    }
  }

  function renderVitals(vitals = {}, assets = {}) {
    const health = Math.max(0, Number(vitals.health) || 0);
    const food = Math.max(0, Number(vitals.food) || 0);
    const level = Math.max(0, Math.round(Number(vitals.xpLevel) || 0));
    const progress = Math.max(0, Math.min(1, Number(vitals.xpProgress) || 0));
    renderIconBar($('healthBar'), health, assets, 'heart');
    renderIconBar($('hungerBar'), food, assets, 'food');
    $('healthBar').setAttribute('aria-label', `Health: ${Math.round(health * 10) / 10} of 20`);
    $('hungerBar').setAttribute('aria-label', `Hunger: ${Math.round(food)} of 20`);
    $('xpLevel').textContent = String(level);
    $('xpProgress').style.width = `${progress * 100}%`;
    const track = $('xpProgress').parentElement;
    track.style.backgroundImage = '';
    track.style.backgroundSize = '';
    track.style.backgroundRepeat = '';
    $('xpProgress').style.backgroundImage = '';
    $('xpProgress').style.backgroundSize = '';
    $('xpProgress').style.backgroundRepeat = '';
    $('xpProgress').style.backgroundColor = '';
    $('xpProgress').style.boxShadow = '';
    if (assets.experienceBackground) {
      track.style.backgroundImage = `url("${assets.experienceBackground}")`;
      track.style.backgroundSize = '100% 100%';
      track.style.backgroundRepeat = 'no-repeat';
    }
    if (assets.experienceProgress) {
      $('xpProgress').style.backgroundImage = `url("${assets.experienceProgress}")`;
      $('xpProgress').style.backgroundSize = `${Math.max(1, track.clientWidth)}px 100%`;
      $('xpProgress').style.backgroundRepeat = 'no-repeat';
      $('xpProgress').style.backgroundColor = 'transparent';
      $('xpProgress').style.boxShadow = 'none';
    }
  }

  function cropSkinFace(image, rect, mirror = false) {
    if (!rect) return null;
    const [x, y, width, height] = rect;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    if (mirror) { context.translate(width, 0); context.scale(-1, 1); }
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    return canvas;
  }

  function createCuboid({ name, width, height, depth, x, y, faces, image, armorColor = '', armor = false }) {
    const part = document.createElement('div');
    part.className = `mc-part mc-${name}${armor || armorColor ? ' mc-armor' : ''}${armor && image ? ' mc-armor-textured' : ''}`;
    part.style.width = `${width}px`; part.style.height = `${height}px`;
    part.style.left = `calc(50% + ${x - width / 2}px)`; part.style.top = `${y}px`;
    if (armorColor) part.style.setProperty('--armor-color', armorColor);
    const definitions = [
      ['front', width, height, `translateZ(${depth / 2}px)`],
      ['back', width, height, `rotateY(180deg) translateZ(${depth / 2}px)`],
      ['left', depth, height, `translateX(${(width - depth) / 2}px) rotateY(-90deg) translateZ(${width / 2}px)`],
      ['right', depth, height, `translateX(${(width - depth) / 2}px) rotateY(90deg) translateZ(${width / 2}px)`],
      ['top', width, depth, `translateY(${(height - depth) / 2}px) rotateX(90deg) translateZ(${height / 2}px)`],
      ['bottom', width, depth, `translateY(${(height - depth) / 2}px) rotateX(-90deg) translateZ(${height / 2}px)`]
    ];
    for (const [side, faceWidth, faceHeight, transform] of definitions) {
      const face = document.createElement('div');
      face.className = `mc-face ${side}`;
      face.style.width = `${faceWidth}px`; face.style.height = `${faceHeight}px`; face.style.transform = transform;
      if (image && faces?.[side]) face.append(cropSkinFace(image, faces[side], side === 'back'));
      part.append(face);
    }
    return part;
  }

  function armorMaterialColor(id) {
    const value = String(id || '').toLowerCase();
    if (value.includes('netherite')) return '#3e3841';
    if (value.includes('diamond')) return '#35c9c4';
    if (value.includes('golden')) return '#e7bd37';
    if (value.includes('iron')) return '#c9c9c9';
    if (value.includes('chainmail')) return '#777f86';
    if (value.includes('leather')) return '#8b5a32';
    if (value.includes('turtle')) return '#3f8c59';
    return '';
  }

  function equippedArmor(items) {
    const armor = new Map((items || []).filter(item => item.section === 'armor').map(item => [Number(item.index), item]));
    const normalize = item => item ? {
      color: armorMaterialColor(item.id),
      texture: item.equipmentDataUrl || ''
    } : { color: '', texture: '' };
    return { helmet: normalize(armor.get(0)), chest: normalize(armor.get(1)), legs: normalize(armor.get(2)), boots: normalize(armor.get(3)) };
  }

  function loadImage(dataUrl) {
    return new Promise(resolve => {
      if (!dataUrl) { resolve(null); return; }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  async function loadArmorImages(armor) {
    const entries = await Promise.all(Object.entries(armor).map(async ([slot, value]) => [slot, await loadImage(value.texture)]));
    return Object.fromEntries(entries);
  }

  function buildPlayerModel(image, model, items, armorImages = {}) {
    const rig = $('modelRig');
    rig.replaceChildren();
    const slim = model === 'slim';
    const armPixels = slim ? 3 : 4;
    const scale = 5;
    const legacySkin = Number(image?.naturalHeight || image?.height) === 32;
    const head = { front:[8,8,8,8],back:[24,8,8,8],left:[0,8,8,8],right:[16,8,8,8],top:[8,0,8,8],bottom:[16,0,8,8] };
    const body = { front:[20,20,8,12],back:[32,20,8,12],left:[16,20,4,12],right:[28,20,4,12],top:[20,16,8,4],bottom:[28,16,8,4] };
    const rightArm = { front:[44,20,armPixels,12],back:[48 + armPixels,20,armPixels,12],left:[40,20,4,12],right:[44 + armPixels,20,4,12],top:[44,16,armPixels,4],bottom:[44 + armPixels,16,armPixels,4] };
    const leftArm = legacySkin ? rightArm : { front:[36,52,armPixels,12],back:[40 + armPixels,52,armPixels,12],left:[32,52,4,12],right:[36 + armPixels,52,4,12],top:[36,48,armPixels,4],bottom:[36 + armPixels,48,armPixels,4] };
    const rightLeg = { front:[4,20,4,12],back:[12,20,4,12],left:[0,20,4,12],right:[8,20,4,12],top:[4,16,4,4],bottom:[8,16,4,4] };
    const leftLeg = legacySkin ? rightLeg : { front:[20,52,4,12],back:[28,52,4,12],left:[16,52,4,12],right:[24,52,4,12],top:[20,48,4,4],bottom:[24,48,4,4] };
    const hat = { front:[40,8,8,8],back:[56,8,8,8],left:[32,8,8,8],right:[48,8,8,8],top:[40,0,8,8],bottom:[48,0,8,8] };
    const jacket = { front:[20,36,8,12],back:[32,36,8,12],left:[16,36,4,12],right:[28,36,4,12],top:[20,32,8,4],bottom:[28,32,8,4] };
    const rightSleeve = { front:[44,36,armPixels,12],back:[48 + armPixels,36,armPixels,12],left:[40,36,4,12],right:[44 + armPixels,36,4,12],top:[44,32,armPixels,4],bottom:[44 + armPixels,32,armPixels,4] };
    const leftSleeve = { front:[52,52,armPixels,12],back:[56 + armPixels,52,armPixels,12],left:[48,52,4,12],right:[52 + armPixels,52,4,12],top:[52,48,armPixels,4],bottom:[52 + armPixels,48,armPixels,4] };
    const rightPants = { front:[4,36,4,12],back:[12,36,4,12],left:[0,36,4,12],right:[8,36,4,12],top:[4,32,4,4],bottom:[8,32,4,4] };
    const leftPants = { front:[4,52,4,12],back:[12,52,4,12],left:[0,52,4,12],right:[8,52,4,12],top:[4,48,4,4],bottom:[8,48,4,4] };
    const armWidth = armPixels * scale;
    const parts = [
      { name:'head',width:40,height:40,depth:40,x:0,y:12,faces:head },
      { name:'body',width:40,height:60,depth:20,x:0,y:54,faces:body },
      { name:'right-arm',width:armWidth,height:60,depth:20,x:-(20 + armWidth / 2),y:54,faces:rightArm },
      { name:'left-arm',width:armWidth,height:60,depth:20,x:20 + armWidth / 2,y:54,faces:leftArm },
      { name:'right-leg',width:20,height:60,depth:20,x:-10,y:116,faces:rightLeg },
      { name:'left-leg',width:20,height:60,depth:20,x:10,y:116,faces:leftLeg }
    ];
    for (const part of parts) rig.append(createCuboid({ ...part, image }));
    const outerLayers = [
      { name:'hat',width:42,height:42,depth:42,x:0,y:11,faces:hat },
      { name:'jacket',width:42,height:62,depth:22,x:0,y:53,faces:jacket },
      { name:'right-sleeve',width:armWidth + 2,height:62,depth:22,x:-(20 + armWidth / 2),y:53,faces:rightSleeve },
      { name:'left-sleeve',width:armWidth + 2,height:62,depth:22,x:20 + armWidth / 2,y:53,faces:leftSleeve },
      { name:'right-pants',width:22,height:62,depth:22,x:-10,y:115,faces:rightPants },
      { name:'left-pants',width:22,height:62,depth:22,x:10,y:115,faces:leftPants }
    ];
    for (const part of outerLayers) rig.append(createCuboid({ ...part, image }));
    const armor = equippedArmor(items);
    if (armor.helmet.color || armorImages.helmet) rig.append(createCuboid({ name:'armor-helmet',width:44,height:44,depth:44,x:0,y:10,armorColor:armor.helmet.color,armor:true,image:armorImages.helmet,faces:head }));
    if (armor.chest.color || armorImages.chest) {
      rig.append(createCuboid({ name:'armor-chest',width:44,height:62,depth:24,x:0,y:53,armorColor:armor.chest.color,armor:true,image:armorImages.chest,faces:body }));
      rig.append(createCuboid({ name:'armor-right-arm',width:armWidth + 3,height:61,depth:23,x:-(20 + armWidth / 2),y:53,armorColor:armor.chest.color,armor:true,image:armorImages.chest,faces:rightArm }));
      rig.append(createCuboid({ name:'armor-left-arm',width:armWidth + 3,height:61,depth:23,x:20 + armWidth / 2,y:53,armorColor:armor.chest.color,armor:true,image:armorImages.chest,faces:rightArm }));
    }
    if (armor.legs.color || armorImages.legs) {
      rig.append(createCuboid({ name:'armor-right-leg',width:24,height:62,depth:24,x:-10,y:115,armorColor:armor.legs.color,armor:true,image:armorImages.legs,faces:rightLeg }));
      rig.append(createCuboid({ name:'armor-left-leg',width:24,height:62,depth:24,x:10,y:115,armorColor:armor.legs.color,armor:true,image:armorImages.legs,faces:rightLeg }));
    }
    if (armor.boots.color || armorImages.boots) {
      rig.append(createCuboid({ name:'armor-right-boot',width:24,height:28,depth:25,x:-10,y:149,armorColor:armor.boots.color,armor:true,image:armorImages.boots,faces:rightLeg }));
      rig.append(createCuboid({ name:'armor-left-boot',width:24,height:28,depth:25,x:10,y:149,armorColor:armor.boots.color,armor:true,image:armorImages.boots,faces:rightLeg }));
    }
    rig.classList.add('ready');
    updateModelRotation();
  }

  function renderPlayerModel(skin, items) {
    const rig = $('modelRig');
    const armorSignature = (items || [])
      .filter(item => item.section === 'armor')
      .map(item => `${item.index}:${item.id}:${item.equipmentDataUrl || ''}`)
      .sort()
      .join('|');
    const signature = `${skin?.uuid || ''}\0${skin?.model || ''}\0${skin?.skinDataUrl || ''}\0${armorSignature}`;
    if (signature === renderedModelSignature && rig.classList.contains('ready')) return;
    if (!skin?.skinDataUrl) {
      pendingModelSignature = '';
      renderedModelSignature = signature;
      rig.classList.remove('ready');
      rig.replaceChildren();
      $('modelFallback').textContent = 'Skin unavailable';
      return;
    }
    if (signature === pendingModelSignature) return;
    pendingModelSignature = signature;
    if (!rig.classList.contains('ready')) $('modelFallback').textContent = 'Loading skin…';
    const image = new Image();
    image.onload = async () => {
      if (pendingModelSignature !== signature) return;
      const armorImages = await loadArmorImages(equippedArmor(items));
      if (pendingModelSignature !== signature) return;
      pendingModelSignature = '';
      renderedModelSignature = signature;
      buildPlayerModel(image, skin.model || 'classic', items, armorImages);
    };
    image.onerror = () => {
      if (pendingModelSignature !== signature) return;
      pendingModelSignature = '';
      if (!rig.classList.contains('ready')) $('modelFallback').textContent = 'Skin unavailable';
    };
    image.src = skin.skinDataUrl;
  }

  function updateModelRotation() {
    $('modelRig').style.transform = `rotateX(-7deg) rotateY(${modelYaw}deg)`;
  }

  function formatCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(1).replace(/\.0$/, '') : '—';
  }

  function dimensionName(value) {
    const key = String(value || '').replace(/^minecraft:/, '').toLowerCase();
    return ({ overworld: 'Overworld', the_nether: 'Nether', nether: 'Nether', the_end: 'The End', end: 'The End' })[key] || key.replace(/_/g, ' ') || 'Unknown world';
  }

  function setPlayerViewMessage(message, kind = '') {
    const status = $('playerViewStatus');
    status.textContent = String(message || '');
    status.classList.remove('error', 'ready');
    if (kind) status.classList.add(kind);
  }

  function renderInspectorError() {
    const message = $('statisticsPage').hidden ? profileError : statisticsSourceError;
    $('inspectorError').textContent = message;
    $('inspectorError').hidden = !message;
  }

  function playerViewSessionState(session) {
    if (!session) return '';
    return ['starting', 'active', 'restoring'].includes(session?.state) ? session.state : 'starting';
  }

  function applyPlayerViewStatus(value, requestedPlayer, generation, statusVersion = null) {
    if (generation !== playerGeneration || requestedPlayer !== player) return false;
    if (statusVersion !== null && statusVersion !== playerViewStatusVersion) return false;
    const result = value && typeof value === 'object' ? value : null;
    const responseTarget = inspectorData.validPlayerName(result?.target);
    if (responseTarget && responseTarget.toLowerCase() !== requestedPlayer.toLowerCase()) return false;
    if (statusVersion === null) playerViewStatusVersion += 1;
    playerViewStatus = result;
    renderPlayerViewControls();
    return true;
  }

  function playerViewSessionFor(viewer) {
    const key = String(viewer || '').toLowerCase();
    return (Array.isArray(playerViewStatus?.sessions) ? playerViewStatus.sessions : [])
      .find(session => String(session?.viewer || '').toLowerCase() === key) || null;
  }

  function renderPlayerViewControls(preferredViewer = '') {
    const select = $('playerViewViewer');
    const previous = String(preferredViewer || select.value || '');
    const sessions = (Array.isArray(playerViewStatus?.sessions) ? playerViewStatus.sessions : [])
      .filter(session => inspectorData.validPlayerName(session?.viewer));
    // Keep recovery for views started by older releases; starting new companion-dependent views has been retired.
    $('playerViewPanel').hidden = sessions.length === 0;
    const byKey = new Map();
    for (const session of sessions) {
      const key = String(session.viewer).toLowerCase();
      byKey.set(key, { name: session.viewer, session, online: Boolean(session.online) });
    }
    const choices = [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name));
    const choiceSignature = JSON.stringify(choices.map(choice => [choice.name, playerViewSessionState(choice.session), choice.online]));
    if (select.dataset.renderSignature !== choiceSignature) {
      select.dataset.renderSignature = choiceSignature;
      select.replaceChildren();
      if (!choices.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No active views';
        select.append(option);
      } else {
        for (const choice of choices) {
          const option = document.createElement('option');
          option.value = choice.name;
          const sessionLabel = choice.session
            ? ({ active: 'active', starting: 'starting', restoring: 'returning' })[playerViewSessionState(choice.session)]
            : '';
          option.textContent = `${choice.name}${sessionLabel ? ` · ${sessionLabel}` : ''}${choice.online ? '' : ' · offline'}`;
          select.append(option);
        }
      }
    }
    const preferredKey = previous.toLowerCase();
    const selected = choices.find(choice => choice.name.toLowerCase() === preferredKey)
      || choices.find(choice => choice.session)
      || choices[0]
      || null;
    select.value = selected?.name || '';
    const session = selected ? playerViewSessionFor(selected.name) : null;
    const sessionState = playerViewSessionState(session);
    const active = Boolean(session && sessionState === 'active');
    const pending = Boolean(session && sessionState !== 'active');
    const hasSession = Boolean(session);
    select.disabled = playerViewLoading || choices.length < 1;
    $('stopPlayerView').hidden = !hasSession;
    $('stopPlayerView').disabled = playerViewLoading || !session?.online;
    if (playerViewLoading) {
      setPlayerViewMessage('Returning to the saved position…');
    } else if (active) {
      setPlayerViewMessage(
        session.online
          ? `Viewing ${player} through ${session.viewer}. Return restores the exact saved position.`
          : `${session.viewer} disconnected. Their exact return is saved and will recover when they reconnect.`,
        session.online ? 'ready' : ''
      );
    } else if (pending) {
      setPlayerViewMessage(
        sessionState === 'restoring'
          ? `Returning ${session.viewer} to their exact saved position. Recovery is still pending confirmation.`
          : `Starting the view of ${player} through ${session.viewer}. Waiting for Minecraft confirmation.`
      );
    } else {
      setPlayerViewMessage('');
    }
  }

  async function refreshPlayerViewStatus() {
    if (!player || typeof api.getPlayerSpectateStatus !== 'function') return;
    const requestedPlayer = player;
    const generation = playerGeneration;
    if (playerViewStatusRequest?.player === requestedPlayer && playerViewStatusRequest.generation === generation) {
      return playerViewStatusRequest.promise;
    }
    const statusVersion = ++playerViewStatusVersion;
    const request = { player: requestedPlayer, generation, statusVersion, promise: null };
    request.promise = (async () => {
      try {
        const result = await api.getPlayerSpectateStatus(requestedPlayer);
        applyPlayerViewStatus(result, requestedPlayer, generation, statusVersion);
        return result;
      } catch (error) {
        if (generation !== playerGeneration || requestedPlayer !== player || statusVersion !== playerViewStatusVersion) return null;
        playerViewStatus = null;
        renderPlayerViewControls();
        setPlayerViewMessage(error?.message || String(error), 'error');
        return null;
      } finally {
        if (playerViewStatusRequest === request) playerViewStatusRequest = null;
      }
    })();
    playerViewStatusRequest = request;
    return request.promise;
  }

  async function stopPlayerView() {
    const viewer = inspectorData.validPlayerName($('playerViewViewer').value);
    const target = player;
    if (!viewer || !target || playerViewLoading) return;
    const generation = playerGeneration;
    const operation = { id: ++playerViewMutationSequence, kind: 'stop', viewer, target, generation };
    playerViewMutation = operation;
    playerViewLoading = true;
    renderPlayerViewControls(viewer);
    let failure = '';
    try {
      const result = await api.stopPlayerSpectating({ viewer, target: player });
      if (playerViewMutation === operation) applyPlayerViewStatus(result, target, generation);
    } catch (error) {
      failure = error?.message || String(error);
    } finally {
      if (playerViewMutation !== operation) return;
      playerViewMutation = null;
      playerViewLoading = false;
      renderPlayerViewControls();
      if (failure && generation === playerGeneration && target === player) setPlayerViewMessage(failure, 'error');
      else refreshPlayerViewStatus().catch(() => {});
    }
  }

  function clearProfileSnapshot(state = 'loading') {
    latestResult = null;
    $('playerX').textContent = '—';
    $('playerY').textContent = '—';
    $('playerZ').textContent = '—';
    $('playerDimension').textContent = '—';
    renderInventory([], {});
    renderVitals({}, {});
    renderPlayerModel(null, []);
    if (state === 'unavailable') {
      $('inventoryStatus').textContent = 'Unavailable';
      $('modelFallback').textContent = 'Player unavailable';
      $('playerUpdated').textContent = lastSuccessfulRefreshAt
        ? `Unavailable · last available ${new Date(lastSuccessfulRefreshAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
        : 'Unavailable · no successful update';
    } else {
      $('inventoryStatus').textContent = 'Loading…';
      $('modelFallback').textContent = 'Loading skin…';
      $('playerUpdated').textContent = 'Waiting for Minecraft…';
    }
  }

  function resetProfile() {
    clearProfileSnapshot('loading');
    profileError = '';
    renderInspectorError();
    playerViewStatusRequest = null;
    playerViewStatusVersion += 1;
    playerViewStatus = null;
    renderPlayerViewControls();
    if (!playerViewLoading) setPlayerViewMessage('Checking authorized viewers…');
  }

  function setPlayer(name) {
    const nextPlayer = inspectorData.validPlayerName(name);
    if (!nextPlayer && player) return;
    if (nextPlayer !== player) {
      playerGeneration += 1;
      loading = false;
      loadingPlayer = '';
      latestResult = null;
      renderedModelSignature = '';
      pendingModelSignature = '';
      lastSuccessfulRefreshAt = 0;
      $('refreshPlayer').classList.remove('loading');
      player = nextPlayer;
      resetProfile();
    } else {
      player = nextPlayer;
    }
    renderPlayerViewControls();
    statistics = null;
    statisticsPlayer = '';
    moderationHistory = [];
    playerHistoryEvents = [];
    protectionHistoryEvents = [];
    statisticsSourceError = '';
    statisticsRequestVersion += 1;
    statisticsPageIndex = 0;
    document.title = player ? `View ${player}` : 'View Player';
    $('playerTitle').textContent = document.title;
    $('profilePlayerName').textContent = player || 'Player';
    showProfile();
    if (player) {
      refreshProfileAndStatus().catch(() => {});
    } else {
      profileError = 'No player was selected. Close this window and choose View Player again.';
      renderInspectorError();
      $('inventoryStatus').textContent = 'Unavailable';
      $('modelFallback').textContent = 'Player unavailable';
      $('playerUpdated').textContent = 'No player selected';
    }
  }

  function renderProfile(result) {
    latestResult = result;
    $('profilePlayerName').textContent = result?.player || player;
    $('playerX').textContent = formatCoordinate(result?.position?.x);
    $('playerY').textContent = formatCoordinate(result?.position?.y);
    $('playerZ').textContent = formatCoordinate(result?.position?.z);
    $('playerDimension').textContent = dimensionName(result?.dimension);
    renderInventory(result?.inventory || [], result?.assets?.slots || {});
    renderVitals(result?.vitals || {}, result?.assets?.hud || {});
    renderPlayerModel(result?.skin, result?.inventory || []);
  }

  async function refresh() {
    if (!player || !$('statisticsPage').hidden || (loading && loadingPlayer === player)) return;
    const requestedPlayer = player;
    const generation = playerGeneration;
    loading = true;
    loadingPlayer = requestedPlayer;
    $('refreshPlayer').classList.add('loading');
    try {
      const result = await api.inspectPlayer(requestedPlayer);
      if (generation !== playerGeneration || requestedPlayer !== player) return;
      renderProfile(result);
      lastSuccessfulRefreshAt = Date.now();
      profileError = '';
      renderInspectorError();
      $('playerUpdated').textContent = `Updated ${new Date(result?.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      const reusedStatus = result?.spectate
        ? applyPlayerViewStatus(result.spectate, requestedPlayer, generation)
        : false;
      return { refreshed: true, reusedStatus };
    } catch (error) {
      if (generation !== playerGeneration || requestedPlayer !== player) return;
      clearProfileSnapshot('unavailable');
      profileError = error?.message || String(error);
      renderInspectorError();
      return { refreshed: false, reusedStatus: false };
    } finally {
      if (generation === playerGeneration && requestedPlayer === player) {
        loading = false;
        loadingPlayer = '';
        $('refreshPlayer').classList.remove('loading');
      }
    }
  }

  async function refreshProfileAndStatus() {
    const outcome = await refresh();
    if (!outcome?.reusedStatus && player && $('statisticsPage').hidden) {
      await refreshPlayerViewStatus();
    }
    return outcome;
  }

  function readableId(value) {
    return String(value || '').replace(/^minecraft:/, '').replace(/[_./-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
  }

  function formatStatisticValue(entry) {
    const id = String(entry.id || '');
    const value = Number(entry.value) || 0;
    if (/:(?:play_time|play_one_minute|time_since_rest|time_since_death|sneak_time)$/.test(id)) {
      const seconds = Math.floor(value / 20);
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || '<1m';
    }
    if (/(?:one_cm|_cm)$/.test(id)) {
      const meters = value / 100;
      return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
    }
    return value.toLocaleString();
  }

  function historyDetails(row) {
    const details = [];
    if (row.reason) details.push(row.reason);
    if (row.expiresAt) details.push(`until ${new Date(row.expiresAt).toLocaleString()}`);
    return details.join(' · ');
  }

  function appendStatisticRow(section, entry) {
    const row = document.createElement('div');
    row.className = `stat-row${entry.kind === 'history' ? ' history-row' : ''}`;
    if (entry.kind === 'history') {
      const body = document.createElement('span'); body.className = 'stat-event';
      const label = document.createElement('b');
      label.textContent = `${entry.label}${entry.check ? ` · ${readableId(entry.check)}` : ''}`;
      const details = document.createElement('small');
      details.textContent = historyDetails(entry) || 'No reason recorded';
      body.append(label, details);
      const timestamp = document.createElement('time');
      timestamp.dateTime = entry.timestamp;
      timestamp.textContent = new Date(entry.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      row.title = [label.textContent, details.textContent, timestamp.textContent].join(' · ');
      row.append(body, timestamp);
    } else {
      const label = document.createElement('span'); label.textContent = readableId(entry.id); label.title = entry.id;
      const value = document.createElement('strong'); value.textContent = formatStatisticValue(entry);
      row.append(label, value);
    }
    section.append(row);
  }

  function renderStatistics() {
    const list = $('statisticsList');
    const query = $('statisticsSearch').value.trim();
    const allRows = inspectorData.buildRows(statistics, moderationHistory);
    const filteredRows = inspectorData.filterRows(allRows, query);
    const page = inspectorData.paginateRows(filteredRows, statisticsPageIndex);
    statisticsPageIndex = page.page;
    const categoryTotals = new Map();
    for (const row of filteredRows) categoryTotals.set(row.categoryId, (categoryTotals.get(row.categoryId) || 0) + 1);
    const fragment = document.createDocumentFragment();
    let section = null;
    let currentCategory = '';
    for (const entry of page.rows) {
      if (entry.categoryId !== currentCategory) {
        currentCategory = entry.categoryId;
        section = document.createElement('section'); section.className = 'stat-category';
        const title = document.createElement('h2');
        title.textContent = `${entry.kind === 'history' ? entry.categoryLabel : readableId(entry.categoryLabel)} · ${categoryTotals.get(entry.categoryId)}`;
        section.append(title);
        fragment.append(section);
      }
      appendStatisticRow(section, entry);
    }
    if (!page.total) {
      const empty = document.createElement('div'); empty.className = 'statistics-empty';
      empty.textContent = query ? 'No statistics or actions match that search.' : 'No saved statistics or moderation actions yet.';
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
    const statisticCount = allRows.filter(row => row.kind === 'statistic').length;
    const historyCount = allRows.length - statisticCount;
    $('statisticsSummary').textContent = query
      ? `${page.total.toLocaleString()} match${page.total === 1 ? '' : 'es'}`
      : `${statisticCount.toLocaleString()} statistics · ${historyCount.toLocaleString()} actions`;
    $('statisticsPagination').hidden = page.pageCount <= 1;
    $('statisticsPageSummary').textContent = `Page ${page.page + 1} of ${page.pageCount} · ${page.start + (page.total ? 1 : 0)}–${page.end} of ${page.total.toLocaleString()}`;
    $('previousStatisticsPage').disabled = page.page === 0;
    $('nextStatisticsPage').disabled = page.page >= page.pageCount - 1;
  }

  function changeStatisticsPage(offset) {
    statisticsPageIndex += offset;
    renderStatistics();
    $('statisticsList').scrollTop = 0;
  }

  async function showStatistics() {
    const requestedPlayer = player;
    const generation = playerGeneration;
    $('profilePage').hidden = true;
    $('statisticsPage').hidden = false;
    $('openStatistics').hidden = true;
    $('backToProfile').hidden = false;
    $('refreshPlayer').hidden = true;
    $('playerTitle').textContent = `${player} · Statistics`;
    $('playerUpdated').textContent = 'Reading saved world statistics…';
    renderInspectorError();
    if (!statistics || statisticsPlayer !== player || statisticsSourceError) {
      const requestVersion = ++statisticsRequestVersion;
      if (!statistics) $('statisticsList').innerHTML = '<div class="statistics-empty">Loading statistics…</div>';
      const [statisticsResult, playerEventsResult, protectionHistoryResult] = await Promise.allSettled([
        api.getPlayerStatistics(requestedPlayer),
        typeof api.getPlayerEvents === 'function' ? api.getPlayerEvents() : Promise.resolve([]),
        typeof api.getProtectionHistory === 'function' ? api.getProtectionHistory({ player: requestedPlayer, limit: 1000 }) : Promise.resolve([])
      ]);
      if (generation !== playerGeneration || requestedPlayer !== player || requestVersion !== statisticsRequestVersion) return;
      const failures = [];
      const noteFailure = (label, result) => {
        const detail = String(result?.reason?.message || result?.reason || '').trim();
        failures.push(`${label}${detail ? `: ${detail}` : ''}`);
      };
      if (statisticsResult.status === 'fulfilled') statistics = statisticsResult.value;
      else {
        if (!statistics) statistics = { categories: [], totalEntries: 0 };
        noteFailure('statistics', statisticsResult);
      }
      if (playerEventsResult.status === 'fulfilled') {
        playerHistoryEvents = Array.isArray(playerEventsResult.value) ? playerEventsResult.value : [];
      } else noteFailure('player history', playerEventsResult);
      if (protectionHistoryResult.status === 'fulfilled') {
        protectionHistoryEvents = Array.isArray(protectionHistoryResult.value) ? protectionHistoryResult.value : [];
      } else noteFailure('protection history', protectionHistoryResult);
      moderationHistory = inspectorData.buildModerationHistory(requestedPlayer, playerHistoryEvents, protectionHistoryEvents);
      statisticsPageIndex = 0;
      statisticsSourceError = failures.length
        ? `Showing available data. Could not load ${failures.join('; ')}. Return to the player and open Statistics again to retry.`
        : '';
      statisticsPlayer = requestedPlayer;
      if ($('statisticsPage').hidden) return;
      renderInspectorError();
    }
    renderStatistics();
    $('playerUpdated').textContent = statisticsSourceError
      ? 'Showing partial saved data · reopen Statistics to retry missing sources.'
      : statistics?.updatedAt
        ? 'Statistics are read from Minecraft’s latest saved player data.'
        : 'Minecraft has not saved statistics for this player yet.';
  }

  function showProfile() {
    $('profilePage').hidden = false;
    $('statisticsPage').hidden = true;
    $('openStatistics').hidden = false;
    $('backToProfile').hidden = true;
    $('refreshPlayer').hidden = false;
    $('playerTitle').textContent = player ? `View ${player}` : 'View Player';
    if (latestResult) {
      renderProfile(latestResult);
      $('playerUpdated').textContent = `Updated ${new Date(latestResult?.updatedAt || lastSuccessfulRefreshAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } else if (profileError) {
      $('playerUpdated').textContent = lastSuccessfulRefreshAt
        ? `Unavailable · last available ${new Date(lastSuccessfulRefreshAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
        : 'Unavailable · no successful update';
    }
    renderInspectorError();
  }

  initializeSlots();
  $('refreshPlayer').addEventListener('click', () => refreshProfileAndStatus().catch(() => {}));
  $('playerViewViewer').addEventListener('change', () => renderPlayerViewControls());
  $('stopPlayerView').addEventListener('click', () => stopPlayerView().catch(() => {}));
  $('openStatistics').addEventListener('click', () => showStatistics().catch(() => {}));
  $('backToProfile').addEventListener('click', showProfile);
  $('statisticsSearch').addEventListener('input', () => { statisticsPageIndex = 0; renderStatistics(); });
  $('previousStatisticsPage').addEventListener('click', () => changeStatisticsPage(-1));
  $('nextStatisticsPage').addEventListener('click', () => changeStatisticsPage(1));
  $('closeInspector').addEventListener('click', () => window.bridge.closeCurrentWindow());
  $('playerModel').addEventListener('pointerdown', event => {
    dragStart = { x: event.clientX, yaw: modelYaw };
    $('playerModel').setPointerCapture(event.pointerId);
  });
  $('playerModel').addEventListener('pointermove', event => {
    if (!dragStart) return;
    modelYaw = dragStart.yaw + (event.clientX - dragStart.x) * .7;
    updateModelRotation();
  });
  $('playerModel').addEventListener('pointerup', () => { dragStart = null; });
  $('playerModel').addEventListener('pointercancel', () => { dragStart = null; });
  window.bridge.onPlayerInspectorName(setPlayer);
  let bridgedPlayer = '';
  try { bridgedPlayer = window.bridge.loadPlayerInspectorName(); } catch {}
  setPlayer(inspectorData.resolveInitialPlayerName(window.location.search, bridgedPlayer));
  refreshTimer = setInterval(() => {
    if (!document.hidden && $('statisticsPage').hidden) {
      refreshProfileAndStatus().catch(() => {});
    }
  }, 4000);
  window.addEventListener('beforeunload', () => clearInterval(refreshTimer));
})();
