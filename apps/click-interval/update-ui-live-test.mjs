const endpoint = process.env.UPDATE_TEST_ENDPOINT || 'http://127.0.0.1:9334/json';
const expectedVersion = process.env.UPDATE_TEST_VERSION || '1.5.69';
let target;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const targets = await (await fetch(endpoint)).json();
    target = targets.find(item => item.type === 'page' && /Click Interval/i.test(item.title));
    if (target) break;
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!target) throw new Error('The update-test renderer was not available.');
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
      expression: `({
        hidden: document.getElementById('updateWindow').hidden,
        disabled: document.getElementById('updateWindow').disabled,
        status: typeof latestUpdateStatus === 'object' ? latestUpdateStatus : null,
        appVersion: typeof initialWindowContext === 'object' ? initialWindowContext.appVersion : null
      })`
    }
  }));
});
socket.close();
console.log(JSON.stringify(result));
if (result.hidden || result.disabled || result.status?.status !== 'available' || result.status?.version !== expectedVersion) process.exitCode = 1;
