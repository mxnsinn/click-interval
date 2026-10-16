package com.clickinterval.advancementsilence;

import com.mojang.authlib.GameProfile;
import net.minecraft.advancements.*;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.game.ClientboundUpdateAdvancementsPacket;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.server.permissions.LevelBasedPermissionSet;
import net.minecraft.server.players.NameAndId;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.level.gamerules.GameRules;
import org.slf4j.LoggerFactory;
import java.nio.file.*;
import java.util.*;

/** Inert unless an explicit JVM flag AND a marked, disposable project fixture are present. */
final class AdvancementSelfTest {
    private static final UUID ALICE = UUID.fromString("e6e75273-9581-4e8c-8b64-dad7aa15faea");
    static void run(MinecraftServer server) {
        requireDisposable(server);
        int phase = Integer.getInteger("clickinterval.advancementSilence.phase", 1);
        var alice = new TestPlayer(server, ALICE, phase == 1 ? "AliceTest" : "AliceRenamed");
        var bob = new TestPlayer(server, UUID.fromString("6118783a-3d97-4e67-a178-dfd2f6746a51"), "BobTest");
        var players=server.getPlayerList();
        for(var player:List.of(alice,bob)) { players.getPlayers().add(player); players.getPlayersByUUID().put(player.getUUID(),player); }
        try {
            var dispatcher=server.getCommands().getDispatcher();
            var console=server.createCommandSourceStack();
            var owner=alice.createCommandSourceStack().withPermission(LevelBasedPermissionSet.OWNER);
            require(ServerAdvancementSilence.consoleOnly(console), "actual console allowed");
            require(!ServerAdvancementSilence.consoleOnly(owner), "owner player denied");
            require(!ServerAdvancementSilence.consoleOnly(console.withEntity(alice)), "execute-as console denied");
            for(String name:List.of("silence","unsilence")) {
                require(!dispatcher.getRoot().getChild(name).canUse(owner), "command hidden from owner player tree");
                try { dispatcher.execute(name+" advancement "+alice.getGameProfile().name(),owner); throw new IllegalStateException("player command unexpectedly succeeded"); }
                catch(com.mojang.brigadier.exceptions.CommandSyntaxException expected) {}
            }
            require(ServerAdvancementSilence.resolveKnown(server,"Alice").isEmpty(), "partial names never resolve");
            require(ServerAdvancementSilence.resolveKnown(server,"NobodyKnown123").isEmpty(), "unknown offline UUID never synthesized");
            require(ServerAdvancementSilence.resolveKnown(server,"@a").isEmpty(), "selectors rejected");
            require(server.overworld().getGameRules().get(GameRules.SHOW_ADVANCEMENT_MESSAGES), "global advancement gamerule unchanged");
            if(phase==1) {
                require(!ServerAdvancementSilence.isSilenced(alice), "initially vanilla");
                require(dispatcher.execute("silence advancement alicetest",console)==1, "case-insensitive exact online name");
                var cached=new NameAndId(UUID.fromString("8c1e6e3e-f4b4-46bc-a9e5-d1e5f18984f9"),"OfflineKnown");
                server.services().nameToIdCache().add(cached);
                require(ServerAdvancementSilence.resolveKnown(server,"offlineknown").orElseThrow().id().equals(cached.id()), "known cached offline UUID resolved");
                require(dispatcher.execute("silence advancement OfflineKnown",console)==1, "cached offline player supported");
                require(dispatcher.execute("unsilence advancement OfflineKnown",console)==1, "cached offline reversal supported");
            } else require(ServerAdvancementSilence.isSilenced(alice), "actual JVM restart and username change retain UUID silence");
            require(ServerAdvancementSilence.isSilenced(alice) && !ServerAdvancementSilence.isSilenced(bob), "one player only");
            AdvancementHolder original=server.getAdvancements().get(Identifier.withDefaultNamespace("story/mine_stone"));
            require(original!=null, "real vanilla advancement exists");
            Advancement value=original.value();
            AdvancementHolder advancement=new AdvancementHolder(original.id(),new Advancement(value.parent(),value.display(),
                    new AdvancementRewards(7,List.of(),List.of(),Optional.empty()),value.criteria(),value.requirements(),value.sendsTelemetryEvent()));
            reset(alice,advancement); reset(bob,advancement); clear(alice,bob);
            int xp=alice.totalExperience;
            award(alice,advancement);
            require(alice.messages.isEmpty() && bob.messages.isEmpty(), "silenced award has no public recipient announcement");
            require(alice.totalExperience==xp+7, "silenced advancement reward granted exactly once");
            require(alice.getAdvancements().getOrStartProgress(advancement).isDone(), "silenced advancement remains completed");
            alice.getAdvancements().flushDirty(alice,true);
            require(alice.packets.stream().filter(ClientboundUpdateAdvancementsPacket.class::isInstance)
                    .map(ClientboundUpdateAdvancementsPacket.class::cast)
                    .anyMatch(packet->packet.getProgress().containsKey(original.id()) && packet.getProgress().get(original.id()).isDone()), "completion still sent to client");
            require(alice.packets.stream().filter(ClientboundUpdateAdvancementsPacket.class::isInstance)
                    .map(ClientboundUpdateAdvancementsPacket.class::cast).flatMap(packet->packet.getAdded().stream())
                    .anyMatch(holder->holder.id().equals(original.id()) && holder.value().display().orElseThrow().shouldShowToast()), "own toast metadata preserved");
            clear(alice,bob); award(bob,advancement);
            require(alice.messages.stream().anyMatch(text->text.contains("BobTest")) && bob.messages.stream().anyMatch(text->text.contains("BobTest")), "other player still broadcasts to all");
            clear(alice,bob); players.broadcastSystemMessage(Component.literal("Unrelated normal chat"),false);
            require(alice.messages.contains("Unrelated normal chat") && bob.messages.contains("Unrelated normal chat"), "normal chat unchanged");
            require(dispatcher.execute("unsilence advancement "+alice.getGameProfile().name(),console)==1, "console can restore");
            reset(alice,advancement); clear(alice,bob); award(alice,advancement);
            require(bob.messages.stream().anyMatch(text->text.contains(alice.getGameProfile().name())), "restored player broadcasts again");
            if(phase==1) require(dispatcher.execute("silence advancement AliceTest",console)==1, "persistent state queued for restart test");
            require(new SilenceStore(server.getWorldPath(LevelResource.ROOT).resolve("server-advancement-silence.json")).contains(ALICE)==(phase==1), "atomic disk state matches live state");
            require(server.overworld().getGameRules().get(GameRules.SHOW_ADVANCEMENT_MESSAGES), "global gamerule still true after commands and awards");
            LoggerFactory.getLogger("ServerAdvancementSilence").info("ADVANCEMENT_SILENCE_NATIVE_TEST_PASS phase={}: console-only hidden commands; exact/cached names; UUID isolation; award, reward and toast preserved; public chat selectively filtered; restoration; disk persistence",phase);
        } catch(Exception failure) { throw new IllegalStateException("Advancement silence native test failed",failure); }
        finally {
            for(var player:List.of(alice,bob)) { players.getPlayersByUUID().remove(player.getUUID()); players.getPlayers().remove(player); }
        }
    }
    private static void clear(TestPlayer...players) { for(var player:players) { player.messages.clear(); player.packets.clear(); } }
    private static void reset(ServerPlayer player,AdvancementHolder holder) { for(String criterion:holder.value().criteria().keySet()) player.getAdvancements().revoke(holder,criterion); }
    private static void award(ServerPlayer player,AdvancementHolder holder) {
        for(String criterion:holder.value().criteria().keySet()) require(player.getAdvancements().award(holder,criterion),"criterion granted");
    }
    private static void require(boolean value,String label) { if(!value) throw new IllegalStateException(label); }
    private static void requireDisposable(MinecraftServer server) {
        try {
            Path root=server.getWorldPath(LevelResource.ROOT).toRealPath();
            Path allowed=Path.of("D:/Codex-Projects/OPMouseHotkeyElectron/minecraft-server/server-advancement-silence-fabric/build/native-fixtures").toRealPath();
            require(root.startsWith(allowed) && Files.readString(root.resolve(".advancement-silence-disposable-test"))
                    .equals("Advancement Silence disposable native fixture v1\n"),"explicit project-only disposable test marker required");
        } catch(Exception failure) { throw new IllegalStateException("Refusing native test outside disposable fixture",failure); }
    }
    private static final class TestPlayer extends ServerPlayer {
        final List<String> messages=new ArrayList<>();
        final List<Packet<?>> packets=new ArrayList<>();
        TestPlayer(MinecraftServer server,UUID id,String name) {
            super(server,server.overworld(),new GameProfile(id,name),ClientInformation.createDefault());
            connection=new ServerGamePacketListenerImpl(server,new net.minecraft.network.Connection(PacketFlow.SERVERBOUND),this,
                    CommonListenerCookie.createInitial(getGameProfile(),false)) {
                @Override public void send(Packet<?> packet) { packets.add(packet); }
            };
        }
        @Override public void sendSystemMessage(Component message,boolean overlay) { messages.add(message.getString()); }
        @Override public void sendSystemMessage(Component message) { messages.add(message.getString()); }
        @Override public boolean hasDisconnected() { return false; }
    }
}
