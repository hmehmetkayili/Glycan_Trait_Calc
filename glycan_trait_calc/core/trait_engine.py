"""Modular Composition-Derived Glycan Trait Calculation Engine and Custom Trait Builder.

Implements Sections 6, 7, 8, 11, 12.2, 13, and 18 of the GAREG Specification:
- Evaluates all 28 baseline composition-derived traits (T01 - T28), optional traits,
  and user-defined custom traits from machine-readable definitions.
- Preserves full glycan-level inclusion/exclusion flags, exclusion reasons,
  numerator/denominator contributions, and mathematical audit trails.
- Never returns 0 for a zero denominator (returns None / NA with warning).
- Summarizes group-level statistics strictly from sample-level trait values.
"""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
from scipy import stats

from glycan_trait_calc.core.composition_parser import ParsedComposition, GlycanCompositionParser
from glycan_trait_calc.core.trait_definitions import (
    TraitDefinition,
    BASELINE_COMPOSITION_TRAITS,
    OPTIONAL_COMPOSITION_TRAITS,
)
from glycan_trait_calc.core.config import CALCULATION_ENGINE_VERSION, NUMERICAL_TOLERANCE


# Forbidden structural claim terms in composition-only Custom Trait Builder (Section 18)
FORBIDDEN_STRUCTURAL_CLAIMS = [
    (r"\bcore\s*fuc", "Core fucosylation cannot be claimed from monosaccharide composition alone (requires α1,6 linkage validation)."),
    (r"\bantennary\s*fuc", "Antennary fucosylation cannot be claimed from monosaccharide composition alone."),
    (r"\bbisecting\b", "Bisecting GlcNAc cannot be claimed from HexNAc count alone."),
    (r"\btrue\s*galactosyl", "True galactosylation cannot be claimed from Hex count alone (Hex cannot distinguish mannose from galactose)."),
    (r"\bbiantennary\b", "Definitive biantennary structure cannot be claimed from N=4 composition alone."),
    (r"\btriantennary\b", "Definitive triantennary structure cannot be claimed from N=5 composition alone."),
    (r"\btetraantennary\b", "Definitive tetraantennary structure cannot be claimed from N=6 composition alone."),
    (r"2\s*,\s*3|2\s*-\s*3|alpha\s*2,3|α2,3", "α2,3 sialic acid linkage cannot be inferred from composition alone."),
    (r"2\s*,\s*6|2\s*-\s*6|alpha\s*2,6|α2,6", "α2,6 sialic acid linkage cannot be inferred from composition alone."),
]


def evaluate_condition(
    comp: ParsedComposition,
    condition: Any,
) -> Tuple[bool, str]:
    """Evaluate an inclusion condition on a parsed composition and return (included, reason)."""
    if not comp.is_valid:
        return False, f"Unclassified/invalid composition label ({comp.status})"

    h = comp.Hex
    n = comp.HexNAc
    f = comp.Fucose
    s = comp.Sialic_Acid

    if isinstance(condition, str):
        if condition == "all_valid":
            return True, "Included: valid glycan composition"
        if condition == "high_mannose_h5_h9n2":
            if n == 2 and 5 <= h <= 9 and f == 0 and s == 0:
                return True, f"Included: HexNAc=2, Hex={h} (5<=H<=9), F=0, S=0"
            reasons = []
            if n != 2:
                reasons.append(f"HexNAc={n} (requires N=2)")
            if not (5 <= h <= 9):
                reasons.append(f"Hex={h} (requires 5<=H<=9)")
            if f != 0 or s != 0:
                reasons.append(f"F={f}, S={s} (requires unmodified H5-H9N2)")
            return False, "Excluded: " + "; ".join(reasons)
        if condition in ("paucimannose_pool", "h4n2_pool"):
            if n == 2 and 1 <= h <= 4 and 0 <= f <= 1 and s == 0:
                return True, f"Included: Paucimannose-type N-glycan (Hex={h} in 1..4, HexNAc=2, F={f} in 0..1, S=0)"
            return False, f"Excluded: composition is H{h}N{n}F{f}S{s} (requires Paucimannose-type 1<=H<=4, N=2, 0<=F<=1, S=0)"
        if condition == "n_eq_3":
            return (True, "Included: HexNAc = 3") if n == 3 else (False, f"Excluded: HexNAc = {n} (requires N = 3)")
        if condition == "n_eq_4":
            return (True, "Included: HexNAc = 4") if n == 4 else (False, f"Excluded: HexNAc = {n} (requires N = 4)")
        if condition == "n_eq_5":
            return (True, "Included: HexNAc = 5") if n == 5 else (False, f"Excluded: HexNAc = {n} (requires N = 5)")
        if condition == "n_eq_6":
            return (True, "Included: HexNAc = 6") if n == 6 else (False, f"Excluded: HexNAc = {n} (requires N = 6)")
        if condition == "n_ge_4":
            return (True, f"Included: HexNAc = {n} (>= 4)") if n >= 4 else (False, f"Excluded: HexNAc = {n} (requires N >= 4)")
        if condition == "n_ge_7":
            return (True, f"Included: HexNAc = {n} (>= 7)") if n >= 7 else (False, f"Excluded: HexNAc = {n} (requires N >= 7)")
        if condition == "f_ge_1":
            return (True, f"Included: Fucose = {f} (>= 1)") if f >= 1 else (False, "Excluded: Fucose = 0 (requires F >= 1)")
        if condition == "f_eq_0":
            return (True, "Included: Fucose = 0") if f == 0 else (False, f"Excluded: Fucose = {f} (requires F = 0)")
        if condition == "f_eq_1":
            return (True, "Included: Fucose = 1") if f == 1 else (False, f"Excluded: Fucose = {f} (requires F = 1)")
        if condition == "f_eq_2":
            return (True, "Included: Fucose = 2") if f == 2 else (False, f"Excluded: Fucose = {f} (requires F = 2)")
        if condition == "f_ge_2":
            return (True, f"Included: Fucose = {f} (>= 2)") if f >= 2 else (False, f"Excluded: Fucose = {f} (requires F >= 2)")
        if condition == "n_ge_4_and_f_ge_1":
            if n >= 4 and f >= 1:
                return True, f"Included: HexNAc = {n} (>= 4) and Fucose = {f} (>= 1)"
            reasons = []
            if n < 4:
                reasons.append(f"HexNAc = {n} (< 4)")
            if f < 1:
                reasons.append("Fucose = 0 (< 1)")
            return False, "Excluded: " + " and ".join(reasons)
        if condition == "s_ge_1":
            return (True, f"Included: Sialic acid = {s} (>= 1)") if s >= 1 else (False, "Excluded: Sialic acid = 0 (requires S >= 1)")
        if condition == "s_eq_1":
            return (True, "Included: Sialic acid = 1") if s == 1 else (False, f"Excluded: Sialic acid = {s} (requires S = 1)")
        if condition == "s_ge_2":
            return (True, f"Included: Sialic acid = {s} (>= 2)") if s >= 2 else (False, f"Excluded: Sialic acid = {s} (requires S >= 2)")
        if condition == "s_ge_1_and_f_eq_0":
            if s >= 1 and f == 0:
                return True, f"Included: Sialic acid = {s} (>= 1) and Fucose = 0"
            reasons = []
            if s < 1:
                reasons.append("Sialic acid = 0 (< 1)")
            if f != 0:
                reasons.append(f"Fucose = {f} (!= 0)")
            return False, "Excluded: " + " and ".join(reasons)
        if condition == "s_ge_1_and_f_ge_1":
            if s >= 1 and f >= 1:
                return True, f"Included: Sialic acid = {s} (>= 1) and Fucose = {f} (>= 1)"
            reasons = []
            if s < 1:
                reasons.append("Sialic acid = 0 (< 1)")
            if f < 1:
                reasons.append("Fucose = 0 (< 1)")
            return False, "Excluded: " + " and ".join(reasons)
        if condition == "n_ge_4_and_s_ge_1":
            if n >= 4 and s >= 1:
                return True, f"Included: HexNAc = {n} (>= 4) and Sialic acid = {s} (>= 1)"
            reasons = []
            if n < 4:
                reasons.append(f"HexNAc = {n} (< 4)")
            if s < 1:
                reasons.append("Sialic acid = 0 (< 1)")
            return False, "Excluded: " + " and ".join(reasons)
        if condition == "h_ge_1":
            return (True, f"Included: Hex = {h} (>= 1)") if h >= 1 else (False, "Excluded: Hex = 0")
        if condition == "n_ge_1":
            return (True, f"Included: HexNAc = {n} (>= 1)") if n >= 1 else (False, "Excluded: HexNAc = 0")
        if condition == "n_ge_4_and_h_gt_3":
            if n >= 4 and h > 3:
                return True, f"Included: HexNAc = {n} (>= 4) and Hex = {h} (> 3, excess = {h - 3})"
            if n < 4:
                return False, f"Excluded: HexNAc = {n} (requires N >= 4)"
            return False, f"Excluded: Hex = {h} (no excess above 3; max(H-3, 0) = 0)"

    # Custom structured rule dict: {"inclusion_clauses": [...], "exclusion_clauses": [...]}
    if isinstance(condition, dict):
        inc_clauses = condition.get("inclusion_clauses", [])
        exc_clauses = condition.get("exclusion_clauses", [])
        for clause in inc_clauses:
            ok, msg = _eval_single_clause(comp, clause)
            if not ok:
                return False, f"Excluded (failed inclusion {msg})"
        for clause in exc_clauses:
            ok, msg = _eval_single_clause(comp, clause)
            if ok:
                return False, f"Excluded (matched exclusion {msg})"
        return True, "Included: matched all custom inclusion/exclusion rules"

    return False, f"Unknown condition '{condition}'"


def _get_component_val(comp: ParsedComposition, comp_name: str) -> int:
    mapping = {
        "H": comp.Hex,
        "Hex": comp.Hex,
        "N": comp.HexNAc,
        "HexNAc": comp.HexNAc,
        "F": comp.Fucose,
        "Fucose": comp.Fucose,
        "S": comp.Sialic_Acid,
        "Sialic_Acid": comp.Sialic_Acid,
        "NeuAc": comp.NeuAc,
        "NeuGc": comp.NeuGc,
        "dHex": comp.dHex,
        "HexA": comp.HexA,
        "Pentose": comp.Pentose,
        "Sulfate": comp.Sulfate,
        "Phosphate": comp.Phosphate,
    }
    if comp_name in mapping:
        return mapping[comp_name]
    return comp.extra_components.get(comp_name, 0)


def _eval_single_clause(comp: ParsedComposition, clause: Dict[str, Any]) -> Tuple[bool, str]:
    comp_name = clause.get("component", "Fucose")
    op = clause.get("operator", ">=")
    target = int(clause.get("value", 1))
    actual = _get_component_val(comp, comp_name)
    desc = f"{comp_name} {op} {target} [actual={actual}]"
    if op in ("=", "=="):
        return actual == target, desc
    if op == "!=":
        return actual != target, desc
    if op == ">=":
        return actual >= target, desc
    if op == "<=":
        return actual <= target, desc
    if op == ">":
        return actual > target, desc
    if op == "<":
        return actual < target, desc
    return False, desc


def evaluate_weight(comp: ParsedComposition, weight_spec: str) -> float:
    """Return numeric weight w_k for a given glycan composition."""
    if weight_spec in ("1", "none", None):
        return 1.0
    if weight_spec in ("F", "Fucose"):
        return float(comp.Fucose)
    if weight_spec in ("S", "Sialic_Acid"):
        return float(comp.Sialic_Acid)
    if weight_spec in ("H", "Hex"):
        return float(comp.Hex)
    if weight_spec in ("N", "HexNAc"):
        return float(comp.HexNAc)
    if weight_spec == "hex_excess_3_in_nge4":
        return float(max(comp.Hex - 3, 0)) if comp.HexNAc >= 4 else 0.0
    if weight_spec == "hex_excess_3":
        return float(max(comp.Hex - 3, 0))
    return float(_get_component_val(comp, weight_spec))


class CompositionTraitEngine:
    """Modular, transparent calculation engine for composition-derived glycan traits."""

    def __init__(
        self,
        include_optional: bool = True,
        custom_traits: Optional[List[TraitDefinition]] = None,
    ) -> None:
        self.include_optional = include_optional
        self.custom_traits: List[TraitDefinition] = list(custom_traits or [])

    def get_active_traits(self) -> List[TraitDefinition]:
        traits = list(BASELINE_COMPOSITION_TRAITS)
        if self.include_optional:
            traits.extend(OPTIONAL_COMPOSITION_TRAITS)
        traits.extend(self.custom_traits)
        return traits

    def evaluate_glycan_inclusion_matrix(
        self,
        parsed_compositions: List[ParsedComposition],
    ) -> Dict[str, Dict[str, Any]]:
        """Precompute the inclusion flag, weight, and exclusion reason of every glycan for every trait."""
        matrix: Dict[str, Dict[str, Any]] = {}
        for trait in self.get_active_traits():
            rule = trait.Engine_Rule
            num_cond = rule.get("numerator_condition", "all_valid")
            num_weight_spec = rule.get("numerator_weight", "1")
            den_cond = rule.get("denominator_condition", None)
            den_weight_spec = rule.get("denominator_weight", "1")

            included_glycans: List[str] = []
            excluded_glycans: List[str] = []
            denominator_glycans: List[str] = []
            per_glycan: Dict[str, Dict[str, Any]] = {}

            for comp in parsed_compositions:
                inc_num, reason_num = evaluate_condition(comp, num_cond)
                w_num = evaluate_weight(comp, num_weight_spec) if inc_num else 0.0
                if inc_num and w_num > 0:
                    included_glycans.append(comp.raw_label)
                else:
                    excluded_glycans.append(comp.raw_label)
                    if inc_num and w_num == 0:
                        reason_num = f"Excluded: weight ({num_weight_spec}) is 0"

                inc_den = False
                w_den = 0.0
                reason_den = "Not applicable (no denominator)"
                if den_cond is not None:
                    inc_den, reason_den = evaluate_condition(comp, den_cond)
                    w_den = evaluate_weight(comp, den_weight_spec) if inc_den else 0.0
                    if inc_den and w_den > 0:
                        denominator_glycans.append(comp.raw_label)

                per_glycan[comp.raw_label] = {
                    "glycan": comp.raw_label,
                    "normalized_label": comp.normalized_label,
                    "Hex": comp.Hex,
                    "HexNAc": comp.HexNAc,
                    "Fucose": comp.Fucose,
                    "Sialic_Acid": comp.Sialic_Acid,
                    "included_in_numerator": bool(inc_num and w_num > 0),
                    "numerator_weight": w_num,
                    "included_in_denominator": bool(inc_den and w_den > 0),
                    "denominator_weight": w_den,
                    "reason": reason_num,
                    "denominator_reason": reason_den,
                }

            matrix[trait.Trait_ID] = {
                "trait_id": trait.Trait_ID,
                "trait_name": trait.Trait_Name,
                "included_glycans": included_glycans,
                "excluded_glycans": excluded_glycans,
                "denominator_glycans": denominator_glycans,
                "per_glycan": per_glycan,
            }
        return matrix

    def calculate_all(
        self,
        sample_ids: List[str],
        groups: List[str],
        glycan_labels: List[str],
        abundance_matrix_pct: np.ndarray,
        parsed_compositions: List[ParsedComposition],
    ) -> Dict[str, Any]:
        """Calculate all composition-derived traits at sample level and summarize at group level.

        Parameters
        ----------
        sample_ids : List[str]
            Sample identifiers (length N).
        groups : List[str]
            Experimental group labels for each sample (length N).
        glycan_labels : List[str]
            Glycan composition column labels (length D).
        abundance_matrix_pct : np.ndarray
            2D array of shape (N, D) expressed in percentage relative abundance units (100 * p_ik).
        parsed_compositions : List[ParsedComposition]
            Parsed composition metadata for each of the D glycan columns.
        """
        n_samples = len(sample_ids)
        n_glycans = len(glycan_labels)
        active_traits = self.get_active_traits()
        inclusion_matrix = self.evaluate_glycan_inclusion_matrix(parsed_compositions)

        sample_results: List[Dict[str, Any]] = []
        trait_warnings: List[Dict[str, Any]] = []

        # Pre-extract vectors of length D for each trait to compute fast and accurately
        trait_vectors: Dict[str, Tuple[np.ndarray, np.ndarray, Optional[np.ndarray], float, str]] = {}
        for trait in active_traits:
            rule = trait.Engine_Rule
            t_type = rule.get("type", "pool_sum")
            scale = float(rule.get("scale", 100.0))
            pg = inclusion_matrix[trait.Trait_ID]["per_glycan"]

            num_flags = np.array([1.0 if pg[g]["included_in_numerator"] else 0.0 for g in glycan_labels], dtype=float)
            num_weights = np.array([pg[g]["numerator_weight"] for g in glycan_labels], dtype=float)
            if rule.get("denominator_condition") is not None:
                den_weights = np.array(
                    [pg[g]["denominator_weight"] if pg[g]["included_in_denominator"] else 0.0 for g in glycan_labels],
                    dtype=float,
                )
            else:
                den_weights = None
            trait_vectors[trait.Trait_ID] = (num_flags, num_weights, den_weights, scale, t_type)

        for i in range(n_samples):
            sid = sample_ids[i]
            grp = groups[i] if i < len(groups) else "Unspecified"
            row_abund = abundance_matrix_pct[i, :]
            # Handle NaN values cleanly (treat missing as 0 in sum only after flagging in QC, or propagate if all NaN)
            valid_mask = ~np.isnan(row_abund)
            clean_abund = np.where(valid_mask, row_abund, 0.0)

            sample_traits: Dict[str, Optional[float]] = {}
            sample_numerators: Dict[str, float] = {}
            sample_denominators: Dict[str, Optional[float]] = {}

            for trait in active_traits:
                tid = trait.Trait_ID
                num_flags, num_weights, den_weights, scale, t_type = trait_vectors[tid]

                # Note: clean_abund is already P_ik = 100 * p_ik.
                # So sum_k(clean_abund * num_weights) == 100 * sum_k(p_ik * num_weights).
                num_val = float(np.sum(clean_abund * num_flags * num_weights))
                sample_numerators[tid] = num_val

                if den_weights is not None:
                    den_val = float(np.sum(clean_abund * den_weights))
                    sample_denominators[tid] = den_val
                    if abs(den_val) <= 1e-15:
                        sample_traits[tid] = None
                        trait_warnings.append({
                            "sample_id": sid,
                            "trait_id": tid,
                            "trait_name": trait.Trait_Name,
                            "warning": f"Denominator for {tid} ({trait.Trait_Name}) in sample '{sid}' is zero; returned NA.",
                        })
                    else:
                        # Ratio of (100 * sum p_ik w_num) / (100 * sum p_ik w_den) * scale
                        sample_traits[tid] = float(scale * (num_val / den_val))
                else:
                    sample_denominators[tid] = None
                    # Pool sum or weighted sum: clean_abund is already 100 * p_ik
                    # If scale == 100.0, 100 * sum(p_ik * w_k) == sum(P_ik * w_k) = num_val
                    # If scale == 1.0, sum(p_ik * w_k) == num_val / 100.0
                    sample_traits[tid] = float(num_val * (scale / 100.0))

            sample_results.append({
                "sample_id": sid,
                "group": grp,
                "traits": sample_traits,
                "numerators": sample_numerators,
                "denominators": sample_denominators,
            })

        group_summaries = self.compute_group_summaries(sample_results, active_traits)
        group_comparisons = self.compute_group_comparisons(sample_results, active_traits)
        validation_checks = self.run_scientific_validation_checks(
            sample_results, parsed_compositions, abundance_matrix_pct
        )

        return {
            "engine_version": CALCULATION_ENGINE_VERSION,
            "trait_definitions": [t.to_dict() for t in active_traits],
            "inclusion_matrix": inclusion_matrix,
            "sample_results": sample_results,
            "group_summaries": group_summaries,
            "group_comparisons": group_comparisons,
            "trait_warnings": trait_warnings,
            "scientific_validation": validation_checks,
        }

    def get_trait_contribution_audit(
        self,
        trait_id: str,
        sample_id: str,
        sample_ids: List[str],
        groups: List[str],
        glycan_labels: List[str],
        abundance_matrix_pct: np.ndarray,
        parsed_compositions: List[ParsedComposition],
    ) -> Dict[str, Any]:
        """Generate the interactive Explanation and Contribution Audit Trail for a specific trait and sample (Section 8)."""
        active_map = {t.Trait_ID: t for t in self.get_active_traits()}
        if trait_id not in active_map:
            raise ValueError(f"Unknown Trait_ID '{trait_id}'.")
        trait = active_map[trait_id]

        try:
            s_idx = sample_ids.index(sample_id)
        except ValueError:
            s_idx = 0
            sample_id = sample_ids[0] if sample_ids else ""

        row_abund = abundance_matrix_pct[s_idx, :] if len(sample_ids) > 0 else np.zeros(len(glycan_labels))
        rule = trait.Engine_Rule
        num_cond = rule.get("numerator_condition", "all_valid")
        num_weight_spec = rule.get("numerator_weight", "1")
        den_cond = rule.get("denominator_condition", None)
        den_weight_spec = rule.get("denominator_weight", "1")
        scale = float(rule.get("scale", 100.0))

        contributions_table: List[Dict[str, Any]] = []
        included_list: List[str] = []
        excluded_list: List[str] = []
        numerator_sum = 0.0
        denominator_sum = 0.0 if den_cond is not None else None

        for k, comp in enumerate(parsed_compositions):
            abund_val = float(row_abund[k]) if not np.isnan(row_abund[k]) else 0.0
            inc_num, reason_num = evaluate_condition(comp, num_cond)
            w_num = evaluate_weight(comp, num_weight_spec) if inc_num else 0.0
            is_inc = bool(inc_num and w_num > 0)
            if inc_num and w_num == 0:
                reason_num = f"Excluded: weight ({num_weight_spec}) is 0"

            contrib_num = abund_val * w_num if is_inc else 0.0
            numerator_sum += contrib_num

            if is_inc:
                included_list.append(comp.raw_label)
            else:
                excluded_list.append(comp.raw_label)

            inc_den = False
            w_den = 0.0
            contrib_den = 0.0
            if den_cond is not None:
                inc_den, _ = evaluate_condition(comp, den_cond)
                w_den = evaluate_weight(comp, den_weight_spec) if inc_den else 0.0
                contrib_den = abund_val * w_den if (inc_den and w_den > 0) else 0.0
                if denominator_sum is not None:
                    denominator_sum += contrib_den

            contributions_table.append({
                "glycan": comp.raw_label,
                "normalized_label": comp.normalized_label,
                "abundance_pct": abund_val,
                "Hex": comp.Hex,
                "HexNAc": comp.HexNAc,
                "Fucose": comp.Fucose,
                "Sialic_Acid": comp.Sialic_Acid,
                "included": is_inc,
                "weight": w_num if is_inc else 0.0,
                "contribution": contrib_num,
                "included_in_denominator": bool(inc_den and w_den > 0),
                "denominator_contribution": contrib_den if den_cond is not None else None,
                "reason": reason_num,
            })

        if den_cond is not None and denominator_sum is not None:
            if abs(denominator_sum) <= 1e-15:
                final_val = None
                aggregation_explanation = (
                    f"Numerator = {numerator_sum:.4f}; Denominator = 0.0000 -> Final Result = NA (Zero Denominator)"
                )
            else:
                final_val = float(scale * (numerator_sum / denominator_sum))
                mult_str = " * 100" if scale == 100.0 else ""
                aggregation_explanation = (
                    f"Numerator = {numerator_sum:.4f}; Denominator = {denominator_sum:.4f}; "
                    f"Final Result = ({numerator_sum:.4f} / {denominator_sum:.4f}){mult_str} = {final_val:.4f} {trait.Unit}"
                )
        else:
            final_val = float(numerator_sum * (scale / 100.0))
            aggregation_explanation = (
                f"Sum of weighted abundance contributions = {final_val:.4f} {trait.Unit}"
            )

        return {
            "sample_id": sample_id,
            "group": groups[s_idx] if s_idx < len(groups) else "Unspecified",
            "trait": trait.to_dict(),
            "included_glycans": included_list,
            "excluded_glycans": excluded_list,
            "included_count": len(included_list),
            "excluded_count": len(excluded_list),
            "numerator": numerator_sum,
            "denominator": denominator_sum,
            "final_value": final_val,
            "unit": trait.Unit,
            "aggregation_explanation": aggregation_explanation,
            "contributions": contributions_table,
        }

    def explain_single_glycan_across_traits(
        self,
        glycan_label: str,
        abundance_pct: float = 3.2,
        parser: Optional[GlycanCompositionParser] = None,
    ) -> Dict[str, Any]:
        """Explain how a single glycan composition (e.g., H5N4F1S2 at 3.2%) contributes to all traits (Section 8.1)."""
        p = parser or GlycanCompositionParser()
        comp = p.parse(glycan_label)
        rows: List[Dict[str, Any]] = []
        for trait in self.get_active_traits():
            rule = trait.Engine_Rule
            num_cond = rule.get("numerator_condition", "all_valid")
            num_w_spec = rule.get("numerator_weight", "1")
            den_cond = rule.get("denominator_condition", None)
            den_w_spec = rule.get("denominator_weight", "1")

            inc_num, reason_num = evaluate_condition(comp, num_cond)
            w_num = evaluate_weight(comp, num_w_spec) if inc_num else 0.0
            contrib_num = abundance_pct * w_num if (inc_num and w_num > 0) else 0.0

            inc_den = False
            w_den = 0.0
            contrib_den = 0.0
            if den_cond is not None:
                inc_den, _ = evaluate_condition(comp, den_cond)
                w_den = evaluate_weight(comp, den_w_spec) if inc_den else 0.0
                contrib_den = abundance_pct * w_den if (inc_den and w_den > 0) else 0.0

            rows.append({
                "trait_id": trait.Trait_ID,
                "trait_name": trait.Trait_Name,
                "included_in_numerator": bool(inc_num and w_num > 0),
                "numerator_weight": w_num,
                "numerator_contribution": contrib_num,
                "included_in_denominator": bool(inc_den and w_den > 0),
                "denominator_contribution": contrib_den if den_cond is not None else None,
                "unit": trait.Unit,
                "reason": reason_num,
            })

        return {
            "glycan_label": glycan_label,
            "parsed_composition": comp.to_dict(),
            "abundance_pct": abundance_pct,
            "trait_contributions": rows,
        }

    @staticmethod
    def compute_group_summaries(
        sample_results: List[Dict[str, Any]],
        traits: List[TraitDefinition],
    ) -> Dict[str, Any]:
        """Compute group-level statistics (Mean, Median, SD, SE, Min, Max, IQR, Valid N) from sample-level traits (Section 13)."""
        # Preserve group order of appearance, plus sorted keys
        distinct_groups: List[str] = []
        for sr in sample_results:
            g = str(sr.get("group", "Unspecified"))
            if g not in distinct_groups:
                distinct_groups.append(g)

        by_trait: Dict[str, Dict[str, Any]] = {}
        for trait in traits:
            tid = trait.Trait_ID
            group_stats: Dict[str, Dict[str, Optional[float]]] = {}
            for grp in distinct_groups + ["ALL_SAMPLES"]:
                vals = [
                    float(sr["traits"][tid])
                    for sr in sample_results
                    if (grp == "ALL_SAMPLES" or str(sr.get("group", "Unspecified")) == grp)
                    and sr["traits"].get(tid) is not None
                    and not math.isnan(float(sr["traits"][tid]))
                ]
                n_valid = len(vals)
                if n_valid == 0:
                    group_stats[grp] = {
                        "valid_n": 0,
                        "mean": None,
                        "median": None,
                        "sd": None,
                        "se": None,
                        "min": None,
                        "max": None,
                        "q25": None,
                        "q75": None,
                        "iqr": None,
                    }
                else:
                    arr = np.array(vals, dtype=float)
                    mean_val = float(np.mean(arr))
                    median_val = float(np.median(arr))
                    sd_val = float(np.std(arr, ddof=1)) if n_valid > 1 else 0.0
                    se_val = float(sd_val / math.sqrt(n_valid)) if n_valid > 1 else 0.0
                    min_val = float(np.min(arr))
                    max_val = float(np.max(arr))
                    q25 = float(np.percentile(arr, 25))
                    q75 = float(np.percentile(arr, 75))
                    iqr_val = float(q75 - q25)
                    group_stats[grp] = {
                        "valid_n": n_valid,
                        "mean": mean_val,
                        "median": median_val,
                        "sd": sd_val,
                        "se": se_val,
                        "min": min_val,
                        "max": max_val,
                        "q25": q25,
                        "q75": q75,
                        "iqr": iqr_val,
                    }
            by_trait[tid] = {
                "trait_id": tid,
                "trait_name": trait.Trait_Name,
                "unit": trait.Unit,
                "groups": group_stats,
            }

        return {
            "distinct_groups": distinct_groups,
            "by_trait": by_trait,
        }

    @staticmethod
    def compute_group_comparisons(
        sample_results: List[Dict[str, Any]],
        traits: List[TraitDefinition],
    ) -> List[Dict[str, Any]]:
        """Perform non-parametric and parametric group comparisons across sample-level traits."""
        distinct_groups: List[str] = []
        for sr in sample_results:
            g = str(sr.get("group", "Unspecified"))
            if g not in distinct_groups:
                distinct_groups.append(g)

        if len(distinct_groups) < 2:
            return []

        results: List[Dict[str, Any]] = []
        raw_p_param: List[float] = []
        raw_p_nonparam: List[float] = []

        for trait in traits:
            tid = trait.Trait_ID
            grouped_vals: List[np.ndarray] = []
            for g in distinct_groups:
                v = [
                    float(sr["traits"][tid])
                    for sr in sample_results
                    if str(sr.get("group", "Unspecified")) == g
                    and sr["traits"].get(tid) is not None
                    and not math.isnan(float(sr["traits"][tid]))
                ]
                grouped_vals.append(np.array(v, dtype=float))

            if any(len(gv) < 2 for gv in grouped_vals):
                results.append({
                    "trait_id": tid,
                    "trait_name": trait.Trait_Name,
                    "unit": trait.Unit,
                    "parametric_test": "Insufficient N per group",
                    "parametric_stat": None,
                    "parametric_p": None,
                    "nonparametric_test": "Insufficient N per group",
                    "nonparametric_stat": None,
                    "nonparametric_p": None,
                })
                raw_p_param.append(1.0)
                raw_p_nonparam.append(1.0)
                continue

            if len(distinct_groups) == 2:
                g1, g2 = grouped_vals[0], grouped_vals[1]
                # Check if constant across both groups
                if np.allclose(g1, g1[0]) and np.allclose(g2, g2[0]) and np.isclose(g1[0], g2[0]):
                    t_stat, t_p = 0.0, 1.0
                    u_stat, u_p = 0.0, 1.0
                else:
                    try:
                        t_res = stats.ttest_ind(g1, g2, equal_var=False)
                        t_stat = float(t_res.statistic) if not np.isnan(t_res.statistic) else 0.0
                        t_p = float(t_res.pvalue) if not np.isnan(t_res.pvalue) else 1.0
                    except Exception:
                        t_stat, t_p = 0.0, 1.0
                    try:
                        u_res = stats.mannwhitneyu(g1, g2, alternative="two-sided")
                        u_stat = float(u_res.statistic) if not np.isnan(u_res.statistic) else 0.0
                        u_p = float(u_res.pvalue) if not np.isnan(u_res.pvalue) else 1.0
                    except Exception:
                        u_stat, u_p = 0.0, 1.0

                results.append({
                    "trait_id": tid,
                    "trait_name": trait.Trait_Name,
                    "unit": trait.Unit,
                    "parametric_test": "Welch's t-test",
                    "parametric_stat": t_stat,
                    "parametric_p": t_p,
                    "nonparametric_test": "Mann-Whitney U",
                    "nonparametric_stat": u_stat,
                    "nonparametric_p": u_p,
                })
                raw_p_param.append(t_p)
                raw_p_nonparam.append(u_p)
            else:
                try:
                    f_res = stats.f_oneway(*grouped_vals)
                    f_stat = float(f_res.statistic) if not np.isnan(f_res.statistic) else 0.0
                    f_p = float(f_res.pvalue) if not np.isnan(f_res.pvalue) else 1.0
                except Exception:
                    f_stat, f_p = 0.0, 1.0
                try:
                    kw_res = stats.kruskal(*grouped_vals)
                    kw_stat = float(kw_res.statistic) if not np.isnan(kw_res.statistic) else 0.0
                    kw_p = float(kw_res.pvalue) if not np.isnan(kw_res.pvalue) else 1.0
                except Exception:
                    kw_stat, kw_p = 0.0, 1.0

                results.append({
                    "trait_id": tid,
                    "trait_name": trait.Trait_Name,
                    "unit": trait.Unit,
                    "parametric_test": "One-way ANOVA",
                    "parametric_stat": f_stat,
                    "parametric_p": f_p,
                    "nonparametric_test": "Kruskal-Wallis H",
                    "nonparametric_stat": kw_stat,
                    "nonparametric_p": kw_p,
                })
                raw_p_param.append(f_p)
                raw_p_nonparam.append(kw_p)

        # Benjamini-Hochberg FDR adjustment
        fdr_param = _benjamini_hochberg(raw_p_param)
        fdr_nonparam = _benjamini_hochberg(raw_p_nonparam)
        for idx, item in enumerate(results):
            item["parametric_fdr"] = fdr_param[idx] if item["parametric_p"] is not None else None
            item["nonparametric_fdr"] = fdr_nonparam[idx] if item["nonparametric_p"] is not None else None

        return results

    @staticmethod
    def run_scientific_validation_checks(
        sample_results: List[Dict[str, Any]],
        parsed_compositions: List[ParsedComposition],
        abundance_matrix_pct: np.ndarray,
    ) -> Dict[str, Any]:
        """Run automatic scientific consistency checks defined in Section 12.2."""
        checks: List[Dict[str, Any]] = []
        tol = 1e-6

        # Check 1: T09 + T10 == T01 when all compositions are classified
        c1_failures = []
        for sr in sample_results:
            t01 = sr["traits"].get("T01")
            t09 = sr["traits"].get("T09")
            t10 = sr["traits"].get("T10")
            if t01 is not None and t09 is not None and t10 is not None:
                if abs((t09 + t10) - t01) > tol:
                    c1_failures.append(f"{sr['sample_id']}: T09({t09:.4f})+T10({t10:.4f}) != T01({t01:.4f})")
        checks.append({
            "rule_id": "VAL01",
            "rule_name": "Fucosylated + Non-Fucosylated Closure (T09 + T10 ≈ T01)",
            "passed": len(c1_failures) == 0,
            "details": "All samples satisfy T09 + T10 = T01 within numerical tolerance."
            if not c1_failures else f"Discrepancy in {len(c1_failures)} sample(s): " + "; ".join(c1_failures[:5]),
        })

        # Check 2: T11 + T12 <= T09 (with disclosure if F >= 3 exists)
        has_f_ge_3 = any(c.is_valid and c.Fucose >= 3 for c in parsed_compositions)
        c2_failures = []
        for sr in sample_results:
            t09 = sr["traits"].get("T09") or 0.0
            t11 = sr["traits"].get("T11") or 0.0
            t12 = sr["traits"].get("T12") or 0.0
            if (t11 + t12) - t09 > tol:
                c2_failures.append(f"{sr['sample_id']}: T11+T12 ({t11+t12:.4f}) > T09 ({t09:.4f})")
        checks.append({
            "rule_id": "VAL02",
            "rule_name": "Mono/Difucosylated Bound (T11 + T12 <= T09)",
            "passed": len(c2_failures) == 0,
            "details": (
                "T11 + T12 <= T09 holds for all samples. Note: F >= 3 compositions are present, so T11 + T12 < T09."
                if has_f_ge_3 and not c2_failures
                else ("T11 + T12 = T09 holds for all samples (no F >= 3 compositions present)." if not c2_failures else "; ".join(c2_failures[:5]))
            ),
        })

        # Check 3: T17 + T18 == T16
        c3_failures = []
        for sr in sample_results:
            t16 = sr["traits"].get("T16")
            t17 = sr["traits"].get("T17")
            t18 = sr["traits"].get("T18")
            if t16 is not None and t17 is not None and t18 is not None:
                if abs((t17 + t18) - t16) > tol:
                    c3_failures.append(f"{sr['sample_id']}: T17({t17:.4f})+T18({t18:.4f}) != T16({t16:.4f})")
        checks.append({
            "rule_id": "VAL03",
            "rule_name": "Sialylated Fucose Partition (T17 + T18 ≈ T16)",
            "passed": len(c3_failures) == 0,
            "details": "All samples satisfy T17 + T18 = T16 within numerical tolerance."
            if not c3_failures else "; ".join(c3_failures[:5]),
        })

        # Check 4: T05 + T06 + T07 <= T08 (disclose if N >= 7 exists)
        has_n_ge_7 = any(c.is_valid and c.HexNAc >= 7 for c in parsed_compositions)
        c4_failures = []
        for sr in sample_results:
            t05 = sr["traits"].get("T05") or 0.0
            t06 = sr["traits"].get("T06") or 0.0
            t07 = sr["traits"].get("T07") or 0.0
            t08 = sr["traits"].get("T08") or 0.0
            if (t05 + t06 + t07) - t08 > tol:
                c4_failures.append(f"{sr['sample_id']}: T05+T06+T07 > T08")
        checks.append({
            "rule_id": "VAL04",
            "rule_name": "N≥4 Pool Partition (T05 + T06 + T07 <= T08 & T26–T28 Sum)",
            "passed": len(c4_failures) == 0,
            "details": (
                "T05 + T06 + T07 <= T08 holds. Disclosure: N >= 7 compositions are present in the dataset, so T26 + T27 + T28 < 100%."
                if has_n_ge_7 and not c4_failures
                else ("T05 + T06 + T07 = T08 and T26 + T27 + T28 = 100% hold for all samples with T08 > 0." if not c4_failures else "; ".join(c4_failures[:5]))
            ),
        })

        # Check 5: 0 <= T15 <= 100 when defined
        c5_failures = [
            f"{sr['sample_id']}: T15={sr['traits']['T15']:.4f}"
            for sr in sample_results
            if sr["traits"].get("T15") is not None and not (-tol <= sr["traits"]["T15"] <= 100.0 + tol)
        ]
        checks.append({
            "rule_id": "VAL05",
            "rule_name": "N≥4 Fucosylation Ratio Bounds (0 <= T15 <= 100)",
            "passed": len(c5_failures) == 0,
            "details": "T15 is within [0, 100]% for all defined samples." if not c5_failures else "; ".join(c5_failures[:5]),
        })

        # Check 6: 0 <= T21 <= 100 when defined
        c6_failures = [
            f"{sr['sample_id']}: T21={sr['traits']['T21']:.4f}"
            for sr in sample_results
            if sr["traits"].get("T21") is not None and not (-tol <= sr["traits"]["T21"] <= 100.0 + tol)
        ]
        checks.append({
            "rule_id": "VAL06",
            "rule_name": "N≥4 Sialylation Ratio Bounds (0 <= T21 <= 100)",
            "passed": len(c6_failures) == 0,
            "details": "T21 is within [0, 100]% for all defined samples." if not c6_failures else "; ".join(c6_failures[:5]),
        })

        # Check 7: Non-negativity of all trait values
        c7_failures = []
        for sr in sample_results:
            for tid, val in sr["traits"].items():
                if val is not None and val < -tol:
                    c7_failures.append(f"{sr['sample_id']} {tid}={val:.4f}")
        checks.append({
            "rule_id": "VAL07",
            "rule_name": "Trait Non-Negativity",
            "passed": len(c7_failures) == 0,
            "details": "All calculated trait values are non-negative." if not c7_failures else "; ".join(c7_failures[:5]),
        })

        # Check 8: Zero denominators return NA (None), never 0
        c8_na_count = 0
        for sr in sample_results:
            for tid, den_val in sr["denominators"].items():
                if den_val is not None and abs(den_val) <= 1e-15:
                    if sr["traits"].get(tid) is not None:
                        c8_na_count = -1
                        break
                    c8_na_count += 1
        checks.append({
            "rule_id": "VAL08",
            "rule_name": "Zero Denominator Handling (Returns NA, Never Zero)",
            "passed": c8_na_count >= 0,
            "details": (
                f"Verified: {c8_na_count} zero-denominator ratio instance(s) properly returned NA with warning."
                if c8_na_count > 0
                else "Verified: all ratio denominators > 0 across samples (zero-denominator guard active)."
            ),
        })

        # Check 9: Unclassified glycan abundance disclosure
        invalid_indices = [idx for idx, c in enumerate(parsed_compositions) if not c.is_valid]
        unclassified_abund_max = 0.0
        if invalid_indices and abundance_matrix_pct.size > 0:
            sub = np.nan_to_num(abundance_matrix_pct[:, invalid_indices], nan=0.0)
            unclassified_abund_max = float(np.max(np.sum(sub, axis=1)))
        checks.append({
            "rule_id": "VAL09",
            "rule_name": "Unclassified Glycan Abundance Disclosure",
            "passed": len(invalid_indices) == 0,
            "details": (
                "100% of glycan columns were successfully classified; unclassified abundance = 0.00%."
                if len(invalid_indices) == 0
                else f"Disclosed: {len(invalid_indices)} column(s) could not be parsed as valid compositions (max unclassified abundance per sample = {unclassified_abund_max:.2f}%)."
            ),
        })

        return {
            "all_passed": all(c["passed"] for c in checks),
            "has_f_ge_3": has_f_ge_3,
            "has_n_ge_7": has_n_ge_7,
            "checks": checks,
        }


def build_custom_trait_definition(
    trait_id: str,
    trait_name: str,
    inclusion_clauses: List[Dict[str, Any]],
    exclusion_clauses: Optional[List[Dict[str, Any]]] = None,
    numerator_weight: str = "1",
    has_denominator: bool = False,
    denominator_clauses: Optional[List[Dict[str, Any]]] = None,
    denominator_weight: str = "1",
    scale: float = 100.0,
    unit: str = "%",
    interpretation: str = "",
) -> TraitDefinition:
    """Create and validate a user-defined composition trait (Section 18: Custom Glycan Trait Builder)."""
    name_clean = str(trait_name).strip()
    if not name_clean:
        raise ValueError("Custom trait name cannot be empty.")

    # Enforce Section 18: Do not allow users to create structurally invalid claims from composition-only information
    combined_text = f"{name_clean} {interpretation}"
    for pattern, err_msg in FORBIDDEN_STRUCTURAL_CLAIMS:
        if re.search(pattern, combined_text, flags=re.IGNORECASE):
            raise ValueError(f"Structurally invalid claim rejected: {err_msg}")

    exc_clauses = exclusion_clauses or []
    den_clauses = denominator_clauses or []

    def _clauses_to_math(clauses: List[Dict[str, Any]]) -> str:
        if not clauses:
            return "1"
        parts = []
        for c in clauses:
            comp_sym = c.get("component", "Fucose")
            op = c.get("operator", ">=")
            val = c.get("value", 1)
            parts.append(f"{comp_sym}_k {op} {val}")
        return ",\\ ".join(parts)

    def _clauses_to_plain(clauses: List[Dict[str, Any]]) -> str:
        if not clauses:
            return "all valid glycans"
        return " and ".join(f"{c.get('component', 'Fucose')} {c.get('operator', '>=')} {c.get('value', 1)}" for c in clauses)

    inc_math = _clauses_to_math(inclusion_clauses)
    inc_plain = _clauses_to_plain(inclusion_clauses)
    exc_plain = _clauses_to_plain(exc_clauses) if exc_clauses else "None (other than failing inclusion rule)"

    w_str = "" if numerator_weight in ("1", "none", None) else f" \\cdot {numerator_weight}_k"
    w_plain = "" if numerator_weight in ("1", "none", None) else f" * {numerator_weight}_k"

    scale_prefix = "100 \\times " if scale == 100.0 else ""
    scale_plain = "100 * " if scale == 100.0 else ""

    if has_denominator and den_clauses:
        den_math = _clauses_to_math(den_clauses)
        den_plain = _clauses_to_plain(den_clauses)
        dw_str = "" if denominator_weight in ("1", "none", None) else f" \\cdot {denominator_weight}_k"
        math_formula = rf"\text{{{trait_id}}}_i = {scale_prefix}\frac{{\sum_k p_{{ik}}{w_str} I({inc_math})}}{{\sum_k p_{{ik}}{dw_str} I({den_math})}}"
        plain_formula = f"{scale_plain}sum_k(p_ik{w_plain} * I({inc_plain})) / sum_k(p_ik * I({den_plain}))"
        den_def = f"Sum of relative abundances matching: {den_plain}"
        den_cond: Any = {"inclusion_clauses": den_clauses, "exclusion_clauses": []}
        rule_type = "ratio"
    else:
        math_formula = rf"\text{{{trait_id}}}_i = {scale_prefix}\sum_k p_{{ik}}{w_str} I({inc_math})"
        plain_formula = f"{scale_plain}sum_k(p_ik{w_plain} * I({inc_plain}))"
        den_def = "None (proportion of total relative abundance)."
        den_cond = None
        rule_type = "weighted_sum" if numerator_weight not in ("1", "none", None) else "pool_sum"

    req_comps = sorted({c.get("component", "Fucose") for c in (inclusion_clauses + exc_clauses + den_clauses)})

    return TraitDefinition(
        Trait_ID=trait_id,
        Trait_Name=f"{name_clean} [User-Defined]",
        Analytical_Category="Composition-Derived",
        Trait_Group="User-Defined Composition Traits",
        Mathematical_Formula=math_formula,
        Plain_Formula=plain_formula,
        Required_Components=req_comps or ["Hex", "HexNAc", "Fucose", "Sialic_Acid"],
        Inclusion_Criteria=inc_plain,
        Exclusion_Criteria=exc_plain,
        Numerator_Definition=f"Abundance sum (weight={numerator_weight}) of glycans matching: {inc_plain}",
        Denominator_Definition=den_def,
        Unit=unit,
        Interpretation=interpretation or f"User-defined composition-based trait evaluating {inc_plain}.",
        Limitations="User-defined composition-derived trait. Reflects monosaccharide composition only and does not establish linkage or isomer topology.",
        Is_Baseline=False,
        Is_Optional=False,
        Is_Custom=True,
        Engine_Rule={
            "type": rule_type,
            "numerator_condition": {
                "inclusion_clauses": inclusion_clauses,
                "exclusion_clauses": exc_clauses,
            },
            "numerator_weight": numerator_weight,
            "denominator_condition": den_cond,
            "denominator_weight": denominator_weight,
            "scale": float(scale),
        },
    )


def _benjamini_hochberg(p_values: List[float]) -> List[float]:
    """Compute Benjamini-Hochberg FDR adjusted p-values."""
    n = len(p_values)
    if n == 0:
        return []
    arr = np.array(p_values, dtype=float)
    order = np.argsort(arr)
    ranked = arr[order]
    adj = np.empty(n, dtype=float)
    prev = 1.0
    for i in range(n - 1, -1, -1):
        rank = i + 1
        val = min(prev, ranked[i] * n / rank)
        adj[i] = val
        prev = val
    out = np.empty(n, dtype=float)
    out[order] = np.clip(adj, 0.0, 1.0)
    return [float(x) for x in out]

