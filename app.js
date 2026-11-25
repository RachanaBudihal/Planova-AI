/* ==========================================================================
   app.js — PLANOVA Interactive Prototype Application Logic
   ==========================================================================
   Manages:
   1. Automatic loading of the project's built-in sample CSV datasets on startup
      (via ../data/*.csv over HTTP or verbatim snapshot in sampleData.js for file://)
   2. Optional custom CSV file / folder upload + Reset to Sample Data
   3. Data joins & KPI calculations (strictly from loaded data; never fabricated)
   4. Rendering for all 6 sections:
      - Dashboard
      - Demand & Inventory
      - Shortage Analysis
      - Supplier Management
      - Mitigation Recommendations (with capacity & policy gates)
      - Data & Validation (including 5 edge cases & isolated ground truth)
   ========================================================================== */

(function () {
  "use strict";

  const {
    DATASET_CATALOG,
    identifyDatasetKey,
    parseCSVText,
    validateDatasetSchema,
    toNumber,
    toBool,
  } = window.PlanovaCSV;

  const {
    renderGroupedBarChart,
    renderDonutChart,
    renderHorizontalBarChart,
  } = window.PlanovaCharts;

  // ---------------- Application State ----------------
  const state = {
    datasets: {},               // Map of datasetKey -> { fileName, headers, rows }
    dataSourceMode: "sample",   // "sample" | "full" | "custom" | "empty"
    fullDataAgg: {},            // Pre-computed aggregates from fullData.js __agg__ metadata
    fullDataMeta: {},           // Per-file metadata (full vs sampled) from fullData.js __meta__
    sampleBannerDismissed: false,
    activePage: "dashboard",
    charts: {
      dviMode: "location",      // "location" | "category"
      shortageMode: "priority", // "priority" | "location"
    },
    pagination: {
      diPage: 1,
      shPage: 1,
      mitPage: 1,
      pageSize: 25,
    },
  };

  // ---------------- DOM Helpers ----------------
  const $ = (id) => document.getElementById(id);

  function escapeHtml(val) {
    return String(val === undefined || val === null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtInt(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function fmtPct(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return `${Number(n).toFixed(1)}%`;
  }

  function showToast(message, type = "info") {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 5200);
  }

  function hasDataset(key) {
    return Boolean(state.datasets[key] && state.datasets[key].rows);
  }

  function getRows(key) {
    return hasDataset(key) ? state.datasets[key].rows : [];
  }

  // ---------------- Lookup Maps (Built from Loaded CSVs) ----------------
  function buildLookups() {
    const skuMap = new Map();
    for (const r of getRows("sku")) {
      skuMap.set(r.sku_id, r);
    }

    const locMap = new Map();
    for (const r of getRows("location")) {
      locMap.set(r.location_id, r);
    }

    const supMap = new Map();
    for (const r of getRows("supplier")) {
      supMap.set(r.supplier_id, r);
    }

    const invMap = new Map();
    for (const r of getRows("inventory")) {
      const k = `${r.sku_id}|${r.location_id}`;
      invMap.set(k, (invMap.get(k) || 0) + (toNumber(r.stock, 0) || 0));
    }

    const expMap = new Map();
    for (const r of getRows("shortage_explanations")) {
      expMap.set(`${r.sku_id}|${r.location_id}|${r.week}`, r);
    }

    const shortageIdMap = new Map();
    const mitSource =
      getRows("updated_mitigation_feasibility").length > 0
        ? getRows("updated_mitigation_feasibility")
        : getRows("mitigation_feasibility").length > 0
        ? getRows("mitigation_feasibility")
        : getRows("mitigation_recommendations");

    for (const r of mitSource) {
      const k = `${r.sku_id}|${r.location_id}|${r.week}`;
      if (!shortageIdMap.has(k) && r.shortage_id) {
        shortageIdMap.set(k, r.shortage_id);
      }
    }

    const supCapWeekMap = new Map();
    for (const r of getRows("supplier_capacity_analysis")) {
      supCapWeekMap.set(`${r.supplier_id}|${r.week}`, r);
    }

    const capCheckWeekMap = new Map();
    for (const r of getRows("capacity_check")) {
      capCheckWeekMap.set(`${r.supplier_id}|${r.week}`, r);
    }

    return {
      skuMap,
      locMap,
      supMap,
      invMap,
      expMap,
      shortageIdMap,
      supCapWeekMap,
      capCheckWeekMap,
    };
  }

  function getUnifiedShortages(lookups) {
    let sourceName = null;
    let baseRows = [];

    if (hasDataset("shortages")) {
      sourceName = "shortages.csv";
      baseRows = getRows("shortages");
    } else if (hasDataset("shortage_explanations")) {
      sourceName = "shortage_explanations.csv";
      baseRows = getRows("shortage_explanations");
    } else if (hasDataset("integrated_shortages")) {
      sourceName = "integrated_shortages.csv";
      baseRows = getRows("integrated_shortages");
    }

    const unified = baseRows.map((r) => {
      const key = `${r.sku_id}|${r.location_id}|${r.week}`;
      const exp = lookups.expMap.get(key);
      const shortageId = r.shortage_id || lookups.shortageIdMap.get(key) || "—";
      const projected =
        r.projected_balance !== undefined && r.projected_balance !== ""
          ? toNumber(r.projected_balance)
          : r.projected_available !== undefined && r.projected_available !== ""
          ? toNumber(r.projected_available)
          : exp
          ? toNumber(exp.projected_available)
          : null;

      return {
        shortage_id: shortageId,
        sku_id: r.sku_id,
        location_id: r.location_id,
        week: toNumber(r.week, r.week),
        demand_units: toNumber(r.demand_units, 0),
        projected_balance: projected,
        shortage_units: toNumber(r.shortage_units, 0),
        priority: String(r.priority || (exp && exp.priority) || "UNSPECIFIED").toUpperCase(),
        shortage_reason:
          r.shortage_reason || (exp && exp.shortage_reason) || null,
      };
    });

    return { sourceName, rows: unified };
  }

  // ---------------- Navigation ----------------
  function switchPage(pageId) {
    state.activePage = pageId;
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.page === pageId);
    });
    document.querySelectorAll(".page-section").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `page-${pageId}`);
    });
    closeMobileSidebar();
    renderAll();
  }

  function openMobileSidebar() {
    $("sidebar").classList.add("open");
    $("sidebar-backdrop").classList.add("open");
  }

  function closeMobileSidebar() {
    $("sidebar").classList.remove("open");
    $("sidebar-backdrop").classList.remove("open");
  }

  // ---------------- Sample Data Loader & Reset ----------------
  /**
   * Parses the bundled verbatim Planova sample CSV files (from sampleData.js)
   * using the exact same CSV parser used for user uploads.
   * This ensures instant dashboard rendering even when opened directly via file://.
   */
  function loadBundledSampleCSVs() {
    // Prefer full-scale project data (window.PLANOVA_FULL_CSVS from fullData.js),
    // fall back to built-in sample data (window.PLANOVA_SAMPLE_CSVS from sampleData.js).
    const isFullData = Boolean(window.PLANOVA_FULL_CSVS && Object.keys(window.PLANOVA_FULL_CSVS).length > 0);
    const bundle = isFullData ? window.PLANOVA_FULL_CSVS : (window.PLANOVA_SAMPLE_CSVS || {});
    const parsedDatasets = {};

    // Extract and store aggregate statistics for large CSVs (pre-computed in fullData.js)
    // These are stored under special __agg__ key as a JSON string.
    state.fullDataAgg = {};
    if (bundle.__agg__) {
      try { state.fullDataAgg = JSON.parse(bundle.__agg__); } catch (_e) {}
    }
    state.fullDataMeta = {};
    if (bundle.__meta__) {
      try { state.fullDataMeta = JSON.parse(bundle.__meta__); } catch (_e) {}
    }

    for (const [fileName, rawText] of Object.entries(bundle)) {
      // Skip internal metadata keys
      if (fileName.startsWith("__") && fileName.endsWith("__")) continue;
      const key = identifyDatasetKey(fileName);
      if (!key) continue;
      try {
        const parsed = parseCSVText(rawText, fileName);
        validateDatasetSchema(key, parsed.headers, fileName);
        parsedDatasets[key] = {
          fileName,
          headers: parsed.headers,
          rows: parsed.rows,
        };
      } catch (_err) {
        // Ignore unrecognised or optional files
      }
    }

    state.datasets = parsedDatasets;
    if (Object.keys(parsedDatasets).length === 0) {
      state.dataSourceMode = "empty";
    } else {
      state.dataSourceMode = isFullData ? "full" : "sample";
    }
  }

  /**
   * When served over HTTP(S) from the parent Planova/ directory, refreshes the
   * sample datasets directly from ../data/*.csv so live edits to disk CSVs are picked up.
   */
  async function tryRefreshSampleFromHttp() {
    if (window.location.protocol === "file:") {
      return;
    }

    const autoKeys = Object.keys(DATASET_CATALOG).filter(
      (k) => k !== "integrated_planning"
    );

    const fetched = {};
    await Promise.all(
      autoKeys.map(async (key) => {
        const fileName = DATASET_CATALOG[key].label;
        try {
          const resp = await fetch(`../data/${fileName}`, { cache: "no-store" });
          if (!resp.ok) return;
          const text = await resp.text();
          const parsed = parseCSVText(text, fileName);
          validateDatasetSchema(key, parsed.headers, fileName);
          fetched[key] = {
            fileName,
            headers: parsed.headers,
            rows: parsed.rows,
          };
        } catch (_err) {
          // Silently ignore if ../data is not served at this mount point
        }
      })
    );

    // Only apply if user hasn't already switched to custom CSVs or cleared data
    if (Object.keys(fetched).length > 0 && (state.dataSourceMode === "sample" || state.dataSourceMode === "full")) {
      state.datasets = fetched;
      populateFilterDropdowns();
      renderAll();
      updateImportModalChecklist();
    }
  }

  function resetToSampleData() {
    $("di-search").value = "";
    $("sh-search").value = "";
    $("sup-search").value = "";
    $("mit-search").value = "";

    state.pagination.diPage = 1;
    state.pagination.shPage = 1;
    state.pagination.mitPage = 1;
    state.sampleBannerDismissed = false;

    loadBundledSampleCSVs();
    populateFilterDropdowns();
    renderAll();
    updateImportModalChecklist();
    tryRefreshSampleFromHttp();

    showToast(
      window.PLANOVA_FULL_CSVS
        ? "Restored full-scale Planova project datasets."
        : "Restored original Planova sample CSV datasets.",
      "success"
    );
  }

  function clearAllData() {
    state.datasets = {};
    state.dataSourceMode = "empty";
    state.pagination.diPage = 1;
    state.pagination.shPage = 1;
    state.pagination.mitPage = 1;

    $("di-search").value = "";
    $("sh-search").value = "";
    $("sup-search").value = "";
    $("mit-search").value = "";

    populateFilterDropdowns();
    renderAll();
    updateImportModalChecklist();
    showToast("Cleared all loaded datasets.", "info");
  }

  // ---------------- Optional Custom CSV Upload ----------------
  async function handleFileList(fileList) {
    const files = Array.from(fileList || []).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
    );

    if (files.length === 0) {
      showToast("No .csv files were found in your selection.", "warn");
      return;
    }

    const results = await Promise.all(
      files.map(async (file) => {
        const key = identifyDatasetKey(file.name);
        if (!key) {
          return { status: "ignored", fileName: file.name };
        }
        try {
          const text = await file.text();
          const parsed = parseCSVText(text, file.name);
          validateDatasetSchema(key, parsed.headers, file.name);
          return {
            status: "ok",
            key,
            data: {
              fileName: file.name,
              headers: parsed.headers,
              rows: parsed.rows,
            },
          };
        } catch (err) {
          return {
            status: "error",
            error: err.message || `${file.name}: Failed to parse.`,
          };
        }
      })
    );

    const validResults = results.filter((r) => r.status === "ok");
    const errors = results.filter((r) => r.status === "error").map((r) => r.error);
    const ignored = results.filter((r) => r.status === "ignored").map((r) => r.fileName);

    if (validResults.length > 0) {
      const replaceSample =
        $("replace-sample-checkbox") && $("replace-sample-checkbox").checked;

      // When transitioning from built-in sample data to user CSVs with replace enabled,
      // clear the sample datasets so missing tables display honestly as Unavailable.
      if (state.dataSourceMode === "sample" && replaceSample) {
        state.datasets = {};
      }

      for (const res of validResults) {
        state.datasets[res.key] = res.data;
      }
      state.dataSourceMode = "custom";
    }

    state.pagination.diPage = 1;
    state.pagination.shPage = 1;
    state.pagination.mitPage = 1;

    populateFilterDropdowns();
    renderAll();
    updateImportModalChecklist();

    if (validResults.length > 0) {
      showToast(
        `Loaded ${validResults.length} custom CSV dataset(s). Click "Reset to Sample Data" anytime to restore defaults.`,
        "success"
      );
    }
    if (errors.length > 0) {
      errors.forEach((msg) => showToast(msg, "error"));
    }
    if (validResults.length === 0 && ignored.length > 0 && errors.length === 0) {
      showToast(
        `Ignored unrecognised CSV file(s): ${ignored.slice(0, 3).join(", ")}.`,
        "warn"
      );
    }
  }

  // ---------------- Populate Filter Dropdowns ----------------
  function populateFilterDropdowns() {
    const lookups = buildLookups();

    const locIds = new Set();
    getRows("location").forEach((r) => locIds.add(r.location_id));
    getRows("forecast_demand").forEach((r) => locIds.add(r.location_id));
    getRows("inventory").forEach((r) => locIds.add(r.location_id));
    getRows("shortages").forEach((r) => locIds.add(r.location_id));
    getRows("shortage_explanations").forEach((r) => locIds.add(r.location_id));

    const sortedLocs = Array.from(locIds).sort();
    const locOptionsHtml =
      `<option value="ALL">All Locations</option>` +
      sortedLocs
        .map((id) => {
          const meta = lookups.locMap.get(id);
          const lbl = meta && meta.location_name ? `${id} (${meta.location_name})` : id;
          return `<option value="${escapeHtml(id)}">${escapeHtml(lbl)}</option>`;
        })
        .join("");

    $("di-location-filter").innerHTML = locOptionsHtml;
    $("sh-location-filter").innerHTML = locOptionsHtml;

    const skuIds = new Set();
    getRows("sku").forEach((r) => skuIds.add(r.sku_id));
    getRows("forecast_demand").forEach((r) => skuIds.add(r.sku_id));
    getRows("inventory").forEach((r) => skuIds.add(r.sku_id));

    const sortedSkus = Array.from(skuIds).sort();
    $("di-sku-filter").innerHTML =
      `<option value="ALL">All SKUs (${sortedSkus.length})</option>` +
      sortedSkus
        .map((id) => {
          const meta = lookups.skuMap.get(id);
          const lbl = meta && meta.product_name ? `${id} — ${meta.product_name}` : id;
          return `<option value="${escapeHtml(id)}">${escapeHtml(lbl)}</option>`;
        })
        .join("");

    const supIds = new Set();
    getRows("supplier").forEach((r) => supIds.add(r.supplier_id));
    getRows("lead_times").forEach((r) => supIds.add(r.supplier_id));
    getRows("supplier_capacity_analysis").forEach((r) => supIds.add(r.supplier_id));
    getRows("capacity_check").forEach((r) => supIds.add(r.supplier_id));

    const sortedSups = Array.from(supIds).sort();
    const supOptionsHtml =
      `<option value="ALL">All Suppliers</option>` +
      sortedSups
        .map((id) => {
          const meta = lookups.supMap.get(id);
          const lbl = meta && meta.supplier_name ? `${id} (${meta.supplier_name})` : id;
          return `<option value="${escapeHtml(id)}">${escapeHtml(lbl)}</option>`;
        })
        .join("");

    $("lt-supplier-filter").innerHTML = supOptionsHtml;
    $("cap-supplier-filter").innerHTML = supOptionsHtml;

    const mitOpts = new Set();
    getRows("mitigation_recommendations").forEach((r) => mitOpts.add(r.option));
    getRows("mitigation_feasibility").forEach((r) => mitOpts.add(r.option));
    getRows("updated_mitigation_feasibility").forEach((r) => mitOpts.add(r.option));
    $("mit-option-filter").innerHTML =
      `<option value="ALL">All Options</option>` +
      Array.from(mitOpts)
        .filter(Boolean)
        .sort()
        .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join("");
  }

  // ---------------- Global Status & Chrome ----------------
  function renderStatusChrome(lookups) {
    const count = Object.keys(state.datasets).length;
    const pill = $("mode-pill");
    const sideStatus = $("sidebar-data-status");
    const sideSub = $("sidebar-file-count");
    const sampleBanner = $("sample-info-banner");
    const customBanner = $("custom-info-banner");
    const emptyBanner = $("empty-info-banner");

    if (state.dataSourceMode === "empty" || count === 0) {
      pill.textContent = "No Data Loaded";
      pill.className = "status-pill status-neutral";
      sideStatus.textContent = "No CSVs Loaded";
      sideSub.textContent = "Upload CSVs or reset to sample";
      sampleBanner.classList.add("hidden");
      customBanner.classList.add("hidden");
      emptyBanner.classList.remove("hidden");
    } else if (state.dataSourceMode === "full") {
      // Full-scale project data loaded from fullData.js
      pill.textContent = `Full Project Data (${count} CSVs)`;
      pill.className = "status-pill status-full";
      sideStatus.textContent = "Full Project Data Active";
      sideSub.textContent = `${count} full-scale CSVs loaded`;
      sampleBanner.classList.add("hidden");
      customBanner.classList.add("hidden");
      emptyBanner.classList.add("hidden");
    } else if (state.dataSourceMode === "sample") {
      pill.textContent = `Sample Data (${count} CSVs)`;
      pill.className = "status-pill status-ready";
      sideStatus.textContent = "Sample Data Active";
      sideSub.textContent = `${count} project CSVs loaded`;
      sampleBanner.classList.toggle("hidden", state.sampleBannerDismissed);
      customBanner.classList.add("hidden");
      emptyBanner.classList.add("hidden");
    } else {
      pill.textContent = `Custom Data (${count} CSV${count === 1 ? "" : "s"})`;
      pill.className = "status-pill status-partial";
      sideStatus.textContent = "Custom CSVs Active";
      sideSub.textContent = `${count} uploaded dataset(s)`;
      sampleBanner.classList.add("hidden");
      customBanner.classList.remove("hidden");
      emptyBanner.classList.add("hidden");
    }

    const shortages = getUnifiedShortages(lookups).rows;
    const critCount = shortages.filter((s) => s.priority === "CRITICAL").length;
    const badge = $("nav-shortage-badge");
    if (shortages.length > 0 && critCount > 0) {
      badge.textContent = critCount;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  // ---------------- A. Dashboard Rendering ----------------
  function renderDashboard(lookups) {
    const count = Object.keys(state.datasets).length;
    $("dash-last-updated").textContent =
      count === 0
        ? "No datasets loaded"
        : state.dataSourceMode === "full"
        ? `Source: Full-scale Planova project datasets (${count} CSV files — 3,000 SKUs / 50 Locations / 500 Suppliers)`
        : state.dataSourceMode === "sample"
        ? `Source: Built-in Planova sample datasets (${count} CSV files)`
        : `Source: ${count} user-uploaded CSV file(s)`;

    if (hasDataset("sku")) {
      const skus = getRows("sku");
      const cats = new Set(skus.map((s) => s.category).filter(Boolean));
      $("kpi-skus").textContent = fmtInt(skus.length);
      $("kpi-skus").classList.remove("muted");
      $("kpi-skus-sub").textContent = `${cats.size} product categories`;
    } else {
      $("kpi-skus").textContent = "Unavailable";
      $("kpi-skus").classList.add("muted");
      $("kpi-skus-sub").textContent = "Requires sku.csv";
    }

    if (hasDataset("location")) {
      const locs = getRows("location");
      $("kpi-locations").textContent = fmtInt(locs.length);
      $("kpi-locations").classList.remove("muted");
      $("kpi-locations-sub").textContent = "From location.csv";
    } else {
      $("kpi-locations").textContent = "Unavailable";
      $("kpi-locations").classList.add("muted");
      $("kpi-locations-sub").textContent = "Requires location.csv";
    }

    if (hasDataset("supplier")) {
      const sups = getRows("supplier");
      const relVals = sups.map((s) => toNumber(s.reliability)).filter((n) => n !== null);
      const avgRel =
        relVals.length > 0
          ? relVals.reduce((a, b) => a + b, 0) / relVals.length
          : null;
      $("kpi-suppliers").textContent = fmtInt(sups.length);
      $("kpi-suppliers").classList.remove("muted");
      $("kpi-suppliers-sub").textContent =
        avgRel !== null ? `Avg reliability: ${avgRel.toFixed(1)}%` : "From supplier.csv";
    } else {
      $("kpi-suppliers").textContent = "Unavailable";
      $("kpi-suppliers").classList.add("muted");
      $("kpi-suppliers-sub").textContent = "Requires supplier.csv";
    }

    if (hasDataset("forecast_demand")) {
      const demRows = getRows("forecast_demand");
      // For full data mode, use pre-aggregated totals from fullData.js __agg__ metadata
      // so we don't have to sum 500,000 rows in the browser each render.
      const totalDem = (state.dataSourceMode === "full" && state.fullDataAgg.forecast_total_demand)
        ? state.fullDataAgg.forecast_total_demand
        : demRows.reduce((s, r) => s + (toNumber(r.demand_units, 0) || 0), 0);
      const totalRows = (state.dataSourceMode === "full" && state.fullDataAgg.forecast_total_rows)
        ? state.fullDataAgg.forecast_total_rows
        : demRows.length;
      $("kpi-demand").textContent = fmtInt(totalDem);
      $("kpi-demand").classList.remove("muted");
      $("kpi-demand-sub").textContent = `Across ${fmtInt(totalRows)} demand lines`;
    } else {
      $("kpi-demand").textContent = "Unavailable";
      $("kpi-demand").classList.add("muted");
      $("kpi-demand-sub").textContent = "Requires forecast_demand.csv";
    }

    const { sourceName, rows: shortages } = getUnifiedShortages(lookups);
    if (sourceName) {
      const totalShUnits = shortages.reduce((s, r) => s + r.shortage_units, 0);
      const critCount = shortages.filter((r) => r.priority === "CRITICAL").length;
      $("kpi-shortage-units").textContent = fmtInt(totalShUnits);
      $("kpi-shortage-units").classList.remove("muted");
      $("kpi-shortage-units-sub").textContent = `${fmtInt(shortages.length)} shortage events (${sourceName})`;

      $("kpi-critical").textContent = fmtInt(critCount);
      $("kpi-critical").classList.remove("muted");
      $("kpi-critical-sub").textContent =
        shortages.length > 0
          ? `${((critCount / shortages.length) * 100).toFixed(1)}% of total shortages`
          : "0 shortage records";
    } else {
      $("kpi-shortage-units").textContent = "Unavailable";
      $("kpi-shortage-units").classList.add("muted");
      $("kpi-shortage-units-sub").textContent = "Requires shortages.csv";

      $("kpi-critical").textContent = "Unavailable";
      $("kpi-critical").classList.add("muted");
      $("kpi-critical-sub").textContent = "Requires shortages.csv";
    }

    renderDashboardCapacityOverview();

    const keyFiles = [
      "sku",
      "location",
      "supplier",
      "forecast_demand",
      "inventory",
      "lead_times",
      "purchase_orders",
      "shortages",
      "shortage_explanations",
      "supplier_capacity",
      "supplier_capacity_analysis",
      "capacity_check",
      "mitigation_recommendations",
      "mitigation_feasibility",
      "updated_mitigation_feasibility",
      "final_validation_report",
      "edge_case_detection_results",
      "ground_truth",
    ];
    $("dataset-coverage-list").innerHTML = keyFiles
      .map((k) => {
        const loaded = hasDataset(k);
        const rowsLen = loaded ? state.datasets[k].rows.length : 0;
        return `
          <span class="dataset-pill ${loaded ? "loaded" : "missing"}">
            <span class="dot ${loaded ? "dot-green" : "dot-gray"}"></span>
            <span>${escapeHtml(DATASET_CATALOG[k].label)}</span>
            ${loaded ? `<strong>(${fmtInt(rowsLen)})</strong>` : ""}
          </span>
        `;
      })
      .join("");

    renderDashboardCharts(lookups, shortages, sourceName);
  }

  function renderDashboardCapacityOverview() {
    const host = $("dash-capacity-overview");
    const badge = $("dash-cap-badge");

    if (hasDataset("supplier_capacity_analysis")) {
      const rows = getRows("supplier_capacity_analysis");
      const booked = rows.reduce((s, r) => s + (toNumber(r.booked_units, 0) || 0), 0);
      const cap = rows.reduce((s, r) => s + (toNumber(r.capacity_units, 0) || 0), 0);
      const exceeded = rows.filter(
        (r) =>
          (toNumber(r.excess_units, 0) || 0) > 0 ||
          String(r.capacity_status || "").toUpperCase().includes("EXCEED")
      ).length;
      const util = cap > 0 ? (booked / cap) * 100 : 0;

      badge.textContent = exceeded > 0 ? `${exceeded} Exceeded` : "Within Capacity";
      badge.className = `badge ${exceeded > 0 ? "badge-fail" : "badge-pass"}`;

      host.innerHTML = `
        <div class="cap-metrics-grid">
          <div class="cap-stat">
            <div class="cap-stat-label">Booked Units</div>
            <div class="cap-stat-val">${fmtInt(booked)}</div>
          </div>
          <div class="cap-stat">
            <div class="cap-stat-label">Active Capacity</div>
            <div class="cap-stat-val">${fmtInt(cap)}</div>
          </div>
          <div class="cap-stat">
            <div class="cap-stat-label">Avg Utilisation</div>
            <div class="cap-stat-val">${fmtPct(util)}</div>
          </div>
          <div class="cap-stat">
            <div class="cap-stat-label">Exceeded Weeks</div>
            <div class="cap-stat-val">${fmtInt(exceeded)}</div>
          </div>
        </div>
        <p class="cell-sub" style="margin-top:12px;">
          Calculated across ${fmtInt(rows.length)} supplier-week bookings in <code>supplier_capacity_analysis.csv</code>.
        </p>
      `;
    } else if (hasDataset("capacity_check")) {
      const rows = getRows("capacity_check");
      const booked = rows.reduce((s, r) => s + (toNumber(r.quantity, 0) || 0), 0);
      const cap = rows.reduce((s, r) => s + (toNumber(r.capacity_units, 0) || 0), 0);
      const exceeded = rows.filter((r) => toBool(r.capacity_exceeded) === true).length;
      const util = cap > 0 ? (booked / cap) * 100 : 0;

      badge.textContent = exceeded > 0 ? `${exceeded} Exceeded` : "Within Capacity";
      badge.className = `badge ${exceeded > 0 ? "badge-fail" : "badge-pass"}`;

      host.innerHTML = `
        <div class="cap-metrics-grid">
          <div class="cap-stat">
            <div class="cap-stat-label">PO Quantity</div>
            <div class="cap-stat-val">${fmtInt(booked)}</div>
          </div>
          <div class="cap-stat">
            <div class="cap-stat-label">Checked Capacity</div>
            <div class="cap-stat-val">${fmtInt(cap)}</div>
          </div>
          <div class="cap-stat">
            <div class="cap-stat-label">Utilisation</div>
            <div class="cap-stat-val">${fmtPct(util)}</div>
          </div>
          <div class="cap-stat">
            <div class="cap-stat-label">Exceeded Checks</div>
            <div class="cap-stat-val">${fmtInt(exceeded)}</div>
          </div>
        </div>
      `;
    } else if (hasDataset("supplier_capacity")) {
      const rows = getRows("supplier_capacity");
      const totalCap = rows.reduce((s, r) => s + (toNumber(r.capacity_units, 0) || 0), 0);
      badge.textContent = "Capacity Only";
      badge.className = "badge badge-info";
      host.innerHTML = `
        <div class="cap-metrics-grid">
          <div class="cap-stat">
            <div class="cap-stat-label">Total Weekly Capacity</div>
            <div class="cap-stat-val">${fmtInt(totalCap)}</div>
          </div>
          <div class="cap-stat">
            <div class="cap-stat-label">Capacity Records</div>
            <div class="cap-stat-val">${fmtInt(rows.length)}</div>
          </div>
        </div>
        <p class="cell-sub" style="margin-top:12px;">
          Upload <code>supplier_capacity_analysis.csv</code> or <code>purchase_orders.csv</code> to compute utilisation %.
        </p>
      `;
    } else {
      badge.textContent = "Unavailable";
      badge.className = "badge badge-neutral";
      host.innerHTML = `
        <div class="empty-state">
          Load <code>supplier_capacity_analysis.csv</code>, <code>capacity_check.csv</code>, or <code>supplier_capacity.csv</code> to view supplier capacity metrics.
        </div>
      `;
    }
  }

  function renderDashboardCharts(lookups, shortages, shortageSource) {
    const dviHost = $("chart-demand-inventory");
    if (!hasDataset("forecast_demand") || !hasDataset("inventory")) {
      dviHost.innerHTML = `
        <div class="empty-state">
          Demand vs Inventory chart requires both <code>forecast_demand.csv</code> and <code>inventory.csv</code>.
        </div>
      `;
    } else if (state.charts.dviMode === "category" && !hasDataset("sku")) {
      dviHost.innerHTML = `
        <div class="empty-state">
          Category grouping requires <code>sku.csv</code>. Switch to "By Location" or upload <code>sku.csv</code>.
        </div>
      `;
    } else {
      const groups = new Map();
      const getGroupKey = (row) => {
        if (state.charts.dviMode === "category") {
          const sku = lookups.skuMap.get(row.sku_id);
          return sku && sku.category ? sku.category : "Uncategorised";
        }
        return row.location_id || "Unknown";
      };

      for (const d of getRows("forecast_demand")) {
        const k = getGroupKey(d);
        if (!groups.has(k)) groups.set(k, { label: k, fullLabel: k, demand: 0, stock: 0 });
        groups.get(k).demand += toNumber(d.demand_units, 0) || 0;
      }
      for (const inv of getRows("inventory")) {
        const k = getGroupKey(inv);
        if (!groups.has(k)) groups.set(k, { label: k, fullLabel: k, demand: 0, stock: 0 });
        groups.get(k).stock += toNumber(inv.stock, 0) || 0;
      }

      const items = Array.from(groups.values())
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((item) => {
          if (state.charts.dviMode === "location") {
            const loc = lookups.locMap.get(item.label);
            return {
              ...item,
              fullLabel: loc ? `${item.label} (${loc.location_name})` : item.label,
            };
          }
          return item;
        });

      renderGroupedBarChart(dviHost, items);
    }

    const shHost = $("chart-shortage-dist");
    if (!shortageSource || shortages.length === 0) {
      shHost.innerHTML = `
        <div class="empty-state">
          Shortage Distribution chart requires <code>shortages.csv</code> or <code>shortage_explanations.csv</code>.
        </div>
      `;
    } else if (state.charts.shortageMode === "priority") {
      const buckets = {
        CRITICAL: { label: "CRITICAL", count: 0, units: 0, color: "#dc2626" },
        HIGH: { label: "HIGH", count: 0, units: 0, color: "#d97706" },
        MEDIUM: { label: "MEDIUM", count: 0, units: 0, color: "#2563eb" },
      };
      for (const s of shortages) {
        const p = buckets[s.priority] ? s.priority : "MEDIUM";
        buckets[p].count += 1;
        buckets[p].units += s.shortage_units;
      }
      renderDonutChart(shHost, [buckets.CRITICAL, buckets.HIGH, buckets.MEDIUM]);
    } else {
      const locAgg = new Map();
      for (const s of shortages) {
        const loc = s.location_id || "Unknown";
        if (!locAgg.has(loc)) locAgg.set(loc, { count: 0, units: 0 });
        locAgg.get(loc).count += 1;
        locAgg.get(loc).units += s.shortage_units;
      }
      const rows = Array.from(locAgg.entries())
        .sort((a, b) => b[1].units - a[1].units)
        .slice(0, 10)
        .map(([locId, val]) => {
          const loc = lookups.locMap.get(locId);
          return {
            label: loc ? `${locId} (${loc.location_name})` : locId,
            value: val.units,
            color: "#1e4070",
            rightText: `${fmtInt(val.units)} u`,
            detail: `${fmtInt(val.units)} shortage units across ${fmtInt(val.count)} events`,
          };
        });
      renderHorizontalBarChart(shHost, rows, "shortage units");
    }
  }

  // ---------------- B. Demand & Inventory Rendering ----------------
  function renderDemandInventory(lookups) {
    const hasDemand = hasDataset("forecast_demand");
    const hasInv = hasDataset("inventory");

    if (!hasDemand && !hasInv) {
      $("di-unavailable").classList.remove("hidden");
      $("di-content").classList.add("hidden");
      return;
    }

    $("di-unavailable").classList.add("hidden");
    $("di-content").classList.remove("hidden");

    const search = $("di-search").value.trim().toLowerCase();
    const skuFilter = $("di-sku-filter").value;
    const locFilter = $("di-location-filter").value;
    let viewMode = $("di-view-mode").value;

    if (viewMode === "demand" && !hasDemand && hasInv) {
      viewMode = "inventory";
      $("di-view-mode").value = "inventory";
    } else if (viewMode === "inventory" && !hasInv && hasDemand) {
      viewMode = "demand";
      $("di-view-mode").value = "demand";
    }

    const { rows: shortages } = getUnifiedShortages(lookups);
    const shByWeek = new Map();
    const shByPair = new Map();
    for (const s of shortages) {
      shByWeek.set(`${s.sku_id}|${s.location_id}|${s.week}`, s);
      shByPair.set(
        `${s.sku_id}|${s.location_id}`,
        (shByPair.get(`${s.sku_id}|${s.location_id}`) || 0) + s.shortage_units
      );
    }

    const planByWeek = new Map();
    for (const p of getRows("integrated_planning")) {
      planByWeek.set(`${p.sku_id}|${p.location_id}|${p.week}`, p);
    }

    const demByPair = new Map();
    for (const d of getRows("forecast_demand")) {
      const k = `${d.sku_id}|${d.location_id}`;
      demByPair.set(k, (demByPair.get(k) || 0) + (toNumber(d.demand_units, 0) || 0));
    }

    let records = [];

    if (viewMode === "demand") {
      records = getRows("forecast_demand").map((d) => {
        const pairKey = `${d.sku_id}|${d.location_id}`;
        const wkKey = `${pairKey}|${d.week}`;
        const sku = lookups.skuMap.get(d.sku_id);
        const loc = lookups.locMap.get(d.location_id);
        const stock = hasInv ? lookups.invMap.get(pairKey) ?? 0 : null;
        const demUnits = toNumber(d.demand_units, 0) || 0;
        const sh = shByWeek.get(wkKey);
        const plan = planByWeek.get(wkKey);

        let projBalance = null;
        let projNote = "";
        if (plan && plan.closing_balance !== undefined && plan.closing_balance !== "") {
          projBalance = toNumber(plan.closing_balance);
          projNote = "From integrated_planning";
        } else if (sh && sh.projected_balance !== null) {
          projBalance = sh.projected_balance - sh.shortage_units;
          projNote = `Shortage: ${fmtInt(sh.shortage_units)} u`;
        } else if (stock !== null) {
          projBalance = stock - demUnits;
          projNote = "Stock - line demand";
        }

        return {
          sku_id: d.sku_id,
          product_name: sku ? sku.product_name : "—",
          category: sku ? sku.category : "—",
          location_id: d.location_id,
          location_name: loc ? loc.location_name : "—",
          week: toNumber(d.week, d.week),
          demand_units: demUnits,
          stock,
          projBalance,
          projNote,
          shortageUnits: sh ? sh.shortage_units : 0,
        };
      });
    } else if (viewMode === "inventory") {
      records = getRows("inventory").map((inv) => {
        const pairKey = `${inv.sku_id}|${inv.location_id}`;
        const sku = lookups.skuMap.get(inv.sku_id);
        const loc = lookups.locMap.get(inv.location_id);
        const stock = toNumber(inv.stock, 0) || 0;
        const totalDem = hasDemand ? demByPair.get(pairKey) || 0 : null;
        const net = totalDem !== null ? stock - totalDem : null;

        return {
          sku_id: inv.sku_id,
          product_name: sku ? sku.product_name : "—",
          category: sku ? sku.category : "—",
          location_id: inv.location_id,
          location_name: loc ? loc.location_name : "—",
          stock,
          demand_units: totalDem,
          projBalance: net,
        };
      });
    } else {
      const allPairs = new Set([...demByPair.keys(), ...lookups.invMap.keys()]);
      records = Array.from(allPairs).map((pairKey) => {
        const [sku_id, location_id] = pairKey.split("|");
        const sku = lookups.skuMap.get(sku_id);
        const loc = lookups.locMap.get(location_id);
        const totalDem = hasDemand ? demByPair.get(pairKey) || 0 : null;
        const stock = hasInv ? lookups.invMap.get(pairKey) || 0 : null;
        const net =
          totalDem !== null && stock !== null ? stock - totalDem : null;
        return {
          sku_id,
          product_name: sku ? sku.product_name : "—",
          category: sku ? sku.category : "—",
          location_id,
          location_name: loc ? loc.location_name : "—",
          demand_units: totalDem,
          stock,
          projBalance: net,
          shortageUnits: shByPair.get(pairKey) || 0,
        };
      });
    }

    const filtered = records.filter((r) => {
      if (skuFilter !== "ALL" && r.sku_id !== skuFilter) return false;
      if (locFilter !== "ALL" && r.location_id !== locFilter) return false;
      if (search) {
        const hay = `${r.sku_id} ${r.product_name} ${r.category} ${r.location_id} ${r.location_name}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const sumDemand = filtered.reduce((s, r) => s + (r.demand_units || 0), 0);
    const sumStock = filtered.reduce((s, r) => s + (r.stock || 0), 0);
    $("di-summary-strip").innerHTML = `
      <div class="summary-chip"><span>Matching Records</span><strong>${fmtInt(filtered.length)}</strong></div>
      <div class="summary-chip"><span>Filtered Demand</span><strong>${hasDemand ? fmtInt(sumDemand) : "Unavailable"}</strong></div>
      <div class="summary-chip"><span>Filtered Stock</span><strong>${hasInv ? fmtInt(sumStock) : "Unavailable"}</strong></div>
    `;

    const pageSize = state.pagination.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.pagination.diPage = Math.min(state.pagination.diPage, totalPages);
    const start = (state.pagination.diPage - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    const thead = $("di-thead");
    const tbody = $("di-tbody");

    if (viewMode === "demand") {
      thead.innerHTML = `
        <tr>
          <th>SKU</th>
          <th>Location</th>
          <th class="num">Week</th>
          <th class="num">Forecast Demand</th>
          <th class="num">On-Hand Stock</th>
          <th>Availability</th>
          <th class="num">Projected Balance</th>
        </tr>
      `;
      tbody.innerHTML =
        pageRows.length === 0
          ? `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px;">No demand records match your filter.</td></tr>`
          : pageRows
              .map((r) => {
                const availBadge = getAvailabilityBadge(r.stock, r.demand_units);
                const balClass =
                  r.projBalance !== null && r.projBalance < 0 ? "color:#b91c1c;font-weight:700;" : "";
                return `
                  <tr>
                    <td>
                      <div class="cell-main">${escapeHtml(r.sku_id)}</div>
                      <div class="cell-sub">${escapeHtml(r.product_name)} &bull; ${escapeHtml(r.category)}</div>
                    </td>
                    <td>
                      <div class="cell-main">${escapeHtml(r.location_id)}</div>
                      <div class="cell-sub">${escapeHtml(r.location_name)}</div>
                    </td>
                    <td class="num">Wk ${escapeHtml(r.week)}</td>
                    <td class="num">${fmtInt(r.demand_units)}</td>
                    <td class="num">${r.stock !== null ? fmtInt(r.stock) : '<span class="muted">Unavailable</span>'}</td>
                    <td>${availBadge}</td>
                    <td class="num" style="${balClass}">
                      ${r.projBalance !== null ? fmtInt(r.projBalance) : '<span class="muted">Unavailable</span>'}
                      ${r.projNote ? `<div class="cell-sub">${escapeHtml(r.projNote)}</div>` : ""}
                    </td>
                  </tr>
                `;
              })
              .join("");
    } else {
      thead.innerHTML = `
        <tr>
          <th>SKU</th>
          <th>Location</th>
          <th class="num">Total Forecast Demand</th>
          <th class="num">On-Hand Stock</th>
          <th>Availability</th>
          <th class="num">Net Balance (Stock - Demand)</th>
        </tr>
      `;
      tbody.innerHTML =
        pageRows.length === 0
          ? `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px;">No records match your filter.</td></tr>`
          : pageRows
              .map((r) => {
                const availBadge = getAvailabilityBadge(r.stock, r.demand_units);
                const balClass =
                  r.projBalance !== null && r.projBalance < 0 ? "color:#b91c1c;font-weight:700;" : "";
                return `
                  <tr>
                    <td>
                      <div class="cell-main">${escapeHtml(r.sku_id)}</div>
                      <div class="cell-sub">${escapeHtml(r.product_name)} &bull; ${escapeHtml(r.category)}</div>
                    </td>
                    <td>
                      <div class="cell-main">${escapeHtml(r.location_id)}</div>
                      <div class="cell-sub">${escapeHtml(r.location_name)}</div>
                    </td>
                    <td class="num">${r.demand_units !== null ? fmtInt(r.demand_units) : '<span class="muted">Unavailable</span>'}</td>
                    <td class="num">${r.stock !== null ? fmtInt(r.stock) : '<span class="muted">Unavailable</span>'}</td>
                    <td>${availBadge}</td>
                    <td class="num" style="${balClass}">
                      ${r.projBalance !== null ? fmtInt(r.projBalance) : '<span class="muted">Unavailable</span>'}
                    </td>
                  </tr>
                `;
              })
              .join("");
    }

    renderPagination("di-pagination", state.pagination.diPage, totalPages, filtered.length, (next) => {
      state.pagination.diPage = next;
      renderDemandInventory(buildLookups());
    });
  }

  function getAvailabilityBadge(stock, demand) {
    if (stock === null) return `<span class="badge badge-neutral">Stock Unavailable</span>`;
    if (demand === null) return stock > 0 ? `<span class="badge badge-pass">In Stock</span>` : `<span class="badge badge-neutral">Zero Stock</span>`;
    if (demand === 0) return `<span class="badge badge-pass">No Demand</span>`;
    if (stock >= demand) return `<span class="badge badge-pass">Fully Covered</span>`;
    if (stock > 0) return `<span class="badge badge-high">Partial Stock</span>`;
    return `<span class="badge badge-critical">Zero Stock at Location</span>`;
  }

  // ---------------- C. Shortage Analysis Rendering ----------------
  function renderShortages(lookups) {
    const { sourceName, rows } = getUnifiedShortages(lookups);
    if (!sourceName) {
      $("sh-unavailable").classList.remove("hidden");
      $("sh-content").classList.add("hidden");
      return;
    }

    $("sh-unavailable").classList.add("hidden");
    $("sh-content").classList.remove("hidden");

    const search = $("sh-search").value.trim().toLowerCase();
    const prioFilter = $("sh-priority-filter").value;
    const locFilter = $("sh-location-filter").value;

    const filtered = rows.filter((r) => {
      if (prioFilter !== "ALL" && r.priority !== prioFilter) return false;
      if (locFilter !== "ALL" && r.location_id !== locFilter) return false;
      if (search) {
        const sku = lookups.skuMap.get(r.sku_id);
        const hay = `${r.shortage_id} ${r.sku_id} ${sku ? sku.product_name : ""} ${r.location_id} ${r.shortage_reason || ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const prioRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    filtered.sort((a, b) => {
      const ra = prioRank[a.priority] ?? 3;
      const rb = prioRank[b.priority] ?? 3;
      if (ra !== rb) return ra - rb;
      return b.shortage_units - a.shortage_units;
    });

    const critCount = filtered.filter((r) => r.priority === "CRITICAL").length;
    const totalUnits = filtered.reduce((s, r) => s + r.shortage_units, 0);

    $("sh-summary-strip").innerHTML = `
      <div class="summary-chip"><span>Source File</span><strong>${escapeHtml(sourceName)}</strong></div>
      <div class="summary-chip"><span>Filtered Shortages</span><strong>${fmtInt(filtered.length)}</strong></div>
      <div class="summary-chip"><span>Critical Count</span><strong style="color:#b91c1c;">${fmtInt(critCount)}</strong></div>
      <div class="summary-chip"><span>Total Shortage Units</span><strong>${fmtInt(totalUnits)}</strong></div>
    `;

    const pageSize = state.pagination.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.pagination.shPage = Math.min(state.pagination.shPage, totalPages);
    const start = (state.pagination.shPage - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    const tbody = $("sh-tbody");
    tbody.innerHTML =
      pageRows.length === 0
        ? `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px;">No shortage records match your filters.</td></tr>`
        : pageRows
            .map((r) => {
              const sku = lookups.skuMap.get(r.sku_id);
              const loc = lookups.locMap.get(r.location_id);
              const isCrit = r.priority === "CRITICAL";
              const badgeCls =
                r.priority === "CRITICAL"
                  ? "badge-critical"
                  : r.priority === "HIGH"
                  ? "badge-high"
                  : "badge-medium";

              return `
                <tr class="${isCrit ? "row-critical" : ""}">
                  <td><span class="cell-main">${escapeHtml(r.shortage_id)}</span></td>
                  <td>
                    <div class="cell-main">${escapeHtml(r.sku_id)}</div>
                    ${sku ? `<div class="cell-sub">${escapeHtml(sku.product_name)}</div>` : ""}
                  </td>
                  <td>
                    <div class="cell-main">${escapeHtml(r.location_id)}</div>
                    ${loc ? `<div class="cell-sub">${escapeHtml(loc.location_name)}</div>` : ""}
                  </td>
                  <td>Wk ${escapeHtml(r.week)}</td>
                  <td class="num">${fmtInt(r.demand_units)}</td>
                  <td class="num">${r.projected_balance !== null ? fmtInt(r.projected_balance) : "—"}</td>
                  <td class="num"><strong>${fmtInt(r.shortage_units)}</strong></td>
                  <td><span class="badge ${badgeCls}">${escapeHtml(r.priority)}</span></td>
                  <td>
                    ${
                      r.shortage_reason
                        ? escapeHtml(r.shortage_reason)
                        : '<span class="muted">Unavailable (load shortage_explanations.csv)</span>'
                    }
                  </td>
                </tr>
              `;
            })
            .join("");

    renderPagination("sh-pagination", state.pagination.shPage, totalPages, filtered.length, (next) => {
      state.pagination.shPage = next;
      renderShortages(buildLookups());
    });
  }

  // ---------------- D. Supplier Management Rendering ----------------
  function renderSuppliers(lookups) {
    const hasSup = hasDataset("supplier");
    const hasLt = hasDataset("lead_times");
    const hasCapAnalysis = hasDataset("supplier_capacity_analysis");
    const hasCapCheck = hasDataset("capacity_check");
    const hasRawCap = hasDataset("supplier_capacity");

    if (!hasSup && !hasLt && !hasCapAnalysis && !hasCapCheck && !hasRawCap) {
      $("sup-unavailable").classList.remove("hidden");
      $("sup-content").classList.add("hidden");
      return;
    }

    $("sup-unavailable").classList.add("hidden");
    $("sup-content").classList.remove("hidden");

    const supIds = new Set();
    getRows("supplier").forEach((r) => supIds.add(r.supplier_id));
    getRows("lead_times").forEach((r) => supIds.add(r.supplier_id));
    getRows("supplier_capacity_analysis").forEach((r) => supIds.add(r.supplier_id));
    getRows("capacity_check").forEach((r) => supIds.add(r.supplier_id));

    const ltAgg = new Map();
    for (const r of getRows("lead_times")) {
      const w = toNumber(r.lead_time_weeks);
      if (w === null) continue;
      if (!ltAgg.has(r.supplier_id)) ltAgg.set(r.supplier_id, []);
      ltAgg.get(r.supplier_id).push(w);
    }

    const capAgg = new Map();
    const analysisRows = hasCapAnalysis
      ? getRows("supplier_capacity_analysis")
      : getRows("capacity_check");

    for (const r of analysisRows) {
      const sid = r.supplier_id;
      if (!capAgg.has(sid)) {
        capAgg.set(sid, { booked: 0, capacity: 0, excess: 0, peakUtil: 0, exceededWeeks: 0, weeks: 0 });
      }
      const entry = capAgg.get(sid);
      const b = toNumber(r.booked_units !== undefined ? r.booked_units : r.quantity, 0) || 0;
      const c = toNumber(r.capacity_units, 0) || 0;
      const ex = toNumber(r.excess_units, 0) || 0;
      const isExc =
        ex > 0 ||
        toBool(r.capacity_exceeded) === true ||
        String(r.capacity_status || "").toUpperCase().includes("EXCEED");

      entry.booked += b;
      entry.capacity += c;
      entry.excess += ex;
      entry.weeks += 1;
      if (isExc) entry.exceededWeeks += 1;
      if (c > 0) entry.peakUtil = Math.max(entry.peakUtil, (b / c) * 100);
    }

    const search = $("sup-search").value.trim().toLowerCase();
    const constraintFilter = $("sup-constraint-filter").value;

    const supplierRows = Array.from(supIds)
      .sort()
      .map((sid) => {
        const meta = lookups.supMap.get(sid);
        const lts = ltAgg.get(sid) || [];
        const avgLt = lts.length > 0 ? lts.reduce((a, b) => a + b, 0) / lts.length : null;
        const minLt = lts.length > 0 ? Math.min(...lts) : null;
        const maxLt = lts.length > 0 ? Math.max(...lts) : null;

        const cap = capAgg.get(sid) || null;
        const util = cap && cap.capacity > 0 ? (cap.booked / cap.capacity) * 100 : null;
        const isExceeded = cap ? cap.exceededWeeks > 0 : false;
        const isHighUtil = cap ? cap.peakUtil >= 40 || (util !== null && util >= 40) : false;

        return {
          supplier_id: sid,
          supplier_name: meta ? meta.supplier_name : sid,
          reliability: meta ? toNumber(meta.reliability) : null,
          avgLt,
          minLt,
          maxLt,
          cap,
          util,
          isExceeded,
          isHighUtil,
        };
      })
      .filter((r) => {
        if (search) {
          const hay = `${r.supplier_id} ${r.supplier_name}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        if (constraintFilter === "EXCEEDED" && !r.isExceeded) return false;
        if (constraintFilter === "CONSTRAINED" && !r.isExceeded && !r.isHighUtil) return false;
        if (constraintFilter === "WITHIN" && r.isExceeded) return false;
        return true;
      });

    const exceededCount = supplierRows.filter((r) => r.isExceeded).length;
    const peakUtilAll = supplierRows.reduce(
      (mx, r) => (r.cap ? Math.max(mx, r.cap.peakUtil) : mx),
      0
    );
    $("sup-summary-strip").innerHTML = `
      <div class="summary-chip"><span>Suppliers Listed</span><strong>${fmtInt(supplierRows.length)}</strong></div>
      <div class="summary-chip"><span>Capacity Exceeded</span><strong>${fmtInt(exceededCount)}</strong></div>
      <div class="summary-chip"><span>Peak Weekly Utilisation</span><strong>${analysisRows.length ? fmtPct(peakUtilAll) : "Unavailable"}</strong></div>
    `;

    const chartHost = $("chart-supplier-capacity");
    const chartRows = supplierRows
      .filter((r) => r.cap && r.cap.capacity > 0)
      .slice(0, 20)
      .map((r) => ({
        label: r.supplier_id,
        value: r.cap.booked,
        maxRef: r.cap.capacity,
        color: r.isExceeded ? "#dc2626" : r.cap.peakUtil >= 50 ? "#d97706" : "#1e4070",
        rightText: `${fmtPct(r.util)} (pk ${fmtPct(r.cap.peakUtil)})`,
        detail: `Booked: ${fmtInt(r.cap.booked)} / Active Capacity: ${fmtInt(r.cap.capacity)} units (${r.cap.weeks} active wks)`,
      }));

    if (chartRows.length > 0) {
      renderHorizontalBarChart(chartHost, chartRows);
    } else {
      chartHost.innerHTML = `<div class="empty-state">Load <code>supplier_capacity_analysis.csv</code> or <code>capacity_check.csv</code> to view supplier capacity utilisation.</div>`;
    }

    $("sup-tbody").innerHTML =
      supplierRows.length === 0
        ? `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px;">No suppliers match your filter.</td></tr>`
        : supplierRows
            .map((r) => {
              const relBar =
                r.reliability !== null
                  ? `<div>${r.reliability}%</div><div class="progress-track"><div class="progress-fill ${r.reliability >= 85 ? "ok" : "warn"}" style="width:${Math.min(100, r.reliability)}%"></div></div>`
                  : '<span class="muted">Unavailable</span>';

              const ltText =
                r.avgLt !== null
                  ? `${r.avgLt.toFixed(1)} wks <div class="cell-sub">Range: ${r.minLt}–${r.maxLt} wks</div>`
                  : '<span class="muted">Unavailable</span>';

              const utilHtml =
                r.util !== null
                  ? `<div>${fmtPct(r.util)}</div>
                     <div class="progress-track"><div class="progress-fill ${r.isExceeded ? "danger" : r.cap.peakUtil >= 50 ? "warn" : ""}" style="width:${Math.min(100, r.util)}%"></div></div>
                     <div class="cell-sub">Peak wk: ${fmtPct(r.cap.peakUtil)}</div>`
                  : '<span class="muted">Unavailable</span>';

              const statusBadge = !r.cap
                ? `<span class="badge badge-neutral">No Booking Data</span>`
                : r.isExceeded
                ? `<span class="badge badge-fail">CAPACITY EXCEEDED</span>`
                : r.cap.peakUtil >= 50
                ? `<span class="badge badge-high">High Peak Load</span>`
                : `<span class="badge badge-pass">WITHIN CAPACITY</span>`;

              return `
                <tr>
                  <td class="cell-main">${escapeHtml(r.supplier_id)}</td>
                  <td>${escapeHtml(r.supplier_name)}</td>
                  <td class="num">${relBar}</td>
                  <td class="num">${ltText}</td>
                  <td class="num">${r.cap ? fmtInt(r.cap.booked) : "—"}</td>
                  <td class="num">${r.cap ? fmtInt(r.cap.capacity) : "—"}</td>
                  <td class="num">${utilHtml}</td>
                  <td>${statusBadge}</td>
                </tr>
              `;
            })
            .join("");

    const ltSup = $("lt-supplier-filter").value;
    const ltRows = getRows("lead_times")
      .filter((r) => ltSup === "ALL" || r.supplier_id === ltSup)
      .slice(0, 100);
    $("lt-tbody").innerHTML =
      ltRows.length === 0
        ? `<tr><td colspan="3" class="muted" style="text-align:center;">${hasLt ? "No matching lead times." : "lead_times.csv not loaded."}</td></tr>`
        : ltRows
            .map((r) => {
              const loc = lookups.locMap.get(r.location_id);
              return `
                <tr>
                  <td class="cell-main">${escapeHtml(r.supplier_id)}</td>
                  <td>${escapeHtml(r.location_id)}${loc ? ` (${escapeHtml(loc.location_name)})` : ""}</td>
                  <td class="num"><strong>${escapeHtml(r.lead_time_weeks)}</strong></td>
                </tr>
              `;
            })
            .join("");

    const capSup = $("cap-supplier-filter").value;
    const capRows = analysisRows
      .filter((r) => capSup === "ALL" || r.supplier_id === capSup)
      .slice(0, 100);
    $("cap-tbody").innerHTML =
      capRows.length === 0
        ? `<tr><td colspan="6" class="muted" style="text-align:center;">No weekly capacity booking records loaded.</td></tr>`
        : capRows
            .map((r) => {
              const b = toNumber(r.booked_units !== undefined ? r.booked_units : r.quantity, 0);
              const c = toNumber(r.capacity_units, 0);
              const ex = toNumber(r.excess_units, 0) || Math.max(0, b - c);
              const exceeded =
                ex > 0 ||
                toBool(r.capacity_exceeded) === true ||
                String(r.capacity_status || "").toUpperCase().includes("EXCEED");
              return `
                <tr>
                  <td class="cell-main">${escapeHtml(r.supplier_id)}</td>
                  <td class="num">${escapeHtml(r.week)}</td>
                  <td class="num">${fmtInt(b)}</td>
                  <td class="num">${fmtInt(c)}</td>
                  <td class="num">${fmtInt(ex)}</td>
                  <td><span class="badge ${exceeded ? "badge-fail" : "badge-pass"}">${exceeded ? "EXCEEDED" : "WITHIN"}</span></td>
                </tr>
              `;
            })
            .join("");
  }

  // ---------------- E. Mitigation Recommendations Rendering ----------------
  function evaluateMitigationPolicy(row, lookups) {
    const issues = [];
    const optLower = String(row.option || "").toLowerCase();
    const feasLower = String(row.feasibility_status || "").toLowerCase();
    const prodLower = String(row.production_feasibility || row.production_status || "").toLowerCase();

    if (feasLower.includes("not_approved") || feasLower.includes("unapproved") || optLower.includes("unapproved")) {
      issues.push("Substitute SKU not approved by policy");
    }
    if (feasLower.includes("exceed") || prodLower.includes("exceed") || prodLower.includes("unavailable")) {
      issues.push("Exceeds available capacity");
    }

    if (row.supplier_id && !["not applicable", "to be identified"].includes(row.supplier_id.toLowerCase())) {
      const capKey = `${row.supplier_id}|${row.week}`;
      const sca = lookups.supCapWeekMap.get(capKey);
      const cc = lookups.capCheckWeekMap.get(capKey);
      if (sca) {
        const excess = toNumber(sca.excess_units, 0) || 0;
        const booked = toNumber(sca.booked_units, 0) || 0;
        const cap = toNumber(sca.capacity_units, 0) || 0;
        const statusStr = String(sca.capacity_status || "").toUpperCase();
        if (excess > 0 || statusStr.includes("EXCEED")) {
          issues.push(`Supplier ${row.supplier_id} exceeded capacity in week ${row.week}`);
        } else if (cap > 0 && booked + (toNumber(row.shortage_units, 0) || 0) > cap && optLower.includes("expedite")) {
          issues.push(`Adding ${row.shortage_units} units would exceed supplier ${row.supplier_id} wk ${row.week} capacity (${booked}/${cap})`);
        }
      } else if (cc && toBool(cc.capacity_exceeded) === true) {
        issues.push(`Capacity check failed for ${row.supplier_id} in week ${row.week}`);
      }
    }

    if (row.planned_units !== undefined && row.planned_units !== "") {
      const planned = toNumber(row.planned_units, 0);
      if (planned <= 0 && optLower.includes("production")) {
        issues.push("Zero production capacity available for this week");
      }
    }

    const blocked = issues.length > 0;
    const isDirectlyActionable =
      !blocked &&
      (feasLower.includes("within capacity") ||
        prodLower.includes("capacity available") ||
        prodLower.includes("partially covered"));

    return { blocked, issues, isDirectlyActionable };
  }

  function getMergedMitigations() {
    const map = new Map();
    const sources = [
      getRows("mitigation_recommendations"),
      getRows("mitigation_feasibility"),
      getRows("updated_mitigation_feasibility"),
    ];

    let primarySource = null;
    if (hasDataset("updated_mitigation_feasibility")) primarySource = "updated_mitigation_feasibility.csv";
    else if (hasDataset("mitigation_feasibility")) primarySource = "mitigation_feasibility.csv";
    else if (hasDataset("mitigation_recommendations")) primarySource = "mitigation_recommendations.csv";

    for (const rows of sources) {
      for (const r of rows) {
        const k = `${r.shortage_id}|${r.option}`;
        const existing = map.get(k) || {};
        map.set(k, { ...existing, ...r });
      }
    }
    return { primarySource, rows: Array.from(map.values()) };
  }

  function renderMitigations(lookups) {
    const { primarySource, rows } = getMergedMitigations();
    if (!primarySource) {
      $("mit-unavailable").classList.remove("hidden");
      $("mit-content").classList.add("hidden");
      return;
    }

    $("mit-unavailable").classList.add("hidden");
    $("mit-content").classList.remove("hidden");

    const search = $("mit-search").value.trim().toLowerCase();
    const optFilter = $("mit-option-filter").value;
    const policyFilter = $("mit-policy-filter").value;

    const evaluated = rows.map((r) => {
      const gate = evaluateMitigationPolicy(r, lookups);
      const exp = lookups.expMap.get(`${r.sku_id}|${r.location_id}|${r.week}`);
      const sku = lookups.skuMap.get(r.sku_id);
      const loc = lookups.locMap.get(r.location_id);
      return { ...r, gate, exp, sku, loc };
    });

    const blockedTotal = evaluated.filter((r) => r.gate.blocked).length;

    const filtered = evaluated.filter((r) => {
      if (policyFilter === "COMPLIANT" && r.gate.blocked) return false;
      if (policyFilter === "ACTIONABLE" && !r.gate.isDirectlyActionable) return false;
      if (optFilter !== "ALL" && r.option !== optFilter) return false;
      if (search) {
        const hay = `${r.shortage_id} ${r.sku_id} ${r.location_id} ${r.option} ${r.reference_po} ${r.supplier_id} ${r.suggested_action}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    $("mit-summary-strip").innerHTML = `
      <div class="summary-chip"><span>Source File</span><strong>${escapeHtml(primarySource)}</strong></div>
      <div class="summary-chip"><span>Displayed Options</span><strong>${fmtInt(filtered.length)}</strong></div>
      <div class="summary-chip"><span>Policy-Blocked</span><strong>${fmtInt(blockedTotal)}</strong></div>
    `;

    const pageSize = state.pagination.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.pagination.mitPage = Math.min(state.pagination.mitPage, totalPages);
    const start = (state.pagination.mitPage - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    $("mit-tbody").innerHTML =
      pageRows.length === 0
        ? `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px;">No mitigation recommendations match your filters.</td></tr>`
        : pageRows
            .map((r) => {
              const shUnits = toNumber(r.shortage_units, 0) || 0;
              const planned = toNumber(r.planned_units);
              const remaining = toNumber(r.remaining_shortage);

              let serviceHtml = `<span class="muted">Load updated_mitigation_feasibility.csv</span>`;
              if (planned !== null) {
                const covPct = shUnits > 0 ? Math.min(100, (planned / shUnits) * 100) : 100;
                serviceHtml = `
                  <div class="cell-main">${covPct.toFixed(0)}% Covered (${fmtInt(planned)}/${fmtInt(shUnits)} u)</div>
                  <div class="cell-sub">${escapeHtml(r.production_feasibility || r.production_status || "")}${remaining > 0 ? ` &bull; Unmet: ${fmtInt(remaining)} u` : ""}</div>
                `;
              } else if (r.feasibility_status) {
                serviceHtml = `<div class="cell-sub">${escapeHtml(r.feasibility_status)}</div>`;
              }

              const explicitCost =
                r.estimated_cost !== undefined && r.estimated_cost !== ""
                  ? r.estimated_cost
                  : r.cost !== undefined && r.cost !== ""
                  ? r.cost
                  : null;
              let costHtml = `<span class="muted">Not in mitigation CSV</span>`;
              if (explicitCost !== null) {
                costHtml = `<strong>$${fmtInt(toNumber(explicitCost, 0))}</strong>`;
              } else if (r.sku && toNumber(r.sku.unit_cost) !== null) {
                const exposure = shUnits * toNumber(r.sku.unit_cost, 0);
                costHtml = `<div class="muted">Not in CSV</div><div class="cell-sub">Shortage value: $${fmtInt(exposure)}</div>`;
              }

              const gateBadge = r.gate.blocked
                ? `<span class="badge badge-fail">BLOCKED</span><div class="cell-sub">${escapeHtml(r.gate.issues.join("; "))}</div>`
                : r.feasibility_status && r.feasibility_status.includes("WITHIN CAPACITY")
                ? `<span class="badge badge-pass">Within Capacity</span>`
                : r.production_feasibility === "CAPACITY AVAILABLE"
                ? `<span class="badge badge-pass">Policy Compliant</span>`
                : `<span class="badge badge-info">Assessment Needed</span>`;

              const reasonText = r.exp ? r.exp.shortage_reason : null;

              return `
                <tr class="${r.gate.blocked ? "row-blocked" : ""}">
                  <td>
                    <div class="cell-main">${escapeHtml(r.shortage_id)}</div>
                    <div class="cell-sub">${escapeHtml(r.sku_id)} @ ${escapeHtml(r.location_id)} &bull; Wk ${escapeHtml(r.week)} (${fmtInt(shUnits)} u)</div>
                    ${reasonText ? `<div class="cell-sub">Cause: ${escapeHtml(reasonText)}</div>` : ""}
                  </td>
                  <td>
                    <div class="cell-main">${escapeHtml(r.option)}</div>
                    <div class="cell-sub">${escapeHtml(r.suggested_action)}</div>
                    ${r.feasibility_status ? `<div class="cell-sub">Status: ${escapeHtml(r.feasibility_status)}</div>` : ""}
                  </td>
                  <td>
                    <div class="cell-main">PO: ${escapeHtml(r.reference_po || "—")}</div>
                    <div class="cell-sub">Supplier: ${escapeHtml(r.supplier_id || "—")}</div>
                  </td>
                  <td>${serviceHtml}</td>
                  <td>${costHtml}</td>
                  <td>${gateBadge}</td>
                </tr>
              `;
            })
            .join("");

    renderPagination("mit-pagination", state.pagination.mitPage, totalPages, filtered.length, (next) => {
      state.pagination.mitPage = next;
      renderMitigations(buildLookups());
    });
  }

  // ---------------- F. Data & Validation Rendering ----------------
  function renderValidation() {
    const vrBody = $("val-report-body");
    const vrBadge = $("val-report-badge");
    if (hasDataset("final_validation_report")) {
      const rows = getRows("final_validation_report");
      const failed = rows.filter((r) => String(r.status).toUpperCase() !== "PASS").length;
      vrBadge.textContent = `${rows.length - failed}/${rows.length} PASS`;
      vrBadge.className = `badge ${failed === 0 ? "badge-pass" : "badge-fail"}`;
      vrBody.innerHTML = `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Validation Check</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              ${rows
                .map((r) => {
                  const pass = String(r.status).toUpperCase() === "PASS";
                  return `
                    <tr>
                      <td class="cell-main">${escapeHtml(r.check)}</td>
                      <td><span class="badge ${pass ? "badge-pass" : "badge-fail"}">${escapeHtml(r.status)}</span></td>
                      <td>${escapeHtml(r.details)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    } else {
      vrBadge.textContent = "Unavailable";
      vrBadge.className = "badge badge-neutral";
      vrBody.innerHTML = `<div class="empty-state">Load <code>final_validation_report.csv</code> to view final validation results.</div>`;
    }

    const ecBody = $("edge-case-body");
    const ecBadge = $("edge-case-badge");
    const ecRows = hasDataset("edge_case_detection_results")
      ? getRows("edge_case_detection_results")
      : getRows("edge_case_test_results");

    if (ecRows.length > 0) {
      const passed = ecRows.filter((r) => String(r.test_status).toUpperCase() === "PASS").length;
      ecBadge.textContent = `${passed}/${ecRows.length} PASS`;
      ecBadge.className = `badge ${passed === ecRows.length ? "badge-pass" : "badge-fail"}`;

      const descriptions = {
        "EDGE-001": "Prevents double-counting the same inbound purchase order in projected inventory.",
        "EDGE-002": "Blocks unapproved substitute SKUs from fulfilling demand or mitigation plans.",
        "EDGE-003": "Flags weekly supplier bookings that exceed allocated supplier capacity.",
        "EDGE-004": "Detects shortage calculations missing supplier replenishment lead times.",
        "EDGE-005": "Catches incompatible units of measure (e.g., EA vs CS) before planning aggregation.",
      };

      ecBody.innerHTML = `
        <div class="edge-grid">
          ${ecRows
            .map((r) => {
              const pass = String(r.test_status).toUpperCase() === "PASS";
              const observed = r.detected !== undefined ? r.detected : r.observed_detection;
              return `
                <div class="edge-card">
                  <div class="edge-card-top">
                    <span class="edge-id">${escapeHtml(r.case_id)}</span>
                    <span class="badge ${pass ? "badge-pass" : "badge-fail"}">${escapeHtml(r.test_status)}</span>
                  </div>
                  <h4>${escapeHtml(r.issue_type)}</h4>
                  <p class="edge-meta" style="margin:0 0 8px;">${escapeHtml(descriptions[r.case_id] || "")}</p>
                  <div class="edge-meta">
                    ${r.source_record_id ? `Record: <strong>${escapeHtml(r.source_record_id)}</strong><br/>` : ""}
                    ${r.test_value ? `Signal: <code>${escapeHtml(r.test_value)}</code><br/>` : ""}
                    Expected: <strong>${escapeHtml(r.expected_detection)}</strong> &bull; Detected: <strong>${escapeHtml(observed)}</strong>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    } else {
      ecBadge.textContent = "Unavailable";
      ecBadge.className = "badge badge-neutral";
      ecBody.innerHTML = `<div class="empty-state">Load <code>edge_case_detection_results.csv</code> or <code>edge_case_test_results.csv</code> to inspect the 5 required edge cases.</div>`;
    }

    const gtBody = $("gt-body");
    const gtBadge = $("gt-badge");
    if (hasDataset("ground_truth")) {
      const gtRows = getRows("ground_truth");
      gtBadge.textContent = `${gtRows.length} Isolated Labels`;
      gtBadge.className = "badge badge-info";
      gtBody.innerHTML = `
        <div class="alert-banner alert-info">
          <div>
            <strong>Evaluation Isolation Notice:</strong> These labels are loaded strictly from <code>ground_truth.csv</code>
            and are never merged into forecast demand, inventory, or operational shortage tables.
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Case ID</th><th>Issue Type</th><th>Source Record ID</th><th>Expected Detection</th></tr></thead>
            <tbody>
              ${gtRows
                .map(
                  (r) => `
                  <tr>
                    <td class="cell-main">${escapeHtml(r.case_id)}</td>
                    <td>${escapeHtml(r.issue_type)}</td>
                    <td><code>${escapeHtml(r.source_record_id)}</code></td>
                    <td><span class="badge badge-info">${escapeHtml(r.expected_detection)}</span></td>
                  </tr>
                `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    } else {
      gtBadge.textContent = "Unavailable";
      gtBadge.className = "badge badge-neutral";
      gtBody.innerHTML = `<div class="empty-state">Load <code>ground_truth.csv</code> to inspect isolated ground-truth test labels.</div>`;
    }

    const vsBody = $("val-summary-body");
    const vsBadge = $("val-summary-badge");
    if (hasDataset("validation_summary")) {
      const vsRows = getRows("validation_summary");
      const fails = vsRows.filter((r) => String(r.status).toUpperCase() !== "PASS").length;
      vsBadge.textContent = `${vsRows.length - fails}/${vsRows.length} PASS`;
      vsBadge.className = `badge ${fails === 0 ? "badge-pass" : "badge-warn"}`;
      vsBody.innerHTML = `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Table</th><th>Check</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              ${vsRows
                .map((r) => {
                  const pass = String(r.status).toUpperCase() === "PASS";
                  return `
                    <tr>
                      <td class="cell-main">${escapeHtml(r.table)}</td>
                      <td>${escapeHtml(r.check)}</td>
                      <td><span class="badge ${pass ? "badge-pass" : "badge-fail"}">${escapeHtml(r.status)}</span></td>
                      <td>${escapeHtml(r.details)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    } else {
      vsBadge.textContent = "Unavailable";
      vsBadge.className = "badge badge-neutral";
      vsBody.innerHTML = `<div class="empty-state">Load <code>validation_summary.csv</code> to view table-level data quality checks.</div>`;
    }
  }

  // ---------------- Shared Pagination Renderer ----------------
  function renderPagination(containerId, currentPage, totalPages, totalItems, onPageChange) {
    const el = $(containerId);
    if (totalItems === 0) {
      el.innerHTML = `<span>Showing 0 records</span>`;
      return;
    }
    const start = (currentPage - 1) * state.pagination.pageSize + 1;
    const end = Math.min(totalItems, currentPage * state.pagination.pageSize);

    el.innerHTML = `
      <span>Showing <strong>${fmtInt(start)}–${fmtInt(end)}</strong> of <strong>${fmtInt(totalItems)}</strong> records</span>
      <div class="pagination-controls">
        <button class="btn btn-sm btn-outline" type="button" data-dir="prev" ${currentPage <= 1 ? "disabled" : ""}>Previous</button>
        <span>Page ${currentPage} of ${totalPages}</span>
        <button class="btn btn-sm btn-outline" type="button" data-dir="next" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
      </div>
    `;

    const prevBtn = el.querySelector('[data-dir="prev"]');
    const nextBtn = el.querySelector('[data-dir="next"]');
    if (prevBtn) prevBtn.addEventListener("click", () => onPageChange(Math.max(1, currentPage - 1)));
    if (nextBtn) nextBtn.addEventListener("click", () => onPageChange(Math.min(totalPages, currentPage + 1)));
  }

  // ---------------- Import Modal Helpers ----------------
  function openImportModal() {
    updateImportModalChecklist();
    $("import-modal").classList.remove("hidden");
  }

  function closeImportModal() {
    $("import-modal").classList.add("hidden");
  }

  function updateImportModalChecklist() {
    const entries = Object.entries(DATASET_CATALOG);
    const loadedCount = Object.keys(state.datasets).length;
    const modeLabel =
      state.dataSourceMode === "full"
        ? "Full Project Data"
        : state.dataSourceMode === "sample"
        ? "Sample Data"
        : state.dataSourceMode === "custom"
        ? "Custom Upload"
        : "Empty";

    $("import-summary-text").textContent = `${loadedCount} of ${entries.length} datasets active (${modeLabel})`;

    $("modal-dataset-checklist").innerHTML = entries
      .map(([key, spec]) => {
        const loaded = hasDataset(key);
        const rows = loaded ? state.datasets[key].rows.length : 0;
        return `
          <div class="checklist-item ${loaded ? "loaded" : ""}">
            <span>${escapeHtml(spec.label)}</span>
            <strong>${loaded ? `${fmtInt(rows)} rows` : "Missing"}</strong>
          </div>
        `;
      })
      .join("");
  }

  // ---------------- Master Render ----------------
  function renderAll() {
    const lookups = buildLookups();
    renderStatusChrome(lookups);

    if (state.activePage === "dashboard") renderDashboard(lookups);
    else if (state.activePage === "demand-inventory") renderDemandInventory(lookups);
    else if (state.activePage === "shortages") renderShortages(lookups);
    else if (state.activePage === "suppliers") renderSuppliers(lookups);
    else if (state.activePage === "mitigations") renderMitigations(lookups);
    else if (state.activePage === "validation") renderValidation();
  }

  // ---------------- Event Wiring ----------------
  function initEventListeners() {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchPage(btn.dataset.page));
    });

    $("sidebar-open-btn").addEventListener("click", openMobileSidebar);
    $("sidebar-close-btn").addEventListener("click", closeMobileSidebar);
    $("sidebar-backdrop").addEventListener("click", closeMobileSidebar);

    // Upload Your Own CSVs modal triggers
    ["open-import-btn", "dash-manage-csv-btn", "banner-upload-btn", "empty-upload-btn"].forEach((id) => {
      $(id).addEventListener("click", openImportModal);
    });
    $("close-import-btn").addEventListener("click", closeImportModal);
    $("done-import-btn").addEventListener("click", closeImportModal);

    // Dismiss friendly sample banner
    $("dismiss-sample-banner-btn").addEventListener("click", () => {
      state.sampleBannerDismissed = true;
      $("sample-info-banner").classList.add("hidden");
    });

    // File / Folder inputs
    ["modal-folder-input", "modal-files-input"].forEach((id) => {
      $(id).addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleFileList(e.target.files);
          e.target.value = "";
        }
      });
    });

    // Drag and Drop in modal
    const dropZone = $("drop-zone");
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files) {
        handleFileList(e.dataTransfer.files);
      }
    });

    // Reset to Sample Data & Clear All
    ["reset-data-btn", "banner-reset-sample-btn", "empty-reset-btn", "modal-reset-sample-btn"].forEach((id) => {
      $(id).addEventListener("click", resetToSampleData);
    });
    $("modal-clear-all-btn").addEventListener("click", clearAllData);

    // Dashboard chart toggles
    $("chart-dvi-loc-btn").addEventListener("click", () => {
      state.charts.dviMode = "location";
      $("chart-dvi-loc-btn").className = "btn btn-sm btn-active";
      $("chart-dvi-cat-btn").className = "btn btn-sm btn-outline";
      renderDashboard(buildLookups());
    });
    $("chart-dvi-cat-btn").addEventListener("click", () => {
      state.charts.dviMode = "category";
      $("chart-dvi-cat-btn").className = "btn btn-sm btn-active";
      $("chart-dvi-loc-btn").className = "btn btn-sm btn-outline";
      renderDashboard(buildLookups());
    });
    $("chart-sh-count-btn").addEventListener("click", () => {
      state.charts.shortageMode = "priority";
      $("chart-sh-count-btn").className = "btn btn-sm btn-active";
      $("chart-sh-loc-btn").className = "btn btn-sm btn-outline";
      renderDashboard(buildLookups());
    });
    $("chart-sh-loc-btn").addEventListener("click", () => {
      state.charts.shortageMode = "location";
      $("chart-sh-loc-btn").className = "btn btn-sm btn-active";
      $("chart-sh-count-btn").className = "btn btn-sm btn-outline";
      renderDashboard(buildLookups());
    });

    // Demand & Inventory filters
    ["di-search", "di-sku-filter", "di-location-filter", "di-view-mode"].forEach((id) => {
      $(id).addEventListener("input", () => {
        state.pagination.diPage = 1;
        renderDemandInventory(buildLookups());
      });
    });

    // Shortage Analysis filters
    ["sh-search", "sh-priority-filter", "sh-location-filter"].forEach((id) => {
      $(id).addEventListener("input", () => {
        state.pagination.shPage = 1;
        renderShortages(buildLookups());
      });
    });

    // Supplier Management filters
    ["sup-search", "sup-constraint-filter", "lt-supplier-filter", "cap-supplier-filter"].forEach((id) => {
      $(id).addEventListener("input", () => renderSuppliers(buildLookups()));
    });

    // Mitigation filters
    ["mit-search", "mit-option-filter", "mit-policy-filter"].forEach((id) => {
      $(id).addEventListener("input", () => {
        state.pagination.mitPage = 1;
        renderMitigations(buildLookups());
      });
    });

    window.addEventListener("resize", () => {
      if (state.activePage === "dashboard" || state.activePage === "suppliers") {
        renderAll();
      }
    });
  }

  // ---------------- Boot ----------------
  document.addEventListener("DOMContentLoaded", () => {
    initEventListeners();
    loadBundledSampleCSVs();
    populateFilterDropdowns();
    renderAll();
    updateImportModalChecklist();
    tryRefreshSampleFromHttp();
  });
})();
