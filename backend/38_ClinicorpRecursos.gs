/* =====================================================================
   38_ClinicorpRecursos — cada recurso: buscar uma janela e conciliar
   ---------------------------------------------------------------------
   buscarJanelaClinicorp(recurso, de, ate, c)  → registros normalizados
   dataDoFiltro(tipo, registro, c)             → o dia pelo qual a consulta
                                                 filtra (para "ausente")
   consequenciasDaMudanca(tipo, antes, depois, cx) → pendências a abrir

   Nenhuma mudança vinda do Clinicorp altera CRM, Agenda ou Entradas por
   conta própria. O que pode virar ação vira PENDÊNCIA, e uma pessoa
   aplica — passando pelas regras do módulo (conferirLeadCRM, etc.).
   Nunca: orçamento → recebimento, confirmação → comparecimento,
   comparecimento → venda, sessão vencida → pagamento.
   ===================================================================== */

/* A lista de status de agendamento (com a chave estável Type), no máximo
   uma vez por execução, guardada na configuração para classificar
   agendado · confirmado · compareceu · falta · cancelado. */
var _STATUS_LIDO = false;
function atualizarStatusDeAgenda() {
  if (_STATUS_LIDO) return;
  _STATUS_LIDO = true;
  try {
    var r = chamarClinicorp("agendamentos.status", {});
    var mapa = {};
    (Array.isArray(r) ? r : []).forEach(function (x) { var n = normalizarSimples("status", x); if (n && n.externoId) mapa[n.externoId] = { nome: n.nome, chave: n.chave }; });
    if (Object.keys(mapa).length) alterarConfigClinicorp(function (c) { c.statusAgenda = mapa; });
  } catch (e) { if (!(e instanceof ErroClinicorp) || e.tipo === "autenticacao") throw e; }
  /* nomes dos profissionais (o agendamento traz só o id) */
  try {
    var p = chamarClinicorp("profissionais.listar", {});
    var nomes = {};
    (Array.isArray(p) ? p : []).forEach(function (x) { var n = normalizarSimples("profissional", x); if (n && n.externoId && n.nome) nomes[n.externoId] = n.nome; });
    if (Object.keys(nomes).length) alterarConfigClinicorp(function (c) { c.profissionais = nomes; });
  } catch (e2) { if (!(e2 instanceof ErroClinicorp) || e2.tipo === "autenticacao") throw e2; }
}

/* Agendamentos de UMA paciente vinculada na janela: os itens voltam com
   pacienteExternoId preenchido (a consulta foi filtrada por ela). */
function buscarAgendamentosDaPaciente(pid, de, ate, c) {
  var r = chamarClinicorp("agendamentos.listar", { from: de, to: ate, businessId: c.unidade ? String(c.unidade) : "", patientId: pid,
    includeCanceled: "X", includeDeleted: "X" });
  return (Array.isArray(r) ? r : []).map(normalizarAgendamento).filter(Boolean).map(function (x) { x.pacienteExternoId = String(pid); return x; });
}

function buscarJanelaClinicorp(recurso, de, ate, c, cx) {
  var unidade = c.unidade ? String(c.unidade) : "";
  if (recurso === "orcamentos") {
    var o = chamarClinicorp("orcamentos.listar", { from: de, to: ate, clinic_id: unidade });
    return (Array.isArray(o) ? o : []).map(normalizarOrcamento).filter(Boolean).map(orcamentoQueCabe);
  }
  if (recurso === "agendamentos") {
    atualizarStatusDeAgenda();
    var a = chamarClinicorp("agendamentos.listar", { from: de, to: ate, businessId: unidade, includeCanceled: "X", includeDeleted: "X" });
    /* a consulta do período não traz a paciente; a atribuição sai de
       buscarAgendamentosDaPaciente, por paciente vinculada, com cursor
       (37 · executarSincronizacao) */
    return (Array.isArray(a) ? a : []).map(normalizarAgendamento).filter(Boolean);
  }
  if (recurso === "recebimentos") {
    var p = chamarClinicorp("recebimentos.listar", { from: de, to: ate, get_amount_with_discounts: c.valorSemTaxas ? "X" : "",
      date_type: c.recebimentosPor === "postDate" || c.recebimentosPor === "checkoutDate" ? c.recebimentosPor : "" });
    return (Array.isArray(p) ? p : []).map(function (x) { return normalizarRecebimento(x, !!c.valorSemTaxas); })
      .filter(function (x) { return x && (!unidade || !x.unidade || x.unidade === unidade); });
  }
  if (recurso === "resumo") {
    var s = chamarClinicorp("financeiro.resumo", { from: de, to: ate, business_id: unidade });
    var lista2 = Array.isArray(s) ? s : (s ? [s] : []);
    return lista2.map(function (x, i) {
      return { externoId: de + ":" + ate + ":" + (x.BusinessId || i), de: de, ate: ate, unidade: idExterno(x.BusinessId),
        vendas: centavosDoClinicorp(x.TotalSales), receitas: centavosDoClinicorp(x.TotalIncome), despesas: centavosDoClinicorp(x.TotalExpenses),
        tipo: String(x.Type || "") };
    });
  }
  throw new Error("recurso sem busca em lote: " + recurso);
}

/* O dia pelo qual a consulta filtrou. Só com ele dá para dizer que um
   registro "devia ter vindo" — e mesmo assim ausência não é exclusão. */
function dataDoFiltro(tipo, r, c) {
  if (tipo === "agendamento") return r.dia;
  if (tipo === "recebimento") {
    if (c.recebimentosPor === "postDate") return r.lancadoEm;
    if (c.recebimentosPor === "checkoutDate") return r.pagoEm;
    return r.recebidoEm;
  }
  /* orçamentos: o dia do filtro muda com o status — ausência não diz nada */
  return null;
}

/* Pendências que uma mudança externa abre. cx: { vinculoPorExterno, entradas } */
function consequenciasDaMudanca(tipo, antes, depois, cx, c) {
  var saida = [];
  if (tipo === "orcamento") {
    var v = cx.vinculoPorExterno["paciente:" + depois.pacienteExternoId];
    if (!v || v.localTipo !== "lead") return saida;
    var regra = (c.eventosOrcamento || {})[depois.status];
    var ev = CLINICORP_EVENTOS_ORCAMENTO[depois.status];
    if (regra !== "propor" || !ev) return saida;
    if (antes && antes.status === depois.status) return saida;
    saida.push({ tipo: "proposta_etapa", chave: "orc:" + depois.externoId + ":" + depois.status, externoId: depois.externoId,
      localTipo: "lead", localId: v.localId,
      resumo: ev.nome + " no Clinicorp" + (depois.valor !== null ? " (" + dinheiroBR(depois.valor) + ")" : "") + " — propor " + nomeEtapa(ev.etapas[0]) + " no CRM",
      detalhes: { etapa: ev.etapas[0], de: ev.de, status: depois.status, valor: depois.valor, data: depois.aprovadoEm || depois.reprovadoEm || depois.criadoEm } });
    return saida;
  }
  if (tipo === "recebimento") {
    var vin = cx.vinculoPorExterno["recebimento:" + depois.externoId];
    if (vin && antes && (antes.valor !== depois.valor || antes.recebido !== depois.recebido || antes.confirmado !== depois.confirmado)) {
      saida.push({ tipo: "divergencia", chave: "rec-div:" + depois.externoId + ":" + assinaturaExterna(depois).slice(0, 8), externoId: depois.externoId,
        localTipo: "entrada", localId: vin.localId,
        resumo: "Recebimento vinculado mudou no Clinicorp: " + resumoRecebimento(depois) + ". A entrada do Alveare não foi alterada.",
        detalhes: { antes: { valor: antes.valor, recebido: antes.recebido, confirmado: antes.confirmado }, depois: { valor: depois.valor, recebido: depois.recebido, confirmado: depois.confirmado } } });
    }
    if (!vin && !antes) {
      var dia = depois.recebidoEm || depois.pagoEm;
      var candidatas = (cx.entradas || []).filter(function (e) { return !e.vinculada && e.data === dia && e.total === depois.valor; });
      if (candidatas.length) {
        saida.push({ tipo: "conciliacao", chave: "rec:" + depois.externoId, externoId: depois.externoId, localTipo: "entrada", localId: "",
          resumo: "Recebimento do Clinicorp de " + resumoRecebimento(depois) + " parece com " + candidatas.length + " entrada(s) do mesmo dia e valor. Confira antes de vincular.",
          detalhes: { candidatas: candidatas.slice(0, 5).map(function (e) { return e.id; }) } });
      }
    }
  }
  return saida;
}

function resumoRecebimento(r) {
  return (r.valor !== null ? dinheiroBR(r.valor) : "valor não informado") + (r.forma ? " · " + r.forma : "") +
    (r.recebidoEm ? " · recebido em " + dataBR(r.recebidoEm) : r.vencimento ? " · vence em " + dataBR(r.vencimento) : "");
}

/* Busca de um paciente, nunca por nome sozinho para vincular. */
function buscarPacienteClinicorp(criterio, valor) {
  var p = {};
  if (criterio === "id") p.PatientId = valor;
  else if (criterio === "telefone") p.Phone = valor;
  else if (criterio === "email") p.Email = valor;
  else if (criterio === "cpf") p.OtherDocumentId = valor;
  else throw new ErroClinicorp("recusado", "critério de busca desconhecido");
  var r = chamarClinicorp("pacientes.buscar", p);
  var lista = Array.isArray(r) ? r : (r ? [r] : []);
  return lista.map(normalizarPaciente).filter(Boolean);
}
