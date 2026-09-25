// Tests run against an in-memory SQLite database so they never need a
// PostgreSQL server. PostgreSQL is the default everywhere else.
process.env.DB_CLIENT = "sqlite";
process.env.TERRASIGNAL_DB_PATH = ":memory:";

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseCoordinateInput } from "./land/coordinate-parser.js";
import { collectLandScanLayers } from "./land/data-adapters.js";
import {
  buildGeminiAnalysisInput,
  buildGeminiMessages,
  containsBannedClaims,
  generateGeminiAnalysis,
  validateGeminiAnalysis,
} from "./land/gemini-analysis-service.js";
import { buildReportPdf, pdfExportEligibility } from "./land/pdf.js";
import { buildExplainableLandScan, classifyRiskBand, validateExplainableLandScan } from "./land/scoring-engine.js";
import { finalizeScanReadiness, normalizeLandScanRequest } from "./land/land-scan-service.js";

const testUsersPath = path.resolve("data/test-users.json");
if (existsSync(testUsersPath)) rmSync(testUsersPath, { force: true });

process.env.OPENTOPOGRAPHY_API_KEY = "";
process.env.OPEN_METEO_ELEVATION_DISABLED = "true";
process.env.OVERPASS_API_URL = "";
process.env.CESIUM_ION_TOKEN = "";
process.env.MAPBOX_ACCESS_TOKEN = "";
process.env.SCAN_MODE = "live";

const productionAuthCheck = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    "process.env.NODE_ENV='production'; delete process.env.JWT_SECRET; delete process.env.TERRASIGNAL_JWT_SECRET; const auth = await import('./backend/auth.js'); try { auth.validateAuthConfiguration(); process.exit(1); } catch (error) { process.exit(String(error.message).includes('JWT_SECRET') ? 0 : 2); }",
  ],
  { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", JWT_SECRET: "", TERRASIGNAL_JWT_SECRET: "" } },
);
assert.equal(productionAuthCheck.status, 0);

const decimal = parseCoordinateInput("28.4595, 77.0266");
assert.equal(decimal.ok, true);
assert.equal(decimal.coordinate.latitude, 28.4595);
assert.equal(decimal.coordinate.longitude, 77.0266);

const dms = parseCoordinateInput(`19°12'44.7"N 73°08'39.3"E`);
assert.equal(dms.ok, true);
assert.equal(Number(dms.coordinate.latitude.toFixed(6)), 19.212417);
assert.equal(Number(dms.coordinate.longitude.toFixed(6)), 73.14425);

assert.equal(classifyRiskBand(20).label, "Low");
assert.equal(classifyRiskBand(55).label, "Moderate");
assert.equal(classifyRiskBand(82).label, "High");
assert.equal(classifyRiskBand(Number.NaN).label, "Unknown");

const user = {
  id: "test-user",
  email: "tester@example.com",
  role: "admin",
};

const payload = {
  address: "Validation parcel",
  coordinateInput: "28.4595, 77.0266",
  radiusMeters: 500,
  intendedUse: "warehouse",
  reportDepth: "standard",
  boundary: [
    { lat: 28.4596, lng: 77.0264 },
    { lat: 28.4598, lng: 77.0268 },
    { lat: 28.4594, lng: 77.027 },
  ],
};

const demoPayload = { ...payload, scanMode: "internalDemo" };
const demoInput = normalizeLandScanRequest(demoPayload).input;
const firstScan = buildExplainableLandScan({
  scanId: "demo-test-one",
  userId: user.id,
  input: demoInput,
  layers: await collectLandScanLayers(demoInput),
});
const secondScan = buildExplainableLandScan({
  scanId: "demo-test-two",
  userId: user.id,
  input: demoInput,
  layers: await collectLandScanLayers(demoInput),
});
const geminiAnalysis = {
  aiStatus: "completed",
  aiProvider: "gemini",
  provider: "gemini",
  aiModel: "gemini-test",
  model: "gemini-test",
  generatedAt: new Date().toISOString(),
  executiveSummary: "Gemini test executive summary based on the provided scan inputs.",
  siteOverview: "Gemini test site overview.",
  dataQualityAssessment: "Gemini test data quality assessment.",
  riskInterpretation: "Gemini test risk interpretation.",
  scoreReasoning: {
    overallRisk: "Gemini test overall risk reasoning.",
    overallConfidence: "Gemini test confidence reasoning.",
    missingDataImpact: "Gemini test missing data impact.",
  },
  subScoreAnalysis: [
    {
      scoreId: "slopeTerrainRisk",
      plainEnglishExplanation: "Gemini test plain-English score explanation.",
      technicalExplanation: "Gemini test technical score explanation.",
      whyItMatters: "Gemini test score importance.",
      confidenceCommentary: "Gemini test confidence commentary.",
      recommendedVerification: ["Gemini test verification."],
    },
  ],
  redFlagsExplained: ["Gemini test red flag explanation."],
  positiveIndicatorsExplained: ["Gemini test positive indicator explanation."],
  intendedUseAssessment: "Gemini test intended-use assessment.",
  clientFriendlySummary: "Gemini test client-friendly summary.",
  professionalVerificationChecklist: ["Certified geotechnical investigation."],
  limitations: ["Gemini test limitation."],
  cannotConclude: ["Gemini test cannot-conclude item."],
  recommendedNextSteps: ["Gemini test next step."],
  disclaimer: "Preliminary AI-assisted analysis only.",
};
assert.equal(validateGeminiAnalysis(geminiAnalysis).valid, true);
const first = {
  scan: firstScan,
  report: {
    mode: "gemini",
    generatedAt: new Date().toISOString(),
    executiveSummary: geminiAnalysis.executiveSummary,
    aiAnalysis: geminiAnalysis,
    sections: [
      { title: "Executive Summary", body: geminiAnalysis.executiveSummary },
      { title: "Gemini Analysis", body: geminiAnalysis.clientFriendlySummary },
      { title: "What Certified Professionals Should Verify", body: geminiAnalysis.professionalVerificationChecklist.join("\n") },
    ],
    narrative: `${firstScan.mockDataNotice}\n\nExecutive Summary\n${geminiAnalysis.executiveSummary}\n\nWhat Certified Professionals Should Verify\n${geminiAnalysis.professionalVerificationChecklist.join("\n")}`,
  },
};
const second = { scan: secondScan };
assert.equal(first.scan.overallRiskScore, second.scan.overallRiskScore);
assert.equal(first.scan.subScores.slopeTerrainRisk.score, second.scan.subScores.slopeTerrainRisk.score);
assert.equal(validateExplainableLandScan(first.scan).valid, true);
assert.ok(first.report.narrative.includes("Certified geotechnical investigation"));
assert.ok(first.scan.disclaimer.includes("preliminary site intelligence"));
assert.equal(first.scan.dataMode, "mock");
assert.equal(first.scan.reportReadiness, "internalDemo");
assert.equal(first.scan.clientReadyDeliverable, false);
assert.ok(first.scan.scoreExplainability.slopeTerrainRisk.explanation.includes("Mean slope") || first.scan.scoreExplainability.slopeTerrainRisk.explanation.includes("slope"));
assert.ok(first.report.narrative.includes("Demo output using mocked screening indicators"));
assert.equal(pdfExportEligibility(first.scan).allowed, false);
assert.equal(first.report.aiAnalysis.aiStatus, "completed");

const liveInput = normalizeLandScanRequest({ ...payload, pricingMode: "client", scanMode: "live" }).input;
const unavailableLayers = await collectLandScanLayers(liveInput);
assert.equal(Object.values(unavailableLayers).every((layer) => layer.status !== "mock"), true);
assert.equal(unavailableLayers.elevationTopography.dataMode, "unavailable");
assert.equal(unavailableLayers.infrastructure.dataMode, "unavailable");
const unavailableScan = buildExplainableLandScan({
  scanId: "unavailable-test",
  userId: user.id,
  input: liveInput,
  layers: unavailableLayers,
});
assert.equal(unavailableScan.dataMode, "unavailable");
assert.equal(unavailableScan.clientReadyDeliverable, false);
assert.equal(unavailableScan.reportReadiness, "unavailable");
assert.equal(unavailableScan.subScores.geologySoilRisk, undefined);
assert.ok(unavailableScan.unavailableScores.includes("slopeTerrainRisk"));

const liveLayers = structuredClone(first.scan.rawLayers);
for (const layer of Object.values(liveLayers)) {
  if (!layer || typeof layer !== "object" || !layer.id) continue;
  if (layer.scoringEligible === false) {
    layer.dataMode = "unavailable";
    layer.status = "unavailable";
    continue;
  }
  layer.status = "live";
  layer.dataMode = "live";
  layer.sourceType = "open-data";
  layer.confidence = 0.82;
  layer.limitations = "Live provider screening-level data; still requires professional verification.";
}
const liveScan = buildExplainableLandScan({
  scanId: "live-test",
  userId: user.id,
  input: liveInput,
  layers: liveLayers,
});
assert.equal(liveScan.dataMode, "live");
assert.equal(liveScan.reportReadiness, "clientPreview");
assert.equal(liveScan.clientReadyDeliverable, false);
assert.equal(liveScan.minimumLiveDataPackage.satisfied, true);
finalizeScanReadiness(liveScan, {
  aiAnalysis: {
    aiStatus: "completed",
  },
});
assert.equal(liveScan.reportReadiness, "clientDeliverableEligible");
assert.equal(liveScan.clientReadyDeliverable, true);
assert.equal(pdfExportEligibility(liveScan).allowed, true);

const mixedLayers = structuredClone(liveLayers);
mixedLayers.elevationTopography.status = "unavailable";
mixedLayers.elevationTopography.dataMode = "unavailable";
mixedLayers.slope.status = "unavailable";
mixedLayers.slope.dataMode = "unavailable";
const mixedScan = buildExplainableLandScan({
  scanId: "mixed-test",
  userId: user.id,
  input: { ...liveInput, scanMode: "mixed" },
  layers: mixedLayers,
});
assert.equal(mixedScan.dataMode, "mixed");
assert.equal(mixedScan.reportReadiness, "clientPreview");
assert.equal(mixedScan.clientReadyDeliverable, false);
assert.equal(pdfExportEligibility(mixedScan).allowed, true);

const geminiInput = buildGeminiAnalysisInput(first.scan);
assert.equal(geminiInput.deterministicScores.overallRiskScore, first.scan.overallRiskScore);
assert.ok(geminiInput.providerOutputs);
const geminiMessages = buildGeminiMessages(first.scan);
assert.ok(geminiMessages[1].content.includes("scanJson"));
assert.ok(geminiMessages[1].content.includes("providerOutputs"));
assert.deepEqual(containsBannedClaims("This is guaranteed safe and a final engineering decision."), [
  "guaranteed",
  "final engineering decision",
]);
const originalGeminiKey = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = "";
await assert.rejects(() => generateGeminiAnalysis(first.scan), /GEMINI_API_KEY/);
if (originalGeminiKey === undefined) {
  delete process.env.GEMINI_API_KEY;
} else {
  process.env.GEMINI_API_KEY = originalGeminiKey;
}

const pdfBuffer = buildReportPdf(liveScan, first.report);
const pdfText = pdfBuffer.toString("latin1");
assert.ok(pdfText.includes("Provider/source table"));
assert.ok(pdfText.includes("Score explainability table"));
assert.ok(pdfText.includes("Gemini analysis"));
assert.ok(pdfText.includes("Disclaimer"));

process.env.TERRASIGNAL_DB_PATH = ":memory:";
process.env.TERRASIGNAL_USERS_PATH = testUsersPath;
process.env.JWT_SECRET = "land-scan-test-secret";
if (process.env.RUN_LIVE_GEMINI_TEST !== "true") process.env.GEMINI_API_KEY = "";
const { server, store } = await import("./server.js");

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/api`;

try {
  const registerResponse = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "pilot@example.com",
      password: "PilotPass123!",
      name: "Pilot User",
      company: "Pilot Co",
    }),
  });
  assert.equal(registerResponse.status, 201);
  const auth = await registerResponse.json();
  assert.ok(auth.token);
  assert.equal(auth.user.role, "user");

  const scanResponse = await fetch(`${baseUrl}/land-scans`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify(demoPayload),
  });
  const runLiveGeminiTest = process.env.RUN_LIVE_GEMINI_TEST === "true" && Boolean(String(process.env.GEMINI_API_KEY || "").trim());
  if (runLiveGeminiTest) {
    assert.equal(scanResponse.status, 201);
    const created = await scanResponse.json();
    assert.ok(created.scan.scanId);
    assert.equal(validateExplainableLandScan(created.scan).valid, true);
    assert.equal(created.scan.dataMode, "mock");
    assert.equal(created.scan.clientReadyDeliverable, false);
    assert.ok(created.scan.mockDataNotice.includes("mocked screening indicators"));
    assert.ok(created.scan.lowConfidenceWarnings.length > 0);
    assert.equal(created.report.aiAnalysis.aiStatus, "completed");

    const liveScanResponse = await fetch(`${baseUrl}/land-scans`, {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...payload, scanMode: "live" }),
    });
    assert.equal(liveScanResponse.status, 201);
    const liveCreated = await liveScanResponse.json();
    assert.notEqual(liveCreated.scan.dataMode, "mock");
    assert.equal(liveCreated.scan.clientReadyDeliverable, false);

    const detailResponse = await fetch(`${baseUrl}/land-scans/${created.scan.scanId}`, {
      headers: { authorization: `Bearer ${auth.token}` },
    });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.scan.scan.scanId, created.scan.scanId);

    const pdfResponse = await fetch(`${baseUrl}/land-scans/${created.scan.scanId}/pdf`, {
      headers: { authorization: `Bearer ${auth.token}` },
    });
    assert.equal(pdfResponse.status, 403);
    const blocked = await pdfResponse.json();
    assert.equal(blocked.error.code, "report_export_blocked");
  } else {
    assert.ok([502, 503].includes(scanResponse.status));
    const errorBody = await scanResponse.json();
    assert.equal(errorBody.error.code, "gemini_analysis_error");
    assert.ok(errorBody.error.message.includes("Gemini"));
  }

  const listResponse = await fetch(`${baseUrl}/land-scans`, {
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(listed.scans.length, runLiveGeminiTest ? 2 : 0);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await store.close?.();
  if (existsSync(testUsersPath)) rmSync(testUsersPath, { force: true });
}

console.log("Land scan validation passed.");
