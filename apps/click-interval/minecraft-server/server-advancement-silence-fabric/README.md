# Server Advancement Silence

Minecraft 26.2, Java 25, Fabric Loader 0.19.5+, Fabric API. Server-side only; clients do not need this mod. It can also run in an integrated single-player server for testing.

From the server console (or authenticated RCON):

```
silence advancement mxnsinn
unsilence advancement mxnsinn
```

Both command roots are hidden from players, including operators. Command blocks and `execute as` are denied. Only an exact online username or an unexpired entry in the server's existing username cache is accepted. Unknown/expired names must join first; the mod never invents an offline UUID or runs a remote name lookup.

Only that UUID's **public vanilla advancement chat announcement** is filtered. Advancement completion, rewards, client packets/toasts, normal chat and other players' announcements are untouched. The global announcement gamerule is never changed. A username change does not remove a UUID's silence setting. Restoring announcements does not replay old awards.

Settings persist in `<world>/server-advancement-silence.json`, using an fsynced sibling temporary file followed by atomic replacement. Failed saves leave the previous in-memory policy unchanged. Malformed existing settings are logged, never overwritten, and disable these commands for that server session; vanilla chat remains unchanged until the file is repaired and the server restarted.

Build with the neighboring shared wrapper:

```
../server-market-fabric/gradlew.bat -p . --no-daemon build
node native-test.cjs
node native-test.cjs --treechop
```

The native fixture uses two JVM launches of the same disposable world beneath this project's `build/native-fixtures`. It refuses all normal saves, binds loopback only with an empty enforced whitelist, and shuts down only its own test process. No live/client installation is performed.

`--treechop` uses a hash-verified copy of the existing `TreeChopTest` single-player save instead of a fresh world. It runs that copy headlessly; it does not open or operate the user's Minecraft client. Before/after manifests prove the original save is unchanged.
