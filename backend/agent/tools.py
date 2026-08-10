"""Tool schemas and classification for the Solar Detections map agent."""

from __future__ import annotations

# Answered on the server, straight out of SQLite or an external lookup.
SERVER_TOOLS = frozenset(
    {
        "get_detection_stats",
        "get_coverage",
        "count_detections_in_bbox",
        "get_pending_summary",
        "list_low_confidence",
        "review_next_pending",
        "resolve_place",
        "estimate_erase_in_circle",
        "erase_in_circle",
        "confirm_detections",
        "reject_detections",
        "merge_detections",
    }
)

# Carried out by the browser so the user sees the map change.
CLIENT_TOOLS = frozenset(
    {
        "fly_to",
        "set_scan_square",
        "add_scan_squares",
        "clear_scan_squares",
        "set_scan_radius",
        "set_map_tool",
        "focus_detection",
    }
)

# Run by the browser, and the agent waits for the outcome before replying.
DEFERRED_CLIENT_TOOLS = frozenset({"scan_area", "scan_multiple_squares"})

# Stopped for an explicit yes before anything is destroyed or a long job starts.
DESTRUCTIVE_TOOLS = frozenset({"erase_in_circle", "reject_detections"})

# Above this many squares, a sweep is long enough to be worth confirming first.
MULTI_SCAN_CONFIRM_THRESHOLD = 3

_LATLNG = {
    "type": "array",
    "items": {"type": "number"},
    "description": "[latitude, longitude]",
}

TOOL_DEFINITIONS: list[dict] = [
    {
        "name": "get_detection_stats",
        "description": (
            "Totals for the whole project: pending, confirmed and rejected detection "
            "counts, km² of imagery scanned, and number of scans run."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_coverage",
        "description": "How much ground has been scanned so far, in km², and over how many scans.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "count_detections_in_bbox",
        "description": (
            "Count detections inside a bounding box, optionally filtered by review status. "
            "Use the viewport bbox from map context to answer 'how many are on screen'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "bbox": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "[west, south, east, north]. Omit to use the visible map area.",
                },
                "status": {"type": "string", "enum": ["pending", "confirmed", "rejected"]},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_pending_summary",
        "description": (
            "The strongest pending detections awaiting review, with id, confidence, "
            "area in m² and location."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 5, "minimum": 1, "maximum": 25},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "list_low_confidence",
        "description": (
            "Pending detections the model was least sure about — the likely false "
            "positives to sweep through first."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "max_confidence": {"type": "number", "default": 0.5},
                "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "review_next_pending",
        "description": (
            "Fly to and focus the highest-confidence pending detection so the user can "
            "judge it. Use this for 'show me the next one to review'."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "resolve_place",
        "description": (
            "Look up a place name and get its coordinates and bounding box. Always call "
            "this before scanning somewhere the user named — never guess coordinates."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "e.g. 'Bakersfield, CA' or 'Topaz Solar Farm'"},
            },
            "required": ["name"],
            "additionalProperties": False,
        },
    },
    {
        "name": "scan_area",
        "description": (
            "Run a real SAM 3 scan on the map: flies to the location, drops the scan "
            "square, and detects solar arrays, exactly as the Scan button does. Takes up "
            "to a couple of minutes. Omit center to scan the square already placed, or "
            "the centre of the visible map."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "center": _LATLNG,
                "radius_m": {
                    "type": "number",
                    "description": "Half the width of the square. 150-300 for rooftops, 400-800 for solar farms.",
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "scan_multiple_squares",
        "description": (
            "Scan several squares one after another, showing each on the map. Use for "
            "sweeping a neighbourhood or covering the visible area in a grid."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "squares": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "center": _LATLNG,
                            "radius_m": {"type": "number"},
                        },
                        "required": ["center"],
                    },
                },
            },
            "required": ["squares"],
            "additionalProperties": False,
        },
    },
    {
        "name": "estimate_erase_in_circle",
        "description": "Count what an erase would delete, before actually erasing. Call this first.",
        "input_schema": {
            "type": "object",
            "properties": {"center": _LATLNG, "radius_m": {"type": "number"}},
            "required": ["center", "radius_m"],
            "additionalProperties": False,
        },
    },
    {
        "name": "erase_in_circle",
        "description": "Delete every detection whose centre falls within a circle. Destructive.",
        "input_schema": {
            "type": "object",
            "properties": {"center": _LATLNG, "radius_m": {"type": "number"}},
            "required": ["center", "radius_m"],
            "additionalProperties": False,
        },
    },
    {
        "name": "confirm_detections",
        "description": "Mark detection ids as confirmed real solar arrays.",
        "input_schema": {
            "type": "object",
            "properties": {"ids": {"type": "array", "items": {"type": "integer"}}},
            "required": ["ids"],
            "additionalProperties": False,
        },
    },
    {
        "name": "reject_detections",
        "description": "Reject detection ids as false positives. Destructive.",
        "input_schema": {
            "type": "object",
            "properties": {"ids": {"type": "array", "items": {"type": "integer"}}},
            "required": ["ids"],
            "additionalProperties": False,
        },
    },
    {
        "name": "merge_detections",
        "description": (
            "Merge two or more overlapping polygons of the same physical array into one. "
            "The polygons must actually overlap."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "ids": {"type": "array", "items": {"type": "integer"}, "minItems": 2},
            },
            "required": ["ids"],
            "additionalProperties": False,
        },
    },
    {
        "name": "fly_to",
        "description": "Move the map camera to a latitude/longitude.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lat": {"type": "number"},
                "lng": {"type": "number"},
                "zoom": {"type": "number", "description": "Optional, 1-20."},
            },
            "required": ["lat", "lng"],
            "additionalProperties": False,
        },
    },
    {
        "name": "set_scan_square",
        "description": "Place a single scan square at a location, replacing any already placed.",
        "input_schema": {
            "type": "object",
            "properties": {"center": _LATLNG, "radius_m": {"type": "number"}},
            "required": ["center"],
            "additionalProperties": False,
        },
    },
    {
        "name": "add_scan_squares",
        "description": "Add scan squares to the map without scanning them yet.",
        "input_schema": {
            "type": "object",
            "properties": {
                "squares": {"type": "array", "items": _LATLNG},
            },
            "required": ["squares"],
            "additionalProperties": False,
        },
    },
    {
        "name": "clear_scan_squares",
        "description": "Remove every scan square currently placed on the map.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "set_scan_radius",
        "description": "Change the scan radius in metres (50-800).",
        "input_schema": {
            "type": "object",
            "properties": {"radius_m": {"type": "number", "minimum": 50, "maximum": 800}},
            "required": ["radius_m"],
            "additionalProperties": False,
        },
    },
    {
        "name": "set_map_tool",
        "description": "Switch the active map tool.",
        "input_schema": {
            "type": "object",
            "properties": {"tool": {"type": "string", "enum": ["single", "multi", "erase"]}},
            "required": ["tool"],
            "additionalProperties": False,
        },
    },
    {
        "name": "focus_detection",
        "description": "Select a detection and fly to it in the review queue.",
        "input_schema": {
            "type": "object",
            "properties": {"detection_id": {"type": "integer"}},
            "required": ["detection_id"],
            "additionalProperties": False,
        },
    },
]
