#!/usr/bin/env python3
"""Glycan Trait Calculator Application Runner.

Quickstart command:
    python app.py

Starts the FastAPI backend and automatically opens the user interface in your browser.
"""

import sys
import os

# Add package directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from glycan_trait_calc.app import main

if __name__ == "__main__":
    main()
