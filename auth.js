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

  /* Quando algo estoura do lado do Apps Script, ele devolve uma página de
     erro em HTML, não o JSON de sempre. Antes isso virava exceção aqui e a
     tela mandava conferir a internet — que estava ótima. Agora a resposta
     estranha é reconhecida pelo que é, e o texto do servidor fica guardado
     para o painel de manutenção mostrar. */
  async function api(dados) {
    var resposta = await fetch(URL_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(dados),
      redirect: "follow",
    });

    var texto = await resposta.text();
    try {
      return JSON.parse(texto);
    } catch (e) {
      return { ok: false, erro: "servidor_falhou", detalhe: motivoDaPagina(texto) };
    }
  }

  /* Tira o texto visível da página de erro do Google, para o log técnico. */
  function motivoDaPagina(html) {
    var limpo = String(html || "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return limpo.slice(0, 180);
  }

  /* ---------- entrar, retomar e sair ---------- */

  async function entrar(usuario, senha) {
    var r = await api({ acao: "login_usuario", usuario: usuario, senha: senha });
    if (r && r.ok) guardar(r.token, r.usuario);
    else anotarFalha(r);
    return r;
  }

  /* O que o servidor disse vai para o log técnico, que o painel de
     manutenção mostra. Sem senha, sem token, sem usuário: só o motivo. */
  function anotarFalha(r) {
    if (!r || r.erro === "credenciais" || r.erro === "bloqueado") return;
    var registrar = global.FloreSerLogs && global.FloreSerLogs.registrar;
    if (!registrar) return;
    registrar("LOGIN_SERVIDOR_FALHOU", {
      nivel: "ERROR",
      mensagem: "Login recusado pelo servidor: " + (r.detalhe || r.erro || "sem motivo"),
    });
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

    /* O servidor respondeu — e o que ele respondeu foi um erro dele. Dizer
       "sem conexão" aqui manda procurar o problema no lugar errado. */
    if (r.erro === "servidor_falhou") {
      return "O servidor respondeu com um erro. A planilha pode estar sem " +
        "permissão de escrita. Avise o suporte.";
    }
    return "O servidor recusou a operação. Se continuar, avise o suporte.";
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
    "  --fs-erro-bg:#F6EBE4; --fs-fio:#C9D3CA; --fs-sombra:rgba(20,40,38,.30);",
    "  --fs-fundo-portao:#12201E; --fs-borda-cartao:rgba(59,110,106,.10);",
    "  --fs-agua-forca:.05;",
    "  --fs-anel:rgba(90,148,144,.16); --fs-realce:#5A9490; --fs-hover-suave:#EDF3F1;",
    "}",
    ':root[data-tema="escuro"]{',
    "  --fs-fundo:#1E2927; --fs-texto:#E9E3DB; --fs-titulo:#A8D3CE;",
    "  --fs-suave:#B4ADA3; --fs-linha:#3B4846; --fs-campo:#141C1B;",
    "  --fs-botao:#7FB8B2; --fs-botao-cor:#12201E; --fs-botao-hover:#93C6C0;",
    "  --fs-erro:#E79B82; --fs-selo:#2A514D; --fs-selo-cor:#EAF1EF;",
    "  --fs-menu-fundo:#1E2927; --fs-menu-linha:#33403E;",
    "  --fs-erro-bg:#3A241D; --fs-fio:#3C5A56; --fs-sombra:rgba(0,0,0,.55);",
    "  --fs-fundo-portao:#0B1413; --fs-borda-cartao:rgba(255,255,255,.06);",
    "  --fs-agua-forca:.07;",
    "  --fs-anel:rgba(127,184,178,.20); --fs-realce:#93C6C0; --fs-hover-suave:#26332F;",
    "}",

    /* --- o básico, sem depender da página ---
       O CRM escopa o box-sizing em .pt-fundo e o diálogo nasce fora dele:
       sem esta linha o cartão soma o padding à largura e estoura os 400 px. */
    ".fs-login,.fs-login *,.fs-quem,.fs-quem *,",
    ".fs-retomada,.fs-retomada *{box-sizing:border-box}",

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
    "  font-family:'Montserrat',Calibri,system-ui,-apple-system,sans-serif;",
    "  padding:16px;border-radius:12px;text-align:left;",
    "  background:var(--fs-menu-fundo);border:1px solid var(--fs-menu-linha);",
    "  box-shadow:0 2px 4px rgba(20,30,28,.06), 0 16px 34px -18px rgba(20,30,28,.45);",
    "  color:var(--fs-texto);display:none}",
    ".fs-quem.fs-aberto .fs-menu{display:block}",
    ".fs-menu .fs-cabeca{display:flex;align-items:center;gap:11px}",
    ".fs-menu .fs-nome-menu{font-family:var(--serif,Georgia,serif);font-size:19px;line-height:1.15}",
    ".fs-menu .fs-login-arroba{font-size:10px;letter-spacing:.16em;text-transform:uppercase;",
    "  color:var(--fs-suave);margin-top:2px}",
    ".fs-menu .fs-mods{margin-top:12px;display:flex;flex-wrap:wrap;gap:5px}",
    ".fs-menu .fs-mods span{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;",
    "  padding:3px 8px;border-radius:999px;background:var(--fs-selo);",
    "  color:var(--fs-selo-cor)}",
    ".fs-menu .fs-mods span.fs-nenhum{background:none;padding:0;letter-spacing:.04em;",
    "  text-transform:none;font-size:11.5px;color:var(--fs-suave)}",
    ".fs-menu .fs-fio-linha{height:1px;background:var(--fs-menu-linha);margin:13px 0 10px}",
    ".fs-menu button.fs-sair{width:100%;border:none;background:none;padding:8px 0;cursor:pointer;",
    "  font:inherit;font-size:11px;letter-spacing:.16em;text-transform:uppercase;text-align:left;",
    "  color:var(--fs-erro)}",
    ".fs-menu button.fs-sair:hover{text-decoration:underline;text-underline-offset:3px}",
    /* a marca fica sempre no canto direito, então o menu abre para dentro;
       no celular ele ainda precisa caber na largura da tela */
    "@media (max-width:480px){.fs-menu{min-width:0;",
    "  width:max(190px,58vw);max-width:calc(100vw - 24px)}}",

    /* --- a tela de entrar, a mesma no portal e nos módulos ---
       Mesmo vocabulário do portão de cada módulo: cartão creme de 400 px,
       marca acima do nome, fio de sage separando, campos de canto suave com
       anel de foco e o botão cheio em teal. Quem vê as duas telas reconhece
       que são a mesma casa. */
    /* As Entradas estilizam dialog{} para as próprias janelas, e a
       centralização do navegador se perde. Em vez de torcer para que
       margin:auto sobreviva, a tela se centraliza sozinha. */
    ".fs-login:not([open]){display:none}",
    ".fs-login[open]{position:fixed;inset:0;width:100%;height:100%;max-width:100%;",
    "  max-height:100%;margin:0;border:none;padding:16px;background:none;",
    "  display:flex;align-items:center;justify-content:center;overflow:auto}",
    /* O fundo escurece e desfoca de leve: a página atrás recua sem sumir,
       e o cartão passa a ser a única coisa em foco. */
    ".fs-login::backdrop{background:rgba(12,24,22,.66);",
    "  backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}",

    ".fs-login .fs-cartao,.fs-retomada .fs-cartao{position:relative;width:min(400px,calc(100vw - 32px));",
    "  padding:42px 38px 32px;border-radius:16px;text-align:center;overflow:hidden;",
    /* a fonte é declarada aqui, não herdada: o CRM não define família no
       nível do documento, e o cartão saía em Times dentro dele */
    "  font-family:'Montserrat',Calibri,system-ui,-apple-system,sans-serif;",
    "  background:var(--fs-fundo);color:var(--fs-texto);",
    "  border:1px solid var(--fs-borda-cartao);",
    "  box-shadow:0 1px 2px rgba(20,40,38,.10), 0 24px 60px var(--fs-sombra);",
    "  animation:fs-surge .42s cubic-bezier(.2,.8,.2,1) both}",
    "@keyframes fs-surge{from{opacity:0;transform:translateY(12px)}}",

    /* A lótus no canto do cartão, quase invisível — o mesmo gesto do
       portão de cada módulo, na medida de um cartão. */
    ".fs-login .fs-cartao::after{content:'';position:absolute;",
    "  right:-58px;bottom:-72px;width:230px;height:230px;",
    "  background:var(--fs-marca-dagua) no-repeat center/contain;",
    "  opacity:var(--fs-agua-forca);pointer-events:none}",

    /* Um fio de sage atravessa o topo do cartão: o mesmo detalhe do fio que
       separa a marca, agora costurando a borda. */
    ".fs-login .fs-cartao::before,.fs-retomada .fs-cartao::before{",
    "  content:'';position:absolute;left:0;right:0;top:0;height:2px;",
    "  background:linear-gradient(90deg,transparent,var(--fs-fio),transparent)}",
    "@media (prefers-reduced-motion:reduce){.fs-login .fs-cartao{animation:none}}",

    /* rótulo que só o leitor de tela enxerga */
    ".fs-login .fs-so-leitor{position:absolute;width:1px;height:1px;overflow:hidden;",
    "  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}",

    ".fs-login .fs-marca img,.fs-retomada .fs-marca img{display:block;height:56px;width:auto;margin:0 auto 20px}",
    ".fs-login h2,.fs-retomada h2{font-family:\'Cormorant Garamond\',Georgia,\'Times New Roman\',serif;",
    "  font-weight:600;",
    "  font-size:30px;line-height:1.1;color:var(--fs-titulo)}",
    ".fs-login .fs-sub-marca,.fs-retomada .fs-sub-marca{margin-top:7px;font-size:9.5px;font-weight:300;letter-spacing:.26em;",
    "  text-transform:uppercase;color:var(--fs-suave)}",
    ".fs-login .fs-fio-linha,.fs-retomada .fs-fio-linha{width:38px;height:1px;background:var(--fs-fio);margin:22px auto 24px}",

    ".fs-login .fs-campo{position:relative;display:flex;align-items:center;text-align:left}",
    ".fs-login .fs-campo + .campo{margin-top:10px}",
    ".fs-login .fs-campo>svg{position:absolute;left:14px;color:var(--fs-suave);pointer-events:none}",
    ".fs-login .fs-campo input{width:100%;padding:14px 46px 14px 40px;",
    "  border:1px solid var(--fs-linha);border-radius:10px;",
    "  background:var(--fs-campo);color:var(--fs-texto);",
    "  font-family:var(--sans,\'Montserrat\',Calibri,system-ui,sans-serif);font-size:15px;",
    "  letter-spacing:.02em;",
    "  transition:border-color .18s ease, box-shadow .18s ease}",
    ".fs-login .fs-campo input::placeholder{color:var(--fs-suave);opacity:.85;letter-spacing:.01em}",
    ".fs-login .fs-campo input:focus{outline:none;border-color:var(--fs-realce);",
    "  box-shadow:0 0 0 3px var(--fs-anel)}",
    ".fs-login .fs-campo input:disabled{opacity:.6}",

    ".fs-login .fs-olho{position:absolute;right:6px;width:34px;height:34px;display:flex;",
    "  align-items:center;justify-content:center;border:none;border-radius:8px;",
    "  background:none;color:var(--fs-suave);cursor:pointer;",
    "  transition:color .18s ease, background .18s ease}",
    ".fs-login .fs-olho:hover{color:var(--fs-titulo);background:var(--fs-hover-suave)}",
    ".fs-login .fs-olho:focus-visible{outline:2px solid var(--fs-realce);outline-offset:1px}",
    ".fs-login .fs-olho .fs-fechado{display:none}",
    ".fs-login .fs-olho.fs-aberto .fs-destapado{display:none}",
    ".fs-login .fs-olho.fs-aberto .fs-fechado{display:block}",

    ".fs-login .fs-erro-caixa,.fs-retomada .fs-erro-caixa{display:flex;align-items:flex-start;gap:8px;margin-top:12px;",
    "  padding:10px 12px;border-radius:8px;",
    "  background:var(--fs-erro-bg);color:var(--fs-erro);",
    "  font-size:12.5px;line-height:1.45;text-align:left;",
    "  animation:fs-surge .26s ease both}",
    ".fs-login .fs-erro-caixa:empty,.fs-retomada .fs-erro-caixa:empty{display:none}",
    ".fs-login .fs-erro-caixa svg,.fs-retomada .fs-erro-caixa svg{flex:0 0 auto;margin-top:1px}",

    ".fs-login .fs-entrar,.fs-retomada .fs-entrar{width:100%;margin-top:16px;padding:13px;border:none;border-radius:10px;",
    "  cursor:pointer;font-family:var(--sans,\'Montserrat\',Calibri,system-ui,sans-serif);",
    "  font-size:13.5px;font-weight:600;letter-spacing:.06em;",
    "  background:var(--fs-botao);color:var(--fs-botao-cor);",
    "  transition:background .18s ease, box-shadow .2s ease, transform .15s ease}",
    ".fs-login .fs-entrar:hover:not(:disabled),.fs-retomada .fs-entrar:hover:not(:disabled){background:var(--fs-botao-hover);",
    "  box-shadow:0 8px 20px rgba(59,110,106,.28)}",
    ".fs-login .fs-entrar:active:not(:disabled),.fs-retomada .fs-entrar:active:not(:disabled){transform:translateY(1px)}",
    ".fs-login .fs-entrar:focus-visible,.fs-retomada .fs-entrar:focus-visible{outline:2px solid var(--fs-realce);outline-offset:2px}",
    ".fs-login .fs-entrar:disabled,.fs-retomada .fs-entrar:disabled{opacity:.72;cursor:default;box-shadow:none}",

    ".fs-login .fs-fechar{width:100%;margin-top:12px;padding:9px;border:none;border-radius:8px;",
    "  background:none;cursor:pointer;",
    "  font-family:var(--sans,\'Montserrat\',Calibri,system-ui,sans-serif);",
    "  font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;",
    "  color:var(--fs-suave);transition:color .18s ease, background .18s ease}",
    ".fs-login .fs-fechar:hover{color:var(--fs-titulo);background:var(--fs-hover-suave)}",
    ".fs-login .fs-fechar:focus-visible{outline:2px solid var(--fs-realce);outline-offset:1px}",

    "@media (max-width:420px){.fs-login .fs-cartao{padding:34px 24px 26px}",
    "  .fs-login h2{font-size:26px}.fs-login .fs-marca img{height:48px}}",

    /* --- retomada automática ---
       Aqui o assunto é a pessoa, não a marca: quem está sendo reconhecido é
       ela. Por isso a marca fica pequena no alto e o rosto no meio, com o
       arco da espera girando em volta — um foco só, em vez de dois círculos
       de mesmo tamanho competindo.

       O fundo repete o portão dos módulos, inclusive a lótus esmaecida no
       canto: quem vê as duas telas reconhece a mesma casa. */
    ".fs-retomada{position:fixed;inset:0;z-index:2147482000;",
    "  display:flex;align-items:center;justify-content:center;padding:20px;",
    /* A lótus do canto é desenhada 140px para fora, de propósito. Com
       overflow:auto isso virava barra de rolagem de verdade — e ainda
       empurrava o cartão alguns pixels para o lado. Corta na horizontal,
       rola só na vertical, para o cartão alto continuar alcançável. */
    "  background:var(--fs-fundo-portao);overflow-x:hidden;overflow-y:auto}",
    /* A lótus aparece cortada pelo canto, como no portão — mas o corte é
       feito pela própria caixa, que fica dentro da tela. Se ela sobrasse
       para fora, viraria barra de rolagem de verdade, e a barra reservada
       ainda empurrava o cartão alguns pixels para o lado. */
    ".fs-retomada::before{content:'';position:absolute;right:0;bottom:0;",
    "  width:380px;height:350px;background:var(--fs-marca-dagua) no-repeat;",
    "  background-size:520px 520px;background-position:0 0;",
    "  opacity:.055;filter:brightness(0) invert(1);pointer-events:none}",

    ".fs-retomada .fs-cartao{padding:36px 38px 34px;",
    "  animation:fs-surge .42s cubic-bezier(.2,.8,.2,1) both}",

    /* a marca, discreta, só para situar */
    ".fs-retomada .fs-selo{display:flex;flex-direction:column;align-items:center;gap:9px}",
    ".fs-retomada .fs-selo img{display:block;height:34px;width:auto;opacity:.9}",
    ".fs-retomada .fs-selo .fs-modulo{font-size:9.5px;font-weight:500;letter-spacing:.26em;",
    "  text-transform:uppercase;color:var(--fs-suave)}",

    /* o rosto no meio, com o arco em volta */
    ".fs-halo{position:relative;width:96px;height:96px;margin:26px auto 0}",
    /* o anel fica sempre: na espera o arco corre por cima dele, no erro ele
       sozinho continua emoldurando o rosto */
    ".fs-halo::after{content:'';position:absolute;inset:0;border-radius:50%;",
    "  border:2px solid var(--fs-linha);opacity:.5}",
    ".fs-halo .fs-avatar{position:absolute;left:12px;top:12px;width:72px;height:72px;",
    "  font-size:27px;border:none}",
    ".fs-arco{position:absolute;inset:0;width:96px;height:96px;z-index:1;",
    "  animation:fs-gira 1.5s linear infinite}",
    ".fs-arco circle{fill:none;stroke-width:2.5;stroke-linecap:round;",
    "  stroke:var(--fs-titulo);stroke-dasharray:64 220}",
    "@keyframes fs-gira{to{transform:rotate(360deg)}}",

    /* Quem pediu menos movimento fica com o anel parado, respirando de
       leve: o estado continua visível, sem nada rodando. */
    "@media (prefers-reduced-motion:reduce){",
    "  .fs-arco{animation:fs-respira 2.4s ease-in-out infinite}",
    "  .fs-retomada .fs-cartao{animation:none}",
    "}",
    "@keyframes fs-respira{0%,100%{opacity:.4}50%{opacity:1}}",

    ".fs-retomada .fs-nome-retoma{margin-top:16px;",
    "  font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;",
    "  font-size:23px;line-height:1.15;color:var(--fs-texto)}",
    ".fs-retomada .fs-passo{margin-top:6px;font-size:13px;line-height:1.55;",
    "  color:var(--fs-suave);max-width:30ch;margin-inline:auto}",

    ".fs-retomada .fs-botoes-retoma{display:flex;flex-direction:column;gap:8px;margin-top:18px}",
    ".fs-retomada .fs-secundario{width:100%;padding:11px;border-radius:10px;cursor:pointer;",
    "  border:1.5px solid var(--fs-linha);background:none;color:var(--fs-texto);",
    "  font-family:var(--sans,'Montserrat',Calibri,system-ui,sans-serif);",
    "  font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;",
    "  transition:border-color .18s ease, color .18s ease}",
    ".fs-retomada .fs-secundario:hover{border-color:var(--fs-realce);color:var(--fs-titulo)}",
    ".fs-retomada .fs-secundario:focus-visible{outline:2px solid var(--fs-realce);outline-offset:2px}",
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

  /* as duas caras do olho, como no portão dos módulos: o CSS mostra uma
     ou outra conforme a classe "aberto" */
  var OLHO =
    '<svg class="fs-destapado" width="17" height="17" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' +
    '<path d="M2.5 12S6.1 5.5 12 5.5 21.5 12 21.5 12 17.9 18.5 12 18.5 2.5 12 2.5 12Z"/>' +
    '<circle cx="12" cy="12" r="2.8"/></svg>' +
    '<svg class="fs-fechado" width="17" height="17" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' +
    '<path d="M2.5 12S6.1 5.5 12 5.5c1.6 0 3 .3 4.3.9M21.5 12s-3.6 6.5-9.5 6.5' +
    'c-1.7 0-3.1-.3-4.4-.9"/>' +
    '<path d="M9.7 9.8a3 3 0 0 0 4.2 4.2"/><path d="M4.2 19.8 19.8 4.2"/></svg>';

  /* O anel da espera: um trilho fino e um arco de um quarto girando por
     cima do anel do halo — o mesmo traço fino dos ícones do sistema. */
  var ARCO =
    '<svg class="fs-arco" viewBox="0 0 96 96" aria-hidden="true">' +
    '<circle cx="48" cy="48" r="46.5"/></svg>';

  /* o mesmo triângulo de aviso que os módulos usam */
  var AVISO =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M12 3.8 21 19.5H3L12 3.8Z"/><path d="M12 10v4M12 16.6v.4"/></svg>';

  function construir() {
    if (dlg) return dlg;
    porEstilo();
    dlg = document.createElement("dialog");
    dlg.className = "fs-login";
    dlg.style.setProperty("--fs-marca-dagua", 'url("' + caminhoDaLogo() + '")');
    dlg.innerHTML =
      '<div class="fs-cartao">' +
      '<div class="fs-marca">' +
      '<img src="' + esc(caminhoDaLogo()) + '" alt="" aria-hidden="true">' +
      "<h2>Entrar</h2>" +
      '<div class="fs-sub-marca" id="fs-sub">Corpo e Alma</div>' +
      "</div>" +
      '<div class="fs-fio-linha"></div>' +
      '<div class="fs-campo">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4S18.3 16.4 19.2 20"/></svg>' +
      '<label class="fs-so-leitor" for="fs-login-usuario">Usuário</label>' +
      '<input type="text" id="fs-login-usuario" placeholder="Usuário" autocomplete="username" ' +
      'autocapitalize="none" spellcheck="false">' +
      "</div>" +
      '<div class="fs-campo">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>' +
      '<label class="fs-so-leitor" for="fs-login-senha">Senha</label>' +
      '<input type="password" id="fs-login-senha" placeholder="Senha" ' +
      'autocomplete="current-password" enterkeyhint="go">' +
      '<button type="button" class="fs-olho" id="fs-olho" aria-label="Mostrar senha" ' +
      'aria-pressed="false">' + OLHO + "</button>" +
      "</div>" +
      '<div class="fs-erro-caixa" id="fs-login-erro" role="alert"></div>' +
      '<button type="button" class="fs-entrar" id="fs-login-btn">Entrar</button>' +
      '<button type="button" class="fs-fechar" id="fs-login-fechar">Cancelar</button>' +
      "</div>";
    document.body.appendChild(dlg);

    var campoU = dlg.querySelector("#fs-login-usuario");
    var campoS = dlg.querySelector("#fs-login-senha");
    var olho = dlg.querySelector("#fs-olho");

    olho.addEventListener("click", function () {
      var visivel = campoS.type === "text";
      campoS.type = visivel ? "password" : "text";
      olho.classList.toggle("fs-aberto", !visivel);
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
    caixa.innerHTML = texto ? AVISO + "<span>" + esc(texto) + "</span>" : "";
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
    dlg.querySelector("#fs-olho").classList.remove("fs-aberto");
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
      '<div class="fs-cabeca">' + avatarHTML(quem, 44) +
      '<div><div class="fs-nome-menu">' + esc(quem.nome) + "</div>" +
      '<div class="fs-login-arroba">@' + esc(quem.usuario) + (quem.admin ? " &middot; admin" : "") + "</div>" +
      "</div></div>" +
      '<div class="fs-mods">' + (mods.length
        ? mods.map(function (m) { return "<span>" + NOMES[m] + "</span>"; }).join("")
        : '<span class="fs-nenhum">Sem módulos liberados</span>') + "</div>" +
      '<div class="fs-fio-linha"></div>' +
      '<button type="button" class="fs-sair">Sair</button>' +
      "</div>";

    var botao = caixa.querySelector("button");
    botao.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var abriu = caixa.classList.toggle("fs-aberto");
      botao.setAttribute("aria-expanded", abriu ? "true" : "false");
    });

    caixa.querySelector(".fs-sair").addEventListener("click", async function () {
      await sair();
      if (typeof aoSair === "function") aoSair(); else location.reload();
    });

    document.addEventListener("click", function (ev) {
      if (!caixa.contains(ev.target)) caixa.classList.remove("fs-aberto");
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") caixa.classList.remove("fs-aberto");
    });

    alvo.appendChild(caixa);
    return caixa;
  }

  porEstilo();

  /* ---------- retomada automática ----------
     Quando existe sessão de usuário guardada e a pessoa abre um módulo, o
     sistema tenta entrar sozinho. Antes isso acontecia em silêncio: a tela
     de senha aparecia como se nada estivesse em curso, e um erro na
     tentativa sumia sem deixar rastro.

     Esta tela cobre a espera e, se der errado, fica no lugar mostrando o
     motivo — quem decide o que fazer depois é a pessoa.

     A tela vive fora do React de propósito, como a marca de quem está
     usando: assim os três módulos usam exatamente a mesma, e o CRM não
     precisa de um componente só dele. */

  var telaRetomada = null;
  var rolagemAntes = null;

  /* Travar só o body não basta: em página que não define altura, quem rola é
     o elemento raiz, e a barra aparece ao lado da tela de espera. Guardamos
     os dois valores para devolver exatamente como estavam. */
  function travarRolagem() {
    if (rolagemAntes) return;
    rolagemAntes = {
      corpo: document.body.style.overflow,
      raiz: document.documentElement.style.overflow,
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }

  function soltarRolagem() {
    if (!rolagemAntes) return;
    document.body.style.overflow = rolagemAntes.corpo;
    document.documentElement.style.overflow = rolagemAntes.raiz;
    rolagemAntes = null;
  }

  function encerrarRetomada() {
    if (telaRetomada && telaRetomada.parentNode) {
      telaRetomada.parentNode.removeChild(telaRetomada);
    }
    telaRetomada = null;
    soltarRolagem();
  }

  /* Só faz sentido para sessão de usuário individual. Quem entra pela senha
     compartilhada do módulo não tem conta, e a retomada daquela sessão
     continua acontecendo em silêncio, como sempre foi. */
  function mostrarRetomada(modulo) {
    if (!token()) return null;
    porEstilo();
    encerrarRetomada();

    var quem = perfil();
    var nome = NOMES[modulo] || modulo || "o sistema";

    telaRetomada = document.createElement("div");
    telaRetomada.className = "fs-retomada";
    /* o caminho da logo só se sabe agora; o CSS o recebe por variável */
    telaRetomada.style.setProperty("--fs-marca-dagua", 'url("' + caminhoDaLogo() + '")');
    telaRetomada.setAttribute("role", "status");
    telaRetomada.setAttribute("aria-live", "polite");
    telaRetomada.innerHTML =
      '<div class="fs-cartao">' +
      '<div class="fs-selo">' +
      '<img src="' + esc(caminhoDaLogo()) + '" alt="" aria-hidden="true">' +
      '<div class="fs-modulo">' + esc(nome) + "</div>" +
      "</div>" +
      '<div class="fs-corpo-retoma"></div>' +
      "</div>";

    document.body.appendChild(telaRetomada);
    travarRolagem();
    atualizarRetomada({ etapa: "entrando", modulo: modulo, quem: quem });
    return telaRetomada;
  }

  /* estado: { etapa, modulo, quem, mensagem, acoes:[{texto,fn}] }

     Se a tela já tiver sido fechada e alguém vier relatar um erro, ela é
     refeita. Sem isto um erro depois do fechamento não teria onde aparecer,
     e a pessoa veria o portão de senha sem explicação nenhuma. */
  function atualizarRetomada(estado) {
    if (!telaRetomada && estado && estado.etapa === "erro") {
      mostrarRetomada(estado.modulo);
    }
    if (!telaRetomada) return;
    var corpo = telaRetomada.querySelector(".fs-corpo-retoma");
    if (!corpo) return;

    var quem = estado.quem || perfil();
    var nome = NOMES[estado.modulo] || estado.modulo || "o sistema";
    var preposicao = estado.modulo === "entradas" ? "em " : "no ";
    if (estado.modulo === "agenda") preposicao = "na ";

    var html = "";
    var esperando = estado.etapa === "entrando";

    /* O retrato local só enfeita: quem diz se a sessão vale é o servidor.
       O arco só gira enquanto há espera — no erro o anel para e fica de
       moldura, para o rosto continuar ancorando a tela. */
    if (quem && quem.nome) {
      html += '<div class="fs-halo">' +
        (esperando ? ARCO : "") +
        avatarHTML(quem, 72) +
        "</div>" +
        '<div class="fs-nome-retoma">' + esc(quem.nome) + "</div>";
    } else if (esperando) {
      html += '<div class="fs-halo">' + ARCO + "</div>";
    }

    if (esperando) {
      html += '<div class="fs-passo">Entrando ' + esc(preposicao) + esc(nome) +
        " com sua conta…</div>";
    } else {
      html += '<div class="fs-erro-caixa">' + AVISO +
        "<span>" + esc(estado.mensagem || "") + "</span></div>";
    }

    corpo.innerHTML = html;

    if (estado.acoes && estado.acoes.length) {
      var caixa = document.createElement("div");
      caixa.className = "fs-botoes-retoma";
      estado.acoes.forEach(function (a, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = i === 0 ? "fs-entrar" : "fs-secundario";
        b.textContent = a.texto;
        b.addEventListener("click", a.fn);
        caixa.appendChild(b);
      });
      corpo.appendChild(caixa);
      var primeiro = caixa.querySelector("button");
      if (primeiro) primeiro.focus();
    }
  }

  /* Faz a tentativa inteira: mostra a tela, chama o servidor e, quando dá
     errado, deixa o motivo na tela com as saídas possíveis.

     Devolve true quando entrou. Devolve false quando não entrou — e nesse
     caso a tela CONTINUA no ar com o erro, de propósito: sem isto, uma
     sessão antiga da senha compartilhada entraria por baixo e esconderia
     o que aconteceu. Quem chama só precisa saber que não deve seguir. */
  async function tentarRetomar(modulo, opcoes) {
    var o = opcoes || {};
    if (!token()) return false;

    mostrarRetomada(modulo);

    var r;
    try {
      r = await retomar(modulo);
    } catch (e) {
      /* aqui o fetch falhou de verdade: é rede, não resposta do servidor */
      atualizarRetomada({
        etapa: "erro", modulo: modulo,
        mensagem: "Não foi possível confirmar sua sessão. Verifique sua conexão e tente novamente.",
        acoes: saidas(modulo, o, true),
      });
      anotarRetomadaFalhou(modulo, "rede");
      return false;
    }

    /* Deu certo com o servidor — mas o módulo ainda vai carregar os dados,
       e isso também pode falhar. A tela FICA no ar até quem chamou dizer
       que o módulo abriu de verdade, chamando encerrarRetomada(). Fechar
       aqui deixaria um erro do carregamento sem lugar para aparecer, e o
       portão de senha surgiria sem explicação. */
    if (r && r.ok) return true;

    atualizarRetomada({
      etapa: "erro", modulo: modulo,
      mensagem: motivoDaRetomada(r),
      acoes: saidas(modulo, o, false),
    });
    anotarRetomadaFalhou(modulo, (r && r.erro) || "sem_resposta");
    return false;
  }

  function motivoDaRetomada(r) {
    if (!r) return "Não foi possível confirmar sua sessão.";
    if (r.erro === "sem_acesso") {
      return "Não foi possível entrar automaticamente. Sua conta não possui acesso a este módulo.";
    }
    if (r.erro === "expirada") {
      return "Sua sessão expirou por inatividade. Entre novamente para continuar.";
    }
    if (r.erro === "inativo") return "Este usuário está desativado.";
    if (r.erro === "servidor_falhou") {
      return "Não foi possível confirmar sua sessão. O servidor respondeu com um erro.";
    }
    if (r.erro === "sessao") return "Sua sessão não vale mais. Entre novamente para continuar.";
    return "Não foi possível confirmar sua sessão.";
  }

  /* As saídas são sempre as mesmas do portão: a senha do módulo continua
     valendo, e trocar de conta também. */
  function saidas(modulo, o, foiRede) {
    var lista = [];

    if (foiRede) {
      lista.push({
        texto: "Tentar novamente",
        fn: function () { location.reload(); },
      });
    }

    lista.push({
      texto: "Entrar com senha",
      fn: function () {
        encerrarRetomada();
        if (typeof o.aoPedirSenha === "function") o.aoPedirSenha();
      },
    });

    lista.push({
      texto: "Entrar com outra conta",
      fn: function () {
        encerrarRetomada();
        abrirLogin({
          modulo: modulo,
          aoEntrar: function (r) {
            if (typeof o.aoEntrar === "function") o.aoEntrar(r);
          },
        });
      },
    });

    return lista;
  }

  function anotarRetomadaFalhou(modulo, motivo) {
    var registrar = global.FloreSerLogs && global.FloreSerLogs.registrar;
    if (!registrar) return;
    registrar("AUTOLOGIN_USUARIO_FALHOU", {
      nivel: "WARNING",
      mensagem: "Entrada automática em " + modulo + " não completou: " + motivo,
    });
  }

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
    tentarRetomar: tentarRetomar,
    mostrarRetomada: mostrarRetomada,
    atualizarRetomada: atualizarRetomada,
    encerrarRetomada: encerrarRetomada,
    dias: DIAS,
    nomeDoModulo: function (m) { return NOMES[m] || m; },
    possuiPermissao: function (modulo) {
      var quem = perfil();
      return !!(quem && quem.permissoes && quem.permissoes[modulo]);
    },
  };
})(window);
