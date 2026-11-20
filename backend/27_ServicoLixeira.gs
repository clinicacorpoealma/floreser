/* =====================================================================
   27_ServicoLixeira — excluir sem apagar, e o caminho de volta
   ---------------------------------------------------------------------
   O registro sai das abas do módulo e vai inteiro para sis_lixeira, junto
   com o que depende dele: os ciclos, agendamentos, condições, histórico e
   follow-ups de uma paciente; os pagamentos de uma entrada. Os contatos de
   uma lead ficam — não guardam nome, telefone nem valor, e a contagem do
   dia continua honesta.

   Mover é de quem pode mexer no módulo (Entradas: só administrador).
   Listar, restaurar, apagar de vez e limpar os vencidos: painel.
   ===================================================================== */

var FILHOS_NA_LIXEIRA = {
  crm: { raiz: "crm_leads", entidade: "lead", filhos: [] },
  agenda: { raiz: "agenda_pacientes", entidade: "paciente", filhos: [
    { tabela: "agenda_ciclos", campo: "pacienteId" }, { tabela: "agenda_agendamentos", campo: "pacienteId" },
    { tabela: "agenda_condicoes", campo: "pacienteId" }, { tabela: "agenda_pac_maquinas", campo: "pacienteId" },
    { tabela: "agenda_historico", campo: "pacienteId" }, { tabela: "agenda_followups", campo: "pacienteId" },
    { tabela: "agenda_respostas", campo: "pacienteId" }] },
  entradas: { raiz: "ent_entradas", entidade: "entrada", filhos: [{ tabela: "ent_pagamentos", campo: "entradaId" }] }
};

function itensDaLixeira(tipo, registroId) {
  return lerTudo("sis_lixeira").filter(function (i) { return i.tipo === tipo && i.registroId === String(registroId); });
}

function descreverParaLixeira(tipo, raiz, filhos) {
  if (tipo === "crm") return { titulo: raiz.nome || "(sem nome)", descricao: "Lead · CRM" + (raiz.whatsapp ? " · " + raiz.whatsapp : "") };
  if (tipo === "agenda") return { titulo: raiz.nome || "(sem nome)", descricao: "Paciente · Agenda" };
  var pags = (filhos.ent_pagamentos || []);
  var total = pags.reduce(function (s, p) { return s + (Number(p.valor) || 0); }, 0);
  return { titulo: raiz.nome || "(sem nome)", descricao: "Entrada · " + (raiz.data || "sem data") + " · R$ " + centavosParaTexto(total) };
}

function planejarMoverParaLixeira(ctx, tipo, id, motivo) {
  var def = FILHOS_NA_LIXEIRA[tipo];
  if (!def) falhar("dados_invalidos", "Tipo desconhecido para a lixeira.");
  var raiz = acharPorChave(def.raiz, id);
  if (!raiz) {
    return { escritas: [], resultado: itensDaLixeira(tipo, id).length ? { id: id, jaEstava: true } : { id: id, naoEncontrado: true } };
  }
  var escritas = [], filhos = {}, relacionados = 0;
  def.filhos.forEach(function (f) {
    var linhas = filtrar(f.tabela, f.campo, id);
    filhos[f.tabela] = linhas.map(copiaLimpa);
    relacionados += linhas.length;
    var tdef = definicaoTabela(f.tabela);
    linhas.forEach(function (r) { escritas.push({ t: "remover", tabela: f.tabela, chave: tdef.chave.map(function (k) { return r[k]; }) }); });
  });
  escritas.push({ t: "remover", tabela: def.raiz, chave: [id] });
  var quem = assinaturaDe(ctx.auth);
  var desc = descreverParaLixeira(tipo, raiz, filhos);
  escritas.push({ t: "inserir", tabela: "sis_lixeira", registro: {
    id: novoId("lx"), tipo: tipo, registroId: id, titulo: desc.titulo, descricao: desc.descricao,
    dados: { versao: 2, raiz: copiaLimpa(raiz), filhos: filhos }, excluidoEm: agoraISO(),
    excluidoPor: quem.nome, excluidoPorId: quem.id, motivo: String(motivo || "").slice(0, 120) } });
  escritas = escritas.concat(escritasDeAuditoria(ctx,
    [evento(tipo, def.entidade, id, "lixeira", "", "", "", String(motivo || ""))], ctx.operacaoAtual || ""));
  registrarTecnico("SECURITY", "REGISTRO_MOVIDO_LIXEIRA", tipo + " · " + id);
  return { escritas: escritas, resultado: { id: id, removida: true, relacionados: relacionados } };
}

function lixeiraMover(ctx) {
  var d = ctx.dados;
  var tipo = String(d.tipo || "");
  if (tipo === "entradas" && !eAdministrador(ctx.auth)) {
    registrarTecnico("SECURITY", "EXCLUSAO_NEGADA", assinaturaDe(ctx.auth).nome + " tentou mover uma entrada para a lixeira sem ser administrador.");
    falhar("sem_permissao", "Só administradores podem excluir entradas.");
  }
  var op = { operacaoId: String(d.operacaoId || ""), tipo: "lixeira.mover", alvo: tipo, id: String(d.id || ""), motivo: String(d.motivo || "") };
  ctx.operacaoAtual = op.operacaoId;
  var r = executarOperacao(ctx, op, function (o) { return planejarMoverParaLixeira(ctx, o.alvo, idValido(o.id), o.motivo); });
  delete r.operacaoId;
  return r;
}

/* "Existe algo parecido com isto na lixeira?" — nome, motivo e prazo;
   nunca o cadastro guardado. */
function lixeiraRepetido(ctx) {
  var d = ctx.dados, tipo = String(d.tipo || "");
  var zap = soDigitos(d.whatsapp), nome = chaveDeNome(d.nome);
  if (!zap && !nome) return { achados: [] };
  var prazo = DIAS_LIXEIRA * 86400000, agora = Date.now(), achados = [];
  lerTudo("sis_lixeira").forEach(function (i) {
    if (i.tipo !== tipo) return;
    var zapDoItem = tipo === "crm" ? soDigitos(i.descricao) : "";
    var forte = zap && zapDoItem && zapDoItem === zap;
    var fraco = nome && chaveDeNome(i.titulo) === nome;
    if (!forte && !fraco) return;
    var restam = Math.ceil((new Date(i.excluidoEm).getTime() + prazo - agora) / 86400000);
    if (restam <= 0) return;
    achados.push({ titulo: i.titulo, forca: forte ? "forte" : "fraca", motivo: forte ? "mesmo WhatsApp" : "mesmo nome", diasRestantes: restam });
  });
  return { achados: achados };
}

/* ---------------------------------------------------------------------
   Painel
   --------------------------------------------------------------------- */

function lixeiraListar() {
  var agora = Date.now(), prazo = DIAS_LIXEIRA * 86400000;
  var itens = lerTudo("sis_lixeira").map(function (i) {
    var quando = new Date(i.excluidoEm).getTime() || 0;
    var restam = Math.ceil((quando + prazo - agora) / 86400000);
    return { id: i.id, tipo: i.tipo, registroId: i.registroId, titulo: i.titulo, descricao: i.descricao,
      excluidoEm: quando, excluidoPor: i.excluidoPor, motivo: i.motivo, diasRestantes: restam, expirado: restam <= 0 };
  });
  itens.sort(function (a, b) { return b.excluidoEm - a.excluidoEm; });
  return { itens: itens, dias: DIAS_LIXEIRA };
}

function conflitoAoRestaurar(item, dados) {
  var raiz = dados.raiz || {};
  if (item.tipo === "crm") {
    var leads = lerTudo("crm_leads");
    if (leads.some(function (l) { return l.id === item.registroId; })) return "Já existe um lead ativo com esse mesmo cadastro.";
    var zap = soDigitos(raiz.whatsapp);
    if (zap && leads.some(function (l) { return soDigitos(l.whatsapp) === zap; })) return "Já existe um lead ativo com esse mesmo WhatsApp.";
    return "";
  }
  if (item.tipo === "agenda") {
    var pacs = lerTudo("agenda_pacientes");
    if (pacs.some(function (p) { return p.id === item.registroId; })) return "Já existe uma paciente ativa com esse mesmo cadastro.";
    var nome = chaveDeNome(raiz.nome);
    if (nome && pacs.some(function (p) { return chaveDeNome(p.nome) === nome; })) return "Já existe uma paciente ativa com esse mesmo nome.";
    return "";
  }
  return acharPorChave("ent_entradas", item.registroId) ? "Já existe uma entrada ativa com esse mesmo cadastro." : "";
}

function lixeiraRestaurar(ctx) {
  var d = ctx.dados;
  var op = { operacaoId: String(d.operacaoId || novoId("op")), tipo: "lixeira.restaurar", id: String(d.id || ""), forcar: !!d.forcar };
  executarOperacao(ctx, op, function (o) {
    var item = acharPorChave("sis_lixeira", o.id);
    if (!item) falhar("nao_encontrado", "Este item não está mais na lixeira.");
    var dados = item.dados;
    if (!dados || dados.versao !== 2 || !dados.raiz) falhar("dados_invalidos", "O conteúdo guardado deste item não pôde ser lido.");
    var conflito = conflitoAoRestaurar(item, dados);
    if (conflito && !o.forcar) falhar("conflito", conflito, { restauracao: true });
    var def = FILHOS_NA_LIXEIRA[item.tipo];
    var escritas = [];
    def.filhos.forEach(function (f) {
      ((dados.filhos || {})[f.tabela] || []).forEach(function (r) { escritas.push({ t: "inserir", tabela: f.tabela, registro: r }); });
    });
    var raiz = registroCompleto(def.raiz, dados.raiz, null);
    carimbar(raiz, (Number(dados.raiz.rev) || 0) + 1, ctx, o.operacaoId);
    escritas.push({ t: "gravar", tabela: def.raiz, registro: raiz });
    escritas.push({ t: "remover", tabela: "sis_lixeira", chave: [item.id] });
    escritas = escritas.concat(escritasDeAuditoria(ctx, [evento(item.tipo, def.entidade, item.registroId, "restaurou", "", "", "",
      "restaurado pelo painel de manutenção")], o.operacaoId));
    registrarTecnico("SECURITY", "REGISTRO_RESTAURADO", item.tipo + " · " + item.registroId);
    return { escritas: escritas, resultado: { restaurado: item.registroId } };
  });
  return { lixeira: lixeiraListar().itens };
}

function lixeiraExcluir(ctx) {
  var d = ctx.dados;
  if (!d.confirmar) falhar("sem_confirmacao", "Confirme a exclusão definitiva.");
  comTrava(function () {
    var item = acharPorChave("sis_lixeira", String(d.id || ""));
    if (!item) falhar("nao_encontrado", "Este item não está mais na lixeira.");
    remover("sis_lixeira", [item]);
    /* a ficha detalhada sai junto: senão nome, telefone e valores
       continuariam vivos, só que escondidos */
    var n = apagarAuditoriaDaEntidade(item.tipo, item.registroId);
    registrarTecnico("SECURITY", "REGISTRO_EXCLUIDO_DEFINITIVAMENTE", item.tipo + " · " + item.registroId + " · " + n + " evento(s) de auditoria removidos.");
  });
  return { lixeira: lixeiraListar().itens };
}

function lixeiraLimpar(ctx) {
  var agora = Date.now(), prazo = DIAS_LIXEIRA * 86400000;
  var vencidos = function () {
    return lerTudo("sis_lixeira").filter(function (i) { return (new Date(i.excluidoEm).getTime() || 0) + prazo <= agora; });
  };
  var contas = { crm: 0, agenda: 0, entradas: 0 };
  var lista = vencidos();
  lista.forEach(function (i) { if (contas[i.tipo] !== undefined) contas[i.tipo]++; });
  if (!ctx.dados.confirmar) return { previa: true, quantos: lista.length, contas: contas };
  comTrava(function () {
    var agoraLista = vencidos();
    if (agoraLista.length) remover("sis_lixeira", agoraLista);
    registrarTecnico("SECURITY", "LIXEIRA_EXPIRADOS_LIMPOS", agoraLista.length + " registro(s) vencido(s) apagados de vez.");
  });
  return { quantos: lista.length, contas: contas, lixeira: lixeiraListar().itens };
}
