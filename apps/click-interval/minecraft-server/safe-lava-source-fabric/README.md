# Click Interval Infinite Lava

Server-only Fabric 26.2 replacement for the former marker-entity/data-pack implementation.

The mod keeps the legacy Fabric mod ID `mr_lava_source` for world and upgrade compatibility. At
server startup it enables Minecraft's native `lava_source_conversion` game rule. Minecraft then
handles renewable lava through its normal fluid-update logic, including large lava bodies, with no
global scans or synthetic entities.

Runtime architecture:

- one server-start lifecycle callback;
- no tick callbacks;
- no commands;
- no mixins;
- no spawned entities;
- no block/chunk/world scans.
