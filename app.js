const FILES = {
  mentions: "data/generated/mentions.json",
  dailyCounts: "data/generated/daily_counts.json",
  sourceSummary: "data/generated/source_summary.json",
  topicSummary: "data/generated/topic_summary.json",
  alerts: "data/generated/alerts.json",
  metadata: "data/generated/metadata.json",
};

const state = {
  mentions: [],
  dailyCounts: [],
  sourceSummary: [],
  topicSummary: [],
  alerts: [],
  metadata: null,
  filters: {
    company: "All",
    topic: "All",
    search: "",
  },
};

const formatNumber = new Intl.NumberFormat("en-US");
const formatDateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

async function init() {
  try {
    const [mentions, dailyCounts, sourceSummary, topicSummary, alerts, metadata] = await Promise.all([
      loadJson(FILES.mentions),
      loadJson(FILES.dailyCounts),
      loadJson(FILES.sourceSummary),
      loadJson(FILES.topicSummary),
      loadJson(FILES.alerts),
      loadJson(FILES.metadata),
    ]);
    Object.assign(state, { mentions, dailyCounts, sourceSummary, topicSummary, alerts, metadata });
    document.getElementById("dashboard").hidden = false;
    bindControls();
    renderAll();
  } catch (error) {
    document.getElementById("emptyState").hidden = false;
    console.warn("Generated data unavailable", error);
  }
}

function bindControls() {
  const topicFilter = document.getElementById("topicFilter");
  const topics = [...new Set(state.mentions.map((item) => item.topic).filter(Boolean))].sort();
  for (const topic of topics) {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    topicFilter.append(option);
  }

  document.getElementById("companyFilter").addEventListener("change", (event) => {
    state.filters.company = event.target.value;
    renderAll();
  });
  topicFilter.addEventListener("change", (event) => {
    state.filters.topic = event.target.value;
    renderAll();
  });
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    renderAll();
  });
}

function filteredMentions() {
  return state.mentions.filter((item) => {
    if (state.filters.company !== "All" && item.company !== state.filters.company) return false;
    if (state.filters.topic !== "All" && item.topic !== state.filters.topic) return false;
    if (!state.filters.search) return true;
    const haystack = [
      item.title,
      item.source,
      item.sourceDomain,
      item.topic,
      item.company,
      ...(item.matchedKeywords || []),
    ].join(" ").toLowerCase();
    return haystack.includes(state.filters.search);
  });
}

function renderAll() {
  renderMetadata();
  const records = filteredMentions();
  renderKpis(records);
  renderTimeline(records);
  renderTopics(records);
  renderSources(records);
  renderAlerts();
  renderTable(records);
}

function renderMetadata() {
  const metadata = state.metadata || {};
  const lastUpdated = metadata.lastUpdated ? new Date(metadata.lastUpdated) : null;
  document.getElementById("lastUpdated").textContent = lastUpdated ? formatDateTime.format(lastUpdated) : "--";
  document.getElementById("coverageWindow").textContent = metadata.coverageWindow?.start
    ? `${metadata.coverageWindow.start} to ${metadata.coverageWindow.end}`
    : "No records in current generated dataset";
  document.getElementById("recordCount").textContent = formatNumber.format(metadata.recordCount || 0);

  const ageHours = lastUpdated ? (Date.now() - lastUpdated.getTime()) / 36e5 : Infinity;
  const freshness = document.getElementById("freshnessBadge");
  freshness.textContent = ageHours <= 36 ? "Fresh" : "Needs refresh";
  freshness.className = `badge ${ageHours <= 36 ? "good" : "warn"}`;

  const sourceHealth = document.getElementById("sourceHealth");
  sourceHealth.replaceChildren(...(metadata.dataSources || []).map((source) => {
    const row = document.createElement("div");
    row.className = "source-row";
    const body = document.createElement("div");
    body.innerHTML = `<strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(source.notes || "")}</span>`;
    const badge = document.createElement("span");
    badge.className = `badge ${source.available ? "good" : "warn"}`;
    badge.textContent = source.available ? `${formatNumber.format(source.recordsFetched || 0)} records` : "Unavailable";
    row.append(body, badge);
    return row;
  }));

  const disclosures = metadata.metricDisclosure || {};
  document.getElementById("metricDisclosure").replaceChildren(...Object.entries(disclosures).map(([name, value]) => {
    const item = document.createElement("li");
    item.textContent = `${name}: ${value}`;
    return item;
  }));

  document.getElementById("limitations").replaceChildren(...(metadata.knownLimitations || []).map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}

function renderKpis(records) {
  const reach = records.reduce((sum, item) => sum + Number(item.reach || 0), 0);
  const engagement = records.reduce((sum, item) => sum + Number(item.engagement || 0), 0);
  const sentiment = records.length
    ? records.reduce((sum, item) => sum + Number(item.sentimentScore || 0), 0) / records.length
    : 0;
  document.getElementById("kpiMentions").textContent = formatNumber.format(records.length);
  document.getElementById("kpiReach").textContent = formatNumber.format(reach);
  document.getElementById("kpiEngagement").textContent = formatNumber.format(engagement);
  document.getElementById("kpiSentiment").textContent = sentiment.toFixed(2);
}

function renderTimeline(records) {
  const chart = document.getElementById("timelineChart");
  const counts = new Map();
  for (const item of records) {
    const key = `${item.date}|${item.company}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const dates = [...new Set(state.dailyCounts.map((item) => item.date))].sort();
  const max = Math.max(1, ...dates.map((date) => {
    return (counts.get(`${date}|Novo Nordisk`) || 0) + (counts.get(`${date}|Eli Lilly`) || 0);
  }));
  chart.replaceChildren(...dates.map((date) => {
    const novo = counts.get(`${date}|Novo Nordisk`) || 0;
    const lilly = counts.get(`${date}|Eli Lilly`) || 0;
    const bar = document.createElement("div");
    bar.className = `timeline-bar ${lilly > novo ? "lilly" : ""}`;
    const total = novo + lilly;
    bar.style.height = `${Math.max(2, (total / max) * 240)}px`;
    bar.title = `${date}: ${total} mentions`;
    return bar;
  }));
}

function renderTopics(records) {
  const grouped = groupCount(records, "topic");
  if (!grouped.length) {
    const empty = document.createElement("p");
    empty.className = "caption";
    empty.textContent = "No real topic records available in the generated dataset.";
    document.getElementById("topicChart").replaceChildren(empty);
    return;
  }
  const max = Math.max(1, ...grouped.map((item) => item.count));
  document.getElementById("topicChart").replaceChildren(...grouped.slice(0, 12).map((item) => barRow(item.name, item.count, max)));
}

function renderSources(records) {
  const grouped = new Map();
  for (const item of records) {
    const key = item.sourceDomain || item.source || "Unknown";
    const current = grouped.get(key) || { name: key, count: 0, reach: 0, tier: item.sourceTier, channel: item.channel };
    current.count += 1;
    current.reach += Number(item.reach || 0);
    grouped.set(key, current);
  }
  const rows = [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "caption";
    empty.textContent = "No real source records available in the generated dataset.";
    document.getElementById("sourceSummary").replaceChildren(empty);
    return;
  }
  document.getElementById("sourceSummary").replaceChildren(...rows.map((item) => {
    const row = document.createElement("div");
    row.className = "source-item";
    row.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong>
      <div class="source-meta">
        <span>${formatNumber.format(item.count)} mentions</span>
        <span>${escapeHtml(item.tier)}</span>
        <span>${escapeHtml(item.channel)}</span>
        <span>${formatNumber.format(item.reach)} reach proxy</span>
      </div>
    `;
    return row;
  }));
}

function renderAlerts() {
  const container = document.getElementById("alerts");
  if (!state.alerts.length) {
    const empty = document.createElement("p");
    empty.className = "caption";
    empty.textContent = "No generated alerts for the current dataset.";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...state.alerts.map((alert) => {
    const row = document.createElement("div");
    row.className = "alert";
    row.innerHTML = `<strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.company)}: ${escapeHtml(alert.message)}</span>`;
    return row;
  }));
}

function renderTable(records) {
  document.getElementById("visibleCount").textContent = `${formatNumber.format(records.length)} records`;
  if (!records.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7">No real article records are present in the generated dataset. Check the Data Status panel for unavailable sources or run the pipeline again.</td>`;
    document.getElementById("mentionsTable").replaceChildren(row);
    return;
  }
  const rows = records.slice(0, 250).map((item) => {
    const row = document.createElement("tr");
    const titleLink = item.url
      ? `<a href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title || item.url)}</a>`
      : escapeHtml(item.title || "Untitled");
    row.innerHTML = `
      <td>${escapeHtml(item.date || "")}</td>
      <td>${escapeHtml(item.company || "")}</td>
      <td>${escapeHtml(item.topic || "")}</td>
      <td>${escapeHtml(item.sourceDomain || item.source || "")}<br><span class="caption">${escapeHtml(item.rawSource || "")}</span></td>
      <td class="title-cell">${titleLink}<br><span class="caption">${escapeHtml((item.matchedKeywords || []).join(", "))}</span></td>
      <td><span class="sentiment ${escapeAttribute(item.sentiment || "Neutral")}">${escapeHtml(item.sentiment || "Neutral")}</span><br><span class="caption">${Number(item.sentimentScore || 0).toFixed(2)}</span></td>
      <td>${formatNumber.format(Number(item.reach || 0))}</td>
    `;
    return row;
  });
  document.getElementById("mentionsTable").replaceChildren(...rows);
}

function groupCount(records, key) {
  const grouped = new Map();
  for (const item of records) {
    const name = item[key] || "Unknown";
    grouped.set(name, (grouped.get(name) || 0) + 1);
  }
  return [...grouped.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function barRow(name, count, max) {
  const row = document.createElement("div");
  row.className = "bar-row";
  row.innerHTML = `
    <div class="bar-top"><strong>${escapeHtml(name)}</strong><span>${formatNumber.format(count)}</span></div>
    <div class="bar-track"><div class="bar-fill" style="--w:${Math.max(3, (count / max) * 100)}%"></div></div>
  `;
  return row;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

init();
