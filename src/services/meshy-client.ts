/**
 * Meshy API client with authentication and error handling
 */

import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { API_BASE_URL, API_TIMEOUT, RETRY_DELAYS, MAX_RETRIES } from "../constants.js";
import { isRetryableError, isRateLimitError } from "./error-handler.js";
import { GetTaskResponse } from "../types.js";

export class MeshyClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;

    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: API_TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
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
    try {
      const response = await this.client.request<T>(config);
      return response.data;
    } catch (error) {
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

  /**
   * Validate API key by making a test request
   */
  async validateApiKey(): Promise<boolean> {
    try {
      // Make a simple request to check if API key is valid
      // Use the text-to-3d endpoint which returns a list of tasks
      await this.get("/openapi/v2/text-to-3d");
      return true;
    } catch (error) {
      return false;
    }
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
    } catch {
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
  } catch {
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
 * Create and validate Meshy client
 */
export async function createMeshyClient(): Promise<MeshyClient> {
  const apiKey = process.env.MESHY_API_KEY;

  if (!apiKey) {
    throw new Error(
      "MESHY_API_KEY environment variable is required. " +
      "Get your API key from https://www.meshy.ai/settings/api"
    );
  }

  const client = new MeshyClient(apiKey);

  // Validate API key on startup
  console.error("Validating Meshy API key...");
  const isValid = await client.validateApiKey();

  if (!isValid) {
    throw new Error(
      "Invalid MESHY_API_KEY. Please check your API key is correct. " +
      "Get your API key from https://www.meshy.ai/settings/api"
    );
  }

  console.error("✓ Meshy API key validated successfully");
  return client;
}
