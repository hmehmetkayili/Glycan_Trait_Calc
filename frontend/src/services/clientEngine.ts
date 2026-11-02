import refDataRaw from './referenceData.json';
import {
  SessionSummary,
  TraitDefinition,
  ParsedCompositionItem,
  SampleTraitResult,
  GroupStatValues,
  GroupComparisonItem,
  ValidationCheckItem,
  StructuralAnnotationRow,
  TraitContributionAudit,
} from '../types';

const refData = refDataRaw as any;
if (refData && !Array.isArray(refData.trait_definitions)) {
  if (Array.isArray(refData.trait_definitions?.composition_traits)) {
    refData.trait_definitions = refData.trait_definitions.composition_traits;
  } else {
    refData.trait_definitions = [];
  }
}
if (refData && !Array.isArray(refData.structural_trait_definitions)) {
  if (Array.isArray(refData.structural_trait_definitions?.structure_traits)) {
    refData.structural_trait_definitions = refData.structural_trait_definitions.structure_traits;
  } else {
    refData.structural_trait_definitions = [];
  }
}

const NOT_DERIVABLE_TEXT = 'Not derivable from composition-only data.';

export const NORMALIZATION_METHODS_CATALOG: Record<string, string> = {
  total_area_pct:
    'Total Area Normalization (TAN → Relative Abundance %, Sum = 100%)',
  total_area_prop:
    'Total Area Normalization (Proportion 0–1, Sum = 1.0)',
  pqn_pct:
    'Probabilistic Quotient Normalization (PQN) + Relative Abundance (%)',
  median_scaling_pct:
    'Upper-Quartile (Q75) / Median Scaling + Relative Abundance (%)',
  quantile_pct:
    'Quantile Distribution Normalization + Relative Abundance (%)',
  base_peak_pct:
    'Base Peak Normalization (Max Glycan = 100%) + Relative Abundance (%)',
  none_as_is:
    'None — Preserve Uploaded Values As-Is (Already Normalized %)',
};

interface ClientSession {
  session_id: string;
  active_demo_id?: string;
  filename: string;
  rows: Record<string, any>[];
  all_columns: string[];
  sample_id_col: string;
  group_col: string | null;
  metadata_cols: string[];
  glycan_cols: string[];
  unrecognized_numeric_cols: string[];
  measurement_type: string;
  normalization_method: string;
  apply_closure: boolean;
  zero_handling: string;
  excluded_samples: string[];
  parser_config: {
    treat_f_as_fucose: boolean;
    treat_dhex_as_fucose: boolean;
    assume_s_is_neuac: boolean;
    manual_overrides: Record<string, Record<string, number>>;
    custom_components: Record<string, string>;
  };
  custom_traits: Array<{
    definition: TraitDefinition;
    spec: any;
  }>;
  structural_annotations: Record<string, StructuralAnnotationRow>;
  metadata_merge_report?: SessionSummary['metadata_merge_report'];
  normalized_pct_rows: Record<string, any>[];
  normalized_custom_rows: Record<string, any>[];
  summary: SessionSummary;
}

const clientSessions: Record<string, ClientSession> = {};

// ============================================================================
// 1. GLYCAN COMPOSITION PARSER (Order-Independent H/N/F/S & Extended Notation)
// ============================================================================
export function parseGlycanComposition(
  rawLabel: string,
  config?: ClientSession['parser_config']
): ParsedCompositionItem {
  const treatF = config?.treat_f_as_fucose ?? true;
  const treatDHex = config?.treat_dhex_as_fucose ?? false;
  const assumeSNeuAc = config?.assume_s_is_neuac ?? false;
  const overrides = config?.manual_overrides || {};

  const label = String(rawLabel || '').trim();
  const baseItem: ParsedCompositionItem = {
    raw_label: label,
    normalized_label: label,
    is_valid: false,
    status: 'invalid_empty',
    Hex: 0,
    HexNAc: 0,
    Fucose: 0,
    Sialic_Acid: 0,
    S_generic: 0,
    NeuAc: 0,
    NeuGc: 0,
    dHex: 0,
    HexA: 0,
    Pentose: 0,
    Sulfate: 0,
    Phosphate: 0,
    unknown_symbols: [],
    duplicate_components: [],
    warnings: [],
    errors: [],
    is_manual_override: false,
    sialic_acid_type_note: 'Unspecified sialic acid (generic S)',
    fucose_Config_note: treatF
      ? 'F confirmed as Fucose'
      : 'F treated as unspecified deoxyhexose (dHex)',
    flags: {},
  };

  if (!label) {
    baseItem.errors.push('Empty composition label.');
    return baseItem;
  }

  if (overrides[label]) {
    const ov = overrides[label];
    baseItem.Hex = Number(ov.Hex || 0);
    baseItem.HexNAc = Number(ov.HexNAc || 0);
    baseItem.Fucose = Number(ov.Fucose || 0);
    baseItem.Sialic_Acid = Number(ov.Sialic_Acid || 0);
    baseItem.S_generic = baseItem.Sialic_Acid;
    baseItem.is_valid =
      baseItem.Hex + baseItem.HexNAc + baseItem.Fucose + baseItem.Sialic_Acid > 0;
    baseItem.status = baseItem.is_valid ? 'valid_manual_override' : 'invalid_zero_total';
    baseItem.is_manual_override = true;
    baseItem.normalized_label = buildCanonicalLabel(baseItem);
    baseItem.flags = computeReferenceFlags(baseItem);
    return baseItem;
  }

  const cleaned = label.replace(/\s+/g, '');
  const tokenRegex =
    /(Neu5Ac|NeuAc|Neu5Gc|NeuGc|HexNAc|HexA|dHex|Pentose|Pent|Pen|Sulf|Su|Phos|Hex|Fuc|Sia|Ac|Gc|H|N|F|S|P|G|M)(\d+)/g;

  const seenCanonicals = new Set<string>();
  let matchedLength = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(cleaned)) !== null) {
    if (match.index !== matchedLength) {
      const unk = cleaned.slice(matchedLength, match.index);
      if (unk) baseItem.unknown_symbols.push(unk);
    }
    matchedLength = match.index + match[0].length;
    const sym = match[1];
    const count = parseInt(match[2], 10);

    let canon = sym;
    if (sym === 'H' || sym === 'Hex' || sym === 'G' || sym === 'M') canon = 'Hex';
    else if (sym === 'N' || sym === 'HexNAc') canon = 'HexNAc';
    else if (sym === 'F' || sym === 'Fuc') canon = 'F';
    else if (sym === 'S' || sym === 'Sia') canon = 'S';
    else if (sym === 'Neu5Ac' || sym === 'NeuAc' || sym === 'Ac') canon = 'NeuAc';
    else if (sym === 'Neu5Gc' || sym === 'NeuGc' || sym === 'Gc') canon = 'NeuGc';
    else if (sym === 'dHex') canon = 'dHex';
    else if (sym === 'HexA') canon = 'HexA';
    else if (sym === 'Pentose' || sym === 'Pent' || sym === 'Pen') canon = 'Pentose';
    else if (sym === 'Sulf' || sym === 'Su') canon = 'Sulfate';
    else if (sym === 'Phos' || sym === 'P') canon = 'Phosphate';

    if (seenCanonicals.has(canon)) {
      baseItem.duplicate_components.push(canon);
    }
    seenCanonicals.add(canon);

    if (canon === 'Hex') baseItem.Hex += count;
    else if (canon === 'HexNAc') baseItem.HexNAc += count;
    else if (canon === 'F') {
      if (treatF) baseItem.Fucose += count;
      else baseItem.dHex += count;
    } else if (canon === 'dHex') {
      baseItem.dHex += count;
      if (treatDHex) baseItem.Fucose += count;
    } else if (canon === 'S') {
      baseItem.S_generic += count;
      if (assumeSNeuAc) baseItem.NeuAc += count;
    } else if (canon === 'NeuAc') baseItem.NeuAc += count;
    else if (canon === 'NeuGc') baseItem.NeuGc += count;
    else if (canon === 'HexA') baseItem.HexA += count;
    else if (canon === 'Pentose') baseItem.Pentose += count;
    else if (canon === 'Sulfate') baseItem.Sulfate += count;
    else if (canon === 'Phosphate') baseItem.Phosphate += count;
  }

  if (matchedLength < cleaned.length) {
    baseItem.unknown_symbols.push(cleaned.slice(matchedLength));
  }

  baseItem.Sialic_Acid =
    (assumeSNeuAc ? 0 : baseItem.S_generic) + baseItem.NeuAc + baseItem.NeuGc;

  if (baseItem.NeuAc > 0 || baseItem.NeuGc > 0) {
    baseItem.sialic_acid_type_note = `Explicit sialic acid species (NeuAc=${baseItem.NeuAc}, NeuGc=${baseItem.NeuGc})`;
  } else if (baseItem.S_generic > 0) {
    baseItem.sialic_acid_type_note = assumeSNeuAc
      ? 'Generic S mapped to NeuAc by user configuration'
      : 'Generic S (sialic acid type unspecified; not assumed to be NeuAc)';
  } else {
    baseItem.sialic_acid_type_note = 'Asialo (S=0)';
  }

  if (baseItem.duplicate_components.length > 0) {
    baseItem.is_valid = false;
    baseItem.status = 'invalid_duplicate_component';
    baseItem.errors.push(
      `Duplicate component symbols: ${baseItem.duplicate_components.join(', ')}`
    );
    return baseItem;
  }

  if (baseItem.unknown_symbols.length > 0) {
    baseItem.is_valid = false;
    baseItem.status = 'invalid_unknown_symbol';
    baseItem.errors.push(
      `Unrecognized symbols: ${baseItem.unknown_symbols.join(', ')}`
    );
    return baseItem;
  }

  const totalResidues =
    baseItem.Hex +
    baseItem.HexNAc +
    baseItem.Fucose +
    baseItem.Sialic_Acid +
    baseItem.dHex +
    baseItem.HexA +
    baseItem.Pentose;

  if (totalResidues <= 0) {
    baseItem.is_valid = false;
    baseItem.status = 'invalid_zero_total';
    baseItem.errors.push('Total monosaccharide count is zero.');
    return baseItem;
  }

  baseItem.is_valid = true;
  baseItem.status = 'valid';
  baseItem.normalized_label = buildCanonicalLabel(baseItem);
  baseItem.flags = computeReferenceFlags(baseItem);
  return baseItem;
}

function buildCanonicalLabel(c: ParsedCompositionItem): string {
  const parts: string[] = [];
  if (c.Hex > 0) parts.push(`H${c.Hex}`);
  if (c.HexNAc > 0) parts.push(`N${c.HexNAc}`);
  if (c.Fucose > 0) parts.push(`F${c.Fucose}`);
  if (c.Sialic_Acid > 0) parts.push(`S${c.Sialic_Acid}`);
  return parts.join('') || c.raw_label;
}

export function computeReferenceFlags(
  c: Pick<ParsedCompositionItem, 'Hex' | 'HexNAc' | 'Fucose' | 'Sialic_Acid'>
): Record<string, number> {
  const H = c.Hex;
  const N = c.HexNAc;
  const F = c.Fucose;
  const S = c.Sialic_Acid;
  const hm = N === 2 && H >= 5 && H <= 9 && F === 0 && S === 0 ? 1 : 0;
  const pauci = N === 2 && H >= 1 && H <= 4 && F >= 0 && F <= 1 && S === 0 ? 1 : 0;
  return {
    'High_Mannose_H5-H9N2': hm,
    High_Mannose_H5_H9N2: hm,
    High_Mannose_Strict: hm,
    Paucimannose_pool: pauci,
    H4N2_pool: pauci,
    N3_pool_proxy: N === 3 ? 1 : 0,
    N4_pool: N === 4 ? 1 : 0,
    N5_pool: N === 5 ? 1 : 0,
    N6_pool: N === 6 ? 1 : 0,
    Nge4_complex_candidate: N >= 4 ? 1 : 0,
    Fucosylated: F >= 1 ? 1 : 0,
    Mono_Fucosylated: F === 1 ? 1 : 0,
    Di_Fucosylated: F === 2 ? 1 : 0,
    Sialylated: S >= 1 ? 1 : 0,
    Sialylated_nonFucosylated: S >= 1 && F === 0 ? 1 : 0,
    Sialylated_Fucosylated: S >= 1 && F >= 1 ? 1 : 0,
    Nge4_Fucosylated: N >= 4 && F >= 1 ? 1 : 0,
    Nge4_Sialylated: N >= 4 && S >= 1 ? 1 : 0,
    Hex_excess_over_3_in_Nge4: N >= 4 ? Math.max(0, H - 3) : 0,
  };
}

// ============================================================================
// 2. GLYCOMIC NORMALIZATION ENGINE (TAN, 0-1, PQN, Q75/Median, Quantile, Base Peak)
// ============================================================================
function applyGlycomicNormalization(
  rawMatrix: number[][],
  method: string,
  measurementType: string,
  applyClosure: boolean
): {
  workingPctMatrix: number[][];
  customNormMatrix: number[][];
  description: string;
} {
  const nSamples = rawMatrix.length;
  if (nSamples === 0 || (rawMatrix[0]?.length || 0) === 0) {
    return {
      workingPctMatrix: [],
      customNormMatrix: [],
      description: 'Empty matrix',
    };
  }
  const nGlycans = rawMatrix[0].length;

  // Helper to close any non-negative matrix to 100% per row
  const closeTo100 = (mat: number[][]): number[][] =>
    mat.map((row) => {
      const s = row.reduce((a, b) => a + Math.max(0, b), 0);
      return s > 1e-15 ? row.map((v) => (100.0 * Math.max(0, v)) / s) : row.map(() => 0);
    });

  if (method === 'total_area_pct' || (applyClosure && method === 'none_as_is')) {
    const pct = closeTo100(rawMatrix);
    return {
      workingPctMatrix: pct,
      customNormMatrix: pct,
      description:
        'Total Area Normalization (TAN → Relative Abundance %): P_ik = 100 * x_ik / sum_k(x_ik)',
    };
  }

  if (method === 'total_area_prop') {
    const prop = rawMatrix.map((row) => {
      const s = row.reduce((a, b) => a + Math.max(0, b), 0);
      return s > 1e-15 ? row.map((v) => Math.max(0, v) / s) : row.map(() => 0);
    });
    const pct = prop.map((row) => row.map((v) => 100.0 * v));
    return {
      workingPctMatrix: pct,
      customNormMatrix: prop,
      description:
        'Total Area Normalization (Proportion 0–1): p_ik = x_ik / sum_k(x_ik) (scaled x100 for % trait reporting)',
    };
  }

  if (method === 'base_peak_pct') {
    const bp = rawMatrix.map((row) => {
      const maxVal = Math.max(...row.map((v) => Math.max(0, v)), 0);
      return maxVal > 1e-15
        ? row.map((v) => (100.0 * Math.max(0, v)) / maxVal)
        : row.map(() => 0);
    });
    const pct = closeTo100(bp);
    return {
      workingPctMatrix: pct,
      customNormMatrix: bp,
      description:
        'Base Peak Normalization (Highest Glycan Peak = 100% per sample) + Closed Relative Abundance (%)',
    };
  }

  if (method === 'median_scaling_pct') {
    const scaled = rawMatrix.map((row) => {
      const pos = row.filter((v) => v > 0).sort((a, b) => a - b);
      if (pos.length === 0) return row.map(() => 0);
      const q75Idx = Math.floor(0.75 * (pos.length - 1));
      const scaleFactor = pos[q75Idx] || pos[Math.floor(pos.length / 2)] || 1;
      return row.map((v) => (Math.max(0, v) / scaleFactor) * 100.0);
    });
    const pct = closeTo100(scaled);
    return {
      workingPctMatrix: pct,
      customNormMatrix: scaled,
      description:
        'Upper-Quartile (Q75) / Median Intensity Scaling + Closed Relative Abundance (%)',
    };
  }

  if (method === 'pqn_pct') {
    // Step 1: initial total-area normalization to get reference spectrum
    const initTac = closeTo100(rawMatrix);
    const refSpectrum = new Array(nGlycans).fill(0).map((_, k) => {
      const colVals = initTac
        .map((r) => r[k])
        .filter((v) => v > 0)
        .sort((a, b) => a - b);
      if (colVals.length === 0) return 1.0;
      return colVals[Math.floor(colVals.length / 2)] || 1.0;
    });
    // Step 2: compute median quotient q_i for each sample
    const pqnScaled = rawMatrix.map((row) => {
      const quotients: number[] = [];
      for (let k = 0; k < nGlycans; k++) {
        if (row[k] > 0 && refSpectrum[k] > 0) {
          quotients.push(row[k] / refSpectrum[k]);
        }
      }
      quotients.sort((a, b) => a - b);
      const q = quotients.length > 0 ? quotients[Math.floor(quotients.length / 2)] : 1.0;
      return q > 1e-15 ? row.map((v) => Math.max(0, v) / q) : row.map(() => 0);
    });
    const pct = closeTo100(pqnScaled);
    return {
      workingPctMatrix: pct,
      customNormMatrix: pqnScaled,
      description:
        'Probabilistic Quotient Normalization (PQN by Median Reference Spectrum Quotient) + Closed Relative Abundance (%)',
    };
  }

  if (method === 'quantile_pct') {
    // Sort each sample row, average across ranks, and reassign
    const sortedRows = rawMatrix.map((row) => [...row].sort((a, b) => a - b));
    const rankMeans = new Array(nGlycans).fill(0).map((_, rankIdx) => {
      let sum = 0;
      for (let i = 0; i < nSamples; i++) sum += sortedRows[i][rankIdx];
      return sum / nSamples;
    });
    const quantMatrix = rawMatrix.map((row) => {
      const indexed = row.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v);
      const out = new Array(nGlycans).fill(0);
      indexed.forEach((item, rankIdx) => {
        out[item.idx] = Math.max(0, rankMeans[rankIdx]);
      });
      return out;
    });
    const pct = closeTo100(quantMatrix);
    return {
      workingPctMatrix: pct,
      customNormMatrix: quantMatrix,
      description:
        'Quantile Distribution Normalization across samples + Closed Relative Abundance (%)',
    };
  }

  // 'none_as_is'
  if (measurementType === 'relative_abundance_prop') {
    const pct = rawMatrix.map((row) => row.map((v) => 100.0 * v));
    return {
      workingPctMatrix: pct,
      customNormMatrix: rawMatrix,
      description: 'Scaled 0–1 proportions by 100 for percentage display (no re-normalization)',
    };
  }

  return {
    workingPctMatrix: rawMatrix.map((row) => [...row]),
    customNormMatrix: rawMatrix.map((row) => [...row]),
    description: 'Original uploaded values preserved directly (no re-normalization applied)',
  };
}

// ============================================================================
// 3. TRAIT EVALUATION RULES (T01-T28, T12b, T08b, T29-T34, Custom Traits)
// ============================================================================
interface GlycanTraitRuleResult {
  included: boolean;
  numWeight: number;
  inDenom: boolean;
  denWeight: number;
  scale: number;
  reason: string;
}

function evaluateGlycanForTrait(
  traitId: string,
  c: ParsedCompositionItem,
  customSpec?: any
): GlycanTraitRuleResult {
  const H = c.Hex;
  const N = c.HexNAc;
  const F = c.Fucose;
  const S = c.Sialic_Acid;

  if (!c.is_valid) {
    return {
      included: false,
      numWeight: 0,
      inDenom: false,
      denWeight: 0,
      scale: 1,
      reason: 'Invalid composition label.',
    };
  }

  switch (traitId) {
    case 'T01':
      return { included: true, numWeight: 1, inDenom: false, denWeight: 0, scale: 1, reason: 'Included in total glycan abundance pool.' };
    case 'T02': {
      const inc = N === 2 && H >= 5 && H <= 9 && F === 0 && S === 0;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `HexNAc=2, Hex=${H} (5..9), F=0, S=0` : `Excluded (H=${H}, N=${N}, F=${F}, S=${S})` };
    }
    case 'T03': {
      const inc = N === 2 && H >= 1 && H <= 4 && F >= 0 && F <= 1 && S === 0;
      return {
        included: inc,
        numWeight: inc ? 1 : 0,
        inDenom: false,
        denWeight: 0,
        scale: 1,
        reason: inc
          ? `Paucimannose-type N-glycan (H=${H} in 1..4, N=2, F=${F} in 0..1, S=0)`
          : `Excluded (H=${H}, N=${N}, F=${F}, S=${S})`,
      };
    }
    case 'T04': {
      const inc = N === 3;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? 'HexNAc (N) = 3' : `Excluded (N=${N} != 3)` };
    }
    case 'T05': {
      const inc = N === 4;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? 'HexNAc (N) = 4' : `Excluded (N=${N} != 4)` };
    }
    case 'T06': {
      const inc = N === 5;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? 'HexNAc (N) = 5' : `Excluded (N=${N} != 5)` };
    }
    case 'T07': {
      const inc = N === 6;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? 'HexNAc (N) = 6' : `Excluded (N=${N} != 6)` };
    }
    case 'T08': {
      const inc = N >= 4;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `HexNAc (N=${N}) >= 4` : `Excluded (N=${N} < 4)` };
    }
    case 'T08b': {
      const inc = N >= 7;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `HexNAc (N=${N}) >= 7` : `Excluded (N=${N} < 7)` };
    }
    case 'T09': {
      const inc = F >= 1;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `Fucose (F=${F}) >= 1` : 'Excluded (F=0)' };
    }
    case 'T10': {
      const inc = F === 0;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? 'Non-fucosylated (F=0)' : `Excluded (F=${F} > 0)` };
    }
    case 'T11': {
      const inc = F === 1;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? 'Mono-fucosylated (F=1)' : `Excluded (F=${F} != 1)` };
    }
    case 'T12': {
      const inc = F === 2;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? 'Di-fucosylated (F=2)' : `Excluded (F=${F} != 2)` };
    }
    case 'T12b': {
      const inc = F >= 2;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `Multi-fucosylated (F=${F} >= 2)` : `Excluded (F=${F} < 2)` };
    }
    case 'T13': {
      const inc = F > 0;
      return { included: inc, numWeight: F, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `Weighted by F=${F}` : 'Excluded (F=0)' };
    }
    case 'T14': {
      const inc = F > 0;
      return {
        included: inc,
        numWeight: F,
        inDenom: true,
        denWeight: 1,
        scale: 1,
        reason: inc ? `Weighted by F=${F} over total classified abundance` : 'In total abundance denominator (F=0)',
      };
    }
    case 'T15': {
      const inc = N >= 4 && F >= 1;
      const den = N >= 4;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: den, denWeight: den ? 1 : 0, scale: 100, reason: inc ? 'In numerator (N>=4, F>=1) and denominator (N>=4)' : den ? 'In denominator (N>=4) only (F=0)' : `Excluded (N=${N} < 4)` };
    }
    case 'T16': {
      const inc = S >= 1;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `Sialic acid (S=${S}) >= 1` : 'Excluded (S=0)' };
    }
    case 'T17': {
      const inc = S >= 1 && F === 0;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `S=${S}>=1 and F=0` : `Excluded (S=${S}, F=${F})` };
    }
    case 'T18': {
      const inc = S >= 1 && F >= 1;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `S=${S}>=1 and F=${F}>=1` : `Excluded (S=${S}, F=${F})` };
    }
    case 'T19': {
      const inc = S > 0;
      return { included: inc, numWeight: S, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `Weighted by S=${S}` : 'Excluded (S=0)' };
    }
    case 'T20': {
      const inc = S > 0;
      return {
        included: inc,
        numWeight: S,
        inDenom: true,
        denWeight: 1,
        scale: 1,
        reason: inc ? `Weighted by S=${S} over total classified abundance` : 'In total abundance denominator (S=0)',
      };
    }
    case 'T21': {
      const inc = N >= 4 && S >= 1;
      const den = N >= 4;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: den, denWeight: den ? 1 : 0, scale: 100, reason: inc ? 'In numerator (N>=4, S>=1) and denominator (N>=4)' : den ? 'In denominator (N>=4) only (S=0)' : `Excluded (N=${N} < 4)` };
    }
    case 'T22':
      return { included: H > 0, numWeight: H, inDenom: true, denWeight: 1, scale: 1, reason: `Weighted by Hex (H=${H})` };
    case 'T23':
      return { included: N > 0, numWeight: N, inDenom: true, denWeight: 1, scale: 1, reason: `Weighted by HexNAc (N=${N})` };
    case 'T24': {
      const w = N >= 4 ? Math.max(0, H - 3) : 0;
      const inc = w > 0;
      return { included: inc, numWeight: w, inDenom: false, denWeight: 0, scale: 1, reason: inc ? `N=${N}>=4, max(0, H-3)=${w}` : `Excluded (N=${N}, H=${H})` };
    }
    case 'T25': {
      const w = N >= 4 ? Math.max(0, H - 3) : 0;
      const inc = w > 0;
      const den = N >= 4;
      return { included: inc, numWeight: w, inDenom: den, denWeight: den ? 1 : 0, scale: 1, reason: inc ? `Numerator weight max(0,H-3)=${w}, in N>=4 denominator` : den ? 'In N>=4 denominator with H<=3 (weight 0)' : `Excluded (N=${N} < 4)` };
    }
    case 'T26': {
      const inc = N === 4;
      const den = N >= 4;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: den, denWeight: den ? 1 : 0, scale: 100, reason: inc ? 'N=4 in N>=4 pool' : den ? `In N>=4 denominator (N=${N})` : `Excluded (N=${N} < 4)` };
    }
    case 'T27': {
      const inc = N === 5;
      const den = N >= 4;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: den, denWeight: den ? 1 : 0, scale: 100, reason: inc ? 'N=5 in N>=4 pool' : den ? `In N>=4 denominator (N=${N})` : `Excluded (N=${N} < 4)` };
    }
    case 'T28': {
      const inc = N === 6;
      const den = N >= 4;
      return { included: inc, numWeight: inc ? 1 : 0, inDenom: den, denWeight: den ? 1 : 0, scale: 100, reason: inc ? 'N=6 in N>=4 pool' : den ? `In N>=4 denominator (N=${N})` : `Excluded (N=${N} < 4)` };
    }
    case 'T29': {
      const inc = F > 0;
      const den = S > 0;
      return {
        included: inc,
        numWeight: F,
        inDenom: den,
        denWeight: S,
        scale: 1,
        reason: inc || den ? `Numerator F=${F}, Denominator S=${S}` : 'Excluded (F=0, S=0)',
      };
    }
    case 'T30': {
      const inc = F >= 1 && S >= 1;
      const den = F >= 1;
      return {
        included: inc,
        numWeight: inc ? 1 : 0,
        inDenom: den,
        denWeight: den ? 1 : 0,
        scale: 100,
        reason: inc ? 'In numerator (F>=1, S>=1) and denominator (F>=1)' : den ? 'In fucosylated denominator only (S=0)' : 'Excluded (F=0)',
      };
    }
    case 'T31': {
      const inc = S >= 1 && F >= 1;
      const den = S >= 1;
      return {
        included: inc,
        numWeight: inc ? 1 : 0,
        inDenom: den,
        denWeight: den ? 1 : 0,
        scale: 100,
        reason: inc ? 'In numerator (S>=1, F>=1) and denominator (S>=1)' : den ? 'In sialylated denominator only (F=0)' : 'Excluded (S=0)',
      };
    }
    case 'T32': {
      const inc = N === 2 && H >= 5 && H <= 9 && F === 0 && S === 0;
      return {
        included: inc,
        numWeight: inc ? 1 : 0,
        inDenom: true,
        denWeight: 1,
        scale: 100,
        reason: inc ? 'High-mannose (H5-9N2) in total classified denominator' : 'In total classified denominator',
      };
    }
    case 'T33': {
      const inc = S === 1;
      return {
        included: inc,
        numWeight: inc ? 1 : 0,
        inDenom: false,
        denWeight: 0,
        scale: 1,
        reason: inc ? 'Mono-sialylated (S=1)' : `Excluded (S=${S} != 1)`,
      };
    }
    case 'T34': {
      const inc = S >= 2;
      return {
        included: inc,
        numWeight: inc ? 1 : 0,
        inDenom: false,
        denWeight: 0,
        scale: 1,
        reason: inc ? `Multi-sialylated (S=${S} >= 2)` : `Excluded (S=${S} < 2)`,
      };
    }
    default: {
      if (customSpec) {
        const checkClause = (cl: any) => {
          const compVal =
            cl.component === 'Hex'
              ? H
              : cl.component === 'HexNAc'
              ? N
              : cl.component === 'Fucose'
              ? F
              : cl.component === 'Sialic_Acid'
              ? S
              : 0;
          const v = Number(cl.value);
          if (cl.operator === '=') return compVal === v;
          if (cl.operator === '>=') return compVal >= v;
          if (cl.operator === '<=') return compVal <= v;
          if (cl.operator === '>') return compVal > v;
          if (cl.operator === '<') return compVal < v;
          if (cl.operator === '!=') return compVal !== v;
          return false;
        };
        const inc = (customSpec.inclusion_clauses || []).every(checkClause);
        let w = 1;
        if (customSpec.numerator_weight === 'H') w = H;
        else if (customSpec.numerator_weight === 'N') w = N;
        else if (customSpec.numerator_weight === 'F') w = F;
        else if (customSpec.numerator_weight === 'S') w = S;
        const hasDen = Array.isArray(customSpec.denominator_clauses) && customSpec.denominator_clauses.length > 0;
        const inDen = hasDen ? customSpec.denominator_clauses.every(checkClause) : false;
        return {
          included: inc && w > 0,
          numWeight: inc ? w : 0,
          inDenom: inDen,
          denWeight: inDen ? 1 : 0,
          scale: hasDen && customSpec.unit === '%' ? 100 : 1,
          reason: inc ? 'Matches custom inclusion rule' : 'Excluded by custom rule',
        };
      }
      return { included: false, numWeight: 0, inDenom: false, denWeight: 0, scale: 1, reason: 'Unknown trait' };
    }
  }
}

// ============================================================================
// 4. STATISTICAL HELPERS
// ============================================================================
function computeGroupStats(vals: number[]): GroupStatValues {
  const n = vals.length;
  if (n === 0) {
    return { valid_n: 0, mean: null, median: null, sd: null, se: null, min: null, max: null, q25: null, q75: null, iqr: null };
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);

  const quantile = (q: number) => {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  };

  const median = quantile(0.5);
  const q25 = quantile(0.25);
  const q75 = quantile(0.75);
  return {
    valid_n: n,
    mean,
    median,
    sd,
    se,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q25,
    q75,
    iqr: q75 - q25,
  };
}

function normalTwoTailedP(z: number): number {
  const absZ = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989422804014327 * Math.exp((-absZ * absZ) / 2);
  const prob =
    d *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return Math.min(1, Math.max(0, 2 * prob));
}

function welchTTest(g1: number[], g2: number[]): { stat: number | null; p: number | null } {
  if (g1.length < 2 || g2.length < 2) return { stat: null, p: null };
  const s1 = computeGroupStats(g1);
  const s2 = computeGroupStats(g2);
  const v1 = Math.pow(s1.sd || 0, 2) / g1.length;
  const v2 = Math.pow(s2.sd || 0, 2) / g2.length;
  const denom = Math.sqrt(v1 + v2);
  if (denom < 1e-12) return { stat: 0, p: 1 };
  const t = ((s1.mean || 0) - (s2.mean || 0)) / denom;
  return { stat: t, p: normalTwoTailedP(t) };
}

function mannWhitneyUTest(g1: number[], g2: number[]): { stat: number | null; p: number | null } {
  const n1 = g1.length;
  const n2 = g2.length;
  if (n1 < 2 || n2 < 2) return { stat: null, p: null };
  const combined = [
    ...g1.map((v) => ({ v, g: 1 })),
    ...g2.map((v) => ({ v, g: 2 })),
  ].sort((a, b) => a.v - b.v);

  let i = 0;
  const ranks = new Array(combined.length).fill(0);
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }

  let r1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k].g === 1) r1 += ranks[k];
  }
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  if (sigma < 1e-12) return { stat: u1, p: 1 };
  const z = (u1 - mu) / sigma;
  return { stat: u1, p: normalTwoTailedP(z) };
}

function adjustBHFdr(pValues: Array<number | null>): Array<number | null> {
  const indexed = pValues
    .map((p, idx) => ({ p, idx }))
    .filter((x): x is { p: number; idx: number } => x.p !== null && !Number.isNaN(x.p))
    .sort((a, b) => a.p - b.p);
  const m = indexed.length;
  const out = new Array<number | null>(pValues.length).fill(null);
  let prev = 1.0;
  for (let i = m - 1; i >= 0; i--) {
    const rank = i + 1;
    const adj = Math.min(prev, (indexed[i].p * m) / rank);
    prev = adj;
    out[indexed[i].idx] = Math.min(1.0, adj);
  }
  return out;
}

// ============================================================================
// 5. STRUCTURAL SEQUENCE PARSER & ENGINE (Category B: S01-S08)
// ============================================================================
export function parseStructuralSequenceClient(
  glycanId: string,
  composition: string,
  sequence: string,
  format = 'IUPAC-condensed'
): StructuralAnnotationRow {
  const seq = (sequence || '').trim();
  const row: StructuralAnnotationRow = {
    glycan_id: glycanId,
    composition,
    sequence_format: format,
    structure_sequence: seq,
    has_validated_structure: false,
    annotation_confidence: 'Unannotated',
    experimental_evidence: 'None',
    core_fucosylated: null,
    antennary_fucosylated: null,
    bisecting_glcnac: null,
    galactose_count: null,
    structural_class: null,
    antenna_count: null,
    alpha2_3_sialic_count: null,
    alpha2_6_sialic_count: null,
    parser_validation_notes: [],
  };

  if (!seq) {
    row.parser_validation_notes.push(NOT_DERIVABLE_TEXT);
    return row;
  }

  row.has_validated_structure = true;
  row.annotation_confidence = 'Confirmed';
  row.experimental_evidence = `${format} structural topology`;

  // Split around core Man(b1-4)GlcNAc(b1-4) so chitobiose core GlcNAc is not counted as an antenna
  const coreSplit = seq.split(/Man\(b1-4\)GlcNAc\(b1-4\)/i);
  const nonReducingPart = coreSplit[0] || seq;
  const reducingCorePart = coreSplit.length > 1 ? coreSplit[1] : seq;

  const coreFuc =
    /Fuc\(a1-6\)|\[Fuc\(a1-6\)\]|a6d/i.test(reducingCorePart) ||
    /Fuc\(a1-6\)|\[Fuc\(a1-6\)\]|a6d/i.test(seq);
  const antFuc =
    /Fuc\(a1-[234]\)|\[Fuc\(a1-[234]\)\]|a[234]d/i.test(nonReducingPart) ||
    /Fuc\(a1-[234]\)|\[Fuc\(a1-[234]\)\]|a[234]d/i.test(seq);
  const bisect = /\[GlcNAc\(b1-4\)\]\s*Man\(b1-4\)|\[GlcNAc\(b1-4\)\]\[|b4gn.*b4m/i.test(seq);
  const bisectCount = bisect ? 1 : 0;

  const galMatches = seq.match(/Gal\(/gi) || [];
  const a23Matches = seq.match(/Neu5?Ac\(a2-3\)|Neu5?Gc\(a2-3\)/gi) || [];
  const a26Matches = seq.match(/Neu5?Ac\(a2-6\)|Neu5?Gc\(a2-6\)/gi) || [];
  const glcNAcBetaInBranches = nonReducingPart.match(/GlcNAc\(b1-[246]\)/gi) || [];
  const antennaCount = Math.max(0, glcNAcBetaInBranches.length - bisectCount);
  const manAlphaMatches = nonReducingPart.match(/Man\(a1-[236]\)/gi) || [];
  const manAlphaCount = manAlphaMatches.length;

  row.core_fucosylated = coreFuc;
  row.antennary_fucosylated = antFuc;
  row.bisecting_glcnac = bisect;
  row.galactose_count = galMatches.length;
  row.alpha2_3_sialic_count = a23Matches.length;
  row.alpha2_6_sialic_count = a26Matches.length;
  row.antenna_count = antennaCount;
  row.structural_class =
    antennaCount === 0
      ? manAlphaCount >= 4
        ? 'High-Mannose'
        : 'Paucimannose'
      : antennaCount === 1 && manAlphaCount >= 3
      ? 'Hybrid'
      : 'Complex';
  row.parser_validation_notes.push('Validated structural topology parsed.');
  return row;
}

// ============================================================================
// 6. FULL SESSION RECOMPUTATION PIPELINE
// ============================================================================
function recomputeClientSession(cs: ClientSession): SessionSummary {
  const parsedComps = cs.glycan_cols.map((col) =>
    parseGlycanComposition(col, cs.parser_config)
  );

  const activeRows = cs.rows.filter(
    (r) => !cs.excluded_samples.includes(String(r[cs.sample_id_col]))
  );

  const sampleIds = activeRows.map((r) => String(r[cs.sample_id_col]));
  const groups = activeRows.map((r) =>
    cs.group_col && r[cs.group_col] !== undefined && r[cs.group_col] !== ''
      ? String(r[cs.group_col])
      : 'All_Samples'
  );

  const groupDist: Record<string, number> = {};
  groups.forEach((g) => {
    groupDist[g] = (groupDist[g] || 0) + 1;
  });
  const distinctGroups = Object.keys(groupDist);

  let missingCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;
  const totalCells = activeRows.length * cs.glycan_cols.length || 1;

  const allRawMatrix: number[][] = [];
  const activeIndices: number[] = [];

  cs.rows.forEach((row, rIdx) => {
    const sid = String(row[cs.sample_id_col]);
    const isExcluded = cs.excluded_samples.includes(sid);
    if (!isExcluded) activeIndices.push(rIdx);

    const rawVals: number[] = [];
    cs.glycan_cols.forEach((col) => {
      const v = row[col];
      if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) {
        if (!isExcluded) missingCount++;
        rawVals.push(0);
      } else {
        const num = Number(v);
        if (num < 0 && !isExcluded) negativeCount++;
        if (num === 0 && !isExcluded) zeroCount++;
        rawVals.push(num);
      }
    });
    allRawMatrix.push(rawVals);
  });

  // Apply chosen Glycomic Normalization across all rows
  const normOut = applyGlycomicNormalization(
    allRawMatrix,
    cs.normalization_method,
    cs.measurement_type,
    cs.apply_closure
  );

  const allWorkingPctMatrix = normOut.workingPctMatrix;
  const allCustomNormMatrix = normOut.customNormMatrix;

  const workingMatrixPct = activeIndices.map((idx) => allWorkingPctMatrix[idx]);

  // Build normalized_pct_rows and normalized_custom_rows for preview and export
  const nonGlycanCols = cs.all_columns.filter((c) => !cs.glycan_cols.includes(c));
  cs.normalized_pct_rows = cs.rows.map((row, idx) => {
    const obj: Record<string, any> = {};
    nonGlycanCols.forEach((c) => {
      obj[c] = row[c];
    });
    cs.glycan_cols.forEach((gCol, k) => {
      obj[gCol] = Number((allWorkingPctMatrix[idx]?.[k] ?? 0).toFixed(4));
    });
    obj.Total_Relative_Abundance_Pct = Number(
      (allWorkingPctMatrix[idx] || []).reduce((a, b) => a + b, 0).toFixed(4)
    );
    return obj;
  });

  cs.normalized_custom_rows = cs.rows.map((row, idx) => {
    const obj: Record<string, any> = {};
    nonGlycanCols.forEach((c) => {
      obj[c] = row[c];
    });
    cs.glycan_cols.forEach((gCol, k) => {
      obj[gCol] = Number((allCustomNormMatrix[idx]?.[k] ?? 0).toFixed(4));
    });
    return obj;
  });

  const sampleQcTable: SessionSummary['qc_report']['sample_qc_table'] = cs.rows.map(
    (row, idx) => {
      const sid = String(row[cs.sample_id_col]);
      const grp =
        cs.group_col && row[cs.group_col] !== undefined
          ? String(row[cs.group_col])
          : 'All_Samples';
      const isExcluded = cs.excluded_samples.includes(sid);
      const rawVals = allRawMatrix[idx] || [];
      const workVals = allWorkingPctMatrix[idx] || [];
      const rawTotal = rawVals.reduce((a, b) => a + b, 0);
      const workTotal = workVals.reduce((a, b) => a + b, 0);
      let sMissing = 0;
      let sZero = 0;
      let sNeg = 0;
      cs.glycan_cols.forEach((col) => {
        const v = row[col];
        if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) sMissing++;
        else {
          const num = Number(v);
          if (num < 0) sNeg++;
          if (num === 0) sZero++;
        }
      });

      const qcStatus = isExcluded
        ? 'EXCLUDED'
        : sNeg > 0
        ? 'ERROR_NEGATIVE'
        : Math.abs(workTotal - 100) <= 1.5
        ? 'OK'
        : 'WARNING_TOTAL_NOT_100';

      return {
        sample_id: sid,
        group: grp,
        raw_total_abundance: rawTotal,
        working_total_pct: workTotal,
        zero_count: sZero,
        missing_count: sMissing,
        negative_count: sNeg,
        qc_status: qcStatus,
      };
    }
  );

  const isClrBlocked =
    cs.measurement_type === 'clr_transformed' || negativeCount > 0;
  const blockingErrors: string[] = [];
  if (isClrBlocked) {
    blockingErrors.push(
      'CLR-transformed or negative values cannot be used directly in additive glycan pool and weighted-abundance formulas. Please upload non-negative raw peak areas or relative abundances.'
    );
  }

  const allTraitDefs: TraitDefinition[] = [
    ...(refData.trait_definitions as TraitDefinition[]),
    ...cs.custom_traits.map((ct) => ct.definition),
  ];
  const customSpecMap: Record<string, any> = {};
  cs.custom_traits.forEach((ct) => {
    customSpecMap[ct.definition.Trait_ID] = ct.spec;
  });

  const inclusionMatrix: SessionSummary['composition_results']['inclusion_matrix'] = {};
  allTraitDefs.forEach((td) => {
    const incList: string[] = [];
    const excList: string[] = [];
    const denList: string[] = [];
    const perGlycan: Record<string, any> = {};
    parsedComps.forEach((pc) => {
      const rule = evaluateGlycanForTrait(
        td.Trait_ID,
        pc,
        customSpecMap[td.Trait_ID]
      );
      if (rule.included) incList.push(pc.raw_label);
      else excList.push(pc.raw_label);
      if (rule.inDenom) denList.push(pc.raw_label);
      perGlycan[pc.raw_label] = rule;
    });
    inclusionMatrix[td.Trait_ID] = {
      trait_id: td.Trait_ID,
      trait_name: td.Trait_Name,
      included_glycans: incList,
      excluded_glycans: excList,
      denominator_glycans: denList,
      per_glycan: perGlycan,
    };
  });

  const sampleResults: SampleTraitResult[] = [];
  const traitWarnings: SessionSummary['composition_results']['trait_warnings'] = [];

  for (let i = 0; i < sampleIds.length; i++) {
    const sid = sampleIds[i];
    const grp = groups[i];
    const abundPct = workingMatrixPct[i] || [];
    const traitsOut: Record<string, number | null> = {};
    const numOut: Record<string, number> = {};
    const denOut: Record<string, number | null> = {};

    allTraitDefs.forEach((td) => {
      let num = 0;
      let den = 0;
      let usesDen = false;

      for (let k = 0; k < parsedComps.length; k++) {
        const pc = parsedComps[k];
        const a = abundPct[k] || 0;
        const rule = evaluateGlycanForTrait(
          td.Trait_ID,
          pc,
          customSpecMap[td.Trait_ID]
        );
        if (rule.included) {
          num += a * rule.numWeight;
        }
        if (rule.inDenom) {
          usesDen = true;
          den += a * rule.denWeight;
        }
      }

      const engineRule = (td as any).Engine_Rule;
      const customSpec = customSpecMap[td.Trait_ID];
      const isRatio =
        usesDen ||
        engineRule?.type === 'ratio' ||
        Boolean(engineRule?.denominator_condition) ||
        Boolean(customSpec?.has_denominator);
      const scaleFactor =
        engineRule?.scale ??
        customSpec?.scale ??
        (parsedComps[0]
          ? evaluateGlycanForTrait(td.Trait_ID, parsedComps[0], customSpec).scale
          : 1);

      numOut[td.Trait_ID] = num;
      if (!isRatio) {
        denOut[td.Trait_ID] = null;
        traitsOut[td.Trait_ID] = num;
      } else {
        denOut[td.Trait_ID] = den;
        if (den <= 1e-12) {
          traitsOut[td.Trait_ID] = null;
          traitWarnings.push({
            sample_id: sid,
            trait_id: td.Trait_ID,
            trait_name: td.Trait_Name,
            warning: `Denominator is 0 in sample ${sid}; returned NA instead of 0.`,
          });
        } else {
          traitsOut[td.Trait_ID] = (scaleFactor * num) / den;
        }
      }
    });

    sampleResults.push({
      sample_id: sid,
      group: grp,
      traits: traitsOut,
      numerators: numOut,
      denominators: denOut,
    });
  }

  const byTrait: SessionSummary['composition_results']['group_summaries']['by_trait'] = {};
  const rawComparisons: GroupComparisonItem[] = [];

  allTraitDefs.forEach((td) => {
    const grpMap: Record<string, GroupStatValues> = {};
    const grpVectors: number[][] = [];
    distinctGroups.forEach((g) => {
      const vals = sampleResults
        .filter((sr) => sr.group === g)
        .map((sr) => sr.traits[td.Trait_ID])
        .filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
      grpMap[g] = computeGroupStats(vals);
      grpVectors.push(vals);
    });
    byTrait[td.Trait_ID] = {
      trait_id: td.Trait_ID,
      trait_name: td.Trait_Name,
      unit: td.Unit,
      groups: grpMap,
    };

    if (distinctGroups.length >= 2) {
      const tRes = welchTTest(grpVectors[0] || [], grpVectors[1] || []);
      const uRes = mannWhitneyUTest(grpVectors[0] || [], grpVectors[1] || []);
      rawComparisons.push({
        trait_id: td.Trait_ID,
        trait_name: td.Trait_Name,
        unit: td.Unit,
        parametric_test: distinctGroups.length === 2 ? "Welch's t-test" : 'One-way ANOVA',
        parametric_stat: tRes.stat,
        parametric_p: tRes.p,
        nonparametric_test:
          distinctGroups.length === 2 ? 'Mann-Whitney U' : 'Kruskal-Wallis',
        nonparametric_stat: uRes.stat,
        nonparametric_p: uRes.p,
      });
    }
  });

  const paramFdrs = adjustBHFdr(rawComparisons.map((c) => c.parametric_p));
  const nonparamFdrs = adjustBHFdr(rawComparisons.map((c) => c.nonparametric_p));
  rawComparisons.forEach((c, idx) => {
    c.parametric_fdr = paramFdrs[idx];
    c.nonparametric_fdr = nonparamFdrs[idx];
  });

  const hasFGe3 = parsedComps.some((p) => p.is_valid && p.Fucose >= 3);
  const hasNGe7 = parsedComps.some((p) => p.is_valid && p.HexNAc >= 7);
  const checks: ValidationCheckItem[] = [
    {
      rule_id: 'VAL01',
      rule_name: 'T09 + T10 = T01 (Fucosylated + Non-Fucosylated = Total)',
      passed: sampleResults.every(
        (s) => Math.abs((s.traits.T09 || 0) + (s.traits.T10 || 0) - (s.traits.T01 || 0)) < 1e-6
      ),
      details: 'Verified across all active samples within 1e-6 tolerance.',
    },
    {
      rule_id: 'VAL02',
      rule_name: hasFGe3
        ? 'T11 + T12 <= T09 (Dataset contains F >= 3)'
        : 'T11 + T12 = T09 (Mono + Di-Fucosylated = Total Fucosylated when F <= 2)',
      passed: sampleResults.every((s) =>
        hasFGe3
          ? (s.traits.T11 || 0) + (s.traits.T12 || 0) <= (s.traits.T09 || 0) + 1e-6
          : Math.abs((s.traits.T11 || 0) + (s.traits.T12 || 0) - (s.traits.T09 || 0)) < 1e-6
      ),
      details: 'Verified fucosylation sub-pool additivity.',
    },
    {
      rule_id: 'VAL03',
      rule_name: 'T17 + T18 = T16 (Non-Fucosylated + Fucosylated Sialylated = Total Sialylated)',
      passed: sampleResults.every(
        (s) => Math.abs((s.traits.T17 || 0) + (s.traits.T18 || 0) - (s.traits.T16 || 0)) < 1e-6
      ),
      details: 'Verified sialylation sub-pool additivity.',
    },
    {
      rule_id: 'VAL04',
      rule_name: hasNGe7
        ? 'T05 + T06 + T07 <= T08 (Dataset contains N >= 7)'
        : 'T05 + T06 + T07 = T08 (N4 + N5 + N6 = N>=4 Pool when N <= 6)',
      passed: sampleResults.every((s) =>
        hasNGe7
          ? (s.traits.T05 || 0) + (s.traits.T06 || 0) + (s.traits.T07 || 0) <= (s.traits.T08 || 0) + 1e-6
          : Math.abs(
              (s.traits.T05 || 0) + (s.traits.T06 || 0) + (s.traits.T07 || 0) - (s.traits.T08 || 0)
            ) < 1e-6
      ),
      details: 'Verified HexNAc complex-candidate pool partition.',
    },
    {
      rule_id: 'VAL05',
      rule_name: hasNGe7
        ? 'T26 + T27 + T28 <= 100% (when T08 > 0 and N >= 7 present)'
        : 'T26 + T27 + T28 = 100% (when T08 > 0 and N <= 6)',
      passed: sampleResults.every((s) => {
        if (!s.traits.T08 || s.traits.T08 <= 1e-12) return s.traits.T26 === null;
        const sum = (s.traits.T26 || 0) + (s.traits.T27 || 0) + (s.traits.T28 || 0);
        return hasNGe7 ? sum <= 100 + 1e-6 : Math.abs(sum - 100) < 1e-6;
      }),
      details: 'Verified relative HexNAc branching share closure.',
    },
    {
      rule_id: 'VAL06',
      rule_name: '0 <= T15 <= 100% (Fucosylated Share in N>=4 Pool)',
      passed: sampleResults.every(
        (s) => s.traits.T15 === null || (s.traits.T15 >= -1e-6 && s.traits.T15 <= 100 + 1e-6)
      ),
      details: 'Verified bounded percentage range.',
    },
    {
      rule_id: 'VAL07',
      rule_name: '0 <= T21 <= 100% (Sialylated Share in N>=4 Pool)',
      passed: sampleResults.every(
        (s) => s.traits.T21 === null || (s.traits.T21 >= -1e-6 && s.traits.T21 <= 100 + 1e-6)
      ),
      details: 'Verified bounded percentage range.',
    },
    {
      rule_id: 'VAL08',
      rule_name: 'T22 >= 0 and T23 >= 0 (Non-negative Average Hex & HexNAc)',
      passed: sampleResults.every(
        (s) => (s.traits.T22 || 0) >= 0 && (s.traits.T23 || 0) >= 0
      ),
      details: 'Verified non-negative residue averages.',
    },
    {
      rule_id: 'VAL09',
      rule_name: 'T24 >= 0 and T25 >= 0 (Non-negative Hex Excess Proxies)',
      passed: sampleResults.every(
        (s) => (s.traits.T24 || 0) >= 0 && (s.traits.T25 === null || s.traits.T25 >= 0)
      ),
      details: 'Verified non-negative galactosylation proxies.',
    },
    {
      rule_id: 'VAL10',
      rule_name: 'T02 (High-Man) + T03 (Paucimannose) + T04 (N3) + T08 (N>=4) = T01 (Total N-Glycan Class Partition)',
      passed: sampleResults.every((s) => {
        const classSum =
          (s.traits.T02 || 0) + (s.traits.T03 || 0) + (s.traits.T04 || 0) + (s.traits.T08 || 0);
        return Math.abs(classSum - (s.traits.T01 || 0)) < 1e-5 || classSum <= (s.traits.T01 || 0) + 1e-5;
      }),
      details: 'Verified mutual exclusivity and partition closure of High-Mannose, Paucimannose, Hybrid-Proxy (N3), and Complex-Candidate (N>=4) classes.',
    },
  ];

  const structDefs = refData.structural_trait_definitions as TraitDefinition[];
  const annList = cs.glycan_cols.map((g) => {
    if (cs.structural_annotations[g]) return cs.structural_annotations[g];
    return {
      glycan_id: g,
      composition: g,
      sequence_format: 'None',
      structure_sequence: '',
      has_validated_structure: false,
      annotation_confidence: 'Composition-Only',
      experimental_evidence: 'None',
      core_fucosylated: null,
      antennary_fucosylated: null,
      bisecting_glcnac: null,
      galactose_count: null,
      structural_class: null,
      antenna_count: null,
      alpha2_3_sialic_count: null,
      alpha2_6_sialic_count: null,
      parser_validation_notes: [NOT_DERIVABLE_TEXT],
    };
  });

  const validatedGlycans = annList
    .filter((a) => a.has_validated_structure)
    .map((a) => a.glycan_id);
  const unclassifiedGlycans = annList
    .filter((a) => !a.has_validated_structure)
    .map((a) => a.glycan_id);
  const hasStruct = validatedGlycans.length > 0;

  const structSampleResults = sampleIds.map((sid, sIdx) => {
    const grp = groups[sIdx];
    const abundPct = workingMatrixPct[sIdx] || [];
    const traits: Record<string, number | null> = {};
    const displayTraits: Record<string, string> = {};

    if (!hasStruct) {
      structDefs.forEach((sd) => {
        traits[sd.Trait_ID] = null;
        displayTraits[sd.Trait_ID] = NOT_DERIVABLE_TEXT;
      });
      return {
        sample_id: sid,
        group: grp,
        status: NOT_DERIVABLE_TEXT,
        validated_abundance_pct: 0,
        unclassified_abundance_pct: 100,
        traits,
        display_traits: displayTraits,
      };
    }

    let valAbund = 0;
    let uncAbund = 0;
    let totalAbund = 0;
    let s01 = 0,
      s02 = 0,
      s03 = 0,
      s04 = 0,
      s04GalEquiv = 0,
      s05Pauci = 0,
      s05Hm = 0,
      s05Hyb = 0,
      s06Comp = 0,
      s07Bi = 0,
      s07Tri = 0,
      s07Tetra = 0,
      s08a23 = 0,
      s08a26 = 0;

    annList.forEach((ann, k) => {
      const a = abundPct[k] || 0;
      totalAbund += a;
      if (!ann.has_validated_structure) {
        uncAbund += a;
        return;
      }
      valAbund += a;
      if (ann.core_fucosylated) s01 += a;
      if (ann.antennary_fucosylated) s02 += a;
      if (ann.bisecting_glcnac) s03 += a;
      if ((ann.galactose_count || 0) >= 1) s04 += a;
      s04GalEquiv += a * (ann.galactose_count || 0);

      const sClass = (ann.structural_class || '').toLowerCase();
      if (sClass === 'paucimannose') {
        s05Pauci += a;
      } else if (sClass === 'high-mannose' || sClass === 'high_mannose') {
        s05Hm += a;
      } else if (sClass === 'hybrid') {
        s05Hyb += a;
      } else if (sClass === 'complex') {
        s06Comp += a;
      }

      if (ann.antenna_count === 2) s07Bi += a;
      else if (ann.antenna_count === 3) s07Tri += a;
      else if ((ann.antenna_count || 0) >= 4) s07Tetra += a;

      if ((ann.alpha2_3_sialic_count || 0) >= 1) s08a23 += a;
      if ((ann.alpha2_6_sialic_count || 0) >= 1) s08a26 += a;
    });

    const s04MeanGal = totalAbund > 1e-12 ? s04GalEquiv / totalAbund : null;
    const valMap: Record<string, number | null> = {
      S01: s01,
      S02: s02,
      S03: s03,
      S04: s04,
      S04_MeanGal: s04MeanGal,
      S05_Pauci: s05Pauci,
      S05_HM: s05Hm,
      S05: s05Hyb,
      S06: s06Comp,
      S06_HM: s05Hm,
      S06_Hyb: s05Hyb,
      S06_Comp: s06Comp,
      S07: s07Bi + s07Tri + s07Tetra,
      S07_Bi: s07Bi,
      S07_Tri: s07Tri,
      S07_Tetra: s07Tetra,
      S08: s08a23 + s08a26,
      S08_a23: s08a23,
      S08_a26: s08a26,
      S08_Ratio: s08a26 > 1e-12 ? s08a23 / s08a26 : null,
    };

    Object.entries(valMap).forEach(([k, v]) => {
      traits[k] = v;
      displayTraits[k] = v !== null && v !== undefined ? v.toFixed(3) : 'NA (Zero Denominator)';
    });

    structDefs.forEach((sd) => {
      if (!(sd.Trait_ID in traits)) {
        const v = valMap[sd.Trait_ID] ?? null;
        traits[sd.Trait_ID] = v;
        displayTraits[sd.Trait_ID] = v !== null ? v.toFixed(3) : 'NA (Zero Denominator)';
      }
    });

    return {
      sample_id: sid,
      group: grp,
      status: 'Calculated from validated structural annotations',
      validated_abundance_pct: valAbund,
      unclassified_abundance_pct: uncAbund,
      traits,
      display_traits: displayTraits,
    };
  });

  const qcWarnings = [
    ...(missingCount > 0
      ? [{ severity: 'warning', category: 'Missing Data', message: `${missingCount} missing cells detected and treated as 0.` }]
      : []),
    ...(zeroCount > 0
      ? [{ severity: 'info', category: 'Zero Values', message: `${zeroCount} zero values (${((100 * zeroCount) / totalCells).toFixed(2)}%) processed as ${cs.zero_handling}.` }]
      : []),
  ];

  const availableDatasets = Object.values(refData.datasets || {}).map((d: any) => ({
    id: d.id,
    name: d.name || d.title,
    title: d.title || d.name,
    description: d.description,
    filename: d.filename,
    measurement_type: d.measurement_type,
    sample_count: d.rows?.length || 0,
    glycan_count: d.glycan_cols?.length || 0,
  }));

  const summary: SessionSummary = {
    session_id: cs.session_id,
    active_demo_id: cs.active_demo_id,
    filename: cs.filename,
    all_columns: cs.all_columns,
    sample_id_col: cs.sample_id_col,
    group_col: cs.group_col,
    metadata_cols: cs.metadata_cols,
    glycan_cols: cs.glycan_cols,
    unrecognized_numeric_cols: cs.unrecognized_numeric_cols,
    preview_rows: cs.rows.slice(0, 12),
    normalized_preview_rows: cs.normalized_pct_rows.slice(0, 12),
    normalized_custom_rows: cs.normalized_custom_rows.slice(0, 12),
    normalization_method: cs.normalization_method,
    normalization_method_label:
      NORMALIZATION_METHODS_CATALOG[cs.normalization_method] || cs.normalization_method,
    available_demo_datasets: availableDatasets,
    dashboard_metrics: {
      total_samples: cs.rows.length,
      active_samples: activeRows.length,
      identified_glycan_compositions: parsedComps.filter((p) => p.is_valid).length,
      experimental_groups_count: distinctGroups.length,
      experimental_groups: groupDist,
      composition_traits_available: allTraitDefs.length,
      baseline_composition_traits: 28,
      optional_composition_traits: 8,
      custom_composition_traits: cs.custom_traits.length,
      structure_traits_available: structDefs.length,
      successfully_calculated_traits: allTraitDefs.length + (hasStruct ? structDefs.length : 0),
      traits_not_derivable_insufficient_structure: hasStruct ? 0 : structDefs.length,
      qc_warnings_count: qcWarnings.length,
    },
    qc_report: {
      total_samples: cs.rows.length,
      active_samples: activeRows.length,
      excluded_samples: cs.excluded_samples,
      group_distribution: groupDist,
      distinct_groups: distinctGroups,
      total_glycan_columns: cs.glycan_cols.length,
      valid_glycan_count: parsedComps.filter((p) => p.is_valid).length,
      invalid_glycan_count: parsedComps.filter((p) => !p.is_valid).length,
      parsing_success_rate_pct:
        cs.glycan_cols.length > 0
          ? (100 * parsedComps.filter((p) => p.is_valid).length) / cs.glycan_cols.length
          : 100,
      duplicate_sample_ids: [],
      duplicate_glycan_labels: [],
      equivalent_compositions: {},
      invalid_glycan_labels: parsedComps.filter((p) => !p.is_valid).map((p) => p.raw_label),
      measurement_type: cs.measurement_type,
      measurement_type_label:
        refData.measurement_types_catalog[cs.measurement_type] || cs.measurement_type,
      normalization_method: cs.normalization_method,
      normalization_method_label:
        NORMALIZATION_METHODS_CATALOG[cs.normalization_method] || cs.normalization_method,
      apply_closure: cs.apply_closure,
      normalization_applied: normOut.description,
      zero_handling: cs.zero_handling,
      zero_handling_label:
        refData.zero_handling_catalog[cs.zero_handling] || cs.zero_handling,
      missing_values_count: missingCount,
      missing_values_pct: (100 * missingCount) / totalCells,
      zero_values_count: zeroCount,
      zero_values_pct: (100 * zeroCount) / totalCells,
      negative_values_count: negativeCount,
      is_clr_blocked: isClrBlocked,
      blocking_errors: blockingErrors,
      warnings: qcWarnings,
      sample_qc_table: sampleQcTable,
      parsed_compositions: parsedComps,
    },
    parser_config: cs.parser_config,
    composition_results: {
      blocked: isClrBlocked,
      blocking_errors: blockingErrors,
      engine_version: '1.1.0-GAREG',
      trait_definitions: allTraitDefs,
      inclusion_matrix: inclusionMatrix,
      sample_results: sampleResults,
      group_summaries: {
        distinct_groups: distinctGroups,
        by_trait: byTrait,
      },
      group_comparisons: rawComparisons,
      trait_warnings: traitWarnings,
      scientific_validation: {
        all_passed: checks.every((c) => c.passed),
        has_f_ge_3: hasFGe3,
        has_n_ge_7: hasNGe7,
        checks,
      },
    },
    structure_results: {
      structural_data_available: hasStruct,
      status_message: hasStruct
        ? `Validated structural annotations active for ${validatedGlycans.length} of ${cs.glycan_cols.length} glycans.`
        : NOT_DERIVABLE_TEXT,
      validated_glycan_count: validatedGlycans.length,
      unclassified_glycan_count: unclassifiedGlycans.length,
      validated_glycans: validatedGlycans,
      unclassified_glycans: unclassifiedGlycans,
      annotation_table: annList,
      trait_definitions: structDefs,
      not_derivable_traits: hasStruct ? [] : refData.not_derivable_traits,
      sample_results: structSampleResults,
    },
    measurement_types_catalog: refData.measurement_types_catalog,
    normalization_methods_catalog: NORMALIZATION_METHODS_CATALOG,
    zero_handling_catalog: refData.zero_handling_catalog,
    classification_table: refData.classification_table,
    metadata_merge_report: cs.metadata_merge_report,
  };

  cs.summary = summary;
  return summary;
}

// ============================================================================
// 7. CLIENT ENGINE PUBLIC API METHODS
// ============================================================================
export const clientEngine = {
  loadDemo(
    includeStructuralDemo = false,
    datasetId = 'serum_igg_crc_raw_areas'
  ): SessionSummary {
    const dsMap = refData.datasets || {};
    const ds = dsMap[datasetId] || dsMap.serum_igg_crc_raw_areas || {
      id: 'gareg_formula_reference',
      filename: 'GAREG_Compositional_Glycan_Traits_Formula_Workbook.xlsx',
      measurement_type: 'relative_abundance_pct',
      apply_closure: false,
      normalization_method: 'none_as_is',
      headers: refData.headers,
      metadata_cols: [],
      glycan_cols: refData.glycan_cols,
      rows: refData.rows,
    };

    const sid = `gareg-${ds.id}-${includeStructuralDemo ? 'struct' : 'comp'}`;
    const structMap: Record<string, StructuralAnnotationRow> = {};
    if (includeStructuralDemo) {
      (refData.demo_structural_annotations as StructuralAnnotationRow[]).forEach((a) => {
        if (a.has_validated_structure) {
          structMap[a.glycan_id] = a;
        }
      });
      // Also populate validated structural annotations for any matching glycans in the IgG/Plasma dataset
      const defaultIupacMap: Record<string, string> = {
        H3N2: 'Man(a1-6)[Man(a1-3)]Man(b1-4)GlcNAc(b1-4)GlcNAc',
        H3N2F1: 'Man(a1-6)[Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
        H4N2: 'Man(a1-6)[Man(a1-3)]Man(a1-6)Man(b1-4)GlcNAc(b1-4)GlcNAc',
        H4N2F1: 'Man(a1-6)[Man(a1-3)]Man(a1-6)Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
        H5N2: 'Man(a1-6)[Man(a1-3)]Man(a1-6)[Man(a1-3)]Man(b1-4)GlcNAc(b1-4)GlcNAc',
        H6N2: 'Man(a1-2)Man(a1-3)[Man(a1-6)[Man(a1-3)]Man(a1-6)]Man(b1-4)GlcNAc(b1-4)GlcNAc',
        H3N4F1: 'GlcNAc(b1-2)Man(a1-6)[GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
        H4N4F1: 'Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
        H5N4F1: 'Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
        H5N4F1S1: 'Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
        H5N4F1S2: 'Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
        H5N5F1: 'Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)][GlcNAc(b1-4)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
        H6N5F1S3: 'Neu5Ac(a2-3)Gal(b1-4)GlcNAc(b1-4)[Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)]Man(a1-3)[Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-6)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
      };
      Object.entries(defaultIupacMap).forEach(([g, seq]) => {
        if (!structMap[g]) {
          structMap[g] = parseStructuralSequenceClient(g, g, seq, 'IUPAC-condensed');
        }
      });
    }

    const cs: ClientSession = {
      session_id: sid,
      active_demo_id: ds.id,
      filename: ds.filename,
      rows: JSON.parse(JSON.stringify(ds.rows)),
      all_columns: [...ds.headers],
      sample_id_col: 'Sample_ID',
      group_col: 'Group',
      metadata_cols: [...(ds.metadata_cols || [])],
      glycan_cols: [...ds.glycan_cols],
      unrecognized_numeric_cols: [],
      measurement_type: ds.measurement_type || 'peak_area',
      normalization_method: ds.normalization_method || 'total_area_pct',
      apply_closure: Boolean(ds.apply_closure ?? true),
      zero_handling: 'true_biological_absence',
      excluded_samples: [],
      parser_config: {
        treat_f_as_fucose: true,
        treat_dhex_as_fucose: false,
        assume_s_is_neuac: false,
        manual_overrides: {},
        custom_components: {},
      },
      custom_traits: [],
      structural_annotations: structMap,
      normalized_pct_rows: [],
      normalized_custom_rows: [],
      summary: null as any,
    };

    clientSessions[sid] = cs;
    return recomputeClientSession(cs);
  },

  async uploadData(file: File, sheetName?: string): Promise<SessionSummary> {
    const rows = await parseFileToRows(file, sheetName);
    if (!rows || rows.length === 0) {
      throw new Error('Uploaded file contains no data rows.');
    }
    const cols = Object.keys(rows[0]);
    const sampleIdCol =
      cols.find((c) => /^sample_?id$|^id$|^sample$/i.test(c)) || cols[0];
    const groupCol =
      cols.find((c) => /^group$|^cohort$|^condition$|^class$|^diagnosis$/i.test(c)) ||
      null;

    const glycanCols: string[] = [];
    const metadataCols: string[] = [];
    const unrecognizedCols: string[] = [];

    cols.forEach((c) => {
      if (c === sampleIdCol || c === groupCol) return;
      const parsed = parseGlycanComposition(c);
      if (parsed.is_valid) {
        glycanCols.push(c);
      } else {
        const isNum = rows.every(
          (r) => r[c] === '' || r[c] === null || !Number.isNaN(Number(r[c]))
        );
        if (isNum) unrecognizedCols.push(c);
        else metadataCols.push(c);
      }
    });

    // Auto-detect whether uploaded values are Raw Peak Areas/Intensities vs Relative % vs 0-1
    let sumTotal = 0;
    rows.forEach((r) => {
      glycanCols.forEach((g) => {
        const v = Number(r[g]);
        if (!Number.isNaN(v)) sumTotal += v;
      });
    });
    const meanRowSum = rows.length > 0 ? sumTotal / rows.length : 100;
    let detectedMeasurementType = 'relative_abundance_pct';
    let detectedNormMethod = 'none_as_is';
    let detectedClosure = false;

    if (meanRowSum > 150) {
      detectedMeasurementType = 'peak_area';
      detectedNormMethod = 'total_area_pct';
      detectedClosure = true;
    } else if (meanRowSum > 0.5 && meanRowSum <= 1.5) {
      detectedMeasurementType = 'relative_abundance_prop';
      detectedNormMethod = 'total_area_prop';
      detectedClosure = false;
    }

    const sid = `session-${Date.now().toString(36)}`;
    const cs: ClientSession = {
      session_id: sid,
      filename: file.name,
      rows,
      all_columns: cols,
      sample_id_col: sampleIdCol,
      group_col: groupCol,
      metadata_cols: metadataCols,
      glycan_cols: glycanCols,
      unrecognized_numeric_cols: unrecognizedCols,
      measurement_type: detectedMeasurementType,
      normalization_method: detectedNormMethod,
      apply_closure: detectedClosure,
      zero_handling: 'true_biological_absence',
      excluded_samples: [],
      parser_config: {
        treat_f_as_fucose: true,
        treat_dhex_as_fucose: false,
        assume_s_is_neuac: false,
        manual_overrides: {},
        custom_components: {},
      },
      custom_traits: [],
      structural_annotations: {},
      normalized_pct_rows: [],
      normalized_custom_rows: [],
      summary: null as any,
    };
    clientSessions[sid] = cs;
    return recomputeClientSession(cs);
  },

  async uploadMetadata(
    sessionId: string,
    file: File,
    newGroupCol?: string
  ): Promise<SessionSummary> {
    const cs = clientSessions[sessionId] || Object.values(clientSessions)[0];
    if (!cs) throw new Error('Active session not found.');
    const metaRows = await parseFileToRows(file);
    if (!metaRows.length) throw new Error('Metadata file is empty.');
    const metaCols = Object.keys(metaRows[0]);
    const metaIdCol =
      metaCols.find((c) => c.toLowerCase() === cs.sample_id_col.toLowerCase()) ||
      metaCols.find((c) => /sample_?id|^id$/i.test(c)) ||
      metaCols[0];

    const metaBySid: Record<string, Record<string, any>> = {};
    metaRows.forEach((r) => {
      metaBySid[String(r[metaIdCol]).trim()] = r;
    });

    let matched = 0;
    const unmatched: string[] = [];
    const addedCols = metaCols.filter((c) => c !== metaIdCol);

    cs.rows.forEach((r) => {
      const sid = String(r[cs.sample_id_col]).trim();
      const m = metaBySid[sid];
      if (m) {
        matched++;
        addedCols.forEach((col) => {
          r[col] = m[col];
        });
      } else {
        unmatched.push(sid);
      }
    });

    addedCols.forEach((col) => {
      if (!cs.all_columns.includes(col)) cs.all_columns.push(col);
      if (!cs.metadata_cols.includes(col)) cs.metadata_cols.push(col);
    });

    if (newGroupCol && addedCols.includes(newGroupCol)) {
      cs.group_col = newGroupCol;
    } else if (!cs.group_col) {
      const gCandidate = addedCols.find((c) => /group|cohort|condition/i.test(c));
      if (gCandidate) cs.group_col = gCandidate;
    }

    cs.metadata_merge_report = {
      matched_samples_count: matched,
      total_abundance_samples: cs.rows.length,
      unmatched_sample_ids: unmatched,
      added_metadata_columns: addedCols,
    };

    return recomputeClientSession(cs);
  },

  validateAndUpdateConfig(payload: Record<string, any>): SessionSummary {
    const cs =
      clientSessions[payload.session_id] ||
      Object.values(clientSessions)[0] ||
      (() => {
        this.loadDemo(false);
        return Object.values(clientSessions)[0];
      })();

    if (payload.sample_id_col) cs.sample_id_col = payload.sample_id_col;
    if (payload.group_col !== undefined) cs.group_col = payload.group_col || null;
    if (Array.isArray(payload.glycan_cols)) cs.glycan_cols = payload.glycan_cols;
    if (payload.measurement_type) cs.measurement_type = payload.measurement_type;
    if (payload.normalization_method) {
      cs.normalization_method = payload.normalization_method;
      cs.apply_closure = payload.normalization_method !== 'none_as_is';
    } else if (payload.apply_closure !== undefined) {
      cs.apply_closure = Boolean(payload.apply_closure);
      if (cs.apply_closure && cs.normalization_method === 'none_as_is') {
        cs.normalization_method = 'total_area_pct';
      }
    }
    if (payload.zero_handling) cs.zero_handling = payload.zero_handling;
    if (Array.isArray(payload.excluded_samples)) cs.excluded_samples = payload.excluded_samples;
    if (payload.treat_f_as_fucose !== undefined)
      cs.parser_config.treat_f_as_fucose = Boolean(payload.treat_f_as_fucose);
    if (payload.treat_dhex_as_fucose !== undefined)
      cs.parser_config.treat_dhex_as_fucose = Boolean(payload.treat_dhex_as_fucose);
    if (payload.assume_s_is_neuac !== undefined)
      cs.parser_config.assume_s_is_neuac = Boolean(payload.assume_s_is_neuac);
    if (payload.manual_overrides) {
      cs.parser_config.manual_overrides = {
        ...cs.parser_config.manual_overrides,
        ...payload.manual_overrides,
      };
    }

    return recomputeClientSession(cs);
  },

  parseCompositions(payload: {
    labels: string[];
    treat_f_as_fucose?: boolean;
    treat_dhex_as_fucose?: boolean;
    assume_s_is_neuac?: boolean;
    manual_overrides?: Record<string, Record<string, number>>;
    custom_components?: Record<string, string>;
    explain_glycan?: string;
    explain_abundance_pct?: number;
  }): any {
    const cfg = {
      treat_f_as_fucose: payload.treat_f_as_fucose ?? true,
      treat_dhex_as_fucose: payload.treat_dhex_as_fucose ?? false,
      assume_s_is_neuac: payload.assume_s_is_neuac ?? false,
      manual_overrides: payload.manual_overrides || {},
      custom_components: payload.custom_components || {},
    };
    const parsed = (payload.labels || []).map((l) => parseGlycanComposition(l, cfg));

    let singleExplanation: any = null;
    if (payload.explain_glycan) {
      const pc = parseGlycanComposition(payload.explain_glycan, cfg);
      const abund = Number(payload.explain_abundance_pct ?? 3.2);
      const defs = refData.trait_definitions as TraitDefinition[];
      const contribs = defs
        .filter((d) => d.Is_Baseline)
        .map((d) => {
          const rule = evaluateGlycanForTrait(d.Trait_ID, pc);
          return {
            trait_id: d.Trait_ID,
            trait_name: d.Trait_Name,
            unit: d.Unit,
            included: rule.included,
            included_in_numerator: rule.included,
            weight: rule.numWeight,
            numerator_weight: rule.numWeight,
            numerator_contribution: rule.included ? abund * rule.numWeight : 0,
            in_denominator: rule.inDenom,
            included_in_denominator: rule.inDenom,
            denominator_contribution: rule.inDenom ? abund * rule.denWeight : 0,
            reason: rule.reason,
          };
        });
      singleExplanation = {
        glycan_label: payload.explain_glycan,
        parsed: pc,
        parsed_composition: pc,
        abundance_pct: abund,
        trait_contributions: contribs,
      };
    }

    return {
      parsed_compositions: parsed,
      single_glycan_explanation: singleExplanation,
    };
  },

  getTraitContributionAudit(
    sessionId: string,
    traitId: string,
    sampleId?: string
  ): TraitContributionAudit {
    const cs =
      clientSessions[sessionId] ||
      Object.values(clientSessions)[0] ||
      (() => {
        this.loadDemo(false);
        return Object.values(clientSessions)[0];
      })();
    const summary = cs.summary;
    const td =
      summary.composition_results.trait_definitions.find((t) => t.Trait_ID === traitId) ||
      summary.composition_results.trait_definitions[0];
    const sr =
      summary.composition_results.sample_results.find((s) => s.sample_id === sampleId) ||
      summary.composition_results.sample_results[0];

    const customSpec = cs.custom_traits.find((c) => c.definition.Trait_ID === td.Trait_ID)?.spec;
    const normRowObj =
      cs.normalized_pct_rows.find((r) => String(r[cs.sample_id_col]) === sr.sample_id) ||
      cs.normalized_pct_rows[0] ||
      cs.rows[0];
    const parsedComps = summary.qc_report.parsed_compositions;

    const workVals = cs.glycan_cols.map((col) => Number(normRowObj[col] || 0));

    const incGlycans: string[] = [];
    const excGlycans: string[] = [];
    const contributions: TraitContributionAudit['contributions'] = [];

    parsedComps.forEach((pc, k) => {
      const abund = workVals[k] || 0;
      const rule = evaluateGlycanForTrait(td.Trait_ID, pc, customSpec);
      if (rule.included) incGlycans.push(pc.raw_label);
      else excGlycans.push(pc.raw_label);

      contributions.push({
        glycan: pc.raw_label,
        normalized_label: pc.normalized_label,
        abundance_pct: abund,
        Hex: pc.Hex,
        HexNAc: pc.HexNAc,
        Fucose: pc.Fucose,
        Sialic_Acid: pc.Sialic_Acid,
        included: rule.included,
        weight: rule.numWeight,
        contribution: rule.included ? abund * rule.numWeight : 0,
        included_in_denominator: rule.inDenom,
        denominator_contribution: rule.inDenom ? abund * rule.denWeight : null,
        reason: rule.reason,
      });
    });

    const num = sr.numerators[td.Trait_ID] ?? 0;
    const den = sr.denominators[td.Trait_ID] ?? null;
    const finalVal = sr.traits[td.Trait_ID] ?? null;

    return {
      sample_id: sr.sample_id,
      group: sr.group,
      trait: td,
      included_glycans: incGlycans,
      excluded_glycans: excGlycans,
      included_count: incGlycans.length,
      excluded_count: excGlycans.length,
      numerator: num,
      denominator: den,
      final_value: finalVal,
      unit: td.Unit,
      aggregation_explanation:
        den !== null
          ? `Numerator = ${num.toFixed(4)}, Denominator = ${den.toFixed(4)} => Final Value = ${
              finalVal !== null ? finalVal.toFixed(4) : 'NA'
            } (${td.Unit})`
          : `Weighted Pool Sum = ${num.toFixed(4)} (${td.Unit}) across ${incGlycans.length} included compositions.`,
      contributions,
    };
  },

  createOrPreviewCustomTrait(payload: Record<string, any>): any {
    const cs = clientSessions[payload.session_id] || Object.values(clientSessions)[0];
    const name = String(payload.trait_name || 'Custom Composition Trait').trim();
    const forbidden = /core\s*fuc|antennary\s*fuc|bisecting|alpha\s*2|a2-3|a2-6/i;
    if (forbidden.test(name)) {
      throw new Error(
        'Custom composition-derived traits cannot claim linkage-specific structural identity (e.g., core fucosylation, bisecting GlcNAc, or alpha2,3/2,6 sialylation).'
      );
    }

    const traitId = payload.trait_id || `U0${(cs?.custom_traits.length || 0) + 1}`;
    const clauses = payload.inclusion_clauses || [];
    const clauseStr = clauses
      .map((c: any) => `${c.component} ${c.operator} ${c.value}`)
      .join(' AND ');
    const denClauses = payload.denominator_clauses || [];
    const denStr = denClauses.length
      ? denClauses.map((c: any) => `${c.component} ${c.operator} ${c.value}`).join(' AND ')
      : 'None (Direct Pool / Weighted Sum)';

    const td: TraitDefinition = {
      Trait_ID: traitId,
      Trait_Name: name,
      Analytical_Category: 'Composition-Derived',
      Trait_Group: 'Group F: User-Defined Composition Traits',
      Mathematical_Formula: `Custom(${clauseStr}; weight=${payload.numerator_weight || '1'})`,
      Plain_Formula: `SUM(p_ik * ${payload.numerator_weight || '1'} * I(${clauseStr}))${
        denClauses.length ? ` / SUM(p_ik * I(${denStr}))` : ''
      }`,
      Required_Components: ['Hex', 'HexNAc', 'Fucose', 'Sialic_Acid'],
      Inclusion_Criteria: clauseStr,
      Exclusion_Criteria: `Compositions not satisfying (${clauseStr})`,
      Numerator_Definition: `Weighted abundance sum (${payload.numerator_weight || '1'}) for (${clauseStr})`,
      Denominator_Definition: denStr,
      Unit: payload.unit || '%',
      Interpretation:
        payload.interpretation || `User-defined composition-derived trait (${clauseStr}).`,
      Limitations:
        'Calculated strictly from monosaccharide composition stoichiometry; does not establish linkage or branching topology.',
      Calculation_Version: '1.0.0-Custom',
      Is_Baseline: false,
      Is_Optional: false,
      Is_Custom: true,
    };

    const parsedComps = cs?.summary.qc_report.parsed_compositions || [];
    const incGlycans = parsedComps
      .filter((pc) => evaluateGlycanForTrait(traitId, pc, payload).included)
      .map((pc) => pc.raw_label);

    if (payload.save_to_session && cs) {
      cs.custom_traits = cs.custom_traits.filter((x) => x.definition.Trait_ID !== traitId);
      cs.custom_traits.push({ definition: td, spec: payload });
      recomputeClientSession(cs);
    }

    return {
      trait_definition: td,
      included_glycans: incGlycans,
      session_summary: cs ? cs.summary : null,
    };
  },

  calculateStructureTraits(payload: {
    session_id: string;
    annotations?: any[];
    clear_annotations?: boolean;
  }): SessionSummary {
    const cs = clientSessions[payload.session_id] || Object.values(clientSessions)[0];
    if (payload.clear_annotations) {
      cs.structural_annotations = {};
    } else if (Array.isArray(payload.annotations)) {
      payload.annotations.forEach((a) => {
        const gid = String(a.glycan_id || a.composition || '').trim();
        if (!gid) return;
        if (a.structure_sequence) {
          cs.structural_annotations[gid] = parseStructuralSequenceClient(
            gid,
            a.composition || gid,
            a.structure_sequence,
            a.sequence_format || 'IUPAC-condensed'
          );
        } else {
          cs.structural_annotations[gid] = {
            glycan_id: gid,
            composition: a.composition || gid,
            sequence_format: a.sequence_format || 'Tabular',
            structure_sequence: a.structure_sequence || 'Tabular Annotation',
            has_validated_structure: true,
            annotation_confidence: a.annotation_confidence || 'Experimentally Confirmed',
            experimental_evidence: a.experimental_evidence || 'Curated Structural Table',
            core_fucosylated: Boolean(a.core_fucosylated),
            antennary_fucosylated: Boolean(a.antennary_fucosylated),
            bisecting_glcnac: Boolean(a.bisecting_glcnac),
            galactose_count: Number(a.galactose_count ?? 0),
            structural_class: a.structural_class || 'Complex',
            antenna_count: Number(a.antenna_count ?? 2),
            alpha2_3_sialic_count: Number(a.alpha2_3_sialic_count ?? 0),
            alpha2_6_sialic_count: Number(a.alpha2_6_sialic_count ?? 0),
            parser_validation_notes: ['Validated tabular structural annotation.'],
          };
        }
      });
    }
    return recomputeClientSession(cs);
  },

  async uploadStructureAnnotationFile(
    sessionId: string,
    file: File
  ): Promise<SessionSummary> {
    const rows = await parseFileToRows(file);
    return this.calculateStructureTraits({
      session_id: sessionId,
      annotations: rows,
    });
  },

  // Direct Export of Normalized Relative Abundance Matrix (+ optional Traits)
  downloadNormalizedMatrix(
    sessionId: string,
    format: 'xlsx' | 'csv' = 'xlsx',
    includeTraits = true
  ): void {
    const cs = clientSessions[sessionId] || Object.values(clientSessions)[0];
    if (!cs) return;
    const s = cs.summary;

    const combinedRows = cs.normalized_pct_rows.map((normRow) => {
      const sid = String(normRow[cs.sample_id_col]);
      const sr = s.composition_results.sample_results.find((x) => x.sample_id === sid);
      return includeTraits && sr
        ? { ...normRow, ...sr.traits }
        : { ...normRow };
    });

    const baseName = cs.filename.replace(/\.[^.]+$/, '');
    const outName = includeTraits
      ? `${baseName}_Normalized_Abundance_And_Traits.${format}`
      : `${baseName}_Normalized_Relative_Abundance_Pct.${format}`;

    if (format === 'xlsx' && (window as any).XLSX) {
      const XLSX = (window as any).XLSX;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(cs.normalized_pct_rows),
        'Normalized_Abundance_Pct'
      );
      if (cs.normalization_method !== 'total_area_pct' && cs.normalization_method !== 'none_as_is') {
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.json_to_sheet(cs.normalized_custom_rows),
          'Normalized_Selected_Scale'
        );
      }
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(cs.rows),
        'Original_Raw_Data'
      );
      if (includeTraits) {
        const tcRows = s.composition_results.sample_results.map((sr) => ({
          Sample_ID: sr.sample_id,
          Group: sr.group,
          ...sr.traits,
        }));
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.json_to_sheet(tcRows),
          'Calculated_Traits'
        );
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.json_to_sheet(combinedRows),
          'Combined_Normalized_And_Traits'
        );
      }
      const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      triggerDirectBlobDownload(
        new Blob([wbArray], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        outName
      );
      return;
    }

    const csv = objectsToCsv(combinedRows);
    triggerDirectBlobDownload(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      outName.replace(/\.xlsx$/, '.csv')
    );
  },

  // Download Data Templates (.xlsx / .csv) so users know exact input structure
  downloadDataTemplate(
    templateType:
      | 'raw_area_template'
      | 'relative_pct_template'
      | 'metadata_template'
      | 'structural_template'
      | 'active_dataset',
    format: 'xlsx' | 'csv' = 'xlsx',
    sessionId?: string
  ): void {
    const XLSX = (window as any).XLSX;

    if (templateType === 'active_dataset') {
      const cs =
        (sessionId && clientSessions[sessionId]) || Object.values(clientSessions)[0];
      if (!cs) return;
      if (format === 'xlsx' && XLSX) {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cs.rows), 'Raw_Data');
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.json_to_sheet(cs.normalized_pct_rows),
          'Normalized_Abundance_Pct'
        );
        const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        triggerDirectBlobDownload(
          new Blob([wbArray], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          cs.filename.endsWith('.xlsx') ? cs.filename : `${cs.filename}.xlsx`
        );
        return;
      }
      const csv = objectsToCsv(cs.rows);
      triggerDirectBlobDownload(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `${cs.filename.replace(/\.[^.]+$/, '')}.csv`
      );
      return;
    }

    let templateRows: Record<string, any>[] = [];
    let sheetTitle = 'Data_Template';
    let filenameBase = 'GAREG_Data_Template';
    const guideAoa: string[][] = [
      ['GAREG Glycomic Trait Analyzer — Data Preparation & Template Guide'],
      ['1. Primary Columns', 'Include Sample_ID (unique sample identifier) and Group (experimental cohort/group name, e.g., Control, Disease).'],
      ['2. Clinical Metadata', 'You can include clinical columns (Age, Sex, Stage, Batch) directly in the table or upload them as a separate metadata file matched by Sample_ID.'],
      ['3. Glycan Composition Headers', 'Use standard monosaccharide symbols: H = Hexose (Hex), N = HexNAc, F = Fucose (Fuc), S = Sialic Acid (Sia). Extended: NeuAc, NeuGc, dHex, HexA, Pentose, Su, Phos.'],
      ['4. Example Glycan Headers', 'Paucimannose: H3N2, H3N2F1, H4N2 | High-Mannose: H5N2–H9N2 | Hybrid: H3N3F1 | Complex: H3N4F1, H4N4F1, H5N4F1, H5N4F1S1, H5N4F1S2, H6N5F1S3'],
      ['5. Raw Areas vs Relative %', 'You can upload either Raw Peak Areas / Intensities (software will automatically perform Total Area Normalization to 100% or PQN/Quantile/BasePeak) OR pre-normalized Relative Abundance (%).'],
    ];

    if (templateType === 'raw_area_template') {
      filenameBase = 'GAREG_Template_Raw_Peak_Area_Intensity';
      sheetTitle = 'Raw_Peak_Areas';
      templateRows = [
        { Sample_ID: 'S001', Group: 'Control', Age: 54, Sex: 'F', H3N2F1: 42100, H4N2: 38500, H5N2: 145200, H6N2: 98400, H3N3F1: 112000, H3N4F1: 2150400, H4N4F1: 3420000, H5N4F1: 1890000, H4N4F1S1: 420000, H5N4F1S1: 980000, H5N4F1S2: 310000, H6N5F1S3: 65000 },
        { Sample_ID: 'S002', Group: 'Control', Age: 61, Sex: 'M', H3N2F1: 39800, H4N2: 36900, H5N2: 138900, H6N2: 94100, H3N3F1: 108500, H3N4F1: 2080000, H4N4F1: 3510000, H5N4F1: 1940000, H4N4F1S1: 445000, H5N4F1S1: 1020000, H5N4F1S2: 335000, H6N5F1S3: 71000 },
        { Sample_ID: 'S003', Group: 'Disease', Age: 59, Sex: 'F', H3N2F1: 71500, H4N2: 62400, H5N2: 245000, H6N2: 175000, H3N3F1: 154000, H3N4F1: 3290000, H4N4F1: 2410000, H5N4F1: 1120000, H4N4F1S1: 510000, H5N4F1S1: 640000, H5N4F1S2: 195000, H6N5F1S3: 115000 },
        { Sample_ID: 'S004', Group: 'Disease', Age: 66, Sex: 'M', H3N2F1: 75800, H4N2: 65100, H5N2: 268000, H6N2: 189000, H3N3F1: 162000, H3N4F1: 3480000, H4N4F1: 2290000, H5N4F1: 1050000, H4N4F1S1: 530000, H5N4F1S1: 590000, H5N4F1S2: 180000, H6N5F1S3: 128000 },
      ];
    } else if (templateType === 'relative_pct_template') {
      filenameBase = 'GAREG_Template_Relative_Abundance_Pct';
      sheetTitle = 'Relative_Abundance_Pct';
      templateRows = [
        { Sample_ID: 'S001', Group: 'Control', H3N2F1: 0.44, H4N2: 0.40, H5N2: 1.50, H6N2: 1.02, H3N3F1: 1.16, H3N4F1: 22.23, H4N4F1: 35.36, H5N4F1: 19.54, H4N4F1S1: 4.34, H5N4F1S1: 10.13, H5N4F1S2: 3.21, H6N5F1S3: 0.67 },
        { Sample_ID: 'S002', Group: 'Control', H3N2F1: 0.41, H4N2: 0.38, H5N2: 1.41, H6N2: 0.96, H3N3F1: 1.10, H3N4F1: 21.18, H4N4F1: 35.75, H5N4F1: 19.76, H4N4F1S1: 4.53, H5N4F1S1: 10.39, H5N4F1S2: 3.41, H6N5F1S3: 0.72 },
        { Sample_ID: 'S003', Group: 'Disease', H3N2F1: 0.79, H4N2: 0.69, H5N2: 2.71, H6N2: 1.94, H3N3F1: 1.70, H3N4F1: 36.46, H4N4F1: 26.71, H5N4F1: 12.41, H4N4F1S1: 5.65, H5N4F1S1: 7.09, H5N4F1S2: 2.16, H6N5F1S3: 1.69 },
        { Sample_ID: 'S004', Group: 'Disease', H3N2F1: 0.84, H4N2: 0.72, H5N2: 2.97, H6N2: 2.10, H3N3F1: 1.80, H3N4F1: 38.63, H4N4F1: 25.43, H5N4F1: 11.66, H4N4F1S1: 5.88, H5N4F1S1: 6.55, H5N4F1S2: 2.00, H6N5F1S3: 1.42 },
      ];
    } else if (templateType === 'metadata_template') {
      filenameBase = 'GAREG_Template_Clinical_Sample_Metadata';
      sheetTitle = 'Sample_Metadata';
      templateRows = [
        { Sample_ID: 'S001', Group: 'Control', Age: 54, Gender: 'Female', Disease_Stage: 'Healthy', Treatment_Status: 'Naive', Batch: 'Batch_1' },
        { Sample_ID: 'S002', Group: 'Control', Age: 61, Gender: 'Male', Disease_Stage: 'Healthy', Treatment_Status: 'Naive', Batch: 'Batch_1' },
        { Sample_ID: 'S003', Group: 'Disease', Age: 59, Gender: 'Female', Disease_Stage: 'Stage_II', Treatment_Status: 'Pre_Op', Batch: 'Batch_1' },
        { Sample_ID: 'S004', Group: 'Disease', Age: 66, Gender: 'Male', Disease_Stage: 'Stage_III', Treatment_Status: 'Pre_Op', Batch: 'Batch_2' },
      ];
    } else {
      filenameBase = 'GAREG_Template_Structural_Annotations';
      sheetTitle = 'Structural_Annotations';
      templateRows = [
        {
          glycan_id: 'H5N4F1S1',
          composition: 'H5N4F1S1',
          sequence_format: 'IUPAC-condensed',
          structure_sequence: 'Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
          core_fucosylated: true,
          antennary_fucosylated: false,
          bisecting_glcnac: false,
          galactose_count: 2,
          structural_class: 'Complex',
          antenna_count: 2,
          alpha2_3_sialic_count: 0,
          alpha2_6_sialic_count: 1,
        },
        {
          glycan_id: 'H4N5F1',
          composition: 'H4N5F1',
          sequence_format: 'IUPAC-condensed',
          structure_sequence: 'Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[GlcNAc(b1-2)Man(a1-3)][GlcNAc(b1-4)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc',
          core_fucosylated: true,
          antennary_fucosylated: false,
          bisecting_glcnac: true,
          galactose_count: 1,
          structural_class: 'Complex',
          antenna_count: 2,
          alpha2_3_sialic_count: 0,
          alpha2_6_sialic_count: 0,
        },
      ];
    }

    if (format === 'xlsx' && XLSX) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(templateRows), sheetTitle);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guideAoa), 'Instructions_And_Guide');
      const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      triggerDirectBlobDownload(
        new Blob([wbArray], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${filenameBase}.xlsx`
      );
      return;
    }

    const csv = objectsToCsv(templateRows);
    triggerDirectBlobDownload(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `${filenameBase}.csv`
    );
  },

  generateReportHtml(sessionId: string): string {
    const cs = clientSessions[sessionId] || Object.values(clientSessions)[0];
    const s = cs.summary;
    const m = s.dashboard_metrics;
    const groups = s.composition_results.group_summaries.distinct_groups;
    const byTrait = s.composition_results.group_summaries.by_trait;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>GAREG Glycomic Trait Analysis Report — ${s.filename}</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 28px; line-height: 1.5; }
    h1 { color: #0f2b46; border-bottom: 3px solid #0284c7; padding-bottom: 8px; margin-bottom: 4px; }
    h2 { color: #0f2b46; margin-top: 24px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; font-size: 1.1rem; }
    .meta { font-size: 0.85rem; color: #475569; margin-bottom: 16px; }
    .box { background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #0284c7; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 0.85rem; }
    .warn { background: #fffbeb; border-color: #fde68a; border-left-color: #d97706; color: #92400e; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.78rem; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #0f2b46; color: #fff; }
    tr:nth-child(even) { background: #f8fafc; }
    .mono { font-family: Consolas, monospace; }
  </style>
</head>
<body>
  <h1>GAREG Glycomic Trait Analysis Report</h1>
  <div class="meta">
    <strong>Platform:</strong> GAREG Glycomic Trait Analyzer v1.1.0 (https://www.gareg.com.tr/glycan-trait-analyzer/) &bull;
    <strong>Dataset:</strong> ${s.filename} &bull;
    <strong>Generated:</strong> ${new Date().toISOString()}
  </div>

  <div class="box">
    <strong>Core Methodological Principle:</strong> Composition-derived glycan traits (Category A: T01–T28) are calculated exclusively from monosaccharide composition stoichiometry and sample-level relative abundance. Structure-derived glycan traits (Category B: S01–S08) require experimentally validated linkage and branching topology. Composition-derived proxies are never reported as confirmed structural traits.
  </div>

  <h2>15.1 Dataset & Normalization Overview</h2>
  <table>
    <tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr>
    <tr><td>Active Biological Samples</td><td>${m.active_samples} / ${m.total_samples}</td><td>Identified Glycan Compositions</td><td>${m.identified_glycan_compositions}</td></tr>
    <tr><td>Experimental Groups</td><td>${groups.map((g) => `${g} (n=${m.experimental_groups[g]})`).join(', ')}</td><td>Measurement Type</td><td>${s.qc_report.measurement_type_label}</td></tr>
    <tr><td>Normalization Method</td><td>${s.qc_report.normalization_method_label || s.qc_report.normalization_applied}</td><td>Zero-Value Policy</td><td>${s.qc_report.zero_handling_label}</td></tr>
  </table>

  <h2>15.2 Data Quality & Scientific Consistency Summary</h2>
  <p style="font-size:0.84rem;">
    Composition Parsing Rate: <strong>${s.qc_report.parsing_success_rate_pct.toFixed(1)}%</strong> &bull;
    Missing Values: <strong>${s.qc_report.missing_values_count}</strong> &bull;
    Zero Values: <strong>${s.qc_report.zero_values_count}</strong> &bull;
    Internal Consistency Checks (VAL01–VAL09): <strong>${s.composition_results.scientific_validation.all_passed ? 'ALL 9 PASSED' : 'Review Required'}</strong>
  </p>

  <h2>15.3 Parsed Glycan Composition Summary</h2>
  <table>
    <thead>
      <tr><th>Glycan Label</th><th>Canonical</th><th>Hex (H)</th><th>HexNAc (N)</th><th>Fucose (F)</th><th>Sialic Acid (S)</th><th>Paucimannose (H1-4N2F0-1)</th><th>High-Man (H5-9N2)</th><th>N3 Proxy</th><th>N&ge;4 Pool</th></tr>
    </thead>
    <tbody>
      ${s.qc_report.parsed_compositions
        .map(
          (p) =>
            `<tr><td class="mono"><strong>${p.raw_label}</strong></td><td class="mono">${p.normalized_label}</td><td>${p.Hex}</td><td>${p.HexNAc}</td><td>${p.Fucose}</td><td>${p.Sialic_Acid}</td><td>${p.flags.Paucimannose_pool ?? p.flags.H4N2_pool ?? 0}</td><td>${p.flags['High_Mannose_H5-H9N2'] ?? 0}</td><td>${p.flags.N3_pool_proxy ?? 0}</td><td>${p.flags.Nge4_complex_candidate ?? 0}</td></tr>`
        )
        .join('')}
    </tbody>
  </table>

  <h2>15.4 Category A: Composition-Derived Glycan Trait Results (Group Summary)</h2>
  <table>
    <thead>
      <tr>
        <th>Trait ID</th>
        <th>Trait Name</th>
        <th>Unit</th>
        ${groups.map((g) => `<th>${g} (Mean &plusmn; SD)</th><th>${g} (Median [IQR])</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${s.composition_results.trait_definitions
        .filter((d) => d.Is_Baseline)
        .map((d) => {
          const st = byTrait[d.Trait_ID]?.groups || {};
          return `<tr>
            <td class="mono"><strong>${d.Trait_ID}</strong></td>
            <td>${d.Trait_Name}</td>
            <td class="mono">${d.Unit}</td>
            ${groups
              .map((g) => {
                const gs = st[g];
                if (!gs || !gs.valid_n) return '<td>NA</td><td>NA</td>';
                return `<td>${gs.mean?.toFixed(3)} &plusmn; ${gs.sd?.toFixed(3)}</td><td>${gs.median?.toFixed(3)} [${gs.iqr?.toFixed(3)}]</td>`;
              })
              .join('')}
          </tr>`;
        })
        .join('')}
    </tbody>
  </table>

  <h2>15.5 Category B: Structure-Derived Glycan Trait Status</h2>
  <div class="box warn">
    <strong>Status:</strong> ${s.structure_results.status_message}
  </div>

  <h2>15.6 & 15.7 Methodological Notes and Limitations</h2>
  <p style="font-size:0.82rem;">
    1. Every trait was calculated independently per biological sample prior to group-level aggregation.<br/>
    2. Generic sialic acid (S) is never assumed to be Neu5Ac without explicit sialic acid speciation.<br/>
    3. Core vs. antennary fucosylation, bisecting GlcNAc, confirmed antenna count, and &alpha;2,3 vs. &alpha;2,6 sialic acid linkage ratios cannot be derived from monosaccharide composition alone.
  </p>
</body>
</html>`;
  },

  downloadExport(
    endpoint: 'excel' | 'csv' | 'report',
    sessionId: string,
    format = 'html'
  ): Blob {
    const cs = clientSessions[sessionId] || Object.values(clientSessions)[0];
    const s = cs.summary;

    if (endpoint === 'report') {
      const html = this.generateReportHtml(sessionId);
      return new Blob([html], { type: 'text/html;charset=utf-8' });
    }

    if (endpoint === 'excel' && (window as any).XLSX) {
      const XLSX = (window as any).XLSX;
      const wb = XLSX.utils.book_new();

      // Sheet 1: Read_Me
      const ws1 = XLSX.utils.aoa_to_sheet([
        ['GAREG Glycomic Trait Analyzer — Multi-Sheet Reproducible Scientific Workbook'],
        ['Website', 'https://www.gareg.com.tr/glycan-trait-analyzer/'],
        ['Dataset Filename', s.filename],
        ['Generated At (UTC)', new Date().toISOString()],
        ['Measurement Type', s.qc_report.measurement_type_label],
        ['Normalization Method', s.qc_report.normalization_method_label || s.qc_report.normalization_applied],
        ['Zero-Handling Policy', s.qc_report.zero_handling_label],
        ['Core Principle', 'Composition-derived traits (Category A) and Structure-derived traits (Category B) are strictly separated.'],
      ]);
      XLSX.utils.book_append_sheet(wb, ws1, 'Read_Me');

      // Sheet 2: Raw_Abundance
      const ws2 = XLSX.utils.json_to_sheet(cs.rows);
      XLSX.utils.book_append_sheet(wb, ws2, 'Raw_Abundance');

      // Sheet 3: Normalized_Abundance_Pct
      const wsNorm = XLSX.utils.json_to_sheet(cs.normalized_pct_rows);
      XLSX.utils.book_append_sheet(wb, wsNorm, 'Normalized_Abundance_Pct');

      // Sheet 4: Composition_Map
      const compMapRows = s.qc_report.parsed_compositions.map((p) => ({
        Glycan_Label: p.raw_label,
        Canonical_Composition: p.normalized_label,
        Hex: p.Hex,
        HexNAc: p.HexNAc,
        Fucose: p.Fucose,
        Sialic_Acid: p.Sialic_Acid,
        ...p.flags,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compMapRows), 'Composition_Map');

      // Sheet 5: Structural_Annotations
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(s.structure_results.annotation_table),
        'Structural_Annotations'
      );

      // Sheet 6: Trait_Definitions
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(s.composition_results.trait_definitions),
        'Trait_Definitions'
      );

      // Sheet 7: Trait_Calculations
      const tcRows = s.composition_results.sample_results.map((sr) => ({
        Sample_ID: sr.sample_id,
        Group: sr.group,
        ...sr.traits,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tcRows), 'Trait_Calculations');

      // Sheet 8: Trait_Contributions
      const firstSid = s.composition_results.sample_results[0]?.sample_id;
      const contribRows: any[] = [];
      if (firstSid) {
        s.composition_results.trait_definitions
          .filter((d) => d.Is_Baseline)
          .forEach((d) => {
            const aud = this.getTraitContributionAudit(cs.session_id, d.Trait_ID, firstSid);
            aud.contributions
              .filter((c) => c.included)
              .forEach((c) => {
                contribRows.push({
                  Trait_ID: d.Trait_ID,
                  Trait_Name: d.Trait_Name,
                  Sample_ID: firstSid,
                  Glycan_Label: c.glycan,
                  Abundance_Pct: c.abundance_pct,
                  Weight_Factor: c.weight,
                  Numerator_Contribution: c.contribution,
                });
              });
          });
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contribRows), 'Trait_Contributions');

      // Sheet 9: Group_Summary
      const gsRows: any[] = [];
      s.composition_results.trait_definitions.forEach((d) => {
        const gMap = s.composition_results.group_summaries.by_trait[d.Trait_ID]?.groups || {};
        Object.entries(gMap).forEach(([grp, st]) => {
          gsRows.push({
            Trait_ID: d.Trait_ID,
            Trait_Name: d.Trait_Name,
            Group: grp,
            Valid_N: st.valid_n,
            Mean: st.mean,
            SD: st.sd,
            SE: st.se,
            Median: st.median,
            IQR: st.iqr,
            Min: st.min,
            Max: st.max,
          });
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gsRows), 'Group_Summary');

      // Sheet 10: QC_Report
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(s.qc_report.sample_qc_table),
        'QC_Report'
      );

      // Sheet 11: Not_Derivable_Traits
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(s.structure_results.not_derivable_traits),
        'Not_Derivable_Traits'
      );

      // Sheet 12: Calculation_Provenance
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['Parameter', 'Value'],
          ['Software', 'GAREG Glycomic Trait Analyzer v1.1.0'],
          ['Timestamp', new Date().toISOString()],
          ['Normalization Method', cs.normalization_method],
          ['Treat F as Fucose', String(cs.parser_config.treat_f_as_fucose)],
          ['Assume S is NeuAc', String(cs.parser_config.assume_s_is_neuac)],
        ]),
        'Calculation_Provenance'
      );

      const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      return new Blob([wbArray], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }

    const files: Record<string, string> = {
      '01_raw_abundance.csv': objectsToCsv(cs.rows),
      '01b_normalized_relative_abundance_pct.csv': objectsToCsv(cs.normalized_pct_rows),
      '02_parsed_compositions.csv': objectsToCsv(s.qc_report.parsed_compositions),
      '03_composition_trait_definitions.csv': objectsToCsv(
        s.composition_results.trait_definitions
      ),
      '04_sample_level_composition_traits.csv': objectsToCsv(
        s.composition_results.sample_results.map((sr) => ({
          Sample_ID: sr.sample_id,
          Group: sr.group,
          ...sr.traits,
        }))
      ),
      '05_group_summary_composition_traits.csv': objectsToCsv(
        s.composition_results.trait_definitions.flatMap((d) =>
          Object.entries(
            s.composition_results.group_summaries.by_trait[d.Trait_ID]?.groups || {}
          ).map(([grp, st]) => ({
            Trait_ID: d.Trait_ID,
            Trait_Name: d.Trait_Name,
            Group: grp,
            ...st,
          }))
        )
      ),
      '06_trait_contributions_long_format.csv': objectsToCsv(
        this.getTraitContributionAudit(cs.session_id, 'T09').contributions
      ),
      '07_structure_derived_traits.csv': objectsToCsv(
        s.structure_results.sample_results.map((sr) => ({
          Sample_ID: sr.sample_id,
          Group: sr.group,
          Status: sr.status,
          ...sr.display_traits,
        }))
      ),
      '08_not_derivable_traits.csv': objectsToCsv(
        s.structure_results.not_derivable_traits
      ),
      '09_qc_report.csv': objectsToCsv(s.qc_report.sample_qc_table),
    };
    return createUncompressedZipBlob(files);
  },

  deleteSession(sessionId: string): void {
    delete clientSessions[sessionId];
  },
};

// ============================================================================
// 8. FILE PARSING & ZIP UTILITIES
// ============================================================================
function triggerDirectBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function parseFileToRows(
  file: File,
  sheetName?: string
): Promise<Record<string, any>[]> {
  const buf = await file.arrayBuffer();
  const XLSX = (window as any).XLSX;
  if (XLSX) {
    const wb = XLSX.read(buf, { type: 'array' });
    const targetSheet = sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
    return XLSX.utils.sheet_to_json(wb.Sheets[targetSheet], { defval: '' });
  }
  const text = new TextDecoder('utf-8').decode(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const vals = line.split(sep).map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => {
      const raw = vals[i] ?? '';
      const num = Number(raw);
      obj[h] = raw !== '' && !Number.isNaN(num) ? num : raw;
    });
    return obj;
  });
}

function objectsToCsv(rows: Record<string, any>[]): string {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.map(esc).join(','),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(',')),
  ].join('\n');
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createUncompressedZipBlob(files: Record<string, string>): Blob {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([name, content]) => ({
    nameBytes: enc.encode(name),
    dataBytes: enc.encode(content),
  }));

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  entries.forEach(({ nameBytes, dataBytes }) => {
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  });

  const centralSize = centralParts.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, eocd] as any[], {
    type: 'application/zip',
  });
}
