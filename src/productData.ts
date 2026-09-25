import type { IntendedUse, ReportDepth, ScanInput } from "./productTypes";

export const intendedUses: Array<{ value: IntendedUse; label: string }> = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "warehouse", label: "Warehouse" },
  { value: "industrial", label: "Industrial" },
  { value: "farmland", label: "Farmland" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "mixed use", label: "Mixed use" },
  { value: "unknown/general feasibility", label: "Unknown/general feasibility" },
];

export const reportDepths: Array<{ value: ReportDepth; label: string; detail: string }> = [
  { value: "quick", label: "Quick scan", detail: "Fast red-flag screen" },
  { value: "standard", label: "Standard report", detail: "Balanced pilot workflow" },
  { value: "professional", label: "Professional report", detail: "Deeper explainability" },
];

export const defaultScanInput: ScanInput = {
  address: "Pilot parcel near Gurugram, India",
  coordinateInput: "28.4595, 77.0266",
  latitude: 28.4595,
  longitude: 77.0266,
  radiusMeters: 500,
  boundary: [],
  intendedUse: "warehouse",
  reportDepth: "standard",
  scanMode: "live",
};

export const saferLanguage = [
  "preliminary indicator",
  "screening-level analysis",
  "may indicate",
  "should be verified by certified professionals",
  "decision-support tool",
  "not a substitute for physical testing",
];

export const targetSegments = [
  "Land investors",
  "Real estate developers",
  "Builders",
  "Warehouse developers",
  "Surveyors",
  "Civil consultants",
  "Architects",
  "Infrastructure planners",
];
