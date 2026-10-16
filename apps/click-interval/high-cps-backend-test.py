"""Pure scheduler/static checks; this file never imports the Windows backend."""

import ast
import math
from pathlib import Path
import unittest


BACKEND_PATH = Path(__file__).resolve().parent / "backend.py"
BACKEND_SOURCE = BACKEND_PATH.read_text(encoding="utf-8")
BACKEND_TREE = ast.parse(BACKEND_SOURCE, filename=str(BACKEND_PATH))


def load_pure_function(name):
    node = next(
        item
        for item in BACKEND_TREE.body
        if isinstance(item, ast.FunctionDef) and item.name == name
    )
    namespace = {}
    module = ast.Module(body=[node], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(BACKEND_PATH), "exec"), namespace)
    return namespace[name]


class HighCpsBackendTest(unittest.TestCase):
    def test_deadline_advances_normally_when_on_time(self):
        next_deadline = load_pure_function("next_click_deadline")
        self.assertTrue(math.isclose(next_deadline(10.0, 10.0002, 0.001), 10.001))

    def test_missed_ticks_are_not_replayed_as_a_burst(self):
        next_deadline = load_pure_function("next_click_deadline")
        self.assertTrue(math.isclose(next_deadline(10.001, 10.050, 0.001), 10.051))

    def test_click_loop_uses_snapshot_and_rate_limited_events(self):
        worker = next(
            item for item in BACKEND_TREE.body
            if isinstance(item, ast.FunctionDef) and item.name == "click_worker"
        )
        source = ast.get_source_segment(BACKEND_SOURCE, worker)
        self.assertIn("settings = auto_click_settings_snapshot", source)
        self.assertNotIn("with state_lock", source)
        self.assertNotIn("dict(state)", source)
        self.assertNotIn("click_batch", source)
        self.assertIn("generated_event_clicks += delivered_clicks", source)
        self.assertIn("(1.0 / 30.0)", source)

    def test_snapshot_refresh_wakes_only_for_real_changes(self):
        command_worker = next(
            item for item in BACKEND_TREE.body
            if isinstance(item, ast.FunctionDef) and item.name == "command_worker"
        )
        source = ast.get_source_segment(BACKEND_SOURCE, command_worker)
        self.assertIn("next_auto_click_settings = make_auto_click_settings(state)", source)
        self.assertIn(
            "auto_timing_changed = next_auto_click_settings != auto_click_settings_snapshot",
            source,
        )
        self.assertIn("if auto_timing_changed:", source)

    def test_click_clock_uses_interruptible_high_resolution_timer(self):
        waiter = next(
            item for item in BACKEND_TREE.body
            if isinstance(item, ast.ClassDef) and item.name == "HighResolutionClickWaiter"
        )
        waiter_source = ast.get_source_segment(BACKEND_SOURCE, waiter)
        self.assertIn("CreateWaitableTimerExW", waiter_source)
        self.assertIn("CREATE_WAITABLE_TIMER_HIGH_RESOLUTION", waiter_source)
        self.assertIn("CreateWaitableTimerW", waiter_source)
        self.assertIn("WaitForMultipleObjects", waiter_source)
        self.assertIn("CancelWaitableTimer", waiter_source)
        self.assertIn("math.ceil", waiter_source)
        self.assertIn("self._interrupt.wait(remaining)", waiter_source)

        worker = next(
            item for item in BACKEND_TREE.body
            if isinstance(item, ast.FunctionDef) and item.name == "click_worker"
        )
        worker_source = ast.get_source_segment(BACKEND_SOURCE, worker)
        self.assertIn("high_resolution_waiter.wait_until(next_click)", worker_source)
        self.assertIn(
            "next_click = time.perf_counter() + click_period_seconds(settings)",
            worker_source,
        )
        self.assertIn("finally:", worker_source)
        self.assertIn("high_resolution_waiter.close()", worker_source)
        self.assertNotIn("time.sleep(", worker_source)

    def test_double_click_gap_ignores_configuration_wakes(self):
        click_once = next(
            item for item in BACKEND_TREE.body
            if isinstance(item, ast.FunctionDef) and item.name == "click_once"
        )
        source = ast.get_source_segment(BACKEND_SOURCE, click_once)
        self.assertIn("gap_deadline = time.perf_counter() + 0.05", source)
        self.assertIn("while running.is_set()", source)


if __name__ == "__main__":
    unittest.main()
