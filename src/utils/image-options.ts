import { AspectRatio, TextToImageModel } from "../constants.js";
import { RequestValidationError } from "./generation-options.js";

/** GPT Image models of any generation: the ones that take every aspect ratio. */
const GPT_IMAGE_MODELS: readonly string[] = [
  TextToImageModel.GPT_IMAGE_2,
  TextToImageModel.GPT_IMAGE_2_5_FLARE,
  TextToImageModel.GPT_IMAGE_2_5_SUNBURST
];

/** The nano-banana family takes these five; 3:2 and 2:3 are GPT Image only. */
const NANO_BANANA_RATIOS: readonly string[] = [
  AspectRatio.SQUARE,
  AspectRatio.WIDESCREEN,
  AspectRatio.PORTRAIT,
  AspectRatio.STANDARD,
  AspectRatio.PORTRAIT_STANDARD
];

const isGptImageModel = (model: string) => GPT_IMAGE_MODELS.includes(model);

/** Refuses an aspect ratio the model cannot take, before any request or charge. */
export function checkImageAspectRatio(model: string, aspectRatio?: string) {
  if (!aspectRatio || isGptImageModel(model) || NANO_BANANA_RATIOS.includes(aspectRatio)) return;
  throw new RequestValidationError(
    `aspect_ratio ${aspectRatio} is only supported by the GPT Image models (${GPT_IMAGE_MODELS.join(", ")}); ` +
    `${model} takes ${NANO_BANANA_RATIOS.join(", ")}.`
  );
}

/**
 * The API renders an a-pose / t-pose on a nano-banana model at 3:4 whatever aspect_ratio was
 * asked, without saying so (GPT Image models keep the ratio). The request still goes out; this
 * is the note that says what will come back. It also covers the 1:1 default.
 */
export function poseAspectRatioNote(model: string, poseMode?: string, aspectRatio?: string): string | undefined {
  if (!poseMode || isGptImageModel(model) || aspectRatio === AspectRatio.PORTRAIT_STANDARD) return undefined;
  const asked = aspectRatio ? `aspect_ratio ${aspectRatio} is not used` : "the image will not be 1:1";
  return `Note: ${model} renders a ${poseMode} image at 3:4, so ${asked}; the GPT Image models keep the ratio.`;
}
