import assert from "node:assert/strict";
import { test } from "node:test";
import { registerPostProcessingTools } from "../dist/tools/postprocessing.js";
import { registerImageTools } from "../dist/tools/image.js";
import { registerCreativeLabTools } from "../dist/tools/creative-lab.js";
import { registerPrintingTools } from "../dist/tools/printing.js";
import { registerConversionTools } from "../dist/tools/conversion.js";
import { registerGenerationTools } from "../dist/tools/generation.js";
import { creativeLabCredits, CreativeLabProduct } from "../dist/constants.js";

// Same offline harness as generation.test.mjs, for the other tool groups.
function createHarness(register) {
  const tools = new Map();
  const requests = [];
  register(
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
      return result.content[0].text;
    },
    schema(name) {
      return tools.get(name).schema;
    },
  };
}

test("retexture multi-view sends the explicit meshy-7 the API requires", async () => {
  const { call } = createHarness(registerPostProcessingTools);
  const { body } = await call("meshy_retexture", {
    input_task_id: "offline",
    multiview_image_urls: ["https://example.invalid/front.png"],
  });
  assert.equal(body.ai_model, "meshy-7");
});

test("retexture keeps Meshy UVs by default, leaves uploads and lighting to the API", async () => {
  const { call } = createHarness(registerPostProcessingTools);
  const { body } = await call("meshy_retexture", {
    input_task_id: "offline",
    text_style_prompt: "a".repeat(800),
  });
  assert.equal(body.ai_model, "latest");
  assert.equal(body.enable_original_uv, true);
  assert.equal("remove_lighting" in body, false);
  const { body: upload } = await call("meshy_retexture", {
    model_url: "https://example.invalid/model.glb",
    text_style_prompt: "gold",
  });
  assert.equal("enable_original_uv" in upload, false);
  const { body: optOut } = await call("meshy_retexture", {
    input_task_id: "offline",
    text_style_prompt: "gold",
    enable_original_uv: false,
  });
  assert.equal(optOut.enable_original_uv, false);
  const { body: meshy6 } = await call("meshy_retexture", {
    input_task_id: "offline",
    text_style_prompt: "gold",
    ai_model: "meshy-6",
    remove_lighting: false,
    enable_original_uv: true,
  });
  assert.equal(meshy6.remove_lighting, false);
  assert.equal(meshy6.enable_original_uv, true);
});

test("retexture accepts meshy-6-lite and rejects retired meshy-5", async () => {
  const h = createHarness(registerPostProcessingTools);
  const { body } = await h.call("meshy_retexture", {
    input_task_id: "offline",
    text_style_prompt: "gold",
    ai_model: "meshy-6-lite",
    remove_lighting: true,
  });
  assert.equal(body.ai_model, "meshy-6-lite");
  assert.equal("remove_lighting" in body, false);
  assert.equal(
    h.schema("meshy_retexture").safeParse({ input_task_id: "x", text_style_prompt: "x", ai_model: "meshy-5" }).success,
    false,
  );
});

for (const [label, input] of [
  ["multi-view on meshy-6", { input_task_id: "x", ai_model: "meshy-6", multiview_image_urls: ["https://example.invalid/a.png"] }],
  ["8k on meshy-6-lite", { input_task_id: "x", ai_model: "meshy-6-lite", text_style_prompt: "x", texture_resolution: "8k" }],
]) {
  test(`retexture rejects ${label} before posting`, async () => {
    const { invalid } = createHarness(registerPostProcessingTools);
    await invalid("meshy_retexture", input);
  });
}

// Meshy N1 on meshy_retexture (ENG-5144): a 2K base color texture from reference images only
// (one image, or 1–4 views with the front first). What these tests guard against:
//  1. meshy-n1 missing from the retexture schema, so an agent cannot pick it.
//  2. The multi-view path rewriting meshy-n1 to meshy-7, or refusing it: before N1 it took
//     meshy-7 only. Either way the agent would not get the model it asked for.
//  3. Views reordered or dropped on the way out: element 0 must stay the front view.
//  4. A request the API answers with 400 reaching it: a text prompt (alone or with an image),
//     enable_pbr true, texture_resolution 4k / 8k, or hd_texture true. Each is refused before
//     posting, and a missing image is reported as N1 needing one, not as the generic "pick one
//     style input" that would steer the agent back to text_style_prompt.
//  5. remove_lighting, a 400 on N1 with any value, being forwarded.
//  6. enable_pbr sent as anything but false, or a texture_resolution other than 2k sent.
//  7. The Meshy 7 multi-view default (no ai_model, or latest, sent as meshy-7) changing.
// Generation tools refusing meshy-n1 is in generation.test.mjs.
const N1_VIEWS = ["front", "back", "left", "right"].map((view) => `https://example.invalid/${view}.png`);

test("retexture meshy-n1 from one image sends the image alone, no PBR, 2K", async () => {
  const { call } = createHarness(registerPostProcessingTools);
  const { path, body } = await call("meshy_retexture", {
    input_task_id: "offline",
    ai_model: "meshy-n1",
    image_style_url: N1_VIEWS[0],
  });
  assert.equal(path, "/openapi/v1/retexture");
  assert.equal(body.ai_model, "meshy-n1");
  assert.equal(body.image_style_url, N1_VIEWS[0]);
  assert.equal(body.enable_pbr, false);
  for (const field of ["text_style_prompt", "multiview_image_urls", "texture_resolution", "hd_texture", "remove_lighting"]) {
    assert.equal(field in body, false, field);
  }

  const { body: explicit } = await call("meshy_retexture", {
    model_url: "https://example.invalid/model.glb",
    ai_model: "meshy-n1",
    image_style_url: N1_VIEWS[0],
    enable_pbr: false,
    texture_resolution: "2k",
    hd_texture: false,
    remove_lighting: true,
  });
  assert.equal(explicit.ai_model, "meshy-n1");
  assert.equal(explicit.enable_pbr, false);
  assert.equal(explicit.texture_resolution, "2k");
  assert.notEqual(explicit.hd_texture, true);
  assert.equal("remove_lighting" in explicit, false);
});

for (const count of [1, 2, 3, 4]) {
  test(`retexture meshy-n1 sends ${count} view(s) in order, front first, without forcing meshy-7`, async () => {
    const { call } = createHarness(registerPostProcessingTools);
    const views = N1_VIEWS.slice(0, count);
    const { body } = await call("meshy_retexture", {
      input_task_id: "offline",
      ai_model: "meshy-n1",
      multiview_image_urls: views,
    });
    assert.equal(body.ai_model, "meshy-n1");
    assert.deepEqual(body.multiview_image_urls, views);
    assert.equal(body.enable_pbr, false);
    for (const field of ["text_style_prompt", "image_style_url", "texture_resolution", "remove_lighting"]) {
      assert.equal(field in body, false, field);
    }
  });
}

for (const [label, input, message] of [
  ["a text prompt alone", { text_style_prompt: "rusty metal" }, /meshy-n1 needs a reference image/],
  ["no style input at all", {}, /meshy-n1 needs a reference image/],
  ["a text prompt with an image", { text_style_prompt: "rusty metal", image_style_url: N1_VIEWS[0] }, /meshy-n1 takes no text_style_prompt/],
  ["a text prompt with views", { text_style_prompt: "rusty metal", multiview_image_urls: N1_VIEWS }, /meshy-n1 takes no text_style_prompt/],
  ["enable_pbr true", { image_style_url: N1_VIEWS[0], enable_pbr: true }, /meshy-n1 .*enable_pbr/],
  ["texture_resolution 4k", { image_style_url: N1_VIEWS[0], texture_resolution: "4k" }, /meshy-n1 supports 2k textures only/],
  ["texture_resolution 8k", { multiview_image_urls: N1_VIEWS, texture_resolution: "8k" }, /meshy-n1 supports 2k textures only/],
  ["hd_texture true", { image_style_url: N1_VIEWS[0], hd_texture: true }, /meshy-n1 supports 2k textures only/],
  ["an image with views", { image_style_url: N1_VIEWS[0], multiview_image_urls: N1_VIEWS }, /mutually exclusive/],
]) {
  test(`retexture meshy-n1 refuses ${label} before posting`, async () => {
    const { invalid } = createHarness(registerPostProcessingTools);
    const text = await invalid("meshy_retexture", { input_task_id: "x", ai_model: "meshy-n1", ...input });
    assert.match(text, message);
  });
}

test("retexture multi-view still defaults to meshy-7 and names both multi-view models", async () => {
  const h = createHarness(registerPostProcessingTools);
  for (const ai_model of [undefined, "latest", "meshy-7"]) {
    const { body } = await h.call("meshy_retexture", {
      input_task_id: "offline",
      multiview_image_urls: N1_VIEWS,
      ...(ai_model ? { ai_model } : {}),
    });
    assert.equal(body.ai_model, "meshy-7", String(ai_model));
    assert.deepEqual(body.multiview_image_urls, N1_VIEWS);
  }
  const text = await createHarness(registerPostProcessingTools).invalid("meshy_retexture", {
    input_task_id: "x",
    ai_model: "meshy-6",
    multiview_image_urls: N1_VIEWS,
  });
  assert.match(text, /meshy-7/);
  assert.match(text, /meshy-n1/);
});

test("text-to-image omits aspect_ratio unless set and accepts GPT Image 2.5", async () => {
  const { call } = createHarness(registerImageTools);
  const { body } = await call("meshy_text_to_image", {
    ai_model: "gpt-image-2-5-flare",
    prompt: "a cat",
    generate_multi_view: true,
  });
  assert.equal(body.ai_model, "gpt-image-2-5-flare");
  assert.equal("aspect_ratio" in body, false);
  const { body: wide } = await call("meshy_text_to_image", {
    ai_model: "gpt-image-2",
    prompt: "a cat",
    aspect_ratio: "16:9",
  });
  assert.equal(wide.aspect_ratio, "16:9");
});

test("text-to-image rejects aspect_ratio with multi-view before posting", async () => {
  const { invalid } = createHarness(registerImageTools);
  await invalid("meshy_text_to_image", {
    ai_model: "nano-banana",
    prompt: "a cat",
    generate_multi_view: true,
    aspect_ratio: "1:1",
  });
});

test("creative lab is image-only and lamp is billed 30 + 6", async () => {
  const h = createHarness(registerCreativeLabTools);
  assert.equal(h.schema("meshy_creative_lab").safeParse({ product: "lamp", text: "an owl" }).success, false);
  await h.invalid("meshy_creative_lab", { product: "lamp" });
  assert.deepEqual(creativeLabCredits(CreativeLabProduct.LAMP), { prototype: 30, build: 6, total: 36 });
  assert.deepEqual(creativeLabCredits(CreativeLabProduct.KEYCAP), { prototype: 12, build: 50, total: 62 });
  assert.deepEqual(creativeLabCredits(CreativeLabProduct.FIGURE), { prototype: 6, build: 30, total: 36 });
});

test("print and conversion tools send input_task_id alone when both sources are given", async () => {
  const both = { input_task_id: "offline", model_url: "https://example.invalid/m.glb" };
  const printing = createHarness(registerPrintingTools);
  for (const name of ["meshy_analyze_printability", "meshy_repair_printability", "meshy_process_multicolor"]) {
    const { body } = await printing.call(name, both);
    assert.equal(body.input_task_id, "offline", name);
    assert.equal("model_url" in body, false, name);
  }
  const conversion = createHarness(registerConversionTools);
  for (const [name, extra] of [
    ["meshy_convert", { target_formats: ["stl"] }],
    ["meshy_resize", { resize_height: 1 }],
    ["meshy_uv_unwrap", {}],
  ]) {
    const { body } = await conversion.call(name, { ...both, ...extra });
    assert.equal(body.input_task_id, "offline", name);
    assert.equal("model_url" in body, false, name);
  }
  await createHarness(registerPrintingTools).invalid("meshy_repair_printability", {});
});

test("image prompts have no length cap", async () => {
  const { call } = createHarness(registerImageTools);
  const { body } = await call("meshy_text_to_image", { ai_model: "nano-banana", prompt: "a".repeat(2000) });
  assert.equal(body.prompt.length, 2000);
  const { body: one } = await call("meshy_image_to_image", {
    ai_model: "nano-banana",
    prompt: "x",
    reference_image_urls: ["https://example.invalid/a.png"],
  });
  assert.equal(one.prompt, "x");
});

test("multi-image accepts the deprecated model_type but never sends it", async () => {
  const h = createHarness(registerGenerationTools);
  const input = { image_urls: ["https://example.invalid/a.png"], model_type: "lowpoly" };
  assert.equal(h.schema("meshy_multi_image_to_3d").safeParse(input).success, true);
  const { body } = await h.call("meshy_multi_image_to_3d", input);
  assert.equal("model_type" in body, false);
});
