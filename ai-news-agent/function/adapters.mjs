import { load } from 'cheerio';
import { byteLength, clip, plain, sourceUrl } from './core.mjs';

function dateFromText(value) {
  const match = value.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}/i);
  const date = match && Date.parse(match[0]);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}
export function parseListing(html, source, baseUrl = source.feed_url) {
  if (byteLength(html) > 2000000) throw new Error('listing_too_large');
  const $ = load(html);
  const seen = new Set(), items = [];
  const aliases = [source.allowed_host, ...(source.config?.extra_hosts ?? [])];
  $('a[href]').each((_, element) => {
    const node = $(element);
    let resolved;
    try { resolved = new URL(node.attr('href'), baseUrl).href; } catch { return; }
    const url = aliases.map(host => sourceUrl(resolved, host)).find(Boolean);
    if (!url) return;
    const path = new URL(url).pathname;
    if (source.id === 'runway' && !/^\/research\/[^/]+\/?$/.test(path)) return;
    if (source.id === 'luma' && !/^\/news\/[^/]+\/?$/.test(path)) return;
    if (source.id === 'runway' && /publications|rna-sessions/.test(path)) return;
    const raw = node.text().replace(/\s+/g, ' ').trim();
    let headline = node.find('h1,h2,h3,h4').first().text().trim() || raw;
    if (!headline || /^(read more|read paper|learn more|explore|view all)$/i.test(headline))
      headline = path.split('/').filter(Boolean).at(-1).replace(/-/g, ' ');
    const title = clip(plain(headline), 500);
    if (title.length < 5 || /^(read more|learn more|explore|view all)$/i.test(title) || seen.has(url)) return;
    seen.add(url);
    const attrDate = node.find('time').first().attr('datetime');
    const timestamp = attrDate && Date.parse(attrDate);
    items.push({ source_id: source.id, url, title, excerpt: clip(plain(raw), 1200),
      published_at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : dateFromText(raw) });
  });
  if (!items.length) throw new Error('listing_no_articles');
  return items.slice(0, 100);
}
export function enrichArticle(html, item) {
  const $ = load(html);
  let published = $('meta[property="article:published_time"]').attr('content') ||
    $('time[datetime]').first().attr('datetime');
  $('script[type="application/ld+json"]').each((_, node) => {
    try {
      const value = JSON.parse($(node).text());
      const objects = Array.isArray(value) ? value : [value, ...(value['@graph'] ?? [])];
      for (const object of objects) if (object.datePublished) published ||= object.datePublished;
    } catch { /* Ignore unrelated or malformed structured data. */ }
  });
  const date = Date.parse(published);
  const excerpt = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') ||
    $('main p').slice(0, 4).text();
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || item.title;
  return { ...item, title: clip(plain(title),500), excerpt: clip(plain(excerpt || item.excerpt), 1800),
    published_at: Number.isFinite(date) ? new Date(date).toISOString() : item.published_at };
}
