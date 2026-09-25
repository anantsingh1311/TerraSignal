import type { AnalysisSummary, AnalyzedPoint } from "./types";

export type ValidationIssue = {
  code: string;
  message: string;
};

export type ValidationInput = {
  anomalies: AnalyzedPoint[];
  summary: AnalysisSummary;
  anomalyThreshold: number;
  csvText?: string;
  reportText?: string;
};

const escalationAction = "Escalate to geotechnical reviewer before bid freeze.";

const average = (values: number[]) =>
  values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;

const riskRank = (riskLevel: AnalyzedPoint["riskLevel"]) =>
  ({ HIGH: 3, MEDIUM: 2, LOW: 1 })[riskLevel] ?? 0;

const comparePriority = (a: AnalyzedPoint, b: AnalyzedPoint) =>
  riskRank(b.riskLevel) - riskRank(a.riskLevel) ||
  b.anomalyScore - a.anomalyScore ||
  b.physicsResidual - a.physicsResidual ||
  b.confidence - a.confidence ||
  b.depth - a.depth ||
  a.id.localeCompare(b.id);

const hasRequiredFields = (point: AnalyzedPoint) =>
  [
    point.id,
    point.x,
    point.y,
    point.lat,
    point.lon,
    point.coordinateMode,
    point.depth,
    point.resistivity,
    point.velocity,
    point.magnetic,
    point.noise,
    point.anomalyScore,
    point.riskScore,
    point.confidence,
    point.className,
    point.physicsResidual,
    point.residual,
    point.reason,
    point.explanation,
    point.riskLevel,
    point.action,
    point.recommendedAction,
  ].every((value) => value !== undefined && value !== null && value !== "");

export const validateAnalysisOutput = ({
  anomalies,
  summary,
  anomalyThreshold,
  csvText = "",
  reportText = "",
}: ValidationInput): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const belowThreshold = anomalies.filter((point) => point.anomalyScore < anomalyThreshold);
  const highRisk = anomalies.filter((point) => point.riskLevel === "HIGH");

  for (const point of belowThreshold) {
    if (point.riskLevel === "HIGH") {
      issues.push({
        code: "below_threshold_high_risk",
        message: `${point.id} is below threshold but has HIGH risk.`,
      });
    }
    if (point.action === escalationAction) {
      issues.push({
        code: "below_threshold_escalation",
        message: `${point.id} is below threshold but has escalation action.`,
      });
    }
  }

  const expectedMeanConfidence = average(highRisk.map((point) => point.confidence));
  if (summary.meanConfidence !== expectedMeanConfidence) {
    issues.push({
      code: "mean_confidence_mismatch",
      message: `Expected mean high-risk confidence ${expectedMeanConfidence}, got ${summary.meanConfidence}.`,
    });
  }

  const expectedMeanResidual = average(highRisk.map((point) => point.physicsResidual));
  if (summary.meanResidual !== expectedMeanResidual) {
    issues.push({
      code: "mean_residual_mismatch",
      message: `Expected mean high-risk residual ${expectedMeanResidual}, got ${summary.meanResidual}.`,
    });
  }

  const sortedIds = [...summary.priorityFindings].sort(comparePriority).map((point) => point.id);
  const actualIds = summary.priorityFindings.map((point) => point.id);
  if (sortedIds.join("|") !== actualIds.join("|")) {
    issues.push({
      code: "priority_order_mismatch",
      message: "Priority findings are not sorted by the deterministic ranking function.",
    });
  }

  for (const point of anomalies) {
    if (!hasRequiredFields(point)) {
      issues.push({
        code: "missing_required_fields",
        message: `${point.id || "Unknown anomaly"} is missing one or more required fields.`,
      });
    }
  }

  const requiredCsvLabels = [
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
  ];
  for (const label of requiredCsvLabels) {
    if (csvText && !csvText.includes(label)) {
      issues.push({
        code: "missing_csv_unit_label",
        message: `CSV output is missing ${label}.`,
      });
    }
  }

  const requiredReportLabels = ["ohm-m", "m/s", "nT", "noise index", "Heuristic residual definition"];
  for (const label of requiredReportLabels) {
    if (reportText && !reportText.includes(label)) {
      issues.push({
        code: "missing_report_unit_or_definition",
        message: `Report output is missing ${label}.`,
      });
    }
  }

  return issues;
};
