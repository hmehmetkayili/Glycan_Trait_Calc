"""Command-Line Interface (CLI) for Glycan Trait Calculator.

Allows automated batch processing of glycan abundance datasets in headless
bioinformatics and high-throughput computational pipelines.
"""

from __future__ import annotations

import argparse
import os
import sys

pkg_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if pkg_dir not in sys.path:
    sys.path.insert(0, pkg_dir)

import numpy as np
import pandas as pd

from glycan_trait_calc.core.composition_parser import GlycanCompositionParser
from glycan_trait_calc.core.trait_engine import CompositionTraitEngine
from glycan_trait_calc.core.structure_engine import (
    StructureTraitEngine,
    StructuralSequenceParser,
    StructuralGlycanAnnotation,
)
from glycan_trait_calc.core.qc_engine import run_quality_control, merge_sample_metadata
from glycan_trait_calc.core.export_engine import generate_excel_workbook_bytes


def run_pipeline(
    input_path: str,
    output_path: str | None = None,
    metadata_path: str | None = None,
    structural_path: str | None = None,
    norm_method: str = "total_area_100",
    quiet: bool = False,
) -> None:
    """Run end-to-end glycan trait calculation on an input dataset."""
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    if not quiet:
        print(f"[1/5] Loading abundance dataset: {input_path}")

    ext = os.path.splitext(input_path)[1].lower()
    if ext in [".xlsx", ".xls"]:
        df_raw = pd.read_excel(input_path)
    elif ext in [".tsv", ".tab"]:
        df_raw = pd.read_csv(input_path, sep="\t")
    else:
        df_raw = pd.read_csv(input_path)

    # Clean columns
    df_raw.columns = [str(c).strip() for c in df_raw.columns]

    # Detect Sample_ID and Group
    sample_col = None
    for col in ["Sample_ID", "SampleID", "Sample", "sample_id", "ID"]:
        if col in df_raw.columns:
            sample_col = col
            break
    if sample_col is None:
        sample_col = df_raw.columns[0]

    group_col = None
    for col in ["Group", "Cohort", "Condition", "group", "Class"]:
        if col in df_raw.columns:
            group_col = col
            break
    if group_col is None:
        group_col = "Group"
        df_raw["Group"] = "Sample"

    # Merge metadata if provided
    if metadata_path and os.path.exists(metadata_path):
        if not quiet:
            print(f"      Merging sample metadata from: {metadata_path}")
        m_ext = os.path.splitext(metadata_path)[1].lower()
        df_meta = pd.read_excel(metadata_path) if m_ext in [".xlsx", ".xls"] else pd.read_csv(metadata_path)
        df_raw, _ = merge_sample_metadata(df_raw, df_meta, sample_col)

    # Monosaccharide parser
    parser = GlycanCompositionParser()

    # Identify glycan columns
    non_glycan_cols = {sample_col, group_col}
    glycan_cols = []
    for col in df_raw.columns:
        if col not in non_glycan_cols:
            res = parser.parse(col)
            if res.is_valid:
                glycan_cols.append(col)

    if not glycan_cols:
        raise ValueError("No valid glycan composition columns detected in input table!")

    if not quiet:
        print(f"      Detected {len(df_raw)} samples and {len(glycan_cols)} glycan compositions.")

    # Quality control and matrix preparation
    if not quiet:
        print(f"[2/5] Running quality control and normalizing ({norm_method})...")

    # If raw peak areas, normalize to 100% or 1.0
    df_calc = df_raw.copy()
    if norm_method == "total_area_100":
        num_vals = df_calc[glycan_cols].apply(pd.to_numeric, errors="coerce").fillna(0.0)
        sums = num_vals.sum(axis=1).replace(0, 1.0)
        df_calc[glycan_cols] = num_vals.div(sums, axis=0) * 100.0
    elif norm_method == "total_area_1":
        num_vals = df_calc[glycan_cols].apply(pd.to_numeric, errors="coerce").fillna(0.0)
        sums = num_vals.sum(axis=1).replace(0, 1.0)
        df_calc[glycan_cols] = num_vals.div(sums, axis=0) * 100.0  # internal engine uses pct

    qc_res = run_quality_control(df_calc, sample_col, group_col, glycan_cols)
    internal = qc_res["_internal"]

    sample_ids = internal["sample_ids"]
    groups = internal["groups"]
    working_matrix = internal["working_matrix_pct"]
    parsed_objs = internal["parsed_objects"]

    # Composition trait calculation
    if not quiet:
        print("[3/5] Calculating composition-derived traits...")

    comp_engine = CompositionTraitEngine(include_optional=True)
    comp_res = comp_engine.calculate_all(
        sample_ids=sample_ids,
        groups=groups,
        glycan_labels=glycan_cols,
        abundance_matrix_pct=working_matrix,
        parsed_compositions=parsed_objs,
    )

    # Structural traits
    if not quiet:
        print("[4/5] Evaluating structure-derived traits...")

    structural_dict = {}
    if structural_path and os.path.exists(structural_path):
        s_ext = os.path.splitext(structural_path)[1].lower()
        df_struct = pd.read_excel(structural_path) if s_ext in [".xlsx", ".xls"] else pd.read_csv(structural_path)
        cols_lower = {str(c).strip().lower(): c for c in df_struct.columns}
        
        def _to_opt_bool(v):
            if pd.isna(v):
                return None
            s = str(v).strip().lower()
            return True if s in {"yes", "true", "1", "y"} else False if s in {"no", "false", "0", "n"} else None

        def _to_opt_int(v):
            if pd.isna(v):
                return None
            try:
                return int(v)
            except Exception:
                return None

        for _, row in df_struct.iterrows():
            comp_name = str(row.get("Glycan_Composition", "")).strip()
            if not comp_name:
                continue
            seq = str(row.get("Structural_Sequence", "")).strip() if "Structural_Sequence" in df_struct.columns else ""
            if seq and seq.lower() != "nan":
                structural_dict[comp_name] = StructuralSequenceParser.parse_sequence(
                    glycan_id=comp_name,
                    sequence=seq,
                    composition=comp_name,
                    confidence="Confirmed",
                    evidence="Uploaded structural annotations",
                )
            else:
                cf = _to_opt_bool(row[cols_lower["core_fucosylated"]]) if "core_fucosylated" in cols_lower else None
                af = _to_opt_bool(row[cols_lower["antennary_fucosylated"]]) if "antennary_fucosylated" in cols_lower else None
                bg = _to_opt_bool(row[cols_lower["bisecting_glcnac"]]) if "bisecting_glcnac" in cols_lower else None
                gc = _to_opt_int(row[cols_lower["galactose_count"]]) if "galactose_count" in cols_lower else None
                sc = str(row[cols_lower["structural_class"]]).strip() if ("structural_class" in cols_lower and pd.notna(row[cols_lower["structural_class"]])) else None
                ac = _to_opt_int(row[cols_lower["antenna_count"]]) if "antenna_count" in cols_lower else None
                s23 = _to_opt_int(row[cols_lower["alpha2_3_sialic_count"]]) if "alpha2_3_sialic_count" in cols_lower else None
                s26 = _to_opt_int(row[cols_lower["alpha2_6_sialic_count"]]) if "alpha2_6_sialic_count" in cols_lower else None
                has_any = any(x is not None for x in (cf, af, bg, gc, sc, ac, s23, s26))
                structural_dict[comp_name] = StructuralGlycanAnnotation(
                    glycan_id=comp_name,
                    composition=comp_name,
                    sequence_format="Tabular" if has_any else "none",
                    structure_sequence="",
                    has_validated_structure=has_any,
                    annotation_confidence="Confirmed" if has_any else "Composition-Only",
                    experimental_evidence="Uploaded structural table",
                    core_fucosylated=cf,
                    antennary_fucosylated=af,
                    bisecting_glcnac=bg,
                    galactose_count=gc,
                    structural_class=sc,
                    antenna_count=ac,
                    alpha2_3_sialic_count=s23,
                    alpha2_6_sialic_count=s26,
                )

    struct_engine = StructureTraitEngine()
    struct_res = struct_engine.calculate_structural_traits(
        sample_ids=sample_ids,
        groups=groups,
        glycan_labels=glycan_cols,
        abundance_matrix_pct=working_matrix,
        structural_annotations=structural_dict,
    )

    # Export
    default_out = os.path.splitext(input_path)[0] + "_traits_calculated.xlsx"
    out_file = output_path or default_out

    if not quiet:
        print(f"[5/5] Exporting comprehensive results to: {out_file}")

    session_data = {
        "session_id": "CLI-RUN",
        "filename": os.path.basename(input_path),
        "qc_report": qc_res,
        "composition_results": comp_res,
        "structure_results": struct_res,
        "engine": comp_engine,
        "parser_config": parser.get_configuration_summary(),
    }

    excel_bytes = generate_excel_workbook_bytes(session_data)
    with open(out_file, "wb") as f:
        f.write(excel_bytes)

    if not quiet:
        derivable_struct = [k for k, v in struct_res.get("traits", {}).items() if v.get("status") == "Calculated"]
        print("\n" + "=" * 70)
        print(" Trait Calculation Complete!")
        print(f" Calculated Composition Traits: {len(comp_res.get('trait_definitions', []))}")
        print(f" Calculated Structural Traits:  {len(derivable_struct)}")
        print(f" Output saved to: {os.path.abspath(out_file)}")
        print("=" * 70 + "\n")


def main() -> None:
    """CLI runner function."""
    parser = argparse.ArgumentParser(
        prog="glycan-trait-calc",
        description="Command-Line Glycan Trait Calculator for High-Throughput Glycomics Analysis.",
    )
    parser.add_argument(
        "-i",
        "--input",
        required=True,
        help="Path to input glycan abundance dataset (.xlsx, .csv, .tsv)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Path to destination Excel file (.xlsx) for calculated results",
    )
    parser.add_argument(
        "-m",
        "--metadata",
        default=None,
        help="Optional path to sample metadata table (.xlsx, .csv)",
    )
    parser.add_argument(
        "-s",
        "--structural",
        default=None,
        help="Optional path to experimental structural annotations (.xlsx, .csv)",
    )
    parser.add_argument(
        "-n",
        "--norm",
        choices=["total_area_100", "total_area_1", "none"],
        default="total_area_100",
        help="Abundance normalization algorithm (default: total_area_100)",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Run silently without progress text",
    )

    args = parser.parse_args()

    try:
        run_pipeline(
            input_path=args.input,
            output_path=args.output,
            metadata_path=args.metadata,
            structural_path=args.structural,
            norm_method=args.norm,
            quiet=args.quiet,
        )
    except Exception as e:
        print(f"[Error] Pipeline execution failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
