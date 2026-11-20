/* =====================================================================
   FloreSer · Corpo e Alma — importar planilha (CSV/XLSX), para qualquer módulo
   ---------------------------------------------------------------------
   FloreSerImportacao.abrir({
     modulo: "financeiro" | "entradas", tipo?: "estoque",
     titulo, token: () => token, aviso?: texto,
     campos: [{ id, nome, obrigatorio, tipo: "texto"|"dinheiro"|"data"|"mes"|"inteiro", apelidos: [] }],
     aoConcluir(resultado)
   })

   Passos, nesta ordem e sempre visíveis: arquivo → aba → colunas → como ler
   datas e dinheiro → prévia linha a linha (o servidor confere tipo,
   obrigatório e repetidos) → confirmar. Cada confirmação é um lote com
   histórico no servidor; enviar o mesmo lote de novo não duplica.

   A planilha é lida no navegador pelo SheetJS (vendor/, carregado só quando
   alguém importa). O arquivo não sai daqui: só as linhas mapeadas vão ao
   servidor. Nenhum formato de exportação do Clinicorp é suposto — importar
   uma planilha não é uma conexão com sistema nenhum.
   ===================================================================== */
(function (global) {
  "use strict";

  var LOTE = 150;
  var MAX_LINHAS = 3000;
  var sheetjs = null;

  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") e.className = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var f = arguments[i];
      if (f === null || f === undefined || f === false) continue;
      if (Array.isArray(f)) f.forEach(function (x) { if (x) e.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else e.appendChild(typeof f === "string" || typeof f === "number" ? document.createTextNode(String(f)) : f);
    }
    return e;
  }
  function limpar(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  function chave(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  function novoId(p) { return global.FloreSerRede && global.FloreSerRede.novoId ? global.FloreSerRede.novoId(p) : p + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }

  function carregarSheetJS() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (sheetjs) return sheetjs;
    sheetjs = new Promise(function (ok, falha) {
      var raiz = (global.FLORESER_CONFIG && global.FLORESER_CONFIG.raiz) || "../";
      var s = document.createElement("script");
      s.src = raiz + "vendor/xlsx.full.min.js";
      s.onload = function () { ok(global.XLSX); };
      s.onerror = function () { sheetjs = null; falha(new Error("Não foi possível carregar o leitor de planilhas.")); };
      document.head.appendChild(s);
    });
    return sheetjs;
  }

  /* ---------------- conversões explícitas ---------------- */

  function converterDinheiro(texto, separador) {
    var t = String(texto === undefined || texto === null ? "" : texto).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
    if (!t) return null;
    var neg = /^\(.*\)$/.test(t) || /^-/.test(t);
    t = t.replace(/^[-(]|\)$/g, "");
    if (separador === "virgula") t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) return undefined;
    var c = Number(m[1]) * 100 + Number(((m[2] || "") + "00").slice(0, 2));
    return neg ? -c : c;
  }

  function doisDigitos(n) { return String(n).padStart(2, "0"); }
  function dataExiste(a, m, d) { var x = new Date(Date.UTC(a, m - 1, d)); return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d; }

  function converterData(texto, formato) {
    var t = String(texto === undefined || texto === null ? "" : texto).trim();
    if (!t) return "";
    var m, a, mes, d;
    if (formato === "iso") { m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t); if (m) { a = +m[1]; mes = +m[2]; d = +m[3]; } }
    else {
      m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(t);
      if (m) {
        a = +m[3]; if (a < 100) a += 2000;
        if (formato === "mdy") { mes = +m[1]; d = +m[2]; } else { d = +m[1]; mes = +m[2]; }
      }
    }
    if (!a || !dataExiste(a, mes, d)) return "inválida: " + t.slice(0, 20);
    return a + "-" + doisDigitos(mes) + "-" + doisDigitos(d);
  }

  /* quantidade com até 3 casas, no formato canônico ("1250.5") que o
     servidor lê sem ambiguidade */
  function converterDecimal(texto, separador) {
    var t = String(texto === undefined || texto === null ? "" : texto).trim().replace(/\s/g, "");
    if (!t) return "";
    if (separador === "virgula") t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
    return /^-?\d+(\.\d{1,3})?$/.test(t) ? t : "inválida: " + String(texto).slice(0, 20);
  }

  function converterMes(texto, formato) {
    var t = String(texto || "").trim();
    if (!t) return "";
    var m = /^(\d{4})-(\d{1,2})$/.exec(t) || null;
    if (m) return m[1] + "-" + doisDigitos(+m[2]);
    m = /^(\d{1,2})[\/.-](\d{4})$/.exec(t);
    if (m) return m[2] + "-" + doisDigitos(+m[1]);
    var d = converterData(t, formato);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(0, 7) : "inválida: " + t.slice(0, 20);
  }

  /* ---------------- a janela ---------------- */

  var dlg = null, o = null, est = null;

  function fechar() { if (dlg && dlg.open) dlg.close(); }

  function construir() {
    if (dlg) return;
    dlg = h("dialog", { class: "imp-dialogo", "aria-labelledby": "imp-titulo" });
    document.body.appendChild(dlg);
  }

  function passo(numero, titulo, conteudo) {
    return h("section", { class: "imp-passo" }, h("h3", null, h("span", { class: "imp-num" }, String(numero)), titulo), conteudo);
  }

  function abrir(opcoes) {
    o = opcoes || {};
    est = { arquivo: null, livro: null, aba: "", linhas: [], cabecalho: true, mapa: {}, formatoData: "dmy", separador: "virgula", previa: null, incluir: {}, enviando: false, ops: {}, mapaSalvo: null };
    construir();
    desenhar();
    dlg.showModal();
    /* o mapeamento da última importação deste tipo é reaproveitado (pelo
       nome da coluna), para a próxima não pedir tudo de novo */
    chamar("importacao.historico", { modulo: o.modulo, tipo: o.tipo || "" }).then(function (r) {
      var ult = r && r.ok && r.dados.lotes && r.dados.lotes[0];
      if (ult && ult.mapeamento) { est.mapaSalvo = ult.mapeamento; if (est.linhas.length) { sugerirMapa(); desenhar(); } }
    }).catch(function () { });
  }

  function desenhar() {
    limpar(dlg);
    var corpo = h("div", { class: "imp-corpo" });
    var folha = h("div", { class: "imp-folha" },
      h("div", { class: "imp-topo" }, h("h2", { id: "imp-titulo" }, o.titulo || "Importar planilha"),
        h("button", { type: "button", class: "imp-fechar", "aria-label": "Fechar", onclick: fechar }, "×")),
      corpo);
    dlg.appendChild(folha);

    /* 1. arquivo */
    var entrada = h("input", { type: "file", accept: ".csv,.xlsx,.xls,text/csv", class: "imp-arquivo", "aria-label": "Arquivo da planilha" });
    entrada.addEventListener("change", function () { if (entrada.files && entrada.files[0]) lerArquivo(entrada.files[0]); });
    corpo.appendChild(passo(1, "Arquivo", h("div", null,
      h("p", { class: "imp-nota" }, "CSV ou Excel (.xlsx). O arquivo é lido aqui no navegador; só as linhas que você ligar a um campo vão ao servidor."),
      o.aviso ? h("p", { class: "imp-nota" }, o.aviso) : null,
      entrada, est.arquivo ? h("p", { class: "imp-ok" }, est.arquivo + (est.linhas.length ? " — " + est.linhas.length + " linha(s) com dados" : "")) : null)));
    if (!est.livro) return;

    /* 2. aba e cabeçalho */
    var selAba = h("select", { class: "imp-input", "aria-label": "Aba da planilha" });
    est.livro.SheetNames.forEach(function (n) { selAba.appendChild(h("option", { value: n }, n)); });
    selAba.value = est.aba;
    selAba.addEventListener("change", function () { est.aba = selAba.value; lerAba(); desenhar(); });
    var cb = h("input", { type: "checkbox" });
    cb.checked = est.cabecalho;
    cb.addEventListener("change", function () { est.cabecalho = cb.checked; sugerirMapa(); est.previa = null; desenhar(); });
    corpo.appendChild(passo(2, "Aba", h("div", { class: "imp-linha" }, selAba, h("label", { class: "imp-marca" }, cb, "A primeira linha é o cabeçalho"))));
    if (!est.linhas.length) { corpo.appendChild(h("p", { class: "imp-nota" }, "Esta aba não tem linhas com dados.")); return; }

    /* 3. colunas */
    var colunas = nomesDasColunas();
    var tabela = h("table", { class: "imp-tabela" }, h("thead", null, h("tr", null, h("th", null, "Campo"), h("th", null, "Coluna da planilha"), h("th", null, "Exemplo"))));
    var tb = h("tbody");
    o.campos.forEach(function (c) {
      var sel = h("select", { class: "imp-input", "aria-label": "Coluna para " + c.nome });
      sel.appendChild(h("option", { value: "" }, c.obrigatorio ? "— escolha —" : "— não importar —"));
      colunas.forEach(function (n, i) { sel.appendChild(h("option", { value: String(i) }, n)); });
      sel.value = est.mapa[c.id] === undefined ? "" : String(est.mapa[c.id]);
      sel.addEventListener("change", function () { if (sel.value === "") delete est.mapa[c.id]; else est.mapa[c.id] = Number(sel.value); est.previa = null; desenhar(); });
      var ex = est.mapa[c.id] !== undefined ? String(dados()[0] ? dados()[0][est.mapa[c.id]] || "" : "") : "";
      tb.appendChild(h("tr", null, h("td", null, c.nome + (c.obrigatorio ? " *" : "")), h("td", null, sel), h("td", { class: "imp-exemplo" }, ex.slice(0, 40))));
    });
    tabela.appendChild(tb);
    corpo.appendChild(passo(3, "Colunas", tabela));

    /* 4. formatos */
    var fd = h("select", { class: "imp-input", "aria-label": "Formato das datas" },
      h("option", { value: "dmy" }, "dia/mês/ano (15/11/2026)"), h("option", { value: "mdy" }, "mês/dia/ano (11/15/2026)"), h("option", { value: "iso" }, "ano-mês-dia (2026-11-15)"));
    fd.value = est.formatoData;
    fd.addEventListener("change", function () { est.formatoData = fd.value; est.previa = null; desenhar(); });
    var fs = h("select", { class: "imp-input", "aria-label": "Separador decimal" },
      h("option", { value: "virgula" }, "vírgula (1.234,56)"), h("option", { value: "ponto" }, "ponto (1,234.56)"));
    fs.value = est.separador;
    fs.addEventListener("change", function () { est.separador = fs.value; est.previa = null; desenhar(); });
    corpo.appendChild(passo(4, "Como ler datas e dinheiro", h("div", { class: "imp-linha" }, h("label", null, "Datas ", fd), h("label", null, "Dinheiro ", fs))));

    var faltam = o.campos.filter(function (c) { return c.obrigatorio && est.mapa[c.id] === undefined; });
    if (faltam.length) { corpo.appendChild(h("p", { class: "imp-nota" }, "Ligue os campos obrigatórios: " + faltam.map(function (c) { return c.nome; }).join(", ") + ".")); return; }

    /* 5. prévia */
    var btnPrevia = h("button", { type: "button", class: "imp-btn", onclick: fazerPrevia }, est.previa ? "Conferir de novo" : "Ver a prévia");
    var conteudo = h("div", null, btnPrevia);
    if (est.erro) conteudo.appendChild(h("p", { class: "imp-erro", role: "alert" }, est.erro));
    if (est.previa) conteudo.appendChild(desenharPrevia());
    corpo.appendChild(passo(5, "Prévia", conteudo));

    /* 6. confirmar */
    if (est.previa && !est.resultado) {
      var entram = est.previa.linhas.filter(function (l) { return l.ok && (!l.repetida || est.incluir[l.indice]); }).length;
      corpo.appendChild(passo(6, "Confirmar", h("div", null,
        h("p", { class: "imp-nota" }, entram + " linha(s) vão entrar. Linhas com erro e repetidas não marcadas ficam de fora e aparecem no histórico do lote."),
        h("button", { type: "button", class: "imp-btn imp-btn-primario", disabled: !entram || est.enviando, onclick: confirmar }, est.enviando ? "Importando…" : "Importar " + entram + " linha(s)"))));
    }
    if (est.resultado) {
      corpo.appendChild(passo(6, "Pronto", h("div", null, h("p", { class: "imp-ok" }, est.resultado.importadas + " importada(s), " + est.resultado.repetidas + " repetida(s) e " + est.resultado.erros + " com erro deixadas de fora."),
        h("button", { type: "button", class: "imp-btn imp-btn-primario", onclick: fechar }, "Fechar"))));
    }
  }

  function dados() { return est.cabecalho ? est.linhas.slice(1) : est.linhas; }
  function nomesDasColunas() {
    var largura = est.linhas.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
    var nomes = [];
    for (var i = 0; i < largura; i++) {
      var letra = String.fromCharCode(65 + (i % 26)); if (i >= 26) letra = String.fromCharCode(64 + Math.floor(i / 26)) + letra;
      var cab = est.cabecalho ? String(est.linhas[0][i] || "").trim() : "";
      nomes.push(letra + (cab ? " — " + cab : ""));
    }
    return nomes;
  }

  function sugerirMapa() {
    est.mapa = {};
    if (!est.cabecalho || !est.linhas.length) return;
    var cab = est.linhas[0].map(chave);
    if (est.mapaSalvo) {
      /* "B — Quantidade" salvo → procura a coluna com o mesmo cabeçalho */
      Object.keys(est.mapaSalvo).forEach(function (campo) {
        var nome = chave(String(est.mapaSalvo[campo] || "").replace(/^[A-Z]{1,2} — /, ""));
        var i = cab.indexOf(nome);
        if (nome && i >= 0) est.mapa[campo] = i;
      });
      if (Object.keys(est.mapa).length) return;
    }
    o.campos.forEach(function (c) {
      var alvos = (c.apelidos || [c.nome]).map(chave);
      var i = cab.findIndex(function (n) { return n && alvos.indexOf(n) >= 0; });
      if (i < 0) i = cab.findIndex(function (n) { return n && alvos.some(function (a) { return n.indexOf(a) >= 0; }); });
      if (i >= 0 && Object.keys(est.mapa).map(function (k) { return est.mapa[k]; }).indexOf(i) < 0) est.mapa[c.id] = i;
    });
  }

  function lerArquivo(arquivo) {
    est.arquivo = arquivo.name; est.erro = ""; est.previa = null; est.resultado = null;
    carregarSheetJS().then(function (X) {
      var leitor = new FileReader();
      leitor.onload = function () {
        try {
          /* raw: false → o texto como aparece na planilha; a conversão é a
             que a pessoa escolher no passo 4, não a do leitor */
          est.livro = X.read(new Uint8Array(leitor.result), { type: "array", cellDates: false, raw: false, codepage: 65001 });
          est.aba = est.livro.SheetNames[0];
          lerAba();
        } catch (e) { est.livro = null; est.erro = "Não foi possível ler este arquivo como planilha."; }
        desenhar();
      };
      leitor.readAsArrayBuffer(arquivo);
    }).catch(function (e) { est.erro = e.message; desenhar(); });
  }

  function lerAba() {
    var X = global.XLSX;
    var linhas = X.utils.sheet_to_json(est.livro.Sheets[est.aba], { header: 1, raw: false, defval: "", blankrows: false });
    est.linhas = linhas.filter(function (l) { return l.some(function (c) { return String(c).trim() !== ""; }); }).slice(0, MAX_LINHAS + 1)
      .map(function (l) { return l.map(function (c) { return String(c); }); });
    est.previa = null; est.incluir = {};
    sugerirMapa();
  }

  function linhasMapeadas() {
    return dados().map(function (l) {
      var r = {};
      o.campos.forEach(function (c) {
        if (est.mapa[c.id] === undefined) return;
        var bruto = l[est.mapa[c.id]];
        if (c.tipo === "dinheiro") { var v = converterDinheiro(bruto, est.separador); r[c.id] = v === undefined ? "inválido: " + String(bruto).slice(0, 20) : v; }
        else if (c.tipo === "data") r[c.id] = converterData(bruto, est.formatoData);
        else if (c.tipo === "mes") r[c.id] = converterMes(bruto, est.formatoData);
        else if (c.tipo === "decimal") r[c.id] = converterDecimal(bruto, est.separador);
        else if (c.tipo === "inteiro") r[c.id] = String(bruto).trim() === "" ? "" : Number(String(bruto).replace(/\D/g, "")) || String(bruto);
        else r[c.id] = String(bruto === undefined ? "" : bruto).trim();
      });
      return r;
    });
  }

  function chamar(acao, corpo) {
    if (o.tipo && !corpo.tipo) corpo.tipo = o.tipo;
    return global.FloreSerRede.chamar(acao, corpo, { token: typeof o.token === "function" ? o.token() : o.token, leitura: acao === "importacao.previa" });
  }

  async function fazerPrevia() {
    est.erro = ""; est.previa = null; est.ops = {};
    var linhas = linhasMapeadas();
    if (dados().length > MAX_LINHAS) est.erro = "A planilha passa de " + MAX_LINHAS + " linhas: só as primeiras entram nesta importação.";
    var todas = [], contagem = { total: 0, validas: 0, repetidas: 0, comErro: 0 };
    for (var i = 0; i < linhas.length; i += LOTE) {
      var r = await chamar("importacao.previa", { modulo: o.modulo, linhas: linhas.slice(i, i + LOTE) });
      if (!r.ok) { est.erro = (global.FloreSerAuth ? global.FloreSerAuth.recado(r) : r.erro.mensagem); desenhar(); return; }
      r.dados.linhas.forEach(function (l) { l.indice += i; todas.push(l); });
      Object.keys(contagem).forEach(function (k) { contagem[k] += r.dados.contagem[k]; });
    }
    /* repetidas ENTRE lotes de 150: o servidor só vê um lote por vez */
    var vistas = {};
    todas.forEach(function (l) {
      if (!l.ok || l.repetida) return;
      var k = JSON.stringify(l.registro);
      if (vistas[k] !== undefined) { l.repetida = "igual à linha " + (vistas[k] + 1) + " deste arquivo"; contagem.repetidas++; contagem.validas--; }
      else vistas[k] = l.indice;
    });
    est.linhasEnviadas = linhas;
    est.previa = { linhas: todas, contagem: contagem };
    desenhar();
  }

  function desenharPrevia() {
    var c = est.previa.contagem;
    var tab = h("table", { class: "imp-tabela imp-previa" }, h("thead", null, h("tr", null, h("th", null, "Linha"), h("th", null, "Situação"), h("th", null, "Conteúdo"))));
    var tb = h("tbody");
    est.previa.linhas.slice(0, 400).forEach(function (l) {
      var sit;
      if (!l.ok) sit = h("span", { class: "imp-selo imp-selo-erro" }, "erro: " + l.erros.join("; "));
      else if (l.repetida) {
        var cb = h("input", { type: "checkbox", "aria-label": "Importar mesmo assim a linha " + (l.indice + 1) });
        cb.checked = !!est.incluir[l.indice];
        cb.addEventListener("change", function () { if (cb.checked) est.incluir[l.indice] = true; else delete est.incluir[l.indice]; desenhar(); });
        sit = h("span", null, h("span", { class: "imp-selo imp-selo-rep" }, "repetida: " + l.repetida), h("label", { class: "imp-marca" }, cb, "importar mesmo assim"));
      } else sit = h("span", { class: "imp-selo imp-selo-ok" }, "entra" + (l.avisos.length ? " · " + l.avisos.join("; ") : ""));
      var r = l.registro || {};
      var resumo = o.campos.filter(function (cp) { return r[cp.id] !== undefined && r[cp.id] !== "" && r[cp.id] !== null; }).slice(0, 5)
        .map(function (cp) { var v = r[cp.id]; return cp.tipo === "dinheiro" && typeof v === "number" ? "R$ " + (v / 100).toFixed(2).replace(".", ",") : String(v); }).join(" · ");
      tb.appendChild(h("tr", null, h("td", null, String(l.indice + (est.cabecalho ? 2 : 1))), h("td", null, sit), h("td", { class: "imp-exemplo" }, resumo)));
    });
    tab.appendChild(tb);
    return h("div", null,
      h("p", { class: "imp-contagem" }, c.total + " linha(s): " + c.validas + " entram, " + c.repetidas + " repetida(s), " + c.comErro + " com erro."),
      h("div", { class: "imp-rolagem" }, tab),
      est.previa.linhas.length > 400 ? h("p", { class: "imp-nota" }, "Mostrando as primeiras 400 linhas da prévia.") : null);
  }

  async function confirmar() {
    if (est.enviando) return;
    est.enviando = true; est.erro = ""; desenhar();
    var linhas = est.linhasEnviadas, total = { importadas: 0, repetidas: 0, erros: 0 };
    var colunas = nomesDasColunas(), mapeamento = {};
    Object.keys(est.mapa).forEach(function (k) { mapeamento[k] = colunas[est.mapa[k]]; });
    var repetidasNoArquivo = {};
    est.previa.linhas.forEach(function (l) { if (l.repetida && !est.incluir[l.indice]) repetidasNoArquivo[l.indice] = true; });
    try {
      for (var i = 0; i < linhas.length; i += LOTE) {
        var pedaco = [], incluir = [];
        linhas.slice(i, i + LOTE).forEach(function (l, j) {
          if (repetidasNoArquivo[i + j]) { total.repetidas++; return; }
          if (est.incluir[i + j]) incluir.push(pedaco.length);
          pedaco.push(l);
        });
        if (!pedaco.length) continue;
        /* o mesmo pedaço, se reenviado, leva o mesmo operacaoId */
        var opId = est.ops[i] || (est.ops[i] = novoId("imp"));
        var r = null;
        for (var t = 0; t < 3; t++) {
          r = await chamar("importacao.confirmar", { operacaoId: opId, modulo: o.modulo, arquivo: est.arquivo, planilha: est.aba, mapeamento: mapeamento,
            linhas: pedaco, incluirRepetidas: incluir });
          if (r.ok || !r.erro || ["indisponivel", "incerto"].indexOf(r.erro.categoria) < 0) break;
          await new Promise(function (ok) { setTimeout(ok, 1500 * (t + 1)); });
        }
        if (!r.ok) throw new Error(global.FloreSerAuth ? global.FloreSerAuth.recado(r) : r.erro.mensagem);
        total.importadas += r.dados.importadas; total.repetidas += r.dados.repetidas; total.erros += r.dados.erros;
      }
      est.resultado = total;
      if (typeof o.aoConcluir === "function") o.aoConcluir(total);
    } catch (e) {
      est.erro = e.message + " O que já foi importado ficou; confirme de novo para continuar (o que já entrou não duplica).";
    }
    est.enviando = false;
    desenhar();
  }

  global.FloreSerImportacao = { abrir: abrir, fechar: fechar, converterDinheiro: converterDinheiro, converterData: converterData, converterMes: converterMes,
    converterDecimal: converterDecimal };
})(window);
