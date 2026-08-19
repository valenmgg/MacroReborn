// ============================================
// MacroReborn — cliente API unificado
// Inspirado en la capa Api de Morpho Dimension.
//
// IMPORTANTE:
// - No reemplaza window.fetch ni modifica los endpoints existentes.
// - js/core.js sigue siendo quien inyecta el Bearer token.
// - Es una capa opcional para que los módulos nuevos puedan usar una
//   interfaz consistente sin tocar el backend de Neon/Vercel.
// ============================================

(function (window) {
  "use strict";

  if (window.MRApi) return;

  class MRApiError extends Error {
    constructor(message, info) {
      super(message || "Error de API");
      this.name = "MRApiError";
      this.status = info && info.status != null ? info.status : 0;
      this.data = info ? info.data : null;
      this.url = info ? info.url : "";
    }
  }

  function construirQuery(params) {
    const query = new URLSearchParams();
    if (!params || typeof params !== "object") return query;

    Object.keys(params).forEach((clave) => {
      const valor = params[clave];
      if (valor === undefined || valor === null) return;

      if (Array.isArray(valor)) {
        valor.forEach((item) => query.append(clave, String(item)));
        return;
      }

      query.append(clave, String(valor));
    });

    return query;
  }

  async function leerRespuesta(respuesta, url) {
    const tipo = respuesta.headers.get("content-type") || "";
    let datos = null;

    try {
      datos = tipo.includes("application/json")
        ? await respuesta.json()
        : await respuesta.text();
    } catch (_) {
      datos = null;
    }

    if (!respuesta.ok) {
      const mensaje =
        (datos && typeof datos === "object" && (datos.error || datos.message)) ||
        "La solicitud no pudo completarse.";

      const error = new MRApiError(mensaje, {
        status: respuesta.status,
        data: datos,
        url
      });

      // No cerramos la sesión automáticamente. El sitio actual ya tiene
      // flujos propios para sesión/token y una API nueva no debe cambiar
      // ese comportamiento por sorpresa.
      if (respuesta.status === 401 || respuesta.status === 403) {
        window.dispatchEvent(new CustomEvent("macro:api-auth-error", {
          detail: { status: respuesta.status, data: datos, url }
        }));
      }

      throw error;
    }

    return datos;
  }

  async function request(metodo, path, opciones) {
    const opts = opciones || {};
    let url;

    try {
      url = new URL(path, window.location.origin);
    } catch (_) {
      throw new MRApiError("Ruta de API inválida.", { url: String(path || "") });
    }

    const query = construirQuery(opts.query);
    query.forEach((valor, clave) => url.searchParams.append(clave, valor));

    const headers = new Headers(opts.headers || {});
    let body = opts.body;

    if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== "string") {
      headers.set("Content-Type", headers.get("Content-Type") || "application/json");
      body = JSON.stringify(body);
    }

    const respuesta = await window.fetch(url.toString(), {
      method: metodo,
      headers,
      body,
      credentials: opts.credentials || "same-origin",
      signal: opts.signal
    });

    return leerRespuesta(respuesta, url.toString());
  }

  // Deduplica únicamente peticiones idénticas que están EN VUELO.
  // No conserva respuestas terminadas, por lo que no introduce datos
  // obsoletos: dos módulos que piden exactamente lo mismo al mismo tiempo
  // comparten la misma Promise y el servidor recibe una sola petición.
  const solicitudesCompartidas = new Map();

  async function requestShared(metodo, path, opciones) {
    const opts = opciones || {};
    const metodoNormalizado = String(metodo || "GET").toUpperCase();

    // Solo aplicamos la deduplicación a GET sin cuerpo.
    if (metodoNormalizado !== "GET" || (opts && opts.body != null)) {
      return request(metodoNormalizado, path, opts);
    }

    let url;
    try {
      url = new URL(path, window.location.origin);
    } catch (_) {
      return request(metodoNormalizado, path, opts);
    }

    const query = construirQuery(opts.query);
    query.forEach((valor, clave) => url.searchParams.append(clave, valor));

    const headers = new Headers(opts.headers || {});
    const key = [
      metodoNormalizado,
      url.toString(),
      headers.get("Authorization") || "",
      headers.get("Accept") || "",
      opts.credentials || "same-origin"
    ].join("\n");

    const existente = solicitudesCompartidas.get(key);
    if (existente) return existente;

    const promise = request(metodoNormalizado, path, opts)
      .finally(() => {
        if (solicitudesCompartidas.get(key) === promise) {
          solicitudesCompartidas.delete(key);
        }
      });

    solicitudesCompartidas.set(key, promise);
    return promise;
  }

  const cliente = {
    Error: MRApiError,

    request,
    requestShared,

    get(path, query, opciones) {
      return request("GET", path, {
        ...(opciones || {}),
        query: query || (opciones && opciones.query) || {}
      });
    },

    post(path, body, opciones) {
      return request("POST", path, { ...(opciones || {}), body });
    },

    put(path, body, opciones) {
      return request("PUT", path, { ...(opciones || {}), body });
    },

    patch(path, body, opciones) {
      return request("PATCH", path, { ...(opciones || {}), body });
    },

    delete(path, body, opciones) {
      return request("DELETE", path, { ...(opciones || {}), body });
    }
  };

  window.MRApi = cliente;
})(window);
