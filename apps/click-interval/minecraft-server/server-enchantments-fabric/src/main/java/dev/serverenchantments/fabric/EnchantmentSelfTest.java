package dev.serverenchantments.fabric;

import com.mojang.authlib.GameProfile;
import com.mojang.serialization.JsonOps;
import dev.serverenchantments.fabric.core.HarvestBudget;
import dev.serverenchantments.fabric.core.HarvestConfig;
import io.netty.buffer.Unpooled;
import net.fabricmc.fabric.api.event.player.AttackBlockCallback;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.Connection;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.RegistryOps;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.tags.EnchantmentTags;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.entity.EntitySection;
import net.minecraft.world.level.entity.EntitySectionStorage;
import net.minecraft.world.level.entity.PersistentEntitySectionManager;
import net.minecraft.world.phys.AABB;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.HashSet;
import java.util.Set;
import java.util.ArrayList;
import java.util.Collections;

/** Runs only with -Dserverenchantments.selftest=true, in disposable smoke worlds. */
final class EnchantmentSelfTest {
    private static final Logger LOGGER = LoggerFactory.getLogger("serverenchantments_fabric");
    private static final UUID PLAYER_ID = UUID.fromString("7ab52673-5482-4e18-bad3-46b4ce53a289");
    private EnchantmentSelfTest() { }

    static void run(MinecraftServer server, ServerEnchantmentsFabric mod) {
        try {
            Holder<Enchantment> chop = enchantment(server, "cheery_chop");
            Holder<Enchantment> wide = enchantment(server, "wide_miner");
            Holder<Enchantment> harvest = enchantment(server, "harvester_sweep");
            Holder<Enchantment> smelter = enchantment(server, "smelter");
            require("Tree Chop".equals(chop.value().description().getString()), "legacy chop ID displays Tree Chop");
            require("Miner's Sweep".equals(wide.value().description().getString()), "legacy pickaxe ID displays Miner's Sweep");
            require(chop.value().getMaxLevel()==1 && wide.value().getMaxLevel()==2,"one chop level and two Sweep levels");
            require(!Enchantment.getFullname(wide,1).equals(Enchantment.getFullname(wide,2)),"native level I/II display components differ");
            require("Harvester Sweep".equals(harvest.value().description().getString()) && harvest.value().getMaxLevel()==3,
                    "Harvester Sweep has three native levels");
            require("Smelter".equals(smelter.value().description().getString()) && smelter.value().getMaxLevel()==1,
                    "Smelter has one native level");
            for (Holder<Enchantment> holder : List.of(chop, wide, harvest, smelter)) {
                require(holder.is(EnchantmentTags.IN_ENCHANTING_TABLE), "enchanting-table registry tag");
                require(holder.is(EnchantmentTags.TRADEABLE), "librarian registry tag");
                require(holder.value().getWeight() == 1, "rare enchantment weight");
            }
            require(chop.value().isSupportedItem(new ItemStack(Items.DIAMOND_AXE)), "axe supported");
            require(!chop.value().isSupportedItem(new ItemStack(Items.DIAMOND_PICKAXE)), "pickaxe rejected for chop");
            require(wide.value().isSupportedItem(new ItemStack(Items.DIAMOND_PICKAXE)), "pickaxe supported");
            require(!wide.value().isSupportedItem(new ItemStack(Items.DIAMOND_AXE)), "axe rejected for strip");
            roundTrip(server, enchanted(Items.DIAMOND_AXE, chop), chop);
            roundTrip(server, enchanted(Items.DIAMOND_PICKAXE, wide), wide);
            roundTrip(server, enchanted(Items.DIAMOND_PICKAXE, wide,2), wide);
            for(int harvestLevel=1;harvestLevel<=3;harvestLevel++)
                roundTrip(server, enchanted(Items.DIAMOND_HOE, harvest,harvestLevel), harvest);
            roundTrip(server, enchanted(Items.DIAMOND_PICKAXE, smelter), smelter);
            nativeBreakTests(server, mod, chop, wide);
            nativeSweepCombination(server,wide);
            nativeNewCombinations(server,harvest,smelter);
            AnvilSelfTest.run(server);
            HarvesterSelfTest.run(server,mod);
            SmelterSelfTest.run(server,mod);
            EnchantmentToggleSelfTest.run(server, mod);
            LOGGER.info("SERVER_ENCHANTMENTS_SELFTEST_PASS: legacy tree/mining regressions, Harvester I/II/III, native Smelter drops, paid book/tool upgrades, save/network codecs and native anvil cap.");
        } catch (Throwable failure) {
            LOGGER.error("SERVER_ENCHANTMENTS_SELFTEST_FAIL", failure);
            throw new IllegalStateException("Server enchantments isolated self-test failed", failure);
        }
    }

    private static void nativeBreakTests(MinecraftServer server, ServerEnchantmentsFabric mod,
                                         Holder<Enchantment> chop, Holder<Enchantment> wide) {
        ServerLevel level = server.overworld();
        GameProfile profile = new GameProfile(PLAYER_ID, "EnchantSelfTest");
        ServerPlayer player = new ServerPlayer(server, level, profile, ClientInformation.createDefault());
        Connection connection = new Connection(PacketFlow.SERVERBOUND);
        player.connection = new ServerGamePacketListenerImpl(server, connection, player,
                CommonListenerCookie.createInitial(profile, false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        BlockPos origin = new BlockPos(104, level.getMaxY() - 16, 104);
        level.getChunk(origin.getX() >> 4, origin.getZ() >> 4);
        player.setPos(origin.getX() + .5, origin.getY(), origin.getZ() + 2.5);
        BlockPos[] denied = {null};
        PlayerBlockBreakEvents.BEFORE.register((world, actor, pos, state, blockEntity) ->
                !PLAYER_ID.equals(actor.getUUID()) || !pos.equals(denied[0]));
        HarvestBudget originalBudget=field(mod,"budget",HarvestBudget.class);
        HarvestConfig originalConfig=field(mod,"config",HarvestConfig.class);
        try (Fixture fixture = new Fixture(level, origin)) {
            // Measure the real production 2ms guard before touching its timing allowance.
            // An unfinished callback is explicitly recorded as queued fallback, not immediate.
            measureProductionCallbacks(server,mod,fixture,player,origin,chop,wide);
            // Only this explicitly opted-in disposable-world selftest neutralizes cold-JIT
            // timing for deterministic native geometry/protection assertions. Work counters
            // are unchanged; separate unit tests and measurements exercise the real deadline.
            setField(mod,"budget",new HarvestBudget(Long.MAX_VALUE));
            mod.beginTick(server);
            fixture.tree();
            ItemStack axe = enchanted(Items.DIAMOND_AXE, chop);
            player.setItemInHand(InteractionHand.MAIN_HAND, axe);
            require(player.gameMode.destroyBlock(origin), "native root break");
            for (int y = 0; y < 4; y++) require(level.getBlockState(origin.above(y)).isAir(), "whole four-log tree harvested before any tick drain");
            require(axe.getDamageValue() == 4, "one vanilla durability per tree log");
            require(fixture.drops(Items.OAK_LOG) == 4, "native tree drops");

            // Every clicked face and both horizontal facings for top/bottom mining.
            for(int enchantLevel=1;enchantLevel<=2;enchantLevel++) for(Direction face:Direction.values())
                for(float yaw:new float[]{0,90}) {
                    fixture.reset();fixture.cube();mod.beginTick(server);player.setYRot(yaw);
                    ItemStack pick=enchanted(Items.DIAMOND_PICKAXE,wide,enchantLevel);
                    player.setItemInHand(InteractionHand.MAIN_HAND,pick);
                    Set<BlockPos> expected=sweepCells(origin,face,player.getDirection(),enchantLevel);
                    strike(player,origin,face);
                    require(player.gameMode.destroyBlock(origin),"native Sweep center");
                    require(countAir(level,expected)==expected.size(),"Sweep "+enchantLevel+" "+face+" completes within native callback");
                    fixture.assertOnlyMined(expected);
                    require(pick.getDamageValue()==expected.size(),"native per-block Sweep durability");
                    require(fixture.drops(Items.COBBLESTONE)==expected.size(),"native per-block Sweep drops");
                }

            fixture.reset();
            fixture.cube();mod.beginTick(server);
            ItemStack pick = enchanted(Items.DIAMOND_PICKAXE, wide,2);
            player.setItemInHand(InteractionHand.MAIN_HAND, pick);
            denied[0] = origin.offset(1, 0, 0);
            strike(player, origin);
            require(player.gameMode.destroyBlock(origin), "protected strip center break");
            require(level.getBlockState(origin.offset(-1, 0, 0)).isAir(), "unprotected first extra mined");
            require(level.getBlockState(denied[0]).is(Blocks.STONE), "Fabric BEFORE cancellation honored");
            require(level.getBlockState(origin.below()).is(Blocks.STONE), "cancellation stops other Sweep rows");
            require(pick.getDamageValue() == 2 && fixture.drops(Items.COBBLESTONE) == 2, "cancelled blocks neither damage nor drop");
            advance(server,mod);
            require(fixture.drops(Items.COBBLESTONE)==2,"cancelled job never resumes on a later tick");
            denied[0] = null;

            fixture.reset();fixture.tree();mod.beginTick(server);
            axe=enchanted(Items.WOODEN_AXE,chop);axe.setDamageValue(axe.getMaxDamage()-1);
            player.setItemInHand(InteractionHand.MAIN_HAND,axe);
            require(player.gameMode.destroyBlock(origin),"last-durability axe root break");
            int lastAxeDrops=fixture.drops(Items.OAK_LOG);
            require(player.getMainHandItem().isEmpty() && level.getBlockState(origin.above()).is(Blocks.OAK_LOG)
                    && level.getBlockState(origin.above(2)).is(Blocks.OAK_LOG) && level.getBlockState(origin.above(3)).is(Blocks.OAK_LOG)
                    && lastAxeDrops==1,"root must spend its own last axe durability before any extra log; drops="+lastAxeDrops);
            advance(server,mod);
            require(fixture.drops(Items.OAK_LOG)==1,"last-durability axe queues no later harvesting");

            fixture.reset();
            fixture.tree();mod.beginTick(server);
            axe = enchanted(Items.WOODEN_AXE, chop);
            axe.setDamageValue(axe.getMaxDamage() - 2);
            player.setItemInHand(InteractionHand.MAIN_HAND, axe);
            require(player.gameMode.destroyBlock(origin), "nearly broken axe root break");
            require(player.getMainHandItem().isEmpty(), "axe breaks with vanilla durability");
            int remaining = 0;
            for (int y = 0; y < 4; y++) if (level.getBlockState(origin.above(y)).is(Blocks.OAK_LOG)) remaining++;
            int toolBreakDrops=fixture.drops(Items.OAK_LOG);
            LOGGER.info("SERVER_ENCHANTMENTS_TOOL_BREAK_DIAGNOSTIC: tree remainingLogs={}, droppedLogs={}, originalStackCount={}, originalStackDamage={}, currentHandEmpty={}, states={}",
                    remaining,toolBreakDrops,axe.getCount(),axe.getDamageValue(),player.getMainHandItem().isEmpty(),
                    List.of(level.getBlockState(origin),level.getBlockState(origin.above()),level.getBlockState(origin.above(2)),level.getBlockState(origin.above(3))));
            require(remaining == 2 && toolBreakDrops == 2, "tree job stops immediately at tool break: expected remaining=2/drops=2, actual remaining="+remaining+"/drops="+toolBreakDrops);
            advance(server,mod);
            require(fixture.drops(Items.OAK_LOG)==2,"broken tool never continues in fallback");

            fixture.reset();fixture.cube();mod.beginTick(server);
            pick=enchanted(Items.WOODEN_PICKAXE,wide,2);pick.setDamageValue(pick.getMaxDamage()-1);
            player.setItemInHand(InteractionHand.MAIN_HAND,pick);strike(player,origin);
            require(player.gameMode.destroyBlock(origin),"last-durability Sweep center");
            require(player.getMainHandItem().isEmpty() && countAir(level,sweepCells(origin,Direction.NORTH,player.getDirection(),2))==1
                    && fixture.drops(Items.COBBLESTONE)==1,"root must spend its own last pick durability before any Sweep extras");
            advance(server,mod);
            require(fixture.drops(Items.COBBLESTONE)==1,"last-durability pick queues no later harvesting");

            fixture.reset();fixture.cube();mod.beginTick(server);
            pick=enchanted(Items.WOODEN_PICKAXE,wide,2);pick.setDamageValue(pick.getMaxDamage()-2);
            player.setItemInHand(InteractionHand.MAIN_HAND,pick);strike(player,origin);
            require(player.gameMode.destroyBlock(origin),"nearly broken Sweep pick center");
            int sweepToolBreakDrops=fixture.drops(Items.COBBLESTONE);
            long sweepToolBreakMined=countAir(level,sweepCells(origin,Direction.NORTH,player.getDirection(),2));
            LOGGER.info("SERVER_ENCHANTMENTS_TOOL_BREAK_DIAGNOSTIC: Sweep mined={}, droppedCobble={}, originalStackCount={}, originalStackDamage={}, currentHandEmpty={}",
                    sweepToolBreakMined,sweepToolBreakDrops,pick.getCount(),pick.getDamageValue(),player.getMainHandItem().isEmpty());
            require(player.getMainHandItem().isEmpty() && sweepToolBreakMined==2 && sweepToolBreakDrops==2,
                    "Sweep immediately stops on native tool break: expected mined=2/drops=2, actual mined="+sweepToolBreakMined+"/drops="+sweepToolBreakDrops);
            advance(server,mod);
            require(fixture.drops(Items.COBBLESTONE)==2,"broken Sweep never resumes");

            fixture.reset();fixture.cube();mod.beginTick(server);
            fixture.set(origin.offset(-1,0,0),Blocks.FURNACE.defaultBlockState());
            fixture.set(origin.offset(1,0,0),Blocks.OBSIDIAN.defaultBlockState());
            fixture.set(origin.below(),Blocks.BEDROCK.defaultBlockState());
            pick=enchanted(Items.DIAMOND_PICKAXE,wide,2);player.setItemInHand(InteractionHand.MAIN_HAND,pick);strike(player,origin);
            require(player.gameMode.destroyBlock(origin),"guarded Sweep center");
            require(level.getBlockState(origin.offset(-1,0,0)).is(Blocks.FURNACE),"container/block entity retained");
            require(level.getBlockState(origin.offset(1,0,0)).is(Blocks.OBSIDIAN),"harder blocks not instant-mined");
            require(level.getBlockState(origin.below()).is(Blocks.BEDROCK),"unbreakable block retained");
            require(pick.getDamageValue()==6 && fixture.drops(Items.COBBLESTONE)==6,"only eligible six blocks paid and dropped");

            fixture.reset();fixture.tree();mod.beginTick(server);
            PlacedLogs placed=level.getDataStorage().computeIfAbsent(PlacedLogs.TYPE);
            placed.add(origin.asLong());
            axe=enchanted(Items.DIAMOND_AXE,chop);player.setItemInHand(InteractionHand.MAIN_HAND,axe);
            require(player.gameMode.destroyBlock(origin),"manually placed root can break normally");
            advance(server,mod);
            require(axe.getDamageValue()==1 && fixture.drops(Items.OAK_LOG)==1,"player-placed tree does not trigger extra harvest");

            fixture.reset();fixture.cube();mod.beginTick(server);player.setShiftKeyDown(true);
            pick=enchanted(Items.DIAMOND_PICKAXE,wide,2);player.setItemInHand(InteractionHand.MAIN_HAND,pick);strike(player,origin);
            require(player.gameMode.destroyBlock(origin),"sneaking root break");
            advance(server,mod);player.setShiftKeyDown(false);
            require(pick.getDamageValue()==1 && fixture.drops(Items.COBBLESTONE)==1,"sneak bypass stays ordinary one-block mining");

            // Exact low counter forces queued fallback independent of the wall clock.
            fixture.reset();fixture.cube();
            setField(mod,"config",new HarvestConfig(128,1,1024,8));mod.beginTick(server);
            pick=enchanted(Items.DIAMOND_PICKAXE,wide,2);player.setItemInHand(InteractionHand.MAIN_HAND,pick);strike(player,origin);
            require(player.gameMode.destroyBlock(origin),"budget-limited Sweep center");
            require(pick.getDamageValue()==2,"one global extra-break credit used inline");
            mod.tick(server);
            require(pick.getDamageValue()==2,"end-of-same-tick cannot replenish inline budget");
            advance(server,mod);
            require(pick.getDamageValue()==9 && fixture.drops(Items.COBBLESTONE)==9,"bounded subsequent ticks finish remaining eight extras exactly once");

            fixture.reset();fixture.cube();mod.beginTick(server);
            pick=enchanted(Items.DIAMOND_PICKAXE,wide,2);player.setItemInHand(InteractionHand.MAIN_HAND,pick);strike(player,origin);
            require(player.gameMode.destroyBlock(origin),"tool-change fallback center");
            require(pick.getDamageValue()==2,"tool-change fixture actually queued remaining work");
            player.setItemInHand(InteractionHand.MAIN_HAND,new ItemStack(Items.DIAMOND_PICKAXE));
            advance(server,mod);
            require(pick.getDamageValue()==2 && fixture.drops(Items.COBBLESTONE)==2,"switching tool cancels queued work");
        } finally {
            denied[0] = null;
            player.setShiftKeyDown(false);
            player.setItemInHand(InteractionHand.MAIN_HAND, ItemStack.EMPTY);
            try { advance(server, mod); }
            finally {
                setField(mod,"budget",originalBudget);
                setField(mod,"config",originalConfig);
                mod.beginTick(server);
                player.discard();
            }
        }
    }

    private static void strike(ServerPlayer player, BlockPos pos) {
        strike(player,pos,Direction.NORTH);
    }
    private static void strike(ServerPlayer player,BlockPos pos,Direction face) {
        AttackBlockCallback.EVENT.invoker().interact(player,player.level(),InteractionHand.MAIN_HAND,pos,face);
    }
    private static void advance(MinecraftServer server, ServerEnchantmentsFabric mod) {
        for (int tick = 0; tick < 180; tick++) { mod.beginTick(server);mod.tick(server); }
    }
    private static <T> T field(ServerEnchantmentsFabric mod,String name,Class<T> type) {
        try {
            var field=ServerEnchantmentsFabric.class.getDeclaredField(name);
            field.setAccessible(true);
            return type.cast(field.get(mod));
        } catch(ReflectiveOperationException failure) { throw new IllegalStateException("Self-test field "+name,failure); }
    }
    private static void setField(ServerEnchantmentsFabric mod,String name,Object value) {
        try {
            var field=ServerEnchantmentsFabric.class.getDeclaredField(name);
            field.setAccessible(true);field.set(mod,value);
        } catch(ReflectiveOperationException failure) { throw new IllegalStateException("Self-test field "+name,failure); }
    }
    private static Set<BlockPos> sweepCells(BlockPos center,Direction face,Direction facing,int enchantLevel) {
        Set<BlockPos> result=new HashSet<>();result.add(center);
        if(enchantLevel==1) {
            boolean x=face.getAxis()==Direction.Axis.Z || (face.getAxis()==Direction.Axis.Y && facing.getAxis()==Direction.Axis.Z);
            result.add(center.offset(x?-1:0,0,x?0:-1));
            result.add(center.offset(x?1:0,0,x?0:1));
        } else for(int a=-1;a<=1;a++) for(int b=-1;b<=1;b++) result.add(switch(face.getAxis()) {
            case X -> center.offset(0,a,b);
            case Y -> center.offset(a,0,b);
            case Z -> center.offset(a,b,0);
        });
        return result;
    }
    private static long countAir(ServerLevel level,Set<BlockPos> positions) {
        return positions.stream().filter(pos->level.getBlockState(pos).isAir()).count();
    }
    private static void measureProductionCallbacks(MinecraftServer server,ServerEnchantmentsFabric mod,Fixture fixture,
                                                    ServerPlayer player,BlockPos origin,Holder<Enchantment> chop,Holder<Enchantment> wide) {
        for(int mode=0;mode<3;mode++) {
            List<Long> elapsedMicros=new ArrayList<>();
            List<Long> immediateBlocks=new ArrayList<>();
            int fullCallbacks=0;
            for(int attempt=0;attempt<8;attempt++) {
                fixture.reset();
                Set<BlockPos> expected;
                ItemStack tool;
                if(mode==0) {
                    fixture.tree();expected=new HashSet<>();
                    for(int y=0;y<4;y++) expected.add(origin.above(y));
                    tool=enchanted(Items.DIAMOND_AXE,chop);
                } else {
                    fixture.cube();expected=sweepCells(origin,Direction.NORTH,Direction.SOUTH,mode);
                    tool=enchanted(Items.DIAMOND_PICKAXE,wide,mode);
                }
                player.setYRot(0);player.setItemInHand(InteractionHand.MAIN_HAND,tool);
                mod.beginTick(server);strike(player,origin);
                long started=System.nanoTime();
                require(player.gameMode.destroyBlock(origin),"real-budget warm native center");
                long elapsed=(System.nanoTime()-started)/1000;
                long immediate=countAir(player.level(),expected); // Before any simulated tick advancement.
                if(attempt>=3) {
                    elapsedMicros.add(elapsed);immediateBlocks.add(immediate);
                    if(immediate==expected.size()) fullCallbacks++;
                }
                advance(server,mod); // Queued fallback completion is verified separately, never counted as immediate.
                require(countAir(player.level(),expected)==expected.size(),"real-budget native fallback completes");
                require(tool.getDamageValue()==expected.size(),"real-budget native exact durability");
            }
            List<Long> sorted=new ArrayList<>(elapsedMicros);Collections.sort(sorted);
            LOGGER.info("SERVER_ENCHANTMENTS_NATIVE_TIMING: mode={}, productionBudgetNanos=2000000, warmup=3, samples=5, sameCallbackComplete={}, immediateBlocks={}, callbackMicros={}, min/median/max={}/{}/{}; deferred work was NOT counted as immediate",
                    mode==0?"oak4":mode==1?"sweepI3":"sweepII9",fullCallbacks,immediateBlocks,elapsedMicros,sorted.getFirst(),sorted.get(2),sorted.getLast());
        }
        fixture.reset();
    }
    private static void nativeSweepCombination(MinecraftServer server,Holder<Enchantment> wide) {
        GameProfile profile=new GameProfile(UUID.fromString("740b7b63-1359-4087-9a64-88479c1d32ba"),"SweepAnvilTest");
        ServerPlayer player=new ServerPlayer(server,server.overworld(),profile,ClientInformation.createDefault());
        player.connection=new ServerGamePacketListenerImpl(server,new Connection(PacketFlow.SERVERBOUND),player,CommonListenerCookie.createInitial(profile,false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        AnvilMenu menu=null;
        try {
            for(Item firstItem:List.of(Items.ENCHANTED_BOOK,Items.DIAMOND_PICKAXE)) {
                ItemStack first=enchanted(firstItem,wide,1);
                first.set(DataComponents.REPAIR_COST,63);
                menu=new AnvilMenu(78,player.getInventory());player.containerMenu=menu;
                menu.getSlot(0).set(first);menu.getSlot(1).set(enchanted(Items.ENCHANTED_BOOK,wide,1));menu.createResult();
                require(menu.getCost()==39,"expensive Sweep I+I upgrade capped at39");
                require(EnchantmentHelper.getEnchantmentsForCrafting(menu.getSlot(2).getItem()).getLevel(wide)==2,"native I+I produces Sweep II on book/tool");
                player.experienceLevel=38;menu.clicked(2,0,ContainerInput.PICKUP,player);
                require(menu.getCarried().isEmpty() && player.experienceLevel==38,"Sweep upgrade cannot bypass XP payment");
                player.experienceLevel=100;menu.clicked(2,0,ContainerInput.PICKUP,player);
                require(player.experienceLevel==61,"Sweep upgrade deducts exactly39 levels");
                require(EnchantmentHelper.getEnchantmentsForCrafting(menu.getCarried()).getLevel(wide)==2,"paid result keeps levelII");
                require(menu.getSlot(0).getItem().isEmpty() && menu.getSlot(1).getItem().isEmpty() && menu.getSlot(2).getItem().isEmpty(),"Sweep upgrade consumes both inputs without duplicate output");
                clearAnvil(menu);
            }
            menu=new AnvilMenu(78,player.getInventory());player.containerMenu=menu;
            menu.getSlot(0).set(enchanted(Items.ENCHANTED_BOOK,wide,2));
            menu.getSlot(1).set(enchanted(Items.ENCHANTED_BOOK,wide,2));menu.createResult();
            require(EnchantmentHelper.getEnchantmentsForCrafting(menu.getSlot(2).getItem()).getLevel(wide)==2,"II+II never creates unsupported Sweep III");
            clearAnvil(menu);
            menu.getSlot(0).set(new ItemStack(Items.DIAMOND_AXE));
            menu.getSlot(1).set(enchanted(Items.ENCHANTED_BOOK,wide,2));menu.createResult();
            require(menu.getSlot(2).getItem().isEmpty(),"Sweep II anvil application rejects axes");
            LOGGER.info("SERVER_SWEEP_LEVELS_SELFTEST_PASS: native paid book/tool I+I=II,39-level cap/insufficientXP, input consumption, noIII, axe rejection.");
        } finally {
            if(menu!=null) clearAnvil(menu);
            player.containerMenu=player.inventoryMenu;player.discard();
        }
    }
    private static void nativeNewCombinations(MinecraftServer server,Holder<Enchantment> harvest,Holder<Enchantment> smelter) {
        GameProfile profile=new GameProfile(UUID.fromString("0b1c9c51-2d12-4a43-b050-3a7e3a901b67"),"NewEnchantAnvil");
        ServerPlayer player=new ServerPlayer(server,server.overworld(),profile,ClientInformation.createDefault());
        player.connection=new ServerGamePacketListenerImpl(server,new Connection(PacketFlow.SERVERBOUND),player,CommonListenerCookie.createInitial(profile,false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        AnvilMenu menu=new AnvilMenu(79,player.getInventory());player.containerMenu=menu;
        try {
            for(Item item:List.of(Items.ENCHANTED_BOOK,Items.DIAMOND_HOE)) for(int tier=1;tier<=3;tier++) {
                menu.getSlot(0).set(enchanted(item,harvest,tier));
                menu.getSlot(1).set(enchanted(Items.ENCHANTED_BOOK,harvest,tier));menu.createResult();
                int expected=Math.min(3,tier+1),cost=menu.getCost();
                require(cost>0 && cost<=39,"Harvester upgrade has bounded nonzero XP payment");
                require(EnchantmentHelper.getEnchantmentsForCrafting(menu.getSlot(2).getItem()).getLevel(harvest)==expected,"native Harvester level upgrade/cap");
                player.experienceLevel=100;menu.clicked(2,0,ContainerInput.PICKUP,player);
                require(player.experienceLevel==100-cost,"Harvester exact XP payment");
                require(EnchantmentHelper.getEnchantmentsForCrafting(menu.getCarried()).getLevel(harvest)==expected,"paid Harvester result retains level");
                require(menu.getSlot(0).getItem().isEmpty() && menu.getSlot(1).getItem().isEmpty() && menu.getSlot(2).getItem().isEmpty(),"Harvester input consumption/no duplicate");
                clearAnvil(menu);
            }
            menu.getSlot(0).set(new ItemStack(Items.DIAMOND_PICKAXE));
            menu.getSlot(1).set(enchanted(Items.ENCHANTED_BOOK,harvest,3));menu.createResult();
            require(menu.getSlot(2).getItem().isEmpty(),"Harvester rejects non-hoe tools");clearAnvil(menu);
            var silk=server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(net.minecraft.world.item.enchantment.Enchantments.SILK_TOUCH);
            for(boolean reverse:new boolean[]{false,true}) {
                menu.getSlot(0).set(enchanted(Items.DIAMOND_PICKAXE,reverse?smelter:silk));
                menu.getSlot(1).set(enchanted(Items.ENCHANTED_BOOK,reverse?silk:smelter));menu.createResult();
                require(menu.getSlot(2).getItem().isEmpty(),"Smelter/Silk incompatibility in both anvil orders");clearAnvil(menu);
            }
            menu.getSlot(0).set(new ItemStack(Items.DIAMOND_PICKAXE));
            menu.getSlot(1).set(enchanted(Items.ENCHANTED_BOOK,smelter));menu.createResult();
            require(EnchantmentHelper.getEnchantmentsForCrafting(menu.getSlot(2).getItem()).getLevel(smelter)==1,"Smelter book applies to pickaxe");
            int cost=menu.getCost();require(cost>0,"Smelter is not free");player.experienceLevel=100;menu.clicked(2,0,ContainerInput.PICKUP,player);
            require(player.experienceLevel==100-cost && menu.getSlot(0).getItem().isEmpty() && menu.getSlot(1).getItem().isEmpty(),"Smelter native XP/item payment");
            LOGGER.info("SERVER_NEW_ENCHANT_ANVIL_SELFTEST_PASS: Harvester I+I=II/II+II=III/III cap, paid books/hoes, tool restriction and Smelter/Silk incompatibility both orders.");
        } finally {clearAnvil(menu);player.containerMenu=player.inventoryMenu;player.discard();}
    }

    private static void clearAnvil(AnvilMenu menu) {
        menu.setCarried(ItemStack.EMPTY);menu.getSlot(0).set(ItemStack.EMPTY);menu.getSlot(1).set(ItemStack.EMPTY);menu.createResult();
    }
    private static Holder<Enchantment> enchantment(MinecraftServer server, String name) {
        return server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(ResourceKey.create(
                Registries.ENCHANTMENT, Identifier.fromNamespaceAndPath("serverenchantments", name)));
    }
    private static ItemStack enchanted(Item item, Holder<Enchantment> enchantment) {
        return enchanted(item,enchantment,1);
    }
    private static ItemStack enchanted(Item item, Holder<Enchantment> enchantment,int level) {
        ItemStack stack = new ItemStack(item);
        stack.enchant(enchantment, level);
        return stack;
    }
    private static void roundTrip(MinecraftServer server, ItemStack stack, Holder<Enchantment> enchantment) {
        int expectedLevel=EnchantmentHelper.getEnchantmentsForCrafting(stack).getLevel(enchantment);
        RegistryOps<com.google.gson.JsonElement> ops = RegistryOps.create(JsonOps.INSTANCE, server.registryAccess());
        var saved = ItemStack.CODEC.encodeStart(ops, stack).getOrThrow();
        ItemStack loaded = ItemStack.CODEC.parse(ops, saved).getOrThrow();
        require(EnchantmentHelper.getEnchantmentsForCrafting(loaded).getLevel(enchantment)==expectedLevel, "saved tool enchantment level retained");
        RegistryFriendlyByteBuf buffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), server.registryAccess());
        try {
            ItemStack.STREAM_CODEC.encode(buffer, loaded);
            ItemStack received = ItemStack.STREAM_CODEC.decode(buffer);
            require(EnchantmentHelper.getEnchantmentsForCrafting(received).getLevel(enchantment)==expectedLevel, "vanilla wire tool enchantment level retained");
        } finally { buffer.release(); }
    }
    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    static final class Fixture implements AutoCloseable {
        private final ServerLevel level;
        private final BlockPos origin;
        private final Map<BlockPos, BlockState> original = new LinkedHashMap<>();
        private final AABB area;
        private final EntitySectionStorage<Entity> entitySections;
        private final Set<UUID> preexistingItems;
        @SuppressWarnings("unchecked")
        Fixture(ServerLevel level, BlockPos origin) {
            this.level = level;
            this.origin = origin;
            area = new AABB(origin.getX()-4, origin.getY()-2, origin.getZ()-4,
                    origin.getX()+5, origin.getY()+7, origin.getZ()+5);
            // SERVER_STARTED precedes entity tracking for the synchronously loaded fixture
            // chunk. Normal spatial queries intentionally omit its HIDDEN sections. Inspect
            // the real world-owned section instead; do not invent or substitute loot results.
            // Reflection exists only in this explicitly gated disposable-world self-test.
            try {
                var managerField = ServerLevel.class.getDeclaredField("entityManager");
                managerField.setAccessible(true);
                var sectionsField = PersistentEntitySectionManager.class.getDeclaredField("sectionStorage");
                sectionsField.setAccessible(true);
                entitySections = (EntitySectionStorage<Entity>) sectionsField.get(managerField.get(level));
            } catch (ReflectiveOperationException failure) {
                throw new IllegalStateException("Unable to inspect actual fixture item entities", failure);
            }
            preexistingItems = new HashSet<>();
            storedItems().forEach(item -> preexistingItems.add(item.getUUID()));
        }
        void set(BlockPos pos, BlockState state) {
            original.putIfAbsent(pos.immutable(), level.getBlockState(pos));
            level.setBlock(pos, state, 2);
        }
        void tree() {
            set(origin.below(), Blocks.DIRT.defaultBlockState());
            for (int y = 0; y < 4; y++) set(origin.above(y), Blocks.OAK_LOG.defaultBlockState());
            for (Direction side : new Direction[]{Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST})
                set(origin.above(3).relative(side), Blocks.OAK_LEAVES.defaultBlockState());
        }
        void cube() {
            for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++) for(int z=-2;z<=2;z++)
                set(origin.offset(x,y,z),Blocks.STONE.defaultBlockState());
        }
        void assertOnlyMined(Set<BlockPos> expected) {
            for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++) for(int z=-2;z<=2;z++) {
                BlockPos pos=origin.offset(x,y,z);
                require(expected.contains(pos)?level.getBlockState(pos).isAir():level.getBlockState(pos).is(Blocks.STONE),
                        "exact face-plane selection; unrelated surrounding block "+pos+" retained");
            }
        }
        int drops(Item item) {
            int visible = level.getEntitiesOfClass(ItemEntity.class, area).stream().filter(e -> e.getItem().is(item))
                    .mapToInt(e -> e.getItem().getCount()).sum();
            int stored = fixtureItems().stream().filter(e -> e.getItem().is(item))
                    .mapToInt(e -> e.getItem().getCount()).sum();
            LOGGER.info("Enchant self-test native drops for {}: spatially visible={}, world-owned={}", item, visible, stored);
            return stored;
        }
        private List<ItemEntity> storedItems() {
            return entitySections.getExistingSectionsInChunk(ChunkPos.pack(origin.getX() >> 4, origin.getZ() >> 4))
                    .flatMap(EntitySection::getEntities).filter(entity -> entity instanceof ItemEntity)
                    .map(entity -> (ItemEntity) entity).filter(item -> !item.isRemoved() && area.intersects(item.getBoundingBox())).toList();
        }
        private List<ItemEntity> fixtureItems() {
            return storedItems().stream().filter(item -> !preexistingItems.contains(item.getUUID())).toList();
        }
        void reset() {
            fixtureItems().forEach(ItemEntity::discard);
            original.forEach((pos, state) -> level.setBlock(pos, state, 2));
            original.clear();
        }
        @Override public void close() { reset(); }
    }
}
