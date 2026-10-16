package dev.serverteams.fabric;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class TeamCommandRoutesTest {
    record Invocation(String actor,String action,String value,String extra) {}
    final List<Invocation> calls=new ArrayList<>();
    final CommandDispatcher<String> dispatcher=new CommandDispatcher<>();
    @Test void playerArgumentsUseServerSuggestions()throws Exception{
        var commands=new CommandDispatcher<String>();
        TeamCommandRoutes.register(commands,(actor,action,value,extra)->1,(context,builder)->{
            for(String name:List.of("Alice","Bob"))if(name.toLowerCase(java.util.Locale.ROOT).startsWith(builder.getRemainingLowerCase()))builder.suggest(name);
            return builder.buildFuture();
        });
        for(String prefix:List.of("teams invite B","team;invite B","teams kick B","teams transfer B","teams trust B")){
            var result=commands.getCompletionSuggestions(commands.parse(prefix,"Owner")).get();
            assertEquals(List.of("Bob"),result.getList().stream().map(s->s.getText()).toList());
        }
    }
    TeamCommandRoutesTest(){
        TeamCommandRoutes.register(dispatcher,(actor,action,value,extra)->{
            calls.add(new Invocation(actor,action,value,extra));return 1;
        });
    }
    @Test void requestedAliasesAndConventionalCommandsReachIdenticalPlayerBoundActions()throws Exception{
        dispatcher.execute("create;team abc","Alice");
        dispatcher.execute("teams create abc","Alice");
        assertEquals(calls.get(0),calls.get(1));
        assertEquals(new Invocation("Alice","create","abc",""),calls.getFirst());
        dispatcher.execute("team;invite Bob","Alice");dispatcher.execute("teams invite Bob","Alice");
        assertEquals(calls.get(2),calls.get(3));
        dispatcher.execute("team;accept ABC","Bob");dispatcher.execute("teams accept ABC","Bob");
        assertEquals(calls.get(4),calls.get(5));
        assertEquals("Bob",calls.get(4).actor());
    }
    @Test void disbandNeedsExactTagAndExplicitConfirmation()throws Exception{
        assertThrows(CommandSyntaxException.class,()->dispatcher.execute("teams disband ABC","Alice"));
        assertThrows(CommandSyntaxException.class,()->dispatcher.execute("teams disband ABC yes","Alice"));
        assertThrows(CommandSyntaxException.class,()->dispatcher.execute("teams disband ABC confirm extra","Alice"));
        assertTrue(calls.isEmpty());
        dispatcher.execute("teams disband ABC confirm","Alice");
        dispatcher.execute("team;disband ABC confirm","Alice");
        assertEquals(calls.get(0),calls.get(1));
        assertEquals(new Invocation("Alice","disband","ABC",""),calls.getFirst());
    }
    @Test void vanillaPrivilegedTeamRoutesAreNotRegisteredOrOverwritten()throws Exception{
        var vanilla=dispatcher.register(LiteralArgumentBuilder.<String>literal("team")
            .requires(actor->actor.equals("Operator"))
            .then(LiteralArgumentBuilder.<String>literal("add").executes(c->99)));
        TeamCommandRoutes.register(dispatcher,(actor,action,value,extra)->1);
        assertSame(vanilla,dispatcher.getRoot().getChild("team"));
        assertFalse(vanilla.canUse("Alice"));assertTrue(vanilla.canUse("Operator"));
        assertEquals(99,dispatcher.execute("team add","Operator"));
        assertNull(dispatcher.getRoot().getChild("teams").getChild("add"));
        assertNull(dispatcher.getRoot().getChild("teams").getChild("join"));
    }
    @Test void namesAndCompleteMembershipControlsNeedNoDialogRoutes()throws Exception{
        dispatcher.execute("create team abc Alpha Brave Crew","Alice");
        assertEquals(new Invocation("Alice","create","abc","Alpha Brave Crew"),calls.getLast());
        dispatcher.execute("teams invites","Bob");dispatcher.execute("teams accept","Bob");
        dispatcher.execute("team;decline ABC","Bob");dispatcher.execute("team;leave","Bob");
        dispatcher.execute("teams kick Bob","Alice");dispatcher.execute("teams transfer Bob","Alice");
        dispatcher.execute("teams trust Bob on","Alice");dispatcher.execute("teams alerts off","Alice");
        dispatcher.execute("teams name New Team Name","Alice");dispatcher.execute("teams color red","Alice");
        assertEquals(List.of("create","invites","accept","decline","leave","kick","transfer","trust","alerts","name","color"),
            calls.stream().map(Invocation::action).toList());
        assertThrows(CommandSyntaxException.class,()->dispatcher.execute("teams trust Bob perhaps","Alice"));
    }
}
