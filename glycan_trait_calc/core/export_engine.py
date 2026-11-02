"""Multi-Sheet Excel Exporter (with Live Formulas), ZIP CSV Exporter, and Scientific Report Generator.

Implements Sections 15, 16, and 17 of the GAREG Glycomic Trait Analyzer Specification:
- 11-Worksheet Excel Workbook with live Excel formulas referencing Raw_Abundance and Composition_Map.
- 9-File ZIP CSV Package with complete contribution and definition files.
- Comprehensive HTML and PDF Automated Scientific Reports (Sections 15.1 - 15.7).
"""

from __future__ import annotations

import csv
import datetime
import io
import zipfile
from typing import Any, Dict, List, Optional
import numpy as np
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from glycan_trait_calc.core.config import (
    APP_TITLE,
    APP_VERSION,
    CALCULATION_ENGINE_VERSION,
    COMPONENT_MAPPING_VERSION,
    TRAIT_DEFINITION_VERSION,
)
from glycan_trait_calc.core.structure_engine import NOT_DERIVABLE_TEXT


# Map each baseline/optional trait numerator/denominator to the column letter in Composition_Map
# Composition_Map columns:
# A: Glycan
# B: Hex
# C: HexNAc
# D: Fucose
# E: Sialic_Acid
# F: Parsing_Status
# G: High_Mannose_H5-H9N2
# H: H4N2_pool
# I: N3_pool_proxy
# J: N4_pool
# K: N5_pool
# L: N6_pool
# M: Nge4_complex_candidate
# N: Fucosylated
# O: Non_Fucosylated
# P: Mono_Fucosylated
# Q: Di_Fucosylated
# R: Multi_Fucosylated_Fge2
# S: Sialylated
# T: Sialylated_nonFucosylated
# U: Sialylated_Fucosylated
# V: Nge4_Fucosylated
# W: Nge4_Sialylated
# X: Hex_excess_over_3_in_Nge4
# Y: Nge7_pool

COMPOSITION_MAP_HEADERS = [
    "Glycan",
    "Hex",
    "HexNAc",
    "Fucose",
    "Sialic_Acid",
    "Parsing_Status",
    "High_Mannose_H5-H9N2",
    "H4N2_pool",
    "N3_pool_proxy",
    "N4_pool",
    "N5_pool",
    "N6_pool",
    "Nge4_complex_candidate",
    "Fucosylated",
    "Non_Fucosylated",
    "Mono_Fucosylated",
    "Di_Fucosylated",
    "Multi_Fucosylated_Fge2",
    "Sialylated",
    "Sialylated_nonFucosylated",
    "Sialylated_Fucosylated",
    "Nge4_Fucosylated",
    "Nge4_Sialylated",
    "Hex_excess_over_3_in_Nge4",
    "Nge7_pool",
]

# Map Trait_ID -> (Composition_Map column letter for numerator weight/flag, optional denominator col letter or 'TOTAL', multiplier)
EXCEL_FORMULA_MAP = {
    "T01": ("TOTAL", None, 1.0),
    "T02": ("G", None, 1.0),
    "T03": ("H", None, 1.0),
    "T04": ("I", None, 1.0),
    "T05": ("J", None, 1.0),
    "T06": ("K", None, 1.0),
    "T07": ("L", None, 1.0),
    "T08": ("M", None, 1.0),
    "T09": ("N", None, 1.0),
    "T10": ("O", None, 1.0),
    "T11": ("P", None, 1.0),
    "T12": ("Q", None, 1.0),
    "T13": ("D", None, 1.0),
    "T14": ("D", "TOTAL", 1.0),
    "T15": ("V", "M", 100.0),
    "T16": ("S", None, 1.0),
    "T17": ("T", None, 1.0),
    "T18": ("U", None, 1.0),
    "T19": ("E", None, 1.0),
    "T20": ("E", "TOTAL", 1.0),
    "T21": ("W", "M", 100.0),
    "T22": ("B", "TOTAL", 1.0),
    "T23": ("C", "TOTAL", 1.0),
    "T24": ("X", None, 1.0),
    "T25": ("X", "M", 1.0),
    "T26": ("J", "M", 100.0),
    "T27": ("K", "M", 100.0),
    "T28": ("L", "M", 100.0),
    "T12b": ("R", None, 1.0),
    "T08b": ("Y", None, 1.0),
    "T29": ("D", "E", 1.0),
    "T30": ("U", "N", 100.0),
    "T31": ("U", "S", 100.0),
    "T32": ("G", "TOTAL", 100.0),
}


def _build_pairwise_sum_expr(
    raw_sheet_name: str,
    sample_row: int,
    n_glycans: int,
    map_col_letter: str,
) -> str:
    """Build explicit Excel SUM(Raw_Abundance!C2*Composition_Map!$G$2, ...) formula compatible with all Excel versions without array CSE."""
    terms = []
    for k in range(n_glycans):
        raw_col_letter = get_column_letter(3 + k)
        map_row = 2 + k
        terms.append(f"{raw_sheet_name}!{raw_col_letter}{sample_row}*Composition_Map!${map_col_letter}${map_row}")
    if not terms:
        return "0"
    return f"SUM({','.join(terms)})"


def _style_worksheet_header(ws: Any, max_col: int) -> None:
    header_fill = PatternFill(start_color="0F2B46", end_color="0F2B46", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        bottom=Side(style="medium", color="0284C7"),
        right=Side(style="thin", color="CBD5E1"),
    )
    ws.freeze_panes = "A2"
    for c in range(1, max_col + 1):
        cell = ws.cell(1, c)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
    ws.row_dimensions[1].height = 28


def _auto_fit_columns(ws: Any, max_width: int = 44) -> None:
    for col in ws.columns:
        max_len = 10
        col_letter = get_column_letter(col[0].column)
        for idx, cell in enumerate(col):
            if idx > 60:
                break
            val_str = str(cell.value or "")
            if val_str.startswith("="):
                val_str = "123456.7890"
            max_len = max(max_len, min(len(val_str) + 3, max_width))
        ws.column_dimensions[col_letter].width = max_len


def generate_excel_workbook_bytes(session_data: Dict[str, Any]) -> bytes:
    """Generate the 11-sheet Excel workbook with live formulas and complete audit trails (Section 16)."""
    wb = openpyxl.Workbook()
    # Remove default sheet after creating Sheet 1
    default_ws = wb.active

    qc = session_data["qc_report"]
    comp_res = session_data["composition_results"]
    struct_res = session_data["structure_results"]
    engine = session_data["engine"]

    internal = qc["_internal"]
    sample_ids: List[str] = internal["sample_ids"]
    groups: List[str] = internal["groups"]
    glycan_cols: List[str] = internal["glycan_cols"]
    parsed_objects = internal["parsed_objects"]
    raw_matrix: np.ndarray = internal["raw_matrix"]
    working_matrix_pct: np.ndarray = internal["working_matrix_pct"]
    n_samples = len(sample_ids)
    n_glycans = len(glycan_cols)
    last_glycan_col_letter = get_column_letter(2 + max(n_glycans, 1))

    now_iso = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    filename = session_data.get("filename", "Uploaded_Dataset.xlsx")
    session_id = session_data.get("session_id", "GAREG-SESSION")

    # ==================== SHEET 1: Read_Me ====================
    ws_readme = wb.create_sheet(title="Read_Me")
    wb.remove(default_ws)
    readme_rows = [
        ["Parameter / Section", "Description / Value"],
        ["Project Name", APP_TITLE],
        ["Website", "https://www.gareg.com.tr/glycan-trait-analyzer/"],
        ["Software Version", APP_VERSION],
        ["Calculation Engine Version", CALCULATION_ENGINE_VERSION],
        ["Input Dataset File", filename],
        ["Analysis Timestamp", now_iso],
        ["Number of Samples", n_samples],
        ["Number of Experimental Groups", len(qc.get("distinct_groups", []))],
        ["Number of Glycan Features", n_glycans],
        ["Measurement Type", qc.get("measurement_type_label", "")],
        ["Normalization / Closure Applied", qc.get("normalization_applied", "")],
        ["Zero-Value Handling", qc.get("zero_handling_label", "")],
        ["", ""],
        ["CALCULATION METHODOLOGY & SCIENTIFIC SEPARATION", ""],
        ["Category A: Composition-Derived Traits", "Calculated exclusively from monosaccharide composition (H, N, F, S) and sample-level relative abundance. Every trait formula in 'Trait_Calculations' is a live Excel formula referencing 'Raw_Abundance' and 'Composition_Map'."],
        ["Category B: Structure-Derived Traits", "Requires experimentally validated structural annotations (monosaccharide identity, linkage positions, anomeric configuration, and branch topology). Never inferred from composition alone."],
        ["Sample-First Summarization Principle", "All traits are calculated independently for each biological sample first, and then summarized across groups in 'Group_Summary'."],
        ["", ""],
        ["ABBREVIATIONS", ""],
        ["H (Hex)", "Hexose (e.g., Mannose, Galactose, Glucose). Composition alone does not distinguish isomers."],
        ["N (HexNAc)", "N-acetylhexosamine (e.g., GlcNAc, GalNAc). Composition alone does not distinguish bisecting from antennary GlcNAc."],
        ["F (Fuc)", "Fucose. Composition alone does not distinguish core (α1,6) from antennary fucosylation."],
        ["S (Sia)", "Sialic acid, type/linkage unspecified unless explicitly annotated as NeuAc/NeuGc or α2,3/α2,6."],
        ["p_ik", "Relative abundance proportion of glycan k in sample i (P_ik = 100 * p_ik in %)."],
        ["NA", "Not Available / Undefined (e.g., zero denominator in ratio trait) or Not Derivable from composition-only data."],
    ]
    for row in readme_rows:
        ws_readme.append(row)
    _style_worksheet_header(ws_readme, 2)
    _auto_fit_columns(ws_readme, max_width=85)

    # ==================== SHEET 2: Raw_Abundance ====================
    ws_raw = wb.create_sheet(title="Raw_Abundance")
    raw_headers = ["Sample_ID", "Group"] + glycan_cols + [
        "Total_Abundance_Formula",
        "Zero_Count_Formula",
        "QC_Status_Formula",
    ]
    ws_raw.append(raw_headers)
    # Note: If user explicitly requested closure on raw peak areas or 0-1 scaling, store working_matrix_pct if closure applied
    # Wait: Section 16 says: "Sheet 2 - Raw_Abundance: Store the original uploaded sample-level abundance matrix. Do not alter original values."
    # If measurement_type is already relative_abundance_pct (like the reference workbook), raw_matrix == working_matrix_pct!
    for i in range(n_samples):
        r_excel = i + 2
        row_vals: List[Any] = [sample_ids[i], groups[i]]
        for k in range(n_glycans):
            val = raw_matrix[i, k]
            row_vals.append(None if np.isnan(val) else float(val))
        if n_glycans > 0:
            tot_col_letter = get_column_letter(3 + n_glycans)
            zero_col_letter = get_column_letter(4 + n_glycans)
            tot_formula = f"=SUM(C{r_excel}:{last_glycan_col_letter}{r_excel})"
            zero_formula = f"=COUNTIF(C{r_excel}:{last_glycan_col_letter}{r_excel},0)"
            qc_formula = f'=IF(AND(ABS({tot_col_letter}{r_excel}-100)<=1.0,{zero_col_letter}{r_excel}=0),"OK","CHECK")'
        else:
            tot_formula, zero_formula, qc_formula = "=0", "=0", "CHECK"
        row_vals.extend([tot_formula, zero_formula, qc_formula])
        ws_raw.append(row_vals)
    _style_worksheet_header(ws_raw, len(raw_headers))
    _auto_fit_columns(ws_raw)

    # ==================== SHEET 3: Composition_Map ====================
    ws_map = wb.create_sheet(title="Composition_Map")
    ws_map.append(COMPOSITION_MAP_HEADERS)
    for po in parsed_objects:
        flags = po.compute_reference_flags()
        ws_map.append([
            po.raw_label,
            po.Hex,
            po.HexNAc,
            po.Fucose,
            po.Sialic_Acid,
            po.status,
            flags["High_Mannose_H5-H9N2"],
            flags["H4N2_pool"],
            flags["N3_pool_proxy"],
            flags["N4_pool"],
            flags["N5_pool"],
            flags["N6_pool"],
            flags["Nge4_complex_candidate"],
            flags["Fucosylated"],
            flags["Non_Fucosylated"],
            flags["Mono_Fucosylated"],
            flags["Di_Fucosylated"],
            flags["Multi_Fucosylated_Fge2"],
            flags["Sialylated"],
            flags["Sialylated_nonFucosylated"],
            flags["Sialylated_Fucosylated"],
            flags["Nge4_Fucosylated"],
            flags["Nge4_Sialylated"],
            flags["Hex_excess_over_3_in_Nge4"],
            flags["Nge7_pool"],
        ])
    _style_worksheet_header(ws_map, len(COMPOSITION_MAP_HEADERS))
    _auto_fit_columns(ws_map)

    # ==================== SHEET 4: Structural_Annotations ====================
    ws_struct = wb.create_sheet(title="Structural_Annotations")
    struct_headers = [
        "Glycan_ID",
        "Composition",
        "Sequence_Format",
        "Structure_Sequence",
        "Validated_Structure_Available",
        "Annotation_Confidence",
        "Core_Fucosylated_a1_6",
        "Antennary_Fucosylated",
        "Bisecting_GlcNAc",
        "Confirmed_Galactose_Count",
        "Confirmed_Structural_Class",
        "Confirmed_Antenna_Count",
        "Alpha2_3_Sialic_Count",
        "Alpha2_6_Sialic_Count",
        "Experimental_Evidence",
        "Status_Reason",
    ]
    ws_struct.append(struct_headers)
    for row_ann in struct_res.get("annotation_table", []):
        has_s = row_ann.get("has_validated_structure", False)
        na_str = f"NA ({NOT_DERIVABLE_TEXT})"
        ws_struct.append([
            row_ann.get("glycan_id", ""),
            row_ann.get("composition", ""),
            row_ann.get("sequence_format", "none"),
            row_ann.get("structure_sequence", "") or "NA",
            "Yes" if has_s else "No",
            row_ann.get("annotation_confidence", "Composition-Only"),
            str(row_ann["core_fucosylated"]) if row_ann.get("core_fucosylated") is not None else na_str,
            str(row_ann["antennary_fucosylated"]) if row_ann.get("antennary_fucosylated") is not None else na_str,
            str(row_ann["bisecting_glcnac"]) if row_ann.get("bisecting_glcnac") is not None else na_str,
            row_ann["galactose_count"] if row_ann.get("galactose_count") is not None else na_str,
            row_ann["structural_class"] if row_ann.get("structural_class") is not None else na_str,
            row_ann["antenna_count"] if row_ann.get("antenna_count") is not None else na_str,
            row_ann["alpha2_3_sialic_count"] if row_ann.get("alpha2_3_sialic_count") is not None else na_str,
            row_ann["alpha2_6_sialic_count"] if row_ann.get("alpha2_6_sialic_count") is not None else na_str,
            row_ann.get("experimental_evidence", "") or "None",
            "; ".join(row_ann.get("parser_validation_notes", [])) or NOT_DERIVABLE_TEXT,
        ])
    _style_worksheet_header(ws_struct, len(struct_headers))
    _auto_fit_columns(ws_struct)

    # ==================== SHEET 5: Trait_Definitions ====================
    ws_defs = wb.create_sheet(title="Trait_Definitions")
    def_headers = [
        "Trait_ID",
        "Trait_Name",
        "Category",
        "Mathematical_Formula",
        "Required_Components",
        "Inclusion_Criteria",
        "Exclusion_Criteria",
        "Numerator",
        "Denominator",
        "Unit",
        "Biological_Interpretation",
        "Limitations",
    ]
    ws_defs.append(def_headers)
    all_defs = comp_res.get("trait_definitions", []) + struct_res.get("trait_definitions", [])
    for td in all_defs:
        ws_defs.append([
            td["Trait_ID"],
            td["Trait_Name"],
            td["Analytical_Category"],
            td["Plain_Formula"],
            ", ".join(td["Required_Components"]),
            td["Inclusion_Criteria"],
            td["Exclusion_Criteria"],
            td["Numerator_Definition"],
            td["Denominator_Definition"],
            td["Unit"],
            td["Interpretation"],
            td["Limitations"],
        ])
    _style_worksheet_header(ws_defs, len(def_headers))
    _auto_fit_columns(ws_defs, max_width=55)

    # ==================== SHEET 6: Trait_Calculations ====================
    ws_tc = wb.create_sheet(title="Trait_Calculations")
    comp_trait_defs = comp_res.get("trait_definitions", [])
    tc_headers = ["Sample_ID", "Group"] + [f"{t['Trait_ID']} - {t['Trait_Name']}" for t in comp_trait_defs]
    ws_tc.append(tc_headers)

    # Locate column letters of T05 (N4), T06 (N5), T07 (N6), T08 (N>=4), T24 (Hex excess) in Trait_Calculations
    trait_col_letter_in_tc: Dict[str, str] = {}
    for idx_t, t in enumerate(comp_trait_defs):
        trait_col_letter_in_tc[t["Trait_ID"]] = get_column_letter(3 + idx_t)

    scale_factor_expr = ""
    if qc.get("measurement_type") == "relative_abundance_prop":
        scale_factor_expr = "*100"

    for i, sr in enumerate(comp_res.get("sample_results", [])):
        r_excel = i + 2
        row_cells: List[Any] = [
            f"=Raw_Abundance!A{r_excel}",
            f"=Raw_Abundance!B{r_excel}",
        ]
        total_sum_expr = f"SUM(Raw_Abundance!$C{r_excel}:${last_glycan_col_letter}{r_excel})"
        for t in comp_trait_defs:
            tid = t["Trait_ID"]
            if tid == "T01":
                formula = f"={total_sum_expr}{scale_factor_expr}"
            elif tid == "T25" and "T24" in trait_col_letter_in_tc and "T08" in trait_col_letter_in_tc:
                c_t24 = trait_col_letter_in_tc["T24"]
                c_t08 = trait_col_letter_in_tc["T08"]
                formula = f'=IF({c_t08}{r_excel}=0,"NA",{c_t24}{r_excel}/{c_t08}{r_excel})'
            elif tid in ("T26", "T27", "T28") and "T08" in trait_col_letter_in_tc:
                src_tid = {"T26": "T05", "T27": "T06", "T28": "T07"}[tid]
                c_src = trait_col_letter_in_tc[src_tid]
                c_t08 = trait_col_letter_in_tc["T08"]
                formula = f'=IF({c_t08}{r_excel}=0,"NA",100*{c_src}{r_excel}/{c_t08}{r_excel})'
            elif tid in EXCEL_FORMULA_MAP and not (qc.get("apply_closure") and qc.get("measurement_type") in ("raw_intensity", "peak_area")):
                num_col, den_col, mult = EXCEL_FORMULA_MAP[tid]
                num_expr = (
                    total_sum_expr
                    if num_col == "TOTAL"
                    else _build_pairwise_sum_expr("Raw_Abundance", r_excel, n_glycans, num_col)
                )
                if den_col is None:
                    formula = f"={num_expr}{scale_factor_expr}"
                else:
                    den_expr = (
                        total_sum_expr
                        if den_col == "TOTAL"
                        else _build_pairwise_sum_expr("Raw_Abundance", r_excel, n_glycans, den_col)
                    )
                    mult_str = "*100" if mult == 100.0 else ""
                    formula = f'=IF({den_expr}=0,"NA",({num_expr})/({den_expr}){mult_str})'
            else:
                val = sr["traits"].get(tid)
                formula = "NA" if val is None else float(val)
            row_cells.append(formula)
        ws_tc.append(row_cells)
    _style_worksheet_header(ws_tc, len(tc_headers))
    for r in range(2, n_samples + 2):
        for c in range(3, len(tc_headers) + 1):
            ws_tc.cell(r, c).number_format = "0.0000"
    _auto_fit_columns(ws_tc)

    # ==================== SHEET 7: Trait_Contributions ====================
    ws_contrib = wb.create_sheet(title="Trait_Contributions")
    contrib_headers = [
        "Sample_ID",
        "Trait_ID",
        "Trait_Name",
        "Glycan",
        "Relative_Abundance",
        "Hex_Count",
        "HexNAc_Count",
        "Fucose_Count",
        "Sialic_Acid_Count",
        "Inclusion_Flag",
        "Contribution_Value",
        "Exclusion_Reason",
    ]
    ws_contrib.append(contrib_headers)
    inc_matrix = comp_res.get("inclusion_matrix", {})
    # Write full contribution audit rows for every baseline/active trait across samples
    # To keep Excel fast when many samples exist while remaining 100% auditable, include all samples (41 x 28 x 37 = 42,476 rows fits easily in Excel!)
    for i, sid in enumerate(sample_ids):
        row_abund = working_matrix_pct[i, :]
        for t in comp_trait_defs:
            tid = t["Trait_ID"]
            tname = t["Trait_Name"]
            pg_map = inc_matrix.get(tid, {}).get("per_glycan", {})
            for k, g_lbl in enumerate(glycan_cols):
                abund_val = float(row_abund[k]) if not np.isnan(row_abund[k]) else 0.0
                g_info = pg_map.get(g_lbl, {})
                inc_flag = 1 if g_info.get("included_in_numerator") else 0
                w_num = float(g_info.get("numerator_weight", 0.0))
                contrib_val = abund_val * w_num if inc_flag == 1 else 0.0
                ws_contrib.append([
                    sid,
                    tid,
                    tname,
                    g_lbl,
                    abund_val,
                    g_info.get("Hex", 0),
                    g_info.get("HexNAc", 0),
                    g_info.get("Fucose", 0),
                    g_info.get("Sialic_Acid", 0),
                    inc_flag,
                    contrib_val,
                    "Included" if inc_flag == 1 else g_info.get("reason", "Excluded"),
                ])
    _style_worksheet_header(ws_contrib, len(contrib_headers))
    _auto_fit_columns(ws_contrib)

    # ==================== SHEET 8: Group_Summary ====================
    ws_gs = wb.create_sheet(title="Group_Summary")
    gs_headers = [
        "Trait_ID",
        "Trait_Name",
        "Unit",
        "Group",
        "Valid_N",
        "Mean_Live_Formula",
        "Mean_Value",
        "Median",
        "SD",
        "SE",
        "Min",
        "Max",
        "Q25",
        "Q75",
        "IQR",
    ]
    ws_gs.append(gs_headers)
    gs_data = comp_res.get("group_summaries", {})
    distinct_groups = gs_data.get("distinct_groups", [])
    by_trait = gs_data.get("by_trait", {})
    gs_row_idx = 2
    for t in comp_trait_defs:
        tid = t["Trait_ID"]
        tc_col = trait_col_letter_in_tc.get(tid, "C")
        t_summary = by_trait.get(tid, {}).get("groups", {})
        for grp in distinct_groups + ["ALL_SAMPLES"]:
            st = t_summary.get(grp, {})
            if grp == "ALL_SAMPLES":
                mean_formula = f"=IFERROR(AVERAGE(Trait_Calculations!{tc_col}$2:{tc_col}${n_samples+1}),0)"
            else:
                mean_formula = (
                    f'=IFERROR(SUMIF(Trait_Calculations!$B$2:$B${n_samples+1},"{grp}",'
                    f"Trait_Calculations!{tc_col}$2:{tc_col}${n_samples+1})/"
                    f'COUNTIF(Trait_Calculations!$B$2:$B${n_samples+1},"{grp}"),0)'
                )
            ws_gs.append([
                tid,
                t["Trait_Name"],
                t["Unit"],
                grp,
                st.get("valid_n", 0),
                mean_formula,
                st.get("mean"),
                st.get("median"),
                st.get("sd"),
                st.get("se"),
                st.get("min"),
                st.get("max"),
                st.get("q25"),
                st.get("q75"),
                st.get("iqr"),
            ])
            gs_row_idx += 1
    _style_worksheet_header(ws_gs, len(gs_headers))
    _auto_fit_columns(ws_gs)

    # ==================== SHEET 9: QC_Report ====================
    ws_qc = wb.create_sheet(title="QC_Report")
    ws_qc.append(["Check_Category", "Metric_or_Rule", "Status", "Details"])
    ws_qc.append(["Dataset Summary", "Total Samples", "OK", str(qc.get("total_samples", 0))])
    ws_qc.append(["Dataset Summary", "Total Glycan Features", "OK", str(qc.get("total_glycan_columns", 0))])
    ws_qc.append(["Dataset Summary", "Composition Parsing Success Rate (%)", "OK" if qc.get("parsing_success_rate_pct", 0) == 100 else "WARNING", f"{qc.get('parsing_success_rate_pct', 0):.2f}%"])
    ws_qc.append(["Dataset Summary", "Missing Values", "OK" if qc.get("missing_values_count", 0) == 0 else "WARNING", f"{qc.get('missing_values_count', 0)} ({qc.get('missing_values_pct', 0):.2f}%)"])
    ws_qc.append(["Dataset Summary", "Zero Values", "INFO", f"{qc.get('zero_values_count', 0)} ({qc.get('zero_values_pct', 0):.2f}%)"])
    ws_qc.append(["Dataset Summary", "Negative Values", "OK" if qc.get("negative_values_count", 0) == 0 else "ERROR", str(qc.get("negative_values_count", 0))])

    for chk in comp_res.get("scientific_validation", {}).get("checks", []):
        ws_qc.append([
            "Scientific Consistency Rule",
            f"{chk['rule_id']}: {chk['rule_name']}",
            "PASS" if chk["passed"] else "FAIL",
            chk["details"],
        ])

    for w in qc.get("warnings", []):
        ws_qc.append([
            f"QC Warning ({w.get('severity', 'warning').upper()})",
            w.get("category", ""),
            w.get("severity", "").upper(),
            w.get("message", ""),
        ])

    ws_qc.append(["", "", "", ""])
    ws_qc.append(["Sample_ID", "Group", "Working_Total_Abundance_Pct", "Zero_Count | Missing_Count | QC_Status"])
    for sq in qc.get("sample_qc_table", []):
        ws_qc.append([
            sq["sample_id"],
            sq["group"],
            sq["working_total_pct"],
            f"Zeros={sq['zero_count']} | Missing={sq['missing_count']} | Status={sq['qc_status']}",
        ])
    _style_worksheet_header(ws_qc, 4)
    _auto_fit_columns(ws_qc, max_width=70)

    # ==================== SHEET 10: Not_Derivable_Traits ====================
    ws_nd = wb.create_sheet(title="Not_Derivable_Traits")
    nd_headers = [
        "Trait_ID",
        "Trait_Name",
        "Status",
        "Reported_Value",
        "Scientific_Reason",
        "Required_Additional_Structural_Information",
    ]
    ws_nd.append(nd_headers)
    nd_list = struct_res.get("not_derivable_traits", [])
    if nd_list:
        for item in nd_list:
            ws_nd.append([
                item["trait_id"],
                item["trait_name"],
                "Not Derivable",
                NOT_DERIVABLE_TEXT,
                item["reason"],
                item["required_evidence"],
            ])
    else:
        for st in struct_res.get("trait_definitions", []):
            ws_nd.append([
                st["Trait_ID"],
                st["Trait_Name"],
                "Calculated (Validated Structure Provided)",
                "See Structure-Derived Results",
                st["Limitations"],
                ", ".join(st["Required_Components"]),
            ])
    _style_worksheet_header(ws_nd, len(nd_headers))
    _auto_fit_columns(ws_nd, max_width=65)

    # ==================== SHEET 11: Calculation_Provenance ====================
    ws_prov = wb.create_sheet(title="Calculation_Provenance")
    ws_prov.append(["Provenance_Field", "Recorded_Value"])
    prov_rows = [
        ("Software Name", APP_TITLE),
        ("Software Version", APP_VERSION),
        ("Calculation Engine Version", CALCULATION_ENGINE_VERSION),
        ("Component Mapping Version", COMPONENT_MAPPING_VERSION),
        ("Trait Definition Version", TRAIT_DEFINITION_VERSION),
        ("Input File Name", filename),
        ("Analysis Session Identifier", session_id),
        ("Date and Time (Local)", now_iso),
        ("Selected Measurement Type", qc.get("measurement_type_label", "")),
        ("Optional Closure Enabled", str(qc.get("apply_closure", False))),
        ("Normalization Applied", qc.get("normalization_applied", "")),
        ("Zero-Value Handling Policy", qc.get("zero_handling_label", "")),
        ("F Symbol Mapping Policy", "Confirmed Fucose (F)" if session_data.get("parser_config", {}).get("treat_f_as_fucose", True) else "Unspecified dHex"),
        ("S Symbol Mapping Policy", "Generic Sialic Acid (not assumed Neu5Ac)" if not session_data.get("parser_config", {}).get("assume_s_is_neuac", False) else "Mapped to Neu5Ac by user override"),
        ("Manual Composition Overrides Count", str(session_data.get("parser_config", {}).get("manual_overrides_count", 0))),
        ("User-Defined Custom Traits Count", str(len(engine.custom_traits))),
        ("Excluded Samples Count", str(len(qc.get("excluded_samples", [])))),
    ]
    for k_prov, v_prov in prov_rows:
        ws_prov.append([k_prov, v_prov])
    _style_worksheet_header(ws_prov, 2)
    _auto_fit_columns(ws_prov, max_width=70)

    out_stream = io.BytesIO()
    wb.save(out_stream)
    out_stream.seek(0)
    return out_stream.getvalue()


def generate_csv_zip_bytes(session_data: Dict[str, Any]) -> bytes:
    """Generate the 9-file ZIP CSV export package required by Section 17."""
    qc = session_data["qc_report"]
    comp_res = session_data["composition_results"]
    struct_res = session_data["structure_results"]
    engine = session_data["engine"]

    internal = qc["_internal"]
    sample_ids: List[str] = internal["sample_ids"]
    groups: List[str] = internal["groups"]
    glycan_cols: List[str] = internal["glycan_cols"]
    parsed_objects = internal["parsed_objects"]
    raw_matrix: np.ndarray = internal["raw_matrix"]
    working_matrix_pct: np.ndarray = internal["working_matrix_pct"]
    comp_trait_defs = comp_res.get("trait_definitions", [])
    inc_matrix = comp_res.get("inclusion_matrix", {})

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. Raw_Abundance.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Sample_ID", "Group"] + glycan_cols)
        for i, sid in enumerate(sample_ids):
            w.writerow([sid, groups[i]] + [
                "" if np.isnan(raw_matrix[i, k]) else f"{raw_matrix[i, k]:.6g}"
                for k in range(len(glycan_cols))
            ])
        zf.writestr("Raw_Abundance.csv", buf.getvalue())

        # 2. Composition_Map.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(COMPOSITION_MAP_HEADERS)
        for po in parsed_objects:
            flags = po.compute_reference_flags()
            w.writerow([
                po.raw_label, po.Hex, po.HexNAc, po.Fucose, po.Sialic_Acid, po.status,
                flags["High_Mannose_H5-H9N2"], flags["H4N2_pool"], flags["N3_pool_proxy"],
                flags["N4_pool"], flags["N5_pool"], flags["N6_pool"], flags["Nge4_complex_candidate"],
                flags["Fucosylated"], flags["Non_Fucosylated"], flags["Mono_Fucosylated"],
                flags["Di_Fucosylated"], flags["Multi_Fucosylated_Fge2"], flags["Sialylated"],
                flags["Sialylated_nonFucosylated"], flags["Sialylated_Fucosylated"],
                flags["Nge4_Fucosylated"], flags["Nge4_Sialylated"],
                flags["Hex_excess_over_3_in_Nge4"], flags["Nge7_pool"],
            ])
        zf.writestr("Composition_Map.csv", buf.getvalue())

        # 3. Trait_Definitions.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([
            "Trait_ID", "Trait_Name", "Category", "Mathematical_Formula",
            "Required_Components", "Inclusion_Criteria", "Exclusion_Criteria",
            "Numerator", "Denominator", "Unit", "Biological_Interpretation", "Limitations",
        ])
        for td in comp_trait_defs + struct_res.get("trait_definitions", []):
            w.writerow([
                td["Trait_ID"], td["Trait_Name"], td["Analytical_Category"], td["Plain_Formula"],
                "; ".join(td["Required_Components"]), td["Inclusion_Criteria"], td["Exclusion_Criteria"],
                td["Numerator_Definition"], td["Denominator_Definition"], td["Unit"],
                td["Interpretation"], td["Limitations"],
            ])
        zf.writestr("Trait_Definitions.csv", buf.getvalue())

        # 4. Trait_Calculations.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Sample_ID", "Group"] + [t["Trait_ID"] for t in comp_trait_defs])
        for sr in comp_res.get("sample_results", []):
            row = [sr["sample_id"], sr["group"]]
            for t in comp_trait_defs:
                val = sr["traits"].get(t["Trait_ID"])
                row.append("NA" if val is None else f"{val:.8f}")
            w.writerow(row)
        zf.writestr("Trait_Calculations.csv", buf.getvalue())

        # 5. Trait_Contributions.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([
            "Sample_ID", "Trait_ID", "Trait_Name", "Glycan", "Relative_Abundance",
            "Hex_Count", "HexNAc_Count", "Fucose_Count", "Sialic_Acid_Count",
            "Inclusion_Flag", "Contribution_Value", "Exclusion_Reason",
        ])
        for i, sid in enumerate(sample_ids):
            row_abund = working_matrix_pct[i, :]
            for t in comp_trait_defs:
                tid = t["Trait_ID"]
                tname = t["Trait_Name"]
                pg_map = inc_matrix.get(tid, {}).get("per_glycan", {})
                for k, g_lbl in enumerate(glycan_cols):
                    abund_val = float(row_abund[k]) if not np.isnan(row_abund[k]) else 0.0
                    g_info = pg_map.get(g_lbl, {})
                    inc_flag = 1 if g_info.get("included_in_numerator") else 0
                    w_num = float(g_info.get("numerator_weight", 0.0))
                    contrib_val = abund_val * w_num if inc_flag == 1 else 0.0
                    w.writerow([
                        sid, tid, tname, g_lbl, f"{abund_val:.6f}",
                        g_info.get("Hex", 0), g_info.get("HexNAc", 0),
                        g_info.get("Fucose", 0), g_info.get("Sialic_Acid", 0),
                        inc_flag, f"{contrib_val:.6f}",
                        "Included" if inc_flag == 1 else g_info.get("reason", "Excluded"),
                    ])
        zf.writestr("Trait_Contributions.csv", buf.getvalue())

        # 6. Group_Summary.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Trait_ID", "Trait_Name", "Unit", "Group", "Valid_N", "Mean", "Median", "SD", "SE", "Min", "Max", "IQR"])
        gs_data = comp_res.get("group_summaries", {})
        distinct_groups = gs_data.get("distinct_groups", [])
        by_trait = gs_data.get("by_trait", {})
        for t in comp_trait_defs:
            tid = t["Trait_ID"]
            t_summary = by_trait.get(tid, {}).get("groups", {})
            for grp in distinct_groups + ["ALL_SAMPLES"]:
                st = t_summary.get(grp, {})
                w.writerow([
                    tid, t["Trait_Name"], t["Unit"], grp, st.get("valid_n", 0),
                    "" if st.get("mean") is None else f"{st['mean']:.8f}",
                    "" if st.get("median") is None else f"{st['median']:.8f}",
                    "" if st.get("sd") is None else f"{st['sd']:.8f}",
                    "" if st.get("se") is None else f"{st['se']:.8f}",
                    "" if st.get("min") is None else f"{st['min']:.8f}",
                    "" if st.get("max") is None else f"{st['max']:.8f}",
                    "" if st.get("iqr") is None else f"{st['iqr']:.8f}",
                ])
        zf.writestr("Group_Summary.csv", buf.getvalue())

        # 7. QC_Report.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Category", "Metric_or_Rule", "Status", "Details"])
        for chk in comp_res.get("scientific_validation", {}).get("checks", []):
            w.writerow(["Scientific Validation", f"{chk['rule_id']}: {chk['rule_name']}", "PASS" if chk["passed"] else "FAIL", chk["details"]])
        for sq in qc.get("sample_qc_table", []):
            w.writerow(["Sample QC", sq["sample_id"], sq["qc_status"], f"Group={sq['group']}; Total={sq['working_total_pct']:.4f}%; Zeros={sq['zero_count']}; Missing={sq['missing_count']}"])
        zf.writestr("QC_Report.csv", buf.getvalue())

        # 8. Not_Derivable_Traits.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Trait_ID", "Trait_Name", "Status", "Reported_Value", "Scientific_Reason", "Required_Evidence"])
        for st in struct_res.get("trait_definitions", []):
            is_avail = struct_res.get("structural_data_available", False)
            w.writerow([
                st["Trait_ID"], st["Trait_Name"],
                "Calculated" if is_avail else "Not Derivable",
                "Calculated from validated structure" if is_avail else NOT_DERIVABLE_TEXT,
                st["Limitations"], ", ".join(st["Required_Components"]),
            ])
        zf.writestr("Not_Derivable_Traits.csv", buf.getvalue())

        # 9. Calculation_Provenance.csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Provenance_Field", "Value"])
        w.writerow(["Software_Version", APP_VERSION])
        w.writerow(["Calculation_Engine_Version", CALCULATION_ENGINE_VERSION])
        w.writerow(["Component_Mapping_Version", COMPONENT_MAPPING_VERSION])
        w.writerow(["Trait_Definition_Version", TRAIT_DEFINITION_VERSION])
        w.writerow(["Input_File", session_data.get("filename", "")])
        w.writerow(["Analysis_ID", session_data.get("session_id", "")])
        w.writerow(["Timestamp", datetime.datetime.now().isoformat()])
        w.writerow(["Measurement_Type", qc.get("measurement_type_label", "")])
        w.writerow(["Normalization_Applied", qc.get("normalization_applied", "")])
        w.writerow(["Zero_Handling", qc.get("zero_handling_label", "")])
        w.writerow(["Custom_Traits_Count", len(engine.custom_traits)])
        zf.writestr("Calculation_Provenance.csv", buf.getvalue())

    zip_buf.seek(0)
    return zip_buf.getvalue()


def generate_scientific_report_html(session_data: Dict[str, Any]) -> str:
    """Generate the complete GAREG Glycomic Trait Analysis Report in HTML format (Sections 15.1 - 15.7)."""
    qc = session_data["qc_report"]
    comp_res = session_data["composition_results"]
    struct_res = session_data["structure_results"]
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    filename = session_data.get("filename", "Dataset")

    comp_defs = comp_res.get("trait_definitions", [])
    inc_matrix = comp_res.get("inclusion_matrix", {})
    gs = comp_res.get("group_summaries", {})
    distinct_groups = gs.get("distinct_groups", [])
    by_trait = gs.get("by_trait", {})
    comparisons = comp_res.get("group_comparisons", [])

    # Build Section 15.3 Composition Table rows
    comp_rows_html = []
    for po in qc.get("parsed_compositions", []):
        comp_rows_html.append(
            f"<tr><td><strong>{po['raw_label']}</strong></td>"
            f"<td>{po['Hex']}</td><td>{po['HexNAc']}</td><td>{po['Fucose']}</td><td>{po['Sialic_Acid']}</td>"
            f"<td>{po['status']}</td><td>{po.get('sialic_acid_type_note', '')}</td></tr>"
        )

    # Build Section 15.4 Composition-Derived Trait Methodology rows
    meth_rows_html = []
    for td in comp_defs:
        tid = td["Trait_ID"]
        inc_g = ", ".join(inc_matrix.get(tid, {}).get("included_glycans", [])) or "None in current dataset"
        exc_g = ", ".join(inc_matrix.get(tid, {}).get("excluded_glycans", [])) or "None"
        meth_rows_html.append(f"""
        <div class="trait-card">
          <h4>{tid}: {td['Trait_Name']} <span class="badge">{td['Unit']}</span></h4>
          <p><strong>Mathematical Formula:</strong> <code>{td['Plain_Formula']}</code></p>
          <p><strong>Required Components:</strong> {', '.join(td['Required_Components'])} | <strong>Inclusion Rule:</strong> {td['Inclusion_Criteria']}</p>
          <p><strong>Numerator:</strong> {td['Numerator_Definition']} | <strong>Denominator:</strong> {td['Denominator_Definition']}</p>
          <p><strong>Included Glycans ({len(inc_matrix.get(tid, {}).get('included_glycans', []))}):</strong> <span class="mono">{inc_g}</span></p>
          <p><strong>Excluded Glycans ({len(inc_matrix.get(tid, {}).get('excluded_glycans', []))}):</strong> <span class="mono">{exc_g}</span></p>
          <p><strong>Biological Interpretation:</strong> {td['Interpretation']}</p>
          <p class="limit"><strong>Methodological Limitations:</strong> {td['Limitations']}</p>
        </div>
        """)

    # Build Section 15.6 Group Summary Table
    group_rows_html = []
    for td in comp_defs:
        tid = td["Trait_ID"]
        t_grp = by_trait.get(tid, {}).get("groups", {})
        for grp in distinct_groups + ["ALL_SAMPLES"]:
            st = t_grp.get(grp, {})
            mean_s = f"{st['mean']:.4f}" if st.get("mean") is not None else "NA"
            med_s = f"{st['median']:.4f}" if st.get("median") is not None else "NA"
            sd_s = f"{st['sd']:.4f}" if st.get("sd") is not None else "NA"
            iqr_s = f"{st['iqr']:.4f}" if st.get("iqr") is not None else "NA"
            group_rows_html.append(
                f"<tr><td>{tid}</td><td>{td['Trait_Name']}</td><td>{grp}</td>"
                f"<td>{st.get('valid_n', 0)}</td><td>{mean_s}</td><td>{med_s}</td>"
                f"<td>{sd_s}</td><td>{iqr_s}</td><td>{td['Unit']}</td></tr>"
            )

    # Build Scientific Validation Checks HTML
    val_rows_html = []
    for chk in comp_res.get("scientific_validation", {}).get("checks", []):
        status_cls = "pass" if chk["passed"] else "fail"
        val_rows_html.append(
            f"<tr><td>{chk['rule_id']}</td><td>{chk['rule_name']}</td>"
            f"<td class='{status_cls}'>{'PASS' if chk['passed'] else 'FAIL'}</td><td>{chk['details']}</td></tr>"
        )

    # Build Structural Traits status HTML
    struct_rows_html = []
    for st in struct_res.get("trait_definitions", []):
        avail_str = (
            "Calculated from validated structure"
            if struct_res.get("structural_data_available")
            else f"<strong style='color:#b45309;'>{NOT_DERIVABLE_TEXT}</strong>"
        )
        struct_rows_html.append(
            f"<tr><td>{st['Trait_ID']}</td><td>{st['Trait_Name']}</td><td>{avail_str}</td>"
            f"<td>{', '.join(st['Required_Components'])}</td><td>{st['Limitations']}</td></tr>"
        )

    # Build Statistical Associations for Section 15.7
    sig_traits = [
        c for c in comparisons
        if c.get("nonparametric_p") is not None and c["nonparametric_p"] < 0.05
    ]
    sig_summary = (
        ", ".join(f"{c['trait_id']} ({c['trait_name']}, p={c['nonparametric_p']:.4g})" for c in sig_traits[:8])
        if sig_traits else "No statistically significant group differences detected at p < 0.05 (or single-group study)."
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>GAREG Glycomic Trait Analysis Report</title>
  <style>
    body {{ font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; margin: 32px auto; max-width: 1140px; line-height: 1.55; background: #ffffff; }}
    h1 {{ color: #0f2b46; border-bottom: 3px solid #0284c7; padding-bottom: 10px; margin-bottom: 6px; }}
    h2 {{ color: #0f2b46; margin-top: 28px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; }}
    h3, h4 {{ color: #0369a1; margin: 8px 0; }}
    table {{ width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; vertical-align: top; }}
    th {{ background: #0f2b46; color: #ffffff; font-weight: 600; }}
    tr:nth-child(even) {{ background: #f8fafc; }}
    .grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
    .card {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 14px; }}
    .trait-card {{ background: #ffffff; border: 1px solid #cbd5e1; border-left: 4px solid #0284c7; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; font-size: 13px; }}
    .badge {{ background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 6px; }}
    .mono {{ font-family: Consolas, monospace; font-size: 12px; color: #334155; }}
    .limit {{ color: #9a3412; background: #fff7ed; padding: 6px 10px; border-radius: 4px; margin-top: 6px; }}
    .pass {{ color: #15803d; font-weight: 700; }}
    .fail {{ color: #b91c1c; font-weight: 700; }}
  </style>
</head>
<body>
  <h1>GAREG Glycomic Trait Analysis Report</h1>
  <p><strong>Platform:</strong> {APP_TITLE} (v{APP_VERSION}) &bull; <strong>Website:</strong> https://www.gareg.com.tr &bull; <strong>Generated:</strong> {now_str}</p>

  <h2>15.1. Study Overview</h2>
  <div class="card grid-2">
    <div>
      <p><strong>Project Name:</strong> {APP_TITLE}</p>
      <p><strong>Input File Name:</strong> {filename}</p>
      <p><strong>Analysis Date:</strong> {now_str}</p>
      <p><strong>Software &amp; Engine Version:</strong> v{APP_VERSION} / Engine v{CALCULATION_ENGINE_VERSION}</p>
    </div>
    <div>
      <p><strong>Total Biological Samples:</strong> {qc.get('total_samples', 0)} (Active: {qc.get('active_samples', 0)})</p>
      <p><strong>Experimental Groups ({len(distinct_groups)}):</strong> {', '.join(f'{k} (n={v})' for k, v in qc.get('group_distribution', {}).items())}</p>
      <p><strong>Identified Glycan Compositions:</strong> {qc.get('valid_glycan_count', 0)} / {qc.get('total_glycan_columns', 0)}</p>
      <p><strong>Measurement Type:</strong> {qc.get('measurement_type_label', '')}</p>
    </div>
  </div>

  <h2>15.2. Data Quality Control &amp; Scientific Validation</h2>
  <div class="card">
    <p><strong>Composition Parsing Success Rate:</strong> {qc.get('parsing_success_rate_pct', 0):.2f}% &bull;
       <strong>Missing Values:</strong> {qc.get('missing_values_count', 0)} ({qc.get('missing_values_pct', 0):.2f}%) &bull;
       <strong>Zero Values:</strong> {qc.get('zero_values_count', 0)} ({qc.get('zero_values_pct', 0):.2f}%) &bull;
       <strong>Negative Values:</strong> {qc.get('negative_values_count', 0)}</p>
    <p><strong>Normalization Policy:</strong> {qc.get('normalization_applied', '')}</p>
    <p><strong>Zero-Value Policy:</strong> {qc.get('zero_handling_label', '')}</p>
  </div>
  <table>
    <thead><tr><th>Rule ID</th><th>Scientific Validation Check</th><th>Status</th><th>Details</th></tr></thead>
    <tbody>{''.join(val_rows_html)}</tbody>
  </table>

  <h2>15.3. Glycan Composition Parsing</h2>
  <p>Standard dictionary: <code>H</code> = Hexose (Hex), <code>N</code> = N-acetylhexosamine (HexNAc), <code>F</code> = Fucose (Fuc), <code>S</code> = Sialic acid (type/linkage unspecified unless explicitly annotated).</p>
  <table>
    <thead><tr><th>Glycan Composition</th><th>Hex (H)</th><th>HexNAc (N)</th><th>Fucose (F)</th><th>Sialic Acid (S)</th><th>Parsing Status</th><th>Sialic Acid Subtype / Linkage Note</th></tr></thead>
    <tbody>{''.join(comp_rows_html)}</tbody>
  </table>

  <h2>15.4. Composition-Derived Trait Methodology</h2>
  <p>All composition-derived traits are calculated independently for each sample from relative abundance proportions and parsed monosaccharide counts:</p>
  {''.join(meth_rows_html)}

  <h2>15.5. Structure-Derived Trait Methodology &amp; Availability</h2>
  <p><strong>Strict Analytical Separation:</strong> Structure-derived traits require experimentally supported structural annotations (linkage positions, anomeric configuration, and branch topology). Composition-only datasets return <em>"{NOT_DERIVABLE_TEXT}"</em> rather than zero or estimated values.</p>
  <table>
    <thead><tr><th>Trait ID</th><th>Structural Trait Name</th><th>Availability in Current Dataset</th><th>Required Structural Evidence</th><th>Scientific Limitations</th></tr></thead>
    <tbody>{''.join(struct_rows_html)}</tbody>
  </table>

  <h2>15.6. Group-Level Summary Results</h2>
  <table>
    <thead><tr><th>Trait ID</th><th>Trait Name</th><th>Group</th><th>Valid N</th><th>Mean</th><th>Median</th><th>SD</th><th>IQR</th><th>Unit</th></tr></thead>
    <tbody>{''.join(group_rows_html)}</tbody>
  </table>

  <h2>15.7. Scientific Interpretation &amp; Epistemological Boundaries</h2>
  <div class="card">
    <p><strong>1. Directly Calculated Observations:</strong> Across {qc.get('total_samples', 0)} samples and {qc.get('valid_glycan_count', 0)} classified glycan compositions, sample-level total abundances (T01) and composition pools (T02–T28) were directly quantified from measured relative abundances.</p>
    <p><strong>2. Statistical Associations Across Groups:</strong> {sig_summary}</p>
    <p><strong>3. Exploratory Composition Proxies vs. Confirmed Structural Features:</strong>
      Traits T02 (High-mannose candidate pool H5–H9N2), T04 (N3 hybrid-compatible proxy), T08 (N&ge;4 complex-candidate pool), and T24–T25 (N&ge;4 Hexose excess above three) are <em>compositional proxies only</em>. They must never be reported as experimentally validated hybrid/complex topology, antennarity, or true galactosylation without orthogonal linkage/structural evidence.</p>
    <p><strong>4. Hypotheses Requiring Experimental Validation:</strong> Any observed shift in fucosylated (T09–T15), sialylated (T16–T21), or HexNAc (T05–T07, T26–T28) composition pools should be validated via linkage-specific derivatization, exoglycosidase digestion, or MS/MS fragmentation to distinguish core vs. antennary fucosylation, bisecting GlcNAc vs. branching, and &alpha;2,3 vs. &alpha;2,6 sialylation.</p>
  </div>
</body>
</html>"""
    return html


def generate_scientific_report_pdf_bytes(session_data: Dict[str, Any]) -> bytes:
    """Generate a publication-ready PDF report using ReportLab (Section 15)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    qc = session_data["qc_report"]
    comp_res = session_data["composition_results"]
    struct_res = session_data["structure_results"]
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    filename = session_data.get("filename", "Dataset")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("GaregTitle", parent=styles["Heading1"], fontSize=16, textColor=colors.HexColor("#0f2b46"), spaceAfter=8)
    h2_style = ParagraphStyle("GaregH2", parent=styles["Heading2"], fontSize=12, textColor=colors.HexColor("#0284c7"), spaceBefore=12, spaceAfter=6)
    body_style = ParagraphStyle("GaregBody", parent=styles["Normal"], fontSize=9, leading=12, spaceAfter=4)
    small_style = ParagraphStyle("GaregSmall", parent=styles["Normal"], fontSize=7.5, leading=10)

    story: List[Any] = []
    story.append(Paragraph("GAREG Glycomic Trait Analysis Report", title_style))
    story.append(Paragraph(f"<b>Platform:</b> {APP_TITLE} v{APP_VERSION} | <b>Date:</b> {now_str} | <b>File:</b> {filename}", body_style))
    story.append(Spacer(1, 8))

    # 15.1 Study Overview
    story.append(Paragraph("15.1. Study Overview & 15.2. Data Quality Control", h2_style))
    overview_data = [
        ["Metric", "Value", "Metric", "Value"],
        ["Total Samples", str(qc.get("total_samples", 0)), "Glycan Compositions", str(qc.get("valid_glycan_count", 0))],
        ["Experimental Groups", ", ".join(qc.get("distinct_groups", [])), "Parsing Success Rate", f"{qc.get('parsing_success_rate_pct', 0):.1f}%"],
        ["Measurement Type", qc.get("measurement_type_label", ""), "Missing / Zero Values", f"{qc.get('missing_values_count', 0)} / {qc.get('zero_values_count', 0)}"],
    ]
    t_ov = Table(overview_data, colWidths=[110, 150, 110, 150])
    t_ov.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f2b46")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_ov)

    # 15.3 Glycan Composition Parsing
    story.append(Paragraph("15.3. Glycan Composition Parsing Table", h2_style))
    comp_table_data = [["Glycan", "Hex (H)", "HexNAc (N)", "Fucose (F)", "Sialic Acid (S)", "Status"]]
    for po in qc.get("parsed_compositions", []):
        comp_table_data.append([
            str(po["raw_label"]), str(po["Hex"]), str(po["HexNAc"]),
            str(po["Fucose"]), str(po["Sialic_Acid"]), str(po["status"]),
        ])
    t_comp = Table(comp_table_data, colWidths=[110, 65, 75, 75, 85, 110], repeatRows=1)
    t_comp.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f2b46")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
    ]))
    story.append(t_comp)

    # 15.4 & 15.6 Group Summary & Methodology
    story.append(Paragraph("15.4 & 15.6. Composition-Derived Trait Definitions & Group Summaries", h2_style))
    gs = comp_res.get("group_summaries", {})
    distinct_groups = gs.get("distinct_groups", [])
    by_trait = gs.get("by_trait", {})
    sum_rows = [["ID", "Trait Name", "Group", "N", "Mean", "Median", "SD", "IQR"]]
    for td in comp_res.get("trait_definitions", []):
        tid = td["Trait_ID"]
        for grp in distinct_groups:
            st = by_trait.get(tid, {}).get("groups", {}).get(grp, {})
            sum_rows.append([
                tid,
                Paragraph(td["Trait_Name"], small_style),
                grp,
                str(st.get("valid_n", 0)),
                f"{st['mean']:.3f}" if st.get("mean") is not None else "NA",
                f"{st['median']:.3f}" if st.get("median") is not None else "NA",
                f"{st['sd']:.3f}" if st.get("sd") is not None else "NA",
                f"{st['iqr']:.3f}" if st.get("iqr") is not None else "NA",
            ])
    t_sum = Table(sum_rows, colWidths=[32, 188, 55, 25, 55, 55, 55, 55], repeatRows=1)
    t_sum.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f2b46")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t_sum)

    # 15.5 Structure-Derived Trait Status
    story.append(Paragraph("15.5. Structure-Derived Trait Status", h2_style))
    story.append(Paragraph(
        f"Structural data status: <b>{struct_res.get('status_message', NOT_DERIVABLE_TEXT)}</b>. "
        "Composition-derived estimates are never reported as experimentally confirmed structural traits.",
        body_style,
    ))

    # 15.7 Scientific Interpretation
    story.append(Paragraph("15.7. Scientific Interpretation & Limitations", h2_style))
    story.append(Paragraph(
        "1. <b>Directly Calculated Observations:</b> All 28 baseline composition-derived traits were evaluated at the individual sample level first and then summarized by group.<br/>"
        "2. <b>Exploratory Proxies vs. Confirmed Structures:</b> T02 (H5-H9N2 high-mannose candidate pool), T04 (N3 hybrid-compatible proxy), T08 (N>=4 complex-candidate pool), and T24-T25 (N>=4 Hexose excess above three) represent composition proxies only. Hexose excess above 3 must never be called true galactosylation.<br/>"
        "3. <b>Hypotheses Requiring Experimental Validation:</b> Resolving core vs. antennary fucosylation (S01/S02), bisecting GlcNAc (S03), true galactosylation (S04), confirmed antennarity (S07), and alpha2,3/alpha2,6 sialic acid linkage (S08) requires orthogonal linkage-specific structural evidence.",
        body_style,
    ))

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()

