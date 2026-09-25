import { AlertTriangle, ClipboardCheck, FileText } from "lucide-react";
import type { ActiveSite, SiteScreeningResult } from "../../../types";
import { ProviderStatusBar } from "./ProviderStatusBar";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const terrainWave = (value: number) => Math.sin(value) * 0.58 + Math.cos(value * 0.47) * 0.42;

const terrainHeightAt = (x: number, y: number, activeSite: ActiveSite, screening: SiteScreeningResult) => {
  const seed = activeSite.latitude * 0.73 + activeSite.longitude * 0.41;
  const relief = clamp(16 + screening.terrainSlopeRisk * 0.72 + screening.dataQualityPenalty * 0.35, 18, 105);
  const wetnessCut = Math.exp(-Math.abs(y + Math.sin(x * 2.6 + seed) * 0.18) * 5.2);

  // The report map is deterministic from the same site/risk inputs as the live map, so print and UI stay aligned.
  return (
    110 +
    Math.abs(activeSite.latitude) * 3.8 +
    terrainWave(activeSite.longitude * 0.18) * 42 +
    relief *
      (x * Math.sin(seed * 0.3) * 0.38 +
        y * Math.cos(seed * 0.27) * 0.3 +
        Math.sin((x + y) * 4.4 + seed) * 0.12 -
        wetnessCut * (screening.drainageWaterloggingRisk / 100) * 0.22)
  );
};

const buildTerrainReportModel = (activeSite: ActiveSite, screening: SiteScreeningResult) => {
  const columns = 9;
  const rows = 7;
  const samples: number[][] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  // Sample a small virtual terrain grid so the report SVG stays fast, deterministic, and print-friendly.
  for (let row = 0; row <= rows; row += 1) {
    const line: number[] = [];
    for (let column = 0; column <= columns; column += 1) {
      const x = (column / columns) * 2 - 1;
      const y = (row / rows) * 2 - 1;
      const value = terrainHeightAt(x, y, activeSite, screening);
      line.push(value);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    samples.push(line);
  }

  // Contours are simplified polylines: enough shape for due diligence, light enough for report printing.
  const contourLines = [0.18, 0.34, 0.5, 0.66, 0.82].map((ratio, index) => {
    const yBase = 12 + ratio * 38;
    const points = Array.from({ length: 10 }, (_, pointIndex) => {
      const x = 8 + pointIndex * 9.25;
      const wave = Math.sin(pointIndex * 0.9 + activeSite.longitude * 0.08 + index) * (1.4 + index * 0.22);
      return `${x.toFixed(1)},${(yBase + wave).toFixed(1)}`;
    }).join(" ");
    return {
      id: `contour-${index}`,
      points,
      major: index === 2,
      elevation: Math.round(min + (max - min) * ratio),
    };
  });

  // Relief bands encode low-to-high elevation context behind the contour lines.
  const reliefBands = samples.slice(0, rows).map((line, row) => {
    const average = line.reduce((sum, value) => sum + value, 0) / line.length;
    const ratio = clamp((average - min) / Math.max(1, max - min), 0, 1);
    return {
      id: `band-${row}`,
      y: row * (62 / rows),
      height: 62 / rows + 0.4,
      fill: `rgba(${Math.round(32 + ratio * 166)}, ${Math.round(92 + ratio * 104)}, ${Math.round(80 + ratio * 68)}, 0.82)`,
    };
  });

  return {
    contourInterval: max - min > 70 ? 10 : 5,
    contourLines,
    max: Math.round(max),
    min: Math.round(min),
    reliefBands,
  };
};

const list = (items: string[]) => (
  <ul className="check-list">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

function TerrainReportMap({
  activeSite,
  screening,
}: {
  activeSite: ActiveSite;
  screening: SiteScreeningResult;
}) {
  // Keep the report map self-contained so print/export views do not depend on live Cesium rendering.
  const terrain = buildTerrainReportModel(activeSite, screening);
  const terrainLayer = screening.layerAssessments.terrainSlopeRisk;
  const elevationLayer = screening.layerAssessments.elevationRisk;

  return (
    <section className="report-terrain-map" aria-label="Report terrain map view">
      <div className="report-terrain-header">
        <div>
          <span>Terrain map view</span>
          <strong>{activeSite.radiusMeters} m topo context</strong>
        </div>
        <small>
          {terrain.min}-{terrain.max} m modelled relief | {terrain.contourInterval} m contours
        </small>
      </div>

      <svg viewBox="0 0 100 62" role="img" aria-label="Topographic map with terrain contours and site radius">
        <defs>
          <radialGradient id="terrainFocus" cx="50%" cy="50%" r="48%">
            <stop offset="0%" stopColor="rgba(159,255,234,0.34)" />
            <stop offset="64%" stopColor="rgba(159,255,234,0.08)" />
            <stop offset="100%" stopColor="rgba(2,7,10,0.16)" />
          </radialGradient>
        </defs>
        <rect width="100" height="62" rx="2.2" fill="#eaf3ed" />
        {terrain.reliefBands.map((band) => (
          <rect key={band.id} x="0" y={band.y} width="100" height={band.height} fill={band.fill} />
        ))}
        <path d="M0 0H100V62H0Z" fill="url(#terrainFocus)" />
        {terrain.contourLines.map((line) => (
          <polyline
            key={line.id}
            points={line.points}
            fill="none"
            stroke={line.major ? "#fff7d2" : "#d8ffea"}
            strokeLinecap="round"
            strokeWidth={line.major ? 0.78 : 0.42}
            opacity={line.major ? 0.9 : 0.66}
          />
        ))}
        <circle cx="50" cy="31" r="17" fill="rgba(55,217,194,0.13)" stroke="#123c38" strokeWidth="0.6" />
        <circle cx="50" cy="31" r="1.6" fill="#07352f" stroke="#9fffea" strokeWidth="0.7" />
        <path d="M87 10l3-6 3 6-3-1.8z" fill="#07352f" />
        <text x="90" y="17" textAnchor="middle" className="terrain-map-north">
          N
        </text>
      </svg>

      <div className="report-terrain-legend">
        <span>Terrain: {terrainLayer?.value ?? "N/A"}/100</span>
        <span>Elevation: {elevationLayer?.value ?? "N/A"}/100</span>
        <span>Confidence: {Math.min(terrainLayer?.confidence ?? 0, elevationLayer?.confidence ?? 0)}%</span>
      </div>
      <p>
        Terrain map is provider-aware screening output. It should be replaced or validated with a live DEM,
        drone/topographic survey, or licensed contour dataset before engineering reliance.
      </p>
    </section>
  );
}

export function ReportPreviewPanel({
  activeSite,
  screening,
}: {
  activeSite: ActiveSite;
  screening: SiteScreeningResult;
}) {
  return (
    <>
      <div className="report-metrics">
        <div className="fact">
          <span>Overall weighted risk</span>
          <strong>{screening.overallRiskScore}/100</strong>
        </div>
        <div className="fact">
          <span>Construction risk</span>
          <strong>{screening.constructionRiskScore}/100</strong>
        </div>
        <div className="fact">
          <span>Land purchase risk</span>
          <strong>{screening.landPurchaseRiskScore}/100</strong>
        </div>
        <div className="fact">
          <span>Development risk</span>
          <strong>{screening.developmentProfitRiskIndicator}/100</strong>
        </div>
        <div className="fact">
          <span>Data confidence</span>
          <strong>{screening.dataConfidence}%</strong>
        </div>
        <div className="fact">
          <span>Audience</span>
          <strong>{activeSite.reportAudience}</strong>
        </div>
      </div>

      <ProviderStatusBar screening={screening} />

      <TerrainReportMap activeSite={activeSite} screening={screening} />

      {screening.dataQualityLabel === "Demo-quality estimate only" && (
        <div className="scan-warning prominent">
          <AlertTriangle size={16} aria-hidden="true" />
          All critical data layers are fallback. The report is a demo-quality screening estimate only.
        </div>
      )}

      <div className="proposal-box">
        <strong>Executive summary</strong>
        <p>{screening.aiAnalysis.executiveSummary}</p>
      </div>

      <div className="proposal-box">
        <strong>Accuracy and provenance guardrail</strong>
        <p>
          Current confidence is {screening.dataConfidence}% with {screening.fallbackLayerCount} fallback layer(s).
          Treat model-assisted or fallback terrain as screening context until verified by official DEM/topographic
          survey, field geotechnical investigation, and qualified professional review.
        </p>
      </div>

      <div className="three-column report-mini-grid">
        <article className="proposal-box">
          <strong>What we know</strong>
          {list([
            `Coordinates parsed to ${activeSite.latitude.toFixed(6)}, ${activeSite.longitude.toFixed(6)}.`,
            `The active site radius is ${activeSite.radiusMeters} m.`,
            `The intended use is ${activeSite.intendedUse} with ${activeSite.floors || "unspecified"} floors.`,
          ])}
        </article>
        <article className="proposal-box">
          <strong>What is uncertain</strong>
          {list(screening.limitations.slice(0, 4))}
        </article>
        <article className="proposal-box">
          <strong>Professional investigation</strong>
          {list(screening.recommendedNextSteps)}
        </article>
      </div>

      <div className="findings-list">
        {Object.values(screening.layerAssessments).map((assessment) => (
          <article key={assessment.id}>
            <span
              className={`finding-score ${
                (assessment.value ?? 0) >= 68 ? "high" : (assessment.value ?? 0) >= 42 ? "medium" : "low"
              }`}
            >
              {assessment.value ?? "N/A"}
            </span>
            <div>
              <strong>{assessment.label}</strong>
              <p>{assessment.explanation}</p>
              <small>
                {assessment.provider} | {assessment.source} | {assessment.confidence}% confidence |{" "}
                {assessment.limitation}
              </small>
            </div>
          </article>
        ))}
      </div>

      <div className="three-column report-mini-grid">
        <article className="proposal-box">
          <strong>Land purchaser review</strong>
          {list(screening.clientReviews.purchaser)}
        </article>
        <article className="proposal-box">
          <strong>Builder review</strong>
          {list(screening.clientReviews.builder)}
        </article>
        <article className="proposal-box">
          <strong>Engineer review</strong>
          {list(screening.clientReviews.engineer)}
        </article>
      </div>

      <div className="proposal-box">
        <strong>
          <ClipboardCheck size={16} aria-hidden="true" /> Construction suitability
        </strong>
        <div className="site-facts">
          <div className="fact">
            <span>Potentially feasible subject to investigation</span>
            <strong>{screening.constructionSuitability.potentiallySuitableUses.join(", ") || "None flagged"}</strong>
          </div>
          <div className="fact">
            <span>Caution uses</span>
            <strong>{screening.constructionSuitability.cautionUses.join(", ") || "None flagged"}</strong>
          </div>
          <div className="fact">
            <span>Detailed investigation first</span>
            <strong>
              {screening.constructionSuitability.notRecommendedWithoutDetailedInvestigation.join(", ") ||
                "None flagged"}
            </strong>
          </div>
        </div>
        <p>{screening.constructionSuitability.explanation}</p>
      </div>

      <div className="proposal-box">
        <strong>
          <FileText size={16} aria-hidden="true" /> Historical imagery/change detection placeholder
        </strong>
        <p>{screening.historicalImagery.limitation}</p>
        <div className="globe-project-meta">
          {screening.historicalImagery.plannedSignals.map((signal) => (
            <span key={signal}>{signal.replaceAll("_", " ")}</span>
          ))}
        </div>
      </div>
    </>
  );
}
