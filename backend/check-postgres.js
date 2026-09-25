// Connection diagnostic. Verifies that the configured PostgreSQL target is
// reachable and usable, separately from starting the API, so a setup problem
// can be isolated in one command.
//
//   npm run db:check

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describePostgresTarget, openPostgresDatabase } from "./database-postgres.js";
import { loadEnvFiles } from "./env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFiles(path.resolve(__dirname, ".."));

// This command is always about PostgreSQL, whatever DB_CLIENT happens to say.
process.env.DB_CLIENT = "postgresql";

const target = describePostgresTarget();
console.log(`Checking PostgreSQL at ${target}`);

let pool;
try {
  pool = await openPostgresDatabase();
} catch (error) {
  const hints = [];
  if (error.code === "ECONNREFUSED") {
    hints.push(
      "Nothing is listening at that address.",
      "  - Is the PostgreSQL server installed and running?",
      "  - On Windows, check: Get-Service postgresql*",
      "  - Confirm PGHOST and PGPORT (or DATABASE_URL) in .env",
    );
  } else if (error.code === "28P01" || /password authentication failed/i.test(error.message)) {
    if (process.env.DATABASE_URL || process.env.PGPASSWORD) {
      hints.push(
        "A password WAS supplied, and the server rejected it.",
        "The value in .env is not the password for this role.",
        "",
        "  - Test a candidate without editing .env:",
        "      PGPASSWORD='<candidate>' npm run db:check",
        `  - Confirm the role name is right (PGUSER is currently "${process.env.PGUSER || "postgres"}")`,
        "  - If the password is lost, reset it: see the PostgreSQL section of README.md",
      );
    } else {
      hints.push(
        "No password was supplied.",
        "  - Set PGPASSWORD in .env, or use a full DATABASE_URL",
        "  - TerraSignal never prompts for a password",
      );
    }
  } else if (error.code === "3D000" || /database .* does not exist/i.test(error.message)) {
    hints.push(
      "The database has not been created yet. Create it with:",
      "  npm run db:create",
      "Tables are created automatically on first connect.",
    );
  } else if (error.code === "28000" || /role .* does not exist/i.test(error.message)) {
    hints.push(`The role does not exist. Check PGUSER (currently "${process.env.PGUSER || "postgres"}").`);
  } else if (error.code === "ENOTFOUND") {
    hints.push("The host name could not be resolved. Check PGHOST or the host in DATABASE_URL.");
  }

  console.error(
    JSON.stringify({ ok: false, target, code: error.code || null, error: error.message }, null, 2),
  );
  if (hints.length) console.error(`\n${hints.join("\n")}`);
  process.exit(1);
}

const result = await pool.query(
  "SELECT current_database() AS database, current_user AS user, version() AS version",
);
const tables = await pool.query(
  "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      target,
      database: result.rows[0].database,
      user: result.rows[0].user,
      publicTables: tables.rows[0].count,
      version: result.rows[0].version,
    },
    null,
    2,
  ),
);
await pool.end();
