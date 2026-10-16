const consoleEl = document.getElementById('consoleLog');
let renderedTextLength = 0;

function getLogType(line) {
  const text = String(line || '');
  if (/\b(error|exception|failed|failure|crash|fatal|denied|refused|timed out|not reachable)\b/i.test(text)) return 'error';
  if (/\b(warn|warning|deprecated|skipped|blocked)\b/i.test(text)) return 'warning';
  if (/\b(done|started|starting|loaded|saved|online|reachable|success|mapped|downloaded|detected|copied)\b/i.test(text)) return 'success';
  if (/\b(assembly|ASM-[A-Z]+-\d+|\[playit\]|direct hosting|router|public|tunnel|diagnostic|repair)\b/i.test(text)) return 'assembly';
  if (/\b(joined|left|logged in|lost connection|players?)\b/i.test(text)) return 'player';
  if (/^>/.test(text)) return 'command';
  return 'info';
}

function appendLogLine(text) {
  const line = document.createElement('div');
  line.className = `console-line ${getLogType(text)}`;
  line.textContent = text || ' ';
  consoleEl.append(line);
  renderedTextLength += text.length + 1;
}

function trimLog() {
  const limit = 500_000;
  while (renderedTextLength > limit && consoleEl.firstChild) {
    renderedTextLength -= consoleEl.firstChild.textContent.length + 1;
    consoleEl.firstChild.remove();
  }
}

function appendLog(chunk) {
  const text = String(chunk || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (index === lines.length - 1 && line === '') return;
    appendLogLine(line);
  });
  trimLog();
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function replaceLog(log) {
  consoleEl.replaceChildren();
  renderedTextLength = 0;
  appendLog(log || '');
}

document.getElementById('minimizeBtn').addEventListener('click', () => window.assembly.minimizeWindow());
document.getElementById('maximizeBtn').addEventListener('click', () => window.assembly.maximizeWindow());
document.getElementById('closeBtn').addEventListener('click', () => window.assembly.closeWindow());

document.getElementById('consoleClearBtn').addEventListener('click', async () => {
  await window.assembly.clearLogs();
  replaceLog('');
});

document.getElementById('consoleStartBtn').addEventListener('click', async () => {
  try {
    await window.assembly.startServer();
  } catch (error) {
    appendLog(`${error.message || String(error)}\n`);
  }
});

document.getElementById('consoleStopBtn').addEventListener('click', async () => {
  try {
    await window.assembly.stopServer();
  } catch (error) {
    appendLog(`${error.message || String(error)}\n`);
  }
});

window.assembly.onLog(appendLog);
window.assembly.onClearLog(() => replaceLog(''));

window.assembly.getConsoleLog().then(replaceLog);
