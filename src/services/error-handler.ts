/**
 * Centralized error handling for Meshy API
 */

import { AxiosError } from "axios";
import { ErrorCode } from "../constants.js";

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
 * Handle Meshy API errors and convert to user-friendly messages.
 * When context is provided, appends tool-specific recovery suggestions.
 */
export function handleMeshyError(error: unknown, context?: ErrorContext): string {
  // Handle Axios errors
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data as any;
      const errorCode = errorData?.error_code || errorData?.code;

      // Map specific error codes
      switch (errorCode) {
        case ErrorCode.INSUFFICIENT_CREDITS:
          return "Error: Insufficient credits. Use `meshy_check_balance` to check your balance. Upgrade at https://meshy.ai/pricing";

        case ErrorCode.TOO_MANY_PENDING_TASKS:
          return "Error: Too many pending tasks. Please wait for current tasks to complete or cancel some tasks.";

        case ErrorCode.INVALID_MODEL_NOT_SUPPORTED:
          return "Error: Model format not supported. Supported formats: GLB, FBX, USDZ, 3MF";

        case ErrorCode.INVALID_MODEL_INVALID_FORMAT:
          return "Error: Model file is corrupted or invalid. Please try generating again.";

        case ErrorCode.LIMIT_EXCEEDED:
          return "Error: Rate limit exceeded. Please wait a moment before making more requests.";

        case ErrorCode.FORBIDDEN:
          return "Error: Permission denied. Please check your API key has the required permissions.";

        case ErrorCode.NOT_FOUND:
          return "Error: Resource not found. Please verify the task ID is correct.";

        case ErrorCode.INTERNAL_ERROR:
          return "Error: Meshy service error. Please try again later.";
      }

      // Handle HTTP status codes
      switch (status) {
        case 400:
          return `Error: Invalid request. ${errorData?.message || "Please check your parameters."}`;

        case 401:
          return "Error: Authentication failed. Please check your MESHY_API_KEY is valid.";

        case 403:
          return "Error: Permission denied. Your API key may not have access to this resource.";

        case 404:
          return "Error: Resource not found. Please check the ID is correct.";

        case 429:
          return "Error: Rate limit exceeded. Please wait before making more requests.";

        case 500:
        case 502:
        case 503:
          return "Error: Meshy service is temporarily unavailable. Please try again later.";

        default:
          return `Error: API request failed with status ${status}. ${errorData?.message || ""}`;
      }
    }

    // Handle network errors
    if (error.code === "ECONNABORTED") {
      return "Error: Request timed out. Please check your network connection and try again.";
    }

    if (error.code === "ENOTFOUND") {
      return "Error: Cannot reach Meshy API. Please check your internet connection.";
    }

    if (error.code === "ECONNREFUSED") {
      return "Error: Meshy API is unavailable. Please try again later.";
    }

    return `Error: Network error occurred. ${error.message}`;
  }

  // Handle generic errors
  let baseMessage: string;
  if (error instanceof Error) {
    baseMessage = `Error: ${error.message}`;
  } else {
    baseMessage = `Error: An unexpected error occurred. ${String(error)}`;
  }

  // Append context-aware suggestions if context is provided
  return appendContextSuggestions(baseMessage, error, context);
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
    return message + `\n\n**Fix**: The input model must have textures. Run \`meshy_text_to_3d_refine\` or \`meshy_retexture\` first to add textures, then use the resulting task ID as input_task_id.`;
  }

  // Insufficient credits
  if (errorText.includes("insufficient") || errorText.includes("credit")) {
    return message + `\n\n**Fix**: Check your credit balance at https://meshy.ai/pricing. Current tool: ${tool}.`;
  }

  return message;
}

/**
 * Check if error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof AxiosError) {
    return error.response?.status === 429;
  }
  return false;
}

/**
 * Check if error is a network error that should be retried
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AxiosError) {
    // Retry on network errors
    if (!error.response) {
      return true;
    }

    // Retry on 5xx server errors
    const status = error.response.status;
    return status >= 500 && status < 600;
  }
  return false;
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
