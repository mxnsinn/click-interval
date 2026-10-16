const endpoint = process.env.TOOLTIP_TEST_ENDPOINT || 'http://127.0.0.1:9335/json';
let target;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const targets = await (await fetch(endpoint)).json();
    target = targets.find(item => item.type === 'page' && /Click Interval/i.test(item.title));
    if (target) break;
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!target) throw new Error('The tooltip-test renderer was not available.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const result = await new Promise((resolve, reject) => {
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result.result.value);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      returnByValue: true,
      expression: `(() => {
        const button = document.getElementById('settingsWindow');
        button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
        const hint = document.querySelector('.custom-tooltip');
        return {
          nativeTitleRemoved: !button.hasAttribute('title'),
          hintExists: Boolean(hint),
          visible: Boolean(hint && !hint.hidden),
          text: hint?.textContent || '',
          styled: hint ? getComputedStyle(hint).position === 'fixed' : false
        };
      })()`
    }
  }));
});
socket.close();
console.log(JSON.stringify(result));
if (!result.nativeTitleRemoved || !result.hintExists || !result.visible || !result.text || !result.styled) process.exitCode = 1;
