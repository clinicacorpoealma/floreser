/* =====================================================================
   Alveare — a camada de aplicativo em volta do FloreSer
   ---------------------------------------------------------------------
   Alveare é o nome do aplicativo instalado. O sistema lá dentro continua
   sendo o FloreSer: este arquivo não mexe em login, sessão, permissão nem
   dado nenhum. Ele só cuida de quatro coisas:

     · registrar o Service Worker;
     · oferecer a instalação, quando o navegador permitir;
     · avisar quando existe versão nova, e só trocar quando a pessoa mandar;
     · dizer quando a conexão caiu e quando voltou.

   Nada disto é obrigatório para o sistema funcionar. Navegador sem suporte
   a Service Worker abre o FloreSer do mesmo jeito — o que falha aqui falha
   em silêncio, e o site segue.

   O endereço da raiz sai do próprio <script>, como no logs.js: assim vale
   tanto em /floreser/ quanto em localhost, e das páginas de dentro também.
   ===================================================================== */

(function (global) {
  "use strict";

  var RAIZ = (function () {
    try {
      var meu = document.currentScript && document.currentScript.src;
      return meu ? String(meu).replace(/[^/]*$/, "") : "./";
    } catch (e) {
      return "./";
    }
  })();

  var registrar = (global.FloreSerLogs && global.FloreSerLogs.registrar) ||
    function () { };

  function esc(t) {
    return String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- estado ---------- */

  var registro = null;          // ServiceWorkerRegistration
  var esperando = null;         // worker novo, pronto e aguardando
  var convite = null;           // evento beforeinstallprompt, só em memória
  var jaRecarregou = false;     // trava contra laço de recarga
  var primeiraVez = false;      // primeira instalação não é atualização

  function instalado() {
    try {
      if (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) return true;
      if (global.matchMedia && global.matchMedia("(display-mode: minimal-ui)").matches) return true;
      /* iOS antigo não conhece display-mode */
      return global.navigator.standalone === true;
    } catch (e) {
      return false;
    }
  }

  function ehIOS() {
    var ua = global.navigator.userAgent || "";
    var iPadNovo = /Macintosh/.test(ua) && global.navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || iPadNovo;
  }

  /* ---------- estilo ----------
     Mesmo vocabulário do resto do site: cantos suaves, Montserrat, teal e
     creme. A paleta é própria e segue o data-tema que o tema.js carimba,
     porque o CRM não fala a mesma língua de tokens das outras páginas. */

  var ESTILO = [
    ":root{",
    "  --pwa-fundo:#FFFFFF; --pwa-texto:#2D2D2D; --pwa-suave:#6E655C;",
    "  --pwa-teal:#3B6E6A; --pwa-linha:#E2DED7; --pwa-sobre-teal:#F5F0EB;",
    "  --pwa-teal-hover:#5A9490; --pwa-hover-suave:#EDF3F1;",
    "}",
    ':root[data-tema="escuro"]{',
    "  --pwa-fundo:#1E2927; --pwa-texto:#E9E3DB; --pwa-suave:#B4ADA3;",
    "  --pwa-teal:#7FB8B2; --pwa-linha:#33403E; --pwa-sobre-teal:#12201E;",
    "  --pwa-teal-hover:#93C6C0; --pwa-hover-suave:#26332F;",
    "}",

    ".pwa-aviso,.pwa-aviso *{box-sizing:border-box}",

    /* A faixa fica no centro e acima da linha do rodapé. Encostada num
       canto ela tapa alguém: à esquerda o Histórico, à direita o seletor
       de tema, rente ao fim o botão de instalar. Centralizada e 84px acima
       do fim da tela, passa longe dos três. */
    ".pwa-aviso{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);",
    "  z-index:2147483000;display:flex;align-items:center;gap:14px;",
    "  width:max-content;max-width:calc(100vw - 32px);padding:13px 16px;",
    "  border-radius:12px;border:1px solid var(--pwa-linha);",
    "  background:var(--pwa-fundo);color:var(--pwa-texto);",
    "  font-family:'Montserrat',Calibri,system-ui,sans-serif;font-size:13px;line-height:1.45;",
    "  box-shadow:0 2px 4px rgba(20,30,28,.06), 0 18px 40px -16px rgba(20,30,28,.42);",
    "  animation:pwa-sobe .28s cubic-bezier(.2,.8,.2,1) both}",
    "@keyframes pwa-sobe{from{opacity:0;transform:translateX(-50%) translateY(10px)}}",
    "@media (prefers-reduced-motion:reduce){.pwa-aviso{animation:none}}",
    ".pwa-aviso .pwa-texto{min-width:0}",
    ".pwa-aviso strong{display:block;font-weight:600;font-size:13px}",
    ".pwa-aviso small{display:block;margin-top:2px;font-size:11.5px;color:var(--pwa-suave)}",
    ".pwa-aviso .pwa-botoes{display:flex;align-items:center;gap:7px;flex:0 0 auto}",
    ".pwa-aviso button{border:none;border-radius:8px;cursor:pointer;",
    "  font-family:inherit;font-size:11px;font-weight:500;letter-spacing:.12em;",
    "  text-transform:uppercase;padding:9px 13px;white-space:nowrap;",
    "  transition:background .18s ease, color .18s ease}",
    ".pwa-aviso button.pwa-sim{background:var(--pwa-teal);color:var(--pwa-sobre-teal)}",
    ".pwa-aviso button.pwa-sim:hover{background:var(--pwa-teal-hover)}",
    ".pwa-aviso button.pwa-nao{background:none;color:var(--pwa-suave)}",
    ".pwa-aviso button.pwa-nao:hover{background:var(--pwa-hover-suave);color:var(--pwa-teal)}",
    ".pwa-aviso button:focus-visible{outline:2px solid var(--pwa-teal);outline-offset:2px}",
    ".pwa-aviso svg{flex:0 0 auto;color:var(--pwa-teal)}",

    /* No celular a faixa ocupa a linha inteira e empilha os botões. */
    "@media (max-width:640px){",
    "  .pwa-aviso{left:16px;right:16px;bottom:76px;transform:none;",
    "    width:auto;max-width:none;flex-direction:column;align-items:stretch;gap:10px}",
    "  .pwa-aviso .pwa-botoes{justify-content:flex-end}",
    "}",
    "@media (max-width:640px){",
    "  @keyframes pwa-sobe{from{opacity:0;transform:translateY(10px)}}",
    "}",

    /* o botão de instalar, para quem quiser colocar num canto */
    ".pwa-instalar{display:inline-flex;align-items:center;gap:8px;",
    "  padding:9px 15px;border:1px solid var(--pwa-teal);border-radius:999px;",
    "  background:none;cursor:pointer;font-family:'Montserrat',Calibri,system-ui,sans-serif;",
    "  font-size:10px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;",
    "  color:var(--pwa-teal);transition:background .18s ease, color .18s ease}",
    ".pwa-instalar:hover{background:var(--pwa-teal);color:var(--pwa-sobre-teal)}",
    ".pwa-instalar:focus-visible{outline:2px solid var(--pwa-teal);outline-offset:2px}",
  ].join("\n");

  var estiloPosto = false;
  function porEstilo() {
    if (estiloPosto) return;
    estiloPosto = true;
    var folha = document.createElement("style");
    folha.id = "pwa-estilo";
    folha.textContent = ESTILO;
    (document.head || document.documentElement).appendChild(folha);
  }

  /* ---------- a faixa de aviso ----------
     Uma de cada vez, sempre embaixo, sempre saindo do caminho. */

  var faixaAtual = null;

  function fecharFaixa() {
    if (faixaAtual && faixaAtual.parentNode) faixaAtual.parentNode.removeChild(faixaAtual);
    faixaAtual = null;
  }

  /* opcoes: { icone, titulo, detalhe, sim:{texto,fn}, nao:{texto,fn}, sozinho } */
  function faixa(opcoes) {
    porEstilo();
    fecharFaixa();

    var caixa = document.createElement("div");
    caixa.className = "pwa-aviso";
    caixa.setAttribute("role", opcoes.sim ? "dialog" : "status");
    caixa.setAttribute("aria-live", opcoes.sim ? "assertive" : "polite");
    if (opcoes.sim) caixa.setAttribute("aria-label", opcoes.titulo);

    caixa.innerHTML =
      (opcoes.icone || "") +
      '<div class="pwa-texto"><strong>' + esc(opcoes.titulo) + "</strong>" +
      (opcoes.detalhe ? "<small>" + esc(opcoes.detalhe) + "</small>" : "") +
      "</div>" +
      (opcoes.sim || opcoes.nao ? '<div class="pwa-botoes"></div>' : "");

    var botoes = caixa.querySelector(".pwa-botoes");
    if (opcoes.nao) {
      var nao = document.createElement("button");
      nao.type = "button";
      nao.className = "pwa-nao";
      nao.textContent = opcoes.nao.texto;
      nao.addEventListener("click", function () {
        fecharFaixa();
        if (opcoes.nao.fn) opcoes.nao.fn();
      });
      botoes.appendChild(nao);
    }
    if (opcoes.sim) {
      var sim = document.createElement("button");
      sim.type = "button";
      sim.className = "pwa-sim";
      sim.textContent = opcoes.sim.texto;
      sim.addEventListener("click", function () {
        if (opcoes.sim.fn) opcoes.sim.fn();
      });
      botoes.appendChild(sim);
    }

    document.body.appendChild(caixa);
    faixaAtual = caixa;

    if (opcoes.sozinho) {
      setTimeout(function () { if (faixaAtual === caixa) fecharFaixa(); }, opcoes.sozinho);
    }
    if (opcoes.sim) {
      var alvo = caixa.querySelector(".pwa-sim");
      if (alvo) alvo.focus();
    }
    return caixa;
  }

  var ICONE_NUVEM =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.5 18.5A3.9 3.9 0 0 1 6 10.7a5.4 5.4 0 0 1 10.4-1.3A3.9 3.9 0 0 1 17.8 18.5Z"/></svg>';

  var ICONE_SEM_NUVEM =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.5 18.5A3.9 3.9 0 0 1 6 10.7a5.4 5.4 0 0 1 8-2.4"/>' +
    '<path d="M16.4 9.4A3.9 3.9 0 0 1 17.8 18.5H9.5"/><path d="M4 4l16 16"/></svg>';

  var ICONE_SETA =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 4v11"/><path d="M8 11.5 12 15.5 16 11.5"/><path d="M5 19.5h14"/></svg>';

  /* ---------- conexão ----------
     navigator.onLine só serve de pista: quem confirma se a operação deu
     certo continua sendo a resposta do fetch, lá nos módulos. Aqui é só
     para a pessoa entender por que nada está salvando. */

  var estavaOffline = false;

  function caiu() {
    if (estavaOffline) return;
    estavaOffline = true;
    registrar("PWA_OFFLINE", { nivel: "WARNING", mensagem: "Sem conexão" });
    faixa({
      icone: ICONE_SEM_NUVEM,
      titulo: "Você está offline",
      detalhe: "Dá para consultar o que já está aberto. Salvar só quando a conexão voltar.",
    });
  }

  function voltou() {
    if (!estavaOffline) return;
    estavaOffline = false;
    registrar("PWA_ONLINE", { mensagem: "Conexão restabelecida" });
    faixa({
      icone: ICONE_NUVEM,
      titulo: "Conexão restabelecida",
      sozinho: 4000,
    });
  }

  global.addEventListener("offline", caiu);
  global.addEventListener("online", voltou);

  /* ---------- atualização ----------
     Nunca troca sozinho. O worker novo fica esperando até a pessoa clicar,
     porque trocar no meio de uma edição faria perder o que estava escrito. */

  function avisarAtualizacao(worker) {
    esperando = worker;
    registrar("PWA_ATUALIZACAO_DISPONIVEL", { mensagem: "Versão nova aguardando" });
    faixa({
      icone: ICONE_SETA,
      titulo: "Nova versão do Alveare disponível",
      detalhe: "Termine o que está fazendo e atualize quando quiser.",
      nao: { texto: "Agora não" },
      sim: {
        texto: "Atualizar",
        fn: function () {
          fecharFaixa();
          if (esperando) esperando.postMessage({ tipo: "ATUALIZAR_AGORA" });
        },
      },
    });
  }

  function acompanhar(reg) {
    if (reg.waiting && navigator.serviceWorker.controller) {
      avisarAtualizacao(reg.waiting);
    }

    reg.addEventListener("updatefound", function () {
      var novo = reg.installing;
      if (!novo) return;
      novo.addEventListener("statechange", function () {
        if (novo.state !== "installed") return;
        /* Sem controlador antes significa primeira instalação: a casca
           acabou de ser guardada, e isso não é uma atualização. */
        if (!navigator.serviceWorker.controller) {
          primeiraVez = true;
          return;
        }
        avisarAtualizacao(novo);
      });
    });
  }

  /* ---------- registro ---------- */

  function registrarWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register(RAIZ + "service-worker.js", { scope: RAIZ })
      .then(function (reg) {
        registro = reg;
        acompanhar(reg);

        /* uma conferida por sessão, sem insistir */
        setTimeout(function () { try { reg.update(); } catch (e) { } }, 8000);
      })
      .catch(function (erro) {
        registrar("PWA_SW_REGISTRO_FALHOU", {
          nivel: "WARNING",
          mensagem: "Service Worker não registrou: " + (erro && erro.name),
        });
      });

    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (jaRecarregou) return;
      jaRecarregou = true;
      registrar("PWA_ATUALIZADA", { mensagem: "Versão nova assumiu" });
      global.location.reload();
    });
  }

  /* ---------- instalar ----------
     O convite fica só na memória desta aba. Não vai para o localStorage:
     é um evento do navegador, não uma preferência da pessoa. */

  var aoMudarInstalacao = [];

  function avisarBotoes() {
    aoMudarInstalacao.forEach(function (f) {
      try { f(podeInstalar()); } catch (e) { }
    });
  }

  function podeInstalar() {
    return !!convite && !instalado();
  }

  global.addEventListener("beforeinstallprompt", function (ev) {
    /* segura o convite do navegador: quem decide a hora é a pessoa */
    ev.preventDefault();
    convite = ev;
    avisarBotoes();
  });

  global.addEventListener("appinstalled", function () {
    convite = null;
    avisarBotoes();
    registrar("PWA_INSTALADA", { mensagem: "Alveare instalado neste aparelho" });
    faixa({ icone: ICONE_NUVEM, titulo: "Alveare instalado", sozinho: 4000 });
  });

  async function instalar() {
    if (!convite) return "indisponivel";
    var guardado = convite;
    convite = null;          // um convite só serve uma vez
    avisarBotoes();
    try {
      guardado.prompt();
      var escolha = await guardado.userChoice;
      return escolha && escolha.outcome === "accepted" ? "aceitou" : "recusou";
    } catch (e) {
      return "falhou";
    }
  }

  /* Monta o botão dentro do elemento indicado — mas só quando ele vai
     funcionar de verdade. Botão que não faz nada é pior que botão nenhum. */
  function montarBotaoInstalar(alvo) {
    if (!alvo) return null;
    porEstilo();

    var b = document.createElement("button");
    b.type = "button";
    b.className = "pwa-instalar";
    b.hidden = true;
    b.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 4v10"/><path d="M8 10.5 12 14.5 16 10.5"/><path d="M5 19h14"/></svg>' +
      "<span>Instalar Alveare</span>";

    b.addEventListener("click", async function () {
      var fim = await instalar();
      if (fim === "aceitou") b.hidden = true;
    });

    function conferir(pode) { b.hidden = !pode; }
    aoMudarInstalacao.push(conferir);
    conferir(podeInstalar());

    alvo.appendChild(b);
    return b;
  }

  /* No iPhone e no iPad não existe convite programático: o caminho é o
     menu Compartilhar. Só faz sentido dizer isso lá — em Windows e Android
     seria instrução errada. */
  function dicaIOS() {
    if (!ehIOS() || instalado()) return null;
    return "Para instalar o Alveare: toque em Compartilhar e depois em " +
      "“Adicionar à Tela de Início”.";
  }

  /* ---------- painel de manutenção ---------- */

  function estadoTecnico() {
    return new Promise(function (resolve) {
      var base = {
        suportado: "serviceWorker" in navigator,
        controlando: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        modo: instalado() ? "instalado" : "navegador",
        atualizacao: esperando ? "aguardando" : "nenhuma pendente",
        conexao: navigator.onLine ? "online" : "offline",
        cache: "—",
        arquivos: 0,
      };
      if (!base.controlando) return resolve(base);

      var prazo = setTimeout(function () { resolve(base); }, 1200);
      var canal = new MessageChannel();
      canal.port1.onmessage = function (ev) {
        clearTimeout(prazo);
        var d = ev.data || {};
        base.cache = d.cache || "—";
        base.arquivos = d.arquivos || 0;
        resolve(base);
      };
      navigator.serviceWorker.controller.postMessage({ tipo: "ESTADO_CASCA" }, [canal.port2]);
    });
  }

  /* Apaga só os arquivos guardados do Alveare. Não encosta em localStorage:
     sessão, tema, foto e preferências continuam onde estão. */
  function limparCasca() {
    return new Promise(function (resolve) {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
        return resolve(false);
      }
      var prazo = setTimeout(function () { resolve(false); }, 3000);
      var canal = new MessageChannel();
      canal.port1.onmessage = function () { clearTimeout(prazo); resolve(true); };
      navigator.serviceWorker.controller.postMessage({ tipo: "LIMPAR_CASCA" }, [canal.port2]);
    });
  }

  /* ---------- porta de saída ---------- */

  global.Alveare = {
    raiz: RAIZ,
    instalado: instalado,
    podeInstalar: podeInstalar,
    instalar: instalar,
    montarBotaoInstalar: montarBotaoInstalar,
    aoMudarInstalacao: function (f) {
      aoMudarInstalacao.push(f);
      try { f(podeInstalar()); } catch (e) { }
    },
    dicaIOS: dicaIOS,
    temAtualizacao: function () { return !!esperando; },
    aplicarAtualizacao: function () {
      if (esperando) esperando.postMessage({ tipo: "ATUALIZAR_AGORA" });
    },
    estadoTecnico: estadoTecnico,
    limparCasca: limparCasca,
    online: function () { return navigator.onLine; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registrarWorker);
  } else {
    registrarWorker();
  }
})(window);
