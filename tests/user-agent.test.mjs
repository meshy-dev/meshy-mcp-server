import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseHost, userAgent } from "../dist/utils/user-agent.js";
import { createMeshyClient } from "../dist/services/meshy-client.js";

// The User-Agent names the MCP host in a trailing comment. meshyd attributes
// traffic by the leading product token, so that must never change.

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const BASE = `meshy-mcp-server/${PKG.version}`;
const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const HERMES = { name: "hermes-agent", version: "0.22.2" };

test("leading token is meshy-mcp-server/<package version>", () => {
  assert.equal(BASE, "meshy-mcp-server/0.6.6");
  for (const ua of [
    userAgent(),
    userAgent(HERMES),
    userAgent(parseHost("hermes-meshy-plugin/0.4.0"), HERMES),
    userAgent({ name: "a (b); c\r\nX-Injected: 1", version: "1)" }),
  ]) {
    assert.equal(ua.split(" ")[0], BASE, ua);
  }
});

test("no host known: exactly the product token", () => {
  assert.equal(userAgent(), BASE);
  assert.equal(userAgent(undefined, undefined), BASE);
  assert.equal(userAgent(parseHost(undefined), undefined), BASE);
  assert.equal(userAgent(parseHost(""), undefined), BASE);
  assert.equal(userAgent(parseHost("   "), undefined), BASE);
});

test("clientInfo only", () => {
  assert.equal(userAgent(undefined, HERMES), `${BASE} (hermes-agent/0.22.2)`);
  assert.equal(userAgent(undefined, { name: "mcp", version: "0.1.0" }), `${BASE} (mcp/0.1.0)`);
  assert.equal(userAgent(undefined, { name: "claude-code" }), `${BASE} (claude-code)`);
  assert.equal(userAgent(undefined, { name: "claude-code", version: "" }), `${BASE} (claude-code)`);
});

test("MESHY_CLIENT only: name[/version]", () => {
  assert.equal(userAgent(parseHost("hermes-meshy-plugin/0.4.0")), `${BASE} (hermes-meshy-plugin/0.4.0)`);
  assert.equal(userAgent(parseHost("hermes-meshy-plugin")), `${BASE} (hermes-meshy-plugin)`);
  assert.equal(userAgent(parseHost(" hermes-meshy-plugin/0.4.0 ")), `${BASE} (hermes-meshy-plugin/0.4.0)`);
  assert.equal(userAgent(parseHost("hermes-meshy-plugin/")), `${BASE} (hermes-meshy-plugin)`);
  assert.deepEqual(parseHost("a/b/c"), { name: "a", version: "b/c" });
});

test("MESHY_CLIENT wins over clientInfo; an unusable one falls back to clientInfo", () => {
  assert.equal(userAgent(parseHost("hermes-meshy-plugin/0.4.0"), HERMES), `${BASE} (hermes-meshy-plugin/0.4.0)`);
  assert.equal(userAgent(parseHost("hermes-meshy-plugin"), HERMES), `${BASE} (hermes-meshy-plugin)`);
  assert.equal(userAgent(parseHost("();"), HERMES), `${BASE} (hermes-agent/0.22.2)`);
  assert.equal(userAgent(parseHost("/1.0"), HERMES), `${BASE} (hermes-agent/0.22.2)`);
});

test("sanitizes: only [A-Za-z0-9._-], name max 64, version max 32", () => {
  assert.equal(userAgent({ name: "Claude Code", version: "1.0 beta" }), `${BASE} (ClaudeCode/1.0beta)`);
  assert.equal(userAgent({ name: "evil\r\nX-Injected: 1", version: "1\n" }), `${BASE} (evilX-Injected1/1)`);
  assert.equal(userAgent({ name: "a(b)c;d", version: "(1);2" }), `${BASE} (abcd/12)`);
  assert.equal(userAgent({ name: "ünïcødé", version: "1.0+build.5" }), `${BASE} (ncd/1.0build.5)`);
  assert.equal(userAgent({ name: "x".repeat(100), version: "9".repeat(50) }), `${BASE} (${"x".repeat(64)}/${"9".repeat(32)})`);
  assert.equal(userAgent({ name: "();\r\n", version: "1.0" }), BASE, "empty name: no comment");
  assert.equal(userAgent({ name: "ok", version: "();" }), `${BASE} (ok)`, "empty version: name only");
  assert.equal(userAgent({ name: 42, version: {} }), BASE, "non-string fields are ignored");
  for (const ua of [
    userAgent({ name: "a\r\nb", version: "c\nd" }),
    userAgent(parseHost("x(y);z\r\n/1;2)")),
  ]) {
    assert.match(ua, /^meshy-mcp-server\/[0-9A-Za-z.-]+( \([A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?\))?$/, ua);
  }
});

async function startFakeApi() {
  const requests = [];
  const api = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, userAgent: req.headers["user-agent"] });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ balance: 123 }));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  return { requests, url: `http://127.0.0.1:${api.address().port}`, close: () => api.close() };
}

test("the client computes the User-Agent per request, so a host known after startup is sent", async () => {
  const api = await startFakeApi();
  const saved = { key: process.env.MESHY_API_KEY, client: process.env.MESHY_CLIENT };
  try {
    process.env.MESHY_API_KEY = "msy_test";
    delete process.env.MESHY_CLIENT;
    let clientInfo;
    const client = createMeshyClient(() => clientInfo);
    await client.get(`${api.url}/openapi/v1/balance`);
    clientInfo = HERMES;
    await client.get(`${api.url}/openapi/v1/balance`);

    process.env.MESHY_CLIENT = "hermes-meshy-plugin/0.4.0";
    await createMeshyClient(() => HERMES).get(`${api.url}/openapi/v1/balance`);
    await createMeshyClient().get(`${api.url}/openapi/v1/balance`);

    assert.deepEqual(api.requests.map((r) => r.userAgent), [
      BASE,
      `${BASE} (hermes-agent/0.22.2)`,
      `${BASE} (hermes-meshy-plugin/0.4.0)`,
      `${BASE} (hermes-meshy-plugin/0.4.0)`,
    ]);
  } finally {
    for (const [name, value] of [["MESHY_API_KEY", saved.key], ["MESHY_CLIENT", saved.client]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    api.close();
  }
});

function startStdioServer(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MESHY_CLIENT: "", ...env },
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
    async initialize(clientInfo) {
      const response = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return response;
    },
    callTool: async (name, args) => (await request("tools/call", { name, arguments: args })).result,
    stop: () => child.kill(),
  };
}

test("stdio: the handshake clientInfo is sent, and MESHY_CLIENT wins over it", async () => {
  const api = await startFakeApi();
  try {
    for (const [env, expected] of [
      [{}, `${BASE} (hermes-agent/0.22.2)`],
      [{ MESHY_CLIENT: "hermes-meshy-plugin/0.4.0" }, `${BASE} (hermes-meshy-plugin/0.4.0)`],
    ]) {
      const server = startStdioServer({ MESHY_API_KEY: "msy_dummy", MESHY_API_HOST: api.url, ...env });
      try {
        assert.ok((await server.initialize(HERMES)).result);
        const balance = await server.callTool("meshy_check_balance", {});
        assert.notEqual(balance.isError, true, JSON.stringify(balance));
        assert.equal(api.requests.at(-1).userAgent, expected);
      } finally {
        server.stop();
      }
    }
  } finally {
    api.close();
  }
});

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  probe.close();
  await once(probe, "close");
  return port;
}

async function startHttpServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MESHY_CLIENT: "", TRANSPORT: "http", PORT: String(port), ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (log += chunk));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) break;
    } catch {
      if (i > 100 || child.exitCode !== null) throw new Error(`HTTP server did not start:\n${log}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  let nextId = 1;
  const post = async (body) => {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    });
    return res.status === 202 ? undefined : res.json();
  };
  return {
    request: (method, params) => post({ jsonrpc: "2.0", id: nextId++, method, params }),
    notify: (method) => post({ jsonrpc: "2.0", method }),
    stop: () => child.kill(),
  };
}

test("HTTP: clientInfo is not used (one server serves every caller); MESHY_CLIENT still is", async () => {
  const api = await startFakeApi();
  try {
    for (const [env, expected] of [
      [{}, BASE],
      [{ MESHY_CLIENT: "hermes-meshy-plugin/0.4.0" }, `${BASE} (hermes-meshy-plugin/0.4.0)`],
    ]) {
      const server = await startHttpServer({ MESHY_API_KEY: "msy_dummy", MESHY_API_HOST: api.url, ...env });
      try {
        const init = await server.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: HERMES });
        assert.ok(init.result, JSON.stringify(init));
        await server.notify("notifications/initialized");
        const call = await server.request("tools/call", { name: "meshy_check_balance", arguments: {} });
        assert.notEqual(call.result?.isError, true, JSON.stringify(call));
        assert.equal(api.requests.at(-1).userAgent, expected);
      } finally {
        server.stop();
      }
    }
  } finally {
    api.close();
  }
});
