// ==============================
// LA FIRMA DE LAS PRENDAS SUELTAS — tests/prendas-firma.test.js
// ==============================
// Fase 5 de docs/AVATARES-SERVIDOR.md: /prendas/<huella>.png solo
// contesta con una firma que reparte el panel del equipo de arte. Ver
// api/_prendas-firma.js. La ruta que la exige se prueba en
// tests/avatar-prenda.test.js; aquí, la firma misma.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, describe } = require("node:test");
const assert = require("node:assert");

const F = require("../api/_prendas-firma");

const HUELLA = "a".repeat(64);
const partes = url => {
  const u = new URL(url, "https://macroreborn.com");
  return { ruta: u.pathname, hasta: u.searchParams.get("hasta"), firma: u.searchParams.get("firma") };
};

// Las 12:01 de un día cualquiera, en milisegundos.
const DOCE = Date.UTC(2026, 8, 24, 12, 1, 0);

describe("la firma de una prenda", () => {

  test("la dirección es la de siempre, con la caducidad y la firma", () => {
    const p = partes(F.firmar(HUELLA, DOCE));
    assert.equal(p.ruta, "/prendas/" + HUELLA + ".png");
    assert.match(p.hasta, /^\d+$/);
    assert.match(p.firma, /^[a-f0-9]{32}$/);
  });

  test("vale para esa prenda mientras no caduque", () => {
    const p = partes(F.firmar(HUELLA, DOCE));
    assert.equal(F.valida(HUELLA, p.hasta, p.firma, DOCE), true);
    assert.equal(F.valida(HUELLA, p.hasta, p.firma, DOCE + 5 * 3600 * 1000), true);
  });

  test("y deja de valer al caducar, entre seis y siete horas después", () => {
    const p = partes(F.firmar(HUELLA, DOCE));
    const dura = Number(p.hasta) - DOCE / 1000;
    assert.ok(dura >= F.DURACION_S && dura <= F.DURACION_S + 3600, "dura " + dura + " s");
    assert.equal(F.valida(HUELLA, p.hasta, p.firma, (Number(p.hasta) + 1) * 1000), false);
  });

  test("todo lo firmado en la misma hora sale con la misma dirección", () => {
    // Así el navegador del equipo de arte la reutiliza de su caché en
    // vez de volver a bajar cada dibujo en cada visita al panel.
    assert.equal(F.firmar(HUELLA, DOCE), F.firmar(HUELLA, DOCE + 40 * 60 * 1000));
  });

  test("no vale para otra prenda, ni tocando la caducidad", () => {
    const p = partes(F.firmar(HUELLA, DOCE));
    assert.equal(F.valida("b".repeat(64), p.hasta, p.firma, DOCE), false);
    assert.equal(F.valida(HUELLA, String(Number(p.hasta) + 3600), p.firma, DOCE), false);
  });

  test("lo que no tiene forma de firma se rechaza sin más", () => {
    const p = partes(F.firmar(HUELLA, DOCE));
    for (const [h, hasta, firma] of [
      ["", p.hasta, p.firma], [HUELLA, "", p.firma], [HUELLA, p.hasta, ""],
      [HUELLA, "12a", p.firma], [HUELLA, p.hasta, "Z".repeat(32)], [HUELLA, p.hasta, p.firma + "0"],
      [undefined, undefined, undefined]
    ]) {
      assert.equal(F.valida(h, hasta, firma, DOCE), false, JSON.stringify([h, hasta, firma]));
    }
  });

  test("otra clave, otra firma", () => {
    const p = partes(F.firmar(HUELLA, DOCE));
    const antes = process.env.SESSION_SECRET;
    try {
      process.env.SESSION_SECRET = "otro-secreto";
      assert.equal(F.valida(HUELLA, p.hasta, p.firma, DOCE), false);
    } finally {
      process.env.SESSION_SECRET = antes;
    }
  });

  test("el navegador la guarda como mucho lo que le queda", () => {
    const p = partes(F.firmar(HUELLA, DOCE));
    assert.equal(F.segundosRestantes(p.hasta, DOCE), Number(p.hasta) - DOCE / 1000);
    assert.equal(F.segundosRestantes(p.hasta, (Number(p.hasta) + 60) * 1000), 0);
  });

});
