import assert from "node:assert/strict";
import { registerGenerationTools } from "../dist/tools/generation.js";
import { resolveGenerationOptions } from "../dist/utils/generation-options.js";
import { test } from "node:test";

// Register the actual handlers without constructing a MeshyClient or opening a transport.
function createHarness() {
  const tools = new Map();
  const requests = [];
  registerGenerationTools(
    {
      registerTool(name, config, handler) {
        tools.set(name, { schema: config.inputSchema, handler });
      },
    },
    {
      async post(path, body) {
        requests.push({ path, body });
        return { result: "offline-task-id" };
      },
    },
  );
  return {
    requests,
    async call(name, input) {
      const { schema, handler } = tools.get(name);
      const result = await handler(schema.parse(input));
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return requests.at(-1);
    },
    async invalid(name, input) {
      const { schema, handler } = tools.get(name);
      const result = await handler(schema.parse(input));
      assert.equal(result.isError, true);
      assert.equal(requests.length, 0);
    },
  };
}

for (const endpoint of ["text", "image", "multi-image"]) {
  test(`${endpoint}: explicit Meshy 7.1 geometry`, () => {
    assert.deepEqual(
      resolveGenerationOptions(
        { ai_model: "meshy-7.1", geometry_resolution: "2k" },
        endpoint,
      ),
      {
        ai_model: "meshy-7.1",
        model_type: "standard",
        smartTopology: false,
        geometry_resolution: "2k",
        ultra_mode: undefined,
      },
    );
  });
}

test("Smart Topology selects T2 and infers the matching model type", () => {
  assert.equal(
    resolveGenerationOptions({ model_type: "smart-topology" }, "text").ai_model,
    "meshy-t2",
  );
  assert.equal(
    resolveGenerationOptions({ ai_model: "meshy-t2" }, "image").model_type,
    "smart-topology",
  );
  for (const target_polycount of [100, 15000]) {
    assert.equal(
      resolveGenerationOptions(
        { ai_model: "meshy-t2", target_polycount },
        "text",
      ).smartTopology,
      true,
    );
  }
});

for (const [label, options, endpoint, message] of [
  [
    "standard model with Smart Topology",
    { ai_model: "meshy-7.1", model_type: "smart-topology" },
    "text",
    /requires ai_model/,
  ],
  [
    "T2 with standard type",
    { ai_model: "meshy-t2", model_type: "standard" },
    "image",
    /require model_type/,
  ],
  [
    "multi-image T2",
    { ai_model: "meshy-t2" },
    "multi-image",
    /supported on text preview and single-image/,
  ],
  [
    "text T1",
    { ai_model: "meshy-t1" },
    "text",
    /supported on text preview and single-image/,
  ],
  [
    "T2 over face limit",
    { ai_model: "meshy-t2", target_polycount: 15001 },
    "text",
    /15,000/,
  ],
  [
    "text T2 quad",
    { ai_model: "meshy-t2", topology: "quad" },
    "text",
    /triangle topology/,
  ],
  [
    "multi-image 4k",
    { geometry_resolution: "4k" },
    "multi-image",
    /standard or 2k/,
  ],
  [
    "Ultra conflict",
    { ultra_mode: true, geometry_resolution: "4k" },
    "image",
    /conflicts/,
  ],
  [
    "T2 geometry",
    { ai_model: "meshy-t2", geometry_resolution: "2k" },
    "image",
    /require standard/,
  ],
  [
    "legacy model geometry",
    { ai_model: "meshy-6", geometry_resolution: "2k" },
    "text",
    /requires ai_model/,
  ],
]) {
  test(`rejects ${label}`, () =>
    assert.throws(() => resolveGenerationOptions(options, endpoint), message));
}

test("Ultra alias maps to 2k but preserves legacy single-image Meshy 7", () => {
  for (const endpoint of ["text", "image", "multi-image"]) {
    assert.equal(
      resolveGenerationOptions({ ultra_mode: true }, endpoint)
        .geometry_resolution,
      "2k",
    );
  }
  const legacy = resolveGenerationOptions(
    { ai_model: "meshy-7", ultra_mode: true },
    "image",
  );
  assert.equal(legacy.ultra_mode, true);
  assert.equal(legacy.geometry_resolution, undefined);
});

test("text preview forwards 7.1 geometry and explicit false values", async () => {
  const { call } = createHarness();
  const { path, body } = await call("meshy_text_to_3d", {
    prompt: "a robot",
    ai_model: "meshy-7.1",
    geometry_resolution: "4k",
    should_remesh: false,
    auto_size: false,
    alpha_thumbnail: false,
  });
  assert.equal(path, "/openapi/v2/text-to-3d");
  assert.equal(body.mode, "preview");
  assert.equal(body.ai_model, "meshy-7.1");
  assert.equal(body.geometry_resolution, "4k");
  assert.equal(body.should_remesh, false);
  assert.equal(body.auto_size, false);
  assert.equal(body.alpha_thumbnail, false);
});

test("text T2 forwards face target, not remesh or decimation", async () => {
  const { call } = createHarness();
  const { body } = await call("meshy_text_to_3d", {
    prompt: "a robot",
    model_type: "smart-topology",
    target_polycount: 4000,
    topology: "triangle",
    should_remesh: true,
    decimation_mode: 4,
  });
  assert.equal(body.ai_model, "meshy-t2");
  assert.equal(body.model_type, "smart-topology");
  assert.equal(body.target_polycount, 4000);
  assert.equal(body.topology, "triangle");
  assert.equal("should_remesh" in body, false);
  assert.equal("decimation_mode" in body, false);
});

test("invalid T2 request fails before posting", async () => {
  const { invalid } = createHarness();
  await invalid("meshy_text_to_3d", {
    prompt: "a robot",
    ai_model: "meshy-t2",
    target_polycount: 15001,
  });
});

for (const [tool, source] of [
  ["meshy_image_to_3d", { image_url: "https://example.invalid/input.png" }],
  [
    "meshy_multi_image_to_3d",
    { image_urls: ["https://example.invalid/input.png"] },
  ],
]) {
  for (const ai_model of ["meshy-6", "meshy-7.1", "latest"]) {
    test(`${tool}: ${ai_model} preserves enhancement false and gates lighting removal`, async () => {
      const { call } = createHarness();
      const { body } = await call(tool, {
        ...source,
        ai_model,
        image_enhancement: false,
        remove_lighting: false,
        should_texture: false,
        enable_pbr: false,
        ...(ai_model !== "meshy-6" ? { geometry_resolution: "2k" } : {}),
      });
      assert.equal(body.image_enhancement, false);
      assert.equal(body.should_texture, false);
      assert.equal(body.enable_pbr, false);
      // Single-image honors remove_lighting on meshy-6 only; multi-image also on 7.1/latest.
      const keepsLighting = ai_model === "meshy-6" || tool === "meshy_multi_image_to_3d";
      assert.equal("remove_lighting" in body, keepsLighting);
      if (keepsLighting) assert.equal(body.remove_lighting, false);
      if (ai_model !== "meshy-6") assert.equal(body.geometry_resolution, "2k");
    });
  }
  test(`${tool}: omitted lighting removal is not defaulted`, async () => {
    const { call } = createHarness();
    const { body } = await call(tool, { ...source, ai_model: "meshy-6" });
    assert.equal("remove_lighting" in body, false);
  });
}

test("image T2 omits topology, remesh, decimation, and pre-remesh controls", async () => {
  const { call } = createHarness();
  const { path, body } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image",
    ai_model: "meshy-t2",
    target_polycount: 1000,
    topology: "quad",
    should_remesh: true,
    decimation_mode: 4,
    save_pre_remeshed_model: true,
    image_enhancement: true,
    remove_lighting: true,
    should_texture: false,
  });
  assert.equal(path, "/openapi/v1/image-to-3d");
  assert.equal(body.input_task_id, "offline-image");
  assert.equal(body.model_type, "smart-topology");
  assert.equal(body.target_polycount, 1000);
  assert.equal(body.should_texture, false);
  for (const field of [
    "topology",
    "should_remesh",
    "decimation_mode",
    "save_pre_remeshed_model",
    "image_enhancement",
    "remove_lighting",
  ]) {
    assert.equal(field in body, false, field);
  }
});

test("legacy image T1 and Meshy 7 Ultra remain usable", async () => {
  const { call } = createHarness();
  const { body: t1 } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image",
    ai_model: "meshy-t1",
  });
  assert.equal(t1.ai_model, "meshy-t1");
  assert.equal(t1.model_type, "smart-topology");
  const { body: ultra } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image",
    ai_model: "meshy-7",
    ultra_mode: true,
  });
  assert.equal(ultra.ultra_mode, true);
  assert.equal("geometry_resolution" in ultra, false);
});

test("refine inherits the preview model and preserves explicit overrides", async () => {
  const { call } = createHarness();
  const { body: inherited } = await call("meshy_text_to_3d_refine", {
    preview_task_id: "offline-preview",
  });
  assert.equal(inherited.mode, "refine");
  assert.equal("ai_model" in inherited, false);
  assert.equal("remove_lighting" in inherited, false);
  for (const ai_model of [undefined, "meshy-6", "meshy-7.1", "latest"]) {
    const { body } = await call("meshy_text_to_3d_refine", {
      preview_task_id: "offline-preview",
      ai_model,
      remove_lighting: false,
    });
    assert.equal(body.ai_model, ai_model);
    assert.equal(
      "remove_lighting" in body,
      ai_model === undefined || ai_model === "meshy-6",
    );
    if ("remove_lighting" in body) assert.equal(body.remove_lighting, false);
  }
});

test("meshy-6-lite is accepted on every generation endpoint", async () => {
  const { call } = createHarness();
  const { body: text } = await call("meshy_text_to_3d", { prompt: "a robot", ai_model: "meshy-6-lite" });
  assert.equal(text.ai_model, "meshy-6-lite");
  assert.equal(text.model_type, "standard");
  const { body: image } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image",
    ai_model: "meshy-6-lite",
    texture_resolution: "2k",
    image_enhancement: false,
  });
  assert.equal(image.texture_resolution, "2k");
  assert.equal("image_enhancement" in image, false);
  const { body: multi } = await call("meshy_multi_image_to_3d", {
    image_urls: ["https://example.invalid/input.png"],
    ai_model: "meshy-6-lite",
  });
  assert.equal(multi.ai_model, "meshy-6-lite");
  const { body: refine } = await call("meshy_text_to_3d_refine", {
    preview_task_id: "offline-preview",
    ai_model: "meshy-6-lite",
  });
  assert.equal(refine.ai_model, "meshy-6-lite");
});

test("standard geometry_resolution is dropped for models that do not take it", async () => {
  const { call } = createHarness();
  const { body } = await call("meshy_text_to_3d", { prompt: "a robot", ai_model: "meshy-6", geometry_resolution: "standard" });
  assert.equal("geometry_resolution" in body, false);
  const { body: latest } = await call("meshy_text_to_3d", { prompt: "a robot", geometry_resolution: "4k" });
  assert.equal(latest.geometry_resolution, "4k");
  assert.equal(latest.ai_model, "latest");
});

test("text prompts up to 800 characters are accepted", async () => {
  const { call } = createHarness();
  const { body } = await call("meshy_text_to_3d", { prompt: "a".repeat(800) });
  assert.equal(body.prompt.length, 800);
});

test("multi-image forwards multi-view texture images on meshy-7.1", async () => {
  const { call } = createHarness();
  const texture_image_urls = ["https://example.invalid/front.png", "https://example.invalid/back.png"];
  const { body } = await call("meshy_multi_image_to_3d", {
    image_urls: ["https://example.invalid/input.png"],
    texture_image_urls,
  });
  assert.deepEqual(body.texture_image_urls, texture_image_urls);
  assert.equal(body.ai_model, "latest");
});

for (const [label, tool, input] of [
  ["4k texture on meshy-6-lite", "meshy_image_to_3d", { input_task_id: "x", ai_model: "meshy-6-lite", texture_resolution: "4k" }],
  ["hd_texture on meshy-6-lite", "meshy_multi_image_to_3d", { image_urls: ["https://example.invalid/a.png"], ai_model: "meshy-6-lite", hd_texture: true }],
  ["8k refine on meshy-6-lite", "meshy_text_to_3d_refine", { preview_task_id: "x", ai_model: "meshy-6-lite", texture_resolution: "8k" }],
  ["lowpoly on meshy-6-lite", "meshy_text_to_3d", { prompt: "a robot", ai_model: "meshy-6-lite", model_type: "lowpoly" }],
  ["multi-view texture on meshy-6", "meshy_multi_image_to_3d", { image_urls: ["https://example.invalid/a.png"], ai_model: "meshy-6", texture_image_urls: ["https://example.invalid/t.png"] }],
  ["multi-view texture with texture_prompt", "meshy_multi_image_to_3d", { image_urls: ["https://example.invalid/a.png"], texture_image_urls: ["https://example.invalid/t.png"], texture_prompt: "gold" }],
  ["multi-view texture without texturing", "meshy_multi_image_to_3d", { image_urls: ["https://example.invalid/a.png"], texture_image_urls: ["https://example.invalid/t.png"], should_texture: false }],
]) {
  test(`rejects ${label} before posting`, async () => {
    const { invalid } = createHarness();
    await invalid(tool, input);
  });
}

test("local validation errors carry no unrelated recovery hint", async () => {
  const { tools } = (() => {
    const tools = new Map();
    registerGenerationTools(
      { registerTool(name, config, handler) { tools.set(name, { schema: config.inputSchema, handler }); } },
      { async post() { throw new Error("must not post"); } },
    );
    return { tools };
  })();
  const { schema, handler } = tools.get("meshy_multi_image_to_3d");
  const result = await handler(schema.parse({
    image_urls: ["https://example.invalid/a.png"],
    ai_model: "meshy-6",
    texture_image_urls: ["https://example.invalid/t.png"],
  }));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /texture_image_urls requires/);
  assert.doesNotMatch(result.content[0].text, /file_path/);
});

test("deprecated meshy-5 is still accepted and treated as the lite model", async () => {
  const { call, invalid } = (() => {
    const tools = new Map();
    const requests = [];
    registerGenerationTools(
      { registerTool(name, config, handler) { tools.set(name, { schema: config.inputSchema, handler }); } },
      { async post(path, body) { requests.push({ path, body }); return { result: "offline-task-id" }; } },
    );
    return {
      async call(name, input) {
        const { schema, handler } = tools.get(name);
        const result = await handler(schema.parse(input));
        assert.notEqual(result.isError, true, JSON.stringify(result));
        return requests.at(-1);
      },
      async invalid(name, input) {
        const { schema, handler } = tools.get(name);
        const before = requests.length;
        const result = await handler(schema.parse(input));
        assert.equal(result.isError, true);
        assert.equal(requests.length, before);
      },
    };
  })();
  const { body } = await call("meshy_text_to_3d", { prompt: "a robot", ai_model: "meshy-5" });
  assert.equal(body.ai_model, "meshy-5");
  await invalid("meshy_image_to_3d", { input_task_id: "x", ai_model: "meshy-5", texture_resolution: "8k" });
});
