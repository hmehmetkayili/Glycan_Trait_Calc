import React, { useState } from 'react';
import {
  Dna,
  Calculator,
  GitBranch,
  Eye,
  PlusCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sliders,
  Upload,
  Sparkles,
  Trash2,
  Download,
  FileSpreadsheet,
} from 'lucide-react';
import { SessionSummary, TraitDefinition } from '../types';
import { api } from '../services/api';

interface CompositionAnalysisProps {
  session: SessionSummary | null;
  onSessionUpdated: (s: SessionSummary) => void;
}

export const CompositionAnalysisView: React.FC<CompositionAnalysisProps> = ({
  session,
  onSessionUpdated,
}) => {
  const [treatFAsFucose, setTreatFAsFucose] = useState<boolean>(
    session?.parser_config.treat_f_as_fucose ?? true
  );
  const [treatDhexAsFucose, setTreatDhexAsFucose] = useState<boolean>(
    session?.parser_config.treat_dhex_as_fucose ?? false
  );
  const [assumeSIsNeuAc, setAssumeSIsNeuAc] = useState<boolean>(
    session?.parser_config.assume_s_is_neuac ?? false
  );

  // Manual override editor state
  const [overrideLabel, setOverrideLabel] = useState<string>('');
  const [ovHex, setOvHex] = useState<number>(5);
  const [ovHexNAc, setOvHexNAc] = useState<number>(4);
  const [ovFuc, setOvFuc] = useState<number>(1);
  const [ovSia, setOvSia] = useState<number>(2);

  // Single-glycan contribution explainer (Section 8.1)
  const [explainLabel, setExplainLabel] = useState<string>('H5N4F1S2');
  const [explainAbund, setExplainAbund] = useState<number>(3.2);
  const [explainResult, setExplainResult] = useState<any>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const handleExplainSingleGlycan = async () => {
    setBusy(true);
    try {
      const res = await api.parseCompositions({
        labels: [explainLabel],
        treat_f_as_fucose: treatFAsFucose,
        treat_dhex_as_fucose: treatDhexAsFucose,
        assume_s_is_neuac: assumeSIsNeuAc,
        explain_glycan: explainLabel,
        explain_abundance_pct: explainAbund,
      });
      setExplainResult(res.single_glycan_explanation);
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    handleExplainSingleGlycan();
  }, []);

  const handleSaveDictionaryOrOverride = async (withOverride = false) => {
    if (!session) return;
    setBusy(true);
    try {
      const manualOverrides: Record<string, Record<string, number>> = {};
      if (withOverride && overrideLabel.trim()) {
        manualOverrides[overrideLabel.trim()] = {
          Hex: ovHex,
          HexNAc: ovHexNAc,
          Fucose: ovFuc,
          Sialic_Acid: ovSia,
        };
      }
      const res = await api.validateAndUpdateConfig({
        session_id: session.session_id,
        sample_id_col: session.sample_id_col,
        group_col: session.group_col,
        glycan_cols: session.glycan_cols,
        measurement_type: session.qc_report.measurement_type,
        apply_closure: session.qc_report.apply_closure,
        zero_handling: session.qc_report.zero_handling,
        treat_f_as_fucose: treatFAsFucose,
        treat_dhex_as_fucose: treatDhexAsFucose,
        assume_s_is_neuac: assumeSIsNeuAc,
        manual_overrides: withOverride ? manualOverrides : undefined,
      });
      onSessionUpdated(res);
    } finally {
      setBusy(false);
    }
  };

  const parsedComps = session?.qc_report?.parsed_compositions || [];
  const parsedCompInfo = explainResult?.parsed_composition || explainResult?.parsed || null;
  const traitContribList = Array.isArray(explainResult?.trait_contributions)
    ? explainResult.trait_contributions
    : [];

  const classCounts = {
    total: parsedComps.length,
    valid: parsedComps.filter((p) => p.is_valid).length,
    highMannose: parsedComps.filter(
      (p) => (p.flags?.High_Mannose_H5_H9N2 ?? p.flags?.['High_Mannose_H5-H9N2'] ?? 0) === 1
    ).length,
    paucimannose: parsedComps.filter(
      (p) => (p.flags?.Paucimannose_pool ?? p.flags?.H4N2_pool ?? 0) === 1
    ).length,
    n3Proxy: parsedComps.filter((p) => p.flags?.N3_pool_proxy === 1).length,
    n4Pool: parsedComps.filter((p) => p.flags?.N4_pool === 1).length,
    n5Pool: parsedComps.filter((p) => p.flags?.N5_pool === 1).length,
    n6Pool: parsedComps.filter((p) => p.flags?.N6_pool === 1).length,
    nge4Complex: parsedComps.filter((p) => p.flags?.Nge4_complex_candidate === 1).length,
    fucosylated: parsedComps.filter((p) => p.flags?.Fucosylated === 1).length,
    sialylated: parsedComps.filter((p) => p.flags?.Sialylated === 1).length,
  };

  return (
    <div>
      {/* Dataset Composition Class Summary Strip */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <div>
            <h3 className="gareg-card-title">
              <Dna size={18} color="#0284c7" /> Glycan Composition Stoichiometry &amp; Pool Distribution Summary
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.79rem', color: '#64748b' }}>
              Automated parser decomposition of all detected glycan compositions into Hexose (<code>H</code>), HexNAc (<code>N</code>), Fucose (<code>F</code>), and Sialic Acid (<code>S</code>) counts and mathematical pool indicators.
            </p>
          </div>
          {session && (
            <span className="badge badge-emerald">
              {classCounts.valid} / {classCounts.total} Valid Glycan Compositions Parsed
            </span>
          )}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
            gap: '10px',
          }}
        >
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>High-Mannose (H5–H9N2)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f2b46' }}>{classCounts.highMannose}</div>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Paucimannose-type (H1–H4N2F0–1)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f2b46' }}>{classCounts.paucimannose}</div>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>N3 Hybrid-Proxy Pool</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0284c7' }}>{classCounts.n3Proxy}</div>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>N4 Pool (Biantennary-Cand.)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0284c7' }}>{classCounts.n4Pool}</div>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>N5 Pool (Tri/Bisect-Cand.)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0284c7' }}>{classCounts.n5Pool}</div>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>N6 Pool (Tetra-Cand.)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0284c7' }}>{classCounts.n6Pool}</div>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 600 }}>N&ge;4 Complex-Candidate</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#15803d' }}>{classCounts.nge4Complex}</div>
          </div>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#92400e', fontWeight: 600 }}>Fucosylated (F&ge;1)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b45309' }}>{classCounts.fucosylated}</div>
          </div>
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '0.72rem', color: '#5b21b6', fontWeight: 600 }}>Sialylated (S&ge;1)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#6d28d9' }}>{classCounts.sialylated}</div>
          </div>
        </div>
      </div>
      {/* Configurable Monosaccharide Component Dictionary & Manual Override (Section 5.2) */}
      <div className="gareg-grid-2">
        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <Sliders size={18} color="#0284c7" /> Configurable Monosaccharide Component Dictionary (Section 5)
            </h3>
            {session && (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => handleSaveDictionaryOrOverride(false)}
              >
                Update Dictionary Policy
              </button>
            )}
          </div>
          <p style={{ fontSize: '0.8rem', color: '#475569', marginTop: 0 }}>
            Standard symbols: <code>H</code> = Hexose (Hex), <code>N</code> = N-acetylhexosamine (HexNAc),{' '}
            <code>F</code> = Fucose (Fuc), <code>S</code> = Sialic acid (type unspecified). Extended notation:{' '}
            <code>NeuAc</code>, <code>NeuGc</code>, <code>dHex</code>, <code>HexA</code>, <code>Pentose</code>,{' '}
            <code>Su</code> (Sulfate), <code>Phos</code> (Phosphate).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={treatFAsFucose}
                onChange={(e) => setTreatFAsFucose(e.target.checked)}
              />
              <span>
                Confirm <code>F</code> represents <strong>Fucose (Fuc)</strong> rather than an unspecified deoxyhexose (dHex)
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={treatDhexAsFucose}
                onChange={(e) => setTreatDhexAsFucose(e.target.checked)}
              />
              <span>
                Map explicit <code>dHex</code> labels to Fucose count (off by default)
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={assumeSIsNeuAc}
                onChange={(e) => setAssumeSIsNeuAc(e.target.checked)}
              />
              <span>
                Map generic <code>S</code> to <code>Neu5Ac</code> (Off by default: per Section 5.2, never automatically assume generic S is NeuAc)
              </span>
            </label>
          </div>
        </div>

        {/* Manual Composition Correction Tool (Section 5.2) */}
        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <Dna size={18} color="#7c3aed" /> Manual Composition Override / Correction
            </h3>
            <button
              className="btn btn-secondary"
              disabled={!session || !overrideLabel.trim() || busy}
              onClick={() => handleSaveDictionaryOrOverride(true)}
            >
              Apply Manual Override
            </button>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#475569', marginTop: 0 }}>
            Manually assign or correct monosaccharide counts for any composition label (recorded in Calculation Provenance).
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '8px' }}>
            <div>
              <label className="form-label">Glycan Label</label>
              <input
                className="form-control"
                style={{ width: '100%' }}
                placeholder="e.g., H5N4F1S2"
                value={overrideLabel}
                onChange={(e) => setOverrideLabel(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Hex (H)</label>
              <input
                type="number"
                min={0}
                className="form-control"
                style={{ width: '100%' }}
                value={ovHex}
                onChange={(e) => setOvHex(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="form-label">HexNAc (N)</label>
              <input
                type="number"
                min={0}
                className="form-control"
                style={{ width: '100%' }}
                value={ovHexNAc}
                onChange={(e) => setOvHexNAc(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="form-label">Fucose (F)</label>
              <input
                type="number"
                min={0}
                className="form-control"
                style={{ width: '100%' }}
                value={ovFuc}
                onChange={(e) => setOvFuc(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="form-label">Sialic (S)</label>
              <input
                type="number"
                min={0}
                className="form-control"
                style={{ width: '100%' }}
                value={ovSia}
                onChange={(e) => setOvSia(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Section 8.1: Interactive Contribution-Level Explanation Inspector */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <div>
            <h3 className="gareg-card-title">
              <Sparkles size={18} color="#0284c7" /> Interactive Single-Glycan Contribution Inspector (Section 8.1)
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.79rem', color: '#64748b' }}>
              Enter any glycan composition (e.g., <code>H5N4F1S2</code>) and relative abundance (%) to inspect its exact mathematical contribution across all traits.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              className="form-control"
              style={{ width: '150px', fontFamily: 'Consolas, monospace', fontWeight: 700 }}
              value={explainLabel}
              onChange={(e) => setExplainLabel(e.target.value)}
              placeholder="H5N4F1S2"
            />
            <input
              type="number"
              step="0.1"
              className="form-control"
              style={{ width: '95px' }}
              value={explainAbund}
              onChange={(e) => setExplainAbund(Number(e.target.value))}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>%</span>
            <button className="btn btn-primary" onClick={handleExplainSingleGlycan} disabled={busy}>
              Evaluate Contribution
            </button>
          </div>
        </div>

        {parsedCompInfo && (
          <div>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '10px', fontSize: '0.82rem' }}>
              <span className="badge badge-sky">
                Normalized: {parsedCompInfo.normalized_label || 'INVALID'}
              </span>
              <span className="badge badge-slate">Hex (H) = {parsedCompInfo.Hex ?? 0}</span>
              <span className="badge badge-slate">HexNAc (N) = {parsedCompInfo.HexNAc ?? 0}</span>
              <span className="badge badge-slate">Fucose (F) = {parsedCompInfo.Fucose ?? 0}</span>
              <span className="badge badge-slate">Sialic Acid (S) = {parsedCompInfo.Sialic_Acid ?? 0}</span>
              <span className="badge badge-amber">
                Hex Excess &gt; 3 in N&ge;4 = {parsedCompInfo.flags?.Hex_excess_over_3_in_Nge4 ?? 0}
              </span>
            </div>
            <div className="table-scroll" style={{ maxHeight: '260px', overflowY: 'auto' }}>
              <table className="gareg-table">
                <thead>
                  <tr>
                    <th>Trait ID</th>
                    <th>Trait Name</th>
                    <th>Included in Numerator?</th>
                    <th>Weight</th>
                    <th>Numerator Contribution</th>
                    <th>Included in Denominator?</th>
                    <th>Audit Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {traitContribList
                    .filter((tc: any) => tc.included_in_numerator || tc.included_in_denominator || tc.included)
                    .map((tc: any) => {
                      const incNum = Boolean(tc.included_in_numerator ?? tc.included);
                      const weightVal = tc.numerator_weight ?? tc.weight ?? 0;
                      const numContrib = Number(tc.numerator_contribution ?? 0);
                      return (
                        <tr key={tc.trait_id}>
                          <td style={{ fontWeight: 700, fontFamily: 'Consolas, monospace' }}>{tc.trait_id}</td>
                          <td style={{ fontWeight: 600 }}>{tc.trait_name}</td>
                          <td>
                            {incNum ? (
                              <span className="badge badge-emerald">Yes</span>
                            ) : (
                              <span className="badge badge-slate">No</span>
                            )}
                          </td>
                          <td>{weightVal}</td>
                          <td style={{ fontWeight: 700, color: '#0369a1' }}>
                            {incNum ? `+${numContrib.toFixed(2)} (${tc.unit || '%'})` : '0'}
                          </td>
                          <td>{tc.included_in_denominator ? 'Yes' : 'No'}</td>
                          <td style={{ fontSize: '0.76rem', color: '#475569' }}>{tc.reason}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Dataset Parsed Composition Table & Pool Indicator Flags */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <h3 className="gareg-card-title">
            Dataset Parsed Glycan Composition Map ({parsedComps.length} Glycans)
          </h3>
        </div>
        {parsedComps.length === 0 ? (
          <p style={{ fontSize: '0.84rem', color: '#64748b' }}>
            Load the reference dataset or upload your dataset to view the full parsed composition map.
          </p>
        ) : (
          <div className="table-scroll" style={{ maxHeight: '460px', overflowY: 'auto' }}>
            <table className="gareg-table">
              <thead>
                <tr>
                  <th>Glycan</th>
                  <th>Normalized</th>
                  <th>Hex (H)</th>
                  <th>HexNAc (N)</th>
                  <th>Fucose (F)</th>
                  <th>Sialic (S)</th>
                  <th>High-Man (H5–9N2)</th>
                  <th>Paucimannose (H1–4N2F0–1)</th>
                  <th>N3 Proxy</th>
                  <th>N4</th>
                  <th>N5</th>
                  <th>N6</th>
                  <th>N&ge;4 Pool</th>
                  <th>F&ge;1</th>
                  <th>S&ge;1</th>
                  <th>Hex&minus;3 (N&ge;4)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsedComps.map((pc) => (
                  <tr key={pc.raw_label}>
                    <td style={{ fontWeight: 700, fontFamily: 'Consolas, monospace' }}>{pc.raw_label}</td>
                    <td style={{ fontFamily: 'Consolas, monospace', color: '#0369a1' }}>{pc.normalized_label}</td>
                    <td>{pc.Hex}</td>
                    <td>{pc.HexNAc}</td>
                    <td>{pc.Fucose}</td>
                    <td>{pc.Sialic_Acid}</td>
                    <td>{pc.flags.High_Mannose_H5_H9N2 ?? pc.flags['High_Mannose_H5-H9N2']}</td>
                    <td>{pc.flags.Paucimannose_pool ?? pc.flags.H4N2_pool}</td>
                    <td>{pc.flags.N3_pool_proxy}</td>
                    <td>{pc.flags.N4_pool}</td>
                    <td>{pc.flags.N5_pool}</td>
                    <td>{pc.flags.N6_pool}</td>
                    <td>{pc.flags.Nge4_complex_candidate}</td>
                    <td>{pc.flags.Fucosylated}</td>
                    <td>{pc.flags.Sialylated}</td>
                    <td>{pc.flags.Hex_excess_over_3_in_Nge4}</td>
                    <td>
                      <span className={`badge ${pc.is_valid ? 'badge-emerald' : 'badge-rose'}`}>{pc.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

interface CompositionTraitsViewProps {
  session: SessionSummary | null;
  onSessionUpdated: (s: SessionSummary) => void;
  onInspectTrait: (traitId: string, sampleId?: string) => void;
}

export const CompositionTraitsView: React.FC<CompositionTraitsViewProps> = ({
  session,
  onSessionUpdated,
  onInspectTrait,
}) => {
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('ALL');
  const [traitGroupFilter, setTraitGroupFilter] = useState<string>('ALL');

  // Custom Glycan Trait Builder state (Section 18)
  const [customName, setCustomName] = useState<string>('');
  const [incComp, setIncComp] = useState<string>('Fucose');
  const [incOp, setIncOp] = useState<string>('>=');
  const [incVal, setIncVal] = useState<number>(2);
  const [hasSecondClause, setHasSecondClause] = useState<boolean>(false);
  const [incComp2, setIncComp2] = useState<string>('Sialic_Acid');
  const [incOp2, setIncOp2] = useState<string>('>=');
  const [incVal2, setIncVal2] = useState<number>(1);
  const [numWeight, setNumWeight] = useState<string>('1');
  const [hasDenom, setHasDenom] = useState<boolean>(false);
  const [denComp, setDenComp] = useState<string>('HexNAc');
  const [denOp, setDenOp] = useState<string>('>=');
  const [denVal, setDenVal] = useState<number>(4);
  const [customUnit, setCustomUnit] = useState<string>('%');
  const [customInterp, setCustomInterp] = useState<string>('');
  const [builderPreview, setBuilderPreview] = useState<any>(null);
  const [builderError, setBuilderError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  if (!session) {
    return (
      <div className="gareg-card">
        <p>Please load the GAREG reference dataset or upload your dataset first.</p>
      </div>
    );
  }

  const compRes = session.composition_results;
  const traitDefs = compRes.trait_definitions || [];
  const incMatrix = compRes.inclusion_matrix || {};
  const sampleResults = compRes.sample_results || [];
  const distinctGroups = session.qc_report.distinct_groups || [];

  const filteredDefs = traitDefs.filter((t) =>
    traitGroupFilter === 'ALL' ? true : t.Trait_Group === traitGroupFilter
  );

  const filteredSamples = sampleResults.filter((sr) =>
    selectedGroupFilter === 'ALL' ? true : sr.group === selectedGroupFilter
  );

  const buildPayload = (previewOnly: boolean) => {
    const clauses = [{ component: incComp, operator: incOp, value: incVal }];
    if (hasSecondClause) {
      clauses.push({ component: incComp2, operator: incOp2, value: incVal2 });
    }
    return {
      session_id: session.session_id,
      trait_name: customName || `${incComp} ${incOp} ${incVal} Pool`,
      inclusion_clauses: clauses,
      exclusion_clauses: [],
      numerator_weight: numWeight,
      has_denominator: hasDenom,
      denominator_clauses: hasDenom ? [{ component: denComp, operator: denOp, value: denVal }] : [],
      denominator_weight: '1',
      scale: customUnit === '%' ? 100.0 : 1.0,
      unit: customUnit,
      interpretation: customInterp,
      preview_only: previewOnly,
    };
  };

  const handlePreviewCustomTrait = async () => {
    setBusy(true);
    setBuilderError('');
    try {
      const res = await api.createOrPreviewCustomTrait(buildPayload(true));
      setBuilderPreview(res);
    } catch (err: any) {
      setBuilderError(err.message || 'Failed to preview custom trait.');
      setBuilderPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCustomTrait = async () => {
    setBusy(true);
    setBuilderError('');
    try {
      const res = await api.createOrPreviewCustomTrait(buildPayload(false));
      onSessionUpdated(res);
      setBuilderPreview(null);
      setCustomName('');
    } catch (err: any) {
      setBuilderError(err.message || 'Failed to save custom trait.');
    } finally {
      setBusy(false);
    }
  };

  const handleQuickDownload = async (format: 'xlsx' | 'csv', includeTraits: boolean) => {
    setBusy(true);
    try {
      await api.downloadNormalizedMatrix(session.session_id, format, includeTraits);
    } finally {
      setBusy(false);
    }
  };

  const uniqueTraitGroups = Array.from(new Set(traitDefs.map((t) => t.Trait_Group)));

  return (
    <div>
      {/* Interactive Explanation Banner */}
      <div className="alert-banner alert-info" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          <Calculator size={18} />
          <div>
            <strong>Mathematical Transparency &amp; Audit Trail (Sections 6–8):</strong> Click any trait row or{' '}
            <strong>&ldquo;Inspect Audit&rdquo;</strong> button below to open the interactive explanation panel showing exact mathematical formulas, inclusion/exclusion rules, numerators, denominators, and individual glycan contributions for every sample.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.76rem', padding: '6px 12px' }}
            disabled={busy}
            onClick={() => handleQuickDownload('xlsx', true)}
          >
            <FileSpreadsheet size={14} /> Export Normalized (%) + Traits (.xlsx)
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.76rem', padding: '6px 12px' }}
            disabled={busy}
            onClick={() => handleQuickDownload('xlsx', false)}
          >
            <Download size={14} /> Export Normalized (%) Only (.xlsx)
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.76rem', padding: '6px 12px' }}
            disabled={busy}
            onClick={() => handleQuickDownload('csv', true)}
          >
            <Download size={14} /> Export Normalized + Traits (.csv)
          </button>
        </div>
      </div>

      {/* Trait Definitions & Group Mean Overview Cards */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <h3 className="gareg-card-title">
            <Calculator size={18} color="#0284c7" /> Composition-Derived Glycan Traits ({filteredDefs.length} Traits)
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label className="form-label" style={{ margin: 0 }}>
              Filter by Category:
            </label>
            <select
              className="form-select"
              value={traitGroupFilter}
              onChange={(e) => setTraitGroupFilter(e.target.value)}
            >
              <option value="ALL">All Composition-Derived Categories ({traitDefs.length})</option>
              {uniqueTraitGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-scroll" style={{ maxHeight: '480px', overflowY: 'auto' }}>
          <table className="gareg-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Trait Name</th>
                <th>Category</th>
                <th>Mathematical Formula</th>
                <th>Included Glycans</th>
                {distinctGroups.map((g) => (
                  <th key={g}>{g} Mean</th>
                ))}
                <th>Unit</th>
                <th>Audit Trail</th>
              </tr>
            </thead>
            <tbody>
              {filteredDefs.map((td) => {
                const incList = incMatrix[td.Trait_ID]?.included_glycans || [];
                const grpStats = compRes.group_summaries?.by_trait?.[td.Trait_ID]?.groups || {};
                return (
                  <tr
                    key={td.Trait_ID}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onInspectTrait(td.Trait_ID)}
                  >
                    <td style={{ fontWeight: 800, fontFamily: 'Consolas, monospace', color: '#0284c7' }}>
                      {td.Trait_ID}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {td.Trait_Name}
                      {td.Is_Custom && <span className="badge badge-amber" style={{ marginLeft: '6px' }}>Custom</span>}
                      {td.Is_Optional && <span className="badge badge-slate" style={{ marginLeft: '6px' }}>Optional</span>}
                    </td>
                    <td style={{ fontSize: '0.74rem', color: '#475569' }}>{td.Trait_Group}</td>
                    <td style={{ fontFamily: 'Consolas, monospace', fontSize: '0.76rem' }}>{td.Plain_Formula}</td>
                    <td>
                      <span className="badge badge-sky">{incList.length} glycans</span>
                    </td>
                    {distinctGroups.map((g) => {
                      const mVal = grpStats[g]?.mean;
                      return (
                        <td key={g} style={{ fontWeight: 700 }}>
                          {mVal !== null && mVal !== undefined ? mVal.toFixed(3) : 'NA'}
                        </td>
                      );
                    })}
                    <td style={{ fontSize: '0.75rem', color: '#64748b' }}>{td.Unit}</td>
                    <td>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectTrait(td.Trait_ID);
                        }}
                      >
                        <Eye size={13} /> Inspect Audit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sample-Level Calculated Trait Matrix */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <h3 className="gareg-card-title">
            Sample-Level Composition-Derived Trait Matrix ({filteredSamples.length} Samples)
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label className="form-label" style={{ margin: 0 }}>
              Filter Group:
            </label>
            <select
              className="form-select"
              value={selectedGroupFilter}
              onChange={(e) => setSelectedGroupFilter(e.target.value)}
            >
              <option value="ALL">All Groups ({sampleResults.length})</option>
              {distinctGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: '420px', overflowY: 'auto' }}>
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Sample_ID</th>
                <th>Group</th>
                {filteredDefs.map((td) => (
                  <th
                    key={td.Trait_ID}
                    title={td.Trait_Name}
                    style={{ cursor: 'pointer', color: '#0284c7' }}
                    onClick={() => onInspectTrait(td.Trait_ID)}
                  >
                    {td.Trait_ID}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSamples.map((sr) => (
                <tr key={sr.sample_id}>
                  <td style={{ fontWeight: 700 }}>{sr.sample_id}</td>
                  <td>
                    <span className="badge badge-sky">{sr.group}</span>
                  </td>
                  {filteredDefs.map((td) => {
                    const v = sr.traits[td.Trait_ID];
                    return (
                      <td
                        key={td.Trait_ID}
                        style={{ cursor: 'pointer' }}
                        title={`Click to audit ${td.Trait_ID} in sample ${sr.sample_id}`}
                        onClick={() => onInspectTrait(td.Trait_ID, sr.sample_id)}
                      >
                        {v !== null && v !== undefined ? v.toFixed(3) : <span className="badge badge-amber">NA</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 18: Custom Glycan Trait Builder */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <div>
            <h3 className="gareg-card-title">
              <PlusCircle size={18} color="#0284c7" /> Custom Glycan Trait Builder (Section 18)
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.79rem', color: '#64748b' }}>
              Define new composition-based traits with automatic mathematical formula generation and contributing glycan preview.
              Structurally invalid claims (e.g., claiming core fucosylation or bisecting GlcNAc from composition alone) are automatically blocked.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={handlePreviewCustomTrait} disabled={busy}>
              Preview Formula &amp; Contributing Glycans
            </button>
            <button className="btn btn-primary" onClick={handleSaveCustomTrait} disabled={busy}>
              Save &amp; Calculate Custom Trait
            </button>
          </div>
        </div>

        {builderError && (
          <div className="alert-banner alert-error">
            <XCircle size={18} />
            <div>{builderError}</div>
          </div>
        )}

        <div className="gareg-grid-4">
          <div>
            <label className="form-label">Custom Trait Name</label>
            <input
              className="form-control"
              style={{ width: '100%' }}
              placeholder="e.g., Multifucosylated Sialylated Pool"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
          </div>

          <div>
            <label className="form-label">Primary Inclusion Rule (Component / Operator / Count)</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <select className="form-select" value={incComp} onChange={(e) => setIncComp(e.target.value)}>
                <option value="Fucose">Fucose (F)</option>
                <option value="Sialic_Acid">Sialic Acid (S)</option>
                <option value="Hex">Hexose (H)</option>
                <option value="HexNAc">HexNAc (N)</option>
                <option value="NeuAc">NeuAc</option>
                <option value="NeuGc">NeuGc</option>
              </select>
              <select className="form-select" value={incOp} onChange={(e) => setIncOp(e.target.value)}>
                <option value=">=">&ge;</option>
                <option value="=">=</option>
                <option value="<=">&le;</option>
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
              </select>
              <input
                type="number"
                min={0}
                className="form-control"
                style={{ width: '65px' }}
                value={incVal}
                onChange={(e) => setIncVal(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="form-label">
              <input
                type="checkbox"
                checked={hasSecondClause}
                onChange={(e) => setHasSecondClause(e.target.checked)}
                style={{ marginRight: '6px' }}
              />
              Second Inclusion Condition
            </label>
            {hasSecondClause ? (
              <div style={{ display: 'flex', gap: '4px' }}>
                <select className="form-select" value={incComp2} onChange={(e) => setIncComp2(e.target.value)}>
                  <option value="Sialic_Acid">Sialic Acid (S)</option>
                  <option value="Fucose">Fucose (F)</option>
                  <option value="Hex">Hexose (H)</option>
                  <option value="HexNAc">HexNAc (N)</option>
                </select>
                <select className="form-select" value={incOp2} onChange={(e) => setIncOp2(e.target.value)}>
                  <option value=">=">&ge;</option>
                  <option value="=">=</option>
                  <option value="<=">&le;</option>
                </select>
                <input
                  type="number"
                  min={0}
                  className="form-control"
                  style={{ width: '65px' }}
                  value={incVal2}
                  onChange={(e) => setIncVal2(Number(e.target.value))}
                />
              </div>
            ) : (
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', paddingTop: '6px' }}>Single condition active</div>
            )}
          </div>

          <div>
            <label className="form-label">Abundance Weighting &amp; Unit</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <select className="form-select" value={numWeight} onChange={(e) => setNumWeight(e.target.value)}>
                <option value="1">Unweighted Pool Sum (1)</option>
                <option value="F">Weighted by Fucose (F_k)</option>
                <option value="S">Weighted by Sialic Acid (S_k)</option>
                <option value="H">Weighted by Hex (H_k)</option>
                <option value="N">Weighted by HexNAc (N_k)</option>
              </select>
              <select className="form-select" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}>
                <option value="%">%</option>
                <option value="Residue equivalents">Equivalents</option>
                <option value="Ratio">Ratio</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '8px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" checked={hasDenom} onChange={(e) => setHasDenom(e.target.checked)} />
            Normalize by Denominator Pool:
          </label>
          {hasDenom && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select className="form-select" value={denComp} onChange={(e) => setDenComp(e.target.value)}>
                <option value="HexNAc">HexNAc (N)</option>
                <option value="Fucose">Fucose (F)</option>
                <option value="Sialic_Acid">Sialic Acid (S)</option>
                <option value="Hex">Hexose (H)</option>
              </select>
              <select className="form-select" value={denOp} onChange={(e) => setDenOp(e.target.value)}>
                <option value=">=">&ge;</option>
                <option value="=">=</option>
              </select>
              <input
                type="number"
                min={0}
                className="form-control"
                style={{ width: '65px' }}
                value={denVal}
                onChange={(e) => setDenVal(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        {builderPreview && (
          <div style={{ marginTop: '14px' }}>
            <div className="formula-box">
              <div>
                <strong>Generated Formula ({builderPreview.trait_definition.Trait_Name}):</strong>{' '}
                {builderPreview.trait_definition.Plain_Formula}
              </div>
              <div style={{ marginTop: '4px', color: '#fde047' }}>
                <strong>Contributing Glycans ({builderPreview.included_glycans.length}):</strong>{' '}
                {builderPreview.included_glycans.join(', ') || 'None in current dataset'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface StructureTraitsViewProps {
  session: SessionSummary | null;
  onSessionUpdated: (s: SessionSummary) => void;
  onLoadStructuralDemo: () => void;
}

export const StructureTraitsView: React.FC<StructureTraitsViewProps> = ({
  session,
  onSessionUpdated,
  onLoadStructuralDemo,
}) => {
  const [glycanId, setGlycanId] = useState<string>('H5N4S1F1');
  const [seqInput, setSeqInput] = useState<string>(
    'Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc'
  );
  const [evidenceInput, setEvidenceInput] = useState<string>(
    'Ethyl esterification linkage-specific MALDI-MS + Core fucosidase'
  );
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string>('');

  if (!session) {
    return (
      <div className="gareg-card">
        <p>Please load the GAREG reference dataset or upload your dataset first.</p>
      </div>
    );
  }

  const structRes = session.structure_results;
  const isAvailable = structRes.structural_data_available;

  const handleAddSequenceAnnotation = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api.calculateStructureTraits({
        session_id: session.session_id,
        annotations: [
          {
            glycan_id: glycanId,
            composition: glycanId,
            structure_sequence: seqInput,
            annotation_confidence: 'Confirmed',
            experimental_evidence: evidenceInput,
          },
        ],
      });
      onSessionUpdated(res);
    } catch (e: any) {
      setErr(e.message || 'Failed to add structural annotation.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearStructureAnnotations = async () => {
    setBusy(true);
    try {
      const res = await api.calculateStructureTraits({
        session_id: session.session_id,
        clear_annotations: true,
      });
      onSessionUpdated(res);
    } finally {
      setBusy(false);
    }
  };

  const handleUploadStructureFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api.uploadStructureAnnotationFile(session.session_id, file);
      onSessionUpdated(res);
    } catch (ex: any) {
      setErr(ex.message || 'Failed to upload structural annotation file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* Strict Separation & Availability Banner (Section 9.3) */}
      <div className={`alert-banner ${isAvailable ? 'alert-info' : 'alert-warning'}`}>
        <AlertTriangle size={20} />
        <div style={{ flex: 1 }}>
          <strong>Analytical Category B — Structure-Derived Glycan Traits (Section 9):</strong>{' '}
          {isAvailable ? (
            <span>{structRes.status_message}</span>
          ) : (
            <span>
              Current dataset contains <strong>composition-only labels</strong> (e.g., <code>H5N4F1S1</code>).
              Per Section 9.3, all structural traits report{' '}
              <strong>&ldquo;Not derivable from composition-only data.&rdquo;</strong> (never zero or an estimated value).
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary" onClick={onLoadStructuralDemo} disabled={busy}>
            Load Validated Structural Annotation Demo
          </button>
          {isAvailable && (
            <button className="btn btn-secondary" onClick={handleClearStructureAnnotations} disabled={busy}>
              <Trash2 size={14} /> Reset to Composition-Only Mode
            </button>
          )}
        </div>
      </div>

      {err && <div className="alert-banner alert-error">{err}</div>}

      {/* Structural Annotation Input: IUPAC-condensed / WURCS / GlycoCT Parser & File Upload */}
      <div className="gareg-grid-2">
        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <GitBranch size={18} color="#0284c7" /> Validated Structural Sequence Parser (IUPAC-condensed / WURCS / GlycoCT)
            </h3>
            <button className="btn btn-primary" onClick={handleAddSequenceAnnotation} disabled={busy}>
              Validate &amp; Annotate Glycan
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label className="form-label">Target Glycan Composition ID</label>
              <select
                className="form-select"
                style={{ width: '100%' }}
                value={glycanId}
                onChange={(e) => setGlycanId(e.target.value)}
              >
                {session.glycan_cols.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Experimental Evidence / Reference</label>
              <input
                className="form-control"
                style={{ width: '100%' }}
                value={evidenceInput}
                onChange={(e) => setEvidenceInput(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="form-label">
              Glycan Structure Sequence (IUPAC-condensed, WURCS=2.0, or GlycoCT)
            </label>
            <textarea
              className="form-control"
              rows={2}
              style={{ width: '100%', fontFamily: 'Consolas, monospace', fontSize: '0.78rem' }}
              value={seqInput}
              onChange={(e) => setSeqInput(e.target.value)}
            />
          </div>
        </div>

        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <Upload size={18} color="#7c3aed" /> Upload Structural Annotation Table (.xlsx, .csv, .tsv)
            </h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#475569', marginTop: 0 }}>
            Supported columns: <code>Glycan_ID</code>, <code>Structure_Sequence</code> (IUPAC/WURCS/GlycoCT), or explicit validated columns (<code>core_fucosylated</code>, <code>antennary_fucosylated</code>, <code>bisecting_glcnac</code>, <code>galactose_count</code>, <code>structural_class</code>, <code>antenna_count</code>, <code>alpha2_3_sialic_count</code>, <code>alpha2_6_sialic_count</code>, <code>experimental_evidence</code>).
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv"
            onChange={handleUploadStructureFile}
            disabled={busy}
            className="form-control"
            style={{ width: '100%', padding: '12px' }}
          />
        </div>
      </div>

      {/* Structural Traits S01 - S08 Status / Results Table */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <h3 className="gareg-card-title">
            Structure-Derived Glycan Traits (S01–S08) &bull;{' '}
            {isAvailable ? 'Validated Structural Mode' : 'Composition-Only Guard Active'}
          </h3>
        </div>

        {!isAvailable ? (
          <div className="table-scroll">
            <table className="gareg-table">
              <thead>
                <tr>
                  <th>Trait ID</th>
                  <th>Structural Trait Name</th>
                  <th>Calculated Output</th>
                  <th>Required Structural Evidence</th>
                  <th>Why Composition Alone Is Insufficient</th>
                </tr>
              </thead>
              <tbody>
                {structRes.not_derivable_traits.map((nd) => (
                  <tr key={nd.trait_id}>
                    <td style={{ fontWeight: 800, fontFamily: 'Consolas, monospace', color: '#b45309' }}>
                      {nd.trait_id}
                    </td>
                    <td style={{ fontWeight: 700 }}>{nd.trait_name}</td>
                    <td>
                      <span className="badge badge-amber" style={{ fontSize: '0.76rem' }}>
                        {nd.display_value}
                      </span>
                    </td>
                    <td>{nd.required_evidence}</td>
                    <td style={{ color: '#475569' }}>{nd.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-scroll" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="gareg-table">
              <thead>
                <tr>
                  <th>Sample_ID</th>
                  <th>Group</th>
                  <th>Validated Pool (%)</th>
                  <th>S01 Core Fuc (%)</th>
                  <th>S02 Antenna Fuc (%)</th>
                  <th>S03 Bisecting GlcNAc (%)</th>
                  <th>S04 True Gal (%)</th>
                  <th>S04 Mean Gal/Glycan</th>
                  <th>Paucimannose (%)</th>
                  <th>High-Man (%)</th>
                  <th>S05 Hybrid (%)</th>
                  <th>S06 Complex (%)</th>
                  <th>S07 Bi-ant (%)</th>
                  <th>S07 Tri-ant (%)</th>
                  <th>S08 &alpha;2,3 Sia (%)</th>
                  <th>S08 &alpha;2,6 Sia (%)</th>
                </tr>
              </thead>
              <tbody>
                {structRes.sample_results.map((sr) => (
                  <tr key={sr.sample_id}>
                    <td style={{ fontWeight: 700 }}>{sr.sample_id}</td>
                    <td>
                      <span className="badge badge-sky">{sr.group}</span>
                    </td>
                    <td>{sr.validated_abundance_pct?.toFixed(2)}%</td>
                    <td style={{ fontWeight: 600 }}>{sr.display_traits.S01}</td>
                    <td style={{ fontWeight: 600 }}>{sr.display_traits.S02}</td>
                    <td style={{ fontWeight: 600 }}>{sr.display_traits.S03}</td>
                    <td style={{ fontWeight: 600 }}>{sr.display_traits.S04}</td>
                    <td>{sr.display_traits.S04_MeanGal}</td>
                    <td>{sr.display_traits.S05_Pauci}</td>
                    <td>{sr.display_traits.S05_HM}</td>
                    <td>{sr.display_traits.S05}</td>
                    <td>{sr.display_traits.S06}</td>
                    <td>{sr.display_traits.S07_Bi}</td>
                    <td>{sr.display_traits.S07_Tri}</td>
                    <td>{sr.display_traits.S08_a23}</td>
                    <td>{sr.display_traits.S08_a26}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Glycan-by-Glycan Structural Annotation Audit Table */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <h3 className="gareg-card-title">
            Glycan Structural Annotation &amp; Topology Table ({structRes.validated_glycan_count} Validated /{' '}
            {structRes.unclassified_glycan_count} Composition-Only)
          </h3>
        </div>
        <div className="table-scroll" style={{ maxHeight: '380px', overflowY: 'auto' }}>
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Glycan_ID</th>
                <th>Format</th>
                <th>Confidence</th>
                <th>Core Fuc (&alpha;1,6)</th>
                <th>Antenna Fuc</th>
                <th>Bisecting GlcNAc</th>
                <th>Confirmed Gal</th>
                <th>Class</th>
                <th>Antennae</th>
                <th>&alpha;2,3 / &alpha;2,6 Sia</th>
                <th>Evidence / Parser Notes</th>
              </tr>
            </thead>
            <tbody>
              {structRes.annotation_table.map((row) => (
                <tr key={row.glycan_id}>
                  <td style={{ fontWeight: 700, fontFamily: 'Consolas, monospace' }}>{row.glycan_id}</td>
                  <td>{row.sequence_format}</td>
                  <td>
                    <span
                      className={`badge ${
                        row.has_validated_structure ? 'badge-emerald' : 'badge-amber'
                      }`}
                    >
                      {row.annotation_confidence}
                    </span>
                  </td>
                  <td>{row.core_fucosylated === null ? 'NA' : row.core_fucosylated ? 'Yes' : 'No'}</td>
                  <td>{row.antennary_fucosylated === null ? 'NA' : row.antennary_fucosylated ? 'Yes' : 'No'}</td>
                  <td>{row.bisecting_glcnac === null ? 'NA' : row.bisecting_glcnac ? 'Yes' : 'No'}</td>
                  <td>{row.galactose_count ?? 'NA'}</td>
                  <td>{row.structural_class ?? 'NA'}</td>
                  <td>{row.antenna_count ?? 'NA'}</td>
                  <td>
                    {row.alpha2_3_sialic_count !== null || row.alpha2_6_sialic_count !== null
                      ? `${row.alpha2_3_sialic_count ?? 0} / ${row.alpha2_6_sialic_count ?? 0}`
                      : 'NA'}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: '#475569' }}>
                    {row.has_validated_structure
                      ? row.experimental_evidence
                      : row.parser_validation_notes.join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
