import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./server.js";
import { GoogleClient } from "./google/client.js";
import {
  MISSING_CREDENTIALS_MESSAGE,
  providerFromCredentials,
  type Credentials,
} from "./config.js";

/**
 * Worker bindings. Every value is a secret set with `wrangler secret put`,
 * never committed.
 */
export interface Env extends Credentials {
  /** Shared secret required in `Authorization: Bearer <token>` on every request. */
  MCP_BEARER_TOKEN?: string;
}

/**
 * Constant-time string comparison, so a token can't be recovered by timing
 * how long a rejection takes.
 */
function secureEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "unauthorized", error_description: "Invalid or missing bearer token." }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="google-sheets-mcp"',
      },
    },
  );
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.MCP_BEARER_TOKEN;
  // Fail closed: with no token configured the endpoint would be world-writable.
  if (!expected) return false;
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] !== undefined && secureEquals(match[1], expected);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Unauthenticated liveness probe — deliberately reveals nothing.
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname !== "/mcp") {
      return new Response("Not found. The MCP endpoint is /mcp.", { status: 404 });
    }
    if (!isAuthorized(request, env)) {
      return unauthorized();
    }

    const tokens = providerFromCredentials(env);
    if (!tokens) {
      return new Response(
        JSON.stringify({ error: "server_misconfigured", error_description: MISSING_CREDENTIALS_MESSAGE }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const client = new GoogleClient(tokens);
    const handler = createMcpHandler(() => createServer(client));
    return handler.fetch(request);
  },
};
