/* =====================================================================
   23_ServicoAgenda — leitura e operações da Agenda; integração com o CRM
   ---------------------------------------------------------------------
   A paciente é um agregado: a linha em agenda_pacientes (com a revisão)
   e os filhos — ciclos por área, agendamentos (um por data, com id
   próprio), condições, máquinas e histórico. O navegador continua vendo a
   forma de sempre ({ ciclos: { facial: { agendamento, proximos, ... } } });
   a tradução acontece aqui.

   agenda.aplicar — operações:
     paciente.criar    { id, dados }               agregado inteiro
     paciente.alterar  { id, revBase, campos?, ciclos?, condicoes?, maquinas?, historicoNovos? }
                       ciclos: só as áreas que mudaram; condicoes/maquinas:
                       a lista da paciente; historicoNovos: só o que entrou
     paciente.remover  { id, motivo? }             vai para a lixeira
     followup|categoria|maquina|vinda .criar/.alterar/.remover
     config.agenda     { revBase, criado, seedMaq }
   ===================================================================== */

var CAMPOS_PACIENTE = {
  nome: { tipo: "texto", max: 200 }, categoriaId: { tipo: "texto", max: 80 }, obs: { tipo: "texto", max: 8000 },
  criadoEm: { tipo: "data" }, arquivada: { tipo: "booleano" }, arquivadaEm: { tipo: "data" },
  whatsapp: { tipo: "texto", max: 40 }, origem: { tipo: "texto", max: 40 }, crmLeadId: { tipo: "texto", max: 80 }
};
var CAMPOS_FOLLOWUP = {
  pacienteId: { tipo: "texto", max: 80 }, area: { tipo: "texto", max: 20 }, data: { tipo: "data" },
  feito: { tipo: "booleano" }, agendamentoData: { tipo: "data" }, criadoEm: { tipo: "data" }, feitoEm: { tipo: "data" }
};
var CAMPOS_CATEGORIA = { nome: { tipo: "texto", max: 80 }, cor: { tipo: "texto", max: 20 } };
var CAMPOS_MAQUINA = { nome: { tipo: "texto", max: 80 }, cadencia: { tipo: "texto", max: 80 },
  cor: { tipo: "texto", max: 20 }, obs: { tipo: "texto", max: 2000 } };
var CAMPOS_VINDA = { maquinaId: { tipo: "texto", max: 80 }, data: { tipo: "data" }, obs: { tipo: "texto", max: 2000 },
  criadoEm: { tipo: "data" } };

/* ---------------------------------------------------------------------
   Agregados: das linhas para a forma do navegador
   --------------------------------------------------------------------- */

function agrupar(lista, campo) {
  var m = {};
  lista.forEach(function (r) { (m[r[campo]] = m[r[campo]] || []).push(r); });
  return m;
}

function indiceDaAgenda() {
  return {
    ciclos: agrupar(lerTudo("agenda_ciclos"), "pacienteId"),
    agendamentos: agrupar(lerTudo("agenda_agendamentos"), "pacienteId"),
    condicoes: agrupar(lerTudo("agenda_condicoes"), "pacienteId"),
    maquinas: agrupar(lerTudo("agenda_pac_maquinas"), "pacienteId"),
    historico: agrupar(lerTudo("agenda_historico"), "pacienteId")
  };
}

function cicloDasLinhas(linha, agendamentos) {
  var datas = (agendamentos || []).filter(function (a) { return a.area === linha.area && a.data; })
    .sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
  var primeiro = datas[0];
  return {
    freq: Number(linha.freq) || 7, ultimo: linha.ultimo || null,
    agendamento: primeiro ? { data: primeiro.data, temFollowUp: primeiro.followUp === true } : null,
    proximos: datas.slice(1).map(function (a) { return a.data; }),
    fimPrevisto: linha.fimPrevisto || null, aRemarcar: Number(linha.aRemarcar) || 0,
    adiadaPara: linha.adiadaPara || null, naoRespondeu: Number(linha.naoRespondeu) || 0
  };
}

function pacientePublica(r, idx) {
  var ciclos = {};
  (idx.ciclos[r.id] || []).forEach(function (c) {
    if (AREAS_AGENDA.indexOf(c.area) >= 0) ciclos[c.area] = cicloDasLinhas(c, idx.agendamentos[r.id]);
  });
  return {
    id: r.id, nome: r.nome || "", categoriaId: r.categoriaId || null, obs: r.obs || "",
    criadoEm: r.criadoEm || "", arquivada: r.arquivada === true, arquivadaEm: r.arquivadaEm || null,
    whatsapp: r.whatsapp || "", origem: r.origem || "", crmLeadId: r.crmLeadId || "",
    ciclos: ciclos,
    condicoes: (idx.condicoes[r.id] || []).map(function (c) { return { id: c.id, texto: c.texto || "", inicio: c.inicio || "", fim: c.fim || "" }; }),
    maquinas: (idx.maquinas[r.id] || []).map(function (m) { return m.maquinaId; }),
    historico: (idx.historico[r.id] || []).map(function (h) {
      var item = { id: h.id, tipo: h.tipo, data: h.data || "", em: h.em || "" };
      if (h.area) item.area = h.area;
      if (h.fu) item.fu = h.fu;
      if (h.maquina) item.maquina = h.maquina;
      return item;
    }),
    _rev: Number(r.rev) || 0
  };
}

function followupPublico(f) {
  var o = { id: f.id, pacienteId: f.pacienteId, area: f.area || "facial", data: f.data || "", feito: f.feito === true,
    agendamentoData: f.agendamentoData || "", criadoEm: f.criadoEm || "", _rev: Number(f.rev) || 0 };
  if (f.feitoEm) o.feitoEm = f.feitoEm;
  return o;
}

function vindaPublica(v, respostas) {
  var resp = {};
  (respostas || []).forEach(function (r) {
    var item = { status: r.status || "", em: r.em || "" };
    if (r.adiadaPara) item.adiadaPara = r.adiadaPara;
    if (Number(r.vezes) > 0) item.vezes = Number(r.vezes);
    resp[r.pacienteId] = item;
  });
  return { id: v.id, maquinaId: v.maquinaId || "", data: v.data || "", obs: v.obs || "", criadoEm: v.criadoEm || "",
    resp: resp, _rev: Number(v.rev) || 0 };
}

function simples(campos) {
  return function (r) {
    var o = {};
    campos.forEach(function (k) { o[k] = r[k] === null || r[k] === undefined ? "" : r[k]; });
    o._rev = Number(r.rev) || 0;
    return o;
  };
}

function agendaLer(ctx) {
  return lerComConsistencia(function () {
    var idx = indiceDaAgenda();
    var cfg = acharPorChave("sis_config", "agenda.config");
    var respostas = agrupar(lerTudo("agenda_respostas"), "vindaId");
    return {
      pacientes: lerTudo("agenda_pacientes").map(function (p) { return pacientePublica(p, idx); }),
      categorias: lerTudo("agenda_categorias").map(simples(["id", "nome", "cor"])),
      followups: lerTudo("agenda_followups").map(followupPublico),
      maquinas: lerTudo("agenda_maquinas").map(simples(["id", "nome", "cadencia", "cor", "obs"])),
      vindas: lerTudo("agenda_vindas").map(function (v) { return vindaPublica(v, respostas[v.id]); }),
      criado: cfg && cfg.valor ? cfg.valor.criado || "" : "",
      seedMaq: !!(cfg && cfg.valor && cfg.valor.seedMaq),
      _revConfig: cfg ? Number(cfg.rev) || 0 : 0
    };
  });
}

function agendaAplicar(ctx) {
  return { resultados: executarOperacoes(ctx, ctx.dados.operacoes, function (op) { return planejarAgenda(ctx, op); }) };
}

function planejarAgenda(ctx, op) {
  var t = String(op.tipo || "");
  if (t === "paciente.criar") return planejarPaciente(ctx, op, true);
  if (t === "paciente.alterar") return planejarPaciente(ctx, op, false);
  if (t === "paciente.remover") return planejarMoverParaLixeira(ctx, "agenda", idValido(op.id), String(op.motivo || ""));
  if (t === "config.agenda") return planejarConfigAgenda(ctx, op);
  var partes = t.split(".");
  var simplesDef = {
    followup: { tabela: "agenda_followups", campos: CAMPOS_FOLLOWUP, publicar: followupPublico },
    categoria: { tabela: "agenda_categorias", campos: CAMPOS_CATEGORIA, publicar: simples(["id", "nome", "cor"]) },
    maquina: { tabela: "agenda_maquinas", campos: CAMPOS_MAQUINA, publicar: simples(["id", "nome", "cadencia", "cor", "obs"]) },
    vinda: { tabela: "agenda_vindas", campos: CAMPOS_VINDA, publicar: null }
  }[partes[0]];
  if (simplesDef && ["criar", "alterar", "remover"].indexOf(partes[1]) >= 0) return planejarSimples(ctx, op, simplesDef, partes[1]);
  falhar("dados_invalidos", "Operação desconhecida na Agenda: " + t + ".");
}

/* ---------------------------------------------------------------------
   Paciente
   --------------------------------------------------------------------- */

function validarCondicoes(lista) {
  if (!Array.isArray(lista) || lista.length > 100) falhar("dados_invalidos", "Lista de condições inválida.");
  return lista.map(function (c) {
    var d = function (v) { if (!v) return null; if (!dataValida(String(v))) falhar("dados_invalidos", "Data inválida na condição."); return String(v); };
    return { id: idValido(c && c.id, "condição"), texto: String(c.texto || "").slice(0, 500), inicio: d(c.inicio), fim: d(c.fim) };
  });
}

function validarMaquinasDaPaciente(lista) {
  if (!Array.isArray(lista) || lista.length > 30) falhar("dados_invalidos", "Lista de máquinas inválida.");
  var vistas = {};
  return lista.map(function (m) { return idValido(m, "máquina"); }).filter(function (m) { if (vistas[m]) return false; vistas[m] = true; return true; });
}

function validarHistoricoNovo(lista) {
  if (!Array.isArray(lista) || lista.length > 200) falhar("dados_invalidos", "Histórico inválido.");
  return lista.map(function (h) {
    if (!h || !/^[A-Za-z0-9_-]{6,80}$/.test(String(h.id || ""))) falhar("dados_invalidos", "Item de histórico sem identificador.");
    if (!/^[a-z_]{2,40}$/.test(String(h.tipo || ""))) falhar("dados_invalidos", "Tipo de histórico inválido.");
    var d = function (v) { if (!v) return null; if (!dataValida(String(v))) falhar("dados_invalidos", "Data inválida no histórico."); return String(v); };
    var area = h.area ? String(h.area) : "";
    if (area && AREAS_AGENDA.indexOf(area) < 0) falhar("dados_invalidos", "Área inválida no histórico.");
    return { id: String(h.id), tipo: String(h.tipo), area: area, data: d(h.data), em: d(h.em), fu: d(h.fu), maquina: String(h.maquina || "").slice(0, 80) };
  });
}

/* As escritas que levam os filhos de uma paciente do estado "antes" ao
   "depois". Só o que mudou: um agendamento remarcado é uma linha apagada e
   outra inserida; os outros nem são tocados. */
function escritasDosFilhos(pid, idx, depois, historicoNovos) {
  var escritas = [];
  var ciclosAntes = {};
  (idx.ciclos[pid] || []).forEach(function (c) { ciclosAntes[c.area] = c; });
  var agAntes = idx.agendamentos[pid] || [];

  AREAS_AGENDA.forEach(function (area) {
    var c = depois.ciclos[area] || null;
    var linhaAntes = ciclosAntes[area];
    if (!c) {
      if (linhaAntes) escritas.push({ t: "remover", tabela: "agenda_ciclos", chave: [pid, area] });
    } else {
      var linha = { pacienteId: pid, area: area, freq: c.freq, ultimo: c.ultimo, adiadaPara: c.adiadaPara,
        naoRespondeu: c.naoRespondeu, fimPrevisto: c.fimPrevisto, aRemarcar: c.aRemarcar };
      var igual = linhaAntes && ["freq", "ultimo", "adiadaPara", "naoRespondeu", "fimPrevisto", "aRemarcar"]
        .every(function (k) { return mesmoValor(linhaAntes[k], linha[k]); });
      if (!igual) escritas.push({ t: "gravar", tabela: "agenda_ciclos", registro: linha });
    }
    var desejadas = {};
    marcadasDoCiclo(c).forEach(function (d, i) { desejadas[d] = i === 0 && c.agendamento.temFollowUp === true; });
    var existentes = {};
    agAntes.filter(function (a) { return a.area === area; }).forEach(function (a) {
      if (existentes[a.data] || desejadas[a.data] === undefined) {
        escritas.push({ t: "remover", tabela: "agenda_agendamentos", chave: [a.id] });
        return;
      }
      existentes[a.data] = a;
      if ((a.followUp === true) !== desejadas[a.data]) {
        escritas.push({ t: "gravar", tabela: "agenda_agendamentos", registro: { id: a.id, pacienteId: pid, area: area,
          data: a.data, followUp: desejadas[a.data], criadoEm: a.criadoEm } });
      }
    });
    Object.keys(desejadas).forEach(function (d) {
      if (existentes[d]) return;
      escritas.push({ t: "inserir", tabela: "agenda_agendamentos", registro: { id: novoId("ag"), pacienteId: pid,
        area: area, data: d, followUp: desejadas[d], criadoEm: agoraISO() } });
    });
  });

  var condAntes = {};
  (idx.condicoes[pid] || []).forEach(function (c) { condAntes[c.id] = c; });
  var condDepois = {};
  depois.condicoes.forEach(function (c) {
    condDepois[c.id] = true;
    var a = condAntes[c.id];
    if (!a || a.texto !== c.texto || !mesmoValor(a.inicio, c.inicio) || !mesmoValor(a.fim, c.fim)) {
      escritas.push({ t: "gravar", tabela: "agenda_condicoes", registro: { id: c.id, pacienteId: pid, texto: c.texto, inicio: c.inicio, fim: c.fim } });
    }
  });
  Object.keys(condAntes).forEach(function (cid) { if (!condDepois[cid]) escritas.push({ t: "remover", tabela: "agenda_condicoes", chave: [cid] }); });

  var maqAntes = (idx.maquinas[pid] || []).map(function (m) { return m.maquinaId; });
  depois.maquinas.forEach(function (m) {
    if (maqAntes.indexOf(m) < 0) escritas.push({ t: "inserir", tabela: "agenda_pac_maquinas", registro: { pacienteId: pid, maquinaId: m } });
  });
  maqAntes.forEach(function (m) {
    if (depois.maquinas.indexOf(m) < 0) escritas.push({ t: "remover", tabela: "agenda_pac_maquinas", chave: [pid, m] });
  });

  var jaTem = {};
  (idx.historico[pid] || []).forEach(function (h) { jaTem[h.id] = true; });
  (historicoNovos || []).forEach(function (h) {
    if (jaTem[h.id]) return;
    jaTem[h.id] = true;
    escritas.push({ t: "inserir", tabela: "agenda_historico", registro: { id: h.id, pacienteId: pid, tipo: h.tipo,
      area: h.area, data: h.data, em: h.em, fu: h.fu, maquina: h.maquina } });
  });
  return escritas;
}

function nomesDaAgenda() {
  var cats = {}, maqs = {};
  lerTudo("agenda_categorias").forEach(function (c) { cats[c.id] = c.nome; });
  lerTudo("agenda_maquinas").forEach(function (m) { maqs[m.id] = m.nome; });
  return {
    categoria: function (id) { return vazio(id) ? "—" : (cats[id] || String(id)); },
    maquina: function (id) { return maqs[id] || String(id); }
  };
}

function planejarPaciente(ctx, op, criar) {
  var id = idValido(op.id, "paciente");
  var atual = acharPorChave("agenda_pacientes", id);
  var idx = indiceDaAgenda();
  var antes = null;

  if (criar) {
    if (atual) falhar("conflito", "Já existe uma paciente com este identificador.", { rev: atual.rev, atual: pacientePublica(atual, idx) });
    if (itensDaLixeira("agenda", id).length) falhar("na_lixeira", "Esta paciente foi para a lixeira em outro aparelho.");
  } else {
    if (!atual) falhar("conflito", "Esta paciente não está mais na Agenda.", { rev: 0, atual: null, removida: true });
    conferirRevisao(atual, op.revBase, function (r) { return pacientePublica(r, idx); });
    antes = pacientePublica(atual, idx);
  }

  var fonte = criar ? (op.dados || {}) : (op.campos || {});
  var camposEntrada = {};
  Object.keys(CAMPOS_PACIENTE).forEach(function (k) { if (fonte[k] !== undefined) camposEntrada[k] = fonte[k]; });
  var campos = validarCampos(camposEntrada, CAMPOS_PACIENTE, "paciente");

  var depois = antes ? JSON.parse(JSON.stringify(antes)) : { id: id, nome: "", categoriaId: null, obs: "",
    criadoEm: hojeNaClinica(), arquivada: false, arquivadaEm: null, whatsapp: "", origem: "", crmLeadId: "",
    ciclos: {}, condicoes: [], maquinas: [], historico: [] };
  Object.keys(campos).forEach(function (k) { depois[k] = campos[k]; });
  if (!String(depois.nome || "").trim()) falhar("dados_invalidos", "A paciente precisa de um nome.", { campo: "nome" });
  if (depois.crmLeadId && (!antes || antes.crmLeadId !== depois.crmLeadId) && !acharPorChave("crm_leads", depois.crmLeadId)) {
    falhar("dados_invalidos", "A lead vinculada não existe no CRM.", { campo: "crmLeadId" });
  }

  var ciclos = criar ? (fonte.ciclos || {}) : (op.ciclos || {});
  Object.keys(ciclos).forEach(function (area) {
    if (AREAS_AGENDA.indexOf(area) < 0) falhar("dados_invalidos", "Área desconhecida: " + area + ".");
    depois.ciclos[area] = validarCiclo(ciclos[area], area);
  });
  AREAS_AGENDA.forEach(function (a) { if (!depois.ciclos[a]) delete depois.ciclos[a]; });
  /* data que veio do Clinicorp não some por edição local (39) */
  if (typeof datasExternasProtegidas === "function") datasExternasProtegidas(ctx, id, antes, depois);

  var condicoes = criar ? fonte.condicoes : op.condicoes;
  if (condicoes !== undefined) depois.condicoes = validarCondicoes(condicoes || []);
  var maquinas = criar ? fonte.maquinas : op.maquinas;
  if (maquinas !== undefined) depois.maquinas = validarMaquinasDaPaciente(maquinas || []);
  var historicoNovos = validarHistoricoNovo((criar ? fonte.historico : op.historicoNovos) || []);
  depois.historico = depois.historico.concat(historicoNovos);

  var filhos = escritasDosFilhos(id, idx, depois, historicoNovos);
  var mudouRaiz = !antes || Object.keys(CAMPOS_PACIENTE).some(function (k) { return !mesmoValor(antes[k], depois[k]); });
  if (!filhos.length && !mudouRaiz) {
    return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0, entidade: antes } };
  }

  var eventos = eventosPaciente(antes, depois, nomesDaAgenda());
  var escritas = filhos.slice();

  /* a ponte com o CRM, na mesma operação e com o mesmo autor */
  var eco = ecoDaPacienteNoCRM(antes, depois, depois.crmLeadId ? acharPorChave("crm_leads", depois.crmLeadId) : null);
  var resultado = { id: id };
  if (eco) {
    var lead = acharPorChave("crm_leads", depois.crmLeadId);
    var novaLead = registroCompleto("crm_leads", { dataAgendada: eco.data || null }, lead);
    carimbar(novaLead, (Number(lead.rev) || 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "crm_leads", registro: novaLead });
    eventos.push(evento("crm", "lead", lead.id, "alterou", "Data do atendimento", dataBR(eco.antes), dataBR(eco.data),
      "integração Agenda → CRM · " + CONTEXTO_DO_ECO[eco.tipo]));
    resultado.crm = { leadId: lead.id, rev: novaLead.rev };
  }

  escritas = escritas.concat(escritasDeAuditoria(ctx, eventos, op.operacaoId));
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var raiz = registroCompleto("agenda_pacientes", {
    id: id, nome: depois.nome, categoriaId: depois.categoriaId || "", obs: depois.obs, criadoEm: depois.criadoEm || null,
    arquivada: depois.arquivada === true, arquivadaEm: depois.arquivadaEm || null, whatsapp: depois.whatsapp,
    origem: depois.origem, crmLeadId: depois.crmLeadId
  }, atual);
  carimbar(raiz, rev, ctx, op.operacaoId);
  escritas.push({ t: "gravar", tabela: "agenda_pacientes", registro: raiz });

  resultado.rev = rev;
  resultado.entidade = depois;
  resultado.entidade._rev = rev;
  return { escritas: escritas, resultado: resultado };
}

/* ---------------------------------------------------------------------
   Entidades simples da Agenda (follow-ups, categorias, máquinas, vindas)
   --------------------------------------------------------------------- */

function planejarSimples(ctx, op, def, verbo) {
  var id = idValido(op.id, def.tabela);
  var atual = acharPorChave(def.tabela, id);
  var publicar = def.publicar || function (r) { return vindaPublica(r, filtrar("agenda_respostas", "vindaId", r.id)); };

  if (verbo === "remover") {
    if (!atual) return { escritas: [], resultado: { id: id, removida: true } };
    conferirRevisao(atual, op.revBase, publicar);
    var esc = [];
    if (def.tabela === "agenda_vindas") {
      filtrar("agenda_respostas", "vindaId", id).forEach(function (r) {
        esc.push({ t: "remover", tabela: "agenda_respostas", chave: [id, r.pacienteId] });
      });
    }
    esc.push({ t: "remover", tabela: def.tabela, chave: [id] });
    return { escritas: esc, resultado: { id: id, removida: true } };
  }

  if (verbo === "criar" && atual) falhar("conflito", "Já existe um registro com este identificador.", { rev: atual.rev, atual: publicar(atual) });
  if (verbo === "alterar") {
    if (!atual) falhar("conflito", "Este registro não existe mais.", { rev: 0, atual: null, removida: true });
    conferirRevisao(atual, op.revBase, publicar);
  }
  var fonte = verbo === "criar" ? (op.dados || {}) : (op.campos || {});
  var entrada = {};
  Object.keys(def.campos).forEach(function (k) { if (fonte[k] !== undefined) entrada[k] = fonte[k]; });
  var campos = validarCampos(entrada, def.campos, def.tabela);
  if (campos.area && AREAS_AGENDA.indexOf(campos.area) < 0) falhar("dados_invalidos", "Área desconhecida.");

  var valores = { id: id };
  Object.keys(campos).forEach(function (k) { valores[k] = campos[k]; });
  var reg = registroCompleto(def.tabela, valores, atual);
  var escritas = [];

  if (def.tabela === "agenda_vindas") {
    var resp = verbo === "criar" ? fonte.resp : op.resp;
    if (resp !== undefined) escritas = escritas.concat(escritasDasRespostas(id, resp || {}, atual ? filtrar("agenda_respostas", "vindaId", id) : []));
  }
  var mudou = !atual || Object.keys(campos).some(function (k) { return !mesmoValor(atual[k], campos[k]); });
  if (!mudou && !escritas.length) return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0 } };
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  carimbar(reg, rev, ctx, op.operacaoId);
  escritas.push({ t: "gravar", tabela: def.tabela, registro: reg });
  return { escritas: escritas, resultado: { id: id, rev: rev } };
}

function escritasDasRespostas(vindaId, resp, antes) {
  if (typeof resp !== "object" || Array.isArray(resp)) falhar("dados_invalidos", "Respostas inválidas.");
  var esc = [], vistos = {};
  var porPaciente = {};
  antes.forEach(function (r) { porPaciente[r.pacienteId] = r; });
  Object.keys(resp).forEach(function (pid) {
    idValido(pid, "resposta");
    var r = resp[pid] || {};
    var d = function (v) { if (!v) return null; if (!dataValida(String(v))) falhar("dados_invalidos", "Data inválida na resposta."); return String(v); };
    var linha = { vindaId: vindaId, pacienteId: pid, status: String(r.status || "").slice(0, 30), em: d(r.em),
      adiadaPara: d(r.adiadaPara), vezes: Number(r.vezes) > 0 ? Math.round(Number(r.vezes)) : null };
    vistos[pid] = true;
    var a = porPaciente[pid];
    if (!a || a.status !== linha.status || !mesmoValor(a.em, linha.em) || !mesmoValor(a.adiadaPara, linha.adiadaPara) || !mesmoValor(a.vezes, linha.vezes)) {
      esc.push({ t: "gravar", tabela: "agenda_respostas", registro: linha });
    }
  });
  antes.forEach(function (r) { if (!vistos[r.pacienteId]) esc.push({ t: "remover", tabela: "agenda_respostas", chave: [vindaId, r.pacienteId] }); });
  return esc;
}

function planejarConfigAgenda(ctx, op) {
  var atual = acharPorChave("sis_config", "agenda.config");
  var rev = atual ? Number(atual.rev) || 0 : 0;
  var valorAtual = (atual && atual.valor) || {};
  if (Number(op.revBase || 0) !== rev) falhar("conflito", "A configuração da Agenda mudou.", { rev: rev, atual: valorAtual });
  var novo = {
    criado: dataValida(String(op.criado || "")) ? String(op.criado) : (valorAtual.criado || ""),
    seedMaq: !!op.seedMaq || !!valorAtual.seedMaq
  };
  if (canonico(novo) === canonico(valorAtual)) return { escritas: [], resultado: { rev: rev } };
  return { escritas: [{ t: "gravar", tabela: "sis_config", registro: carimbar({ chave: "agenda.config", valor: novo }, rev + 1, ctx, op.operacaoId) }],
    resultado: { rev: rev + 1 } };
}

/* ---------------------------------------------------------------------
   CRM → Agenda: crm.agendarNaAgenda (exige as duas permissões)
   ---------------------------------------------------------------------
   Uma operação, dois agregados: a lead e a paciente contam a mesma
   história com o mesmo operacaoId. Vínculo só explícito — nunca por nome. */

function pacientesParecidas(pacientes, nome, whatsapp) {
  var zap = soDigitos(whatsapp), chave = chaveDeNome(nome), achados = [];
  pacientes.forEach(function (p) {
    if (String(p.crmLeadId || "")) return;
    var zapP = soDigitos(p.whatsapp);
    var forte = zap && zapP && zapP === zap;
    var fraco = chave && chaveDeNome(p.nome) === chave;
    if (!forte && !fraco) return;
    achados.push({ id: p.id, nome: p.nome, whatsapp: p.whatsapp || "", arquivada: p.arquivada === true,
      forca: forte ? "forte" : "fraca", motivo: forte ? "mesmo WhatsApp" : "mesmo nome" });
  });
  return achados.sort(function (a, b) { return a.forca === b.forca ? 0 : a.forca === "forte" ? -1 : 1; });
}

function crmAgendarNaAgenda(ctx) {
  var d = ctx.dados;
  var op = { operacaoId: String(d.operacaoId || ""), tipo: "crm.agendarNaAgenda", leadId: String(d.leadId || ""),
    area: String(d.area || ""), data: String(d.data || ""), freq: Number(d.freq) || 0,
    confirmarPacienteId: String(d.confirmarPacienteId || ""), criarMesmoAssim: !!d.criarMesmoAssim,
    atualizarData: !!d.atualizarData, dataAnterior: String(d.dataAnterior || "") };
  var r = executarOperacao(ctx, op, function (o) { return planejarAgendarNaAgenda(ctx, o); });
  delete r.operacaoId;
  return r;
}

function planejarAgendarNaAgenda(ctx, op) {
  var leadId = idValido(op.leadId, "lead");
  var lead = acharPorChave("crm_leads", leadId);
  if (!lead) falhar("nao_encontrado", "A lead não está mais no CRM.");
  var idx = indiceDaAgenda();
  var linhasPac = lerTudo("agenda_pacientes");
  var area = AREAS_AGENDA.indexOf(op.area) >= 0 ? op.area : "facial";
  var dataSessao = dataValida(op.data) ? op.data : "";
  var freq = intervaloValido(Math.round(op.freq)) ? Math.round(op.freq) : FREQ_PADRAO_AGENDA;
  var hoje = hojeNaClinica();

  var vinculada = linhasPac.filter(function (p) { return String(p.crmLeadId || "") === leadId; })[0] || null;
  var remarcar = !!(vinculada && op.atualizarData && dataSessao);
  if (vinculada && !op.confirmarPacienteId && !remarcar) {
    return { escritas: [], resultado: { jaVinculada: true, pacienteId: vinculada.id, pacienteNome: vinculada.nome } };
  }

  var linha = vinculada, criou = false, vinculou = false, antes = null, depois;
  if (!linha && op.confirmarPacienteId) {
    linha = acharPorChave("agenda_pacientes", op.confirmarPacienteId);
    if (!linha) falhar("nao_encontrado", "A paciente escolhida não existe mais.");
    if (linha.crmLeadId && linha.crmLeadId !== leadId) falhar("dados_invalidos", "Esta paciente já está vinculada a outra lead.");
    vinculou = true;
  }
  if (linha) {
    antes = pacientePublica(linha, idx);
    depois = JSON.parse(JSON.stringify(antes));
    if (vinculou) {
      depois.crmLeadId = leadId;
      if (vazio(depois.whatsapp) && !vazio(lead.whatsapp)) depois.whatsapp = lead.whatsapp;
      if (vazio(depois.origem) && !vazio(lead.origem)) depois.origem = lead.origem;
    }
  } else {
    var parecidas = pacientesParecidas(linhasPac, lead.nome, lead.whatsapp);
    if (parecidas.length && !op.criarMesmoAssim) return { escritas: [], resultado: { precisaDecidir: true, parecidas: parecidas } };
    depois = { id: novoId("p"), nome: lead.nome, categoriaId: null, obs: "", criadoEm: hoje, arquivada: false, arquivadaEm: null,
      whatsapp: lead.whatsapp || "", origem: lead.origem || "", crmLeadId: leadId, ciclos: {}, condicoes: [], maquinas: [], historico: [] };
    criou = true;
  }

  var areaAlvo = area;
  var anterior = dataValida(op.dataAnterior) ? op.dataAnterior : "";
  if (remarcar) {
    var comData = function (dt) {
      return AREAS_AGENDA.filter(function (k) { var c = depois.ciclos[k]; return c && c.agendamento && c.agendamento.data === dt; })[0];
    };
    areaAlvo = (anterior && comData(anterior)) || comData(dataSessao) || area;
  }

  var ciclo = depois.ciclos[areaAlvo];
  var dataAntes = ciclo && ciclo.agendamento ? ciclo.agendamento.data : "";
  var agendou = false;
  var historicoNovos = [];
  if (ciclo) {
    if (!remarcar) ciclo.freq = freq;
    if (dataSessao && dataSessao !== dataAntes) {
      ciclo.agendamento = { data: dataSessao, temFollowUp: false };
      ciclo.adiadaPara = null; ciclo.naoRespondeu = 0;
      arrumarSerieAgenda(ciclo);
      agendou = true;
    }
  } else {
    depois.ciclos[areaAlvo] = arrumarSerieAgenda({ freq: freq, ultimo: null,
      agendamento: dataSessao ? { data: dataSessao, temFollowUp: false } : null, proximos: [], fimPrevisto: null,
      aRemarcar: 0, adiadaPara: null, naoRespondeu: 0 });
    agendou = !!dataSessao;
  }
  if (agendou) historicoNovos.push({ id: novoId("h"), tipo: dataAntes ? "reagendou" : "agendou", area: areaAlvo, data: dataSessao, em: hoje, fu: null, maquina: "" });
  depois.historico = depois.historico.concat(historicoNovos);

  /* o lado do CRM: Agendado sem dia não existe; marcos são o dia do clique */
  var leadDepois = leadDoRegistro(lead);
  var mudancas = [];
  var mudar = function (campo, rotulo, valor, mostrar) {
    if (mesmoValor(leadDepois[campo], valor)) return;
    mudancas.push(evento("crm", "lead", leadId, "alterou", rotulo, vazio(leadDepois[campo]) ? "—" : mostrar(leadDepois[campo]), vazio(valor) ? "—" : mostrar(valor)));
    leadDepois[campo] = valor;
  };
  if (dataSessao && leadDepois.etapa !== "agendado" && (NIVEL_ETAPA_CRM[leadDepois.etapa] || 0) < 2) {
    mudar("etapa", "Etapa do funil", "agendado", nomeEtapa);
    mudar("cadencia", "Cadência", "", function (v) { return CADENCIAS_CRM[v] || v; });
  }
  if ((NIVEL_ETAPA_CRM[leadDepois.etapa] || 0) >= 2) {
    if (vazio(leadDepois.dtConversa)) mudar("dtConversa", "1ª conversa", hoje, dataBR);
    if (vazio(leadDepois.dtAgendamento)) mudar("dtAgendamento", "Agendou em", hoje, dataBR);
  }
  if (dataSessao && leadDepois.etapa === "agendado") mudar("dataAgendada", "Data do atendimento", dataSessao, dataBR);

  var mudouAgenda = criou || vinculou || agendou || !ciclo;
  if (!mudouAgenda && !mudancas.length) {
    return { escritas: [], resultado: { jaVinculada: !!vinculada, agendou: false, jaEstava: true,
      pacienteId: depois.id, pacienteNome: depois.nome, data: dataSessao } };
  }

  var escritas = [];
  var contexto = !remarcar ? "integração CRM → Agenda" : dataAntes ? "remarcado pelo CRM" : "agendado pelo CRM";
  var nomeArea = AREAS_NOME[areaAlvo], detalhe = nomeArea + (dataSessao ? " · " + dataBR(dataSessao) : "");
  var eventos = [];
  var resultado = { criado: criou, vinculado: vinculou || criou, jaVinculada: remarcar, agendou: agendou,
    data: dataSessao, area: areaAlvo, pacienteId: depois.id, pacienteNome: depois.nome };

  if (mudouAgenda) {
    var pid = depois.id;
    escritas = escritas.concat(escritasDosFilhos(pid, idx, depois, historicoNovos));
    if (agendou && dataAntes) {
      lerTudo("agenda_followups").forEach(function (f) {
        if (f.pacienteId === pid && f.area === areaAlvo && f.feito !== true && f.agendamentoData === dataAntes) {
          escritas.push({ t: "remover", tabela: "agenda_followups", chave: [f.id] });
        }
      });
    }
  }
  if (remarcar) {
    if (agendou) {
      eventos.push(evento("crm", "lead", leadId, "agendou", "Agendamento na Agenda", dataAntes ? dataBR(dataAntes) : "—", dataBR(dataSessao), nomeArea));
      eventos.push(evento("agenda", "paciente", depois.id, "agendou", "Agendamento " + nomeArea, dataAntes ? dataBR(dataAntes) : "—", dataBR(dataSessao), contexto));
    }
  } else {
    eventos.push(evento("crm", "lead", leadId, criou ? "integrou" : "vinculou", "Paciente na Agenda", "", depois.nome, detalhe));
    eventos.push(evento("agenda", "paciente", depois.id, criou ? "criou_do_crm" : "vinculou", "Lead no CRM", "", lead.nome, detalhe));
  }
  mudancas.forEach(function (m) { m.contexto = contexto; eventos.push(m); });

  if (mudancas.length) {
    var novaLead = registroCompleto("crm_leads", leadDepois, lead);
    carimbar(novaLead, (Number(lead.rev) || 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "crm_leads", registro: novaLead });
    resultado.lead = leadPublica(novaLead);
  }
  escritas = escritas.concat(escritasDeAuditoria(ctx, eventos, op.operacaoId));
  if (mudouAgenda) {
    var raizAntes = linha;
    var raiz = registroCompleto("agenda_pacientes", { id: depois.id, nome: depois.nome, categoriaId: depois.categoriaId || "",
      obs: depois.obs, criadoEm: depois.criadoEm, arquivada: depois.arquivada === true, arquivadaEm: depois.arquivadaEm || null,
      whatsapp: depois.whatsapp, origem: depois.origem, crmLeadId: depois.crmLeadId }, raizAntes);
    carimbar(raiz, (raizAntes ? Number(raizAntes.rev) || 0 : 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "agenda_pacientes", registro: raiz });
    resultado.pacienteRev = raiz.rev;
  }
  return { escritas: escritas, resultado: resultado };
}
