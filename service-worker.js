/* =====================================================================
   Alveare — Service Worker do sistema FloreSer
   ---------------------------------------------------------------------
   Alveare é só o nome do aplicativo instalado. O que roda dentro dele
   continua sendo o FloreSer, do mesmo jeito de sempre: este arquivo não
   sabe de senha, de sessão nem de paciente, e não é para saber.

   O que ele guarda é a CASCA do sistema — HTML, scripts, marca, ícones.
   O que ele nunca guarda são os DADOS da clínica: toda chamada ao Apps
   Script passa direto para a rede, e a resposta não encosta no cache.
   Se a rede falhar, quem avisa é a tela, com a mensagem de sempre.

   O endereço do site pode não ser a raiz do domínio (no GitHub Pages ele
   é /floreser/). Por isso tudo aqui é derivado de registration.scope —
   nada de caminho absoluto escrito à mão.
   ===================================================================== */

"use strict";

/* Identificador técnico do cache. Não é a versão do sistema, que continua
   morando só no version.js: é o número que faz o navegador saber que a
   casca mudou. Suba um degrau quando alterar a lista do PRECACHE. */
const CACHE_PREFIXO = "alveare-casca-";
const CACHE_ATUAL = CACHE_PREFIXO + "3";

/* A raiz do site, seja ela / ou /floreser/ */
const RAIZ = new URL("./", self.registration.scope).pathname;

const paginaOffline = RAIZ + "offline.html";

/* A casca: o que precisa existir para a interface abrir sem rede.
   Dados da clínica não entram nesta lista — nem poderiam, são resposta
   de API. */
const PRECACHE = [
  RAIZ,
  RAIZ + "crm/",
  RAIZ + "agenda/",
  RAIZ + "entradas/",
  RAIZ + "offline.html",

  /* endereços antigos: quem tiver o link salvo continua chegando */
  RAIZ + "crm.html",
  RAIZ + "agenda.html",
  RAIZ + "entradas.html",

  RAIZ + "version.js",
  RAIZ + "logs.js",
  RAIZ + "tema.js",
  RAIZ + "auth.js",
  RAIZ + "painel.js",
  RAIZ + "pwa.js",
  RAIZ + "sync.js",
  RAIZ + "auditoria.js",
  RAIZ + "busca.js",

  RAIZ + "logo.png",
  RAIZ + "favicon.png",
  RAIZ + "manifest.webmanifest",

  RAIZ + "icons/icon-192.png",
  RAIZ + "icons/icon-512.png",
  RAIZ + "icons/icon-maskable-192.png",
  RAIZ + "icons/icon-maskable-512.png",
  RAIZ + "icons/apple-touch-icon.png",
];

/* Bibliotecas que o CRM carrega de fora (React, Babel, SheetJS). Sem elas
   o CRM não desenha nada, então vale guardar — mas só estas, por endereço
   exato, e nunca outra coisa que venha do mesmo servidor. */
const BIBLIOTECAS = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
];

/* Fontes da web: guardar ajuda, faltar não atrapalha — as páginas têm
   pilha de fallback. */
const FONTES = ["fonts.googleapis.com", "fonts.gstatic.com"];

/* ---------------------------------------------------------------- instalar */

self.addEventListener("install", function (evento) {
  evento.waitUntil((async function () {
    const cache = await caches.open(CACHE_ATUAL);

    /* Um a um: se um endereço falhar, os outros continuam. addAll desiste
       de tudo por causa de um só, e aí a instalação inteira se perde. */
    await Promise.all(PRECACHE.map(async function (endereco) {
      try {
        await cache.add(new Request(endereco, { cache: "reload" }));
      } catch (e) {
        /* segue sem este arquivo; a rede resolve quando houver */
      }
    }));

    await Promise.all(BIBLIOTECAS.map(async function (endereco) {
      try {
        const r = await fetch(endereco, { mode: "cors", cache: "reload" });
        if (r && r.ok) await cache.put(endereco, r);
      } catch (e) { }
    }));
  })());
});

/* ---------------------------------------------------------------- ativar */

self.addEventListener("activate", function (evento) {
  evento.waitUntil((async function () {
    /* Só os caches do Alveare. Outro sistema publicado no mesmo domínio
       tem os seus, e eles não são da nossa conta. */
    const nomes = await caches.keys();
    await Promise.all(nomes.map(function (nome) {
      if (nome.indexOf(CACHE_PREFIXO) === 0 && nome !== CACHE_ATUAL) {
        return caches.delete(nome);
      }
      return null;
    }));

    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { }
    }

    await self.clients.claim();
  })());
});

/* ---------------------------------------------------------------- conversa */

self.addEventListener("message", function (evento) {
  const dados = evento.data || {};

  /* Quem manda atualizar é a página, quando a pessoa clica em Atualizar.
     Nunca por conta própria: trocar de versão no meio de uma edição faria
     a pessoa perder o que estava escrevendo. */
  if (dados.tipo === "ATUALIZAR_AGORA") self.skipWaiting();

  if (dados.tipo === "LIMPAR_CASCA") {
    evento.waitUntil((async function () {
      const nomes = await caches.keys();
      await Promise.all(nomes
        .filter(function (n) { return n.indexOf(CACHE_PREFIXO) === 0; })
        .map(function (n) { return caches.delete(n); }));
      responder(evento, { tipo: "CASCA_LIMPA" });
    })());
  }

  if (dados.tipo === "ESTADO_CASCA") {
    evento.waitUntil((async function () {
      const cache = await caches.open(CACHE_ATUAL);
      const chaves = await cache.keys();
      responder(evento, {
        tipo: "ESTADO_CASCA",
        cache: CACHE_ATUAL,
        arquivos: chaves.length,
      });
    })());
  }
});

function responder(evento, corpo) {
  if (evento.source && evento.source.postMessage) {
    evento.source.postMessage(corpo);
  } else if (evento.ports && evento.ports[0]) {
    evento.ports[0].postMessage(corpo);
  }
}

/* ---------------------------------------------------------------- buscar */

function ehNossa(url) {
  return url.origin === self.location.origin && url.pathname.indexOf(RAIZ) === 0;
}

function ehBiblioteca(url) {
  return BIBLIOTECAS.indexOf(url.origin + url.pathname) >= 0;
}

function ehFonte(url) {
  return FONTES.indexOf(url.hostname) >= 0;
}

self.addEventListener("fetch", function (evento) {
  const pedido = evento.request;

  /* Só GET tem cache. POST, e é assim que o Apps Script é chamado, passa
     direto — nem sequer entramos no caminho. */
  if (pedido.method !== "GET") return;

  /* Quem pediu explicitamente para não usar cache — o logs.js faz isso ao
     conferir a versão — tem o pedido respeitado: passa direto. Também evita
     encher o cache de version.js?b=1234, um por conferida. */
  if (pedido.cache === "no-store" || pedido.cache === "reload") return;

  const url = new URL(pedido.url);

  /* Endereço de fora que não é biblioteca conhecida nem fonte: o Service
     Worker não se mete. WhatsApp, Apps Script, qualquer outro site. */
  if (!ehNossa(url) && !ehBiblioteca(url) && !ehFonte(url)) return;

  /* O version.js é a fonte da versão que a tela mostra: rede primeiro, para
     nunca anunciar uma versão que já passou. */
  if (url.pathname === RAIZ + "version.js") {
    evento.respondWith(redePrimeiro(pedido));
    return;
  }

  /* Página: rede primeiro, para ninguém ficar preso numa versão velha.
     Sem rede, o que estiver guardado; sem nada, a tela de offline. */
  if (pedido.mode === "navigate") {
    evento.respondWith(paginaPrimeiroDaRede(evento));
    return;
  }

  if (ehBiblioteca(url) || ehFonte(url)) {
    evento.respondWith(guardadoEnquantoAtualiza(pedido));
    return;
  }

  if (ehNossa(url)) {
    evento.respondWith(guardadoEnquantoAtualiza(pedido));
  }
});

/* Network first para HTML */
async function paginaPrimeiroDaRede(evento) {
  const pedido = evento.request;
  try {
    const pronta = await evento.preloadResponse;
    if (pronta) {
      guardar(pedido, pronta.clone());
      return pronta;
    }
    const daRede = await fetch(pedido);
    if (daRede && daRede.ok) guardar(pedido, daRede.clone());
    return daRede;
  } catch (e) {
    const guardada = await caches.match(pedido, { ignoreSearch: true });
    if (guardada) return guardada;

    /* a página pedida nunca foi aberta antes; mostra a tela de offline */
    const offline = await caches.match(paginaOffline);
    if (offline) return offline;

    return new Response(
      "Sem conexão e sem cópia guardada desta página.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}

/* Rede primeiro para arquivo solto: usado no version.js, que não pode
   ficar velho. Sem rede, vale a última cópia guardada. */
async function redePrimeiro(pedido) {
  try {
    const daRede = await fetch(pedido);
    if (daRede && daRede.ok) guardar(pedido, daRede.clone());
    return daRede;
  } catch (e) {
    const guardado = await caches.match(pedido, { ignoreSearch: true });
    if (guardado) return guardado;
    return new Response("", { status: 504, statusText: "Sem conexão" });
  }
}

/* Stale while revalidate: entrega o que tem e busca o novo para a próxima.
   Assim nenhum arquivo fica preso — a versão nova chega no recarregamento
   seguinte, e o aviso de atualização cuida do resto. */
async function guardadoEnquantoAtualiza(pedido) {
  const guardado = await caches.match(pedido);

  const daRede = fetch(pedido).then(function (r) {
    if (r && (r.ok || r.type === "opaque")) guardar(pedido, r.clone());
    return r;
  }).catch(function () { return null; });

  if (guardado) return guardado;

  const resposta = await daRede;
  if (resposta) return resposta;

  return new Response("", { status: 504, statusText: "Sem conexão" });
}

async function guardar(pedido, resposta) {
  try {
    const cache = await caches.open(CACHE_ATUAL);
    await cache.put(pedido, resposta);
  } catch (e) {
    /* cache cheio ou indisponível: o sistema continua pela rede */
  }
}
