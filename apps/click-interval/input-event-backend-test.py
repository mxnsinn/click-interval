import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backend

events = []


class FakeUser32:
    def SendInput(self, count, _inputs, _size):
        return count


backend.user32 = FakeUser32()
backend.emit = events.append
backend.perform_macro_action({"type": "mouse_down", "button": "Left"})
backend.perform_macro_action({"type": "mouse_up", "button": "Left"})
backend.perform_macro_action({"type": "key_down", "vk": 65})
backend.perform_macro_action({"type": "key_up", "vk": 65})

expected = [
    ("mouse", "Left", "down"),
    ("mouse", "Left", "up"),
    ("keyboard", 65, "down"),
    ("keyboard", 65, "up"),
]
actual = [(event["device"], event["control"], event["action"]) for event in events]
if actual != expected or any(event.get("source") != "macro" for event in events):
    raise AssertionError({"expected": expected, "actual": actual, "events": events})
print({"passed": True, "events": len(events)})
