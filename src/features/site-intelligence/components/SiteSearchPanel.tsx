import type { ChangeEvent, FormEvent } from "react";
import { FileText, Radar, Save, Table2 } from "lucide-react";
import type { SiteFormState } from "../types/siteIntelligence";

type SiteSearchPanelProps = {
  errors: Partial<Record<keyof SiteFormState, string>>;
  formState: SiteFormState;
  isScanning: boolean;
  onAnalyzeSite: () => void;
  onFormChange: (key: keyof SiteFormState, value: string) => void;
  onOpenAdvancedUpload: () => void;
  onOpenReport?: () => void;
  onSaveSite: () => void;
  canSave: boolean;
  showInput?: boolean;
  activeSiteTitle?: string | null;
};

export function SiteSearchPanel({
  activeSiteTitle,
  canSave,
  errors,
  formState,
  isScanning,
  onAnalyzeSite,
  onFormChange,
  onOpenAdvancedUpload,
  onOpenReport,
  onSaveSite,
  showInput = true,
}: SiteSearchPanelProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onAnalyzeSite();
  };

  const input = (key: keyof SiteFormState, label: string, type = "text") => (
    <label>
      <span>{label}</span>
      <input
        type={type}
        value={formState[key]}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onFormChange(key, event.target.value)}
      />
      {errors[key] && <small className="field-error">{errors[key]}</small>}
    </label>
  );

  return (
    <div className="globe-overlay globe-projects coordinate-panel">
      <div className="globe-kicker">
        <Radar size={16} aria-hidden="true" />
        <span>Site intelligence command</span>
      </div>
      <h2>{activeSiteTitle ?? "Paste coordinates for flyover"}</h2>
      <p>
        Provider-aware preliminary screening for land purchasers, builders, and engineering teams.
      </p>

      {showInput ? (
        <form className="coordinate-form" onSubmit={handleSubmit}>
          {input("projectName", "Project name")}
          <div className="coordinate-form-grid">
            {input("clientName", "Client / buyer name")}
            {input("companyName", "Company")}
          </div>
          <label>
            <span>Coordinates or copied map string</span>
            <input
              placeholder={`28.440402, 77.073830 or 19\u00b012'44.7"N 73\u00b008'39.3"E`}
              value={formState.coordinateInput}
              onChange={(event) => onFormChange("coordinateInput", event.target.value)}
            />
            {errors.coordinateInput && <small className="field-error">{errors.coordinateInput}</small>}
          </label>
          <div className="coordinate-form-grid compact-grid">
            {input("latitude", "Latitude", "number")}
            {input("longitude", "Longitude", "number")}
            {input("radiusMeters", "Site radius (m)", "number")}
            <label className="plot-area-field">
              <span>Plot size (optional)</span>
              <div className="plot-area-control">
                <input
                  min="0"
                  placeholder="Area"
                  type="number"
                  value={formState.approximatePlotArea}
                  onChange={(event) => onFormChange("approximatePlotArea", event.target.value)}
                />
                <select
                  aria-label="Plot area unit"
                  value={formState.plotAreaUnit}
                  onChange={(event) => onFormChange("plotAreaUnit", event.target.value)}
                >
                  <option value="sqm">sq m</option>
                  <option value="sqyd">sq yd</option>
                </select>
              </div>
              {errors.approximatePlotArea && <small className="field-error">{errors.approximatePlotArea}</small>}
              {errors.plotAreaUnit && <small className="field-error">{errors.plotAreaUnit}</small>}
            </label>
          </div>
          <div className="coordinate-form-grid">
            <label>
              <span>User role</span>
              <select value={formState.userRole} onChange={(event) => onFormChange("userRole", event.target.value)}>
                <option>Civil engineer</option>
                <option>Geotechnical consultant</option>
                <option>Builder</option>
                <option>Land purchaser</option>
              </select>
            </label>
            <label>
              <span>Intended use</span>
              <select
                value={formState.intendedUse}
                onChange={(event) => onFormChange("intendedUse", event.target.value)}
              >
                <option>Residential house</option>
                <option>Residential apartment</option>
                <option>Commercial building</option>
                <option>Warehouse</option>
                <option>Industrial facility</option>
                <option>School/hospital/public building</option>
                <option>Road</option>
                <option>Bridge</option>
                <option>Basement excavation</option> 
                <option>Retaining wall</option>
                <option>Hillside construction</option>
                <option>Coastal construction</option>
                <option>Solar farm</option>
                <option>General land purchase</option>
                <option>Mixed-use development</option>
                <option>Dam Project</option>
                <option>Underground Pipeline Project</option>
                <option>HighWay</option>
                <option>Unknown</option>
              </select>
            </label>
            {input("buildingType", "Building / land-use details")}
            {input("floors", "Floors", "number")}
          </div>
          <div className="coordinate-form-grid">
            <label>
              <span>Load category</span>
              <select
                value={formState.loadCategory}
                onChange={(event) => onFormChange("loadCategory", event.target.value)}
              >
                <option>Light</option>
                <option>Medium</option>
                <option>Heavy</option>
                <option>Unknown</option>
              </select>
            </label>
            <label>
              <span>Purchase stage</span>
              <select
                value={formState.purchaseStage}
                onChange={(event) => onFormChange("purchaseStage", event.target.value)}
              >
                <option>Before purchase</option>
                <option>After purchase</option>
                <option>Before design</option>
                <option>Before construction</option>
                <option>Inspection/review</option>
                <option>Dispute/due diligence</option>
              </select>
            </label>
           
            <label>
              <span>Report audience</span>
              <select
                value={formState.reportAudience}
                onChange={(event) => onFormChange("reportAudience", event.target.value)}
              >
                <option>Land purchaser</option>
                <option>Builder</option>
                <option>Engineering team</option>
                <option>House Buyers</option>
                <option>GeoTech Consultant</option>
              </select>
            </label>
            
          </div>
          <button className="primary-action wide" type="submit">
            <Radar size={17} aria-hidden="true" />
            Generate Intelligence Report
          </button>
        </form>
      ) : (
        <div className="scan-state">
          {activeSiteTitle ? "TerraView is showing the active coordinate screening." : "Run site intelligence to create an active site."}
        </div>
      )}

      {isScanning && (
        <div className="scan-state" role="status">
          Resolving provider status, risk layers, confidence, and report provenance...
        </div>
      )}

      <div className="globe-actions">
        <button type="button" onClick={onOpenAdvancedUpload}>
          <Table2 size={16} aria-hidden="true" />
          Advanced Upload
        </button>
        <button type="button" onClick={onSaveSite} disabled={!canSave}>
          <Save size={16} aria-hidden="true" />
          Save Analysis
        </button>
        {onOpenReport && (
          <button type="button" onClick={onOpenReport}>
            <FileText size={16} aria-hidden="true" />
            Open Report
          </button>
        )}
      </div>
    </div>
  );
}




/*


 <label>
              <span>Basement Proposed</span>
              { <select
                value={formState.}
                onChange={(event) => onFormChange("purchaseStage", event.target.value)}
              >
                <option>Before purchase</option>
                <option>After purchase</option>
                <option>Before design</option>
                <option>Before construction</option>
                <option>Inspection/review</option>
                <option>Dispute/due diligence</option>
              </select> }
            </label> 

            */
