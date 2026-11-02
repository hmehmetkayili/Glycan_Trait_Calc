import React, { useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import {
  GitCompare,
  Eye,
  Info,
  AlertTriangle,
  Sliders,
} from 'lucide-react';
import { SessionSummary, TraitDefinition } from '../types';

interface ComparisonProps {
  session: SessionSummary;
  onInspectTrait: (traitId: string, sampleId?: string) => void;
}

const COLOR_SCHEMES: Record<string, string[]> = {
  GAREG_Scientific: ['#0284c7', '#d97706', '#059669', '#7c3aed', '#dc2626', '#0f2b46', '#0891b2'],
  Colorblind_OkabeIto: ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442'],
  Nature_Publishing: ['#E64B35', '#4DBBD5', '#00A087', '#3C5488', '#F39B7F', '#8491B4', '#91D1C2'],
  High_Contrast: ['#0f2b46', '#b45309', '#047857', '#b91c1c', '#4338ca', '#be185d'],
};

// ============================================================================
// MODULE 7: TRAIT COMPARISON
// ============================================================================
export const TraitComparisonView: React.FC<ComparisonProps> = ({
  session,
  onInspectTrait,
}) => {
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const [statType, setStatType] = useState<'mean_sd' | 'median_iqr'>('mean_sd');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const allDefs: TraitDefinition[] = useMemo(
    () => session.composition_results?.trait_definitions || [],
    [session]
  );

  const groups = useMemo(
    () =>
      session.composition_results?.group_summaries?.distinct_groups ||
      session.qc_report?.distinct_groups ||
      [],
    [session]
  );

  const compMap = useMemo(() => {
    const m: Record<string, (typeof session.composition_results.group_comparisons)[0]> = {};
    (session.composition_results?.group_comparisons || []).forEach((c) => {
      m[c.trait_id] = c;
    });
    return m;
  }, [session.composition_results?.group_comparisons]);

  const filteredTraits = useMemo(() => {
    return allDefs.filter((t) => {
      if (groupFilter !== 'ALL' && t.Trait_Group !== groupFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.Trait_ID.toLowerCase().includes(q) ||
          t.Trait_Name.toLowerCase().includes(q) ||
          t.Trait_Group.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allDefs, groupFilter, searchQuery]);

  const uniqueTraitGroups = useMemo(
    () => Array.from(new Set(allDefs.map((d) => d.Trait_Group))),
    [allDefs]
  );

  const byTraitSummaries = session.composition_results?.group_summaries?.by_trait || {};

  return (
    <div>
      <div className="gareg-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 className="gareg-card-title" style={{ margin: 0 }}>
              Group-Level Trait Summary &amp; Statistical Comparison
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
              All group statistics (Mean, Median, SD, SE, Min, Max, IQR, Valid N) are computed strictly across individual sample-level traits — never from group-averaged raw abundances.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className={`btn ${statType === 'mean_sd' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatType('mean_sd')}
            >
              Parametric (Mean ± SD / SE)
            </button>
            <button
              className={`btn ${statType === 'median_iqr' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatType('median_iqr')}
            >
              Non-Parametric (Median [IQR])
            </button>
          </div>
        </div>
      </div>

      <div className="alert-banner alert-info" style={{ marginBottom: '16px' }}>
        <Info size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong>Sample-First Calculation Rule (Section 8):</strong> Every trait is calculated independently per biological sample first, and group summaries are aggregated across sample-level trait values. P-values are reported alongside Benjamini-Hochberg FDR-adjusted values.
        </div>
      </div>

      {/* Filters */}
      <div className="gareg-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              className={`btn ${groupFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setGroupFilter('ALL')}
            >
              All Trait Categories ({allDefs.length})
            </button>
            {uniqueTraitGroups.map((grp) => (
              <button
                key={grp}
                className={`btn ${groupFilter === grp ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setGroupFilter(grp)}
              >
                {grp}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="form-control"
            style={{ maxWidth: '260px' }}
            placeholder="Filter traits by ID or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Group Comparison Summary Table */}
      <div className="gareg-card">
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitCompare size={18} color="#0284c7" /> Group-Level Summary &amp; Hypothesis Testing
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Click any Trait ID to inspect its mathematical formula and sample-level contribution audit trail.
          </p>
        </div>
        <div className="table-scroll" style={{ maxHeight: '620px', overflowY: 'auto' }}>
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Trait ID</th>
                <th>Trait Name</th>
                <th>Unit</th>
                {groups.map((g) => (
                  <React.Fragment key={g}>
                    <th>{g} ({statType === 'mean_sd' ? 'Mean ± SD' : 'Median [IQR]'})</th>
                    <th>{g} ({statType === 'mean_sd' ? 'SE' : 'Min – Max'})</th>
                    <th>{g} (N)</th>
                  </React.Fragment>
                ))}
                {groups.length >= 2 && (
                  <>
                    <th>Parametric p (FDR)</th>
                    <th>Non-Parametric p (FDR)</th>
                  </>
                )}
                <th>Audit</th>
              </tr>
            </thead>
            <tbody>
              {filteredTraits.map((t) => {
                const grpStats = byTraitSummaries[t.Trait_ID]?.groups || {};
                const cmp = compMap[t.Trait_ID];
                return (
                  <tr key={t.Trait_ID}>
                    <td style={{ fontWeight: 700, color: '#0284c7', fontFamily: 'Consolas, monospace' }}>
                      <button
                        onClick={() => onInspectTrait(t.Trait_ID)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#0284c7',
                          fontWeight: 700,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: 0,
                        }}
                      >
                        {t.Trait_ID}
                      </button>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.Trait_Name}</div>
                      <div style={{ fontSize: '0.73rem', color: '#64748b' }}>{t.Trait_Group}</div>
                    </td>
                    <td style={{ fontFamily: 'Consolas, monospace' }}>{t.Unit}</td>
                    {groups.map((g) => {
                      const st = grpStats[g];
                      if (!st || st.valid_n === 0) {
                        return (
                          <React.Fragment key={g}>
                            <td style={{ color: '#94a3b8' }}>NA</td>
                            <td style={{ color: '#94a3b8' }}>NA</td>
                            <td>0</td>
                          </React.Fragment>
                        );
                      }
                      return (
                        <React.Fragment key={g}>
                          <td style={{ fontWeight: 600 }}>
                            {statType === 'mean_sd'
                              ? `${st.mean?.toFixed(3)} ± ${st.sd?.toFixed(3)}`
                              : `${st.median?.toFixed(3)} [${st.iqr?.toFixed(3)}]`}
                          </td>
                          <td style={{ color: '#475569' }}>
                            {statType === 'mean_sd'
                              ? st.se?.toFixed(3)
                              : `${st.min?.toFixed(2)} – ${st.max?.toFixed(2)}`}
                          </td>
                          <td>{st.valid_n}</td>
                        </React.Fragment>
                      );
                    })}
                    {groups.length >= 2 && (
                      <>
                        <td>
                          {cmp && cmp.parametric_p !== null ? (
                            <div>
                              <span
                                style={{
                                  fontWeight: cmp.parametric_p < 0.05 ? 700 : 400,
                                  color: cmp.parametric_p < 0.05 ? '#059669' : '#334155',
                                }}
                              >
                                {cmp.parametric_p < 0.0001
                                  ? cmp.parametric_p.toExponential(2)
                                  : cmp.parametric_p.toFixed(4)}
                              </span>
                              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                FDR: {cmp.parametric_fdr !== null && cmp.parametric_fdr !== undefined ? cmp.parametric_fdr.toFixed(4) : 'NA'}
                              </div>
                            </div>
                          ) : (
                            'NA'
                          )}
                        </td>
                        <td>
                          {cmp && cmp.nonparametric_p !== null ? (
                            <div>
                              <span
                                style={{
                                  fontWeight: cmp.nonparametric_p < 0.05 ? 700 : 400,
                                  color: cmp.nonparametric_p < 0.05 ? '#0284c7' : '#334155',
                                }}
                              >
                                {cmp.nonparametric_p < 0.0001
                                  ? cmp.nonparametric_p.toExponential(2)
                                  : cmp.nonparametric_p.toFixed(4)}
                              </span>
                              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                FDR: {cmp.nonparametric_fdr !== null && cmp.nonparametric_fdr !== undefined ? cmp.nonparametric_fdr.toFixed(4) : 'NA'}
                              </div>
                            </div>
                          ) : (
                            'NA'
                          )}
                        </td>
                      </>
                    )}
                    <td>
                      <button
                        className="btn btn-secondary"
                        onClick={() => onInspectTrait(t.Trait_ID)}
                      >
                        <Eye size={13} /> Audit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Complete Statistical Metrics Table (All 8 Metrics Explicitly Listed) */}
      <div className="gareg-card">
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '1.02rem' }}>
            Complete Group-Level Statistical Table (All 8 Required Metrics)
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Full expansion of Mean, Median, SD, SE, Min, Max, IQR, and Valid N per group and trait.
          </p>
        </div>
        <div className="table-scroll" style={{ maxHeight: '460px', overflowY: 'auto' }}>
          <table className="gareg-table">
            <thead>
              <tr>
                <th>Trait ID</th>
                <th>Trait Name</th>
                <th>Group</th>
                <th>Valid N</th>
                <th>Mean</th>
                <th>SD</th>
                <th>SE</th>
                <th>Median</th>
                <th>IQR</th>
                <th>Min</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              {filteredTraits.flatMap((t) =>
                groups.map((g) => {
                  const st = byTraitSummaries[t.Trait_ID]?.groups?.[g];
                  return (
                    <tr key={`${t.Trait_ID}_${g}`}>
                      <td style={{ fontWeight: 700, fontFamily: 'Consolas, monospace' }}>{t.Trait_ID}</td>
                      <td>{t.Trait_Name}</td>
                      <td>
                        <span className="badge badge-sky">{g}</span>
                      </td>
                      <td>{st?.valid_n ?? 0}</td>
                      <td>{st?.mean !== null && st?.mean !== undefined ? st.mean.toFixed(4) : 'NA'}</td>
                      <td>{st?.sd !== null && st?.sd !== undefined ? st.sd.toFixed(4) : 'NA'}</td>
                      <td>{st?.se !== null && st?.se !== undefined ? st.se.toFixed(4) : 'NA'}</td>
                      <td>{st?.median !== null && st?.median !== undefined ? st.median.toFixed(4) : 'NA'}</td>
                      <td>{st?.iqr !== null && st?.iqr !== undefined ? st.iqr.toFixed(4) : 'NA'}</td>
                      <td>{st?.min !== null && st?.min !== undefined ? st.min.toFixed(4) : 'NA'}</td>
                      <td>{st?.max !== null && st?.max !== undefined ? st.max.toFixed(4) : 'NA'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// MODULE 8: INTERACTIVE SCIENTIFIC VISUALIZATION
// ============================================================================
export type PlotType =
  | 'boxplot'
  | 'violin'
  | 'bar'
  | 'dot'
  | 'heatmap'
  | 'correlation'
  | 'group_comparison'
  | 'distribution'
  | 'radar'
  | 'sample_contribution';

export const VisualizationView: React.FC<ComparisonProps> = ({
  session,
  onInspectTrait,
}) => {
  const allDefs: TraitDefinition[] = useMemo(
    () => session.composition_results?.trait_definitions || [],
    [session]
  );

  const sampleResults = useMemo(
    () => session.composition_results?.sample_results || [],
    [session]
  );

  const sampleIds = useMemo(
    () => sampleResults.map((r) => r.sample_id),
    [sampleResults]
  );

  const [plotType, setPlotType] = useState<PlotType>('boxplot');
  const [selectedTraitId, setSelectedTraitId] = useState<string>('T09');
  const [selectedSampleId, setSelectedSampleId] = useState<string>(
    sampleIds[0] || ''
  );
  const [colorScheme, setColorScheme] = useState<string>('GAREG_Scientific');
  const [groupOrderMode, setGroupOrderMode] = useState<'default' | 'alphabetical' | 'reverse'>('default');
  const [customXLabel, setCustomXLabel] = useState<string>('');
  const [customYLabel, setCustomYLabel] = useState<string>('');
  const [selectedMultiTraits, setSelectedMultiTraits] = useState<string[]>([
    'T02',
    'T04',
    'T08',
    'T09',
    'T15',
    'T20',
    'T21',
    'T22',
  ]);

  const currentDef = useMemo(
    () => allDefs.find((d) => d.Trait_ID === selectedTraitId) || allDefs[0],
    [allDefs, selectedTraitId]
  );

  const orderedGroups = useMemo(() => {
    const base = [
      ...(session.composition_results?.group_summaries?.distinct_groups ||
        session.qc_report?.distinct_groups ||
        []),
    ];
    if (groupOrderMode === 'alphabetical') return base.sort();
    if (groupOrderMode === 'reverse') return base.reverse();
    return base;
  }, [session, groupOrderMode]);

  const palette = COLOR_SCHEMES[colorScheme] || COLOR_SCHEMES.GAREG_Scientific;
  const byTraitSummaries = session.composition_results?.group_summaries?.by_trait || {};

  // Export plot helper using Plotly global or modebar
  const triggerPlotDownload = (format: 'png' | 'svg') => {
    const plotEl = document.querySelector('.js-plotly-plot') as any;
    if (plotEl && (window as any).Plotly) {
      (window as any).Plotly.downloadImage(plotEl, {
        format,
        width: 1200,
        height: 700,
        filename: `GAREG_${plotType}_${selectedTraitId}`,
      });
    } else {
      window.print();
    }
  };

  // Build Plotly data & layout based on plotType
  const { plotData, plotLayout } = useMemo(() => {
    if (
      plotType === 'boxplot' ||
      plotType === 'violin' ||
      plotType === 'dot'
    ) {
      const traces = orderedGroups.map((grp, idx) => {
        const grpSamples = sampleResults.filter((r) => r.group === grp);
        const yVals: number[] = [];
        const textLabels: string[] = [];
        grpSamples.forEach((r) => {
          const v = r.traits[selectedTraitId];
          if (v !== null && v !== undefined) {
            yVals.push(v);
            textLabels.push(`Sample: ${r.sample_id}<br>${selectedTraitId}: ${v.toFixed(4)}`);
          }
        });
        const color = palette[idx % palette.length];
        if (plotType === 'violin') {
          return {
            type: 'violin' as const,
            name: grp,
            y: yVals,
            text: textLabels,
            box: { visible: true },
            meanline: { visible: true },
            points: 'all',
            marker: { color, size: 7 },
            line: { color },
          };
        }
        if (plotType === 'dot') {
          return {
            type: 'box' as const,
            name: grp,
            y: yVals,
            text: textLabels,
            boxpoints: 'all',
            jitter: 0.45,
            pointpos: 0,
            fillcolor: 'rgba(0,0,0,0)',
            line: { color: 'rgba(0,0,0,0)' },
            marker: { color, size: 9, opacity: 0.85, line: { width: 1, color: '#fff' } },
          };
        }
        return {
          type: 'box' as const,
          name: grp,
          y: yVals,
          text: textLabels,
          boxpoints: 'all',
          jitter: 0.35,
          pointpos: -1.6,
          boxmean: true,
          marker: { color, size: 6 },
          line: { color },
        };
      });

      return {
        plotData: traces as any[],
        plotLayout: {
          title: {
            text: `${currentDef?.Trait_ID}: ${currentDef?.Trait_Name} (${plotType.toUpperCase()})`,
            font: { size: 15, color: '#0f2b46' },
          },
          xaxis: { title: { text: customXLabel || 'Experimental Group' } },
          yaxis: {
            title: { text: customYLabel || `${currentDef?.Trait_Name} (${currentDef?.Unit})` },
          },
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#f8fafc',
          margin: { t: 55, r: 30, b: 60, l: 70 },
          height: 480,
        },
      };
    }

    if (plotType === 'bar') {
      const xGrps = orderedGroups;
      const means = xGrps.map(
        (g) => byTraitSummaries[selectedTraitId]?.groups?.[g]?.mean ?? 0
      );
      const sds = xGrps.map(
        (g) => byTraitSummaries[selectedTraitId]?.groups?.[g]?.sd ?? 0
      );
      return {
        plotData: [
          {
            type: 'bar',
            x: xGrps,
            y: means,
            error_y: {
              type: 'data',
              array: sds,
              visible: true,
              color: '#0f2b46',
            },
            marker: {
              color: xGrps.map((_, i) => palette[i % palette.length]),
            },
            text: means.map((m) => m.toFixed(2)),
            textposition: 'auto',
          },
        ] as any[],
        plotLayout: {
          title: {
            text: `${currentDef?.Trait_ID}: Group Mean ± SD Comparison`,
            font: { size: 15, color: '#0f2b46' },
          },
          xaxis: { title: { text: customXLabel || 'Experimental Group' } },
          yaxis: {
            title: { text: customYLabel || `Mean ${currentDef?.Trait_Name} (${currentDef?.Unit})` },
          },
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#f8fafc',
          margin: { t: 55, r: 30, b: 60, l: 70 },
          height: 480,
        },
      };
    }

    if (plotType === 'distribution') {
      const traces = orderedGroups.map((grp, idx) => {
        const grpSamples = sampleResults.filter((r) => r.group === grp);
        const xVals = grpSamples
          .map((r) => r.traits[selectedTraitId])
          .filter((v): v is number => v !== null && v !== undefined);
        return {
          type: 'histogram',
          name: grp,
          x: xVals,
          opacity: 0.7,
          marker: { color: palette[idx % palette.length] },
        };
      });
      return {
        plotData: traces as any[],
        plotLayout: {
          barmode: 'overlay',
          title: {
            text: `${currentDef?.Trait_ID}: Sample-Level Trait Distribution`,
            font: { size: 15, color: '#0f2b46' },
          },
          xaxis: {
            title: { text: customXLabel || `${currentDef?.Trait_Name} (${currentDef?.Unit})` },
          },
          yaxis: { title: { text: customYLabel || 'Sample Count' } },
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#f8fafc',
          margin: { t: 55, r: 30, b: 60, l: 70 },
          height: 480,
        },
      };
    }

    if (plotType === 'group_comparison') {
      const traitsToPlot =
        selectedMultiTraits.length > 0
          ? selectedMultiTraits
          : ['T02', 'T04', 'T08', 'T09', 'T15', 'T20'];
      const traces = orderedGroups.map((grp, idx) => ({
        type: 'bar',
        name: grp,
        x: traitsToPlot,
        y: traitsToPlot.map(
          (tid) => byTraitSummaries[tid]?.groups?.[grp]?.mean ?? 0
        ),
        error_y: {
          type: 'data',
          array: traitsToPlot.map(
            (tid) => byTraitSummaries[tid]?.groups?.[grp]?.se ?? 0
          ),
          visible: true,
        },
        marker: { color: palette[idx % palette.length] },
      }));
      return {
        plotData: traces as any[],
        plotLayout: {
          barmode: 'group',
          title: {
            text: 'Multi-Trait Group Comparison (Mean ± SE)',
            font: { size: 15, color: '#0f2b46' },
          },
          xaxis: { title: { text: customXLabel || 'Composition-Derived Trait ID' } },
          yaxis: { title: { text: customYLabel || 'Value (% or Index)' } },
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#f8fafc',
          margin: { t: 55, r: 30, b: 60, l: 70 },
          height: 480,
        },
      };
    }

    if (plotType === 'radar') {
      const radarTraits =
        selectedMultiTraits.length >= 3
          ? selectedMultiTraits
          : ['T02', 'T04', 'T08', 'T09', 'T15', 'T20'];
      const traces = orderedGroups.map((grp, idx) => {
        const rVals = radarTraits.map(
          (tid) => byTraitSummaries[tid]?.groups?.[grp]?.mean ?? 0
        );
        return {
          type: 'scatterpolar',
          name: grp,
          r: [...rVals, rVals[0]],
          theta: [...radarTraits, radarTraits[0]],
          fill: 'toself',
          marker: { color: palette[idx % palette.length] },
        };
      });
      return {
        plotData: traces as any[],
        plotLayout: {
          title: {
            text: 'Multi-Trait Group Profile (Radar Chart)',
            font: { size: 15, color: '#0f2b46' },
          },
          polar: {
            radialaxis: { visible: true },
          },
          paper_bgcolor: '#ffffff',
          margin: { t: 55, r: 40, b: 55, l: 40 },
          height: 500,
        },
      };
    }

    if (plotType === 'heatmap') {
      const baselineDefs = allDefs.filter((d) => d.Is_Baseline);
      const traitIds = baselineDefs.map((d) => d.Trait_ID);
      const zMatrix = traitIds.map((tid) => {
        const rawArr = sampleResults.map((r) => r.traits[tid] ?? 0);
        const mean = rawArr.reduce((a, b) => a + b, 0) / (rawArr.length || 1);
        const sd =
          Math.sqrt(
            rawArr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
              (rawArr.length || 1)
          ) || 1;
        return rawArr.map((v) => (v - mean) / sd);
      });

      return {
        plotData: [
          {
            type: 'heatmap',
            x: sampleIds,
            y: traitIds,
            z: zMatrix,
            colorscale: 'RdBu',
            reversescale: true,
            colorbar: { title: 'Z-Score' },
          },
        ] as any[],
        plotLayout: {
          title: {
            text: 'Sample × Composition Trait Heatmap (Z-Score Standardized)',
            font: { size: 15, color: '#0f2b46' },
          },
          xaxis: { title: { text: customXLabel || 'Sample ID' } },
          yaxis: { title: { text: customYLabel || 'Trait ID' } },
          paper_bgcolor: '#ffffff',
          margin: { t: 55, r: 40, b: 80, l: 70 },
          height: 560,
        },
      };
    }

    if (plotType === 'correlation') {
      const baselineDefs = allDefs.filter((d) => d.Is_Baseline && d.Trait_ID !== 'T01');
      const traitIds = baselineDefs.map((d) => d.Trait_ID);
      const vectors: Record<string, number[]> = {};
      traitIds.forEach((tid) => {
        vectors[tid] = sampleResults.map((r) => r.traits[tid] ?? 0);
      });

      const corrMatrix = traitIds.map((t1) =>
        traitIds.map((t2) => {
          const x = vectors[t1];
          const y = vectors[t2];
          const n = x.length || 1;
          const mx = x.reduce((a, b) => a + b, 0) / n;
          const my = y.reduce((a, b) => a + b, 0) / n;
          let num = 0;
          let dx = 0;
          let dy = 0;
          for (let i = 0; i < n; i++) {
            num += (x[i] - mx) * (y[i] - my);
            dx += Math.pow(x[i] - mx, 2);
            dy += Math.pow(y[i] - my, 2);
          }
          const den = Math.sqrt(dx * dy);
          return den > 1e-12 ? num / den : 0;
        })
      );

      return {
        plotData: [
          {
            type: 'heatmap',
            x: traitIds,
            y: traitIds,
            z: corrMatrix,
            zmin: -1,
            zmax: 1,
            colorscale: 'RdBu',
            reversescale: true,
            colorbar: { title: 'Pearson r' },
          },
        ] as any[],
        plotLayout: {
          title: {
            text: 'Trait-to-Trait Pearson Correlation Matrix (T02–T28)',
            font: { size: 15, color: '#0f2b46' },
          },
          xaxis: { title: { text: 'Trait ID' } },
          yaxis: { title: { text: 'Trait ID' } },
          paper_bgcolor: '#ffffff',
          margin: { t: 55, r: 40, b: 80, l: 70 },
          height: 580,
        },
      };
    }

    // plotType === 'sample_contribution': Plot all pool traits T02-T08 + T09 + T15 for the selected sample
    const targetSample =
      sampleResults.find((r) => r.sample_id === selectedSampleId) ||
      sampleResults[0];
    const poolTraitIds = [
      'T02',
      'T03',
      'T04',
      'T05',
      'T06',
      'T07',
      'T08',
      'T09',
      'T10',
      'T11',
      'T15',
      'T16',
      'T17',
    ];
    const yVals = poolTraitIds.map((tid) => targetSample?.traits[tid] ?? 0);

    return {
      plotData: [
        {
          type: 'bar',
          x: poolTraitIds,
          y: yVals,
          marker: { color: palette[0] },
          text: yVals.map((v) => `${v.toFixed(2)}%`),
          textposition: 'auto',
        },
      ] as any[],
      plotLayout: {
        title: {
          text: `Individual Sample Glycan Pool Contribution Profile — Sample ${targetSample?.sample_id || ''} (${targetSample?.group || ''})`,
          font: { size: 15, color: '#0f2b46' },
        },
        xaxis: {
          title: { text: customXLabel || 'Composition Pool Trait ID' },
        },
        yaxis: {
          title: { text: customYLabel || 'Relative Abundance (%)' },
        },
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#f8fafc',
        margin: { t: 55, r: 30, b: 70, l: 70 },
        height: 480,
      },
    };
  }, [
    plotType,
    selectedTraitId,
    selectedSampleId,
    colorScheme,
    orderedGroups,
    customXLabel,
    customYLabel,
    selectedMultiTraits,
    allDefs,
    sampleResults,
    sampleIds,
    byTraitSummaries,
    currentDef,
    palette,
  ]);

  const toggleMultiTrait = (tid: string) => {
    setSelectedMultiTraits((prev) =>
      prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]
    );
  };

  return (
    <div>
      <div className="gareg-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 className="gareg-card-title" style={{ margin: 0 }}>
              Interactive Scientific Visualization Studio
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
              Publication-ready interactive Plotly visualizations with accompanying mathematical trait explanations and PNG / SVG / PDF export.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary"
              onClick={() => triggerPlotDownload('png')}
            >
              Export PNG
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => triggerPlotDownload('svg')}
            >
              Export SVG
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => window.print()}
            >
              Print / Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* Plot Controls Card */}
      <div className="gareg-card">
        <h3 style={{ margin: '0 0 12px', fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sliders size={18} color="#0284c7" /> Visualization Controls
        </h3>
        <div className="gareg-grid-3">
          <div>
            <label className="form-label">1. Select Plot Type (10 Scientific Formats)</label>
            <select
              className="form-select"
              value={plotType}
              onChange={(e) => setPlotType(e.target.value as PlotType)}
            >
              <option value="boxplot">Boxplot (with Individual Sample Points &amp; Mean)</option>
              <option value="violin">Violin Plot (Kernel Density + Boxplot)</option>
              <option value="bar">Bar Chart (Group Mean ± SD)</option>
              <option value="dot">Dot / Strip Plot (Individual Samples)</option>
              <option value="distribution">Trait Distribution Histogram</option>
              <option value="group_comparison">Multi-Trait Group Comparison Bar Chart</option>
              <option value="radar">Radar Chart (Multi-Trait Group Profile)</option>
              <option value="heatmap">Sample × Trait Standardized Heatmap</option>
              <option value="correlation">Trait Correlation Matrix (Pearson r)</option>
              <option value="sample_contribution">Individual Sample Pool Contribution Plot</option>
            </select>
          </div>

          <div>
            <label className="form-label">2. Select Primary Trait</label>
            <select
              className="form-select"
              value={selectedTraitId}
              onChange={(e) => setSelectedTraitId(e.target.value)}
            >
              {allDefs.map((d) => (
                <option key={d.Trait_ID} value={d.Trait_ID}>
                  {d.Trait_ID} — {d.Trait_Name} ({d.Unit})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">3. Sample Selection (For Sample Contribution &amp; Audit)</label>
            <select
              className="form-select"
              value={selectedSampleId}
              onChange={(e) => setSelectedSampleId(e.target.value)}
            >
              {sampleResults.map((r) => (
                <option key={r.sample_id} value={r.sample_id}>
                  {r.sample_id} ({r.group})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">4. Color Palette</label>
            <select
              className="form-select"
              value={colorScheme}
              onChange={(e) => setColorScheme(e.target.value)}
            >
              <option value="GAREG_Scientific">GAREG Brand Scientific (Navy / Cyan / Amber)</option>
              <option value="Colorblind_OkabeIto">Colorblind-Safe (Okabe-Ito Palette)</option>
              <option value="Nature_Publishing">Journal Publishing Palette (NPG)</option>
              <option value="High_Contrast">High-Contrast Presentation</option>
            </select>
          </div>

          <div>
            <label className="form-label">5. Group Display Order</label>
            <select
              className="form-select"
              value={groupOrderMode}
              onChange={(e) => setGroupOrderMode(e.target.value as any)}
            >
              <option value="default">Dataset Order ({orderedGroups.join(' → ')})</option>
              <option value="alphabetical">Alphabetical (A → Z)</option>
              <option value="reverse">Reverse Order</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Custom X-Axis Label</label>
              <input
                type="text"
                className="form-control"
                placeholder="Auto"
                value={customXLabel}
                onChange={(e) => setCustomXLabel(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Custom Y-Axis Label</label>
              <input
                type="text"
                className="form-control"
                placeholder="Auto"
                value={customYLabel}
                onChange={(e) => setCustomYLabel(e.target.value)}
              />
            </div>
          </div>
        </div>

        {(plotType === 'group_comparison' || plotType === 'radar') && (
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
            <label className="form-label">Select Traits for Multi-Trait Plot:</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {allDefs
                .filter((d) => d.Is_Baseline)
                .map((d) => {
                  const active = selectedMultiTraits.includes(d.Trait_ID);
                  return (
                    <button
                      key={d.Trait_ID}
                      className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => toggleMultiTrait(d.Trait_ID)}
                    >
                      {d.Trait_ID}
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Main Plotly Canvas */}
      <div className="gareg-card">
        <Plot
          data={plotData}
          layout={plotLayout}
          config={{
            responsive: true,
            displaylogo: false,
            toImageButtonOptions: {
              format: 'svg',
              filename: `GAREG_${plotType}_${selectedTraitId}`,
              height: 700,
              width: 1200,
              scale: 2,
            },
          }}
          style={{ width: '100%' }}
        />
      </div>

      {/* Accompanying Trait Explanation Panel (Required by Section 13) */}
      {currentDef && (
        <div className="gareg-card" style={{ borderLeft: '4px solid #0284c7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '10px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge badge-sky">{currentDef.Trait_ID}</span>
                <span className="badge badge-sky">{currentDef.Analytical_Category}</span>
                <span className="badge badge-emerald">Unit: {currentDef.Unit}</span>
              </div>
              <h3 style={{ margin: '6px 0 0', fontSize: '1.05rem' }}>
                Accompanying Mathematical &amp; Biological Explanation: {currentDef.Trait_Name}
              </h3>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => onInspectTrait(currentDef.Trait_ID, selectedSampleId)}
            >
              <Eye size={14} /> Open Full Contribution Audit ({selectedSampleId})
            </button>
          </div>

          <div className="formula-box">
            <div><strong>Symbolic Formula:</strong> {currentDef.Mathematical_Formula}</div>
            <div style={{ marginTop: '4px', color: '#e2e8f0' }}>
              <strong>Executable Expression:</strong> {currentDef.Plain_Formula}
            </div>
          </div>

          <div className="gareg-grid-2" style={{ marginTop: '12px' }}>
            <div>
              <div className="form-label">Biological Meaning &amp; Inclusion Rules</div>
              <p style={{ fontSize: '0.84rem', color: '#334155', margin: '0 0 8px' }}>
                {currentDef.Interpretation}
              </p>
              <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0 }}>
                <strong>Inclusion Criteria:</strong> {currentDef.Inclusion_Criteria}
              </p>
            </div>
            <div className="alert-banner alert-warning" style={{ marginBottom: 0 }}>
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Scientific Scope &amp; Structural Limitation:</strong>
                <div style={{ marginTop: '4px' }}>{currentDef.Limitations}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
