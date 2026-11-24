/* ==========================================================================
   charts.js — Lightweight Dependency-Free Interactive SVG Charts
   ==========================================================================
   Draws clean, responsive SVG bar and donut charts with hover tooltips.
   Works 100% offline with zero third-party libraries.
   ========================================================================== */

(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  let tooltipEl = null;

  function ensureTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "chart-tooltip hidden";
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function showTooltip(evt, html) {
    const tip = ensureTooltip();
    tip.innerHTML = html;
    tip.classList.remove("hidden");
    const pad = 12;
    const left = Math.min(window.innerWidth - tip.offsetWidth - pad, evt.clientX + pad);
    const top = Math.max(pad, evt.clientY - tip.offsetHeight - pad);
    tip.style.left = `${Math.max(pad, left)}px`;
    tip.style.top = `${top}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.add("hidden");
  }

  function createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
    return el;
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  /**
   * Renders a grouped vertical bar chart (e.g., Forecast Demand vs On-Hand Stock).
   * @param {HTMLElement} container
   * @param {Array<{label:string, fullLabel?:string, demand:number, stock:number}>} items
   */
  function renderGroupedBarChart(container, items) {
    container.innerHTML = "";
    if (!items || items.length === 0) {
      container.innerHTML = `<div class="empty-state">No data available to plot.</div>`;
      return;
    }

    const width = Math.max(container.clientWidth || 520, 460);
    const height = 290;
    const margin = { top: 28, right: 20, bottom: 52, left: 62 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const maxVal = Math.max(
      1,
      ...items.map((d) => Math.max(d.demand || 0, d.stock || 0))
    );
    const yMax = Math.ceil((maxVal * 1.12) / 100) * 100 || maxVal;

    const svg = createSvgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height: height,
      role: "img",
      "aria-label": "Demand versus Inventory grouped bar chart",
    });

    // Legend at top right
    const legendItems = [
      { name: "Forecast Demand", color: "#0b1f3a" },
      { name: "Available Stock", color: "#3b82f6" },
    ];
    legendItems.forEach((lg, idx) => {
      const gx = width - margin.right - (legendItems.length - idx) * 135;
      svg.appendChild(createSvgElement("rect", { x: gx, y: 6, width: 12, height: 12, rx: 3, fill: lg.color }));
      const txt = createSvgElement("text", { x: gx + 17, y: 16, fill: "#334155", "font-size": 11, "font-weight": 600 });
      txt.textContent = lg.name;
      svg.appendChild(txt);
    });

    // Horizontal gridlines & Y-axis labels
    const ticks = 4;
    for (let t = 0; t <= ticks; t += 1) {
      const val = (yMax / ticks) * t;
      const y = margin.top + plotH - (val / yMax) * plotH;
      svg.appendChild(
        createSvgElement("line", {
          x1: margin.left,
          y1: y,
          x2: width - margin.right,
          y2: y,
          stroke: t === 0 ? "#94a3b8" : "#e2e8f0",
          "stroke-width": 1,
        })
      );
      const label = createSvgElement("text", {
        x: margin.left - 8,
        y: y + 4,
        "text-anchor": "end",
        fill: "#64748b",
        "font-size": 11,
      });
      label.textContent = formatNumber(val);
      svg.appendChild(label);
    }

    // Bars
    const groupW = plotW / items.length;
    const barW = Math.min(24, Math.max(8, (groupW - 14) / 2));

    items.forEach((d, idx) => {
      const centerX = margin.left + idx * groupW + groupW / 2;
      const demH = ((d.demand || 0) / yMax) * plotH;
      const stkH = ((d.stock || 0) / yMax) * plotH;

      const demRect = createSvgElement("rect", {
        x: centerX - barW - 2,
        y: margin.top + plotH - demH,
        width: barW,
        height: Math.max(0, demH),
        rx: 3,
        fill: "#0b1f3a",
        style: "cursor:pointer",
      });

      const stkRect = createSvgElement("rect", {
        x: centerX + 2,
        y: margin.top + plotH - stkH,
        width: barW,
        height: Math.max(0, stkH),
        rx: 3,
        fill: "#3b82f6",
        style: "cursor:pointer",
      });

      const tipHtml = `<strong>${d.fullLabel || d.label}</strong><br/>Demand: ${formatNumber(d.demand)} units<br/>Inventory: ${formatNumber(d.stock)} units`;
      [demRect, stkRect].forEach((rect) => {
        rect.addEventListener("mousemove", (e) => showTooltip(e, tipHtml));
        rect.addEventListener("mouseleave", hideTooltip);
      });

      svg.appendChild(demRect);
      svg.appendChild(stkRect);

      const xLbl = createSvgElement("text", {
        x: centerX,
        y: margin.top + plotH + 18,
        "text-anchor": "middle",
        fill: "#334155",
        "font-size": 11,
        "font-weight": 600,
      });
      xLbl.textContent = d.label;
      svg.appendChild(xLbl);
    });

    container.appendChild(svg);
  }

  /**
   * Renders a donut chart with right-hand breakdown legend (used for Shortage Priority Distribution).
   * @param {HTMLElement} container
   * @param {Array<{label:string, count:number, units:number, color:string}>} slices
   */
  function renderDonutChart(container, slices) {
    container.innerHTML = "";
    const total = slices.reduce((acc, s) => acc + s.count, 0);
    if (!slices || total === 0) {
      container.innerHTML = `<div class="empty-state">No shortage records to plot.</div>`;
      return;
    }

    const width = Math.max(container.clientWidth || 460, 400);
    const height = 280;
    const cx = 125;
    const cy = 140;
    const r = 82;
    const strokeW = 30;
    const circumference = 2 * Math.PI * r;

    const svg = createSvgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height: height,
      role: "img",
      "aria-label": "Shortage severity distribution chart",
    });

    let offset = 0;
    slices.forEach((s) => {
      if (s.count <= 0) return;
      const pct = s.count / total;
      const dashLen = pct * circumference;

      const circle = createSvgElement("circle", {
        cx,
        cy,
        r,
        fill: "transparent",
        stroke: s.color,
        "stroke-width": strokeW,
        "stroke-dasharray": `${dashLen} ${circumference}`,
        "stroke-dashoffset": -offset,
        transform: `rotate(-90 ${cx} ${cy})`,
        style: "cursor:pointer",
      });

      const tipHtml = `<strong>${s.label}</strong><br/>Shortages: ${formatNumber(s.count)} (${(pct * 100).toFixed(1)}%)<br/>Shortage Units: ${formatNumber(s.units)}`;
      circle.addEventListener("mousemove", (e) => showTooltip(e, tipHtml));
      circle.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(circle);

      offset += dashLen;
    });

    // Center total label
    const centerNum = createSvgElement("text", {
      x: cx,
      y: cy - 4,
      "text-anchor": "middle",
      fill: "#0b1f3a",
      "font-size": 24,
      "font-weight": 700,
    });
    centerNum.textContent = formatNumber(total);
    svg.appendChild(centerNum);

    const centerSub = createSvgElement("text", {
      x: cx,
      y: cy + 16,
      "text-anchor": "middle",
      fill: "#64748b",
      "font-size": 11,
      "font-weight": 600,
    });
    centerSub.textContent = "Shortages";
    svg.appendChild(centerSub);

    // Legend on right side
    const lx = 245;
    slices.forEach((s, i) => {
      const ly = 72 + i * 54;
      const pct = total > 0 ? ((s.count / total) * 100).toFixed(1) : "0.0";
      svg.appendChild(createSvgElement("rect", { x: lx, y: ly, width: 12, height: 12, rx: 3, fill: s.color }));

      const title = createSvgElement("text", {
        x: lx + 20,
        y: ly + 11,
        fill: "#0f172a",
        "font-size": 13,
        "font-weight": 700,
      });
      title.textContent = `${s.label} — ${formatNumber(s.count)} (${pct}%)`;
      svg.appendChild(title);

      const sub = createSvgElement("text", {
        x: lx + 20,
        y: ly + 28,
        fill: "#64748b",
        "font-size": 11,
      });
      sub.textContent = `${formatNumber(s.units)} shortage units`;
      svg.appendChild(sub);
    });

    container.appendChild(svg);
  }

  /**
   * Renders a horizontal bar chart (used for Top Shortage Locations or Supplier Utilisation).
   * @param {HTMLElement} container
   * @param {Array<{label:string, value:number, maxRef?:number, color?:string, detail?:string}>} rows
   * @param {string} unitLabel
   */
  function renderHorizontalBarChart(container, rows, unitLabel = "units") {
    container.innerHTML = "";
    if (!rows || rows.length === 0) {
      container.innerHTML = `<div class="empty-state">No data available to plot.</div>`;
      return;
    }

    const rowHeight = 32;
    const width = Math.max(container.clientWidth || 500, 420);
    const margin = { top: 14, right: 88, bottom: 18, left: 130 };
    const height = Math.max(240, rows.length * rowHeight + margin.top + margin.bottom);
    const plotW = width - margin.left - margin.right;

    const maxVal = Math.max(
      1,
      ...rows.map((r) => Math.max(r.value || 0, r.maxRef || 0))
    );

    const svg = createSvgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height: height,
      role: "img",
    });

    rows.forEach((r, idx) => {
      const y = margin.top + idx * rowHeight;

      // Label
      const lbl = createSvgElement("text", {
        x: margin.left - 10,
        y: y + 15,
        "text-anchor": "end",
        fill: "#0f172a",
        "font-size": 12,
        "font-weight": 600,
      });
      lbl.textContent = r.label;
      svg.appendChild(lbl);

      // Background capacity track if maxRef is given
      if (r.maxRef && r.maxRef > 0) {
        const refW = (r.maxRef / maxVal) * plotW;
        svg.appendChild(
          createSvgElement("rect", {
            x: margin.left,
            y: y + 4,
            width: Math.max(2, refW),
            height: 16,
            rx: 4,
            fill: "#dbeafe",
          })
        );
      }

      // Value bar
      const valW = ((r.value || 0) / maxVal) * plotW;
      const bar = createSvgElement("rect", {
        x: margin.left,
        y: y + 4,
        width: Math.max(2, valW),
        height: 16,
        rx: 4,
        fill: r.color || "#1e4070",
        style: "cursor:pointer",
      });

      const tipHtml = `<strong>${r.label}</strong><br/>${r.detail || `${formatNumber(r.value)} ${unitLabel}`}`;
      bar.addEventListener("mousemove", (e) => showTooltip(e, tipHtml));
      bar.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(bar);

      // Right value label
      const valTxt = createSvgElement("text", {
        x: width - margin.right + 8,
        y: y + 16,
        fill: "#334155",
        "font-size": 11,
        "font-weight": 600,
      });
      valTxt.textContent = r.rightText || formatNumber(r.value);
      svg.appendChild(valTxt);
    });

    container.appendChild(svg);
  }

  global.PlanovaCharts = {
    renderGroupedBarChart,
    renderDonutChart,
    renderHorizontalBarChart,
  };
})(window);
