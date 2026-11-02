@echo off
echo ======================================================================
echo Starting Glycan Trait Calculator...
echo ======================================================================
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Python was not found in PATH!
    echo Please install Python 3.10+ and add it to your system PATH.
    pause
    exit /b 1
)

python app.py
pause
