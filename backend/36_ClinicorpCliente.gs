/* =====================================================================
   36_ClinicorpCliente — a conversa com o Clinicorp (UrlFetchApp)
   ---------------------------------------------------------------------
   · Credenciais só das Script Properties (FLORESER_CLINICORP_USUARIO e
     FLORESER_CLINICORP_TOKEN). Nenhuma resposta, log ou exportação as
     mostra; o navegador nunca as vê. A senha de login humano do Clinicorp
     nunca é pedida: a integração usa o Usuário API e o Token API.
   · Nunca dentro da trava do script: quem chama daqui não pode estar com
     a trava (conferido). Ler a planilha, sim; esperar a rede segurando
     todo mundo, não.
   · Leitura pode repetir (rede caiu, 5xx). Escrita NUNCA repete sozinha:
     o Clinicorp não documenta idempotência. Sem resposta clara, o
     resultado é "desconhecido" e uma pessoa decide depois de verificar.
   · 401/403 suspendem a integração e avisam o administrador. Não tocam
     em sessão nenhuma do Alveare.
   ===================================================================== */

var CLINICORP_PAUSA_MS = 300;          // entre chamadas da mesma execução
var CLINICORP_MAX_CHAMADAS = 80;       // por execução do Apps Script
var CLINICORP_REPETIR_LEITURA = [1000, 3000];

var _CLINICORP_CHAMADAS = 0;
var _CLINICORP_ULTIMA = 0;

function reiniciarClinicorp() { _CLINICORP_CHAMADAS = 0; _CLINICORP_ULTIMA = 0; if (typeof _STATUS_LIDO !== "undefined") _STATUS_LIDO = false; }

/* Falha do Clinicorp, com o tipo que decide o que fazer:
   autenticacao · limite · recusado · indisponivel · desconhecido */
function ErroClinicorp(tipo, mensagem, status) {
  this.tipo = tipo;
  this.mensagem = mensagem || "";
  this.status = status || 0;
}

/* ---------------------------------------------------------------------
   Configuração
   --------------------------------------------------------------------- */

var CONFIG_CLINICORP_PADRAO = {
  assinante: "", unidade: "", recursos: {}, frequenciaHoras: 0, janelaReconsultaDias: 7,
  eventosOrcamento: {}, campanhaPadrao: "", valorSemTaxas: false,
  suspensa: null, verificacao: null, ultimas: {}, desconectadaEm: null,
  criarEntradas: true, areaPorProfissional: {}, frequenciaMin: 0, ativadaEm: null, fontePrincipal: false,
  ultimaRotina: null, envioAgenda: false, recebimentosPor: "", statusAgenda: {}, categoriaStatus: {}
};

function configClinicorp() {
  var c = {};
  try { c = JSON.parse(propriedade("FLORESER_CLINICORP_CONFIG", "{}")) || {}; } catch (e) { c = {}; }
  var saida = {};
  Object.keys(CONFIG_CLINICORP_PADRAO).forEach(function (k) {
    saida[k] = c[k] === undefined ? JSON.parse(JSON.stringify(CONFIG_CLINICORP_PADRAO[k])) : c[k];
  });
  return saida;
}

function salvarConfigClinicorp(c) {
  var texto = JSON.stringify(c);
  if (texto.length > 8500) {
    /* o espaço de uma propriedade é curto: a verificação é a primeira a encolher */
    c.verificacao = c.verificacao ? { em: c.verificacao.em, resumo: c.verificacao.resumo } : null;
    texto = JSON.stringify(c);
  }
  definirPropriedade("FLORESER_CLINICORP_CONFIG", texto);
}

function alterarConfigClinicorp(fn) {
  /* a configuração é uma propriedade só: muda dentro da trava curta */
  return comTrava(function () {
    _PROPS = null;
    var c = configClinicorp();
    fn(c);
    salvarConfigClinicorp(c);
    return c;
  });
}

function credenciaisClinicorp() {
  var u = propriedade("FLORESER_CLINICORP_USUARIO", ""), t = propriedade("FLORESER_CLINICORP_TOKEN", "");
  return u && t ? { usuario: String(u), token: String(t) } : null;
}

function modoDoRecurso(c, recurso) {
  var r = (c.recursos || {})[recurso];
  var modo = r && r.modo ? r.modo : "desligado";
  var def = CLINICORP_RECURSOS[recurso];
  return def && def.modos.indexOf(modo) >= 0 ? modo : "desligado";
}

/* Por que não dá para chamar agora — ou "" se dá. */
function impedimentoClinicorp(c) {
  if (!credenciaisClinicorp()) return "nao_configurada";
  if (!c.assinante) return "nao_configurada";
  if (c.desconectadaEm) return "desconectada";
  if (c.suspensa) return "suspensa";
  return "";
}

function exigirClinicorpPronto(c) {
  var imp = impedimentoClinicorp(c);
  if (imp === "nao_configurada") falhar("integracao_nao_configurada", "A integração com o Clinicorp não está configurada.");
  if (imp === "desconectada") falhar("integracao_suspensa", "A integração com o Clinicorp está desconectada.");
  if (imp === "suspensa") falhar("integracao_suspensa", "A integração com o Clinicorp está suspensa: " + (c.suspensa.mensagem || c.suspensa.motivo) + ".");
}

/* ---------------------------------------------------------------------
   Chamada
   --------------------------------------------------------------------- */

function montarQuery(params) {
  var partes = [];
  Object.keys(params || {}).forEach(function (k) {
    var v = params[k];
    if (v === null || v === undefined || v === "") return;
    partes.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  });
  return partes.length ? "?" + partes.join("&") : "";
}

function esperarVez() {
  var falta = CLINICORP_PAUSA_MS - (Date.now() - _CLINICORP_ULTIMA);
  if (_CLINICORP_ULTIMA && falta > 0) Utilities.sleep(falta);
  _CLINICORP_ULTIMA = Date.now();
}

/* chamarClinicorp("orcamentos.listar", { from, to }) → dados já em JSON.
   O assinante entra sozinho quando a operação pede. */
function chamarClinicorp(opId, params, corpo) {
  var op = CLINICORP_OPERACOES[opId];
  if (!op || !op.implementado) throw new Error("operação do Clinicorp não implementada: " + opId);
  if (_NA_TRAVA) throw new Error("chamada ao Clinicorp dentro da trava do script");
  var cred = credenciaisClinicorp();
  if (!cred) throw new ErroClinicorp("recusado", "credenciais ausentes");
  if (_CLINICORP_CHAMADAS >= CLINICORP_MAX_CHAMADAS) throw new ErroClinicorp("limite", "limite de chamadas desta execução");
  var c = configClinicorp();
  var p = {};
  Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
  if (op.parametros.indexOf("subscriber_id*") >= 0 || op.parametros.indexOf("subscriber_id") >= 0) {
    if (op.metodo === "get" && p.subscriber_id === undefined) p.subscriber_id = c.assinante;
  }
  var url = CLINICORP_BASE + op.caminho + (op.metodo === "get" ? montarQuery(p) : "");
  var opcoes = {
    method: op.metodo, muteHttpExceptions: true, followRedirects: true,
    headers: { Authorization: "Basic " + Utilities.base64Encode(cred.usuario + ":" + cred.token), Accept: "application/json" }
  };
  if (op.metodo === "post") {
    var b = {};
    Object.keys(corpo || {}).forEach(function (k) { b[k] = corpo[k]; });
    if (b.subscriber_id === undefined && op.parametros.indexOf("subscriber_id") >= 0) b.subscriber_id = c.assinante;
    opcoes.contentType = "application/json";
    opcoes.payload = JSON.stringify(b);
  }
  var escrita = op.efeito === "mutacao";
  var esperas = escrita ? [] : CLINICORP_REPETIR_LEITURA;
  var tentativa = 0;
  while (true) {
    esperarVez();
    _CLINICORP_CHAMADAS++;
    var resp = null, falhaRede = null;
    try { resp = UrlFetchApp.fetch(url, opcoes); } catch (e) { falhaRede = e; }
    if (falhaRede) {
      if (escrita) throw new ErroClinicorp("desconhecido", "sem resposta do Clinicorp (" + String(falhaRede.message || falhaRede).slice(0, 80) + ")");
      if (tentativa < esperas.length) { Utilities.sleep(esperas[tentativa++]); continue; }
      throw new ErroClinicorp("indisponivel", "sem resposta do Clinicorp");
    }
    var status = resp.getResponseCode();
    var texto = String(resp.getContentText() || "");
    if (status === 401 || status === 403) throw new ErroClinicorp("autenticacao", "o Clinicorp recusou as credenciais (HTTP " + status + ")", status);
    if (status === 429) throw new ErroClinicorp("limite", "o Clinicorp pediu para esperar (HTTP 429)", status);
    if (status >= 500) {
      if (escrita) throw new ErroClinicorp("desconhecido", "o Clinicorp falhou depois de receber o pedido (HTTP " + status + ")", status);
      if (tentativa < esperas.length) { Utilities.sleep(esperas[tentativa++]); continue; }
      throw new ErroClinicorp("indisponivel", "o Clinicorp está fora do ar (HTTP " + status + ")", status);
    }
    var dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = undefined; }
    if (status >= 400) {
      var msg = dados && (dados.Message || dados.message) ? String(dados.Message || dados.message).slice(0, 200) : "HTTP " + status;
      throw new ErroClinicorp("recusado", "o Clinicorp recusou o pedido: " + msg, status);
    }
    if (dados === undefined) {
      if (escrita) throw new ErroClinicorp("desconhecido", "resposta ilegível do Clinicorp", status);
      throw new ErroClinicorp("indisponivel", "resposta ilegível do Clinicorp", status);
    }
    if (escrita && dados && typeof dados === "object" && !Array.isArray(dados) && dados.Error) {
      throw new ErroClinicorp("recusado", "o Clinicorp recusou: " + String(dados.Message || dados.Error).slice(0, 200), status);
    }
    return dados;
  }
}

/* O que fazer com uma falha do Clinicorp fora de um trabalho em lote:
   suspender (credenciais) e responder com um erro que NÃO é de sessão. */
function tratarErroClinicorp(e, contexto) {
  if (!(e instanceof ErroClinicorp)) throw e;
  if (e.tipo === "autenticacao") {
    suspenderPorAutenticacao(e, contexto);
    falhar("integracao_suspensa", "O Clinicorp recusou as credenciais da integração. Ela foi suspensa e o administrador precisa conferir o Usuário API e o Token API.");
  }
  if (e.tipo === "limite") falhar("integracao_indisponivel", "O Clinicorp pediu para esperar. Tente de novo em alguns minutos.");
  if (e.tipo === "indisponivel") falhar("integracao_indisponivel", "O Clinicorp não respondeu. Nada foi alterado.");
  if (e.tipo === "desconhecido") falhar("integracao_incerta", "Não deu para saber se o Clinicorp recebeu o pedido. Verifique antes de reenviar.");
  falhar("integracao_recusou", e.mensagem || "O Clinicorp recusou o pedido.");
}

function suspenderPorAutenticacao(e, contexto) {
  alterarConfigClinicorp(function (c) {
    c.suspensa = { em: agoraISO(), motivo: "autenticacao", mensagem: "credenciais recusadas (HTTP " + (e.status || "?") + ")" };
  });
  registrarTecnico("SECURITY", "CLINICORP_AUTENTICACAO", "Clinicorp recusou as credenciais da integração em " + String(contexto || "").slice(0, 60) +
    " (HTTP " + (e.status || "?") + "). Integração suspensa.");
}
