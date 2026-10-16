const port = Number(process.argv[2] || 9334);

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(item => item.type === 'page' && /index\.html/i.test(item.url));
  if (!target) throw new Error('Click Interval page was not found.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  const exceptions = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  };
  await call('Runtime.enable');
  const result = await evaluate(`(async () => {
    document.getElementById('showVoice').click();
    await new Promise(resolve => setTimeout(resolve, 400));
    if (!voiceAudioContext) document.getElementById('voicePower').click();
    const deadline = Date.now() + 6000;
    while (!voiceAudioContext && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    await new Promise(resolve => setTimeout(resolve, 800));
    const microphoneTrack = voiceMediaStream?.getAudioTracks?.()[0];
    const systemTrack = voiceSystemStream?.getAudioTracks?.()[0];
    return {
      active: Boolean(voiceAudioContext && voiceNodes),
      status: document.getElementById('voiceMeterText').textContent,
      isolationChecked: document.getElementById('voiceIsolation').checked,
      pcAudioChecked: document.getElementById('voicePcAudioCancellation').checked,
      microphoneConstraints: microphoneTrack?.getConstraints?.() || null,
      microphoneSettings: microphoneTrack?.getSettings?.() || null,
      microphoneCapabilities: microphoneTrack?.getCapabilities?.() || null,
      systemTrack: systemTrack ? { label: systemTrack.label, muted: systemTrack.muted, readyState: systemTrack.readyState, settings: systemTrack.getSettings?.() || null } : null,
      systemReferenceActive: Boolean(voiceNodes?.systemReferenceActive),
      processorInputs: voiceNodes?.processor?.numberOfInputs || 0
    };
  })()`);
  socket.close();
  console.log(JSON.stringify({ result, exceptions }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
