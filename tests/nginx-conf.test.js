// ==============================
// LA CONFIGURACION DE NGINX — tests/nginx-conf.test.js
// ==============================
// infra/nginx/macroreborn.conf es una copia versionada de la del VPS. No
// se ejecuta aqui, pero se puede leer, y hay una trampa que ya mordio una
// vez y que se ve leyendo:
//
//   UN add_header DENTRO DE UN location CANCELA TODOS LOS DEL server. No
//   solo el que repite: todos. El 21/09/2026 se midio que /prendas/, las
//   imagenes y el css y js salian con CERO de las cuatro cabeceras de
//   seguridad, porque cada uno añadia la suya. Cada location que ponga
//   una cabecera tiene que repetir las cuatro.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CONF = fs.readFileSync(path.join(__dirname, "..", "infra", "nginx", "macroreborn.conf"), "utf8");

const SEGURIDAD = [
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Strict-Transport-Security"
];

// Cada bloque location con su cuerpo, contando llaves para no cortarlo
// en un bloque de dentro. Los comentarios se quitan antes: una llave o un
// add_header dentro de un comentario no cuentan.
function bloques() {
  const lineas = CONF.split(/\r?\n/).map(l => l.replace(/#.*$/, ""));
  const encontrados = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = /^\s*location\s+(.+?)\s*\{\s*$/.exec(lineas[i]);
    if (!m) continue;
    let nivel = 0, cuerpo = [];
    for (let j = i; j < lineas.length; j++) {
      nivel += (lineas[j].match(/\{/g) || []).length;
      nivel -= (lineas[j].match(/\}/g) || []).length;
      cuerpo.push(lineas[j]);
      if (nivel === 0) break;
    }
    encontrados.push({ cabeza: m[1], cuerpo: cuerpo.join("\n") });
  }
  return encontrados;
}

describe("nginx", () => {

  test("se leen los bloques", () => {
    assert.ok(bloques().length >= 8, "no se encontraron los location");
  });

  test("todo location que pone una cabecera repite las cuatro de seguridad", () => {
    for (const b of bloques()) {
      if (!/\badd_header\b/.test(b.cuerpo)) continue;
      for (const cabecera of SEGURIDAD) {
        assert.match(b.cuerpo, new RegExp("add_header\\s+" + cabecera + "\\b"),
          "location " + b.cabeza + " pone cabeceras pero le falta " + cabecera);
      }
    }
  });

  test("las previsualizaciones tienen su location, con ^~ y la cache de las prendas", () => {
    const b = bloques().find(x => x.cabeza === "^~ /previsualizaciones/");
    assert.ok(b, "no hay location para /previsualizaciones/");
    assert.match(b.cuerpo, /proxy_cache\s+prendas;/);
    assert.match(b.cuerpo, /proxy_pass\s+http:\/\/127\.0\.0\.1:3000;/);
  });

});
