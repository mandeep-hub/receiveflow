// Starts the HTTP server. Express 5 passes listen errors to the callback, so
// the callback has to check for one before reporting that the API is running.
import type { Express } from "express";

const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

// The port from the PORT setting, or the local development default when it is
// unset or empty. Anything else that isn't a valid port throws, so the API
// refuses to start instead of listening on the wrong port.
export function parsePort(value: string | undefined) {
  const text = value?.trim();

  if (!text) {
    return DEFAULT_PORT;
  }

  const port = /^\d{1,5}$/.test(text) ? Number(text) : 0;

  if (port < 1 || port > MAX_PORT) {
    throw new Error(`PORT must be a whole number from 1 to ${MAX_PORT}`);
  }

  return port;
}

function describeListenError(error: NodeJS.ErrnoException, port: number) {
  if (error.code === "EADDRINUSE") {
    return `port ${port} is already in use`;
  }

  return error.code ?? error.message;
}

export function startServer(
  app: Express,
  port: number,
  exit: (code: number) => void = process.exit,
) {
  return app.listen(port, (error?: Error) => {
    if (error) {
      console.error(`ReceiveFlow API failed to start: ${describeListenError(error, port)}`);
      exit(1);
      return;
    }

    console.log(`ReceiveFlow API running on http://localhost:${port}`);
  });
}
