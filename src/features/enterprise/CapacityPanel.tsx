import { useState } from "react";
import { Building2, Calculator, Info, Loader2, Ruler } from "lucide-react";
import { computeCapacity } from "../../productApi";
import type { CapacityEnvelope } from "../../enterpriseTypes";

// The capacity envelope is the one place in the product where a user's own
// planning assumptions meet TerraSignal's measured geometry. The panel keeps
// the three provenance classes visibly separate, because conflating them is how
// a screening tool starts looking like an entitlement opinion.

const numberOrEmpty = (value: string) => (value === "" ? "" : Number(value));

const formatSqm = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : `${value.toLocaleString("en-IN")} m²`;
const formatSqft = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : `${value.toLocaleString("en-IN")} sq ft`;

export function CapacityPanel({ scanId, token }: { scanId: string; token: string }) {
  const [form, setForm] = useState({
    floorAreaRatio: "" as number | "",
    groundCoveragePercent: "" as number | "",
    carpetEfficiencyPercent: 75 as number | "",
    averageUnitAreaSqm: "" as number | "",
    siteAreaSqmOverride: "" as number | "",
  });
  const [envelope, setEnvelope] = useState<CapacityEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const compute = async () => {
    if (!token) {
      setError("Sign in to compute a capacity envelope.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const planning: Record<string, number> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value !== "" && Number.isFinite(Number(value))) planning[key] = Number(value);
      }
      const response = await computeCapacity(token, scanId, planning);
      setEnvelope(response.capacity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to compute a capacity envelope.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel capacity-panel">
      <div className="panel-title">
        <h2>Development capacity envelope</h2>
        <span>Measured geometry x your declared planning parameters</span>
      </div>

      <div className="callout info">
        <Info size={16} aria-hidden="true" />
        TerraSignal holds no zoning, master-plan, FAR or approval dataset. Enter the planning parameters that apply to
        this parcel from your own approvals knowledge; the platform measures the site and does the arithmetic.
      </div>

      <div className="capacity-inputs">
        <label>
          <span>Permitted FAR / FSI</span>
          <input
            type="number"
            step="0.05"
            min="0.05"
            max="20"
            placeholder="e.g. 1.75"
            value={form.floorAreaRatio}
            onChange={(event) => setForm({ ...form, floorAreaRatio: numberOrEmpty(event.target.value) })}
          />
        </label>
        <label>
          <span>Ground coverage %</span>
          <input
            type="number"
            min="1"
            max="100"
            placeholder="e.g. 35"
            value={form.groundCoveragePercent}
            onChange={(event) => setForm({ ...form, groundCoveragePercent: numberOrEmpty(event.target.value) })}
          />
        </label>
        <label>
          <span>Carpet efficiency %</span>
          <input
            type="number"
            min="30"
            max="95"
            value={form.carpetEfficiencyPercent}
            onChange={(event) => setForm({ ...form, carpetEfficiencyPercent: numberOrEmpty(event.target.value) })}
          />
        </label>
        <label>
          <span>Average unit area (m²)</span>
          <input
            type="number"
            min="15"
            max="2000"
            placeholder="e.g. 140"
            value={form.averageUnitAreaSqm}
            onChange={(event) => setForm({ ...form, averageUnitAreaSqm: numberOrEmpty(event.target.value) })}
          />
        </label>
        <label>
          <span>Site area override (m²)</span>
          <input
            type="number"
            min="50"
            placeholder="Leave blank to use the sketched boundary"
            value={form.siteAreaSqmOverride}
            onChange={(event) => setForm({ ...form, siteAreaSqmOverride: numberOrEmpty(event.target.value) })}
          />
        </label>
      </div>

      <button className="primary-action" type="button" disabled={busy} onClick={() => void compute()}>
        {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Calculator size={16} aria-hidden="true" />}
        {busy ? "Computing..." : "Compute envelope"}
      </button>

      {error && <div className="error-box">{error}</div>}

      {envelope && (
        <div className="capacity-result">
          <div className="capacity-measurement">
            <h3>
              <Ruler size={15} aria-hidden="true" /> Measured
            </h3>
            <dl>
              <div>
                <dt>Site area</dt>
                <dd>
                  {formatSqm(envelope.measurement.siteAreaSqm)}
                  {envelope.measurement.siteAreaAcres !== null && ` (${envelope.measurement.siteAreaAcres} acres)`}
                </dd>
              </div>
              <div>
                <dt>Basis</dt>
                <dd>{envelope.measurement.basis}</dd>
              </div>
              <div>
                <dt>Boundary points</dt>
                <dd>{envelope.measurement.boundaryPointCount}</dd>
              </div>
              <div>
                <dt>Perimeter</dt>
                <dd>{envelope.measurement.perimeterMeters ? `${envelope.measurement.perimeterMeters} m` : "n/a"}</dd>
              </div>
            </dl>
            <p className="muted">{envelope.measurement.method}</p>
          </div>

          {!envelope.available && (
            <div className="callout caution">
              <ul>
                {envelope.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}

          {envelope.available && envelope.derived && (
            <>
              <div className="capacity-derived">
                <h3>
                  <Building2 size={15} aria-hidden="true" /> Derived envelope
                </h3>
                <div className="capacity-tiles">
                  <article>
                    <span>Permitted built-up</span>
                    <strong>{formatSqm(envelope.derived.permittedBuiltUpSqm)}</strong>
                    <small>{formatSqft(envelope.derived.permittedBuiltUpSqft)}</small>
                  </article>
                  <article>
                    <span>Terrain-adjusted built-up</span>
                    <strong>{formatSqm(envelope.derived.terrainAdjustedBuiltUpSqm)}</strong>
                    <small>allowance factor {envelope.terrainAllowance.factor}</small>
                  </article>
                  <article>
                    <span>Indicative saleable</span>
                    <strong>{formatSqm(envelope.derived.saleableSqm)}</strong>
                    <small>{formatSqft(envelope.derived.saleableSqft)}</small>
                  </article>
                  <article>
                    <span>Indicative units</span>
                    <strong>{envelope.derived.indicativeUnits ?? "n/a"}</strong>
                    <small>
                      {envelope.derived.indicativeFloors ? `~${envelope.derived.indicativeFloors} floors` : "set ground coverage"}
                    </small>
                  </article>
                </div>
              </div>

              <div className="terrain-allowance">
                <h4>Terrain allowance</h4>
                <ul>
                  {envelope.terrainAllowance.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <code>{envelope.terrainAllowance.formula}</code>
              </div>

              <details className="methodology">
                <summary>Formulas used</summary>
                <table className="formula-table">
                  <tbody>
                    {Object.entries(envelope.formulas || {}).map(([key, formula]) => (
                      <tr key={key}>
                        <th>{key}</th>
                        <td>
                          <code>{formula}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}

          <div className="provenance-grid">
            <article>
              <h4>Measured by TerraSignal</h4>
              <ul>
                {envelope.provenance.measured.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article>
              <h4>Declared by you</h4>
              <ul>
                {envelope.provenance.declared.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="not-held">
              <h4>Not held by TerraSignal</h4>
              <ul>
                {envelope.provenance.notHeld.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>

          <p className="fine-print">{envelope.disclaimer}</p>
        </div>
      )}
    </section>
  );
}
