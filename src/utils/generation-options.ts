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
  const isSmartModel = isSmartTopologyModel(options.ai_model);
  const modelType = options.model_type ?? (isSmartModel ? ModelType.SMART_TOPOLOGY : ModelType.STANDARD);
  const model = options.ai_model ?? (modelType === ModelType.SMART_TOPOLOGY
    ? SmartTopologyModel.MESHY_T2 : AIModel.LATEST);
  const smartTopology = modelType === ModelType.SMART_TOPOLOGY;

  if (smartTopology && !isSmartTopologyModel(model)) {
    throw new RequestValidationError("Smart Topology requires ai_model meshy-t2 or meshy-t2.5.");
  }
  if (isSmartModel && !smartTopology) {
    throw new RequestValidationError("Smart Topology models require model_type smart-topology.");
  }
  if (smartTopology && endpoint === "multi-image") {
    throw new RequestValidationError("meshy-t2 / meshy-t2.5 Smart Topology is supported on text preview and single-image generation only.");
  }
  const maxFaces = SMART_TOPOLOGY_MAX_FACES[model];
  if (maxFaces !== undefined && options.target_polycount !== undefined && options.target_polycount > maxFaces) {
    throw new RequestValidationError(`${model} target_polycount must be between 100 and ${maxFaces.toLocaleString("en-US")} faces.`);
  }
  if (smartTopology && endpoint === "text" && options.topology === "quad") {
    throw new RequestValidationError("Smart Topology text preview accepts triangle topology only.");
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
      throw new RequestValidationError("Geometry resolution and Ultra require standard generation, not Smart Topology.");
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

const isSmartTopologyModel = (model?: string) =>
  (Object.values(SmartTopologyModel) as string[]).includes(model ?? "");

/** Smart Topology face ceilings; each model generates natively at target_polycount. */
const SMART_TOPOLOGY_MAX_FACES: Record<string, number> = {
  [SmartTopologyModel.MESHY_T2]: 15000,
  [SmartTopologyModel.MESHY_T2_5]: 30000
};

const isMeshy71 = (model?: string) => model === AIModel.MESHY_7_1 || model === AIModel.LATEST;

/** meshy-6-lite: 2K textures only. */
export const isLiteModel = (model?: string) => model === AIModel.MESHY_6_LITE;

/** 2K textures only: meshy-6-lite, and meshy-n1 (retexture only). */
const isTwoKTextureModel = (model?: string) => isLiteModel(model) || model === AIModel.MESHY_N1;

/** image_enhancement is honored on meshy-6, meshy-7.1 and latest. */
export const supportsImageEnhancement = (model?: string) => model === AIModel.MESHY_6 || isMeshy71(model);

/**
 * Rejects 4K/8K textures (and hd_texture) on a 2K-only model before posting. 4k/8k is a 400 from
 * the API too. hd_texture true beside an explicit texture_resolution "2k" is not: the API takes the
 * explicit resolution. Refusing it is this tool's own policy, stricter than the API on purpose,
 * since the caller asked for an HD texture the model cannot make.
 * `alternatives` names the models that endpoint takes for 4k/8k.
 */
export function checkTextureResolution(
  model: string | undefined,
  textureResolution?: string,
  hdTexture?: boolean,
  alternatives = "meshy-6, meshy-7.1 or latest"
) {
  if (isTwoKTextureModel(model) && ((textureResolution !== undefined && textureResolution !== "2k") || hdTexture)) {
    throw new RequestValidationError(`${model} supports 2k textures only. Use ${alternatives} for 4k/8k.`);
  }
}

/**
 * Meshy N1 on retexture textures from reference images alone and makes a base color texture
 * only. On meshy-n1 the API answers 400 for a text prompt with no image or beside views,
 * enable_pbr true, and remove_lighting with any value; a prompt beside one image (v1) it drops
 * without a word. This check refuses all of them, the dropped prompt included: stricter than the
 * API on purpose, so an agent never gets a texture made from less than it asked for. Called
 * before the generic one-style-input check, so a missing image is reported as N1 needing one
 * rather than as "pick one of text_style_prompt, ...". 4k/8k and hd_texture are
 * checkTextureResolution's.
 */
export function checkMeshyN1Retexture(params: {
  text_style_prompt?: string;
  image_style_url?: string;
  multiview_image_urls?: string[];
  enable_pbr?: boolean;
  remove_lighting?: boolean;
}) {
  if (!params.image_style_url && !params.multiview_image_urls?.length) {
    throw new RequestValidationError(
      "meshy-n1 needs a reference image: image_style_url (one view of the object, read as the front view) " +
      "or multiview_image_urls (1–4 views, front first). It takes no text_style_prompt; " +
      "for a texture described in words, use another ai_model."
    );
  }
  if (params.text_style_prompt) {
    throw new RequestValidationError(
      "meshy-n1 takes no text_style_prompt: it textures from the reference image(s) alone. " +
      "Drop text_style_prompt, or use another ai_model for a texture described in words."
    );
  }
  if (params.enable_pbr) {
    throw new RequestValidationError(
      "meshy-n1 makes a base color texture only, so enable_pbr must be false. Use another ai_model for PBR maps."
    );
  }
  if (params.remove_lighting !== undefined) {
    throw new RequestValidationError(
      "meshy-n1 takes no remove_lighting, true or false. Drop it, or use meshy-6 to remove baked lighting."
    );
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
