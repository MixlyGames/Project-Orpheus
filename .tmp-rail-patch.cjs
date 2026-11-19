const fs = require("fs");

const file = "index.html";
let src = fs.readFileSync(file, "utf8");
const crlf = src.includes("\r\n");
src = src.replace(/\r\n/g, "\n");

const startMark = '          <div class="rail" id="rail">';
const panelMark = '<aside class="rail-panel"';
const endMark = "</aside>";

const start = src.indexOf(startMark);
const panel = src.indexOf(panelMark);
if (start < 0 || panel < 0 || panel < start) throw new Error("Не нашёл блок рейки/панели");
const end = src.indexOf(endMark, panel);
if (end < 0) throw new Error("Не нашёл конец панели");
const endAbs = end + endMark.length;

const STAR =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C12.8 8.2 15.8 11.2 22 12C15.8 12.8 12.8 15.8 12 22C11.2 15.8 8.2 12.8 2 12C8.2 11.2 11.2 8.2 12 2Z" /></svg>';
const SVG16 =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

const block = `          <aside class="rail" id="rail" aria-label="Панель чатов">
            <button class="rail-item rail-toggle" id="rail-toggle" type="button" aria-expanded="false" aria-controls="rail-list" aria-label="Открыть панель чатов" title="Панель чатов">
              ${STAR}
              <span class="rail-label rail-brand">Орфея</span>
            </button>
            <button class="rail-item" type="button" data-rail-go="stub" data-rail-mode="chat" title="Пустота">
              ${SVG16}
                <rect x="2.5" y="3" width="11" height="10" rx="2.5" />
                <path d="M2.5 6.5h11M6.5 6.5V13" />
              </svg>
              <span class="rail-label">Пустота</span>
            </button>
            <button class="rail-item" type="button" data-rail-go="new" data-rail-mode="chat" title="Новый чат">
              ${SVG16}
                <path d="M9 3H5.5A2.5 2.5 0 0 0 3 5.5v5A2.5 2.5 0 0 0 5.5 13h5a2.5 2.5 0 0 0 2.5-2.5V7" />
                <path d="M12.2 2.8a1.2 1.2 0 0 1 1.7 1.7L8.5 9.9l-2.2.5.5-2.2z" />
              </svg>
              <span class="rail-label">Новый чат</span>
            </button>
            <button class="rail-item" type="button" data-rail-go="chat" data-rail-mode="stub" title="Чат">
              ${SVG16}
                <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11h-.5A1.5 1.5 0 0 1 3 9.5z" />
              </svg>
              <span class="rail-label">Чат</span>
            </button>

            <div class="rail-chats" data-rail-mode="chat" inert>
              <p class="rail-sub">Чаты</p>
              <div class="rail-list" id="rail-list"></div>
            </div>
          </aside>`;

let out = src.slice(0, start) + block + src.slice(endAbs);

// Комментарий над рейкой.
out = out.replace(
  /<!-- Рейка: свёрнутая панель чатов\.[\s\S]*?-->/,
  "<!-- Рейка: один элемент. Свёрнутая показывает иконки, раскрытая (кнопка со звездой) растёт в панель\n               с подписями и списком чатов поверх чата. Набор кнопок зависит от режима (data-mode).\n               Закрывается по клику снаружи и Esc. Логика в src/rail.ts. -->",
);

if (crlf) out = out.replace(/\n/g, "\r\n");
fs.writeFileSync(file, out, "utf8");
console.log("OK: блок заменён, строк было", src.slice(start, endAbs).split("\n").length);
