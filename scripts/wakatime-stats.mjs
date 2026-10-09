// Render the last 7 days of WakaTime stats into light/dark SVG charts.
// Usage: WAKATIME_API_KEY=... node scripts/wakatime-stats.mjs

import { writeFile } from "node:fs/promises";

const API = "https://api.wakatime.com/api/v1";
const OUT_LIGHT = "images/wakatime_weekly_language_stats.svg";
const OUT_DARK = "images/wakatime_weekly_language_stats_dark.svg";
const MAX_LANGUAGES = 6;
const FALLBACK_COLOR = "#8b949e";
// Colors for languages WakaTime has none for (GitHub linguist colors).
const COLOR_OVERRIDES = { Bash: "#89e051" };

const THEMES = {
  light: { bg: "#ffffff", text: "#333333", muted: "#6a737d" },
  dark: { bg: "#22272e", text: "#c9d1d9", muted: "#8b949e" },
};

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) {
  console.error("WAKATIME_API_KEY is required");
  process.exit(1);
}

async function get(path, auth = true) {
  const headers = auth ? { Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}` } : {};
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()).data;
}

// WakaTime computes stats asynchronously; retry while they are still pending.
async function getStats() {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const stats = await get("/users/current/stats/last_7_days");
    if (stats.status === "ok" && stats.is_up_to_date) return stats;
    console.log(`stats not ready (${stats.status}, ${stats.percent_calculated}%), retry ${attempt}`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
  return null;
}

const num = (v) => Number(v) || 0;

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(hex, target, ratio) {
  const channel = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return (
    "#" +
    [1, 3, 5]
      .map((i) => Math.round(channel(hex, i) * (1 - ratio) + channel(target, i) * ratio))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

// Keep language colors readable against each theme's background.
function themedColor(color, theme) {
  if (!/^#[0-9a-f]{6}$/i.test(color ?? "")) return FALLBACK_COLOR;
  const lum = luminance(color);
  if (theme === "dark" && lum < 0.08) return mix(color, "#ffffff", 0.45);
  if (theme === "light" && lum > 0.75) return mix(color, "#000000", 0.35);
  return color;
}

// Largest remainder rounding, so the displayed percentages add up to 100.
function percentages(values) {
  const total = values.reduce((s, v) => s + v, 0) || 1;
  const exact = values.map((v) => (v / total) * 100);
  const result = exact.map(Math.floor);
  const order = exact.map((v, i) => [v - result[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < 100 - result.reduce((s, v) => s + v, 0); k++) result[order[k][1]]++;
  return result;
}

function summarize(stats, colors) {
  // WakaTime's own "Other" is mostly AI session time not tied to any file, so it is left out
  // entirely; our Other row only holds the languages beyond the top ones.
  const languages = stats.languages
    .filter((l) => l.name !== "Other")
    .map((l) => ({ name: l.name, total: num(l.total_seconds) }));
  const top = languages
    .filter((l) => l.total > 0)
    .slice(0, MAX_LANGUAGES)
    .map((l) => ({ ...l, color: colors.get(l.name) }));
  const rest = languages.filter((l) => !top.some((t) => t.name === l.name));
  const otherTotal = rest.reduce((s, l) => s + l.total, 0);
  const rows = otherTotal > 0 ? [...top, { name: "Other", total: otherTotal, color: FALLBACK_COLOR }] : top;

  const percents = percentages(rows.map((r) => r.total));
  return rows.map((r, i) => ({ ...r, percent: percents[i] }));
}

function render(rows, theme) {
  const t = THEMES[theme];
  const width = 540;
  const pad = 20;
  const nameWidth = 100;
  const percentWidth = 50;
  const barX = pad + nameWidth + 10;
  const barMax = width - barX - percentWidth - pad;
  const rowHeight = 24;
  const maxTotal = Math.max(...rows.map((r) => r.total), 1);

  const body = rows.map((r, i) => {
    const y = pad + i * rowHeight;
    const color = themedColor(r.color, theme);
    const barWidth = Math.max((r.total / maxTotal) * barMax, 2);
    const delay = 300 + i * 100;
    return `
  <g transform="translate(0, ${y})">
    <text class="name fade" x="${pad}" y="9" style="animation-delay:${delay}ms">${escapeXml(r.name)}</text>
    <g transform="translate(${barX}, 2)">
      <rect class="bar" width="${barWidth.toFixed(1)}" height="14" rx="3" fill="${color}" style="animation-delay:${delay}ms"/>
    </g>
    <text class="percent fade" x="${width - pad}" y="9" text-anchor="end" style="animation-delay:${delay}ms">${r.percent ? `${r.percent}%` : "<1%"}</text>
  </g>`;
  });

  const empty = rows.length ? "" : `<text class="empty" x="${pad}" y="${pad + 9}">No coding activity in the last 7 days</text>`;
  const height = pad * 2 + Math.max(rows.length, 1) * rowHeight - 6;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${t.text}; dominant-baseline: middle }
    .percent { font-weight: 400 }
    .empty { font-weight: 400; fill: ${t.muted} }
    .fade { opacity: 0; animation: fade 0.5s ease-in-out forwards }
    .bar { transform-box: fill-box; transform-origin: left; animation: grow 0.6s ease-in-out both }
    @keyframes fade { to { opacity: 1 } }
    @keyframes grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
  </style>
  <rect width="${width}" height="${height}" rx="4.5" fill="${t.bg}"/>
  ${body.join("")}
  ${empty}
</svg>
`;
}

const stats = await getStats();
if (!stats) {
  console.log("::warning::WakaTime stats are still pending, keeping the previous charts");
  process.exit(0);
}

const languages = await get("/program_languages", false).catch(() => []);
const colors = new Map(languages.map((l) => [l.name, COLOR_OVERRIDES[l.name] ?? l.color]));
const rows = summarize(stats, colors);

await writeFile(OUT_LIGHT, render(rows, "light"));
await writeFile(OUT_DARK, render(rows, "dark"));
console.log(rows.map((r) => `${r.name} ${r.percent}%`).join(", "));
