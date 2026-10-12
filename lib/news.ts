export type Topic = "Тема канала";
export type Source = { id: string; name: string; url: string; home: string; kind: "rss" | "telegram"; topic: Topic; description: string; automatic?: boolean };
export const INTERVAL_MINUTES = 120;
export const FEATURE_MAX_HOURS = 30 * 24;

export function topicSearchSource(theme: string): Source {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", theme);
  url.searchParams.set("hl", "ru");
  url.searchParams.set("gl", "RU");
  url.searchParams.set("ceid", "RU:ru");
  return { id: "topic-search", name: `Поиск: ${theme}`, url: url.href, home: "https://news.google.com/", kind: "rss", topic: "Тема канала", automatic: true, description: "Общий поиск по теме. Издатели определяются автоматически по результатам RSS." };
}

export function publisherSourceId(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+$/.test(host) && host.includes(".") ? `publisher:${host}` : "topic-search";
  } catch { return "topic-search"; }
}
export function publisherSource(id: string): Source | null {
  if (!id.startsWith("publisher:")) return null;
  const host = id.slice("publisher:".length);
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return null;
  return { id, name: host, url: "", home: `https://${host}/`, kind: "rss", topic: "Тема канала", automatic: true, description: "Издатель найден автоматически по вашей теме в RSS. Выключите источник, чтобы скрыть его материалы из следующих сборов." };
}
export const SOURCES: Source[] = [];
export type Rubric = "Новости" | "Истории" | "Интервью" | "Обсуждения" | "Обзоры";
export function rubric(title: string, excerpt = ""): Rubric {
  const text = `${title} ${excerpt}`;
  if (/interview|qa with|в интервью|интервью/i.test(text)) return "Интервью";
  if (/behind.the.scenes|making.of|production diary|истори[яи] создания|закулись|как создавал|документальн/i.test(text)) return "Истории";
  if (/controvers|backlash|debate|dispute|скандал|травл|извин|спор|обсуждени/i.test(text)) return "Обсуждения";
  if (/review|recommend|обзор|рекоменд|стоит ли|тест.драйв/i.test(text)) return "Обзоры";
  return "Новости";
}
export function freshEnough(title: string, excerpt: string, publishedAt: string, now = Date.now()) {
  const age = (now - Date.parse(publishedAt)) / 3600000;
  return Number.isFinite(age) && age >= -1 / 6 && age <= (rubric(title, excerpt) === "Истории" || rubric(title, excerpt) === "Интервью" ? FEATURE_MAX_HOURS : 36);
}
export type Candidate = { title: string; excerpt: string; url: string; publishedAt: string; topic: Topic; sourceId: string; score: number; reason: string; publisherName?: string };
export function plain(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/p>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const c = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ""; })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|hellip);/g, (_, n: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" }[n] || ""))
    .replace(/[\t \u00a0]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}
export function canonicalUrl(input: string): string | null {
  try { const u = new URL(input.replace(/&amp;/g, "&").trim()); if (u.protocol !== "https:") return null; u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return null; }
}
function tag(block: string, name: string) { return block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || ""; }
export function titleTokens(title: string) { return new Set(plain(title).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length > 2 && !["the", "and", "for", "with", "new", "для", "как", "что", "это"].includes(w))); }
export function sameStory(a: string, b: string) {
  const x = titleTokens(a), y = titleTokens(b); if (!x.size || !y.size) return false;
  const intersection = [...x].filter(t => y.has(t)).length; return intersection / (x.size + y.size - intersection) >= .72;
}
export function grade(title: string, excerpt: string, _source: Source, publishedAt: string, now = Date.now()) {
  const text = `${title} ${excerpt}`.toLowerCase(); const age = (now - Date.parse(publishedAt)) / 3600000;
  let score = 46 + Math.max(0, 22 - age); const reasons: string[] = [];
  if (age <= 6) reasons.push("Свежая публикация");
  const kind = rubric(title, excerpt); reasons.push(kind);
  if (kind === "Интервью" || kind === "Истории") { score += 18; if (age > 36) reasons.push("Материал старше 36 часов — обозначьте «Из интервью» или «Из архива»"); }
  if (kind === "Обзоры") { score += 10; reasons.push("Материал для обзора"); }
  if (kind === "Обсуждения") { score += 8; reasons.push("Проверьте первичные высказывания и контекст"); }
  if (/rumou?r|leak|insider|слух|утечк|инсайдер|не подтвержд/i.test(text)) { score -= 40; reasons.push("Есть неподтверждённые сведения"); }
  if (/giveaway|sponsored|promo code|розыгрыш|промокод|реклама|erid:/i.test(text)) { score -= 60; reasons.push("Реклама или розыгрыш"); }
  return { score: Math.max(0, Math.min(99, Math.round(score))), reason: reasons.join(" · ") || "Тематическая публикация" };
}
export function parseFeed(xml: string, source: Source, now = Date.now()): Candidate[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>|<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
  const results: Candidate[] = [];
  for (const block of blocks.slice(0, 60)) {
    const title = plain(tag(block, "title")).slice(0, 250);
    const excerpt = plain(tag(block, "description") || tag(block, "summary") || tag(block, "content:encoded") || tag(block, "content")).slice(0, 1600);
    const rawUrl = plain(tag(block, "link")) || block.match(/<link[^>]*href=['"]([^'"]+)['"]/)?.[1] || "";
    const date = plain(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date"));
    const publisherBlock = block.match(/<source\s+url=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/source>/i);
    const publisherUrl = publisherBlock?.[1] || "";
    const publisherName = plain(publisherBlock?.[2] || "");
    const url = canonicalUrl(rawUrl), timestamp = Date.parse(date);
    if (!url || !title || title.length < 8 || !Number.isFinite(timestamp) || !freshEnough(title, excerpt, date, now)) continue;
    const publishedAt = new Date(timestamp).toISOString();
    const sourceId = source.id === "topic-search" && publisherUrl ? publisherSourceId(publisherUrl) : source.id;
    const itemSource = publisherSource(sourceId) || source;
    results.push({ title, excerpt, url, publishedAt, topic: "Тема канала", sourceId, ...grade(title, excerpt, itemSource, publishedAt, now), ...(publisherName ? { publisherName } : {}) });
  }
  return results;
}
