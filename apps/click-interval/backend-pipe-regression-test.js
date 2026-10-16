const fs = require('fs');
const vm = require('vm');
const { StringDecoder } = require('string_decoder');

const main = fs.readFileSync('main.js', 'utf8');
const backend = fs.readFileSync('backend.py', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const safetyStart = main.indexOf('// BACKEND_PIPE_SAFETY_START');
const safetyEnd = main.indexOf('// BACKEND_PIPE_SAFETY_END');
assert(safetyStart >= 0 && safetyEnd > safetyStart, 'Backend pipe safety block is missing.');
const safetySource = main.slice(safetyStart, safetyEnd);
const context = { Buffer, StringDecoder, Set };
vm.createContext(context);
vm.runInContext(`${safetySource}\nglobalThis.pipeSafety = { createBoundedLineAccumulator };`, context);

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
assert(lines.length === 1 && JSON.parse(lines[0].line).label === 'safe ✓', 'Fragmented UTF-8 JSON was not preserved.');

for (let index = 0; index < 20; index += 1) accumulator.push(Buffer.from('abcdefghij'));
assert(accumulator.bufferedBytes() <= 48, 'A newline-free stream exceeded its line cap.');
assert(accumulator.isDiscarding(), 'An oversized line was not placed in discard mode.');
accumulator.push(Buffer.from('\n{"type":"recovered"}\n'));
assert(lines.some(item => item.line === '{"type":"recovered"}'), 'The decoder did not recover after an oversized line.');

const oversizedChunk = Buffer.from('{"type":"first"}\n' + 'x'.repeat(96) + '\n{"type":"tail"}');
accumulator.push(oversizedChunk);
accumulator.push(Buffer.from('\n'));
assert(overflows.some(item => item.kind === 'chunk'), 'An oversized chunk was not reported.');
assert(lines.some(item => item.line === '{"type":"tail"}'), 'The bounded decoder did not recover the safe chunk tail.');

const versionStart = main.indexOf('function safeUpdateVersionToken');
const versionEnd = main.indexOf('\nfunction isNewerVersion', versionStart);
assert(versionStart >= 0 && versionEnd > versionStart, 'Safe update version parser is missing.');
vm.runInContext(`${main.slice(versionStart, versionEnd)}\nglobalThis.safeVersion = safeUpdateVersionToken;`, context);
assert(context.safeVersion('1.5.95') === '1.5.95', 'A normal update version was rejected.');
for (const unsafe of ['../../evil', '1.5.95/evil', '1.5', 'v1.5.95', '1.5.95..beta']) {
  assert(context.safeVersion(unsafe) === '', `Unsafe update version was accepted: ${unsafe}`);
}

const checks = {
  safeWriter: main.includes('function writeBackend(command)'),
  streamErrorHandled: main.includes("backendProcess.stdin.on('error'"),
  staleExitProtected: main.includes('if (backend === backendProcess) backend = null'),
  customUncaughtError: main.includes("process.on('uncaughtException'") && main.includes("title: 'Click Interval error'"),
  customRejectedPromise: main.includes("process.on('unhandledRejection'"),
  featureWritesAreSafe: !main.includes('backend.stdin.write('),
  backendExitsWithParentPipe: backend.includes('os._exit(0)'),
  boundedStdoutQueue: main.includes('BACKEND_STDOUT_QUEUE_MAX_LINES = 512') && main.includes('BACKEND_STDOUT_QUEUE_MAX_BYTES = 4 * 1024 * 1024'),
  stdoutBackpressure: main.includes('backendProcess.stdout.pause()') && main.includes('backendProcess.stdout.resume()'),
  boundedParseRate: main.includes('BACKEND_STDOUT_PARSE_LINES_PER_TICK = 24') && main.includes('BACKEND_STDOUT_PARSE_INTERVAL_MS = 50'),
  boundedRendererRate: main.includes('BACKEND_RENDERER_EVENTS_PER_SECOND = 120') && main.includes('BACKEND_RENDERER_BACKGROUND_EVENTS_PER_SECOND = 80') && main.includes('BACKEND_COALESCED_EVENT_TYPES'),
  boundedStderr: main.includes('BACKEND_STDERR_MAX_PENDING_BYTES = 32 * 1024') && main.includes('BACKEND_DIAGNOSTIC_MAX_BYTES = 8 * 1024'),
  noUnboundedStdoutConcat: !main.includes("stdoutBuffer += chunk.toString()"),
  preferencesCached: main.includes('if (cachedAppSettings) return cachedAppSettings') && main.includes("hasOwnProperty.call(value, 'appSettings')") && main.includes('cachedAppSettings = null;'),
  inputDisplayCoalesced: main.includes('function queueInputDisplayUpdate') && main.includes('INPUT_DISPLAY_FRAME_MS = 33') && main.includes('INPUT_DISPLAY_PENDING_LIMIT = 24'),
  cpsDisplayCoalesced: main.includes('function queueCpsIndicatorUpdate') && main.includes('CPS_INDICATOR_FRAME_MS = 50'),
  clickHistoryBounded: main.includes('BACKEND_CLICK_HISTORY_LIMIT = 512') && main.includes('pushBoundedClickHistory'),
  asyncBackendWriter: backend.includes('def emit_writer():') && backend.includes('emit_condition = threading.Condition()'),
  hookThreadNeverPrints: !backend.includes('print(json.dumps(payload), flush=True)'),
  boundedPythonOutput: backend.includes('MAX_EMIT_QUEUE_EVENTS = 512') && backend.includes('MAX_EMIT_QUEUE_BYTES = 4 * 1024 * 1024'),
  lifecycleEventsPrioritized: main.includes('BACKEND_PRIORITY_EVENT_TYPES') && backend.includes('emit_queue.insert(first_telemetry, queued_event)'),
  boundedMacroRecording: backend.includes('MAX_RECORDED_ITEMS = 32768') && backend.includes('MAX_RECORDED_SERIALIZED_BYTES = 1024 * 1024'),
  macroLimitIsVisible: backend.includes('Recording stopped at the safety limit') && backend.includes('"type": "macro_error"'),
  safeUpdaterFilename: main.includes('`Click-Interval-${updateVersion}-Setup.exe`') && !main.includes('`Click-Interval-${availableUpdate.version}-Setup.exe`')
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Backend pipe regressions: ${failed.join(', ')}`);
console.log(JSON.stringify({
  passed: true,
  checks: Object.keys(checks).length,
  behavioral: { decodedLines: lines.length, overflows: overflows.length }
}));
