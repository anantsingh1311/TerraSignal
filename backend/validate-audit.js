import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  auditRawLayerData,
  auditScoringData,
  auditValidationData,
  buildSiteReportAuditSnapshot,
  calculateDataConfidence,
  strictFetchStatus,
  validateReportInput,
} from "./report-audit.js";

// Tests run against an in-memory SQLite database so they never need a running
// PostgreSQL server; PostgreSQL is the default everywhere else. These must be
// set before server.js is evaluated, so the import is dynamic: static imports
// are hoisted above statements and would run first.
process.env.DB_CLIENT = "sqlite";
process.env.TERRASIGNAL_DB_PATH = ":memory:";

const { server, store } = await import("./server.js");

const now = new Date().toISOString();

const layer = (id, label, value, status = "cached") => ({
  id,
  label,
  value,
  confidence: 62,
  provider: `${label} provider`,
  source: `${label} model-assisted layer`,
  status,
  generatedAt: now,
  explanation: `${label} explanation.`,
  limitation: `${label} limitation.`,
  recommendedAction: `${label} recommended action.`,
  critical: true,
  weight: { buyer: 0.2, builder: 0.2, engineer: 0.2 },
});

const activeSite = {
  id: "audit-test-site",
  projectName: "Audit Test Site",
  clientName: "QA",
  companyName: "TerraSignal",
  userRole: "Land purchaser",
  latitude: 34.087059,
  longitude: -118.483861,
  coordinateInputOriginal: "34.087059, -118.483861",
  coordinateFormat: "decimal",
  radiusMeters: 250,
  intendedUse: "Residential apartment",
  constructionType: "Residential",
  buildingType: "Mid-rise apartment",
  floors: 6,
  approximatePlotArea: 1200,
  plotAreaUnit: "sqm",
  loadCategory: "Medium",
  purchaseStage: "Before purchase",
  reportAudience: "Land purchaser",
  createdAt: now,
};

const screening = {
  overallRiskScore: 61,
  constructionRiskScore: 58,
  landPurchaseRiskScore: 64,
  developmentProfitRiskIndicator: 57,
  dataConfidence: 60,
  buildabilityCautionLevel: "Moderate",
  terrainSlopeRisk: 32,
  drainageWaterloggingRisk: 66,
  groundwaterDewateringRisk: 54,
  seismicRisk: 42,
  landCoverChangeRisk: 48,
  legalTitlePlanningRisk: 67,
  infrastructureAccessRisk: 55,
  urbanDevelopmentRisk: 50,
  slopeRisk: 32,
  waterProximityRisk: 44,
  soilUncertaintyRisk: 62,
  dataQualityPenalty: 18,
  layerAssessments: {
    terrainSlopeRisk: layer("terrainSlopeRisk", "Terrain / slope", 32),
    elevationRisk: layer("elevationRisk", "Elevation context", 30),
    drainageWaterloggingRisk: layer("drainageWaterloggingRisk", "Drainage / waterlogging", 66),
    waterbodyProximityRisk: layer("waterbodyProximityRisk", "Waterbody proximity", 44),
    groundwaterDewateringRisk: layer("groundwaterDewateringRisk", "Groundwater / dewatering", 54),
    soilUncertaintyRisk: layer("soilUncertaintyRisk", "Soil uncertainty", 62),
    seismicCodeRisk: layer("seismicCodeRisk", "Seismic design context", 42),
    landCoverChangeRisk: layer("landCoverChangeRisk", "Land cover / wetness", 48),
    urbanDevelopmentRisk: layer("urbanDevelopmentRisk", "Urban development / imperviousness", 50),
    legalTitlePlanningRisk: layer("legalTitlePlanningRisk", "Legal / planning", 67),
    infrastructureAccessRisk: layer("infrastructureAccessRisk", "Infrastructure / access", 55),
    dataQualityPenalty: layer("dataQualityPenalty", "Data quality penalty", 18, "fallback"),
  },
  aiAnalysis: { executiveSummary: "Moderate audit test summary." },
  constructionSuitability: {
    explanation: "Conditional suitability only.",
    notRecommendedWithoutDetailedInvestigation: ["Heavy loads before field testing"],
  },
  clientReviews: {
    purchaser: ["Purchaser should verify public records and soil reports."],
    builder: ["Builder should verify foundation and drainage constraints."],
    engineer: ["Engineer should scope boreholes, CPT/SPT, and lab testing."],
  },
  buyerWarnings: ["Verify title and geotechnical evidence."],
  engineerNotes: ["Do not infer bearing capacity from screening."],
  recommendedNextSteps: ["Commission geotechnical investigation."],
  limitations: ["Screening only."],
};

const coordinateValidation = validateReportInput(activeSite);
assert.equal(coordinateValidation.valid, true);
assert.ok(coordinateValidation.warnings.some((warning) => warning.includes("Multi-floor")));
assert.equal(validateReportInput({ ...activeSite, latitude: 100 }).valid, false);
assert.equal(validateReportInput({ ...activeSite, radiusMeters: 0 }).valid, false);
assert.ok(validateReportInput({ ...activeSite, radiusMeters: 10 }).warnings.some((warning) => warning.includes("50 m")));
assert.ok(validateReportInput({ ...activeSite, approximatePlotArea: 20, plotAreaUnit: "acre" }).warnings.some((warning) => warning.includes("sqm")));

assert.equal(strictFetchStatus({ providerName: "Provider", providerStatus: "live", fetchedAt: now, rawValue: { ok: true } }), "live");
assert.equal(strictFetchStatus({ providerName: "Provider", providerStatus: "live", rawValue: { ok: true } }), "modelled");
assert.equal(strictFetchStatus({ providerName: "Provider", providerStatus: "cached", rawValue: { ok: true } }), "modelled");
assert.equal(strictFetchStatus({ providerName: "Provider", providerStatus: "fallback" }), "fallback");

const confidence = calculateDataConfidence(Object.values(screening.layerAssessments).map((assessment) => ({
  layerId: assessment.id,
  layerName: assessment.label,
  category: "soil",
  providerName: assessment.provider,
  providerType: "internal-model",
  fetchStatus: "modelled",
  sourceConfidence: assessment.confidence,
  weightUsed: 0.1,
})));
assert.ok(confidence.confidenceScore <= 70);

const reportId = randomUUID();
const auditSnapshot = buildSiteReportAuditSnapshot({
  reportId,
  site: activeSite,
  screening,
  reportText: "Audit report text",
});
assert.equal(auditSnapshot.reportId, reportId);
assert.ok(auditSnapshot.dataLayers.length >= 10);
assert.ok(auditSnapshot.narrativeProvenance.every((section) => section.evidenceLayerIds.length > 0));
assert.ok(auditScoringData(auditSnapshot).scoreBreakdown.overallWeightedRisk >= 0);
assert.ok(auditRawLayerData(auditSnapshot).layers.length >= 10);
assert.equal(auditValidationData(auditSnapshot).reportId, reportId);
JSON.stringify(auditSnapshot);

const persistedReportId = randomUUID();
await store.saveReportAudit({
  reportId: persistedReportId,
  createdAt: auditSnapshot.generatedAt,
  userInput: auditSnapshot.userInput,
  auditSnapshot: { ...auditSnapshot, reportId: persistedReportId },
  reportText: "Audit report text",
  status: "generated",
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api`;

  // The audit trail is tenant data, so it now requires an authenticated
  // session. Assert the gate as well as the payload.
  const anonymous = await fetch(`${base}/reports/${persistedReportId}/audit`);
  assert.equal(anonymous.status, 401, "audit trail must reject unauthenticated callers");

  const registration = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `audit-${randomUUID()}@example.com`,
      password: "AuditCheck#2026x",
      name: "Audit Check",
      company: "QA",
    }),
  });
  assert.equal(registration.status, 201);
  const { token } = await registration.json();

  // The persisted snapshot has no owning run, so only an admin may read it.
  // A standard account must be refused.
  const asUser = await fetch(`${base}/reports/${persistedReportId}/audit`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(asUser.status, 404, "orphan audit snapshots must not be readable by a standard account");

  // With an owning run in place, the owner can read its own audit trail.
  const ownedReportId = randomUUID();
  const profile = await (await fetch(`${base}/auth/profile`, { headers: { authorization: `Bearer ${token}` } })).json();
  await store.saveRun({
    id: ownedReportId,
    projectId: "audit-owned-project",
    projectName: "Audit owned run",
    locationName: "34.087059, -118.483861",
    latitude: activeSite.latitude,
    longitude: activeSite.longitude,
    coordinateMode: "lat_lon",
    datasetLabel: "Audit ownership check",
    settings: {},
    inputPoints: [],
    analyzed: [],
    summary: {},
    reportText: "Audit report text",
    warnings: [],
    visualizationSettings: { kind: "land-scan", userId: profile.user.id },
  });
  await store.saveReportAudit({
    reportId: ownedReportId,
    createdAt: auditSnapshot.generatedAt,
    userInput: auditSnapshot.userInput,
    auditSnapshot: { ...auditSnapshot, reportId: ownedReportId },
    reportText: "Audit report text",
    status: "generated",
  });

  const owned = await fetch(`${base}/reports/${ownedReportId}/audit`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(owned.status, 200);
  const payload = await owned.json();
  assert.equal(payload.reportId, ownedReportId);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await store.close?.();
}

console.log(JSON.stringify({ ok: true, message: "Audit/provenance validation passed." }, null, 2));
