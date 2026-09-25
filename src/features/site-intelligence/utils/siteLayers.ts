import {
  Building2,
  Droplets,
  FileCheck2,
  Layers,
  MapPinned,
  Mountain,
  RadioTower,
  Route,
  Satellite,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { GlobeLayer } from "../../../types";
import type { RiskLayerId } from "../types/siteIntelligence";

export const siteLayerOptions: Array<{
  id: RiskLayerId | "buildability";
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}> = [
  { id: "terrainSlopeRisk", label: "Terrain / slope", shortLabel: "Terrain", icon: Mountain },
  { id: "elevationRisk", label: "Elevation context", shortLabel: "Elevation", icon: MapPinned },
  { id: "drainageWaterloggingRisk", label: "Drainage / waterlogging", shortLabel: "Drainage", icon: Droplets },
  { id: "waterbodyProximityRisk", label: "Waterbody proximity", shortLabel: "Waterbody", icon: Waves },
  { id: "landCoverChangeRisk", label: "Land cover / wetness", shortLabel: "Land cover", icon: Satellite },
  { id: "seismicCodeRisk", label: "Seismic context", shortLabel: "Seismic", icon: RadioTower },
  { id: "soilUncertaintyRisk", label: "Soil uncertainty", shortLabel: "Soil", icon: Layers },
  { id: "urbanDevelopmentRisk", label: "Urban development", shortLabel: "Urban", icon: Building2 },
  { id: "legalTitlePlanningRisk", label: "Legal / planning", shortLabel: "Legal", icon: FileCheck2 },
  { id: "infrastructureAccessRisk", label: "Infrastructure / access", shortLabel: "Infra", icon: Route },
  { id: "groundwaterDewateringRisk", label: "Groundwater / dewatering", shortLabel: "Groundwater", icon: Droplets },
  { id: "dataQualityPenalty", label: "Data quality penalty", shortLabel: "Data quality", icon: Layers },
  { id: "buildability", label: "Overall buildability", shortLabel: "Overall", icon: Layers },
];

export const normalizeSiteLayer = (layer: GlobeLayer): RiskLayerId | "buildability" => {
  if (layer === "terrain") return "terrainSlopeRisk";
  if (layer === "drainage") return "drainageWaterloggingRisk";
  if (layer === "soil") return "soilUncertaintyRisk";
  if (layer === "water") return "waterbodyProximityRisk";
  if (layer === "seismic") return "seismicCodeRisk";
  if (layer === "elevation") return "elevationRisk";
  if (layer === "drainageWaterlogging") return "drainageWaterloggingRisk";
  if (layer === "waterbodyProximity") return "waterbodyProximityRisk";
  if (layer === "landCoverChange") return "landCoverChangeRisk";
  if (layer === "urbanDevelopment") return "urbanDevelopmentRisk";
  if (layer === "legalPlanning") return "legalTitlePlanningRisk";
  if (layer === "infrastructureAccess") return "infrastructureAccessRisk";
  if (layer === "groundwaterDewatering") return "groundwaterDewateringRisk";
  if (siteLayerOptions.some((option) => option.id === layer)) return layer as RiskLayerId | "buildability";
  return "buildability";
};
