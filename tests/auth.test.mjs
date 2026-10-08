import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ENG-3924: a bad or missing MESHY_API_KEY must not stop the server (MCP hosts
// restart it in a loop) and must not send a request on startup. Runs the built
// server over stdio against a local fake API that answers 401 to everything.

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function startFakeApi() {
  const requests = [];
  const api = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Invalid API key" }));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  return { requests, url: `http://127.0.0.1:${api.address().port}`, close: () => api.close() };
}

function startServer(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.resolve(message);
      pending.delete(message.id);
    }
  });
  child.stderr.resume();
  // The old server exited on a bad key; fail instead of waiting forever.
  child.on("exit", (code) => {
    for (const { reject } of pending.values()) reject(new Error(`server exited with code ${code}`));
    pending.clear();
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => {
    const id = nextId++;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  return {
    child,
    async initialize() {
      const response = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "auth-test", version: "0.0.0" },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return response;
    },
    async callTool(name, args) {
      const { result } = await request("tools/call", { name, arguments: args });
      return result;
    },
    stop() {
      child.kill();
    },
  };
}

test("invalid key: server stays up, no startup probe, one request then a cached auth error", async () => {
  const api = await startFakeApi();
  const server = startServer({ MESHY_API_KEY: "msy_invalid", MESHY_API_HOST: api.url });
  try {
    const init = await server.initialize();
    assert.ok(init.result, JSON.stringify(init));
    assert.deepEqual(api.requests, [], "no API request on startup");

    const balance = await server.callTool("meshy_check_balance", {});
    assert.equal(balance.isError, true);
    assert.match(balance.content[0].text, /rejected MESHY_API_KEY \(401\)/);
    assert.deepEqual(api.requests, ["GET /openapi/v1/balance"]);

    // Task lookup reports the auth error, not "task not found", and does not
    // walk every task endpoint with a key the API already rejected.
    const status = await server.callTool("meshy_get_task_status", { task_id: "offline-task" });
    assert.equal(status.isError, true);
    assert.match(status.content[0].text, /rejected MESHY_API_KEY \(401\)/);
    assert.equal(api.requests.length, 1);

    assert.equal(server.child.exitCode, null, "server is still running");
  } finally {
    server.stop();
    api.close();
  }
});

test("missing key: server stays up and every tool explains how to set it", async () => {
  const api = await startFakeApi();
  const server = startServer({ MESHY_API_KEY: "", MESHY_API_HOST: api.url });
  try {
    await server.initialize();
    const balance = await server.callTool("meshy_check_balance", {});
    assert.equal(balance.isError, true);
    assert.match(balance.content[0].text, /MESHY_API_KEY environment variable is required/);
    assert.deepEqual(api.requests, []);
    assert.equal(server.child.exitCode, null, "server is still running");
  } finally {
    server.stop();
    api.close();
  }
});
