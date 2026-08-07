/**
 * Access-token providers built on `fetch` and WebCrypto only, so the same code
 * runs under Node 20+ and inside Cloudflare Workers (V8 isolates).
 */

export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWT_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** Scopes required by the tool set. */
export const DEFAULT_SCOPES = [
  // Read and write cell data, formulas, formatting, and sheet structure.
  "https://www.googleapis.com/auth/spreadsheets",
  // List and search spreadsheet files by name (metadata only, no file content).
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

/** Refresh a few seconds early so a token never expires mid-flight. */
const EXPIRY_SKEW_MS = 30_000;

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Shared expiry-aware caching around a token-minting function. */
abstract class CachingTokenProvider implements TokenProvider {
  #cached: CachedToken | undefined;
  #inFlight: Promise<CachedToken> | undefined;

  protected abstract mint(): Promise<CachedToken>;

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.#cached && this.#cached.expiresAt - EXPIRY_SKEW_MS > now) {
      return this.#cached.token;
    }
    // Collapse concurrent refreshes into one request.
    this.#inFlight ??= this.mint().finally(() => {
      this.#inFlight = undefined;
    });
    this.#cached = await this.#inFlight;
    return this.#cached.token;
  }
}

async function requestToken(body: URLSearchParams): Promise<CachedToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google token request failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Google token response contained no access_token.");
  }
  return {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

/**
 * Exchanges a long-lived refresh token for access tokens. This acts as the
 * user who granted consent, so it reaches every spreadsheet they can open —
 * no per-sheet sharing required.
 */
export class RefreshTokenProvider extends CachingTokenProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
  ) {
    super();
  }

  protected override mint(): Promise<CachedToken> {
    return requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
      }),
    );
  }
}

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/**
 * Signs a JWT assertion with a service-account key. The service account only
 * sees spreadsheets explicitly shared with its `client_email`.
 */
export class ServiceAccountProvider extends CachingTokenProvider {
  constructor(
    private readonly key: ServiceAccountKey,
    private readonly scopes: string[],
  ) {
    super();
  }

  protected override async mint(): Promise<CachedToken> {
    const assertion = await this.buildAssertion();
    return requestToken(
      new URLSearchParams({ grant_type: JWT_GRANT, assertion }),
    );
  }

  private async buildAssertion(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
      iss: this.key.client_email,
      scope: this.scopes.join(" "),
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    };
    const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
      JSON.stringify(claims),
    )}`;
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(this.key.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
  }
}

/** A provider wrapping a pre-obtained access token (mainly for testing). */
export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {}
  async getAccessToken(): Promise<string> {
    return this.token;
  }
}

function base64UrlEncode(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
