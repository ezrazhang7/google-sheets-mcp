import type { CallToolResult } from "@modelcontextprotocol/server";
import { GaxiosError } from "googleapis-common";

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
  if (err instanceof GaxiosError) {
    const status = err.response?.status;
    const apiMessage =
      (err.response?.data as { error?: { message?: string } } | undefined)?.error
        ?.message ?? err.message;
    const hint =
      status === 403
        ? " (check that the authorized account has access to this spreadsheet and that the required scopes were granted)"
        : status === 404
          ? " (check the spreadsheet ID)"
          : "";
    return `Google Sheets API error${status ? ` ${status}` : ""}: ${apiMessage}${hint}`;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Could not load the default credentials")) {
    return (
      "No Google credentials configured. Set GOOGLE_OAUTH_CLIENT_ID and " +
      "GOOGLE_OAUTH_CLIENT_SECRET (recommended for personal use), or " +
      "GOOGLE_SERVICE_ACCOUNT_KEY_FILE / GOOGLE_SERVICE_ACCOUNT_KEY, or " +
      "GOOGLE_APPLICATION_CREDENTIALS. See the README for setup."
    );
  }
  return message;
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
