const DATA_PATHS = {
  metadata: "./data/generated/metadata.json",
  mentions: "./data/generated/mentions.json",
  dailyCounts: "./data/generated/daily_counts.json",
  sourceSummary: "./data/generated/source_summary.json",
  topicSummary: "./data/generated/topic_summary.json",
  alerts: "./data/generated/alerts.json"
};

const COMPANIES = ["Novo Nordisk", "Eli Lilly"];
const NOVO_ENTITIES = ["Novo Nordisk", "Ozempic", "Wegovy", "Rybelsus", "semaglutide", "oral semaglutide"];
const LILLY_ENTITIES = ["Eli Lilly", "Mounjaro", "Zepbound", "tirzepatide", "orforglipron", "retatrutide"];
const ENTITIES = [...NOVO_ENTITIES, ...LILLY_ENTITIES];
const RISK_AREAS = [
  { name: "Safety / side effects", topics: ["Side effects / safety"], terms: ["side effect", "safety", "adverse", "risk", "nausea", "pancreatitis"] },
  { name: "Pricing / insurance / access", topics: ["Drug pricing / insurance / access"], terms: ["price", "pricing", "insurance", "coverage", "access", "medicare", "reimbursement"] },
  { name: "Legal / regulatory", topics: ["Legal / regulatory"], terms: ["lawsuit", "legal", "fda", "ema", "regulatory", "approval"] },
  { name: "Supply shortage", topics: ["Supply shortage"], terms: ["shortage", "supply", "availability", "backorder"] },
  { name: "Compounded GLP-1s", topics: ["Compounded GLP-1s"], terms: ["compounded", "compounding", "copycat"] }
];
const RISK_TOPICS = RISK_AREAS.flatMap((area) => area.topics);

const state = {
  mentions: [],
  dailyCounts: [],
  sourceSummary: [],
  topicSummary: [],
  alerts: [],
  metadata: {},
  diagnostics: [],
  lastSuccessfulLoad: null,
  topicSort: "risk",
  selectedId: null,
  page: 1,
  pageSize: 25,
  filters: {
    company: "All",
    topic: "All",
    sentiment: "All",
    tier: "All",
    rawSource: "All",
    search: "",
    quick: null,
    sort: "date",
    startDate: "",
    endDate: "",
    qualityNotesOnly: false
  }
};

const nf = new Intl.NumberFormat("en-US");
const pf = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const dtf = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

async function loadJson(key, path) {
  const started = Date.now();
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const count = Array.isArray(data) ? data.length : Number(data.recordCount || 0);
    return { key, path, status: "loaded", data, count, ms: Date.now() - started, error: "" };
  } catch (error) {
    return { key, path, status: "failed", data: key === "metadata" ? {} : [], count: 0, ms: Date.now() - started, error: error.message };
  }
}

async function init() {
  const results = await Promise.all(Object.entries(DATA_PATHS).map(([key, path]) => loadJson(key, path)));
  state.diagnostics = results.map(({ key, path, status, count, ms, error }) => ({ key, path, status, count, ms, error }));
  results.forEach((result) => {
    state[result.key] = result.data;
  });
  state.mentions = Array.isArray(state.mentions) ? state.mentions : [];
  state.lastSuccessfulLoad = state.mentions.length ? new Date() : null;
  document.querySelector("#loadError").hidden = state.mentions.length > 0;
  bindControls();
  populateFilters();
  render();
}

function bindControls() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab.dataset.tab;
      });
    });
  });

  [
    ["#companyFilter", "company"],
    ["#topicFilter", "topic"],
    ["#sentimentFilter", "sentiment"],
    ["#tierFilter", "tier"],
    ["#rawSourceFilter", "rawSource"],
    ["#sortSelect", "sort"],
    ["#startDateFilter", "startDate"],
    ["#endDateFilter", "endDate"]
  ].forEach(([selector, key]) => {
    document.querySelector(selector).addEventListener("change", (event) => {
      state.filters[key] = event.target.value;
      state.page = 1;
      render();
    });
  });
  document.querySelector("#searchInput").addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    state.page = 1;
    render();
  });
  document.querySelector("#qualityNotesFilter").addEventListener("change", (event) => {
    state.filters.qualityNotesOnly = event.target.checked;
    state.page = 1;
    render();
  });
  document.querySelectorAll(".quick-filter").forEach((button) => {
    button.addEventListener("click", () => applyQuickFilter(button.dataset.filter));
  });
  document.querySelector("#clearFilters").addEventListener("click", clearFilters);
  document.querySelectorAll(".sort-topic").forEach((button) => {
    button.addEventListener("click", () => {
      state.topicSort = button.dataset.sort;
      renderTopicsTable(filteredMentions());
    });
  });
  document.querySelector("#exportCsv").addEventListener("click", exportFilteredCsv);
  document.querySelector("#exportJson").addEventListener("click", exportFilteredJson);
  document.querySelector("#prevPage").addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    renderTable(filteredMentions());
  });
  document.querySelector("#nextPage").addEventListener("click", () => {
    const maxPage = Math.max(1, Math.ceil(filteredMentions().length / state.pageSize));
    state.page = Math.min(maxPage, state.page + 1);
    renderTable(filteredMentions());
  });
}

function populateFilters() {
  fillSelect("#topicFilter", unique("topic"));
  fillSelect("#tierFilter", unique("sourceTier"));
  fillSelect("#rawSourceFilter", unique("rawSource"));
  const dates = state.mentions.map((row) => row.date).filter(Boolean).sort();
  document.querySelector("#startDateFilter").value = dates[0] || "";
  document.querySelector("#endDateFilter").value = dates.at(-1) || "";
  state.filters.startDate = dates[0] || "";
  state.filters.endDate = dates.at(-1) || "";
}

function fillSelect(selector, values) {
  document.querySelector(selector).append(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  }));
}

function applyQuickFilter(filter) {
  const same = state.filters.quick === filter;
  clearFilters(false);
  if (!same) {
    state.filters.quick = filter;
    if (filter === "negative") state.filters.sentiment = "Negative";
    if (filter === "tier1") state.filters.tier = "Tier 1";
    if (filter === "novoRisk") {
      state.filters.company = "Novo Nordisk";
      state.filters.quick = "safety";
    }
    if (filter === "lillyTier1") {
      state.filters.company = "Eli Lilly";
      state.filters.tier = "Tier 1";
    }
  }
  syncControls();
  render();
}

function clearFilters(shouldRender = true) {
  const dates = state.mentions.map((row) => row.date).filter(Boolean).sort();
  Object.assign(state.filters, {
    company: "All",
    topic: "All",
    sentiment: "All",
    tier: "All",
    rawSource: "All",
    search: "",
    quick: null,
    sort: "date",
    startDate: dates[0] || "",
    endDate: dates.at(-1) || "",
    qualityNotesOnly: false
  });
  state.page = 1;
  syncControls();
  if (shouldRender) render();
}

function syncControls() {
  document.querySelector("#companyFilter").value = state.filters.company;
  document.querySelector("#topicFilter").value = state.filters.topic;
  document.querySelector("#sentimentFilter").value = state.filters.sentiment;
  document.querySelector("#tierFilter").value = state.filters.tier;
  document.querySelector("#rawSourceFilter").value = state.filters.rawSource;
  document.querySelector("#sortSelect").value = state.filters.sort;
  document.querySelector("#startDateFilter").value = state.filters.startDate;
  document.querySelector("#endDateFilter").value = state.filters.endDate;
  document.querySelector("#searchInput").value = state.filters.search;
  document.querySelector("#qualityNotesFilter").checked = state.filters.qualityNotesOnly;
  document.querySelectorAll(".quick-filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === state.filters.quick));
}

function unique(key) {
  return [...new Set(state.mentions.map((row) => row[key]).filter(Boolean))].sort();
}

function filteredMentions() {
  const filtered = state.mentions.filter((row) => {
    if (state.filters.company !== "All" && row.company !== state.filters.company) return false;
    if (state.filters.topic !== "All" && row.topic !== state.filters.topic) return false;
    if (state.filters.sentiment !== "All" && row.sentiment !== state.filters.sentiment) return false;
    if (state.filters.tier !== "All" && row.sourceTier !== state.filters.tier) return false;
    if (state.filters.rawSource !== "All" && row.rawSource !== state.filters.rawSource) return false;
    if (state.filters.startDate && row.date < state.filters.startDate) return false;
    if (state.filters.endDate && row.date > state.filters.endDate) return false;
    if (state.filters.qualityNotesOnly && !(row.dataQualityNotes || []).length) return false;
    if (state.filters.quick && !matchesQuickFilter(row, state.filters.quick)) return false;
    if (!state.filters.search) return true;
    return [row.title, row.snippet, row.source, row.sourceDomain, row.topic, row.company, row.rawSource, ...(row.matchedKeywords || [])]
      .join(" ")
      .toLowerCase()
      .includes(state.filters.search);
  });
  return sortRecords(filtered, state.filters.sort);
}

function matchesQuickFilter(row, filter) {
  const topic = String(row.topic || "").toLowerCase();
  if (filter === "tier1") return row.sourceTier === "Tier 1";
  if (filter === "negative") return row.sentiment === "Negative";
  if (filter === "safety") return topic.includes("safety") || topic.includes("side effect");
  if (filter === "pricing") return topic.includes("pricing") || topic.includes("access") || topic.includes("insurance");
  if (filter === "pipeline") return topic.includes("pipeline") || topic.includes("next-generation");
  if (filter === "supply") return topic.includes("supply");
  return true;
}

function sortRecords(records, key) {
  const rows = [...records];
  const numeric = ["sourceAuthority", "sentimentScore", "reach"];
  rows.sort((a, b) => {
    if (key === "date") return String(b.date || "").localeCompare(String(a.date || ""));
    if (numeric.includes(key)) return Number(b[key] || 0) - Number(a[key] || 0);
    return String(a[key] || "").localeCompare(String(b[key] || ""));
  });
  return rows;
}

function render() {
  const records = filteredMentions();
  const analytics = buildAnalytics(state.mentions);
  renderFreshnessBanner();
  renderMetadata();
  renderDiagnostics();
  renderExecutive(analytics);
  renderDecisionSummary(analytics);
  renderInsights(analytics);
  renderKpis(analytics);
  renderTimeline(records);
  renderSovChart(records);
  renderSentimentChart(records);
  renderEntityBarChart(records);
  renderTopicHeatmap(records);
  renderTopicsTable(records);
  renderSourceTable(records);
  renderTierSplit(records);
  renderEntityTable(records);
  renderRiskMonitor(records);
  renderAlerts();
  renderTable(records);
  document.querySelector("#zeroState").hidden = state.mentions.length !== 0;
}

function buildAnalytics(records) {
  const weightedRecords = withWeightedExposure(records);
  const totalMentions = records.length;
  const totalWeighted = weightedRecords.reduce((sum, row) => sum + row.weightedExposure, 0);
  const byCompany = Object.fromEntries(COMPANIES.map((company) => {
    const items = weightedRecords.filter((row) => row.company === company);
    const positive = items.filter((row) => row.sentiment === "Positive").length;
    const negative = items.filter((row) => row.sentiment === "Negative").length;
    const weighted = items.reduce((sum, row) => sum + row.weightedExposure, 0);
    return [company, {
      mentions: items.length,
      shareOfVoice: totalMentions ? items.length / totalMentions : 0,
      weightedExposure: weighted,
      weightedSov: totalWeighted ? weighted / totalWeighted : 0,
      sentimentScore: items.length ? (positive - negative) / items.length : 0,
      tier1: items.filter((row) => row.sourceTier === "Tier 1").length,
      risk: items.filter((row) => RISK_TOPICS.includes(row.topic) || row.sentiment === "Negative").length,
      topTopic: countBy(items, "topic")[0]?.name || "--"
    }];
  }));
  const topicGap = topicRows(records).reduce((acc, row) => {
    if (!acc.novo || row.novo - row.lilly > acc.novo.delta) acc.novo = { topic: row.topic, delta: row.novo - row.lilly };
    if (!acc.lilly || row.lilly - row.novo > acc.lilly.delta) acc.lilly = { topic: row.topic, delta: row.lilly - row.novo };
    return acc;
  }, {});
  const leaders = {
    exposure: leaderBy(byCompany, "mentions"),
    weighted: leaderBy(byCompany, "weightedSov"),
    sentiment: leaderBy(byCompany, "sentimentScore"),
    tier1: leaderBy(byCompany, "tier1"),
    risk: leaderBy(byCompany, "risk")
  };
  const riskRows = riskAreas(records).sort((a, b) => b.riskScore - a.riskScore);
  const biggestRiskTopic = riskRows[0];
  const influential = [...weightedRecords].sort((a, b) => Number(b.sourceAuthority || 0) - Number(a.sourceAuthority || 0) || b.weightedExposure - a.weightedExposure)[0];
  const entities = entityRows(records);
  const visibleEntity = entities.sort((a, b) => b.mentions - a.mentions)[0];
  const notable = notableArticles(weightedRecords);
  return { totalMentions, totalWeighted, byCompany, leaders, biggestRiskTopic, influential, topicGap, visibleEntity, notable };
}

function withWeightedExposure(records) {
  const maxReach = Math.max(1, ...records.map((row) => Number(row.reach || 0)));
  const maxEngagement = Math.max(1, ...records.map((row) => Number(row.engagement || 0)));
  const maxAuthority = Math.max(1, ...records.map((row) => Number(row.sourceAuthority || 0)));
  const now = Date.now();
  return records.map((row) => {
    const ageDays = row.date ? Math.max(0, (now - new Date(`${row.date}T00:00:00Z`).getTime()) / 864e5) : 90;
    const recencyWeight = Math.max(0, 1 - ageDays / 90);
    const weightedExposure = 1
      + (Number(row.reach || 0) / maxReach) * 0.35
      + (Number(row.engagement || 0) / maxEngagement) * 0.25
      + (Number(row.sourceAuthority || 0) / maxAuthority) * 0.25
      + recencyWeight * 0.15;
    return { ...row, weightedExposure };
  });
}

function leaderBy(byCompany, metric) {
  const delta = Number(byCompany["Novo Nordisk"][metric] || 0) - Number(byCompany["Eli Lilly"][metric] || 0);
  if (Math.abs(delta) < 0.0001) return "Tie";
  return delta > 0 ? "Novo Nordisk" : "Eli Lilly";
}

function renderFreshnessBanner() {
  const metadata = state.metadata || {};
  const lastUpdated = metadata.lastUpdated ? new Date(metadata.lastUpdated) : null;
  const recordCount = Number(metadata.recordCount || state.mentions.length || 0);
  document.querySelector("#bannerRecordCount").textContent = nf.format(recordCount);
  document.querySelector("#bannerLastUpdated").textContent = lastUpdated ? dtf.format(lastUpdated) : "--";
  document.querySelector("#bannerCoverage").textContent = `${metadata.coverageStart || "--"} to ${metadata.coverageEnd || "--"}`;
  document.querySelector("#bannerFetchMode").textContent = metadata.fetchMode || "--";
  document.querySelector("#bannerRunCounts").textContent = `${nf.format(metadata.previousRecordCount || 0)} / ${nf.format(metadata.newlyFetchedCount || 0)} / ${nf.format(metadata.finalRecordCount || metadata.recordCount || 0)}`;
  document.querySelector("#bannerWarnings").textContent = (metadata.warnings || []).length ? nf.format((metadata.warnings || []).length) : "None";
  document.querySelector("#bannerPreserved").textContent = metadata.preservedExistingData ? "Yes" : "No";
  const ageHours = lastUpdated ? (Date.now() - lastUpdated.getTime()) / 36e5 : Infinity;
  document.querySelector("#cacheNote").hidden = ageHours < 24;
}

function renderExecutive(analytics) {
  const metaCount = Number(state.metadata.recordCount || state.mentions.length);
  const rows = [
    ["Exposure leader", `${shortCompany(analytics.leaders.exposure)} by mentions`],
    ["Weighted SOV leader", `${shortCompany(analytics.leaders.weighted)} by proxy-weighted exposure`],
    ["Sentiment leader", `${shortCompany(analytics.leaders.sentiment)} by sentiment score`],
    ["Tier 1 leader", `${shortCompany(analytics.leaders.tier1)} by Tier 1 mentions`],
    ["Risk watch", analytics.biggestRiskTopic ? `${analytics.biggestRiskTopic.name} (${analytics.biggestRiskTopic.riskScore.toFixed(1)})` : "--"],
    ["Dataset trace", `${nf.format(state.mentions.length)} loaded records; metadata says ${nf.format(metaCount)}`]
  ];
  document.querySelector("#leaderPanel").replaceChildren(...rows.map(([label, value]) => metricItem(label, value)));
}

function renderDecisionSummary(analytics) {
  const rows = [
    ["Exposure leader", shortCompany(analytics.leaders.exposure), COMPANIES.map((company) => `${shortCompany(company)} ${nf.format(analytics.byCompany[company].mentions)}`).join(" | ")],
    ["Weighted SOV leader", shortCompany(analytics.leaders.weighted), COMPANIES.map((company) => `${shortCompany(company)} ${pf.format(analytics.byCompany[company].weightedSov)}`).join(" | ")],
    ["Sentiment leader", shortCompany(analytics.leaders.sentiment), COMPANIES.map((company) => `${shortCompany(company)} ${analytics.byCompany[company].sentimentScore.toFixed(2)}`).join(" | ")],
    ["Biggest risk area", analytics.biggestRiskTopic?.name || "--", analytics.biggestRiskTopic ? `risk score ${analytics.biggestRiskTopic.riskScore.toFixed(1)}` : "--"],
    ["Most visible entity", analytics.visibleEntity?.entity || "--", analytics.visibleEntity ? `${nf.format(analytics.visibleEntity.mentions)} mentions` : "--"]
  ];
  document.querySelector("#decisionSummary").replaceChildren(...rows.map(([label, value, trace]) => {
    const div = document.createElement("div");
    div.className = "decision-item";
    div.innerHTML = `<span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(trace)}</small>`;
    return div;
  }));
}

function renderInsights(analytics) {
  const rows = [
    ["Overall winner by mentions", analytics.leaders.exposure, "share of voice = company mentions / total mentions"],
    ["Overall winner by weighted SOV", analytics.leaders.weighted, "weighted SOV = company weightedExposure / total weightedExposure"],
    ["Sentiment winner", analytics.leaders.sentiment, "sentiment score = (positive mentions - negative mentions) / total mentions"],
    ["Tier 1 media winner", analytics.leaders.tier1, "count of records where sourceTier is Tier 1"],
    ["Biggest topic gap in favor of Novo", analytics.topicGap.novo ? `${analytics.topicGap.novo.topic} (+${nf.format(Math.max(0, analytics.topicGap.novo.delta))})` : "--", "Novo topic mentions minus Lilly topic mentions"],
    ["Biggest topic gap in favor of Lilly", analytics.topicGap.lilly ? `${analytics.topicGap.lilly.topic} (+${nf.format(Math.max(0, analytics.topicGap.lilly.delta))})` : "--", "Lilly topic mentions minus Novo topic mentions"],
    ["Highest-risk topic", analytics.biggestRiskTopic ? `${analytics.biggestRiskTopic.name} (${analytics.biggestRiskTopic.riskScore.toFixed(1)})` : "--", "risk score = mentions + negative x2 + Tier 1 x1.5 + authority / 25"],
    ["Most visible product/molecule", analytics.visibleEntity ? `${analytics.visibleEntity.entity} (${nf.format(analytics.visibleEntity.mentions)})` : "--", "matched keyword or text mention count"],
    ["Most influential source", analytics.influential ? `${analytics.influential.sourceDomain || analytics.influential.source} (${nf.format(analytics.influential.sourceAuthority || 0)} authority)` : "--", "highest sourceAuthority, then weighted exposure"]
  ];
  document.querySelector("#insightsPanel").replaceChildren(...rows.map(([label, value, formula]) => {
    const div = document.createElement("div");
    div.className = "insight";
    div.innerHTML = `<span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(formula)}</small>`;
    return div;
  }));
  document.querySelector("#notableArticles").replaceChildren(...analytics.notable.map((row) => articleItem(row)));
}

function renderKpis(analytics) {
  const lastUpdated = state.metadata.lastUpdated ? new Date(state.metadata.lastUpdated) : null;
  document.querySelector("#kpiNovoMentions").textContent = nf.format(analytics.byCompany["Novo Nordisk"].mentions);
  document.querySelector("#kpiLillyMentions").textContent = nf.format(analytics.byCompany["Eli Lilly"].mentions);
  document.querySelector("#kpiNovoSov").textContent = pf.format(analytics.byCompany["Novo Nordisk"].shareOfVoice);
  document.querySelector("#kpiLillySov").textContent = pf.format(analytics.byCompany["Eli Lilly"].shareOfVoice);
  document.querySelector("#kpiWeightedLeader").textContent = shortCompany(analytics.leaders.weighted);
  document.querySelector("#kpiSentimentLeader").textContent = shortCompany(analytics.leaders.sentiment);
  document.querySelector("#kpiTierLeader").textContent = shortCompany(analytics.leaders.tier1);
  document.querySelector("#kpiRiskLeader").textContent = shortCompany(analytics.leaders.risk);
  document.querySelector("#kpiRefresh").textContent = lastUpdated ? dtf.format(lastUpdated) : "--";
  document.querySelector("#kpiCoverage").textContent = `${state.metadata.coverageStart || "--"} to ${state.metadata.coverageEnd || "--"}`;
}

function renderMetadata() {
  const metadata = state.metadata || {};
  const lastUpdated = metadata.lastUpdated ? new Date(metadata.lastUpdated) : null;
  const metadataCount = Number(metadata.recordCount || 0);
  const mentionsLoaded = state.diagnostics.find((item) => item.key === "mentions")?.status === "loaded";
  const metadataLoaded = state.diagnostics.find((item) => item.key === "metadata")?.status === "loaded";
  const generatedPassed = metadataLoaded && mentionsLoaded && metadataCount === state.mentions.length && state.mentions.length > 0;
  const pathsPassed = state.diagnostics.every((item) => item.path.startsWith("./data/generated/"));
  document.querySelector("#lastUpdated").textContent = lastUpdated ? dtf.format(lastUpdated) : "--";
  document.querySelector("#coverageWindow").textContent = `${metadata.coverageStart || "--"} to ${metadata.coverageEnd || "--"}`;
  document.querySelector("#recordCount").textContent = nf.format(metadata.recordCount || state.mentions.length || 0);
  document.querySelector("#version").textContent = metadata.version || "--";
  document.querySelector("#sourceUsed").textContent = (metadata.sourcesUsed || []).join(", ") || "--";
  document.querySelector("#queryDefinitions").textContent = Object.entries(metadata.queryDefinitions || {}).map(([company, query]) => `${company}: ${query}`).join(" | ") || "--";
  document.querySelector("#sourcesUnavailable").textContent = (metadata.sourcesUnavailable || []).join(", ") || "None";
  document.querySelector("#proxyMetricFields").textContent = (metadata.proxyMetricFields || []).join(", ") || "--";
  document.querySelector("#dedupeMethod").textContent = metadata.deduplicationMethod || "Normalized URL, then title + date + sourceDomain.";
  document.querySelector("#falsePositiveHandling").textContent = metadata.falsePositiveHandling || "Standalone Novo/Lilly matches require GLP-1, obesity, diabetes, or pharma context.";
  document.querySelector("#generatedValidation").textContent = generatedPassed ? "Passed" : "Needs check";
  document.querySelector("#pathValidation").textContent = pathsPassed ? "Passed" : "Needs check";
  document.querySelector("#recordCountCheck").textContent = metadataCount === state.mentions.length ? `Passed (${nf.format(state.mentions.length)})` : `Mismatch: metadata ${nf.format(metadataCount)} vs mentions ${nf.format(state.mentions.length)}`;
  document.querySelector("#projectLinks").innerHTML = `<a href="https://github.com/timkok/important-change-the-dashboard-must-use" target="_blank" rel="noopener noreferrer">GitHub repo</a> | <a href="https://github.com/timkok/important-change-the-dashboard-must-use/actions/workflows/deploy-codex.yml" target="_blank" rel="noopener noreferrer">deploy workflow</a>`;
  const ageHours = lastUpdated ? (Date.now() - lastUpdated.getTime()) / 36e5 : Infinity;
  const badge = document.querySelector("#freshnessBadge");
  badge.textContent = ageHours <= 36 ? "Fresh" : "Needs refresh";
  badge.className = `badge ${ageHours <= 36 ? "good" : "warn"}`;
  document.querySelector("#sourceStatus").replaceChildren(...[
    ...(metadata.sourcesUsed || []).map((name) => sourceRow(name, "Used", true)),
    ...(metadata.sourcesUnavailable || []).map((name) => sourceRow(name, "Unavailable", false))
  ]);
  const warnings = metadata.warnings || [];
  document.querySelector("#warnings").replaceChildren(...(warnings.length ? warnings : ["No warnings in latest metadata."]).map((warning) => {
    const li = document.createElement("li");
    li.textContent = warning;
    return li;
  }));
}

function renderDiagnostics() {
  document.querySelector("#diagnostics").replaceChildren(...state.diagnostics.map((item) => {
    const row = document.createElement("div");
    row.className = `diagnostic ${item.status}`;
    row.innerHTML = `
      <strong>${esc(item.path)}</strong>
      <span>${item.status === "loaded" ? "Loaded" : "Failed"} | records: ${nf.format(item.count)} | ${nf.format(item.ms)} ms</span>
      <span>Last successful load: ${state.lastSuccessfulLoad ? dtf.format(state.lastSuccessfulLoad) : "--"}</span>
      ${item.error ? `<span class="warn-text">${esc(item.error)}</span>` : ""}
    `;
    return row;
  }));
}

function renderTimeline(records) {
  const days = dateSeries(records);
  const series = COMPANIES.map((company) => days.map((date) => records.filter((row) => row.date === date && row.company === company).length));
  lineChart("#timelineChart", days, series, ["Novo", "Lilly"]);
}

function renderSovChart(records) {
  const days = dateSeries(records);
  const rows = days.map((date) => {
    const novo = records.filter((row) => row.date === date && row.company === "Novo Nordisk").length;
    const lilly = records.filter((row) => row.date === date && row.company === "Eli Lilly").length;
    return { date, novo, lilly };
  });
  stackedBars("#sovChart", rows);
}

function renderSentimentChart(records) {
  const sentiments = ["Positive", "Neutral", "Negative"];
  const max = Math.max(1, ...COMPANIES.flatMap((company) => sentiments.map((sentiment) => records.filter((row) => row.company === company && row.sentiment === sentiment).length)));
  const rows = COMPANIES.flatMap((company) => sentiments.map((sentiment) => ({
    name: `${shortCompany(company)} ${sentiment}`,
    count: records.filter((row) => row.company === company && row.sentiment === sentiment).length
  })));
  document.querySelector("#sentimentChart").replaceChildren(...rows.map((row) => barRow(row.name, row.count, max)));
}

function renderEntityBarChart(records) {
  const rows = entityRows(records).filter((row) => row.mentions > 0).sort((a, b) => b.mentions - a.mentions).slice(0, 12);
  if (!rows.length) return emptyInto("#entityBarChart", "No product or molecule mentions in current filters.");
  const max = Math.max(1, ...rows.map((row) => row.mentions));
  document.querySelector("#entityBarChart").replaceChildren(...rows.map((row) => barRow(row.entity, row.mentions, max)));
}

function renderTopicHeatmap(records) {
  const rows = topicRows(records).sort((a, b) => b.total - a.total).slice(0, 14);
  if (!rows.length) return emptyInto("#topicHeatmap", "No topic records available.");
  const max = Math.max(1, ...rows.flatMap((row) => [row.novo, row.lilly]));
  document.querySelector("#topicHeatmap").replaceChildren(...rows.flatMap((row) => [
    heatCell(row.topic, "Novo", row.novo, max),
    heatCell(row.topic, "Lilly", row.lilly, max)
  ]));
}

function renderTopicsTable(records) {
  const rows = topicRows(records);
  rows.sort((a, b) => {
    if (state.topicSort === "topic") return a.topic.localeCompare(b.topic);
    if (state.topicSort === "novo") return b.novo - a.novo;
    if (state.topicSort === "lilly") return b.lilly - a.lilly;
    if (state.topicSort === "sentiment") return a.sentiment - b.sentiment;
    return b.risk - a.risk;
  });
  document.querySelector("#topicTableCount").textContent = `${nf.format(rows.length)} topics`;
  document.querySelector("#topicTable").replaceChildren(...rows.map((row) => tr([
    row.topic,
    nf.format(row.novo),
    nf.format(row.lilly),
    row.leader,
    row.sentiment.toFixed(2),
    row.risk.toFixed(2)
  ])));
}

function renderSourceTable(records) {
  const rows = [...groupBy(records, (row) => row.sourceDomain || row.source || "Unknown").entries()].map(([domain, items]) => ({
    domain,
    total: items.length,
    novo: items.filter((row) => row.company === "Novo Nordisk").length,
    lilly: items.filter((row) => row.company === "Eli Lilly").length,
    tier: mode(items.map((row) => row.sourceTier || "Other")),
    authority: Math.round(items.reduce((sum, row) => sum + Number(row.sourceAuthority || 0), 0) / items.length)
  })).sort((a, b) => b.total - a.total).slice(0, 20);
  document.querySelector("#sourceTable").replaceChildren(...rows.map((row) => tr([row.domain, nf.format(row.total), nf.format(row.novo), nf.format(row.lilly), row.tier, nf.format(row.authority)])));
}

function renderTierSplit(records) {
  const rows = countBy(records, "sourceTier");
  pieChart("#tierSplit", rows);
}

function renderEntityTable(records) {
  const rows = entityRows(records).sort((a, b) => b.mentions - a.mentions);
  document.querySelector("#entityTable").replaceChildren(...rows.map((row) => {
    const latest = row.latestArticle;
    return tr([
      row.entity,
      row.family,
      nf.format(row.mentions),
      row.sentiment.toFixed(2),
      row.topTopic,
      row.tierSplit,
      latest ? `${latest.date} | ${latest.sourceDomain || latest.source} | ${latest.title}` : "--"
    ]);
  }));
}

function renderRiskMonitor(records) {
  const rows = riskAreas(records);
  document.querySelector("#riskCards").replaceChildren(...rows.map((area) => {
    const div = document.createElement("article");
    div.className = "risk-card";
    div.innerHTML = `
      <h3>${esc(area.name)}</h3>
      <strong>${area.riskScore.toFixed(1)}</strong>
      <dl>
        <div><dt>Total mentions</dt><dd>${nf.format(area.total)}</dd></div>
        <div><dt>Company split</dt><dd>Novo ${nf.format(area.novo)} | Lilly ${nf.format(area.lilly)}</dd></div>
        <div><dt>Negative</dt><dd>${nf.format(area.negative)}</dd></div>
        <div><dt>Tier 1</dt><dd>${nf.format(area.tier1)}</dd></div>
      </dl>
      <p><b>Newest:</b> ${area.newest ? esc(`${area.newest.date} | ${area.newest.title}`) : "--"}</p>
      <p><b>Highest authority:</b> ${area.highAuthority ? esc(`${area.highAuthority.sourceAuthority} | ${area.highAuthority.title}`) : "--"}</p>
    `;
    return div;
  }));
}

function renderAlerts() {
  if (!state.alerts.length) return emptyInto("#alerts", "No alerts generated.");
  document.querySelector("#alerts").replaceChildren(...state.alerts.map((alert) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<strong>${esc(alert.title)}</strong><span>${esc(alert.company)}: ${esc(alert.message)}</span>`;
    return div;
  }));
}

function renderTable(records) {
  const table = document.querySelector("#mentionsTable");
  const maxPage = Math.max(1, Math.ceil(records.length / state.pageSize));
  state.page = Math.min(state.page, maxPage);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = records.slice(start, start + state.pageSize);
  document.querySelector("#visibleCount").textContent = `${nf.format(records.length)} records`;
  document.querySelector("#pageStatus").textContent = `Page ${nf.format(state.page)} of ${nf.format(maxPage)}`;
  document.querySelector("#prevPage").disabled = state.page <= 1;
  document.querySelector("#nextPage").disabled = state.page >= maxPage;
  if (!records.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8">No real media records match the current filters.</td>`;
    table.replaceChildren(row);
    return;
  }
  table.replaceChildren(...pageRows.map((item, index) => {
    const absoluteIndex = start + index;
    const row = document.createElement("tr");
    row.className = state.selectedId === item.id ? "selected-row" : "";
    const title = item.url
      ? `<a href="${attr(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title || item.url)}</a>`
      : esc(item.title || "Untitled");
    row.innerHTML = `
      <td>${esc(item.date)}</td>
      <td>${esc(item.company)}</td>
      <td>${esc(item.topic)}</td>
      <td>${esc(item.sourceDomain || item.source)}<br><span>${esc(item.rawSource)} | ${esc(item.sourceTier)}</span></td>
      <td class="title-cell">${title}<br><span>${esc((item.matchedKeywords || []).join(", "))}</span></td>
      <td><strong class="${esc(item.sentiment)}">${esc(item.sentiment)}</strong><br><span>${Number(item.sentimentScore || 0).toFixed(2)}</span></td>
      <td>${nf.format(item.reach || 0)} reach<br><span>${nf.format(item.sourceAuthority || 0)} authority</span></td>
      <td><button type="button" class="detail-button" data-index="${absoluteIndex}">Open</button></td>
    `;
    row.addEventListener("click", () => {
      state.selectedId = item.id;
      showArticle(item);
      renderTable(records);
    });
    return row;
  }));
  table.querySelectorAll(".detail-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const item = records[Number(button.dataset.index)];
      state.selectedId = item.id;
      showArticle(item);
      renderTable(records);
    });
  });
}

function showArticle(item) {
  const drawer = document.querySelector("#articleDrawer");
  drawer.hidden = false;
  drawer.innerHTML = `
    <button type="button" class="drawer-close" aria-label="Close detail">Close</button>
    <h2>${esc(item.title || "Untitled")}</h2>
    <p>${esc(item.snippet || "No snippet available.")}</p>
    <div class="table-actions">
      ${item.url ? `<a class="button-link" href="${attr(item.url)}" target="_blank" rel="noopener noreferrer">Open article</a>` : ""}
      <button type="button" id="copyArticleUrl">Copy article URL</button>
    </div>
    <dl class="status-list">
      <div><dt>Date</dt><dd>${esc(item.date)}</dd></div>
      <div><dt>Company</dt><dd>${esc(item.company)}</dd></div>
      <div><dt>Source</dt><dd>${esc(item.sourceDomain || item.source)}</dd></div>
      <div><dt>Topic</dt><dd>${esc(item.topic)}</dd></div>
      <div><dt>Raw source</dt><dd>${esc(item.rawSource)}</dd></div>
      <div><dt>Data quality notes</dt><dd>${esc((item.dataQualityNotes || []).join(" | ") || "--")}</dd></div>
    </dl>
  `;
  drawer.querySelector(".drawer-close").addEventListener("click", () => {
    drawer.hidden = true;
  });
  drawer.querySelector("#copyArticleUrl").addEventListener("click", async () => {
    if (navigator.clipboard && item.url) await navigator.clipboard.writeText(item.url);
  });
}

function exportFilteredCsv() {
  const rows = filteredMentions();
  const columns = ["date", "company", "channel", "source", "sourceDomain", "title", "snippet", "url", "topic", "sentiment", "sentimentScore", "reach", "engagement", "sourceAuthority", "sourceTier", "rawSource", "matchedKeywords"];
  const csv = [columns.join(",")].concat(rows.map((row) => columns.map((column) => csvValue(column === "matchedKeywords" ? (row[column] || []).join("|") : row[column])).join(","))).join("\n");
  downloadBlob(csv, "filtered-media-mentions.csv", "text/csv;charset=utf-8");
}

function exportFilteredJson() {
  downloadBlob(JSON.stringify(filteredMentions(), null, 2), "filtered-media-mentions.json", "application/json;charset=utf-8");
}

function dateSeries(records) {
  return [...new Set(records.map((row) => row.date).filter(Boolean))].sort();
}

function topicRows(records) {
  return [...groupBy(records, (row) => row.topic || "Other").entries()].map(([topic, items]) => {
    const novo = items.filter((row) => row.company === "Novo Nordisk").length;
    const lilly = items.filter((row) => row.company === "Eli Lilly").length;
    const sentiment = items.reduce((sum, row) => sum + Number(row.sentimentScore || 0), 0) / items.length;
    const risk = items.filter((row) => row.sentiment === "Negative").length + (RISK_TOPICS.includes(topic) ? items.length * 0.5 : 0);
    return { topic, total: items.length, novo, lilly, leader: novo === lilly ? "Tie" : novo > lilly ? "Novo Nordisk" : "Eli Lilly", sentiment, risk };
  });
}

function entityRows(records) {
  return ENTITIES.map((entity) => {
    const items = records.filter((row) => mentionsEntity(row, entity));
    const tiers = countBy(items, "sourceTier").map((row) => `${row.name} ${row.count}`).join(" | ") || "--";
    const topTopic = countBy(items, "topic")[0]?.name || "--";
    const sentiment = items.length ? items.reduce((sum, row) => sum + Number(row.sentimentScore || 0), 0) / items.length : 0;
    return {
      entity,
      family: NOVO_ENTITIES.includes(entity) ? "Novo" : "Lilly",
      mentions: items.length,
      sentiment,
      topTopic,
      tierSplit: tiers,
      latestArticle: [...items].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0]
    };
  });
}

function mentionsEntity(row, entity) {
  const needle = entity.toLowerCase();
  const keywords = (row.matchedKeywords || []).join(" ").toLowerCase();
  const text = [row.title, row.snippet, row.matchedEntity, keywords].join(" ").toLowerCase();
  return text.includes(needle);
}

function riskAreas(records) {
  return RISK_AREAS.map((area) => {
    const items = records.filter((row) => riskMatch(row, area));
    const negative = items.filter((row) => row.sentiment === "Negative").length;
    const tier1 = items.filter((row) => row.sourceTier === "Tier 1").length;
    const highestAuthority = Math.max(0, ...items.map((row) => Number(row.sourceAuthority || 0)));
    const riskScore = items.length + negative * 2 + tier1 * 1.5 + highestAuthority / 25;
    return {
      name: area.name,
      total: items.length,
      novo: items.filter((row) => row.company === "Novo Nordisk").length,
      lilly: items.filter((row) => row.company === "Eli Lilly").length,
      negative,
      tier1,
      riskScore,
      newest: [...items].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0],
      highAuthority: [...items].sort((a, b) => Number(b.sourceAuthority || 0) - Number(a.sourceAuthority || 0))[0]
    };
  });
}

function riskMatch(row, area) {
  const text = [row.topic, row.title, row.snippet, ...(row.matchedKeywords || [])].join(" ").toLowerCase();
  return area.topics.includes(row.topic) || area.terms.some((term) => text.includes(term));
}

function notableArticles(records) {
  const now = Date.now();
  return [...records].sort((a, b) => notableScore(b, now) - notableScore(a, now)).slice(0, 3);
}

function notableScore(row, now) {
  const ageDays = row.date ? Math.max(0, (now - new Date(`${row.date}T00:00:00Z`).getTime()) / 864e5) : 90;
  return Number(row.sourceAuthority || 0) + Math.max(0, 30 - ageDays);
}

function lineChart(selector, labels, series, names) {
  const target = document.querySelector(selector);
  if (!labels.length) return emptyInto(selector, "No records available for the selected filters.");
  const width = 720;
  const height = 260;
  const pad = 34;
  const max = Math.max(1, ...series.flat());
  const colors = ["#176b87", "#6f5bb8"];
  const x = (index) => pad + (labels.length === 1 ? 0 : index * (width - pad * 2) / (labels.length - 1));
  const y = (value) => height - pad - value * (height - pad * 2) / max;
  const paths = series.map((values, sIndex) => `<path d="${values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ")}" fill="none" stroke="${colors[sIndex]}" stroke-width="3" />`).join("");
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img">
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#dce4ee" />
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#dce4ee" />
    ${paths}
    ${names.map((name, index) => `<text x="${pad + index * 100}" y="20" fill="${colors[index]}" font-size="13" font-weight="700">${esc(name)}</text>`).join("")}
    <text x="${pad}" y="${height - 8}" font-size="11" fill="#657386">${esc(formatDate(labels[0]))}</text>
    <text x="${width - pad - 70}" y="${height - 8}" font-size="11" fill="#657386">${esc(formatDate(labels.at(-1)))}</text>
  </svg>`;
}

function stackedBars(selector, rows) {
  const target = document.querySelector(selector);
  if (!rows.length) return emptyInto(selector, "No share-of-voice records available.");
  const width = 420;
  const height = 220;
  const barWidth = Math.max(2, (width - 40) / rows.length);
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img">
    ${rows.map((row, index) => {
      const total = Math.max(1, row.novo + row.lilly);
      const novoHeight = (row.novo / total) * 160;
      const lillyHeight = (row.lilly / total) * 160;
      const x = 20 + index * barWidth;
      const yNovo = height - 30 - novoHeight;
      const yLilly = yNovo - lillyHeight;
      return `<rect x="${x}" y="${yNovo}" width="${Math.max(1, barWidth - 1)}" height="${novoHeight}" fill="#176b87"><title>${row.date} Novo ${row.novo}</title></rect><rect x="${x}" y="${yLilly}" width="${Math.max(1, barWidth - 1)}" height="${lillyHeight}" fill="#6f5bb8"><title>${row.date} Lilly ${row.lilly}</title></rect>`;
    }).join("")}
    <text x="20" y="18" fill="#176b87" font-size="12" font-weight="700">Novo</text>
    <text x="82" y="18" fill="#6f5bb8" font-size="12" font-weight="700">Lilly</text>
  </svg>`;
}

function pieChart(selector, rows) {
  const target = document.querySelector(selector);
  if (!rows.length) return emptyInto(selector, "No source tier records available.");
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const colors = ["#176b87", "#6f5bb8", "#157f4f", "#a45d00", "#b42318"];
  let cursor = 0;
  const bars = rows.map((row, index) => {
    const width = (row.count / total) * 100;
    const x = cursor;
    cursor += width;
    return `<rect x="${x}" y="42" width="${width}" height="42" fill="${colors[index % colors.length]}"><title>${esc(row.name)} ${row.count}</title></rect>`;
  }).join("");
  target.innerHTML = `<svg viewBox="0 0 100 120" preserveAspectRatio="none">${bars}</svg><div class="legend">${rows.map((row, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${esc(row.name)} ${nf.format(row.count)}</span>`).join("")}</div>`;
}

function heatCell(topic, company, value, max) {
  const cell = document.createElement("div");
  cell.className = "heat-cell";
  cell.style.setProperty("--intensity", String(Math.max(0.08, value / max)));
  cell.innerHTML = `<strong>${esc(topic)}</strong><span>${esc(company)} | ${nf.format(value)}</span>`;
  return cell;
}

function countBy(records, key) {
  const counts = new Map();
  records.forEach((row) => counts.set(row[key] || "Other", (counts.get(row[key] || "Other") || 0) + 1));
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function groupBy(records, getKey) {
  const grouped = new Map();
  records.forEach((row) => {
    const key = getKey(row);
    grouped.set(key, [...(grouped.get(key) || []), row]);
  });
  return grouped;
}

function mode(values) {
  return countBy(values.map((value) => ({ value })), "value")[0]?.name || "--";
}

function barRow(name, count, max) {
  const row = document.createElement("div");
  row.className = "bar-row";
  row.innerHTML = `<div><strong>${esc(name)}</strong><span>${nf.format(count)}</span></div><i style="--w:${Math.max(3, (count / max) * 100)}%"></i>`;
  return row;
}

function sourceRow(name, status, good) {
  const row = document.createElement("div");
  row.className = "item";
  row.innerHTML = `<strong>${esc(name)}</strong><span class="${good ? "good-text" : "warn-text"}">${esc(status)}</span>`;
  return row;
}

function articleItem(row) {
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `<strong>${esc(row.sourceDomain || row.source)} | ${esc(row.date)}</strong><span>${esc(row.title || "Untitled")}</span><span>Authority ${nf.format(row.sourceAuthority || 0)} | ${esc(row.company)} | ${esc(row.topic)}</span>`;
  return div;
}

function metricItem(label, value) {
  const item = document.createElement("div");
  item.className = "metric-item";
  item.innerHTML = `<span>${esc(label)}</span><strong>${esc(value)}</strong>`;
  return item;
}

function tr(values) {
  const row = document.createElement("tr");
  row.innerHTML = values.map((value) => `<td>${esc(value)}</td>`).join("");
  return row;
}

function emptyInto(selector, text) {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  document.querySelector(selector).replaceChildren(p);
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function shortCompany(value) {
  if (value === "Novo Nordisk") return "Novo";
  if (value === "Eli Lilly") return "Lilly";
  return value || "--";
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : shortDate.format(date);
}

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function attr(value) {
  return esc(value).replace(/`/g, "&#096;");
}

init();
