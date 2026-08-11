/**
 * TypeScript type definitions for Meshy API
 */

import {
  TaskStatus,
  TaskPhase,
  Topology,
  AIModel,
  ModelType,
  SymmetryMode,
  PoseMode
} from "./constants.js";

// Texture URLs can be an array of objects (text-to-3d) or a single object (image-to-3d/remesh)
export interface TextureUrlsObject {
  base_color?: string;
  metallic?: string;
  roughness?: string;
  normal?: string;
  ao?: string;
}

// Task Error (API returns as "task_error")
export interface TaskError {
  code?: string;
  message: string;
}

// API response for task creation (all endpoints return this shape)
export interface CreateTaskApiResponse {
  result: string;
}

// Text-to-3D API request body
export interface TextTo3DApiRequest {
  mode: string;
  prompt: string;
  ai_model: string;
  moderation: boolean;
  model_type?: string;
  target_polycount?: number;
  topology?: string;
  symmetry_mode?: string;
  should_remesh?: boolean;
  pose_mode?: string;
  decimation_mode?: number;
  target_formats?: string[];
  alpha_thumbnail?: boolean;
  auto_size?: boolean;
  origin_at?: string;
}

// Image-to-3D API request body
export interface ImageTo3DApiRequest {
  image_url?: string;
  input_task_id?: string;
  enable_pbr: boolean;
  moderation: boolean;
  ai_model?: string;
  ultra_mode?: boolean;
  model_type?: string;
  pose_mode?: string;
  topology?: string;
  target_polycount?: number;
  should_remesh?: boolean;
  symmetry_mode?: string;
  should_texture?: boolean;
  texture_prompt?: string;
  texture_image_url?: string;
  texture_resolution?: string;
  hd_texture?: boolean;
  image_enhancement?: boolean;
  remove_lighting?: boolean;
  save_pre_remeshed_model?: boolean;
  decimation_mode?: number;
  target_formats?: string[];
  alpha_thumbnail?: boolean;
  multi_view_thumbnails?: boolean;
  auto_size?: boolean;
  origin_at?: string;
}

// Text-to-3D Refine API request body
export interface TextTo3DRefineApiRequest {
  mode: string;
  preview_task_id: string;
  enable_pbr: boolean;
  ai_model: string;
  texture_prompt?: string;
  texture_image_url?: string;
  texture_resolution?: string;
  hd_texture?: boolean;
  remove_lighting?: boolean;
  target_formats?: string[];
  alpha_thumbnail?: boolean;
  auto_size?: boolean;
  origin_at?: string;
}

// Multi-Image-to-3D API request body
export interface MultiImageTo3DApiRequest {
  image_urls?: string[];
  input_task_id?: string;
  enable_pbr: boolean;
  moderation: boolean;
  ai_model?: string;
  model_type?: string;
  pose_mode?: string;
  topology?: string;
  target_polycount?: number;
  should_remesh?: boolean;
  symmetry_mode?: string;
  should_texture?: boolean;
  texture_prompt?: string;
  texture_image_url?: string;
  texture_resolution?: string;
  hd_texture?: boolean;
  image_enhancement?: boolean;
  remove_lighting?: boolean;
  save_pre_remeshed_model?: boolean;
  decimation_mode?: number;
  target_formats?: string[];
  alpha_thumbnail?: boolean;
  multi_view_thumbnails?: boolean;
  auto_size?: boolean;
  origin_at?: string;
}

// Remesh API request body
export interface RemeshApiRequest {
  target_formats: string[];
  resize_height: number;
  convert_format_only: boolean;
  input_task_id?: string;
  model_url?: string;
  topology?: string;
  target_polycount?: number;
  origin_at?: string;
  decimation_mode?: number;
  resize_longest_side?: number;
  auto_size?: boolean;
}

// Retexture API request body
export interface RetextureApiRequest {
  enable_original_uv: boolean;
  enable_pbr: boolean;
  input_task_id?: string;
  model_url?: string;
  text_style_prompt?: string;
  image_style_url?: string;
  multiview_image_urls?: string[];
  ai_model?: string;
  texture_resolution?: string;
  hd_texture?: boolean;
  remove_lighting?: boolean;
  target_formats?: string[];
  alpha_thumbnail?: boolean;
}

// Convert API request body (POST /openapi/v1/convert) — exactly one of input_task_id / model_url
export interface ConvertApiRequest {
  target_formats: string[];
  input_task_id?: string;
  model_url?: string;
}

// Resize API request body (POST /openapi/v1/resize) — exactly one of input_task_id / model_url,
// and exactly one resize mode (resize_height / resize_longest_side / auto_size).
export interface ResizeApiRequest {
  input_task_id?: string;
  model_url?: string;
  resize_height?: number;
  resize_longest_side?: number;
  auto_size?: boolean;
  origin_at?: string;
}

// UV Unwrap API request body (POST /openapi/v1/uv-unwrap) — exactly one of input_task_id / model_url (GLB only)
export interface UvUnwrapApiRequest {
  input_task_id?: string;
  model_url?: string;
}

// Creative Lab API request bodies (POST /openapi/creative-lab/<product>/v1/{prototype|build})
export interface CreativeLabPrototypeApiRequest {
  image_url?: string;
  text?: string;
  image_subject?: string;
  name?: string;
}

export interface CreativeLabBuildApiRequest {
  input_task_id: string;
  name?: string;
  // Keycap only: the build stage picks one of the prototype's candidates and
  // accepts an options object. Every other product ignores these.
  candidate_id?: string;
  options?: {
    base_model?: string;
    head_size_mm?: number;
  };
}

// Rig API request body
export interface RigApiRequest {
  height_meters: number;
  input_task_id?: string;
  model_url?: string;
  texture_image_url?: string;
}

// Animate API request body
export interface AnimateApiRequest {
  rig_task_id: string;
  action_id: number;
  post_process?: {
    operation_type: string;
    fps?: number;
  };
}

// Multi-Color Print API request body (POST /openapi/v1/print/multi-color)
// Provide exactly one of input_task_id / model_url.
export interface MultiColorPrintApiRequest {
  input_task_id?: string;
  model_url?: string;
  max_colors?: number;
  max_depth?: number;
}

// Analyze Printability API request body (POST /openapi/v1/print/analyze)
// Provide exactly one of input_task_id / model_url.
export interface AnalyzePrintabilityApiRequest {
  input_task_id?: string;
  model_url?: string;
}

// Repair Printability API request body (POST /openapi/v1/print/repair)
// Provide exactly one of input_task_id / model_url.
export interface RepairPrintabilityApiRequest {
  input_task_id?: string;
  model_url?: string;
}

// Printability evaluation result (returned by GET /openapi/v1/print/analyze/:id once SUCCEEDED)
export interface PrintabilityResult {
  _version: string;
  status: "healthy" | "warning" | "error" | "unknown";
  issue_count: number;
  error_count: number;
  warning_count: number;
  metrics: {
    is_watertight: boolean;
    volume: number;
    non_manifold_edges: number;
    degenerate_faces: number;
    holes: number;
  };
  evaluated_at: number;
}

// Text-to-Image API request body
export interface TextToImageApiRequest {
  ai_model: string;
  prompt: string;
  generate_multi_view: boolean;
  aspect_ratio: string;
  pose_mode?: string;
}

// Image-to-Image API request body
export interface ImageToImageApiRequest {
  ai_model: string;
  prompt: string;
  reference_image_urls: string[];
  generate_multi_view: boolean;
}

// Task Model — matches the flat structure returned by Meshy API
export interface Task {
  id: string;
  name?: string;
  type?: string;
  status: TaskStatus;
  phase: TaskPhase;
  progress: number;
  created_at: string | number;
  started_at?: string | number;
  updated_at?: string;
  finished_at?: string | number;

  // These are top-level in the API response, NOT nested under "result"
  model_urls?: {
    glb?: string;
    fbx?: string;
    usdz?: string;
    obj?: string;
    mtl?: string;
    blend?: string;
    stl?: string;
    "3mf"?: string;
  };

  // Populated only on print-analyze tasks once SUCCEEDED
  printability?: PrintabilityResult;
  thumbnail_url?: string;
  alpha_thumbnail_url?: string;
  // Image-generation tasks (text-to-image / image-to-image) return their result here, not in model_urls.
  image_urls?: string[];
  texture_urls?: TextureUrlsObject[] | TextureUrlsObject;
  video_url?: string;
  // Credits consumed by this task (present on most GET responses; 0 for FAILED tasks)
  consumed_credits?: number;
  vertex_count?: number;
  face_count?: number;
  aabb?: {
    min: [number, number, number];
    max: [number, number, number];
  };

  prompt?: string;
  preceding_tasks?: number;
  task_error?: TaskError;
  is_published?: boolean;

  // Rigging tasks use a nested "result" with different URL fields
  result?: {
    rigged_character_glb_url?: string;
    rigged_character_fbx_url?: string;
    basic_animations?: {
      walking_glb_url?: string;
      walking_fbx_url?: string;
      walking_armature_glb_url?: string;
      running_glb_url?: string;
      running_fbx_url?: string;
      running_armature_glb_url?: string;
    };
    // Animation tasks
    animation_glb_url?: string;
    animation_fbx_url?: string;
    processed_usdz_url?: string;
    processed_armature_fbx_url?: string;
    processed_animation_fps_fbx_url?: string;
  };
}

// Text-to-3D Arguments
export interface TextTo3DArgs {
  prompt: string;
  ai_model: AIModel;
  model_type?: ModelType;
  topology?: Topology;
  target_polycount?: number;
  symmetry_mode?: SymmetryMode;
  should_remesh?: boolean;
  pose_mode?: PoseMode;
}

// Image-to-3D Arguments
export interface ImageTo3DArgs {
  image_url: string;
  ai_model?: AIModel;
  model_type?: ModelType;
  pose_mode?: PoseMode;
  enable_pbr: boolean;
  topology?: Topology;
  target_polycount?: number;
  should_remesh?: boolean;
  symmetry_mode?: SymmetryMode;
  should_texture?: boolean;
  texture_prompt?: string;
  texture_image_url?: string;
  image_enhancement?: boolean;
  remove_lighting?: boolean;
  save_pre_remeshed_model?: boolean;
}

// API Request/Response Types
export interface CreateTaskRequest {
  mode: string;
  args: TextTo3DArgs | ImageTo3DArgs;
}

export interface CreateTaskResponse {
  id: string;
  status: TaskStatus;
  created_at: string;
}

export interface GetTaskResponse extends Task {}

export interface ListTasksResponse {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

// Pagination
export interface PaginationParams {
  limit: number;
  offset: number;
}

// Balance
export interface BalanceResponse {
  balance: number;
}

export interface PaginatedResponse<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}

// Model Summary (for listing)
export interface ModelSummary {
  id: string;
  name: string;
  thumbnail_url: string;
  created_at: string | number;
  vertex_count?: number;
  face_count?: number;
  is_published: boolean;
}
