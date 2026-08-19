// MacroReborn - modal global inspirado en MorphoKeyRequired de Morpho Dimension.
// No depende de React/Headless UI y respeta los temas actuales de MacroReborn.
(function(){
  "use strict";

  const ROOT_ID = "mrModalRoot";
  const STYLE_CLASS = "mr-modal-open";

  function escapeHtml(value){
    return String(value == null ? "" : value)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function cerrar(root){
    if(!root) return;
    root.remove();
    document.documentElement.classList.remove(STYLE_CLASS);
  }

  function mostrar(options){
    options = options || {};

    const titulo = escapeHtml(options.title || "Aviso");
    const mensaje = escapeHtml(options.message || "");
    const icono = escapeHtml(options.icon || "🔒");
    const botonTexto = escapeHtml(options.buttonText || "Entendido");
    const closeOnOverlay = options.closeOnOverlay !== false;

    const anterior = document.getElementById(ROOT_ID);
    if(anterior) cerrar(anterior);

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "mr-modal-root";
    root.setAttribute("role", "presentation");
    root.innerHTML = `
      <div class="mr-modal-backdrop" data-mr-modal-close="overlay"></div>
      <div class="mr-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="mrModalTitle" tabindex="-1">
        <button type="button" class="mr-modal-close" aria-label="Cerrar" data-mr-modal-close="button">×</button>
        <div class="mr-modal-icon" aria-hidden="true">${icono}</div>
        <h2 id="mrModalTitle" class="mr-modal-title">${titulo}</h2>
        <p class="mr-modal-message">${mensaje}</p>
        <button type="button" class="mr-modal-action" data-mr-modal-close="button">${botonTexto}</button>
      </div>`;

    const cerrarHandler = function(event){
      const target = event.target.closest("[data-mr-modal-close]");
      if(!target) return;
      if(target.getAttribute("data-mr-modal-close") === "overlay" && !closeOnOverlay) return;
      cerrar(root);
    };

    root.addEventListener("click", cerrarHandler);
    root.addEventListener("keydown", function(event){
      if(event.key === "Escape") cerrar(root);
    });

    document.body.appendChild(root);
    document.documentElement.classList.add(STYLE_CLASS);
    const dialog = root.querySelector(".mr-modal-dialog");
    if(dialog) dialog.focus();

    return function(){ cerrar(root); };
  }

  window.MRModal = { show: mostrar, close: function(){ cerrar(document.getElementById(ROOT_ID)); } };
})();
