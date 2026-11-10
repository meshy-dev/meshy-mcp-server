// The app side of MCP Apps (SEP-1865, protocol 2026-01-26): JSON-RPC over
// postMessage with the host. Only what the viewer needs: the handshake, the
// tool input and result, reading server resources, size reports and teardown.

const PROTOCOL_VERSION = "2026-01-26";

export function createBridge(appInfo) {
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  const send = (message) => window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;

    if (message.method === undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || "Host error"));
      else waiter.resolve(message.result);
      return;
    }

    const handler = listeners.get(message.method);
    if (message.id === undefined) {
      handler?.(message.params ?? {});
      return;
    }
    // Requests from the host (teardown, ping): answer every one, unknown methods included.
    if (!handler) {
      send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
      return;
    }
    new Promise((resolve) => resolve(handler(message.params ?? {})))
      .then((result) => send({ id: message.id, result: result ?? {} }))
      .catch((error) => send({ id: message.id, error: { code: -32000, message: String(error?.message || error) } }));
  });

  function request(method, params, timeoutMs = 60000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      send({ id, method, params });
    });
  }

  const notify = (method, params) => send({ method, params });

  return {
    /** Handle a host notification or request, e.g. "ui/notifications/tool-result". */
    on(method, handler) {
      listeners.set(method, handler);
    },
    async connect() {
      const result = await request("ui/initialize", {
        appInfo,
        appCapabilities: {},
        protocolVersion: PROTOCOL_VERSION,
      });
      notify("ui/notifications/initialized", {});
      return result;
    },
    readResource(uri) {
      return request("resources/read", { uri }, 120000);
    },
    log(level, data) {
      notify("notifications/message", { level, data });
    },
    /** Report the page height whenever it changes, as hosts size the frame from it. */
    reportSize() {
      let last = 0;
      const report = () => {
        const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
        if (height && height !== last) {
          last = height;
          notify("ui/notifications/size-changed", { height });
        }
      };
      new ResizeObserver(report).observe(document.documentElement);
      report();
    },
  };
}
