package dev.serverteams.fabric;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.entity.event.v1.ServerPlayerEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
public final class ServerTeams implements ModInitializer {
    public static final Logger LOGGER=LoggerFactory.getLogger("serverteams_fabric");
    private static volatile TeamService current;
    public static TeamService current(){return current;}
    @Override public void onInitialize(){
        CommandRegistrationCallback.EVENT.register((dispatcher,context,environment)->TeamCommands.register(dispatcher));
        ServerLifecycleEvents.SERVER_STARTED.register(server->{try{current=new TeamService(server);current.refresh();LOGGER.info("Server Teams 1.0.4 ready: direct commands and optional native dialogs, five-member teams, directional TPA trust, pairwise ceasefires");}catch(Exception e){LOGGER.error("Teams disabled; existing team data NOT reset",e);}});
        ServerLifecycleEvents.SERVER_STOPPED.register(server->current=null);
        ServerTickEvents.END_SERVER_TICK.register(server->{if(current!=null&&server.getTickCount()%20==0)current.tick();});
        ServerPlayConnectionEvents.JOIN.register((handler,sender,server)->{if(current!=null)current.onJoin(handler.getPlayer());});
        ServerPlayConnectionEvents.DISCONNECT.register((handler,server)->{if(current!=null)current.disconnect(handler.getPlayer().getUUID());});
        ServerLivingEntityEvents.ALLOW_DAMAGE.register((entity,source,amount)->!(entity instanceof ServerPlayer player)||!DamageAttribution.friendly(player,source));
        ServerLivingEntityEvents.AFTER_DAMAGE.register((entity,source,base,taken,blocked)->{if(current!=null&&entity instanceof ServerPlayer victim)current.onDamage(victim,DamageAttribution.player(source),taken,blocked);});
        ServerLivingEntityEvents.AFTER_DEATH.register((entity,source)->{if(current!=null&&entity instanceof ServerPlayer p)current.clearCombatAfterDeath(p.getUUID());});
        ServerPlayerEvents.AFTER_RESPAWN.register((oldPlayer,newPlayer,alive)->{if(current!=null)current.clearCombatAfterDeath(newPlayer.getUUID());});
    }
}
