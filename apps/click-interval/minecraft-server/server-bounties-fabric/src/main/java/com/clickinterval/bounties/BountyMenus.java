package com.clickinterval.bounties;

import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.component.ItemLore;
import net.minecraft.world.item.component.ResolvableProfile;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Vanilla chest packets only. Every displayed item is an inert copy, never escrow. */
public final class BountyMenus {
    private BountyMenus() { }
    enum Page { BOARD, TARGETS, REWARDS, DETAILS, MINE, CANCEL }
    private static final int PAGE_SIZE = 45;
    private static final Item GRAY_PANE = Items.STAINED_GLASS_PANE.pick(DyeColor.GRAY);
    private static final Item GREEN_PANE = Items.STAINED_GLASS_PANE.pick(DyeColor.LIME);
    private static final Item BLACK_PANE = Items.STAINED_GLASS_PANE.pick(DyeColor.BLACK);

    public static void openBoard(ServerPlayer player, BountyService service) {
        open(player, service, Page.BOARD, 0, null, null);
    }

    public static void openTargets(ServerPlayer player, BountyService service) {
        open(player, service, Page.TARGETS, 0, null, null);
    }

    public static void openMine(ServerPlayer player, BountyService service) {
        open(player, service, Page.MINE, 0, null, null);
    }

    private static void open(ServerPlayer player, BountyService service, Page page, int number,
                             BountyService.Target target, UUID detailTarget) {
        if (!player.isAlive() || player.isSpectator()) return;
        String title = switch (page) {
            case BOARD -> "Bounties";
            case TARGETS -> "Set bounty: select player";
            case REWARDS -> "Reward for " + target.name();
            case DETAILS -> "Bounty rewards";
            case MINE -> "My bounties";
            case CANCEL -> "Cancel bounty & refund";
        };
        player.openMenu(new SimpleMenuProvider((id, inventory, actor) ->
                new Menu(id, player, service, page, number, target, detailTarget), Component.literal(title)));
    }

    static final class Menu extends ChestMenu {
        private final ServerPlayer owner;
        private final BountyService service;
        private final SimpleContainer display;
        private final Page page;
        private int number;
        private int pages = 1;
        private BountyService.Target selected;
        private final UUID detailTarget;
        private List<BountyService.Target> targets = List.of();
        private List<BountyService.BountyView> bounties = List.of();
        private List<BountyService.OwnBountyGroup> ownBounties = List.of();
        private BountyService.OwnBountyGroup cancelSnapshot;
        private boolean listLoaded;
        private final ItemStack[] inventorySnapshot = new ItemStack[36];
        private final int[] amounts = new int[36];
        private boolean submitted;
        private long inputWindow = System.nanoTime();
        private int inputCount;

        Menu(int id, ServerPlayer owner, BountyService service, Page page, int number,
             BountyService.Target selected, UUID detailTarget) {
            this(id, owner, service, page, number, selected, detailTarget, new SimpleContainer(54));
        }

        private Menu(int id, ServerPlayer owner, BountyService service, Page page, int number,
                     BountyService.Target selected, UUID detailTarget, SimpleContainer display) {
            super(MenuType.GENERIC_9x6, id, owner.getInventory(), display, 6);
            this.owner = owner;
            this.service = service;
            this.page = page;
            this.number = Math.max(0, number);
            this.selected = selected;
            this.detailTarget = detailTarget;
            this.display = display;
            // Reject native shift-click, dragging and pick-all even when called directly by another mod.
            for (int i = 0; i < slots.size(); i++) {
                Slot old = slots.get(i);
                final int slotIndex = old.getContainerSlot();
                Slot locked = new Slot(old.container, slotIndex, old.x, old.y) {
                    @Override public boolean mayPlace(ItemStack item) { return false; }
                    @Override public boolean mayPickup(Player actor) { return false; }
                };
                locked.index = i;
                slots.set(i, locked);
            }
            for (int slot = 0; slot < 36; slot++) inventorySnapshot[slot] = owner.getInventory().getItem(slot).copy();
            render();
        }

        @Override public boolean stillValid(Player actor) {
            return actor == owner && owner.isAlive() && !owner.isRemoved() && !owner.isSpectator();
        }
        @Override public ItemStack quickMoveStack(Player actor, int slot) { return ItemStack.EMPTY; }
        @Override public boolean canDragTo(Slot slot) { return false; }
        @Override public boolean canTakeItemForPickAll(ItemStack stack, Slot slot) { return false; }
        @Override public boolean clickMenuButton(Player player, int button) { return false; }
        @Override public void setSelectedBundleItemIndex(int slot, int index) { }

        @Override public void clicked(int slot, int button, ContainerInput input, Player actor) {
            if (actor != owner || owner.containerMenu != this || !stillValid(actor) || submitted) return;
            try {
                if (slot < 0 || slot >= 54 || button < 0 || button > 1) return;
                long now = System.nanoTime();
                if (now - inputWindow >= 1_000_000_000L) { inputWindow = now; inputCount = 0; }
                if (++inputCount > 20) return;
                if (page == Page.REWARDS && slot < 36
                        && (input == ContainerInput.PICKUP || input == ContainerInput.QUICK_MOVE)) {
                    int inventorySlot = slot < 27 ? slot + 9 : slot - 27;
                    if (!snapshotMatches(inventorySlot)) { staleInventory(); return; }
                    int count = inventorySnapshot[inventorySlot].getCount();
                    if (input == ContainerInput.QUICK_MOVE) amounts[inventorySlot] = button == 0 ? count : 0;
                    else amounts[inventorySlot] = Math.max(0, Math.min(count, amounts[inventorySlot] + (button == 0 ? 1 : -1)));
                    render();
                    return;
                }
                // All other click types (number keys, drop, clone, drag, double-click) are inert.
                if (input != ContainerInput.PICKUP || button != 0) return;
                switch (page) {
                    case BOARD -> boardClick(slot);
                    case TARGETS -> targetClick(slot);
                    case REWARDS -> rewardClick(slot);
                    case DETAILS -> detailClick(slot);
                    case MINE -> mineClick(slot);
                    case CANCEL -> cancelClick(slot);
                }
            } finally {
                // Correct vanilla client click prediction, including on ignored lower-inventory clicks.
                if (owner.containerMenu == this) sendAllDataToRemote();
                owner.inventoryMenu.broadcastChanges();
            }
        }

        private void boardClick(int slot) {
            int offset = number * PAGE_SIZE + slot;
            if (slot < PAGE_SIZE && offset < bounties.size()) {
                open(owner, service, Page.DETAILS, 0, null, bounties.get(offset).targetId());
            } else if (slot == 45) openTargets(owner, service);
            else if (slot == 46) openMine(owner, service);
            else if (slot == 52) {
                BountyService.Result result = service.claim(owner);
                tell(result.message(), result.success());
                listLoaded = false;
                render();
            } else navigation(slot);
        }

        private void targetClick(int slot) {
            int offset = number * PAGE_SIZE + slot;
            if (slot < PAGE_SIZE && offset < targets.size()) {
                selected = targets.get(offset);
                render();
            } else if (slot == 45) openBoard(owner, service);
            else if (slot == 53 && selected != null) open(owner, service, Page.REWARDS, 0, selected, null);
            else navigation(slot);
        }

        private void rewardClick(int slot) {
            if (slot == 45) open(owner, service, Page.TARGETS, 0, selected, null);
            else if (slot == 46) { java.util.Arrays.fill(amounts, 0); render(); }
            else if (slot == 53) {
                List<BountyService.Selection> selections = new ArrayList<>();
                for (int i = 0; i < 36; i++) if (amounts[i] > 0) {
                    if (!snapshotMatches(i)) { staleInventory(); return; }
                    selections.add(new BountyService.Selection(i, inventorySnapshot[i].copy(), amounts[i]));
                }
                if (selections.isEmpty()) { tell("Select at least one reward item first.", false); return; }
                submitted = true;
                BountyService.Result result = service.post(owner, selected, selections);
                tell(result.message(), result.success());
                if (result.success()) openBoard(owner, service);
                else { submitted = false; render(); }
            }
        }

        private void detailClick(int slot) {
            if (slot == 45) openBoard(owner, service);
            else navigation(slot);
        }

        private void mineClick(int slot) {
            int offset = number * PAGE_SIZE + slot;
            if (slot < PAGE_SIZE && offset < ownBounties.size()) {
                // The next screen snapshots this owner's full grouped reward.
                open(owner, service, Page.CANCEL, 0, null, ownBounties.get(offset).targetId());
            } else if (slot == 45) openBoard(owner, service);
            else navigation(slot);
        }

        private void cancelClick(int slot) {
            if (slot == 45) { openMine(owner, service); return; }
            if (slot != 53) { navigation(slot); return; }
            submitted = true;
            // Compare the precise set displayed in this confirmation, not a live
            // target lookup that could silently include newly funded rewards.
            BountyService.Result result = service.cancelGroup(owner, detailTarget,
                    cancelSnapshot == null ? List.of() : cancelSnapshot.contributionIds());
            tell(result.message(), result.success());
            openMine(owner, service);
        }

        private void navigation(int slot) {
            if (slot == 47 && number > 0) { number--; render(); }
            else if (slot == 51 && number + 1 < pages) { number++; render(); }
            else if (slot == 49) { listLoaded = false; render(); }
        }

        private boolean snapshotMatches(int slot) {
            return ItemStack.matches(inventorySnapshot[slot], owner.getInventory().getItem(slot));
        }

        private void staleInventory() {
            java.util.Arrays.fill(amounts, 0);
            for (int i = 0; i < 36; i++) inventorySnapshot[i] = owner.getInventory().getItem(i).copy();
            tell("Your inventory changed. Nothing was taken; please select the reward again.", false);
            render();
        }

        private void render() {
            display.clearContent();
            for (int slot = 45; slot < 54; slot++) display.setItem(slot, icon(GRAY_PANE, " "));
            switch (page) {
                case BOARD -> renderBoard();
                case TARGETS -> renderTargets();
                case REWARDS -> renderRewards();
                case DETAILS -> renderDetails();
                case MINE -> renderMine();
                case CANCEL -> renderCancel();
            }
            if (page != Page.REWARDS) {
                if (number > 0) display.setItem(47, icon(Items.ARROW, "Previous page"));
                display.setItem(49, icon(Items.PAPER, "Page " + (number + 1) + " / " + pages, "Click to refresh"));
                if (number + 1 < pages) display.setItem(51, icon(Items.ARROW, "Next page"));
            }
            broadcastChanges();
        }

        private void pagination(int count) {
            pages = Math.max(1, (count + PAGE_SIZE - 1) / PAGE_SIZE);
            number = Math.min(number, pages - 1);
        }

        private void renderBoard() {
            if (!listLoaded) { bounties = service.activeBounties(); listLoaded = true; }
            pagination(bounties.size());
            for (int slot = 0, i = number * PAGE_SIZE; slot < PAGE_SIZE && i < bounties.size(); slot++, i++) {
                BountyService.BountyView bounty = bounties.get(i);
                ItemStack head = head(new BountyService.Target(bounty.targetId(), bounty.targetName(),
                        new com.mojang.authlib.GameProfile(bounty.targetId(), bounty.targetName())));
                List<Component> lore = rewardLore(bounty.rewards(), 16);
                lore.add(Component.literal("Funded bounties: " + bounty.sponsors()).withStyle(ChatFormatting.GRAY));
                lore.add(Component.literal("Click to inspect all rewards").withStyle(ChatFormatting.YELLOW));
                head.set(DataComponents.LORE, new ItemLore(lore));
                display.setItem(slot, head);
            }
            if (bounties.isEmpty()) display.setItem(22, icon(Items.PAPER, "No active bounties", "Create one with the green pane below."));
            display.setItem(45, icon(GREEN_PANE, "Set a bounty", "Choose a player and fund a reward."));
            display.setItem(46, icon(Items.BOOK, "My bounties", "Review or cancel only bounties you funded.", "Other players' contributions are never removed."));
            List<ItemStack> pending = service.pendingRewards(owner.getUUID());
            ItemStack claim = icon(Items.CHEST, pending.isEmpty() ? "No unclaimed items" : "Collect rewards & refunds",
                    "Overflow stays safely stored until you have space.");
            if (!pending.isEmpty()) claim.set(DataComponents.LORE, new ItemLore(rewardLore(pending, 16)));
            display.setItem(52, claim);
        }

        private void renderTargets() {
            if (!listLoaded) { targets = service.targets(owner); listLoaded = true; }
            pagination(targets.size());
            for (int slot = 0, i = number * PAGE_SIZE; slot < PAGE_SIZE && i < targets.size(); slot++, i++) {
                BountyService.Target target = targets.get(i);
                ItemStack head = head(target);
                boolean chosen = selected != null && selected.id().equals(target.id());
                head.set(DataComponents.LORE, new ItemLore(List.of(Component.literal(chosen ? "Selected" : "Click to select")
                        .withStyle(chosen ? ChatFormatting.GREEN : ChatFormatting.YELLOW))));
                if (chosen) head.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
                display.setItem(slot, head);
            }
            if (targets.isEmpty()) display.setItem(22, icon(Items.PAPER, "No other known players yet", "Players appear after joining this server."));
            display.setItem(45, icon(Items.ARROW, "Back to bounties"));
            display.setItem(53, icon(selected == null ? GRAY_PANE : GREEN_PANE,
                    selected == null ? "Select a player first" : "Confirm: " + selected.name(), "Next: choose the reward from your inventory."));
        }

        private void renderRewards() {
            int selectedItems = 0;
            for (int displaySlot = 0; displaySlot < 36; displaySlot++) {
                int inventorySlot = displaySlot < 27 ? displaySlot + 9 : displaySlot - 27;
                ItemStack original = inventorySnapshot[inventorySlot];
                if (original.isEmpty()) continue;
                ItemStack shown = original.copy();
                List<Component> lore = new ArrayList<>(original.getOrDefault(DataComponents.LORE, ItemLore.EMPTY).lines());
                if (lore.size() > 12) lore = new ArrayList<>(lore.subList(0, 12));
                lore.add(Component.literal("Reward: " + amounts[inventorySlot] + " / " + original.getCount()).withStyle(ChatFormatting.GREEN));
                lore.add(Component.literal("Left +1 | Right -1").withStyle(ChatFormatting.YELLOW));
                lore.add(Component.literal("Shift-left: whole stack | Shift-right: clear").withStyle(ChatFormatting.GRAY));
                shown.set(DataComponents.LORE, new ItemLore(lore));
                if (amounts[inventorySlot] > 0) shown.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
                display.setItem(displaySlot, shown);
                selectedItems += amounts[inventorySlot];
            }
            for (int slot = 36; slot < 45; slot++) display.setItem(slot, icon(BLACK_PANE, " "));
            display.setItem(40, head(selected));
            display.setItem(45, icon(Items.ARROW, "Back: choose player", "Selections are discarded; no items have been taken."));
            display.setItem(46, icon(Items.BARRIER, "Clear reward selection"));
            display.setItem(49, icon(Items.PAPER, "Select items in the TOP inventory", "Left +1, right -1; shift-left selects a stack.",
                    "Only final confirmation takes items.", "Escape cancels without taking anything."));
            display.setItem(53, icon(selectedItems == 0 ? GRAY_PANE : GREEN_PANE,
                    "Submit bounty: " + selectedItems + " item(s)", "Target: " + selected.name(),
                    "These items become the reward for killing this player.", "Cancel your own unpaid bounty from My bounties."));
        }

        private void renderDetails() {
            BountyService.BountyView entry = service.activeBounties().stream()
                    .filter(value -> value.targetId().equals(detailTarget)).findFirst().orElse(null);
            List<ItemStack> rewards = entry == null ? List.of() : entry.rewards();
            pagination(rewards.size());
            for (int slot = 0, i = number * PAGE_SIZE; slot < PAGE_SIZE && i < rewards.size(); slot++, i++)
                display.setItem(slot, rewards.get(i).copy());
            if (entry == null) display.setItem(22, icon(Items.PAPER, "This bounty has already been claimed."));
            display.setItem(45, icon(Items.ARROW, "Back to bounties"));
        }

        private void renderMine() {
            if (!listLoaded) { ownBounties = service.ownedBountyGroups(owner.getUUID()); listLoaded = true; }
            pagination(ownBounties.size());
            for (int slot = 0, i = number * PAGE_SIZE; slot < PAGE_SIZE && i < ownBounties.size(); slot++, i++) {
                BountyService.OwnBountyGroup bounty = ownBounties.get(i);
                ItemStack head = head(new BountyService.Target(bounty.targetId(), bounty.targetName(), null));
                List<Component> lore = rewardLore(bounty.rewards(), 16);
                lore.add(Component.literal("Your combined bounty on this player").withStyle(ChatFormatting.GRAY));
                lore.add(Component.literal("Click to review cancellation").withStyle(ChatFormatting.YELLOW));
                head.set(DataComponents.LORE, new ItemLore(lore));
                display.setItem(slot, head);
            }
            if (ownBounties.isEmpty()) display.setItem(22, icon(Items.PAPER, "You have no active bounties", "Paid-out or cancelled bounties cannot be refunded again."));
            display.setItem(45, icon(Items.ARROW, "Back to bounties"));
        }

        private void renderCancel() {
            if (!listLoaded) {
                cancelSnapshot = service.ownedBountyGroups(owner.getUUID()).stream()
                        .filter(value -> value.targetId().equals(detailTarget)).findFirst().orElse(null);
                listLoaded = true;
            }
            BountyService.OwnBountyGroup bounty = cancelSnapshot;
            List<ItemStack> rewards = bounty == null ? List.of() : bounty.rewards();
            pagination(rewards.size());
            for (int slot = 0, i = number * PAGE_SIZE; slot < PAGE_SIZE && i < rewards.size(); slot++, i++)
                display.setItem(slot, rewards.get(i).copy());
            if (bounty == null) display.setItem(22, icon(Items.PAPER, "This bounty is no longer yours to cancel", "It may already have been paid or cancelled."));
            display.setItem(45, icon(Items.ARROW, "Keep bounty / go back", "Escape also leaves the bounty unchanged."));
            display.setItem(53, bounty == null ? icon(GRAY_PANE, "No cancellable bounty")
                    : icon(GREEN_PANE, "Confirm cancellation & refund", "Target: " + bounty.targetName(),
                    "Remove your entire bounty on this player.", "Other players' rewards are never removed.", "Return exactly the items shown above.",
                    "If your inventory is full, collect later with /bounties claim."));
        }

        private void tell(String message, boolean success) {
            owner.sendSystemMessage(Component.literal(message).withStyle(success ? ChatFormatting.GREEN : ChatFormatting.RED));
        }
    }

    private static ItemStack head(BountyService.Target target) {
        ItemStack head = icon(Items.PLAYER_HEAD, target.name());
        // Online profiles carry signed textures; offline UUIDs resolve through normal vanilla skin handling.
        var profile = target.profile();
        head.set(DataComponents.PROFILE, profile != null && !profile.properties().isEmpty()
                ? ResolvableProfile.createResolved(profile) : ResolvableProfile.createUnresolved(target.id()));
        return head;
    }

    private static ItemStack icon(Item item, String title, String... lines) {
        ItemStack stack = new ItemStack(item);
        stack.set(DataComponents.CUSTOM_NAME, Component.literal(title).withStyle(style -> style.withItalic(false).withColor(ChatFormatting.WHITE)));
        if (lines.length > 0) stack.set(DataComponents.LORE, new ItemLore(java.util.Arrays.stream(lines)
                .map(text -> (Component) Component.literal(text).withStyle(ChatFormatting.GRAY)).toList()));
        return stack;
    }

    private static List<Component> rewardLore(List<ItemStack> rewards, int limit) {
        List<Component> lines = new ArrayList<>();
        lines.add(Component.literal("Reward:").withStyle(ChatFormatting.GOLD));
        for (int i = 0; i < rewards.size() && i < limit; i++) {
            ItemStack item = rewards.get(i);
            String name = item.getHoverName().getString();
            if (name.length() > 80) name = name.substring(0, 77) + "...";
            lines.add(Component.literal(item.getCount() + " × " + name).withStyle(ChatFormatting.YELLOW));
        }
        if (rewards.size() > limit) lines.add(Component.literal("+ " + (rewards.size() - limit) + " more stacks; click to inspect").withStyle(ChatFormatting.GRAY));
        return lines;
    }
}
