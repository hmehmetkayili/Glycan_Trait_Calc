"""Data Format Recognition, Quality Control, and Measurement Type Validation Engine.

Implements Sections 4 and 12 of the GAREG Glycomic Trait Analyzer Specification:
- Automatic recognition of Sample_ID, Group, clinical metadata, and glycan composition columns.
- Separate sample metadata table matching by Sample_ID.
- Measurement type handling (Raw peak intensity, Peak area, Total-area-normalized abundance,
  Relative abundance (%), Relative abundance (0-1), Other normalized data).
- Never silently normalizes or alters uploaded abundance values.
- Optional explicit closure (p_ik = x_ik / sum_k x_ik, P_ik = 100 * p_ik) when requested on raw areas.
- Blocks abundance-based trait calculation if CLR-transformed or negative values are uploaded.
- Transparent zero-value classification (true biological absence, below LOD, missing, rounded).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

from glycan_trait_calc.core.composition_parser import GlycanCompositionParser, NON_GLYCAN_HEADERS


MEASUREMENT_TYPES = {
    "relative_abundance_pct": "Relative abundance (%)",
    "relative_abundance_prop": "Relative abundance (0–1)",
    "total_area_normalized": "Total-area-normalized abundance",
    "peak_area": "Peak area",
    "raw_intensity": "Raw peak intensity",
    "other_normalized": "Other normalized data",
    "clr_transformed": "CLR / Log-ratio transformed data (Not valid for abundance traits)",
}

ZERO_HANDLING_MODES = {
    "true_biological_absence": "True biological absence (keep as 0.0 in abundance sums)",
    "below_lod": "Below limit of detection (keep as 0.0 for abundance traits; flag in QC)",
    "missing_measurement": "Missing measurement (treat 0 as missing / NA in QC)",
    "rounded_sampling_zero": "Rounded or sampling zero (keep as 0.0 for abundance traits; flag in QC)",
}


def auto_detect_columns_and_format(
    df: pd.DataFrame,
    parser: Optional[GlycanCompositionParser] = None,
) -> Dict[str, Any]:
    """Automatically detect Sample_ID, Group, metadata columns, glycan columns, and measurement type."""
    p = parser or GlycanCompositionParser()
    cols = [str(c).strip() for c in df.columns]

    # Exclude reference workbook formula helper columns if present
    formula_helper_cols = {"total_abundance_formula", "zero_count_formula", "qc_status_formula"}

    sample_id_col: Optional[str] = None
    group_col: Optional[str] = None
    metadata_cols: List[str] = []
    glycan_cols: List[str] = []
    unrecognized_cols: List[str] = []

    sample_id_candidates = {"sample_id", "sampleid", "sample", "id", "sample name", "samplename"}
    group_candidates = {"group", "cohort", "condition", "class", "diagnosis", "status", "group_name"}
    known_meta_candidates = {
        "age", "gender", "sex", "disease stage", "disease_stage", "stage",
        "treatment", "treatment_status", "treatment status", "batch", "plate",
        "patient_id", "subject_id", "timepoint", "visit",
    }

    for col in cols:
        low = col.lower().strip()
        if low in formula_helper_cols:
            metadata_cols.append(col)
            continue
        if sample_id_col is None and low in sample_id_candidates:
            sample_id_col = col
            continue
        if group_col is None and low in group_candidates:
            group_col = col
            continue
        if low in known_meta_candidates:
            metadata_cols.append(col)
            continue

        # Test if column name parses as a valid glycan composition
        parsed = p.parse(col)
        if parsed.is_valid:
            glycan_cols.append(col)
        else:
            # Check if column is non-numeric (likely metadata) or numeric with invalid glycan header
            series = df[col]
            numeric_conv = pd.to_numeric(series, errors="coerce")
            valid_num_ratio = float(numeric_conv.notna().mean()) if len(series) > 0 else 0.0
            if sample_id_col is None and col == cols[0]:
                sample_id_col = col
            elif group_col is None and col == cols[1] and valid_num_ratio < 0.5:
                group_col = col
            elif valid_num_ratio < 0.5:
                metadata_cols.append(col)
            else:
                unrecognized_cols.append(col)

    if sample_id_col is None and len(cols) > 0:
        sample_id_col = cols[0]
        if sample_id_col in glycan_cols:
            glycan_cols.remove(sample_id_col)
        if sample_id_col in metadata_cols:
            metadata_cols.remove(sample_id_col)

    # Extract numeric matrix for glycan columns to inspect measurement scale
    candidate_feature_cols = glycan_cols if glycan_cols else unrecognized_cols
    if candidate_feature_cols:
        num_df = df[candidate_feature_cols].apply(pd.to_numeric, errors="coerce")
        mat = num_df.to_numpy(dtype=float)
    else:
        mat = np.zeros((len(df), 0), dtype=float)

    detected_measurement_type = _detect_measurement_type(mat)

    return {
        "sample_id_col": sample_id_col,
        "group_col": group_col,
        "metadata_cols": metadata_cols,
        "glycan_cols": glycan_cols,
        "unrecognized_numeric_cols": unrecognized_cols,
        "detected_measurement_type": detected_measurement_type,
    }


def _detect_measurement_type(mat: np.ndarray) -> str:
    if mat.size == 0:
        return "relative_abundance_pct"
    clean = np.nan_to_num(mat, nan=0.0)
    has_neg = bool(np.any(clean < -1e-9))
    row_sums = np.sum(clean, axis=1)
    mean_sum = float(np.mean(row_sums)) if len(row_sums) > 0 else 0.0

    if has_neg:
        # Check if row sums are near 0 (classic CLR property)
        if abs(mean_sum) < 1.0:
            return "clr_transformed"
        return "clr_transformed"

    if 90.0 <= mean_sum <= 110.0:
        return "relative_abundance_pct"
    if 0.90 <= mean_sum <= 1.10:
        return "relative_abundance_prop"
    if mean_sum > 1000.0:
        return "peak_area"
    return "other_normalized"


def merge_sample_metadata(
    abundance_df: pd.DataFrame,
    metadata_df: pd.DataFrame,
    sample_id_col_abund: str,
    sample_id_col_meta: Optional[str] = None,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Automatically match and merge separate sample metadata table using Sample_ID (Section 4)."""
    meta_cols = [str(c).strip() for c in metadata_df.columns]
    if sample_id_col_meta is None or sample_id_col_meta not in meta_cols:
        for c in meta_cols:
            if c.lower() in {"sample_id", "sampleid", "sample", "id"}:
                sample_id_col_meta = c
                break
        if sample_id_col_meta is None and meta_cols:
            sample_id_col_meta = meta_cols[0]

    abund_copy = abundance_df.copy()
    meta_copy = metadata_df.copy()
    abund_copy["_merge_key"] = abund_copy[sample_id_col_abund].astype(str).str.strip()
    meta_copy["_merge_key"] = meta_copy[sample_id_col_meta].astype(str).str.strip()
    meta_copy = meta_copy.drop_duplicates(subset=["_merge_key"], keep="first")

    abund_keys = set(abund_copy["_merge_key"])
    meta_keys = set(meta_copy["_merge_key"])
    matched_keys = abund_keys.intersection(meta_keys)
    unmatched_samples = sorted(abund_keys - meta_keys)

    # Columns from metadata to bring over (avoid overwriting glycan columns)
    new_meta_cols = [
        c for c in meta_copy.columns
        if c not in ("_merge_key", sample_id_col_meta)
    ]

    for col in new_meta_cols:
        col_map = dict(zip(meta_copy["_merge_key"], meta_copy[col]))
        abund_copy[col] = abund_copy["_merge_key"].map(col_map)

    abund_copy.drop(columns=["_merge_key"], inplace=True)

    return abund_copy, {
        "matched_samples_count": len(matched_keys),
        "total_abundance_samples": len(abund_keys),
        "unmatched_sample_ids": unmatched_samples,
        "added_metadata_columns": new_meta_cols,
    }


def run_quality_control(
    df: pd.DataFrame,
    sample_id_col: str,
    group_col: Optional[str],
    glycan_cols: List[str],
    measurement_type: str = "relative_abundance_pct",
    apply_closure: bool = False,
    zero_handling: str = "true_biological_absence",
    parser: Optional[GlycanCompositionParser] = None,
    excluded_samples: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Perform comprehensive scientific Quality Control and prepare abundance matrix (Sections 4.2 & 12)."""
    p = parser or GlycanCompositionParser()
    excl_set = set(excluded_samples or [])

    # Extract sample IDs and groups
    all_sample_ids = [str(v).strip() for v in df[sample_id_col].tolist()]
    if group_col and group_col in df.columns:
        all_groups = [
            str(v).strip() if pd.notna(v) and str(v).strip() != "" else "Unspecified"
            for v in df[group_col].tolist()
        ]
    else:
        all_groups = ["All_Samples"] * len(all_sample_ids)

    # Detect duplicate sample IDs
    seen_sids: Dict[str, int] = {}
    duplicate_sample_ids: List[str] = []
    for sid in all_sample_ids:
        seen_sids[sid] = seen_sids.get(sid, 0) + 1
        if seen_sids[sid] == 2:
            duplicate_sample_ids.append(sid)

    # Parse all candidate glycan columns
    parse_report = p.parse_many(glycan_cols)
    parsed_objects = [p.parse(c) for c in glycan_cols]
    valid_glycan_cols = [c for c, po in zip(glycan_cols, parsed_objects) if po.is_valid]
    invalid_glycan_cols = [c for c, po in zip(glycan_cols, parsed_objects) if not po.is_valid]

    # Extract raw numeric matrix across glycan_cols without altering original values
    raw_df = df[glycan_cols].copy()
    numeric_df = raw_df.apply(pd.to_numeric, errors="coerce")
    raw_matrix = numeric_df.to_numpy(dtype=float)

    # Inspect missing, zero, negative, and non-numeric values
    nan_mask = np.isnan(raw_matrix)
    missing_count = int(np.sum(nan_mask))
    zero_mask = (~nan_mask) & (np.abs(raw_matrix) <= 1e-15)
    zero_count = int(np.sum(zero_mask))
    neg_mask = (~nan_mask) & (raw_matrix < -1e-12)
    negative_count = int(np.sum(neg_mask))

    total_cells = int(raw_matrix.size) if raw_matrix.size > 0 else 1
    zero_pct = 100.0 * zero_count / total_cells
    missing_pct = 100.0 * missing_count / total_cells

    # Check if data are CLR-transformed or contain negative values
    clean_raw = np.nan_to_num(raw_matrix, nan=0.0)
    row_sums_raw = np.sum(clean_raw, axis=1) if clean_raw.size > 0 else np.zeros(len(all_sample_ids))

    is_clr_blocked = (measurement_type == "clr_transformed") or (negative_count > 0)
    warnings: List[Dict[str, str]] = []
    blocking_errors: List[str] = []

    if measurement_type == "clr_transformed":
        blocking_errors.append(
            "Uploaded dataset is flagged as CLR-transformed (centered log-ratio). "
            "Trait calculations must be performed using abundance data, not CLR-transformed or negative log-ratio data. "
            "Please upload the original relative abundance matrix."
        )
    if negative_count > 0:
        neg_coords = np.argwhere(neg_mask)
        examples = [
            f"{all_sample_ids[r]} / {glycan_cols[c]} ({raw_matrix[r, c]:.4f})"
            for r, c in neg_coords[:5]
        ]
        blocking_errors.append(
            f"Detected {negative_count} negative abundance value(s) (e.g., {', '.join(examples)}). "
            "Glycan abundances and trait values must be non-negative. If these are log-transformed or CLR values, "
            "upload the original abundance matrix."
        )

    if duplicate_sample_ids:
        warnings.append({
            "severity": "warning",
            "category": "Duplicate Sample IDs",
            "message": f"Detected {len(duplicate_sample_ids)} duplicate sample identifier(s): {', '.join(duplicate_sample_ids[:10])}.",
        })

    if parse_report["duplicate_raw_labels"]:
        warnings.append({
            "severity": "warning",
            "category": "Duplicate Glycan Labels",
            "message": f"Detected duplicate glycan column name(s): {', '.join(parse_report['duplicate_raw_labels'])}.",
        })

    if parse_report["equivalent_compositions"]:
        eq_strs = [f"{k}: {v}" for k, v in parse_report["equivalent_compositions"].items()]
        warnings.append({
            "severity": "warning",
            "category": "Equivalent Normalized Compositions",
            "message": f"Multiple columns map to the same monosaccharide composition (possible isomers): {'; '.join(eq_strs)}.",
        })

    if invalid_glycan_cols:
        warnings.append({
            "severity": "warning",
            "category": "Unclassified Composition Labels",
            "message": f"{len(invalid_glycan_cols)} column(s) could not be parsed as valid compositions and are excluded from classified pools: {', '.join(invalid_glycan_cols)}.",
        })

    if missing_count > 0:
        warnings.append({
            "severity": "warning",
            "category": "Missing Values",
            "message": f"Dataset contains {missing_count} missing (NA/blank) measurement(s) ({missing_pct:.2f}% of cells).",
        })

    if zero_count > 0:
        warnings.append({
            "severity": "info",
            "category": "Zero Values",
            "message": f"Dataset contains {zero_count} zero value(s) ({zero_pct:.2f}% of cells). Current zero interpretation: '{ZERO_HANDLING_MODES.get(zero_handling, zero_handling)}'.",
        })

    # Prepare working percentage abundance matrix (P_ik = 100 * p_ik) WITHOUT altering raw_matrix
    working_matrix_pct = np.copy(raw_matrix)
    normalization_applied = "None (Original values preserved directly)"

    if not is_clr_blocked and working_matrix_pct.size > 0:
        if measurement_type in ("raw_intensity", "peak_area"):
            if apply_closure:
                # Apply explicit user-requested closure: p_ik = x_ik / sum_k x_ik, P_ik = 100 * p_ik
                closed = np.zeros_like(working_matrix_pct)
                for i in range(working_matrix_pct.shape[0]):
                    r_sum = float(np.nansum(working_matrix_pct[i, :]))
                    if r_sum > 1e-15:
                        closed[i, :] = 100.0 * working_matrix_pct[i, :] / r_sum
                    else:
                        closed[i, :] = 0.0
                working_matrix_pct = closed
                normalization_applied = "Explicit User-Requested Total Area Closure: P_ik = 100 * x_ik / sum_k(x_ik)"
            else:
                warnings.append({
                    "severity": "warning",
                    "category": "Unclosed Raw Peak Data",
                    "message": "Measurement type is set to raw peak intensity/area without closure enabled. Enable optional closure (p_ik = x_ik / sum_k x_ik) to compute relative abundance (%) traits.",
                })
        elif measurement_type == "relative_abundance_prop":
            # Proportions (0-1) -> multiply by 100 for percentage formulas while keeping proportions intact
            working_matrix_pct = 100.0 * working_matrix_pct
            normalization_applied = "Scaled 0–1 relative proportions by 100 for percentage display (P_ik = 100 * p_ik); no re-normalization applied."
        elif measurement_type in ("relative_abundance_pct", "total_area_normalized", "other_normalized"):
            # Do NOT apply another normalization automatically to data that have already undergone total area normalization!
            normalization_applied = "None (Already normalized; no secondary normalization applied per Section 4.2)."

    # Check sample abundance totals according to selected data format
    sample_qc_table: List[Dict[str, Any]] = []
    invalid_total_samples: List[str] = []
    for i, sid in enumerate(all_sample_ids):
        r_raw = raw_matrix[i, :] if raw_matrix.size > 0 else np.array([])
        r_pct = working_matrix_pct[i, :] if working_matrix_pct.size > 0 else np.array([])
        raw_sum = float(np.nansum(r_raw)) if r_raw.size > 0 else 0.0
        pct_sum = float(np.nansum(r_pct)) if r_pct.size > 0 else 0.0
        s_zeros = int(np.sum((~np.isnan(r_raw)) & (np.abs(r_raw) <= 1e-15)))
        s_missing = int(np.sum(np.isnan(r_raw)))
        s_neg = int(np.sum((~np.isnan(r_raw)) & (r_raw < -1e-12)))

        status = "OK"
        if sid in excl_set:
            status = "EXCLUDED"
        elif s_neg > 0:
            status = "ERROR_NEGATIVE"
        elif measurement_type in ("relative_abundance_pct", "total_area_normalized") and abs(raw_sum - 100.0) > 1.0:
            status = "WARNING_TOTAL_NOT_100"
            invalid_total_samples.append(f"{sid} (sum={raw_sum:.2f}%)")
        elif measurement_type == "relative_abundance_prop" and abs(raw_sum - 1.0) > 0.01:
            status = "WARNING_TOTAL_NOT_1"
            invalid_total_samples.append(f"{sid} (sum={raw_sum:.4f})")
        elif s_missing > 0 or s_zeros > 0:
            status = "CHECK"

        sample_qc_table.append({
            "sample_id": sid,
            "group": all_groups[i],
            "raw_total_abundance": raw_sum,
            "working_total_pct": pct_sum,
            "zero_count": s_zeros,
            "missing_count": s_missing,
            "negative_count": s_neg,
            "qc_status": status,
        })

    if invalid_total_samples:
        expected_str = "100%" if measurement_type != "relative_abundance_prop" else "1.0"
        warnings.append({
            "severity": "warning",
            "category": "Sample Abundance Total Deviation",
            "message": f"{len(invalid_total_samples)} sample(s) deviate from expected relative abundance sum (~{expected_str}): {', '.join(invalid_total_samples[:8])}.",
        })

    # Group distribution summary
    group_counts: Dict[str, int] = {}
    for sid, g in zip(all_sample_ids, all_groups):
        if sid not in excl_set:
            group_counts[g] = group_counts.get(g, 0) + 1

    return {
        "total_samples": len(all_sample_ids),
        "active_samples": len(all_sample_ids) - len(excl_set),
        "excluded_samples": list(excl_set),
        "group_distribution": group_counts,
        "distinct_groups": list(group_counts.keys()),
        "total_glycan_columns": len(glycan_cols),
        "valid_glycan_count": len(valid_glycan_cols),
        "invalid_glycan_count": len(invalid_glycan_cols),
        "parsing_success_rate_pct": parse_report["success_rate_pct"],
        "duplicate_sample_ids": duplicate_sample_ids,
        "duplicate_glycan_labels": parse_report["duplicate_raw_labels"],
        "equivalent_compositions": parse_report["equivalent_compositions"],
        "invalid_glycan_labels": invalid_glycan_cols,
        "measurement_type": measurement_type,
        "measurement_type_label": MEASUREMENT_TYPES.get(measurement_type, measurement_type),
        "apply_closure": apply_closure,
        "normalization_applied": normalization_applied,
        "zero_handling": zero_handling,
        "zero_handling_label": ZERO_HANDLING_MODES.get(zero_handling, zero_handling),
        "missing_values_count": missing_count,
        "missing_values_pct": missing_pct,
        "zero_values_count": zero_count,
        "zero_values_pct": zero_pct,
        "negative_values_count": negative_count,
        "is_clr_blocked": is_clr_blocked,
        "blocking_errors": blocking_errors,
        "warnings": warnings,
        "sample_qc_table": sample_qc_table,
        "parsed_compositions": [po.to_dict() for po in parsed_objects],
        "_internal": {
            "sample_ids": all_sample_ids,
            "groups": all_groups,
            "glycan_cols": glycan_cols,
            "parsed_objects": parsed_objects,
            "raw_matrix": raw_matrix,
            "working_matrix_pct": working_matrix_pct,
        },
    }

