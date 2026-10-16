# Server Protection Companion for Fabric

This optional client mod is built separately for Minecraft 26.2 and 26.3. Install the JAR matching
the exact Minecraft version together with the matching Fabric API. A player without this mod can
still join a protected server normally.

The Minecraft 26.2 candidate is `MXN-SI-NN-Mod-Companion-1.5.3+mc26.2.jar`.
The 26.3 variant is `ServerProtection-Companion-Fabric-1.5.3+mc26.3.jar`.
Earlier versioned artifacts are preserved. Each variant must pass its own tests before distribution.

Version 1.5.3 removes typing indicators, their network channels, draft polling and overlay hooks.
Mentions, automatic mention completion, authorized player view and advisory mod reports remain.

**Show my nametag** is an optional local testing preference, off by default. It uses the normal
Minecraft nametag and its server-assigned team prefix, suffix and color, not a separate HUD label.
Only the local camera-player exclusion is relaxed: other players' visibility is untouched. First
person, invisible/spectator players, hidden HUD, vanilla range/crouch limits, other camera targets,
and team rules that hide names from teammates do not receive an exception. Iris shadow passes
also receive no exception. There is no per-frame file access, polling, network traffic or team lookup
request; normal client scoreboard updates supply the current tag.

There is no existing Companion settings screen. Use the local client command `/selfnametag on`,
`/selfnametag off`, `/selfnametag toggle`, or `/selfnametag status`. The preference is saved only
when changed, in `config/serverprotection-companion-self-nametag.properties` (`showOwnNametag=true`
or `false`). No server permission is required. Missing configuration defaults to off; an explicit
saved preference is preserved. Malformed or unreadable configuration fails closed until explicitly
changed. This does not enable self-nametags for everyone. Installing a server mod alone cannot
change that renderer.

Candidate verification covers policy gates, persistent preferences, absent typing channels/hooks, and exact native
renderer/mixin contracts. No running client was launched or attached to for this change; Lunar/Iris
visual rendering still needs a user-approved check after installation.

Version 1.5.0 adds quiet recipient-only team mentions and automatic `@` completion. Use `@Alice`,
`@VRG`, or `@"Night Watch"`. The native chat suggestion dropdown opens while typing `@`; arrows
and Tab choose a result. Full team names are inserted with quotes. Slash commands and private-command
drafts do not trigger this dropdown. No extra chat message, title popup, sound, or mention ping is sent.

For team names/highlights the server needs Server Chat 1.1.0 or newer and the optional Server Teams API.
Player completion still works locally on other servers. Team highlighting uses only the aliases
the server assigns to this recipient, with no roster UUIDs sent. Only display components change;
signed chat text, signatures, message tags, sender identity and delivery are untouched. The server
refreshes directories within one second of join/leave/rename/disband, and disconnect clears client state.

Friends need a current companion plus matching Fabric API for **automatic** opening and
recipient-only highlights. No Server Protection server mod, Server Teams client mod, or Custom In Chat
mod is required. Vanilla friends still join, chat normally, and Tab-complete the server-provided
`@` tokens, but vanilla cannot open the dropdown automatically or color individual mentions.

Keep only one companion JAR in a client's active mods directory, and relaunch Minecraft after
updating it. Version 1.5.3 sends no typing status and shows no typing overlay, including when
connected to an older server that still implements that feature.

Version 1.3.1 also avoids Lunar's cape submission conflict during Iris shadow rendering. Only cape
geometry in the shadow pass is skipped; ordinary capes, terrain shadows and other entity shadows
are preserved. Iris remains optional. Its API is resolved once, and an unavailable or incompatible
provider disables this workaround without repeated render-time exceptions. The specific logged
cape/shadow conflict is covered by this change; distant-terrain flickering still needs a visual
retest on the affected client.

Version 1.3.2 also keeps player entities eligible for rendering when Sodium considers their terrain
sections occluded. This bypass applies only to players at Sodium's entity-occlusion layer; ordinary
camera/frustum/distance, invisibility, name-tag and depth rules remain intact. Other entity culling
is unchanged. Sodium is optional: the pseudo mixin is skipped if Sodium is absent, and its exact
26.2/26.3 method signatures use optional injections for compatibility with different Sodium APIs.

Build both exact-version artifacts from their respective projects:

```powershell
.\minecraft-server\proximity-voice\fabric-client\gradlew.bat -p .\minecraft-server\server-protection-client-fabric test build
.\minecraft-server\proximity-voice\fabric-client\gradlew.bat -p .\minecraft-server\server-protection-client-fabric-26.2 test build
```
