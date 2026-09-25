import {
  actionForRisk,
  analyzeSurvey,
  buildReport,
  classifyRiskLevel,
  comparePriority,
  exportAnalyzedCsv,
  summarizeAnalysis,
} from "./analysis-engine.js";
import { projects } from "./seed-data.js";
import { sanitizeForStorage, sanitizeStorageText, toStorageJson } from "./storage-sanitizer.js";

const threshold = 70;
const settings = {
  noiseSuppression: 72,
  physicsWeight: 68,
  anomalyThreshold: threshold,
  focus: "HYBRID",
};
const project = projects.find((item) => item.id === "riverside") ?? projects[0];
const analyzed = analyzeSurvey(project.points, settings, project);
const summary = summarizeAnalysis(analyzed, threshold);
const csvText = exportAnalyzedCsv(analyzed);
const reportText = buildReport(project, analyzed, settings);
const escalationAction = "Escalate to geotechnical reviewer before bid freeze.";

const average = (values) =>
  values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;

const issues = [];
const belowThreshold = analyzed.filter((point) => point.anomalyScore < threshold);
const highRisk = analyzed.filter((point) => point.riskLevel === "HIGH");

for (const point of belowThreshold) {
  if (point.riskLevel === "HIGH") {
    issues.push(`${point.id} is below threshold but has HIGH risk.`);
  }
  if (point.action === escalationAction) {
    issues.push(`${point.id} is below threshold but has escalation action.`);
  }
}

const mediumRisk = classifyRiskLevel(threshold - 1, threshold);
if (mediumRisk !== "MEDIUM" || actionForRisk(mediumRisk) === escalationAction) {
  issues.push("R-11-style below-threshold anomaly can still escalate.");
}

if (summary.meanConfidence !== average(highRisk.map((point) => point.confidence))) {
  issues.push("Mean confidence does not match HIGH anomaly mean.");
}

if (summary.meanResidual !== average(highRisk.map((point) => point.physicsResidual))) {
  issues.push("Mean residual does not match HIGH anomaly mean.");
}

const sortedIds = [...summary.priorityFindings].sort(comparePriority).map((point) => point.id);
const actualIds = summary.priorityFindings.map((point) => point.id);
if (sortedIds.join("|") !== actualIds.join("|")) {
  issues.push("Priority findings are not sorted by the deterministic ranking function.");
}

for (const point of analyzed) {
  for (const field of [
    "id",
    "x",
    "y",
    "lat",
    "lon",
    "coordinateMode",
    "depth",
    "resistivity",
    "velocity",
    "magnetic",
    "noise",
    "anomalyScore",
    "riskScore",
    "confidence",
    "className",
    "physicsResidual",
    "residual",
    "reason",
    "explanation",
    "riskLevel",
    "action",
    "recommendedAction",
  ]) {
    if (point[field] === undefined || point[field] === null || point[field] === "") {
      issues.push(`${point.id} is missing ${field}.`);
    }
  }
}

for (const label of [
  "x_m",
  "y_m",
  "lat",
  "lon",
  "coordinate_mode",
  "depth_m",
  "resistivity_ohm_m",
  "velocity_m_s",
  "magnetic_nT",
  "noise_index",
  "anomaly_score",
  "risk_score",
  "confidence_pct",
  "heuristic_residual_pct",
  "reason",
]) {
  if (!csvText.includes(label)) {
    issues.push(`CSV output is missing ${label}.`);
  }
}

for (const label of ["ohm-m", "m/s", "nT", "noise index", "Heuristic residual definition"]) {
  if (!reportText.includes(label)) {
    issues.push(`Report output is missing ${label}.`);
  }
}

const storageSmokeTest = {
  id: "R-11\u0000",
  note: "Imported files can contain hidden NUL\u0000 characters.",
  nested: [{ label: "bad\u0000key" }],
};
const sanitizedStorageJson = toStorageJson(storageSmokeTest);
if (sanitizedStorageJson.includes("\\u0000") || sanitizedStorageJson.includes("\u0000")) {
  issues.push("Storage JSON sanitizer still emits NUL characters.");
}

const sanitizedStorageObject = sanitizeForStorage(storageSmokeTest);
if (sanitizedStorageObject.id !== "R-11" || sanitizedStorageObject.nested[0].label !== "badkey") {
  issues.push("Storage object sanitizer did not remove hidden NUL characters.");
}

if (sanitizeStorageText("report\u0000text") !== "reporttext") {
  issues.push("Storage text sanitizer did not remove hidden NUL characters.");
}

if (issues.length) {
  console.error("MVP validation failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      project: project.id,
      threshold,
      anomalies: analyzed.length,
      highRisk: highRisk.length,
      clusters: summary.clusters.length,
      message: "MVP anomaly/register/report validation passed.",
    },
    null,
    2,
  ),
);
