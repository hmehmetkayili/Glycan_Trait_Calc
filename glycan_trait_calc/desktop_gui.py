"""Native Desktop Graphical User Interface for Glycan Trait Calculator.

Built with Python standard library tkinter to ensure 100% zero-dependency
desktop operation on Windows, macOS, and Linux.
"""

from __future__ import annotations

import os
import sys
import threading
import webbrowser
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

# Ensure package path
pkg_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if pkg_dir not in sys.path:
    sys.path.insert(0, pkg_dir)

from glycan_trait_calc.cli import run_pipeline


class GlycanTraitDesktopApp(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("Glycan Trait Calculator - Scientific Desktop Suite")
        self.geometry("740x580")
        self.minsize(680, 500)

        # Variables
        self.var_input_file = tk.StringVar()
        self.var_meta_file = tk.StringVar()
        self.var_struct_file = tk.StringVar()
        self.var_norm_method = tk.StringVar(value="total_area_100")
        self.var_output_file = tk.StringVar()

        self._create_widgets()

    def _create_widgets(self):
        # Header frame
        header_frame = tk.Frame(self, bg="#0f2b46", pady=14, padx=16)
        header_frame.pack(fill=tk.X)

        title_lbl = tk.Label(
            header_frame,
            text="Glycan Trait Calculator",
            font=("Helvetica", 16, "bold"),
            fg="#38bdf8",
            bg="#0f2b46",
        )
        title_lbl.pack(anchor="w")

        subtitle_lbl = tk.Label(
            header_frame,
            text="Automated Glycomic Compositional & Structural Trait Analysis",
            font=("Helvetica", 10),
            fg="#94a3b8",
            bg="#0f2b46",
        )
        subtitle_lbl.pack(anchor="w")

        # Main content container
        main_frame = ttk.Frame(self, padding="16 16 16 16")
        main_frame.pack(fill=tk.BOTH, expand=True)

        # File Selection Group
        files_group = ttk.LabelFrame(main_frame, text=" Data Files ", padding="10 10 10 10")
        files_group.pack(fill=tk.X, pady=(0, 12))

        # 1. Abundance Dataset
        ttk.Label(files_group, text="Abundance Matrix (.xlsx / .csv):", font=("Helvetica", 9, "bold")).grid(row=0, column=0, sticky="w", pady=4)
        ttk.Entry(files_group, textvariable=self.var_input_file, width=48).grid(row=0, column=1, padx=6, pady=4, sticky="ew")
        ttk.Button(files_group, text="Browse...", command=self._browse_input).grid(row=0, column=2, padx=2, pady=4)

        # 2. Metadata (Optional)
        ttk.Label(files_group, text="Sample Metadata (Optional):").grid(row=1, column=0, sticky="w", pady=4)
        ttk.Entry(files_group, textvariable=self.var_meta_file, width=48).grid(row=1, column=1, padx=6, pady=4, sticky="ew")
        ttk.Button(files_group, text="Browse...", command=self._browse_meta).grid(row=1, column=2, padx=2, pady=4)

        # 3. Structural Annotations (Optional)
        ttk.Label(files_group, text="Structural Data (Optional):").grid(row=2, column=0, sticky="w", pady=4)
        ttk.Entry(files_group, textvariable=self.var_struct_file, width=48).grid(row=2, column=1, padx=6, pady=4, sticky="ew")
        ttk.Button(files_group, text="Browse...", command=self._browse_struct).grid(row=2, column=2, padx=2, pady=4)

        files_group.columnconfigure(1, weight=1)

        # Settings Group
        settings_group = ttk.LabelFrame(main_frame, text=" Calculation & Normalization Settings ", padding="10 10 10 10")
        settings_group.pack(fill=tk.X, pady=(0, 12))

        ttk.Label(settings_group, text="Abundance Normalization:").grid(row=0, column=0, sticky="w", pady=4)
        norm_combo = ttk.Combobox(
            settings_group,
            textvariable=self.var_norm_method,
            state="readonly",
            values=[
                "total_area_100",
                "total_area_1",
                "pna",
                "none",
            ],
            width=28,
        )
        norm_combo.grid(row=0, column=1, sticky="w", padx=6, pady=4)

        norm_desc = ttk.Label(
            settings_group,
            text="(total_area_100 = 100% relative abundance closure; pna = Probabilistic Normalization)",
            font=("Helvetica", 8, "italic"),
            foreground="#64748b",
        )
        norm_desc.grid(row=0, column=2, sticky="w", padx=4)

        # Action Buttons Frame
        btn_frame = ttk.Frame(main_frame)
        btn_frame.pack(fill=tk.X, pady=(0, 12))

        self.btn_run = tk.Button(
            btn_frame,
            text="⚡ Run Trait Calculation & Export Excel",
            font=("Helvetica", 10, "bold"),
            bg="#0284c7",
            fg="white",
            padx=14,
            pady=8,
            relief=tk.FLAT,
            command=self._start_calculation,
        )
        self.btn_run.pack(side=tk.LEFT, padx=(0, 10))

        btn_web = tk.Button(
            btn_frame,
            text="🌐 Open Interactive Web UI",
            font=("Helvetica", 10, "bold"),
            bg="#0f172a",
            fg="#38bdf8",
            padx=14,
            pady=8,
            relief=tk.FLAT,
            command=self._open_web_ui,
        )
        btn_web.pack(side=tk.LEFT)

        # Status / Log Box
        log_group = ttk.LabelFrame(main_frame, text=" Execution Log ", padding="6 6 6 6")
        log_group.pack(fill=tk.BOTH, expand=True)

        self.txt_log = tk.Text(log_group, height=10, font=("Consolas", 9), wrap=tk.WORD)
        self.txt_log.pack(fill=tk.BOTH, expand=True, side=tk.LEFT)

        scroll = ttk.Scrollbar(log_group, orient="vertical", command=self.txt_log.yview)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.txt_log.config(yscrollcommand=scroll.set)

        self._log("Ready. Select an abundance dataset (.xlsx / .csv) and click 'Run Trait Calculation'.")

    def _log(self, msg: str):
        self.txt_log.insert(tk.END, msg + "\n")
        self.txt_log.see(tk.END)

    def _browse_input(self):
        f = filedialog.askopenfilename(
            title="Select Glycan Abundance Matrix",
            filetypes=[("Excel or CSV Files", "*.xlsx;*.xls;*.csv;*.tsv"), ("All Files", "*.*")],
        )
        if f:
            self.var_input_file.set(f)
            self._log(f"Selected abundance matrix: {f}")

    def _browse_meta(self):
        f = filedialog.askopenfilename(
            title="Select Sample Metadata (Optional)",
            filetypes=[("Excel or CSV Files", "*.xlsx;*.xls;*.csv"), ("All Files", "*.*")],
        )
        if f:
            self.var_meta_file.set(f)
            self._log(f"Selected metadata: {f}")

    def _browse_struct(self):
        f = filedialog.askopenfilename(
            title="Select Structural Data (Optional)",
            filetypes=[("Excel or CSV Files", "*.xlsx;*.xls;*.csv"), ("All Files", "*.*")],
        )
        if f:
            self.var_struct_file.set(f)
            self._log(f"Selected structural annotations: {f}")

    def _start_calculation(self):
        inp = self.var_input_file.get().strip()
        if not inp:
            messagebox.showwarning("Missing Input", "Please select an abundance dataset first!")
            return

        out_f = filedialog.asksaveasfilename(
            title="Save Calculated Traits Excel Workbook",
            defaultextension=".xlsx",
            filetypes=[("Excel Workbook", "*.xlsx")],
            initialfile=os.path.splitext(os.path.basename(inp))[0] + "_traits.xlsx",
        )
        if not out_f:
            return

        self.btn_run.config(state=tk.DISABLED)
        self._log(f"\n--- Starting Analysis on {os.path.basename(inp)} ---")

        def _worker():
            try:
                run_pipeline(
                    input_path=inp,
                    output_path=out_f,
                    metadata_path=self.var_meta_file.get().strip() or None,
                    structural_path=self.var_struct_file.get().strip() or None,
                    norm_method=self.var_norm_method.get(),
                    quiet=False,
                )
                self.after(0, lambda: self._on_success(out_f))
            except Exception as e:
                self.after(0, lambda: self._on_error(str(e)))

        threading.Thread(target=_worker, daemon=True).start()

    def _on_success(self, out_file: str):
        self.btn_run.config(state=tk.NORMAL)
        self._log(f"SUCCESS: Results saved to {out_file}")
        messagebox.showinfo("Analysis Complete", f"Successfully calculated all traits!\nExported to:\n{out_file}")

    def _on_error(self, err_msg: str):
        self.btn_run.config(state=tk.NORMAL)
        self._log(f"ERROR: {err_msg}")
        messagebox.showerror("Error", f"Trait calculation failed:\n{err_msg}")

    def _open_web_ui(self):
        self._log("Launching Web Application Server...")
        from glycan_trait_calc.app import find_free_port
        port = find_free_port(8000)
        url = f"http://127.0.0.1:{port}"

        def _server():
            import uvicorn
            uvicorn.run("glycan_trait_calc.main:app", host="127.0.0.1", port=port, log_level="warning")

        t = threading.Thread(target=_server, daemon=True)
        t.start()

        threading.Thread(target=lambda: (time.sleep(1.0), webbrowser.open_new(url)), daemon=True).start()
        self._log(f"Interactive Web UI running at {url}")


def main():
    import time
    app = GlycanTraitDesktopApp()
    app.mainloop()


if __name__ == "__main__":
    main()
