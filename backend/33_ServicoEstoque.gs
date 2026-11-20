/* =====================================================================
   33_ServicoEstoque — o Estoque, dentro do Financeiro
   ---------------------------------------------------------------------
   FONTE. A API pública do Clinicorp não tem consulta de estoque (ver
   35_ClinicorpContrato: "estoque.consultar", implementado: false). Até o
   Clinicorp liberar, as fontes são:
     · importacao  retrato de saldos vindo de um arquivo exportado (CSV/XLSX),
                   com mapeamento salvo e reimportação idempotente;
     · local       itens que NÃO existem no Clinicorp, com movimentos
                   próprios — marcados como "só no Alveare";
     · clinicorp   reservado: o adaptador grava aqui quando houver acesso.

   ESTOQUE DUPLO, NÃO. Item de fonte externa não tem saldo editável nem
   movimento local: o saldo é sempre o último RETRATO da fonte, com data.
   Nada dá baixa por agendamento que passou, ordem de compra não é
   mercadoria recebida e compra recebida não é conta paga.

   QUANTIDADES são texto decimal na planilha e milésimos inteiros na conta
   (qtdMil), sem ponto flutuante acumulado. Saldo desconhecido ≠ zero.

   financeiro.estoque   itens, saldo atual (retrato), situação, validade,
                        variações observadas, reposição, movimentos locais
   financeiro.aplicar   estoque.item.salvar · estoque.movimento ·
                        estoque.usarNaPrecificacao
   ===================================================================== */

var EST_DIAS_DESATUALIZADO = 7;
var EST_DIAS_VALIDADE = 30;
var EST_UNIDADES_FONTE = { UN: "un", ML: "ml", G: "g" };  // enum do Clinicorp (/products/orders) → unidades do Alveare
var EST_UNIDADES = ["un", "ml", "l", "g", "kg", "mg", "cm", "m", "uso", "CX", "CT", "PT", "RL", "SR", "DS", "UI", "FA", "AP", "US", "F"];

/* ---------------- quantidades em milésimos ---------------- */

function qtdMil(bruto) {
  if (bruto === null || bruto === undefined) return null;
  var t = String(bruto).trim().replace(/\s/g, "");
  if (!t) return null;
  /* com vírgula: formato brasileiro (ponto = milhar). Sem vírgula: ponto é
     decimal — é o formato canônico que a importação manda depois de aplicar
     o separador escolhido pela pessoa. */
  if (t.indexOf(",") >= 0) t = t.replace(/\./g, "").replace(",", ".");
  var m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) return NaN;
  var v = Number(m[2]) * 1000 + Number(((m[3] || "") + "000").slice(0, 3));
  return m[1] === "-" ? -v : v;
}

function qtdTexto(mil) {
  if (mil === null || mil === undefined || isNaN(mil)) return "";
  var neg = mil < 0, n = Math.abs(Math.round(mil));
  var inteiro = Math.floor(n / 1000), frac = String(n % 1000).padStart(3, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + inteiro + (frac ? "." + frac : "");
}

/* converte milésimos de uma unidade para outra; fator = quantas unidades
   de consumo há numa unidade de compra (texto decimal). null = não converte */
function converterMil(mil, de, para, item) {
  if (mil === null || mil === undefined) return null;
  var a = EST_UNIDADES_FONTE[de] || de, b = EST_UNIDADES_FONTE[para] || para;
  if (a === b) return mil;
  if (item && item.unidadeCompra && (de === item.unidadeCompra || a === item.unidadeCompra) && b === (item.unidadeConsumo || "")) {
    var f = qtdMil(item.fator);
    if (!f || f <= 0) return null;
    return Math.round(mil * f / 1000);
  }
  var ua = FIN_UNIDADES[a], ub = FIN_UNIDADES[b];
  if (!ua || !ub || ua.grupo !== ub.grupo) return null;
  return Math.round(mil * ua.fator / ub.fator);
}

/* ---------------- leitura ---------------- */

function saldosPorItem() {
  var por = {};
  lerTudo("est_saldos").forEach(function (s) { (por[s.itemId] = por[s.itemId] || []).push(s); });
  Object.keys(por).forEach(function (k) { por[k].sort(function (a, b) { return String(a.observadoEm).localeCompare(String(b.observadoEm)); }); });
  return por;
}

function situacaoDoItem(item, retrato, hoje) {
  if (!retrato || retrato.mil === null) return "desconhecido";
  if (retrato.mil <= 0) return "esgotado";
  var min = qtdMil(item.minimo);
  if (min !== null && !isNaN(min) && retrato.mil < min) return "abaixo";
  return "ok";
}

/* Saldo atual de um item: o último retrato (por local) — para item local,
   a última contagem mais os movimentos depois dela. */
function retratoDoItem(item, saldos, movimentos) {
  var porLocal = {};
  (saldos || []).forEach(function (s) { porLocal[s.local || ""] = s; });
  var locais = Object.keys(porLocal);
  if (!locais.length && item.origem !== "local") return { mil: null, observadoEm: null, locais: [] };
  var total = 0, quando = null, conhecidos = 0;
  var lista = locais.map(function (l) {
    var s = porLocal[l];
    var m = qtdMil(s.quantidade);
    if (m !== null && !isNaN(m)) { total += m; conhecidos++; }
    if (!quando || s.observadoEm < quando) quando = s.observadoEm;
    return { local: l, quantidade: s.quantidade, observadoEm: s.observadoEm, lote: s.lote || "", validade: s.validade || null, fonte: s.fonte };
  });
  if (item.origem === "local") {
    var base = lista.length ? total : 0, desde = quando || "";
    (movimentos || []).forEach(function (mv) {
      if (desde && mv.criadoEm <= desde) return;
      var q = qtdMil(mv.quantidade) || 0;
      if (mv.tipo === "entrada") base += q;
      else if (mv.tipo === "saida") base -= q;
    });
    return { mil: lista.length || (movimentos || []).length ? base : null, observadoEm: (movimentos || []).length ? movimentos[movimentos.length - 1].criadoEm : quando, locais: lista };
  }
  return { mil: conhecidos ? total : null, observadoEm: quando, locais: lista };
}

function financeiroEstoque(ctx) {
  return lerComConsistencia(function () {
    var hoje = hojeNaClinica();
    var saldos = saldosPorItem();
    var movs = {};
    lerTudo("est_movimentos").forEach(function (m) { (movs[m.itemId] = movs[m.itemId] || []).push(m); });
    var insumoDoItem = {};
    lerTudo("fin_insumos").forEach(function (i) { if (i.itemEstoqueId) insumoDoItem[i.itemEstoqueId] = i.id; });
    var limiteValidade = finSomarDias(hoje, EST_DIAS_VALIDADE);
    var corte = new Date(Date.now() - EST_DIAS_DESATUALIZADO * 86400000).toISOString();
    var itens = lerTudo("est_itens").filter(function (i) { return i.ativo !== false; }).map(function (i) {
      var ss = saldos[i.id] || [];
      var r = retratoDoItem(i, ss, movs[i.id]);
      var validades = r.locais.filter(function (l) { return l.validade; }).map(function (l) { return l.validade; }).sort();
      /* variações observadas entre retratos: só a diferença, sem inventar
         compra, consumo ou perda para explicá-la */
      var variacoes = [];
      for (var k = Math.max(1, ss.length - 6); k < ss.length; k++) {
        if ((ss[k].local || "") !== (ss[k - 1].local || "")) continue;
        var a = qtdMil(ss[k - 1].quantidade), b = qtdMil(ss[k].quantidade);
        if (a === null || b === null || isNaN(a) || isNaN(b)) continue;
        variacoes.push({ de: ss[k - 1].observadoEm, ate: ss[k].observadoEm, variacao: qtdTexto(b - a) });
      }
      var o = publicoDe("est_itens", i);
      o.ativo = i.ativo !== false;
      o.saldo = r.mil === null ? null : qtdTexto(r.mil);
      o.saldoObservadoEm = r.observadoEm;
      o.desatualizado = !!(r.observadoEm && r.observadoEm < corte);
      o.locais = r.locais;
      o.situacao = situacaoDoItem(i, r, hoje);
      o.validadeMaisProxima = validades[0] || null;
      o.validadeProxima = !!(validades[0] && validades[0] <= limiteValidade);
      o.vencido = !!(validades[0] && validades[0] < hoje);
      o.variacoes = variacoes;
      o.movimentos = (movs[i.id] || []).slice(-30).map(function (m) { return { id: m.id, tipo: m.tipo, quantidade: m.quantidade, data: m.data, motivo: m.motivo, autorNome: m.autorNome }; });
      o.insumoId = insumoDoItem[i.id] || "";
      o.reposicao = null;
      var min = qtdMil(i.minimo);
      if (r.mil !== null && min !== null && !isNaN(min) && r.mil < min) o.reposicao = qtdTexto(min - r.mil);
      return o;
    });
    var ultimoLote = lerTudo("sis_importacoes").filter(function (l) { return l.modulo === "estoque"; }).pop() || null;
    return {
      hoje: hoje, itens: itens, unidades: EST_UNIDADES,
      fonte: {
        clinicorp: { disponivel: false, motivo: CLINICORP_RECURSOS.estoque.semAcesso,
          falta: ["listagem de produtos/insumos com código e unidade", "saldo atual por local/unidade da clínica", "lotes e validade",
            "movimentações (entrada, consumo, perda, ajuste) com data e origem", "custo unitário"] },
        ultimaImportacao: ultimoLote ? { em: ultimoLote.criadoEm, arquivo: ultimoLote.arquivo, importadas: ultimoLote.importadas, mapeamento: ultimoLote.mapeamento } : null
      },
      reposicao: itens.filter(function (i) { return i.reposicao !== null || i.situacao === "esgotado"; })
        .map(function (i) { return { id: i.id, nome: i.nome, saldo: i.saldo, minimo: i.minimo, faltam: i.reposicao, unidade: i.unidadeConsumo || i.unidadeCompra }; })
    };
  });
}

/* ---------------- operações ---------------- */

var CAMPOS_ITEM_LOCAL = { nome: { tipo: "texto", max: 160 }, codigo: { tipo: "texto", max: 60 }, categoria: { tipo: "texto", max: 80 },
  unidadeCompra: { tipo: "texto", max: 10 }, unidadeConsumo: { tipo: "texto", max: 10 }, fator: { tipo: "decimal" }, minimo: { tipo: "decimal" },
  custoUnitario: { tipo: "dinheiro" }, local: { tipo: "texto", max: 80 }, notas: { tipo: "texto", max: 2000 }, ativo: { tipo: "booleano" } };
/* de item que vem de fonte externa, só o que é do Alveare */
var CAMPOS_ITEM_EXTERNO = ["unidadeConsumo", "fator", "minimo", "notas", "ativo"];

function planejarItemEstoque(ctx, op) {
  var id = idValido(op.id, "item");
  var atual = acharPorChave("est_itens", id);
  if (atual) conferirRevisao(atual, op.revBase, function (r) { return publicoDe("est_itens", r); });
  else if (Number(op.revBase || 0) !== 0) falhar("conflito", "Este item não existe mais.", { rev: 0, atual: null, removida: true });
  var campos = validarCamposFin(op.dados || {}, CAMPOS_ITEM_LOCAL, "item");
  var externo = atual && atual.origem !== "local";
  if (externo) Object.keys(campos).forEach(function (k) {
    if (CAMPOS_ITEM_EXTERNO.indexOf(k) < 0 && !mesmoValor(campos[k], atual[k])) {
      falhar("dados_invalidos", "Este item vem de " + (atual.origem === "clinicorp" ? "Clinicorp" : "importação de arquivo") + ": nome, código, custo e saldo são da fonte.", { campo: k });
    }
  });
  ["unidadeCompra", "unidadeConsumo"].forEach(function (k) {
    if (campos[k] && EST_UNIDADES.indexOf(campos[k]) < 0) falhar("dados_invalidos", "Unidade desconhecida: " + campos[k] + ".", { campo: k });
  });
  var valores = { id: id };
  camposDeNegocio("est_itens").forEach(function (k) { if (atual) valores[k] = atual[k]; });
  Object.keys(campos).forEach(function (k) { valores[k] = campos[k]; });
  if (!atual) { valores.origem = "local"; valores.criadoEm = agoraISO(); valores.custoFonte = valores.custoUnitario !== null && valores.custoUnitario !== undefined ? "estimativa" : ""; }
  if (!String(valores.nome || "").trim()) falhar("dados_invalidos", "O item precisa de um nome.", { campo: "nome" });
  if (valores.ativo === null || valores.ativo === undefined) valores.ativo = true;
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var reg = carimbar(registroCompleto("est_itens", valores, atual), rev, ctx, op.operacaoId);
  var escritas = [{ t: "gravar", tabela: "est_itens", registro: reg }];
  if (!atual || !mesmoValor(atual.custoUnitario, reg.custoUnitario) || !mesmoValor(atual.unidadeConsumo, reg.unidadeConsumo)) {
    escritas = escritas.concat(escritasDeCustoDoItem(ctx, op, reg));
  }
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "estoque", id, atual ? "alterou" : "criou", "Item", "", valores.nome)], op.operacaoId));
  return { escritas: escritas, resultado: { id: id, rev: rev, entidade: publicoDe("est_itens", reg) } };
}

/* Movimento só existe para item que é SÓ do Alveare. Item de fonte externa
   tem o saldo da fonte: movimentar aqui seria estoque duplo. */
function planejarMovimentoEstoque(ctx, op) {
  var item = acharPorChave("est_itens", idValido(op.itemId, "item"));
  if (!item) falhar("nao_encontrado", "Item não encontrado.");
  if (item.origem !== "local") falhar("dados_invalidos", "O saldo deste item vem da fonte (" + (item.origem === "clinicorp" ? "Clinicorp" : "importação") + "): ele não recebe movimento no Alveare, para não existir um segundo saldo.");
  var d = op.dados || {};
  var mid = idValido(d.id, "movimento");
  if (linhasCom("est_movimentos", "id", mid).length) return { escritas: [], resultado: { id: mid, jaExistia: true } };
  var tipo = String(d.tipo || "");
  if (["entrada", "saida", "contagem"].indexOf(tipo) < 0) falhar("dados_invalidos", "Movimento: entrada, saída ou contagem.");
  var q = qtdMil(d.quantidade);
  if (q === null || isNaN(q) || q < 0 || (tipo !== "contagem" && q === 0)) falhar("dados_invalidos", "Quantidade inválida (até 3 casas decimais).", { campo: "quantidade" });
  var data = String(d.data || hojeNaClinica());
  if (!dataValida(data)) falhar("dados_invalidos", "Data inválida.", { campo: "data" });
  var quem = assinaturaDe(ctx.auth);
  var escritas = [];
  if (tipo === "contagem") {
    /* contagem = retrato local: o saldo passa a ser o contado */
    escritas.push({ t: "inserir", tabela: "est_saldos", registro: { id: "ct-" + mid, itemId: item.id, local: item.local || "", quantidade: qtdTexto(q),
      lote: "", validade: null, custoUnitario: item.custoUnitario, fonte: "contagem", loteImportacao: "", observadoEm: agoraISO() } });
  } else {
    escritas.push({ t: "inserir", tabela: "est_movimentos", registro: { id: mid, itemId: item.id, tipo: tipo, quantidade: qtdTexto(q), data: data,
      motivo: String(d.motivo || "").slice(0, 300), criadoEm: agoraISO(), autorNome: quem.nome, opId: op.operacaoId } });
  }
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "estoque", item.id, tipo, "Quantidade", "", qtdTexto(q) + " " + (item.unidadeConsumo || ""), d.motivo || "")], op.operacaoId));
  return { escritas: escritas, resultado: { id: mid } };
}

/* Usar um item do estoque na precificação: cria (ou liga) o material da
   ficha com código, unidade de consumo e custo da fonte. */
function planejarUsarNaPrecificacao(ctx, op) {
  var item = acharPorChave("est_itens", idValido(op.itemId, "item"));
  if (!item) falhar("nao_encontrado", "Item não encontrado.");
  var ins = op.insumoId ? acharPorChave("fin_insumos", idValido(op.insumoId, "material")) : null;
  if (!ins) ins = lerTudo("fin_insumos").filter(function (i) { return i.itemEstoqueId === item.id; })[0] || null;
  var unidade = EST_UNIDADES_FONTE[item.unidadeConsumo] || item.unidadeConsumo || "un";
  if (!FIN_UNIDADES[unidade]) falhar("dados_invalidos", "Defina a unidade de consumo do item (ml, g, un...) e quantas cabem na unidade de compra antes de usar na precificação.", { campo: "unidadeConsumo" });
  var valores = { id: ins ? ins.id : "in-" + item.id.slice(0, 60), nome: ins ? ins.nome : item.nome, itemEstoqueId: item.id, ativo: true,
    unidadeCompra: item.unidadeCompra || "", conteudo: "1", unidadeConteudo: unidade,
    valorEmbalagem: item.custoUnitario, custoFonte: item.custoUnitario === null || item.custoUnitario === undefined ? "" : (item.custoFonte || "estimativa") };
  var rev = (ins ? Number(ins.rev) || 0 : 0) + 1;
  var reg = carimbar(registroCompleto("fin_insumos", valores, ins), rev, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "fin_insumos", registro: reg }].concat(escritasDeAuditoria(ctx,
    [evento("financeiro", "material", reg.id, ins ? "alterou" : "criou", "Estoque", "", "ligado ao item " + item.nome)], op.operacaoId)),
    resultado: { id: reg.id, rev: rev, entidade: publicoDe("fin_insumos", reg) } };
}

/* Custo do item mudou: o material ligado acompanha (cálculos e simulações
   usam o valor atual); fichas com versão aprovada ficam marcadas para
   revisão. Versões aprovadas e preços NUNCA mudam sozinhos. */
function escritasDeCustoDoItem(ctx, op, item) {
  var escritas = [];
  if (item.custoUnitario === null || item.custoUnitario === undefined) return escritas;
  var afetados = {};
  lerTudo("fin_insumos").forEach(function (i) {
    if (i.itemEstoqueId !== item.id || mesmoValor(i.valorEmbalagem, item.custoUnitario)) return;
    var reg = copiaLimpa(i);
    reg.valorEmbalagem = item.custoUnitario; reg.custoFonte = item.custoFonte || "estimativa";
    carimbar(reg, (Number(i.rev) || 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "fin_insumos", registro: reg });
    afetados[i.id] = i.nome;
  });
  if (!Object.keys(afetados).length) return escritas;
  lerTudo("fin_fichas").forEach(function (f) {
    if (!Number(f.versaoAprovada)) return;
    var usa = ((f.dados || {}).itens || []).filter(function (it) { return afetados[it.insumoId]; });
    if (!usa.length) return;
    var reg = copiaLimpa(f);
    reg.revisar = "O custo de " + afetados[usa[0].insumoId] + " mudou em " + dataBR(hojeNaClinica()) + ": confira a composição antes da próxima aprovação.";
    carimbar(reg, (Number(f.rev) || 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "fin_fichas", registro: reg });
  });
  return escritas;
}
