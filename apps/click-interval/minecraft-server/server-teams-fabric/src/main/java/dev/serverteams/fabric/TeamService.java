package dev.serverteams.fabric;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.TeamColor;
import net.minecraft.world.level.storage.LevelResource;
import java.io.IOException;
import java.lang.reflect.Method;
import java.util.*;

public final class TeamService {
    public final TeamStore store;
    final MinecraftServer server;
    final TeamDialogs dialogs;
    private long visualRevision=-1;
    private final Map<UUID,Long> lastChat=new HashMap<>(), lastAlert=new HashMap<>(), combatUntil=new HashMap<>(), commandUntil=new HashMap<>();
    private final Method externalCombat;
    private final boolean brokenCombatBridge;
    TeamService(MinecraftServer server) throws IOException {
        this.server=server;
        store=new TeamStore(server.getWorldPath(LevelResource.ROOT).resolve("data/serverteams/teams.json"));
        dialogs=new TeamDialogs(this);
        Method method=null;boolean broken=false;
        try { method=Class.forName("dev.serverteleport.fabric.ServerTeleportFabric").getMethod("isPvpTagged",UUID.class); }
        catch(ClassNotFoundException absent) { }
        catch(ReflectiveOperationException e) { broken=true;ServerTeams.LOGGER.warn("Installed teleport module lacks combat bridge; ceasefire activation will fail closed until it is updated"); }
        externalCombat=method;brokenCombatBridge=broken;
    }
    @FunctionalInterface public interface Mutation { void run() throws Exception; }
    public void execute(ServerPlayer actor,Mutation action) {
        try { TeamStore.require(actor.isAlive()&&!actor.isSpectator(),"Use team controls while alive and outside spectator mode.");action.run();refresh(); }
        catch(IllegalArgumentException e){tell(actor,e.getMessage(),false);}
        catch(Exception e){ServerTeams.LOGGER.error("Team operation failed; prior committed state preserved",e);tell(actor,"Team storage is unavailable. Your change was not completed.",false);}
    }
    public boolean throttle(ServerPlayer p) {
        long now=System.currentTimeMillis();Long until=commandUntil.get(p.getUUID());if(until!=null&&until>now)return false;
        commandUntil.put(p.getUUID(),now+300);return true;
    }
    public void dialogClick(ServerPlayer player,net.minecraft.network.protocol.common.ServerboundCustomClickActionPacket packet){dialogs.click(player,packet);}
    public boolean combat(UUID id) {
        if(brokenCombatBridge)return true;
        if(combatUntil.getOrDefault(id,0L)>System.currentTimeMillis())return true;
        if(externalCombat==null)return false;
        try{return Boolean.TRUE.equals(externalCombat.invoke(null,id));}catch(ReflectiveOperationException e){return true;}
    }
    void ensureScoreboardFree(ServerPlayer player) {
        PlayerTeam team=server.getScoreboard().getPlayersTeam(player.getScoreboardName());
        TeamStore.require(team==null || managed(team),"An administrator-assigned scoreboard team already exists. Ask an administrator before joining a player team.");
    }
    public void onJoin(ServerPlayer p) { try{store.renamePlayer(p.getUUID(),p.getScoreboardName());}catch(IOException e){ServerTeams.LOGGER.error("Could not update teammate display name",e);}refresh(); if(!store.invitations(p.getUUID(),System.currentTimeMillis()).isEmpty())tell(p,"You have team invitations. Open /team.",true); }
    public void disconnect(UUID id) {dialogs.forget(id);lastChat.remove(id);lastAlert.remove(id);commandUntil.remove(id);}
    public void clearCombatAfterDeath(UUID id){combatUntil.remove(id);lastAlert.remove(id);}
    public void tick() {
        long now=System.currentTimeMillis();
        try {for(TeamStore.Pact pact:store.expire(now))notifyPact(pact.first(),pact.second(),"Ceasefire ended. PvP between these two teams is now enabled.");}
        catch(IOException e){ServerTeams.LOGGER.error("Could not expire team requests",e);}
        combatUntil.values().removeIf(t->t<=now);dialogs.expire(now);refresh();
    }
    public void ceasefire(ServerPlayer actor,String operation,String raw) {
        execute(actor,()->{
            TeamStore.Team own=store.owned(actor.getUUID());
            String[] tags=raw.trim().toUpperCase(Locale.ROOT).split("\\s+");
            TeamStore.require(tags.length>0&&tags.length<=10,"Choose 1–10 team tags.");
            Set<String> distinct=new LinkedHashSet<>(List.of(tags));
            for(String tag:distinct){
                try{
                    TeamStore.Team target=store.tag(tag);TeamStore.require(target!=null,"Unknown team tag: "+tag);
                    switch(operation){
                        case "request" -> store.propose(actor.getUUID(),tag,System.currentTimeMillis());
                        case "accept" -> store.acceptPact(actor.getUUID(),tag,System.currentTimeMillis(),this::combat);
                        case "decline" -> store.declinePact(actor.getUUID(),tag,System.currentTimeMillis());
                        case "cancel" -> store.cancelPact(actor.getUUID(),tag,System.currentTimeMillis());
                        case "end" -> store.end(actor.getUUID(),tag,System.currentTimeMillis());
                        default -> throw new IllegalArgumentException("Unknown ceasefire action.");
                    }
                    String text=switch(operation){
                        case "request" -> "["+own.tag()+"] requests a ceasefire with ["+tag+"]. Target owner: /ceasefire accept "+own.tag()+" or /ceasefire decline "+own.tag()+" (5 minutes).";
                        case "accept" -> "Ceasefire ["+own.tag()+"] ↔ ["+tag+"] accepted. Lasts until an owner uses /ceasefire end TAG.";
                        case "end" -> "Ceasefire ["+own.tag()+"] ↔ ["+tag+"] ends in 30 seconds. Protection remains until then.";
                        default -> "Ceasefire request ["+own.tag()+"] ↔ ["+tag+"] "+(operation.equals("cancel")?"cancelled.":"declined.");
                    };
                    notifyPact(own.id(),target.id(),text);
                }catch(IllegalArgumentException e){tell(actor,e.getMessage(),false);}
            }
        });
    }
    public void chat(ServerPlayer actor,String text) {
        execute(actor,()->{
            TeamStore.Team team=store.requiredTeam(actor.getUUID());long now=System.currentTimeMillis();
            TeamStore.require(now-lastChat.getOrDefault(actor.getUUID(),0L)>=750,"Please slow down team chat.");
            TeamStore.require(text!=null&&!text.isBlank()&&text.length()<=256&&text.codePoints().noneMatch(c->Character.isISOControl(c)||c==167),"Use 1–256 ordinary text characters.");
            lastChat.put(actor.getUUID(),now);
            Component message=Component.literal("[Team "+team.tag()+"] ").withStyle(color(team)).append(Component.literal(actor.getScoreboardName()+": "+text).withStyle(ChatFormatting.WHITE));
            for(UUID member:team.members().keySet()){ServerPlayer p=server.getPlayerList().getPlayer(member);if(p!=null)p.sendSystemMessage(message);}
        });
    }
    public void onDamage(ServerPlayer victim,UUID attacker,float damage,boolean blocked) {
        if(attacker==null||attacker.equals(victim.getUUID())||blocked||damage<=0||store.friendly(victim.getUUID(),attacker,System.currentTimeMillis()))return;
        long now=System.currentTimeMillis();combatUntil.put(victim.getUUID(),now+15_000);combatUntil.put(attacker,now+15_000);
        TeamStore.Team team=store.team(victim.getUUID());if(team==null||now-lastAlert.getOrDefault(victim.getUUID(),0L)<10_000)return;
        lastAlert.put(victim.getUUID(),now);
        ServerPlayer other=server.getPlayerList().getPlayer(attacker);
        String opponent=other==null?"an opponent":other.getScoreboardName();
        for(UUID member:team.members().keySet()){ServerPlayer p=server.getPlayerList().getPlayer(member);if(p!=null&&store.alerts(member))tell(p,"[Team alert] "+victim.getScoreboardName()+" was hit by "+opponent+".",false);}
    }
    void notifyTeam(UUID id,String message){TeamStore.Team team=store.byId(id);if(team!=null)for(UUID member:team.members().keySet()){ServerPlayer p=server.getPlayerList().getPlayer(member);if(p!=null)tell(p,message,true);}}
    void notifyPact(UUID a,UUID b,String text){notifyTeam(a,text);notifyTeam(b,text);}
    static ChatFormatting color(TeamStore.Team t){return ChatFormatting.valueOf(t.color().toUpperCase(Locale.ROOT));}
    static Component tagPrefix(TeamStore.Team t){return Component.literal("["+t.tag()+"]").withStyle(color(t)).append(Component.literal(" ").withStyle(ChatFormatting.WHITE));}
    static Component tabLabel(TeamStore.Team t,String player){return Component.empty().withStyle(ChatFormatting.WHITE).append(tagPrefix(t)).append(Component.literal(player).withStyle(ChatFormatting.WHITE));}
    public Component tabName(ServerPlayer p){TeamStore.Team t=store.team(p.getUUID());return t==null?null:tabLabel(t,p.getScoreboardName());}
    private String scoreId(TeamStore.Team t){return "st_"+t.id().toString().replace("-","");}
    private boolean managed(PlayerTeam team){return store.teams().stream().anyMatch(t->scoreId(t).equals(team.getName()));}
    void refresh(){
        if(visualRevision==store.revision())return;
        var board=server.getScoreboard();Set<String> ids=new HashSet<>();
        for(TeamStore.Team t:store.teams()){
            String id=scoreId(t);ids.add(id);PlayerTeam team=board.getPlayerTeam(id);if(team==null)team=board.addPlayerTeam(id);
            team.setDisplayName(Component.literal(t.name()));team.setPlayerPrefix(tagPrefix(t));team.setColor(Optional.of(TeamColor.WHITE));team.setAllowFriendlyFire(false);
            Set<String> wanted=new HashSet<>(t.members().values());
            for(String old:List.copyOf(team.getPlayers()))if(!wanted.contains(old))board.removePlayerFromTeam(old,team);
            for(String name:wanted){PlayerTeam existing=board.getPlayersTeam(name);if(existing==null||existing==team||managed(existing))board.addPlayerToTeam(name,team);}
        }
        // Namespace includes a full random UUID. Never delete an arbitrary vanilla/admin team.
        for(PlayerTeam team:List.copyOf(board.getPlayerTeams()))if(team.getName().matches("st_[0-9a-f]{32}")&&!ids.contains(team.getName()))board.removePlayerTeam(team);
        visualRevision=store.revision();
        var players=server.getPlayerList().getPlayers();if(!players.isEmpty())server.getPlayerList().broadcastAll(new ClientboundPlayerInfoUpdatePacket(EnumSet.of(ClientboundPlayerInfoUpdatePacket.Action.UPDATE_DISPLAY_NAME),players));
    }
    public static void tell(ServerPlayer p,String message,boolean good){p.sendSystemMessage(Component.literal(message).withStyle(good?ChatFormatting.GREEN:ChatFormatting.RED));}
}
