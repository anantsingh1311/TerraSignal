import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projects } from "./seed-data.js";
import { sanitizeStorageText, toStorageJson } from "./storage-sanitizer.js";

const now = () => new Date().toISOString();
// Keep JSON cleanup centralized at the persistence boundary.
const toJson = toStorageJson;
const fromJson = (value, fallback) => {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const openDatabase = (dbFile = process.env.TERRASIGNAL_DB_PATH || "data/terrasignal.sqlite") => {
  const isMemoryDatabase = dbFile === ":memory:";
  const resolved = isMemoryDatabase ? dbFile : path.resolve(dbFile);
  const directory = isMemoryDatabase ? null : path.dirname(resolved);
  if (directory && !existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  seedDatabase(db);
  return db;
};

const migrate = (db) => {
  db.exec(`
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
      latitude REAL,
      longitude REAL,
      site_radius_meters REAL,
      description TEXT,
      survey_objective TEXT,
      risk_context TEXT,
      visualization_preset TEXT,
      stage TEXT NOT NULL,
      area_ha REAL NOT NULL,
      target TEXT NOT NULL,
      due TEXT NOT NULL,
      budget TEXT NOT NULL,
      methods_json TEXT NOT NULL,
      constraints_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS survey_points (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      station_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      depth REAL NOT NULL,
      resistivity REAL NOT NULL,
      velocity REAL NOT NULL,
      magnetic REAL NOT NULL,
      noise REAL NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (project_id, station_id)
    );

    CREATE TABLE IF NOT EXISTS survey_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      dataset_label TEXT NOT NULL,
      file_name TEXT,
      settings_json TEXT NOT NULL,
      input_points_json TEXT NOT NULL,
      analyzed_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      row_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      anomaly_count INTEGER NOT NULL DEFAULT 0,
      high_risk_count INTEGER NOT NULL DEFAULT 0,
      report_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      location_name TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      coordinate_mode TEXT NOT NULL,
      anomaly_count INTEGER NOT NULL DEFAULT 0,
      high_risk_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      input_data_json TEXT NOT NULL,
      analysis_result_json TEXT NOT NULL,
      report_summary TEXT NOT NULL,
      visualization_settings_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS site_portfolios (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT 'balanced',
      weight_overrides_json TEXT NOT NULL DEFAULT '{}',
      scan_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_site_portfolios_user ON site_portfolios(user_id);

    CREATE TABLE IF NOT EXISTS pilot_requests (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      organisation TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      use_case TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new'
    );

    CREATE TABLE IF NOT EXISTS report_audits (
      report_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      user_input_json TEXT NOT NULL,
      audit_snapshot_json TEXT NOT NULL,
      pdf_path TEXT,
      report_text TEXT,
      status TEXT NOT NULL
    );
  `);

  const columns = new Set(db.prepare("PRAGMA table_info(survey_runs)").all().map((row) => row.name));
  const addColumn = (name, definition) => {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE survey_runs ADD COLUMN ${name} ${definition};`);
    }
  };
  addColumn("file_name", "TEXT");
  addColumn("warnings_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("row_count", "INTEGER NOT NULL DEFAULT 0");
  addColumn("warning_count", "INTEGER NOT NULL DEFAULT 0");
  addColumn("anomaly_count", "INTEGER NOT NULL DEFAULT 0");
  addColumn("high_risk_count", "INTEGER NOT NULL DEFAULT 0");

  const projectColumns = new Set(db.prepare("PRAGMA table_info(projects)").all().map((row) => row.name));
  const addProjectColumn = (name, definition) => {
    if (!projectColumns.has(name)) {
      db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition};`);
    }
  };
  addProjectColumn("latitude", "REAL");
  addProjectColumn("longitude", "REAL");
  addProjectColumn("site_radius_meters", "REAL");
  addProjectColumn("description", "TEXT");
  addProjectColumn("survey_objective", "TEXT");
  addProjectColumn("risk_context", "TEXT");
  addProjectColumn("visualization_preset", "TEXT");

  const savedRunColumns = new Set(db.prepare("PRAGMA table_info(saved_runs)").all().map((row) => row.name));
  const addSavedRunColumn = (name, definition) => {
    if (!savedRunColumns.has(name)) {
      db.exec(`ALTER TABLE saved_runs ADD COLUMN ${name} ${definition};`);
    }
  };
  addSavedRunColumn("location_name", "TEXT NOT NULL DEFAULT 'Unknown'");
  addSavedRunColumn("latitude", "REAL");
  addSavedRunColumn("longitude", "REAL");
  addSavedRunColumn("coordinate_mode", "TEXT NOT NULL DEFAULT 'local_xy'");
  addSavedRunColumn("anomaly_count", "INTEGER NOT NULL DEFAULT 0");
  addSavedRunColumn("high_risk_count", "INTEGER NOT NULL DEFAULT 0");
  addSavedRunColumn("input_data_json", "TEXT NOT NULL DEFAULT '{}'");
  addSavedRunColumn("analysis_result_json", "TEXT NOT NULL DEFAULT '{}'");
  addSavedRunColumn("report_summary", "TEXT NOT NULL DEFAULT ''");
  addSavedRunColumn("visualization_settings_json", "TEXT NOT NULL DEFAULT '{}'");
};

const seedDatabase = (db) => {
  const tenant = db.prepare("SELECT id FROM tenants WHERE id = ?").get("demo-builder-consultancy");
  if (!tenant) {
    db.prepare("INSERT INTO tenants (id, name, plan, created_at) VALUES (?, ?, ?, ?)").run(
      "demo-builder-consultancy",
      "Demo Builder Consultancy",
      "consultancy-mvp",
      now(),
    );
  }

  const insertProject = db.prepare(`
    INSERT OR IGNORE INTO projects (
      id, tenant_id, name, client, location, coordinates, latitude, longitude,
      site_radius_meters, description, survey_objective, risk_context, visualization_preset,
      stage, area_ha, target, due, budget, methods_json, constraints_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPoint = db.prepare(`
    INSERT OR IGNORE INTO survey_points (
      project_id, station_id, x, y, depth, resistivity, velocity, magnetic, noise, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const createdAt = now();
  db.exec("BEGIN");
  try {
    for (const project of projects) {
      insertProject.run(
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
      );

      for (const point of project.points) {
        insertPoint.run(
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
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

const rowToProject = (row, points = []) => ({
  id: row.id,
  name: row.name,
  client: row.client,
  location: row.location,
  coordinates: row.coordinates,
  latitude: row.latitude ?? Number(row.coordinates.match(/[-\d.]+/)?.[0] ?? 0),
  longitude: row.longitude ?? -Number(row.coordinates.match(/,\s*([\d.]+)/)?.[1] ?? 0),
  siteRadiusMeters: row.site_radius_meters ?? 220,
  description: row.description ?? row.target,
  surveyObjective: row.survey_objective ?? row.target,
  riskContext: row.risk_context ?? row.target,
  visualizationPreset: row.visualization_preset ?? "urban",
  stage: row.stage,
  areaHa: row.area_ha,
  target: row.target,
  due: row.due,
  budget: row.budget,
  methods: fromJson(row.methods_json, []),
  constraints: fromJson(row.constraints_json, []),
  points,
});

const pointRowsForProject = (db, projectId) =>
  db
    .prepare(
      `SELECT station_id, x, y, depth, resistivity, velocity, magnetic, noise, source
       FROM survey_points
       WHERE project_id = ?
       ORDER BY station_id`,
    )
    .all(projectId)
    .map((row) => ({
      id: row.station_id,
      x: row.x,
      y: row.y,
      depth: row.depth,
      resistivity: row.resistivity,
      velocity: row.velocity,
      magnetic: row.magnetic,
      noise: row.noise,
      source: row.source,
    }));

export const listProjects = (db) =>
  db
    .prepare("SELECT * FROM projects ORDER BY due ASC")
    .all()
    .map((row) => rowToProject(row, pointRowsForProject(db, row.id)));

export const getProject = (db, projectId) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!row) return null;
  return rowToProject(row, pointRowsForProject(db, projectId));
};

export const createProject = (db, project) => {
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

  db.prepare(
    `INSERT INTO projects (
      id, tenant_id, name, client, location, coordinates, latitude, longitude,
      site_radius_meters, description, survey_objective, risk_context, visualization_preset,
      stage, area_ha, target, due, budget, methods_json, constraints_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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
  );

  const insertPoint = db.prepare(`
    INSERT INTO survey_points (
      project_id, station_id, x, y, depth, resistivity, velocity, magnetic, noise, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const point of normalized.points) {
    insertPoint.run(
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
  );
  }

  return getProject(db, normalized.id);
};

const runRowToSurveyRun = (row) => {
  const inputData = fromJson(row.input_data_json, {});
  const analysisResult = fromJson(row.analysis_result_json, {});
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    locationName: row.location_name,
    latitude: row.latitude,
    longitude: row.longitude,
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
    visualizationSettings: fromJson(row.visualization_settings_json, {}),
    createdAt: row.created_at,
  };
};

export const saveRun = (
  db,
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
  const createdAt = now();
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

  db.prepare(
    `INSERT INTO saved_runs (
      id, project_id, project_name, location_name, latitude, longitude, coordinate_mode,
      anomaly_count, high_risk_count, created_at, input_data_json, analysis_result_json,
      report_summary, visualization_settings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    sanitizeStorageText(projectId),
    sanitizeStorageText(projectName),
    sanitizeStorageText(locationName),
    latitude,
    longitude,
    sanitizeStorageText(coordinateMode, "local_xy"),
    anomalyCount,
    highRiskCount,
    createdAt,
    toJson(inputData),
    toJson(analysisResult),
    sanitizeStorageText(datasetLabel, "Saved survey run"),
    toJson(visualizationSettings),
  );

  return getRun(db, id);
};

export const saveSurveyRun = (db, run) => {
  const saved = saveRun(db, run);
  return saved;
};

export const listRuns = (db, projectId = null) => {
  const query = projectId
    ? db.prepare(
        `SELECT * FROM saved_runs
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
      )
    : db.prepare(
        `SELECT * FROM saved_runs
         ORDER BY created_at DESC
         LIMIT 50`,
      );
  const rows = projectId ? query.all(projectId) : query.all();
  return rows.map(runRowToSurveyRun);
};

export const getRun = (db, runId) => {
  const row = db.prepare("SELECT * FROM saved_runs WHERE id = ?").get(runId);
  return row ? runRowToSurveyRun(row) : null;
};

export const deleteRun = (db, runId) => {
  const result = db.prepare("DELETE FROM saved_runs WHERE id = ?").run(runId);
  return result.changes > 0;
};

export const saveReportAudit = (db, { reportId, createdAt = now(), userInput = {}, auditSnapshot, pdfPath = null, reportText = "", status = "generated" }) => {
  db.prepare(
    `INSERT OR REPLACE INTO report_audits (
      report_id, created_at, user_input_json, audit_snapshot_json, pdf_path, report_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sanitizeStorageText(reportId),
    sanitizeStorageText(createdAt),
    toJson(userInput),
    toJson(auditSnapshot),
    pdfPath ? sanitizeStorageText(pdfPath) : null,
    sanitizeStorageText(reportText),
    sanitizeStorageText(status, "generated"),
  );
  return getReportAudit(db, reportId);
};

export const getReportAudit = (db, reportId) => {
  const row = db.prepare("SELECT * FROM report_audits WHERE report_id = ?").get(reportId);
  if (!row) return null;
  return {
    reportId: row.report_id,
    createdAt: row.created_at,
    userInput: fromJson(row.user_input_json, {}),
    auditSnapshot: fromJson(row.audit_snapshot_json, null),
    pdfPath: row.pdf_path,
    reportText: row.report_text,
    status: row.status,
  };
};

export const getDatabaseStatus = () => ({
  database: "sqlite",
  databaseConnected: true,
  mode: process.env.NODE_ENV || "development",
  path: process.env.TERRASIGNAL_DB_PATH || "data/terrasignal.sqlite",
});

export const saveLegacySurveyRun = (
  db,
  { projectId, datasetLabel, fileName = null, settings, inputPoints, analyzed, summary, reportText, warnings = [] },
) => {
  const id = randomUUID();
  const createdAt = now();
  const anomalyCount = (summary.priorityFindings ?? []).filter((point) => point.riskLevel !== "LOW").length;
  const highRiskCount = summary.highRisk ?? 0;
  db.prepare(
    `INSERT INTO survey_runs (
      id, project_id, dataset_label, file_name, settings_json, input_points_json,
      analyzed_json, summary_json, warnings_json, row_count, warning_count,
      anomaly_count, high_risk_count, report_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    sanitizeStorageText(datasetLabel, "API survey run"),
    fileName ? sanitizeStorageText(fileName) : null,
    toJson(settings),
    toJson(inputPoints),
    toJson(analyzed),
    toJson(summary),
    toJson(warnings),
    inputPoints.length,
    warnings.length,
    anomalyCount,
    highRiskCount,
    sanitizeStorageText(reportText),
    createdAt,
  );
  return getSurveyRun(db, id);
};

export const listSurveyRuns = (db, projectId) =>
  listRuns(db, projectId).map((run) => ({
    ...run,
    inputPoints: undefined,
    analyzed: undefined,
    reportText: undefined,
  }));

export const getSurveyRun = (db, runId) => {
  const savedRun = getRun(db, runId);
  if (savedRun) return savedRun;

  const row = db.prepare("SELECT * FROM survey_runs WHERE id = ?").get(runId);
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
// Portfolios hold references to scans, never copies of them, so a portfolio can
// never drift away from the screening evidence it claims to summarise.

const portfolioRowToPortfolio = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  description: row.description,
  profileId: row.profile_id,
  weightOverrides: fromJson(row.weight_overrides_json, {}),
  scanIds: fromJson(row.scan_ids_json, []),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const listPortfolios = (db, userId) =>
  db
    .prepare("SELECT * FROM site_portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100")
    .all(userId)
    .map(portfolioRowToPortfolio);

export const getPortfolio = (db, portfolioId) => {
  const row = db.prepare("SELECT * FROM site_portfolios WHERE id = ?").get(portfolioId);
  return row ? portfolioRowToPortfolio(row) : null;
};

export const savePortfolio = (
  db,
  { id = randomUUID(), userId, name, description = "", profileId = "balanced", weightOverrides = {}, scanIds = [], createdAt = null },
) => {
  const timestamp = now();
  db.prepare(
    `INSERT INTO site_portfolios (
       id, user_id, name, description, profile_id, weight_overrides_json, scan_ids_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       profile_id = excluded.profile_id,
       weight_overrides_json = excluded.weight_overrides_json,
       scan_ids_json = excluded.scan_ids_json,
       updated_at = excluded.updated_at`,
  ).run(
    id,
    sanitizeStorageText(userId),
    sanitizeStorageText(name, "Untitled portfolio"),
    sanitizeStorageText(description, ""),
    sanitizeStorageText(profileId, "balanced"),
    toJson(weightOverrides),
    toJson(scanIds),
    createdAt || timestamp,
    timestamp,
  );
  return getPortfolio(db, id);
};

export const deletePortfolio = (db, portfolioId) =>
  db.prepare("DELETE FROM site_portfolios WHERE id = ?").run(portfolioId).changes > 0;

// --- Pilot requests --------------------------------------------------------

const pilotRowToRequest = (row) => ({
  id: row.id,
  createdAt: row.created_at,
  organisation: row.organisation,
  contactName: row.contact_name,
  contactEmail: row.contact_email,
  role: row.role,
  useCase: row.use_case,
  message: row.message,
  status: row.status,
});

export const savePilotRequest = (
  db,
  { id = randomUUID(), organisation, contactName, contactEmail, role = "", useCase = "", message = "" },
) => {
  const createdAt = now();
  db.prepare(
    `INSERT INTO pilot_requests (
       id, created_at, organisation, contact_name, contact_email, role, use_case, message, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
  ).run(
    id,
    createdAt,
    sanitizeStorageText(organisation),
    sanitizeStorageText(contactName),
    sanitizeStorageText(contactEmail),
    sanitizeStorageText(role, ""),
    sanitizeStorageText(useCase, ""),
    sanitizeStorageText(message, ""),
  );
  return { id, createdAt, status: "new" };
};

export const listPilotRequests = (db) =>
  db.prepare("SELECT * FROM pilot_requests ORDER BY created_at DESC LIMIT 200").all().map(pilotRowToRequest);
