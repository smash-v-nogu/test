// Тестовая сборка «Смэш мне в ногу» → https://smash-v-nogu.github.io/test/
// Берёт index.html из ветки игры, включает «тестовый режим» и шифрует страницу паролем (AES-256-GCM, ключ — PBKDF2).
// Запуск: TEST_PASS='пароль' node build.mjs <путь к index.html ветки>   → index.html этой папки
//         node build.mjs --gate   → только новая страница входа (gate.html) вокруг готового шифра, пароль не нужен
//
// Тестовый режим (основная игра не меняется, правки только в этой сборке):
// - общая база выключена: ни матчей, ни рекордов, ни лобби, ни входа по ПИНу; пускаются только ключи ретранслятора (turn);
// - свои ключи localStorage (суффикс -test): сайт тот же, и без этого тест смешался бы с профилем основной игры;
// - свой префикс комнат PeerJS: тестовые комнаты не пересекаются с основными;
// - плашка «ТЕСТ» и «ТЕСТ ·» в заголовке вкладки.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'index.html');
const b64 = u8 => Buffer.from(u8).toString('base64');
const two = n => String(n).padStart(2, '0');
const stamp = d => `сборка ${two(d.getDate())}.${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;

// Подставляет шифр в страницу входа. Подвал: ветка, коммит и время сборки — по нему видно, какая сборка открыта
function writeGate({ salt, iv, iter, data, from }) {
  const tpl = readFileSync(resolve(HERE, 'gate.html'), 'utf8');
  const page = tpl
    .replace('%SALT%', salt).replace('%IV%', iv).replace('%ITER%', String(iter))
    .replace('%FROM%', from.replace(/[<>&"$]/g, ''))
    .replace('%DATA%', data);
  writeFileSync(OUT, page);
  writeFileSync(resolve(HERE, 'build.txt'), iv + '\n'); // id сборки: по нему открытая страница входа узнаёт, что устарела
  return page;
}

// --gate: поменялась только страница входа — заворачиваем в неё готовый шифр, пароль не нужен
if (process.argv[2] === '--gate') {
  const old = readFileSync(OUT, 'utf8');
  const m = /<script id="pack" type="text\/plain" data-salt="([A-Za-z0-9+/=]+)" data-iv="([A-Za-z0-9+/=]+)" data-iter="(\d+)">([A-Za-z0-9+/=\s]+)<\/script>/.exec(old);
  if (!m) { console.error('В index.html нет шифра — нужна полная сборка с паролем'); process.exit(1); }
  let from = (/class="from"[^>]*>([^<]*)</.exec(old) || [])[1] || '';
  if (!/сборка /.test(from)) { // старая страница без времени: берём время коммита, который её выложил
    try {
      const t = execFileSync('git', ['-C', HERE, 'log', '-1', '--format=%cI', '--', 'index.html'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (t) from += ` · ${stamp(new Date(t))}`;
    } catch (_) {}
  }
  const page = writeGate({ salt: m[1], iv: m[2], iter: +m[3], data: m[4].trim(), from });
  console.log(`Страница входа обновлена: ${OUT} (${(page.length / 1024).toFixed(0)} КБ), шифр прежний (${from})`);
  process.exit(0);
}

const SRC = process.argv[2];
const PASS = process.env.TEST_PASS;
if (!SRC || !PASS) { console.error("Запуск: TEST_PASS='пароль' node build.mjs <путь к index.html ветки>"); process.exit(1); }
const ITER = 600000; // PBKDF2-SHA256, как советует OWASP; на телефоне — около секунды, потом ключ запоминается
// Пароль без учёта регистра и пробелов по краям (телефон любит заглавную первую букву); NFC — «й» и «ё» одной буквой, как их шлёт клавиатура
const NORM = PASS.normalize('NFC').trim().toLowerCase();

// Сводка пароля без самого пароля: длина и алфавит. Скрытый ввод в терминале не видно — по сводке ловится чужая раскладка
const kinds = [[/[a-z]/, 'латиница'], [/[а-яё]/, 'кириллица'], [/[0-9]/, 'цифры'], [/[^a-z0-9а-яё]/, 'другие знаки']]
  .filter(([re]) => re.test(NORM)).map(([, name]) => name);
console.log(`Пароль: ${[...NORM].length} знаков, ${kinds.join(' + ')}`);

let html = readFileSync(SRC, 'utf8');

// Откуда сборка: ветка, коммит и время — в подвал страницы входа и в отчёт
let from = '';
const Q = { stdio: ['ignore', 'pipe', 'ignore'] }; // не git — просто без ветки в подвале
try {
  const dir = dirname(resolve(SRC));
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], Q).toString().trim();
  const br = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], Q).toString().trim();
  const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', 'index.html'], Q).toString().trim();
  from = `${br} ${sha}${dirty ? ' + правки' : ''}`;
} catch (_) {}
from = (from ? from + ' · ' : '') + stamp(new Date());

// Каждая правка обязана найтись ровно столько раз, сколько указано: код игры поменялся — сборка падает, а не выходит молча битой
function patch(name, a, b, n = 1) {
  const k = html.split(a).length - 1;
  if (k !== n) { console.error(`Правка «${name}»: найдено ${k}, ждали ${n}. Код игры изменился — поправь build.mjs.`); process.exit(1); }
  html = html.split(a).join(b);
}

patch('префикс комнат', "const PEER_PREFIX = 'bdm-proto-26-';", "const PEER_PREFIX = 'bdm-test-26-'; // тестовая сборка: свои комнаты");
patch('ключи профиля', "const SLOT = (/[?&]p=(\\d)\\b/.exec(location.search) || [])[1] || '';",
  "const SLOT = '-test' + ((/[?&]p=(\\d)\\b/.exec(location.search) || [])[1] || ''); // тестовая сборка: свой профиль и записи");
patch('ключ настроек (чтение)', "localStorage.getItem('bdm-cfg')", "localStorage.getItem('bdm-cfg-test')");
patch('ключ настроек (запись)', "localStorage.setItem('bdm-cfg',", "localStorage.setItem('bdm-cfg-test',");
patch('база выключена', "const cloudOn = () => !!(CLOUD.url && CLOUD.key) && !inClaude();",
  "const cloudOn = () => false; // тестовая сборка: общая база выключена");
patch('ретранслятор без базы', "if (!cloudOn() || USE_LOCAL) return Promise.resolve(ICE_BASE);",
  "if (inClaude() || USE_LOCAL) return Promise.resolve(ICE_BASE); // тестовая сборка: ключи ретранслятора нужны и без базы");
patch('запросы к базе', "async function cloudReq(path, opts = {}) {",
  "async function cloudReq(path, opts = {}) { throw new Error('тестовая сборка: база выключена');");
patch('заголовок вкладки', '<title>Смэш мне в ногу</title>', '<title>ТЕСТ · Смэш мне в ногу</title>');
patch('индексация', '<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">');
// Страховка поверх правок: любой запрос к Supabase, кроме ключей ретранслятора, отбивается ещё до сети
patch('страховка запросов', '<script async src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js"></script>',
  `<script>/* ТЕСТОВАЯ СБОРКА: в общую базу ничего не уходит, пускаем только ключи ретранслятора (функция turn) */
(() => {
  const ok = u => !/supabase\\.co/i.test(u) || /\\/functions\\/v1\\/turn(\\?|$)/.test(u);
  const f = window.fetch.bind(window);
  window.fetch = (u, o) => { const s = String(u && u.url || u); return ok(s) ? f(u, o) : Promise.reject(new TypeError('тестовая сборка: база выключена')); };
  if (navigator.sendBeacon) { const b = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (u, d) => ok(String(u)) ? b(u, d) : false; }
  // игра сама пишет заголовок (счёт, «Соперник пришёл!») — «ТЕСТ ·» держим в нём всегда, чтобы не спутать вкладки
  const td = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  if (td && td.set) Object.defineProperty(document, 'title', { configurable: true, get: () => td.get.call(document),
    set: v => td.set.call(document, /^ТЕСТ/.test(v = String(v)) ? v : 'ТЕСТ · ' + v) });
})();
</script>
<script async src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js"></script>`);
patch('плашка ТЕСТ', '</body>', `<div id="testBadge" aria-hidden="true">ТЕСТ</div>
<style>
#testBadge { position: fixed; left: 8px; bottom: 8px; z-index: 2147483647; pointer-events: none; padding: 4px 8px 3px; border-radius: 6px;
  background: #e5484d; color: #fff; font: 700 10px/1.2 var(--font-display); letter-spacing: 0.14em; opacity: 0.9; }
/* телефон: слева внизу сенсорные стрелки — плашку в середину, под корт */
@media (pointer: coarse) { #testBadge { left: 50%; bottom: 3px; transform: translateX(-50%); } }
</style>
</body>`);

// Соль постоянная между сборками (берём из прошлой страницы): запомненный в браузере ключ переживает пересборку с тем же паролем
let salt = null;
if (existsSync(OUT)) { const m = /data-salt="([A-Za-z0-9+/=]+)"/.exec(readFileSync(OUT, 'utf8')); if (m) salt = new Uint8Array(Buffer.from(m[1], 'base64')); }
if (!salt) salt = webcrypto.getRandomValues(new Uint8Array(16));
const iv = webcrypto.getRandomValues(new Uint8Array(12)); // новый на каждую сборку: по нему страница входа узнаёт, что устарела
const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(NORM), 'PBKDF2', false, ['deriveKey']);
const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(html)));

const page = writeGate({ salt: b64(salt), iv: b64(iv), iter: ITER, data: b64(ct), from });
console.log(`Готово: ${OUT} (${(page.length / 1024).toFixed(0)} КБ), ${from || SRC}, правок: 11`);
