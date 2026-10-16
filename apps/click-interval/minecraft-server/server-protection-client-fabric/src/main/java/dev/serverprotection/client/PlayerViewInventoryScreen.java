package dev.serverprotection.client;

import dev.serverprotection.fabric.playerview.PlayerViewPayload;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;

import java.util.List;
import java.util.UUID;

/** A local-only inventory snapshot. It has no menu, slots, or code path that can emit a click packet. */
final class PlayerViewInventoryScreen extends Screen {
    private static final int SLOT_SIZE = 18;
    private static final int ITEM_OFFSET = 1;
    private static final int GRID_COLUMNS = 9;
    private static final int PANEL_WIDTH = 194;
    private static final int PANEL_HEIGHT = 166;

    private static final int BACKDROP = 0x99000000;
    private static final int PANEL = 0xF0121316;
    private static final int PANEL_BORDER = 0xFF3C4048;
    private static final int SLOT = 0xFF202329;
    private static final int SLOT_BORDER = 0xFF555B65;
    private static final int HOVER_BORDER = 0xFFFFFFFF;
    private static final int SELECTED_BORDER = 0xFF79E67D;
    private static final int TEXT = 0xFFF4F4F4;
    private static final int MUTED_TEXT = 0xFF9DA3AD;
    private static final int WARNING_TEXT = 0xFFFFC96B;

    private final PlayerViewClientSession session;
    private final UUID sessionId;

    PlayerViewInventoryScreen(PlayerViewClientSession session, UUID sessionId) {
        super(Component.literal("Viewed player inventory"));
        this.session = session;
        this.sessionId = sessionId;
    }

    @Override
    public void extractBackground(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
        graphics.fill(0, 0, width, height, BACKDROP);
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
        super.extractRenderState(graphics, mouseX, mouseY, partialTick);
        PlayerViewPayload payload = session.inventoryPayload(sessionId);
        if (payload == null) return;

        int left = (width - PANEL_WIDTH) / 2;
        int top = (height - PANEL_HEIGHT) / 2;
        graphics.fill(left, top, left + PANEL_WIDTH, top + PANEL_HEIGHT, PANEL);
        graphics.outline(left, top, PANEL_WIDTH, PANEL_HEIGHT, PANEL_BORDER);

        String target = session.inventoryTargetName(sessionId, minecraft);
        graphics.text(font, Component.literal(target + "'s inventory"), left + 10, top + 9, TEXT, false);
        graphics.text(font, Component.literal("Read only"), left + PANEL_WIDTH - 57, top + 9, MUTED_TEXT, false);

        if (!payload.hasFullInventory()) {
            graphics.centeredText(font,
                    Component.literal("Hotbar only until the server is updated"),
                    left + PANEL_WIDTH / 2, top + 23, WARNING_TEXT);
        }

        int equipmentLeft = left + (PANEL_WIDTH - (5 * SLOT_SIZE)) / 2;
        int equipmentTop = top + 36;
        List<ItemStack> armor = payload.armor();
        for (int slot = 0; slot < PlayerViewPayload.ARMOR_SIZE; slot++) {
            ItemStack stack = armor.get(slot);
            renderSlot(graphics, stack, equipmentLeft + slot * SLOT_SIZE, equipmentTop,
                    mouseX, mouseY, false);
        }
        renderSlot(graphics, payload.offhand(), equipmentLeft + 4 * SLOT_SIZE, equipmentTop,
                mouseX, mouseY, false);

        int gridLeft = left + (PANEL_WIDTH - GRID_COLUMNS * SLOT_SIZE) / 2;
        int inventoryTop = top + 61;
        for (int row = 0; row < 3; row++) {
            for (int column = 0; column < GRID_COLUMNS; column++) {
                int index = PlayerViewPayload.HOTBAR_SIZE + row * GRID_COLUMNS + column;
                renderSlot(graphics, payload.inventory().get(index),
                        gridLeft + column * SLOT_SIZE, inventoryTop + row * SLOT_SIZE,
                        mouseX, mouseY, false);
            }
        }

        int hotbarTop = top + 126;
        for (int column = 0; column < GRID_COLUMNS; column++) {
            renderSlot(graphics, payload.inventory().get(column),
                    gridLeft + column * SLOT_SIZE, hotbarTop,
                    mouseX, mouseY, column == payload.selectedSlot());
        }
    }

    private void renderSlot(
            GuiGraphicsExtractor graphics,
            ItemStack stack,
            int x,
            int y,
            int mouseX,
            int mouseY,
            boolean selected
    ) {
        boolean hovered = mouseX >= x && mouseX < x + SLOT_SIZE
                && mouseY >= y && mouseY < y + SLOT_SIZE;
        graphics.fill(x, y, x + SLOT_SIZE, y + SLOT_SIZE, SLOT);
        graphics.outline(x, y, SLOT_SIZE, SLOT_SIZE,
                hovered ? HOVER_BORDER : selected ? SELECTED_BORDER : SLOT_BORDER);
        if (stack == null || stack.isEmpty()) return;
        graphics.item(stack, x + ITEM_OFFSET, y + ITEM_OFFSET);
        graphics.itemDecorations(font, stack, x + ITEM_OFFSET, y + ITEM_OFFSET);
        if (hovered) graphics.setTooltipForNextFrame(font, stack, mouseX, mouseY);
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        if (minecraft.options.keyInventory.matches(event)) {
            onClose();
            return true;
        }
        return super.keyPressed(event);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        return true;
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent event) {
        return true;
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent event, double dragX, double dragY) {
        return true;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        return true;
    }

    @Override
    public void onClose() {
        session.inventoryScreenRemoved(this);
        minecraft.setScreenAndShow(null);
    }

    @Override
    public void removed() {
        session.inventoryScreenRemoved(this);
        super.removed();
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    @Override
    public boolean isInGameUi() {
        return true;
    }
}
