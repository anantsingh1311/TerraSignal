// Portfolio ranking.
//
// Ranking introduces no new measurement. It re-weights the deterministic
// sub-scores that the scoring engine already produced, using a weighting
// profile chosen for the asset class. Every ranked site therefore carries the
// same provenance chain as its own report: provider -> raw input -> formula ->
// sub-score -> weight -> contribution -> rank.
//
// There is no opaque "AI score" anywhere in this file.

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const finite = (value) => Number.isFinite(Number(value));
const round = (value, places = 1) => Number(Number(value).toFixed(places));

// Factor keys mirror the sub-score ids emitted by the scoring engine.
export const rankingFactors = [
  {
    id: "slopeTerrainRisk",
    label: "Terrain and slope",
    direction: "risk",
    meaning: "Grading, cut/fill, retaining and access earthworks exposure.",
  },
  {
    id: "elevationVariabilityRisk",
    label: "Elevation variability",
    direction: "risk",
    meaning: "Level differences that drive earthwork volume and drainage design.",
  },
  {
    id: "drainageWaterProximityRisk",
    label: "Drainage and water proximity",
    direction: "risk",
    meaning: "Mapped watercourses and waterbodies near the site envelope.",
  },
  {
    id: "floodContextIndicator",
    label: "Flood context",
    direction: "risk",
    meaning: "Flood-authority context where a supported dataset covers the region.",
  },
  {
    id: "infrastructureAccessIndicator",
    label: "Access and infrastructure",
    direction: "risk",
    meaning: "Mapped road access and infrastructure density around the site.",
  },
  {
    id: "landUseContextIndicator",
    label: "Surrounding land use",
    direction: "risk",
    meaning: "Mapped land-use mix and industrial context in the surrounding area.",
  },
  {
    id: "dataAvailabilityConfidence",
    label: "Evidence quality",
    direction: "risk",
    meaning: "How much live provider coverage stands behind this site's numbers.",
  },
];

const factorIds = new Set(rankingFactors.map((factor) => factor.id));

// Weighting profiles.
//
// These are TerraSignal product defaults, chosen to reflect which screening
// indicators matter most to each asset class. They are a starting point for
// discussion, not an industry standard, and every profile is fully editable in
// the UI. The rationale is shipped alongside the numbers so a reviewer can
// disagree with a specific weight rather than with the whole result.
export const weightingProfiles = {
  residential: {
    id: "residential",
    label: "Residential development",
    rationale:
      "Weighted toward drainage and flood context, because water ingress and stormwater capacity dominate liveability, warranty and reputational exposure on housing sites.",
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
  office: {
    id: "office",
    label: "Office / IT park",
    rationale:
      "Weighted toward access and infrastructure, because commuting time, road hierarchy and utility density drive occupier demand and rent achievable on office assets.",
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
  retail: {
    id: "retail",
    label: "Retail / mall",
    rationale:
      "Weighted toward access and surrounding land-use mix, because catchment reachability and the character of adjacent development dominate retail footfall potential.",
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
    id: "warehouse",
    label: "Warehouse / logistics",
    rationale:
      "Weighted toward flat terrain and road access, because large-floorplate sheds need low earthwork volumes and heavy-vehicle connectivity above all else.",
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
    id: "industrial",
    label: "Industrial",
    rationale:
      "Weighted toward terrain, flood exposure and surrounding land-use compatibility, which together govern plant layout, environmental consenting and neighbour risk.",
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
    id: "balanced",
    label: "Balanced / mixed use",
    rationale:
      "Equalised weighting for early-stage screening where the intended asset class is not yet fixed.",
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

export const defaultProfileForUse = (intendedUse) => {
  const text = String(intendedUse || "").toLowerCase();
  if (text.includes("warehouse")) return "warehouse";
  if (text.includes("industrial")) return "industrial";
  if (text.includes("commercial")) return "office";
  if (text.includes("residential")) return "residential";
  if (text.includes("retail")) return "retail";
  return "balanced";
};

export const resolveProfile = (profileId, weightOverrides) => {
  const base = weightingProfiles[String(profileId || "balanced")] || weightingProfiles.balanced;
  const merged = { ...base.weights };
  let customised = false;

  for (const [key, value] of Object.entries(weightOverrides || {})) {
    if (!factorIds.has(key) || !finite(value)) continue;
    const next = clamp(value, 0, 1);
    if (next !== merged[key]) customised = true;
    merged[key] = next;
  }

  // Renormalise so the weights always sum to 1 and contributions stay
  // comparable across profiles and across edits.
  const total = Object.values(merged).reduce((sum, value) => sum + value, 0);
  const weights = total
    ? Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, Number((value / total).toFixed(4))]))
    : base.weights;

  return {
    id: base.id,
    label: customised ? `${base.label} (adjusted)` : base.label,
    rationale: base.rationale,
    customised,
    weights,
  };
};

// A factor only participates when the underlying provider actually returned
// data. Weights are then renormalised across the factors that survived, so a
// site is never penalised or flattered by an indicator nobody could measure.
const factorRowsFor = (scan, weights) => {
  const rows = [];
  for (const factor of rankingFactors) {
    const subScore = scan?.subScores?.[factor.id];
    const weight = Number(weights[factor.id] || 0);
    rows.push({
      factorId: factor.id,
      label: factor.label,
      meaning: factor.meaning,
      available: Boolean(subScore?.available),
      riskScore: subScore?.available ? Number(subScore.score) : null,
      confidence: subScore?.available ? Number(subScore.confidence) : 0,
      profileWeight: weight,
      appliedWeight: 0,
      contribution: 0,
      formula: subScore?.formula || null,
      rawInputs: subScore?.rawInputs || {},
      providerSources: subScore?.providerSources || [],
      unavailableReason: subScore?.available ? null : "No live provider returned this indicator for this site.",
    });
  }

  const activeTotal = rows.filter((row) => row.available).reduce((sum, row) => sum + row.profileWeight, 0);
  for (const row of rows) {
    if (!row.available || !activeTotal) continue;
    row.appliedWeight = Number((row.profileWeight / activeTotal).toFixed(4));
    row.contribution = round(row.riskScore * row.appliedWeight, 2);
  }
  return rows;
};

const coverageFor = (rows) => {
  const available = rows.filter((row) => row.available);
  return {
    factorsAvailable: available.length,
    factorsTotal: rows.length,
    // Share of the profile's intended weight that is actually backed by data.
    weightCoverage: round(
      rows.reduce((sum, row) => sum + (row.available ? row.profileWeight : 0), 0) * 100,
      0,
    ),
    missingFactors: rows.filter((row) => !row.available).map((row) => row.label),
  };
};

const scanFromRecord = (record) => record?.scan || record;

export const scoreSiteForProfile = (record, profile) => {
  const scan = scanFromRecord(record);
  const rows = factorRowsFor(scan, profile.weights);
  const coverage = coverageFor(rows);
  const weightedRisk = rows.reduce((sum, row) => sum + row.contribution, 0);
  const hasSignal = coverage.factorsAvailable > 0;

  // Opportunity is the inverse of weighted risk, held back by evidence gaps so
  // a data-poor site can never out-rank a well-evidenced one on silence alone.
  const evidencePenalty = (100 - coverage.weightCoverage) * 0.25;
  const opportunityScore = hasSignal ? round(clamp(100 - weightedRisk - evidencePenalty, 0, 100), 0) : null;

  return {
    scanId: scan?.scanId || record?.id || null,
    label: scan?.location?.address || (finite(scan?.location?.lat) ? `${Number(scan.location.lat).toFixed(4)}, ${Number(scan.location.lng).toFixed(4)}` : "Unlabelled site"),
    location: scan?.location || null,
    intendedUse: scan?.intendedUse || null,
    dataMode: scan?.dataMode || "unavailable",
    reportReadiness: scan?.reportReadiness || "unavailable",
    confidence: finite(scan?.confidence) ? Number(scan.confidence) : 0,
    baselineRiskScore: finite(scan?.overallRiskScore) ? Number(scan.overallRiskScore) : null,
    weightedRiskScore: hasSignal ? round(weightedRisk, 1) : null,
    opportunityScore,
    evidencePenalty: round(evidencePenalty, 1),
    coverage,
    factors: rows,
    redFlags: Array.isArray(scan?.redFlags) ? scan.redFlags : [],
    rankable: hasSignal,
  };
};

// Plain-language comparison between two ranked sites, generated from the
// arithmetic rather than by a language model, so it cannot drift from the data.
const explainGap = (leader, challenger) => {
  if (!leader?.rankable || !challenger?.rankable) return [];
  const deltas = leader.factors
    .map((row) => {
      const other = challenger.factors.find((item) => item.factorId === row.factorId);
      if (!row.available || !other?.available) return null;
      return {
        label: row.label,
        delta: round(other.contribution - row.contribution, 2),
        leaderScore: row.riskScore,
        challengerScore: other.riskScore,
        weight: row.appliedWeight,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  return deltas.map((item) =>
    item.delta > 0
      ? `${item.label}: ${leader.label} screens ${item.leaderScore}/100 against ${item.challengerScore}/100, worth ${Math.abs(item.delta)} points of weighted advantage at a ${Math.round(item.weight * 100)}% weight.`
      : `${item.label}: ${challenger.label} screens better (${item.challengerScore}/100 against ${item.leaderScore}/100), offsetting ${Math.abs(item.delta)} points at a ${Math.round(item.weight * 100)}% weight.`,
  );
};

const nextActionFor = (site) => {
  if (!site.rankable) return "Connect live providers or re-run the scan; no indicator could be scored for this site.";
  if (site.coverage.weightCoverage < 60) {
    return `Close the evidence gap first: ${site.coverage.missingFactors.join(", ")} could not be scored, so ${100 - site.coverage.weightCoverage}% of the profile weight is unbacked.`;
  }
  const worst = [...site.factors]
    .filter((row) => row.available)
    .sort((a, b) => b.contribution - a.contribution)[0];
  if (worst && worst.riskScore >= 68) {
    return `Commission professional verification of ${worst.label.toLowerCase()} before committing capital; it is the largest weighted contributor at ${worst.contribution} points.`;
  }
  return "Proceed to detailed due diligence: no single screening factor dominates, and evidence coverage is adequate for a shortlist decision.";
};

export const rankPortfolio = ({ sites = [], profileId = "balanced", weightOverrides = {} } = {}) => {
  const profile = resolveProfile(profileId, weightOverrides);
  const scored = sites.map((record) => scoreSiteForProfile(record, profile));

  const rankable = scored
    .filter((site) => site.rankable)
    .sort((a, b) => b.opportunityScore - a.opportunityScore || a.weightedRiskScore - b.weightedRiskScore);
  const unrankable = scored.filter((site) => !site.rankable);

  const ranked = rankable.map((site, index) => ({
    ...site,
    rank: index + 1,
    gapToLeader: index === 0 ? 0 : round(rankable[0].opportunityScore - site.opportunityScore, 1),
    whyNotLeader: index === 0 ? [] : explainGap(rankable[0], site),
    nextAction: nextActionFor(site),
  }));

  const leader = ranked[0] || null;
  const meanCoverage = scored.length
    ? round(scored.reduce((sum, site) => sum + site.coverage.weightCoverage, 0) / scored.length, 0)
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    profile,
    factors: rankingFactors,
    ranked,
    unrankable: unrankable.map((site) => ({ ...site, nextAction: nextActionFor(site) })),
    portfolioSummary: {
      siteCount: scored.length,
      rankableCount: ranked.length,
      leaderScanId: leader?.scanId || null,
      leaderLabel: leader?.label || null,
      leaderOpportunityScore: leader?.opportunityScore ?? null,
      spread:
        ranked.length > 1 ? round(ranked[0].opportunityScore - ranked[ranked.length - 1].opportunityScore, 1) : 0,
      meanWeightCoverage: meanCoverage,
      // A shortlist decision taken on thin evidence is the failure mode this
      // product exists to prevent, so it is surfaced at portfolio level.
      evidenceWarning:
        meanCoverage < 60
          ? "Mean evidence coverage across this portfolio is below 60%. Treat the ordering as provisional and close the data gaps before it informs a capital decision."
          : "",
      sitesBlockedFromClientReport: scored.filter((site) => site.reportReadiness !== "clientDeliverableEligible").length,
    },
    methodology: {
      steps: [
        "Each site is screened independently by the deterministic scoring engine; ranking adds no new measurement.",
        "The selected weighting profile assigns an importance weight to each screening factor.",
        "Factors with no live provider data are dropped, and the remaining weights are renormalised to sum to 1.",
        "Weighted risk is the sum of factor score multiplied by its renormalised weight.",
        "An evidence penalty of 0.25 points per percent of unbacked profile weight is subtracted from the opportunity score.",
        "Opportunity score = 100 - weighted risk - evidence penalty, clamped to 0-100.",
      ],
      formulas: {
        appliedWeight: "profileWeight / sum(profileWeight of available factors)",
        contribution: "factorRiskScore * appliedWeight",
        weightedRiskScore: "sum(contribution)",
        evidencePenalty: "(100 - weightCoverage) * 0.25",
        opportunityScore: "clamp(100 - weightedRiskScore - evidencePenalty, 0, 100)",
      },
      limitations: [
        "Ranking compares screening indicators only. It does not compare price, title, zoning, entitlement status, construction cost, market absorption or expected return.",
        "Weighting profiles are TerraSignal product defaults, not an industry standard, and should be agreed with the acquiring team before use.",
        "A higher opportunity score means fewer screening-level obstacles, not a recommendation to acquire.",
      ],
    },
  };
};
