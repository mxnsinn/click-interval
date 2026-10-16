import importlib.util
import json
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location("backend", Path(__file__).with_name("backend.py"))
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


def solid_frame(width, height, color=(0, 0, 0, 255)):
    return bytearray(color * (width * height))


def paint(bitmap, width, left, top, right, bottom, color):
    for y in range(top, bottom):
        for x in range(left, right):
            offset = (y * width + x) * 4
            bitmap[offset:offset + 4] = bytes(color)


red = (0, 0, 255, 255)
coverage_frame = solid_frame(100, 20)
paint(coverage_frame, 100, 0, 0, 25, 20, red)
coverage = backend.color_coverage_percent(coverage_frame, 100, 20, "#ff0000", 5)
assert 24.5 <= coverage <= 25.5, coverage

bar_frame = solid_frame(120, 16)
paint(bar_frame, 120, 8, 2, 56, 14, red)
paint(bar_frame, 120, 105, 3, 110, 13, red)
bar_fill = backend.bar_fill_percent(bar_frame, 120, 16, "#ff0000", 5)
assert 39 <= bar_fill <= 41, bar_fill

vertical_bar = solid_frame(14, 100)
paint(vertical_bar, 14, 2, 30, 12, 100, red)
vertical_fill = backend.bar_fill_percent(vertical_bar, 14, 100, "#ff0000", 5)
assert 69 <= vertical_fill <= 71, vertical_fill

unchanged = backend.screen_change_percent(coverage_frame, bytes(coverage_frame), 100, 20)
changed_frame = bytearray(coverage_frame)
paint(changed_frame, 100, 50, 0, 100, 20, (255, 255, 255, 255))
changed = backend.screen_change_percent(changed_frame, bytes(coverage_frame), 100, 20)
assert unchanged == 0
assert changed > 45

checks = {
    "presenceAbove": backend.evaluate_screen_trigger(coverage_frame, 100, 20, {
        "kind": "visual", "color": "#ff0000", "colorTolerance": 5, "colorCoverage": 20, "condition": "above"
    })["matched"],
    "presenceBelow": backend.evaluate_screen_trigger(coverage_frame, 100, 20, {
        "kind": "visual", "color": "#ff0000", "colorTolerance": 5, "colorCoverage": 30, "condition": "below"
    })["matched"],
    "barAbove": backend.evaluate_screen_trigger(bar_frame, 120, 16, {
        "kind": "visual", "displayKind": "bar", "color": "#ff0000", "colorTolerance": 5,
        "colorCoverage": 35, "condition": "above"
    })["matched"],
    "screenChanged": backend.evaluate_screen_trigger(changed_frame, 100, 20, {
        "kind": "screen", "changeThreshold": 10, "condition": "changes"
    }, bytes(coverage_frame))["matched"],
}
assert all(checks.values()), checks
assert not backend.evaluate_screen_trigger(coverage_frame, 100, 20, {
    "kind": "screen", "changeThreshold": 10, "condition": "still"
})["matched"]


class FakeCapture:
    frames = []
    index = 0

    def __init__(self, _x, _y, width, height):
        self.width = width
        self.height = height

    def capture(self):
        frame = self.frames[min(self.index, len(self.frames) - 1)]
        self.index += 1
        return frame

    def close(self):
        pass


original_capture = backend.ScreenRegionCapture
original_perform = backend.perform_macro_action
original_emit = backend.emit
original_send_keyboard = backend.send_keyboard_action
played = []
backend.ScreenRegionCapture = FakeCapture
backend.perform_macro_action = lambda action: played.append(action.get("tag"))
backend.emit = lambda _event: None
backend.send_keyboard_action = lambda _vk, _up: None

try:
    FakeCapture.frames = [coverage_frame]
    FakeCapture.index = 0
    actions = [
        {"type": "screen_trigger", "config": {"id": "pass", "kind": "visual", "color": "#ff0000", "colorTolerance": 5, "colorCoverage": 20, "condition": "above", "areaMode": "custom", "area": {"x": 0, "y": 0, "width": 100, "height": 20}, "scanInterval": 16}},
        {"type": "move", "x": 1, "y": 1, "tag": "allowed"},
        {"type": "screen_trigger", "config": {"id": "block", "kind": "visual", "color": "#00ff00", "colorTolerance": 5, "colorCoverage": 20, "condition": "above", "areaMode": "custom", "area": {"x": 0, "y": 0, "width": 100, "height": 20}, "scanInterval": 16}},
        {"type": "move", "x": 2, "y": 2, "tag": "blocked"},
        {"type": "move", "x": 3, "y": 3, "tag": "after"},
    ]
    backend.macro_play_worker(actions, 1, 1.0, 0, 0, False, 0)
    assert played == ["allowed", "after"], played
    played.clear()
    FakeCapture.frames = [coverage_frame]
    FakeCapture.index = 0
    backend.macro_play_worker([
        {"type": "screen_trigger", "config": {"id": "cooldown", "kind": "visual", "color": "#ff0000", "colorTolerance": 5, "colorCoverage": 20, "condition": "above", "cooldown": 100, "areaMode": "custom", "area": {"x": 0, "y": 0, "width": 100, "height": 20}, "scanInterval": 16}},
        {"type": "move", "x": 1, "y": 1, "tag": "rate-limited"},
    ], 5, 1.0, 0, 0, False, 0)
    assert played == ["rate-limited"], played
finally:
    backend.ScreenRegionCapture = original_capture
    backend.perform_macro_action = original_perform
    backend.emit = original_emit
    backend.send_keyboard_action = original_send_keyboard

stress_frame = solid_frame(1920, 1080)
paint(stress_frame, 1920, 0, 0, 960, 1080, red)
started = time.perf_counter()
stress_results = [backend.color_coverage_percent(stress_frame, 1920, 1080, "#ff0000", 5) for _ in range(8)]
stress_elapsed = time.perf_counter() - started
assert all(49 <= value <= 51 for value in stress_results)
assert stress_elapsed < 8.0, stress_elapsed

print(json.dumps({
    "passed": True,
    "coveragePercent": round(coverage, 2),
    "barFillPercent": round(bar_fill, 2),
    "verticalBarFillPercent": round(vertical_fill, 2),
    "screenChangePercent": round(changed, 2),
    "cooldownPlayback": played,
    "fullHdEvaluations": len(stress_results),
    "stressElapsedMs": round(stress_elapsed * 1000, 2),
}, indent=2))
