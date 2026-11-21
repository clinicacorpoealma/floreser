/* =====================================================================
   34_ServicoExecucao — Orçamentos e execução, dentro do Financeiro
   ---------------------------------------------------------------------
   Responde, por paciente e orçamento: o que foi orçado, o que está
   agendado, o que foi REALIZADO e o que falta.

   REGRA CENTRAL. Procedimento realizado = registro de execução
   (exe_execucoes) ligado a UM agendamento identificado — da Agenda do
   Alveare (agenda_agendamentos / agenda_historico) ou do Clinicorp
   (int_externos tipo agendamento). Nunca é fonte de execução:
     · o contador do controle de sessões nem as sessões contratadas;
     · a aprovação do orçamento;
     · um pagamento recebido;
     · a passagem da data do agendamento;
     · o "Executado" que o Clinicorp mostra no orçamento (não diz em que
       agendamento foi) — aparece só como conferência.
   A API do Clinicorp não liga agendamento a procedimento nem a orçamento
   (conferido na especificação em 20/11/2026): o registro é feito no
   Alveare — na tela ou por relatório importado — e o adaptador oficial
   fica preparado (35: "execucao.procedimentos", não documentado).

   MODELO. Um agendamento pode ter vários procedimentos (várias execuções
   com o mesmo agendamentoId); um item do orçamento pode ser realizado em
   vários agendamentos (várias execuções com o mesmo itemRef). Estados da
   execução: previsto (planejado naquele agendamento) · realizado ·
   desfeito (corrigido — fica no histórico, não conta).

   ORÇAMENTOS. Do Clinicorp (int_externos tipo orcamento: cada linha de
   procedimento é um item de quantidade 1 — a API não traz quantidade) e
   locais (exe_orcamentos, para o que não vem de lá). Valores orçados,
   execução e dinheiro recebido ficam separados: nada aqui soma recebimento.

   ASSOCIAÇÃO. Execução sem item pode ser ligada a um item:
     · pelo item informado;
     · pelo código do procedimento (procedimentoRef) quando há UM só item
       possível com saldo;
     · reaproveitando a associação anterior da mesma paciente e do mesmo
       procedimento;
   Dois orçamentos possíveis, ou só o nome igual → a pessoa escolhe.
   ===================================================================== */

var EXE_ESTADOS = { previsto: "Previsto", realizado: "Realizado", desfeito: "Desfeito" };
var EXE_STATUS_AGENDA = { agendado: "Agendado", confirmado: "Confirmado", compareceu: "Compareceu", falta: "Falta", cancelado: "Cancelado" };

/* ---------------- pacientes: uma chave para as duas origens ---------------- */

function mapaDePacientes(c) {
  var porExterno = {}, porLocal = {};
  lerTudo("int_vinculos").forEach(function (v) {
    if (v.estado !== "ativo" || v.tipo !== "paciente" || v.localTipo !== "paciente" || (v.assinante || "") !== (c.assinante || "")) return;
    porExterno[v.externoId] = v.localId; porLocal[v.localId] = v.externoId;
  });
  var nomes = {};
  lerTudo("agenda_pacientes").forEach(function (p) { nomes[p.id] = p.nome || ""; });
  return {
    deExterno: function (ext) { return porExterno[ext] ? "loc:" + porExterno[ext] : "clc:" + ext; },
    deLocal: function (pid) { return "loc:" + pid; },
    nome: function (ref, padrao) { return ref.indexOf("loc:") === 0 ? (nomes[ref.slice(4)] || padrao || "") : (padrao || ""); }
  };
}

/* ---------------- status do agendamento ---------------- */

/* Categoria pela chave estável do Clinicorp (Type) ou pela descrição; a
   configuração pode corrigir (categoriaStatus). Sem certeza: "agendado",
   com a descrição original à vista. */
function categoriaDoStatus(statusId, c) {
  var manual = (c.categoriaStatus || {})[statusId];
  if (manual && EXE_STATUS_AGENDA[manual]) return manual;
  var st = (c.statusAgenda || {})[statusId];
  if (!st) return "";
  var t = (String(st.chave || "") + " " + String(st.nome || "")).toUpperCase();
  if (/CONFIRM/.test(t)) return "confirmado";
  if (/NO_?SHOW|MISS|FALT|AUSEN/.test(t)) return "falta";
  if (/CANCEL|DESMARC/.test(t)) return "cancelado";
  if (/ATTEND|ATEND|FINISH|CONCLU|COMPARE|PRESEN/.test(t)) return "compareceu";
  return "";
}

function statusDoAgendamento(a, c) {
  if (a.excluido) return { categoria: "cancelado", descricao: "excluído no Clinicorp" };
  if (a.cancelado) return { categoria: "cancelado", descricao: "desmarcado no Clinicorp" };
  var st = (c.statusAgenda || {})[a.statusId];
  var cat = categoriaDoStatus(a.statusId, c);
  return { categoria: cat || "agendado", descricao: st ? st.nome : (a.statusId ? "status " + a.statusId : "sem status") , conferir: !cat && !!a.statusId };
}

/* ---------------- os agendamentos que podem receber execução ---------------- */

function agendamentosConhecidos(c, pac) {
  var lista = {};
  lerTudo("int_externos").forEach(function (x) {
    if (x.tipo !== "agendamento" || (x.assinante || "") !== (c.assinante || "") || !x.dados) return;
    var a = x.dados;
    lista["clinicorp:" + x.externoId] = { ref: "clinicorp:" + x.externoId, tipo: "clinicorp", id: x.externoId, data: a.dia, hora: a.inicio || "",
      pacienteRef: a.pacienteExternoId ? pac.deExterno(a.pacienteExternoId) : "", pacienteNome: a.pacienteNome || "",
      profissionalId: a.profissionalId || "", status: statusDoAgendamento(a, c), procedimentoTexto: a.procedimento || "" };
  });
  var hoje = hojeNaClinica();
  lerTudo("agenda_agendamentos").forEach(function (g) {
    lista["agenda:" + g.id] = { ref: "agenda:" + g.id, tipo: "agenda", id: g.id, data: g.data, hora: "", pacienteRef: pac.deLocal(g.pacienteId),
      pacienteNome: pac.nome(pac.deLocal(g.pacienteId)), area: g.area, status: { categoria: "agendado", descricao: g.data < hoje ? "na Agenda, data passada" : "na Agenda" } };
  });
  /* sessões já vividas na Agenda ficam no histórico (tipo "sessao", com id
     próprio). A Agenda marca a sessão pelo relógio: é um agendamento que
     existiu, não prova de presença nem de procedimento. As outras linhas do
     histórico (condição, follow-up, arquivamento...) não são agendamentos. */
  lerTudo("agenda_historico").forEach(function (h) {
    if (!h.data || h.tipo !== "sessao") return;
    lista["agenda-hist:" + h.id] = { ref: "agenda-hist:" + h.id, tipo: "agenda-hist", id: h.id, data: h.data, hora: "", pacienteRef: pac.deLocal(h.pacienteId),
      pacienteNome: pac.nome(pac.deLocal(h.pacienteId)), area: h.area || "", status: { categoria: "agendado", descricao: "sessão da Agenda" } };
  });
  return lista;
}

/* ---------------- os orçamentos, das duas origens ---------------- */

function orcamentosConhecidos(c, pac) {
  var lista = {};
  lerTudo("int_externos").forEach(function (x) {
    if (x.tipo !== "orcamento" || (x.assinante || "") !== (c.assinante || "") || !x.dados) return;
    var o = x.dados;
    var ref = "clinicorp:" + x.externoId;
    lista[ref] = { ref: ref, origem: "clinicorp", id: x.externoId, data: o.criadoEm || o.emitidoEm || "", situacao: o.status || "",
      pacienteRef: o.pacienteExternoId ? pac.deExterno(o.pacienteExternoId) : "clc:?", pacienteNome: o.pacienteNome || "",
      desconto: o.descontoValor, valor: o.valor, profissional: o.profissional || "",
      itens: (o.procedimentos || []).filter(function (p) { return !p.excluido; }).map(function (p, k) {
        return { ref: ref + ":" + (p.id || k), procedimento: p.descricao || "", procedimentoRef: p.ref ? String(p.ref) : "", quantidade: "1",
          valorTabela: p.valorTabela === undefined ? null : p.valorTabela, valorAcordado: p.valor === undefined ? null : p.valor,
          naoAprovado: !!p.naoAprovado, executadoNoClinicorp: !!p.executado, executadoEm: p.executadoEm || null };
      }), procedimentosIncompletos: !!o.procedimentosIncompletos };
  });
  var porOrc = agrupar(lerTudo("exe_orcamento_itens"), "orcamentoId");
  lerTudo("exe_orcamentos").forEach(function (o) {
    var ref = "local:" + o.id;
    lista[ref] = { ref: ref, origem: "local", id: o.id, data: o.data || "", situacao: o.situacao || "aberto", pacienteRef: o.pacienteRef || "",
      pacienteNome: pac.nome(o.pacienteRef || "", o.pacienteNome), desconto: o.descontoGeral, _rev: Number(o.rev) || 0, notas: o.notas || "",
      itens: (porOrc[o.id] || []).sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); }).map(function (i) {
        var q = qtdMil(i.quantidade) || 0;
        var total = i.valorUnitario === null || i.valorUnitario === undefined ? null : Math.round(Number(i.valorUnitario) * q / 1000) - (Number(i.desconto) || 0);
        return { ref: ref + ":" + i.id, id: i.id, procedimento: i.procedimento, procedimentoRef: i.procedimentoRef || "", fichaId: i.fichaId || "",
          quantidade: i.quantidade, valorTabela: i.valorUnitario, valorAcordado: total, desconto: i.desconto };
      }) };
  });
  return lista;
}

/* ---------------- a apuração ---------------- */

function apurar(c, filtros) {
  var pac = mapaDePacientes(c);
  var ags = agendamentosConhecidos(c, pac);
  var orcs = orcamentosConhecidos(c, pac);
  var exes = lerTudo("exe_execucoes");
  var hoje = hojeNaClinica();
  var porItem = {};
  Object.keys(orcs).forEach(function (k) { orcs[k].itens.forEach(function (i) { porItem[i.ref] = { item: i, orc: orcs[k], realizada: 0, agendada: 0, execucoes: [] }; }); });
  var semOrcamento = [], pendentes = [];
  var porAgendamento = {};
  exes.forEach(function (e) {
    var ag = ags[e.agendamentoTipo + ":" + e.agendamentoId] || null;
    var cat = ag ? ag.status.categoria : null;
    /* agendamento cancelado ou falta: a execução fica no histórico e não conta */
    var conta = e.estado === "realizado" && cat !== "cancelado" && cat !== "falta";
    var prevista = e.estado === "previsto" && cat !== "cancelado" && cat !== "falta" && (e.agendamentoData || "") >= hoje;
    var pub = execucaoProcedimento(e, ag, conta);
    (porAgendamento[e.agendamentoTipo + ":" + e.agendamentoId] = porAgendamento[e.agendamentoTipo + ":" + e.agendamentoId] || []).push(pub);
    var alvo = e.itemRef ? porItem[e.itemRef] : null;
    if (alvo) {
      var q = qtdMil(e.quantidade) || 0;
      if (conta) alvo.realizada += q;
      if (prevista) alvo.agendada += q;
      alvo.execucoes.push(pub);
    } else if (e.estado !== "desfeito") {
      semOrcamento.push(pub);
      if (e.associacao === "ambigua" || e.associacao === "sugerida") pendentes.push(pub);
    }
  });
  /* linhas iguais do mesmo orçamento (o Clinicorp manda uma linha por
     unidade) formam um conjunto: o realizado preenche uma linha depois da
     outra, e só o que passar do conjunto todo é excedente */
  Object.keys(orcs).forEach(function (k) {
    var grupos = {};
    orcs[k].itens.forEach(function (i) { var g = chaveDoProcedimento(i); (grupos[g] = grupos[g] || []).push(porItem[i.ref]); });
    Object.keys(grupos).forEach(function (g) {
      var lista = grupos[g];
      if (lista.length < 2) return;
      var real = 0, ag = 0;
      lista.forEach(function (a) { real += a.realizada; ag += a.agendada; });
      lista.forEach(function (a, n) {
        var cap = qtdMil(a.item.quantidade) || 0, ultimo = n === lista.length - 1;
        a.realizada = ultimo ? real : Math.min(cap, real); real -= a.realizada;
        var livre = Math.max(0, cap - a.realizada);
        a.agendada = ultimo ? ag : Math.min(livre, ag); ag -= a.agendada;
      });
    });
  });
  var f = filtros || {};
  var busca = chaveDeNome(f.busca || "");
  var saida = Object.keys(orcs).map(function (k) {
    var o = orcs[k];
    var totais = { orcada: 0, realizada: 0, agendada: 0, restante: 0, excedente: 0, valorAcordado: 0, valorRealizado: 0 };
    var valorConhecido = true;
    var itens = o.itens.map(function (i) {
      var a = porItem[i.ref];
      var orcada = qtdMil(i.quantidade) || 0;
      var restante = Math.max(0, orcada - a.realizada), excedente = Math.max(0, a.realizada - orcada);
      totais.orcada += orcada; totais.realizada += a.realizada; totais.agendada += a.agendada; totais.restante += restante; totais.excedente += excedente;
      if (i.valorAcordado === null || i.valorAcordado === undefined) valorConhecido = false;
      else {
        totais.valorAcordado += i.valorAcordado;
        /* valor realizado: valor acordado por unidade × realizado até o orçado
           (o excedente aparece à parte, sem preço inventado) */
        totais.valorRealizado += orcada ? Math.round(i.valorAcordado * Math.min(a.realizada, orcada) / orcada) : 0;
      }
      return Object.assign({}, i, { orcada: qtdTexto(orcada), realizada: qtdTexto(a.realizada), agendada: qtdTexto(a.agendada),
        restante: qtdTexto(restante), excedente: qtdTexto(excedente), execucoes: a.execucoes });
    });
    var datasExec = [];
    itens.forEach(function (i) { i.execucoes.forEach(function (e) { if (e.conta) datasExec.push(e.agendamentoData); }); });
    var r = { ref: o.ref, origem: o.origem, id: o.id, data: o.data, situacao: o.situacao, pacienteRef: o.pacienteRef, pacienteNome: o.pacienteNome,
      desconto: o.desconto, valorTotal: o.valor === undefined ? null : o.valor, profissional: o.profissional || "", itens: itens, notas: o.notas || "",
      _rev: o._rev, procedimentosIncompletos: o.procedimentosIncompletos,
      totais: { orcada: qtdTexto(totais.orcada), realizada: qtdTexto(totais.realizada), agendada: qtdTexto(totais.agendada),
        restante: qtdTexto(totais.restante), excedente: qtdTexto(totais.excedente),
        valorAcordado: valorConhecido ? totais.valorAcordado : null, valorRealizado: valorConhecido ? totais.valorRealizado : null },
      datasExecucao: datasExec.sort() };
    return r;
  }).filter(function (o) {
    if (busca && chaveDeNome(o.pacienteNome).indexOf(busca) < 0 && chaveDeNome(o.id).indexOf(busca) < 0) return false;
    if (f.situacao === "pendente" && Number(o.totais.restante) <= 0) return false;
    if (f.situacao === "concluido" && Number(o.totais.restante) > 0) return false;
    if (f.situacao === "excedente" && Number(o.totais.excedente) <= 0) return false;
    if (f.de || f.ate) {
      var de = f.de || "0000-00-00", ate = f.ate || "9999-12-31";
      if (f.base === "execucao") return o.datasExecucao.some(function (d) { return d >= de && d <= ate; });
      return o.data >= de && o.data <= ate;
    }
    return true;
  }).sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
  /* agendamentos com o que foi feito, por paciente */
  var agendamentos = Object.keys(ags).filter(function (k) { return porAgendamento[k] || ags[k].tipo !== "agenda-hist"; }).map(function (k) {
    var a = ags[k];
    return Object.assign({}, a, { execucoes: porAgendamento[k] || [] });
  }).sort(function (a, b) { return String(b.data + b.hora).localeCompare(String(a.data + a.hora)); });
  return { orcamentos: saida, agendamentos: agendamentos.slice(0, 400), semOrcamento: semOrcamento, pendentes: pendentes,
    estados: EXE_ESTADOS, statusAgenda: EXE_STATUS_AGENDA };
}

function chaveDoProcedimento(i) { return i.procedimentoRef ? "r:" + i.procedimentoRef : "n:" + chaveDeNome(i.procedimento); }

function execucaoProcedimento(e, ag, conta) {
  return { id: e.id, agendamentoRef: e.agendamentoTipo + ":" + e.agendamentoId, agendamentoTipo: e.agendamentoTipo, agendamentoId: e.agendamentoId,
    agendamentoData: e.agendamentoData, agendamentoStatus: ag ? ag.status : null, pacienteRef: e.pacienteRef, pacienteNome: e.pacienteNome,
    procedimento: e.procedimento, procedimentoRef: e.procedimentoRef, fichaId: e.fichaId, quantidade: e.quantidade, estado: e.estado,
    orcamentoRef: e.orcamentoRef, itemRef: e.itemRef, associacao: e.associacao, custoUnitario: e.custoUnitario, custoFonte: e.custoFonte,
    valorUnitario: e.valorUnitario, origem: e.origem, conta: conta, notas: e.notas, _rev: Number(e.rev) || 0,
    sugestoes: e.associacao === "ambigua" || e.associacao === "sugerida" ? null : undefined };
}

function financeiroOrcamentosExecucao(ctx) {
  return lerComConsistencia(function () {
    var c = configClinicorp();
    var r = apurar(c, (ctx.dados || {}).filtros || {});
    r.hoje = hojeNaClinica();
    /* pacientes para escolher: as da Agenda e as do Clinicorp que já
       aparecem em agendamento ou orçamento (sem vínculo, pela chave clc:) */
    var vistos = {}, pacientes = [];
    lerTudo("agenda_pacientes").forEach(function (p) {
      if (p.arquivada) return;
      vistos["loc:" + p.id] = true; pacientes.push({ ref: "loc:" + p.id, nome: p.nome || "(sem nome)" });
    });
    r.agendamentos.concat(r.orcamentos).forEach(function (x) {
      if (!x.pacienteRef || vistos[x.pacienteRef] || x.pacienteRef === "clc:?") return;
      vistos[x.pacienteRef] = true; pacientes.push({ ref: x.pacienteRef, nome: (x.pacienteNome || "(sem nome)") + " · Clinicorp, sem vínculo" });
    });
    r.pacientes = pacientes.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
    r.fonte = { clinicorp: situacaoClinicorp(c), execucaoAutomatica: false,
      falta: "A API do Clinicorp não informa quais procedimentos foram realizados em cada agendamento, nem o vínculo do agendamento com o orçamento. Por isso a execução é registrada aqui (ou por relatório importado)." };
    return r;
  });
}

/* ---------------- associação automática segura ---------------- */

function candidatosDoItem(c, e, orcs, exes) {
  var usados = {};
  exes.forEach(function (x) { if (x.itemRef && x.estado === "realizado" && x.id !== e.id) usados[x.itemRef] = (usados[x.itemRef] || 0) + (qtdMil(x.quantidade) || 0); });
  var saida = [];
  Object.keys(orcs).forEach(function (k) {
    var o = orcs[k];
    if (o.pacienteRef !== e.pacienteRef) return;
    if (/REJECTED|cancelado|recusado/i.test(o.situacao || "")) return;
    /* saldo por conjunto de linhas iguais (ver apurar) */
    var restaGrupo = {}, jaNoGrupo = {};
    o.itens.forEach(function (i) { if (i.naoAprovado) return; var g = chaveDoProcedimento(i);
      restaGrupo[g] = (restaGrupo[g] || 0) + (qtdMil(i.quantidade) || 0) - (usados[i.ref] || 0); });
    o.itens.forEach(function (i) {
      if (i.naoAprovado) return;
      var g = chaveDoProcedimento(i);
      if (restaGrupo[g] <= 0 || jaNoGrupo[g]) return;
      jaNoGrupo[g] = true;                  // um candidato por conjunto: o primeiro
      var porRef = e.procedimentoRef && i.procedimentoRef && String(e.procedimentoRef) === String(i.procedimentoRef);
      var porNome = !porRef && chaveDeNome(e.procedimento) && chaveDeNome(e.procedimento) === chaveDeNome(i.procedimento);
      if (porRef || porNome) saida.push({ orcamentoRef: o.ref, itemRef: i.ref, porRef: porRef, procedimento: i.procedimento, orcamentoData: o.data, valorAcordado: i.valorAcordado, quantidade: i.quantidade });
    });
  });
  return saida;
}

function associar(c, e, orcs, exes) {
  if (e.itemRef) return { itemRef: e.itemRef, orcamentoRef: e.orcamentoRef, associacao: "informada" };
  var cands = candidatosDoItem(c, e, orcs, exes);
  var porRef = cands.filter(function (x) { return x.porRef; });
  if (porRef.length === 1 && cands.filter(function (x) { return x.orcamentoRef !== porRef[0].orcamentoRef; }).length === 0) {
    return { itemRef: porRef[0].itemRef, orcamentoRef: porRef[0].orcamentoRef, associacao: "automatica" };
  }
  /* reaproveita a associação anterior da mesma paciente e procedimento, se
     aquele item ainda tem saldo */
  var anterior = exes.filter(function (x) { return x.pacienteRef === e.pacienteRef && x.itemRef && x.estado !== "desfeito" &&
    (e.procedimentoRef ? x.procedimentoRef === e.procedimentoRef : chaveDeNome(x.procedimento) === chaveDeNome(e.procedimento)) &&
    ["informada", "confirmada"].indexOf(x.associacao) >= 0; }).pop();
  if (anterior && cands.some(function (x) { return x.itemRef === anterior.itemRef; })) {
    return { itemRef: anterior.itemRef, orcamentoRef: anterior.orcamentoRef, associacao: "reaproveitada" };
  }
  if (!cands.length) return { itemRef: "", orcamentoRef: "", associacao: "sem_orcamento" };
  return { itemRef: "", orcamentoRef: "", associacao: cands.length > 1 ? "ambigua" : "sugerida" };
}

function custoDaFicha(e) {
  var fichas = lerTudo("fin_fichas");
  var f = e.fichaId ? fichas.filter(function (x) { return x.id === e.fichaId; })[0] :
    (e.procedimentoRef ? fichas.filter(function (x) { return x.clinicorpProcedimentoId && String(x.clinicorpProcedimentoId) === String(e.procedimentoRef); })[0] : null);
  if (!f) return { fichaId: "", custo: null, fonte: "" };
  var calc = calcularFicha(f, mapaPorId(lerTudo("fin_insumos")), mapaPorId(fichas));
  return { fichaId: f.id, custo: calc.custoTotal === undefined ? null : calc.custoTotal, fonte: calc.custoTotal === undefined ? "" : "estimativa" };
}

/* ---------------- operações ---------------- */

var CAMPOS_EXECUCAO = { procedimento: { tipo: "texto", max: 160 }, procedimentoRef: { tipo: "texto", max: 60 }, fichaId: { tipo: "texto", max: 80 },
  quantidade: { tipo: "decimal" }, notas: { tipo: "texto", max: 1000 } };

function planejarExecucao(ctx, op) {
  var id = idValido(op.id, "execução");
  if (acharPorChave("exe_execucoes", id)) {
    var ja = acharPorChave("exe_execucoes", id);
    return { escritas: [], resultado: { id: id, rev: Number(ja.rev) || 0, jaExistia: true } };
  }
  var d = op.dados || {};
  var c = configClinicorp();
  var pac = mapaDePacientes(c);
  var ags = agendamentosConhecidos(c, pac);
  var tipo = String(d.agendamentoTipo || ""), agId = String(d.agendamentoId || "");
  var ag = ags[tipo + ":" + agId];
  if (!ag) falhar("dados_invalidos", "Agendamento não encontrado: a execução precisa estar ligada a um agendamento da Agenda ou do Clinicorp.", { campo: "agendamentoId" });
  var estado = String(d.estado || "realizado");
  if (["previsto", "realizado"].indexOf(estado) < 0) falhar("dados_invalidos", "Estado: previsto ou realizado.");
  if (estado === "realizado" && ag.data > hojeNaClinica()) falhar("dados_invalidos", "Este agendamento ainda não aconteceu: registre como previsto.");
  if (estado === "realizado" && (ag.status.categoria === "cancelado" || ag.status.categoria === "falta")) {
    falhar("dados_invalidos", "Este agendamento está como " + EXE_STATUS_AGENDA[ag.status.categoria].toLowerCase() + ": não dá para registrar procedimento realizado nele.");
  }
  var campos = validarCamposFin({ procedimento: d.procedimento, procedimentoRef: d.procedimentoRef, fichaId: d.fichaId, quantidade: d.quantidade || "1", notas: d.notas }, CAMPOS_EXECUCAO, "execução");
  if (!String(campos.procedimento || "").trim()) falhar("dados_invalidos", "Informe o procedimento.", { campo: "procedimento" });
  if (!qtdMil(campos.quantidade)) falhar("dados_invalidos", "Quantidade inválida.", { campo: "quantidade" });
  var e = { id: id, agendamentoTipo: tipo, agendamentoId: agId, agendamentoData: ag.data, pacienteRef: ag.pacienteRef || String(d.pacienteRef || ""),
    pacienteNome: ag.pacienteNome || String(d.pacienteNome || ""), procedimento: campos.procedimento, procedimentoRef: campos.procedimentoRef || "",
    fichaId: campos.fichaId || "", quantidade: campos.quantidade, estado: estado, orcamentoRef: String(d.orcamentoRef || ""), itemRef: String(d.itemRef || ""),
    origem: String(op.origem || "manual"), loteId: String(op.loteId || ""), criadoEm: agoraISO(), autorNome: assinaturaDe(ctx.auth).nome, notas: campos.notas || "" };
  if (!e.pacienteRef) falhar("dados_invalidos", "Este agendamento do Clinicorp ainda não tem paciente identificada: vincule a paciente antes.", { campo: "agendamentoId" });
  var orcs = orcamentosConhecidos(c, pac);
  var exes = lerTudo("exe_execucoes");
  if (e.itemRef) {
    var achou = null;
    Object.keys(orcs).forEach(function (k) { orcs[k].itens.forEach(function (i) { if (i.ref === e.itemRef) achou = { o: orcs[k], i: i }; }); });
    if (!achou) falhar("dados_invalidos", "Item do orçamento não encontrado.", { campo: "itemRef" });
    if (achou.o.pacienteRef !== e.pacienteRef) falhar("dados_invalidos", "Este orçamento é de outra paciente.", { campo: "itemRef" });
    e.orcamentoRef = achou.o.ref;
  }
  var as = associar(c, e, orcs, exes);
  e.itemRef = as.itemRef; e.orcamentoRef = as.orcamentoRef; e.associacao = as.associacao;
  /* valor acordado e custo GRAVADOS agora: mudar depois não reescreve */
  var item = null;
  Object.keys(orcs).forEach(function (k) { orcs[k].itens.forEach(function (i) { if (i.ref === e.itemRef) item = i; }); });
  e.valorUnitario = item && item.valorAcordado !== null && item.valorAcordado !== undefined && qtdMil(item.quantidade) ? Math.round(item.valorAcordado * 1000 / qtdMil(item.quantidade)) : null;
  if (!e.fichaId && item && item.fichaId) e.fichaId = item.fichaId;
  var custo = custoDaFicha(e);
  e.fichaId = e.fichaId || custo.fichaId; e.custoUnitario = custo.custo; e.custoFonte = custo.fonte;
  var reg = carimbar(registroCompleto("exe_execucoes", e, null), 1, ctx, op.operacaoId);
  var ev = [evento("financeiro", "execucao", id, "criou", EXE_ESTADOS[estado], "", e.procedimento + " × " + qtdTexto(qtdMil(e.quantidade)) + " em " + dataBR(ag.data) +
    (e.itemRef ? " (orçamento)" : " (sem orçamento)"), as.associacao)];
  return { escritas: [{ t: "gravar", tabela: "exe_execucoes", registro: reg }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: 1, associacao: as.associacao } };
}

/* Corrigir: realizar o previsto, mudar quantidade, associar a um item,
   desfazer. O histórico fica na auditoria; desfeito não some. */
function planejarAlterarExecucao(ctx, op) {
  var id = idValido(op.id, "execução");
  var atual = acharPorChave("exe_execucoes", id);
  if (!atual) falhar("conflito", "Esta execução não existe mais.", { rev: 0, atual: null, removida: true });
  conferirRevisao(atual, op.revBase, function (r) { return execucaoProcedimento(r, null, false); });
  var d = op.campos || {};
  var c = configClinicorp();
  var pac = mapaDePacientes(c);
  var novo = copiaLimpa(atual);
  var ev = [];
  if (d.estado !== undefined && d.estado !== atual.estado) {
    if (["previsto", "realizado", "desfeito"].indexOf(d.estado) < 0) falhar("dados_invalidos", "Estado inválido.");
    if (d.estado === "realizado") {
      var ag = agendamentosConhecidos(c, pac)[atual.agendamentoTipo + ":" + atual.agendamentoId];
      if (ag && ag.data > hojeNaClinica()) falhar("dados_invalidos", "Este agendamento ainda não aconteceu.");
      if (ag && (ag.status.categoria === "cancelado" || ag.status.categoria === "falta")) falhar("dados_invalidos", "O agendamento está como " + EXE_STATUS_AGENDA[ag.status.categoria].toLowerCase() + ".");
    }
    ev.push(evento("financeiro", "execucao", id, "alterou", "Situação", EXE_ESTADOS[atual.estado], EXE_ESTADOS[d.estado], String(d.motivo || "")));
    novo.estado = d.estado;
  }
  if (d.quantidade !== undefined) {
    var q = qtdMil(d.quantidade);
    if (!q || q < 0) falhar("dados_invalidos", "Quantidade inválida.", { campo: "quantidade" });
    if (qtdTexto(q) !== atual.quantidade) { ev.push(evento("financeiro", "execucao", id, "alterou", "Quantidade", atual.quantidade, qtdTexto(q))); novo.quantidade = qtdTexto(q); }
  }
  if (d.itemRef !== undefined && d.itemRef !== atual.itemRef) {
    var orcs = orcamentosConhecidos(c, pac);
    var achou = null;
    Object.keys(orcs).forEach(function (k) { orcs[k].itens.forEach(function (i) { if (i.ref === d.itemRef) achou = { o: orcs[k], i: i }; }); });
    if (d.itemRef && !achou) falhar("dados_invalidos", "Item do orçamento não encontrado.");
    if (achou && achou.o.pacienteRef !== atual.pacienteRef) falhar("dados_invalidos", "Este orçamento é de outra paciente.");
    novo.itemRef = d.itemRef || ""; novo.orcamentoRef = achou ? achou.o.ref : ""; novo.associacao = d.itemRef ? "confirmada" : "sem_orcamento";
    if (achou && achou.i.valorAcordado !== null && achou.i.valorAcordado !== undefined && qtdMil(achou.i.quantidade)) {
      novo.valorUnitario = Math.round(achou.i.valorAcordado * 1000 / qtdMil(achou.i.quantidade));
    }
    ev.push(evento("financeiro", "execucao", id, "alterou", "Orçamento", atual.itemRef || "sem orçamento", novo.itemRef || "sem orçamento"));
  }
  if (d.notas !== undefined) novo.notas = String(d.notas || "").slice(0, 1000);
  if (!ev.length && novo.notas === atual.notas) return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0 } };
  var rev = (Number(atual.rev) || 0) + 1;
  carimbar(novo, rev, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "exe_execucoes", registro: novo }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId)), resultado: { id: id, rev: rev } };
}

/* Orçamento local (o que não vem do Clinicorp). Orçamento do Clinicorp é
   só leitura aqui: muda lá, e a próxima sincronização traz. */
function planejarOrcamentoLocal(ctx, op) {
  var id = idValido(op.id, "orçamento");
  var atual = acharPorChave("exe_orcamentos", id);
  var itensAntes = atual ? lerTudo("exe_orcamento_itens").filter(function (i) { return i.orcamentoId === id; }) : [];
  if (atual) conferirRevisao(atual, op.revBase, function (r) { return publicoDe("exe_orcamentos", r); });
  else if (Number(op.revBase || 0) !== 0) falhar("conflito", "Este orçamento não existe mais.", { rev: 0, atual: null, removida: true });
  var d = op.dados || {};
  var o = { id: id, pacienteRef: String(d.pacienteRef || (atual && atual.pacienteRef) || ""), pacienteNome: String(d.pacienteNome || (atual && atual.pacienteNome) || "").slice(0, 200),
    data: String(d.data || (atual && atual.data) || hojeNaClinica()), situacao: String(d.situacao || (atual && atual.situacao) || "aberto"),
    descontoGeral: d.descontoGeral === undefined ? (atual ? atual.descontoGeral : null) : (d.descontoGeral === "" || d.descontoGeral === null ? null : Number(d.descontoGeral)),
    notas: String(d.notas === undefined ? (atual ? atual.notas : "") : d.notas).slice(0, 2000), criadoEm: atual ? atual.criadoEm : agoraISO() };
  if (!/^(loc|clc):/.test(o.pacienteRef)) falhar("dados_invalidos", "Escolha a paciente.", { campo: "pacienteRef" });
  if (!dataValida(o.data)) falhar("dados_invalidos", "Data inválida.", { campo: "data" });
  if (["aberto", "aprovado", "recusado", "cancelado", "concluido"].indexOf(o.situacao) < 0) falhar("dados_invalidos", "Situação desconhecida.");
  var escritas = [], vistos = {};
  (Array.isArray(d.itens) ? d.itens : []).forEach(function (x, k) {
    var iid = idValido(x.id || (id + "-" + (k + 1)), "item");
    vistos[iid] = true;
    var q = qtdMil(x.quantidade || "1");
    if (!q || q < 0) falhar("dados_invalidos", "Quantidade inválida no item " + (k + 1) + ".");
    if (!String(x.procedimento || "").trim()) falhar("dados_invalidos", "Procedimento vazio no item " + (k + 1) + ".");
    var vu = x.valorUnitario === "" || x.valorUnitario === null || x.valorUnitario === undefined ? null : Number(x.valorUnitario);
    if (vu !== null && (!Number.isInteger(vu) || vu < 0)) falhar("dados_invalidos", "Valor inválido no item " + (k + 1) + ".");
    escritas.push({ t: "gravar", tabela: "exe_orcamento_itens", registro: { id: iid, orcamentoId: id, procedimento: String(x.procedimento).slice(0, 160),
      procedimentoRef: String(x.procedimentoRef || "").slice(0, 60), fichaId: String(x.fichaId || "").slice(0, 80), quantidade: qtdTexto(q),
      valorUnitario: vu, desconto: x.desconto ? Number(x.desconto) : null, ordem: k } });
  });
  if (!escritas.length) falhar("dados_invalidos", "O orçamento precisa de ao menos um procedimento.");
  itensAntes.forEach(function (i) {
    if (vistos[i.id]) return;
    if (lerTudo("exe_execucoes").some(function (e) { return e.itemRef === "local:" + id + ":" + i.id && e.estado !== "desfeito"; })) {
      falhar("dados_invalidos", "O item \"" + i.procedimento + "\" já tem execução registrada: desfaça ou reassocie antes de tirá-lo.");
    }
    escritas.push({ t: "remover", tabela: "exe_orcamento_itens", chave: [i.id] });
  });
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var reg = carimbar(registroCompleto("exe_orcamentos", o, atual), rev, ctx, op.operacaoId);
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "orcamento-local", id, atual ? "alterou" : "criou", "Orçamento", "", o.pacienteNome + " · " + escritas.length + " item(ns)")], op.operacaoId));
  escritas.push({ t: "gravar", tabela: "exe_orcamentos", registro: reg });
  return { escritas: escritas, resultado: { id: id, rev: rev } };
}

/* Preço praticado de uma ficha: vendas do produto ligado e execuções do
   procedimento, cada uma com o custo e o valor GRAVADOS no registro. */
function financeiroPrecosPraticados(ctx) {
  return lerComConsistencia(function () {
    var fichaId = idValido((ctx.dados || {}).fichaId, "ficha");
    var ficha = acharPorChave("fin_fichas", fichaId);
    if (!ficha) falhar("nao_encontrado", "Ficha não encontrada.");
    var linhas = [];
    var itensEst = mapaPorId(lerTudo("est_itens"));
    var vendas = mapaPorId(lerTudo("est_vendas"));
    var porVenda = agrupar(lerTudo("est_venda_itens"), "vendaId");
    Object.keys(porVenda).forEach(function (vid) {
      var v = vendas[vid];
      if (!v || v.estado === "cancelada") return;
      var t = totaisDaVenda(v, porVenda[vid]);
      porVenda[vid].forEach(function (i, k) {
        var ligado = i.fichaId === fichaId || (itensEst[i.itemId] && itensEst[i.itemId].fichaId === fichaId);
        if (!ligado) return;
        var l = t.linhas[k];
        linhas.push({ tipo: "venda", data: v.data, quantidade: l.quantidade, custoUnitario: l.custoUnitario, custoFonte: l.custoFonte, custoTotal: l.custoTotal,
          precoUnitario: i.precoUnitario, desconto: l.desconto + l.descontoGeral, vendido: l.vendido, diferenca: l.diferenca, paciente: v.pacienteNome || "", ref: vid });
      });
    });
    lerTudo("exe_execucoes").forEach(function (e) {
      if (e.estado !== "realizado" || e.fichaId !== fichaId) return;
      var q = qtdMil(e.quantidade) || 0;
      var valor = e.valorUnitario === null || e.valorUnitario === undefined ? null : Math.round(Number(e.valorUnitario) * q / 1000);
      var custo = e.custoUnitario === null || e.custoUnitario === undefined ? null : Math.round(Number(e.custoUnitario) * q / 1000);
      linhas.push({ tipo: "execucao", data: e.agendamentoData, quantidade: e.quantidade, custoUnitario: e.custoUnitario, custoFonte: e.custoFonte, custoTotal: custo,
        precoUnitario: e.valorUnitario, desconto: null, vendido: valor, diferenca: valor === null || custo === null ? null : valor - custo, paciente: e.pacienteNome, ref: e.id });
    });
    linhas.sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
    var soma = { quantidade: 0, vendido: 0, custo: 0, desconhecido: 0, semValor: 0 };
    linhas.forEach(function (l) {
      soma.quantidade += qtdMil(l.quantidade) || 0;
      if (l.vendido === null) soma.semValor++; else soma.vendido += l.vendido;
      if (l.custoTotal === null) soma.desconhecido++; else soma.custo += l.custoTotal;
    });
    var precos = linhas.filter(function (l) { return l.precoUnitario !== null && l.precoUnitario !== undefined; }).map(function (l) { return Number(l.precoUnitario); });
    return { fichaId: fichaId, precoPadrao: ficha.precoAtual, linhas: linhas.slice(0, 300),
      resumo: { quantidade: qtdTexto(soma.quantidade), vendido: soma.vendido, custo: soma.desconhecido ? null : soma.custo,
        diferenca: soma.desconhecido || soma.semValor ? null : soma.vendido - soma.custo, linhasSemCusto: soma.desconhecido, linhasSemValor: soma.semValor,
        menorPreco: precos.length ? Math.min.apply(null, precos) : null, maiorPreco: precos.length ? Math.max.apply(null, precos) : null },
      aviso: "Diferença = valor vendido − custo gravado em cada registro. Antes de taxas (quando não informadas) e de despesas fixas: não é lucro líquido." };
  });
}
