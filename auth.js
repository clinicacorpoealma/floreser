/* =====================================================================
   FloreSer · Corpo e Alma — entrada por usuário individual
   ---------------------------------------------------------------------
   Convive com a senha compartilhada de cada módulo: quem prefere a senha
   continua entrando por ela. A diferença é que a sessão de um usuário sabe
   quem é a pessoa, e o servidor confere, a cada chamada, se ela pode abrir
   aquele módulo.

   O que fica neste aparelho é só o token, no localStorage — por isso a
   sessão sobrevive a fechar o navegador e vale para os três módulos ao
   mesmo tempo (mesmo endereço, mesmo armazenamento). O prazo é de sete
   dias de inatividade, contados e renovados pelo servidor.

   Nada aqui decide permissão: o que este arquivo mostra ou esconde é
   conveniência. Quem decide é o Apps Script, em toda leitura e gravação.
   ===================================================================== */

(function (global) {
  "use strict";

  var URL_API = "https://script.google.com/macros/s/AKfycbzy9WCfP4l08dn2h2K34uEL6e0mqFBjVMugcHiTc0oUGmpS7gOJjbxs58CB87AoFUw-/exec";

  var CHAVE_TOKEN = "floreser.usuario.sessao";
  var CHAVE_PERFIL = "floreser.usuario.perfil";

  var NOMES = { crm: "CRM", agenda: "Agenda", entradas: "Entradas" };

  function tentar(f, padrao) {
    try {
      var v = f();
      return v === undefined || v === null || v === "" ? padrao : v;
    } catch (e) {
      return padrao;
    }
  }

  function esc(t) {
    return String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- o que fica guardado neste aparelho ---------- */

  function token() {
    return tentar(function () { return localStorage.getItem(CHAVE_TOKEN); }, "");
  }

  function perfil() {
    return tentar(function () { return JSON.parse(localStorage.getItem(CHAVE_PERFIL)); }, null);
  }

  function guardar(tk, quem) {
    tentar(function () {
      localStorage.setItem(CHAVE_TOKEN, tk);
      localStorage.setItem(CHAVE_PERFIL, JSON.stringify(quem));
      return true;
    }, false);
  }

  function esquecer() {
    tentar(function () {
      localStorage.removeItem(CHAVE_TOKEN);
      localStorage.removeItem(CHAVE_PERFIL);
      return true;
    }, false);
  }

  async function api(dados) {
    var resposta = await fetch(URL_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(dados),
      redirect: "follow",
    });
    return await resposta.json();
  }

  /* ---------- entrar, retomar e sair ---------- */

  async function entrar(usuario, senha) {
    var r = await api({ acao: "login_usuario", usuario: usuario, senha: senha });
    if (r && r.ok) guardar(r.token, r.usuario);
    return r;
  }

  /* Chamada quando a página abre com um token guardado. O servidor diz se a
     sessão ainda vale e se esta pessoa pode abrir este módulo. */
  async function retomar(modulo) {
    var tk = token();
    if (!tk) return { ok: false, erro: "sem_token" };
    var r = await api({ acao: "sessao_usuario", token: tk, modulo: modulo });
    if (r && r.ok) {
      guardar(tk, r.usuario);
    } else if (r && (r.erro === "expirada" || r.erro === "sessao" || r.erro === "inativo")) {
      esquecer();
    }
    return r;
  }

  async function sair() {
    var tk = token();
    esquecer();
    if (tk) { try { await api({ acao: "logout_usuario", token: tk }); } catch (e) { } }
  }

  function recado(r) {
    if (!r) return "Não foi possível falar com o servidor.";
    if (r.erro === "bloqueado") {
      return "Muitas tentativas erradas. Tente de novo em " + (r.minutos || 15) + " minutos.";
    }
    if (r.erro === "credenciais") {
      return "Usuário ou senha incorretos." +
        (r.restam ? " Restam " + r.restam + " tentativas." : "");
    }
    if (r.erro === "sem_acesso") return "Você não possui acesso a este módulo.";
    if (r.erro === "inativo") return "Este usuário está desativado.";
    if (r.erro === "expirada") return "Sua sessão expirou por inatividade. Entre novamente para continuar.";
    return "Não foi possível falar com o servidor.";
  }

  /* ---------- a marca de quem está usando ---------- */

  var ESTILO = [
    ".fs-quem{position:relative;display:inline-flex}",
    ".fs-quem>button{display:inline-flex;align-items:center;gap:6px;border:none;background:none;",
    "  padding:6px 10px;border-radius:999px;cursor:pointer;font:inherit;",
    "  font-size:11px;letter-spacing:.16em;text-transform:uppercase;",
    "  color:var(--fs-quem-cor,inherit);transition:background .18s ease}",
    ".fs-quem>button:hover{background:var(--fs-quem-hover,rgba(127,127,127,.14))}",
    ".fs-quem>button i{font-style:normal;font-size:9px;opacity:.7}",
    ".fs-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:80;min-width:190px;",
    "  padding:14px 16px;border-radius:12px;text-align:left;",
    "  background:var(--fs-menu-fundo,#fff);border:1px solid var(--fs-menu-borda,#E2DED7);",
    "  box-shadow:0 2px 4px rgba(20,30,28,.06), 0 16px 34px -18px rgba(20,30,28,.45);",
    "  color:var(--fs-menu-texto,#2D2D2D);display:none}",
    ".fs-quem.aberto .fs-menu{display:block}",
    ".fs-menu .nome{font-family:var(--serif,Georgia,serif);font-size:19px;line-height:1.15}",
    ".fs-menu .login{font-size:10px;letter-spacing:.16em;text-transform:uppercase;",
    "  color:var(--fs-menu-suave,#8A8078);margin-top:2px}",
    ".fs-menu .mods{margin-top:10px;display:flex;flex-wrap:wrap;gap:5px}",
    ".fs-menu .mods span{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;",
    "  padding:3px 8px;border-radius:999px;background:var(--fs-menu-selo,#E7EEEB);",
    "  color:var(--fs-menu-selo-cor,#3B6E6A)}",
    ".fs-menu .fio{height:1px;background:var(--fs-menu-borda,#E2DED7);margin:12px 0 10px}",
    ".fs-menu button.sair{width:100%;border:none;background:none;padding:8px 0;cursor:pointer;",
    "  font:inherit;font-size:11px;letter-spacing:.16em;text-transform:uppercase;text-align:left;",
    "  color:var(--fs-menu-sair,#A8623F)}",
    ".fs-menu button.sair:hover{text-decoration:underline;text-underline-offset:3px}",
    "@media (max-width:480px){.fs-menu{right:auto;left:0}}",
  ].join("\n");

  var estiloPosto = false;
  function porEstilo() {
    if (estiloPosto) return;
    estiloPosto = true;
    var folha = document.createElement("style");
    folha.id = "fs-auth-estilo";
    folha.textContent = ESTILO;
    (document.head || document.documentElement).appendChild(folha);
  }

  /* Monta a marca "Amanda ▾" dentro do elemento indicado. Só faz sentido
     quando a entrada foi por usuário; quem entrou pela senha do módulo não
     tem nome para mostrar. */
  function montarIdentidade(alvo, aoSair) {
    if (!alvo) return null;
    var quem = perfil();
    if (!quem) return null;
    porEstilo();

    var mods = ["crm", "agenda", "entradas"].filter(function (m) {
      return quem.permissoes && quem.permissoes[m];
    });

    var caixa = document.createElement("div");
    caixa.className = "fs-quem";
    caixa.innerHTML =
      '<button type="button" aria-haspopup="true" aria-expanded="false">' +
      esc(quem.nome) + "<i>&#9662;</i></button>" +
      '<div class="fs-menu" role="menu">' +
      '<div class="nome">' + esc(quem.nome) + "</div>" +
      '<div class="login">@' + esc(quem.usuario) + (quem.admin ? " &middot; admin" : "") + "</div>" +
      '<div class="mods">' + mods.map(function (m) {
        return "<span>" + NOMES[m] + "</span>";
      }).join("") + "</div>" +
      '<div class="fio"></div>' +
      '<button type="button" class="sair">Sair</button>' +
      "</div>";

    var botao = caixa.querySelector("button");
    botao.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var abriu = caixa.classList.toggle("aberto");
      botao.setAttribute("aria-expanded", abriu ? "true" : "false");
    });

    caixa.querySelector(".sair").addEventListener("click", async function () {
      await sair();
      if (typeof aoSair === "function") aoSair(); else location.reload();
    });

    document.addEventListener("click", function (ev) {
      if (!caixa.contains(ev.target)) caixa.classList.remove("aberto");
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") caixa.classList.remove("aberto");
    });

    alvo.appendChild(caixa);
    return caixa;
  }

  global.FloreSerAuth = {
    token: token,
    usuario: perfil,
    entrar: entrar,
    retomar: retomar,
    sair: sair,
    esquecer: esquecer,
    recado: recado,
    montarIdentidade: montarIdentidade,
    possuiPermissao: function (modulo) {
      var quem = perfil();
      return !!(quem && quem.permissoes && quem.permissoes[modulo]);
    },
  };
})(window);
