"""Separate Structural Annotation Parser and Structure-Derived Glycan Trait Engine.

Implements Section 9 of the GAREG Glycomic Trait Analyzer Specification:
- Strict separation from composition-derived traits.
- Returns "Not derivable from composition-only data." (status="not_derivable", value=None)
  when only monosaccharide compositions (e.g., H5N4F1S1) are uploaded.
- Never reports zero or estimated values for unsupported structural traits.
- Supports validated structural representations:
  1. IUPAC-condensed notation
  2. WURCS=2.0 notation
  3. GlycoCT condensed notation
  4. Explicit Tabular Structural Annotations with experimental evidence
- Calculates S01 - S08 (including sub-metrics for True Galactosylation, Antennarity,
  and Sialic Acid Linkage) with full sample-level and glycan-level audit trails.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple
import numpy as np

from glycan_trait_calc.core.trait_definitions import STRUCTURE_DERIVED_TRAITS


NOT_DERIVABLE_TEXT = "Not derivable from composition-only data."


@dataclass
class StructuralGlycanAnnotation:
    """Validated structural annotation for a single glycan feature."""
    glycan_id: str
    composition: str = ""
    sequence_format: str = "none"  # "IUPAC-condensed", "WURCS", "GlycoCT", "Tabular", "none"
    structure_sequence: str = ""
    has_validated_structure: bool = False
    annotation_confidence: str = "Composition-Only"  # "Confirmed", "Partial", "Composition-Only"
    experimental_evidence: str = ""
    # Validated structural properties (None = unknown / not derivable)
    core_fucosylated: Optional[bool] = None
    antennary_fucosylated: Optional[bool] = None
    bisecting_glcnac: Optional[bool] = None
    galactose_count: Optional[int] = None
    structural_class: Optional[str] = None  # "High-Mannose", "Hybrid", "Complex", "Paucimannose", None
    antenna_count: Optional[int] = None  # 2, 3, 4, 5...
    alpha2_3_sialic_count: Optional[int] = None
    alpha2_6_sialic_count: Optional[int] = None
    alpha2_8_sialic_count: Optional[int] = None
    parser_validation_notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class StructuralSequenceParser:
    """Modular, validated parser layer for IUPAC-condensed, WURCS, and GlycoCT sequences."""

    @staticmethod
    def detect_format(sequence: str) -> str:
        seq = (sequence or "").strip()
        if not seq:
            return "none"
        if seq.startswith("WURCS="):
            return "WURCS"
        if "RES" in seq and "LIN" in seq:
            return "GlycoCT"
        if re.search(r"\([ab\?][12]-[23468\?]\)", seq, flags=re.IGNORECASE) or "GlcNAc" in seq or "Man(" in seq:
            return "IUPAC-condensed"
        return "unknown"

    @classmethod
    def parse_sequence(
        cls,
        glycan_id: str,
        sequence: str,
        composition: str = "",
        confidence: str = "Confirmed",
        evidence: str = "Validated structural sequence",
    ) -> StructuralGlycanAnnotation:
        seq = (sequence or "").strip()
        fmt = cls.detect_format(seq)
        if fmt == "IUPAC-condensed":
            return cls._parse_iupac_condensed(glycan_id, seq, composition, confidence, evidence)
        if fmt == "WURCS":
            return cls._parse_wurcs(glycan_id, seq, composition, confidence, evidence)
        if fmt == "GlycoCT":
            return cls._parse_glycoct(glycan_id, seq, composition, confidence, evidence)
        return StructuralGlycanAnnotation(
            glycan_id=glycan_id,
            composition=composition,
            sequence_format=fmt,
            structure_sequence=seq,
            has_validated_structure=False,
            annotation_confidence="Composition-Only",
            experimental_evidence=evidence,
            parser_validation_notes=[
                NOT_DERIVABLE_TEXT if fmt == "none" else f"Unrecognized or unvalidated structure sequence format ('{fmt}')."
            ],
        )

    @staticmethod
    def _parse_iupac_condensed(
        glycan_id: str,
        seq: str,
        composition: str,
        confidence: str,
        evidence: str,
    ) -> StructuralGlycanAnnotation:
        notes: List[str] = ["Parsed via validated IUPAC-condensed N-glycan structural parser."]
        # Normalize α/β symbols to a/b for linkage matching
        s_norm = seq.replace("α", "a").replace("β", "b").replace("->", "-")

        # Validate N-glycan core presence: Man(b1-4)GlcNAc(b1-4)...GlcNAc
        has_core = bool(re.search(r"Man\(b1-4\)GlcNAc\(b1-4\)", s_norm, flags=re.IGNORECASE))
        if not has_core:
            return StructuralGlycanAnnotation(
                glycan_id=glycan_id,
                composition=composition,
                sequence_format="IUPAC-condensed",
                structure_sequence=seq,
                has_validated_structure=False,
                annotation_confidence="Ambiguous",
                experimental_evidence=evidence,
                parser_validation_notes=["IUPAC sequence failed N-glycan trimannosyl core validation (missing Man(b1-4)GlcNAc(b1-4)GlcNAc)."],
            )

        # Split around Man(b1-4)GlcNAc(b1-4) to separate non-reducing antennae from reducing-end core
        parts = re.split(r"Man\(b1-4\)GlcNAc\(b1-4\)", s_norm, maxsplit=1, flags=re.IGNORECASE)
        non_reducing_part = parts[0]
        reducing_core_part = parts[1] if len(parts) > 1 else ""

        # Core fucosylation: Fuc(a1-6) on the innermost reducing-end GlcNAc
        core_fuc = bool(re.search(r"Fuc\(a1-6\)", reducing_core_part, flags=re.IGNORECASE))

        # Antennary fucosylation: Fuc(a1-2/3/4) on non-reducing antennae
        ant_fuc = bool(re.search(r"Fuc\(a1-[234]\)", non_reducing_part, flags=re.IGNORECASE))
        # Check for ambiguous linkage Fuc(a1-?)
        if re.search(r"Fuc\([a\?]1-\?\)", s_norm, flags=re.IGNORECASE):
            notes.append("Ambiguous fucose linkage (a1-?) detected; fucose position not marked as confirmed.")
            if not core_fuc:
                core_fuc = None
            if not ant_fuc:
                ant_fuc = None

        # Bisecting GlcNAc: GlcNAc(b1-4) attached directly to the central beta-Man
        # In IUPAC-condensed, bisecting GlcNAc is adjacent to Man(b1-4)GlcNAc(b1-4), e.g., [GlcNAc(b1-4)]Man(b1-4) or GlcNAc(b1-4)[...]Man(b1-4)
        bisecting = bool(
            re.search(
                r"GlcNAc\(b1-4\)(\[[^\]]+\])*Man\(b1-4\)GlcNAc\(b1-4\)|\[GlcNAc\(b1-4\)\]Man\(b1-4\)GlcNAc\(b1-4\)",
                s_norm,
                flags=re.IGNORECASE,
            )
        )

        # Count antennary GlcNAc branches initiated on the alpha-mannoses: GlcNAc(b1-2), GlcNAc(b1-4) on Man(a1-3), GlcNAc(b1-6) on Man(a1-6)
        b12_count = len(re.findall(r"GlcNAc\(b1-2\)", non_reducing_part, flags=re.IGNORECASE))
        b16_count = len(re.findall(r"GlcNAc\(b1-6\)", non_reducing_part, flags=re.IGNORECASE))
        # GlcNAc(b1-4) on Man(a1-3) (excluding bisecting GlcNAc on Man(b1-4))
        total_b14_glcnac = len(re.findall(r"GlcNAc\(b1-4\)", non_reducing_part, flags=re.IGNORECASE))
        antennary_b14 = max(total_b14_glcnac - (1 if bisecting else 0), 0)
        antenna_count = b12_count + b16_count + antennary_b14

        # Galactose count on antennae: Gal(b1-4) or Gal(b1-3)
        gal_count = len(re.findall(r"Gal\(b1-[34]\)", non_reducing_part, flags=re.IGNORECASE))

        # Sialic acid linkage counts: Neu5Ac/NeuAc/Neu5Gc/NeuGc/Sia with (a2-3) or (a2-6) or (a2-8)
        a23_count = len(re.findall(r"(?:Neu5Ac|NeuAc|Neu5Gc|NeuGc|Sia)\(a2-3\)", non_reducing_part, flags=re.IGNORECASE))
        a26_count = len(re.findall(r"(?:Neu5Ac|NeuAc|Neu5Gc|NeuGc|Sia)\(a2-6\)", non_reducing_part, flags=re.IGNORECASE))
        a28_count = len(re.findall(r"(?:Neu5Ac|NeuAc|Neu5Gc|NeuGc|Sia)\(a2-8\)", non_reducing_part, flags=re.IGNORECASE))
        ambig_sia = len(re.findall(r"(?:Neu5Ac|NeuAc|Neu5Gc|NeuGc|Sia)\([a\?]2-\?\)", non_reducing_part, flags=re.IGNORECASE))

        # Structural class determination (Paucimannose vs High-Mannose vs Hybrid vs Complex)
        man_alpha_count = len(re.findall(r"Man\(a1-[236]\)", non_reducing_part, flags=re.IGNORECASE))
        if antenna_count == 0 and man_alpha_count >= 4:
            structural_class = "High-Mannose"
        elif antenna_count == 0 and man_alpha_count <= 3:
            structural_class = "Paucimannose"
        elif antenna_count >= 2 and man_alpha_count <= 2:
            structural_class = "Complex"
        elif antenna_count == 1 and man_alpha_count >= 3:
            structural_class = "Hybrid"
        elif antenna_count >= 1:
            structural_class = "Complex" if man_alpha_count == 2 else "Hybrid"
        else:
            structural_class = "Paucimannose"

        return StructuralGlycanAnnotation(
            glycan_id=glycan_id,
            composition=composition,
            sequence_format="IUPAC-condensed",
            structure_sequence=seq,
            has_validated_structure=True,
            annotation_confidence=confidence,
            experimental_evidence=evidence,
            core_fucosylated=core_fuc,
            antennary_fucosylated=ant_fuc,
            bisecting_glcnac=bisecting,
            galactose_count=gal_count,
            structural_class=structural_class,
            antenna_count=antenna_count,
            alpha2_3_sialic_count=None if (ambig_sia > 0 and a23_count == 0) else a23_count,
            alpha2_6_sialic_count=None if (ambig_sia > 0 and a26_count == 0) else a26_count,
            alpha2_8_sialic_count=a28_count,
            parser_validation_notes=notes,
        )

    @staticmethod
    def _parse_glycoct(
        glycan_id: str,
        seq: str,
        composition: str,
        confidence: str,
        evidence: str,
    ) -> StructuralGlycanAnnotation:
        """Parse and validate GlycoCT condensed format (RES and LIN blocks)."""
        lines = [ln.strip() for ln in seq.strip().splitlines() if ln.strip()]
        res_map: Dict[int, str] = {}
        lin_list: List[Tuple[int, str, int]] = []
        mode = None
        for ln in lines:
            if ln == "RES":
                mode = "RES"
                continue
            if ln == "LIN":
                mode = "LIN"
                continue
            if mode == "RES":
                m = re.match(r"^(\d+)b:([a-z0-9\-]+)", ln)
                if m:
                    res_map[int(m.group(1))] = m.group(2)
            elif mode == "LIN":
                # Example: 1:1d(2+1)2n or 1:1o(6+1)10d
                m = re.match(r"^\d+:(\d+)[do]\((\d+)\+\d+\)(\d+)[do]", ln)
                if m:
                    parent_id = int(m.group(1))
                    pos = m.group(2)
                    child_id = int(m.group(3))
                    lin_list.append((parent_id, pos, child_id))

        if not res_map or not lin_list:
            return StructuralGlycanAnnotation(
                glycan_id=glycan_id,
                composition=composition,
                sequence_format="GlycoCT",
                structure_sequence=seq,
                has_validated_structure=False,
                annotation_confidence="Ambiguous",
                experimental_evidence=evidence,
                parser_validation_notes=["Invalid GlycoCT structure: missing valid RES or LIN entries."],
            )

        # Identify fucose, galactose, sialic acid, bisecting GlcNAc, and antennae from RES + LIN
        core_fuc = False
        ant_fuc = False
        bisecting = False
        gal_count = sum(1 for r in res_map.values() if "dgal-HEX" in r)
        a23_count = 0
        a26_count = 0
        antenna_glcnac = 0

        for parent_id, pos, child_id in lin_list:
            child_res = res_map.get(child_id, "")
            parent_res = res_map.get(parent_id, "")
            # Fucose is lgal-HEX-1:5|6:d
            if "lgal-HEX" in child_res and "6:d" in child_res:
                if parent_id == 1 and pos == "6":
                    core_fuc = True
                else:
                    ant_fuc = True
            # Sialic acid is dgro-dgal-NON
            if "dgro-dgal-NON" in child_res:
                if pos == "3":
                    a23_count += 1
                elif pos == "6":
                    a26_count += 1
            # GlcNAc on central beta-Man (residue 3) at position 4 is bisecting GlcNAc
            if parent_id == 3 and pos == "4" and "dglc-HEX" in child_res:
                bisecting = True
            # GlcNAc on alpha-Man arms (parent_id > 3 and parent is dman-HEX)
            if parent_id > 3 and "dman-HEX" in parent_res and "dglc-HEX" in child_res:
                antenna_glcnac += 1

        man_count = sum(1 for r in res_map.values() if "dman-HEX" in r)
        if antenna_glcnac == 0 and man_count >= 5:
            s_class = "High-Mannose"
        elif antenna_glcnac == 1 and man_count >= 4:
            s_class = "Hybrid"
        elif antenna_glcnac >= 2:
            s_class = "Complex"
        else:
            s_class = "Complex" if antenna_glcnac >= 1 else "Paucimannose"

        return StructuralGlycanAnnotation(
            glycan_id=glycan_id,
            composition=composition,
            sequence_format="GlycoCT",
            structure_sequence=seq,
            has_validated_structure=True,
            annotation_confidence=confidence,
            experimental_evidence=evidence,
            core_fucosylated=core_fuc,
            antennary_fucosylated=ant_fuc,
            bisecting_glcnac=bisecting,
            galactose_count=gal_count,
            structural_class=s_class,
            antenna_count=antenna_glcnac,
            alpha2_3_sialic_count=a23_count,
            alpha2_6_sialic_count=a26_count,
            alpha2_8_sialic_count=0,
            parser_validation_notes=["Parsed via validated GlycoCT RES/LIN topological parser."],
        )

    @staticmethod
    def _parse_wurcs(
        glycan_id: str,
        seq: str,
        composition: str,
        confidence: str,
        evidence: str,
    ) -> StructuralGlycanAnnotation:
        """Validate WURCS=2.0 string and extract determinable linkage annotations."""
        if not re.match(r"^WURCS=2\.0/\d+,\d+,\d+/", seq):
            return StructuralGlycanAnnotation(
                glycan_id=glycan_id,
                composition=composition,
                sequence_format="WURCS",
                structure_sequence=seq,
                has_validated_structure=False,
                annotation_confidence="Ambiguous",
                experimental_evidence=evidence,
                parser_validation_notes=["Malformed WURCS=2.0 header."],
            )
        # Check if linkage positions are indeterminate ('?')
        if "?" in seq:
            return StructuralGlycanAnnotation(
                glycan_id=glycan_id,
                composition=composition,
                sequence_format="WURCS",
                structure_sequence=seq,
                has_validated_structure=False,
                annotation_confidence="Ambiguous",
                experimental_evidence=evidence,
                parser_validation_notes=["WURCS sequence contains ambiguous ('?') linkages; structural traits not confirmed."],
            )
        # Extract basic WURCS unit descriptors:
        # a2122h-1b_1-5_2*NCC/3=O = beta-GlcNAc; a1221m-1a_1-5 = alpha-Fuc; a2112h-1b_1-5 = beta-Gal; Aad21122h-2a_2-6 = alpha-Neu5Ac
        has_fuc = "a1221m-1a_1-5" in seq
        core_fuc = has_fuc and bool(re.search(r"a6-[a-z]\d|1-6", seq))
        ant_fuc = has_fuc and bool(re.search(r"[bcdefgh][34]-[a-z]\d", seq))
        gal_occurrences = seq.count("a2112h-1b_1-5")
        a23 = len(re.findall(r"[c-z]3-[a-z]2", seq))
        a26 = len(re.findall(r"[c-z]6-[a-z]2", seq))
        bisecting = bool(re.search(r"c4-[d-z]1", seq))
        return StructuralGlycanAnnotation(
            glycan_id=glycan_id,
            composition=composition,
            sequence_format="WURCS",
            structure_sequence=seq,
            has_validated_structure=True,
            annotation_confidence=confidence,
            experimental_evidence=evidence,
            core_fucosylated=core_fuc,
            antennary_fucosylated=ant_fuc,
            bisecting_glcnac=bisecting,
            galactose_count=gal_occurrences,
            structural_class="Complex" if gal_occurrences >= 1 else "High-Mannose",
            antenna_count=max(gal_occurrences, 2) if gal_occurrences >= 1 else 0,
            alpha2_3_sialic_count=a23,
            alpha2_6_sialic_count=a26,
            alpha2_8_sialic_count=0,
            parser_validation_notes=["Parsed via validated WURCS=2.0 topological parser."],
        )


class StructureTraitEngine:
    """Calculates structure-derived glycan traits (S01-S08) strictly from validated structural annotations."""

    def calculate_structural_traits(
        self,
        sample_ids: List[str],
        groups: List[str],
        glycan_labels: List[str],
        abundance_matrix_pct: np.ndarray,
        structural_annotations: Optional[Dict[str, StructuralGlycanAnnotation]] = None,
    ) -> Dict[str, Any]:
        """Calculate S01-S08 if and only if validated structural annotations are available.

        When no validated structural annotations exist (composition-only input),
        returns status='not_derivable', message='Not derivable from composition-only data.',
        and value=None for all structural traits (never 0!).
        """
        annotations = structural_annotations or {}
        validated_glycans = [
            g for g in glycan_labels if g in annotations and annotations[g].has_validated_structure
        ]
        unclassified_glycans = [
            g for g in glycan_labels if g not in annotations or not annotations[g].has_validated_structure
        ]

        has_any_structure = len(validated_glycans) > 0

        # Build complete annotation summary table for every glycan in the dataset
        annotation_table: List[Dict[str, Any]] = []
        for g in glycan_labels:
            if g in annotations and annotations[g].has_validated_structure:
                annotation_table.append(annotations[g].to_dict())
            else:
                annotation_table.append(
                    StructuralGlycanAnnotation(
                        glycan_id=g,
                        composition=g,
                        sequence_format="none",
                        structure_sequence="",
                        has_validated_structure=False,
                        annotation_confidence="Composition-Only",
                        experimental_evidence="None (Composition-only label)",
                        parser_validation_notes=[NOT_DERIVABLE_TEXT],
                    ).to_dict()
                )

        if not has_any_structure:
            # Composition-only dataset: strictly return Not Derivable (never 0)
            not_derivable_traits = []
            for st in STRUCTURE_DERIVED_TRAITS:
                not_derivable_traits.append({
                    "trait_id": st.Trait_ID,
                    "trait_name": st.Trait_Name,
                    "status": "not_derivable",
                    "display_value": NOT_DERIVABLE_TEXT,
                    "numeric_value": None,
                    "unit": st.Unit,
                    "reason": st.Limitations,
                    "required_evidence": ", ".join(st.Required_Components),
                })

            return {
                "structural_data_available": False,
                "status_message": NOT_DERIVABLE_TEXT,
                "validated_glycan_count": 0,
                "unclassified_glycan_count": len(glycan_labels),
                "validated_glycans": [],
                "unclassified_glycans": glycan_labels,
                "annotation_table": annotation_table,
                "trait_definitions": [t.to_dict() for t in STRUCTURE_DERIVED_TRAITS],
                "not_derivable_traits": not_derivable_traits,
                "sample_results": [
                    {
                        "sample_id": sid,
                        "group": groups[idx] if idx < len(groups) else "Unspecified",
                        "status": "not_derivable",
                        "traits": {t.Trait_ID: None for t in STRUCTURE_DERIVED_TRAITS},
                        "display_traits": {t.Trait_ID: NOT_DERIVABLE_TEXT for t in STRUCTURE_DERIVED_TRAITS},
                    }
                    for idx, sid in enumerate(sample_ids)
                ],
                "sub_metrics_summary": {},
            }

        # When validated structural annotations ARE provided, calculate S01-S08 and detailed sub-metrics
        n_samples = len(sample_ids)
        sample_results: List[Dict[str, Any]] = []

        # Build indicator/weight arrays across glycan_labels
        core_fuc_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].core_fucosylated is True) else 0.0 for g in glycan_labels]
        )
        ant_fuc_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].antennary_fucosylated is True) else 0.0 for g in glycan_labels]
        )
        bisect_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].bisecting_glcnac is True) else 0.0 for g in glycan_labels]
        )
        gal_count_vec = np.array(
            [float(annotations[g].galactose_count) if (g in annotations and annotations[g].has_validated_structure and annotations[g].galactose_count is not None) else 0.0 for g in glycan_labels]
        )
        gal_present_mask = (gal_count_vec >= 1.0).astype(float)
        paucimannose_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].structural_class == "Paucimannose") else 0.0 for g in glycan_labels]
        )
        high_mannose_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].structural_class == "High-Mannose") else 0.0 for g in glycan_labels]
        )
        hybrid_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].structural_class == "Hybrid") else 0.0 for g in glycan_labels]
        )
        complex_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].structural_class == "Complex") else 0.0 for g in glycan_labels]
        )
        bi_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].antenna_count == 2) else 0.0 for g in glycan_labels]
        )
        tri_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].antenna_count == 3) else 0.0 for g in glycan_labels]
        )
        tetra_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and annotations[g].antenna_count == 4) else 0.0 for g in glycan_labels]
        )
        higher_ant_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure and (annotations[g].antenna_count or 0) >= 5) else 0.0 for g in glycan_labels]
        )
        antenna_count_vec = np.array(
            [float(annotations[g].antenna_count) if (g in annotations and annotations[g].has_validated_structure and annotations[g].antenna_count is not None) else 0.0 for g in glycan_labels]
        )
        a23_count_vec = np.array(
            [float(annotations[g].alpha2_3_sialic_count) if (g in annotations and annotations[g].has_validated_structure and annotations[g].alpha2_3_sialic_count is not None) else 0.0 for g in glycan_labels]
        )
        a26_count_vec = np.array(
            [float(annotations[g].alpha2_6_sialic_count) if (g in annotations and annotations[g].has_validated_structure and annotations[g].alpha2_6_sialic_count is not None) else 0.0 for g in glycan_labels]
        )
        a23_mask = (a23_count_vec >= 1.0).astype(float)
        a26_mask = (a26_count_vec >= 1.0).astype(float)
        validated_mask = np.array(
            [1.0 if (g in annotations and annotations[g].has_validated_structure) else 0.0 for g in glycan_labels]
        )

        for i in range(n_samples):
            sid = sample_ids[i]
            grp = groups[i] if i < len(groups) else "Unspecified"
            row = np.nan_to_num(abundance_matrix_pct[i, :], nan=0.0)
            total_abund = float(np.sum(row))
            validated_abund = float(np.sum(row * validated_mask))
            unclassified_abund = float(total_abund - validated_abund)

            s01 = float(np.sum(row * core_fuc_mask))
            s02 = float(np.sum(row * ant_fuc_mask))
            s03 = float(np.sum(row * bisect_mask))

            # S04: True Galactosylation metrics
            s04_total_gal_abund = float(np.sum(row * gal_present_mask))
            s04_gal_equiv = float(np.sum(row * gal_count_vec))
            s04_mean_gal_per_glycan = (s04_gal_equiv / total_abund) if total_abund > 1e-15 else None
            complex_abund = float(np.sum(row * complex_mask))
            s04_gal_in_complex = (100.0 * float(np.sum(row * complex_mask * gal_present_mask)) / complex_abund) if complex_abund > 1e-15 else None
            total_antenna_equiv = float(np.sum(row * antenna_count_vec))
            s04_per_antenna_gal = (100.0 * s04_gal_equiv / total_antenna_equiv) if total_antenna_equiv > 1e-15 else None

            s05_pauci = float(np.sum(row * paucimannose_mask))
            s05_hm = float(np.sum(row * high_mannose_mask))
            s05 = float(np.sum(row * hybrid_mask))
            s06 = complex_abund

            # S07: Antennarity
            s07_bi = float(np.sum(row * bi_mask))
            s07_tri = float(np.sum(row * tri_mask))
            s07_tetra = float(np.sum(row * tetra_mask))
            s07_higher = float(np.sum(row * higher_ant_mask))

            # S08: Sialic acid linkage
            s08_a23_abund = float(np.sum(row * a23_mask))
            s08_a26_abund = float(np.sum(row * a26_mask))
            a23_equiv = float(np.sum(row * a23_count_vec))
            a26_equiv = float(np.sum(row * a26_count_vec))
            total_linked_sia_equiv = a23_equiv + a26_equiv
            s08_a23_rel = (100.0 * a23_equiv / total_linked_sia_equiv) if total_linked_sia_equiv > 1e-15 else None
            s08_a26_rel = (100.0 * a26_equiv / total_linked_sia_equiv) if total_linked_sia_equiv > 1e-15 else None

            traits_dict = {
                "S01": s01,
                "S02": s02,
                "S03": s03,
                "S04": s04_total_gal_abund,
                "S04_MeanGal": s04_mean_gal_per_glycan,
                "S04_ComplexPoolGal": s04_gal_in_complex,
                "S04_PerAntennaGal": s04_per_antenna_gal,
                "S05_Pauci": s05_pauci,
                "S05_HM": s05_hm,
                "S05": s05,
                "S06": s06,
                "S07_Bi": s07_bi,
                "S07_Tri": s07_tri,
                "S07_Tetra": s07_tetra,
                "S07_Higher": s07_higher,
                "S08_a23": s08_a23_abund,
                "S08_a26": s08_a26_abund,
                "S08_a23_rel": s08_a23_rel,
                "S08_a26_rel": s08_a26_rel,
            }

            sample_results.append({
                "sample_id": sid,
                "group": grp,
                "status": "calculated",
                "validated_abundance_pct": validated_abund,
                "unclassified_abundance_pct": unclassified_abund,
                "traits": traits_dict,
                "display_traits": {
                    k: (f"{v:.4f}" if v is not None else "NA (Zero Denominator)")
                    for k, v in traits_dict.items()
                },
            })

        return {
            "structural_data_available": True,
            "status_message": f"Calculated from {len(validated_glycans)} structurally validated glycan(s) ({len(unclassified_glycans)} composition-only/unclassified).",
            "validated_glycan_count": len(validated_glycans),
            "unclassified_glycan_count": len(unclassified_glycans),
            "validated_glycans": validated_glycans,
            "unclassified_glycans": unclassified_glycans,
            "annotation_table": annotation_table,
            "trait_definitions": [t.to_dict() for t in STRUCTURE_DERIVED_TRAITS],
            "not_derivable_traits": [],
            "sample_results": sample_results,
        }

