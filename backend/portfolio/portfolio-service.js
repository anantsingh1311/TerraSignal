import { randomUUID } from "node:crypto";
import { isUuid, safeText } from "../security/http-safety.js";
import { defaultProfileForUse, rankPortfolio, weightingProfiles } from "./ranking-engine.js";

const MAX_SITES_PER_PORTFOLIO = 25;

export const normalizePortfolioInput = (body = {}, { existing = null } = {}) => {
  const errors = [];
  const name = safeText(body.name ?? existing?.name, 120);
  if (!name) errors.push("A portfolio name is required.");

  const scanIds = Array.isArray(body.scanIds)
    ? [...new Set(body.scanIds.map((value) => String(value || "").trim()).filter(isUuid))]
    : existing?.scanIds || [];
  if (Array.isArray(body.scanIds) && body.scanIds.length && !scanIds.length) {
    errors.push("scanIds must contain valid scan identifiers.");
  }
  if (scanIds.length > MAX_SITES_PER_PORTFOLIO) {
    errors.push(`A portfolio can hold at most ${MAX_SITES_PER_PORTFOLIO} sites.`);
  }

  const requestedProfile = String(body.profileId ?? existing?.profileId ?? "balanced");
  const profileId = weightingProfiles[requestedProfile] ? requestedProfile : "balanced";
  if (body.profileId && !weightingProfiles[requestedProfile]) {
    errors.push(`profileId must be one of: ${Object.keys(weightingProfiles).join(", ")}.`);
  }

  const weightOverrides = {};
  const source = body.weightOverrides ?? existing?.weightOverrides ?? {};
  for (const [key, value] of Object.entries(source)) {
    if (Number.isFinite(Number(value))) weightOverrides[String(key)] = Math.min(1, Math.max(0, Number(value)));
  }

  return {
    valid: errors.length === 0,
    errors,
    portfolio: {
      id: existing?.id || (isUuid(body.id) ? body.id : randomUUID()),
      name,
      description: safeText(body.description ?? existing?.description, 400),
      profileId,
      weightOverrides,
      scanIds,
      createdAt: existing?.createdAt || null,
    },
  };
};

// Scans are re-read from storage at rank time and filtered by ownership, so a
// portfolio can never surface a site the caller is not entitled to see - even
// if a scan id was added to it by some other path.
export const loadPortfolioScans = async ({ store, portfolio, user }) => {
  const found = [];
  const missing = [];
  for (const scanId of portfolio.scanIds) {
    const run = await store.getRun(scanId);
    const scan = run?.visualizationSettings?.landScan;
    const ownerId = run?.visualizationSettings?.userId;
    if (!scan || run.visualizationSettings?.kind !== "land-scan") {
      missing.push({ scanId, reason: "Scan not found." });
      continue;
    }
    if (user.role !== "admin" && ownerId !== user.id) {
      missing.push({ scanId, reason: "Not accessible under your account." });
      continue;
    }
    found.push(scan);
  }
  return { scans: found, missing };
};

export const buildPortfolioView = async ({ store, portfolio, user, profileId, weightOverrides }) => {
  const { scans, missing } = await loadPortfolioScans({ store, portfolio, user });
  const effectiveProfile =
    profileId ||
    portfolio.profileId ||
    defaultProfileForUse(scans[0]?.intendedUse);
  const ranking = rankPortfolio({
    sites: scans,
    profileId: effectiveProfile,
    weightOverrides: weightOverrides ?? portfolio.weightOverrides,
  });

  return {
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      description: portfolio.description,
      profileId: effectiveProfile,
      weightOverrides: weightOverrides ?? portfolio.weightOverrides,
      scanIds: portfolio.scanIds,
      createdAt: portfolio.createdAt,
      updatedAt: portfolio.updatedAt,
    },
    ranking,
    inaccessibleScans: missing,
    availableProfiles: Object.values(weightingProfiles).map((profile) => ({
      id: profile.id,
      label: profile.label,
      rationale: profile.rationale,
      weights: profile.weights,
    })),
  };
};

// Executive roll-up. Every field maps to something computed elsewhere; this
// function only selects and phrases, so there is no second source of truth.
export const buildExecutiveSummary = (view) => {
  const { ranking } = view;
  const leader = ranking.ranked[0] || null;
  const blocked = ranking.portfolioSummary.sitesBlockedFromClientReport;
  const coverage = ranking.portfolioSummary.meanWeightCoverage;

  const riskItems = ranking.ranked
    .flatMap((site) =>
      site.factors
        .filter((factor) => factor.available && factor.riskScore >= 68)
        .map((factor) => ({ site: site.label, factor: factor.label, score: factor.riskScore })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return {
    opportunity: {
      headline: leader ? `${leader.label} leads on screening` : "No site could be ranked",
      detail: leader
        ? `Opportunity score ${leader.opportunityScore}/100 under the ${ranking.profile.label} profile, ${ranking.portfolioSummary.spread} points clear of the lowest-ranked site in this portfolio.`
        : "No site in this portfolio returned a scoreable indicator. Connect live providers and re-run the screens.",
      rankedCount: ranking.portfolioSummary.rankableCount,
    },
    risk: {
      headline: riskItems.length ? `${riskItems.length} elevated screening flags` : "No elevated screening flags",
      items: riskItems,
      detail: riskItems.length
        ? "Each flag is a screening indicator above 68/100 and marks where professional verification should be scoped first."
        : "No indicator crossed the elevated screening threshold. This is not evidence of absence; it reflects only the indicators that could be measured.",
    },
    feasibility: {
      headline: leader ? `Weighted screening risk ${leader.weightedRiskScore}/100` : "Not assessable",
      detail: leader
        ? `Computed under the ${ranking.profile.label} weighting. ${ranking.profile.rationale}`
        : "A weighting profile cannot be applied without at least one scoreable indicator.",
    },
    confidence: {
      headline: `${coverage}% evidence coverage`,
      detail:
        coverage >= 60
          ? "Enough of the weighting profile is backed by live provider data to support a shortlist decision."
          : "Most of the weighting profile is unbacked by live data. Treat the ordering as provisional.",
      blockedFromClientReport: blocked,
      warning: ranking.portfolioSummary.evidenceWarning,
    },
    nextAction: {
      headline: leader ? leader.nextAction : "Re-run screening with live providers configured.",
      queue: ranking.ranked.slice(0, 5).map((site) => ({ site: site.label, rank: site.rank, action: site.nextAction })),
    },
    disclaimer:
      "This summary ranks screening indicators only. It does not assess price, title, zoning, entitlement, construction cost, absorption or expected return, and it is not an investment recommendation. Certified professional verification is required before any capital commitment.",
  };
};

export const portfolioLimits = { maxSites: MAX_SITES_PER_PORTFOLIO };
