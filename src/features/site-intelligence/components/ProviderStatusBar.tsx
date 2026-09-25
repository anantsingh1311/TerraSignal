import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, Slash } from "lucide-react";
import type { SiteScreeningResult } from "../../../types";
import type { ProviderRegistryStatus, ProviderStatus } from "../types/siteIntelligence";
import { providerStatusLabel } from "../api/siteIntelligenceApi";

const providerLabels: Array<{ key: keyof ProviderRegistryStatus; label: string }> = [
  { key: "elevation", label: "Elevation" },
  { key: "soil", label: "Soil" },
  { key: "seismic", label: "Seismic" },
  { key: "water", label: "Water" },
  { key: "landCover", label: "Land cover" },
  { key: "groundwater", label: "Groundwater" },
  { key: "legalPlanning", label: "Legal/planning" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "ai", label: "Narrative" },
];

const StatusIcon = ({ status }: { status: ProviderStatus }) => {
  if (status === "live") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (status === "cached") return <Clock3 size={14} aria-hidden="true" />;
  if (status === "unavailable") return <Slash size={14} aria-hidden="true" />;
  return <AlertTriangle size={14} aria-hidden="true" />;
};

export function ProviderStatusBadge({
  label,
  status,
}: {
  label: string;
  status: ProviderStatus;
}) {
  const normalizedStatus = status === "configured" ? "fallback" : status;
  return (
    <span className={`provider-badge provider-${normalizedStatus}`}>
      <StatusIcon status={normalizedStatus} />
      <span>{label}</span>
      <b>{providerStatusLabel(normalizedStatus)}</b>
    </span>
  );
}

export function ProviderStatusBar({ screening }: { screening: SiteScreeningResult | null }) {
  if (!screening) {
    return (
      <div className="provider-status-bar empty">
        <DatabaseZap size={15} aria-hidden="true" />
        <span>Providers resolve after a coordinate is analyzed.</span>
      </div>
    );
  }

  const fallbackCount = providerLabels.filter(
    ({ key }) => screening.providerStatus[key] === "fallback" || screening.providerStatus[key] === "configured",
  ).length;
  const unavailableCount = providerLabels.filter(({ key }) => screening.providerStatus[key] === "unavailable").length;

  return (
    <div className="provider-status-wrap">
      <div className="provider-status-summary">
        <DatabaseZap size={15} aria-hidden="true" />
        <span>{screening.dataQualityLabel}</span>
        <b>{screening.dataConfidence}% confidence</b>
      </div>
      <div className="provider-status-bar">
        {providerLabels.map(({ key, label }) => (
          <ProviderStatusBadge key={key} label={label} status={screening.providerStatus[key]} />
        ))}
      </div>
      {(fallbackCount > 2 || unavailableCount > 0) && (
        <div className="provider-warning">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            {fallbackCount > 2
              ? `${fallbackCount} providers are fallback, so scores are broad screening indicators.`
              : `${unavailableCount} provider layer(s) are unavailable and should not be treated as verified.`}
          </span>
        </div>
      )}
    </div>
  );
}
