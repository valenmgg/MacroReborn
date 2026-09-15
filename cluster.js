// Arranca varias copias de server.js, una por nucleo, repartiendo las
// peticiones entre ellas.
//
// El VPS tiene 2 nucleos pero un solo proceso de Node usaba solo uno: bajo
// carga se veia a `node` al 90% de CPU con el segundo nucleo ocioso. Aqui no
// se cambia nada de la aplicacion, solo se lanza mas de una.
//
// Esto es seguro porque la app no guarda estado en memoria entre peticiones:
// las sesiones estan en Postgres, y los `Map`/`Set` que hay en los handlers
// son variables locales de cada llamada. Si algun dia se guarda algo en
// memoria y se espera que persista, dejara de serlo: cada proceso tendria su
// propia copia y las peticiones caerian en uno u otro.

const cluster = require("cluster");
const os = require("os");

// Un proceso por nucleo, pero nunca mas de 2: con 950 MB de RAM, cada copia
// ocupa unos 100 MB y hay que dejar sitio a Postgres.
const NUCLEOS = Math.min(os.cpus().length, 2);

if (cluster.isPrimary) {
  console.log(`[cluster] arrancando ${NUCLEOS} procesos`);

  for (let i = 0; i < NUCLEOS; i++) {
    cluster.fork();
  }

  // Si una copia muere, se levanta otra. systemd solo vigila al proceso
  // principal, asi que sin esto un fallo dejaria el sitio a media capacidad
  // sin que nadie se entere.
  cluster.on("exit", (worker, code, signal) => {
    console.error(
      `[cluster] proceso ${worker.process.pid} termino (${signal || code}); arrancando otro`
    );
    cluster.fork();
  });
} else {
  require("./server.js");
}
