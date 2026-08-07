import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { DEFAULT_SCOPES, TOKEN_ENDPOINT } from "../google/auth.js";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

export function tokenCachePath(): string {
  return (
    process.env["GSHEETS_TOKEN_PATH"] ??
    path.join(homedir(), ".config", "google-sheets-mcp", "token.json")
  );
}

/**
 * Return a Google refresh token, running the desktop OAuth loopback flow only
 * if one is not already cached on disk. Node-only: this opens a browser and a
 * localhost listener, neither of which exists in a Worker.
 */
export async function getCachedRefreshToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cached = await readCachedToken();
  if (cached) return cached;
  const refreshToken = await runLoopbackFlow(clientId, clientSecret);
  await writeCachedToken(refreshToken);
  return refreshToken;
}

async function readCachedToken(): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(tokenCachePath(), "utf8")) as {
      refresh_token?: string;
    };
    return parsed.refresh_token || undefined;
  } catch {
    return undefined;
  }
}

async function writeCachedToken(refreshToken: string): Promise<void> {
  const file = tokenCachePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ refresh_token: refreshToken }, null, 2), {
    mode: 0o600,
  });
}

/**
 * Desktop OAuth loopback flow: listen on an ephemeral localhost port, open the
 * consent URL in a browser, and trade the returned code for a refresh token.
 */
export function runLoopbackFlow(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let redirectUri = "";

    const server = createServer((req, res) => {
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
      exchangeCode(code, redirectUri, clientId, clientSecret).then(resolve, reject);
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        access_type: "offline",
        prompt: "consent",
        scope: DEFAULT_SCOPES.join(" "),
      });
      const authUrl = `${AUTH_ENDPOINT}?${params}`;
      // stderr only: stdout carries the MCP protocol stream.
      console.error(`[google-sheets-mcp] Authorize in your browser:\n${authUrl}`);
      openBrowser(authUrl);
    });

    server.on("error", reject);
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth authorization timed out after 5 minutes."));
    }, FLOW_TIMEOUT_MS).unref();
  });
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as { refresh_token?: string };
  if (!data.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Revoke the app's access at " +
        "https://myaccount.google.com/permissions and authorize again.",
    );
  }
  return data.refresh_token;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {
      // Browser could not be opened automatically; the URL is already on stderr.
    })
    .unref();
}
