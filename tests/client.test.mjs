import assert from "node:assert/strict";
import { test } from "node:test";
import { AxiosError } from "axios";
import { retryDelayMs, handleMeshyError } from "../dist/services/error-handler.js";
import { getTaskWithAutoInference, pollTask } from "../dist/services/meshy-client.js";
import { describeTaskError } from "../dist/utils/response-formatter.js";

// Offline checks for the retry policy, task lookup, error messages and polling.

function httpError(method, status, message, headers = {}) {
  const config = { method, headers: {} };
  return new AxiosError(message, undefined, config, {}, { status, data: { message }, headers, config, statusText: "" });
}

function networkError(method, code) {
  return new AxiosError("network", code, { method, headers: {} });
}

test("a create is never resent after a timeout, network error or 5xx", () => {
  for (const error of [
    networkError("post", "ECONNABORTED"),
    networkError("post", "ECONNRESET"),
    httpError("post", 500, "boom"),
    httpError("post", 503, "boom"),
  ]) {
    assert.equal(retryDelayMs("post", error, 0), undefined);
  }
});

test("a create retries only the request limiter's 429, honoring Retry-After", () => {
  assert.equal(retryDelayMs("post", httpError("post", 429, "Rate limit exceeded"), 0), 2000);
  assert.equal(retryDelayMs("post", httpError("post", 429, "Rate limit exceeded", { "retry-after": "3" }), 0), 3000);
  for (const message of [
    "NoMorePendingTasks: Upgrade your plan to queue up more tasks.",
    "NoMoreConcurrentTasks: You credit is insufficient to queue up more tasks.",
    "Free rig quota exhausted",
  ]) {
    assert.equal(retryDelayMs("post", httpError("post", 429, message), 0), undefined, message);
  }
});

test("reads and deletes retry transient failures, then give up", () => {
  assert.equal(retryDelayMs("get", networkError("get", "ECONNABORTED"), 0), 2000);
  assert.equal(retryDelayMs("get", httpError("get", 502, "bad gateway"), 1), 4000);
  assert.equal(retryDelayMs("delete", httpError("delete", 429, "Rate limit exceeded", { "retry-after": "1" }), 2), 1000);
  assert.equal(retryDelayMs("get", httpError("get", 429, "x", { "retry-after": "120" }), 0), undefined);
  assert.equal(retryDelayMs("get", httpError("get", 503, "x"), 3), undefined);
  assert.equal(retryDelayMs("get", httpError("get", 404, "Task not found"), 0), undefined);
});

test("ambiguous create failures tell the agent to check before resending", () => {
  assert.match(handleMeshyError(networkError("post", "ECONNABORTED")), /may still have created/);
  assert.match(handleMeshyError(httpError("post", 502, "x")), /meshy_list_tasks/);
  assert.doesNotMatch(handleMeshyError(networkError("post", "ENOTFOUND")), /may still have created/);
  assert.doesNotMatch(handleMeshyError(networkError("get", "ECONNABORTED")), /may still have created/);
  assert.match(handleMeshyError(httpError("post", 429, "NoMorePendingTasks: Upgrade your plan")), /queue is full.*NoMorePendingTasks/);
});

function fakeClient(routes) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      const task = routes[path];
      if (!task) throw httpError("get", 404, "Task not found");
      return task;
    },
  };
}

test("a task found on a route that answers for every type is re-read from its own route", async () => {
  const rig = { id: "t", type: "rig", status: "SUCCEEDED", result: { rigged_character_glb_url: "u" } };
  const client = fakeClient({
    "/openapi/v2/text-to-3d/t": { id: "t", type: "rig", status: "SUCCEEDED" },
    "/openapi/v1/image-to-3d/t": { id: "t", type: "rig", status: "SUCCEEDED" },
    "/openapi/v1/rigging/t": rig,
  });
  // Omitted type: the first probe is image-to-3d, then the task's own route.
  const found = await getTaskWithAutoInference(client, "t");
  assert.equal(found.taskType, "rigging");
  assert.equal(found.endpoint, "/openapi/v1/rigging");
  assert.deepEqual(found.task, rig);
  assert.deepEqual(client.calls, ["/openapi/v1/image-to-3d/t", "/openapi/v1/rigging/t"]);
  // A wrong type that still answers (text-to-3d) is corrected the same way.
  const wrong = await getTaskWithAutoInference(client, "t", "text-to-3d");
  assert.equal(wrong.taskType, "rigging");
  assert.deepEqual(wrong.task, rig);
});

test("a task only its own route serves is still found, and real errors are not swallowed", async () => {
  const build = { id: "c", type: "creative-lab-lamp-build", status: "SUCCEEDED" };
  const client = fakeClient({ "/openapi/creative-lab/lamp/v1/build/c": build });
  const found = await getTaskWithAutoInference(client, "c");
  assert.equal(found.taskType, "creative-lab-lamp-build");
  assert.equal(client.calls.at(-1), "/openapi/creative-lab/lamp/v1/build/c");
  assert.equal(client.calls.at(-2) === "/openapi/v2/text-to-3d/c", false, "text-to-3d is probed last");

  await assert.rejects(getTaskWithAutoInference(fakeClient({}), "missing"), /not found on any endpoint/);
  const failing = { async get() { throw httpError("get", 503, "down"); } };
  await assert.rejects(getTaskWithAutoInference(failing, "x"), (e) => e.response?.status === 503);
});

test("402, 409 and task errors carry the server's message and the next step", () => {
  const broke = handleMeshyError(httpError("post", 402, "Insufficient funds"));
  assert.match(broke, /Insufficient funds\. Check the balance with `meshy_check_balance`\. Upgrade your plan for more monthly credits, or buy a credit pack: https:\/\/www\.meshy\.ai\/settings\/subscription\?utm_source=meshy-mcp-server&utm_medium=insufficient_credits$/);
  // An API message with its own link gets no second one.
  const linked = handleMeshyError(httpError("post", 402, "Insufficient funds. Upgrade your plan at https://www.meshy.ai/settings/subscription to continue using the API."));
  assert.equal(linked.match(/https:\/\//g).length, 1);
  assert.match(linked, /continue using the API\. Check the balance with `meshy_check_balance`\.$/);
  const busy = "Task is IN_PROGRESS and cannot be deleted. Credits for a task the worker has already started are not refundable";
  assert.match(handleMeshyError(httpError("delete", 409, busy)), /Conflict \(409\)\. Task is IN_PROGRESS.*not refundable\. A running task cannot be stopped.*confirm_delete/);
  assert.equal(
    describeTaskError({ type: "invalid_input", code: "image_too_complex", message: "Too complex.", doc_url: "https://docs.meshy.ai/x" }),
    "[invalid_input/image_too_complex] Too complex. (guide: https://docs.meshy.ai/x)",
  );
  assert.equal(describeTaskError({ type: "server_error", message: "Retry." }), "[server_error] Retry.");
});

test("a failed status check is retried at the next poll, at the API's suggested interval", async () => {
  const states = [
    httpError("get", 503, "down"),
    { data: { id: "t", type: "remesh", status: "IN_PROGRESS", progress: 50 }, retryAfterMs: 2000 },
    networkError("get", "ECONNABORTED"),
    { data: { id: "t", type: "remesh", status: "SUCCEEDED", progress: 100 } },
  ];
  const client = {
    async get(path) {
      assert.equal(path, "/openapi/v1/remesh/t");
      return { id: "t", type: "remesh", status: "PENDING", progress: 0 };
    },
    async getWithRetryAfter() {
      const next = states.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
  const waits = [];
  const seen = [];
  const result = await pollTask(client, "t", "remesh", 600000, (task) => seen.push(task.status), async (ms) => waits.push(ms));
  assert.equal(result.task.status, "SUCCEEDED");
  assert.equal(result.taskType, "remesh");
  assert.deepEqual(seen, ["PENDING", "IN_PROGRESS", "SUCCEEDED"]);
  // Backoff, backoff after the 503, the API's 2s hint, then backoff after the timeout.
  assert.deepEqual(waits, [5000, 7500, 2000, 11250]);
});

test("polling stops at the wait budget without failing the task, and stops on real errors", async () => {
  const pending = { id: "t", type: "remesh", status: "PENDING" };
  const slow = { async get() { return pending; }, async getWithRetryAfter() { throw httpError("get", 429, "Rate limit exceeded"); } };
  const result = await pollTask(slow, "t", "remesh", 6000, undefined, async () => {});
  assert.equal(result.task.status, "PENDING");
  assert.equal(result.lastError.response.status, 429);

  const gone = { async get() { return pending; }, async getWithRetryAfter() { throw httpError("get", 404, "Task not found"); } };
  await assert.rejects(pollTask(gone, "t", "remesh", 600000, undefined, async () => {}), (e) => e.response?.status === 404);
});
