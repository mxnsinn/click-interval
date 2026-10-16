(function exposePlayerInspectorData(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  if (root) root.PlayerInspectorData = value;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';

  const DEFAULT_PAGE_SIZE = 120;
  const MAX_HISTORY_ROWS = 1000;
  const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

  function clean(value, maximum = 500) {
    return String(value || '').replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
  }

  function validPlayerName(value) {
    const name = String(value || '').trim();
    return PLAYER_NAME_PATTERN.test(name) ? name : '';
  }

  function resolveInitialPlayerName(locationSearch, bridgedName) {
    let queryName = '';
    try {
      queryName = new URLSearchParams(String(locationSearch || '')).get('player') || '';
    } catch {}
    return validPlayerName(queryName) || validPlayerName(bridgedName);
  }

  function canonicalAction(value) {
    const action = clean(value, 40).toLowerCase().replace(/_/g, '-');
    if (['warn', 'warning', 'alert', 'detect', 'detection', 'log', 'cheat-detected'].includes(action)) return 'warning';
    if (action === 'kick' || action === 'kicked') return 'kick';
    if (action === 'temp-ban' || action === 'temporary-ban' || action === 'temp-ban-updated') return 'temp-ban';
    if (action === 'ban' || action === 'banned' || action === 'permanent-ban') return 'ban';
    return '';
  }

  function actionLabel(action) {
    if (action === 'temp-ban') return 'Temporary ban';
    return action ? action[0].toUpperCase() + action.slice(1) : 'Action';
  }

  function validTimestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }

  function eventKey(event) {
    return [event.timestamp, event.action, event.reason.toLowerCase()].join('\0');
  }

  function normalizeHistoryEvent(value, source, player) {
    const event = value && typeof value === 'object' ? value : {};
    const name = clean(event.player || event.name, 16);
    if (name && name.toLowerCase() !== player.toLowerCase()) return null;
    const action = canonicalAction(event.action || event.type || event.event);
    const timestamp = validTimestamp(event.timestamp);
    if (!action || !timestamp) return null;
    const check = clean(event.check, 128);
    const reason = clean(event.reason, 240);
    const expiresAt = validTimestamp(event.expiresAt);
    return {
      kind: 'history',
      categoryId: 'moderation-history',
      categoryLabel: 'Warnings, kicks & bans',
      id: clean(event.id, 100) || `${source}:${timestamp}:${action}:${reason}`,
      action,
      label: actionLabel(action),
      check,
      reason,
      timestamp,
      expiresAt,
      source
    };
  }

  function buildModerationHistory(player, playerEvents, protectionEvents) {
    const target = clean(player, 16);
    if (!target) return [];
    const rows = [];
    const seen = new Set();
    const sources = [
      ['protection', Array.isArray(protectionEvents) ? protectionEvents : []],
      ['player-history', Array.isArray(playerEvents) ? playerEvents : []]
    ];
    for (const [source, events] of sources) {
      for (const event of events) {
        const row = normalizeHistoryEvent(event, source, target);
        if (!row) continue;
        const key = eventKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    }
    return rows
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.action.localeCompare(right.action))
      .slice(0, MAX_HISTORY_ROWS);
  }

  function buildRows(statistics, moderationHistory) {
    const rows = [...(Array.isArray(moderationHistory) ? moderationHistory : [])];
    for (const category of Array.isArray(statistics?.categories) ? statistics.categories : []) {
      const categoryId = clean(category?.id, 128);
      if (!categoryId) continue;
      for (const entry of Array.isArray(category?.entries) ? category.entries : []) {
        const id = clean(entry?.id, 256);
        const value = Number(entry?.value);
        if (!id || !Number.isSafeInteger(value) || value < 0) continue;
        rows.push({
          kind: 'statistic',
          categoryId,
          categoryLabel: categoryId,
          id,
          value
        });
      }
    }
    return rows;
  }

  function rowSearchText(row) {
    return [row.categoryId, row.categoryLabel, row.id, row.label, row.action, row.check, row.reason, row.timestamp, row.expiresAt]
      .map((value) => {
        const normalized = clean(value).toLowerCase();
        return `${normalized} ${normalized.replace(/^minecraft:/, '').replace(/[_./-]+/g, ' ')}`;
      })
      .join(' ');
  }

  function filterRows(rows, query) {
    const needle = clean(query).toLowerCase();
    const source = Array.isArray(rows) ? rows : [];
    return needle ? source.filter(row => rowSearchText(row).includes(needle)) : source.slice();
  }

  function paginateRows(rows, requestedPage = 0, requestedPageSize = DEFAULT_PAGE_SIZE) {
    const source = Array.isArray(rows) ? rows : [];
    const pageSize = Math.max(20, Math.min(250, Math.round(Number(requestedPageSize) || DEFAULT_PAGE_SIZE)));
    const pageCount = Math.max(1, Math.ceil(source.length / pageSize));
    const page = Math.max(0, Math.min(pageCount - 1, Math.round(Number(requestedPage) || 0)));
    const start = page * pageSize;
    return {
      page,
      pageSize,
      pageCount,
      total: source.length,
      start,
      end: Math.min(source.length, start + pageSize),
      rows: source.slice(start, start + pageSize)
    };
  }

  return Object.freeze({
    DEFAULT_PAGE_SIZE,
    MAX_HISTORY_ROWS,
    validPlayerName,
    resolveInitialPlayerName,
    canonicalAction,
    buildModerationHistory,
    buildRows,
    filterRows,
    paginateRows
  });
});
