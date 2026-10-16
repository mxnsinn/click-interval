package com.clickinterval.restartproxy;

import com.google.inject.Inject;
import com.velocitypowered.api.command.CommandMeta;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.event.PostOrder;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.PreLoginEvent;
import com.velocitypowered.api.event.player.KickedFromServerEvent;
import com.velocitypowered.api.event.player.PlayerChooseInitialServerEvent;
import com.velocitypowered.api.event.player.ServerConnectedEvent;
import com.velocitypowered.api.event.player.ServerPreConnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.ConnectionRequestBuilder;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.slf4j.Logger;

@Plugin(
    id = "clickinterval-restart-proxy",
    name = "Click Interval Restart Proxy",
    version = "1.0.2",
    description = "Coordinates an explicit main-to-maintenance-to-main restart flow.",
    authors = {"Click Interval"})
public final class ClickIntervalRestartProxy {
  private static final String ACK_PREFIX = "CI_RESTART_ACK";
  private static final String NACK_PREFIX = "CI_RESTART_NACK";

  private enum RestorePurpose {
    READY,
    DRAIN_ROLLBACK
  }

  private final ProxyServer proxy;
  private final Logger logger;
  private final Path dataDirectory;
  private final MaintenanceState state = new MaintenanceState();
  private final Object routingLock = new Object();
  private final Set<UUID> drainPending = ConcurrentHashMap.newKeySet();
  private final Set<UUID> mainConnectionAttempts = ConcurrentHashMap.newKeySet();
  private final AtomicBoolean armProbeInFlight = new AtomicBoolean();
  private final AtomicBoolean readinessProbeInFlight = new AtomicBoolean();

  private volatile RestartProxyConfig config;
  private volatile RestorePurpose restorePurpose;

  @Inject
  public ClickIntervalRestartProxy(
      ProxyServer proxy,
      Logger logger,
      @DataDirectory Path dataDirectory) {
    this.proxy = proxy;
    this.logger = logger;
    this.dataDirectory = dataDirectory;
  }

  @Subscribe
  public void onProxyInitialize(ProxyInitializeEvent ignored) {
    try {
      this.config = RestartProxyConfig.load(this.dataDirectory);
      registerCommand();
      if (mainServer().isEmpty()) {
        nack("initialize", "main_server_not_registered", this.state.snapshot());
      } else if (maintenanceServer().isEmpty()) {
        nack("initialize", "maintenance_server_not_registered", this.state.snapshot());
      } else {
        ack(
            "initialize",
            "ready",
            this.state.snapshot(),
            "main=" + token(this.config.mainServer()),
            "maintenance=" + token(this.config.maintenanceServer()));
      }
    } catch (IOException | RuntimeException exception) {
      this.logger.error("{} op=initialize result=configuration_failed", NACK_PREFIX, exception);
      throw new IllegalStateException("Unable to initialize Click Interval restart coordinator", exception);
    }
  }

  @Subscribe
  public void onPreLogin(PreLoginEvent event) {
    RestartProxyConfig current = this.config;
    if (current == null || !event.getResult().isAllowed()) {
      return;
    }
    String hostname = event.getConnection().getVirtualHost()
        .map(java.net.InetSocketAddress::getHostString).orElse(null);
    if (!HostnameAdmissionPolicy.allows(current.requiredHostname(), hostname,
        event.getConnection().getRemoteAddress())) {
      event.setResult(PreLoginEvent.PreLoginComponentResult.denied(Component.text(
          "Server address changed. Please join " + current.requiredHostname(), NamedTextColor.YELLOW)));
    }
  }

  @Subscribe
  public void onChooseInitialServer(PlayerChooseInitialServerEvent event) {
    synchronized (this.routingLock) {
      MaintenanceState.Snapshot snapshot = this.state.snapshot();
      if (!routesToMaintenance(snapshot.phase())) {
        return;
      }
      maintenanceServer().ifPresent(server -> {
        UUID playerId = event.getPlayer().getUniqueId();
        if (this.state.track(playerId)) {
          if (snapshot.phase() == MaintenanceState.Phase.DRAINING) {
            this.drainPending.add(playerId);
          }
          this.mainConnectionAttempts.remove(playerId);
          event.setInitialServer(server);
        }
      });
    }
  }

  @SuppressWarnings("deprecation")
  @Subscribe(order = PostOrder.LAST)
  public void onServerPreConnect(ServerPreConnectEvent event) {
    if (!event.getOriginalServer().getServerInfo().getName().equalsIgnoreCase(this.config.mainServer())) {
      return;
    }

    synchronized (this.routingLock) {
      UUID playerId = event.getPlayer().getUniqueId();
      MaintenanceState.Snapshot snapshot = this.state.snapshot();
      if (routesToMaintenance(snapshot.phase())) {
        this.state.track(playerId);
        if (snapshot.phase() == MaintenanceState.Phase.DRAINING) {
          this.drainPending.add(playerId);
        }
        this.mainConnectionAttempts.remove(playerId);
        Optional<RegisteredServer> maintenance = maintenanceServer();
        event.setResult(maintenance
            .map(ServerPreConnectEvent.ServerResult::allowed)
            .orElseGet(ServerPreConnectEvent.ServerResult::denied));
        return;
      }

      boolean stillTargetsMain = event.getResult().isAllowed()
          && event.getResult().getServer()
              .map(server -> server.getServerInfo().getName().equalsIgnoreCase(this.config.mainServer()))
              .orElse(false);
      if (stillTargetsMain) {
        this.mainConnectionAttempts.add(playerId);
      }
    }
  }

  @Subscribe
  public void onServerConnected(ServerConnectedEvent event) {
    UUID playerId = event.getPlayer().getUniqueId();
    String connectedName = event.getServer().getServerInfo().getName();
    boolean connectBackToMain = false;
    boolean redirectToMaintenance = false;
    boolean checkDrain = false;
    boolean checkRestore = false;
    String maintenanceMessage = null;

    synchronized (this.routingLock) {
      this.mainConnectionAttempts.remove(playerId);
      MaintenanceState.Snapshot snapshot = this.state.snapshot();
      if (connectedName.equalsIgnoreCase(this.config.maintenanceServer())) {
        if (routesToMaintenance(snapshot.phase())) {
          this.state.track(playerId);
          this.drainPending.remove(playerId);
          maintenanceMessage = snapshot.message();
          checkDrain = snapshot.phase() == MaintenanceState.Phase.DRAINING;
        } else if (snapshot.phase() == MaintenanceState.Phase.RESTORING) {
          connectBackToMain = true;
        }
      } else if (connectedName.equalsIgnoreCase(this.config.mainServer())) {
        if (routesToMaintenance(snapshot.phase())) {
          this.state.track(playerId);
          if (snapshot.phase() == MaintenanceState.Phase.DRAINING) {
            this.drainPending.add(playerId);
          } else {
            nack(
                "maintenance_on",
                "main_connection_after_barrier",
                snapshot,
                "player=" + playerId);
          }
          redirectToMaintenance = true;
        } else if (snapshot.phase() == MaintenanceState.Phase.RESTORING) {
          checkRestore = this.state.untrack(playerId);
        }
      }
    }

    if (maintenanceMessage != null) {
      showMaintenanceScreen(event.getPlayer(), maintenanceMessage);
      ack(
          "player_parked",
          "ok",
          this.state.snapshot(),
          "player=" + playerId);
    }
    if (redirectToMaintenance) {
      maintenanceServer().ifPresent(server -> connect(event.getPlayer(), server, "late_drain"));
    }
    if (connectBackToMain) {
      mainServer().ifPresent(server -> connect(event.getPlayer(), server, restoreOperation()));
    }
    if (checkDrain) {
      tryFinishDrain(this.state.snapshot().generation());
    }
    if (checkRestore) {
      completeRestoreIfEmpty("all_players_connected");
    }
  }

  @Subscribe
  public void onDisconnect(DisconnectEvent event) {
    MaintenanceState.Snapshot snapshot;
    boolean possiblyComplete;
    synchronized (this.routingLock) {
      UUID playerId = event.getPlayer().getUniqueId();
      this.mainConnectionAttempts.remove(playerId);
      this.drainPending.remove(playerId);
      possiblyComplete = this.state.untrack(playerId);
      snapshot = this.state.snapshot();
    }
    if (snapshot.phase() == MaintenanceState.Phase.DRAINING) {
      tryFinishDrain(snapshot.generation());
    }
    if (possiblyComplete) {
      completeRestoreIfEmpty("remaining_players_disconnected");
    }
  }

  @Subscribe
  public void onKickedFromServer(KickedFromServerEvent event) {
    if (!event.getServer().getServerInfo().getName().equalsIgnoreCase(this.config.mainServer())) {
      return;
    }
    MaintenanceState.Snapshot snapshot;
    synchronized (this.routingLock) {
      UUID playerId = event.getPlayer().getUniqueId();
      this.mainConnectionAttempts.remove(playerId);
      this.drainPending.remove(playerId);
      snapshot = this.state.snapshot();
    }
    if (snapshot.phase() == MaintenanceState.Phase.DRAINING) {
      tryFinishDrain(snapshot.generation());
    }
    // Intentionally do not change event.getResult(): ordinary kick/ban behavior
    // remains Velocity's default behavior.
  }

  private static boolean routesToMaintenance(MaintenanceState.Phase phase) {
    return phase == MaintenanceState.Phase.DRAINING || phase == MaintenanceState.Phase.ARMED;
  }

  private void registerCommand() {
    CommandMeta meta = this.proxy.getCommandManager()
        .metaBuilder("cirestart")
        .aliases("maintenance")
        .plugin(this)
        .build();
    this.proxy.getCommandManager().register(meta, new RestartCommand());
  }

  private void beginArm(String requestedMessage, SimpleCommand.Invocation invocation) {
    MaintenanceState.Snapshot snapshot = this.state.snapshot();
    if (snapshot.phase() != MaintenanceState.Phase.ACTIVE) {
      nackTo(invocation, "maintenance_on", "invalid_state", snapshot);
      return;
    }
    if (!this.armProbeInFlight.compareAndSet(false, true)) {
      nackTo(invocation, "maintenance_on", "probe_in_progress", snapshot);
      return;
    }

    Optional<RegisteredServer> holding = maintenanceServer();
    if (holding.isEmpty()) {
      this.armProbeInFlight.set(false);
      nackTo(invocation, "maintenance_on", "maintenance_server_not_registered", snapshot);
      return;
    }

    String message = requestedMessage == null || requestedMessage.isBlank()
        ? this.config.defaultMessage()
        : requestedMessage.trim();
    ackTo(invocation, "maintenance_probe", "started", snapshot);
    RegisteredServer target = holding.get();
    target.ping().orTimeout(5, TimeUnit.SECONDS).whenComplete((ping, failure) -> {
      this.armProbeInFlight.set(false);
      if (failure != null) {
        nack("maintenance_on", "maintenance_unreachable", this.state.snapshot());
        return;
      }

      MaintenanceState.ArmResult result;
      LinkedHashMap<UUID, Player> targets = new LinkedHashMap<>();
      synchronized (this.routingLock) {
        result = this.state.arm(message);
        if (result.changed()) {
          this.drainPending.clear();
          for (Player player : currentMainPlayers()) {
            targets.put(player.getUniqueId(), player);
          }
          for (UUID playerId : this.mainConnectionAttempts) {
            this.proxy.getPlayer(playerId).ifPresent(player -> targets.putIfAbsent(playerId, player));
          }
          for (UUID playerId : targets.keySet()) {
            if (this.state.track(playerId)) {
              this.drainPending.add(playerId);
            }
          }
        }
      }
      if (!result.changed()) {
        nack("maintenance_on", "state_changed", this.state.snapshot());
        return;
      }

      int requested = this.drainPending.size();
      ack(
          "maintenance_on",
          "draining",
          this.state.snapshot(),
          "requested=" + requested,
          "pending=" + requested);
      for (Player player : targets.values()) {
        boolean alreadyAttemptingMain = this.mainConnectionAttempts.contains(player.getUniqueId());
        if (!alreadyAttemptingMain && this.drainPending.contains(player.getUniqueId())) {
          showMaintenanceNotice(player, message);
          connect(player, target, "drain");
        }
      }

      tryFinishDrain(result.generation());

      this.proxy.getScheduler()
          .buildTask(this, () -> verifyDrainTimeout(result.generation()))
          .delay(this.config.drainTimeoutSeconds(), TimeUnit.SECONDS)
          .schedule();
    });
  }

  private void tryFinishDrain(long generation) {
    List<Player> latePlayers = new ArrayList<>();
    MaintenanceState.Snapshot armedSnapshot = null;
    synchronized (this.routingLock) {
      MaintenanceState.Snapshot snapshot = this.state.snapshot();
      if (snapshot.phase() != MaintenanceState.Phase.DRAINING
          || snapshot.generation() != generation) {
        return;
      }

      for (Player player : currentMainPlayers()) {
        UUID playerId = player.getUniqueId();
        this.state.track(playerId);
        if (this.drainPending.add(playerId)) {
          latePlayers.add(player);
        }
      }

      if (this.drainPending.isEmpty()
          && this.mainConnectionAttempts.isEmpty()
          && this.state.finishDrain(generation, true)) {
        armedSnapshot = this.state.snapshot();
      }
    }

    Optional<RegisteredServer> holding = maintenanceServer();
    for (Player player : latePlayers) {
      showMaintenanceNotice(player, this.state.snapshot().message());
      holding.ifPresent(server -> connect(player, server, "late_drain"));
    }
    if (armedSnapshot != null) {
      ack(
          "maintenance_on",
          "armed",
          armedSnapshot,
          "pending=0",
          "main_inflight=0");
    }
  }

  private void verifyDrainTimeout(long generation) {
    MaintenanceState.Snapshot snapshot = this.state.snapshot();
    if (snapshot.phase() != MaintenanceState.Phase.DRAINING
        || snapshot.generation() != generation) {
      return;
    }
    beginDrainRollback(generation);
  }

  private void beginDrainRollback(long generation) {
    MaintenanceState.RestorePlan plan;
    synchronized (this.routingLock) {
      MaintenanceState.Snapshot snapshot = this.state.snapshot();
      if (snapshot.phase() != MaintenanceState.Phase.DRAINING
          || snapshot.generation() != generation) {
        return;
      }
      plan = this.state.beginRollback();
      this.restorePurpose = RestorePurpose.DRAIN_ROLLBACK;
      this.drainPending.clear();
    }

    nack(
        "maintenance_on",
        "drain_timeout_rollback_started",
        this.state.snapshot(),
        "target=" + plan.players().size());
    Optional<RegisteredServer> main = mainServer();
    for (UUID playerId : plan.players()) {
      Optional<Player> player = this.proxy.getPlayer(playerId);
      if (player.isEmpty()) {
        untrackManaged(playerId);
        continue;
      }
      boolean alreadyOnMain = player.get().getCurrentServer()
          .map(connection -> connection.getServerInfo().getName().equalsIgnoreCase(this.config.mainServer()))
          .orElse(false);
      if (alreadyOnMain) {
        untrackManaged(playerId);
      } else {
        main.ifPresent(server -> connect(player.get(), server, "rollback"));
      }
    }

    if (completeRestoreIfEmpty("drain_rollback_complete")) {
      return;
    }
    this.proxy.getScheduler()
        .buildTask(this, () -> verifyRestoreTimeout(generation))
        .delay(this.config.restoreTimeoutSeconds(), TimeUnit.SECONDS)
        .schedule();
  }

  private List<Player> currentMainPlayers() {
    String expected = this.config.mainServer();
    List<Player> players = new ArrayList<>();
    for (Player player : this.proxy.getAllPlayers()) {
      boolean onMain = player.getCurrentServer()
          .map(connection -> connection.getServerInfo().getName().equalsIgnoreCase(expected))
          .orElse(false);
      if (onMain) {
        players.add(player);
      }
    }
    return players;
  }

  private void beginReady(SimpleCommand.Invocation invocation) {
    MaintenanceState.Snapshot snapshot = this.state.snapshot();
    if (snapshot.phase() != MaintenanceState.Phase.ARMED) {
      nackTo(invocation, "ready", "invalid_state", snapshot);
      return;
    }
    if (!this.readinessProbeInFlight.compareAndSet(false, true)) {
      nackTo(invocation, "ready", "probe_in_progress", snapshot);
      return;
    }

    Optional<RegisteredServer> main = mainServer();
    if (main.isEmpty()) {
      this.readinessProbeInFlight.set(false);
      nackTo(invocation, "ready", "main_server_not_registered", snapshot);
      return;
    }

    ackTo(invocation, "ready_probe", "started", snapshot);
    RegisteredServer target = main.get();
    target.ping().orTimeout(5, TimeUnit.SECONDS).whenComplete((ping, failure) -> {
      this.readinessProbeInFlight.set(false);
      if (failure != null) {
        nack("ready", "main_unreachable", this.state.snapshot());
        return;
      }

      MaintenanceState.RestorePlan plan;
      synchronized (this.routingLock) {
        plan = this.state.beginRestore();
        if (plan.accepted()) {
          this.restorePurpose = RestorePurpose.READY;
          this.drainPending.clear();
        }
      }
      if (!plan.accepted()) {
        nack("ready", "state_changed", this.state.snapshot());
        return;
      }

      ack(
          "ready",
          "restoring",
          this.state.snapshot(),
          "target=" + plan.players().size());

      for (UUID playerId : plan.players()) {
        Optional<Player> player = this.proxy.getPlayer(playerId);
        if (player.isEmpty()) {
          untrackManaged(playerId);
          continue;
        }
        connect(player.get(), target, "restore");
      }

      if (completeRestoreIfEmpty("no_players")) {
        return;
      }

      this.proxy.getScheduler()
          .buildTask(this, () -> verifyRestoreTimeout(plan.generation()))
          .delay(this.config.restoreTimeoutSeconds(), TimeUnit.SECONDS)
          .schedule();
    });
  }

  private void connect(Player player, RegisteredServer target, String operation) {
    player.createConnectionRequest(target).connect().whenComplete((result, failure) -> {
      boolean targetsMain = target.getServerInfo().getName().equalsIgnoreCase(this.config.mainServer());
      if (failure != null) {
        if (targetsMain) {
          this.mainConnectionAttempts.remove(player.getUniqueId());
        }
        this.logger.warn(
            "{} op={} result=connection_exception player={} target={}",
            NACK_PREFIX,
            token(operation),
            player.getUniqueId(),
            token(target.getServerInfo().getName()),
            failure);
        return;
      }
      ConnectionRequestBuilder.Status status = result.getStatus();
      RestoreConnectionPolicy.Action restoreAction = RestoreConnectionPolicy.classify(status);
      if (restoreAction == RestoreConnectionPolicy.Action.COMPLETE_ALREADY_CONNECTED) {
        if (targetsMain && isRestoreOperation(operation)) {
          this.mainConnectionAttempts.remove(player.getUniqueId());
          untrackManaged(player.getUniqueId());
          completeRestoreIfEmpty("already_connected");
        } else if (!targetsMain && isDrainOperation(operation)) {
          this.drainPending.remove(player.getUniqueId());
          tryFinishDrain(this.state.snapshot().generation());
        }
        return;
      }
      if (targetsMain && status != ConnectionRequestBuilder.Status.SUCCESS) {
        this.mainConnectionAttempts.remove(player.getUniqueId());
      }
      if (targetsMain
          && isRestoreOperation(operation)
          && restoreAction == RestoreConnectionPolicy.Action.DISCONNECT_BACKEND_REJECTION) {
        Component reason = result.getReasonComponent().orElseGet(() -> Component.text(
            "The main server rejected this connection.",
            NamedTextColor.RED));
        untrackManaged(player.getUniqueId());
        player.disconnect(reason);
        ack(
            "restore_player",
            "disconnected_backend_rejection",
            this.state.snapshot(),
            "player=" + player.getUniqueId(),
            "purpose=" + token(operation));
        completeRestoreIfEmpty("backend_rejections_handled");
        return;
      }
      if (!result.isSuccessful()) {
        this.logger.warn(
            "{} op={} result=connection_rejected player={} target={}",
            NACK_PREFIX,
            token(operation),
            player.getUniqueId(),
            token(target.getServerInfo().getName()));
      }
    });
  }

  private static boolean isRestoreOperation(String operation) {
    return "restore".equals(operation) || "rollback".equals(operation);
  }

  private static boolean isDrainOperation(String operation) {
    return "drain".equals(operation) || "late_drain".equals(operation);
  }

  private String restoreOperation() {
    return this.restorePurpose == RestorePurpose.DRAIN_ROLLBACK ? "rollback" : "restore";
  }

  private void verifyRestoreTimeout(long generation) {
    MaintenanceState.Snapshot before = this.state.snapshot();
    if (before.phase() != MaintenanceState.Phase.RESTORING || before.generation() != generation) {
      return;
    }

    Set<UUID> verifiedComplete = ConcurrentHashMap.newKeySet();
    for (UUID playerId : before.players()) {
      Optional<Player> online = this.proxy.getPlayer(playerId);
      if (online.isEmpty()) {
        verifiedComplete.add(playerId);
        continue;
      }
      boolean onMain = online.get().getCurrentServer()
          .map(connection -> connection.getServerInfo().getName().equalsIgnoreCase(this.config.mainServer()))
          .orElse(false);
      if (onMain) {
        verifiedComplete.add(playerId);
      }
    }

    boolean completed = false;
    boolean rollbackAborted = false;
    RestorePurpose completedPurpose = null;
    Set<UUID> rollbackPlayers = Set.of();
    synchronized (this.routingLock) {
      MaintenanceState.Snapshot current = this.state.snapshot();
      if (current.phase() != MaintenanceState.Phase.RESTORING
          || current.generation() != generation) {
        return;
      }
      for (UUID playerId : verifiedComplete) {
        this.state.untrack(playerId);
      }
      if (this.state.completeRestoreIfEmpty()) {
        completed = true;
        completedPurpose = this.restorePurpose;
        this.restorePurpose = null;
      } else if (this.restorePurpose == RestorePurpose.DRAIN_ROLLBACK) {
        rollbackPlayers = this.state.snapshot().players();
        this.state.abortToActive();
        this.mainConnectionAttempts.clear();
        this.restorePurpose = null;
        rollbackAborted = true;
      } else if (this.state.markRestoreIncomplete()) {
        this.restorePurpose = null;
      } else {
        return;
      }
    }

    if (completed) {
      finishRestore("verified", completedPurpose);
      return;
    }

    if (rollbackAborted) {
      List<Player> playersToDisconnect = new ArrayList<>();
      for (UUID playerId : rollbackPlayers) {
        this.proxy.getPlayer(playerId).ifPresent(playersToDisconnect::add);
      }
      for (Player player : playersToDisconnect) {
        player.disconnect(Component.text(
            "Maintenance rollback could not reconnect you. Please reconnect.",
            NamedTextColor.RED));
      }
      nack(
          "maintenance_rollback",
          "rollback_timeout_disarmed",
          this.state.snapshot(),
          "disconnected=" + playersToDisconnect.size());
    } else {
      nack("ready_complete", "restore_timeout", this.state.snapshot());
    }
  }

  private boolean completeRestoreIfEmpty(String reason) {
    RestorePurpose completedPurpose;
    synchronized (this.routingLock) {
      if (!this.state.completeRestoreIfEmpty()) {
        return false;
      }
      completedPurpose = this.restorePurpose;
      this.restorePurpose = null;
    }
    finishRestore(reason, completedPurpose);
    return true;
  }

  private boolean untrackManaged(UUID playerId) {
    synchronized (this.routingLock) {
      return this.state.untrack(playerId);
    }
  }

  private void finishRestore(String reason, RestorePurpose purpose) {
    if (purpose == RestorePurpose.DRAIN_ROLLBACK) {
      ack(
          "maintenance_rollback",
          "active",
          this.state.snapshot(),
          "reason=" + token(reason));
    } else {
      ack(
          "ready_complete",
          "active",
          this.state.snapshot(),
          "reason=" + token(reason));
    }
  }

  private Optional<RegisteredServer> mainServer() {
    RestartProxyConfig current = this.config;
    return current == null ? Optional.empty() : this.proxy.getServer(current.mainServer());
  }

  private Optional<RegisteredServer> maintenanceServer() {
    RestartProxyConfig current = this.config;
    return current == null ? Optional.empty() : this.proxy.getServer(current.maintenanceServer());
  }

  private static Component maintenanceMessage(String message) {
    return Component.text("[Click Interval] ", NamedTextColor.GOLD)
        .append(Component.text(message, NamedTextColor.YELLOW));
  }

  private static void showMaintenanceNotice(Player player, String message) {
    player.sendMessage(maintenanceMessage(message));
  }

  private static void showMaintenanceScreen(Player player, String message) {
    player.sendMessage(maintenanceMessage(message));
    player.showTitle(Title.title(
        Component.text("Server updating", NamedTextColor.GOLD),
        Component.text("You will reconnect automatically", NamedTextColor.YELLOW),
        Title.Times.times(Duration.ofMillis(250), Duration.ofSeconds(5), Duration.ofMillis(500))));
  }

  private void sendStatus(SimpleCommand.Invocation invocation) {
    MaintenanceState.Snapshot snapshot = this.state.snapshot();
    ackTo(
        invocation,
        "status",
        "ok",
        snapshot,
        "arm_probe=" + (this.armProbeInFlight.get() ? "running" : "idle"),
        "drain_pending=" + this.drainPending.size(),
        "main_inflight=" + this.mainConnectionAttempts.size(),
        "ready_probe=" + (this.readinessProbeInFlight.get() ? "running" : "idle"),
        "restore_purpose=" + token(this.restorePurpose == null ? "none" : this.restorePurpose.name()),
        "main=" + token(this.config.mainServer()),
        "maintenance=" + token(this.config.maintenanceServer()));
  }

  private static void showHelp(SimpleCommand.Invocation invocation) {
    invocation.source().sendMessage(Component.text(
        "Console commands: maintenance on [message], maintenance off, maintenance status; "
            + "aliases: cirestart ready, cirestart status",
        NamedTextColor.GRAY));
  }

  private void ackTo(
      SimpleCommand.Invocation invocation,
      String operation,
      String result,
      MaintenanceState.Snapshot snapshot,
      String... extra) {
    String line = protocolLine(ACK_PREFIX, operation, result, snapshot, extra);
    this.logger.info(line);
    invocation.source().sendMessage(Component.text(line, NamedTextColor.GREEN));
  }

  private void nackTo(
      SimpleCommand.Invocation invocation,
      String operation,
      String code,
      MaintenanceState.Snapshot snapshot,
      String... extra) {
    String line = protocolLine(NACK_PREFIX, operation, code, snapshot, extra);
    this.logger.warn(line);
    invocation.source().sendMessage(Component.text(line, NamedTextColor.RED));
  }

  private void ack(
      String operation,
      String result,
      MaintenanceState.Snapshot snapshot,
      String... extra) {
    this.logger.info(protocolLine(ACK_PREFIX, operation, result, snapshot, extra));
  }

  private void nack(
      String operation,
      String code,
      MaintenanceState.Snapshot snapshot,
      String... extra) {
    this.logger.warn(protocolLine(NACK_PREFIX, operation, code, snapshot, extra));
  }

  private static String protocolLine(
      String prefix,
      String operation,
      String result,
      MaintenanceState.Snapshot snapshot,
      String... extra) {
    StringBuilder line = new StringBuilder(prefix)
        .append(" op=").append(token(operation))
        .append(" result=").append(token(result))
        .append(" state=").append(snapshot.phase().name())
        .append(" generation=").append(snapshot.generation())
        .append(" managed=").append(snapshot.players().size());
    for (String field : extra) {
      if (field != null && !field.isBlank()) {
        line.append(' ').append(field);
      }
    }
    return line.toString();
  }

  private static String token(String value) {
    return value == null
        ? "none"
        : value.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_.-]", "_");
  }

  private final class RestartCommand implements SimpleCommand {
    private static final List<String> ROOT_SUGGESTIONS =
        List.of("maintenance", "on", "off", "ready", "status");
    private static final List<String> MAINTENANCE_SUGGESTIONS = List.of("on", "off", "ready", "status");

    @Override
    public void execute(Invocation invocation) {
      if (invocation.source() instanceof Player) {
        invocation.source().sendMessage(Component.text("This command is console-only.", NamedTextColor.RED));
        return;
      }

      MaintenanceCommandParser.Parsed parsed = MaintenanceCommandParser.parse(invocation.arguments());
      switch (parsed.operation()) {
        case ON -> beginArm(parsed.message(), invocation);
        case READY -> beginReady(invocation);
        case STATUS -> sendStatus(invocation);
        case HELP -> showHelp(invocation);
        case INVALID -> {
          nackTo(invocation, "command", "invalid_syntax", state.snapshot());
          showHelp(invocation);
        }
      }
    }

    @Override
    public List<String> suggest(Invocation invocation) {
      if (invocation.source() instanceof Player) {
        return List.of();
      }
      String[] arguments = invocation.arguments();
      if (arguments.length <= 1) {
        String prefix = arguments.length == 0 ? "" : arguments[0];
        return matching(ROOT_SUGGESTIONS, prefix);
      }
      if ("maintenance".equalsIgnoreCase(arguments[0]) && arguments.length == 2) {
        return matching(MAINTENANCE_SUGGESTIONS, arguments[1]);
      }
      return List.of();
    }

    @Override
    public boolean hasPermission(Invocation invocation) {
      return !(invocation.source() instanceof Player);
    }

    private List<String> matching(Collection<String> values, String prefix) {
      String normalized = prefix == null ? "" : prefix.toLowerCase(Locale.ROOT);
      return values.stream().filter(value -> value.startsWith(normalized)).toList();
    }
  }
}
