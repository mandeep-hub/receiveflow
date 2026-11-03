// Authentication settings, read from the environment once at startup. Any
// invalid value throws, so the API refuses to start instead of running with
// unsafe settings.
//
//   NODE_ENV=production  Secure "__Host-" cookie; FRONTEND_ORIGIN required.
//                        An https FRONTEND_ORIGIN without it is refused.
//   FRONTEND_ORIGIN      the one origin allowed to call the API with cookies,
//                        e.g. https://app.example.com (default in development:
//                        http://localhost:5173)
//   TRUST_PROXY          number of reverse proxies in front of the API
//                        (default 0), so req.ip is the real client address

export type AuthConfig = {
  production: boolean;
  frontendOrigin: string;
  cookieName: string;
  secureCookies: boolean;
  sessionTtlSeconds: number;
  trustProxyHops: number;
  loginMaxFailures: number;
  loginWindowMs: number;
};

export const DEVELOPMENT_FRONTEND_ORIGIN = "http://localhost:5173";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function parseFrontendOrigin(value: string, production: boolean) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("FRONTEND_ORIGIN is not a valid URL");
  }

  const allowedProtocols = production ? ["https:"] : ["http:", "https:"];

  if (
    !allowedProtocols.includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      production
        ? "FRONTEND_ORIGIN must be an https:// origin (scheme, host and optional port only) in production"
        : "FRONTEND_ORIGIN must be an http:// or https:// origin (scheme, host and optional port only)",
    );
  }

  return url.origin;
}

function parseTrustProxy(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return 0;
  }

  if (!/^\d{1,2}$/.test(value.trim())) {
    throw new Error("TRUST_PROXY must be the number of reverse proxies in front of the API (0-99)");
  }

  return Number(value.trim());
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env.NODE_ENV === "production";
  const configuredOrigin = env.FRONTEND_ORIGIN?.trim();

  if (production && !configuredOrigin) {
    throw new Error("FRONTEND_ORIGIN must be set in production");
  }

  const frontendOrigin = parseFrontendOrigin(configuredOrigin || DEVELOPMENT_FRONTEND_ORIGIN, production);

  // An https frontend means a real deployment. Without NODE_ENV=production the
  // session cookie would silently lose Secure and the __Host- prefix, so
  // refuse to start instead.
  if (!production && frontendOrigin.startsWith("https:")) {
    throw new Error(
      'FRONTEND_ORIGIN is an https:// origin but NODE_ENV is not "production"; set NODE_ENV=production so session cookies are Secure',
    );
  }

  return {
    production,
    frontendOrigin,
    // "__Host-" makes the browser require Secure, Path=/ and no Domain.
    cookieName: production ? "__Host-rf_session" : "rf_session",
    secureCookies: production,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    trustProxyHops: parseTrustProxy(env.TRUST_PROXY),
    loginMaxFailures: LOGIN_MAX_FAILURES,
    loginWindowMs: LOGIN_WINDOW_MS,
  };
}
