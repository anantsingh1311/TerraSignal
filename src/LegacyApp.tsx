import {
  type ChangeEvent,
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  Download,
  FileText,
  Gauge,
  Layers,
  LineChart,
  Map,
  Microscope,
  Radar,
  RefreshCw,
  Ruler,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Users,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  analyzeSurvey,
  buildReport,
  downloadText,
  exportAnalyzedCsv,
  parseSurveyFile,
  summarizeAnalysis,
} from "./analysis";
import {
  createCoordinateRun,
  createSurveyRun,
  analyzeSiteWithBackend,
  getBootstrap,
  getReportAudit,
  getReportRawLayers,
  getReportScoring,
  getReportValidation,
  getRunArtifactUrl,
  getSurveyRun,
  listAllRuns,
  listSurveyRuns,
  type BackendMode,
  type SurveyRun,
} from "./api";
import { projects, publicLayers, sampleCsv, sourceLinks } from "./data";
import { mergeBackendSiteAnalysis } from "./features/site-intelligence/api/siteIntelligenceApi";
import { ReportPreviewPanel } from "./features/site-intelligence/components/ReportPreviewPanel";
import { buildSiteReport, exportSiteScreeningCsv, generateSiteScreening, requiredProfessionalDisclaimer } from "./siteScreening";
import {
  auditRawLayerData,
  auditScoringData,
  auditValidationData,
  buildReportAuditSnapshot,
} from "./reportAudit";
import type { SiteFormState } from "./TerraView";
import { parseCoordinateInput, parseSiteCoordinateInput } from "./utils/coordinates";
import type {
  ActiveSite,
  AnalyzedPoint,
  BuilderProject,
  GlobeLayer,
  InterpretationSettings,
  ParseWarning,
  PublicLayer,
  RiskLevel,
  SiteScreeningResult,
  SourceLink,
  SurveyMethod,
  SurveyPoint,
  TabId,
  TabItem,
} from "./types";

const TerraView = lazy(() =>
  import("./TerraView").then((module) => ({ default: module.TerraView })),
);

const tabs: TabItem[] = [
  { id: "globe", label: "Site Intelligence", icon: Radar },
  { id: "overview", label: "TerraView", icon: Map },
  { id: "report", label: "Report", icon: FileText },
  { id: "saved", label: "Saved Analyses", icon: Database },
  { id: "intake", label: "Advanced Upload", icon: Upload },
  { id: "settings", label: "Access", icon: Settings },
];

const methodLabels: Record<SurveyMethod | "HYBRID", string> = {
  HYBRID: "Hybrid",
  ERT: "ERT",
  SRT: "SRT",
  MASW: "MASW",
  MAG: "Magnetic",
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );

const riskLevelClass = (riskLevel?: RiskLevel) => (riskLevel ?? "LOW").toLowerCase();

const defaultSiteForm: SiteFormState = {
  projectName: "Gurugram Urban Parcel Intelligence Scan",
  clientName: "",
  companyName: "",
  userRole: "Real estate buyer",
  coordinateInput: `19°12'44.7"N 73°08'39.3"E`,
  latitude: "28.440402",
  longitude: "77.073830",
  radiusMeters: "500",
  intendedUse: "Residential apartment",
  constructionType: "Residential",
  buildingType: "Mid-rise apartment",
  floors: "12",
  approximatePlotArea: "",
  plotAreaUnit: "sqm",
  loadCategory: "Medium",
  purchaseStage: "Before purchase",
  reportAudience: "Land purchaser",
};

const accessCode = import.meta.env.VITE_APP_ACCESS_CODE;
const requiredDisclaimer = requiredProfessionalDisclaimer;

function App() {
  // This MVP keeps project, upload, and model settings in browser state.
  // A production SaaS backend would persist these values per account/project.
  const [accessInput, setAccessInput] = useState("");
  const [accessError, setAccessError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(() => {
    if (!accessCode) return true;
    return window.localStorage.getItem("terrasignal-access-unlocked") === "true";
  });
  const [activeTab, setActiveTab] = useState<TabId>("globe");
  const [projectList, setProjectList] = useState<BuilderProject[]>(projects);
  const [publicLayerList, setPublicLayerList] = useState(publicLayers);
  const [sourceLinkList, setSourceLinkList] = useState(sourceLinks);
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0].id);
  const [points, setPoints] = useState<SurveyPoint[]>(projects[0].points);
  const [datasetLabel, setDatasetLabel] = useState("Sample survey network");
  const [notice, setNotice] = useState("Ready for screening");
  const [backendMode, setBackendMode] = useState<BackendMode>("connecting");
  const [backendDatabase, setBackendDatabase] = useState<"sqlite" | "postgresql" | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [savedRuns, setSavedRuns] = useState<SurveyRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<ParseWarning[]>([]);
  const [activeLayer, setActiveLayer] = useState<GlobeLayer>("drainageWaterloggingRisk");
  const [activeSite, setActiveSite] = useState<ActiveSite | null>(null);
  const [siteScreening, setSiteScreening] = useState<SiteScreeningResult | null>(null);
  const [siteForm, setSiteForm] = useState<SiteFormState>(() => ({
    ...defaultSiteForm,
    coordinateInput: "28.440402, 77.073830",
  }));
  const [siteFormErrors, setSiteFormErrors] = useState<Partial<Record<keyof SiteFormState, string>>>({});
  const [isScanningSite, setIsScanningSite] = useState(false);
  const [settings, setSettings] = useState<InterpretationSettings>({
    noiseSuppression: 72,
    physicsWeight: 68,
    anomalyThreshold: 70,
    focus: "HYBRID",
  });

  const fetchSavedRunsFor = useCallback(async (projectId: string) => {
    setIsLoadingRuns(true);
    try {
      const response = await listSurveyRuns(projectId);
      setSavedRuns(response.runs);
    } catch (error) {
      setSavedRuns([]);
      setNotice(`Saved runs unavailable: ${error instanceof Error ? error.message : "API request failed"}`);
    } finally {
      setIsLoadingRuns(false);
    }
  }, []);

  const fetchAllSavedRuns = useCallback(async () => {
    if (backendMode !== "api") {
      setSavedRuns([]);
      return;
    }
    setIsLoadingRuns(true);
    try {
      const response = await listAllRuns();
      setSavedRuns(response.runs);
    } catch (error) {
      setSavedRuns([]);
      setNotice(`Saved analyses unavailable: ${error instanceof Error ? error.message : "API request failed"}`);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [backendMode]);

  useEffect(() => {
    let isMounted = true;

    getBootstrap()
      .then((bootstrap) => {
        if (!isMounted) return;
        setProjectList(bootstrap.projects.length ? bootstrap.projects : projects);
        setPublicLayerList(bootstrap.publicLayers.length ? bootstrap.publicLayers : publicLayers);
        setSourceLinkList(bootstrap.sourceLinks.length ? bootstrap.sourceLinks : sourceLinks);
        setBackendDatabase(bootstrap.database ?? null);
        setBackendMode("api");
        setNotice("Backend connected; saved analyses are available from Saved Analyses");
      })
      .catch(() => {
        if (!isMounted) return;
        setBackendDatabase(null);
        setBackendMode("local");
        setSavedRuns([]);
        setNotice("Local demo mode");
      });

    return () => {
      isMounted = false;
    };
  }, [fetchSavedRunsFor]);

  useEffect(() => {
    if (activeTab === "saved") {
      const timer = window.setTimeout(() => {
        void fetchAllSavedRuns();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [activeTab, fetchAllSavedRuns]);

  const selectedProject =
    projectList.find((project) => project.id === selectedProjectId) ?? projectList[0] ?? projects[0];
  // Re-run the interpretation whenever survey rows, project context, or model controls change.
  const analyzed = useMemo(
    () => analyzeSurvey(points, settings, selectedProject),
    [points, selectedProject, settings],
  );
  const summary = useMemo(
    () => summarizeAnalysis(analyzed, settings.anomalyThreshold),
    [analyzed, settings.anomalyThreshold],
  );

  const persistRun = async (
    nextPoints = points,
    nextDatasetLabel = datasetLabel,
    nextSettings = settings,
    nextWarnings = uploadWarnings,
    fileName?: string,
  ) => {
    if (backendMode !== "api") {
      setNotice("Screening refreshed locally");
      return;
    }

    setIsSyncing(true);
    try {
      const result = await createSurveyRun(selectedProject.id, {
        datasetLabel: nextDatasetLabel,
        fileName,
        points: nextPoints,
        settings: nextSettings,
        warnings: nextWarnings,
        visualizationSettings: { activeLayer },
      });
      setLastRunId(result.run.id);
      setUploadWarnings(result.warnings ?? []);
      setNotice(`Backend run saved: ${result.summary.flagged.length} high-risk station(s)`);
      void fetchSavedRunsFor(selectedProject.id);
    } catch (error) {
      setBackendMode("local");
      setNotice(`Backend save failed; local analysis active. ${error instanceof Error ? error.message : ""}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const updateSiteForm = (key: keyof SiteFormState, value: string) => {
    setSiteForm((current) => {
      if (key === "coordinateInput") {
        const parsed = parseCoordinateInput(value);
        return parsed
          ? {
              ...current,
              coordinateInput: value,
              latitude: String(Number(parsed.latitude.toFixed(7))),
              longitude: String(Number(parsed.longitude.toFixed(7))),
            }
          : { ...current, coordinateInput: value };
      }
      if (key === "plotAreaUnit") {
        return { ...current, plotAreaUnit: value === "sqyd" ? "sqyd" : "sqm" };
      }
      return { ...current, [key]: value };
    });
    setSiteFormErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validateSiteForm = () => {
    const errors: Partial<Record<keyof SiteFormState, string>> = {};
    const coordinateResult = siteForm.coordinateInput.trim()
      ? parseSiteCoordinateInput(siteForm.coordinateInput)
      : null;
    const parsedCoordinate = coordinateResult?.ok ? coordinateResult.coordinate : null;
    const latitude = parsedCoordinate?.latitude ?? Number(siteForm.latitude);
    const longitude = parsedCoordinate?.longitude ?? Number(siteForm.longitude);
    const radiusMeters = Number(siteForm.radiusMeters);
    const floors = Number(siteForm.floors);
    const approximatePlotArea = siteForm.approximatePlotArea.trim() ? Number(siteForm.approximatePlotArea) : null;

    if (coordinateResult && !coordinateResult.ok) {
      errors.coordinateInput = "Paste decimal or DMS coordinates, for example 19°12'44.7\"N 73°08'39.3\"E.";
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      errors.latitude = "Latitude must be between -90 and 90.";
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      errors.longitude = "Longitude must be between -180 and 180.";
    }
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      errors.radiusMeters = "Radius must be a positive number.";
    }

    setSiteFormErrors(errors);
    if (Object.keys(errors).length) return null;

    return {
      id: `site-${Date.now()}`,
      projectName: siteForm.projectName.trim() || "Untitled TerraSignal site scan",
      clientName: siteForm.clientName.trim(),
      companyName: siteForm.companyName.trim(),
      userRole: siteForm.userRole,
      latitude,
      longitude,
      coordinateInputOriginal: parsedCoordinate?.originalInput ?? `${latitude}, ${longitude}`,
      coordinateFormat: parsedCoordinate?.format ?? "unknown",
      radiusMeters,
      intendedUse: siteForm.intendedUse,
      constructionType: siteForm.constructionType,
      buildingType: siteForm.buildingType.trim() || siteForm.intendedUse,
      floors: Number.isFinite(floors) && floors > 0 ? floors : 0,
      approximatePlotArea,
      plotAreaUnit: approximatePlotArea ? siteForm.plotAreaUnit : null,
      loadCategory: siteForm.loadCategory,
      purchaseStage: siteForm.purchaseStage,
      reportAudience: siteForm.reportAudience,
      createdAt: new Date().toISOString(),
    } satisfies ActiveSite;
  };

  const analyzeCoordinateSite = () => {
    const nextSite = validateSiteForm();
    if (!nextSite) {
      setNotice("Review coordinate input fields");
      return;
    }
    setActiveSite(nextSite);
    setSiteScreening(null);
    setLastRunId(null);
    setActiveLayer("drainageWaterloggingRisk");
    setIsScanningSite(true);
    setNotice("Flying to site and resolving provider-aware risk layers...");
    window.setTimeout(() => {
      const result = generateSiteScreening(nextSite);
      setSiteScreening(result);
      setIsScanningSite(false);
      setNotice(`${result.dataQualityLabel}: ${result.buildabilityCautionLevel} caution intelligence report ready`);
      if (backendMode === "api") {
        const persistGeneratedReport = async (screeningResult: SiteScreeningResult) => {
          const reportText = buildSiteReport(nextSite, screeningResult);
          const response = await createCoordinateRun({
            activeSite: nextSite,
            siteScreening: screeningResult,
            reportText,
            visualizationSettings: { activeLayer: "drainageWaterloggingRisk", activeSite: nextSite, siteScreening: screeningResult },
          });
          setLastRunId(response.run.id);
        };
        void analyzeSiteWithBackend({ activeSite: nextSite, siteScreening: result })
          .then((response) => {
            const enriched = mergeBackendSiteAnalysis(result, response);
            setSiteScreening(enriched);
            setNotice(
              response.aiAnalysis?.mode === "live"
                ? "Live AI narrative added and audit trail persisted"
                : `${result.dataQualityLabel}: ${result.buildabilityCautionLevel} caution intelligence report ready`,
            );
            return persistGeneratedReport(enriched);
          })
          .catch((error) => {
            void persistGeneratedReport(result).catch(() => undefined);
            setNotice(
              `Local provider-aware screening ready; backend enrichment unavailable. ${error instanceof Error ? error.message : ""}`.trim(),
            );
          });
      }
    }, 850);
  };

  const saveCoordinateSite = async () => {
    if (!activeSite || !siteScreening) {
      setNotice("Run Analyze Site before saving");
      return;
    }
    if (lastRunId) {
      setNotice(`Coordinate analysis already persisted with report ID ${lastRunId}`);
      return;
    }
    if (backendMode !== "api") {
      setNotice("Backend is offline; coordinate analysis is available locally only");
      return;
    }
    setIsSyncing(true);
    try {
      const reportText = buildSiteReport(activeSite, siteScreening);
      const response = await createCoordinateRun({
        activeSite,
        siteScreening,
        reportText,
        visualizationSettings: { activeLayer, activeSite, siteScreening },
      });
      setLastRunId(response.run.id);
      setNotice("Coordinate analysis saved");
      if (activeTab === "saved") void fetchAllSavedRuns();
    } catch (error) {
      setNotice(`Save failed: ${error instanceof Error ? error.message : "API request failed"}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleProjectChange = (projectId: string) => {
    const project = projectList.find((item) => item.id === projectId) ?? projectList[0] ?? projects[0];
    setSelectedProjectId(project.id);
    setPoints(project.points);
    setDatasetLabel("Sample survey network");
    setLastRunId(null);
    setUploadWarnings([]);
    if (backendMode === "api") {
      void fetchSavedRunsFor(project.id);
    } else {
      setSavedRuns([]);
    }
    setNotice(`${project.name} loaded`);
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Uploads are parsed locally for the MVP; no survey file leaves the browser.
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseSurveyFile(String(reader.result ?? ""));
      setUploadWarnings(parsed.warnings);
      if (!parsed.points.length) {
        setNotice("No usable survey rows found; review upload warnings");
        return;
      }

      setPoints(parsed.points);
      setDatasetLabel(`${file.name} (${parsed.points.length} stations)`);
      setNotice(
        parsed.warnings.length
          ? `Uploaded ${parsed.coordinateMode ?? "survey"} data with ${parsed.warnings.length} warning(s)`
          : `Uploaded ${parsed.coordinateMode ?? "survey"} data`,
      );
      setActiveTab("interpretation");
      void persistRun(
        parsed.points,
        `${file.name} (${parsed.points.length} stations)`,
        settings,
        parsed.warnings,
        file.name,
      );
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const loadDemoCsv = () => {
    const parsed = parseSurveyFile(sampleCsv);
    setPoints(parsed.points);
    setUploadWarnings(parsed.warnings);
    setDatasetLabel("Uploaded demo CSV");
    setNotice("Demo upload interpreted");
    setActiveTab("interpretation");
    void persistRun(parsed.points, "Uploaded demo CSV", settings, parsed.warnings, "demo.csv");
  };

  const resetProjectData = () => {
    setPoints(selectedProject.points);
    setDatasetLabel("Sample survey network");
    setUploadWarnings([]);
    setNotice("Project survey restored");
  };

  const downloadSampleCsv = () => {
    downloadText("terrasignal-sample-survey.csv", sampleCsv, "text/csv");
  };

  const loadSavedRun = async (runId: string) => {
    try {
      const response = await getSurveyRun(runId);
      const run = response.run;
      const savedSite = run.visualizationSettings?.activeSite;
      const savedScreening = run.visualizationSettings?.siteScreening;
      if (savedSite && savedScreening) {
        const normalizedSite: ActiveSite = {
          ...savedSite,
          clientName: savedSite.clientName ?? "",
          companyName: savedSite.companyName ?? "",
          userRole: savedSite.userRole ?? "Land purchaser",
          coordinateInputOriginal: savedSite.coordinateInputOriginal ?? `${savedSite.latitude}, ${savedSite.longitude}`,
          coordinateFormat: savedSite.coordinateFormat ?? "decimal",
          intendedUse: savedSite.intendedUse ?? savedSite.constructionType ?? "Unknown",
          approximatePlotArea: savedSite.approximatePlotArea ?? null,
          plotAreaUnit: savedSite.plotAreaUnit ?? null,
          purchaseStage: savedSite.purchaseStage ?? "Inspection/review",
          reportAudience: savedSite.reportAudience ?? "Land purchaser",
        };
        const regeneratedScreening = generateSiteScreening(normalizedSite);
        const normalizedScreening = savedScreening?.layerAssessments
          ? {
              ...regeneratedScreening,
              ...savedScreening,
              aiAnalysis: { ...regeneratedScreening.aiAnalysis, ...savedScreening.aiAnalysis },
              clientReviews: savedScreening.clientReviews ?? regeneratedScreening.clientReviews,
            }
          : {
              ...regeneratedScreening,
              aiAnalysis: savedScreening?.aiAnalysis
                ? { ...regeneratedScreening.aiAnalysis, ...savedScreening.aiAnalysis }
                : regeneratedScreening.aiAnalysis,
              clientReviews: savedScreening?.clientReviews ?? regeneratedScreening.clientReviews,
            };
        setActiveSite(normalizedSite);
        setSiteScreening(normalizedScreening);
        setActiveLayer(run.visualizationSettings?.activeLayer ?? "buildability");
        setLastRunId(run.id);
        setNotice(`Loaded saved coordinate analysis: ${normalizedSite.projectName}`);
        setActiveTab("overview");
        return;
      }

      if (run.projectId) {
        const project = projectList.find((item) => item.id === run.projectId);
        if (project) {
          setSelectedProjectId(project.id);
          if (backendMode === "api") void fetchSavedRunsFor(project.id);
        }
      }
      if (run.inputPoints?.length) {
        setPoints(run.inputPoints);
      }
      setSettings(run.settings);
      if (run.visualizationSettings?.activeLayer) {
        setActiveLayer(run.visualizationSettings.activeLayer);
      }
      setDatasetLabel(run.datasetLabel);
      setLastRunId(run.id);
      setUploadWarnings(run.warnings ?? []);
      setNotice(`Loaded saved run from ${formatDate(run.createdAt.slice(0, 10))}`);
      setActiveTab("globe");
    } catch (error) {
      setNotice(`Could not load saved run: ${error instanceof Error ? error.message : "API request failed"}`);
    }
  };

  const updateSetting = <K extends keyof InterpretationSettings>(
    key: K,
    value: InterpretationSettings[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  // Report text is generated from the current interpretation and exported as a local file.
  const report = buildReport(selectedProject, analyzed, settings);
  const coordinateReport = activeSite && siteScreening ? buildSiteReport(activeSite, siteScreening) : null;

  if (!isUnlocked) {
    return (
      <section className="access-gate">
        <div className="access-card">
          <div className="brand-mark">
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <span className="eyebrow">Private TerraSignal Intelligence Console</span>
          <h1>Access restricted to approved clients and internal operators.</h1>
          <p>
            Enter your private access code to open the satellite/GIS-assisted construction and
            land-purchase risk intelligence workspace.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (accessInput && accessInput === accessCode) {
                window.localStorage.setItem("terrasignal-access-unlocked", "true");
                setIsUnlocked(true);
                return;
              }
              setAccessError("Invalid access code.");
            }}
          >
            <input
              aria-label="Access code"
              type="password"
              value={accessInput}
              onChange={(event) => {
                setAccessInput(event.target.value);
                setAccessError("");
              }}
              placeholder="Access code"
            />
            {accessError && <small className="field-error">{accessError}</small>}
            <button className="primary-action wide" type="submit">
              Unlock TerraSignal
            </button>
          </form>
          <div className="disclaimer-box">{requiredProfessionalDisclaimer}</div>
        </div>
      </section>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Waves size={22} aria-hidden="true" />
          </div>
          <div>
            <span className="eyebrow">TerraSignal</span>
            <strong>Site Screening</strong>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Workspace">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "nav-tab is-active" : "nav-tab"}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <span className={`status-dot status-${["High", "Critical"].includes(siteScreening?.buildabilityCautionLevel ?? "") ? "high" : siteScreening?.buildabilityCautionLevel === "Moderate" ? "medium" : "low"}`} />
          <div>
            <small>Active site</small>
            <strong>{activeSite?.projectName ?? "Awaiting coordinates"}</strong>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="breadcrumb">
              <span>B2B geospatial SaaS</span>
              <ChevronRight size={14} aria-hidden="true" />
              <strong>{activeSite ? "Active coordinate site" : "Site intelligence"}</strong>
            </div>
            <h1>{activeSite?.projectName ?? "Earth-scale site intelligence console"}</h1>
          </div>
          <div className="topbar-actions">
            <div className={`backend-pill backend-${backendMode}`}>
              {backendMode === "api"
                ? `API + ${backendDatabase === "postgresql" ? "PostgreSQL" : "SQLite"}`
                : backendMode === "connecting"
                  ? "Connecting"
                  : "Local mode"}
            </div>
            <div className="run-state">
              <Activity size={16} aria-hidden="true" />
              <span>{isSyncing ? "Saving backend run" : notice}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setActiveTab("report")}
              title="Open report"
              aria-label="Open report"
            >
              <ClipboardCheck size={18} aria-hidden="true" />
            </button>
            <button
              className="primary-action"
              type="button"
              onClick={() => {
                setActiveTab("globe");
              }}
            >
              <Zap size={17} aria-hidden="true" />
              Analyze site
            </button>
          </div>
        </header>

        {(activeTab === "globe" || activeTab === "overview") && (
          <Suspense fallback={<div className="empty-state">Loading TerraView globe...</div>}>
            <TerraView
              activeLayer={activeLayer}
              activeSite={activeSite}
              canSave={Boolean(activeSite && siteScreening && backendMode === "api")}
              formErrors={siteFormErrors}
              formState={siteForm}
              isScanning={isScanningSite}
              onAnalyzeSite={analyzeCoordinateSite}
              onFormChange={updateSiteForm}
              onLayerChange={setActiveLayer}
              onOpenAdvancedUpload={() => setActiveTab("intake")}
              onOpenReport={() => setActiveTab("report")}
              onSaveSite={() => void saveCoordinateSite()}
              screening={siteScreening}
              // Keep one TerraView mounted across both map tabs so Cesium, imagery, and topo canvases are reused.
              showInput={activeTab === "globe"}
            />
          </Suspense>
        )}

        {activeTab === "intake" && (
          <IntakeView
            datasetLabel={datasetLabel}
            onDemoCsv={loadDemoCsv}
            onFileUpload={handleUpload}
            onReset={resetProjectData}
            onSampleDownload={downloadSampleCsv}
            onSelectProject={handleProjectChange}
            points={points}
            projects={projectList}
            publicLayers={publicLayerList}
            selectedProject={selectedProject}
            selectedProjectId={selectedProjectId}
            uploadWarnings={uploadWarnings}
          />
        )}

        {activeTab === "interpretation" && (
          <InterpretationView
            analyzed={analyzed}
            datasetLabel={datasetLabel}
            points={points}
            selectedProject={selectedProject}
            settings={settings}
            summary={summary}
            updateSetting={updateSetting}
          />
        )}

        {activeTab === "report" && (
          <ReportView
            activeSite={activeSite}
            analyzed={analyzed}
            backendMode={backendMode}
            coordinateReport={coordinateReport}
            lastRunId={lastRunId}
            onOpenSaved={() => setActiveTab("saved")}
            report={report}
            selectedProject={selectedProject}
            siteScreening={siteScreening}
            settings={settings}
            sourceLinks={sourceLinkList}
            summary={summary}
          />
        )}

        {activeTab === "saved" && (
          <SavedAnalysesView
            backendMode={backendMode}
            isLoadingRuns={isLoadingRuns}
            onLoadRun={loadSavedRun}
            onRefresh={() => void fetchAllSavedRuns()}
            savedRuns={savedRuns}
          />
        )}

        {activeTab === "settings" && (
          <SettingsView
            accessEnabled={Boolean(accessCode)}
            onLock={() => {
              window.localStorage.removeItem("terrasignal-access-unlocked");
              setIsUnlocked(!accessCode);
            }}
          />
        )}
      </main>
    </div>
  );
}

type Summary = ReturnType<typeof summarizeAnalysis>;

// Legacy portfolio view is retained for secondary/manual workflows; it is no longer the startup flow.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function OverviewView({
  analyzed,
  onSelectProject,
  projects,
  publicLayers,
  selectedProject,
  selectedProjectId,
  setActiveTab,
  summary,
}: {
  analyzed: AnalyzedPoint[];
  onSelectProject: (projectId: string) => void;
  projects: BuilderProject[];
  publicLayers: PublicLayer[];
  selectedProject: BuilderProject;
  selectedProjectId: string;
  setActiveTab: (tab: TabId) => void;
  summary: Summary;
}) {
  return (
    <section className="view-stack">
      <div className="metric-grid">
        <MetricTile
          icon={AlertTriangle}
          label="Flagged zones"
          value={String(summary.flagged.length)}
          detail={`${summary.highRisk} high priority`}
          tone="amber"
        />
        <MetricTile
          icon={Gauge}
          label="Mean confidence"
          value={`${summary.meanConfidence}%`}
          detail={`Residual ${summary.meanResidual}%`}
          tone="green"
        />
        <MetricTile
          icon={Ruler}
          label="Planning impact"
          value={summary.planningImpactSupported && summary.boreholesSaved ? String(summary.boreholesSaved) : "N/A"}
          detail="Needs baseline borehole plan"
          tone="blue"
        />
        <MetricTile
          icon={Users}
          label="Pipeline value"
          value="$145k"
          detail="3 active builder scopes"
          tone="slate"
        />
      </div>

      <div className="two-column">
        <section className="panel map-panel">
          <PanelHeader
            icon={Map}
            title="Active Site Model"
            meta={`${selectedProject.areaHa} ha | ${selectedProject.stage}`}
          />
          <AnomalyMap analyzed={analyzed} threshold={70} />
        </section>

        <section className="panel">
          <PanelHeader icon={Building2} title="Builder Pipeline" meta="Commercial desk" />
          <div className="project-list">
            {projects.map((project) => {
              const isActive = project.id === selectedProjectId;
              return (
                <button
                  className={isActive ? "project-row is-active" : "project-row"}
                  key={project.id}
                  onClick={() => onSelectProject(project.id)}
                  type="button"
                >
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.client}</small>
                  </span>
                  <span>
                    <b>{project.budget}</b>
                    <small>{formatDate(project.due)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="three-column">
        <section className="panel">
          <PanelHeader icon={ShieldCheck} title="Consultancy Package" meta="Sellable MVP" />
          <ul className="check-list">
            <li>
              <CheckCircle2 size={17} aria-hidden="true" />
              48-hour screening for land acquisition and pre-bid review
            </li>
            <li>
              <CheckCircle2 size={17} aria-hidden="true" />
              Targeted borehole plan with anomaly confidence scoring
            </li>
            <li>
              <CheckCircle2 size={17} aria-hidden="true" />
              Builder-ready report export for geotech coordination
            </li>
          </ul>
        </section>

        <section className="panel">
          <PanelHeader icon={Database} title="Public Data Basis" meta="Current sources" />
          <div className="source-list compact">
            {publicLayers.slice(0, 3).map((layer) => (
              <a href={layer.url} key={layer.id} rel="noreferrer" target="_blank">
                <span>{layer.provider}</span>
                <small>{layer.status}</small>
              </a>
            ))}
          </div>
        </section>

        <section className="panel action-panel">
          <PanelHeader icon={Search} title="Sales Motion" meta={selectedProject.client} />
          <p>
            Lead with preliminary risk reduction: transparent heuristic screening, faster site
            go/no-go conversations, and reviewer-ready cross-checks against public geoscience records.
          </p>
          <small className="panel-note">
            Decision-support demo; licensed review is required before engineering or construction use.
          </small>
          <button className="primary-action wide" type="button" onClick={() => setActiveTab("intake")}>
            <Upload size={17} aria-hidden="true" />
            Prepare client upload
          </button>
        </section>
      </div>
    </section>
  );
}

function IntakeView({
  datasetLabel,
  onDemoCsv,
  onFileUpload,
  onReset,
  onSampleDownload,
  onSelectProject,
  points,
  projects,
  publicLayers,
  selectedProject,
  selectedProjectId,
  uploadWarnings,
}: {
  datasetLabel: string;
  onDemoCsv: () => void;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onReset: () => void;
  onSampleDownload: () => void;
  onSelectProject: (projectId: string) => void;
  points: SurveyPoint[];
  projects: BuilderProject[];
  publicLayers: PublicLayer[];
  selectedProject: BuilderProject;
  selectedProjectId: string;
  uploadWarnings: ParseWarning[];
}) {
  return (
    <section className="view-stack">
      <div className="two-column intake-layout">
        <section className="panel">
          <PanelHeader icon={FolderIcon} title="Site Intake" meta={selectedProject.stage} />
          <label className="field-label" htmlFor="project-select">
            Active opportunity
          </label>
          <select
            className="select-input"
            id="project-select"
            onChange={(event) => onSelectProject(event.target.value)}
            value={selectedProjectId}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <div className="site-facts">
            <Fact label="Client" value={selectedProject.client} />
            <Fact label="Location" value={selectedProject.location} />
            <Fact label="Coordinates" value={selectedProject.coordinates} />
            <Fact label="Area" value={`${selectedProject.areaHa} ha`} />
          </div>

          <div className="method-row">
            {selectedProject.methods.map((method) => (
              <span key={method}>{methodLabels[method]}</span>
            ))}
          </div>

          <div className="constraint-list">
            {selectedProject.constraints.map((constraint) => (
              <span key={constraint}>{constraint}</span>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelHeader icon={Upload} title="Survey Import" meta={datasetLabel} />
          <label className="drop-zone" htmlFor="survey-file">
            <input
              accept=".csv,.txt,.tsv"
              id="survey-file"
              onChange={onFileUpload}
              type="file"
            />
            <Upload size={28} aria-hidden="true" />
            <strong>CSV, TXT, or TSV survey file</strong>
            <span>Required fields: id, x, y, depth, resistivity, velocity, magnetic, noise</span>
          </label>

          <div className="button-row">
            <button className="secondary-action" type="button" onClick={onDemoCsv}>
              <Database size={16} aria-hidden="true" />
              Load demo CSV
            </button>
            <button className="secondary-action" type="button" onClick={onSampleDownload}>
              <Download size={16} aria-hidden="true" />
              Sample file
            </button>
            <button className="secondary-action" type="button" onClick={onReset}>
              <RefreshCw size={16} aria-hidden="true" />
              Restore sample
            </button>
          </div>

          <div className="format-hint">
            <strong>Accepted rows</strong>
            <code>id,x,y,depth,resistivity,velocity,magnetic,noise</code>
            <code>id,lat,lon,depth,resistivity,velocity,magnetic,noise</code>
          </div>

          {uploadWarnings.length > 0 && (
            <div className="warning-list" role="status">
              <strong>{uploadWarnings.length} upload warning(s)</strong>
              {uploadWarnings.slice(0, 5).map((warning, index) => (
                <span key={`${warning.row}-${warning.field ?? "row"}-${index}`}>
                  Row {warning.row || "file"}: {warning.message}
                </span>
              ))}
            </div>
          )}

          <div className="ingest-stats">
            <Fact label="Stations" value={String(points.length)} />
            <Fact
              label="Depth range"
              value={`${Math.min(...points.map((point) => point.depth))}-${Math.max(
                ...points.map((point) => point.depth),
              )} m`}
            />
            <Fact label="Source" value={points[0]?.source === "upload" ? "Uploaded" : "Sample"} />
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelHeader icon={Layers} title="Data Fusion Queue" meta="Public context" />
        <div className="source-grid">
          {publicLayers.map((layer) => (
            <a className="source-card" href={layer.url} key={layer.id} rel="noreferrer" target="_blank">
              <span className="source-status">{layer.status}</span>
              <strong>{layer.provider}</strong>
              <small>{layer.signal}</small>
              <p>{layer.label}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelHeader icon={BarChart3} title="Imported Stations" meta={`${points.length} rows`} />
        <div className="station-strip">
          {points.map((point) => (
            <div className="station-pill" key={point.id}>
              <strong>{point.id}</strong>
              <span>{point.depth} m</span>
              <small>{point.resistivity} ohm-m</small>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function InterpretationView({
  analyzed,
  datasetLabel,
  points,
  selectedProject,
  settings,
  summary,
  updateSetting,
}: {
  analyzed: AnalyzedPoint[];
  datasetLabel: string;
  points: SurveyPoint[];
  selectedProject: BuilderProject;
  settings: InterpretationSettings;
  summary: Summary;
  updateSetting: <K extends keyof InterpretationSettings>(
    key: K,
    value: InterpretationSettings[K],
  ) => void;
}) {
  return (
    <section className="view-stack">
      <div className="split-hero">
        <section className="panel interpretation-panel">
          <PanelHeader icon={Microscope} title="AI-assisted Screening" meta={datasetLabel} />
          <SignalHeatmap analyzed={analyzed} threshold={settings.anomalyThreshold} />
        </section>

        <section className="panel controls-panel">
          <PanelHeader icon={SlidersHorizontal} title="Model Controls" meta="Transparent heuristic" />
          <RangeControl
            label="Noise suppression"
            max={95}
            min={20}
            onChange={(value) => updateSetting("noiseSuppression", value)}
            value={settings.noiseSuppression}
          />
          <RangeControl
            label="Physics weight"
            max={95}
            min={15}
            onChange={(value) => updateSetting("physicsWeight", value)}
            value={settings.physicsWeight}
          />
          <RangeControl
            label="Anomaly threshold"
            max={92}
            min={45}
            onChange={(value) => updateSetting("anomalyThreshold", value)}
            value={settings.anomalyThreshold}
          />
          <div className="segmented-control" aria-label="Model focus">
            {(["HYBRID", "ERT", "SRT", "MASW", "MAG"] as const).map((focus) => (
              <button
                className={settings.focus === focus ? "is-active" : ""}
                key={focus}
                onClick={() => updateSetting("focus", focus)}
                type="button"
              >
                {methodLabels[focus]}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="metric-grid">
        <MetricTile
          icon={Radar}
          label="Top score"
          value={String(summary.top?.anomalyScore ?? 0)}
          detail={summary.top?.id ?? "No stations"}
          tone="amber"
        />
        <MetricTile
          icon={ShieldCheck}
          label="High-risk residual"
          value={`${summary.meanResidual}%`}
          detail="Heuristic mean of HIGH anomalies"
          tone="green"
        />
        <MetricTile
          icon={LineChart}
          label="Signal lift"
          value={`${analyzed[0]?.signalLift ?? 0}%`}
          detail={`${points.length} stations processed`}
          tone="blue"
        />
        <MetricTile
          icon={AlertTriangle}
          label="Threshold"
          value={String(settings.anomalyThreshold)}
          detail={`${summary.flagged.length} above threshold`}
          tone="slate"
        />
      </div>

      <div className="two-column">
        <section className="panel">
          <PanelHeader icon={Map} title="Priority Anomaly Map" meta={selectedProject.location} />
          <AnomalyMap analyzed={analyzed} threshold={settings.anomalyThreshold} />
        </section>

        <section className="panel">
          <PanelHeader icon={Settings} title="Interpretation Notes" meta="Reviewer handoff" />
          <ul className="risk-list">
            {summary.priorityFindings
              .filter((point) => point.riskLevel !== "LOW")
              .slice(0, 4)
              .map((point) => (
              <li key={point.id}>
                <span className={`severity-dot ${riskLevelClass(point.riskLevel)}`} />
                <div>
                  <strong>
                    {point.id} | {point.riskLevel} | {point.className}
                  </strong>
                  <small>{point.action}</small>
                </div>
                <b>{point.confidence}%</b>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel">
        <PanelHeader icon={ClipboardCheck} title="Anomaly Register" meta="Ranked by model score" />
        <AnomalyTable analyzed={analyzed} threshold={settings.anomalyThreshold} />
      </section>
    </section>
  );
}

function ReportView({
  activeSite,
  analyzed,
  backendMode,
  coordinateReport,
  lastRunId,
  onOpenSaved,
  report,
  selectedProject,
  siteScreening,
  settings,
  sourceLinks,
  summary,
}: {
  activeSite: ActiveSite | null;
  analyzed: AnalyzedPoint[];
  backendMode: BackendMode;
  coordinateReport: string | null;
  lastRunId: string | null;
  onOpenSaved: () => void;
  report: string;
  selectedProject: BuilderProject;
  siteScreening: SiteScreeningResult | null;
  settings: InterpretationSettings;
  sourceLinks: SourceLink[];
  summary: Summary;
}) {
  const exportReport = () => {
    if (coordinateReport && activeSite) {
      downloadText(`${activeSite.id}-coordinate-screening-report.txt`, coordinateReport, "text/plain");
      return;
    }
    if (backendMode === "api" && lastRunId) {
      window.open(getRunArtifactUrl(lastRunId, "report"), "_blank");
      return;
    }
    downloadText(`${selectedProject.id}-terrasignal-report.txt`, report, "text/plain");
  };
  const exportCsv = () => {
    if (activeSite && siteScreening) {
      downloadText(`${activeSite.id}-coordinate-screening.csv`, exportSiteScreeningCsv(activeSite, siteScreening), "text/csv");
      return;
    }
    if (backendMode === "api" && lastRunId) {
      window.open(getRunArtifactUrl(lastRunId, "anomalies.csv"), "_blank");
      return;
    }
    downloadText(`${selectedProject.id}-anomaly-register.csv`, exportAnalyzedCsv(analyzed), "text/csv");
  };
  const localAuditSnapshot = () => {
    if (!activeSite || !siteScreening || !coordinateReport) return null;
    return buildReportAuditSnapshot({
      reportId: lastRunId || crypto.randomUUID(),
      site: activeSite,
      screening: siteScreening,
      reportText: coordinateReport,
      codeVersion: "unknown",
      environment: import.meta.env.MODE === "production" ? "production" : "development",
    });
  };
  const downloadJson = async (
    filename: string,
    backendLoader: ((reportId: string) => Promise<unknown>) | null,
    localLoader: () => unknown,
  ) => {
    try {
      const payload = backendMode === "api" && lastRunId && backendLoader ? await backendLoader(lastRunId) : localLoader();
      downloadText(filename, JSON.stringify(payload, null, 2), "application/json");
    } catch (error) {
      downloadText(
        filename,
        JSON.stringify(
          {
            error: "Unable to download audit evidence.",
            details: error instanceof Error ? error.message : "Unknown error",
          },
          null,
          2,
        ),
        "application/json",
      );
    }
  };
  const downloadAuditJson = () =>
    downloadJson(
      `${lastRunId || activeSite?.id || selectedProject.id}-audit.json`,
      getReportAudit,
      () => localAuditSnapshot() ?? { message: "Save or generate a coordinate report before audit export." },
    );
  const downloadRawJson = () =>
    downloadJson(
      `${lastRunId || activeSite?.id || selectedProject.id}-raw-layers.json`,
      getReportRawLayers,
      () => {
        const snapshot = localAuditSnapshot();
        return snapshot ? auditRawLayerData(snapshot) : { message: "No local audit snapshot available." };
      },
    );
  const downloadScoringJson = () =>
    downloadJson(
      `${lastRunId || activeSite?.id || selectedProject.id}-scoring.json`,
      getReportScoring,
      () => {
        const snapshot = localAuditSnapshot();
        return snapshot ? auditScoringData(snapshot) : { message: "No local audit snapshot available." };
      },
    );
  const downloadValidationJson = () =>
    downloadJson(
      `${lastRunId || activeSite?.id || selectedProject.id}-validation.json`,
      getReportValidation,
      () => {
        const snapshot = localAuditSnapshot();
        return snapshot ? auditValidationData(snapshot) : { message: "No local audit snapshot available." };
      },
    );
  const hasModelledOrFallback = Boolean(
    siteScreening &&
      Object.values(siteScreening.layerAssessments).some((layer) =>
        ["cached", "fallback", "configured", "unavailable"].includes(layer.status),
      ),
  );
  const lowConfidence = Boolean(siteScreening && siteScreening.dataConfidence < 75);

  return (
    <section className="view-stack report-view">
      <div className="two-column report-layout">
        <section className="panel report-card">
          <PanelHeader
            icon={FileText}
            title={activeSite ? "Site Intelligence Report" : "Client Report"}
            meta={activeSite ? "Provider-aware screening" : formatDate(selectedProject.due)}
          />
          <div className="report-title">
            <span>{activeSite ? "Preliminary site intelligence" : selectedProject.client}</span>
            <h2>{activeSite?.projectName ?? selectedProject.name}</h2>
            <p>
              {activeSite
                ? `${activeSite.latitude.toFixed(6)}, ${activeSite.longitude.toFixed(6)} | ${activeSite.radiusMeters} m radius`
                : selectedProject.target}
            </p>
          </div>

          {activeSite && siteScreening ? (
            <ReportPreviewPanel activeSite={activeSite} screening={siteScreening} />
          ) : (
            <>
              <div className="report-metrics">
                <Fact label="Flagged anomalies" value={String(summary.flagged.length)} />
                <Fact label="High priority" value={String(summary.highRisk)} />
                <Fact label="High-risk confidence" value={`${summary.meanConfidence}%`} />
                <Fact label="Model mode" value={methodLabels[settings.focus]} />
              </div>

              <div className="findings-list">
                {summary.priorityFindings
                  .filter((point) => point.riskLevel !== "LOW")
                  .slice(0, 5)
                  .map((point) => (
                  <article key={point.id}>
                    <span className={`finding-score ${riskLevelClass(point.riskLevel)}`}>
                      {point.anomalyScore}
                    </span>
                    <div>
                      <strong>
                        {point.id}: {point.riskLevel} | {point.className}
                      </strong>
                      <p>{point.action}</p>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          <div className="disclaimer-box">
            {requiredDisclaimer}
          </div>
        </section>

        <section className="panel">
          <PanelHeader icon={Download} title="Deliverables" meta="Consultancy workflow" />
          <div className="button-stack">
            <button className="primary-action wide" type="button" onClick={exportReport}>
              <Download size={17} aria-hidden="true" />
              Export report
            </button>
            <button className="secondary-action wide" type="button" onClick={exportCsv}>
              <Database size={16} aria-hidden="true" />
              Export screening CSV
            </button>
            <button className="secondary-action wide" type="button" onClick={() => window.print()}>
              <FileText size={16} aria-hidden="true" />
              Print client view
            </button>
          </div>

          <div className="proposal-box">
            <strong>Recommended next steps</strong>
            <p>
              Use this preliminary scan to plan professional geotechnical investigation, borehole/SPT/CPT
              scope, drainage/groundwater review, soil lab testing, and qualified engineer review.
            </p>
          </div>

          <div className="saved-runs">
            <strong>Saved analyses</strong>
            <p>Saved database entries are kept out of the main flow. Open them only from the Saved Analyses section.</p>
            <button className="secondary-action wide" type="button" onClick={onOpenSaved}>
              <Database size={16} aria-hidden="true" />
              Open Saved Analyses
            </button>
          </div>

          <div className="proposal-box audit-evidence-box">
            <strong>Audit & Evidence</strong>
            {lastRunId ? <p>Report ID: {lastRunId}</p> : <p>Unsaved preview. Save analysis to persist the audit trail server-side.</p>}
            {lowConfidence && <p>Moderate confidence: verify with professional survey/geotechnical investigation.</p>}
            {hasModelledOrFallback && <p>Some layers are modelled or fallback. Do not treat them as measured field data.</p>}
            <div className="button-stack compact">
              <button className="secondary-action wide" type="button" onClick={downloadAuditJson}>
                <Download size={16} aria-hidden="true" />
                Download audit JSON
              </button>
              <button className="secondary-action wide" type="button" onClick={downloadRawJson}>
                <Download size={16} aria-hidden="true" />
                Download raw layer data JSON
              </button>
              <button className="secondary-action wide" type="button" onClick={downloadScoringJson}>
                <Download size={16} aria-hidden="true" />
                Download scoring breakdown JSON
              </button>
              <button className="secondary-action wide" type="button" onClick={downloadValidationJson}>
                <Download size={16} aria-hidden="true" />
                Download validation summary JSON
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelHeader icon={BookIcon} title="Research Basis" meta="Linked sources" />
        <div className="source-list">
          {sourceLinks.map((source) => (
            <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
              <span>{source.label}</span>
              <small>Open source</small>
            </a>
          ))}
        </div>
      </section>
    </section>
  );
}

function SavedAnalysesView({
  backendMode,
  isLoadingRuns,
  onLoadRun,
  onRefresh,
  savedRuns,
}: {
  backendMode: BackendMode;
  isLoadingRuns: boolean;
  onLoadRun: (runId: string) => void;
  onRefresh: () => void;
  savedRuns: SurveyRun[];
}) {
  return (
    <section className="view-stack">
      <section className="panel">
        <PanelHeader icon={Database} title="Saved Analyses" meta="History only" />
        <div className="button-row">
          <button className="secondary-action" type="button" onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        </div>
        <div className="saved-runs history-list">
          {backendMode !== "api" && <p>Backend is offline. Saved analyses are unavailable in local-only mode.</p>}
          {backendMode === "api" && isLoadingRuns && <p>Loading saved analyses...</p>}
          {backendMode === "api" && !isLoadingRuns && savedRuns.length === 0 && (
            <p>No saved analyses yet. Run Site Intelligence and choose Save Analysis.</p>
          )}
          {backendMode === "api" &&
            savedRuns.map((run) => {
              const savedSite = run.visualizationSettings?.activeSite;
              return (
                <button className="saved-run-row" key={run.id} type="button" onClick={() => onLoadRun(run.id)}>
                  <span>
                    <strong>{savedSite?.projectName ?? run.datasetLabel}</strong>
                    <small>
                      {savedSite
                        ? `${savedSite.latitude.toFixed(5)}, ${savedSite.longitude.toFixed(5)}`
                        : run.locationName ?? run.projectId}
                    </small>
                  </span>
                  <span>
                    <b>{run.highRiskCount ?? run.summary?.highRisk ?? 0}</b>
                    <small>{new Date(run.createdAt).toLocaleString()}</small>
                  </span>
                </button>
              );
            })}
        </div>
        <div className="disclaimer-box">{requiredDisclaimer}</div>
      </section>
    </section>
  );
}

function MetricTile({
  detail,
  icon: Icon,
  label,
  tone,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone: "amber" | "green" | "blue" | "slate";
  value: string;
}) {
  return (
    <section className={`metric-tile tone-${tone}`}>
      <div className="metric-icon">
        <Icon size={20} aria-hidden="true" />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function SettingsView({ accessEnabled, onLock }: { accessEnabled: boolean; onLock: () => void }) {
  return (
    <section className="view-stack">
      <section className="panel">
        <PanelHeader icon={ShieldCheck} title="Private Access" meta="Client console" />
        <div className="report-title">
          <span>Private TerraSignal Intelligence Console</span>
          <h2>{accessEnabled ? "Access gate is enabled" : "Access gate is not configured"}</h2>
          <p>
            Configure <code>VITE_APP_ACCESS_CODE</code> in your environment to require a private code before
            users can access the coordinate scan, reports, saved analyses, and advanced upload tools.
          </p>
        </div>
        <div className="button-row">
          <button className="secondary-action" type="button" onClick={onLock} disabled={!accessEnabled}>
            Lock console
          </button>
        </div>
        <div className="disclaimer-box">{requiredDisclaimer}</div>
      </section>
    </section>
  );
}

function PanelHeader({
  icon: Icon,
  meta,
  title,
}: {
  icon: LucideIcon;
  meta: string;
  title: string;
}) {
  return (
    <div className="panel-header">
      <div>
        <Icon size={18} aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      <span>{meta}</span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RangeControl({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="range-control">
      <span>
        {label}
        <b>{value}%</b>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        type="range"
        value={value}
      />
    </label>
  );
}

function AnomalyMap({
  analyzed,
  threshold,
}: {
  analyzed: AnalyzedPoint[];
  threshold: number;
}) {
  const bounds = useMemo(() => {
    if (!analyzed.length) {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }
    const xValues = analyzed.map((point) => point.x);
    const yValues = analyzed.map((point) => point.y);
    return {
      minX: Math.min(...xValues),
      maxX: Math.max(...xValues),
      minY: Math.min(...yValues),
      maxY: Math.max(...yValues),
    };
  }, [analyzed]);

  if (!analyzed.length) {
    return <div className="empty-state">No survey stations available for spatial screening.</div>;
  }

  const position = (point: AnalyzedPoint) => {
    const xRange = bounds.maxX - bounds.minX || 1;
    const yRange = bounds.maxY - bounds.minY || 1;
    return {
      x: 8 + ((point.x - bounds.minX) / xRange) * 84,
      y: 90 - ((point.y - bounds.minY) / yRange) * 76,
    };
  };

  return (
    <svg className="site-map" role="img" viewBox="0 0 100 100" aria-label="Anomaly map">
      <defs>
        <linearGradient id="surface" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#d5f0df" />
          <stop offset="52%" stopColor="#e8d8ad" />
          <stop offset="100%" stopColor="#c5d4db" />
        </linearGradient>
        <linearGradient id="subsurface" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f7f3e8" />
          <stop offset="100%" stopColor="#d9c3a1" />
        </linearGradient>
      </defs>
      <rect className="map-bg" height="100" width="100" rx="2" />
      <path d="M0 34 C16 26 29 38 44 30 C61 20 75 37 100 27 L100 100 L0 100 Z" fill="url(#subsurface)" />
      <path d="M0 31 C16 23 29 35 44 27 C61 17 75 34 100 24 L100 35 C76 42 59 26 44 35 C28 43 16 31 0 39 Z" fill="url(#surface)" />
      <path className="fault-line" d="M34 28 L43 45 L39 61 L49 83" />
      <path className="strata-line" d="M0 48 C22 42 34 55 54 48 C72 42 83 50 100 46" />
      <path className="strata-line" d="M0 67 C24 60 39 70 58 63 C78 56 88 63 100 58" />
      {analyzed.map((point) => {
        const { x, y } = position(point);
        const band = riskLevelClass(point.riskLevel);
        return (
          <g key={point.id}>
            {point.anomalyScore >= threshold && (
              <circle className={`pulse-ring ${band}`} cx={x} cy={y} r={6.8} />
            )}
            <circle className={`map-point ${band}`} cx={x} cy={y} r={3.1} />
          </g>
        );
      })}
    </svg>
  );
}

function SignalHeatmap({
  analyzed,
  threshold,
}: {
  analyzed: AnalyzedPoint[];
  threshold: number;
}) {
  if (!analyzed.length) {
    return <div className="empty-state">Upload or restore survey stations to generate a risk heatmap.</div>;
  }

  const cells = Array.from({ length: 72 }, (_, index) => {
    const point = analyzed[index % analyzed.length];
    const drift = Math.sin(index * 0.72) * 9 + Math.cos(index * 0.21) * 5;
    const score = Math.max(10, Math.min(99, point.anomalyScore + drift));
    return { index, point, score };
  });

  return (
    <div className="heatmap-shell">
      <div className="heatmap-grid" aria-label="Signal heatmap">
        {cells.map((cell) => (
          <span
            className={cell.score >= threshold ? "heat-cell is-flagged" : "heat-cell"}
            key={`${cell.point.id}-${cell.index}`}
            style={{ "--heat": `${cell.score}%` } as CSSProperties}
            title={`${cell.point.id}: ${Math.round(cell.score)}`}
          />
        ))}
      </div>
      <div className="waveform">
        {analyzed.slice(0, 16).map((point, index) => (
          <span
            key={`${point.id}-wave`}
            style={{ height: `${22 + (point.anomalyScore % 56)}px`, left: `${index * 6.3}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function AnomalyTable({
  analyzed,
  threshold,
}: {
  analyzed: AnalyzedPoint[];
  threshold: number;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Station</th>
            <th>Risk</th>
            <th>Class</th>
            <th>Score</th>
            <th>Confidence pct</th>
            <th>Heuristic residual pct</th>
            <th>Depth m</th>
            <th>Reason</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {analyzed.map((point) => (
            <tr key={point.id} className={point.anomalyScore >= threshold ? "is-flagged" : ""}>
              <td>{point.id}</td>
              <td>{point.riskLevel}</td>
              <td>{point.className}</td>
              <td>
                <span className={`score-pill ${riskLevelClass(point.riskLevel)}`}>
                  {point.anomalyScore}
                </span>
              </td>
              <td>{point.confidence}%</td>
              <td>{point.physicsResidual}%</td>
              <td>{point.depth}</td>
              <td>{point.reason}</td>
              <td>{point.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FolderIcon = Database;
const BookIcon = Layers;

export default App;
