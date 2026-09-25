import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Layers, MapPin } from "lucide-react";
import { demoCapture } from "./demoCapture";

// The demo runs the same ranking arithmetic the product uses, over captured
// live-provider output. There is no separate demo scoring path: change the
// asset class and the weights, contributions and ordering recompute exactly as
// they do in the portfolio workspace.

type ProfileId = "office" | "residential" | "retail" | "warehouse" | "industrial" | "balanced";

const profiles: Record<ProfileId, { label: string; rationale: string; weights: Record<string, number> }> = {
  office: {
    label: "Office / IT park",
    rationale: "Access and infrastructure carry the most weight: commuting time and utility density drive occupier demand.",
    weights: {
      slopeTerrainRisk: 0.12,
      elevationVariabilityRisk: 0.08,
      drainageWaterProximityRisk: 0.14,
      floodContextIndicator: 0.14,
      infrastructureAccessIndicator: 0.28,
      landUseContextIndicator: 0.14,
      dataAvailabilityConfidence: 0.1,
    },
  },
  residential: {
    label: "Residential",
    rationale: "Drainage and flood context carry the most weight: water ingress dominates liveability and warranty exposure.",
    weights: {
      slopeTerrainRisk: 0.18,
      elevationVariabilityRisk: 0.1,
      drainageWaterProximityRisk: 0.22,
      floodContextIndicator: 0.16,
      infrastructureAccessIndicator: 0.14,
      landUseContextIndicator: 0.1,
      dataAvailabilityConfidence: 0.1,
    },
  },
  retail: {
    label: "Retail / mall",
    rationale: "Access and surrounding land-use mix carry the most weight: catchment reachability drives footfall potential.",
    weights: {
      slopeTerrainRisk: 0.08,
      elevationVariabilityRisk: 0.06,
      drainageWaterProximityRisk: 0.12,
      floodContextIndicator: 0.14,
      infrastructureAccessIndicator: 0.3,
      landUseContextIndicator: 0.2,
      dataAvailabilityConfidence: 0.1,
    },
  },
  warehouse: {
    label: "Warehouse / logistics",
    rationale: "Flat terrain and heavy-vehicle road access carry the most weight for large-floorplate sheds.",
    weights: {
      slopeTerrainRisk: 0.24,
      elevationVariabilityRisk: 0.16,
      drainageWaterProximityRisk: 0.12,
      floodContextIndicator: 0.12,
      infrastructureAccessIndicator: 0.24,
      landUseContextIndicator: 0.04,
      dataAvailabilityConfidence: 0.08,
    },
  },
  industrial: {
    label: "Industrial",
    rationale: "Terrain, flood exposure and land-use compatibility govern plant layout and environmental consenting.",
    weights: {
      slopeTerrainRisk: 0.2,
      elevationVariabilityRisk: 0.12,
      drainageWaterProximityRisk: 0.16,
      floodContextIndicator: 0.16,
      infrastructureAccessIndicator: 0.18,
      landUseContextIndicator: 0.1,
      dataAvailabilityConfidence: 0.08,
    },
  },
  balanced: {
    label: "Balanced",
    rationale: "Equalised weighting for early screening before the asset class is fixed.",
    weights: {
      slopeTerrainRisk: 0.15,
      elevationVariabilityRisk: 0.12,
      drainageWaterProximityRisk: 0.16,
      floodContextIndicator: 0.14,
      infrastructureAccessIndicator: 0.18,
      landUseContextIndicator: 0.13,
      dataAvailabilityConfidence: 0.12,
    },
  },
};

const factorLabels: Record<string, string> = {
  slopeTerrainRisk: "Terrain and slope",
  elevationVariabilityRisk: "Elevation variability",
  drainageWaterProximityRisk: "Drainage and water proximity",
  floodContextIndicator: "Flood context",
  infrastructureAccessIndicator: "Access and infrastructure",
  landUseContextIndicator: "Surrounding land use",
  dataAvailabilityConfidence: "Evidence quality",
};

const factorOrder = Object.keys(factorLabels);

const riskTone = (score: number | null) => {
  if (score === null) return "unknown";
  if (score >= 68) return "weak";
  if (score >= 45) return "fair";
  return "strong";
};

// The captured module is a deep `as const`, so sub-scores are read through a
// narrow structural type rather than an index signature over the literal.
type CapturedSubScore = {
  available: boolean;
  score: number;
  confidence: number;
  formula: string;
  rawInputs: Record<string, unknown>;
  providerSources: readonly string[];
};

type ScoredSite = {
  id: string;
  label: string;
  note: string;
  location: { lat: number; lng: number; radiusMeters: number };
  dataMode: string;
  confidence: number;
  rows: Array<{
    factorId: string;
    label: string;
    available: boolean;
    score: number | null;
    appliedWeight: number;
    contribution: number;
    formula: string;
    rawInputs: Record<string, unknown>;
    providerSources: string[];
  }>;
  weightCoverage: number;
  weightedRisk: number;
  opportunity: number;
  redFlags: string[];
  unavailable: string[];
};

// Mirrors backend/portfolio/ranking-engine.js. Factors with no live provider
// are dropped and the remaining weights renormalised, then an evidence penalty
// of 0.25 points per percent of unbacked weight is applied.
const scoreSite = (site: (typeof demoCapture.sites)[number], weights: Record<string, number>): ScoredSite => {
  const rows = factorOrder.map((factorId) => {
    const sub = (site.subScores as unknown as Record<string, CapturedSubScore | undefined>)[factorId];
    return {
      factorId,
      label: factorLabels[factorId],
      available: Boolean(sub?.available),
      score: sub?.available ? Number(sub.score) : null,
      profileWeight: Number(weights[factorId] || 0),
      appliedWeight: 0,
      contribution: 0,
      formula: sub?.formula || "",
      rawInputs: (sub?.rawInputs || {}) as Record<string, unknown>,
      providerSources: [...(sub?.providerSources || [])] as string[],
    };
  });

  const activeTotal = rows.filter((row) => row.available).reduce((sum, row) => sum + row.profileWeight, 0);
  for (const row of rows) {
    if (!row.available || !activeTotal) continue;
    row.appliedWeight = row.profileWeight / activeTotal;
    row.contribution = Number(((row.score ?? 0) * row.appliedWeight).toFixed(2));
  }

  const weightCoverage = Math.round(rows.reduce((sum, row) => sum + (row.available ? row.profileWeight : 0), 0) * 100);
  const weightedRisk = Number(rows.reduce((sum, row) => sum + row.contribution, 0).toFixed(1));
  const evidencePenalty = (100 - weightCoverage) * 0.25;
  const opportunity = Math.round(Math.max(0, Math.min(100, 100 - weightedRisk - evidencePenalty)));

  return {
    id: site.id,
    label: site.label,
    note: site.note,
    location: site.location,
    dataMode: site.dataMode,
    confidence: site.confidence,
    // profileWeight is scaffolding for the renormalisation above and is not
    // part of the rendered row.
    rows: rows.map((row) => ({
      factorId: row.factorId,
      label: row.label,
      available: row.available,
      score: row.score,
      appliedWeight: row.appliedWeight,
      contribution: row.contribution,
      formula: row.formula,
      rawInputs: row.rawInputs,
      providerSources: row.providerSources,
    })),
    weightCoverage,
    weightedRisk,
    opportunity,
    redFlags: [...site.redFlags],
    unavailable: [...site.unavailableScores],
  };
};

export function PitchSiteDemo() {
  const [profileId, setProfileId] = useState<ProfileId>("office");
  const [selectedId, setSelectedId] = useState<string>(demoCapture.sites[0].id);
  const [openFactor, setOpenFactor] = useState<string>("");

  const profile = profiles[profileId];
  const ranked = useMemo(
    () =>
      demoCapture.sites
        .map((site) => scoreSite(site, profile.weights))
        .sort((a, b) => b.opportunity - a.opportunity),
    [profile],
  );

  const selected = ranked.find((site) => site.id === selectedId) || ranked[0];
  const leader = ranked[0];
  const capturedDate = new Date(demoCapture.capturedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="site-demo">
      <div className="demo-banner">
        <Info size={15} aria-hidden="true" />
        <span>
          Real screening output captured from live providers on {capturedDate}. The weighting arithmetic below is the
          same code path the product uses; only the provider fetch is pre-run so the demo does not consume quota.
        </span>
      </div>

      <div className="demo-controls">
        <span className="demo-control-label">
          <Layers size={14} aria-hidden="true" /> Asset class
        </span>
        {(Object.keys(profiles) as ProfileId[]).map((id) => (
          <button
            className={id === profileId ? "demo-chip active" : "demo-chip"}
            key={id}
            type="button"
            onClick={() => setProfileId(id)}
          >
            {profiles[id].label}
          </button>
        ))}
      </div>
      <p className="demo-rationale">{profile.rationale}</p>

      <div className="demo-body">
        <div className="demo-sites">
          {ranked.map((site, index) => (
            <button
              className={site.id === selected.id ? "demo-site active" : "demo-site"}
              key={site.id}
              type="button"
              onClick={() => setSelectedId(site.id)}
            >
              <span className="demo-rank">#{index + 1}</span>
              <div className="demo-site-body">
                <strong>{site.label}</strong>
                <small>{site.note}</small>
                <div className="demo-site-meta">
                  <span className={`score-pill ${site.opportunity >= 70 ? "strong" : site.opportunity >= 50 ? "fair" : "weak"}`}>
                    {site.opportunity}
                  </span>
                  <em>weighted risk {site.weightedRisk}</em>
                  <em>{site.weightCoverage}% evidence</em>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="demo-detail">
          <header>
            <h3>
              <MapPin size={16} aria-hidden="true" />
              {selected.label}
            </h3>
            <span>
              {selected.location.lat.toFixed(4)}, {selected.location.lng.toFixed(4)} - {selected.location.radiusMeters} m
              radius - {selected.dataMode} data - {Math.round(selected.confidence * 100)}% confidence
            </span>
          </header>

          <div className="demo-factors">
            {selected.rows.map((row) => (
              <div className="demo-factor" key={row.factorId}>
                <button type="button" onClick={() => setOpenFactor(openFactor === row.factorId ? "" : row.factorId)}>
                  <span className="demo-factor-name">{row.label}</span>
                  {row.available ? (
                    <>
                      <span className="demo-bar">
                        <span className={riskTone(row.score)} style={{ width: `${row.score ?? 0}%` }} />
                      </span>
                      <span className="demo-factor-score">{row.score}</span>
                      <span className="demo-factor-weight">x{Math.round(row.appliedWeight * 100)}%</span>
                      <span className="demo-factor-contribution">= {row.contribution}</span>
                    </>
                  ) : (
                    <span className="demo-unavailable">
                      <AlertTriangle size={13} aria-hidden="true" /> no live provider - excluded from scoring
                    </span>
                  )}
                </button>
                {openFactor === row.factorId && row.available && (
                  <div className="demo-factor-detail">
                    <p>
                      <strong>Formula</strong> <code>{row.formula}</code>
                    </p>
                    <p>
                      <strong>Measured inputs</strong>{" "}
                      {Object.entries(row.rawInputs)
                        .map(([key, value]) => `${key}: ${String(value)}`)
                        .join(", ") || "none recorded"}
                    </p>
                    <p>
                      <strong>Source</strong> {row.providerSources.join(", ") || "unavailable"}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="demo-summary">
            <div className="demo-summary-row">
              <span>Weighted screening risk</span>
              <strong>{selected.weightedRisk} / 100</strong>
            </div>
            <div className="demo-summary-row">
              <span>Evidence coverage</span>
              <strong>{selected.weightCoverage}%</strong>
            </div>
            <div className="demo-summary-row highlight">
              <span>Opportunity score</span>
              <strong>{selected.opportunity} / 100</strong>
            </div>
            <p className="demo-formula">
              <code>opportunity = 100 - weightedRisk - (100 - evidenceCoverage) x 0.25</code>
            </p>
          </div>

          {selected.id !== leader.id && (
            <div className="demo-gap">
              <strong>Why this ranks below {leader.label}</strong>
              <ul>
                {selected.rows
                  .filter((row) => row.available)
                  .map((row) => {
                    const other = leader.rows.find((item) => item.factorId === row.factorId);
                    if (!other?.available) return null;
                    const delta = Number((row.contribution - other.contribution).toFixed(2));
                    return { label: row.label, delta, mine: row.score, theirs: other.score };
                  })
                  .filter((item): item is { label: string; delta: number; mine: number | null; theirs: number | null } => Boolean(item))
                  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                  .slice(0, 3)
                  .map((item) => (
                    <li key={item.label}>
                      {item.label}: {item.mine}/100 against {item.theirs}/100 &mdash;{" "}
                      {item.delta > 0 ? `${item.delta} points worse` : `${Math.abs(item.delta)} points better`}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {selected.unavailable.length > 0 && (
            <div className="demo-missing">
              <AlertTriangle size={15} aria-hidden="true" />
              <div>
                <strong>Indicators with no live provider for this location</strong>
                <p>
                  {selected.unavailable.join(", ")}. These are excluded from the score rather than estimated, and the
                  gap is charged against the opportunity score as an evidence penalty.
                </p>
              </div>
            </div>
          )}

          {selected.redFlags.length > 0 && (
            <div className="demo-flags">
              <strong>Screening flags raised</strong>
              <ul>
                {selected.redFlags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="demo-sources">
            <strong>
              <CheckCircle2 size={14} aria-hidden="true" /> Providers behind these numbers
            </strong>
            <ul>
              {(demoCapture.sites.find((site) => site.id === selected.id)?.sourceTable || [])
                .filter((source) => source.dataMode === "live")
                .map((source) => (
                  <li key={source.id}>
                    {source.providerName} ({source.sourceType}, {Math.round(Number(source.confidence) * 100)}% confidence)
                    {source.citation && (
                      <a href={source.citation} target="_blank" rel="noreferrer noopener">
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
