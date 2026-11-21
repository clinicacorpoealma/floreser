/* =====================================================================
   32_ServicoImportacao — CSV/XLSX importados, com prévia e lote
   ---------------------------------------------------------------------
   O navegador lê o arquivo (compartilhado/importacao.js, com o SheetJS),
   a pessoa escolhe a aba, liga cada coluna a um campo e diz como ler datas
   e dinheiro. O que chega aqui já são linhas mapeadas — e o servidor
   confere TUDO de novo: tipo, obrigatório, repetido (no que já existe e
   dentro do próprio arquivo). Nenhum formato de exportação do Clinicorp é
   suposto: uma planilha importada é uma planilha, não uma conexão.

   importacao.previa     { modulo, linhas }  → por linha: ok, erros, avisos, repetida
   importacao.confirmar  { operacaoId, modulo, arquivo, planilha, mapeamento,
                           linhas, incluirRepetidas: [índices] }
   importacao.historico  { modulo }

   Cada confirmação é um lote (sis_importacoes) e uma operação só, no
   diário: cai no meio, termina na próxima; repetida, não duplica.
   ===================================================================== */

var MAX_LINHAS_POR_LOTE = 150;
var MODULOS_IMPORTACAO = ["financeiro", "entradas"];

/* O que se importa: "financeiro" (despesas), "entradas" ou "estoque"
   (pede a permissão do Financeiro: modulo "financeiro" + tipo "estoque"). */
function conferirModuloDeImportacao(ctx) {
  var m = String(ctx.dados.modulo || "");
  if (MODULOS_IMPORTACAO.indexOf(m) < 0) falhar("dados_invalidos", "Este módulo não importa planilhas.");
  if (m === "entradas" && !eAdministrador(ctx.auth)) falhar("sem_permissao", "Só administradores importam entradas em lote.");
  if (m === "financeiro" && ["estoque", "vendas", "execucoes"].indexOf(ctx.dados.tipo) >= 0) return ctx.dados.tipo;
  return m;
}

function linhasDoPedido(d) {
  if (!Array.isArray(d.linhas) || !d.linhas.length) falhar("dados_invalidos", "Nenhuma linha para importar.");
  if (d.linhas.length > MAX_LINHAS_POR_LOTE) falhar("dados_invalidos", "No máximo " + MAX_LINHAS_POR_LOTE + " linhas por lote.");
  return d.linhas;
}

/* ---- Financeiro: despesas ---- */

function contextoDespesas() {
  var cats = {}, forn = {};
  var lista = lerTudo("fin_categorias");
  (lista.length ? lista : FIN_CATEGORIAS_PADRAO.map(function (c) { return { id: c[0], nome: c[1] }; }))
    .forEach(function (c) { cats[chaveDeNome(c.nome)] = c.id; cats["#" + c.id] = c.id; });
  lerTudo("fin_fornecedores").forEach(function (f) { forn[chaveDeNome(f.nome)] = f.id; });
  var existentes = {};
  lerTudo("fin_despesas").forEach(function (d) {
    if (d.cancelada === true) return;
    existentes[d.vencimento + "|" + d.valor + "|" + chaveDeNome(d.descricao)] = d.id;
  });
  return { cats: cats, forn: forn, existentes: existentes };
}

function conferirLinhaDespesa(bruta, cx) {
  var erros = [], avisos = [];
  var l = bruta || {};
  var descricao = String(l.descricao || "").trim().slice(0, 300);
  if (!descricao) erros.push("sem descrição");
  var valor = Number(l.valor);
  if (l.valor === null || l.valor === "" || l.valor === undefined || !Number.isInteger(valor) || valor <= 0 || valor > MAX_CENTAVOS) erros.push("valor ausente ou inválido");
  var venc = String(l.vencimento || "");
  if (!dataValida(venc)) erros.push("vencimento ausente ou inválido");
  var comp = String(l.competencia || "");
  if (comp && !mesValido(comp)) erros.push("competência inválida (AAAA-MM)");
  var categoriaId = "";
  if (l.categoria) {
    categoriaId = cx.cats[chaveDeNome(l.categoria)] || cx.cats["#" + l.categoria] || "";
    if (!categoriaId) avisos.push("categoria \"" + String(l.categoria).slice(0, 40) + "\" não cadastrada — fica sem categoria");
  }
  var fornecedorId = "", notas = String(l.notas || "").slice(0, 3500);
  if (l.fornecedor) {
    fornecedorId = cx.forn[chaveDeNome(l.fornecedor)] || "";
    if (!fornecedorId) {
      avisos.push("fornecedor \"" + String(l.fornecedor).slice(0, 40) + "\" não cadastrado — vai para as notas");
      notas = ("Fornecedor: " + String(l.fornecedor).slice(0, 160) + (notas ? "\n" + notas : ""));
    }
  }
  var pago = l.pagoEm ? String(l.pagoEm) : "";
  if (pago && !dataValida(pago)) erros.push("data de pagamento inválida");
  var registro = { descricao: descricao, valor: valor, vencimento: venc, competencia: comp || (dataValida(venc) ? competenciaDe(venc) : ""),
    categoriaId: categoriaId, fornecedorId: fornecedorId, meio: String(l.meio || "").slice(0, 60), conta: String(l.conta || "").slice(0, 80),
    area: String(l.area || "").slice(0, 80), notas: notas, pagoEm: pago };
  var chave = venc + "|" + valor + "|" + chaveDeNome(descricao);
  return { registro: registro, erros: erros, avisos: avisos, chave: chave, repetidaDe: cx.existentes[chave] || "" };
}

/* ---- Entradas ---- */

function contextoEntradas() {
  var idPag = agrupar(lerTudo("ent_pagamentos"), "entradaId");
  var existentes = {};
  lerTudo("ent_entradas").forEach(function (e) {
    existentes[e.data + "|" + totalPagamentos(idPag[e.id]) + "|" + chaveDeNome(e.nome)] = e.id;
  });
  return { existentes: existentes };
}

function conferirLinhaEntrada(bruta, cx) {
  var erros = [], avisos = [];
  var l = bruta || {};
  var nome = String(l.nome || "").trim().slice(0, 200);
  if (!nome) erros.push("sem nome");
  var data = String(l.data || "");
  if (!dataValida(data)) erros.push("data ausente ou inválida");
  var valor = Number(l.valor);
  if (l.valor === null || l.valor === "" || l.valor === undefined || !Number.isInteger(valor) || valor < 0 || valor > MAX_CENTAVOS) erros.push("valor ausente ou inválido");
  var metodo = String(l.metodo || "").toLowerCase();
  var apelidos = { "débito": "debito", "crédito": "credito", "cartão de crédito": "credito", "cartão de débito": "debito",
    "em haver": "haver", "transferência": "pix", "transferencia": "pix" };
  metodo = apelidos[metodo] || metodo;
  if (METODOS_ENTRADA.indexOf(metodo) < 0) erros.push("forma de pagamento desconhecida" + (l.metodo ? " (\"" + String(l.metodo).slice(0, 20) + "\")" : ""));
  var parcelas = l.parcelas === undefined || l.parcelas === null || l.parcelas === "" ? 1 : Number(l.parcelas);
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 12) erros.push("parcelas fora de 1 a 12");
  var registro = { nome: nome, data: data, descricao: String(l.descricao || "").slice(0, 500), obs: String(l.obs || "").slice(0, 4000),
    metodo: metodo, valor: valor, parcelas: parcelas };
  var chave = data + "|" + valor + "|" + chaveDeNome(nome);
  return { registro: registro, erros: erros, avisos: avisos, chave: chave, repetidaDe: cx.existentes[chave] || "" };
}

/* ---- Estoque: retrato de saldos de um arquivo ----
   Item casado pelo código (ou pelo nome, se não houver código) entre os
   itens importados; item "só do Alveare" com o mesmo código NÃO é
   misturado. O retrato tem id do (item, local, lote, dia): o mesmo arquivo
   no mesmo dia não duplica. Quantidade vazia = saldo desconhecido. */
function contextoEstoque() {
  var porChave = {}, locais = {};
  lerTudo("est_itens").forEach(function (i) {
    var k = i.codigo ? "c:" + chaveDeNome(i.codigo) : "n:" + chaveDeNome(i.nome);
    if (i.origem === "local") locais[k] = i; else porChave[k] = i;
  });
  var saldos = {};
  lerTudo("est_saldos").forEach(function (sx) { saldos[sx.id] = true; });
  return { porChave: porChave, locais: locais, saldos: saldos };
}

function conferirLinhaEstoque(bruta, cx) {
  var erros = [], avisos = [];
  var l = bruta || {};
  var nome = String(l.nome || "").trim().slice(0, 160), codigo = String(l.codigo || "").trim().slice(0, 60);
  if (!nome && !codigo) erros.push("sem nome nem código");
  var k = codigo ? "c:" + chaveDeNome(codigo) : "n:" + chaveDeNome(nome);
  var item = cx.porChave[k] || null;
  if (cx.locais[k]) avisos.push("existe um item só do Alveare com o mesmo " + (codigo ? "código" : "nome") + ": não foi misturado");
  var unidadeBruta = String(l.unidade || "").trim();
  var unidade = EST_UNIDADES_FONTE[unidadeBruta.toUpperCase()] || unidadeBruta.toLowerCase();
  if (unidadeBruta && EST_UNIDADES.indexOf(unidade) < 0 && EST_UNIDADES.indexOf(unidadeBruta.toUpperCase()) >= 0) unidade = unidadeBruta.toUpperCase();
  if (unidadeBruta && EST_UNIDADES.indexOf(unidade) < 0) erros.push("unidade desconhecida: " + unidadeBruta.slice(0, 10));
  var q = l.quantidade === undefined || l.quantidade === null || String(l.quantidade).trim() === "" ? null : qtdMil(l.quantidade);
  if (q !== null && (isNaN(q) || q < 0)) erros.push("quantidade inválida (até 3 casas decimais)");
  if (q === null) avisos.push("sem quantidade: o saldo fica desconhecido (não vira zero)");
  var qConsumo = q;
  if (q !== null && !isNaN(q) && item && unidade && item.unidadeConsumo && unidade !== item.unidadeConsumo) {
    qConsumo = converterMil(q, unidade, item.unidadeConsumo, item);
    if (qConsumo === null) erros.push("a unidade " + unidade + " não converte para " + item.unidadeConsumo + " (defina o fator no item)");
  }
  var minimo = l.minimo === undefined || String(l.minimo || "").trim() === "" ? null : qtdMil(l.minimo);
  if (minimo !== null && (isNaN(minimo) || minimo < 0)) erros.push("estoque mínimo inválido");
  var custo = l.custoUnitario === undefined || l.custoUnitario === null || l.custoUnitario === "" ? null : Number(l.custoUnitario);
  if (custo !== null && (!Number.isInteger(custo) || custo < 0)) erros.push("custo inválido");
  var validade = String(l.validade || "");
  if (validade && !dataValida(validade)) erros.push("validade inválida");
  var dia = String(l.dataRetrato || hojeNaClinica());
  if (!dataValida(dia)) erros.push("data do retrato inválida");
  var local = String(l.local || "").trim().slice(0, 80), lote = String(l.lote || "").trim().slice(0, 60);
  var itemId = item ? item.id : "im-" + sha256Hex(k).slice(0, 20);
  var saldoId = "im-" + sha256Hex(itemId + "|" + local + "|" + lote + "|" + dia).slice(0, 24);
  var registro = { nome: nome || codigo, codigo: codigo, categoria: String(l.categoria || "").slice(0, 80), unidade: unidade, quantidade: qConsumo === null ? "" : qtdTexto(qConsumo),
    minimo: minimo === null ? "" : qtdTexto(minimo), custoUnitario: custo, local: local, lote: lote, validade: validade, dataRetrato: dia, itemId: itemId, saldoId: saldoId };
  return { registro: registro, erros: erros, avisos: avisos, chave: itemId + "|" + local + "|" + lote, repetidaDe: q !== null && cx.saldos[saldoId] ? saldoId : "" };
}

/* ---- Vendas por produto (relatório) ----
   Linhas da mesma venda (coluna "venda", ou data + paciente) viram UMA
   venda com vários produtos. Produto casado pelo código (ou nome exato) no
   estoque; sem produto cadastrado, a linha é recusada (não se inventa
   item). A baixa só acontece com a coluna "entregue" dizendo que saiu. */
function contextoVendas() {
  var porCodigo = {}, porNome = {};
  lerTudo("est_itens").forEach(function (i) {
    if (i.codigo) (porCodigo[chaveDeNome(i.codigo)] = porCodigo[chaveDeNome(i.codigo)] || []).push(i);
    (porNome[chaveDeNome(i.nome)] = porNome[chaveDeNome(i.nome)] || []).push(i);
  });
  return { porCodigo: porCodigo, porNome: porNome, vendas: mapaPorId(lerTudo("est_vendas")) };
}

function conferirLinhaVenda(bruta, cx) {
  var l = bruta || {}, erros = [], avisos = [];
  var data = String(l.data || "");
  if (!dataValida(data)) erros.push("data ausente ou inválida");
  var cands = l.codigo ? (cx.porCodigo[chaveDeNome(l.codigo)] || []) : (cx.porNome[chaveDeNome(l.produto)] || []);
  if (!l.codigo && !l.produto) erros.push("sem produto");
  else if (!cands.length) erros.push("produto não cadastrado no estoque: " + String(l.codigo || l.produto).slice(0, 40));
  else if (cands.length > 1) erros.push("mais de um item do estoque com " + (l.codigo ? "este código" : "este nome") + ": resolva no Estoque antes");
  var q = qtdMil(l.quantidade);
  if (q === null || isNaN(q) || q <= 0) erros.push("quantidade ausente ou inválida");
  var preco = l.precoUnitario === null || l.precoUnitario === undefined || l.precoUnitario === "" ? null : Number(l.precoUnitario);
  if (preco === null || !Number.isInteger(preco) || preco < 0) erros.push("preço cobrado ausente ou inválido");
  var desc = l.desconto ? Number(l.desconto) : 0;
  if (!Number.isInteger(desc) || desc < 0) erros.push("desconto inválido");
  var ent = String(l.entregue === undefined || l.entregue === null ? "" : l.entregue).trim().toLowerCase();
  var entregueEm = "";
  if (dataValida(ent)) entregueEm = ent;
  else if (["sim", "s", "x", "entregue", "retirado", "true", "1"].indexOf(ent) >= 0) entregueEm = data;
  else avisos.push("sem confirmação de saída: a venda entra sem baixar o estoque (confirme a saída depois)");
  var chaveVenda = l.venda ? "v:" + String(l.venda).trim() : "d:" + data + "|" + chaveDeNome(l.paciente || "");
  var registro = { vendaChave: chaveVenda, vendaExterna: String(l.venda || "").slice(0, 60), data: data, itemId: cands.length === 1 ? cands[0].id : "",
    produto: cands.length === 1 ? cands[0].nome : String(l.produto || l.codigo || ""), quantidade: q === null || isNaN(q) ? "" : qtdTexto(q),
    unidade: String(l.unidade || "").trim(), precoUnitario: preco, desconto: desc, paciente: String(l.paciente || "").slice(0, 200), entregueEm: entregueEm };
  var vid = "iv-" + sha256Hex(chaveVenda).slice(0, 20);
  return { registro: registro, erros: erros, avisos: avisos, chave: chaveVenda + "|" + registro.itemId + "|" + registro.precoUnitario,
    repetidaDe: cx.vendas[vid] && cx.vendas[vid].loteId ? "" : "" };
}

/* ---- Procedimentos realizados por agendamento (relatório) ----
   Cada linha precisa de um agendamento IDENTIFICADO (id do Clinicorp ou da
   Agenda): sem ele a linha é recusada — execução nunca nasce de data,
   sessão ou pagamento. */
function contextoExecucoes() {
  var c = configClinicorp();
  var pac = mapaDePacientes(c);
  return { ags: agendamentosConhecidos(c, pac), exes: mapaPorId(lerTudo("exe_execucoes")) };
}

function conferirLinhaExecucao(bruta, cx) {
  var l = bruta || {}, erros = [], avisos = [];
  var idAg = String(l.agendamento || "").trim();
  var ag = idAg ? (cx.ags["clinicorp:" + idAg] || cx.ags["agenda:" + idAg] || cx.ags["agenda-hist:" + idAg]) : null;
  if (!idAg) erros.push("sem o identificador do agendamento");
  else if (!ag) erros.push("agendamento " + idAg.slice(0, 30) + " não encontrado (sincronize os agendamentos ou confira o código)");
  if (!String(l.procedimento || l.codigo || "").trim()) erros.push("sem procedimento");
  var q = l.quantidade === undefined || l.quantidade === null || l.quantidade === "" ? 1000 : qtdMil(l.quantidade);
  if (!q || isNaN(q) || q < 0) erros.push("quantidade inválida");
  if (ag && ag.data > hojeNaClinica()) erros.push("o agendamento ainda não aconteceu");
  if (ag && (ag.status.categoria === "cancelado" || ag.status.categoria === "falta")) erros.push("o agendamento está como " + EXE_STATUS_AGENDA[ag.status.categoria].toLowerCase());
  if (ag && !ag.pacienteRef) erros.push("o agendamento não tem paciente identificada (vincule a paciente)");
  var registro = { agendamentoTipo: ag ? ag.tipo : "", agendamentoId: ag ? ag.id : idAg, procedimento: String(l.procedimento || l.codigo || "").slice(0, 160),
    procedimentoRef: String(l.codigo || "").slice(0, 60), quantidade: q ? qtdTexto(q) : "", data: ag ? ag.data : "", paciente: ag ? ag.pacienteNome : "" };
  var chave = registro.agendamentoTipo + ":" + registro.agendamentoId + "|" + (registro.procedimentoRef || chaveDeNome(registro.procedimento));
  var id = "ix-" + sha256Hex(chave).slice(0, 24);
  return { registro: registro, erros: erros, avisos: avisos, chave: chave, repetidaDe: cx.exes[id] ? id : "" };
}

function analisarLinhas(modulo, linhas) {
  var cx = modulo === "financeiro" ? contextoDespesas() : modulo === "estoque" ? contextoEstoque() : modulo === "vendas" ? contextoVendas() :
    modulo === "execucoes" ? contextoExecucoes() : contextoEntradas();
  var conferir = modulo === "financeiro" ? conferirLinhaDespesa : modulo === "estoque" ? conferirLinhaEstoque : modulo === "vendas" ? conferirLinhaVenda :
    modulo === "execucoes" ? conferirLinhaExecucao : conferirLinhaEntrada;
  var vistas = {};
  return linhas.map(function (l, i) {
    var r = conferir(l, cx);
    r.indice = i;
    if (!r.erros.length) {
      if (r.repetidaDe) r.repetida = modulo === "estoque" ? "este retrato já foi importado (mesmo item, local, lote e dia)" :
        modulo === "execucoes" ? "este procedimento já foi registrado neste agendamento" : "já existe um registro igual (mesma data, valor e nome)";
      else if (modulo === "vendas") { /* várias linhas da mesma venda são normais */ }
      else if (vistas[r.chave] !== undefined) r.repetida = "igual à linha " + (vistas[r.chave] + 1) + " deste arquivo";
      else vistas[r.chave] = i;
    }
    return r;
  });
}

function importacaoPrevia(ctx) {
  var modulo = conferirModuloDeImportacao(ctx);
  var linhas = linhasDoPedido(ctx.dados);
  return lerComConsistencia(function () {
    var r = analisarLinhas(modulo, linhas);
    return {
      linhas: r.map(function (x) { return { indice: x.indice, ok: !x.erros.length, erros: x.erros, avisos: x.avisos, repetida: x.repetida || "", registro: x.registro }; }),
      contagem: { total: r.length, validas: r.filter(function (x) { return !x.erros.length && !x.repetida; }).length,
        repetidas: r.filter(function (x) { return x.repetida; }).length, comErro: r.filter(function (x) { return x.erros.length; }).length }
    };
  });
}

function importacaoConfirmar(ctx) {
  var modulo = conferirModuloDeImportacao(ctx);
  var d = ctx.dados;
  linhasDoPedido(d);
  var op = { operacaoId: d.operacaoId, tipo: "importacao." + modulo, arquivo: String(d.arquivo || "").slice(0, 200),
    planilha: String(d.planilha || "").slice(0, 100), mapeamento: d.mapeamento || {}, linhas: d.linhas,
    incluirRepetidas: Array.isArray(d.incluirRepetidas) ? d.incluirRepetidas.map(Number) : [] };
  return executarOperacao(ctx, op, function (o) { return planejarImportacao(ctx, modulo, o); });
}

function planejarImportacao(ctx, modulo, op) {
  var analise = analisarLinhas(modulo, op.linhas);
  var lote = "lote-" + String(op.operacaoId).slice(-24);
  var incluir = {};
  op.incluirRepetidas.forEach(function (i) { incluir[i] = true; });
  var escritas = [], importadas = 0, repetidas = 0, comErro = 0, detalhes = [];
  var hoje = hojeNaClinica(), quem = assinaturaDe(ctx.auth);
  var gruposVenda = {}, ordemVenda = [];
  analise.forEach(function (x) {
    if (x.erros.length) { comErro++; detalhes.push({ linha: x.indice + 1, erros: x.erros }); return; }
    if (x.repetida && !incluir[x.indice]) { repetidas++; detalhes.push({ linha: x.indice + 1, repetida: x.repetida }); return; }
    var id = lote + "-" + (x.indice + 1);
    var r = x.registro;
    if (modulo === "vendas") {
      if (!gruposVenda[r.vendaChave]) { gruposVenda[r.vendaChave] = []; ordemVenda.push(r.vendaChave); }
      gruposVenda[r.vendaChave].push(r);
    } else if (modulo === "execucoes") {
      var px = planejarExecucao(ctx, { operacaoId: op.operacaoId, id: "ix-" + sha256Hex(x.chave).slice(0, 24), origem: "importacao", loteId: lote,
        dados: { agendamentoTipo: r.agendamentoTipo, agendamentoId: r.agendamentoId, procedimento: r.procedimento, procedimentoRef: r.procedimentoRef,
          quantidade: r.quantidade, estado: "realizado" } });
      escritas = escritas.concat(px.escritas || []);
    } else if (modulo === "estoque") {
      escritas = escritas.concat(escritasDeLinhaDeEstoque(ctx, op, r, lote));
    } else if (modulo === "financeiro") {
      var desp = { id: id, descricao: r.descricao, categoriaId: r.categoriaId, fornecedorId: r.fornecedorId, valor: r.valor,
        competencia: r.competencia, vencimento: r.vencimento, meio: r.meio, conta: r.conta, area: r.area, notas: r.notas,
        cancelada: false, origem: "importacao", loteId: lote, criadoEm: agoraISO() };
      escritas.push({ t: "gravar", tabela: "fin_despesas", registro: carimbar(registroCompleto("fin_despesas", desp, null), 1, ctx, op.operacaoId) });
      /* "pago em" só vira pagamento porque a planilha DIZ que foi pago —
         é evidência explícita, registrada como tal */
      if (r.pagoEm && r.pagoEm <= finSomarDias(hoje, 1)) {
        escritas.push({ t: "inserir", tabela: "fin_movimentos", registro: { id: id + "-pg", despesaId: id, tipo: "pagamento", data: r.pagoEm,
          valor: r.valor, meio: r.meio, conta: r.conta, evidencia: "Importado da planilha " + op.arquivo, notas: "", estornaId: "",
          criadoEm: agoraISO(), autorNome: quem.nome } });
      }
    } else {
      escritas.push({ t: "inserir", tabela: "ent_pagamentos", registro: { id: id + "-pg", entradaId: id, ordem: 0, metodo: r.metodo, valor: r.valor, parcelas: r.parcelas } });
      escritas.push({ t: "gravar", tabela: "ent_entradas", registro: carimbar(registroCompleto("ent_entradas", { id: id, nome: r.nome, data: r.data,
        descricao: r.descricao, obs: r.obs, criadoEm: agoraISO(), origem: "importacao", loteId: lote }, null), 1, ctx, op.operacaoId) });
    }
    importadas++;
  });
  /* vendas: uma venda por grupo; a mesma venda importada de novo, igual,
     não muda nada; diferente, é corrigida (estorno + movimento novo) */
  ordemVenda.forEach(function (chave) {
    var linhas = gruposVenda[chave], primeira = linhas[0];
    var vid = "iv-" + sha256Hex(chave).slice(0, 20);
    var atual = acharPorChave("est_vendas", vid);
    var itens = {};
    linhas.forEach(function (r) {
      var k = r.itemId + "|" + r.precoUnitario;
      if (!itens[k]) itens[k] = { id: vid + "-" + sha256Hex(k).slice(0, 8), itemId: r.itemId, quantidade: 0, unidade: r.unidade, precoUnitario: r.precoUnitario, desconto: 0 };
      itens[k].quantidade += qtdMil(r.quantidade) || 0;
      itens[k].desconto += r.desconto || 0;
    });
    var listaItens = Object.keys(itens).map(function (k) { var i = itens[k]; i.quantidade = qtdTexto(i.quantidade); return i; });
    var entregue = linhas.every(function (r) { return r.entregueEm; }) ? linhas.map(function (r) { return r.entregueEm; }).sort().pop() : "";
    var dados = { data: primeira.data, pacienteNome: primeira.paciente, entregueEm: entregue || (atual ? atual.entregueEm : ""), itens: listaItens };
    if (atual && atual.estado === "cancelada") return;
    if (atual) {
      var antes = lerTudo("est_venda_itens").filter(function (i) { return i.vendaId === vid; })
        .map(function (i) { return [i.id, i.itemId, i.quantidade, i.precoUnitario, Number(i.desconto) || 0]; }).sort();
      var depois = listaItens.map(function (i) { return [i.id, i.itemId, i.quantidade, i.precoUnitario, i.desconto]; }).sort();
      if (canonico(antes) === canonico(depois) && (atual.entregueEm || "") === (dados.entregueEm || "") && atual.data === dados.data) return;
    }
    var pv = planejarVenda(ctx, { operacaoId: op.operacaoId, id: vid, revBase: atual ? atual.rev : 0, origem: "importacao", externoId: primeira.vendaExterna, loteId: lote, dados: dados });
    escritas = escritas.concat(pv.escritas);
  });
  var hist = { id: lote, modulo: modulo, arquivo: op.arquivo, planilha: op.planilha, mapeamento: op.mapeamento, total: analise.length,
    importadas: importadas, repetidas: repetidas, erros: comErro, detalhes: detalhes.slice(0, 200), estado: "concluida",
    criadoEm: agoraISO(), criadoPor: quem.nome, operacaoId: op.operacaoId };
  escritas.push({ t: "inserir", tabela: "sis_importacoes", registro: hist });
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento(modulo, "importacao", lote, "importou", "Planilha",
    "", op.arquivo + " — " + importadas + " registro(s); " + repetidas + " repetido(s) e " + comErro + " com erro deixados de fora")], op.operacaoId));
  return { escritas: escritas, resultado: { lote: lote, importadas: importadas, repetidas: repetidas, erros: comErro, detalhes: detalhes.slice(0, 200) } };
}

function escritasDeLinhaDeEstoque(ctx, op, r, lote) {
  var saida = [];
  var atual = acharPorChave("est_itens", r.itemId);
  var valores = atual ? {} : { id: r.itemId, nome: r.nome, codigo: r.codigo, categoria: r.categoria, unidadeCompra: r.unidade, unidadeConsumo: r.unidade,
    fator: "", minimo: r.minimo, origem: "importacao", externoId: r.codigo, local: r.local, ativo: true, notas: "", criadoEm: agoraISO() };
  if (atual) {
    if (r.nome && r.nome !== atual.nome) valores.nome = r.nome;
    if (r.categoria) valores.categoria = r.categoria;
    if (r.minimo && !atual.minimo) valores.minimo = r.minimo;
  }
  var mudouCusto = r.custoUnitario !== null && (!atual || !mesmoValor(atual.custoUnitario, r.custoUnitario));
  if (mudouCusto) { valores.custoUnitario = r.custoUnitario; valores.custoFonte = "importacao"; }
  if (!atual || Object.keys(valores).length) {
    var reg = carimbar(registroCompleto("est_itens", valores, atual), (atual ? Number(atual.rev) || 0 : 0) + 1, ctx, op.operacaoId);
    saida.push({ t: "gravar", tabela: "est_itens", registro: reg });
    if (mudouCusto) saida = saida.concat(escritasDeCustoDoItem(ctx, op, reg));
  }
  if (r.quantidade !== "") {
    saida.push({ t: "inserir", tabela: "est_saldos", registro: { id: r.saldoId, itemId: r.itemId, local: r.local, quantidade: r.quantidade, lote: r.lote,
      validade: r.validade || null, custoUnitario: r.custoUnitario, fonte: "importacao", loteImportacao: lote, observadoEm: new Date(r.dataRetrato + "T12:00:00Z").toISOString() } });
  }
  return saida;
}

function importacaoHistorico(ctx) {
  var modulo = conferirModuloDeImportacao(ctx);
  return lerComConsistencia(function () {
    return { lotes: lerTudo("sis_importacoes").filter(function (l) { return l.modulo === modulo; }).reverse().slice(0, 50)
      .map(function (l) { return { id: l.id, arquivo: l.arquivo, planilha: l.planilha, total: l.total, importadas: l.importadas,
        repetidas: l.repetidas, erros: l.erros, criadoEm: l.criadoEm, criadoPor: l.criadoPor, detalhes: l.detalhes }; }) };
  });
}
