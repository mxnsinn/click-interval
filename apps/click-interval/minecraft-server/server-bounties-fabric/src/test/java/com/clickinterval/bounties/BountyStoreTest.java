package com.clickinterval.bounties;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class BountyStoreTest {
    @TempDir Path directory;
    private static final UUID PLAYER=UUID.fromString("2e1c63a0-c75a-4306-90b8-cbcbfab8ccaf");
    private static final String MARKER="ci_bounty_tx:example";
    private Path file() { return directory.resolve("ledger.json"); }
    private static JsonObject changed() { JsonObject state=BountyStore.emptyState(); state.getAsJsonObject("players").addProperty(PLAYER.toString(),"Sponsor"); return state; }
    @Test void newLedgerIsEmptyAndDefensive() throws Exception {
        BountyStore store=new BountyStore(file()); JsonObject copy=store.state(); copy.getAsJsonObject("players").addProperty("bad","x");
        assertEquals(0,store.state().getAsJsonObject("players").size()); assertFalse(store.hasTransaction());
    }
    @Test void atomicReplacementRoundTrips() throws Exception {
        BountyStore store=new BountyStore(file()); store.replace(changed()); assertEquals(changed(),new BountyStore(file()).state());
        try(var files=Files.list(directory)) { assertEquals(1,files.count()); }
    }
    @Test void preparedTransactionDoesNotExposeReward() throws Exception {
        BountyStore store=new BountyStore(file()); store.begin(PLAYER,MARKER,changed());
        assertEquals(BountyStore.emptyState(),store.state()); assertTrue(new BountyStore(file()).hasTransaction());
    }
    @Test void crashBeforePlayerSaveRollsBack() throws Exception {
        BountyStore store=new BountyStore(file()); store.begin(PLAYER,MARKER,changed());
        BountyStore reopened=new BountyStore(file()); reopened.recover((id,marker)->{assertEquals(PLAYER,id);assertEquals(MARKER,marker);return false;});
        assertEquals(BountyStore.emptyState(),reopened.state()); assertFalse(reopened.hasTransaction());
    }
    @Test void crashAfterPlayerSaveCommitsExactlyOnce() throws Exception {
        new BountyStore(file()).begin(PLAYER,MARKER,changed()); BountyStore reopened=new BountyStore(file());
        reopened.recover((id,marker)->true); assertEquals(changed(),reopened.state());
        new BountyStore(file()).recover((id,marker)->{fail("Committed transaction must not run again");return false;});
        assertFalse(new BountyStore(file()).hasTransaction());
    }
    @Test void unreadablePlayerSavePreservesJournalAndOldState() throws Exception {
        BountyStore store=new BountyStore(file()); store.begin(PLAYER,MARKER,changed()); String before=Files.readString(file());
        assertThrows(IOException.class,()->store.recover((id,marker)->{throw new IOException("broken NBT");}));
        assertEquals(before,Files.readString(file())); assertTrue(store.hasTransaction()); assertEquals(BountyStore.emptyState(),store.state());
    }
    @Test void unresolvedJournalBlocksOtherWrites() throws Exception {
        BountyStore store=new BountyStore(file()); store.begin(PLAYER,MARKER,changed());
        assertThrows(IOException.class,()->store.begin(PLAYER,MARKER,changed())); assertThrows(IOException.class,()->store.replace(changed()));
    }
    @Test void explicitAbortRetainsOldLedger() throws Exception {
        BountyStore store=new BountyStore(file()); store.replace(changed()); store.begin(PLAYER,MARKER,BountyStore.emptyState()); store.finish(false);
        assertEquals(changed(),new BountyStore(file()).state());
    }
    @Test void malformedExistingLedgerIsNotOverwritten() throws Exception {
        Files.writeString(file(),"{broken"); assertThrows(IOException.class,()->new BountyStore(file())); assertEquals("{broken",Files.readString(file()));
    }
    @Test void unknownVersionIsNotReset() throws Exception {
        Files.writeString(file(),"{\"version\":2,\"state\":{}}"); assertThrows(IOException.class,()->new BountyStore(file()));
    }
    @Test void oversizeReplacementKeepsPreviousCommit() throws Exception {
        BountyStore store=new BountyStore(file()); store.replace(changed()); JsonObject huge=changed(); huge.addProperty("huge","x".repeat(BountyStore.MAX_BYTES));
        assertThrows(IOException.class,()->store.replace(huge)); assertEquals(changed(),new BountyStore(file()).state());
    }
    @Test void committedStateAndCallerAfterAreIndependent() throws Exception {
        BountyStore store=new BountyStore(file()); JsonObject after=changed(); store.begin(PLAYER,MARKER,after); after.addProperty("mutated",true);
        store.finish(true); assertFalse(store.state().has("mutated"));
    }
    private static JsonObject activeBounty(UUID id) {
        JsonObject state=changed(),bounty=new JsonObject();
        bounty.addProperty("id",id.toString()); bounty.addProperty("sponsor",PLAYER.toString());
        bounty.addProperty("target","0f112a71-de8b-40bc-a3d1-0d0b65a0aa93");
        JsonArray rewards=new JsonArray(); JsonObject item=new JsonObject(); item.addProperty("id","minecraft:diamond"); item.addProperty("count",9); rewards.add(item);
        bounty.add("rewards",rewards); state.getAsJsonArray("bounties").add(bounty); return state;
    }
    private static JsonObject refunded(JsonObject active) {
        JsonObject state=active.deepCopy(); JsonArray rewards=state.getAsJsonArray("bounties").get(0).getAsJsonObject().getAsJsonArray("rewards").deepCopy();
        state.add("bounties",new JsonArray()); state.getAsJsonObject("pending").add(PLAYER.toString(),rewards); return state;
    }
    @Test void cancellationMoveIsOneDurableStateWithoutActivePayoutAndRefundTogether() throws Exception {
        BountyStore store=new BountyStore(file()); JsonObject active=activeBounty(UUID.randomUUID()); store.replace(active);
        JsonObject refund=refunded(active); store.replace(refund); BountyStore reopened=new BountyStore(file());
        assertEquals(0,reopened.state().getAsJsonArray("bounties").size());
        assertEquals(9,reopened.state().getAsJsonObject("pending").getAsJsonArray(PLAYER.toString()).get(0).getAsJsonObject().get("count").getAsInt());
        assertFalse(reopened.hasTransaction()); assertEquals(refund,reopened.state());
    }
    @Test void crashBeforeRefundInventorySavePreservesPendingNotActiveBounty() throws Exception {
        BountyStore store=new BountyStore(file()); JsonObject refund=refunded(activeBounty(UUID.randomUUID())); store.replace(refund);
        JsonObject paid=refund.deepCopy(); paid.getAsJsonObject("pending").remove(PLAYER.toString()); store.begin(PLAYER,MARKER,paid);
        BountyStore reopened=new BountyStore(file()); reopened.recover((id,marker)->false);
        assertEquals(refund,reopened.state()); assertTrue(reopened.state().getAsJsonArray("bounties").isEmpty());
    }
    @Test void crashAfterRefundInventorySaveConsumesPendingExactlyOnce() throws Exception {
        BountyStore store=new BountyStore(file()); JsonObject refund=refunded(activeBounty(UUID.randomUUID())); store.replace(refund);
        JsonObject paid=refund.deepCopy(); paid.getAsJsonObject("pending").remove(PLAYER.toString()); store.begin(PLAYER,MARKER,paid);
        BountyStore reopened=new BountyStore(file()); reopened.recover((id,marker)->true); assertEquals(paid,reopened.state());
        new BountyStore(file()).recover((id,marker)->{fail("No second refund recovery");return false;});
        assertTrue(new BountyStore(file()).state().getAsJsonObject("pending").isEmpty());
    }
    @Test void duplicateContributionIdsAreRejectedBeforeReplacingGoodState() throws Exception {
        BountyStore store=new BountyStore(file()); JsonObject active=activeBounty(UUID.randomUUID()); store.replace(active);
        JsonObject invalid=active.deepCopy(); invalid.getAsJsonArray("bounties").add(invalid.getAsJsonArray("bounties").get(0).deepCopy());
        assertThrows(IllegalArgumentException.class,()->store.replace(invalid)); assertEquals(active,new BountyStore(file()).state());
    }
    @Test void duplicateUuidSpellingsInWalAreRejectedBeforeJournalWrite() throws Exception {
        BountyStore store=new BountyStore(file()); JsonObject active=activeBounty(UUID.fromString("b2ecc230-fa7c-4fb4-b675-edc73930d95e")); store.replace(active);
        JsonObject invalid=active.deepCopy(),duplicate=invalid.getAsJsonArray("bounties").get(0).getAsJsonObject().deepCopy();
        duplicate.addProperty("id",duplicate.get("id").getAsString().toUpperCase(java.util.Locale.ROOT)); invalid.getAsJsonArray("bounties").add(duplicate);
        assertThrows(IllegalArgumentException.class,()->store.begin(PLAYER,MARKER,invalid));
        BountyStore reopened=new BountyStore(file()); assertFalse(reopened.hasTransaction()); assertEquals(active,reopened.state());
    }
    @Test void duplicateIdsInExistingWalFailClosedWithoutOverwritingEvidence() throws Exception {
        JsonObject active=activeBounty(UUID.randomUUID()),invalid=active.deepCopy();
        invalid.getAsJsonArray("bounties").add(invalid.getAsJsonArray("bounties").get(0).deepCopy());
        JsonObject document=new JsonObject(),transaction=new JsonObject(); document.addProperty("version",1); document.add("state",active);
        transaction.addProperty("player",PLAYER.toString()); transaction.addProperty("marker",MARKER); transaction.add("after",invalid); document.add("transaction",transaction);
        String evidence=document.toString(); Files.writeString(file(),evidence);
        assertThrows(IOException.class,()->new BountyStore(file())); assertEquals(evidence,Files.readString(file()));
    }
}
