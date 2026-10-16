package com.clickinterval.market;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

class MarketStoreTest {
    @TempDir Path directory;
    private JsonObject next() {
        JsonObject state=MarketStore.emptyState(); state.addProperty("fixture",42); return state;
    }
    private String marker() { return MarketStore.MARKER_PREFIX+UUID.randomUUID(); }
    @Test void preparedJournalAbortAndCommitAreIdempotent() throws Exception {
        Path path=directory.resolve("ledger.json"); MarketStore store=new MarketStore(path);
        store.begin(UUID.randomUUID(),marker(),next());
        MarketStore restart=new MarketStore(path); assertTrue(restart.hasTransaction());
        restart.recover((id,mark)->false); assertFalse(restart.state().has("fixture"));
        restart.recover((id,mark)->{ fail("already resolved"); return true; });
        restart.begin(UUID.randomUUID(),marker(),next());
        restart=new MarketStore(path); restart.recover((id,mark)->true);
        assertEquals(42,restart.state().get("fixture").getAsInt()); assertFalse(restart.hasTransaction());
        assertEquals(restart.state(),new MarketStore(path).state());
    }
    @Test void failedBeginAndFinishNeverPartiallyReplaceLedger() throws Exception {
        AtomicBoolean fail=new AtomicBoolean(false); Path path=directory.resolve("ledger.json");
        MarketStore store=new MarketStore(path,()->{ if(fail.get()) throw new IOException("injected durable replace failure"); });
        store.replace(MarketStore.emptyState()); String original=Files.readString(path);
        fail.set(true); assertThrows(IOException.class,()->store.begin(UUID.randomUUID(),marker(),next()));
        assertEquals(original,Files.readString(path)); assertFalse(store.hasTransaction());
        fail.set(false); store.begin(UUID.randomUUID(),marker(),next()); String prepared=Files.readString(path);
        fail.set(true); assertThrows(IOException.class,()->store.finish(true));
        assertEquals(prepared,Files.readString(path)); assertTrue(store.hasTransaction()); assertFalse(store.state().has("fixture"));
        assertThrows(IOException.class,()->store.finish(false)); assertEquals(prepared,Files.readString(path));
        MarketStore recovered=new MarketStore(path); recovered.recover((id,mark)->true);
        assertEquals(next(),recovered.state());
    }
    @Test void unreadableDecisionPreservesJournalAndCanRecoverLater() throws Exception {
        Path path=directory.resolve("ledger.json"); MarketStore store=new MarketStore(path);
        store.begin(UUID.randomUUID(),marker(),next()); String prepared=Files.readString(path);
        assertThrows(IOException.class,()->store.recover((id,mark)->{ throw new IOException("unreadable player.dat"); }));
        assertTrue(store.hasTransaction()); assertEquals(prepared,Files.readString(path));
        store.recover((id,mark)->false); assertEquals(MarketStore.emptyState(),store.state());
    }
    @Test void malformedLedgerNotResetAndUnknownVersionsRejected() throws Exception {
        Path path=directory.resolve("ledger.json"); Files.writeString(path,"{broken");
        assertThrows(IOException.class,()->new MarketStore(path)); assertEquals("{broken",Files.readString(path));
        Files.writeString(path,"{\"version\":999,\"state\":{}}"); String content=Files.readString(path);
        assertThrows(IOException.class,()->new MarketStore(path)); assertEquals(content,Files.readString(path));
    }
    @Test void preparedStateValidatedAndDoubleBeginDenied() throws Exception {
        Path path=directory.resolve("ledger.json"); MarketStore store=new MarketStore(path); store.replace(MarketStore.emptyState());
        JsonObject invalid=MarketStore.emptyState(); invalid.getAsJsonObject("pending").add("not-a-uuid",new JsonArray());
        assertThrows(IllegalArgumentException.class,()->store.begin(UUID.randomUUID(),marker(),invalid));
        assertFalse(store.hasTransaction());
        store.begin(UUID.randomUUID(),marker(),next());
        assertThrows(IOException.class,()->store.begin(UUID.randomUUID(),marker(),next()));
        assertThrows(IOException.class,()->store.replace(next()));
    }
    @Test void stateSnapshotsCannotMutateEscrowAndSizeGuardReservesJournalSpace() throws Exception {
        MarketStore store=new MarketStore(directory.resolve("ledger.json")); store.replace(next());
        store.state().addProperty("fixture",0); assertEquals(42,store.state().get("fixture").getAsInt());
        JsonObject huge=next(); huge.addProperty("too_large","x".repeat(MarketStore.MAX_STATE_BYTES));
        assertThrows(IOException.class,()->store.replace(huge)); assertEquals(next(),store.state());
    }
    @Test void onlyOrdinaryLeftClicksInTopInventoryAreActions() {
        for(int slot=-1000;slot<100;slot++) for(int button=-1;button<10;button++) {
            assertEquals(slot>=0 && slot<54 && button==0,MenuPolicy.accepts(slot,button,true));
            assertFalse(MenuPolicy.accepts(slot,button,false));
        }
    }
    @Test void legacyMarketStateAndPreparedJournalMigrateWithoutLosingEscrow() throws Exception {
        Path path=directory.resolve("ledger.json"); MarketStore store=new MarketStore(path);
        JsonObject old=MarketStore.emptyState(); UUID owner=UUID.randomUUID(); JsonArray pending=new JsonArray();
        JsonObject item=new JsonObject(); item.addProperty("id","minecraft:diamond"); item.addProperty("count",3); pending.add(item);
        old.getAsJsonObject("pending").add(owner.toString(),pending); store.replace(old); store.begin(owner,marker(),old);
        JsonObject legacy=JsonParser.parseString(Files.readString(path)).getAsJsonObject();
        for(JsonObject state:new JsonObject[]{legacy.getAsJsonObject("state"),legacy.getAsJsonObject("transaction").getAsJsonObject("after")}) {
            state.remove("auctions"); state.remove("auctionClock");
        }
        Files.writeString(path,legacy.toString()); String untouched=Files.readString(path);
        MarketStore upgraded=new MarketStore(path); assertEquals(untouched,Files.readString(path));
        assertEquals(pending,upgraded.state().getAsJsonObject("pending").get(owner.toString()));
        assertTrue(upgraded.state().getAsJsonArray("auctions").isEmpty()); upgraded.recover((id,mark)->true);
        assertEquals(old,upgraded.state()); assertFalse(upgraded.hasTransaction());
    }
    @Test void malformedPresentAuctionFieldsNeverSilentlyMigrate() throws Exception {
        Path path=directory.resolve("ledger.json"); MarketStore store=new MarketStore(path); store.replace(MarketStore.emptyState());
        JsonObject broken=JsonParser.parseString(Files.readString(path)).getAsJsonObject(); broken.getAsJsonObject("state").addProperty("auctions","not-an-array");
        Files.writeString(path,broken.toString()); String input=Files.readString(path);
        assertThrows(IOException.class,()->new MarketStore(path)); assertEquals(input,Files.readString(path));
    }
}
