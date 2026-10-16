package dev.serverteams.fabric.mixin;
import dev.serverteams.fabric.ServerTeams;
import net.minecraft.network.protocol.common.ServerboundCustomClickActionPacket;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(ServerCommonPacketListenerImpl.class)
public abstract class DialogClickMixin {
    // After vanilla's packet-thread check, not HEAD: only the authenticated game connection can dispatch.
    @Inject(method="handleCustomClickAction",at=@At(value="INVOKE",target="Lnet/minecraft/server/MinecraftServer;handleCustomClickAction(Lnet/minecraft/resources/Identifier;Ljava/util/Optional;)V"),cancellable=true)
    private void teamsClick(ServerboundCustomClickActionPacket packet,CallbackInfo ci){
        if(!packet.id().getNamespace().equals("serverteams"))return;
        if((Object)this instanceof ServerGamePacketListenerImpl connection&&ServerTeams.current()!=null)ServerTeams.current().dialogClick(connection.player,packet);
        ci.cancel();
    }
}
