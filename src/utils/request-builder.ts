/**
 * Shared API request body builder.
 * Constructs a request object from required fields and optional parameters,
 * omitting undefined values automatically.
 */

/**
 * Build an API request body by merging required fields with optional parameters.
 * Undefined values in optionalParams are automatically excluded.
 *
 * @param requiredFields - Fields that are always included in the request
 * @param optionalParams - Fields that are included only if defined
 * @param excludeKeys - Keys to exclude from optionalParams (e.g., "response_format")
 * @returns A flat record suitable for passing to client.post()
 */
export function buildApiRequest(
  requiredFields: Record<string, unknown>,
  optionalParams: Record<string, unknown>,
  excludeKeys: string[] = ["response_format"]
): Record<string, unknown> {
  const request: Record<string, unknown> = { ...requiredFields };

  const excludeSet = new Set(excludeKeys);

  for (const [key, value] of Object.entries(optionalParams)) {
    if (value !== undefined && !excludeSet.has(key)) {
      request[key] = value;
    }
  }

  return request;
}
