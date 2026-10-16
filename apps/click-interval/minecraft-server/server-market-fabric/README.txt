Server Market 1.1.0 -- Minecraft 26.2 / Fabric / Java 25

DELIVERY STATUS
This project builds a standalone server-side mod. It must not be deployed or
enabled in the live multiplayer server without explicit authorization. The
environment is '*' so the same jar can run on a single-player integrated server;
there are no client-only classes, custom packets, or client downloads required.
Do not put it in the live server without the owner's explicit instruction.

PLAYER COMMANDS
/market                  Open the paged vanilla chest listing browser.
/market create           Choose offered inventory stack, browse wanted items;
                         adjust offer/payment counts and confirm the listing.
/market mine             Review your listings and confirm owner-only removal.
/market claim            Collect saved seller payments/cancellation refunds.
/market list             Text listing IDs and barter descriptions.
/market buy <id>         Review a purchase and receive a 60-second token.
/market cancel <id>      Review your own cancellation and receive a token.
/market confirm <token>  Execute that one pending action exactly once.
/market sell <offered> <wanted-item> <wanted-count>
                         Hold the offered stack in your main hand. Creates a
                         confirmation, not an immediate listing. Vanilla item
                         argument syntax accepts item components; this works
                         even when you do not possess a wanted-item sample.
Example: /market sell 4 minecraft:diamond 2

WANTED-ITEM BROWSER (MARKET AND AUCTIONS)
After choosing the offered stack, the six-row native chest shows that offer
beside a PAPER icon reading "Choose what you want for this item". Pick a
creative-tab category, All items, Other items, or Your inventory. Categories and
items paginate in groups of 36; Back moves from items to categories to offered
item selection. Back from the final amount screen returns to wanted categories.
You do not need to own an item to request it. Item icons keep their native,
client-localized names. All items is sorted by registry ID for stable ordering.

The catalog includes all enabled registry item types except air and the vanilla
admin/unobtainable IDs in PickerPolicy: command/debug/test/structure blocks and
tools, spawn eggs, barrier/light/structure void, spawners/vaults, bedrock/end
portal frames, reinforced deepslate/budding amethyst, infested blocks, petrified
oak slabs, farmland/dirt paths, suspicious sand/gravel, frogspawn and chorus
plants. Modded item availability is not guessed: enabled mod items are retained.
This is an item catalog, not a promise that a particular world's loot tables or
recipes currently produce every entry. Creative-tab variants include potions,
enchanted books, etc.; otherwise-unlisted types fall back to Other items. We do
not add empty default potion/book templates when useful variants exist already.

Your inventory preserves exact names, enchantments, damage, custom components
and nested contents, including items outside the general catalog. These samples
must still exist when selected. For custom enchantments, maps or other precise
components absent from the catalog, use Your inventory or the component-aware
command fallback. The wanted item is only a template: no sample is consumed.

The catalog is built once per server at startup and rebuilt after successful
data-pack reload; normal category/page clicks never scan the item registry.
Common creative-tab generators write into private collectors through read-only
accessors, without mutating the client's shared creative-tab/search/icon caches.
Third-party creative event additions without a generator are covered by their
registry defaults and exact inventory samples. No client classes or packets.
Each picker navigation creates a fresh native container ID, so queued clicks
from old pages cannot select the next page's item. Closing/selection consumes
the old picker, and all native transfer paths remain locked. Only the existing
final confirmation can enter the durable native escrow transaction.

TIMED ITEM AUCTIONS
/auctionhouse or /ah       Open the paged timed auction browser.
/ah create                Offered stack -> categorized wanted items -> quantities
                          and duration -> final creation confirmation.
/ah mine                  Review your auctions; cancel only BEFORE any bid.
/ah list                  Text IDs, minimum, highest bidder/bid and time left.
/ah bid <id> <amount>      Stage a bid with a one-time confirmation token.
/ah cancel <id>           Stage your unbid auction's cancellation.
/ah confirm <token>       Execute the exact reviewed action once (60 seconds).
/ah claim                 Same saved item claims as /market claim.
/ah sell <offered> <wanted-item> <minimum-bid> <duration-minutes>
                          Command fallback, including when no payment sample
                          is owned. Hold the offered stack in your main hand.
Example: /ah sell 4 minecraft:diamond 2 60

Auction duration is bounded from 1 minute through 7 days (10080 minutes). Bids
are real items removed into escrow, never virtual currency. A higher bid saves
the previous highest payment as a refund; raising your own highest bid takes
ONLY the difference while retaining your earlier payment. Sellers cannot bid
on their own auctions or cancel after any bid. A bid confirmed at or after the
deadline fails without payment. Changed bid revisions invalidate stale previews.

The deadline continues while players/server are offline. At boot and at most
once per second while running, expired auctions settle atomically: the winner
receives the offered stack in saved claims, and the seller receives the exact
winning payment. No bids means the offered stack returns to its seller's claims.
Full inventories and offline players never cause item drops. Repeated settlement
or restart cannot pay the same immutable auction ID twice.

The server wall clock is observed in RAM, with a high-water mark persisted only
on auction transactions/settlements (no idle disk rewrites). A backward jump
over 5 seconds blocks creation/new bids until the clock catches up; unbid
cancellation and existing claims stay available. Already observed time never
reverses. Auction displays show a snapshot: use Refresh for current time/bids.
Any large forward clock adjustment can end auctions, as with wall-clock timers.

Auctions share server-market/ledger.json and its existing inventory transaction
journal with ordinary market trades. Legacy market-only version-1 states are
upgraded by adding absent auction fields while preserving listings, pending
items and both sides of any prepared journal. Malformed existing auction fields
are never silently reset. At most 500 active auctions, 30 per seller; new bids
reserve ledger headroom for settlement. Pending-owner count has no independent
quota that could strand an otherwise fitting settlement; serialized size remains
strictly bounded.

One listing offers one whole or partial stack in exchange for an exact item
template and count. Matching includes every data component: names, damage,
enchantments, nested contents, etc. Plain diamonds do not satisfy named diamonds.
The wanted sample is never consumed when creating a listing. GUI item displays
are inert copies; only the green confirmation changes real inventory. Escape
cancels a draft without taking items. All shift/drag/hotbar/drop/double-click
actions and lower inventory transfers in these menus are inert.

SAFETY AND RECOVERY
World-local storage: server-market/ledger.json. Preserve this file, its prepared
transaction if present, and the corresponding native playerdata together.
Never delete/reset the ledger, remove the mod during an unresolved transaction,
or restore only one side of a world+playerdata+market backup.

A purchase modifies only the buyer's durable inventory and the ledger. The
seller's exact payment stays in saved escrow even while offline; claims have
their own atomic transaction. Cancellations move escrow into saved owner claims
without writing anyone's inventory. No transaction drops overflow into the world.
Claims can partially fill free capacity and retain the remainder.

The ledger is atomically replaced with a forced write-ahead journal. A unique
native player-save tag is persisted with inventory; recovery uses that tag, not
item counts, to decide commit versus rollback. Both journal states have their
item codecs validated before recovery. An unreadable decision stays unresolved.
Runtime ambiguity disconnects the affected player. Failed initialization or
unresolved storage blocks new joins until restart/recovery, preventing spending
journalled inventory. Correct storage access and preserve the journal; do not
manually guess its outcome. A restart normally resolves it automatically.

Transactions reject Creative/Spectator/dead players, cursor/crafting-grid items,
other open containers, overstacked escrow/payment, stale selections and impossible
payment capacity. Limits: 500 listings total, 30 per seller, one offered stack,
4096 requested items maximum (also limited to 36 normal stacks), 16 KiB encoded
data per item template, 2 MiB listing admission and 3 MiB state budget. Claims
retain reserved journal space. Storage/hardware or external inventory-modifying
mods can still require operator recovery; keep complete backups.

BUILD AND VERIFICATION
Run with Java 25:
  gradlew.bat --no-daemon --max-workers=1 build
Output: dist/ServerMarket-Fabric-1.1.0+mc26.2.jar
JUnit covers journal begin/finish fault injection, commit/abort restart recovery,
unreadable decisions, malformed-ledger preservation, capacity and GUI allowlist,
plus picker eligibility, all slot/page boundaries and overflow-safe pagination.
The 1.1.0 build passes 16 JUnit tests (9 storage/menu + 7 picker policy).

Native synthetic-player tests are opt-in and refuse to mutate a world unless:
  1. JVM property -Dservermarket.selftest=true is set;
  2. world/server-market-test-fixture is a regular marker file;
  3. world/server-market/ledger.json does not already exist.
Use only a fresh disposable test world, never the original single-player save.
Expected markers:
  SERVER_MARKET_PICKER_NATIVE_TEST_PASS checks=<count>
  SERVER_MARKET_MENU_TEST_PASS
  SERVER_MARKET_TRANSACTION_FAILURE_TEST_PASS
  SERVER_MARKET_NATIVE_TEST_PASS
  SERVER_AUCTION_MENU_TEST_PASS
  SERVER_AUCTION_NATIVE_TEST_PASS
Injected fault tests intentionally log exceptions labelled TEST. They exercise
native save failure, unreadable native decision, repeated commit failure,
rollback-finish failure and transient commit retry, then reopen native storage
and assert exact conservation and one-time recovery.

The picker native suite checks every eligible registry type, cached defensive
copies, all native click modes/buttons, wrong owner/closed/stale pages, changed
offers/samples, exact-component selection without GUI lore, navigation, market
and auction create flows, unowned wanted items, and one-time escrow plus refund.
