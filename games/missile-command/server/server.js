import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readLeaderboard, submitEntry } from "./leaderboard-store.js";
import { readReplay } from "./replay-store.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const LEADERBOARD_PATH = join(ROOT_DIR, "data", "leaderboard.json");
const REPLAY_DIR = join(ROOT_DIR, "data", "replays");
const PORT = Number(process.env.PORT || 8787);
const MAX_REQUEST_BYTES = 24_000_000;
const ALLOWED_STATIC_ROOT_FILES = new Set([
  "index.html",
  "styles.css",
  "api.js",
  "audio.js",
  "balance.js",
  "effects.js",
  "entities.js",
  "game.js",
  "renderer.js",
  "replay.js",
  "ui.js",
]);
const ALLOWED_STATIC_DIRS = new Set(["public", "rl", "sim"]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function isSameOriginWriteAllowed(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;

  if (!origin || !host) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host && isLoopbackHost(originUrl.hostname);
  } catch (error) {
    return false;
  }
}

function isAllowedStaticPath(filePath) {
  const relativePath = relative(ROOT_DIR, filePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }

  const segments = relativePath.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === ".." || segment.startsWith("."))) {
    return false;
  }

  if (segments.length === 1) {
    return ALLOWED_STATIC_ROOT_FILES.has(segments[0]);
  }

  return ALLOWED_STATIC_DIRS.has(segments[0]);
}

async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    return sendJson(response, 200, readLeaderboard(LEADERBOARD_PATH));
  }

  const replayMatch =
    request.method === "GET" ? url.pathname.match(/^\/api\/replay\/([A-Za-z0-9-]+)$/) : null;
  if (replayMatch) {
    const replay = readReplay(REPLAY_DIR, replayMatch[1]);
    if (!replay) {
      return sendJson(response, 404, {
        error: "Replay not found",
      });
    }

    return sendJson(response, 200, replay);
  }

  if (request.method === "POST" && url.pathname === "/api/submit") {
    if (!isSameOriginWriteAllowed(request)) {
      return sendJson(response, 403, {
        error: "Cross-origin submissions are not allowed",
      });
    }

    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const result = submitEntry(LEADERBOARD_PATH, REPLAY_DIR, payload);
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, error?.statusCode === 413 ? 413 : 400, {
        error: error?.statusCode === 413 ? "Submission too large" : "Invalid submission payload",
      });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      port: PORT,
    });
  }

  return sendJson(response, 404, {
    error: "Not found",
  });
}

async function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(ROOT_DIR, `.${safePath}`);
  const relativePath = relative(ROOT_DIR, filePath);
  if (relativePath.startsWith("..") || !isAllowedStaticPath(filePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      return serveStatic(response, `${requestedPath.replace(/\/+$/, "")}/index.html`);
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  await serveStatic(response, url.pathname);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Orbital Shield server running on http://127.0.0.1:${PORT}`);
});
