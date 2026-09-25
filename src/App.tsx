import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  FileText,
  Gauge,
  Layers,
  LineChart,
  Lock,
  LogOut,
  MapPin,
  Radar,
  RefreshCw,
  Presentation,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import {
  createLandScan,
  deleteLandScan,
  exportScanPdf,
  getAdminMetrics,
  getAdminScans,
  getAdminUsers,
  getLandScan,
  getSampleReport,
  getSampleReports,
  listLandScans,
  login,
  profile,
  register,
} from "./productApi";
import { defaultScanInput, intendedUses, reportDepths, saferLanguage, targetSegments } from "./productData";
import type { PremiumGeoExperienceProps } from "./PremiumGeoExperience";
import type {
  AuthUser,
  BoundaryPoint,
  ExplainableLandScan,
  LandScanDetail,
  LandScanSummary,
  ProfessionalReport,
  SampleReportSummary,
  ScanInput,
} from "./productTypes";
import { parseSiteCoordinateInput } from "./utils/coordinates";
import { CapacityPanel } from "./features/enterprise/CapacityPanel";
import { PortfolioWorkspace } from "./features/enterprise/PortfolioWorkspace";

type View =
  | "landing"
  | "login"
  | "register"
  | "dashboard"
  | "scan"
  | "report"
  | "samples"
  | "admin"
  | "portfolio"
  | "pitch";

const tokenKey = "terrasignal-token";
const salesEmail = import.meta.env.VITE_SALES_EMAIL ?? "sales@terrasignal.local";
// The pitch bundles the captured demo dataset, so it is split out of the
// main chunk and only fetched when a visitor opens it.
const DlfPitch = lazy(async () => {
  const module = await import("./pitch/DlfPitch");
  return { default: module.DlfPitch };
});
const PremiumGeoExperience = lazy(async () => {
  const module = await import("./PremiumGeoExperience");
  return { default: module.PremiumGeoExperience };
});
const platformDisclaimer =
  "Preliminary decision-support only. TerraSignal is not a certified geotechnical, environmental, structural, legal, surveying, planning, or engineering report and must be verified by qualified professionals before purchase, design, financing, construction, safety, or legal decisions.";
const mockDataNotice = "Demo output using mocked screening indicators, not live authoritative datasets.";

function GeoExperience(props: PremiumGeoExperienceProps) {
  return (
    <Suspense fallback={<div className="geo-loading-skeleton">Loading Cesium Earth...</div>}>
      <PremiumGeoExperience {...props} />
    </Suspense>
  );
}

const riskClass = (label?: string) => String(label || "Low").toLowerCase();
const isMockScan = (scan: { dataMode?: string }) => scan.dataMode === "mock";
const readinessLabel = (value?: string) =>
  ({
    internalDemo: "Internal demo",
    unavailable: "Unavailable",
    clientPreview: "Client preview",
    clientDeliverableEligible: "Client-deliverable eligible",
  })[String(value || "")] || String(value || "Internal review");
const canExportClientPdf = (scan: ExplainableLandScan) =>
  (scan.reportReadiness === "clientPreview" || scan.reportReadiness === "clientDeliverableEligible") &&
  scan.dataMode !== "mock" &&
  scan.dataMode !== "unavailable";

const detailFromResult = (scan: ExplainableLandScan, report: ProfessionalReport): LandScanDetail => ({
  id: scan.scanId,
  status: scan.status,
  createdAt: scan.createdAt,
  location: scan.location,
  intendedUse: scan.intendedUse,
  reportDepth: scan.reportDepth,
  overallRiskScore: scan.overallRiskScore,
  overallSuitabilityScore: scan.overallSuitabilityScore,
  confidence: scan.confidence,
  dataMode: scan.dataMode,
  deliverableStatus: scan.deliverableStatus,
  reportReadiness: scan.reportReadiness,
  reportLabel: scan.reportLabel,
  clientReadyDeliverable: scan.clientReadyDeliverable,
  mockDataNotice: scan.mockDataNotice,
  riskBand: scan.riskBands.label,
  redFlagCount: scan.redFlags.length,
  reportAvailable: true,
  scan,
  report,
});

function App() {
  const [view, setView] = useState<View>("landing");
  const [token, setToken] = useState(() => window.localStorage.getItem(tokenKey) || "");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [notice, setNotice] = useState("Ready for internal pilot scans");
  const [scans, setScans] = useState<LandScanSummary[]>([]);
  const [activeReport, setActiveReport] = useState<LandScanDetail | null>(null);
  const [samples, setSamples] = useState<SampleReportSummary[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    profile(token)
      .then((response) => {
        setUser(response.user);
        setView((current) => (current === "landing" || current === "login" || current === "register" ? "dashboard" : current));
      })
      .catch(() => {
        window.localStorage.removeItem(tokenKey);
        setToken("");
        setUser(null);
      });
  }, [token]);

  const refreshScans = useCallback(async () => {
    if (!token) return;
    const response = await listLandScans(token);
    setScans(response.scans);
  }, [token]);

  useEffect(() => {
    if (token && (view === "dashboard" || view === "portfolio")) {
      const id = window.setTimeout(() => {
        void refreshScans().catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load scans"));
      }, 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [refreshScans, token, view]);

  const saveAuth = (nextToken: string, nextUser: AuthUser) => {
    window.localStorage.setItem(tokenKey, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setView("dashboard");
    setNotice(`Signed in as ${nextUser.email}`);
  };

  const logout = () => {
    window.localStorage.removeItem(tokenKey);
    setToken("");
    setUser(null);
    setScans([]);
    setActiveReport(null);
    setView("landing");
  };

  const openScan = async (scanId: string) => {
    if (!token) return;
    setIsBusy(true);
    try {
      const response = await getLandScan(token, scanId);
      setActiveReport(response.scan);
      setView("report");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to open scan");
    } finally {
      setIsBusy(false);
    }
  };

  const removeScan = async (scanId: string) => {
    if (!token) return;
    await deleteLandScan(token, scanId);
    await refreshScans();
    setNotice("Scan deleted");
  };

  const loadSamples = async () => {
    const response = await getSampleReports();
    setSamples(response.reports);
    setView("samples");
  };

  return (
    <div className="app-shell">
      <TopNav
        user={user}
        view={view}
        onAdmin={() => setView("admin")}
        onDashboard={() => setView(user ? "dashboard" : "landing")}
        onLogin={() => setView("login")}
        onLogout={logout}
        onPitch={() => setView("pitch")}
        onPortfolio={() => setView(user ? "portfolio" : "register")}
        onSamples={() => void loadSamples()}
        onScan={() => setView(user ? "scan" : "register")}
      />
      <main>
        {view === "landing" && <Landing onSamples={() => void loadSamples()} onStart={() => setView(token ? "scan" : "register")} />}
        {view === "login" && <AuthView mode="login" onAlt={() => setView("register")} onSubmit={saveAuth} />}
        {view === "register" && <AuthView mode="register" onAlt={() => setView("login")} onSubmit={saveAuth} />}
        {view === "dashboard" && user && (
          <Dashboard
            isBusy={isBusy}
            onDelete={(id) => void removeScan(id)}
            onNewScan={() => setView("scan")}
            onOpen={openScan}
            onRefresh={() => void refreshScans()}
            scans={scans}
            user={user}
          />
        )}
        {view === "scan" && (
          <ScanFlow
            isSignedIn={Boolean(user && token)}
            onComplete={(scan, report) => {
              setActiveReport(detailFromResult(scan, report));
              setView("report");
              void refreshScans();
            }}
            onRequireAuth={() => setView("register")}
            setNotice={setNotice}
            token={token}
          />
        )}
        {view === "report" && activeReport && (
          <ReportPage detail={activeReport} isSample={!activeReport.scan.userId || activeReport.scan.userId === "demo"} token={token} />
        )}
        {view === "samples" && (
          <SampleReports
            onOpen={async (id) => {
              const response = await getSampleReport(id);
              setActiveReport(detailFromResult(response.report.scan, response.report.report));
              setView("report");
            }}
            onRefresh={loadSamples}
            samples={samples}
          />
        )}
        {view === "portfolio" && user && token && (
          <PortfolioWorkspace
            onOpenScan={(scanId) => void openScan(scanId)}
            scans={scans}
            setNotice={setNotice}
            token={token}
          />
        )}
        {view === "portfolio" && !user && (
          <EmptyState title="Sign in to compare sites" text="Portfolio ranking works across the land scans saved to your account." />
        )}
        {view === "pitch" && (
          <Suspense fallback={<div className="geo-loading-skeleton">Loading enterprise overview...</div>}>
            <DlfPitch onRunScan={() => setView(token ? "scan" : "register")} />
          </Suspense>
        )}
        {view === "admin" && user?.role === "admin" && token && <AdminPanel token={token} />}
        {view === "admin" && user?.role !== "admin" && <EmptyState title="Admin access required" text="Use an admin account to view users, scans, metrics, and pilot logs." />}
      </main>
      <div className="status-bar">
        <span>{notice}</span>
        <strong>{platformDisclaimer}</strong>
      </div>
    </div>
  );
}

function TopNav({
  onAdmin,
  onDashboard,
  onLogin,
  onLogout,
  onPitch,
  onPortfolio,
  onSamples,
  onScan,
  user,
  view,
}: {
  onAdmin: () => void;
  onDashboard: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onPitch: () => void;
  onPortfolio: () => void;
  onSamples: () => void;
  onScan: () => void;
  user: AuthUser | null;
  view: View;
}) {
  return (
    <header className="top-nav">
      <button className="brand" type="button" onClick={onDashboard}>
        <Radar aria-hidden="true" />
        <span>
          TerraSignal
          <small>AI-assisted land risk screening</small>
        </span>
      </button>
      <nav>
        <button className={view === "samples" ? "active" : ""} type="button" onClick={onSamples}>
          <FileText size={16} aria-hidden="true" />
          Samples
        </button>
        <button className={view === "scan" ? "active" : ""} type="button" onClick={onScan}>
          <MapPin size={16} aria-hidden="true" />
          Run Land Scan
        </button>
        <button className={view === "portfolio" ? "active" : ""} type="button" onClick={onPortfolio}>
          <LineChart size={16} aria-hidden="true" />
          Portfolio
        </button>
        <button className={view === "pitch" ? "active" : ""} type="button" onClick={onPitch}>
          <Presentation size={16} aria-hidden="true" />
          Enterprise
        </button>
        {user?.role === "admin" && (
          <button className={view === "admin" ? "active" : ""} type="button" onClick={onAdmin}>
            <ShieldCheck size={16} aria-hidden="true" />
            Admin
          </button>
        )}
      </nav>
      {user ? (
        <div className="user-chip">
          <span>{user.company}</span>
          <button type="button" onClick={onLogout} title="Logout">
            <LogOut size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="nav-auth">
          <button type="button" onClick={onLogin}>
            <Lock size={16} aria-hidden="true" />
            Sign in
          </button>
        </div>
      )}
    </header>
  );
}

function Landing({ onSamples, onStart }: { onSamples: () => void; onStart: () => void }) {
  useEffect(() => {
    const handler = () => onStart();
    window.addEventListener("open-login", handler);
    return () => window.removeEventListener("open-login", handler);
  }, [onStart]);

  return (
    <section className="landing">
      <div className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">Preliminary site intelligence for due diligence teams</span>
          <h1>Land risk screening before scoping certified due diligence.</h1>
          <p>
            Enter a site anywhere in the world, define a radius or boundary, and generate a structured
            screening report with deterministic risk scores, confidence levels, red flags, recommendations,
            and clear professional-verification disclaimers.
          </p>
          <div className="hero-actions">
            <button className="primary-action" type="button" onClick={onStart}>
              <Radar size={18} aria-hidden="true" />
              Run Land Scan
            </button>
            <button className="secondary-action" type="button" onClick={onSamples}>
              <FileText size={18} aria-hidden="true" />
              View Sample Report
            </button>
            <a className="secondary-action" href={`mailto:${salesEmail}?subject=TerraSignal%20pilot`}>
              Book Pilot
            </a>
            <a className="ghost-action" href={`mailto:${salesEmail}?subject=TerraSignal%20sales`}>
              Contact Sales
            </a>
          </div>
          <p className="fine-print">{platformDisclaimer}</p>
        </div>
        <GeoExperience title="TerraSignal Earth" />
      </div>
      <div className="segment-strip">
        {targetSegments.map((segment) => (
          <span key={segment}>{segment}</span>
        ))}
      </div>
      <section className="positioning-grid">
        <article>
          <Gauge />
          <strong>Deterministic scoring</strong>
          <p>Risk numbers come from transparent weighted logic. AI explains the score; it does not invent measurements.</p>
        </article>
        <article>
          <FileJson />
          <strong>JSON-first reports</strong>
          <p>Every scan keeps explainable inputs, calculations, source status, confidence, and limitations for future API use.</p>
        </article>
        <article>
          <ShieldCheck />
          <strong>Careful positioning</strong>
          <p>Designed as screening-level decision support, never as a substitute for certified surveys or legal due diligence.</p>
        </article>
      </section>
      <div className="language-guardrail">
        {saferLanguage.map((phrase) => (
          <span key={phrase}>{phrase}</span>
        ))}
      </div>
    </section>
  );
}

function AuthView({
  mode,
  onAlt,
  onSubmit,
}: {
  mode: "login" | "register";
  onAlt: () => void;
  onSubmit: (token: string, user: AuthUser) => void;
}) {
  const [form, setForm] = useState({ email: "", password: "", name: "", company: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const response =
        mode === "login"
          ? await login({ email: form.email, password: form.password })
          : await register(form);
      onSubmit(response.token, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-card">
      <div>
        <span className="eyebrow">{mode === "login" ? "Welcome back" : "Create pilot workspace"}</span>
        <h1>{mode === "login" ? "Sign in to TerraSignal" : "Start internal land-scan testing"}</h1>
        <p>Access is protected for internal testing and design-partner review.</p>
      </div>
      {mode === "register" && (
        <>
          <label>
            Name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Company
            <input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} />
          </label>
        </>
      )}
      <label>
        Work email
        <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
        {mode === "register" && <small className="field-help">Use 12+ characters with uppercase, lowercase, number, and symbol.</small>}
      </label>
      {error && <div className="error-box">{error}</div>}
      <button className="primary-action wide" type="button" onClick={submit} disabled={busy}>
        <Lock size={17} aria-hidden="true" />
        {busy ? "Please wait" : mode === "login" ? "Login" : "Register"}
      </button>
      <button className="link-button" type="button" onClick={onAlt}>
        {mode === "login" ? "Create a pilot account" : "Already have an account?"}
      </button>
    </section>
  );
}

function Dashboard({
  isBusy,
  onDelete,
  onNewScan,
  onOpen,
  onRefresh,
  scans,
  user,
}: {
  isBusy: boolean;
  onDelete: (id: string) => void;
  onNewScan: () => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  scans: LandScanSummary[];
  user: AuthUser;
}) {
  const stats = useMemo(
    () => ({
      total: scans.length,
      high: scans.filter((scan) => scan.riskBand === "High").length,
      average: scans.length ? Math.round(scans.reduce((sum, scan) => sum + scan.overallRiskScore, 0) / scans.length) : 0,
    }),
    [scans],
  );

  return (
    <section className="dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{user.plan} workspace</span>
          <h1>Land Intelligence Dashboard</h1>
          <p>Run new scans, review previous reports, export PDFs, and inspect raw explainable JSON.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-action" type="button" onClick={onRefresh}>
            <RefreshCw size={17} aria-hidden="true" />
            Refresh
          </button>
          <button className="primary-action" type="button" onClick={onNewScan}>
            <Radar size={17} aria-hidden="true" />
            New Scan
          </button>
        </div>
      </div>
      <div className="metric-grid">
        <Metric icon={Database} label="Previous scans" value={stats.total} />
        <Metric icon={AlertTriangle} label="High-risk scans" value={stats.high} />
        <Metric icon={Gauge} label="Average risk" value={`${stats.average}/100`} />
      </div>
      <GeoExperience
        compact
        scan={undefined}
        title={scans.length ? "Portfolio Earth View" : "Global scan console"}
      />
      <section className="panel">
        <div className="panel-title">
          <h2>Previous scans</h2>
          <span>Status, location, score, report, JSON, PDF, delete</span>
        </div>
        {!scans.length && <EmptyState title="No scans yet" text="Run a land scan to create your first report." />}
        {isBusy && <div className="loading-row">Opening report...</div>}
        <div className="scan-list">
          {scans.map((scan) => (
            <article className="scan-row" key={scan.id}>
              <div>
                <span className={`risk-badge ${riskClass(scan.riskBand)}`}>{scan.riskBand}</span>
                {isMockScan(scan) && <MockDataBadge />}
                <strong>{scan.location.address || `${scan.location.lat.toFixed(5)}, ${scan.location.lng.toFixed(5)}`}</strong>
                <small>
                  {scan.intendedUse} | {scan.reportDepth} | {new Date(scan.createdAt).toLocaleString()}
                </small>
                {!scan.clientReadyDeliverable && <small>{readinessLabel(scan.reportReadiness || scan.deliverableStatus)}</small>}
              </div>
              <div className="row-score">
                <b>{scan.overallRiskScore}</b>
                <small>{Math.round(scan.confidence * 100)}% confidence</small>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => onOpen(scan.id)}>
                  <FileText size={16} aria-hidden="true" />
                  Report
                </button>
                <button type="button" onClick={() => onDelete(scan.id)} title="Delete scan">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function ScanFlow({
  isSignedIn,
  onComplete,
  onRequireAuth,
  setNotice,
  token,
}: {
  isSignedIn: boolean;
  onComplete: (scan: ExplainableLandScan, report: ProfessionalReport) => void;
  onRequireAuth: () => void;
  setNotice: (message: string) => void;
  token: string;
}) {
  const [form, setForm] = useState<ScanInput>(defaultScanInput);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const updateCoordinate = (value: string) => {
    const parsed = parseSiteCoordinateInput(value);
    setForm((current) => ({
      ...current,
      coordinateInput: value,
      ...(parsed.ok
        ? {
            latitude: Number(parsed.coordinate.latitude.toFixed(7)),
            longitude: Number(parsed.coordinate.longitude.toFixed(7)),
          }
        : {}),
    }));
  };

  const submit = async () => {
    if (!isSignedIn) {
      onRequireAuth();
      return;
    }
    setBusy(true);
    setError("");
    setNotice("Running deterministic geospatial screening and report generation...");
    try {
      const response = await createLandScan(token, form);
      onComplete(response.scan, response.report);
      setNotice("Land intelligence report ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setNotice("Scan failed; review validation messages");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="scan-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Site scan input flow</span>
          <h1>Run a preliminary land risk screen</h1>
          <p>Label an address, paste decimal/DMS coordinates, set a radius, and optionally sketch an approximate boundary.</p>
          <p className="fine-print">{platformDisclaimer}</p>
        </div>
      </div>
      <div className="scan-grid">
        <section className="panel form-panel">
          <div className="callout caution">
            Scans currently use demo/mock screening adapters unless live providers are configured. Results are internal testing only and not client-ready deliverables.
          </div>
          <label>
            <span>Address/location label</span>
            <div className="input-with-icon">
              <Search size={17} aria-hidden="true" />
              <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </div>
          </label>
          <label>
            <span>Coordinates</span>
            <input
              value={form.coordinateInput}
              onChange={(event) => updateCoordinate(event.target.value)}
              placeholder={`28.4595, 77.0266 or 19°12'44.7"N 73°08'39.3"E`}
            />
          </label>
          <div className="field-grid">
            <label>
              <span>Latitude</span>
              <input
                type="number"
                value={form.latitude}
                onChange={(event) => setForm({ ...form, latitude: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Longitude</span>
              <input
                type="number"
                value={form.longitude}
                onChange={(event) => setForm({ ...form, longitude: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Radius (m)</span>
              <input
                min={25}
                max={100000}
                type="number"
                value={form.radiusMeters}
                onChange={(event) => setForm({ ...form, radiusMeters: Number(event.target.value) })}
              />
            </label>
          </div>
          <div className="field-grid">
            <label>
              <span>Intended development type</span>
              <select
                value={form.intendedUse}
                onChange={(event) => setForm({ ...form, intendedUse: event.target.value as ScanInput["intendedUse"] })}
              >
                {intendedUses.map((use) => (
                  <option key={use.value} value={use.value}>
                    {use.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Report depth</span>
              <select
                value={form.reportDepth}
                onChange={(event) => setForm({ ...form, reportDepth: event.target.value as ScanInput["reportDepth"] })}
              >
                {reportDepths.map((depth) => (
                  <option key={depth.value} value={depth.value}>
                    {depth.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Scan mode</span>
              <select
                value={form.scanMode || "live"}
                onChange={(event) => setForm({ ...form, scanMode: event.target.value as ScanInput["scanMode"] })}
              >
                <option value="live">Live provider scan only</option>
                <option value="mixed">Mixed provider scan, no mock fallback</option>
                <option value="internalDemo">Internal demo with mock watermark</option>
              </select>
            </label>
          </div>
          <div className="depth-options">
            {reportDepths.map((depth) => (
              <button
                className={form.reportDepth === depth.value ? "selected" : ""}
                key={depth.value}
                type="button"
                onClick={() => setForm({ ...form, reportDepth: depth.value })}
              >
                <strong>{depth.label}</strong>
                <span>{depth.detail}</span>
              </button>
            ))}
          </div>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-action wide" type="button" onClick={submit} disabled={busy}>
            <Radar size={17} aria-hidden="true" />
            {busy ? "Scanning..." : "Run Land Scan"}
          </button>
        </section>
        <section className="panel map-panel">
          <div className="panel-title">
            <h2>3D region scanner</h2>
            <span>Cesium globe fly-in, satellite basemap, terrain, contours, drainage, and access layers</span>
          </div>
          <GeoExperience compact input={form} isScanning={busy} title="Scan target" />
          <div className="panel-title compact-title">
            <h2>Approximate boundary sketch</h2>
            <span>Click sketch to add optional polygon points</span>
          </div>
          <BoundarySketch form={form} onChange={(boundary) => setForm({ ...form, boundary })} />
          <div className="boundary-tools">
            <button type="button" onClick={() => setForm({ ...form, boundary: [] })}>
              Clear polygon
            </button>
            <span>{form.boundary.length} boundary point(s)</span>
          </div>
        </section>
      </div>
    </section>
  );
}

function BoundarySketch({ form, onChange }: { form: ScanInput; onChange: (boundary: BoundaryPoint[]) => void }) {
  const centerLat = Number(form.latitude || 0);
  const centerLng = Number(form.longitude || 0);
  const radiusDegrees = Math.max(0.002, form.radiusMeters / 111_320);

  const addPoint = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const lat = centerLat + (0.5 - y) * radiusDegrees * 2.4;
    const lng = centerLng + (x - 0.5) * radiusDegrees * 2.4;
    onChange([...form.boundary, { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) }].slice(-24));
  };

  const points = form.boundary
    .map((point) => {
      const x = 50 + ((point.lng - centerLng) / (radiusDegrees * 2.4)) * 100;
      const y = 50 - ((point.lat - centerLat) / (radiusDegrees * 2.4)) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="boundary-map" viewBox="0 0 100 100" role="img" aria-label="Simple boundary sketch map" onClick={addPoint}>
      <defs>
        <linearGradient id="land" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#dfeee8" />
          <stop offset="50%" stopColor="#d1e0d9" />
          <stop offset="100%" stopColor="#b8ccc8" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="3" fill="url(#land)" />
      <path d="M0 68 C20 55 34 76 52 60 C70 43 83 55 100 42" fill="none" stroke="#7aa4a2" strokeWidth="1.2" />
      <path d="M18 0 L86 100" stroke="#f8faf8" strokeWidth="4" opacity="0.75" />
      <path d="M0 31 L100 23" stroke="#f8faf8" strokeWidth="2.4" opacity="0.65" />
      <circle cx="50" cy="50" r="26" fill="rgba(24, 94, 83, 0.1)" stroke="#185e53" strokeWidth="0.9" />
      {points && <polygon points={points} fill="rgba(245, 158, 11, 0.22)" stroke="#b45309" strokeWidth="1.4" />}
      {form.boundary.map((point, index) => {
        const x = 50 + ((point.lng - centerLng) / (radiusDegrees * 2.4)) * 100;
        const y = 50 - ((point.lat - centerLat) / (radiusDegrees * 2.4)) * 100;
        return <circle key={`${point.lat}-${point.lng}-${index}`} cx={x} cy={y} r="1.8" fill="#111827" />;
      })}
      <circle cx="50" cy="50" r="2.4" fill="#0f766e" stroke="#fff" strokeWidth="1" />
      <text x="50" y="58" textAnchor="middle">
        site center
      </text>
    </svg>
  );
}

function ReportPage({ detail, isSample, token }: { detail: LandScanDetail; isSample: boolean; token: string }) {
  const { scan, report } = detail;
  const [pdfError, setPdfError] = useState("");
  const ai = report.aiAnalysis;

  const exportPdf = async () => {
    if (isSample || !token) {
      window.print();
      return;
    }
    try {
      const blob = await exportScanPdf(token, scan.scanId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `land-scan-${scan.scanId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "PDF export failed");
    }
  };

  return (
    <section className="report-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{isSample ? "Demo/sample report" : "Completed land scan"}</span>
          <h1>{scan.location.address || "Preliminary Site Intelligence Report"}</h1>
          <p>
            {scan.location.lat.toFixed(6)}, {scan.location.lng.toFixed(6)} | {scan.location.radiusMeters} m radius
          </p>
          <div className="badge-row">
            {isMockScan(scan) && <MockDataBadge />}
            <span className="deliverable-badge">{readinessLabel(scan.reportReadiness || scan.deliverableStatus)}</span>
            <span className="deliverable-badge">{scan.reportLabel}</span>
          </div>
        </div>
        <button className="primary-action" type="button" onClick={exportPdf} disabled={!canExportClientPdf(scan)}>
          <Download size={17} aria-hidden="true" />
          {canExportClientPdf(scan) ? "Export PDF" : "Client PDF blocked"}
        </button>
      </div>
      {pdfError && <div className="error-box">{pdfError}</div>}
      {isMockScan(scan) && (
        <div className="callout danger">
          <strong>DEMO / MOCK DATA.</strong> {mockDataNotice} This report is internal testing only and must not be presented as a client-ready deliverable.
        </div>
      )}
      <div className="report-grid">
        <section className="panel score-panel">
          <GeoExperience compact scan={scan} title="Report map intelligence" />
          <div className={`risk-score ${riskClass(scan.riskBands.label)}`}>
            <small>Overall risk score</small>
            <strong>{scan.overallRiskScore}/100</strong>
            <span>{scan.riskBands.label} risk band</span>
          </div>
          <div className="score-pair">
            <Metric icon={CheckCircle2} label="Preliminary suitability indicator" value={`${scan.overallSuitabilityScore}/100`} />
            <Metric icon={ShieldCheck} label="Confidence" value={`${Math.round(scan.confidence * 100)}%`} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">
            <h2>Executive summary</h2>
            <span>{report.mode} narrative</span>
          </div>
          <p className="summary-text">{report.executiveSummary}</p>
          <div className="callout caution">
            {scan.disclaimer}
          </div>
        </section>
      </div>
      <section className="panel data-availability-panel">
        <div className="panel-title">
          <h2>Data availability risk</h2>
          <span>Visible confidence factor</span>
        </div>
        <div className="data-availability-grid">
          <Metric icon={Database} label="Data mode" value={scan.dataMode.toUpperCase()} />
          <Metric icon={AlertTriangle} label="Availability risk" value={`${scan.dataAvailabilitySummary.score}/100`} />
          <Metric icon={ShieldCheck} label="Provider availability" value={`${scan.dataAvailabilitySummary.providerAvailabilityScore}/100`} />
        </div>
        {(scan.dataAvailabilitySummary.warning || scan.lowConfidenceWarnings.length > 0) && (
          <div className="callout caution">
            {[scan.dataAvailabilitySummary.warning, ...scan.lowConfidenceWarnings].filter(Boolean).join(" ")}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Provider/source table</h2>
          <span>Data behind this score</span>
        </div>
        <div className="source-table">
          {(scan.sourceTable || scan.dataSources || []).map((source) => (
            <article key={source.id}>
              <strong>{source.providerName}</strong>
              <span>{source.sourceType} | {source.dataMode} | {Math.round(source.confidence * 100)}% confidence</span>
              <small>Coverage: {source.regionCoverage || source.coverage}</small>
              <small>Citation: {source.citation || source.citationUrl || "not configured"}</small>
              <small>Attribution: {source.attribution || "not configured"}</small>
              <p>{source.limitations}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel explain-score-panel">
        <div className="panel-title">
          <h2>Explain this score</h2>
          <span>Formula, raw inputs, weight, confidence, source, and impact</span>
        </div>
        <div className="explain-table">
          {Object.entries(scan.scoreExplainability || {}).map(([key, item]) => (
            <article key={key}>
              <strong>{key.replace(/([A-Z])/g, " $1")}</strong>
              <span>Effect {item.finalScoreEffect} pts | weight {item.weight} | confidence {Math.round(item.confidence * 100)}%</span>
              <p>{item.explanation}</p>
              <small>Formula: {item.formula}</small>
              <small>Inputs: {JSON.stringify(item.rawInputs)}</small>
              <small>Source: {item.sourceProvider}</small>
              <small>Limitation: {item.limitation}</small>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Score breakdown</h2>
          <span>Inputs, weights, confidence, calculation, source, limitation</span>
        </div>
        <div className="subscore-grid">
          {Object.values(scan.subScores).map((score) => (
            <article className="subscore-card" key={score.id}>
              <div>
                <strong>{score.id.replace(/([A-Z])/g, " $1")}</strong>
                <span>{Math.round(score.confidence * 100)}% confidence</span>
              </div>
              <b>{score.score}/100</b>
              <p>{score.explanation}</p>
              <small>Weight {score.weight}. Calculation: {score.calculation}</small>
              <small>Source: {score.dataSource}</small>
              <small>Limitation: {Array.isArray(score.limitations) ? score.limitations.join(" ") : score.limitations}</small>
            </article>
          ))}
        </div>
      </section>
      <div className="two-column">
        <ListPanel title="Red flags" items={scan.redFlags} empty="No dominant red flags." />
        <ListPanel title="Recommended next steps" items={scan.recommendedNextSteps} empty="No recommendations generated." />
      </div>
      {!isSample && token && <CapacityPanel scanId={scan.scanId} token={token} />}
      <section className="panel narrative-panel">
        <div className="panel-title">
          <h2>Professional narrative</h2>
          <span>Careful B2B report language</span>
        </div>
        {report.sections.map((section) => (
          <article key={section.title}>
            <h3>{section.title}</h3>
            <p>{section.body}</p>
          </article>
        ))}
      </section>
      {ai && (
        <section className="panel narrative-panel ai-panel">
          <div className="panel-title">
            <h2>Gemini Analysis</h2>
            <span>{ai.aiStatus || report.mode}</span>
          </div>
          <article>
            <h3>Executive summary</h3>
            <p>{ai.executiveSummary || "Gemini analysis is unavailable for this run."}</p>
          </article>
          <article>
            <h3>Score reasoning</h3>
            <p>{ai.scoreReasoning?.overallRisk || ai.detailedScoreReasoning || "Score reasoning was not returned."}</p>
          </article>
          <article>
            <h3>Data quality assessment</h3>
            <p>{ai.dataQualityAssessment || ai.confidenceExplanation || "Data quality assessment was not returned."}</p>
          </article>
          <article>
            <h3>Missing data impact</h3>
            <p>{ai.scoreReasoning?.missingDataImpact || (scan.unavailableScores || []).join(", ") || "No missing-data commentary returned."}</p>
          </article>
          <article>
            <h3>Professional verification checklist</h3>
            <ul>
              {(ai.professionalVerificationChecklist || ai.recommendedCertifiedFollowUpChecks || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article>
            <h3>Recommended next steps</h3>
            <ul>
              {(ai.recommendedNextSteps || scan.recommendedNextSteps).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </section>
      )}
      <details className="panel raw-json">
        <summary>
          <FileJson size={18} aria-hidden="true" />
          Raw explainable JSON
        </summary>
        <pre>{JSON.stringify({ scan, aiAnalysis: ai }, null, 2)}</pre>
      </details>
    </section>
  );
}

function SampleReports({
  onOpen,
  onRefresh,
  samples,
}: {
  onOpen: (id: string) => void;
  onRefresh: () => void;
  samples: SampleReportSummary[];
}) {
  useEffect(() => {
    if (!samples.length) void onRefresh();
  }, [onRefresh, samples.length]);

  return (
    <section className="dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Clearly marked demos</span>
          <h1>Sample reports</h1>
          <p>UK residential, US warehouse, India urban development, and UAE commercial examples.</p>
        </div>
      </div>
      <div className="sample-grid">
        {samples.map((sample) => (
          <article className="panel sample-card" key={sample.id}>
            <span className="risk-badge moderate">Demo/sample</span>
            {sample.dataMode === "mock" && <MockDataBadge />}
            <h2>{sample.title}</h2>
            <p>{sample.market} market demonstration. Not a real client scan.</p>
            <div className="sample-meta">
              <span>{sample.overallRiskScore}/100 risk</span>
              <span>{sample.riskBand}</span>
              <span>{Math.round(sample.confidence * 100)}% confidence</span>
              <span>{readinessLabel(sample.reportReadiness || sample.deliverableStatus)}</span>
            </div>
            <button className="secondary-action wide" type="button" onClick={() => onOpen(sample.id)}>
              <FileText size={17} aria-hidden="true" />
              Open Sample Report
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminPanel({ token }: { token: string }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [scans, setScans] = useState<LandScanSummary[]>([]);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getAdminMetrics>>["metrics"] | null>(null);

  useEffect(() => {
    const load = async () => {
      const [userResponse, scanResponse, metricResponse] = await Promise.all([
        getAdminUsers(token),
        getAdminScans(token),
        getAdminMetrics(token),
      ]);
      setUsers(userResponse.users);
      setScans(scanResponse.scans);
      setMetrics(metricResponse.metrics);
    };
    void load();
  }, [token]);

  return (
    <section className="dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Admin console</span>
          <h1>Users, scans, locations, and pilot readiness</h1>
        </div>
      </div>
      <div className="metric-grid">
        <Metric icon={Users} label="Users" value={metrics?.userCount ?? users.length} />
        <Metric icon={Radar} label="Scans" value={metrics?.scanCount ?? scans.length} />
        <Metric icon={AlertTriangle} label="High risk" value={metrics?.highRiskCount ?? 0} />
        <Metric icon={BarChart3} label="Avg risk" value={`${metrics?.averageRiskScore ?? 0}/100`} />
      </div>
      <div className="two-column">
        <section className="panel">
          <div className="panel-title">
            <h2>Users</h2>
            <span>Basic roles</span>
          </div>
          {users.map((item) => (
            <div className="admin-row" key={item.id}>
              <strong>{item.email}</strong>
              <span>{item.role} | {item.plan}</span>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-title">
            <h2>Most scanned locations</h2>
            <span>Rounded/labelled for pilot review</span>
          </div>
          {metrics?.mostScannedLocations.length ? (
            metrics.mostScannedLocations.map((item) => (
              <div className="admin-row" key={item.location}>
                <strong>{item.location}</strong>
                <span>{item.count} scan(s)</span>
              </div>
            ))
          ) : (
            <p>No scan locations yet.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: number | string }) {
  return (
    <article className="metric-card">
      <Icon size={19} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MockDataBadge() {
  return <span className="mock-badge">DEMO / MOCK DATA</span>;
}

function ListPanel({ empty, items, title }: { empty: string; items: string[]; title: string }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>{title}</h2>
      </div>
      {items.length ? (
        <ul className="check-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </section>
  );
}

function EmptyState({ text, title }: { text: string; title: string }) {
  return (
    <div className="empty-state">
      <Layers size={24} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export default App;
