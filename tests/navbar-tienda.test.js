// ==============================
// LA TIENDA EN LA BARRA — tests/navbar-tienda.test.js
// ==============================
// js/navbar.js añade "Tienda" detrás de "Juegos" en todas las páginas,
// en vez de copiarlo en el HTML de las veinticinco que tienen barra. Se
// evalúa el trozo de verdad sobre la barra de verdad de cada página.
//
// Correr:  npm test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const raiz = path.join(__dirname, "..");
// Sin los CR: en Windows, git deja la copia de trabajo en CRLF, y las
// marcas de abajo llevan saltos de línea.
const NAVBAR = fs.readFileSync(path.join(raiz, "js", "navbar.js"), "utf8").replace(/\r\n/g, "\n");
const DESDE = "    if(navCategorias && !navbar.dataset.retroPreparada){";
const HASTA = "        navbar.dataset.retroPreparada = \"1\";\n    }";

function prepararBarra(html) {
  const i = NAVBAR.indexOf(DESDE);
  const j = NAVBAR.indexOf(HASTA, i);
  assert.ok(i !== -1 && j > i, "no está el arreglo de la barra en js/navbar.js");

  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const w = dom.window;
  w.eval(`(function(){
    const navbar = document.querySelector(".navbar");
    const nav = navbar.querySelector(".nav-links");
    const navCategorias = navbar.querySelector(".nav-categorias");
    ${NAVBAR.slice(i, j + HASTA.length)}
  })();`);
  return [...w.document.querySelectorAll(".nav-categorias > a")].map(a => a.textContent.trim());
}

const paginas = fs.readdirSync(raiz).filter(f => f.endsWith(".html") &&
  fs.readFileSync(path.join(raiz, f), "utf8").includes('class="nav-categorias"'));

test("hay barras que probar", () => {
  assert.ok(paginas.length >= 20, "solo " + paginas.length + " páginas con barra");
  assert.ok(paginas.includes("tienda.html"));
});

for (const pagina of paginas) {
  test(pagina + ": la tienda sale una vez, detrás de Juegos", () => {
    const enlaces = prepararBarra(fs.readFileSync(path.join(raiz, pagina), "utf8"));
    assert.equal(enlaces.filter(t => t === "🛍️ Tienda").length, 1, enlaces.join(" | "));
    const juegos = enlaces.indexOf("🎮 Juegos");
    if (juegos !== -1) assert.equal(enlaces[juegos + 1], "🛍️ Tienda", enlaces.join(" | "));
  });
}

test("una página que ya la trae no la tiene dos veces", () => {
  const enlaces = prepararBarra(`<nav class="navbar"><div class="nav-links"></div>
    <div class="nav-categorias"><a href="juegos.html">🎮 Juegos</a><a href="tienda.html">🛍️ Tienda</a></div></nav>`);
  assert.equal(enlaces.filter(t => t.includes("Tienda")).length, 1);
});
