package com.clickinterval.market;

import com.google.gson.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Atomic ledger plus one write-ahead transaction. Never infer completion from item counts. */
public final class MarketStore {
    static final int MAX_STATE_BYTES=3*1024*1024, MAX_BYTES=8*1024*1024;
    static final String MARKER_PREFIX="ci_market_tx:";
    private final Path file;
    @FunctionalInterface interface BeforeReplace { void check() throws IOException; }
    private final BeforeReplace beforeReplace;
    private JsonObject document;
    private long revision;
    @FunctionalInterface public interface MarkerReader { boolean exists(UUID player,String marker) throws IOException; }
    public MarketStore(Path file) throws IOException {
        this(file,()->{});
    }
    MarketStore(Path file,BeforeReplace beforeReplace) throws IOException {
        this.beforeReplace=beforeReplace;
        this.file=file.toAbsolutePath().normalize(); rejectLinks(this.file);
        Files.createDirectories(this.file.getParent()); rejectLinks(this.file);
        if(Files.notExists(this.file)) {
            document=new JsonObject(); document.addProperty("version",1); document.add("state",emptyState());
        } else {
            if(!Files.isRegularFile(this.file,LinkOption.NOFOLLOW_LINKS) || Files.size(this.file)>MAX_BYTES)
                throw new IOException("Unsafe market ledger; refusing to reset escrow");
            try {
                document=JsonParser.parseString(Files.readString(this.file)).getAsJsonObject();
                migrateState(document.getAsJsonObject("state"));
                if(document.has("transaction")) migrateState(document.getAsJsonObject("transaction").getAsJsonObject("after"));
                validate(document);
            }
            catch(RuntimeException e) { throw new IOException("Invalid market ledger; refusing to reset escrow",e); }
        }
    }
    static JsonObject emptyState() {
        JsonObject state=new JsonObject(); state.add("listings",new JsonArray()); state.add("pending",new JsonObject());
        state.add("auctions",new JsonArray()); state.addProperty("auctionClock",0L); return state;
    }
    private static void migrateState(JsonObject state) {
        // Version 1 market-only ledgers predate auction support. Fill ONLY absent
        // fields; a present malformed field must still fail closed.
        if(!state.has("auctions")) state.add("auctions",new JsonArray());
        if(!state.has("auctionClock")) state.addProperty("auctionClock",0L);
    }
    static void validate(JsonObject doc) {
        if(doc.get("version").getAsInt()!=1) throw new IllegalArgumentException("Unsupported market version");
        validateState(doc.getAsJsonObject("state"));
        if(doc.has("transaction")) {
            JsonObject tx=doc.getAsJsonObject("transaction"); UUID.fromString(tx.get("player").getAsString());
            String marker=tx.get("marker").getAsString();
            if(!marker.startsWith(MARKER_PREFIX)) throw new IllegalArgumentException("Invalid journal marker");
            UUID.fromString(marker.substring(MARKER_PREFIX.length())); validateState(tx.getAsJsonObject("after"));
        }
    }
    private static void validateState(JsonObject state) {
        if(state==null || !state.get("listings").isJsonArray() || !state.get("pending").isJsonObject())
            throw new IllegalArgumentException("Incomplete market state");
        if(bytes(state)>MAX_STATE_BYTES || state.getAsJsonArray("listings").size()>500)
            throw new IllegalArgumentException("Market entry limit exceeded");
        if(!state.get("auctions").isJsonArray() || state.getAsJsonArray("auctions").size()>500
                || state.get("auctionClock").getAsBigDecimal().longValueExact()<0) throw new IllegalArgumentException("Invalid auction state");
        Set<UUID> ids=new HashSet<>();
        for(JsonElement value:state.getAsJsonArray("listings")) {
            JsonObject listing=value.getAsJsonObject();
            if(!ids.add(UUID.fromString(listing.get("id").getAsString()))) throw new IllegalArgumentException("Duplicate listing");
            UUID.fromString(listing.get("seller").getAsString());
            if(!listing.get("name").getAsString().matches("[A-Za-z0-9_]{1,16}")) throw new IllegalArgumentException("Bad seller name");
            if(!listing.get("offer").isJsonObject() || !listing.get("want").isJsonObject()) throw new IllegalArgumentException("Missing items");
            int count=listing.get("count").getAsInt(); if(count<1 || count>4096) throw new IllegalArgumentException("Invalid wanted count");
        }
        for(var entry:state.getAsJsonObject("pending").entrySet()) {
            UUID.fromString(entry.getKey());
            if(!entry.getValue().isJsonArray() || entry.getValue().getAsJsonArray().isEmpty()) throw new IllegalArgumentException("Invalid pending items");
            for(JsonElement item:entry.getValue().getAsJsonArray()) if(!item.isJsonObject()) throw new IllegalArgumentException("Invalid pending item");
        }
        for(JsonElement value:state.getAsJsonArray("auctions")) {
            JsonObject auction=value.getAsJsonObject();
            if(!ids.add(UUID.fromString(auction.get("id").getAsString()))) throw new IllegalArgumentException("Duplicate escrow ID");
            UUID seller=UUID.fromString(auction.get("seller").getAsString());
            if(!auction.get("name").getAsString().matches("[A-Za-z0-9_]{1,16}") || !auction.get("offer").isJsonObject() || !auction.get("want").isJsonObject())
                throw new IllegalArgumentException("Malformed auction parties/items");
            long start=auction.get("opened").getAsBigDecimal().longValueExact(),end=auction.get("deadline").getAsBigDecimal().longValueExact();
            long duration=Math.subtractExact(end,start);
            if(start<0 || duration<60_000L || duration>604_800_000L || auction.get("revision").getAsBigDecimal().longValueExact()<0)
                throw new IllegalArgumentException("Invalid auction timing/revision");
            int minimum=auction.get("minimum").getAsBigDecimal().intValueExact();
            if(minimum<1 || minimum>4096) throw new IllegalArgumentException("Invalid minimum bid");
            if(auction.has("highest")) {
                JsonObject bid=auction.getAsJsonObject("highest"); UUID bidder=UUID.fromString(bid.get("bidder").getAsString());
                int amount=bid.get("amount").getAsBigDecimal().intValueExact();
                if(bidder.equals(seller) || !bid.get("name").getAsString().matches("[A-Za-z0-9_]{1,16}") || amount<minimum || amount>4096
                        || bid.getAsJsonArray("payment").isEmpty()) throw new IllegalArgumentException("Invalid escrowed bid");
            }
        }
    }
    public JsonObject state() { return document.getAsJsonObject("state").deepCopy(); }
    JsonObject readState() { return document.getAsJsonObject("state"); }
    long revision() { return revision; }
    boolean hasTransaction() { return document.has("transaction"); }
    JsonObject preparedState() { return hasTransaction()?document.getAsJsonObject("transaction").getAsJsonObject("after").deepCopy():state(); }
    public void recover(MarkerReader reader) throws IOException {
        if(!hasTransaction()) return;
        JsonObject tx=document.getAsJsonObject("transaction");
        finish(reader.exists(UUID.fromString(tx.get("player").getAsString()),tx.get("marker").getAsString()));
    }
    public void begin(UUID player,String marker,JsonObject after) throws IOException {
        if(hasTransaction()) throw new IOException("Unresolved market journal");
        JsonObject next=document.deepCopy(),tx=new JsonObject(); tx.addProperty("player",player.toString());
        tx.addProperty("marker",marker); tx.add("after",after.deepCopy()); next.add("transaction",tx); write(next);
    }
    public void finish(boolean committed) throws IOException {
        if(!hasTransaction()) throw new IOException("No market journal");
        JsonObject next=document.deepCopy();
        if(committed) next.add("state",next.getAsJsonObject("transaction").get("after"));
        next.remove("transaction"); write(next);
    }
    public void replace(JsonObject state) throws IOException {
        if(hasTransaction()) throw new IOException("Unresolved market journal");
        JsonObject next=document.deepCopy(); next.add("state",state.deepCopy()); write(next);
    }
    private void write(JsonObject next) throws IOException {
        if(bytes(next.getAsJsonObject("state"))>MAX_STATE_BYTES || next.has("transaction") && bytes(next.getAsJsonObject("transaction").getAsJsonObject("after"))>MAX_STATE_BYTES)
            throw new IOException("Market state capacity reached");
        validate(next);
        byte[] bytes=next.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAX_BYTES) throw new IOException("Market document capacity reached");
        rejectLinks(file); Path temporary=file.resolveSibling(file.getFileName()+".tmp-"+UUID.randomUUID());
        try {
            try(FileChannel output=FileChannel.open(temporary,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) {
                ByteBuffer data=ByteBuffer.wrap(bytes); while(data.hasRemaining()) output.write(data); output.force(true);
            }
            // No unsafe replace fallback. Both old and new documents are self-contained.
            beforeReplace.check();
            Files.move(temporary,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            document=next; revision++;
        } finally { Files.deleteIfExists(temporary); }
    }
    static int bytes(JsonElement value) { return value.toString().getBytes(StandardCharsets.UTF_8).length; }
    static void rejectLinks(Path path) throws IOException {
        for(Path part=path;part!=null;part=part.getParent()) if(Files.isSymbolicLink(part)) throw new IOException("Linked market storage path");
    }
}
