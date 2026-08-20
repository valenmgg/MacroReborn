// ==============================
// MENÚ HAMBURGUESA (navbar mobile) - MacroReborn
// ==============================
// Escritorio: conserva exactamente el comportamiento previo.
// Móvil: crea una única lista completa para evitar que .nav-links y
// .nav-categorias se partan en dos paneles distintos.

(function () {
  let contadorNav = 0;

  function prepararNavbar(nav) {
    if (nav.querySelector('.nav-toggle')) return;

    const links = nav.querySelector('.nav-links');
    if (!links) return;

    const categorias = nav.querySelector('.nav-categorias');

    if (!links.id) {
      contadorNav += 1;
      links.id = 'navLinksPrincipal' + contadorNav;
    }

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'nav-toggle';
    boton.setAttribute('aria-label', 'Abrir menú de navegación');
    boton.setAttribute('aria-expanded', 'false');
    boton.setAttribute('aria-controls', links.id);
    boton.innerHTML = '<span class="nav-toggle-barra" aria-hidden="true"></span><span class="nav-toggle-label">Menú</span>';

    nav.insertBefore(boton, links);

    let panel = null;

    function esMovil() {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    function crearPanelMovil() {
      if (panel) return panel;

      panel = document.createElement('div');
      panel.className = 'nav-mobile-menu';
      panel.setAttribute('aria-label', 'Navegación móvil');

      function agregarDesde(origen) {
        if (!origen) return;
        origen.querySelectorAll(':scope > a').forEach((link) => {
          const copia = document.createElement('a');
          copia.href = link.getAttribute('href') || '#';
          copia.textContent = (link.textContent || '').trim();
          copia.className = 'nav-mobile-item';
          if (link.classList.contains('activa-nav') || link.classList.contains('activo')) {
            copia.classList.add('activa-nav');
          }
          if (link.target) copia.target = link.target;
          panel.appendChild(copia);
        });
      }

      // nav-categorias contiene las 9 entradas finales de la navbar,
      // después de que navbar.js haya movido ahí las primeras.
      agregarDesde(categorias);

      const separador = document.createElement('div');
      separador.className = 'nav-mobile-separador';
      separador.textContent = 'Cuenta y herramientas';

      const usuarioActivo = (window.MRSession && typeof MRSession.get === 'function')
        ? MRSession.get()
        : leerUsuarioActivo();

      const botonUsuario = nav.querySelector('#botonUsuarioMenu');
      const notificaciones = nav.querySelector('#notifBellWrap');
      const admin = nav.querySelector('#enlacePanelAdmin');

      if (usuarioActivo || botonUsuario || notificaciones || admin) {
        panel.appendChild(separador);

        if (notificaciones) {
          agregarItem('🔔 Notificaciones', 'notificaciones.html');
        }

        // Acceso directo y claro al perfil del usuario.
        agregarItem('👤 Mi perfil', 'perfil.html');

        if (admin) {
          agregarItem((admin.textContent || '🛠️ Panel Admin').trim(), admin.getAttribute('href') || 'admin.html');
        }
      }

      nav.appendChild(panel);
      return panel;

      function agregarItem(texto, href) {
        const a = document.createElement('a');
        a.href = href || '#';
        a.textContent = texto;
        a.className = 'nav-mobile-item';
        panel.appendChild(a);
      }
    }

    function leerUsuarioActivo() {
      try {
        return JSON.parse(localStorage.getItem('usuarioActivo') || 'null');
      } catch (_) {
        return null;
      }
    }

    function cerrarMenu() {
      links.classList.remove('nav-abierto');
      if (categorias) categorias.classList.remove('nav-abierto');
      nav.classList.remove('nav-menu-abierto');
      if (panel) panel.classList.remove('abierto');
      boton.setAttribute('aria-expanded', 'false');
      boton.setAttribute('aria-label', 'Abrir menú de navegación');
    }

    function abrirMenu() {
      if (esMovil()) {
        const panelMovil = crearPanelMovil();
        if (panelMovil) {
          panelMovil.classList.add('abierto');
          panelMovil.scrollTop = 0;
        }
        // Nunca mostramos simultáneamente los dos menús antiguos.
        links.classList.remove('nav-abierto');
        if (categorias) categorias.classList.remove('nav-abierto');
      } else {
        // Comportamiento de escritorio intacto.
        links.classList.add('nav-abierto');
        if (categorias) categorias.classList.add('nav-abierto');
      }

      nav.classList.add('nav-menu-abierto');
      boton.setAttribute('aria-expanded', 'true');
      boton.setAttribute('aria-label', 'Cerrar menú de navegación');
    }

    function alternarMenu() {
      const abierto = boton.getAttribute('aria-expanded') === 'true';
      if (abierto) cerrarMenu();
      else abrirMenu();
    }

    boton.addEventListener('click', function (e) {
      e.stopPropagation();
      alternarMenu();
    });

    links.addEventListener('click', function (e) {
      if (e.target.closest('a')) cerrarMenu();
    });

    if (categorias) {
      categorias.addEventListener('click', function (e) {
        if (e.target.closest('a')) cerrarMenu();
      });
    }

    nav.addEventListener('click', function (e) {
      if (e.target.closest('.nav-mobile-menu a')) cerrarMenu();
    });

    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target)) cerrarMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') cerrarMenu();
    });

    window.addEventListener('resize', function () {
      cerrarMenu();
    });
  }

  function iniciar() {
    document.querySelectorAll('.navbar').forEach(prepararNavbar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
