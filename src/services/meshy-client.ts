/**
 * Meshy API client with authentication and error handling
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import {
  API_BASE_URL,
  API_TIMEOUT,
  API_CREATE_TIMEOUT,
  MAX_RETRIES,
  POLL_BACKOFF_FACTOR,
  POLL_FINALIZATION_DELAY,
  POLL_INITIAL_DELAY,
  POLL_MAX_DELAY,
  TaskStatus,
  TaskType
} from "../constants.js";
import {
  retryDelayMs,
  isTransientError,
  parseRetryAfterMs,
  MeshyAuthError,
  MISSING_API_KEY_MESSAGE,
  INVALID_API_KEY_MESSAGE
} from "./error-handler.js";
import { GetTaskResponse, Task } from "../types.js";
import { USER_AGENT } from "../version.js";
import { HostInfo, parseHost, userAgent } from "../utils/user-agent.js";
import { getTaskEndpoint, PROBE_TASK_TYPES, toTaskType } from "../utils/endpoints.js";

export class MeshyClient {
  private client: AxiosInstance;
  private apiKey: string | undefined;
  // Set once the API answers 401. The key comes from the environment and cannot
  // change while the process runs, so later calls fail locally instead of
  // sending more requests that are bound to be rejected.
  private keyRejected = false;

  /** `getUserAgent` runs per request: the MCP host is only known after the handshake. */
  constructor(apiKey: string | undefined, private getUserAgent: () => string = () => USER_AGENT) {
    this.apiKey = apiKey;

    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: API_TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    // Add request interceptor to inject auth token and User-Agent
    this.client.interceptors.request.use((config) => {
      config.headers.Authorization = `Bearer ${this.apiKey}`;
      config.headers["User-Agent"] = this.getUserAgent();
      return config;
    });
  }

  /**
   * Make a GET request with retry logic
   */
  async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    return (await this.requestWithRetry<T>({
      method: "GET",
      url: endpoint,
      params
    })).data;
  }

  /**
   * GET that also returns the Retry-After poll hint (ms) the API sends while a
   * task is unfinished.
   */
  async getWithRetryAfter<T>(endpoint: string): Promise<{ data: T; retryAfterMs?: number }> {
    const response = await this.requestWithRetry<T>({ method: "GET", url: endpoint });
    return { data: response.data, retryAfterMs: parseRetryAfterMs(response.headers?.["retry-after"]) };
  }

  /**
   * Make a POST request. Creates are not resent after a timeout, network error
   * or 5xx (see retryDelayMs), so they get the longer timeout the docs advise.
   */
  async post<T>(endpoint: string, data?: Record<string, unknown>): Promise<T> {
    return (await this.requestWithRetry<T>({
      method: "POST",
      url: endpoint,
      data,
      timeout: API_CREATE_TIMEOUT
    })).data;
  }

  /**
   * Make a DELETE request with retry logic. `retry: false` sends it once: a cancel decided on a
   * status it read must not land seconds later, after the task may have finished.
   */
  async delete<T>(endpoint: string, options: { retry?: boolean } = {}): Promise<T> {
    return (await this.requestWithRetry<T>({
      method: "DELETE",
      url: endpoint
    }, options.retry ?? true)).data;
  }

  /**
   * Send a request, retrying as retryDelayMs allows for its method (never when retry is false)
   */
  private async requestWithRetry<T>(config: AxiosRequestConfig, retry = true): Promise<AxiosResponse<T>> {
    if (!this.apiKey) {
      throw new MeshyAuthError(MISSING_API_KEY_MESSAGE);
    }
    if (this.keyRejected) {
      throw new MeshyAuthError(INVALID_API_KEY_MESSAGE);
    }

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.request<T>(config);
      } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 401) {
          this.keyRejected = true;
          throw new MeshyAuthError(INVALID_API_KEY_MESSAGE);
        }

        const delay = retry ? retryDelayMs(config.method, error, attempt) : undefined;
        if (delay === undefined) throw error;

        // Log retry attempt to stderr (not stdout for stdio transport)
        console.error(
          `${config.method} ${config.url} failed, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
        );
        await this.sleep(delay);
      }
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface ResolvedTask {
  task: GetTaskResponse;
  /** Base path the task was read from, e.g. "/openapi/v1/rigging" */
  endpoint: string;
  /** The task's actual type, from the API's `type` field when it sends one */
  taskType: TaskType;
}

/** 400 (malformed id) and 404 mean "not on this route"; anything else is a real failure. */
function isNotHere(error: unknown): boolean {
  const status = error instanceof AxiosError ? error.response?.status : undefined;
  return status === 400 || status === 404;
}

/**
 * Fetch a task whose type may be unknown or wrong.
 *
 * Tries `taskType` first, then every other task route (PROBE_TASK_TYPES). Some
 * routes answer for tasks of any type, shaped for themselves, so a hit is only
 * trusted when the task's own `type` maps to that route; otherwise it is read
 * again from its own route, which returns the full result (image_urls,
 * printability, rig and animation outputs, ...).
 */
export async function getTaskWithAutoInference(
  client: MeshyClient,
  taskId: string,
  taskType?: TaskType
): Promise<ResolvedTask> {
  const candidates = taskType ? [taskType, ...PROBE_TASK_TYPES] : PROBE_TASK_TYPES;
  const probed = new Set<string>();

  for (const candidate of candidates) {
    const endpoint = getTaskEndpoint(candidate);
    if (probed.has(endpoint)) continue;
    probed.add(endpoint);

    let task: GetTaskResponse;
    try {
      task = await client.get<GetTaskResponse>(`${endpoint}/${taskId}`);
    } catch (error) {
      if (isNotHere(error)) continue;
      throw error;
    }
    if (!task?.id) continue;

    const actual = toTaskType(task.type);
    if (actual && getTaskEndpoint(actual) !== endpoint) {
      const own = getTaskEndpoint(actual);
      return { task: await client.get<GetTaskResponse>(`${own}/${taskId}`), endpoint: own, taskType: actual };
    }
    return { task, endpoint, taskType: actual ?? candidate };
  }

  throw new Error(`Task ${taskId} not found on any endpoint. Verify the task_id is correct.`);
}

export interface ListedTask {
  task: Task;
  taskType: TaskType;
}

/**
 * List tasks of several types as one list: fetch the first offset+limit tasks
 * of each type in parallel, keep the ones `keep` accepts, merge by created_at
 * and cut the [offset, offset + limit) window. A type whose list request fails
 * is reported in `failed`; if every type fails, the first error is thrown.
 *
 * ponytail: `keep` filters after fetching, so a type whose fetched tasks are
 * mostly filtered out can hide matches past its window (has_more stays true);
 * a deep offset fetches every page up to offset + limit for each type.
 */
export async function listAcrossTypes(
  client: MeshyClient,
  types: TaskType[],
  opts: { sortBy: "+created_at" | "-created_at"; offset: number; limit: number; keep?: (task: Task) => boolean }
): Promise<{ items: ListedTask[]; hasMore: boolean; failed: TaskType[] }> {
  const want = opts.offset + opts.limit;
  const pageSize = Math.min(100, want);
  const pages = Math.ceil(want / pageSize);
  const results = await Promise.allSettled(types.map(async taskType => {
    const tasks: Task[] = [];
    let full = false;
    for (let page = 1; page <= pages; page++) {
      const batch = await client.get<Task[]>(getTaskEndpoint(taskType), {
        page_size: pageSize,
        page_num: page,
        sort_by: opts.sortBy
      });
      const list = Array.isArray(batch) ? batch : [];
      tasks.push(...list);
      full = list.length >= pageSize;
      if (!full) break;
    }
    return { tasks, full };
  }));

  const items: ListedTask[] = [];
  const failed: TaskType[] = [];
  const seen = new Set<string>();
  let more = false;
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failed.push(types[i]);
      return;
    }
    more ||= result.value.full;
    for (const task of result.value.tasks) {
      // Some list routes also return sibling types (text-to-image lists
      // image-to-image tasks): label each task by its own type, skip types not
      // asked for, and keep one copy per id.
      const taskType = toTaskType(task.type) ?? types[i];
      if (!types.includes(taskType) || seen.has(task.id)) continue;
      if (opts.keep && !opts.keep(task)) continue;
      seen.add(task.id);
      items.push({ task, taskType });
    }
  });
  if (types.length > 0 && failed.length === types.length) {
    throw (results[0] as PromiseRejectedResult).reason;
  }

  const time = (t: Task) => new Date(t.created_at).getTime();
  items.sort((a, b) => opts.sortBy === "+created_at" ? time(a.task) - time(b.task) : time(b.task) - time(a.task));
  return { items: items.slice(opts.offset, want), hasMore: more || items.length > want, failed };
}

const FINAL_STATUSES = new Set<string>([TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELED]);

export interface PollResult {
  /** Last task state read; undefined if no status check succeeded */
  task?: GetTaskResponse;
  taskType?: TaskType;
  polls: number;
  /** The last status check's error, when it failed (the task keeps running) */
  lastError?: unknown;
}

/**
 * Poll a task until it is SUCCEEDED, FAILED or CANCELED, or timeoutMs passes.
 *
 * A failed status check (timeout, 429, 5xx) is retried at the next poll: it
 * does not mean the task failed (docs: task-lifecycle, "How Long to Wait").
 * Between polls it waits the API's Retry-After hint when one is sent, else a
 * backoff from 5s to 30s (15s from 95% progress). The first poll resolves the
 * task's route and type (getTaskWithAutoInference).
 */
export async function pollTask(
  client: MeshyClient,
  taskId: string,
  taskType: TaskType | undefined,
  timeoutMs: number,
  onPoll: (task: GetTaskResponse, polls: number) => void | Promise<void> = () => {},
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
): Promise<PollResult> {
  const start = Date.now();
  let backoff = POLL_INITIAL_DELAY;
  let resolved: ResolvedTask | undefined;
  let task: GetTaskResponse | undefined;

  for (let polls = 1; ; polls++) {
    let hint: number | undefined;
    let lastError: unknown;
    try {
      if (!resolved) {
        resolved = await getTaskWithAutoInference(client, taskId, taskType);
        task = resolved.task;
      } else {
        const read = await client.getWithRetryAfter<GetTaskResponse>(`${resolved.endpoint}/${taskId}`);
        task = read.data;
        hint = read.retryAfterMs;
      }
      await onPoll(task, polls);
      if (FINAL_STATUSES.has(task.status)) return { task, taskType: resolved.taskType, polls };
    } catch (error) {
      if (!isTransientError(error)) throw error;
      lastError = error;
      console.error(`Status check ${polls} for task ${taskId} failed; retrying at the next poll`);
    }

    const progress = task?.progress ?? 0;
    const wait = hint ?? (progress >= 95 ? POLL_FINALIZATION_DELAY : backoff);
    if (Date.now() - start + wait > timeoutMs) {
      return { task, taskType: resolved?.taskType, polls, lastError };
    }
    await sleep(wait);
    if (hint === undefined && progress < 95) backoff = Math.min(backoff * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY);
  }
}

/**
 * Create the Meshy client.
 *
 * The key is not probed at startup and a missing key does not stop the server:
 * MCP hosts restart a server that exits, so failing here turned every install
 * with a bad key into a restart loop hitting the API (ENG-3924). Instead each
 * tool call returns the auth error, which the user sees in the chat.
 *
 * The User-Agent names the host app: MESHY_CLIENT ("name[/version]", set by an
 * integrator) if usable, else `clientInfo()`, the connected MCP client.
 */
export function createMeshyClient(clientInfo: () => HostInfo | undefined = () => undefined): MeshyClient {
  const apiKey = process.env.MESHY_API_KEY?.trim();
  const configured = parseHost(process.env.MESHY_CLIENT);

  if (!apiKey) {
    console.error(`Warning: ${MISSING_API_KEY_MESSAGE}`);
  }

  return new MeshyClient(apiKey, () => userAgent(configured, clientInfo()));
}
