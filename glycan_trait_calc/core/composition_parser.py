"""Dedicated Glycan Composition Parser and Configurable Monosaccharide Dictionary.

Implements Section 5 of the GAREG Glycomic Trait Analyzer Specification:
- Recognizes standard monosaccharide symbols (H, N, F, S) and extended notations
  (NeuAc, NeuGc, dHex, HexA, Pentose, Sulfated residues, user-defined symbols)
  regardless of ordering.
- Assigns zero to genuinely absent components.
- Distinguishes invalid labels from valid compositions with zero components.
- Detects unknown symbols and prevents duplicate component assignments.
- Does NOT assume generic 'S' is NeuAc unless explicitly specified.
- Confirms whether 'F' represents fucose rather than unspecified deoxyhexose via
  configurable component dictionary.
- Supports manual user correction of parsed compositions with full provenance.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_COMPONENT_DICTIONARY: Dict[str, Dict[str, Any]] = {
    "H": {
        "canonical": "Hex",
        "name": "Hexose (Hex)",
        "aliases": ["H", "Hex"],
        "description": "Generic hexose residue (e.g., Mannose, Galactose, Glucose). Composition alone does not distinguish isomers.",
        "is_core_standard": True,
    },
    "N": {
        "canonical": "HexNAc",
        "name": "N-acetylhexosamine (HexNAc)",
        "aliases": ["N", "HexNAc"],
        "description": "N-acetylhexosamine residue (e.g., GlcNAc, GalNAc). Composition alone does not distinguish bisecting vs. antennary GlcNAc.",
        "is_core_standard": True,
    },
    "F": {
        "canonical": "Fucose",
        "name": "Fucose (Fuc)",
        "aliases": ["F", "Fuc"],
        "description": "Fucose residue (confirmed deoxyhexose = Fucose by dictionary setting). Does not specify core (alpha1,6) vs. antennary linkage.",
        "is_core_standard": True,
        "confirmed_fucose": True,
    },
    "S": {
        "canonical": "Sialic_Acid",
        "name": "Sialic acid, type unspecified (S)",
        "aliases": ["S", "Sia"],
        "description": "Generic sialic acid residue. Not assumed to be Neu5Ac unless explicitly annotated; linkage (alpha2,3 vs. alpha2,6) is unspecified.",
        "is_core_standard": True,
        "sialic_subtype": "unspecified",
    },
    "NeuAc": {
        "canonical": "NeuAc",
        "name": "N-acetylneuraminic acid (Neu5Ac)",
        "aliases": ["NeuAc", "Neu5Ac"],
        "description": "Explicitly annotated N-acetylneuraminic acid residue. Contributes to total sialic acid count while preserving NeuAc identity.",
        "is_core_standard": False,
        "contributes_to": "Sialic_Acid",
    },
    "NeuGc": {
        "canonical": "NeuGc",
        "name": "N-glycolylneuraminic acid (Neu5Gc)",
        "aliases": ["NeuGc", "Neu5Gc"],
        "description": "Explicitly annotated N-glycolylneuraminic acid residue. Contributes to total sialic acid count while preserving NeuGc identity.",
        "is_core_standard": False,
        "contributes_to": "Sialic_Acid",
    },
    "dHex": {
        "canonical": "dHex",
        "name": "Deoxyhexose, type unspecified (dHex)",
        "aliases": ["dHex"],
        "description": "Unspecified deoxyhexose residue. Only counted as Fucose if explicitly mapped by user configuration.",
        "is_core_standard": False,
    },
    "HexA": {
        "canonical": "HexA",
        "name": "Hexuronic acid (HexA)",
        "aliases": ["HexA", "GlcA", "IdoA"],
        "description": "Hexuronic acid residue (e.g., glucuronic or iduronic acid).",
        "is_core_standard": False,
    },
    "Pentose": {
        "canonical": "Pentose",
        "name": "Pentose (Pent)",
        "aliases": ["Pent", "Pentose", "Xyl"],
        "description": "Pentose residue (e.g., Xylose).",
        "is_core_standard": False,
    },
    "Sulfate": {
        "canonical": "Sulfate",
        "name": "Sulfated residue (Su/SO3)",
        "aliases": ["Su", "Sulf", "SO3"],
        "description": "Sulfate modification on glycan residues.",
        "is_core_standard": False,
    },
    "Phosphate": {
        "canonical": "Phosphate",
        "name": "Phosphorylated residue (P/PO3)",
        "aliases": ["Phos", "PO3"],
        "description": "Phosphate modification on glycan residues.",
        "is_core_standard": False,
    },
}

# Common non-glycan metadata header names to immediately reject as glycan compositions
NON_GLYCAN_HEADERS = {
    "sample", "sample_id", "sampleid", "id", "group", "cohort", "class", "condition",
    "status", "diagnosis", "age", "sex", "gender", "stage", "disease_stage",
    "treatment", "treatment_status", "batch", "plate", "run", "patient", "patient_id",
    "subject", "subject_id", "time", "timepoint", "visit", "replicate", "notes",
    "comment", "comments", "total", "sum", "mean", "sd", "cv", "qc", "index",
    "total_abundance_formula", "zero_count_formula", "qc_status_formula",
}


@dataclass
class ParsedComposition:
    """Structured result of parsing a single glycan composition label."""
    raw_label: str
    normalized_label: str
    is_valid: bool
    status: str  # "valid", "manually_corrected", "invalid_unknown_symbol", "invalid_duplicate_component", "invalid_syntax", "invalid_zero_total"
    Hex: int = 0
    HexNAc: int = 0
    Fucose: int = 0
    Sialic_Acid: int = 0
    S_generic: int = 0
    NeuAc: int = 0
    NeuGc: int = 0
    dHex: int = 0
    HexA: int = 0
    Pentose: int = 0
    Sulfate: int = 0
    Phosphate: int = 0
    extra_components: Dict[str, int] = field(default_factory=dict)
    unknown_symbols: List[str] = field(default_factory=list)
    duplicate_components: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    is_manual_override: bool = False
    sialic_acid_type_note: str = "Not applicable (S = 0)"
    fucose_Config_note: str = "F mapped to confirmed Fucose"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # Include convenient indicator flags matching GAREG reference Composition_Map
        d["flags"] = self.compute_reference_flags()
        return d

    def compute_reference_flags(self) -> Dict[str, int]:
        """Compute the exact indicator flags from Composition_Map in GAREG reference workbook."""
        if not self.is_valid:
            return {
                "High_Mannose_H5-H9N2": 0,
                "Paucimannose_pool": 0,
                "H4N2_pool": 0,
                "N3_pool_proxy": 0,
                "N4_pool": 0,
                "N5_pool": 0,
                "N6_pool": 0,
                "Nge4_complex_candidate": 0,
                "Nge7_pool": 0,
                "Fucosylated": 0,
                "Non_Fucosylated": 0,
                "Mono_Fucosylated": 0,
                "Di_Fucosylated": 0,
                "Multi_Fucosylated_Fge2": 0,
                "Sialylated": 0,
                "Sialylated_nonFucosylated": 0,
                "Sialylated_Fucosylated": 0,
                "Nge4_Fucosylated": 0,
                "Nge4_Sialylated": 0,
                "Hex_excess_over_3_in_Nge4": 0,
            }
        h = self.Hex
        n = self.HexNAc
        f = self.Fucose
        s = self.Sialic_Acid
        is_pauci = 1 if (n == 2 and 1 <= h <= 4 and 0 <= f <= 1 and s == 0) else 0
        return {
            "High_Mannose_H5-H9N2": 1 if (n == 2 and 5 <= h <= 9 and f == 0 and s == 0) else 0,
            "Paucimannose_pool": is_pauci,
            "H4N2_pool": is_pauci,
            "N3_pool_proxy": 1 if n == 3 else 0,
            "N4_pool": 1 if n == 4 else 0,
            "N5_pool": 1 if n == 5 else 0,
            "N6_pool": 1 if n == 6 else 0,
            "Nge4_complex_candidate": 1 if n >= 4 else 0,
            "Nge7_pool": 1 if n >= 7 else 0,
            "Fucosylated": 1 if f >= 1 else 0,
            "Non_Fucosylated": 1 if f == 0 else 0,
            "Mono_Fucosylated": 1 if f == 1 else 0,
            "Di_Fucosylated": 1 if f == 2 else 0,
            "Multi_Fucosylated_Fge2": 1 if f >= 2 else 0,
            "Sialylated": 1 if s >= 1 else 0,
            "Sialylated_nonFucosylated": 1 if (s >= 1 and f == 0) else 0,
            "Sialylated_Fucosylated": 1 if (s >= 1 and f >= 1) else 0,
            "Nge4_Fucosylated": 1 if (n >= 4 and f >= 1) else 0,
            "Nge4_Sialylated": 1 if (n >= 4 and s >= 1) else 0,
            "Hex_excess_over_3_in_Nge4": max(h - 3, 0) if n >= 4 else 0,
        }


class GlycanCompositionParser:
    """Configurable, order-independent glycan composition parser."""

    def __init__(
        self,
        component_dictionary: Optional[Dict[str, Dict[str, Any]]] = None,
        treat_f_as_fucose: bool = True,
        treat_dhex_as_fucose: bool = False,
        assume_s_is_neuac: bool = False,
        manual_overrides: Optional[Dict[str, Dict[str, int]]] = None,
    ) -> None:
        self.component_dictionary = copy.deepcopy(
            component_dictionary if component_dictionary is not None else DEFAULT_COMPONENT_DICTIONARY
        )
        self.treat_f_as_fucose = treat_f_as_fucose
        self.treat_dhex_as_fucose = treat_dhex_as_fucose
        # Per Section 5.2: Do NOT automatically assume that all sialic acid is NeuAc when input contains generic S
        self.assume_s_is_neuac = assume_s_is_neuac
        self.manual_overrides: Dict[str, Dict[str, int]] = copy.deepcopy(manual_overrides or {})
        self._build_alias_lookup()

    def _build_alias_lookup(self) -> None:
        """Build sorted alias -> canonical component lookup (longest alias first)."""
        alias_map: Dict[str, str] = {}
        for key, info in self.component_dictionary.items():
            canonical = info.get("canonical", key)
            aliases = info.get("aliases", [key])
            for alias in aliases:
                alias_map[alias] = canonical
                alias_map[alias.upper()] = canonical
                alias_map[alias.lower()] = canonical
        self.alias_map = alias_map
        # Sort aliases by length descending so 'HexNAc' matches before 'Hex' or 'H', 'NeuAc' before 'N', etc.
        all_aliases = sorted(
            {a for info in self.component_dictionary.values() for a in info.get("aliases", [])},
            key=len,
            reverse=True,
        )
        escaped = [re.escape(a) for a in all_aliases]
        self.known_alias_pattern = "|".join(escaped)

    def get_configuration_summary(self) -> Dict[str, Any]:
        return {
            "treat_f_as_fucose": self.treat_f_as_fucose,
            "treat_dhex_as_fucose": self.treat_dhex_as_fucose,
            "assume_s_is_neuac": self.assume_s_is_neuac,
            "supported_components": list(self.component_dictionary.keys()),
            "component_dictionary": self.component_dictionary,
            "manual_overrides_count": len(self.manual_overrides),
        }

    def add_custom_component(self, symbol: str, canonical_name: str, description: str = "") -> None:
        self.component_dictionary[symbol] = {
            "canonical": canonical_name,
            "name": f"{canonical_name} ({symbol})",
            "aliases": [symbol, canonical_name],
            "description": description or f"User-defined monosaccharide/modification component ({symbol}).",
            "is_core_standard": False,
        }
        self._build_alias_lookup()

    def set_manual_override(self, raw_label: str, counts: Dict[str, int]) -> None:
        self.manual_overrides[raw_label] = copy.deepcopy(counts)

    @staticmethod
    def _build_normalized_label(
        hex_count: int,
        hexnac_count: int,
        fuc_count: int,
        s_generic: int,
        neuac: int,
        neugc: int,
        dhex: int,
        hexa: int,
        pentose: int,
        sulfate: int,
        phosphate: int,
        extra: Dict[str, int],
    ) -> str:
        parts: List[str] = []
        if hex_count > 0:
            parts.append(f"H{hex_count}")
        if hexnac_count > 0:
            parts.append(f"N{hexnac_count}")
        if fuc_count > 0:
            parts.append(f"F{fuc_count}")
        if s_generic > 0:
            parts.append(f"S{s_generic}")
        if neuac > 0:
            parts.append(f"NeuAc{neuac}")
        if neugc > 0:
            parts.append(f"NeuGc{neugc}")
        if dhex > 0:
            parts.append(f"dHex{dhex}")
        if hexa > 0:
            parts.append(f"HexA{hexa}")
        if pentose > 0:
            parts.append(f"Pent{pentose}")
        if sulfate > 0:
            parts.append(f"Su{sulfate}")
        if phosphate > 0:
            parts.append(f"Phos{phosphate}")
        for k in sorted(extra.keys()):
            if extra[k] > 0:
                parts.append(f"{k}{extra[k]}")
        return "".join(parts) if parts else "EMPTY"

    def parse(self, label: str) -> ParsedComposition:
        """Parse a single glycan composition label into monosaccharide counts and validation flags."""
        raw = str(label).strip() if label is not None else ""
        if not raw:
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_syntax",
                errors=["Composition label is empty."],
            )

        # Check manual override first
        if raw in self.manual_overrides:
            ov = self.manual_overrides[raw]
            h = int(ov.get("Hex", ov.get("H", 0)))
            n = int(ov.get("HexNAc", ov.get("N", 0)))
            f = int(ov.get("Fucose", ov.get("F", 0)))
            s_gen = int(ov.get("S_generic", ov.get("S", ov.get("Sialic_Acid", 0))))
            neuac = int(ov.get("NeuAc", 0))
            neugc = int(ov.get("NeuGc", 0))
            s_total = int(ov.get("Sialic_Acid", s_gen + neuac + neugc))
            dhex = int(ov.get("dHex", 0))
            hexa = int(ov.get("HexA", 0))
            pent = int(ov.get("Pentose", 0))
            sulf = int(ov.get("Sulfate", 0))
            phos = int(ov.get("Phosphate", 0))
            norm = self._build_normalized_label(h, n, f, s_gen, neuac, neugc, dhex, hexa, pent, sulf, phos, {})
            return ParsedComposition(
                raw_label=raw,
                normalized_label=norm,
                is_valid=(h + n + f + s_total + dhex + hexa + pent) > 0 and min(h, n, f, s_total) >= 0,
                status="manually_corrected",
                Hex=h,
                HexNAc=n,
                Fucose=f,
                Sialic_Acid=s_total,
                S_generic=s_gen,
                NeuAc=neuac,
                NeuGc=neugc,
                dHex=dhex,
                HexA=hexa,
                Pentose=pent,
                Sulfate=sulf,
                Phosphate=phos,
                is_manual_override=True,
                warnings=["Composition manually corrected by user."],
                sialic_acid_type_note=(
                    "Generic S (type/linkage unspecified)" if s_gen > 0 else
                    ("Explicit NeuAc/NeuGc" if (neuac + neugc) > 0 else "Not applicable (S = 0)")
                ),
            )

        # Reject obvious clinical/metadata column headers immediately
        if raw.lower() in NON_GLYCAN_HEADERS:
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_syntax",
                errors=[f"'{raw}' is a metadata or summary column header, not a glycan composition."],
            )

        # Strip optional adduct/tag suffix if separated by underscore/space only when explicitly formatted,
        # NO: per specification, we should not silently strip unknown symbols!
        # Let's clean only surrounding whitespace and optional separators like '_' or '-' or ' ' or '/' ONLY if valid tokens,
        # Wait: what if a label is 'H5_N4_F1_S2' vs 'H5N4F1S2' vs 'H5N4-1'?
        # Negative numbers like 'H-1N2' or 'H5N-2' MUST be caught as invalid!
        if re.search(r"[A-Za-z]\s*-\s*\d+", raw):
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_syntax",
                errors=[f"Negative component count detected in '{raw}'."],
            )

        # Tokenize into (AlphaSymbol, Digits) pairs across the string
        # First check if there are any characters outside [A-Za-z0-9()_ ]
        if re.search(r"[^A-Za-z0-9]", raw):
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_syntax",
                errors=[f"Invalid characters found in composition label '{raw}'."],
            )

        # Check if the string is purely numeric or has leading digits without a symbol
        if re.match(r"^\d+", raw):
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_syntax",
                errors=[f"Composition label '{raw}' starts with digits without a monosaccharide symbol."],
            )

        # Match known aliases or unknown letter sequences followed by integer count
        # Careful: in 'H5N4F1S2' or 'Hex5HexNAc4Fuc1NeuAc2', letters are followed by digits!
        # What if someone writes 'H5N4F' (missing digit after F)? In standard notation, every symbol must have a numeric count.
        token_pattern = re.compile(rf"({self.known_alias_pattern}|[A-Za-z]+)(\d*)")
        pos = 0
        tokens: List[Tuple[str, str]] = []
        while pos < len(raw):
            m = token_pattern.match(raw, pos)
            if not m or m.group(0) == "":
                return ParsedComposition(
                    raw_label=raw,
                    normalized_label="",
                    is_valid=False,
                    status="invalid_syntax",
                    errors=[f"Unable to tokenize composition label '{raw}' at position {pos}."],
                )
            sym, count_str = m.group(1), m.group(2)
            tokens.append((sym, count_str))
            pos = m.end()

        unknown_symbols: List[str] = []
        duplicate_components: List[str] = []
        errors: List[str] = []
        warnings: List[str] = []
        seen_canonicals: Dict[str, str] = {}

        counts: Dict[str, int] = {
            "Hex": 0,
            "HexNAc": 0,
            "Fucose": 0,
            "S_generic": 0,
            "NeuAc": 0,
            "NeuGc": 0,
            "dHex": 0,
            "HexA": 0,
            "Pentose": 0,
            "Sulfate": 0,
            "Phosphate": 0,
        }
        extra_components: Dict[str, int] = {}

        for sym, count_str in tokens:
            # Look up exact symbol case-sensitively first, then case-insensitively for multi-char aliases
            canonical = None
            if sym in self.component_dictionary:
                canonical = self.component_dictionary[sym]["canonical"]
            else:
                # Check exact alias match first
                for info in self.component_dictionary.values():
                    if sym in info.get("aliases", []):
                        canonical = info["canonical"]
                        break
                if canonical is None and len(sym) > 1 and sym.lower() in self.alias_map:
                    canonical = self.alias_map[sym.lower()]

            if canonical is None:
                unknown_symbols.append(sym)
                errors.append(f"Unknown monosaccharide symbol '{sym}' in '{raw}'.")
                continue

            if count_str == "":
                errors.append(f"Missing numeric count for component '{sym}' in '{raw}'.")
                continue

            val = int(count_str)
            if val < 0:
                errors.append(f"Negative count ({val}) for component '{sym}' in '{raw}'.")
                continue

            # Track seen canonical component to prevent duplicate assignments (e.g., H5N4H2 or H5Hex2N4)
            track_key = "S_generic" if canonical == "Sialic_Acid" else canonical
            if track_key in seen_canonicals:
                if canonical not in duplicate_components:
                    duplicate_components.append(canonical)
                errors.append(
                    f"Duplicate component assignment for '{canonical}' ('{seen_canonicals[track_key]}' and '{sym}{val}') in '{raw}'."
                )
                continue
            seen_canonicals[track_key] = f"{sym}{val}"

            if track_key in counts:
                counts[track_key] = val
            else:
                extra_components[track_key] = val

        if unknown_symbols:
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_unknown_symbol",
                unknown_symbols=unknown_symbols,
                duplicate_components=duplicate_components,
                errors=errors,
            )

        if duplicate_components:
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_duplicate_component",
                unknown_symbols=unknown_symbols,
                duplicate_components=duplicate_components,
                errors=errors,
            )

        if errors:
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_syntax",
                errors=errors,
            )

        # Apply configurable dictionary policies for F / dHex and S / NeuAc / NeuGc
        fuc_count = counts["Fucose"]
        dhex_count = counts["dHex"]
        fucose_note = "F mapped to confirmed Fucose"
        if not self.treat_f_as_fucose and fuc_count > 0:
            # User configured F as unspecified dHex rather than confirmed fucose
            dhex_count += fuc_count
            fuc_count = 0
            fucose_note = "F treated as unspecified deoxyhexose (dHex) per dictionary configuration"
            warnings.append("Symbol 'F' is configured as unspecified dHex; Fucose count set to 0.")
        elif self.treat_dhex_as_fucose and dhex_count > 0:
            fuc_count += dhex_count
            fucose_note = "dHex mapped to Fucose per user dictionary configuration"
            warnings.append("Symbol 'dHex' mapped to Fucose per user configuration.")

        s_gen = counts["S_generic"]
        neuac = counts["NeuAc"]
        neugc = counts["NeuGc"]
        if self.assume_s_is_neuac and s_gen > 0 and neuac == 0:
            neuac = s_gen
            sialic_note = "Generic S mapped to NeuAc by explicit user configuration"
            warnings.append("Generic 'S' mapped to NeuAc by user configuration.")
        else:
            if s_gen > 0 and (neuac > 0 or neugc > 0):
                sialic_note = f"Mixed generic S ({s_gen}) and explicit NeuAc ({neuac}) / NeuGc ({neugc})"
            elif s_gen > 0:
                sialic_note = "Generic S (sialic acid subtype Neu5Ac/Neu5Gc and linkage α2,3/α2,6 unspecified)"
            elif (neuac + neugc) > 0:
                sialic_note = f"Explicit sialic acid subtype (NeuAc={neuac}, NeuGc={neugc}); linkage unspecified"
            else:
                sialic_note = "Not applicable (S = 0)"

        total_sialic = s_gen + neuac + neugc if not (self.assume_s_is_neuac and s_gen > 0) else (neuac + neugc)

        total_residues = (
            counts["Hex"]
            + counts["HexNAc"]
            + fuc_count
            + total_sialic
            + dhex_count
            + counts["HexA"]
            + counts["Pentose"]
            + sum(extra_components.values())
        )
        if total_residues <= 0:
            return ParsedComposition(
                raw_label=raw,
                normalized_label="",
                is_valid=False,
                status="invalid_zero_total",
                errors=[f"Composition '{raw}' has zero total monosaccharide residues."],
            )

        norm_label = self._build_normalized_label(
            counts["Hex"],
            counts["HexNAc"],
            fuc_count,
            s_gen,
            neuac,
            neugc,
            dhex_count,
            counts["HexA"],
            counts["Pentose"],
            counts["Sulfate"],
            counts["Phosphate"],
            extra_components,
        )

        return ParsedComposition(
            raw_label=raw,
            normalized_label=norm_label,
            is_valid=True,
            status="valid",
            Hex=counts["Hex"],
            HexNAc=counts["HexNAc"],
            Fucose=fuc_count,
            Sialic_Acid=total_sialic,
            S_generic=s_gen,
            NeuAc=neuac,
            NeuGc=neugc,
            dHex=dhex_count,
            HexA=counts["HexA"],
            Pentose=counts["Pentose"],
            Sulfate=counts["Sulfate"],
            Phosphate=counts["Phosphate"],
            extra_components=extra_components,
            warnings=warnings,
            sialic_acid_type_note=sialic_note,
            fucose_Config_note=fucose_note,
        )

    def parse_many(self, labels: List[str]) -> Dict[str, Any]:
        """Parse a list of glycan labels and detect duplicate labels or normalized compositions."""
        results: List[ParsedComposition] = []
        raw_seen: Dict[str, int] = {}
        norm_seen: Dict[str, List[str]] = {}
        duplicate_raw_labels: List[str] = []
        equivalent_compositions: Dict[str, List[str]] = {}

        for lbl in labels:
            raw_str = str(lbl).strip()
            raw_seen[raw_str] = raw_seen.get(raw_str, 0) + 1
            if raw_seen[raw_str] == 2:
                duplicate_raw_labels.append(raw_str)

            parsed = self.parse(raw_str)
            results.append(parsed)
            if parsed.is_valid and parsed.normalized_label:
                norm_seen.setdefault(parsed.normalized_label, []).append(raw_str)

        for norm_lbl, raw_list in norm_seen.items():
            if len(raw_list) > 1:
                equivalent_compositions[norm_lbl] = raw_list

        valid_count = sum(1 for r in results if r.is_valid)
        total_count = len(results)
        return {
            "total_labels": total_count,
            "valid_count": valid_count,
            "invalid_count": total_count - valid_count,
            "success_rate_pct": (100.0 * valid_count / total_count) if total_count > 0 else 0.0,
            "duplicate_raw_labels": duplicate_raw_labels,
            "equivalent_compositions": equivalent_compositions,
            "parsed_table": [r.to_dict() for r in results],
            "parser_config": self.get_configuration_summary(),
        }
