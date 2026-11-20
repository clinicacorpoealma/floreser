/* =====================================================================
   FloreSer · Corpo e Alma — telas da conta: entrar, retomar, quem está
   ---------------------------------------------------------------------
   A INTERFACE da conta individual, comum ao portal e aos três módulos: a
   caixa de entrar, a tela de retomada e a marca de quem está usando.

   A sessão em si — guardar o token, conferir, renovar, sair — é do
   compartilhado/sessao.js. Este arquivo pergunta a ele e desenha. Nada
   aqui decide permissão: quem decide é o Apps Script, em toda chamada.

   O que mudou na 4.0.0, e por quê (docs/SESSOES.md):
     · erro passageiro na retomada (sem rede, 404 do Google, servidor
       ocupado) tenta de novo sozinho e, se persistir, oferece "Tentar
       novamente" — nunca "entre de novo", porque a sessão continua boa;
     · conta sem acesso ao módulo NÃO encerra a conta: a tela diz o que
       houve e oferece voltar, a senha do módulo ou trocar de conta;
     · só uma recusa de autenticação do servidor pede login, e o que está
       na tela fica (pedirNovamente).
   ===================================================================== */

(function (global) {
  "use strict";

  var DIAS = 30;
  var NOMES = { crm: "CRM", agenda: "Agenda", entradas: "Entradas", financeiro: "Financeiro" };

  function S() { return global.FloreSerSessao; }

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

  /* ---------- o que este aparelho sabe da conta (do sessao.js) ---------- */

  function token() { return S() ? S().token() : ""; }
  function perfil() { return S() ? S().conta() : null; }

  /* Mantidas por compatibilidade: a atividade agora é do servidor, e
     "esquecer" é sair só deste aparelho. */
  function marcarAtividade() { }
  function esquecer() { if (S()) S().sair(); }

  function entrar(usuario, senha) {
    return S().entrar(usuario, senha).then(function (r) {
      if (!r.ok) anotarFalha(r);
      return r;
    });
  }

  function anotarFalha(r) {
    var codigo = r && r.erro ? r.erro.codigo : "";
    if (codigo === "credenciais" || codigo === "bloqueado") return;
    var registrar = global.FloreSerLogs && global.FloreSerLogs.registrar;
    if (registrar) registrar("LOGIN_FALHOU", { nivel: "WARNING", mensagem: "Login não completou: " + (codigo || "sem resposta") });
  }

  /* Usada quando a página abre com uma conta guardada. */
  function retomar(modulo) {
    if (!S() || !S().temConta()) return Promise.resolve({ ok: false, semSessao: true });
    return S().conferir({ modulo: modulo || "", comFoto: !perfilTemFoto() });
  }

  function perfilTemFoto() { var p = perfil(); return !!(p && p.foto !== undefined); }

  function sair() { return S().sair(); }

  /* A frase para cada resposta, com o que a pessoa pode fazer. */
  function recado(r) {
    var e = (r && r.erro) || {};
    switch (e.codigo) {
      case "bloqueado": return "Muitas tentativas erradas. Tente de novo em " + (e.minutos || 15) + " minutos.";
      /* o servidor diz qual dos dois: "Senha incorreta." (senha do módulo)
         ou "Usuário ou senha incorretos." (conta) */
      case "credenciais": return (e.mensagem || "Usuário ou senha incorretos.") +
        (e.restam ? " Restam " + e.restam + " tentativas." : "");
      case "sem_acesso": return "Esta conta não possui acesso a este módulo.";
      case "conta_inativa": return "Este usuário está desativado.";
      case "sessao_expirada": return "Sua sessão expirou. Entre novamente para continuar.";
      case "sessao_revogada": case "sessao_invalida": return "Sua sessão foi encerrada. Entre novamente para continuar.";
      case "senha_modulo_desligada": return e.mensagem || "A senha compartilhada deste módulo foi desligada. Entre com a sua conta.";
      case "manutencao": return e.mensagem || "O sistema está em manutenção. Tente de novo em alguns minutos.";
      case "versao_cliente": return "Este site está desatualizado. Recarregue a página.";
      case "versao_servidor": return "O servidor está numa versão diferente deste site. Avise quem administra o sistema.";
      case "sem_conexao": return "Sem conexão com o servidor. Confira a internet e tente de novo.";
      case "prazo": case "resposta_invalida": case "servidor_falhou": case "ocupado": case "resultado_desconhecido":
        return "O servidor não respondeu desta vez — acontece de vez em quando e não é problema seu. Tente de novo em alguns segundos.";
    }
    if (!r) return "Não foi possível falar com o servidor.";
    return e.mensagem || "O servidor recusou a operação. Se continuar, avise o suporte.";
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
    /* A retomada não é o portão. O portão é a porta da rua e é teal
       profundo nos dois temas, como manda a marca. A retomada é um
       instante entre duas telas claras — piscar um quase-preto no meio
       do caminho e voltar para o claro machuca os olhos. Ela ganha um
       fundo por tema: no claro, um creme um passo mais fundo que o
       cartão, para o cartão ainda se destacar. */
    "  --fs-retoma-fundo:#C9D3CA; --fs-retoma-agua:brightness(0);",
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
    "  --fs-retoma-fundo:#0B1413; --fs-retoma-agua:brightness(0) invert(1);",
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

    /* Em tela estreita a marca de quem entrou divide a barra com os botões
       do módulo. Ela encolhe primeiro: o nome corta com reticências, e o
       que precisa de toque continua inteiro. */
    "@media (max-width:620px){",
    "  .fs-quem{min-width:0;max-width:100%}",
    "  .fs-quem>button{min-width:0;max-width:100%;padding:4px 8px 4px 4px}",
    "  .fs-quem>button .fs-nome{max-width:9ch}",
    "}",
    "@media (max-width:400px){",
    "  .fs-quem>button .fs-nome{max-width:7ch}",
    "}",

    /* enquanto uma tela nossa está por cima, o que está atrás não rola */
    "html.fs-sem-rolagem,body.fs-sem-rolagem{overflow:hidden !important}",
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
    ".fs-login .fs-cartao::after{content:'';position:absolute;z-index:0;",
    "  right:-58px;bottom:-72px;width:230px;height:230px;",
    "  background:var(--fs-marca-dagua) no-repeat center/contain;",
    "  opacity:var(--fs-agua-forca);pointer-events:none}",

    /* A lótus é fundo, e fundo fica atrás. Sem isto ela passava por cima
       do botão de entrar: pseudo-elemento posicionado é pintado depois do
       conteúdo que não tem posição própria, por mais discreto que seja o
       desenho. Uma camada para o conteúdo resolve, e nenhum z-index alto
       precisa entrar na conta. */
    ".fs-login .fs-cartao>*,.fs-retomada .fs-cartao>*{position:relative;z-index:1}",

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
    "  background:var(--fs-retoma-fundo);overflow-x:hidden;overflow-y:auto}",
    /* A lótus aparece cortada pelo canto, como no portão — mas o corte é
       feito pela própria caixa, que fica dentro da tela. Se ela sobrasse
       para fora, viraria barra de rolagem de verdade, e a barra reservada
       ainda empurrava o cartão alguns pixels para o lado. */
    ".fs-retomada::before{content:'';position:absolute;right:0;bottom:0;",
    "  width:380px;height:350px;background:var(--fs-marca-dagua) no-repeat;",
    "  background-size:520px 520px;background-position:0 0;",
    "  opacity:.055;filter:var(--fs-retoma-agua);pointer-events:none}",

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

  /* a raiz do site vem do config.js — vale da raiz, de uma pasta e de file:// */
  function caminhoDaLogo() {
    if (!raizArquivos) raizArquivos = (global.FLORESER_CONFIG && global.FLORESER_CONFIG.raiz) || "";
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
    /* solta só o que a caixa de entrar segurou; o portão do módulo, se
       estiver aberto atrás, continua segurando o dele */
    soltarRolagem();
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
      var conta = r.dados.conta;
      r = { ok: true, token: r.dados.token, usuario: conta, sessao: r.dados.sessao };
      if (moduloPedido && !(conta.permissoes || {})[moduloPedido]) {
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
    travarRolagem();
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

  /* Travar só o body não basta: em página que não define altura, quem rola é
     o elemento raiz, e a barra aparece ao lado da tela de espera. Por isso os
     dois levam a marca.

     A trava é uma CLASSE, não style inline. Guardar e devolver o valor inline
     parecia mais educado, mas era justamente o erro: os módulos escrevem no
     mesmo atributo para segurar a rolagem atrás do próprio portão. Quando a
     tela de retomada guardava esse "hidden" e devolvia depois de o módulo já
     ter liberado, a página ficava travada — a pessoa via tudo e não conseguia
     rolar nada. Com classe, cada um cuida do seu e ninguém sobrescreve ninguém. */
  var MARCA_TRAVA = "fs-sem-rolagem";

  function travarRolagem() {
    document.body.classList.add(MARCA_TRAVA);
    document.documentElement.classList.add(MARCA_TRAVA);
  }

  function soltarRolagem() {
    document.body.classList.remove(MARCA_TRAVA);
    document.documentElement.classList.remove(MARCA_TRAVA);
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
  function dormir(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  function anotarRetomada(evento, modulo, motivo) {
    var registrar = global.FloreSerLogs && global.FloreSerLogs.registrar;
    if (registrar) registrar(evento, { nivel: "WARNING", mensagem: "Retomada em " + modulo + ": " + motivo });
  }

  function voltarAoInicio() {
    location.href = (global.FLORESER_CONFIG && global.FLORESER_CONFIG.raiz) || "../";
  }

  /* Retoma a conta guardada ao abrir um módulo.
     Devolve true quando pode seguir — e a tela, se chegou a aparecer, fica
     até o módulo chamar encerrarRetomada(). Devolve false quando não pode,
     e a tela fica com o motivo e as saídas certas para cada caso. */
  async function tentarRetomar(modulo, opcoes) {
    var o = opcoes || {};
    if (!S() || !S().temConta()) return false;

    /* sem piscar: a tela de espera só aparece se a confirmação demorar */
    var mostrou = false;
    var timer = setTimeout(function () { mostrou = true; mostrarRetomada(modulo); }, 450);
    var r = null;
    var esperas = [0, 1500, 4000];
    for (var i = 0; i < esperas.length; i++) {
      if (esperas[i]) await dormir(esperas[i]);
      r = await retomar(modulo);
      if (r.ok || !r.temporario) break;
    }
    clearTimeout(timer);

    if (r.ok && r.acessoModulo !== false) return true;

    if (r.ok && r.acessoModulo === false) {
      anotarRetomada("RETOMADA_SEM_ACESSO", modulo, "conta sem este módulo");
      if (!mostrou) mostrarRetomada(modulo);
      var saidas = [{ texto: "Voltar ao início", fn: voltarAoInicio }];
      if (typeof o.aoPedirSenha === "function") saidas.push({ texto: "Usar a senha do módulo", fn: function () { encerrarRetomada(); o.aoPedirSenha(); } });
      saidas.push({ texto: "Trocar de conta", fn: function () { trocarDeConta(modulo, o); } });
      atualizarRetomada({ etapa: "erro", modulo: modulo,
        mensagem: "Sua conta continua ativa, mas não tem acesso a " + (NOMES[modulo] || modulo) + ". Fale com quem administra o sistema se precisar dele.",
        acoes: saidas });
      return false;
    }

    if (r.semSessao || (r.erro && r.erro.categoria === "autenticacao")) {
      /* a sessão acabou de verdade: direto para entrar, sem tela de erro */
      encerrarRetomada();
      anotarRetomada("RETOMADA_SESSAO_ENCERRADA", modulo, (r.erro && r.erro.codigo) || "sem sessão");
      abrirLogin({ modulo: modulo, aviso: recado(r), aoEntrar: function (x) { if (typeof o.aoEntrar === "function") o.aoEntrar(x); } });
      return false;
    }

    /* passageiro que não passou: a conta continua guardada */
    anotarRetomada("RETOMADA_ADIADA", modulo, (r.erro && r.erro.codigo) || "sem resposta");
    if (!mostrou) mostrarRetomada(modulo);
    atualizarRetomada({ etapa: "erro", modulo: modulo,
      mensagem: "Não foi possível confirmar sua sessão agora. " + recado(r) + " Sua conta continua conectada — nada foi perdido.",
      acoes: [{ texto: "Tentar novamente", fn: function () { location.reload(); } },
        { texto: "Voltar ao início", fn: voltarAoInicio }] });
    return false;
  }

  function trocarDeConta(modulo, o) {
    encerrarRetomada();
    abrirLogin({ modulo: modulo, aoEntrar: function (r) { if (typeof o.aoEntrar === "function") o.aoEntrar(r); } });
  }

  /* A sessão acabou no meio do trabalho (uma gravação foi recusada por
     autenticação). Abre a caixa de entrar POR CIMA do que está na tela;
     o que não foi salvo continua na memória e sobe depois. Resolve com o
     token novo, ou null se a pessoa cancelar. Só uma caixa por vez. */
  var pedindo = null;
  function pedirNovamente(modulo, motivo) {
    if (pedindo) return pedindo;
    pedindo = new Promise(function (resolver) {
      var feito = false;
      abrirLogin({ modulo: modulo,
        aviso: motivo || "Sua sessão terminou. Entre de novo para salvar o que está na tela — nada foi perdido.",
        aoEntrar: function (r) { feito = true; pedindo = null; resolver(r && r.token ? r.token : token()); } });
      var acompanhar = setInterval(function () {
        if (feito) { clearInterval(acompanhar); return; }
        if (dlg && !dlg.open) { clearInterval(acompanhar); pedindo = null; resolver(null); }
      }, 400);
    });
    return pedindo;
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
    pedirNovamente: pedirNovamente,
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
