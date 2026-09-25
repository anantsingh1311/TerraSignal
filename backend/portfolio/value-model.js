// Scenario value model.
//
// This is a transparent arithmetic model, not a forecast. Every input is
// supplied by the person running it. TerraSignal has no access to any
// organisation's internal deal data, and the model output is labelled
// illustrative everywhere it is surfaced.
//
// The model is deliberately simple enough that a CFO can check it on paper.

const finite = (value) => Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const num = (value, fallback, min, max) => (finite(value) ? clamp(value, min, max) : fallback);

export const valueModelDefaults = {
  sitesEvaluatedPerYear: 40,
  averageSiteValueCr: 250,
  acquisitionsPerYear: 4,
  screeningHoursPerSiteToday: 24,
  screeningHoursPerSiteWithPlatform: 6,
  blendedAnalystCostPerHour: 2500,
  probabilityOfCostlyConstraintPerAcquisition: 0.15,
  costOfLateConstraintDiscoveryPercent: 4,
  probabilityPlatformSurfacesConstraintEarly: 0.4,
  weeksSavedPerAcquisition: 4,
  costOfCapitalPercent: 9,
  currency: "INR",
  currencyUnitLabel: "crore",
};

export const valueModelBounds = {
  sitesEvaluatedPerYear: [1, 2000],
  averageSiteValueCr: [1, 100_000],
  acquisitionsPerYear: [0, 500],
  screeningHoursPerSiteToday: [0, 400],
  screeningHoursPerSiteWithPlatform: [0, 400],
  blendedAnalystCostPerHour: [0, 100_000],
  probabilityOfCostlyConstraintPerAcquisition: [0, 1],
  costOfLateConstraintDiscoveryPercent: [0, 60],
  probabilityPlatformSurfacesConstraintEarly: [0, 1],
  weeksSavedPerAcquisition: [0, 104],
  costOfCapitalPercent: [0, 40],
};

export const normalizeValueInputs = (input = {}) => {
  const bounded = (key) => num(input[key], valueModelDefaults[key], valueModelBounds[key][0], valueModelBounds[key][1]);
  const normalized = {
    sitesEvaluatedPerYear: Math.round(bounded("sitesEvaluatedPerYear")),
    averageSiteValueCr: bounded("averageSiteValueCr"),
    acquisitionsPerYear: Math.round(bounded("acquisitionsPerYear")),
    screeningHoursPerSiteToday: bounded("screeningHoursPerSiteToday"),
    screeningHoursPerSiteWithPlatform: bounded("screeningHoursPerSiteWithPlatform"),
    blendedAnalystCostPerHour: bounded("blendedAnalystCostPerHour"),
    probabilityOfCostlyConstraintPerAcquisition: bounded("probabilityOfCostlyConstraintPerAcquisition"),
    costOfLateConstraintDiscoveryPercent: bounded("costOfLateConstraintDiscoveryPercent"),
    probabilityPlatformSurfacesConstraintEarly: bounded("probabilityPlatformSurfacesConstraintEarly"),
    weeksSavedPerAcquisition: bounded("weeksSavedPerAcquisition"),
    costOfCapitalPercent: bounded("costOfCapitalPercent"),
  };
  // Screening the same site cannot cost more time with the tool than without it
  // in any scenario a buyer would accept, so the model refuses that shape.
  normalized.screeningHoursPerSiteWithPlatform = Math.min(
    normalized.screeningHoursPerSiteWithPlatform,
    normalized.screeningHoursPerSiteToday,
  );
  return normalized;
};

const CRORE = 10_000_000;

export const runValueModel = (rawInput = {}) => {
  const inputs = normalizeValueInputs(rawInput);

  // Lever 1 - analyst time released.
  // Hours saved per site multiplied by sites screened, at a blended rate.
  const hoursSavedPerSite = inputs.screeningHoursPerSiteToday - inputs.screeningHoursPerSiteWithPlatform;
  const analystHoursReleased = hoursSavedPerSite * inputs.sitesEvaluatedPerYear;
  const analystSavingRupees = analystHoursReleased * inputs.blendedAnalystCostPerHour;

  // Lever 2 - expected value of finding a costly constraint before committing.
  // Expected avoided cost = deals x P(constraint) x P(we surface it early) x
  // (site value x cost of discovering it late).
  const costPerLateDiscoveryRupees =
    inputs.averageSiteValueCr * CRORE * (inputs.costOfLateConstraintDiscoveryPercent / 100);
  const expectedAvoidedRupees =
    inputs.acquisitionsPerYear *
    inputs.probabilityOfCostlyConstraintPerAcquisition *
    inputs.probabilityPlatformSurfacesConstraintEarly *
    costPerLateDiscoveryRupees;

  // Lever 3 - carrying cost released by shortening the evaluation window.
  // Weeks saved on committed capital, valued at the cost of capital.
  const carryingCostRupees =
    inputs.acquisitionsPerYear *
    inputs.averageSiteValueCr *
    CRORE *
    (inputs.costOfCapitalPercent / 100) *
    (inputs.weeksSavedPerAcquisition / 52);

  const totalRupees = analystSavingRupees + expectedAvoidedRupees + carryingCostRupees;
  const toCr = (value) => Number((value / CRORE).toFixed(2));

  const levers = [
    {
      id: "analystTime",
      label: "Analyst time released",
      valueCr: toCr(analystSavingRupees),
      formula: "(hoursPerSiteToday - hoursPerSiteWithPlatform) * sitesEvaluatedPerYear * blendedAnalystCostPerHour",
      workings: `(${inputs.screeningHoursPerSiteToday} - ${inputs.screeningHoursPerSiteWithPlatform}) hours x ${inputs.sitesEvaluatedPerYear} sites x ${inputs.blendedAnalystCostPerHour} per hour`,
      confidence: "Most defensible lever. Both hour figures are observable inside your own team during a pilot.",
      evidenceNeeded: "Time-and-motion baseline for how long a site screen takes today.",
    },
    {
      id: "avoidedConstraint",
      label: "Expected value of earlier constraint discovery",
      valueCr: toCr(expectedAvoidedRupees),
      formula:
        "acquisitionsPerYear * P(costlyConstraint) * P(surfacedEarly) * (averageSiteValue * costOfLateDiscoveryPercent)",
      workings: `${inputs.acquisitionsPerYear} deals x ${inputs.probabilityOfCostlyConstraintPerAcquisition} x ${inputs.probabilityPlatformSurfacesConstraintEarly} x ${inputs.costOfLateConstraintDiscoveryPercent}% of ${inputs.averageSiteValueCr} crore`,
      confidence:
        "Least defensible lever. Both probabilities are judgement inputs and must be replaced with your own historical hit rate before this number carries weight.",
      evidenceNeeded:
        "Historical count of acquisitions where a terrain, drainage, access or land-use constraint materially changed cost or programme after commitment.",
    },
    {
      id: "carryingCost",
      label: "Carrying cost released by a shorter evaluation cycle",
      valueCr: toCr(carryingCostRupees),
      formula: "acquisitionsPerYear * averageSiteValue * costOfCapital * (weeksSaved / 52)",
      workings: `${inputs.acquisitionsPerYear} deals x ${inputs.averageSiteValueCr} crore x ${inputs.costOfCapitalPercent}% x ${inputs.weeksSavedPerAcquisition}/52 weeks`,
      confidence:
        "Moderate. Cost of capital is known; weeks saved should be measured against your own current evaluation calendar during a pilot.",
      evidenceNeeded: "Current elapsed time from site identification to shortlist decision.",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    inputs,
    levers,
    totalIllustrativeAnnualValueCr: toCr(totalRupees),
    perSiteIllustrativeValueRupees: inputs.sitesEvaluatedPerYear
      ? Math.round(totalRupees / inputs.sitesEvaluatedPerYear)
      : 0,
    analystHoursReleased: Math.round(analystHoursReleased),
    label: "Illustrative scenario model",
    disclaimers: [
      "This is a scenario calculator, not a prediction, forecast, guarantee or commitment.",
      "Every input above is supplied by you. TerraSignal has no access to any organisation's internal deal, cost, programme or return data.",
      "The output is arithmetic over your assumptions. Change an assumption and the output changes; it carries no independent evidence.",
      "The two probability inputs in the constraint lever are judgement values and should be replaced with your own historical rates before this model informs a purchasing decision.",
      "No figure here is derived from, attributed to, or validated by any third party's published or internal results.",
    ],
    validationPlan: [
      "Baseline: measure current hours per site screen and current elapsed evaluation time on a real sample.",
      "Pilot: run the platform against the same sites and measure the same two figures again.",
      "Back-test: check whether the platform's screening flags match constraints your team already knows about on completed sites.",
      "Only then substitute measured values for the assumptions above.",
    ],
  };
};

export const valueModelDefinition = () => ({
  defaults: valueModelDefaults,
  bounds: valueModelBounds,
  levers: ["analystTime", "avoidedConstraint", "carryingCost"],
  note: "All inputs are user-supplied. The model performs no lookup against any external or proprietary dataset.",
});
