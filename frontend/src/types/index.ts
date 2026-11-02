export interface TraitDefinition {
  Trait_ID: string;
  Trait_Name: string;
  Analytical_Category: 'Composition-Derived' | 'Structure-Derived';
  Trait_Group: string;
  Mathematical_Formula: string;
  Plain_Formula: string;
  Required_Components: string[];
  Inclusion_Criteria: string;
  Exclusion_Criteria: string;
  Numerator_Definition: string;
  Denominator_Definition: string;
  Unit: string;
  Interpretation: string;
  Limitations: string;
  Calculation_Version: string;
  Is_Baseline: boolean;
  Is_Optional: boolean;
  Is_Custom: boolean;
}

export interface ParsedCompositionItem {
  raw_label: string;
  normalized_label: string;
  is_valid: boolean;
  status: string;
  Hex: number;
  HexNAc: number;
  Fucose: number;
  Sialic_Acid: number;
  S_generic: number;
  NeuAc: number;
  NeuGc: number;
  dHex: number;
  HexA: number;
  Pentose: number;
  Sulfate: number;
  Phosphate: number;
  unknown_symbols: string[];
  duplicate_components: string[];
  warnings: string[];
  errors: string[];
  is_manual_override: boolean;
  sialic_acid_type_note: string;
  fucose_Config_note: string;
  flags: Record<string, number>;
}

export interface SampleQCRow {
  sample_id: string;
  group: string;
  raw_total_abundance: number;
  working_total_pct: number;
  zero_count: number;
  missing_count: number;
  negative_count: number;
  qc_status: string;
}

export interface QCWarning {
  severity: string;
  category: string;
  message: string;
}

export interface QCReport {
  total_samples: number;
  active_samples: number;
  excluded_samples: string[];
  group_distribution: Record<string, number>;
  distinct_groups: string[];
  total_glycan_columns: number;
  valid_glycan_count: number;
  invalid_glycan_count: number;
  parsing_success_rate_pct: number;
  duplicate_sample_ids: string[];
  duplicate_glycan_labels: string[];
  equivalent_compositions: Record<string, string[]>;
  invalid_glycan_labels: string[];
  measurement_type: string;
  measurement_type_label: string;
  normalization_method?: string;
  normalization_method_label?: string;
  apply_closure: boolean;
  normalization_applied: string;
  zero_handling: string;
  zero_handling_label: string;
  missing_values_count: number;
  missing_values_pct: number;
  zero_values_count: number;
  zero_values_pct: number;
  negative_values_count: number;
  is_clr_blocked: boolean;
  blocking_errors: string[];
  warnings: QCWarning[];
  sample_qc_table: SampleQCRow[];
  parsed_compositions: ParsedCompositionItem[];
}

export interface SampleTraitResult {
  sample_id: string;
  group: string;
  traits: Record<string, number | null>;
  numerators: Record<string, number>;
  denominators: Record<string, number | null>;
}

export interface GroupStatValues {
  valid_n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  se: number | null;
  min: number | null;
  max: number | null;
  q25: number | null;
  q75: number | null;
  iqr: number | null;
}

export interface GroupComparisonItem {
  trait_id: string;
  trait_name: string;
  unit: string;
  parametric_test: string;
  parametric_stat: number | null;
  parametric_p: number | null;
  parametric_fdr?: number | null;
  nonparametric_test: string;
  nonparametric_stat: number | null;
  nonparametric_p: number | null;
  nonparametric_fdr?: number | null;
}

export interface ValidationCheckItem {
  rule_id: string;
  rule_name: string;
  passed: boolean;
  details: string;
}

export interface CompositionResults {
  blocked?: boolean;
  blocking_errors?: string[];
  engine_version?: string;
  trait_definitions: TraitDefinition[];
  inclusion_matrix: Record<string, {
    trait_id: string;
    trait_name: string;
    included_glycans: string[];
    excluded_glycans: string[];
    denominator_glycans: string[];
    per_glycan: Record<string, any>;
  }>;
  sample_results: SampleTraitResult[];
  group_summaries: {
    distinct_groups: string[];
    by_trait: Record<string, {
      trait_id: string;
      trait_name: string;
      unit: string;
      groups: Record<string, GroupStatValues>;
    }>;
  };
  group_comparisons: GroupComparisonItem[];
  trait_warnings: Array<{
    sample_id: string;
    trait_id: string;
    trait_name: string;
    warning: string;
  }>;
  scientific_validation: {
    all_passed: boolean;
    has_f_ge_3?: boolean;
    has_n_ge_7?: boolean;
    checks: ValidationCheckItem[];
  };
}

export interface StructuralAnnotationRow {
  glycan_id: string;
  composition: string;
  sequence_format: string;
  structure_sequence: string;
  has_validated_structure: boolean;
  annotation_confidence: string;
  experimental_evidence: string;
  core_fucosylated: boolean | null;
  antennary_fucosylated: boolean | null;
  bisecting_glcnac: boolean | null;
  galactose_count: number | null;
  structural_class: string | null;
  antenna_count: number | null;
  alpha2_3_sialic_count: number | null;
  alpha2_6_sialic_count: number | null;
  parser_validation_notes: string[];
}

export interface StructureResults {
  structural_data_available: boolean;
  status_message: string;
  validated_glycan_count: number;
  unclassified_glycan_count: number;
  validated_glycans: string[];
  unclassified_glycans: string[];
  annotation_table: StructuralAnnotationRow[];
  trait_definitions: TraitDefinition[];
  not_derivable_traits: Array<{
    trait_id: string;
    trait_name: string;
    status: string;
    display_value: string;
    numeric_value: number | null;
    unit: string;
    reason: string;
    required_evidence: string;
  }>;
  sample_results: Array<{
    sample_id: string;
    group: string;
    status: string;
    validated_abundance_pct?: number;
    unclassified_abundance_pct?: number;
    traits: Record<string, number | null>;
    display_traits: Record<string, string>;
  }>;
}

export interface ClassificationRow {
  trait: string;
  category: string;
  composition_data_sufficient: string;
  structural_annotation_required: string;
  scientific_rationale: string;
}

export interface SessionSummary {
  session_id: string;
  filename: string;
  all_columns: string[];
  sample_id_col: string;
  group_col: string | null;
  metadata_cols: string[];
  glycan_cols: string[];
  unrecognized_numeric_cols: string[];
  preview_rows: Record<string, any>[];
  normalized_preview_rows?: Record<string, any>[];
  normalized_custom_rows?: Record<string, any>[];
  normalization_method?: string;
  normalization_method_label?: string;
  available_demo_datasets?: Array<{
    id: string;
    name?: string;
    title?: string;
    description: string;
    filename?: string;
    measurement_type?: string;
    sample_count?: number;
    glycan_count?: number;
  }>;
  active_demo_id?: string;
  dashboard_metrics: {
    total_samples: number;
    active_samples: number;
    identified_glycan_compositions: number;
    experimental_groups_count: number;
    experimental_groups: Record<string, number>;
    composition_traits_available: number;
    baseline_composition_traits: number;
    optional_composition_traits: number;
    custom_composition_traits: number;
    structure_traits_available: number;
    successfully_calculated_traits: number;
    traits_not_derivable_insufficient_structure: number;
    qc_warnings_count: number;
  };
  qc_report: QCReport;
  parser_config: Record<string, any>;
  composition_results: CompositionResults;
  structure_results: StructureResults;
  measurement_types_catalog: Record<string, string>;
  normalization_methods_catalog?: Record<string, string>;
  zero_handling_catalog: Record<string, string>;
  classification_table: ClassificationRow[];
  metadata_merge_report?: {
    matched_samples_count: number;
    total_abundance_samples: number;
    unmatched_sample_ids: string[];
    added_metadata_columns: string[];
  };
}

export interface TraitContributionAudit {
  sample_id: string;
  group: string;
  trait: TraitDefinition;
  included_glycans: string[];
  excluded_glycans: string[];
  included_count: number;
  excluded_count: number;
  numerator: number;
  denominator: number | null;
  final_value: number | null;
  unit: string;
  aggregation_explanation: string;
  contributions: Array<{
    glycan: string;
    normalized_label: string;
    abundance_pct: number;
    Hex: number;
    HexNAc: number;
    Fucose: number;
    Sialic_Acid: number;
    included: boolean;
    weight: number;
    contribution: number;
    included_in_denominator: boolean;
    denominator_contribution: number | null;
    reason: string;
  }>;
}
