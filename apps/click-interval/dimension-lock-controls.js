'use strict';

// Shared by both Settings screens. Merely displaying a timer never schedules it.
(function (root, factory) {
  const controls = factory();
  if (typeof module === 'object' && module.exports) module.exports = controls;
  else root.DimensionLockControls = controls;
})(typeof window === 'object' ? window : globalThis, function () {
  const domains = [['lockNether', 'nether', 'Nether'], ['lockEnd', 'end', 'End']];
  const units = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
  function schedule(lock) {
    const autoOpen = Boolean(lock?.locked && (Number(lock.unlockAtMillis) > 0 || Number(lock.startOnLaunchMillis) > 0));
    const durationSeconds = autoOpen ? Number(lock.durationSeconds) || Math.ceil((Number(lock.openingDurationMillis) || Number(lock.startOnLaunchMillis) || Math.max(0, Number(lock.unlockAtMillis) - Date.now())) / 1000) : 0;
    return { locked: Boolean(lock?.locked), autoOpen, durationSeconds };
  }
  function createDraft(details, profileId) {
    if (!details) return null;
    return { revision: details.revision, worldName: details.worldName, profileId,
      lockNether: schedule(details.nether), lockEnd: schedule(details.end) };
  }
  function hydrate(draft, get) {
    for (const [key, domain] of domains) {
      const lock = draft?.[key] || { locked: false, autoOpen: false, durationSeconds: 0 };
      const unit = ['days', 'hours', 'minutes', 'seconds'].find(name => lock.durationSeconds > 0 && lock.durationSeconds % units[name] === 0) || 'hours';
      if (get(key)) get(key).checked = lock.locked;
      if (get(`${domain}AutoOpen`)) get(`${domain}AutoOpen`).checked = lock.autoOpen;
      if (get(`${domain}Duration`)) get(`${domain}Duration`).value = lock.durationSeconds ? String(lock.durationSeconds / units[unit]) : '';
      if (get(`${domain}DurationUnit`)) get(`${domain}DurationUnit`).value = unit;
    }
  }
  function collect(draft, get) {
    if (!draft) return null;
    const changes = {};
    for (const [key, domain, title] of domains) {
      const lock = get(key), auto = get(`${domain}AutoOpen`);
      if (!lock || lock.disabled) continue;
      const locked = lock.checked === true, autoOpen = locked && auto?.checked === true;
      const before = draft[key];
      if (!autoOpen) {
        if (locked !== before.locked || before.autoOpen) changes[key] = locked;
        continue;
      }
      const multiplier = units[get(`${domain}DurationUnit`)?.value];
      const durationSeconds = Number(get(`${domain}Duration`)?.value) * multiplier;
      if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 31536000) {
        throw Error(`Choose a ${title} opening timer between 1 second and 365 days.`);
      }
      if (locked !== before.locked || autoOpen !== before.autoOpen || durationSeconds !== before.durationSeconds) {
        changes[key] = { locked, autoOpen, durationSeconds };
      }
    }
    return Object.keys(changes).length ? { revision: draft.revision, worldName: draft.worldName, profileId: draft.profileId, changes } : null;
  }
  function sync(details, get) {
    for (const [key, domain, title] of domains) {
      const lock = get(key), auto = get(`${domain}AutoOpen`), duration = get(`${domain}Duration`), unit = get(`${domain}DurationUnit`), row = get(`${domain}Timer`), hint = get(`${domain}LockHint`);
      if (!lock) continue;
      const current = details?.[domain];
      lock.disabled = !(details?.canEdit || (details?.canUnlock && current?.locked));
      lock.indeterminate = !details?.revision;
      if (auto) auto.disabled = !details?.canEdit || !lock.checked;
      const enabled = Boolean(lock.checked && auto?.checked);
      if (duration) { duration.disabled = !details?.canEdit || !enabled; duration.required = enabled; }
      if (unit) unit.disabled = !details?.canEdit || !enabled;
      if (row) row.hidden = !enabled;
      let message = lock.disabled ? details?.message || 'Dimension-lock status is not available yet.' :
        enabled ? 'New or changed timers start when you Save, or on the next server start if stopped. Saving other settings keeps the opening time. The countdown continues offline.' :
        lock.checked ? `Stays locked until you uncheck Lock ${title} and Save.` : `Open manually: leave Lock ${title} unchecked and Save.`;
      if (current?.locked && Number(current.unlockAtMillis) > 0) message = `Current opening: ${new Date(Number(current.unlockAtMillis)).toLocaleString()}. ${message}`;
      else if (current?.locked && Number(current.startOnLaunchMillis) > 0) message = `Current timer starts on the next server launch. ${message}`;
      if (hint) hint.textContent = message;
      lock.title = message;
    }
  }
  function bind(get, details, changed) {
    for (const [key, domain] of domains) {
      get(key)?.addEventListener('change', () => {
        if (!get(key).checked && get(`${domain}AutoOpen`)) get(`${domain}AutoOpen`).checked = false;
        changed(); sync(details(), get);
      });
      for (const id of [`${domain}AutoOpen`, `${domain}Duration`, `${domain}DurationUnit`]) {
        get(id)?.addEventListener(id.endsWith('Duration') ? 'input' : 'change', () => { changed(); sync(details(), get); });
      }
    }
  }
  return { createDraft, hydrate, collect, sync, bind };
});
