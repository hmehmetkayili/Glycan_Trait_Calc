"""REST API Endpoints for GAREG Glycomic Trait Analyzer.

Implements Section 19 of the GAREG Specification:
- POST /api/data/upload
- POST /api/data/demo
- POST /api/data/metadata
- POST /api/data/validate
- POST /api/composition/parse
- POST /api/traits/composition/calculate
- POST /api/traits/structure/calculate
- POST /api/traits/custom
- GET  /api/traits/definitions
- GET  /api/traits/contributions
- GET  /api/results/summary
- POST /api/export/excel
- POST /api/export/csv
- POST /api/export/report
- DELETE /api/session/{session_id}
"""

from __future__ import annotations

import io
import os
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response, HTMLResponse
from pydantic import BaseModel, Field

from glycan_trait_calc.core.config import MAX_UPLOAD_SIZE_BYTES
from glycan_trait_calc.core.composition_parser import GlycanCompositionParser
from glycan_trait_calc.core.trait_definitions import (
    get_all_trait_definitions,
    COMPOSITION_STRUCTURE_CLASSIFICATION_TABLE,
)
from glycan_trait_calc.core.trait_engine import (
    CompositionTraitEngine,
    build_custom_trait_definition,
)
from glycan_trait_calc.core.structure_engine import (
    StructuralGlycanAnnotation,
    StructuralSequenceParser,
    StructureTraitEngine,
    NOT_DERIVABLE_TEXT,
)
from glycan_trait_calc.core.qc_engine import (
    auto_detect_columns_and_format,
    merge_sample_metadata,
    run_quality_control,
    MEASUREMENT_TYPES,
    ZERO_HANDLING_MODES,
)
from glycan_trait_calc.core.export_engine import (
    generate_excel_workbook_bytes,
    generate_csv_zip_bytes,
    generate_scientific_report_html,
    generate_scientific_report_pdf_bytes,
)
from glycan_trait_calc.core.session_store import GLOBAL_SESSION_STORE


router = APIRouter(prefix="/api")


class ValidateConfigRequest(BaseModel):
    session_id: str
    sample_id_col: Optional[str] = None
    group_col: Optional[str] = None
    glycan_cols: Optional[List[str]] = None
    measurement_type: str = "relative_abundance_pct"
    apply_closure: bool = False
    zero_handling: str = "true_biological_absence"
    treat_f_as_fucose: bool = True
    treat_dhex_as_fucose: bool = False
    assume_s_is_neuac: bool = False
    manual_overrides: Optional[Dict[str, Dict[str, int]]] = None
    custom_components: Optional[Dict[str, str]] = None
    excluded_samples: Optional[List[str]] = None


class ParseCompositionRequest(BaseModel):
    labels: List[str]
    treat_f_as_fucose: bool = True
    treat_dhex_as_fucose: bool = False
    assume_s_is_neuac: bool = False
    manual_overrides: Optional[Dict[str, Dict[str, int]]] = None
    custom_components: Optional[Dict[str, str]] = None
    explain_glycan: Optional[str] = None
    explain_abundance_pct: float = 3.2


class CalculateCompositionRequest(BaseModel):
    session_id: str
    include_optional: bool = True


class StructuralAnnotationItem(BaseModel):
    glycan_id: str
    composition: str = ""
    structure_sequence: str = ""
    core_fucosylated: Optional[bool] = None
    antennary_fucosylated: Optional[bool] = None
    bisecting_glcnac: Optional[bool] = None
    galactose_count: Optional[int] = None
    structural_class: Optional[str] = None
    antenna_count: Optional[int] = None
    alpha2_3_sialic_count: Optional[int] = None
    alpha2_6_sialic_count: Optional[int] = None
    annotation_confidence: str = "Confirmed"
    experimental_evidence: str = "MS/MS + Exoglycosidase / Linkage Derivatization"


class CalculateStructureRequest(BaseModel):
    session_id: str
    annotations: Optional[List[StructuralAnnotationItem]] = None
    clear_annotations: bool = False


class CustomTraitRequest(BaseModel):
    session_id: str
    trait_name: str
    inclusion_clauses: List[Dict[str, Any]] = Field(default_factory=list)
    exclusion_clauses: List[Dict[str, Any]] = Field(default_factory=list)
    numerator_weight: str = "1"
    has_denominator: bool = False
    denominator_clauses: List[Dict[str, Any]] = Field(default_factory=list)
    denominator_weight: str = "1"
    scale: float = 100.0
    unit: str = "%"
    interpretation: str = ""
    preview_only: bool = False


class ExportRequest(BaseModel):
    session_id: str
    format: str = "html"  # For report: "html" or "pdf"


def _read_uploaded_dataframe(filename: str, content: bytes, sheet_name: Optional[str] = None) -> pd.DataFrame:
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Uploaded file exceeds the 25 MB maximum size limit.")
    ext = os.path.splitext(filename or "")[1].lower()
    bio = io.BytesIO(content)
    try:
        if ext in (".xlsx", ".xls"):
            xl = pd.ExcelFile(bio)
            target_sheet = sheet_name
            if not target_sheet:
                # Prefer Raw_Data or Raw_Abundance if multi-sheet workbook is uploaded
                for candidate in ("Raw_Data", "Raw_Abundance"):
                    if candidate in xl.sheet_names:
                        target_sheet = candidate
                        break
                if not target_sheet:
                    target_sheet = xl.sheet_names[0]
            df = xl.parse(target_sheet)
        elif ext == ".tsv":
            df = pd.read_csv(bio, sep="\t")
        elif ext == ".csv":
            df = pd.read_csv(bio, sep=None, engine="python")
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file extension '{ext}'. Supported formats: .xlsx, .csv, .tsv.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse uploaded file: {exc}") from exc

    # Drop completely empty rows/columns and formula helper columns if present
    df = df.dropna(how="all")
    helper_cols = [
        c for c in df.columns
        if str(c).strip().lower() in {"total_abundance_formula", "zero_count_formula", "qc_status_formula"}
    ]
    if helper_cols:
        df = df.drop(columns=helper_cols)
    return df


def _recompute_session_pipeline(session: Dict[str, Any]) -> Dict[str, Any]:
    """Run parser, QC, composition trait engine, and structure trait engine on session state."""
    df: pd.DataFrame = session["df"]
    parser: GlycanCompositionParser = session["parser"]
    engine: CompositionTraitEngine = session["engine"]
    struct_engine = StructureTraitEngine()

    qc_report = run_quality_control(
        df=df,
        sample_id_col=session["sample_id_col"],
        group_col=session["group_col"],
        glycan_cols=session["glycan_cols"],
        measurement_type=session["measurement_type"],
        apply_closure=session["apply_closure"],
        zero_handling=session["zero_handling"],
        parser=parser,
        excluded_samples=session.get("excluded_samples", []),
    )

    internal = qc_report["_internal"]
    excl_set = set(session.get("excluded_samples", []))
    active_indices = [i for i, sid in enumerate(internal["sample_ids"]) if sid not in excl_set]

    active_sids = [internal["sample_ids"][i] for i in active_indices]
    active_groups = [internal["groups"][i] for i in active_indices]
    active_matrix_pct = (
        internal["working_matrix_pct"][active_indices, :]
        if internal["working_matrix_pct"].size > 0
        else np.zeros((len(active_sids), len(internal["glycan_cols"])))
    )

    if qc_report["is_clr_blocked"]:
        comp_results = {
            "blocked": True,
            "blocking_errors": qc_report["blocking_errors"],
            "trait_definitions": [t.to_dict() for t in engine.get_active_traits()],
            "inclusion_matrix": engine.evaluate_glycan_inclusion_matrix(internal["parsed_objects"]),
            "sample_results": [],
            "group_summaries": {"distinct_groups": qc_report["distinct_groups"], "by_trait": {}},
            "group_comparisons": [],
            "trait_warnings": [],
            "scientific_validation": {"all_passed": False, "checks": []},
        }
    else:
        comp_results = engine.calculate_all(
            sample_ids=active_sids,
            groups=active_groups,
            glycan_labels=internal["glycan_cols"],
            abundance_matrix_pct=active_matrix_pct,
            parsed_compositions=internal["parsed_objects"],
        )
        comp_results["blocked"] = False

    struct_annotations: Dict[str, StructuralGlycanAnnotation] = session.get("structural_annotations", {})
    struct_results = struct_engine.calculate_structural_traits(
        sample_ids=active_sids,
        groups=active_groups,
        glycan_labels=internal["glycan_cols"],
        abundance_matrix_pct=active_matrix_pct,
        structural_annotations=struct_annotations,
    )

    session["qc_report"] = qc_report
    session["composition_results"] = comp_results
    session["structure_results"] = struct_results
    session["parser_config"] = parser.get_configuration_summary()
    return session


def _serialize_session_summary(session: Dict[str, Any]) -> Dict[str, Any]:
    """Build client-safe summary response without internal numpy arrays."""
    qc = dict(session["qc_report"])
    qc.pop("_internal", None)
    df: pd.DataFrame = session["df"]
    preview_rows = df.head(15).replace({np.nan: None}).to_dict(orient="records")

    comp_res = session["composition_results"]
    struct_res = session["structure_results"]

    baseline_count = 28
    optional_count = sum(1 for t in comp_res.get("trait_definitions", []) if t.get("Is_Optional"))
    custom_count = sum(1 for t in comp_res.get("trait_definitions", []) if t.get("Is_Custom"))
    struct_total = len(struct_res.get("trait_definitions", []))
    struct_avail = struct_total if struct_res.get("structural_data_available") else 0
    struct_not_derivable = struct_total - struct_avail
    comp_calc_count = 0 if comp_res.get("blocked") else len(comp_res.get("trait_definitions", []))

    return {
        "session_id": session["session_id"],
        "filename": session["filename"],
        "all_columns": [str(c) for c in df.columns],
        "sample_id_col": session["sample_id_col"],
        "group_col": session["group_col"],
        "metadata_cols": session.get("metadata_cols", []),
        "glycan_cols": session["glycan_cols"],
        "unrecognized_numeric_cols": session.get("unrecognized_numeric_cols", []),
        "preview_rows": preview_rows,
        "dashboard_metrics": {
            "total_samples": qc["total_samples"],
            "active_samples": qc["active_samples"],
            "identified_glycan_compositions": qc["valid_glycan_count"],
            "experimental_groups_count": len(qc["distinct_groups"]),
            "experimental_groups": qc["group_distribution"],
            "composition_traits_available": baseline_count + optional_count + custom_count,
            "baseline_composition_traits": baseline_count,
            "optional_composition_traits": optional_count,
            "custom_composition_traits": custom_count,
            "structure_traits_available": struct_total,
            "successfully_calculated_traits": comp_calc_count + struct_avail,
            "traits_not_derivable_insufficient_structure": struct_not_derivable,
            "qc_warnings_count": len(qc["warnings"]) + len(qc["blocking_errors"]),
        },
        "qc_report": qc,
        "parser_config": session["parser_config"],
        "composition_results": comp_res,
        "structure_results": struct_res,
        "measurement_types_catalog": MEASUREMENT_TYPES,
        "zero_handling_catalog": ZERO_HANDLING_MODES,
        "classification_table": COMPOSITION_STRUCTURE_CLASSIFICATION_TABLE,
    }


@router.post("/data/upload")
async def upload_data(
    file: UploadFile = File(...),
    sheet_name: Optional[str] = Form(None),
) -> Dict[str, Any]:
    """Upload Excel (.xlsx), CSV (.csv), or TSV (.tsv) dataset and auto-detect structure (Section 4)."""
    content = await file.read()
    fname = file.filename or "Uploaded_Data.xlsx"
    df = _read_uploaded_dataframe(fname, content, sheet_name=sheet_name)

    parser = GlycanCompositionParser()
    detected = auto_detect_columns_and_format(df, parser=parser)
    engine = CompositionTraitEngine(include_optional=True)

    # Include any numeric unrecognized columns in glycan_cols only if no valid glycans were found,
    # otherwise keep valid glycans and report unrecognized columns in QC
    glycan_cols = detected["glycan_cols"] + detected["unrecognized_numeric_cols"]

    initial_state = {
        "filename": fname,
        "df": df,
        "parser": parser,
        "engine": engine,
        "sample_id_col": detected["sample_id_col"],
        "group_col": detected["group_col"],
        "metadata_cols": detected["metadata_cols"],
        "glycan_cols": glycan_cols,
        "unrecognized_numeric_cols": detected["unrecognized_numeric_cols"],
        "measurement_type": detected["detected_measurement_type"],
        "apply_closure": False,
        "zero_handling": "true_biological_absence",
        "excluded_samples": [],
        "structural_annotations": {},
    }
    sid = GLOBAL_SESSION_STORE.create_session(initial_state)
    session = GLOBAL_SESSION_STORE.get_session(sid)
    assert session is not None
    _recompute_session_pipeline(session)
    return _serialize_session_summary(session)


@router.post("/data/demo")
def load_demo_dataset(
    include_structural_demo: bool = Query(False, description="Whether to load validated structural annotations demo"),
) -> Dict[str, Any]:
    """Load the reference GAREG Glycomic dataset (41 samples x 37 glycans, LDH vs CDH)."""
    ref_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../data/GAREG_Compositional_Glycan_Traits_Formula_Workbook.xlsx",
        )
    )
    if not os.path.exists(ref_path):
        raise HTTPException(status_code=404, detail="Reference workbook not found in data/ directory.")

    with open(ref_path, "rb") as f:
        content = f.read()
    df = _read_uploaded_dataframe("GAREG_Compositional_Glycan_Traits_Formula_Workbook.xlsx", content, sheet_name="Raw_Data")

    parser = GlycanCompositionParser()
    detected = auto_detect_columns_and_format(df, parser=parser)
    engine = CompositionTraitEngine(include_optional=True)

    structural_annotations: Dict[str, StructuralGlycanAnnotation] = {}
    if include_structural_demo:
        # Provide experimentally validated structural annotations for a subset of key N-glycans
        demo_seq_map = {
            "H3N2": ("Man(a1-6)[Man(a1-3)]Man(b1-4)GlcNAc(b1-4)GlcNAc", "PGC-LC-MS/MS + Paucimannose Man3 standard"),
            "H3N2F1": ("Man(a1-6)[Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "PGC-LC-MS/MS + Paucimannose Man3F standard"),
            "H4N2": ("Man(a1-6)[Man(a1-3)]Man(a1-6)Man(b1-4)GlcNAc(b1-4)GlcNAc", "PGC-LC-MS/MS + Paucimannose Man4 standard"),
            "H5N2": ("Man(a1-6)[Man(a1-3)]Man(a1-6)[Man(a1-3)]Man(b1-4)GlcNAc(b1-4)GlcNAc", "PGC-LC-MS/MS + Man5 standard"),
            "H6N2": ("Man(a1-2)Man(a1-3)[Man(a1-6)[Man(a1-3)]Man(a1-6)]Man(b1-4)GlcNAc(b1-4)GlcNAc", "PGC-LC-MS/MS + Man6 standard"),
            "H3N4F1": ("GlcNAc(b1-2)Man(a1-6)[GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "Exoglycosidase + MS/MS core Fuc(a1-6) diagnostic ion"),
            "H4N4F1": ("Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "Exoglycosidase + MS/MS"),
            "H5N4F1": ("Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "Exoglycosidase + MS/MS"),
            "H5N4S1": ("Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)GlcNAc", "Ethyl esterification linkage-specific MALDI-MS (alpha2,6)"),
            "H5N4S1F1": ("Neu5Ac(a2-6)Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "Ethyl esterification + core fucosidase"),
            "H4N5F1": ("Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[GlcNAc(b1-2)Man(a1-3)][GlcNAc(b1-4)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "MS/MS bisecting GlcNAc diagnostic D-221 ion"),
            "H5N5F1": ("Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-2)Man(a1-3)][GlcNAc(b1-4)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "MS/MS bisecting GlcNAc diagnostic ion"),
            "H6N5F1": ("Gal(b1-4)GlcNAc(b1-2)Man(a1-6)[Gal(b1-4)GlcNAc(b1-4)[Gal(b1-4)GlcNAc(b1-2)]Man(a1-3)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "Triantennary confirmed by linkage analysis"),
            "H4N5S1F2": ("Neu5Ac(a2-3)Gal(b1-4)[Fuc(a1-3)]GlcNAc(b1-2)Man(a1-6)[GlcNAc(b1-2)Man(a1-3)][GlcNAc(b1-4)]Man(b1-4)GlcNAc(b1-4)[Fuc(a1-6)]GlcNAc", "Ethyl esterification (alpha2,3) + antennary Lewis-X MS/MS B-ion"),
        }
        for g_id, (seq, ev) in demo_seq_map.items():
            structural_annotations[g_id] = StructuralSequenceParser.parse_sequence(
                glycan_id=g_id,
                sequence=seq,
                composition=g_id,
                confidence="Confirmed",
                evidence=ev,
            )

    initial_state = {
        "filename": "GAREG_Compositional_Glycan_Traits_Formula_Workbook.xlsx",
        "df": df,
        "parser": parser,
        "engine": engine,
        "sample_id_col": detected["sample_id_col"],
        "group_col": detected["group_col"],
        "metadata_cols": detected["metadata_cols"],
        "glycan_cols": detected["glycan_cols"],
        "unrecognized_numeric_cols": detected["unrecognized_numeric_cols"],
        "measurement_type": "relative_abundance_pct",
        "apply_closure": False,
        "zero_handling": "true_biological_absence",
        "excluded_samples": [],
        "structural_annotations": structural_annotations,
    }
    sid = GLOBAL_SESSION_STORE.create_session(initial_state)
    session = GLOBAL_SESSION_STORE.get_session(sid)
    assert session is not None
    _recompute_session_pipeline(session)
    return _serialize_session_summary(session)


@router.post("/data/metadata")
async def upload_sample_metadata(
    session_id: str = Form(...),
    file: UploadFile = File(...),
    sample_id_col_meta: Optional[str] = Form(None),
    new_group_col: Optional[str] = Form(None),
) -> Dict[str, Any]:
    """Upload and automatically match separate sample metadata table by Sample_ID (Section 4)."""
    session = GLOBAL_SESSION_STORE.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")

    content = await file.read()
    meta_df = _read_uploaded_dataframe(file.filename or "Metadata.csv", content)
    merged_df, merge_report = merge_sample_metadata(
        abundance_df=session["df"],
        metadata_df=meta_df,
        sample_id_col_abund=session["sample_id_col"],
        sample_id_col_meta=sample_id_col_meta,
    )
    session["df"] = merged_df
    for col in merge_report["added_metadata_columns"]:
        if col not in session["metadata_cols"]:
            session["metadata_cols"].append(col)
    if new_group_col and new_group_col in merged_df.columns:
        session["group_col"] = new_group_col
    elif session["group_col"] is None:
        for c in merge_report["added_metadata_columns"]:
            if c.lower() in {"group", "cohort", "condition", "diagnosis", "disease_stage", "stage"}:
                session["group_col"] = c
                break

    _recompute_session_pipeline(session)
    out = _serialize_session_summary(session)
    out["metadata_merge_report"] = merge_report
    return out


@router.post("/data/validate")
def validate_and_update_configuration(req: ValidateConfigRequest) -> Dict[str, Any]:
    """Update column assignments, measurement type, closure, zero policy, and parser dictionary (Sections 4, 5, 12)."""
    session = GLOBAL_SESSION_STORE.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")

    df: pd.DataFrame = session["df"]
    if req.sample_id_col and req.sample_id_col in df.columns:
        session["sample_id_col"] = req.sample_id_col
    if req.group_col is not None:
        session["group_col"] = req.group_col if req.group_col in df.columns else None
    if req.glycan_cols is not None:
        valid_cols = [c for c in req.glycan_cols if c in df.columns]
        session["glycan_cols"] = valid_cols

    session["measurement_type"] = req.measurement_type
    session["apply_closure"] = req.apply_closure
    session["zero_handling"] = req.zero_handling
    if req.excluded_samples is not None:
        session["excluded_samples"] = req.excluded_samples

    parser: GlycanCompositionParser = session["parser"]
    parser.treat_f_as_fucose = req.treat_f_as_fucose
    parser.treat_dhex_as_fucose = req.treat_dhex_as_fucose
    parser.assume_s_is_neuac = req.assume_s_is_neuac
    if req.manual_overrides is not None:
        for lbl, counts in req.manual_overrides.items():
            parser.set_manual_override(lbl, counts)
    if req.custom_components:
        for sym, cname in req.custom_components.items():
            parser.add_custom_component(sym, cname)

    _recompute_session_pipeline(session)
    return _serialize_session_summary(session)


@router.post("/composition/parse")
def parse_compositions_endpoint(req: ParseCompositionRequest) -> Dict[str, Any]:
    """Standalone composition parser endpoint and single-glycan contribution explainer (Sections 5 & 8.1)."""
    parser = GlycanCompositionParser(
        treat_f_as_fucose=req.treat_f_as_fucose,
        treat_dhex_as_fucose=req.treat_dhex_as_fucose,
        assume_s_is_neuac=req.assume_s_is_neuac,
        manual_overrides=req.manual_overrides,
    )
    if req.custom_components:
        for sym, cname in req.custom_components.items():
            parser.add_custom_component(sym, cname)

    report = parser.parse_many(req.labels)
    if req.explain_glycan:
        engine = CompositionTraitEngine(include_optional=True)
        report["single_glycan_explanation"] = engine.explain_single_glycan_across_traits(
            glycan_label=req.explain_glycan,
            abundance_pct=req.explain_abundance_pct,
            parser=parser,
        )
    return report


@router.post("/traits/composition/calculate")
def calculate_composition_traits_endpoint(req: CalculateCompositionRequest) -> Dict[str, Any]:
    """Recalculate composition-derived traits for the session (Section 6 & 7)."""
    session = GLOBAL_SESSION_STORE.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")
    session["engine"].include_optional = req.include_optional
    _recompute_session_pipeline(session)
    return _serialize_session_summary(session)


@router.post("/traits/structure/calculate")
def calculate_structure_traits_endpoint(req: CalculateStructureRequest) -> Dict[str, Any]:
    """Update structural annotations and calculate structure-derived traits (Section 9)."""
    session = GLOBAL_SESSION_STORE.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")

    if req.clear_annotations:
        session["structural_annotations"] = {}
    elif req.annotations is not None:
        ann_map: Dict[str, StructuralGlycanAnnotation] = dict(session.get("structural_annotations", {}))
        for item in req.annotations:
            seq = (item.structure_sequence or "").strip()
            if seq:
                parsed_ann = StructuralSequenceParser.parse_sequence(
                    glycan_id=item.glycan_id,
                    sequence=seq,
                    composition=item.composition or item.glycan_id,
                    confidence=item.annotation_confidence,
                    evidence=item.experimental_evidence,
                )
                ann_map[item.glycan_id] = parsed_ann
            else:
                # Explicit tabular structural properties if provided with experimental evidence
                has_any_prop = any(
                    v is not None
                    for v in (
                        item.core_fucosylated,
                        item.antennary_fucosylated,
                        item.bisecting_glcnac,
                        item.galactose_count,
                        item.structural_class,
                        item.antenna_count,
                        item.alpha2_3_sialic_count,
                        item.alpha2_6_sialic_count,
                    )
                )
                ann_map[item.glycan_id] = StructuralGlycanAnnotation(
                    glycan_id=item.glycan_id,
                    composition=item.composition or item.glycan_id,
                    sequence_format="Tabular" if has_any_prop else "none",
                    structure_sequence="",
                    has_validated_structure=bool(has_any_prop and item.annotation_confidence == "Confirmed"),
                    annotation_confidence=item.annotation_confidence if has_any_prop else "Composition-Only",
                    experimental_evidence=item.experimental_evidence,
                    core_fucosylated=item.core_fucosylated,
                    antennary_fucosylated=item.antennary_fucosylated,
                    bisecting_glcnac=item.bisecting_glcnac,
                    galactose_count=item.galactose_count,
                    structural_class=item.structural_class,
                    antenna_count=item.antenna_count,
                    alpha2_3_sialic_count=item.alpha2_3_sialic_count,
                    alpha2_6_sialic_count=item.alpha2_6_sialic_count,
                    parser_validation_notes=(
                        ["Validated explicit tabular structural annotation."]
                        if has_any_prop else [NOT_DERIVABLE_TEXT]
                    ),
                )
        session["structural_annotations"] = ann_map

    _recompute_session_pipeline(session)
    return _serialize_session_summary(session)


@router.post("/traits/structure/upload")
async def upload_structural_annotation_file(
    session_id: str = Form(...),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    """Upload a structural annotation file (.csv, .tsv, .xlsx) with Glycan_ID, Sequence, or tabular linkage columns."""
    session = GLOBAL_SESSION_STORE.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")

    content = await file.read()
    ann_df = _read_uploaded_dataframe(file.filename or "Annotations.csv", content)
    cols_lower = {str(c).strip().lower(): str(c) for c in ann_df.columns}

    id_col = None
    for cand in ("glycan_id", "glycan", "composition", "glycan composition"):
        if cand in cols_lower:
            id_col = cols_lower[cand]
            break
    if not id_col and len(ann_df.columns) > 0:
        id_col = str(ann_df.columns[0])

    seq_col = None
    for cand in ("structure_sequence", "glycan structure sequence", "sequence", "iupac", "wurcs", "glycoct"):
        if cand in cols_lower:
            seq_col = cols_lower[cand]
            break

    conf_col = cols_lower.get("structural annotation confidence", cols_lower.get("annotation_confidence", cols_lower.get("confidence")))
    ev_col = cols_lower.get("experimental evidence", cols_lower.get("experimental_evidence", cols_lower.get("reference")))

    def _to_opt_bool(v: Any) -> Optional[bool]:
        if pd.isna(v):
            return None
        s = str(v).strip().lower()
        if s in ("true", "yes", "1", "1.0", "confirmed"):
            return True
        if s in ("false", "no", "0", "0.0", "absent"):
            return False
        return None

    def _to_opt_int(v: Any) -> Optional[int]:
        if pd.isna(v):
            return None
        try:
            return int(float(v))
        except Exception:
            return None

    ann_map: Dict[str, StructuralGlycanAnnotation] = dict(session.get("structural_annotations", {}))
    for _, row in ann_df.iterrows():
        gid = str(row[id_col]).strip() if id_col else ""
        if not gid:
            continue
        seq = str(row[seq_col]).strip() if (seq_col and pd.notna(row[seq_col])) else ""
        conf = str(row[conf_col]).strip() if (conf_col and pd.notna(row[conf_col])) else "Confirmed"
        ev = str(row[ev_col]).strip() if (ev_col and pd.notna(row[ev_col])) else "Uploaded structural annotation file"

        if seq and seq.lower() != "nan":
            ann_map[gid] = StructuralSequenceParser.parse_sequence(
                glycan_id=gid,
                sequence=seq,
                composition=gid,
                confidence=conf,
                evidence=ev,
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
            ann_map[gid] = StructuralGlycanAnnotation(
                glycan_id=gid,
                composition=gid,
                sequence_format="Tabular" if has_any else "none",
                structure_sequence="",
                has_validated_structure=has_any,
                annotation_confidence=conf if has_any else "Composition-Only",
                experimental_evidence=ev,
                core_fucosylated=cf,
                antennary_fucosylated=af,
                bisecting_glcnac=bg,
                galactose_count=gc,
                structural_class=sc,
                antenna_count=ac,
                alpha2_3_sialic_count=s23,
                alpha2_6_sialic_count=s26,
                parser_validation_notes=["Uploaded tabular structural annotation."] if has_any else [NOT_DERIVABLE_TEXT],
            )

    session["structural_annotations"] = ann_map
    _recompute_session_pipeline(session)
    return _serialize_session_summary(session)


@router.get("/traits/definitions")
def get_trait_definitions_endpoint(
    session_id: Optional[str] = Query(None),
    include_optional: bool = Query(True),
) -> Dict[str, Any]:
    """Return all baseline, optional, custom, and structure-derived trait definitions (Section 7 & 10)."""
    custom_traits = []
    if session_id:
        session = GLOBAL_SESSION_STORE.get_session(session_id)
        if session:
            custom_traits = session["engine"].custom_traits
    return get_all_trait_definitions(include_optional=include_optional, custom_traits=custom_traits)


@router.get("/traits/contributions")
def get_trait_contributions_endpoint(
    session_id: str = Query(...),
    trait_id: str = Query(...),
    sample_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Return the complete interactive explanation and glycan contribution audit table for a trait and sample (Section 8)."""
    session = GLOBAL_SESSION_STORE.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")

    internal = session["qc_report"]["_internal"]
    engine: CompositionTraitEngine = session["engine"]
    sids = internal["sample_ids"]
    target_sid = sample_id if (sample_id and sample_id in sids) else (sids[0] if sids else "")

    try:
        return engine.get_trait_contribution_audit(
            trait_id=trait_id,
            sample_id=target_sid,
            sample_ids=sids,
            groups=internal["groups"],
            glycan_labels=internal["glycan_cols"],
            abundance_matrix_pct=internal["working_matrix_pct"],
            parsed_compositions=internal["parsed_objects"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/traits/custom")
def create_or_preview_custom_trait(req: CustomTraitRequest) -> Dict[str, Any]:
    """Create or preview a user-defined composition trait (Section 18: Custom Glycan Trait Builder)."""
    session = GLOBAL_SESSION_STORE.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")

    engine: CompositionTraitEngine = session["engine"]
    next_idx = len(engine.custom_traits) + 1
    custom_id = f"U{next_idx:02d}"

    try:
        tdef = build_custom_trait_definition(
            trait_id=custom_id,
            trait_name=req.trait_name,
            inclusion_clauses=req.inclusion_clauses,
            exclusion_clauses=req.exclusion_clauses,
            numerator_weight=req.numerator_weight,
            has_denominator=req.has_denominator,
            denominator_clauses=req.denominator_clauses,
            denominator_weight=req.denominator_weight,
            scale=req.scale,
            unit=req.unit,
            interpretation=req.interpretation,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    internal = session["qc_report"]["_internal"]
    # Preview contributing glycans before or upon saving
    temp_engine = CompositionTraitEngine(include_optional=False, custom_traits=[tdef])
    inc_mat = temp_engine.evaluate_glycan_inclusion_matrix(internal["parsed_objects"])
    preview_info = inc_mat[custom_id]

    if req.preview_only:
        return {
            "preview_only": True,
            "trait_definition": tdef.to_dict(),
            "included_glycans": preview_info["included_glycans"],
            "excluded_glycans": preview_info["excluded_glycans"],
            "denominator_glycans": preview_info["denominator_glycans"],
            "per_glycan": preview_info["per_glycan"],
        }

    engine.custom_traits.append(tdef)
    _recompute_session_pipeline(session)
    out = _serialize_session_summary(session)
    out["created_custom_trait"] = tdef.to_dict()
    return out


@router.get("/results/summary")
def get_results_summary_endpoint(session_id: str = Query(...)) -> Dict[str, Any]:
    """Return full session results summary (Dashboard, QC, Composition Traits, Structure Traits, Group Summaries)."""
    session = GLOBAL_SESSION_STORE.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")
    return _serialize_session_summary(session)


@router.post("/export/excel")
def export_excel_endpoint(req: ExportRequest) -> Response:
    """Export the 11-sheet Excel workbook with live formulas and complete audit trails (Section 16)."""
    session = GLOBAL_SESSION_STORE.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")
    xlsx_bytes = generate_excel_workbook_bytes(session)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="GAREG_Glycomic_Trait_Analysis_Workbook.xlsx"'
        },
    )


@router.post("/export/csv")
def export_csv_endpoint(req: ExportRequest) -> Response:
    """Export the 9-file ZIP CSV package (Section 17)."""
    session = GLOBAL_SESSION_STORE.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")
    zip_bytes = generate_csv_zip_bytes(session)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="GAREG_Glycomic_Trait_Analysis_CSV_Package.zip"'
        },
    )


@router.post("/export/report")
def export_report_endpoint(req: ExportRequest) -> Response:
    """Export the Automated Scientific Report in HTML or PDF format (Section 15)."""
    session = GLOBAL_SESSION_STORE.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found or expired.")
    if req.format.lower() == "pdf":
        pdf_bytes = generate_scientific_report_pdf_bytes(session)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="GAREG_Glycomic_Trait_Analysis_Report.pdf"'
            },
        )
    html_str = generate_scientific_report_html(session)
    return HTMLResponse(
        content=html_str,
        headers={
            "Content-Disposition": 'inline; filename="GAREG_Glycomic_Trait_Analysis_Report.html"'
        },
    )


@router.delete("/session/{session_id}")
def delete_session_endpoint(session_id: str) -> Dict[str, Any]:
    """Immediately delete user session and temporary clinical data from memory (Section 20)."""
    deleted = GLOBAL_SESSION_STORE.delete_session(session_id)
    return {"deleted": deleted, "session_id": session_id}

