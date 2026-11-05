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

test("T2.5 runs on text and image Smart Topology up to 30,000 faces", () => {
  for (const endpoint of ["text", "image"]) {
    for (const options of [
      { ai_model: "meshy-t2.5", model_type: "smart-topology", target_polycount: 30000 },
      { ai_model: "meshy-t2.5", target_polycount: 100 },
    ]) {
      const resolved = resolveGenerationOptions(options, endpoint);
      assert.equal(resolved.ai_model, "meshy-t2.5");
      assert.equal(resolved.model_type, "smart-topology");
      assert.equal(resolved.smartTopology, true);
    }
  }
});

for (const [label, options, endpoint, message] of [
  [
    "T2 at the T2.5 face limit",
    { ai_model: "meshy-t2", target_polycount: 30000 },
    "image",
    /15,000/,
  ],
  [
    "T2.5 over face limit",
    { ai_model: "meshy-t2.5", target_polycount: 30001 },
    "text",
    /30,000/,
  ],
  [
    "T2.5 with standard type",
    { ai_model: "meshy-t2.5", model_type: "standard" },
    "text",
    /require model_type/,
  ],
  [
    "multi-image T2.5",
    { ai_model: "meshy-t2.5" },
    "multi-image",
    /supported on text preview and single-image/,
  ],
  [
    "text T2.5 quad",
    { ai_model: "meshy-t2.5", topology: "quad" },
    "text",
    /triangle topology/,
  ],
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

test("T2.5 request carries the model and its face target", async () => {
  const { call } = createHarness();
  const { body: text } = await call("meshy_text_to_3d", {
    prompt: "a robot",
    model_type: "smart-topology",
    ai_model: "meshy-t2.5",
    target_polycount: 30000,
  });
  assert.equal(text.ai_model, "meshy-t2.5");
  assert.equal(text.model_type, "smart-topology");
  assert.equal(text.target_polycount, 30000);
  const { path, body: image } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image",
    model_type: "smart-topology",
    ai_model: "meshy-t2.5",
    target_polycount: 20000,
    texture_resolution: "8k",
  });
  assert.equal(path, "/openapi/v1/image-to-3d");
  assert.equal(image.ai_model, "meshy-t2.5");
  assert.equal(image.model_type, "smart-topology");
  assert.equal(image.target_polycount, 20000);
  assert.equal(image.texture_resolution, "8k");
});

test("T2.5 is advertised on text and image only, and is not a refine override", () => {
  const tools = new Map();
  registerGenerationTools(
    { registerTool(name, config) { tools.set(name, config.inputSchema); } },
    { async post() { throw new Error("must not post"); } },
  );
  const accepts = (name, input) => tools.get(name).safeParse({ ...input, ai_model: "meshy-t2.5" }).success;
  assert.equal(accepts("meshy_text_to_3d", { prompt: "a robot" }), true);
  assert.equal(accepts("meshy_image_to_3d", { input_task_id: "x" }), true);
  assert.equal(accepts("meshy_multi_image_to_3d", { image_urls: ["https://example.invalid/a.png"] }), false);
  assert.equal(accepts("meshy_text_to_3d_refine", { preview_task_id: "x" }), false);
});

test("Smart Topology without ai_model still defaults to T2", async () => {
  const { call } = createHarness();
  const { body } = await call("meshy_image_to_3d", { input_task_id: "x", model_type: "smart-topology" });
  assert.equal(body.ai_model, "meshy-t2");
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

test("legacy Meshy 7 Ultra remains usable", async () => {
  const { call } = createHarness();
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

test("retired meshy-5 is rejected by every generation schema", () => {
  const tools = new Map();
  registerGenerationTools(
    { registerTool(name, config, handler) { tools.set(name, { schema: config.inputSchema, handler }); } },
    { async post() { throw new Error("must not post"); } },
  );
  for (const [name, input] of [
    ["meshy_text_to_3d", { prompt: "a robot" }],
    ["meshy_image_to_3d", { input_task_id: "x" }],
    ["meshy_multi_image_to_3d", { image_urls: ["https://example.invalid/a.png"] }],
    ["meshy_text_to_3d_refine", { preview_task_id: "x" }],
  ]) {
    const { schema } = tools.get(name);
    assert.equal(schema.safeParse({ ...input, ai_model: "meshy-6-lite" }).success, true, name);
    assert.equal(schema.safeParse({ ...input, ai_model: "meshy-5" }).success, false, name);
  }
});

// AIModel is shared with meshy_retexture; meshy-n1 is a retexture model, so it must not
// become a valid generation model by being in that enum.
test("retexture-only meshy-n1 is rejected by every generation schema", () => {
  const tools = new Map();
  registerGenerationTools(
    { registerTool(name, config, handler) { tools.set(name, { schema: config.inputSchema, handler }); } },
    { async post() { throw new Error("must not post"); } },
  );
  for (const [name, input] of [
    ["meshy_text_to_3d", { prompt: "a robot" }],
    ["meshy_image_to_3d", { input_task_id: "x" }],
    ["meshy_multi_image_to_3d", { image_urls: ["https://example.invalid/a.png"] }],
    ["meshy_text_to_3d_refine", { preview_task_id: "x" }],
  ]) {
    const { schema } = tools.get(name);
    for (const ai_model of ["latest", "meshy-7.1", "meshy-7", "meshy-6", "meshy-6-lite"]) {
      assert.equal(schema.safeParse({ ...input, ai_model }).success, true, `${name} ${ai_model}`);
    }
    assert.equal(schema.safeParse({ ...input, ai_model: "meshy-n1" }).success, false, name);
  }
});

test("retired Meshy T1 (meshy-t1, model_type lowpoly) is rejected by the generation schemas", () => {
  const tools = new Map();
  registerGenerationTools(
    { registerTool(name, config, handler) { tools.set(name, { schema: config.inputSchema, handler }); } },
    { async post() { throw new Error("must not post"); } },
  );
  for (const [name, input] of [
    ["meshy_text_to_3d", { prompt: "a robot" }],
    ["meshy_image_to_3d", { input_task_id: "x" }],
  ]) {
    const { schema } = tools.get(name);
    assert.equal(schema.safeParse({ ...input, model_type: "smart-topology", ai_model: "meshy-t2.5" }).success, true, name);
    assert.equal(schema.safeParse({ ...input, model_type: "smart-topology", ai_model: "meshy-t1" }).success, false, `${name} meshy-t1`);
    assert.equal(schema.safeParse({ ...input, model_type: "lowpoly" }).success, false, `${name} lowpoly`);
  }
});

// texture_model on image / multi-image to 3D (PRO-4335): the C3 enums, forwarding, the client-side
// refusals that mirror the API's 400s, and the C2 guide in the descriptions and instructions.
const IMAGE = ["meshy_image_to_3d", { input_task_id: "offline-image" }];
const MULTI = ["meshy_multi_image_to_3d", { image_urls: ["https://example.invalid/a.png"] }];

function registeredTools() {
  const tools = new Map();
  registerGenerationTools(
    { registerTool(name, config, handler) { tools.set(name, { ...config, handler }); } },
    { async post() { throw new Error("must not post"); } },
  );
  return tools;
}

test("texture_model enums: image takes meshy-7 / meshy-n1 / meshy-6-lite, multi-image meshy-7 / meshy-n1", () => {
  const tools = registeredTools();
  const accepts = ([name, input], texture_model) =>
    tools.get(name).inputSchema.safeParse({ ...input, texture_model }).success;
  for (const value of ["meshy-7", "meshy-n1", "meshy-6-lite"]) assert.equal(accepts(IMAGE, value), true, value);
  for (const value of ["meshy-7", "meshy-n1"]) assert.equal(accepts(MULTI, value), true, value);
  for (const value of ["meshy-6", "meshy-7.1", "latest", "meshy-t2"]) {
    assert.equal(accepts(IMAGE, value), false, `image ${value}`);
    assert.equal(accepts(MULTI, value), false, `multi ${value}`);
  }
  assert.equal(accepts(MULTI, "meshy-6-lite"), false, "multi meshy-6-lite");
});

test("texture_model is sent only when set and textured", async () => {
  const { call } = createHarness();
  for (const [tool, source] of [IMAGE, MULTI]) {
    const { body: omitted } = await call(tool, source);
    assert.equal("texture_model" in omitted, false, tool);
    const { body: set } = await call(tool, { ...source, texture_model: "meshy-n1" });
    assert.equal(set.texture_model, "meshy-n1", tool);
    // The API ignores texture_model untextured, so its rules do not apply either.
    const { body: untextured } = await call(tool, {
      ...source, texture_model: "meshy-n1", should_texture: false, enable_pbr: true,
    });
    assert.equal("texture_model" in untextured, false, tool);
    assert.equal(untextured.should_texture, false, tool);
  }
});

test("C2 pairs reach the API as the guide names them", async () => {
  const { call } = createHarness();
  const { body: character } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-t2.5", target_polycount: 15000, texture_model: "meshy-n1",
  });
  assert.deepEqual(
    [character.ai_model, character.model_type, character.target_polycount, character.texture_model],
    ["meshy-t2.5", "smart-topology", 15000, "meshy-n1"],
  );
  const { body: props } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-t2", texture_model: "meshy-n1",
  });
  assert.deepEqual([props.ai_model, props.model_type, props.texture_model], ["meshy-t2", "smart-topology", "meshy-n1"]);
  const { body: hero } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-7.1", texture_model: "meshy-7", enable_pbr: true, texture_resolution: "8k",
  });
  assert.deepEqual([hero.texture_model, hero.enable_pbr, hero.texture_resolution], ["meshy-7", true, "8k"]);
  const { path, body: photos } = await call("meshy_multi_image_to_3d", {
    image_urls: ["https://example.invalid/a.png", "https://example.invalid/b.png"], ai_model: "meshy-7.1", texture_model: "meshy-7",
  });
  assert.equal(path, "/openapi/v1/multi-image-to-3d");
  assert.equal(photos.texture_model, "meshy-7");
  const { body: drafts } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-6-lite", texture_model: "meshy-6-lite",
  });
  assert.deepEqual([drafts.ai_model, drafts.texture_model], ["meshy-6-lite", "meshy-6-lite"]);
});

test("resolution follows the texture model, not the geometry", async () => {
  const { call } = createHarness();
  // meshy-7 lifts meshy-6-lite's 2K cap (API: image/multi meshy-6-lite + meshy-7 at 8K).
  for (const [tool, source] of [IMAGE, MULTI]) {
    const { body } = await call(tool, {
      ...source, ai_model: "meshy-6-lite", texture_model: "meshy-7", texture_resolution: "8k", enable_pbr: true,
    });
    assert.deepEqual([body.ai_model, body.texture_model, body.texture_resolution, body.enable_pbr],
      ["meshy-6-lite", "meshy-7", "8k", true], tool);
  }
  // 2K-only texture models on a 4K/8K-capable geometry accept 2k.
  const { body } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-7.1", texture_model: "meshy-6-lite", texture_resolution: "2k", enable_pbr: true,
  });
  assert.deepEqual([body.texture_model, body.texture_resolution, body.enable_pbr], ["meshy-6-lite", "2k", true]);
});

test("allowed texture_model options pass through", async () => {
  const { call } = createHarness();
  // remove_lighting false asks for nothing meshy-n1 / meshy-6-lite cannot do.
  const { body: lightingOff } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-6", texture_model: "meshy-6-lite", remove_lighting: false,
  });
  assert.equal(lightingOff.remove_lighting, false);
  // meshy-7 on meshy-6 takes remove_lighting (the API ignores it) and a quad remesh.
  const { body: meshy7 } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-6", texture_model: "meshy-7",
    remove_lighting: true, should_remesh: true, topology: "quad", texture_prompt: "bronze",
  });
  assert.deepEqual([meshy7.texture_model, meshy7.remove_lighting, meshy7.topology, meshy7.texture_prompt],
    ["meshy-7", true, "quad", "bronze"]);
  // meshy-n1: quad without a remesh, a reference image, and Smart Topology (topology is not sent there).
  const { body: n1 } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-7.1", texture_model: "meshy-n1",
    topology: "quad", texture_image_url: "https://example.invalid/front.png",
  });
  assert.deepEqual([n1.texture_model, n1.texture_image_url], ["meshy-n1", "https://example.invalid/front.png"]);
  const { body: n1Smart } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-t2.5", texture_model: "meshy-n1", topology: "quad", should_remesh: true,
  });
  assert.equal("topology" in n1Smart, false);
  // meshy-6-lite takes a quad remesh.
  const { body: lite } = await call("meshy_image_to_3d", {
    input_task_id: "offline-image", ai_model: "meshy-7.1", texture_model: "meshy-6-lite", should_remesh: true, topology: "quad",
  });
  assert.deepEqual([lite.texture_model, lite.topology], ["meshy-6-lite", "quad"]);
});

test("multi-image texture_image_urls opens to meshy-6 / meshy-6-lite with texture_model meshy-7 or meshy-n1", async () => {
  const { call } = createHarness();
  const texture_image_urls = ["https://example.invalid/front.png", "https://example.invalid/back.png"];
  for (const ai_model of ["meshy-6", "meshy-6-lite"]) {
    for (const texture_model of ["meshy-7", "meshy-n1"]) {
      const { body } = await call("meshy_multi_image_to_3d", { ...MULTI[1], ai_model, texture_model, texture_image_urls });
      assert.deepEqual([body.ai_model, body.texture_model, body.texture_image_urls], [ai_model, texture_model, texture_image_urls]);
    }
    // Without a multi-view texture model, the geometry's own texture reads no slots.
    await createHarness().invalid("meshy_multi_image_to_3d", { ...MULTI[1], ai_model, texture_image_urls });
  }
});

for (const [label, [tool, source], input, message] of [
  ["meshy-n1 with texture_prompt", IMAGE, { texture_model: "meshy-n1", texture_prompt: "rusty metal" }, /meshy-n1 takes no texture_prompt/],
  ["meshy-n1 with texture_prompt (multi)", MULTI, { texture_model: "meshy-n1", texture_prompt: "rusty metal" }, /meshy-n1 takes no texture_prompt/],
  ["meshy-n1 with enable_pbr", IMAGE, { texture_model: "meshy-n1", enable_pbr: true }, /enable_pbr must be false/],
  ["meshy-n1 with enable_pbr (multi)", MULTI, { texture_model: "meshy-n1", enable_pbr: true }, /enable_pbr must be false/],
  ["meshy-n1 at 4k", IMAGE, { texture_model: "meshy-n1", texture_resolution: "4k" }, /meshy-n1 supports 2k textures only. Use texture_model meshy-7/],
  ["meshy-n1 at 8k (multi)", MULTI, { texture_model: "meshy-n1", texture_resolution: "8k" }, /2k textures only/],
  ["meshy-n1 with hd_texture", IMAGE, { texture_model: "meshy-n1", hd_texture: true }, /2k textures only/],
  ["meshy-n1 with remove_lighting", IMAGE, { ai_model: "meshy-6", texture_model: "meshy-n1", remove_lighting: true }, /does not remove lighting/],
  ["meshy-n1 with remove_lighting (multi)", MULTI, { texture_model: "meshy-n1", remove_lighting: true }, /does not remove lighting/],
  ["meshy-n1 quad remesh", IMAGE, { texture_model: "meshy-n1", should_remesh: true, topology: "quad" }, /quad remesh\. Use topology triangle/],
  ["meshy-n1 quad on meshy-6-lite's default remesh", MULTI, { ai_model: "meshy-6-lite", texture_model: "meshy-n1", topology: "quad" }, /meshy-6-lite remeshes by default/],
  ["meshy-6-lite at 4k", IMAGE, { ai_model: "meshy-7.1", texture_model: "meshy-6-lite", texture_resolution: "4k" }, /meshy-6-lite supports 2k textures only. Use texture_model meshy-7/],
  ["meshy-6-lite at 8k on T2.5", IMAGE, { ai_model: "meshy-t2.5", texture_model: "meshy-6-lite", texture_resolution: "8k" }, /2k textures only/],
  ["meshy-6-lite with remove_lighting", IMAGE, { ai_model: "meshy-6", texture_model: "meshy-6-lite", remove_lighting: true }, /meshy-6-lite does not remove lighting/],
  ["meshy-6-lite geometry at 4k without texture_model", IMAGE, { ai_model: "meshy-6-lite", texture_resolution: "4k" }, /or texture_model meshy-7, for 4k\/8k/],
]) {
  test(`rejects texture_model ${label} before posting`, async () => {
    const tools = registeredTools();
    const { inputSchema, handler } = tools.get(tool);
    const result = await handler(inputSchema.parse({ ...source, ...input }));
    assert.equal(result.isError, true, label);
    assert.match(result.content[0].text, message);
  });
}

test("the C2 guide is in both tool descriptions and the server instructions, with the Models link", async () => {
  const { MODEL_CHOICE_GUIDE, MODELS_DOC_URL } = await import("../dist/model-guide.js");
  const { MESHY_INSTRUCTIONS } = await import("../dist/instructions.js");
  assert.equal(MODELS_DOC_URL, "https://docs.meshy.ai/en/api/models");
  const rows = [
    "Detailed hero asset, product render, cinematic prop: meshy-7.1 + meshy-7 (PBR, up to 8K)",
    "Game character to rig and animate: meshy-t2.5 (smart topology, set target_polycount) + meshy-n1",
    "Many props for a game scene, or user-generated content: meshy-t2 (smart topology) + meshy-n1",
    "A real object from 2 to 4 photos: meshy-7.1 on Multi-Image to 3D + meshy-7",
    "A model to 3D print: meshy-7.1 + none, or meshy-7 to print in color",
    "Many drafts at a low cost: meshy-6-lite + meshy-6-lite",
  ];
  for (const row of rows) assert.ok(MODEL_CHOICE_GUIDE.includes(row), row);
  assert.ok(MODEL_CHOICE_GUIDE.endsWith(`More: ${MODELS_DOC_URL}`));
  const tools = registeredTools();
  for (const name of ["meshy_image_to_3d", "meshy_multi_image_to_3d"]) {
    assert.ok(tools.get(name).description.includes(MODEL_CHOICE_GUIDE), name);
  }
  assert.ok(MESHY_INSTRUCTIONS.includes(MODEL_CHOICE_GUIDE));
});

test("agents ask the use case and steer game assets to smart topology, text route included", async () => {
  const { MODELS_DOC_URL } = await import("../dist/model-guide.js");
  const { MESHY_INSTRUCTIONS } = await import("../dist/instructions.js");
  assert.match(MESHY_INSTRUCTIONS, /If the user hasn't said what the model is for .* ask before you pick models/);
  assert.match(MESHY_INSTRUCTIONS, /from text with meshy_text_to_3d model_type:"smart-topology"/);
  const text = registeredTools().get("meshy_text_to_3d").description;
  assert.match(text, /PICK THE MODEL FROM THE PROJECT: ask what the model is for/);
  assert.match(text, /model_type "smart-topology" with meshy-t2\.5/);
  assert.ok(text.includes(`More: ${MODELS_DOC_URL}`));
});
