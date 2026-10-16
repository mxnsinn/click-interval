"""Python click engine and global keyboard/mouse hotkey reader for Windows."""

import ctypes
from collections import deque, namedtuple
import json
import math
import os
import random
import sys
import threading
import time
from ctypes import wintypes

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
ctypes.windll.winmm.timeBeginPeriod(1)


def is_wine_runtime():
    if str(os.environ.get("CLICK_INTERVAL_WINE_COMPAT", "")).strip().lower() in ("1", "true", "yes", "on"):
        return True
    try:
        wine_get_version = ctypes.WinDLL("ntdll").wine_get_version
        wine_get_version.restype = ctypes.c_char_p
        return bool(wine_get_version())
    except (AttributeError, OSError, ctypes.ArgumentError):
        return False


WINE_RUNTIME = is_wine_runtime()

MOUSE_FLAGS = {
    "Left": (0x0002, 0x0004),
    "Right": (0x0008, 0x0010),
    "Middle": (0x0020, 0x0040),
}

RECORD_QUALITY = {
    "compact": {"sample_seconds": 1 / 30, "playback_hz": 60},
    "balanced": {"sample_seconds": 1 / 60, "playback_hz": 90},
    "smooth": {"sample_seconds": 1 / 120, "playback_hz": 144},
    "ultra": {"sample_seconds": 1 / 240, "playback_hz": 240},
}

MAX_BACKEND_EVENT_BYTES = 2 * 1024 * 1024
MAX_EMIT_QUEUE_EVENTS = 512
MAX_EMIT_QUEUE_BYTES = 4 * 1024 * 1024
MAX_EMIT_BATCH_EVENTS = 64
MAX_EMIT_BATCH_BYTES = 256 * 1024
MAX_RECORDED_ITEMS = 32768
MAX_RECORDED_SERIALIZED_BYTES = 1024 * 1024
TELEMETRY_EVENT_TYPES = {
    "cps", "physical_click", "input_event", "macro_playback_loop"
}

CREATE_WAITABLE_TIMER_HIGH_RESOLUTION = 0x00000002
TIMER_MODIFY_STATE = 0x0002
SYNCHRONIZE = 0x00100000
WAIT_OBJECT_0 = 0x00000000
WAIT_FAILED = 0xFFFFFFFF
INFINITE = 0xFFFFFFFF


class ClickInterruptEvent:
    """Mirror a Python event into a native manual-reset event when available."""

    def __init__(self):
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._kernel32 = None
        self._native_handle = None
        self._native_usable = False
        try:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            create_event = kernel32.CreateEventW
            create_event.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.BOOL, ctypes.c_wchar_p]
            create_event.restype = wintypes.HANDLE
            kernel32.SetEvent.argtypes = [wintypes.HANDLE]
            kernel32.SetEvent.restype = wintypes.BOOL
            kernel32.ResetEvent.argtypes = [wintypes.HANDLE]
            kernel32.ResetEvent.restype = wintypes.BOOL
            handle = create_event(None, True, False, None)
            if handle:
                self._kernel32 = kernel32
                self._native_handle = handle
                self._native_usable = True
        except (AttributeError, OSError, ctypes.ArgumentError):
            self._native_handle = None

    @property
    def native_handle(self):
        with self._lock:
            return self._native_handle if self._native_usable else None

    def set(self):
        # Serialize set/clear across both event implementations so a configure
        # wakeup cannot be cleared in only one of them.
        with self._lock:
            self._event.set()
            if self._native_handle and self._native_usable:
                try:
                    if not self._kernel32.SetEvent(self._native_handle):
                        self._native_usable = False
                except (AttributeError, OSError, ctypes.ArgumentError):
                    self._native_usable = False

    def clear(self):
        with self._lock:
            self._event.clear()
            if self._native_handle and self._native_usable:
                try:
                    if not self._kernel32.ResetEvent(self._native_handle):
                        self._native_usable = False
                except (AttributeError, OSError, ctypes.ArgumentError):
                    self._native_usable = False

    def wait(self, timeout=None):
        return self._event.wait(timeout)

    def is_set(self):
        return self._event.is_set()


class HighResolutionClickWaiter:
    """Interruptible, non-spinning high-resolution wait for the click clock."""

    def __init__(self, interrupt):
        self._interrupt = interrupt
        self._kernel32 = None
        self._timer_handle = None
        self._wait_handles = None
        interrupt_handle = interrupt.native_handle
        if not interrupt_handle:
            return

        try:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.SetWaitableTimer.argtypes = [
                wintypes.HANDLE,
                ctypes.POINTER(ctypes.c_longlong),
                wintypes.LONG,
                ctypes.c_void_p,
                ctypes.c_void_p,
                wintypes.BOOL,
            ]
            kernel32.SetWaitableTimer.restype = wintypes.BOOL
            kernel32.WaitForMultipleObjects.argtypes = [
                wintypes.DWORD,
                ctypes.POINTER(wintypes.HANDLE),
                wintypes.BOOL,
                wintypes.DWORD,
            ]
            kernel32.WaitForMultipleObjects.restype = wintypes.DWORD
            kernel32.CancelWaitableTimer.argtypes = [wintypes.HANDLE]
            kernel32.CancelWaitableTimer.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL

            timer_handle = None
            # Wine/CrossOver emulate the standard timer reliably, while the
            # Windows 10 high-resolution flag varies by Wine build. Native
            # Windows keeps the more precise path.
            if not WINE_RUNTIME:
                try:
                    create_timer_ex = kernel32.CreateWaitableTimerExW
                    create_timer_ex.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, wintypes.DWORD, wintypes.DWORD]
                    create_timer_ex.restype = wintypes.HANDLE
                    timer_handle = create_timer_ex(
                        None,
                        None,
                        CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                        TIMER_MODIFY_STATE | SYNCHRONIZE,
                    )
                    if not timer_handle:
                        timer_handle = create_timer_ex(
                            None,
                            None,
                            0,
                            TIMER_MODIFY_STATE | SYNCHRONIZE,
                        )
                except AttributeError:
                    timer_handle = None

            if not timer_handle:
                try:
                    create_timer = kernel32.CreateWaitableTimerW
                    create_timer.argtypes = [ctypes.c_void_p, wintypes.BOOL, ctypes.c_wchar_p]
                    create_timer.restype = wintypes.HANDLE
                    timer_handle = create_timer(None, False, None)
                except AttributeError:
                    timer_handle = None
            if not timer_handle:
                return
            self._kernel32 = kernel32
            self._timer_handle = timer_handle
            self._wait_handles = (wintypes.HANDLE * 2)(interrupt_handle, timer_handle)
        except (AttributeError, OSError, ctypes.ArgumentError):
            self._disable_native()

    def _disable_native(self):
        timer_handle = self._timer_handle
        kernel32 = self._kernel32
        self._timer_handle = None
        self._wait_handles = None
        self._kernel32 = None
        if timer_handle and kernel32:
            try:
                kernel32.CancelWaitableTimer(timer_handle)
            except (AttributeError, OSError, ctypes.ArgumentError):
                pass
            try:
                kernel32.CloseHandle(timer_handle)
            except (AttributeError, OSError, ctypes.ArgumentError):
                pass

    def wait_until(self, deadline):
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            return False
        if not self._timer_handle or not self._interrupt.native_handle:
            self._disable_native()
            return self._interrupt.wait(remaining)

        # Negative 100-nanosecond units specify a relative due time. Never arm
        # at zero because that would turn an intended wait into an immediate tick.
        due_time = ctypes.c_longlong(-max(1, math.ceil(remaining * 10_000_000)))
        try:
            armed = self._kernel32.SetWaitableTimer(
                self._timer_handle,
                ctypes.byref(due_time),
                0,
                None,
                None,
                False,
            )
            if armed:
                result = self._kernel32.WaitForMultipleObjects(
                    2,
                    self._wait_handles,
                    False,
                    INFINITE,
                )
                if result == WAIT_OBJECT_0:
                    if not self._kernel32.CancelWaitableTimer(self._timer_handle):
                        self._disable_native()
                    return True
                if result == WAIT_OBJECT_0 + 1:
                    return False
        except (AttributeError, OSError, ctypes.ArgumentError):
            pass

        # An unsupported API, failed arm, or invalid wait handle must not stop
        # clicking. Retire the native timer and use the existing event wait.
        self._disable_native()
        remaining = deadline - time.perf_counter()
        return self._interrupt.wait(remaining) if remaining > 0 else False

    def close(self):
        self._disable_native()


class MouseInput(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


class KeyboardInput(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


class InputUnion(ctypes.Union):
    _fields_ = [("mi", MouseInput), ("ki", KeyboardInput)]


class Input(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("union", InputUnion)]


def make_mouse_input_pair(down_flag, up_flag):
    """Build an immutable SendInput pair once instead of allocating it per click."""
    return (Input * 2)(
        Input(type=0, union=InputUnion(mi=MouseInput(0, 0, 0, down_flag, 0, 0))),
        Input(type=0, union=InputUnion(mi=MouseInput(0, 0, 0, up_flag, 0, 0))),
    )


MOUSE_INPUT_PAIRS = {
    button: make_mouse_input_pair(down_flag, up_flag)
    for button, (down_flag, up_flag) in MOUSE_FLAGS.items()
}


class Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class BitmapInfoHeader(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BitmapInfo(ctypes.Structure):
    _fields_ = [("bmiHeader", BitmapInfoHeader), ("bmiColors", wintypes.DWORD * 3)]


user32.GetDC.argtypes = [ctypes.c_void_p]
user32.GetDC.restype = ctypes.c_void_p
user32.ReleaseDC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
gdi32.CreateCompatibleDC.argtypes = [ctypes.c_void_p]
gdi32.CreateCompatibleDC.restype = ctypes.c_void_p
gdi32.CreateCompatibleBitmap.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
gdi32.CreateCompatibleBitmap.restype = ctypes.c_void_p
gdi32.SelectObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
gdi32.SelectObject.restype = ctypes.c_void_p
gdi32.BitBlt.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, wintypes.DWORD]
gdi32.BitBlt.restype = wintypes.BOOL
gdi32.GetDIBits.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT, wintypes.UINT, ctypes.c_void_p, ctypes.POINTER(BitmapInfo), wintypes.UINT]
gdi32.GetDIBits.restype = ctypes.c_int
gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
gdi32.DeleteDC.argtypes = [ctypes.c_void_p]
class LowLevelMouseData(ctypes.Structure):
    _fields_ = [
        ("pt", Point),
        ("mouseData", ctypes.c_ulong),
        ("flags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


class LowLevelKeyboardData(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


class Message(ctypes.Structure):
    _fields_ = [
        ("hwnd", ctypes.c_void_p),
        ("message", ctypes.c_uint),
        ("wParam", ctypes.c_size_t),
        ("lParam", ctypes.c_ssize_t),
        ("time", ctypes.c_ulong),
        ("pt", Point),
        ("lPrivate", ctypes.c_ulong),
    ]


state_lock = threading.Lock()
state = {
    "enabled": True,
    "hotkey_vk": 0x51,
    "hotkey_name": "Q",
    "interval_ms": 100,
    "random_enabled": False,
    "random_ms": 40,
    "mouse_button": "Left",
    "click_type": "Single",
    "cps_cap": 100,
    "emergency_vk": 0x7B,
    "emergency_modifiers": 0x06,
    "emergency_keys": [0x11, 0x10, 0x7B],
    "emergency_capture_active": False,
    "cursor_mode": "current",
    "cursor_x": 0,
    "cursor_y": 0,
    "macro_enabled": False,
    "macro_trigger_keys": [],
    "macro_trigger_mode": "Pressed",
    "macro_trigger_capture_active": False,
    "macro_playback_speed": 1.0,
    "macro_start_delay_ms": 0,
    "macro_loop_delay_ms": 0,
    "macro_restore_cursor": False,
    "macro_stop_on_input": False,
    "macro_timing_variance": 0,
    "macro_control_capture_active": False,
    "macro_record_hotkey_keys": [0x11, 0x79],
    "macro_play_hotkey_keys": [0x11, 0x7A],
    "macro_record_settings": {
        "mouse_movement": True,
        "mouse_buttons": True,
        "keyboard": True,
        "delays": True,
        "position_mode": "absolute",
    },
    "macro_repeat_mode": "count",
    "macro_repeat_count": 3,
    "auto_tool_active": True,
    "macro_tool_active": False,
}

# The click loop reads this immutable, compact snapshot without taking the
# shared state lock or copying the much larger application state per click.
AutoClickSettings = namedtuple(
    "AutoClickSettings",
    (
        "interval_ms",
        "random_enabled",
        "random_ms",
        "mouse_button",
        "click_type",
        "cps_cap",
        "cursor_mode",
        "cursor_x",
        "cursor_y",
    ),
)


def make_auto_click_settings(values):
    return AutoClickSettings(
        interval_ms=values["interval_ms"],
        random_enabled=values["random_enabled"],
        random_ms=values["random_ms"],
        mouse_button=values["mouse_button"],
        click_type=values["click_type"],
        cps_cap=values["cps_cap"],
        cursor_mode=values["cursor_mode"],
        cursor_x=values["cursor_x"],
        cursor_y=values["cursor_y"],
    )


auto_click_settings_snapshot = make_auto_click_settings(state)
running = threading.Event()
click_interrupt = ClickInterruptEvent()
recording = threading.Event()
playing_macro = threading.Event()
macro_play_stop = threading.Event()
MouseHookProcedure = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t)
KeyboardHookProcedure = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t)
mouse_hook_reference = None
keyboard_hook_reference = None
diagnostic_lock = threading.Lock()
diagnostic_dirty = threading.Event()
emit_condition = threading.Condition()
emit_queue = deque()
emit_queue_bytes = 0
emit_dropped_events = 0
diagnostic_state = {}
def configured_diagnostic_path(arguments):
    """Accept only the private runtime-state path supplied by the Electron host."""
    try:
        marker_index = arguments.index("--diagnostic-path")
    except ValueError:
        return ""
    if marker_index + 1 >= len(arguments):
        return ""
    value = str(arguments[marker_index + 1]).strip()
    return os.path.abspath(value) if value else ""


diagnostic_path = configured_diagnostic_path(sys.argv[1:])
mouse_hotkey_ready_at = 0.0
emergency_hotkey_ready_at = 0.0
auto_hotkey_lock = threading.Lock()
auto_hotkey_down_vk = None
pick_cursor_pending = threading.Event()
macro_lock = threading.Lock()
macro_record_finalize_lock = threading.Lock()
macro_play_start_lock = threading.Lock()
macro_actions = []
macro_record_settings = {}
macro_record_last_at = 0.0
macro_record_last_mouse = (0, 0)
macro_record_last_move_at = 0.0
macro_record_ignore_until = 0.0
macro_record_estimated_bytes = 2
macro_record_item_count = 0
macro_record_finalized = True
macro_record_limit_message = ""
macro_toggle_active = False
physical_keys_lock = threading.Lock()
physical_keys_down = set()
macro_record_combo_down = False
macro_play_combo_down = False
macro_play_stop_on_input = False
macro_ignore_physical_until = 0.0
macro_play_ignored_keys = set()


def write_diagnostic(**values):
    with diagnostic_lock:
        diagnostic_state.update(values)
    diagnostic_dirty.set()


def diagnostic_writer():
    """Coalesce diagnostics off timing-sensitive hook and click threads."""
    while True:
        diagnostic_dirty.wait()
        diagnostic_dirty.clear()
        with diagnostic_lock:
            snapshot = dict(diagnostic_state)
        if not diagnostic_path:
            continue
        try:
            os.makedirs(os.path.dirname(diagnostic_path), exist_ok=True)
            temporary_path = f"{diagnostic_path}.tmp"
            with open(temporary_path, "w", encoding="utf-8") as file:
                json.dump(snapshot, file, separators=(",", ":"))
            os.replace(temporary_path, diagnostic_path)
        except OSError:
            # Diagnostics must never take down or delay the input engines.
            pass


def _compact_json(payload):
    # Keep the established wire representation for existing diagnostics/tests;
    # bounding and batching happen around it rather than changing the protocol.
    return json.dumps(payload)


def _drop_queued_event_locked(telemetry_only):
    """Drop one queued event without ever waiting on the pipe from a hook thread."""
    global emit_queue_bytes, emit_dropped_events
    for index, queued in enumerate(emit_queue):
        if telemetry_only and not queued[2]:
            continue
        del emit_queue[index]
        emit_queue_bytes -= queued[1]
        emit_dropped_events += 1
        return True
    return False


def emit(payload):
    """Queue one bounded protocol line; Windows hook threads never perform pipe I/O."""
    global emit_queue_bytes, emit_dropped_events
    try:
        serialized = _compact_json(payload)
    except (TypeError, ValueError):
        serialized = _compact_json({"type": "error", "message": "The click engine could not encode an event."})
    size = len(serialized.encode("utf-8"))
    if size > MAX_BACKEND_EVENT_BYTES:
        serialized = _compact_json({
            "type": "error",
            "message": "The click engine discarded an oversized event.",
        })
        size = len(serialized)
    event_type = payload.get("type") if isinstance(payload, dict) else ""
    telemetry = event_type in TELEMETRY_EVENT_TYPES
    with emit_condition:
        while emit_queue and (
            len(emit_queue) >= MAX_EMIT_QUEUE_EVENTS
            or emit_queue_bytes + size > MAX_EMIT_QUEUE_BYTES
        ):
            if telemetry:
                emit_dropped_events += 1
                return False
            if not _drop_queued_event_locked(True) and not _drop_queued_event_locked(False):
                emit_dropped_events += 1
                return False
        queued_event = (serialized, size, telemetry)
        if telemetry:
            emit_queue.append(queued_event)
        else:
            first_telemetry = next(
                (index for index, queued in enumerate(emit_queue) if queued[2]),
                len(emit_queue),
            )
            emit_queue.insert(first_telemetry, queued_event)
        emit_queue_bytes += size
        emit_condition.notify()
    return True


def emit_writer():
    """Batch stdout writes on a dedicated daemon so a blocked parent cannot freeze input."""
    global emit_queue_bytes, emit_dropped_events
    while True:
        with emit_condition:
            while not emit_queue:
                emit_condition.wait()
            batch = []
            batch_bytes = 0
            while emit_queue and len(batch) < MAX_EMIT_BATCH_EVENTS:
                serialized, size, _telemetry = emit_queue[0]
                if batch and batch_bytes + size > MAX_EMIT_BATCH_BYTES:
                    break
                emit_queue.popleft()
                emit_queue_bytes -= size
                batch.append(serialized)
                batch_bytes += size
            dropped = emit_dropped_events
            emit_dropped_events = 0
        if dropped:
            batch.append(_compact_json({"type": "backend_output_throttled", "dropped": dropped}))
        try:
            sys.stdout.write("\n".join(batch) + "\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            os._exit(0)


def set_running(value):
    if value and not running.is_set():
        with state_lock:
            active_interval = state["interval_ms"]
        write_diagnostic(running=True, interval_at_start=active_interval, started_at=time.time())
        running.set()
        click_interrupt.set()
        emit({"type": "started"})
    elif not value and running.is_set():
        running.clear()
        click_interrupt.set()
        write_diagnostic(running=False, stopped_at=time.time())
        emit({"type": "stopped"})


def process_auto_hotkey_event(event_vk, is_down):
    """Toggle from physical hook edges for both keyboard and mouse hotkeys."""
    global auto_hotkey_down_vk
    event_vk = int(event_vk)
    with state_lock:
        configured_vk = int(state["hotkey_vk"])
        is_mouse_hotkey = configured_vk in (0x04, 0x05, 0x06)
        should_handle = (
            bool(state["enabled"])
            and bool(state.get("auto_tool_active", True))
            and configured_vk == event_vk
            and (not is_mouse_hotkey or time.monotonic() >= mouse_hotkey_ready_at)
        )
    toggle = False
    with auto_hotkey_lock:
        if is_down and should_handle and auto_hotkey_down_vk != event_vk:
            auto_hotkey_down_vk = event_vk
            toggle = True
        elif not is_down and auto_hotkey_down_vk == event_vk:
            auto_hotkey_down_vk = None
    if toggle:
        set_running(not running.is_set())


def inject_test_hotkey(vk):
    if os.environ.get("CLICK_INTERVAL_TEST") != "1":
        return
    vk = int(vk)
    if vk in (0x04, 0x05, 0x06):
        mouse_data = 0 if vk == 0x04 else (1 if vk == 0x05 else 2)
        down_flag = 0x0020 if vk == 0x04 else 0x0080
        up_flag = 0x0040 if vk == 0x04 else 0x0100
        inputs = (Input * 2)(
            Input(type=0, union=InputUnion(mi=MouseInput(0, 0, mouse_data, down_flag, 0, 0))),
            Input(type=0, union=InputUnion(mi=MouseInput(0, 0, mouse_data, up_flag, 0, 0))),
        )
    else:
        inputs = (Input * 2)(
            Input(type=1, union=InputUnion(ki=KeyboardInput(vk, 0, 0, 0, 0))),
            Input(type=1, union=InputUnion(ki=KeyboardInput(vk, 0, 0x0002, 0, 0))),
        )
    user32.SendInput(2, inputs, ctypes.sizeof(Input))


def emergency_stop():
    macro_play_stop.set()
    if recording.is_set():
        recording.clear()
        threading.Thread(target=stop_macro_recording, daemon=True).start()
    set_running(False)
    with state_lock:
        state["enabled"] = False
    write_diagnostic(emergency_stopped_at=time.time(), configured_enabled=False)
    emit({"type": "emergency_stop"})


def _serialized_recording_value_bytes(value):
    return len(_compact_json(value).encode("utf-8"))


def _reserve_recording_space_locked(item_count, byte_count):
    global macro_record_estimated_bytes, macro_record_item_count, macro_record_limit_message
    if (
        macro_record_item_count + item_count > MAX_RECORDED_ITEMS
        or macro_record_estimated_bytes + byte_count > MAX_RECORDED_SERIALIZED_BYTES
    ):
        macro_record_limit_message = (
            "Recording stopped at the safety limit. The captured actions were kept; "
            "start a second recording for the remaining steps."
        )
        recording.clear()
        return False
    macro_record_item_count += item_count
    macro_record_estimated_bytes += byte_count
    return True


def _finish_limited_macro_recording():
    threading.Thread(target=stop_macro_recording, daemon=True).start()


def add_recorded_action(action):
    global macro_record_last_at
    if not recording.is_set():
        return
    now = time.perf_counter()
    if now < macro_record_ignore_until:
        return
    limit_reached = False
    with macro_lock:
        pending = []
        if macro_record_settings.get("delays", True) and macro_record_last_at:
            delay_ms = int(round((now - macro_record_last_at) * 1000))
            if delay_ms > 0:
                pending.append({"type": "wait", "ms": delay_ms, "_recorded_at": now})
        action["_recorded_at"] = now
        pending.append(action)
        serialized_sizes = [
            _serialized_recording_value_bytes({key: value for key, value in item.items() if key != "_recorded_at"})
            for item in pending
        ]
        comma_bytes = 2 * (max(0, len(pending) - 1) + (1 if macro_actions and pending else 0))
        if _reserve_recording_space_locked(len(pending), sum(serialized_sizes) + comma_bytes):
            macro_actions.extend(pending)
            macro_record_last_at = now
        else:
            limit_reached = True
    if limit_reached:
        _finish_limited_macro_recording()


def add_recorded_move(action, now):
    global macro_record_last_at
    if not recording.is_set() or now < macro_record_ignore_until:
        return
    limit_reached = False
    with macro_lock:
        delay_ms = 0
        if macro_record_settings.get("delays", True) and macro_record_last_at:
            delay_ms = max(0, int(round((now - macro_record_last_at) * 1000)))
        relative = bool(action.get("relative"))
        point = [delay_ms, int(action.get("x", 0)), int(action.get("y", 0)), now]
        if (
            macro_actions
            and macro_actions[-1].get("type") == "move_path"
            and bool(macro_actions[-1].get("relative")) == relative
            and len(macro_actions[-1].get("points", [])) < 2048
        ):
            points = macro_actions[-1]["points"]
            stored_point = point[:3]
            byte_count = _serialized_recording_value_bytes(stored_point) + (2 if points else 0)
            if _reserve_recording_space_locked(1, byte_count):
                points.append(point)
                macro_actions[-1]["_recorded_at"] = now
            else:
                limit_reached = True
        else:
            quality = macro_record_settings.get("quality", "balanced")
            source = {
                "type": "move_path",
                "relative": relative,
                "quality": quality,
                "playback_hz": RECORD_QUALITY[quality]["playback_hz"],
                "points": [point],
                "_recorded_at": now,
            }
            stored = {key: value for key, value in source.items() if key != "_recorded_at"}
            stored["points"] = [point[:3]]
            byte_count = _serialized_recording_value_bytes(stored) + (2 if macro_actions else 0)
            if _reserve_recording_space_locked(1, byte_count):
                macro_actions.append(source)
            else:
                limit_reached = True
        if not limit_reached:
            macro_record_last_at = now
    if limit_reached:
        _finish_limited_macro_recording()


def start_macro_recording(settings):
    global macro_actions, macro_record_settings, macro_record_last_at, macro_record_last_mouse, macro_record_last_move_at, macro_record_ignore_until
    global macro_record_estimated_bytes, macro_record_item_count, macro_record_finalized, macro_record_limit_message
    macro_play_stop.set()
    playing_macro.clear()
    point = Point()
    user32.GetCursorPos(ctypes.byref(point))
    with macro_record_finalize_lock:
        if not macro_record_finalized:
            return
        macro_record_finalized = False
        with macro_lock:
            macro_actions = []
            macro_record_settings = {
                "mouse_movement": bool(settings.get("mouse_movement", True)),
                "mouse_buttons": bool(settings.get("mouse_buttons", True)),
                "keyboard": bool(settings.get("keyboard", True)),
                "delays": bool(settings.get("delays", True)),
                "position_mode": "relative" if settings.get("position_mode") == "relative" else "absolute",
                "quality": settings.get("quality") if settings.get("quality") in RECORD_QUALITY else "balanced",
            }
            macro_record_ignore_until = time.perf_counter() + 0.30
            macro_record_last_at = macro_record_ignore_until
            macro_record_last_mouse = (point.x, point.y)
            macro_record_last_move_at = 0.0
            macro_record_estimated_bytes = 2
            macro_record_item_count = 0
            macro_record_limit_message = ""
        recording.set()
    emit({"type": "macro_recording_started"})


def stop_macro_recording():
    global macro_record_finalized
    with macro_record_finalize_lock:
        if macro_record_finalized:
            return
        macro_record_finalized = True
        recording.clear()
        with macro_lock:
            cutoff = time.perf_counter() - 0.28
            while macro_actions and float(macro_actions[-1].get("_recorded_at", 0)) >= cutoff:
                last = macro_actions[-1]
                if last.get("type") == "move_path":
                    points = last.get("points", [])
                    while points and len(points[-1]) > 3 and float(points[-1][3]) >= cutoff:
                        points.pop()
                    if points:
                        last["_recorded_at"] = points[-1][3] if len(points[-1]) > 3 else 0
                        break
                macro_actions.pop()
            actions = []
            for source in macro_actions:
                action = {key: value for key, value in source.items() if key != "_recorded_at"}
                if action.get("type") == "move_path":
                    action["points"] = [point[:3] for point in action.get("points", [])]
                actions.append(action)
            macro_actions.clear()
            macro_actions.extend(actions)
            limit_message = macro_record_limit_message
    emit({"type": "macro_recording_stopped", "actions": actions})
    if limit_message:
        emit({"type": "macro_error", "message": limit_message})


def send_keyboard_action(vk, key_up):
    keyboard = KeyboardInput(int(vk), 0, 0x0002 if key_up else 0, 0, 0)
    input_value = Input(type=1, union=InputUnion(ki=keyboard))
    return int(user32.SendInput(1, ctypes.byref(input_value), ctypes.sizeof(Input))) == 1


def send_mouse_button_action(button, key_up):
    flags = {
        "Left": (0x0002, 0x0004, 0),
        "Right": (0x0008, 0x0010, 0),
        "Middle": (0x0020, 0x0040, 0),
        "MB4": (0x0080, 0x0100, 1 << 16),
        "MB5": (0x0080, 0x0100, 2 << 16),
    }
    down, up, data = flags.get(button, flags["Left"])
    mouse = MouseInput(0, 0, data, up if key_up else down, 0, 0)
    input_value = Input(type=0, union=InputUnion(mi=mouse))
    return int(user32.SendInput(1, ctypes.byref(input_value), ctypes.sizeof(Input))) == 1


def parse_hex_color(value, fallback):
    text = str(value or "").strip().lstrip("#")
    if len(text) != 6:
        text = fallback
    try:
        red = int(text[0:2], 16)
        green = int(text[2:4], 16)
        blue = int(text[4:6], 16)
    except ValueError:
        red, green, blue = 255, 255, 255
    return blue, green, red


def color_matches(bitmap, offset, target, tolerance):
    return (
        abs(bitmap[offset] - target[0])
        + abs(bitmap[offset + 1] - target[1])
        + abs(bitmap[offset + 2] - target[2])
    ) / 3 <= tolerance


def widest_column_group(columns, maximum_gap=2):
    best = None
    start = None
    last = None
    gap = 0
    for index, active in enumerate(columns):
        if active:
            if start is None:
                start = index
            last = index
            gap = 0
        elif start is not None:
            gap += 1
            if gap > maximum_gap:
                candidate = (start, last)
                if best is None or candidate[1] - candidate[0] > best[1] - best[0]:
                    best = candidate
                start = None
                last = None
                gap = 0
    if start is not None:
        candidate = (start, last)
        if best is None or candidate[1] - candidate[0] > best[1] - best[0]:
            best = candidate
    return best


def analyze_color_bounds(bitmap, width, height, color, tolerance=35, minimum_coverage=0.14, offset_x=0):
    if bitmap is None or width < 1 or height < 1:
        return {"found": False}
    target = parse_hex_color(color, "ffffff")
    tolerance = min(120, max(1, int(tolerance)))
    row_step = max(1, height // 80)
    rows = list(range(0, height, row_step))
    minimum_hits = max(1, int(len(rows) * min(1.0, max(0.01, float(minimum_coverage)))))
    counts = [0] * width
    for x in range(width):
        for y in rows:
            if color_matches(bitmap, (y * width + x) * 4, target, tolerance):
                counts[x] += 1
    group = widest_column_group([count >= minimum_hits for count in counts])
    if group is None:
        return {"found": False}
    left, right = group
    return {
        "found": True,
        "left": float(left + offset_x),
        "right": float(right + offset_x),
        "center": float((left + right) / 2.0 + offset_x),
        "confidence": min(1.0, max(counts[left:right + 1]) / max(1, len(rows))),
    }


def evaluate_color_relation(bitmap, width, height, configuration, offset_x=0):
    tolerance = min(120, max(1, int(configuration.get("relationTolerance", 35))))
    boundary = analyze_color_bounds(
        bitmap, width, height, configuration.get("relationBoundaryColor", "#ffffff"),
        tolerance, 0.02, offset_x
    )
    target = analyze_color_bounds(
        bitmap, width, height, configuration.get("relationTargetColor", "#ff0000"),
        tolerance, 0.05, offset_x
    )
    if not boundary.get("found") or not target.get("found"):
        return "tracking_lost"
    if configuration.get("condition") == "colors_visible":
        return "colors_visible"
    margin = min(100, max(0, float(configuration.get("relationEdgeMargin", 3))))
    target_x = float(target.get("center", 0))
    if configuration.get("condition") in ("target_right_of_center", "target_left_of_center", "target_centered"):
        boundary_center = float(boundary.get("center", 0))
        if target_x >= boundary_center + margin:
            return "target_right_of_center"
        if target_x <= boundary_center - margin:
            return "target_left_of_center"
        return "target_centered"
    if target_x <= float(boundary.get("left", 0)) + margin:
        return "target_left"
    if target_x >= float(boundary.get("right", 0)) - margin:
        return "target_right"
    return "target_inside"


def locate_color_center(bitmap, width, height, color, tolerance=20, minimum_pixels=20, offset_x=0, offset_y=0):
    if bitmap is None or width < 1 or height < 1:
        return None
    target = parse_hex_color(color, "ffffff")
    allowed = min(120, max(1, int(tolerance)))
    step = max(1, max(width, height) // 700)
    left, top, right, bottom = width, height, -1, -1
    matches = 0
    for y in range(0, height, step):
        for x in range(0, width, step):
            if color_matches(bitmap, (y * width + x) * 4, target, allowed):
                left = min(left, x)
                top = min(top, y)
                right = max(right, x)
                bottom = max(bottom, y)
                matches += 1
    required = max(1, int(minimum_pixels) // (step * step))
    if matches < required or right < left or bottom < top:
        return None
    return {
        "x": int(round((left + right) / 2.0)) + int(offset_x),
        "y": int(round((top + bottom) / 2.0)) + int(offset_y),
        "matches": matches * step * step,
    }


def color_coverage_percent(bitmap, width, height, color, tolerance=25):
    if bitmap is None or width < 1 or height < 1:
        return 0.0
    target = parse_hex_color(color, "ffffff")
    allowed = min(120, max(1, int(tolerance)))
    step = max(1, int(((width * height) / 180000) ** 0.5))
    matches = 0
    samples = 0
    for y in range(0, height, step):
        for x in range(0, width, step):
            samples += 1
            if color_matches(bitmap, (y * width + x) * 4, target, allowed):
                matches += 1
    return matches * 100.0 / max(1, samples)


def bar_fill_percent(bitmap, width, height, color, tolerance=25):
    """Measure the largest connected color run along the region's long axis."""
    if bitmap is None or width < 1 or height < 1:
        return 0.0
    target = parse_hex_color(color, "ffffff")
    allowed = min(120, max(1, int(tolerance)))
    horizontal = width >= height
    primary = width if horizontal else height
    secondary = height if horizontal else width
    secondary_step = max(1, secondary // 120)
    secondary_samples = len(range(0, secondary, secondary_step))
    active = []
    for primary_index in range(primary):
        hits = 0
        for secondary_index in range(0, secondary, secondary_step):
            x, y = (primary_index, secondary_index) if horizontal else (secondary_index, primary_index)
            if color_matches(bitmap, (y * width + x) * 4, target, allowed):
                hits += 1
        active.append(hits >= max(1, int(secondary_samples * 0.18)))
    group = widest_column_group(active, maximum_gap=max(1, primary // 250))
    if group is None:
        return 0.0
    return (group[1] - group[0] + 1) * 100.0 / max(1, primary)


def sampled_screen_frame(bitmap, width, height):
    if bitmap is None:
        return None
    step = max(1, int(((width * height) / 120000) ** 0.5))
    sample = bytearray()
    for y in range(0, height, step):
        for x in range(0, width, step):
            offset = (y * width + x) * 4
            sample.extend(bitmap[offset:offset + 3])
    return bytes(sample)


def screen_change_analysis(bitmap, previous_sample, width, height):
    current_sample = sampled_screen_frame(bitmap, width, height)
    if current_sample is None or previous_sample is None:
        return 0.0, current_sample
    if len(previous_sample) == width * height * 4:
        previous_sample = sampled_screen_frame(previous_sample, width, height)
    if len(previous_sample) != len(current_sample):
        return 0.0, current_sample
    difference = 0
    for current, previous in zip(current_sample, previous_sample):
        difference += abs(current - previous)
    return difference * 100.0 / max(1, len(current_sample) * 255), current_sample


def screen_change_percent(bitmap, previous_bitmap, width, height):
    return screen_change_analysis(bitmap, previous_bitmap, width, height)[0]


def evaluate_screen_trigger(bitmap, width, height, configuration, previous_bitmap=None):
    kind = configuration.get("displayKind") or configuration.get("kind") or "visual"
    condition = configuration.get("condition", "above")
    if kind == "screen":
        if previous_bitmap is None:
            return {"matched": False, "metric": 0.0, "sample": sampled_screen_frame(bitmap, width, height)}
        metric, sample = screen_change_analysis(bitmap, previous_bitmap, width, height)
        threshold = min(100.0, max(0.1, float(configuration.get("changeThreshold", 10))))
        return {"matched": metric < threshold if condition == "still" else metric >= threshold, "metric": metric, "sample": sample}
    tolerance = configuration.get("colorTolerance", 25)
    if kind == "bar":
        metric = bar_fill_percent(bitmap, width, height, configuration.get("color", "#ffffff"), tolerance)
    else:
        metric = color_coverage_percent(bitmap, width, height, configuration.get("color", "#ff0000"), tolerance)
    threshold = min(100.0, max(0.0, float(configuration.get("colorCoverage", 5))))
    return {"matched": metric < threshold if condition == "below" else metric >= threshold, "metric": metric}


def trigger_capture_area(configuration):
    mode = configuration.get("areaMode", "custom")
    virtual_x = user32.GetSystemMetrics(76)
    virtual_y = user32.GetSystemMetrics(77)
    virtual_width = max(1, user32.GetSystemMetrics(78))
    virtual_height = max(1, user32.GetSystemMetrics(79))
    if mode == "full":
        return virtual_x, virtual_y, virtual_width, virtual_height
    if mode == "center":
        width = max(1, virtual_width // 2)
        height = max(1, virtual_height // 2)
        return virtual_x + (virtual_width - width) // 2, virtual_y + (virtual_height - height) // 2, width, height
    area = configuration.get("area") if isinstance(configuration.get("area"), dict) else {}
    return (
        int(area.get("x", 0)), int(area.get("y", 0)),
        min(8192, max(1, int(area.get("width", 500)))),
        min(4320, max(1, int(area.get("height", 120)))),
    )


class ScreenRegionCapture:
    def __init__(self, x, y, width, height):
        self.x = int(x)
        self.y = int(y)
        self.width = max(1, int(width))
        self.height = max(1, int(height))
        self.screen_dc = user32.GetDC(None)
        self.memory_dc = gdi32.CreateCompatibleDC(self.screen_dc)
        self.bitmap = gdi32.CreateCompatibleBitmap(self.screen_dc, self.width, self.height)
        self.previous = gdi32.SelectObject(self.memory_dc, self.bitmap)
        self.buffer = (ctypes.c_ubyte * (self.width * self.height * 4))()
        self.info = BitmapInfo()
        self.info.bmiHeader.biSize = ctypes.sizeof(BitmapInfoHeader)
        self.info.bmiHeader.biWidth = self.width
        self.info.bmiHeader.biHeight = -self.height
        self.info.bmiHeader.biPlanes = 1
        self.info.bmiHeader.biBitCount = 32
        self.info.bmiHeader.biCompression = 0

    def capture(self):
        copied = gdi32.BitBlt(self.memory_dc, 0, 0, self.width, self.height, self.screen_dc, self.x, self.y, 0x00CC0020)
        rows = gdi32.GetDIBits(self.memory_dc, self.bitmap, 0, self.height, self.buffer, ctypes.byref(self.info), 0)
        if not copied or rows != self.height:
            return None
        return self.buffer

    def close(self):
        if self.memory_dc and self.previous:
            gdi32.SelectObject(self.memory_dc, self.previous)
        if self.bitmap:
            gdi32.DeleteObject(self.bitmap)
        if self.memory_dc:
            gdi32.DeleteDC(self.memory_dc)
        if self.screen_dc:
            user32.ReleaseDC(None, self.screen_dc)
        self.previous = None
        self.bitmap = None
        self.memory_dc = None
        self.screen_dc = None


def perform_macro_action(action):
    action_type = action.get("type")
    if action_type == "move":
        if action.get("relative"):
            point = Point()
            user32.GetCursorPos(ctypes.byref(point))
            user32.SetCursorPos(point.x + int(action.get("x", 0)), point.y + int(action.get("y", 0)))
        else:
            user32.SetCursorPos(int(action.get("x", 0)), int(action.get("y", 0)))
    elif action_type in ("mouse_down", "mouse_up"):
        button = action.get("button", "Left")
        if send_mouse_button_action(button, action_type == "mouse_up"):
            emit({"type": "input_event", "device": "mouse", "control": button, "action": "up" if action_type == "mouse_up" else "down", "source": "macro"})
    elif action_type in ("key_down", "key_up"):
        vk = int(action.get("vk", 0))
        if send_keyboard_action(vk, action_type == "key_up"):
            emit({"type": "input_event", "device": "keyboard", "control": vk, "action": "up" if action_type == "key_up" else "down", "source": "macro"})


def release_macro_inputs(pressed_keys, pressed_mouse):
    for vk in tuple(pressed_keys):
        if send_keyboard_action(vk, True):
            emit({"type": "input_event", "device": "keyboard", "control": vk, "action": "up", "source": "macro"})
    for button in tuple(pressed_mouse):
        if send_mouse_button_action(button, True):
            emit({"type": "input_event", "device": "mouse", "control": button, "action": "up", "source": "macro"})
    pressed_keys.clear()
    pressed_mouse.clear()


def macro_play_worker(actions, repeat_count, speed, start_delay_ms, loop_delay_ms, restore_cursor, timing_variance, prepared=False):
    global macro_play_stop_on_input
    pressed_keys = set()
    pressed_mouse = set()
    managed_mouse_buttons = {
        action.get("button", "Left")
        for index, action in enumerate(actions)
        if action.get("type") in ("mouse_down", "mouse_up")
        and index > 0 and actions[index - 1].get("type") in ("flow_trigger", "screen_trigger")
    }
    capture_cache = {}
    trigger_states = {}
    origin = Point()
    user32.GetCursorPos(ctypes.byref(origin))
    try:
        playing_macro.set()
        # Direct test/internal calls prepare their own run. Normal starts clear the
        # stop flag before spawning so an immediate Stop cannot be lost here.
        if not prepared:
            macro_play_stop.clear()
        if start_delay_ms > 0 and macro_play_stop.wait(start_delay_ms / 1000.0):
            return
        has_relative_movement = any(action.get("type") in ("move", "move_path") and action.get("relative") for action in actions)
        labels = {
            str(action.get("name", "")).strip().lower(): index
            for index, action in enumerate(actions)
            if action.get("type") == "label" and str(action.get("name", "")).strip()
        }
        completed_loops = 0
        emit({"type": "macro_playback_started", "repeat_count": repeat_count, "speed": speed})
        while not macro_play_stop.is_set() and (repeat_count == 0 or completed_loops < repeat_count):
            control_cycle_started = time.perf_counter()
            if completed_loops > 0 and has_relative_movement:
                user32.SetCursorPos(origin.x, origin.y)
            timeline_started = time.perf_counter()
            timeline_offset = 0.0
            frame_cache = {}
            relation_cache = {}
            skip_next_action = False
            action_index = 0
            control_jumps = 0
            while action_index < len(actions):
                current_action_index = action_index
                action = actions[action_index]
                action_index += 1
                if macro_play_stop.is_set():
                    break
                if skip_next_action:
                    skip_next_action = False
                    continue
                if action.get("type") == "label":
                    continue
                if action.get("type") == "goto":
                    destination = labels.get(str(action.get("name", "")).strip().lower())
                    if destination is None:
                        emit({"type": "macro_error", "message": f"Label not found: {action.get('name', '')}"})
                        macro_play_stop.set()
                        break
                    control_jumps += 1
                    if control_jumps > 100000:
                        emit({"type": "macro_error", "message": "The macro exceeded its control-flow safety limit."})
                        macro_play_stop.set()
                        break
                    action_index = destination
                    frame_cache.clear()
                    relation_cache.clear()
                    continue
                if action.get("type") in ("flow_trigger", "screen_trigger"):
                    config = action.get("config") if isinstance(action.get("config"), dict) else {}
                    if config.get("enabled", True) is False:
                        continue
                    capture_key = trigger_capture_area(config)
                    capture = capture_cache.get(capture_key)
                    if capture is None:
                        capture = ScreenRegionCapture(*capture_key)
                        capture_cache[capture_key] = capture
                    trigger_id = str(config.get("id") or f"action-{current_action_index}")
                    trigger_state = trigger_states.setdefault(trigger_id, {
                        "next_scan_at": 0.0, "matched": False, "last_allowed_at": 0.0, "previous_bitmap": None
                    })
                    now = time.perf_counter()
                    pixel_count = capture_key[2] * capture_key[3]
                    requested_interval = max(0.016, float(config.get("scanInterval", 33)) / 1000.0)
                    safe_interval = 0.1 if pixel_count > 2000000 else 0.05 if pixel_count > 500000 else 0.016
                    if now >= trigger_state["next_scan_at"]:
                        if capture_key not in frame_cache:
                            frame_cache[capture_key] = capture.capture()
                        bitmap = frame_cache[capture_key]
                        if config.get("kind") == "relation":
                            relation_mode = "center" if config.get("condition") in (
                                "target_right_of_center", "target_left_of_center", "target_centered"
                            ) else "edges"
                            relation_key = (
                                capture_key,
                                str(config.get("relationBoundaryColor", "#ffffff")).lower(),
                                str(config.get("relationTargetColor", "#ff0000")).lower(),
                                int(config.get("relationTolerance", 35)),
                                float(config.get("relationEdgeMargin", 3)),
                                relation_mode,
                            )
                            if relation_key not in relation_cache:
                                relation_cache[relation_key] = evaluate_color_relation(
                                    bitmap, capture_key[2], capture_key[3], config, capture_key[0]
                                )
                            trigger_state["matched"] = relation_cache[relation_key] == config.get("condition")
                        else:
                            result = evaluate_screen_trigger(
                                bitmap, capture_key[2], capture_key[3], config, trigger_state.get("previous_bitmap")
                            )
                            trigger_state["matched"] = bool(result.get("matched"))
                            if (config.get("displayKind") or config.get("kind")) == "screen":
                                trigger_state["previous_bitmap"] = result.get("sample")
                        trigger_state["next_scan_at"] = now + max(requested_interval, safe_interval)
                    allow_next = bool(trigger_state["matched"])
                    cooldown = max(0.0, float(config.get("cooldown", 0)) / 1000.0)
                    if allow_next and cooldown and now - trigger_state["last_allowed_at"] < cooldown:
                        allow_next = False
                    if allow_next:
                        trigger_state["last_allowed_at"] = now
                    skip_next_action = not allow_next
                    continue
                if action.get("type") == "wait_until_relation":
                    config = action.get("config") if isinstance(action.get("config"), dict) else {}
                    area = config.get("area") if isinstance(config.get("area"), dict) else {}
                    capture_key = (
                        int(area.get("x", 0)), int(area.get("y", 0)),
                        min(8192, max(3, int(area.get("width", 500)))),
                        min(4320, max(3, int(area.get("height", 120)))),
                    )
                    capture = capture_cache.get(capture_key)
                    if capture is None:
                        capture = ScreenRegionCapture(*capture_key)
                        capture_cache[capture_key] = capture
                    relation_config = {
                        "relationBoundaryColor": config.get("boundaryColor", "#ffffff"),
                        "relationTargetColor": config.get("targetColor", "#00ff00"),
                        "relationTolerance": config.get("tolerance", 20),
                        "relationEdgeMargin": config.get("margin", 3),
                        "condition": config.get("condition", "target_inside"),
                    }
                    started_waiting = time.perf_counter()
                    timeout_ms = max(0, int(config.get("timeoutMs", 0)))
                    poll_seconds = min(1.0, max(0.016, float(config.get("pollMs", 33)) / 1000.0))
                    while not macro_play_stop.is_set():
                        bitmap = capture.capture()
                        relation = evaluate_color_relation(bitmap, capture_key[2], capture_key[3], relation_config, capture_key[0])
                        if relation == relation_config["condition"]:
                            break
                        if timeout_ms and (time.perf_counter() - started_waiting) * 1000.0 >= timeout_ms:
                            emit({"type": "macro_error", "message": "Wait until timed out."})
                            macro_play_stop.set()
                            break
                        macro_play_stop.wait(poll_seconds)
                    frame_cache.clear()
                    relation_cache.clear()
                    continue
                if action.get("type") == "find_color_click":
                    area = action.get("area") if isinstance(action.get("area"), dict) else {}
                    capture_key = (
                        int(area.get("x", 0)), int(area.get("y", 0)),
                        min(8192, max(3, int(area.get("width", 1920)))),
                        min(4320, max(3, int(area.get("height", 1000)))),
                    )
                    capture = capture_cache.get(capture_key)
                    if capture is None:
                        capture = ScreenRegionCapture(*capture_key)
                        capture_cache[capture_key] = capture
                    started_finding = time.perf_counter()
                    timeout_ms = max(0, int(action.get("timeoutMs", 0)))
                    poll_seconds = min(1.0, max(0.016, float(action.get("pollMs", 33)) / 1000.0))
                    located = None
                    while not macro_play_stop.is_set():
                        located = locate_color_center(
                            capture.capture(), capture_key[2], capture_key[3], action.get("color", "#ffffff"),
                            action.get("tolerance", 20), action.get("minimumPixels", 20), capture_key[0], capture_key[1]
                        )
                        if located:
                            break
                        if timeout_ms and (time.perf_counter() - started_finding) * 1000.0 >= timeout_ms:
                            emit({"type": "macro_error", "message": "Find color and click timed out."})
                            macro_play_stop.set()
                            break
                        macro_play_stop.wait(poll_seconds)
                    if located and not macro_play_stop.is_set():
                        user32.SetCursorPos(located["x"], located["y"])
                        button = action.get("button", "Left")
                        send_mouse_button_action(button, False)
                        macro_play_stop.wait(0.025)
                        send_mouse_button_action(button, True)
                    frame_cache.clear()
                    relation_cache.clear()
                    continue
                if action.get("type") == "auto_clicker_control":
                    operation = action.get("operation", "toggle")
                    if operation == "start":
                        set_running(True)
                    elif operation == "stop":
                        set_running(False)
                    else:
                        set_running(not running.is_set())
                    continue
                if action.get("type") == "wait":
                    wait_ms = max(0, float(action.get("ms", 0)))
                    if timing_variance:
                        spread = timing_variance / 100.0
                        wait_ms *= random.uniform(1.0 - spread, 1.0 + spread)
                    timeline_offset += wait_ms / 1000.0 / speed
                    remaining = timeline_started + timeline_offset - time.perf_counter()
                    if remaining > 0:
                        macro_play_stop.wait(remaining)
                    continue
                if action.get("type") == "move_path":
                    playback_hz = min(240, max(30, int(action.get("playback_hz", 90))))
                    for point in action.get("points", []):
                        if macro_play_stop.is_set() or len(point) < 3:
                            break
                        delay_ms = max(0, float(point[0]))
                        if timing_variance:
                            spread = timing_variance / 100.0
                            delay_ms *= random.uniform(1.0 - spread, 1.0 + spread)
                        duration = delay_ms / 1000.0 / speed
                        segment_started = timeline_offset
                        timeline_offset += duration
                        cursor = Point()
                        user32.GetCursorPos(ctypes.byref(cursor))
                        if action.get("relative"):
                            target_x = cursor.x + int(point[1])
                            target_y = cursor.y + int(point[2])
                        else:
                            target_x = int(point[1])
                            target_y = int(point[2])
                        frames = max(1, min(240, int(round(duration * playback_hz))))
                        for frame in range(1, frames + 1):
                            fraction = frame / frames
                            target_time = timeline_started + segment_started + duration * fraction
                            remaining = target_time - time.perf_counter()
                            if remaining > 0 and macro_play_stop.wait(remaining):
                                break
                            x = int(round(cursor.x + (target_x - cursor.x) * fraction))
                            y = int(round(cursor.y + (target_y - cursor.y) * fraction))
                            user32.SetCursorPos(x, y)
                    continue
                if action.get("type") in ("mouse_down", "mouse_up"):
                    button = action.get("button", "Left")
                    if action.get("type") == "mouse_down" and button in pressed_mouse:
                        continue
                    if action.get("type") == "mouse_up" and button not in pressed_mouse:
                        previous = actions[current_action_index - 1] if current_action_index > 0 else {}
                        previous_config = previous.get("config") if isinstance(previous.get("config"), dict) else {}
                        valid_visible_release = (
                            previous.get("type") in ("flow_trigger", "screen_trigger")
                            and previous_config.get("condition") in ("target_left", "target_left_of_center")
                        )
                        if not valid_visible_release:
                            continue
                perform_macro_action(action)
                if action.get("type") == "key_down":
                    pressed_keys.add(int(action.get("vk", 0)))
                elif action.get("type") == "key_up":
                    pressed_keys.discard(int(action.get("vk", 0)))
                elif action.get("type") == "mouse_down":
                    pressed_mouse.add(action.get("button", "Left"))
                elif action.get("type") == "mouse_up":
                    pressed_mouse.discard(action.get("button", "Left"))
            for vk in tuple(pressed_keys):
                if send_keyboard_action(vk, True):
                    emit({"type": "input_event", "device": "keyboard", "control": vk, "action": "up", "source": "macro"})
                pressed_keys.discard(vk)
            for button in tuple(pressed_mouse):
                if button not in managed_mouse_buttons:
                    if send_mouse_button_action(button, True):
                        emit({"type": "input_event", "device": "mouse", "control": button, "action": "up", "source": "macro"})
                    pressed_mouse.discard(button)
            completed_loops += 1
            if repeat_count != 0 or completed_loops == 1 or completed_loops % 5 == 0:
                emit({"type": "macro_playback_loop", "completed": completed_loops, "total": repeat_count})
            if repeat_count == 0 or completed_loops < repeat_count:
                minimum_cycle_remaining = (1.0 / 60.0) - (time.perf_counter() - control_cycle_started)
                if minimum_cycle_remaining > 0:
                    macro_play_stop.wait(minimum_cycle_remaining)
                if loop_delay_ms > 0:
                    macro_play_stop.wait(loop_delay_ms / 1000.0)
    except Exception as error:
        macro_play_stop.set()
        emit({"type": "macro_error", "message": f"Macro playback failed: {error}"})
    finally:
        release_macro_inputs(pressed_keys, pressed_mouse)
        for capture in capture_cache.values():
            capture.close()
        if restore_cursor:
            user32.SetCursorPos(origin.x, origin.y)
        macro_play_stop_on_input = False
        playing_macro.clear()
        emit({"type": "macro_playback_stopped"})


def start_macro_playback(
    repeat=False,
    repeat_count=None,
    speed=None,
    start_delay_ms=None,
    loop_delay_ms=None,
    restore_cursor=None,
    stop_on_input=None,
    timing_variance=None,
):
    global macro_play_stop_on_input, macro_ignore_physical_until, macro_play_ignored_keys
    with macro_play_start_lock:
        if recording.is_set() or playing_macro.is_set():
            return
        with macro_lock:
            actions = list(macro_actions)
        if not actions:
            emit({"type": "macro_error", "message": "There are no macro actions to play."})
            return
        if repeat_count is None:
            repeat_count = 0 if repeat else 1
        repeat_count = max(0, int(repeat_count))
        if not repeat and repeat_count == 0:
            repeat_count = 1
        if any(value is None for value in (speed, start_delay_ms, loop_delay_ms, restore_cursor, stop_on_input, timing_variance)):
            with state_lock:
                if speed is None:
                    speed = state.get("macro_playback_speed", 1.0)
                if start_delay_ms is None:
                    start_delay_ms = state.get("macro_start_delay_ms", 0)
                if loop_delay_ms is None:
                    loop_delay_ms = state.get("macro_loop_delay_ms", 0)
                if restore_cursor is None:
                    restore_cursor = state.get("macro_restore_cursor", False)
                if stop_on_input is None:
                    stop_on_input = state.get("macro_stop_on_input", False)
                if timing_variance is None:
                    timing_variance = state.get("macro_timing_variance", 0)
        speed = min(10.0, max(0.1, float(speed)))
        start_delay_ms = min(5000, max(0, int(start_delay_ms)))
        loop_delay_ms = min(60000, max(0, int(loop_delay_ms)))
        timing_variance = min(50.0, max(0.0, float(timing_variance)))
        macro_play_stop_on_input = bool(stop_on_input)
        macro_ignore_physical_until = time.monotonic() + 0.35
        with physical_keys_lock:
            macro_play_ignored_keys = set(physical_keys_down)
        macro_play_stop.clear()
        playing_macro.set()
        try:
            threading.Thread(
                target=macro_play_worker,
                args=(actions, repeat_count, speed, start_delay_ms, loop_delay_ms, bool(restore_cursor), timing_variance, True),
                daemon=True,
            ).start()
        except Exception as error:
            playing_macro.clear()
            macro_play_stop.set()
            emit({"type": "macro_error", "message": f"Could not start macro playback: {error}"})


def stop_macro_playback():
    macro_play_stop.set()


def stop_macro_on_physical_input():
    global macro_play_ignored_keys
    if not macro_play_stop_on_input or not playing_macro.is_set():
        return
    if time.monotonic() < macro_ignore_physical_until:
        return
    if macro_play_ignored_keys:
        with physical_keys_lock:
            ignored_still_down = any(key in physical_keys_down for key in macro_play_ignored_keys)
        if ignored_still_down:
            return
        macro_play_ignored_keys = set()
        return
    stop_macro_playback()


def click_once(settings):
    if settings.cursor_mode == "picked":
        user32.SetCursorPos(settings.cursor_x, settings.cursor_y)

    inputs = MOUSE_INPUT_PAIRS.get(settings.mouse_button, MOUSE_INPUT_PAIRS["Left"])
    repetitions = 2 if settings.click_type == "Double" else 1
    delivered = 0
    for index in range(repetitions):
        if int(user32.SendInput(2, inputs, ctypes.sizeof(Input))) == 2:
            delivered += 1
        if index + 1 < repetitions:
            # Configuration updates may wake click_interrupt, but they must not
            # collapse the intentional Double-click gap into an instant pair.
            gap_deadline = time.perf_counter() + 0.05
            while running.is_set():
                remaining = gap_deadline - time.perf_counter()
                if remaining <= 0:
                    break
                click_interrupt.clear()
                if not running.is_set():
                    break
                click_interrupt.wait(remaining)
            if not running.is_set():
                break
    return delivered


def next_click_deadline(previous_deadline, completed_at, period_seconds):
    """Advance one tick without replaying overdue ticks as a burst."""
    period_seconds = max(0.0, float(period_seconds))
    scheduled_deadline = previous_deadline + period_seconds
    if scheduled_deadline <= completed_at:
        return completed_at + period_seconds
    return scheduled_deadline


def click_period_seconds(settings):
    clicks_in_cycle = 2 if settings.click_type == "Double" else 1
    cps_cap = max(1, int(settings.cps_cap))
    delay_ms = max(1000.0 * clicks_in_cycle / cps_cap, settings.interval_ms)
    if settings.random_enabled:
        delay_ms += random.randint(0, max(0, settings.random_ms))
    return delay_ms / 1000.0


def click_worker():
    high_resolution_waiter = HighResolutionClickWaiter(click_interrupt)
    try:
        click_worker_loop(high_resolution_waiter)
    finally:
        high_resolution_waiter.close()


def click_worker_loop(high_resolution_waiter):
    was_running = False
    next_click = 0.0
    telemetry_started = time.perf_counter()
    telemetry_clicks = 0
    injection_failure_started = 0.0
    consecutive_injection_failures = 0
    while True:
        if not running.is_set():
            was_running = False
            next_click = 0.0
            running.wait()
            continue

        if not was_running:
            was_running = True
            next_click = time.perf_counter()
            telemetry_started = next_click
            telemetry_clicks = 0
            # set_running() wakes this worker through both events. Clear the
            # redundant interrupt so Double clicks retain their intended gap.
            click_interrupt.clear()
            if not running.is_set():
                continue

        settings = auto_click_settings_snapshot

        # Keep every down/up pair on its own clock tick. Sending several complete
        # clicks in one SendInput array makes them share effectively zero spacing;
        # Chromium may count those while games and other apps collapse or reject
        # them, causing the CPS overlay to report activity that the target never saw.
        delivered_clicks = 1 if os.environ.get("CLICK_INTERVAL_TEST") == "1" else click_once(settings)
        if delivered_clicks > 0:
            injection_failure_started = 0.0
            consecutive_injection_failures = 0
        else:
            consecutive_injection_failures += 1
            if injection_failure_started == 0.0:
                injection_failure_started = time.monotonic()
            if consecutive_injection_failures >= 3 and time.monotonic() - injection_failure_started >= 0.5:
                set_running(False)
                emit({
                    "type": "error",
                    "message": "Windows blocked simulated mouse input. Restart Click Interval as administrator, then try again.",
                })
                injection_failure_started = 0.0
                consecutive_injection_failures = 0
                continue
        telemetry_clicks += delivered_clicks
        telemetry_elapsed = time.perf_counter() - telemetry_started
        if telemetry_elapsed >= 1.0 and running.is_set():
            generated_cps = telemetry_clicks / telemetry_elapsed
            write_diagnostic(generated_cps=generated_cps, generated_clicks=telemetry_clicks, telemetry_seconds=telemetry_elapsed, active_interval_ms=settings.interval_ms)
            emit({"type": "cps", "value": round(generated_cps, 1), "clicks": telemetry_clicks, "button": settings.mouse_button})
            telemetry_started = time.perf_counter()
            telemetry_clicks = 0

        completed_at = time.perf_counter()
        next_click = next_click_deadline(
            next_click,
            completed_at,
            click_period_seconds(settings),
        )
        while running.is_set() and next_click > time.perf_counter():
            click_interrupt.clear()
            # Do not lose a configuration wakeup that raced with clear(). The
            # snapshot is replaced atomically whenever configuration changes.
            if not running.is_set():
                break
            if settings is not auto_click_settings_snapshot:
                settings = auto_click_settings_snapshot
                next_click = time.perf_counter() + click_period_seconds(settings)
                continue
            if high_resolution_waiter.wait_until(next_click):
                if not running.is_set():
                    break
                # A configuration wakeup starts a fresh period. It must not turn
                # into an extra immediate click when a slider emits rapidly.
                settings = auto_click_settings_snapshot
                next_click = time.perf_counter() + click_period_seconds(settings)


def command_worker():
    global auto_click_settings_snapshot, mouse_hotkey_ready_at, emergency_hotkey_ready_at
    for line in sys.stdin:
        try:
            command = json.loads(line)
            action = command.get("action", "configure")

            if action == "configure":
                with state_lock:
                    previous_enabled = bool(state["enabled"])
                    previous_hotkey = int(state["hotkey_vk"])
                    previous_emergency_capture = bool(state["emergency_capture_active"])
                    if "emergency_keys" not in command and (
                        "emergency_vk" in command or "emergency_modifiers" in command
                    ):
                        state["emergency_keys"] = []
                    for key in state:
                        if key in command:
                            state[key] = command[key]
                    configured_enabled = bool(state["enabled"])
                    configured_hotkey = int(state["hotkey_vk"])
                    if configured_enabled and configured_hotkey in (0x04, 0x05, 0x06) and (
                        not previous_enabled or previous_hotkey != configured_hotkey
                    ):
                        mouse_hotkey_ready_at = time.monotonic() + 0.8
                    emergency_capture = bool(state["emergency_capture_active"])
                    if emergency_capture:
                        emergency_hotkey_ready_at = float("inf")
                    elif previous_emergency_capture:
                        emergency_hotkey_ready_at = time.monotonic() + 0.8
                    next_auto_click_settings = make_auto_click_settings(state)
                    auto_timing_changed = next_auto_click_settings != auto_click_settings_snapshot
                    auto_click_settings_snapshot = next_auto_click_settings
                # Recalculate timing immediately when the interval, CPS cap, click
                # type, cursor mode, or randomization settings actually change.
                # Renderer input can repeat identical configuration many times.
                if auto_timing_changed:
                    click_interrupt.set()
                write_diagnostic(
                    last_configured_at=time.time(),
                    configured_interval_ms=state["interval_ms"],
                    configured_cps_cap=state["cps_cap"],
                    configured_click_type=state["click_type"],
                    configured_hotkey=state["hotkey_name"],
                    configured_enabled=state["enabled"],
                )
                emit({"type": "configured", "hotkey": state["hotkey_name"], "interval_ms": state["interval_ms"]})
            elif action == "start":
                set_running(True)
            elif action == "stop":
                set_running(False)
            elif action == "toggle":
                set_running(not running.is_set())
            elif action == "emergency_stop":
                emergency_stop()
            elif action == "macro_record_start":
                start_macro_recording(command.get("settings", {}))
            elif action == "macro_record_stop":
                stop_macro_recording()
            elif action == "macro_set_actions":
                with macro_lock:
                    macro_actions.clear()
                    macro_actions.extend(command.get("actions", []))
                emit({"type": "macro_actions_set", "count": len(macro_actions)})
            elif action == "macro_play":
                start_macro_playback(
                    bool(command.get("repeat", False)),
                    command.get("repeat_count"),
                    command.get("speed"),
                    command.get("start_delay_ms"),
                    command.get("loop_delay_ms"),
                    command.get("restore_cursor"),
                    command.get("stop_on_input"),
                    command.get("timing_variance"),
                )
            elif action == "macro_stop":
                stop_macro_playback()
            elif action == "pick_cursor":
                pick_cursor_pending.set()
                emit({"type": "cursor_pick_started"})
            elif action == "set_cursor":
                user32.SetCursorPos(int(command["x"]), int(command["y"]))
            elif action == "_test_physical_keys" and os.environ.get("CLICK_INTERVAL_TEST") == "1":
                with physical_keys_lock:
                    physical_keys_down.clear()
                    physical_keys_down.update(int(key) for key in command.get("keys", []))
                update_macro_control_hotkeys()
                stop_macro_on_physical_input()
            elif action == "_test_auto_hotkey_event" and os.environ.get("CLICK_INTERVAL_TEST") == "1":
                process_auto_hotkey_event(int(command.get("vk", 0)), bool(command.get("down", False)))
            elif action == "_test_inject_hotkey" and os.environ.get("CLICK_INTERVAL_TEST") == "1":
                inject_test_hotkey(int(command.get("vk", 0)))
            elif action == "_test_recorded_move" and os.environ.get("CLICK_INTERVAL_TEST") == "1":
                add_recorded_move({
                    "type": "move",
                    "x": int(command.get("x", 0)),
                    "y": int(command.get("y", 0)),
                    "relative": bool(command.get("relative", False)),
                }, time.perf_counter())
            elif action == "_test_command_barrier" and os.environ.get("CLICK_INTERVAL_TEST") == "1":
                emit({"type": "test_command_barrier", "token": str(command.get("token", ""))[:80]})
        except Exception as exc:
            emit({"type": "error", "message": str(exc)})
    os._exit(0)


def hotkey_worker():
    was_down = False
    while True:
        with state_lock:
            enabled = state["enabled"] and state.get("auto_tool_active", True)
            hotkey_vk = int(state["hotkey_vk"])

        with physical_keys_lock:
            is_down = hotkey_vk in physical_keys_down if enabled and hotkey_vk not in (0x04, 0x05, 0x06) else False
        if is_down and not was_down:
            set_running(not running.is_set())
        was_down = is_down
        time.sleep(0.012)


def emergency_hotkey_worker():
    was_down = False
    while True:
        with state_lock:
            emergency_vk = int(state["emergency_vk"])
            modifiers = int(state["emergency_modifiers"])
            configured_keys = state.get("emergency_keys")
            emergency_keys = [int(key) for key in configured_keys] if configured_keys else []
            capture_active = bool(state["emergency_capture_active"])

        if not emergency_keys:
            if modifiers & 0x02:
                emergency_keys.append(0x11)
            if modifiers & 0x04:
                emergency_keys.append(0x10)
            if modifiers & 0x01:
                emergency_keys.append(0x12)
            if modifiers & 0x08:
                emergency_keys.append(0x5B)
            emergency_keys.append(emergency_vk)
        with physical_keys_lock:
            keys_down = all(key in physical_keys_down for key in emergency_keys)
        is_down = (
            not capture_active
            and time.monotonic() >= emergency_hotkey_ready_at
            and keys_down
        )
        if is_down and not was_down:
            emergency_stop()
        was_down = is_down
        time.sleep(0.012)


def macro_trigger_worker():
    global macro_toggle_active
    was_down = False
    while True:
        with state_lock:
            enabled = bool(state.get("macro_enabled", False)) and bool(state.get("macro_tool_active", False))
            keys = [int(key) for key in state.get("macro_trigger_keys", [])]
            mode = state.get("macro_trigger_mode", "Pressed")
            capture_active = bool(state.get("macro_trigger_capture_active", False))
        with physical_keys_lock:
            is_down = bool(keys) and all(key in physical_keys_down for key in keys)
        if enabled and not capture_active and not recording.is_set():
            if mode == "Pressed" and is_down and not was_down:
                start_macro_playback(False)
            elif mode == "Hold" and is_down and not playing_macro.is_set():
                start_macro_playback(False)
            elif mode == "Toggle" and is_down and not was_down:
                macro_toggle_active = not macro_toggle_active
                if macro_toggle_active:
                    start_macro_playback(True)
                else:
                    stop_macro_playback()
        elif macro_toggle_active:
            macro_toggle_active = False
            stop_macro_playback()
        was_down = is_down
        time.sleep(0.012)


def update_macro_control_hotkeys():
    global macro_record_combo_down, macro_play_combo_down
    with state_lock:
        tool_active = bool(state.get("macro_tool_active", False))
        capture_active = bool(state.get("macro_control_capture_active", False))
        record_keys = [int(key) for key in state.get("macro_record_hotkey_keys", [])]
        play_keys = [int(key) for key in state.get("macro_play_hotkey_keys", [])]
        record_settings = dict(state.get("macro_record_settings", {}))
        repeat_mode = state.get("macro_repeat_mode", "count")
        repeat_count = max(1, int(state.get("macro_repeat_count", 3)))
        speed = float(state.get("macro_playback_speed", 1.0))
        start_delay_ms = max(0, int(state.get("macro_start_delay_ms", 0)))
        loop_delay_ms = max(0, int(state.get("macro_loop_delay_ms", 0)))
        restore_cursor = bool(state.get("macro_restore_cursor", False))
        stop_on_input = bool(state.get("macro_stop_on_input", False))
        timing_variance = max(0, float(state.get("macro_timing_variance", 0)))
    with physical_keys_lock:
        record_down = bool(record_keys) and all(key in physical_keys_down for key in record_keys)
        play_down = bool(play_keys) and all(key in physical_keys_down for key in play_keys)
    record_pressed = record_down and not macro_record_combo_down
    play_pressed = play_down and not macro_play_combo_down
    macro_record_combo_down = record_down
    macro_play_combo_down = play_down
    if not tool_active or capture_active:
        return
    if record_pressed and not playing_macro.is_set():
        if recording.is_set():
            stop_macro_recording()
        else:
            start_macro_recording(record_settings)
    if play_pressed and not recording.is_set():
        if playing_macro.is_set():
            stop_macro_playback()
        else:
            constant = repeat_mode == "constant"
            start_macro_playback(
                constant or repeat_count > 1,
                0 if constant else repeat_count,
                speed,
                start_delay_ms,
                loop_delay_ms,
                restore_cursor,
                stop_on_input,
                timing_variance,
            )


def run_mouse_hook():
    global mouse_hook_reference
    WM_LBUTTONDOWN, WM_LBUTTONUP = 0x0201, 0x0202
    WM_RBUTTONDOWN, WM_RBUTTONUP = 0x0204, 0x0205
    WM_MBUTTONDOWN, WM_MBUTTONUP = 0x0207, 0x0208
    WM_XBUTTONDOWN, WM_XBUTTONUP = 0x020B, 0x020C
    WM_MOUSEMOVE = 0x0200
    mouse_messages = (
        WM_MOUSEMOVE,
        WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
        WM_MBUTTONDOWN, WM_MBUTTONUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
    )
    mouse_down_messages = (WM_LBUTTONDOWN, WM_RBUTTONDOWN, WM_MBUTTONDOWN, WM_XBUTTONDOWN)
    user32.SetWindowsHookExW.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    user32.SetWindowsHookExW.restype = ctypes.c_void_p
    user32.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t]
    user32.CallNextHookEx.restype = ctypes.c_ssize_t
    ctypes.windll.kernel32.GetModuleHandleW.argtypes = [ctypes.c_wchar_p]
    ctypes.windll.kernel32.GetModuleHandleW.restype = ctypes.c_void_p

    def callback(code, message, data_pointer):
        global macro_record_last_mouse, macro_record_last_move_at
        if code >= 0 and message in mouse_messages:
            data = ctypes.cast(data_pointer, ctypes.POINTER(LowLevelMouseData)).contents
            is_physical_input = not bool(data.flags & 0x00000001) or os.environ.get("CLICK_INTERVAL_TEST") == "1"
            if is_physical_input and message in mouse_down_messages:
                physical_button = "Left"
                if message == WM_RBUTTONDOWN:
                    physical_button = "Right"
                elif message == WM_MBUTTONDOWN:
                    physical_button = "Middle"
                elif message == WM_XBUTTONDOWN:
                    physical_button = "MB4" if ((data.mouseData >> 16) & 0xFFFF) == 1 else "MB5"
                emit({"type": "physical_click", "button": physical_button})
            if is_physical_input and message != WM_MOUSEMOVE:
                input_button = "Left"
                if message in (WM_RBUTTONDOWN, WM_RBUTTONUP):
                    input_button = "Right"
                elif message in (WM_MBUTTONDOWN, WM_MBUTTONUP):
                    input_button = "Middle"
                elif message in (WM_XBUTTONDOWN, WM_XBUTTONUP):
                    input_button = "MB4" if ((data.mouseData >> 16) & 0xFFFF) == 1 else "MB5"
                emit({"type": "input_event", "device": "mouse", "control": input_button, "action": "down" if message in mouse_down_messages else "up", "source": "physical"})
            if is_physical_input and message in (WM_MBUTTONDOWN, WM_MBUTTONUP, WM_XBUTTONDOWN, WM_XBUTTONUP):
                if message in (WM_MBUTTONDOWN, WM_MBUTTONUP):
                    physical_vk = 0x04
                else:
                    physical_vk = 0x05 if ((data.mouseData >> 16) & 0xFFFF) == 1 else 0x06
                with physical_keys_lock:
                    if message in (WM_MBUTTONDOWN, WM_XBUTTONDOWN):
                        physical_keys_down.add(physical_vk)
                    else:
                        physical_keys_down.discard(physical_vk)
                process_auto_hotkey_event(physical_vk, message in (WM_MBUTTONDOWN, WM_XBUTTONDOWN))
                update_macro_control_hotkeys()
            if is_physical_input and recording.is_set() and os.environ.get("CLICK_INTERVAL_TEST") != "1":
                with macro_lock:
                    settings = dict(macro_record_settings)
                if message == WM_MOUSEMOVE and settings.get("mouse_movement"):
                    now = time.perf_counter()
                    quality = settings.get("quality", "balanced")
                    sample_seconds = RECORD_QUALITY.get(quality, RECORD_QUALITY["balanced"])["sample_seconds"]
                    if now - macro_record_last_move_at >= sample_seconds:
                        previous_x, previous_y = macro_record_last_mouse
                        if settings.get("position_mode") == "relative":
                            action = {"type": "move", "x": data.pt.x - previous_x, "y": data.pt.y - previous_y, "relative": True}
                        else:
                            action = {"type": "move", "x": data.pt.x, "y": data.pt.y, "relative": False}
                        if action["x"] or action["y"] or not action["relative"]:
                            add_recorded_move(action, now)
                        macro_record_last_mouse = (data.pt.x, data.pt.y)
                        macro_record_last_move_at = now
                elif settings.get("mouse_buttons") and message != WM_MOUSEMOVE:
                    button = "Left"
                    if message in (WM_RBUTTONDOWN, WM_RBUTTONUP):
                        button = "Right"
                    elif message in (WM_MBUTTONDOWN, WM_MBUTTONUP):
                        button = "Middle"
                    elif message in (WM_XBUTTONDOWN, WM_XBUTTONUP):
                        xbutton = (data.mouseData >> 16) & 0xFFFF
                        button = "MB4" if xbutton == 1 else "MB5"
                    add_recorded_action({"type": "mouse_down" if message in mouse_down_messages else "mouse_up", "button": button})
            if is_physical_input:
                stop_macro_on_physical_input()
            if message in mouse_down_messages and is_physical_input and pick_cursor_pending.is_set():
                pick_cursor_pending.clear()
                emit({"type": "cursor_picked", "x": data.pt.x, "y": data.pt.y})
                return user32.CallNextHookEx(None, code, message, data_pointer)

        return user32.CallNextHookEx(None, code, message, data_pointer)

    mouse_hook_reference = MouseHookProcedure(callback)
    module = ctypes.windll.kernel32.GetModuleHandleW(None)
    hook = user32.SetWindowsHookExW(14, ctypes.cast(mouse_hook_reference, ctypes.c_void_p), module, 0)
    if not hook:
        emit({"type": "error", "message": f"Could not install the mouse-button hotkey hook (Windows error {ctypes.windll.kernel32.GetLastError()})."})
        while True:
            time.sleep(1)

    emit({"type": "mouse_hook_ready"})
    emit({"type": "emergency_hotkey_ready", "registered": True, "dynamic": True})
    message = Message()
    try:
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
    finally:
        user32.UnhookWindowsHookEx(hook)


def run_keyboard_hook():
    global keyboard_hook_reference
    WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP = 0x0100, 0x0101, 0x0104, 0x0105
    user32.SetWindowsHookExW.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    user32.SetWindowsHookExW.restype = ctypes.c_void_p
    user32.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t]
    user32.CallNextHookEx.restype = ctypes.c_ssize_t
    ctypes.windll.kernel32.GetModuleHandleW.argtypes = [ctypes.c_wchar_p]
    ctypes.windll.kernel32.GetModuleHandleW.restype = ctypes.c_void_p

    def callback(code, message, data_pointer):
        if code >= 0 and message in (WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP):
            data = ctypes.cast(data_pointer, ctypes.POINTER(LowLevelKeyboardData)).contents
            is_physical_input = not bool(data.flags & 0x00000010) or os.environ.get("CLICK_INTERVAL_TEST") == "1"
            if is_physical_input:
                is_key_down = message in (WM_KEYDOWN, WM_SYSKEYDOWN)
                emit({"type": "input_event", "device": "keyboard", "control": int(data.vkCode), "action": "down" if is_key_down else "up", "source": "physical"})
                with physical_keys_lock:
                    if is_key_down:
                        physical_keys_down.add(int(data.vkCode))
                    else:
                        physical_keys_down.discard(int(data.vkCode))
                process_auto_hotkey_event(int(data.vkCode), is_key_down)
                update_macro_control_hotkeys()
                stop_macro_on_physical_input()
            if is_physical_input and recording.is_set() and os.environ.get("CLICK_INTERVAL_TEST") != "1":
                with macro_lock:
                    record_keyboard = bool(macro_record_settings.get("keyboard", True))
                if record_keyboard:
                    add_recorded_action({
                        "type": "key_up" if message in (WM_KEYUP, WM_SYSKEYUP) else "key_down",
                        "vk": int(data.vkCode),
                    })
        return user32.CallNextHookEx(None, code, message, data_pointer)

    keyboard_hook_reference = KeyboardHookProcedure(callback)
    module = ctypes.windll.kernel32.GetModuleHandleW(None)
    hook = user32.SetWindowsHookExW(13, ctypes.cast(keyboard_hook_reference, ctypes.c_void_p), module, 0)
    if not hook:
        emit({"type": "error", "message": f"Could not install the keyboard macro hook (Windows error {ctypes.windll.kernel32.GetLastError()})."})
        return
    message = Message()
    try:
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
    finally:
        user32.UnhookWindowsHookEx(hook)


def main():
    threading.Thread(target=emit_writer, daemon=True).start()
    threading.Thread(target=diagnostic_writer, daemon=True).start()
    threading.Thread(target=command_worker, daemon=True).start()
    threading.Thread(target=click_worker, daemon=True).start()
    threading.Thread(target=emergency_hotkey_worker, daemon=True).start()
    threading.Thread(target=macro_trigger_worker, daemon=True).start()
    threading.Thread(target=run_keyboard_hook, daemon=True).start()
    emit({"type": "ready", "wine_compatibility": WINE_RUNTIME})
    run_mouse_hook()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        raise
