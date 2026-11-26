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
     Duas vistas sobre a MESMA apuração do servidor:
       · todas as pacientes: a lista de orçamentos, com as pendências;
       · uma paciente: os planos (em andamento primeiro), compras e
         avulsos, os atendimentos a conferir e, dentro de cada plano,
         resumo, contratado × realizado, histórico por atendimento e
         bônus/créditos.
     Realizado = procedimento registrado num agendamento identificado. Nada
     vira realizado por data, presença, pagamento, aprovação ou contador
     de sessões. Orçado, realizado, recebido e crédito ficam separados. */

  var exec = null, pac = null, pacRef = "", planoAberto = null, areaPlano = "";
  var exAssociar = null, olAberto = null, trocaCtx = null, atendCtx = null, credCtx = null;
  var NOMES_ASSOC = { informada: "escolhida no registro", confirmada: "escolhida por você", automatica: "automática (um só plano possível)",
    reaproveitada: "escolha anterior (4.3.0)", ambigua: "mais de um plano possível", sugerida: "só o nome parecido", sem_orcamento: "sem plano", avulso: "avulso confirmado" };
  var NOMES_TIPO_DOC = { plano: "Plano de tratamento", compra: "Compra de produtos", avulso: "Atendimento avulso", vazio: "Sem itens" };
  var NOMES_SITUACAO = { andamento: "Em andamento", concluido: "Concluído", cancelado: "Cancelado na origem" };

  function filtrosExecucao() {
    return { busca: el("fxBusca").value.trim(), situacao: el("fxSituacao").value, base: el("fxBase").value, de: el("fxDe").value, ate: el("fxAte").value };
  }

  async function carregarExecucao() {
    var r = await ler("financeiro.orcamentosExecucao", { filtros: filtrosExecucao() });
    if (!r.ok) { el("fonteExecucao").textContent = "Não foi possível carregar agora. " + FloreSerAuth.recado(r) + (exec ? " Mostrando o último carregado." : ""); if (!exec) return; }
    else exec = r.dados;
    var sel = el("fxPaciente");
    limpar(sel);
    sel.appendChild(h("option", { value: "" }, "Todas as pacientes"));
    (exec.pacientes || []).forEach(function (p) { sel.appendChild(h("option", { value: p.ref }, p.nome)); });
    sel.value = pacRef;
    renderExecucao();
    if (pacRef) await carregarPaciente();
  }

  function qtdTxt(t) { return qtdBR(t) || "0"; }
  function nomesStatus() { return (pac && pac.statusAgenda) || (exec && exec.statusAgenda) || {}; }
  function textoStatus(st) { return st ? (st.descricao || nomesStatus()[st.categoria] || st.categoria) : ""; }
  function statusAg(st) { return st ? h("span", { class: "selo selo-ag-" + st.categoria, title: nomesStatus()[st.categoria] || "" }, textoStatus(st)) : null; }
  function rotuloAgendamento(a) {
    return dataBR(a.data) + (a.hora ? " " + a.hora : "") + " · " + ({ clinicorp: "Clinicorp", agenda: "Agenda", "agenda-hist": "Agenda" }[a.tipo] || a.tipo) +
      (a.area ? " · " + a.area : "") + (a.profissional ? " · " + a.profissional : "") + " · " + textoStatus(a.status);
  }
  function barra(pct) { return h("span", { class: "barra-uso barra-plano", role: "img", "aria-label": pct + "% concluído" }, h("i", { style: "width:" + Math.max(0, Math.min(100, pct)) + "%" })); }

  function renderExecucao() {
    if (!exec) return;
    var f = limpar(el("fonteExecucao"));
    var i = estado.dados.integracao || {};
    f.appendChild(h("details", null, h("summary", null, h("span", { class: "sem-acesso" }, "Execução registrada no Alveare"), " — por quê?"),
      h("p", { class: "sub" }, exec.fonte.falta),
      h("p", { class: "sub" }, "Orçamentos, agendamentos (data, horário, profissional, situação e observação) chegam pela sincronização automática do Clinicorp" +
        (i.atualizadoEm ? " (última em " + new Date(i.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + ")" : "") +
        ". Os procedimentos de cada agendamento e o marcador não vêm pela API: entram pelo relatório de agendamentos ou na própria tela. O contador do Controle de Sessões, o campo Session e o \"executado\" do orçamento não contam como execução.")));
    f.appendChild(h("div", null, "O período considera " + (el("fxBase").value === "execucao" ? "a data em que o procedimento foi realizado." : "a data do orçamento.") +
      " Valor acordado e valor realizado vêm do orçamento; o recebido fica nas Entradas."));

    var pend = exec.pendentes || [];
    el("blocoPendentesExec").hidden = !pend.length;
    var lp = limpar(el("listaPendentesExec"));
    pend.forEach(function (e) {
      lp.appendChild(h("li", null, h("span", { class: "nome" }, e.pacienteNome + " · " + e.procedimento + " × " + qtdTxt(e.quantidade)),
        h("span", { class: "det" }, dataBR(e.agendamentoData) + " · " + (NOMES_ASSOC[e.associacao] || e.associacao)),
        h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { selecionarPaciente(e.pacienteRef); } }, "Abrir a paciente"))));
    });

    var corpo = limpar(el("tabelaOrcamentos").querySelector("tbody"));
    exec.orcamentos.forEach(function (o) {
      var t = o.totais;
      var abrir = function () { selecionarPaciente(o.pacienteRef).then(function () { abrirPlano(o.ref); }); };
      corpo.appendChild(h("tr", { class: "clicavel", tabindex: "0", onclick: abrir, onkeydown: function (ev) { if (ev.key === "Enter") abrir(); } },
        h("td", null, o.pacienteNome || "—"),
        h("td", null, (o.origem === "clinicorp" ? "Clinicorp " : "Alveare ") + o.id, h("span", { class: "sub" }, (NOMES_TIPO_DOC[o.tipo] || "") + (o.misto ? " · documento misto" : "") +
          (o.aClassificar ? " · itens a classificar" : "") + (o.procedimentosIncompletos ? " · procedimentos incompletos" : ""))),
        h("td", null, dataBR(o.data)),
        h("td", null, NOMES_SITUACAO[o.situacaoPlano] || o.situacao || "—", o.pendencias ? h("span", { class: "sub desatualizado" }, o.pendencias + " pendência(s)") : null),
        h("td", { class: "dir" }, qtdTxt(t.orcada)),
        h("td", { class: "dir" }, qtdTxt(t.agendada)),
        h("td", { class: "dir" }, qtdTxt(t.cumprida), Number(t.excedente) > 0 ? h("span", { class: "sub desatualizado" }, "+" + qtdTxt(t.excedente) + " excedente") : null),
        h("td", { class: "dir" }, qtdTxt(t.restante)),
        h("td", { class: "dir" }, t.valorAcordado === null ? h("span", { class: "sub" }, "não informado") : brl(t.valorAcordado))));
    });
    el("vazioOrcamentos").hidden = exec.orcamentos.length > 0;

    var ls = limpar(el("listaSemOrcamento"));
    var sem = (exec.semOrcamento || []).filter(function (e) { return e.associacao !== "ambigua" && e.associacao !== "sugerida"; });
    if (!sem.length) ls.appendChild(h("li", { class: "det" }, "Nenhum."));
    sem.forEach(function (e) {
      ls.appendChild(h("li", null, h("span", { class: "nome" }, e.pacienteNome + " · " + e.procedimento + " × " + qtdTxt(e.quantidade)),
        h("span", { class: "det" }, dataBR(e.agendamentoData) + " · " + (e.natureza === "avulso" ? "avulso confirmado" : e.natureza === "gratuito" ? "bônus sem plano" : "a decidir") +
          (e.conta ? "" : " · não conta (agendamento cancelado/falta)")),
        h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { selecionarPaciente(e.pacienteRef); } }, "Abrir a paciente"))));
    });
    var dl = limpar(el("listaProcedimentos"));
    var vistos = {};
    exec.orcamentos.forEach(function (o) { o.itens.forEach(function (it) { if (!vistos[it.procedimento]) { vistos[it.procedimento] = true; dl.appendChild(h("option", { value: it.procedimento })); } }); });
  }

  /* ---------- a paciente ---------- */

  async function selecionarPaciente(ref) {
    pacRef = ref || "";
    el("fxPaciente").value = pacRef;
    if (!pacRef) { pac = null; renderPaciente(); return; }
    await carregarPaciente();
  }

  async function carregarPaciente() {
    if (!pacRef) return;
    var r = await ler("financeiro.pacientePlanos", { pacienteRef: pacRef });
    if (!r.ok) { el("fxPacienteNota").textContent = "Não foi possível carregar a paciente. " + FloreSerAuth.recado(r); return; }
    pac = r.dados;
    renderPaciente();
    if (planoAberto && el("dlgOrcamento").open) abrirPlano(planoAberto.ref);
  }

  function itemDocumento(d) {
    var abrir = function () { abrirPlano(d.ref); };
    var detalhe = [NOMES_TIPO_DOC[d.tipo] || d.tipo, (d.origem === "clinicorp" ? "Clinicorp " : "Alveare ") + d.id, "início " + dataBR(d.inicio)];
    if (d.misto) detalhe.push("documento misto");
    if (d.aClassificar) detalhe.push("itens a classificar");
    return h("li", { class: "item-plano clicavel", tabindex: "0", onclick: abrir, onkeydown: function (ev) { if (ev.key === "Enter") abrir(); } },
      h("span", { class: "nome" }, d.resumoItens.join(" · ") || "Sem itens"),
      h("span", { class: "det" }, detalhe.join(" · ")),
      d.tipo === "plano" ? h("span", { class: "progresso-plano" }, barra(d.progresso),
        h("span", { class: "det" }, qtdTxt(d.cumpridas) + " de " + qtdTxt(d.contratadas) + " (" + d.progresso + "%) · " + (NOMES_SITUACAO[d.situacao] || d.situacao) +
          (Number(d.restante) > 0 ? " · " + qtdTxt(d.restante) + " a realizar" : ""))) : null,
      d.pendencias ? h("span", { class: "selo selo-vencida" }, d.pendencias + " pendência(s)") : null);
  }

  function renderPaciente() {
    var mostrar = !!(pac && pacRef);
    el("fichaPaciente").hidden = !mostrar;
    el("visaoGeralExec").hidden = mostrar;
    el("fxPacienteNota").textContent = mostrar ? "" : "Escolha uma paciente para ver os planos, o que ela já recebeu e o que ainda pode agendar.";
    if (!mostrar) return;
    el("fpNome").textContent = pac.paciente.nome || "Paciente";
    var planos = pac.documentos.filter(function (d) { return d.tipo === "plano"; });
    var andamento = planos.filter(function (d) { return d.situacao === "andamento"; });
    var finalizados = planos.filter(function (d) { return d.situacao !== "andamento"; });
    var outros = pac.documentos.filter(function (d) { return d.tipo !== "plano"; });
    var conferir = pac.atendimentos.filter(function (a) { return a.aConfirmar || a.observacaoPendente || a.divergencia; });
    var b = pac.beneficios;
    var c = limpar(el("fpCartoes"));
    c.appendChild(cartao("Planos em andamento", String(andamento.length), finalizados.length ? finalizados.length + " finalizado(s)" : ""));
    c.appendChild(cartao("Atendimentos a conferir", String(conferir.length), "sem registro do que foi feito ou com observação a ler", { classe: conferir.length ? "alerta" : "" }));
    c.appendChild(cartao("Bônus concedidos", brl(b.bonus), b.bonusPendente ? b.bonusPendente + " com valor a conferir" : "valor de venda de referência"));
    c.appendChild(cartao("Crédito disponível", brl(Math.max(0, b.creditoSaldo)), b.credito ? brl(b.credito) + " gerado · " + brl(b.creditoUsado) + " usado" : "nenhum crédito gerado",
      { classe: b.creditoSaldo < 0 ? "alerta" : "" }));

    el("fpBlocoConferir").hidden = !conferir.length;
    var lc = limpar(el("fpConferir"));
    conferir.forEach(function (a) { lc.appendChild(itemAtendimento(a, null)); });

    var decidir = pac.pendentes;
    el("fpBlocoDecidir").hidden = !decidir.length;
    var ld = limpar(el("fpDecidir"));
    decidir.forEach(function (e) {
      ld.appendChild(h("li", null, h("span", { class: "nome" }, e.procedimento + " × " + qtdTxt(e.quantidade) + " · " + dataBR(e.agendamentoData)),
        h("span", { class: "det" }, (NOMES_ASSOC[e.associacao] || "a decidir") + (e.candidatos && e.candidatos.length ? " · " + e.candidatos.map(function (x) {
          return "plano de " + dataBR(x.planoData) + " (disponível " + qtdTxt(x.disponivel) + ")"; }).join(" ou ") : "")),
        h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirAssociar(e); } }, "Decidir"))));
    });

    var la = limpar(el("fpAndamento"));
    if (!andamento.length) la.appendChild(h("li", { class: "det" }, "Nenhum plano em andamento."));
    andamento.forEach(function (d) { la.appendChild(itemDocumento(d)); });
    el("fpBlocoOutros").hidden = !outros.length;
    var lo = limpar(el("fpOutros"));
    outros.forEach(function (d) { lo.appendChild(itemDocumento(d)); });
    el("fpBlocoFinalizados").hidden = !finalizados.length;
    var lf = limpar(el("fpFinalizados"));
    finalizados.forEach(function (d) { lf.appendChild(itemDocumento(d)); });
  }

  /* um atendimento: previsto, realizado, observação original e leitura */
  function itemAtendimento(a, plano) {
    var acoes = [];
    var validas = a.execucoes.filter(function (e) { return e.estado !== "desfeito"; });
    if (a.aConfirmar && a.previstos.length) acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { confirmarAtendimento(a); } }, "Confirmar como previsto"));
    if (a.status.categoria !== "cancelado" && a.status.categoria !== "falta") {
      acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirRegistrar({ pacienteRef: a.pacienteRef, agendamentoRef: a.ref }); } }, "Registrar o que foi feito"));
      if (plano || pac.documentos.some(function (d) { return d.tipo === "plano" && d.situacao === "andamento"; })) {
        acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirTroca({ planoRef: plano ? plano.ref : "", atendimento: a }); } }, "Troca"));
      }
    }
    acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirAtendimento(a); } }, a.observacao ? "Ler observação" : "Completar"));
    var marcas = [];
    if (a.marcador) marcas.push(h("span", { class: "selo selo-origem" }, a.marcador));
    if (a.divergencia) marcas.push(h("span", { class: "selo selo-vencida", title: "Os procedimentos da origem mudaram depois da confirmação" }, "origem mudou"));
    return h("li", { class: "atendimento", "data-ref": a.ref },
      h("span", { class: "nome" }, dataBR(a.data) + (a.hora ? " · " + a.hora : "") + (a.profissional ? " · " + a.profissional : "") + (a.area ? " · " + a.area : "")),
      h("span", { class: "det" }, statusAg(a.status), marcas,
        a.previstos.length ? " Previsto: " + a.previstos.map(function (p) { return p.descricao; }).join(", ") + (a.previstosFonte === "relatorio" ? " (relatório)" : a.previstosFonte === "alveare" ? " (completado no Alveare)" : "") : " Sem previstos da origem"),
      validas.length ? h("ul", { class: "lista-execucoes" }, validas.map(function (e) { return linhaExecucao(e, plano); })) : null,
      a.observacao ? h("span", { class: "observacao-linha" }, h("b", null, "Observação: "), "“" + a.observacao + "”",
        a.interpretacao ? h("span", { class: "selo selo-paga" }, (pac.interpretacoes || {})[a.interpretacao] || a.interpretacao) : h("span", { class: "selo selo-pendente" }, "leitura a confirmar")) : null,
      h("span", { class: "acoes" }, acoes));
  }

  async function confirmarAtendimento(a) {
    try {
      var r = await aplicar({ tipo: "exe.atendimento.confirmar", agendamentoTipo: a.tipo, agendamentoId: a.id });
      var amb = (r.execucoes || []).filter(function (x) { return x.associacao === "ambigua" || x.associacao === "sugerida" || x.associacao === "sem_orcamento"; }).length;
      toast(amb ? "Confirmado. " + amb + " procedimento(s) precisam da escolha do plano." : "Confirmado como previsto.");
      await recarregarExecucao();
    } catch (e) { erroExecucao(e); }
  }

  function erroExecucao(e) { (el("dlgOrcamento").open ? el("orcErro") : el("fxPacienteNota")).textContent = e.message; }

  async function recarregarExecucao() { await carregarExecucao(); }

  /* ---------- o plano ---------- */

  function cartaoPequeno(rot, val, det, classe) { return cartao(rot, val, det, { classe: classe || "" }); }

  function abrirPlano(ref) {
    if (!pac) return;
    var p = pac.planos.filter(function (x) { return x.ref === ref; })[0];
    if (!p) return;
    planoAberto = p;
    var r = p.resumo;
    el("orcTitulo").textContent = (NOMES_TIPO_DOC[p.tipo.tipo] || "Plano") + " · " + (p.pacienteNome || pac.paciente.nome) + " · " + (p.origem === "clinicorp" ? "Clinicorp " : "Alveare ") + p.id;
    el("orcOrigem").textContent = (p.origem === "clinicorp" ? "Itens e valores vêm do Clinicorp (só leitura aqui); o que foi realizado vem dos registros por atendimento." : "Orçamento do Alveare.") +
      (p.situacaoOrigem ? " Situação na origem: " + p.situacaoOrigem + "." : "") + (p.tipo.misto ? " Documento misto: só os itens de tratamento entram no progresso." : "") +
      " Pagamento, passagem do tempo ou um orçamento novo não encerram este plano.";
    var c = limpar(el("orcCartoes"));
    c.appendChild(cartaoPequeno("Início", dataBR(r.inicio), "primeiro atendimento " + (r.primeiroAtendimento ? dataBR(r.primeiroAtendimento) : "ainda não houve")));
    c.appendChild(cartaoPequeno("Situação", NOMES_SITUACAO[r.situacao] || r.situacao, r.pendencias ? r.pendencias + " pendência(s)" : "sem pendências", r.pendencias ? "alerta" : ""));
    c.appendChild(cartaoPequeno("Atendimentos", String(r.atendimentos), qtdTxt(r.procedimentos) + " procedimento(s) entregue(s)"));
    c.appendChild(cartao("Progresso", qtdTxt(r.cumpridas) + "/" + qtdTxt(r.contratadas), r.progresso + "% das unidades contratadas · " + qtdTxt(r.restante) + " restante(s)" +
      (Number(r.excedente) > 0 ? " · " + qtdTxt(r.excedente) + " excedente" : ""), { extra: barra(r.progresso) }));
    var lp = limpar(el("orcPendencias"));
    p.pendencias.forEach(function (x) {
      var acao = null;
      if (x.tipo === "associacao") {
        var e = pac.pendentes.filter(function (y) { return y.id === x.execucaoId; })[0];
        if (e) acao = h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirAssociar(e); } }, "Decidir");
      }
      if (x.tipo === "observacao") {
        var a = p.historico.filter(function (y) { return y.ref === x.agendamentoRef; })[0];
        if (a) acao = h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirAtendimento(a); } }, "Ler observação");
      }
      lp.appendChild(h("li", null, h("span", { class: "det" }, x.texto), acao ? h("span", { class: "acoes" }, acao) : null));
    });

    var ld = limpar(el("orcDisponiveis"));
    if (!p.disponiveis.length) ld.appendChild(h("li", { class: "det" }, r.situacao === "concluido" ? "Plano concluído: nada a agendar." : "Nada livre para agendar agora."));
    p.disponiveis.forEach(function (x) {
      ld.appendChild(h("li", null, h("b", null, qtdTxt(x.quantidade) + "× " + x.procedimento),
        x.porTroca ? h("span", { class: "det" }, " — por troca de " + x.origem) : null, x.aConferir ? h("span", { class: "det desatualizado" }, " — quantidade a conferir") : null));
    });

    var tb = limpar(el("orcItens").querySelector("tbody"));
    p.linhas.forEach(function (l) { tb.appendChild(linhaContratada(p, l)); });
    var dr = limpar(el("orcDireitos"));
    var trocasAtivas = p.trocas.filter(function (t) { return t.ativa; });
    if (trocasAtivas.length) {
      dr.appendChild(h("h4", { class: "sub-titulo" }, "Direitos por troca"));
      dr.appendChild(h("div", { class: "tabela-rolagem" }, h("table", { class: "tabela tabela-compacta" },
        h("thead", null, h("tr", null, h("th", null, "Troca"), h("th", { class: "dir" }, "Prometido"), h("th", { class: "dir" }, "Entregue"), h("th", { class: "dir" }, "Disponível"))),
        h("tbody", null, trocasAtivas.map(function (t) {
          return h("tr", null, h("td", null, qtdTxt(t.quantidadeOrigem) + " " + t.procedimentoOrigem + " → " + t.procedimentoSubstituto, h("span", { class: "sub" }, "registrada em " + dataBR(t.data))),
            h("td", { class: "dir" }, qtdTxt(t.quantidadePrometida)), h("td", { class: "dir" }, qtdTxt(t.entregue)), h("td", { class: "dir" }, h("b", null, qtdTxt(t.restante))));
        })))));
    }
    var dout = limpar(el("orcOutros"));
    if (p.outrosItens.length || p.foraDaAprovacao.length) {
      dout.appendChild(h("h4", { class: "sub-titulo" }, "Outros itens do documento (fora do progresso)"));
      var ul = h("ul", { class: "lista lista-compacta" });
      p.outrosItens.forEach(function (l) {
        ul.appendChild(h("li", null, h("span", { class: "nome" }, qtdTxt(l.contratado) + "× " + l.procedimento), h("span", { class: "det" }, (pac.classes[l.classe] || "a classificar")), seletorClasse(p, l)));
      });
      p.foraDaAprovacao.forEach(function (x) { ul.appendChild(h("li", null, h("span", { class: "nome" }, x.procedimento), h("span", { class: "det" }, x.motivo))); });
      dout.appendChild(ul);
    }

    var areas = {};
    p.historico.forEach(function (a) { if (a.area) areas[a.area] = true; });
    var segs = limpar(el("orcAreas"));
    var lista = Object.keys(areas);
    if (lista.length > 1) {
      [""].concat(lista).forEach(function (ar) {
        segs.appendChild(h("button", { type: "button", "aria-pressed": areaPlano === ar ? "true" : "false", onclick: function () { areaPlano = ar; abrirPlano(p.ref); } }, ar || "Todas"));
      });
    } else areaPlano = "";
    var hist = limpar(el("orcHistorico"));
    var vis = p.historico.filter(function (a) { return !areaPlano || a.area === areaPlano; });
    if (!vis.length) hist.appendChild(h("li", { class: "det" }, "Nenhum atendimento ligado a este plano ainda."));
    vis.forEach(function (a) { hist.appendChild(itemAtendimento(a, p)); });

    renderBeneficios(p);
    el("orcEditar").hidden = p.origem !== "local";
    el("orcTroca").hidden = !p.linhas.some(function (l) { return Number(l.disponivel) > 0; });
    el("orcErro").textContent = "";
    if (!el("dlgOrcamento").open) el("dlgOrcamento").showModal();
  }

  function seletorClasse(p, l) {
    var s = h("select", { class: "input input-mini", "aria-label": "Classe de " + l.procedimento });
    s.appendChild(h("option", { value: "" }, "classificar…"));
    Object.keys(pac.classes).forEach(function (k) { s.appendChild(h("option", { value: k }, pac.classes[k])); });
    s.value = l.classe || "";
    s.addEventListener("change", async function () {
      if (!s.value) return;
      var todos = !!l.procedimentoRef && window.confirm("Usar esta classe para todos os itens com o procedimento " + l.procedimento + " (código " + l.procedimentoRef + ")?\n\nOK: todos · Cancelar: só este item");
      try {
        await aplicar({ tipo: "exe.conferencia", dados: { tipo: "classe", alvo: todos ? "ref:" + l.procedimentoRef : "item:" + l.ref, valor: s.value } });
        toast("Classificado.");
        await recarregarExecucao();
      } catch (e) { erroExecucao(e); }
    });
    return s;
  }

  function linhaContratada(p, l) {
    var subs = [];
    if (l.procedimentoRef) subs.push("código " + l.procedimentoRef);
    subs.push({ orcamento: "quantidade do orçamento", linhas: l.linhasNaOrigem + " linha(s) na origem", conferida: "quantidade conferida" }[l.contratadoFonte] || "");
    if (!l.classe) subs.push("classe a confirmar");
    if (l.executadoNoClinicorp) subs.push("Clinicorp marca executado (só conferência)");
    var acoes = [h("button", { type: "button", class: "btn btn-quiet", onclick: function () { conferirQuantidade(p, l); } }, l.aConferir ? "Conferir quantidade" : "Quantidade")];
    if (Number(l.disponivel) > 0) acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirTroca({ planoRef: p.ref, linhaChave: l.chave }); } }, "Trocar"));
    return h("tr", null,
      h("td", null, l.procedimento, h("span", { class: "sub" }, subs.filter(Boolean).join(" · ")), !l.classe ? seletorClasse(p, l) : null),
      h("td", { class: "dir" }, qtdTxt(l.contratado), l.aConferir ? h("span", { class: "sub desatualizado" }, "a conferir (texto diz " + qtdTxt(l.sugestao) + ")") : null),
      h("td", { class: "dir" }, qtdTxt(l.realizada)),
      h("td", { class: "dir" }, Number(l.substituida) ? qtdTxt(l.substituida) : "—"),
      h("td", { class: "dir" }, Number(l.comprometida) ? qtdTxt(l.comprometida) : "—"),
      h("td", { class: "dir" }, h("b", null, qtdTxt(l.disponivel))),
      h("td", { class: "dir" }, Number(l.excedente) ? h("span", { class: "desatualizado" }, "+" + qtdTxt(l.excedente)) : "—"),
      h("td", null, h("span", { class: "acoes" }, acoes)));
  }

  async function conferirQuantidade(p, l) {
    var q = window.prompt("Quantidade contratada de " + l.procedimento + " neste plano" + (l.sugestao ? " (o texto da origem sugere " + qtdTxt(l.sugestao) + ")" : "") + ":",
      qtdTxt(l.sugestao || l.contratado));
    if (!q) return;
    var m = window.prompt("Como foi conferido? (fica no histórico)", "");
    if (m === null) return;
    try {
      await aplicar({ tipo: "exe.conferencia", dados: { tipo: "quantidade", alvo: p.ref + "|" + l.chave, valor: q.trim(), motivo: m } });
      toast("Quantidade conferida.");
      await recarregarExecucao();
    } catch (e) { erroExecucao(e); }
  }

  function custoTxt(v, parcial) { return v === null || v === undefined ? h("span", { class: "sub" }, "não informado") : brl(v) + (parcial ? " (parcial)" : ""); }

  function irParaAtendimento(ref) {
    var li = el("orcHistorico").querySelector('[data-ref="' + ref + '"]');
    if (li) { li.scrollIntoView({ behavior: "smooth", block: "center" }); li.classList.add("realce"); setTimeout(function () { li.classList.remove("realce"); }, 1800); }
  }

  function renderBeneficios(p) {
    var b = p.beneficios;
    var c = limpar(el("orcBenefCartoes"));
    c.appendChild(cartao("Bônus (valor de venda)", brl(b.bonus), b.bonusPendente ? b.bonusPendente + " a conferir" : "dispensado pela clínica"));
    c.appendChild(cartao("Custo das entregas", !b.custoEntregueConhecido ? (b.custoParcial ? "não informado" : brl(0)) : brl(b.custoEntregue) + (b.custoParcial ? "*" : ""),
      b.custoParcial ? (b.custoEntregueConhecido ? "* parcial: há custo não informado" : "sem ficha de custo") : "custo interno"));
    c.appendChild(cartao("Custo adicional das trocas", !b.custoAdicionalConhecido && b.custoParcial ? "não informado" : brl(b.custoAdicional) + (b.custoParcial && b.custoAdicionalConhecido ? "*" : ""),
      "em relação ao que seria feito"));
    c.appendChild(cartao("Crédito", brl(Math.max(0, b.creditoSaldo)), brl(b.credito) + " gerado · " + brl(b.creditoUsado) + " usado", { classe: b.creditoSaldo < 0 ? "alerta" : "" }));
    var dt = limpar(el("orcTrocas"));
    if (p.trocas.length) {
      dt.appendChild(h("h4", { class: "sub-titulo" }, "Trocas"));
      var ul = h("ul", { class: "lista" });
      p.trocas.forEach(function (t) {
        var v = t.valores;
        var acoes = [];
        if (t.agendamentoRef) acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { irParaAtendimento(t.agendamentoRef); } }, "Ver atendimento"));
        if (t.ativa && t.creditoSaldo > 0) acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirCredito(p, t); } }, "Usar crédito"));
        if (t.ativa) acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { desfazerTroca(t); } }, "Desfazer"));
        ul.appendChild(h("li", { class: t.ativa ? "" : "desfeita" },
          h("span", { class: "nome" }, qtdTxt(t.quantidadeOrigem) + " " + t.procedimentoOrigem + " → " + qtdTxt(t.quantidadePrometida) + " " + t.procedimentoSubstituto +
            (t.ativa ? "" : " (desfeita: " + (t.motivo || "") + ")")),
          h("span", { class: "det" }, dataBR(t.data) + " · entregue " + qtdTxt(t.entregue) + " de " + qtdTxt(t.quantidadePrometida) +
            " · referência " + (v.valorOrigem === null ? "a conferir" : brl(v.valorOrigem)) + " → " + (v.valorSubstituto === null ? "a conferir" : brl(v.valorSubstituto)) +
            (v.cobrado ? " · cobrado " + brl(v.cobrado) : "")),
          h("span", { class: "det" }, v.pendente ? h("b", { class: "desatualizado" }, "Bônus/crédito a conferir (falta valor de referência)") :
            [v.bonus ? "Bônus " + brl(v.bonus) : null, v.credito ? "Crédito " + brl(v.credito) + " (usado " + brl(t.creditoUsado) + ", saldo " + brl(t.creditoSaldo) + ")" : null,
              !v.bonus && !v.credito ? "Sem diferença de valor" : null].filter(Boolean).join(" · "),
            " · custo da entrega ", custoTxt(v.custoEntregue), " · custo adicional ", custoTxt(v.custoAdicional)),
          h("span", { class: "sub" }, t.basePreco + (t.baseCusto ? " · custos: " + t.baseCusto : "")),
          t.usos.length ? h("ul", { class: "lista lista-compacta" }, t.usos.map(function (u) {
            return h("li", { class: u.estado === "estornado" ? "desfeita" : "" }, h("span", { class: "det" }, dataBR(u.data) + " · " + brl(u.valor) + " → " +
              (u.destinoRef ? "plano " + u.destinoRef.split(":").pop() : u.destinoDescricao) + (u.estado === "estornado" ? " · estornado: " + u.motivo : "") + " · " + u.autorNome),
              u.estado !== "estornado" ? h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { estornarCredito(u); } }, "Estornar")) : null);
          })) : null,
          h("span", { class: "acoes" }, acoes)));
      });
      dt.appendChild(ul);
    }
    var dg = limpar(el("orcGratuitos"));
    if (p.gratuitos.length) {
      dg.appendChild(h("h4", { class: "sub-titulo" }, "Bônus: adicionais gratuitos"));
      dg.appendChild(h("ul", { class: "lista" }, p.gratuitos.map(function (g) {
        return h("li", null, h("span", { class: "nome" }, qtdTxt(g.quantidade) + "× " + g.procedimento + " · " + dataBR(g.data)),
          h("span", { class: "det" }, "Bônus " + (g.bonus === null ? "a conferir" : brl(g.bonus)) + " · custo ", custoTxt(g.custo), g.baseReferencia ? " · " + g.baseReferencia : ""),
          h("span", { class: "acoes" }, h("button", { type: "button", class: "btn btn-quiet", onclick: function () { irParaAtendimento(g.agendamentoRef); } }, "Ver atendimento")));
      })));
    }
  }

  async function desfazerTroca(t) {
    var m = window.prompt("Desfazer a troca " + t.procedimentoOrigem + " → " + t.procedimentoSubstituto + "? A unidade original volta ao saldo, o bônus/crédito sai da apuração e as entregas voltam a pedir decisão. Motivo:", "");
    if (!m) return;
    try { await aplicar({ tipo: "exe.troca.desfazer", id: t.id, revBase: t._rev, motivo: m }); toast("Troca desfeita."); await recarregarExecucao(); }
    catch (e) { erroExecucao(e); }
  }

  async function estornarCredito(u) {
    var m = window.prompt("Estornar este uso de crédito? O valor volta ao saldo. Motivo:", "");
    if (!m) return;
    try { await aplicar({ tipo: "exe.credito.estornar", id: u.id, revBase: u._rev, motivo: m }); toast("Uso estornado."); await recarregarExecucao(); }
    catch (e) { erroExecucao(e); }
  }

  /* ---------- execuções ---------- */

  function linhaExecucao(e, plano) {
    var acoes = [];
    if (e.estado === "previsto") acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { alterarExecucao(e, { estado: "realizado" }, "Marcado como realizado."); } }, "Realizado"));
    if (e.estado !== "desfeito") {
      acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () {
        var q = window.prompt("Quantidade realizada neste atendimento:", qtdBR(e.quantidade));
        if (!q) return;
        var m = e.estado === "realizado" ? window.prompt("Motivo da correção (fica no histórico):", "") : "";
        if (m === null) return;
        alterarExecucao(e, { quantidade: q, motivo: m }, "Quantidade corrigida.");
      } }, "Quantidade"));
      acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { abrirAssociar(e); } }, "Plano / natureza"));
      acoes.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () {
        var m = window.prompt("Desfazer este registro? Ele continua no histórico e deixa de contar. Motivo:", "");
        if (m) alterarExecucao(e, { estado: "desfeito", motivo: m }, "Registro desfeito.");
      } }, "Desfazer"));
    }
    var nat = { contratado: "conforme o plano", substituicao: "em substituição", gratuito: "bônus", avulso: "avulso" }[e.natureza] || "a decidir";
    var troca = e.trocaId && plano ? plano.trocas.filter(function (t) { return t.id === e.trocaId; })[0] : null;
    return h("li", { class: e.estado === "desfeito" ? "desfeita" : "" },
      h("span", { class: "nome" }, e.procedimento + " × " + qtdTxt(e.quantidade) + (troca ? " — em substituição a " + qtdTxt(troca.quantidadeOrigem) + " " + troca.procedimentoOrigem : "")),
      h("span", { class: "det" }, h("span", { class: "selo selo-nat-" + (e.natureza || "pendente") }, nat), " ", { previsto: "previsto", realizado: "realizado", desfeito: "desfeito" }[e.estado],
        e.conta || e.estado !== "realizado" ? "" : " · não conta (agendamento " + (e.agendamentoStatus ? textoStatus(e.agendamentoStatus) : "desconhecido") + ")",
        e.natureza === "contratado" || !e.natureza ? " · " + (NOMES_ASSOC[e.associacao] || "") : "", e.origem === "importacao" ? " · relatório importado" : e.origem === "confirmacao" ? " · confirmado como previsto" : ""),
      h("span", { class: "acoes" }, acoes));
  }

  async function alterarExecucao(e, campos, msg) {
    try {
      await aplicar({ tipo: "exe.alterar", id: e.id, revBase: e._rev, campos: campos });
      toast(msg);
      await recarregarExecucao();
    } catch (err) { erroExecucao(err); }
  }

  function preencherPacientes(sel, valor) {
    limpar(sel);
    sel.appendChild(h("option", { value: "" }, "Escolha a paciente"));
    (exec.pacientes || []).forEach(function (p) { sel.appendChild(h("option", { value: p.ref }, p.nome)); });
    sel.value = valor || "";
  }

  /* linhas de tratamento dos planos da paciente (da ficha, se aberta) */
  function itensDaPaciente(ref) {
    var lista = [];
    if (pac && pac.paciente.ref === ref) {
      pac.planos.forEach(function (p) {
        if (p.tipo.tipo !== "plano") return;
        p.linhas.forEach(function (l) { lista.push({ ref: l.ref, nome: l.procedimento + " · plano " + p.id + " de " + dataBR(p.data) + " (disponível " + qtdTxt(l.disponivel) + ")" +
          (p.resumo.situacao !== "andamento" ? " · " + (NOMES_SITUACAO[p.resumo.situacao] || "") : ""), it: l, plano: p }); });
      });
      return lista;
    }
    exec.orcamentos.forEach(function (o) {
      if (o.pacienteRef !== ref) return;
      o.itens.forEach(function (it) { lista.push({ ref: it.ref, nome: it.procedimento + " · orçamento " + o.id + " de " + dataBR(o.data) + " (disponível " + qtdTxt(it.disponivel) + ")", it: it }); });
    });
    return lista;
  }

  function agendamentosDaPaciente(ref) {
    var mapa = {};
    exec.agendamentos.filter(function (a) { return a.pacienteRef === ref; }).forEach(function (a) { mapa[a.ref] = a; });
    if (pac && pac.paciente.ref === ref) pac.atendimentos.forEach(function (a) { mapa[a.ref] = a; });
    return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return String(b.data + b.hora).localeCompare(String(a.data + a.hora)); });
  }

  function atualizarAgendamentos(preAg) {
    var ref = el("exPaciente").value;
    var sel = limpar(el("exAgendamento"));
    sel.appendChild(h("option", { value: "" }, ref ? "Escolha o agendamento" : "Escolha a paciente antes"));
    agendamentosDaPaciente(ref).forEach(function (a) {
      sel.appendChild(h("option", { value: a.ref, disabled: a.status.categoria === "cancelado" || a.status.categoria === "falta" ? true : null },
        rotuloAgendamento(a) + (a.execucoes && a.execucoes.length ? " · " + a.execucoes.length + " procedimento(s)" : "")));
    });
    if (preAg) sel.value = preAg;
    var it = limpar(el("exItem"));
    it.appendChild(h("option", { value: "" }, "Decidir pelo código (só quando não há dúvida)"));
    itensDaPaciente(ref).forEach(function (x) { it.appendChild(h("option", { value: x.ref }, x.nome)); });
    var tr = limpar(el("exTroca"));
    tr.appendChild(h("option", { value: "" }, "Escolha a troca"));
    if (pac && pac.paciente.ref === ref) {
      pac.planos.forEach(function (p) { p.trocas.forEach(function (t) {
        if (t.ativa && Number(t.restante) > 0) tr.appendChild(h("option", { value: t.id }, t.procedimentoSubstituto + " (faltam " + qtdTxt(t.restante) + ") · troca de " + t.procedimentoOrigem));
      }); });
    }
  }

  function atualizarNatureza() {
    var n = el("exNatureza").value;
    el("exRefCampo").hidden = n !== "gratuito";
    el("exTrocaCampo").hidden = n !== "troca";
    el("exItem").disabled = n === "gratuito" || n === "avulso" || n === "troca";
  }

  async function abrirRegistrar(pre) {
    if (!exec) await carregarExecucao();
    var p = pre || {};
    preencherPacientes(el("exPaciente"), p.pacienteRef || pacRef || "");
    atualizarAgendamentos(p.agendamentoRef || "");
    el("exNatureza").value = p.natureza || ""; el("exValorRef").value = "";
    atualizarNatureza();
    el("exProcedimento").value = p.procedimento || ""; el("exQtd").value = "1"; el("exEstado").value = "realizado"; el("exNotas").value = ""; el("exErro").textContent = "";
    el("dlgExecucao").showModal();
  }

  function abrirAssociar(e) {
    exAssociar = e;
    var pendente = !e.natureza;
    el("assocResumo").textContent = (e.pacienteNome || "") + " · " + e.procedimento + " × " + qtdTxt(e.quantidade) + " em " + dataBR(e.agendamentoData) + ". " +
      (pendente ? "Hoje: a decidir (" + (NOMES_ASSOC[e.associacao] || "sem plano") + ")." : "Hoje: " + ({ contratado: "conforme o plano", substituicao: "em substituição", gratuito: "bônus", avulso: "avulso" }[e.natureza] || "") + ".");
    var sel = limpar(el("assocItem"));
    var cands = (e.candidatos || []);
    var vistos = {};
    if (cands.length) {
      var g = h("optgroup", { label: "Planos com este procedimento" });
      cands.forEach(function (x) {
        vistos[x.itemRef] = true;
        g.appendChild(h("option", { value: "item:" + x.itemRef }, x.procedimento + " · plano de " + dataBR(x.planoData) + " · disponível " + qtdTxt(x.disponivel) + " de " + qtdTxt(x.contratado) +
          (e.sugestao === x.itemRef ? " · escolhido antes para este procedimento" : "")));
      });
      sel.appendChild(g);
    }
    var outros = itensDaPaciente(e.pacienteRef).filter(function (x) { return !vistos[x.ref]; });
    if (outros.length) {
      var g2 = h("optgroup", { label: "Outros itens dos planos" });
      outros.forEach(function (x) { g2.appendChild(h("option", { value: "item:" + x.ref }, x.nome)); });
      sel.appendChild(g2);
    }
    var g3 = h("optgroup", { label: "Fora de plano" });
    g3.appendChild(h("option", { value: "avulso" }, "Avulso confirmado (não pertence a plano)"));
    g3.appendChild(h("option", { value: "gratuito" }, "Bônus: adicional gratuito"));
    g3.appendChild(h("option", { value: "pendente" }, "Ainda a decidir"));
    sel.appendChild(g3);
    sel.value = e.itemRef ? "item:" + e.itemRef : e.natureza === "avulso" ? "avulso" : e.natureza === "gratuito" ? "gratuito" : (e.sugestao && vistos[e.sugestao] ? "item:" + e.sugestao : "pendente");
    el("assocMotivo").value = "";
    el("assocErro").textContent = "";
    el("dlgAssociar").showModal();
  }

  /* ---------- troca ---------- */

  function abrirTroca(ctx) {
    if (!pac) return;
    var planos = pac.planos.filter(function (p) { return p.tipo.tipo === "plano" && p.resumo.situacao !== "cancelado"; });
    var p = ctx.planoRef ? planos.filter(function (x) { return x.ref === ctx.planoRef; })[0] : null;
    var a = ctx.atendimento || null;
    /* origem: linhas com saldo livre (de um plano, ou de todos os da paciente) */
    var linhas = [];
    (p ? [p] : planos).forEach(function (pl) {
      pl.linhas.forEach(function (l) {
        var origemExe = a ? a.execucoes.filter(function (e) { return e.estado === "realizado" && e.itemRef && l.refs.indexOf(e.itemRef) >= 0; })[0] : null;
        if (Number(l.disponivel) > 0 || origemExe) linhas.push({ plano: pl, linha: l, execucao: origemExe });
      });
    });
    if (!linhas.length) { erroExecucao(new Error("Não há unidade livre em plano em andamento para trocar.")); return; }
    trocaCtx = { atendimento: a, linhas: linhas };
    el("trTitulo").textContent = "Registrar troca";
    el("trContexto").textContent = a ? "Atendimento de " + dataBR(a.data) + (a.observacao ? " · observação original: “" + a.observacao + "”" : "") +
      ". A troca é registrada uma vez; cada entrega fica no atendimento em que aconteceu." : "A troca é registrada uma vez; as entregas são registradas nos atendimentos em que acontecerem.";
    var sel = limpar(el("trLinha"));
    linhas.forEach(function (x, k) {
      sel.appendChild(h("option", { value: String(k) }, x.linha.procedimento + " · plano " + x.plano.id + " (livre " + qtdTxt(x.linha.disponivel) + ")" +
        (x.execucao ? " · registrado neste atendimento" : "")));
    });
    if (ctx.linhaChave) linhas.forEach(function (x, k) { if (x.linha.chave === ctx.linhaChave && (!p || x.plano.ref === p.ref)) sel.value = String(k); });
    var fs = limpar(el("trFicha"));
    fs.appendChild(h("option", { value: "" }, "sem ficha"));
    estado.dados.fichas.filter(function (f) { return !f.arquivada && f.tipo !== "produto"; }).forEach(function (f) { fs.appendChild(h("option", { value: f.id }, f.nome)); });
    el("trQtdOrigem").value = "1"; el("trQtdPrometida").value = "1"; el("trSubstituto").value = ""; el("trCobrado").value = ""; el("trPrecoSubst").value = "";
    el("trData").value = a ? a.data : hoje(); el("trMotivo").value = ""; el("trEntrega").value = "1";
    el("trEntregaCampo").hidden = !a;
    el("trErro").textContent = "";
    atualizarLinhaTroca();
    el("dlgTroca").showModal();
  }

  function atualizarLinhaTroca() {
    var x = trocaCtx.linhas[Number(el("trLinha").value) || 0];
    el("trPrecoOrigem").value = x && x.linha.precoRef !== null && x.linha.precoRef !== undefined ? numBR(x.linha.precoRef) : "";
    el("trPrecoOrigem").placeholder = x && x.linha.precoRef === null ? "sem referência (a conferir)" : "";
    el("trSubstituirCampo").hidden = !(x && x.execucao);
    el("trSubstituir").checked = !!(x && x.execucao);
    if (x && x.execucao) el("trSubstituirNome").textContent = x.execucao.procedimento;
    previaTroca();
  }

  function previaTroca() {
    var alvo = limpar(el("trPrevia"));
    var qo = numeroDigitado(el("trQtdOrigem").value), qs = numeroDigitado(el("trQtdPrometida").value);
    var po = centavosDe(el("trPrecoOrigem").value), ps = centavosDe(el("trPrecoSubst").value);
    var cob = centavosDe(el("trCobrado").value) || 0;
    var dl = h("dl");
    if (po === null || ps === null || isNaN(po) || isNaN(ps)) linhaDl(dl, "Bônus / crédito", "a conferir (o servidor completa com a referência, se houver)");
    else {
      var dif = Math.round(ps * qs) - Math.round(po * qo);
      if (dif > 0) linhaDl(dl, "Bônus (prévia)", brl(Math.max(0, dif - cob)) + (cob ? " (diferença " + brl(dif) + " − cobrado " + brl(cob) + ")" : ""));
      else if (dif < 0) linhaDl(dl, "Crédito para a paciente (prévia)", brl(-dif));
      else linhaDl(dl, "Diferença", "nenhuma");
    }
    alvo.appendChild(dl);
  }

  /* ---------- atendimento: observação e complemento ---------- */

  function abrirAtendimento(a) {
    atendCtx = a;
    el("atTitulo").textContent = "Atendimento de " + dataBR(a.data) + (a.hora ? " · " + a.hora : "");
    var ob = limpar(el("atObservacao"));
    ob.appendChild(h("p", null, h("b", null, "Observação original: "), a.observacao ? "“" + a.observacao + "”" : "nenhuma",
      a.observacaoFonte ? h("span", { class: "sub" }, " (" + ({ clinicorp: "do Clinicorp", relatorio: "do relatório", alveare: "escrita no Alveare" }[a.observacaoFonte] || a.observacaoFonte) + ")") : null));
    if (a.observacaoComplemento) ob.appendChild(h("p", { class: "sub" }, "Relatório/complemento diz: “" + a.observacaoComplemento + "”"));
    if (a.interpretacao && a.observacaoInterpretada && a.observacaoInterpretada !== a.observacao) ob.appendChild(h("p", { class: "sub desatualizado" }, "A observação mudou depois da última leitura (era “" + a.observacaoInterpretada + "”)."));
    document.querySelectorAll('input[name="atInterp"]').forEach(function (r) { r.checked = r.value === a.interpretacao; r.disabled = !a.observacao; });
    el("atPrevistos").value = a.previstosFonte === "clinicorp" ? "" : a.previstos.map(function (p) { return p.descricao; }).join(", ");
    el("atPrevistos").placeholder = a.previstosFonte === "clinicorp" ? "a origem já traz: " + a.previstos.map(function (p) { return p.descricao; }).join(", ") : "";
    el("atMarcador").value = a.marcador || ""; el("atProfissional").value = a.previstosFonte === "clinicorp" ? "" : (a.profissional || "");
    el("atLiberar").checked = !!a.observacaoLiberada; el("atNotas").value = a.notas || "";
    el("atErro").textContent = "";
    el("dlgAtendimento").showModal();
  }

  /* ---------- crédito ---------- */

  function abrirCredito(p, t) {
    credCtx = t;
    el("crResumo").textContent = "Crédito da troca " + t.procedimentoOrigem + " → " + t.procedimentoSubstituto + " (" + dataBR(t.data) + "): gerado " + brl(t.valores.credito) +
      ", usado " + brl(t.creditoUsado) + ", saldo " + brl(t.creditoSaldo) + ".";
    el("crValor").value = ""; el("crData").value = hoje(); el("crDescricao").value = ""; el("crMotivo").value = "";
    var s = limpar(el("crDestino"));
    s.appendChild(h("option", { value: "" }, "Nenhum plano (descreva abaixo)"));
    pac.planos.filter(function (x) { return x.tipo.tipo === "plano"; }).forEach(function (x) { s.appendChild(h("option", { value: x.ref }, "Plano " + x.id + " de " + dataBR(x.data) + (x.ref === p.ref ? " (este)" : ""))); });
    el("crErro").textContent = "";
    el("dlgCredito").showModal();
  }

  /* ---------- versão para a paciente ---------- */

  async function abrirImpressao() {
    var r = await ler("financeiro.pacientePlanos", { pacienteRef: pacRef, versao: "paciente" });
    if (!r.ok) { erroExecucao(new Error("Não foi possível montar a versão para a paciente. " + FloreSerAuth.recado(r))); return; }
    var d = r.dados;
    var alvo = limpar(el("impConteudo"));
    var tot = { at: 0, proc: 0 };
    d.planos.forEach(function (p) { tot.at += p.atendimentos; tot.proc += Number(p.procedimentos) || 0; });
    alvo.appendChild(h("header", { class: "rel-capa" }, h("p", { class: "rel-marca" }, "FloreSer · Corpo e Alma"), h("h2", null, "Histórico de Tratamentos"),
      h("p", { class: "rel-nome" }, d.paciente.nome), h("p", { class: "rel-emitido" }, "Emitido em " + dataBR(d.emitidoEm))));
    if (!d.planos.length) alvo.appendChild(h("p", null, "Nenhum plano de tratamento."));
    d.planos.forEach(function (p) {
      var s = h("section", { class: "rel-plano" });
      s.appendChild(h("h3", null, "Plano iniciado em " + dataBR(p.inicio) + (p.situacao === "concluido" ? " · concluído" : "")));
      s.appendChild(h("div", { class: "rel-numeros" },
        h("div", null, h("b", null, String(p.atendimentos)), h("span", null, "atendimentos")),
        h("div", null, h("b", null, qtdTxt(p.procedimentos)), h("span", null, "procedimentos realizados")),
        h("div", null, h("b", null, qtdTxt(p.cumpridas) + "/" + qtdTxt(p.contratadas)), h("span", null, "sessões do plano")),
        h("div", null, h("b", null, p.progresso + "%"), h("span", null, "do plano concluído"))));
      s.appendChild(barra(p.progresso));
      if (p.disponiveis.length) s.appendChild(h("div", { class: "rel-caixa" }, h("h4", null, "Ainda disponíveis para você"),
        h("ul", null, p.disponiveis.map(function (x) { return h("li", null, h("b", null, qtdTxt(x.quantidade) + "× "), x.procedimento); }))));
      s.appendChild(h("h4", null, "Atendimentos"));
      s.appendChild(h("table", { class: "rel-tabela" }, h("thead", null, h("tr", null, h("th", null, "#"), h("th", null, "Data"), h("th", null, "Procedimento"), h("th", null, "Observação"))),
        h("tbody", null, p.historico.map(function (a, k) {
          return h("tr", null, h("td", null, String(k + 1)), h("td", null, dataBR(a.data)), h("td", null, a.procedimentos.map(function (x) { return h("div", null, x.texto); })), h("td", null, a.observacao || "—"));
        }))));
      s.appendChild(h("h4", null, "Plano contratado × sessões realizadas"));
      s.appendChild(h("table", { class: "rel-tabela" }, h("thead", null, h("tr", null, h("th", null, "Procedimento"), h("th", null, "Contratadas"), h("th", null, "Realizadas"), h("th", null, "Situação"))),
        h("tbody", null, p.linhas.map(function (l) {
          var sit = Number(l.disponivel) > 0 ? qtdTxt(l.disponivel) + " a realizar" : "Concluído";
          if (Number(l.substituida)) sit += " · " + qtdTxt(l.substituida) + " substituído";
          if (Number(l.comprometida)) sit += " · " + qtdTxt(l.comprometida) + " em troca";
          if (Number(l.excedente)) sit += " · +" + qtdTxt(l.excedente) + " além";
          return h("tr", null, h("td", null, l.procedimento), h("td", null, qtdTxt(l.contratado)), h("td", null, qtdTxt(l.realizada)), h("td", null, sit));
        }))));
      if (p.trocas.length) s.appendChild(h("div", { class: "rel-caixa" }, h("h4", null, "Sessões substituídas"), h("ul", null, p.trocas.map(function (t) { return h("li", null, t.texto); }))));
      if (p.bonus.length) s.appendChild(h("div", { class: "rel-caixa" }, h("h4", null, "Sessões bônus"), h("ul", null, p.bonus.map(function (b) { return h("li", null, qtdTxt(b.quantidade) + " " + b.procedimento); }))));
      alvo.appendChild(s);
    });
    if (d.creditoDisponivel > 0) alvo.appendChild(h("p", { class: "rel-caixa" }, "Crédito disponível para você: " + brl(d.creditoDisponivel)));
    alvo.appendChild(h("p", { class: "rel-rodape" }, "Seguimos juntas, florescendo a cada sessão."));
    el("dlgImpressao").showModal();
  }

  function imprimir() {
    var dest = limpar(el("impressao"));
    dest.appendChild(el("impConteudo").cloneNode(true));
    dest.hidden = false;
    document.body.classList.add("imprimindo");
    var fim = function () { document.body.classList.remove("imprimindo"); dest.hidden = true; limpar(dest); window.removeEventListener("afterprint", fim); };
    window.addEventListener("afterprint", fim);
    window.print();
  }

  function linhaOrcLocal(x) {
    var proc = h("input", { class: "input", placeholder: "procedimento", "aria-label": "Procedimento", value: x.procedimento || "", list: "listaProcedimentos", maxlength: "160" });
    var cod = h("input", { class: "input", placeholder: "código", "aria-label": "Código do procedimento", value: x.procedimentoRef || "", maxlength: "60" });
    var q = h("input", { class: "input", inputmode: "decimal", placeholder: "qtd", "aria-label": "Quantidade orçada", value: x.contratado ? qtdBR(x.contratado) : x.quantidade ? qtdBR(x.quantidade) : "1" });
    var vu = h("input", { class: "input", inputmode: "decimal", placeholder: "valor unitário", "aria-label": "Valor unitário acordado", value: x.precoRef !== null && x.precoRef !== undefined ? numBR(x.precoRef) : x.valorTabela !== null && x.valorTabela !== undefined ? numBR(x.valorTabela) : "" });
    var ficha = h("select", { class: "input", "aria-label": "Ficha de custo" });
    ficha.appendChild(h("option", { value: "" }, "sem ficha"));
    estado.dados.fichas.filter(function (f) { return !f.arquivada && f.tipo !== "pacote"; }).forEach(function (f) { ficha.appendChild(h("option", { value: f.id }, f.nome)); });
    ficha.value = x.fichaId || "";
    var classe = h("select", { class: "input", "aria-label": "Classe" });
    [["tratamento", "Tratamento"], ["produto", "Produto"], ["avulso", "Avulso"]].forEach(function (c) { classe.appendChild(h("option", { value: c[0] }, c[1])); });
    classe.value = x.classe || "tratamento";
    var li = h("li", null, proc, cod, q, vu, ficha, classe, h("button", { type: "button", class: "icone-btn", "aria-label": "Tirar", onclick: function () { li.remove(); } }, "×"));
    li._ler = function () { return { id: x.id || undefined, procedimento: proc.value.trim(), procedimentoRef: cod.value.trim(), quantidade: q.value.trim(), valorUnitario: centavosDe(vu.value), fichaId: ficha.value, classe: classe.value }; };
    return li;
  }

  async function abrirOrcLocal(o) {
    if (!exec) await carregarExecucao();
    olAberto = o || null;
    el("olTitulo").textContent = o ? "Orçamento " + o.id : "Orçamento do Alveare";
    preencherPacientes(el("olPaciente"), o ? o.pacienteRef : pacRef);
    el("olData").value = o ? o.data : hoje();
    el("olSituacao").value = o ? (o.situacaoOrigem || o.situacao || "aberto") : "aprovado";
    el("olNotas").value = o ? o.notas || "" : "";
    var ul = limpar(el("olItens"));
    (o ? (o.linhas || []).concat(o.outrosItens || []) : [{}]).forEach(function (x) { ul.appendChild(linhaOrcLocal(x)); });
    el("olErro").textContent = "";
    el("dlgOrcLocal").showModal();
  }

  function ligarExecucao() {
    var reler = function () { carregarExecucao(); };
    el("fxBusca").addEventListener("change", reler);
    ["fxSituacao", "fxBase", "fxDe", "fxAte"].forEach(function (id) { el(id).addEventListener("change", reler); });
    el("fxPaciente").addEventListener("change", function () { selecionarPaciente(el("fxPaciente").value); });
    el("btnFpVoltar").addEventListener("click", function () { selecionarPaciente(""); });
    el("btnFpRegistrar").addEventListener("click", function () { abrirRegistrar({ pacienteRef: pacRef }); });
    el("btnFpImprimir").addEventListener("click", abrirImpressao);
    el("impImprimir").addEventListener("click", imprimir);
    el("btnNovaExecucao").addEventListener("click", function () { abrirRegistrar(null); });
    el("btnNovoOrcamento").addEventListener("click", function () { abrirOrcLocal(null); });
    el("orcRegistrar").addEventListener("click", function () { var p = planoAberto; el("dlgOrcamento").close(); abrirRegistrar({ pacienteRef: p ? p.pacienteRef : pacRef }); });
    el("orcTroca").addEventListener("click", function () { if (planoAberto) abrirTroca({ planoRef: planoAberto.ref }); });
    el("orcEditar").addEventListener("click", function () { var p = planoAberto; el("dlgOrcamento").close(); abrirOrcLocal(p); });
    el("exPaciente").addEventListener("change", function () { atualizarAgendamentos(""); });
    el("exNatureza").addEventListener("change", atualizarNatureza);
    el("exItem").addEventListener("change", function () {
      var x = itensDaPaciente(el("exPaciente").value).filter(function (i) { return i.ref === el("exItem").value; })[0];
      if (x && !el("exProcedimento").value) el("exProcedimento").value = x.it.procedimento;
    });
    el("exTroca").addEventListener("change", function () {
      if (!pac) return;
      pac.planos.forEach(function (p) { p.trocas.forEach(function (t) { if (t.id === el("exTroca").value) el("exProcedimento").value = t.procedimentoSubstituto; }); });
    });
    el("formExecucao").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var ag = el("exAgendamento").value;
      if (!ag) { el("exErro").textContent = "Escolha o agendamento: o procedimento sempre fica ligado a um."; return; }
      var partes = ag.split(":");
      var nat = el("exNatureza").value;
      var item = nat ? null : itensDaPaciente(el("exPaciente").value).filter(function (i) { return i.ref === el("exItem").value; })[0];
      var troca = null;
      if (nat === "troca") {
        if (!el("exTroca").value) { el("exErro").textContent = "Escolha a troca que esta entrega atende."; return; }
        pac.planos.forEach(function (p) { p.trocas.forEach(function (t) { if (t.id === el("exTroca").value) troca = t; }); });
      }
      var dados = { agendamentoTipo: partes[0], agendamentoId: partes.slice(1).join(":"), procedimento: el("exProcedimento").value.trim(),
        procedimentoRef: item ? item.it.procedimentoRef : troca ? troca.procedimentoSubstitutoRef : "", fichaId: item ? item.it.fichaId || "" : troca ? troca.fichaSubstitutoId : "",
        quantidade: el("exQtd").value.trim(), estado: el("exEstado").value, itemRef: item ? item.ref : "", notas: el("exNotas").value.trim() };
      if (nat === "gratuito" || nat === "avulso") dados.natureza = nat;
      if (nat === "gratuito") {
        var vr = centavosDe(el("exValorRef").value);
        if (vr !== null && !isNaN(vr)) dados.valorReferencia = vr;
        if (planoAberto && planoAberto.pacienteRef === el("exPaciente").value) dados.orcamentoRef = planoAberto.ref;
      }
      if (troca) dados.trocaId = troca.id;
      try {
        var r = await aplicar({ tipo: "exe.registrar", id: novoId("ex"), dados: dados });
        el("dlgExecucao").close();
        toast(r.associacao === "ambigua" || r.associacao === "sugerida" ? "Registrado. Falta escolher o plano (aparece nas pendências da paciente)." :
          r.associacao === "sem_orcamento" ? "Registrado, ainda sem plano." : "Registrado.");
        await recarregarExecucao();
      } catch (e) { el("exErro").textContent = e.message; }
    });
    el("formAssociar").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (!exAssociar) return;
      var v = el("assocItem").value, campos = { motivo: el("assocMotivo").value.trim() };
      if (v.indexOf("item:") === 0) { campos.itemRef = v.slice(5); campos.natureza = "contratado"; }
      else if (v === "avulso") campos.natureza = "avulso";
      else if (v === "gratuito") {
        campos.natureza = "gratuito";
        var ref = window.prompt("Valor de referência do bônus (vazio = preço da ficha, se houver):", "");
        if (ref === null) return;
        var c = centavosDe(ref);
        if (c !== null && !isNaN(c)) campos.valorReferencia = c;
        if (planoAberto && planoAberto.pacienteRef === exAssociar.pacienteRef) campos.orcamentoRef = planoAberto.ref;
      } else campos.natureza = "";
      try {
        await aplicar({ tipo: "exe.alterar", id: exAssociar.id, revBase: exAssociar._rev, campos: campos });
        el("dlgAssociar").close();
        toast("Salvo.");
        await recarregarExecucao();
      } catch (e) { el("assocErro").textContent = e.message; }
    });
    el("trLinha").addEventListener("change", atualizarLinhaTroca);
    el("formTroca").addEventListener("input", previaTroca);
    el("trFicha").addEventListener("change", function () {
      var f = porId(estado.dados.fichas)[el("trFicha").value];
      if (f && f.precoAtual !== null && f.precoAtual !== undefined && f.precoAtual !== "") el("trPrecoSubst").value = numBR(f.precoAtual);
      if (f && !el("trSubstituto").value) el("trSubstituto").value = f.nome;
      previaTroca();
    });
    el("formTroca").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var x = trocaCtx && trocaCtx.linhas[Number(el("trLinha").value) || 0];
      if (!x) return;
      var a = trocaCtx.atendimento;
      var f = porId(estado.dados.fichas)[el("trFicha").value];
      var num = function (id) { var c = centavosDe(el(id).value); return c === null || isNaN(c) ? null : c; };
      var dados = { orcamentoRef: x.plano.ref, linhaChave: x.linha.chave, quantidadeOrigem: el("trQtdOrigem").value.trim(), procedimentoSubstituto: el("trSubstituto").value.trim(),
        procedimentoSubstitutoRef: f && f.clinicorpProcedimentoId ? f.clinicorpProcedimentoId : "", fichaSubstitutoId: el("trFicha").value, quantidadePrometida: el("trQtdPrometida").value.trim(),
        precoOrigem: num("trPrecoOrigem"), precoSubstituto: num("trPrecoSubst"), diferencaCobrada: num("trCobrado") || 0, data: el("trData").value, motivo: el("trMotivo").value.trim(),
        observacaoOrigem: a ? a.observacao || "" : "" };
      if (x.linha.precoRef !== null && dados.precoOrigem === x.linha.precoRef) dados.precoOrigem = null;   // a referência do item: o servidor grava com a base
      if (a) { dados.agendamentoTipo = a.tipo; dados.agendamentoId = a.id; dados.entregaQuantidade = el("trEntrega").value.trim(); }
      if (x.execucao && el("trSubstituir").checked) dados.substituirExecucaoId = x.execucao.id;
      try {
        await aplicar({ tipo: "exe.troca.registrar", id: novoId("tr"), dados: dados });
        if (a && a.observacao && !a.interpretacao) await aplicar({ tipo: "exe.atendimento.salvar", id: a.ref, revBase: a._revAtendimento || 0, dados: { interpretacao: "substituicao" } });
        el("dlgTroca").close();
        toast("Troca registrada.");
        await recarregarExecucao();
      } catch (e) { el("trErro").textContent = e.message; }
    });
    el("formAtendimento").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var a = atendCtx;
      if (!a) return;
      var marcado = document.querySelector('input[name="atInterp"]:checked');
      var interp = marcado ? marcado.value : (a.interpretacao || "");
      var dados = { marcador: el("atMarcador").value.trim(), observacaoLiberada: el("atLiberar").checked, notas: el("atNotas").value.trim() };
      if (a.observacao) dados.interpretacao = interp;
      if (a.previstosFonte !== "clinicorp") {
        dados.previstos = el("atPrevistos").value.split(",").map(function (s) { return { descricao: s.trim() }; }).filter(function (p) { return p.descricao; });
        dados.profissional = el("atProfissional").value.trim();
      }
      try {
        await aplicar({ tipo: "exe.atendimento.salvar", id: a.ref, revBase: a._revAtendimento || 0, dados: dados });
        el("dlgAtendimento").close();
        toast("Atendimento salvo.");
        await recarregarExecucao();
        var atual = pac && pac.atendimentos.filter(function (x) { return x.ref === a.ref; })[0] || a;
        if (interp === "substituicao" && interp !== a.interpretacao) abrirTroca({ atendimento: atual });
        if (interp === "complemento" && interp !== a.interpretacao) abrirRegistrar({ pacienteRef: a.pacienteRef, agendamentoRef: a.ref });
        if (interp === "bonus" && interp !== a.interpretacao) abrirRegistrar({ pacienteRef: a.pacienteRef, agendamentoRef: a.ref, natureza: "gratuito" });
      } catch (e) { el("atErro").textContent = e.message; }
    });
    el("formCredito").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (!credCtx) return;
      var v = centavosDe(el("crValor").value);
      if (v === null || isNaN(v) || v <= 0) { el("crErro").textContent = "Informe o valor."; return; }
      try {
        await aplicar({ tipo: "exe.credito.usar", id: novoId("cr"), dados: { trocaId: credCtx.id, valor: v, destinoRef: el("crDestino").value, destinoDescricao: el("crDescricao").value.trim(),
          data: el("crData").value, motivo: el("crMotivo").value.trim() } });
        el("dlgCredito").close();
        toast("Crédito usado.");
        await recarregarExecucao();
      } catch (e) { el("crErro").textContent = e.message; }
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
        await recarregarExecucao();
      } catch (e) { el("olErro").textContent = e.message; }
    });
    el("btnImportarExecucoes").addEventListener("click", function () {
      FloreSerImportacao.abrir({ modulo: MOD, tipo: "execucoes", titulo: "Importar procedimentos realizados", token: token,
        aviso: "Cada linha é um procedimento realizado num agendamento identificado (id do Clinicorp ou da Agenda). Linhas repetidas do mesmo atendimento e procedimento são somadas; o que já foi registrado por outra via não é criado de novo. Agendamento futuro, cancelado ou com falta é recusado.",
        campos: [
          { id: "agendamento", nome: "Identificador do agendamento", obrigatorio: true, tipo: "texto", apelidos: ["agendamento", "id do agendamento", "atendimento", "id agendamento"] },
          { id: "procedimento", nome: "Procedimento", obrigatorio: true, tipo: "texto", apelidos: ["procedimento", "descricao", "descrição", "servico", "serviço"] },
          { id: "codigo", nome: "Código do procedimento", tipo: "texto", apelidos: ["codigo", "código", "cod"] },
          { id: "quantidade", nome: "Quantidade (vazio = 1)", tipo: "decimal", apelidos: ["quantidade", "qtd", "qtde"] }
        ],
        aoConcluir: function () { recarregarExecucao(); } });
    });
    el("btnFpImportar").addEventListener("click", function () {
      if (!pacRef) return;
      FloreSerImportacao.abrir({ modulo: MOD, tipo: "atendimentos", titulo: "Importar agendamentos de " + (pac ? pac.paciente.nome : "paciente"), token: token,
        contexto: { pacienteRef: pacRef },
        aviso: "Use o relatório de agendamentos DESTA paciente (a aba Agendamentos do Clinicorp exporta data, horário, procedimentos, observação e marcador). Cada linha é casada com um agendamento já sincronizado pela data e horário. Os procedimentos entram como PREVISTOS: nada vira realizado sem a confirmação no atendimento. Importar de novo não duplica.",
        campos: [
          { id: "agendamento", nome: "Identificador do agendamento (se houver)", tipo: "texto", apelidos: ["id", "agendamento", "id do agendamento"] },
          { id: "data", nome: "Data", tipo: "data", apelidos: ["data", "dia"] },
          { id: "horario", nome: "Horário", tipo: "texto", apelidos: ["horario", "horário", "hora", "inicio", "início"] },
          { id: "procedimentos", nome: "Procedimentos", tipo: "texto", apelidos: ["procedimentos", "procedimento", "servicos", "serviços"] },
          { id: "observacao", nome: "Observação", tipo: "texto", apelidos: ["observacao", "observação", "obs", "notas"] },
          { id: "marcador", nome: "Marcador / categoria", tipo: "texto", apelidos: ["marcador", "categoria", "marcador / categoria"] },
          { id: "profissional", nome: "Profissional", tipo: "texto", apelidos: ["profissional", "dentista", "responsavel", "responsável"] }
        ],
        aoConcluir: function () { recarregarExecucao(); } });
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
