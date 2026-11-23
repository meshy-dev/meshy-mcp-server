import assert from "node:assert/strict";
import { test } from "node:test";
import { registerPrintingTools } from "../dist/tools/printing.js";
import { registerPostProcessingTools } from "../dist/tools/postprocessing.js";
import { registerImageTools } from "../dist/tools/image.js";
import { registerBalanceTool } from "../dist/tools/balance.js";
import { registerCreativeLabTools } from "../dist/tools/creative-lab.js";
import { registerTaskTools } from "../dist/tools/tasks.js";
import { registerWorkspaceTools } from "../dist/tools/workspace.js";
import { registerReliefTools } from "../dist/tools/relief.js";

// Offline request checks for the endpoints and options added or changed in 0.6.3.
// The fake client answers every GET with a finished task of the type the path
// implies, so tools that wait (Creative Lab) run to completion instantly.

function createHarness(register, getResponses = {}) {
  const tools = new Map();
  const posts = [];
  const gets = [];
  const deletes = [];
  const deleteOptions = [];
  let next = 0;
  const client = {
    async post(path, body) {
      posts.push({ path, body });
      return { result: `task-${++next}` };
    },
    async get(path, query) {
      gets.push({ path, query });
      for (const [prefix, response] of Object.entries(getResponses)) {
        if (path.startsWith(prefix)) return typeof response === "function" ? response(path) : response;
      }
      return [];
    },
    async getWithRetryAfter(path) {
      return { data: await this.get(path) };
    },
    async delete(path, options) {
      deletes.push(path);
      deleteOptions.push(options);
      return {};
    },
  };
  register(
    {
      registerTool(name, config, handler) {
        tools.set(name, { schema: config.inputSchema, handler });
      },
      sendLoggingMessage() {},
      server: { notification: async () => {} },
    },
    client,
  );
  return {
    posts,
    gets,
    deletes,
    deleteOptions,
    schema: (name) => tools.get(name).schema,
    async run(name, input) {
      const { schema, handler } = tools.get(name);
      return handler(schema.parse(input), {});
    },
    async call(name, input) {
      const result = await this.run(name, input);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return posts.at(-1);
    },
    async invalid(name, input) {
      const result = await this.run(name, input);
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.equal(posts.length, 0);
      return result.content[0].text;
    },
  };
}

test("auto split forwards its options and needs a prompt for prompt modes", async () => {
  const h = createHarness(registerPrintingTools);
  assert.match(await h.invalid("meshy_auto_split", { input_task_id: "t", mode: "by_parts" }), /needs a prompt/);
  const { path, body } = await h.call("meshy_auto_split", {
    input_task_id: "t",
    mode: "by_parts",
    prompt: "the figure and the base",
    target_formats: ["3mf"],
    layout: "on_plate",
    connectors: true,
    connector_type: "cylinder",
  });
  assert.equal(path, "/openapi/v1/print/split");
  assert.deepEqual(body, {
    input_task_id: "t",
    mode: "by_parts",
    prompt: "the figure and the base",
    target_formats: ["3mf"],
    layout: "on_plate",
    connectors: true,
    connector_type: "cylinder",
  });
  assert.equal(h.schema("meshy_auto_split").safeParse({ input_task_id: "t", connector_size: 0.9 }).success, false);
});

test("printability takes a printer and one print size; multi-color takes style and brand", async () => {
  const h = createHarness(registerPrintingTools);
  assert.match(
    await h.invalid("meshy_analyze_printability", { input_task_id: "t", intended_print_height_mm: 100, intended_print_longest_side_mm: 100 }),
    /at most one/,
  );
  const { body: analyze } = await h.call("meshy_analyze_printability", { input_task_id: "t", printer_type: "sla", intended_print_height_mm: 100 });
  assert.deepEqual(analyze, { input_task_id: "t", printer_type: "sla", intended_print_height_mm: 100 });
  const { body: repair } = await h.call("meshy_repair_printability", { model_url: "https://example.invalid/m.stl", intended_print_longest_side_mm: 80, alpha_thumbnail: true });
  assert.deepEqual(repair, { model_url: "https://example.invalid/m.stl", intended_print_longest_side_mm: 80, alpha_thumbnail: true });
  const { body: color } = await h.call("meshy_process_multicolor", { input_task_id: "t", style: "cartoon", printer_brand: "creality" });
  assert.equal(color.style, "cartoon");
  assert.equal(color.printer_brand, "creality");
  assert.equal(h.schema("meshy_process_multicolor").safeParse({ input_task_id: "t", printer_brand: "acme" }).success, false);
});

test("animate takes exactly one of action_id, action_ids, motion_task_id", async () => {
  const h = createHarness(registerPostProcessingTools);
  await h.invalid("meshy_animate", { rig_task_id: "r" });
  await h.invalid("meshy_animate", { rig_task_id: "r", action_id: 1, motion_task_id: "m" });
  assert.equal(h.schema("meshy_animate").safeParse({ rig_task_id: "r", action_ids: [1, 1] }).success, false);
  assert.equal(h.schema("meshy_animate").safeParse({ rig_task_id: "r", action_ids: Array.from({ length: 11 }, (_, i) => i) }).success, false);
  const { body: multi } = await h.call("meshy_animate", { rig_task_id: "r", action_ids: [92, 4] });
  assert.deepEqual(multi, { rig_task_id: "r", action_ids: [92, 4] });
  const { body: motion } = await h.call("meshy_animate", { rig_task_id: "r", motion_task_id: "m" });
  assert.deepEqual(motion, { rig_task_id: "r", motion_task_id: "m" });
});

test("text to motion checks prompt and duration steps", async () => {
  const h = createHarness(registerPostProcessingTools);
  const schema = h.schema("meshy_text_to_motion");
  assert.equal(schema.safeParse({ prompt: "jump", duration: 2.25 }).success, false);
  assert.equal(schema.safeParse({ prompt: "jump", duration: 10.5 }).success, false);
  assert.equal(schema.safeParse({ prompt: "a".repeat(401), duration: 3 }).success, false);
  const { path, body } = await h.call("meshy_text_to_motion", { prompt: "jump", duration: 2.5, mode: "swift" });
  assert.equal(path, "/openapi/v1/text-to-motion");
  assert.deepEqual(body, { prompt: "jump", duration: 2.5, mode: "swift" });
});

test("library and usage lookups send their filters as query parameters", async () => {
  const lib = createHarness(registerPostProcessingTools, {
    "/openapi/v1/animations/library": [{ action_id: 92, name: "Double Combo Attack", key: "k", category: "Fighting", sub_category: "s", preview_url: "u" }],
  });
  const found = await lib.run("meshy_list_animations", { search: "combo", category: "Fighting", action_ids: [92, 4] });
  assert.equal(found.structuredContent.count, 1);
  assert.deepEqual(lib.gets[0].query, { search: "combo", category: "Fighting", action_ids: "92,4" });

  const usage = createHarness(registerBalanceTool, { "/openapi/v1/usage/tasks": [] });
  await usage.run("meshy_list_usage", { endpoints: ["image-to-3d", "rig"], status: "FAILED", start_time: "2026-09-01T00:00:00Z" });
  assert.deepEqual(usage.gets[0].query, {
    page_num: 1,
    page_size: 20,
    sort_by: "-created_at",
    start_time: "2026-09-01T00:00:00Z",
    endpoints: "image-to-3d,rig",
    status: "FAILED",
  });
});

test("balance reports monthly and permanent credits", async () => {
  const h = createHarness(registerBalanceTool, {
    "/openapi/v1/balance": { balance: 1000, monthly_credits: 600, permanent_credits: 400, monthly_resets_at: Date.UTC(2026, 10, 1) },
  });
  const result = await h.run("meshy_check_balance", {});
  assert.deepEqual(result.structuredContent, {
    balance: 1000,
    monthly_credits: 600,
    permanent_credits: 400,
    monthly_resets_at: "2026-11-01T00:00:00.000Z",
  });
});

test("image-to-image chains from a task and both image tools take remove_background", async () => {
  const h = createHarness(registerImageTools);
  const { body } = await h.call("meshy_image_to_image", {
    ai_model: "nano-banana-2-1",
    prompt: "make it red",
    input_task_id: "img",
    reference_image_urls: ["https://example.invalid/a.png"],
    aspect_ratio: "16:9",
    remove_background: true,
  });
  assert.equal(body.input_task_id, "img");
  assert.equal("reference_image_urls" in body, false);
  assert.equal(body.aspect_ratio, "16:9");
  assert.equal(body.remove_background, true);
  const { body: t2i } = await h.call("meshy_text_to_image", { ai_model: "nano-banana-2-lite", prompt: "cat", remove_background: true });
  assert.equal(t2i.remove_background, true);
});

const finished = (path) => {
  const type = path.match(/creative-lab\/([^/]+)\/v1(?:\/(prototype|build))?/);
  return {
    id: path.split("/").at(-1),
    type: `creative-lab-${type[1]}${type[2] ? `-${type[2]}` : ""}`,
    status: "SUCCEEDED",
    progress: 100,
    consumed_credits: 6,
    model_urls: { glb: "https://example.invalid/model.glb" },
  };
};

test("creative lab: keychain name text goes on the prototype, options and format on the build", async () => {
  const h = createHarness(registerCreativeLabTools, { "/openapi/creative-lab/": finished });
  await h.call("meshy_creative_lab", {
    product: "keychain",
    image_url: "https://example.invalid/dog.png",
    name_text: "Biscuit",
    build_options: { badge_shape: "star", size_mm: 45 },
    output_format: "obj",
  });
  assert.deepEqual(h.posts.map((p) => p.path), ["/openapi/creative-lab/keychain/v1/prototype", "/openapi/creative-lab/keychain/v1/build"]);
  assert.equal(h.posts[0].body.name_text, "Biscuit");
  assert.deepEqual(h.posts[1].body, { input_task_id: "task-1", options: { badge_shape: "star", size_mm: 45 }, output: { format: "obj" } });
});

test("creative lab: fidget pixel needs a subject; collapsible fidget is one task", async () => {
  const h = createHarness(registerCreativeLabTools, { "/openapi/creative-lab/": finished });
  assert.match(await h.invalid("meshy_creative_lab", { product: "fidget-pixel", image_url: "https://example.invalid/a.png" }), /pixel_subject/);
  assert.match(await h.invalid("meshy_creative_lab", { product: "figure", image_url: "https://example.invalid/a.png", name_text: "x" }), /keychain only/);
  assert.match(await h.invalid("meshy_creative_lab", { product: "lamp", image_url: "https://example.invalid/a.png", output_format: "glb" }), /stl, zip/);
  assert.equal(h.schema("meshy_creative_lab").safeParse({ product: "keychain", name_text: "elevenchars" }).success, false);

  await h.call("meshy_creative_lab", { product: "fidget-pixel", image_url: "https://example.invalid/a.png", pixel_subject: "person", build_options: { grid_size: 16 } });
  assert.equal(h.posts[0].body.type, "person");
  assert.deepEqual(h.posts[1].body.options, { grid_size: 16 });

  const single = createHarness(registerCreativeLabTools, { "/openapi/creative-lab/": finished });
  const result = await single.run("meshy_creative_lab", { product: "fidget-collapsible", image_url: "https://example.invalid/a.png", name: "ring" });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.deepEqual(single.posts, [{ path: "/openapi/creative-lab/fidget-collapsible/v1", body: { image_url: "https://example.invalid/a.png", name: "ring" } }]);
  assert.equal(result.structuredContent.task_type, "creative-lab-fidget-collapsible");
});

const PHOTO = "https://example.invalid/a.png";
const lab = () => createHarness(registerCreativeLabTools, { "/openapi/creative-lab/": finished });

test("creative lab: build options are refused before the billable prototype", async () => {
  for (const [label, input, message] of [
    ["keychain export_resolution 63", { product: "keychain", build_options: { export_resolution: 63 } }, /export_resolution/],
    ["keychain export_resolution 513", { product: "keychain", build_options: { export_resolution: 513 } }, /export_resolution/],
    ["fridge-magnet export_resolution 100.5", { product: "fridge-magnet", build_options: { export_resolution: 100.5 } }, /export_resolution/],
    ["fridge-magnet export_resolution -1", { product: "fridge-magnet", build_options: { export_resolution: -1 } }, /export_resolution/],
    ["keychain size_mm 0", { product: "keychain", build_options: { size_mm: 0 } }, /size_mm/],
    ["keychain relief_height_mm 21", { product: "keychain", build_options: { relief_height_mm: 21 } }, /relief_height_mm/],
    ["keychain badge_shape oval", { product: "keychain", build_options: { badge_shape: "oval" } }, /badge_shape/],
    ["keychain depth_threshold 1.5", { product: "keychain", build_options: { depth_threshold: 1.5 } }, /depth_threshold/],
    ["lamp diameter_mm 49", { product: "lamp", build_options: { diameter_mm: 49 } }, /diameter_mm/],
    ["lamp diameter_mm 401", { product: "lamp", build_options: { diameter_mm: 401 } }, /diameter_mm/],
    ["lamp thickness_mm 0", { product: "lamp", build_options: { thickness_mm: 0 } }, /thickness_mm/],
    ["lamp rotate_x_deg 361", { product: "lamp", build_options: { rotate_x_deg: 361 } }, /rotate_x_deg/],
    ["lamp light_source_preset other", { product: "lamp", build_options: { light_source_preset: "other" } }, /light_source_preset/],
    ["lamp include_result_json with the default STL", { product: "lamp", build_options: { include_result_json: true } }, /include_result_json true requires output_format zip/],
    ["keycap head_size_mm 41 in build_options", { product: "keycap", build_options: { head_size_mm: 41 } }, /head_size_mm/],
    ["keycap vertical_offset_mm -6 in build_options", { product: "keycap", build_options: { vertical_offset_mm: -6 } }, /vertical_offset_mm/],
    ["keycap base_model other", { product: "keycap", build_options: { base_model: "other" } }, /base_model/],
    ["fidget-pixel grid_size 20", { product: "fidget-pixel", pixel_subject: "other", build_options: { grid_size: 20 } }, /grid_size/],
    ["fidget-pixel piece_size_mm 7", { product: "fidget-pixel", pixel_subject: "other", build_options: { piece_size_mm: 7 } }, /piece_size_mm/],
    ["fidget-pixel color_count 9", { product: "fidget-pixel", pixel_subject: "other", build_options: { color_count: 9 } }, /color_count/],
    ["fidget-pixel color_count 1.5", { product: "fidget-pixel", pixel_subject: "other", build_options: { color_count: 1.5 } }, /color_count/],
    ["fidget-pixel piece_height_mm 9", { product: "fidget-pixel", pixel_subject: "other", build_options: { piece_height_mm: 9 } }, /piece_height_mm/],
    ["fidget-pixel hex pieces at 10 mm", { product: "fidget-pixel", pixel_subject: "other", build_options: { shape: "hex", piece_size_mm: 10 } }, /hex pieces come in 6 or 8 mm only/],
  ]) {
    const h = lab();
    const text = await h.invalid("meshy_creative_lab", { image_url: PHOTO, ...input });
    assert.match(text, message, label);
    assert.match(text, /build_options|include_result_json/, label);
    assert.deepEqual(h.gets, [], label);
  }
});

test("creative lab: build option boundary values pass and reach the build", async () => {
  for (const export_resolution of [0, 64, 512]) {
    const h = lab();
    await h.call("meshy_creative_lab", { product: "keychain", image_url: PHOTO, build_options: { export_resolution } });
    assert.deepEqual(h.posts[1].body.options, { export_resolution });
  }
  for (const [input, options] of [
    [{ product: "fridge-magnet" }, { size_mm: 400, relief_height_mm: 0, depth_threshold: 1, export_resolution: 512 }],
    [{ product: "lamp" }, { diameter_mm: 50, thickness_mm: 10, cut_amount_percent: 1, rotate_z_deg: -360, fixture_offset_x_mm: 80 }],
    [{ product: "lamp", output_format: "zip" }, { diameter_mm: 400, include_result_json: true }],
    [{ product: "lamp" }, { include_result_json: false }],
    [{ product: "fidget-pixel", pixel_subject: "person" }, { shape: "hex", piece_size_mm: 8, grid_size: 32, color_count: 8, piece_height_mm: 80 }],
    [{ product: "fidget-pixel", pixel_subject: "person" }, { shape: "square", piece_size_mm: 10, color_count: 1, piece_height_mm: 10 }],
    [{ product: "keychain" }, { future_option: "kept" }],
  ]) {
    const h = lab();
    await h.call("meshy_creative_lab", { image_url: PHOTO, build_options: options, ...input });
    assert.deepEqual(h.posts[1].body.options, options);
  }
  const keycap = createHarness(registerCreativeLabTools, {
    "/openapi/creative-lab/": (path) => ({ ...finished(path), candidate_ids: ["candidate-1"] }),
  });
  await keycap.call("meshy_creative_lab", {
    product: "keycap", image_url: PHOTO, build_options: { head_size_mm: 10, vertical_offset_mm: 5 }, base_model: "cherry-mx-1x1-r1",
  });
  assert.deepEqual(keycap.posts[1].body.options, { head_size_mm: 10, vertical_offset_mm: 5, base_model: "cherry-mx-1x1-r1" });
});

test("creative lab: name_text is described as printed detail, not engraving", () => {
  const { shape } = lab().schema("meshy_creative_lab");
  assert.match(shape.name_text.description, /flat coloured detail/);
  assert.doesNotMatch(shape.name_text.description, /engrav/i);
  assert.doesNotMatch(shape.name.description, /engrav/i);
  assert.match(shape.build_options.description, /export_resolution \(0 = server default, or 64–512\)/);
});

test("nano-banana models refuse 3:2 and 2:3 on both image tools; GPT Image models and other ratios pass", async () => {
  for (const ai_model of ["nano-banana", "nano-banana-2", "nano-banana-2-lite", "nano-banana-2-1", "nano-banana-pro"]) {
    for (const aspect_ratio of ["3:2", "2:3"]) {
      const text = await createHarness(registerImageTools).invalid("meshy_text_to_image", { ai_model, prompt: "cat", aspect_ratio });
      assert.match(text, new RegExp(`aspect_ratio ${aspect_ratio} is only supported by the GPT Image models`), `${ai_model} ${aspect_ratio}`);
      assert.match(text, /gpt-image-2/);
      await createHarness(registerImageTools).invalid("meshy_image_to_image", {
        ai_model, prompt: "cat", aspect_ratio, reference_image_urls: [PHOTO],
      });
    }
    for (const aspect_ratio of ["1:1", "16:9", "9:16", "4:3", "3:4"]) {
      const h = createHarness(registerImageTools);
      assert.equal((await h.call("meshy_text_to_image", { ai_model, prompt: "cat", aspect_ratio })).body.aspect_ratio, aspect_ratio);
      assert.equal((await h.call("meshy_image_to_image", { ai_model, prompt: "cat", aspect_ratio, reference_image_urls: [PHOTO] })).body.aspect_ratio, aspect_ratio);
    }
  }
  for (const ai_model of ["gpt-image-2", "gpt-image-2-5-flare", "gpt-image-2-5-sunburst"]) {
    for (const aspect_ratio of ["3:2", "2:3"]) {
      const h = createHarness(registerImageTools);
      assert.equal((await h.call("meshy_text_to_image", { ai_model, prompt: "cat", aspect_ratio })).body.aspect_ratio, aspect_ratio);
      assert.equal((await h.call("meshy_image_to_image", { ai_model, prompt: "cat", aspect_ratio, reference_image_urls: [PHOTO] })).body.aspect_ratio, aspect_ratio);
    }
  }
});

test("a pose on a nano-banana model says the aspect ratio is not used; the request still goes out", async () => {
  const run = async (input) => {
    const h = createHarness(registerImageTools);
    const result = await h.run("meshy_text_to_image", { prompt: "knight", ...input });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return { result, body: h.posts[0].body, text: result.content[0].text, message: result.structuredContent.message };
  };

  // The 1:1 default (no aspect_ratio): the note says the image will not be 1:1.
  const dflt = await run({ ai_model: "nano-banana-2", pose_mode: "t-pose" });
  assert.match(dflt.message, /Note: nano-banana-2 renders a t-pose image at 3:4, so the image will not be 1:1; the GPT Image models keep the ratio\./);
  assert.match(dflt.text, /Note: nano-banana-2 renders a t-pose image at 3:4/);
  assert.equal("aspect_ratio" in dflt.body, false);
  assert.equal(dflt.body.pose_mode, "t-pose");

  // An explicit ratio is named, and still sent.
  const wide = await run({ ai_model: "nano-banana-pro", pose_mode: "a-pose", aspect_ratio: "16:9" });
  assert.match(wide.message, /nano-banana-pro renders a a-pose image at 3:4, so aspect_ratio 16:9 is not used/);
  assert.equal(wide.body.aspect_ratio, "16:9");

  // The JSON format carries it in the message too.
  const json = await run({ ai_model: "nano-banana", pose_mode: "t-pose", aspect_ratio: "1:1", response_format: "json" });
  assert.match(JSON.parse(json.text).message, /aspect_ratio 1:1 is not used/);

  // No note: 3:4 asked, a GPT Image model, or no pose.
  for (const input of [
    { ai_model: "nano-banana-2", pose_mode: "t-pose", aspect_ratio: "3:4" },
    { ai_model: "gpt-image-2", pose_mode: "t-pose" },
    { ai_model: "gpt-image-2-5-sunburst", pose_mode: "a-pose", aspect_ratio: "16:9" },
    { ai_model: "nano-banana-2", aspect_ratio: "16:9" },
    { ai_model: "nano-banana-2" },
  ]) {
    const quiet = await run(input);
    assert.doesNotMatch(quiet.text, /Note:/, JSON.stringify(input));
    assert.doesNotMatch(quiet.message, /Note:/, JSON.stringify(input));
  }
});

test("cancel deletes a finished task only after confirmation and explains refunds", async () => {
  const task = (status, type) => () => ({ id: "t", type, status });
  const done = createHarness(registerTaskTools, { "/openapi/v1/image-to-3d/t": task("SUCCEEDED", "image-to-3d") });
  const refused = await done.run("meshy_cancel_task", { task_id: "t" });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /confirm_delete/);
  assert.deepEqual(done.deletes, []);
  const deleted = await done.run("meshy_cancel_task", { task_id: "t", confirm_delete: true });
  assert.deepEqual(done.deletes, ["/openapi/v1/image-to-3d/t"]);
  assert.match(deleted.structuredContent.message, /permanently/);

  const running = createHarness(registerTaskTools, { "/openapi/v1/image-to-3d/t": task("IN_PROGRESS", "image-to-3d") });
  const notStopped = await running.run("meshy_cancel_task", { task_id: "t", confirm_delete: true });
  assert.equal(notStopped.isError, true);
  assert.match(notStopped.content[0].text, /cannot be stopped/);
  assert.deepEqual(running.deletes, []);

  const pending = createHarness(registerTaskTools, { "/openapi/v1/image-to-3d/t": task("PENDING", "image-to-3d") });
  // A cancel decided on the status it read is sent once, and the reply does not promise a refund
  // a task finishing in between would not get.
  assert.match((await pending.run("meshy_cancel_task", { task_id: "t" })).structuredContent.message, /refunded, unless it finished/);
  assert.deepEqual(pending.deleteOptions, [{ retry: false }]);

  const lab = createHarness(registerTaskTools, {
    "/openapi/creative-lab/figure/v1/build/t": task("IN_PROGRESS", "creative-lab-figure-build"),
  });
  const canceled = await lab.run("meshy_cancel_task", { task_id: "t", task_type: "creative-lab-figure-build" });
  assert.match(canceled.structuredContent.message, /not refunded/);
  assert.deepEqual(lab.deletes, ["/openapi/creative-lab/figure/v1/build/t"]);
});

test("remesh sends only the fields the caller set", async () => {
  const h = createHarness(registerPostProcessingTools);
  const { body } = await h.call("meshy_remesh", { input_task_id: "t", target_polycount: 10000, alpha_thumbnail: true });
  assert.deepEqual(body, { input_task_id: "t", target_formats: ["glb"], target_polycount: 10000, alpha_thumbnail: true });
});

test("retexture on meshy-6-lite suggests models retexture accepts", async () => {
  const h = createHarness(registerPostProcessingTools);
  const text = await h.invalid("meshy_retexture", { input_task_id: "t", text_style_prompt: "gold", ai_model: "meshy-6-lite", texture_resolution: "4k" });
  assert.match(text, /meshy-6, meshy-7 or latest/);
  assert.doesNotMatch(text, /7\.1/);
});

test("download saves every Creative Lab part unless a format is asked for", async () => {
  const { createServer } = await import("node:http");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const server = createServer((req, res) => {
    if (req.url === "/gone.stl") res.statusCode = 404;
    res.end(req.url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meshy-dl-"));
  try {
    const lamp = () => ({
      id: "t",
      type: "creative-lab-lamp-build",
      status: "SUCCEEDED",
      model_urls: { glb: `${base}/lamp.glb`, lamp_stl: `${base}/lamp.stl`, base_stl: `${base}/base.stl` },
    });
    const h = createHarness(registerTaskTools, { "/openapi/creative-lab/lamp/v1/build/t": lamp });
    const all = await h.run("meshy_download_model", { task_id: "t", task_type: "creative-lab-lamp-build", save_to: path.join(dir, "all.stl") });
    assert.equal(all.structuredContent.count, 3, JSON.stringify(all));
    const one = await h.run("meshy_download_model", { task_id: "t", task_type: "creative-lab-lamp-build", format: "glb", save_to: path.join(dir, "one.glb") });
    assert.equal(one.structuredContent.format, "glb", JSON.stringify(one));
    assert.equal(fs.readFileSync(path.join(dir, "one.glb"), "utf-8"), "/lamp.glb");

    const partial = createHarness(registerTaskTools, {
      "/openapi/creative-lab/lamp/v1/build/t": () => ({ ...lamp(), model_urls: { glb: `${base}/lamp.glb`, base_stl: `${base}/gone.stl` } }),
    });
    const some = await partial.run("meshy_download_model", { task_id: "t", task_type: "creative-lab-lamp-build", save_to: path.join(dir, "some.stl") });
    assert.equal(some.isError, undefined, JSON.stringify(some));
    assert.equal(some.structuredContent.count, 1);
    assert.deepEqual(some.structuredContent.not_saved.map((n) => [n.part, n.url]), [["base_stl", `${base}/gone.stl`]]);
    assert.match(some.content[0].text, /Not saved/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("list_tasks takes the API's task type names and rejects unknown ones", async () => {
  const h = createHarness(registerTaskTools, { "/openapi/v1/rigging": [] });
  const schema = h.schema("meshy_list_tasks");
  assert.equal(schema.parse({ task_type: "rig" }).task_type, "rigging");
  assert.equal(schema.safeParse({ task_type: "nope" }).success, false);
  await h.run("meshy_list_tasks", { task_type: "rig" });
  assert.deepEqual(h.gets.map((g) => g.path), ["/openapi/v1/rigging"]);
});

test("list_models asks only image-to-3d by default and merges the types it is given", async () => {
  const done = (id, created_at, extra = { model_urls: { glb: "u" } }) => ({ id, status: "SUCCEEDED", created_at, ...extra });
  const h = createHarness(registerWorkspaceTools, {
    "/openapi/v1/image-to-3d": [done("i1", 300), done("i2", 100), { id: "i3", status: "FAILED", created_at: 400 }],
    "/openapi/v2/text-to-3d": [done("t1", 200)],
    "/openapi/v1/rigging": [done("r1", 250, { result: { rigged_character_glb_url: "u" } })],
    "/openapi/v1/remesh": () => { throw new Error("down"); },
  });
  const first = await h.run("meshy_list_models", {});
  assert.deepEqual(h.gets.map((g) => g.path), ["/openapi/v1/image-to-3d"]);
  assert.deepEqual(first.structuredContent.models.map((m) => m.id), ["i1", "i2"]);
  assert.equal(first.structuredContent.has_more, false);

  const merged = await h.run("meshy_list_models", { task_types: ["image-to-3d", "text-to-3d", "rig", "remesh"], offset: 1, limit: 2 });
  assert.deepEqual(merged.structuredContent.models.map((m) => [m.id, m.task_type, m.formats.join()]), [
    ["r1", "rigging", "glb"],
    ["t1", "text-to-3d", "glb"],
  ]);
  assert.equal(merged.structuredContent.has_more, true);
  assert.equal(merged.structuredContent.next_offset, 3);
  assert.deepEqual(merged.structuredContent.failed_types, ["remesh"]);
  assert.equal(h.gets.at(-1).query.page_size, 3);
  assert.equal(h.schema("meshy_list_models").safeParse({ task_types: ["text-to-image"] }).success, false);
});

test("task status carries type-specific results and fits its output schema", async () => {
  const { TaskStatusOutputSchema } = await import("../dist/schemas/output.js");
  const split = () => ({ id: "s", type: "print-split", status: "SUCCEEDED", progress: 100, part_count: 4, prompt_ignored: true, model_urls: { glb: "u" }, thumbnail_url: "t" });
  const h = createHarness(registerTaskTools, { "/openapi/v1/print/split/s": split });
  for (const wait of [false, true]) {
    const result = await h.run("meshy_get_task_status", { task_id: "s", task_type: "print-split", wait });
    const out = JSON.parse(JSON.stringify(result.structuredContent));
    assert.equal(out.part_count, 4, JSON.stringify(result));
    assert.equal(out.prompt_ignored, true);
    assert.equal(TaskStatusOutputSchema.strict().safeParse(out).success, true, JSON.stringify(out));
  }
});

test("a failed task whose task_error carries nulls still fits the output schema", async () => {
  const { TaskStatusOutputSchema } = await import("../dist/schemas/output.js");
  const failed = () => ({
    id: "f", type: "text-to-3d-preview", status: "FAILED", progress: 0, mode: "preview",
    model_urls: {}, texture_urls: [], thumbnail_url: "", expires_at: null, input: { prompt: "chair" }, output: null,
    task_error: { type: "server_error", code: null, message: "Something went wrong", doc_url: null },
  });
  const h = createHarness(registerTaskTools, { "/openapi/v2/text-to-3d/f": failed });
  for (const wait of [false, true]) {
    const result = await h.run("meshy_get_task_status", { task_id: "f", task_type: "text-to-3d", wait });
    const out = JSON.parse(JSON.stringify(result.structuredContent));
    assert.equal(out.error_type, "server_error", JSON.stringify(result));
    assert.equal(out.error_message, "Something went wrong");
    assert.equal("error_code" in out, false);
    assert.equal("error_doc_url" in out, false);
    assert.equal(TaskStatusOutputSchema.strict().safeParse(out).success, true, JSON.stringify(out));
  }
});

test("list_tasks queries the five generation and image types unless told otherwise", async () => {
  const h = createHarness(registerTaskTools, {
    "/openapi/v1/rigging": [{ id: "r", status: "SUCCEEDED", created_at: 2 }],
    "/openapi/v1/print/split": [{ id: "p", status: "FAILED", created_at: 1 }],
  });
  const def = await h.run("meshy_list_tasks", {});
  assert.match(def.content[0].text, /Default types only: printing, rigging/);
  assert.match(def.structuredContent.note, /pass task_types/);
  assert.deepEqual(h.gets.map((g) => g.path).sort(), [
    "/openapi/v1/image-to-3d",
    "/openapi/v1/image-to-image",
    "/openapi/v1/multi-image-to-3d",
    "/openapi/v1/text-to-image",
    "/openapi/v2/text-to-3d",
  ]);
  h.gets.length = 0;
  const both = await h.run("meshy_list_tasks", { task_type: "rig", task_types: ["print-split", "rigging"] });
  assert.deepEqual(h.gets.map((g) => g.path).sort(), ["/openapi/v1/print/split", "/openapi/v1/rigging"]);
  assert.deepEqual(both.structuredContent.tasks.map((t) => [t.id, t.task_type]), [["r", "rigging"], ["p", "print-split"]]);
  assert.equal(h.schema("meshy_list_tasks").safeParse({ task_types: ["nope"] }).success, false);
});

test("a task listed by a sibling route appears once, under its own type", async () => {
  const t2i = { id: "a", type: "text-to-image", status: "SUCCEEDED", created_at: 2 };
  const i2i = { id: "b", type: "image-to-image", status: "SUCCEEDED", created_at: 1 };
  const h = createHarness(registerTaskTools, {
    "/openapi/v1/text-to-image": [t2i, i2i],
    "/openapi/v1/image-to-image": [i2i],
  });
  const both = await h.run("meshy_list_tasks", { task_types: ["text-to-image", "image-to-image"] });
  assert.deepEqual(both.structuredContent.tasks.map((t) => [t.id, t.task_type]), [["a", "text-to-image"], ["b", "image-to-image"]]);
  const one = await h.run("meshy_list_tasks", { task_type: "text-to-image" });
  assert.deepEqual(one.structuredContent.tasks.map((t) => t.id), ["a"]);
});

test("a truncated list continues right after the tasks it showed", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, type: "image-to-3d", status: "SUCCEEDED", created_at: 1000 - i, name: "x".repeat(2000) }));
  const h = createHarness(registerTaskTools, { "/openapi/v1/image-to-3d": many });
  const page = await h.run("meshy_list_tasks", { task_type: "image-to-3d", limit: 40 });
  const shown = page.structuredContent.tasks.length;
  assert.ok(shown < 40, `expected truncation, got ${shown}`);
  assert.equal(page.structuredContent.has_more, true);
  assert.equal(page.structuredContent.next_offset, shown);
});

// Relief: one photo → a bas-relief model and a depth map (POST /openapi/v1/relief, 20 credits).

test("relief sends only the fields the caller set, to its own route", async () => {
  const h = createHarness(registerReliefTools);
  const { path, body } = await h.call("meshy_relief", { image_url: PHOTO });
  assert.equal(path, "/openapi/v1/relief");
  assert.deepEqual(body, { image_url: PHOTO });

  const every = {
    variant: "high",
    should_generate_model: true,
    size_mm: 120,
    carving_mode: "engrave",
    carving_depth_mm: 10,
    remove_base: false,
    removal_threshold: 0.2,
    base_thickness_mm: 3,
    bend_mode: "convex",
    bend_axis: "yz",
    bend_angle: 90,
    mesh_resolution: 2048,
    target_formats: ["glb", "obj", "stl", "3mf"],
    color_mapping: true,
  };
  const result = await h.run("meshy_relief", { image_url: PHOTO, ...every });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.deepEqual(h.posts.at(-1).body, { image_url: PHOTO, ...every });
  assert.match(result.structuredContent.message, /20 credits/);
  assert.match(result.content[0].text, /task_type "relief"/);

  const depth = await h.run("meshy_relief", { image_url: PHOTO, should_generate_model: false });
  assert.deepEqual(h.posts.at(-1).body, { image_url: PHOTO, should_generate_model: false });
  assert.match(depth.structuredContent.message, /depth map only/);
});

test("relief reads a local photo into a data URI", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meshy-relief-"));
  try {
    const file = path.join(dir, "photo.png");
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { body } = await createHarness(registerReliefTools).call("meshy_relief", { file_path: file });
    assert.equal(body.image_url, "data:image/png;base64,iVBORw==");
    const text = await createHarness(registerReliefTools).invalid("meshy_relief", { file_path: path.join(dir, "photo.gif") });
    assert.match(text, /Unsupported image format/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("relief refuses values outside the API's ranges before anything is sent", () => {
  const schema = createHarness(registerReliefTools).schema("meshy_relief");
  for (const [label, input] of [
    ["variant medium", { variant: "medium" }],
    ["size_mm 19", { size_mm: 19 }],
    ["size_mm 251", { size_mm: 251 }],
    ["carving_mode stamp", { carving_mode: "stamp" }],
    ["carving_depth_mm -1", { carving_depth_mm: -1 }],
    ["carving_depth_mm 61", { carving_depth_mm: 61 }],
    ["removal_threshold 0", { removal_threshold: 0 }],
    ["removal_threshold 1.01", { removal_threshold: 1.01 }],
    ["base_thickness_mm 10.5", { base_thickness_mm: 10.5 }],
    ["base_thickness_mm -1", { base_thickness_mm: -1 }],
    ["bend_mode wave", { bend_mode: "wave" }],
    ["bend_axis xy", { bend_axis: "xy" }],
    ["bend_angle -1", { bend_angle: -1 }],
    ["bend_angle 361", { bend_angle: 361 }],
    ["mesh_resolution 511", { mesh_resolution: 511 }],
    ["mesh_resolution 2049", { mesh_resolution: 2049 }],
    ["mesh_resolution 1024.5", { mesh_resolution: 1024.5 }],
    ["target_formats blend", { target_formats: ["blend"] }],
    ["target_formats repeated", { target_formats: ["stl", "stl"] }],
    ["target_formats empty", { target_formats: [] }],
    ["color_mapping as text", { color_mapping: "yes" }],
    ["an unknown field", { depth: 3 }],
  ]) {
    assert.equal(schema.safeParse({ image_url: PHOTO, ...input }).success, false, label);
  }
  for (const input of [
    { size_mm: 20, carving_depth_mm: 0, removal_threshold: 0.01, bend_angle: 0, mesh_resolution: 512 },
    { size_mm: 250, carving_depth_mm: 60, removal_threshold: 1, bend_angle: 360, mesh_resolution: 2048, base_thickness_mm: 10 },
    { target_formats: ["glb", "obj", "fbx", "stl", "usdz", "3mf"] },
  ]) {
    assert.equal(schema.safeParse({ image_url: PHOTO, ...input }).success, true, JSON.stringify(input));
  }
});

test("relief base thickness: 0.1–10 with a base, omitted or 0 with remove_base", async () => {
  for (const [input, message] of [
    [{ remove_base: true, base_thickness_mm: 1 }, /omit base_thickness_mm or send 0/],
    [{ remove_base: true, base_thickness_mm: 0.1 }, /omit base_thickness_mm or send 0/],
    [{ base_thickness_mm: 0 }, /0\.1–10 \(0 only with remove_base true\)/],
    [{ remove_base: false, base_thickness_mm: 0.05 }, /0\.1–10/],
  ]) {
    const text = await createHarness(registerReliefTools).invalid("meshy_relief", { image_url: PHOTO, ...input });
    assert.match(text, message, JSON.stringify(input));
  }
  assert.match(await createHarness(registerReliefTools).invalid("meshy_relief", {}), /image_url or file_path/);
  for (const input of [
    { remove_base: true, base_thickness_mm: 0 },
    { remove_base: true },
    { base_thickness_mm: 0.1 },
    { remove_base: false, base_thickness_mm: 10 },
  ]) {
    const { body } = await createHarness(registerReliefTools).call("meshy_relief", { image_url: PHOTO, ...input });
    assert.deepEqual(body, { image_url: PHOTO, ...input });
  }
});

const RELIEF_DONE = {
  id: "r",
  type: "relief",
  status: "SUCCEEDED",
  progress: 100,
  consumed_credits: 20,
  created_at: 1699999999000,
  finished_at: 1700000060000,
  expires_at: 1700259260000,
  task_error: null,
};

test("relief tasks are read, listed and deleted on the relief route", async () => {
  const { TaskStatusOutputSchema } = await import("../dist/schemas/output.js");
  const colored = () => ({
    ...RELIEF_DONE,
    model_urls: { glb: "https://example.invalid/model.glb", obj: "https://example.invalid/model.obj", mtl: "https://example.invalid/model.mtl" },
    texture_urls: [{ base_color: "https://example.invalid/texture_0.png" }],
    depth_map_url: "https://example.invalid/depth.png",
    thumbnail_url: "https://example.invalid/preview.png",
  });
  const depthOnly = () => ({ ...RELIEF_DONE, id: "d", model_urls: {}, depth_map_url: "https://example.invalid/depth.png", thumbnail_url: "" });
  const h = createHarness(registerTaskTools, {
    "/openapi/v1/relief/r": colored,
    "/openapi/v1/relief/d": depthOnly,
    "/openapi/v1/relief": [colored(), depthOnly()],
  });
  for (const wait of [false, true]) {
    const result = await h.run("meshy_get_task_status", { task_id: "r", task_type: "relief", wait });
    const out = JSON.parse(JSON.stringify(result.structuredContent));
    assert.equal(out.task_type, "relief", JSON.stringify(result));
    assert.equal(out.depth_map_url, "https://example.invalid/depth.png");
    assert.equal(out.model_urls.glb, "https://example.invalid/model.glb");
    assert.equal(TaskStatusOutputSchema.strict().safeParse(out).success, true, JSON.stringify(out));
    assert.match(result.content[0].text, /Depth [Mm]ap/);
    // A colored relief's texture comes back whatever formats it made.
    assert.deepEqual(out.texture_urls, [{ base_color: "https://example.invalid/texture_0.png" }]);
    assert.match(result.content[0].text, /texture_0\.png/);

    const only = await h.run("meshy_get_task_status", { task_id: "d", task_type: "relief", wait });
    assert.equal(only.structuredContent.model_urls, undefined);
    assert.equal(only.structuredContent.thumbnail_url, undefined);
    assert.equal(only.structuredContent.depth_map_url, "https://example.invalid/depth.png");
    assert.match(only.content[0].text, wait ? /Depth map only/ : /Available Formats\*\*: none/);
  }
  assert.match((await h.run("meshy_get_task_status", { task_id: "r", task_type: "relief" })).content[0].text, /Color: GLB, OBJ, FBX and USDZ/);

  const listed = await h.run("meshy_list_tasks", { task_type: "relief" });
  assert.deepEqual(h.gets.at(-1), { path: "/openapi/v1/relief", query: { page_size: 20, page_num: 1, sort_by: "-created_at" } });
  assert.deepEqual(listed.structuredContent.tasks.map((t) => [t.id, t.task_type]), [["r", "relief"], ["d", "relief"]]);

  const pending = createHarness(registerTaskTools, { "/openapi/v1/relief/p": () => ({ id: "p", type: "relief", status: "PENDING" }) });
  const deleted = await pending.run("meshy_cancel_task", { task_id: "p", task_type: "relief" });
  assert.deepEqual(pending.deletes, ["/openapi/v1/relief/p"]);
  assert.match(deleted.structuredContent.message, /refunded/);
});

test("relief download saves the model, its depth map and, for OBJ, a folder holding its material and texture", async () => {
  const { createServer } = await import("node:http");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const files = {
    "/model.obj": "mtllib model.mtl\nusemtl m\nv 0 0 0\n",
    "/model.mtl": "newmtl m\nmap_Kd texture_0.png\n",
  };
  const server = createServer((req, res) => {
    if (req.url === "/unavailable.obj") {
      res.statusCode = 503;
      return res.end("unavailable");
    }
    if (req.url === "/cut.stl") {
      // The connection drops partway through the body.
      res.writeHead(200, { "content-length": "1000" });
      res.write("partial");
      return setTimeout(() => res.destroy(), 10);
    }
    res.end(files[req.url] ?? req.url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meshy-relief-dl-"));
  const cwd = process.cwd();
  const read = (file) => fs.readFileSync(file, "utf-8");
  try {
    const relief = () => ({
      ...RELIEF_DONE,
      model_urls: { glb: `${base}/model.glb`, stl: `${base}/model.stl`, obj: `${base}/model.obj`, mtl: `${base}/model.mtl` },
      texture_urls: [{ base_color: `${base}/texture_0.png` }],
      depth_map_url: `${base}/depth.png`,
      thumbnail_url: `${base}/preview.png`,
    });
    const h = createHarness(registerTaskTools, { "/openapi/v1/relief/r": relief });

    // GLB by default: the depth map lands next to it.
    const glb = await h.run("meshy_download_model", { task_id: "r", task_type: "relief", save_to: path.join(dir, "plaque.glb") });
    assert.notEqual(glb.isError, true, JSON.stringify(glb));
    assert.equal(glb.structuredContent.format, "glb");
    assert.equal(read(path.join(dir, "plaque.glb")), "/model.glb");
    assert.equal(glb.structuredContent.depth_map_path, path.join(dir, "plaque_depth.png"));
    assert.equal(read(path.join(dir, "plaque_depth.png")), "/depth.png");

    // OBJ: the OBJ, its MTL and its texture go into a folder of their own named after the model,
    // under the names the OBJ and the MTL refer to, nothing rewritten; the depth map goes in too.
    const obj = await h.run("meshy_download_model", { task_id: "r", task_type: "relief", format: "obj", save_to: path.join(dir, "obj", "plaque.obj") });
    assert.notEqual(obj.isError, true, JSON.stringify(obj));
    const set = path.join(dir, "obj", "plaque");
    assert.equal(obj.structuredContent.local_path, path.join(set, "plaque.obj"));
    assert.equal(obj.structuredContent.mtl_path, path.join(set, "model.mtl"));
    assert.deepEqual(obj.structuredContent.texture_paths, [path.join(set, "texture_0.png")]);
    assert.equal(obj.structuredContent.depth_map_path, path.join(set, "plaque_depth.png"));
    assert.equal(read(path.join(set, "plaque.obj")), files["/model.obj"]);
    assert.equal(read(path.join(set, "model.mtl")), files["/model.mtl"]);
    assert.equal(read(path.join(set, "texture_0.png")), "/texture_0.png");
    assert.deepEqual(fs.readdirSync(path.join(dir, "obj")), ["plaque"]);
    // A second OBJ saved beside it gets its own folder; the first one's material is untouched.
    const other = await h.run("meshy_download_model", { task_id: "r", task_type: "relief", format: "obj", save_to: path.join(dir, "obj", "other.obj") });
    assert.notEqual(other.isError, true, JSON.stringify(other));
    assert.equal(other.structuredContent.mtl_path, path.join(dir, "obj", "other", "model.mtl"));
    assert.deepEqual(fs.readdirSync(path.join(dir, "obj")).sort(), ["other", "plaque"]);

    // STL stays white: no texture beside it.
    const stl = await h.run("meshy_download_model", { task_id: "r", task_type: "relief", format: "stl", save_to: path.join(dir, "stl", "plaque.stl") });
    assert.equal(stl.structuredContent.texture_paths, undefined, JSON.stringify(stl));
    assert.deepEqual(fs.readdirSync(path.join(dir, "stl")).sort(), ["plaque.stl", "plaque_depth.png"]);

    // The model's download fails: the depth map is still saved, and the reply hands out the URLs
    // of the model and of the companions it would have saved.
    const failing = createHarness(registerTaskTools, {
      "/openapi/v1/relief/f": () => ({ ...relief(), id: "f", model_urls: { obj: `${base}/unavailable.obj`, mtl: `${base}/model.mtl` } }),
    });
    const failed = await failing.run("meshy_download_model", { task_id: "f", task_type: "relief", format: "obj", save_to: path.join(dir, "failed", "plaque.obj") });
    assert.equal(failed.structuredContent.download_url, `${base}/unavailable.obj`, JSON.stringify(failed));
    assert.equal(failed.structuredContent.depth_map_path, path.join(dir, "failed", "plaque", "plaque_depth.png"));
    assert.deepEqual(failed.structuredContent.not_saved.map((n) => [n.file, n.url]),
      [["obj", `${base}/unavailable.obj`], ["mtl", `${base}/model.mtl`], ["base_color", `${base}/texture_0.png`]]);
    assert.deepEqual(fs.readdirSync(path.join(dir, "failed", "plaque")), ["plaque_depth.png"]);

    // The connection drops partway: no partial file is left, a file already at save_to keeps its
    // content, and the URL is handed out instead.
    const cutting = createHarness(registerTaskTools, {
      "/openapi/v1/relief/c": () => ({ ...relief(), id: "c", model_urls: { stl: `${base}/cut.stl` } }),
    });
    fs.mkdirSync(path.join(dir, "cut"));
    fs.writeFileSync(path.join(dir, "cut", "plaque.stl"), "the user's own file");
    const cut = await cutting.run("meshy_download_model", { task_id: "c", task_type: "relief", format: "stl", save_to: path.join(dir, "cut", "plaque.stl") });
    assert.equal(cut.structuredContent.download_url, `${base}/cut.stl`, JSON.stringify(cut));
    assert.deepEqual(fs.readdirSync(path.join(dir, "cut")).sort(), ["plaque.stl", "plaque_depth.png"]);
    assert.equal(read(path.join(dir, "cut", "plaque.stl")), "the user's own file");

    // A format the task was not made in: refused, naming the formats it has.
    const fbx = await h.run("meshy_download_model", { task_id: "r", task_type: "relief", format: "fbx", save_to: path.join(dir, "fbx", "plaque.fbx") });
    assert.equal(fbx.isError, true);
    assert.match(fbx.content[0].text, /no FBX file\. Its formats: glb, stl, obj\./);
    assert.match(fbx.content[0].text, /target_formats/);
    assert.equal(fs.existsSync(path.join(dir, "fbx")), false);

    // Depth-map-only task: the depth map alone, and the reply says so.
    const depthOnly = createHarness(registerTaskTools, {
      "/openapi/v1/relief/d": () => ({ ...RELIEF_DONE, id: "d", model_urls: {}, depth_map_url: `${base}/depth.png`, thumbnail_url: "" }),
    });
    const only = await depthOnly.run("meshy_download_model", { task_id: "d", task_type: "relief", format: "stl", save_to: path.join(dir, "only", "photo.stl") });
    assert.notEqual(only.isError, true, JSON.stringify(only));
    assert.equal(only.structuredContent.depth_map_only, true);
    assert.match(only.content[0].text, /depth map and no model, so format "stl" was not used/);
    assert.deepEqual(fs.readdirSync(path.join(dir, "only")), ["photo_depth.png"]);

    // Without save_to: the project folder, with relief-named files.
    process.chdir(dir);
    const managed = await h.run("meshy_download_model", { task_id: "r", task_type: "relief", format: "stl" });
    const project = managed.structuredContent.project_dir;
    assert.equal(managed.structuredContent.local_path, path.join(project, "relief.stl"));
    assert.equal(read(path.join(project, "relief_depth.png")), "/depth.png");
    const meta = JSON.parse(read(path.join(project, "metadata.json")));
    assert.deepEqual(meta.tasks.map((t) => [t.task_type, t.stage, t.files]), [["relief", "relief", ["relief.stl", "relief_depth.png"]]]);
  } finally {
    process.chdir(cwd);
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
