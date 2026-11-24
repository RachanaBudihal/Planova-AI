# PLANOVA — Interactive Web Prototype

**PLANOVA: Intelligent Demand, Inventory & Supply Planning System**

This `prototype/` folder contains a standalone, zero-backend HTML/CSS/JavaScript web application built on top of the existing Planova CSV datasets without modifying any existing notebooks, datasets, reports, or README files.

---

## 1. Files in `prototype/`

- `index.html` — Application shell and page structure for all 6 dashboard modules.
- `styles.css` — Enterprise navy-blue, white, and light-blue responsive stylesheet.
- `csvParser.js` — Dependency-free CSV parser, schema validator, and Planova dataset registry.
- `charts.js` — Dependency-free interactive SVG charts with hover tooltips.
- `app.js` — Application state, CSV joins, KPI calculation, capacity/policy gating, filtering, and rendering.
- `README.md` — Setup and usage guide (this file).

---

## 2. How to Run Locally

No Python, Node.js, or build step is required.

### Option A: Open directly in your browser (simplest)
1. Navigate to `Planova/prototype/`.
2. Double-click `index.html` to open it in Chrome, Edge, or Firefox.
3. Click **Select `data/` Folder** (or **Import CSVs**) and choose `Planova/data`.

### Option B: Run via a local static server (optional)
If you serve the parent `Planova/` folder with any static HTTP server (for example, VS Code Live Server or `npx serve .` from `Planova/`), opening `/prototype/` will automatically fetch the CSV files from `../data/`.

---

## 3. How to Load Your Existing CSV Files

1. Click **Import CSVs** in the top-right header (or **Select `data/` Folder** on the welcome banner).
2. Choose either:
   - **Select `data/` Folder** to load all recognised Planova CSV files from `Planova/data/` in one click, **or**
   - **Choose CSV Files** / drag-and-drop individual `.csv` files.
3. Recognised datasets include:
   - Master data: `sku.csv`, `location.csv`, `supplier.csv`
   - Planning inputs: `forecast_demand.csv`, `inventory.csv`, `integrated_planning.csv` (optional)
   - Supply & capacity: `lead_times.csv`, `purchase_orders.csv`, `supplier_capacity.csv`, `supplier_capacity_analysis.csv`, `capacity_check.csv`
   - Shortages: `shortages.csv`, `shortage_explanations.csv`, `integrated_shortages.csv`
   - Mitigation: `mitigation_recommendations.csv`, `mitigation_feasibility.csv`, `updated_mitigation_feasibility.csv`, `production_capacity.csv`, `production_plan.csv`
   - Validation & evaluation: `final_validation_report.csv`, `validation_summary.csv`, `edge_case_detection_results.csv`, `edge_case_test_results.csv`, `ground_truth.csv`
4. Click **Reset Data** at any time to clear all imported datasets.
5. If you want a quick preview without loading files, click **Load Demo Mode (Small Sample)**—this is clearly marked with a warning banner and is never loaded silently.

---

## 4. Dashboard Sections

1. **Dashboard** — Live KPIs (Total SKUs, Locations, Suppliers, Forecast Demand, Shortage Units, Critical Shortages), Supplier Capacity Overview, Dataset Coverage pills, and interactive Demand vs Inventory and Shortage Distribution charts.
2. **Demand & Inventory** — Searchable, filterable view of Forecast Demand lines, SKU × Location net balances, and Inventory Master stock levels.
3. **Shortage Analysis** — Shortage ID, SKU, location, week, projected balance, shortage units, severity priority (with critical rows highlighted), and shortage root cause.
4. **Supplier Management** — Supplier reliability, lead times across locations, weekly capacity bookings, utilisation chart, and capacity constraint flags.
5. **Mitigation Options** — Explains each mitigation option and its linked shortage, displays service impact (`planned_units` / `remaining_shortage`) when available, and enforces capacity & policy guardrails so options that violate capacity or policy rules are blocked.
6. **Data & Validation** — Displays `final_validation_report.csv`, the 5 required edge cases (`EDGE-001` through `EDGE-005`), table-level checks from `validation_summary.csv`, and an isolated panel for `ground_truth.csv` labels.
