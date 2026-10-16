package dev.serverenchantments.fabric;

import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.*;
import net.minecraft.world.item.*;
import net.minecraft.world.item.component.ItemLore;

import java.util.List;

/** Inert vanilla icons. A successful action replaces the menu, invalidating its old container ID. */
public final class EnchantmentToggleMenu extends ChestMenu {
    private final ServerPlayer owner;
    private final ServerEnchantmentsFabric mod;
    private final PlayerToggleStore.Snapshot snapshot;
    private boolean submitted;

    static void open(ServerPlayer player, ServerEnchantmentsFabric mod) {
        if (!player.isAlive() || player.isRemoved() || player.isSpectator()) return;
        player.openMenu(new SimpleMenuProvider((id, inventory, actor) ->
                new EnchantmentToggleMenu(id, player, mod), Component.literal("My Enchantment Toggles")));
    }
    EnchantmentToggleMenu(int id, ServerPlayer owner, ServerEnchantmentsFabric mod) {
        super(MenuType.GENERIC_9x1, id, owner.getInventory(), new SimpleContainer(9), 1);
        this.owner = owner;
        this.mod = mod;
        snapshot = mod.toggleSnapshot(owner);
        for (int index = 0; index < slots.size(); index++) {
            Slot old = slots.get(index);
            Slot locked = new Slot(old.container, old.getContainerSlot(), old.x, old.y) {
                @Override public boolean mayPlace(ItemStack stack) { return false; }
                @Override public boolean mayPickup(Player actor) { return false; }
            };
            locked.index = index;
            slots.set(index, locked);
        }
        icon(2, Items.DIAMOND_PICKAXE, PlayerToggleStore.Feature.MINER);
        icon(4, Items.DIAMOND_AXE, PlayerToggleStore.Feature.TREE);
        icon(6, Items.DIAMOND_HOE, PlayerToggleStore.Feature.HARVESTER);
    }
    private void icon(int slot, Item item, PlayerToggleStore.Feature feature) {
        boolean enabled = snapshot.state().enabled(feature);
        ItemStack icon = new ItemStack(item);
        icon.set(DataComponents.CUSTOM_NAME, Component.literal(feature.label + ": " + (enabled ? "ON" : "OFF"))
                .withStyle(enabled ? ChatFormatting.GREEN : ChatFormatting.RED));
        icon.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, enabled);
        icon.set(DataComponents.LORE, new ItemLore(List.of(
                Component.literal("Click to turn " + (enabled ? "OFF" : "ON")).withStyle(ChatFormatting.YELLOW),
                Component.literal("Only your extra harvesting changes.").withStyle(ChatFormatting.GRAY),
                Component.literal("Enchants and Smelter stay on your tool.").withStyle(ChatFormatting.GRAY),
                Component.literal("Shortcut: crouch + swap-offhand (F)").withStyle(ChatFormatting.GRAY))));
        getContainer().setItem(slot, icon);
    }
    @Override public boolean stillValid(Player actor) {
        return actor == owner && owner.isAlive() && !owner.isRemoved() && !owner.isSpectator();
    }
    @Override public ItemStack quickMoveStack(Player actor, int slot) { return ItemStack.EMPTY; }
    @Override public boolean canDragTo(Slot slot) { return false; }
    @Override public boolean canTakeItemForPickAll(ItemStack stack, Slot slot) { return false; }
    @Override public boolean clickMenuButton(Player actor, int button) { return false; }
    @Override public void setSelectedBundleItemIndex(int slot, int index) { }
    @Override public void clicked(int slot, int button, ContainerInput input, Player actor) {
        if (actor != owner || owner.containerMenu != this || !stillValid(actor) || submitted) return;
        try {
            if (input != ContainerInput.PICKUP || button != 0 || !getCarried().isEmpty()) return;
            PlayerToggleStore.Feature feature = switch (slot) {
                case 2 -> PlayerToggleStore.Feature.MINER;
                case 4 -> PlayerToggleStore.Feature.TREE;
                case 6 -> PlayerToggleStore.Feature.HARVESTER;
                default -> null;
            };
            if (feature == null) return;
            if (snapshot.revision() != mod.toggleSnapshot(owner).revision()) {
                submitted = true;
                open(owner, mod);
                return;
            }
            if (mod.toggle(owner, feature)) {
                submitted = true;
                open(owner, mod);
            }
        } finally {
            if (owner.containerMenu == this) sendAllDataToRemote();
            owner.inventoryMenu.broadcastChanges();
        }
    }
}
