package dev.serverteams.fabric;
import java.util.*;
/** Optional reflection bridge. Arguments are UUIDs; no client-supplied team identity is trusted. */
public final class TeamApi {
    private TeamApi() { }
    public static boolean trusts(UUID recipient,UUID requester) { TeamService s=ServerTeams.current();return s!=null&&s.store.trusts(recipient,requester); }
    public static boolean isFriendly(UUID a,UUID b) { TeamService s=ServerTeams.current();return s!=null&&s.store.friendly(a,b,System.currentTimeMillis()); }
    public static Map<String,Set<UUID>> mentionGroups() { TeamService s=ServerTeams.current();return s==null?Map.of():s.store.mentionGroups(); }
    public static long revision() { TeamService s=ServerTeams.current();return s==null?-1:s.store.revision(); }
}
