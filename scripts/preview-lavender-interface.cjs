// Actual production components, rendered locally with fictional data.
// No real sessions, files, API calls or interactive data writes.
const React = require('react');
const RN = require('react-native-web');
const { renderToStaticMarkup } = require('react-dom/server');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { loadTypescript } = require('../tests/load-typescript.cjs');
const { mocks, setPreviewAuth } = require('./check-interface-render.cjs');

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Specify a new absolute artifact directory.');
if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing artifact directory.');
const family = { status: 'ready', family: { id: 'demo-family', name: 'Семья Ивановых', role: 'owner' },
  children: [{ id: 'demo-child', name: 'Ася', birth_date: '2024-01-01' }, { id: 'demo-child-2', name: 'Миша', birth_date: '2022-05-10' }] };
setPreviewAuth({ family, session: { user: { id: 'demo-user', email: 'demo@example.invalid' } } });
const illustration = (sky, ground) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="${sky}"/><circle cx="470" cy="90" r="54" fill="#fff4d6"/><path d="M0 290Q140 80 290 290Q470 150 600 280V400H0" fill="${ground}"/><path d="M0 355Q170 260 350 355Q500 300 600 340V400H0" fill="#a0ae87"/></svg>`);
const rows = [
  { id: 'demo-one', title: 'День у озера', body: 'Смеялись, гуляли и никуда не спешили.', event_date: '2026-09-14', author_id: 'demo-user', child_ids: ['demo-child'], media: [
    { id: 'demo-photo', media_type: 'image', signed_url: illustration('#d5def9', '#b5a4d7') },
    { id: 'demo-photo-2', media_type: 'image', signed_url: illustration('#f6dfd9', '#c2b797') },
    { id: 'demo-video', media_type: 'video', signed_url: null },
    { id: 'demo-photo-3', media_type: 'image', signed_url: illustration('#dbebe5', '#afc4b7') },
  ] },
  { id: 'demo-note', title: 'Маленькое открытие', body: 'Сегодня Ася впервые сама придумала историю. Хочется запомнить каждое слово.', event_date: '2026-09-13', author_id: 'demo-user', child_ids: ['demo-child'], media: [] },
];
const panels = [];
for (const [id, title, tab] of [['photos', 'Фото', 'gallery'], ['videos', 'Видео', 'video'], ['records', 'Записи', 'records'], ['family', 'Семья', 'children']]) {
  let homeTabUsed = false;
  const fixtureReact = { ...React, useState(initial) {
    let value = initial;
    if (initial === 'gallery' && !homeTabUsed) { value = tab; homeTabUsed = true; }
    else if (Array.isArray(initial) && initial.length === 0) value = rows;
    else if (initial === true) value = false;
    return React.useState(value);
  } };
  const Home = loadTypescript('src/app/home.tsx', { ...mocks, react: fixtureReact }).FamilyHome;
  panels.push([id, title, renderToStaticMarkup(React.createElement(Home))]);
}
for (const [id, title, file] of [['new', 'Новый момент', 'src/app/memory/new.tsx'], ['welcome', 'Начальный экран', 'src/app/index.tsx']]) {
  const Screen = loadTypescript(file, mocks).default;
  panels.push([id, title, renderToStaticMarkup(React.createElement(Screen))]);
}
const sheet = RN.StyleSheet.getSheet();
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Моя история — фиолетовый интерфейс</title><style>${sheet.textContent}
body{margin:0;background:#ebe7f3;color:#372e57;font:15px system-ui,sans-serif}header{padding:20px;text-align:center}header h1{margin:0;font-size:22px}header p{margin:8px 0;color:#6b5c87;font-size:13px}.panels{display:flex;gap:24px;align-items:flex-start;padding:0 24px 30px;overflow-x:auto}.panel{flex:none;width:360px}.panel h2{font-size:15px;text-align:center}.phone{height:780px;background:#f6f2ff;border:1px solid #d9cfea;border-radius:30px;overflow:hidden;display:flex;flex-direction:column;padding-top:24px;box-shadow:0 10px 35px #372e5712}.phone>div{flex:1;min-height:0}
</style></head><body><header><h1>Моя история · мягкий фиолетовый</h1><p>Статический просмотр реальных компонентов. Данные вымышленные, изображения — иллюстрации. Это не проверка на телефоне.</p></header><main class="panels">${panels.map(([id, title, markup]) => `<section class="panel" id="${id}"><h2>${title}</h2><div class="phone">${markup}</div></section>`).join('')}</main></body></html>`;
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), html);
console.log('Static visual artifact: ' + path.join(output, 'index.html'));
if (process.argv.includes('--serve')) {
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html);
  });
  server.listen(8094, '127.0.0.1', () => console.log('Local fictional preview: http://127.0.0.1:8094/ (auto-closes in 2 minutes)'));
  setTimeout(() => server.close(), 120000);
}
