# Server Chat for Minecraft 26.2

Version 1.1.2 provides player/team mention completions and quiet recipient-only inline highlights
for vanilla clients, without any typing tracking or relay. The optional companion adds the automatic
`@` dropdown. The server changes only the unsigned presentation of an existing outgoing public-chat
packet; sender, signature, signed body, indices, filter mask and chat type remain unchanged, and
vanilla signature-cache/last-seen accounting still runs. No packet is cancelled or rebroadcast.

Only exact username/team tag/quoted full-team-name tokens are colored yellow for the addressed
recipient. Filtered, private/team/command chat and translated/non-text custom components are left
unchanged. Highlights are capped at 16 per message, with bounded text/component complexity.

Requires Java 25, Fabric Loader 0.19.5 or later, and Fabric API 0.161.0+26.2 or later.
Server Teams is optional and discovered reflectively. No Server Protection or client mod is required.
Historical artifacts remain unchanged. Older companions simply find no advertised typing channel.
