const api = window.entityViewer;
const $ = id => document.getElementById(id);

const ITEM_ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const INITIAL_ENTITY_ID = normalizeEntityId(new URLSearchParams(location.search).get('entity'));

let catalogue = {
  available: false,
  bridgeAvailable: false,
  serverState: 'stopped',
  entities: [],
  message: ''
};
let selectedId = '';
let selectedDetail = null;
let listBusy = false;
let inspectGeneration = 0;
let refreshTimer = null;
let pendingInitialEntityId = INITIAL_ENTITY_ID;

function text(value, limit = 160) {
  return String(value ?? '').trim().slice(0, limit);
}

function normalizeEntityId(value) {
  const id = text(value, 128);
  return ENTITY_ID_PATTERN.test(id) ? id : '';
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positionOf(value = {}) {
  const source = value.position && typeof value.position === 'object' ? value.position : value;
  return { x: finiteNumber(source.x), y: finiteNumber(source.y), z: finiteNumber(source.z) };
}

function normalizeEntity(value = {}) {
  const uuid = text(value.entityUuid || value.uuid, 128);
  const id = normalizeEntityId(uuid || value.stableId || value.id);
  if (!id) return null;
  const position = positionOf(value);
  const type = text(value.type || value.entityType || value.kind || 'minecraft:entity', 128).toLowerCase();
  return {
    ...value,
    id,
    uuid,
    stableId: text(value.stableId || value.id, 128),
    type,
    name: text(value.name || value.customName || value.displayName, 128),
    dimension: text(value.dimension || value.world, 128),
    x: position.x,
    y: position.y,
    z: position.z
  };
}

function normalizeCatalogue(value) {
  const source = Array.isArray(value) ? { entities: value, available: true, bridgeAvailable: true, serverState: 'running' } : (value || {});
  const entities = (Array.isArray(source.entities) ? source.entities : []).map(normalizeEntity).filter(Boolean).slice(0, 1000);
  const bridgeAvailable = source.bridgeAvailable !== undefined ? Boolean(source.bridgeAvailable) : source.available !== false;
  return {
    available: source.available !== undefined ? Boolean(source.available) : bridgeAvailable,
    bridgeAvailable,
    serverState: text(source.serverState || 'unknown', 24).toLowerCase(),
    entities,
    message: text(source.message, 240),
    requestedId: normalizeEntityId(source.requestedId || source.selectedId || source.targetId)
  };
}

function normalizeStack(value, fallbackId = '') {
  const source = value && typeof value === 'object' ? value : {};
  const id = text(source.id || source.item || source.itemId || fallbackId, 128).toLowerCase();
  const count = Math.max(1, Math.min(64, Math.round(finiteNumber(source.count ?? source.Count) || 1)));
  return { id, count };
}

function normalizeOffer(value = {}, index = 0) {
  const buy = normalizeStack(value.buy || value.buyA || value.costA, 'minecraft:emerald');
  const rawBuyB = value.buyB || value.costB || null;
  const buyB = rawBuyB ? normalizeStack(rawBuyB) : { id: '', count: 1 };
  const sell = normalizeStack(value.sell || value.result, 'minecraft:air');
  return {
    index: Number.isSafeInteger(Number(value.index)) ? Number(value.index) : index,
    buy,
    buyB,
    sell,
    uses: Math.max(0, Math.round(finiteNumber(value.uses) || 0)),
    maxUses: Math.max(1, Math.round(finiteNumber(value.maxUses) || 1)),
    xp: Math.max(0, Math.round(finiteNumber(value.xp ?? value.villagerXp) || 0)),
    demand: Math.round(finiteNumber(value.demand) || 0),
    specialPrice: Math.round(finiteNumber(value.specialPrice) || 0),
    priceMultiplier: Math.max(0, finiteNumber(value.priceMultiplier) || 0),
    rewardExp: value.rewardExp !== false
  };
}

function normalizeDetail(value = {}, fallback = null) {
  const base = normalizeEntity({ ...(fallback || {}), ...(value || {}) });
  if (!base) throw new Error('Minecraft returned an invalid entity identifier.');
  const offers = (Array.isArray(value.offers) ? value.offers : []).slice(0, 128).map(normalizeOffer);
  return { ...base, ...value, id: base.id, uuid: base.uuid, stableId: base.stableId, type: base.type, name: base.name, dimension: base.dimension, x: base.x, y: base.y, z: base.z, offers };
}

function readableError(error) {
  return String(error?.message || error || 'Something went wrong.')
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^(?:Error:\s*)+/i, '');
}

function coordinate(value) {
  const number = finiteNumber(value);
  if (number === null) return '—';
  const rounded = Math.round(number * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function prettyType(value) {
  const path = text(value || 'entity').split(':').at(-1).replace(/_/g, ' ');
  return path.replace(/\b\w/g, letter => letter.toUpperCase());
}

function prettyDimension(value) {
  const clean = text(value).replace(/^minecraft:/, '').replace(/^the_/, '').replace(/_/g, ' ');
  return clean ? clean.replace(/\b\w/g, letter => letter.toUpperCase()) : '—';
}

function entityLabel(entity) {
  return entity.name || prettyType(entity.type);
}

function setViewerState(value) {
  const state = text(value || 'unknown', 24).toLowerCase();
  const status = $('viewerState');
  const unavailable = catalogue.bridgeAvailable === false && state === 'running';
  status.dataset.state = unavailable ? 'unavailable' : state;
  status.querySelector('span').textContent = unavailable ? 'Bridge unavailable' : state.charAt(0).toUpperCase() + state.slice(1);
}

function setNotice(message = '', isError = false) {
  $('entityNotice').textContent = message;
  $('entityNotice').classList.toggle('error', isError);
}

function showEmpty(title, detail) {
  $('entityDetail').hidden = true;
  $('entityLoading').hidden = true;
  $('entityEmpty').hidden = false;
  $('entityEmptyTitle').textContent = title;
  $('entityEmptyDetail').textContent = detail;
}

function renderAvailability() {
  if (selectedDetail) return;
  const state = catalogue.serverState;
  if (listBusy && !catalogue.entities.length) {
    showEmpty('Loading entities', 'Waiting for the server bridge.');
  } else if (['stopped', 'starting', 'stopping', 'error'].includes(state)) {
    const title = state === 'stopped' ? 'Server is stopped' : `Server is ${state}`;
    showEmpty(title, 'Entity data becomes available after the Minecraft server is running.');
  } else if (!catalogue.bridgeAvailable) {
    showEmpty('Entity bridge unavailable', catalogue.message || 'The server does not currently provide loaded entity data.');
  } else if (!catalogue.available) {
    showEmpty('Entity data unavailable', catalogue.message || 'The bridge is running but has not returned entity data.');
  } else if (!catalogue.entities.length) {
    showEmpty('No loaded entities', 'Entities will appear when their chunks are loaded.');
  } else {
    showEmpty('Select an entity', 'Choose a loaded entity to inspect or edit it.');
  }
}

function selectedSummary() {
  return catalogue.entities.find(entity => entity.id.toLowerCase() === selectedId.toLowerCase()) || null;
}

function renderEntityList() {
  const query = $('entitySearch').value.trim().toLowerCase();
  const visible = catalogue.entities.filter(entity => {
    if (!query) return true;
    return [entityLabel(entity), entity.type, entity.id, entity.dimension].some(value => String(value || '').toLowerCase().includes(query));
  });
  $('entityCount').textContent = String(catalogue.entities.length);
  const fragment = document.createDocumentFragment();
  for (const entity of visible) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'entity-row';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(entity.id.toLowerCase() === selectedId.toLowerCase()));
    const marker = document.createElement('span');
    marker.className = 'entity-row-marker';
    marker.textContent = prettyType(entity.type).slice(0, 1) || 'E';
    const copy = document.createElement('span');
    copy.className = 'entity-row-copy';
    const name = document.createElement('strong');
    name.textContent = entityLabel(entity);
    const location = document.createElement('span');
    location.textContent = `${prettyType(entity.type)} · ${coordinate(entity.x)}, ${coordinate(entity.y)}, ${coordinate(entity.z)}`;
    copy.append(name, location);
    row.append(marker, copy);
    row.addEventListener('click', () => selectEntity(entity.id));
    fragment.append(row);
  }
  $('entityList').replaceChildren(fragment);
  $('entityListEmpty').hidden = visible.length > 0;
  $('entityListEmpty').textContent = query && catalogue.entities.length ? 'No matching entities' : 'No loaded entities';
}

function makeInput({ type = 'text', value = '', min, max, step, field, label, optional = false }) {
  const input = document.createElement('input');
  input.type = type;
  input.value = String(value ?? '');
  input.dataset.field = field;
  input.setAttribute('aria-label', label);
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (step !== undefined) input.step = String(step);
  if (type === 'text') {
    input.maxLength = 128;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.pattern = '[a-z0-9_.-]+:[a-z0-9_./-]+';
    input.required = !optional;
  }
  return input;
}

function offerItem(title, item, prefix, optional = false) {
  const wrap = document.createElement('label');
  wrap.className = 'offer-item';
  const heading = document.createElement('span');
  heading.textContent = title;
  const id = makeInput({ value: item.id, field: `${prefix}Id`, label: `${title} item ID`, optional });
  const count = makeInput({ type: 'number', value: item.count, min: 1, max: 64, step: 1, field: `${prefix}Count`, label: `${title} count` });
  wrap.append(heading, id, count);
  return wrap;
}

function offerNumber(title, value, field, min, max, step = 1) {
  const label = document.createElement('label');
  label.className = 'offer-number';
  const heading = document.createElement('span');
  heading.textContent = title;
  label.append(heading, makeInput({ type: 'number', value, min, max, step, field, label: title }));
  return label;
}

function renderOffers(offers) {
  const fragment = document.createDocumentFragment();
  for (const offer of offers) {
    const form = document.createElement('form');
    form.className = 'offer-card';
    form.dataset.index = String(offer.index);
    const head = document.createElement('div');
    head.className = 'offer-card-head';
    const title = document.createElement('strong');
    title.textContent = `Offer ${offer.index + 1}`;
    const usage = document.createElement('span');
    usage.textContent = `${offer.uses} / ${offer.maxUses} uses`;
    head.append(title, usage);
    const items = document.createElement('div');
    items.className = 'offer-items';
    items.append(offerItem('Cost', offer.buy, 'buy'), offerItem('Second cost', offer.buyB, 'buyB', true), offerItem('Result', offer.sell, 'sell'));
    const advanced = document.createElement('div');
    advanced.className = 'offer-advanced';
    advanced.append(
      offerNumber('Max uses', offer.maxUses, 'maxUses', Math.max(1, offer.uses), 999),
      offerNumber('Villager XP', offer.xp, 'xp', 0, 10000),
      offerNumber('Price multiplier', offer.priceMultiplier, 'priceMultiplier', 0, 1, 0.01)
    );
    const save = document.createElement('button');
    save.className = 'offer-save';
    save.type = 'submit';
    save.textContent = 'Save offer';
    advanced.append(save);
    form.append(head, items, advanced);
    form.addEventListener('submit', saveOffer);
    fragment.append(form);
  }
  $('offerList').replaceChildren(fragment);
  $('offerCount').textContent = String(offers.length);
  $('offersEmpty').hidden = offers.length > 0;
}

function capability(detail, name) {
  const capabilities = detail.capabilities && typeof detail.capabilities === 'object' ? detail.capabilities : {};
  const editable = detail.editable && typeof detail.editable === 'object' ? detail.editable : {};
  const aliases = {
    age: ['age', 'setAge', 'editAge'],
    cooldown: ['cooldown', 'setCooldown', 'breedingCooldown'],
    offers: ['offers', 'updateOffers', 'villagerOffers']
  };
  return (aliases[name] || [name]).some(key => Boolean(capabilities[key] || editable[key]));
}

function renderDetail(detail) {
  $('entityEmpty').hidden = true;
  $('entityLoading').hidden = true;
  $('entityDetail').hidden = false;
  $('entityName').textContent = entityLabel(detail);
  $('entityType').textContent = detail.type;
  $('entityGlyph').textContent = prettyType(detail.type).slice(0, 1) || 'E';
  $('entityId').textContent = detail.uuid || detail.stableId || detail.id;
  $('entityDimension').textContent = prettyDimension(detail.dimension);
  $('entityX').textContent = coordinate(detail.x);
  $('entityY').textContent = coordinate(detail.y);
  $('entityZ').textContent = coordinate(detail.z);

  const isVillager = /(?:^|:)villager$/.test(detail.type) || capability(detail, 'offers') || Array.isArray(detail.offersSource) || detail.offers.length > 0;
  const rawAge = finiteNumber(detail.ageTicks ?? detail.age);
  const remainingTicks = finiteNumber(detail.remainingGrowthTicks) ?? (rawAge !== null && rawAge < 0 ? Math.abs(rawAge) : 0);
  const baby = detail.baby !== undefined ? Boolean(detail.baby) : rawAge !== null && rawAge < 0;
  const ageVisible = isVillager && (capability(detail, 'age') || detail.baby !== undefined || rawAge !== null);
  $('ageForm').hidden = !ageVisible;
  $('entityStage').value = baby ? 'baby' : 'adult';
  $('entityGrowthSeconds').value = String(Math.max(1, Math.min(1200, Math.ceil((remainingTicks || 24000) / 20))));
  $('growthTimeRow').hidden = !baby;

  const rawCooldown = finiteNumber(detail.breedingCooldownTicks) ?? (rawAge !== null && rawAge > 0 ? rawAge : 0);
  const cooldownVisible = isVillager || capability(detail, 'cooldown') || detail.breedable === true || detail.inLoveTicks !== undefined;
  $('cooldownForm').hidden = !cooldownVisible;
  $('entityCooldownSeconds').value = String(Math.max(0, Math.min(3600, Math.ceil(rawCooldown / 20))));

  $('offersSection').hidden = !isVillager;
  renderOffers(isVillager ? detail.offers : []);
}

function setFormBusy(form, busy) {
  for (const element of form.querySelectorAll('input,select,button')) element.disabled = busy;
}

function field(form, name) {
  return form.querySelector(`[data-field="${name}"]`);
}

function itemId(input, label, optional = false) {
  const value = text(input?.value, 128).toLowerCase();
  if (!value && optional) return '';
  if (!ITEM_ID_PATTERN.test(value)) throw new Error(`${label} must use namespace:item format.`);
  return value;
}

function boundedInteger(input, label, min, max) {
  const value = Number(input?.value);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}

function boundedNumber(input, label, min, max) {
  const value = Number(input?.value);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return Math.round(value * 100) / 100;
}

async function refreshSelected() {
  if (!selectedId) return;
  await selectEntity(selectedId, true);
}

async function saveOffer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!selectedDetail || !form.reportValidity()) return;
  setFormBusy(form, true);
  try {
    const index = boundedInteger({ value: form.dataset.index }, 'Offer index', 0, 127);
    const buyBId = itemId(field(form, 'buyBId'), 'Second cost item', true);
    const payload = {
      buy: { id: itemId(field(form, 'buyId'), 'Cost item'), count: boundedInteger(field(form, 'buyCount'), 'Cost count', 1, 64) },
      buyB: buyBId ? { id: buyBId, count: boundedInteger(field(form, 'buyBCount'), 'Second cost count', 1, 64) } : null,
      sell: { id: itemId(field(form, 'sellId'), 'Result item'), count: boundedInteger(field(form, 'sellCount'), 'Result count', 1, 64) },
      maxUses: boundedInteger(field(form, 'maxUses'), 'Max uses', 1, 999),
      xp: boundedInteger(field(form, 'xp'), 'Villager XP', 0, 10000),
      priceMultiplier: boundedNumber(field(form, 'priceMultiplier'), 'Price multiplier', 0, 1)
    };
    const currentOffer = selectedDetail.offers.find(offer => offer.index === index);
    if (currentOffer?.uses > payload.maxUses) throw new Error('Max uses cannot be lower than current uses.');
    const result = await api.updateOffer(selectedDetail.id, index, payload);
    const message = text(result?.message, 240) || `Offer ${index + 1} saved.`;
    await refreshSelected();
    setNotice(message);
  } catch (error) {
    setNotice(readableError(error), true);
  } finally {
    setFormBusy(form, false);
  }
}

async function saveAge(event) {
  event.preventDefault();
  if (!selectedDetail || !event.currentTarget.reportValidity()) return;
  const form = event.currentTarget;
  setFormBusy(form, true);
  try {
    const baby = $('entityStage').value === 'baby';
    const seconds = baby ? boundedInteger($('entityGrowthSeconds'), 'Growth time', 1, 1200) : 0;
    const result = await api.setAge(selectedDetail.id, { baby, remainingTicks: seconds * 20 });
    const message = text(result?.message, 240) || 'Entity age saved.';
    await refreshSelected();
    setNotice(message);
  } catch (error) {
    setNotice(readableError(error), true);
  } finally {
    setFormBusy(form, false);
  }
}

async function saveCooldown(event) {
  event.preventDefault();
  if (!selectedDetail || !event.currentTarget.reportValidity()) return;
  const form = event.currentTarget;
  setFormBusy(form, true);
  try {
    const seconds = boundedInteger($('entityCooldownSeconds'), 'Breeding cooldown', 0, 3600);
    const result = await api.setCooldown(selectedDetail.id, { ticks: seconds * 20 });
    const message = text(result?.message, 240) || 'Breeding cooldown saved.';
    await refreshSelected();
    setNotice(message);
  } catch (error) {
    setNotice(readableError(error), true);
  } finally {
    setFormBusy(form, false);
  }
}

async function selectEntity(id, force = false) {
  const normalized = normalizeEntityId(id);
  if (!normalized) {
    setNotice('That entity identifier is invalid.', true);
    return;
  }
  if (!force && selectedId.toLowerCase() === normalized.toLowerCase() && selectedDetail) return;
  selectedId = normalized;
  selectedDetail = null;
  renderEntityList();
  $('entityEmpty').hidden = true;
  $('entityDetail').hidden = true;
  $('entityLoading').hidden = false;
  const generation = ++inspectGeneration;
  try {
    const result = await api.inspect(normalized);
    if (generation !== inspectGeneration || selectedId.toLowerCase() !== normalized.toLowerCase()) return;
    selectedDetail = normalizeDetail(result, selectedSummary() || { id: normalized });
    renderDetail(selectedDetail);
    $('entityUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    setNotice('');
  } catch (error) {
    if (generation !== inspectGeneration) return;
    selectedDetail = null;
    showEmpty('Could not inspect entity', readableError(error));
    setNotice(readableError(error), true);
  }
}

async function refreshList({ refreshDetail = false } = {}) {
  if (listBusy) return;
  listBusy = true;
  renderAvailability();
  try {
    const value = await api.list();
    catalogue = normalizeCatalogue(value);
    setViewerState(catalogue.serverState);
    renderEntityList();
    if (selectedId && !selectedSummary()) {
      selectedId = '';
      selectedDetail = null;
      inspectGeneration += 1;
    }
    const canInspect = catalogue.available && catalogue.bridgeAvailable && !['stopped', 'starting', 'stopping', 'error'].includes(catalogue.serverState);
    const target = selectedId || catalogue.requestedId || pendingInitialEntityId;
    if (canInspect && target && (!selectedDetail || refreshDetail)) {
      if (target === pendingInitialEntityId) pendingInitialEntityId = '';
      await selectEntity(target, refreshDetail);
    }
    else renderAvailability();
    if (catalogue.message && !selectedDetail) setNotice(catalogue.message, !catalogue.bridgeAvailable);
    $('entityUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    catalogue = { ...catalogue, available: false, bridgeAvailable: false, message: readableError(error) };
    setViewerState('unavailable');
    renderEntityList();
    showEmpty('Entity bridge unavailable', readableError(error));
    setNotice(readableError(error), true);
  } finally {
    listBusy = false;
  }
}

$('minimizeEntityViewer').addEventListener('click', api.minimizeWindow);
$('closeEntityViewer').addEventListener('click', api.closeWindow);
$('refreshEntities').addEventListener('click', () => refreshList({ refreshDetail: Boolean(selectedId) }));
$('entitySearch').addEventListener('input', renderEntityList);
$('entityStage').addEventListener('change', () => { $('growthTimeRow').hidden = $('entityStage').value !== 'baby'; });
$('ageForm').addEventListener('submit', saveAge);
$('cooldownForm').addEventListener('submit', saveCooldown);

document.addEventListener('visibilitychange', () => {
  clearInterval(refreshTimer);
  refreshTimer = null;
  if (!document.hidden) {
    refreshList();
    refreshTimer = setInterval(refreshList, 4000);
  }
});
window.addEventListener('beforeunload', () => clearInterval(refreshTimer));

refreshList();
refreshTimer = setInterval(refreshList, 4000);
