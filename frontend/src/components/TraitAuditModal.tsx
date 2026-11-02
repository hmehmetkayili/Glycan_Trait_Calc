import React, { useEffect, useState } from 'react';
import { X, Filter, CheckCircle2, XCircle, AlertTriangle, Calculator } from 'lucide-react';
import { api } from '../services/api';
import { TraitContributionAudit } from '../types';

interface TraitAuditModalProps {
  sessionId: string;
  traitId: string | null;
  sampleIds: string[];
  initialSampleId?: string;
  onClose: () => void;
}

export const TraitAuditModal: React.FC<TraitAuditModalProps> = ({
  sessionId,
  traitId,
  sampleIds,
  initialSampleId,
  onClose,
}) => {
  const [selectedSample, setSelectedSample] = useState<string>(initialSampleId || sampleIds[0] || '');
  const [filterMode, setFilterMode] = useState<'all' | 'included' | 'excluded'>('all');
  const [audit, setAudit] = useState<TraitContributionAudit | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!traitId || !sessionId) return;
    const targetSample = selectedSample || sampleIds[0] || '';
    setLoading(true);
    setError('');
    api
      .getTraitContributionAudit(sessionId, traitId, targetSample)
      .then((res) => {
        setAudit(res);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load trait audit explanation.');
      })
      .finally(() => setLoading(false));
  }, [sessionId, traitId, selectedSample, sampleIds]);

  if (!traitId) return null;

  const filteredRows = (audit?.contributions || []).filter((r) => {
    if (filterMode === 'included') return r.included;
    if (filterMode === 'excluded') return !r.included;
    return true;
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            background: '#0f2b46',
            color: '#ffffff',
            padding: '16px 22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Calculator size={20} color="#38bdf8" />
            <div>
              <div style={{ fontSize: '0.72rem', color: '#7dd3fc', fontWeight: 700, textTransform: 'uppercase' }}>
                Interactive Trait Explanation &amp; Contribution Audit Trail (Section 8)
              </div>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                {audit ? `${audit.trait.Trait_ID}: ${audit.trait.Trait_Name}` : traitId}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              padding: '6px',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {loading && <div style={{ padding: '24px', textAlign: 'center' }}>Loading mathematical audit trail...</div>}
          {error && <div className="alert-banner alert-error">{error}</div>}

          {audit && !loading && (
            <>
              {/* Mathematical Formula & Aggregation Box */}
              <div style={{ marginBottom: '16px' }}>
                <div className="form-label">Exact Mathematical Formula &amp; Sample Aggregation</div>
                <div className="formula-box">
                  <div>
                    <strong>Symbolic Formula:</strong> {audit.trait.Mathematical_Formula}
                  </div>
                  <div style={{ marginTop: '4px', color: '#e2e8f0' }}>
                    <strong>Executable Expression:</strong> {audit.trait.Plain_Formula}
                  </div>
                  <div style={{ marginTop: '6px', color: '#fde047', fontWeight: 600 }}>
                    <strong>Sample {audit.sample_id} ({audit.group}) Calculation:</strong> {audit.aggregation_explanation}
                  </div>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="gareg-grid-4" style={{ marginBottom: '16px' }}>
                <div className="stat-card">
                  <div className="stat-label">Numerator</div>
                  <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                    {audit.numerator.toFixed(4)}
                  </div>
                  <div className="stat-sub">{audit.trait.Numerator_Definition}</div>
                </div>
                <div className="stat-card purple">
                  <div className="stat-label">Denominator</div>
                  <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                    {audit.denominator !== null ? audit.denominator.toFixed(4) : 'None (Pool/Weighted Sum)'}
                  </div>
                  <div className="stat-sub">{audit.trait.Denominator_Definition}</div>
                </div>
                <div className="stat-card emerald">
                  <div className="stat-label">Final Calculated Value</div>
                  <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                    {audit.final_value !== null ? audit.final_value.toFixed(4) : 'NA (Zero Denominator)'}
                  </div>
                  <div className="stat-sub">Unit: {audit.unit}</div>
                </div>
                <div className="stat-card amber">
                  <div className="stat-label">Included vs. Excluded Glycans</div>
                  <div className="stat-value" style={{ fontSize: '1.3rem' }}>
                    {audit.included_count} / {audit.included_count + audit.excluded_count}
                  </div>
                  <div className="stat-sub">
                    Required Components: {audit.trait.Required_Components.join(', ')}
                  </div>
                </div>
              </div>

              {/* Criteria, Biological Interpretation & Methodological Limitations */}
              <div className="gareg-card" style={{ background: '#f8fafc', padding: '14px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '0.82rem' }}>
                  <div>
                    <p style={{ margin: '0 0 6px' }}>
                      <strong>Inclusion Criteria:</strong> {audit.trait.Inclusion_Criteria}
                    </p>
                    <p style={{ margin: '0 0 6px' }}>
                      <strong>Exclusion Criteria:</strong> {audit.trait.Exclusion_Criteria}
                    </p>
                    <p style={{ margin: 0 }}>
                      <strong>Biological Interpretation:</strong> {audit.trait.Interpretation}
                    </p>
                  </div>
                  <div>
                    <div
                      style={{
                        background: '#fff7ed',
                        border: '1px solid #fed7aa',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        color: '#9a3412',
                      }}
                    >
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <AlertTriangle size={15} /> Methodological Limitations
                      </div>
                      <div>{audit.trait.Limitations}</div>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '10px', fontSize: '0.78rem', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                  <div>
                    <strong style={{ color: '#047857' }}>Included Compositions ({audit.included_count}):</strong>{' '}
                    <span style={{ fontFamily: 'Consolas, monospace' }}>
                      {audit.included_glycans.length > 0 ? audit.included_glycans.join(', ') : 'None in this dataset'}
                    </span>
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <strong style={{ color: '#64748b' }}>Excluded Compositions ({audit.excluded_count}):</strong>{' '}
                    <span style={{ fontFamily: 'Consolas, monospace' }}>
                      {audit.excluded_glycans.length > 0 ? audit.excluded_glycans.join(', ') : 'None'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sample Selector & Filter Controls for Contribution Table (Section 8.2) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                  marginBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label className="form-label" style={{ margin: 0 }}>
                    Inspect Biological Sample:
                  </label>
                  <select
                    className="form-select"
                    value={selectedSample}
                    onChange={(e) => setSelectedSample(e.target.value)}
                  >
                    {sampleIds.map((sid) => (
                      <option key={sid} value={sid}>
                        {sid}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Filter size={15} color="#64748b" />
                  <button
                    className={`btn ${filterMode === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterMode('all')}
                  >
                    All Glycans ({audit.contributions.length})
                  </button>
                  <button
                    className={`btn ${filterMode === 'included' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterMode('included')}
                  >
                    Included Only ({audit.included_count})
                  </button>
                  <button
                    className={`btn ${filterMode === 'excluded' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterMode('excluded')}
                  >
                    Excluded Only ({audit.excluded_count})
                  </button>
                </div>
              </div>

              {/* Contribution Table (Section 8.2) */}
              <div className="table-scroll" style={{ maxHeight: '360px', overflowY: 'auto' }}>
                <table className="gareg-table">
                  <thead>
                    <tr>
                      <th>Glycan</th>
                      <th>Abundance (%)</th>
                      <th>Hex (H)</th>
                      <th>HexNAc (N)</th>
                      <th>Fucose (F)</th>
                      <th>Sialic Acid (S)</th>
                      <th>Included?</th>
                      <th>Weight</th>
                      <th>Numerator Contribution</th>
                      {audit.denominator !== null && <th>Denominator Contribution</th>}
                      <th>Inclusion / Exclusion Audit Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => (
                      <tr key={r.glycan}>
                        <td style={{ fontWeight: 700, fontFamily: 'Consolas, monospace' }}>{r.glycan}</td>
                        <td>{r.abundance_pct.toFixed(4)}%</td>
                        <td>{r.Hex}</td>
                        <td>{r.HexNAc}</td>
                        <td>{r.Fucose}</td>
                        <td>{r.Sialic_Acid}</td>
                        <td>
                          {r.included ? (
                            <span className="badge badge-emerald" style={{ gap: '4px' }}>
                              <CheckCircle2 size={12} /> Yes
                            </span>
                          ) : (
                            <span className="badge badge-slate" style={{ gap: '4px' }}>
                              <XCircle size={12} /> No
                            </span>
                          )}
                        </td>
                        <td>{r.weight}</td>
                        <td style={{ fontWeight: r.included ? 700 : 400, color: r.included ? '#0369a1' : '#94a3b8' }}>
                          {r.included ? `+${r.contribution.toFixed(4)}` : '0.0000'}
                        </td>
                        {audit.denominator !== null && (
                          <td style={{ color: r.included_in_denominator ? '#7c3aed' : '#94a3b8' }}>
                            {r.denominator_contribution !== null
                              ? `+${r.denominator_contribution.toFixed(4)}`
                              : '0.0000'}
                          </td>
                        )}
                        <td style={{ fontSize: '0.76rem', color: r.included ? '#047857' : '#64748b' }}>
                          {r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
