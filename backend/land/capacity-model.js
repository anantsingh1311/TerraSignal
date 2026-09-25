// Development-capacity envelope.
//
// This module deliberately splits three kinds of number so a report can never
// blur them together:
//
//   measured   - computed from the boundary geometry the user supplied
//   declared   - planning parameters the user typed in from their own approvals
//                knowledge (FAR, ground coverage, efficiency, unit size)
//   derived    - arithmetic over the two above
//
// TerraSignal holds no cadastral, zoning, FAR or approval dataset. Nothing here
// is read from an authority, and the output says so explicitly.

const EARTH_RADIUS_M = 6_371_008.8;
const SQM_PER_HECTARE = 10_000;
const SQM_PER_ACRE = 4046.8564224;
const SQFT_PER_SQM = 10.763910416709722;

const toRadians = (value) => (Number(value) * Math.PI) / 180;
const finite = (value) => Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

const validRing = (boundary) =>
  Array.isArray(boundary)
    ? boundary
        .map((point) => ({ lat: Number(point?.lat), lng: Number(point?.lng) }))
        .filter((point) => finite(point.lat) && finite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180)
    : [];

// Spherical polygon area. Accurate well past the scale of any single
// development parcel and avoids having to pick a projected coordinate system.
export const polygonAreaSqm = (boundary) => {
  const ring = validRing(boundary);
  if (ring.length < 3) return null;
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    total +=
      (toRadians(next.lng) - toRadians(current.lng)) *
      (2 + Math.sin(toRadians(current.lat)) + Math.sin(toRadians(next.lat)));
  }
  const area = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return Number.isFinite(area) && area > 0 ? area : null;
};

export const polygonPerimeterMeters = (boundary) => {
  const ring = validRing(boundary);
  if (ring.length < 3) return null;
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const root =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
    total += 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(root), Math.sqrt(1 - root));
  }
  return Math.round(total);
};

export const planningDefaults = {
  floorAreaRatio: null,
  groundCoveragePercent: null,
  carpetEfficiencyPercent: 75,
  averageUnitAreaSqm: null,
  siteAreaSqmOverride: null,
};

const normalizePlanning = (planning = {}) => ({
  floorAreaRatio: finite(planning.floorAreaRatio) ? clamp(planning.floorAreaRatio, 0.05, 20) : null,
  groundCoveragePercent: finite(planning.groundCoveragePercent) ? clamp(planning.groundCoveragePercent, 1, 100) : null,
  carpetEfficiencyPercent: finite(planning.carpetEfficiencyPercent)
    ? clamp(planning.carpetEfficiencyPercent, 30, 95)
    : planningDefaults.carpetEfficiencyPercent,
  averageUnitAreaSqm: finite(planning.averageUnitAreaSqm) ? clamp(planning.averageUnitAreaSqm, 15, 2000) : null,
  siteAreaSqmOverride: finite(planning.siteAreaSqmOverride) ? clamp(planning.siteAreaSqmOverride, 50, 50_000_000) : null,
});

// Terrain does not change what is legally permitted; it changes how much of the
// permitted envelope is straightforward to build. This is expressed as an
// explicit, inspectable haircut with its own reasoning strings, never folded
// silently into the headline number.
const terrainConstraintFactor = (scan) => {
  const slope = scan?.subScores?.slopeTerrainRisk;
  const water = scan?.subScores?.drainageWaterProximityRisk;
  const notes = [];
  let factor = 1;

  if (slope?.available) {
    const meanSlope = Number(slope.rawInputs?.meanSlopeDegrees);
    if (finite(meanSlope) && meanSlope > 5) {
      const penalty = clamp((meanSlope - 5) * 0.02, 0, 0.25);
      factor -= penalty;
      notes.push(
        `Mean sampled slope of ${meanSlope} degrees applies a ${Math.round(penalty * 100)}% indicative grading and terracing allowance.`,
      );
    } else if (finite(meanSlope)) {
      notes.push(`Mean sampled slope of ${meanSlope} degrees applies no indicative terrain allowance.`);
    }
  } else {
    notes.push("No live slope indicator was available, so no terrain allowance was applied and confidence is reduced.");
  }

  if (water?.available && Number(water.score) >= 68) {
    factor -= 0.08;
    notes.push("Elevated mapped drainage and water-proximity screening applies an 8% indicative setback and stormwater allowance.");
  }

  return {
    factor: Number(clamp(factor, 0.5, 1).toFixed(3)),
    notes,
    formula: "1 - max(0, min(0.25, (meanSlopeDegrees - 5) * 0.02)) - (drainageScore >= 68 ? 0.08 : 0)",
  };
};

const capacityProvenance = () => ({
  measured: [
    "Site area, perimeter and boundary point count, computed from the polygon supplied in this scan.",
    "Slope and drainage indicators, computed from the live providers recorded in this scan's source table.",
  ],
  declared: [
    "Floor area ratio (FAR/FSI), ground coverage, carpet efficiency and average unit area are entered by the user.",
    "TerraSignal does not hold zoning, master-plan, FAR or approval datasets and does not verify these values.",
  ],
  derived: ["Every figure under 'derived' is arithmetic over the measured and declared values shown above."],
  notHeld: [
    "Land title and ownership",
    "Cadastral boundary of record",
    "Zoning, master-plan and permitted-use status",
    "Sanctioned FAR, height limits, setbacks and ground coverage",
    "Environmental, forest and heritage clearances",
    "Development charges, licences and approval status",
  ],
});

export const capacityDisclaimer =
  "This capacity envelope is an arithmetic planning aid, not a permitted development entitlement. Floor area ratio, ground coverage and efficiency are values you supplied; TerraSignal does not verify them against any master plan, licence, or authority record. Terrain allowances are screening-level indicators derived from sampled open-data terrain, not a graded design surface. A licensed architect, town planner and the relevant development authority must confirm every figure before it informs an acquisition, bid, design or financing decision.";

export const buildCapacityEnvelope = ({ scan, planning = {} } = {}) => {
  const inputs = normalizePlanning(planning);
  const measuredAreaSqm = polygonAreaSqm(scan?.location?.boundary);
  const perimeterMeters = polygonPerimeterMeters(scan?.location?.boundary);
  const siteAreaSqm = inputs.siteAreaSqmOverride ?? measuredAreaSqm;

  const areaBasis = inputs.siteAreaSqmOverride ? "declared" : measuredAreaSqm ? "measured" : "unavailable";

  const measurement = {
    basis: areaBasis,
    siteAreaSqm: siteAreaSqm ? Math.round(siteAreaSqm) : null,
    siteAreaHectares: siteAreaSqm ? Number((siteAreaSqm / SQM_PER_HECTARE).toFixed(3)) : null,
    siteAreaAcres: siteAreaSqm ? Number((siteAreaSqm / SQM_PER_ACRE).toFixed(3)) : null,
    siteAreaSqft: siteAreaSqm ? Math.round(siteAreaSqm * SQFT_PER_SQM) : null,
    boundaryPointCount: validRing(scan?.location?.boundary).length,
    perimeterMeters,
    method:
      areaBasis === "measured"
        ? "Spherical polygon area over the boundary points supplied in this scan."
        : areaBasis === "declared"
          ? "Site area was entered manually and overrides any sketched boundary."
          : "No boundary polygon or declared site area was supplied.",
  };

  const blockers = [];
  if (!siteAreaSqm) {
    blockers.push("Sketch or import a site boundary, or enter a site area, before a capacity envelope can be computed.");
  }
  if (!inputs.floorAreaRatio) {
    blockers.push("Enter the permitted floor area ratio (FAR/FSI) that applies to this parcel.");
  }

  const terrain = terrainConstraintFactor(scan);

  if (blockers.length) {
    return {
      available: false,
      blockers,
      measurement,
      planningInputs: inputs,
      terrainAllowance: terrain,
      derived: null,
      provenance: capacityProvenance(),
      disclaimer: capacityDisclaimer,
    };
  }

  const permittedBuiltUpSqm = siteAreaSqm * inputs.floorAreaRatio;
  const terrainAdjustedBuiltUpSqm = permittedBuiltUpSqm * terrain.factor;
  const saleableSqm = terrainAdjustedBuiltUpSqm * (inputs.carpetEfficiencyPercent / 100);
  const footprintSqm = inputs.groundCoveragePercent ? siteAreaSqm * (inputs.groundCoveragePercent / 100) : null;
  const indicativeFloors = footprintSqm ? Number((terrainAdjustedBuiltUpSqm / footprintSqm).toFixed(1)) : null;
  const indicativeUnits = inputs.averageUnitAreaSqm ? Math.floor(saleableSqm / inputs.averageUnitAreaSqm) : null;

  return {
    available: true,
    blockers: [],
    measurement,
    planningInputs: inputs,
    terrainAllowance: terrain,
    derived: {
      permittedBuiltUpSqm: Math.round(permittedBuiltUpSqm),
      permittedBuiltUpSqft: Math.round(permittedBuiltUpSqm * SQFT_PER_SQM),
      terrainAdjustedBuiltUpSqm: Math.round(terrainAdjustedBuiltUpSqm),
      terrainAdjustedBuiltUpSqft: Math.round(terrainAdjustedBuiltUpSqm * SQFT_PER_SQM),
      saleableSqm: Math.round(saleableSqm),
      saleableSqft: Math.round(saleableSqm * SQFT_PER_SQM),
      footprintSqm: footprintSqm ? Math.round(footprintSqm) : null,
      indicativeFloors,
      indicativeUnits,
    },
    formulas: {
      permittedBuiltUpSqm: "siteAreaSqm * floorAreaRatio",
      terrainAdjustedBuiltUpSqm: "permittedBuiltUpSqm * terrainAllowanceFactor",
      saleableSqm: "terrainAdjustedBuiltUpSqm * (carpetEfficiencyPercent / 100)",
      footprintSqm: "siteAreaSqm * (groundCoveragePercent / 100)",
      indicativeFloors: "terrainAdjustedBuiltUpSqm / footprintSqm",
      indicativeUnits: "floor(saleableSqm / averageUnitAreaSqm)",
    },
    provenance: capacityProvenance(),
    disclaimer: capacityDisclaimer,
  };
};

export const capacityUnits = { SQM_PER_HECTARE, SQM_PER_ACRE, SQFT_PER_SQM };
