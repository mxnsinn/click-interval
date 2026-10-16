const fs = require('fs');
const vm = require('vm');

let ProcessorClass = null;
global.sampleRate = 48000;
global.AudioWorkletProcessor = class {
  constructor() { this.port = { onmessage: null }; }
};
global.registerProcessor = (_name, implementation) => { ProcessorClass = implementation; };
vm.runInThisContext(fs.readFileSync('voice-processor.js', 'utf8'), { filename: 'voice-processor.js' });

const processor = new ProcessorClass();
processor.port.onmessage({ data: { pitch: 0, mix: 1, gateDb: -50 } });
const rendered = [];
const blockSize = 128;
const totalSamples = Math.round(sampleRate * 0.55);
for (let offset = 0; offset < totalSamples; offset += blockSize) {
  const input = new Float32Array(blockSize);
  const output = new Float32Array(blockSize);
  for (let index = 0; index < blockSize; index += 1) {
    const position = offset + index;
    const time = position / sampleRate;
    const amplitude = time < 0.28 ? 0.02 : time < 0.31 ? 0 : 0.0025;
    input[index] = Math.sin(2 * Math.PI * 180 * time) * amplitude;
  }
  processor.process([[input]], [[output]]);
  rendered.push(...output);
}

function rms(fromSeconds, toSeconds) {
  const from = Math.floor(fromSeconds * sampleRate);
  const to = Math.floor(toSeconds * sampleRate);
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += rendered[index] ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}

const normalSpeech = rms(0.18, 0.26);
const quietContinuation = rms(0.32, 0.39);
const expectedQuiet = 0.0025 / Math.sqrt(2);
const quietRetention = quietContinuation / expectedQuiet;
const deepProcessor = new ProcessorClass();
deepProcessor.port.onmessage({ data: { pitch: -5, mix: 1, gateDb: -65 } });
const deepRendered = [];
for (let offset = 0; offset < sampleRate; offset += blockSize) {
  const input = new Float32Array(blockSize);
  const output = new Float32Array(blockSize);
  for (let index = 0; index < blockSize; index += 1) {
    const time = (offset + index) / sampleRate;
    input[index] = 0.012 * Math.sin(2 * Math.PI * 173 * time) + 0.006 * Math.sin(2 * Math.PI * 281 * time);
  }
  deepProcessor.process([[input]], [[output]]);
  deepRendered.push(...output);
}
const deepWindows = [];
const deepWindowSize = Math.round(sampleRate * 0.01);
for (let from = Math.round(sampleRate * 0.2); from + deepWindowSize <= deepRendered.length; from += deepWindowSize) {
  let sum = 0;
  for (let index = from; index < from + deepWindowSize; index += 1) sum += deepRendered[index] ** 2;
  deepWindows.push(Math.sqrt(sum / deepWindowSize));
}
const deepMinimum = Math.min(...deepWindows);
const deepMaximum = Math.max(...deepWindows);
const deepDropRatio = deepMinimum / deepMaximum;
const echoProcessor = new ProcessorClass();
echoProcessor.port.onmessage({ data: { pitch: 0, mix: 1, gateDb: -70, pcAudioCancellation: true } });
const echoSamples = sampleRate * 3;
const echoDelay = 1376;
const referenceSignal = new Float32Array(echoSamples);
const voiceSignal = new Float32Array(echoSamples);
let randomState = 123456789;
for (let index = 0; index < echoSamples; index += 1) {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  const noise = (randomState / 0xffffffff) * 2 - 1;
  const time = index / sampleRate;
  referenceSignal[index] = 0.045 * Math.sin(2 * Math.PI * 311 * time) + 0.03 * Math.sin(2 * Math.PI * 487 * time) + noise * 0.012;
  voiceSignal[index] = 0.028 * Math.sin(2 * Math.PI * 173 * time) + 0.012 * Math.sin(2 * Math.PI * 239 * time);
}
const echoRendered = [];
const microphoneRendered = [];
for (let offset = 0; offset < echoSamples; offset += blockSize) {
  const microphone = new Float32Array(blockSize);
  const reference = new Float32Array(blockSize);
  const output = new Float32Array(blockSize);
  for (let index = 0; index < blockSize; index += 1) {
    const position = offset + index;
    reference[index] = referenceSignal[position] || 0;
    const directEcho = position >= echoDelay ? referenceSignal[position - echoDelay] * 0.68 : 0;
    const reflectedEcho = position >= echoDelay + 71 ? referenceSignal[position - echoDelay - 71] * 0.18 : 0;
    microphone[index] = (voiceSignal[position] || 0) + directEcho + reflectedEcho;
    microphoneRendered.push(microphone[index]);
  }
  echoProcessor.process([[microphone], [reference]], [[output]]);
  echoRendered.push(...output);
}
let rawError = 0;
let cleanedError = 0;
let voicePower = 0;
const evaluationStart = sampleRate * 2;
for (let index = evaluationStart; index < echoSamples; index += 1) {
  const voice = voiceSignal[index];
  rawError += (microphoneRendered[index] - voice) ** 2;
  cleanedError += (echoRendered[index] - voice) ** 2;
  voicePower += voice ** 2;
}
const echoReductionDb = 10 * Math.log10(rawError / Math.max(cleanedError, 1e-12));
const cleanedVoiceErrorRatio = cleanedError / Math.max(voicePower, 1e-12);
const isolationProcessor = new ProcessorClass();
isolationProcessor.port.onmessage({ data: { pitch: 0, mix: 1, gateDb: -70, voiceIsolation: true } });
const isolationRendered = [];
const isolationInput = [];
randomState = 987654321;
for (let offset = 0; offset < sampleRate * 2; offset += blockSize) {
  const input = new Float32Array(blockSize);
  const output = new Float32Array(blockSize);
  for (let index = 0; index < blockSize; index += 1) {
    const position = offset + index;
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    const noise = ((randomState / 0xffffffff) * 2 - 1) * 0.005;
    const voice = position >= sampleRate ? Math.sin(2 * Math.PI * 190 * position / sampleRate) * 0.025 : 0;
    input[index] = noise + voice;
    isolationInput.push(input[index]);
  }
  isolationProcessor.process([[input]], [[output]]);
  isolationRendered.push(...output);
}
function segmentRms(values, from, to) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += values[index] ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}
const isolationNoiseInput = segmentRms(isolationInput, Math.round(sampleRate * 0.7), Math.round(sampleRate * 0.95));
const isolationNoiseOutput = segmentRms(isolationRendered, Math.round(sampleRate * 0.7), Math.round(sampleRate * 0.95));
const isolationNoiseReductionDb = 20 * Math.log10(isolationNoiseInput / Math.max(isolationNoiseOutput, 1e-12));
const isolationVoiceOutput = segmentRms(isolationRendered, Math.round(sampleRate * 1.3), Math.round(sampleRate * 1.8));
const expectedVoiceRms = 0.025 / Math.sqrt(2);
const isolationVoiceRetention = isolationVoiceOutput / expectedVoiceRms;
const passed = normalSpeech > 0.01 && quietRetention > 0.8 && deepDropRatio > 0.7 && echoReductionDb > 8 &&
  cleanedVoiceErrorRatio < 0.25 && isolationNoiseReductionDb > 8 && isolationVoiceRetention > 0.6;
console.log(JSON.stringify({ passed, normalSpeech, quietContinuation, quietRetention, deepMinimum, deepMaximum, deepDropRatio, echoReductionDb, cleanedVoiceErrorRatio, learnedEchoDelay: echoProcessor.echoDelay, echoGain: echoProcessor.echoFilter[0], isolationNoiseReductionDb, isolationVoiceRetention }));
process.exitCode = passed ? 0 : 1;
