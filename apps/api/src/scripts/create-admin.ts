// Creates an ADMIN user for ReceiveFlow, interactively:
//
//   yarn --cwd apps/api create-admin
//
// It uses the same database settings as the API (DATABASE_URL, from the
// environment or apps/api/.env). Before anything else it shows which database
// it is connected to and asks you to type that database's name to confirm.
// The email is normalized the same way login does (trimmed, lower-cased); the
// password is typed twice without being shown, must be at least 12 characters,
// and is stored only as an Argon2id hash (src/auth/password.ts). An existing
// account with the same email is never changed or replaced.
//
// It must run in an interactive terminal, so a password can never be piped in,
// passed as an argument or left in shell history. The password and its hash
// are never printed. Messages contain no database credentials.
import "dotenv/config";
import { hashPassword, MAX_PASSWORD_LENGTH } from "../auth/password.js";

const MIN_PASSWORD_LENGTH = 12;
// Same limit and normalization as POST /auth/login (src/auth/index.ts).
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class Stop extends Error {}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

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

async function main() {
  if (process.argv.length > 2) {
    throw new Stop("this script takes no arguments; it asks for everything it needs");
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
    // 1. Confirm the target database before asking for any credentials.
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
    const confirmation = await prompt("Type the database name to confirm: ");

    if (confirmation !== connectedDatabase) {
      throw new Stop("the database name was not confirmed; nothing was created");
    }

    // 2. Email: normalized like login, valid, and not already in use.
    const email = normalizeEmail(await prompt("Admin email: "));

    if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
      throw new Stop("that is not a valid email address");
    }

    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new Stop("a user with this email already exists; nothing was changed");
    }

    // 3. Password, twice, never shown.
    const password = await prompt(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `, true);

    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Stop(`the password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new Stop(`the password must be at most ${MAX_PASSWORD_LENGTH} characters`);
    }

    if ((await prompt("Repeat the password: ", true)) !== password) {
      throw new Stop("the passwords do not match");
    }

    // 4. Create the ADMIN user with an Argon2id hash of the password.
    const passwordHash = await hashPassword(password);

    try {
      const user = await prisma.user.create({
        data: { email, passwordHash, role: "ADMIN", active: true },
        select: { id: true, email: true, role: true },
      });

      console.log(`Created ${user.role} user ${user.email} (id ${user.id}) in ${connectedDatabase}.`);
    } catch (error) {
      const code = errorCode(error);

      if (code === "P2002") {
        throw new Stop("a user with this email already exists; nothing was changed");
      }

      throw new Stop(`the user could not be created${code ? ` (code ${code})` : ""}`);
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  if (error instanceof Stop) {
    console.error(`[create-admin] STOP: ${error.message}`);
  } else {
    const code = errorCode(error);
    console.error(`[create-admin] STOP: unexpected error${code ? ` (code ${code})` : ""}`);
  }

  process.exitCode = 1;
});
