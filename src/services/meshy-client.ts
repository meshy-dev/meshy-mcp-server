/**
 * Meshy API client with authentication and error handling
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import { API_BASE_URL, API_TIMEOUT, RETRY_DELAYS, MAX_RETRIES } from "../constants.js";
import {
  isRetryableError,
  isRateLimitError,
  MeshyAuthError,
  MISSING_API_KEY_MESSAGE,
  INVALID_API_KEY_MESSAGE
} from "./error-handler.js";
import { GetTaskResponse } from "../types.js";
import { USER_AGENT } from "../version.js";

export class MeshyClient {
  private client: AxiosInstance;
  private apiKey: string | undefined;
  // Set once the API answers 401. The key comes from the environment and cannot
  // change while the process runs, so later calls fail locally instead of
  // sending more requests that are bound to be rejected.
  private keyRejected = false;

  constructor(apiKey: string | undefined) {
    this.apiKey = apiKey;

    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: API_TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": USER_AGENT
      }
    });

    // Add request interceptor to inject auth token
    this.client.interceptors.request.use((config) => {
      config.headers.Authorization = `Bearer ${this.apiKey}`;
      return config;
    });
  }

  /**
   * Make a GET request with retry logic
   */
  async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    return this.requestWithRetry<T>({
      method: "GET",
      url: endpoint,
      params
    });
  }

  /**
   * Make a POST request with retry logic
   */
  async post<T>(endpoint: string, data?: Record<string, unknown>): Promise<T> {
    return this.requestWithRetry<T>({
      method: "POST",
      url: endpoint,
      data
    });
  }

  /**
   * Make a DELETE request with retry logic
   */
  async delete<T>(endpoint: string): Promise<T> {
    return this.requestWithRetry<T>({
      method: "DELETE",
      url: endpoint
    });
  }

  /**
   * Make a request with exponential backoff retry logic
   */
  private async requestWithRetry<T>(
    config: AxiosRequestConfig,
    retryCount = 0
  ): Promise<T> {
    if (!this.apiKey) {
      throw new MeshyAuthError(MISSING_API_KEY_MESSAGE);
    }
    if (this.keyRejected) {
      throw new MeshyAuthError(INVALID_API_KEY_MESSAGE);
    }

    try {
      const response = await this.client.request<T>(config);
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 401) {
        this.keyRejected = true;
        throw new MeshyAuthError(INVALID_API_KEY_MESSAGE);
      }

      // Check if we should retry
      const shouldRetry =
        retryCount < MAX_RETRIES &&
        (isRetryableError(error) || isRateLimitError(error));

      if (shouldRetry) {
        const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];

        // Log retry attempt to stderr (not stdout for stdio transport)
        console.error(
          `Request failed, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`
        );

        await this.sleep(delay);
        return this.requestWithRetry<T>(config, retryCount + 1);
      }

      // No more retries, throw the error
      throw error;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Try to fetch a task by ID from all known API endpoints.
 * Tries endpoints in priority order until one succeeds.
 * Useful when the task type is unknown.
 */
export async function fetchTaskByIdFromKnownEndpoints(
  client: MeshyClient,
  taskId: string
): Promise<{ task: GetTaskResponse; endpoint: string } | null> {
  const endpoints = [
    "/openapi/v2/text-to-3d",
    "/openapi/v1/image-to-3d",
    "/openapi/v1/multi-image-to-3d",
    "/openapi/v1/remesh",
    "/openapi/v1/retexture",
    "/openapi/v1/rigging",
    "/openapi/v1/animations",
    "/openapi/v1/text-to-image",
    "/openapi/v1/image-to-image",
    "/openapi/v1/print/multi-color"
  ];

  for (const endpoint of endpoints) {
    try {
      const task = await client.get<GetTaskResponse>(`${endpoint}/${taskId}`);
      if (task && task.id) {
        return { task, endpoint };
      }
    } catch (error) {
      // A bad key fails on every endpoint; report it, not "task not found"
      if (error instanceof MeshyAuthError) throw error;
      // Not found on this endpoint, try next
      continue;
    }
  }

  return null;
}

/**
 * Fetch a task, trying the given endpoint first, then falling back to auto-inference.
 * Returns the task data and the resolved endpoint.
 */
export async function getTaskWithAutoInference(
  client: MeshyClient,
  taskId: string,
  preferredEndpoint: string
): Promise<{ task: GetTaskResponse; endpoint: string }> {
  // Try preferred endpoint first
  try {
    const task = await client.get<GetTaskResponse>(`${preferredEndpoint}/${taskId}`);
    if (task && task.id) {
      return { task, endpoint: preferredEndpoint };
    }
  } catch (error) {
    if (error instanceof MeshyAuthError) throw error;
    // Fall through to auto-inference
  }

  // Auto-infer from all endpoints
  const result = await fetchTaskByIdFromKnownEndpoints(client, taskId);
  if (result) {
    return result;
  }

  throw new Error(`Task ${taskId} not found on any endpoint. Verify the task_id is correct.`);
}

/**
 * Create the Meshy client.
 *
 * The key is not probed at startup and a missing key does not stop the server:
 * MCP hosts restart a server that exits, so failing here turned every install
 * with a bad key into a restart loop hitting the API (ENG-3924). Instead each
 * tool call returns the auth error, which the user sees in the chat.
 */
export function createMeshyClient(): MeshyClient {
  const apiKey = process.env.MESHY_API_KEY?.trim();

  if (!apiKey) {
    console.error(`Warning: ${MISSING_API_KEY_MESSAGE}`);
  }

  return new MeshyClient(apiKey);
}
