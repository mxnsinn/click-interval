package dev.serverteams.fabric;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.tree.CommandNode;
import dev.serverteams.fabric.mixin.CommandNodeAccessor;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import java.util.function.Predicate;
import java.util.Locale;
import java.util.UUID;
public final class TeamCommands {
    private TeamCommands(){}
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher){
        CommandNode<CommandSourceStack> vanilla=dispatcher.getRoot().getChild("team");
        if(vanilla!=null){
            Predicate<CommandSourceStack> rootGate=vanilla.getRequirement();
            for(CommandNode<CommandSourceStack> child:vanilla.getChildren()){
                Predicate<CommandSourceStack> gate=child.getRequirement();
                ((CommandNodeAccessor<CommandSourceStack>)(Object)child).serverteams$requirement(s->rootGate.test(s)&&gate.test(s));
            }
            ((CommandNodeAccessor<CommandSourceStack>)(Object)vanilla).serverteams$requirement(s->true);
        }
        dispatcher.register(Commands.literal("team").executes(c->open(c.getSource(),"hub"))
            .then(Commands.literal("hub").executes(c->open(c.getSource(),"hub")))
            .then(Commands.literal("settings").executes(c->open(c.getSource(),"settings"))));
        dispatcher.register(Commands.literal("create").then(Commands.literal("team").executes(c->open(c.getSource(),"create"))));
        dispatcher.register(Commands.literal("tc").then(Commands.argument("message",StringArgumentType.greedyString()).executes(c->{var s=service(c.getSource());if(s==null)return 0;s.chat(c.getSource().getPlayerOrException(),StringArgumentType.getString(c,"message"));return 1;})));
        var ceasefire=Commands.literal("ceasefire").executes(c->{c.getSource().sendSuccess(()->Component.literal("/ceasefire TAG TAG... | /ceasefire accept|decline|cancel|end TAG... (owner only)"),false);return 1;});
        ceasefire.then(Commands.argument("tags",StringArgumentType.greedyString()).executes(c->pact(c.getSource(),"request",StringArgumentType.getString(c,"tags"))));
        for(String op:new String[]{"accept","decline","cancel","end"})ceasefire.then(Commands.literal(op).then(Commands.argument("tags",StringArgumentType.greedyString()).executes(c->pact(c.getSource(),op,StringArgumentType.getString(c,"tags")))));
        dispatcher.register(ceasefire);
        TeamCommandRoutes.register(dispatcher, TeamCommands::command,(context,builder)->{
            var names=new java.util.TreeSet<String>(String.CASE_INSENSITIVE_ORDER);
            for(var player:context.getSource().getServer().getPlayerList().getPlayers())names.add(player.getScoreboardName());
            var service=ServerTeams.current();var player=context.getSource().getPlayer();
            if(service!=null&&player!=null){var team=service.store.team(player.getUUID());if(team!=null)names.addAll(team.members().values());}
            return net.minecraft.commands.SharedSuggestionProvider.suggest(names,builder);
        });
    }
    private static int command(CommandSourceStack source,String action,String value,String extra)throws com.mojang.brigadier.exceptions.CommandSyntaxException{
        ServerPlayer player=source.getPlayerOrException();TeamService s=service(source);
        if(s==null||!s.throttle(player))return 0;
        boolean[] completed={false};
        s.execute(player,()->{
            UUID id=player.getUUID();long now=System.currentTimeMillis();
            switch(action){
                case "help" -> TeamService.tell(player,"Teams: /create;team TAG [name], /team;invite Player, /teams accept TAG, /teams decline TAG, /teams list, /teams leave. Owner: /teams kick Player, /teams transfer Player, /teams disband TAG confirm. Edit: /teams name NAME, /teams tag TAG, /teams color COLOR. Personal: /teams trust Player on|off, /teams alerts on|off. /team still opens the optional native menu.",true);
                case "hub" -> s.dialogs.hub(player);
                case "settings" -> s.dialogs.settings(player);
                case "list","invites" -> {
                    TeamStore.Team team=s.store.team(id);
                    if(action.equals("list"))TeamService.tell(player,team==null?"You are not in a team.":"["+team.tag()+"] "+team.name()+" — "+String.join(", ",team.members().values()),true);
                    var invitations=s.store.invitations(id,now);
                    if(invitations.isEmpty())TeamService.tell(player,"No pending team invitations.",true);
                    for(var invitation:invitations){var invited=s.store.byId(invitation.team());if(invited!=null)sendInvitation(player,invited);}
                }
                case "create" -> {
                    s.ensureScoreboardFree(player);TeamStore.require(!s.combat(id),"Finish combat before creating a team.");
                    String tag=value.toUpperCase(Locale.ROOT);
                    s.store.create(id,player.getScoreboardName(),extra.isBlank()?"Team "+tag:extra,tag,"aqua");
                    TeamService.tell(player,"Created ["+tag+"]. Invite a player with /team;invite Player.",true);
                }
                case "invite" -> {
                    TeamStore.Team team=s.store.owned(id);
                    TeamStore.require(value.matches("[A-Za-z0-9_]{1,16}"),"Enter one online player name.");
                    ServerPlayer target=s.server.getPlayerList().getPlayerByName(value);
                    TeamStore.require(target!=null,"That player is not online.");
                    s.ensureScoreboardFree(target);s.store.invite(id,target.getUUID(),now);
                    sendInvitation(target,team);
                    TeamService.tell(player,"Invitation sent to "+target.getScoreboardName()+".",true);
                }
                case "accept","decline" -> {
                    String tag=value;
                    if(tag.isBlank()){var invites=s.store.invitations(id,now);TeamStore.require(invites.size()==1,"Use /teams invites, then /teams accept TAG.");var invited=s.store.byId(invites.getFirst().team());TeamStore.require(invited!=null,"Invitation is no longer available.");tag=invited.tag();}
                    TeamStore.Team team=s.store.tag(tag);TeamStore.require(team!=null,"Unknown team tag.");
                    if(action.equals("accept")){s.ensureScoreboardFree(player);TeamStore.require(!s.combat(id),"Finish combat before joining a team.");s.store.accept(id,player.getScoreboardName(),team.id(),now);s.notifyTeam(team.id(),player.getScoreboardName()+" joined the team.");}
                    else{s.store.decline(id,team.id());TeamService.tell(player,"Declined ["+team.tag()+"].",true);}
                }
                case "leave" -> {
                    TeamStore.Team team=s.store.requiredTeam(id);
                    TeamStore.require(team.members().size()>1,"You are the last member. To disband, use /teams disband "+team.tag()+" confirm.");
                    s.store.leave(id);s.notifyTeam(team.id(),player.getScoreboardName()+" left the team.");TeamService.tell(player,"You left ["+team.tag()+"].",true);
                }
                case "disband-help" -> TeamService.tell(player,"Disbanding removes the whole team, invitations, trust and ceasefires. Owner only: /teams disband TAG confirm.",false);
                case "disband" -> {
                    TeamStore.Team team=s.store.owned(id);s.store.disband(id,value);
                    for(UUID member:team.members().keySet()){ServerPlayer target=s.server.getPlayerList().getPlayer(member);if(target!=null)TeamService.tell(target,"["+team.tag()+"] was disbanded by its owner.",true);}
                }
                case "kick","transfer","trust" -> {
                    TeamStore.Team team=action.equals("trust")?s.store.requiredTeam(id):s.store.owned(id);
                    UUID target=team.members().entrySet().stream().filter(entry->entry.getValue().equalsIgnoreCase(value)).map(java.util.Map.Entry::getKey).findFirst().orElse(null);
                    TeamStore.require(target!=null,"Choose a current teammate by player name.");
                    if(action.equals("kick")){s.store.kick(id,target);ServerPlayer kicked=s.server.getPlayerList().getPlayer(target);if(kicked!=null)TeamService.tell(kicked,"You were removed from ["+team.tag()+"].",false);s.notifyTeam(team.id(),value+" was removed from the team.");}
                    else if(action.equals("transfer")){s.store.transfer(id,target);s.notifyTeam(team.id(),value+" is now the team owner.");}
                    else{s.store.trust(id,target,extra.equals("on"));TeamService.tell(player,"Your TPA trust for "+value+" is "+extra+".",true);}
                }
                case "alerts" -> {s.store.alerts(id,value.equals("on"));TeamService.tell(player,"Your team attack alerts are "+value+".",true);}
                case "name","tag","color" -> {
                    TeamStore.Team team=s.store.owned(id);
                    s.store.edit(id,team,action.equals("name")?value:team.name(),action.equals("tag")?value:team.tag(),action.equals("color")?value.toLowerCase(Locale.ROOT):team.color());
                    s.notifyTeam(team.id(),"Team information updated.");
                }
                default -> throw new IllegalArgumentException("Unknown team action.");
            }
            completed[0]=true;
        });
        return completed[0]?1:0;
    }
    static Component invitationMessage(TeamStore.Team team){
        return Component.literal("["+team.tag()+"] "+team.name()+" invited you. ")
            .append(Component.literal("[Accept]").withStyle(s->s.withColor(net.minecraft.ChatFormatting.GREEN)
                .withClickEvent(new net.minecraft.network.chat.ClickEvent.RunCommand("/teams accept "+team.tag()))))
            .append(Component.literal(" "))
            .append(Component.literal("[Decline]").withStyle(s->s.withColor(net.minecraft.ChatFormatting.RED)
                .withClickEvent(new net.minecraft.network.chat.ClickEvent.RunCommand("/teams decline "+team.tag()))))
            .append(Component.literal(" (expires in 5 minutes)"));
    }
    static void sendInvitation(ServerPlayer player,TeamStore.Team team){player.sendSystemMessage(invitationMessage(team));}
    private static TeamService service(CommandSourceStack source){TeamService s=ServerTeams.current();if(s==null)source.sendFailure(Component.literal("Teams are unavailable; existing data was not reset."));return s;}
    private static int open(CommandSourceStack source,String page)throws com.mojang.brigadier.exceptions.CommandSyntaxException{ServerPlayer p=source.getPlayerOrException();TeamService s=service(source);if(s==null||!s.throttle(p))return 0;s.execute(p,()->{switch(page){case "create"->s.dialogs.create(p);case "settings"->s.dialogs.settings(p);default->s.dialogs.hub(p);}});return 1;}
    private static int pact(CommandSourceStack source,String op,String tags)throws com.mojang.brigadier.exceptions.CommandSyntaxException{ServerPlayer p=source.getPlayerOrException();TeamService s=service(source);if(s==null||!s.throttle(p))return 0;s.ceasefire(p,op,tags);return 1;}
}
