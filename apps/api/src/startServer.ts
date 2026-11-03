// Starts the HTTP server. Express 5 passes listen errors to the callback, so
// the callback has to check for one before reporting that the API is running.
import type { Express } from "express";

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
