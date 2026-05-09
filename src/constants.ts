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
export enum AIModel {
  MESHY_5 = "meshy-5",
  MESHY_6 = "meshy-6",
  LATEST = "latest"
}

// Model Types
export enum ModelType {
  STANDARD = "standard",
  LOWPOLY = "lowpoly"
}

// Symmetry Modes
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
  MULTI_COLOR_PRINT = "multi-color-print",
  PRINT_ANALYZE = "print-analyze",
  PRINT_REPAIR = "print-repair"
}

// Remesh Output Formats
export enum RemeshFormat {
  GLB = "glb",
  FBX = "fbx",
  OBJ = "obj",
  USDZ = "usdz",
  BLEND = "blend",
  STL = "stl"
}

// Origin At (for remesh)
export enum OriginAt {
  BOTTOM = "bottom",
  CENTER = "center"
}

// Text-to-Image Models
export enum TextToImageModel {
  NANO_BANANA = "nano-banana",
  NANO_BANANA_PRO = "nano-banana-pro"
}

// Aspect Ratios
export enum AspectRatio {
  SQUARE = "1:1",
  WIDESCREEN = "16:9",
  PORTRAIT = "9:16",
  STANDARD = "4:3",
  PORTRAIT_STANDARD = "3:4"
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
