package dev.serverprotection.fabric;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;

/** Converts the shared bounded legacy-color rendering into actual styled chat components. */
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

            int rgb = readHexColor(input, index);
            if (rgb >= 0) {
                append(root, text, style);
                style = style.withColor(TextColor.fromRgb(rgb));
                index += 13;
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

    private static int readHexColor(String input, int index) {
        if (index + 13 >= input.length() || Character.toLowerCase(input.charAt(index + 1)) != 'x') return -1;
        int rgb = 0;
        for (int digit = 0; digit < 6; digit++) {
            int marker = index + 2 + digit * 2;
            if (input.charAt(marker) != ChatFormatting.PREFIX_CODE) return -1;
            int value = Character.digit(input.charAt(marker + 1), 16);
            if (value < 0) return -1;
            rgb = (rgb << 4) | value;
        }
        return rgb;
    }

    private static void append(MutableComponent root, StringBuilder text, Style style) {
        if (text.isEmpty()) return;
        root.append(Component.literal(text.toString()).withStyle(style));
        text.setLength(0);
    }
}
