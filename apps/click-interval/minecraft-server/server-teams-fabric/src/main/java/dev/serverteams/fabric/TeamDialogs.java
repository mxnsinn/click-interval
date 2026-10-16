package dev.serverteams.fabric;

import net.minecraft.core.Holder;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.common.ServerboundCustomClickActionPacket;
import net.minecraft.resources.Identifier;
import net.minecraft.server.dialog.*;
import net.minecraft.server.dialog.action.CustomAll;
import net.minecraft.server.dialog.body.PlainMessage;
import net.minecraft.server.dialog.input.*;
import net.minecraft.server.level.ServerPlayer;
import java.util.*;

/** Vanilla native dialogs, never containers. Opaque one-shot sessions bind every callback to its player. */
public final class TeamDialogs {
    @FunctionalInterface interface Submit { void run(CompoundTag values) throws Exception; }
    private record Choice(String label,Submit submit){}
    private record Session(UUID player,String nonce,long expires,List<Choice> actions){}
    private final TeamService service;
    private final Map<UUID,Session> sessions=new HashMap<>();
    TeamDialogs(TeamService service){this.service=service;}
    public void forget(UUID player){sessions.remove(player);}
    public void expire(long now){sessions.values().removeIf(s->s.expires<=now);}
    public void click(ServerPlayer player,ServerboundCustomClickActionPacket packet){
        Session session=sessions.get(player.getUUID());if(session==null||session.expires<=System.currentTimeMillis())return;
        String path=packet.id().getPath();String prefix=session.nonce+"/";if(!path.startsWith(prefix))return;
        int action;try{action=Integer.parseInt(path.substring(prefix.length()));}catch(NumberFormatException e){return;}
        if(action<0||action>=session.actions.size())return;
        if(packet.payload().isPresent()&&!(packet.payload().get() instanceof CompoundTag))return;
        CompoundTag data=packet.payload().filter(CompoundTag.class::isInstance).map(CompoundTag.class::cast).orElseGet(CompoundTag::new);
        // Bound both field count and strings before dispatch; all authoritative validation happens again in TeamStore.
        if(data.size()>12||data.entrySet().stream().anyMatch(e->e.getKey().length()>48||e.getValue().toString().length()>512))return;
        sessions.remove(player.getUUID());
        service.execute(player,()->session.actions.get(action).submit.run(data));
    }
    private void open(ServerPlayer player,String title,String text,List<Input> inputs,List<Choice> choices){
        if(!player.isAlive()||player.isSpectator()){TeamService.tell(player,"Open team controls while alive and outside spectator mode.",false);return;}
        String nonce=UUID.randomUUID().toString();List<ActionButton> buttons=new ArrayList<>();
        for(int i=0;i<choices.size();i++)buttons.add(new ActionButton(new CommonButtonData(Component.literal(choices.get(i).label),190),Optional.of(new CustomAll(Identifier.fromNamespaceAndPath("serverteams",nonce+"/"+i),Optional.empty()))));
        sessions.put(player.getUUID(),new Session(player.getUUID(),nonce,System.currentTimeMillis()+120_000,List.copyOf(choices)));
        var common=new CommonDialogData(Component.literal(title),Optional.empty(),true,false,DialogAction.CLOSE,List.of(new PlainMessage(Component.literal(text),390)),inputs);
        var close=new ActionButton(new CommonButtonData(Component.literal("Close"),190),Optional.empty());
        player.openDialog(Holder.direct(new MultiActionDialog(common,buttons,Optional.of(close),2)));
    }
    private static Input text(String key,String label,int length){return text(key,label,length,"");}
    private static Input text(String key,String label,int length,String initial){return new Input(key,new TextInput(300,Component.literal(label),true,initial,length,Optional.empty()));}
    private static Input options(String key,String label,List<String> values,String selected){return new Input(key,new SingleOptionInput(300,values.stream().map(v->new SingleOptionInput.Entry(v,Optional.of(Component.literal(v.replace('_',' '))),v.equals(selected))).toList(),Component.literal(label),true));}
    private static String value(CompoundTag data,String key){return data.getStringOr(key,"").trim();}
    static String trustKey(UUID player){return "trust_"+player.toString().replace("-","");}
    public void create(ServerPlayer p){
        open(p,"Create team","Create a team of up to five players including you. Choose a unique three-letter tag and a full team name.",List.of(text("name","Team name (3–32 characters)",32),text("tag","Tag (3 letters A–Z)",3),options("color","Team color",TeamStore.COLORS.stream().sorted().toList(),"aqua")),List.of(new Choice("Create team",data->{service.ensureScoreboardFree(p);service.store.create(p.getUUID(),p.getScoreboardName(),value(data,"name"),value(data,"tag"),value(data,"color"));TeamService.tell(p,"Team created.",true);hub(p);})));
    }
    public void hub(ServerPlayer p){
        TeamStore.Team team=service.store.team(p.getUUID());List<Choice> actions=new ArrayList<>();StringBuilder body=new StringBuilder();
        if(team==null){body.append("You are not in a team. Invitations expire after five minutes.\n");actions.add(new Choice("Create team",d->create(p)));
            for(TeamStore.Invite i:service.store.invitations(p.getUUID(),System.currentTimeMillis())){TeamStore.Team t=service.store.byId(i.team());if(t==null)continue;
                actions.add(new Choice("Accept ["+t.tag()+"]",d->{service.ensureScoreboardFree(p);TeamStore.require(!service.combat(p.getUUID()),"Finish combat before joining a team.");service.store.accept(p.getUUID(),p.getScoreboardName(),t.id(),System.currentTimeMillis());service.notifyTeam(t.id(),p.getScoreboardName()+" joined the team.");hub(p);}));
                actions.add(new Choice("Decline ["+t.tag()+"]",d->{service.store.decline(p.getUUID(),t.id());hub(p);}));body.append('[').append(t.tag()).append("] ").append(t.name()).append('\n');}
        }else{
            body.append('[').append(team.tag()).append("] ").append(team.name()).append("\nMembers: ").append(team.members().size()).append(" / 5\n");
            for(var member:team.members().entrySet())body.append(member.getValue()).append(member.getKey().equals(team.owner())?" (owner)":"").append('\n');
            body.append("\nPrivate chat: /tc message\nPersonal TPA trust never grants trust to the whole team.\n");
            int shown=0;for(TeamStore.Pact pact:service.store.pacts(team.id(),System.currentTimeMillis())){
                if(shown++>=16){body.append("More ceasefires: use /ceasefire commands.\n");break;}
                TeamStore.Team other=service.store.byId(pact.first().equals(team.id())?pact.second():pact.first());if(other==null)continue;
                body.append("Ceasefire [").append(other.tag()).append("]: ").append(pact.accepted()?(pact.ends()>0?"ending in "+Math.max(0,(pact.ends()-System.currentTimeMillis()+999)/1000)+"s":"active"):pact.proposer().equals(team.id())?"outgoing request":"incoming request").append('\n');
            }
            actions.add(new Choice("Personal settings",d->settings(p)));
            actions.add(new Choice("Ceasefires",d->ceasefires(p)));
            if(team.owner().equals(p.getUUID())){actions.add(new Choice("Edit team",d->edit(p)));actions.add(new Choice("Invite player",d->invite(p)));actions.add(new Choice("Manage members",d->members(p)));}
            actions.add(new Choice(team.members().size()==1?"Disband / leave":"Leave team",d->confirm(p,"Leave team",team.members().size()==1?"You are the final member. This permanently disbands the team and all ceasefires.":"Leave this team? Your personal trust relationships will be revoked.",()->{service.store.leave(p.getUUID());service.notifyTeam(team.id(),p.getScoreboardName()+" left the team.");TeamService.tell(p,"You left the team.",true);hub(p);})));
        }
        open(p,"Team hub",body.toString(),List.of(),actions);
    }
    public void edit(ServerPlayer p){
        TeamStore.Team team=service.store.owned(p.getUUID());
        open(p,"Edit team","Change the team name, three-letter tag and tag color. Members, trust and ceasefires stay unchanged.",
                List.of(text("name","Team name",32,team.name()),text("tag","Tag (3 letters A–Z)",3,team.tag()),
                        options("color","Tag color",TeamStore.COLORS.stream().sorted().toList(),team.color())),
                List.of(new Choice("Save team",data->{service.store.edit(p.getUUID(),team,value(data,"name"),value(data,"tag"),value(data,"color"));TeamService.tell(p,"Team information saved.",true);hub(p);}),
                        new Choice("Back",data->hub(p))));
    }
    public void settings(ServerPlayer p){
        TeamStore.Team team=service.store.requiredTeam(p.getUUID());List<Input> inputs=new ArrayList<>();List<Choice> actions=new ArrayList<>();
        for(var member:team.members().entrySet())if(!member.getKey().equals(p.getUUID()))inputs.add(options(trustKey(member.getKey()),"Automatically accept TPA from "+member.getValue()+"?",List.of("ask","trust"),service.store.trusts(p.getUUID(),member.getKey())?"trust":"ask"));
        inputs.add(options("alerts","Receive team attack alerts?",List.of("on","off"),service.store.alerts(p.getUUID())?"on":"off"));
        actions.add(new Choice("Save personal settings",data->{
            TeamStore.Team current=service.store.requiredTeam(p.getUUID());TeamStore.require(current.id().equals(team.id()),"Team changed; reopen settings.");
            for(UUID member:team.members().keySet())if(!member.equals(p.getUUID())&&current.members().containsKey(member)){String v=value(data,trustKey(member));TeamStore.require(v.equals("ask")||v.equals("trust"),"Invalid trust selection.");}
            String alerts=value(data,"alerts");TeamStore.require(alerts.equals("on")||alerts.equals("off"),"Invalid alerts selection.");
            Map<UUID,Boolean> trust=new HashMap<>();for(UUID member:team.members().keySet())if(!member.equals(p.getUUID())&&current.members().containsKey(member))trust.put(member,value(data,trustKey(member)).equals("trust"));
            service.store.settings(p.getUUID(),team.id(),trust,alerts.equals("on"));TeamService.tell(p,"Your personal trust and alerts were saved.",true);hub(p);
        }));
        open(p,"Personal team settings","Trust is directional: YOU allow selected teammates to teleport to YOU without accepting each TPA. They must still trust you separately. Combat/teleport safety checks still apply. Leaving or being kicked revokes trust.",inputs,actions);
    }
    private void invite(ServerPlayer p){invite(p,0);}
    private void invite(ServerPlayer p,int requestedPage){
        TeamStore.Team team=service.store.owned(p.getUUID());
        List<ServerPlayer> candidates=service.server.getPlayerList().getPlayers().stream()
                .filter(target->!target.getUUID().equals(p.getUUID())&&service.store.team(target.getUUID())==null)
                .sorted(Comparator.comparing(ServerPlayer::getScoreboardName,String.CASE_INSENSITIVE_ORDER)).toList();
        int pages=Math.max(1,(candidates.size()+11)/12),page=Math.max(0,Math.min(requestedPage,pages-1));
        List<Choice> choices=new ArrayList<>();
        for(ServerPlayer candidate:candidates.subList(page*12,Math.min(candidates.size(),(page+1)*12))){
            UUID targetId=candidate.getUUID();String name=candidate.getScoreboardName();
            choices.add(new Choice(name,data->{
                TeamStore.require(service.store.owned(p.getUUID()).id().equals(team.id()),"Team changed; reopen invitations.");
                ServerPlayer target=service.server.getPlayerList().getPlayer(targetId);
                TeamStore.require(target!=null,"That player is no longer online.");
                service.ensureScoreboardFree(target);
                service.store.invite(p.getUUID(),targetId,System.currentTimeMillis());
                TeamStore.Team current=service.store.requiredTeam(p.getUUID());
                TeamCommands.sendInvitation(target,current);
                TeamService.tell(p,"Invitation sent to "+target.getScoreboardName()+".",true);hub(p);
            }));
        }
        if(page>0)choices.add(new Choice("Previous page",data->invite(p,page-1)));
        if(page+1<pages)choices.add(new Choice("Next page",data->invite(p,page+1)));
        choices.add(new Choice("Refresh",data->invite(p,page)));
        choices.add(new Choice("Back",data->hub(p)));
        open(p,"Invite teammate",candidates.isEmpty()?"No eligible players are online. Refresh when someone joins.":
                "Select a player to invite. Page "+(page+1)+" / "+pages+". They can accept or decline in /team.",List.of(),choices);
    }
    private void members(ServerPlayer p){
        TeamStore.Team team=service.store.owned(p.getUUID());List<Choice> choices=new ArrayList<>();
        for(var member:team.members().entrySet())if(!member.getKey().equals(p.getUUID())){
            choices.add(new Choice("Kick "+member.getValue(),d->confirm(p,"Kick teammate","Remove "+member.getValue()+" from the team and revoke their trust?",()->{service.store.kick(p.getUUID(),member.getKey());ServerPlayer target=service.server.getPlayerList().getPlayer(member.getKey());if(target!=null)TeamService.tell(target,"You were removed from ["+team.tag()+"].",false);hub(p);})));
            choices.add(new Choice("Transfer to "+member.getValue(),d->confirm(p,"Transfer ownership","Make "+member.getValue()+" the owner? You remain a member. Pending ceasefire requests are cancelled; accepted ceasefires remain.",()->{service.store.transfer(p.getUUID(),member.getKey());service.notifyTeam(team.id(),member.getValue()+" is now team owner.");hub(p);})));
        }
        if(choices.isEmpty())choices.add(new Choice("Invite player",d->invite(p)));
        open(p,"Manage teammates","Only the owner can invite, kick, transfer ownership, or manage ceasefires. Transfer ownership before leaving a team with other members.",List.of(),choices);
    }
    private void ceasefires(ServerPlayer p){
        service.store.owned(p.getUUID());open(p,"Pairwise ceasefires","Each tag is a separate agreement with your team, not an alliance between all targets. Target owners accept individually. Accepted ceasefires last until an owner ends them with 30 seconds' notice. Acceptance is blocked while either roster is combat-tagged.",List.of(text("tags","Team tags, separated by spaces",39),options("action","Action",List.of("request","accept","decline","cancel","end"),"request")),List.of(new Choice("Apply to these tags",data->{service.ceasefire(p,value(data,"action"),value(data,"tags"));hub(p);})));
    }
    private void confirm(ServerPlayer p,String title,String text,TeamService.Mutation action){open(p,title,text,List.of(),List.of(new Choice("Confirm",d->action.run()),new Choice("Back",d->hub(p))));}
}
