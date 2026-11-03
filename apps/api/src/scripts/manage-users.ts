// Manages WAREHOUSE users, interactively:
//
//   yarn --cwd apps/api manage-users create
//   yarn --cwd apps/api manage-users reset-password
//   yarn --cwd apps/api manage-users deactivate
//
// It uses the same database settings as the API (DATABASE_URL, from the
// environment or apps/api/.env). Before anything else it shows which database
// it is connected to and asks you to type that database's name to confirm.
// ADMIN accounts are never changed. Resetting a password or deactivating a user
// also ends that user's sessions.
//
// It must run in an interactive terminal, so a password can never be piped in,
// passed as an argument or left in shell history. The password and its hash
// are never printed. Messages contain no database credentials.
import "dotenv/config";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  assertEmailAvailable,
  assertValidPassword,
  createWarehouseUser,
  deactivateUser,
  findManagedUser,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  resetUserPassword,
  UserAdminError,
} from "../auth/userAdmin.js";

const USAGE = "usage: yarn manage-users create | reset-password | deactivate";

class Stop extends Error {}

// Reads one line from the terminal in raw mode. With hidden = true nothing is
// echoed. Enter finishes; Backspace deletes; Ctrl+C (or Ctrl+D on an empty
// line) cancels; other control keys and escape sequences are ignored.
function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    let value = "";

    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }

        if (char === "\u0003" || (char === "\u0004" && value === "")) {
          finish(new Stop("cancelled"));
          return;
        }

        // Escape sequences (arrow keys and so on): ignore the rest of this input.
        if (char === "\u001b") {
          return;
        }

        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = Array.from(value).slice(0, -1).join("");
            if (!hidden) output.write("\b \b");
          }
          continue;
        }

        if (char < " ") {
          continue;
        }

        value += char;
        if (!hidden) output.write(char);
      }
    };

    output.write(question);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

// Host, port and database name only: never the user name or password.
function describeTarget(databaseUrl: string) {
  let url: URL;

  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Stop("DATABASE_URL is not a valid URL");
  }

  return {
    host: url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

function errorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : undefined;
}

// A new password, typed twice and never shown.
async function promptNewPassword() {
  const password = await prompt(`New password (at least ${MIN_PASSWORD_LENGTH} characters): `, true);
  assertValidPassword(password);

  if ((await prompt("Repeat the password: ", true)) !== password) {
    throw new Stop("the passwords do not match; nothing was changed");
  }

  return password;
}

async function runCommand(db: PrismaClient, command: string, database: string) {
  const email = normalizeEmail(await prompt("User email: "));

  if (command === "create") {
    await assertEmailAvailable(db, email);
    const user = await createWarehouseUser(db, { email, password: await promptNewPassword() });
    console.log(`Created ${user.role} user ${user.email} (id ${user.id}) in ${database}.`);
    return;
  }

  await findManagedUser(db, email);

  const result =
    command === "reset-password"
      ? await resetUserPassword(db, { email, password: await promptNewPassword() })
      : await deactivateUser(db, { email });

  console.log(
    `${command === "reset-password" ? "Password reset for" : "Deactivated"} ${result.role} user ${result.email} in ${database}; ${result.sessionsEnded} session(s) ended.`,
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (rest.length > 0 || !["create", "reset-password", "deactivate"].includes(command ?? "")) {
    throw new Stop(`${USAGE} (it asks for everything else it needs)`);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Stop("run this script in an interactive terminal (input cannot be piped in)");
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Stop("DATABASE_URL is not set");
  }

  const target = describeTarget(databaseUrl);
  const { default: prisma } = await import("../lib/prisma.js");

  try {
    // Confirm the target database before asking for anything else.
    let connectedDatabase: string;

    try {
      const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
      connectedDatabase = rows[0]?.db ?? "";
    } catch (error) {
      const code = errorCode(error);
      throw new Stop(`could not connect to the database${code ? ` (code ${code})` : ""}`);
    }

    if (!connectedDatabase || connectedDatabase !== target.database) {
      throw new Stop("the connected database does not match the database named in DATABASE_URL");
    }

    console.log(`Target database: ${connectedDatabase} on ${target.host}:${target.port}`);

    if ((await prompt("Type the database name to confirm: ")) !== connectedDatabase) {
      throw new Stop("the database name was not confirmed; nothing was changed");
    }

    await runCommand(prisma, command!, connectedDatabase);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  if (error instanceof Stop || error instanceof UserAdminError) {
    console.error(`[manage-users] STOP: ${error.message}`);
  } else {
    const code = errorCode(error);
    console.error(`[manage-users] STOP: unexpected error${code ? ` (code ${code})` : ""}`);
  }

  process.exitCode = 1;
});
