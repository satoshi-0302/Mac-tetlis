import json
import os
import re
import sys
import time
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

from snake_replay import (
    CURRENT_RULE_VERSION,
    generate_replay_id,
    normalize_entry,
    normalize_replay_payload,
    prune_replays,
    read_replay,
    sanitize_replay_id,
    sanitize_text,
    sort_entries,
    write_replay,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8080"))
SCORES_FILE = os.path.join(BASE_DIR, "scores.json")
REPLAY_DIR = os.path.join(BASE_DIR, "replays")
MAX_BODY_BYTES = 16_384
ALLOWED_STATIC_PATHS = {
    "/",
    "/index.html",
    "/style.css",
    "/game.js",
    "/audio.js",
}
REPLAY_ROUTE = re.compile(r"^/api/replays/([A-Za-z0-9-]{8,80})$")

DUMMY_SCORES = [
    {"name": "SNAKE", "score": 220, "message": "LOCKED TURNS", "ruleVersion": CURRENT_RULE_VERSION},
    {"name": "CRASH", "score": 180, "message": "SYSTEM OVERRIDE", "ruleVersion": CURRENT_RULE_VERSION},
    {"name": "NEO", "score": 150, "message": "FOLLOW THE GRID", "ruleVersion": CURRENT_RULE_VERSION},
]


def ensure_storage():
    os.makedirs(REPLAY_DIR, exist_ok=True)
    if not os.path.exists(SCORES_FILE):
        initial_entries = [normalize_entry(item, index) for index, item in enumerate(DUMMY_SCORES)]
        sort_entries(initial_entries)
        with open(SCORES_FILE, "w", encoding="utf-8") as handle:
            json.dump(initial_entries[:10], handle, indent=2, ensure_ascii=False)


def load_all_scores():
    ensure_storage()

    try:
        with open(SCORES_FILE, "r", encoding="utf-8") as handle:
            parsed = json.load(handle)
    except (OSError, ValueError, TypeError):
        parsed = DUMMY_SCORES

    if not isinstance(parsed, list):
        parsed = DUMMY_SCORES

    entries = [normalize_entry(item, index) for index, item in enumerate(parsed[:10])]
    for entry in entries:
        replay_id = sanitize_replay_id(entry.get("replayId", ""))
        replay_path = os.path.join(REPLAY_DIR, f"{replay_id}.json") if replay_id else ""
        entry["replayAvailable"] = bool(replay_id and os.path.exists(replay_path))
    sort_entries(entries)
    return entries


def load_scores():
    current_entries = [entry for entry in load_all_scores() if entry.get("ruleVersion") == CURRENT_RULE_VERSION]
    sort_entries(current_entries)
    return current_entries[:10]


def save_scores(current_entries, legacy_entries=None):
    ensure_storage()
    legacy_entries = legacy_entries or []
    normalized_current = [normalize_entry(item, index) for index, item in enumerate(current_entries[:10])]
    normalized_legacy = [
        normalize_entry(item, index + len(normalized_current))
        for index, item in enumerate(legacy_entries)
    ]
    sort_entries(normalized_current)
    combined = normalized_current[:10] + normalized_legacy
    with open(SCORES_FILE, "w", encoding="utf-8") as handle:
        json.dump(combined, handle, indent=2, ensure_ascii=False)
    return normalized_current[:10]


def send_json(handler, status_code, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def is_loopback_host(hostname):
    return hostname in {"127.0.0.1", "localhost", "::1"}


def parse_host_header(host):
    try:
        return urlparse(f"//{host}").hostname
    except ValueError:
        return None


def is_same_origin_write_allowed(headers):
    origin = headers.get("Origin")
    host = headers.get("Host")
    if not host:
        return False

    if not origin:
        return is_loopback_host(parse_host_header(host))

    try:
        parsed = urlparse(origin)
    except ValueError:
        return False

    return parsed.scheme in {"http", "https"} and parsed.netloc == host


def submit_score(payload):
    replay = normalize_replay_payload(payload.get("replay"))
    if not replay:
        raise ValueError("Replay is required")

    all_entries = load_all_scores()
    current_entries = [entry for entry in all_entries if entry.get("ruleVersion") == CURRENT_RULE_VERSION]
    legacy_entries = [entry for entry in all_entries if entry.get("ruleVersion") != CURRENT_RULE_VERSION]
    entry = normalize_entry(
        {
            "id": generate_replay_id(len(current_entries) + len(legacy_entries) + 1),
            "name": sanitize_text(payload.get("name", "ANON"), 5, uppercase=True) or "ANON",
            "score": replay["summary"]["score"],
            "message": sanitize_text(payload.get("message", ""), 30),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "replayId": "",
            "replayAvailable": False,
            "ruleVersion": CURRENT_RULE_VERSION,
        },
        len(current_entries) + len(legacy_entries) + 1,
    )
    entry["replayId"] = entry["id"]

    current_entries.append(entry)
    sort_entries(current_entries)
    current_entries = current_entries[:10]

    kept_in_top10 = any(item["id"] == entry["id"] for item in current_entries)
    if kept_in_top10:
        write_replay(REPLAY_DIR, entry["replayId"], replay)
        for item in current_entries:
            if item["id"] == entry["id"]:
                item["replayAvailable"] = True
                break

    prune_replays(
        REPLAY_DIR,
        [
            item["replayId"]
            for item in (current_entries + legacy_entries)
            if item.get("replayAvailable") and item.get("replayId")
        ],
    )
    saved_entries = save_scores(current_entries, legacy_entries)
    return {
        "scores": saved_entries,
        "entry": next((item for item in saved_entries if item["id"] == entry["id"]), entry),
        "keptInTop10": kept_in_top10,
        "verifiedScore": replay["summary"]["score"],
    }


class SnakeServerHandler(SimpleHTTPRequestHandler):
    def _is_allowed_static_path(self, path):
        return path in ALLOWED_STATIC_PATHS

    def end_headers(self):
        parsed_path = urlparse(self.path).path
        if not parsed_path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'",
        )
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_GET(self):
        parsed_path = urlparse(self.path)

        if parsed_path.path == "/api/scores":
            send_json(self, 200, load_scores())
            return

        replay_match = REPLAY_ROUTE.match(parsed_path.path)
        if replay_match:
            replay = read_replay(REPLAY_DIR, replay_match.group(1))
            if not replay:
                send_json(self, 404, {"error": "Replay not found"})
                return
            send_json(self, 200, replay)
            return

        if not self._is_allowed_static_path(parsed_path.path):
            self.send_response(404)
            self.end_headers()
            return

        return super().do_GET()

    def do_HEAD(self):
        parsed_path = urlparse(self.path)

        if parsed_path.path.startswith("/api/"):
            self.send_response(404)
            self.end_headers()
            return

        if not self._is_allowed_static_path(parsed_path.path):
            self.send_response(404)
            self.end_headers()
            return

        return super().do_HEAD()

    def do_POST(self):
        parsed_path = urlparse(self.path)

        if parsed_path.path != "/api/scores":
            self.send_response(404)
            self.end_headers()
            return

        if not is_same_origin_write_allowed(self.headers):
            send_json(self, 403, {"error": "Cross-origin submissions are not allowed"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            send_json(self, 400, {"error": "Request body is required"})
            return
        if content_length > MAX_BODY_BYTES:
            send_json(self, 413, {"error": "Submission too large"})
            return

        try:
            post_data = self.rfile.read(content_length)
            payload = json.loads(post_data.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Payload must be a JSON object")
            send_json(self, 200, submit_score(payload))
        except Exception as error:
            print(f"Error processing POST: {error.__class__.__name__}")
            send_json(self, 400, {"error": "Invalid score payload"})


if __name__ == "__main__":
    ensure_storage()

    server_address = (HOST, PORT)
    handler = partial(SnakeServerHandler, directory=BASE_DIR)
    httpd = HTTPServer(server_address, handler)
    print(f"WebSnake API Server running on http://{HOST}:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        sys.exit(0)
