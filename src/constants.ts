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
export enum TaskType {
  TEXT_TO_3D = "text-to-3d",
  IMAGE_TO_3D = "image-to-3d",
  MULTI_IMAGE_TO_3D = "multi-image-to-3d",
  REMESH = "remesh",
  RETEXTURE = "retexture",
  RIGGING = "rigging",
  ANIMATION = "animation",
  TEXT_TO_IMAGE = "text-to-image",
  IMAGE_TO_IMAGE = "image-to-image"
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

// Slicer Types (only Bambu Studio is supported via URL scheme in agent/skill mode;
// for other slicers, visit meshy.ai webapp for one-click send)
export enum SlicerType {
  BAMBU = "bambu"
}

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
export const POLL_DEFAULT_TIMEOUT = 180000; // 3 minutes
export const POLL_MAX_TIMEOUT = 300000; // 5 minutes

// Rigging Constraints
export const RIGGING_MAX_FACES = 300000;
