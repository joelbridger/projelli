export const DEFAULT_INTAKE_STAGING_RELAY_ORIGIN =
  'https://intake-relay-staging.lanternplatform.app';

export const DEFAULT_INTAKE_STAGING_PAGE_ORIGIN =
  'https://intake-staging.lanternplatform.app';

export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'ambient-light-sensor=()',
  'autoplay=()',
  'battery=()',
  'camera=()',
  'display-capture=()',
  'document-domain=()',
  'encrypted-media=()',
  'fullscreen=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'publickey-credentials-get=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

export function normalizeOrigin(rawOrigin) {
  if (!rawOrigin || typeof rawOrigin !== 'string') {
    throw new Error('Expected an origin string.');
  }

  const url = new URL(rawOrigin);
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(`Expected an origin only, got ${rawOrigin}.`);
  }

  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1');
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(
      `Relay origin must be https, except loopback test hosts: ${rawOrigin}.`
    );
  }

  return url.origin;
}

export function buildIntakeCsp(relayOrigin) {
  normalizeOrigin(relayOrigin);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join('; ');
}

export function buildIntakeSecurityHeaders(relayOrigin) {
  return {
    'Content-Security-Policy': buildIntakeCsp(relayOrigin),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

export function getHeader(headers, wantedName) {
  const wanted = wantedName.toLowerCase();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === wanted) return String(value);
  }
  return undefined;
}

export function parseCsp(csp) {
  const directives = new Map();
  for (const part of String(csp ?? '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...tokens] = trimmed.split(/\s+/u);
    if (!name) continue;
    directives.set(name, tokens);
  }
  return directives;
}

export function findThirdPartyOriginTokens(headers, relayOrigin) {
  normalizeOrigin(relayOrigin);
  const allowedOrigins = new Set();
  const found = [];

  for (const [name, value] of Object.entries(headers ?? {})) {
    const matches = String(value).matchAll(/\bhttps?:\/\/[^\s;'",)]+/giu);
    for (const match of matches) {
      const token = match[0];
      let normalized;
      try {
        normalized = new URL(token).origin;
      } catch {
        found.push({ header: name, token });
        continue;
      }
      if (!allowedOrigins.has(normalized)) found.push({ header: name, token });
    }
  }

  return found;
}

function sameTokens(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((token, index) => token === expected[index])
  );
}

export function validateIntakePageHeaders(headers, relayOrigin) {
  normalizeOrigin(relayOrigin);
  const errors = [];
  const csp = getHeader(headers, 'Content-Security-Policy');
  if (!csp) {
    errors.push('Missing Content-Security-Policy.');
  } else {
    const directives = parseCsp(csp);
    const required = new Map([
      ['default-src', ["'none'"]],
      ['script-src', ["'self'"]],
      ['style-src', ["'self'"]],
      ['img-src', ["'self'", 'data:', 'blob:']],
      ['connect-src', ["'self'"]],
      ['base-uri', ["'none'"]],
      ['form-action', ["'none'"]],
      ['frame-ancestors', ["'none'"]],
    ]);

    for (const [name, expected] of required) {
      const actual = directives.get(name) ?? [];
      if (!sameTokens(actual, expected)) {
        errors.push(
          `${name} must be exactly "${expected.join(' ')}"; got "${actual.join(' ')}".`
        );
      }
    }

    if ((directives.get('style-src') ?? []).includes("'unsafe-inline'")) {
      errors.push("style-src must not include 'unsafe-inline'.");
    }
  }

  if (getHeader(headers, 'Referrer-Policy') !== 'no-referrer') {
    errors.push('Referrer-Policy must be no-referrer.');
  }
  if (getHeader(headers, 'X-Content-Type-Options') !== 'nosniff') {
    errors.push('X-Content-Type-Options must be nosniff.');
  }
  if ((getHeader(headers, 'X-Frame-Options') ?? '').toUpperCase() !== 'DENY') {
    errors.push('X-Frame-Options must be DENY.');
  }
  if (!getHeader(headers, 'Permissions-Policy')) {
    errors.push('Permissions-Policy is required.');
  }

  const thirdPartyTokens = findThirdPartyOriginTokens(headers, relayOrigin);
  for (const hit of thirdPartyTokens) {
    errors.push(`Third-party origin token in ${hit.header}: ${hit.token}`);
  }

  return { ok: errors.length === 0, errors };
}
