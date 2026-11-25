# PLANOVA — Interactive Web Prototype

**PLANOVA: Intelligent Demand, Inventory & Supply Planning System**

This `prototype/` folder contains a standalone, zero-backend HTML/CSS/JavaScript web application built on top of the existing Planova CSV datasets without modifying any existing notebooks, datasets, reports, or README files.

---

## 1. Files in `prototype/`

- `index.html` — Application shell and page structure for all 6 dashboard modules.
- `styles.css` — Enterprise navy-blue, white, and light-blue responsive stylesheet.
- `sampleData.js` — Verbatim snapshot of the project's `Planova/data/*.csv` datasets so the dashboard loads immediately with zero setup (even when opened directly from disk via `file://`).
- `csvParser.js` — Dependency-free CSV parser, schema validator, and Planova dataset registry.
- `charts.js` — Dependency-free interactive SVG charts with hover tooltips.
- `app.js` — Application state, automatic sample loading, optional CSV upload, CSV joins, KPI calculation, capacity/policy gating, filtering, and rendering.
- `README.md` — Setup and usage guide (this file).

---

## 2. How to Run Locally

No Python, Node.js, or build step is required.

### Option A: Open directly in your browser (simplest)
1. Navigate to `Planova/prototype/`.
2. Double-click `index.html` to open it in Chrome, Edge, or Firefox.
3. The dashboard immediately loads and displays the project's sample CSV datasets automatically—no upload is required.

### Option B: Run via a local static server (optional)
If you serve the parent `Planova/` folder with any static HTTP server (for example, VS Code Live Server), opening `/prototype/index.html` will automatically load the CSV files directly from `../data/`.

---

## 3. Uploading Your Own CSVs (Optional)

CSV upload is completely optional:
1. Click **Upload Your Own CSVs** in the top header (or on the welcome banner).
2. Drag-and-drop `.csv` files, click **Choose CSV Files**, or click **Select Folder** to upload your own datasets.
3. By default, uploading custom CSVs replaces the sample workspace so any un-uploaded dataset honestly displays as `Unavailable` (no fake data is generated).
4. Click **Reset to Sample Data** at any time to restore the original project sample datasets.

---

## 4. Dashboard Sections

1. **Dashboard** — Live KPIs (Total SKUs, Locations, Suppliers, Forecast Demand, Shortage Units, Critical Shortages), Supplier Capacity Overview, Dataset Coverage pills, and interactive Demand vs Inventory and Shortage Distribution charts.
2. **Demand & Inventory** — Searchable, filterable view of Forecast Demand lines, SKU × Location net balances, and Inventory Master stock levels.
3. **Shortage Analysis** — Shortage ID, SKU, location, week, projected balance, shortage units, severity priority (with critical rows highlighted), and shortage root cause.
4. **Supplier Management** — Supplier reliability, lead times across locations, weekly capacity bookings, utilisation chart, and capacity constraint flags.
5. **Mitigation Options** — Explains each mitigation option and its linked shortage, displays service impact (`planned_units` / `remaining_shortage`) when available, and enforces capacity & policy guardrails so options that violate capacity or policy rules are blocked.
6. **Data & Validation** — Displays `final_validation_report.csv`, the 5 required edge cases (`EDGE-001` through `EDGE-005`), table-level checks from `validation_summary.csv`, and an isolated panel for `ground_truth.csv` labels.
