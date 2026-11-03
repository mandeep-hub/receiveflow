// API startup messages. No database: a bare Express app on 127.0.0.1 ports.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { startServer } from "../../src/startServer.ts";

// Starts the server and waits until it has either started or called exit.
async function start(t: TestContext, port: number) {
  const logged = t.mock.method(console, "log", () => {});
  const errored = t.mock.method(console, "error", () => {});
  const exits: number[] = [];

  const server: Server = await new Promise((resolve) => {
    const started = startServer(express(), port, (code) => {
      exits.push(code);
      resolve(started);
    });
    started.once("listening", () => resolve(started));
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  return {
    exits,
    logs: () => logged.mock.calls.map((call) => String(call.arguments[0])),
    errors: () => errored.mock.calls.map((call) => String(call.arguments[0])),
  };
}

// A port that something else is already listening on, on every address.
async function occupiedPort(t: TestContext) {
  const blocker = net.createServer();
  await new Promise<void>((resolve) => blocker.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => blocker.close(() => resolve())));

  return (blocker.address() as AddressInfo).port;
}

test("a successful start reports that the API is running and does not exit", async (t) => {
  // Port 0 picks a free port; the message shows the port that was asked for.
  const { exits, logs, errors } = await start(t, 0);

  // Express calls the callback from the same "listening" event.
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(logs(), ["ReceiveFlow API running on http://localhost:0"]);
  assert.deepEqual(errors(), []);
  assert.deepEqual(exits, []);
});

test("a port already in use is reported, exits with 1 and never says the API is running", async (t) => {
  const port = await occupiedPort(t);
  const { exits, logs, errors } = await start(t, port);

  assert.deepEqual(errors(), [`ReceiveFlow API failed to start: port ${port} is already in use`]);
  assert.deepEqual(exits, [1]);
  assert.deepEqual(logs(), []);
});
