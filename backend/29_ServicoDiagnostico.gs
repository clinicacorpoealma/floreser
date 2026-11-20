/* =====================================================================
   29_ServicoDiagnostico — log técnico, telemetria e painel
   ---------------------------------------------------------------------
   sis_logs é de quem conserta o sistema: erro, rede, sessão, segurança.
   Nada de senha, token ou dado de paciente; mensagens curtas, com o
   pedidoId quando houver, para cruzar com o que o navegador anotou.

   Registrar NUNCA disputa a trava com uma gravação por muito tempo: sem
   trava em 2 segundos, a linha vai só para o console do Apps Script.
   ===================================================================== */

var NIVEIS_LOG = ["INFO", "WARNING", "ERROR", "SECURITY"];
var LIMITE_LOGS = 3000;
var LIMITE_VISITAS = 500;
var LIMITE_POR_ENVIO = 25;

function registrarTecnico(nivel, eventoNome, mensagem, pedidoId) {
  var linha = { id: novoId("lg").slice(0, 14), quando: agoraISO(), nivel: NIVEIS_LOG.indexOf(nivel) >= 0 ? nivel : "INFO",
    evento: String(eventoNome || "").slice(0, 40), pagina: "servidor", mensagem: String(mensagem || "").slice(0, 400),
    versao: VERSAO_PRODUTO, sessao: "", pedidoId: String(pedidoId || "") };
  try {
    if (_NA_TRAVA) { inserir("sis_logs", [linha]); return; }
    var trava = LockService.getScriptLock();
    if (!trava.tryLock(2000)) { console.log("log sem trava: " + JSON.stringify(linha)); return; }
    try { inserir("sis_logs", [linha]); SpreadsheetApp.flush(); } finally { trava.releaseLock(); }
  } catch (e) {
    console.log("log não gravado (" + e + "): " + JSON.stringify(linha));
  }
}

/* Escrita aberta (qualquer página precisa registrar, inclusive antes de
   alguém entrar) — por isso há teto de quantidade e de tamanho. */
function acaoRegistrarDiagnostico(ctx) {
  gravarTelemetria(ctx.dados);
  return { registrado: true };
}

function registrarDiagnosticoLegado(corpo) {
  gravarTelemetria({ app: corpo.app, logs: corpo.logs, sessao: corpo.sessao });
}

function gravarTelemetria(d) {
  if (String(d.app || "") !== "floreser") return;
  if (schemaAtivo() < VERSAO_SCHEMA) return;
  var logs = (Array.isArray(d.logs) ? d.logs : []).slice(0, LIMITE_POR_ENVIO).map(function (l) {
    return { id: String(l.id || "").slice(0, 40) || novoId("lg").slice(0, 14), quando: instanteDoCliente(l.quando),
      nivel: NIVEIS_LOG.indexOf(String(l.nivel)) >= 0 ? String(l.nivel) : "INFO", evento: String(l.evento || "").slice(0, 40),
      pagina: String(l.pagina || "").slice(0, 40), mensagem: String(l.mensagem || "").slice(0, 400),
      versao: String(l.versao || "").slice(0, 40), sessao: String(l.sessao || "").slice(0, 40), pedidoId: String(l.pedidoId || "").slice(0, 64) };
  });
  var visita = d.sessao && d.sessao.id ? d.sessao : null;
  if (!logs.length && !visita) return;
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(2000)) return;
  try {
    if (logs.length) inserir("sis_logs", logs);
    if (visita) {
      var reg = { id: String(visita.id).slice(0, 40) };
      definicaoTabela("sis_visitas").campos.forEach(function (c) { if (c.n !== "id") reg[c.n] = String(visita[c.n] === undefined ? "" : visita[c.n]).slice(0, 300); });
      var existente = linhasCom("sis_visitas", "id", reg.id)[0];
      if (existente) { reg._linha = existente._linha; atualizar("sis_visitas", [reg]); } else inserir("sis_visitas", [reg]);
    }
    aparar("sis_logs", LIMITE_LOGS);
    aparar("sis_visitas", LIMITE_VISITAS);
    SpreadsheetApp.flush();
  } finally { trava.releaseLock(); }
}

function instanteDoCliente(v) {
  var d = new Date(v);
  if (!isNaN(d.getTime()) && /Z|[+-]\d{2}:?\d{2}$/.test(String(v))) return d.toISOString();
  return instanteDeHoraLocal(v) || agoraISO();
}

/* Guarda as linhas mais novas: o excesso sai pelo topo, que é o mais antigo. */
function aparar(nome, limite) {
  var t = tabela(nome);
  var total = ultimaLinha(t) - 1;
  if (total > limite + 50) {
    t.sheet.deleteRows(2, total - limite);
    t.linhas = null; t.indice = null; t.ultima = null;
  }
}

/* ---------------------------------------------------------------------
   Painel de manutenção
   --------------------------------------------------------------------- */

function painelDados() {
  var logs = lerUltimas("sis_logs", 600).map(function (l) {
    return { id: l.id, quando: l.quando, nivel: l.nivel, evento: l.evento, pagina: l.pagina, mensagem: l.mensagem,
      versao: l.versao, sessao: l.sessao, pedidoId: l.pedidoId };
  });
  var visitas = lerUltimas("sis_visitas", 300).map(function (v) { var o = {}; Object.keys(v).forEach(function (k) { if (k[0] !== "_") o[k] = v[k]; }); return o; });
  var porNivel = {};
  logs.forEach(function (l) { porNivel[l.nivel] = (porNivel[l.nivel] || 0) + 1; });
  return { logs: logs, sessoes: visitas, resumo: { logs: logs.length, sessoes: visitas.length, porNivel: porNivel,
    ultimoAcesso: visitas.length ? visitas[0].ultimoAcesso : "", servidor: agoraISO(), versao: VERSAO_PRODUTO } };
}

function painelLimpar(ctx) {
  var nome = ctx.dados.alvo === "sessoes" ? "sis_visitas" : "sis_logs";
  comTrava(function () {
    var t = tabela(nome);
    var ultima = ultimaLinha(t);
    if (ultima >= 2) t.sheet.deleteRows(2, ultima - 1);
    t.linhas = null; t.ultima = null;
  });
  registrarTecnico("SECURITY", "DEV_LIMPEZA", "Registros de " + nome + " apagados pelo painel.");
  return { limpo: nome };
}

/* O estado do servidor, para quem cuida dele: versões, schema, migrações,
   operações pendentes, sessões abertas (contagem) e senhas de módulo. */
function painelSistema() {
  var agora = Date.now();
  var sessoes = lerTudo("sis_sessoes").filter(function (s) { return !s.revogadoEm && Number(s.expiraEm) > agora && Number(s.expiraAbsoluto) > agora; });
  var porTipo = { conta: 0, modulo: 0 };
  sessoes.forEach(function (s) { porTipo[s.tipo] = (porTipo[s.tipo] || 0) + 1; });
  var senhas = {};
  MODULOS_COM_SENHA.forEach(function (m) { senhas[m] = senhaDeModuloLigada(m); });
  return {
    versao: VERSAO_PRODUTO, api: VERSAO_API, schema: VERSAO_SCHEMA, schemaAtivo: schemaAtivo(), manutencao: emManutencao(),
    fuso: fusoDaClinica(), opsPendentes: propriedade("FLORESER_OPS_PENDENTES", "") ? 1 : 0,
    migracoes: lerTudo("sis_migracoes").map(function (m) { return { versao: m.versao, etapa: m.etapa, estado: m.estado, concluidoEm: m.concluidoEm }; }),
    sessoesAbertas: porTipo, senhasDeModulo: senhas, segredosFaltando: segredosFaltando()
  };
}

/* Transição da senha compartilhada: o painel liga ou desliga, módulo a
   módulo. Desligar não encerra quem já entrou — a sessão dela vence
   sozinha em no máximo 30 minutos sem uso. */
function painelSenhaModulo(ctx) {
  var m = String(ctx.dados.modulo || "");
  if (MODULOS.indexOf(m) < 0) falhar("dados_invalidos", "Módulo desconhecido.");
  definirPropriedade("FLORESER_SENHA_MODULO_" + m.toUpperCase(), ctx.dados.ligada ? "sim" : "nao");
  registrarTecnico("SECURITY", "SENHA_MODULO_" + (ctx.dados.ligada ? "LIGADA" : "DESLIGADA"), m);
  return painelSistema();
}
