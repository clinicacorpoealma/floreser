/* =====================================================================
   39_ClinicorpAplicacao — do registro externo para o módulo, sozinho
   ---------------------------------------------------------------------
   Consultar → normalizar → identificar → APLICAR A POLÍTICA → atualizar o
   módulo → registrar o resultado. As quatro primeiras etapas são da
   sincronização (37/38); esta é a que faltava.

   A FILA é a própria int_externos: um registro está pendente de aplicação
   enquanto `aplicado` (a assinatura que já foi aplicada) for diferente da
   `assinatura` atual. Nada se perde se a execução morrer: a próxima pega
   de onde parou. Cada registro é UMA operação no diário, com operacaoId
   derivado de (registro, assinatura) — repetir não duplica.

   Um registro que falha não segura os outros: o erro fica em `aplicacao`
   e, depois de três tentativas, vira pendência para uma pessoa.

   Só recursos em modo "automatico". O que é determinístico entra sem
   pedir licença; uma pessoa só é chamada para identidade ambígua, conflito
   real, dado obrigatório ausente ou recurso indisponível.

   Política (FLORESER_CLINICORP_CONFIG):
     criarEntradas        recebimento recebido e sem vínculo vira entrada
     eventosOrcamento     contexto · propor · aplicar (pelas regras do CRM)
     areaPorProfissional  { profissionalId: area } — sem mapeamento, o
                          agendamento fica só como contexto
   ===================================================================== */

var APL_MAX_TENTATIVAS = 3;
var APL_POR_EXECUCAO = 200;

function politicaClinicorp(c) {
  return { criarEntradas: c.criarEntradas !== false, eventosOrcamento: c.eventosOrcamento || {},
    areaPorProfissional: c.areaPorProfissional || {} };
}

function tiposAutomaticos(c) {
  var t = [];
  ["orcamentos", "agendamentos", "recebimentos"].forEach(function (r) { if (modoDoRecurso(c, r) === "automatico") t.push(CLINICORP_RECURSOS[r].tipo); });
  return t;
}

/* Identidade de UMA tentativa de aplicação no diário: o registro, a
   assinatura, a reabertura (cada volta à fila é uma tentativa nova) e quem
   roda (rotina agendada ou pessoa). Sem a reabertura e o autor, um registro
   reaberto reusava o operacaoId da aplicação anterior: com outro autor dava
   "identificador já usado"; com o mesmo, o diário devolvia o resultado
   antigo e o registro ficava preso na fila. */
function opIdDeAplicacao(x, auth) {
  return "int-apl-" + sha256Hex(x.id + "|" + x.assinatura + "|" + ((x.aplicacao && x.aplicacao.reaberto) || "") + "|" + autorDaOperacao(auth)).slice(0, 40);
}

/* Registros na fila, os mais antigos primeiro. O limite de tentativas vale
   por identidade de tentativa: falhas antigas de outro operacaoId (ou sem
   ele) não seguram o registro. */
function filaDeAplicacao(c, tipos, auth) {
  return lerTudo("int_externos").filter(function (x) {
    if (tipos.indexOf(x.tipo) < 0 || (x.assinante || "") !== (c.assinante || "")) return false;
    if (x.aplicado === x.assinatura) return false;
    var a = x.aplicacao || {};
    return !(a.assinatura === x.assinatura && a.operacaoId && a.operacaoId === opIdDeAplicacao(x, auth) && (a.tentativas || 0) >= APL_MAX_TENTATIVAS);
  });
}

/* Aplica o que estiver na fila, dentro do orçamento de tempo. */
function aplicarFilaClinicorp(auth, orcamentoMs, pedidoId) {
  var inicio = Date.now();
  _PROPS = null;
  var c = configClinicorp();
  var tipos = tiposAutomaticos(c);
  var saida = { aplicados: 0, semMudanca: 0, falhas: 0, pendencias: 0, restantes: 0 };
  if (!tipos.length || impedimentoClinicorp(c) === "nao_configurada") return saida;
  var fila = filaDeAplicacao(c, tipos, auth || AUTH_SISTEMA_CLINICORP);
  var cx = contextoDeAplicacao(c);
  for (var i = 0; i < fila.length; i++) {
    if (Date.now() - inicio > orcamentoMs || i >= APL_POR_EXECUCAO) { saida.restantes = fila.length - i; break; }
    var x = fila[i];
    var ctx = { pedidoId: pedidoId || "", acao: "integracao.aplicar", auth: auth || AUTH_SISTEMA_CLINICORP };
    var opId = opIdDeAplicacao(x, ctx.auth);
    try {
      var op = { operacaoId: opId, tipo: "aplicar." + x.tipo, externo: x.id, assinatura: x.assinatura };
      var r = executarOperacao(ctx, op, function () { return planejarAplicacao(ctx, op, x.id, c, cx); });
      if (r.resultado === "sem_mudanca") saida.semMudanca++; else saida.aplicados++;
      if (r.pendencia) saida.pendencias++;
      esquecerLinhas();
      cx = contextoDeAplicacao(c);
    } catch (e) {
      saida.falhas++;
      registrarFalhaDeAplicacao(x, e, opId);
    }
  }
  return saida;
}

function registrarFalhaDeAplicacao(x, e, opId) {
  var msg = String((e && (e.mensagem || e.message)) || e).slice(0, 300);
  comTrava(function () {
    esquecerLinhas();
    var atual = acharPorChave("int_externos", x.id);
    if (!atual) return;
    var a = atual.aplicacao && atual.aplicacao.assinatura === atual.assinatura && atual.aplicacao.operacaoId === opId ? atual.aplicacao : {};
    var tent = (a.tentativas || 0) + 1;
    var reg = copiaLimpa(atual);
    reg.aplicacao = { assinatura: atual.assinatura, tentativas: tent, erro: msg, em: agoraISO(), resultado: "falhou", operacaoId: opId || "",
      reaberto: (atual.aplicacao && atual.aplicacao.reaberto) || "", estado: atual.aplicacao && atual.aplicacao.estado ? atual.aplicacao.estado : undefined };
    gravarPorChave("int_externos", reg);
    if (tent >= APL_MAX_TENTATIVAS) {
      var pid = "pd-" + sha256Hex("apl:" + atual.id + ":" + atual.assinatura).slice(0, 20);
      if (!acharPorChave("int_pendencias", pid)) {
        gravarPorChave("int_pendencias", { id: pid, recurso: atual.tipo, tipo: "aplicacao_falhou", chave: "apl:" + atual.id + ":" + atual.assinatura,
          externoId: atual.externoId, localTipo: "", localId: "", resumo: "Não deu para aplicar um registro do Clinicorp (" + atual.tipo + "): " + msg,
          detalhes: { externo: atual.id }, estado: "aberta", criadoEm: agoraISO(), resolvidoEm: null, resolvidoPor: "", resolucao: "",
          rev: 1, opId: "", atualizadoEm: agoraISO(), atualizadoPor: "Integração" });
      }
    }
  });
  if (!(e instanceof ErroApp)) registrarTecnico("ERROR", "CLINICORP_APLICACAO", x.id + " · " + msg.slice(0, 160));
}

/* O que a aplicação precisa saber, lido de uma vez. */
function contextoDeAplicacao(c) {
  var vinc = {}, recusados = {};
  lerTudo("int_vinculos").forEach(function (v) {
    if ((v.assinante || "") !== (c.assinante || "")) return;
    if (v.estado === "ativo") vinc[v.tipo + ":" + v.externoId + ":" + v.localTipo] = v;
    if (v.estado === "recusado") recusados[v.tipo + ":" + v.externoId + ":" + v.localTipo + ":" + v.localId] = true;
  });
  return { vinc: vinc, recusados: recusados };
}

/* A lead de um paciente externo: vínculo direto, ou pela paciente da Agenda
   vinculada que tem crmLeadId (dois vínculos explícitos em cadeia). */
function leadDoPaciente(cx, pacienteExternoId) {
  if (!pacienteExternoId) return null;
  var direto = cx.vinc["paciente:" + pacienteExternoId + ":lead"];
  if (direto) return direto.localId;
  var pac = cx.vinc["paciente:" + pacienteExternoId + ":paciente"];
  if (!pac) return null;
  var p = acharPorChave("agenda_pacientes", pac.localId);
  return p && p.crmLeadId ? p.crmLeadId : null;
}

/* ---------------------------------------------------------------------
   O planejamento de UM registro: devolve as escritas do módulo + o carimbo
   de "aplicado" no próprio registro externo, numa operação só.
   --------------------------------------------------------------------- */
function planejarAplicacao(ctx, op, idExterno, c, cx) {
  var x = acharPorChave("int_externos", idExterno);
  if (!x || x.aplicado === x.assinatura) return { escritas: [], resultado: { resultado: "sem_mudanca" } };
  var pol = politicaClinicorp(c);
  var plano;
  if (x.tipo === "recebimento") plano = aplicarRecebimento(ctx, op, x, pol, cx);
  else if (x.tipo === "orcamento") plano = aplicarOrcamento(ctx, op, x, pol, cx);
  else if (x.tipo === "agendamento") plano = aplicarAgendamento(ctx, op, x, pol, cx);
  else plano = { escritas: [], resultado: "sem_mudanca" };
  var reg = copiaLimpa(x);
  reg.aplicado = x.assinatura;
  reg.aplicadoEm = agoraISO();
  reg.aplicacao = { assinatura: x.assinatura, tentativas: 0, resultado: plano.resultado, mensagem: plano.mensagem || "",
    estado: plano.estado || (x.aplicacao && x.aplicacao.estado) || null, em: agoraISO() };
  var escritas = (plano.escritas || []).concat(plano.pendencias || []);
  escritas.push({ t: "gravar", tabela: "int_externos", registro: reg });
  /* aplicou: a pendência "aplicação falhou" deste registro deixa de valer */
  lerTudo("int_pendencias").forEach(function (p) {
    if (p.tipo !== "aplicacao_falhou" || p.estado !== "aberta" || String(p.chave || "").indexOf("apl:" + x.id + ":") !== 0) return;
    var rp = copiaLimpa(p);
    rp.estado = "resolvida"; rp.resolvidoEm = agoraISO(); rp.resolvidoPor = "Integração"; rp.resolucao = "aplicado numa nova tentativa";
    carimbar(rp, (Number(p.rev) || 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "int_pendencias", registro: rp });
  });
  return { escritas: escritas, resultado: { resultado: plano.resultado, pendencia: !!(plano.pendencias && plano.pendencias.length) } };
}

function pendenciaNova(recurso, tipo, chave, externoId, localTipo, localId, resumo, detalhes) {
  var id = "pd-" + sha256Hex(chave).slice(0, 20);
  if (acharPorChave("int_pendencias", id)) return null;
  return { t: "gravar", tabela: "int_pendencias", registro: { id: id, recurso: recurso, tipo: tipo, chave: chave, externoId: externoId,
    localTipo: localTipo || "", localId: localId || "", resumo: String(resumo).slice(0, 500), detalhes: detalhes || null, estado: "aberta",
    criadoEm: agoraISO(), resolvidoEm: null, resolvidoPor: "", resolucao: "", rev: 1, opId: "", atualizadoEm: agoraISO(), atualizadoPor: "Integração" } };
}

/* ---------------- recebimento → Entradas ----------------
   Um pagamento (parcela) do Clinicorp = uma entrada do Alveare, no máximo.
   Entradas e Financeiro leem a MESMA entrada: o evento econômico não é
   somado duas vezes. */
function aplicarRecebimento(ctx, op, x, pol, cx) {
  var r = x.dados || {};
  var recebido = !!(r.recebido || r.confirmado);
  var v = cx.vinc["recebimento:" + x.externoId + ":entrada"];
  if (v) {
    var e = acharPorChave("ent_entradas", v.localId);
    if (!e) return { escritas: [], resultado: "sem_mudanca", mensagem: "a entrada vinculada não existe mais (lixeira?): não é recriada" };
    return atualizarEntradaVinculada(ctx, op, x, r, e, recebido);
  }
  if (!recebido) return { escritas: [], resultado: "sem_mudanca", mensagem: "ainda não recebido no Clinicorp: fica só como consulta" };
  if (x.aplicacao && x.aplicacao.estado && x.aplicacao.estado.anterior) {
    return { escritas: [], resultado: "sem_mudanca", mensagem: "importado antes da automação: fica como consulta (para não duplicar lançamento manual)" };
  }
  if (!pol.criarEntradas) return { escritas: [], resultado: "sem_mudanca", mensagem: "política: só consulta" };
  /* entrada manual parecida (mesmo dia e valor) sem vínculo: pode ser o
     mesmo pagamento — pergunta só sobre este caso, não cria em dobro */
  var dia = r.recebidoEm || r.confirmadoEm || r.pagoEm;
  var idPag = agrupar(lerTudo("ent_pagamentos"), "entradaId");
  var vinculadas = {};
  Object.keys(cx.vinc).forEach(function (k) { if (cx.vinc[k].localTipo === "entrada") vinculadas[cx.vinc[k].localId] = true; });
  var candidatas = lerTudo("ent_entradas").filter(function (e2) {
    return !vinculadas[e2.id] && e2.data === dia && totalPagamentos(idPag[e2.id]) === r.valor &&
      !cx.recusados["recebimento:" + x.externoId + ":entrada:" + e2.id];
  }).map(function (e2) { return e2.id; });
  if (candidatas.length) {
    var p = pendenciaNova("recebimentos", "conciliacao", "rec:" + x.assinante + ":" + x.externoId, x.externoId, "entrada", "",
      "Recebimento do Clinicorp de " + resumoRecebimento(r) + " pode ser uma entrada que já existe. Confirme na entrada para não contar duas vezes.",
      { candidatas: candidatas.slice(0, 5) });
    return { escritas: [], pendencias: p ? [p] : [], resultado: "aguardando_decisao" };
  }
  var metodo = metodoDaForma(r.forma);
  if (!metodo) {
    var p2 = pendenciaNova("recebimentos", "dado_ausente", "forma:" + x.assinante + ":" + x.externoId, x.externoId, "", "",
      "Recebimento do Clinicorp de " + resumoRecebimento(r) + ": a forma \"" + (r.forma || "não informada") + "\" não tem equivalente seguro nas Entradas. Escolha a forma para ele entrar.", null);
    return { escritas: [], pendencias: p2 ? [p2] : [], resultado: "aguardando_decisao" };
  }
  var plano = planejarImportarRecebimento(ctx, op, x.externoId, metodo);
  return { escritas: plano.escritas, resultado: "criado", mensagem: "entrada " + plano.resultado.entradaId };
}

function atualizarEntradaVinculada(ctx, op, x, r, e, recebido) {
  var idPag = agrupar(lerTudo("ent_pagamentos"), "entradaId");
  var pags = pagamentosDaEntrada(idPag, e.id);
  var antes = entradaPublica(e, idPag);
  var escritas = [], eventos = [], raiz = {};
  var estadoAntes = e.externoEstado || "";
  if (!recebido && estadoAntes !== "estornado") {
    raiz.externoEstado = "estornado";
    eventos.push(evento("entradas", "entrada", e.id, "alterou", "Situação no Clinicorp", "recebido", "estornado/desfeito no Clinicorp", "Clinicorp"));
  } else if (recebido && estadoAntes === "estornado") {
    raiz.externoEstado = "";
    eventos.push(evento("entradas", "entrada", e.id, "alterou", "Situação no Clinicorp", "estornado", "recebido de novo", "Clinicorp"));
  }
  if (recebido) {
    var dia = r.recebidoEm || r.confirmadoEm || r.pagoEm;
    if (dia && dia !== e.data) {
      raiz.data = dia;
      eventos.push(evento("entradas", "entrada", e.id, "alterou", "Data", dataBR(e.data), dataBR(dia), "Clinicorp"));
    }
    if (r.valor !== null && r.valor !== undefined && totalPagamentos(pags) !== r.valor) {
      if (pags.length !== 1) {
        /* entrada dividida em várias formas: não há como saber qual parte
           mudou — conflito real, uma pessoa decide */
        var p = pendenciaNova("recebimentos", "divergencia", "rec-div:" + x.assinante + ":" + x.externoId + ":" + x.assinatura.slice(0, 8), x.externoId,
          "entrada", e.id, "O valor deste recebimento mudou no Clinicorp (" + resumoRecebimento(r) + "), mas a entrada está dividida em várias formas. Ajuste a entrada.", null);
        return { escritas: [], pendencias: p ? [p] : [], resultado: "conflito" };
      }
      var pg = pags[0];
      escritas.push({ t: "gravar", tabela: "ent_pagamentos", registro: { id: pg.id, entradaId: e.id, ordem: 0, metodo: pg.metodo, valor: r.valor, parcelas: pg.parcelas } });
      eventos.push(evento("entradas", "entrada", e.id, "alterou", "Valor", dinheiroBR(totalPagamentos(pags)), dinheiroBR(r.valor), "Clinicorp"));
    }
  }
  if (!escritas.length && !Object.keys(raiz).length) return { escritas: [], resultado: "sem_mudanca" };
  var rev = (Number(e.rev) || 0) + 1;
  var reg = carimbar(registroCompleto("ent_entradas", raiz, e), rev, ctx, op.operacaoId);
  escritas = escritas.concat(escritasDeAuditoria(ctx, eventos, op.operacaoId));
  escritas.push({ t: "gravar", tabela: "ent_entradas", registro: reg });
  void antes;
  return { escritas: escritas, resultado: "atualizado" };
}

/* ---------------- orçamento → CRM ---------------- */
function aplicarOrcamento(ctx, op, x, pol, cx) {
  var o = x.dados || {};
  var leadId = leadDoPaciente(cx, o.pacienteExternoId);
  var estadoAnterior = (x.aplicacao && x.aplicacao.estado) || {};
  if (!leadId) {
    var sug = sugestaoDeIdentidade(cx, o);
    return { escritas: [], pendencias: sug ? [sug] : [], resultado: "sem_mudanca", mensagem: "paciente sem lead vinculada: só contexto", estado: { status: o.status } };
  }
  var regra = pol.eventosOrcamento[o.status] || "contexto";
  var ev = CLINICORP_EVENTOS_ORCAMENTO[o.status];
  var mudouStatus = estadoAnterior.status !== o.status;
  if (!ev || regra === "contexto" || !mudouStatus) return { escritas: [], resultado: "sem_mudanca", estado: { status: o.status, leadId: leadId } };
  var lead = acharPorChave("crm_leads", leadId);
  if (!lead) return { escritas: [], resultado: "sem_mudanca", estado: { status: o.status } };
  if (regra === "propor") {
    var p = pendenciaNova("orcamentos", "proposta_etapa", "orc:" + x.assinante + ":" + x.externoId + ":" + o.status, x.externoId, "lead", leadId,
      ev.nome + " no Clinicorp" + (o.valor !== null ? " (" + dinheiroBR(o.valor) + ")" : "") + " — mover para " + nomeEtapa(ev.etapas[0]) + "?",
      { etapa: ev.etapas[0], de: ev.de, status: o.status, valor: o.valor });
    return { escritas: [], pendencias: p ? [p] : [], resultado: "aguardando_decisao", estado: { status: o.status, leadId: leadId } };
  }
  /* aplicar: só a partir das etapas de origem; fora delas não é erro —
     a lead já seguiu outro caminho no CRM, e o CRM manda no funil */
  if (ev.de.indexOf(lead.etapa) < 0) {
    return { escritas: [], resultado: "sem_mudanca", mensagem: "lead em " + nomeEtapa(lead.etapa) + ": o CRM não muda", estado: { status: o.status, leadId: leadId } };
  }
  var escritas = escritasAplicarEtapa(ctx, op, { localId: leadId, detalhes: { etapa: ev.etapas[0], de: ev.de, status: o.status } });
  return { escritas: escritas, resultado: "atualizado", mensagem: "lead → " + nomeEtapa(ev.etapas[0]), estado: { status: o.status, leadId: leadId } };
}

/* "Este é o mesmo paciente?" — só quando DOIS sinais batem (telefone com
   DDD e nome) numa lead só, e ninguém já disse que não é. Nunca vincula
   sozinho. */
function sugestaoDeIdentidade(cx, o) {
  var fone = soDigitos(o.pacienteTelefone || "");
  if (fone.length < 10 || !o.pacienteNome || !o.pacienteExternoId) return null;
  var nome = chaveDeNome(o.pacienteNome);
  var achadas = lerTudo("crm_leads").filter(function (l) {
    var f = soDigitos(l.whatsapp || "");
    return f.length >= 10 && f.slice(-10) === fone.slice(-10) && chaveDeNome(l.nome) === nome;
  });
  if (achadas.length !== 1) return null;
  var l = achadas[0];
  if (cx.recusados["paciente:" + o.pacienteExternoId + ":lead:" + l.id]) return null;
  if (cx.vinc["paciente:" + o.pacienteExternoId + ":lead"]) return null;
  return pendenciaNova("pacientes", "identidade", "id:" + o.pacienteExternoId + ":lead:" + l.id, o.pacienteExternoId, "lead", l.id,
    "O paciente " + o.pacienteNome + " do Clinicorp tem o mesmo nome e telefone desta lead. É a mesma pessoa?", { pacienteNome: o.pacienteNome });
}

/* ---------------- agendamento → Agenda ----------------
   Só de paciente vinculada, só com área mapeada pelo profissional, só de
   hoje em diante (o passado é contexto: a Agenda não vira sessão por um
   agendamento importado). Passa por planejarPaciente — série, eco no CRM
   e auditoria são as regras de sempre. */
function aplicarAgendamento(ctx, op, x, pol, cx) {
  var a = x.dados || {};
  var vPac = a.pacienteExternoId ? cx.vinc["paciente:" + a.pacienteExternoId + ":paciente"] : null;
  if (!vPac) return { escritas: [], resultado: "sem_mudanca", mensagem: "paciente não vinculada: só contexto" };
  var area = pol.areaPorProfissional[a.profissionalId] || "";
  if (AREAS_AGENDA.indexOf(area) < 0) return { escritas: [], resultado: "sem_mudanca", mensagem: "profissional sem área configurada: só contexto" };
  var vAg = cx.vinc["agendamento:" + x.externoId + ":agendamento"];
  var dataAntiga = vAg ? String(vAg.localId).split("|")[2] : "";
  var hoje = hojeNaClinica();
  var desmarcado = a.cancelado || a.excluido;
  var nova = desmarcado || !a.dia || a.dia < hoje ? "" : a.dia;
  if (!vAg && !nova) return { escritas: [], resultado: "sem_mudanca", mensagem: desmarcado ? "desmarcado" : "passado: só contexto" };

  var pid = vPac.localId;
  var atual = acharPorChave("agenda_pacientes", pid);
  if (!atual) return { escritas: [], resultado: "sem_mudanca", mensagem: "paciente local não existe mais" };
  var idx = indiceDaAgenda();
  var pub = pacientePublica(atual, idx);
  var ciclo = pub.ciclos[area];
  if (!ciclo) {
    var p = pendenciaNova("agendamentos", "dado_ausente", "ciclo:" + pid + ":" + area, x.externoId, "paciente", pid,
      "Há agendamento de " + (AREAS_NOME[area] || area) + " no Clinicorp para " + (atual.nome || "esta paciente") + ", mas ela não tem esse ciclo na Agenda. Crie o ciclo e os próximos agendamentos entram sozinhos.",
      { area: area });
    return { escritas: [], pendencias: p ? [p] : [], resultado: "aguardando_decisao", mensagem: "sem ciclo de " + area };
  }
  var datas = marcadasDoCiclo(ciclo).filter(function (d) { return d !== dataAntiga || (dataAntiga === nova); });
  if (nova && datas.indexOf(nova) < 0) datas.push(nova);
  datas.sort();
  var novoCiclo = JSON.parse(JSON.stringify(ciclo));
  novoCiclo.agendamento = datas.length ? { data: datas[0], temFollowUp: !!(ciclo.agendamento && ciclo.agendamento.data === datas[0] && ciclo.agendamento.temFollowUp) } : null;
  novoCiclo.proximos = datas.slice(1);
  var escritas = [];
  var mudouSerie = canonico(marcadasDoCiclo(ciclo)) !== canonico(datas);
  if (mudouSerie) {
    var opPac = { operacaoId: op.operacaoId, tipo: "paciente.alterar", id: pid, revBase: Number(atual.rev) || 0, ciclos: {} };
    opPac.ciclos[area] = novoCiclo;
    var plano = planejarPaciente(ctx, opPac, false);
    escritas = escritas.concat(plano.escritas || []);
  }
  var c = configClinicorp();
  var idV = idDoVinculo("agendamento", x.externoId, "agendamento", x.assinante);
  if (nova) {
    escritas.push({ t: "gravar", tabela: "int_vinculos", registro: carimbar(registroCompleto("int_vinculos", { id: idV, sistema: "clinicorp",
      assinante: x.assinante, unidade: c.unidade || "", tipo: "agendamento", externoId: x.externoId, localTipo: "agendamento",
      localId: pid + "|" + area + "|" + nova, estado: "ativo", assinatura: x.assinatura, sincronizadoEm: agoraISO(),
      criadoEm: vAg ? vAg.criadoEm : agoraISO(), criadoPor: vAg ? vAg.criadoPor : "Integração" }, vAg), (vAg ? Number(vAg.rev) || 0 : 0) + 1, ctx, op.operacaoId) });
  } else if (vAg) {
    var desfeito = copiaLimpa(vAg); desfeito.estado = "desfeito"; desfeito.assinatura = x.assinatura;
    escritas.push({ t: "gravar", tabela: "int_vinculos", registro: carimbar(desfeito, (Number(vAg.rev) || 0) + 1, ctx, op.operacaoId) });
  }
  return { escritas: escritas, resultado: mudouSerie ? "atualizado" : "sem_mudanca",
    mensagem: nova ? (dataAntiga && dataAntiga !== nova ? "remarcado " + dataBR(dataAntiga) + " → " + dataBR(nova) : "agendado " + dataBR(nova)) : "desmarcado" };
}

function entradaVinculadaAoClinicorp(entradaId) {
  var c = configClinicorp();
  return lerTudo("int_vinculos").some(function (v) {
    return v.estado === "ativo" && v.tipo === "recebimento" && v.localTipo === "entrada" && v.localId === entradaId && (v.assinante || "") === (c.assinante || "");
  });
}

/* Proteção da Agenda: uma data que veio do Clinicorp não é remarcada nem
   apagada por uma edição local — ela seria refeita na próxima
   sincronização. Chamada por planejarPaciente para quem não é a integração. */
function datasExternasProtegidas(ctx, pid, antes, depois) {
  if (!antes || (ctx.auth && ctx.auth.tipo === "sistema") || String(ctx.acao || "").indexOf("integracao") >= 0) return;
  var c = configClinicorp();
  var protegidas = lerTudo("int_vinculos").filter(function (v) {
    return v.estado === "ativo" && v.tipo === "agendamento" && v.localTipo === "agendamento" && String(v.localId).indexOf(pid + "|") === 0 &&
      (v.assinante || "") === (c.assinante || "");
  });
  protegidas.forEach(function (v) {
    var partes = String(v.localId).split("|");
    var area = partes[1], data = partes[2];
    var marcadas = marcadasDoCiclo(depois.ciclos[area]);
    if (marcadas.indexOf(data) < 0 && data >= hojeNaClinica()) {
      falhar("dados_invalidos", "O agendamento de " + dataBR(data) + " (" + (AREAS_NOME[area] || area) + ") vem do Clinicorp: remarque ou desmarque lá. A Agenda acompanha na próxima atualização.", { campo: "ciclos" });
    }
  });
}
