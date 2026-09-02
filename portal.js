/* =====================================================================
   FloreSer · Corpo e Alma — comportamento do portal
   ---------------------------------------------------------------------
   A data no topo, o histórico de versões, a janela "Sobre o sistema", a
   faixa da busca global e a ligação com a conta de quem entrou.

   A apresentação fica no portal.css; a estrutura, no index.html.

   Depende, nesta ordem, de version.js, logs.js, pwa.js, auth.js e
   busca.js — e por isso entra depois deles, no mesmo ponto do documento
   onde o <script> estava.
   ===================================================================== */

(function () {
  "use strict";

  var dados = window.FLORESER || { changelog: [], categorias: [], rotulo: "" };
  var registrar = (window.FloreSerLogs && window.FloreSerLogs.registrar) || function () { };

  function esc(t) {
    return String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* A rolagem da página segue o estado real das janelas, e não o par
     abrir/fechar: em alguns navegadores o evento close do <dialog> não
     chega, e a página ficava travada depois de sair com ESC. */
  function sincronizarRolagem() {
    document.body.style.overflow = document.querySelector("dialog[open]") ? "hidden" : "";
  }

  function abrir(dialogo) {
    if (typeof dialogo.showModal === "function") dialogo.showModal();
    else dialogo.setAttribute("open", "");
    sincronizarRolagem();
  }

  function fechar(dialogo) {
    if (typeof dialogo.close === "function" && dialogo.open) dialogo.close();
    else dialogo.removeAttribute("open");
    sincronizarRolagem();
  }

  document.addEventListener("click", function (e) {
    var alvo = e.target.closest ? e.target.closest("[data-fecha]") : null;
    if (alvo) fechar(document.getElementById(alvo.getAttribute("data-fecha")));
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var abertos = document.querySelectorAll("dialog[open]");
    if (abertos.length && typeof abertos[0].showModal !== "function") fechar(abertos[0]);
    setTimeout(sincronizarRolagem, 0);
  });

  window.floreserRolagem = sincronizarRolagem;

  /* ---------------- data do cabeçalho ---------------- */

  (function () {
    var el = document.getElementById("topo-data");
    if (!el) return;
    try {
      var d = new Date();
      var texto = d.toLocaleDateString("pt-BR", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
      el.textContent = texto;
    } catch (erro) {
      el.textContent = "";
    }
  })();

  /* ---------------- versão e histórico ---------------- */

  var elVersao = document.getElementById("versao-atual");
  elVersao.textContent = dados.rotulo;

  var dlgHistorico = document.getElementById("historico");
  document.getElementById("historico-corpo").innerHTML = (dados.changelog || []).map(function (v) {
    var secoes = (dados.categorias || [])
      .filter(function (cat) { return v.mudancas[cat] && v.mudancas[cat].length; })
      .map(function (cat) {
        return "<h4>" + esc(cat) + "</h4><ul>" +
          v.mudancas[cat].map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") +
          "</ul>";
      }).join("");
    return '<article class="versao-bloco"><h3>v' + esc(v.versao) + " &mdash; " + esc(v.codinome) +
      '</h3><p class="data">' + esc(v.data) + "</p>" + secoes + "</article>";
  }).join("");

  document.getElementById("abrir-historico").addEventListener("click", function () {
    document.getElementById("historico-corpo").scrollTop = 0;
    abrir(dlgHistorico);
    registrar("HISTORICO_ABERTO", { mensagem: "Histórico de versões consultado" });
  });

  /* ---------------- sobre ---------------- */

  var dlgSobre = document.getElementById("sobre");
  var atual = dados.atual || {};

  document.getElementById("sobre-corpo").innerHTML =
    '<div class="sobre-intro"><strong>FloreSer &mdash; Corpo e Alma</strong>' +
    "Sistema interno desenvolvido para organizar e centralizar os processos da Clínica " +
    "Corpo e Alma, do primeiro contato com a cliente até o acompanhamento dos retornos.</div>" +

    '<div class="modulo">' +
    '<svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4" y="6" width="24" height="20" rx="3"/><path d="M4 11.5h24"/>' +
    '<circle cx="12.5" cy="17.2" r="2.5"/><path d="M8.2 22.8c.6-2.3 2.2-3.4 4.3-3.4s3.7 1.1 4.3 3.4"/>' +
    '<path d="M20.5 16.8h4M20.5 20.8h4"/></svg>' +
    "<div><h3>CRM</h3><p>Gerenciamento de leads, funil comercial, cadências de contato, " +
    "follow-ups e acompanhamento das conversões.</p></div></div>" +

    '<div class="modulo">' +
    '<svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4" y="7" width="24" height="21" rx="3"/><path d="M4 13.5h24"/>' +
    '<path d="M10.5 4.5v5M21.5 4.5v5"/><path d="M12 21.2l2.6 2.6 5.4-5.8"/></svg>' +
    "<div><h3>Agenda</h3><p>Gerenciamento das pacientes, ciclos por área, condições, retornos, " +
    "máquinas temporárias e acompanhamento dos atendimentos.</p></div></div>" +

    '<div class="modulo">' +
    '<svg width="20" height="20" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="8" width="26" height="16" rx="3"/><circle cx="16" cy="16" r="3.6"/>' +
    '<path d="M7.6 12.4v7.2M24.4 12.4v7.2"/></svg>' +
    "<div><h3>Entradas</h3><p>Registro do que entra por dia, com forma de pagamento, " +
    "parcelamento, filtros por período e exportação da planilha.</p></div></div>" +

    '<div class="ficha"><h4>Sistema</h4><dl>' +
    "<dt>Versão</dt><dd>v" + esc(atual.versao) + "</dd>" +
    "<dt>Codinome</dt><dd>" + esc(atual.codinome) + "</dd>" +
    "<dt>Publicada em</dt><dd>" + esc(atual.data) + "</dd>" +
    "<dt>Módulos</dt><dd>CRM &middot; Agenda &middot; Entradas</dd>" +
    "</dl></div>" +

    '<p class="assinatura">Tecnologia pensada para simplificar o cuidado, a organização e o ' +
    "crescimento da Corpo e Alma.</p>";

  document.getElementById("abrir-sobre").addEventListener("click", function () {
    abrir(dlgSobre);
    registrar("SOBRE_ABERTO", { mensagem: "Aba Sobre consultada" });
  });

  /* ---------------- saída para os módulos ---------------- */

  Array.prototype.forEach.call(document.querySelectorAll(".quadro"), function (a) {
    a.addEventListener("click", function () {
      var modulo = a.getAttribute("data-modulo");
      var evento = modulo === "CRM" ? "CRM_ACESSO"
        : modulo === "Entradas" ? "ENTRADAS_ACESSO" : "AGENDA_ACESSO";
      registrar(evento, { mensagem: "Saiu do portal para " + modulo });
      if (window.FloreSerLogs) window.FloreSerLogs.enviar();
    });
  });

  /* ================================================================
     Conta
     ----------------------------------------------------------------
     O portal não guarda permissão nenhuma: ele pergunta ao servidor
     quem está e desenha. O que aparece ou some aqui é conveniência —
     cada módulo confere de novo, e o Apps Script confere em toda
     leitura e gravação. Enquanto a resposta não chega, fica o traço
     de carregando, para o canto não piscar entre "entrar" e o nome de
     quem já estava.
     ================================================================ */

  var Auth = window.FloreSerAuth;
  var canto = document.getElementById("canto-conta");
  var CHAVES = { CRM: "crm", Agenda: "agenda", Entradas: "entradas" };

  function limparCanto() {
    while (canto.firstChild) canto.removeChild(canto.firstChild);
  }

  function marcarCartoes(quem) {
    Array.prototype.forEach.call(document.querySelectorAll(".quadro"), function (a) {
      var chave = CHAVES[a.getAttribute("data-modulo")];
      var selo = a.querySelector(".selo-sem-acesso");
      var falta = quem && chave && !(quem.permissoes || {})[chave];
      if (falta && !selo) {
        selo = document.createElement("span");
        selo.className = "selo-sem-acesso";
        selo.textContent = "Sem acesso";
        selo.title = "Sua conta não abre este módulo. A senha do módulo continua valendo.";
        a.appendChild(selo);
      } else if (!falta && selo) {
        selo.remove();
      }
    });
  }

  function desenharEntrar(aviso) {
    limparCanto();
    marcarCartoes(null);
    mostrarBusca(null);
    var b = document.createElement("button");
    b.type = "button";
    b.className = "conta-entrar";
    b.id = "btn-entrar";
    b.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/>' +
      '<path d="M15.5 16 20 12l-4.5-4M20 12H9.5"/></svg><span>Entrar</span>';
    b.addEventListener("click", function () {
      Auth.abrirLogin({ aoEntrar: function (r) { desenharQuem(r.usuario); } });
    });
    canto.appendChild(b);
    if (aviso) {
      b.title = aviso;
    }
  }

  function desenharQuem(quem) {
    limparCanto();
    marcarCartoes(quem);
    mostrarBusca(quem);
    Auth.montarIdentidade(canto, function () { desenharEntrar(); });
  }

  /* ================================================================
     Busca global
     ----------------------------------------------------------------
     Ela cruza módulos, então pertence ao sistema de contas: o servidor
     precisa saber de quem é a pergunta para responder só o que aquela
     pessoa pode ver. Com senha compartilhada não aparece — somar as
     três senhas para simular uma visão geral seria dar a quem tem uma
     delas um caminho para as outras.
     ================================================================ */

  var faixaBusca = document.getElementById("faixa-busca");
  var buscaMontada = null;

  function chamarBusca(corpo) {
    corpo.token = Auth.token();
    /* leitura pura: pode repetir se o Google tropeçar no caminho */
    return window.FloreSerRede.postar(corpo, { repetir: true });
  }

  function mostrarBusca(quem) {
    if (!faixaBusca) return;

    if (!quem) {
      /* sem conta: em vez de sumir sem explicação, o convite */
      faixaBusca.hidden = false;
      faixaBusca.innerHTML =
        '<span class="aviso-conta">Entre com sua conta para pesquisar em todo o sistema.</span>';
      buscaMontada = null;
      return;
    }

    faixaBusca.hidden = false;
    if (buscaMontada) return;             /* já está montada */
    faixaBusca.innerHTML = "";
    buscaMontada = window.FloreSerBusca
      ? FloreSerBusca.montar(faixaBusca, { api: chamarBusca })
      : null;
  }

  /* ================================================================
     Instalar o Alveare
     ----------------------------------------------------------------
     Alveare é o nome do aplicativo; o sistema continua sendo o
     FloreSer, e nada aqui muda a interface. O botão só nasce quando o
     navegador oferece a instalação de verdade — botão que não instala
     nada não ajuda ninguém.
     ================================================================ */

  var cantoInstalar = document.getElementById("canto-instalar");

  if (window.Alveare && cantoInstalar) {
    if (Alveare.instalado()) {
      /* já está instalado: nada a oferecer */
    } else if (Alveare.montarBotaoInstalar) {
      Alveare.montarBotaoInstalar(cantoInstalar);

      /* No iPhone e no iPad não existe convite programático. Em vez de
         um botão que não faz nada, a instrução do caminho real. */
      var dica = Alveare.dicaIOS();
      if (dica) {
        var texto = document.createElement("span");
        texto.className = "dica-instalar";
        texto.textContent = dica;
        cantoInstalar.appendChild(texto);
      }
    }
  }

  (async function conferirConta() {
    if (!Auth) { limparCanto(); return; }
    if (!Auth.token()) { desenharEntrar(); return; }
    try {
      var r = await Auth.retomar();
      if (r && r.ok) {
        desenharQuem(r.usuario);
        registrar("SESSAO_RETOMADA", { mensagem: "Portal reconheceu a sessão de usuário" });
      } else {
        desenharEntrar(r && r.erro === "expirada"
          ? "Sua sessão expirou por inatividade. Entre novamente."
          : "");
      }
    } catch (e) {
      /* servidor fora do ar: sem inventar quem está, oferece entrar */
      desenharEntrar("Não foi possível confirmar sua sessão agora.");
    }
  })();
})();
  
