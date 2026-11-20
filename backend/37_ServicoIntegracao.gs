/* =====================================================================
   37_ServicoIntegracao — a integração central (hoje: Clinicorp)
   ---------------------------------------------------------------------
   A área de integrações mora no painel de manutenção. Os módulos só
   mostram contexto (integracao.contexto): origem, vínculo e estado de
   sincronização — lidos da planilha, sem chamar o Clinicorp ao abrir.

   Propriedade dos dados:
   · cadência, contatos e funil: do CRM do Alveare;
   · orçamentos, agendamentos e recebimentos do Clinicorp: registros
     EXTERNOS identificados (int_externos), com o complemento local à
     parte — atualizar do Clinicorp nunca apaga o complemento;
   · despesas e composições de custo: do Alveare.

   Sincronização (integracao.executar):
   · prévia primeiro (contagens, nada gravado além do histórico);
   · importação em janelas (≤ 31 dias), com ponto de retomada
     (cursor) gravado depois de cada janela; cada pedaço gravado é uma
     operação no diário, com operacaoId derivado do conteúdo;
   · exclusão mútua por recurso (FLORESER_INT_TRAVA_<RECURSO>);
   · incremental: da última data importada menos a janela de reconsulta;
   · ausência numa resposta filtrada NÃO é exclusão: vira "ausente desde";
   · chamadas ao Clinicorp sempre fora da trava do script.

   Escrita no Clinicorp (criar paciente, enviar lead) é sempre um pedido
   explícito do painel, com passos registrados (int_passos):
     enviando → confirmado | recusado | desconhecido
   "desconhecido" bloqueia o reenvio até alguém verificar.
   ===================================================================== */

var INT_TEMPO_WEB_MS = 22000;          // um pedido do painel: volta antes do prazo do navegador
var INT_TEMPO_AGENDADO_MS = 240000;    // gatilho de tempo: até 4 min
var INT_TRAVA_MS = 7 * 60000;
var INT_PEDACO_BYTES = 80000;
var AUTH_SISTEMA_CLINICORP = { tipo: "sistema", usuarioId: "sistema:clinicorp", usuarioNome: "Sincronização agendada (Clinicorp)", modulo: "", admin: false };

/* ---------------------------------------------------------------------
   Estado e configuração (painel)
   --------------------------------------------------------------------- */

function situacaoClinicorp(c) {
  var imp = impedimentoClinicorp(c);
  return imp === "" ? "ativa" : imp;
}

function matrizPublica(c) {
  var v = (c.verificacao && c.verificacao.resultados) || {};
  return Object.keys(CLINICORP_OPERACOES).map(function (id) {
    var op = CLINICORP_OPERACOES[id];
    var r = v[id];
    return { id: id, metodo: op.metodo.toUpperCase(), caminho: op.caminho, efeito: op.efeito, direcao: op.direcao,
      parametros: op.parametros, granularidade: op.granularidade, limitacoes: op.limitacoes, implementado: op.implementado,
      verificacao: !op.implementado ? "nao_implementada" : op.efeito === "mutacao" ? "documentada_nao_verificada" :
        r ? (r.ok ? "verificada" : "falhou") : "nao_verificada",
      verificadaEm: r ? r.em : "", detalhe: r ? r.mensagem || "" : "" };
  });
}

function integracaoEstado() {
  _PROPS = null;
  var c = configClinicorp();
  var pend = lerTudo("int_pendencias").filter(function (p) { return p.estado === "aberta"; });
  var passos = lerTudo("int_passos").filter(function (p) { return p.estado === "desconhecido" || p.estado === "enviando"; });
  return {
    sistema: "clinicorp",
    situacao: situacaoClinicorp(c),
    credenciais: !!credenciaisClinicorp(),
    config: { assinante: c.assinante, unidade: c.unidade, recursos: c.recursos, frequenciaHoras: c.frequenciaHoras,
      janelaReconsultaDias: c.janelaReconsultaDias, eventosOrcamento: c.eventosOrcamento, campanhaPadrao: c.campanhaPadrao,
      valorSemTaxas: !!c.valorSemTaxas, recebimentosPor: c.recebimentosPor || "" },
    suspensa: c.suspensa, desconectadaEm: c.desconectadaEm, verificadaEm: c.verificacao ? c.verificacao.em : "",
    ultimas: c.ultimas || {},
    recursos: Object.keys(CLINICORP_RECURSOS).map(function (k) {
      var r = CLINICORP_RECURSOS[k];
      return { id: k, nome: r.nome, modos: r.modos, modo: modoDoRecurso(c, k), modulos: r.modulos, operacao: r.operacao,
        lote: !r.semLote, travado: travaDoRecurso(k) ? true : false };
    }),
    eventosOrcamento: Object.keys(CLINICORP_EVENTOS_ORCAMENTO).map(function (k) {
      return { status: k, nome: CLINICORP_EVENTOS_ORCAMENTO[k].nome, etapa: CLINICORP_EVENTOS_ORCAMENTO[k].etapas[0],
        regra: (c.eventosOrcamento || {})[k] || "contexto" };
    }),
    matriz: matrizPublica(c),
    pendenciasAbertas: pend.length,
    passosIncertos: passos.length,
    execucoes: lerUltimas("int_execucoes", 15).reverse().map(execucaoPublica),
    agendamento: gatilhoAgendado() ? { frequenciaHoras: c.frequenciaHoras } : null
  };
}

function execucaoPublica(e) {
  return { id: e.id, recurso: e.recurso, modo: e.modo, estado: e.estado, origem: e.origem, autor: e.autor,
    iniciadoEm: e.iniciadoEm, concluidoEm: e.concluidoEm, atualizadoEm: e.atualizadoEm, de: e.de, ate: e.ate,
    contagens: e.contagens || {}, erros: (e.erros || []).slice(-5), cursor: e.cursor || null };
}

function integracaoConfigurar(ctx) {
  var d = ctx.dados || {};
  var c = alterarConfigClinicorp(function (c) {
    if (d.assinante !== undefined) {
      var a = String(d.assinante || "").trim();
      if (a && !/^[A-Za-z0-9_.@-]{1,80}$/.test(a)) falhar("dados_invalidos", "Assinante inválido.");
      c.assinante = a;
    }
    if (d.unidade !== undefined) {
      var u = String(d.unidade || "").trim();
      if (u && !/^\d{1,20}$/.test(u)) falhar("dados_invalidos", "A unidade é o id numérico da clínica no Clinicorp.");
      c.unidade = u;
    }
    if (d.recursos && typeof d.recursos === "object") {
      Object.keys(d.recursos).forEach(function (k) {
        var def = CLINICORP_RECURSOS[k];
        if (!def) falhar("dados_invalidos", "Recurso desconhecido: " + k + ".");
        var modo = String((d.recursos[k] || {}).modo || "desligado");
        if (def.modos.indexOf(modo) < 0) falhar("dados_invalidos", "Modo " + modo + " não existe para " + def.nome + ".");
        c.recursos[k] = { modo: modo, em: agoraISO() };
      });
    }
    if (d.janelaReconsultaDias !== undefined) {
      var j = Number(d.janelaReconsultaDias);
      if (!Number.isInteger(j) || j < 0 || j > 31) falhar("dados_invalidos", "Janela de reconsulta: de 0 a 31 dias.");
      c.janelaReconsultaDias = j;
    }
    if (d.eventosOrcamento && typeof d.eventosOrcamento === "object") {
      Object.keys(d.eventosOrcamento).forEach(function (k) {
        if (!CLINICORP_EVENTOS_ORCAMENTO[k]) falhar("dados_invalidos", "Status de orçamento desconhecido.");
        var r = String(d.eventosOrcamento[k]);
        if (["contexto", "propor"].indexOf(r) < 0) falhar("dados_invalidos", "Regra: contexto ou propor.");
        c.eventosOrcamento[k] = r;
      });
    }
    if (d.campanhaPadrao !== undefined) c.campanhaPadrao = String(d.campanhaPadrao || "").slice(0, 120);
    if (d.valorSemTaxas !== undefined) c.valorSemTaxas = d.valorSemTaxas === true;
    if (d.recebimentosPor !== undefined) {
      if (["", "postDate", "checkoutDate"].indexOf(String(d.recebimentosPor)) < 0) falhar("dados_invalidos", "Data de filtro desconhecida.");
      c.recebimentosPor = String(d.recebimentosPor);
    }
  });
  registrarTecnico("INFO", "INTEGRACAO_CONFIGURADA", "Configuração do Clinicorp alterada pelo painel.");
  return integracaoEstado();
}

/* ---------------------------------------------------------------------
   Teste de conexão e verificação das leituras
   ---------------------------------------------------------------------
   Conectar não prova tudo: cada leitura é chamada uma vez, com a menor
   janela possível, e só o que respondeu fica "verificada". Escrita nunca
   é chamada para testar. */

function integracaoTestar() {
  _PROPS = null;
  var c = configClinicorp();
  if (!credenciaisClinicorp()) falhar("integracao_nao_configurada", "Faltam FLORESER_CLINICORP_USUARIO e FLORESER_CLINICORP_TOKEN nas propriedades do script.");
  if (!c.assinante) falhar("integracao_nao_configurada", "Informe o assinante (subscriber_id) antes de testar.");
  var hoje = hojeNaClinica();
  var testes = [
    ["unidades.listar", {}], ["profissionais.listar", {}], ["agendamentos.status", {}],
    ["orcamentos.listar", { from: hoje, to: hoje }], ["agendamentos.listar", { from: hoje, to: hoje }],
    ["recebimentos.listar", { from: hoje, to: hoje }], ["crm.campanhas", {}], ["procedimentos.listar", {}],
    ["financeiro.resumo", { from: hoje, to: hoje }]
  ];
  var resultados = {}, conectou = false, unidades = [];
  for (var i = 0; i < testes.length; i++) {
    var id = testes[i][0];
    try {
      var r = chamarClinicorp(id, testes[i][1]);
      resultados[id] = { ok: true, em: agoraISO(), mensagem: Array.isArray(r) ? r.length + " item(ns)" : "respondeu" };
      if (id === "unidades.listar") {
        conectou = true;
        unidades = (Array.isArray(r) ? r : []).map(function (x) { return normalizarSimples("unidade", x); }).filter(Boolean);
      }
    } catch (e) {
      if (!(e instanceof ErroClinicorp)) throw e;
      resultados[id] = { ok: false, em: agoraISO(), mensagem: e.mensagem, status: e.status };
      if (e.tipo === "autenticacao") {
        suspenderPorAutenticacao(e, "teste de conexão");
        break;
      }
      if (e.tipo === "limite") break;
    }
  }
  var verificadas = Object.keys(resultados).filter(function (k) { return resultados[k].ok; }).length;
  alterarConfigClinicorp(function (cfg) {
    cfg.verificacao = { em: agoraISO(), resultados: resultados, resumo: verificadas + " de " + testes.length + " leituras responderam" };
    if (conectou && cfg.suspensa && cfg.suspensa.motivo === "autenticacao") cfg.suspensa = null;
  });
  registrarTecnico(conectou ? "INFO" : "WARNING", "CLINICORP_TESTE", "Teste de conexão: " + verificadas + "/" + testes.length + " leituras verificadas.");
  var estado = integracaoEstado();
  estado.teste = { conectou: conectou, verificadas: verificadas, total: testes.length, unidades: unidades };
  return estado;
}

/* ---------------------------------------------------------------------
   Exclusão mútua por recurso
   --------------------------------------------------------------------- */

function chaveDaTrava(recurso) { return "FLORESER_INT_TRAVA_" + recurso.toUpperCase(); }

function travaDoRecurso(recurso) {
  _PROPS = null;
  var t = null;
  try { t = JSON.parse(propriedade(chaveDaTrava(recurso), "null")); } catch (e) { t = null; }
  if (!t || Number(t.ate) < Date.now()) return null;
  return t;
}

function pegarTravaDoRecurso(recurso, execucaoId) {
  return comTrava(function () {
    var t = travaDoRecurso(recurso);
    if (t && t.execucaoId !== execucaoId) falhar("ocupado", "Já existe uma sincronização de " + CLINICORP_RECURSOS[recurso].nome + " em andamento.");
    definirPropriedade(chaveDaTrava(recurso), JSON.stringify({ execucaoId: execucaoId, ate: Date.now() + INT_TRAVA_MS }));
    return true;
  });
}

function soltarTravaDoRecurso(recurso, execucaoId) {
  comTrava(function () {
    var t = travaDoRecurso(recurso);
    if (!t || t.execucaoId === execucaoId) definirPropriedade(chaveDaTrava(recurso), null);
  });
}

/* ---------------------------------------------------------------------
   Janelas
   --------------------------------------------------------------------- */

function janelasDoPeriodo(de, ate, maxDias) {
  var saida = [], ini = de, guarda = 0;
  while (ini <= ate && guarda++ < 400) {
    var fim = finSomarDias(ini, Math.max(1, maxDias) - 1);
    if (fim > ate) fim = ate;
    saida.push({ de: ini, ate: fim });
    ini = finSomarDias(fim, 1);
  }
  return saida;
}

function periodoPadrao(recurso, c) {
  var def = CLINICORP_RECURSOS[recurso];
  var hoje = hojeNaClinica();
  var ultima = (c.ultimas || {})[recurso];
  if (!ultima || !ultima.ate) return null;
  var de = finSomarDias(ultima.ate > hoje ? hoje : ultima.ate, -(Number(c.janelaReconsultaDias) || 0));
  return { de: de, ate: finSomarDias(hoje, def.futuroDias || 0) };
}

/* ---------------------------------------------------------------------
   Sincronização
   --------------------------------------------------------------------- */

function integracaoExecutar(ctx) {
  var d = ctx.dados || {};
  return executarSincronizacao(String(d.recurso || ""), String(d.modo || "previa"),
    { de: d.de, ate: d.ate, retomar: d.retomar, previaId: d.previaId, execucaoId: d.execucaoId },
    ctx.auth, "manual", INT_TEMPO_WEB_MS, ctx);
}

function executarSincronizacao(recurso, modo, o, auth, origem, orcamentoMs, ctxBase) {
  var inicio = Date.now();
  _PROPS = null;
  var c = configClinicorp();
  var def = CLINICORP_RECURSOS[recurso];
  if (!def || def.semLote && recurso !== "catalogo" && recurso !== "crm" && recurso !== "resumo") falhar("dados_invalidos", "Recurso sem sincronização em lote.");
  if (["previa", "importacao"].indexOf(modo) < 0) falhar("dados_invalidos", "Modo: previa ou importacao.");
  exigirClinicorpPronto(c);
  var modoCfg = modoDoRecurso(c, recurso);
  if (modoCfg === "desligado") falhar("dados_invalidos", def.nome + " está desligado na configuração.");
  if (modo === "importacao" && modoCfg !== "importacao" && !(def.semLote && modoCfg !== "desligado")) {
    falhar("dados_invalidos", def.nome + " está em modo consulta: a importação precisa ser ligada antes.");
  }

  /* execução: nova, ou a interrompida que continua */
  var exec = null;
  if (o.retomar && o.execucaoId) {
    exec = acharPorChave("int_execucoes", String(o.execucaoId));
    if (!exec || exec.recurso !== recurso || ["interrompida", "rodando"].indexOf(exec.estado) < 0) falhar("dados_invalidos", "Não há execução para retomar com esse id.");
  }
  if (!exec) {
    var periodo;
    if (def.semLote && recurso !== "resumo") periodo = { de: hojeNaClinica(), ate: hojeNaClinica() };
    else if (o.de || o.ate) {
      if (!dataValida(String(o.de)) || !dataValida(String(o.ate)) || o.ate < o.de) falhar("dados_invalidos", "Período inválido.");
      if (finSomarDias(String(o.de), 3660) < String(o.ate)) falhar("dados_invalidos", "Período longo demais (até 10 anos).");
      periodo = { de: String(o.de), ate: String(o.ate) };
    } else {
      periodo = periodoPadrao(recurso, c);
      if (!periodo) falhar("dados_invalidos", "Primeira sincronização: informe o período e faça a prévia antes.");
    }
    if (modo === "importacao" && !def.semLote && !(c.ultimas || {})[recurso]) {
      /* a primeira importação exige uma prévia concluída do mesmo período */
      var previa = o.previaId ? acharPorChave("int_execucoes", String(o.previaId)) : null;
      if (!previa || previa.modo !== "previa" || previa.estado !== "concluida" || previa.recurso !== recurso ||
          previa.de !== periodo.de || previa.ate !== periodo.ate) {
        falhar("sem_confirmacao", "A primeira importação de " + def.nome + " precisa da prévia concluída do mesmo período.");
      }
    }
    exec = { id: novoId("ex"), recurso: recurso, modo: modo, estado: "rodando", origem: origem, autor: assinaturaDe(auth).nome,
      iniciadoEm: agoraISO(), atualizadoEm: agoraISO(), concluidoEm: null, de: periodo.de, ate: periodo.ate,
      cursor: { janela: 0 }, contagens: { novos: 0, alterados: 0, iguais: 0, ausentes: 0, reapareceram: 0, pendencias: 0, recebidos: 0, chamadas: 0 },
      erros: [] };
    comTrava(function () { inserir("int_execucoes", [exec]); });
  }

  pegarTravaDoRecurso(recurso, exec.id);
  var janelas = def.semLote && recurso !== "resumo" ? [{ de: exec.de, ate: exec.ate }] : janelasDoPeriodo(exec.de, exec.ate, def.janelaMaxDias || 31);
  var amostra = [];
  try {
    var cx = contextoDeConciliacao(def.tipo);
    while ((exec.cursor.janela || 0) < janelas.length) {
      if (Date.now() - inicio > orcamentoMs) break;
      var j = janelas[exec.cursor.janela];
      var antesCham = _CLINICORP_CHAMADAS;
      var recebidos;
      if (recurso === "catalogo") recebidos = (function () { var r = chamarClinicorp("procedimentos.listar", {}); return (Array.isArray(r) ? r : []).map(function (x) { return normalizarSimples("procedimento", x); }).filter(Boolean); })();
      else if (recurso === "crm") recebidos = (function () { var r = chamarClinicorp("crm.campanhas", {}); return (Array.isArray(r) ? r : []).map(function (x) { return normalizarSimples("campanha", x); }).filter(Boolean); })();
      else recebidos = buscarJanelaClinicorp(recurso, j.de, j.ate, c, cx);
      exec.contagens.chamadas = (exec.contagens.chamadas || 0) + (_CLINICORP_CHAMADAS - antesCham);
      exec.contagens.recebidos = (exec.contagens.recebidos || 0) + recebidos.length;
      var diff = compararJanela(def.tipo, recebidos, j, c, cx);
      exec.contagens.novos += diff.novos.length;
      exec.contagens.alterados += diff.alterados.length;
      exec.contagens.iguais += diff.iguais;
      exec.contagens.ausentes += diff.ausentes.length;
      exec.contagens.reapareceram += diff.reapareceram.length;
      exec.contagens.pendencias += diff.pendencias.length;
      if (amostra.length < 8) diff.novos.concat(diff.alterados).slice(0, 8 - amostra.length).forEach(function (x) { amostra.push(resumoExterno(def.tipo, x.depois)); });
      if (modo === "importacao") gravarJanela(ctxBase, auth, exec, def.tipo, diff, j);
      exec.cursor = { janela: (exec.cursor.janela || 0) + 1, ultimaJanela: j };
      exec.atualizadoEm = agoraISO();
      comTrava(function () { gravarPorChave("int_execucoes", exec); });
      pegarTravaDoRecurso(recurso, exec.id);
    }
    if ((exec.cursor.janela || 0) >= janelas.length) {
      exec.estado = "concluida";
      exec.concluidoEm = agoraISO();
      if (modo === "importacao") {
        alterarConfigClinicorp(function (cfg) {
          cfg.ultimas = cfg.ultimas || {};
          var u = cfg.ultimas[recurso];
          cfg.ultimas[recurso] = { ate: !u || exec.ate > u.ate ? exec.ate : u.ate, em: agoraISO(), execucaoId: exec.id };
        });
      }
    } else {
      exec.estado = "interrompida";
    }
  } catch (e) {
    if (!(e instanceof ErroClinicorp)) {
      exec.estado = "interrompida";
      exec.erros = (exec.erros || []).concat([{ em: agoraISO(), tipo: "interno", mensagem: String(e.mensagem || e.message || e).slice(0, 200) }]);
      comTrava(function () { gravarPorChave("int_execucoes", exec); });
      soltarTravaDoRecurso(recurso, exec.id);
      throw e;
    }
    exec.erros = (exec.erros || []).concat([{ em: agoraISO(), tipo: e.tipo, mensagem: e.mensagem, janela: exec.cursor.janela }]);
    exec.estado = e.tipo === "autenticacao" ? "falhou" : "interrompida";
    if (e.tipo === "autenticacao") suspenderPorAutenticacao(e, "sincronização de " + def.nome);
    registrarTecnico("WARNING", "CLINICORP_SINCRONIZACAO", def.nome + " · " + e.tipo + " · " + e.mensagem.slice(0, 120));
  }
  exec.atualizadoEm = agoraISO();
  comTrava(function () { gravarPorChave("int_execucoes", exec); });
  soltarTravaDoRecurso(recurso, exec.id);
  var pub = execucaoPublica(exec);
  pub.janelas = janelas.length;
  pub.amostra = amostra;
  return pub;
}

function idDoExterno(tipo, externoId) { return "clinicorp:" + tipo + ":" + externoId; }

/* O que a conciliação precisa saber, lido uma vez por execução. */
function contextoDeConciliacao(tipo) {
  var porExterno = {}, pacientes = [];
  lerTudo("int_vinculos").forEach(function (v) {
    if (v.estado !== "ativo") return;
    porExterno[v.tipo + ":" + v.externoId] = v;
    if (v.tipo === "paciente" && v.localTipo === "paciente" && pacientes.indexOf(v.externoId) < 0) pacientes.push(v.externoId);
  });
  var cx = { vinculoPorExterno: porExterno, pacientesVinculados: pacientes, entradas: [] };
  if (tipo === "recebimento") {
    var vinculadas = {};
    Object.keys(porExterno).forEach(function (k) { if (porExterno[k].localTipo === "entrada") vinculadas[porExterno[k].localId] = true; });
    var idPag = agrupar(lerTudo("ent_pagamentos"), "entradaId");
    cx.entradas = lerTudo("ent_entradas").map(function (e) { return { id: e.id, data: e.data, total: totalPagamentos(idPag[e.id]), vinculada: !!vinculadas[e.id] }; });
  }
  return cx;
}

function compararJanela(tipo, recebidos, janela, c, cx) {
  var existentes = {};
  lerTudo("int_externos").forEach(function (x) { if (x.tipo === tipo) existentes[x.externoId] = x; });
  var vistos = {}, novos = [], alterados = [], iguais = 0, reapareceram = [], pendencias = [], ausentes = [];
  recebidos.forEach(function (r) {
    if (!r.externoId || vistos[r.externoId]) return;
    vistos[r.externoId] = true;
    var assinatura = assinaturaExterna(r);
    var ex = existentes[r.externoId];
    if (!ex) novos.push({ depois: r, assinatura: assinatura });
    else if (ex.assinatura !== assinatura) alterados.push({ antes: ex.dados, depois: r, assinatura: assinatura, atual: ex });
    else { iguais++; if (ex.ausenteDesde) reapareceram.push(ex); }
    var cons = consequenciasDaMudanca(tipo, ex ? ex.dados : null, r, cx, c);
    pendencias = pendencias.concat(cons);
  });
  Object.keys(existentes).forEach(function (id) {
    var ex = existentes[id];
    if (vistos[id] || ex.ausenteDesde) return;
    var dia = dataDoFiltro(tipo, ex.dados || {}, c);
    if (!dia || dia < janela.de || dia > janela.ate) return;
    if (c.unidade && ex.dados && ex.dados.unidade && ex.dados.unidade !== String(c.unidade)) return;
    ausentes.push(ex);
  });
  return { novos: novos, alterados: alterados, iguais: iguais, reapareceram: reapareceram, pendencias: pendencias, ausentes: ausentes };
}

function resumoExterno(tipo, r) {
  if (tipo === "orcamento") return { tipo: tipo, externoId: r.externoId, texto: (r.pacienteNome || "paciente") + " · " + r.status + (r.valor !== null ? " · " + dinheiroBR(r.valor) : "") };
  if (tipo === "agendamento") return { tipo: tipo, externoId: r.externoId, texto: dataBR(r.dia) + (r.inicio ? " " + r.inicio : "") + " · " + (r.pacienteNome || "paciente") + (r.cancelado ? " · desmarcado" : "") };
  if (tipo === "recebimento") return { tipo: tipo, externoId: r.externoId, texto: (r.pacienteNome || "paciente") + " · " + resumoRecebimento(r) };
  return { tipo: tipo, externoId: r.externoId, texto: r.nome || r.externoId };
}

/* Grava uma janela em pedaços, cada pedaço uma operação no diário. O id
   da operação sai do conteúdo: repetir o mesmo pedaço é reconhecido. */
function gravarJanela(ctxBase, auth, exec, tipo, diff, janela) {
  var c = configClinicorp();
  var registros = [];
  var agora = agoraISO();
  diff.novos.forEach(function (x) {
    registros.push({ t: "gravar", tabela: "int_externos", registro: { id: idDoExterno(tipo, x.depois.externoId), sistema: "clinicorp",
      assinante: c.assinante, unidade: x.depois.unidade || c.unidade || "", tipo: tipo, externoId: x.depois.externoId, dados: x.depois,
      assinatura: x.assinatura, alteradoExterno: x.depois.alteradoExterno || "", vistoEm: agora, ausenteDesde: null, complemento: null,
      execucaoId: exec.id, rev: 1, opId: "", atualizadoEm: agora, atualizadoPor: "Clinicorp" } });
  });
  diff.alterados.forEach(function (x) {
    var a = x.atual;
    registros.push({ t: "gravar", tabela: "int_externos", registro: { id: a.id, sistema: a.sistema, assinante: a.assinante,
      unidade: x.depois.unidade || a.unidade || "", tipo: tipo, externoId: a.externoId, dados: x.depois, assinatura: x.assinatura,
      alteradoExterno: x.depois.alteradoExterno || "", vistoEm: agora, ausenteDesde: null,
      /* o complemento local é do Alveare: atualizar do Clinicorp nunca apaga */
      complemento: a.complemento, execucaoId: exec.id, rev: (Number(a.rev) || 0) + 1, opId: "", atualizadoEm: agora, atualizadoPor: "Clinicorp" } });
  });
  diff.reapareceram.forEach(function (a) {
    var r = copiaLimpa(a); r.ausenteDesde = null; r.vistoEm = agora; r.rev = (Number(a.rev) || 0) + 1;
    registros.push({ t: "gravar", tabela: "int_externos", registro: r });
  });
  diff.ausentes.forEach(function (a) {
    var r = copiaLimpa(a); r.ausenteDesde = agora; r.rev = (Number(a.rev) || 0) + 1;
    registros.push({ t: "gravar", tabela: "int_externos", registro: r });
  });
  var pend = diff.pendencias.map(function (p) {
    return { t: "pendencia", registro: { id: "pd-" + sha256Hex(p.chave).slice(0, 20), recurso: exec.recurso, tipo: p.tipo, chave: p.chave,
      externoId: p.externoId || "", localTipo: p.localTipo || "", localId: p.localId || "", resumo: String(p.resumo || "").slice(0, 500),
      detalhes: p.detalhes || null, estado: "aberta", criadoEm: agora, resolvidoEm: null, resolvidoPor: "", resolucao: "" } };
  });
  var todos = registros.concat(pend);
  if (!todos.length) return;
  /* pedaços por tamanho, para caber no diário */
  var pedacos = [], atual = [], tam = 0;
  todos.forEach(function (w) {
    var n = JSON.stringify(w.registro).length;
    if (atual.length && tam + n > INT_PEDACO_BYTES) { pedacos.push(atual); atual = []; tam = 0; }
    atual.push(w); tam += n;
  });
  if (atual.length) pedacos.push(atual);
  pedacos.forEach(function (pedaco, i) {
    var conteudo = sha256Hex(canonico(pedaco.map(function (w) { return [w.registro.id, w.registro.assinatura || w.registro.chave || "", w.registro.ausenteDesde ? "a" : ""]; }))).slice(0, 12);
    var op = { operacaoId: "int-" + exec.id.replace(/[^A-Za-z0-9_-]/g, "").slice(-30) + "-j" + exec.cursor.janela + "-p" + i + "-" + conteudo, tipo: "sync." + tipo, janela: janela, n: pedaco.length };
    var ctx = { pedidoId: (ctxBase && ctxBase.pedidoId) || "", acao: "integracao.sincronizar", auth: auth };
    executarOperacao(ctx, op, function () {
      var escritas = [];
      pedaco.forEach(function (w) {
        if (w.t !== "pendencia") { escritas.push({ t: "gravar", tabela: w.tabela, registro: w.registro }); return; }
        /* pendência: uma por chave, para sempre — resolvida não reabre */
        if (acharPorChave("int_pendencias", w.registro.id)) return;
        escritas.push({ t: "gravar", tabela: "int_pendencias", registro: w.registro });
      });
      return { escritas: escritas, resultado: { gravados: escritas.length } };
    });
  });
}

/* ---------------------------------------------------------------------
   Gatilho agendado (opcional) — identidade técnica auditável
   --------------------------------------------------------------------- */

function gatilhoAgendado() {
  try {
    return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === "integracaoAgendada"; })[0] || null;
  } catch (e) { return null; }
}

function integracaoAgendar(ctx) {
  var h = Number((ctx.dados || {}).frequenciaHoras);
  if ([0, 1, 2, 4, 6, 12, 24].indexOf(h) < 0) falhar("dados_invalidos", "Frequência: 0 (desligado), 1, 2, 4, 6, 12 ou 24 horas.");
  var atual = gatilhoAgendado();
  if (atual) ScriptApp.deleteTrigger(atual);
  if (h > 0) {
    var b = ScriptApp.newTrigger("integracaoAgendada").timeBased();
    if (h === 24) b.everyDays(1).create(); else b.everyHours(h).create();
  }
  alterarConfigClinicorp(function (c) { c.frequenciaHoras = h; });
  registrarTecnico("INFO", "INTEGRACAO_AGENDADA", h ? "Sincronização do Clinicorp a cada " + h + " h." : "Sincronização agendada desligada.");
  return integracaoEstado();
}

/* Roda pelo gatilho de tempo, sem sessão: a identidade é a da
   sincronização, e o escopo é o configurado — só recursos em modo
   importação, e só para dentro das abas de integração. Nunca cria
   entrada, lead ou agendamento. */
function integracaoAgendada() {
  reiniciarExecucao();
  var c = configClinicorp();
  if (impedimentoClinicorp(c)) return;
  if (emManutencao() || schemaAtivo() < VERSAO_SCHEMA) return;
  var inicio = Date.now();
  ["recebimentos", "orcamentos", "agendamentos"].forEach(function (recurso) {
    if (Date.now() - inicio > INT_TEMPO_AGENDADO_MS) return;
    c = configClinicorp();
    if (impedimentoClinicorp(c) || modoDoRecurso(c, recurso) !== "importacao" || !(c.ultimas || {})[recurso]) return;
    try {
      var ultima = lerUltimas("int_execucoes", 30).filter(function (e) { return e.recurso === recurso && e.estado === "interrompida" && e.modo === "importacao"; }).pop();
      executarSincronizacao(recurso, "importacao", ultima ? { retomar: true, execucaoId: ultima.id } : {},
        AUTH_SISTEMA_CLINICORP, "agendada", INT_TEMPO_AGENDADO_MS - (Date.now() - inicio), { pedidoId: "gatilho" });
    } catch (e) {
      registrarTecnico("WARNING", "CLINICORP_AGENDADA", recurso + " · " + String(e && (e.mensagem || e.message) || e).slice(0, 160));
    }
  });
}

/* ---------------------------------------------------------------------
   Suspender, retomar, desconectar
   --------------------------------------------------------------------- */

function integracaoSuspender(ctx) {
  var acao = String((ctx.dados || {}).acao || "");
  alterarConfigClinicorp(function (c) {
    if (acao === "suspender") c.suspensa = { em: agoraISO(), motivo: "manual", mensagem: "suspensa pelo painel" };
    else if (acao === "retomar") { c.suspensa = null; c.desconectadaEm = null; }
    else if (acao === "desconectar") {
      /* desconectar não apaga nada do que foi importado nem os vínculos */
      c.desconectadaEm = agoraISO();
      Object.keys(c.recursos || {}).forEach(function (k) { c.recursos[k] = { modo: "desligado", em: agoraISO() }; });
      c.frequenciaHoras = 0;
    } else falhar("dados_invalidos", "Ação: suspender, retomar ou desconectar.");
  });
  if (acao === "desconectar") { var g = gatilhoAgendado(); if (g) try { ScriptApp.deleteTrigger(g); } catch (e) { } }
  registrarTecnico("INFO", "INTEGRACAO_" + acao.toUpperCase(), "Clinicorp: " + acao + " pelo painel.");
  return integracaoEstado();
}

/* ---------------------------------------------------------------------
   Registros externos, vínculos e pendências (painel)
   --------------------------------------------------------------------- */

function externoPublico(x, vinculos) {
  var v = vinculos ? vinculos[x.tipo + ":" + x.externoId] : null;
  return { id: x.id, tipo: x.tipo, externoId: x.externoId, unidade: x.unidade, dados: x.dados, alteradoExterno: x.alteradoExterno,
    vistoEm: x.vistoEm, ausenteDesde: x.ausenteDesde, complemento: x.complemento, _rev: Number(x.rev) || 0,
    vinculo: v ? { localTipo: v.localTipo, localId: v.localId, desde: v.criadoEm } : null };
}

function mapaDeVinculos() {
  var m = {};
  lerTudo("int_vinculos").forEach(function (v) { if (v.estado === "ativo") m[v.tipo + ":" + v.externoId] = v; });
  return m;
}

function integracaoExternos(ctx) {
  var d = ctx.dados || {};
  var tipo = String(d.tipo || "");
  var de = String(d.de || ""), ate = String(d.ate || "");
  var soSemVinculo = d.semVinculo === true;
  var vinculos = mapaDeVinculos();
  var lista = lerTudo("int_externos").filter(function (x) {
    if (tipo && x.tipo !== tipo) return false;
    var dia = x.dados ? (x.dados.dia || x.dados.recebidoEm || x.dados.pagoEm || x.dados.criadoEm || x.dados.vencimento || "") : "";
    if (de && dia && dia < de) return false;
    if (ate && dia && dia > ate) return false;
    if (soSemVinculo && vinculos[x.tipo + ":" + x.externoId]) return false;
    return true;
  });
  return { total: lista.length, externos: lista.slice(-300).reverse().map(function (x) { return externoPublico(x, vinculos); }) };
}

function integracaoPendencias(ctx) {
  var pedido = (ctx.dados || {}).estado;
  var estado = pedido === undefined || pedido === null ? "aberta" : String(pedido);
  var lista = lerTudo("int_pendencias").filter(function (p) { return !estado || p.estado === estado; }).reverse().slice(0, 200);
  var passos = lerTudo("int_passos").filter(function (p) { return p.estado === "desconhecido" || p.estado === "enviando" || p.estado === "confirmado_sem_id"; })
    .map(passoPublico);
  return { pendencias: lista.map(function (p) { var o = publicoDe("int_pendencias", p); return o; }), passos: passos };
}

function passoPublico(p) {
  return { id: p.id, operacaoId: p.operacaoId, tipo: p.tipo, estado: p.estado, tentativas: p.tentativas, localTipo: p.localTipo,
    localId: p.localId, externoId: p.externoId, criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm, autor: p.autor,
    resposta: p.resposta, pedido: p.pedido ? { campanha: p.pedido.BoardName || "", nome: p.pedido.Name || "" } : null };
}

/* Vínculo explícito, feito por uma pessoa. Um registro externo tem no
   máximo um vínculo ativo por tipo de ficha local; uma ficha local tem no
   máximo um registro externo de cada tipo. */
function planejarVinculo(ctx, op, tipo, externoId, localTipo, localId) {
  var tiposOk = { paciente: ["lead", "paciente"], recebimento: ["entrada"], orcamento: ["lead"] };
  if (!tiposOk[tipo] || tiposOk[tipo].indexOf(localTipo) < 0) falhar("dados_invalidos", "Vínculo desconhecido.");
  externoId = String(externoId || "");
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(externoId)) falhar("dados_invalidos", "Identificador externo inválido.");
  var tabelaLocal = { lead: "crm_leads", paciente: "agenda_pacientes", entrada: "ent_entradas" }[localTipo];
  if (!acharPorChave(tabelaLocal, String(localId || ""))) falhar("nao_encontrado", "A ficha local não existe.");
  var id = "clinicorp:" + tipo + ":" + externoId + ":" + localTipo;
  var todos = lerTudo("int_vinculos");
  var ja = todos.filter(function (v) { return v.estado === "ativo" && v.tipo === tipo && v.localTipo === localTipo && (v.externoId === externoId || v.localId === localId); });
  if (ja.some(function (v) { return v.externoId === externoId && v.localId === String(localId); })) return { escritas: [], resultado: { id: id, jaExistia: true } };
  if (ja.length) falhar("conflito", "Já existe um vínculo para este registro ou para esta ficha. Desfaça o outro antes.", { rev: 0, atual: null });
  var atual = acharPorChave("int_vinculos", id);
  var c = configClinicorp();
  var ext = acharPorChave("int_externos", idDoExterno(tipo, externoId));
  var reg = registroCompleto("int_vinculos", { id: id, sistema: "clinicorp", assinante: c.assinante, unidade: c.unidade || "", tipo: tipo,
    externoId: externoId, localTipo: localTipo, localId: String(localId), estado: "ativo", assinatura: ext ? ext.assinatura : "",
    sincronizadoEm: ext ? ext.vistoEm : null, criadoEm: agoraISO(), criadoPor: assinaturaDe(ctx.auth).nome }, atual);
  carimbar(reg, (atual ? Number(atual.rev) || 0 : 0) + 1, ctx, op.operacaoId);
  var modulo = { lead: "crm", paciente: "agenda", entrada: "entradas" }[localTipo];
  return { escritas: [{ t: "gravar", tabela: "int_vinculos", registro: reg }].concat(escritasDeAuditoria(ctx,
    [evento(modulo, localTipo, localId, "vinculou", "Clinicorp", "", tipo + " " + externoId)], op.operacaoId)), resultado: { id: id } };
}

function integracaoVincular(ctx) {
  var d = ctx.dados || {};
  return executarOperacao(ctx, { operacaoId: d.operacaoId, tipo: "vinculo.criar", vinculo: [d.tipo, d.externoId, d.localTipo, d.localId] }, function (op) {
    return planejarVinculo(ctx, op, String(d.tipo), d.externoId, String(d.localTipo), String(d.localId));
  });
}

function integracaoDesvincular(ctx) {
  var d = ctx.dados || {};
  return executarOperacao(ctx, { operacaoId: d.operacaoId, tipo: "vinculo.desfazer", id: d.id }, function (op) {
    var v = acharPorChave("int_vinculos", String(d.id || ""));
    if (!v || v.estado !== "ativo") return { escritas: [], resultado: { id: d.id, jaDesfeito: true } };
    var reg = copiaLimpa(v); reg.estado = "desfeito";
    carimbar(reg, (Number(v.rev) || 0) + 1, ctx, op.operacaoId);
    var modulo = { lead: "crm", paciente: "agenda", entrada: "entradas" }[v.localTipo];
    /* desfazer o vínculo não apaga nada: nem a ficha local, nem o registro externo */
    return { escritas: [{ t: "gravar", tabela: "int_vinculos", registro: reg }].concat(escritasDeAuditoria(ctx,
      [evento(modulo, v.localTipo, v.localId, "desvinculou", "Clinicorp", v.tipo + " " + v.externoId, "")], op.operacaoId)), resultado: { id: v.id } };
  });
}

/* Complemento local de um registro externo (nota, categoria): é do
   Alveare e sobrevive às atualizações do Clinicorp. */
function integracaoComplemento(ctx) {
  var d = ctx.dados || {};
  return executarOperacao(ctx, { operacaoId: d.operacaoId, tipo: "externo.complemento", id: d.id, complemento: d.complemento, revBase: d.revBase }, function (op) {
    var x = acharPorChave("int_externos", String(d.id || ""));
    if (!x) falhar("nao_encontrado", "Registro externo não encontrado.");
    conferirRevisao(x, d.revBase, function (r) { return externoPublico(r, null); });
    var comp = d.complemento && typeof d.complemento === "object" ? { notas: String(d.complemento.notas || "").slice(0, 2000),
      categoria: String(d.complemento.categoria || "").slice(0, 80) } : null;
    var reg = copiaLimpa(x); reg.complemento = comp;
    carimbar(reg, (Number(x.rev) || 0) + 1, ctx, op.operacaoId);
    return { escritas: [{ t: "gravar", tabela: "int_externos", registro: reg }], resultado: { id: x.id, rev: reg.rev } };
  });
}

/* ---- pendências ---- */

function integracaoResolver(ctx) {
  var d = ctx.dados || {};
  return executarOperacao(ctx, { operacaoId: d.operacaoId, tipo: "pendencia.resolver", id: d.id, decisao: d.decisao, entradaId: d.entradaId, metodo: d.metodo, externoId: d.externoId }, function (op) {
    var p = acharPorChave("int_pendencias", String(d.id || ""));
    if (!p) falhar("nao_encontrado", "Pendência não encontrada.");
    if (p.estado !== "aberta") return { escritas: [], resultado: { id: p.id, jaResolvida: true, resolucao: p.resolucao } };
    var decisao = String(d.decisao || "");
    var escritas = [];
    if (decisao === "aplicar" && p.tipo === "proposta_etapa") {
      escritas = escritasAplicarEtapa(ctx, op, p);
    } else if (decisao === "vincular" && (p.tipo === "conciliacao" || p.tipo === "vinculo_pendente")) {
      var tipoV = p.tipo === "conciliacao" ? "recebimento" : "paciente";
      var localTipo = p.tipo === "conciliacao" ? "entrada" : p.localTipo;
      var localId = p.tipo === "conciliacao" ? String(d.entradaId || "") : p.localId;
      var ext = p.tipo === "conciliacao" ? p.externoId : String(d.externoId || "");
      escritas = planejarVinculo(ctx, op, tipoV, ext, localTipo, localId).escritas;
    } else if (decisao === "importar" && p.tipo === "conciliacao") {
      escritas = planejarImportarRecebimento(ctx, op, p.externoId, d.metodo).escritas;
    } else if (decisao === "desvincular" && p.tipo === "divergencia") {
      var v = acharPorChave("int_vinculos", "clinicorp:recebimento:" + p.externoId + ":entrada");
      if (v && v.estado === "ativo") { var r = copiaLimpa(v); r.estado = "desfeito"; carimbar(r, (Number(v.rev) || 0) + 1, ctx, op.operacaoId); escritas.push({ t: "gravar", tabela: "int_vinculos", registro: r }); }
    } else if (["ignorar", "ciente"].indexOf(decisao) < 0) {
      falhar("dados_invalidos", "Decisão desconhecida para esta pendência.");
    }
    var reg = copiaLimpa(p);
    reg.estado = "resolvida"; reg.resolvidoEm = agoraISO(); reg.resolvidoPor = assinaturaDe(ctx.auth).nome; reg.resolucao = decisao;
    carimbar(reg, (Number(p.rev) || 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "int_pendencias", registro: reg });
    return { escritas: escritas, resultado: { id: p.id, resolucao: decisao } };
  });
}

/* A proposta vira mudança no CRM só pelas regras do CRM: a lead precisa
   estar numa das etapas de origem, e conferirLeadCRM decide o resto. */
function escritasAplicarEtapa(ctx, op, p) {
  var lead = acharPorChave("crm_leads", p.localId);
  if (!lead) falhar("nao_encontrado", "A lead vinculada não existe mais.");
  var det = p.detalhes || {};
  if ((det.de || []).indexOf(lead.etapa) < 0) {
    falhar("dados_invalidos", "A lead está em " + nomeEtapa(lead.etapa) + "; a proposta valia para " + (det.de || []).map(nomeEtapa).join(" ou ") + ". Nada foi mudado.");
  }
  var antes = leadDoRegistro(lead);
  var depois = {};
  Object.keys(antes).forEach(function (k) { depois[k] = antes[k]; });
  depois.etapa = det.etapa;
  depois = conferirLeadCRM(antes, depois, hojeNaClinica());
  depois.id = lead.id;
  var rev = (Number(lead.rev) || 0) + 1;
  var reg = carimbar(registroCompleto("crm_leads", depois, lead), rev, ctx, op.operacaoId);
  var ev = eventosLead(antes, depois).map(function (e) { e.contexto = "proposta do Clinicorp (" + det.status + ")"; return e; });
  return [{ t: "gravar", tabela: "crm_leads", registro: reg }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId));
}

/* ---- recebimentos → Entradas ---- */

function metodoDaForma(forma) {
  var f = chaveDeNome(forma || "");
  if (/cred|credit/.test(f)) return "credito";
  if (/deb|debit/.test(f)) return "debito";
  if (/pix/.test(f)) return "pix";
  if (/dinheiro|especie|cash/.test(f)) return "dinheiro";
  if (/boleto/.test(f)) return "boleto";
  return "";
}

function planejarImportarRecebimento(ctx, op, externoId, metodoEscolhido) {
  var x = acharPorChave("int_externos", idDoExterno("recebimento", externoId));
  if (!x) falhar("nao_encontrado", "Recebimento não encontrado entre os importados.");
  var r = x.dados || {};
  var vinculos = mapaDeVinculos();
  if (vinculos["recebimento:" + externoId]) falhar("dados_invalidos", "Este recebimento já está vinculado a uma entrada.");
  if (!r.recebido && !r.confirmado) falhar("dados_invalidos", "No Clinicorp este pagamento ainda não consta como recebido: fica só para consulta.");
  if (r.valor === null || r.valor === undefined) falhar("dados_invalidos", "O Clinicorp não informou o valor.");
  var metodo = metodoEscolhido ? String(metodoEscolhido) : metodoDaForma(r.forma);
  if (METODOS_ENTRADA.indexOf(metodo) < 0 || metodo === "haver") falhar("dados_invalidos", "Escolha a forma de pagamento (\"" + (r.forma || "não informada") + "\" não tem equivalente seguro).", { campo: "metodo" });
  var id = "clc-" + String(externoId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  if (acharPorChave("ent_entradas", id)) falhar("dados_invalidos", "Já existe uma entrada criada a partir deste recebimento.");
  var parcelas = Math.min(12, Math.max(1, Number(r.parcelas) || 1));
  /* valor BRUTO da parcela: a entrada registra o que a paciente pagou; a
     taxa da maquininha não é descontada de novo aqui */
  var escritas = [
    { t: "inserir", tabela: "ent_pagamentos", registro: { id: id + "-pg", entradaId: id, ordem: 0, metodo: metodo, valor: r.valor, parcelas: parcelas } },
    { t: "gravar", tabela: "ent_entradas", registro: carimbar(registroCompleto("ent_entradas", { id: id, nome: r.pacienteNome || "Paciente do Clinicorp",
      data: r.recebidoEm || r.confirmadoEm || r.pagoEm, descricao: "Recebimento Clinicorp" + (r.forma ? " · " + r.forma : ""),
      obs: "Parcela " + (r.parcela || "?") + (r.parcelas ? "/" + r.parcelas : "") + " · id Clinicorp " + externoId, criadoEm: agoraISO(),
      origem: "clinicorp", loteId: "" }, null), 1, ctx, op.operacaoId) }
  ];
  var c = configClinicorp();
  escritas.push({ t: "gravar", tabela: "int_vinculos", registro: carimbar(registroCompleto("int_vinculos", { id: "clinicorp:recebimento:" + externoId + ":entrada",
    sistema: "clinicorp", assinante: c.assinante, unidade: c.unidade || "", tipo: "recebimento", externoId: externoId, localTipo: "entrada",
    localId: id, estado: "ativo", assinatura: x.assinatura, sincronizadoEm: x.vistoEm, criadoEm: agoraISO(), criadoPor: assinaturaDe(ctx.auth).nome }, null), 1, ctx, op.operacaoId) });
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("entradas", "entrada", id, "criou", "", "", (r.pacienteNome || "Paciente") + " — importada do Clinicorp"),
    evento("entradas", "entrada", id, "criou_detalhe", "Valor", "", dinheiroBR(r.valor))], op.operacaoId));
  return { escritas: escritas, resultado: { entradaId: id } };
}

function integracaoReconciliar(ctx) {
  var d = ctx.dados || {};
  return executarOperacao(ctx, { operacaoId: d.operacaoId, tipo: "recebimento." + d.acao, externoId: d.externoId, entradaId: d.entradaId, metodo: d.metodo }, function (op) {
    if (d.acao === "vincular") return planejarVinculo(ctx, op, "recebimento", d.externoId, "entrada", String(d.entradaId || ""));
    if (d.acao === "importar") return planejarImportarRecebimento(ctx, op, String(d.externoId || ""), d.metodo);
    falhar("dados_invalidos", "Ação: vincular ou importar.");
  });
}

/* ---------------------------------------------------------------------
   Pacientes e leads: escrita no Clinicorp, com passos
   --------------------------------------------------------------------- */

function integracaoBuscarPaciente(ctx) {
  var d = ctx.dados || {};
  _PROPS = null;
  var c = configClinicorp();
  exigirClinicorpPronto(c);
  if (modoDoRecurso(c, "pacientes") === "desligado") falhar("dados_invalidos", "Pacientes está desligado na configuração.");
  var criterio = String(d.criterio || ""), valor = String(d.valor || "").trim();
  if (!valor || valor.length > 120) falhar("dados_invalidos", "Informe o valor da busca.");
  if (criterio === "nome") falhar("dados_invalidos", "Busca por nome não é usada para vincular: pode trazer um homônimo. Use id, telefone, e-mail ou CPF.");
  try {
    var achados = buscarPacienteClinicorp(criterio, valor);
    alterarConfigClinicorp(function (cfg) {
      cfg.verificacao = cfg.verificacao || { em: agoraISO(), resultados: {} };
      cfg.verificacao.resultados = cfg.verificacao.resultados || {};
      cfg.verificacao.resultados["pacientes.buscar"] = { ok: true, em: agoraISO(), mensagem: "respondeu no primeiro uso" };
    });
    return { pacientes: achados };
  } catch (e) { tratarErroClinicorp(e, "busca de paciente"); }
}

/* O mesmo pedido de novo (resposta perdida no caminho até o navegador):
   devolve o que já aconteceu, antes de qualquer outra conferência. */
function jaConcluido(operacaoId, reenviar) {
  if (reenviar) return null;
  var p = passoDaOperacao(operacaoId);
  if (p && ["confirmado", "confirmado_sem_id", "recusado", "abandonado"].indexOf(p.estado) >= 0) return { passo: passoPublico(p), repetida: true };
  return null;
}

function passoDaOperacao(operacaoId) {
  return filtrar("int_passos", "operacaoId", operacaoId)[0] || null;
}

/* Abre (ou reabre, para "reenviar") o passo dentro da trava. */
function abrirPasso(ctx, operacaoId, tipo, localTipo, localId, pedido, reenviar) {
  return comTrava(function () {
    esquecerLinhas();
    var p = passoDaOperacao(operacaoId);
    if (p) {
      if (p.estado === "confirmado" || p.estado === "confirmado_sem_id") return { passo: p, pronto: true };
      if ((p.estado === "desconhecido" || p.estado === "enviando") && !reenviar) {
        falhar("integracao_incerta", "O envio anterior ficou com resultado desconhecido. Verifique no painel antes de reenviar.", { passoId: p.id });
      }
      if (p.estado === "recusado" && !reenviar) return { passo: p, pronto: true };
      p.estado = "enviando"; p.tentativas = (Number(p.tentativas) || 0) + 1; p.atualizadoEm = agoraISO(); p.resposta = null;
      gravarPorChave("int_passos", copiaLimpa(p));
      return { passo: p, pronto: false };
    }
    var novo = { id: novoId("ps"), operacaoId: operacaoId, tipo: tipo, estado: "enviando", tentativas: 1, pedido: pedido, resposta: null,
      localTipo: localTipo, localId: localId, externoId: "", criadoEm: agoraISO(), atualizadoEm: agoraISO(), autor: assinaturaDe(ctx.auth).nome };
    inserir("int_passos", [novo]);
    return { passo: novo, pronto: false };
  });
}

/* Fecha o passo e grava o que vem junto (vínculo, pendência, auditoria)
   numa operação só, no diário: são várias abas. */
function fecharPasso(ctx, passo, estado, resposta, externoId, extras) {
  var opId = "int-" + passo.id + "-" + (Number(passo.tentativas) || 1) + "-" + estado.replace(/[^a-z_]/g, "");
  var c2 = { pedidoId: ctx.pedidoId || "", acao: "integracao.passo", auth: ctx.auth };
  var feito = null;
  executarOperacao(c2, { operacaoId: opId, tipo: "passo.fechar", passoId: passo.id, estado: estado }, function () {
    var p = acharPorChave("int_passos", passo.id) || passo;
    var reg = copiaLimpa(p);
    reg.estado = estado; reg.resposta = resposta || null; reg.atualizadoEm = agoraISO();
    if (externoId) reg.externoId = externoId;
    feito = reg;
    return { escritas: [{ t: "gravar", tabela: "int_passos", registro: reg }].concat(extras || []), resultado: { passoId: reg.id } };
  });
  if (!feito) { esquecerLinhas(); feito = acharPorChave("int_passos", passo.id) || passo; }
  return feito;
}

/* Criar paciente no Clinicorp a partir de uma lead. O CPF, se digitado,
   vai só no pedido ao Clinicorp: não é guardado em lugar nenhum. */
function integracaoCriarPaciente(ctx) {
  var d = ctx.dados || {};
  if (!RE_OPERACAO.test(String(d.operacaoId || ""))) falhar("dados_invalidos", "Operação sem identificador válido.");
  _PROPS = null;
  var c = configClinicorp();
  exigirClinicorpPronto(c);
  if (modoDoRecurso(c, "pacientes") !== "envio") falhar("dados_invalidos", "Criar paciente no Clinicorp exige Pacientes em modo envio.");
  var lead = acharPorChave("crm_leads", String(d.leadId || ""));
  if (!lead) falhar("nao_encontrado", "Lead não encontrada.");
  var repetido = jaConcluido(d.operacaoId, d.reenviar);
  if (repetido) return repetido;
  var vinc = lerTudo("int_vinculos").filter(function (v) { return v.estado === "ativo" && v.tipo === "paciente" && v.localTipo === "lead" && v.localId === lead.id; });
  if (vinc.length) falhar("dados_invalidos", "Esta lead já está vinculada a um paciente do Clinicorp.");
  var telefone = soDigitos(d.telefone || lead.whatsapp || "");
  var email = String(d.email || "").trim().slice(0, 160);
  if (!telefone && !email) falhar("dados_invalidos", "Informe telefone ou e-mail: é por eles que o vínculo é confirmado depois.");
  var pedido = { Name: String(d.nome || lead.nome || "").slice(0, 200), MobilePhone: telefone, Email: email,
    BirthDate: dataValida(String(d.nascimento || "")) ? String(d.nascimento) : "", Notes: "Enviado pelo Alveare (FloreSer)" };
  if (!pedido.Name.trim()) falhar("dados_invalidos", "Informe o nome.");
  var corpo = {};
  Object.keys(pedido).forEach(function (k) { if (pedido[k]) corpo[k] = pedido[k]; });
  if (d.cpf) corpo.OtherDocumentId = soDigitos(d.cpf);

  var aberto = abrirPasso(ctx, d.operacaoId, "pacientes.criar", "lead", lead.id, pedido, d.reenviar === true);
  if (aberto.pronto) return { passo: passoPublico(aberto.passo), repetida: true };
  var resp;
  try {
    resp = chamarClinicorp("pacientes.criar", {}, corpo);
  } catch (e) {
    if (!(e instanceof ErroClinicorp)) throw e;
    if (e.tipo === "desconhecido") {
      var p1 = fecharPasso(ctx, aberto.passo, "desconhecido", { mensagem: e.mensagem }, "", [pendenciaDoPasso(aberto.passo, "Criação de paciente no Clinicorp com resultado desconhecido (" + pedido.Name + "). Verifique antes de reenviar.")]);
      return { passo: passoPublico(p1) };
    }
    fecharPasso(ctx, aberto.passo, "recusado", { mensagem: e.mensagem, status: e.status }, "", []);
    tratarErroClinicorp(e, "criação de paciente");
  }
  return confirmarPacienteCriado(ctx, aberto.passo, pedido, lead.id);
}

function pendenciaDoPasso(passo, resumo) {
  return { t: "gravar", tabela: "int_pendencias", registro: { id: "pd-" + sha256Hex("passo:" + passo.id).slice(0, 20), recurso: "pacientes",
    tipo: "resultado_desconhecido", chave: "passo:" + passo.id, externoId: "", localTipo: passo.localTipo, localId: passo.localId,
    resumo: resumo, detalhes: { passoId: passo.id }, estado: "aberta", criadoEm: agoraISO(), resolvidoEm: null, resolvidoPor: "", resolucao: "",
    rev: 1, opId: "", atualizadoEm: agoraISO(), atualizadoPor: "Integração" } };
}

/* A resposta da criação não traz o id: procura por telefone e e-mail. Um
   achado só → vínculo. Nenhum ou vários → pendência para uma pessoa. */
function confirmarPacienteCriado(ctx, passo, pedido, leadId) {
  var achados = [];
  try {
    if (pedido.MobilePhone) achados = buscarPacienteClinicorp("telefone", pedido.MobilePhone);
    if (!achados.length && pedido.Email) achados = buscarPacienteClinicorp("email", pedido.Email);
  } catch (e) { if (!(e instanceof ErroClinicorp)) throw e; achados = []; }
  if (achados.length === 1) {
    var c = configClinicorp();
    var vid = "clinicorp:paciente:" + achados[0].externoId + ":lead";
    var vinculo = carimbar(registroCompleto("int_vinculos", { id: vid, sistema: "clinicorp", assinante: c.assinante, unidade: c.unidade || "",
      tipo: "paciente", externoId: achados[0].externoId, localTipo: "lead", localId: leadId, estado: "ativo", assinatura: "",
      sincronizadoEm: agoraISO(), criadoEm: agoraISO(), criadoPor: assinaturaDe(ctx.auth).nome }, null), 1, { auth: ctx.auth }, passo.operacaoId);
    var aud = escritasDeAuditoria(ctx, [evento("crm", "lead", leadId, "vinculou", "Clinicorp", "", "paciente " + achados[0].externoId + " (criado pelo Alveare)")], passo.operacaoId);
    var p = fecharPasso(ctx, passo, "confirmado", { pacienteId: achados[0].externoId }, achados[0].externoId, [{ t: "gravar", tabela: "int_vinculos", registro: vinculo }].concat(aud));
    return { passo: passoPublico(p), pacienteId: achados[0].externoId };
  }
  var resumo = achados.length ? "Paciente criado, mas " + achados.length + " pacientes têm o mesmo telefone/e-mail: escolha o certo para vincular." :
    "Paciente criado, mas a busca por telefone/e-mail ainda não o encontrou: confirme o vínculo à mão.";
  var pend = { t: "gravar", tabela: "int_pendencias", registro: { id: "pd-" + sha256Hex("vinc:" + passo.id).slice(0, 20), recurso: "pacientes",
    tipo: "vinculo_pendente", chave: "vinc:" + passo.id, externoId: "", localTipo: "lead", localId: leadId, resumo: resumo,
    detalhes: { candidatos: achados.slice(0, 5) }, estado: "aberta", criadoEm: agoraISO(), resolvidoEm: null, resolvidoPor: "", resolucao: "",
    rev: 1, opId: "", atualizadoEm: agoraISO(), atualizadoPor: "Integração" } };
  var p2 = fecharPasso(ctx, passo, "confirmado_sem_id", { candidatos: achados.length }, "", [pend]);
  return { passo: passoPublico(p2) };
}

/* Enviar uma lead do Alveare para uma campanha do CRM do Clinicorp. */
function integracaoEnviarLead(ctx) {
  var d = ctx.dados || {};
  if (!RE_OPERACAO.test(String(d.operacaoId || ""))) falhar("dados_invalidos", "Operação sem identificador válido.");
  _PROPS = null;
  var c = configClinicorp();
  exigirClinicorpPronto(c);
  if (modoDoRecurso(c, "crm") !== "envio") falhar("dados_invalidos", "Enviar leads exige CRM (campanhas) em modo envio.");
  var lead = acharPorChave("crm_leads", String(d.leadId || ""));
  if (!lead) falhar("nao_encontrado", "Lead não encontrada.");
  var repetido = jaConcluido(d.operacaoId, d.reenviar);
  if (repetido) return repetido;
  /* proteção de ciclo: lead que acabou de mudar pela própria integração
     não é oferecida para envio automático; aqui o envio é explícito, mas
     o mesmo envio para a mesma campanha não se repete sem "reenviar" */
  var campanha = String(d.campanha || c.campanhaPadrao || "").trim().slice(0, 120);
  if (!campanha) falhar("dados_invalidos", "Escolha a campanha.");
  var anteriores = lerTudo("int_passos").filter(function (p) { return p.tipo === "crm.enviarLead" && p.localId === lead.id && p.pedido && p.pedido.BoardName === campanha && p.estado === "confirmado"; });
  if (anteriores.length && d.reenviar !== true) falhar("dados_invalidos", "Esta lead já foi enviada para esta campanha em " + dataBR(String(anteriores[0].atualizadoEm).slice(0, 10)) + ".");
  var pedido = { Name: String(lead.nome || "").slice(0, 200), Phone: String(lead.whatsapp || "").slice(0, 40), Email: String(d.email || "").slice(0, 160),
    BoardName: campanha, Notes: String(d.notas || "").slice(0, 500) };
  var aberto = abrirPasso(ctx, d.operacaoId, "crm.enviarLead", "lead", lead.id, pedido, d.reenviar === true);
  if (aberto.pronto) return { passo: passoPublico(aberto.passo), repetida: true };
  var corpo = {};
  Object.keys(pedido).forEach(function (k) { if (pedido[k]) corpo[k] = pedido[k]; });
  try {
    var r = chamarClinicorp("crm.enviarLead", {}, corpo);
    var p = fecharPasso(ctx, aberto.passo, "confirmado", { mensagem: r && r.Message ? String(r.Message).slice(0, 200) : "" }, "",
      escritasDeAuditoria(ctx, [evento("crm", "lead", lead.id, "enviou", "Clinicorp", "", "campanha " + campanha)], d.operacaoId));
    return { passo: passoPublico(p) };
  } catch (e) {
    if (!(e instanceof ErroClinicorp)) throw e;
    if (e.tipo === "desconhecido") {
      var p1 = fecharPasso(ctx, aberto.passo, "desconhecido", { mensagem: e.mensagem }, "",
        [pendenciaDoPasso(aberto.passo, "Envio da lead " + lead.nome + " para a campanha \"" + campanha + "\" com resultado desconhecido. A API não permite verificar: confira no Clinicorp e marque o resultado.")]);
      return { passo: passoPublico(p1) };
    }
    fecharPasso(ctx, aberto.passo, "recusado", { mensagem: e.mensagem, status: e.status }, "", []);
    tratarErroClinicorp(e, "envio de lead");
  }
}

/* Resultado desconhecido: verificar (quando a API deixa), confirmar à mão,
   reenviar (decisão explícita) ou abandonar. */
function integracaoDecidirPasso(ctx) {
  var d = ctx.dados || {};
  var p = acharPorChave("int_passos", String(d.passoId || ""));
  if (!p) falhar("nao_encontrado", "Passo não encontrado.");
  var decisao = String(d.decisao || "");
  if (["desconhecido", "enviando", "confirmado_sem_id"].indexOf(p.estado) < 0) return { passo: passoPublico(p), jaDecidido: true };
  var fecharPend = function () {
    var id = "pd-" + sha256Hex("passo:" + p.id).slice(0, 20);
    var pend = acharPorChave("int_pendencias", id);
    if (!pend || pend.estado !== "aberta") return [];
    var r = copiaLimpa(pend); r.estado = "resolvida"; r.resolvidoEm = agoraISO(); r.resolvidoPor = assinaturaDe(ctx.auth).nome; r.resolucao = decisao;
    return [{ t: "gravar", tabela: "int_pendencias", registro: r }];
  };
  if (decisao === "verificar") {
    if (p.tipo !== "pacientes.criar") falhar("dados_invalidos", "Este envio não pode ser verificado pela API do Clinicorp: confira lá e confirme à mão.");
    exigirClinicorpPronto(configClinicorp());
    var achados = [];
    try {
      if (p.pedido && p.pedido.MobilePhone) achados = buscarPacienteClinicorp("telefone", p.pedido.MobilePhone);
      if (!achados.length && p.pedido && p.pedido.Email) achados = buscarPacienteClinicorp("email", p.pedido.Email);
    } catch (e) { tratarErroClinicorp(e, "verificação"); }
    if (!achados.length) return { passo: passoPublico(p), encontrado: false, mensagem: "Nenhum paciente com esse telefone/e-mail no Clinicorp. Se quiser, reenvie (decisão explícita)." };
    if (achados.length > 1) return { passo: passoPublico(p), encontrado: false, candidatos: achados, mensagem: "Mais de um paciente encontrado: vincule o certo à mão." };
    var c = configClinicorp();
    var vinculo = carimbar(registroCompleto("int_vinculos", { id: "clinicorp:paciente:" + achados[0].externoId + ":lead", sistema: "clinicorp",
      assinante: c.assinante, unidade: c.unidade || "", tipo: "paciente", externoId: achados[0].externoId, localTipo: "lead", localId: p.localId,
      estado: "ativo", assinatura: "", sincronizadoEm: agoraISO(), criadoEm: agoraISO(), criadoPor: assinaturaDe(ctx.auth).nome }, null), 1, ctx, p.operacaoId);
    var feito = fecharPasso(ctx, p, "confirmado", { pacienteId: achados[0].externoId, verificado: true }, achados[0].externoId,
      [{ t: "gravar", tabela: "int_vinculos", registro: vinculo }].concat(fecharPend()));
    return { passo: passoPublico(feito), encontrado: true };
  }
  if (decisao === "confirmar") {
    var ext = String(d.externoId || "");
    var extras = fecharPend();
    if (p.tipo === "pacientes.criar" && ext) {
      var c2 = configClinicorp();
      extras.push({ t: "gravar", tabela: "int_vinculos", registro: carimbar(registroCompleto("int_vinculos", { id: "clinicorp:paciente:" + ext + ":lead",
        sistema: "clinicorp", assinante: c2.assinante, unidade: c2.unidade || "", tipo: "paciente", externoId: ext, localTipo: "lead", localId: p.localId,
        estado: "ativo", assinatura: "", sincronizadoEm: agoraISO(), criadoEm: agoraISO(), criadoPor: assinaturaDe(ctx.auth).nome }, null), 1, ctx, p.operacaoId) });
    }
    return { passo: passoPublico(fecharPasso(ctx, p, "confirmado", { confirmadoManualmente: true, por: assinaturaDe(ctx.auth).nome }, ext, extras)) };
  }
  if (decisao === "abandonar") {
    return { passo: passoPublico(fecharPasso(ctx, p, "abandonado", { por: assinaturaDe(ctx.auth).nome }, "", fecharPend())) };
  }
  if (decisao === "reenviar") {
    if (p.tipo === "pacientes.criar") return integracaoCriarPaciente({ dados: { operacaoId: p.operacaoId, leadId: p.localId, nome: p.pedido.Name,
      telefone: p.pedido.MobilePhone, email: p.pedido.Email, nascimento: p.pedido.BirthDate, reenviar: true }, auth: ctx.auth, pedidoId: ctx.pedidoId });
    if (p.tipo === "crm.enviarLead") return integracaoEnviarLead({ dados: { operacaoId: p.operacaoId, leadId: p.localId, campanha: p.pedido.BoardName,
      email: p.pedido.Email, notas: p.pedido.Notes, reenviar: true }, auth: ctx.auth, pedidoId: ctx.pedidoId });
  }
  falhar("dados_invalidos", "Decisão: verificar, confirmar, reenviar ou abandonar.");
}

/* ---------------------------------------------------------------------
   Contexto para os módulos — só leitura da planilha
   --------------------------------------------------------------------- */

function resumoDaIntegracaoParaModulo(modulo) {
  var c = configClinicorp();
  var recursos = {};
  Object.keys(CLINICORP_RECURSOS).forEach(function (k) {
    if (CLINICORP_RECURSOS[k].modulos.indexOf(modulo) >= 0) recursos[k] = modoDoRecurso(c, k);
  });
  var ultimas = {};
  Object.keys(recursos).forEach(function (k) { if ((c.ultimas || {})[k]) ultimas[k] = c.ultimas[k].em; });
  return { sistema: "clinicorp", situacao: situacaoClinicorp(c), recursos: recursos, ultimas: ultimas };
}

function integracaoContexto(ctx) {
  var modulo = String((ctx.dados || {}).modulo || "");
  return lerComConsistencia(function () {
    var estado = resumoDaIntegracaoParaModulo(modulo);
    var vinculos = lerTudo("int_vinculos").filter(function (v) { return v.estado === "ativo"; });
    var externos = null;
    var lerExternos = function () {
      if (!externos) { externos = {}; lerTudo("int_externos").forEach(function (x) { (externos[x.tipo] = externos[x.tipo] || []).push(x); }); }
      return externos;
    };
    var porLocal = {};
    if (modulo === "crm") {
      vinculos.filter(function (v) { return v.localTipo === "lead" && v.tipo === "paciente"; }).forEach(function (v) {
        var orc = (lerExternos().orcamento || []).filter(function (x) { return x.dados && x.dados.pacienteExternoId === v.externoId; })
          .map(function (x) { return { externoId: x.externoId, status: x.dados.status, valor: x.dados.valor, criadoEm: x.dados.criadoEm,
            aprovadoEm: x.dados.aprovadoEm, reprovadoEm: x.dados.reprovadoEm, procedimentos: (x.dados.procedimentos || []).map(function (p) { return p.descricao; }).slice(0, 8),
            vistoEm: x.vistoEm, ausenteDesde: x.ausenteDesde }; });
        porLocal[v.localId] = { pacienteId: v.externoId, desde: v.criadoEm, orcamentos: orc };
      });
      lerTudo("int_passos").forEach(function (p) {
        if (p.tipo !== "crm.enviarLead" || p.localTipo !== "lead") return;
        var alvo = porLocal[p.localId] = porLocal[p.localId] || {};
        (alvo.envios = alvo.envios || []).push({ campanha: p.pedido ? p.pedido.BoardName : "", estado: p.estado, em: p.atualizadoEm });
      });
    } else if (modulo === "agenda") {
      vinculos.filter(function (v) { return v.localTipo === "paciente" && v.tipo === "paciente"; }).forEach(function (v) {
        var ags = (lerExternos().agendamento || []).filter(function (x) { return x.dados && x.dados.pacienteExternoId === v.externoId; })
          .map(function (x) { return { externoId: x.externoId, dia: x.dados.dia, inicio: x.dados.inicio, fim: x.dados.fim, precisao: x.dados.precisao,
            profissionalId: x.dados.profissionalId, unidade: x.dados.unidade, statusId: x.dados.statusId, cancelado: x.dados.cancelado,
            excluido: x.dados.excluido, procedimento: x.dados.procedimento, alteradoExterno: x.dados.alteradoExterno, vistoEm: x.vistoEm,
            ausenteDesde: x.ausenteDesde }; })
          .sort(function (a, b) { return String(a.dia).localeCompare(String(b.dia)); });
        porLocal[v.localId] = { pacienteId: v.externoId, desde: v.criadoEm, agendamentos: ags.slice(-30) };
      });
    } else if (modulo === "entradas") {
      var ext = {};
      (lerExternos().recebimento || []).forEach(function (x) { ext[x.externoId] = x; });
      vinculos.filter(function (v) { return v.localTipo === "entrada" && v.tipo === "recebimento"; }).forEach(function (v) {
        var x = ext[v.externoId];
        var d = x ? x.dados : {};
        porLocal[v.localId] = { recebimentoId: v.externoId, desde: v.criadoEm, forma: d.forma || "", valor: d.valor === undefined ? null : d.valor,
          recebido: !!d.recebido, confirmado: !!d.confirmado, recebidoEm: d.recebidoEm || null, liquidacao: null,
          divergente: !!(x && v.assinatura && x.assinatura !== v.assinatura), vistoEm: x ? x.vistoEm : null, ausenteDesde: x ? x.ausenteDesde : null };
      });
    }
    return { estado: estado, porLocal: porLocal };
  });
}

/* Financeiro: o resumo do Clinicorp do período, se foi consultado — só
   para conferência, nunca somado. */
function contextoClinicorpFinanceiro(periodo) {
  var c = configClinicorp();
  if (modoDoRecurso(c, "resumo") === "desligado") return { situacao: situacaoClinicorp(c), resumo: null };
  var achados = lerTudo("int_externos").filter(function (x) { return x.tipo === "resumo" && x.dados && x.dados.de >= periodo.inicio && x.dados.ate <= periodo.fim; });
  var nao = lerTudo("int_externos").filter(function (x) {
    return x.tipo === "recebimento" && x.dados && (x.dados.recebidoEm || "") >= periodo.inicio && (x.dados.recebidoEm || "") <= periodo.fim;
  });
  var vinc = mapaDeVinculos();
  var semVinculo = nao.filter(function (x) { return !vinc["recebimento:" + x.externoId]; });
  return { situacao: situacaoClinicorp(c), consultadoEm: achados.length ? achados[achados.length - 1].vistoEm : null,
    resumo: achados.map(function (x) { return x.dados; }),
    recebimentos: { importados: nao.length, semVinculo: semVinculo.length,
      valorSemVinculo: semVinculo.reduce(function (t, x) { return t + (Number(x.dados.valor) || 0); }, 0) },
    aviso: "Valores do Clinicorp são para conferência: não entram nas somas do Alveare." };
}

/* Fichas locais para o painel escolher num vínculo: só id, nome e um
   detalhe — a sessão do painel não lê módulos inteiros. */
function integracaoLocais(ctx) {
  var d = ctx.dados || {};
  var tipo = String(d.tipo || ""), termo = chaveDeNome(d.busca || ""), digitos = soDigitos(d.busca || "");
  var casa = function (nome, fone) { return !termo || chaveDeNome(nome).indexOf(termo) >= 0 || (digitos.length >= 4 && soDigitos(fone).indexOf(digitos) >= 0); };
  var saida = [];
  if (tipo === "lead") lerTudo("crm_leads").forEach(function (l) { if (casa(l.nome, l.whatsapp)) saida.push({ id: l.id, nome: l.nome, detalhe: nomeEtapa(l.etapa) + (l.whatsapp ? " · " + l.whatsapp : "") }); });
  else if (tipo === "paciente") lerTudo("agenda_pacientes").forEach(function (p) { if (p.arquivada !== true && casa(p.nome, p.whatsapp)) saida.push({ id: p.id, nome: p.nome, detalhe: p.whatsapp || "" }); });
  else if (tipo === "entrada") {
    var idPag = agrupar(lerTudo("ent_pagamentos"), "entradaId");
    var dia = String(d.data || "");
    lerTudo("ent_entradas").forEach(function (e) {
      if (dia && e.data !== dia) return;
      if (casa(e.nome, "")) saida.push({ id: e.id, nome: e.nome, detalhe: dataBR(e.data) + " · " + dinheiroBR(totalPagamentos(idPag[e.id])) + (e.origem ? " · " + e.origem : "") });
    });
  } else falhar("dados_invalidos", "Tipo: lead, paciente ou entrada.");
  var vinc = {};
  lerTudo("int_vinculos").forEach(function (v) { if (v.estado === "ativo") vinc[v.localTipo + ":" + v.localId] = v.tipo + " " + v.externoId; });
  return { locais: saida.slice(-80).reverse().map(function (x) { x.vinculo = vinc[tipo + ":" + x.id] || ""; return x; }) };
}
