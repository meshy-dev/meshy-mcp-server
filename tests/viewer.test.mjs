import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerViewerTools, VIEWER_URI, UI_MIME_TYPE, CHUNK_BYTES, MAX_KEPT_MODELS } from "../dist/tools/viewer.js";

// The viewer over a real MCP client and server in memory; the Meshy API is faked
// and task GLBs come from a local HTTP server, so nothing leaves the machine.

const UI_CAPABILITY = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [UI_MIME_TYPE] } } };

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A binary glTF header and JSON chunk, padded with a BIN chunk to `size` bytes. */
function glb(size = 1024) {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" } }).padEnd(28, " "));
  const binLength = Math.max(0, size - 12 - 8 - json.length - 8);
  const out = Buffer.alloc(12 + 8 + json.length + 8 + binLength);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20);
  const bin = 20 + json.length;
  out.writeUInt32LE(binLength, bin);
  out.writeUInt32LE(0x004e4942, bin + 4);
  for (let i = bin + 8; i < out.length; i++) out[i] = i % 251;
  return out;
}

function tempDir(prefix = "meshy-viewer-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function tempFile(name, bytes) {
  const file = path.join(tempDir(), name);
  fs.writeFileSync(file, bytes);
  return file;
}

async function connect({ tasks = {}, capabilities = UI_CAPABILITY } = {}) {
  const server = new McpServer({ name: "test", version: "0" });
  const meshy = {
    async get(apiPath) {
      const id = apiPath.split("/").pop();
      if (tasks[id]) return tasks[id];
      const error = new Error("not found");
      error.response = { status: 404 };
      throw error;
    },
  };
  registerViewerTools(server, meshy);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-host", version: "0" }, { capabilities });
  await client.connect(clientSide);
  return client;
}

async function view(client, args) {
  const result = await client.callTool({ name: "meshy_view_model", arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result;
}

async function readAll(client, model) {
  const parts = [];
  for (let chunk = 0; chunk < model.chunks; chunk++) {
    const { contents } = await client.readResource({ uri: `meshy-model://${model.id}/${chunk}` });
    parts.push(Buffer.from(contents[0].blob, "base64"));
  }
  return Buffer.concat(parts);
}

async function serve(bytes) {
  const server = http.createServer((req, res) => {
    if (req.url === "/model.glb") res.writeHead(200, { "content-type": "model/gltf-binary" }).end(bytes);
    else res.writeHead(403).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test("the view tool points at its viewer page, which is a built MCP App", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === "meshy_view_model");
  assert.equal(tool._meta.ui.resourceUri, VIEWER_URI);
  assert.equal(tool._meta["ui/resourceUri"], VIEWER_URI);
  assert.equal(tool.annotations.readOnlyHint, true);

  const { contents } = await client.readResource({ uri: VIEWER_URI });
  assert.equal(contents[0].mimeType, UI_MIME_TYPE);
  assert.match(contents[0].text, /^<!doctype html>/i);
  assert.match(contents[0].text, /<script>[\s\S]*meshy-model:\/\//);
  assert.doesNotMatch(contents[0].text, /<!-- viewer script -->/);
});

test("a local GLB comes back through the chunk resources byte for byte", async () => {
  const bytes = glb(Math.round(CHUNK_BYTES * 2.5));
  const file = tempFile("chest.glb", bytes);
  const client = await connect();
  const { model } = (await view(client, { file_path: file })).structuredContent;
  assert.equal(model.name, "chest.glb");
  assert.equal(model.file_path, file);
  assert.equal(model.bytes, bytes.length);
  assert.equal(model.chunks, 3);
  assert.ok((await readAll(client, model)).equals(bytes));
});

test("opening the same file again reuses the kept copy; a changed file is read again", async () => {
  const file = tempFile("same.glb", glb(2048));
  const client = await connect();
  const first = (await view(client, { file_path: file })).structuredContent.model;
  const again = (await view(client, { file_path: file })).structuredContent.model;
  assert.equal(again.id, first.id);

  fs.writeFileSync(file, glb(4096));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  const changed = (await view(client, { file_path: file })).structuredContent.model;
  assert.notEqual(changed.id, first.id);
  assert.equal(changed.bytes, 4096);
});

test(`only the ${MAX_KEPT_MODELS} most recent models stay open`, async () => {
  const client = await connect();
  const models = [];
  for (let i = 0; i <= MAX_KEPT_MODELS; i++) {
    models.push((await view(client, { file_path: tempFile(`m${i}.glb`, glb(1024 + i * 4)) })).structuredContent.model);
  }
  await assert.rejects(client.readResource({ uri: `meshy-model://${models[0].id}/0` }), /no longer open/);
  await client.readResource({ uri: `meshy-model://${models.at(-1).id}/0` });
});

test("a task's GLB is fetched by the server; a rigging task shows the rigged character", async () => {
  const bytes = glb(4096);
  const assets = await serve(bytes);
  try {
    const client = await connect({
      tasks: {
        "rig-1": {
          id: "rig-1",
          type: "rigging",
          status: "SUCCEEDED",
          result: { rigged_character_glb_url: `${assets.url}/model.glb` },
        },
      },
    });
    const result = await view(client, { task_id: "rig-1", task_type: "rigging" });
    const { model } = result.structuredContent;
    assert.equal(model.task_id, "rig-1");
    assert.equal(model.task_type, "rigging");
    assert.match(result.content[0].text, /Nothing was saved/);
    assert.ok((await readAll(client, model)).equals(bytes));
  } finally {
    assets.close();
  }
});

test("an expired task file is reported as such, not as an API key problem", async () => {
  const assets = await serve(glb());
  try {
    const client = await connect({
      tasks: { old: { id: "old", type: "image-to-3d", status: "SUCCEEDED", model_urls: { glb: `${assets.url}/expired.glb` } } },
    });
    const result = await client.callTool({ name: "meshy_view_model", arguments: { task_id: "old" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /no longer available \(HTTP 403\).*3 days.*file_path/);
  } finally {
    assets.close();
  }
});

test("the view tool refuses what it cannot show", async () => {
  const client = await connect({
    tasks: {
      running: { id: "running", type: "image-to-3d", status: "IN_PROGRESS" },
      fbxonly: { id: "fbxonly", type: "image-to-3d", status: "SUCCEEDED", model_urls: { fbx: "https://example.invalid/m.fbx" } },
    },
  });
  const refuse = async (args, pattern) => {
    const result = await client.callTool({ name: "meshy_view_model", arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(result.content[0].text, pattern);
  };
  const file = tempFile("model.glb", glb());
  await refuse({}, /exactly one of task_id or file_path/);
  await refuse({ task_id: "running", file_path: file }, /exactly one/);
  await refuse({ file_path: "model.glb" }, /must be absolute/);
  await refuse({ file_path: path.join(os.tmpdir(), "no-such-model.glb") }, /File not found/);
  await refuse({ file_path: tempDir() }, /Not a file/);
  await refuse({ file_path: tempFile("notes.txt", Buffer.from("not a model at all")) }, /not a binary glTF/);
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    const locked = tempDir("meshy-locked-");
    fs.writeFileSync(path.join(locked, "model.glb"), glb());
    fs.chmodSync(locked, 0o000);
    try {
      await refuse({ file_path: path.join(locked, "model.glb") }, /Cannot read .*\(EACCES\).*protected folder/);
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  }
  await refuse({ task_id: "running" }, /IN_PROGRESS, not finished/);
  await refuse({ task_id: "fbxonly" }, /no GLB to show \(formats: fbx\)/);
});

test("over HTTP the view tool refuses file_path", async () => {
  const file = tempFile("model.glb", glb());
  const client = await connect();
  process.env.TRANSPORT = "http";
  try {
    const result = await client.callTool({ name: "meshy_view_model", arguments: { file_path: file } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /file_path works only when the server runs locally/);
  } finally {
    delete process.env.TRANSPORT;
  }
});

test("a client that does not report MCP Apps support gets no viewer and nothing is loaded", async () => {
  const file = tempFile("model.glb", glb());
  const client = await connect({ capabilities: {} });
  const result = await view(client, { file_path: file });
  assert.equal(result.structuredContent, undefined);
  assert.match(result.content[0].text, /did not report support for MCP Apps.*nothing was loaded/);
});

test("a chunk of an unknown model or past the end is an error", async () => {
  const client = await connect();
  await assert.rejects(client.readResource({ uri: "meshy-model://nope/0" }), /no longer open/);
  const { model } = (await view(client, { file_path: tempFile("model.glb", glb()) })).structuredContent;
  await assert.rejects(client.readResource({ uri: `meshy-model://${model.id}/1` }), /out of range/);
});

test("the stdio server takes a message over 10 MB and stays connected", async () => {
  const client = new Client({ name: "test-host", version: "0" }, { capabilities: UI_CAPABILITY });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env: { PATH: process.env.PATH, MESHY_API_KEY: "msy_test", MESHY_API_HOST: "http://127.0.0.1:9" },
      stderr: "ignore",
    }),
  );
  try {
    // An unknown task_type is dropped, not echoed, so only the request is large.
    const big = await client.callTool({ name: "meshy_view_model", arguments: { task_type: "x".repeat(11 * 1024 * 1024) } });
    assert.equal(big.isError, true);
    assert.match(big.content[0].text, /exactly one of task_id or file_path/);
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "meshy_view_model"));
  } finally {
    await client.close();
  }
});
