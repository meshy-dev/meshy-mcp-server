/**
 * Constants for Meshy MCP Server
 */

// API Configuration
export const API_BASE_URL = process.env.MESHY_API_HOST || "https://api.meshy.ai";
export const CHARACTER_LIMIT = parseInt(process.env.CHARACTER_LIMIT || "25000", 10);

// Response Formats
export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

// Task Status
export enum TaskStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  CANCELED = "CANCELED"
}

// Task Phases
export enum TaskPhase {
  DRAFT = "draft",
  GENERATE = "generate",
  TEXTURE = "texture",
  STYLIZE = "stylize",
  ANIMATE = "animate"
}

// Topology Types
export enum Topology {
  QUAD = "quad",
  TRIANGLE = "triangle"
}

// Model Formats
export enum ModelFormat {
  GLB = "glb",
  FBX = "fbx",
  USDZ = "usdz",
  THREE_MF = "3mf"
}

// AI Models
//
// Generation endpoints (text / image / multi-image) take meshy-6-lite, meshy-6,
// meshy-7.1 and latest (= Meshy 7.1). Retexture takes meshy-6-lite, meshy-6,
// meshy-7 and latest (= Meshy 7) — no meshy-7.1 there. meshy-7 is deprecated on
// generation (use meshy-7.1). Keep endpoint-specific restrictions in each
// schema.
export enum AIModel {
  MESHY_6_LITE = "meshy-6-lite",
  MESHY_6 = "meshy-6",
  MESHY_7 = "meshy-7",
  MESHY_7_1 = "meshy-7.1",
  LATEST = "latest"
}

// Smart Topology models — selected via model_type: "smart-topology" on
// image-to-3d or text preview (T2 only). meshy-t2 adds native part separation with a
// configurable target_polycount; meshy-t1 is the previous generation.
export enum SmartTopologyModel {
  MESHY_T1 = "meshy-t1",
  MESHY_T2 = "meshy-t2"
}

// Model Types
// 'lowpoly' is deprecated by the API in favour of 'smart-topology'.
export enum ModelType {
  STANDARD = "standard",
  SMART_TOPOLOGY = "smart-topology",
  LOWPOLY = "lowpoly"
}

// Texture Resolution (replaces the deprecated hd_texture boolean).
// hd_texture: true is exactly equivalent to texture_resolution: "4k".
export enum TextureResolution {
  TWO_K = "2k",
  FOUR_K = "4k",
  EIGHT_K = "8k"
}

// Symmetry Modes
// DEPRECATED (API change 2026-05-11): symmetry_mode no longer affects output. Kept for
// backward compatibility only; tool schemas describe it as deprecated.
export enum SymmetryMode {
  OFF = "off",
  AUTO = "auto",
  ON = "on"
}

// Pose Modes
export enum PoseMode {
  A_POSE = "a-pose",
  T_POSE = "t-pose"
}

// Task Types
//
// Note on multi-color naming: the input string we accept ("multi-color-print")
// is the convention used by this server's tools. The Meshy API itself returns
// `type: "print-multi-color"` on the GET response. Auto-inference matches by
// endpoint URL, not by the response `type` field, so the asymmetry is harmless.
export enum TaskType {
  TEXT_TO_3D = "text-to-3d",
  IMAGE_TO_3D = "image-to-3d",
  MULTI_IMAGE_TO_3D = "multi-image-to-3d",
  REMESH = "remesh",
  RETEXTURE = "retexture",
  RIGGING = "rigging",
  ANIMATION = "animation",
  TEXT_TO_IMAGE = "text-to-image",
  IMAGE_TO_IMAGE = "image-to-image",
  CONVERT = "convert",
  RESIZE = "resize",
  UV_UNWRAP = "uv-unwrap",
  MULTI_COLOR_PRINT = "multi-color-print",
  PRINT_ANALYZE = "print-analyze",
  PRINT_REPAIR = "print-repair",
  // Creative Lab — each product carries its own /openapi/creative-lab/<product>/v1 line,
  // and GET/list/delete/stream are STAGE-SPECIFIC: .../v1/prototype/:id and .../v1/build/:id
  // (there is no .../v1/:id). So we need one task type per (product, stage) for correct routing.
  CREATIVE_LAB_FIGURE_PROTOTYPE = "creative-lab-figure-prototype",
  CREATIVE_LAB_FIGURE_BUILD = "creative-lab-figure-build",
  CREATIVE_LAB_LAMP_PROTOTYPE = "creative-lab-lamp-prototype",
  CREATIVE_LAB_LAMP_BUILD = "creative-lab-lamp-build",
  CREATIVE_LAB_KEYCHAIN_PROTOTYPE = "creative-lab-keychain-prototype",
  CREATIVE_LAB_KEYCHAIN_BUILD = "creative-lab-keychain-build",
  CREATIVE_LAB_FRIDGE_MAGNET_PROTOTYPE = "creative-lab-fridge-magnet-prototype",
  CREATIVE_LAB_FRIDGE_MAGNET_BUILD = "creative-lab-fridge-magnet-build",
  CREATIVE_LAB_VINYL_FIGURE_PROTOTYPE = "creative-lab-vinyl-figure-prototype",
  CREATIVE_LAB_VINYL_FIGURE_BUILD = "creative-lab-vinyl-figure-build",
  CREATIVE_LAB_BRICK_FIGURE_PROTOTYPE = "creative-lab-brick-figure-prototype",
  CREATIVE_LAB_BRICK_FIGURE_BUILD = "creative-lab-brick-figure-build",
  CREATIVE_LAB_KEYCAP_PROTOTYPE = "creative-lab-keycap-prototype",
  CREATIVE_LAB_KEYCAP_BUILD = "creative-lab-keycap-build"
}

// Creative Lab products exposed through the OpenAPI (7 of them; the webapp has more).
export enum CreativeLabProduct {
  FIGURE = "figure",
  LAMP = "lamp",
  KEYCHAIN = "keychain",
  FRIDGE_MAGNET = "fridge-magnet",
  VINYL_FIGURE = "vinyl-figure",
  BRICK_FIGURE = "brick-figure",
  KEYCAP = "keycap"
}

// Keycap base model — the only value the build stage accepts today (Cherry MX 1u).
export const KEYCAP_BASE_MODEL = "cherry-mx-1x1-r1";

// Remesh Output Formats
export enum RemeshFormat {
  GLB = "glb",
  FBX = "fbx",
  OBJ = "obj",
  USDZ = "usdz",
  BLEND = "blend",
  STL = "stl"
}

// Convert Output Formats (Convert API additionally supports 3mf vs Remesh)
export enum ConvertFormat {
  GLB = "glb",
  FBX = "fbx",
  OBJ = "obj",
  USDZ = "usdz",
  BLEND = "blend",
  STL = "stl",
  THREE_MF = "3mf"
}

// Origin At (for remesh)
export enum OriginAt {
  BOTTOM = "bottom",
  CENTER = "center"
}

// Text-to-Image / Image-to-Image Models
// Credits differ by model and by endpoint:
//   nano-banana: 3 | nano-banana-2: 6 | nano-banana-pro: 9
//   GPT Image models (gpt-image-2, gpt-image-2-5-flare, gpt-image-2-5-sunburst):
//   9 (text-to-image) / 12 (image-to-image).
export enum TextToImageModel {
  NANO_BANANA = "nano-banana",
  NANO_BANANA_2 = "nano-banana-2",
  NANO_BANANA_PRO = "nano-banana-pro",
  GPT_IMAGE_2 = "gpt-image-2",
  GPT_IMAGE_2_5_FLARE = "gpt-image-2-5-flare",
  GPT_IMAGE_2_5_SUNBURST = "gpt-image-2-5-sunburst"
}

// Aspect Ratios
// nano-banana / nano-banana-2 / nano-banana-pro accept 1:1, 16:9, 9:16, 4:3, 3:4.
// The GPT Image models accept all of those plus 3:2 and 2:3 (GPT-only).
export enum AspectRatio {
  SQUARE = "1:1",
  WIDESCREEN = "16:9",
  PORTRAIT = "9:16",
  STANDARD = "4:3",
  PORTRAIT_STANDARD = "3:4",
  LANDSCAPE_3_2 = "3:2",
  PORTRAIT_2_3 = "2:3"
}

// Slicer Types
export enum SlicerType {
  AUTO = "auto",
  BAMBU = "bambu",
  ORCASLICER = "orcaslicer",
  CREALITY_PRINT = "creality_print",
  ELEGOO_SLICER = "elegoo_slicer",
  ANYCUBIC_SLICER = "anycubic_slicer",
  PRUSASLICER = "prusaslicer",
  CURA = "cura"
}

// Slicers that support multi-color printing (AMS/MMU)
export const MULTICOLOR_CAPABLE_SLICERS: SlicerType[] = [
  SlicerType.ORCASLICER,
  SlicerType.BAMBU,
  SlicerType.CREALITY_PRINT,
  SlicerType.ELEGOO_SLICER,
  SlicerType.ANYCUBIC_SLICER
];

// Multi-color processing credit cost
export const MULTI_COLOR_CREDITS = 10;
export const PRINT_REPAIR_CREDITS = 10;
export const PRINT_ANALYZE_CREDITS = 0;

// Post-processing credit costs
export const CONVERT_CREDITS = 1;
export const RESIZE_CREDITS = 1;
export const UV_UNWRAP_CREDITS = 5;

// Creative Lab credit costs (prototype + build). Most products are 6 + 30 = 36.
// Keycap is 12 + 50 = 62. Lamp is 30 + 6 = 36: its prototype builds the
// lampshade model and the build only adds the base plate.
export const CREATIVE_LAB_PROTOTYPE_CREDITS = 6;
export const CREATIVE_LAB_BUILD_CREDITS = 30;
export const CREATIVE_LAB_KEYCAP_PROTOTYPE_CREDITS = 12;
export const CREATIVE_LAB_KEYCAP_BUILD_CREDITS = 50;
export const CREATIVE_LAB_LAMP_PROTOTYPE_CREDITS = 30;
export const CREATIVE_LAB_LAMP_BUILD_CREDITS = 6;

/** Per-product (prototype, build) credit cost. */
export function creativeLabCredits(product: CreativeLabProduct): { prototype: number; build: number; total: number } {
  if (product === CreativeLabProduct.KEYCAP) {
    return { prototype: CREATIVE_LAB_KEYCAP_PROTOTYPE_CREDITS, build: CREATIVE_LAB_KEYCAP_BUILD_CREDITS, total: CREATIVE_LAB_KEYCAP_PROTOTYPE_CREDITS + CREATIVE_LAB_KEYCAP_BUILD_CREDITS };
  }
  if (product === CreativeLabProduct.LAMP) {
    return { prototype: CREATIVE_LAB_LAMP_PROTOTYPE_CREDITS, build: CREATIVE_LAB_LAMP_BUILD_CREDITS, total: CREATIVE_LAB_LAMP_PROTOTYPE_CREDITS + CREATIVE_LAB_LAMP_BUILD_CREDITS };
  }
  const prototype = CREATIVE_LAB_PROTOTYPE_CREDITS;
  const build = CREATIVE_LAB_BUILD_CREDITS;
  return { prototype, build, total: prototype + build };
}

// Texture credit costs — 8K is a premium tier, 2K/4K are flat.
export const TEXTURE_CREDITS = 10;
export const TEXTURE_8K_CREDITS = 15;

// Ultra geometry surcharge: geometry_resolution "2k" or "4k" (and the
// deprecated ultra_mode) on meshy-7.1 / latest.
export const ULTRA_MODE_SURCHARGE_CREDITS = 5;

// UV Unwrap face-count ceiling (oversized meshes are rejected with a 400 — remesh first)
export const UV_UNWRAP_MAX_FACES = 40000;

// Animation Post Process Operations
export enum AnimationPostProcessOp {
  CHANGE_FPS = "change_fps",
  FBX2USDZ = "fbx2usdz",
  EXTRACT_ARMATURE = "extract_armature"
}

// Error Codes
export enum ErrorCode {
  INSUFFICIENT_CREDITS = "InsufficientCredits",
  TOO_MANY_PENDING_TASKS = "TooManyPendingTasks",
  INVALID_MODEL_NOT_SUPPORTED = "InvalidModel:NotSupported",
  INVALID_MODEL_INVALID_FORMAT = "InvalidModel:InvalidFormat",
  LIMIT_EXCEEDED = "LimitExceeded",
  FORBIDDEN = "Forbidden",
  NOT_FOUND = "NotFound",
  INTERNAL_ERROR = "InternalError"
}

// Timeouts
export const API_TIMEOUT = 30000; // 30 seconds
export const RETRY_DELAYS = [2000, 4000, 8000]; // Exponential backoff
export const MAX_RETRIES = 3;

// Polling Configuration (for meshy_get_task_status wait mode)
export const POLL_INITIAL_DELAY = 5000; // 5 seconds
export const POLL_MAX_DELAY = 30000; // 30 seconds
export const POLL_BACKOFF_FACTOR = 1.5;
export const POLL_FINALIZATION_DELAY = 15000; // 15s when progress >= 95%
export const POLL_DEFAULT_TIMEOUT = 300000; // 5 minutes
export const POLL_MAX_TIMEOUT = 300000; // 5 minutes

// Rigging Constraints
export const RIGGING_MAX_FACES = 300000;
