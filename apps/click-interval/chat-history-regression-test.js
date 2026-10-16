const assert = require('assert');
const fs = require('fs');

const main = fs.readFileSync('minecraft-server/main.js', 'utf8');
const preload = fs.readFileSync('preload.js', 'utf8');
const consoleJs = fs.readFileSync('server-console.js', 'utf8');
const builder = fs.readFileSync('build-development-update.ps1', 'utf8');

assert.match(main, /function parseChatLogLine[\s\S]*kind: 'chat'[\s\S]*kind: 'private'/);
assert.match(main, /chat-history\.jsonl/);
assert.match(main, /ipcMain\.handle\('chat-history:open'/);
assert.match(main, /Portable web page[\s\S]*extensions: \['html'\]/);
assert.match(preload, /openChatHistory:[\s\S]*getChatHistory:[\s\S]*exportChatHistory:/);
assert.match(consoleJs, /lower === '\/chat-history'[\s\S]*api\.openChatHistory/);
for (const file of ['chat-history.html', 'chat-history.js', 'chat-history.css']) {
  assert.ok(fs.existsSync(file), `${file} is missing`);
  assert.ok(builder.includes(`'${file}'`), `${file} is not packaged`);
}
console.log('chat history regression checks passed');
