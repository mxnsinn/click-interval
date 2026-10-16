# Villager stock support — Fabric 26.2

Backend: `dist/ServerVillagerTrades-Fabric-1.4.0+mc26.2.jar`.
Requires Fabric Loader 0.19.5+, Fabric API 0.161.0+26.2 and Java 25.
The same backend supports dedicated servers and integrated singleplayer worlds.

## Original Trade Cycling compatibility

Version 1.4.0 no longer registers the custom cycling network or merchant-session mixins.
Install the **original Trade Cycling 1.0.22+26.2** on the server and on clients that want its
ordinary merchant-screen cycling button. In singleplayer, install both original Trade Cycling
and this stock backend in the client mods folder. The original JAR, UI and
`trade_cycling:cycle_trades` packet remain unchanged. Remove the obsolete
`ClickInterval-TradeButton` add-on when migrating; do not run two button mods together.

Without original Trade Cycling, this backend provides unlimited stock only. Unmodded clients
can still use ordinary trading on the dedicated server, but cannot receive a custom screen button.
There is no chat instruction, replacement screen, handshake, nonce, or delayed close.

An optional mixin around the original server handler adds narrowly scoped safety checks:

- The player and villager must be alive, in the same world, with the player as current customer.
- Minecraft's own merchant validity applies; there is no extra eye-ray or workstation-block scan.
- Only level-one villagers with zero XP and no used offers can reroll. This closes upstream
  1.0.22's empty-payment-slot bypass for already-traded villagers.
- Per-player reroll work is limited to eight attempts per twenty server ticks. Closing/reopening
  the menu does not reset this budget. Disconnect/world shutdown clears it.
- After upstream recalculates the new offers and result, native changed slots synchronize
  immediately. Payment and cursor items are retained; they do not block cycling.

The upstream mod still owns offer generation and its own assigned-job-site requirement.
The guard does not add commands, privilege restrictions, world scans, or periodic work.

## Unlimited stock

Ordinary villagers retain unlimited **paid** stock, including exhausted saved offers.
Wandering traders keep normal limits. Ingredient costs, discounts, XP and native demand
accounting remain unchanged. Existing offers are unlocked lazily when read and immediately
when assigned, without resetting use counters or erasing evidence that a villager was traded with.

Original maximum stock values remain unchanged in saves. Native outgoing packets advertise
available stock. Removing this backend restores ordinary limits without enormous persisted maxima.
Only offers owned by a villager in a real server level acquire unlimited status; decoded remote
client offers are not falsely unlocked when joining unrelated servers.

## Build and verification

Use JDK 25 and `gradlew.bat --no-daemon --max-workers=2 test build`.
The default build emits only the server release. Legacy custom-client source and the explicitly
invoked `clientAddonJar` task remain for reproducibility; they are not part of this migration.

Native tests require a **fresh disposable server**, a regular file named
`.villager-trades-disposable-test` in its launch working directory, and:

```text
-Dservervillagertrades.selftest=true
-Dservervillagertrades.originaltest=true
```

The second flag requires original Trade Cycling to be present. Successful execution emits
`SERVER_ORIGINAL_TRADE_CYCLE_SELFTEST_PASS` and `SERVER_VILLAGER_TRADES_SELFTEST_PASS`.
Tests invoke the original transformed handler and verify immediate first-click rerolls, native
payment/cursor conservation, result recalculation, normal close, traded-state/customer/range
guards, request bounds, exhausted-stock restoration and wire availability.
Without original Trade Cycling and without the second flag, the stock tests still run and the
original-handler tests explicitly report skipped.

**Never enable self-tests on a real save or live server.** Copied-save startup checks must omit
both flags. Compilation/native tests do not establish that a client visually rendered the button.
