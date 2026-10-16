package dev.serverteams.fabric;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;
import java.util.function.Predicate;

/** Thread-confined state machine. Commit-before-publish prevents half-applied membership and trust. */
public final class TeamStore {
    public static final int CAP = 5;
    static final int MAX_STATE_BYTES=16*1024*1024, MAX_TEAMS=4096, MAX_INVITES=4096, MAX_PACTS=8192;
    public static final long INVITE_MS = 300_000, NOTICE_MS = 30_000;
    public static final Set<String> COLORS = Set.of("dark_blue", "dark_green", "dark_aqua", "dark_red", "dark_purple", "gold", "gray", "blue", "green", "aqua", "red", "light_purple", "yellow", "white");
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    public record Team(UUID id, String name, String tag, String color, UUID owner, Map<UUID,String> members) { }
    public record Invite(UUID team, UUID recipient, long expires) { }
    public record Pact(UUID first, UUID second, UUID proposer, boolean accepted, long expires, long ends) { }
    static final class State {
        int schema = 1;
        long revision;
        Map<UUID,Team> teams = new LinkedHashMap<>();
        Map<String,Invite> invites = new LinkedHashMap<>();
        Map<String,Pact> pacts = new LinkedHashMap<>();
        Map<UUID,Set<UUID>> trusts = new LinkedHashMap<>();
        Set<UUID> mutedAlerts = new HashSet<>();
        // Derived immutable index, never persisted. Published with its exact committed State.
        transient Map<UUID,UUID> memberTeams = Map.of();
    }
    private final Path file;
    private volatile State state;
    public TeamStore(Path file) throws IOException {
        this.file = file;
        // Do not silently reset or roll back membership from a backup. Corruption disables the module.
        if(Files.exists(file)&&Files.size(file)>MAX_STATE_BYTES)throw new IOException("Team state exceeds 16 MiB safety limit");
        state = Files.exists(file) ? decode(Files.readString(file)) : new State();
        validate(state);
        indexMembers(state);
    }
    private static State decode(String text) throws IOException {
        try { State result = JSON.fromJson(text, State.class); validate(result); return result; }
        catch (RuntimeException e) { throw new IOException("Invalid team state; preserve file and restore verified backup manually", e); }
    }
    public long revision() { return state.revision; }
    private static Team snapshot(Team t){return t==null?null:new Team(t.id,t.name,t.tag,t.color,t.owner,Map.copyOf(t.members));}
    public Collection<Team> teams() { return state.teams.values().stream().map(TeamStore::snapshot).toList(); }
    public Team team(UUID player) { State current=state;return player==null?null:snapshot(current.teams.get(current.memberTeams.get(player))); }
    public Team tag(String tag) { return state.teams.values().stream().filter(t -> t.tag.equalsIgnoreCase(tag)).map(TeamStore::snapshot).findFirst().orElse(null); }
    public Team byId(UUID id) { return snapshot(state.teams.get(id)); }
    public List<Invite> invitations(UUID player, long now) { return state.invites.values().stream().filter(i -> i.recipient.equals(player) && i.expires > now).toList(); }
    public List<Pact> pacts(UUID team, long now) { return state.pacts.values().stream().filter(p -> (p.first.equals(team) || p.second.equals(team)) && (p.accepted || p.expires > now)).toList(); }
    public boolean trusts(UUID recipient, UUID requester) {
        if(recipient==null||requester==null||recipient.equals(requester))return false;
        State current=state;UUID a=current.memberTeams.get(recipient),b=current.memberTeams.get(requester);
        return a!=null&&a.equals(b)&&current.trusts.getOrDefault(recipient,Set.of()).contains(requester);
    }
    public boolean friendly(UUID a, UUID b, long now) {
        if(a == null || b == null || a.equals(b)) return false;
        State current=state;UUID x=current.memberTeams.get(a),y=current.memberTeams.get(b);
        if(x==null || y==null) return false;
        if(x.equals(y)) return true;
        if(current.pacts.isEmpty())return false;
        Pact p=current.pacts.get(pair(x,y));
        return p!=null && p.accepted && (p.ends==0 || p.ends>now);
    }
    public boolean alerts(UUID player) { return !state.mutedAlerts.contains(player); }
    public Map<String,Set<UUID>> mentionGroups() {
        Map<String,Set<UUID>> result=new LinkedHashMap<>();
        for(Team team:state.teams.values()) { Set<UUID> ids=Set.copyOf(team.members.keySet()); result.put(team.tag,ids); result.put(team.name,ids); }
        return Collections.unmodifiableMap(result);
    }
    public void create(UUID owner,String playerName,String name,String tag,String color) throws IOException {
        require(team(owner)==null,"Leave your current team first.");
        name=name.trim(); tag=tag.toUpperCase(Locale.ROOT);
        require(name.matches("[A-Za-z0-9][A-Za-z0-9 _-]{2,31}"),"Team name: 3–32 letters, numbers, spaces, _ or -.");
        require(tag.matches("[A-Z]{3}"),"Tag must be exactly three letters A–Z.");
        final String n=name, t=tag;
        require(state.teams.values().stream().noneMatch(x -> x.tag.equals(t) || x.name.equalsIgnoreCase(n) || x.name.equalsIgnoreCase(t) || x.tag.equalsIgnoreCase(n)),"That team name or tag is already in use.");
        require(COLORS.contains(color),"Choose a valid team color.");
        require(state.teams.size()<MAX_TEAMS,"Team limit reached.");
        UUID id=UUID.randomUUID();
        change(s -> { s.teams.put(id,new Team(id,n,t,color,owner,new LinkedHashMap<>(Map.of(owner,playerName)))); s.invites.values().removeIf(i -> i.recipient.equals(owner)); });
    }
    public void edit(UUID owner,Team expected,String name,String tag,String color) throws IOException {
        Team current=owned(owner);
        require(expected!=null&&current.id.equals(expected.id)&&current.name.equals(expected.name)
                &&current.tag.equals(expected.tag)&&current.color.equals(expected.color),"Team information changed; reopen the editor.");
        require(name!=null&&tag!=null,"Enter a team name and tag.");
        final String n=name.trim(),t=tag.trim().toUpperCase(Locale.ROOT);
        require(n.matches("[A-Za-z0-9][A-Za-z0-9 _-]{2,31}"),"Team name: 3–32 letters, numbers, spaces, _ or -.");
        require(t.matches("[A-Z]{3}"),"Tag must be exactly three letters A–Z.");
        require(COLORS.contains(color),"Choose a valid team color.");
        require(state.teams.values().stream().filter(x->!x.id.equals(current.id)).noneMatch(x->
                x.tag.equals(t)||x.name.equalsIgnoreCase(n)||x.name.equalsIgnoreCase(t)||x.tag.equalsIgnoreCase(n)),
                "That team name or tag is already in use.");
        if(current.name.equals(n)&&current.tag.equals(t)&&current.color.equals(color))return;
        change(s->{Team old=s.teams.get(current.id);s.teams.put(old.id,new Team(old.id,n,t,color,old.owner,old.members));});
    }
    public void invite(UUID owner,UUID target,long now) throws IOException {
        Team t=owned(owner); require(!owner.equals(target),"You are already in your team.");
        require(team(target)==null,"That player already belongs to a team."); require(t.members.size()<CAP,"Your team is full (5 including the owner).");
        require(invitations(target,now).size()<10,"That player has too many pending invitations.");
        require(state.invites.size()<MAX_INVITES,"Invitation limit reached; wait for invitations to expire.");
        String key=pair(t.id,target); Invite previous=state.invites.get(key);
        require(previous==null || previous.expires<=now,"An invitation is already pending.");
        change(s -> s.invites.put(key,new Invite(t.id,target,now+INVITE_MS)));
    }
    public void accept(UUID player,String name,UUID team,long now) throws IOException {
        Invite i=state.invites.get(pair(team,player)); Team t=state.teams.get(team);
        require(i!=null && i.expires>now && t!=null,"Invitation expired or was cancelled.");
        require(team(player)==null,"Leave your current team first."); require(t.members.size()<CAP,"That team is now full.");
        change(s -> { s.teams.get(team).members.put(player,name); s.invites.values().removeIf(x -> x.recipient.equals(player)); });
    }
    public void decline(UUID player,UUID team) throws IOException { require(state.invites.containsKey(pair(team,player)),"No pending invitation."); change(s -> s.invites.remove(pair(team,player))); }
    public void leave(UUID player) throws IOException {
        Team t=requiredTeam(player); require(!t.owner.equals(player) || t.members.size()==1,"Transfer ownership before leaving your teammates.");
        change(s -> removeMember(s,t.id,player));
    }
    /** Explicit owner-confirmed whole-team removal; all related state commits atomically. */
    public void disband(UUID owner,String expectedTag) throws IOException {
        Team t=owned(owner);
        require(expectedTag!=null&&t.tag.equalsIgnoreCase(expectedTag),"Confirm your current team tag before disbanding.");
        change(s -> {for(UUID member:List.copyOf(t.members.keySet()))removeMember(s,t.id,member);});
    }
    public void kick(UUID owner,UUID target) throws IOException {
        Team t=owned(owner); require(t.members.containsKey(target) && !owner.equals(target),"Choose another teammate.");
        change(s -> removeMember(s,t.id,target));
    }
    public void transfer(UUID owner,UUID target) throws IOException {
        Team t=owned(owner); require(t.members.containsKey(target) && !owner.equals(target),"Choose another teammate.");
        change(s -> { Team x=s.teams.get(t.id); s.teams.put(x.id,new Team(x.id,x.name,x.tag,x.color,target,x.members)); s.pacts.values().removeIf(p -> !p.accepted && (p.first.equals(x.id) || p.second.equals(x.id))); });
    }
    public void trust(UUID recipient,UUID requester,boolean value) throws IOException {
        Team t=requiredTeam(recipient); require(!recipient.equals(requester) && t.members.containsKey(requester),"Trust only another current teammate.");
        change(s -> { Set<UUID> set=s.trusts.computeIfAbsent(recipient,k -> new HashSet<>()); if(value) set.add(requester); else set.remove(requester); if(set.isEmpty()) s.trusts.remove(recipient); });
    }
    public void alerts(UUID player,boolean enabled) throws IOException { requiredTeam(player); change(s -> {if(enabled)s.mutedAlerts.remove(player);else s.mutedAlerts.add(player);}); }
    public void settings(UUID player,UUID expectedTeam,Map<UUID,Boolean> trust,boolean alerts) throws IOException {
        Team t=requiredTeam(player);require(t.id.equals(expectedTeam),"Team changed; reopen settings.");
        for(UUID id:trust.keySet())require(!id.equals(player)&&t.members.containsKey(id),"A selected teammate has left; reopen settings.");
        change(s->{Set<UUID> set=s.trusts.computeIfAbsent(player,k->new HashSet<>());trust.forEach((id,on)->{if(on)set.add(id);else set.remove(id);});if(set.isEmpty())s.trusts.remove(player);if(alerts)s.mutedAlerts.remove(player);else s.mutedAlerts.add(player);});
    }
    public void renamePlayer(UUID player,String name) throws IOException { Team t=team(player); if(t!=null&&!name.equals(t.members.get(player))) change(s -> s.teams.get(t.id).members.put(player,name)); }
    public void propose(UUID owner,String targetTag,long now) throws IOException {
        Team a=owned(owner), b=tag(targetTag); require(b!=null && !a.id.equals(b.id),"Choose a different existing team tag.");
        Pact p=state.pacts.get(pair(a.id,b.id)); require(p==null || (!p.accepted && p.expires<=now),"A ceasefire or pending request already exists with "+b.tag+".");
        require(p!=null||state.pacts.size()<MAX_PACTS,"Server ceasefire limit reached; end unused agreements first.");
        require(pacts(a.id,now).stream().filter(x -> !x.accepted).count()<10 && pacts(b.id,now).stream().filter(x -> !x.accepted).count()<10,"Pending ceasefire limit reached (10 per team).");
        change(s -> s.pacts.put(pair(a.id,b.id),new Pact(a.id,b.id,a.id,false,now+INVITE_MS,0)));
    }
    public void acceptPact(UUID owner,String other,long now,Predicate<UUID> combat) throws IOException {
        Team a=owned(owner), b=tag(other); require(b!=null,"Unknown team tag."); Pact p=state.pacts.get(pair(a.id,b.id));
        require(p!=null && !p.accepted && p.expires>now && !p.proposer.equals(a.id),"No incoming ceasefire request from that team.");
        require(a.members.keySet().stream().noneMatch(combat) && b.members.keySet().stream().noneMatch(combat),"A player on either team is still in combat; try again when everyone is safe.");
        change(s -> s.pacts.put(pair(a.id,b.id),new Pact(p.first,p.second,p.proposer,true,0,0)));
    }
    public void declinePact(UUID owner,String other,long now) throws IOException { pending(owner,other,now,false); }
    public void cancelPact(UUID owner,String other,long now) throws IOException { pending(owner,other,now,true); }
    private void pending(UUID owner,String other,long now,boolean outgoing) throws IOException {
        Team a=owned(owner), b=tag(other); require(b!=null,"Unknown team tag."); Pact p=state.pacts.get(pair(a.id,b.id));
        require(p!=null && !p.accepted && p.expires>now && p.proposer.equals(a.id)==outgoing,outgoing?"No outgoing pending request.":"No incoming pending request.");
        change(s -> s.pacts.remove(pair(a.id,b.id)));
    }
    public void end(UUID owner,String other,long now) throws IOException {
        Team a=owned(owner), b=tag(other); require(b!=null,"Unknown team tag."); Pact p=state.pacts.get(pair(a.id,b.id));
        require(p!=null && p.accepted,"No active ceasefire with that team."); require(p.ends==0,"That ceasefire is already ending.");
        change(s -> s.pacts.put(pair(a.id,b.id),new Pact(p.first,p.second,p.proposer,true,0,now+NOTICE_MS)));
    }
    public List<Pact> expire(long now) throws IOException {
        List<Pact> ended=state.pacts.values().stream().filter(p -> p.accepted && p.ends>0 && p.ends<=now).toList();
        boolean dirty=!ended.isEmpty() || state.invites.values().stream().anyMatch(i -> i.expires<=now) || state.pacts.values().stream().anyMatch(p -> !p.accepted && p.expires<=now);
        if(dirty)change(s -> {s.invites.values().removeIf(i -> i.expires<=now);s.pacts.values().removeIf(p -> p.accepted?p.ends>0&&p.ends<=now:p.expires<=now);});
        return ended;
    }
    public Team owned(UUID owner) { Team t=requiredTeam(owner); require(t.owner.equals(owner),"Only the team owner can do that."); return t; }
    public Team requiredTeam(UUID player) { Team t=team(player); require(t!=null,"Create or join a team first."); return t; }
    private static String pair(UUID a,UUID b) { return a.compareTo(b)<0?a+":"+b:b+":"+a; }
    private static void removeMember(State s,UUID team,UUID player) {
        Team t=s.teams.get(team); t.members.remove(player); s.trusts.remove(player); s.trusts.values().forEach(v -> v.remove(player)); s.trusts.values().removeIf(Set::isEmpty);s.mutedAlerts.remove(player);
        if(t.members.isEmpty()){s.teams.remove(team);s.invites.values().removeIf(i -> i.team.equals(team));s.pacts.values().removeIf(p -> p.first.equals(team)||p.second.equals(team));}
    }
    private void change(Consumer<State> edit) throws IOException {
        State next=decode(JSON.toJson(state)); edit.accept(next); next.revision++; validate(next); indexMembers(next); save(next); state=next;
    }
    private static void indexMembers(State state) {
        Map<UUID,UUID> index=new HashMap<>();
        for(Team team:state.teams.values())for(UUID member:team.members.keySet())index.put(member,team.id);
        // Keep HashMap's collision handling; only this wrapper escapes the local builder.
        state.memberTeams=Collections.unmodifiableMap(index);
    }
    private void save(State next) throws IOException {
        byte[] bytes=serialize(next); // Check the load limit before touching even the temporary/backup file.
        Files.createDirectories(file.toAbsolutePath().getParent()); Path temp=file.resolveSibling(file.getFileName()+".tmp"), backup=file.resolveSibling(file.getFileName()+".bak");
        try(FileChannel out=FileChannel.open(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING,StandardOpenOption.WRITE)){ByteBuffer data=ByteBuffer.wrap(bytes);while(data.hasRemaining())out.write(data);out.force(true);}
        if(Files.exists(file))Files.copy(file,backup,StandardCopyOption.REPLACE_EXISTING);
        // No non-atomic fallback: a failed atomic move leaves live memory and the old file untouched.
        Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
    }
    static byte[] serialize(State next)throws IOException{byte[] bytes=JSON.toJson(next).getBytes(java.nio.charset.StandardCharsets.UTF_8);if(bytes.length>MAX_STATE_BYTES)throw new IOException("Team state exceeds 16 MiB safety limit; prior state preserved");return bytes;}
    private static void validate(State s) {
        require(s!=null && s.schema==1 && s.teams!=null && s.invites!=null && s.pacts!=null && s.trusts!=null && s.mutedAlerts!=null,"Unsupported/corrupt state.");
        require(s.teams.size()<=MAX_TEAMS&&s.invites.size()<=MAX_INVITES&&s.pacts.size()<=MAX_PACTS&&s.trusts.size()<=MAX_TEAMS*CAP&&s.mutedAlerts.size()<=MAX_TEAMS*CAP,"Team state collection limit exceeded.");
        Set<UUID> members=new HashSet<>();Set<String> keys=new HashSet<>();
        for(var e:s.teams.entrySet()){Team t=e.getValue();require(t!=null&&e.getKey().equals(t.id)&&t.members!=null&&t.members.size()>0&&t.members.size()<=CAP&&t.members.containsKey(t.owner),"Invalid team membership.");require(t.tag!=null&&t.tag.matches("[A-Z]{3}")&&t.name!=null&&t.name.matches("[A-Za-z0-9][A-Za-z0-9 _-]{2,31}")&&COLORS.contains(t.color),"Invalid team identity.");require(keys.add(t.tag.toLowerCase(Locale.ROOT)),"Duplicate tag/name.");if(!t.name.equalsIgnoreCase(t.tag))require(keys.add(t.name.toLowerCase(Locale.ROOT)),"Duplicate name/tag.");for(var m:t.members.entrySet())require(m.getKey()!=null&&m.getValue()!=null&&m.getValue().matches("[A-Za-z0-9_]{1,16}")&&members.add(m.getKey()),"Invalid/duplicate member.");}
        for(var e:s.invites.entrySet()){Invite i=e.getValue();require(i!=null&&s.teams.containsKey(i.team)&&i.recipient!=null&&i.expires>0&&e.getKey().equals(pair(i.team,i.recipient)),"Invalid invitation.");}
        for(var e:s.pacts.entrySet()){Pact p=e.getValue();require(p!=null&&s.teams.containsKey(p.first)&&s.teams.containsKey(p.second)&&!p.first.equals(p.second)&&p.proposer!=null&&(p.proposer.equals(p.first)||p.proposer.equals(p.second))&&e.getKey().equals(pair(p.first,p.second))&&p.ends>=0&&(p.accepted?p.expires==0:p.expires>0&&p.ends==0),"Invalid ceasefire.");}
        for(var e:s.trusts.entrySet()){require(e.getValue()!=null&&e.getValue().size()<CAP,"Invalid trust.");Team t=s.teams.values().stream().filter(x -> x.members.containsKey(e.getKey())).findFirst().orElse(null);require(t!=null&&e.getValue().stream().allMatch(x -> x!=null&&!x.equals(e.getKey())&&t.members.containsKey(x)),"Trust must remain within a team.");}
        require(s.mutedAlerts.stream().allMatch(members::contains),"Alert preference belongs to a nonmember.");
    }
    static void require(boolean ok,String message) { if(!ok)throw new IllegalArgumentException(message); }
}
