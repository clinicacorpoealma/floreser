/* =====================================================================
   01_Http — a porta do Apps Script: contrato, roteamento e respostas
   ---------------------------------------------------------------------
   Pedido (POST text/plain, corpo JSON — text/plain evita o preflight
   OPTIONS, que o Apps Script não responde):

     { v: 2, pedidoId, acao, token?, cliente: { versao }, dados: { ... } }

   Resposta, sempre JSON e sempre com HTTP 200 (o Apps Script não deixa
   escolher o status):

     { ok, v, pedidoId, servidor: { versao, api, schema },
       dados?, erro?: { codigo, categoria, mensagem, ... }, sessao? }

   Sucesso é ok === true e mais nada. O navegador nunca deve deduzir
   sucesso da ausência de erro (ver compartilhado/rede.js).

   A trava do script NÃO é pega aqui. Ela fica restrita à região crítica
   de cada gravação (03_Concorrencia): ler, validar sessão e responder
   não esperam ninguém.
   ===================================================================== */

/* As categorias dizem ao navegador o que fazer com o erro — e só
   "autenticacao" pode levar a pedir login de novo. */
var CATEGORIA_DO_ERRO = {
  sessao_ausente: "autenticacao", sessao_invalida: "autenticacao",
  sessao_expirada: "autenticacao", sessao_revogada: "autenticacao",
  conta_inativa: "autenticacao", credenciais: "autenticacao", bloqueado: "autenticacao",
  senha_modulo_desligada: "autenticacao",
  sem_acesso: "autorizacao", sem_permissao: "autorizacao",
  dados_invalidos: "validacao", acao_desconhecida: "validacao",
  operacao_divergente: "validacao", nao_encontrado: "validacao", sem_confirmacao: "validacao", na_lixeira: "validacao",
  conflito: "conflito",
  versao_cliente: "versao", versao_servidor: "versao", manutencao: "versao",
  ocupado: "indisponivel", servidor_falhou: "indisponivel", instalacao_incompleta: "indisponivel",
  /* Integração: NENHUM destes é "autenticacao". Credencial do Clinicorp
     recusada suspende a integração; a sessão da pessoa no Alveare fica. */
  integracao_nao_configurada: "validacao", integracao_suspensa: "validacao", integracao_recusou: "validacao",
  integracao_incerta: "validacao", integracao_indisponivel: "indisponivel"
};

/* Erro de negócio: vira resposta, nunca pilha de execução. */
function ErroApp(codigo, mensagem, detalhes) {
  this.codigo = codigo;
  this.mensagem = mensagem || "";
  this.detalhes = detalhes || null;
}

function falhar(codigo, mensagem, detalhes) {
  throw new ErroApp(codigo, mensagem, detalhes);
}

function erroPublico(codigo, mensagem, detalhes) {
  var e = { codigo: codigo, categoria: CATEGORIA_DO_ERRO[codigo] || "indisponivel", mensagem: mensagem || "" };
  if (detalhes) Object.keys(detalhes).forEach(function (k) { e[k] = detalhes[k]; });
  e.repetivel = e.categoria === "indisponivel" && codigo !== "instalacao_incompleta";
  return e;
}

/* ---------------------------------------------------------------------
   Rotas
   publica      sem sessão
   sessao       qualquer sessão válida (conta ou senha de módulo)
   conta        só sessão de conta individual
   modulo       sessão que alcance o(s) módulo(s)
   moduloDe     o módulo vem de um campo do pedido (lixeira, auditoria)
   painel       sessão da senha do painel de manutenção
   livre        responde mesmo em manutenção
   --------------------------------------------------------------------- */
function rotas() {
  return {
    "sistema.ping": { publica: true, livre: true, fn: acaoPing },
    "sistema.versao": { publica: true, livre: true, fn: acaoVersao },
    "diagnostico.registrar": { publica: true, livre: true, fn: acaoRegistrarDiagnostico },

    "sessao.entrar": { publica: true, fn: acaoEntrar },
    "sessao.entrarModulo": { publica: true, fn: acaoEntrarModulo },
    "sessao.conferir": { sessao: true, fn: acaoConferirSessao },
    "sessao.sair": { sessao: true, fn: acaoSair },

    "crm.ler": { modulo: ["crm"], fn: crmLer },
    "crm.aplicar": { modulo: ["crm"], fn: crmAplicar },
    "crm.agendarNaAgenda": { modulo: ["crm", "agenda"], fn: crmAgendarNaAgenda },
    "agenda.ler": { modulo: ["agenda"], fn: agendaLer },
    "agenda.aplicar": { modulo: ["agenda"], fn: agendaAplicar },
    "entradas.ler": { modulo: ["entradas"], fn: entradasLer },
    "entradas.aplicar": { modulo: ["entradas"], fn: entradasAplicar },
    "financeiro.ler": { modulo: ["financeiro"], fn: financeiroLer },
    "financeiro.resumo": { modulo: ["financeiro"], fn: financeiroResumo },
    "financeiro.simular": { modulo: ["financeiro"], fn: financeiroSimular },
    "financeiro.estoque": { modulo: ["financeiro"], fn: financeiroEstoque },
    "financeiro.orcamentosExecucao": { modulo: ["financeiro"], fn: financeiroOrcamentosExecucao },
    "financeiro.precosPraticados": { modulo: ["financeiro"], fn: financeiroPrecosPraticados },
    "financeiro.aplicar": { modulo: ["financeiro"], fn: financeiroAplicar },

    "importacao.previa": { moduloDe: "modulo", fn: importacaoPrevia },
    "importacao.confirmar": { moduloDe: "modulo", fn: importacaoConfirmar },
    "importacao.historico": { moduloDe: "modulo", fn: importacaoHistorico },
    "integracao.contexto": { moduloDe: "modulo", fn: integracaoContexto },
    "integracao.decidir": { moduloDe: "modulo", fn: integracaoDecidir },
    "integracao.enviar": { moduloDe: "modulo", fn: integracaoEnviarDoModulo },

    "lixeira.mover": { moduloDe: "tipo", fn: lixeiraMover },
    "lixeira.repetido": { moduloDe: "tipo", fn: lixeiraRepetido },
    "auditoria.listar": { moduloDe: "modulo", fn: auditoriaListar },
    "busca.global": { conta: true, fn: buscaGlobal },

    "painel.dados": { painel: true, fn: painelDados },
    "painel.limpar": { painel: true, fn: painelLimpar },
    "painel.sistema": { painel: true, fn: painelSistema },
    "painel.senhaModulo": { painel: true, fn: painelSenhaModulo },
    "painel.usuarios.listar": { painel: true, fn: usuariosListar },
    "painel.usuarios.criar": { painel: true, fn: usuariosCriar },
    "painel.usuarios.editar": { painel: true, fn: usuariosEditar },
    "painel.usuarios.status": { painel: true, fn: usuariosStatus },
    "painel.usuarios.senha": { painel: true, fn: usuariosSenha },
    "painel.usuarios.encerrarSessoes": { painel: true, fn: usuariosEncerrarSessoes },
    "painel.lixeira.listar": { painel: true, fn: lixeiraListar },
    "painel.lixeira.restaurar": { painel: true, fn: lixeiraRestaurar },
    "painel.lixeira.excluir": { painel: true, fn: lixeiraExcluir },
    "painel.lixeira.limpar": { painel: true, fn: lixeiraLimpar },
    "painel.auditoria": { painel: true, fn: auditoriaGeral },

    "painel.integracao.estado": { painel: true, fn: integracaoEstado },
    "painel.integracao.configurar": { painel: true, fn: integracaoConfigurar },
    "painel.integracao.testar": { painel: true, fn: integracaoTestar },
    "painel.integracao.executar": { painel: true, fn: integracaoExecutar },
    "painel.integracao.agendar": { painel: true, fn: integracaoAgendar },
    "painel.integracao.ativar": { painel: true, fn: integracaoAtivar },
    "painel.integracao.profissionais": { painel: true, fn: integracaoProfissionais },
    "painel.integracao.aplicarAgora": { painel: true, fn: function (ctx) { return aplicarFilaClinicorp(ctx.auth, INT_TEMPO_WEB_MS, ctx.pedidoId); } },
    "painel.integracao.suspender": { painel: true, fn: integracaoSuspender },
    "painel.integracao.externos": { painel: true, fn: integracaoExternos },
    "painel.integracao.locais": { painel: true, fn: integracaoLocais },
    "painel.integracao.pendencias": { painel: true, fn: integracaoPendencias },
    "painel.integracao.resolver": { painel: true, fn: integracaoResolver },
    "painel.integracao.vincular": { painel: true, fn: integracaoVincular },
    "painel.integracao.desvincular": { painel: true, fn: integracaoDesvincular },
    "painel.integracao.complemento": { painel: true, fn: integracaoComplemento },
    "painel.integracao.reconciliar": { painel: true, fn: integracaoReconciliar },
    "painel.integracao.buscarPaciente": { painel: true, fn: integracaoBuscarPaciente },
    "painel.integracao.criarPaciente": { painel: true, fn: integracaoCriarPaciente },
    "painel.integracao.enviarLead": { painel: true, fn: integracaoEnviarLead },
    "painel.integracao.decidirPasso": { painel: true, fn: integracaoDecidirPasso }
  };
}

/* Ações da 3.5.0. Um site antigo aberto durante a publicação recebe um
   recado claro — e, principalmente, NÃO consegue gravar o estado inteiro
   por cima do schema novo. O registro técnico continua aceito: ele não
   regrava nada de ninguém. */
var ACOES_LEGADAS = ["entrar", "sair", "ler", "salvar", "ler_agenda", "salvar_agenda",
  "ler_entradas", "salvar_entradas", "login_usuario", "logout_usuario", "sessao_usuario",
  "lixeira_mover", "repetido_na_lixeira", "busca_global", "crm_agenda_agendar",
  "auditoria_listar", "auditoria_geral", "dev_entrar", "dev_dados", "dev_limpar"];

/* ---------------------------------------------------------------------
   doPost
   --------------------------------------------------------------------- */
function doPost(e) {
  reiniciarExecucao();
  var inicio = Date.now();
  var corpo = lerCorpo(e);
  var pedidoId = corpo && typeof corpo.pedidoId === "string" ? corpo.pedidoId.slice(0, 64) : "";
  var acao = corpo ? String(corpo.acao || "") : "";

  if (!corpo) return responder({ ok: false, erro: erroPublico("dados_invalidos", "Corpo ilegível.") }, pedidoId, acao, inicio);

  /* Cliente da 3.5.0 (sem "v"): respostas no formato antigo, com erro em texto. */
  if (corpo.v === undefined) return responderLegado(corpo, acao);

  if (Number(corpo.v) !== VERSAO_API) {
    return responder({ ok: false, erro: erroPublico("versao_cliente",
      "Este site fala a versão " + corpo.v + " da API; o servidor fala a " + VERSAO_API + ".") },
      pedidoId, acao, inicio);
  }

  var rota = rotas()[acao];
  if (!rota) return responder({ ok: false, erro: erroPublico("acao_desconhecida") }, pedidoId, acao, inicio);

  var ctx = {
    pedidoId: pedidoId, acao: acao, token: String(corpo.token || ""),
    dados: (corpo.dados && typeof corpo.dados === "object") ? corpo.dados : {},
    cliente: (corpo.cliente && typeof corpo.cliente === "object") ? corpo.cliente : {},
    sessao: null, auth: null
  };

  try {
    if (!rota.livre) {
      if (emManutencao()) falhar("manutencao", "O sistema está em manutenção. Tente de novo em alguns minutos.");
      if (schemaAtivo() < VERSAO_SCHEMA) falhar("manutencao", "A atualização dos dados ainda não foi concluída.");
    }

    if (!rota.publica) {
      ctx.sessao = validarSessao(ctx.token);
      if (rota.conta && ctx.sessao.tipo !== "conta") falhar("sem_acesso", "Esta ação é das contas individuais.");
      if (rota.painel) autorizarPainel(ctx.sessao);
      if (rota.modulo) ctx.auth = autorizarModulos(ctx.sessao, rota.modulo);
      if (rota.moduloDe) ctx.auth = autorizarModulos(ctx.sessao, [String(ctx.dados[rota.moduloDe] || "")]);
      if (!ctx.auth) ctx.auth = authDaSessao(ctx.sessao, "");
    }

    var dados = rota.fn(ctx);
    var resposta = { ok: true, dados: dados === undefined ? null : dados };
    if (ctx.sessao) resposta.sessao = resumoDaSessao(ctx.sessao);
    return responder(resposta, pedidoId, acao, inicio);
  } catch (erro) {
    if (erro instanceof ErroApp) {
      var r = { ok: false, erro: erroPublico(erro.codigo, erro.mensagem, erro.detalhes) };
      if (ctx.sessao && erro.codigo !== "sessao_revogada") r.sessao = resumoDaSessao(ctx.sessao);
      return responder(r, pedidoId, acao, inicio);
    }
    console.error("FloreSer falhou em " + acao + " [" + pedidoId + "]: " + (erro && erro.stack ? erro.stack : erro));
    registrarTecnico("ERROR", "SERVIDOR_FALHOU", acao + " · " + pedidoId + " · " + String(erro && erro.message || erro).slice(0, 200));
    return responder({ ok: false, erro: erroPublico("servidor_falhou") }, pedidoId, acao, inicio);
  }
}

/* Abrir o endereço no navegador não devolve dado nenhum. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true, servico: "FloreSer", api: VERSAO_API, metodo: "use POST"
  })).setMimeType(ContentService.MimeType.JSON);
}

function lerCorpo(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return null;
    var c = JSON.parse(e.postData.contents);
    return c && typeof c === "object" ? c : null;
  } catch (err) { return null; }
}

function responderLegado(corpo, acao) {
  if (acao === "registrar") {
    try { registrarDiagnosticoLegado(corpo); } catch (e) { }
    return saida({ ok: true });
  }
  if (ACOES_LEGADAS.indexOf(acao) < 0) return saida({ ok: false, erro: "acao_desconhecida" });
  return saida({ ok: false, erro: "versao_cliente",
    mensagem: "O sistema foi atualizado. Recarregue a página para continuar." });
}

function responder(objeto, pedidoId, acao, inicio) {
  objeto.v = VERSAO_API;
  objeto.pedidoId = pedidoId || "";
  objeto.servidor = { versao: VERSAO_PRODUTO, api: VERSAO_API, schema: VERSAO_SCHEMA, schemaAtivo: schemaAtivo() };
  var med = medidor();
  med.ms = Date.now() - inicio;
  if (propriedade("FLORESER_DIAGNOSTICO", "") === "sim") objeto.diag = med;
  var texto = JSON.stringify(objeto);
  if (med.ms > 8000 || med.travaMs > 3000) {
    /* números, nunca conteúdo: sem token, nome ou dado de ninguém */
    console.log("FloreSer lento " + acao + " " + JSON.stringify(med) + " bytes=" + texto.length);
  }
  return saida(objeto, texto);
}

function saida(objeto, texto) {
  return ContentService.createTextOutput(texto || JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------------
   Medidor — quantas chamadas ao Sheets, quanto tempo de trava
   --------------------------------------------------------------------- */
var _MED = null;

function reiniciarMedidor() {
  _MED = { sheets: 0, leituras: 0, escritas: 0, celulas: 0, travaMs: 0, presaMs: 0, cache: 0 };
}

function medidor() {
  if (!_MED) reiniciarMedidor();
  return _MED;
}

function anotar(campo, quanto) {
  var m = medidor();
  m[campo] = (m[campo] || 0) + (quanto === undefined ? 1 : quanto);
}

/* ---------------------------------------------------------------------
   Ações públicas do sistema
   --------------------------------------------------------------------- */
function acaoPing() {
  return { servico: "FloreSer", quando: new Date().toISOString() };
}

/* O site pergunta isto antes de usar um contrato: versão, schema ativo e
   capacidades. Nada aqui é segredo. */
function acaoVersao() {
  return {
    versao: VERSAO_PRODUTO, api: VERSAO_API, schema: VERSAO_SCHEMA, schemaAtivo: schemaAtivo(),
    manutencao: emManutencao(), capacidades: CAPACIDADES, fuso: fusoDaClinica()
  };
}
