const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const html = read('index.html');
const renderer = read('renderer.js');
const styles = read('styles.css');
const main = read('main.js');
const settings = read('settings.html');
const worklet = read('voice-processor.js');

const checks = [
  /id="showVoice"/.test(html),
  /id="voiceView"/.test(html),
  /id="voiceInputDevice"/.test(html),
  /id="voiceOutputDevice"/.test(html),
  /id="voiceMonitor"/.test(html),
  /id="voicePitch"/.test(html),
  /id="voiceBass"/.test(html),
  /id="voiceTreble"/.test(html),
  /id="voiceGate"/.test(html),
  /id="voiceCompression"/.test(html),
  /id="voiceReverb"/.test(html),
  /AudioWorkletNode\(context, 'click-interval-voice'(?:,|\))/.test(renderer),
  /getUserMedia/.test(renderer),
  /setSinkId/.test(renderer),
  /voiceMediaStream\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/.test(renderer),
  /registerProcessor\('click-interval-voice'/.test(worklet),
  /\.voice-knob-face/.test(styles),
  /'voice'/.test(main),
  /backgroundVoice/.test(settings),
  /permission === 'media'/.test(main)
];

if (checks.some(check => !check)) {
  console.error(JSON.stringify({ passed: false, failed: checks.map((check, index) => check ? null : index + 1).filter(Boolean) }));
  process.exit(1);
}
console.log(JSON.stringify({ passed: true, checks: checks.length }));
