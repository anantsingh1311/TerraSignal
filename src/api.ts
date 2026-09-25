import type {
  AnalyzedPoint,
  AnomalyCluster,
  ActiveSite,
  BuilderProject,
  InterpretationSettings,
  GlobeLayer,
  ParseWarning,
  PublicLayer,
  SiteScreeningResult,
  SourceLink,
  SurveyPoint,
} from "./types";
import type { BackendSiteAnalysisResponse } from "./features/site-intelligence/api/siteIntelligenceApi";
import type { ReportAuditSnapshot } from "./reportAudit";

export type BackendMode = "connecting" | "api" | "local";

export type AnalysisSummary = {
  flagged: AnalyzedPoint[];
  priorityFindings: AnalyzedPoint[];
  clusters: AnomalyCluster[];
  top: AnalyzedPoint | null;
  meanConfidence: number;
  meanResidual: number;
  highRisk: number;
  boreholesSaved: number | null;
  planningImpactSupported: boolean;
};

export type SurveyRun = {
  id: string;
  projectId: string;
  datasetLabel: string;
  fileName?: string | null;
  settings: InterpretationSettings;
  inputPoints?: SurveyPoint[];
  analyzed?: AnalyzedPoint[];
  summary: AnalysisSummary;
  warnings?: ParseWarning[];
  rowCount?: number;
  warningCount?: number;
  anomalyCount?: number;
  highRiskCount?: number;
  reportText?: string;
  projectName?: string;
  locationName?: string;
  latitude?: number | null;
  longitude?: number | null;
  coordinateMode?: "local_xy" | "lat_lon";
  visualizationSettings?: {
    activeLayer?: GlobeLayer;
    activeSite?: ActiveSite;
    siteScreening?: SiteScreeningResult;
    [key: string]: unknown;
  };
  createdAt: string;
};

export type AuditRawLayerData = ReturnType<typeof import("./reportAudit").auditRawLayerData>;
export type AuditScoringData = ReturnType<typeof import("./reportAudit").auditScoringData>;
export type AuditValidationData = ReturnType<typeof import("./reportAudit").auditValidationData>;

type BootstrapResponse = {
  projects: BuilderProject[];
  publicLayers: PublicLayer[];
  sourceLinks: SourceLink[];
  database?: "sqlite" | "postgresql";
};

type CreateRunResponse = {
  run: SurveyRun;
  points: SurveyPoint[];
  analyzed: AnalyzedPoint[];
  summary: AnalysisSummary;
  reportText: string;
  warnings?: ParseWarning[];
};

type RunsResponse = {
  runs: SurveyRun[];
};

type RunResponse = {
  run: SurveyRun;
};

type HealthResponse = {
  ok: boolean;
  service: string;
  database: "sqlite" | "postgresql";
  databaseConnected: boolean;
  mode: string;
  providerStatus?: Record<string, "live" | "cached" | "configured" | "fallback" | "unavailable">;
  uptimeSeconds: number;
  timestamp: string;
};

const viteServedPorts = new Set(["5173", "5174", "4173"]);
const withApiPrefix = (base: string) => {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};
const apiBase = viteServedPorts.has(window.location.port)
  ? withApiPrefix(import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787")
  : "/api";

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message || `API request failed with ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
};

export const getBootstrap = () => requestJson<BootstrapResponse>("/bootstrap");

export const getHealth = () => requestJson<HealthResponse>("/health");

export const createSurveyRun = (
  projectId: string,
  payload: {
    datasetLabel: string;
    settings: InterpretationSettings;
    points?: SurveyPoint[];
    csvText?: string;
    fileName?: string;
    warnings?: ParseWarning[];
    visualizationSettings?: {
      activeLayer?: GlobeLayer;
      [key: string]: unknown;
    };
  },
) =>
  requestJson<CreateRunResponse>(`/projects/${encodeURIComponent(projectId)}/runs`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const listSurveyRuns = (projectId: string) =>
  requestJson<RunsResponse>(`/projects/${encodeURIComponent(projectId)}/runs`);

export const listAllRuns = () => requestJson<RunsResponse>("/runs");

export const createCoordinateRun = (payload: {
  activeSite: ActiveSite;
  siteScreening: SiteScreeningResult;
  reportText: string;
  visualizationSettings?: {
    activeLayer?: GlobeLayer;
    activeSite?: ActiveSite;
    siteScreening?: SiteScreeningResult;
    [key: string]: unknown;
  };
}) =>
  requestJson<RunResponse>("/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const analyzeSiteWithBackend = (payload: {
  activeSite: ActiveSite;
  siteScreening: SiteScreeningResult;
}) =>
  requestJson<{
    activeSite: ActiveSite;
    aiError?: string | null;
  } & BackendSiteAnalysisResponse>("/site-analysis", {
    method: "POST",
    body: JSON.stringify({
      activeSite: {
        ...payload.activeSite,
        siteScreening: payload.siteScreening,
      },
    }),
  });

export const getSurveyRun = (runId: string) =>
  requestJson<RunResponse>(`/runs/${encodeURIComponent(runId)}`);

export const getRunArtifactUrl = (runId: string, artifact: "report" | "anomalies.csv") =>
  `${apiBase}/runs/${encodeURIComponent(runId)}/${artifact}`;

export const getReportAudit = (reportId: string) =>
  requestJson<ReportAuditSnapshot>(`/reports/${encodeURIComponent(reportId)}/audit`);

export const getReportRawLayers = (reportId: string) =>
  requestJson<AuditRawLayerData>(`/reports/${encodeURIComponent(reportId)}/raw`);

export const getReportScoring = (reportId: string) =>
  requestJson<AuditScoringData>(`/reports/${encodeURIComponent(reportId)}/scoring`);

export const getReportValidation = (reportId: string) =>
  requestJson<AuditValidationData>(`/reports/${encodeURIComponent(reportId)}/validation`);

export const validateReportAudit = (reportId: string) =>
  requestJson<AuditValidationData>(`/reports/${encodeURIComponent(reportId)}/validate`, { method: "POST" });
