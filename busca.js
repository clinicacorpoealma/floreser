/* =====================================================================
   FloreSer · Corpo e Alma — busca global do portal
   ---------------------------------------------------------------------
   Uma pergunta só, três módulos. Quem procura é o servidor: o portal não
   carrega o CRM, nem a Agenda, nem as Entradas para poder pesquisar. Ele
   manda o termo e recebe de volta título, subtítulo e id — nada mais. Um
   portal que baixasse os três bancos para filtrar no navegador seria
   lento, pesado e daria a quem abre a página muito mais dados do que ela
   precisa ver.

   Onde procurar não é escolha daqui. O servidor lê as permissões da conta
   e responde só o que aquela pessoa pode ver. Esconder resultado na tela
   não protege nada.

   Por isso também: a busca global é do sistema de contas. A senha
   compartilhada de um módulo abre aquele módulo, e somar três senhas para
   fingir uma visão geral seria abrir uma porta lateral.
   ===================================================================== */

(function (global) {
  "use strict";

  var MIN_LETRAS = 2;
  var ESPERA = 300;        /* ms parados antes de perguntar ao servidor */

  var MODULOS = {
    crm: { nome: "CRM", href: "crm/", chave: "lead" },
    agenda: { nome: "Agenda", href: "agenda/", chave: "paciente" },
    entradas: { nome: "Entradas", href: "entradas/", chave: "entrada" },
  };

  var ESTILO = [
    ".bg-caixa,.bg-caixa *{box-sizing:border-box}",
    ".bg-caixa{position:relative;width:100%;max-width:560px;margin:0 auto}",

    ".bg-campo{display:flex;align-items:center;gap:10px;width:100%;",
    "  padding:13px 16px;border-radius:999px;",
    "  border:1px solid var(--linha,#E2DED7);background:var(--branco,#fff);",
    "  transition:border-color .18s ease, box-shadow .18s ease}",
    ".bg-caixa.bg-aberta .bg-campo{border-color:var(--teal,#3B6E6A);",
    "  box-shadow:0 1px 2px rgba(20,40,38,.06), 0 10px 30px -18px rgba(20,40,38,.5)}",
    ".bg-campo svg{flex:none;color:var(--taupe,#A39384)}",
    ".bg-campo input{flex:1 1 auto;min-width:0;border:none;background:none;",
    "  font:inherit;font-size:14px;color:var(--texto,#2D2D2D);outline:none}",
    ".bg-campo input::placeholder{color:var(--taupe,#A39384)}",
    ".bg-limpar{border:none;background:none;cursor:pointer;padding:2px 4px;",
    "  color:var(--taupe,#A39384);font:inherit;line-height:1;display:none}",
    ".bg-caixa.bg-cheia .bg-limpar{display:block}",
    ".bg-limpar:hover{color:var(--teal,#3B6E6A)}",

    ".bg-painel{position:absolute;left:0;right:0;top:calc(100% + 8px);z-index:80;",
    "  background:var(--branco,#fff);border:1px solid var(--linha,#E2DED7);",
    "  border-radius:14px;overflow:hidden;display:none;",
    "  box-shadow:0 1px 2px rgba(20,40,38,.08), 0 22px 50px -26px rgba(10,20,18,.55);",
    "  max-height:min(62vh,460px);overflow-y:auto}",
    ".bg-caixa.bg-aberta .bg-painel{display:block}",

    ".bg-grupo{padding:6px 0}",
    ".bg-grupo + .bg-grupo{border-top:1px solid var(--linha,#E2DED7)}",
    ".bg-grupo-nome{font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;",
    "  color:var(--taupe,#A39384);padding:9px 18px 6px}",

    ".bg-item{display:block;width:100%;text-align:left;border:none;background:none;",
    "  font:inherit;cursor:pointer;padding:9px 18px;color:var(--texto,#2D2D2D);",
    "  text-decoration:none;transition:background .14s ease}",
    ".bg-item:hover,.bg-item.bg-alvo{background:var(--fundo-1,#F5F0EB)}",
    ".bg-item:focus-visible{outline:2px solid var(--teal,#3B6E6A);outline-offset:-2px}",
    ".bg-titulo{font-family:'Cormorant Garamond',Georgia,serif;font-size:17px;",
    "  line-height:1.2;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}",
    ".bg-sub{font-size:11.5px;color:var(--taupe,#A39384);margin-top:2px}",
    ".bg-selo{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;",
    "  padding:2px 7px;border-radius:999px;background:var(--sage,#C9D3CA);",
    "  color:var(--teal-deep,#2E5754);font-family:'Montserrat',sans-serif}",

    ".bg-recado{padding:16px 18px;font-size:12.5px;color:var(--taupe,#A39384);line-height:1.5}",
    ".bg-recado.bg-ruim{color:var(--alerta,#A8452F)}",

    "@media (max-width:620px){",
    "  .bg-caixa{max-width:none}",
    "  .bg-painel{max-height:min(70vh,420px)}",
    "}",
  ].join("\n");

  function porEstilo() {
    if (document.getElementById("bg-estilo")) return;
    var f = document.createElement("style");
    f.id = "bg-estilo";
    f.textContent = ESTILO;
    (document.head || document.documentElement).appendChild(f);
  }

  function esc(t) {
    return String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ------------------------------------------------------------ montar */

  /* montar(destino, { api(corpo) -> Promise, temConta() -> bool }) */
  function montar(destino, opcoes) {
    porEstilo();
    var o = opcoes || {};
    if (!destino) return null;

    var caixa = document.createElement("div");
    caixa.className = "bg-caixa";
    caixa.innerHTML =
      '<div class="bg-campo">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>' +
      '<input type="search" id="bg-termo" autocomplete="off" spellcheck="false" ' +
      'placeholder="Buscar paciente, lead ou entrada…" ' +
      'role="combobox" aria-expanded="false" aria-controls="bg-painel" ' +
      'aria-autocomplete="list" aria-label="Buscar em todo o sistema">' +
      '<button type="button" class="bg-limpar" aria-label="Limpar a busca">&#10005;</button>' +
      "</div>" +
      '<div class="bg-painel" id="bg-painel" role="listbox" aria-label="Resultados"></div>';

    destino.appendChild(caixa);

    var campo = caixa.querySelector("#bg-termo");
    var painel = caixa.querySelector("#bg-painel");
    var limpar = caixa.querySelector(".bg-limpar");

    var timer = null;
    var sequencia = 0;        /* qual pergunta é a mais nova */
    var ultimaAtendida = 0;   /* qual resposta já foi para a tela */
    var itens = [];
    var alvo = -1;

    function abrir(aberta) {
      caixa.classList.toggle("bg-aberta", !!aberta);
      campo.setAttribute("aria-expanded", aberta ? "true" : "false");
      if (!aberta) { alvo = -1; campo.removeAttribute("aria-activedescendant"); }
    }

    function recado(texto, ruim) {
      painel.innerHTML = '<div class="bg-recado' + (ruim ? " bg-ruim" : "") + '">' +
        esc(texto) + "</div>";
      itens = [];
      abrir(true);
    }

    function endereco(r) {
      var m = MODULOS[r.modulo];
      if (!m) return "#";
      /* só o id vai na barra: nome e telefone não têm o que fazer ali,
         e token nenhum jamais. Caminho relativo ao portal, que é a raiz
         do site — dentro do escopo da PWA, como tudo aqui. */
      return m.href + "?" + m.chave + "=" + encodeURIComponent(r.id);
    }

    function desenhar(resposta) {
      var lista = (resposta && resposta.resultados) || [];
      if (!lista.length) {
        /* Se a conta só alcança parte do sistema, não se diz que existe
           coisa nos módulos que ela não abre. */
        recado("Nenhum resultado encontrado.");
        return;
      }

      var porModulo = { crm: [], agenda: [], entradas: [] };
      lista.forEach(function (r) {
        if (porModulo[r.modulo]) porModulo[r.modulo].push(r);
      });

      itens = [];
      var html = "";
      ["crm", "agenda", "entradas"].forEach(function (chave) {
        var achados = porModulo[chave];
        if (!achados.length) return;                 /* módulo sem resultado não aparece */
        html += '<div class="bg-grupo"><div class="bg-grupo-nome">' +
          esc(MODULOS[chave].nome) + "</div>";
        achados.forEach(function (r) {
          var i = itens.length;
          itens.push(r);
          var selos = "";
          if (r.arquivado) selos += '<span class="bg-selo">Arquivo</span>';
          if (r.vinculado) selos += '<span class="bg-selo">Vinculada ao CRM</span>';
          html += '<a class="bg-item" role="option" id="bg-item-' + i + '" ' +
            'aria-selected="false" data-i="' + i + '" href="' + esc(endereco(r)) + '">' +
            '<span class="bg-titulo">' + esc(r.titulo) + selos + "</span>" +
            (r.subtitulo ? '<span class="bg-sub">' + esc(r.subtitulo) + "</span>" : "") +
            "</a>";
        });
        html += "</div>";
      });

      painel.innerHTML = html;
      alvo = -1;
      abrir(true);
    }

    function marcar(novo) {
      var todos = painel.querySelectorAll(".bg-item");
      if (!todos.length) return;
      if (alvo >= 0 && todos[alvo]) {
        todos[alvo].classList.remove("bg-alvo");
        todos[alvo].setAttribute("aria-selected", "false");
      }
      alvo = novo;
      if (alvo < 0) alvo = todos.length - 1;
      if (alvo >= todos.length) alvo = 0;
      todos[alvo].classList.add("bg-alvo");
      todos[alvo].setAttribute("aria-selected", "true");
      campo.setAttribute("aria-activedescendant", todos[alvo].id);
      todos[alvo].scrollIntoView({ block: "nearest" });
    }

    function perguntar(termo) {
      var minha = ++sequencia;
      o.api({ acao: "busca_global", termo: termo }).then(function (r) {
        /* "Mari" pode voltar depois de "Mariana". A resposta velha não
           substitui a nova: só a mais recente pinta a tela. */
        if (minha < ultimaAtendida) return;
        ultimaAtendida = minha;

        if (!r || !r.ok) {
          var erro = r && r.erro;
          if (erro === "sessao" || erro === "expirada" || erro === "inativo") {
            recado("Sua sessão expirou. Entre novamente para pesquisar.", true);
          } else {
            recado("Não foi possível pesquisar agora.", true);
          }
          return;
        }
        if (r.curto) { abrir(false); return; }
        desenhar(r);
      }).catch(function () {
        if (minha < ultimaAtendida) return;
        ultimaAtendida = minha;
        recado("Não foi possível pesquisar agora.", true);
      });
    }

    campo.addEventListener("input", function () {
      var termo = campo.value.trim();
      caixa.classList.toggle("bg-cheia", !!campo.value);
      clearTimeout(timer);

      if (termo.length < MIN_LETRAS) { abrir(false); return; }

      /* uma pergunta por pausa, não uma por tecla */
      recado("Buscando…");
      timer = setTimeout(function () { perguntar(termo); }, ESPERA);
    });

    campo.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        if (caixa.classList.contains("bg-aberta")) { ev.preventDefault(); abrir(false); }
        return;
      }
      if (!caixa.classList.contains("bg-aberta")) return;
      if (ev.key === "ArrowDown") { ev.preventDefault(); marcar(alvo + 1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); marcar(alvo - 1); }
      else if (ev.key === "Enter") {
        var todos = painel.querySelectorAll(".bg-item");
        if (alvo >= 0 && todos[alvo]) { ev.preventDefault(); todos[alvo].click(); }
      }
    });

    campo.addEventListener("focus", function () {
      if (campo.value.trim().length >= MIN_LETRAS && painel.innerHTML) abrir(true);
    });

    limpar.addEventListener("click", function () {
      campo.value = "";
      caixa.classList.remove("bg-cheia");
      abrir(false);
      campo.focus();
    });

    document.addEventListener("click", function (ev) {
      if (!caixa.contains(ev.target)) abrir(false);
    });

    return {
      focar: function () { campo.focus(); },
      elemento: caixa,
    };
  }

  global.FloreSerBusca = { montar: montar };
})(window);
