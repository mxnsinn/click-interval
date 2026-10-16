import importlib.util
import json
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location("backend", Path(__file__).with_name("backend.py"))
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)

virtual_x = backend.user32.GetSystemMetrics(76)
virtual_y = backend.user32.GetSystemMetrics(77)
virtual_width = max(1, backend.user32.GetSystemMetrics(78))
virtual_height = max(1, backend.user32.GetSystemMetrics(79))

width = min(1920, virtual_width)
height = min(1080, virtual_height)
capture = backend.ScreenRegionCapture(virtual_x, virtual_y, width, height)
durations = []
sample_size = 0
try:
    for _ in range(30):
        started = time.perf_counter()
        bitmap = capture.capture()
        assert bitmap is not None
        backend.color_coverage_percent(bitmap, width, height, "#ffffff", 25)
        sample_size = len(backend.sampled_screen_frame(bitmap, width, height))
        durations.append((time.perf_counter() - started) * 1000)
finally:
    capture.close()

average = sum(durations) / len(durations)
assert average < 250, average
assert sample_size <= 400000, sample_size
print(json.dumps({
    "passed": True,
    "virtualDesktop": {"x": virtual_x, "y": virtual_y, "width": virtual_width, "height": virtual_height},
    "captureSize": {"width": width, "height": height},
    "iterations": len(durations),
    "averageCaptureAndEvaluateMs": round(average, 2),
    "maximumMs": round(max(durations), 2),
    "retainedScreenChangeBytes": sample_size,
}, indent=2))
