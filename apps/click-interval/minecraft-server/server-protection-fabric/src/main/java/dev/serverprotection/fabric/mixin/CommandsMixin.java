package dev.serverprotection.fabric.mixin;

import dev.serverprotection.fabric.ServerProtectionFabric;
import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.protocol.game.ClientboundCommandsPacket;
import net.minecraft.server.level.ServerPlayer;
import com.mojang.brigadier.tree.RootCommandNode;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Builds the client command tree from the manager-owned role instead of stale ops.json state. */
@Mixin(Commands.class)
abstract class CommandsMixin {
    @Shadow @Final private CommandDispatcher<CommandSourceStack> dispatcher;
    @Shadow @Final private static ClientboundCommandsPacket.NodeInspector<CommandSourceStack> COMMAND_NODE_INSPECTOR;

    @Inject(method = "sendCommands", at = @At("HEAD"), cancellable = true)
    private void serverProtection$sendManagedCommandTree(ServerPlayer player, CallbackInfo callback) {
        RootCommandNode<CommandSourceStack> root = ServerProtectionFabric.buildCommandTree(
                player, dispatcher.getRoot());
        player.connection.send(new ClientboundCommandsPacket(root, COMMAND_NODE_INSPECTOR));
        callback.cancel();
    }
}
