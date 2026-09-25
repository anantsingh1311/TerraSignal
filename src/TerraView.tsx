import { useState } from "react";
import type { ActiveSite, GlobeLayer, SiteScreeningResult } from "./types";
import { EarthIntelligenceViewer } from "./features/site-intelligence/components/EarthIntelligenceViewer";
import { LayerTogglePanel } from "./features/site-intelligence/components/LayerTogglePanel";
import { RiskIntelligencePanel } from "./features/site-intelligence/components/RiskIntelligencePanel";
import { SiteSearchPanel } from "./features/site-intelligence/components/SiteSearchPanel";
import type { SiteFormState } from "./features/site-intelligence/types/siteIntelligence";

export type { SiteFormState } from "./features/site-intelligence/types/siteIntelligence";

export function TerraView({
  activeLayer,
  activeSite,
  canSave,
  formErrors,
  formState,
  isScanning,
  onAnalyzeSite,
  onFormChange,
  onLayerChange,
  onOpenAdvancedUpload,
  onOpenReport,
  onSaveSite,
  screening,
  showInput = true,
}: {
  activeLayer: GlobeLayer;
  activeSite: ActiveSite | null;
  canSave: boolean;
  formErrors: Partial<Record<keyof SiteFormState, string>>;
  formState: SiteFormState;
  isScanning: boolean;
  onAnalyzeSite: () => void;
  onFormChange: (key: keyof SiteFormState, value: string) => void;
  onLayerChange: (layer: GlobeLayer) => void;
  onOpenAdvancedUpload: () => void;
  onOpenReport?: () => void;
  onSaveSite: () => void;
  screening: SiteScreeningResult | null;
  showInput?: boolean;
}) {
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  return (
    <section className={isMapExpanded ? "globe-shell intelligence-shell is-map-expanded" : "globe-shell intelligence-shell"}>
      <EarthIntelligenceViewer
        activeLayer={activeLayer}
        activeSite={activeSite}
        isMapExpanded={isMapExpanded}
        isScanning={isScanning}
        onToggleMapExpanded={() => setIsMapExpanded((value) => !value)}
        screening={screening}
      />
      <SiteSearchPanel
        activeSiteTitle={activeSite?.projectName ?? null}
        canSave={canSave}
        errors={formErrors}
        formState={formState}
        isScanning={isScanning}
        onAnalyzeSite={onAnalyzeSite}
        onFormChange={onFormChange}
        onOpenAdvancedUpload={onOpenAdvancedUpload}
        onOpenReport={onOpenReport}
        onSaveSite={onSaveSite}
        showInput={showInput}
      />
      <LayerTogglePanel activeLayer={activeLayer} onLayerChange={onLayerChange} screening={screening} />
      <RiskIntelligencePanel activeSite={activeSite} screening={screening} />
    </section>
  );
}
