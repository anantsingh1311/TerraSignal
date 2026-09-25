import { randomUUID } from "node:crypto";
import pg from "pg";
import { projects } from "./seed-data.js";
import { sanitizeStorageText, toStorageJson } from "./storage-sanitizer.js";

const { Pool } = pg;

const now = () => new Date().toISOString();
// Keep JSON cleanup centralized at the persistence boundary.
const toJson = toStorageJson;
const fromJson = (value, fallback) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// Connection settings come from the environment only. This module never
// prompts: a persistence layer that reads from a TTY cannot run under a
// service manager, a container, CI, or any non-interactive shell.
//
// Either DATABASE_URL or the discrete PG* variables work. Password may be
// empty when the server uses trust or peer authentication.
export const pgSettings = () => ({
  url: process.env.DATABASE_URL || "",
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "terrasignal",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "",
  ssl: ["1", "true", "require"].includes(String(process.env.PGSSL || "").toLowerCase()),
});

// Human-readable target with the password redacted, for logs and errors.
export const describePostgresTarget = () => {
  const settings = pgSettings();
  if (settings.url) {
    try {
      const parsed = new URL(settings.url);
      return `${parsed.username || "(default user)"}@${parsed.hostname}:${parsed.port || 5432}/${parsed.pathname.replace(/^\//, "") || "(default db)"} (from DATABASE_URL)`;
    } catch {
      return "DATABASE_URL (unparseable)";
    }
  }
  return `${settings.user}@${settings.host}:${settings.port}/${settings.database} (from PG* variables)`;
};

const pgConfigFromEnv = () => {
  const settings = pgSettings();
  const config = settings.url
    ? { connectionString: settings.url }
    : {
        host: settings.host,
        port: settings.port,
        database: settings.database,
        user: settings.user,
        // An empty password is valid under trust/peer auth, so it is passed
        // through rather than treated as a missing value.
        ...(settings.password ? { password: settings.password } : {}),
      };

  if (settings.ssl) {
    config.ssl = { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" };
  }

  return config;
};

export const openPostgresDatabase = async () => {
  const pool = new Pool({
    ...pgConfigFromEnv(),
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS || 10000),
  });

  await pool.query("SELECT 1");
  await migrate(pool);
  await seedDatabase(pool);
  return pool;
};

const migrate = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plan TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      client TEXT NOT NULL,
      location TEXT NOT NULL,
      coordinates TEXT NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      site_radius_meters DOUBLE PRECISION,
      description TEXT,
      survey_objective TEXT,
      risk_context TEXT,
      visualization_preset TEXT,
      stage TEXT NOT NULL,
      area_ha DOUBLE PRECISION NOT NULL,
      target TEXT NOT NULL,
      due TEXT NOT NULL,
      budget TEXT NOT NULL,
      methods_json JSONB NOT NULL,
      constraints_json JSONB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS survey_points (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      station_id TEXT NOT NULL,
      x DOUBLE PRECISION NOT NULL,
      y DOUBLE PRECISION NOT NULL,
      depth DOUBLE PRECISION NOT NULL,
      resistivity DOUBLE PRECISION NOT NULL,
      velocity DOUBLE PRECISION NOT NULL,
      magnetic DOUBLE PRECISION NOT NULL,
      noise DOUBLE PRECISION NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (project_id, station_id)
    );

    CREATE TABLE IF NOT EXISTS survey_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      dataset_label TEXT NOT NULL,
      file_name TEXT,
      settings_json JSONB NOT NULL,
      input_points_json JSONB NOT NULL,
      analyzed_json JSONB NOT NULL,
      summary_json JSONB NOT NULL,
      warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      row_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      anomaly_count INTEGER NOT NULL DEFAULT 0,
      high_risk_count INTEGER NOT NULL DEFAULT 0,
      report_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_runs (
      id UUID PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      location_name TEXT NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      coordinate_mode TEXT NOT NULL,
      anomaly_count INTEGER NOT NULL DEFAULT 0,
      high_risk_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      input_data JSONB NOT NULL,
      analysis_result JSONB NOT NULL,
      report_summary TEXT NOT NULL,
      visualization_settings JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS site_portfolios (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT 'balanced',
      weight_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
      scan_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_site_portfolios_user
      ON site_portfolios (user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS pilot_requests (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      organisation TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      use_case TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new'
    );

    CREATE TABLE IF NOT EXISTS report_audits (
      report_id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_input JSONB NOT NULL,
      audit_snapshot JSONB NOT NULL,
      pdf_path TEXT,
      report_text TEXT,
      status TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_saved_runs_project_created
      ON saved_runs (project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_report_audits_created
      ON report_audits (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_survey_runs_project_created
      ON survey_runs (project_id, created_at DESC);
  `);

  await pool.query(`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS site_radius_meters DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS survey_objective TEXT,
      ADD COLUMN IF NOT EXISTS risk_context TEXT,
      ADD COLUMN IF NOT EXISTS visualization_preset TEXT;
  `);

  await pool.query(`
    ALTER TABLE survey_runs
      ADD COLUMN IF NOT EXISTS file_name TEXT,
      ADD COLUMN IF NOT EXISTS warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS row_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS warning_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS anomaly_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS high_risk_count INTEGER NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE saved_runs
      ADD COLUMN IF NOT EXISTS location_name TEXT NOT NULL DEFAULT 'Unknown',
      ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS coordinate_mode TEXT NOT NULL DEFAULT 'local_xy',
      ADD COLUMN IF NOT EXISTS anomaly_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS high_risk_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS analysis_result JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS report_summary TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS visualization_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
};

const seedDatabase = async (pool) => {
  await pool.query(
    `INSERT INTO tenants (id, name, plan, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    ["demo-builder-consultancy", "Demo Builder Consultancy", "consultancy-mvp", now()],
  );

  const client = await pool.connect();
  const createdAt = now();
  try {
    await client.query("BEGIN");
    for (const project of projects) {
      await client.query(
        `INSERT INTO projects (
          id, tenant_id, name, client, location, coordinates, latitude, longitude,
          site_radius_meters, description, survey_objective, risk_context, visualization_preset,
          stage, area_ha, target, due, budget, methods_json, constraints_json, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21, $22
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          sanitizeStorageText(project.id),
          "demo-builder-consultancy",
          sanitizeStorageText(project.name),
          sanitizeStorageText(project.client),
          sanitizeStorageText(project.location),
          sanitizeStorageText(project.coordinates),
          project.latitude,
          project.longitude,
          project.siteRadiusMeters,
          sanitizeStorageText(project.description),
          sanitizeStorageText(project.surveyObjective),
          sanitizeStorageText(project.riskContext),
          sanitizeStorageText(project.visualizationPreset),
          sanitizeStorageText(project.stage),
          project.areaHa,
          sanitizeStorageText(project.target),
          sanitizeStorageText(project.due),
          sanitizeStorageText(project.budget),
          toJson(project.methods),
          toJson(project.constraints),
          createdAt,
          createdAt,
        ],
      );

      for (const point of project.points) {
        await client.query(
          `INSERT INTO survey_points (
            project_id, station_id, x, y, depth, resistivity, velocity, magnetic, noise, source
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (project_id, station_id) DO NOTHING`,
          [
            sanitizeStorageText(project.id),
            sanitizeStorageText(point.id),
            point.x,
            point.y,
            point.depth,
            point.resistivity,
            point.velocity,
            point.magnetic,
            point.noise,
            sanitizeStorageText(point.source, "sample"),
          ],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const rowToProject = (row, points = []) => ({
  id: row.id,
  name: row.name,
  client: row.client,
  location: row.location,
  coordinates: row.coordinates,
  latitude: row.latitude === null || row.latitude === undefined ? Number(row.coordinates.match(/[-\d.]+/)?.[0] ?? 0) : Number(row.latitude),
  longitude:
    row.longitude === null || row.longitude === undefined
      ? -Number(row.coordinates.match(/,\s*([\d.]+)/)?.[1] ?? 0)
      : Number(row.longitude),
  siteRadiusMeters: row.site_radius_meters === null || row.site_radius_meters === undefined ? 220 : Number(row.site_radius_meters),
  description: row.description ?? row.target,
  surveyObjective: row.survey_objective ?? row.target,
  riskContext: row.risk_context ?? row.target,
  visualizationPreset: row.visualization_preset ?? "urban",
  stage: row.stage,
  areaHa: Number(row.area_ha),
  target: row.target,
  due: row.due,
  budget: row.budget,
  methods: fromJson(row.methods_json, []),
  constraints: fromJson(row.constraints_json, []),
  points,
});

const pointRowsForProject = async (pool, projectId) => {
  const result = await pool.query(
    `SELECT station_id, x, y, depth, resistivity, velocity, magnetic, noise, source
     FROM survey_points
     WHERE project_id = $1
     ORDER BY station_id`,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.station_id,
    x: Number(row.x),
    y: Number(row.y),
    depth: Number(row.depth),
    resistivity: Number(row.resistivity),
    velocity: Number(row.velocity),
    magnetic: Number(row.magnetic),
    noise: Number(row.noise),
    source: row.source,
  }));
};

export const listProjects = async (pool) => {
  const result = await pool.query("SELECT * FROM projects ORDER BY due ASC");
  return Promise.all(
    result.rows.map(async (row) => rowToProject(row, await pointRowsForProject(pool, row.id))),
  );
};

export const getProject = async (pool, projectId) => {
  const result = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
  const row = result.rows[0];
  if (!row) return null;
  return rowToProject(row, await pointRowsForProject(pool, projectId));
};

export const createProject = async (pool, project) => {
  const id = project.id || randomUUID();
  const createdAt = now();
  const normalized = {
    id: sanitizeStorageText(id),
    tenantId: "demo-builder-consultancy",
    name: sanitizeStorageText(project.name || "Untitled Site"),
    client: sanitizeStorageText(project.client || "Unassigned Client"),
    location: sanitizeStorageText(project.location || "Unknown"),
    coordinates: sanitizeStorageText(project.coordinates || "Not set"),
    latitude: Number(project.latitude ?? 0),
    longitude: Number(project.longitude ?? 0),
    siteRadiusMeters: Number(project.siteRadiusMeters ?? 220),
    description: sanitizeStorageText(project.description || project.target || "Geospatial screening"),
    surveyObjective: sanitizeStorageText(project.surveyObjective || project.target || "Preliminary screening"),
    riskContext: sanitizeStorageText(project.riskContext || project.target || "Review required"),
    visualizationPreset: sanitizeStorageText(project.visualizationPreset || "urban"),
    stage: sanitizeStorageText(project.stage || "Feasibility"),
    areaHa: Number(project.areaHa || 1),
    target: sanitizeStorageText(project.target || "Geophysical screening"),
    due: sanitizeStorageText(project.due || createdAt.slice(0, 10)),
    budget: sanitizeStorageText(project.budget || "$0"),
    methods: Array.isArray(project.methods) ? project.methods : ["ERT"],
    constraints: Array.isArray(project.constraints) ? project.constraints : [],
    points: Array.isArray(project.points) ? project.points : [],
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO projects (
        id, tenant_id, name, client, location, coordinates, latitude, longitude,
        site_radius_meters, description, survey_objective, risk_context, visualization_preset,
        stage, area_ha, target, due, budget, methods_json, constraints_json, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21, $22
      )`,
      [
        normalized.id,
        normalized.tenantId,
        normalized.name,
        normalized.client,
        normalized.location,
        normalized.coordinates,
        normalized.latitude,
        normalized.longitude,
        normalized.siteRadiusMeters,
        normalized.description,
        normalized.surveyObjective,
        normalized.riskContext,
        normalized.visualizationPreset,
        normalized.stage,
        normalized.areaHa,
        normalized.target,
        normalized.due,
        normalized.budget,
        toJson(normalized.methods),
        toJson(normalized.constraints),
        createdAt,
        createdAt,
      ],
    );

    for (const point of normalized.points) {
      await client.query(
        `INSERT INTO survey_points (
          project_id, station_id, x, y, depth, resistivity, velocity, magnetic, noise, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          normalized.id,
          sanitizeStorageText(point.id || randomUUID()),
          point.x,
          point.y,
          point.depth,
          point.resistivity,
          point.velocity,
          point.magnetic,
          point.noise,
          sanitizeStorageText(point.source ?? "upload", "upload"),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getProject(pool, normalized.id);
};

const rowToSavedRun = (row) => {
  const inputData = fromJson(row.input_data, {});
  const analysisResult = fromJson(row.analysis_result, {});
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    locationName: row.location_name,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    coordinateMode: row.coordinate_mode,
    datasetLabel: inputData.datasetLabel ?? row.report_summary ?? "Saved survey run",
    fileName: inputData.fileName ?? null,
    settings: inputData.settings ?? {},
    inputPoints: inputData.points ?? [],
    analyzed: analysisResult.analyzed ?? [],
    summary: analysisResult.summary ?? {},
    warnings: inputData.warnings ?? [],
    rowCount: inputData.points?.length ?? 0,
    warningCount: inputData.warnings?.length ?? 0,
    anomalyCount: row.anomaly_count,
    highRiskCount: row.high_risk_count,
    reportText: analysisResult.reportText ?? "",
    reportSummary: row.report_summary,
    visualizationSettings: fromJson(row.visualization_settings, {}),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
};

export const saveRun = async (
  pool,
  {
    id = randomUUID(),
    projectId,
    projectName = "Untitled Project",
    locationName = "Unknown",
    latitude = null,
    longitude = null,
    coordinateMode = "local_xy",
    datasetLabel = "Saved survey run",
    fileName = null,
    settings = {},
    inputPoints = [],
    analyzed = [],
    summary = {},
    reportText = "",
    warnings = [],
    visualizationSettings = {},
  },
) => {
  const anomalyCount = (summary.priorityFindings ?? analyzed).filter((point) => point.riskLevel !== "LOW").length;
  const highRiskCount = summary.highRisk ?? analyzed.filter((point) => point.riskLevel === "HIGH").length;
  const inputData = {
    datasetLabel,
    fileName,
    settings,
    points: inputPoints,
    warnings,
  };
  const analysisResult = {
    analyzed,
    summary,
    reportText,
  };
  await pool.query(
    `INSERT INTO saved_runs (
      id, project_id, project_name, location_name, latitude, longitude, coordinate_mode,
      anomaly_count, high_risk_count, input_data, analysis_result, report_summary,
      visualization_settings
    ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13::jsonb)`,
    [
      id,
      projectId,
      sanitizeStorageText(projectName),
      sanitizeStorageText(locationName),
      latitude,
      longitude,
      sanitizeStorageText(coordinateMode, "local_xy"),
      anomalyCount,
      highRiskCount,
      toJson(inputData),
      toJson(analysisResult),
      sanitizeStorageText(datasetLabel, "Saved survey run"),
      toJson(visualizationSettings),
    ],
  );
  return getSurveyRun(pool, id);
};

export const saveSurveyRun = async (pool, run) => saveRun(pool, run);

export const listRuns = async (pool, projectId = null) => {
  const result = projectId
    ? await pool.query(
        `SELECT * FROM saved_runs
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [projectId],
      )
    : await pool.query(
        `SELECT * FROM saved_runs
         ORDER BY created_at DESC
         LIMIT 50`,
      );
  return result.rows.map(rowToSavedRun);
};

export const getRun = async (pool, runId) => {
  const result = await pool.query("SELECT * FROM saved_runs WHERE id = $1::uuid", [runId]);
  const row = result.rows[0];
  return row ? rowToSavedRun(row) : null;
};

export const deleteRun = async (pool, runId) => {
  const result = await pool.query("DELETE FROM saved_runs WHERE id = $1::uuid", [runId]);
  return result.rowCount > 0;
};

export const saveReportAudit = async (
  pool,
  { reportId, createdAt = now(), userInput = {}, auditSnapshot, pdfPath = null, reportText = "", status = "generated" },
) => {
  await pool.query(
    `INSERT INTO report_audits (
      report_id, created_at, user_input, audit_snapshot, pdf_path, report_text, status
    ) VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
    ON CONFLICT (report_id) DO UPDATE SET
      created_at = EXCLUDED.created_at,
      user_input = EXCLUDED.user_input,
      audit_snapshot = EXCLUDED.audit_snapshot,
      pdf_path = EXCLUDED.pdf_path,
      report_text = EXCLUDED.report_text,
      status = EXCLUDED.status`,
    [reportId, createdAt, toJson(userInput), toJson(auditSnapshot), pdfPath, sanitizeStorageText(reportText), sanitizeStorageText(status, "generated")],
  );
  return getReportAudit(pool, reportId);
};

export const getReportAudit = async (pool, reportId) => {
  const result = await pool.query("SELECT * FROM report_audits WHERE report_id = $1::uuid", [reportId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    reportId: row.report_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    userInput: fromJson(row.user_input, {}),
    auditSnapshot: fromJson(row.audit_snapshot, null),
    pdfPath: row.pdf_path,
    reportText: row.report_text,
    status: row.status,
  };
};

export const getDatabaseStatus = async (pool) => {
  await pool.query("SELECT 1");
  return {
    database: "postgresql",
    databaseConnected: true,
    mode: process.env.NODE_ENV || "development",
  };
};

export const listSurveyRuns = async (pool, projectId) => {
  const runs = await listRuns(pool, projectId);
  return runs.map((run) => ({
    ...run,
    inputPoints: undefined,
    analyzed: undefined,
    reportText: undefined,
  }));
};

export const getSurveyRun = async (pool, runId) => {
  const savedRun = await getRun(pool, runId);
  if (savedRun) return savedRun;

  const result = await pool.query("SELECT * FROM survey_runs WHERE id = $1", [runId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    datasetLabel: row.dataset_label,
    fileName: row.file_name,
    settings: fromJson(row.settings_json, {}),
    inputPoints: fromJson(row.input_points_json, []),
    analyzed: fromJson(row.analyzed_json, []),
    summary: fromJson(row.summary_json, {}),
    warnings: fromJson(row.warnings_json, []),
    rowCount: row.row_count,
    warningCount: row.warning_count,
    anomalyCount: row.anomaly_count,
    highRiskCount: row.high_risk_count,
    reportText: row.report_text,
    createdAt: row.created_at,
  };
};

// --- Site portfolios -------------------------------------------------------

const isoDate = (value) => (value instanceof Date ? value.toISOString() : value);

const rowToPortfolio = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  description: row.description,
  profileId: row.profile_id,
  weightOverrides: fromJson(row.weight_overrides, {}),
  scanIds: fromJson(row.scan_ids, []),
  createdAt: isoDate(row.created_at),
  updatedAt: isoDate(row.updated_at),
});

export const listPortfolios = async (pool, userId) => {
  const result = await pool.query(
    "SELECT * FROM site_portfolios WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100",
    [userId],
  );
  return result.rows.map(rowToPortfolio);
};

export const getPortfolio = async (pool, portfolioId) => {
  const result = await pool.query("SELECT * FROM site_portfolios WHERE id = $1::uuid", [portfolioId]);
  return result.rows[0] ? rowToPortfolio(result.rows[0]) : null;
};

export const savePortfolio = async (
  pool,
  { id = randomUUID(), userId, name, description = "", profileId = "balanced", weightOverrides = {}, scanIds = [], createdAt = null },
) => {
  const timestamp = now();
  await pool.query(
    `INSERT INTO site_portfolios (
       id, user_id, name, description, profile_id, weight_overrides, scan_ids, created_at, updated_at
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       profile_id = EXCLUDED.profile_id,
       weight_overrides = EXCLUDED.weight_overrides,
       scan_ids = EXCLUDED.scan_ids,
       updated_at = EXCLUDED.updated_at`,
    [
      id,
      sanitizeStorageText(userId),
      sanitizeStorageText(name, "Untitled portfolio"),
      sanitizeStorageText(description, ""),
      sanitizeStorageText(profileId, "balanced"),
      toJson(weightOverrides),
      toJson(scanIds),
      createdAt || timestamp,
      timestamp,
    ],
  );
  return getPortfolio(pool, id);
};

export const deletePortfolio = async (pool, portfolioId) => {
  const result = await pool.query("DELETE FROM site_portfolios WHERE id = $1::uuid", [portfolioId]);
  return result.rowCount > 0;
};

// --- Pilot requests --------------------------------------------------------

export const savePilotRequest = async (
  pool,
  { id = randomUUID(), organisation, contactName, contactEmail, role = "", useCase = "", message = "" },
) => {
  const createdAt = now();
  await pool.query(
    `INSERT INTO pilot_requests (
       id, created_at, organisation, contact_name, contact_email, role, use_case, message, status
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'new')`,
    [
      id,
      createdAt,
      sanitizeStorageText(organisation),
      sanitizeStorageText(contactName),
      sanitizeStorageText(contactEmail),
      sanitizeStorageText(role, ""),
      sanitizeStorageText(useCase, ""),
      sanitizeStorageText(message, ""),
    ],
  );
  return { id, createdAt, status: "new" };
};

export const listPilotRequests = async (pool) => {
  const result = await pool.query("SELECT * FROM pilot_requests ORDER BY created_at DESC LIMIT 200");
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: isoDate(row.created_at),
    organisation: row.organisation,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    role: row.role,
    useCase: row.use_case,
    message: row.message,
    status: row.status,
  }));
};
