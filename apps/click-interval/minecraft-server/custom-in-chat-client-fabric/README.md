# Custom In-Chat Client

An optional, portable Fabric client mod for your enchantment controls. It keeps normal Minecraft chat and opens the server's own toggle menu. No special launcher or other custom client is required.

## Install

1. Use Minecraft **26.2**, **Java 25 or newer**, and **Fabric Loader 0.19.5 or newer**.
2. Install **Fabric API 0.161.0+26.2 or a newer 26.2-compatible release** in that Minecraft instance's `mods` folder.
3. Put `Custom-In-Chat-Client-Fabric-1.0.0+mc26.2.jar` from `dist` into the same `mods` folder, then restart Minecraft.

**Mod Menu is optional.** A 26.2-compatible Mod Menu release, starting with 20.0.1, provides a settings shortcut. The normal Minecraft controls screen works without it.

The world or server must run **ServerEnchantments 1.4.0** with `/enchants` support. For single-player, install that server-side mod in the same instance. For multiplayer, the server owner installs it on the server; friends only need this optional client mod and Fabric API locally. Installing this client alone does not add enchantments. The unchanged live SMP does not yet have this support; it needs the server update first.

## Controls

- Press **K** during gameplay to open the enchantment toggle menu.
- Change K under **Options → Controls → Key Binds → Custom In-Chat Client** if it conflicts with another mod.
- Optional individual keys for **Miner's Sweep**, **Tree Chop**, and **Harvester Sweep** start unbound. Assign them in that same category.
- With Mod Menu installed, this mod's configuration button opens Minecraft's Key Binds screen.

Shortcuts do nothing while another screen is open or Minecraft is unfocused. Holding a normal keyboard or mouse binding does not repeatedly toggle it. The server displays and saves your actual toggle states; the client does not guess them. On an unsupported server, a key press produces a local explanation instead of sending a command.

Players can use `/enchants` without this client mod. Individual commands are `/enchants toggle miner`, `/enchants toggle tree`, and `/enchants toggle harvester`; they affect only the requesting player.

Another option without the client mod: crouch and tap **F** (or your swap-hands key) while holding the corresponding enchanted pickaxe, axe, or hoe. This toggles that enchantment's extra effect instead of swapping hands. Ordinary swaps with other items are unchanged.

## Build and tests

With Java 25 available, run `gradlew.bat test build` on Windows or `./gradlew test build` on Linux or macOS. The standalone project uses its included Gradle wrapper and public dependency repositories; no sibling project, account-specific path, or local dependency JAR is needed. The tested release is copied to `dist`.
