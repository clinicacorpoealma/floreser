/* =====================================================================
   03_Concorrencia — trava, revisões, operações idempotentes e diário
   ---------------------------------------------------------------------
   Quatro mecanismos, quatro problemas:

   TRAVA (LockService)   duas execuções escrevendo ao mesmo tempo. É do
                         script inteiro — não existe trava por linha — e por
                         isso fica só em volta de reler → conferir revisão →
                         escrever. Ler e validar sessão nunca a esperam.

   REVISÃO (rev)         gravar por cima de uma versão que já mudou. Cada
                         entidade raiz (lead, paciente, entrada, ...) tem a
                         sua; mexer numa ficha não conflita com outra.

   OPERAÇÃO (operacaoId) a mesma intenção chegando duas vezes porque a
                         resposta se perdeu. O registro em sis_operacoes é a
                         prova durável; o CacheService só acelera — ele pode
                         esquecer a qualquer momento.

   DIÁRIO (plano)        uma operação que escreve em várias abas e morre no
                         meio. O Sheets não tem transação e a trava não
                         desfaz nada. Antes de escrever, o plano completo —
                         a lista de escritas, cada uma repetível — vai para
                         sis_operacoes com estado "aplicando". Se a execução
                         morrer, a próxima que pegar a trava REFAZ o plano
                         até o fim (redo) antes de fazer qualquer outra
                         coisa. Não é uma transação atômica: entre a queda e
                         a recuperação, uma leitura pode ver a operação pela
                         metade. Nenhuma gravação nova acontece antes de ela
                         terminar, e a auditoria entra no mesmo plano.

   Ordem das escritas de um plano: filhos primeiro, a linha raiz (com a
   revisão nova) por último. Quem ler no meio vê a revisão antiga; a
   próxima gravação dessa pessoa recebe conflito e concilia.
   ===================================================================== */

var _NA_TRAVA = false;
var RE_OPERACAO = /^[A-Za-z0-9_-]{8,80}$/;
var OPERACAO_CACHE_SEGUNDOS = 21600;

function comTrava(fn) {
  if (_NA_TRAVA) return fn();
  var trava = LockService.getScriptLock();
  var pedida = Date.now();
  var obtida = trava.tryLock(ESPERA_TRAVA_MS);
  anotar("travaMs", Date.now() - pedida);
  if (!obtida) falhar("ocupado", "O servidor está ocupado com outra gravação. Tente de novo em instantes.");
  _NA_TRAVA = true;
  var entrou = Date.now();
  try {
    esquecerLinhas();
    recuperarPendentes();
    var resultado = fn();
    SpreadsheetApp.flush();
    return resultado;
  } finally {
    _NA_TRAVA = false;
    anotar("presaMs", Date.now() - entrou);
    trava.releaseLock();
  }
}

/* Uma leitura que chega com recuperação pendente espera ela terminar:
   melhor um segundo a mais do que devolver uma ficha pela metade. */
function lerComConsistencia(fn) {
  if (propriedade("FLORESER_OPS_PENDENTES", "")) comTrava(function () { return null; });
  return fn();
}

/* ---------------------------------------------------------------------
   Identidade da operação
   --------------------------------------------------------------------- */

function canonico(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  if (typeof v === "object") {
    return "{" + Object.keys(v).sort().filter(function (k) { return k !== "operacaoId"; })
      .map(function (k) { return JSON.stringify(k) + ":" + canonico(v[k]); }).join(",") + "}";
  }
  return JSON.stringify(v);
}

function autorDaOperacao(auth) {
  if (!auth) return "anonimo";
  return auth.tipo === "usuario" ? "u:" + auth.usuarioId : "m:" + (auth.modulo || "");
}

/* A chave liga o operacaoId a QUEM pediu, O QUE pediu e COM QUE conteúdo.
   O mesmo id com outro conteúdo é erro explícito, nunca "já feito". */
function chaveDaOperacao(auth, acao, op) {
  return sha256Hex(autorDaOperacao(auth) + "|" + acao + "|" + canonico(op));
}

/* ---------------------------------------------------------------------
   Registro das operações
   --------------------------------------------------------------------- */

function operacaoDoCache(id) {
  try {
    var v = CacheService.getScriptCache().get("op." + id);
    if (v) { anotar("cache"); return JSON.parse(v); }
  } catch (e) { }
  return null;
}

function guardarOperacaoNoCache(id, registro) {
  try {
    CacheService.getScriptCache().put("op." + id, JSON.stringify({
      chave: registro.chave, estado: registro.estado, resultado: registro.resultado
    }), OPERACAO_CACHE_SEGUNDOS);
  } catch (e) { }
}

/* Quais destes ids já passaram por aqui. O cache responde o que lembra; o
   que ele não lembra é procurado na aba — ausência no cache não prova nada. */
function operacoesConhecidas(ids) {
  var achadas = {};
  var faltam = [];
  ids.forEach(function (id) {
    var c = operacaoDoCache(id);
    if (c) achadas[id] = c; else faltam.push(id);
  });
  if (!faltam.length) return achadas;
  var procurados = {};
  faltam.forEach(function (id) { procurados[id] = true; });
  var linhas = [];
  lerColuna("sis_operacoes", "operacaoId").forEach(function (c) {
    if (procurados[c.valor]) linhas.push(c.linha);
  });
  if (linhas.length) {
    lerLinhasNumeradas(tabela("sis_operacoes"), linhas.sort(function (a, b) { return a - b; }))
      .forEach(function (r) { achadas[r.operacaoId] = r; });
  }
  return achadas;
}

/* ---------------------------------------------------------------------
   Executar operações
   ---------------------------------------------------------------------
   operacoes: [{ operacaoId, tipo, ... }]
   planejar(op): devolve { escritas, resultado } ou lança ErroApp (conflito,
   validação). Roda DENTRO da trava, com leituras frescas.
   Cada operação vale por si: um lote não é uma transação, e o resultado
   vem um por um, na mesma ordem. */
function executarOperacoes(ctx, operacoes, planejar) {
  if (!Array.isArray(operacoes) || !operacoes.length) falhar("dados_invalidos", "Nenhuma operação no pedido.");
  if (operacoes.length > MAX_OPERACOES_POR_PEDIDO) falhar("dados_invalidos", "Operações demais num pedido só.");
  var vistos = {};
  operacoes.forEach(function (op) {
    if (!op || typeof op !== "object" || !RE_OPERACAO.test(String(op.operacaoId || ""))) {
      falhar("dados_invalidos", "Operação sem identificador válido.");
    }
    if (vistos[op.operacaoId]) falhar("dados_invalidos", "Identificador de operação repetido no mesmo pedido.");
    vistos[op.operacaoId] = true;
  });

  return comTrava(function () {
    var conhecidas = operacoesConhecidas(Object.keys(vistos));
    return operacoes.map(function (op) {
      var chave = chaveDaOperacao(ctx.auth, ctx.acao, op);
      var ja = conhecidas[op.operacaoId];
      if (ja) {
        if (ja.chave !== chave) {
          return { operacaoId: op.operacaoId, ok: false,
            erro: erroPublico("operacao_divergente", "Este identificador já foi usado para outra alteração.") };
        }
        if (ja.estado === "aplicada") {
          return copiarResultado(op.operacaoId, ja.resultado, true);
        }
      }
      var plano;
      ctx.operacaoAtual = op.operacaoId;
      try {
        plano = planejar(op);
      } catch (erro) {
        if (!(erro instanceof ErroApp)) throw erro;
        return { operacaoId: op.operacaoId, ok: false, erro: erroPublico(erro.codigo, erro.mensagem, erro.detalhes) };
      }
      if (!plano.escritas || !plano.escritas.length) {
        return copiarResultado(op.operacaoId, plano.resultado || {}, false);
      }
      aplicarComDiario(ctx, op, chave, plano);
      return copiarResultado(op.operacaoId, plano.resultado || {}, false);
    });
  });
}

function copiarResultado(id, resultado, repetida) {
  var r = { operacaoId: id, ok: true };
  Object.keys(resultado || {}).forEach(function (k) { r[k] = resultado[k]; });
  if (repetida) r.repetida = true;
  return r;
}

/* Uma operação isolada (login, lixeira, integração) com a mesma proteção. */
function executarOperacao(ctx, op, planejar) {
  var r = executarOperacoes(ctx, [op], planejar)[0];
  if (!r.ok) throw new ErroApp(r.erro.codigo, r.erro.mensagem, detalhesDoErro(r.erro));
  return r;
}

function detalhesDoErro(erro) {
  var d = {};
  Object.keys(erro).forEach(function (k) {
    if (["codigo", "categoria", "mensagem", "repetivel"].indexOf(k) < 0) d[k] = erro[k];
  });
  return d;
}

function aplicarComDiario(ctx, op, chave, plano) {
  var texto = JSON.stringify({ escritas: plano.escritas });
  var partes = [texto.slice(0, MAX_CELULA), texto.slice(MAX_CELULA, 2 * MAX_CELULA), texto.slice(2 * MAX_CELULA)];
  if (partes[2].length > MAX_CELULA) falhar("dados_invalidos", "Alteração grande demais para uma operação só.");

  var registro = {
    operacaoId: op.operacaoId, chave: chave, autorId: autorDaOperacao(ctx.auth), acao: ctx.acao + ":" + (op.tipo || ""),
    estado: "aplicando", criadoEm: agoraISO(), concluidoEm: null,
    plano: partes[0], plano2: partes[1], plano3: partes[2], resultado: null, pedidoId: ctx.pedidoId || ""
  };
  definirPropriedade("FLORESER_OPS_PENDENTES", op.operacaoId);
  inserir("sis_operacoes", [registro]);

  executarEscritas(plano.escritas, false);

  registro.estado = "aplicada";
  registro.concluidoEm = agoraISO();
  registro.resultado = plano.resultado || {};
  registro.plano = ""; registro.plano2 = ""; registro.plano3 = "";
  atualizar("sis_operacoes", [registro]);
  definirPropriedade("FLORESER_OPS_PENDENTES", null);
  guardarOperacaoNoCache(op.operacaoId, registro);
}

/* ---------------------------------------------------------------------
   Escritas repetíveis
   ---------------------------------------------------------------------
   { t: "gravar",  tabela, registro }   atualiza pela chave, ou insere
   { t: "inserir", tabela, registro }   acrescenta (na recuperação, só se
                                        a chave ainda não existir)
   { t: "remover", tabela, chave }      apaga pela chave, se existir
   Escritas seguidas do mesmo tipo na mesma aba viram uma chamada só. */
function executarEscritas(escritas, emRecuperacao) {
  var i = 0;
  while (i < escritas.length) {
    var e = escritas[i];
    var j = i;
    while (j + 1 < escritas.length && escritas[j + 1].t === e.t && escritas[j + 1].tabela === e.tabela) j++;
    var grupo = escritas.slice(i, j + 1);
    if (e.t === "inserir") {
      var novos = grupo.map(function (g) { return copiaLimpa(g.registro); });
      if (emRecuperacao) novos = novos.filter(function (r) { return !jaExiste(e.tabela, r); });
      inserir(e.tabela, novos);
    } else if (e.t === "gravar") {
      grupo.forEach(function (g) { gravarPorChave(e.tabela, copiaLimpa(g.registro)); });
    } else if (e.t === "remover") {
      var alvo = grupo.map(function (g) { return acharPorChave(e.tabela, g.chave); }).filter(Boolean);
      if (alvo.length) remover(e.tabela, alvo);
    } else {
      throw new Error("escrita desconhecida: " + e.t);
    }
    i = j + 1;
  }
}

function copiaLimpa(r) {
  var c = {};
  Object.keys(r || {}).forEach(function (k) { if (k !== "_linha") c[k] = r[k]; });
  return c;
}

/* Na recuperação, uma inserção pode já ter acontecido antes da queda. */
function jaExiste(nomeTabela, registro) {
  var def = definicaoTabela(nomeTabela);
  if (def.chave.length === 1 && def.grande) {
    return linhasCom(nomeTabela, def.chave[0], registro[def.chave[0]]).length > 0;
  }
  return !!acharPorChave(nomeTabela, def.chave.map(function (k) { return registro[k]; }));
}

/* ---------------------------------------------------------------------
   Recuperação
   --------------------------------------------------------------------- */

function recuperarPendentes() {
  if (!propriedade("FLORESER_OPS_PENDENTES", "")) return 0;
  var pendentes = linhasCom("sis_operacoes", "estado", "aplicando");
  pendentes.forEach(function (r) {
    var plano = null;
    try { plano = JSON.parse(String(r.plano || "") + String(r.plano2 || "") + String(r.plano3 || "")); }
    catch (e) { plano = null; }
    if (!plano || !Array.isArray(plano.escritas)) {
      r.estado = "ilegivel";
      atualizar("sis_operacoes", [r]);
      registrarTecnico("ERROR", "OPERACAO_ILEGIVEL", r.operacaoId + " · plano não pôde ser lido; confira com conferirOperacoes().");
      return;
    }
    executarEscritas(plano.escritas, true);
    esquecerLinhas();
    r.estado = "aplicada";
    r.concluidoEm = agoraISO();
    r.plano = ""; r.plano2 = ""; r.plano3 = "";
    r.resultado = r.resultado || { recuperada: true };
    atualizar("sis_operacoes", [r]);
    registrarTecnico("WARNING", "OPERACAO_RECUPERADA", r.operacaoId + " · " + r.acao);
  });
  definirPropriedade("FLORESER_OPS_PENDENTES", null);
  esquecerLinhas();
  return pendentes.length;
}

/* ---------------------------------------------------------------------
   Revisão por entidade
   --------------------------------------------------------------------- */

/* Confere a revisão de que o cliente partiu. Na diferença, o conflito leva
   o estado atual da entidade — sem ele o navegador só poderia recarregar e
   jogar fora o que a pessoa fez. */
function conferirRevisao(atual, revBase, publicar) {
  var rev = Number(atual && atual.rev) || 0;
  if (Number(revBase) !== rev) {
    falhar("conflito", "Esta ficha mudou em outro aparelho.", { rev: rev, atual: atual ? publicar(atual) : null });
  }
  return rev;
}

function carimbar(registro, rev, ctx, opId) {
  registro.rev = rev;
  registro.opId = opId;
  registro.atualizadoEm = agoraISO();
  registro.atualizadoPor = assinaturaDe(ctx.auth).nome;
  return registro;
}
