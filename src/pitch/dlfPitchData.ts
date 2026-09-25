// Source material for the enterprise pitch.
//
// Everything in `dlfPublicFacts` is drawn from DLF's own public disclosures or
// from credible published reporting, and each item carries its source. Nothing
// here is DLF internal data, and nothing is inferred and presented as fact.
//
// `inferredOpportunities` is clearly separated: these are TerraSignal's
// hypotheses about where the platform could help, and each one names what would
// have to be validated with DLF before it could be claimed.

export type SourcedFact = {
  id: string;
  claim: string;
  figure: string;
  period: string;
  source: string;
  sourceUrl: string;
};

export type InferredOpportunity = {
  id: string;
  segment: string;
  publicSignal: string;
  inference: string;
  platformCapability: string;
  mustValidate: string;
};

// --- What DLF publicly states ----------------------------------------------

export const dlfPublicFacts: SourcedFact[] = [
  {
    id: "presales",
    claim: "Annual residential pre-sales",
    figure: "Rs 20,143 crore",
    period: "FY26",
    source: "Construction World, reporting DLF FY26 results",
    sourceUrl:
      "https://www.constructionworld.in/policy-updates-and-economic-news/dlf-reports-strong-fy26-earnings-and-robust-sales-bookings/91675",
  },
  {
    id: "development-potential",
    claim: "Group development potential across residential and commercial",
    figure: "about 280 msf",
    period: "as disclosed in rating-agency analysis",
    source: "ICRA rating rationale on DLF Limited",
    sourceUrl: "https://www.icra.in/Rating/GetRationalReportFilePdf?id=134685",
  },
  {
    id: "monetisation",
    claim: "Planned land-bank monetisation over the medium term",
    figure: "about 61 msf (roughly 31% of development potential)",
    period: "medium term",
    source: "ICRA rating rationale on DLF Limited",
    sourceUrl: "https://www.icra.in/Rating/GetRationalReportFilePdf?id=134685",
  },
  {
    id: "pipeline",
    claim: "Medium-term residential pipeline and revenue potential",
    figure: "about 25 msf, roughly Rs 60,000 crore",
    period: "medium term",
    source: "Business Today",
    sourceUrl:
      "https://www.businesstoday.in/real-estate/story/big-opportunity-for-homebuyers-dlf-plans-rs60000-crore-launches-as-approvals-hold-up-projects-547166-2026-08-05",
  },
  {
    id: "approvals",
    claim: "Management attributed slower Q1 launches to pending regulatory clearances, describing it as a timing issue rather than weak demand",
    figure: "several planned launches delayed",
    period: "Q1 FY27",
    source: "Business Today",
    sourceUrl:
      "https://www.businesstoday.in/real-estate/story/big-opportunity-for-homebuyers-dlf-plans-rs60000-crore-launches-as-approvals-hold-up-projects-547166-2026-08-05",
  },
  {
    id: "rental",
    claim: "Group rental portfolio and occupancy",
    figure: "50 msf at about 95% occupancy",
    period: "FY26",
    source: "Construction World, reporting DLF FY26 results",
    sourceUrl:
      "https://www.constructionworld.in/policy-updates-and-economic-news/dlf-reports-strong-fy26-earnings-and-robust-sales-bookings/91675",
  },
  {
    id: "dccdl",
    claim: "DCCDL rental income (DLF-GIC joint venture)",
    figure: "Rs 5,525 crore, up 16% year on year",
    period: "FY26",
    source: "Free Press Journal",
    sourceUrl:
      "https://www.freepressjournal.in/business/dlf-gic-jvs-rental-income-climbs-16-to-5525-crore-strong-office-demand-boosts-fy26-profit-by-38",
  },
  {
    id: "geographies",
    claim: "Expansion beyond the core Gurugram/NCR market",
    figure: "Mumbai, Goa, Chennai, Hyderabad, Noida and the Chandigarh tri-city",
    period: "current strategy",
    source: "ICRA rating rationale and DLF corporate disclosures",
    sourceUrl: "https://www.icra.in/Rating/GetRationalReportFilePdf?id=134685",
  },
  {
    id: "sustainability",
    claim: "Sustainability position",
    figure: "world's largest LEED Zero Water certified office portfolio; over 45 msf LEED Platinum certified",
    period: "current",
    source: "DLF Offices sustainability disclosures",
    sourceUrl: "https://www.dlf.in/offices/sustainability",
  },
];

// --- Independently documented market context --------------------------------

export const marketContext: SourcedFact[] = [
  {
    id: "gurugram-drainage",
    claim:
      "Published analysis of Gurugram's recurring urban flooding attributes it in part to development that did not follow the city's contours, with a poorly planned drainage network",
    figure: "recurring annual urban flooding",
    period: "ongoing",
    source: "Down To Earth",
    sourceUrl: "https://www.downtoearth.org.in/environment/gurugram-is-drowning-in-its-own-choices",
  },
  {
    id: "groundwater",
    claim: "Gurugram is designated a groundwater dark zone by the Central Ground Water Board, with extraction far exceeding recharge",
    figure: "dark zone designation",
    period: "current",
    source: "Down To Earth",
    sourceUrl: "https://www.downtoearth.org.in/environment/gurugram-is-drowning-in-its-own-choices",
  },
  {
    id: "aravalli",
    claim:
      "Aravalli land status under the Punjab Land Preservation Act has been repeatedly contested and amended, affecting which land around Gurugram is developable",
    figure: "contested statutory status",
    period: "ongoing",
    source: "Shankar IAS Parliament current-affairs summary of PLPA amendments",
    sourceUrl: "https://www.shankariasparliament.com/current-affairs/amendments-to-punjab-land-preservation-act",
  },
];

// --- What TerraSignal infers could be valuable -------------------------------

export const inferredOpportunities: InferredOpportunity[] = [
  {
    id: "land-selection",
    segment: "Land and portfolio",
    publicSignal:
      "DLF publicly describes a development potential of roughly 280 msf and a medium-term monetisation plan of roughly 61 msf.",
    inference:
      "Choosing which parcels to activate first, and in what order, is a recurring capital-allocation decision across a very large inventory. A consistent, evidence-backed screening layer would let that sequencing be argued from the same data every time.",
    platformCapability:
      "Portfolio ranking: every candidate parcel scored by the same deterministic engine, re-weighted by asset class, with the gap between any two sites explained from the arithmetic.",
    mustValidate:
      "How DLF currently sequences land-bank activation, who owns that decision, and what evidence is presented today.",
  },
  {
    id: "new-geographies",
    segment: "New markets",
    publicSignal:
      "DLF is expanding beyond its core Gurugram/NCR market into Mumbai, Goa, Chennai, Hyderabad, Noida and the Chandigarh tri-city.",
    inference:
      "Screening value is highest where institutional local knowledge is thinnest. In a market DLF has operated in for decades, terrain and drainage intuition is already internalised; in a new city it is not.",
    platformCapability:
      "Identical screening methodology applied anywhere global open-data providers reach, so a Chennai parcel and a Gurugram parcel are comparable on one scale.",
    mustValidate:
      "Which new-market parcels are under evaluation, and whether DLF's existing local-partner diligence already covers this ground.",
  },
  {
    id: "terrain-drainage",
    segment: "Residential and township",
    publicSignal:
      "Independent published analysis links Gurugram's recurring flooding to development that did not follow the city's contours.",
    inference:
      "Terrain and drainage context discovered before a parcel is committed is materially cheaper to design around than the same constraint discovered after. This is precisely the class of indicator the platform samples first.",
    platformCapability:
      "Elevation relief, slope and mapped water-proximity screening on every site, with the sampled values, formula and confidence shown, plus an explicit list of what a hydrologist must still verify.",
    mustValidate:
      "Whether DLF's current pre-acquisition process already includes a terrain and drainage desktop screen, and at what stage.",
  },
  {
    id: "approvals-evidence",
    segment: "Approvals and programme",
    publicSignal:
      "DLF management has publicly attributed delayed launches to pending regulatory clearances, describing it as a timing issue.",
    inference:
      "A structured, dated evidence pack assembled at screening time will not by itself accelerate an authority's decision. It can reduce the internal turnaround when a query arrives, because the constraint questions were already framed and the data provenance already recorded.",
    platformCapability:
      "Every scan writes a durable audit snapshot: provider values, formulas, weights, confidence, AI status, and the explicit list of what requires professional verification.",
    mustValidate:
      "Where approval time is actually lost, and whether any part of it is internal evidence assembly rather than authority processing. This must be measured before any claim is made.",
  },
  {
    id: "office-retail-siting",
    segment: "Office and retail",
    publicSignal:
      "DLF's annuity business is a 50 msf rental portfolio at about 95% occupancy, with DCCDL rental income of Rs 5,525 crore in FY26.",
    inference:
      "For office and retail assets, mapped road access and the surrounding land-use mix are early proxies for reachability and catchment character. They do not predict rent or footfall, but they do separate obviously well-connected sites from obviously poorly connected ones at zero marginal cost.",
    platformCapability:
      "Asset-class weighting profiles that raise access and land-use weight for office and retail, so the same underlying screen answers a different question per asset class.",
    mustValidate:
      "Whether mapped access correlates with DLF's own leasing outcomes. This should be back-tested against completed assets before it informs a decision.",
  },
  {
    id: "underused-land",
    segment: "Annuity and asset optimisation",
    publicSignal:
      "DLF holds a large existing land position alongside an operating rental portfolio.",
    inference:
      "Land adjacent to an operating asset can be screened with the same tooling used for acquisitions, so densification and expansion candidates are evaluated on the same scale as new purchases.",
    platformCapability:
      "The capacity envelope: measured parcel geometry combined with DLF's own declared FAR and coverage parameters to size an indicative development envelope.",
    mustValidate:
      "DLF's actual permitted FAR, coverage and height parameters per parcel. TerraSignal holds none of these and cannot verify them.",
  },
];

// --- Platform capability flow -----------------------------------------------

export const platformFlow = [
  {
    id: "land",
    label: "Land",
    detail: "A coordinate, an address label, a radius, and optionally a sketched or imported boundary.",
    output: "A defined area of interest",
  },
  {
    id: "data",
    label: "Data",
    detail:
      "Open and authoritative geospatial providers are queried in parallel: elevation and terrain sampling, OpenStreetMap road, water and land-use context, and regional flood authority data where a supported dataset covers the location.",
    output: "Provider responses with citation, coverage and confidence",
  },
  {
    id: "intelligence",
    label: "Intelligence",
    detail:
      "A deterministic scoring engine converts provider values into screening indicators. Every indicator carries its formula, raw inputs, thresholds, weight and source. Indicators with no live provider are marked unavailable, never estimated.",
    output: "Explainable sub-scores",
  },
  {
    id: "risk",
    label: "Risk",
    detail:
      "Elevated indicators become named red flags. Missing data becomes its own visible risk factor rather than an unexplained gap in confidence.",
    output: "Red flags and evidence gaps",
  },
  {
    id: "feasibility",
    label: "Feasibility",
    detail:
      "Weighted screening risk, a preliminary suitability indicator, a capacity envelope from your declared planning parameters, and a readiness gate that decides whether the report may leave the building.",
    output: "Feasibility view with confidence",
  },
  {
    id: "decision",
    label: "Decision",
    detail:
      "Sites are ranked against each other on one transparent scale, and the executive view states opportunity, risk, feasibility, confidence and the single next action.",
    output: "A decision an investment committee can interrogate",
  },
];

export const differentiators = [
  {
    id: "deterministic",
    title: "The numbers are not generated by a language model",
    detail:
      "Every score comes from a deterministic engine with a published formula, named raw inputs, explicit thresholds and a stated weight. The AI layer explains those numbers and is contractually forbidden from recalculating them. You can reproduce any score by hand.",
  },
  {
    id: "unavailable",
    title: "Missing data stays missing",
    detail:
      "When a provider returns nothing, the indicator is marked unavailable and excluded from scoring. No proxy, no estimate, no silent fallback. Missing coverage becomes its own visible risk factor and pulls confidence down.",
  },
  {
    id: "readiness",
    title: "A report cannot leave the building until it qualifies",
    detail:
      "A readiness gate checks live provider coverage, the absence of mock data, completed AI analysis, a source table, a limitations table and full score explainability. Reports that fail are blocked from client export, in code, not by policy.",
  },
  {
    id: "provenance",
    title: "Measured, declared and derived are never blended",
    detail:
      "Site geometry is measured. Planning parameters are declared by you. Everything else is arithmetic over the two, labelled as such. The platform states plainly which datasets it does not hold.",
  },
  {
    id: "claims",
    title: "Unsafe language is rejected, not warned about",
    detail:
      "Generated text is scanned for claims like safe to build, guaranteed, certified or approved. A report containing one is regenerated, and if it fails again the request errors rather than shipping the claim.",
  },
  {
    id: "audit",
    title: "Every scan writes an audit trail",
    detail:
      "Provider values, formulas, weights, confidence, AI model and status, readiness decision and professional-verification requirements are persisted per scan and retrievable through the API.",
  },
];

export const securityControls = [
  { id: "auth", control: "Authentication", detail: "Scrypt password hashing with a 12-character minimum and complexity policy, HMAC-SHA256 signed session tokens with expiry, per-account lockout after repeated failed logins.", status: "implemented" },
  { id: "revocation", control: "Session revocation", detail: "Logout denylists the presented token until its own expiry, so a leaked token stops working immediately.", status: "implemented" },
  { id: "authz", control: "Authorization and tenant isolation", detail: "Every scan, run, report audit and portfolio is ownership-checked on read, write and delete. Cross-tenant requests receive 404, not 403, so record existence is not disclosed.", status: "implemented" },
  { id: "audit", control: "Audit trail", detail: "Each scan persists a durable snapshot of provider values, formulas, weights, confidence, AI provenance and readiness decision.", status: "implemented" },
  { id: "ratelimit", control: "Abuse controls", detail: "Separate rate-limit budgets for authentication, scans, model-backed endpoints, the public pilot form and general API traffic, over a bounded store.", status: "implemented" },
  { id: "ai", control: "AI containment", detail: "The model receives a sanitised projection of data the caller owns. It has no tools, no retrieval and no network reach. User text and third-party map tags are neutralised before they enter a prompt, and outputs are claim-checked.", status: "implemented" },
  { id: "headers", control: "Transport and browser controls", detail: "Content Security Policy, HSTS in production, nosniff, frame-ancestors none, strict CORS allowlist with wildcards rejected in production.", status: "implemented" },
  { id: "secrets", control: "Secret handling", detail: "Provider and model API keys are read server-side only and never reach the browser bundle. Only the Cesium visualisation token is public by design.", status: "implemented" },
  { id: "sso", control: "SSO, SCIM and org roles", detail: "Enterprise identity integration is not built. This is pilot-stage scope and is listed here rather than implied.", status: "not built" },
  { id: "residency", control: "Data residency and formal certification", detail: "No SOC 2, ISO 27001 or contractual data-residency commitment exists today. Deployment region is a deployment choice, not a certified control.", status: "not built" },
];

export const pilotPhases = [
  {
    id: "discovery",
    phase: "Phase 1",
    title: "Discovery",
    duration: "1-2 weeks",
    detail:
      "Agree three to five real sites and one live decision the platform should support. Baseline how long a site screen takes today and how long the current evaluation cycle runs. Agree the weighting profile for the relevant asset class.",
    deliverable: "A measured baseline and an agreed evaluation scope",
  },
  {
    id: "pilot",
    phase: "Phase 2",
    title: "Pilot",
    duration: "3-4 weeks",
    detail:
      "Screen the agreed sites. Produce full reports with source tables, limitations, confidence and audit snapshots. Rank them as a portfolio under the agreed weighting.",
    deliverable: "Screening reports and a ranked shortlist",
  },
  {
    id: "validation",
    phase: "Phase 3",
    title: "Validation",
    duration: "2-3 weeks",
    detail:
      "Back-test against sites your team already knows. Did the platform flag the constraints you found later by other means? Did it miss any? Compare its output with your existing workflow and with professional assessments already on file.",
    deliverable: "A written hit-rate and miss-rate assessment",
  },
  {
    id: "integration",
    phase: "Phase 4",
    title: "Integration",
    duration: "4-6 weeks",
    detail:
      "Connect the screening step into the workflow that already exists. Region-specific data adapters, enterprise identity, export formats and role model are scoped from what validation actually showed.",
    deliverable: "A screening step inside your process",
  },
  {
    id: "scale",
    phase: "Phase 5",
    title: "Scale",
    duration: "ongoing",
    detail:
      "Extend across business units, regions and asset classes. Weighting profiles are tuned from observed outcomes rather than from product defaults.",
    deliverable: "A consistent screening layer across the portfolio",
  },
];

export const beforeAfter = {
  before: [
    "Site information sits across land, technical, legal and commercial teams in different formats",
    "Each site is assessed by whoever picks it up, using whatever data they can reach that week",
    "Comparisons between sites are argued from differently-shaped evidence",
    "Terrain, drainage and access constraints surface during design or approvals, after commitment",
    "The basis for a past decision is hard to reconstruct months later",
  ],
  after: [
    "Every site enters the same pipeline: coordinate, boundary, radius, intended use",
    "The same providers and the same deterministic formulas score every site",
    "Sites are ranked on one scale, with the gap between any two explained from the arithmetic",
    "Terrain, drainage, access and land-use context are visible before capital is committed",
    "Every scan leaves an audit snapshot showing exactly which values produced which score",
  ],
};
