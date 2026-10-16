# Proximity Voice

Clean-room proximity voice transport for the server manager.

This directory currently contains the dependency-free secure protocol/routing core and a functional
Paper-compatible UDP relay plugin. It does **not** by itself capture a microphone or play audio. Those
features require the matching client mod in `fabric-client`.

## Server protocol foundation

- Versioned binary packets (`PVC1`, protocol version 1)
- AES-256-GCM authentication and encryption with direction-separated nonces
- Random per-login session keys and UDP association challenges delivered over the Minecraft plugin channel
- 64-packet replay protection, bounded datagrams, and authenticated packet/byte token-bucket limits
- Fixed-memory global, endpoint-stripe, and per-session admission limits before AES-GCM decryption
- Same-world, configurable-radius routing based on immutable main-thread position snapshots
- Per-snapshot lazy route caching, nearest-listener fan-out capped at 64, and a global 4,096-delivery/second budget
- One dedicated UDP receive thread; no Bukkit world access from the network thread
- Atomic `plugins/ProximityVoice/status.json` health and traffic counters

The matching Fabric client also applies fixed packet/byte admission limits before decrypting relay UDP,
keeps at most 16 live decoder/jitter streams, reuses its playback frame buffer, and uses generation-safe
audio teardown so a delayed device thread cannot revive after disconnect.

Voice traffic uses UDP port `24454` by default. Minecraft's TCP port being reachable does not imply that
voice is reachable. The UDP port must be opened or mapped separately.

## Build and test

Requirements: Windows PowerShell and the pinned JDK tools reported as `javac 25.0.3` / `jar 25.0.3`.
Classes target Java 21 for server compatibility; the exact build tool version is required so the pinned
release JAR is byte-for-byte reproducible.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

The build downloads pinned compile-only Paper API dependencies to a unique temporary directory, verifies
their SHA-512 hashes, builds twice, and refuses to publish if the two hashes differ. It fixes ZIP timestamps
and omits the optional machine-generated JAR manifest. The output is `dist/ProximityVoice-Server.jar`.
`test.ps1` also rebuilds in verification mode and proves that the published artifact matches current source.

No code from Simple Voice Chat or another proprietary voice mod is included.
