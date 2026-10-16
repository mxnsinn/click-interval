# Server Bounties

Server-side Fabric 26.2 item-funded bounty board. Players use ordinary Minecraft chest menus: no client add-on, custom packets, resource pack or currency dependency. Install on a dedicated server, or in the client mods folder only when using an integrated single-player server.

## Commands and menus

- `/bounties`: paginated heads for players with funded bounties. Hover to see rewards; click a head to inspect all reward stacks.
- `/setbounty` or `/bounties set`: select a known player (including offline players), then press the green pane. The next chest mirrors your 36 inventory slots in its upper four rows. Left-click adds one, right-click removes one; shift-left selects the whole stack, shift-right clears it. Press the final green pane to commit the reward.
- `/bounties claim`: collect saved winnings that could not fit into your inventory. The board also has a collection button.
- `/bounties mine` or `/bounties remove`: open **My bounties** (also the book button on the board). Each target appears once: repeated payments from you are added to the same displayed bounty. Select the player, inspect your full combined reward, and press the green **Confirm cancellation & refund** pane to remove all of your funding on that player. Back or Escape leaves the bounty unchanged.

The `/set bounty` spelling is deliberately not registered: this server's role system grants access by command root, and allowing a generic `/set` root could expose unrelated commands. Everyone can use `/bounties` and `/setbounty` through the bundled Protection 1.3.3 policy, unless the owner explicitly denies them. These roots never grant operator permissions.

Selection does not move real items. Escape or Back discards the draft. Both player selection and final reward submission have green confirmation panes; previous/next arrows page through long player lists. Actual item counts and components are checked again at submission. Armor, offhand and crafting slots are not offered as payment. Creative players cannot fund bounties; self-bounties are rejected.

Only the original sponsor's authenticated player UUID can cancel their grouped bounty. Cancelling your bounty removes all of your funding on that target, never anyone else's. Immutable payment IDs remain in storage for safe compatibility with existing saves. Confirmation captures their exact set: if you add new funding while an older confirmation is open, that old confirmation fails without changing any items, and you must review the updated total. Other sponsors adding funding does not invalidate your preview or include their items in your refund. Repeated packets, retired IDs, and newly posted bounties cannot turn an old confirmation into a new refund. A player kill and cancellation are serialized on the server thread: whichever commits first owns those items, never both. Once paid out or cancelled, a bounty cannot be cancelled again.

Cancellation first moves the exact escrow items into the sponsor's saved refund balance in one atomic ledger update. Delivery then uses the same journaled inventory transaction as winnings. Inventory space is optional: overflow stays saved for `/bounties claim`, including across restart, and no refund is thrown on the ground. An interrupted save is reconciled from the native player transaction marker before new transactions are allowed. These protections are covered by automated tests; they are not a guarantee against arbitrary third-party mods, manual save-file edits, partial backup restores or hardware failures.

An actual killing damage source from another player awards the target's currently funded bounties once. Environmental deaths, suicides and stale combat credit do not pay. Winnings are inserted only where they fit; the rest remain saved for later collection. Item names, enchantments and other components are retained. No items are thrown on the ground to handle overflow.

## Persistence and safety

State lives in `<world>/server-bounties/ledger.json`, separate for each world. An atomic write-ahead transaction and a unique marker in the native player save coordinate inventory payment/delivery with escrow. Startup resolves interrupted transactions from the persisted marker, not guessed item counts. Invalid or unreadable state disables bounties without clearing escrow. Back up the world, ledger and player data together; do not selectively restore one side of an economy transaction.

Known players are recorded on join and imported from the bounded local `usercache.json`; no external lookup or identity guessing is used for payment. Native player-head skin resolution uses UUIDs. Requests, reward data, entries and storage are bounded, with space reserved for payout/transaction recovery. The system has no periodic player/entity scans, terrain work or background world generation. Confirming item transactions performs synchronous durable saves; it is intentionally not advertised as zero-cost.

## Build and verification

Requires Java 25, Fabric Loader 0.19.5+ and Fabric API 0.161.0+26.2. Run `./build.ps1`; artifact: `dist/ServerBounties-Fabric-1.1.1+mc26.2.jar`. Existing version-1 ledgers and funded bounties are preserved without migration; repeated older funding immediately appears as one grouped bounty and can be refunded together.

JUnit tests cover ledger persistence, interrupted transactions, corruption and safe failure. Native tests are opt-in with `-Dserverbounties.selftest=true` **only in a disposable world**. They create synthetic players and escrow transactions. Never set that flag on a real server or the user's test save. The root project's `work/bounties-fullstack-smoke.cjs` copies the installed mod stack into a new isolated loopback profile and combines bounty/menu, enchantment and trading tests. It does not install anything in the live server.

Activation requires a server restart. Loading this server-side mod for singleplayer also requires relaunching Minecraft; merely reopening the world cannot load a new JAR.
