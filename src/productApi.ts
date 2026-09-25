import type {
  AuthUser,
  ExplainableLandScan,
  LandScanDetail,
  LandScanSummary,
  ProfessionalReport,
  SampleReportSummary,
  ScanInput,
} from "./productTypes";
import type {
  CapacityEnvelope,
  PilotRequestInput,
  Portfolio,
  PortfolioView,
  SiteQaAnswer,
  ValueModelInputs,
  ValueScenario,
  WeightingProfile,
} from "./enterpriseTypes";

const viteServedPorts = new Set(["5173", "5174", "4173"]);
const withApiPrefix = (base: string) => {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};

export const apiBase = viteServedPorts.has(window.location.port)
  ? withApiPrefix(import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787")
  : "/api";

const requestJson = async <T>(path: string, token?: string | null, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Unable to reach TerraSignal API. Check that the backend is running and your network is available.");
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const register = (payload: {
  email: string;
  password: string;
  name: string;
  company: string;
}) =>
  requestJson<{ user: AuthUser; token: string }>("/auth/register", null, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const login = (payload: { email: string; password: string }) =>
  requestJson<{ user: AuthUser; token: string }>("/auth/login", null, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const profile = (token: string) => requestJson<{ user: AuthUser }>("/auth/profile", token);

export const listLandScans = (token: string) =>
  requestJson<{ scans: LandScanSummary[] }>("/land-scans", token);

export const createLandScan = (token: string, payload: ScanInput) =>
  requestJson<{ scan: ExplainableLandScan; report: ProfessionalReport }>("/land-scans", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const getLandScan = (token: string, scanId: string) =>
  requestJson<{ scan: LandScanDetail }>(`/land-scans/${encodeURIComponent(scanId)}`, token);

export const deleteLandScan = (token: string, scanId: string) =>
  requestJson<{ ok: true }>(`/land-scans/${encodeURIComponent(scanId)}`, token, { method: "DELETE" });

export const getSampleReports = () => requestJson<{ reports: SampleReportSummary[] }>("/sample-reports");

export const getSampleReport = (sampleId: string) =>
  requestJson<{
    report: {
      id: string;
      title: string;
      market: string;
      demo: true;
      scan: ExplainableLandScan;
      report: ProfessionalReport;
    };
  }>(`/sample-reports/${encodeURIComponent(sampleId)}`);

export const getAdminUsers = (token: string) => requestJson<{ users: AuthUser[] }>("/admin/users", token);

export const getAdminScans = (token: string) =>
  requestJson<{ scans: LandScanSummary[] }>("/admin/scans", token);

export const getAdminMetrics = (token: string) =>
  requestJson<{
    metrics: {
      userCount: number;
      scanCount: number;
      highRiskCount: number;
      averageRiskScore: number;
      mostScannedLocations: Array<{ location: string; count: number }>;
      pricingReadiness: string[];
    };
  }>("/admin/metrics", token);

export const exportScanPdf = async (token: string, scanId: string) => {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/land-scans/${encodeURIComponent(scanId)}/pdf`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error("Unable to reach TerraSignal API for PDF export.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `PDF export failed with ${response.status}`);
  }
  return response.blob();
};

// --- Enterprise decision-intelligence surface -------------------------------

export const listRankingProfiles = () =>
  requestJson<{ profiles: WeightingProfile[]; note: string }>("/ranking-profiles");

export const listPortfolios = (token: string) =>
  requestJson<{ portfolios: Portfolio[]; limits: { maxSites: number } }>("/portfolios", token);

export const createPortfolio = (
  token: string,
  payload: { name: string; description?: string; profileId?: string; scanIds: string[] },
) =>
  requestJson<{ portfolio: Portfolio }>("/portfolios", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const getPortfolio = (token: string, portfolioId: string) =>
  requestJson<PortfolioView>(`/portfolios/${encodeURIComponent(portfolioId)}`, token);

export const updatePortfolio = (
  token: string,
  portfolioId: string,
  payload: { name?: string; description?: string; profileId?: string; scanIds?: string[] },
) =>
  requestJson<PortfolioView>(`/portfolios/${encodeURIComponent(portfolioId)}`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const deletePortfolio = (token: string, portfolioId: string) =>
  requestJson<{ ok: true }>(`/portfolios/${encodeURIComponent(portfolioId)}`, token, { method: "DELETE" });

export const rankPortfolio = (
  token: string,
  portfolioId: string,
  payload: { profileId?: string; weightOverrides?: Record<string, number> },
) =>
  requestJson<PortfolioView>(`/portfolios/${encodeURIComponent(portfolioId)}/rank`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const computeCapacity = (token: string, scanId: string, planning: Record<string, number>) =>
  requestJson<{ scanId: string; capacity: CapacityEnvelope }>(
    `/land-scans/${encodeURIComponent(scanId)}/capacity`,
    token,
    { method: "POST", body: JSON.stringify({ planning }) },
  );

export const askSiteQuestion = (token: string, payload: { scanIds: string[]; question: string }) =>
  requestJson<SiteQaAnswer>("/site-qa", token, { method: "POST", body: JSON.stringify(payload) });

export const runValueScenario = (inputs: Partial<ValueModelInputs>) =>
  requestJson<{ scenario: ValueScenario }>("/value-model", null, {
    method: "POST",
    body: JSON.stringify({ inputs }),
  });

export const submitPilotRequest = (payload: PilotRequestInput) =>
  requestJson<{ request: { id: string; createdAt: string; status: string }; acknowledgement: string }>(
    "/pilot-requests",
    null,
    { method: "POST", body: JSON.stringify(payload) },
  );
