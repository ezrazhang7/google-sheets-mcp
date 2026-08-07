import {
  DEFAULT_SCOPES,
  RefreshTokenProvider,
  ServiceAccountProvider,
  type ServiceAccountKey,
  type TokenProvider,
} from "./google/auth.js";

/** Credential inputs, sourced from process.env (Node) or Worker bindings. */
export interface Credentials {
  GOOGLE_OAUTH_CLIENT_ID?: string | undefined;
  GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined;
  GOOGLE_REFRESH_TOKEN?: string | undefined;
  GOOGLE_SERVICE_ACCOUNT_KEY?: string | undefined;
}

export const MISSING_CREDENTIALS_MESSAGE =
  "No Google credentials configured. Provide GOOGLE_OAUTH_CLIENT_ID + " +
  "GOOGLE_OAUTH_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN, or " +
  "GOOGLE_SERVICE_ACCOUNT_KEY (inline JSON). See the README for setup.";

/**
 * Build a token provider from credentials that work in any runtime.
 * Returns undefined when nothing usable is configured, letting Node fall back
 * to the interactive local OAuth flow.
 */
export function providerFromCredentials(
  env: Credentials,
): TokenProvider | undefined {
  const serviceAccount = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (serviceAccount) {
    return new ServiceAccountProvider(
      JSON.parse(serviceAccount) as ServiceAccountKey,
      DEFAULT_SCOPES,
    );
  }
  const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret } = env;
  if (id && secret && env.GOOGLE_REFRESH_TOKEN) {
    return new RefreshTokenProvider(id, secret, env.GOOGLE_REFRESH_TOKEN);
  }
  return undefined;
}
