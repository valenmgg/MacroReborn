// =========================
// MOTOR ESTADÍSTICAS
// =========================

function obtenerEstadisticas() {

    const usuario = (window.MRSession && typeof MRSession.get === "function")
        ? MRSession.get()
        : leerJSON(localStorage.getItem("usuarioActivo") || "null");

    if (!usuario) return null;

    const clave =
        "estadisticas_" + usuario.nombre;

    let datos = leerJSON(
        localStorage.getItem(clave)
    );

    if (!datos) {

        datos = {

            partidas: 0,

            tiempo: 0,

            juegoFavorito: null,

            ultimaPartida: null

        };

        localStorage.setItem(
            clave,
            JSON.stringify(datos)
        );

    }

    return datos;

}



function guardarEstadisticas(datos) {

    const usuario = (window.MRSession && typeof MRSession.get === "function")
        ? MRSession.get()
        : leerJSON(localStorage.getItem("usuarioActivo") || "null");

    if (!usuario) return;

    localStorage.setItem(

        "estadisticas_" + usuario.nombre,

        JSON.stringify(datos)

    );

}