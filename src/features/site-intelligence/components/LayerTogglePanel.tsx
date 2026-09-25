import { Layers } from "lucide-react";
import type { GlobeLayer, SiteScreeningResult } from "../../../types";
import { normalizeSiteLayer, siteLayerOptions } from "../utils/siteLayers";
import { ProviderStatusBadge } from "./ProviderStatusBar";

export function LayerTogglePanel({
  activeLayer,
  onLayerChange,
  screening,
}: {
  activeLayer: GlobeLayer;
  onLayerChange: (layer: GlobeLayer) => void;
  screening: SiteScreeningResult | null;
}) {
  const normalizedActive = normalizeSiteLayer(activeLayer);

  return (
    <div className="globe-overlay globe-layers">
      <div className="globe-kicker">
        <Layers size={16} aria-hidden="true" />
        <span>Risk layers</span>
      </div>
      <div className="layer-toggle-grid intelligence-layer-grid">
        {siteLayerOptions.map((layer) => {
          const Icon = layer.icon;
          const assessment = layer.id === "buildability" ? null : screening?.layerAssessments[layer.id];
          return (
            <button
              className={normalizedActive === layer.id ? "is-active" : ""}
              key={layer.id}
              type="button"
              onClick={() => onLayerChange(layer.id as GlobeLayer)}
              title={layer.label}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{layer.shortLabel}</span>
              {assessment?.value !== null && assessment?.value !== undefined && <b>{assessment.value}</b>}
              {assessment && <ProviderStatusBadge label="Source" status={assessment.status} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
