import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// A model_url may be a data: URI of up to 100 MB, so the stdio server has to
// take messages far over the SDK's 10 MB default without losing the connection.

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

test("the stdio server takes a message over 10 MB and stays connected", async () => {
  const client = new Client({ name: "test-host", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      // Port 9 is closed: nothing here may reach an API.
      env: { PATH: process.env.PATH, MESHY_API_KEY: "msy_test", MESHY_API_HOST: "http://127.0.0.1:9" },
      stderr: "ignore",
    }),
  );
  try {
    // meshy_check_balance takes no arguments, so the call is refused before
    // any request is made and only the incoming message is large.
    const big = await client
      .callTool({ name: "meshy_check_balance", arguments: { padding: "x".repeat(11 * 1024 * 1024) } })
      .catch((error) => ({ isError: true, content: [{ type: "text", text: String(error) }] }));
    assert.equal(big.isError, true);
    assert.doesNotMatch(big.content[0].text, /connection closed/i);
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === "meshy_check_balance"));
  } finally {
    await client.close();
  }
});
