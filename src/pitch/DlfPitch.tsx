import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Database,
  ExternalLink,
  Gauge,
  Layers,
  Loader2,
  Lock,
  MapPin,
  Radar,
  Scale,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { runValueScenario, submitPilotRequest } from "../productApi";
import type { ValueModelInputs, ValueScenario } from "../enterpriseTypes";
import {
  beforeAfter,
  differentiators,
  dlfPublicFacts,
  inferredOpportunities,
  marketContext,
  pilotPhases,
  platformFlow,
  securityControls,
} from "./dlfPitchData";
import { PitchSiteDemo } from "./PitchSiteDemo";

const sections = [
  { id: "pitch-hero", label: "Overview" },
  { id: "pitch-problem", label: "The problem" },
  { id: "pitch-flow", label: "How it works" },
  { id: "pitch-demo", label: "Live demo" },
  { id: "pitch-dlf", label: "For DLF" },
  { id: "pitch-roi", label: "Scenario model" },
  { id: "pitch-shift", label: "Before / after" },
  { id: "pitch-different", label: "Why different" },
  { id: "pitch-security", label: "Security" },
  { id: "pitch-pilot", label: "Pilot" },
];

const defaultInputs: ValueModelInputs = {
  sitesEvaluatedPerYear: 40,
  averageSiteValueCr: 250,
  acquisitionsPerYear: 4,
  screeningHoursPerSiteToday: 24,
  screeningHoursPerSiteWithPlatform: 6,
  blendedAnalystCostPerHour: 2500,
  probabilityOfCostlyConstraintPerAcquisition: 0.15,
  costOfLateConstraintDiscoveryPercent: 4,
  probabilityPlatformSurfacesConstraintEarly: 0.4,
  weeksSavedPerAcquisition: 4,
  costOfCapitalPercent: 9,
};

export function DlfPitch({ onRunScan }: { onRunScan: () => void }) {
  const [activeSection, setActiveSection] = useState("pitch-hero");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0.1, 0.4, 0.8] },
    );
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="pitch" ref={rootRef}>
      <nav className="pitch-rail" aria-label="Pitch sections">
        {sections.map((section) => (
          <button
            className={activeSection === section.id ? "rail-dot active" : "rail-dot"}
            key={section.id}
            type="button"
            title={section.label}
            onClick={() => goTo(section.id)}
          >
            <span>{section.label}</span>
          </button>
        ))}
      </nav>

      <Hero onExplore={() => goTo("pitch-dlf")} onRunScan={onRunScan} />
      <Problem />
      <Flow />
      <Demo />
      <ForDlf />
      <RoiSimulator />
      <BeforeAfter />
      <Different />
      <Security />
      <Pilot />
    </div>
  );
}

function Hero({ onExplore, onRunScan }: { onExplore: () => void; onRunScan: () => void }) {
  return (
    <section className="pitch-section pitch-hero" id="pitch-hero">
      <div className="pitch-hero-grid">
        <div>
          <span className="pitch-eyebrow">
            <Radar size={14} aria-hidden="true" /> TerraSignal for enterprise real estate
          </span>
          <h1>Turn land intelligence into better real-estate decisions.</h1>
          <p className="pitch-lede">
            TerraSignal screens a site before capital is committed. It samples terrain, drainage, access and land-use
            context from live geospatial providers, scores them with published formulas, ranks candidate sites on one
            transparent scale, and states plainly what it does not know.
          </p>
          <p className="pitch-sub">
            It is a decision-intelligence layer that helps a development organisation evaluate sites faster, surface
            risk earlier, and direct professional due diligence where it will actually pay. It does not replace a
            licensed surveyor, geotechnical engineer, environmental consultant or planning authority, and it never
            claims to.
          </p>
          <div className="pitch-actions">
            <button className="primary-action" type="button" onClick={onExplore}>
              Explore the DLF opportunity
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button className="secondary-action" type="button" onClick={onRunScan}>
              <MapPin size={16} aria-hidden="true" />
              Run a live scan
            </button>
          </div>
        </div>
        <div className="pitch-hero-stats">
          <article>
            <span>Screening indicators per site</span>
            <strong>7</strong>
            <small>each with formula, raw inputs, weight, confidence and source</small>
          </article>
          <article>
            <span>Data the platform will not invent</span>
            <strong>0</strong>
            <small>an indicator with no live provider is marked unavailable, never estimated</small>
          </article>
          <article>
            <span>Asset-class weighting profiles</span>
            <strong>6</strong>
            <small>residential, office, retail, warehouse, industrial, balanced — all editable</small>
          </article>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="pitch-section" id="pitch-problem">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 01</span>
        <h2>Large land decisions are made on unevenly assembled evidence.</h2>
      </header>
      <div className="problem-grid">
        <article>
          <Building2 size={20} aria-hidden="true" />
          <h3>The commitment is large and early</h3>
          <p>
            Land is bought before design, before approvals, and before most of what will drive cost is known. The
            decision is taken at the point of least information and highest reversibility cost.
          </p>
        </article>
        <article>
          <Layers size={20} aria-hidden="true" />
          <h3>The evidence is not comparable</h3>
          <p>
            Each site is assessed by whoever picks it up, with whatever data is reachable that week. Two candidate
            parcels rarely arrive at a committee described in the same terms, so the comparison is between documents
            rather than between sites.
          </p>
        </article>
        <article>
          <Gauge size={20} aria-hidden="true" />
          <h3>Constraints surface late</h3>
          <p>
            Terrain, drainage and access constraints are cheap to design around before commitment and expensive
            afterwards. They are also, in principle, observable from open geospatial data on day one.
          </p>
        </article>
      </div>

      <div className="context-block">
        <h3>Independently documented context</h3>
        <p className="muted">
          The following are published observations about the market, not claims about any single organisation.
        </p>
        <ul className="sourced-list">
          {marketContext.map((fact) => (
            <li key={fact.id}>
              <p>{fact.claim}</p>
              <a href={fact.sourceUrl} target="_blank" rel="noreferrer noopener">
                {fact.source} <ExternalLink size={12} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </div>

      <p className="pitch-caveat">
        We make no claim about the size of the improvement a screening layer produces. That is exactly what a pilot is
        for, and the scenario model further down is explicit that its inputs are assumptions until measured.
      </p>
    </section>
  );
}

function Flow() {
  const [active, setActive] = useState(0);
  const step = platformFlow[active];
  return (
    <section className="pitch-section" id="pitch-flow">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 02</span>
        <h2>How the platform works</h2>
        <p>Six stages. Click any stage to see what actually happens inside it.</p>
      </header>
      <div className="flow-track">
        {platformFlow.map((item, index) => (
          <button
            className={index === active ? "flow-node active" : index < active ? "flow-node done" : "flow-node"}
            key={item.id}
            type="button"
            onClick={() => setActive(index)}
          >
            <em>{String(index + 1).padStart(2, "0")}</em>
            <strong>{item.label}</strong>
            {index < platformFlow.length - 1 && <ChevronRight className="flow-arrow" size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="flow-detail">
        <h3>{step.label}</h3>
        <p>{step.detail}</p>
        <div className="flow-output">
          <span>Output</span>
          <strong>{step.output}</strong>
        </div>
      </div>
    </section>
  );
}

function Demo() {
  return (
    <section className="pitch-section" id="pitch-demo">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 03</span>
        <h2>A worked site analysis</h2>
        <p>
          Three real coordinates in the Gurugram area, screened by the real engine. Change the asset class to re-weight
          the factors, or open any factor to see the formula, the measured inputs and the provider behind it.
        </p>
      </header>
      <PitchSiteDemo />
    </section>
  );
}

function ForDlf() {
  const [openId, setOpenId] = useState(inferredOpportunities[0].id);
  return (
    <section className="pitch-section" id="pitch-dlf">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 04</span>
        <h2>What this could mean for DLF</h2>
        <p>
          Everything below separates three things: what DLF states publicly, what we infer could be valuable, and what
          must be validated with DLF before anyone treats it as true.
        </p>
      </header>

      <div className="fact-panel">
        <h3>
          <Database size={16} aria-hidden="true" /> What DLF publicly states
        </h3>
        <div className="fact-grid">
          {dlfPublicFacts.map((fact) => (
            <article key={fact.id}>
              <strong>{fact.figure}</strong>
              <p>{fact.claim}</p>
              <small>{fact.period}</small>
              <a href={fact.sourceUrl} target="_blank" rel="noreferrer noopener">
                {fact.source} <ExternalLink size={11} aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
        <p className="fine-print">
          Figures are as reported in the cited public sources and are not independently verified by TerraSignal. We hold
          no DLF internal data of any kind.
        </p>
      </div>

      <div className="opportunity-panel">
        <h3>
          <TrendingUp size={16} aria-hidden="true" /> Where we infer the platform could help
        </h3>
        {inferredOpportunities.map((opportunity) => {
          const open = openId === opportunity.id;
          return (
            <article className={open ? "opportunity open" : "opportunity"} key={opportunity.id}>
              <button type="button" onClick={() => setOpenId(open ? "" : opportunity.id)}>
                <span className="opportunity-segment">{opportunity.segment}</span>
                <strong>{opportunity.platformCapability.split(":")[0]}</strong>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              {open && (
                <div className="opportunity-body">
                  <div className="opportunity-row public">
                    <span>DLF states publicly</span>
                    <p>{opportunity.publicSignal}</p>
                  </div>
                  <div className="opportunity-row inferred">
                    <span>We infer</span>
                    <p>{opportunity.inference}</p>
                  </div>
                  <div className="opportunity-row capability">
                    <span>Platform capability</span>
                    <p>{opportunity.platformCapability}</p>
                  </div>
                  <div className="opportunity-row validate">
                    <span>Must be validated with DLF</span>
                    <p>{opportunity.mustValidate}</p>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RoiSimulator() {
  const [inputs, setInputs] = useState<ValueModelInputs>(defaultInputs);
  const [scenario, setScenario] = useState<ValueScenario | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showWorkings, setShowWorkings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBusy(true);
      runValueScenario(inputs)
        .then((response) => {
          if (!cancelled) {
            setScenario(response.scenario);
            setError("");
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Scenario model unavailable");
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputs]);

  const fields: Array<{ key: keyof ValueModelInputs; label: string; min: number; max: number; step: number; suffix?: string }> = [
    { key: "sitesEvaluatedPerYear", label: "Sites evaluated per year", min: 1, max: 300, step: 1 },
    { key: "acquisitionsPerYear", label: "Acquisitions per year", min: 0, max: 50, step: 1 },
    { key: "averageSiteValueCr", label: "Average site value", min: 10, max: 3000, step: 10, suffix: " cr" },
    { key: "screeningHoursPerSiteToday", label: "Screening hours per site today", min: 0, max: 120, step: 1 },
    { key: "screeningHoursPerSiteWithPlatform", label: "Screening hours per site with platform", min: 0, max: 120, step: 1 },
    { key: "blendedAnalystCostPerHour", label: "Blended analyst cost per hour", min: 0, max: 20000, step: 100 },
    { key: "probabilityOfCostlyConstraintPerAcquisition", label: "P(costly constraint per acquisition)", min: 0, max: 1, step: 0.01 },
    { key: "probabilityPlatformSurfacesConstraintEarly", label: "P(platform surfaces it early)", min: 0, max: 1, step: 0.01 },
    { key: "costOfLateConstraintDiscoveryPercent", label: "Cost of late discovery", min: 0, max: 30, step: 0.5, suffix: "% of site value" },
    { key: "weeksSavedPerAcquisition", label: "Weeks saved per acquisition", min: 0, max: 26, step: 1 },
    { key: "costOfCapitalPercent", label: "Cost of capital", min: 0, max: 25, step: 0.5, suffix: "%" },
  ];

  return (
    <section className="pitch-section" id="pitch-roi">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 05</span>
        <h2>Scenario model</h2>
        <p>
          Move any input and the arithmetic updates. Every number below comes from your assumptions, computed by the
          same endpoint the product uses. Nothing is looked up, and nothing is attributed to DLF.
        </p>
      </header>

      <div className="roi-banner">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          This is an <strong>illustrative scenario calculator</strong>, not a prediction, forecast, guarantee or
          commitment. It has no independent evidence behind it. The default values are placeholders chosen to show the
          shape of the model, not estimates of DLF&apos;s operations.
        </span>
      </div>

      <div className="roi-grid">
        <div className="roi-controls">
          {fields.map((field) => (
            <label key={field.key}>
              <span>
                {field.label}
                <em>
                  {field.step < 1 ? Number(inputs[field.key]).toFixed(2) : inputs[field.key]}
                  {field.suffix || ""}
                </em>
              </span>
              <input
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={inputs[field.key]}
                onChange={(event) => setInputs({ ...inputs, [field.key]: Number(event.target.value) })}
              />
            </label>
          ))}
          <button className="ghost-action" type="button" onClick={() => setInputs(defaultInputs)}>
            Reset inputs
          </button>
        </div>

        <div className="roi-output">
          {error && <div className="error-box">{error}</div>}
          {scenario && (
            <>
              <div className="roi-headline">
                <span>Illustrative potential annual value</span>
                <strong>
                  {busy && <Loader2 className="spin" size={18} aria-hidden="true" />}
                  Rs {scenario.totalIllustrativeAnnualValueCr.toLocaleString("en-IN")} cr
                </strong>
                <small>
                  under your assumptions, across {scenario.inputs.sitesEvaluatedPerYear} sites screened and{" "}
                  {scenario.inputs.acquisitionsPerYear} acquisitions per year
                </small>
              </div>

              <div className="roi-levers">
                {scenario.levers.map((lever) => {
                  const share = scenario.totalIllustrativeAnnualValueCr
                    ? (lever.valueCr / scenario.totalIllustrativeAnnualValueCr) * 100
                    : 0;
                  return (
                    <article key={lever.id}>
                      <div className="lever-head">
                        <strong>{lever.label}</strong>
                        <span>Rs {lever.valueCr.toLocaleString("en-IN")} cr</span>
                      </div>
                      <div className="lever-bar">
                        <div style={{ width: `${Math.max(1, Math.min(100, share))}%` }} />
                      </div>
                      <p className="lever-workings">
                        <code>{lever.formula}</code>
                      </p>
                      {showWorkings && (
                        <>
                          <p className="lever-numbers">{lever.workings}</p>
                          <p className="lever-confidence">{lever.confidence}</p>
                          <p className="lever-evidence">
                            <strong>Evidence needed:</strong> {lever.evidenceNeeded}
                          </p>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>

              <button className="secondary-action" type="button" onClick={() => setShowWorkings(!showWorkings)}>
                <Scale size={15} aria-hidden="true" />
                {showWorkings ? "Hide" : "Show"} the full working and confidence per lever
              </button>

              <div className="roi-disclaimers">
                <h4>What this model is and is not</h4>
                <ul>
                  {scenario.disclaimers.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <h4>How to replace assumptions with measurements</h4>
                <ol>
                  {scenario.validationPlan.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function BeforeAfter() {
  return (
    <section className="pitch-section" id="pitch-shift">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 06</span>
        <h2>What changes in the workflow</h2>
      </header>
      <div className="shift-grid">
        <article className="shift before">
          <h3>Screening today</h3>
          <ul>
            {beforeAfter.before.map((item) => (
              <li key={item}>
                <XCircle size={15} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </article>
        <div className="shift-arrow">
          <ArrowRight size={22} aria-hidden="true" />
        </div>
        <article className="shift after">
          <h3>Screening with an intelligence layer</h3>
          <ul>
            {beforeAfter.after.map((item) => (
              <li key={item}>
                <CheckCircle2 size={15} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

function Different() {
  return (
    <section className="pitch-section" id="pitch-different">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 07</span>
        <h2>Why this is different</h2>
        <p>Each of these is a property of the code, verifiable in a pilot, not a marketing adjective.</p>
      </header>
      <div className="different-grid">
        {differentiators.map((item) => (
          <article key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Security() {
  const implemented = securityControls.filter((control) => control.status === "implemented");
  const notBuilt = securityControls.filter((control) => control.status !== "implemented");
  return (
    <section className="pitch-section" id="pitch-security">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 08</span>
        <h2>Enterprise security</h2>
        <p>Only controls that exist in the codebase today are listed as implemented. The rest are listed as gaps.</p>
      </header>
      <div className="security-grid">
        {implemented.map((control) => (
          <article className="security-item implemented" key={control.id}>
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <strong>{control.control}</strong>
              <p>{control.detail}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="security-gaps">
        <h3>
          <Lock size={15} aria-hidden="true" /> Not built yet, and in scope for an enterprise engagement
        </h3>
        {notBuilt.map((control) => (
          <article key={control.id}>
            <strong>{control.control}</strong>
            <p>{control.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Pilot() {
  const [form, setForm] = useState({
    organisation: "",
    contactName: "",
    contactEmail: "",
    role: "",
    useCase: "Land acquisition screening",
    message: "",
  });
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");

  const submit = async () => {
    setStatus("sending");
    setError("");
    try {
      const response = await submitPilotRequest(form);
      setAcknowledgement(response.acknowledgement);
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit the request.");
      setStatus("idle");
    }
  };

  const totalWeeks = useMemo(() => "10-15 weeks to a validated answer", []);

  return (
    <section className="pitch-section" id="pitch-pilot">
      <header className="pitch-header">
        <span className="pitch-kicker">Section 09</span>
        <h2>A pilot designed to be falsifiable</h2>
        <p>
          The point of Phase 3 is to find out whether the platform is right, including the possibility that it is not.
          {" "}
          {totalWeeks}.
        </p>
      </header>

      <div className="pilot-track">
        {pilotPhases.map((phase) => (
          <article key={phase.id}>
            <span className="pilot-phase">{phase.phase}</span>
            <h3>{phase.title}</h3>
            <em>{phase.duration}</em>
            <p>{phase.detail}</p>
            <div className="pilot-deliverable">
              <span>Deliverable</span>
              <strong>{phase.deliverable}</strong>
            </div>
          </article>
        ))}
      </div>

      <div className="cta-block" id="pitch-cta">
        <div className="cta-copy">
          <Sparkles size={20} aria-hidden="true" />
          <h2>Let&apos;s test it on a real site.</h2>
          <p>
            Pick three parcels you already know the answer to. If the platform surfaces the constraints your team found
            later by other means, the case makes itself. If it does not, you will have found that out in four weeks
            rather than after a purchase.
          </p>
        </div>
        {status === "sent" ? (
          <div className="cta-form sent">
            <CheckCircle2 size={26} aria-hidden="true" />
            <h3>Request recorded</h3>
            <p>{acknowledgement}</p>
          </div>
        ) : (
          <form
            className="cta-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label>
              <span>Organisation</span>
              <input
                required
                value={form.organisation}
                onChange={(event) => setForm({ ...form, organisation: event.target.value })}
              />
            </label>
            <label>
              <span>Your name</span>
              <input
                required
                value={form.contactName}
                onChange={(event) => setForm({ ...form, contactName: event.target.value })}
              />
            </label>
            <label>
              <span>Work email</span>
              <input
                required
                type="email"
                value={form.contactEmail}
                onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
              />
            </label>
            <label>
              <span>Role</span>
              <input
                placeholder="Head of Land / Business Development"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
              />
            </label>
            <label>
              <span>Primary use case</span>
              <select value={form.useCase} onChange={(event) => setForm({ ...form, useCase: event.target.value })}>
                <option>Land acquisition screening</option>
                <option>Portfolio prioritisation</option>
                <option>New-geography evaluation</option>
                <option>Site feasibility and capacity</option>
                <option>Risk and due-diligence scoping</option>
              </select>
            </label>
            <label className="full">
              <span>Anything specific you want tested</span>
              <textarea
                rows={3}
                value={form.message}
                onChange={(event) => setForm({ ...form, message: event.target.value })}
                placeholder="e.g. three parcels in a new market where we want the terrain and drainage picture before committing"
              />
            </label>
            {error && <div className="error-box full">{error}</div>}
            <button className="primary-action full" type="submit" disabled={status === "sending"}>
              {status === "sending" ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
              Request a pilot
            </button>
          </form>
        )}
      </div>

      <p className="pitch-footer-note">
        TerraSignal provides preliminary site intelligence and screening-level indicators. It is not a certified
        geotechnical, environmental, structural, legal, surveying, planning or engineering report, and it does not
        replace boreholes, soil testing, cadastral survey, title review, environmental assessment, or any statutory
        approval. Results must be verified by qualified professionals before any purchase, design, financing,
        construction or legal decision.
      </p>
    </section>
  );
}
