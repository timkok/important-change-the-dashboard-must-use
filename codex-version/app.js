const DATA_PATHS = {
  metadata: "./data/generated/metadata.json",
  mentions: "./data/generated/mentions.json",
  dailyCounts: "./data/generated/daily_counts.json",
  sourceSummary: "./data/generated/source_summary.json",
  topicSummary: "./data/generated/topic_summary.json",
  alerts: "./data/generated/alerts.json"
};

const COMPANIES = ["Novo Nordisk", "Eli Lilly"];
const RISK_TOPICS = ["Side effects / safety", "Supply shortage", "Drug pricing / insurance / access", "Legal / regulatory"];

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
  filters: {
    company: "All",
    topic: "All",
    sentiment: "All",
    tier: "All",
    rawSource: "All",
    search: "",
    quick: null,
    sort: "date"
  }
};

const nf = new Intl.NumberFormat("en-US");
const pf = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const dtf = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

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

  const usable = Array.isArray(state.mentions) && state.mentions.length > 0;
  if (usable) {
    state.lastSuccessfulLoad = new Date();
    document.querySelector("#loadError").hidden = true;
  } else {
    document.querySelector("#loadError").hidden = false;
  }

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

  const controls = [
    ["#companyFilter", "company"],
    ["#topicFilter", "topic"],
    ["#sentimentFilter", "sentiment"],
    ["#tierFilter", "tier"],
    ["#rawSourceFilter", "rawSource"],
    ["#sortSelect", "sort"]
  ];
  controls.forEach(([selector, key]) => {
    document.querySelector(selector).addEventListener("change", (event) => {
      state.filters[key] = event.target.value;
      render();
    });
  });
  document.querySelector("#searchInput").addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    render();
  });
  document.querySelectorAll(".quick-filter").forEach((button) => {
    button.addEventListener("click", () => {
      state.filters.quick = state.filters.quick === button.dataset.filter ? null : button.dataset.filter;
      document.querySelectorAll(".quick-filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === state.filters.quick));
      render();
    });
  });
  document.querySelector("#clearFilters").addEventListener("click", () => {
    Object.assign(state.filters, { company: "All", topic: "All", sentiment: "All", tier: "All", rawSource: "All", search: "", quick: null, sort: "date" });
    ["companyFilter", "topicFilter", "sentimentFilter", "tierFilter", "rawSourceFilter", "sortSelect"].forEach((id) => {
      document.getElementById(id).value = state.filters[id.replace("Filter", "").replace("Select", "")] || "date";
    });
    document.querySelector("#searchInput").value = "";
    document.querySelectorAll(".quick-filter").forEach((item) => item.classList.remove("active"));
    render();
  });
  document.querySelectorAll(".sort-topic").forEach((button) => {
    button.addEventListener("click", () => {
      state.topicSort = button.dataset.sort;
      renderTopicsTable(filteredMentions());
    });
  });
  document.querySelector("#exportCsv").addEventListener("click", exportFilteredCsv);
}

function populateFilters() {
  fillSelect("#topicFilter", unique("topic"));
  fillSelect("#tierFilter", unique("sourceTier"));
  fillSelect("#rawSourceFilter", unique("rawSource"));
}

function fillSelect(selector, values) {
  const select = document.querySelector(selector);
  select.append(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  }));
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
  renderMetadata();
  renderDiagnostics();
  renderExecutive(analytics);
  renderKpis(analytics);
  renderTimeline(records);
  renderTopicBars(records);
  renderSources(records);
  renderTopicMatrix(records);
  renderTopicsTable(records);
  renderSourceTable(records);
  renderTierSplit(records);
  renderAlerts();
  renderTable(records);
  document.querySelector("#zeroState").hidden = state.mentions.length !== 0;
}

function buildAnalytics(records) {
  const maxReach = Math.max(1, ...records.map((row) => Number(row.reach || 0)));
  const maxEngagement = Math.max(1, ...records.map((row) => Number(row.engagement || 0)));
  const maxAuthority = Math.max(1, ...records.map((row) => Number(row.sourceAuthority || 0)));
  const now = Date.now();
  const weightedRecords = records.map((row) => {
    const ageDays = row.date ? Math.max(0, (now - new Date(`${row.date}T00:00:00Z`).getTime()) / 864e5) : 90;
    const recencyWeight = Math.max(0, 1 - ageDays / 90);
    const weightedExposure = 1
      + (Number(row.reach || 0) / maxReach) * 0.35
      + (Number(row.engagement || 0) / maxEngagement) * 0.25
      + (Number(row.sourceAuthority || 0) / maxAuthority) * 0.25
      + recencyWeight * 0.15;
    return { ...row, weightedExposure };
  });
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
  const leaders = {
    exposure: leaderBy(byCompany, "mentions"),
    weighted: leaderBy(byCompany, "weightedSov"),
    sentiment: leaderBy(byCompany, "sentimentScore"),
    tier1: leaderBy(byCompany, "tier1"),
    risk: leaderBy(byCompany, "risk")
  };
  const biggestRiskTopic = topicRows(weightedRecords).sort((a, b) => b.risk - a.risk)[0];
  const influential = [...weightedRecords].sort((a, b) => Number(b.sourceAuthority || 0) - Number(a.sourceAuthority || 0) || b.weightedExposure - a.weightedExposure)[0];
  return { totalMentions, totalWeighted, byCompany, leaders, biggestRiskTopic, influential };
}

function leaderBy(byCompany, metric) {
  const [first, second] = COMPANIES;
  const delta = Number(byCompany[first][metric] || 0) - Number(byCompany[second][metric] || 0);
  if (Math.abs(delta) < 0.0001) return "Tie";
  return delta > 0 ? first : second;
}

function renderExecutive(analytics) {
  const metaCount = Number(state.metadata.recordCount || state.mentions.length);
  const caveats = [
    `Dataset loaded: ${nf.format(state.mentions.length)} records; metadata recordCount: ${nf.format(metaCount)}.`,
    "GDELT-only baseline unless CSV imports are added.",
    "Reach, engagement, and sourceAuthority are proxy metrics for GDELT records."
  ];
  const rows = [
    ["Overall exposure leader", analytics.leaders.exposure],
    ["Total mentions by company", COMPANIES.map((company) => `${company}: ${nf.format(analytics.byCompany[company].mentions)}`).join(" · ")],
    ["Share of voice by company", COMPANIES.map((company) => `${shortCompany(company)} ${pf.format(analytics.byCompany[company].shareOfVoice)}`).join(" · ")],
    ["Weighted share of voice by company", COMPANIES.map((company) => `${shortCompany(company)} ${pf.format(analytics.byCompany[company].weightedSov)}`).join(" · ")],
    ["Sentiment score by company", COMPANIES.map((company) => `${shortCompany(company)} ${analytics.byCompany[company].sentimentScore.toFixed(2)}`).join(" · ")],
    ["Tier 1 media mentions by company", COMPANIES.map((company) => `${shortCompany(company)} ${nf.format(analytics.byCompany[company].tier1)}`).join(" · ")],
    ["Top topic for Novo", analytics.byCompany["Novo Nordisk"].topTopic],
    ["Top topic for Lilly", analytics.byCompany["Eli Lilly"].topTopic],
    ["Biggest risk topic overall", analytics.biggestRiskTopic ? `${analytics.biggestRiskTopic.topic} (${nf.format(analytics.biggestRiskTopic.risk)})` : "--"],
    ["Most influential source/article", analytics.influential ? `${analytics.influential.sourceDomain || analytics.influential.source}: ${analytics.influential.title}` : "--"],
    ["Data caveat summary", caveats.join(" ")]
  ];
  document.querySelector("#leaderPanel").replaceChildren(...rows.map(([label, value]) => metricItem(label, value)));
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
  const badge = document.querySelector("#freshnessBadge");
  const ageHours = lastUpdated ? (Date.now() - lastUpdated.getTime()) / 36e5 : Infinity;
  badge.textContent = ageHours <= 36 ? "Fresh" : "Needs refresh";
  badge.className = `badge ${ageHours <= 36 ? "good" : "warn"}`;
  document.querySelector("#sourceStatus").replaceChildren(...[
    ...(metadata.sourcesUsed || []).map((name) => sourceRow(name, "Used", true)),
    ...(metadata.sourcesUnavailable || []).map((name) => sourceRow(name, "Unavailable", false))
  ]);
  document.querySelector("#warnings").replaceChildren(...(metadata.warnings || []).map((warning) => {
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
      <span>${item.status === "loaded" ? "Loaded" : "Failed"} · records: ${nf.format(item.count)} · ${nf.format(item.ms)} ms</span>
      <span>Last successful load: ${state.lastSuccessfulLoad ? dtf.format(state.lastSuccessfulLoad) : "--"}</span>
      ${item.error ? `<span class="warn-text">${esc(item.error)}</span>` : ""}
    `;
    return row;
  }));
}

function renderTimeline(records) {
  const counts = new Map();
  records.forEach((row) => counts.set(row.date, (counts.get(row.date) || 0) + 1));
  const dates = [...new Set(state.dailyCounts.map((row) => row.date))].sort();
  const max = Math.max(1, ...dates.map((date) => counts.get(date) || 0));
  document.querySelector("#timelineChart").replaceChildren(...dates.map((date) => {
    const bar = document.createElement("div");
    bar.className = "timeline-bar";
    bar.style.height = `${Math.max(2, ((counts.get(date) || 0) / max) * 220)}px`;
    bar.title = `${date}: ${counts.get(date) || 0} mentions`;
    return bar;
  }));
}

function renderTopicBars(records) {
  const rows = countBy(records, "topic").slice(0, 12);
  if (!rows.length) return emptyInto("#topicChart", "No topic records available from generated real data.");
  const max = Math.max(...rows.map((row) => row.count));
  document.querySelector("#topicChart").replaceChildren(...rows.map((row) => barRow(row.name, row.count, max)));
}

function renderSources(records) {
  const rows = countBy(records, "sourceDomain").slice(0, 10);
  if (!rows.length) return emptyInto("#sourceSummary", "No source records available from generated real data.");
  document.querySelector("#sourceSummary").replaceChildren(...rows.map((row) => sourceRow(row.name || "Unknown", `${nf.format(row.count)} mentions`, true)));
}

function renderTopicMatrix(records) {
  const rows = topicRows(records).sort((a, b) => b.total - a.total).slice(0, 12);
  if (!rows.length) return emptyInto("#topicMatrix", "No topic records available.");
  const max = Math.max(...rows.map((row) => row.total));
  document.querySelector("#topicMatrix").replaceChildren(...rows.map((row) => {
    const div = document.createElement("div");
    div.className = "matrix-row";
    div.innerHTML = `
      <strong>${esc(row.topic)}</strong>
      <span>Novo ${nf.format(row.novo)} · Lilly ${nf.format(row.lilly)}</span>
      <i style="--novo:${(row.novo / max) * 100}%; --lilly:${(row.lilly / max) * 100}%"></i>
    `;
    return div;
  }));
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
  document.querySelector("#topicTable").replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(row.topic)}</td>
      <td>${nf.format(row.novo)}</td>
      <td>${nf.format(row.lilly)}</td>
      <td>${esc(row.leader)}</td>
      <td>${row.sentiment.toFixed(2)}</td>
      <td>${row.risk.toFixed(2)}</td>
    `;
    return tr;
  }));
}

function renderSourceTable(records) {
  const grouped = groupBy(records, (row) => row.sourceDomain || row.source || "Unknown");
  const rows = [...grouped.entries()].map(([domain, items]) => ({
    domain,
    total: items.length,
    novo: items.filter((row) => row.company === "Novo Nordisk").length,
    lilly: items.filter((row) => row.company === "Eli Lilly").length,
    tier: mode(items.map((row) => row.sourceTier || "Other")),
    authority: Math.round(items.reduce((sum, row) => sum + Number(row.sourceAuthority || 0), 0) / items.length)
  })).sort((a, b) => b.total - a.total).slice(0, 20);
  document.querySelector("#sourceTable").replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(row.domain)}</td>
      <td>${nf.format(row.total)}</td>
      <td>${nf.format(row.novo)}</td>
      <td>${nf.format(row.lilly)}</td>
      <td>${esc(row.tier)}</td>
      <td>${nf.format(row.authority)}</td>
    `;
    return tr;
  }));
}

function renderTierSplit(records) {
  const rows = countBy(records, "sourceTier");
  if (!rows.length) return emptyInto("#tierSplit", "No source tier records available.");
  const max = Math.max(...rows.map((row) => row.count));
  document.querySelector("#tierSplit").replaceChildren(...rows.map((row) => barRow(row.name, row.count, max)));
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
  document.querySelector("#visibleCount").textContent = `${nf.format(records.length)} records`;
  const table = document.querySelector("#mentionsTable");
  if (!records.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8">No real media records match the current filters.</td>`;
    table.replaceChildren(row);
    return;
  }
  table.replaceChildren(...records.slice(0, 500).map((item, index) => {
    const row = document.createElement("tr");
    const title = item.url
      ? `<a href="${attr(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title || item.url)}</a>`
      : esc(item.title || "Untitled");
    row.innerHTML = `
      <td>${esc(item.date)}</td>
      <td>${esc(item.company)}</td>
      <td>${esc(item.topic)}</td>
      <td>${esc(item.sourceDomain || item.source)}<br><span>${esc(item.rawSource)} · ${esc(item.sourceTier)}</span></td>
      <td class="title-cell">${title}<br><span>${esc((item.matchedKeywords || []).join(", "))}</span></td>
      <td><strong class="${esc(item.sentiment)}">${esc(item.sentiment)}</strong><br><span>${Number(item.sentimentScore || 0).toFixed(2)}</span></td>
      <td>${nf.format(item.reach || 0)} reach<br><span>${nf.format(item.sourceAuthority || 0)} authority</span></td>
      <td><button type="button" class="detail-button" data-index="${index}">Open</button></td>
    `;
    return row;
  }));
  table.querySelectorAll(".detail-button").forEach((button) => {
    button.addEventListener("click", () => showArticle(records[Number(button.dataset.index)]));
  });
}

function showArticle(item) {
  const drawer = document.querySelector("#articleDrawer");
  drawer.hidden = false;
  drawer.innerHTML = `
    <button type="button" class="drawer-close" aria-label="Close detail">Close</button>
    <h2>${esc(item.title || "Untitled")}</h2>
    <p>${esc(item.snippet || "No snippet available.")}</p>
    <dl class="status-list">
      <div><dt>Date</dt><dd>${esc(item.date)}</dd></div>
      <div><dt>Company</dt><dd>${esc(item.company)}</dd></div>
      <div><dt>Source</dt><dd>${esc(item.sourceDomain || item.source)}</dd></div>
      <div><dt>Topic</dt><dd>${esc(item.topic)}</dd></div>
      <div><dt>Raw source</dt><dd>${esc(item.rawSource)}</dd></div>
      <div><dt>Matched keywords</dt><dd>${esc((item.matchedKeywords || []).join(", ") || "--")}</dd></div>
    </dl>
    ${item.url ? `<p><a href="${attr(item.url)}" target="_blank" rel="noopener noreferrer">Open external article</a></p>` : ""}
  `;
  drawer.querySelector(".drawer-close").addEventListener("click", () => {
    drawer.hidden = true;
  });
}

function exportFilteredCsv() {
  const rows = filteredMentions();
  const columns = ["date", "company", "channel", "source", "sourceDomain", "title", "snippet", "url", "topic", "sentiment", "sentimentScore", "reach", "engagement", "sourceAuthority", "sourceTier", "rawSource", "matchedKeywords"];
  const csv = [columns.join(",")].concat(rows.map((row) => columns.map((column) => csvValue(column === "matchedKeywords" ? (row[column] || []).join("|") : row[column])).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "filtered-media-mentions.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function topicRows(records) {
  const grouped = groupBy(records, (row) => row.topic || "Other");
  return [...grouped.entries()].map(([topic, items]) => {
    const novo = items.filter((row) => row.company === "Novo Nordisk").length;
    const lilly = items.filter((row) => row.company === "Eli Lilly").length;
    const sentiment = items.reduce((sum, row) => sum + Number(row.sentimentScore || 0), 0) / items.length;
    const risk = items.filter((row) => row.sentiment === "Negative").length + (RISK_TOPICS.includes(topic) ? items.length * 0.5 : 0);
    return { topic, total: items.length, novo, lilly, leader: novo === lilly ? "Tie" : novo > lilly ? "Novo Nordisk" : "Eli Lilly", sentiment, risk };
  });
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

function metricItem(label, value) {
  const item = document.createElement("div");
  item.className = "metric-item";
  item.innerHTML = `<span>${esc(label)}</span><strong>${esc(value)}</strong>`;
  return item;
}

function emptyInto(selector, text) {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  document.querySelector(selector).replaceChildren(p);
}

function shortCompany(value) {
  if (value === "Novo Nordisk") return "Novo";
  if (value === "Eli Lilly") return "Lilly";
  return value || "--";
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
