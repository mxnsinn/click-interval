package dev.serverteleport.fabric;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TeleportCommandSurfaceTest {
    private static final Path SERVER_TELEPORT_SOURCE = Path.of(
            "src", "main", "java", "dev", "serverteleport", "fabric", "ServerTeleportFabric.java");

    @Test
    void randomIsAnOrdinaryLiteralWithItsOwnRouteAndBoundedAsyncSafety() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        assertTrue(source.contains("dispatcher.register(Commands.literal(\"rtpa\").executes(context -> teleportRandom(context.getSource())))"));
        assertFalse(source.contains("Commands.literal(\"random\")"));
        assertFalse(source.contains("suggestions.put(\"random\", \"random\")"));
        int start = source.indexOf("private int teleportRandom(");
        String route = source.substring(start, source.indexOf("private int teleportToSavedLocation(", start));
        assertTrue(route.contains("ServerLevel destination = owner.level()"));
        assertFalse(route.contains("source.getServer().overworld()"));
        assertTrue(route.contains("dimensionAllowed(owner, destination)"));
        assertTrue(route.contains("Math.min(10_000, config.randomTeleportRadius())"));
        assertTrue(source.contains("UnexploredRegionCheck.clear(region, cx, cz, 8)"));
        assertTrue(source.contains("chunk.hasAnyStructureReferences()"));
        assertTrue(source.contains("chunk.getAllStarts().values().stream().anyMatch(start -> start.isValid())"));
        assertTrue(route.contains("requests.remainingCooldownMillis"));
        assertTrue(route.contains("requests.startLocalTravelCooldown"));
        assertTrue(route.contains("revokeOutgoingBeforeLocalTravel"));
        assertTrue(route.contains("dispatchTeleport(owner"));
        assertTrue(route.contains("TravelGroupTrigger.RANDOM"));
        assertFalse(route.contains("findOnlineByName"));
        assertTrue(source.contains("MAX_RANDOM_AREAS = 8"));
        assertTrue(source.contains("MAX_RANDOM_SEARCHES = 2"));
        assertTrue(source.contains("searchedRandomAreaThisTick"));
        assertTrue(source.contains("getHeight(Heightmap.Types.WORLD_SURFACE"));
        assertTrue(source.contains("!destination.getBlockState(floor).isFaceSturdy"));
        assertTrue(source.contains("RandomLandingSafety.hazardous"));
        assertTrue(source.contains("if (random == null && !inRecentPvp"));
    }

    @Test
    void manualEntityTargetingCommandsAreNotRegistered() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);

        assertFalse(source.contains("Commands.literal(\"bring\")"));
        assertFalse(source.contains("Commands.literal(\"entity\")"));
        assertFalse(source.contains("EntityArgument"));
        assertFalse(source.contains("ProjectileUtil"));
        assertFalse(source.contains("teleportLookedAtEntityToSavedLocation"));
        assertFalse(source.contains("teleportEntityToSavedLocation"));
    }

    @Test
    void everyOrdinaryTeleportRouteRequestsAutomaticTravelPlanning() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);

        assertTrue(source.contains("TravelGroupTrigger.PLAYER_REQUEST"));
        assertTrue(source.contains("TravelGroupTrigger.SAVED_PLACE"));
        assertTrue(source.contains("TravelGroupTrigger.BACK"));

        int start = source.indexOf("private TravelPlan prepareTravelPlan(");
        int end = source.indexOf("private static TravelGroupGraph<Entity> createTravelGroupGraph(", start);
        assertTrue(start >= 0 && end > start, "travel-plan method could not be inspected");
        String planner = source.substring(start, end);
        assertFalse(planner.contains("permissions().hasPermission"));
        assertFalse(planner.contains("Permissions.COMMANDS_ADMIN"));
    }

    @Test
    void shippedConfigAndDocumentationExposeNoManualEntityTeleportSurface() throws IOException {
        String config = Files.readString(Path.of("src", "main", "resources", "default-config.properties"));
        String readme = Files.readString(Path.of("README.md"));

        assertFalse(config.contains("message.usage-tpa-bring"));
        assertFalse(config.contains("message.usage-tpa-entity"));
        assertFalse(config.contains("message.entity-"));
        assertFalse(readme.contains("/tpa bring"));
        assertFalse(readme.contains("/tpa entity"));
        assertFalse(readme.toLowerCase().contains("looking at"));
    }

    @Test
    void directDestinationUsesExactCollisionSafeResolutionAndBareCompletion() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);

        assertTrue(source.contains("Commands.literal(\"player\")"));
        assertTrue(source.contains("Commands.argument(\"username\", StringArgumentType.word())"));
        assertTrue(source.contains(
                "Commands.argument(\"destination\", StringArgumentType.greedyString())"));
        assertTrue(source.contains("onlinePlayerNames(source)"));
        assertTrue(source.contains("Commands.argument(\"name\", StringArgumentType.greedyString())"));
        assertTrue(source.contains("savedLocationNames(context.getSource())"));
        assertTrue(source.contains("tpaRootSuggestions(context.getSource())"));
        assertFalse(source.contains("suggestions.add(\"go \" + name)"));

        int resolverStart = source.indexOf("private int resolveDirectDestination(");
        int createStart = source.indexOf("private int createRequest(", resolverStart);
        assertTrue(resolverStart >= 0 && createStart > resolverStart);
        String resolver = source.substring(resolverStart, createStart);
        assertTrue(resolver.contains("store.find(requester.getUUID(), savedName)"));
        assertTrue(resolver.contains("findOnlineByName(source.getServer(), displayName)"));
        assertTrue(resolver.contains("DirectDestinationMatch.resolve"));
        assertTrue(resolver.contains("case SAVED_PLACE -> teleportToSavedLocation"));
        assertTrue(resolver.contains("case ONLINE_PLAYER -> createRequest"));
        assertTrue(resolver.contains("case AMBIGUOUS -> fail(requester, \"destination-ambiguous\""));
        assertTrue(resolver.contains("case NOT_FOUND -> fail(requester, \"destination-unavailable\""));

        int completionStart = source.indexOf("private List<String> tpaRootSuggestions(");
        int incomingStart = source.indexOf("private List<String> incomingRequesters(", completionStart);
        assertTrue(completionStart >= 0 && incomingStart > completionStart);
        String completion = source.substring(completionStart, incomingStart);
        assertTrue(completion.contains("onlinePlayerNames(source)"));
        assertTrue(completion.contains("savedLocationNames(source)"));
        assertTrue(completion.contains("suggestions.put(name, name)"));
        assertTrue(completion.contains("suggestions.putIfAbsent(name, name)"));
        assertFalse(completion.contains("\"go \" + name"));
    }

    @Test
    void localSavedTravelRevokesAnyOutgoingRequestBeforeMovement() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        int savedStart = source.indexOf("private int teleportToSavedLocation(");
        int backStart = source.indexOf("private int teleportBack(", savedStart);
        int respondStart = source.indexOf("private int respond(", backStart);
        assertTrue(savedStart >= 0 && backStart > savedStart && respondStart > backStart);

        String saved = source.substring(savedStart, backStart);
        String back = source.substring(backStart, respondStart);
        int savedRevoke = saved.indexOf("revokeOutgoingBeforeLocalTravel");
        int savedMove = saved.indexOf("teleportTravelGroup");
        int backRevoke = back.indexOf("revokeOutgoingBeforeLocalTravel");
        int backMove = back.indexOf("teleportTravelGroup");
        assertTrue(savedRevoke >= 0 && savedMove > savedRevoke);
        assertTrue(backRevoke >= 0 && backMove > backRevoke);
        assertTrue(source.contains("cancelled-for-local-travel-requester"));
        assertTrue(source.contains("cancelled-for-local-travel-target"));
    }

    @Test
    void loginAndTeleportDestinationsAreHeldUntilFullChunksAreReady() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);

        assertTrue(source.contains("ServerPlayConnectionEvents.JOIN.register"));
        assertTrue(source.contains("LoginSafetyState"));
        assertTrue(source.contains("addTicketAndLoadWithRadius"));
        assertTrue(source.contains("destinationLoads.poll(pending.load)"));
        assertTrue(source.contains("getChunkNow"));

        int teleportStart = source.indexOf("private boolean teleportTravelGroup(");
        int plannerCall = source.indexOf("prepareTravelPlan(", teleportStart);
        int preloadCall = source.indexOf("destinationReady(", teleportStart);
        assertTrue(teleportStart >= 0 && preloadCall > teleportStart && plannerCall > preloadCall,
                "destination chunks must be loaded before safe-landing planning");
    }

    @Test
    void recentPvpTravelUsesPrivateCancellableWarmup() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);

        assertTrue(source.contains("ServerLivingEntityEvents.ALLOW_DAMAGE.register"));
        assertTrue(source.contains("RECENT_PVP_MILLIS = 15_000L"));
        assertTrue(source.contains("TeleportWarmupState"));
        assertTrue(source.contains("dispatchTeleport(owner"));
        assertTrue(source.contains("dispatchTeleport(\n                    requester"));
        assertTrue(source.contains("send(player, \"warmup-countdown\""));
        assertTrue(source.contains("player.sendSystemMessage(FabricMessageComponent.parse(rendered))"));
        assertFalse(source.contains("sendOverlayMessage"));
        assertFalse(source.contains("broadcastSystemMessage"));
    }

    @Test
    void onlyPlayerCausedDamageMarksCombatAndEitherParticipantCancelsAnActiveWarmup()
            throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        int allowStart = source.indexOf("private boolean allowDamage(");
        int damagingStart = source.indexOf("private static ServerPlayer damagingPlayer(", allowStart);
        int markerStart = source.indexOf("private void markRecentPvp(", damagingStart);
        assertTrue(allowStart >= 0 && damagingStart > allowStart && markerStart > damagingStart);

        String allowDamage = source.substring(allowStart, damagingStart);
        String damagingPlayer = source.substring(damagingStart, markerStart);
        assertTrue(allowDamage.contains(
                "cancelPendingTeleport(victim, \"warmup-cancelled-damage\", true)"));
        assertTrue(allowDamage.contains("markRecentPvp(victim.getUUID(), now)"));
        assertTrue(allowDamage.contains("markRecentPvp(attacker.getUUID(), now)"));
        assertTrue(allowDamage.contains(
                "cancelPendingTeleport(attacker, \"warmup-cancelled-combat\", true)"));
        assertTrue(damagingPlayer.contains("source.getEntity() instanceof ServerPlayer"));
        assertTrue(damagingPlayer.contains("source.getDirectEntity() instanceof ServerPlayer"));
        assertFalse(damagingPlayer.contains("getOwner()"),
                "autonomous tame-animal damage must not be treated as player combat");
    }

    @Test
    void everyMovementCapableTpaRoutePassesThroughTheCombatDispatcher() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        int savedStart = source.indexOf("private int teleportToSavedLocation(");
        int backStart = source.indexOf("private int teleportBack(", savedStart);
        int respondStart = source.indexOf("private int respond(", backStart);
        int completeStart = source.indexOf("private boolean completeAcceptedTeleport(", respondStart);
        assertTrue(savedStart >= 0 && backStart > savedStart && respondStart > backStart
                && completeStart > respondStart);

        assertTrue(source.substring(savedStart, backStart).contains("dispatchTeleport(owner"));
        assertTrue(source.substring(backStart, respondStart).contains("dispatchTeleport(owner"));
        assertTrue(source.substring(respondStart, completeStart).contains("dispatchTeleport("));
    }

    @Test
    void movementAndDamageCancelAcceptedConsentWhileOperationalFailureRemainsRetriable()
            throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        int pendingStart = source.indexOf("private void processPendingTeleports(");
        int cancelStart = source.indexOf("private boolean cancelPendingTeleport(", pendingStart);
        int dispatchStart = source.indexOf("private Dispatch dispatchTeleport(", cancelStart);
        int respondStart = source.indexOf("private int respond(", dispatchStart);
        int completeStart = source.indexOf("private boolean completeAcceptedTeleport(", respondStart);
        assertTrue(pendingStart >= 0 && cancelStart > pendingStart && dispatchStart > cancelStart
                && respondStart > dispatchStart && completeStart > respondStart);

        String pending = source.substring(pendingStart, cancelStart);
        String cancellation = source.substring(cancelStart, dispatchStart);
        String respond = source.substring(respondStart, completeStart);
        assertTrue(pending.contains("case MOVED"));
        assertTrue(pending.contains("pending.cancelWarmup().run()"));
        assertTrue(pending.contains("pending.releaseAfterFailure().run()"));
        assertTrue(cancellation.contains("pending.cancelWarmup().run()"));
        assertTrue(respond.contains("requests.invalidate(reservation)"));
        assertTrue(respond.contains("requests.release(reservation)"));
        assertTrue(respond.contains("request-cancelled-target"));
        assertTrue(respond.contains("request-failed-target"));
    }

    @Test
    void acceptedTeleportChecksCurrentConsentBeforeMovingAnyTravelGroupMember() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        int completion = source.indexOf("private boolean completeAcceptedTeleport(");
        int activeConsent = source.indexOf("if (!requests.isActiveReservation(reservation))", completion);
        int movement = source.indexOf("if (!teleportTravelGroup(", completion);
        assertTrue(completion >= 0 && activeConsent > completion && movement > activeConsent,
                "stale asynchronous consent must be rejected before the first entity move");
    }

    @Test
    void recentPvpMarkerSurvivesRelogUntilBoundedExpiry() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        int disconnectStart = source.indexOf("private void onDisconnect(");
        int damageStart = source.indexOf("private boolean allowDamage(", disconnectStart);
        assertTrue(disconnectStart >= 0 && damageStart > disconnectStart);

        String disconnect = source.substring(disconnectStart, damageStart);
        assertFalse(disconnect.contains("recentPvpUntil.remove"));
        assertTrue(source.contains("recentPvpUntil.entrySet().removeIf"));
        assertTrue(source.contains("MAX_COMBAT_ENTRIES = 4_096"));
    }

    @Test
    void destinationPreloadIsNarrowAndLandingNeverUsesUnloadedChunks() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        int preloadStart = source.indexOf("private boolean destinationReady(");
        int plannerStart = source.indexOf("private TravelPlan prepareTravelPlan(", preloadStart);
        assertTrue(preloadStart >= 0 && plannerStart > preloadStart);

        String preload = source.substring(preloadStart, plannerStart);
        assertFalse(preload.contains("getChunk("), "arrival must never synchronously load terrain");
        assertFalse(source.contains(".join()"), "the tick loop must never wait on terrain futures");
        assertFalse(source.contains("PREPARATION_RADIUS"));
        assertTrue(source.contains("preparationTicket, chunk, 0"));
        assertTrue(source.contains("MAX_PREPARING_DESTINATIONS = 4"));
        assertTrue(source.contains("MAX_QUEUED_TELEPORTS = 32"));
        assertFalse(preload.contains("DESTINATION_PRELOAD_RADIUS"));
        assertTrue(source.contains("if (!allChunksReady(destination, bounds)) return false;"));
        assertTrue(source.contains("getChunkNow(chunkX, chunkZ)"));
    }

    @Test
    void loadedNonCombatDestinationsHaveAnImmediatePathAndExactSavedPlacesAllowDanger() throws IOException {
        String source = Files.readString(SERVER_TELEPORT_SOURCE);
        int dispatch = source.indexOf("private Dispatch dispatchTeleport(");
        int loaded = source.indexOf("ready != null && chunksReady(ready)", dispatch);
        int immediate = source.indexOf("return action.execute() ? Dispatch.COMPLETED", loaded);
        int queued = source.indexOf("pendingTeleports.put(", dispatch);
        assertTrue(dispatch >= 0 && loaded > dispatch && immediate > loaded && queued > immediate);
        assertTrue(source.contains("!inRecentPvp(player, now) && arrivalsThisTick == 0"));
        assertTrue(source.contains("exactPrimaryDestination ? isValidArrivalBounds(destination, shifted)"));
        int validity = source.indexOf("private static boolean isValidArrivalBounds(");
        int next = source.indexOf("private static boolean allChunksReady(", validity);
        String checks = source.substring(validity, next);
        assertFalse(checks.contains("noBlockCollision"));
        assertFalse(checks.contains("FluidTags.LAVA"));
        assertFalse(checks.contains("below("));
        assertTrue(checks.contains("getWorldBorder()"));
        assertTrue(checks.contains("allChunksReady"));
    }
}
