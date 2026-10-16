package com.clickinterval.bounties;

import com.google.gson.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.UUID;
import java.util.HashSet;
import java.util.Set;

/** One bounded atomic ledger plus an embedded write-ahead inventory transaction.
 * Recovery never guesses from item counts: the player's native save contains a
 * unique transaction tag written with the inventory. Malformed data fails closed.
 */
public final class BountyStore {
    static final int MAX_BYTES = 8 * 1024 * 1024;
    static final int MAX_STATE_BYTES = 3 * 1024 * 1024;
    private final Path file;
    private JsonObject document;
    private long revision;
    @FunctionalInterface public interface MarkerReader { boolean exists(UUID player, String marker) throws IOException; }

    public BountyStore(Path file) throws IOException {
        this.file = file.toAbsolutePath().normalize();
        rejectLink(this.file);
        Files.createDirectories(this.file.getParent());
        rejectLink(this.file);
        if (!Files.notExists(this.file)) {
            if(!Files.isRegularFile(this.file,LinkOption.NOFOLLOW_LINKS)) throw new IOException("Bounty ledger is not an accessible regular file");
            if (Files.size(this.file) > MAX_BYTES) throw new IOException("Bounty ledger exceeds safety limit");
            try { document = JsonParser.parseString(Files.readString(this.file)).getAsJsonObject(); validate(document); }
            catch (RuntimeException invalid) { throw new IOException("Invalid bounty ledger; refusing to replace it", invalid); }
        } else {
            document = new JsonObject(); document.addProperty("version", 1); document.add("state", emptyState());
        }
    }
    public static JsonObject emptyState() {
        JsonObject state = new JsonObject(); state.add("players", new JsonObject());
        state.add("bounties", new JsonArray()); state.add("pending", new JsonObject()); return state;
    }
    static void validate(JsonObject doc) {
        if (doc.get("version").getAsInt() != 1) throw new IllegalArgumentException("Unknown ledger version");
        validateState(doc.getAsJsonObject("state"));
        if (doc.has("transaction")) {
            JsonObject tx=doc.getAsJsonObject("transaction"); UUID.fromString(tx.get("player").getAsString());
            if (!tx.get("marker").getAsString().startsWith("ci_bounty_tx:")) throw new IllegalArgumentException("Invalid marker");
            validateState(tx.getAsJsonObject("after"));
        }
    }
    private static void validateState(JsonObject state) {
        if (state == null || !state.get("players").isJsonObject() || !state.get("bounties").isJsonArray()
                || !state.get("pending").isJsonObject()) throw new IllegalArgumentException("Incomplete ledger");
        if (state.getAsJsonObject("players").size()>10000 || state.getAsJsonArray("bounties").size()>500)
            throw new IllegalArgumentException("Ledger limit exceeded");
        // Stable contribution IDs must be unique in both committed state and
        // prepared WAL state, before recovery can replace anything on disk.
        Set<UUID> ids=new HashSet<>();
        for(JsonElement value:state.getAsJsonArray("bounties")) {
            JsonObject bounty=value.getAsJsonObject();
            UUID id=UUID.fromString(bounty.get("id").getAsString());
            if(!ids.add(id)) throw new IllegalArgumentException("Duplicate bounty ID");
            UUID.fromString(bounty.get("target").getAsString());
            UUID.fromString(bounty.get("sponsor").getAsString());
            if(bounty.getAsJsonArray("rewards").isEmpty()) throw new IllegalArgumentException("Empty bounty reward");
        }
    }
    public JsonObject state() { return document.getAsJsonObject("state").deepCopy(); }
    /** Package-internal read-only view; mutations must always start with state(). */
    JsonObject readState() { return document.getAsJsonObject("state"); }
    long revision() { return revision; }
    public boolean hasTransaction() { return document.has("transaction"); }
    public void recover(MarkerReader reader) throws IOException {
        if (!hasTransaction()) return;
        JsonObject tx=document.getAsJsonObject("transaction");
        boolean committed=reader.exists(UUID.fromString(tx.get("player").getAsString()),tx.get("marker").getAsString());
        finish(committed);
    }
    public void begin(UUID player, String marker, JsonObject after) throws IOException {
        if (hasTransaction()) throw new IOException("An inventory transaction still needs recovery");
        JsonObject next=document.deepCopy(), tx=new JsonObject();
        tx.addProperty("player",player.toString()); tx.addProperty("marker",marker); tx.add("after",after.deepCopy());
        next.add("transaction",tx); write(next);
    }
    public void finish(boolean committed) throws IOException {
        if (!hasTransaction()) throw new IOException("No inventory transaction");
        JsonObject next=document.deepCopy();
        if (committed) next.add("state",next.getAsJsonObject("transaction").get("after"));
        next.remove("transaction"); write(next);
    }
    public void replace(JsonObject state) throws IOException {
        if (hasTransaction()) throw new IOException("An inventory transaction still needs recovery");
        JsonObject next=document.deepCopy(); next.add("state",state.deepCopy()); write(next);
    }
    private void write(JsonObject next) throws IOException {
        validate(next);
        // Leave space for BOTH before and after in the WAL so a full ledger can
        // always process claims; accepting a nearly 8 MiB state would strand them.
        if(next.getAsJsonObject("state").toString().getBytes(StandardCharsets.UTF_8).length>MAX_STATE_BYTES
                || next.has("transaction") && next.getAsJsonObject("transaction").getAsJsonObject("after").toString().getBytes(StandardCharsets.UTF_8).length>MAX_STATE_BYTES)
            throw new IOException("Bounty storage capacity reached; existing claims remain available");
        byte[] bytes=next.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length>MAX_BYTES) throw new IOException("Bounty ledger safety limit reached");
        rejectLink(file);
        Path temp=file.resolveSibling(file.getFileName()+".tmp-"+UUID.randomUUID());
        try {
            try (FileChannel channel=FileChannel.open(temp,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) {
                ByteBuffer buffer=ByteBuffer.wrap(bytes); while(buffer.hasRemaining()) channel.write(buffer); channel.force(true);
            }
            // No non-atomic fallback: failure leaves the previous committed ledger intact.
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            document=next; revision++;
        } finally { Files.deleteIfExists(temp); }
    }
    private static void rejectLink(Path path) throws IOException {
        for(Path part=path;part!=null;part=part.getParent()) if(Files.isSymbolicLink(part))
            throw new IOException("Refusing linked bounty storage path");
    }
}
