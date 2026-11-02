"""Glycan Trait Calculator - Core Configuration.

Open-source platform for glycomic composition-derived and structure-derived trait analysis.
"""

import os

APP_TITLE = "Glycan Trait Calculator"
APP_SUBTITLE = "Open-Source Glycomic Composition and Structural Trait Analysis Platform"
APP_VERSION = "1.0.0"
CALCULATION_ENGINE_VERSION = "1.0.0"
COMPONENT_MAPPING_VERSION = "1.0.0"
TRAIT_DEFINITION_VERSION = "1.0.0"

WEBSITE_URL = "https://github.com"
RECOMMENDED_APP_URL = "http://127.0.0.1:8000"

ALLOWED_ORIGINS = [
    "*",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://localhost:8001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8001",
]

SESSION_TTL_SECONDS = int(os.getenv("GLYCAN_TRAIT_SESSION_TTL_SECONDS", "7200"))  # 2 hours default
MAX_UPLOAD_SIZE_BYTES = int(os.getenv("GLYCAN_TRAIT_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))  # 50 MB limit
NUMERICAL_TOLERANCE = 1e-8
