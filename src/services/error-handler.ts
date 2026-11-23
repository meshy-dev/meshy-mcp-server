/**
 * Centralized error handling for Meshy API
 */

import { AxiosError } from "axios";
import { CREDITS_UPGRADE_HINT, MAX_RETRIES, MAX_RETRY_AFTER_MS, RETRY_DELAYS } from "../constants.js";
import { RequestValidationError } from "../utils/generation-options.js";

export interface MeshyError {
  code: string;
  message: string;
  status?: number;
}

/**
 * Optional context for richer error messages
 */
export interface ErrorContext {
  tool?: string;
  taskId?: string;
}

/**
 * MESHY_API_KEY is missing or was rejected by the API (401).
 *
 * The server stays up when the key is bad: every tool returns this message
 * instead, so the user sees it in the chat. Exiting would make MCP hosts
 * restart the server in a loop (ENG-3924).
 */
export class MeshyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeshyAuthError";
  }
}

export const MISSING_API_KEY_MESSAGE =
  "MESHY_API_KEY environment variable is required. Put it in the \"env\" block of your " +
  "MCP client config (not in \"args\"), then restart the Meshy MCP server. " +
  "Get your API key from https://www.meshy.ai/developers/keys";

export const INVALID_API_KEY_MESSAGE =
  "Authentication failed: the Meshy API rejected MESHY_API_KEY (401). The key is mistyped, " +
  "revoked or expired. Create a new key at https://www.meshy.ai/developers/keys, update the " +
  "MCP client config, then restart the Meshy MCP server.";

/**
 * Handle Meshy API errors and convert to user-friendly messages.
 * When context is provided, appends tool-specific recovery suggestions.
 */
export function handleMeshyError(error: unknown, context?: ErrorContext): string {
  if (error instanceof MeshyAuthError) {
    return `Error: ${error.message}`;
  }

  // Handle Axios errors
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data as any;
      const tool = context?.tool;

      // Handle HTTP status codes
      switch (status) {
        case 400: {
          let hint = "";
          if (tool === "meshy_uv_unwrap") {
            hint = " For UV Unwrap, the source must be a GLB with ≤40,000 faces — run `meshy_remesh` with a lower target_polycount first if the mesh is too dense.";
          }
          return `Error: Invalid request. ${errorData?.message || "Please check your parameters."}${hint}`;
        }

        case 401:
          return `Error: ${INVALID_API_KEY_MESSAGE}`;

        case 402: {
          const detail = String(errorData?.message || "Insufficient funds").replace(/\.?$/, ".");
          // Some API answers link the subscription page already: never show two links.
          const upgrade = /https?:\/\//.test(detail) ? "" : ` ${CREDITS_UPGRADE_HINT}`;
          return `Error: Payment required (402). ${detail} Check the balance with \`meshy_check_balance\`.${upgrade}`;
        }

        case 403: {
          const hint = tool === "meshy_list_usage"
            ? " The Usage API is available only to API keys on a Studio or Enterprise team."
            : "";
          const detail = String(errorData?.message || "Your API key may not have access to this resource.").replace(/\.?$/, ".");
          return `Error: Permission denied (403). ${detail}${hint}`;
        }

        case 404: {
          if (tool === "meshy_uv_unwrap") {
            return "Error: UV Unwrap could not find that resource, or the service is temporarily unavailable. Verify the input_task_id / model_url is correct and points to a GLB, then try again — or contact Meshy support if it persists.";
          }
          if (tool === "meshy_creative_lab") {
            return "Error: Creative Lab resource not found. The product may not be available for your account/plan, or the task expired — verify the product and try again, or contact Meshy support.";
          }
          return `Error: Not found (404). ${errorData?.message || "Check that the ID is correct."}`;
        }

        case 409:
          // e.g. DELETE of a task that is already IN_PROGRESS.
          return `Error: Conflict (409). ${String(errorData?.message || "The task's current state does not allow this operation.").replace(/\.?$/, ".")} ` +
            "A running task cannot be stopped and its credits are already spent. Once it finishes, delete it only " +
            "if the user wants the result gone (permanent, no refund, needs confirm_delete: true).";

        case 429:
          if (isQueueFullError(error)) {
            return `Error: Your task queue is full. ${errorData.message} Wait for one of your running tasks to finish before creating another (\`meshy_list_tasks\` with status IN_PROGRESS; its default covers generation and image tasks only, so pass task_types for printing, rigging, animation, motion, post-processing or Creative Lab tasks); retrying right away will not help.`;
          }
          return `Error: Rate limit exceeded (429). ${errorData?.message || ""} Wait a few seconds and try again.`;

        case 500:
        case 502:
        case 503:
          return `Error: Meshy service is temporarily unavailable (${status}).${createNote(error)}`;

        default:
          return `Error: API request failed with status ${status}. ${errorData?.message || ""}${createNote(error)}`;
      }
    }

    // Handle network errors
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return `Error: Request timed out.${createNote(error) || " Check your network connection and try again."}`;
    }

    if (error.code === "ENOTFOUND") {
      return "Error: Cannot reach Meshy API. Please check your internet connection.";
    }

    if (error.code === "ECONNREFUSED") {
      return "Error: Meshy API is unavailable. Please try again later.";
    }

    return `Error: Network error occurred. ${error.message}${createNote(error)}`;
  }

  // Handle generic errors
  if (error instanceof RequestValidationError) {
    return `Error: ${error.message}`;
  }
  let baseMessage: string;
  if (error instanceof Error) {
    baseMessage = `Error: ${error.message}`;
  } else {
    baseMessage = `Error: An unexpected error occurred. ${String(error)}`;
  }

  // Append context-aware suggestions if context is provided
  return appendContextSuggestions(baseMessage, error, context);
}

/** After an ambiguous create failure: tell the agent to look before it resends. */
function createNote(error: AxiosError): string {
  if (!createOutcomeUnknown(error)) return "";
  return " This create request was not retried automatically: it may still have created (and charged) the task. " +
    "Check `meshy_list_tasks` (with this task's task_type) for a new task before calling this tool again.";
}

/**
 * Append context-specific recovery suggestions to error messages
 */
function appendContextSuggestions(message: string, error: unknown, context?: ErrorContext): string {
  if (!context?.tool) return message;

  const errorText = message.toLowerCase();
  const tool = context.tool;

  // Rig + face limit
  if (tool === "meshy_rig" && (errorText.includes("face") || errorText.includes("300,000") || errorText.includes("300000") || errorText.includes("limit"))) {
    return message + `\n\n**Fix**: The model exceeds the 300K face limit for rigging. Call \`meshy_remesh\` with target_polycount 100000 first, then rig the remeshed output.`;
  }

  // Image-to-3D + image errors
  if ((tool === "meshy_image_to_3d" || tool === "meshy_multi_image_to_3d") && (errorText.includes("image") || errorText.includes("url"))) {
    return message + `\n\n**Fix**: For local images, use \`file_path\` parameter (absolute path like "/Users/me/photo.jpg"). The server handles encoding automatically. Do NOT manually base64-encode.`;
  }

  // Multi-color + missing texture
  if (tool === "meshy_process_multicolor" && (errorText.includes("texture") || errorText.includes("input") || errorText.includes("task"))) {
    return message + `\n\n**Fix**: The input model must have textures: use a textured image-to-3d / multi-image-to-3d task, or texture the model first with \`meshy_text_to_3d_refine\` or \`meshy_retexture\`, then pass that task ID as input_task_id.`;
  }

  // Insufficient credits — extra hint for the 10-credit print operations
  if (errorText.includes("insufficient") || errorText.includes("credit")) {
    const printToolHint = (tool === "meshy_repair_printability" || tool === "meshy_process_multicolor")
      ? ` This tool costs 10 credits per call; consider running \`meshy_analyze_printability\` (free) first to confirm the model needs repair before spending credits.`
      : "";
    return message + `\n\n**Fix**: Use \`meshy_check_balance\` to verify credits. ${CREDITS_UPGRADE_HINT} Current tool: ${tool}.${printToolHint}`;
  }

  // Analyze-printability + Meshy 6 / Preview model requirement
  if (tool === "meshy_analyze_printability" && (errorText.includes("404") || errorText.includes("not found") || errorText.includes("model older"))) {
    return message + `\n\n**Fix**: \`meshy_analyze_printability\` requires the upstream task to use Meshy 6 or newer (Meshy 7 / 7.1 included). Tasks generated with Meshy 4/5 are not supported — re-generate with \`ai_model: "latest"\` or pass a \`model_url\` directly instead.`;
  }

  return message;
}

function responseMessage(error: AxiosError): string {
  const data = error.response?.data as { message?: unknown } | undefined;
  return typeof data?.message === "string" ? data.message : "";
}

/**
 * A queue-full 429 (`NoMorePendingTasks`, or `NoMoreConcurrentTasks` when the
 * credits ran out): the account already runs its maximum of unfinished tasks.
 * It carries no Retry-After; only a task finishing frees a slot.
 */
export function isQueueFullError(error: unknown): boolean {
  return error instanceof AxiosError &&
    error.response?.status === 429 &&
    /^NoMore(Pending|Concurrent)Tasks/.test(responseMessage(error));
}

/** A Retry-After header value (delta-seconds, as the API sends it) in ms. */
export function parseRetryAfterMs(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function retryAfterMs(error: AxiosError): number | undefined {
  return parseRetryAfterMs(error.response?.headers?.["retry-after"]);
}

/**
 * A timeout, network error, 429 or 5xx. On a status check this says nothing
 * about the task, which keeps running (docs: task-lifecycle).
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof AxiosError)) return false;
  const status = error.response?.status;
  return status === undefined || status === 429 || status >= 500;
}

/** The request limiter's 429: refused before any handler ran, so nothing was created. */
function isRequestRateLimit(error: AxiosError): boolean {
  return error.response?.status === 429 &&
    (retryAfterMs(error) !== undefined || /rate limit exceeded/i.test(responseMessage(error)));
}

/** A POST that may have reached the handler: it can have created (and charged) a task. */
function createOutcomeUnknown(error: AxiosError): boolean {
  if (error.config?.method?.toUpperCase() !== "POST") return false;
  const status = error.response?.status;
  if (status !== undefined) return status >= 500;
  return error.code !== "ENOTFOUND" && error.code !== "ECONNREFUSED";
}

/**
 * Milliseconds to wait before retrying a failed request, or undefined to give up.
 *
 * GET and DELETE retry on a timeout, a network error, a 429 or a 5xx. A POST
 * creates a task and charges for it: after a timeout, a dropped connection or a
 * 5xx it may have gone through, and resending it would create and bill a second
 * task (docs: errors, "Best Practices"). So a POST only retries the request
 * limiter's 429, which is refused before anything is created — never a
 * queue-full 429, which only a finished task clears. Retry-After is honored
 * when present.
 */
export function retryDelayMs(method: string | undefined, error: unknown, attempt: number): number | undefined {
  if (attempt >= MAX_RETRIES || !(error instanceof AxiosError)) return undefined;
  const retryable = method?.toUpperCase() === "POST"
    ? isRequestRateLimit(error)
    : !isQueueFullError(error) && isTransientError(error);
  if (!retryable) return undefined;
  const hinted = retryAfterMs(error);
  if (hinted !== undefined) return hinted <= MAX_RETRY_AFTER_MS ? Math.max(hinted, 1000) : undefined;
  return RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
}

/**
 * Extract error message from various error formats
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError && error.response?.data) {
    const data = error.response.data as any;
    return data.message || data.error || data.error_message || "Unknown error";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
