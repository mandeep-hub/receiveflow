// Validation of VITE_API_URL, shared by the app (src/api/config.ts, checked
// when the page loads) and the build (vite.config.ts, so `yarn build` fails
// early). Keep it free of import.meta.env and browser- or Node-only APIs.
//
// Returns the address without a trailing slash, so paths like
// `${API_BASE_URL}/receivings` always join correctly. Throws a clear error
// when the value is missing or is not a plain http(s) address.
export function validateApiUrl(value: string | undefined): string {
  const configuredUrl = value?.trim();

  if (!configuredUrl) {
    throw new Error(
      "VITE_API_URL is not set. Set it to the API address (for example https://api.example.com) when building the frontend.",
    );
  }

  let url: URL;

  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("VITE_API_URL is not a valid URL.");
  }

  // Only a plain http(s) address with a hostname; credentials, query strings
  // and fragments would break the `${API_BASE_URL}/path` joins.
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "VITE_API_URL must be an http:// or https:// address with a hostname, and no credentials, query string or fragment.",
    );
  }

  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
