# Safe Fabric 26.2 pending mods

This package prepares official Modrinth artifacts without changing the active
`mods` directory. The live application and Minecraft process do not need to be
started, stopped, or contacted while downloads are queued.

## Selection

The default pre-start set is deliberately small:

- **Lootr 1.24.41.124** — per-player generated loot and distinct loot-container
  visuals. Lootr is required on the server **and every connecting client**.
- **ServerCore 1.5.19+26.2** — conservative server optimizations. Its
  gameplay-changing options remain disabled by default.
- **Krypton 0.3.1** — network-stack optimizations.
- **spark 1.10.187** — profiling and health diagnostics; it does not change
  gameplay.

These files are downloadable but opt-in and never auto-selected:

- **Chunky 1.5.3** — bounded chunk pre-generation. It does nothing until an
  administrator explicitly runs its commands.
- **squaremap 1.3.15** — server-side live 2D map provider. Select it only when
  the app's map integration is enabled.
- **Litematica 0.28.8 + MaLiLib 0.29.6** — an optional client bundle. These
  client-only jars are kept under `files/client-optional` and the application
  helper cannot copy them into the server. Clients also need Fabric API
  0.161.0+26.2; that exact official build is already present on the target
  server, but each client must install its own copy.
- **Fresh Animations 1.10.5 + Entity Model Features 3.3.11 + Entity Texture
  Features 7.2.5** — an optional Fabric 26.2 client bundle. Fresh Animations is
  downloaded only after explicit selection, directly from its official
  Modrinth CDN URL. The queue hash-verifies the ZIP and both dependency JARs,
  but portable exports keep the entire Fresh stack reference-only: each player
  downloads the exact files directly from their recorded official URLs. None
  is embedded, rehosted, or installed into the server `mods` folder.

The pinned artifact URLs, Modrinth version IDs, sizes, SHA-1, SHA-256, SHA-512,
and deployment metadata are in
`manifests/fabric-26.2-smp-mods.json`. They were resolved against the official
Modrinth v2 API and the exact official CDN bytes on 2026-10-06.

## Queue and status

An absolute profile path is always required; the tool never guesses which
server to modify.

```powershell
node minecraft-server\pending-mod-cli.js download `
  --profile-root "C:\path\to\profile"

node minecraft-server\pending-mod-cli.js status `
  --profile-root "C:\path\to\profile"
```

To package optional downloads without selecting them for installation:

```powershell
node minecraft-server\pending-mod-cli.js download `
  --profile-root "C:\path\to\profile" `
  --include-optional-server --include-client
```

Prefer named optional client selections when only one bundle is wanted:

```powershell
node minecraft-server\pending-mod-cli.js download `
  --profile-root "C:\path\to\profile" `
  --client-bundles fresh-animations
```

`--client-bundles litematica,fresh-animations` selects both. Nothing optional
is downloaded when neither `--client-bundles` nor the legacy all-inclusive
`--include-client` flag is supplied.

Downloads are written atomically under:

```text
<profile>\pending-mods\queues\fabric-26.2-smp-2026-10-04\
  state.json
  files\server\...
  files\client-optional\...
  files\client-resource-pack\...
```

A mismatched existing pending file is moved to `quarantine`; it is never
trusted or silently overwritten. Every JAR is checked against its published
hashes and its `fabric.mod.json` mod id before it becomes ready. Resource-pack
ZIPs are hash-checked, scanned for unsafe paths, links, duplicate entries,
unsupported compression and unsafe expansion. Every non-directory entry is
stream-inflated and checked against its real length and CRC under strict total
output and compression-ratio limits; local and central ZIP headers must agree.
The root `pack.mcmeta` must have the exact verified format range.

Queue state is recorded per artifact. If an optional client download fails
after the required server files are verified, default server status and apply
remain ready. An export that explicitly selects the incomplete client bundle
still fails closed until every selected file has been verified.

## Export a player client bundle

The default client export contains the verified Lootr JAR because every player
needs it to join a Lootr-enabled server. Add `--include-client` to include all
optional client bundles, or use `--client-bundles` for an explicit selection:

```powershell
node minecraft-server\pending-mod-cli.js export-client `
  --profile-root "C:\path\to\profile"

node minecraft-server\pending-mod-cli.js export-client `
  --profile-root "C:\path\to\profile" --include-client `
  --destination "D:\Exports\SMP-Fabric-26.2-client"

node minecraft-server\pending-mod-cli.js export-client `
  --profile-root "C:\path\to\profile" `
  --client-bundles fresh-animations `
  --destination "D:\Exports\SMP-Fabric-26.2-fresh-animations"
```

Without `--destination`, deterministic bundles are created under
`<profile>\pending-mods\client-exports`. Each bundle contains folders only for
files that may be copied, a short `README.txt`, and a machine-readable
`client-bundle.json` with exact Fabric/Minecraft compatibility, source version
IDs, target folders, official URLs, sizes, hashes, licenses, and whether each
artifact is bundled or reference-only.
Fabric API 0.161.0+26.2 is deliberately recorded as a required external
dependency (including its official URL and hashes), rather than silently
copied from the server.

Fresh Animations, EMF, and ETF are direct-download references for personal
local installation only. They are not copied into the portable bundle or
embedded in the Click Interval app/update. Keep the Fresh ZIP intact, do not
rehost or redistribute it, install the exact EMF/ETF JARs into client `mods`,
and then fully restart Minecraft. Enable Fresh Animations under
**Options > Resource Packs**. Any separately downloaded Fresh extension pack
belongs above the base Fresh Animations pack.

Exports are built in a temporary sibling folder and renamed into place only
after every copied file passes verification. An existing export is reused only
when its regular, non-linked README exactly matches generated instructions, its
manifest is semantically identical, and every bundled artifact still passes
verification. Existing or mixed destinations are never overwritten. The
exporter rejects the server profile root and any path that is or contains the
live server `mods` folder.

## Pre-start integration

Call the helper only after the lifecycle coordinator has proved that the
Minecraft child process is absent and its shutdown has finished. The explicit
`serverStopped: true` value is required; omitting it fails closed.

```js
const {
  applyPendingModQueue,
  recoverPendingModTransaction
} = require('./pending-mod-queue');

await recoverPendingModTransaction({
  profileRoot: paths.root,
  serverStopped: true
});

const pendingResult = await applyPendingModQueue({
  profileRoot: paths.root,
  manifestPath: require('node:path').join(
    __dirname,
    'manifests',
    'fabric-26.2-smp-mods.json'
  ),
  serverStopped: true,
  // Add 'squaremap' only when the live-map feature is enabled.
  optionalServerKeys: []
});
```

Do not start Minecraft unless both calls succeed. The helper performs another
profile/platform check, re-verifies pending hashes, reads every active Fabric
mod id, and rejects duplicate ids, conflicting filenames, missing Fabric API,
or unreadable JARs before changing anything.

Each final file move is atomic and the set is protected by a write-ahead
transaction journal. Existing versions selected for replacement are moved to a
transaction backup. An interrupted operation is recoverable on the next
stopped-server pass; no unknown file is overwritten during recovery.

## Lootr world-backup gate

Lootr can convert generated loot containers. Removing Lootr later without
restoring the world can leave those containers unusable, so its manifest entry
has `requiresWorldBackup: true`.

Before the first Lootr JAR move, the helper inventories and copies the entire
configured world to:

```text
<profile>\pending-mods\world-backups\<backup-id>\world\...
```

The default scan/copy bounds are 64 GiB and 2,000,000 entries with 512 MiB of
free-space reserve. Symlinks, special files, a changing source, insufficient
space, or exceeded limits abort the operation **before the mods folder is
changed**. Bounds can be raised explicitly through `worldBackupLimits`, up to
the module's hard ceilings.

The transaction journal records the backup ID and path. The normal rollback
helper refuses to remove a Lootr transaction unless the caller explicitly
confirms the world has not been opened since apply. If the server has run with
Lootr, stop it and restore the recorded world snapshot before removing Lootr;
keep the current world aside until the restoration is verified.

## Manual CLI apply and recovery

These commands are intentionally verbose about server state:

```powershell
node minecraft-server\pending-mod-cli.js recover `
  --profile-root "C:\path\to\profile" --confirm-server-stopped

node minecraft-server\pending-mod-cli.js apply `
  --profile-root "C:\path\to\profile" --confirm-server-stopped
```

Opt-in server artifacts are named explicitly:

```powershell
node minecraft-server\pending-mod-cli.js apply `
  --profile-root "C:\path\to\profile" --confirm-server-stopped `
  --optional squaremap,chunky
```

`rollback --confirm-world-unchanged` is only for a pre-start rollback where the
world provably has not been opened since apply. It is not a substitute for
restoring the Lootr world snapshot after gameplay.
