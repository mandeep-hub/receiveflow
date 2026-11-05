// API startup: the port setting and startup messages. No database: a bare
// Express app, or the real server.ts given an unusable database address.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import path from "node:path";
import express from "express";
import { parsePort, startServer } from "../../src/startServer.ts";

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

test("PORT not provided or empty: defaults to 3000", () => {
  assert.equal(parsePort(undefined), 3000);
  assert.equal(parsePort(""), 3000);
  assert.equal(parsePort("  "), 3000);
});

test("a valid PORT is used", () => {
  assert.equal(parsePort("8080"), 8080);
  assert.equal(parsePort(" 8080 "), 8080);
  assert.equal(parsePort("1"), 1);
  assert.equal(parsePort("65535"), 65535);
});

test("PORT=0, non-numbers and values above 65535 are rejected", () => {
  for (const value of ["0", "00000", "invalid", "65536", "99999", "100000", "-1", "+80", "80.5", "1e3", "0x50", "80 81", "8080abc"]) {
    assert.throws(() => parsePort(value), /^Error: PORT must be a whole number from 1 to 65535$/, value);
  }
});

// --- The real server.ts, in its own process ----------------------------------

// Has no database to reach: nothing here sends a request that needs one.
const API_ROOT = path.resolve(import.meta.dirname, "../..");
const SERVER_ENV = {
  PATH: process.env.PATH,
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/receiveflow_no_database",
};

function runServer(port: string) {
  return spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: API_ROOT,
    env: { ...SERVER_ENV, PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Waits for the process to exit, or for its output to contain `until`.
function outcome(server: ChildProcess, until: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    let stdout = "";
    let stderr = "";

    server.stdout!.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes(until)) resolve({ code: null, stdout, stderr });
    });
    server.stderr!.on("data", (chunk) => (stderr += chunk));
    server.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("server.ts listens on the port from PORT", async (t) => {
  const blocker = net.createServer();
  await new Promise<void>((resolve) => blocker.listen(0, resolve));
  const { port } = blocker.address() as AddressInfo;
  await new Promise((resolve) => blocker.close(resolve));

  const server = runServer(String(port));
  t.after(() => void server.kill());

  const { stdout } = await outcome(server, "running on");
  assert.match(stdout, new RegExp(`ReceiveFlow API running on http://localhost:${port}`));
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

test("server.ts refuses an invalid PORT with a clear error and exit code 1", async () => {
  for (const value of ["0", "invalid", "65536"]) {
    const { code, stdout, stderr } = await outcome(runServer(value), "running on");

    assert.equal(code, 1, value);
    assert.match(stderr, /ReceiveFlow API failed to start: PORT must be a whole number from 1 to 65535/, value);
    assert.doesNotMatch(stdout, /running on/, value);
  }
});

test("server.ts still reports a port already in use and exits with 1", async (t) => {
  const port = await occupiedPort(t);
  const { code, stdout, stderr } = await outcome(runServer(String(port)), "running on");

  assert.equal(code, 1);
  assert.match(stderr, new RegExp(`ReceiveFlow API failed to start: port ${port} is already in use`));
  assert.doesNotMatch(stdout, /running on/);
});
