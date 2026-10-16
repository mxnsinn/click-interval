package dev.serverteams.fabric.mixin;
import dev.serverteams.fabric.DamageAttribution;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.ServerExplosion;
import net.minecraft.world.phys.AABB;
import java.util.List;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;
@Mixin(ServerExplosion.class)
public abstract class ExplosionMixin {
    // Filter the authoritative damage AND push loop, including the client knockback packet map.
    @Redirect(method="hurtEntities",at=@At(value="INVOKE",target="Lnet/minecraft/server/level/ServerLevel;getEntities(Lnet/minecraft/world/entity/Entity;Lnet/minecraft/world/phys/AABB;)Ljava/util/List;"))
    private List<Entity> protectExplosion(ServerLevel level,Entity except,AABB bounds){var source=((ServerExplosion)(Object)this).getDamageSource();return level.getEntities(except,bounds).stream().filter(e->!(e instanceof ServerPlayer p)||!DamageAttribution.friendly(p,source)).toList();}
}
