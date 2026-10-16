package dev.serverprotection.fabric;

import net.minecraft.network.chat.Component;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class FabricMessageComponentTest {
    @Test
    void convertsLegacyAndHexSequencesIntoComponentStyles() {
        Component component = FabricMessageComponent.parse(
                "§x§1§2§3§4§5§6Hex §lBold§r plain §cRed");
        assertEquals("Hex Bold plain Red", component.getString());
        List<Component> siblings = component.getSiblings();
        assertEquals(4, siblings.size());
        assertEquals(0x123456, siblings.get(0).getStyle().getColor().getValue());
        assertEquals(0x123456, siblings.get(1).getStyle().getColor().getValue());
        assertTrue(siblings.get(1).getStyle().isBold());
        assertNull(siblings.get(2).getStyle().getColor());
        assertEquals(0xff5555, siblings.get(3).getStyle().getColor().getValue());
    }

    @Test
    void preservesUnknownCodesAsPlainTextAndHandlesEmptyInput() {
        assertEquals("", FabricMessageComponent.parse(null).getString());
        assertEquals("§ztext", FabricMessageComponent.parse("§ztext").getString());
    }
}
