package dev.serverteleport.fabric;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

/** Converts bounded legacy color codes into actual styled chat components. */
final class FabricMessageComponent {
    private FabricMessageComponent() { }

    static Component parse(String rendered) {
        String input = rendered == null ? "" : rendered;
        MutableComponent root = Component.empty();
        StringBuilder text = new StringBuilder(Math.min(input.length(), 512));
        Style style = Style.EMPTY;
        for (int index = 0; index < input.length(); index++) {
            char character = input.charAt(index);
            if (character != ChatFormatting.PREFIX_CODE || index + 1 >= input.length()) {
                text.append(character);
                continue;
            }
            ChatFormatting format = ChatFormatting.getByCode(input.charAt(index + 1));
            if (format == null) {
                text.append(character);
                continue;
            }
            append(root, text, style);
            style = format == ChatFormatting.RESET ? Style.EMPTY : style.applyLegacyFormat(format);
            index++;
        }
        append(root, text, style);
        return root;
    }

    /** Builds the fixed, safe action row for a teleport request. */
    static Component teleportRequestPrompt(String renderedPrefix, String requesterName) {
        String prefix = renderedPrefix == null ? "" : renderedPrefix.strip();
        String requester = requesterName != null && requesterName.matches("[A-Za-z0-9_]{1,16}")
                ? requesterName
                : "";
        String commandTarget = requester.isEmpty() ? "" : " " + requester;
        MutableComponent root = Component.empty();
        if (!prefix.isEmpty()) root.append(parse(prefix)).append(" ");
        root.append(Component.literal("accept").withStyle(style -> style
                .withColor(ChatFormatting.GREEN)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent.RunCommand("/tpa accept" + commandTarget))));
        root.append(Component.literal(" or "));
        root.append(Component.literal("decline").withStyle(style -> style
                .withColor(ChatFormatting.RED)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent.RunCommand("/tpa decline" + commandTarget))));
        root.append(Component.literal("?"));
        return root;
    }

    private static void append(MutableComponent root, StringBuilder text, Style style) {
        if (text.isEmpty()) return;
        root.append(Component.literal(text.toString()).withStyle(style));
        text.setLength(0);
    }
}
