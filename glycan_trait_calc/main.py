"""FastAPI Web Application and API Server for Glycan Trait Calculator."""

from __future__ import annotations

import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Ensure package is resolvable
pkg_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if pkg_dir not in sys.path:
    sys.path.insert(0, pkg_dir)

from glycan_trait_calc.core.config import (
    APP_TITLE,
    APP_SUBTITLE,
    APP_VERSION,
    CALCULATION_ENGINE_VERSION,
)
from glycan_trait_calc.api.routes import router as api_router


app = FastAPI(
    title=APP_TITLE,
    description=APP_SUBTITLE,
    version=APP_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/api/health")
def health_check() -> dict:
    return {
        "status": "healthy",
        "application": APP_TITLE,
        "version": APP_VERSION,
        "engine_version": CALCULATION_ENGINE_VERSION,
    }


# Mount pre-built web interface
web_ui_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "web_ui"))
if os.path.exists(web_ui_dir) and os.path.exists(os.path.join(web_ui_dir, "index.html")):
    app.mount("/", StaticFiles(directory=web_ui_dir, html=True), name="web_ui")
else:
    frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/dist"))
    if os.path.exists(frontend_dist) and os.path.exists(os.path.join(frontend_dist, "index.html")):
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend_dist")
    else:
        @app.get("/")
        def root_info() -> dict:
            return {
                "application": APP_TITLE,
                "subtitle": APP_SUBTITLE,
                "version": APP_VERSION,
                "status": "online",
                "docs_url": "/docs",
            }
