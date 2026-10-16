const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { StringDecoder } = require('string_decoder');

const appRoot = path.resolve(__dirname, '..', 'app');
const main = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
const backend = fs.readFileSync(path.join(appRoot, 'backend.py'), 'utf8');

const safetyStart = main.indexOf('// BACKEND_PIPE_SAFETY_START');
const safetyEnd = main.indexOf('// BACKEND_PIPE_SAFETY_END');
assert(safetyStart >= 0 && safetyEnd > safetyStart, 'Backend pipe safety block is missing.');

const context = { Buffer, StringDecoder, Set };
vm.createContext(context);
vm.runInContext(`${main.slice(safetyStart, safetyEnd)}\nglobalThis.pipeSafety = { createBoundedLineAccumulator };`, context);

const lines = [];
const overflows = [];
const accumulator = context.pipeSafety.createBoundedLineAccumulator({
  onLine: (line, bytes) => lines.push({ line, bytes }),
  onOverflow: value => overflows.push(value),
  maxChunkBytes: 64,
  maxLineBytes: 48
});

const normal = Buffer.from('{"type":"ready","label":"safe ✓"}\r\n', 'utf8');
const unicodeOffset = normal.indexOf(Buffer.from('✓', 'utf8'));
accumulator.push(normal.subarray(0, unicodeOffset + 1));
accumulator.push(normal.subarray(unicodeOffset + 1));
assert.equal(lines.length, 1);
assert.equal(JSON.parse(lines[0].line).label, 'safe ✓');

for (let index = 0; index < 20; index += 1) accumulator.push(Buffer.from('abcdefghij'));
assert(accumulator.bufferedBytes() <= 48, 'Newline-free output exceeded the configured bound.');
assert(accumulator.isDiscarding(), 'Oversized output was not discarded.');
accumulator.push(Buffer.from('\n{"type":"recovered"}\n'));
assert(lines.some(item => item.line === '{"type":"recovered"}'), 'Decoder did not recover after an oversized line.');

const oversizedChunk = Buffer.from('{"type":"first"}\n' + 'x'.repeat(96) + '\n{"type":"tail"}');
accumulator.push(oversizedChunk);
accumulator.push(Buffer.from('\n'));
assert(overflows.some(item => item.kind === 'chunk'), 'Oversized chunk was not reported.');
assert(lines.some(item => item.line === '{"type":"tail"}'), 'Safe tail after oversized output was lost.');

for (const required of [
  'BACKEND_STDOUT_QUEUE_MAX_LINES = 512',
  'BACKEND_STDOUT_QUEUE_MAX_BYTES = 4 * 1024 * 1024',
  'backendProcess.stdout.pause()',
  'backendProcess.stdout.resume()',
  'BACKEND_RENDERER_EVENTS_PER_SECOND = 120',
  'BACKEND_STDERR_MAX_PENDING_BYTES = 32 * 1024',
  'function writeBackend(command)',
  "backendProcess.stdin.on('error'",
  'if (backend === backendProcess) backend = null',
  "process.on('uncaughtException'",
  "process.on('unhandledRejection'"
]) assert(main.includes(required), `Missing backend safety behavior: ${required}`);

assert(!main.includes('backend.stdin.write('), 'Feature code bypasses the safe backend writer.');
assert(!main.includes('stdoutBuffer += chunk.toString()'), 'Unbounded stdout concatenation returned.');
assert(backend.includes('MAX_EMIT_QUEUE_EVENTS = 512'));
assert(backend.includes('MAX_EMIT_QUEUE_BYTES = 4 * 1024 * 1024'));
assert(backend.includes('MAX_RECORDED_ITEMS = 32768'));
assert(backend.includes('MAX_RECORDED_SERIALIZED_BYTES = 1024 * 1024'));

console.log(JSON.stringify({
  passed: true,
  decodedLines: lines.length,
  overflowReports: overflows.length
}, null, 2));
