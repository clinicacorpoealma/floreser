/* =====================================================================
   FloreSer · Corpo e Alma — registro técnico do site
   ---------------------------------------------------------------------
   Guarda o que acontece no site (aberturas, erros, acessos) para que dê
   para diagnosticar problema sem depender da memória de quem usou.

   O que é coletado segue o mínimo necessário: um identificador sorteado
   (nunca o nome de ninguém), a página, o horário e as características
   técnicas que o próprio navegador oferece sem pedir permissão. Nada de
   câmera, microfone, contatos, arquivos ou localização. Quando o
   navegador não informa alguma coisa, fica registrado como vazio e a
   tela mostra "Não disponível".

   Nada disso aparece para quem usa o site: a leitura exige a senha do
   painel de manutenção, conferida no Apps Script.
   ===================================================================== */

(function (global) {
  "use strict";

  var URL_API = "https://script.google.com/macros/s/AKfycbzy9WCfP4l08dn2h2K34uEL6e0mqFBjVMugcHiTc0oUGmpS7gOJjbxs58CB87AoFUw-/exec";

  var MAX_POR_SESSAO = 60;      // teto de eventos por visita
  var LOTE = 10;                // envia quando juntar esta quantidade
  var ESPERA = 2500;            // ms de folga antes do primeiro envio
  var REPETICAO = 10000;        // ms em que um evento igual é ignorado

  var fila = [];
  var enviados = 0;
  var ultimos = {};
  var dentro = false;           // trava contra laço de erro dentro do registro
  var timer = null;
  var estado = { envio: "nunca", quando: null, pendentes: 0 };

  /* ---------- utilidades tolerantes ---------- */

  function tentar(f, padrao) {
    try {
      var v = f();
      return v === undefined || v === null || v === "" ? padrao : v;
    } catch (e) {
      return padrao;
    }
  }

  function daArea(area, chave) {
    return tentar(function () { return global[area].getItem(chave); }, null);
  }

  function paraArea(area, chave, valor) {
    return tentar(function () { global[area].setItem(chave, valor); return true; }, false);
  }

  function sorteio() {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
  }

  function agora() {
    var d = new Date();
    function dd(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + dd(d.getMonth() + 1) + "-" + dd(d.getDate()) +
      "T" + dd(d.getHours()) + ":" + dd(d.getMinutes()) + ":" + dd(d.getSeconds());
  }

  function versao() {
    return tentar(function () { return global.FLORESER.rotulo; }, "");
  }

  /* Os módulos moram em pastas (/crm/, /agenda/, /entradas/), então o nome
     da página vem do último pedaço do caminho. A raiz do site — que pode
     estar dentro da pasta do repositório — é sempre o portal. Os endereços
     antigos, terminados em .html, continuam sendo reconhecidos pelo nome do
     arquivo enquanto os atalhos existirem. */
  var ROTAS = ["crm", "agenda", "entradas"];

  function pagina() {
    var caminho = tentar(function () { return global.location.pathname; }, "");
    var partes = String(caminho).split("/").filter(function (p) { return p; });
    var ultima = partes.length ? partes[partes.length - 1] : "";
    if (ROTAS.indexOf(ultima) >= 0) return ultima;
    if (ultima.slice(-5) === ".html") return ultima;
    return "index.html";
  }

  /* logs.js e version.js ficam na raiz do site; as páginas, um nível abaixo.
     O endereço da raiz sai do próprio <script>, então vale de qualquer nível. */
  var RAIZ = tentar(function () {
    var atual = document.currentScript && document.currentScript.src;
    return atual ? String(atual).replace(/[^/]*$/, "") : "";
  }, "");

  /* ---------- identificação pseudônima ---------- */

  var disp = daArea("localStorage", "floreser.disp");
  if (!disp) {
    disp = sorteio();
    paraArea("localStorage", "floreser.disp", disp);
  }

  var primeiro = daArea("localStorage", "floreser.desde");
  if (!primeiro) {
    primeiro = agora();
    paraArea("localStorage", "floreser.desde", primeiro);
  }

  var sessao = daArea("sessionStorage", "floreser.sessao");
  var entrada = daArea("sessionStorage", "floreser.entrada");
  if (!sessao) {
    sessao = disp + "-" + sorteio().slice(-4);
    paraArea("sessionStorage", "floreser.sessao", sessao);
    entrada = pagina();
    paraArea("sessionStorage", "floreser.entrada", entrada);
  }

  var vistas = Number(daArea("sessionStorage", "floreser.vistas") || 0) + 1;
  paraArea("sessionStorage", "floreser.vistas", String(vistas));

  /* ---------- o que o navegador oferece sem pedir nada ---------- */

  function navegador() {
    var ua = tentar(function () { return navigator.userAgent; }, "");
    var pares = [
      [/Edg\/([\d.]+)/, "Edge"], [/OPR\/([\d.]+)/, "Opera"],
      [/Firefox\/([\d.]+)/, "Firefox"], [/Chrome\/([\d.]+)/, "Chrome"],
      [/Version\/([\d.]+).*Safari/, "Safari"],
    ];
    for (var i = 0; i < pares.length; i++) {
      var m = String(ua).match(pares[i][0]);
      if (m) return pares[i][1] + " " + m[1].split(".")[0];
    }
    return "";
  }

  function tipoDeAparelho() {
    var largura = tentar(function () { return global.screen.width; }, 0);
    var toque = tentar(function () { return navigator.maxTouchPoints > 0; }, false);
    if (!largura) return "";
    if (largura < 768 && toque) return "celular (inferido)";
    if (largura < 1100 && toque) return "tablet (inferido)";
    return "computador (inferido)";
  }

  function retrato() {
    return {
      id: sessao,
      primeiroAcesso: primeiro,
      ultimoAcesso: agora(),
      paginas: String(vistas),
      entrada: entrada || pagina(),
      atual: pagina(),
      referrer: tentar(function () {
        var r = document.referrer;
        return r && r.indexOf(location.origin) !== 0 ? r.slice(0, 200) : "";
      }, ""),
      versao: versao(),
      navegador: navegador(),
      plataforma: tentar(function () { return navigator.platform; }, ""),
      idioma: tentar(function () { return navigator.language; }, ""),
      idiomas: tentar(function () { return (navigator.languages || []).join(", "); }, ""),
      cookies: tentar(function () { return navigator.cookieEnabled ? "sim" : "não"; }, ""),
      tela: tentar(function () {
        return global.screen.width > 0 ? global.screen.width + "x" + global.screen.height : "";
      }, ""),
      viewport: tentar(function () { return global.innerWidth + "x" + global.innerHeight; }, ""),
      dpr: tentar(function () { return String(global.devicePixelRatio); }, ""),
      toque: tentar(function () { return navigator.maxTouchPoints > 0 ? "sim" : "não"; }, ""),
      tipo: tipoDeAparelho(),
      fuso: tentar(function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; }, ""),
      conexao: tentar(function () { return navigator.connection.effectiveType; }, ""),
      memoria: tentar(function () { return navigator.deviceMemory + " GB (aprox.)"; }, ""),
      nucleos: tentar(function () { return String(navigator.hardwareConcurrency); }, ""),
      dnt: tentar(function () {
        var d = navigator.doNotTrack || global.doNotTrack;
        var gpc = navigator.globalPrivacyControl;
        if (gpc) return "GPC ativo";
        return d === "1" || d === "yes" ? "ativo" : d === "0" ? "desligado" : "";
      }, ""),
    };
  }

  /* ---------- registro ---------- */

  function registrar(evento, opcoes) {
    if (dentro) return;
    dentro = true;
    try {
      opcoes = opcoes || {};
      if (enviados + fila.length >= MAX_POR_SESSAO) return;

      var assinatura = evento + "|" + (opcoes.mensagem || "");
      var visto = ultimos[assinatura] || 0;
      if (Date.now() - visto < REPETICAO) return;
      ultimos[assinatura] = Date.now();

      fila.push({
        id: sorteio().slice(-8),
        quando: agora(),
        nivel: opcoes.nivel || "INFO",
        evento: String(evento).slice(0, 40),
        pagina: opcoes.pagina || pagina(),
        mensagem: String(opcoes.mensagem || "").slice(0, 400),
        versao: versao(),
        sessao: sessao,
      });
      estado.pendentes = fila.length;

      if (fila.length >= LOTE) enviar();
      else agendar();
    } catch (e) {
      /* nunca deixar o registro derrubar a página */
    } finally {
      dentro = false;
    }
  }

  function agendar() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; enviar(); }, ESPERA);
  }

  function corpo() {
    return JSON.stringify({ acao: "registrar", app: "floreser", logs: fila, sessao: retrato() });
  }

  function enviar(aoSair) {
    if (!fila.length) return;
    var carga = corpo();
    var quantos = fila.length;
    fila = [];
    estado.pendentes = 0;
    enviados += quantos;

    if (aoSair && global.navigator && navigator.sendBeacon) {
      var mandou = tentar(function () {
        return navigator.sendBeacon(URL_API, new Blob([carga], { type: "text/plain;charset=UTF-8" }));
      }, false);
      if (mandou) { estado.envio = "ok"; estado.quando = agora(); return; }
    }

    tentar(function () {
      fetch(URL_API, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: carga,
        redirect: "follow",
        keepalive: !!aoSair,
      }).then(function (r) { return r.json(); })
        .then(function (r) {
          estado.envio = r && r.ok ? "ok" : "erro";
          estado.quando = agora();
        })
        .catch(function () { estado.envio = "erro"; estado.quando = agora(); });
      return true;
    }, false);
  }

  /* ---------- falhas de comunicação ----------
     Envolve o fetch para notar quando o servidor não responde. As chamadas do
     próprio registro ficam de fora, senão uma falha de envio geraria um novo
     evento, que tentaria enviar de novo, sem fim. */

  tentar(function () {
    var original = global.fetch;
    if (!original) return false;

    function curto(url) {
      return tentar(function () { return new URL(url, location.href).hostname; }, "servidor");
    }

    global.fetch = function (url, opcoes) {
      var nosso = tentar(function () {
        return opcoes && typeof opcoes.body === "string" &&
          opcoes.body.indexOf('"acao":"registrar"') >= 0;
      }, false);

      return original.apply(this, arguments).then(function (r) {
        if (!nosso && !r.ok) {
          registrar("API_RESPOSTA", {
            nivel: "WARNING",
            mensagem: "Resposta " + r.status + " de " + curto(url),
          });
        }
        return r;
      }, function (erro) {
        if (!nosso) {
          registrar("API_FALHA", {
            nivel: "ERROR",
            mensagem: "Sem resposta de " + curto(url),
          });
        }
        throw erro;
      });
    };
    return true;
  }, false);

  /* ---------- captura de erros ---------- */

  tentar(function () {
    global.addEventListener("error", function (e) {
      registrar("ERRO_JS", {
        nivel: "ERROR",
        mensagem: (e && e.message ? e.message : "erro sem descrição") +
          (e && e.filename ? " · " + String(e.filename).split("/").pop() +
            (e.lineno ? ":" + e.lineno : "") : ""),
      });
    });

    global.addEventListener("unhandledrejection", function (e) {
      var razao = e && e.reason;
      registrar("PROMESSA_REJEITADA", {
        nivel: "ERROR",
        mensagem: String(razao && razao.message ? razao.message : razao).slice(0, 300),
      });
    });

    global.addEventListener("pagehide", function () { enviar(true); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") enviar(true);
    });
    return true;
  }, false);

  /* ---------- abertura da página ---------- */

  var aberturas = {
    "index.html": ["INDEX_ABERTO", "Portal aberto"],
    "crm": ["CRM_ABERTO", "CRM aberto"],
    "crm.html": ["CRM_ABERTO", "CRM aberto"],
    "agenda": ["AGENDA_ABERTO", "Agenda aberta"],
    "agenda.html": ["AGENDA_ABERTO", "Agenda aberta"],
  };

  tentar(function () {
    var qual = aberturas[pagina()] || ["PAGINA_ABERTA", "Página aberta"];
    registrar(qual[0], { mensagem: qual[1] });
    return true;
  }, false);

  /* ---------- versão em cache ----------
     O GitHub Pages guarda as páginas no navegador por um tempo. Quando sai
     uma versão nova, o site pode continuar mostrando a antiga. Duas coisas
     resolvem: os links internos levam a versão junto, e a página confere se
     o servidor já tem outra. */

  function versaoCurta() {
    return tentar(function () { return global.FLORESER.atual.versao; }, "");
  }

  tentar(function () {
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;

      var href = a.getAttribute("href") || "";
      if (!href || href.indexOf("?") >= 0 || /^(https?:|mailto:|tel:|javascript:|#)/i.test(href)) return;

      var v = versaoCurta();
      if (!v) return;

      e.preventDefault();
      enviar(true);
      location.assign(href + "?v=" + encodeURIComponent(v));
    });
    return true;
  }, false);

  function conferirVersao() {
    var aqui = versaoCurta();
    if (!aqui) return;

    tentar(function () {
      fetch(RAIZ + "version.js?b=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (txt) {
          var m = String(txt).match(/versao:\s*"([\d.]+)"/);
          if (!m || m[1] === aqui) return;

          registrar("VERSAO_DESATUALIZADA", {
            nivel: "WARNING",
            mensagem: "A página abriu na v" + aqui + " e o servidor já está na v" + m[1],
          });

          /* recarrega só o portal, que não tem nada em edição, e uma vez por sessão */
          if (pagina() === "index.html" && !daArea("sessionStorage", "floreser.recarga")) {
            paraArea("sessionStorage", "floreser.recarga", "1");
            setTimeout(function () { location.reload(); }, 400);
          }
        })
        .catch(function () { });
      return true;
    }, false);
  }

  setTimeout(conferirVersao, 4000);


  /* =====================================================================
     Falar com o Apps Script
     ---------------------------------------------------------------------
     Um POST para o /exec nunca é respondido direto: o Google devolve 302
     e manda o navegador buscar a resposta em
     script.googleusercontent.com/macros/echo?user_content_key=…

     Esse segundo salto é o ponto fraco. Ele falha de vez em quando com
     404 — sem nada de errado do nosso lado, sem nada de errado com a
     internet de quem está usando. Acontece mais quando várias chamadas
     saem quase juntas, que é justamente o que o sistema faz ao abrir um
     módulo com a conta já conectada: confere a sessão, lê os dados e
     registra o log, tudo em poucos segundos.

     Contra isso só há um remédio honesto: tentar de novo. Mas repetir
     sozinho só o que pode ser repetido sem consequência — leitura e
     conferência de sessão. Gravação não entra aqui: quem grava é dono do
     próprio reenvio, e cada módulo já cuida disso com a revisão em mãos.
     ===================================================================== */

  /* Status que valem outra tentativa. O 404 é o do redirecionamento; os
     5xx são o Apps Script sobrecarregado; 429 é limite de chamadas. */
  var STATUS_PASSAGEIRO = [404, 408, 425, 429, 500, 502, 503, 504];

  var ESPERAS = [400, 1200];    /* ms antes da 2ª e da 3ª tentativa */

  function dormir(ms) {
    return new Promise(function (ok) { setTimeout(ok, ms); });
  }

  /* Quando o Apps Script estoura, devolve uma página de erro em HTML.
     Ler o texto e não conseguir virar JSON é sinal disso. */
  function lerResposta(texto) {
    try { return { ok: true, dados: JSON.parse(texto) }; }
    catch (e) { return { ok: false, texto: texto }; }
  }

  /* postar(corpo, { repetir })
       repetir:true  → tenta até 3 vezes em falha passageira
       repetir:false → uma só, e quem chamou decide o que fazer
     Devolve o objeto que o servidor mandou. Se nem assim vier JSON,
     devolve { ok:false, erro:"servidor_falhou" } com o motivo legível —
     nunca deixa a tela achar que o problema é a internet de quem usa. */
  async function postar(corpo, opcoes) {
    var o = opcoes || {};
    var tentativas = o.repetir ? ESPERAS.length + 1 : 1;
    var ultimoStatus = 0;
    var ultimoTexto = "";

    for (var i = 0; i < tentativas; i++) {
      if (i > 0) await dormir(ESPERAS[i - 1]);

      var resposta;
      try {
        resposta = await fetch(URL_API, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
          redirect: "follow",
        });
      } catch (e) {
        /* rede caiu de verdade: repetir não ajuda a distinguir, e quem
           chamou precisa saber que foi conexão */
        throw e;
      }

      ultimoStatus = resposta.status;
      var texto = await resposta.text();
      ultimoTexto = texto;

      var lido = lerResposta(texto);
      if (resposta.ok && lido.ok) {
        if (i > 0) {
          registrar("REDE_REPETIU", {
            mensagem: "A resposta do servidor veio na tentativa " + (i + 1) +
              " (a anterior falhou com " + ultimoStatus + ").",
          });
        }
        return lido.dados;
      }

      /* resposta boa mas sem JSON, ou status que não vale repetir: para */
      var valeRepetir = STATUS_PASSAGEIRO.indexOf(resposta.status) >= 0;
      if (!valeRepetir && lido.ok) return lido.dados;
      if (!valeRepetir) break;
    }

    if (o.repetir) {
      registrar("REDE_DESISTIU", {
        nivel: "ERRO",
        mensagem: "O servidor não respondeu depois de " + tentativas +
          " tentativas (último status " + ultimoStatus + ").",
      });
    }

    return {
      ok: false,
      erro: "servidor_falhou",
      status: ultimoStatus,
      detalhe: resumoDaPagina(ultimoTexto),
    };
  }

  /* O texto da página de erro, sem marcação, para o painel mostrar. */
  function resumoDaPagina(html) {
    return String(html || "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  global.FloreSerRede = { postar: postar, enderecoDaApi: function () { return URL_API; } };

  global.FloreSerLogs = {
    registrar: registrar,
    enviar: function () { enviar(false); },
    versao: versaoCurta,
    conferir: conferirVersao,
    sessao: retrato,
    estado: function () {
      return { envio: estado.envio, quando: estado.quando, pendentes: fila.length, enviados: enviados };
    },
    armazenamento: function () {
      var l = paraArea("localStorage", "floreser.teste", "1");
      var s = paraArea("sessionStorage", "floreser.teste", "1");
      tentar(function () { localStorage.removeItem("floreser.teste"); sessionStorage.removeItem("floreser.teste"); }, null);
      return { local: l, sessao: s };
    },
  };
})(window);
