// Base URL of the ReceiveFlow API, shared by every API call.
//
// Set VITE_API_URL when starting or building the frontend, for example:
//   VITE_API_URL=https://api.example.com yarn build
// Only in development (`yarn dev`) is the local API used when it is not set.
// `yarn build` refuses to build without a valid VITE_API_URL (vite.config.ts);
// this check repeats that when the page loads, as a safety net, so a build can
// never silently call localhost.
import { validateApiUrl } from "@/api/apiUrl";

const DEVELOPMENT_API_URL = "http://localhost:3000";

const configuredUrl: string | undefined = import.meta.env.VITE_API_URL?.trim();

export const API_BASE_URL =
  !configuredUrl && import.meta.env.DEV
    ? DEVELOPMENT_API_URL
    : validateApiUrl(configuredUrl);
