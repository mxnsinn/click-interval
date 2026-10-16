# Click Interval

Click Interval is an open-source Windows toolbox. The desktop app combines an
auto clicker, macro recorder, Minecraft server manager, voice changer,
crosshair tools, and an input display in one interface.

Website: [click-interval.netlify.app](https://click-interval.netlify.app/)

## Repository layout

- `apps/click-interval/` — complete buildable desktop application
- `editions/auto-macro/` — isolated Auto Clicker + Macro edition
- `tools/auto-clicker/` — auto-clicker ownership and source map
- `tools/macro/` — macro ownership and source map
- `tools/minecraft-server/` — server-hosting components and source map
- `tools/voice-changer/` — voice-processing components and source map
- `tools/crosshair/` — crosshair components and source map
- `tools/input-display/` — input-display components and source map
- `test/` — release, privacy, update, and integrity checks

The current desktop runtime predates this repository split, so several UI and
backend files are shared by more than one tool. The source maps document exact
ownership without duplicating build inputs or breaking runtime paths. New
tool-specific code should be placed in its matching tool folder.

## Run the full toolbox

On Windows, from `apps/click-interval`:

```powershell
npm ci
npm start
```

The checked-in source does not include Python, Electron, Gradle caches, server
worlds, logs, user settings, macros, private update credentials, or signing
keys.

## Auto Clicker + Macro release

The isolated edition is the first Authenticode signing target because it is the
public installer currently distributed to other users. Its source is in
`editions/auto-macro` and contains no Minecraft server hosting code or personal
data.

## Privacy and signing

Click Interval stores user settings, macros, and hosted server data locally.
See [PRIVACY.md](PRIVACY.md), [SIGNING.md](SIGNING.md), and
[SECURITY.md](SECURITY.md).

Free code signing is being requested from
[SignPath Foundation](https://signpath.org/). Release binaries will be built
from this public repository in GitHub Actions and signed only after manual
approval.

## License

[MIT](LICENSE)
