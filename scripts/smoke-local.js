const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const LIMITE_LOG = 20000;

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buscarPuertoLibre() {
  return new Promise((resolve, reject) => {
    const sonda = net.createServer();
    sonda.unref();
    sonda.once("error", reject);
    sonda.listen(0, "127.0.0.1", () => {
      const direccion = sonda.address();
      const puerto = direccion.port;
      sonda.close(error => error ? reject(error) : resolve(puerto));
    });
  });
}

// Abre una conexion de avisos en vivo y recoge lo que llegue por ella.
// No es pedir() porque esa respuesta NO TERMINA: pedir() espera al "end"
// y aqui no llega nunca.
function abrirAvisos(puerto, canales) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: "127.0.0.1",
      port: puerto,
      path: "/api/avisos?canales=" + encodeURIComponent(canales),
      headers: { Accept: "text/event-stream" }
    }, res => {
      const trozos = [];
      res.setEncoding("utf8");
      res.on("data", t => trozos.push(t));
      resolve({
        codigo: res.statusCode,
        headers: res.headers,
        texto: () => trozos.join(""),
        cerrar: () => res.destroy()
      });
    });
    req.once("error", reject);
  });
}

function pedir(puerto, ruta, opciones = {}) {
  const metodo = opciones.metodo || "GET";
  const cuerpo = opciones.cuerpo === undefined
    ? null
    : Buffer.from(JSON.stringify(opciones.cuerpo));
  const headers = {
    ...(opciones.headers || {})
  };

  if (cuerpo) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = cuerpo.length;
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: puerto,
      path: ruta,
      method: metodo,
      headers: Object.keys(headers).length ? headers : undefined
    }, res => {
      const trozos = [];
      res.on("data", trozo => trozos.push(trozo));
      res.on("end", () => {
        const texto = Buffer.concat(trozos).toString("utf8");
        let json = null;

        if ((res.headers["content-type"] || "").includes("application/json")) {
          try {
            json = JSON.parse(texto);
          } catch (error) {
            return reject(new Error(`Respuesta JSON invalida en ${ruta}: ${error.message}`));
          }
        }

        resolve({ codigo: res.statusCode, texto, json });
      });
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error(`Timeout al pedir ${ruta}`));
    });
    req.once("error", reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

async function esperarServidor(servidor, puerto) {
  const limite = Date.now() + 30000;
  let ultimoError = null;

  while (Date.now() < limite) {
    if (servidor.exitCode !== null) {
      throw new Error(`El servidor local termino antes de arrancar (codigo ${servidor.exitCode})`);
    }

    try {
      const respuesta = await pedir(puerto, "/");
      if (respuesta.codigo === 200) return;
    } catch (error) {
      ultimoError = error;
    }

    await dormir(150);
  }

  throw new Error(`El servidor local no respondio a tiempo: ${ultimoError?.message || "sin detalle"}`);
}

function esperarSalida(proceso, ms) {
  return new Promise(resolve => {
    if (proceso.exitCode !== null) return resolve(true);

    let terminado = false;
    const finalizar = valor => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      proceso.removeListener("exit", alSalir);
      resolve(valor);
    };
    const alSalir = () => finalizar(true);
    const temporizador = setTimeout(() => finalizar(false), ms);

    proceso.once("exit", alSalir);
  });
}

async function detenerServidor(servidor) {
  if (servidor.exitCode !== null) return;

  servidor.kill();
  if (await esperarSalida(servidor, 3000)) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(servidor.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
  } else {
    servidor.kill("SIGKILL");
  }

  if (!await esperarSalida(servidor, 3000)) {
    throw new Error(`No se pudo detener el servidor local (PID ${servidor.pid})`);
  }
}

function acumularLog(actual, trozo) {
  const combinado = actual + trozo.toString("utf8");
  return combinado.slice(-LIMITE_LOG);
}

async function main() {
  const puerto = await buscarPuertoLibre();
  let salida = "";
  let errores = "";
  const servidor = spawn(process.execPath, ["scripts/servidor-local.js"], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(puerto),
      SESSION_SECRET: process.env.SESSION_SECRET || "smoke-session-secret"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  servidor.stdout.on("data", trozo => { salida = acumularLog(salida, trozo); });
  servidor.stderr.on("data", trozo => { errores = acumularLog(errores, trozo); });

  try {
    await esperarServidor(servidor, puerto);

    const login = await pedir(puerto, "/api/auth?action=login", {
      metodo: "POST",
      cuerpo: { username: "demo", password: "demo1234" }
    });
    assert.equal(login.codigo, 200);
    assert.equal(login.json?.success, true, "el login local debe funcionar");
    assert.equal(typeof login.json?.token, "string", "el login debe devolver un token");

    const pulso = {
      metodo: "POST",
      cuerpo: { username: "demo", cantidad: 10, gameId: "smoke-local" },
      headers: { authorization: `Bearer ${login.json.token}` }
    };
    const primero = await pedir(puerto, "/api/users?action=xp", pulso);
    assert.equal(primero.codigo, 200);
    assert.equal(primero.json?.success, true, "el primer pulso de XP debe funcionar");
    assert.equal(primero.json?.monedas?.otorgado, true, "el primer pulso debe otorgar monedas");
    assert.equal(Number.isInteger(primero.json?.monedas?.monto), true);
    assert.ok(primero.json.monedas.monto >= 10 && primero.json.monedas.monto <= 30);
    assert.equal(typeof primero.json?.monedas?.saldoNuevo, "number");

    const segundo = await pedir(puerto, "/api/users?action=xp", pulso);
    assert.equal(segundo.codigo, 200);
    assert.equal(segundo.json?.success, true, "el segundo pulso de XP debe seguir funcionando");
    assert.equal(segundo.json?.monedas?.otorgado, false);
    assert.equal(segundo.json?.monedas?.monto, 0);
    assert.equal(segundo.json?.monedas?.razon, "aun-no-pasaron-10-minutos");
    assert.equal(segundo.json?.monedas?.saldoNuevo, primero.json?.monedas?.saldoNuevo);

    // ----- Avisos en vivo -----
    // La unica comprobacion que ejercita la cadena entera: el endpoint que
    // sostiene la conexion, el reparto de api/_avisos.js y el sitio que
    // emite. Las suites de tests prueban cada pieza por separado y ninguna
    // las prueba juntas.
    const avisos = await abrirAvisos(puerto, "notificaciones-demo");
    assert.equal(avisos.codigo, 200, "la conexion de avisos debe abrir");
    assert.match(avisos.headers["content-type"] || "", /text\/event-stream/);
    // Sin esta cabecera nginx se queda la respuesta en su buffer y no
    // suelta un byte hasta que termine, que en esta no pasa nunca.
    assert.equal(avisos.headers["x-accel-buffering"], "no");

    // Un momento para que quede apuntada antes de disparar el aviso.
    await dormir(300);

    const latido = await pedir(puerto, "/api/users?action=heartbeat", {
      metodo: "POST",
      cuerpo: { username: "demo" },
      headers: { authorization: `Bearer ${login.json.token}` }
    });
    assert.equal(latido.codigo, 200);
    assert.equal(latido.json?.success, true, "el latido debe funcionar");

    await dormir(700);

    const recibido = avisos.texto();
    avisos.cerrar();

    assert.ok(recibido.includes("event: latido"),
      "el aviso no llego por la conexion abierta; llego: " + JSON.stringify(recibido));

    const lineaDatos = recibido.split("\n").find(l => l.startsWith("data: "));
    const sobre = JSON.parse(lineaDatos.slice("data: ".length));
    assert.equal(sobre.canal, "notificaciones-demo", "el aviso debe decir por que canal vino");
    assert.ok(sobre.datos?.last_login, "el latido debe traer la ultima conexion");

    console.log(`Smoke local OK en puerto efimero ${puerto}`);
    console.log(`Login, XP y monedas verificados (primer monto: ${primero.json.monedas.monto})`);
    console.log("Avisos en vivo verificados: la linea abre y el latido llega por ella");
  } catch (error) {
    const detalle = [salida.trim(), errores.trim()].filter(Boolean).join("\n");
    if (detalle) error.message += `\n\nSalida del servidor:\n${detalle}`;
    throw error;
  } finally {
    await detenerServidor(servidor);
  }
}

main().catch(error => {
  console.error(`Smoke local FALLIDO: ${error.message}`);
  process.exitCode = 1;
});
