import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from importlib import import_module

_BACKEND_IMPORT_ERROR = None
try:
    server = import_module("server")
    snake_replay = import_module("snake_replay")
except ModuleNotFoundError as exc:
    _BACKEND_IMPORT_ERROR = exc


@unittest.skipIf(
    _BACKEND_IMPORT_ERROR is not None,
    "snake60 standalone backend modules are not present in this directory; "
    "API tests require the legacy server implementation.",
)
class ServerApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.TemporaryDirectory()
        cls._orig_scores_file = server.SCORES_FILE
        cls._orig_replay_dir = server.REPLAY_DIR
        cls._orig_rate_limit_window = server.RATE_LIMIT_WINDOW_SECONDS
        cls._orig_rate_limit_max = server.RATE_LIMIT_MAX_SUBMISSIONS

        server.SCORES_FILE = f"{cls.tmpdir.name}/scores.json"
        server.REPLAY_DIR = f"{cls.tmpdir.name}/replays"
        server.RATE_LIMIT_WINDOW_SECONDS = 60
        server.RATE_LIMIT_MAX_SUBMISSIONS = 2
        with server.SUBMISSION_LOCK:
            server.SUBMISSION_EVENTS.clear()

        handler = partial(server.SnakeServerHandler, directory=cls.tmpdir.name)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.httpd.server_address[1]
        cls.origin = f"http://127.0.0.1:{cls.port}"
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()

        directions = "R" * snake_replay.MAX_REPLAY_TICKS
        cls.replay_payload = {
            "version": snake_replay.REPLAY_VERSION,
            "tickRate": snake_replay.REPLAY_TICK_RATE,
            "minStraightMoves": 0,
            "directions": directions,
        }
        assert snake_replay.normalize_replay_payload(cls.replay_payload), "Failed to build valid replay payload"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.server_thread.join(timeout=2)

        server.SCORES_FILE = cls._orig_scores_file
        server.REPLAY_DIR = cls._orig_replay_dir
        server.RATE_LIMIT_WINDOW_SECONDS = cls._orig_rate_limit_window
        server.RATE_LIMIT_MAX_SUBMISSIONS = cls._orig_rate_limit_max
        with server.SUBMISSION_LOCK:
            server.SUBMISSION_EVENTS.clear()

        cls.tmpdir.cleanup()

    def setUp(self):
        with server.SUBMISSION_LOCK:
            server.SUBMISSION_EVENTS.clear()

    def _request(self, path, method="GET", body=None, headers=None):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=body,
            method=method,
            headers=headers or {},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, res.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8")

    def _valid_submission_body(self, name="PLAYER", message="MSG"):
        payload = {
            "name": name,
            "message": message,
            "replay": self.replay_payload,
        }
        return json.dumps(payload).encode("utf-8")

    def test_get_scores_returns_json_list(self):
        status, body = self._request("/api/scores")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertIsInstance(payload, list)
        self.assertGreaterEqual(len(payload), 1)

    def test_health_endpoint_returns_ok(self):
        status, body = self._request("/api/health")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload.get("status"), "ok")

    def test_post_rejects_cross_origin(self):
        status, body = self._request(
            "/api/scores",
            method="POST",
            body=b"{}",
            headers={"Content-Type": "application/json", "Origin": "http://evil.local"},
        )
        self.assertEqual(status, 403)
        self.assertIn("Cross-origin submissions", body)

    def test_post_requires_body(self):
        status, body = self._request(
            "/api/scores",
            method="POST",
            headers={"Origin": self.origin},
        )
        self.assertEqual(status, 400)
        self.assertIn("Request body is required", body)

    def test_post_accepts_valid_replay_and_truncates_fields(self):
        status, body = self._request(
            "/api/scores",
            method="POST",
            body=self._valid_submission_body(
                name="long_player_name_12345",
                message="x" * 80,
            ),
            headers={"Content-Type": "application/json", "Origin": self.origin},
        )
        self.assertEqual(status, 200)
        payload = json.loads(body)
        entry = payload["entry"]
        self.assertEqual(len(entry["name"]), snake_replay.PLAYER_NAME_MAX_LEN)
        self.assertEqual(len(entry["message"]), snake_replay.PLAYER_MESSAGE_MAX_LEN)

    def test_post_rate_limit_returns_429(self):
        headers = {"Content-Type": "application/json", "Origin": self.origin}
        status1, _ = self._request("/api/scores", method="POST", body=self._valid_submission_body(), headers=headers)
        status2, _ = self._request("/api/scores", method="POST", body=self._valid_submission_body(), headers=headers)
        status3, body3 = self._request(
            "/api/scores",
            method="POST",
            body=self._valid_submission_body(),
            headers=headers,
        )

        self.assertEqual(status1, 200)
        self.assertEqual(status2, 200)
        self.assertEqual(status3, 429)
        payload = json.loads(body3)
        self.assertIn("retryAfterSeconds", payload)


if __name__ == "__main__":
    unittest.main()
