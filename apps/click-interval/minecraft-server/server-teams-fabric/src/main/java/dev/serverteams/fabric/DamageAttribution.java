package dev.serverteams.fabric;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.OwnableEntity;
import net.minecraft.world.entity.TraceableEntity;
import net.minecraft.world.entity.projectile.Projectile;
import java.util.UUID;
/** Only authoritative ownership is used; source-less/environmental explosions remain unchanged. */
public final class DamageAttribution {
    private DamageAttribution(){}
    public static UUID player(DamageSource source){UUID id=player(source.getEntity());return id!=null?id:player(source.getDirectEntity());}
    public static UUID player(Entity entity){
        for(int depth=0;depth<8&&entity!=null;depth++){
            if(entity instanceof ServerPlayer p)return p.getUUID();
            if(entity instanceof OwnableEntity pet){var ref=pet.getOwnerReference();Entity owner=pet.getOwner();if(owner==null)return ref==null?null:ref.getUUID();entity=owner;}
            else if(entity instanceof TraceableEntity traceable)entity=traceable.getOwner();else return null;
        }return null;
    }
    public static boolean friendly(ServerPlayer victim,DamageSource source){return TeamApi.isFriendly(victim.getUUID(),player(source));}
    public static boolean friendly(Entity victim,Entity attacker){return victim instanceof ServerPlayer p&&TeamApi.isFriendly(p.getUUID(),player(attacker));}
}
