// ==============================
// LAS PRENDAS SUELTAS, SOLO CON FIRMA — api/_prendas-firma.js
// ==============================
// Fase 5 de docs/AVATARES-SERVIDOR.md: el dibujo suelto de una prenda,
// /prendas/<huella>.png, deja de servirse a cualquiera. Solo lo ven el
// equipo de arte y los administradores, que lo necesitan en el panel, el
// taller y el vestidor. El resto del sitio enseña los avatares ya
// compuestos y las previsualizaciones, que no son el dibujo suelto.
//
// El obstáculo es que esas herramientas lo pintan con <img src>, y una
// etiqueta <img> no manda la sesión: la sesión viaja en la cabecera
// Authorization, que la pone fetch y no el navegador. Así que la sesión
// se comprueba ANTES, al pedir el panel (avatar-panel ya exige el rol de
// arte), y lo que el panel devuelve son direcciones firmadas:
//
//     /prendas/<huella>.png?hasta=<segundos>&firma=<hmac>
//
// La firma es un HMAC de la huella y la caducidad, con una clave sacada
// del secreto de las sesiones. Sin ella, con otra huella o caducada, el
// servidor contesta 403.
//
// La caducidad se redondea a la hora y dura entre seis y siete: todo lo
// que se firme dentro de la misma hora sale con la MISMA dirección, y el
// navegador la reutiliza de su caché en vez de volver a bajar cada
// dibujo en cada visita al panel.

const crypto = require("crypto");

const HORA_S = 3600;
const DURACION_S = 6 * HORA_S;

// Una clave derivada y no el secreto tal cual: una firma de prenda no
// puede servir para ninguna otra cosa. El secreto sale de donde lo saca
// getSecret() en api/_auth.js, con su mismo respaldo, para que las dos
// cosas no puedan dejar de coincidir en ningún despliegue.
function clave() {
  const secreto = process.env.SESSION_SECRET || process.env.DATABASE_URL;
  if (!secreto) throw new Error("Falta SESSION_SECRET para firmar las prendas");
  return crypto.createHmac("sha256", String(secreto)).update("prendas-sueltas").digest();
}

function calcular(huella, hasta) {
  return crypto.createHmac("sha256", clave())
    .update(huella + "." + hasta)
    .digest("hex")
    .slice(0, 32);
}

function enSegundos(ahora) {
  return Math.floor((ahora === undefined ? Date.now() : ahora) / 1000);
}

// La dirección firmada de una prenda.
function firmar(huella, ahora) {
  const hasta = Math.ceil((enSegundos(ahora) + DURACION_S) / HORA_S) * HORA_S;
  return "/prendas/" + huella + ".png?hasta=" + hasta + "&firma=" + calcular(huella, hasta);
}

// ¿Vale esta firma para esta huella, ahora?
function valida(huella, hasta, firma, ahora) {
  if (!/^[a-f0-9]{64}$/.test(String(huella || ""))) return false;
  if (!/^\d{1,12}$/.test(String(hasta || ""))) return false;
  if (!/^[a-f0-9]{32}$/.test(String(firma || ""))) return false;
  if (Number(hasta) < enSegundos(ahora)) return false;

  const esperada = Buffer.from(calcular(huella, Number(hasta)), "hex");
  const recibida = Buffer.from(String(firma), "hex");
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

// Lo que le queda de vida, en segundos: es lo que el navegador puede
// guardarla. Nunca más, o la seguiría enseñando ya caducada.
function segundosRestantes(hasta, ahora) {
  return Math.max(0, Number(hasta) - enSegundos(ahora));
}

module.exports = {
  DURACION_S,
  firmar,
  valida,
  segundosRestantes
};
