import type { CallToolResult } from "@modelcontextprotocol/server";
import { GoogleApiError } from "../google/client.js";

/** Wrap a JSON-serializable payload as a successful tool result. */
export function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/** Wrap a plain message as a successful tool result. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** Convert any thrown error into a readable MCP tool error result. */
export function errorResult(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: describeError(err) }] };
}

function describeError(err: unknown): string {
  if (err instanceof GoogleApiError) {
    const hint =
      err.status === 403
        ? " (check that the authorized account has access to this spreadsheet and that the required scopes were granted)"
        : err.status === 404
          ? " (check the spreadsheet ID)"
          : err.status === 429
            ? " (Google rate limit reached — wait a moment and retry)"
            : "";
    return `Google Sheets API error ${err.status}: ${err.message}${hint}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Run a tool body, converting thrown errors into tool error results. */
export async function runTool(
  body: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await body();
  } catch (err) {
    return errorResult(err);
  }
}
