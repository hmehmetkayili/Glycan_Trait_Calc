"""Comprehensive Unit Tests and Scientific Validation Suite for GAREG Glycomic Trait Analyzer.

Implements Section 21 (21, 21.1, 21.2) of the Specification:
1. Unit tests for known compositions (H5N4F1S2, H4N4F2, order-independence, unknown symbols, duplicate components).
2. Reference workbook validation against GAREG_Compositional_Glycan_Traits_Formula_Workbook.xlsx
   across all 37 glycans, 41 samples, 28 baseline traits (1,148 sample-trait values), and group summaries
   within < 1e-8 tolerance.
3. Edge-case validation: missing values, true zeros, negative/CLR values, unrecognized labels,
   duplicate compositions, zero denominators (returns NA, never 0), invalid totals,
   missing vs. validated structural annotations, F >= 3, S >= 3, N >= 7, Custom Trait Builder,
   11-sheet Excel export with live formulas, 9-file CSV ZIP export, and HTML/PDF report generation.
"""

from __future__ import annotations

import io
import os
import unittest
import zipfile
import numpy as np
import openpyxl
import pandas as pd

from glycan_trait_calc.core.composition_parser import GlycanCompositionParser
from glycan_trait_calc.core.trait_engine import (
    CompositionTraitEngine,
    build_custom_trait_definition,
)
from glycan_trait_calc.core.structure_engine import (
    StructureTraitEngine,
    StructuralSequenceParser,
    NOT_DERIVABLE_TEXT,
)
from glycan_trait_calc.core.qc_engine import run_quality_control, merge_sample_metadata
from glycan_trait_calc.core.export_engine import (
    generate_excel_workbook_bytes,
    generate_csv_zip_bytes,
    generate_scientific_report_html,
    generate_scientific_report_pdf_bytes,
)


class TestGaregScientificValidation(unittest.TestCase):
    """Test suite verifying mathematical accuracy, transparency, and edge-case rigor."""

    def setUp(self) -> None:
        self.parser = GlycanCompositionParser()
        self.engine = CompositionTraitEngine(include_optional=True)
        self.ref_workbook_path = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "../data/GAREG_Compositional_Glycan_Traits_Formula_Workbook.xlsx",
            )
        )

    def test_01_h5n4f1s2_known_composition_and_contributions(self) -> None:
        """Section 5.1, 8.1, & 21: Verify H5N4F1S2 parsing, inclusion flags, and 3.2% contributions."""
        comp = self.parser.parse("H5N4F1S2")
        self.assertTrue(comp.is_valid)
        self.assertEqual(comp.Hex, 5)
        self.assertEqual(comp.HexNAc, 4)
        self.assertEqual(comp.Fucose, 1)
        self.assertEqual(comp.Sialic_Acid, 2)

        flags = comp.compute_reference_flags()
        self.assertEqual(flags["N3_pool_proxy"], 0)
        self.assertEqual(flags["N4_pool"], 1)
        self.assertEqual(flags["N5_pool"], 0)
        self.assertEqual(flags["N6_pool"], 0)
        self.assertEqual(flags["Nge4_complex_candidate"], 1)
        self.assertEqual(flags["Fucosylated"], 1)
        self.assertEqual(flags["Mono_Fucosylated"], 1)
        self.assertEqual(flags["Di_Fucosylated"], 0)
        self.assertEqual(flags["Sialylated"], 1)
        self.assertEqual(flags["Sialylated_Fucosylated"], 1)
        self.assertEqual(flags["Nge4_Fucosylated"], 1)
        self.assertEqual(flags["Nge4_Sialylated"], 1)
        self.assertEqual(flags["Hex_excess_over_3_in_Nge4"], 2)

        # Verify contribution explanation at 3.2% abundance (Section 8.1)
        expl = self.engine.explain_single_glycan_across_traits("H5N4F1S2", abundance_pct=3.2, parser=self.parser)
        contrib_by_id = {r["trait_id"]: r for r in expl["trait_contributions"]}
        self.assertAlmostEqual(contrib_by_id["T05"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T08"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T09"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T11"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T12"]["numerator_contribution"], 0.0, places=10)
        self.assertAlmostEqual(contrib_by_id["T16"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T18"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T15"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T21"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T13"]["numerator_contribution"], 3.2, places=10)
        self.assertAlmostEqual(contrib_by_id["T19"]["numerator_contribution"], 6.4, places=10)
        self.assertAlmostEqual(contrib_by_id["T24"]["numerator_contribution"], 6.4, places=10)

    def test_02_parser_order_independence_and_edge_cases(self) -> None:
        """Section 5.2: Order independence, missing components = 0, duplicate rejection, unknown symbol detection."""
        c1 = self.parser.parse("H4N4F2")
        self.assertTrue(c1.is_valid)
        self.assertEqual((c1.Hex, c1.HexNAc, c1.Fucose, c1.Sialic_Acid), (4, 4, 2, 0))

        # Order-independent equivalence
        c2 = self.parser.parse("F1S2N4H5")
        self.assertTrue(c2.is_valid)
        self.assertEqual(c2.normalized_label, "H5N4F1S2")
        self.assertEqual((c2.Hex, c2.HexNAc, c2.Fucose, c2.Sialic_Acid), (5, 4, 1, 2))

        # Extended notation (NeuAc, NeuGc) without assuming generic S is NeuAc
        c_gen = self.parser.parse("H5N4S1")
        self.assertEqual(c_gen.S_generic, 1)
        self.assertEqual(c_gen.NeuAc, 0)
        self.assertEqual(c_gen.Sialic_Acid, 1)

        c_neu = self.parser.parse("H5N4NeuAc1NeuGc1F1")
        self.assertTrue(c_neu.is_valid)
        self.assertEqual(c_neu.NeuAc, 1)
        self.assertEqual(c_neu.NeuGc, 1)
        self.assertEqual(c_neu.Sialic_Acid, 2)

        # Duplicate component detection
        c_dup = self.parser.parse("H5N4H2")
        self.assertFalse(c_dup.is_valid)
        self.assertEqual(c_dup.status, "invalid_duplicate_component")
        self.assertIn("Hex", c_dup.duplicate_components)

        # Unknown symbol detection
        c_unk = self.parser.parse("H5N4X2")
        self.assertFalse(c_unk.is_valid)
        self.assertEqual(c_unk.status, "invalid_unknown_symbol")
        self.assertIn("X", c_unk.unknown_symbols)

        # Zero total residue rejection vs valid missing components
        c_zero = self.parser.parse("H0N0F0S0")
        self.assertFalse(c_zero.is_valid)
        self.assertEqual(c_zero.status, "invalid_zero_total")

    def test_03_reference_workbook_exact_validation(self) -> None:
        """Section 21.1: Validate all 28 baseline traits, 41 samples, 37 glycans, and group summaries against reference workbook."""
        self.assertTrue(os.path.exists(self.ref_workbook_path), "Reference workbook must exist in data/.")
        wb = openpyxl.load_workbook(self.ref_workbook_path, data_only=True)
        ws_raw = wb["Raw_Data"]
        ws_map = wb["Composition_Map"]
        ws_tc = wb["Trait_Calculations"]
        ws_gs = wb["Group_Summary"]

        glycans = [ws_raw.cell(1, c).value for c in range(3, 40)]
        sample_ids = [ws_raw.cell(r, 1).value for r in range(2, 43)]
        groups = [ws_raw.cell(r, 2).value for r in range(2, 43)]
        abund = np.array(
            [[float(ws_raw.cell(r, c).value) for c in range(3, 40)] for r in range(2, 43)],
            dtype=float,
        )

        parsed = [self.parser.parse(g) for g in glycans]

        # 1. Verify all 37 glycans x 20 columns in Composition_Map
        ref_flag_cols = [
            "High_Mannose_H5-H9N2", "H4N2_pool", "N3_pool_proxy", "N4_pool", "N5_pool",
            "N6_pool", "Nge4_complex_candidate", "Fucosylated", "Mono_Fucosylated",
            "Di_Fucosylated", "Sialylated", "Sialylated_nonFucosylated",
            "Sialylated_Fucosylated", "Nge4_Fucosylated", "Nge4_Sialylated",
            "Hex_excess_over_3_in_Nge4",
        ]
        for idx, p in enumerate(parsed):
            r = idx + 2
            self.assertEqual(p.raw_label, ws_map.cell(r, 1).value)
            self.assertEqual(p.Hex, ws_map.cell(r, 2).value)
            self.assertEqual(p.HexNAc, ws_map.cell(r, 3).value)
            self.assertEqual(p.Fucose, ws_map.cell(r, 4).value)
            self.assertEqual(p.Sialic_Acid, ws_map.cell(r, 5).value)
            flags = p.compute_reference_flags()
            for c_offset, key in enumerate(ref_flag_cols):
                ref_val = ws_map.cell(r, 6 + c_offset).value
                self.assertEqual(flags[key], ref_val, f"Mismatch at {p.raw_label} {key}")

        # 2. Verify all 41 samples x 28 baseline traits (1,148 values) within 1e-8 tolerance
        res = self.engine.calculate_all(sample_ids, groups, glycans, abund, parsed)
        for i, sr in enumerate(res["sample_results"]):
            r = i + 2
            for t_idx in range(1, 29):
                tid = f"T{t_idx:02d}"
                calc_val = sr["traits"][tid]
                ref_val = float(ws_tc.cell(r, 2 + t_idx).value)
                self.assertIsNotNone(calc_val)
                self.assertLess(
                    abs(calc_val - ref_val),
                    1e-8,
                    f"Sample {sr['sample_id']} {tid} diff exceeds 1e-8: {calc_val} vs {ref_val}",
                )

        # 3. Verify Group_Summary means for CDH and LDH within 1e-8 tolerance
        for r, grp_name in [(2, "CDH"), (3, "LDH")]:
            for t_idx in range(1, 29):
                tid = f"T{t_idx:02d}"
                calc_mean = res["group_summaries"]["by_trait"][tid]["groups"][grp_name]["mean"]
                ref_mean = float(ws_gs.cell(r, 2 + t_idx).value)
                self.assertLess(
                    abs(calc_mean - ref_mean),
                    1e-8,
                    f"Group {grp_name} {tid} diff exceeds 1e-8: {calc_mean} vs {ref_mean}",
                )

        # 4. Verify all 9 scientific validation rules pass on reference dataset
        self.assertTrue(res["scientific_validation"]["all_passed"])

    def test_04_edge_cases_zero_denominators_f_ge_3_s_ge_3_n_ge_7(self) -> None:
        """Section 21.2: Test zero denominators (NA, never 0), F >= 3, S >= 3, and N >= 7."""
        glycans = ["H5N2", "H6N2", "H6N4F3S3", "H8N7F1S2"]
        parsed = [self.parser.parse(g) for g in glycans]
        sample_ids = ["S_OnlyHighMannose", "S_Extended"]
        groups = ["G1", "G1"]
        # Sample 1 has ONLY H5N2 (50%) and H6N2 (50%) -> N>=4 pool (T08) is 0!
        # So T15, T21, T25, T26, T27, T28 MUST return None (NA), NEVER 0!
        abund = np.array([
            [50.0, 50.0, 0.0, 0.0],
            [10.0, 10.0, 40.0, 40.0],
        ], dtype=float)

        res = self.engine.calculate_all(sample_ids, groups, glycans, abund, parsed)
        s1_traits = res["sample_results"][0]["traits"]
        self.assertAlmostEqual(s1_traits["T08"], 0.0)
        for ratio_tid in ("T15", "T21", "T25", "T26", "T27", "T28"):
            self.assertIsNone(
                s1_traits[ratio_tid],
                f"{ratio_tid} must be None (NA) when denominator T08 is 0, not {s1_traits[ratio_tid]}",
            )

        # Sample 2 has H6N4F3S3 (40%) and H8N7F1S2 (40%):
        # F >= 3 exists -> T09 = 80%, T11 (F=1) = 40%, T12 (F=2) = 0% -> T11 + T12 = 40% < T09 (80%)
        # T12b (F>=2) = 40%
        # N >= 7 exists -> T08 = 80%, T05 (N=4) = 40%, T06 = 0%, T07 = 0%, T08b (N>=7) = 40%
        # T26 + T27 + T28 = 50% < 100%
        s2_traits = res["sample_results"][1]["traits"]
        self.assertAlmostEqual(s2_traits["T09"], 80.0)
        self.assertAlmostEqual(s2_traits["T11"], 40.0)
        self.assertAlmostEqual(s2_traits["T12"], 0.0)
        self.assertAlmostEqual(s2_traits["T12b"], 40.0)
        self.assertAlmostEqual(s2_traits["T08"], 80.0)
        self.assertAlmostEqual(s2_traits["T08b"], 40.0)
        self.assertAlmostEqual(s2_traits["T26"], 50.0)
        self.assertTrue(res["scientific_validation"]["has_f_ge_3"])
        self.assertTrue(res["scientific_validation"]["has_n_ge_7"])
        self.assertTrue(res["scientific_validation"]["all_passed"])

    def test_05_negative_and_clr_blocking_and_metadata_matching(self) -> None:
        """Section 4 & 12.1: Block CLR/negative values and test Sample_ID metadata merging."""
        df_clr = pd.DataFrame({
            "Sample_ID": ["S1", "S2"],
            "Group": ["Ctrl", "Case"],
            "H5N2": [-1.25, 0.85],
            "H5N4F1S1": [1.25, -0.85],
        })
        qc = run_quality_control(
            df=df_clr,
            sample_id_col="Sample_ID",
            group_col="Group",
            glycan_cols=["H5N2", "H5N4F1S1"],
            measurement_type="clr_transformed",
        )
        self.assertTrue(qc["is_clr_blocked"])
        self.assertGreater(len(qc["blocking_errors"]), 0)

        # Test separate metadata matching
        df_abund = pd.DataFrame({
            "Sample_ID": ["S1", "S2"],
            "H5N2": [40.0, 60.0],
            "H5N4F1": [60.0, 40.0],
        })
        df_meta = pd.DataFrame({
            "Sample_ID": ["S2", "S1"],
            "Group": ["Cancer", "Control"],
            "Age": [64, 51],
        })
        merged, report = merge_sample_metadata(df_abund, df_meta, "Sample_ID")
        self.assertEqual(report["matched_samples_count"], 2)
        self.assertEqual(list(merged["Group"]), ["Control", "Cancer"])
        self.assertEqual(list(merged["Age"]), [51, 64])

    def test_06_structural_traits_separation_and_validated_parsers(self) -> None:
        """Section 9: Composition-only returns 'Not derivable'; IUPAC/GlycoCT/WURCS calculate S01-S08."""
        struct_engine = StructureTraitEngine()
        glycans = ["H5N4F1S1", "H4N5S1F2"]
        abund = np.array([[60.0, 40.0]], dtype=float)

        # 1. Composition-only mode: MUST return Not derivable (never 0)
        res_comp_only = struct_engine.calculate_structural_traits(
            sample_ids=["S1"],
            groups=["Control"],
            glycan_labels=glycans,
            abundance_matrix_pct=abund,
            structural_annotations={},
        )
        self.assertFalse(res_comp_only["structural_data_available"])
        self.assertEqual(res_comp_only["status_message"], NOT_DERIVABLE_TEXT)
        for tid, val in res_comp_only["sample_results"][0]["traits"].items():
            self.assertIsNone(val, f"Structural trait {tid} must be None (not 0) for composition-only data.")
            self.assertEqual(res_comp_only["sample_results"][0]["display_traits"][tid], NOT_DERIVABLE_TEXT)

        # 2. Validated IUPAC-condensed parser mode
        ann1 = StructuralSequenceParser.parse_sequence(
            glycan_id="H5N4F1S1",
            sequence="Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc",
        )
        self.assertTrue(ann1.has_validated_structure)
        self.assertTrue(ann1.core_fucosylated)
        self.assertFalse(ann1.antennary_fucosylated)
        self.assertFalse(ann1.bisecting_glcnac)
        self.assertEqual(ann1.galactose_count, 2)
        self.assertEqual(ann1.structural_class, "Complex")
        self.assertEqual(ann1.antenna_count, 2)
        self.assertEqual(ann1.alpha2_6_sialic_count, 1)
        self.assertEqual(ann1.alpha2_3_sialic_count, 0)

        ann2 = StructuralSequenceParser.parse_sequence(
            glycan_id="H4N5S1F2",
            sequence="Neu5Ac(a2-3)Gal(b1-4)[Fuc(a1-3)]GlcNAc(b1-2)Man(a1-6)[GlcNAc(b1-2)Man(a1-3)][GlcNAc(b1-4)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc",
        )
        self.assertTrue(ann2.has_validated_structure)
        self.assertTrue(ann2.core_fucosylated)
        self.assertTrue(ann2.antennary_fucosylated)
        self.assertTrue(ann2.bisecting_glcnac)
        self.assertEqual(ann2.galactose_count, 1)
        self.assertEqual(ann2.antenna_count, 2)
        self.assertEqual(ann2.alpha2_3_sialic_count, 1)

        res_struct = struct_engine.calculate_structural_traits(
            sample_ids=["S1"],
            groups=["Control"],
            glycan_labels=glycans,
            abundance_matrix_pct=abund,
            structural_annotations={"H5N4F1S1": ann1, "H4N5S1F2": ann2},
        )
        self.assertTrue(res_struct["structural_data_available"])
        st = res_struct["sample_results"][0]["traits"]
        self.assertAlmostEqual(st["S01"], 100.0)   # Both have core fucose
        self.assertAlmostEqual(st["S02"], 40.0)    # Only H4N5S1F2 has antennary fucose
        self.assertAlmostEqual(st["S03"], 40.0)    # Only H4N5S1F2 has bisecting GlcNAc
        self.assertAlmostEqual(st["S04"], 100.0)   # Both galactosylated
        self.assertAlmostEqual(st["S07_Bi"], 100.0)  # Both confirmed biantennary (even though H4N5S1F2 is N5!)
        self.assertAlmostEqual(st["S07_Tri"], 0.0)
        self.assertAlmostEqual(st["S08_a23"], 40.0)
        self.assertAlmostEqual(st["S08_a26"], 60.0)

    def test_07_custom_trait_builder_and_exports(self) -> None:
        """Section 16, 17, 18: Verify Custom Trait Builder and 11-sheet Excel / 9-CSV ZIP / HTML / PDF exports."""
        # Reject invalid structural claim from composition-only custom trait builder
        with self.assertRaises(ValueError):
            build_custom_trait_definition(
                trait_id="U01",
                trait_name="Confirmed Core Fucosylation",
                inclusion_clauses=[{"component": "Fucose", "operator": "=", "value": 1}],
            )

        # Valid custom trait: S >= 1 and F = 0
        custom_td = build_custom_trait_definition(
            trait_id="U01",
            trait_name="Afucosylated Sialylated Pool",
            inclusion_clauses=[
                {"component": "Sialic_Acid", "operator": ">=", "value": 1},
                {"component": "Fucose", "operator": "=", "value": 0},
            ],
        )
        self.assertEqual(custom_td.Trait_ID, "U01")
        self.assertTrue(custom_td.Is_Custom)

        # Test full export pipeline on small dataset
        df = pd.DataFrame({
            "Sample_ID": ["S1", "S2"],
            "Group": ["Control", "Disease"],
            "H5N2": [20.0, 10.0],
            "H4N4F1": [50.0, 40.0],
            "H5N4S1F1": [30.0, 50.0],
        })
        qc = run_quality_control(df, "Sample_ID", "Group", ["H5N2", "H4N4F1", "H5N4S1F1"])
        internal = qc["_internal"]
        comp_res = self.engine.calculate_all(
            internal["sample_ids"],
            internal["groups"],
            internal["glycan_cols"],
            internal["working_matrix_pct"],
            internal["parsed_objects"],
        )
        struct_res = StructureTraitEngine().calculate_structural_traits(
            internal["sample_ids"],
            internal["groups"],
            internal["glycan_cols"],
            internal["working_matrix_pct"],
            {},
        )
        session_data = {
            "session_id": "TEST-SESSION",
            "filename": "test.xlsx",
            "qc_report": qc,
            "composition_results": comp_res,
            "structure_results": struct_res,
            "engine": self.engine,
            "parser_config": self.parser.get_configuration_summary(),
        }

        xlsx_bytes = generate_excel_workbook_bytes(session_data)
        wb_out = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
        expected_sheets = [
            "Read_Me",
            "Raw_Abundance",
            "Composition_Map",
            "Structural_Annotations",
            "Trait_Definitions",
            "Trait_Calculations",
            "Trait_Contributions",
            "Group_Summary",
            "QC_Report",
            "Not_Derivable_Traits",
            "Calculation_Provenance",
        ]
        self.assertEqual(wb_out.sheetnames, expected_sheets)
        # Verify live Excel formulas in Trait_Calculations
        tc_formula = str(wb_out["Trait_Calculations"].cell(2, 4).value)
        self.assertTrue(tc_formula.startswith("=SUM("), f"Expected live Excel formula, got {tc_formula}")

        zip_bytes = generate_csv_zip_bytes(session_data)
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            expected_csvs = {
                "Raw_Abundance.csv",
                "Composition_Map.csv",
                "Trait_Definitions.csv",
                "Trait_Calculations.csv",
                "Trait_Contributions.csv",
                "Group_Summary.csv",
                "QC_Report.csv",
                "Not_Derivable_Traits.csv",
                "Calculation_Provenance.csv",
            }
            self.assertEqual(set(zf.namelist()), expected_csvs)

        html_report = generate_scientific_report_html(session_data)
        self.assertIn("GAREG Glycomic Trait Analysis Report", html_report)
        pdf_bytes = generate_scientific_report_pdf_bytes(session_data)
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))

    def test_08_fastapi_end_to_end_routes(self) -> None:
        """Verify FastAPI endpoints (/api/health, /api/data/demo, /api/traits/contributions, /api/export/*)."""
        from fastapi.testclient import TestClient
        from glycan_trait_calc.main import app

        client = TestClient(app)
        r_health = client.get("/api/health")
        self.assertEqual(r_health.status_code, 200)
        self.assertEqual(r_health.json()["status"], "healthy")

        # Load reference demo dataset (composition-only mode)
        r_demo = client.post("/api/data/demo?include_structural_demo=false")
        self.assertEqual(r_demo.status_code, 200)
        summary = r_demo.json()
        sid = summary["session_id"]
        self.assertEqual(summary["dashboard_metrics"]["total_samples"], 41)
        self.assertEqual(summary["dashboard_metrics"]["identified_glycan_compositions"], 37)
        self.assertFalse(summary["structure_results"]["structural_data_available"])

        # Inspect interactive trait contribution audit trail for T09
        r_audit = client.get(f"/api/traits/contributions?session_id={sid}&trait_id=T09")
        self.assertEqual(r_audit.status_code, 200)
        audit = r_audit.json()
        self.assertEqual(audit["trait"]["Trait_ID"], "T09")
        self.assertGreater(len(audit["contributions"]), 0)

        # Load demo with structural annotations
        r_demo_struct = client.post("/api/data/demo?include_structural_demo=true")
        self.assertEqual(r_demo_struct.status_code, 200)
        self.assertTrue(r_demo_struct.json()["structure_results"]["structural_data_available"])

        # Export Excel, CSV ZIP, HTML & PDF report via HTTP API
        r_xlsx = client.post("/api/export/excel", json={"session_id": sid})
        self.assertEqual(r_xlsx.status_code, 200)
        self.assertGreater(len(r_xlsx.content), 5000)

        r_zip = client.post("/api/export/csv", json={"session_id": sid})
        self.assertEqual(r_zip.status_code, 200)
        self.assertGreater(len(r_zip.content), 2000)

        r_pdf = client.post("/api/export/report", json={"session_id": sid, "format": "pdf"})
        self.assertEqual(r_pdf.status_code, 200)
        self.assertTrue(r_pdf.content.startswith(b"%PDF"))

    def test_09_paucimannose_classification_and_literature_compliance(self) -> None:
        """Verify Paucimannose-type N-glycans (H1-H4N2F0-1) in T03 and StructuralSequenceParser."""
        pauci_labels = ["H2N2", "H3N2", "H4N2", "H2N2F1", "H3N2F1", "H4N2F1"]
        for lbl in pauci_labels:
            p = self.parser.parse(lbl)
            self.assertTrue(p.is_valid)
            flags = p.compute_reference_flags()
            self.assertEqual(flags["Paucimannose_pool"], 1, f"{lbl} should be Paucimannose_pool=1")
            self.assertEqual(flags["High_Mannose_H5-H9N2"], 0, f"{lbl} should not be High_Mannose_H5-H9N2")

        hm_labels = ["H5N2", "H6N2", "H7N2", "H8N2", "H9N2"]
        for lbl in hm_labels:
            p = self.parser.parse(lbl)
            flags = p.compute_reference_flags()
            self.assertEqual(flags["High_Mannose_H5-H9N2"], 1, f"{lbl} should be High_Mannose_H5-H9N2=1")
            self.assertEqual(flags["Paucimannose_pool"], 0, f"{lbl} should not be Paucimannose_pool")

        # Calculate T03 on a sample containing H3N2 (2%), H3N2F1 (3%), H4N2 (4%), H5N2 (11%), H4N4F1 (80%)
        glycans = ["H3N2", "H3N2F1", "H4N2", "H5N2", "H4N4F1"]
        parsed = [self.parser.parse(g) for g in glycans]
        abund = np.array([[2.0, 3.0, 4.0, 11.0, 80.0]], dtype=float)
        res = self.engine.calculate_all(["S_Pauci"], ["Control"], glycans, abund, parsed)
        traits = res["sample_results"][0]["traits"]
        self.assertAlmostEqual(traits["T03"], 9.0, places=8)   # 2 + 3 + 4 = 9% Paucimannose
        self.assertAlmostEqual(traits["T02"], 11.0, places=8)  # 11% High-Mannose
        self.assertAlmostEqual(traits["T08"], 80.0, places=8)  # 80% Complex-Candidate
        self.assertAlmostEqual(traits["T02"] + traits["T03"] + traits["T04"] + traits["T08"], traits["T01"], places=8)

        # Verify StructuralSequenceParser distinguishes Paucimannose vs High-Mannose
        ann_h3n2f1 = StructuralSequenceParser.parse_sequence(
            glycan_id="H3N2F1",
            sequence="Man(a1-6)[Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc",
        )
        self.assertEqual(ann_h3n2f1.structural_class, "Paucimannose")
        self.assertTrue(ann_h3n2f1.core_fucosylated)
        self.assertEqual(ann_h3n2f1.antenna_count, 0)

        ann_h4n2 = StructuralSequenceParser.parse_sequence(
            glycan_id="H4N2",
            sequence="Man(a1-6)[Man(a1-3)]Man(a1-6)Man(b1-4)GlcNAc(b1-4)GlcNAc",
        )
        self.assertEqual(ann_h4n2.structural_class, "Paucimannose")
        self.assertEqual(ann_h4n2.antenna_count, 0)

        ann_h5n2 = StructuralSequenceParser.parse_sequence(
            glycan_id="H5N2",
            sequence="Man(a1-6)[Man(a1-3)]Man(a1-6)[Man(a1-3)]Man(b1-4)GlcNAc(b1-4)GlcNAc",
        )
        self.assertEqual(ann_h5n2.structural_class, "High-Mannose")
        self.assertEqual(ann_h5n2.antenna_count, 0)


if __name__ == "__main__":
    unittest.main()

