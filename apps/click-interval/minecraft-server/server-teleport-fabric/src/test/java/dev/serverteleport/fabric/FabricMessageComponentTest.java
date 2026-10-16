package dev.serverteleport.fabric;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.TextColor;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class FabricMessageComponentTest {
    @Test
    void teleportPromptHasExactTextColorsAndRunCommands() {
        Component prompt = FabricMessageComponent.teleportRequestPrompt(
                "You got a TPA request from Alex. Would you like to", "Alex");

        assertEquals(
                "You got a TPA request from Alex. Would you like to accept or decline?",
                prompt.getString());
        Component accept = prompt.toFlatList().stream()
                .filter(component -> component.getString().equals("accept"))
                .findFirst()
                .orElseThrow();
        Component decline = prompt.toFlatList().stream()
                .filter(component -> component.getString().equals("decline"))
                .findFirst()
                .orElseThrow();

        assertEquals(TextColor.fromLegacyFormat(ChatFormatting.GREEN), accept.getStyle().getColor());
        assertEquals(TextColor.fromLegacyFormat(ChatFormatting.RED), decline.getStyle().getColor());
        assertTrue(accept.getStyle().isUnderlined());
        assertTrue(decline.getStyle().isUnderlined());
        ClickEvent.RunCommand acceptClick = assertInstanceOf(
                ClickEvent.RunCommand.class, accept.getStyle().getClickEvent());
        ClickEvent.RunCommand declineClick = assertInstanceOf(
                ClickEvent.RunCommand.class, decline.getStyle().getClickEvent());
        assertEquals("/tpa accept Alex", acceptClick.command());
        assertEquals("/tpa decline Alex", declineClick.command());
    }
}
