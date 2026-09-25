import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateRequest,
  ensureAuthSeed,
  listUsers,
  loginUser,
  registerUser,
  validateAuthConfiguration,
} from "./auth.js";
import {
  analyzeSurvey,
  buildReport,
  exportAnalyzedCsv,
  normalizePoints,
  normalizeSettings,
  parseSurveyFile,
  summarizeAnalysis,
} from "./analysis-engine.js";
import { buildSiteAnalysis } from "./analysis/siteRiskEngine.js";
import { openStore } from "./database-adapter.js";
import { loadEnvFiles } from "./env.js";
import { getProviderStatus } from "./geodata/providerStatus.js";
import { adapterTodos } from "./land/data-adapters.js";
import {
  runLandScan,
  runToLandScanDetail,
  runToLandScanSummary,
  scanToRunRecord,
} from "./land/land-scan-service.js";
import { validateGeminiConfiguration } from "./land/gemini-analysis-service.js";
import { buildReportPdf, pdfExportEligibility } from "./land/pdf.js";
import { buildSampleReports } from "./land/sample-reports.js";
import {
  auditRawLayerData,
  auditScoringData,
  auditValidationData,
  buildLandScanAuditSnapshot,
  buildSiteReportAuditSnapshot,
  buildSurveyReportAuditSnapshot,
  validateAuditSnapshot,
  validateReportInput,
} from "./report-audit.js";
import { publicLayers, sourceLinks } from "./seed-data.js";
import { BoundedTtlStore, isUuid as isUuidValue, safeText } from "./security/http-safety.js";
import { buildCapacityEnvelope } from "./land/capacity-model.js";
import { answerSiteQuestion, siteQaConfigured, SiteQaError } from "./ai/site-qa-service.js";
import { weightingProfiles } from "./portfolio/ranking-engine.js";
import {
  buildExecutiveSummary,
  buildPortfolioView,
  normalizePortfolioInput,
  portfolioLimits,
} from "./portfolio/portfolio-service.js";
import { runValueModel, valueModelDefinition } from "./portfolio/value-model.js";
import { providerCacheStats } from "./land/data-adapters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
// DB_CLIENT is the single switch the adapter reads. PostgreSQL is the default;
// --sqlite exists for the test suites, which run against an in-memory database.
if (process.argv.includes("--sqlite")) {
  process.env.DB_CLIENT = "sqlite";
}
if (process.argv.includes("--postgres")) {
  process.env.DB_CLIENT = "postgresql";
}
loadEnvFiles(rootDir);
validateAuthConfiguration();
const geminiConfiguration = validateGeminiConfiguration({ required: String(process.env.NODE_ENV || "development").toLowerCase() === "production" });
if (!geminiConfiguration.valid) {
  console.warn(geminiConfiguration.errors.join(" "));
}
ensureAuthSeed();

const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
// A startup misconfiguration is an operator problem, not a crash to debug:
// print the guidance and exit cleanly rather than dumping a driver stack.
const openStoreOrExit = async () => {
  try {
    return await openStore();
  } catch (error) {
    console.error(`
${error.message}
`);
    process.exit(1);
  }
};

export const store = await openStoreOrExit();

const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";
const defaultDevOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5174",
  "http://localhost:5174",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);
const configuredOrigins = String(process.env.CORS_ORIGIN || process.env.TERRASIGNAL_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (isProduction && configuredOrigins.includes("*")) {
  throw new Error("Wildcard CORS is not allowed in production. Set explicit CORS_ORIGIN values.");
}

const allowedOrigins = configuredOrigins.length ? configuredOrigins : isProduction ? [] : [...defaultDevOrigins];

const securityHeaders = () => ({
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: data: blob: http://127.0.0.1:8787 http://localhost:8787 http://127.0.0.1:5173 http://localhost:5173; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  ...(isProduction ? { "strict-transport-security": "max-age=15552000; includeSubDomains" } : {}),
});

const requestOrigin = (req) => {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.socket.encrypted ? "https" : "http");
  const hostHeader = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return hostHeader ? `${protocol}://${hostHeader}` : "";
};

const corsOriginAllowed = (origin, req) => !origin || allowedOrigins.includes(origin) || origin === requestOrigin(req);

const corsHeadersFor = (req) => {
  const origin = req.headers.origin;
  const headers = {
    ...securityHeaders(),
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-key",
  };

  if (origin && corsOriginAllowed(origin, req)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }

  return headers;
};

// Bounded so a spray of distinct client keys cannot grow the heap without limit.
const rateLimitBuckets = new BoundedTtlStore({ maxEntries: 20_000 });
const rateLimitOptions = {
  auth: {
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || 8),
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  },
  scan: {
    max: Number(process.env.SCAN_RATE_LIMIT_MAX || 40),
    windowMs: Number(process.env.SCAN_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  },
  // Model-backed endpoints cost money per call, so they get their own budget.
  ai: {
    max: Number(process.env.AI_RATE_LIMIT_MAX || 30),
    windowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  },
  // Catch-all for every other API route.
  api: {
    max: Number(process.env.API_RATE_LIMIT_MAX || 600),
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  },
  // Unauthenticated public form; kept deliberately tight.
  publicForm: {
    max: Number(process.env.PILOT_RATE_LIMIT_MAX || 5),
    windowMs: Number(process.env.PILOT_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000),
  },
};

const clientKey = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
};

const checkRateLimit = (req, res, bucketName, keySuffix = "") => {
  const options = rateLimitOptions[bucketName];
  if (!options?.max || !options?.windowMs) return true;
  const key = `${bucketName}:${clientKey(req)}:${keySuffix}`;
  const nowMs = Date.now();
  const current = rateLimitBuckets.get(key, nowMs);
  if (!current) {
    rateLimitBuckets.set(key, { count: 1, resetAt: nowMs + options.windowMs, expiresAt: nowMs + options.windowMs });
    return true;
  }
  current.count += 1;
  if (current.count > options.max) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000));
    res.writeHead(429, {
      ...corsHeadersFor(req),
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(retryAfter),
    });
    res.end(
      JSON.stringify({
        error: {
          code: "rate_limited",
          message: "Too many requests. Please wait before trying again.",
          retryAfterSeconds: retryAfter,
        },
      }),
    );
    return false;
  }
  return true;
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bin": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".ico": "image/x-icon",
};

const sendJson = (req, res, status, payload) => {
  res.writeHead(status, {
    ...corsHeadersFor(req),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
};

const sendText = (req, res, status, text, type = "text/plain; charset=utf-8") => {
  res.writeHead(status, {
    ...corsHeadersFor(req),
    "content-type": type,
  });
  res.end(text);
};

const sendBinary = (req, res, status, buffer, type, extraHeaders = {}) => {
  res.writeHead(status, {
    ...corsHeadersFor(req),
    "content-type": type,
    "content-length": buffer.length,
    ...extraHeaders,
  });
  res.end(buffer);
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => uuidPattern.test(String(value || ""));

const persistAuditSnapshot = async ({ auditSnapshot, reportText = "", status = "generated" }) =>
  store.saveReportAudit({
    reportId: auditSnapshot.reportId,
    createdAt: auditSnapshot.generatedAt,
    userInput: auditSnapshot.userInput,
    auditSnapshot,
    reportText,
    status,
  });

const reportAuditOrError = async (req, res, reportId, user) => {
  if (!isUuid(reportId)) {
    sendJson(req, res, 400, { error: { code: "invalid_report_id", message: "reportId must be a valid UUID." } });
    return null;
  }
  const record = await store.getReportAudit(reportId);
  if (!record?.auditSnapshot) {
    sendJson(req, res, 404, { error: { code: "not_found", message: "Report audit snapshot not found." } });
    return null;
  }
  // The audit id is the run id, so ownership of the run governs the audit too.
  // Without this any authenticated user could read any tenant's audit trail.
  const run = await store.getRun(reportId);
  if (run && !userOwnsRun(run, user)) {
    sendJson(req, res, 404, { error: { code: "not_found", message: "Report audit snapshot not found." } });
    return null;
  }
  if (!run && user.role !== "admin") {
    sendJson(req, res, 404, { error: { code: "not_found", message: "Report audit snapshot not found." } });
    return null;
  }
  return record;
};

const readJsonBody = async (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });

// Session revocation. Tokens are stateless JWTs, so logout records the token's
// signature until its own expiry rather than keeping a full session table.
const revokedTokens = new BoundedTtlStore({ maxEntries: 50_000 });

const bearerFrom = (header) => {
  const value = String(header || "");
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
};

const tokenFingerprint = (token) => String(token || "").split(".")[2] || "";

const revokeToken = (authorizationHeader) => {
  const token = bearerFrom(authorizationHeader);
  const fingerprint = tokenFingerprint(token);
  if (!fingerprint) return false;
  let expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (Number.isFinite(Number(payload?.exp))) expiresAt = Number(payload.exp) * 1000;
  } catch {
    // Keep the conservative default window if the payload cannot be read.
  }
  revokedTokens.set(fingerprint, { expiresAt });
  return true;
};

const isTokenRevoked = (req) => {
  const fingerprint = tokenFingerprint(bearerFrom(req.headers.authorization));
  return Boolean(fingerprint && revokedTokens.get(fingerprint));
};

const requireApiKey = (req) => {
  const expected = process.env.TERRASIGNAL_API_KEY;
  if (!expected) return true;
  return req.headers["x-api-key"] === expected;
};

const requireUser = (req, res) => {
  if (isTokenRevoked(req)) {
    sendJson(req, res, 401, { error: { code: "session_revoked", message: "This session has been signed out. Sign in again." } });
    return null;
  }
  const user = authenticateRequest(req);
  if (!user) {
    sendJson(req, res, 401, { error: { code: "unauthorized", message: "Login is required." } });
    return null;
  }
  return user;
};

const requireAdmin = (req, res) => {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(req, res, 403, { error: { code: "forbidden", message: "Admin access is required." } });
    return null;
  }
  return user;
};

const listLandScanRuns = async () =>
  (await store.listRuns(null)).filter((run) => run.visualizationSettings?.kind === "land-scan");

// Ownership for every stored run, not just land scans. Runs created before
// ownership was recorded (seed/demo rows) have no userId and are treated as
// admin-only rather than world-readable.
const runOwnerId = (run) => run?.visualizationSettings?.userId ?? null;

const userOwnsRun = (run, user) => {
  if (!run) return false;
  if (user.role === "admin") return true;
  return runOwnerId(run) === user.id;
};

const runsVisibleTo = async (runs, user) =>
  user.role === "admin" ? runs : runs.filter((run) => runOwnerId(run) === user.id);

const runForUserOrError = async (req, res, runId, user) => {
  const run = await store.getRun(runId);
  if (!run) {
    sendJson(req, res, 404, { error: { code: "not_found", message: "Run not found" } });
    return null;
  }
  if (!userOwnsRun(run, user)) {
    // 404 rather than 403: existence of another tenant's record is itself
    // information we do not need to disclose.
    sendJson(req, res, 404, { error: { code: "not_found", message: "Run not found" } });
    return null;
  }
  return run;
};

const landRunForUserOrError = async (req, res, runId, user) => {
  const run = await store.getRun(runId);
  if (!run || run.visualizationSettings?.kind !== "land-scan") {
    sendJson(req, res, 404, { error: { code: "not_found", message: "Land scan not found." } });
    return null;
  }
  const ownerId = run.visualizationSettings?.userId;
  if (user.role !== "admin" && ownerId !== user.id) {
    sendJson(req, res, 403, { error: { code: "forbidden", message: "You do not have access to this scan." } });
    return null;
  }
  return run;
};

const buildAnalysisRun = (project, payload) => {
  const settings = normalizeSettings(payload.settings);
  const parsed = payload.csvText ? parseSurveyFile(payload.csvText) : null;
  const points = parsed
    ? parsed.points
    : normalizePoints(payload.points?.length ? payload.points : project.points);

  if (!points.length) {
    const error = new Error("No valid survey points supplied");
    error.status = 422;
    error.details = parsed?.warnings ?? [];
    throw error;
  }

  const analyzed = analyzeSurvey(points, settings, project);
  const summary = summarizeAnalysis(analyzed, settings.anomalyThreshold);
  const reportText = buildReport(project, analyzed, settings);
  return {
    datasetLabel: String(payload.datasetLabel || payload.fileName || "API survey run"),
    settings,
    points,
    warnings: parsed?.warnings ?? payload.warnings ?? [],
    analyzed,
    summary,
    reportText,
  };
};

const withOwner = (visualizationSettings, user) => ({
  ...(visualizationSettings ?? {}),
  // Ownership is read from here on every access check, so it is stamped on
  // every write path rather than only on land scans.
  userId: user?.id ?? null,
});

const runPayloadForStorage = (project, analysis, body = {}, user = null) => ({
  projectId: project.id,
  projectName: project.name,
  locationName: project.location,
  latitude: project.latitude ?? null,
  longitude: project.longitude ?? null,
  coordinateMode: analysis.points.some((point) => point.coordinateMode === "lat_lon") ? "lat_lon" : "local_xy",
  datasetLabel: analysis.datasetLabel,
  fileName: body.fileName || null,
  settings: analysis.settings,
  inputPoints: analysis.points,
  analyzed: analysis.analyzed,
  summary: analysis.summary,
  reportText: analysis.reportText,
  warnings: analysis.warnings,
  visualizationSettings: withOwner(body.visualizationSettings, user),
});

const handleApi = async (req, res, url) => {
  if (!corsOriginAllowed(req.headers.origin, req)) {
    sendJson(req, res, 403, { error: { code: "cors_origin_forbidden", message: "This origin is not allowed." } });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeadersFor(req));
    res.end();
    return;
  }

  if (!requireApiKey(req)) {
    sendJson(req, res, 401, { error: { code: "unauthorized", message: "Invalid API key" } });
    return;
  }

  const segments = url.pathname.split("/").filter(Boolean).slice(1);
  const [resource, id, nested] = segments;

  if (resource === "auth" && ["login", "register"].includes(id) && req.method === "POST") {
    if (!checkRateLimit(req, res, "auth", id)) return;
  }

  if (resource === "land-scans") {
    if (!checkRateLimit(req, res, "scan", req.method)) return;
  }

  // Model-backed endpoints carry a per-call cost, so they get a tighter budget
  // than the general API allowance.
  if (["site-qa", "sample-reports", "site-analysis"].includes(resource)) {
    if (!checkRateLimit(req, res, "ai", resource)) return;
  }

  if (resource === "pilot-requests" && req.method === "POST") {
    if (!checkRateLimit(req, res, "publicForm", "create")) return;
  }

  // Catch-all budget for everything else on /api.
  if (!checkRateLimit(req, res, "api", "")) return;

  if (resource === "auth" && id === "register" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = registerUser(body);
    sendJson(req, res, 201, result);
    return;
  }

  if (resource === "auth" && id === "login" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = loginUser(body);
    sendJson(req, res, 200, result);
    return;
  }

  if (resource === "auth" && id === "profile" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(req, res, 200, { user });
    return;
  }

  if (resource === "auth" && id === "logout" && req.method === "POST") {
    // Logout used to be a no-op, so a leaked bearer token stayed valid for its
    // full TTL. The presented token is now denylisted until it would expire.
    revokeToken(req.headers.authorization);
    sendJson(req, res, 200, { ok: true, revoked: true });
    return;
  }

  if (resource === "pricing-plans" && req.method === "GET") {
    sendJson(req, res, 200, {
      plans: [
        {
          id: "free-demo",
          name: "Free Demo Scan",
          description: "Internal demo scan with mock/fallback data adapters.",
          enabled: true,
        },
        {
          id: "single-report",
          name: "Paid Single Report",
          description: "Future one-off professional report purchase.",
          enabled: false,
        },
        {
          id: "monthly-subscription",
          name: "Monthly Subscription",
          description: "Future SaaS subscription for recurring land scans.",
          enabled: false,
        },
        {
          id: "enterprise-api",
          name: "Enterprise/API Access",
          description: "Future API and team workflow tier.",
          enabled: false,
        },
      ],
      paymentIntegrations: {
        stripe: "planned",
        razorpay: "planned",
      },
    });
    return;
  }

  if (resource === "data-adapter-todos" && req.method === "GET") {
    sendJson(req, res, 200, { todos: adapterTodos });
    return;
  }

  if (resource === "sample-reports" && req.method === "GET") {
    const reports = await buildSampleReports();
    if (id) {
      const report = reports.find((item) => item.id === id);
      if (!report) {
        sendJson(req, res, 404, { error: { code: "not_found", message: "Sample report not found." } });
        return;
      }
      sendJson(req, res, 200, { report });
      return;
    }
    sendJson(req, res, 200, {
      reports: reports.map(({ id: reportId, title, market, demo, scan }) => ({
        id: reportId,
        title,
        market,
        demo,
        overallRiskScore: scan.overallRiskScore,
        riskBand: scan.riskBands.label,
        confidence: scan.confidence,
        dataMode: scan.dataMode,
        deliverableStatus: scan.deliverableStatus,
        reportReadiness: scan.reportReadiness,
        reportLabel: scan.reportLabel,
      })),
    });
    return;
  }

  if (resource === "land-scans" && !id && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const runs = await listLandScanRuns();
    const visibleRuns = user.role === "admin"
      ? runs
      : runs.filter((run) => run.visualizationSettings?.userId === user.id);
    sendJson(req, res, 200, { scans: visibleRuns.map(runToLandScanSummary).filter(Boolean) });
    return;
  }

  if (resource === "land-scans" && !id && req.method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const result = await runLandScan({ body, user });
    const run = await store.saveRun(scanToRunRecord({ ...result, user }));
    // Persist the provenance trail alongside the run so every land scan has a
    // durable, inspectable record of provider values, formulas and AI status.
    const auditSnapshot = buildLandScanAuditSnapshot({
      scan: result.scan,
      report: result.report,
      requestedBy: { userId: user.id, email: user.email },
    });
    await persistAuditSnapshot({ auditSnapshot, reportText: result.report?.narrative || "" });
    sendJson(req, res, 201, { scan: run.visualizationSettings.landScan, report: run.visualizationSettings.professionalReport });
    return;
  }

  if (resource === "land-scans" && id && !nested && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await landRunForUserOrError(req, res, id, user);
    if (!run) return;
    sendJson(req, res, 200, { scan: runToLandScanDetail(run) });
    return;
  }

  if (resource === "land-scans" && id && !nested && req.method === "DELETE") {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await landRunForUserOrError(req, res, id, user);
    if (!run) return;
    await store.deleteRun(id);
    sendJson(req, res, 200, { ok: true });
    return;
  }

  if (resource === "land-scans" && id && nested === "pdf" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await landRunForUserOrError(req, res, id, user);
    if (!run) return;
    const scan = run.visualizationSettings.landScan;
    const report = run.visualizationSettings.professionalReport;
    const eligibility = pdfExportEligibility(scan);
    if (!eligibility.allowed) {
      sendJson(req, res, 403, {
        error: {
          code: "report_export_blocked",
          message: eligibility.reason,
          dataMode: scan.dataMode,
          reportReadiness: scan.reportReadiness,
        },
      });
      return;
    }
    const pdf = buildReportPdf(scan, report);
    const suffix = scan.dataMode === "mock" ? "-mock-data-internal-only" : "";
    sendBinary(req, res, 200, pdf, "application/pdf", {
      "content-disposition": `attachment; filename="land-scan-${scan.scanId}${suffix}.pdf"`,
    });
    return;
  }

  // --- Site capacity envelope ---------------------------------------------
  // Geometry is measured from the scan boundary; planning parameters are
  // declared by the caller. The response keeps the two apart.
  if (resource === "land-scans" && id && nested === "capacity" && req.method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await landRunForUserOrError(req, res, id, user);
    if (!run) return;
    const body = await readJsonBody(req);
    const envelope = buildCapacityEnvelope({
      scan: run.visualizationSettings.landScan,
      planning: body.planning ?? body,
    });
    sendJson(req, res, 200, { scanId: id, capacity: envelope });
    return;
  }

  // --- Weighting profiles --------------------------------------------------
  if (resource === "ranking-profiles" && req.method === "GET") {
    sendJson(req, res, 200, {
      profiles: Object.values(weightingProfiles).map((profile) => ({
        id: profile.id,
        label: profile.label,
        rationale: profile.rationale,
        weights: profile.weights,
      })),
      note: "Weighting profiles are TerraSignal product defaults, not an industry standard. Every weight is editable and the resulting contributions are shown in full.",
    });
    return;
  }

  // --- Portfolios ----------------------------------------------------------
  if (resource === "portfolios" && !id && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(req, res, 200, { portfolios: await store.listPortfolios(user.id), limits: portfolioLimits });
    return;
  }

  if (resource === "portfolios" && !id && req.method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const normalized = normalizePortfolioInput(body);
    if (!normalized.valid) {
      sendJson(req, res, 422, {
        error: { code: "invalid_portfolio", message: normalized.errors.join(" "), details: normalized.errors },
      });
      return;
    }
    const saved = await store.savePortfolio({ ...normalized.portfolio, userId: user.id });
    sendJson(req, res, 201, { portfolio: saved });
    return;
  }

  if (resource === "portfolios" && id && !nested && ["GET", "POST", "DELETE"].includes(req.method)) {
    const user = requireUser(req, res);
    if (!user) return;
    if (!isUuidValue(id)) {
      sendJson(req, res, 400, { error: { code: "invalid_portfolio_id", message: "portfolioId must be a valid UUID." } });
      return;
    }
    const existing = await store.getPortfolio(id);
    // 404 rather than 403 so a portfolio id cannot be probed for existence.
    if (!existing || (user.role !== "admin" && existing.userId !== user.id)) {
      sendJson(req, res, 404, { error: { code: "not_found", message: "Portfolio not found." } });
      return;
    }

    if (req.method === "DELETE") {
      await store.deletePortfolio(id);
      sendJson(req, res, 200, { ok: true });
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const normalized = normalizePortfolioInput(body, { existing });
      if (!normalized.valid) {
        sendJson(req, res, 422, {
          error: { code: "invalid_portfolio", message: normalized.errors.join(" "), details: normalized.errors },
        });
        return;
      }
      const saved = await store.savePortfolio({ ...normalized.portfolio, userId: existing.userId });
      const view = await buildPortfolioView({ store, portfolio: saved, user });
      sendJson(req, res, 200, { ...view, executiveSummary: buildExecutiveSummary(view) });
      return;
    }

    const profileId = url.searchParams.get("profileId") || undefined;
    const view = await buildPortfolioView({ store, portfolio: existing, user, profileId });
    sendJson(req, res, 200, { ...view, executiveSummary: buildExecutiveSummary(view) });
    return;
  }

  // Re-rank without persisting: lets an analyst move weights and see the
  // effect immediately, which is the whole point of a transparent model.
  if (resource === "portfolios" && id && nested === "rank" && req.method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    if (!isUuidValue(id)) {
      sendJson(req, res, 400, { error: { code: "invalid_portfolio_id", message: "portfolioId must be a valid UUID." } });
      return;
    }
    const existing = await store.getPortfolio(id);
    if (!existing || (user.role !== "admin" && existing.userId !== user.id)) {
      sendJson(req, res, 404, { error: { code: "not_found", message: "Portfolio not found." } });
      return;
    }
    const body = await readJsonBody(req);
    const view = await buildPortfolioView({
      store,
      portfolio: existing,
      user,
      profileId: body.profileId,
      weightOverrides: body.weightOverrides,
    });
    sendJson(req, res, 200, { ...view, executiveSummary: buildExecutiveSummary(view) });
    return;
  }

  // --- Grounded site question answering ------------------------------------
  if (resource === "site-qa" && req.method === "POST" && !id) {
    const user = requireUser(req, res);
    if (!user) return;
    if (!siteQaConfigured()) {
      sendJson(req, res, 503, {
        error: { code: "ai_not_configured", message: "The site intelligence assistant is not configured. Set GEMINI_API_KEY." },
      });
      return;
    }
    const body = await readJsonBody(req);
    const requestedIds = Array.isArray(body.scanIds) ? body.scanIds.filter(isUuidValue).slice(0, 8) : [];
    if (!requestedIds.length) {
      sendJson(req, res, 422, { error: { code: "no_sites_selected", message: "Select at least one screened site." } });
      return;
    }
    const scans = [];
    for (const scanId of requestedIds) {
      const run = await store.getRun(scanId);
      // Ownership is re-checked here so a scan id cannot be used to read a
      // record the caller does not own via the assistant.
      if (run?.visualizationSettings?.kind === "land-scan" && userOwnsRun(run, user)) {
        scans.push(run.visualizationSettings.landScan);
      }
    }
    if (!scans.length) {
      sendJson(req, res, 404, { error: { code: "not_found", message: "No accessible screened sites matched those identifiers." } });
      return;
    }
    try {
      const answer = await answerSiteQuestion({ question: body.question, scans });
      sendJson(req, res, 200, answer);
    } catch (error) {
      if (error instanceof SiteQaError) {
        sendJson(req, res, error.status || 502, { error: { code: "site_qa_error", message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  // --- Scenario value model ------------------------------------------------
  // Pure arithmetic over caller-supplied assumptions. No stored or external
  // data is consulted, so this endpoint is safe to expose unauthenticated for
  // the pitch experience.
  if (resource === "value-model" && req.method === "GET" && !id) {
    sendJson(req, res, 200, { model: valueModelDefinition() });
    return;
  }

  if (resource === "value-model" && req.method === "POST" && !id) {
    const body = await readJsonBody(req);
    sendJson(req, res, 200, { scenario: runValueModel(body.inputs ?? body) });
    return;
  }

  // --- Pilot requests ------------------------------------------------------
  if (resource === "pilot-requests" && req.method === "POST" && !id) {
    const body = await readJsonBody(req);
    const organisation = safeText(body.organisation, 160);
    const contactName = safeText(body.contactName, 120);
    const contactEmail = safeText(body.contactEmail, 200);
    const errors = [];
    if (!organisation) errors.push("Organisation is required.");
    if (!contactName) errors.push("Contact name is required.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) errors.push("A valid work email is required.");
    if (errors.length) {
      sendJson(req, res, 422, { error: { code: "invalid_pilot_request", message: errors.join(" "), details: errors } });
      return;
    }
    const saved = await store.savePilotRequest({
      organisation,
      contactName,
      contactEmail,
      role: safeText(body.role, 120),
      useCase: safeText(body.useCase, 200),
      message: safeText(body.message, 2000),
    });
    sendJson(req, res, 201, {
      request: saved,
      acknowledgement:
        "Request recorded. A TerraSignal contact will follow up to scope a discovery session and agree the sites for a pilot.",
    });
    return;
  }

  if (resource === "admin" && id === "pilot-requests" && req.method === "GET") {
    const user = requireAdmin(req, res);
    if (!user) return;
    sendJson(req, res, 200, { requests: await store.listPilotRequests() });
    return;
  }

  if (resource === "admin" && id === "users" && req.method === "GET") {
    const user = requireAdmin(req, res);
    if (!user) return;
    sendJson(req, res, 200, { users: listUsers() });
    return;
  }

  if (resource === "admin" && id === "scans" && req.method === "GET") {
    const user = requireAdmin(req, res);
    if (!user) return;
    const runs = await listLandScanRuns();
    sendJson(req, res, 200, { scans: runs.map(runToLandScanSummary).filter(Boolean) });
    return;
  }

  if (resource === "admin" && id === "metrics" && req.method === "GET") {
    const user = requireAdmin(req, res);
    if (!user) return;
    const users = listUsers();
    const runs = await listLandScanRuns();
    const scans = runs.map(runToLandScanSummary).filter(Boolean);
    const locationCounts = new Map();
    for (const scan of scans) {
      const key =
        scan.location.address ||
        `${Number(scan.location.lat).toFixed(2)}, ${Number(scan.location.lng).toFixed(2)}`;
      locationCounts.set(key, (locationCounts.get(key) || 0) + 1);
    }
    const mostScannedLocations = [...locationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([location, count]) => ({ location, count }));
    sendJson(req, res, 200, {
      metrics: {
        userCount: users.length,
        scanCount: scans.length,
        highRiskCount: scans.filter((scan) => scan.riskBand === "High").length,
        averageRiskScore: scans.length
          ? Math.round(scans.reduce((sum, scan) => sum + scan.overallRiskScore, 0) / scans.length)
          : 0,
        mostScannedLocations,
        pricingReadiness: ["free-demo", "single-report", "monthly-subscription", "enterprise-api"],
      },
    });
    return;
  }

  if (resource === "admin" && id === "logs" && req.method === "GET") {
    const user = requireAdmin(req, res);
    if (!user) return;
    sendJson(req, res, 200, {
      logs: [
        {
          level: "info",
          message: "Structured land-scan logs are not persisted yet; connect an observability sink before pilot sales.",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return;
  }

  if (req.method === "GET" && resource === "health") {
    const databaseStatus = await store.getDatabaseStatus();
    sendJson(req, res, 200, {
      ok: true,
      service: "terrasignal-backend",
      database: databaseStatus.database,
      databaseConnected: databaseStatus.databaseConnected,
      mode: databaseStatus.mode,
      providerStatus: getProviderStatus(),
      providerCache: providerCacheStats(),
      siteAssistant: siteQaConfigured() ? "configured" : "not_configured",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (resource === "site-analysis" && req.method === "POST" && !id) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const activeSite = body.activeSite ?? body.site ?? body;
    const validation = validateReportInput(activeSite);
    if (!validation.valid) {
      sendJson(req, res, 422, { error: { code: "invalid_site_input", message: validation.errors.join(" "), details: validation.errors } });
      return;
    }
    const analysis = await buildSiteAnalysis(activeSite);
    sendJson(req, res, 200, { activeSite, ...analysis });
    return;
  }

  if (resource === "reports" && id && nested === "audit" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const record = await reportAuditOrError(req, res, id, user);
    if (record) sendJson(req, res, 200, record.auditSnapshot);
    return;
  }

  if (resource === "reports" && id && nested === "raw" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const record = await reportAuditOrError(req, res, id, user);
    if (record) sendJson(req, res, 200, auditRawLayerData(record.auditSnapshot));
    return;
  }

  if (resource === "reports" && id && nested === "scoring" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const record = await reportAuditOrError(req, res, id, user);
    if (record) sendJson(req, res, 200, auditScoringData(record.auditSnapshot));
    return;
  }

  if (resource === "reports" && id && nested === "validation" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const record = await reportAuditOrError(req, res, id, user);
    if (record) sendJson(req, res, 200, auditValidationData(record.auditSnapshot));
    return;
  }

  if (resource === "reports" && id && nested === "validate" && req.method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    const record = await reportAuditOrError(req, res, id, user);
    if (!record) return;
    const validation = validateAuditSnapshot(record.auditSnapshot);
    const auditSnapshot = { ...record.auditSnapshot, ...validation };
    await persistAuditSnapshot({ auditSnapshot, reportText: record.reportText, status: validation.validationStatus });
    sendJson(req, res, 200, auditValidationData(auditSnapshot));
    return;
  }

  if (resource === "site-analyses" && !id && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    // Previously returned every run in the database to any caller, including
    // land scans belonging to other tenants. Now scoped to the caller.
    sendJson(req, res, 200, { runs: await runsVisibleTo(await store.listRuns(null), user) });
    return;
  }

  if (resource === "site-analyses" && !id && req.method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const activeSite = body.activeSite ?? body.site;
    const screening = body.siteScreening ?? body.riskScores;
    if (!activeSite || !screening) {
      sendJson(req, res, 422, { error: { code: "invalid_site_analysis", message: "activeSite and siteScreening are required." } });
      return;
    }
    const validation = validateReportInput(activeSite);
    if (!validation.valid) {
      sendJson(req, res, 422, { error: { code: "invalid_site_input", message: validation.errors.join(" "), details: validation.errors } });
      return;
    }
    // Server-minted: a client-chosen report id would target another record.
    const reportId = randomUUID();
    const run = await store.saveRun({
      id: reportId,
      projectId: String(activeSite.id || randomUUID()),
      projectName: String(activeSite.projectName || "Site intelligence scan"),
      locationName: `${Number(activeSite.latitude).toFixed(6)}, ${Number(activeSite.longitude).toFixed(6)}`,
      latitude: Number(activeSite.latitude),
      longitude: Number(activeSite.longitude),
      coordinateMode: "lat_lon",
      datasetLabel: String(body.datasetLabel || `${activeSite.projectName || "Site"} intelligence scan`),
      settings: {},
      inputPoints: [],
      analyzed: [],
      summary: {
        flagged: [],
        priorityFindings: [],
        clusters: [],
        top: null,
        meanConfidence: screening.dataConfidence ?? 0,
        meanResidual: 0,
        highRisk: ["High", "Critical", "high", "critical"].includes(screening.buildabilityCautionLevel ?? screening.overallCautionLevel) ? 1 : 0,
        boreholesSaved: null,
        planningImpactSupported: false,
      },
      reportText: String(body.reportText || ""),
      warnings: [],
      visualizationSettings: { ...withOwner(body.visualizationSettings, user), activeSite, siteScreening: screening },
    });
    const auditSnapshot = buildSiteReportAuditSnapshot({
      reportId: run.id,
      site: activeSite,
      screening,
      reportText: String(body.reportText || ""),
      requestedBy: body.requestedBy ?? null,
    });
    await persistAuditSnapshot({ auditSnapshot, reportText: String(body.reportText || "") });
    sendJson(req, res, 201, { run });
    return;
  }

  if (resource === "site-analyses" && id && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await runForUserOrError(req, res, id, user);
    if (!run) return;
    sendJson(req, res, 200, { run });
    return;
  }

  if (req.method === "GET" && resource === "bootstrap") {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(req, res, 200, {
      projects: await store.listProjects(),
      publicLayers,
      sourceLinks,
      database: store.kind,
    });
    return;
  }

  if (req.method === "GET" && resource === "public-layers") {
    sendJson(req, res, 200, { publicLayers });
    return;
  }

  if (req.method === "GET" && resource === "sources") {
    sendJson(req, res, 200, { sourceLinks });
    return;
  }

  if (resource === "projects" && req.method === "GET" && !id) {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(req, res, 200, { projects: await store.listProjects() });
    return;
  }

  if (resource === "projects" && req.method === "POST" && !id) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const project = await store.createProject(body.project ?? body);
    sendJson(req, res, 201, { project });
    return;
  }

  if (resource === "projects" && id && req.method === "GET" && !nested) {
    const user = requireUser(req, res);
    if (!user) return;
    const project = await store.getProject(id);
    if (!project) {
      sendJson(req, res, 404, { error: { code: "not_found", message: "Project not found" } });
      return;
    }
    sendJson(req, res, 200, { project });
    return;
  }

  if (resource === "projects" && id && nested === "runs" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const project = await store.getProject(id);
    if (!project) {
      sendJson(req, res, 404, { error: { code: "not_found", message: "Project not found" } });
      return;
    }
    sendJson(req, res, 200, { runs: await store.listSurveyRuns(id) });
    return;
  }

  if (resource === "projects" && id && ["runs", "analyze", "upload"].includes(nested) && req.method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    const project = await store.getProject(id);
    if (!project) {
      sendJson(req, res, 404, { error: { code: "not_found", message: "Project not found" } });
      return;
    }
    const body = await readJsonBody(req);
    const analysis = buildAnalysisRun(project, body);
    // Server-minted: a client-chosen report id would target another record.
    const reportId = randomUUID();
    const run = await store.saveSurveyRun({ ...runPayloadForStorage(project, analysis, body, user), id: reportId });
    const auditSnapshot = buildSurveyReportAuditSnapshot({
      reportId: run.id,
      project,
      analysis,
      requestedBy: body.requestedBy ?? null,
    });
    await persistAuditSnapshot({ auditSnapshot, reportText: analysis.reportText });
    sendJson(req, res, 201, {
      run,
      points: analysis.points,
      analyzed: analysis.analyzed,
      summary: analysis.summary,
      reportText: analysis.reportText,
      warnings: analysis.warnings,
    });
    return;
  }

  if (resource === "analyze" && req.method === "POST" && !id) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const project = body.projectId ? await store.getProject(body.projectId) : (await store.listProjects())[0];
    if (!project) {
      sendJson(req, res, 404, { error: { code: "not_found", message: "Project not found" } });
      return;
    }
    const analysis = buildAnalysisRun(project, body);
    sendJson(req, res, 200, {
      project,
      points: analysis.points,
      analyzed: analysis.analyzed,
      summary: analysis.summary,
      reportText: analysis.reportText,
      warnings: analysis.warnings,
    });
    return;
  }

  if (resource === "runs" && !id && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const projectId = url.searchParams.get("projectId");
    sendJson(req, res, 200, { runs: await runsVisibleTo(await store.listRuns(projectId), user) });
    return;
  }

  if (resource === "runs" && !id && req.method === "POST") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (body.activeSite && body.siteScreening) {
      const activeSite = body.activeSite;
      const screening = body.siteScreening;
      const validation = validateReportInput(activeSite);
      if (!validation.valid) {
        sendJson(req, res, 422, { error: { code: "invalid_site_input", message: validation.errors.join(" "), details: validation.errors } });
        return;
      }
      // Server-minted: a client-chosen report id would target another record.
    const reportId = randomUUID();
      const summary = {
        flagged: [],
        priorityFindings: [],
        clusters: [],
        top: null,
        meanConfidence: screening.dataConfidence ?? 0,
        meanResidual: 0,
        highRisk: screening.buildabilityCautionLevel === "High" ? 1 : 0,
        boreholesSaved: null,
        planningImpactSupported: false,
      };
      const run = await store.saveRun({
        id: reportId,
        projectId: String(activeSite.id || randomUUID()),
        projectName: String(activeSite.projectName || "Coordinate screening"),
        locationName: `${Number(activeSite.latitude).toFixed(6)}, ${Number(activeSite.longitude).toFixed(6)}`,
        latitude: Number(activeSite.latitude),
        longitude: Number(activeSite.longitude),
        coordinateMode: "lat_lon",
        datasetLabel: String(body.datasetLabel || `${activeSite.projectName || "Coordinate site"} pre-screening`),
        settings: {},
        inputPoints: [],
        analyzed: [],
        summary,
        reportText: String(body.reportText || ""),
        warnings: [],
        visualizationSettings: {
          ...withOwner(body.visualizationSettings, user),
          activeSite,
          siteScreening: screening,
        },
      });
      const auditSnapshot = buildSiteReportAuditSnapshot({
        reportId: run.id,
        site: activeSite,
        screening,
        reportText: String(body.reportText || ""),
        requestedBy: body.requestedBy ?? null,
      });
      await persistAuditSnapshot({ auditSnapshot, reportText: String(body.reportText || "") });
      sendJson(req, res, 201, { run });
      return;
    }

    const project = body.projectId ? await store.getProject(body.projectId) : (await store.listProjects())[0];
    if (!project) {
      sendJson(req, res, 404, { error: { code: "not_found", message: "Project not found" } });
      return;
    }
    const analysis = body.analyzed?.length && body.summary
      ? {
          datasetLabel: String(body.datasetLabel || body.fileName || "Saved survey run"),
          settings: normalizeSettings(body.settings),
          points: normalizePoints(body.points?.length ? body.points : project.points),
          warnings: body.warnings ?? [],
          analyzed: body.analyzed,
          summary: body.summary,
          reportText: body.reportText || buildReport(project, body.analyzed, normalizeSettings(body.settings)),
        }
      : buildAnalysisRun(project, body);
    // Server-minted: a client-chosen report id would target another record.
    const reportId = randomUUID();
    const run = await store.saveRun({ ...runPayloadForStorage(project, analysis, body, user), id: reportId });
    const auditSnapshot = buildSurveyReportAuditSnapshot({
      reportId: run.id,
      project,
      analysis,
      requestedBy: body.requestedBy ?? null,
    });
    await persistAuditSnapshot({ auditSnapshot, reportText: analysis.reportText });
    sendJson(req, res, 201, { run });
    return;
  }

  if (resource === "runs" && id && req.method === "GET" && !nested) {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await runForUserOrError(req, res, id, user);
    if (!run) return;
    sendJson(req, res, 200, { run });
    return;
  }

  if (resource === "runs" && id && req.method === "DELETE" && !nested) {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await runForUserOrError(req, res, id, user);
    if (!run) return;
    await store.deleteRun(id);
    sendJson(req, res, 200, { ok: true });
    return;
  }

  if (resource === "runs" && id && nested === "report" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await runForUserOrError(req, res, id, user);
    if (!run) return;
    sendText(req, res, 200, run.reportText);
    return;
  }

  if (resource === "runs" && id && nested === "anomalies.csv" && req.method === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    const run = await runForUserOrError(req, res, id, user);
    if (!run) return;
    sendText(req, res, 200, exportAnalyzedCsv(run.analyzed), "text/csv; charset=utf-8");
    return;
  }

  sendJson(req, res, 404, { error: { code: "not_found", message: "API route not found" } });
};

const serveStatic = async (req, res, url) => {
  if (!existsSync(distDir)) {
    sendJson(req, res, 404, {
      error: {
        code: "frontend_not_built",
        message: "Run npm run build before using the backend to serve the frontend.",
      },
    });
    return;
  }

  let rawPath;
  try {
    rawPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    rawPath = "/index.html";
  }
  // Split on both separators: a percent-encoded backslash decodes to a real
  // one, and Windows treats it as a path separator.
  const relativePath = rawPath.split(/[\\/]+/).filter(Boolean).join(path.sep);
  const candidate = path.resolve(distDir, relativePath);
  // A bare prefix test matches a sibling directory whose name merely starts
  // with the dist path (".../distsecret"), so the separator is required.
  const withinDist = candidate === distDir || candidate.startsWith(distDir + path.sep);
  const safeCandidate = withinDist ? candidate : path.join(distDir, "index.html");
  const filePath = existsSync(safeCandidate) && (await stat(safeCandidate)).isFile()
    ? safeCandidate
    : path.join(distDir, "index.html");
  const extension = path.extname(filePath);

  res.writeHead(200, {
    ...securityHeaders(),
    "content-type": mimeTypes[extension] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
};

export const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    const status = error.status || 500;
    const exposeMessage = error.name === "GeminiAnalysisError";
    sendJson(req, res, status, {
      error: {
        code: exposeMessage ? "gemini_analysis_error" : status >= 500 ? "internal_error" : "bad_request",
        message: status >= 500 && !exposeMessage ? "Unexpected server error" : error.message,
        details: error.details,
      },
    });
    if (status >= 500) {
      console.error(error);
    }
  } finally {
    console.log(`${req.method} ${url.pathname} ${Date.now() - started}ms`);
  }
});

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use on ${host}. Stop the existing API or set PORT to another value.`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, host, () => {
    console.log(`TerraSignal backend listening at http://${host}:${port}`);
  });
}
