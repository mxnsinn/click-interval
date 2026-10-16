package dev.serverteams.fabric;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class TeamEditTest {
    @TempDir Path directory;
    final UUID owner=UUID.randomUUID(),member=UUID.randomUUID(),other=UUID.randomUUID();
    TeamStore fixture()throws Exception{
        TeamStore s=new TeamStore(directory.resolve("teams.json"));
        s.create(owner,"Owner","First Team","ONE","red");s.invite(owner,member,1);s.accept(member,"Member",s.team(owner).id(),2);
        s.create(other,"Other","Other Team","TWO","aqua");return s;
    }
    @Test void editPreservesOfflineRosterTrustPactsAndIdAcrossReload()throws Exception{
        TeamStore s=fixture();var before=s.team(owner);s.trust(owner,member,true);s.propose(owner,"TWO",3);s.acceptPact(other,"ONE",4,id->false);
        s.edit(owner,before,"Vanguard","vrg","blue");
        TeamStore loaded=new TeamStore(directory.resolve("teams.json"));var after=loaded.team(owner);
        assertEquals(before.id(),after.id());assertEquals(before.members(),after.members());assertEquals("VRG",after.tag());
        assertEquals("Vanguard",after.name());assertEquals("blue",after.color());assertTrue(loaded.trusts(owner,member));assertTrue(loaded.friendly(owner,other,5));
        assertNull(loaded.tag("ONE"));assertEquals(after.id(),loaded.tag("VRG").id());assertTrue(loaded.mentionGroups().containsKey("Vanguard"));
        loaded.end(owner,"TWO",6);assertFalse(loaded.friendly(owner,other,6+TeamStore.NOTICE_MS));
    }
    @Test void rejectsNonOwnersStaleDialogsAndCrossNameTagCollisions()throws Exception{
        TeamStore s=fixture();var team=s.team(owner);long revision=s.revision();
        assertThrows(IllegalArgumentException.class,()->s.edit(member,team,"Valid Name","NEW","green"));
        for(String[] values:List.of(new String[]{"Other Team","NEW","green"},new String[]{"TWO","NEW","green"},new String[]{"Valid Name","TWO","green"},new String[]{"Valid Name","N12","green"},new String[]{"Bad\nName","NEW","green"},new String[]{"Valid Name","NEW","invalid"}))
            assertThrows(IllegalArgumentException.class,()->s.edit(owner,team,values[0],values[1],values[2]));
        assertEquals(revision,s.revision());s.edit(owner,team,"New Name","NEW","green");
        assertThrows(IllegalArgumentException.class,()->s.edit(owner,team,"Stale Name","OLD","blue"));
        var latest=s.team(owner);s.transfer(owner,member);assertThrows(IllegalArgumentException.class,()->s.edit(owner,latest,"New Name","NEW","red"));
    }
    @Test void failedSaveLeavesOriginalProfileAndRevision()throws Exception{
        TeamStore s=fixture();var before=s.team(owner);long revision=s.revision();Files.createDirectory(directory.resolve("teams.json.tmp"));
        assertThrows(java.io.IOException.class,()->s.edit(owner,before,"Vanguard","VRG","blue"));
        assertEquals(before,s.team(owner));assertEquals(revision,s.revision());
    }
    @Test void onlyTagHasTeamColorInTabLabel(){
        var team=new TeamStore.Team(owner,"Vanguard","VRG","red",owner,Map.of(owner,"Owner"));
        var label=TeamService.tabLabel(team,"Owner");assertEquals("[VRG] Owner",label.getString());
        label.visit((style,text)->{if(!text.isEmpty())assertEquals(TextColor.fromLegacyFormat(text.equals("[VRG]")?ChatFormatting.RED:ChatFormatting.WHITE),style.getColor(),text);return Optional.empty();},Style.EMPTY);
    }
    @Test void invitationsOfferBothClickableCommands(){
        var team=new TeamStore.Team(owner,"Vanguard","VRG","red",owner,Map.of(owner,"Owner"));
        var message=TeamCommands.invitationMessage(team);var commands=new ArrayList<String>();
        message.visit((style,text)->{if(style.getClickEvent() instanceof net.minecraft.network.chat.ClickEvent.RunCommand click)commands.add(click.command());return Optional.empty();},Style.EMPTY);
        assertEquals(List.of("/teams accept VRG","/teams decline VRG"),commands);
    }
    @Test void nameAndTagLimitsApplyToCreationAndEditing()throws Exception{
        TeamStore s=fixture();var team=s.team(owner);
        for(String tag:List.of("","A","AB","ABCD")){
            assertThrows(IllegalArgumentException.class,()->s.edit(owner,team,"Valid Name",tag,"red"));
            assertThrows(IllegalArgumentException.class,()->s.create(UUID.randomUUID(),"Fresh","Valid Name",tag,"red"));
        }
        for(String name:List.of("","AB","A".repeat(33))){
            assertThrows(IllegalArgumentException.class,()->s.edit(owner,team,name,"NEW","red"));
            assertThrows(IllegalArgumentException.class,()->s.create(UUID.randomUUID(),"Fresh",name,"NEW","red"));
        }
        s.edit(owner,team,"A".repeat(32),"NEW","red");assertEquals(32,s.team(owner).name().length());
    }
}
