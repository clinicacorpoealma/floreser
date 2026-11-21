/* =====================================================================
   FloreSer · Corpo e Alma — comportamento do Financeiro
   ---------------------------------------------------------------------
   Visão geral, Despesas, Estoque (com vendas), Orçamentos e execução,
   Planejamento e Precificação. Tudo conversa com o
   servidor por FloreSerRede, e a sessão vem de FloreSerSessao (só conta
   individual: o Financeiro não tem senha compartilhada).

   Cada ação (criar, pagar, estornar, salvar ficha...) é UMA operação com
   operacaoId estável: se a resposta se perder, a mesma operação vai de
   novo e o servidor reconhece a repetição. Pagar é sempre um clique de
   quem paga — nada aqui marca pagamento por data.

   Os números da Visão geral vêm do servidor (financeiro.resumo), na mesma
   base para o período e para a comparação. A tela não soma valores do
   Clinicorp: eles aparecem à parte, só para conferência.
   ===================================================================== */
(function () {
  "use strict";

  var MOD = "financeiro";
  var el = function (id) { return document.getElementById(id); };
  var estado = { dados: null, resumo: null, aba: "visao", recorte: null, despesaAberta: null, fichaAberta: null, emVoo: 0 };
  var status = null;

  /* ---------------------------------------------------------------
     Utilidades
     --------------------------------------------------------------- */

  /* elemento sem innerHTML: h("td", { class: "dir" }, "texto", filho) */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "texto") e.textContent = v;
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
  function limpar(e) { while (e && e.firstChild) e.removeChild(e.firstChild); return e; }

  function brl(c) {
    if (c === null || c === undefined || c === "" || isNaN(Number(c))) return "—";
    var n = Math.round(Number(c)), neg = n < 0;
    n = Math.abs(n);
    var reais = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (neg ? "− " : "") + "R$ " + reais + "," + String(n % 100).padStart(2, "0");
  }
  function numBR(c) { return c === null || c === undefined ? "" : (Math.round(Number(c)) / 100).toFixed(2).replace(".", ","); }

  /* "1.234,56", "1234,5", "1234.56", "12" → centavos inteiros; vazio → null */
  function centavosDe(texto) {
    var t = String(texto || "").trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
    if (!t) return null;
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(",", ".");
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) return NaN;
    return Number(m[1]) * 100 + Number(((m[2] || "") + "00").slice(0, 2));
  }

  function dataBR(iso) { if (!iso) return "—"; var p = String(iso).slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso; }
  function mesBR(m) { if (!m) return "—"; var nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]; var p = m.split("-"); return nomes[Number(p[1]) - 1] + "/" + p[0].slice(2); }
  function hoje() { return (estado.dados && estado.dados.hoje) || new Date().toISOString().slice(0, 10); }
  function mesDe(iso) { return String(iso).slice(0, 7); }
  function somarMeses(mes, n) { var p = mes.split("-").map(Number); var t = p[0] * 12 + (p[1] - 1) + n; return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0"); }
  function novoId(p) { return (window.FloreSerRede && FloreSerRede.novoId) ? FloreSerRede.novoId(p) : p + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function token() { return window.FloreSerSessao ? FloreSerSessao.tokenPara(MOD) : ""; }

  var temporizadorToast = null;
  function toast(texto) {
    var t = el("toast");
    t.textContent = texto;
    t.classList.add("visivel");
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(function () { t.classList.remove("visivel"); }, 4200);
  }

  function porId(lista) { var m = {}; (lista || []).forEach(function (x) { m[x.id] = x; }); return m; }
  function nomeCategoria(id) { var c = porId(estado.dados.categorias)[id]; return c ? c.nome : (id ? "(categoria removida)" : "Sem categoria"); }
  function nomeFornecedor(id) { var f = porId(estado.dados.fornecedores)[id]; return f ? f.nome : ""; }
  var NOMES_ESTADO = { pendente: "Pendente", parcial: "Parcialmente paga", paga: "Paga", vencida: "Vencida", cancelada: "Cancelada" };
  var NOMES_ORIGEM = { manual: "Manual", recorrencia: "Recorrência", importacao: "Importação" };

  /* ---------------------------------------------------------------
     Conversa com o servidor
     --------------------------------------------------------------- */

  function ler(acao, dados) {
    return FloreSerRede.chamar(acao, dados || {}, { token: token(), leitura: true });
  }

  function falhaDe(r) {
    var e = new Error((r && r.erro && r.erro.mensagem) || "Não foi possível falar com o servidor.");
    e.resposta = r;
    return e;
  }

  async function carregar() {
    var r = await ler("financeiro.ler");
    if (!r.ok) throw falhaDe(r);
    estado.dados = r.dados;
    return r.dados;
  }

  /* Uma operação, com repetição segura (mesmo operacaoId) e reentrada por
     cima da tela se a sessão acabou. Devolve o resultado da operação. */
  async function aplicar(op) {
    op.operacaoId = op.operacaoId || novoId("fin");
    estado.emVoo++;
    status.definir("salvando");
    try {
      for (var tentativa = 0; tentativa < 4; tentativa++) {
        var r = await FloreSerRede.chamar("financeiro.aplicar", { operacoes: [op] }, { token: token() });
        if (!r.ok) {
          var cat = r.erro && r.erro.categoria;
          if (cat === "autenticacao") {
            status.definir("expirado");
            var novo = await FloreSerAuth.pedirNovamente(MOD);
            if (!novo) throw falhaDe(r);
            status.definir("salvando");
            continue;
          }
          if ((cat === "indisponivel" || cat === "incerto") && tentativa < 3) {
            status.definir("offline");
            await new Promise(function (ok) { setTimeout(ok, 1200 * (tentativa + 1)); });
            status.definir("salvando");
            continue;
          }
          status.definir("erro");
          throw falhaDe(r);
        }
        var res = r.dados.resultados[0];
        if (!res.ok) {
          if (res.erro && res.erro.codigo === "conflito") {
            await recarregar();
            status.definir("salvo");
            throw falhaDe({ erro: { mensagem: "Isto mudou em outro aparelho. A tela foi atualizada; confira e faça de novo." } });
          }
          status.salvoAgora();
          throw falhaDe({ erro: res.erro });
        }
        status.salvoAgora();
        return res;
      }
      throw falhaDe(null);
    } finally {
      estado.emVoo--;
    }
  }

  async function recarregar() {
    await carregar();
    renderTudo();
    if (estado.aba === "visao") atualizarResumo();
  }

  /* ---------------------------------------------------------------
     Abas
     --------------------------------------------------------------- */

  function mostrarAba(aba, foco) {
    estado.aba = aba;
    document.querySelectorAll("#abas [role=tab]").forEach(function (b) {
      var ativa = b.getAttribute("data-aba") === aba;
      b.setAttribute("aria-selected", ativa ? "true" : "false");
      b.tabIndex = ativa ? 0 : -1;
      if (ativa && foco) b.focus();
    });
    ["visao", "despesas", "estoque", "execucao", "planejamento", "precificacao"].forEach(function (a) { el("painel-" + a).hidden = a !== aba; });
    if (aba === "visao") atualizarResumo();
    if (aba === "estoque") carregarEstoque();
    if (aba === "execucao") carregarExecucao();
  }

  function ligarAbas() {
    var botoes = Array.prototype.slice.call(document.querySelectorAll("#abas [role=tab]"));
    botoes.forEach(function (b, i) {
      b.addEventListener("click", function () { mostrarAba(b.getAttribute("data-aba")); });
      b.addEventListener("keydown", function (ev) {
        if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
        var j = (i + (ev.key === "ArrowRight" ? 1 : -1) + botoes.length) % botoes.length;
        mostrarAba(botoes[j].getAttribute("data-aba"), true);
      });
    });
  }

  /* ---------------------------------------------------------------
     Selects comuns
     --------------------------------------------------------------- */

  function preencherSelect(sel, opcoes, valor, primeira) {
    limpar(sel);
    if (primeira) sel.appendChild(h("option", { value: "" }, primeira));
    opcoes.forEach(function (o) { sel.appendChild(h("option", { value: o.id }, o.nome)); });
    sel.value = valor || "";
  }

  function categoriasAtivas() {
    return estado.dados.categorias.filter(function (c) { return c.ativa !== false; })
      .sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0) || String(a.nome).localeCompare(b.nome); })
      .map(function (c) { return { id: c.id, nome: (c.paiId ? nomeCategoria(c.paiId) + " › " : "") + c.nome }; });
  }

  function renderSelects() {
    var d = estado.dados;
    var cats = categoriasAtivas();
    var forn = d.fornecedores.filter(function (f) { return f.ativo !== false; }).map(function (f) { return { id: f.id, nome: f.nome }; });
    var estados = Object.keys(NOMES_ESTADO).map(function (k) { return { id: k, nome: NOMES_ESTADO[k] }; });
    var areas = {}, contas = {};
    d.despesas.forEach(function (x) { if (x.area) areas[x.area] = true; if (x.conta) contas[x.conta] = true; });
    preencherSelect(el("fvCategoria"), cats, el("fvCategoria").value, "Todas");
    preencherSelect(el("fvFornecedor"), forn, el("fvFornecedor").value, "Todos");
    preencherSelect(el("fvEstado"), estados, el("fvEstado").value, "Todos");
    preencherSelect(el("fvArea"), Object.keys(areas).sort().map(function (a) { return { id: a, nome: a }; }), el("fvArea").value, "Todas");
    preencherSelect(el("fvOrigem"), Object.keys(NOMES_ORIGEM).map(function (k) { return { id: k, nome: NOMES_ORIGEM[k] }; }), el("fvOrigem").value, "Todas");
    preencherSelect(el("fdEstado"), estados, el("fdEstado").value, "Todas as situações");
    preencherSelect(el("fdCategoria"), cats, el("fdCategoria").value, "Todas as categorias");
    preencherSelect(el("dCategoria"), cats, el("dCategoria").value, "Sem categoria");
    preencherSelect(el("dFornecedor"), forn, el("dFornecedor").value, "Nenhum");
    var freqs = d.frequencias || [];
    preencherSelect(el("dParcFreq"), freqs, el("dParcFreq").value || "mensal");
    preencherSelect(el("dRecFreq"), freqs, el("dRecFreq").value || "mensal");
    var la = limpar(el("listaAreas")); Object.keys(areas).forEach(function (a) { la.appendChild(h("option", { value: a })); });
    var lc = limpar(el("listaContas")); Object.keys(contas).forEach(function (a) { lc.appendChild(h("option", { value: a })); });
    d.saldos.forEach(function (s) { if (!contas[s.conta]) lc.appendChild(h("option", { value: s.conta })); });
    var cat = limpar(el("listaCatalogo"));
    (d.catalogo || []).forEach(function (p) { cat.appendChild(h("option", { value: p.id, label: p.nome + (p.especialidade ? " · " + p.especialidade : "") })); });
  }

  function renderIntegracao() {
    var i = estado.dados.integracao || {};
    var selo = el("seloIntegracao");
    var textos = { atualizado: "Clinicorp: atualizado", atualizando: "Clinicorp: atualizando", aguardando_envio: "Clinicorp: aguardando envio",
      atencao: "Clinicorp: precisa de atenção", interrompida: "Clinicorp: conexão interrompida", nao_configurada: "Clinicorp não configurado" };
    var txt = textos[i.estado] || "Clinicorp";
    if (i.estado === "atualizado" && i.atualizadoEm) {
      var min = Math.round((Date.now() - new Date(i.atualizadoEm).getTime()) / 60000);
      txt += min < 60 ? " há " + Math.max(1, min) + " min" : " em " + new Date(i.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    selo.textContent = txt;
    selo.setAttribute("data-situacao", i.estado === "interrompida" ? "suspensa" : i.estado === "nao_configurada" ? "" : "ativa");
    selo.title = (i.intervaloMin ? "O Alveare consulta o Clinicorp a cada " + (i.intervaloMin < 60 ? i.intervaloMin + " minutos" : i.intervaloMin / 60 + " h") + " (não é em tempo real). " : "") +
      "A integração é configurada no painel; aqui o Financeiro só mostra o estado.";
    var aviso = el("avisoGeral");
    if (i.situacao === "suspensa") {
      aviso.hidden = false;
      aviso.textContent = "A integração com o Clinicorp está suspensa (credenciais recusadas ou suspensão manual). Os dados do Alveare seguem normais; o administrador precisa conferir no painel.";
    } else aviso.hidden = true;
  }

  function renderTudo() {
    renderSelects();
    renderIntegracao();
    renderDespesas();
    renderPlanejamento();
    renderPrecificacao();
  }

  /* ---------------------------------------------------------------
     Visão geral
     --------------------------------------------------------------- */

  function filtrosVisao() {
    return { de: el("fvDe").value, ate: el("fvAte").value, categoria: el("fvCategoria").value, fornecedor: el("fvFornecedor").value,
      estado: el("fvEstado").value, area: el("fvArea").value, origem: el("fvOrigem").value };
  }

  var resumoSeq = 0;
  async function atualizarResumo() {
    if (!estado.dados) return;
    var seq = ++resumoSeq;
    var alvo = el("cartoesVisao");
    if (!estado.resumo) { limpar(alvo).appendChild(h("p", { class: "carregando-bloco" }, "Calculando o período…")); }
    var r = await ler("financeiro.resumo", { filtros: filtrosVisao() });
    if (seq !== resumoSeq) return;
    if (!r.ok) {
      limpar(alvo).appendChild(h("p", { class: "carregando-bloco" }, "Não foi possível calcular agora. " + FloreSerAuth.recado(r)));
      return;
    }
    estado.resumo = r.dados;
    renderVisao();
  }

  function delta(atual, anterior) {
    if (!anterior) return null;
    var pct = Math.round((atual - anterior) / anterior * 100);
    return h("span", { class: pct > 0 ? "delta-sobe" : "delta-desce" }, (pct > 0 ? "+" : "") + pct + "% vs. período anterior");
  }

  function cartao(rotulo, valor, detalhe, opcoes) {
    var o = opcoes || {};
    var filhos = [h("span", { class: "rot" }, rotulo), h("span", { class: "val" }, valor), detalhe ? h("span", { class: "det" }, detalhe) : null, o.extra || null];
    if (o.ids) {
      return h("button", { type: "button", class: "cartao-resumo" + (o.classe ? " " + o.classe : ""), title: "Ver as despesas",
        onclick: function () { abrirRecorte(rotulo, o.ids); } }, filhos);
    }
    return h("div", { class: "cartao-resumo" + (o.classe ? " " + o.classe : "") }, filhos);
  }

  function renderVisao() {
    var R = estado.resumo, a = R.atual, ant = R.anterior;
    var alvo = limpar(el("cartoesVisao"));
    var periodo = mesBR(a.periodo.de) + (a.periodo.ate !== a.periodo.de ? " a " + mesBR(a.periodo.ate) : "");
    alvo.appendChild(cartao("Saídas pagas (caixa)", brl(a.caixa), periodo, { ids: a.idsCaixa, extra: delta(a.caixa, ant.caixa) }));
    alvo.appendChild(cartao("Competência", brl(a.competencia), "despesas que pertencem ao período", { ids: a.idsCompetencia, extra: delta(a.competencia, ant.competencia) }));
    alvo.appendChild(cartao("A pagar no período", brl(a.previsao), a.projecaoRecorrencias ? "+ " + brl(a.projecaoRecorrencias) + " de recorrências ainda não geradas" : "previsão: nada aqui está pago", { ids: a.idsPrevisao }));
    alvo.appendChild(cartao("Vencidas", brl(a.vencidas.total), a.vencidas.ids.length + " despesa(s) sem pagamento", { ids: a.vencidas.ids, classe: a.vencidas.total ? "alerta" : "" }));
    alvo.appendChild(cartao("Próximos 7 dias", brl(a.proximas.total), a.proximas.ids.length + " vencimento(s)", { ids: a.proximas.ids }));
    var ent = a.entradas;
    alvo.appendChild(cartao("Entradas registradas", brl(ent.recebido),
      ent.quantidade + " registro(s) em " + ent.diasComRegistro + " dia(s)" + (ent.emHaver ? " · " + brl(ent.emHaver) + " em haver (pendente)" : "") +
      " · " + Object.keys(ent.porOrigem).map(function (k) { return ent.porOrigem[k] + " " + ({ manual: "manual", importacao: "importada(s)", clinicorp: "do Clinicorp" }[k] || k); }).join(", ")));
    alvo.appendChild(cartao("Resultado parcial", brl(a.resultadoParcial.valor), a.resultadoParcial.explicacao, { classe: "" }));
    alvo.appendChild(a.saldo.confiavel
      ? cartao("Saldo estimado", brl(a.saldo.valor), a.saldo.explicacao)
      : cartao("Saldo", "Não calculado", a.saldo.explicacao, { classe: "neutro" }));
    el("notaBase").textContent = "Caixa = pela data do pagamento. Competência = pelo mês a que a despesa pertence. A pagar = saldo em aberto com vencimento no período. As três bases não se somam. Comparação: " +
      mesBR(ant.periodo.de) + (ant.periodo.ate !== ant.periodo.de ? " a " + mesBR(ant.periodo.ate) : "") + ", na mesma base.";

    /* por categoria */
    var tab = limpar(el("tabelaCategorias"));
    tab.appendChild(h("thead", null, h("tr", null, h("th", null, "Categoria"), h("th", { class: "dir" }, "Competência"), h("th", { class: "dir" }, "Pago"), h("th", { class: "dir" }, "Orçado"))));
    var corpo = h("tbody");
    var cats = Object.keys(a.porCategoria).sort(function (x, y) { return a.porCategoria[y].competencia - a.porCategoria[x].competencia; });
    if (!cats.length) corpo.appendChild(h("tr", null, h("td", { colspan: "4", class: "vazio" }, "Nada no período.")));
    cats.forEach(function (c) {
      var v = a.porCategoria[c];
      var uso = v.orcado ? Math.min(100, Math.round(v.competencia / v.orcado * 100)) : 0;
      var classe = v.orcado && v.competencia > v.orcado ? " estourou" : v.usoPct >= 90 ? " alto" : "";
      corpo.appendChild(h("tr", { class: "clicavel", onclick: function () {
        el("fdCategoria").value = c === "sem-categoria" ? "" : c; estado.recorte = null; mostrarAba("despesas"); renderDespesas(); } },
        h("td", null, c === "sem-categoria" ? "Sem categoria" : nomeCategoria(c), v.orcado ? h("span", { class: "barra-uso" + classe }, h("i", { style: "width:" + uso + "%" })) : null),
        h("td", { class: "dir" }, brl(v.competencia)), h("td", { class: "dir" }, brl(v.caixa)),
        h("td", { class: "dir" }, v.orcado ? brl(v.orcado) + " (" + (v.usoPct || 0) + "%)" : "—")));
    });
    tab.appendChild(corpo);

    /* evolução */
    var ev = limpar(el("evolucao"));
    var meses = Object.keys(R.evolucao).sort();
    var maximo = 1;
    meses.forEach(function (m) { var x = R.evolucao[m]; maximo = Math.max(maximo, x.caixa, x.competencia, x.entradas); });
    meses.forEach(function (m) {
      var x = R.evolucao[m];
      var alt = function (v) { return Math.max(1, Math.round(Math.max(0, v) / maximo * 140)) + "px"; };
      ev.appendChild(h("div", { class: "mes", title: mesBR(m) + ": pago " + brl(x.caixa) + " · competência " + brl(x.competencia) + " · entradas " + brl(x.entradas) },
        h("div", { class: "barras" }, h("i", { class: "saida", style: "height:" + alt(x.caixa) }), h("i", { class: "competencia", style: "height:" + alt(x.competencia) }),
          h("i", { class: "entrada", style: "height:" + alt(x.entradas) })),
        h("span", { class: "rotulo-mes" }, mesBR(m))));
    });

    /* Clinicorp, à parte */
    var cc = R.clinicorp || {};
    var bloco = el("blocoClinicorp");
    var cont = limpar(el("conteudoClinicorp"));
    var temAlgo = (cc.resumo && cc.resumo.length) || (cc.recebimentos && cc.recebimentos.importados);
    bloco.hidden = !temAlgo;
    if (temAlgo) {
      cont.appendChild(h("p", { class: "nota" }, cc.aviso || ""));
      (cc.resumo || []).forEach(function (s) {
        cont.appendChild(h("p", null, "Resumo do Clinicorp (" + dataBR(s.de) + " a " + dataBR(s.ate) + "): vendas " + brl(s.vendas) + " · receitas " + brl(s.receitas) + " · despesas " + brl(s.despesas)));
      });
      if (cc.recebimentos && cc.recebimentos.importados) {
        cont.appendChild(h("p", null, cc.recebimentos.importados + " recebimento(s) importado(s) no período; " + cc.recebimentos.semVinculo +
          " ainda sem vínculo com uma entrada (" + brl(cc.recebimentos.valorSemVinculo) + "). A conciliação é feita no painel → Integrações."));
      }
    }
  }

  function abrirRecorte(rotulo, ids) {
    estado.recorte = { rotulo: rotulo, ids: ids.slice() };
    mostrarAba("despesas");
    renderDespesas();
  }

  function definirPeriodo(atalho) {
    var m = mesDe(hoje());
    if (atalho === "mes") { el("fvDe").value = m; el("fvAte").value = m; }
    if (atalho === "tri") { el("fvDe").value = somarMeses(m, -2); el("fvAte").value = m; }
    if (atalho === "ano") { el("fvDe").value = m.slice(0, 4) + "-01"; el("fvAte").value = m; }
    document.querySelectorAll("#fvAtalhos button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-atalho") === atalho ? "true" : "false"); });
    atualizarResumo();
  }

  /* ---------------------------------------------------------------
     Despesas
     --------------------------------------------------------------- */

  function despesasFiltradas() {
    var d = estado.dados;
    var busca = String(el("fdBusca").value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    var est = el("fdEstado").value, cat = el("fdCategoria").value, de = el("fdDe").value, ate = el("fdAte").value;
    var ids = estado.recorte ? estado.recorte.ids.reduce(function (m, x) { m[x] = true; return m; }, {}) : null;
    return d.despesas.filter(function (x) {
      if (ids && !ids[x.id]) return false;
      if (est && x._estado !== est && !(est === "vencida" && x._vencida)) return false;
      if (cat && x.categoriaId !== cat) return false;
      if (de && x.vencimento < de) return false;
      if (ate && x.vencimento > ate) return false;
      if (busca) {
        var alvo = (x.descricao + " " + nomeFornecedor(x.fornecedorId)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        if (alvo.indexOf(busca) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0; });
  }

  function seloEstado(x) {
    var e = x._estado;
    return h("span", { class: "selo selo-" + e }, NOMES_ESTADO[e] + (e === "parcial" && x._vencida ? " · vencida" : ""));
  }

  function renderDespesas() {
    if (!estado.dados) return;
    var lista = despesasFiltradas();
    var corpo = limpar(el("tabelaDespesas").querySelector("tbody"));
    lista.forEach(function (x) {
      corpo.appendChild(h("tr", { class: "clicavel", tabindex: "0", onclick: function () { abrirDetalhe(x.id); },
        onkeydown: function (ev) { if (ev.key === "Enter") abrirDetalhe(x.id); } },
        h("td", { class: "num" }, dataBR(x.vencimento)),
        h("td", null, x.descricao, h("span", { class: "sub" }, [nomeFornecedor(x.fornecedorId), x.origem && x.origem !== "manual" ? NOMES_ORIGEM[x.origem] : "", x.competencia && x.competencia !== mesDe(x.vencimento) ? "competência " + mesBR(x.competencia) : ""].filter(Boolean).join(" · "))),
        h("td", null, nomeCategoria(x.categoriaId)),
        h("td", { class: "dir" }, brl(x.valor)),
        h("td", { class: "dir" }, x._pago ? brl(x._pago) : "—"),
        h("td", null, seloEstado(x))));
    });
    el("vazioDespesas").hidden = lista.length > 0;
    el("recorteDespesas").hidden = !estado.recorte;
    if (estado.recorte) el("recorteTexto").textContent = "Mostrando: " + estado.recorte.rotulo + " (" + lista.length + ")";
  }

  function exportarCSV() {
    var linhas = [["vencimento", "competencia", "descricao", "categoria", "fornecedor", "valor", "pago", "saldo", "situacao", "meio", "conta", "area", "origem"]];
    despesasFiltradas().forEach(function (x) {
      linhas.push([x.vencimento, x.competencia, x.descricao, nomeCategoria(x.categoriaId), nomeFornecedor(x.fornecedorId), numBR(x.valor), numBR(x._pago),
        numBR(x._saldo), NOMES_ESTADO[x._estado], x.meio, x.conta, x.area, NOMES_ORIGEM[x.origem] || x.origem]);
    });
    var csv = "﻿" + linhas.map(function (l) { return l.map(function (c) { var s = String(c === null || c === undefined ? "" : c); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";"); }).join("\r\n");
    var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    var a = h("a", { href: url, download: "despesas-" + hoje() + ".csv" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---- nova / editar ---- */

  var despesaEditando = null;

  function modoDespesa() { var r = document.querySelector('input[name="dModo"]:checked'); return r ? r.value : "unica"; }

  function abrirDespesa(id) {
    var x = id ? porId(estado.dados.despesas)[id] : null;
    despesaEditando = x;
    el("dlgDespesaTitulo").textContent = x ? "Editar despesa" : "Nova despesa";
    el("dDescricao").value = x ? x.descricao : "";
    el("dValor").value = x ? numBR(x.valor) : "";
    el("dVencimento").value = x ? x.vencimento : hoje();
    el("dCategoria").value = x ? (x.categoriaId || "") : "";
    el("dFornecedor").value = x ? (x.fornecedorId || "") : "";
    el("dCompetencia").value = x ? (x.competencia || "") : "";
    el("dMeio").value = x ? x.meio : "";
    el("dConta").value = x ? x.conta : "";
    el("dArea").value = x ? x.area : "";
    el("dNotas").value = x ? x.notas : "";
    el("dModo").hidden = !!x;
    document.querySelector('input[name="dModo"][value="unica"]').checked = true;
    el("dErro").textContent = "";
    atualizarModo();
    el("dlgDespesa").showModal();
    el("dDescricao").focus();
  }

  function atualizarModo() {
    var m = despesaEditando ? "unica" : modoDespesa();
    el("dBlocoParcelas").hidden = m !== "parcelada";
    el("dBlocoRecorrencia").hidden = m !== "recorrente";
    el("dValorRotulo").textContent = m === "parcelada" ? "Valor total da compra" : m === "recorrente" ? "Valor de cada vez" : "Valor";
    el("dVencimentoRotulo").textContent = m === "unica" ? "Vencimento" : "Primeiro vencimento";
    previaDaSerie();
  }

  /* prévia só para a pessoa ver — quem decide as datas e os centavos é o servidor */
  function dividir(total, n) { var base = Math.floor(total / n), resto = total - base * n, s = []; for (var i = 0; i < n; i++) s.push(base + (i < resto ? 1 : 0)); return s; }
  function datas(inicio, freq, qtd, fim) {
    var dias = { semanal: 7, quinzenal: 14 }[freq], meses = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }[freq];
    var p = inicio.split("-").map(Number), dia = p[2], s = [];
    for (var i = 0; i < Math.min(qtd || 12, 120); i++) {
      var d;
      if (dias) { var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias * i)); d = dt.toISOString().slice(0, 10); }
      else { var t = (p[1] - 1) + meses * i, a = p[0] + Math.floor(t / 12), m = t % 12 + 1, ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
        d = a + "-" + String(m).padStart(2, "0") + "-" + String(Math.min(dia, ult)).padStart(2, "0"); }
      if (fim && d > fim) break;
      s.push(d);
    }
    return s;
  }

  function previaDaSerie() {
    var m = despesaEditando ? "unica" : modoDespesa();
    var alvo = el("dPrevia");
    var valor = centavosDe(el("dValor").value), inicio = el("dVencimento").value;
    if (m === "unica" || !valor || !inicio) { alvo.hidden = true; return; }
    limpar(alvo);
    var itens = [];
    if (m === "parcelada") {
      var n = Math.max(2, Math.min(120, Number(el("dParcelas").value) || 2));
      var vals = dividir(valor, n);
      datas(inicio, el("dParcFreq").value || "mensal", n).forEach(function (d, i) { itens.push(dataBR(d) + " — " + brl(vals[i]) + " (" + (i + 1) + "/" + n + ")"); });
      alvo.appendChild(h("div", null, "Soma das parcelas: " + brl(valor) + ". A compra não é contada à parte: só as parcelas."));
    } else {
      var qtd = Number(el("dRecQtd").value) || 0;
      var ds = datas(inicio, el("dRecFreq").value || "mensal", qtd || 12, el("dRecFim").value || "");
      ds.forEach(function (d) { itens.push(dataBR(d) + " — " + brl(valor)); });
      alvo.appendChild(h("div", null, (qtd ? qtd + " ocorrência(s)" : "Sem fim definido: as próximas são criadas aos poucos (3 meses à frente)") + ". Nenhuma fica paga sozinha."));
    }
    alvo.appendChild(h("ol", null, itens.slice(0, 24).map(function (t) { return h("li", null, t); })));
    alvo.hidden = false;
  }

  function camposDoForm() {
    return { descricao: el("dDescricao").value.trim(), valor: centavosDe(el("dValor").value), vencimento: el("dVencimento").value,
      categoriaId: el("dCategoria").value, fornecedorId: el("dFornecedor").value, competencia: el("dCompetencia").value,
      meio: el("dMeio").value.trim(), conta: el("dConta").value.trim(), area: el("dArea").value.trim(), notas: el("dNotas").value };
  }

  async function salvarDespesa(ev) {
    ev.preventDefault();
    var c = camposDoForm();
    if (!c.descricao) { el("dErro").textContent = "Informe a descrição."; return; }
    if (!c.valor || isNaN(c.valor)) { el("dErro").textContent = "Informe um valor válido."; return; }
    if (!c.vencimento) { el("dErro").textContent = "Informe o vencimento."; return; }
    el("dSalvar").disabled = true;
    try {
      if (despesaEditando) {
        var mudou = {};
        Object.keys(c).forEach(function (k) { if (String(c[k] === null ? "" : c[k]) !== String(despesaEditando[k] === null || despesaEditando[k] === undefined ? "" : despesaEditando[k])) mudou[k] = c[k]; });
        if (Object.keys(mudou).length) await aplicar({ tipo: "despesa.alterar", id: despesaEditando.id, revBase: despesaEditando._rev, campos: mudou });
      } else {
        var m = modoDespesa();
        if (m === "recorrente") {
          var dadosRec = { descricao: c.descricao, valor: c.valor, categoriaId: c.categoriaId, fornecedorId: c.fornecedorId, meio: c.meio, conta: c.conta,
            area: c.area, notas: c.notas, frequencia: el("dRecFreq").value, inicio: c.vencimento, quantidade: el("dRecQtd").value || null, fim: el("dRecFim").value || null };
          await aplicar({ tipo: "recorrencia.criar", id: novoId("rc"), dados: dadosRec });
        } else {
          var op = { tipo: "despesa.criar", id: novoId("dp"), dados: c };
          if (m === "parcelada") op.parcelamento = { quantidade: Number(el("dParcelas").value), primeiroVencimento: c.vencimento,
            frequencia: el("dParcFreq").value, competenciaDaCompra: el("dCompetenciaCompra").checked };
          await aplicar(op);
        }
      }
      el("dlgDespesa").close();
      toast("Despesa salva.");
      await recarregar();
    } catch (e) {
      el("dErro").textContent = e.message;
    } finally {
      el("dSalvar").disabled = false;
    }
  }

  /* ---- detalhe: pagar, estornar, cancelar, histórico ---- */

  function abrirDetalhe(id) {
    estado.despesaAberta = id;
    desenharDetalhe();
    el("detHistorico").hidden = true;
    if (!el("dlgDetalhe").open) el("dlgDetalhe").showModal();
  }

  function desenharDetalhe() {
    var x = porId(estado.dados.despesas)[estado.despesaAberta];
    if (!x) { if (el("dlgDetalhe").open) el("dlgDetalhe").close(); return; }
    el("detTitulo").textContent = x.descricao;
    var dl = limpar(el("detDados"));
    var par = function (k, v) { dl.appendChild(h("dt", null, k)); dl.appendChild(h("dd", null, v)); };
    par("Situação", seloEstado(x));
    par("Valor", brl(x.valor));
    par("Pago", brl(x._pago) + (x._saldo ? " · falta " + brl(x._saldo) : ""));
    par("Vencimento", dataBR(x.vencimento));
    par("Competência", mesBR(x.competencia));
    par("Categoria", nomeCategoria(x.categoriaId));
    if (x.fornecedorId) par("Fornecedor", nomeFornecedor(x.fornecedorId));
    if (x.meio || x.conta) par("Meio / conta", [x.meio, x.conta].filter(Boolean).join(" · "));
    if (x.area) par("Área", x.area);
    if (x.grupoId) par(x.grupoTipo === "parcelamento" ? "Parcela" : "Recorrência", (x.sequencia || "?") + (x.totalSequencia ? "/" + x.totalSequencia : ""));
    if (x.origem && x.origem !== "manual") par("Origem", NOMES_ORIGEM[x.origem] || x.origem);
    if (x.notas) par("Notas", x.notas);
    if (x.cancelada) par("Cancelada", (x.motivoCancelamento || "sem motivo") + " · " + dataBR(String(x.canceladaEm || "").slice(0, 10)));

    var movs = estado.dados.movimentos.filter(function (m) { return m.despesaId === x.id; });
    var estornados = {};
    movs.forEach(function (m) { if (m.tipo === "estorno") estornados[m.estornaId] = m; });
    var ul = limpar(el("detMovimentos"));
    if (!movs.length) ul.appendChild(h("li", { class: "det" }, "Nenhum pagamento registrado."));
    movs.forEach(function (m) {
      var acoes = null;
      if (m.tipo === "pagamento" && !estornados[m.id]) {
        acoes = h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { estornar(x, m); } }, "Estornar"));
      }
      ul.appendChild(h("li", null,
        h("span", { class: "nome" }, (m.tipo === "estorno" ? "Estorno de " : "") + brl(m.valor)),
        h("span", { class: "det" }, dataBR(m.data) + (m.meio ? " · " + m.meio : "") + (m.evidencia ? " · " + m.evidencia : "") + (m.autorNome ? " · por " + m.autorNome : "") +
          (estornados[m.id] ? " · estornado" : "") + (m.notas ? " · " + m.notas : "")), acoes));
    });
    el("detPagar").hidden = x.cancelada || x._saldo <= 0;
    el("pData").value = hoje();
    el("pValor").value = numBR(x._saldo);
    el("pMeio").value = x.meio || "";
    el("pEvidencia").value = "";
    el("detCancelar").textContent = x.cancelada ? "Reativar despesa" : "Cancelar despesa";
    el("detEditar").hidden = x.cancelada;
    el("detErro").textContent = "";
  }

  async function registrarPagamento() {
    var x = porId(estado.dados.despesas)[estado.despesaAberta];
    var valor = centavosDe(el("pValor").value);
    if (!valor || isNaN(valor)) { el("detErro").textContent = "Informe o valor pago."; return; }
    if (!el("pData").value) { el("detErro").textContent = "Informe a data do pagamento."; return; }
    el("pRegistrar").disabled = true;
    try {
      await aplicar({ tipo: "pagamento.registrar", despesaId: x.id, revBase: x._rev,
        dados: { id: novoId("pg"), data: el("pData").value, valor: valor, meio: el("pMeio").value.trim(), evidencia: el("pEvidencia").value.trim() } });
      toast("Pagamento registrado.");
      await recarregar();
      desenharDetalhe();
    } catch (e) { el("detErro").textContent = e.message; }
    finally { el("pRegistrar").disabled = false; }
  }

  async function estornar(x, m) {
    var motivo = window.prompt("Estornar o pagamento de " + brl(m.valor) + " de " + dataBR(m.data) + "?\nO pagamento continua no histórico, com o estorno ao lado. Motivo (opcional):", "");
    if (motivo === null) return;
    try {
      await aplicar({ tipo: "pagamento.estornar", despesaId: x.id, revBase: x._rev, movimentoId: m.id, dados: { id: novoId("es"), data: hoje(), notas: motivo } });
      toast("Pagamento estornado.");
      await recarregar();
      desenharDetalhe();
    } catch (e) { el("detErro").textContent = e.message; }
  }

  async function cancelarOuReativar() {
    var x = porId(estado.dados.despesas)[estado.despesaAberta];
    try {
      if (x.cancelada) await aplicar({ tipo: "despesa.reativar", id: x.id, revBase: x._rev });
      else {
        var motivo = window.prompt("Cancelar esta despesa? Ela continua na lista como cancelada. Motivo:", "");
        if (motivo === null) return;
        await aplicar({ tipo: "despesa.cancelar", id: x.id, revBase: x._rev, motivo: motivo });
      }
      await recarregar();
      desenharDetalhe();
    } catch (e) { el("detErro").textContent = e.message; }
  }

  function mostrarHistorico() {
    var alvo = el("detHistorico");
    alvo.hidden = !alvo.hidden;
    if (alvo.hidden || !window.FloreSerAuditoria) return;
    FloreSerAuditoria.montar(alvo, { modulo: MOD, entidade: "despesa", entidadeId: estado.despesaAberta,
      api: function (corpo) {
        return ler("auditoria.listar", corpo).then(function (r) {
          if (!r.ok) return { ok: false, erro: r.erro };
          var s = { ok: true }; Object.keys(r.dados || {}).forEach(function (k) { s[k] = r.dados[k]; }); return s;
        });
      } });
  }

  /* ---------------------------------------------------------------
     Planejamento
     --------------------------------------------------------------- */

  function renderPlanejamento() {
    var d = estado.dados;
    if (!el("orcMes").value) el("orcMes").value = mesDe(hoje());
    var mes = el("orcMes").value;
    var orc = {};
    d.orcamentos.forEach(function (o) { if (o.mes === mes) orc[o.categoriaId] = o; });
    var real = {};
    d.despesas.forEach(function (x) { if (!x.cancelada && x.competencia === mes) real[x.categoriaId] = (real[x.categoriaId] || 0) + x.valor; });
    var tab = limpar(el("tabelaOrcamento"));
    tab.appendChild(h("thead", null, h("tr", null, h("th", null, "Categoria"), h("th", { class: "dir" }, "Realizado"), h("th", null, "Orçamento"), h("th", null, "Alerta em"))));
    var corpo = h("tbody");
    categoriasAtivas().forEach(function (c) {
      var o = orc[c.id];
      var valor = h("input", { class: "input", inputmode: "decimal", value: o ? numBR(o.valor) : "", "aria-label": "Orçamento de " + c.nome, placeholder: "sem orçamento" });
      var alerta = h("input", { class: "input", type: "number", min: "1", max: "200", value: o ? o.alertaPct : 90, "aria-label": "Alerta (%) de " + c.nome });
      var salvar = async function () {
        var v = centavosDe(valor.value);
        if (isNaN(v)) { toast("Valor inválido."); return; }
        try {
          await aplicar({ tipo: "orcamento.definir", categoriaId: c.id, mes: mes, valor: v, alertaPct: Number(alerta.value) || 90, revBase: o ? o._rev : 0 });
          await recarregar();
        } catch (e) { toast(e.message); }
      };
      valor.addEventListener("change", salvar);
      alerta.addEventListener("change", function () { if (valor.value) salvar(); });
      var r = real[c.id] || 0;
      var pct = o && o.valor ? Math.round(r / o.valor * 100) : null;
      corpo.appendChild(h("tr", null, h("td", null, c.nome), h("td", { class: "dir" }, brl(r), pct !== null ? h("span", { class: "sub" }, pct + "%") : null),
        h("td", null, h("div", { class: "dinheiro" }, h("span", null, "R$"), valor)), h("td", null, h("div", { class: "dinheiro" }, alerta, h("span", null, "%")))));
    });
    tab.appendChild(corpo);

    /* recorrências */
    var ul = limpar(el("listaRecorrencias"));
    var grupos = d.grupos.filter(function (g) { return g.tipo === "recorrencia"; });
    if (!grupos.length) ul.appendChild(h("li", { class: "det" }, "Nenhuma recorrência. Crie uma em Nova despesa → Repete."));
    grupos.forEach(function (g) {
      var m = g.modelo || {};
      var freq = (d.frequencias.filter(function (f) { return f.id === g.frequencia; })[0] || {}).nome || g.frequencia;
      var ocorr = d.despesas.filter(function (x) { return x.grupoId === g.id; });
      var pagas = ocorr.filter(function (x) { return x._estado === "paga"; }).length;
      ul.appendChild(h("li", null,
        h("span", { class: "nome" }, g.descricao),
        h("span", { class: "det" }, brl(m.valor) + " · " + freq + " desde " + dataBR(g.inicio) + (g.fim ? " até " + dataBR(g.fim) : g.quantidade ? " · " + g.quantidade + " vezes" : " · sem fim") +
          " · " + ocorr.length + " criada(s), " + pagas + " paga(s)" + (g.geradoAte ? " · criadas até " + dataBR(g.geradoAte) : "") + (g.encerrado ? " · encerrada" : "")),
        g.encerrado ? null : h("span", { class: "acoes" },
          h("button", { type: "button", class: "btn btn-quiet", onclick: function () { gerarRecorrencia(g); } }, "Criar próximas"),
          h("button", { type: "button", class: "btn btn-quiet", onclick: function () { alterarRecorrencia(g); } }, "Alterar valor"),
          h("button", { type: "button", class: "btn btn-quiet", onclick: function () { encerrarRecorrencia(g); } }, "Encerrar"))));
    });

    /* categorias */
    var lc = limpar(el("listaCategorias"));
    d.categorias.slice().sort(function (a, b) { return String(a.nome).localeCompare(b.nome); }).forEach(function (c) {
      lc.appendChild(h("li", null, h("span", { class: "nome" }, (c.paiId ? nomeCategoria(c.paiId) + " › " : "") + c.nome),
        h("span", { class: "det" }, c.ativa === false ? "inativa" : c._padrao ? "sugerida" : ""),
        h("span", { class: "acoes" },
          h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirCadastro("categoria", c); } }, "Editar"),
          h("button", { type: "button", class: "btn btn-quiet", onclick: function () { salvarCadastroDireto("categoria.salvar", c, { ativa: c.ativa === false }); } }, c.ativa === false ? "Ativar" : "Desativar"))));
    });
    var lf = limpar(el("listaFornecedores"));
    if (!d.fornecedores.length) lf.appendChild(h("li", { class: "det" }, "Nenhum fornecedor cadastrado."));
    d.fornecedores.forEach(function (f) {
      lf.appendChild(h("li", null, h("span", { class: "nome" }, f.nome), h("span", { class: "det" }, [f.documento, f.contato, f.ativo === false ? "inativo" : ""].filter(Boolean).join(" · ")),
        h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirCadastro("fornecedor", f); } }, "Editar"))));
    });
    var ls = limpar(el("listaSaldos"));
    if (!d.saldos.length) ls.appendChild(h("li", { class: "det" }, "Nenhum saldo inicial informado."));
    d.saldos.forEach(function (s) {
      ls.appendChild(h("li", null, h("span", { class: "nome" }, s.conta), h("span", { class: "det" }, brl(s.valor) + " em " + dataBR(s.data) + (s.notas ? " · " + s.notas : "")),
        h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirCadastro("saldo", s); } }, "Editar"))));
    });
  }

  async function gerarRecorrencia(g) {
    var ate = window.prompt("Criar as ocorrências até qual data? (AAAA-MM-DD)", somarMeses(mesDe(hoje()), 6) + "-28");
    if (!ate) return;
    try { var r = await aplicar({ tipo: "recorrencia.gerar", id: g.id, revBase: g._rev, ate: ate }); toast(r.geradas + " ocorrência(s) criada(s)."); await recarregar(); }
    catch (e) { toast(e.message); }
  }
  async function alterarRecorrencia(g) {
    var aPartir = window.prompt("A partir de que vencimento? (AAAA-MM-DD) — as já pagas ficam como estão.", hoje());
    if (!aPartir) return;
    var v = centavosDe(window.prompt("Novo valor de cada ocorrência (R$):", numBR((g.modelo || {}).valor)) || "");
    if (!v || isNaN(v)) return;
    try { var r = await aplicar({ tipo: "recorrencia.alterar", id: g.id, revBase: g._rev, aPartirDe: aPartir, campos: { valor: v } });
      toast(r.alteradas + " alterada(s), " + r.preservadas + " preservada(s)."); await recarregar(); }
    catch (e) { toast(e.message); }
  }
  async function encerrarRecorrencia(g) {
    var fim = window.prompt("Encerrar em que data? (AAAA-MM-DD) — ocorrências depois dela, sem pagamento, são canceladas.", hoje());
    if (!fim) return;
    try { var r = await aplicar({ tipo: "recorrencia.encerrar", id: g.id, revBase: g._rev, fim: fim }); toast(r.canceladas + " ocorrência(s) cancelada(s)."); await recarregar(); }
    catch (e) { toast(e.message); }
  }

  /* ---- cadastro genérico ---- */

  var CADASTROS = {
    categoria: { titulo: "Categoria", tipo: "categoria.salvar", prefixo: "cat", campos: [
      { k: "nome", r: "Nome" }, { k: "paiId", r: "Subcategoria de", select: function () { return [{ id: "", nome: "— nenhuma —" }].concat(categoriasAtivas()); } }] },
    fornecedor: { titulo: "Fornecedor", tipo: "fornecedor.salvar", prefixo: "fo", campos: [
      { k: "nome", r: "Nome" }, { k: "documento", r: "CNPJ/CPF (opcional)" }, { k: "contato", r: "Contato" }, { k: "notas", r: "Notas", area: true }] },
    saldo: { titulo: "Saldo inicial", tipo: "saldo.definir", prefixo: "sd", campos: [
      { k: "conta", r: "Conta" }, { k: "data", r: "Data", tipo: "date" }, { k: "valor", r: "Saldo nessa data (R$)", dinheiro: true }, { k: "notas", r: "De onde vem (extrato, etc.)" }] },
    insumo: { titulo: "Material", tipo: "insumo.salvar", prefixo: "in", campos: [
      { k: "nome", r: "Material" }, { k: "unidadeCompra", r: "Compro em (ex.: frasco, caixa)" },
      { k: "conteudo", r: "Conteúdo da embalagem (número)" }, { k: "unidadeConteudo", r: "Unidade do conteúdo", select: function () { return [{ id: "", nome: "—" }].concat((estado.dados.unidades || []).map(function (u) { return { id: u, nome: u }; })); } },
      { k: "valorEmbalagem", r: "Valor da embalagem (R$)", dinheiro: true }, { k: "rendimento", r: "Rende quantos usos (opcional)" },
      { k: "perdaPct", r: "Perda (%) — vazio = sem perda" }, { k: "notas", r: "Notas", area: true }] }
  };
  var cadastroAberto = null;

  function abrirCadastro(tipo, registro) {
    var def = CADASTROS[tipo];
    cadastroAberto = { tipo: tipo, registro: registro || null };
    el("cadTitulo").textContent = (registro ? "Editar " : "Novo: ") + def.titulo.toLowerCase();
    var alvo = limpar(el("cadCampos"));
    def.campos.forEach(function (c) {
      var id = "cad_" + c.k, valor = registro ? registro[c.k] : "";
      var campo;
      if (c.select) { campo = h("select", { class: "input", id: id }); c.select().forEach(function (o) { campo.appendChild(h("option", { value: o.id }, o.nome)); }); campo.value = valor || ""; }
      else if (c.area) { campo = h("textarea", { class: "input", id: id }); campo.value = valor || ""; }
      else { campo = h("input", { class: "input", id: id, type: c.tipo || "text", inputmode: c.dinheiro ? "decimal" : null }); campo.value = c.dinheiro ? numBR(valor) : (valor || ""); }
      alvo.appendChild(h("div", { class: "campo" }, h("label", { for: id }, c.r), campo));
    });
    el("cadErro").textContent = "";
    el("dlgCadastro").showModal();
    var primeiro = alvo.querySelector("input,select,textarea");
    if (primeiro) primeiro.focus();
  }

  async function salvarCadastro(ev) {
    ev.preventDefault();
    var def = CADASTROS[cadastroAberto.tipo], reg = cadastroAberto.registro;
    var dados = {};
    for (var i = 0; i < def.campos.length; i++) {
      var c = def.campos[i], v = el("cad_" + c.k).value;
      if (c.dinheiro) { v = centavosDe(v); if (isNaN(v)) { el("cadErro").textContent = "Valor inválido em " + c.r + "."; return; } }
      dados[c.k] = typeof v === "string" ? v.trim() : v;
    }
    try {
      await aplicar({ tipo: def.tipo, id: reg ? reg.id : (cadastroAberto.tipo === "categoria" ? "cat-" + dados.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 30) + "-" + Date.now().toString(36).slice(-4) : novoId(def.prefixo)),
        revBase: reg ? reg._rev : 0, dados: dados });
      el("dlgCadastro").close();
      await recarregar();
    } catch (e) { el("cadErro").textContent = e.message; }
  }

  async function salvarCadastroDireto(tipo, reg, campos) {
    var dados = { nome: reg.nome, paiId: reg.paiId || "", ordem: reg.ordem || 0 };
    Object.keys(campos).forEach(function (k) { dados[k] = campos[k]; });
    try { await aplicar({ tipo: tipo, id: reg.id, revBase: reg._rev, dados: dados }); await recarregar(); }
    catch (e) { toast(e.message); }
  }

  /* ---------------------------------------------------------------
     Precificação
     --------------------------------------------------------------- */

  function renderPrecificacao() {
    var d = estado.dados;
    var corpo = limpar(el("tabelaFichas").querySelector("tbody"));
    var fichas = d.fichas.filter(function (f) { return !f.arquivada; });
    fichas.forEach(function (f) {
      var c = f._calculo || {};
      corpo.appendChild(h("tr", { class: "clicavel", tabindex: "0", onclick: function () { abrirFicha(f.id); }, onkeydown: function (ev) { if (ev.key === "Enter") abrirFicha(f.id); } },
        h("td", null, f.nome, f.revisar ? h("span", { class: "sub desatualizado" }, "revisar: custo de material mudou") : null),
        h("td", null, { procedimento: "Procedimento", produto: "Produto", pacote: "Pacote" }[f.tipo] || f.tipo),
        h("td", { class: "dir" }, c.custoTotal !== undefined ? brl(c.custoTotal) : "—"),
        h("td", { class: "dir" }, c.completo ? brl(c.precoSugerido) : h("span", { class: "sub" }, c.bloqueio ? "bloqueado" : "faltam dados")),
        h("td", { class: "dir" }, brl(f.precoAtual)),
        h("td", null, f.versaoAprovada ? "v" + f.versaoAprovada : "rascunho")));
    });
    el("vazioFichas").hidden = fichas.length > 0;
    var ci = limpar(el("tabelaInsumos").querySelector("tbody"));
    if (!d.insumos.length) ci.appendChild(h("tr", null, h("td", { colspan: "5", class: "vazio" }, "Nenhum material ainda.")));
    d.insumos.forEach(function (i) {
      ci.appendChild(h("tr", { class: "clicavel", onclick: function () { abrirCadastro("insumo", i); } },
        h("td", null, i.nome), h("td", null, [i.unidadeCompra, i.conteudo ? String(i.conteudo).replace(".", ",") + " " + (i.unidadeConteudo || "") : ""].filter(Boolean).join(" · ") || "—"),
        h("td", { class: "dir" }, brl(i.valorEmbalagem)), h("td", null, i.rendimento ? String(i.rendimento).replace(".", ",") + " usos" : "—"),
        h("td", null, i.perdaPct ? String(i.perdaPct).replace(".", ",") + "%" : "—")));
    });
  }

  function linhaItem(item) {
    var sel = h("select", { class: "input", "aria-label": "Material" });
    sel.appendChild(h("option", { value: "" }, "Escolha o material"));
    estado.dados.insumos.forEach(function (i) {
      var marca = i.itemEstoqueId ? (i.custoFonte === "estimativa" ? " · estoque (custo estimado)" : " · do estoque") : "";
      sel.appendChild(h("option", { value: i.id }, i.nome + marca));
    });
    sel.value = item.insumoId || "";
    var qtd = h("input", { class: "input", inputmode: "decimal", placeholder: "qtd", "aria-label": "Quantidade", value: item.quantidade || "" });
    var un = h("select", { class: "input", "aria-label": "Unidade" });
    (estado.dados.unidades || []).forEach(function (u) { un.appendChild(h("option", { value: u }, u)); });
    un.value = item.unidade || "ml";
    var li = h("li", null, sel, qtd, un, h("button", { type: "button", class: "icone-btn", "aria-label": "Tirar", onclick: function () { li.remove(); calcularAoVivo(); } }, "×"));
    li._ler = function () { return { insumoId: sel.value, quantidade: qtd.value.trim(), unidade: un.value }; };
    return li;
  }
  function linhaEquip(eq) {
    var nome = h("input", { class: "input", placeholder: "equipamento", value: eq.nome || "", "aria-label": "Equipamento" });
    var custo = h("input", { class: "input", inputmode: "decimal", placeholder: "R$ por uso", value: eq.custoPorUso !== undefined && eq.custoPorUso !== "" ? numBR(eq.custoPorUso) : "", "aria-label": "Custo por uso" });
    var li = h("li", null, nome, custo, h("button", { type: "button", class: "icone-btn", "aria-label": "Tirar", onclick: function () { li.remove(); calcularAoVivo(); } }, "×"));
    li._ler = function () { var c = centavosDe(custo.value); return { nome: nome.value.trim(), custoPorUso: c === null || isNaN(c) ? "" : c }; };
    return li;
  }
  function linhaComp(cp) {
    var sel = h("select", { class: "input", "aria-label": "Procedimento" });
    sel.appendChild(h("option", { value: "" }, "Escolha"));
    estado.dados.fichas.forEach(function (f) { if (f.tipo !== "pacote" && (!estado.fichaAberta || f.id !== estado.fichaAberta.id)) sel.appendChild(h("option", { value: f.id }, f.nome)); });
    sel.value = cp.fichaId || "";
    var q = h("input", { class: "input", type: "number", min: "1", placeholder: "sessões", value: cp.quantidade || "", "aria-label": "Sessões" });
    var li = h("li", null, sel, q, h("button", { type: "button", class: "icone-btn", "aria-label": "Tirar", onclick: function () { li.remove(); calcularAoVivo(); } }, "×"));
    li._ler = function () { return { fichaId: sel.value, quantidade: q.value }; };
    return li;
  }

  function abrirFicha(id) {
    var f = id ? porId(estado.dados.fichas)[id] : null;
    estado.fichaAberta = f;
    var d = (f && f.dados) || {};
    el("fichaTitulo").textContent = f ? f.nome : "Nova ficha de custo";
    el("fNome").value = f ? f.nome : "";
    el("fTipo").value = f ? f.tipo : "procedimento";
    el("fPreco").value = f && f.precoAtual !== null && f.precoAtual !== "" ? numBR(f.precoAtual) : "";
    el("fClinicorp").value = f ? (f.clinicorpProcedimentoId || "") : "";
    var itens = limpar(el("fItens")); (d.itens || []).forEach(function (i) { itens.appendChild(linhaItem(i)); });
    var eq = limpar(el("fEquip")); eq.className = "lista-edicao equip"; (d.equipamentos || []).forEach(function (e) { eq.appendChild(linhaEquip(e)); });
    var comp = limpar(el("fComp")); comp.className = "lista-edicao comp"; (d.componentes || []).forEach(function (c) { comp.appendChild(linhaComp(c)); });
    el("fTempo").value = d.tempoMin || "";
    el("fMaoObra").value = d.maoDeObraHora !== undefined && d.maoDeObraHora !== "" && d.maoDeObraHora !== null ? numBR(d.maoDeObraHora) : "";
    var r = d.rateio || { modo: "nenhum" };
    el("fRateioModo").value = r.modo || "nenhum";
    el("fRateioValor").value = r.valor !== undefined && r.valor !== "" && r.valor !== null ? numBR(r.valor) : "";
    el("fRateioBase").value = r.base || "";
    var marcas = limpar(el("fRateioCats"));
    categoriasAtivas().forEach(function (c) {
      var cb = h("input", { type: "checkbox", value: c.id });
      cb.checked = (r.categorias || []).indexOf(c.id) >= 0;
      cb.addEventListener("change", calcularAoVivo);
      marcas.appendChild(h("label", null, cb, c.nome));
    });
    el("fTaxa").value = d.taxaPagamentoPct || ""; el("fComissao").value = d.comissaoPct || "";
    el("fImpostos").value = d.impostosPct || ""; el("fMargem").value = d.margemPct || "";
    el("sDesconto").value = ""; el("sTaxa").value = ""; el("sParcelas").value = "1";
    el("fAprovar").disabled = !f;
    el("fRevisar").hidden = !(f && f.revisar);
    el("fRevisar").textContent = f && f.revisar ? f.revisar + " A versão aprovada guarda o custo de então; os cálculos abaixo já usam o atual." : "";
    el("fErro").textContent = "";
    tipoDaFicha();
    var vers = limpar(el("fVersoes"));
    (estado.dados.versoes || []).filter(function (v) { return f && v.fichaId === f.id; }).reverse().forEach(function (v) {
      vers.appendChild(h("li", null, h("span", { class: "nome" }, "v" + v.versao), h("span", { class: "det" }, "aprovada em " + dataBR(String(v.aprovadaEm).slice(0, 10)) + " por " + v.aprovadaPor + " · sugerido " + brl(v.precoSugerido))));
    });
    el("dlgFicha").showModal();
    calcularAoVivo();
    carregarPraticado(f);
  }

  function tipoDaFicha() {
    var pacote = el("fTipo").value === "pacote";
    el("fBlocoItens").hidden = pacote;
    el("fBlocoPacote").hidden = !pacote;
  }

  function coletarFicha() {
    var ler = function (ul) { return Array.prototype.slice.call(el(ul).children).map(function (li) { return li._ler(); }); };
    var preco = centavosDe(el("fPreco").value), mao = centavosDe(el("fMaoObra").value), rv = centavosDe(el("fRateioValor").value);
    var pacote = el("fTipo").value === "pacote";
    var dados = { taxaPagamentoPct: el("fTaxa").value.trim(), comissaoPct: el("fComissao").value.trim(), impostosPct: el("fImpostos").value.trim(), margemPct: el("fMargem").value.trim() };
    if (pacote) dados.componentes = ler("fComp").filter(function (c) { return c.fichaId; });
    else {
      dados.itens = ler("fItens").filter(function (i) { return i.insumoId; });
      dados.equipamentos = ler("fEquip").filter(function (e) { return e.nome || e.custoPorUso !== ""; });
      dados.tempoMin = el("fTempo").value.trim();
      dados.maoDeObraHora = mao === null || isNaN(mao) ? "" : mao;
      dados.rateio = { modo: el("fRateioModo").value, valor: rv === null || isNaN(rv) ? "" : rv, base: el("fRateioBase").value.trim(),
        categorias: Array.prototype.slice.call(el("fRateioCats").querySelectorAll("input:checked")).map(function (c) { return c.value; }) };
    }
    return { tipo: el("fTipo").value, nome: el("fNome").value.trim() || "sem nome", precoAtual: preco === null || isNaN(preco) ? null : preco,
      clinicorpProcedimentoId: el("fClinicorp").value.trim(), dados: dados };
  }

  var calcTimer = null, calcSeq = 0;
  function calcularAoVivo() {
    clearTimeout(calcTimer);
    calcTimer = setTimeout(async function () {
      var seq = ++calcSeq;
      var ficha = coletarFicha();
      ficha.id = estado.fichaAberta ? estado.fichaAberta.id : "nova";
      var r = await ler("financeiro.simular", { ficha: ficha, simulacao: { descontoPct: el("sDesconto").value.trim(), taxaPagamentoPct: el("sTaxa").value.trim(), parcelas: el("sParcelas").value } });
      if (seq !== calcSeq) return;
      if (!r.ok) { limpar(el("fResultado")).appendChild(h("p", { class: "falta" }, FloreSerAuth.recado(r))); return; }
      desenharResultado(r.dados);
    }, 450);
  }

  function linhaDl(dl, k, v) { dl.appendChild(h("dt", null, k)); dl.appendChild(h("dd", null, v)); }

  function desenharResultado(res) {
    var b = res.base, alvo = limpar(el("fResultado"));
    if (b.custoTotal !== undefined) {
      var dl = h("dl");
      if (b.materiais !== null && b.materiais !== undefined) linhaDl(dl, "Materiais", brl(b.materiais));
      if (b.maoDeObra) linhaDl(dl, "Mão de obra", brl(b.maoDeObra));
      if (b.equipamentos) linhaDl(dl, "Equipamentos", brl(b.equipamentos));
      linhaDl(dl, "Custo direto", brl(b.custoDireto));
      linhaDl(dl, "Rateio de custos fixos", brl(b.rateio));
      linhaDl(dl, "Custo total (C)", brl(b.custoTotal));
      alvo.appendChild(dl);
    }
    if (b.completo) {
      alvo.insertBefore(h("div", null, h("span", { class: "rotulo" }, "Preço sugerido"), h("div", { class: "grande" }, brl(b.precoSugerido))), alvo.firstChild);
      var r2 = h("dl");
      var n = b.noAtual || b.noSugerido;
      linhaDl(r2, b.noAtual ? "No preço atual (" + brl(b.noAtual.preco) + ")" : "No preço sugerido", "");
      linhaDl(r2, "Margem de contribuição", brl(n.margemContribuicao) + " (" + String(n.margemContribuicaoPct).replace(".", ",") + "%)");
      linhaDl(r2, "Resultado depois do rateio", brl(n.resultado) + " (" + String(n.resultadoPct).replace(".", ",") + "% de margem)");
      linhaDl(r2, "Markup (preço ÷ custo total)", n.markup !== null ? String(n.markup).replace(".", ",") + "×" : "—");
      alvo.appendChild(r2);
    }
    if (b.bloqueio) alvo.appendChild(h("p", { class: "bloqueio" }, b.bloqueio));
    if (b.faltando && b.faltando.length) alvo.appendChild(h("div", { class: "falta" }, "Faltam dados — o preço sugerido aparece quando tudo estiver preenchido:", h("ul", null, b.faltando.map(function (f) { return h("li", null, f); }))));
    (b.avisos || []).forEach(function (a) { alvo.appendChild(h("p", { class: "falta" }, a)); });
    var mem = limpar(el("fMemoria"));
    (b.memoria || []).forEach(function (l) { mem.appendChild(h("li", null, l)); });
    var s = limpar(el("sResultado"));
    if (res.simulacao) {
      var x = res.simulacao, dls = h("dl");
      linhaDl(dls, "Preço praticado", brl(x.preco) + (x.descontoPct ? " (−" + String(x.descontoPct).replace(".", ",") + "%)" : ""));
      linhaDl(dls, x.parcelas > 1 ? x.parcelas + " parcelas de pagamento" : "À vista", x.parcelas > 1 ? "≈ " + brl(x.valorParcela) : "");
      linhaDl(dls, "Taxas, comissão e impostos", brl(x.variaveis));
      linhaDl(dls, "Margem de contribuição", brl(x.margemContribuicao));
      linhaDl(dls, "Resultado depois do rateio", brl(x.resultado) + " (" + String(x.resultadoPct).replace(".", ",") + "%)");
      s.appendChild(dls);
    } else if (res.erro) s.appendChild(h("p", { class: "falta" }, res.erro));
    else s.appendChild(h("p", { class: "nota" }, "A simulação aparece quando a ficha estiver completa."));
  }

  async function salvarFicha(ev) {
    ev.preventDefault();
    var f = estado.fichaAberta, dados = coletarFicha();
    if (!el("fNome").value.trim()) { el("fErro").textContent = "Dê um nome à ficha."; return; }
    try {
      var id = f ? f.id : novoId("fc");
      var r = await aplicar({ tipo: "ficha.salvar", id: id, revBase: f ? f._rev : 0, dados: dados });
      await recarregar();
      estado.fichaAberta = porId(estado.dados.fichas)[id] || null;
      el("fAprovar").disabled = false;
      el("fichaTitulo").textContent = r.entidade.nome;
      toast("Ficha salva.");
    } catch (e) { el("fErro").textContent = e.message; }
  }

  async function aprovarFicha() {
    var f = estado.fichaAberta;
    if (!f) return;
    if (!window.confirm("Aprovar a composição como está salva? A versão aprovada fica guardada e não muda mais; o Clinicorp não é alterado.")) return;
    try {
      var r = await aplicar({ tipo: "ficha.aprovar", id: f.id, revBase: f._rev });
      toast("Versão " + r.versao + " aprovada.");
      await recarregar();
      abrirFicha(f.id);
    } catch (e) { el("fErro").textContent = e.message; }
  }

  /* ---------------------------------------------------------------
     Estoque
     ---------------------------------------------------------------
     O que tenho, em que quantidade, e desde quando se sabe. Saldo é sempre
     um retrato com data e fonte: desconhecido não é zero, e retrato antigo
     aparece como antigo. Item de fonte externa não tem saldo editável. */

  var estoque = null;

  async function carregarEstoque() {
    var r = await ler("financeiro.estoque");
    if (!r.ok) { el("fonteEstoque").textContent = "Não foi possível carregar o estoque agora. " + FloreSerAuth.recado(r) + (estoque ? " Mostrando o último carregado." : ""); if (!estoque) return; }
    else estoque = r.dados;
    renderEstoque();
  }

  function qtdBR(t) { return t === null || t === undefined || t === "" ? "" : String(t).replace(".", ","); }
  var SITUACAO_EST = { negativo: "Saldo negativo", esgotado: "Esgotado", abaixo: "Abaixo do mínimo", desconhecido: "Saldo desconhecido", ok: "Em dia" };

  function renderEstoque() {
    if (!estoque) return;
    var fe = estoque.fonte;
    var f = limpar(el("fonteEstoque"));
    f.appendChild(h("details", null, h("summary", null, h("span", { class: "sem-acesso" }, "Estoque do Clinicorp ainda sem acesso"), " — por quê?"),
      h("p", { class: "sub" }, fe.clinicorp.motivo), h("p", { class: "sub" }, "Falta o Clinicorp liberar na API: " + fe.clinicorp.falta.join("; ") + ".")));
    f.appendChild(h("div", null, fe.ultimaImportacao
      ? h("span", null, "Fonte atual: ", h("b", null, "importação manual"), " — último arquivo em " + new Date(fe.ultimaImportacao.em).toLocaleString("pt-BR") + " (" + fe.ultimaImportacao.arquivo + "). Importar de novo atualiza os saldos; o mesmo arquivo no mesmo dia não duplica.")
      : "Ainda sem importação. Exporte o estoque do Clinicorp (CSV ou Excel) e importe aqui — é manual até a API liberar."));

    var cats = {}, locais = {};
    estoque.itens.forEach(function (i) { if (i.categoria) cats[i.categoria] = true; (i.locais || []).forEach(function (l) { if (l.local) locais[l.local] = true; }); if (i.local) locais[i.local] = true; });
    preencherSelect(el("feCategoria"), Object.keys(cats).sort().map(function (c) { return { id: c, nome: c }; }), el("feCategoria").value, "Todas as categorias");
    preencherSelect(el("feLocal"), Object.keys(locais).sort().map(function (c) { return { id: c, nome: c }; }), el("feLocal").value, "Todos os locais");

    var ind = limpar(el("indicadoresEstoque"));
    var conta = function (fn) { return estoque.itens.filter(fn).length; };
    ind.appendChild(cartao("Esgotados", String(conta(function (i) { return i.situacao === "esgotado"; })), "saldo zero no último retrato", { classe: conta(function (i) { return i.situacao === "esgotado"; }) ? "alerta" : "" }));
    ind.appendChild(cartao("Abaixo do mínimo", String(conta(function (i) { return i.situacao === "abaixo"; })), "precisam de reposição"));
    ind.appendChild(cartao("Validade próxima", String(conta(function (i) { return i.validadeProxima; })), "até 30 dias (" + conta(function (i) { return i.vencido; }) + " vencido(s))"));
    if (conta(function (i) { return i.situacao === "negativo"; })) ind.appendChild(cartao("Saldo negativo", String(conta(function (i) { return i.situacao === "negativo"; })), "saiu mais do que foi registrado: falta entrada ou contagem", { classe: "alerta" }));
    ind.appendChild(cartao("Saldo desconhecido", String(conta(function (i) { return i.situacao === "desconhecido"; })), "sem quantidade informada — não é zero"));

    var rep = estoque.reposicao;
    el("blocoReposicao").hidden = !rep.length;
    var ul = limpar(el("listaReposicao"));
    rep.forEach(function (x) {
      ul.appendChild(h("li", null, h("span", { class: "nome" }, x.nome),
        h("span", { class: "det" }, (x.faltam ? "faltam " + qtdBR(x.faltam) + " " + (x.unidade || "") + " para o mínimo" : "esgotado") + (x.saldo !== null ? " · tem " + qtdBR(x.saldo) : ""))));
    });

    var busca = String(el("feBusca").value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    var fc = el("feCategoria").value, fl = el("feLocal").value, fs = el("feSituacao").value;
    var lista = estoque.itens.filter(function (i) {
      if (fc && i.categoria !== fc) return false;
      if (fl && i.local !== fl && !(i.locais || []).some(function (l) { return l.local === fl; })) return false;
      if (fs === "validade" ? !i.validadeProxima : fs && i.situacao !== fs) return false;
      if (busca && (i.nome + " " + (i.codigo || "")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").indexOf(busca) < 0) return false;
      return true;
    }).sort(function (a, b) { return String(a.nome).localeCompare(b.nome); });
    var corpo = limpar(el("tabelaEstoque").querySelector("tbody"));
    lista.forEach(function (i) {
      var unidade = i.unidadeConsumo || i.unidadeCompra || "";
      corpo.appendChild(h("tr", { class: "clicavel", tabindex: "0", onclick: function () { abrirItem(i.id); }, onkeydown: function (ev) { if (ev.key === "Enter") abrirItem(i.id); } },
        h("td", null, i.nome, h("span", { class: "sub" }, [i.codigo, i.categoria, i.origem === "local" ? "só no Alveare" : ""].filter(Boolean).join(" · "))),
        h("td", { class: "dir" }, i.saldo === null ? h("span", { class: "qtd-desconhecida" }, "desconhecido") : h("span", { class: "qtd" }, qtdBR(i.saldo) + " " + unidade)),
        h("td", null, h("span", { class: "selo selo-" + i.situacao }, SITUACAO_EST[i.situacao]), i.validadeProxima ? h("span", { class: "sub desatualizado" }, "validade " + dataBR(i.validadeMaisProxima)) : null),
        h("td", null, h("span", { class: "selo selo-origem" }, i.modoSaldo === "livro" ? "Alveare" : i.origem === "clinicorp" ? "Clinicorp" : "Arquivo"),
          h("span", { class: "sub" + (i.desatualizado ? " desatualizado" : "") }, i.modoSaldo === "livro"
            ? (i.corteEm ? "contagem de " + dataBR(String(i.corteEm).slice(0, 10)) : "sem contagem")
            : (i.saldoObservadoEm ? new Date(i.saldoObservadoEm).toLocaleDateString("pt-BR") + (i.desatualizado ? " · antigo" : "") : "—")))));
    });
    el("vazioEstoque").hidden = lista.length > 0;
    renderVendas();
  }

  var itemAberto = null;
  function abrirItem(id) {
    var i = estoque.itens.filter(function (x) { return x.id === id; })[0];
    if (!i) return;
    itemAberto = i;
    var unidade = i.unidadeConsumo || i.unidadeCompra || "";
    el("itemTitulo").textContent = i.nome;
    var sd = limpar(el("itemSaldo"));
    sd.appendChild(document.createTextNode(i.saldo === null ? "Saldo desconhecido" : qtdBR(i.saldo) + " " + unidade));
    sd.appendChild(h("small", null, i.origemSaldo + (i.saldoObservadoEm ? " Atualizado em " + new Date(i.saldoObservadoEm).toLocaleString("pt-BR") + "." : "") +
      (i.desatualizado && i.modoSaldo !== "livro" ? " Retrato antigo: pode não ser o atual." : "")));
    var dl = limpar(el("itemDados"));
    var par = function (k, v) { if (v === null || v === undefined || v === "") return; dl.appendChild(h("dt", null, k)); dl.appendChild(h("dd", null, v)); };
    par("Fonte", { importacao: "Importação de arquivo (manual)", clinicorp: "Clinicorp", local: "Só no Alveare" }[i.origem] || i.origem);
    par("Código", i.codigo); par("Categoria", i.categoria);
    par("Unidade", (i.unidadeCompra && i.unidadeCompra !== i.unidadeConsumo ? "compra em " + i.unidadeCompra + (i.fator ? " (" + qtdBR(i.fator) + " " + (i.unidadeConsumo || "") + " cada)" : " — falta o fator") + "; consumo em " : "") + (i.unidadeConsumo || "—"));
    par("Estoque mínimo", i.minimo ? qtdBR(i.minimo) + " " + unidade : "");
    par("Custo unitário", i.custoUnitario !== null && i.custoUnitario !== undefined ? brl(i.custoUnitario) + " por " + (unidade || "unidade") + " (" + (NOMES_CUSTO[i.custoFonte] || NOMES_CUSTO.estimativa) + ")" : "não informado");
    if (i.modoSaldo === "livro" && i.custoMedio !== null && i.custoMedio !== undefined) par("Custo médio das compras", brl(i.custoMedio) + " por " + (unidade || "unidade"));
    par("Precificação", i.insumoId ? "já usado nas fichas de custo" : "");
    var ul = limpar(el("itemLocais"));
    if (!(i.locais || []).length) ul.appendChild(h("li", { class: "det" }, "Sem retrato por local."));
    (i.locais || []).forEach(function (l) {
      ul.appendChild(h("li", null, h("span", { class: "nome" }, (l.local || "sem local") + (l.lote ? " · lote " + l.lote : "")),
        h("span", { class: "det" }, (l.quantidade === "" ? "desconhecido" : qtdBR(l.quantidade) + " " + unidade) + (l.validade ? " · validade " + dataBR(l.validade) : "") + " · " + new Date(l.observadoEm).toLocaleDateString("pt-BR"))));
    });
    var hist = limpar(el("itemHistorico"));
    var livro = i.modoSaldo === "livro";
    el("itemHistTitulo").textContent = livro ? "Entradas, vendas, devoluções, perdas e ajustes" : "Variações observadas entre retratos";
    if (livro) {
      if (!i.movimentos.length) hist.appendChild(h("li", { class: "det" }, "Nenhum movimento depois da contagem."));
      i.movimentos.slice().reverse().forEach(function (m) {
        var sinal = m.tipo === "estorno" ? "↺ " : ({ entrada: 1, devolucao: 1, ajuste: Number(m.quantidade) < 0 ? -1 : 1 }[m.tipo] || -1) > 0 ? "+ " : "− ";
        hist.appendChild(h("li", null, h("span", { class: "nome" }, sinal + qtdBR(String(m.quantidade).replace("-", "")) + " " + unidade + " · " + m.nomeTipo),
          h("span", { class: "det" }, dataBR(m.data) + (m.custoUnitario !== null && m.custoUnitario !== undefined && m.tipo === "entrada" ? " · " + brl(m.custoUnitario) + " cada" : "") +
            (m.motivo ? " · " + m.motivo : "") + (m.autorNome ? " · " + m.autorNome : "") + (!m.conta && m.tipo !== "estorno" ? " · antes da contagem (não mexe no saldo)" : ""))));
      });
    } else {
      if (!i.variacoes.length) hist.appendChild(h("li", { class: "det" }, "Só um retrato até agora. A fonte informa saldos, não movimentos: as diferenças entre retratos aparecem aqui, sem explicação inventada."));
      i.variacoes.slice().reverse().forEach(function (v2) { hist.appendChild(h("li", null, h("span", { class: "nome" }, (Number(v2.variacao) > 0 ? "+" : "") + qtdBR(v2.variacao) + " " + unidade), h("span", { class: "det" }, "entre " + new Date(v2.de).toLocaleDateString("pt-BR") + " e " + new Date(v2.ate).toLocaleDateString("pt-BR")))); });
    }
    renderVendasDoItem(i, unidade);
    el("itemMovimentar").hidden = !livro;
    el("itemAssumir").hidden = livro;
    el("itemVoltarFonte").hidden = !livro || i.origem === "local";
    el("asQtd").value = ""; el("asCusto").value = "";
    el("mvData").value = hoje(); el("mvCusto").value = "";
    atualizarTipoMovimento();
    var selF = limpar(el("itFicha"));
    selF.appendChild(h("option", { value: "" }, "Nenhuma"));
    estado.dados.fichas.filter(function (f) { return !f.arquivada && f.tipo !== "pacote"; }).forEach(function (f) { selF.appendChild(h("option", { value: f.id }, f.nome)); });
    selF.value = i.fichaId || "";
    var selU = limpar(el("itUnidade"));
    ["", "un", "ml", "l", "g", "kg", "mg", "cm", "m", "uso"].forEach(function (u) { selU.appendChild(h("option", { value: u }, u || "—")); });
    selU.value = i.unidadeConsumo || "";
    el("itFator").value = qtdBR(i.fator); el("itMinimo").value = qtdBR(i.minimo); el("itNotas").value = i.notas || "";
    el("mvQtd").value = ""; el("mvMotivo").value = "";
    el("itemErro").textContent = "";
    el("itPrecificar").textContent = i.insumoId ? "Atualizar na precificação" : "Usar na precificação";
    if (!el("dlgItem").open) el("dlgItem").showModal();
  }

  async function opEstoque(op, msg) {
    try { await aplicar(op); toast(msg); await carregarEstoque(); if (itemAberto) abrirItem(itemAberto.id); }
    catch (e) { el("itemErro").textContent = e.message; }
  }

  function ligarEstoque() {
    ["feBusca", "feCategoria", "feLocal", "feSituacao"].forEach(function (id) { el(id).addEventListener("input", renderEstoque); el(id).addEventListener("change", renderEstoque); });
    el("btnImportarEstoque").addEventListener("click", function () {
      FloreSerImportacao.abrir({ modulo: MOD, tipo: "estoque", titulo: "Importar estoque (manual)", token: token,
        aviso: "Importação manual: use o arquivo exportado do estoque do Clinicorp (ou outra planilha). O mapeamento fica salvo para a próxima vez. Cada importação é um retrato dos saldos na data informada; o mesmo arquivo no mesmo dia não duplica.",
        campos: [
          { id: "nome", nome: "Produto ou insumo", tipo: "texto", apelidos: ["nome", "produto", "insumo", "descricao", "descrição", "item"] },
          { id: "codigo", nome: "Código", tipo: "texto", apelidos: ["codigo", "código", "cod", "sku", "referencia"] },
          { id: "quantidade", nome: "Quantidade atual", tipo: "decimal", apelidos: ["quantidade", "saldo", "estoque", "qtd", "qtde"] },
          { id: "unidade", nome: "Unidade (UN, CX, ML, G...)", tipo: "texto", apelidos: ["unidade", "un", "unidade de medida", "medida"] },
          { id: "categoria", nome: "Categoria", tipo: "texto", apelidos: ["categoria", "grupo", "tipo"] },
          { id: "minimo", nome: "Estoque mínimo", tipo: "decimal", apelidos: ["minimo", "mínimo", "estoque minimo", "estoque mínimo"] },
          { id: "custoUnitario", nome: "Custo unitário", tipo: "dinheiro", apelidos: ["custo", "custo unitario", "custo unitário", "preco", "preço", "valor unitario"] },
          { id: "local", nome: "Local / unidade", tipo: "texto", apelidos: ["local", "unidade da clinica", "almoxarifado", "sala"] },
          { id: "lote", nome: "Lote", tipo: "texto", apelidos: ["lote"] },
          { id: "validade", nome: "Validade", tipo: "data", apelidos: ["validade", "vencimento", "data de validade"] },
          { id: "dataRetrato", nome: "Data do retrato (vazio = hoje)", tipo: "data", apelidos: ["data", "data do saldo", "posicao", "posição"] }
        ],
        aoConcluir: function () { carregarEstoque(); recarregar(); } });
    });
    el("btnNovoItem").addEventListener("click", function () {
      var nome = window.prompt("Item que NÃO está no Clinicorp (fica marcado como \"só no Alveare\", com saldo próprio). Nome:", "");
      if (!nome) return;
      var unidade = window.prompt("Unidade de consumo (un, ml, g...):", "un") || "un";
      opEstoque({ tipo: "estoque.item.salvar", id: novoId("est"), revBase: 0, dados: { nome: nome.trim(), unidadeConsumo: unidade.trim(), unidadeCompra: unidade.trim() } }, "Item criado.");
    });
    el("mvTipo").addEventListener("change", atualizarTipoMovimento);
    el("mvRegistrar").addEventListener("click", function () {
      if (!itemAberto) return;
      var tipo = el("mvTipo").value, custo = centavosDe(el("mvCusto").value);
      if (custo !== null && isNaN(custo)) { el("itemErro").textContent = "Custo inválido."; return; }
      opEstoque({ tipo: "estoque.movimento", itemId: itemAberto.id, dados: { id: novoId("mv"), tipo: tipo, quantidade: el("mvQtd").value.trim(),
        data: el("mvData").value || hoje(), motivo: el("mvMotivo").value.trim(), custoUnitario: tipo === "entrada" || tipo === "contagem" ? custo : null } }, "Registrado.");
    });
    el("asConfirmar").addEventListener("click", function () {
      if (!itemAberto) return;
      var q = el("asQtd").value.trim();
      if (!q) { el("itemErro").textContent = "Informe a quantidade contada."; return; }
      var custo = centavosDe(el("asCusto").value);
      if (!window.confirm("A partir de agora o saldo de " + itemAberto.nome + " passa a ser calculado no Alveare, começando em " + q + ". Os próximos arquivos importados ficam só como registro. Confirmar?")) return;
      opEstoque({ tipo: "estoque.movimento", itemId: itemAberto.id, dados: { id: novoId("ct"), tipo: "contagem", quantidade: q, custoUnitario: custo !== null && !isNaN(custo) ? custo : null,
        motivo: "assumir o saldo no Alveare" } }, "O saldo agora é calculado no Alveare.");
    });
    el("btnVoltarFonte").addEventListener("click", function () {
      if (!itemAberto || !window.confirm("Voltar a usar o saldo do último arquivo importado? O que foi registrado aqui continua no histórico, mas deixa de definir o saldo.")) return;
      opEstoque({ tipo: "estoque.voltarAoRetrato", itemId: itemAberto.id }, "O saldo volta a ser o do arquivo.");
    });
    ligarVendas();
    el("itSalvar").addEventListener("click", function () {
      if (!itemAberto) return;
      opEstoque({ tipo: "estoque.item.salvar", id: itemAberto.id, revBase: itemAberto._rev, dados: { unidadeConsumo: el("itUnidade").value, fator: el("itFator").value.trim(),
        minimo: el("itMinimo").value.trim(), notas: el("itNotas").value, fichaId: el("itFicha").value } }, "Ajustes salvos.");
    });
    el("itPrecificar").addEventListener("click", async function () {
      if (!itemAberto) return;
      try { await aplicar({ tipo: "estoque.usarNaPrecificacao", itemId: itemAberto.id }); toast("Material disponível nas fichas de custo, com o custo do estoque."); await recarregar(); await carregarEstoque(); abrirItem(itemAberto.id); }
      catch (e) { el("itemErro").textContent = e.message; }
    });
  }

  /* ---------------------------------------------------------------
     Vendas de produtos
     ---------------------------------------------------------------
     Uma venda, vários produtos. O estoque só baixa com a saída
     confirmada (entregue/retirado), e só em item com saldo calculado no
     Alveare; item com saldo de arquivo não desconta (o arquivo já traz a
     saída). O custo é gravado pelo servidor no momento da venda. */

  var NOMES_CUSTO = { compra: "comprovado pelas compras", importacao: "informado pela fonte", estimativa: "estimado" };
  var vendaAberta = null;

  function atualizarTipoMovimento() {
    var t = el("mvTipo").value;
    el("mvCustoCampo").hidden = t !== "entrada" && t !== "contagem";
    el("mvNota").textContent = {
      entrada: "Compra recebida. Com o custo informado, o custo médio do produto passa a ser comprovado pelas compras.",
      perda: "Produto perdido, vencido ou danificado: sai do estoque e não é venda.",
      consumo: "Material usado nos atendimentos, registrado por quem usou. Nunca é deduzido de um agendamento.",
      ajuste: "Correção de diferença. Use número negativo para tirar.",
      contagem: "O saldo passa a ser o contado, a partir de agora (com data e hora). Movimentos com data anterior deixam de mexer no saldo."
    }[t] || "";
  }

  function situacaoDaVenda(v) {
    if (v.estado === "cancelada") return h("span", { class: "selo selo-cancelada" }, "cancelada");
    if (!v.entregueEm) return h("span", { class: "selo selo-pendente" }, "a confirmar");
    return h("span", { class: "selo selo-paga" }, dataBR(v.entregueEm));
  }

  function nomeDoProduto(itemId) {
    var i = estoque && estoque.itens.filter(function (x) { return x.id === itemId; })[0];
    return i ? i.nome : "(produto removido)";
  }

  function renderVendas() {
    if (!estoque) return;
    var f = el("fvdSituacao").value;
    var lista = (estoque.vendas || []).filter(function (v) {
      if (f === "aconfirmar") return v.estado === "ativa" && !v.entregueEm;
      if (f === "entregue") return v.estado === "ativa" && !!v.entregueEm;
      if (f === "cancelada") return v.estado === "cancelada";
      return true;
    });
    var corpo = limpar(el("tabelaVendas").querySelector("tbody"));
    lista.forEach(function (v) {
      var t = v._totais;
      corpo.appendChild(h("tr", { class: "clicavel", tabindex: "0", onclick: function () { abrirVenda(v.id); }, onkeydown: function (ev) { if (ev.key === "Enter") abrirVenda(v.id); } },
        h("td", null, dataBR(v.data), v.origem === "importacao" ? h("span", { class: "sub" }, "relatório importado") : null),
        h("td", null, v.pacienteNome || "—"),
        h("td", null, v.itens.map(function (i) { return nomeDoProduto(i.itemId) + " × " + qtdBR(i.quantidade); }).join("; ")),
        h("td", { class: "dir" }, brl(t.vendido)),
        h("td", { class: "dir" }, t.custo === null ? h("span", { class: "sub" }, "não informado") : brl(t.custo)),
        h("td", { class: "dir" }, t.diferenca === null ? "—" : brl(t.diferenca)),
        h("td", null, situacaoDaVenda(v))));
    });
    el("vazioVendas").hidden = lista.length > 0;
  }

  function renderVendasDoItem(i, unidade) {
    var alvo = limpar(el("itemVendas"));
    var r = i.vendas;
    if (!r) { alvo.appendChild(h("p", { class: "nota" }, "Nenhuma venda deste produto.")); return; }
    alvo.appendChild(h("p", { class: "nota" }, "Vendidos " + qtdBR(r.quantidade) + " " + unidade + " · " + brl(r.vendido) +
      (r.custoTotal === null ? " · custo de " + qtdBR(r.custoDesconhecido) + " " + unidade + " não informado" : " · custo " + brl(r.custoTotal) + " · diferença " + brl(r.diferenca)) +
      (i.modoSaldo === "livro" ? "" : " · o saldo deste item é o do arquivo: as vendas aparecem aqui, mas não descontam.")));
    var tab = h("table", { class: "tabela tabela-compacta" },
      h("thead", null, h("tr", null, h("th", null, "Data"), h("th", { class: "dir" }, "Qtd"), h("th", { class: "dir" }, "Preço"), h("th", { class: "dir" }, "Desconto"),
        h("th", { class: "dir" }, "Vendido"), h("th", { class: "dir" }, "Custo"), h("th", { class: "dir" }, "Diferença"))));
    var tb = h("tbody");
    r.vendas.forEach(function (x) {
      tb.appendChild(h("tr", { class: "clicavel", onclick: function () { el("dlgItem").close(); abrirVenda(x.vendaId); } },
        h("td", null, dataBR(x.data), x.entregueEm ? null : h("span", { class: "sub desatualizado" }, "saída a confirmar")),
        h("td", { class: "dir" }, qtdBR(x.quantidade)), h("td", { class: "dir" }, brl(x.precoUnitario)),
        h("td", { class: "dir" }, x.desconto ? brl(x.desconto) : "—"), h("td", { class: "dir" }, brl(x.vendido)),
        h("td", { class: "dir" }, x.custoTotal === null ? h("span", { class: "sub" }, "não informado") : h("span", { title: NOMES_CUSTO[x.custoFonte] || "" }, brl(x.custoTotal) + (x.custoFonte === "estimativa" ? " (estimado)" : ""))),
        h("td", { class: "dir" }, x.diferenca === null ? "—" : brl(x.diferenca))));
    });
    tab.appendChild(tb);
    alvo.appendChild(h("div", { class: "tabela-rolagem" }, tab));
  }

  function linhaVenda(x) {
    var sel = h("select", { class: "input", "aria-label": "Produto" });
    sel.appendChild(h("option", { value: "" }, "Escolha o produto"));
    (estoque ? estoque.itens : []).slice().sort(function (a, b) { return String(a.nome).localeCompare(b.nome); }).forEach(function (i) {
      sel.appendChild(h("option", { value: i.id }, i.nome + (i.codigo ? " · " + i.codigo : "") + (i.saldo !== null ? " (tem " + qtdBR(i.saldo) + ")" : "")));
    });
    sel.value = x.itemId || "";
    var qtd = h("input", { class: "input", inputmode: "decimal", placeholder: "qtd", "aria-label": "Quantidade", value: x.quantidade ? qtdBR(x.quantidade) : "" });
    var preco = h("input", { class: "input", inputmode: "decimal", placeholder: "preço cobrado", "aria-label": "Preço unitário cobrado", value: x.precoUnitario !== undefined && x.precoUnitario !== null ? numBR(x.precoUnitario) : "" });
    var desc = h("input", { class: "input", inputmode: "decimal", placeholder: "desconto", "aria-label": "Desconto neste produto", value: x.desconto ? numBR(x.desconto) : "" });
    var li = h("li", null, sel, qtd, preco, desc, h("button", { type: "button", class: "icone-btn", "aria-label": "Tirar", onclick: function () { li.remove(); previaVenda(); } }, "×"));
    li._id = x.id || "";
    li._ler = function () {
      return { id: li._id || undefined, itemId: sel.value, quantidade: qtd.value.trim(), precoUnitario: centavosDe(preco.value), desconto: centavosDe(desc.value) || 0 };
    };
    if (vendaAberta && vendaAberta.estado === "cancelada") [sel, qtd, preco, desc].forEach(function (c) { c.disabled = true; });
    return li;
  }

  /* "1,5" ou "1.5" → 1.5; "1.234,5" → 1234.5 (a mesma regra do servidor) */
  function numeroDigitado(t) {
    var x = String(t || "").trim();
    if (x.indexOf(",") >= 0) x = x.replace(/\./g, "").replace(",", ".");
    return Number(x) || 0;
  }

  /* prévia na tela (o servidor confere e grava os valores de verdade) */
  function previaVenda() {
    var itens = Array.prototype.map.call(el("vdItens").children, function (li) { return li._ler(); });
    var bruto = 0;
    itens.forEach(function (i) { var q = numeroDigitado(i.quantidade); if (i.precoUnitario !== null && !isNaN(i.precoUnitario)) bruto += Math.round(q * i.precoUnitario) - (i.desconto || 0); });
    var geral = centavosDe(el("vdDesconto").value) || 0;
    var alvo = limpar(el("vdTotais"));
    var dl = h("dl");
    linhaDl(dl, "Produtos", String(itens.filter(function (i) { return i.itemId; }).length));
    linhaDl(dl, "Valor vendido", brl(bruto - geral));
    if (vendaAberta && vendaAberta._totais) {
      var t = vendaAberta._totais;
      linhaDl(dl, "Custo gravado", t.custo === null ? "não informado" : brl(t.custo));
      if (t.diferenca !== null) linhaDl(dl, "Diferença (não é lucro)", brl(t.diferenca));
    } else dl.appendChild(h("dd", { class: "sub" }, "O custo de cada produto é gravado ao salvar."));
    alvo.appendChild(dl);
  }

  async function abrirVenda(id, itemId) {
    if (!estoque) await carregarEstoque();
    var v = id ? (estoque.vendas || []).filter(function (x) { return x.id === id; })[0] : null;
    vendaAberta = v || null;
    el("vendaTitulo").textContent = v ? "Venda de " + dataBR(v.data) + (v.estado === "cancelada" ? " (cancelada)" : "") : "Registrar venda";
    el("vdData").value = v ? v.data : hoje();
    el("vdPaciente").value = v ? v.pacienteNome || "" : "";
    el("vdEntregueEm").value = v ? v.entregueEm || "" : hoje();
    el("vdDesconto").value = v && v.descontoGeral ? numBR(v.descontoGeral) : "";
    el("vdTaxas").value = v && v.taxas !== null && v.taxas !== undefined ? numBR(v.taxas) : "";
    el("vdNotas").value = v ? v.notas || "" : "";
    var ul = limpar(el("vdItens"));
    (v ? v.itens : [{ itemId: itemId || "" }]).forEach(function (x) { ul.appendChild(linhaVenda(x)); });
    var cancelada = v && v.estado === "cancelada";
    el("vdAviso").hidden = !(v && (cancelada || v.origem === "importacao"));
    el("vdAviso").textContent = cancelada ? "Venda cancelada: o que tinha saído do estoque voltou, com o registro no histórico." :
      v && v.origem === "importacao" ? "Venda vinda de relatório importado. Importar o mesmo relatório de novo não duplica; um relatório corrigido corrige a venda." : "";
    el("vdAddItem").hidden = !!cancelada;
    el("vdSalvar").hidden = !!cancelada;
    el("vdCancelar").hidden = !v || cancelada;
    el("vdConfirmarSaida").hidden = !v || cancelada || !!v.entregueEm;
    el("vdAcoes").hidden = !v || cancelada;
    var dv = limpar(el("dvItem"));
    (v ? v.itens : []).forEach(function (i) { dv.appendChild(h("option", { value: i.id }, nomeDoProduto(i.itemId) + " (vendidos " + qtdBR(i.quantidade) + (i.devolvido ? ", devolvidos " + qtdBR(i.devolvido) : "") + ")")); });
    el("dvQtd").value = ""; el("dvMotivo").value = ""; el("dvRetorno").checked = false;
    el("vdErro").textContent = "";
    previaVenda();
    if (!el("dlgVenda").open) el("dlgVenda").showModal();
  }

  async function opVenda(op, msg, fechar) {
    try {
      await aplicar(op);
      toast(msg);
      await carregarEstoque();
      if (fechar) el("dlgVenda").close(); else if (vendaAberta) abrirVenda(vendaAberta.id);
    } catch (e) { el("vdErro").textContent = e.message; }
  }

  function ligarVendas() {
    el("btnNovaVenda").addEventListener("click", function () { abrirVenda(null); });
    el("vdAddItem").addEventListener("click", function () { el("vdItens").appendChild(linhaVenda({})); });
    el("fvdSituacao").addEventListener("change", renderVendas);
    el("formVenda").addEventListener("input", previaVenda);
    el("formVenda").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var itens = Array.prototype.map.call(el("vdItens").children, function (li) { return li._ler(); }).filter(function (i) { return i.itemId || i.quantidade; });
      if (!itens.length) { el("vdErro").textContent = "Inclua ao menos um produto."; return; }
      if (itens.some(function (i) { return i.precoUnitario === null || isNaN(i.precoUnitario); })) { el("vdErro").textContent = "Informe o preço cobrado de cada produto (0 se foi brinde)."; return; }
      var taxas = centavosDe(el("vdTaxas").value);
      opVenda({ tipo: "venda.salvar", id: vendaAberta ? vendaAberta.id : novoId("vd"), revBase: vendaAberta ? vendaAberta._rev : 0,
        dados: { data: el("vdData").value, pacienteNome: el("vdPaciente").value.trim(), entregueEm: el("vdEntregueEm").value || "",
          descontoGeral: centavosDe(el("vdDesconto").value) || 0, taxas: taxas === null || isNaN(taxas) ? null : taxas, notas: el("vdNotas").value, itens: itens } },
        el("vdEntregueEm").value ? "Venda salva. O estoque acompanha a saída." : "Venda salva. O estoque muda quando a saída for confirmada.", true);
    });
    el("vdConfirmarSaida").addEventListener("click", function () {
      if (!vendaAberta) return;
      opVenda({ tipo: "venda.confirmarSaida", id: vendaAberta.id, revBase: vendaAberta._rev, data: hoje() }, "Saída confirmada.");
    });
    el("vdCancelar").addEventListener("click", function () {
      if (!vendaAberta) return;
      var motivo = window.prompt("Cancelar esta venda? O que saiu do estoque volta, e tudo fica no histórico. Motivo:", "");
      if (motivo === null) return;
      opVenda({ tipo: "venda.cancelar", id: vendaAberta.id, revBase: vendaAberta._rev, motivo: motivo }, "Venda cancelada.");
    });
    el("dvRegistrar").addEventListener("click", function () {
      if (!vendaAberta) return;
      var q = el("dvQtd").value.trim();
      if (!q) { el("vdErro").textContent = "Informe a quantidade devolvida."; return; }
      opVenda({ tipo: "venda.devolver", id: vendaAberta.id, revBase: vendaAberta._rev, vendaItemId: el("dvItem").value, quantidade: q,
        retornoFisico: el("dvRetorno").checked, motivo: el("dvMotivo").value.trim(), data: hoje() },
        el("dvRetorno").checked ? "Devolução registrada; o produto voltou ao estoque." : "Devolução registrada, sem retorno ao estoque.");
    });
    el("btnImportarVendas").addEventListener("click", function () {
      FloreSerImportacao.abrir({ modulo: MOD, tipo: "vendas", titulo: "Importar relatório de vendas", token: token,
        aviso: "Cada linha é um produto vendido. Linhas com o mesmo número de venda (ou mesma data e paciente) formam uma venda só. O produto precisa existir no Estoque (pelo código ou pelo nome exato). Sem a coluna de saída/entrega, a venda entra sem baixar o estoque. Importar de novo não duplica. Os produtos do relatório não viram recebimento.",
        campos: [
          { id: "data", nome: "Data da venda", obrigatorio: true, tipo: "data", apelidos: ["data", "data da venda", "emissao", "emissão"] },
          { id: "venda", nome: "Número da venda", tipo: "texto", apelidos: ["venda", "numero", "número", "pedido", "id da venda"] },
          { id: "codigo", nome: "Código do produto", tipo: "texto", apelidos: ["codigo", "código", "cod", "sku"] },
          { id: "produto", nome: "Produto", tipo: "texto", apelidos: ["produto", "item", "descricao", "descrição"] },
          { id: "quantidade", nome: "Quantidade", obrigatorio: true, tipo: "decimal", apelidos: ["quantidade", "qtd", "qtde"] },
          { id: "unidade", nome: "Unidade", tipo: "texto", apelidos: ["unidade", "un"] },
          { id: "precoUnitario", nome: "Preço unitário cobrado", obrigatorio: true, tipo: "dinheiro", apelidos: ["preco", "preço", "valor unitario", "valor unitário", "preco unitario", "preço unitário"] },
          { id: "desconto", nome: "Desconto", tipo: "dinheiro", apelidos: ["desconto"] },
          { id: "paciente", nome: "Paciente", tipo: "texto", apelidos: ["paciente", "cliente", "nome"] },
          { id: "entregue", nome: "Saída/entrega (sim ou data)", tipo: "texto", apelidos: ["entregue", "entrega", "retirado", "saida", "saída"] }
        ],
        aoConcluir: function () { carregarEstoque(); } });
    });
  }

  /* ---------------------------------------------------------------
     Preço praticado (dentro da ficha)
     --------------------------------------------------------------- */

  async function carregarPraticado(f) {
    var bloco = el("fPraticadoBloco");
    bloco.hidden = !f;
    if (!f) return;
    var res = limpar(el("fPraticadoResumo")), tab = limpar(el("fPraticado"));
    res.appendChild(h("p", { class: "sub" }, "Carregando..."));
    var r = await ler("financeiro.precosPraticados", { fichaId: f.id });
    limpar(res);
    if (!r.ok) { res.appendChild(h("p", { class: "sub" }, "Não foi possível carregar agora. " + FloreSerAuth.recado(r))); return; }
    var d = r.dados, s = d.resumo;
    if (!d.linhas.length) {
      res.appendChild(h("p", { class: "sub" }, f.tipo === "produto" ? "Nenhuma venda de produto ligado a esta ficha. Ligue o produto no Estoque (Ajustes do Alveare → Ficha de custo)." :
        "Nenhum procedimento realizado com esta ficha. A ligação vem do código do procedimento no Clinicorp ou da ficha escolhida no orçamento."));
      return;
    }
    var dl = h("dl");
    linhaDl(dl, "Quantidade", qtdBR(s.quantidade));
    linhaDl(dl, "Valor vendido", brl(s.vendido) + (s.linhasSemValor ? " (" + s.linhasSemValor + " sem valor)" : ""));
    linhaDl(dl, "Custo", s.custo === null ? "não informado em " + s.linhasSemCusto + " registro(s)" : brl(s.custo));
    linhaDl(dl, "Diferença", s.diferenca === null ? "—" : brl(s.diferenca));
    if (s.menorPreco !== null) linhaDl(dl, "Preço praticado", s.menorPreco === s.maiorPreco ? brl(s.menorPreco) : brl(s.menorPreco) + " a " + brl(s.maiorPreco));
    if (d.precoPadrao !== null && d.precoPadrao !== undefined) linhaDl(dl, "Preço atual da ficha", brl(d.precoPadrao));
    res.appendChild(dl);
    res.appendChild(h("p", { class: "sub" }, d.aviso));
    tab.appendChild(h("thead", null, h("tr", null, h("th", null, "Data"), h("th", { class: "dir" }, "Qtd"), h("th", { class: "dir" }, "Custo un."),
      h("th", { class: "dir" }, "Custo total"), h("th", { class: "dir" }, "Preço"), h("th", { class: "dir" }, "Desconto"), h("th", { class: "dir" }, "Vendido"), h("th", { class: "dir" }, "Diferença"))));
    var tb = h("tbody");
    d.linhas.forEach(function (l) {
      tb.appendChild(h("tr", null, h("td", null, dataBR(l.data), h("span", { class: "sub" }, l.tipo === "venda" ? "venda" : "procedimento")),
        h("td", { class: "dir" }, qtdBR(l.quantidade)),
        h("td", { class: "dir" }, l.custoUnitario === null || l.custoUnitario === undefined ? h("span", { class: "sub" }, "não informado") : brl(l.custoUnitario) + (l.custoFonte === "estimativa" ? " (estimado)" : "")),
        h("td", { class: "dir" }, l.custoTotal === null ? "—" : brl(l.custoTotal)),
        h("td", { class: "dir" }, l.precoUnitario === null || l.precoUnitario === undefined ? "—" : brl(l.precoUnitario)),
        h("td", { class: "dir" }, l.desconto ? brl(l.desconto) : "—"),
        h("td", { class: "dir" }, l.vendido === null ? "—" : brl(l.vendido)),
        h("td", { class: "dir" }, l.diferenca === null ? "—" : brl(l.diferenca))));
    });
    tab.appendChild(tb);
  }

  /* ---------------------------------------------------------------
     Orçamentos e execução
     ---------------------------------------------------------------
     Realizado = procedimento registrado num agendamento identificado. Nada
     vira realizado por data, presença, pagamento, aprovação ou contador
     de sessões. Orçado, realizado e recebido ficam separados. */

  var exec = null, orcAberto = null, exAssociar = null, olAberto = null;
  var NOMES_ASSOC = { informada: "escolhida no registro", confirmada: "escolhida por você", automatica: "pelo código (um só orçamento possível)",
    reaproveitada: "repetindo a escolha anterior", ambigua: "mais de um orçamento possível", sugerida: "só o nome parecido", sem_orcamento: "sem orçamento" };

  function filtrosExecucao() {
    return { busca: el("fxBusca").value.trim(), situacao: el("fxSituacao").value, base: el("fxBase").value, de: el("fxDe").value, ate: el("fxAte").value };
  }

  async function carregarExecucao() {
    var r = await ler("financeiro.orcamentosExecucao", { filtros: filtrosExecucao() });
    if (!r.ok) { el("fonteExecucao").textContent = "Não foi possível carregar agora. " + FloreSerAuth.recado(r) + (exec ? " Mostrando o último carregado." : ""); if (!exec) return; }
    else exec = r.dados;
    renderExecucao();
  }

  function qtdTxt(t) { return qtdBR(t) || "0"; }
  /* o selo mostra a descrição de verdade (status do Clinicorp, "sessão da
     Agenda"...); a categoria só pinta o selo e decide o que conta */
  function textoStatus(st) { return st ? (st.descricao || exec.statusAgenda[st.categoria] || st.categoria) : ""; }
  function statusAg(st) { return st ? h("span", { class: "selo selo-ag-" + st.categoria, title: exec.statusAgenda[st.categoria] || "" }, textoStatus(st)) : null; }
  function rotuloAgendamento(a) {
    return dataBR(a.data) + (a.hora ? " " + a.hora : "") + " · " + ({ clinicorp: "Clinicorp", agenda: "Agenda", "agenda-hist": "Agenda" }[a.tipo] || a.tipo) +
      (a.area ? " · " + a.area : "") + " · " + textoStatus(a.status);
  }

  function renderExecucao() {
    if (!exec) return;
    var f = limpar(el("fonteExecucao"));
    var i = estado.dados.integracao || {};
    f.appendChild(h("details", null, h("summary", null, h("span", { class: "sem-acesso" }, "Execução registrada no Alveare"), " — por quê?"),
      h("p", { class: "sub" }, exec.fonte.falta),
      h("p", { class: "sub" }, "Orçamentos e agendamentos do Clinicorp chegam pela sincronização automática" +
        (i.atualizadoEm ? " (última em " + new Date(i.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + ")" : "") +
        ". Cada linha de procedimento do orçamento do Clinicorp conta como uma unidade (a API não informa quantidade). O \"executado\" que o Clinicorp mostra no orçamento aparece só como conferência.")));
    f.appendChild(h("div", null, "O período considera " + (el("fxBase").value === "execucao" ? "a data em que o procedimento foi realizado." : "a data do orçamento.") +
      " Valor acordado e valor realizado vêm do orçamento; o recebido fica nas Entradas."));

    var pend = exec.pendentes || [];
    el("blocoPendentesExec").hidden = !pend.length;
    var lp = limpar(el("listaPendentesExec"));
    pend.forEach(function (e) {
      lp.appendChild(h("li", null, h("span", { class: "nome" }, e.pacienteNome + " · " + e.procedimento + " × " + qtdTxt(e.quantidade)),
        h("span", { class: "det" }, dataBR(e.agendamentoData) + " · " + (NOMES_ASSOC[e.associacao] || e.associacao)),
        h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirAssociar(e); } }, "Escolher orçamento"))));
    });

    var corpo = limpar(el("tabelaOrcamentos").querySelector("tbody"));
    exec.orcamentos.forEach(function (o) {
      var t = o.totais;
      corpo.appendChild(h("tr", { class: "clicavel", tabindex: "0", onclick: function () { abrirOrcamento(o.ref); }, onkeydown: function (ev) { if (ev.key === "Enter") abrirOrcamento(o.ref); } },
        h("td", null, o.pacienteNome || "—"),
        h("td", null, (o.origem === "clinicorp" ? "Clinicorp " : "Alveare ") + o.id, o.procedimentosIncompletos ? h("span", { class: "sub desatualizado" }, "procedimentos incompletos") : null),
        h("td", null, dataBR(o.data)),
        h("td", null, o.situacao || "—"),
        h("td", { class: "dir" }, qtdTxt(t.orcada)),
        h("td", { class: "dir" }, qtdTxt(t.agendada)),
        h("td", { class: "dir" }, qtdTxt(t.realizada), Number(t.excedente) > 0 ? h("span", { class: "sub desatualizado" }, "+" + qtdTxt(t.excedente) + " excedente") : null),
        h("td", { class: "dir" }, qtdTxt(t.restante)),
        h("td", { class: "dir" }, t.valorAcordado === null ? h("span", { class: "sub" }, "não informado") : brl(t.valorAcordado))));
    });
    el("vazioOrcamentos").hidden = exec.orcamentos.length > 0;

    var ls = limpar(el("listaSemOrcamento"));
    var sem = (exec.semOrcamento || []).filter(function (e) { return e.associacao !== "ambigua" && e.associacao !== "sugerida"; });
    if (!sem.length) ls.appendChild(h("li", { class: "det" }, "Nenhum."));
    sem.forEach(function (e) {
      ls.appendChild(h("li", null, h("span", { class: "nome" }, e.pacienteNome + " · " + e.procedimento + " × " + qtdTxt(e.quantidade)),
        h("span", { class: "det" }, dataBR(e.agendamentoData) + " · " + (e.estado === "previsto" ? "previsto" : "realizado") + (e.conta ? "" : " · não conta (agendamento cancelado/falta)")),
        h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirAssociar(e); } }, "Ligar a um orçamento"))));
    });
    var dl = limpar(el("listaProcedimentos"));
    var vistos = {};
    exec.orcamentos.forEach(function (o) { o.itens.forEach(function (it) { if (!vistos[it.procedimento]) { vistos[it.procedimento] = true; dl.appendChild(h("option", { value: it.procedimento })); } }); });
  }

  function abrirOrcamento(ref) {
    var o = exec.orcamentos.filter(function (x) { return x.ref === ref; })[0];
    if (!o) return;
    orcAberto = o;
    el("orcTitulo").textContent = (o.pacienteNome || "Paciente") + " · orçamento " + o.id;
    var dl = limpar(el("orcDados"));
    var par = function (k, v) { if (v === null || v === undefined || v === "") return; dl.appendChild(h("dt", null, k)); dl.appendChild(h("dd", null, v)); };
    par("Origem", o.origem === "clinicorp" ? "Clinicorp (só leitura aqui)" : "Orçamento do Alveare");
    par("Data", dataBR(o.data)); par("Situação", o.situacao); par("Profissional", o.profissional);
    par("Desconto", o.desconto ? brl(o.desconto) : ""); par("Notas", o.notas);
    var t = o.totais;
    var c = limpar(el("orcCartoes"));
    c.appendChild(cartao("Orçado", qtdTxt(t.orcada), t.valorAcordado === null ? "valor não informado" : brl(t.valorAcordado) + " acordado"));
    c.appendChild(cartao("Realizado", qtdTxt(t.realizada), t.valorRealizado === null ? "" : brl(t.valorRealizado) + " pelo valor acordado"));
    c.appendChild(cartao("Agendado", qtdTxt(t.agendada), "previsto em agendamentos futuros"));
    c.appendChild(cartao("Restante", qtdTxt(t.restante), Number(t.excedente) > 0 ? qtdTxt(t.excedente) + " além do orçado" : "", { classe: Number(t.excedente) > 0 ? "alerta" : "" }));
    var tb = limpar(el("orcItens").querySelector("tbody"));
    o.itens.forEach(function (it) {
      tb.appendChild(h("tr", null,
        h("td", null, it.procedimento, h("span", { class: "sub" }, [it.procedimentoRef ? "código " + it.procedimentoRef : "", it.naoAprovado ? "não aprovado" : "",
          it.executadoNoClinicorp ? "Clinicorp marca executado" + (it.executadoEm ? " em " + dataBR(it.executadoEm) : "") + " (só conferência)" : ""].filter(Boolean).join(" · "))),
        h("td", { class: "dir" }, qtdTxt(it.orcada)), h("td", { class: "dir" }, qtdTxt(it.agendada)),
        h("td", { class: "dir" }, qtdTxt(it.realizada), Number(it.excedente) > 0 ? h("span", { class: "sub desatualizado" }, "+" + qtdTxt(it.excedente) + " excedente") : null),
        h("td", { class: "dir" }, qtdTxt(it.restante)),
        h("td", { class: "dir" }, it.valorAcordado === null || it.valorAcordado === undefined ? "—" : brl(it.valorAcordado))));
    });
    var ul = limpar(el("orcExecucoes"));
    var todas = [];
    o.itens.forEach(function (it) { it.execucoes.forEach(function (e) { todas.push({ e: e, it: it }); }); });
    todas.sort(function (a, b) { return String(b.e.agendamentoData).localeCompare(String(a.e.agendamentoData)); });
    if (!todas.length) ul.appendChild(h("li", { class: "det" }, "Nenhum procedimento registrado em agendamento ainda."));
    todas.forEach(function (x) { ul.appendChild(linhaExecucao(x.e, x.it.procedimento)); });
    el("orcNota").textContent = o.origem === "clinicorp" ? "Itens e valores vêm do Clinicorp; o que foi realizado vem dos registros feitos aqui." : "";
    el("orcEditar").hidden = o.origem !== "local";
    el("orcErro").textContent = "";
    if (!el("dlgOrcamento").open) el("dlgOrcamento").showModal();
  }

  function linhaExecucao(e, nomeItem) {
    var acoes = [];
    if (e.estado === "previsto") acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { alterarExecucao(e, { estado: "realizado" }, "Marcado como realizado."); } }, "Realizado"));
    if (e.estado !== "desfeito") {
      acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () {
        var q = window.prompt("Quantidade realizada neste agendamento:", qtdBR(e.quantidade));
        if (q) alterarExecucao(e, { quantidade: q }, "Quantidade corrigida.");
      } }, "Quantidade"));
      acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirAssociar(e); } }, "Orçamento"));
      acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () {
        var m = window.prompt("Desfazer este registro? Ele continua no histórico e deixa de contar. Motivo:", "");
        if (m !== null) alterarExecucao(e, { estado: "desfeito", motivo: m }, "Registro desfeito.");
      } }, "Desfazer"));
    }
    return h("li", null,
      h("span", { class: "nome" }, (nomeItem || e.procedimento) + " × " + qtdTxt(e.quantidade) + " · " + ({ previsto: "previsto", realizado: "realizado", desfeito: "desfeito" }[e.estado])),
      h("span", { class: "det" }, dataBR(e.agendamentoData) + " · ", statusAg(e.agendamentoStatus), e.conta || e.estado !== "realizado" ? "" : " não conta (agendamento " + (e.agendamentoStatus ? e.agendamentoStatus.categoria : "desconhecido") + ")",
        " · " + (NOMES_ASSOC[e.associacao] || "") + (e.origem === "importacao" ? " · relatório importado" : "")),
      h("span", { class: "acoes" }, acoes));
  }

  async function alterarExecucao(e, campos, msg) {
    try {
      await aplicar({ tipo: "exe.alterar", id: e.id, revBase: e._rev, campos: campos });
      toast(msg);
      await carregarExecucao();
      if (orcAberto && el("dlgOrcamento").open) abrirOrcamento(orcAberto.ref);
    } catch (err) { (el("dlgOrcamento").open ? el("orcErro") : el("fonteExecucao")).textContent = err.message; }
  }

  function preencherPacientes(sel, valor) {
    limpar(sel);
    sel.appendChild(h("option", { value: "" }, "Escolha a paciente"));
    (exec.pacientes || []).forEach(function (p) { sel.appendChild(h("option", { value: p.ref }, p.nome)); });
    sel.value = valor || "";
  }

  function itensDaPaciente(ref) {
    var lista = [];
    exec.orcamentos.forEach(function (o) {
      if (o.pacienteRef !== ref) return;
      o.itens.forEach(function (it) { lista.push({ ref: it.ref, nome: it.procedimento + " · orçamento " + o.id + " de " + dataBR(o.data) + " (faltam " + qtdTxt(it.restante) + ")", it: it }); });
    });
    return lista;
  }

  function atualizarAgendamentos() {
    var ref = el("exPaciente").value;
    var sel = limpar(el("exAgendamento"));
    sel.appendChild(h("option", { value: "" }, ref ? "Escolha o agendamento" : "Escolha a paciente antes"));
    exec.agendamentos.filter(function (a) { return a.pacienteRef === ref; }).forEach(function (a) {
      sel.appendChild(h("option", { value: a.ref, disabled: a.status.categoria === "cancelado" || a.status.categoria === "falta" ? true : null }, rotuloAgendamento(a) + (a.execucoes.length ? " · " + a.execucoes.length + " procedimento(s)" : "")));
    });
    var it = limpar(el("exItem"));
    it.appendChild(h("option", { value: "" }, "Decidir pelo código / sem orçamento"));
    itensDaPaciente(ref).forEach(function (x) { it.appendChild(h("option", { value: x.ref }, x.nome)); });
  }

  async function abrirRegistrar(pre) {
    if (!exec) await carregarExecucao();
    var p = pre || {};
    preencherPacientes(el("exPaciente"), p.pacienteRef || "");
    atualizarAgendamentos();
    el("exProcedimento").value = ""; el("exQtd").value = "1"; el("exEstado").value = "realizado"; el("exNotas").value = ""; el("exErro").textContent = "";
    el("dlgExecucao").showModal();
  }

  function abrirAssociar(e) {
    exAssociar = e;
    el("assocResumo").textContent = e.pacienteNome + " · " + e.procedimento + " × " + qtdTxt(e.quantidade) + " em " + dataBR(e.agendamentoData) + ". " + (NOMES_ASSOC[e.associacao] ? "Hoje: " + NOMES_ASSOC[e.associacao] + "." : "");
    var sel = limpar(el("assocItem"));
    sel.appendChild(h("option", { value: "" }, "Sem orçamento"));
    itensDaPaciente(e.pacienteRef).forEach(function (x) { sel.appendChild(h("option", { value: x.ref }, x.nome)); });
    sel.value = e.itemRef || "";
    el("assocErro").textContent = "";
    el("dlgAssociar").showModal();
  }

  function linhaOrcLocal(x) {
    var proc = h("input", { class: "input", placeholder: "procedimento", "aria-label": "Procedimento", value: x.procedimento || "", list: "listaProcedimentos", maxlength: "160" });
    var cod = h("input", { class: "input", placeholder: "código", "aria-label": "Código do procedimento", value: x.procedimentoRef || "", maxlength: "60" });
    var q = h("input", { class: "input", inputmode: "decimal", placeholder: "qtd", "aria-label": "Quantidade orçada", value: x.quantidade ? qtdBR(x.quantidade) : "1" });
    var vu = h("input", { class: "input", inputmode: "decimal", placeholder: "valor unitário", "aria-label": "Valor unitário acordado", value: x.valorTabela !== null && x.valorTabela !== undefined ? numBR(x.valorTabela) : "" });
    var ficha = h("select", { class: "input", "aria-label": "Ficha de custo" });
    ficha.appendChild(h("option", { value: "" }, "sem ficha"));
    estado.dados.fichas.filter(function (f) { return !f.arquivada && f.tipo === "procedimento"; }).forEach(function (f) { ficha.appendChild(h("option", { value: f.id }, f.nome)); });
    ficha.value = x.fichaId || "";
    var li = h("li", null, proc, cod, q, vu, ficha, h("button", { type: "button", class: "icone-btn", "aria-label": "Tirar", onclick: function () { li.remove(); } }, "×"));
    li._ler = function () { return { id: x.id || undefined, procedimento: proc.value.trim(), procedimentoRef: cod.value.trim(), quantidade: q.value.trim(), valorUnitario: centavosDe(vu.value), fichaId: ficha.value }; };
    return li;
  }

  async function abrirOrcLocal(o) {
    if (!exec) await carregarExecucao();
    olAberto = o || null;
    el("olTitulo").textContent = o ? "Orçamento " + o.id : "Orçamento do Alveare";
    preencherPacientes(el("olPaciente"), o ? o.pacienteRef : "");
    el("olData").value = o ? o.data : hoje();
    el("olSituacao").value = o ? o.situacao || "aberto" : "aprovado";
    el("olNotas").value = o ? o.notas || "" : "";
    var ul = limpar(el("olItens"));
    (o ? o.itens : [{}]).forEach(function (x) { ul.appendChild(linhaOrcLocal(x)); });
    el("olErro").textContent = "";
    el("dlgOrcLocal").showModal();
  }

  function ligarExecucao() {
    var reler = function () { carregarExecucao(); };
    el("fxBusca").addEventListener("change", reler);
    ["fxSituacao", "fxBase", "fxDe", "fxAte"].forEach(function (id) { el(id).addEventListener("change", reler); });
    el("btnNovaExecucao").addEventListener("click", function () { abrirRegistrar(null); });
    el("btnNovoOrcamento").addEventListener("click", function () { abrirOrcLocal(null); });
    el("orcRegistrar").addEventListener("click", function () { var o = orcAberto; el("dlgOrcamento").close(); abrirRegistrar({ pacienteRef: o ? o.pacienteRef : "" }); });
    el("orcEditar").addEventListener("click", function () { var o = orcAberto; el("dlgOrcamento").close(); abrirOrcLocal(o); });
    el("exPaciente").addEventListener("change", atualizarAgendamentos);
    el("exItem").addEventListener("change", function () {
      var x = itensDaPaciente(el("exPaciente").value).filter(function (i) { return i.ref === el("exItem").value; })[0];
      if (x && !el("exProcedimento").value) el("exProcedimento").value = x.it.procedimento;
    });
    el("formExecucao").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var ag = el("exAgendamento").value;
      if (!ag) { el("exErro").textContent = "Escolha o agendamento: o procedimento sempre fica ligado a um."; return; }
      var partes = ag.split(":");
      var item = itensDaPaciente(el("exPaciente").value).filter(function (i) { return i.ref === el("exItem").value; })[0];
      try {
        var r = await aplicar({ tipo: "exe.registrar", id: novoId("ex"), dados: { agendamentoTipo: partes[0], agendamentoId: partes.slice(1).join(":"),
          procedimento: el("exProcedimento").value.trim(), procedimentoRef: item ? item.it.procedimentoRef : "", fichaId: item ? item.it.fichaId || "" : "",
          quantidade: el("exQtd").value.trim(), estado: el("exEstado").value, itemRef: el("exItem").value, notas: el("exNotas").value.trim() } });
        el("dlgExecucao").close();
        toast(r.associacao === "ambigua" || r.associacao === "sugerida" ? "Registrado. Falta escolher o orçamento (aparece em \"Para decidir\")." :
          r.associacao === "sem_orcamento" ? "Registrado, sem orçamento." : "Registrado.");
        await carregarExecucao();
      } catch (e) { el("exErro").textContent = e.message; }
    });
    el("formAssociar").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (!exAssociar) return;
      try {
        await aplicar({ tipo: "exe.alterar", id: exAssociar.id, revBase: exAssociar._rev, campos: { itemRef: el("assocItem").value } });
        el("dlgAssociar").close();
        toast("Orçamento escolhido.");
        await carregarExecucao();
        if (orcAberto && el("dlgOrcamento").open) abrirOrcamento(orcAberto.ref);
      } catch (e) { el("assocErro").textContent = e.message; }
    });
    el("olAddItem").addEventListener("click", function () { el("olItens").appendChild(linhaOrcLocal({})); });
    el("formOrcLocal").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var itens = Array.prototype.map.call(el("olItens").children, function (li) { return li._ler(); }).filter(function (i) { return i.procedimento; });
      if (!el("olPaciente").value) { el("olErro").textContent = "Escolha a paciente."; return; }
      if (!itens.length) { el("olErro").textContent = "Inclua ao menos um procedimento."; return; }
      try {
        await aplicar({ tipo: "exe.orcamento.salvar", id: olAberto ? olAberto.id : novoId("orc"), revBase: olAberto ? olAberto._rev : 0,
          dados: { pacienteRef: el("olPaciente").value, data: el("olData").value, situacao: el("olSituacao").value, notas: el("olNotas").value, itens: itens } });
        el("dlgOrcLocal").close();
        toast("Orçamento salvo.");
        await carregarExecucao();
      } catch (e) { el("olErro").textContent = e.message; }
    });
    el("btnImportarExecucoes").addEventListener("click", function () {
      FloreSerImportacao.abrir({ modulo: MOD, tipo: "execucoes", titulo: "Importar procedimentos realizados", token: token,
        aviso: "Cada linha é um procedimento realizado num agendamento. A coluna do agendamento precisa ter o identificador dele (do Clinicorp ou da Agenda): sem agendamento conhecido, a linha é recusada. Agendamento futuro, cancelado ou com falta também é recusado. Importar de novo não duplica.",
        campos: [
          { id: "agendamento", nome: "Identificador do agendamento", obrigatorio: true, tipo: "texto", apelidos: ["agendamento", "id do agendamento", "atendimento", "id agendamento"] },
          { id: "procedimento", nome: "Procedimento", obrigatorio: true, tipo: "texto", apelidos: ["procedimento", "descricao", "descrição", "servico", "serviço"] },
          { id: "codigo", nome: "Código do procedimento", tipo: "texto", apelidos: ["codigo", "código", "cod"] },
          { id: "quantidade", nome: "Quantidade (vazio = 1)", tipo: "decimal", apelidos: ["quantidade", "qtd", "qtde"] }
        ],
        aoConcluir: function () { carregarExecucao(); } });
    });
  }

  /* ---------------------------------------------------------------
     Importação (planilha)
     --------------------------------------------------------------- */

  function abrirImportacao() {
    if (!window.FloreSerImportacao) { toast("A importação não carregou. Recarregue a página."); return; }
    FloreSerImportacao.abrir({
      modulo: MOD, titulo: "Importar despesas", token: token,
      campos: [
        { id: "descricao", nome: "Descrição", obrigatorio: true, tipo: "texto", apelidos: ["descricao", "descrição", "historico", "histórico", "despesa"] },
        { id: "valor", nome: "Valor", obrigatorio: true, tipo: "dinheiro", apelidos: ["valor", "total", "quantia"] },
        { id: "vencimento", nome: "Vencimento", obrigatorio: true, tipo: "data", apelidos: ["vencimento", "data", "vence"] },
        { id: "competencia", nome: "Competência (AAAA-MM)", tipo: "mes", apelidos: ["competencia", "competência", "mes", "mês"] },
        { id: "categoria", nome: "Categoria", tipo: "texto", apelidos: ["categoria"] },
        { id: "fornecedor", nome: "Fornecedor", tipo: "texto", apelidos: ["fornecedor", "favorecido"] },
        { id: "meio", nome: "Meio de pagamento", tipo: "texto", apelidos: ["meio", "forma", "forma de pagamento"] },
        { id: "conta", nome: "Conta", tipo: "texto", apelidos: ["conta", "banco"] },
        { id: "area", nome: "Área", tipo: "texto", apelidos: ["area", "área", "centro de custo"] },
        { id: "pagoEm", nome: "Pago em (só se a planilha diz que foi pago)", tipo: "data", apelidos: ["pago em", "data de pagamento", "pagamento"] },
        { id: "notas", nome: "Notas", tipo: "texto", apelidos: ["notas", "observacao", "observação", "obs"] }
      ],
      aoConcluir: function () { recarregar(); }
    });
  }

  /* ---------------------------------------------------------------
     Entrada (conta individual) e início
     --------------------------------------------------------------- */

  function avisarPortao(t) { el("portao-erro").textContent = t || ""; }

  function abrirApp() {
    var p = el("portao");
    if (p) p.remove();
    document.body.style.overflow = "";
    document.body.classList.add("entrou");
    status.salvoAgora();
    if (!el("fvDe").value) definirPeriodo("mes");
    renderTudo();
    mostrarAba(estado.aba);
    if (window.FloreSerAuth) FloreSerAuth.montarIdentidade(el("quemEsta"), function () { location.reload(); });
    abrirDespesaPedida();
    if (window.FloreSerLogs) FloreSerLogs.registrar("FINANCEIRO_ABERTO", { mensagem: "Financeiro aberto com " + estado.dados.despesas.length + " despesa(s)" });
  }

  /* ?despesa=<id>, vindo da busca global: abre a ficha e limpa a barra */
  function abrirDespesaPedida() {
    var id = "";
    try { id = new URLSearchParams(location.search).get("despesa") || ""; } catch (e) { id = ""; }
    if (!id) return;
    try { history.replaceState(null, "", location.pathname); } catch (e) { }
    if (!porId(estado.dados.despesas)[id]) { toast("A despesa deste link não existe mais."); return; }
    mostrarAba("despesas");
    abrirDetalhe(id);
  }

  function abrirLogin() {
    avisarPortao("");
    FloreSerAuth.abrirLogin({ modulo: MOD, aoEntrar: function () {
      carregar().then(abrirApp).catch(function (e) {
        avisarPortao(e.resposta && e.resposta.erro && e.resposta.erro.categoria === "autorizacao"
          ? "Esta conta não tem acesso ao Financeiro. O acesso é dado no painel, por pessoa."
          : "Não foi possível carregar agora. " + FloreSerAuth.recado(e.resposta));
      });
    } });
  }

  async function retomar() {
    var entrou = await FloreSerAuth.tentarRetomar(MOD, { aoEntrar: function () { carregar().then(abrirApp).catch(function (e) { avisarPortao(FloreSerAuth.recado(e.resposta)); }); } });
    if (!entrou) return;
    try { await carregar(); abrirApp(); FloreSerAuth.encerrarRetomada(); }
    catch (e) {
      FloreSerAuth.atualizarRetomada({ etapa: "erro", modulo: MOD, mensagem: "Sua conta foi reconhecida, mas não foi possível carregar o Financeiro. " + FloreSerAuth.recado(e.resposta),
        acoes: [{ texto: "Tentar novamente", fn: function () { location.reload(); } }] });
    }
  }

  function ligar() {
    ligarAbas();
    ligarEstoque();
    ligarExecucao();
    el("portao-btn").addEventListener("click", abrirLogin);
    el("btnNovaDespesa").addEventListener("click", function () { abrirDespesa(null); });
    el("formDespesa").addEventListener("submit", salvarDespesa);
    document.querySelectorAll('input[name="dModo"]').forEach(function (r) { r.addEventListener("change", atualizarModo); });
    ["dValor", "dVencimento", "dParcelas", "dParcFreq", "dRecFreq", "dRecQtd", "dRecFim"].forEach(function (id) {
      el(id).addEventListener("input", previaDaSerie); el(id).addEventListener("change", previaDaSerie);
    });
    document.querySelectorAll("[data-fechar]").forEach(function (b) { b.addEventListener("click", function () { var d = b.closest("dialog"); if (d) d.close(); }); });
    el("pRegistrar").addEventListener("click", registrarPagamento);
    el("detCancelar").addEventListener("click", cancelarOuReativar);
    el("detEditar").addEventListener("click", function () { var id = estado.despesaAberta; el("dlgDetalhe").close(); abrirDespesa(id); });
    el("detHistoricoBtn").addEventListener("click", mostrarHistorico);
    ["fvDe", "fvAte", "fvCategoria", "fvFornecedor", "fvEstado", "fvArea", "fvOrigem"].forEach(function (id) {
      el(id).addEventListener("change", function () { document.querySelectorAll("#fvAtalhos button").forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); atualizarResumo(); });
    });
    document.querySelectorAll("#fvAtalhos button").forEach(function (b) { b.addEventListener("click", function () { definirPeriodo(b.getAttribute("data-atalho")); }); });
    ["fdBusca", "fdEstado", "fdCategoria", "fdDe", "fdAte"].forEach(function (id) { el(id).addEventListener("input", renderDespesas); el(id).addEventListener("change", renderDespesas); });
    el("recorteLimpar").addEventListener("click", function () { estado.recorte = null; renderDespesas(); });
    el("btnExportar").addEventListener("click", exportarCSV);
    el("btnImportar").addEventListener("click", abrirImportacao);
    el("orcMes").addEventListener("change", renderPlanejamento);
    el("btnNovaCategoria").addEventListener("click", function () { abrirCadastro("categoria", null); });
    el("btnNovoFornecedor").addEventListener("click", function () { abrirCadastro("fornecedor", null); });
    el("btnNovoSaldo").addEventListener("click", function () { abrirCadastro("saldo", null); });
    el("btnNovoInsumo").addEventListener("click", function () { abrirCadastro("insumo", null); });
    el("formCadastro").addEventListener("submit", salvarCadastro);
    el("btnNovaFicha").addEventListener("click", function () { abrirFicha(null); });
    el("formFicha").addEventListener("submit", salvarFicha);
    el("fAprovar").addEventListener("click", aprovarFicha);
    el("fTipo").addEventListener("change", function () { tipoDaFicha(); calcularAoVivo(); });
    el("fAddItem").addEventListener("click", function () { el("fItens").appendChild(linhaItem({})); });
    el("fAddEquip").addEventListener("click", function () { el("fEquip").appendChild(linhaEquip({})); });
    el("fAddComp").addEventListener("click", function () { el("fComp").appendChild(linhaComp({})); });
    el("formFicha").addEventListener("input", calcularAoVivo);
    el("formFicha").addEventListener("change", calcularAoVivo);

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "n" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var tag = (ev.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || document.querySelector("dialog[open]")) return;
      if (!document.body.classList.contains("entrou")) return;
      ev.preventDefault();
      abrirDespesa(null);
    });

    window.addEventListener("beforeunload", function (ev) { if (estado.emVoo) { ev.preventDefault(); ev.returnValue = ""; } });
    FloreSerSessao.ouvir(function (tipo) {
      if (!document.body.classList.contains("entrou")) return;
      if (tipo === "perdida") status.definir("expirado");
      if (tipo === "trocou") toast("Outra conta entrou neste navegador. Recarregue a página para usar a conta nova.");
    });
  }

  function boot() {
    document.body.style.overflow = "hidden";
    var versao = el("rodapeVersao");
    if (versao) versao.textContent = (window.FLORESER && window.FLORESER.rotulo) || "";
    status = FloreSerSync.criarStatus(el("saveStatus"));
    status.definir("carregando");
    ligar();
    if (FloreSerSessao.temConta()) retomar();
    else el("portao-btn").focus();
  }

  boot();
})();
