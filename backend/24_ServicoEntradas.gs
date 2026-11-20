/* =====================================================================
   24_ServicoEntradas — leitura e operações das Entradas
   ---------------------------------------------------------------------
   Dinheiro é inteiro em centavos aqui dentro e no navegador; na planilha,
   texto decimal com duas casas ("350.00"). Ver textoParaCentavos().

   Quem não administra registra, edita e confere — e não exclui. A tela
   esconde as somas a partir de podeAdministrar, calculado aqui a cada
   leitura. A trava de verdade é esta: entrada.remover de quem não
   administra é recusada e vai para o log de segurança.

   entradas.aplicar — operações:
     entrada.criar    { id, dados: { nome, data, descricao, obs, criadoEm, pagamentos } }
     entrada.alterar  { id, revBase, campos?, pagamentos? }
     entrada.remover  { id, motivo? }    só administrador; vai para a lixeira
   ===================================================================== */

var METODOS_ENTRADA = ["debito", "credito", "pix", "dinheiro", "boleto", "haver"];
var METODOS_NOME = { debito: "Débito", credito: "Crédito", pix: "PIX", dinheiro: "Dinheiro", boleto: "Boleto", haver: "Em haver" };
var CAMPOS_ENTRADA = {
  nome: { tipo: "texto", max: 200 }, data: { tipo: "data" }, descricao: { tipo: "texto", max: 500 },
  obs: { tipo: "texto", max: 4000 }
};
var MAX_CENTAVOS = 100000000000;

function pagamentosDaEntrada(idPag, entradaId) {
  return (idPag[entradaId] || []).slice().sort(function (a, b) { return (Number(a.ordem) || 0) - (Number(b.ordem) || 0); });
}

function entradaPublica(e, idPag) {
  return {
    id: e.id, nome: e.nome || "", data: e.data || "", descricao: e.descricao || "", obs: e.obs || "",
    criadoEm: e.criadoEm || "", origem: e.origem || "",
    pagamentos: pagamentosDaEntrada(idPag, e.id).map(function (p) {
      return { metodo: METODOS_ENTRADA.indexOf(p.metodo) >= 0 ? p.metodo : "pix", valor: Number(p.valor) || 0,
        parcelas: Math.min(12, Math.max(1, Number(p.parcelas) || 1)) };
    }),
    _rev: Number(e.rev) || 0
  };
}

function entradasLer(ctx) {
  return lerComConsistencia(function () {
    var idPag = agrupar(lerTudo("ent_pagamentos"), "entradaId");
    return {
      entradas: lerTudo("ent_entradas").map(function (e) { return entradaPublica(e, idPag); })
        /* entrada sem forma de pagamento não é entrada — como sempre foi */
        .filter(function (e) { return e.pagamentos.length > 0; }),
      podeAdministrar: eAdministrador(ctx.auth)
    };
  });
}

function entradasAplicar(ctx) {
  return { resultados: executarOperacoes(ctx, ctx.dados.operacoes, function (op) { return planejarEntrada(ctx, op); }) };
}

function validarPagamentos(lista) {
  if (!Array.isArray(lista) || !lista.length || lista.length > 12) falhar("dados_invalidos", "Formas de pagamento inválidas.", { campo: "pagamentos" });
  return lista.map(function (p) {
    if (!p || METODOS_ENTRADA.indexOf(String(p.metodo)) < 0) falhar("dados_invalidos", "Forma de pagamento desconhecida.", { campo: "pagamentos" });
    var valor = Number(p.valor);
    if (!Number.isInteger(valor) || valor < 0 || valor > MAX_CENTAVOS) falhar("dados_invalidos", "Valor inválido (centavos inteiros).", { campo: "pagamentos" });
    var parcelas = Number(p.parcelas || 1);
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 12) falhar("dados_invalidos", "Parcelas fora de 1 a 12.", { campo: "pagamentos" });
    return { metodo: String(p.metodo), valor: valor, parcelas: parcelas };
  });
}

function planejarEntrada(ctx, op) {
  var t = String(op.tipo || "");
  if (t === "entrada.remover") {
    if (!eAdministrador(ctx.auth)) {
      registrarTecnico("SECURITY", "EXCLUSAO_NEGADA", assinaturaDe(ctx.auth).nome + " tentou excluir uma entrada sem ser administrador.");
      falhar("sem_permissao", "Só administradores podem excluir entradas.");
    }
    return planejarMoverParaLixeira(ctx, "entradas", idValido(op.id), String(op.motivo || ""));
  }
  if (t !== "entrada.criar" && t !== "entrada.alterar") falhar("dados_invalidos", "Operação desconhecida nas Entradas: " + t + ".");

  var criar = t === "entrada.criar";
  var id = idValido(op.id, "entrada");
  var atual = acharPorChave("ent_entradas", id);
  var idPag = agrupar(lerTudo("ent_pagamentos"), "entradaId");
  var antes = null;
  if (criar) {
    if (atual) falhar("conflito", "Já existe uma entrada com este identificador.", { rev: atual.rev, atual: entradaPublica(atual, idPag) });
    if (itensDaLixeira("entradas", id).length) falhar("na_lixeira", "Esta entrada foi para a lixeira em outro aparelho.");
  } else {
    if (!atual) falhar("conflito", "Esta entrada não existe mais.", { rev: 0, atual: null, removida: true });
    conferirRevisao(atual, op.revBase, function (r) { return entradaPublica(r, idPag); });
    antes = entradaPublica(atual, idPag);
  }

  var fonte = criar ? (op.dados || {}) : (op.campos || {});
  var entrada = {};
  Object.keys(CAMPOS_ENTRADA).forEach(function (k) { if (fonte[k] !== undefined) entrada[k] = fonte[k]; });
  var campos = validarCampos(entrada, CAMPOS_ENTRADA, "entrada");
  var depois = antes ? JSON.parse(JSON.stringify(antes)) : { id: id, nome: "", data: hojeNaClinica(), descricao: "", obs: "", criadoEm: agoraISO(), pagamentos: [] };
  Object.keys(campos).forEach(function (k) { depois[k] = campos[k] === null ? "" : campos[k]; });
  if (criar && fonte.criadoEm) {
    var c = new Date(fonte.criadoEm);
    if (!isNaN(c.getTime())) depois.criadoEm = c.toISOString();
  }
  if (!dataValida(depois.data)) falhar("dados_invalidos", "A entrada precisa de uma data.", { campo: "data" });
  var pags = criar ? fonte.pagamentos : op.pagamentos;
  if (pags !== undefined) depois.pagamentos = validarPagamentos(pags);
  if (criar && !depois.pagamentos.length) falhar("dados_invalidos", "A entrada precisa de uma forma de pagamento.", { campo: "pagamentos" });

  /* pagamentos: a posição continua com o mesmo id; o que sobra sai */
  var escritas = [];
  var existentes = pagamentosDaEntrada(idPag, id);
  if (pags !== undefined) {
    depois.pagamentos.forEach(function (p, i) {
      var e = existentes[i];
      var linha = { id: e ? e.id : novoId("pg"), entradaId: id, ordem: i, metodo: p.metodo, valor: p.valor, parcelas: p.parcelas };
      if (!e || e.metodo !== p.metodo || Number(e.valor) !== p.valor || Number(e.parcelas) !== p.parcelas || Number(e.ordem) !== i) {
        escritas.push({ t: e ? "gravar" : "inserir", tabela: "ent_pagamentos", registro: linha });
      }
    });
    existentes.slice(depois.pagamentos.length).forEach(function (e) { escritas.push({ t: "remover", tabela: "ent_pagamentos", chave: [e.id] }); });
  }

  var mudouRaiz = !antes || Object.keys(CAMPOS_ENTRADA).some(function (k) { return !mesmoValor(antes[k], depois[k]); });
  if (!escritas.length && !mudouRaiz) return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0, entidade: antes } };

  escritas = escritas.concat(escritasDeAuditoria(ctx, eventosEntrada(antes, depois), op.operacaoId));
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var raiz = registroCompleto("ent_entradas", { id: id, nome: depois.nome, data: depois.data, descricao: depois.descricao,
    obs: depois.obs, criadoEm: depois.criadoEm }, atual);
  carimbar(raiz, rev, ctx, op.operacaoId);
  escritas.push({ t: "gravar", tabela: "ent_entradas", registro: raiz });
  depois._rev = rev;
  return { escritas: escritas, resultado: { id: id, rev: rev, entidade: depois } };
}

/* ---- auditoria: valor e forma de pagamento são perguntas diferentes ---- */

function totalPagamentos(pags) {
  return (pags || []).reduce(function (t, p) { return t + (Number(p.valor) || 0); }, 0);
}

function resumoPagamentos(pags) {
  var lista = (pags || []).filter(Boolean);
  if (!lista.length) return "—";
  return lista.map(function (p) {
    var parc = Number(p.parcelas) || 1;
    return (METODOS_NOME[p.metodo] || p.metodo) + (parc > 1 ? " " + parc + "x" : "") + " " + dinheiroBR(p.valor);
  }).join(" + ");
}

function eventosEntrada(antes, depois) {
  var id = depois.id, ev = [];
  var E = function (acao, campo, a, b) { ev.push(evento("entradas", "entrada", id, acao, campo, a, b)); };
  if (!antes) {
    E("criou", "", "", ouTraco(depois.nome));
    E("criou_detalhe", "Valor", "", dinheiroBR(totalPagamentos(depois.pagamentos)));
    E("criou_detalhe", "Pagamento", "", resumoPagamentos(depois.pagamentos));
    return ev;
  }
  [{ k: "nome", r: "Nome" }, { k: "data", r: "Data", d: true }, { k: "descricao", r: "Procedimento" }, { k: "obs", r: "Observação" }]
    .forEach(function (def) {
      if (mesmoValor(antes[def.k], depois[def.k])) return;
      E("alterou", def.r, def.d ? dataBR(antes[def.k]) : ouTraco(antes[def.k]), def.d ? dataBR(depois[def.k]) : ouTraco(depois[def.k]));
    });
  var ta = totalPagamentos(antes.pagamentos), tb = totalPagamentos(depois.pagamentos);
  if (ta !== tb) E("alterou", "Valor", dinheiroBR(ta), dinheiroBR(tb));
  var fa = resumoPagamentos(antes.pagamentos), fb = resumoPagamentos(depois.pagamentos);
  if (fa !== fb) E("alterou", "Forma de pagamento", fa, fb);
  return ev;
}
