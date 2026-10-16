package com.clickinterval.villagertrades.client;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.network.chat.Component;

/** Small pixel refresh arrow; no font glyph or resource-pack dependency. Native button behavior stays intact. */
public final class CycleIconButton extends Button {
    private static final int[][] STROKES = {
            {3, 2, 8, 3}, {2, 3, 4, 4}, {1, 4, 3, 8},
            {8, 3, 10, 5}, {7, 5, 11, 6}, {8, 6, 10, 7},
            {8, 7, 10, 9}, {7, 9, 9, 10}, {3, 10, 8, 11}, {2, 9, 4, 10}
    };
    public CycleIconButton(int x, int y, OnPress onPress) {
        super(x, y, 18, 18, Component.literal("Cycle trades"), onPress, DEFAULT_NARRATION);
    }
    @Override protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        extractDefaultSprite(graphics);
        int color = active ? 0xFFFFFFFF : 0xFF888888;
        int x = getX() + 3, y = getY() + 2;
        for (int[] stroke : STROKES) graphics.fill(x + stroke[0], y + stroke[1], x + stroke[2], y + stroke[3], color);
    }
}
