import { parseFeed } from '../function/core.mjs';
import { parseListing } from '../function/adapters.mjs';
const sources = [
  { id:'gemini',allowed_host:'blog.google',feed_url:'https://blog.google/products/gemini/rss/' },
  { id:'xai',allowed_host:'news.google.com',feed_url:'https://news.google.com/rss/search?q=site%3Ax.ai%2Fnews&hl=en-US&gl=US&ceid=US%3Aen' },
  { id:'runway',kind:'html',allowed_host:'runwayml.com',config:{extra_hosts:['runway.com']},feed_url:'https://runwayml.com/research' },
  { id:'luma',kind:'html',allowed_host:'lumalabs.ai',feed_url:'https://lumalabs.ai/news' }
];
for (const source of sources) {
  const response = await fetch(source.feed_url, {signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(source.id + ': ' + response.status);
  const input = await response.text();
  const items = source.kind === 'html' ? parseListing(input, source, response.url) : parseFeed(input,source);
  if (!items.length) throw new Error(source.id + ': empty');
  console.log(JSON.stringify({source:source.id,count:items.length,samples:items.slice(0,3)}));
}
