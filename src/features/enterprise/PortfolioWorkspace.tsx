import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  askSiteQuestion,
  createPortfolio,
  deletePortfolio,
  getPortfolio,
  listPortfolios,
  rankPortfolio,
} from "../../productApi";
import type { LandScanSummary } from "../../productTypes";
import type { Portfolio, PortfolioView, RankedSite, SiteQaAnswer } from "../../enterpriseTypes";

const scoreTone = (score: number | null) => {
  if (score === null) return "unknown";
  if (score >= 70) return "strong";
  if (score >= 50) return "fair";
  return "weak";
};

const riskTone = (score: number | null) => {
  if (score === null) return "unknown";
  if (score >= 68) return "weak";
  if (score >= 45) return "fair";
  return "strong";
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function PortfolioWorkspace({
  scans,
  token,
  onOpenScan,
  setNotice,
}: {
  scans: LandScanSummary[];
  token: string;
  onOpenScan: (scanId: string) => void;
  setNotice: (message: string) => void;
}) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [view, setView] = useState<PortfolioView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftScanIds, setDraftScanIds] = useState<string[]>([]);
  const [weightDraft, setWeightDraft] = useState<Record<string, number>>({});
  const [question, setQuestion] = useState(
    "Which of these sites presents the lowest development risk, and what data is missing before we should consider acquiring it?",
  );
  const [answer, setAnswer] = useState<SiteQaAnswer | null>(null);
  const [asking, setAsking] = useState(false);

  const refreshList = useCallback(async () => {
    if (!token) return;
    const response = await listPortfolios(token);
    setPortfolios(response.portfolios);
    setActiveId((current) => current || response.portfolios[0]?.id || "");
  }, [token]);

  useEffect(() => {
    // Deferred so the fetch and its state updates happen after commit rather
    // than synchronously inside the effect body.
    const timer = window.setTimeout(() => {
      void refreshList().catch((err) => setError(err instanceof Error ? err.message : "Unable to load portfolios"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshList]);

  const loadView = useCallback(
    async (portfolioId: string) => {
      if (!token || !portfolioId) return;
      setBusy(true);
      setError("");
      try {
        const response = await getPortfolio(token, portfolioId);
        setView(response);
        setWeightDraft(response.ranking.profile.weights);
        setAnswer(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load portfolio");
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!activeId) return undefined;
    const timer = window.setTimeout(() => void loadView(activeId), 0);
    return () => window.clearTimeout(timer);
  }, [activeId, loadView]);

  const create = async () => {
    if (!draftName.trim() || draftScanIds.length === 0) {
      setError("Name the portfolio and select at least one screened site.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await createPortfolio(token, { name: draftName.trim(), scanIds: draftScanIds });
      setDraftName("");
      setDraftScanIds([]);
      await refreshList();
      setActiveId(response.portfolio.id);
      setNotice(`Portfolio "${response.portfolio.name}" created with ${draftScanIds.length} site(s)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create portfolio");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (portfolioId: string) => {
    setBusy(true);
    try {
      await deletePortfolio(token, portfolioId);
      setView(null);
      setActiveId("");
      await refreshList();
      setNotice("Portfolio deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete portfolio");
    } finally {
      setBusy(false);
    }
  };

  const applyProfile = async (profileId: string, overrides?: Record<string, number>) => {
    if (!activeId) return;
    setBusy(true);
    try {
      const response = await rankPortfolio(token, activeId, { profileId, weightOverrides: overrides });
      setView(response);
      if (!overrides) setWeightDraft(response.ranking.profile.weights);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to re-rank portfolio");
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!view) return;
    const scanIds = view.ranking.ranked.map((site) => site.scanId).filter(Boolean) as string[];
    if (!scanIds.length) {
      setError("No rankable sites to ask about.");
      return;
    }
    setAsking(true);
    setError("");
    try {
      setAnswer(await askSiteQuestion(token, { scanIds: scanIds.slice(0, 8), question }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer that question.");
    } finally {
      setAsking(false);
    }
  };

  const eligibleScans = useMemo(() => scans.filter((scan) => scan.dataMode !== "unavailable"), [scans]);
  const summary = view?.executiveSummary;
  const ranking = view?.ranking;

  return (
    <section className="portfolio-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Portfolio decision intelligence</span>
          <h1>Compare candidate sites on one transparent scale</h1>
          <p>
            Ranking re-weights the deterministic screening scores each site already produced. It adds no new
            measurement, and every weight, contribution and formula stays visible.
          </p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="portfolio-grid">
        <aside className="panel portfolio-sidebar">
          <div className="panel-title">
            <h2>Portfolios</h2>
            <span>{portfolios.length} saved</span>
          </div>
          <div className="portfolio-list">
            {portfolios.map((portfolio) => (
              <button
                className={portfolio.id === activeId ? "portfolio-chip active" : "portfolio-chip"}
                key={portfolio.id}
                type="button"
                onClick={() => setActiveId(portfolio.id)}
              >
                <strong>{portfolio.name}</strong>
                <span>{portfolio.scanIds.length} sites</span>
              </button>
            ))}
            {!portfolios.length && <p className="muted">No portfolios yet. Build one from your screened sites.</p>}
          </div>

          <div className="panel-title compact-title">
            <h2>New portfolio</h2>
            <span>Select screened sites</span>
          </div>
          <label>
            <span>Portfolio name</span>
            <input
              value={draftName}
              placeholder="Gurugram commercial shortlist"
              onChange={(event) => setDraftName(event.target.value)}
            />
          </label>
          <div className="scan-picker">
            {eligibleScans.map((scan) => {
              const selected = draftScanIds.includes(scan.id);
              return (
                <button
                  className={selected ? "scan-pick selected" : "scan-pick"}
                  key={scan.id}
                  type="button"
                  onClick={() =>
                    setDraftScanIds((current) =>
                      current.includes(scan.id) ? current.filter((id) => id !== scan.id) : [...current, scan.id],
                    )
                  }
                >
                  {selected ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                  <span>
                    <strong>{scan.location.address || `${scan.location.lat.toFixed(4)}, ${scan.location.lng.toFixed(4)}`}</strong>
                    <small>
                      {scan.riskBand} risk | {scan.dataMode} data | {percent(scan.confidence)} confidence
                    </small>
                  </span>
                </button>
              );
            })}
            {!eligibleScans.length && <p className="muted">Run at least one land scan to build a portfolio.</p>}
          </div>
          <button className="primary-action wide" type="button" disabled={busy} onClick={() => void create()}>
            <Layers size={16} aria-hidden="true" />
            Create portfolio
          </button>
        </aside>

        <div className="portfolio-main">
          {busy && !view && (
            <div className="panel loading-panel">
              <Loader2 className="spin" size={18} aria-hidden="true" /> Loading portfolio...
            </div>
          )}

          {view && ranking && summary && (
            <>
              <section className="panel executive-dashboard">
                <div className="panel-title">
                  <h2>Executive decision view</h2>
                  <span>{view.portfolio.name}</span>
                </div>
                <div className="executive-grid">
                  <article className="exec-card opportunity">
                    <span className="exec-label">Opportunity</span>
                    <strong>{summary.opportunity.headline}</strong>
                    <p>{summary.opportunity.detail}</p>
                  </article>
                  <article className="exec-card risk">
                    <span className="exec-label">Risk</span>
                    <strong>{summary.risk.headline}</strong>
                    <p>{summary.risk.detail}</p>
                    {summary.risk.items.length > 0 && (
                      <ul>
                        {summary.risk.items.slice(0, 3).map((item) => (
                          <li key={`${item.site}-${item.factor}`}>
                            {item.factor} at {item.score}/100 - {item.site}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                  <article className="exec-card feasibility">
                    <span className="exec-label">Feasibility</span>
                    <strong>{summary.feasibility.headline}</strong>
                    <p>{summary.feasibility.detail}</p>
                  </article>
                  <article className="exec-card confidence">
                    <span className="exec-label">Confidence</span>
                    <strong>{summary.confidence.headline}</strong>
                    <p>{summary.confidence.detail}</p>
                    {summary.confidence.blockedFromClientReport > 0 && (
                      <small className="exec-flag">
                        {summary.confidence.blockedFromClientReport} site(s) not yet client-deliverable eligible
                      </small>
                    )}
                  </article>
                  <article className="exec-card action">
                    <span className="exec-label">Next action</span>
                    <strong>{summary.nextAction.headline}</strong>
                    <ul>
                      {summary.nextAction.queue.slice(0, 3).map((item) => (
                        <li key={item.site}>
                          <em>#{item.rank}</em> {item.site}: {item.action}
                        </li>
                      ))}
                    </ul>
                  </article>
                </div>
                {summary.confidence.warning && (
                  <div className="callout caution">
                    <ShieldAlert size={16} aria-hidden="true" /> {summary.confidence.warning}
                  </div>
                )}
                <p className="fine-print">{summary.disclaimer}</p>
              </section>

              <section className="panel weighting-panel">
                <div className="panel-title">
                  <h2>Weighting profile</h2>
                  <span>{ranking.profile.label}</span>
                </div>
                <p className="muted">{ranking.profile.rationale}</p>
                <div className="profile-row">
                  {view.availableProfiles.map((profile) => (
                    <button
                      className={profile.id === ranking.profile.id ? "profile-chip active" : "profile-chip"}
                      key={profile.id}
                      type="button"
                      onClick={() => void applyProfile(profile.id)}
                    >
                      {profile.label}
                    </button>
                  ))}
                </div>
                <div className="weight-editor">
                  {ranking.factors.map((factor) => (
                    <label key={factor.id} className="weight-row">
                      <span title={factor.meaning}>{factor.label}</span>
                      <input
                        type="range"
                        min={0}
                        max={0.5}
                        step={0.01}
                        value={weightDraft[factor.id] ?? 0}
                        onChange={(event) =>
                          setWeightDraft((current) => ({ ...current, [factor.id]: Number(event.target.value) }))
                        }
                      />
                      <em>{Math.round((weightDraft[factor.id] ?? 0) * 100)}%</em>
                    </label>
                  ))}
                </div>
                <div className="weight-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void applyProfile(ranking.profile.id, weightDraft)}
                  >
                    <Scale size={16} aria-hidden="true" />
                    Apply custom weights
                  </button>
                  <button className="ghost-action" type="button" onClick={() => void applyProfile(ranking.profile.id)}>
                    <RefreshCw size={15} aria-hidden="true" />
                    Reset to profile default
                  </button>
                  <span className="muted">Weights are renormalised to sum to 100% before ranking.</span>
                </div>
              </section>

              <section className="panel comparison-panel">
                <div className="panel-title">
                  <h2>Site comparison</h2>
                  <span>
                    {ranking.portfolioSummary.rankableCount} of {ranking.portfolioSummary.siteCount} sites rankable
                  </span>
                </div>
                <div className="comparison-scroll">
                  <table className="comparison-table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Site</th>
                        <th>Opportunity</th>
                        <th>Weighted risk</th>
                        <th>Evidence</th>
                        {ranking.factors.map((factor) => (
                          <th key={factor.id} title={factor.meaning}>
                            {factor.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.ranked.map((site) => (
                        <tr key={site.scanId}>
                          <td className="rank-cell">#{site.rank}</td>
                          <td>
                            <button className="link-button" type="button" onClick={() => onOpenScan(site.scanId)}>
                              {site.label}
                            </button>
                            <small>{site.dataMode} data</small>
                          </td>
                          <td>
                            <span className={`score-pill ${scoreTone(site.opportunityScore)}`}>
                              {site.opportunityScore ?? "n/a"}
                            </span>
                          </td>
                          <td>{site.weightedRiskScore ?? "n/a"}</td>
                          <td>{site.coverage.weightCoverage}%</td>
                          {ranking.factors.map((factor) => {
                            const row = site.factors.find((item) => item.factorId === factor.id);
                            return (
                              <td key={factor.id} title={row?.formula || row?.unavailableReason || ""}>
                                {row?.available ? (
                                  <span className={`factor-cell ${riskTone(row.riskScore)}`}>
                                    {row.riskScore}
                                    <small>x{Math.round(row.appliedWeight * 100)}%</small>
                                  </span>
                                ) : (
                                  <span className="factor-cell unknown">n/a</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {ranking.ranked.slice(1).map((site) => (
                  <WhyPanel key={site.scanId} site={site} />
                ))}

                {view.inaccessibleScans.length > 0 && (
                  <div className="callout caution">
                    <AlertTriangle size={16} aria-hidden="true" />
                    {view.inaccessibleScans.length} scan reference(s) could not be loaded:{" "}
                    {view.inaccessibleScans.map((item) => item.reason).join(" ")}
                  </div>
                )}

                <details className="methodology">
                  <summary>
                    <BarChart3 size={15} aria-hidden="true" /> How this ranking is calculated
                  </summary>
                  <ol>
                    {ranking.methodology.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <table className="formula-table">
                    <tbody>
                      {Object.entries(ranking.methodology.formulas).map(([key, formula]) => (
                        <tr key={key}>
                          <th>{key}</th>
                          <td>
                            <code>{formula}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="limitations">
                    {ranking.methodology.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </details>
              </section>

              <section className="panel assistant-panel">
                <div className="panel-title">
                  <h2>Ask the screening record</h2>
                  <span>Answers come only from these scans</span>
                </div>
                <textarea
                  rows={2}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Which site carries the least development risk, and what must we verify first?"
                />
                <div className="assistant-actions">
                  <button className="primary-action" type="button" disabled={asking} onClick={() => void ask()}>
                    {asking ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                    {asking ? "Thinking..." : "Ask"}
                  </button>
                  <span className="muted">
                    The assistant cannot retrieve geology, title, zoning, pricing or market data. If the answer is not
                    in these records it will say so.
                  </span>
                </div>
                {answer && (
                  <div className="assistant-answer">
                    <p>{answer.answer}</p>
                    <div className="assistant-grounding">
                      <strong>Grounded on</strong>
                      <ul>
                        {answer.groundedOn.map((item) => (
                          <li key={item.scanId}>
                            {item.label} - {item.dataMode} data, {percent(item.confidence)} confidence
                            {item.unavailableIndicators.length
                              ? `, unavailable: ${item.unavailableIndicators.join(", ")}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                      <ul className="guarantees">
                        {answer.guarantees.map((guarantee) => (
                          <li key={guarantee}>{guarantee}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </section>

              <div className="portfolio-footer">
                <button className="ghost-action danger" type="button" onClick={() => void remove(view.portfolio.id)}>
                  <Trash2 size={15} aria-hidden="true" />
                  Delete portfolio
                </button>
              </div>
            </>
          )}

          {!view && !busy && (
            <div className="panel empty-state">
              <h2>No portfolio selected</h2>
              <p>Create a portfolio from your screened sites to compare them on a single weighted scale.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function WhyPanel({ site }: { site: RankedSite }) {
  if (!site.whyNotLeader?.length) return null;
  return (
    <div className="why-panel">
      <h3>
        <ArrowRight size={15} aria-hidden="true" />
        Why {site.label} ranks #{site.rank}, {site.gapToLeader} points behind the leader
      </h3>
      <ul>
        {site.whyNotLeader.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p className="next-action">{site.nextAction}</p>
    </div>
  );
}
