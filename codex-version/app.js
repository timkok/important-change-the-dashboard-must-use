const DATA_PATHS = {
  mentions: "./data/generated/mentions.json",
  dailyCounts: "./data/generated/daily_counts.json",
  sourceSummary: "./data/generated/source_summary.json",
  topicSummary: "./data/generated/topic_summary.json",
  alerts: "./data/generated/alerts.json",
  metadata: "./data/generated/metadata.json"
};

const state = {
  mentions: [],
  dailyCounts: [],
  sourceSummary: [],
  topicSummary: [],
  alerts: [],
  metadata: {},
  filters: { company: "All", topic: "All", search: "" }
};

const nf = new Intl.NumberFormat("en-US");
const dtf = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

async function init() {
  try {
    const [mentions, dailyCounts, sourceSummary, topicSummary, alerts, metadata] = await Promise.all([
      loadJson(DATA_PATHS.mentions),
      loadJson(DATA_PATHS.dailyCounts),
      loadJson(DATA_PATHS.sourceSummary),
      loadJson(DATA_PATHS.topicSummary),
      loadJson(DATA_PATHS.alerts),
      loadJson(DATA_PATHS.metadata)
    ]);
    Object.assign(state, { mentions, dailyCounts, sourceSummary, topicSummary, alerts, metadata });
    document.querySelector("#app").hidden = false;
    bindControls();
    render();
  } catch (error) {
    console.warn("Generated data files failed to load", error);
    document.querySelector("#loadError").hidden = false;
  }
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

  const topicFilter = document.querySelector("#topicFilter");
  [...new Set(state.mentions.map((row) => row.topic).filter(Boolean))].sort().forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    topicFilter.append(option);
  });

  document.querySelector("#companyFilter").addEventListener("change", (event) => {
    state.filters.company = event.target.value;
    render();
  });
  topicFilter.addEventListener("change", (event) => {
    state.filters.topic = event.target.value;
    render();
  });
  document.querySelector("#searchInput").addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    render();
  });
}

function filteredMentions() {
  return state.mentions.filter((row) => {
    if (state.filters.company !== "All" && row.company !== state.filters.company) return false;
    if (state.filters.topic !== "All" && row.topic !== state.filters.topic) return false;
    if (!state.filters.search) return true;
    return [row.title, row.source, row.sourceDomain, row.topic, row.company, ...(row.matchedKeywords || [])]
      .join(" ")
      .toLowerCase()
      .includes(state.filters.search);
  });
}

function render() {
  const records = filteredMentions();
  renderMetadata();
  renderKpis(records);
  renderTimeline(records);
  renderTopics(records);
  renderSources(records);
  renderAlerts();
  renderTable(records);
  document.querySelector("#zeroState").hidden = state.mentions.length !== 0;
}

function renderMetadata() {
  const metadata = state.metadata;
  const lastUpdated = metadata.lastUpdated ? new Date(metadata.lastUpdated) : null;
  document.querySelector("#lastUpdated").textContent = lastUpdated ? dtf.format(lastUpdated) : "--";
  document.querySelector("#coverageWindow").textContent = `${metadata.coverageStart || "--"} to ${metadata.coverageEnd || "--"}`;
  document.querySelector("#recordCount").textContent = nf.format(metadata.recordCount || 0);
  document.querySelector("#version").textContent = metadata.version || "--";
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

function renderKpis(records) {
  const reach = records.reduce((sum, row) => sum + Number(row.reach || 0), 0);
  const engagement = records.reduce((sum, row) => sum + Number(row.engagement || 0), 0);
  const sentiment = records.length ? records.reduce((sum, row) => sum + Number(row.sentimentScore || 0), 0) / records.length : 0;
  document.querySelector("#kpiMentions").textContent = nf.format(records.length);
  document.querySelector("#kpiReach").textContent = nf.format(reach);
  document.querySelector("#kpiEngagement").textContent = nf.format(engagement);
  document.querySelector("#kpiSentiment").textContent = sentiment.toFixed(2);
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

function renderTopics(records) {
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
  if (!records.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7">No real media records are present in the generated dataset. Check the Data Quality tab for source status and warnings.</td>`;
    document.querySelector("#mentionsTable").replaceChildren(row);
    return;
  }
  document.querySelector("#mentionsTable").replaceChildren(...records.slice(0, 250).map((item) => {
    const row = document.createElement("tr");
    const title = item.url
      ? `<a href="${attr(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title || item.url)}</a>`
      : esc(item.title || "Untitled");
    row.innerHTML = `
      <td>${esc(item.date)}</td>
      <td>${esc(item.company)}</td>
      <td>${esc(item.topic)}</td>
      <td>${esc(item.sourceDomain || item.source)}<br><span>${esc(item.rawSource)}</span></td>
      <td class="title-cell">${title}<br><span>${esc((item.matchedKeywords || []).join(", "))}</span></td>
      <td><strong class="${esc(item.sentiment)}">${esc(item.sentiment)}</strong><br><span>${Number(item.sentimentScore || 0).toFixed(2)}</span></td>
      <td>${nf.format(item.reach || 0)} reach<br><span>${item.isProxyMetrics ? "Proxy metrics" : "Imported metrics"}</span></td>
    `;
    return row;
  }));
}

function countBy(records, key) {
  const counts = new Map();
  records.forEach((row) => counts.set(row[key] || "Other", (counts.get(row[key] || "Other") || 0) + 1));
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
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

function emptyInto(selector, text) {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  document.querySelector(selector).replaceChildren(p);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function attr(value) {
  return esc(value).replace(/`/g, "&#096;");
}

init();
