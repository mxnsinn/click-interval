const fs = require('fs');

const main = fs.readFileSync('main.js', 'utf8');
const builder = fs.readFileSync('build-development-update.ps1', 'utf8');
const config = JSON.parse(fs.readFileSync('beta-access.json', 'utf8'));
const checks = {
  httpsEndpoint: /^https:\/\//.test(config.endpoint),
  embeddedEndpointFallback: main.includes("endpoint: 'https://click-interval.netlify.app/api/beta/access'"),
  embeddedPublicKeyFallback: main.includes(`publicKey: '${config.publicKey}'`),
  externalConfigOptional: main.includes('catch (_) { return defaults; }'),
  configIncludedInUpdates: builder.includes("'update-config.json', 'beta-access.json'"),
  signedResponseRequired: main.includes('crypto.verify(null'),
  expiredLeaseRejected: main.includes("Date.parse(access.expiresAt) <= Date.now()"),
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Beta access checks failed: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
