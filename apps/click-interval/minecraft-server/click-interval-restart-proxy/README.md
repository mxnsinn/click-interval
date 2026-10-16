# Click Interval Restart Proxy

Velocity coordinator for a no-manual-reconnect backend restart. Players move
from the main backend to a separately supervised maintenance server before the
main process stops, then return after the restarted backend passes a readiness
probe. Velocity owns the public connection and stays running throughout.

The coordinator contains no LimboAPI code and has no runtime plugin dependency.
It only uses public Velocity 4.2.0 APIs and two registered servers.

## Build

Requirements: JDK 25 and network access for the pinned Velocity API.

```powershell
.\build.ps1
```

The verified jar is written to `dist/ClickIntervalRestartProxy-1.0.2.jar`.

## Runtime assumptions

- Velocity 4.2.0 runs continuously on Java 25 and owns the public port.
- The Fabric backend is registered as `main` and listens only on loopback.
- An always-on holding backend is registered as `maintenance` and listens on a
  second loopback-only port.
- Click Interval starts and health-checks the maintenance process before it
  exposes the maintenance-on workflow.
- Both backends use the same secure Velocity forwarding policy.

Example `velocity.toml`:

```toml
bind = "0.0.0.0:25565"
online-mode = true
player-info-forwarding-mode = "modern"
forwarding-secret-file = "forwarding.secret"
try = ["main"]
failover-on-unexpected-server-disconnect = false

[servers]
main = "127.0.0.1:25566"
maintenance = "127.0.0.1:25567"
```

The names can be changed in
`plugins/clickinterval-restart-proxy/config.properties`.

Optional address migration: set `required-hostname=mxnsinn-smp.net` in that
configuration. New public logins using other addresses receive
`Server address changed. Please join mxnsinn-smp.net` before authentication.
Matching is case-insensitive and permits one final DNS dot. Status pings,
backend health checks, and transfers of already connected players are unchanged.
Actual loopback clients may still use localhost, 127.0.0.1, or ::1; putting
localhost in a remote handshake does not bypass the rule. An empty setting
(the backwards-compatible default) leaves every address available.

This is a convenience/migration rule, not authentication or DDoS protection:
the domain still points at the same public IP, and custom clients can send its
hostname in their handshake. The app's managed coordinator config must preserve
this setting before enabling it; this source release alone does not activate it.

`failover-on-unexpected-server-disconnect = false` is deliberate. This plugin
observes `KickedFromServerEvent` for barrier bookkeeping but never overrides
its result, so ordinary kicks, bans, whitelist rejections, and unexpected
crashes keep normal disconnect semantics. Only an explicit maintenance-on
command redirects players. Ban checks that must run
while `main` is offline belong at the proxy login layer; backend-only bans are
still enforced when a restore attempts to connect the player to `main`.

NanoLimbo 1.13.0 is a suitable lightweight holding backend for Minecraft 26.2
and supports Velocity modern forwarding. Its upstream release does not claim
26.3 support. For 26.3 clients, Click Interval must provision a holding backend
that explicitly supports 26.3 (or a later NanoLimbo release); the coordinator
itself is protocol-agnostic and Velocity 4.2.0 supports both 26.2 and 26.3.

## Console protocol

Commands are console-only and hidden from players:

```text
maintenance on [message]
maintenance status
maintenance off
```

Equivalent supervision aliases are `cirestart maintenance on`,
`cirestart status`, and `cirestart ready`.

Safe sequence:

1. Execute `maintenance on Updating the server`.
2. The plugin first pings `maintenance`. If it is unreachable, state stays
   `ACTIVE` and the command logs a NACK.
3. `result=draining state=DRAINING` means transfers are still in flight. Wait
   specifically for `CI_RESTART_ACK op=maintenance_on result=armed state=ARMED
   ... pending=0 main_inflight=0`.
   A drain timeout is a NACK and means `main` must not be stopped.
4. Stop, update, and start only `main`; keep Velocity and `maintenance` alive.
5. Execute `maintenance off` (or `cirestart ready`). The plugin first pings
   `main`; failure leaves everyone parked.
6. Wait for `CI_RESTART_ACK op=ready_complete ... state=ACTIVE`.

Every acknowledgement is a single stable line beginning with
`CI_RESTART_ACK` or `CI_RESTART_NACK`. Arbitrary player-facing text is omitted
from protocol lines, preventing message content from forging supervisor fields.

## Safety properties

- Maintenance is armed only after the holding backend answers a ping.
- Only players currently attached to `main` are drained.
- The final armed ACK is emitted only after every drain target has reached the
  holding server or disconnected, every pre-existing main connection attempt
  has resolved, and an atomic scan finds nobody on `main`.
- A drain timeout enters `RESTORING`, returns parked players to the still-live
  main backend, and ends with `maintenance_rollback result=active`. If rollback
  itself times out, remaining players are disconnected and routing is forcibly
  disarmed so Node has a deterministic `ACTIVE` recovery state.
- A ban, whitelist rejection, or other explicit main-backend rejection during
  restore disconnects only that player with the backend's exact reason and
  removes them from the restore barrier.
- New joins and new attempts to connect to `main` go to `maintenance` while
  state is `DRAINING` or `ARMED`.
- Off/ready starts only after `main` answers a ping.
- A failed or timed-out restore re-arms maintenance for remaining players.
- The plugin never restarts Velocity and never catches ordinary backend kicks.
