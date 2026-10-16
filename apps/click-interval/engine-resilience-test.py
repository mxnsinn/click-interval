"""Regression checks for click timing wakeups and macro start/stop races."""

import json
import importlib.util
from pathlib import Path


spec = importlib.util.spec_from_file_location("backend", Path(__file__).with_name("backend.py"))
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


source = Path(__file__).with_name("backend.py").read_text(encoding="utf-8")
assert "running.wait()" in source, "The idle click engine must block instead of polling."
assert "click_interrupt.wait(remaining)" in source, "Timed clicks must be interruptible."
assert "MOUSE_INPUT_PAIRS" in source, "Mouse input structures must be cached."

original_thread = backend.threading.Thread
original_emit = backend.emit
created_threads = []
events = []


class DeferredThread:
    def __init__(self, target, args=(), daemon=None, **_kwargs):
        self.target = target
        self.args = args
        self.daemon = daemon

    def start(self):
        created_threads.append(self)


try:
    backend.threading.Thread = DeferredThread
    backend.emit = events.append
    backend.recording.clear()
    backend.playing_macro.clear()
    backend.macro_play_stop.set()
    with backend.macro_lock:
        backend.macro_actions[:] = [{"type": "wait", "ms": 1000}]

    backend.start_macro_playback()
    backend.start_macro_playback()
    assert len(created_threads) == 1, "Rapid starts created overlapping macro workers."
    assert backend.playing_macro.is_set(), "Playback was not reserved before worker startup."

    backend.stop_macro_playback()
    assert backend.macro_play_stop.is_set()
    created_threads[0].target(*created_threads[0].args)
    assert backend.macro_play_stop.is_set(), "The worker erased an immediate Stop request."
    assert not backend.playing_macro.is_set()
finally:
    backend.threading.Thread = original_thread
    backend.emit = original_emit
    backend.playing_macro.clear()
    backend.macro_play_stop.set()

print(json.dumps({
    "passed": True,
    "macroWorkersCreated": len(created_threads),
    "immediateStopPreserved": backend.macro_play_stop.is_set(),
    "clickLoopPollingRemoved": "time.sleep(0.02)" not in source,
}))
