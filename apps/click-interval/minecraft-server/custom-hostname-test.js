const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Extract only pure config-validation functions; never initialize Electron or
// touch a server, live config, hosts file, or the network during these tests.
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
function extract(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing source boundaries: ${start}`);
  return source.slice(first, last);
}
const functionSource = [
  extract('function normalizeHostname(', 'async function checkHostnameAvailability('),
  extract('function getHostFromAddress(', 'function parseServerAddress('),
  extract('async function validateCustomHostnameForConfig(', 'function validateVoicePublicAddressForConfig(')
].join('\n');
const unknownMessage = 'Unknown host. Register this domain or point its DNS to your server first.';
const noData = () => Promise.reject(Object.assign(new Error('No records'), { code: 'ENODATA' }));

function validator({ a = ['198.51.100.7'], aaaa = [], reject4 = false, reject6 = false } = {}) {
  const calls = [];
  const context = vm.createContext({
    dns: {
      lookup() { throw new Error('OS/hosts lookup must never be used for public DNS validation'); },
      resolve4(host) { calls.push(['A', host]); return reject4 ? noData() : Promise.resolve(a); },
      resolve6(host) { calls.push(['AAAA', host]); return reject6 ? noData() : Promise.resolve(aaaa); }
    }
  });
  const validate = vm.runInContext(`${functionSource}\nvalidateCustomHostnameForConfig;`, context);
  return { validate, calls };
}
function config(overrides = {}) {
  return { customHostname: 'mxnsinn-smp.net', publicAddress: '198.51.100.7:25565', localOnly: false, ...overrides };
}

test('valid public A record succeeds without consulting the hosts-file mapping', async () => {
  const { validate, calls } = validator();
  await validate(config());
  assert.deepEqual(calls, [['A', 'mxnsinn-smp.net'], ['AAAA', 'mxnsinn-smp.net']]);
});

test('missing AAAA does not reject an otherwise matching public A record', async () => {
  await validator({ reject6: true }).validate(config());
});

test('missing A does not reject an otherwise matching public AAAA record', async () => {
  await validator({ reject4: true, aaaa: ['2001:db8::7'] }).validate(config({ publicAddress: '[2001:db8::7]:25565' }));
});

test('either published address family may contain the exact configured address', async () => {
  await validator({ a: ['198.51.100.8', '198.51.100.7'], aaaa: ['2001:db8::8'] }).validate(config());
});

test('a mismatching public address still rejects with the existing message', async () => {
  await assert.rejects(validator({ a: ['198.51.100.8'], aaaa: ['2001:db8::8'] }).validate(config()), {
    message: 'This custom address points to 198.51.100.8, 2001:db8::8, not your server IP 198.51.100.7.'
  });
});

test('an address merely containing the configured IP is not an exact match', async () => {
  await assert.rejects(validator({ a: ['198.51.100.70'] }).validate(config()), /not your server IP/);
});

test('both DNS families failing returns the existing unknown-host error', async () => {
  await assert.rejects(validator({ reject4: true, reject6: true }).validate(config()), { message: unknownMessage });
});

test('no address records returns the unknown-host error', async () => {
  await assert.rejects(validator({ a: [], aaaa: [] }).validate(config()), { message: unknownMessage });
});

test('local-only mode skips all DNS checks', async () => {
  const { validate, calls } = validator({ reject4: true, reject6: true });
  await validate(config({ localOnly: true }));
  assert.equal(calls.length, 0);
});

test('an empty custom hostname skips all DNS checks', async () => {
  const { validate, calls } = validator();
  await validate(config({ customHostname: '' }));
  assert.equal(calls.length, 0);
});

test('missing configured public address still fails before DNS is queried', async () => {
  const { validate, calls } = validator();
  await assert.rejects(validate(config({ publicAddress: '' })), {
    message: 'Map direct hosting first, then set a custom public join address.'
  });
  assert.equal(calls.length, 0);
});

test('hostname normalization is unchanged', async () => {
  const { validate, calls } = validator();
  await validate(config({ customHostname: ' HTTPS://MXNSINN-SMP.NET:25565/path ' }));
  assert.deepEqual(calls, [['A', 'mxnsinn-smp.net'], ['AAAA', 'mxnsinn-smp.net']]);
});
