/* =====================================================================
   FloreSer · Corpo e Alma — tema claro, escuro e automático
   ---------------------------------------------------------------------
   Este arquivo entra ANTES do resto da página, no <head>, e a primeira
   coisa que faz é carimbar o tema na raiz do documento. É isso que evita
   a piscada: quando o navegador desenha o primeiro quadro, as cores já
   estão decididas.

   A escolha fica no localStorage deste aparelho, em "floreser.tema", e
   vale "claro", "escuro" ou "auto". Não passa pelo servidor e não depende
   de senha — é uma preferência de quem está olhando a tela.

   As cores vivem em variáveis CSS. O tema escuro só troca o valor das
   variáveis; nenhuma regra de layout é reescrita. Para criar um tema novo
   no futuro, basta acrescentar outro bloco :root[data-tema="..."] aqui.
   ===================================================================== */

(function (global) {
  "use strict";

  var CHAVE = "floreser.tema";
  var ESCOLHAS = ["claro", "escuro", "auto"];
  var PADRAO = "auto";

  var raiz = document.documentElement;
  var consulta = null;

  function tentar(f, padrao) {
    try {
      var v = f();
      return v === undefined || v === null || v === "" ? padrao : v;
    } catch (e) {
      return padrao;
    }
  }

  function escolhaGuardada() {
    var v = tentar(function () { return localStorage.getItem(CHAVE); }, "");
    return ESCOLHAS.indexOf(v) >= 0 ? v : PADRAO;
  }

  function guardar(v) {
    tentar(function () { localStorage.setItem(CHAVE, v); return true; }, false);
  }

  function sistemaEscuro() {
    return tentar(function () {
      return global.matchMedia("(prefers-color-scheme: dark)").matches;
    }, false);
  }

  /* a escolha vira um tema de verdade: "auto" pergunta ao sistema */
  function resolver(escolha) {
    if (escolha === "claro" || escolha === "escuro") return escolha;
    return sistemaEscuro() ? "escuro" : "claro";
  }

  var escolha = escolhaGuardada();

  function aplicar(qual, comTransicao) {
    var tema = resolver(qual);
    if (comTransicao) suavizar();
    raiz.setAttribute("data-tema", tema);
    raiz.setAttribute("data-tema-escolha", qual);
    var cor = tema === "escuro" ? "#141C1B" : "#3B6E6A";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", cor);
    marcarBotoes(qual);
  }

  /* ---------- primeiro carimbo: antes de qualquer pintura ---------- */
  aplicar(escolha, false);

  /* ---------- troca suave, só no instante da troca ----------
     Uma transição permanente atrapalharia os realces de hover; esta entra,
     dura o tempo da mudança e sai. */
  var relogioSuave = null;
  function suavizar() {
    var quieto = tentar(function () {
      return global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }, false);
    if (quieto) return;
    raiz.setAttribute("data-tema-trocando", "1");
    clearTimeout(relogioSuave);
    relogioSuave = setTimeout(function () {
      raiz.removeAttribute("data-tema-trocando");
    }, 260);
  }

  /* ---------- o sistema mudou de tema com a página aberta ---------- */
  function ouvirSistema() {
    consulta = tentar(function () {
      return global.matchMedia("(prefers-color-scheme: dark)");
    }, null);
    if (!consulta) return;
    var aoMudar = function () {
      if (escolha === "auto") aplicar("auto", true);
    };
    if (consulta.addEventListener) consulta.addEventListener("change", aoMudar);
    else if (consulta.addListener) consulta.addListener(aoMudar);

    /* Rede de segurança: alguns navegadores não avisam a mudança enquanto a
       aba está em segundo plano. Ao voltar para ela, conferimos de novo. */
    var reconferir = function () {
      if (escolha !== "auto") return;
      if (raiz.getAttribute("data-tema") !== resolver("auto")) aplicar("auto", true);
    };
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) reconferir();
    });
    global.addEventListener("focus", reconferir);
    global.addEventListener("pageshow", reconferir);
  }
  ouvirSistema();

  /* ---------- a paleta ----------
     Só valores. O tema claro é o que o site sempre teve, escrito aqui
     apenas onde precisou de nome novo; o escuro é uma versão desenhada
     para o escuro, não uma inversão. */
  var PALETA = [
    ":root{",
    /* superfície de destaque (o teal preenchido) e o texto que vai sobre ela */
    "  --teal-fundo:#3B6E6A;",
    "  --teal-escuro-fundo:#2E5754;",
    "  --teal-fundo-hover:#5A9490;",
    "  --sobre-teal:#FFFFFF;",
    /* o seletor de tema tem cores próprias para funcionar em qualquer página */
    "  --tema-fundo:#FFFFFF;",
    "  --tema-borda:#E2DED7;",
    "  --tema-icone:#95867A;",
    "  --tema-ativo:#3B6E6A;",
    "  --tema-ativo-fundo:#E7EEEB;",
    "  --tema-sombra:0 1px 2px rgba(45,45,45,.05), 0 8px 22px -14px rgba(59,110,106,.45);",
    "}",

    ':root[data-tema="claro"]{ color-scheme: light; }',

    ':root[data-tema="escuro"]{',
    "  color-scheme: dark;",
    /* ----- vocabulário da marca (portal, agenda e portões) ----- */
    "  --teal:#7FB8B2;",
    "  --teal-light:#93C6C0;",
    "  --teal-deep:#A8D3CE;",
    "  --sage:#3C5A56;",
    "  --creme:#141C1B;",
    "  --taupe:#A39B90;",
    "  --carvao:#E9E3DB;",
    "  --branco:#1E2927;",
    "  --linha:#33403E;",
    "  --alerta:#E79B82;",
    "  --alerta-bg:#3A241D;",
    "  --alerta-texto:#F0BCA9;",
    "  --info-bg:#1A2624;",
    "  --teal-fundo:#2A514D;",
    "  --teal-escuro-fundo:#0F1817;",
    "  --teal-fundo-hover:#35625D;",
    "  --sobre-teal:#EAF1EF;",
    "  --sombra:0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.28);",
    "  --sombra-alta:0 2px 4px rgba(0,0,0,.34), 0 18px 40px rgba(0,0,0,.44);",
    /* ----- vocabulário do módulo de Entradas ----- */
    "  --bg:#141C1B;",
    "  --bg-grad:radial-gradient(140% 90% at 50% -20%, #1B2624 0%, #151E1D 62%, #111917 100%);",
    "  --surface:#1E2927;",
    "  --surface-2:#1A2422;",
    "  --surface-3:#283634;",
    "  --border:#33403E;",
    "  --border-strong:#485754;",
    "  --text:#E9E3DB;",
    "  --text-2:#B4ADA3;",
    "  --text-3:#9A938A;",
    "  --text-4:#7E7870;",
    "  --accent:#7FB8B2;",
    "  --accent-hover:#93C6C0;",
    "  --accent-soft:#22403D;",
    "  --accent-line:#3C5A56;",
    "  --on-accent:#0F1B1A;",
    "  --focus:#93C6C0;",
    "  --danger:#E79B82;",
    "  --danger-soft:#3A241D;",
    "  --shadow-sm:0 1px 2px rgba(0,0,0,.28), 0 6px 16px -12px rgba(0,0,0,.6);",
    "  --shadow-md:0 1px 2px rgba(0,0,0,.3), 0 12px 28px -18px rgba(0,0,0,.7);",
    "  --shadow-alta:0 2px 4px rgba(0,0,0,.34), 0 16px 34px -20px rgba(0,0,0,.75);",
    "  --shadow-lg:0 24px 60px -24px rgba(0,0,0,.8), 0 4px 12px rgba(0,0,0,.4);",
    /* formas de pagamento: mesmos matizes, rebaixados para o fundo escuro */
    "  --m-debito-bg:#26304A;   --m-debito-fg:#AEBCE6;   --m-debito-dot:#8496D8;",
    "  --m-credito-bg:#382A38;  --m-credito-fg:#D8B9D6;  --m-credito-dot:#C093BD;",
    "  --m-pix-bg:#123A3E;      --m-pix-fg:#83D7DD;      --m-pix-dot:#4FC3CC;",
    "  --m-dinheiro-bg:#273524; --m-dinheiro-fg:#B2CDA6; --m-dinheiro-dot:#8DB57F;",
    "  --m-boleto-bg:#352C23;   --m-boleto-fg:#D5B999;   --m-boleto-dot:#BE9A72;",
    "  --m-haver-bg:#42281B;    --m-haver-fg:#EAAB84;    --m-haver-dot:#D98C5F;",
    /* ----- vocabulário do CRM ----- */
    "  --crm-floresta:#131D1C;",
    "  --crm-verde:#7FB8B2;",
    "  --crm-verde-fundo:#2A514D;",
    "  --crm-verde-hover:#35625D;",
    "  --crm-sobre-verde:#EAF1EF;",
    "  --crm-ouro:#C9AC7A;",
    "  --crm-areia:#141C1B;",
    "  --crm-superficie:#1E2927;",
    "  --crm-superficie-2:#243130;",
    "  --crm-branco:#1E2927;",
    "  --crm-atrasado:#E79B82;",
    "  --crm-atrasado-bg:#3A241D;",
    "  --crm-borda:#33403E;",
    "  --crm-borda-forte:#485754;",
    "  --crm-suave:#9A938A;",
    "  --crm-suave-forte:#A8A199;",
    "  --crm-texto:#E9E3DB;",
    "  --crm-topo-rotulo:#93A5A0;",
    "  --crm-topo-serif:#D8C9A5;",
    "  --crm-etiqueta-bg:#26403D;",
    "  --crm-etiqueta-ouro-bg:#3A3122;",
    "  --crm-etiqueta-cad-bg:#213230;",
    "  --crm-desativado:#3A4A47;",
    "  --crm-fantasma:#7E7870;",
    /* ----- o próprio seletor de tema ----- */
    "  --tema-fundo:#1E2927;",
    "  --tema-borda:#3A4744;",
    "  --tema-icone:#9A938A;",
    "  --tema-ativo:#7FB8B2;",
    "  --tema-ativo-fundo:#22403D;",
    "  --tema-sombra:0 1px 2px rgba(0,0,0,.35), 0 8px 22px -14px rgba(0,0,0,.7);",
    "}",

    /* ----- a troca em si, suave e curta ----- */
    ':root[data-tema-trocando] *,',
    ':root[data-tema-trocando] *::before,',
    ':root[data-tema-trocando] *::after{',
    "  transition: background-color .22s ease, color .22s ease, border-color .22s ease, fill .22s ease, box-shadow .22s ease !important;",
    "}",

    /* ----- o seletor ----- */
    ".tema-seletor{",
    "  position:fixed; right:16px; bottom:16px; z-index:600;",
    "  display:inline-flex; gap:2px; padding:3px;",
    "  background:var(--tema-fundo); border:1px solid var(--tema-borda);",
    "  border-radius:999px; box-shadow:var(--tema-sombra);",
    "  opacity:.82; transition:opacity .18s ease;",
    "}",
    ".tema-seletor:hover,.tema-seletor:focus-within{opacity:1}",
    ".tema-seletor button{",
    "  width:28px; height:28px; display:grid; place-items:center;",
    "  border:none; background:none; border-radius:999px; padding:0;",
    "  color:var(--tema-icone); cursor:pointer;",
    "  transition:color .18s ease, background .18s ease;",
    "}",
    ".tema-seletor button:hover{color:var(--tema-ativo)}",
    '.tema-seletor button[aria-pressed="true"]{',
    "  background:var(--tema-ativo-fundo); color:var(--tema-ativo);",
    "}",
    ".tema-seletor button:focus-visible{outline:2px solid var(--tema-ativo); outline-offset:1px}",
    ".tema-seletor svg{width:15px; height:15px; display:block}",
    "@media (max-width:620px){",
    "  .tema-seletor{right:12px; bottom:12px; padding:2px}",
    "  .tema-seletor button{width:30px; height:30px}",
    "}",
    /* O seletor flutua no canto e não sai do lugar quando a página termina.
       Sem folga ele fica em cima do rodapé — justamente onde mora o estado
       da sincronização, que às vezes precisa ser tocado.

       Mas a folga só faz sentido em página que rola: ali o rodapé chega ao
       fim da tela e passaria por baixo do seletor. Numa página que já cabe
       inteira, não há nada escondido para proteger — e a faixa fixa só
       criava barra de rolagem onde não havia. Quem decide é o ajuste lá
       embaixo; aqui fica só a medida. */
    ".tema-folga{height:52px;flex:none;pointer-events:none}",
    "@media (max-width:620px){ .tema-folga{height:60px} }",
    "@media print{ .tema-seletor,.tema-folga{display:none} }",
  ].join("\n");

  var folha = document.createElement("style");
  folha.id = "tema-paleta";
  folha.textContent = PALETA;
  (document.head || raiz).appendChild(folha);

  /* ---------- o seletor na tela ---------- */

  var ICONES = {
    claro:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/>' +
      '<path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7' +
      'M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/></svg>',
    escuro:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20.5 14.6A8.8 8.8 0 0 1 9.4 3.5a8.8 8.8 0 1 0 11.1 11.1Z"/></svg>',
    auto:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="8.5"/>' +
      '<path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/></svg>',
  };

  var NOMES = { claro: "Tema claro", escuro: "Tema escuro", auto: "Acompanhar o sistema" };

  var caixa = null;

  function marcarBotoes(qual) {
    if (!caixa) return;
    var botoes = caixa.querySelectorAll("[data-tema-opcao]");
    for (var i = 0; i < botoes.length; i++) {
      var b = botoes[i];
      var meu = b.getAttribute("data-tema-opcao");
      b.setAttribute("aria-pressed", meu === qual ? "true" : "false");
    }
  }

  function montarSeletor() {
    if (caixa || !document.body) return;
    caixa = document.createElement("div");
    caixa.className = "tema-seletor";
    caixa.setAttribute("role", "group");
    caixa.setAttribute("aria-label", "Tema da tela");

    var html = "";
    for (var i = 0; i < ESCOLHAS.length; i++) {
      var k = ESCOLHAS[i];
      html += '<button type="button" data-tema-opcao="' + k + '" aria-pressed="false" ' +
        'title="' + NOMES[k] + '" aria-label="' + NOMES[k] + '">' + ICONES[k] + "</button>";
    }
    caixa.innerHTML = html;

    caixa.addEventListener("click", function (ev) {
      var alvo = ev.target && ev.target.closest ? ev.target.closest("[data-tema-opcao]") : null;
      if (!alvo) return;
      definir(alvo.getAttribute("data-tema-opcao"));
    });

    document.body.appendChild(caixa);

    /* a folga entra depois do seletor, sempre por último no documento */
    if (!document.querySelector(".tema-folga")) {
      folga = document.createElement("div");
      folga.className = "tema-folga";
      folga.setAttribute("aria-hidden", "true");
      document.body.appendChild(folga);
      vigiarFolga();
    }

    marcarBotoes(escolha);
  }

  /* ---------- a folga do canto ----------
     Ela existe por um motivo estreito: o seletor flutua no canto inferior
     direito e, quando a página está rolada até o fim, pode cobrir o que
     estiver ali — no rodapé da Agenda, por exemplo, mora o estado da
     sincronização, que às vezes precisa ser tocado.

     Duas condições, as duas medidas, nenhuma chutada:

     1. A página precisa rolar. Se tudo cabe na tela, não há fim escondido
        para proteger — o seletor paira sobre espaço vazio. Reservar altura
        aqui só criava barra de rolagem onde não havia nada para rolar.

     2. O rodapé precisa alcançar o canto onde o seletor está. Em tela
        larga o rodapé é centralizado e termina bem antes dele: não se
        tocam, e a folga seria puro desperdício. Em tela estreita o rodapé
        ocupa tudo, e aí sim.

     A altura do documento é sempre medida DESCONTANDO a própria folga.
     Sem isso ela se justificaria sozinha: aplicar a faixa aumenta o
     documento, e a medição seguinte concluiria que a faixa é necessária. */

  var folga = null;

  /* o que termina a página — o rodapé, se houver um */
  function fimDaPagina() {
    var rodape = document.querySelector("footer, .rodape, .foot");
    if (rodape && rodape.offsetHeight) return rodape;

    var filhos = document.body.children;
    for (var i = filhos.length - 1; i >= 0; i--) {
      var e = filhos[i];
      if (e === folga || e === caixa) continue;
      if (e.offsetHeight > 0) return e;
    }
    return null;
  }

  function precisaDeFolga() {
    var raiz = document.documentElement;
    if (raiz.scrollHeight - folga.offsetHeight <= raiz.clientHeight) return false;

    if (!caixa) return true;
    var fim = fimDaPagina();
    if (!fim) return true;

    /* o seletor cobre alguma coisa, ou passa ao lado? */
    return fim.getBoundingClientRect().right > caixa.getBoundingClientRect().left;
  }

  function ajustarFolga() {
    if (!folga) return;
    var altura = precisaDeFolga() ? "" : "0px";
    if (folga.style.height !== altura) folga.style.height = altura;
  }

  /* O ajuste é barato, mas não a ponto de rodar a cada nó que muda: uma
     pausa curta junta a enxurrada de alterações numa conta só. */
  var esperaAjuste = null;
  function pedirAjuste() {
    clearTimeout(esperaAjuste);
    esperaAjuste = setTimeout(ajustarFolga, 120);
  }

  function vigiarFolga() {
    ajustarFolga();
    global.addEventListener("resize", pedirAjuste);

    if (typeof ResizeObserver === "function") {
      try {
        /* o documento inteiro, não só o body: em página que define altura,
           o body não muda quando o conteúdo cresce por dentro */
        new ResizeObserver(pedirAjuste).observe(document.documentElement);
      } catch (e) { /* segue com o resize, que já cobre o essencial */ }
    }

    /* Os módulos trocam de tela depois de carregar — o portão sai, o app
       entra, uma aba vira outra. Nada disso muda o tamanho da janela, então
       sem olhar o DOM a medida ficaria a do primeiro instante. */
    if (typeof MutationObserver === "function") {
      try {
        new MutationObserver(pedirAjuste)
          .observe(document.body, { childList: true, subtree: true });
      } catch (e) { }
    }

    /* A primeira medição sai antes de Cormorant e Montserrat chegarem, e
       texto em fonte de reserva ocupa outra altura. Quando as fontes
       assentam, a conta é refeita. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(ajustarFolga).catch(function () { });
    }
    global.addEventListener("load", ajustarFolga);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montarSeletor);
  } else {
    montarSeletor();
  }

  /* ---------- porta de entrada para o resto do site ---------- */

  function definir(qual) {
    if (ESCOLHAS.indexOf(qual) < 0) return;
    escolha = qual;
    guardar(qual);
    aplicar(qual, true);
    tentar(function () {
      if (global.FloreSerLogs) {
        global.FloreSerLogs.registrar("TEMA_TROCADO", { mensagem: "Tema definido como " + qual });
      }
      return true;
    }, false);
  }

  global.FloreSerTema = {
    escolha: function () { return escolha; },
    resolvido: function () { return raiz.getAttribute("data-tema"); },
    definir: definir,
  };
})(window);
