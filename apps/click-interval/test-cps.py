import threading
import time
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backend

clicks = 0


def fake_click(_settings):
    global clicks
    clicks += 1


def fake_batch(_settings, count):
    global clicks
    clicks += count
    return count


backend.click_once = fake_click
backend.click_batch = fake_batch
with backend.state_lock:
    backend.state["interval_ms"] = 1
    backend.state["cps_cap"] = 300

threading.Thread(target=backend.click_worker, daemon=True).start()
started = time.perf_counter()
backend.running.set()
time.sleep(1.0)
backend.running.clear()
elapsed = time.perf_counter() - started
print(f"clicks={clicks} elapsed={elapsed:.3f}s cps={clicks / elapsed:.1f}")
