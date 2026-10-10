import { AIModel, ModelType, SmartTopologyModel } from "../constants.js";

/** A request the tool refuses locally; reported as-is, without recovery hints. */
export class RequestValidationError extends Error {}

type GenerationEndpoint = "text" | "image" | "multi-image";

interface GenerationOptions {
  ai_model?: string;
  model_type?: string;
  topology?: string;
  target_polycount?: number;
  geometry_resolution?: "standard" | "2k" | "4k";
  ultra_mode?: boolean;
}

export function resolveGenerationOptions(options: GenerationOptions, endpoint: GenerationEndpoint) {
  const isSmartModel = options.ai_model === SmartTopologyModel.MESHY_T1 ||
    options.ai_model === SmartTopologyModel.MESHY_T2;
  const modelType = options.model_type ?? (isSmartModel ? ModelType.SMART_TOPOLOGY : ModelType.STANDARD);
  const model = options.ai_model ?? (modelType === ModelType.SMART_TOPOLOGY
    ? SmartTopologyModel.MESHY_T2 : AIModel.LATEST);
  const smartTopology = modelType === ModelType.SMART_TOPOLOGY;

  if (smartTopology && model !== SmartTopologyModel.MESHY_T1 && model !== SmartTopologyModel.MESHY_T2) {
    throw new RequestValidationError("Smart Topology requires ai_model meshy-t2 (or legacy meshy-t1 on single-image generation).");
  }
  if (isSmartModel && !smartTopology) {
    throw new RequestValidationError("Smart Topology models require model_type smart-topology.");
  }
  if (smartTopology && (endpoint === "multi-image" || (endpoint === "text" && model !== SmartTopologyModel.MESHY_T2))) {
    throw new RequestValidationError("T2 Smart Topology is supported on text preview and single-image generation only.");
  }
  if (model === SmartTopologyModel.MESHY_T2 && options.target_polycount !== undefined && options.target_polycount > 15000) {
    throw new RequestValidationError("T2 target_polycount must be between 100 and 15,000 faces.");
  }
  if (smartTopology && endpoint === "text" && options.topology === "quad") {
    throw new RequestValidationError("T2 text preview accepts triangle topology only.");
  }
  if (modelType === ModelType.LOWPOLY && isLiteModel(model)) {
    throw new RequestValidationError("meshy-6-lite does not support model_type lowpoly. Use model_type smart-topology with ai_model meshy-t2 instead.");
  }
  if (options.ultra_mode && options.geometry_resolution !== undefined && options.geometry_resolution !== "2k") {
    throw new RequestValidationError("ultra_mode true conflicts with geometry_resolution; use 2k or omit the deprecated flag.");
  }

  // Preserve the pre-7.1 single-image Ultra request for legacy callers.
  const legacyUltra = options.ultra_mode && model === AIModel.MESHY_7 &&
    endpoint === "image" && options.geometry_resolution === undefined;
  const requestedResolution = options.geometry_resolution ?? (options.ultra_mode && !legacyUltra ? "2k" : undefined);
  // "standard" is the API default, so it only needs forwarding on models that take the field.
  const geometryResolution = requestedResolution === "standard" && !isMeshy71(model)
    ? undefined : requestedResolution;
  if ((geometryResolution !== undefined && geometryResolution !== "standard") || legacyUltra) {
    if (modelType !== ModelType.STANDARD) {
      throw new RequestValidationError("Geometry resolution and Ultra require standard generation, not Smart Topology or lowpoly.");
    }
    if (!legacyUltra && !isMeshy71(model)) {
      throw new RequestValidationError("geometry_resolution requires ai_model meshy-7.1 or latest.");
    }
    if (endpoint === "multi-image" && geometryResolution === "4k") {
      throw new RequestValidationError("Multi-image geometry_resolution supports standard or 2k only.");
    }
  }

  return {
    ai_model: model,
    model_type: modelType,
    smartTopology,
    geometry_resolution: geometryResolution,
    ultra_mode: legacyUltra ? true : undefined
  };
}

const isMeshy71 = (model?: string) => model === AIModel.MESHY_7_1 || model === AIModel.LATEST;

/** meshy-6-lite: 2K textures only. */
export const isLiteModel = (model?: string) => model === AIModel.MESHY_6_LITE;

/** image_enhancement is honored on meshy-6, meshy-7.1 and latest. */
export const supportsImageEnhancement = (model?: string) => model === AIModel.MESHY_6 || isMeshy71(model);

/** Rejects 4K/8K textures on the lite model instead of letting the API 400. */
export function checkTextureResolution(model: string | undefined, textureResolution?: string, hdTexture?: boolean) {
  if (isLiteModel(model) && ((textureResolution !== undefined && textureResolution !== "2k") || hdTexture)) {
    throw new RequestValidationError(`${model} supports 2k textures only. Use meshy-6, meshy-7.1 or latest for 4k/8k.`);
  }
}

/** Multi-view texture (texture_image_urls) on multi-image-to-3d. */
export function checkMultiViewTexture(model: string, params: {
  texture_image_urls?: string[];
  texture_image_url?: string;
  texture_prompt?: string;
  should_texture?: boolean;
}) {
  if (!params.texture_image_urls?.length) return;
  if (!isMeshy71(model)) {
    throw new RequestValidationError(`texture_image_urls requires ai_model meshy-7.1 or latest, but "${model}" was given.`);
  }
  if (params.texture_image_url || params.texture_prompt) {
    throw new RequestValidationError("texture_image_urls cannot be combined with texture_image_url or texture_prompt.");
  }
  if (params.should_texture === false) {
    throw new RequestValidationError("texture_image_urls requires should_texture true.");
  }
}
