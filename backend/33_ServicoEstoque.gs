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
  /* negativo: saiu mais do que foi registrado — falta entrada ou contagem */
  if (retrato.mil < 0) return "negativo";
  if (retrato.mil === 0) return "esgotado";
  var min = qtdMil(item.minimo);
  if (min !== null && !isNaN(min) && retrato.mil < min) return "abaixo";
  return "ok";
}

/* ---------------------------------------------------------------------
   UM SÓ CÁLCULO DE SALDO POR ITEM (modoSaldo)
   ---------------------------------------------------------------------
   retrato  o saldo é o último retrato da FONTE (arquivo importado, ou o
            Clinicorp quando houver acesso). A fonte já reflete as saídas:
            venda registrada no Alveare NÃO desconta de novo — ela fica para
            análise (valor vendido, custo), sem movimento de estoque.
   livro    o Alveare calcula: CONTAGEM (com data de corte, corteEm) + os
            movimentos efetivos DEPOIS do corte (entrada, venda entregue,
            devolução com retorno físico, perda, ajuste). Movimento datado
            antes do corte não conta — já está dentro da contagem. Venda
            histórica importada depois não desconta de novo.
   Passar de retrato para livro é explícito ("Assumir o saldo no Alveare"),
   sempre por uma contagem. Item só do Alveare (origem local) é livro.
   --------------------------------------------------------------------- */

var EST_EFEITO = { entrada: 1, devolucao: 1, venda: -1, perda: -1, consumo: -1, saida: -1, ajuste: 1 };
var EST_TIPOS_MOVIMENTO = { entrada: "Entrada (compra recebida)", venda: "Venda", devolucao: "Devolução com retorno físico", perda: "Perda",
  ajuste: "Ajuste", consumo: "Consumo registrado", saida: "Saída", estorno: "Correção (estorno)", contagem: "Contagem" };

function modoDoItem(item) { return item.modoSaldo || (item.origem === "local" ? "livro" : "retrato"); }

/* o corte do livro: o informado, ou (dado da 4.2.0) a última contagem */
function corteDoItem(item, saldos) {
  if (item.corteEm) return item.corteEm;
  var contagens = (saldos || []).filter(function (s) { return s.fonte === "contagem"; });
  return contagens.length ? contagens[contagens.length - 1].observadoEm : "";
}

function movimentoConta(m, corte) {
  if (!corte) return true;
  var dia = String(corte).slice(0, 10);
  if (m.data > dia) return true;
  if (m.data < dia) return false;
  return String(m.criadoEm || "") > String(corte);   // no dia do corte: só o que veio depois da contagem
}

function efeitoDoMovimento(m, porId, corte) {
  if (m.tipo === "estorno") {
    var alvo = porId[m.estornaId];
    return alvo && movimentoConta(alvo, corte) ? -efeitoDoMovimento(alvo, porId, corte) : 0;
  }
  if (!movimentoConta(m, corte)) return 0;
  var q = qtdMil(m.quantidade);
  if (q === null || isNaN(q)) return 0;
  return (EST_EFEITO[m.tipo] || 0) * q;
}

/* Custo médio ponderado móvel das compras do livro, até uma data.
   Entrada sem custo → o custo do estoque passa a "não informado" enquanto
   houver quantidade de custo desconhecido. */
function custoMedioDoLivro(item, saldos, movimentos, ateDia) {
  var corte = corteDoItem(item, saldos);
  var base = (saldos || []).filter(function (s) { return s.fonte === "contagem" && s.observadoEm === corte; })[0];
  var qtd = base ? (qtdMil(base.quantidade) || 0) : 0;
  var valor = base && base.custoUnitario !== null && base.custoUnitario !== undefined ? qtd * Number(base.custoUnitario) : (qtd ? null : 0);
  var porId = {}, ultimoMedio = qtd > 0 && valor !== null ? Math.round(valor / qtd) : null;
  (movimentos || []).forEach(function (m) { porId[m.id] = m; });
  (movimentos || []).slice().sort(function (a, b) { return String(a.data + a.criadoEm).localeCompare(String(b.data + b.criadoEm)); }).forEach(function (m) {
    if (ateDia && m.data > ateDia) return;
    var ef = efeitoDoMovimento(m, porId, corte);
    if (!ef) return;
    if (ef > 0 && m.tipo === "entrada") {
      if (valor !== null && m.custoUnitario !== null && m.custoUnitario !== undefined) valor += ef * Number(m.custoUnitario);
      else valor = null;
      qtd += ef;
      if (valor !== null && qtd > 0) ultimoMedio = Math.round(valor / qtd);
    } else {
      var medio = qtd > 0 && valor !== null ? valor / qtd : null;
      qtd += ef;
      if (valor !== null && medio !== null) valor = Math.max(0, qtd) * medio;
      if (qtd <= 0) { qtd = 0; valor = 0; }
    }
  });
  if (valor === null) return null;
  return qtd > 0 ? Math.round(valor / qtd) : ultimoMedio;
}

/* O custo que uma venda guarda: comprovado (média das compras do livro),
   informado pela fonte, estimado, ou não informado (null — nunca zero). */
function custoParaVenda(item, saldos, movimentos, dia) {
  if (modoDoItem(item) === "livro") {
    var medio = custoMedioDoLivro(item, saldos, movimentos, dia);
    if (medio !== null && medio !== undefined) return { custo: medio, fonte: "compra" };
  }
  if (item.custoUnitario !== null && item.custoUnitario !== undefined) {
    return { custo: Number(item.custoUnitario), fonte: item.custoFonte === "compra" ? "compra" : item.custoFonte === "importacao" ? "importacao" : "estimativa" };
  }
  return { custo: null, fonte: "" };
}

/* Saldo atual de um item, pelo modo dele. */
function retratoDoItem(item, saldos, movimentos) {
  var modo = modoDoItem(item);
  var porLocal = {};
  (saldos || []).forEach(function (s) { if (modo === "retrato" ? s.fonte !== "contagem" : true) porLocal[s.local || ""] = s; });
  var locais = Object.keys(porLocal);
  var lista = locais.map(function (l) {
    var s = porLocal[l];
    return { local: l, quantidade: s.quantidade, observadoEm: s.observadoEm, lote: s.lote || "", validade: s.validade || null, fonte: s.fonte };
  });
  if (modo === "livro") {
    var corte = corteDoItem(item, saldos);
    var base = (saldos || []).filter(function (s) { return s.fonte === "contagem" && s.observadoEm === corte; })[0];
    var porId = {};
    (movimentos || []).forEach(function (m) { porId[m.id] = m; });
    var total = base ? (qtdMil(base.quantidade) || 0) : 0, houve = !!base, ultimo = corte || null;
    (movimentos || []).forEach(function (m) {
      var ef = efeitoDoMovimento(m, porId, corte);
      if (ef || movimentoConta(m, corte)) { houve = true; if (!ultimo || m.criadoEm > ultimo) ultimo = m.criadoEm; }
      total += ef;
    });
    return { mil: houve ? total : null, observadoEm: ultimo, locais: lista, modo: "livro", corte: corte || null };
  }
  var soma = 0, quando = null, conhecidos = 0;
  lista.forEach(function (l) {
    var m = qtdMil(l.quantidade);
    if (m !== null && !isNaN(m)) { soma += m; conhecidos++; }
    if (!quando || l.observadoEm < quando) quando = l.observadoEm;
  });
  return { mil: conhecidos ? soma : null, observadoEm: quando, locais: lista, modo: "retrato", corte: null };
}

/* A frase simples que a tela mostra sobre de onde vem o saldo. */
function origemDoSaldo(item, r) {
  if (r.modo === "livro") {
    return r.corte ? "Calculado no Alveare: contagem de " + dataBR(String(r.corte).slice(0, 10)) + " mais as entradas e saídas registradas depois dela."
      : "Calculado no Alveare pelas entradas e saídas registradas (ainda sem contagem).";
  }
  return item.origem === "clinicorp" ? "Saldo informado pelo Clinicorp." :
    "Saldo do último arquivo importado. As vendas registradas aqui não descontam de novo: o arquivo já reflete as saídas.";
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
    var vendas = vendasParaTela();
    var itens = lerTudo("est_itens").filter(function (i) { return i.ativo !== false; }).map(function (i) {
      var ss = saldos[i.id] || [];
      var r = retratoDoItem(i, ss, movs[i.id]);
      var porIdMov = {};
      (movs[i.id] || []).forEach(function (m) { porIdMov[m.id] = m; });
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
      o.movimentos = (movs[i.id] || []).slice(-40).map(function (m) { return { id: m.id, tipo: m.tipo, nomeTipo: EST_TIPOS_MOVIMENTO[m.tipo] || m.tipo,
        quantidade: m.quantidade, data: m.data, motivo: m.motivo, autorNome: m.autorNome, origemTipo: m.origemTipo || "manual",
        custoUnitario: m.custoUnitario, estornaId: m.estornaId || "", conta: !!efeitoDoMovimento(m, porIdMov, r.corte) || m.tipo === "estorno" }; });
      o.modoSaldo = r.modo;
      o.corteEm = r.corte;
      o.origemSaldo = origemDoSaldo(i, r);
      o.custoMedio = r.modo === "livro" ? custoMedioDoLivro(i, ss, movs[i.id], null) : null;
      o.vendas = vendas.porItem[i.id] || null;
      o.insumoId = insumoDoItem[i.id] || "";
      o.reposicao = null;
      var min = qtdMil(i.minimo);
      if (r.mil !== null && min !== null && !isNaN(min) && r.mil < min) o.reposicao = qtdTexto(min - r.mil);
      return o;
    });
    var ultimoLote = lerTudo("sis_importacoes").filter(function (l) { return l.modulo === "estoque"; }).pop() || null;
    return {
      hoje: hoje, itens: itens, unidades: EST_UNIDADES, tiposMovimento: EST_TIPOS_MOVIMENTO,
      vendas: vendas.vendas, saidasAConfirmar: vendas.saidasAConfirmar,
      fonte: {
        clinicorp: { disponivel: false, motivo: CLINICORP_RECURSOS.estoque.semAcesso,
          falta: ["listagem de produtos/insumos com código e unidade", "saldo atual por local/unidade da clínica", "lotes e validade",
            "movimentações (entrada, consumo, perda, ajuste) com data e origem", "custo unitário",
            "vendas de produtos discriminadas (produto, quantidade, preço, desconto, situação de entrega)"] },
        ultimaImportacao: ultimoLote ? { em: ultimoLote.criadoEm, arquivo: ultimoLote.arquivo, importadas: ultimoLote.importadas, mapeamento: ultimoLote.mapeamento } : null
      },
      reposicao: itens.filter(function (i) { return i.reposicao !== null || i.situacao === "esgotado" || i.situacao === "negativo"; })
        .map(function (i) { return { id: i.id, nome: i.nome, saldo: i.saldo, minimo: i.minimo, faltam: i.reposicao, unidade: i.unidadeConsumo || i.unidadeCompra }; })
    };
  });
}

/* ---------------- operações ---------------- */

var CAMPOS_ITEM_LOCAL = { nome: { tipo: "texto", max: 160 }, codigo: { tipo: "texto", max: 60 }, categoria: { tipo: "texto", max: 80 },
  unidadeCompra: { tipo: "texto", max: 10 }, unidadeConsumo: { tipo: "texto", max: 10 }, fator: { tipo: "decimal" }, minimo: { tipo: "decimal" },
  custoUnitario: { tipo: "dinheiro" }, local: { tipo: "texto", max: 80 }, notas: { tipo: "texto", max: 2000 }, ativo: { tipo: "booleano" },
  fichaId: { tipo: "texto", max: 80 } };
/* de item que vem de fonte externa, só o que é do Alveare */
var CAMPOS_ITEM_EXTERNO = ["unidadeConsumo", "fator", "minimo", "notas", "ativo", "fichaId"];

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
  if (!atual) { valores.origem = "local"; valores.modoSaldo = "livro"; valores.criadoEm = agoraISO(); valores.custoFonte = valores.custoUnitario !== null && valores.custoUnitario !== undefined ? "estimativa" : ""; }
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

/* ---------------- movimentos ---------------- */

function movimentosDoItem(itemId) { return lerTudo("est_movimentos").filter(function (m) { return m.itemId === itemId; }); }

/* Movimento manual: só no livro. Item em retrato tem o saldo da fonte —
   movimentar aqui seria um segundo saldo concorrente. */
function planejarMovimentoEstoque(ctx, op) {
  var item = acharPorChave("est_itens", idValido(op.itemId, "item"));
  if (!item) falhar("nao_encontrado", "Item não encontrado.");
  var d = op.dados || {};
  var tipo = String(d.tipo || "");
  if (tipo === "contagem") return planejarContagem(ctx, op, item, d);
  if (modoDoItem(item) !== "livro") {
    falhar("dados_invalidos", "O saldo deste item vem da fonte (" + (item.origem === "clinicorp" ? "Clinicorp" : "arquivo importado") +
      "): ele não recebe movimento no Alveare, para não existir um segundo saldo. Para controlar aqui, use \"Assumir o saldo no Alveare\" com uma contagem.");
  }
  if (tipo === "saida") tipo = "consumo";
  if (["entrada", "perda", "ajuste", "consumo"].indexOf(tipo) < 0) falhar("dados_invalidos", "Movimento: entrada, perda, ajuste, consumo ou contagem.");
  var mid = idValido(d.id, "movimento");
  if (linhasCom("est_movimentos", "id", mid).length) return { escritas: [], resultado: { id: mid, jaExistia: true } };
  var q = qtdMil(d.quantidade);
  if (q === null || isNaN(q) || q === 0 || (tipo !== "ajuste" && q < 0)) falhar("dados_invalidos", "Quantidade inválida (até 3 casas decimais" + (tipo === "ajuste" ? "; negativa para tirar" : "") + ").", { campo: "quantidade" });
  var data = String(d.data || hojeNaClinica());
  if (!dataValida(data)) falhar("dados_invalidos", "Data inválida.", { campo: "data" });
  var custo = d.custoUnitario === undefined || d.custoUnitario === null || d.custoUnitario === "" ? null : Number(d.custoUnitario);
  if (custo !== null && (!Number.isInteger(custo) || custo < 0)) falhar("dados_invalidos", "Custo inválido.", { campo: "custoUnitario" });
  var quem = assinaturaDe(ctx.auth);
  var escritas = [{ t: "inserir", tabela: "est_movimentos", registro: { id: mid, itemId: item.id, tipo: tipo, quantidade: qtdTexto(q), data: data,
    motivo: String(d.motivo || "").slice(0, 300), criadoEm: agoraISO(), autorNome: quem.nome, opId: op.operacaoId,
    origemTipo: "manual", origemId: "", custoUnitario: tipo === "entrada" ? custo : null, estornaId: "" } }];
  /* compra com custo: o custo do item passa a ser o médio das compras (comprovado) */
  if (tipo === "entrada" && custo !== null) {
    var movs = movimentosDoItem(item.id).concat([escritas[0].registro]);
    var medio = custoMedioDoLivro(item, saldosPorItem()[item.id], movs, null);
    if (medio !== null && medio !== undefined && !mesmoValor(item.custoUnitario, medio)) {
      var reg = carimbar(registroCompleto("est_itens", { custoUnitario: medio, custoFonte: "compra" }, item), (Number(item.rev) || 0) + 1, ctx, op.operacaoId);
      escritas.push({ t: "gravar", tabela: "est_itens", registro: reg });
      escritas = escritas.concat(escritasDeCustoDoItem(ctx, op, reg));
    }
  }
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "estoque", item.id, tipo, EST_TIPOS_MOVIMENTO[tipo] || tipo, "",
    qtdTexto(q) + " " + (item.unidadeConsumo || "") + (custo !== null && tipo === "entrada" ? " a " + dinheiroBR(custo) : ""), d.motivo || "")], op.operacaoId));
  return { escritas: escritas, resultado: { id: mid } };
}

/* Contagem: o saldo passa a ser o contado, a partir de AGORA (data de
   corte). Num item em retrato, é também a passagem explícita para o livro. */
function planejarContagem(ctx, op, item, d) {
  var q = qtdMil(d.quantidade);
  if (q === null || isNaN(q) || q < 0) falhar("dados_invalidos", "Quantidade contada inválida.", { campo: "quantidade" });
  var mid = idValido(d.id, "contagem");
  if (acharPorChave("est_saldos", "ct-" + mid)) return { escritas: [], resultado: { id: mid, jaExistia: true } };
  var agora = agoraISO();
  var custo = d.custoUnitario !== undefined && d.custoUnitario !== null && d.custoUnitario !== "" ? Number(d.custoUnitario) : item.custoUnitario;
  var escritas = [{ t: "inserir", tabela: "est_saldos", registro: { id: "ct-" + mid, itemId: item.id, local: item.local || "", quantidade: qtdTexto(q),
    lote: "", validade: null, custoUnitario: custo === undefined ? null : custo, fonte: "contagem", loteImportacao: "", observadoEm: agora } }];
  var passou = modoDoItem(item) !== "livro";
  var reg = carimbar(registroCompleto("est_itens", { modoSaldo: "livro", corteEm: agora }, item), (Number(item.rev) || 0) + 1, ctx, op.operacaoId);
  escritas.push({ t: "gravar", tabela: "est_itens", registro: reg });
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "estoque", item.id, "contagem", passou ? "Saldo passa a ser calculado no Alveare" : "Contagem",
    "", qtdTexto(q) + " " + (item.unidadeConsumo || "") + " (corte " + dataBR(agora.slice(0, 10)) + ")", d.motivo || "")], op.operacaoId));
  return { escritas: escritas, resultado: { id: mid, corteEm: agora } };
}

/* Voltar para o retrato da fonte (ex.: o Clinicorp liberou o estoque): o
   livro fica guardado como histórico, mas deixa de definir o saldo. */
function planejarVoltarAoRetrato(ctx, op) {
  var item = acharPorChave("est_itens", idValido(op.itemId, "item"));
  if (!item) falhar("nao_encontrado", "Item não encontrado.");
  if (item.origem === "local") falhar("dados_invalidos", "Item só do Alveare não tem fonte externa.");
  if (modoDoItem(item) === "retrato") return { escritas: [], resultado: { id: item.id } };
  var reg = carimbar(registroCompleto("est_itens", { modoSaldo: "retrato" }, item), (Number(item.rev) || 0) + 1, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "est_itens", registro: reg }].concat(escritasDeAuditoria(ctx,
    [evento("financeiro", "estoque", item.id, "alterou", "Origem do saldo", "Alveare", "fonte externa")], op.operacaoId)), resultado: { id: item.id } };
}

/* ---------------------------------------------------------------------
   VENDAS DE PRODUTOS
   ---------------------------------------------------------------------
   · uma venda, vários itens discriminados (produto, quantidade, unidade,
     preço cobrado, desconto), com origem;
   · a BAIXA acompanha a saída efetiva: só venda ATIVA e ENTREGUE
     (entregueEm) mexe no estoque, e só em item no livro;
   · parcelas e formas de pagamento são das Entradas: a venda gera UMA
     saída por item, venha o dinheiro como vier;
   · reprocessar não desconta de novo: o movimento de cada item tem id
     próprio, e mudar a venda gera estorno + movimento novo (histórico);
   · o custo usado fica GRAVADO no item da venda (custoParaVenda) — mudar o
     custo amanhã não reescreve o resultado de hoje.
   --------------------------------------------------------------------- */

var CAMPOS_VENDA = { data: { tipo: "data" }, pacienteNome: { tipo: "texto", max: 200 }, pacienteRef: { tipo: "texto", max: 80 },
  entregueEm: { tipo: "data" }, entradaId: { tipo: "texto", max: 80 }, descontoGeral: { tipo: "dinheiro" }, taxas: { tipo: "dinheiro" },
  notas: { tipo: "texto", max: 2000 } };

function vendaPublica(v, itens) {
  var o = publicoDe("est_vendas", v);
  o.itens = (itens || []).map(function (i) { var x = publicoDe("est_venda_itens", i); return x; });
  var t = totaisDaVenda(v, itens);
  o._totais = t;
  return o;
}

/* Valores de uma venda. Desconto geral é rateado pelos itens na proporção
   do valor bruto (critério explícito), para dar o vendido por produto. */
function totaisDaVenda(v, itens) {
  var brutoTotal = 0;
  var linhas = (itens || []).map(function (i) {
    var q = qtdMil(i.quantidade) || 0, dev = qtdMil(i.devolvido) || 0;
    var liquidaQ = Math.max(0, q - dev);
    var bruto = Math.round(liquidaQ * (Number(i.precoUnitario) || 0) / 1000);
    var desc = q ? Math.round((Number(i.desconto) || 0) * liquidaQ / q) : 0;
    brutoTotal += bruto - desc;
    return { id: i.id, itemId: i.itemId, quantidade: qtdTexto(liquidaQ), bruto: bruto, desconto: desc };
  });
  var geral = v.estado === "cancelada" ? 0 : Number(v.descontoGeral) || 0;
  var resto = geral;
  linhas.forEach(function (l, k) {
    var parte = brutoTotal ? (k === linhas.length - 1 ? resto : Math.round(geral * (l.bruto - l.desconto) / brutoTotal)) : 0;
    resto -= parte;
    l.descontoGeral = parte;
    l.vendido = l.bruto - l.desconto - parte;
    var it = (itens || [])[k];
    var custoU = it && it.custoUnitario !== null && it.custoUnitario !== undefined ? Number(it.custoUnitario) : null;
    l.custoUnitario = custoU;
    l.custoFonte = it ? it.custoFonte || "" : "";
    l.custoTotal = custoU === null ? null : Math.round(custoU * (qtdMil(l.quantidade) || 0) / 1000);
    l.diferenca = l.custoTotal === null ? null : l.vendido - l.custoTotal;
  });
  var vendido = linhas.reduce(function (s, l) { return s + l.vendido; }, 0);
  var custoConhecido = linhas.every(function (l) { return l.custoTotal !== null; });
  var custo = custoConhecido ? linhas.reduce(function (s, l) { return s + l.custoTotal; }, 0) : null;
  var taxas = v.taxas === null || v.taxas === undefined ? null : Number(v.taxas);
  return { linhas: linhas, vendido: v.estado === "cancelada" ? 0 : vendido, custo: v.estado === "cancelada" ? 0 : custo,
    diferenca: v.estado === "cancelada" ? 0 : (custo === null ? null : vendido - custo), taxas: taxas,
    depoisDasTaxas: custo === null || taxas === null ? null : vendido - custo - taxas };
}

function itensDaVenda(vendaId) { return lerTudo("est_venda_itens").filter(function (i) { return i.vendaId === vendaId; }); }

function planejarVenda(ctx, op) {
  var id = idValido(op.id, "venda");
  var atual = acharPorChave("est_vendas", id);
  var itensAntes = atual ? itensDaVenda(id) : [];
  if (atual) conferirRevisao(atual, op.revBase, function (r) { return vendaPublica(r, itensAntes); });
  else if (Number(op.revBase || 0) !== 0) falhar("conflito", "Esta venda não existe mais.", { rev: 0, atual: null, removida: true });
  if (atual && atual.estado === "cancelada") falhar("dados_invalidos", "Venda cancelada não se altera.");
  var d = op.dados || {};
  var campos = validarCamposFin({ data: d.data, pacienteNome: d.pacienteNome, pacienteRef: d.pacienteRef, entregueEm: d.entregueEm,
    entradaId: d.entradaId, descontoGeral: d.descontoGeral, taxas: d.taxas, notas: d.notas }, CAMPOS_VENDA, "venda");
  var v = { id: id };
  camposDeNegocio("est_vendas").forEach(function (k) { if (atual) v[k] = atual[k]; });
  Object.keys(campos).forEach(function (k) { if (d[k] !== undefined) v[k] = campos[k]; });
  if (!atual) { v.origem = String(op.origem || "manual"); v.externoId = String(op.externoId || ""); v.estado = "ativa"; v.criadoEm = agoraISO(); v.loteId = String(op.loteId || ""); }
  if (!dataValida(v.data)) falhar("dados_invalidos", "A venda precisa da data.", { campo: "data" });
  if (v.entregueEm && v.entregueEm < v.data) falhar("dados_invalidos", "A entrega não pode ser antes da venda.", { campo: "entregueEm" });
  if (!Array.isArray(d.itens) || !d.itens.length) falhar("dados_invalidos", "A venda precisa de ao menos um produto, com quantidade.", { campo: "itens" });
  if (d.itens.length > 60) falhar("dados_invalidos", "Itens demais numa venda.");
  var itensEst = mapaPorId(lerTudo("est_itens"));
  var saldos = saldosPorItem();
  var movsTodos = lerTudo("est_movimentos");
  var movsPorItem = agrupar(movsTodos, "itemId");
  var antesPorId = mapaPorId(itensAntes);
  var escritas = [], novos = [], vistos = {};
  d.itens.forEach(function (x, k) {
    var iid = idValido(x.id || (id + "-" + (k + 1)), "item da venda");
    if (vistos[iid]) falhar("dados_invalidos", "Item repetido na venda.");
    vistos[iid] = true;
    var est = itensEst[String(x.itemId || "")];
    if (!est) falhar("dados_invalidos", "Produto não encontrado no estoque (item " + (k + 1) + "): cadastre ou importe o produto antes.", { campo: "itens" });
    var q = qtdMil(x.quantidade);
    if (q === null || isNaN(q) || q <= 0) falhar("dados_invalidos", "Quantidade inválida em " + est.nome + ".", { campo: "itens" });
    var unidade = String(x.unidade || est.unidadeConsumo || est.unidadeCompra || "");
    var qConsumo = unidade && est.unidadeConsumo && unidade !== est.unidadeConsumo ? converterMil(q, unidade, est.unidadeConsumo, est) : q;
    if (qConsumo === null) falhar("dados_invalidos", "A unidade " + unidade + " não converte para " + est.unidadeConsumo + " em " + est.nome + ".", { campo: "itens" });
    var preco = x.precoUnitario === null || x.precoUnitario === undefined || x.precoUnitario === "" ? null : Number(x.precoUnitario);
    if (preco === null || !Number.isInteger(preco) || preco < 0) falhar("dados_invalidos", "Informe o preço cobrado de " + est.nome + ".", { campo: "itens" });
    var desc = x.desconto ? Number(x.desconto) : 0;
    if (!Number.isInteger(desc) || desc < 0) falhar("dados_invalidos", "Desconto inválido em " + est.nome + ".", { campo: "itens" });
    var antes = antesPorId[iid];
    /* custo gravado na primeira vez; mudar a venda não troca o custo de
       então, a não ser que o produto mude */
    var custo = antes && antes.itemId === est.id ? { custo: antes.custoUnitario, fonte: antes.custoFonte } : custoParaVenda(est, saldos[est.id], movsPorItem[est.id], v.data);
    var linha = { id: iid, vendaId: id, itemId: est.id, quantidade: qtdTexto(qConsumo), unidade: est.unidadeConsumo || unidade,
      precoUnitario: preco, desconto: desc, custoUnitario: custo.custo, custoFonte: custo.fonte, fichaId: est.fichaId || "",
      devolvido: antes ? antes.devolvido : "", devolvidoRetorno: antes ? antes.devolvidoRetorno : "" };
    if (preco && unidade !== linha.unidade) {
      /* preço por unidade de venda → por unidade de consumo */
      linha.precoUnitario = Math.round(preco * q / qConsumo);
    }
    novos.push(linha);
    escritas.push({ t: "gravar", tabela: "est_venda_itens", registro: linha });
  });
  itensAntes.forEach(function (i) { if (!vistos[i.id]) escritas.push({ t: "remover", tabela: "est_venda_itens", chave: [i.id] }); });
  escritas = escritas.concat(escritasDeBaixa(ctx, op, v, novos, itensAntes, itensEst, movsTodos));
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var reg = carimbar(registroCompleto("est_vendas", v, atual), rev, ctx, op.operacaoId);
  var t = totaisDaVenda(reg, novos);
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "venda", id, atual ? "alterou" : "criou", "Venda", atual ? dinheiroBR(totaisDaVenda(atual, itensAntes).vendido) : "",
    dinheiroBR(t.vendido) + " · " + novos.length + " produto(s)" + (v.entregueEm ? " · saída em " + dataBR(v.entregueEm) : " · saída a confirmar"))], op.operacaoId));
  escritas.push({ t: "gravar", tabela: "est_vendas", registro: reg });
  return { escritas: escritas, resultado: { id: id, rev: rev, entidade: vendaPublica(reg, novos) } };
}

/* Os movimentos de estoque que a venda deve ter AGORA, comparados com os
   que já tem: o que sobrou vira estorno, o que falta vira movimento novo.
   Repetir a mesma venda não muda nada. */
function escritasDeBaixa(ctx, op, venda, itensDepois, itensAntes, itensEst, movsTodos) {
  var escritas = [];
  var ativos = {};
  var estornados = {};
  movsTodos.forEach(function (m) { if (m.tipo === "estorno") estornados[m.estornaId] = true; });
  movsTodos.forEach(function (m) {
    if (m.origemTipo === "venda" && m.tipo === "venda" && !estornados[m.id] && String(m.origemId).indexOf(venda.id + "|") === 0) ativos[m.origemId] = m;
  });
  var desejados = {};
  if (venda.estado === "ativa" && venda.entregueEm) {
    itensDepois.forEach(function (i) {
      var est = itensEst[i.itemId];
      if (!est || modoDoItem(est) !== "livro") return;   // retrato: a fonte já reflete a saída
      desejados[venda.id + "|" + i.id] = { item: i, qtd: i.quantidade };
    });
  }
  var quem = assinaturaDe(ctx.auth);
  var n = 0;
  Object.keys(ativos).forEach(function (chave) {
    var m = ativos[chave], dsj = desejados[chave];
    if (dsj && dsj.qtd === m.quantidade && dsj.item.itemId === m.itemId && m.data === venda.entregueEm) { delete desejados[chave]; return; }
    escritas.push({ t: "inserir", tabela: "est_movimentos", registro: { id: m.id + "-es", itemId: m.itemId, tipo: "estorno", quantidade: m.quantidade,
      data: hojeNaClinica(), motivo: venda.estado === "cancelada" ? "venda cancelada" : "venda corrigida", criadoEm: agoraISO(), autorNome: quem.nome,
      opId: op.operacaoId, origemTipo: "venda", origemId: chave, custoUnitario: null, estornaId: m.id } });
  });
  /* venda cancelada depois de uma devolução com retorno: o cancelamento já
     devolve a quantidade inteira, então a devolução sai também (senão o
     produto voltaria duas vezes) */
  if (venda.estado === "cancelada") {
    movsTodos.forEach(function (m) {
      if (m.origemTipo !== "venda" || m.tipo !== "devolucao" || estornados[m.id] || String(m.origemId).indexOf(venda.id + "|") !== 0) return;
      escritas.push({ t: "inserir", tabela: "est_movimentos", registro: { id: m.id + "-es", itemId: m.itemId, tipo: "estorno", quantidade: m.quantidade,
        data: hojeNaClinica(), motivo: "venda cancelada (devolução já contada)", criadoEm: agoraISO(), autorNome: quem.nome, opId: op.operacaoId,
        origemTipo: "venda", origemId: m.origemId, custoUnitario: null, estornaId: m.id } });
    });
  }
  Object.keys(desejados).forEach(function (chave) {
    var dsj = desejados[chave];
    var base = "vd-" + sha256Hex(chave).slice(0, 16);
    var mid = base + "-" + sha256Hex(op.operacaoId + "|" + (n++)).slice(0, 6);
    escritas.push({ t: "inserir", tabela: "est_movimentos", registro: { id: mid, itemId: dsj.item.itemId, tipo: "venda", quantidade: dsj.qtd,
      data: venda.entregueEm, motivo: "venda " + (venda.pacienteNome || ""), criadoEm: agoraISO(), autorNome: quem.nome, opId: op.operacaoId,
      origemTipo: "venda", origemId: chave, custoUnitario: dsj.item.custoUnitario, estornaId: "" } });
  });
  return escritas;
}

function vendaAtual(id, revBase) {
  var v = acharPorChave("est_vendas", idValido(id, "venda"));
  if (!v) falhar("conflito", "Esta venda não existe mais.", { rev: 0, atual: null, removida: true });
  var itens = itensDaVenda(v.id);
  conferirRevisao(v, revBase, function (r) { return vendaPublica(r, itens); });
  return { v: v, itens: itens };
}

function planejarConfirmarSaida(ctx, op) {
  var a = vendaAtual(op.id, op.revBase);
  if (a.v.estado !== "ativa") falhar("dados_invalidos", "Venda cancelada não tem saída.");
  var dia = String(op.data || hojeNaClinica());
  if (!dataValida(dia) || dia < a.v.data) falhar("dados_invalidos", "Data de saída inválida.", { campo: "data" });
  return planejarVenda(ctx, { operacaoId: op.operacaoId, id: a.v.id, revBase: op.revBase,
    dados: { entregueEm: dia, itens: a.itens.map(function (i) { return { id: i.id, itemId: i.itemId, quantidade: i.quantidade, unidade: i.unidade, precoUnitario: i.precoUnitario, desconto: i.desconto }; }) } });
}

function planejarCancelarVenda(ctx, op) {
  var a = vendaAtual(op.id, op.revBase);
  if (a.v.estado === "cancelada") return { escritas: [], resultado: { id: a.v.id, rev: Number(a.v.rev) || 0 } };
  var v = copiaLimpa(a.v); v.estado = "cancelada";
  var escritas = escritasDeBaixa(ctx, op, v, a.itens, a.itens, mapaPorId(lerTudo("est_itens")), lerTudo("est_movimentos"));
  var rev = (Number(a.v.rev) || 0) + 1;
  var reg = carimbar(registroCompleto("est_vendas", { estado: "cancelada" }, a.v), rev, ctx, op.operacaoId);
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "venda", a.v.id, "cancelou", "Venda", "ativa", "cancelada", String(op.motivo || ""))], op.operacaoId));
  escritas.push({ t: "gravar", tabela: "est_vendas", registro: reg });
  return { escritas: escritas, resultado: { id: a.v.id, rev: rev, entidade: vendaPublica(reg, a.itens) } };
}

/* Devolução: tira a quantidade do vendido; só REPÕE o estoque com
   confirmação de retorno físico (e item no livro). */
function planejarDevolucao(ctx, op) {
  var a = vendaAtual(op.id, op.revBase);
  if (a.v.estado !== "ativa") falhar("dados_invalidos", "Venda cancelada não tem devolução.");
  var it = a.itens.filter(function (i) { return i.id === String(op.vendaItemId || ""); })[0];
  if (!it) falhar("dados_invalidos", "Produto não encontrado nesta venda.");
  var q = qtdMil(op.quantidade);
  var ja = qtdMil(it.devolvido) || 0;
  if (q === null || isNaN(q) || q <= 0 || q + ja > (qtdMil(it.quantidade) || 0)) falhar("dados_invalidos", "Quantidade devolvida inválida (no máximo o que foi vendido).", { campo: "quantidade" });
  var retorno = op.retornoFisico === true;
  var linha = copiaLimpa(it);
  linha.devolvido = qtdTexto(ja + q);
  if (retorno) linha.devolvidoRetorno = qtdTexto((qtdMil(it.devolvidoRetorno) || 0) + q);
  var escritas = [{ t: "gravar", tabela: "est_venda_itens", registro: linha }];
  var est = acharPorChave("est_itens", it.itemId);
  var dia = String(op.data || hojeNaClinica());
  if (retorno && est && modoDoItem(est) === "livro" && a.v.entregueEm) {
    var quem = assinaturaDe(ctx.auth);
    escritas.push({ t: "inserir", tabela: "est_movimentos", registro: { id: "dv-" + sha256Hex(op.operacaoId).slice(0, 20), itemId: it.itemId, tipo: "devolucao",
      quantidade: qtdTexto(q), data: dia, motivo: String(op.motivo || "devolução com retorno físico").slice(0, 300), criadoEm: agoraISO(), autorNome: quem.nome,
      opId: op.operacaoId, origemTipo: "venda", origemId: a.v.id + "|" + it.id + "|dev", custoUnitario: it.custoUnitario, estornaId: "" } });
  }
  var rev = (Number(a.v.rev) || 0) + 1;
  var reg = carimbar(registroCompleto("est_vendas", {}, a.v), rev, ctx, op.operacaoId);
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "venda", a.v.id, "devolveu", est ? est.nome : "Produto", "",
    qtdTexto(q) + (retorno ? " com retorno ao estoque" : " sem retorno físico (estoque não muda)"), String(op.motivo || ""))], op.operacaoId));
  escritas.push({ t: "gravar", tabela: "est_vendas", registro: reg });
  return { escritas: escritas, resultado: { id: a.v.id, rev: rev } };
}

/* Vendas para a tela: lista recente e o resumo por produto. */
function vendasParaTela(itensEst) {
  var porVenda = agrupar(lerTudo("est_venda_itens"), "vendaId");
  var vendas = lerTudo("est_vendas").slice().sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
  var porItem = {};
  vendas.forEach(function (v) {
    if (v.estado === "cancelada") return;
    var t = totaisDaVenda(v, porVenda[v.id] || []);
    t.linhas.forEach(function (l) {
      var p = porItem[l.itemId] = porItem[l.itemId] || { quantidade: 0, vendido: 0, custo: 0, custoDesconhecido: 0, vendas: [] };
      p.quantidade += qtdMil(l.quantidade) || 0;
      p.vendido += l.vendido;
      if (l.custoTotal === null) p.custoDesconhecido += qtdMil(l.quantidade) || 0; else p.custo += l.custoTotal;
      if (p.vendas.length < 40) p.vendas.push({ vendaId: v.id, data: v.data, entregueEm: v.entregueEm, quantidade: l.quantidade,
        precoUnitario: (porVenda[v.id] || []).filter(function (i) { return i.id === l.id; })[0].precoUnitario, desconto: l.desconto + l.descontoGeral,
        vendido: l.vendido, custoUnitario: l.custoUnitario, custoFonte: l.custoFonte, custoTotal: l.custoTotal, diferenca: l.diferenca, paciente: v.pacienteNome || "" });
    });
  });
  Object.keys(porItem).forEach(function (k) {
    var p = porItem[k];
    p.quantidade = qtdTexto(p.quantidade);
    p.custoTotal = p.custoDesconhecido ? null : p.custo;
    p.diferenca = p.custoDesconhecido ? null : p.vendido - p.custo;
    p.custoDesconhecido = qtdTexto(p.custoDesconhecido);
  });
  return {
    vendas: vendas.slice(0, 200).map(function (v) { return vendaPublica(v, porVenda[v.id] || []); }),
    porItem: porItem,
    saidasAConfirmar: vendas.filter(function (v) { return v.estado === "ativa" && !v.entregueEm; }).map(function (v) { return v.id; })
  };
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
