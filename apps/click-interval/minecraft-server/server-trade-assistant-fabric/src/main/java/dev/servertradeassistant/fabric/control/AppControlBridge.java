package dev.servertradeassistant.fabric.control;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.servertradeassistant.fabric.mixin.MerchantOfferAccessor;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.AgeableMob;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.animal.Animal;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.trading.ItemCost;
import net.minecraft.world.item.trading.MerchantOffer;
import net.minecraft.world.item.trading.MerchantOffers;
import org.slf4j.Logger;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * Local, token-authenticated file bridge for the Electron host. Requests and entity capture are
 * processed on the server thread and never load chunks or mutate an entity that is not already
 * loaded. Snapshot serialization and file I/O run on a bounded, latest-value background writer.
 */
public final class AppControlBridge {
    public static final String PROTOCOL = "trade-assistant-control-v1";
    private static final long MAX_REQUEST_BYTES = 64L * 1024L;
    private static final int MAX_REQUESTS_PER_PASS = 8;
    private static final int MAX_RESPONSES = 256;
    private static final Pattern REQUEST_FILE = Pattern.compile("^[A-Za-z0-9_-]{1,64}\\.json$");
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private final Path root;
    private final Path inbox;
    private final Path processing;
    private final Path responses;
    private final Path tokenFile;
    private final Logger logger;
    private final LatestAsyncTask<JsonObject> mapSnapshotWriter;
    private MinecraftServer server;
    private String token = "";
    private long ticks;

    public AppControlBridge(Path configDirectory, Logger logger) {
        this.root = configDirectory;
        this.inbox = root.resolve("requests");
        this.processing = root.resolve("processing");
        this.responses = root.resolve("responses");
        this.tokenFile = root.resolve("control-token.txt");
        this.logger = logger;
        this.mapSnapshotWriter = new LatestAsyncTask<>(Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "server-protection-entity-snapshot");
            thread.setDaemon(true);
            thread.setPriority(Thread.MIN_PRIORITY);
            return thread;
        }), this::writeMapSnapshotNow);
    }

    public void start(MinecraftServer minecraftServer) {
        server = minecraftServer;
        try {
            Files.createDirectories(inbox);
            Files.createDirectories(processing);
            Files.createDirectories(responses);
            token = loadOrCreateToken();
            logger.info("Entity controls ready at {}", root);
        } catch (IOException error) {
            token = "";
            logger.error("Entity controls could not start", error);
        }
    }

    public void stop() {
        server = null;
        token = "";
        ticks = 0L;
    }

    public void tick(MinecraftServer minecraftServer) {
        if (server != minecraftServer || token.isEmpty()) return;
        ticks++;
        if (ticks % 20L == 0L) queueMapSnapshot();
        if (ticks % 4L != 0L) return;
        int processed = 0;
        try (DirectoryStream<Path> files = Files.newDirectoryStream(inbox, "*.json")) {
            for (Path request : files) {
                if (processed++ >= MAX_REQUESTS_PER_PASS) break;
                if (!REQUEST_FILE.matcher(request.getFileName().toString()).matches()) continue;
                processOne(request);
            }
        } catch (IOException error) {
            logger.warn("Could not scan entity control requests: {}", error.getMessage());
        }
        if (ticks % 1_200L == 0L) pruneResponses();
    }

    private void processOne(Path incoming) {
        Path claimed = processing.resolve(incoming.getFileName());
        try {
            move(incoming, claimed);
        } catch (IOException race) {
            return;
        }
        JsonObject response;
        String requestId = stripExtension(claimed.getFileName().toString());
        try {
            if (Files.size(claimed) > MAX_REQUEST_BYTES) throw new ControlException("Request is too large.");
            JsonObject request;
            try (Reader reader = Files.newBufferedReader(claimed, StandardCharsets.UTF_8)) {
                JsonElement parsed = JsonParser.parseReader(reader);
                if (!parsed.isJsonObject()) throw new ControlException("Request must be a JSON object.");
                request = parsed.getAsJsonObject();
            }
            if (!PROTOCOL.equals(requiredString(request, "protocol", 64))) {
                throw new ControlException("Unsupported protocol.");
            }
            String suppliedRequestId = requiredString(request, "requestId", 64);
            if (!REQUEST_FILE.matcher(suppliedRequestId + ".json").matches()
                    || !requestId.equals(suppliedRequestId)) {
                throw new ControlException("requestId must match the request filename.");
            }
            String suppliedToken = requiredString(request, "token", 128);
            if (!MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                    suppliedToken.getBytes(StandardCharsets.UTF_8))) {
                throw new ControlException("Authentication failed.");
            }
            response = success(requestId, dispatch(request));
        } catch (ControlException error) {
            response = failure(requestId, error.getMessage());
        } catch (RuntimeException | IOException error) {
            logger.warn("Entity control request {} failed: {}", requestId, error.getMessage());
            response = failure(requestId, "The request could not be completed.");
        }
        try {
            writeResponse(requestId, response);
        } catch (IOException error) {
            logger.warn("Could not write entity control response {}: {}", requestId, error.getMessage());
        } finally {
            try { Files.deleteIfExists(claimed); }
            catch (IOException error) { logger.debug("Could not remove processed request {}", claimed); }
        }
    }

    private JsonObject dispatch(JsonObject request) throws ControlException {
        String operation = requiredString(request, "operation", 64);
        if (operation.equals("listLoadedEntities") || operation.equals("listNearbyEntities")) {
            return listLoadedEntities(request, operation.equals("listNearbyEntities"));
        }
        UUID entityId = parseUuid(requiredString(request, "entityUuid", 64));
        Entity entity = loadedEntity(entityId);
        if (entity == null) throw new ControlException("That entity is not currently loaded.");
        return switch (operation) {
            case "inspectEntity" -> inspect(entity);
            case "setVillagerOffer" -> editVillagerOffer(entity, request);
            case "setVillagerBabyAge" -> setVillagerBabyAge(entity, request);
            case "setVillagerBreedingCooldown" -> setVillagerBreedingCooldown(entity, request);
            case "setAnimalBreedingCooldown" -> setAnimalBreedingCooldown(entity, request);
            default -> throw new ControlException("Unknown operation.");
        };
    }

    private JsonObject listLoadedEntities(JsonObject request, boolean nearbyOnly) throws ControlException {
        int limit = optionalInt(request, "limit", 128, 1, 512);
        String dimension = request.has("dimension") && !request.get("dimension").isJsonNull()
                ? requiredString(request, "dimension", 128) : "";
        double centerX = 0.0D;
        double centerY = 0.0D;
        double centerZ = 0.0D;
        double radiusSquared = Double.POSITIVE_INFINITY;
        if (nearbyOnly) {
            centerX = requiredDouble(request, "x", -30_000_000.0D, 30_000_000.0D);
            centerY = requiredDouble(request, "y", -4_096.0D, 4_096.0D);
            centerZ = requiredDouble(request, "z", -30_000_000.0D, 30_000_000.0D);
            double radius = optionalDouble(request, "radius", 64.0D, 2.0D, 256.0D);
            radiusSquared = radius * radius;
        }
        JsonArray entities = new JsonArray();
        MinecraftServer current = server;
        if (current != null) {
            outer:
            for (ServerLevel level : current.getAllLevels()) {
                String levelId = level.dimension().identifier().toString();
                if (!dimension.isEmpty() && !dimension.equals(levelId)) continue;
                for (Entity entity : level.getAllEntities()) {
                    if (entity.isRemoved()) continue;
                    if (nearbyOnly) {
                        double dx = entity.getX() - centerX;
                        double dy = entity.getY() - centerY;
                        double dz = entity.getZ() - centerZ;
                        if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;
                    }
                    entities.add(entitySummary(entity));
                    if (entities.size() >= limit) break outer;
                }
            }
        }
        JsonObject output = new JsonObject();
        output.addProperty("count", entities.size());
        output.addProperty("limit", limit);
        output.add("entities", entities);
        return output;
    }

    private JsonObject inspect(Entity entity) {
        JsonObject output = baseEntity(entity);
        if (entity instanceof AgeableMob ageable) {
            output.addProperty("ageTicks", ageable.getAge());
            output.addProperty("baby", ageable.isBaby());
            output.addProperty("breedingCooldownTicks", Math.max(0, ageable.getAge()));
        }
        if (entity instanceof Animal animal) output.addProperty("inLoveTicks", animal.getInLoveTime());
        if (entity instanceof Villager villager) {
            output.addProperty("villagerLevel", villager.getVillagerData().level());
            output.addProperty("villagerXp", villager.getVillagerXp());
            output.addProperty("profession", villager.getVillagerData().profession().unwrapKey()
                    .map(key -> key.identifier().toString()).orElse("unregistered"));
            JsonArray offers = new JsonArray();
            MerchantOffers current = villager.getOffers();
            for (int index = 0; index < current.size(); index++) {
                MerchantOffer offer = current.get(index);
                JsonObject value = new JsonObject();
                value.addProperty("index", index);
                addCost(value, "costA", offer.getItemCostA());
                if (offer.getItemCostB().isPresent()) addCost(value, "costB", offer.getItemCostB().orElseThrow());
                else value.add("costB", null);
                value.add("result", stack(offer.getResult()));
                value.addProperty("uses", offer.getUses());
                value.addProperty("maxUses", offer.getMaxUses());
                value.addProperty("xp", offer.getXp());
                value.addProperty("demand", offer.getDemand());
                value.addProperty("specialPriceDiff", offer.getSpecialPriceDiff());
                value.addProperty("priceMultiplier", offer.getPriceMultiplier());
                offers.add(value);
            }
            output.add("offers", offers);
        }
        return output;
    }

    private JsonObject editVillagerOffer(Entity entity, JsonObject request) throws ControlException {
        if (!(entity instanceof Villager villager)) throw new ControlException("Entity is not a villager.");
        if (villager.getTradingPlayer() != null) throw new ControlException("Close the villager trade screen before editing offers.");
        MerchantOffers offers = villager.getOffers();
        int index = requiredInt(request, "offerIndex", 0, Math.max(0, offers.size() - 1));
        if (offers.isEmpty()) throw new ControlException("Villager has no offers.");
        MerchantOffer offer = offers.get(index);
        MerchantOfferAccessor editable = (MerchantOfferAccessor) offer;

        ItemCost costA = updateCost(request, "costA", offer.getItemCostA(), false).orElseThrow();
        Optional<ItemCost> costB = updateCost(request, "costB", offer.getItemCostB().orElse(null), true);
        ItemStack result = updateResult(request, offer.getResult());
        int maxUses = optionalInt(request, "maxUses", offer.getMaxUses(), 1, 999);
        int xp = optionalInt(request, "xp", offer.getXp(), 0, 10_000);
        float multiplier = (float) optionalDouble(request, "priceMultiplier", offer.getPriceMultiplier(), 0.0D, 1.0D);

        if (offer.getUses() > maxUses) throw new ControlException("maxUses cannot be lower than current uses.");
        editable.tradeAssistant$setBaseCostA(costA);
        editable.tradeAssistant$setCostB(costB);
        editable.tradeAssistant$setResult(result);
        editable.tradeAssistant$setMaxUses(maxUses);
        editable.tradeAssistant$setXp(xp);
        editable.tradeAssistant$setPriceMultiplier(multiplier);
        JsonObject output = inspect(villager);
        output.addProperty("editedOfferIndex", index);
        return output;
    }

    private JsonObject setVillagerBabyAge(Entity entity, JsonObject request) throws ControlException {
        if (!(entity instanceof Villager villager)) throw new ControlException("Entity is not a villager.");
        int ticks = requiredInt(request, "babyAgeTicks", -1_200_000, 0);
        villager.setAge(ticks);
        return inspect(villager);
    }

    private JsonObject setVillagerBreedingCooldown(Entity entity, JsonObject request) throws ControlException {
        if (!(entity instanceof Villager villager)) throw new ControlException("Entity is not a villager.");
        if (villager.isBaby()) throw new ControlException("A baby villager does not have an adult breeding cooldown.");
        villager.setAge(requiredInt(request, "cooldownTicks", 0, 1_200_000));
        return inspect(villager);
    }

    private JsonObject setAnimalBreedingCooldown(Entity entity, JsonObject request) throws ControlException {
        if (!(entity instanceof Animal animal)) throw new ControlException("Entity is not a breedable animal.");
        if (animal.isBaby()) throw new ControlException("A baby animal does not have an adult breeding cooldown.");
        animal.setAge(requiredInt(request, "cooldownTicks", 0, 1_200_000));
        animal.resetLove();
        return inspect(animal);
    }

    private Optional<ItemCost> updateCost(JsonObject request, String prefix, ItemCost existing,
            boolean optional) throws ControlException {
        String itemKey = prefix + "Item";
        String countKey = prefix + "Count";
        boolean hasItem = request.has(itemKey) && !request.get(itemKey).isJsonNull();
        boolean hasCount = request.has(countKey) && !request.get(countKey).isJsonNull();
        if (!hasItem && !hasCount) return Optional.ofNullable(existing);
        int count = optionalInt(request, countKey, existing == null ? 1 : existing.count(), optional ? 0 : 1, 64);
        if (optional && count == 0) return Optional.empty();
        if (existing != null && !hasItem) {
            return Optional.of(new ItemCost(existing.item(), count, existing.components(),
                    existing.itemStack().copyWithCount(count)));
        }
        Item item = item(requiredString(request, itemKey, 128));
        return Optional.of(new ItemCost(item, count));
    }

    private ItemStack updateResult(JsonObject request, ItemStack existing) throws ControlException {
        boolean hasItem = request.has("resultItem") && !request.get("resultItem").isJsonNull();
        int count = optionalInt(request, "resultCount", existing.getCount(), 1, 64);
        ItemStack result = hasItem
                ? new ItemStack(item(requiredString(request, "resultItem", 128)), count)
                : existing.copyWithCount(count);
        if (result.isEmpty() || result.getItem() == Items.AIR) throw new ControlException("Result item cannot be air.");
        if (count > result.getMaxStackSize()) throw new ControlException("Result count exceeds that item's stack size.");
        return result;
    }

    private static Item item(String value) throws ControlException {
        Identifier identifier = Identifier.tryParse(value);
        if (identifier == null) throw new ControlException("Invalid item ID.");
        Item item = BuiltInRegistries.ITEM.getOptional(identifier)
                .orElseThrow(() -> new ControlException("Unknown item ID: " + value));
        if (item == Items.AIR) throw new ControlException("Item cannot be air.");
        return item;
    }

    private Entity loadedEntity(UUID uuid) {
        MinecraftServer current = server;
        if (current == null) return null;
        for (ServerLevel level : current.getAllLevels()) {
            Entity entity = level.getEntityInAnyDimension(uuid);
            if (entity != null && !entity.isRemoved()) return entity;
        }
        return null;
    }

    private static JsonObject baseEntity(Entity entity) {
        JsonObject output = new JsonObject();
        output.addProperty("entityUuid", entity.getStringUUID());
        output.addProperty("entityType", BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());
        output.addProperty("name", entity.getDisplayName().getString());
        output.addProperty("dimension", entity.level().dimension().identifier().toString());
        output.addProperty("x", entity.getX());
        output.addProperty("y", entity.getY());
        output.addProperty("z", entity.getZ());
        return output;
    }

    private static JsonObject entitySummary(Entity entity) {
        JsonObject output = baseEntity(entity);
        output.addProperty("stableId", stableId(entity.getUUID()));
        output.addProperty("player", entity instanceof Player);
        if (entity instanceof AgeableMob ageable) {
            output.addProperty("baby", ageable.isBaby());
            output.addProperty("ageTicks", ageable.getAge());
            output.addProperty("breedingCooldownTicks", Math.max(0, ageable.getAge()));
        }
        return output;
    }

    private static void addCost(JsonObject destination, String name, ItemCost cost) {
        JsonObject value = new JsonObject();
        value.addProperty("item", BuiltInRegistries.ITEM.getKey(cost.item().value()).toString());
        value.addProperty("count", cost.count());
        destination.add(name, value);
    }

    private static JsonObject stack(ItemStack stack) {
        JsonObject value = new JsonObject();
        value.addProperty("item", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        value.addProperty("count", stack.getCount());
        return value;
    }

    private String loadOrCreateToken() throws IOException {
        if (Files.isRegularFile(tokenFile)) {
            String existing = Files.readString(tokenFile, StandardCharsets.UTF_8).trim();
            if (existing.matches("^[a-f0-9]{64}$")) return existing;
            throw new IOException("control-token.txt is invalid");
        }
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        String generated = HexFormat.of().formatHex(bytes);
        Files.writeString(tokenFile, generated + System.lineSeparator(), StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        try {
            Files.setPosixFilePermissions(tokenFile, Set.of(
                    PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException ignored) { }
        return generated;
    }

    private void writeResponse(String requestId, JsonObject response) throws IOException {
        Path destination = responses.resolve(requestId + ".json");
        Path temporary = responses.resolve(requestId + ".json.tmp");
        Files.writeString(temporary, GSON.toJson(response), StandardCharsets.UTF_8,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
        move(temporary, destination);
    }

    private void queueMapSnapshot() {
        MinecraftServer current = server;
        if (current == null || mapSnapshotWriter.busy()) return;
        JsonArray entities = new JsonArray();
        outer:
        for (ServerLevel level : current.getAllLevels()) {
            for (Entity entity : level.getAllEntities()) {
                if (entity.isRemoved() || entity instanceof Player) continue;
                entities.add(entitySummary(entity));
                if (entities.size() >= 512) break outer;
            }
        }
        JsonObject snapshot = new JsonObject();
        snapshot.addProperty("protocol", PROTOCOL);
        snapshot.addProperty("generatedAt", System.currentTimeMillis());
        snapshot.addProperty("truncated", entities.size() >= 512);
        snapshot.add("entities", entities);
        mapSnapshotWriter.submit(snapshot);
    }

    private void writeMapSnapshotNow(JsonObject snapshot) {
        Path temporary = root.resolve("map-snapshot.json.tmp");
        Path destination = root.resolve("map-snapshot.json");
        try {
            Files.writeString(temporary, GSON.toJson(snapshot), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            move(temporary, destination);
        } catch (IOException | RuntimeException error) {
            logger.debug("Could not write entity snapshot: {}", error.getMessage());
        }
    }

    /** Coalesces bursts to the newest value and never executes the consumer on the caller thread. */
    static final class LatestAsyncTask<T> {
        private final Executor executor;
        private final Consumer<T> consumer;
        private final AtomicReference<T> latest = new AtomicReference<>();
        private final AtomicBoolean scheduled = new AtomicBoolean();

        LatestAsyncTask(Executor executor, Consumer<T> consumer) {
            this.executor = java.util.Objects.requireNonNull(executor, "executor");
            this.consumer = java.util.Objects.requireNonNull(consumer, "consumer");
        }

        boolean busy() {
            return scheduled.get();
        }

        void submit(T value) {
            latest.set(java.util.Objects.requireNonNull(value, "value"));
            schedule();
        }

        private void schedule() {
            if (!scheduled.compareAndSet(false, true)) return;
            try {
                executor.execute(this::drain);
            } catch (RuntimeException rejected) {
                scheduled.set(false);
                throw rejected;
            }
        }

        private void drain() {
            try {
                T value;
                while ((value = latest.getAndSet(null)) != null) consumer.accept(value);
            } finally {
                scheduled.set(false);
                // A submission can race the empty read above while scheduled is still true.
                if (latest.get() != null) schedule();
            }
        }
    }

    private void pruneResponses() {
        try (var files = Files.list(responses)) {
            Path[] responsesByAge = files.filter(Files::isRegularFile)
                    .sorted(Comparator.comparingLong(AppControlBridge::lastModifiedSafe).reversed())
                    .toArray(Path[]::new);
            for (int index = MAX_RESPONSES; index < responsesByAge.length; index++) {
                Files.deleteIfExists(responsesByAge[index]);
            }
        } catch (IOException error) {
            logger.debug("Could not prune entity control responses: {}", error.getMessage());
        }
    }

    private static long lastModifiedSafe(Path path) {
        try { return Files.getLastModifiedTime(path).toMillis(); }
        catch (IOException ignored) { return Long.MIN_VALUE; }
    }

    private static void move(Path source, Path destination) throws IOException {
        try {
            Files.move(source, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(source, destination, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static JsonObject success(String requestId, JsonObject data) {
        JsonObject response = new JsonObject();
        response.addProperty("protocol", PROTOCOL);
        response.addProperty("requestId", requestId);
        response.addProperty("ok", true);
        response.add("data", data);
        return response;
    }

    private static JsonObject failure(String requestId, String message) {
        JsonObject response = new JsonObject();
        response.addProperty("protocol", PROTOCOL);
        response.addProperty("requestId", requestId);
        response.addProperty("ok", false);
        response.addProperty("error", message);
        return response;
    }

    private static String requiredString(JsonObject object, String key, int maximum) throws ControlException {
        if (!object.has(key) || object.get(key).isJsonNull() || !object.get(key).isJsonPrimitive()) {
            throw new ControlException("Missing " + key + ".");
        }
        String value = object.get(key).getAsString().trim();
        if (value.isEmpty() || value.length() > maximum) throw new ControlException("Invalid " + key + ".");
        return value;
    }

    private static int requiredInt(JsonObject object, String key, int minimum, int maximum) throws ControlException {
        if (maximum < minimum) throw new ControlException("No offer exists at that index.");
        if (!object.has(key)) throw new ControlException("Missing " + key + ".");
        try {
            java.math.BigDecimal decimal = object.get(key).getAsBigDecimal().stripTrailingZeros();
            if (decimal.scale() > 0) throw new ControlException(key + " must be a whole number.");
            int value = decimal.intValueExact();
            if (value < minimum || value > maximum) throw new ControlException(key + " is out of range.");
            return value;
        } catch (ArithmeticException | NumberFormatException | UnsupportedOperationException error) {
            throw new ControlException("Invalid " + key + ".");
        }
    }

    private static int optionalInt(JsonObject object, String key, int fallback, int minimum, int maximum)
            throws ControlException {
        return object.has(key) && !object.get(key).isJsonNull()
                ? requiredInt(object, key, minimum, maximum) : fallback;
    }

    private static double optionalDouble(JsonObject object, String key, double fallback,
            double minimum, double maximum) throws ControlException {
        if (!object.has(key) || object.get(key).isJsonNull()) return fallback;
        try {
            double value = object.get(key).getAsDouble();
            if (!Double.isFinite(value) || value < minimum || value > maximum) {
                throw new ControlException(key + " is out of range.");
            }
            return value;
        } catch (NumberFormatException | UnsupportedOperationException error) {
            throw new ControlException("Invalid " + key + ".");
        }
    }

    private static double requiredDouble(JsonObject object, String key, double minimum, double maximum)
            throws ControlException {
        if (!object.has(key) || object.get(key).isJsonNull()) throw new ControlException("Missing " + key + ".");
        return optionalDouble(object, key, Double.NaN, minimum, maximum);
    }

    private static UUID parseUuid(String value) throws ControlException {
        try { return UUID.fromString(value); }
        catch (IllegalArgumentException invalid) { throw new ControlException("Invalid entity UUID."); }
    }

    private static String stripExtension(String name) {
        return name.endsWith(".json") ? name.substring(0, name.length() - 5) : name;
    }

    private static String stableId(UUID uuid) {
        String compact = uuid.toString().replace("-", "").toUpperCase(java.util.Locale.ROOT);
        return compact.substring(compact.length() - 8);
    }

    private static final class ControlException extends Exception {
        private static final long serialVersionUID = 1L;

        private ControlException(String message) { super(message); }
    }
}
