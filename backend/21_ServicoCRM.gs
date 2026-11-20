/* =====================================================================
   21_ServicoCRM — leitura e operações do CRM
   ---------------------------------------------------------------------
   crm.ler      leads, intervalos das cadências e contatos dos últimos 62 dias
   crm.aplicar  operações, cada uma sobre UMA entidade:
       lead.criar        { id, dados, contatos? }
       lead.alterar      { id, revBase, campos, contatos? }   só os campos mudados
       lead.remover      { id, motivo? }                      vai para a lixeira
       contato.registrar { dados: { id, leadId, data, criadoEm } }
       config.cadencias  { revBase, dias }

   "contatos" dentro da operação da lead é o caso de "Contatei": o evento e
   o último contato da ficha sobem juntos, na mesma operação.

   Contatos só crescem: o servidor acrescenta ids que não conhece, nunca
   apaga, e carimba o autor pela sessão. Não entram na auditoria da ficha.
   ===================================================================== */

var RE_ID = /^[A-Za-z0-9_.-]{1,80}$/;

function idValido(id, onde) {
  var s = String(id === undefined || id === null ? "" : id);
  if (!RE_ID.test(s)) falhar("dados_invalidos", "Identificador inválido" + (onde ? " em " + onde : "") + ".");
  return s;
}

function leadPublica(r) {
  var o = {};
  camposDeNegocio("crm_leads").forEach(function (k) { o[k] = r[k] === null || r[k] === undefined ? "" : r[k]; });
  o.exCliente = r.exCliente === true;
  o._rev = Number(r.rev) || 0;
  return o;
}

function leadDoRegistro(r) {
  var o = {};
  camposDeNegocio("crm_leads").forEach(function (k) { o[k] = r[k]; });
  return o;
}

function crmLer(ctx) {
  return lerComConsistencia(function () {
    var cfg = acharPorChave("sis_config", "crm.cadencias");
    var corte = Utilities.formatDate(new Date(Date.now() - DIAS_CONTATOS_NA_TELA * 86400000), fusoDaClinica(), "yyyy-MM-dd");
    return {
      leads: lerTudo("crm_leads").map(leadPublica),
      dias: (cfg && cfg.valor) || CADENCIAS_PADRAO_DIAS,
      _revDias: cfg ? Number(cfg.rev) || 0 : 0,
      contatos: lerTudo("crm_contatos").filter(function (c) { return c.data && c.data >= corte; })
        .map(function (c) { return { id: c.id, leadId: c.leadId, data: c.data, criadoEm: c.criadoEm || "" }; })
    };
  });
}

function crmAplicar(ctx) {
  return { resultados: executarOperacoes(ctx, ctx.dados.operacoes, function (op) { return planejarCRM(ctx, op); }) };
}

function planejarCRM(ctx, op) {
  switch (op.tipo) {
    case "lead.criar": return planejarCriarLead(ctx, op);
    case "lead.alterar": return planejarAlterarLead(ctx, op);
    case "lead.remover": return planejarMoverParaLixeira(ctx, "crm", idValido(op.id), String(op.motivo || ""));
    case "contato.registrar": return planejarContato(ctx, op.dados || {}, op.operacaoId, true);
    case "config.cadencias": return planejarCadencias(ctx, op);
  }
  falhar("dados_invalidos", "Operação desconhecida no CRM: " + op.tipo + ".");
}

function planejarCriarLead(ctx, op) {
  var id = idValido(op.id, "lead");
  var existente = acharPorChave("crm_leads", id);
  if (existente) falhar("conflito", "Já existe uma lead com este identificador.", { rev: existente.rev, atual: leadPublica(existente) });
  if (itensDaLixeira("crm", id).length) falhar("na_lixeira", "Esta lead foi para a lixeira em outro aparelho.");
  var hoje = hojeNaClinica();
  var dados = validarCampos(op.dados || {}, CAMPOS_LEAD, "lead");
  if (!dados.criadoEm) dados.criadoEm = hoje;
  if (dados.exCliente === undefined) dados.exCliente = false;
  var lead = conferirLeadCRM(null, dados, hoje);
  lead.id = id;
  var reg = carimbar(registroCompleto("crm_leads", lead), 1, ctx, op.operacaoId);
  var escritas = escritasDeContatos(ctx, op.contatos, id, op.operacaoId)
    .concat([{ t: "gravar", tabela: "crm_leads", registro: reg }])
    .concat(escritasDeAuditoria(ctx, eventosLead(null, lead), op.operacaoId));
  return { escritas: escritas, resultado: { id: id, rev: 1, entidade: leadPublica(reg) } };
}

function planejarAlterarLead(ctx, op) {
  var id = idValido(op.id, "lead");
  var atual = acharPorChave("crm_leads", id);
  if (!atual) falhar("conflito", "Esta lead não está mais no CRM.", { rev: 0, atual: null, removida: true });
  conferirRevisao(atual, op.revBase, leadPublica);
  var campos = validarCampos(op.campos || {}, CAMPOS_LEAD, "lead");
  var antes = leadDoRegistro(atual);
  var depois = {};
  Object.keys(antes).forEach(function (k) { depois[k] = antes[k]; });
  Object.keys(campos).forEach(function (k) { depois[k] = campos[k]; });
  depois = conferirLeadCRM(antes, depois, hojeNaClinica());
  depois.id = id;

  var contatos = escritasDeContatos(ctx, op.contatos, id, op.operacaoId);
  var eventos = eventosLead(antes, depois);
  var mudou = camposDeNegocio("crm_leads").some(function (k) { return !mesmoValor(antes[k], depois[k]); });
  if (!mudou && !contatos.length) return { escritas: [], resultado: { id: id, rev: atual.rev, entidade: leadPublica(atual) } };

  var rev = (Number(atual.rev) || 0) + (mudou ? 1 : 0);
  var reg = registroCompleto("crm_leads", depois, atual);
  if (mudou) carimbar(reg, rev, ctx, op.operacaoId);
  var escritas = contatos;
  if (mudou) escritas = escritas.concat([{ t: "gravar", tabela: "crm_leads", registro: reg }]);
  escritas = escritas.concat(escritasDeAuditoria(ctx, eventos, op.operacaoId));
  return { escritas: escritas, resultado: { id: id, rev: rev, entidade: leadPublica(reg) } };
}

/* Uma lista de eventos de contato para gravar, sem repetir os que já
   existem. Fora do formato ou acima do teto: recusado. */
function escritasDeContatos(ctx, lista, leadId, opId) {
  if (!Array.isArray(lista) || !lista.length) return [];
  if (lista.length > 50) falhar("dados_invalidos", "Contatos demais numa operação.");
  var saida = [];
  lista.forEach(function (c) {
    var p = planejarContato(ctx, c, opId, false, leadId);
    saida = saida.concat(p.escritas);
  });
  return saida;
}

function planejarContato(ctx, c, opId, sozinho, leadIdDaLead) {
  var id = String(c && c.id || "");
  var leadId = String(c && c.leadId || leadIdDaLead || "");
  var data = String(c && c.data || "");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || !leadId || leadId.length > 80 || !dataValida(data)) {
    falhar("dados_invalidos", "Contato fora do formato.");
  }
  if (leadIdDaLead && leadId !== leadIdDaLead) falhar("dados_invalidos", "Contato de outra lead dentro da operação.");
  if (linhasCom("crm_contatos", "id", id).length) return { escritas: [], resultado: { id: id, jaExistia: true } };
  var quem = assinaturaDe(ctx.auth);
  var criado = c.criadoEm ? new Date(c.criadoEm) : new Date();
  return {
    escritas: [{ t: "inserir", tabela: "crm_contatos", registro: {
      id: id, leadId: leadId, data: data, criadoEm: isNaN(criado.getTime()) ? agoraISO() : criado.toISOString(),
      autorTipo: quem.tipo, autorId: quem.id, autorNome: quem.nome, opId: opId } }],
    resultado: { id: id }
  };
}

function planejarCadencias(ctx, op) {
  var dias = op.dias || {};
  var limpo = {};
  Object.keys(CADENCIAS_CRM).forEach(function (k) {
    var n = Number(dias[k]);
    limpo[k] = Number.isInteger(n) && n >= 1 && n <= 365 ? n : CADENCIAS_PADRAO_DIAS[k];
  });
  var atual = acharPorChave("sis_config", "crm.cadencias");
  var rev = atual ? Number(atual.rev) || 0 : 0;
  if (Number(op.revBase || 0) !== rev) {
    falhar("conflito", "Os intervalos mudaram em outro aparelho.", { rev: rev, atual: atual ? atual.valor : CADENCIAS_PADRAO_DIAS });
  }
  if (atual && canonico(atual.valor) === canonico(limpo)) return { escritas: [], resultado: { rev: rev, dias: limpo } };
  var reg = carimbar({ chave: "crm.cadencias", valor: limpo }, rev + 1, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "sis_config", registro: reg }], resultado: { rev: rev + 1, dias: limpo } };
}

/* O registro inteiro de uma tabela a partir dos campos de negócio,
   preservando o que o registro atual tinha (técnicos, legado, extras). */
function registroCompleto(nomeTabela, valores, atual) {
  var reg = {};
  definicaoTabela(nomeTabela).campos.forEach(function (c) {
    if (valores[c.n] !== undefined) reg[c.n] = valores[c.n];
    else if (atual && atual[c.n] !== undefined) reg[c.n] = atual[c.n];
    else reg[c.n] = null;
  });
  if (atual && atual._extras) reg._extras = atual._extras;
  return reg;
}
