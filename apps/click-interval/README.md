# Click Interval V 1.5

Windows auto clicker and macro recorder with keyboard and mouse-button hotkeys.

Only the tool shown in the main window has active global controls. Right-click the active tab to lock or unlock it, or right-click either available tab and choose **Open in new window**. A detached tool disappears from the main tab bar; both tools remain active while they have separate windows, and closing either tool window returns its tab to the remaining window.

## run

Open `Start-ClickInterval.cmd` or use the Start menu shortcut.

The CPS cap limits the number of clicks sent each second. Values above 250 show a safety warning. The emergency shortcut immediately closes the entire app and its Python click engine.

Pick Location waits for the next physical mouse click and saves that point as the click destination.

## macros

The Macro home page is generated from the app-managed `%APPDATA%\click-interval\Macros` folder. Every valid `.cimacro` file in that folder is detected automatically when the library is opened. The borderless `+` button opens a naming window and then takes the new macro to its Recorder page. Submitting an empty name creates `My Macro`, then `My Macro 1`, `My Macro 2`, and so on when those names already exist. Names are limited to 40 characters. The folder icon imports a macro into the managed folder. Clicking a macro row opens its Recorder; the pencil icon opens a rename window and the trash icon permanently deletes the managed file after confirmation. Recently opened or played macros move to the top, below as many as three pinned macros. Right-clicking a macro opens its Pin or Unpin command.

The Recorder captures physical mouse movement, mouse buttons, keyboard input, and timing. Its controls are organized into centered Repeat and Playback columns, a behavior row, Recording, and Hotkeys. Recording quality can be Compact (30 Hz), Balanced (60 Hz), Smooth (120 Hz), or Ultra (240 Hz). Mouse samples are stored as compact timed paths and interpolated during playback instead of being expanded into hundreds of full movement actions. Saved paths use lossless delta packing, and the library index stores metadata rather than a duplicate action list. Existing version 1 files are compacted automatically when the library reloads. Repeat Count and Constant Repeat are mutually exclusive. Playback supports speed, start and loop delays, optional timing variance, returning the cursor to its starting point, minimizing the app, and stopping when real user input is detected. Macro shortcuts are handled directly from physical input transitions so Record/Stop and Play/Stop cannot miss a quick press. Each Record or Play button changes into its matching Stop action while active. The header save icon writes directly to the managed Macros folder; leaving with unsaved changes asks whether to save or discard them. While any popup is open, app controls and text behind it are dimmed and blocked while the black background remains unchanged. Custom dropdowns and hover hints use separate frameless windows so they can extend beyond the main app. Dropdown scrolling remains disabled until the opening animation finishes and is only enabled when the full option list cannot fit on the monitor.

The trigger icon in the Advanced editor opens an unselected dropdown for Color Relation, Color Presence, Pixel Color, Color Zone, Bar Fill, and Screen Change. Every trigger executes exactly where it appears and controls the action immediately below it. Color Presence measures selected-color coverage, Pixel Color samples one exact custom X/Y coordinate, Color Zone tests whether the color is present in a region, Bar Fill measures the largest connected color run along the region's long axis, and Screen Change compares consecutive scans. These are pixel-and-color detectors, not object recognition. A gated Go to action plus labels can form true/false branches. Custom search areas include a Select area on screen button. It opens a topmost dark overlay across the complete virtual desktop; dragging cuts out a clear rectangle with a dashed outline and preserves negative coordinates for monitors left of or above the primary display. Escape cancels. Clipped trigger descriptions expose their complete text through an external hover hint. Opening an editor does not change the macro. Pressing Add trigger to actions appends a new blue plain-text trigger row, then the next trigger starts with fresh settings. A macro can contain multiple triggers of the same or different types; each has independent scan and minimum-run timing.

Color Relation compares the horizontal position of two colors inside a selected screen area. It can gate the next macro action when the target is left, right, inside the boundary, centered, or when either color is missing. The `Bar Keeper` preset combines Color Relation triggers with ordinary mouse-down, mouse-up, and wait actions; every step remains visible and editable in the action list.

Trigger scanning is performance bounded. Small custom regions can scan every 16 ms, regions above 500,000 pixels run no faster than every 50 ms, and regions above 2,000,000 pixels run no faster than every 100 ms. Captures are shared by triggers using the same region during one playback loop. This avoids unbounded full-screen capture load while keeping small game-interface regions responsive.

Playback settings include optional window minimization, a start delay, and a delay between repeated loops. Browser zoom is locked at 100%, leaving combinations such as Ctrl + Minus, Ctrl + Plus, and Ctrl + 0 available for app shortcuts without resizing the interface.

The gear icon opens the Advanced editor, where the macro selector chooses which saved macro to edit. It uses the same action list and adds absolute/relative movement, capture filters, action ordering, manual actions, and Pressed/Hold/Toggle global triggers. Emergency Stop remains active during recording and playback and releases held macro keys or mouse buttons when playback stops.

The Advanced editor supports editable waits, mouse and keyboard down/up actions, captured paths, absolute and relative movement, wait-until relations, find-color-and-click, labels, Go to branching, and all six inline screen triggers. Keyboard actions can be changed by clicking the Key field and pressing the desired key. Click Interval uses its own JSON macro format; it does not claim AMC project compatibility.

## updates

Set `manifestUrl` in `update-config.json` to an HTTPS endpoint that returns the format shown in `update-signal.example.json`. A newer version makes the clean update icon appear beside Minimize. The development build checks immediately and every five seconds. A `LIVE UPDATE:` signal applies changed UI and preload files in the same running app process when the icon is clicked, with no notification popup. Replace the development manifest URL with the production release manifest before publishing. Production installers are downloaded only over HTTPS and launched only after their SHA-256 checksum matches the update signal.

Redistribution and resale are not permitted. See `EULA.txt`.
