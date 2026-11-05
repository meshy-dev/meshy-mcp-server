/**
 * The "choose models by project" guide (PRO-4335, C2): the geometry ai_model + texture_model pair
 * the Models page recommends per project. One source for the image / multi-image tool descriptions
 * and the server instructions, so the wording is identical everywhere. Wording changes go through
 * the Models page (https://docs.meshy.ai/en/api/models, "Choose by project") first.
 */

export const MODELS_DOC_URL = "https://docs.meshy.ai/en/api/models";

export const MODEL_CHOICE_GUIDE = `Choose models by project (geometry ai_model + texture_model):
- Detailed hero asset, product render, cinematic prop: meshy-7.1 + meshy-7 (PBR, up to 8K)
- Game character to rig and animate: meshy-t2.5 (smart topology, set target_polycount) + meshy-n1
- Many props for a game scene, or user-generated content: meshy-t2 (smart topology) + meshy-n1
- A real object from 2 to 4 photos: meshy-7.1 on Multi-Image to 3D + meshy-7
- A model to 3D print: meshy-7.1 + none, or meshy-7 to print in color
- Many drafts at a low cost: meshy-6-lite + meshy-6-lite
More: ${MODELS_DOC_URL}`;
