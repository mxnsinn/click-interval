package dev.serverteams.fabric;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class TeamStoreTest {
    @TempDir Path dir;
    UUID alice=UUID.randomUUID(),bob=UUID.randomUUID(),carol=UUID.randomUUID(),dave=UUID.randomUUID();
    TeamStore store()throws Exception{return new TeamStore(dir.resolve("teams.json"));}
    void create(TeamStore s,UUID owner,String tag)throws Exception{s.create(owner,"Player_"+tag,"Team "+tag,tag,"aqua");}
    void join(TeamStore s,UUID owner,UUID player)throws Exception{s.invite(owner,player,1000);s.accept(player,"Member",s.team(owner).id(),1001);}
    @Test void normalizesTagsAndRejectsNamesAndDuplicateMembership()throws Exception{
        TeamStore s=store();s.create(alice,"Alice","First Team","abc","blue");assertEquals("ABC",s.team(alice).tag());
        assertThrows(IllegalArgumentException.class,()->s.create(bob,"Bob","first team","DEF","red"));
        assertThrows(IllegalArgumentException.class,()->s.create(bob,"Bob","ABC","DEF","red"));
        assertThrows(IllegalArgumentException.class,()->s.create(bob,"Bob","Valid Team","A12","red"));
        assertThrows(IllegalArgumentException.class,()->s.create(bob,"Bob","Unsafe\nTeam","DEF","red"));
        assertThrows(IllegalArgumentException.class,()->s.create(alice,"Alice","Second Team","DEF","red"));
    }
    @Test void fifthSlotCannotBeOverbookedByOutstandingInvitations()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");for(int i=0;i<3;i++)join(s,alice,UUID.randomUUID());
        s.invite(alice,bob,1000);s.invite(alice,carol,1000);s.accept(bob,"Bob",s.team(alice).id(),1001);
        assertThrows(IllegalArgumentException.class,()->s.accept(carol,"Carol",s.team(alice).id(),1001));assertEquals(5,s.team(alice).members().size());assertNull(s.team(carol));
    }
    @Test void invitationsExpireDeclineAndJoiningRevokesAllOtherInvitations()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");create(s,bob,"BBB");s.invite(alice,carol,1000);
        assertThrows(IllegalArgumentException.class,()->s.accept(carol,"Carol",s.team(alice).id(),301000));
        s.expire(301000);s.invite(alice,carol,301001);s.invite(bob,carol,301001);assertEquals(2,s.invitations(carol,301002).size());
        s.decline(carol,s.team(bob).id());assertEquals(1,s.invitations(carol,301002).size());s.invite(bob,carol,301003);
        s.accept(carol,"Carol",s.team(alice).id(),301004);assertTrue(s.invitations(carol,301004).isEmpty());
    }
    @Test void trustIsDirectionalAndRevokedByKickOrLeaveAndCannotCrossTeams()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");join(s,alice,bob);join(s,alice,carol);create(s,dave,"DDD");
        s.trust(alice,bob,true);assertTrue(s.trusts(alice,bob));assertFalse(s.trusts(bob,alice));assertFalse(s.trusts(alice,dave));
        assertThrows(IllegalArgumentException.class,()->s.trust(alice,dave,true));s.kick(alice,bob);assertFalse(s.trusts(alice,bob));join(s,alice,bob);assertFalse(s.trusts(alice,bob));
        s.trust(carol,bob,true);s.trust(bob,carol,true);s.leave(bob);assertFalse(s.trusts(carol,bob));assertFalse(s.trusts(bob,carol));
    }
    @Test void ownershipAndDisbandRequireExplicitSafeTransition()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");join(s,alice,bob);
        assertThrows(IllegalArgumentException.class,()->s.leave(alice));assertThrows(IllegalArgumentException.class,()->s.kick(bob,alice));assertThrows(IllegalArgumentException.class,()->s.transfer(alice,carol));
        s.transfer(alice,bob);assertEquals(bob,s.team(alice).owner());s.leave(alice);s.leave(bob);assertTrue(s.teams().isEmpty());
    }
    @Test void explicitDisbandIsOwnerOnlyTagBoundAndAtomicallyRevokesRelatedState()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");join(s,alice,bob);create(s,carol,"CCC");
        s.trust(alice,bob,true);s.trust(bob,alice,true);s.alerts(bob,false);s.invite(alice,dave,1000);
        s.propose(alice,"CCC",1000);s.acceptPact(carol,"AAA",1001,id->false);
        long revision=s.revision();
        assertThrows(IllegalArgumentException.class,()->s.disband(bob,"AAA"));
        assertThrows(IllegalArgumentException.class,()->s.disband(alice,"CCC"));
        assertEquals(revision,s.revision());assertTrue(s.friendly(alice,carol,1002));
        s.disband(alice,"aaa");
        assertEquals(revision+1,s.revision());assertNull(s.team(alice));assertNull(s.team(bob));
        assertNotNull(s.team(carol));assertFalse(s.trusts(alice,bob));assertTrue(s.alerts(bob));
        assertTrue(s.invitations(dave,1002).isEmpty());assertTrue(s.pacts(s.team(carol).id(),1002).isEmpty());
        TeamStore reloaded=store();assertNull(reloaded.team(alice));assertNull(reloaded.team(bob));assertNotNull(reloaded.team(carol));
    }
    @Test void failedDisbandRetainsAllCommittedMembersTrustAndInvitations()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");join(s,alice,bob);s.trust(alice,bob,true);s.invite(alice,carol,1000);
        long revision=s.revision();byte[] before=Files.readAllBytes(dir.resolve("teams.json"));
        Files.createDirectory(dir.resolve("teams.json.tmp"));
        assertThrows(java.io.IOException.class,()->s.disband(alice,"AAA"));
        assertEquals(revision,s.revision());assertArrayEquals(before,Files.readAllBytes(dir.resolve("teams.json")));
        assertEquals(2,s.team(alice).members().size());assertTrue(s.trusts(alice,bob));assertEquals(1,s.invitations(carol,1002).size());
    }
    @Test void ceasefireIsPairwiseOwnerOnlyAndRequiresOtherOwnerAcceptance()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");create(s,bob,"BBB");create(s,carol,"CCC");join(s,alice,dave);
        assertThrows(IllegalArgumentException.class,()->s.propose(dave,"BBB",1000));s.propose(alice,"BBB",1000);s.propose(alice,"CCC",1000);
        assertFalse(s.friendly(alice,bob,1001));assertThrows(IllegalArgumentException.class,()->s.acceptPact(alice,"BBB",1001,id->false));
        s.acceptPact(bob,"AAA",1001,id->false);assertTrue(s.friendly(alice,bob,1_000_000_000));assertFalse(s.friendly(bob,carol,1002));assertFalse(s.friendly(alice,carol,1002));
        s.acceptPact(carol,"AAA",1001,id->false);assertTrue(s.friendly(alice,carol,1002));assertFalse(s.friendly(bob,carol,1002));
    }
    @Test void combatOnEitherRosterPreventsActivationAndPendingCanBeCancelled()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");create(s,bob,"BBB");join(s,alice,carol);s.propose(alice,"BBB",1000);
        assertThrows(IllegalArgumentException.class,()->s.acceptPact(bob,"AAA",1001,id->id.equals(carol)));assertFalse(s.friendly(alice,bob,1001));
        assertThrows(IllegalArgumentException.class,()->s.cancelPact(bob,"AAA",1001));s.cancelPact(alice,"BBB",1001);assertTrue(s.pacts(s.team(alice).id(),1002).isEmpty());
        s.propose(alice,"BBB",1003);s.declinePact(bob,"AAA",1004);assertFalse(s.friendly(alice,bob,1005));
    }
    @Test void noticeIsExactlyThirtySecondsAndSurvivesRestart()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");create(s,bob,"BBB");s.propose(alice,"BBB",1000);s.acceptPact(bob,"AAA",1001,id->false);s.end(alice,"BBB",2000);
        assertTrue(s.friendly(alice,bob,31999));assertFalse(s.friendly(alice,bob,32000));
        TeamStore reloaded=store();assertTrue(reloaded.friendly(alice,bob,31999));assertFalse(reloaded.friendly(alice,bob,32000));
        assertEquals(1,reloaded.expire(32000).size());assertTrue(reloaded.expire(32001).isEmpty());
    }
    @Test void transferringOwnershipCancelsPendingButPreservesAcceptedCeasefires()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");create(s,bob,"BBB");create(s,carol,"CCC");join(s,alice,dave);s.propose(alice,"BBB",1000);s.propose(alice,"CCC",1000);s.acceptPact(bob,"AAA",1001,id->false);s.transfer(alice,dave);
        assertTrue(s.friendly(dave,bob,1002));assertEquals(1,s.pacts(s.team(alice).id(),1002).size());
    }
    @Test void persistenceBackupsAndSnapshotsAreSafe()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");long first=s.revision();join(s,alice,bob);s.trust(alice,bob,true);s.alerts(bob,false);
        assertTrue(s.revision()>first);assertTrue(Files.isRegularFile(dir.resolve("teams.json.bak")));TeamStore reloaded=store();assertTrue(reloaded.trusts(alice,bob));assertFalse(reloaded.alerts(bob));
        assertThrows(UnsupportedOperationException.class,()->reloaded.team(alice).members().put(carol,"Carol"));assertThrows(UnsupportedOperationException.class,()->reloaded.mentionGroups().get("AAA").add(carol));
        assertEquals(Set.of(alice,bob),reloaded.mentionGroups().get("Team AAA"));
    }
    @Test void malformedStateNeverSilentlyResetsOrRestoresOldBackup()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");s.alerts(alice,false);Files.writeString(dir.resolve("teams.json"),"{broken");
        assertThrows(java.io.IOException.class,this::store);assertEquals("{broken",Files.readString(dir.resolve("teams.json")));assertTrue(Files.isRegularFile(dir.resolve("teams.json.bak")));
    }
    @Test void failedCommitDoesNotPublishMutation()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");long revision=s.revision();Files.createDirectory(dir.resolve("teams.json.tmp"));
        assertThrows(java.io.IOException.class,()->s.alerts(alice,false));assertEquals(revision,s.revision());assertTrue(s.alerts(alice));
    }
    @Test void settingsAreOneAtomicRevisionAndCannotGrantCrossTeamTrust()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");join(s,alice,bob);long revision=s.revision();s.settings(alice,s.team(alice).id(),Map.of(bob,true),false);assertEquals(revision+1,s.revision());assertTrue(s.trusts(alice,bob));assertFalse(s.alerts(alice));
        assertThrows(IllegalArgumentException.class,()->s.settings(alice,s.team(alice).id(),Map.of(carol,true),true));assertFalse(s.alerts(alice));
    }
    @Test void oversizedSerializationRejectsBeforeChangingExistingFiles()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");byte[] existing=Files.readAllBytes(dir.resolve("teams.json"));long revision=s.revision();
        TeamStore.State huge=new TeamStore.State();huge.teams.put(alice,new TeamStore.Team(alice,"x".repeat(TeamStore.MAX_STATE_BYTES),"AAA","aqua",alice,Map.of(alice,"Alice")));
        assertThrows(java.io.IOException.class,()->TeamStore.serialize(huge));assertArrayEquals(existing,Files.readAllBytes(dir.resolve("teams.json")));assertEquals(revision,s.revision());
    }
    @Test void oversizedCollectionsAndFilesRefuseLoadingWithoutReset()throws Exception{
        TeamStore.State oversized=new TeamStore.State();for(int i=0;i<=TeamStore.MAX_PACTS;i++)oversized.pacts.put("bogus"+i,new TeamStore.Pact(alice,bob,alice,true,0,0));
        Files.write(dir.resolve("teams.json"),TeamStore.serialize(oversized));byte[] before=Files.readAllBytes(dir.resolve("teams.json"));
        assertThrows(java.io.IOException.class,this::store);assertArrayEquals(before,Files.readAllBytes(dir.resolve("teams.json")));
        Files.writeString(dir.resolve("teams.json")," ".repeat(TeamStore.MAX_STATE_BYTES+1));assertThrows(java.io.IOException.class,this::store);
    }
    private void assertMembershipIndex(TeamStore s,UUID... players){
        for(UUID player:players){
            TeamStore.Team expected=s.teams().stream().filter(t->t.members().containsKey(player)).findFirst().orElse(null);
            assertEquals(expected,s.team(player),"Indexed lookup matches authoritative roster for "+player);
        }
        assertNull(s.team(null));assertFalse(s.friendly(null,alice,1000));assertFalse(s.trusts(null,alice));assertFalse(s.trusts(alice,null));
    }
    @Test void membershipIndexTracksCreateJoinTransferRenameKickLeaveDisbandAndReload()throws Exception{
        TeamStore s=store();assertMembershipIndex(s,alice,bob,carol,dave);
        create(s,alice,"AAA");create(s,bob,"BBB");join(s,alice,carol);join(s,bob,dave);
        assertMembershipIndex(s,alice,bob,carol,dave);assertMembershipIndex(store(),alice,bob,carol,dave);
        s.trust(alice,carol,true);s.transfer(alice,carol);s.renamePlayer(carol,"RenamedCarol");
        assertEquals(carol,s.team(alice).owner());assertTrue(s.trusts(alice,carol));assertTrue(s.friendly(alice,carol,1000));assertFalse(s.friendly(alice,dave,1000));
        assertMembershipIndex(s,alice,bob,carol,dave);assertMembershipIndex(store(),alice,bob,carol,dave);
        s.kick(carol,alice);s.leave(dave);assertNull(s.team(alice));assertNull(s.team(dave));assertFalse(s.trusts(alice,carol));assertFalse(s.friendly(alice,carol,1000));
        assertMembershipIndex(s,alice,bob,carol,dave);assertMembershipIndex(store(),alice,bob,carol,dave);
        s.leave(carol);s.leave(bob);assertTrue(s.teams().isEmpty());
        assertMembershipIndex(s,alice,bob,carol,dave);assertMembershipIndex(store(),alice,bob,carol,dave);
        create(s,alice,"AAA");join(s,alice,dave);assertTrue(s.friendly(alice,dave,1000));assertFalse(s.trusts(alice,dave));
        assertMembershipIndex(s,alice,bob,carol,dave);
    }
    @Test void failedMembershipCommitsNeverPublishAnUncommittedIndex()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");s.invite(alice,bob,1000);long revision=s.revision();
        Path temporary=dir.resolve("teams.json.tmp");Files.createDirectory(temporary);
        assertThrows(java.io.IOException.class,()->s.accept(bob,"Bob",s.team(alice).id(),1001));
        assertEquals(revision,s.revision());assertNull(s.team(bob));assertFalse(s.friendly(alice,bob,1001));assertMembershipIndex(s,alice,bob);
        Files.delete(temporary);s.accept(bob,"Bob",s.team(alice).id(),1001);s.trust(alice,bob,true);revision=s.revision();Files.createDirectory(temporary);
        assertThrows(java.io.IOException.class,()->s.kick(alice,bob));assertEquals(revision,s.revision());
        assertTrue(s.friendly(alice,bob,1002));assertTrue(s.trusts(alice,bob));assertMembershipIndex(s,alice,bob);assertMembershipIndex(store(),alice,bob);
    }
    @Test void indexIsDerivedOnlyAndCannotBeInjectedThroughPersistedJson()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");String json=Files.readString(dir.resolve("teams.json"));
        assertFalse(json.contains("memberTeams"));
        String forged="{\"memberTeams\":{\""+bob+"\":\""+s.team(alice).id()+"\"},"+json.substring(1);
        Files.writeString(dir.resolve("teams.json"),forged);TeamStore reloaded=store();
        assertNull(reloaded.team(bob));assertFalse(reloaded.friendly(alice,bob,1000));assertMembershipIndex(reloaded,alice,bob);
        reloaded.alerts(alice,false);assertFalse(Files.readString(dir.resolve("teams.json")).contains("memberTeams"));
    }
    @Test void indexedFriendshipPreservesPairwiseCeasefireExpiryAndDisbandCleanup()throws Exception{
        TeamStore s=store();create(s,alice,"AAA");create(s,bob,"BBB");create(s,carol,"CCC");join(s,alice,dave);
        s.propose(alice,"BBB",1000);s.acceptPact(bob,"AAA",1001,id->false);s.end(alice,"BBB",2000);
        assertTrue(s.friendly(dave,bob,31999));assertFalse(s.friendly(dave,bob,32000));assertFalse(s.friendly(dave,carol,3000));
        assertFalse(s.trusts(dave,bob));assertTrue(store().friendly(dave,bob,31999));
        s.leave(dave);assertFalse(s.friendly(dave,bob,3000));assertTrue(s.friendly(alice,bob,3000));
        s.leave(alice);assertFalse(s.friendly(alice,bob,3000));assertTrue(s.pacts(s.team(bob).id(),3000).isEmpty());assertMembershipIndex(store(),alice,bob,carol,dave);
    }
}
