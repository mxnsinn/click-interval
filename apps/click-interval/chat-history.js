const api = window.bridge.minecraftServer;
const list = document.getElementById('messages');
const search = document.getElementById('search');
const kind = document.getElementById('kind');
let entries = [];

function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function render() {
  const query = search.value.toLowerCase();
  list.textContent = '';
  const shown = entries.filter(entry => {
    const typeMatches = kind.value === 'all' || entry.kind === kind.value;
    const haystack = `${entry.sender || ''} ${entry.recipient || ''} ${entry.message || ''}`.toLowerCase();
    return typeMatches && (!query || haystack.includes(query));
  });
  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No chat messages yet.';
    list.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of shown) {
    const row = document.createElement('div');
    row.className = `row ${entry.kind === 'private' ? 'private' : 'chat'}`;
    const date = new Date(entry.timestamp);
    row.append(span('time', Number.isNaN(date.valueOf()) ? '—' : date.toLocaleTimeString()));
    row.append(span('sender', entry.sender || 'Unknown'));
    if (entry.recipient) row.append(span('recipient', ` → ${entry.recipient}`));
    row.append(span('message', `: ${entry.message || ''}`));
    fragment.append(row);
  }
  list.append(fragment);
  list.scrollTop = list.scrollHeight;
}

api.onChatHistory(value => { entries = Array.isArray(value) ? value : []; render(); });
api.onChat(entry => {
  entries.push(entry);
  if (entries.length > 5000) entries = entries.slice(-5000);
  render();
});
search.addEventListener('input', render);
kind.addEventListener('change', render);
document.getElementById('export').addEventListener('click', () => api.exportChatHistory());
document.querySelector('[data-window-action="close"]').addEventListener('click', () => window.bridge.closeCurrentWindow());
api.getChatHistory().then(value => { entries = Array.isArray(value) ? value : []; render(); });
