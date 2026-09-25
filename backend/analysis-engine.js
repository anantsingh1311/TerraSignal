import { normalizeStationPosition } from "./geospatial.js";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const average = (values) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

const deviation = (values) => {
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) || 1;
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const defaultSettings = {
  noiseSuppression: 72,
  physicsWeight: 68,
  anomalyThreshold: 70,
  focus: "HYBRID",
};

export const normalizeSettings = (settings = {}) => ({
  noiseSuppression: clamp(Number(settings.noiseSuppression ?? defaultSettings.noiseSuppression), 0, 100),
  physicsWeight: clamp(Number(settings.physicsWeight ?? defaultSettings.physicsWeight), 0, 100),
  anomalyThreshold: clamp(Number(settings.anomalyThreshold ?? defaultSettings.anomalyThreshold), 0, 100),
  focus: ["HYBRID", "ERT", "SRT", "MASW", "MAG"].includes(settings.focus)
    ? settings.focus
    : "HYBRID",
});

const methodLift = (settings, className) => {
  if (settings.focus === "HYBRID") return 1;
  if (settings.focus === "ERT" && className === "Water or clay-rich zone") return 1.16;
  if (settings.focus === "SRT" && className === "Weathered or low-stiffness zone") return 1.15;
  if (settings.focus === "MASW" && className === "Bedrock interface") return 1.12;
  if (settings.focus === "MAG" && className === "Buried utility or magnetic body") return 1.18;
  return 0.94;
};

const classifyPoint = (point, resistivityMedian, velocityMean, magneticMean) => {
  const lowResistivity = point.resistivity < resistivityMedian * 0.58;
  const lowVelocity = point.velocity < velocityMean * 0.72;
  const highMagnetic = Math.abs(point.magnetic - magneticMean) > 250;
  const highVelocity = point.velocity > velocityMean * 1.18;

  if (lowResistivity && lowVelocity) return "Mixed subsurface contrast";
  if (lowResistivity) return "Water or clay-rich zone";
  if (lowVelocity) return "Weathered or low-stiffness zone";
  if (highMagnetic) return "Buried utility or magnetic body";
  if (highVelocity) return "Bedrock interface";
  return "Mixed subsurface contrast";
};

export const classifyRiskLevel = (score, threshold) => {
  if (score >= threshold) return "HIGH";
  if (score >= threshold - 10) return "MEDIUM";
  return "LOW";
};

export const actionForRisk = (riskLevel) => {
  if (riskLevel === "HIGH") {
    return "Escalate to geotechnical reviewer before bid freeze.";
  }
  if (riskLevel === "MEDIUM") {
    return "Review as secondary anomaly; confirm only if it overlaps with planned foundation loads, utilities, groundwater assumptions, or borehole locations.";
  }
  return "Keep in monitoring set; no immediate escalation recommended.";
};

const riskRank = (riskLevel) => ({ HIGH: 3, MEDIUM: 2, LOW: 1 })[riskLevel] ?? 0;

export const comparePriority = (a, b) =>
  riskRank(b.riskLevel) - riskRank(a.riskLevel) ||
  b.anomalyScore - a.anomalyScore ||
  b.physicsResidual - a.physicsResidual ||
  b.confidence - a.confidence ||
  b.depth - a.depth ||
  a.id.localeCompare(b.id);

export const rankAnalyzedPoints = (points) => [...points].sort(comparePriority);

const anomalyScoreFromRaw = (rawScore) => {
  const scaled = 30 + rawScore * 0.62;
  const softCapped = scaled <= 94 ? scaled : 94 + Math.log1p(scaled - 94) * 1.8;
  return clamp(Math.round(softCapped), 10, 99);
};

const clusterAction = (riskLevel) =>
  riskLevel === "HIGH"
    ? "Review this anomaly group with a licensed geotechnical/geophysical reviewer before bid freeze."
    : "Review as a secondary anomaly group where it overlaps with foundation loads, utilities, groundwater assumptions, or borehole locations.";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const buildAnomalyClusters = (points) => {
  const candidates = rankAnalyzedPoints(points).filter((point) => point.riskLevel !== "LOW");
  const groups = [];

  for (const point of candidates) {
    const existing = groups.find(
      (group) =>
        group[0]?.className === point.className &&
        group.some((member) => distance(member, point) <= 28),
    );
    if (existing) {
      existing.push(point);
    } else {
      groups.push([point]);
    }
  }

  return groups.map((group, index) => {
    const riskLevel = group.some((point) => point.riskLevel === "HIGH") ? "HIGH" : "MEDIUM";
    const className = group[0].className;
    const id = `Cluster ${String.fromCharCode(65 + index)}`;
    return {
      id,
      label: `${id}: ${className} zone`,
      className,
      riskLevel,
      count: group.length,
      averageAnomalyScore: Math.round(average(group.map((point) => point.anomalyScore))),
      averageConfidence: Math.round(average(group.map((point) => point.confidence))),
      averagePhysicsResidual: Math.round(average(group.map((point) => point.physicsResidual))),
      recommendedAction: clusterAction(riskLevel),
    };
  });
};

const buildReason = ({
  className,
  resistivityContrast,
  velocityContrast,
  magneticContrast,
  depthSignal,
  noisePenalty,
}) => {
  const drivers = [
    resistivityContrast > 0.55 ? "resistivity contrast" : null,
    velocityContrast > 1.1 ? "seismic velocity contrast" : null,
    magneticContrast > 1.15 ? "magnetic intensity contrast" : null,
    depthSignal > 0.55 ? "deeper target depth" : null,
    noisePenalty > 8 ? "remaining field noise" : null,
  ].filter(Boolean);

  return `${className}; score driven by ${drivers.length ? drivers.join(", ") : "moderate combined signal contrast"}.`;
};

const normalizePoint = (point, index = 0) => ({
  id: String(point.id || point.stationId || `U-${index + 1}`),
  x: Number(point.x ?? index * 10 + 8),
  y: Number(point.y ?? 20 + index * 4),
  lat: point.lat === undefined || point.lat === null ? undefined : Number(point.lat),
  lon: point.lon === undefined || point.lon === null ? undefined : Number(point.lon),
  coordinateMode: point.coordinateMode === "lat_lon" ? "lat_lon" : "local_xy",
  depth: Number(point.depth ?? 6 + index * 3),
  resistivity: Number(point.resistivity ?? 80),
  velocity: Number(point.velocity ?? 1600),
  magnetic: Number(point.magnetic ?? 48000),
  noise: clamp(Number(point.noise ?? 25), 0, 100),
  source: point.source === "sample" ? "sample" : "upload",
});

export const normalizePoints = (points = []) =>
  points
    .map((point, index) => normalizePoint(point, index))
    .filter((point) => point.resistivity > 0 && point.velocity > 0 && point.magnetic > 0);

// Backend scoring mirrors the frontend heuristic today. This is deterministic
// decision-support logic, not a trained model or certified interpretation.
export const analyzeSurvey = (inputPoints, rawSettings, project) => {
  const points = normalizePoints(inputPoints);
  const settings = normalizeSettings(rawSettings);
  const resistivities = points.map((point) => point.resistivity);
  const velocities = points.map((point) => point.velocity);
  const magnetics = points.map((point) => point.magnetic);
  const resistivityMedian = median(resistivities);
  const velocityMean = average(velocities);
  const velocitySpread = deviation(velocities);
  const magneticMean = average(magnetics);
  const magneticSpread = deviation(magnetics);
  const projectComplexity = (project.constraints?.length ?? 0) * 1.75 + (project.methods?.length ?? 0) * 1.1;

  return points
    .map((point) => {
      const className = classifyPoint(point, resistivityMedian, velocityMean, magneticMean);
      const resistivityContrast = Math.abs(Math.log(point.resistivity / resistivityMedian));
      const velocityContrast = Math.abs(point.velocity - velocityMean) / velocitySpread;
      const magneticContrast = Math.abs(point.magnetic - magneticMean) / magneticSpread;
      const depthSignal = clamp(point.depth / 30, 0, 1);
      const noisePenalty = point.noise * (1 - settings.noiseSuppression / 100);
      const physicsGain = 1 + settings.physicsWeight / 240;
      const focusedLift = methodLift(settings, className);
      const rawScore =
        (resistivityContrast * 27 +
          velocityContrast * 18 +
          magneticContrast * 12 +
          depthSignal * 8 +
          projectComplexity) *
          physicsGain *
          focusedLift -
        noisePenalty * 0.2;
      const anomalyScore = anomalyScoreFromRaw(rawScore);
      const physicsResidual = clamp(
        Math.round(28 - settings.physicsWeight * 0.18 + noisePenalty * 0.12 + velocityContrast * 2),
        2,
        34,
      );
      const confidence = clamp(
        Math.round(
          54 +
            anomalyScore * 0.22 +
            settings.noiseSuppression * 0.1 +
            settings.physicsWeight * 0.08 -
            physicsResidual * 1.15 -
            point.noise * 0.08 +
            depthSignal * 3,
        ),
        42,
        96,
      );
      const riskLevel = classifyRiskLevel(anomalyScore, settings.anomalyThreshold);

      const positionedPoint = normalizeStationPosition(point, project);
      const reason = buildReason({
        className,
        resistivityContrast,
        velocityContrast,
        magneticContrast,
        depthSignal,
        noisePenalty,
      });
      const action = actionForRisk(riskLevel);

      return {
        ...positionedPoint,
        anomalyScore,
        riskScore: anomalyScore,
        confidence,
        className,
        riskLevel,
        action,
        recommendedAction: action,
        physicsResidual,
        residual: physicsResidual,
        signalLift: clamp(Math.round((settings.noiseSuppression * 0.32 + settings.physicsWeight * 0.22) / 2), 12, 42),
        reason,
        explanation: reason,
      };
    })
    .sort(comparePriority);
};

export const summarizeAnalysis = (points, threshold) => {
  const withRisk = points.map((point) => {
    const riskLevel = classifyRiskLevel(point.anomalyScore, threshold);
    return {
      ...point,
      riskLevel,
      action: actionForRisk(riskLevel),
    };
  });
  const priorityFindings = rankAnalyzedPoints(withRisk);
  const flagged = priorityFindings.filter((point) => point.riskLevel === "HIGH");
  const summaryBasis = flagged;
  // TODO: Replace this null planning estimate when baseline borehole plan data is modeled.
  const planningImpactEstimate = null;

  return {
    flagged,
    priorityFindings,
    clusters: buildAnomalyClusters(priorityFindings),
    top: priorityFindings[0] ?? null,
    meanConfidence: Math.round(average(summaryBasis.map((point) => point.confidence))),
    meanResidual: Math.round(average(summaryBasis.map((point) => point.physicsResidual))),
    highRisk: flagged.length,
    boreholesSaved: planningImpactEstimate,
    planningImpactSupported: false,
  };
};

const orderedFields = ["id", "x", "y", "depth", "resistivity", "velocity", "magnetic", "noise"];
const latLonOrderedFields = ["id", "lat", "lon", "depth", "resistivity", "velocity", "magnetic", "noise"];
const measurementFields = ["depth", "resistivity", "velocity", "magnetic", "noise"];
const allHeaderFields = ["id", "x", "y", "lat", "lon", ...measurementFields];

const headerAliases = {
  id: ["id", "station", "station_id", "point", "point_id"],
  x: ["x", "x_m", "east", "easting", "chain", "chainage"],
  y: ["y", "y_m", "north", "northing", "line"],
  lat: ["lat", "latitude", "y_lat", "station_latitude"],
  lon: ["lon", "lng", "long", "longitude", "x_lon", "station_longitude"],
  depth: ["depth", "depth_m", "z", "z_m"],
  resistivity: ["resistivity", "resistivity_ohm_m", "rho", "ohm", "ohm_m"],
  velocity: ["velocity", "velocity_m_s", "vel", "vs", "vp"],
  magnetic: ["magnetic", "magnetic_nt", "mag", "mag_nt", "nt"],
  noise: ["noise", "noise_index", "snr"],
};

const normalizeHeader = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

const detectDelimiter = (row) => {
  if (row.includes("\t")) return "tab";
  if (row.includes(",")) return "comma";
  if (row.includes(";")) return "semicolon";
  return "whitespace";
};

const splitSurveyRow = (row, delimiter) => {
  if (delimiter === "tab") return row.split("\t").map((cell) => cell.trim());
  if (delimiter === "comma") return row.split(",").map((cell) => cell.trim());
  if (delimiter === "semicolon") return row.split(";").map((cell) => cell.trim());
  return row.trim().split(/\s+/).map((cell) => cell.trim());
};

const resolveHeaderIndexes = (headers) => {
  const normalized = headers.map(normalizeHeader);
  const indexes = new Map();
  for (const field of allHeaderFields) {
    const aliases = headerAliases[field];
    const index = normalized.findIndex((header) =>
      aliases.some((alias) => header === normalizeHeader(alias) || header.includes(normalizeHeader(alias))),
    );
    if (index !== -1) indexes.set(field, index);
  }
  return indexes;
};

const looksLikeHeader = (cells) => resolveHeaderIndexes(cells).size >= 3;

const detectCoordinateMode = (indexes) => {
  if (indexes.has("lat") && indexes.has("lon")) return "lat_lon";
  if (indexes.has("x") && indexes.has("y")) return "local_xy";
  return null;
};

const numericValue = (value, field, row) => {
  if (!String(value).trim()) {
    return {
      value: null,
      warning: { row, field, message: `${field} is required.` },
    };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return {
      value: null,
      warning: { row, field, message: `${field} must be a valid number.` },
    };
  }

  if (["depth", "resistivity", "velocity", "magnetic"].includes(field) && parsed <= 0) {
    return {
      value: null,
      warning: { row, field, message: `${field} must be greater than zero.` },
    };
  }

  if (field === "lat" && (parsed < -90 || parsed > 90)) {
    return {
      value: null,
      warning: { row, field, message: "lat must be between -90 and 90 degrees." },
    };
  }

  if (field === "lon" && (parsed < -180 || parsed > 180)) {
    return {
      value: null,
      warning: { row, field, message: "lon must be between -180 and 180 degrees." },
    };
  }

  if (field === "noise" && (parsed < 0 || parsed > 100)) {
    return {
      value: clamp(parsed, 0, 100),
      warning: { row, field, message: "noise was clamped to the 0-100 range." },
    };
  }

  return { value: parsed, warning: null };
};

export const parseSurveyFile = (text) => {
  const rows = String(text ?? "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  const warnings = [];

  if (!rows.length) {
    return {
      points: [],
      warnings: [{ row: 0, message: "The file is empty." }],
      delimiter: "comma",
      coordinateMode: null,
    };
  }

  const delimiter = detectDelimiter(rows[0]);
  const firstCells = splitSurveyRow(rows[0], delimiter);
  const hasHeader = looksLikeHeader(firstCells);
  const headerIndexes = hasHeader
    ? resolveHeaderIndexes(firstCells)
    : new Map(orderedFields.map((field, index) => [field, index]));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const coordinateMode = detectCoordinateMode(headerIndexes);
  const requiredFields =
    coordinateMode === "lat_lon"
      ? latLonOrderedFields
      : coordinateMode === "local_xy"
        ? orderedFields
        : ["id", ...measurementFields];

  if (!coordinateMode) {
    warnings.push({
      row: 1,
      message: "Missing coordinate columns. Provide either x/y local meter offsets or lat/lon geographic coordinates.",
    });
  }

  for (const field of requiredFields) {
    if (!headerIndexes.has(field)) {
      warnings.push({ row: 1, field, message: `Missing ${field} column.` });
    }
  }

  const points = dataRows.flatMap((row, index) => {
    const rowNumber = hasHeader ? index + 2 : index + 1;
    const cells = splitSurveyRow(row, delimiter);
    const idIndex = headerIndexes.get("id") ?? 0;
    const id = String(cells[idIndex] ?? "").trim();

    if (!id) {
      warnings.push({ row: rowNumber, field: "id", message: "Missing station id; row skipped." });
      return [];
    }

    const numericEntries = new Map();
    let rowIsValid = Boolean(coordinateMode);

    const coordinateFields =
      coordinateMode === "lat_lon" ? ["lat", "lon"] : coordinateMode === "local_xy" ? ["x", "y"] : [];

    for (const field of [...coordinateFields, ...measurementFields]) {
      const cellIndex = headerIndexes.get(field);
      const rawValue = cellIndex === undefined ? "" : cells[cellIndex] ?? "";
      const parsed = numericValue(rawValue, field, rowNumber);
      if (parsed.warning) warnings.push(parsed.warning);
      if (parsed.value === null) rowIsValid = false;
      else numericEntries.set(field, parsed.value);
    }

    if (!rowIsValid) {
      warnings.push({ row: rowNumber, message: "Row skipped because one or more required values are invalid." });
      return [];
    }

    return [
      {
        id,
        x: numericEntries.get("x") ?? 0,
        y: numericEntries.get("y") ?? 0,
        lat: numericEntries.get("lat"),
        lon: numericEntries.get("lon"),
        coordinateMode: coordinateMode ?? "local_xy",
        depth: numericEntries.get("depth") ?? 0,
        resistivity: numericEntries.get("resistivity") ?? 0,
        velocity: numericEntries.get("velocity") ?? 0,
        magnetic: numericEntries.get("magnetic") ?? 0,
        noise: numericEntries.get("noise") ?? 0,
        source: "upload",
      },
    ];
  });

  if (!points.length && !warnings.length) {
    warnings.push({ row: 0, message: "No usable survey rows were found." });
  }

  return { points, warnings, delimiter, coordinateMode };
};

export const parseSurveyCsv = (text) => parseSurveyFile(text).points;

export const buildReport = (project, analyzed, rawSettings) => {
  const settings = normalizeSettings(rawSettings);
  const summary = summarizeAnalysis(analyzed, settings.anomalyThreshold);
  const reportFindings = summary.priorityFindings.filter((point) => point.riskLevel !== "LOW");
  const topFindings = reportFindings
    .slice(0, 5)
    .map(
      (point, index) =>
        `${index + 1}. ${point.id}: ${point.className}, risk ${point.riskLevel}, anomaly score ${point.anomalyScore}, confidence ${point.confidence}%, heuristic residual ${point.physicsResidual}%, depth ${point.depth} m, resistivity ${point.resistivity} ohm-m, velocity ${point.velocity} m/s, magnetic ${point.magnetic} nT, noise index ${point.noise}. Reason: ${point.reason} ${point.action}`,
    )
    .join("\n");
  const clusterFindings = summary.clusters
    .map(
      (cluster) =>
        `${cluster.label}: ${cluster.count} anomaly/anomalies, average score ${cluster.averageAnomalyScore}, average confidence ${cluster.averageConfidence}%, average physics residual ${cluster.averagePhysicsResidual}%. ${cluster.recommendedAction}`,
    )
    .join("\n");
  const planningImpact = summary.planningImpactSupported
    ? `Planning impact estimate: ${summary.boreholesSaved} blind boring(s) may be repositioned or avoided, pending baseline borehole plan and licensed reviewer confirmation.`
    : "Planning impact estimate unavailable because no baseline borehole plan was provided.";

  return `TerraSignal AI-assisted survey screening report

Project: ${project.name}
Client: ${project.client}
Location: ${project.location} (${project.coordinates})
Stage: ${project.stage}
Target: ${project.target}

Interpretation setup
Noise suppression: ${settings.noiseSuppression}%
Physics weight: ${settings.physicsWeight}%
Anomaly threshold: ${settings.anomalyThreshold}
Mode: ${settings.focus}
Scoring method: Transparent heuristic risk scoring

Executive summary
Flagged anomalies: ${summary.flagged.length}
High-risk anomalies: ${summary.highRisk}
Mean confidence of high-risk anomalies: ${summary.meanConfidence}%
Mean heuristic residual of high-risk anomalies: ${summary.meanResidual}%
${planningImpact}

Heuristic residual definition
The residual is a transparent quality signal from this demo scoring workflow. Lower values indicate stronger agreement between the combined resistivity, velocity, magnetic, depth, noise, and project-context checks.
Residual bands: 0-8% strong agreement; 9-15% acceptable agreement; 16-25% review required; >25% low-confidence interpretation.

Priority findings
${topFindings || "No anomaly exceeds the configured threshold."}

Cluster-level interpretation
${clusterFindings || "No high- or medium-risk anomaly group was identified."}

Client review: builder
1. Use this screening to position or add boreholes, CPT/SPT lines, and utility checks before bid freeze; do not select structure type, excavation method, or foundation budget from AI output alone.
2. Confirm whether the intended structure can be sustained by checking bearing capacity, settlement risk, groundwater/water table, bedrock depth, drainage, utility conflicts, and access constraints.
3. Low-rise/light work may be feasible on shallow foundations only after soil tests confirm capacity; heavy, high-rise, basement, bridge, industrial, or settlement-sensitive work needs deeper geotechnical review and may require piles, ground improvement, or redesign.

Client review: engineer
1. Required analyses include subsurface profiling, boreholes, CPT/SPT, rock coring where relevant, laboratory testing for density, moisture, grain size, and shear strength, plus settlement, liquefaction, seismic/geohazard, slope, and groundwater/dewatering review.
2. Required maps include topographic/contour, geotechnical/geological strata, cadastral/boundary, floodplain/hydrological, and utility/access maps.
3. Treat anomaly classes as field-investigation triggers only; final bearing capacity, soil class, foundation type, and structural feasibility require qualified professional interpretation.

Client review: land purchaser
1. Ask for geotechnical reports, borehole logs, SPT/CPT results, groundwater records, soil lab tests, topographic survey, drainage/flood history, utility records, title chain, zoning/land-use permissions, and sanctioned plans before purchase.
2. Check public information from local planning/zoning offices, assessor or land registry/cadastral records, official floodplain/hydrology maps, national geological/topographic datasets, and satellite/terrain viewers.
3. Do not assume the land can support the desired building until professional investigation confirms soil capacity, settlement, groundwater, seismic/geohazard, access, zoning, and legal status.

Recommended next actions
1. Confirm the highest-ranked anomaly group with a targeted borehole or cross-line survey.
2. Compare anomaly zones with utility mark-out, civil grading, and groundwater assumptions.
3. Treat this as preliminary decision-support output only; send final interpretation to a licensed geotechnical/geophysical reviewer before construction decisions.

Limitations and disclaimer
This tool provides preliminary screening and decision-support only. Results should be reviewed by qualified geotechnical or geophysical professionals before being used for engineering, construction, safety, or financial decisions.
`;
};

export const exportAnalyzedCsv = (points) => {
  const rows = [
    "id,coordinate_mode,x_m,y_m,lat,lon,depth_m,resistivity_ohm_m,velocity_m_s,magnetic_nT,noise_index,anomaly_score,risk_score,risk_level,confidence_pct,class_name,heuristic_residual_pct,reason,action",
    ...rankAnalyzedPoints(points).map((point) =>
      [
        point.id,
        point.coordinateMode,
        point.x,
        point.y,
        point.lat,
        point.lon,
        point.depth,
        point.resistivity,
        point.velocity,
        point.magnetic,
        point.noise,
        point.anomalyScore,
        point.riskScore,
        point.riskLevel ?? "LOW",
        point.confidence,
        point.className,
        point.physicsResidual,
        `"${String(point.reason).replaceAll('"', '""')}"`,
        `"${String(point.action).replaceAll('"', '""')}"`,
      ].join(","),
    ),
  ];
  return rows.join("\n");
};
