"""Glycan Trait Calculator (glycan_trait_calc).

An open-source scientific Python framework and interactive interface for automated
calculation, statistical analysis, and visualization of composition-derived and
structure-derived glycan traits.
"""

__version__ = "1.0.0"

from glycan_trait_calc.core.composition_parser import GlycanCompositionParser
from glycan_trait_calc.core.trait_engine import CompositionTraitEngine
from glycan_trait_calc.core.structure_engine import StructureTraitEngine

__all__ = [
    "GlycanCompositionParser",
    "CompositionTraitEngine",
    "StructureTraitEngine",
    "__version__",
]
