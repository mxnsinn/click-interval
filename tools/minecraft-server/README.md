# Minecraft Server

The complete server-hosting implementation is in
`../../apps/click-interval/minecraft-server/`. Its desktop integration lives in
`../../apps/click-interval/minecraft-server-ui.js` and the related server,
player, MOTD, entity, and world-map windows alongside it.

This includes the server lifecycle, networking, add-on management, Fabric and
Paper components, protection, teleport, death-loot, player inspection, console,
and world-map source. Generated server worlds and downloaded JARs are excluded.
