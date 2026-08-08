#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { GoogleClient } from "./google/client.js";
import type { TokenProvider } from "./google/auth.js";
import { MISSING_CREDENTIALS_MESSAGE, providerFromCredentials } from "./config.js";
import { createLocalOAuthProvider } from "./node/localOAuth.js";

/**
 * Resolve credentials for a local (stdio) run, in order:
 *   1. Anything usable in the environment (service account or refresh token)
 *   2. A service-account key file path
 *   3. OAuth client id/secret → interactive loopback flow, cached to disk
 */
async function resolveTokenProvider(): Promise<TokenProvider> {
  const env = process.env;

  const keyFile = env["GOOGLE_SERVICE_ACCOUNT_KEY_FILE"];
  const inlineKey =
    env["GOOGLE_SERVICE_ACCOUNT_KEY"] ??
    (keyFile ? await readFile(keyFile, "utf8") : undefined);

  const fromEnv = providerFromCredentials({
    GOOGLE_OAUTH_CLIENT_ID: env["GOOGLE_OAUTH_CLIENT_ID"],
    GOOGLE_OAUTH_CLIENT_SECRET: env["GOOGLE_OAUTH_CLIENT_SECRET"],
    GOOGLE_REFRESH_TOKEN: env["GOOGLE_REFRESH_TOKEN"],
    GOOGLE_SERVICE_ACCOUNT_KEY: inlineKey,
  });
  if (fromEnv) return fromEnv;

  const clientId = env["GOOGLE_OAUTH_CLIENT_ID"];
  const clientSecret = env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (clientId && clientSecret) {
    return createLocalOAuthProvider(clientId, clientSecret);
  }
  throw new Error(MISSING_CREDENTIALS_MESSAGE);
}

/**
 * Credentials resolve lazily on first tool call: the loopback flow must not
 * block startup, and a missing-credentials error should surface as a readable
 * tool error rather than killing the process during initialize.
 */
let pending: Promise<TokenProvider> | undefined;
const lazyProvider: TokenProvider = {
  getAccessToken: () => {
    pending ??= resolveTokenProvider();
    return pending.then((provider) => provider.getAccessToken());
  },
};

serveStdio(() => createServer(new GoogleClient(lazyProvider)), {
  onerror: (error) => console.error("[google-sheets-mcp]", error),
});
