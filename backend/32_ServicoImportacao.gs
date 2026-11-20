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

function conferirModuloDeImportacao(ctx) {
  var m = String(ctx.dados.modulo || "");
  if (MODULOS_IMPORTACAO.indexOf(m) < 0) falhar("dados_invalidos", "Este módulo não importa planilhas.");
  if (m === "entradas" && !eAdministrador(ctx.auth)) falhar("sem_permissao", "Só administradores importam entradas em lote.");
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

function analisarLinhas(modulo, linhas) {
  var cx = modulo === "financeiro" ? contextoDespesas() : contextoEntradas();
  var conferir = modulo === "financeiro" ? conferirLinhaDespesa : conferirLinhaEntrada;
  var vistas = {};
  return linhas.map(function (l, i) {
    var r = conferir(l, cx);
    r.indice = i;
    if (!r.erros.length) {
      if (r.repetidaDe) r.repetida = "já existe um registro igual (mesma data, valor e nome)";
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
  analise.forEach(function (x) {
    if (x.erros.length) { comErro++; detalhes.push({ linha: x.indice + 1, erros: x.erros }); return; }
    if (x.repetida && !incluir[x.indice]) { repetidas++; detalhes.push({ linha: x.indice + 1, repetida: x.repetida }); return; }
    var id = lote + "-" + (x.indice + 1);
    var r = x.registro;
    if (modulo === "financeiro") {
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
  var hist = { id: lote, modulo: modulo, arquivo: op.arquivo, planilha: op.planilha, mapeamento: op.mapeamento, total: analise.length,
    importadas: importadas, repetidas: repetidas, erros: comErro, detalhes: detalhes.slice(0, 200), estado: "concluida",
    criadoEm: agoraISO(), criadoPor: quem.nome, operacaoId: op.operacaoId };
  escritas.push({ t: "inserir", tabela: "sis_importacoes", registro: hist });
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento(modulo, "importacao", lote, "importou", "Planilha",
    "", op.arquivo + " — " + importadas + " registro(s); " + repetidas + " repetido(s) e " + comErro + " com erro deixados de fora")], op.operacaoId));
  return { escritas: escritas, resultado: { lote: lote, importadas: importadas, repetidas: repetidas, erros: comErro, detalhes: detalhes.slice(0, 200) } };
}

function importacaoHistorico(ctx) {
  var modulo = conferirModuloDeImportacao(ctx);
  return lerComConsistencia(function () {
    return { lotes: lerTudo("sis_importacoes").filter(function (l) { return l.modulo === modulo; }).reverse().slice(0, 50)
      .map(function (l) { return { id: l.id, arquivo: l.arquivo, planilha: l.planilha, total: l.total, importadas: l.importadas,
        repetidas: l.repetidas, erros: l.erros, criadoEm: l.criadoEm, criadoPor: l.criadoPor, detalhes: l.detalhes }; }) };
  });
}
