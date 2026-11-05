import app from "./app.js";
import { parsePort, startServer } from "./startServer.js";

let port: number;

try {
  port = parsePort(process.env.PORT);
} catch (error) {
  console.error(`ReceiveFlow API failed to start: ${(error as Error).message}`);
  process.exit(1);
}

startServer(app, port);
