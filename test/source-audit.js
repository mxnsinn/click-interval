'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', '.gradle', 'node_modules', 'artifacts', 'build', 'release', 'runtime', 'owner-private', 'work', 'logs']);
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolute);
    assert(!stat.isSymbolicLink(), `Linked path is not allowed: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile()) files.push(absolute);
  }
}
walk(root);

const forbiddenNames = /(?:owner-private|friend-update-private-key|channel\.json|\.pfx$|\.p12$|\.pem$|\.key$|\.env$)/i;
for (const file of files) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  assert(!forbiddenNames.test(relative), `Private release material is present: ${relative}`);
  if (fs.statSync(file).size > 5 * 1024 * 1024 || !/\.(?:c?js|mjs|json|html|css|py|ps1|md|txt|yml|yaml|xml|gradle|properties|cmd|svg)$/i.test(file)) continue;
  const bytes = fs.readFileSync(file);
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{20,}/.test(bytes.toString('utf8')), `Private key material is present: ${relative}`);
  assert(!bytes.includes(Buffer.from(`NETLIFY_${'AUTH'}_TOKEN`)), `Deployment credential name is present: ${relative}`);
}

const packageDocument = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageDocument.license, 'MIT');
const isolatedApp = path.join(root, 'editions', 'auto-macro', 'app');
assert.equal(packageDocument.version, JSON.parse(fs.readFileSync(path.join(isolatedApp, 'package.json'), 'utf8')).version);
assert(fs.existsSync(path.join(root, 'LICENSE')));
assert(fs.existsSync(path.join(root, 'PRIVACY.md')));
assert(fs.existsSync(path.join(root, 'SIGNING.md')));
assert(!fs.existsSync(path.join(isolatedApp, 'runtime')));
assert(!fs.existsSync(path.join(isolatedApp, '.friend-integrity.json')));

console.log(JSON.stringify({ passed: true, filesAudited: files.length }));
