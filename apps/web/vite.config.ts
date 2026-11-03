import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { validateApiUrl } from "./src/api/apiUrl.ts";

export default defineConfig(({ command, mode }) => {
  // Fail `yarn build` straight away when VITE_API_URL is missing or invalid,
  // instead of producing a frontend that cannot reach the API. Reads the same
  // sources as the app: the environment and any .env files in this folder.
  // `yarn dev` is not affected; it falls back to the local API.
  if (command === "build") {
    validateApiUrl(loadEnv(mode, import.meta.dirname, "VITE_").VITE_API_URL);
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  };
});
