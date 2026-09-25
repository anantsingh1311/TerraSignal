# TerraSignal — Land & Site Decision Intelligence

TerraSignal screens a land site before capital is committed. It samples terrain, drainage, access and land-use context from live geospatial providers, scores them with published formulas, compares candidate sites on one transparent scale, and states plainly what it does not know.

**It is a decision-support platform, not a certified report.** TerraSignal is not a geotechnical, environmental, structural, legal, surveying, planning or engineering report. It does not replace boreholes, SPT/CPT, soil laboratory testing, cadastral survey, title review, environmental assessment, planning determination or any statutory approval. Every output must be verified by qualified professionals before a purchase, design, financing, construction or legal decision.

---

## Contents

- [Product](#product)
- [Business problem](#business-problem)
- [Enterprise use case](#enterprise-use-case)
- [Architecture](#architecture)
- [Features](#features)
- [AI](#ai)
- [Security](#security)
- [Data](#data)
- [Deployment](#deployment)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)

---

## Product

TerraSignal turns a coordinate into a structured, inspectable screening record.

```
Coordinate + radius/boundary + intended use
    ↓
Live geospatial providers (elevation, terrain, OSM context, flood authority)
    ↓
Deterministic scoring engine  ──►  7 indicators, each with formula + weight + confidence
    ↓
Readiness gate  ──►  can this report leave the building?
    ↓
AI narrative (explains the numbers; never generates them)
    ↓
Report · Capacity envelope · Portfolio ranking · Executive view · Audit snapshot
```

Two things distinguish it from a dashboard:

1. **Every number is reproducible by hand.** Scores come from a deterministic engine with published formulas, named raw inputs, explicit thresholds and stated weights. The AI layer explains those numbers and is forbidden from recalculating them.
2. **Missing data stays missing.** When a provider returns nothing, the indicator is marked `unavailable` and excluded from scoring — no proxy, no estimate, no silent fallback. Missing coverage becomes its own visible risk factor and pulls confidence down.

---

## Business problem

Land is committed at the point of least information and highest reversibility cost — before design, before approvals, before most of what will drive cost is known.

Three failure modes follow:

| Problem | Consequence |
| --- | --- |
| Each site is assessed by whoever picks it up, with whatever data is reachable | Two candidate parcels arrive at a committee described in different terms; the comparison is between documents, not between sites |
| Terrain, drainage and access constraints surface during design or approvals | Cheap to design around before commitment, expensive afterwards — and observable from open geospatial data on day one |
| The basis for a past decision is hard to reconstruct | No durable record of which data produced which conclusion |

TerraSignal addresses the *screening* layer of this problem, and only that layer. It does not price land, establish title, determine zoning, or predict returns.

---

## Enterprise use case

The platform is built for organisations that evaluate many more sites than they acquire. The reference target is a large residential and commercial developer.

**What we do not claim.** TerraSignal holds no internal data from any organisation. The in-app enterprise section (`Enterprise` in the top navigation) separates three categories explicitly and never blurs them:

- **What the organisation states publicly** — sourced and linked to the original disclosure or credible reporting
- **What TerraSignal infers could be valuable** — labelled as inference, with reasoning shown
- **What must be validated with the organisation** — named for each opportunity, before any claim is treated as true

Six capability-to-need mappings are presented in that section, covering land and portfolio sequencing, new-geography screening, terrain and drainage discovery, approvals evidence assembly, office/retail siting context, and densification of existing holdings. Each states the public signal, the inference, the platform capability and the validation required.

The scenario model in that section is an **arithmetic calculator over inputs the viewer supplies**. It performs no lookup against any external or proprietary dataset, and every output is labelled illustrative. See [AI and modelling honesty](#ai).

---

## Architecture

### Frontend

- React 19 + TypeScript + Vite
- CesiumJS 3D globe (satellite basemap, ion terrain when configured, fly-to animation, radius and boundary entities) — lazy-loaded in its own chunk
- The enterprise pitch is code-split so its captured dataset is only fetched when opened

```
src/
  App.tsx                          shell, routing, auth, scan flow, report page
  productApi.ts / productTypes.ts  land-scan API client and contracts
  enterpriseTypes.ts               portfolio, capacity, assistant, scenario contracts
  PremiumGeoExperience.tsx         Cesium globe
  features/enterprise/
    PortfolioWorkspace.tsx         portfolio building, ranking, executive view, assistant
    CapacityPanel.tsx              development capacity envelope
  pitch/
    DlfPitch.tsx                   enterprise pitch experience
    PitchSiteDemo.tsx              interactive worked example
    demoCapture.ts                 captured live-provider screening output
    dlfPitchData.ts                sourced facts, inferences, pilot plan
  styles.css / enterprise.css      dark institutional design system
```

### Backend

Node.js standard-library HTTP server — no web framework, no runtime dependency beyond `pg` and the Google GenAI SDK.

```
backend/
  server.js                    routing, CORS, security headers, rate limits, authz
  auth.js                      scrypt passwords, HMAC-SHA256 sessions, lockout
  security/http-safety.js      prompt sanitisation, bounded TTL store, safe text
  land/
    coordinate-parser.js       decimal, DMS, cardinal, labelled coordinate input
    data-adapters.js           provider adapters, response cache, retry/mirrors
    scoring-engine.js          deterministic indicators, weights, readiness
    capacity-model.js          measured geometry × declared planning parameters
    gemini-analysis-service.js prompt construction, claim guard, retry, error mapping
    report-generator.js        report assembly
    pdf.js                     export with readiness gate
    sample-reports.js          cached demo reports
  portfolio/
    ranking-engine.js          asset-class weighting, renormalisation, gap explanation
    portfolio-service.js       ownership-scoped portfolio loading, executive summary
    value-model.js             scenario calculator
  ai/site-qa-service.js        grounded question answering
  report-audit.js              audit snapshots for land scans, sites and surveys
  check-postgres.js            connection diagnostic (npm run db:check)
  create-database.js           idempotent database creation (npm run db:create)
  database.js / database-postgres.js / database-adapter.js
```

### Database

**PostgreSQL only.** There is no silent SQLite fallback — if PostgreSQL is unreachable the server prints what to check and exits, rather than starting up against a different database than you expect.

Credentials come from the environment and the server **never prompts**: set either `DATABASE_URL`, or the discrete `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` variables in `.env`. `PGPASSWORD` may be empty when the server uses trust or peer authentication.

SQLite remains reachable only as an explicit opt-in (`DB_CLIENT=sqlite`), which the test suites use so they can run against `:memory:` without a database server.

#### Troubleshooting the connection

Run the diagnostic on its own — it reports the target it is dialling and branches its guidance on the actual error code:

```bash
npm run db:check
```

A shell-supplied value takes precedence over `.env`, so a candidate password can be tested without editing the file:

```bash
PGPASSWORD='candidate' npm run db:check
```

| Error | Meaning |
| --- | --- |
| `ECONNREFUSED` | Nothing listening. Server not running, or wrong `PGHOST`/`PGPORT`. |
| `28P01` with a password set | The value is wrong for that role. |
| `28P01` with no password set | Nothing was supplied — set `PGPASSWORD`. |
| SASL `client password must be a string` | No password reached the driver at all. |
| `3D000` | Database missing — `npm run db:create`. |
| `28000` | Role missing — check `PGUSER`. |

**If the `postgres` password is lost.** On a default Windows install `pg_hba.conf` uses `scram-sha-256` for every connection, so there is no passwordless route in. Resetting requires temporarily trusting local connections. Run an **elevated** PowerShell:

1. Edit `C:\Program Files\PostgreSQL\17\data\pg_hba.conf` and change the `127.0.0.1/32` and `::1/128` lines from `scram-sha-256` to `trust`.
2. `Restart-Service postgresql-x64-17`
3. `& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "ALTER USER postgres PASSWORD 'new-password';"`
4. **Revert `pg_hba.conf` to `scram-sha-256`** and restart the service again.
5. Put the new password in `.env` as `PGPASSWORD`.

Step 4 is not optional — leaving `trust` in place lets any local process connect to the database as a superuser with no credential.

Tables: `tenants`, `projects`, `survey_points`, `survey_runs`, `saved_runs`, `report_audits`, `site_portfolios`, `pilot_requests`.

User accounts remain in JSON file storage (`TERRASIGNAL_USERS_PATH`) — see [Known limitations](#known-limitations).

---

## Features

### Site screening

Enter a coordinate (decimal, DMS, cardinal or labelled), a radius of 25 m–100 km, optionally a boundary polygon, an intended use and a report depth. The platform returns:

- Seven screening indicators, each carrying formula, raw inputs, thresholds, normalised score, weight, weighted contribution, confidence, provider sources, limitations and required professional verification
- Overall risk score, preliminary suitability indicator and confidence
- Red flags, positive indicators and recommended next steps
- A full source table and limitations table
- A readiness decision

**Indicators:** slope/terrain risk, elevation variability, drainage and water proximity, flood context, infrastructure and access, land-use context, and data-availability confidence.

### Readiness gate

A report cannot be exported as a client deliverable until it qualifies — enforced in code, not by policy:

| State | Meaning | Client export |
| --- | --- | --- |
| `internalDemo` | Mock indicators, internal testing only | Blocked |
| `unavailable` | Insufficient live provider coverage to score responsibly | Blocked |
| `clientPreview` | Partial live-data screening preview | Allowed with visible limitations |
| `clientDeliverableEligible` | Minimum live data package satisfied, no mock providers in scoring, AI analysis completed, source table, limitations table and full score explainability present | Allowed |

### Portfolio ranking

Compare up to 25 screened sites on one scale. Ranking introduces **no new measurement** — it re-weights the deterministic sub-scores each site already produced.

- Six asset-class weighting profiles: residential, office/IT park, retail, warehouse, industrial, balanced. Each ships with its rationale, and every weight is editable in the UI.
- Factors with no live provider are dropped and the remaining weights renormalised to sum to 1, so a site is never flattered by an indicator nobody could measure.
- An evidence penalty of 0.25 points per percent of unbacked profile weight is subtracted, so a data-poor site cannot out-rank a well-evidenced one on silence alone.
- The gap between any two sites is explained from the arithmetic — not by a language model.

```
appliedWeight       = profileWeight / sum(profileWeight of available factors)
contribution        = factorRiskScore × appliedWeight
weightedRiskScore   = sum(contribution)
evidencePenalty     = (100 − weightCoverage) × 0.25
opportunityScore    = clamp(100 − weightedRiskScore − evidencePenalty, 0, 100)
```

### Executive decision view

Five cards, each derived from the ranking rather than restated independently: **Opportunity**, **Risk**, **Feasibility**, **Confidence**, **Next action** — plus a prioritised action queue and an explicit scope disclaimer.

### Development capacity envelope

Splits three kinds of number and never blends them:

- **Measured** — site area, perimeter and boundary point count computed by spherical polygon area from the boundary you supplied; slope and drainage indicators from the recorded live providers
- **Declared** — FAR/FSI, ground coverage, carpet efficiency and average unit area, entered by you from your own approvals knowledge
- **Derived** — arithmetic over the two above, with every formula shown

The panel also lists what TerraSignal **does not hold**: title, cadastral boundary of record, zoning and permitted use, sanctioned FAR and height limits, environmental clearances, and licence or approval status.

### Grounded site assistant

Ask questions across up to eight of your own screened sites. The model receives a sanitised projection of those records and nothing else. It has no tools, no retrieval and no network reach. If the answer is not in the supplied records it must reply `Insufficient data.` and name what is missing.

### Report and audit trail

Every land scan persists an audit snapshot: provider values, fetch status, formulas, weights, confidence, AI provenance (model, status, claim-guard note), readiness decision and professional-verification requirements. Retrievable at `/api/reports/:id/audit`, `/raw`, `/scoring` and `/validation`.

### 3D geospatial visualisation

CesiumJS globe with satellite basemap, Cesium ion terrain when configured, camera fly-in on coordinate selection, radius and polygon entities, and layer controls for imagery, terrain, contours, slope, water/drainage, roads and land-use context. Rendered with `requestRenderMode` so the globe is idle when nothing changes, and lazy-loaded so it never blocks first paint.

---

## AI

### Model and configuration

Google Gemini (`GEMINI_MODEL`, default `gemini-2.5-flash`) through the official `@google/genai` SDK, server-side only. The API key is read from `process.env.GEMINI_API_KEY` and never reaches the browser bundle.

### What the AI does and does not do

| Does | Does not |
| --- | --- |
| Explains deterministic scores in plain language | Generate, recalculate or override any score |
| Names what data is missing and why it matters | Fill a gap from general knowledge about a location |
| Recommends professional verification per finding | Assert geological, legal, environmental, pricing or market facts |
| Writes the report narrative and executive summary | Decide readiness — that is a code gate |

### Prompt construction

The model receives a trimmed, sanitised projection: location, radius, intended use, provider outputs (normalised indicators only, never raw dumps), source table, limitations, deterministic scores with formulas and weights, missing indicators, red flags and the disclaimer. Raw provider blobs are excluded — they cost latency and add injection surface without improving the narrative.

### Safety mechanisms

1. **Claim guard.** Generated text is scanned for banned claims (`safe to build`, `guaranteed`, `certified report`, `approved`, `legally safe`, `earthquake safe`, …). A report containing one is regenerated; if it fails again, the request errors rather than shipping the claim.
2. **Schema validation.** Missing or malformed required fields trigger a stricter regeneration. Report generation fails loudly rather than emitting a partial narrative.
3. **Prompt-injection containment.** User-supplied address labels and third-party OpenStreetMap tags are user- and public-editable. Both are sanitised before entering a prompt: control characters, code fences and role-tag shapes are stripped, instruction-shaped phrases neutralised, and lengths capped. The system prompt states that every value inside the payload is data and never an instruction.
4. **No tools, no retrieval, no network.** The model cannot call a function, fetch a URL or read the database. Its entire world is the JSON in the request.
5. **Ownership re-check.** The assistant re-verifies ownership of every scan id at request time, so a scan id cannot be used to read another tenant's record through the AI path.
6. **Error classification.** Upstream provider failures are mapped to short operator-facing messages; the raw payload stays in the server log.
7. **Bounded retries.** Up to `GEMINI_MAX_ATTEMPTS` (default 3) for transient failures. Quota and credential failures are not retried.

### Limitations

- The narrative is only as good as the deterministic input. If four of seven indicators are unavailable, the AI will say so — it cannot compensate.
- The claim guard is a keyword filter. It catches the phrasings that matter most but is not a semantic proof of safety.
- Report generation **requires** a working AI provider. Without it, scan creation fails with a clear error rather than emitting a report with no narrative.

---

## Security

### Implemented

| Control | Detail |
| --- | --- |
| Password storage | scrypt with per-user salt, 12-character minimum with complexity policy, timing-safe comparison |
| Sessions | HMAC-SHA256 signed tokens with expiry; timing-safe signature comparison |
| Session revocation | Logout denylists the presented token until its own expiry |
| Brute-force protection | Per-account lockout after repeated failed logins, plus per-IP auth rate limiting |
| Authorization | Every scan, run, report audit and portfolio is ownership-checked on read, write and delete |
| Tenant isolation | Cross-tenant requests receive `404`, not `403`, so record existence is not disclosed |
| Record identifiers | Server-minted; a client-supplied id can never target another record |
| Rate limiting | Separate budgets for auth, scans, model-backed endpoints, the public pilot form and general API traffic, over a bounded store |
| Prompt-injection defence | User text and third-party map tags sanitised before entering any prompt |
| Path traversal | Static file paths normalised and constrained with a separator-aware boundary check |
| Payload limits | Request bodies capped at 2 MB; boundary polygons capped at 100 points |
| Security headers | CSP, HSTS in production, `nosniff`, `frame-ancestors: none`, `referrer-policy: no-referrer`, restrictive `permissions-policy` |
| CORS | Explicit allowlist; wildcard origins rejected at startup in production |
| Secret handling | Provider and model keys are server-side only; only the Cesium visualisation token is public by design |
| Error exposure | Internal errors return a generic message; details stay in the server log |
| Audit trail | Every scan persists provider values, formulas, weights, confidence, AI provenance and readiness decision |

### Not implemented

These are named rather than implied:

- **SSO, SCIM and organisation-level roles.** No enterprise identity integration.
- **Formal certification.** No SOC 2, ISO 27001 or contractual data-residency commitment. Deployment region is a deployment choice, not a certified control.
- **User storage in PostgreSQL.** Accounts remain in JSON file storage.
- **Encryption at rest, key management, backups, monitoring.** Deployment-layer concerns not configured here.
- **Billing and entitlement enforcement.** Plan fields exist but are not enforced.

---

## Data

### Providers

| Provider | Type | Coverage | Requires | Used for |
| --- | --- | --- | --- | --- |
| Open-Meteo Elevation | open data | global | none | Elevation sampling, derived slope |
| OpenTopography DEM | open data | global | `OPENTOPOGRAPHY_API_KEY` | Higher-fidelity DEM sampling |
| USGS 3DEP | authoritative | US | none | Point elevation for US coordinates |
| UK Environment Agency | authoritative | England | none | Flood-area context |
| OpenStreetMap / Overpass | open data | global | `OVERPASS_API_URL` | Roads, water, land use, utilities |
| Cesium ion terrain | commercial | global | `CESIUM_ION_TOKEN` | Visualisation metadata only |
| Mapbox | commercial | global | `MAPBOX_ACCESS_TOKEN` | Visual layer metadata only |

Every provider response records `dataMode`, `sourceType`, `regionCoverage`, `confidence`, `citation`, `attribution`, `limitations` and `errors`, and all of it reaches the report.

### Assumptions and their consequences

- **Slope is derived, not measured.** Where a dedicated slope provider is unavailable, slope is derived from sampled elevation relief across the radius. This is a screening proxy, not a graded surface.
- **Sampling is radial, not parcel-shaped.** Nine points across the radius, not a full-coverage grid. Local features between sample points are not seen.
- **OSM completeness varies by region.** Absence of a mapped road does not mean absence of a road.
- **Provider caching.** Responses are cached for `PROVIDER_CACHE_TTL_MS` (default 15 min) keyed on rounded coordinate, radius and mode. Two scans of the same point inside that window return identical provider values.

### Data TerraSignal does not hold

Stated in the product wherever it could matter: land title and ownership, cadastral boundary of record, zoning and permitted use, sanctioned FAR/height/setbacks, environmental/forest/heritage clearances, development charges and licence status, soil and geotechnical properties, seismic classification, contamination history, groundwater levels, market pricing and absorption.

### Professional verification required

Every report names what must be verified. At minimum: topographic survey; geotechnical investigation with boreholes, SPT/CPT and laboratory testing; cadastral boundary survey; title and legal due diligence; zoning and planning determination; official floodplain and drainage records; utility and legal access confirmation; environmental assessment.

---

## Deployment

### Local development

```bash
npm install
cp .env.example .env
```

Set at minimum `JWT_SECRET`, `CORS_ORIGIN`, `VITE_API_BASE_URL`, `GEMINI_API_KEY` and your PostgreSQL credentials (`PGPASSWORD`, or a full `DATABASE_URL`).

Create the database and verify the connection in one step:

```bash
npm run db:setup
```

That runs `db:create` (creates the database if missing, idempotent) then `db:check` (confirms the connection). Tables are created automatically on first server start.

Then run the backend:

```bash
npm run api
```

```bash
npm run dev
```

Open `http://127.0.0.1:5173`.

### Production-style single-origin run

```bash
npm run build
```

```bash
NODE_ENV=production npm run api
```

The backend serves the built frontend from `dist/` on the same origin, so no cross-origin configuration is needed.

### Production checklist

- `NODE_ENV=production` — startup fails without `JWT_SECRET`, and rejects wildcard CORS
- Set `DATABASE_URL` (or the `PG*` variables); migrations run on connect
- Terminate TLS at a reverse proxy and forward `X-Forwarded-Proto` / `X-Forwarded-For`
- Set `PROVIDER_USER_AGENT` to identify your deployment to public geodata providers
- Set `OVERPASS_API_MIRRORS` so a single overloaded host does not degrade screening
- Rotate any key that has been used in development before it reaches a shared environment

---

## Environment variables

Never commit real values. `.env` is gitignored; `.env.example` is the template.

### Required

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Session signing key. 32+ characters. Startup fails without it in production. |
| `GEMINI_API_KEY` | Server-side AI provider key. Report generation fails without it. |
| `CORS_ORIGIN` | Comma-separated allowlist. Wildcard rejected in production. |
| `VITE_API_BASE_URL` | API base URL for the frontend during Vite development. |

### Providers

| Variable | Default | Purpose |
| --- | --- | --- |
| `OVERPASS_API_URL` | — | OpenStreetMap Overpass endpoint |
| `OVERPASS_API_MIRRORS` | — | Comma-separated fallback endpoints, rotated across retries |
| `OVERPASS_MAX_ATTEMPTS` | `3` | Retry budget for Overpass |
| `PROVIDER_USER_AGENT` | TerraSignal identifier | Sent on every outbound provider request; **required by Overpass** |
| `PROVIDER_CACHE_TTL_MS` | `900000` | Provider response cache TTL; `0` disables |
| `OPENTOPOGRAPHY_API_KEY` | — | OpenTopography DEM |
| `OPEN_METEO_ELEVATION_URL` | Open-Meteo endpoint | Override for testing |
| `OPEN_METEO_ELEVATION_DISABLED` | `false` | Disable the no-key elevation provider |
| `CESIUM_ION_TOKEN` / `VITE_CESIUM_ION_TOKEN` | — | Cesium terrain (the `VITE_` value is public by design) |
| `MAPBOX_ACCESS_TOKEN` | — | Mapbox visual layers |

### AI

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model id |
| `GEMINI_TIMEOUT_MS` | `12000` | Per-request timeout |
| `GEMINI_THINKING_BUDGET` | `0` | Extended-thinking token budget. `0` is deliberate: the deterministic engine has already done the reasoning. |
| `GEMINI_MAX_OUTPUT_TOKENS` | `8192` | Output ceiling |
| `GEMINI_MAX_ATTEMPTS` | `3` | Retry budget for transient failures |

### Persistence and limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | Full PostgreSQL connection string. Takes precedence over the `PG*` variables. |
| `PGHOST` / `PGPORT` | `127.0.0.1` / `5432` | PostgreSQL host and port |
| `PGDATABASE` | `terrasignal` | Database name |
| `PGUSER` | `postgres` | Role |
| `PGPASSWORD` | — | Password. Set once in `.env`; the server never prompts. Empty is valid under trust/peer auth. |
| `PGSSL` | `false` | Enable TLS to the database |
| `DB_CLIENT` | `postgresql` | Storage engine. Only the test suites override this, to `sqlite`. |
| `TERRASIGNAL_DB_PATH` | `data/terrasignal.sqlite` | SQLite path when `DB_CLIENT=sqlite`; `:memory:` for tests |
| `TERRASIGNAL_USERS_PATH` | `data/users.json` | User store (internal testing only) |
| `SCAN_MODE` | `live` | `live`, `mixed` or `internalDemo` |
| `ALLOW_INTERNAL_DEMO` | `false` | Permit mock scans in production |
| `AUTH_RATE_LIMIT_MAX` | `8` | Auth requests per window |
| `SCAN_RATE_LIMIT_MAX` | `40` | Scans per window |
| `AI_RATE_LIMIT_MAX` | `30` | Model-backed requests per window |
| `API_RATE_LIMIT_MAX` | `600` | General API requests per window |
| `PILOT_RATE_LIMIT_MAX` | `5` | Public pilot-form submissions per hour |
| `TERRASIGNAL_API_KEY` | — | Optional additional `x-api-key` gate on all endpoints |

---

## Testing

```bash
npm run validate:all
```

Runs backend syntax checks, TypeScript, ESLint, the MVP validation suites and the API smoke test.

Individual suites:

```bash
npm run check:backend
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run validate:mvp
```

```bash
npm run smoke:api
```

```bash
npm run build
```

### Enterprise end-to-end suite

Requires a running API. Covers authorization, tenant isolation, portfolio ranking, the capacity envelope, the scenario model, the pilot form, the grounded assistant, prompt-injection resistance, session revocation and path traversal.

```bash
BASE=http://127.0.0.1:8787/api npm run test:enterprise
```

Checks that depend on live providers or the AI provider are reported as **skipped**, never silently passed, when those are unavailable.

### Results at time of writing

| Suite | Result |
| --- | --- |
| `check:backend` | pass (33 modules) |
| `typecheck` | pass, 0 errors |
| `lint` | pass, 0 errors |
| `validate:mvp` | pass (5 suites) |
| `smoke:api` | pass, authentication enforced |
| `build` | pass |
| `test:enterprise` | **40/40 checks passed, 0 skipped** |

---

## Known limitations

**Coverage**

- Flood context is only scored where a supported flood authority dataset covers the location. There is no India, US or global flood adapter — those regions return `unavailable`, not an estimate.
- No soil, geology or seismic provider is implemented. Those indicators are always `unavailable`.
- No geocoder. The address field is a label; screening is driven by coordinates.
- Boundary drawing is an approximate sketch, not a cadastral or survey boundary tool.

**Operational**

- Scan latency is roughly 20 seconds, dominated by report generation. Provider queries run in parallel and are cached.
- Provider quality depends on public endpoints. Overpass in particular sheds load under bursts; retries and mirrors mitigate this but cannot eliminate it.
- A free-tier AI provider plan will exhaust its daily quota quickly under demo load. Screening scores are unaffected when this happens — only the narrative fails, with a clear message.

**Platform**

- User accounts are in JSON file storage, not the database.
- No organisations, SSO, SCIM or role hierarchy beyond `user` / `admin`.
- No billing or entitlement enforcement.
- The PDF export is a lightweight text renderer, not a designed report template.
- Weighting profiles are TerraSignal product defaults, not an industry standard, and should be agreed with the acquiring team before use.
- The legacy geophysical survey workflow (`/api/projects`, `/api/runs`, `/api/analyze`) remains in the backend and is authenticated, but its frontend (`src/LegacyApp.tsx`) is not mounted.

---

## Roadmap

**Data depth** — regional flood, soil, geology and seismic adapters starting with the highest-value market; user upload of borehole logs, survey levels, GeoJSON, KML and shapefiles; higher-resolution DEM where licensing permits.

**Decision workflow** — saved comparison sets shared across a team; change tracking when a re-scan moves a score; approval-evidence pack export.

**Enterprise platform** — user and session storage in PostgreSQL; organisations, SSO and SCIM; role hierarchy beyond `user` / `admin`; per-tenant audit log export; entitlement and quota enforcement.

**Deliverables** — designed PDF report template; API access for programmatic screening; scheduled re-screening of a watched portfolio.

**Validation** — back-testing weighting profiles against completed projects; calibration of screening thresholds with certified geotechnical, civil, environmental and surveying professionals.

---

## API reference

### Authentication
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout          revokes the presented token
GET    /api/auth/profile
```

### Land scans
```
GET    /api/land-scans
POST   /api/land-scans
GET    /api/land-scans/:id
DELETE /api/land-scans/:id
GET    /api/land-scans/:id/pdf
POST   /api/land-scans/:id/capacity
```

### Portfolio
```
GET    /api/ranking-profiles
GET    /api/portfolios
POST   /api/portfolios
GET    /api/portfolios/:id
POST   /api/portfolios/:id
DELETE /api/portfolios/:id
POST   /api/portfolios/:id/rank      re-rank without persisting
```

### Intelligence
```
POST   /api/site-qa
GET    /api/value-model
POST   /api/value-model
```

### Audit
```
GET    /api/reports/:id/audit
GET    /api/reports/:id/raw
GET    /api/reports/:id/scoring
GET    /api/reports/:id/validation
POST   /api/reports/:id/validate
```

### Other
```
GET    /api/health
GET    /api/sample-reports
POST   /api/pilot-requests
GET    /api/admin/users | /scans | /metrics | /pilot-requests
```

All endpoints except `/api/health`, `/api/sample-reports`, `/api/value-model`, `/api/ranking-profiles`, `POST /api/pilot-requests` and the static reference catalogs require authentication.

---

## Disclaimer

TerraSignal provides preliminary site intelligence and screening-level land risk indicators only. It is a decision-support tool and is not a certified geotechnical, environmental, structural, legal, surveying, planning or engineering report. It does not replace certified geotechnical surveys, boreholes, SPT/CPT, soil laboratory testing, civil or structural engineering, environmental consulting, legal due diligence, title review, planning checks, boundary surveys, or other qualified professional services. Results must be verified by certified professionals before land purchase, design, financing, construction, safety or legal decisions.
