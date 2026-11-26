/* =====================================================================
   31_ServicoFinanceiro — leitura e operações do Financeiro
   ---------------------------------------------------------------------
   Só contas com a permissão "financeiro" (ou administradoras). Não existe
   senha compartilhada do Financeiro, e ter as Entradas não dá Financeiro.

   financeiro.ler       cadastros, despesas (com estado), pagamentos,
                        grupos, orçamentos, saldos, materiais e fichas
   financeiro.resumo    caixa · competência · previsão do período, com
                        comparação no período anterior equivalente
   financeiro.simular   preço com desconto/forma de pagamento — não grava
   financeiro.aplicar   operações, cada uma sobre UMA entidade raiz:
     categoria.salvar  fornecedor.salvar  insumo.salvar  saldo.definir
     orcamento.definir
     despesa.criar     { id, dados, parcelamento?: { quantidade, primeiroVencimento, frequencia } }
     despesa.alterar   { id, revBase, campos }
     despesa.cancelar  { id, revBase, motivo }      despesa.reativar { id, revBase }
     pagamento.registrar { despesaId, revBase, dados: { id, data, valor, meio, conta, evidencia, notas } }
     pagamento.estornar  { despesaId, revBase, movimentoId, dados: { id, data, notas } }
     recorrencia.criar   { id, dados: { modelo..., frequencia, inicio, fim?, quantidade? }, gerarAte? }
     recorrencia.gerar   { id, revBase, ate }
     recorrencia.alterar { id, revBase, aPartirDe, campos }   "esta e as seguintes"
     recorrencia.encerrar { id, revBase, fim }
     ficha.salvar  { id, revBase, dados }     ficha.aprovar { id, revBase }

   Pagar é sempre uma ação explícita: nenhuma regra marca pagamento por
   data, por recorrência ou por previsão.
   ===================================================================== */

var MESES_GERADOS_ADIANTE = 3;

var CAMPOS_DESPESA = {
  descricao: { tipo: "texto", max: 300 }, categoriaId: { tipo: "texto", max: 80 }, fornecedorId: { tipo: "texto", max: 80 },
  valor: { tipo: "dinheiro" }, competencia: { tipo: "mes" }, vencimento: { tipo: "data" }, meio: { tipo: "texto", max: 60 },
  conta: { tipo: "texto", max: 80 }, area: { tipo: "texto", max: 80 }, notas: { tipo: "texto", max: 4000 }
};
var CAMPOS_MOVIMENTO = {
  data: { tipo: "data" }, valor: { tipo: "dinheiro" }, meio: { tipo: "texto", max: 60 }, conta: { tipo: "texto", max: 80 },
  evidencia: { tipo: "texto", max: 500 }, notas: { tipo: "texto", max: 2000 }
};
var CAMPOS_CATEGORIA_FIN = { nome: { tipo: "texto", max: 80 }, paiId: { tipo: "texto", max: 80 }, ativa: { tipo: "booleano" }, ordem: { tipo: "inteiro" } };
var CAMPOS_FORNECEDOR = { nome: { tipo: "texto", max: 160 }, documento: { tipo: "texto", max: 40 }, contato: { tipo: "texto", max: 200 },
  notas: { tipo: "texto", max: 2000 }, ativo: { tipo: "booleano" } };
var CAMPOS_INSUMO = { nome: { tipo: "texto", max: 160 }, unidadeCompra: { tipo: "texto", max: 40 }, conteudo: { tipo: "decimal" },
  unidadeConteudo: { tipo: "unidade" }, valorEmbalagem: { tipo: "dinheiro" }, rendimento: { tipo: "decimal" },
  perdaPct: { tipo: "decimal" }, notas: { tipo: "texto", max: 2000 }, ativo: { tipo: "booleano" } };
var CAMPOS_SALDO = { conta: { tipo: "texto", max: 80 }, data: { tipo: "data" }, valor: { tipo: "dinheiro", negativo: true }, notas: { tipo: "texto", max: 1000 } };
var CAMPOS_FICHA = { tipo: { tipo: "texto", max: 20 }, nome: { tipo: "texto", max: 160 }, precoAtual: { tipo: "dinheiro" },
  dados: { tipo: "json" }, clinicorpProcedimentoId: { tipo: "texto", max: 40 }, arquivada: { tipo: "booleano" } };
var TIPOS_FICHA = ["procedimento", "produto", "pacote"];

/* validarCampos (20) com os tipos daqui: dinheiro, mês, decimal, json */
function validarCamposFin(campos, regras, onde) {
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) falhar("dados_invalidos", "Campos ausentes em " + onde + ".");
  var simples = {}, saida = {};
  Object.keys(campos).forEach(function (k) {
    var r = regras[k];
    if (!r) falhar("dados_invalidos", "Campo não permitido: " + k + ".", { campo: k });
    var v = campos[k];
    var vazioV = v === "" || v === null || v === undefined;
    if (r.tipo === "dinheiro") {
      if (vazioV) { saida[k] = null; return; }
      var n = Number(v);
      if (!Number.isInteger(n) || Math.abs(n) > MAX_CENTAVOS || (n < 0 && !r.negativo)) falhar("dados_invalidos", "Valor inválido em " + k + " (centavos inteiros).", { campo: k });
      saida[k] = n;
    } else if (r.tipo === "mes") {
      if (vazioV) { saida[k] = ""; return; }
      if (!mesValido(String(v))) falhar("dados_invalidos", "Mês inválido em " + k + " (AAAA-MM).", { campo: k });
      saida[k] = String(v);
    } else if (r.tipo === "decimal") {
      if (vazioV) { saida[k] = ""; return; }
      var dnum = lerDecimal(v);
      if (dnum === null || dnum < 0) falhar("dados_invalidos", "Número inválido em " + k + ".", { campo: k });
      saida[k] = String(v).trim().replace(",", ".");
    } else if (r.tipo === "unidade") {
      if (vazioV) { saida[k] = ""; return; }
      if (!FIN_UNIDADES[String(v)]) falhar("dados_invalidos", "Unidade desconhecida.", { campo: k });
      saida[k] = String(v);
    } else if (r.tipo === "json") {
      if (vazioV) { saida[k] = null; return; }
      if (typeof v !== "object") falhar("dados_invalidos", "Formato inválido em " + k + ".", { campo: k });
      if (JSON.stringify(v).length > 40000) falhar("dados_invalidos", "Conteúdo grande demais em " + k + ".", { campo: k });
      saida[k] = v;
    } else {
      simples[k] = v;
    }
  });
  var basicos = Object.keys(simples).length ? validarCampos(simples, regras, onde) : {};
  Object.keys(basicos).forEach(function (k) { saida[k] = basicos[k]; });
  return saida;
}

/* ---------------------------------------------------------------------
   Leitura
   --------------------------------------------------------------------- */

function publicoDe(nomeTabela, r) {
  var o = {};
  camposDeNegocio(nomeTabela).forEach(function (k) { o[k] = r[k] === undefined || r[k] === null ? (ESQUEMA[nomeTabela].campos.join().indexOf(k + ":dinheiro") >= 0 ? null : "") : r[k]; });
  o._rev = Number(r.rev) || 0;
  return o;
}

function movimentoPublico(m) {
  return { id: m.id, despesaId: m.despesaId, tipo: m.tipo, data: m.data || "", valor: Number(m.valor) || 0, meio: m.meio || "",
    conta: m.conta || "", evidencia: m.evidencia || "", notas: m.notas || "", estornaId: m.estornaId || "",
    criadoEm: m.criadoEm || "", autorNome: m.autorNome || "" };
}

function despesaPublica(d, movs, hoje) {
  var o = publicoDe("fin_despesas", d);
  o.cancelada = d.cancelada === true;
  var est = estadoDaDespesa(d, movs, hoje);
  o._estado = est.estado; o._pago = est.pago; o._saldo = est.saldo; o._vencida = est.vencida;
  return o;
}

function lerFinanceiroCru() {
  return {
    categorias: lerTudo("fin_categorias"), fornecedores: lerTudo("fin_fornecedores"),
    despesas: lerTudo("fin_despesas"), movimentos: lerTudo("fin_movimentos"), grupos: lerTudo("fin_grupos"),
    orcamentos: lerTudo("fin_orcamentos"), saldos: lerTudo("fin_saldos"), insumos: lerTudo("fin_insumos"),
    fichas: lerTudo("fin_fichas")
  };
}

function mapaPorId(lista) { var m = {}; (lista || []).forEach(function (r) { m[r.id] = r; }); return m; }

function financeiroLer(ctx) {
  return lerComConsistencia(function () {
    var hoje = hojeNaClinica();
    var c = lerFinanceiroCru();
    var movPor = agrupar(c.movimentos, "despesaId");
    var insumos = mapaPorId(c.insumos), fichas = mapaPorId(c.fichas);
    var categorias = c.categorias.length ? c.categorias.map(function (r) { return publicoDe("fin_categorias", r); }) : categoriasPadrao();
    return {
      hoje: hoje,
      categorias: categorias,
      fornecedores: c.fornecedores.map(function (r) { return publicoDe("fin_fornecedores", r); }),
      despesas: c.despesas.map(function (d) { return despesaPublica(d, movPor[d.id], hoje); }),
      movimentos: c.movimentos.map(movimentoPublico),
      grupos: c.grupos.map(function (g) { var o = publicoDe("fin_grupos", g); o.encerrado = g.encerrado === true; return o; }),
      orcamentos: c.orcamentos.map(function (r) { return publicoDe("fin_orcamentos", r); }),
      saldos: c.saldos.map(function (r) { return publicoDe("fin_saldos", r); }),
      insumos: c.insumos.map(function (r) { var o = publicoDe("fin_insumos", r); o.ativo = r.ativo !== false; return o; }),
      fichas: c.fichas.map(function (f) {
        var o = publicoDe("fin_fichas", f);
        o.arquivada = f.arquivada === true;
        o._calculo = calcularFicha(f, insumos, fichas);
        return o;
      }),
      versoes: lerTudo("fin_fichas_versoes").map(function (v) {
        return { id: v.id, fichaId: v.fichaId, versao: v.versao, aprovadaEm: v.aprovadaEm, aprovadaPor: v.aprovadaPor,
          precoSugerido: v.resultado && v.resultado.precoSugerido, custoTotal: v.resultado && v.resultado.custoTotal };
      }),
      frequencias: Object.keys(FIN_FREQUENCIAS).map(function (k) { return { id: k, nome: FIN_FREQUENCIAS[k].nome }; }),
      unidades: Object.keys(FIN_UNIDADES),
      integracao: resumoDaIntegracaoParaModulo("financeiro"),
      /* catálogo do Clinicorp, se foi consultado: ajuda opcional, só nomes */
      catalogo: lerTudo("int_externos").filter(function (x) { return x.tipo === "procedimento" && x.dados; })
        .slice(0, 500).map(function (x) { return { id: x.externoId, nome: x.dados.nome, especialidade: x.dados.especialidade || "" }; }),
      podeAdministrar: eAdministrador(ctx.auth)
    };
  });
}

/* Antes da primeira gravação de categoria, a lista padrão aparece como
   sugestão — e passa a existir de verdade quando for gravada. */
function categoriasPadrao() {
  return FIN_CATEGORIAS_PADRAO.map(function (c, i) {
    return { id: c[0], nome: c[1], paiId: "", ativa: true, ordem: i, _rev: 0, _padrao: true };
  });
}

function financeiroResumo(ctx) {
  return lerComConsistencia(function () {
    var hoje = hojeNaClinica();
    var c = lerFinanceiroCru();
    var idPag = agrupar(lerTudo("ent_pagamentos"), "entradaId");
    var entradas = lerTudo("ent_entradas").map(function (e) {
      return { data: e.data, origem: e.origem || "manual", estornada: e.externoEstado === "estornado", pagamentos: (idPag[e.id] || []).map(function (p) { return { metodo: p.metodo, valor: Number(p.valor) || 0 }; }) };
    });
    var base = { despesas: c.despesas, movimentos: c.movimentos, grupos: c.grupos, orcamentos: c.orcamentos,
      saldos: c.saldos, entradas: entradas };
    var f = ctx.dados.filtros || {};
    var atual = resumirFinanceiro(base, f, hoje);
    var ant = periodoAnterior(atual.periodo.de, atual.periodo.ate);
    var anterior = resumirFinanceiro(base, Object.assign({}, f, ant), hoje);
    /* evolução: 12 meses até o fim do período, mesma base */
    var de12 = finSomarMesesAoMes(atual.periodo.ate, -11);
    var evolucao = resumirFinanceiro(base, Object.assign({}, f, { de: de12, ate: atual.periodo.ate }), hoje).porMes;
    return {
      hoje: hoje, atual: atual, evolucao: evolucao,
      anterior: { periodo: anterior.periodo, caixa: anterior.caixa, competencia: anterior.competencia,
        previsao: anterior.previsao, entradas: anterior.entradas.recebido, porCategoria: anterior.porCategoria },
      clinicorp: contextoClinicorpFinanceiro(atual.periodo)
    };
  });
}

function financeiroSimular(ctx) {
  return lerComConsistencia(function () {
    var d = ctx.dados;
    var insumos = mapaPorId(lerTudo("fin_insumos")), fichas = mapaPorId(lerTudo("fin_fichas"));
    var ficha;
    if (d.ficha && typeof d.ficha === "object") {
      var campos = validarCamposFin({ tipo: d.ficha.tipo, nome: d.ficha.nome || "simulação", precoAtual: d.ficha.precoAtual, dados: d.ficha.dados || {} }, CAMPOS_FICHA, "ficha");
      ficha = { id: String(d.ficha.id || "simulacao"), tipo: campos.tipo, nome: campos.nome, precoAtual: campos.precoAtual, dados: campos.dados || {} };
      if (TIPOS_FICHA.indexOf(ficha.tipo) < 0) falhar("dados_invalidos", "Tipo de ficha desconhecido.");
    } else {
      ficha = fichas[String(d.fichaId || "")];
      if (!ficha) falhar("nao_encontrado", "Ficha não encontrada.");
    }
    return simularPreco(ficha, insumos, fichas, d.simulacao || {});
  });
}

/* ---------------------------------------------------------------------
   Operações
   --------------------------------------------------------------------- */

function financeiroAplicar(ctx) {
  return { resultados: executarOperacoes(ctx, ctx.dados.operacoes, function (op) { return planejarFinanceiro(ctx, op); }) };
}

function planejarFinanceiro(ctx, op) {
  switch (op.tipo) {
    case "categoria.salvar": return planejarCadastro(ctx, op, "fin_categorias", CAMPOS_CATEGORIA_FIN, "categoria", function (r) {
      if (!String(r.nome || "").trim()) falhar("dados_invalidos", "A categoria precisa de um nome.", { campo: "nome" });
      if (r.paiId && r.paiId === r.id) falhar("dados_invalidos", "Uma categoria não pode ser subcategoria dela mesma.");
      if (r.ativa === null || r.ativa === undefined) r.ativa = true;
    });
    case "fornecedor.salvar": return planejarCadastro(ctx, op, "fin_fornecedores", CAMPOS_FORNECEDOR, "fornecedor", function (r) {
      if (!String(r.nome || "").trim()) falhar("dados_invalidos", "O fornecedor precisa de um nome.", { campo: "nome" });
      if (r.ativo === null || r.ativo === undefined) r.ativo = true;
    });
    case "insumo.salvar": return planejarCadastro(ctx, op, "fin_insumos", CAMPOS_INSUMO, "material", function (r) {
      if (!String(r.nome || "").trim()) falhar("dados_invalidos", "O material precisa de um nome.", { campo: "nome" });
      if (r.perdaPct && lerDecimal(r.perdaPct) >= 100) falhar("dados_invalidos", "Perda precisa ficar abaixo de 100%.", { campo: "perdaPct" });
      if (r.ativo === null || r.ativo === undefined) r.ativo = true;
    });
    case "saldo.definir": return planejarCadastro(ctx, op, "fin_saldos", CAMPOS_SALDO, "saldo inicial", function (r) {
      if (!dataValida(r.data)) falhar("dados_invalidos", "O saldo inicial precisa da data.", { campo: "data" });
      if (r.valor === null || r.valor === undefined) falhar("dados_invalidos", "Informe o valor do saldo.", { campo: "valor" });
      if (!String(r.conta || "").trim()) falhar("dados_invalidos", "Informe a conta.", { campo: "conta" });
    });
    case "orcamento.definir": return planejarOrcamento(ctx, op);
    case "despesa.criar": return planejarCriarDespesa(ctx, op);
    case "despesa.alterar": return planejarAlterarDespesa(ctx, op);
    case "despesa.cancelar": return planejarCancelarDespesa(ctx, op, true);
    case "despesa.reativar": return planejarCancelarDespesa(ctx, op, false);
    case "pagamento.registrar": return planejarPagamento(ctx, op);
    case "pagamento.estornar": return planejarEstorno(ctx, op);
    case "recorrencia.criar": return planejarCriarRecorrencia(ctx, op);
    case "recorrencia.gerar": return planejarGerarRecorrencia(ctx, op);
    case "recorrencia.alterar": return planejarAlterarRecorrencia(ctx, op);
    case "recorrencia.encerrar": return planejarEncerrarRecorrencia(ctx, op);
    case "ficha.salvar": return planejarFicha(ctx, op);
    case "ficha.aprovar": return planejarAprovarFicha(ctx, op);
    case "estoque.item.salvar": return planejarItemEstoque(ctx, op);
    case "estoque.movimento": return planejarMovimentoEstoque(ctx, op);
    case "estoque.usarNaPrecificacao": return planejarUsarNaPrecificacao(ctx, op);
    case "estoque.voltarAoRetrato": return planejarVoltarAoRetrato(ctx, op);
    case "venda.salvar": return planejarVenda(ctx, op);
    case "venda.confirmarSaida": return planejarConfirmarSaida(ctx, op);
    case "venda.cancelar": return planejarCancelarVenda(ctx, op);
    case "venda.devolver": return planejarDevolucao(ctx, op);
    case "exe.orcamento.salvar": return planejarOrcamentoLocal(ctx, op);
    case "exe.registrar": return planejarExecucao(ctx, op);
    case "exe.alterar": return planejarAlterarExecucao(ctx, op);
    case "exe.atendimento.confirmar": return planejarConfirmarAtendimento(ctx, op);
    case "exe.atendimento.salvar": return planejarAtendimento(ctx, op);
    case "exe.troca.registrar": return planejarTroca(ctx, op);
    case "exe.troca.desfazer": return planejarDesfazerTroca(ctx, op);
    case "exe.credito.usar": return planejarUsarCredito(ctx, op);
    case "exe.credito.estornar": return planejarEstornarCredito(ctx, op);
    case "exe.conferencia": return planejarConferencia(ctx, op);
    case "exe.paciente.vincular": return planejarVinculoDePaciente(ctx, op, false);
    case "exe.paciente.recusar": return planejarVinculoDePaciente(ctx, op, true);
  }
  falhar("dados_invalidos", "Operação desconhecida no Financeiro: " + op.tipo + ".");
}

/* Cadastro simples: cria (revBase 0 ou ausente e id novo) ou altera. */
function planejarCadastro(ctx, op, nomeTabela, regras, rotulo, conferir) {
  var id = idValido(op.id, rotulo);
  var atual = acharPorChave(nomeTabela, id);
  var campos = validarCamposFin(op.dados || op.campos || {}, regras, rotulo);
  if (atual) conferirRevisao(atual, op.revBase, function (r) { return publicoDe(nomeTabela, r); });
  else if (Number(op.revBase || 0) !== 0) falhar("conflito", "Este cadastro não existe mais.", { rev: 0, atual: null, removida: true });
  var antes = atual ? publicoDe(nomeTabela, atual) : null;
  var valores = { id: id };
  camposDeNegocio(nomeTabela).forEach(function (k) { if (atual) valores[k] = atual[k]; });
  Object.keys(campos).forEach(function (k) { valores[k] = campos[k]; });
  conferir(valores);
  var mudou = !antes || Object.keys(campos).some(function (k) { return !mesmoValor(antes[k], valores[k]); });
  if (!mudou) return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0, entidade: antes } };
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var reg = carimbar(registroCompleto(nomeTabela, valores, atual), rev, ctx, op.operacaoId);
  var ev = [evento("financeiro", rotulo, id, antes ? "alterou" : "criou", antes ? "Cadastro" : "", antes ? "" : "", String(valores.nome || valores.conta || id))];
  return { escritas: [{ t: "gravar", tabela: nomeTabela, registro: reg }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, entidade: publicoDe(nomeTabela, reg) } };
}

function planejarOrcamento(ctx, op) {
  var mes = String(op.mes || ""), cat = idValido(op.categoriaId, "orçamento");
  if (!mesValido(mes)) falhar("dados_invalidos", "Mês inválido (AAAA-MM).", { campo: "mes" });
  var id = cat + "@" + mes;
  var atual = acharPorChave("fin_orcamentos", id);
  if (atual) conferirRevisao(atual, op.revBase, function (r) { return publicoDe("fin_orcamentos", r); });
  var valor = op.valor === null || op.valor === "" || op.valor === undefined ? null : Number(op.valor);
  if (valor !== null && (!Number.isInteger(valor) || valor < 0 || valor > MAX_CENTAVOS)) falhar("dados_invalidos", "Valor inválido.", { campo: "valor" });
  var alerta = op.alertaPct === undefined || op.alertaPct === null || op.alertaPct === "" ? 90 : Number(op.alertaPct);
  if (!Number.isInteger(alerta) || alerta < 1 || alerta > 200) falhar("dados_invalidos", "Alerta entre 1% e 200%.", { campo: "alertaPct" });
  if (valor === null) {
    if (!atual) return { escritas: [], resultado: { id: id, rev: 0, entidade: null } };
    return { escritas: [{ t: "remover", tabela: "fin_orcamentos", chave: [id] }].concat(escritasDeAuditoria(ctx,
      [evento("financeiro", "orcamento", id, "removeu", mes, dinheiroBR(atual.valor), "")], op.operacaoId)), resultado: { id: id, rev: 0, entidade: null } };
  }
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var reg = carimbar(registroCompleto("fin_orcamentos", { id: id, categoriaId: cat, mes: mes, valor: valor, alertaPct: alerta }, atual), rev, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "fin_orcamentos", registro: reg }].concat(escritasDeAuditoria(ctx,
    [evento("financeiro", "orcamento", id, atual ? "alterou" : "criou", mes, atual ? dinheiroBR(atual.valor) : "", dinheiroBR(valor))], op.operacaoId)),
    resultado: { id: id, rev: rev, entidade: publicoDe("fin_orcamentos", reg) } };
}

/* ---- despesas ---- */

function conferirDespesa(d) {
  if (!String(d.descricao || "").trim()) falhar("dados_invalidos", "A despesa precisa de uma descrição.", { campo: "descricao" });
  if (d.valor === null || d.valor === undefined || d.valor <= 0) falhar("dados_invalidos", "Informe o valor da despesa.", { campo: "valor" });
  if (!dataValida(d.vencimento)) falhar("dados_invalidos", "Informe o vencimento.", { campo: "vencimento" });
  if (!mesValido(d.competencia)) d.competencia = competenciaDe(d.vencimento);
}

function eventosDespesa(antes, depois) {
  var id = depois.id, ev = [];
  if (!antes) {
    ev.push(evento("financeiro", "despesa", id, "criou", "", "", depois.descricao));
    ev.push(evento("financeiro", "despesa", id, "criou_detalhe", "Valor", "", dinheiroBR(depois.valor)));
    ev.push(evento("financeiro", "despesa", id, "criou_detalhe", "Vencimento", "", dataBR(depois.vencimento)));
    return ev;
  }
  [{ k: "descricao", r: "Descrição" }, { k: "valor", r: "Valor", m: true }, { k: "vencimento", r: "Vencimento", d: true },
    { k: "competencia", r: "Competência" }, { k: "categoriaId", r: "Categoria" }, { k: "fornecedorId", r: "Fornecedor" },
    { k: "meio", r: "Meio" }, { k: "conta", r: "Conta" }, { k: "area", r: "Área" }, { k: "notas", r: "Notas" }].forEach(function (c) {
    if (mesmoValor(antes[c.k], depois[c.k])) return;
    var f = c.m ? dinheiroBR : c.d ? dataBR : ouTraco;
    ev.push(evento("financeiro", "despesa", id, "alterou", c.r, f(antes[c.k]), f(depois[c.k])));
  });
  return ev;
}

function novaDespesaRegistro(ctx, opId, valores, atual, rev) {
  return carimbar(registroCompleto("fin_despesas", valores, atual), rev, ctx, opId);
}

function planejarCriarDespesa(ctx, op) {
  var id = idValido(op.id, "despesa");
  if (acharPorChave("fin_despesas", id) || acharPorChave("fin_grupos", id)) {
    var ja = acharPorChave("fin_despesas", id);
    falhar("conflito", "Já existe uma despesa com este identificador.", { rev: ja ? ja.rev : 0, atual: ja ? despesaPublica(ja, [], hojeNaClinica()) : null });
  }
  var campos = validarCamposFin(op.dados || {}, CAMPOS_DESPESA, "despesa");
  var base = { id: id, origem: "manual", cancelada: false, criadoEm: agoraISO() };
  Object.keys(campos).forEach(function (k) { base[k] = campos[k]; });
  conferirDespesa(base);
  var hoje = hojeNaClinica();
  var p = op.parcelamento;
  if (!p) {
    var reg = novaDespesaRegistro(ctx, op.operacaoId, base, null, 1);
    return { escritas: [{ t: "gravar", tabela: "fin_despesas", registro: reg }].concat(escritasDeAuditoria(ctx, eventosDespesa(null, base), op.operacaoId)),
      resultado: { id: id, rev: 1, entidade: despesaPublica(reg, [], hoje) } };
  }
  /* parcelamento: um grupo (com o id pedido) e uma despesa por parcela */
  var qtd = Number(p.quantidade);
  var primeiro = String(p.primeiroVencimento || base.vencimento);
  var freq = String(p.frequencia || "mensal");
  if (!FIN_FREQUENCIAS[freq]) falhar("dados_invalidos", "Frequência desconhecida.", { campo: "frequencia" });
  if (!Number.isInteger(qtd) || qtd < 2 || qtd > FIN_MAX_PARCELAS) falhar("dados_invalidos", "Parcelas: de 2 a " + FIN_MAX_PARCELAS + ".", { campo: "parcelas" });
  if (!dataValida(primeiro)) falhar("dados_invalidos", "Primeiro vencimento inválido.", { campo: "vencimento" });
  var plano = planoDeParcelas(base.valor, qtd, primeiro, freq);
  var competenciaFixa = p.competenciaDaCompra === true ? base.competencia : "";
  var escritas = [], entidades = [];
  plano.forEach(function (parc) {
    var pid = id + "-" + parc.sequencia;
    var v = {};
    Object.keys(base).forEach(function (k) { v[k] = base[k]; });
    v.id = pid; v.valor = parc.valor; v.vencimento = parc.vencimento;
    v.competencia = competenciaFixa || competenciaDe(parc.vencimento);
    v.descricao = base.descricao + " (" + parc.sequencia + "/" + qtd + ")";
    v.grupoId = id; v.grupoTipo = "parcelamento"; v.sequencia = parc.sequencia; v.totalSequencia = qtd;
    var reg = novaDespesaRegistro(ctx, op.operacaoId, v, null, 1);
    escritas.push({ t: "gravar", tabela: "fin_despesas", registro: reg });
    entidades.push(despesaPublica(reg, [], hoje));
  });
  var grupo = carimbar(registroCompleto("fin_grupos", { id: id, tipo: "parcelamento", descricao: base.descricao, valorTotal: base.valor,
    quantidade: qtd, frequencia: freq, inicio: primeiro, fim: plano[plano.length - 1].vencimento, modelo: { categoriaId: base.categoriaId || "",
    fornecedorId: base.fornecedorId || "", meio: base.meio || "", conta: base.conta || "", area: base.area || "" },
    geradoAte: plano[plano.length - 1].vencimento, encerrado: false }, null), 1, ctx, op.operacaoId);
  escritas.push({ t: "gravar", tabela: "fin_grupos", registro: grupo });
  escritas = escritas.concat(escritasDeAuditoria(ctx, [
    evento("financeiro", "despesa", id, "criou", "Parcelamento", "", base.descricao + " — " + dinheiroBR(base.valor) + " em " + qtd + "x")
  ], op.operacaoId));
  return { escritas: escritas, resultado: { id: id, rev: 1, grupo: publicoDe("fin_grupos", grupo), entidades: entidades } };
}

function despesaAtual(id) {
  var atual = acharPorChave("fin_despesas", id);
  if (!atual) falhar("conflito", "Esta despesa não existe mais.", { rev: 0, atual: null, removida: true });
  return atual;
}

function movimentosDe(despesaId) { return filtrar("fin_movimentos", "despesaId", despesaId); }

function planejarAlterarDespesa(ctx, op) {
  var id = idValido(op.id, "despesa");
  var atual = despesaAtual(id);
  var movs = movimentosDe(id), hoje = hojeNaClinica();
  conferirRevisao(atual, op.revBase, function (r) { return despesaPublica(r, movs, hoje); });
  var campos = validarCamposFin(op.campos || {}, CAMPOS_DESPESA, "despesa");
  var antes = publicoDe("fin_despesas", atual);
  var depois = {};
  Object.keys(antes).forEach(function (k) { depois[k] = antes[k]; });
  Object.keys(campos).forEach(function (k) { depois[k] = campos[k]; });
  depois.id = id;
  conferirDespesa(depois);
  var pago = totalPago(movs);
  if (depois.valor < pago) falhar("dados_invalidos", "O valor não pode ficar abaixo do que já foi pago (" + dinheiroBR(pago) + "). Estorne um pagamento antes.", { campo: "valor" });
  var ev = eventosDespesa(antes, depois);
  if (!ev.length) return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0, entidade: despesaPublica(atual, movs, hoje) } };
  var rev = (Number(atual.rev) || 0) + 1;
  var reg = novaDespesaRegistro(ctx, op.operacaoId, depois, atual, rev);
  return { escritas: [{ t: "gravar", tabela: "fin_despesas", registro: reg }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, entidade: despesaPublica(reg, movs, hoje) } };
}

function planejarCancelarDespesa(ctx, op, cancelar) {
  var id = idValido(op.id, "despesa");
  var atual = despesaAtual(id);
  var movs = movimentosDe(id), hoje = hojeNaClinica();
  conferirRevisao(atual, op.revBase, function (r) { return despesaPublica(r, movs, hoje); });
  if ((atual.cancelada === true) === cancelar) return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0, entidade: despesaPublica(atual, movs, hoje) } };
  if (cancelar && totalPago(movs) > 0) falhar("dados_invalidos", "Esta despesa tem pagamento registrado. Estorne os pagamentos antes de cancelar.");
  var motivo = String(op.motivo || "").slice(0, 500);
  var rev = (Number(atual.rev) || 0) + 1;
  var reg = novaDespesaRegistro(ctx, op.operacaoId, { cancelada: cancelar, canceladaEm: cancelar ? agoraISO() : null,
    motivoCancelamento: cancelar ? motivo : "" }, atual, rev);
  var ev = [evento("financeiro", "despesa", id, cancelar ? "cancelou" : "reativou", "Situação", cancelar ? "ativa" : "cancelada", cancelar ? "cancelada" : "ativa", motivo)];
  return { escritas: [{ t: "gravar", tabela: "fin_despesas", registro: reg }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, entidade: despesaPublica(reg, movs, hoje) } };
}

/* ---- pagamentos: só crescem; correção é estorno + novo pagamento ---- */

function planejarPagamento(ctx, op) {
  var id = idValido(op.despesaId, "despesa");
  var atual = despesaAtual(id);
  var movs = movimentosDe(id), hoje = hojeNaClinica();
  conferirRevisao(atual, op.revBase, function (r) { return despesaPublica(r, movs, hoje); });
  if (atual.cancelada === true) falhar("dados_invalidos", "Despesa cancelada não recebe pagamento.");
  var d = op.dados || {};
  var mid = idValido(d.id, "pagamento");
  if (movs.some(function (m) { return m.id === mid; }) || acharPorChave("fin_movimentos", mid)) {
    return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0, entidade: despesaPublica(atual, movs, hoje), jaExistia: true } };
  }
  var campos = validarCamposFin({ data: d.data, valor: d.valor, meio: d.meio, conta: d.conta, evidencia: d.evidencia, notas: d.notas }, CAMPOS_MOVIMENTO, "pagamento");
  if (!dataValida(campos.data)) falhar("dados_invalidos", "Informe a data do pagamento.", { campo: "data" });
  if (campos.data > finSomarDias(hoje, 1)) falhar("dados_invalidos", "A data do pagamento está no futuro: isso é previsão, não pagamento.", { campo: "data" });
  if (!campos.valor || campos.valor <= 0) falhar("dados_invalidos", "Informe o valor pago.", { campo: "valor" });
  var est = estadoDaDespesa(atual, movs, hoje);
  if (campos.valor > est.saldo) falhar("dados_invalidos", "O valor passa do saldo da despesa (" + dinheiroBR(est.saldo) + ").", { campo: "valor" });
  var quem = assinaturaDe(ctx.auth);
  var mov = { id: mid, despesaId: id, tipo: "pagamento", data: campos.data, valor: campos.valor, meio: campos.meio || atual.meio || "",
    conta: campos.conta || atual.conta || "", evidencia: campos.evidencia || "", notas: campos.notas || "", estornaId: "",
    criadoEm: agoraISO(), autorNome: quem.nome };
  var rev = (Number(atual.rev) || 0) + 1;
  var reg = novaDespesaRegistro(ctx, op.operacaoId, {}, atual, rev);
  var novos = movs.concat([mov]);
  var ev = [evento("financeiro", "despesa", id, "pagou", "Pagamento", "", dinheiroBR(mov.valor) + " em " + dataBR(mov.data) + (mov.meio ? " · " + mov.meio : ""))];
  return { escritas: [{ t: "inserir", tabela: "fin_movimentos", registro: mov }, { t: "gravar", tabela: "fin_despesas", registro: reg }]
    .concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, entidade: despesaPublica(reg, novos, hoje), movimento: movimentoPublico(mov) } };
}

function planejarEstorno(ctx, op) {
  var id = idValido(op.despesaId, "despesa");
  var atual = despesaAtual(id);
  var movs = movimentosDe(id), hoje = hojeNaClinica();
  conferirRevisao(atual, op.revBase, function (r) { return despesaPublica(r, movs, hoje); });
  var alvo = movs.filter(function (m) { return m.id === String(op.movimentoId || ""); })[0];
  if (!alvo || alvo.tipo !== "pagamento") falhar("dados_invalidos", "Pagamento não encontrado nesta despesa.");
  if (movs.some(function (m) { return m.tipo === "estorno" && m.estornaId === alvo.id; })) falhar("dados_invalidos", "Este pagamento já foi estornado.");
  var d = op.dados || {};
  var mid = idValido(d.id, "estorno");
  var data = String(d.data || hoje);
  if (!dataValida(data)) falhar("dados_invalidos", "Data do estorno inválida.", { campo: "data" });
  var quem = assinaturaDe(ctx.auth);
  var mov = { id: mid, despesaId: id, tipo: "estorno", data: data, valor: Number(alvo.valor) || 0, meio: alvo.meio || "", conta: alvo.conta || "",
    evidencia: "", notas: String(d.notas || "").slice(0, 2000), estornaId: alvo.id, criadoEm: agoraISO(), autorNome: quem.nome };
  var rev = (Number(atual.rev) || 0) + 1;
  var reg = novaDespesaRegistro(ctx, op.operacaoId, {}, atual, rev);
  var ev = [evento("financeiro", "despesa", id, "estornou", "Pagamento", dinheiroBR(alvo.valor) + " de " + dataBR(alvo.data), "estornado em " + dataBR(data), mov.notas)];
  return { escritas: [{ t: "inserir", tabela: "fin_movimentos", registro: mov }, { t: "gravar", tabela: "fin_despesas", registro: reg }]
    .concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, entidade: despesaPublica(reg, movs.concat([mov]), hoje), movimento: movimentoPublico(mov) } };
}

/* ---- recorrências ----
   Cada ocorrência tem id = <grupo>-<índice>. Gerar de novo até a mesma
   data não duplica nada: a ocorrência que já existe é pulada. */

function modeloDaRecorrencia(dados) {
  var campos = validarCamposFin({ descricao: dados.descricao, categoriaId: dados.categoriaId, fornecedorId: dados.fornecedorId,
    valor: dados.valor, meio: dados.meio, conta: dados.conta, area: dados.area, notas: dados.notas }, CAMPOS_DESPESA, "recorrência");
  if (!String(campos.descricao || "").trim()) falhar("dados_invalidos", "A recorrência precisa de uma descrição.", { campo: "descricao" });
  if (!campos.valor || campos.valor <= 0) falhar("dados_invalidos", "Informe o valor de cada ocorrência.", { campo: "valor" });
  return campos;
}

function escritasDeOcorrencias(ctx, opId, grupo, ate, existentes) {
  var modelo = grupo.modelo || {};
  var ja = {};
  existentes.forEach(function (d) { ja[d.id] = true; });
  var escritas = [], geradoAte = grupo.geradoAte || "";
  datasDaSerie(grupo.inicio, grupo.frequencia, { fim: grupo.fim, quantidade: grupo.quantidade, ate: ate }).forEach(function (o) {
    var id = grupo.id + "-" + o.indice;
    if (o.data > geradoAte) geradoAte = o.data;
    if (ja[id]) return;
    var v = { id: id, descricao: modelo.descricao, categoriaId: modelo.categoriaId || "", fornecedorId: modelo.fornecedorId || "",
      valor: modelo.valor, competencia: competenciaDe(o.data), vencimento: o.data, meio: modelo.meio || "", conta: modelo.conta || "",
      area: modelo.area || "", notas: modelo.notas || "", cancelada: false, grupoId: grupo.id, grupoTipo: "recorrencia",
      sequencia: o.indice, totalSequencia: grupo.quantidade || null, origem: "recorrencia", criadoEm: agoraISO() };
    escritas.push({ t: "gravar", tabela: "fin_despesas", registro: novaDespesaRegistro(ctx, opId, v, null, 1) });
  });
  return { escritas: escritas, geradoAte: geradoAte };
}

function horizontePadrao() {
  return finSomarMeses(hojeNaClinica(), MESES_GERADOS_ADIANTE, finPartes(hojeNaClinica()).d);
}

function planejarCriarRecorrencia(ctx, op) {
  var id = idValido(op.id, "recorrência");
  if (acharPorChave("fin_grupos", id)) falhar("conflito", "Já existe uma recorrência com este identificador.", { rev: 1, atual: null });
  var d = op.dados || {};
  var modelo = modeloDaRecorrencia(d);
  var freq = String(d.frequencia || "");
  if (!FIN_FREQUENCIAS[freq]) falhar("dados_invalidos", "Frequência desconhecida.", { campo: "frequencia" });
  var inicio = String(d.inicio || "");
  if (!dataValida(inicio)) falhar("dados_invalidos", "Informe o primeiro vencimento.", { campo: "inicio" });
  var fim = d.fim ? String(d.fim) : null;
  if (fim && (!dataValida(fim) || fim < inicio)) falhar("dados_invalidos", "Fim inválido.", { campo: "fim" });
  var qtd = d.quantidade === undefined || d.quantidade === null || d.quantidade === "" ? null : Number(d.quantidade);
  if (qtd !== null && (!Number.isInteger(qtd) || qtd < 1 || qtd > FIN_MAX_OCORRENCIAS)) falhar("dados_invalidos", "Quantidade de 1 a " + FIN_MAX_OCORRENCIAS + ".", { campo: "quantidade" });
  var grupo = { id: id, tipo: "recorrencia", descricao: modelo.descricao, valorTotal: null, quantidade: qtd, frequencia: freq,
    inicio: inicio, fim: fim, modelo: modelo, geradoAte: null, encerrado: false };
  var ate = op.gerarAte && dataValida(String(op.gerarAte)) ? String(op.gerarAte) : horizontePadrao();
  var g = escritasDeOcorrencias(ctx, op.operacaoId, grupo, ate, []);
  grupo.geradoAte = g.geradoAte || null;
  var reg = carimbar(registroCompleto("fin_grupos", grupo, null), 1, ctx, op.operacaoId);
  var ev = [evento("financeiro", "recorrencia", id, "criou", "", "", modelo.descricao + " — " + dinheiroBR(modelo.valor) + " " + FIN_FREQUENCIAS[freq].nome.toLowerCase())];
  return { escritas: g.escritas.concat([{ t: "gravar", tabela: "fin_grupos", registro: reg }]).concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: 1, grupo: publicoDe("fin_grupos", reg), geradas: g.escritas.length } };
}

function grupoAtual(id, revBase) {
  var g = acharPorChave("fin_grupos", id);
  if (!g) falhar("conflito", "Esta recorrência não existe mais.", { rev: 0, atual: null, removida: true });
  conferirRevisao(g, revBase, function (r) { return publicoDe("fin_grupos", r); });
  return g;
}

function planejarGerarRecorrencia(ctx, op) {
  var id = idValido(op.id, "recorrência");
  var g = grupoAtual(id, op.revBase);
  if (g.tipo !== "recorrencia") falhar("dados_invalidos", "Só recorrências geram ocorrências.");
  var ate = String(op.ate || horizontePadrao());
  if (!dataValida(ate)) falhar("dados_invalidos", "Data inválida.", { campo: "ate" });
  if (ate > finSomarMeses(hojeNaClinica(), 24, 1)) falhar("dados_invalidos", "Gere no máximo 24 meses adiante.");
  var existentes = filtrar("fin_despesas", "grupoId", id);
  var r = escritasDeOcorrencias(ctx, op.operacaoId, g, ate, existentes);
  if (!r.escritas.length) return { escritas: [], resultado: { id: id, rev: Number(g.rev) || 0, geradas: 0, grupo: publicoDe("fin_grupos", g) } };
  var rev = (Number(g.rev) || 0) + 1;
  var reg = carimbar(registroCompleto("fin_grupos", { geradoAte: r.geradoAte > (g.geradoAte || "") ? r.geradoAte : g.geradoAte }, g), rev, ctx, op.operacaoId);
  return { escritas: r.escritas.concat([{ t: "gravar", tabela: "fin_grupos", registro: reg }]),
    resultado: { id: id, rev: rev, geradas: r.escritas.length, grupo: publicoDe("fin_grupos", reg) } };
}

/* "Esta e as seguintes": muda o modelo e as ocorrências a partir da data
   que ainda não têm pagamento. Paga, parcialmente paga ou cancelada fica
   como está — a história não é reescrita. */
function planejarAlterarRecorrencia(ctx, op) {
  var id = idValido(op.id, "recorrência");
  var g = grupoAtual(id, op.revBase);
  var aPartir = String(op.aPartirDe || "");
  if (!dataValida(aPartir)) falhar("dados_invalidos", "Informe a partir de quando.", { campo: "aPartirDe" });
  var campos = validarCamposFin(op.campos || {}, CAMPOS_DESPESA, "recorrência");
  delete campos.vencimento; delete campos.competencia;
  var modelo = {};
  Object.keys(g.modelo || {}).forEach(function (k) { modelo[k] = g.modelo[k]; });
  Object.keys(campos).forEach(function (k) { modelo[k] = campos[k]; });
  if (!modelo.valor || modelo.valor <= 0) falhar("dados_invalidos", "Valor inválido.", { campo: "valor" });
  var movPor = agrupar(lerTudo("fin_movimentos"), "despesaId");
  var escritas = [], preservadas = 0, mudadas = 0;
  filtrar("fin_despesas", "grupoId", id).forEach(function (d) {
    if (d.vencimento < aPartir) return;
    if (d.cancelada === true || totalPago(movPor[d.id]) > 0) { preservadas++; return; }
    var v = {};
    Object.keys(campos).forEach(function (k) { v[k] = campos[k]; });
    escritas.push({ t: "gravar", tabela: "fin_despesas", registro: novaDespesaRegistro(ctx, op.operacaoId, v, d, (Number(d.rev) || 0) + 1) });
    mudadas++;
  });
  var rev = (Number(g.rev) || 0) + 1;
  var reg = carimbar(registroCompleto("fin_grupos", { modelo: modelo, descricao: modelo.descricao }, g), rev, ctx, op.operacaoId);
  var ev = [evento("financeiro", "recorrencia", id, "alterou", "A partir de " + dataBR(aPartir), "", mudadas + " ocorrência(s) alteradas; " + preservadas + " preservada(s) por estarem pagas ou canceladas")];
  return { escritas: escritas.concat([{ t: "gravar", tabela: "fin_grupos", registro: reg }]).concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, alteradas: mudadas, preservadas: preservadas, grupo: publicoDe("fin_grupos", reg) } };
}

function planejarEncerrarRecorrencia(ctx, op) {
  var id = idValido(op.id, "recorrência");
  var g = grupoAtual(id, op.revBase);
  var fim = String(op.fim || "");
  if (!dataValida(fim)) falhar("dados_invalidos", "Informe a data final.", { campo: "fim" });
  var movPor = agrupar(lerTudo("fin_movimentos"), "despesaId");
  var escritas = [], canceladas = 0;
  filtrar("fin_despesas", "grupoId", id).forEach(function (d) {
    if (d.vencimento <= fim || d.cancelada === true || totalPago(movPor[d.id]) > 0) return;
    escritas.push({ t: "gravar", tabela: "fin_despesas", registro: novaDespesaRegistro(ctx, op.operacaoId,
      { cancelada: true, canceladaEm: agoraISO(), motivoCancelamento: "Recorrência encerrada em " + dataBR(fim) }, d, (Number(d.rev) || 0) + 1) });
    canceladas++;
  });
  var rev = (Number(g.rev) || 0) + 1;
  var reg = carimbar(registroCompleto("fin_grupos", { fim: fim, encerrado: true }, g), rev, ctx, op.operacaoId);
  var ev = [evento("financeiro", "recorrencia", id, "encerrou", "Fim", dataBR(g.fim), dataBR(fim), canceladas + " ocorrência(s) futura(s) sem pagamento cancelada(s)")];
  return { escritas: escritas.concat([{ t: "gravar", tabela: "fin_grupos", registro: reg }]).concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, canceladas: canceladas, grupo: publicoDe("fin_grupos", reg) } };
}

/* ---- fichas de custo ---- */

function planejarFicha(ctx, op) {
  var id = idValido(op.id, "ficha");
  var atual = acharPorChave("fin_fichas", id);
  if (atual) conferirRevisao(atual, op.revBase, function (r) { return publicoDe("fin_fichas", r); });
  else if (Number(op.revBase || 0) !== 0) falhar("conflito", "Esta ficha não existe mais.", { rev: 0, atual: null, removida: true });
  var campos = validarCamposFin(op.dados || {}, CAMPOS_FICHA, "ficha");
  var valores = { id: id };
  camposDeNegocio("fin_fichas").forEach(function (k) { if (atual) valores[k] = atual[k]; });
  Object.keys(campos).forEach(function (k) { valores[k] = campos[k]; });
  if (TIPOS_FICHA.indexOf(valores.tipo) < 0) falhar("dados_invalidos", "Tipo: procedimento, produto ou pacote.", { campo: "tipo" });
  if (!String(valores.nome || "").trim()) falhar("dados_invalidos", "A ficha precisa de um nome.", { campo: "nome" });
  if (!valores.dados) valores.dados = {};
  if (valores.versaoAprovada === undefined || valores.versaoAprovada === null) valores.versaoAprovada = 0;
  var antes = atual ? publicoDe("fin_fichas", atual) : null;
  var mudou = !antes || Object.keys(campos).some(function (k) { return canonico(antes[k]) !== canonico(valores[k]); });
  var insumos = mapaPorId(lerTudo("fin_insumos")), fichas = mapaPorId(lerTudo("fin_fichas"));
  if (!mudou) { var o0 = publicoDe("fin_fichas", atual); o0._calculo = calcularFicha(atual, insumos, fichas); return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0, entidade: o0 } }; }
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var reg = carimbar(registroCompleto("fin_fichas", valores, atual), rev, ctx, op.operacaoId);
  fichas[id] = reg;
  var o = publicoDe("fin_fichas", reg);
  o._calculo = calcularFicha(reg, insumos, fichas);
  var ev = [evento("financeiro", "ficha", id, antes ? "alterou" : "criou", antes ? "Composição" : "", "", valores.nome)];
  if (antes && !mesmoValor(antes.precoAtual, valores.precoAtual)) ev.push(evento("financeiro", "ficha", id, "alterou", "Preço atual", dinheiroBR(antes.precoAtual), dinheiroBR(valores.precoAtual)));
  return { escritas: [{ t: "gravar", tabela: "fin_fichas", registro: reg }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, entidade: o } };
}

/* Aprovar guarda um retrato: composição e resultado, numa versão nova.
   A versão aprovada nunca muda; mudar a ficha depois cria um rascunho. */
function planejarAprovarFicha(ctx, op) {
  var id = idValido(op.id, "ficha");
  var atual = acharPorChave("fin_fichas", id);
  if (!atual) falhar("conflito", "Esta ficha não existe mais.", { rev: 0, atual: null, removida: true });
  conferirRevisao(atual, op.revBase, function (r) { return publicoDe("fin_fichas", r); });
  var insumos = mapaPorId(lerTudo("fin_insumos")), fichas = mapaPorId(lerTudo("fin_fichas"));
  var calc = calcularFicha(atual, insumos, fichas);
  if (!calc.completo) falhar("dados_invalidos", calc.bloqueio || ("Faltam dados: " + calc.faltando.join("; ") + "."));
  var versao = (Number(atual.versaoAprovada) || 0) + 1;
  var quem = assinaturaDe(ctx.auth);
  /* o retrato leva os materiais como estavam: preço de material muda */
  var retratoInsumos = {};
  ((atual.dados || {}).itens || []).forEach(function (it) { if (insumos[it.insumoId]) retratoInsumos[it.insumoId] = publicoDe("fin_insumos", insumos[it.insumoId]); });
  var v = { id: id + "@v" + versao, fichaId: id, versao: versao, aprovadaEm: agoraISO(), aprovadaPor: quem.nome,
    dados: { tipo: atual.tipo, nome: atual.nome, precoAtual: atual.precoAtual, dados: atual.dados, insumos: retratoInsumos },
    resultado: { precoSugerido: calc.precoSugerido, custoDireto: calc.custoDireto, rateio: calc.rateio, custoTotal: calc.custoTotal,
      r: calc.r, m: calc.m, memoria: calc.memoria } };
  var rev = (Number(atual.rev) || 0) + 1;
  var reg = carimbar(registroCompleto("fin_fichas", { versaoAprovada: versao, revisar: "" }, atual), rev, ctx, op.operacaoId);
  var ev = [evento("financeiro", "ficha", id, "aprovou", "Versão", String(versao - 1), String(versao), "preço sugerido " + dinheiroBR(calc.precoSugerido))];
  var o = publicoDe("fin_fichas", reg); o._calculo = calc;
  return { escritas: [{ t: "inserir", tabela: "fin_fichas_versoes", registro: v }, { t: "gravar", tabela: "fin_fichas", registro: reg }]
    .concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: rev, versao: versao, entidade: o } };
}
