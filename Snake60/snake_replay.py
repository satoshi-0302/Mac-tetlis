import json
import os
import secrets
import time

LEGACY_RULE_VERSION = "snake60-rule-v1"
CURRENT_RULE_VERSION = "snake60-rule-v2"
LEGACY_REPLAY_VERSION = "snake60-replay-v1"
REPLAY_VERSION = "snake60-replay-v2"
REPLAY_TICK_RATE = 60
MAX_REPLAY_TICKS = 60 * 60
REPLAY_TICK_MS = 1000.0 / REPLAY_TICK_RATE
INITIAL_SPEED = 120.0
SPEED_INC = 2.0
START_TIME = 60
MIN_STRAIGHT_MOVES = 4
GRID_SIZE = 20
TILE_COUNT_X = 800 // GRID_SIZE
TILE_COUNT_Y = 600 // GRID_SIZE
INITIAL_SNAKE = [
    {"x": 10, "y": 10},
    {"x": 9, "y": 10},
    {"x": 8, "y": 10},
    {"x": 7, "y": 10},
    {"x": 6, "y": 10},
    {"x": 5, "y": 10},
]
VALID_DIRECTION_CODES = {"U", "D", "L", "R"}
DIR_TO_VECTOR = {
    "U": (0, -1),
    "D": (0, 1),
    "L": (-1, 0),
    "R": (1, 0),
}


def sanitize_text(value, max_length, uppercase=False):
    text = str(value or "")
    text = "".join(ch for ch in text if ch.isprintable())
    text = text.strip()[:max_length]
    return text.upper() if uppercase else text


def normalize_entry(item, index=0):
    replay_id = sanitize_replay_id(item.get("replayId", "")) if isinstance(item, dict) else ""
    created_at = ""
    rule_version = LEGACY_RULE_VERSION
    if isinstance(item, dict):
        created_at = str(item.get("createdAt", "")).strip()
        rule_version = str(item.get("ruleVersion", LEGACY_RULE_VERSION)).strip() or LEGACY_RULE_VERSION

    return {
        "id": (
            sanitize_replay_id(item.get("id", "")) if isinstance(item, dict) else ""
        )
        or generate_replay_id(index),
        "name": sanitize_text(item.get("name", "ANON"), 5, uppercase=True) if isinstance(item, dict) else "ANON",
        "score": clamp_int(item.get("score", 0) if isinstance(item, dict) else 0, 0, 999999),
        "message": sanitize_text(item.get("message", "") if isinstance(item, dict) else "", 30),
        "createdAt": created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "replayId": replay_id,
        "replayAvailable": bool(isinstance(item, dict) and item.get("replayAvailable") and replay_id),
        "ruleVersion": rule_version,
    }


def sort_entries(entries):
    entries.sort(key=lambda item: (-item["score"], item["createdAt"], item["name"]))


def generate_replay_id(index=0):
    return f"{int(time.time() * 1000)}-{index}-{secrets.token_hex(4)}"


def sanitize_replay_id(value):
    replay_id = str(value or "").strip()
    if not replay_id:
        return ""
    allowed = all(ch.isalnum() or ch == "-" for ch in replay_id)
    return replay_id if allowed and 8 <= len(replay_id) <= 80 else ""


def clamp_int(value, min_value, max_value):
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = min_value
    return max(min_value, min(max_value, numeric))


def _u32(value):
    return value & 0xFFFFFFFF


def _imul(left, right):
    return ((left & 0xFFFFFFFF) * (right & 0xFFFFFFFF)) & 0xFFFFFFFF


def seeded_random(seed):
    seed = _u32(seed + 0x6D2B79F5)
    value = seed
    value = _u32(_imul(value ^ (value >> 15), value | 1))
    value = _u32(value ^ _u32(value + _imul(value ^ (value >> 7), value | 61)))
    return seed, _u32(value ^ (value >> 14)) / 4294967296.0


def make_initial_state(min_straight_moves=MIN_STRAIGHT_MOVES):
    state = {
        "snake": [{"x": part["x"], "y": part["y"]} for part in INITIAL_SNAKE],
        "velocity": {"x": 1, "y": 0},
        "last_input": {"x": 1, "y": 0},
        "apples": [],
        "score": 0,
        "speed": INITIAL_SPEED,
        "time_left": START_TIME,
        "game_seed": 12345,
        "move_accumulator": 0.0,
        "frame_count": 0,
        "min_straight_moves": max(0, int(min_straight_moves)),
        "straight_moves_since_turn": 0,
        "game_over": False,
        "end_reason": "",
    }
    place_apples(state)
    return state


def place_apples(state):
    target_apple_count = 5 + (state["score"] // 10)

    while len(state["apples"]) < target_apple_count:
        valid = False
        while not valid:
            state["game_seed"], rand_x = seeded_random(state["game_seed"])
            state["game_seed"], rand_y = seeded_random(state["game_seed"])
            new_apple = {
                "x": int(rand_x * TILE_COUNT_X),
                "y": int(rand_y * TILE_COUNT_Y),
            }
            valid = True
            for segment in state["snake"]:
                if segment["x"] == new_apple["x"] and segment["y"] == new_apple["y"]:
                    valid = False
                    break
            if not valid:
                continue
            for apple in state["apples"]:
                if apple["x"] == new_apple["x"] and apple["y"] == new_apple["y"]:
                    valid = False
                    break
        state["apples"].append(new_apple)


def apply_direction_code(state, code):
    vector = DIR_TO_VECTOR.get(code)
    if not vector:
        return

    next_x, next_y = vector
    if state["last_input"]["x"] == -next_x and state["last_input"]["y"] == -next_y:
        return

    current_x = state["velocity"]["x"]
    current_y = state["velocity"]["y"]
    same_direction = current_x == next_x and current_y == next_y
    if not same_direction and state.get("straight_moves_since_turn", 0) < state.get("min_straight_moves", 0):
        return

    state["velocity"] = {"x": next_x, "y": next_y}
    if not same_direction:
        state["straight_moves_since_turn"] = 0


def update_logic(state):
    state["last_input"] = {
        "x": state["velocity"]["x"],
        "y": state["velocity"]["y"],
    }

    new_head = {
        "x": state["snake"][0]["x"] + state["velocity"]["x"],
        "y": state["snake"][0]["y"] + state["velocity"]["y"],
    }

    if new_head["x"] < 0:
        new_head["x"] = TILE_COUNT_X - 1
    if new_head["x"] >= TILE_COUNT_X:
        new_head["x"] = 0
    if new_head["y"] < 0:
        new_head["y"] = TILE_COUNT_Y - 1
    if new_head["y"] >= TILE_COUNT_Y:
        new_head["y"] = 0

    for segment in state["snake"]:
        if segment["x"] == new_head["x"] and segment["y"] == new_head["y"]:
            state["game_over"] = True
            state["end_reason"] = "collision"
            return

    state["snake"].insert(0, new_head)

    ate_apple = False
    for index, apple in enumerate(state["apples"]):
        if apple["x"] == new_head["x"] and apple["y"] == new_head["y"]:
            ate_apple = True
            state["score"] += 10
            state["speed"] = max(30.0, state["speed"] - SPEED_INC)
            del state["apples"][index]
            break

    if ate_apple:
        place_apples(state)
    else:
        state["snake"].pop()

    state["straight_moves_since_turn"] = state.get("straight_moves_since_turn", 0) + 1


def simulate_replay(directions, min_straight_moves=MIN_STRAIGHT_MOVES):
    state = make_initial_state(min_straight_moves=min_straight_moves)

    for code in directions:
        apply_direction_code(state, code)

        state["frame_count"] += 1
        if state["frame_count"] % REPLAY_TICK_RATE == 0:
            state["time_left"] -= 1
            if state["time_left"] <= 0:
                state["time_left"] = 0
                state["game_over"] = True
                state["end_reason"] = "timeout"

        if not state["game_over"]:
            state["move_accumulator"] += REPLAY_TICK_MS
            if state["move_accumulator"] >= state["speed"]:
                update_logic(state)
                state["move_accumulator"] = 0.0

        if state["game_over"]:
            break

    if not state["game_over"]:
        return None

    return {
        "score": state["score"],
        "timeLeft": state["time_left"],
        "durationTicks": len(directions),
        "endReason": state["end_reason"],
    }


def normalize_replay_payload(payload):
    if not isinstance(payload, dict):
        return None

    version = str(payload.get("version", "")).strip()
    tick_rate = clamp_int(payload.get("tickRate", 0), 0, REPLAY_TICK_RATE)
    directions = str(payload.get("directions", "")).strip().upper()
    if version == LEGACY_REPLAY_VERSION:
        min_straight_moves = 0
    else:
        min_straight_moves = clamp_int(payload.get("minStraightMoves", MIN_STRAIGHT_MOVES), 0, MIN_STRAIGHT_MOVES)

    if version not in {LEGACY_REPLAY_VERSION, REPLAY_VERSION} or tick_rate != REPLAY_TICK_RATE:
        return None
    if not directions or len(directions) > MAX_REPLAY_TICKS:
        return None
    if any(code not in VALID_DIRECTION_CODES for code in directions):
        return None

    summary = simulate_replay(directions, min_straight_moves=min_straight_moves)
    if not summary:
        return None

    return {
        "version": REPLAY_VERSION if version == REPLAY_VERSION else LEGACY_REPLAY_VERSION,
        "tickRate": REPLAY_TICK_RATE,
        "minStraightMoves": min_straight_moves,
        "durationTicks": len(directions),
        "directions": directions,
        "summary": summary,
    }


def read_replay(replay_dir, replay_id):
    safe_replay_id = sanitize_replay_id(replay_id)
    if not safe_replay_id:
        return None

    replay_path = os.path.join(replay_dir, f"{safe_replay_id}.json")
    if not os.path.exists(replay_path):
        return None

    try:
        with open(replay_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError, TypeError):
        return None

    return normalize_replay_payload(payload)


def write_replay(replay_dir, replay_id, replay_payload):
    os.makedirs(replay_dir, exist_ok=True)
    replay_path = os.path.join(replay_dir, f"{replay_id}.json")
    with open(replay_path, "w", encoding="utf-8") as handle:
        json.dump(replay_payload, handle, indent=2)
    return True


def prune_replays(replay_dir, retained_ids):
    os.makedirs(replay_dir, exist_ok=True)
    retained = {sanitize_replay_id(item) for item in retained_ids if sanitize_replay_id(item)}
    for file_name in os.listdir(replay_dir):
        if not file_name.endswith(".json"):
            continue
        replay_id = file_name[:-5]
        if replay_id in retained:
            continue
        try:
            os.remove(os.path.join(replay_dir, file_name))
        except OSError:
            continue
