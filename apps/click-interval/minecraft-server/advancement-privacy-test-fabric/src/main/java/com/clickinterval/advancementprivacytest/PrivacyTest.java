package com.clickinterval.advancementprivacytest;

import com.google.gson.*;
import com.mojang.authlib.GameProfile;
import io.netty.channel.ChannelFutureListener;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.advancements.AdvancementHolder;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.game.ClientboundSystemChatPacket;
import net.minecraft.network.protocol.game.ClientboundUpdateAdvancementsPacket;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.level.gamerules.GameRules;
import org.slf4j.LoggerFactory;
import java.nio.file.*;
import java.util.*;

public final class PrivacyTest implements ModInitializer {
    private static final String[][] TARGETS={
        {"Mxnsinn","6d999773-a064-48ea-a10b-d5e3ae56fe4d"},
        {"erdemzumrutt","c58d4369-e551-42a1-aa9d-59a736591ffb"},
        {"abdurbabdur","d9d2c2e9-049e-4e33-9c43-b54356dc5536"},
        {"lol201214","56ea8376-977f-46cf-b6c6-01b4f5e68c23"}
    };
    @Override public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTED.register(server->{
            if(Boolean.getBoolean("clickinterval.privacy.fixture")) run(server);
        });
    }
    private static void run(MinecraftServer server) {
        Path world=verifyFixture(server);
        JsonObject receipt=new JsonObject();JsonArray cases=new JsonArray();
        List<TestPlayer> players=new ArrayList<>();
        try {
            JsonObject initial=JsonParser.parseString(Files.readString(world.resolve("server-advancement-silence.json"))).getAsJsonObject();
            Set<String> initialUUIDs=new HashSet<>();initial.getAsJsonArray("silenced").forEach(e->initialUUIDs.add(e.getAsString()));
            require(initial.get("version").getAsInt()==1,"production settings version");
            require(server.overworld().getGameRules().get(GameRules.SHOW_ADVANCEMENT_MESSAGES),"vanilla global announcements are enabled throughout test");
            for(String[] target:TARGETS) {
                require(initialUUIDs.contains(target[1]),"copied production settings already silence "+target[0]);
                players.add(new TestPlayer(server,target[0],UUID.fromString(target[1])));
            }
            TestPlayer observer=new TestPlayer(server,"PrivacyObserver",UUID.fromString("a6da4c1f-dd9b-4dc6-90a5-6b9e7b7d7a5f"));
            require(!initialUUIDs.contains(observer.getUUID().toString()),"observer is not silenced");players.add(observer);
            for(TestPlayer player:players) {
                server.getPlayerList().getPlayers().add(player);
                server.getPlayerList().getPlayersByUUID().put(player.getUUID(),player);
                player.getAdvancements().flushDirty(player,false); // Initial login packet precedes new awards.
            }
            List<AdvancementHolder> advancements=new ArrayList<>();
            for(String id:List.of("story/follow_ender_eye","story/enter_the_end","story/mine_stone")) {
                AdvancementHolder holder=server.getAdvancements().get(Identifier.withDefaultNamespace(id));
                require(holder!=null,"actual vanilla advancement present: "+id);
                require(holder.value().display().orElseThrow().shouldAnnounceChat(),"advancement normally announces: "+id);
                require(holder.value().display().orElseThrow().shouldShowToast(),"advancement normally displays own toast: "+id);
                advancements.add(holder);
            }
            // No initial silence commands: these twelve awards test the copied live policy as loaded.
            for(TestPlayer target:players.subList(0,4)) for(AdvancementHolder holder:advancements) {
                clear(players);award(target,holder);target.getAdvancements().flushDirty(target,true);
                require(target.getAdvancements().getOrStartProgress(holder).isDone(),"award progress preserved");
                require(target.toasts.contains(holder.id()),"own completion/visible-toast packet preserved: "+holder.id());
                require(players.stream().allMatch(p->p.chat.isEmpty()),"no public announcement packet reaches any player");
                require(players.stream().filter(p->p!=target).allMatch(p->p.updates.isEmpty()),"award data not sent to other players");
                JsonObject row=new JsonObject();row.addProperty("name",target.getGameProfile().name());row.addProperty("uuid",target.getUUID().toString());
                row.addProperty("advancement",holder.id().toString());row.addProperty("title",holder.value().display().orElseThrow().getTitle().getString());
                row.addProperty("completed",true);row.addProperty("ownToastPacket",true);row.addProperty("observerChatPackets",observer.chat.size());
                row.addProperty("totalPublicChatPackets",players.stream().mapToInt(p->p.chat.size()).sum());cases.add(row);
            }
            int controls=0,restored=0;
            for(AdvancementHolder holder:advancements) {
                clear(players);award(observer,holder);observer.getAdvancements().flushDirty(observer,true);
                require(players.stream().allMatch(p->p.chat.size()==1&&p.chat.getFirst().contains("PrivacyObserver")),"unsilenced observer broadcasts normally to everyone");
                require(observer.toasts.contains(holder.id()),"control own toast preserved");controls++;
            }
            for(TestPlayer target:players.subList(0,4)) {
                clear(players);
                require(server.getCommands().getDispatcher().execute("unsilence advancement "+target.getGameProfile().name(),server.createCommandSourceStack())==1,"console restores target");
                for(TestPlayer player:players) player.getAdvancements().flushDirty(player,true);
                require(players.stream().allMatch(p->p.chat.isEmpty()),"unsilencing does not retroactively announce completed awards");
                for(AdvancementHolder holder:advancements) {
                    for(String criterion:holder.value().criteria().keySet()) require(!target.getAdvancements().award(holder,criterion),"already-completed award does not repeat");
                }
                require(players.stream().allMatch(p->p.chat.isEmpty()),"completed criteria stay silent after unsilence");
                for(AdvancementHolder holder:advancements) {
                    for(String criterion:holder.value().criteria().keySet()) target.getAdvancements().revoke(holder,criterion);
                    target.getAdvancements().flushDirty(target,true);clear(players);award(target,holder);target.getAdvancements().flushDirty(target,true);
                    require(players.stream().allMatch(p->p.chat.size()==1&&p.chat.getFirst().contains(target.getGameProfile().name())),"a fresh award after restoration announces normally");
                    require(target.toasts.contains(holder.id()),"restored future award still toasts");restored++;
                }
                require(server.getCommands().getDispatcher().execute("silence advancement "+target.getGameProfile().name(),server.createCommandSourceStack())==1,"fixture policy restored");
            }
            clear(players);server.getPlayerList().broadcastSystemMessage(Component.literal("Unrelated chat control"),false);
            require(players.stream().allMatch(p->p.chat.equals(List.of("Unrelated chat control"))),"ordinary chat unaffected");
            require(server.overworld().getGameRules().get(GameRules.SHOW_ADVANCEMENT_MESSAGES),"global gamerule unchanged");
            JsonObject finalSettings=JsonParser.parseString(Files.readString(world.resolve("server-advancement-silence.json"))).getAsJsonObject();
            Set<String> finalUUIDs=new HashSet<>();finalSettings.getAsJsonArray("silenced").forEach(e->finalUUIDs.add(e.getAsString()));
            require(initialUUIDs.equals(finalUUIDs),"fixture returns to copied UUID policy");
            receipt.addProperty("passed",true);receipt.add("silencedAwards",cases);
            receipt.addProperty("unsilencedObserverControls",controls);receipt.addProperty("restoredFutureAwards",restored);
            receipt.addProperty("noRetroactiveAnnouncements",true);receipt.addProperty("globalGameruleUnchanged",true);
            receipt.addProperty("transport","Synthetic native ServerPlayer sessions; actual vanilla sendSystemMessage and advancement packet creation; packet delivery captured instead of a GUI/network client");
            receipt.addProperty("awardMethod","Actual vanilla criteria awarded directly through PlayerAdvancements.award; not a simulated walk into a structure");
            receipt.addProperty("initialSilenceCommands",0);receipt.addProperty("liveServerOrClientChanged",false);
            Files.writeString(world.resolve("privacy-test-result.json"),new GsonBuilder().setPrettyPrinting().create().toJson(receipt)+"\n",StandardOpenOption.CREATE_NEW);
            LoggerFactory.getLogger("AdvancementPrivacyTest").info("ADVANCEMENT_PRIVACY_NATIVE_PASS: 12 copied-policy private awards; Eye Spy, enter End and regular advancements; own progress/toast preserved; 3 public controls; 12 restored future broadcasts; no retroactive chat.");
        } catch(Exception failure) { throw new IllegalStateException("Advancement privacy fixture failed",failure); }
        finally {
            for(TestPlayer player:players) {server.getPlayerList().getPlayersByUUID().remove(player.getUUID());server.getPlayerList().getPlayers().remove(player);}
        }
    }
    private static Path verifyFixture(MinecraftServer server) {
        try {
            Path root=server.getWorldPath(LevelResource.ROOT).toRealPath();
            Path allowed=Path.of("D:/Codex-Projects/OPMouseHotkeyElectron/minecraft-server/advancement-privacy-test-fabric/build/native-fixtures").toRealPath();
            require(root.startsWith(allowed)&&Files.readString(root.resolve(".privacy-disposable-test")).equals("Private advancement native test v1\n"),"explicit disposable test scope");
            return root;
        } catch(Exception failure) { throw new IllegalStateException("Refusing privacy test outside project fixture",failure); }
    }
    private static void award(TestPlayer player,AdvancementHolder holder) {
        for(String criterion:holder.value().criteria().keySet()) require(player.getAdvancements().award(holder,criterion),"new vanilla criterion awarded");
    }
    private static void clear(List<TestPlayer> players) { for(TestPlayer p:players) {p.chat.clear();p.updates.clear();p.toasts.clear();} }
    private static void require(boolean condition,String label) {if(!condition)throw new IllegalStateException(label);}
    private static final class TestPlayer extends ServerPlayer {
        final List<String> chat=new ArrayList<>();
        final List<ClientboundUpdateAdvancementsPacket> updates=new ArrayList<>();
        final Map<Identifier,AdvancementHolder> known=new HashMap<>();
        final Set<Identifier> toasts=new HashSet<>();
        TestPlayer(MinecraftServer server,String name,UUID id) {
            super(server,server.overworld(),new GameProfile(id,name),ClientInformation.createDefault());
            connection=new ServerGamePacketListenerImpl(server,new net.minecraft.network.Connection(PacketFlow.SERVERBOUND),this,
                    CommonListenerCookie.createInitial(getGameProfile(),false)) {
                @Override public void send(Packet<?> packet) { capture(packet); }
                @Override public void send(Packet<?> packet,ChannelFutureListener listener) { capture(packet); }
            };
        }
        void capture(Packet<?> packet) {
            if(packet instanceof ClientboundSystemChatPacket message&&!message.overlay()) chat.add(message.content().getString());
            if(packet instanceof ClientboundUpdateAdvancementsPacket update) {
                updates.add(update);
                if(update.shouldReset())known.clear();
                update.getRemoved().forEach(known::remove);
                update.getAdded().forEach(holder->known.put(holder.id(),holder));
                if(!update.shouldReset()&&update.shouldShowAdvancements())update.getProgress().forEach((id,progress)->{
                    if(progress.isDone()&&known.containsKey(id)&&known.get(id).value().display().map(display->display.shouldShowToast()).orElse(false))toasts.add(id);
                });
            }
        }
        @Override public boolean hasDisconnected() {return false;}
    }
}
