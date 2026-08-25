/* =====================================================================
   FloreSer · Corpo e Alma — entrada por usuário individual
   ---------------------------------------------------------------------
   Um lugar só para tudo o que diz respeito à conta de uma pessoa: a tela
   de entrar, a sessão guardada neste aparelho, a marca de quem está usando
   e a saída. O portal e os três módulos chamam este arquivo — nenhum deles
   tem tela de usuário própria, para não existirem duas maneiras de entrar.

   Convive com a senha compartilhada de cada módulo: quem prefere a senha
   continua entrando por ela. A diferença é que a sessão de um usuário sabe
   quem é a pessoa, e o servidor confere, a cada chamada, se ela pode abrir
   aquele módulo.

   O que fica neste aparelho é o token e um retrato do perfil, no
   localStorage — por isso a sessão sobrevive a fechar o navegador e vale
   para o portal e para os três módulos ao mesmo tempo (mesmo endereço,
   mesmo armazenamento). Senha nunca é guardada, em lugar nenhum. O prazo é
   de trinta dias de inatividade, contados e renovados pelo servidor.

   Nada aqui decide permissão: o que este arquivo mostra ou esconde é
   conveniência. Quem decide é o Apps Script, em toda leitura e gravação.
   ===================================================================== */

(function (global) {
  "use strict";

  var URL_API = "https://script.google.com/macros/s/AKfycbzy9WCfP4l08dn2h2K34uEL6e0mqFBjVMugcHiTc0oUGmpS7gOJjbxs58CB87AoFUw-/exec";

  var CHAVE_TOKEN = "floreser.usuario.sessao";
  var CHAVE_PERFIL = "floreser.usuario.perfil";
  var CHAVE_ATIVIDADE = "floreser.usuario.atividade";

  var DIAS = 30;
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

  /* ---------- o que fica guardado neste aparelho ----------
     Só o necessário para saber quem está e para o servidor reconhecer a
     sessão: identificação, nome, foto, token e a data do último uso.
     Senha, hash e tempero nunca chegam aqui. */

  function token() {
    return tentar(function () { return localStorage.getItem(CHAVE_TOKEN); }, "");
  }

  function perfil() {
    return tentar(function () { return JSON.parse(localStorage.getItem(CHAVE_PERFIL)); }, null);
  }

  function atividade() {
    return Number(tentar(function () { return localStorage.getItem(CHAVE_ATIVIDADE); }, 0)) || 0;
  }

  function marcarAtividade() {
    tentar(function () {
      localStorage.setItem(CHAVE_ATIVIDADE, String(Date.now()));
      return true;
    }, false);
  }

  /* O perfil guardado é um retrato para a tela desenhar depressa, não uma
     credencial: a permissão que vale é a que o servidor confere na hora. */
  function guardar(tk, quem) {
    tentar(function () {
      localStorage.setItem(CHAVE_TOKEN, tk);
      localStorage.setItem(CHAVE_PERFIL, JSON.stringify({
        id: quem.id,
        nome: quem.nome,
        usuario: quem.usuario,
        foto: quem.foto || "",
        admin: !!quem.admin,
        permissoes: quem.permissoes || {},
      }));
      return true;
    }, false);
    marcarAtividade();
  }

  function esquecer() {
    tentar(function () {
      localStorage.removeItem(CHAVE_TOKEN);
      localStorage.removeItem(CHAVE_PERFIL);
      localStorage.removeItem(CHAVE_ATIVIDADE);
      return true;
    }, false);
  }

  /* Trinta dias parados: nem tentamos falar com o servidor, já apagamos.
     O servidor tem a palavra final e conta o mesmo prazo — isto aqui só
     evita mandar um token que já sabemos vencido. */
  function venceuLocalmente() {
    var quando = atividade();
    if (!quando) return false;
    return Date.now() - quando > DIAS * 86400000;
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
     sessão ainda vale e, quando um módulo é informado, se esta pessoa pode
     abri-lo. Passar módulo nenhum é o caso do portal: só queremos saber
     quem está. */
  async function retomar(modulo) {
    var tk = token();
    if (!tk) return { ok: false, erro: "sem_token" };
    if (venceuLocalmente()) { esquecer(); return { ok: false, erro: "expirada" }; }

    var r = await api({ acao: "sessao_usuario", token: tk, modulo: modulo || "" });
    if (r && r.ok) {
      guardar(tk, r.usuario);
    } else if (r && r.erro === "sem_acesso") {
      /* a sessão continua boa; só este módulo é que não é dela */
      if (r.usuario) guardar(tk, r.usuario);
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
    if (r.erro === "sem_acesso") return "Esta conta não possui acesso a este módulo.";
    if (r.erro === "inativo") return "Este usuário está desativado.";
    if (r.erro === "expirada") return "Sua sessão expirou por inatividade. Entre novamente para continuar.";
    return "Não foi possível falar com o servidor.";
  }

  /* ---------- avatar ----------
     Sem foto, as iniciais num círculo teal. É o padrão de quem ainda não
     escolheu imagem, e não some se a foto falhar em carregar. */

  function iniciais(nome) {
    var partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return "?";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  function avatarHTML(quem, tamanho, classe) {
    var px = tamanho || 30;
    var extra = classe ? " " + classe : "";
    var estilo = 'style="width:' + px + "px;height:" + px + 'px"';
    if (quem && quem.foto) {
      return '<img class="fs-avatar' + extra + '" ' + estilo + ' src="' + esc(quem.foto) +
        '" alt="" aria-hidden="true">';
    }
    return '<span class="fs-avatar fs-avatar-letras' + extra + '" ' + estilo +
      ' aria-hidden="true">' + esc(iniciais(quem && quem.nome)) + "</span>";
  }

  /* ---------- estilo compartilhado ---------- */

  var ESTILO = [
    /* --- paleta própria ---
       Esta tela aparece nas quatro páginas, e elas não falam a mesma língua
       de tokens: o portal e a agenda usam --creme e --carvao, as entradas
       usam --surface e --text, e o CRM usa --crm-*. Em vez de adivinhar, a
       tela traz a sua própria paleta e segue o tema pelo data-tema que o
       tema.js carimba na raiz — o mesmo carimbo em claro, escuro e
       automático. */
    ":root{",
    "  --fs-fundo:#F5F0EB; --fs-texto:#2D2D2D; --fs-titulo:#3B6E6A;",
    "  --fs-suave:#6E655C; --fs-linha:#DCD5CB; --fs-campo:#FFFFFF;",
    "  --fs-botao:#3B6E6A; --fs-botao-cor:#F5F0EB; --fs-botao-hover:#5A9490;",
    "  --fs-erro:#A8452F; --fs-selo:#E7EEEB; --fs-selo-cor:#2F5A57;",
    "  --fs-menu-fundo:#FFFFFF; --fs-menu-linha:#E2DED7;",
    "}",
    ':root[data-tema="escuro"]{',
    "  --fs-fundo:#1E2927; --fs-texto:#E9E3DB; --fs-titulo:#A8D3CE;",
    "  --fs-suave:#B4ADA3; --fs-linha:#3B4846; --fs-campo:#141C1B;",
    "  --fs-botao:#7FB8B2; --fs-botao-cor:#12201E; --fs-botao-hover:#93C6C0;",
    "  --fs-erro:#E79B82; --fs-selo:#2A514D; --fs-selo-cor:#EAF1EF;",
    "  --fs-menu-fundo:#1E2927; --fs-menu-linha:#33403E;",
    "}",

    /* --- avatar --- */
    ".fs-avatar{flex:0 0 auto;border-radius:50%;object-fit:cover;display:inline-flex;",
    "  align-items:center;justify-content:center;overflow:hidden;",
    "  background:var(--fs-selo);color:var(--fs-selo-cor);",
    "  border:1px solid var(--fs-linha)}",
    ".fs-avatar-letras{font-family:var(--sans,'Montserrat',sans-serif);font-weight:600;",
    "  font-size:.42em;letter-spacing:.04em;line-height:1}",

    /* --- a marca de quem está usando --- */
    ".fs-quem{position:relative;display:inline-flex}",
    ".fs-quem>button{display:inline-flex;align-items:center;gap:8px;border:none;background:none;",
    "  padding:5px 10px 5px 5px;border-radius:999px;cursor:pointer;font:inherit;",
    "  font-size:11px;letter-spacing:.16em;text-transform:uppercase;",
    "  color:var(--fs-quem-cor,inherit);transition:background .18s ease}",
    ".fs-quem>button:hover{background:var(--fs-quem-hover,rgba(127,127,127,.14))}",
    ".fs-quem>button i{font-style:normal;font-size:9px;opacity:.7}",
    ".fs-quem>button .fs-nome{max-width:15ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".fs-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:80;min-width:214px;",
    "  padding:16px;border-radius:12px;text-align:left;",
    "  background:var(--fs-menu-fundo);border:1px solid var(--fs-menu-linha);",
    "  box-shadow:0 2px 4px rgba(20,30,28,.06), 0 16px 34px -18px rgba(20,30,28,.45);",
    "  color:var(--fs-texto);display:none}",
    ".fs-quem.aberto .fs-menu{display:block}",
    ".fs-menu .cabeca{display:flex;align-items:center;gap:11px}",
    ".fs-menu .nome{font-family:var(--serif,Georgia,serif);font-size:19px;line-height:1.15}",
    ".fs-menu .login{font-size:10px;letter-spacing:.16em;text-transform:uppercase;",
    "  color:var(--fs-suave);margin-top:2px}",
    ".fs-menu .mods{margin-top:12px;display:flex;flex-wrap:wrap;gap:5px}",
    ".fs-menu .mods span{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;",
    "  padding:3px 8px;border-radius:999px;background:var(--fs-selo);",
    "  color:var(--fs-selo-cor)}",
    ".fs-menu .mods span.nenhum{background:none;padding:0;letter-spacing:.04em;",
    "  text-transform:none;font-size:11.5px;color:var(--fs-suave)}",
    ".fs-menu .fio{height:1px;background:var(--fs-menu-linha);margin:13px 0 10px}",
    ".fs-menu button.sair{width:100%;border:none;background:none;padding:8px 0;cursor:pointer;",
    "  font:inherit;font-size:11px;letter-spacing:.16em;text-transform:uppercase;text-align:left;",
    "  color:var(--fs-erro)}",
    ".fs-menu button.sair:hover{text-decoration:underline;text-underline-offset:3px}",
    /* a marca fica sempre no canto direito, então o menu abre para dentro;
       no celular ele ainda precisa caber na largura da tela */
    "@media (max-width:480px){.fs-menu{min-width:0;",
    "  width:max(190px,58vw);max-width:calc(100vw - 24px)}}",

    /* --- a tela de entrar, a mesma no portal e nos módulos --- */
    ".fs-login{border:none;padding:0;background:none;max-width:100%}",
    ".fs-login::backdrop{background:rgba(20,30,28,.52)}",
    ".fs-login .cartao{width:min(400px,calc(100vw - 32px));padding:34px 32px 30px;",
    "  border-radius:3px;text-align:center;",
    "  background:var(--fs-fundo);color:var(--fs-texto);",
    "  box-shadow:0 24px 60px -28px rgba(10,20,18,.6)}",
    ".fs-login .marca{display:flex;flex-direction:column;align-items:center;gap:12px}",
    ".fs-login .marca img{height:48px;width:auto}",
    ".fs-login h2{font-family:var(--serif,Georgia,serif);font-weight:600;font-size:25px;",
    "  line-height:1.15;color:var(--fs-titulo)}",
    ".fs-login .sub{margin-top:5px;font-size:9.5px;letter-spacing:.26em;text-transform:uppercase;",
    "  color:var(--fs-suave)}",
    ".fs-login .campo{position:relative;margin-top:13px;text-align:left}",
    ".fs-login .campo input{width:100%;padding:13px 42px 13px 40px;",
    "  border:1px solid var(--fs-linha);border-radius:2px;",
    "  background:var(--fs-campo);color:inherit;",
    "  font-family:var(--sans,'Montserrat',sans-serif);font-size:14px}",
    ".fs-login .campo input:focus{outline:none;border-color:var(--fs-titulo)}",
    ".fs-login .campo>svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);",
    "  opacity:.5;pointer-events:none}",
    ".fs-login .olho{position:absolute;right:6px;top:50%;transform:translateY(-50%);",
    "  border:none;background:none;padding:8px;cursor:pointer;color:inherit;opacity:.55;",
    "  display:flex;align-items:center}",
    ".fs-login .olho:hover{opacity:.9}",
    ".fs-login .erro{min-height:17px;margin-top:11px;font-size:12px;line-height:1.4;",
    "  color:var(--fs-erro);text-align:left}",
    ".fs-login .entrar{width:100%;margin-top:13px;padding:13px;border:none;border-radius:2px;",
    "  cursor:pointer;font-family:var(--sans,'Montserrat',sans-serif);font-size:11px;",
    "  font-weight:500;letter-spacing:.2em;text-transform:uppercase;",
    "  background:var(--fs-botao);color:var(--fs-botao-cor);",
    "  transition:background .18s ease}",
    ".fs-login .entrar:hover:not(:disabled){background:var(--fs-botao-hover)}",
    ".fs-login .entrar:disabled{opacity:.6;cursor:default}",
    ".fs-login .fechar{margin-top:14px;border:none;background:none;cursor:pointer;",
    "  font:inherit;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;",
    "  color:var(--fs-suave)}",
    ".fs-login .fechar:hover{text-decoration:underline;text-underline-offset:3px}",
  ].join("\n");

  /* O estilo entra assim que o arquivo carrega: o painel de manutenção
     desenha avatares mesmo sem ninguém logado, e não teria como pedir. */
  var estiloPosto = false;
  function porEstilo() {
    if (estiloPosto) return;
    estiloPosto = true;
    var folha = document.createElement("style");
    folha.id = "fs-auth-estilo";
    folha.textContent = ESTILO;
    (document.head || document.documentElement).appendChild(folha);
  }

  /* ---------- a tela de entrar ----------
     Uma só, criada sob demanda e reaproveitada. Quem chama diz o que fazer
     quando der certo; o resto — erro, bloqueio, sem permissão — é tratado
     aqui, do mesmo jeito em toda parte. */

  var dlg = null;
  var aoEntrar = null;
  var moduloPedido = "";
  var raizArquivos = "";

  function caminhoDaLogo() {
    if (raizArquivos) return raizArquivos + "logo.png";
    /* o auth.js pode estar na raiz enquanto a página está numa pasta */
    var meu = document.querySelector('script[src$="auth.js"]');
    var src = meu ? meu.getAttribute("src") : "";
    raizArquivos = src.replace(/auth\.js$/, "");
    return raizArquivos + "logo.png";
  }

  var OLHO =
    '<svg class="aberto" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 12S6.1 5.5 12 5.5 21.5 12 21.5 12 17.9 18.5 12 18.5 2.5 12 2.5 12Z"/>' +
    '<circle cx="12" cy="12" r="2.8"/></svg>';

  function construir() {
    if (dlg) return dlg;
    porEstilo();
    dlg = document.createElement("dialog");
    dlg.className = "fs-login";
    dlg.innerHTML =
      '<div class="cartao">' +
      '<div class="marca">' +
      '<img src="' + esc(caminhoDaLogo()) + '" alt="" aria-hidden="true">' +
      '<div><h2>Entrar</h2><div class="sub" id="fs-sub">Corpo e Alma</div></div>' +
      "</div>" +
      '<div class="campo">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4S18.3 16.4 19.2 20"/></svg>' +
      '<label class="so-leitor" for="fs-login-usuario">Usuário</label>' +
      '<input type="text" id="fs-login-usuario" placeholder="Usuário" autocomplete="username" ' +
      'autocapitalize="none" spellcheck="false">' +
      "</div>" +
      '<div class="campo">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>' +
      '<label class="so-leitor" for="fs-login-senha">Senha</label>' +
      '<input type="password" id="fs-login-senha" placeholder="Senha" ' +
      'autocomplete="current-password" enterkeyhint="go">' +
      '<button type="button" class="olho" id="fs-olho" aria-label="Mostrar senha" ' +
      'aria-pressed="false">' + OLHO + "</button>" +
      "</div>" +
      '<div class="erro" id="fs-login-erro" role="alert"></div>' +
      '<button type="button" class="entrar" id="fs-login-btn">Entrar</button>' +
      '<button type="button" class="fechar" id="fs-login-fechar">Cancelar</button>' +
      "</div>";
    document.body.appendChild(dlg);

    var campoU = dlg.querySelector("#fs-login-usuario");
    var campoS = dlg.querySelector("#fs-login-senha");
    var olho = dlg.querySelector("#fs-olho");

    olho.addEventListener("click", function () {
      var visivel = campoS.type === "text";
      campoS.type = visivel ? "password" : "text";
      olho.setAttribute("aria-pressed", String(!visivel));
      olho.setAttribute("aria-label", visivel ? "Mostrar senha" : "Ocultar senha");
      campoS.focus();
    });

    dlg.querySelector("#fs-login-btn").addEventListener("click", enviar);
    dlg.querySelector("#fs-login-fechar").addEventListener("click", function () { fechar(); });
    [campoU, campoS].forEach(function (c) {
      c.addEventListener("keydown", function (ev) { if (ev.key === "Enter") enviar(); });
    });
    dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); fechar(); });

    return dlg;
  }

  function avisar(texto) {
    var caixa = dlg.querySelector("#fs-login-erro");
    caixa.textContent = texto || "";
  }

  function ocupado(ligado) {
    var b = dlg.querySelector("#fs-login-btn");
    b.disabled = ligado;
    b.textContent = ligado ? "Entrando…" : "Entrar";
    dlg.querySelector("#fs-login-usuario").disabled = ligado;
    dlg.querySelector("#fs-login-senha").disabled = ligado;
  }

  function fechar() {
    if (!dlg) return;
    dlg.querySelector("#fs-login-senha").value = "";
    avisar("");
    if (dlg.open) dlg.close();
    document.body.style.overflow = "";
  }

  async function enviar() {
    var login = dlg.querySelector("#fs-login-usuario").value.trim();
    var senha = dlg.querySelector("#fs-login-senha").value;
    if (!login || !senha) {
      dlg.querySelector(login ? "#fs-login-senha" : "#fs-login-usuario").focus();
      return;
    }

    ocupado(true);
    avisar("");
    try {
      var r = await entrar(login, senha);
      if (!r || !r.ok) {
        avisar(recado(r));
        dlg.querySelector("#fs-login-senha").value = "";
        ocupado(false);
        dlg.querySelector("#fs-login-senha").focus();
        return;
      }

      /* Entrou, mas o módulo pedido não é desta conta: a sessão continua
         valendo para o resto do sistema, e a tela avisa em vez de fingir
         que a entrada falhou. */
      if (moduloPedido && !(r.usuario.permissoes || {})[moduloPedido]) {
        avisar("Esta conta não possui acesso a " + (NOMES[moduloPedido] || moduloPedido) +
          ". Entre com a senha do módulo ou com outra conta.");
        dlg.querySelector("#fs-login-senha").value = "";
        ocupado(false);
        return;
      }

      var seguir = aoEntrar;
      ocupado(false);
      fechar();
      if (typeof seguir === "function") seguir(r);
    } catch (e) {
      avisar("Não foi possível falar com o servidor. Confira sua internet.");
      ocupado(false);
    }
  }

  /* opcoes: { modulo, titulo, aoEntrar } */
  function abrirLogin(opcoes) {
    var o = opcoes || {};
    construir();
    moduloPedido = o.modulo || "";
    aoEntrar = o.aoEntrar || null;

    dlg.querySelector("#fs-sub").textContent =
      o.titulo || (moduloPedido ? NOMES[moduloPedido] || "Corpo e Alma" : "Corpo e Alma");
    dlg.querySelector("#fs-login-usuario").value = "";
    dlg.querySelector("#fs-login-senha").value = "";
    dlg.querySelector("#fs-login-senha").type = "password";
    avisar(o.aviso || "");
    ocupado(false);

    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    document.body.style.overflow = "hidden";
    dlg.querySelector("#fs-login-usuario").focus();
    return dlg;
  }

  /* ---------- a marca de quem está usando ----------
     Foto (ou iniciais), nome e a saída. Só faz sentido quando a entrada foi
     por usuário; quem entrou pela senha do módulo não tem nome para mostrar. */

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
      avatarHTML(quem, 30) +
      '<span class="fs-nome">' + esc(quem.nome) + "</span><i>&#9662;</i></button>" +
      '<div class="fs-menu" role="menu">' +
      '<div class="cabeca">' + avatarHTML(quem, 44) +
      "<div><div class=\"nome\">" + esc(quem.nome) + "</div>" +
      '<div class="login">@' + esc(quem.usuario) + (quem.admin ? " &middot; admin" : "") + "</div>" +
      "</div></div>" +
      '<div class="mods">' + (mods.length
        ? mods.map(function (m) { return "<span>" + NOMES[m] + "</span>"; }).join("")
        : '<span class="nenhum">Sem módulos liberados</span>') + "</div>" +
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

  porEstilo();

  global.FloreSerAuth = {
    token: token,
    usuario: perfil,
    entrar: entrar,
    retomar: retomar,
    sair: sair,
    esquecer: esquecer,
    recado: recado,
    abrirLogin: abrirLogin,
    fecharLogin: fechar,
    marcarAtividade: marcarAtividade,
    avatarHTML: avatarHTML,
    iniciais: iniciais,
    montarIdentidade: montarIdentidade,
    dias: DIAS,
    nomeDoModulo: function (m) { return NOMES[m] || m; },
    possuiPermissao: function (modulo) {
      var quem = perfil();
      return !!(quem && quem.permissoes && quem.permissoes[modulo]);
    },
  };
})(window);
