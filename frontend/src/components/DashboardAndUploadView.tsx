import React, { useState } from 'react';
import {
  LayoutDashboard,
  Upload,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  FileSpreadsheet,
  Sliders,
  Info,
  ArrowRight,
  Download,
  Database,
  Layers,
} from 'lucide-react';
import { SessionSummary, ClassificationRow } from '../types';
import { NavTabId } from './Navbar';
import { api } from '../services/api';

interface DashboardProps {
  session: SessionSummary | null;
  classificationTable: ClassificationRow[];
  loading: boolean;
  onLoadDemo: (withStructure: boolean, datasetId?: string) => void;
  onNavigate: (tab: NavTabId) => void;
}

export const DashboardView: React.FC<DashboardProps> = ({
  session,
  classificationTable,
  loading,
  onLoadDemo,
  onNavigate,
}) => {
  const m = session?.dashboard_metrics;
  const qc = session?.qc_report;
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(
    session?.active_demo_id || 'serum_igg_crc_raw_areas'
  );
  const [templateBusy, setTemplateBusy] = useState<boolean>(false);

  React.useEffect(() => {
    if (session?.active_demo_id) {
      setSelectedDatasetId(session.active_demo_id);
    }
  }, [session?.active_demo_id]);

  const handleDownloadTemplate = async (
    templateType:
      | 'raw_area_template'
      | 'relative_pct_template'
      | 'metadata_template'
      | 'structural_template'
      | 'active_dataset',
    format: 'xlsx' | 'csv' = 'xlsx'
  ) => {
    setTemplateBusy(true);
    try {
      await api.downloadDataTemplate(templateType, format, session?.session_id);
    } finally {
      setTemplateBusy(false);
    }
  };

  const handleQuickExportNormalized = async (format: 'xlsx' | 'csv', includeTraits: boolean) => {
    if (!session) return;
    setTemplateBusy(true);
    try {
      await api.downloadNormalizedMatrix(session.session_id, format, includeTraits);
    } finally {
      setTemplateBusy(false);
    }
  };

  const demoDatasets = session?.available_demo_datasets || [
    {
      id: 'serum_igg_crc_raw_areas',
      title: 'Human Serum IgG N-Glycomics Cohort (CRC vs Adenoma vs Healthy — Raw Peak Areas)',
      description:
        '36 clinical serum IgG samples × 30 N-glycans measured as Raw UPLC-FLR/MS Peak Areas with clinical metadata (Age, Sex, Stage, Batch). Demonstrates automatic Total Area Normalization (TAN → %) and PQN.',
      measurement_type: 'peak_area',
      sample_count: 36,
      glycan_count: 30,
    },
    {
      id: 'plasma_total_nglycome_diabetes',
      title: 'Human Plasma Total N-Glycome Cohort (T2D & Diabetic Nephropathy vs Healthy — Relative %)',
      description:
        '30 clinical plasma samples × 26 N-glycans (High-Mannose, Hybrid, Complex Bi/Tri/Tetra-antennary) pre-normalized to Relative Abundance (%) with Age & HbA1c metadata.',
      measurement_type: 'relative_abundance_pct',
      sample_count: 30,
      glycan_count: 26,
    },
    {
      id: 'gareg_formula_reference',
      title: 'GAREG Formula Validation Benchmark Dataset (CDH vs LDH — 41 Samples × 37 Glycans)',
      description:
        'Original GAREG 41-sample × 37-glycan benchmark cohort used for mathematical cross-validation of all 28 baseline composition traits.',
      measurement_type: 'relative_abundance_pct',
      sample_count: 41,
      glycan_count: 37,
    },
  ];

  return (
    <div>
      {/* Hero / Quick Start Banner */}
      <div
        className="gareg-card"
        style={{
          background: 'linear-gradient(135deg, #0f2b46 0%, #0c4a6e 100%)',
          color: '#ffffff',
          border: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ maxWidth: '760px' }}>
            <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              GAREG Scientific Glycomics Platform &bull; Raw Peak Area Normalization &amp; Trait Engine
            </div>
            <h2 style={{ margin: '6px 0 8px', fontSize: '1.45rem', fontWeight: 800 }}>
              Automated Glycomic Composition-Derived &amp; Structure-Derived Trait Analyzer
            </h2>
            <p style={{ margin: 0, fontSize: '0.86rem', color: '#e0f2fe', lineHeight: 1.55 }}>
              Upload either <strong>Raw Peak Areas / Intensities</strong> (automatically normalized via Total Area Normalization, PQN, Quantile, Median Scaling, or Base Peak) or <strong>Relative Abundances (%)</strong>. Export normalized abundance matrices and auditable glycan traits in Excel and CSV formats.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <button
              className="btn btn-primary"
              disabled={loading}
              onClick={() => onLoadDemo(false, selectedDatasetId)}
              style={{ background: '#38bdf8', color: '#0f172a', fontWeight: 700 }}
            >
              <Play size={15} /> Load Selected Ready Dataset
            </button>
            <button
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => onLoadDemo(true, selectedDatasetId)}
              style={{ background: 'rgba(255,255,255,0.12)', color: '#ffffff', borderColor: 'rgba(255,255,255,0.3)' }}
            >
              <Play size={15} /> Load with Structural Annotation Demo
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => onNavigate('upload')}
              style={{ background: '#ffffff', color: '#0f2b46', fontWeight: 700 }}
            >
              <Upload size={15} /> Upload Custom Dataset / Normalize Raw Areas
            </button>
          </div>
        </div>
      </div>

      {/* Ready Dataset Selector & Downloadable Data Templates Card */}
      <div className="gareg-grid-2">
        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <Database size={18} color="#0284c7" /> Built-In Ready Datasets (Raw Peak Areas &amp; Relative %)
            </h3>
            <span className="badge badge-sky">3 Ready Cohorts</span>
          </div>
          <p style={{ fontSize: '0.79rem', color: '#475569', marginTop: 0 }}>
            Select any built-in clinical or benchmark glycomics dataset below to inspect raw peak area normalization, composition-derived traits, and statistical comparisons:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {demoDatasets.map((ds) => {
              const isSelected = selectedDatasetId === ds.id;
              return (
                <div
                  key={ds.id}
                  onClick={() => {
                    setSelectedDatasetId(ds.id);
                    onLoadDemo(false, ds.id);
                  }}
                  style={{
                    border: isSelected ? '2px solid #0284c7' : '1px solid #e2e8f0',
                    background: isSelected ? '#f0f9ff' : '#ffffff',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f2b46' }}>{ds.title}</div>
                    <span className={`badge ${ds.measurement_type === 'peak_area' ? 'badge-amber' : 'badge-emerald'}`}>
                      {ds.measurement_type === 'peak_area' ? 'Raw Peak Areas → TAN %' : 'Relative Abundance (%)'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '4px' }}>{ds.description}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <Download size={18} color="#059669" /> Download Data Templates &amp; Normalized Matrices
            </h3>
            <span className="badge badge-emerald">.xlsx &amp; .csv Templates</span>
          </div>
          <p style={{ fontSize: '0.79rem', color: '#475569', marginTop: 0 }}>
            Download ready-to-fill data templates with built-in formatting instructions so you know the exact column structure for raw peak areas, relative abundances, metadata, or structural annotations:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', fontSize: '0.77rem' }}
              disabled={templateBusy}
              onClick={() => handleDownloadTemplate('raw_area_template', 'xlsx')}
            >
              <FileSpreadsheet size={14} color="#0284c7" /> 1. Raw Peak Area / Intensity Template (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', fontSize: '0.77rem' }}
              disabled={templateBusy}
              onClick={() => handleDownloadTemplate('relative_pct_template', 'xlsx')}
            >
              <FileSpreadsheet size={14} color="#059669" /> 2. Relative Abundance (%) Template (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', fontSize: '0.77rem' }}
              disabled={templateBusy}
              onClick={() => handleDownloadTemplate('metadata_template', 'xlsx')}
            >
              <FileSpreadsheet size={14} color="#7c3aed" /> 3. Sample Clinical Metadata Template (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', fontSize: '0.77rem' }}
              disabled={templateBusy}
              onClick={() => handleDownloadTemplate('structural_template', 'xlsx')}
            >
              <FileSpreadsheet size={14} color="#d97706" /> 4. Structural Annotation Template (.xlsx)
            </button>
          </div>
          <div
            style={{
              borderTop: '1px solid #e2e8f0',
              paddingTop: '10px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <button
              className="btn btn-primary"
              style={{ fontSize: '0.77rem' }}
              disabled={templateBusy || !session}
              onClick={() => handleDownloadTemplate('active_dataset', 'xlsx')}
            >
              <Download size={14} /> Download Active Dataset (.xlsx)
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: '0.77rem', background: '#059669' }}
              disabled={templateBusy || !session}
              onClick={() => handleQuickExportNormalized('xlsx', false)}
            >
              <FileSpreadsheet size={14} /> Export Normalized Relative Abundance (%) (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.77rem' }}
              disabled={templateBusy || !session}
              onClick={() => handleQuickExportNormalized('xlsx', true)}
            >
              <FileSpreadsheet size={14} /> Export Normalized (%) + Traits (.xlsx)
            </button>
          </div>
        </div>
      </div>

      {/* 8 Mandatory Initial Dashboard Cards (Section 3) */}
      <div className="gareg-grid-4">
        <div className="stat-card">
          <div className="stat-label">1. Total Number of Samples</div>
          <div className="stat-value">{m ? m.total_samples : 0}</div>
          <div className="stat-sub">
            {m ? `${m.active_samples} active samples included in trait calculations` : 'Upload or load a dataset to begin'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">2. Identified Glycan Compositions</div>
          <div className="stat-value">{m ? m.identified_glycan_compositions : 0}</div>
          <div className="stat-sub">
            {qc ? `Parsing success rate: ${qc.parsing_success_rate_pct.toFixed(1)}%` : 'Monosaccharide H/N/F/S parser'}
          </div>
        </div>

        <div className="stat-card purple">
          <div className="stat-label">3. Experimental Groups</div>
          <div className="stat-value">{m ? m.experimental_groups_count : 0}</div>
          <div className="stat-sub">
            {m && Object.keys(m.experimental_groups).length > 0
              ? Object.entries(m.experimental_groups)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' • ')
              : 'No groups loaded'}
          </div>
        </div>

        <div className="stat-card emerald">
          <div className="stat-label">4. Composition-Derived Traits Available</div>
          <div className="stat-value">{m ? m.composition_traits_available : 36}</div>
          <div className="stat-sub">
            28 Baseline (T01–T28) + 8 Optional{m && m.custom_composition_traits > 0 ? ` + ${m.custom_composition_traits} Custom` : ''}
          </div>
        </div>

        <div className="stat-card amber">
          <div className="stat-label">5. Structure-Derived Traits Available</div>
          <div className="stat-value">{m ? m.structure_traits_available : 8}</div>
          <div className="stat-sub">S01–S08 (Requires validated linkage/branch evidence)</div>
        </div>

        <div className="stat-card emerald">
          <div className="stat-label">6. Successfully Calculated Traits</div>
          <div className="stat-value">{m ? m.successfully_calculated_traits : 0}</div>
          <div className="stat-sub">Auditable sample-level &amp; group-level traits</div>
        </div>

        <div className="stat-card amber">
          <div className="stat-label">7. Traits Not Derivable (Insufficient Structure)</div>
          <div className="stat-value">{m ? m.traits_not_derivable_insufficient_structure : 8}</div>
          <div className="stat-sub">Reported as &ldquo;Not derivable&rdquo;, never as 0</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">8. Data Quality Warnings</div>
          <div className="stat-value">{m ? m.qc_warnings_count : 0}</div>
          <div className="stat-sub">
            {qc?.is_clr_blocked ? 'CLR / Negative Values Blocked!' : 'All 9 consistency rules monitored'}
          </div>
        </div>
      </div>

      {/* Active Data Quality Warnings on Dashboard */}
      {qc && (qc.blocking_errors.length > 0 || qc.warnings.length > 0) && (
        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <AlertTriangle size={18} color="#d97706" /> Active Data Quality Warnings &amp; Notices
            </h3>
            <button className="btn btn-secondary" onClick={() => onNavigate('qc')}>
              Open Full Quality Control Module <ArrowRight size={14} />
            </button>
          </div>
          {qc.blocking_errors.map((err, idx) => (
            <div key={idx} className="alert-banner alert-error">
              <XCircle size={18} />
              <div>{err}</div>
            </div>
          ))}
          {qc.warnings.map((w, idx) => (
            <div key={idx} className={`alert-banner ${w.severity === 'info' ? 'alert-info' : 'alert-warning'}`}>
              <AlertTriangle size={17} />
              <div>
                <strong>{w.category}:</strong> {w.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Section 10: Dedicated Composition and Structure Classification Table (Visible before starting analysis) */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <div>
            <h3 className="gareg-card-title">
              <LayoutDashboard size={18} color="#0284c7" /> Composition vs. Structure Trait Classification Table (Section 10)
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Fundamental epistemological boundary: The system never reports a composition-derived estimate as an experimentally established structural trait.
            </p>
          </div>
          {session && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary" onClick={() => onNavigate('comp_traits')}>
                Explore Composition-Derived Traits <ArrowRight size={14} />
              </button>
              <button className="btn btn-amber" onClick={() => onNavigate('struct_traits')}>
                Explore Structure-Derived Traits <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="table-scroll">
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Trait</th>
                <th>Analytical Category</th>
                <th>Composition Data Sufficient?</th>
                <th>Structural Annotation Required?</th>
                <th>Scientific Rationale &amp; Epistemological Boundary</th>
              </tr>
            </thead>
            <tbody>
              {classificationTable.map((row, i) => {
                const isComp = row.composition_data_sufficient.startsWith('Yes');
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 700 }}>{row.trait}</td>
                    <td>
                      <span className={`badge ${isComp ? 'badge-sky' : 'badge-amber'}`}>{row.category}</span>
                    </td>
                    <td>
                      <span className={`badge ${isComp ? 'badge-emerald' : 'badge-rose'}`}>
                        {row.composition_data_sufficient}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${row.structural_annotation_required === 'No' ? 'badge-slate' : 'badge-amber'}`}>
                        {row.structural_annotation_required}
                      </span>
                    </td>
                    <td style={{ color: '#475569' }}>{row.scientific_rationale}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface UploadDataViewProps {
  session: SessionSummary | null;
  loading: boolean;
  onSessionUpdated: (s: SessionSummary) => void;
  onNavigate: (tab: NavTabId) => void;
}

export const UploadDataView: React.FC<UploadDataViewProps> = ({
  session,
  loading,
  onSessionUpdated,
  onNavigate,
}) => {
  const [uploadError, setUploadError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<'normalized_pct' | 'raw' | 'custom_scale'>('normalized_pct');

  const [sampleIdCol, setSampleIdCol] = useState<string>(session?.sample_id_col || '');
  const [groupCol, setGroupCol] = useState<string>(session?.group_col || '');
  const [measurementType, setMeasurementType] = useState<string>(
    session?.qc_report.measurement_type || 'relative_abundance_pct'
  );
  const [normalizationMethod, setNormalizationMethod] = useState<string>(
    session?.normalization_method || 'total_area_pct'
  );
  const [applyClosure, setApplyClosure] = useState<boolean>(session?.qc_report.apply_closure ?? true);
  const [zeroHandling, setZeroHandling] = useState<string>(
    session?.qc_report.zero_handling || 'true_biological_absence'
  );

  React.useEffect(() => {
    if (session) {
      setSampleIdCol(session.sample_id_col);
      setGroupCol(session.group_col || '');
      setMeasurementType(session.qc_report.measurement_type);
      setNormalizationMethod(session.normalization_method || 'total_area_pct');
      setApplyClosure(session.qc_report.apply_closure);
      setZeroHandling(session.qc_report.zero_handling);
    }
  }, [session]);

  const handleDownloadTemplate = async (
    templateType:
      | 'raw_area_template'
      | 'relative_pct_template'
      | 'metadata_template'
      | 'structural_template'
      | 'active_dataset',
    format: 'xlsx' | 'csv' = 'xlsx'
  ) => {
    setBusy(true);
    try {
      await api.downloadDataTemplate(templateType, format, session?.session_id);
    } finally {
      setBusy(false);
    }
  };

  const handleExportNormalized = async (format: 'xlsx' | 'csv', includeTraits: boolean) => {
    if (!session) return;
    setBusy(true);
    try {
      await api.downloadNormalizedMatrix(session.session_id, format, includeTraits);
    } finally {
      setBusy(false);
    }
  };

  const handleAbundanceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setUploadError('');
    try {
      const res = await api.uploadData(file);
      onSessionUpdated(res);
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleMetadataUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;
    setBusy(true);
    setUploadError('');
    try {
      const res = await api.uploadMetadata(session.session_id, file);
      onSessionUpdated(res);
    } catch (err: any) {
      setUploadError(err.message || 'Metadata upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleApplyConfiguration = async () => {
    if (!session) return;
    setBusy(true);
    setUploadError('');
    try {
      const res = await api.validateAndUpdateConfig({
        session_id: session.session_id,
        sample_id_col: sampleIdCol,
        group_col: groupCol || null,
        glycan_cols: session.glycan_cols,
        measurement_type: measurementType,
        normalization_method: normalizationMethod,
        apply_closure: normalizationMethod !== 'none_as_is' ? true : applyClosure,
        zero_handling: zeroHandling,
        treat_f_as_fucose: session.parser_config.treat_f_as_fucose ?? true,
        treat_dhex_as_fucose: session.parser_config.treat_dhex_as_fucose ?? false,
        assume_s_is_neuac: session.parser_config.assume_s_is_neuac ?? false,
      });
      onSessionUpdated(res);
    } catch (err: any) {
      setUploadError(err.message || 'Configuration update failed.');
    } finally {
      setBusy(false);
    }
  };

  const normCatalog = session?.normalization_methods_catalog || {
    total_area_pct: 'Total Area Normalization (TAN → Relative Abundance %, Sum = 100%)',
    total_area_prop: 'Total Area Normalization (Proportion 0–1, Sum = 1.0)',
    pqn_pct: 'Probabilistic Quotient Normalization (PQN + Closure %)',
    median_scaling_pct: 'Upper-Quartile (Q75 / Median) Scaling + Closure (%)',
    quantile_pct: 'Empirical Quantile Normalization + Closure (%)',
    base_peak_pct: 'Base Peak Normalization (% of Maximum Peak = 100%)',
    none_as_is: 'No Additional Normalization (Use Uploaded Values As-Is)',
  };

  const activePreviewRows =
    previewMode === 'normalized_pct'
      ? session?.normalized_preview_rows || session?.preview_rows || []
      : previewMode === 'custom_scale'
      ? session?.normalized_custom_rows || session?.normalized_preview_rows || session?.preview_rows || []
      : session?.preview_rows || [];

  return (
    <div>
      {uploadError && (
        <div className="alert-banner alert-error">
          <XCircle size={18} />
          <div>{uploadError}</div>
        </div>
      )}

      {/* Downloadable Data Format Templates Card */}
      <div className="gareg-card" style={{ background: '#f8fafc', borderColor: '#bae6fd' }}>
        <div className="gareg-card-header" style={{ marginBottom: '8px' }}>
          <div>
            <h3 className="gareg-card-title">
              <Download size={18} color="#0284c7" /> Download Data Templates (.xlsx &amp; .csv) Before Uploading
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.79rem', color: '#475569' }}>
              Download ready-to-use Excel or CSV templates with built-in instructions for either <strong>Raw Peak Areas / Intensities</strong> (automatically normalized to `%` via Total Area Normalization) or <strong>Pre-Normalized Relative Abundances (`%`)</strong>:
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.76rem' }}
            disabled={busy}
            onClick={() => handleDownloadTemplate('raw_area_template', 'xlsx')}
          >
            <FileSpreadsheet size={14} /> Raw Peak Area / Intensity Template (.xlsx)
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.76rem' }}
            disabled={busy}
            onClick={() => handleDownloadTemplate('raw_area_template', 'csv')}
          >
            <Download size={14} /> Raw Peak Area Template (.csv)
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.76rem', background: '#059669' }}
            disabled={busy}
            onClick={() => handleDownloadTemplate('relative_pct_template', 'xlsx')}
          >
            <FileSpreadsheet size={14} /> Relative Abundance (%) Template (.xlsx)
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.76rem' }}
            disabled={busy}
            onClick={() => handleDownloadTemplate('metadata_template', 'xlsx')}
          >
            <FileSpreadsheet size={14} color="#7c3aed" /> Sample Metadata Template (.xlsx)
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.76rem' }}
            disabled={busy}
            onClick={() => handleDownloadTemplate('structural_template', 'xlsx')}
          >
            <FileSpreadsheet size={14} color="#d97706" /> Structural Annotation Template (.xlsx)
          </button>
        </div>
      </div>

      <div className="gareg-grid-2">
        {/* Primary Abundance Table Upload */}
        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <Upload size={18} color="#0284c7" /> 1. Upload Glycomic Abundance or Raw Peak Area Dataset (.xlsx, .csv, .tsv)
            </h3>
          </div>
          <p style={{ fontSize: '0.82rem', color: '#475569', marginTop: 0 }}>
            Upload either <strong>Raw Peak Areas / Intensities</strong> or <strong>Relative Abundances (%)</strong>. Rows = Biological Samples (<code>Sample_ID</code>, <code>Group</code>), Columns = Glycan Compositions
            (e.g., <code>H4N2</code>, <code>H5N2</code>, <code>H3N3F1</code>, <code>H4N4F1</code>, <code>H5N4S1F1</code>).
            When raw peak areas or intensities are uploaded, the platform automatically computes <strong>Total Area Normalization (TAN &rarr; %)</strong> while preserving your raw data intact.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv"
            onChange={handleAbundanceUpload}
            disabled={busy || loading}
            className="form-control"
            style={{ width: '100%', padding: '12px' }}
          />
        </div>

        {/* Separate Sample Metadata File Upload */}
        <div className="gareg-card">
          <div className="gareg-card-header">
            <h3 className="gareg-card-title">
              <FileSpreadsheet size={18} color="#7c3aed" /> 2. Optional Separate Sample Metadata File
            </h3>
          </div>
          <p style={{ fontSize: '0.82rem', color: '#475569', marginTop: 0 }}>
            Upload clinical or experimental metadata (<code>Sample_ID</code>, <code>Group</code>, <code>Age</code>,{' '}
            <code>Gender</code>, <code>Disease stage</code>, <code>Treatment status</code>, <code>Batch</code>).
            Automatically matched with the abundance matrix using <code>Sample_ID</code>.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv"
            onChange={handleMetadataUpload}
            disabled={!session || busy || loading}
            className="form-control"
            style={{ width: '100%', padding: '12px' }}
          />
          {session?.metadata_merge_report && (
            <div className="alert-banner alert-info" style={{ marginTop: '10px', marginBottom: 0 }}>
              <CheckCircle2 size={16} />
              <div>
                Matched <strong>{session.metadata_merge_report.matched_samples_count}</strong> /{' '}
                {session.metadata_merge_report.total_abundance_samples} samples. Added columns:{' '}
                {session.metadata_merge_report.added_metadata_columns.join(', ') || 'None'}.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Automatic Recognition, Measurement Type & Normalization Engine Configuration */}
      {session && (
        <>
          <div className="gareg-card">
            <div className="gareg-card-header">
              <h3 className="gareg-card-title">
                <Sliders size={18} color="#0284c7" /> Initial Processing: Column Recognition, Input Scale &amp; Glycomic Normalization Engine
              </h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={handleApplyConfiguration} disabled={busy}>
                  Apply Normalization &amp; Recalculate Traits
                </button>
                <button className="btn btn-secondary" onClick={() => onNavigate('qc')}>
                  Proceed to Quality Control <ArrowRight size={14} />
                </button>
              </div>
            </div>

            <div className="gareg-grid-4">
              <div>
                <label className="form-label">Sample Identifier Column</label>
                <select
                  className="form-select"
                  style={{ width: '100%' }}
                  value={sampleIdCol}
                  onChange={(e) => setSampleIdCol(e.target.value)}
                >
                  {session.all_columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Experimental Group Column</label>
                <select
                  className="form-select"
                  style={{ width: '100%' }}
                  value={groupCol}
                  onChange={(e) => setGroupCol(e.target.value)}
                >
                  <option value="">(None / Single Cohort)</option>
                  {session.all_columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Uploaded Measurement Type (Section 4.2)</label>
                <select
                  className="form-select"
                  style={{ width: '100%' }}
                  value={measurementType}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMeasurementType(val);
                    if (val === 'raw_intensity' || val === 'peak_area') {
                      setApplyClosure(true);
                      if (normalizationMethod === 'none_as_is') {
                        setNormalizationMethod('total_area_pct');
                      }
                    }
                  }}
                >
                  {Object.entries(session.measurement_types_catalog).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Zero-Value Management (Section 12.1)</label>
                <select
                  className="form-select"
                  style={{ width: '100%' }}
                  value={zeroHandling}
                  onChange={(e) => setZeroHandling(e.target.value)}
                >
                  {Object.entries(session.zero_handling_catalog).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Dedicated Glycomic Normalization Approach Selector */}
            <div
              style={{
                marginTop: '14px',
                padding: '14px 16px',
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <label className="form-label" style={{ color: '#0369a1', fontSize: '0.84rem', marginBottom: '4px' }}>
                    <Layers size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Glycomic Normalization Approach (Applied to Raw Peak Areas / Intensities or Abundance Matrix)
                  </label>
                  <select
                    className="form-select"
                    style={{ width: '100%', fontWeight: 600 }}
                    value={normalizationMethod}
                    onChange={(e) => {
                      const m = e.target.value;
                      setNormalizationMethod(m);
                      setApplyClosure(m !== 'none_as_is');
                    }}
                  >
                    {Object.entries(normCatalog).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    className="btn btn-primary"
                    style={{ background: '#059669', fontSize: '0.78rem' }}
                    disabled={busy}
                    onClick={() => handleExportNormalized('xlsx', false)}
                  >
                    <FileSpreadsheet size={14} /> Export Normalized Relative Abundance (%) (.xlsx)
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.78rem' }}
                    disabled={busy}
                    onClick={() => handleExportNormalized('csv', false)}
                  >
                    <Download size={14} /> Export Normalized (%) (.csv)
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '0.78rem' }}
                    disabled={busy}
                    onClick={() => handleExportNormalized('xlsx', true)}
                  >
                    <FileSpreadsheet size={14} /> Export Normalized (%) + Calculated Traits (.xlsx)
                  </button>
                </div>
              </div>
              <div style={{ marginTop: '8px', fontSize: '0.77rem', color: '#0c4a6e', lineHeight: 1.5 }}>
                <strong>Mathematical Note:</strong>{' '}
                {normalizationMethod === 'total_area_pct' &&
                  'Total Area Normalization (TAN) divides each glycan peak area x_ik by the sample total sum_k(x_ik) and multiplies by 100 so every sample sums to 100.00% relative abundance.'}
                {normalizationMethod === 'total_area_prop' &&
                  'Total Area Proportion divides each glycan peak area x_ik by sum_k(x_ik) to produce unit-sum proportions (0–1) while also providing % scale for trait calculation.'}
                {normalizationMethod === 'pqn_pct' &&
                  'Probabilistic Quotient Normalization (PQN) computes a reference spectrum from sample medians, scales each sample by its median quotient factor to correct dilution/injection variance, and closes to 100%.'}
                {normalizationMethod === 'median_scaling_pct' &&
                  'Upper-Quartile (Q75) / Median Scaling aligns sample intensity distributions across runs before closing to relative percentages (%).'}
                {normalizationMethod === 'quantile_pct' &&
                  'Empirical Quantile Normalization aligns ranked glycan intensity distributions across all samples and closes to relative percentages (%).'}
                {normalizationMethod === 'base_peak_pct' &&
                  'Base Peak Normalization expresses every glycan relative to the most abundant peak in that sample (Base Peak = 100.0%) and provides closed % for compositional traits.'}
                {normalizationMethod === 'none_as_is' &&
                  'Uploaded values are used directly without additional scaling.'}
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '10px' }}>
              <strong>Detected Glycan Composition Columns ({session.glycan_cols.length}):</strong>{' '}
              <span style={{ fontFamily: 'Consolas, monospace' }}>{session.glycan_cols.join(', ')}</span>
            </div>
          </div>

          {/* Interactive Raw vs Normalized Relative Abundance Preview & Export Table */}
          <div className="gareg-card">
            <div className="gareg-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 className="gareg-card-title">
                  {previewMode === 'normalized_pct'
                    ? `Normalized Relative Abundance (%) Matrix Preview (${activePreviewRows.length} Samples • Row Sum = 100.00%)`
                    : previewMode === 'custom_scale'
                    ? `Selected Normalization Output Preview (${session.normalization_method_label || normalizationMethod})`
                    : `Original Uploaded Data Preview (${activePreviewRows.length} Samples • Unaltered Raw Values)`}
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  Switch between original uploaded peak areas/intensities and the normalized relative abundance (`%`) matrix used for glycan trait calculations.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  className={`btn ${previewMode === 'normalized_pct' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                  onClick={() => setPreviewMode('normalized_pct')}
                >
                  Normalized Relative Abundance (%)
                </button>
                <button
                  className={`btn ${previewMode === 'raw' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                  onClick={() => setPreviewMode('raw')}
                >
                  Original Uploaded Values (Raw Area / Input)
                </button>
                {(normalizationMethod === 'total_area_prop' || normalizationMethod === 'base_peak_pct') && (
                  <button
                    className={`btn ${previewMode === 'custom_scale' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                    onClick={() => setPreviewMode('custom_scale')}
                  >
                    {normalizationMethod === 'base_peak_pct' ? 'Base Peak Scale (Max = 100)' : 'Proportion Scale (0–1)'}
                  </button>
                )}
              </div>
            </div>
            <div className="table-scroll" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <table className="gareg-table">
                <thead>
                  <tr>
                    <th>{session.sample_id_col}</th>
                    {session.group_col && <th>{session.group_col}</th>}
                    <th style={{ background: '#e0f2fe', color: '#0369a1' }}>Sample Total Sum</th>
                    {session.glycan_cols.map((col) => (
                      <th key={col} style={{ fontFamily: 'Consolas, monospace' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activePreviewRows.map((row, rIdx) => {
                    const rowSum = session.glycan_cols.reduce(
                      (acc, gCol) => acc + (typeof row[gCol] === 'number' ? Number(row[gCol]) : 0),
                      0
                    );
                    return (
                      <tr key={rIdx}>
                        <td style={{ fontWeight: 700 }}>{String(row[session.sample_id_col] ?? '')}</td>
                        {session.group_col && (
                          <td>
                            <span className="badge badge-sky">{String(row[session.group_col] ?? '')}</span>
                          </td>
                        )}
                        <td style={{ fontWeight: 800, color: '#0369a1', background: '#f0f9ff' }}>
                          {previewMode === 'raw' && rowSum > 500
                            ? Math.round(rowSum).toLocaleString()
                            : previewMode === 'custom_scale' && normalizationMethod === 'total_area_prop'
                            ? rowSum.toFixed(4)
                            : `${rowSum.toFixed(2)}%`}
                        </td>
                        {session.glycan_cols.map((col) => {
                          const val = row[col];
                          return (
                            <td key={col}>
                              {val !== null && val !== undefined
                                ? typeof val === 'number'
                                  ? previewMode === 'raw' && val > 500
                                    ? Math.round(val).toLocaleString()
                                    : previewMode === 'custom_scale' && normalizationMethod === 'total_area_prop'
                                    ? Number(val).toFixed(4)
                                    : Number(val).toFixed(3)
                                  : String(val)
                                : 'NA'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

interface QualityControlViewProps {
  session: SessionSummary | null;
  onSessionUpdated: (s: SessionSummary) => void;
  onNavigate: (tab: NavTabId) => void;
}

export const QualityControlView: React.FC<QualityControlViewProps> = ({
  session,
  onSessionUpdated,
  onNavigate,
}) => {
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <div className="gareg-card">
        <p>Please upload a dataset or load the GAREG reference dataset from the Dashboard first.</p>
      </div>
    );
  }

  const qc = session.qc_report;
  const valChecks = session.composition_results.scientific_validation?.checks || [];

  const toggleSampleExclusion = async (sampleId: string) => {
    setBusy(true);
    try {
      const current = new Set(qc.excluded_samples);
      if (current.has(sampleId)) current.delete(sampleId);
      else current.add(sampleId);
      const res = await api.validateAndUpdateConfig({
        session_id: session.session_id,
        sample_id_col: session.sample_id_col,
        group_col: session.group_col,
        glycan_cols: session.glycan_cols,
        measurement_type: qc.measurement_type,
        apply_closure: qc.apply_closure,
        zero_handling: qc.zero_handling,
        excluded_samples: Array.from(current),
      });
      onSessionUpdated(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* QC Summary Cards (Section 12) */}
      <div className="gareg-grid-4">
        <div className="stat-card">
          <div className="stat-label">Composition Parsing Rate</div>
          <div className="stat-value">{qc.parsing_success_rate_pct.toFixed(1)}%</div>
          <div className="stat-sub">
            {qc.valid_glycan_count} valid / {qc.total_glycan_columns} total columns
          </div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Missing &amp; Zero Values</div>
          <div className="stat-value">
            {qc.missing_values_count} / {qc.zero_values_count}
          </div>
          <div className="stat-sub">
            Missing: {qc.missing_values_pct.toFixed(2)}% &bull; Zeros: {qc.zero_values_pct.toFixed(2)}%
          </div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Negative / CLR Values</div>
          <div className="stat-value">{qc.negative_values_count}</div>
          <div className="stat-sub">
            {qc.is_clr_blocked ? 'Blocked: Original abundance required' : 'Verified non-negative abundances'}
          </div>
        </div>
        <div className="stat-card emerald">
          <div className="stat-label">Duplicate Identifiers</div>
          <div className="stat-value">
            {qc.duplicate_sample_ids.length + qc.duplicate_glycan_labels.length}
          </div>
          <div className="stat-sub">
            Samples: {qc.duplicate_sample_ids.length} &bull; Glycans: {qc.duplicate_glycan_labels.length}
          </div>
        </div>
      </div>

      {/* Section 12.2: 9 Automatic Scientific Validation Consistency Rules */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <h3 className="gareg-card-title">
            <ShieldCheck size={18} color="#0284c7" /> Automatic Scientific Validation &amp; Internal Consistency Rules (Section 12.2)
          </h3>
          <button className="btn btn-primary" onClick={() => onNavigate('composition')}>
            Proceed to Composition Analysis <ArrowRight size={14} />
          </button>
        </div>

        <div className="table-scroll">
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Rule ID</th>
                <th>Scientific Consistency Rule</th>
                <th>Validation Status</th>
                <th>Detailed Mathematical Audit &amp; Disclosure</th>
              </tr>
            </thead>
            <tbody>
              {valChecks.map((chk) => (
                <tr key={chk.rule_id}>
                  <td style={{ fontWeight: 700, fontFamily: 'Consolas, monospace' }}>{chk.rule_id}</td>
                  <td style={{ fontWeight: 600 }}>{chk.rule_name}</td>
                  <td>
                    {chk.passed ? (
                      <span className="badge badge-emerald" style={{ gap: '4px' }}>
                        <CheckCircle2 size={12} /> PASS
                      </span>
                    ) : (
                      <span className="badge badge-rose" style={{ gap: '4px' }}>
                        <XCircle size={12} /> FAIL
                      </span>
                    )}
                  </td>
                  <td>{chk.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sample-Level Abundance Total & QC Table */}
      <div className="gareg-card">
        <div className="gareg-card-header">
          <h3 className="gareg-card-title">
            Sample-Level Relative Abundance Totals (T01) &amp; Quality Control Status
          </h3>
        </div>
        <div className="table-scroll" style={{ maxHeight: '420px', overflowY: 'auto' }}>
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Sample_ID</th>
                <th>Group</th>
                <th>Original Total Abundance</th>
                <th>Working Relative Total (%)</th>
                <th>Zero Count</th>
                <th>Missing Count</th>
                <th>Negative Count</th>
                <th>QC Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {qc.sample_qc_table.map((row) => {
                const isExcluded = qc.excluded_samples.includes(row.sample_id);
                return (
                  <tr key={row.sample_id} style={{ opacity: isExcluded ? 0.55 : 1 }}>
                    <td style={{ fontWeight: 700 }}>{row.sample_id}</td>
                    <td>
                      <span className="badge badge-sky">{row.group}</span>
                    </td>
                    <td>{row.raw_total_abundance.toFixed(4)}</td>
                    <td style={{ fontWeight: 600 }}>{row.working_total_pct.toFixed(4)}%</td>
                    <td>{row.zero_count}</td>
                    <td>{row.missing_count}</td>
                    <td>{row.negative_count}</td>
                    <td>
                      <span
                        className={`badge ${
                          row.qc_status === 'OK'
                            ? 'badge-emerald'
                            : row.qc_status === 'EXCLUDED'
                            ? 'badge-slate'
                            : 'badge-amber'
                        }`}
                      >
                        {row.qc_status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.73rem' }}
                        disabled={busy}
                        onClick={() => toggleSampleExclusion(row.sample_id)}
                      >
                        {isExcluded ? 'Include Sample' : 'Exclude Sample'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
