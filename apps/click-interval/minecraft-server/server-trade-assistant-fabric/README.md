# Server Trade Assistant (Fabric 26.2)

This module adds a compact cycle button to the villager trading screen, server-side validation,
persistent per-villager reroll limits, and role-scoped pricing. The same JAR belongs in both the
server and client `mods` folders; the server remains authoritative.

## Safe trade cycling

The server accepts a cycle only while the same player is actively trading with a nearby, living,
employed, novice villager that has zero XP and no used offer. Inputs in both payment slots are
returned before regeneration. Reroll count survives restarts and resets only when the villager's
profession changes. `config/trade-assistant.properties` bounds cooldown, distance, and limit.

`tradeDiscountPercent` in `config/server-protection/access.yml` is clamped to 0-55. The adjustment
is added only for the current trading session, removed when trading ends, and suspended while the
villager is saved so it cannot leak into the shared offer data. Set `require-role-permission=true`
to require `trade.reroll` (or an explicitly allowed trade command) for the cycle button.

Players with `entity.labels` can use `/entityids show` and `/entityids hide`. Labels are client-local,
limited to loaded entities within 48 blocks, and do not change an entity's server name.

## App control bridge

The server creates `config/servertradeassistant/` with:

- `control-token.txt`: 64 hexadecimal characters; treat it as a secret.
- `requests/<correlation>.json`: app writes one request atomically (maximum 64 KiB).
- `responses/<correlation>.json`: server writes the correlated result atomically.
- `map-snapshot.json`: at most 512 currently loaded non-player entities, refreshed once per second.

Every request uses protocol `trade-assistant-control-v1` and must include the token. The bridge
never executes commands, accepts NBT, scans chunks, or causes chunks to load.

```json
{
  "protocol": "trade-assistant-control-v1",
  "requestId": "inspect-0001",
  "token": "<control-token.txt>",
  "operation": "inspectEntity",
  "entityUuid": "00000000-0000-0000-0000-000000000000"
}
```

`requestId` must be 1-64 ASCII letters, digits, underscores, or dashes and must exactly match the
request filename (`inspect-0001.json` in the example).

Supported operations:

- `listLoadedEntities`: optional `dimension`, optional `limit` (1-512).
- `listNearbyEntities`: required `x`, `y`, `z`; optional `radius` (2-256), `dimension`, `limit`.
- `inspectEntity`: loaded entity UUID.
- `setVillagerOffer`: UUID, `offerIndex`, and optional `costAItem`, `costACount`, `costBItem`,
  `costBCount` (zero removes it), `resultItem`, `resultCount`, `maxUses`, `xp`, `priceMultiplier`.
- `setVillagerBabyAge`: UUID and `babyAgeTicks` (-1,200,000 through 0).
- `setVillagerBreedingCooldown`: adult villager UUID and `cooldownTicks` (0-1,200,000).
- `setAnimalBreedingCooldown`: adult breedable animal UUID and the same bounded cooldown.

Offer edits refuse active trading, air or unknown items, overstacked results, costs outside 1-64,
and `maxUses` lower than existing uses. All entity operations reject unloaded entities.

## Build

Run `build.ps1`. The release artifact is written to
`dist/ServerTradeAssistant-Fabric-1.0.0+mc26.2.jar`.
