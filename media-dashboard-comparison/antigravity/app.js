/**
 * Antigravity Media Exposure Dashboard Application
 */

const DATA_PATHS = {
  mentions: "./data/generated/mentions.json",
  dailyCounts: "./data/generated/daily_counts.json",
  sourceSummary: "./data/generated/source_summary.json",
  topicSummary: "./data/generated/topic_summary.json",
  alerts: "./data/generated/alerts.json",
  metadata: "./data/generated/metadata.json"
};

// Global Application State
let appState = {
  data: {
    mentions: [],
    dailyCounts: [],
    sourceSummary: [],
    topicSummary: [],
    alerts: [],
    metadata: null
  },
  filters: {
    company: "Both",
    dateRange: "90d",
    channel: "All",
    topic: "All",
    sentiment: "All",
    sourceTier: "All",
    search: ""
  },
  explorer: {
    currentPage: 1,
    pageSize: 15,
    sortField: "date",
    sortAscending: false
  },
  activeTab: "overview"
};

// Colors matching stylesheet
const CHART_COLORS = {
  novo: "#00d2c4",
  novoLight: "rgba(0, 210, 196, 0.15)",
  lilly: "#b624ff",
  lillyLight: "rgba(182, 36, 255, 0.15)",
  positive: "#10b981",
  neutral: "#cbd5e1",
  negative: "#ef4444",
  grid: "rgba(255, 255, 255, 0.05)",
  text: "#94a3b8"
};

// Initialize Application on DOM Content Loaded
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initFilters();
  loadData();
});

// Tab Navigation Controls
function initTabs() {
  const tabsContainer = document.getElementById("tabs-container");
  if (!tabsContainer) return;

  tabsContainer.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;

    const tabName = btn.dataset.tab;
    switchTab(tabName);
  });
}

function switchTab(tabName) {
  appState.activeTab = tabName;
  
  // Update Buttons
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  // Update Panels
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });

  // Render visualizations specific to active tab
  renderActiveTabVisuals();
}

// Global Filter Setup
function initFilters() {
  const filters = [
    { id: "filter-company", key: "company" },
    { id: "filter-date", key: "dateRange" },
    { id: "filter-channel", key: "channel" },
    { id: "filter-topic", key: "topic" },
    { id: "filter-sentiment", key: "sentiment" },
    { id: "filter-tier", key: "sourceTier" }
  ];

  filters.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) {
      el.addEventListener("change", (e) => {
        appState.filters[f.key] = e.target.value;
        appState.explorer.currentPage = 1; // Reset pagination
        onFiltersChanged();
      });
    }
  });

  const searchBox = document.getElementById("search-box");
  const clearBtn = document.getElementById("search-clear-btn");
  if (searchBox) {
    searchBox.addEventListener("input", (e) => {
      appState.filters.search = e.target.value.trim().toLowerCase();
      appState.explorer.currentPage = 1;
      
      if (clearBtn) {
        clearBtn.style.display = e.target.value ? "block" : "none";
      }
      onFiltersChanged();
    });
  }

  if (clearBtn && searchBox) {
    clearBtn.addEventListener("click", () => {
      searchBox.value = "";
      appState.filters.search = "";
      clearBtn.style.display = "none";
      appState.explorer.currentPage = 1;
      onFiltersChanged();
    });
  }

  // Details drawer close logic
  const closeDrawerBtn = document.getElementById("close-drawer-btn");
  const drawerOverlay = document.getElementById("drawer-overlay");
  
  if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener("click", closeDrawer);

  // CSV Export
  const exportBtn = document.getElementById("explorer-export-csv");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportFilteredCSV);
  }
}

// Data Fetching Orchestrator
async function loadData() {
  updateStatus("loading", "Fetching metrics...");
  
  try {
    const results = await Promise.allSettled([
      fetchJSON(DATA_PATHS.metadata),
      fetchJSON(DATA_PATHS.mentions),
      fetchJSON(DATA_PATHS.dailyCounts),
      fetchJSON(DATA_PATHS.sourceSummary),
      fetchJSON(DATA_PATHS.topicSummary),
      fetchJSON(DATA_PATHS.alerts)
    ]);

    const isMetaOk = results[0].status === "fulfilled";
    const isMentionsOk = results[1].status === "fulfilled";

    // Strict validation: fail if metadata or mentions are missing
    if (!isMetaOk || !isMentionsOk) {
      const errMsg = "Generated data files were not found on the deployed site. Check the GitHub Actions data pipeline and Pages artifact.";
      showErrorState(errMsg);
      updateStatus("error", "Data load failed");
      return;
    }

    appState.data.metadata = results[0].value;
    appState.data.mentions = results[1].value;
    appState.data.dailyCounts = results[2].status === "fulfilled" ? results[2].value : [];
    appState.data.sourceSummary = results[3].status === "fulfilled" ? results[3].value : [];
    appState.data.topicSummary = results[4].status === "fulfilled" ? results[4].value : [];
    appState.data.alerts = results[5].status === "fulfilled" ? results[5].value : [];

    hideErrorState();
    
    // Update badge alert count
    const alertsBadge = document.getElementById("alerts-count-badge");
    if (alertsBadge && appState.data.alerts.length > 0) {
      alertsBadge.textContent = appState.data.alerts.length;
      alertsBadge.style.display = "inline-block";
    }

    updateStatus("success", `Updated: ${formatDateTime(appState.data.metadata.lastUpdated)}`);
    onFiltersChanged();

  } catch (err) {
    showErrorState(err.message || "An unexpected error occurred during initialization.");
    updateStatus("error", "Data load failed");
  }
}

async function fetchJSON(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP error fetching ${path}: ${response.statusText}`);
  }
  return await response.json();
}

function updateStatus(status, text) {
  const container = document.getElementById("header-status");
  if (!container) return;

  container.innerHTML = `
    <span class="status-indicator status-${status}"></span>
    <span class="status-text">${text}</span>
  `;
}

function formatDateTime(isoString) {
  if (!isoString) return "N/A";
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch (e) {
    return isoString;
  }
}

// Error State Handling
function showErrorState(message) {
  const errorContainer = document.getElementById("error-state");
  const msgEl = document.getElementById("error-message");
  
  if (errorContainer && msgEl) {
    msgEl.textContent = message;
    errorContainer.style.display = "flex";
  }
  
  // Hide active dashboard elements
  document.querySelectorAll(".tab-panel, .tabs-nav, .filters-bar").forEach(el => {
    if (el.id !== "error-state") el.style.opacity = "0.15";
  });
}

function hideErrorState() {
  const errorContainer = document.getElementById("error-state");
  if (errorContainer) {
    errorContainer.style.display = "none";
  }
  
  document.querySelectorAll(".tab-panel, .tabs-nav, .filters-bar").forEach(el => {
    el.style.opacity = "1";
  });
}

// Filter Computations
function getFilteredMentions() {
  let list = appState.data.mentions || [];

  // 1. Company Filter
  if (appState.filters.company !== "Both") {
    list = list.filter(m => m.company === appState.filters.company);
  }

  // 2. Date Filter
  if (appState.data.metadata) {
    const latestDateStr = appState.data.metadata.coverageEnd;
    const latestDate = new Date(latestDateStr);
    let cutoffDays = 90;
    if (appState.filters.dateRange === "30d") cutoffDays = 30;
    if (appState.filters.dateRange === "7d") cutoffDays = 7;
    
    const cutoffDate = new Date(latestDate);
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);
    
    list = list.filter(m => m.date >= cutoffStr);
  }

  // 3. Channel Filter
  if (appState.filters.channel !== "All") {
    list = list.filter(m => m.channel === appState.filters.channel);
  }

  // 4. Topic Filter
  if (appState.filters.topic !== "All") {
    list = list.filter(m => m.topic === appState.filters.topic);
  }

  // 5. Sentiment Filter
  if (appState.filters.sentiment !== "All") {
    list = list.filter(m => m.sentiment === appState.filters.sentiment);
  }

  // 6. Source Tier Filter
  if (appState.filters.sourceTier !== "All") {
    list = list.filter(m => m.sourceTier === appState.filters.sourceTier);
  }

  // 7. Search Input Filter
  if (appState.filters.search) {
    const q = appState.filters.search;
    list = list.filter(m => 
      (m.title && m.title.toLowerCase().includes(q)) ||
      (m.source && m.source.toLowerCase().includes(q)) ||
      (m.snippet && m.snippet.toLowerCase().includes(q)) ||
      (m.topic && m.topic.toLowerCase().includes(q))
    );
  }

  return list;
}

// Recalculate KPIs and Render active views
function onFiltersChanged() {
  const filtered = getFilteredMentions();
  
  // Calculate and update KPIs
  updateKPIs(filtered);
  
  // Render tab visuals
  renderActiveTabVisuals();
}

function updateKPIs(filteredList) {
  const novoMentions = filteredList.filter(m => m.company === "Novo Nordisk").length;
  const lillyMentions = filteredList.filter(m => m.company === "Eli Lilly").length;
  const total = novoMentions + lillyMentions;

  // 1. Volumes
  document.getElementById("kpi-novo-mentions").textContent = novoMentions.toLocaleString();
  document.getElementById("kpi-lilly-mentions").textContent = lillyMentions.toLocaleString();

  // 2. SOVs
  const novoSov = total ? (novoMentions / total) : 0;
  const lillySov = total ? (lillyMentions / total) : 0;
  document.getElementById("kpi-novo-sov").textContent = `${(novoSov * 100).toFixed(1)}% SOV`;
  document.getElementById("kpi-lilly-sov").textContent = `${(lillySov * 100).toFixed(1)}% SOV`;

  // 3. SOV Winner
  const winnerEl = document.getElementById("kpi-sov-winner");
  const gapEl = document.getElementById("kpi-sov-gap");
  if (winnerEl && gapEl) {
    if (total === 0) {
      winnerEl.textContent = "No Data";
      gapEl.textContent = "0.0% gap";
    } else if (novoMentions === lillyMentions) {
      winnerEl.textContent = "Tie";
      gapEl.textContent = "0.0% gap";
    } else {
      const winner = novoMentions > lillyMentions ? "Novo Nordisk" : "Eli Lilly";
      const gap = Math.abs(novoSov - lillySov) * 100;
      winnerEl.textContent = winner;
      winnerEl.className = `kpi-value value-smalltext ${winner === "Novo Nordisk" ? "text-novo" : "text-lilly"}`;
      gapEl.textContent = `${gap.toFixed(1)}% SOV gap`;
    }
  }

  // 4. Sentiment Gap
  const sentGapEl = document.getElementById("kpi-sentiment-gap");
  const sentLeadEl = document.getElementById("kpi-sentiment-lead");
  if (sentGapEl && sentLeadEl) {
    const nPos = filteredList.filter(m => m.company === "Novo Nordisk" && m.sentiment === "Positive").length;
    const nNeg = filteredList.filter(m => m.company === "Novo Nordisk" && m.sentiment === "Negative").length;
    const nTotal = filteredList.filter(m => m.company === "Novo Nordisk").length;
    const nNet = nTotal ? (nPos - nNeg) / nTotal : 0;

    const lPos = filteredList.filter(m => m.company === "Eli Lilly" && m.sentiment === "Positive").length;
    const lNeg = filteredList.filter(m => m.company === "Eli Lilly" && m.sentiment === "Negative").length;
    const lTotal = filteredList.filter(m => m.company === "Eli Lilly").length;
    const lNet = lTotal ? (lPos - lNeg) / lTotal : 0;

    const sentDiff = Math.abs(nNet - lNet) * 100;
    
    if (nNet === lNet) {
      sentGapEl.textContent = "0.0%";
      sentLeadEl.textContent = "Equal sentiment";
    } else {
      const leadCompany = nNet > lNet ? "Novo Nordisk" : "Eli Lilly";
      sentGapEl.textContent = `${sentDiff.toFixed(1)}% gap`;
      sentLeadEl.textContent = `${leadCompany} leads (Net: ${Math.max(nNet, lNet).toFixed(2)})`;
    }
  }

  // 5. Exposure Momentum
  const momWinnerEl = document.getElementById("kpi-momentum-winner");
  const momRateEl = document.getElementById("kpi-momentum-rate");
  if (momWinnerEl && momRateEl) {
    // Split date range in half
    const sorted = [...filteredList].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 4) {
      momWinnerEl.textContent = "Insufficient Data";
      momRateEl.textContent = "N/A";
    } else {
      const dates = sorted.map(m => m.date);
      const uniqueDates = [...new Set(dates)];
      const mid = Math.floor(uniqueDates.length / 2);
      const midDate = uniqueDates[mid];

      const novoBefore = sorted.filter(m => m.company === "Novo Nordisk" && m.date < midDate).length;
      const novoAfter = sorted.filter(m => m.company === "Novo Nordisk" && m.date >= midDate).length;
      const novoGrowth = novoBefore ? (novoAfter - novoBefore) / novoBefore : 0;

      const lillyBefore = sorted.filter(m => m.company === "Eli Lilly" && m.date < midDate).length;
      const lillyAfter = sorted.filter(m => m.company === "Eli Lilly" && m.date >= midDate).length;
      const lillyGrowth = lillyBefore ? (lillyAfter - lillyBefore) / lillyBefore : 0;

      if (novoGrowth === lillyGrowth) {
        momWinnerEl.textContent = "Tie";
        momRateEl.textContent = `${(novoGrowth * 100).toFixed(0)}% growth`;
      } else {
        const momWinner = novoGrowth > lillyGrowth ? "Novo Nordisk" : "Eli Lilly";
        const maxGrowth = Math.max(novoGrowth, lillyGrowth);
        momWinnerEl.textContent = momWinner;
        momWinnerEl.className = `kpi-value value-smalltext ${momWinner === "Novo Nordisk" ? "text-novo" : "text-lilly"}`;
        momRateEl.textContent = `${maxGrowth >= 0 ? "+" : ""}${(maxGrowth * 100).toFixed(0)}% growth rate`;
      }
    }
  }

  // 6. High Risk Alerts
  const highAlertsCount = appState.data.alerts.filter(a => a.severity === "High").length;
  const highAlertsEl = document.getElementById("kpi-high-alerts");
  if (highAlertsEl) {
    highAlertsEl.textContent = highAlertsCount;
    const card = highAlertsEl.closest(".kpi-card");
    if (card) {
      card.classList.toggle("alert-risk-active", highAlertsCount > 0);
    }
  }
}

function renderActiveTabVisuals() {
  const filtered = getFilteredMentions();

  if (appState.activeTab === "overview") {
    renderOverviewCharts(filtered);
  } else if (appState.activeTab === "channels") {
    renderChannelsTable(filtered);
  } else if (appState.activeTab === "topics") {
    renderTopicsVisuals(filtered);
  } else if (appState.activeTab === "trends") {
    renderTrendsChart(filtered);
  } else if (appState.activeTab === "explorer") {
    renderExplorerTable(filtered);
  } else if (appState.activeTab === "alerts") {
    renderAlertsList();
  } else if (appState.activeTab === "data-quality") {
    renderDataQuality();
  }
}

// ----------------------------------------------------
// CHART RENDERERS (Pure SVG logic)
// ----------------------------------------------------

function renderOverviewCharts(filtered) {
  // 1. Mentions Over Time Line Chart
  renderMentionsTimeSVG("chart-mentions-time", filtered);

  // 2. Share of Voice by Channel Donut
  renderSOVChannelSVG("chart-sov-channel", filtered);

  // 3. Sentiment Stacked Bar
  renderSentimentDistSVG("chart-sentiment-dist", filtered);

  // 4. Source Tiers Vertical Bar
  renderSourceTiersSVG("chart-source-tiers", filtered);

  // 5. Topic Mix Horizontal Bar
  renderTopicMixSVG("chart-topic-mix", filtered);
}

function renderMentionsTimeSVG(containerId, filtered) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Process data: group daily counts
  const dayCounts = {};
  filtered.forEach(m => {
    if (!dayCounts[m.date]) {
      dayCounts[m.date] = { novo: 0, lilly: 0 };
    }
    if (m.company === "Novo Nordisk") dayCounts[m.date].novo++;
    else dayCounts[m.date].lilly++;
  });

  const sortedDates = Object.keys(dayCounts).sort();
  if (sortedDates.length < 2) {
    container.innerHTML = `<div class="no-data-msg">Need at least 2 days of data to plot timeline.</div>`;
    return;
  }

  // Setup dimensions
  const width = container.clientWidth || 500;
  const height = 250;
  const padding = { top: 20, right: 20, bottom: 40, left: 40 };

  // Calculate scales
  let maxCount = 0;
  sortedDates.forEach(d => {
    maxCount = Math.max(maxCount, dayCounts[d].novo, dayCounts[d].lilly);
  });
  maxCount = Math.max(5, Math.ceil(maxCount * 1.15));

  const getX = (index) => padding.left + (index / (sortedDates.length - 1)) * (width - padding.left - padding.right);
  const getY = (count) => height - padding.bottom - (count / maxCount) * (height - padding.top - padding.bottom);

  // Build SVG
  let svgContent = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">`;

  // Draw Grid Lines & Y-axis labels
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const val = Math.round((maxCount / yTicks) * i);
    const y = getY(val);
    svgContent += `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid-line" />
      <text x="${padding.left - 8}" y="${y + 3}" text-anchor="end">${val}</text>
    `;
  }

  // Draw X-axis labels (e.g. 5 dates evenly spread)
  const xTicks = Math.min(5, sortedDates.length);
  for (let i = 0; i < xTicks; i++) {
    const idx = Math.floor((sortedDates.length - 1) * (i / (xTicks - 1)));
    const dateStr = sortedDates[idx];
    const x = getX(idx);
    
    // Format date string from YYYY-MM-DD to MM/DD
    const formatted = dateStr ? dateStr.slice(5) : "";
    svgContent += `
      <text x="${x}" y="${height - padding.bottom + 18}" text-anchor="middle">${formatted}</text>
    `;
  }

  // Build Paths
  let novoPath = "";
  let lillyPath = "";
  let novoArea = `M ${getX(0)} ${getY(0)}`;
  let lillyArea = `M ${getX(0)} ${getY(0)}`;

  sortedDates.forEach((date, idx) => {
    const nx = getX(idx);
    const nyNovo = getY(dayCounts[date].novo);
    const nyLilly = getY(dayCounts[date].lilly);

    if (idx === 0) {
      novoPath += `M ${nx} ${nyNovo}`;
      lillyPath += `M ${nx} ${nyLilly}`;
    } else {
      novoPath += ` L ${nx} ${nyNovo}`;
      lillyPath += ` L ${nx} ${nyLilly}`;
    }
    
    novoArea += ` L ${nx} ${nyNovo}`;
    lillyArea += ` L ${nx} ${nyLilly}`;
  });

  novoArea += ` L ${getX(sortedDates.length - 1)} ${getY(0)} Z`;
  lillyArea += ` L ${getX(sortedDates.length - 1)} ${getY(0)} Z`;

  // Draw Areas
  svgContent += `
    <path d="${novoArea}" fill="url(#novoGlow)" opacity="0.06" />
    <path d="${lillyArea}" fill="url(#lillyGlow)" opacity="0.06" />
  `;

  // Draw Lines
  svgContent += `
    <path d="${novoPath}" class="chart-line-novo" />
    <path d="${lillyPath}" class="chart-line-lilly" />
  `;

  // Draw interactive dots
  sortedDates.forEach((date, idx) => {
    const nx = getX(idx);
    const nyNovo = getY(dayCounts[date].novo);
    const nyLilly = getY(dayCounts[date].lilly);

    svgContent += `
      <circle cx="${nx}" cy="${nyNovo}" r="3" class="chart-dot-novo" />
      <circle cx="${nx}" cy="${nyLilly}" r="3" class="chart-dot-lilly" />
    `;
  });

  // Gradient definitions
  svgContent += `
    <defs>
      <linearGradient id="novoGlow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${CHART_COLORS.novo}" />
        <stop offset="100%" stop-color="${CHART_COLORS.novo}" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="lillyGlow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${CHART_COLORS.lilly}" />
        <stop offset="100%" stop-color="${CHART_COLORS.lilly}" stop-opacity="0" />
      </linearGradient>
    </defs>
  `;

  svgContent += `</svg>`;
  container.innerHTML = svgContent;
}

function renderSOVChannelSVG(containerId, filtered) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Process data
  const channels = {};
  filtered.forEach(m => {
    const ch = m.channel || "Other";
    if (!channels[ch]) channels[ch] = 0;
    channels[ch]++;
  });

  const sortedChannels = Object.entries(channels).sort((a, b) => b[1] - a[1]);
  const total = filtered.length;

  if (total === 0) {
    container.innerHTML = `<div class="no-data-msg">No channel data available.</div>`;
    return;
  }

  const width = container.clientWidth || 400;
  const height = 250;
  const radius = Math.min(width, height) / 2.8;
  const cx = width / 2.8;
  const cy = height / 2;

  let svgContent = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">`;
  
  // Donut SVG path calculations
  let currentAngle = 0;
  const colorPalette = [
    CHART_COLORS.novo,
    CHART_COLORS.lilly,
    "#3b82f6",
    "#f59e0b",
    "#10b981",
    "#ec4899",
    "#6366f1",
    "#8b5cf6"
  ];

  sortedChannels.forEach((item, index) => {
    const name = item[0];
    const val = item[1];
    const percentage = val / total;
    const sliceAngle = percentage * 360;

    // Draw donut segment
    const x1 = cx + radius * Math.cos((currentAngle - 90) * Math.PI / 180);
    const y1 = cy + radius * Math.sin((currentAngle - 90) * Math.PI / 180);
    const x2 = cx + radius * Math.cos((currentAngle + sliceAngle - 90) * Math.PI / 180);
    const y2 = cy + radius * Math.sin((currentAngle + sliceAngle - 90) * Math.PI / 180);

    const largeArc = sliceAngle > 180 ? 1 : 0;
    const color = colorPalette[index % colorPalette.length];

    if (percentage === 1.0) {
      // Full circle edge case
      svgContent += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="20" />`;
    } else {
      svgContent += `
        <path d="M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}" 
              fill="none" 
              stroke="${color}" 
              stroke-width="20" 
              style="cursor:pointer;" />
      `;
    }

    // Legend on the right side
    const legendX = cx + radius + 30;
    const legendY = 40 + index * 22;
    svgContent += `
      <rect x="${legendX}" y="${legendY - 8}" width="12" height="12" fill="${color}" rx="2" />
      <text x="${legendX + 18}" y="${legendY + 2}" text-anchor="start" font-weight="500">${name} (${(percentage * 100).toFixed(0)}%)</text>
    `;

    currentAngle += sliceAngle;
  });

  // Inner text info
  svgContent += `
    <circle cx="${cx}" cy="${cy}" r="${radius - 12}" fill="var(--bg-secondary)" />
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-weight="600" fill="var(--text-primary)" font-size="16px">${total}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="10px">Total Mentions</text>
  `;

  svgContent += `</svg>`;
  container.innerHTML = svgContent;
}

function renderSentimentDistSVG(containerId, filtered) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const novo = filtered.filter(m => m.company === "Novo Nordisk");
  const lilly = filtered.filter(m => m.company === "Eli Lilly");

  const getCounts = (list) => {
    return {
      pos: list.filter(m => m.sentiment === "Positive").length,
      neu: list.filter(m => m.sentiment === "Neutral").length,
      neg: list.filter(m => m.sentiment === "Negative").length
    };
  };

  const nCounts = getCounts(novo);
  const lCounts = getCounts(lilly);
  const total = filtered.length;

  if (total === 0) {
    container.innerHTML = `<div class="no-data-msg">No sentiment data available.</div>`;
    return;
  }

  const width = container.clientWidth || 300;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 20, left: 90 };

  const barHeight = 24;
  const gap = 45;

  const maxVal = Math.max(
    nCounts.pos + nCounts.neu + nCounts.neg,
    lCounts.pos + lCounts.neu + lCounts.neg
  ) || 1;

  const getWidth = (val) => (val / maxVal) * (width - padding.left - padding.right);

  let svgContent = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">`;

  // Helper to draw row
  const drawRow = (y, label, counts) => {
    const wPos = getWidth(counts.pos);
    const wNeu = getWidth(counts.neu);
    const wNeg = getWidth(counts.neg);

    let currentX = padding.left;
    let rowSvg = `<text x="${padding.left - 12}" y="${y + barHeight/2 + 4}" text-anchor="end" font-weight="600">${label}</text>`;

    if (counts.pos > 0) {
      rowSvg += `
        <rect x="${currentX}" y="${y}" width="${wPos}" height="${barHeight}" fill="${CHART_COLORS.positive}" rx="2" />
        <text x="${currentX + wPos/2}" y="${y + barHeight/2 + 3}" text-anchor="middle" font-size="9px" fill="#fff" font-weight="bold">${counts.pos}</text>
      `;
      currentX += wPos;
    }
    if (counts.neu > 0) {
      rowSvg += `
        <rect x="${currentX}" y="${y}" width="${wNeu}" height="${barHeight}" fill="${CHART_COLORS.neutral}" rx="2" />
        <text x="${currentX + wNeu/2}" y="${y + barHeight/2 + 3}" text-anchor="middle" font-size="9px" fill="#000" font-weight="bold">${counts.neu}</text>
      `;
      currentX += wNeu;
    }
    if (counts.neg > 0) {
      rowSvg += `
        <rect x="${currentX}" y="${y}" width="${wNeg}" height="${barHeight}" fill="${CHART_COLORS.negative}" rx="2" />
        <text x="${currentX + wNeg/2}" y="${y + barHeight/2 + 3}" text-anchor="middle" font-size="9px" fill="#fff" font-weight="bold">${counts.neg}</text>
      `;
    }

    return rowSvg;
  };

  svgContent += drawRow(50, "Novo Nordisk", nCounts);
  svgContent += drawRow(50 + gap + barHeight, "Eli Lilly", lCounts);

  // Draw Legend at the bottom
  const legendY = 175;
  svgContent += `
    <g transform="translate(${padding.left}, ${legendY})">
      <rect x="0" y="0" width="10" height="10" fill="${CHART_COLORS.positive}" rx="2" />
      <text x="14" y="9" text-anchor="start">Positive</text>
      
      <rect x="80" y="0" width="10" height="10" fill="${CHART_COLORS.neutral}" rx="2" />
      <text x="94" y="9" text-anchor="start">Neutral</text>
      
      <rect x="160" y="0" width="10" height="10" fill="${CHART_COLORS.negative}" rx="2" />
      <text x="174" y="9" text-anchor="start">Negative</text>
    </g>
  `;

  svgContent += `</svg>`;
  container.innerHTML = svgContent;
}

function renderSourceTiersSVG(containerId, filtered) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const tiers = { "Tier 1": 0, "Trade": 0, "Finance": 0, "Other": 0 };
  filtered.forEach(m => {
    const tier = m.sourceTier || "Other";
    if (tier in tiers) tiers[tier]++;
  });

  const width = container.clientWidth || 300;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 45, left: 35 };

  let maxVal = Math.max(...Object.values(tiers)) || 1;
  maxVal = Math.ceil(maxVal * 1.15);

  const getX = (name) => {
    const names = Object.keys(tiers);
    const idx = names.indexOf(name);
    return padding.left + (idx + 0.25) * ((width - padding.left - padding.right) / names.length);
  };
  const getY = (val) => height - padding.bottom - (val / maxVal) * (height - padding.top - padding.bottom);
  const barWidth = 36;

  let svgContent = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">`;

  // Gridlines and labels
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const val = Math.round((maxVal / ticks) * i);
    const y = getY(val);
    svgContent += `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid-line" />
      <text x="${padding.left - 8}" y="${y + 3}" text-anchor="end">${val}</text>
    `;
  }

  // Draw Bars
  Object.entries(tiers).forEach(([name, count]) => {
    const x = getX(name);
    const y = getY(count);
    const barHeight = height - padding.bottom - y;
    
    let color = CHART_COLORS.neutral;
    if (name === "Tier 1") color = "#f59e0b"; // Warning gold
    else if (name === "Trade") color = CHART_COLORS.novo;
    else if (name === "Finance") color = CHART_COLORS.lilly;

    svgContent += `
      <rect x="${x - barWidth/2}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="3" />
      <text x="${x}" y="${y - 5}" text-anchor="middle" font-weight="bold">${count}</text>
      <text x="${x}" y="${height - padding.bottom + 16}" text-anchor="middle">${name}</text>
    `;
  });

  svgContent += `</svg>`;
  container.innerHTML = svgContent;
}

function renderTopicMixSVG(containerId, filtered) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const topics = {};
  filtered.forEach(m => {
    const topic = m.topic || "Other";
    if (!topics[topic]) topics[topic] = 0;
    topics[topic]++;
  });

  // Top 5 topics
  const sorted = Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const width = container.clientWidth || 300;
  const height = 220;
  const padding = { top: 15, right: 30, bottom: 20, left: 100 };

  const barHeight = 16;
  const gap = 14;

  const maxVal = sorted.length > 0 ? sorted[0][1] : 1;
  const getWidth = (val) => (val / maxVal) * (width - padding.left - padding.right);

  let svgContent = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">`;

  sorted.forEach((item, index) => {
    const name = item[0];
    const val = item[1];
    const w = getWidth(val);
    const y = padding.top + index * (barHeight + gap);

    // Topic Label (truncated)
    const displayLabel = name.length > 14 ? name.slice(0, 12) + "..." : name;

    svgContent += `
      <text x="${padding.left - 10}" y="${y + barHeight/2 + 4}" text-anchor="end" font-size="10px" font-weight="500">${displayLabel}</text>
      <rect x="${padding.left}" y="${y}" width="${w}" height="${barHeight}" fill="url(#topicGrad)" rx="2" />
      <text x="${padding.left + w + 6}" y="${y + barHeight/2 + 4}" text-anchor="start" font-weight="bold">${val}</text>
    `;
  });

  svgContent += `
    <defs>
      <linearGradient id="topicGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${CHART_COLORS.novo}" />
        <stop offset="100%" stop-color="${CHART_COLORS.lilly}" />
      </linearGradient>
    </defs>
  `;

  svgContent += `</svg>`;
  container.innerHTML = svgContent;
}

// ----------------------------------------------------
// CHANNELS TABLE RENDERER
// ----------------------------------------------------
function renderChannelsTable(filtered) {
  const tbody = document.querySelector("#channels-table tbody");
  if (!tbody) return;

  const channelsData = {};
  filtered.forEach(m => {
    const ch = m.channel || "Other";
    if (!channelsData[ch]) {
      channelsData[ch] = { novo: 0, lilly: 0 };
    }
    if (m.company === "Novo Nordisk") channelsData[ch].novo++;
    else channelsData[ch].lilly++;
  });

  const totalFiltered = filtered.length;
  tbody.innerHTML = "";

  if (totalFiltered === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No channel matches found for current filters.</td></tr>`;
    return;
  }

  // Sort channels by total volume
  const sorted = Object.entries(channelsData).sort((a, b) => {
    return (b[1].novo + b[1].lilly) - (a[1].novo + a[1].lilly);
  });

  sorted.forEach(([channelName, counts]) => {
    const novoCount = counts.novo;
    const lillyCount = counts.lilly;
    const rowTotal = novoCount + lillyCount;
    const sovPercent = totalFiltered ? (rowTotal / totalFiltered) * 100 : 0;
    
    const novoShare = rowTotal ? (novoCount / rowTotal) * 100 : 0;
    const lillyShare = rowTotal ? (lillyCount / rowTotal) * 100 : 0;

    tbody.innerHTML += `
      <tr>
        <td class="font-semibold">${channelName}</td>
        <td>${novoCount.toLocaleString()}</td>
        <td class="text-secondary">${novoShare.toFixed(1)}%</td>
        <td>${lillyCount.toLocaleString()}</td>
        <td class="text-secondary">${lillyShare.toFixed(1)}%</td>
        <td class="font-semibold">${rowTotal.toLocaleString()}</td>
        <td>
          <div class="table-bar-container">
            <span class="table-bar-txt">${sovPercent.toFixed(1)}%</span>
            <div class="table-sov-bar">
              <div class="sov-bar-fill-novo" style="width: ${sovPercent * (novoShare/100)}%;"></div>
              <div class="sov-bar-fill-lilly" style="width: ${sovPercent * (lillyShare/100)}%;"></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  });
}

// ----------------------------------------------------
// TOPICS RENDERERS
// ----------------------------------------------------
function renderTopicsVisuals(filtered) {
  // 1. Double Grouped Bar Chart comparison
  renderTopicGroupedBarSVG("chart-topic-mix-comparison", filtered);

  // 2. Topic Heatmap (Brand intensity comparison grid)
  renderTopicHeatmapGrid("chart-topic-heatmap", filtered);
}

function renderTopicGroupedBarSVG(containerId, filtered) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const topics = {};
  filtered.forEach(m => {
    const topic = m.topic || "Other";
    if (!topics[topic]) {
      topics[topic] = { novo: 0, lilly: 0 };
    }
    if (m.company === "Novo Nordisk") topics[topic].novo++;
    else topics[topic].lilly++;
  });

  // Sort topics by total count and grab top 8
  const sorted = Object.entries(topics)
    .sort((a, b) => (b[1].novo + b[1].lilly) - (a[1].novo + a[1].lilly))
    .slice(0, 8);

  if (sorted.length === 0) {
    container.innerHTML = `<div class="no-data-msg">No topic data to compare.</div>`;
    return;
  }

  const width = container.clientWidth || 500;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 65, left: 40 };

  let maxVal = 0;
  sorted.forEach(t => {
    maxVal = Math.max(maxVal, t[1].novo, t[1].lilly);
  });
  maxVal = Math.max(5, Math.ceil(maxVal * 1.15));

  const getY = (val) => height - padding.bottom - (val / maxVal) * (height - padding.top - padding.bottom);
  const getX = (index) => padding.left + index * ((width - padding.left - padding.right) / sorted.length);

  const colWidth = (width - padding.left - padding.right) / sorted.length;
  const barWidth = 14;

  let svgContent = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">`;

  // Draw Grid lines
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const val = Math.round((maxVal / ticks) * i);
    const y = getY(val);
    svgContent += `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid-line" />
      <text x="${padding.left - 8}" y="${y + 3}" text-anchor="end">${val}</text>
    `;
  }

  // Draw double bars
  sorted.forEach(([topicName, counts], idx) => {
    const cx = getX(idx) + colWidth / 2;
    const yNovo = getY(counts.novo);
    const yLilly = getY(counts.lilly);

    const hNovo = height - padding.bottom - yNovo;
    const hLilly = height - padding.bottom - yLilly;

    svgContent += `
      <!-- Novo Bar -->
      <rect x="${cx - barWidth - 2}" y="${yNovo}" width="${barWidth}" height="${hNovo}" fill="${CHART_COLORS.novo}" rx="2" />
      <!-- Lilly Bar -->
      <rect x="${cx + 2}" y="${yLilly}" width="${barWidth}" height="${hLilly}" fill="${CHART_COLORS.lilly}" rx="2" />
      
      <!-- Label -->
      <g transform="translate(${cx}, ${height - padding.bottom + 12}) rotate(30)">
        <text x="0" y="0" text-anchor="start" font-size="9px">${topicName.length > 18 ? topicName.slice(0, 15) + '...' : topicName}</text>
      </g>
    `;
  });

  svgContent += `</svg>`;
  container.innerHTML = svgContent;
}

function renderTopicHeatmapGrid(containerId, filtered) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const topics = {};
  filtered.forEach(m => {
    const topic = m.topic || "Other";
    if (!topics[topic]) topics[topic] = 0;
    topics[topic]++;
  });

  const sorted = Object.entries(topics).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    container.innerHTML = `<div class="no-data-msg">No topic heatmap metrics.</div>`;
    return;
  }

  let htmlContent = `<div class="heatmap-grid">`;
  const maxVal = sorted[0][1] || 1;

  sorted.slice(0, 12).forEach(([topicName, count]) => {
    const intensity = count / maxVal;
    // Map intensity to opacity in CSS variables
    const cellStyle = `
      background-color: rgba(0, 210, 196, ${0.05 + intensity * 0.3});
      border-color: rgba(0, 210, 196, ${0.1 + intensity * 0.4});
      color: ${intensity > 0.6 ? '#ffffff' : 'var(--text-primary)'};
    `;
    
    htmlContent += `
      <div class="heatmap-cell" style="${cellStyle}">
        <span class="h-topic">${topicName}</span>
        <span class="h-count">${count} mentions</span>
      </div>
    `;
  });

  htmlContent += `</div>`;
  container.innerHTML = htmlContent;
}

// ----------------------------------------------------
// TRENDS TIMELINE RENDERER
// ----------------------------------------------------
function renderTrendsChart(filtered) {
  const container = document.getElementById("chart-trends-spikes");
  if (!container) return;

  // Process data by day
  const dayData = {};
  filtered.forEach(m => {
    if (!dayData[m.date]) {
      dayData[m.date] = { novo: 0, lilly: 0 };
    }
    if (m.company === "Novo Nordisk") dayData[m.date].novo++;
    else dayData[m.date].lilly++;
  });

  const sortedDates = Object.keys(dayData).sort();
  if (sortedDates.length < 2) {
    container.innerHTML = `<div class="no-data-msg">Need more date ranges to render spike trend chart.</div>`;
    return;
  }

  const width = container.clientWidth || 800;
  const height = 350;
  const padding = { top: 30, right: 30, bottom: 45, left: 45 };

  let maxVal = 0;
  sortedDates.forEach(d => {
    maxVal = Math.max(maxVal, dayData[d].novo, dayData[d].lilly);
  });
  maxVal = Math.max(5, Math.ceil(maxVal * 1.15));

  const getX = (idx) => padding.left + (idx / (sortedDates.length - 1)) * (width - padding.left - padding.right);
  const getY = (val) => height - padding.bottom - (val / maxVal) * (height - padding.top - padding.bottom);

  let svgContent = `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">`;

  // Draw Grid Lines
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const val = Math.round((maxVal / ticks) * i);
    const y = getY(val);
    svgContent += `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid-line" />
      <text x="${padding.left - 8}" y="${y + 3}" text-anchor="end">${val}</text>
    `;
  }

  // Draw X dates axis
  const xTicks = Math.min(8, sortedDates.length);
  for (let i = 0; i < xTicks; i++) {
    const idx = Math.floor((sortedDates.length - 1) * (i / (xTicks - 1)));
    const dStr = sortedDates[idx];
    const x = getX(idx);
    svgContent += `
      <text x="${x}" y="${height - padding.bottom + 18}" text-anchor="middle" font-size="9px">${dStr}</text>
    `;
  }

  // Draw spikes (vertical needle lines) + dots
  sortedDates.forEach((date, idx) => {
    const x = getX(idx);
    const yNovo = getY(dayData[date].novo);
    const yLilly = getY(dayData[date].lilly);

    // Draw Novo Spike Line
    svgContent += `
      <line x1="${x - 2}" y1="${height - padding.bottom}" x2="${x - 2}" y2="${yNovo}" stroke="${CHART_COLORS.novo}" stroke-width="1.5" opacity="0.4" />
      <circle cx="${x - 2}" cy="${yNovo}" r="3.5" class="chart-dot-novo" style="cursor:pointer;" />
      
      <line x1="${x + 2}" y1="${height - padding.bottom}" x2="${x + 2}" y2="${yLilly}" stroke="${CHART_COLORS.lilly}" stroke-width="1.5" opacity="0.4" />
      <circle cx="${x + 2}" cy="${yLilly}" r="3.5" class="chart-dot-lilly" style="cursor:pointer;" />
    `;
  });

  svgContent += `</svg>`;
  container.innerHTML = svgContent;
}

// ----------------------------------------------------
// EXPLORER TABLE & DRAWER
// ----------------------------------------------------
function renderExplorerTable(filtered) {
  const tbody = document.querySelector("#explorer-table tbody");
  const countEl = document.getElementById("explorer-records-count");
  if (!tbody) return;

  // Sorting
  const sorted = sortExplorerData(filtered);

  // Pagination
  const totalRecords = sorted.length;
  const totalPages = Math.ceil(totalRecords / appState.explorer.pageSize) || 1;
  
  if (appState.explorer.currentPage > totalPages) {
    appState.explorer.currentPage = totalPages;
  }

  const startIdx = (appState.explorer.currentPage - 1) * appState.explorer.pageSize;
  const endIdx = Math.min(startIdx + appState.explorer.pageSize, totalRecords);
  const pageRecords = sorted.slice(startIdx, endIdx);

  tbody.innerHTML = "";
  
  if (totalRecords === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-secondary">No records match the current filters.</td></tr>`;
    if (countEl) countEl.textContent = "Showing 0 of 0 articles";
    renderPagination(0, 1);
    return;
  }

  if (countEl) {
    countEl.textContent = `Showing ${startIdx + 1}-${endIdx} of ${totalRecords.toLocaleString()} articles`;
  }

  pageRecords.forEach(item => {
    const row = document.createElement("tr");
    row.classList.add("row-click");
    row.dataset.id = item.id;
    
    const sentClass = `sentiment-${item.sentiment.toLowerCase()}`;
    const tierClass = `tier-${(item.sourceTier || 'other').toLowerCase().replace(' ', '_')}`;

    row.innerHTML = `
      <td class="text-secondary">${item.date}</td>
      <td class="font-semibold ${item.company === 'Novo Nordisk' ? 'text-novo' : 'text-lilly'}">${item.company}</td>
      <td>${item.source}</td>
      <td><span class="tier-pill ${tierClass}">${item.sourceTier || 'Other'}</span></td>
      <td class="font-semibold text-primary truncate-cell">${item.title}</td>
      <td>${item.topic}</td>
      <td><span class="sentiment-pill ${sentClass}">${item.sentiment}</span></td>
      <td><span class="text-secondary">${item.reach ? item.reach.toLocaleString() : '0'}</span> <span class="proxy-lbl">*</span></td>
    `;

    row.addEventListener("click", () => openDetailsDrawer(item));
    tbody.appendChild(row);
  });

  renderPagination(totalRecords, totalPages);
  setupTableSortHeaders();
}

function sortExplorerData(list) {
  const field = appState.explorer.sortField;
  const asc = appState.explorer.sortAscending;

  return [...list].sort((a, b) => {
    let valA = a[field];
    let valB = b[field];

    if (field === "tier") {
      valA = a.sourceTier || "Other";
      valB = b.sourceTier || "Other";
    }

    if (typeof valA === "string") {
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    if (typeof valA === "number") {
      return asc ? valA - valB : valB - valA;
    }
    return 0;
  });
}

function setupTableSortHeaders() {
  const headers = document.querySelectorAll("#explorer-table th.sortable");
  headers.forEach(h => {
    const field = h.dataset.sort;
    h.classList.toggle("sort-active", field === appState.explorer.sortField);
    
    // Add sorting icon indicator
    const icon = h.querySelector(".sort-icon");
    if (icon) {
      if (field === appState.explorer.sortField) {
        icon.textContent = appState.explorer.sortAscending ? "▲" : "▼";
      } else {
        icon.textContent = "⇅";
      }
    }

    // Reattach listeners cleanly
    h.onclick = () => {
      if (appState.explorer.sortField === field) {
        appState.explorer.sortAscending = !appState.explorer.sortAscending;
      } else {
        appState.explorer.sortField = field;
        appState.explorer.sortAscending = false;
      }
      renderExplorerTable(getFilteredMentions());
    };
  });
}

function renderPagination(total, pages) {
  const container = document.getElementById("explorer-pagination");
  if (!container) return;

  container.innerHTML = "";
  if (total === 0 || pages === 1) return;

  const current = appState.explorer.currentPage;

  const addBtn = (label, pageTarget, active = false, disabled = false) => {
    const btn = document.createElement("button");
    btn.className = `page-btn ${active ? 'active' : ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    if (!disabled) {
      btn.onclick = () => {
        appState.explorer.currentPage = pageTarget;
        renderExplorerTable(getFilteredMentions());
      };
    }
    container.appendChild(btn);
  };

  // Prev
  addBtn("<", current - 1, false, current === 1);

  // First page
  if (current > 3) {
    addBtn("1", 1);
    if (current > 4) {
      const span = document.createElement("span");
      span.className = "page-dots";
      span.textContent = "...";
      container.appendChild(span);
    }
  }

  // Window
  for (let i = Math.max(1, current - 2); i <= Math.min(pages, current + 2); i++) {
    addBtn(i.toString(), i, i === current);
  }

  // Last page
  if (current < pages - 2) {
    if (current < pages - 3) {
      const span = document.createElement("span");
      span.className = "page-dots";
      span.textContent = "...";
      container.appendChild(span);
    }
    addBtn(pages.toString(), pages);
  }

  // Next
  addBtn(">", current + 1, false, current === pages);
}

// Side panel details drawer logic
function openDetailsDrawer(item) {
  const drawer = document.getElementById("details-drawer");
  const overlay = document.getElementById("drawer-overlay");
  const body = document.getElementById("drawer-content");

  if (!drawer || !body) return;

  const isProxy = item.isProxyMetrics !== false;
  const kwList = (item.matchedKeywords || []).map(k => `<code>${k}</code>`).join(" ");

  body.innerHTML = `
    <div class="drawer-title-heading">${item.title}</div>
    <div class="drawer-subtitle">
      <span class="sentiment-pill sentiment-${item.sentiment.toLowerCase()}">${item.sentiment}</span>
      <span class="tier-pill tier-${(item.sourceTier || 'other').toLowerCase().replace(' ', '_')}">${item.sourceTier || 'Other'}</span>
    </div>
    
    <div class="drawer-snippet">${item.snippet || '(No snippet available for this record)'}</div>

    <div class="meta-group-box">
      <div class="meta-item">
        <span>Company</span>
        <p class="${item.company === 'Novo Nordisk' ? 'text-novo' : 'text-lilly'} font-semibold">${item.company}</p>
      </div>
      <div class="meta-item">
        <span>Source / Domain</span>
        <p class="text-primary font-semibold">${item.source} <br><span class="text-muted text-xs">${item.sourceDomain}</span></p>
      </div>
      <div class="meta-item">
        <span>Date Published</span>
        <p>${item.date}</p>
      </div>
      <div class="meta-item">
        <span>Channel</span>
        <p>${item.channel}</p>
      </div>
      <div class="meta-item">
        <span>Topic</span>
        <p>${item.topic}</p>
      </div>
      <div class="meta-item">
        <span>Source Authority</span>
        <p>${item.sourceAuthority || '45'} / 100</p>
      </div>
      <div class="meta-item">
        <span>Reach Score</span>
        <p>${item.reach ? item.reach.toLocaleString() : '10,000'} ${isProxy ? '*' : ''}</p>
      </div>
      <div class="meta-item">
        <span>Engagement metric</span>
        <p>${item.engagement || '0'}</p>
      </div>
    </div>

    ${kwList ? `<div class="meta-item"><span>Matched Keywords</span><div class="kw-box">${kwList}</div></div>` : ''}

    <div class="meta-item">
      <span>External Article Link</span>
      <p style="word-break: break-all;">
        ${item.url ? `<a href="${item.url}" target="_blank" class="btn btn-secondary text-center" style="display:inline-block; margin-top:4px;">Read Original Source ↗</a>` : 'No URL link available'}
      </p>
    </div>

    ${isProxy ? `
      <div class="proxy-metric-warning-box">
        <strong>* Proxy Metric Warning</strong>: Reach, authority, and engagement metrics are rule-based proxies. True social impression data was not imported for this record.
      </div>
    ` : ''}
  `;

  overlay.style.display = "block";
  drawer.classList.add("open");
}

function closeDrawer() {
  const drawer = document.getElementById("details-drawer");
  const overlay = document.getElementById("drawer-overlay");
  
  if (drawer) drawer.classList.remove("open");
  if (overlay) overlay.style.display = "none";
}

// ----------------------------------------------------
// ALERTS LIST
// ----------------------------------------------------
function renderAlertsList() {
  const container = document.getElementById("alerts-list-container");
  if (!container) return;

  container.innerHTML = "";
  const alerts = appState.data.alerts || [];

  if (alerts.length === 0) {
    container.innerHTML = `<div class="alert-empty-card text-center text-secondary">No alerts triggered for the current dataset. All systems running nominal.</div>`;
    return;
  }

  alerts.forEach(item => {
    const card = document.createElement("div");
    card.className = `alert-card alert-severity-${item.severity.toLowerCase()}`;
    
    const icon = item.severity === "High" ? "!" : "i";

    card.innerHTML = `
      <div class="alert-badge-icon">${icon}</div>
      <div class="alert-info-container">
        <h4>${item.title}</h4>
        <p class="alert-detail-txt">${item.detail}</p>
        <div class="alert-time-txt">Detected on: ${item.date} | Company: <span class="${item.company === 'Novo Nordisk' ? 'text-novo' : item.company === 'Eli Lilly' ? 'text-lilly' : ''}">${item.company}</span></div>
      </div>
    `;

    container.appendChild(card);
  });
}

// ----------------------------------------------------
// DATA QUALITY METADATA
// ----------------------------------------------------
function renderDataQuality() {
  const metadataEl = document.getElementById("dq-metadata-list");
  const dedupeEl = document.getElementById("dq-dedupe-summary");
  const warningsEl = document.getElementById("dq-warnings-container");

  const meta = appState.data.metadata;
  if (!meta) return;

  // Render main metadata list
  if (metadataEl) {
    metadataEl.innerHTML = `
      <div class="metadata-item">
        <span class="m-label">Last Pipeline Update</span>
        <span class="m-value">${formatDateTime(meta.lastUpdated)}</span>
      </div>
      <div class="metadata-item">
        <span class="m-label">Coverage Window</span>
        <span class="m-value">${meta.coverageStart} to ${meta.coverageEnd}</span>
      </div>
      <div class="metadata-item">
        <span class="m-label">Total Deduplicated Records</span>
        <span class="m-value font-bold">${meta.recordCount}</span>
      </div>
      <div class="metadata-item">
        <span class="m-label">Sources Used</span>
        <span class="m-value text-positive">${(meta.sourcesUsed || []).join(", ") || "None"}</span>
      </div>
      <div class="metadata-item">
        <span class="m-label">Sources Unavailable (Offline APIs)</span>
        <span class="m-value text-negative">${(meta.sourcesUnavailable || []).join(", ")}</span>
      </div>
      <div class="metadata-item">
        <span class="m-label">Proxy Metric Fields</span>
        <span class="m-value text-warning">${(meta.proxyMetricFields || []).join(", ")}</span>
      </div>
      <div class="metadata-item">
        <span class="m-label">Dashboard Version</span>
        <span class="m-value badge badge-antigravity">${meta.version || 'antigravity'}</span>
      </div>
    `;
  }

  // Render deduplication stats
  if (dedupeEl) {
    const ds = meta.deduplicationSummary || {};
    dedupeEl.innerHTML = `
      <div class="text-xs text-secondary font-bold uppercase mb-2">Deduplication Summary (Last run)</div>
      <div class="dedupe-item">
        <span>Original Fetched Records</span>
        <span class="font-bold">${ds.originalRecordCount || 0}</span>
      </div>
      <div class="dedupe-item">
        <span>Duplicate records removed</span>
        <span class="text-negative font-bold">-${ds.duplicatesRemoved || 0}</span>
      </div>
      <div class="dedupe-item" style="padding-left: 10px; font-size: 0.8rem; color: var(--text-secondary);">
        <span>↳ Deduplicated by URL</span>
        <span>${ds.dedupedByURL || 0}</span>
      </div>
      <div class="dedupe-item" style="padding-left: 10px; font-size: 0.8rem; color: var(--text-secondary);">
        <span>↳ Deduplicated by title/date/source</span>
        <span>${ds.dedupedByTitleDateDomain || 0}</span>
      </div>
      <div class="dedupe-item border-t border-color pt-1 mt-1 font-bold">
        <span>Final clean record count</span>
        <span class="text-positive">${ds.finalRecordCount || meta.recordCount}</span>
      </div>
    `;
  }

  // Render Warnings
  if (warningsEl) {
    warningsEl.innerHTML = "";
    const warnings = meta.warnings || [];
    if (warnings.length === 0) {
      warningsEl.innerHTML = `<div class="warning-item-row" style="background-color:rgba(16,185,129,0.02); border-color:rgba(16,185,129,0.1); color:#a7f3d0;">No pipeline warnings or execution errors logged.</div>`;
    } else {
      warnings.forEach(w => {
        warningsEl.innerHTML += `<div class="warning-item-row">⚠ ${w}</div>`;
      });
    }
  }
}

// ----------------------------------------------------
// CSV EXPORT UTILITY
// ----------------------------------------------------
function exportFilteredCSV() {
  const filtered = getFilteredMentions();
  if (filtered.length === 0) {
    alert("No records to export.");
    return;
  }

  const headers = [
    "id", "date", "company", "matchedEntity", "channel", "source", "sourceDomain",
    "sourceTier", "title", "snippet", "url", "topic", "sentiment", "sentimentScore",
    "reach", "engagement", "sourceAuthority", "matchedKeywords"
  ];

  // Helper to escape CSV quotes
  const escapeCell = (val) => {
    if (val === null || val === undefined) return "";
    let str = "";
    if (Array.isArray(val)) {
      str = val.join("|");
    } else {
      str = val.toString();
    }
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  let csvContent = headers.join(",") + "\n";
  
  filtered.forEach(m => {
    const row = headers.map(h => escapeCell(m[h]));
    csvContent += row.join(",") + "\n";
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  
  // Format file name
  const dateStr = new Date().toISOString().slice(0, 10);
  link.setAttribute("href", url);
  link.setAttribute("download", `glp1_media_exposure_${appState.filters.company.replace(' ', '_').toLowerCase()}_${dateStr}.csv`);
  link.style.visibility = "hidden";
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
