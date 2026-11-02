#!/usr/bin/env bash
echo "======================================================================"
echo "Starting Glycan Trait Calculator..."
echo "======================================================================"
if command -v python3 &>/dev/null; then
    python3 app.py
elif command -v python &>/dev/null; then
    python app.py
else
    echo "Python 3 is required but was not found in PATH."
    exit 1
fi
