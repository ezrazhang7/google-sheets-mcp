import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import type { AuthClient } from "google-auth-library";

const DEFAULT_SCOPES = [
  // Read and write cell data, formulas, formatting, and sheet structure.
  "https://www.googleapis.com/auth/spreadsheets",
  // List and search spreadsheet files by name (metadata only, no file content).
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

export function scopes(): string[] {
  const override = process.env.GSHEETS_SCOPES;
  return override ? override.split(/[,\s]+/).filter(Boolean) : DEFAULT_SCOPES;
}

function tokenCachePath(): string {
  return (
    process.env.GSHEETS_TOKEN_PATH ??
    path.join(homedir(), ".config", "google-sheets-mcp", "token.json")
  );
}

let cachedClient: AuthClient | undefined;

/**
 * Resolve a Google auth client, trying in order:
 *  1. Inline service-account JSON (GOOGLE_SERVICE_ACCOUNT_KEY)
 *  2. Service-account key file (GOOGLE_SERVICE_ACCOUNT_KEY_FILE)
 *  3. OAuth desktop flow (GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET),
 *     with tokens cached across runs
 *  4. Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS, gcloud)
 */
export async function getAuthClient(): Promise<AuthClient> {
  if (cachedClient) return cachedClient;

  const inlineKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const oauthId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const oauthSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (inlineKey) {
    const auth = new GoogleAuth({
      credentials: JSON.parse(inlineKey),
      scopes: scopes(),
    });
    cachedClient = await auth.getClient();
  } else if (keyFile) {
    const auth = new GoogleAuth({ keyFile, scopes: scopes() });
    cachedClient = await auth.getClient();
  } else if (oauthId && oauthSecret) {
    cachedClient = await getOAuthClient(oauthId, oauthSecret);
  } else {
    const auth = new GoogleAuth({ scopes: scopes() });
    cachedClient = await auth.getClient();
  }
  return cachedClient;
}

async function getOAuthClient(
  clientId: string,
  clientSecret: string,
): Promise<OAuth2Client> {
  const client = new OAuth2Client({ clientId, clientSecret });
  client.on("tokens", (tokens) => {
    // Persist refreshed access tokens (and any new refresh token) as they arrive.
    void saveTokens({ ...loadedTokens, ...tokens });
  });

  const cached = await loadTokens();
  if (cached?.refresh_token) {
    loadedTokens = cached;
    client.setCredentials(cached);
    return client;
  }

  const tokens = await runLoopbackFlow(client);
  loadedTokens = tokens;
  client.setCredentials(tokens);
  await saveTokens(tokens);
  return client;
}

type StoredTokens = Record<string, unknown> & { refresh_token?: string | null };
let loadedTokens: StoredTokens = {};

async function loadTokens(): Promise<StoredTokens | undefined> {
  try {
    return JSON.parse(await readFile(tokenCachePath(), "utf8"));
  } catch {
    return undefined;
  }
}

async function saveTokens(tokens: StoredTokens): Promise<void> {
  const file = tokenCachePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

/**
 * Desktop OAuth loopback flow: listen on an ephemeral localhost port, open the
 * consent URL in a browser, and trade the returned code for tokens.
 */
async function runLoopbackFlow(client: OAuth2Client): Promise<StoredTokens> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        code
          ? "<h3>Google Sheets MCP is authorized.</h3>You can close this tab."
          : `<h3>Authorization failed.</h3>${error ?? "No code returned."}`,
      );
      server.close();
      if (!code) {
        reject(new Error(`OAuth authorization failed: ${error ?? "no code"}`));
        return;
      }
      try {
        const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
        resolve(tokens as StoredTokens);
      } catch (err) {
        reject(err);
      }
    });

    let redirectUri = "";
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: scopes(),
        redirect_uri: redirectUri,
      });
      // stderr only: stdout carries the MCP protocol stream.
      console.error(`[google-sheets-mcp] Authorize in your browser:\n${authUrl}`);
      openBrowser(authUrl);
    });
    server.on("error", reject);
    setTimeout(
      () => {
        server.close();
        reject(new Error("OAuth authorization timed out after 5 minutes."));
      },
      5 * 60 * 1000,
    ).unref();
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {
    // Browser could not be opened automatically; the URL is already on stderr.
  }).unref();
}
