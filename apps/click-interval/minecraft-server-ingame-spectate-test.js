'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
const fabric = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'ServerProtectionFabric.java');
const fabricController = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'FabricSpectateController.java');
const fabricAccess = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'FabricAccessPolicy.java');
const commandTreePruner = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'CommandTreePruner.java');
const commandsMixin = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'mixin', 'CommandsMixin.java');
const suggestionAccessor = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'mixin', 'CommandSuggestionPacketAccessor.java');
const packetMixin = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'mixin', 'ServerGamePacketListenerMixin.java');
const playerMixin = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'mixin', 'ServerPlayerMixin.java');
const originRestorer = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'PlayerViewOriginRestorer.java');
const negotiation = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'PlayerViewNegotiation.java');
const startGuard = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'PlayerViewStartGuard.java');
const playerViewPayload = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'playerview', 'PlayerViewPayload.java');
const playerViewReadyPayload = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'java',
  'dev', 'serverprotection', 'fabric', 'playerview', 'PlayerViewReadyPayload.java');
const fabricMixins = read('minecraft-server', 'server-protection-fabric', 'src', 'main', 'resources',
  'serverprotection.fabric.mixins.json');
const bukkitController = read('minecraft-server', 'click-interval-anticheat', 'src', 'main', 'java',
  'com', 'clickinterval', 'anticheat', 'PlayerSpectateController.java');
const bukkitAccess = read('minecraft-server', 'click-interval-anticheat', 'src', 'main', 'java',
  'com', 'clickinterval', 'anticheat', 'AccessControlListener.java');
const recovery = read('minecraft-server', 'click-interval-anticheat', 'src', 'main', 'java',
  'com', 'clickinterval', 'anticheat', 'core', 'SpectateRecoveryStore.java');
const pluginYml = read('minecraft-server', 'click-interval-anticheat', 'src', 'main', 'resources', 'plugin.yml');

assert.match(packetMixin, /performUnsignedChatCommand[\s\S]*handleCommand\(player, command\)/);
assert.match(packetMixin, /@Redirect\(method = "performSignedChatCommand"[\s\S]*Commands;performCommand/,
  'signed command policy must run after vanilla has decoded its signed arguments');
assert.match(packetMixin, /performSignedCommand\(player, commands, parsedCommand, command\)/);
assert.doesNotMatch(packetMixin,
  /@Inject\(method = "performSignedChatCommand", at = @At\("HEAD"\), cancellable = true\)/,
  'cancelling a signed command at method entry poisons the secure-chat signature chain');
assert.match(fabric,
  /performSignedCommand[\s\S]*parsedCommand\.getContext\(\)\.getSource\(\)[\s\S]*withPermission\(permissions\)[\s\S]*getDispatcher\(\)\.parse\(clean, managedSource\)[\s\S]*commands\.performCommand\(managed, clean\)/,
  'role elevation must retain vanilla verified signing context while reparsing permission predicates');
const unsignedCommandBody = fabric.slice(fabric.indexOf('public static boolean handleCommand'),
  fabric.indexOf('public static CommandSourceStack commandTreeSource'));
assert.ok(unsignedCommandBody.indexOf('handleActiveViewCommand') < unsignedCommandBody.indexOf('handlePlayerViewCommandInternal'),
  'active POV command lockdown must run before any unsigned managed command route');
const signedCommandBody = fabric.slice(fabric.indexOf('private void performSignedCommandInternal'),
  fabric.indexOf('private boolean handlePlayerViewCommandInternal'));
assert.ok(signedCommandBody.indexOf('handleActiveViewCommand') < signedCommandBody.indexOf('withPermission(permissions)'),
  'active POV command lockdown must run before signed managed permission elevation');
assert.match(fabric, /isPlayerViewControlCommand[\s\S]*ci-spectate[\s\S]*ci-unspectate[\s\S]*unspectate/,
  'only detach and explicit retarget roots may survive the active POV command gate');
assert.match(fabric, /handleActiveViewCommand[\s\S]*if \(!handlePlayerViewCommandInternal\(player, commandLine\)\)[\s\S]*accessDeniedMessage\(\)[\s\S]*return true/,
  'an allowed-looking POV control root must still be consumed if authorization changes concurrently');
assert.match(fabric, /literal\("ci-spectate"\)[\s\S]*literal\("ci-unspectate"\)/);
assert.doesNotMatch(fabric, /dispatcher\.register\(Commands\.literal\("spectate"\)/,
  'the custom POV command must not merge with Minecraft vanilla spectate');
assert.match(fabric, /root\.equals\("ci-spectate"\)[\s\S]*root\.equals\("ci-unspectate"\)[\s\S]*root\.equals\("unspectate"\)/);
assert.match(fabric, /accessPolicy\.canUsePlayerView\(playerName, playerId, commandRoot\)/,
  'command predicates must share the player-view policy gate');
assert.match(fabricAccess, /canUsePlayerView[\s\S]*hasCapability\(playerName, uuid, AccessPolicy\.PLAYER_SPECTATE\)[\s\S]*explicitlyDenies\(playerName, uuid, root\)[\s\S]*explicitlyDenies\(playerName, uuid, legacyRoot\)/,
  'Fabric player viewing should require its capability and honor an explicit command deny');
assert.match(fabric, /literal\("entityadmin"\)[\s\S]*canUseEntityAdmin[\s\S]*sendEntityAdminHelp/,
  'entity capabilities need a discoverable in-game route to the desktop editor');
assert.match(fabricController, /viewer\.level\(\)\.dimension\(\)\.identifier\(\)/);
assert.match(fabricController, /teleportTo\(level, origin\.x\(\), origin\.y\(\), origin\.z\(\), Set\.of\(\),[\s\S]*origin\.yaw\(\), origin\.pitch\(\)/);
assert.doesNotMatch(fabricController, /setGameMode|GameType/,
  'Fabric POV start and camera maintenance must preserve the viewer actual game mode');
assert.match(originRestorer, /viewer\.setGameMode\(expected\)[\s\S]*viewer\.gameMode\(\) == expected/,
  'exact saved game mode may only be reapplied and verified during origin restoration');
assert.match(fabricController, /viewer\.setCamera\(target\)/);
assert.match(fabricController, /ACTIVE_TAG = "server_pov_active"/);
for (const stateCheck of [
  'viewer.isAlive()', 'viewer.isChangingDimension()', 'viewer.isSleeping()',
  'viewer.isPassenger()', 'viewer.isVehicle()', 'viewer.isFallFlying()',
  'viewer.isUsingItem()', 'viewer.containerMenu == viewer.inventoryMenu'
]) {
  assert.ok(fabricController.includes(stateCheck), `POV start must reject unsafe state: ${stateCheck}`);
}
for (const guardField of ['changingDimension', 'sleeping', 'passenger', 'vehicle', 'fallFlying', 'usingItem', 'inventoryMenuActive']) {
  assert.match(startGuard, new RegExp(`if \\([^\\n]*${guardField}|if \\(!${guardField}`),
    `start guard must enforce ${guardField}`);
}
assert.match(fabricController, /ServerPlayNetworking\.canSend\(viewer, PlayerViewPayload\.TYPE\)/);
assert.ok(fabricController.indexOf('if (!companionReady(viewer))') < fabricController.indexOf('sessions.put(viewerId, updated)'),
  'matching companion negotiation must succeed before recovery persistence or camera movement');
const tickController = fabricController.slice(fabricController.indexOf('void tick(MinecraftServer minecraftServer)'));
assert.ok(tickController.indexOf('if (!companionReady(viewer))') < tickController.indexOf('viewer.setCamera(target)'),
  'tick-time readiness loss must be handled before any camera rebind can relocate the viewer');
assert.match(fabric, /serverboundPlay\(\)\.register\(PlayerViewReadyPayload\.TYPE, PlayerViewReadyPayload\.CODEC\)[\s\S]*registerGlobalReceiver\(PlayerViewReadyPayload\.TYPE,[\s\S]*playerViews\.onReady/,
  'the server must register and consume the explicit client readiness handshake');
assert.match(negotiation, /supports\(UUID playerId, int protocolVersion\)[\s\S]*readiness != null && readiness\.supports\(protocolVersion\)/,
  'missing or incompatible readiness must fail closed');
assert.match(playerViewReadyPayload, /PlayerViewPayload\.LEGACY_PROTOCOL_VERSION,[\s\S]*PlayerViewPayload\.PROTOCOL_VERSION/,
  'the readiness range must explicitly negotiate legacy through current protocol support');
for (const operation of ['start', 'snapshot', 'stop']) {
  assert.match(fabricController, new RegExp(`PlayerViewPayload\\.${operation}`));
}
assert.match(fabricController, /getPlayer\(origin\.targetId\(\)\)[\s\S]*viewer\.getCamera\(\) != target/,
  'the target entity must be re-resolved and rebound across respawn/dimension changes');
assert.match(fabricController, /restoreViewersOf\(player\.getUUID\(\)/);
assert.match(fabric, /playerViews\.tick\(minecraftServer\);[\s\S]*if \(current == null \|\| offenses == null/,
  'camera lifecycle must tick before protection-disabled early returns');
assert.match(fabric, /literal\("view"\)[\s\S]*literal\("start"\)[\s\S]*literal\("stop"\)/);
assert.match(commandsMixin, /buildCommandTree[\s\S]*new ClientboundCommandsPacket\(root, COMMAND_NODE_INSPECTOR\)[\s\S]*callback\.cancel\(\)/,
  'the client must receive the already-pruned command tree');
assert.match(commandTreePruner, /!child\.canUse\(source\)[\s\S]*!rootAllowed\.test\(child\.getName\(\)\)/,
  'command roots must satisfy both native permission predicates and the managed access policy');
assert.match(commandTreePruner, /if \(redirect == null\) continue/,
  'redirect aliases must not pull a hidden command root back into autocomplete');
assert.match(playerMixin, /isSpectator[\s\S]*isPlayerViewActive[\s\S]*setReturnValue\(true\)/,
  'active viewers need spectator-like server isolation without a GameType change');
assert.match(playerMixin, /@Mixin\(Player\.class\)/,
  'isSpectator is declared by Player; targeting only ServerPlayer would fail at mixin application');
assert.match(fabricMixins, /"ServerPlayerMixin"/);
assert.match(fabricMixins, /"CommandSuggestionPacketAccessor"/);
assert.match(suggestionAccessor, /@Accessor\("id"\)[\s\S]*@Accessor\("command"\)/,
  'suggestion packet fields need one mapped accessor across both packet layouts');
assert.match(packetMixin, /handleMovePlayer[\s\S]*serverProtection\$cancelPovGameplay/);
assert.match(packetMixin, /handleUseItemOn[\s\S]*serverProtection\$cancelPovGameplay/);
assert.match(packetMixin, /handleInteract[\s\S]*serverProtection\$cancelPovGameplay/);
assert.match(packetMixin, /handleContainerClick[\s\S]*serverProtection\$cancelPovGameplay/);
for (const handler of [
  'handleRecipeBookSeenRecipePacket', 'handleRecipeBookChangeSettingsPacket', 'handleSeenAdvancements',
  'handleSetCommandBlock', 'handleSetCommandMinecart', 'handleSetGameRule', 'handleSetStructureBlock',
  'handleSetTestBlock', 'handleTestInstanceBlockAction', 'handleSetJigsawBlock', 'handleJigsawGenerate',
  'handleEntityTagQuery', 'handleBlockEntityTagQuery', 'handleSpectatorAction', 'handleClientCommand',
  'handleContainerClose', 'handleClientInformation', 'handleChangeDifficulty', 'handleChangeGameMode',
  'handleLockDifficulty', 'handleDebugSubscriptionRequest'
]) {
  assert.match(packetMixin, new RegExp(`@Inject\\(method = "${handler}"[\\s\\S]{0,500}serverProtection\\$cancelPovGameplay`),
    `${handler} must not mutate server/player state during POV`);
}
assert.match(packetMixin, /method = \{"handleAnimate", "handlePunch"\}[\s\S]{0,300}serverProtection\$cancelPovGameplay/,
  'the version-specific arm action packet must be blocked on both 26.2 and 26.3');
assert.match(packetMixin, /serverProtection\$commandSuggestions[\s\S]*ensureRunningOnSameThread[\s\S]*ServerCommandSuggestionsProvider;request[\s\S]*allowCommandSuggestions[\s\S]*ClientboundCommandSuggestionsPacket[\s\S]*List\.of\(\)/,
  'forged suggestion requests must use each version-safe scheduling point and receive an empty denied response');
assert.doesNotMatch(packetMixin, /@Inject\(method = "handle(?:Chat|ChatAck|AcceptTeleportPacket|AcceptPlayerLoad|ChatSessionUpdate|ConfigurationAcknowledged|ChunkBatchReceived|ClientTickEnd|CustomPayload)"/,
  'chat, required custom payloads, and protocol/tick/chunk acknowledgements must remain live during POV');
assert.match(playerViewPayload, /HOTBAR_SIZE = 9/);
assert.match(playerViewPayload, /PROTOCOL_VERSION = 2/);
assert.match(playerViewPayload, /INVENTORY_SIZE = 36/);
assert.match(playerViewPayload, /ARMOR_SIZE = 4/);
assert.match(playerViewPayload, /"serverprotection", "player_view"[\s\S]*"serverprotection", "player_view_v2"/,
  'v2 must use a distinct packet id so legacy decoders cannot consume its extended layout');
assert.match(playerViewPayload, /START\(1\)[\s\S]*SNAPSHOT\(2\)[\s\S]*STOP\(3\)/);

assert.match(bukkitController, /EventPriority\.LOWEST/);
assert.match(bukkitController, /access\.hasCapability\(player, AccessPolicy\.PLAYER_SPECTATE\)/);
assert.match(bukkitController, /access\.canUsePlayerView\(player, root\)/,
  'Bukkit player viewing should honor the role command deny list');
assert.match(bukkitController, /root\.equals\("ci-spectate"\)[\s\S]*root\.equals\("ci-unspectate"\)/);
assert.match(bukkitController, /viewer\.setSpectatorTarget\(target\)/);
assert.match(bukkitController, /new Location\(world, origin\.x\(\), origin\.y\(\), origin\.z\(\), origin\.yaw\(\), origin\.pitch\(\)\)/);
assert.match(bukkitAccess, /policy\.hasCapability\(assignment, AccessPolicy\.PLAYER_SPECTATE\)/);
assert.doesNotMatch(pluginYml, /^  spectate:/m,
  'The plugin must not shadow vanilla console spectate, which the desktop POV workflow uses.');
assert.match(pluginYml, /^  ci-spectate:/m);
assert.match(pluginYml, /^  ci-unspectate:/m);
assert.match(pluginYml, /^  unspectate:/m);
assert.match(pluginYml, /^  entityadmin:/m);

assert.match(recovery, /MAX_RECORDS = 64/);
assert.match(recovery, /ATOMIC_MOVE/);
assert.match(recovery, /worldId, double x, double y, double z, float yaw, float pitch/);
for (const source of [fabricController, bukkitController, recovery]) {
  assert.doesNotMatch(source, /Click Interval|Assembly/i, 'In-game player-view code must remain unbranded.');
}

console.log('PASS privileged in-game player-view contract');
