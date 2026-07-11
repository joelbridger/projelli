/**
 * The broker's only DocuSign network operation is this OAuth JWT grant. It
 * deliberately has no envelope, document, or recipient API functions.
 */

import { createSign } from "node:crypto";
import type { KeyObject } from "node:crypto";

export interface DocusignSigningGrantConfig {
  environment: "demo" | "production";
  productionReleaseEnabled: boolean;
  integrationKey: string | null;
  impersonatedUserId: string | null;
  accountId: string | null;
  apiBaseUri: string | null;
  privateKey: KeyObject | null;
  allowedReturnUrl: string | null;
  approvedTemplateIds: ReadonlySet<string>;
  oauthTokenEndpoint: string;
  jwtAudience: string;
}

export interface HttpPostFormResponse {
  status: number;
  json: unknown;
}

/** Injectable seam used by tests; production supplies the fetch implementation below. */
export type HttpPostForm = (url: string, form: Record<string, string>) => Promise<HttpPostFormResponse>;

export class DocusignGrantError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
  }
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function assertSigningGrantConfiguration(config: DocusignSigningGrantConfig): asserts config is DocusignSigningGrantConfig & {
  integrationKey: string;
  impersonatedUserId: string;
  accountId: string;
  apiBaseUri: string;
  privateKey: KeyObject;
  allowedReturnUrl: string;
} {
  if (config.environment !== "demo" && config.environment !== "production") {
    throw new DocusignGrantError("docusign_environment_invalid", 503);
  }
  if (config.environment === "production" && !config.productionReleaseEnabled) {
    throw new DocusignGrantError("docusign_production_not_released", 403);
  }
  if (!config.integrationKey || !config.impersonatedUserId || !config.accountId || !config.apiBaseUri || !config.privateKey || !config.allowedReturnUrl) {
    throw new DocusignGrantError("docusign_signing_not_configured", 503);
  }
  const expectedHost = config.environment === "production" ? "account.docusign.com" : "account-d.docusign.com";
  let tokenHost: string;
  try {
    tokenHost = new URL(config.oauthTokenEndpoint).hostname;
  } catch {
    throw new DocusignGrantError("docusign_token_endpoint_invalid", 503);
  }
  if (tokenHost !== expectedHost || config.jwtAudience !== expectedHost) {
    throw new DocusignGrantError("docusign_environment_invalid", 503);
  }
}

/** Sign a short JWT assertion. The private key remains a KeyObject throughout. */
export function createDocusignJwtAssertion(config: DocusignSigningGrantConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  assertSigningGrantConfiguration(config);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: config.integrationKey,
    sub: config.impersonatedUserId,
    aud: config.jwtAudience,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    scope: "signature impersonation",
  }));
  const unsigned = `${header}.${payload}`;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${signer.sign(config.privateKey).toString("base64url")}`;
  } catch {
    throw new DocusignGrantError("docusign_private_key_invalid", 503);
  }
}

/** Production HTTP adapter. No request or response data is logged here. */
export const postFormWithFetch: HttpPostForm = async (url, form) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // The caller maps malformed and non-2xx responses to safe public errors.
  }
  return { status: response.status, json };
};

/**
 * Mint a fresh, short-lived DocuSign bearer for each explicit advisor send
 * action. The broker never caches or reuses a bearer.
 */
export async function requestDocusignSigningCapability(
  config: DocusignSigningGrantConfig,
  postForm: HttpPostForm = postFormWithFetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ capability: string; expiresIn: number }> {
  const assertion = createDocusignJwtAssertion(config, nowSeconds);
  let result: HttpPostFormResponse;
  try {
    result = await postForm(config.oauthTokenEndpoint, {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
  } catch {
    throw new DocusignGrantError("docusign_token_unavailable", 503);
  }

  const body = result.json && typeof result.json === "object" ? result.json as Record<string, unknown> : {};
  if (result.status < 200 || result.status >= 300) {
    // DocuSign's consent error is deliberately translated rather than exposing
    // an upstream body that could contain operational details.
    const upstreamError = typeof body.error === "string" ? body.error : "";
    if (upstreamError === "consent_required") throw new DocusignGrantError("docusign_consent_required", 403);
    throw new DocusignGrantError("docusign_token_rejected", 503);
  }
  const capability = typeof body.access_token === "string" ? body.access_token : "";
  const expiresIn = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) ? Math.floor(body.expires_in) : 0;
  if (!capability || expiresIn <= 0 || expiresIn > 3600) throw new DocusignGrantError("docusign_token_response_invalid", 503);
  return { capability, expiresIn };
}
