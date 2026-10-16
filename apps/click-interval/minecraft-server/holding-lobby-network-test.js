'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHoldingLobbyNetwork } = require('./holding-lobby-network');

function fixture(overrides={}) {
  const calls=[];
  const nat={ map(options, cb) { calls.push(['map', options]); cb(); }, _upnpClient:{ destroy(){calls.push(['close']);} } };
  const network=createHoldingLobbyNetwork({ createNat(){calls.push(['create']);return nat;}, ensureFirewall:async options=>{calls.push(['firewall',options]);return{ok:true};}, ...overrides });
  return { network, calls, nat };
}
test('lobby owns only a separate UDP port and firewall rule; no external reachability claim', async()=>{
  const f=fixture();const result=await f.network.prepare({profileId:'SMP',port:24455});
  assert.equal(result.mapping.mapped,true);assert.equal(result.firewall.ok,true);assert.equal(result.externalVerified,false);
  assert.deepEqual(f.calls.find(c=>c[0]==='map')[1],{publicPort:24455,privatePort:24455,protocol:'UDP',ttl:3600,description:'Click Interval Holding Lobby Voice'});
  assert.equal(f.calls.find(c=>c[0]==='firewall')[1].profileId,'SMP:holding-lobby');
  f.network.suspend();assert.equal(f.calls.filter(c=>c[0]==='close').length,1);
});
test('local-only makes no router/firewall calls',async()=>{const f=fixture();const r=await f.network.prepare({profileId:'SMP',port:24455,localOnly:true});assert.equal(r.mapping.attempted,false);assert.deepEqual(f.calls,[]);});
test('rejects main voice port and malformed input before making any calls',async()=>{
  const f=fixture();for(const options of[{profileId:'SMP',port:24454},{profileId:'../SMP',port:24455},{profileId:'SMP',port:0},{profileId:'SMP',port:NaN}])await assert.rejects(f.network.prepare(options));assert.deepEqual(f.calls,[]);
});
test('cannot reuse another profile holding port',async()=>{const f=fixture();await f.network.prepare({profileId:'SMP',port:24455});await assert.rejects(f.network.prepare({profileId:'Other',port:24455}),/another profile/);f.network.suspend();});
test('reissues own mapping on app attach, never unmapps another service',async()=>{const f=fixture();await f.network.prepare({profileId:'SMP',port:24455});await f.network.prepare({profileId:'SMP',port:24455});assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.calls.filter(c=>c[0]==='map').length,2);f.network.suspend();});
test('router error and firewall elevation are reported without falsely declaring voice ready',async()=>{
  const f=fixture({createNat:()=>({map(o,cb){cb(new Error('No gateway'));}}),ensureFirewall:async()=>({ok:false,requiresElevation:true})});const r=await f.network.prepare({profileId:'SMP',port:24455});assert.equal(r.mapping.mapped,false);assert.equal(r.firewall.requiresElevation,true);assert.equal(r.externalVerified,false);f.network.suspend();
});
test('router timeout is bounded',async()=>{const f=fixture({createNat:()=>({map(){}}),timeoutMs:5});const r=await f.network.prepare({profileId:'SMP',port:24455});assert.match(r.mapping.message,/timed out/);f.network.suspend();});
test('an existing verified Java rule can cover UDP without elevation or rule changes',async()=>{
  const f=fixture({ensureFirewall:async()=>({ok:false,requiresElevation:true}),inspectJavaFirewall:async p=>{assert.equal(p,'C:/Java/java.exe');return{ok:true,action:'existing-java-rule',changed:false};}});
  const r=await f.network.prepare({profileId:'SMP',port:24455,javaPath:'C:/Java/java.exe'});assert.equal(r.firewallReady,true);assert.equal(r.firewall.changed,false);assert.equal(r.firewall.requiresElevation,false);assert.equal(r.externalVerified,false);f.network.suspend();
});
