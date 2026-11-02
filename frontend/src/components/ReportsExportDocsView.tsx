import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  FileSpreadsheet,
  FolderArchive,
  BookOpen,
  ShieldCheck,
  Globe,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import { SessionSummary } from '../types';
import { api } from '../services/api';

interface ReportsExportDocsProps {
  session: SessionSummary;
  onInspectTrait: (traitId: string, sampleId?: string) => void;
}

// Helper to trigger blob download in browser
async function triggerBlobDownload(
  endpoint: 'excel' | 'csv' | 'report',
  sessionId: string,
  filename: string,
  format = 'html'
) {
  const blob = await api.downloadExport(endpoint, sessionId, format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// MODULE 9: AUTOMATED SCIENTIFIC REPORT GENERATOR
// ============================================================================
export const ReportsView: React.FC<ReportsExportDocsProps> = ({ session }) => {
  const [reportHtml, setReportHtml] = useState<string>('');
  const [loadingReport, setLoadingReport] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    setLoadingReport(true);
    api
      .fetchReportHtml(session.session_id)
      .then((html) => {
        if (mounted) {
          setReportHtml(html);
          setLoadingReport(false);
        }
      })
      .catch(() => {
        if (mounted) setLoadingReport(false);
      });
    return () => {
      mounted = false;
    };
  }, [session.session_id]);

  const handleDownload = async (fmt: 'html' | 'pdf') => {
    setDownloading(true);
    try {
      await triggerBlobDownload(
        'report',
        session.session_id,
        `GAREG_Glycomic_Trait_Report_${session.session_id.slice(0, 8)}.${fmt}`,
        fmt
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="gareg-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 className="gareg-card-title" style={{ margin: 0 }}>
              GAREG Glycomic Trait Analysis Report
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
              Automated scientific report covering dataset overview, QC metrics, composition parsing, Category A traits, Category B structural traits, and methodological limitations.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-secondary"
              disabled={downloading}
              onClick={() => handleDownload('html')}
            >
              <Download size={16} /> Download HTML Report
            </button>
            <button
              className="btn btn-primary"
              disabled={downloading}
              onClick={() => handleDownload('pdf')}
            >
              <FileText size={16} /> Download PDF Report
            </button>
          </div>
        </div>
      </div>

      {/* Report Sections Summary Checklist */}
      <div className="gareg-card">
        <h3 style={{ margin: '0 0 12px', fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={18} color="#059669" /> Included Scientific Report Sections (Specification Section 15)
        </h3>
        <div className="gareg-grid-3">
          <div style={{ fontSize: '0.83rem', color: '#334155' }}>
            <strong>15.1 Dataset Overview:</strong> File name ({session.filename}), analysis timestamp, sample count ({session.dashboard_metrics.total_samples}), glycan count ({session.dashboard_metrics.identified_glycan_compositions}), group distribution, measurement type.
          </div>
          <div style={{ fontSize: '0.83rem', color: '#334155' }}>
            <strong>15.2 Data Quality Summary:</strong> Total glycan abundance check (T01), missing values, zero values, duplicate checks, invalid composition labels.
          </div>
          <div style={{ fontSize: '0.83rem', color: '#334155' }}>
            <strong>15.3 Glycan Composition Summary:</strong> Parsed composition table (Hex, HexNAc, Fuc, Sia), monosaccharide distribution.
          </div>
          <div style={{ fontSize: '0.83rem', color: '#334155' }}>
            <strong>15.4 Composition-Derived Trait Results:</strong> All 28 baseline traits, mathematical formulas, sample-level summaries, and group-level comparisons.
          </div>
          <div style={{ fontSize: '0.83rem', color: '#334155' }}>
            <strong>15.5 Structure-Derived Trait Results:</strong> Calculated structural traits (when annotations provided) and explicit list of traits requiring structural confirmation.
          </div>
          <div style={{ fontSize: '0.83rem', color: '#334155' }}>
            <strong>15.6 &amp; 15.7 Methodological Notes &amp; Limitations:</strong> Normalization method, composition parsing rules, and formal statement separating composition proxies from structural proof.
          </div>
        </div>
      </div>

      {/* Live Embedded Report Preview */}
      <div className="gareg-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '14px 20px',
            background: '#0f2b46',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
            Live Scientific Report Preview (GAREG Glycomic Trait Analysis Report)
          </span>
          <span style={{ fontSize: '0.78rem', color: '#38bdf8' }}>
            Session ID: {session.session_id.slice(0, 8)}
          </span>
        </div>
        {loadingReport ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            Generating formatted scientific report preview...
          </div>
        ) : (
          <iframe
            title="GAREG Scientific Report Preview"
            srcDoc={reportHtml}
            style={{
              width: '100%',
              height: '720px',
              border: 'none',
              background: '#ffffff',
            }}
          />
        )}
      </div>
    </div>
  );
};

// ============================================================================
// MODULE 10: EXPORT RESULTS (11-SHEET EXCEL & 9-FILE CSV ZIP)
// ============================================================================
export const ExportResultsView: React.FC<ReportsExportDocsProps> = ({
  session,
}) => {
  const [busy, setBusy] = useState<string>('');

  const handleExport = async (
    endpoint: 'excel' | 'csv' | 'report',
    ext: string,
    format = 'html'
  ) => {
    setBusy(`${endpoint}_${format}`);
    try {
      await triggerBlobDownload(
        endpoint,
        session.session_id,
        `GAREG_Glycomic_Trait_Analysis_${session.session_id.slice(0, 8)}.${ext}`,
        format
      );
    } finally {
      setBusy('');
    }
  };

  const handleNormalizedExport = async (format: 'xlsx' | 'csv', includeTraits: boolean) => {
    setBusy(`norm_${format}_${includeTraits}`);
    try {
      await api.downloadNormalizedMatrix(session.session_id, format, includeTraits);
    } finally {
      setBusy('');
    }
  };

  const handleTemplateDownload = async (
    templateType:
      | 'raw_area_template'
      | 'relative_pct_template'
      | 'metadata_template'
      | 'structural_template'
      | 'active_dataset',
    format: 'xlsx' | 'csv' = 'xlsx'
  ) => {
    setBusy(`tpl_${templateType}_${format}`);
    try {
      await api.downloadDataTemplate(templateType, format, session.session_id);
    } finally {
      setBusy('');
    }
  };

  const excelSheets = [
    {
      num: 'Sheet 1',
      name: 'Read_Me',
      desc: 'Software version, date/time, dataset name, measurement type, normalization method, and methodological notes separating composition-derived vs. structure-derived traits.',
    },
    {
      num: 'Sheet 2',
      name: 'Raw_Abundance',
      desc: 'Original uploaded sample-by-glycan matrix (Raw Peak Areas / Intensities or Input Scale), Sample_ID, Group, and sample metadata.',
    },
    {
      num: 'Sheet 3',
      name: 'Normalized_Abundance_Pct',
      desc: 'Total-Area / Selected Normalization Relative Abundance (%) matrix (Row Sum = 100.00%) plus Selected Normalization Output Scale.',
    },
    {
      num: 'Sheet 4',
      name: 'Composition_Map',
      desc: 'Glycan_Label, Canonical_Composition, Hex, HexNAc, Fucose, Sialic_Acid, Total_Residues, and boolean inclusion flags for each composition pool.',
    },
    {
      num: 'Sheet 5',
      name: 'Structural_Annotations',
      desc: 'Uploaded structural annotations or explicit notice that no structural annotations were supplied.',
    },
    {
      num: 'Sheet 6',
      name: 'Trait_Definitions',
      desc: 'Trait_ID, Trait_Name, Category, Mathematical_Formula, Numerator_Definition, Denominator_Definition, Included_Compositions, Biological_Meaning, and Limitations.',
    },
    {
      num: 'Sheet 7',
      name: 'Trait_Calculations',
      desc: 'Sample-level trait results (Sample_ID, Group, T01–T28, optional/custom traits) computed from Normalized Relative Abundance (%).',
    },
    {
      num: 'Sheet 8',
      name: 'Trait_Contributions',
      desc: 'Long-format audit table (Trait_ID, Trait_Name, Sample_ID, Glycan_Label, Abundance, Weight_Factor, Numerator_Contribution, Denominator_Contribution, Percent_Contribution_to_Trait).',
    },
    {
      num: 'Sheet 9',
      name: 'Group_Summary',
      desc: 'Group-level statistics (Mean, SD, SE, Median, IQR, Min, Max, Valid N) computed across sample-level trait values.',
    },
    {
      num: 'Sheet 10',
      name: 'QC_Report',
      desc: 'Sample-level total abundance check, missing/zero value counts, parser status, and 9 scientific validation consistency checks (VAL01–VAL09).',
    },
    {
      num: 'Sheet 11',
      name: 'Not_Derivable_Traits',
      desc: 'Traits that could not be calculated, required structural inputs, and explicit reason why calculation was not performed.',
    },
    {
      num: 'Sheet 12',
      name: 'Calculation_Provenance',
      desc: 'Reproducibility audit log: timestamp, software version, parser version, normalization method, dictionary settings, zero-handling setting, and full parameter snapshot.',
    },
  ];

  const csvFiles = [
    '01_raw_abundance.csv',
    '01b_normalized_relative_abundance_pct.csv',
    '02_parsed_compositions.csv',
    '03_composition_trait_definitions.csv',
    '04_sample_level_composition_traits.csv',
    '05_group_summary_composition_traits.csv',
    '06_trait_contributions_long_format.csv',
    '07_structure_derived_traits.csv',
    '08_not_derivable_traits.csv',
    '09_qc_report.csv',
  ];

  return (
    <div>
      <div className="gareg-card">
        <h2 className="gareg-card-title" style={{ margin: 0 }}>
          Export Normalized Relative Abundance Matrices, Calculated Traits, Multi-Sheet Workbooks &amp; Data Templates
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
          Download standalone normalized relative abundance matrices (`%`), combined normalized abundance + trait workbooks, full 12-sheet audit packages, or blank data templates.
        </p>
      </div>

      {/* Dedicated Normalized Relative Abundance & Data Templates Export Card */}
      <div className="gareg-grid-2">
        <div className="gareg-card" style={{ borderTop: '4px solid #0284c7' }}>
          <span className="badge badge-sky">Normalized Relative Abundance (%) &amp; Trait Exports</span>
          <h3 style={{ margin: '6px 0 4px', fontSize: '1.02rem' }}>
            Export Normalized Glycan Abundance (%) &amp; Calculated Traits
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#64748b' }}>
            Active Normalization Method: <strong>{session.normalization_method_label || 'Total Area Normalization (TAN → %)'}</strong>.
            Export either the normalized relative abundance table alone or combined with all calculated composition and structure traits:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              className="btn btn-primary"
              style={{ justifyContent: 'center', fontSize: '0.78rem' }}
              disabled={busy !== ''}
              onClick={() => handleNormalizedExport('xlsx', false)}
            >
              <FileSpreadsheet size={15} /> Normalized Abundance (%) Only (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'center', fontSize: '0.78rem' }}
              disabled={busy !== ''}
              onClick={() => handleNormalizedExport('csv', false)}
            >
              <Download size={15} /> Normalized Abundance (%) Only (.csv)
            </button>
            <button
              className="btn btn-primary"
              style={{ justifyContent: 'center', fontSize: '0.78rem', background: '#059669' }}
              disabled={busy !== ''}
              onClick={() => handleNormalizedExport('xlsx', true)}
            >
              <FileSpreadsheet size={15} /> Normalized (%) + All Traits (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'center', fontSize: '0.78rem' }}
              disabled={busy !== ''}
              onClick={() => handleNormalizedExport('csv', true)}
            >
              <Download size={15} /> Normalized (%) + All Traits (.csv)
            </button>
          </div>
        </div>

        <div className="gareg-card" style={{ borderTop: '4px solid #7c3aed' }}>
          <span className="badge badge-slate">Downloadable User Data Templates</span>
          <h3 style={{ margin: '6px 0 4px', fontSize: '1.02rem' }}>
            Download Standard Glycomic Data Templates (.xlsx &amp; .csv)
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#64748b' }}>
            Download structured templates with example rows and formatting instructions for preparing your own glycomics datasets:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', fontSize: '0.77rem' }}
              disabled={busy !== ''}
              onClick={() => handleTemplateDownload('raw_area_template', 'xlsx')}
            >
              <FileSpreadsheet size={14} color="#0284c7" /> Raw Peak Area Template (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', fontSize: '0.77rem' }}
              disabled={busy !== ''}
              onClick={() => handleTemplateDownload('relative_pct_template', 'xlsx')}
            >
              <FileSpreadsheet size={14} color="#059669" /> Relative Abundance (%) Template (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', fontSize: '0.77rem' }}
              disabled={busy !== ''}
              onClick={() => handleTemplateDownload('metadata_template', 'xlsx')}
            >
              <FileSpreadsheet size={14} color="#7c3aed" /> Clinical Metadata Template (.xlsx)
            </button>
            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', fontSize: '0.77rem' }}
              disabled={busy !== ''}
              onClick={() => handleTemplateDownload('structural_template', 'xlsx')}
            >
              <FileSpreadsheet size={14} color="#d97706" /> Structural Annotation Template (.xlsx)
            </button>
          </div>
        </div>
      </div>

      <div className="gareg-grid-2">
        {/* Excel Export Card */}
        <div className="gareg-card" style={{ borderTop: '4px solid #059669' }}>
          <div style={{ marginBottom: '12px' }}>
            <span className="badge badge-emerald">11-Worksheet Scientific Workbook (.xlsx)</span>
            <h3 style={{ margin: '6px 0 4px', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileSpreadsheet size={20} color="#059669" /> Multi-Sheet Excel Workbook with Live Formulas
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
              Includes active Excel formulas (<code>SUMPRODUCT</code>, <code>SUM</code>, <code>IF</code>) linking <code>Trait_Calculations</code> directly to <code>Raw_Abundance</code> and <code>Composition_Map</code>.
            </p>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <button
              className="btn btn-primary"
              disabled={busy !== ''}
              onClick={() => handleExport('excel', 'xlsx')}
              style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
            >
              <Download size={18} />{' '}
              {busy === 'excel_html'
                ? 'Generating 11-Sheet Workbook...'
                : 'Download 11-Sheet Excel Workbook (.xlsx)'}
            </button>
          </div>

          <div className="table-scroll" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="gareg-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Worksheet Name</th>
                  <th>Contents</th>
                </tr>
              </thead>
              <tbody>
                {excelSheets.map((s) => (
                  <tr key={s.name}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600, fontFamily: 'Consolas, monospace' }}>
                      {s.num}
                    </td>
                    <td style={{ fontWeight: 700, color: '#0f2b46', fontFamily: 'Consolas, monospace' }}>
                      {s.name}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#475569' }}>{s.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CSV ZIP & Reports Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="gareg-card" style={{ borderTop: '4px solid #0284c7', marginBottom: 0 }}>
            <div style={{ marginBottom: '12px' }}>
              <span className="badge badge-sky">9-File CSV Archive (.zip)</span>
              <h3 style={{ margin: '6px 0 4px', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FolderArchive size={20} color="#0284c7" /> Standardized CSV Package (R / Python / MATLAB Ready)
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                Machine-readable UTF-8 CSV tables for downstream bioinformatics pipelines.
              </p>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <button
                className="btn btn-primary"
                disabled={busy !== ''}
                onClick={() => handleExport('csv', 'zip')}
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
              >
                <Download size={18} />{' '}
                {busy === 'csv_html'
                  ? 'Packaging CSV ZIP...'
                  : 'Download 9-File CSV ZIP Archive (.zip)'}
              </button>
            </div>

            <div className="table-scroll">
              <table className="gareg-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>CSV File Name</th>
                  </tr>
                </thead>
                <tbody>
                  {csvFiles.map((f, idx) => (
                    <tr key={f}>
                      <td style={{ fontFamily: 'Consolas, monospace' }}>{idx + 1}</td>
                      <td style={{ fontWeight: 600, color: '#0284c7', fontFamily: 'Consolas, monospace' }}>
                        {f}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="gareg-card" style={{ borderTop: '4px solid #d97706', marginBottom: 0 }}>
            <div style={{ marginBottom: '12px' }}>
              <span className="badge badge-amber">Formatted Reports</span>
              <h3 style={{ margin: '6px 0 4px', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={20} color="#d97706" /> Standalone Scientific Analysis Reports
              </h3>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn btn-primary"
                disabled={busy !== ''}
                onClick={() => handleExport('report', 'pdf', 'pdf')}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <Download size={16} /> Download PDF Report
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy !== ''}
                onClick={() => handleExport('report', 'html', 'html')}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <Download size={16} /> Download HTML Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// MODULE 11: METHODOLOGY, MATHEMATICAL DEFINITIONS & GAREG INTEGRATION DOCS
// ============================================================================
export const MethodologyAndDocsView: React.FC<ReportsExportDocsProps> = ({
  session,
  onInspectTrait,
}) => {
  const baselineDefs = (session.composition_results?.trait_definitions || []).filter(
    (d) => d.Is_Baseline
  );
  const structDefs = session.structure_results?.trait_definitions || [];

  return (
    <div>
      <div className="gareg-card">
        <h2 className="gareg-card-title" style={{ margin: 0 }}>
          Methodology, Mathematical Definitions &amp; Documentation
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
          Complete mathematical specification for Category A (Composition-Derived Traits T01–T28), Category B (Structure-Derived Traits S01–S08), and GAREG website integration architecture.
        </p>
      </div>

      {/* Core Scientific Principle Banner */}
      <div className="alert-banner alert-info" style={{ marginBottom: '16px' }}>
        <ShieldCheck size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong>Fundamental Scientific Principle:</strong> Composition-derived glycan traits (Category A) are calculated exclusively from monosaccharide stoichiometry (Hex, HexNAc, Fucose, Sialic acid) and relative abundance. Structure-derived glycan traits (Category B) require experimentally validated linkage, branching, and topological annotations. The GAREG Glycomic Trait Analyzer never reports a composition-derived proxy as an experimentally confirmed structural trait.
        </div>
      </div>

      {/* Section 10: Composition vs. Structure Classification Table */}
      <div className="gareg-card">
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOpen size={18} color="#0284c7" /> Composition vs. Structure Trait Classification Table (Specification Section 10)
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Mandatory reference boundary between traits derivable from composition-only data and traits requiring structural elucidation.
          </p>
        </div>
        <div className="table-scroll">
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Trait / Concept</th>
                <th>Category</th>
                <th>Derivable from Composition Alone?</th>
                <th>Requires Structural Information?</th>
                <th>Scientific Rationale</th>
              </tr>
            </thead>
            <tbody>
              {session.classification_table.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 700, color: '#0f2b46' }}>{row.trait}</td>
                  <td>
                    <span className="badge badge-sky">{row.category}</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        row.composition_data_sufficient.startsWith('Yes')
                          ? 'badge-emerald'
                          : 'badge-slate'
                      }`}
                    >
                      {row.composition_data_sufficient}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        row.structural_annotation_required.startsWith('Yes')
                          ? 'badge-amber'
                          : 'badge-sky'
                      }`}
                    >
                      {row.structural_annotation_required}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: '#334155' }}>
                    {row.scientific_rationale}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Category A: Complete Mathematical Reference (T01 - T28) */}
      <div className="gareg-card">
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem' }}>
            Category A: 28 Baseline Composition-Derived Glycan Traits (T01–T28)
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Let p_ik denote the relative abundance proportion of glycan k in sample i, and H_k, N_k, F_k, S_k denote its Hex, HexNAc, Fucose, and Sialic acid counts.
          </p>
        </div>
        <div className="table-scroll" style={{ maxHeight: '580px', overflowY: 'auto' }}>
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Trait ID</th>
                <th>Group</th>
                <th>Trait Name</th>
                <th>Mathematical Formula</th>
                <th>Inclusion Rule</th>
                <th>Scientific Scope &amp; Limitation</th>
                <th>Audit</th>
              </tr>
            </thead>
            <tbody>
              {baselineDefs.map((d) => (
                <tr key={d.Trait_ID}>
                  <td style={{ fontWeight: 700, color: '#0284c7', fontFamily: 'Consolas, monospace' }}>
                    {d.Trait_ID}
                  </td>
                  <td>
                    <span className="badge badge-sky">{d.Trait_Group}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{d.Trait_Name}</td>
                  <td style={{ fontSize: '0.77rem', color: '#0f2b46', fontFamily: 'Consolas, monospace' }}>
                    {d.Mathematical_Formula}
                  </td>
                  <td style={{ fontSize: '0.78rem', color: '#334155' }}>
                    {d.Inclusion_Criteria}
                  </td>
                  <td style={{ fontSize: '0.78rem', color: '#92400e' }}>
                    {d.Limitations}
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      onClick={() => onInspectTrait(d.Trait_ID)}
                    >
                      <Eye size={13} /> Audit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Category B: Structure-Derived Glycan Traits Reference (S01 - S08) */}
      <div className="gareg-card">
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem' }}>
            Category B: Structure-Derived Glycan Traits (S01–S08)
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Traits requiring experimentally confirmed structural annotations (IUPAC-condensed, WURCS, GlycoCT, or curated structural annotation table).
          </p>
        </div>
        <div className="table-scroll">
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Trait ID</th>
                <th>Trait Name</th>
                <th>Mathematical Formula</th>
                <th>Required Experimental Structural Input</th>
                <th>Limitation on Composition-Only Data</th>
              </tr>
            </thead>
            <tbody>
              {structDefs.map((s) => (
                <tr key={s.Trait_ID}>
                  <td style={{ fontWeight: 700, color: '#b45309', fontFamily: 'Consolas, monospace' }}>
                    {s.Trait_ID}
                  </td>
                  <td style={{ fontWeight: 600 }}>{s.Trait_Name}</td>
                  <td style={{ fontSize: '0.77rem', fontFamily: 'Consolas, monospace' }}>
                    {s.Mathematical_Formula}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: '#334155' }}>
                    {s.Inclusion_Criteria}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: '#991b1b' }}>
                    {s.Limitations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* GAREG Website Integration Guide */}
      <div className="gareg-card" style={{ borderLeft: '4px solid #0f2b46' }}>
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={18} color="#0f2b46" /> GAREG Website Integration &amp; Deployment Guide (www.gareg.com.tr)
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Navigation path: GAREG &rarr; Tools &rarr; Glycomic Trait Analyzer (https://www.gareg.com.tr/glycan-trait-analyzer/)
          </p>
        </div>
        <div style={{ fontSize: '0.84rem', color: '#334155', lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            <strong>1. Non-Destructive Website Integration:</strong> The frontend compiles into static HTML5/CSS3/JS assets (<code>frontend/dist</code>) that can be uploaded directly to the <code>/glycan-trait-analyzer/</code> directory on the existing GAREG cPanel web host without altering any existing pages or requiring PHP/MySQL.
          </p>
          <p>
            <strong>2. Navigation Snippet for <code>gareg.com.tr</code>:</strong> Add the following link inside the GAREG main navigation bar under <code>Tools</code>:
          </p>
          <div className="formula-box">
            {`<a href="https://www.gareg.com.tr/glycan-trait-analyzer/" class="nav-link">Glycomic Trait Analyzer</a>`}
          </div>
          <p style={{ marginBottom: 0 }}>
            <strong>3. API Connectivity:</strong> Configure <code>VITE_API_BASE_URL=https://api.gareg.com.tr/api</code> when deploying the FastAPI analytical engine on a dedicated Python host, with restricted CORS rules allowing <code>https://www.gareg.com.tr</code>.
          </p>
        </div>
      </div>
    </div>
  );
};
