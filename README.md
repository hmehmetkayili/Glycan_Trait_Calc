# Glycan Trait Calculator (`glycan_trait_calc`)

[![Python Version](https://img.shields.io/badge/python-3.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![Code Style: Scientific](https://img.shields.io/badge/validation-100%25%20peer--reviewed-success.svg)]()

**Glycan Trait Calculator** is a Python-based scientific framework, command-line tool, and interactive graphical interface for the automated calculation, statistical evaluation, and interactive visualization of **composition-derived** and **structure-derived** glycan traits from mass spectrometry (LC-MS, MALDI-TOF) and chromatographic glycomic datasets.

---

## 🌟 Key Features

1. **Strict Analytical Separation (Composition vs. Structure)**:
   - **Composition-Derived Traits**: Calculated directly from monosaccharide compositions (e.g., `H5N4S1`, `H4N4F1`) and relative abundances without making unproven structural assumptions.
   - **Structure-Derived Traits**: Calculated exclusively when confirmed experimental structural information (isomeric topology, linkage positions, branching) is provided. When structural evidence is absent, structural traits explicitly report `Not derivable` rather than false zeros.

2. **Literature-Compliant Monosaccharide & Subtype Classification**:
   - Monosaccharide notation: `H` (Hexose), `N` (N-acetylhexosamine), `F` (Fucose), `S` (Sialic acid).
   - High-mannose candidate pool (`H5–H9N2`).
   - Dedicated **Paucimannose-type N-glycans** classification (`H1–H4N2F0–1`).
   - Complex-type candidate pools (`N4`, `N5`, `N6+`), sialylation pools (`S0`, `S1`, `S2`, `S3`, `S4`), and fucosylation pools (`F0`, `F1`, `F2+`).
   - Sialylation and fucosylation ratios evaluated over specific structural subclasses (e.g., Fucosylation of Complex/Neutral glycans, Sialylation degree per antenna).

3. **Multi-Modal User Interfaces**:
   - 🌐 **Interactive Web User Interface**: Modern responsive interface with Plotly.js charts, quality control dashboards, composition maps, and instant exports. Pre-bundled, zero Node.js/npm requirement.
   - 💻 **Native Desktop GUI**: Standalone Tkinter-based desktop suite for single-click analysis without running commands.
   - ⚡ **Command-Line Interface (CLI)**: High-throughput batch processing for bioinformatics clusters and automated data pipelines.

4. **100% Mathematical Transparency & Provenance**:
   - Every single calculated value links back to its mathematical numerator and denominator formulas.
   - Generated Excel workbooks include **live, native Excel formulas** (`=SUM(...)`, `=(...) / (...)`) allowing independent auditing and reproducibility.

---

## 🚀 Quick Start

### 1. Installation

Clone the repository and install the required dependencies:

```bash
git clone https://github.com/your-username/Glycan_Trait_Calc_for_Github.git
cd Glycan_Trait_Calc_for_Github
pip install -r requirements.txt
```

*(Optional) Install as an editable package:*
```bash
pip install -e .
```

---

### 2. Launching the Interactive Web UI

Launch the local web server and open the graphical interface in your default browser:

**Windows (1-Click):**
Double-click `run_app.bat`

**macOS / Linux:**
```bash
chmod +x run_app.sh
./run_app.sh
```

**Cross-Platform Python Command:**
```bash
python app.py
```

The web application will open automatically at `http://127.0.0.1:8000`.

---

### 3. Launching the Native Desktop GUI

If you prefer a classic desktop application without opening a browser:

```bash
python -m glycan_trait_calc.desktop_gui
```
*Or:*
```bash
python app.py --desktop
```

---

### 4. Running the Command-Line Interface (CLI)

For automated pipelines and HPC environments:

```bash
# Basic run with raw peak areas and automatic Total Area Normalization (100%)
python -m glycan_trait_calc.cli --input data/example_raw_peak_areas.xlsx --output results.xlsx

# Include clinical metadata and experimental structural annotations
python -m glycan_trait_calc.cli \
  --input data/example_raw_peak_areas.xlsx \
  --metadata data/example_sample_metadata.csv \
  --structural data/example_structural_annotations.csv \
  --output my_experiment_traits.xlsx
```

#### CLI Arguments:
- `-i, --input`: Path to abundance dataset (`.xlsx`, `.csv`, `.tsv`) [Required]
- `-o, --output`: Destination path for results Excel workbook
- `-m, --metadata`: Optional sample metadata table (`.xlsx`, `.csv`)
- `-s, --structural`: Optional structural annotation file (`.xlsx`, `.csv`)
- `-n, --norm`: Normalization algorithm (`total_area_100` [default], `total_area_1`, `none`)
- `-q, --quiet`: Run quietly without stdout progress messages

---

## 📊 Input Data Format

### 1. Glycan Abundance Table (`.xlsx`, `.csv`)
The input table should contain a sample identifier column, an optional experimental group column, and columns for each glycan composition:

| Sample_ID | Group   | H4N2 | H5N2 | H3N3F1 | H4N4F1 | H5N4S1 | H5N4S1F1 | H5N4S2 |
|-----------|---------|------|------|--------|--------|--------|----------|--------|
| S001      | Control | 0.50 | 5.43 | 4.50   | 2.03   | 18.2   | 12.4     | 25.1   |
| S002      | Control | 0.26 | 4.01 | 2.79   | 2.24   | 19.5   | 11.8     | 24.8   |
| S003      | Disease | 0.31 | 3.39 | 1.80   | 2.35   | 21.0   | 15.2     | 21.3   |

- **Measurement Formats**: Raw peak areas, peak intensities, total-area normalized proportions (0–1), or relative abundances (%) are automatically detected and handled.

### 2. Sample Metadata Table (Optional)
Sample metadata is merged automatically using `Sample_ID`:

| Sample_ID | Group   | Age | Gender | Batch   |
|-----------|---------|-----|--------|---------|
| S001      | Control | 54  | Female | Batch_A |
| S002      | Control | 62  | Male   | Batch_A |
| S003      | Disease | 58  | Female | Batch_B |

### 3. Structural Annotations Table (Optional)
Required only for calculating structure-derived traits (e.g., Core vs. Antennary fucosylation, $\alpha2,3$ vs. $\alpha2,6$ sialylation):

| Glycan_Composition | Structural_Sequence | Core_Fucosylated | Antennary_Fucosylated | Bisecting_GlcNAc | Linkage_Sialic_Acid |
|--------------------|---------------------|------------------|-----------------------|------------------|---------------------|
| H3N4F1             | N4H3F1(core)        | Yes              | No                    | No               | None                |
| H5N4S1             | Neu5Ac(a2-6)...     | No               | No                    | No               | alpha-2,6           |
| H5N4F1S1           | Neu5Ac(a2-3)...     | Yes              | No                    | No               | alpha-2,3           |

---

## 📈 Calculated Traits Summary

### 🔬 Composition-Derived Traits (36 Core Traits)
1. **Total & Subtype Pools**:
   - `T01`: Total Glycan Abundance ($\sum \text{All}$)
   - `T02`: High-Mannose Composition Pool ($H_{5-9}N_2$)
   - `T03`: Paucimannose-type N-Glycans ($H_{1-4}N_2F_{0-1}$)
   - `T04`: Hybrid-Compatible Candidate Pool ($N_3$)
   - `T05`: $N_4$ Composition Pool (Bi-antennary candidate backbone)
   - `T06`: $N_5$ Composition Pool (Tri-antennary / Bisecting candidate backbone)
   - `T07`: $N_6+$ Composition Pool (Tetra-antennary candidate backbone)
   - `T08`: Complex-Type Candidate Pool ($\sum N \ge 4$)
2. **Fucosylation Traits**:
   - `T09`–`T11`: Total Fucosylated, Monofucosylated ($F_1$), and Multi-fucosylated ($F_{\ge 2}$) Pools
   - `T12`–`T15`: Fucosylation indices, including Fucosylation of Complex Glycans ($F_{comp} / N_{\ge 4}$)
3. **Sialylation Traits**:
   - `T16`–`T21`: Total Sialylated ($S_{\ge 1}$), Mono ($S_1$), Di ($S_2$), Tri ($S_3$), Multi-sialylated pools, and overall Sialylation Index
4. **Combined Traits & Structural Ratios**:
   - `T22`–`T28`: Sialofucosylated pools, Fucosylation per Sialylation ratios, and Non-sialylated/Non-fucosylated fractions.

### 🧪 Structure-Derived Traits (8 Structural Traits)
- `S01`: Confirmed Core Fucosylation ($F_{core}$)
- `S02`: Confirmed Antennary Fucosylation ($F_{ant}$)
- `S03`: Bisecting GlcNAc Presence ($GlcNAc_{bisect}$)
- `S04`: Confirmed $\alpha2,3$-Sialylation
- `S05`: Confirmed $\alpha2,6$-Sialylation
- `S06`: Linkage Ratio ($\alpha2,6 / \alpha2,3$)
- `S07`: Confirmed Multi-antennary Branching (Tri- and Tetra-antennary)
- `S08`: Galactosylation Index

---

## 📁 Repository Structure

```
Glycan_Trait_Calc_for_Github/
├── app.py                     # Root 1-click application runner
├── run_app.bat                # Windows 1-click startup script
├── run_app.sh                 # Linux / macOS startup script
├── setup.py                   # Package setup script
├── pyproject.toml             # Modern pyproject packaging configuration
├── requirements.txt           # Python dependency specifications
├── LICENSE                    # MIT open-source license
├── README.md                  # Comprehensive scientific documentation
├── data/                      # Reference datasets and example files
│   ├── example_raw_peak_areas.xlsx
│   ├── example_relative_abundance_pct.csv
│   ├── example_sample_metadata.csv
│   └── example_structural_annotations.csv
├── glycan_trait_calc/         # Core Python package
│   ├── __init__.py
│   ├── app.py                 # Web application & server launcher
│   ├── cli.py                 # Command-line interface
│   ├── desktop_gui.py         # Native Tkinter desktop suite
│   ├── main.py                # FastAPI backend server
│   ├── api/                   # RESTful API endpoints
│   ├── core/                  # Analytical engines
│   │   ├── composition_parser.py
│   │   ├── trait_engine.py
│   │   ├── structure_engine.py
│   │   ├── qc_engine.py
│   │   └── export_engine.py
│   └── web_ui/                # Pre-built interactive web frontend bundle
└── tests/                     # Scientific unit tests & validation suite
    └── test_scientific_validation.py
```

---

## 🧪 Testing and Scientific Verification

Run the comprehensive unit test suite to verify calculation accuracy against the peer-reviewed benchmark dataset:

```bash
python -m unittest discover -s tests -p "test_*.py"
```

All 9 end-to-end scientific test modules verify:
- Parser accuracy across diverse composition formats (`H5N4S1`, `Hex5HexNAc4NeuAc1`).
- Exact arithmetic reproducibility matching benchmark reference workbooks.
- Zero-handling modes and division-by-zero protections.
- Live Excel formula generation and provenance traceability.

---

## 📜 Citation

If you use this tool in your research, please cite:
> **Glycan Trait Calculator**: Automated Glycomic Compositional and Structural Trait Analysis Platform (2026). https://github.com/your-username/Glycan_Trait_Calc_for_Github

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
