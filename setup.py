import os
from setuptools import setup, find_packages

long_description = ""
if os.path.exists("README.md"):
    with open("README.md", "r", encoding="utf-8") as f:
        long_description = f.read()

setup(
    name="glycan-trait-calc",
    version="1.0.0",
    author="Glycomics Research Initiative",
    description="Automated Glycomic Compositional and Structural Trait Analysis Suite",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/your-username/Glycan_Trait_Calc_for_Github",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        "glycan_trait_calc": [
            "web_ui/*",
            "web_ui/**/*",
        ],
    },
    install_requires=[
        "fastapi>=0.100.0",
        "uvicorn>=0.20.0",
        "pandas>=2.0.0",
        "numpy>=1.24.0",
        "scipy>=1.10.0",
        "statsmodels>=0.14.0",
        "openpyxl>=3.1.0",
        "xlsxwriter>=3.1.0",
        "reportlab>=4.0.0",
        "python-multipart>=0.0.6",
    ],
    entry_points={
        "console_scripts": [
            "glycan-trait-calc = glycan_trait_calc.cli:main",
            "glycan-trait-app = glycan_trait_calc.app:main",
            "glycan-trait-gui = glycan_trait_calc.desktop_gui:main",
        ],
    },
    classifiers=[
        "Development Status :: 5 - Production/Stable",
        "Intended Audience :: Science/Research",
        "Topic :: Scientific/Engineering :: Bio-Informatics",
        "Topic :: Scientific/Engineering :: Chemistry",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
    python_requires=">=3.9",
)
