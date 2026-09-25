import { randomUUID } from "node:crypto";
import { normalizeScanLocation } from "./coordinate-parser.js";
import { collectLandScanLayers } from "./data-adapters.js";
import { buildExplainableLandScan, validateExplainableLandScan } from "./scoring-engine.js";
import { generateProfessionalReport } from "./report-generator.js";

const allowedUses = new Set([
  "residential",
  "commercial",
  "warehouse",
  "industrial",
  "farmland",
  "infrastructure",
  "mixed use",
  "unknown/general feasibility",
]);

const allowedDepths = new Set(["quick", "standard", "professional"]);
const allowedScanModes = new Set(["internalDemo", "live", "mixed"]);

const normalizeUse = (value) => {
  const normalized = String(value || "unknown/general feasibility").trim().toLowerCase();
  return allowedUses.has(normalized) ? normalized : "unknown/general feasibility";
};

const normalizeDepth = (value) => {
  const normalized = String(value || "standard").trim().toLowerCase();
  return allowedDepths.has(normalized) ? normalized : "standard";
};

const normalizeScanMode = (value) => {
  const fromEnv = process.env.SCAN_MODE || "live";
  const normalized = String(value || fromEnv).trim();
  return allowedScanModes.has(normalized) ? normalized : "invalid";
};

export const normalizeLandScanRequest = (body = {}) => {
  const locationResult = normalizeScanLocation({
    coordinateInput: body.coordinateInput,
    latitude: body.latitude ?? body.lat ?? body.location?.lat,
    longitude: body.longitude ?? body.lng ?? body.location?.lng,
    address: body.address ?? body.location?.address,
    radiusMeters: body.radiusMeters ?? body.location?.radiusMeters,
    boundary: body.boundary ?? body.location?.boundary,
  });

  const errors = [...locationResult.errors];
  const intendedUse = normalizeUse(body.intendedUse);
  const reportDepth = normalizeDepth(body.reportDepth);
  const scanMode = normalizeScanMode(body.scanMode || body.analysisMode);
  if (body.intendedUse && !allowedUses.has(String(body.intendedUse).trim().toLowerCase())) {
    errors.push("intendedUse was not recognized; supported values are residential, commercial, warehouse, industrial, farmland, infrastructure, mixed use, and unknown/general feasibility.");
  }
  if (body.reportDepth && !allowedDepths.has(String(body.reportDepth).trim().toLowerCase())) {
    errors.push("reportDepth must be quick, standard, or professional.");
  }
  if (scanMode === "invalid") {
    errors.push("scanMode must be internalDemo, live, or mixed. Live/mixed modes do not silently use mock data.");
  }
  if (
    scanMode === "internalDemo" &&
    String(process.env.NODE_ENV || "development").toLowerCase() === "production" &&
    process.env.ALLOW_INTERNAL_DEMO !== "true"
  ) {
    errors.push("internalDemo scans are disabled in production unless ALLOW_INTERNAL_DEMO=true.");
  }

  return {
    valid: locationResult.valid && errors.length === 0,
    errors,
    input: {
      location: locationResult.location,
      intendedUse,
      reportDepth,
      requestedAt: new Date().toISOString(),
      addressSearchQuery: String(body.addressSearchQuery || body.search || "").trim(),
      pricingMode: String(body.pricingMode || (scanMode === "internalDemo" ? "free-demo" : "client")),
      scanMode,
      approvedMixed: body.approvedMixed === true,
      reportReadinessOverride: body.reportReadinessOverride || null,
    },
  };
};

export const finalizeScanReadiness = (scan, report) => {
  const aiStatus = report?.aiAnalysis?.aiStatus || "not_configured";
  const hasExplainability = Object.keys(scan.scoreExplainability || {}).length > 0;
  const hasSourceTable = (scan.sourceTable || scan.dataSources || []).length > 0;
  const hasLimitationsTable = (scan.limitationsTable || []).length > 0;
  const commonBlockedReason =
    aiStatus !== "completed"
      ? "Live AI analysis is required for client-deliverable eligibility and did not complete."
      : !hasExplainability
        ? "Score explainability is incomplete."
        : !hasSourceTable
          ? "Provider/source table is incomplete."
          : !hasLimitationsTable
            ? "Limitations table is incomplete."
            : "";

  if (scan.dataMode === "mock") {
    scan.reportReadiness = "internalDemo";
    scan.deliverableStatus = "internalDemo";
    scan.reportLabel = "Internal Demo Report - Mock Data";
    scan.clientReadyDeliverable = false;
    scan.externalUseBlockedReason = "Pure mock reports are blocked from client-ready export.";
    return scan;
  }
  if (scan.dataMode === "unavailable" || !scan.minimumLiveDataPackage?.hasRealElevationOrTerrainProvider) {
    scan.reportReadiness = "unavailable";
    scan.deliverableStatus = "unavailable";
    scan.reportLabel = "Unavailable-data screening record";
    scan.clientReadyDeliverable = false;
    scan.externalUseBlockedReason = "Minimum live provider coverage is not met.";
    return scan;
  }
  if (scan.dataMode === "mixed" || !scan.minimumLiveDataPackage?.satisfied) {
    scan.reportReadiness = "clientPreview";
    scan.deliverableStatus = "clientPreview";
    scan.reportLabel = "Partial Live-Data Preliminary Screening Preview";
    scan.clientReadyDeliverable = false;
    scan.externalUseBlockedReason =
      commonBlockedReason ||
      "Partial live-data previews are not client-deliverable eligible until the minimum live data package is satisfied with no mock scoring providers.";
    return scan;
  }

  if (
    scan.dataMode === "live" &&
    scan.minimumLiveDataPackage?.satisfied &&
    scan.minimumLiveDataPackage?.noMockProviderUsedInScore &&
    aiStatus === "completed" &&
    hasExplainability &&
    hasSourceTable &&
    hasLimitationsTable
  ) {
    scan.reportReadiness = "clientDeliverableEligible";
    scan.deliverableStatus = "clientDeliverableEligible";
    scan.reportLabel = "Preliminary Site Intelligence Report";
    scan.clientReadyDeliverable = true;
    scan.externalUseBlockedReason = "";
    return scan;
  }

  scan.reportReadiness = "clientPreview";
  scan.deliverableStatus = "clientPreview";
  scan.reportLabel = "Preliminary Site Intelligence Preview";
  scan.clientReadyDeliverable = false;
  scan.externalUseBlockedReason = commonBlockedReason || "Final client-deliverable readiness requirements are not met.";
  return scan;
};

export const runLandScan = async ({ body, user }) => {
  const normalized = normalizeLandScanRequest(body);
  if (!normalized.valid) {
    const error = new Error(normalized.errors.join(" "));
    error.status = 422;
    error.details = normalized.errors;
    throw error;
  }

  // Always server-minted. A client-chosen scan id would let a caller aim a
  // write at another record identifier.
  const scanId = randomUUID();
  const layers = await collectLandScanLayers(normalized.input);
  const scan = buildExplainableLandScan({
    scanId,
    userId: user?.id || null,
    input: normalized.input,
    layers,
  });
  const schema = validateExplainableLandScan(scan);
  if (!schema.valid) {
    const error = new Error(`Generated scan failed schema validation: ${schema.errors.join(" ")}`);
    error.status = 500;
    error.details = schema.errors;
    throw error;
  }

  const report = await generateProfessionalReport(scan);
  finalizeScanReadiness(scan, report);
  scan.aiAnalysis = report.aiAnalysis;
  scan.aiStatus = report.aiAnalysis?.aiStatus || "not_configured";
  return { scan, report };
};

export const scanToRunRecord = ({ scan, report, user }) => ({
  id: scan.scanId,
  projectId: `land-scan-${user?.id || "anonymous"}`,
  projectName: scan.location.address || `${scan.intendedUse} land scan`,
  locationName: scan.location.address || `${scan.location.lat.toFixed(6)}, ${scan.location.lng.toFixed(6)}`,
  latitude: scan.location.lat,
  longitude: scan.location.lng,
  coordinateMode: "lat_lon",
  datasetLabel: `${scan.intendedUse} ${scan.reportDepth} land risk screening`,
  settings: {
    intendedUse: scan.intendedUse,
    reportDepth: scan.reportDepth,
    scanMode: scan.rawLayers?.__scanMode || scan.dataMode,
    pricingMode: scan.dataMode === "mock" ? "free-demo" : "client",
    dataMode: scan.dataMode,
    reportReadiness: scan.reportReadiness,
  },
  inputPoints: [],
  analyzed: [],
  summary: {
    flagged: scan.redFlags,
    priorityFindings: scan.redFlags,
    clusters: [],
    top: null,
    meanConfidence: Math.round(scan.confidence * 100),
    meanResidual: 0,
    highRisk: scan.riskBands.label === "High" ? 1 : 0,
    boreholesSaved: null,
    planningImpactSupported: true,
  },
  reportText: report.narrative,
  warnings: [
    ...(scan.lowConfidenceWarnings || []),
    ...(scan.confidence < 0.55 ? ["Low data confidence: verify with official providers and certified professionals."] : []),
  ],
  visualizationSettings: {
    kind: "land-scan",
    userId: user?.id || null,
    status: scan.status,
    landScan: scan,
    professionalReport: report,
  },
});

export const runToLandScanSummary = (run) => {
  const scan = run.visualizationSettings?.landScan;
  const report = run.visualizationSettings?.professionalReport;
  if (!scan) return null;
  return {
    id: scan.scanId,
    status: scan.status || "completed",
    createdAt: run.createdAt || scan.createdAt,
    location: scan.location,
    intendedUse: scan.intendedUse,
    reportDepth: scan.reportDepth,
    overallRiskScore: scan.overallRiskScore,
    overallSuitabilityScore: scan.overallSuitabilityScore,
    confidence: scan.confidence,
    dataMode: scan.dataMode,
    deliverableStatus: scan.deliverableStatus,
    reportReadiness: scan.reportReadiness,
    reportLabel: scan.reportLabel,
    clientReadyDeliverable: scan.clientReadyDeliverable,
    mockDataNotice: scan.mockDataNotice,
    riskBand: scan.riskBands.label,
    redFlagCount: scan.redFlags.length,
    reportAvailable: Boolean(report),
  };
};

export const runToLandScanDetail = (run) => {
  const summary = runToLandScanSummary(run);
  if (!summary) return null;
  return {
    ...summary,
    scan: run.visualizationSettings.landScan,
    report: run.visualizationSettings.professionalReport,
  };
};
