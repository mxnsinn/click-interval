const targetPort = Number(process.argv[2] || 9333);

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${targetPort}/json`)).json();
  const target = targets.find(item => item.type === 'page' && /index\.html/i.test(item.url));
  if (!target) throw new Error('Click Interval page was not found.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') events.push(message);
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
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Evaluation failed.';
      throw new Error(description);
    }
    return response.result?.value;
  };

  await call('Runtime.enable');
  await evaluate(`(async () => {
    document.getElementById('showVoice').click();
    await new Promise(resolve => setTimeout(resolve, 700));
    window.__voiceDiagnosticMessage = null;
    const originalMessage = showMessage;
    showMessage = async (...args) => { window.__voiceDiagnosticMessage = args.map(String); };
    window.__restoreVoiceMessage = () => { showMessage = originalMessage; };
  })()`);
  const before = await evaluate(`(async () => ({
    button: document.getElementById('voicePower').innerText,
    status: document.getElementById('voiceMeterText').innerText,
    inputOptions: [...document.getElementById('voiceInputDevice').options].map(option => ({ label: option.textContent, value: option.value })),
    outputOptions: [...document.getElementById('voiceOutputDevice').options].map(option => ({ label: option.textContent, value: option.value })),
    bridgeType: typeof window.bridge?.loadVoiceProcessorSource,
    workletSourceLength: String(window.bridge?.loadVoiceProcessorSource?.() || '').length,
    mediaDevices: (await navigator.mediaDevices.enumerateDevices()).map(device => ({ kind: device.kind, label: device.label, id: device.deviceId }))
  }))()`);
  await evaluate(`document.getElementById('voicePower').click()`);
  await new Promise(resolve => setTimeout(resolve, 3500));
  const after = await evaluate(`({
    button: document.getElementById('voicePower').innerText,
    status: document.getElementById('voiceMeterText').innerText,
    diagnosticMessage: window.__voiceDiagnosticMessage,
    contextState: typeof voiceAudioContext === 'undefined' ? 'missing-binding' : voiceAudioContext?.state || 'none',
    streamTracks: typeof voiceStream === 'undefined' || !voiceStream ? [] : voiceStream.getTracks().map(track => ({ label: track.label, enabled: track.enabled, muted: track.muted, readyState: track.readyState })),
    nodeNames: typeof voiceNodes === 'undefined' || !voiceNodes ? [] : Object.keys(voiceNodes),
    powerDisabled: document.getElementById('voicePower').disabled,
    firstKnobDisabled: document.getElementById('voicePitch').disabled,
    firstKnobPointerEvents: getComputedStyle(document.querySelector('.voice-knob-face')).pointerEvents
  })`);
  await evaluate(`window.__restoreVoiceMessage?.()`);
  socket.close();
  process.stdout.write(JSON.stringify({ before, after, events }, null, 2));
}

main().catch(error => {
  process.stderr.write(error.stack || error.message);
  process.exitCode = 1;
});
