import { AlertTriangle, ClipboardCheck, Gauge, Radar } from "lucide-react";
import type { ActiveSite, SiteScreeningResult } from "../../../types";
import { ProviderStatusBar } from "./ProviderStatusBar";

const scoreTone = (value: number) => (value >= 68 ? "high" : value >= 42 ? "medium" : "low");

const scoreRows = (screening: SiteScreeningResult) => [
  ["Construction risk", screening.constructionRiskScore],
  ["Land purchase risk", screening.landPurchaseRiskScore],
  ["Development risk", screening.developmentProfitRiskIndicator],
  ["Data quality penalty", screening.dataQualityPenalty],
] as const;

export function RiskIntelligencePanel({
  activeSite,
  screening,
}: {
  activeSite: ActiveSite | null;
  screening: SiteScreeningResult | null;
}) {
  return (
    <aside className="station-detail-panel site-screening-panel risk-intelligence-panel" aria-live="polite">
      {screening && activeSite ? (
        <>
          <span
            className={`station-risk-pill ${
              ["High", "Critical"].includes(screening.buildabilityCautionLevel)
                ? "high"
                : screening.buildabilityCautionLevel === "Moderate"
                  ? "medium"
                  : "low"
            }`}
          >
            {screening.buildabilityCautionLevel} caution
          </span>
          <h3>{activeSite.projectName}</h3>
          <p>
            {activeSite.latitude.toFixed(6)}, {activeSite.longitude.toFixed(6)} | {activeSite.radiusMeters} m radius
          </p>
          <div className="site-score score-cluster">
            <div>
              <strong>{screening.overallRiskScore}</strong>
              <span>Overall weighted risk</span>
            </div>
            <div>
              <strong>{screening.dataConfidence}%</strong>
              <span>Data confidence</span>
            </div>
          </div>
          <ProviderStatusBar screening={screening} />
          {screening.criticalFallbackCount > 2 && (
            <div className="scan-warning prominent">
              <AlertTriangle size={16} aria-hidden="true" />
              More than two critical layers are fallback. Treat this report as screening guidance only.
            </div>
          )}
          <dl>
            {scoreRows(screening).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <span className={`mini-score ${scoreTone(value)}`}>{value}/100</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="layer-assessment-list">
            {Object.values(screening.layerAssessments).map((assessment) => (
              <article key={assessment.id}>
                <div>
                  <span className={`mini-score ${scoreTone(assessment.value ?? 0)}`}>
                    {assessment.value === null ? "No data" : assessment.value}
                  </span>
                  <b>{assessment.label}</b>
                </div>
                <p>{assessment.explanation}</p>
                <small>
                  {assessment.source} | {assessment.confidence}% confidence | {assessment.limitation}
                </small>
              </article>
            ))}
          </div>
          <strong>Recommended next action</strong>
          <p>{screening.recommendedNextSteps[0]}</p>
          <strong>AI narrative guardrail</strong>
          <p>{screening.aiAnalysis.executiveSummary}</p>
          <strong>Client reviews</strong>
          <div className="client-review-list">
            <article>
              <b>Purchaser</b>
              <p>{screening.clientReviews.purchaser[0]}</p>
            </article>
            <article>
              <b>Builder</b>
              <p>{screening.clientReviews.builder[0]}</p>
            </article>
            <article>
              <b>Engineer</b>
              <p>{screening.clientReviews.engineer[0]}</p>
            </article>
          </div>
        </>
      ) : (
        <>
          <span className="station-risk-pill low">Ready</span>
          <h3>Site intelligence</h3>
          <p>Paste coordinates and run the flyover. Risk layers will show provider status, confidence, and limitations.</p>
          <ProviderStatusBar screening={null} />
          <div className="empty-intelligence-grid">
            <div>
              <Gauge size={17} aria-hidden="true" />
              <span>Transparent scoring</span>
            </div>
            <div>
              <Radar size={17} aria-hidden="true" />
              <span>500 m site radius</span>
            </div>
            <div>
              <ClipboardCheck size={17} aria-hidden="true" />
              <span>Purchaser, builder, engineer review</span>
            </div>
          </div>
          <div className="disclaimer-box compact">
            This tool provides preliminary screening and decision-support only. It does not replace professional
            geotechnical investigation, boreholes, SPT/CPT, soil testing, legal diligence, or qualified review.
          </div>
        </>
      )}
    </aside>
  );
}
