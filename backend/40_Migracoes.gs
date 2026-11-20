/* =====================================================================
   40_Migracoes — da planilha da 3.5.0 (schema 1) para o schema 2
   ---------------------------------------------------------------------
   Rodadas À MÃO, no editor do Apps Script, nesta ordem (docs/PUBLICACAO.md):

     migracaoDiagnosticar()   lê tudo, valida e simula. NÃO escreve nada.
     migracaoBackup()         cópia privada da planilha inteira + as
                              propriedades não secretas.
     migracaoEnsaiar()        constrói as abas novas SEM exigir manutenção —
                              para rodar numa CÓPIA da planilha.
     migracaoExecutar()       o mesmo, para valer: exige FLORESER_MANUTENCAO=sim.
     migracaoConferir()       relê as abas novas e reconcilia com as antigas.
     migracaoAtivar()         liga o schema 2 (só se a conferência passou).
     migracaoExportarParaV1() o caminho de volta (ver "Retorno").
     migracaoFinalizar()      depois de semanas estável: apaga os
                              verificadores de senha antigos.

   Princípios:
   · As abas da 3.5.0 NUNCA são alteradas. O schema 2 mora em abas novas.
     Voltar é reimplantar a versão anterior do script.
   · A leitura do legado é a MESMA da 3.5.0: por posição declarada, com
     getDisplayValues(). A aba Pacientes da planilha real tem o cabeçalho
     incompleto (as colunas 6–10 sem nome) — ler pelo cabeçalho perderia
     arquivada, whatsapp, origem e crmLeadId. O que passa da largura
     declarada é preservado em "legado", sem interpretação.
   · Determinística: a mesma planilha produz exatamente as mesmas linhas
     (ids de filhos derivados por hash). Rodar de novo reconstrói igual;
     cada aba concluída é pulada se a assinatura bater.
   · Nada é inventado. crmLeadId vem só da coluna crmLeadId; vínculo por
     semelhança de nome nunca é criado.
   ===================================================================== */

var MIGRACAO_V2 = "v1-para-v2";
var MIGRACAO_AUTOR = "Migração 4.0.0";

var LEGADO_V1 = {
  Leads: ["id", "nome", "whatsapp", "interesse", "observacoes", "etapa", "cadencia", "exCliente", "ultimoContato",
    "criadoEm", "dtConversa", "dtAgendamento", "dtComparecimento", "dtVenda", "dtReprovado", "origem", "dataAgendada"],
  Cadencias: ["id", "nome", "dias"],
  Leads_Contatos: ["id", "leadId", "data", "criadoEm", "autorTipo", "autorId", "autorNome"],
  Pacientes: ["id", "nome", "categoriaId", "obs", "criadoEm", "arquivada", "arquivadaEm", "whatsapp", "origem", "crmLeadId"],
  Pacientes_Ciclos: ["pacienteId", "area", "freq", "ultimo", "agendamentoData", "agendamentoFollowUp", "adiadaPara",
    "naoRespondeu", "proximos", "fimPrevisto", "aRemarcar"],
  Pacientes_Categorias: ["id", "nome", "cor"],
  Pacientes_Condicoes: ["id", "pacienteId", "texto", "inicio", "fim"],
  Pacientes_Maquinas: ["pacienteId", "maquinaId"],
  Pacientes_FollowUps: ["id", "pacienteId", "area", "data", "feito", "agendamentoData", "criadoEm", "feitoEm"],
  Pacientes_Historico: ["pacienteId", "tipo", "area", "data", "em", "fu", "maquina"],
  Maquinas: ["id", "nome", "cadencia", "cor", "obs"],
  Maquinas_Vindas: ["id", "maquinaId", "data", "obs", "criadoEm"],
  Maquinas_Respostas: ["vindaId", "pacienteId", "status", "em", "adiadaPara", "vezes"],
  Entradas: ["id", "nome", "data", "descricao", "obs", "criadoEm"],
  Entradas_Pagamentos: ["entradaId", "metodo", "valor", "parcelas"],
  Usuarios: ["id", "nome", "usuario", "senhaHash", "salt", "ativo", "admin", "crm", "agenda", "entradas", "criadoEm",
    "criadoPor", "ultimoLogin", "alteradoEm"],
  Usuarios_Sessoes: ["tokenHash", "usuarioId", "criadoEm", "ultimoUso", "expiraEm", "revogado"],
  Usuarios_Fotos: ["usuarioId", "foto", "atualizadoEm"],
  Lixeira: ["id", "tipo", "registroId", "titulo", "descricao", "dados", "excluidoEm", "excluidoPor", "excluidoPorId", "motivo"],
  Auditoria: ["id", "operacaoId", "em", "modulo", "entidade", "entidadeId", "acao", "campo", "antes", "depois",
    "autorTipo", "autorId", "autorNome", "contexto"],
  Logs: ["id", "quando", "nivel", "evento", "pagina", "mensagem", "versao", "sessao"],
  Sessoes: ["id", "primeiroAcesso", "ultimoAcesso", "paginas", "entrada", "atual", "referrer", "versao", "navegador",
    "plataforma", "idioma", "idiomas", "cookies", "tela", "viewport", "dpr", "toque", "tipo", "fuso", "conexao",
    "memoria", "nucleos", "dnt"]
};

/* A ordem em que as abas novas são escritas: pais antes de filhos. */
var ORDEM_V2 = ["sis_usuarios", "sis_fotos", "sis_sessoes", "sis_config", "crm_leads", "crm_contatos",
  "agenda_categorias", "agenda_maquinas", "agenda_pacientes", "agenda_ciclos", "agenda_agendamentos",
  "agenda_condicoes", "agenda_pac_maquinas", "agenda_historico", "agenda_followups", "agenda_vindas",
  "agenda_respostas", "ent_entradas", "ent_pagamentos", "sis_lixeira", "sis_auditoria", "sis_logs", "sis_visitas",
  "sis_operacoes", "sis_migracoes"];

/* ---------------------------------------------------------------------
   Ler o legado
   --------------------------------------------------------------------- */

function lerAbaLegada(nome) {
  var colunas = LEGADO_V1[nome];
  var sheet = planilha().getSheetByName(nome);
  if (!sheet) return { nome: nome, existe: false, linhas: [], cabecalho: [], avisos: [] };
  var ultima = sheet.getLastRow(), largura = Math.max(sheet.getLastColumn(), colunas.length);
  var cabecalho = largura ? sheet.getRange(1, 1, 1, largura).getDisplayValues()[0].map(function (v) { return String(v).trim(); }) : [];
  var avisos = [];
  colunas.forEach(function (c, i) {
    if (cabecalho[i] !== c) avisos.push("coluna " + (i + 1) + " de " + nome + " deveria se chamar \"" + c + "\" e se chama \"" + (cabecalho[i] || "") + "\" — lida pela posição, como a 3.5.0 lê");
  });
  var linhas = [];
  if (ultima >= 2) {
    var faixa = sheet.getRange(2, 1, ultima - 1, largura);
    var mostradas = faixa.getDisplayValues();
    var brutas = faixa.getValues();
    for (var i = 0; i < mostradas.length; i++) {
      var m = mostradas[i];
      /* a mesma regra da 3.5.0: linha sem as duas primeiras colunas não existe */
      if (String(m[0]).trim() === "" && String(m[1]).trim() === "") continue;
      var v = {}, b = {}, extras = null;
      colunas.forEach(function (c, k) { v[c] = String(m[k] === undefined ? "" : m[k]).trim(); b[c] = brutas[i][k]; });
      for (var k = colunas.length; k < largura; k++) {
        var x = String(m[k] === undefined ? "" : m[k]).trim();
        if (x) { extras = extras || {}; extras[cabecalho[k] || ("coluna" + (k + 1))] = x; }
      }
      linhas.push({ n: i + 2, v: v, b: b, extras: extras });
    }
  }
  return { nome: nome, existe: true, linhas: linhas, cabecalho: cabecalho, avisos: avisos };
}

function lerTodoLegado() {
  var legado = {};
  Object.keys(LEGADO_V1).forEach(function (n) { legado[n] = lerAbaLegada(n); });
  return legado;
}

/* ---------------------------------------------------------------------
   Conversões
   --------------------------------------------------------------------- */

function novoRelatorio() {
  return { erros: [], avisos: [], anomalias: {}, contagens: {}, somas: {}, crmLeadIds: 0 };
}

function anomalia(rel, tipo, detalhe) {
  var a = rel.anomalias[tipo] = rel.anomalias[tipo] || { quantas: 0, exemplos: [] };
  a.quantas++;
  if (a.exemplos.length < 5) a.exemplos.push(detalhe);
}

function idDerivado(prefixo, partes) {
  return prefixo + sha256Hex(partes.join("|")).slice(0, 16);
}

function boolLegado(t) {
  var s = String(t || "").trim().toLowerCase();
  if (!s) return null;
  return s === "sim" || s === "true" || s === "1" || s === "x";
}

/* Data de calendário: válida, vazia (null) ou anomalia preservada. */
function dataLegada(rel, onde, valor, legado, campo) {
  var s = String(valor || "").trim();
  if (!s) return null;
  if (dataValida(s)) return s;
  anomalia(rel, "data_invalida", onde + "." + campo);
  if (legado) legado[campo] = s;
  return null;
}

function inteiroLegado(t) {
  var s = String(t || "").trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

/* Instante gravado como hora local da clínica (sem fuso), como epoch, ISO
   com fuso, ou como célula que o Sheets converteu em data. */
function instanteLegado(bruto, mostrado) {
  if (bruto instanceof Date) {
    return instanteDeHoraLocal(Utilities.formatDate(bruto, fusoDaPlanilha(), "yyyy-MM-dd'T'HH:mm:ss"));
  }
  var s = String(mostrado === undefined ? bruto : mostrado || "").trim();
  if (!s) return null;
  if (/^\d{12,14}$/.test(s)) return new Date(Number(s)).toISOString();
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) { var d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return instanteDeHoraLocal(s);
  return null;
}

/* Texto de auditoria que o Sheets converteu em data ("01/05/2026" virou
   número): volta ao texto que foi gravado. */
function textoDaAuditoria(bruto, mostrado) {
  if (bruto instanceof Date) return Utilities.formatDate(bruto, fusoDaPlanilha(), "dd/MM/yyyy");
  return String(mostrado || "");
}

/* Quando foi a última alteração de cada registro, a 3.5.0 não guardava:
   fica vazio (desconhecido), em vez de uma data inventada. */
function raizMigrada(registro, legado) {
  registro.rev = 1;
  registro.opId = "migracao-v2";
  registro.atualizadoEm = null;
  registro.atualizadoPor = MIGRACAO_AUTOR;
  if ("legado" in registro || legado) registro.legado = legado && Object.keys(legado).length ? legado : null;
  return registro;
}

function converterLead(rel, l) {
  var v = l.v, leg = {};
  var etapa = v.etapa || "nao_responde";
  var cadencia = v.cadencia;
  if (ETAPAS_MIGRADAS[etapa]) {
    anomalia(rel, "etapa_antiga_convertida", etapa + " → " + ETAPAS_MIGRADAS[etapa]);
    if (etapa === "agendando") cadencia = "quente";
    etapa = ETAPAS_MIGRADAS[etapa];
  }
  if (!ETAPAS_CRM[etapa]) { anomalia(rel, "etapa_desconhecida", v.id + ":" + etapa); leg.etapa = etapa; }
  var r = { id: v.id, nome: v.nome, whatsapp: v.whatsapp, interesse: v.interesse, observacoes: v.observacoes,
    etapa: etapa, cadencia: cadencia, exCliente: boolLegado(v.exCliente) === true };
  ["ultimoContato", "criadoEm", "dtConversa", "dtAgendamento", "dtComparecimento", "dtVenda", "dtReprovado", "dataAgendada"]
    .forEach(function (c) { r[c] = dataLegada(rel, "Leads:" + v.id, v[c], leg, c); });
  r.origem = v.origem;
  if (l.extras) leg.colunasExtras = l.extras;
  return raizMigrada(r, leg);
}

function converterPaciente(rel, l) {
  var v = l.v, leg = {};
  var r = { id: v.id, nome: v.nome, categoriaId: v.categoriaId, obs: v.obs,
    criadoEm: dataLegada(rel, "Pacientes:" + v.id, v.criadoEm, leg, "criadoEm"),
    arquivada: boolLegado(v.arquivada) === true,
    arquivadaEm: dataLegada(rel, "Pacientes:" + v.id, v.arquivadaEm, leg, "arquivadaEm"),
    whatsapp: v.whatsapp, origem: v.origem, crmLeadId: v.crmLeadId };
  /* a 11ª coluna da planilha real: resíduo sem nome, preservado sem leitura */
  if (l.extras) { leg.colunasExtras = l.extras; anomalia(rel, "pacientes_coluna_sem_nome", v.id); }
  return raizMigrada(r, leg);
}

function converterCiclo(rel, c) {
  var v = c.v, onde = "Ciclos:" + v.pacienteId + "/" + v.area;
  var freq = inteiroLegado(v.freq);
  if (!intervaloValido(freq)) { anomalia(rel, "freq_invalida", onde + "=" + v.freq); freq = freq && freq > 0 ? Math.min(freq, INTERVALO_MAX) : 7; }
  var ciclo = { pacienteId: v.pacienteId, area: v.area, freq: freq,
    ultimo: dataLegada(rel, onde, v.ultimo, null, "ultimo"), adiadaPara: dataLegada(rel, onde, v.adiadaPara, null, "adiadaPara"),
    naoRespondeu: Math.max(0, inteiroLegado(v.naoRespondeu) || 0), fimPrevisto: dataLegada(rel, onde, v.fimPrevisto, null, "fimPrevisto"),
    aRemarcar: Math.max(0, inteiroLegado(v.aRemarcar) || 0) };
  /* agendamentoData + proximos ("d1, d2") viram linhas com identidade */
  var datas = [];
  var ag = dataLegada(rel, onde, v.agendamentoData, null, "agendamentoData");
  if (ag) datas.push({ data: ag, followUp: boolLegado(v.agendamentoFollowUp) === true });
  String(v.proximos || "").split(/[\s,;]+/).forEach(function (d) {
    d = d.trim();
    if (!d) return;
    if (!dataValida(d)) { anomalia(rel, "serie_data_invalida", onde + "=" + d); return; }
    if (datas.some(function (x) { return x.data === d; })) return;
    datas.push({ data: d, followUp: false });
  });
  /* a mesma regra de arrumarSerie: o próximo é o mais cedo */
  datas.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
  if (datas.length > 1 && ag && datas[0].data !== ag) anomalia(rel, "serie_reordenada", onde);
  datas.forEach(function (d, i) { if (i > 0) d.followUp = false; });
  var agendamentos = datas.map(function (d) {
    return { id: idDerivado("ag", [v.pacienteId, v.area, d.data]), pacienteId: v.pacienteId, area: v.area,
      data: d.data, followUp: d.followUp, criadoEm: null };
  });
  return { ciclo: ciclo, agendamentos: agendamentos };
}

function converterHistorico(h, semente) {
  var v = h.v;
  return { id: idDerivado("h", [semente, v.pacienteId, h.n, v.tipo, v.area, v.data, v.em, v.fu, v.maquina]),
    pacienteId: v.pacienteId, tipo: v.tipo, area: v.area, data: dataValida(v.data) ? v.data : null,
    em: dataValida(v.em) ? v.em : null, fu: dataValida(v.fu) ? v.fu : null, maquina: v.maquina };
}

function converterEntrada(rel, l) {
  var v = l.v, leg = {};
  var r = { id: v.id, nome: v.nome, data: dataLegada(rel, "Entradas:" + v.id, v.data, leg, "data"),
    descricao: v.descricao, obs: v.obs, criadoEm: instanteLegado(l.b.criadoEm, v.criadoEm) };
  if (v.criadoEm && !r.criadoEm) { leg.criadoEm = v.criadoEm; anomalia(rel, "instante_invalido", "Entradas:" + v.id); }
  if (l.extras) leg.colunasExtras = l.extras;
  return raizMigrada(r, leg);
}

function converterPagamento(rel, p, ordem) {
  var v = p.v;
  var valor = textoParaCentavos(v.valor);
  if (valor === null) { rel.erros.push("Valor ilegível no pagamento da entrada " + v.entradaId + ": \"" + v.valor + "\""); valor = 0; }
  var metodo = String(v.metodo || "").trim().toLowerCase();
  if (METODOS_ENTRADA.indexOf(metodo) < 0) { anomalia(rel, "metodo_desconhecido", v.entradaId + ":" + metodo); metodo = "pix"; }
  var parcelas = inteiroLegado(v.parcelas) || 1;
  return { id: idDerivado("pg", [v.entradaId, ordem, v.metodo, v.valor, v.parcelas, p.n]), entradaId: v.entradaId, ordem: ordem,
    metodo: metodo, valor: valor, parcelas: Math.min(12, Math.max(1, parcelas)) };
}

/* A lixeira guarda o registro inteiro no formato da época: ele é
   convertido pelas mesmas funções, para restaurar no schema novo. */
function converterItemDaLixeira(rel, item) {
  var dados = null;
  try { dados = JSON.parse(item.v.dados); } catch (e) { dados = null; }
  if (!dados) { rel.avisos.push("Item da lixeira " + item.v.id + " com conteúdo ilegível — guardado como estava."); return { versao: 1, bruto: item.v.dados }; }
  var linha = function (cols, o, n) { var v = {}; cols.forEach(function (c) { v[c] = String(o && o[c] !== undefined && o[c] !== null ? o[c] : "").trim(); }); return { n: n, v: v, b: {}, extras: null }; };
  var semente = "lx:" + item.v.id;
  if (item.v.tipo === "crm") return { versao: 2, raiz: converterLead(rel, linha(LEGADO_V1.Leads, dados.lead, 0)), filhos: {} };
  if (item.v.tipo === "entradas") {
    var ent = converterEntrada(rel, linha(LEGADO_V1.Entradas, dados.entrada, 0));
    return { versao: 2, raiz: ent, filhos: { ent_pagamentos: (dados.pagamentos || []).map(function (p, i) {
      return converterPagamento(rel, linha(LEGADO_V1.Entradas_Pagamentos, p, i), i); }) } };
  }
  var pac = converterPaciente(rel, linha(LEGADO_V1.Pacientes, dados.paciente, 0));
  var ciclos = [], ags = [];
  (dados.ciclos || []).forEach(function (c, i) { var x = converterCiclo(rel, linha(LEGADO_V1.Pacientes_Ciclos, c, i)); ciclos.push(x.ciclo); ags = ags.concat(x.agendamentos); });
  return { versao: 2, raiz: pac, filhos: {
    agenda_ciclos: ciclos, agenda_agendamentos: ags,
    agenda_condicoes: (dados.condicoes || []).map(function (c) { return { id: String(c.id), pacienteId: String(c.pacienteId), texto: String(c.texto || ""), inicio: dataValida(c.inicio) ? c.inicio : null, fim: dataValida(c.fim) ? c.fim : null }; }),
    agenda_pac_maquinas: (dados.maquinas || []).map(function (m) { return { pacienteId: String(m.pacienteId), maquinaId: String(m.maquinaId) }; }),
    agenda_historico: (dados.historico || []).map(function (h, i) { return converterHistorico(linha(LEGADO_V1.Pacientes_Historico, h, i), semente); }),
    agenda_followups: (dados.followups || []).map(function (f) { return converterFollowup(rel, linha(LEGADO_V1.Pacientes_FollowUps, f, 0)); }),
    agenda_respostas: (dados.respostas || []).map(function (r) { return converterResposta(linha(LEGADO_V1.Maquinas_Respostas, r, 0)); })
  } };
}

function converterFollowup(rel, f) {
  var v = f.v, o = "FollowUps:" + v.id;
  return raizMigrada({ id: v.id, pacienteId: v.pacienteId, area: v.area || "facial", data: dataLegada(rel, o, v.data, null, "data"),
    feito: boolLegado(v.feito) === true, agendamentoData: dataLegada(rel, o, v.agendamentoData, null, "agendamentoData"),
    criadoEm: dataLegada(rel, o, v.criadoEm, null, "criadoEm"), feitoEm: dataLegada(rel, o, v.feitoEm, null, "feitoEm") }, null);
}

function converterResposta(r) {
  var v = r.v;
  return { vindaId: v.vindaId, pacienteId: v.pacienteId, status: v.status, em: dataValida(v.em) ? v.em : null,
    adiadaPara: dataValida(v.adiadaPara) ? v.adiadaPara : null, vezes: inteiroLegado(v.vezes) };
}

/* ---------------------------------------------------------------------
   Construir o schema 2 inteiro, em memória
   --------------------------------------------------------------------- */

function construirV2(legado, agora) {
  var rel = novoRelatorio();
  var T = {};
  ORDEM_V2.forEach(function (n) { T[n] = []; });
  var L = function (n) { return (legado[n] && legado[n].linhas) || []; };
  Object.keys(legado).forEach(function (n) { (legado[n].avisos || []).forEach(function (a) { rel.avisos.push(a); }); });

  /* contas e sessões */
  L("Usuarios").forEach(function (u) {
    var v = u.v;
    T.sis_usuarios.push({ id: v.id, nome: v.nome, usuario: v.usuario, esquema: "v1", senhaHash: v.senhaHash, salt: v.salt,
      iteracoes: null, ativo: boolLegado(v.ativo) === true, admin: boolLegado(v.admin) === true, crm: boolLegado(v.crm) === true,
      agenda: boolLegado(v.agenda) === true, entradas: boolLegado(v.entradas) === true, credencialVersao: 1,
      criadoEm: instanteLegado(u.b.criadoEm, v.criadoEm), criadoPor: v.criadoPor, ultimoLogin: instanteLegado(u.b.ultimoLogin, v.ultimoLogin),
      alteradoEm: instanteLegado(u.b.alteradoEm, v.alteradoEm), legado: null });
    if (!/^[0-9a-f]{64}$/.test(v.senhaHash)) rel.erros.push("A conta @" + v.usuario + " está sem verificador de senha legível.");
  });
  L("Usuarios_Fotos").forEach(function (f) {
    T.sis_fotos.push({ usuarioId: f.v.usuarioId, foto: f.v.foto, atualizadoEm: instanteLegado(f.b.atualizadoEm, f.v.atualizadoEm) });
  });
  /* As sessões de conta abertas continuam valendo: o hash do token é o
     mesmo, e o navegador adota o token antigo (compartilhado/sessao.js). */
  L("Usuarios_Sessoes").forEach(function (s) {
    var v = s.v;
    var expira = Number(v.expiraEm) || 0, criado = Number(v.criadoEm) || 0;
    if (boolLegado(v.revogado) === true || expira <= agora || !/^[0-9a-f]{64}$/.test(v.tokenHash)) return;
    T.sis_sessoes.push({ tokenHash: v.tokenHash, tipo: "conta", usuarioId: v.usuarioId, modulo: "", criadoEm: criado,
      ultimoUso: Number(v.ultimoUso) || criado, expiraEm: expira,
      expiraAbsoluto: Math.max(criado + SESSAO_CONTA_ABSOLUTO_MS, agora + SESSAO_CONTA_INATIVIDADE_MS),
      revogadoEm: null, motivo: "", credencialVersao: 1, operacaoId: "", agente: "migrada da 3.5.0" });
  });

  /* configuração */
  var dias = {};
  L("Cadencias").forEach(function (c) { var n = inteiroLegado(c.v.dias); if (n > 0) dias[c.v.id] = n; });
  T.sis_config.push(raizMigrada({ chave: "crm.cadencias", valor: Object.keys(dias).length ? dias : CADENCIAS_PADRAO_DIAS }, null));
  T.sis_config.push(raizMigrada({ chave: "agenda.config", valor: { criado: propriedade("agenda_criado", ""),
    seedMaq: propriedade("agenda_seedmaq", "") === "sim" } }, null));

  /* CRM */
  L("Leads").forEach(function (l) { T.crm_leads.push(converterLead(rel, l)); });
  L("Leads_Contatos").forEach(function (c) {
    var v = c.v;
    T.crm_contatos.push({ id: v.id, leadId: v.leadId, data: dataLegada(rel, "Contatos:" + v.id, v.data, null, "data"),
      criadoEm: instanteLegado(c.b.criadoEm, v.criadoEm), autorTipo: v.autorTipo, autorId: v.autorId, autorNome: v.autorNome, opId: "" });
  });

  /* Agenda */
  L("Pacientes_Categorias").forEach(function (c) { T.agenda_categorias.push(raizMigrada({ id: c.v.id, nome: c.v.nome, cor: c.v.cor }, null)); });
  L("Maquinas").forEach(function (m) { T.agenda_maquinas.push(raizMigrada({ id: m.v.id, nome: m.v.nome, cadencia: m.v.cadencia, cor: m.v.cor, obs: m.v.obs }, null)); });
  L("Pacientes").forEach(function (p) { T.agenda_pacientes.push(converterPaciente(rel, p)); });
  L("Pacientes_Ciclos").forEach(function (c) {
    var x = converterCiclo(rel, c);
    T.agenda_ciclos.push(x.ciclo);
    T.agenda_agendamentos = T.agenda_agendamentos.concat(x.agendamentos);
  });
  L("Pacientes_Condicoes").forEach(function (c) {
    var v = c.v;
    T.agenda_condicoes.push({ id: v.id, pacienteId: v.pacienteId, texto: v.texto, inicio: dataLegada(rel, "Condicoes:" + v.id, v.inicio, null, "inicio"),
      fim: dataLegada(rel, "Condicoes:" + v.id, v.fim, null, "fim") });
  });
  var parMaq = {};
  L("Pacientes_Maquinas").forEach(function (m) {
    var k = m.v.pacienteId + "|" + m.v.maquinaId;
    if (parMaq[k]) { anomalia(rel, "maquina_repetida", k); return; }
    parMaq[k] = true;
    T.agenda_pac_maquinas.push({ pacienteId: m.v.pacienteId, maquinaId: m.v.maquinaId });
  });
  L("Pacientes_Historico").forEach(function (h) {
    if (h.v.area && AREAS_AGENDA.indexOf(h.v.area) < 0) anomalia(rel, "historico_area_estranha", h.v.pacienteId + ":" + h.v.area);
    T.agenda_historico.push(converterHistorico(h, "v1"));
  });
  L("Pacientes_FollowUps").forEach(function (f) { T.agenda_followups.push(converterFollowup(rel, f)); });
  L("Maquinas_Vindas").forEach(function (vd) {
    var v = vd.v;
    T.agenda_vindas.push(raizMigrada({ id: v.id, maquinaId: v.maquinaId, data: dataLegada(rel, "Vindas:" + v.id, v.data, null, "data"),
      obs: v.obs, criadoEm: dataLegada(rel, "Vindas:" + v.id, v.criadoEm, null, "criadoEm") }, null));
  });
  /* respostas: como a 3.5.0, a última de cada paciente numa vinda vale */
  var porResp = {};
  L("Maquinas_Respostas").forEach(function (r) {
    var k = r.v.vindaId + "|" + r.v.pacienteId;
    if (porResp[k] !== undefined) anomalia(rel, "resposta_repetida", k);
    porResp[k] = converterResposta(r);
  });
  Object.keys(porResp).forEach(function (k) { T.agenda_respostas.push(porResp[k]); });

  /* Entradas — o dinheiro é reconciliado centavo a centavo */
  L("Entradas").forEach(function (e) { T.ent_entradas.push(converterEntrada(rel, e)); });
  var ordem = {};
  var somaAntes = 0;
  L("Entradas_Pagamentos").forEach(function (p) {
    var o = ordem[p.v.entradaId] = (ordem[p.v.entradaId] === undefined ? 0 : ordem[p.v.entradaId] + 1);
    var c = textoParaCentavos(p.v.valor);
    somaAntes += c || 0;
    T.ent_pagamentos.push(converterPagamento(rel, p, o));
  });
  rel.somas.pagamentosV1 = somaAntes;

  /* sistema */
  L("Lixeira").forEach(function (i) {
    var v = i.v;
    T.sis_lixeira.push({ id: v.id, tipo: v.tipo, registroId: v.registroId, titulo: v.titulo, descricao: v.descricao,
      dados: converterItemDaLixeira(rel, i), excluidoEm: instanteLegado(i.b.excluidoEm, v.excluidoEm),
      excluidoPor: v.excluidoPor, excluidoPorId: v.excluidoPorId, motivo: v.motivo });
  });
  L("Auditoria").forEach(function (a) {
    var v = a.v, b = a.b;
    T.sis_auditoria.push({ id: v.id, operacaoId: v.operacaoId, em: instanteLegado(b.em, v.em), modulo: v.modulo, entidade: v.entidade,
      entidadeId: v.entidadeId, acao: v.acao, campo: v.campo, antes: textoDaAuditoria(b.antes, v.antes),
      depois: textoDaAuditoria(b.depois, v.depois), autorTipo: v.autorTipo, autorId: v.autorId, autorNome: v.autorNome,
      contexto: v.contexto, pedidoId: "" });
    if (b.em instanceof Date) anomalia(rel, "auditoria_em_convertido_pelo_sheets", v.id);
  });
  L("Logs").forEach(function (l) {
    var v = l.v;
    T.sis_logs.push({ id: v.id, quando: instanteLegado(l.b.quando, v.quando), nivel: v.nivel, evento: v.evento, pagina: v.pagina,
      mensagem: v.mensagem, versao: v.versao, sessao: v.sessao, pedidoId: "" });
  });
  L("Sessoes").forEach(function (s) { var o = {}; LEGADO_V1.Sessoes.forEach(function (c) { o[c] = s.v[c]; }); T.sis_visitas.push(o); });

  validarV2(T, rel);
  rel.crmLeadIds = T.agenda_pacientes.filter(function (p) { return p.crmLeadId; }).length;
  ORDEM_V2.forEach(function (n) { rel.contagens[n] = T[n].length; });
  rel.somas.pagamentosV2 = T.ent_pagamentos.reduce(function (s, p) { return s + (Number(p.valor) || 0); }, 0);
  if (rel.somas.pagamentosV1 !== rel.somas.pagamentosV2) rel.erros.push("A soma dos pagamentos não confere: " + rel.somas.pagamentosV1 + " ≠ " + rel.somas.pagamentosV2 + " centavos.");
  return { tabelas: T, relatorio: rel };
}

/* Chaves únicas e relações. Duplicata em chave e órfão em relação forte
   bloqueiam a migração: nada é convertido "mais ou menos". */
function validarV2(T, rel) {
  nomesDasTabelas().forEach(function (n) {
    if (!T[n]) return;
    var def = definicaoTabela(n), vistas = {};
    T[n].forEach(function (r) {
      var k = def.chave.map(function (c) { return String(r[c]); }).join("|");
      if (!def.chave.every(function (c) { return String(r[c] || "") !== ""; })) { rel.erros.push(n + ": registro sem chave (" + k + ")."); return; }
      if (vistas[k]) rel.erros.push(n + ": chave repetida " + k + ".");
      vistas[k] = true;
    });
  });
  RELACOES_V2.forEach(function (rr) {
    var pais = {};
    var defPai = definicaoTabela(rr.para);
    (T[rr.para] || []).forEach(function (r) { pais[String(r[defPai.chave[0]])] = true; });
    var orfaos = (T[rr.de] || []).filter(function (r) { return r[rr.campo] && !pais[String(r[rr.campo])]; });
    if (!orfaos.length) return;
    var msg = rr.de + "." + rr.campo + " → " + rr.para + ": " + orfaos.length + " sem correspondente";
    if (rr.forca === "forte") rel.erros.push(msg + ".");
    else rel.avisos.push(msg + " (relação fraca, mantido).");
  });
}

/* ---------------------------------------------------------------------
   Escrever e conferir
   --------------------------------------------------------------------- */

function assinaturaDasLinhas(nome, registros) {
  var def = definicaoTabela(nome);
  return sha256Hex(registros.map(function (r) {
    return def.campos.map(function (c) { return escreverValor(c.t, r[c.n], c.n); }).join("\u0001");
  }).join("\u0002"));
}

function escreverTabelaV2(nome, registros) {
  var sheet = garantirAbaDoEsquema(nome);
  var t = tabela(nome);
  var ultima = sheet.getLastRow();
  if (ultima >= 2) sheet.deleteRows(2, ultima - 1);
  t.linhas = null; t.ultima = 1;
  for (var i = 0; i < registros.length; i += 1500) inserir(nome, registros.slice(i, i + 1500));
}

function registrarEtapa(etapa, estado, relatorio) {
  var id = MIGRACAO_V2 + ":" + etapa;
  var atual = acharPorChave("sis_migracoes", id);
  gravarPorChave("sis_migracoes", { id: id, versao: 2, etapa: etapa, estado: estado,
    iniciadoEm: atual && atual.iniciadoEm ? atual.iniciadoEm : agoraISO(), concluidoEm: estado === "concluida" ? agoraISO() : null,
    relatorio: relatorio || null });
}

function migracaoDiagnosticar() {
  reiniciarExecucao();
  var v2 = construirV2(lerTodoLegado(), Date.now());
  var r = v2.relatorio;
  var texto = resumoDoRelatorio(r);
  Logger.log(texto);
  return r;
}

function resumoDoRelatorio(r) {
  var linhas = ["MIGRAÇÃO v1 → v2 — " + (r.erros.length ? "BLOQUEADA" : "pronta")];
  linhas.push("Erros (" + r.erros.length + "):");
  r.erros.forEach(function (e) { linhas.push("  · " + e); });
  linhas.push("Avisos (" + r.avisos.length + "):");
  r.avisos.forEach(function (e) { linhas.push("  · " + e); });
  linhas.push("Anomalias preservadas:");
  Object.keys(r.anomalias).forEach(function (k) {
    linhas.push("  · " + k + ": " + r.anomalias[k].quantas + " (ex.: " + r.anomalias[k].exemplos.slice(0, 3).join("; ") + ")");
  });
  linhas.push("Contagens: " + JSON.stringify(r.contagens));
  linhas.push("Pagamentos: v1 " + r.somas.pagamentosV1 + " · v2 " + r.somas.pagamentosV2 + " (centavos)");
  linhas.push("Pacientes com crmLeadId (copiados, nenhum deduzido): " + r.crmLeadIds);
  return linhas.join("\n");
}

function migracaoBackup() {
  reiniciarExecucao();
  var ss = planilha();
  var nome = "FloreSer — backup antes da 4.0.0 — " + Utilities.formatDate(new Date(), fusoDaClinica(), "yyyy-MM-dd HH'h'mm");
  var copia = ss.copy(nome);
  /* propriedades: os valores das que não são segredo; dos segredos, só o
     nome — o valor continua só nas Script Properties */
  var props = PropertiesService.getScriptProperties().getProperties();
  var linhas = [["chave", "valor"]];
  Object.keys(props).sort().forEach(function (k) {
    var secreta = /SENHA|PIMENTA|sessoes/i.test(k);
    linhas.push([k, secreta ? "(segredo — não copiado)" : String(props[k]).slice(0, 4000)]);
  });
  var aba = copia.insertSheet("_propriedades");
  aba.getRange(1, 1, linhas.length, 2).setNumberFormat("@").setValues(linhas);
  definirPropriedade("FLORESER_BACKUP_ID", copia.getId());
  Logger.log("Backup criado: " + nome + " (" + copia.getUrl() + ")");
  return { id: copia.getId(), url: copia.getUrl(), nome: nome };
}

function migracaoEnsaiar() { return executarMigracao({ ensaio: true }); }
function migracaoExecutar() { return executarMigracao({ ensaio: false }); }

function executarMigracao(opcoes) {
  reiniciarExecucao();
  if (!opcoes.ensaio && !emManutencao()) throw new Error("Ligue FLORESER_MANUTENCAO=sim antes: nenhum site pode gravar durante a conversão.");
  if (!opcoes.ensaio && !propriedade("FLORESER_BACKUP_ID", "")) throw new Error("Rode migracaoBackup() antes.");
  if (schemaAtivo() >= 2 && !opcoes.refazer) throw new Error("O schema 2 já está ativo. Migrar de novo apagaria o que foi gravado depois.");
  var comeco = Date.now();
  var v2 = construirV2(lerTodoLegado(), Date.now());
  if (v2.relatorio.erros.length) {
    Logger.log(resumoDoRelatorio(v2.relatorio));
    throw new Error("Migração bloqueada: " + v2.relatorio.erros.length + " erro(s). Veja o registro de execução.");
  }
  garantirAbaDoEsquema("sis_migracoes");
  registrarEtapa("inicio", "andamento", { ensaio: !!opcoes.ensaio });
  var feitas = [], puladas = [];
  for (var i = 0; i < ORDEM_V2.length; i++) {
    var nome = ORDEM_V2[i];
    if (nome === "sis_migracoes") continue;
    var assinatura = assinaturaDasLinhas(nome, v2.tabelas[nome]);
    var etapa = acharPorChave("sis_migracoes", MIGRACAO_V2 + ":" + nome);
    if (etapa && etapa.estado === "concluida" && etapa.relatorio && etapa.relatorio.assinatura === assinatura &&
        planilha().getSheetByName(nome)) { puladas.push(nome); continue; }
    if (Date.now() - comeco > 270000) {
      registrarEtapa("inicio", "parcial", { feitas: feitas, falta: ORDEM_V2.slice(i) });
      Logger.log("Tempo quase no fim: rode de novo para continuar de " + nome + ".");
      return { parcial: true, feitas: feitas };
    }
    escreverTabelaV2(nome, v2.tabelas[nome]);
    registrarEtapa(nome, "concluida", { linhas: v2.tabelas[nome].length, assinatura: assinatura });
    feitas.push(nome);
  }
  SpreadsheetApp.flush();
  var conferencia = conferirMigracao(v2);
  registrarEtapa("conferencia", conferencia.ok ? "concluida" : "falhou", conferencia);
  avancarEpoca();
  Logger.log(resumoDoRelatorio(v2.relatorio) + "\n\nCONFERÊNCIA: " + (conferencia.ok ? "OK" : "FALHOU") + "\n" + conferencia.problemas.join("\n"));
  return { feitas: feitas, puladas: puladas, relatorio: v2.relatorio, conferencia: conferencia };
}

/* Relê cada aba nova e compara linha a linha com o que foi construído. */
function conferirMigracao(v2) {
  esquecerTabelas();
  var problemas = [];
  ORDEM_V2.forEach(function (nome) {
    if (nome === "sis_migracoes") return;
    var lidas = lerTudo(nome);
    var esperadas = v2.tabelas[nome];
    if (lidas.length !== esperadas.length) { problemas.push(nome + ": " + lidas.length + " linhas, esperadas " + esperadas.length); return; }
    if (assinaturaDasLinhas(nome, lidas) !== assinaturaDasLinhas(nome, esperadas)) problemas.push(nome + ": conteúdo diferente do construído");
  });
  var soma = lerTudo("ent_pagamentos").reduce(function (s, p) { return s + (Number(p.valor) || 0); }, 0);
  if (soma !== v2.relatorio.somas.pagamentosV1) problemas.push("soma dos pagamentos relida: " + soma + " ≠ " + v2.relatorio.somas.pagamentosV1);
  return { ok: !problemas.length, problemas: problemas, somaPagamentos: soma };
}

function migracaoConferir() {
  reiniciarExecucao();
  var v2 = construirV2(lerTodoLegado(), Date.now());
  var c = conferirMigracao(v2);
  Logger.log("CONFERÊNCIA: " + (c.ok ? "OK" : "FALHOU") + "\n" + c.problemas.join("\n"));
  return c;
}

function migracaoAtivar() {
  reiniciarExecucao();
  var etapa = acharPorChave("sis_migracoes", MIGRACAO_V2 + ":conferencia");
  if (!etapa || etapa.estado !== "concluida") throw new Error("A conferência não passou: rode migracaoExecutar() (ou migracaoConferir()).");
  if (segredosFaltando().length) throw new Error("Faltam segredos nas propriedades: " + segredosFaltando().join(", "));
  prepararSegredos();
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "2");
  registrarEtapa("ativacao", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 2 ativo. Desligue FLORESER_MANUTENCAO e publique o site 4.0.0.");
  return { ativo: 2 };
}

/* ---------------------------------------------------------------------
   Retorno para a 3.5.0
   ---------------------------------------------------------------------
   As abas antigas continuam intactas desde a migração. Voltar logo depois
   é só reimplantar a versão anterior do script e o site anterior. Se já
   houver gravações no schema 2 que precisam ir junto, esta função reescreve
   as abas antigas a partir das novas (com manutenção ligada). Contas que
   já entraram pelo PBKDF2 voltam com o verificador antigo guardado em
   "legado"; quem trocou de senha depois da migração precisará de senha
   nova pelo painel da 3.5.0. */
function migracaoExportarParaV1() {
  reiniciarExecucao();
  if (!emManutencao()) throw new Error("Ligue FLORESER_MANUTENCAO=sim antes de exportar.");
  var ss = planilha();
  var escrever = function (nome, linhas) {
    var sheet = ss.getSheetByName(nome) || ss.insertSheet(nome);
    var cols = LEGADO_V1[nome];
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    var ultima = sheet.getLastRow(), largura = Math.max(sheet.getLastColumn(), cols.length);
    if (ultima >= 2) sheet.getRange(2, 1, ultima - 1, largura).clearContent();
    if (linhas.length) sheet.getRange(2, 1, linhas.length, cols.length).setNumberFormat("@")
      .setValues(linhas.map(function (o) { return cols.map(function (c) { return o[c] === null || o[c] === undefined ? "" : String(o[c]); }); }));
  };
  var sn = function (b) { return b === true ? "sim" : "não"; };
  escrever("Leads", lerTudo("crm_leads").map(function (l) { var o = leadPublica(l); o.exCliente = sn(l.exCliente); return o; }));
  escrever("Leads_Contatos", lerTudo("crm_contatos").map(function (c) { return { id: c.id, leadId: c.leadId, data: c.data, criadoEm: c.criadoEm, autorTipo: c.autorTipo, autorId: c.autorId, autorNome: c.autorNome }; }));
  var idx = indiceDaAgenda();
  escrever("Pacientes", lerTudo("agenda_pacientes").map(function (p) { return { id: p.id, nome: p.nome, categoriaId: p.categoriaId, obs: p.obs, criadoEm: p.criadoEm, arquivada: sn(p.arquivada), arquivadaEm: p.arquivadaEm, whatsapp: p.whatsapp, origem: p.origem, crmLeadId: p.crmLeadId }; }));
  escrever("Pacientes_Ciclos", lerTudo("agenda_ciclos").map(function (c) {
    var ci = cicloDasLinhas(c, idx.agendamentos[c.pacienteId]);
    return { pacienteId: c.pacienteId, area: c.area, freq: c.freq, ultimo: c.ultimo, agendamentoData: ci.agendamento ? ci.agendamento.data : "",
      agendamentoFollowUp: ci.agendamento ? sn(ci.agendamento.temFollowUp) : "", adiadaPara: c.adiadaPara, naoRespondeu: c.naoRespondeu,
      proximos: ci.proximos.join(", "), fimPrevisto: c.fimPrevisto, aRemarcar: c.aRemarcar };
  }));
  escrever("Pacientes_Condicoes", lerTudo("agenda_condicoes"));
  escrever("Pacientes_Maquinas", lerTudo("agenda_pac_maquinas"));
  escrever("Pacientes_Historico", lerTudo("agenda_historico"));
  escrever("Pacientes_FollowUps", lerTudo("agenda_followups").map(function (f) { var o = followupPublico(f); o.feito = sn(f.feito); return o; }));
  escrever("Pacientes_Categorias", lerTudo("agenda_categorias"));
  escrever("Maquinas", lerTudo("agenda_maquinas"));
  escrever("Maquinas_Vindas", lerTudo("agenda_vindas"));
  escrever("Maquinas_Respostas", lerTudo("agenda_respostas"));
  escrever("Entradas", lerTudo("ent_entradas"));
  escrever("Entradas_Pagamentos", lerTudo("ent_pagamentos").sort(function (a, b) { return a.entradaId === b.entradaId ? a.ordem - b.ordem : 0; })
    .map(function (p) { return { entradaId: p.entradaId, metodo: p.metodo, valor: centavosParaTexto(p.valor), parcelas: p.parcelas }; }));
  escrever("Usuarios", lerTudo("sis_usuarios").map(function (u) {
    var v1 = u.esquema === "pbkdf2" ? (u.legado || {}) : { senhaHashV1: u.senhaHash, saltV1: u.salt };
    return { id: u.id, nome: u.nome, usuario: u.usuario, senhaHash: v1.senhaHashV1 || "", salt: v1.saltV1 || "", ativo: sn(u.ativo),
      admin: sn(u.admin), crm: sn(u.crm), agenda: sn(u.agenda), entradas: sn(u.entradas), criadoEm: u.criadoEm, criadoPor: u.criadoPor,
      ultimoLogin: u.ultimoLogin, alteradoEm: u.alteradoEm };
  }));
  registrarTecnico("SECURITY", "MIGRACAO_EXPORTADA_V1", "Abas da 3.5.0 reescritas a partir do schema 2.");
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "1");
  Logger.log("Abas antigas atualizadas. Reimplante a versão 3.5.0 do script e o site anterior.");
  return { ok: true };
}

/* Semanas depois, com tudo estável: os verificadores de senha da 3.5.0
   deixam de ser guardados. A partir daqui, voltar exige senha nova. */
function migracaoFinalizar() {
  reiniciarExecucao();
  return comTrava(function () {
    var contas = lerTudo("sis_usuarios").filter(function (u) { return u.legado; });
    contas.forEach(function (u) { u.legado = null; });
    if (contas.length) atualizar("sis_usuarios", contas);
    registrarEtapa("finalizacao", "concluida", { verificadoresRemovidos: contas.length });
    return { verificadoresRemovidos: contas.length };
  });
}
