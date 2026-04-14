import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

import { createChatStore } from "./src/chatStore.js";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const PRESENCE_MAX_IDLE_MS = 30_000;
const PRESENCE_SWEEP_MS = 10_000;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const store = createChatStore({
  idGenerator: () => randomUUID(),
  clock: () => Date.now(),
});
const streams = new Map();

function getPathname(url) {
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  return normalizedPath || "/";
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
    });

    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function resolvePath(urlPath) {
  const normalizedPath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = normalizedPath === "/" ? "/index.html" : normalizedPath;
  return join(ROOT, requestedPath);
}

function writeEvent(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(lastEvent = null) {
  const payload = {
    type: "state",
    roomName: "Global Room",
    snapshot: store.getSnapshot(),
    lastEvent,
  };

  for (const stream of streams.values()) {
    writeEvent(stream, payload);
  }
}

function serveStatic(request, response) {
  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || `${HOST}:${PORT}`}`,
  );
  const targetPath = resolvePath(url.pathname);

  if (!existsSync(targetPath) || statSync(targetPath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = extname(targetPath);
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": contentType });
  createReadStream(targetPath).pipe(response);
}

function cleanupInactiveSessions() {
  const timedOutEvents = store.removeInactiveSessions(PRESENCE_MAX_IDLE_MS);

  if (timedOutEvents.length > 0) {
    broadcast(timedOutEvents[timedOutEvents.length - 1]);
  }
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL." });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const pathname = getPathname(url);

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/join") {
    try {
      const { name } = await readBody(request);
      const { session, event } = store.join(name);
      sendJson(response, 200, {
        roomName: "Global Room",
        session,
        snapshot: store.getSnapshot(),
      });
      broadcast(event);
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Please enter a display name." });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/messages") {
    try {
      const { sessionId, text } = await readBody(request);
      const event = store.addMessage(sessionId, text);
      sendJson(response, 200, { ok: true });
      broadcast(event);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/ping") {
    try {
      const { sessionId } = await readBody(request);
      store.touchSession(sessionId);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/leave") {
    try {
      const { sessionId } = await readBody(request);
      const event = store.leave(sessionId);
      streams.get(sessionId)?.end();
      streams.delete(sessionId);
      sendJson(response, 200, { ok: true });

      if (event) {
        broadcast(event);
      }
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/events") {
    const sessionId = url.searchParams.get("sessionId") || "";

    if (!store.hasSession(sessionId)) {
      sendJson(response, 401, { error: "Session expired. Please join again." });
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    response.write("\n");

    streams.set(sessionId, response);
    store.touchSession(sessionId);
    writeEvent(response, {
      type: "state",
      roomName: "Global Room",
      snapshot: store.getSnapshot(),
      lastEvent: null,
    });

    request.on("close", () => {
      streams.delete(sessionId);
    });
    return;
  }

  serveStatic(request, response);
});

setInterval(cleanupInactiveSessions, PRESENCE_SWEEP_MS);

server.listen(PORT, HOST, () => {
  const accessHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`World chat running at http://${accessHost}:${PORT}`);
});
