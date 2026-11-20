// Тестовая сборка «Смэш мне в ногу» → https://smash-v-nogu.github.io/test/
// Берёт index.html из ветки игры, включает «тестовый режим» и шифрует страницу паролем (AES-256-GCM, ключ — PBKDF2).
// Запуск: TEST_PASS='пароль' node build.mjs <путь к index.html ветки>   → index.html этой папки
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
const SRC = process.argv[2];
const PASS = process.env.TEST_PASS;
if (!SRC || !PASS) { console.error("Запуск: TEST_PASS='пароль' node build.mjs <путь к index.html ветки>"); process.exit(1); }
const ITER = 600000; // пароль без учёта регистра и пробелов по краям (телефон любит заглавную первую букву)
 // PBKDF2-SHA256, как советует OWASP; на телефоне — около секунды, потом ключ запоминается

let html = readFileSync(SRC, 'utf8');

// Откуда сборка: ветка и коммит — в подвал страницы входа и в отчёт
let from = '';
try {
  const dir = dirname(resolve(SRC));
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']).toString().trim();
  const br = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
  const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', 'index.html']).toString().trim();
  from = `${br} ${sha}${dirty ? ' + правки' : ''}`;
} catch (_) {}

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
const OUT = resolve(HERE, 'index.html');
const b64 = u8 => Buffer.from(u8).toString('base64');
let salt = null;
if (existsSync(OUT)) { const m = /data-salt="([A-Za-z0-9+/=]+)"/.exec(readFileSync(OUT, 'utf8')); if (m) salt = new Uint8Array(Buffer.from(m[1], 'base64')); }
if (!salt) salt = webcrypto.getRandomValues(new Uint8Array(16));
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(PASS.trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(html)));

const tpl = readFileSync(resolve(HERE, 'gate.html'), 'utf8');
const page = tpl
  .replace('%SALT%', b64(salt)).replace('%IV%', b64(iv)).replace('%ITER%', String(ITER))
  .replace('%FROM%', from.replace(/[<>&"]/g, ''))
  .replace('%DATA%', b64(ct));
writeFileSync(OUT, page);
console.log(`Готово: ${OUT} (${(page.length / 1024).toFixed(0)} КБ), сборка из ${from || SRC}, правок: 11`);
