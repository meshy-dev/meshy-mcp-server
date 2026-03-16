/**
 * Zod schema for balance tool
 */

import { z } from "zod";
import { ResponseFormatSchema } from "./common.js";

export const CheckBalanceInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();
