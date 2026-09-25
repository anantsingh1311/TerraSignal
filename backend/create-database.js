// Creates the application database if it does not exist yet.
//
//   npm run db:create
//
// Connects to the "postgres" maintenance database with the same credentials the
// app uses, so it needs no extra configuration. Idempotent: running it against
// an existing database reports that and exits successfully.
//
// Table creation is separate and automatic — the server migrates on first
// connect. This script only handles the one step that cannot bootstrap itself.

import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnvFiles } from "./env.js";
import { pgSettings } from "./database-postgres.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFiles(path.resolve(__dirname, ".."));

const settings = pgSettings();

// Resolve the target name and the admin connection from whichever form of
// configuration is in use.
let targetDatabase = settings.database;
let adminConfig;

if (settings.url) {
  const parsed = new URL(settings.url);
  targetDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || settings.database;
  // Same server and credentials, but pointed at the maintenance database.
  parsed.pathname = "/postgres";
  adminConfig = { connectionString: parsed.toString() };
} else {
  adminConfig = {
    host: settings.host,
    port: settings.port,
    database: "postgres",
    user: settings.user,
    ...(settings.password ? { password: settings.password } : {}),
  };
}

if (settings.ssl) {
  adminConfig.ssl = { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" };
}

// Guard the identifier: it is interpolated into DDL, which cannot take a bound
// parameter for an object name.
if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(targetDatabase)) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: `Refusing to create a database named "${targetDatabase}". Use letters, digits and underscores, starting with a letter or underscore.`,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const client = new Client(adminConfig);

try {
  await client.connect();
} catch (error) {
  console.error(
    JSON.stringify(
      { ok: false, step: "connect", code: error.code || null, error: error.message },
      null,
      2,
    ),
  );
  if (error.code === "28P01") {
    console.error("\nCredentials were rejected. Check PGPASSWORD in .env.");
  } else if (error.code === "ECONNREFUSED") {
    console.error("\nPostgreSQL is not reachable. Is the service running?");
  }
  process.exit(1);
}

try {
  const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDatabase]);

  if (existing.rowCount > 0) {
    console.log(JSON.stringify({ ok: true, database: targetDatabase, created: false, message: "Database already exists." }, null, 2));
  } else {
    // Identifier is validated above; quoted to survive case-sensitivity.
    await client.query(`CREATE DATABASE "${targetDatabase}"`);
    console.log(
      JSON.stringify(
        {
          ok: true,
          database: targetDatabase,
          created: true,
          message: "Database created. Tables are created automatically on the next server start.",
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(
    JSON.stringify({ ok: false, step: "create", code: error.code || null, error: error.message }, null, 2),
  );
  if (error.code === "42501") {
    console.error(`\nRole "${settings.user}" lacks CREATEDB privilege. Grant it, or create the database as a superuser.`);
  }
  process.exit(1);
} finally {
  await client.end();
}
