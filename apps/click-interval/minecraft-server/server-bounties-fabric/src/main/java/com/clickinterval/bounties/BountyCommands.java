package com.clickinterval.bounties;

import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

public final class BountyCommands {
    private BountyCommands() { }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("bounties")
                .executes(context -> open(context.getSource(), false))
                .then(Commands.literal("set").executes(context -> open(context.getSource(), true)))
                .then(Commands.literal("mine").executes(context -> mine(context.getSource())))
                .then(Commands.literal("remove").executes(context -> mine(context.getSource())))
                .then(Commands.literal("claim").executes(context -> {
                    ServerPlayer player = context.getSource().getPlayerOrException();
                    BountyService service = ServerBounties.service(context.getSource().getServer());
                    if (service == null) return unavailable(context.getSource());
                    BountyService.Result result = service.claim(player);
                    player.sendSystemMessage(Component.literal(result.message()));
                    return result.success() ? 1 : 0;
                })));
        dispatcher.register(Commands.literal("setbounty").executes(context -> open(context.getSource(), true)));
    }

    private static int open(CommandSourceStack source, boolean setting) throws com.mojang.brigadier.exceptions.CommandSyntaxException {
        ServerPlayer player = source.getPlayerOrException();
        BountyService service = ServerBounties.service(source.getServer());
        if (service == null) return unavailable(source);
        if (!player.isAlive() || player.isSpectator()) {
            source.sendFailure(Component.literal("Open bounties while alive and outside spectator mode."));
            return 0;
        }
        if (setting) BountyMenus.openTargets(player, service);
        else BountyMenus.openBoard(player, service);
        return 1;
    }

    private static int unavailable(CommandSourceStack source) {
        source.sendFailure(Component.literal("Bounties are temporarily unavailable. No items were taken."));
        return 0;
    }

    private static int mine(CommandSourceStack source) throws com.mojang.brigadier.exceptions.CommandSyntaxException {
        ServerPlayer player = source.getPlayerOrException();
        BountyService service = ServerBounties.service(source.getServer());
        if (service == null) return unavailable(source);
        if (!player.isAlive() || player.isSpectator()) {
            source.sendFailure(Component.literal("Open bounties while alive and outside spectator mode."));
            return 0;
        }
        BountyMenus.openMine(player, service);
        return 1;
    }
}
