import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("backend", Path(__file__).with_name("backend.py"))
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


def frame(width, height, boundary_left, boundary_right, target_x, include_target=True):
    pixels = bytearray(width * height * 4)
    for y in range(8, height - 8):
        for x in range(boundary_left, boundary_right + 1):
            offset = (y * width + x) * 4
            pixels[offset:offset + 4] = bytes((255, 255, 255, 255))
    if include_target:
        for y in range(3, height - 3):
            offset = (y * width + target_x) * 4
            pixels[offset:offset + 4] = bytes((0, 0, 255, 255))
    return pixels


configuration = {
    "relationBoundaryColor": "#ffffff",
    "relationTargetColor": "#ff0000",
    "relationTolerance": 20,
    "relationEdgeMargin": 3,
}
relations = {
    "right": backend.evaluate_color_relation(frame(220, 50, 40, 100, 145), 220, 50, configuration),
    "left": backend.evaluate_color_relation(frame(220, 50, 80, 150, 35), 220, 50, configuration),
    "inside": backend.evaluate_color_relation(frame(220, 50, 60, 150, 105), 220, 50, configuration),
    "missing": backend.evaluate_color_relation(frame(220, 50, 60, 150, 105, False), 220, 50, configuration),
}
assert relations == {
    "right": "target_right",
    "left": "target_left",
    "inside": "target_inside",
    "missing": "tracking_lost",
}


def noisy_thin_frame():
    width, height = 220, 100
    pixels = bytearray(width * height * 4)
    for y in range(18, 58):
        for x in range(20, 190):
            offset = (y * width + x) * 4
            pixels[offset:offset + 4] = bytes((241, 241, 241, 255))
    for y in range(88, 94):
        for x in range(35, 82):
            offset = (y * width + x) * 4
            pixels[offset:offset + 4] = bytes((255, 255, 255, 255))
    for y in range(55, 94):
        for x in range(132, 136):
            offset = (y * width + x) * 4
            pixels[offset:offset + 4] = bytes((91, 75, 67, 255))
    return pixels, width, height


stress_bitmap, stress_width, stress_height = noisy_thin_frame()
stress_configuration = {
    "relationBoundaryColor": "#ffffff",
    "relationTargetColor": "#434b5b",
    "relationTolerance": 5,
    "relationEdgeMargin": 3,
}
stress_relation = backend.evaluate_color_relation(
    stress_bitmap, stress_width, stress_height, stress_configuration
)
assert stress_relation == "target_right"
center_right_configuration = {**configuration, "condition": "target_right_of_center", "relationEdgeMargin": 4}
center_left_configuration = {**configuration, "condition": "target_left_of_center", "relationEdgeMargin": 4}
center_relations = {
    "right": backend.evaluate_color_relation(frame(220, 50, 40, 100, 85), 220, 50, center_right_configuration),
    "left": backend.evaluate_color_relation(frame(220, 50, 80, 150, 95), 220, 50, center_left_configuration),
}
assert center_relations == {"right": "target_right_of_center", "left": "target_left_of_center"}
located = backend.locate_color_center(stress_bitmap, stress_width, stress_height, "#434b5b", 5, 20, 10, 20)
assert located and 142 <= located["x"] <= 145 and 92 <= located["y"] <= 95
print(json.dumps({"passed": True, "relations": relations, "centerRelations": center_relations, "noisyThinBar": stress_relation, "locatedTarget": located}))
