import {
  createProject as createSqliteProject,
  getProject as getSqliteProject,
  getSurveyRun as getSqliteSurveyRun,
  getDatabaseStatus as getSqliteDatabaseStatus,
  getRun as getSqliteRun,
  listProjects as listSqliteProjects,
  listRuns as listSqliteRuns,
  listSurveyRuns as listSqliteSurveyRuns,
  openDatabase,
  deleteRun as deleteSqliteRun,
  saveRun as saveSqliteRun,
  saveSurveyRun as saveSqliteSurveyRun,
  saveReportAudit as saveSqliteReportAudit,
  getReportAudit as getSqliteReportAudit,
  listPortfolios as listSqlitePortfolios,
  getPortfolio as getSqlitePortfolio,
  savePortfolio as saveSqlitePortfolio,
  deletePortfolio as deleteSqlitePortfolio,
  savePilotRequest as saveSqlitePilotRequest,
  listPilotRequests as listSqlitePilotRequests,
} from "./database.js";
import {
  createProject as createPostgresProject,
  getProject as getPostgresProject,
  getSurveyRun as getPostgresSurveyRun,
  getDatabaseStatus as getPostgresDatabaseStatus,
  getRun as getPostgresRun,
  listProjects as listPostgresProjects,
  listRuns as listPostgresRuns,
  listSurveyRuns as listPostgresSurveyRuns,
  openPostgresDatabase,
  deleteRun as deletePostgresRun,
  saveRun as savePostgresRun,
  saveSurveyRun as savePostgresSurveyRun,
  saveReportAudit as savePostgresReportAudit,
  getReportAudit as getPostgresReportAudit,
  describePostgresTarget,
  listPortfolios as listPostgresPortfolios,
  getPortfolio as getPostgresPortfolio,
  savePortfolio as savePostgresPortfolio,
  deletePortfolio as deletePostgresPortfolio,
  savePilotRequest as savePostgresPilotRequest,
  listPilotRequests as listPostgresPilotRequests,
} from "./database-postgres.js";

// PostgreSQL is the default and only production store.
//
// DB_CLIENT was previously written in two places and read in none, so the
// --sqlite flag and the test suites' DB_CLIENT=sqlite were both no-ops, and
// DB_CLIENT=postgres in .env did nothing. It is now the single switch.
//
// SQLite remains available purely as an explicit opt-in for the test suites,
// which run against :memory: and must not need a database server.
const resolveDatabaseClient = () => {
  const requested = String(process.env.DB_CLIENT || "").trim().toLowerCase();
  if (["sqlite", "sqlite3"].includes(requested)) return "sqlite";
  if (["postgres", "postgresql", "pg"].includes(requested)) return "postgresql";
  if (process.env.TERRASIGNAL_FORCE_POSTGRES === "1") return "postgresql";
  return "postgresql";
};

// Connection failures are the most common setup problem, so the message says
// what to check rather than surfacing a bare ECONNREFUSED.
const postgresFailureGuidance = (error) => {
  const target = describePostgresTarget();
  const lines = [`PostgreSQL connection failed for ${target}.`, `Reason: ${error.message}`, ""];

  if (error.code === "ECONNREFUSED") {
    lines.push(
      "Nothing is listening at that address. Check that the PostgreSQL server is installed and running,",
      "and that PGHOST/PGPORT (or DATABASE_URL) point at it.",
    );
  } else if (error.code === "28P01" || /password authentication failed/i.test(error.message)) {
    const supplied = Boolean(process.env.DATABASE_URL || process.env.PGPASSWORD);
    lines.push(
      supplied
        ? [
            "A password was supplied and the server rejected it, so the value is wrong for this role.",
            `Test a candidate without editing .env:  PGPASSWORD='<candidate>' npm run db:check`,
            "If the password is lost, reset it — see the PostgreSQL section of README.md.",
          ].join("\n")
        : [
            "No password was supplied. Set PGPASSWORD (or a full DATABASE_URL) in .env.",
            "TerraSignal does not prompt for a password.",
          ].join("\n"),
    );
  } else if (error.code === "3D000" || /database .* does not exist/i.test(error.message)) {
    lines.push(
      "The database does not exist yet. Create it with:  npm run db:create",
      "Tables are created automatically on the next start.",
    );
  } else if (error.code === "ENOTFOUND") {
    lines.push("The host name could not be resolved. Check PGHOST or the host in DATABASE_URL.");
  } else if (error.code === "28000" || /role .* does not exist/i.test(error.message)) {
    lines.push(`The role does not exist. Check PGUSER (currently "${process.env.PGUSER || "postgres"}").`);
  }

  lines.push("", "Verify the connection on its own with:  npm run db:check");
  return lines.join("\n");
};

const sqliteStore = (db) => ({
  kind: "sqlite",
  db,
  listProjects: async () => listSqliteProjects(db),
  getProject: async (projectId) => getSqliteProject(db, projectId),
  createProject: async (project) => createSqliteProject(db, project),
  listSurveyRuns: async (projectId) => listSqliteSurveyRuns(db, projectId),
  getSurveyRun: async (runId) => getSqliteSurveyRun(db, runId),
  saveSurveyRun: async (run) => saveSqliteSurveyRun(db, run),
  saveRun: async (run) => saveSqliteRun(db, run),
  listRuns: async (projectId = null) => listSqliteRuns(db, projectId),
  getRun: async (runId) => getSqliteRun(db, runId),
  deleteRun: async (runId) => deleteSqliteRun(db, runId),
  saveReportAudit: async (audit) => saveSqliteReportAudit(db, audit),
  getReportAudit: async (reportId) => getSqliteReportAudit(db, reportId),
  listPortfolios: async (userId) => listSqlitePortfolios(db, userId),
  getPortfolio: async (portfolioId) => getSqlitePortfolio(db, portfolioId),
  savePortfolio: async (portfolio) => saveSqlitePortfolio(db, portfolio),
  deletePortfolio: async (portfolioId) => deleteSqlitePortfolio(db, portfolioId),
  savePilotRequest: async (request) => saveSqlitePilotRequest(db, request),
  listPilotRequests: async () => listSqlitePilotRequests(db),
  getDatabaseStatus: async () => getSqliteDatabaseStatus(db),
  close: async () => db.close?.(),
});

const postgresStore = (pool) => ({
  kind: "postgresql",
  db: pool,
  listProjects: async () => listPostgresProjects(pool),
  getProject: async (projectId) => getPostgresProject(pool, projectId),
  createProject: async (project) => createPostgresProject(pool, project),
  listSurveyRuns: async (projectId) => listPostgresSurveyRuns(pool, projectId),
  getSurveyRun: async (runId) => getPostgresSurveyRun(pool, runId),
  saveSurveyRun: async (run) => savePostgresSurveyRun(pool, run),
  saveRun: async (run) => savePostgresRun(pool, run),
  listRuns: async (projectId = null) => listPostgresRuns(pool, projectId),
  getRun: async (runId) => getPostgresRun(pool, runId),
  deleteRun: async (runId) => deletePostgresRun(pool, runId),
  saveReportAudit: async (audit) => savePostgresReportAudit(pool, audit),
  getReportAudit: async (reportId) => getPostgresReportAudit(pool, reportId),
  listPortfolios: async (userId) => listPostgresPortfolios(pool, userId),
  getPortfolio: async (portfolioId) => getPostgresPortfolio(pool, portfolioId),
  savePortfolio: async (portfolio) => savePostgresPortfolio(pool, portfolio),
  deletePortfolio: async (portfolioId) => deletePostgresPortfolio(pool, portfolioId),
  savePilotRequest: async (request) => savePostgresPilotRequest(pool, request),
  listPilotRequests: async () => listPostgresPilotRequests(pool),
  getDatabaseStatus: async () => getPostgresDatabaseStatus(pool),
  close: async () => pool.end(),
});

export const openStore = async () => {
  const client = resolveDatabaseClient();

  if (client === "postgresql") {
    // No fallback. Silently dropping to SQLite meant the server could report
    // healthy while writing to a different database than the operator expected.
    try {
      const store = postgresStore(await openPostgresDatabase());
      console.log(`Database: PostgreSQL — connected to ${describePostgresTarget()}`);
      return store;
    } catch (error) {
      throw new Error(postgresFailureGuidance(error), { cause: error });
    }
  }

  const store = sqliteStore(openDatabase());
  console.log(`Database: SQLite (explicit DB_CLIENT=sqlite) at ${process.env.TERRASIGNAL_DB_PATH || "./data/terrasignal.sqlite"}`);
  return store;
};
