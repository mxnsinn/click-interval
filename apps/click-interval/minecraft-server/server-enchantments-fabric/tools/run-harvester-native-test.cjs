'use strict';
// Reuse the audited disposable-world launcher without modifying its shared configuration.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const launcher = path.resolve(__dirname, '../../../work/smp-mod-smoke.js');
const source = fs.readFileSync(launcher, 'utf8');
const previous = 'server-enchantments-fabric/dist/ServerEnchantments-Fabric-1.3.0+mc26.2.jar';
if (!source.includes(previous)) throw new Error('Shared native launcher changed; review before reuse.');
const isolated = new Module(launcher, module);
isolated.filename = launcher;
isolated.paths = Module._nodeModulePaths(path.dirname(launcher));
const configured = source.replace(previous, 'server-enchantments-fabric/dist/ServerEnchantments-Fabric-1.4.0+mc26.2.jar');
const markerPoint = "const java='C:";
if (!configured.includes(markerPoint)) throw new Error('Shared marker insertion point changed; review before reuse.');
isolated._compile(configured.replace(markerPoint,
  "fs.mkdirSync(path.join(test,'smoke-world'),{recursive:true});\n" +
  "fs.writeFileSync(path.join(test,'smoke-world/server-market-test-fixture'),'Disposable enchantment tests only.\\n',{flag:'wx'});\n" + markerPoint), launcher);
