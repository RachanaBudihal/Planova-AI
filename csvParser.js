/* ==========================================================================
   csvParser.js — Dependency-Free CSV Parser & Planova Dataset Registry
   ==========================================================================
   This module reads CSV text in the browser, validates headers and rows,
   and maps uploaded filenames to Planova's known dataset keys.
   ========================================================================== */

(function (global) {
  "use strict";

  /**
   * Catalog of datasets supported by Planova.
   * Each entry lists accepted filenames (including README singular/plural aliases)
   * and the minimum required columns needed to treat a CSV file as valid.
   */
  const DATASET_CATALOG = {
    sku: {
      label: "sku.csv",
      filenames: ["sku.csv", "skus.csv"],
      requiredCols: ["sku_id"],
      group: "Master Data",
    },
    location: {
      label: "location.csv",
      filenames: ["location.csv", "locations.csv"],
      requiredCols: ["location_id"],
      group: "Master Data",
    },
    supplier: {
      label: "supplier.csv",
      filenames: ["supplier.csv", "suppliers.csv"],
      requiredCols: ["supplier_id"],
      group: "Master Data",
    },
    forecast_demand: {
      label: "forecast_demand.csv",
      filenames: ["forecast_demand.csv", "demand.csv"],
      requiredCols: ["sku_id", "location_id", "demand_units"],
      group: "Planning Inputs",
    },
    inventory: {
      label: "inventory.csv",
      filenames: ["inventory.csv"],
      requiredCols: ["sku_id", "location_id", "stock"],
      group: "Planning Inputs",
    },
    lead_times: {
      label: "lead_times.csv",
      filenames: ["lead_times.csv"],
      requiredCols: ["supplier_id", "location_id", "lead_time_weeks"],
      group: "Supply & Capacity",
    },
    purchase_orders: {
      label: "purchase_orders.csv",
      filenames: ["purchase_orders.csv"],
      requiredCols: ["po_id", "sku_id", "supplier_id", "quantity"],
      group: "Supply & Capacity",
    },
    supplier_capacity: {
      label: "supplier_capacity.csv",
      filenames: ["supplier_capacity.csv"],
      requiredCols: ["supplier_id", "week", "capacity_units"],
      group: "Supply & Capacity",
    },
    supplier_capacity_analysis: {
      label: "supplier_capacity_analysis.csv",
      filenames: ["supplier_capacity_analysis.csv"],
      requiredCols: ["supplier_id", "week", "booked_units", "capacity_units"],
      group: "Supply & Capacity",
    },
    capacity_check: {
      label: "capacity_check.csv",
      filenames: ["capacity_check.csv"],
      requiredCols: ["supplier_id", "week", "capacity_units"],
      group: "Supply & Capacity",
    },
    shortages: {
      label: "shortages.csv",
      filenames: ["shortages.csv"],
      requiredCols: ["sku_id", "location_id", "shortage_units"],
      group: "Shortages",
    },
    shortage_explanations: {
      label: "shortage_explanations.csv",
      filenames: ["shortage_explanations.csv"],
      requiredCols: ["sku_id", "location_id", "shortage_units", "shortage_reason"],
      group: "Shortages",
    },
    integrated_shortages: {
      label: "integrated_shortages.csv",
      filenames: ["integrated_shortages.csv"],
      requiredCols: ["sku_id", "location_id", "shortage_units"],
      group: "Shortages",
    },
    mitigation_recommendations: {
      label: "mitigation_recommendations.csv",
      filenames: ["mitigation_recommendations.csv"],
      requiredCols: ["shortage_id", "sku_id", "option", "suggested_action"],
      group: "Mitigation",
    },
    mitigation_feasibility: {
      label: "mitigation_feasibility.csv",
      filenames: ["mitigation_feasibility.csv"],
      requiredCols: ["shortage_id", "sku_id", "option", "feasibility_status"],
      group: "Mitigation",
    },
    updated_mitigation_feasibility: {
      label: "updated_mitigation_feasibility.csv",
      filenames: ["updated_mitigation_feasibility.csv"],
      requiredCols: ["shortage_id", "sku_id", "option", "production_feasibility"],
      group: "Mitigation",
    },
    production_capacity: {
      label: "production_capacity.csv",
      filenames: ["production_capacity.csv"],
      requiredCols: ["location_id", "week", "production_capacity_units"],
      group: "Mitigation",
    },
    production_plan: {
      label: "production_plan.csv",
      filenames: ["production_plan.csv"],
      requiredCols: ["shortage_id", "sku_id", "location_id", "planned_units"],
      group: "Mitigation",
    },
    final_validation_report: {
      label: "final_validation_report.csv",
      filenames: ["final_validation_report.csv"],
      requiredCols: ["check", "status", "details"],
      group: "Validation & Ground Truth",
    },
    validation_summary: {
      label: "validation_summary.csv",
      filenames: ["validation_summary.csv"],
      requiredCols: ["table", "check", "status"],
      group: "Validation & Ground Truth",
    },
    edge_case_detection_results: {
      label: "edge_case_detection_results.csv",
      filenames: ["edge_case_detection_results.csv"],
      requiredCols: ["case_id", "issue_type", "test_status"],
      group: "Validation & Ground Truth",
    },
    edge_case_test_results: {
      label: "edge_case_test_results.csv",
      filenames: ["edge_case_test_results.csv"],
      requiredCols: ["case_id", "issue_type", "test_status"],
      group: "Validation & Ground Truth",
    },
    ground_truth: {
      label: "ground_truth.csv",
      filenames: ["ground_truth.csv"],
      requiredCols: ["case_id", "issue_type", "expected_detection"],
      group: "Validation & Ground Truth",
    },
    integrated_planning: {
      label: "integrated_planning.csv",
      filenames: ["integrated_planning.csv"],
      requiredCols: ["sku_id", "location_id", "week", "opening_balance"],
      group: "Optional Planning Detail",
    },
  };

  /**
   * Matches an uploaded filename (e.g. "sku.csv" or "Planova/data/sku.csv")
   * to a key in DATASET_CATALOG. Returns null if unrecognised.
   */
  function identifyDatasetKey(fileName) {
    const cleanName = String(fileName || "")
      .split(/[\\/]/)
      .pop()
      .trim()
      .toLowerCase();

    for (const [key, spec] of Object.entries(DATASET_CATALOG)) {
      if (spec.filenames.includes(cleanName)) {
        return key;
      }
    }
    return null;
  }

  /**
   * Parses raw CSV text into { headers: string[], rows: Object[] }.
   * Handles UTF-8 BOM, quoted fields, escaped double-quotes (""), and CRLF/LF.
   * Throws a descriptive Error if the CSV is invalid or empty.
   */
  function parseCSVText(rawText, fileName = "file.csv") {
    if (typeof rawText !== "string") {
      throw new Error(`${fileName}: File could not be read as text.`);
    }

    // Strip UTF-8 BOM if present
    let text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;

    // Quick guard against binary files (e.g. .db or .xlsx renamed to .csv)
    if (text.includes("\u0000")) {
      throw new Error(`${fileName}: File appears to be binary rather than a valid UTF-8 CSV.`);
    }

    text = text.trim();
    if (!text) {
      throw new Error(`${fileName}: CSV file is empty.`);
    }

    const matrix = [];
    let currentRow = [];
    let currentField = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          currentField += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          currentField += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (ch === "\r" && next === "\n") {
        currentRow.push(currentField.trim());
        matrix.push(currentRow);
        currentRow = [];
        currentField = "";
        i += 1;
      } else if (ch === "\n" || ch === "\r") {
        currentRow.push(currentField.trim());
        matrix.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += ch;
      }
    }

    // Push final field/row
    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      matrix.push(currentRow);
    }

    if (inQuotes) {
      throw new Error(`${fileName}: Unclosed quotation mark detected while parsing CSV.`);
    }

    if (matrix.length === 0 || matrix[0].length === 0) {
      throw new Error(`${fileName}: Missing header row.`);
    }

    const headers = matrix[0].map((h) => h.trim());
    if (headers.some((h) => h === "")) {
      throw new Error(`${fileName}: CSV header row contains an empty column name.`);
    }

    const rows = [];
    for (let r = 1; r < matrix.length; r += 1) {
      const line = matrix[r];
      // Skip completely blank lines
      if (line.length === 1 && line[0] === "") continue;

      const obj = {};
      for (let c = 0; c < headers.length; c += 1) {
        obj[headers[c]] = line[c] !== undefined ? line[c] : "";
      }
      rows.push(obj);
    }

    return { headers, rows };
  }

  /**
   * Validates that a parsed CSV contains the expected columns for a Planova dataset.
   */
  function validateDatasetSchema(datasetKey, headers, fileName) {
    const spec = DATASET_CATALOG[datasetKey];
    if (!spec) {
      throw new Error(`${fileName}: Unrecognised Planova dataset filename.`);
    }

    const lowerHeaders = new Set(headers.map((h) => h.toLowerCase()));
    const missing = spec.requiredCols.filter((col) => !lowerHeaders.has(col.toLowerCase()));

    if (missing.length > 0) {
      throw new Error(
        `${fileName}: Missing required column(s) [${missing.join(", ")}]. Found headers: [${headers.join(", ")}].`
      );
    }
  }

  /**
   * Safely parses a numeric CSV value; returns fallback (null by default) if blank or NaN.
   */
  function toNumber(val, fallback = null) {
    if (val === undefined || val === null || String(val).trim() === "") return fallback;
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Safely parses a boolean CSV value ("True", "true", "1", "yes").
   */
  function toBool(val) {
    if (typeof val === "boolean") return val;
    const s = String(val || "").trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return null;
  }

  global.PlanovaCSV = {
    DATASET_CATALOG,
    identifyDatasetKey,
    parseCSVText,
    validateDatasetSchema,
    toNumber,
    toBool,
  };
})(window);
