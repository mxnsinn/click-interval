'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const main = fs.readFileSync('main.js', 'utf8');
const server = fs.readFileSync('minecraft-server/main.js', 'utf8');
const persistentClient = fs.readFileSync('minecraft-server/persistent-process-client.js', 'utf8');
const persistentHost = fs.readFileSync('minecraft-server/persistent-process-host.js', 'utf8');
const settingsHtml = fs.readFileSync('settings.html', 'utf8');
const settingsWindow = fs.readFileSync('settings-window.js', 'utf8');

assert.match(main, /keepMinecraftServerRunningDuringUpdate:\s*true/, 'the safe default must preserve a running server');
assert.match(main, /keepMinecraftServerRunningDuringUpdate:\s*value\?\.keepMinecraftServerRunningDuringUpdate\s*!==\s*false/, 'existing users must inherit the preserve default');
assert.match(main, /preserveMinecraftServer:\s*appSettings\.keepMinecraftServerRunningDuringUpdate/, 'the updater handoff must receive the saved preference');
assert.match(main, /minecraftServer\.prepareForAppUpdate\(\{\s*preserveServer:\s*options\.preserveMinecraftServer\s*!==\s*false\s*\}\)/, 'update quit must arm server preservation before Electron exits');
assert.match(settingsHtml, /id="keepMinecraftServerRunningDuringUpdate"/, 'settings UI must expose the server update behavior');
assert.match(settingsWindow, /'keepMinecraftServerRunningDuringUpdate'/, 'settings UI must persist the update behavior');

assert.match(server, /launchPersistentProcess\(\{\s*role:\s*'minecraft-server'/, 'Minecraft must run behind the detached lifecycle host');
assert.match(server, /attachPersistentProcess\(statePath,\s*\{\s*role,\s*optional:\s*true\s*\}\)/, 'the replacement app must attach through the authenticated lifecycle record');
assert.match(server, /preserveForUpdate\s*\?\s*processHandoff\s*:\s*destroyNatClientBestEffort\(\)/, 'update preservation must await handoff without tearing down public routing');
assert.match(server, /ownedProcesses\.every\(processRef => typeof processRef\.disconnectForHandoff === 'function'\)/,
  'legacy or unmanaged processes must fail closed to normal shutdown instead of losing console ownership');
assert.match(server, /preserveForUpdate[\s\S]{0,160}Promise\.resolve\(\)[\s\S]{0,160}shutdownOwnedChildrenForQuit/, 'preserve and close modes must take separate child cleanup paths');
assert.match(server, /prepareForAppUpdate,/, 'the main process must be able to arm the handoff explicitly');
assert.match(server, /reattachPersistentRuntime\(\)/, 'app startup must recover preserved processes');
assert.match(persistentClient, /type:\s*'handoff',\s*afterSequence:\s*this\._handoffCutoff/, 'the old app must hand off its last consumed output sequence');
assert.match(persistentHost, /handoffAfterSequence:\s*afterSequence/, 'the detached host must persist the replay boundary before acknowledging handoff');
assert.match(persistentClient, /consumeHandoff:\s*!replayFromStart\s*&&\s*hasSavedHandoff/, 'the replacement app must claim the saved replay boundary');
assert.match(persistentClient, /tail:\s*!replayFromStart\s*&&\s*!hasSavedHandoff/, 'reattach without a checkpoint must start at the current output boundary');
assert.match(persistentHost, /activeHandoffClaim\s*=\s*\{\s*socket,\s*afterSequence,\s*claimId:\s*handoffClaimId\s*\}/,
  'claiming replay must remain provisional until the replacement owns the stream');
assert.match(persistentHost, /message\?\.type\s*===\s*'handoff-commit'[\s\S]{0,700}handoffAfterSequence:\s*null/,
  'only an explicit second-phase commit may clear the durable replay boundary');
assert.match(persistentClient, /const adapter = new PersistentProcessAdapter[\s\S]{0,160}await adapter\.commitHandoffClaim/,
  'the replacement must bind its adapter and streams before committing the replay claim');

process.stdout.write('Update/server preservation regression test passed.\n');
