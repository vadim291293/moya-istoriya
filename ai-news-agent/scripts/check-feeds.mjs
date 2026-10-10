import { parseFeed } from '../function/core.mjs';
const sources = [
  { id: 'openai', allowed_host: 'openai.com', feed_url: 'https://openai.com/news/rss.xml' },
  { id: 'google_ai', allowed_host: 'blog.google', feed_url: 'https://blog.google/technology/ai/rss/' },
  { id: 'huggingface', allowed_host: 'huggingface.co', feed_url: 'https://huggingface.co/blog/feed.xml' }
];
for (const source of sources) {
  const response = await fetch(source.feed_url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(source.id + ': HTTP ' + response.status);
  const items = parseFeed(await response.text(), source);
  if (!items.length) throw new Error(source.id + ': no usable entries');
  console.log(JSON.stringify({ source: source.id, entries: items.length, newest: items[0].title }));
}
