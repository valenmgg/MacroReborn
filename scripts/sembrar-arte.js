// ==============================
// UN CATÁLOGO DE ARTE DE MENTIRA — scripts/sembrar-arte.js
// ==============================
// El panel de arte y el vestidor no se podían probar en local: el
// servidor local solo enrutaba /api/auth y /api/users, y aunque enrutara
// /api/content, la base local nace con el catálogo vacío.
//
// Esto siembra lo justo para que haya algo que vestir: dos personajes y
// unas cuantas prendas de colores, dibujadas acá mismo. No hace falta
// ninguna librería de imagen: un PNG de color plano se arma con zlib, que
// viene con Node, y así el servidor local sigue sin dependencias nuevas.
//
// Las medidas NO son todas 327x504 a propósito. El catálogo de verdad
// tiene 64 dibujos fuera de medida (ver docs/DESARROLLO.md, "El lienzo del
// catálogo"), así que la base local trae los mismos casos raros: si el
// vestidor los pinta mal, se ve en local y no en producción.

const crypto = require("crypto");
const zlib = require("zlib");

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo) >>> 0);
  return Buffer.concat([largo, cuerpo, crc]);
}

const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

// Un PNG RGBA de color plano, con un recuadro transparente en el medio
// para que se note que las capas se superponen de verdad.
function pngPlano(ancho, alto, [r, g, b, a], hueco) {
  const filas = [];
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 4);   // 1 byte de filtro por fila
    for (let x = 0; x < ancho; x++) {
      const dentro = hueco &&
        x > ancho * hueco[0] && x < ancho * hueco[1] &&
        y > alto * hueco[2] && y < alto * hueco[3];
      const i = 1 + x * 4;
      fila[i] = r; fila[i + 1] = g; fila[i + 2] = b;
      fila[i + 3] = dentro ? 0 : a;
    }
    filas.push(fila);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;    // bits por canal
  ihdr[9] = 6;    // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    trozo("IHDR", ihdr),
    trozo("IDAT", zlib.deflateSync(Buffer.concat(filas))),
    trozo("IEND", Buffer.alloc(0))
  ]);
}

// El catálogo de mentira. Las medidas raras son las del catálogo real.
const PIEZAS = [
  { valor: "tora", modelo: "tora", capa: "modelo", nombre: "Tora", color: [90, 110, 160, 255], medida: [327, 504], hueco: [0.2, 0.8, 0.15, 0.85] },
  { valor: "cereza", modelo: "cereza", capa: "modelo", nombre: "Cereza", color: [160, 80, 110, 255], medida: [326, 503], hueco: [0.2, 0.8, 0.15, 0.85] },

  { valor: "tora_fondo1", modelo: "tora", capa: "fondo", nombre: "Fondo azul", color: [30, 50, 90, 255], medida: [327, 504] },
  // Un fondo de 327x505, como los doce del lote real.
  { valor: "tora_fondo2", modelo: "tora", capa: "fondo", nombre: "Fondo violeta (505)", color: [70, 40, 90, 255], medida: [327, 505] },

  { valor: "tora_piel1", modelo: "tora", capa: "piel", nombre: "Piel clara", color: [230, 200, 170, 200], medida: [327, 504], hueco: [0.3, 0.7, 0.3, 0.7] },
  { valor: "tora_ojos1", modelo: "tora", capa: "ojos", nombre: "Ojos", color: [20, 20, 30, 255], medida: [327, 504], hueco: [0.1, 0.9, 0.1, 0.35] },
  { valor: "tora_boca1", modelo: "tora", capa: "boca", nombre: "Boca", color: [180, 60, 60, 255], medida: [327, 504], hueco: [0.1, 0.9, 0.55, 0.95] },
  { valor: "tora_pelo1", modelo: "tora", capa: "pelo", nombre: "Pelo largo", color: [120, 70, 30, 220], medida: [327, 504], hueco: [0.2, 0.8, 0.4, 1] },
  { valor: "tora_pelo2", modelo: "tora", capa: "pelo", nombre: "Pelo corto (503)", color: [40, 40, 40, 220], medida: [326, 503], hueco: [0.25, 0.75, 0.45, 1] },
  { valor: "tora_remera1", modelo: "tora", capa: "remera", nombre: "Remera roja", color: [190, 60, 60, 230], medida: [327, 504], hueco: [0.1, 0.9, 0, 0.45] },
  { valor: "tora_pantalon1", modelo: "tora", capa: "pantalon", nombre: "Pantalón", color: [50, 60, 120, 230], medida: [327, 504], hueco: [0.1, 0.9, 0, 0.62] },
  { valor: "tora_botas1", modelo: "tora", capa: "botas", nombre: "Botas", color: [70, 50, 40, 240], medida: [327, 504], hueco: [0.1, 0.9, 0, 0.82] },
  { valor: "tora_accesorio1", modelo: "tora", capa: "accesorio", nombre: "Gorro", color: [230, 180, 40, 240], medida: [327, 504], hueco: [0.1, 0.9, 0.22, 1] },
  // Y el bicho raro: el doble exacto, como cereza/espalda2.
  { valor: "tora_espalda1", modelo: "tora", capa: "espalda", nombre: "Alas (654x1010)", color: [200, 200, 230, 180], medida: [654, 1010], hueco: [0.25, 0.75, 0.1, 0.9] },

  { valor: "cereza_piel1", modelo: "cereza", capa: "piel", nombre: "Piel", color: [240, 210, 190, 200], medida: [326, 503], hueco: [0.3, 0.7, 0.3, 0.7] },
  { valor: "cereza_pelo1", modelo: "cereza", capa: "pelo", nombre: "Coletas", color: [190, 60, 90, 220], medida: [327, 505], hueco: [0.2, 0.8, 0.45, 1] },
  { valor: "cereza_remera1", modelo: "cereza", capa: "remera", nombre: "Vestido", color: [120, 80, 170, 230], medida: [326, 503], hueco: [0.12, 0.88, 0, 0.4] }
];

async function sembrarArte(db, username) {
  // ¿Ya está sembrado? Se siembra una vez y no se toca más.
  const hay = await db.query("SELECT count(*)::int AS n FROM avatar_prendas");
  if (hay.rows[0].n > 0) return { sembradas: 0, yaEstaba: hay.rows[0].n };

  for (const p of PIEZAS) {
    const bytes = pngPlano(p.medida[0], p.medida[1], p.color, p.hueco);
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");

    // Content-addressed, igual que en producción: si dos piezas fueran el
    // mismo dibujo, compartirían fila.
    let archivo = await db.query("SELECT id FROM avatar_archivos WHERE sha256 = $1", [sha]);
    if (!archivo.rows.length) {
      archivo = await db.query(
        `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [sha, bytes, p.medida[0], p.medida[1], bytes.length]
      );
    }

    await db.query(
      `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, autor_id, publicada)
       VALUES ($1, $2, $3, $4, $5, NULL, true)
       ON CONFLICT (valor) DO NOTHING`,
      [p.valor, p.modelo, p.capa, p.nombre, archivo.rows[0].id]
    );
  }

  await db.query("UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1");

  // Y el rol, o el panel echa a quien entre. Se le da "administrador"
  // porque así también se puede retirar arte del catálogo original.
  const usuario = await db.query("SELECT id FROM users WHERE username = $1", [username]);
  if (usuario.rows.length) {
    for (const badge of ["artista", "administrador"]) {
      await db.query(
        `INSERT INTO badges (user_id, badge_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [usuario.rows[0].id, badge]
      );
    }
  }

  return { sembradas: PIEZAS.length, yaEstaba: 0 };
}

module.exports = { sembrarArte, pngPlano };
