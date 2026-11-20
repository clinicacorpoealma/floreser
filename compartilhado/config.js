/* =====================================================================
   FloreSer · Corpo e Alma — configuração do site (lugar único)
   ---------------------------------------------------------------------
   O endereço do Apps Script mora AQUI e só aqui. Trocar a implantação é
   trocar esta linha; nenhum outro arquivo do site repete o endereço.

   Não há segredo neste arquivo: o endereço é público por natureza (o
   navegador precisa dele). Senhas e a pimenta ficam nas Script Properties.

   A raiz do site sai do próprio <script>: vale para a página na raiz e
   para as que moram numa pasta, por http e por file://, e debaixo de
   /floreser/ no GitHub Pages.
   ===================================================================== */

(function (global) {
  "use strict";

  var API_URL = "https://script.google.com/macros/s/AKfycbzy9WCfP4l08dn2h2K34uEL6e0mqFBjVMugcHiTc0oUGmpS7gOJjbxs58CB87AoFUw-/exec";

  var raiz = "";
  try {
    var src = document.currentScript && document.currentScript.src;
    if (src) raiz = String(src).replace(/compartilhado\/config\.js(\?.*)?$/, "");
  } catch (e) { raiz = ""; }

  var versao = "";
  try { versao = global.FLORESER.atual.versao; } catch (e) { versao = ""; }

  global.FLORESER_CONFIG = Object.freeze({
    apiUrl: API_URL,
    /* a versão do contrato que este site fala — a mesma de VERSAO_API no backend */
    api: 2,
    raiz: raiz,
    versao: versao,
    fuso: "America/Cuiaba",
    prazoLeituraMs: 30000,
    prazoGravacaoMs: 45000
  });
})(window);
