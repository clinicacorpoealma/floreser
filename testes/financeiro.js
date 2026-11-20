/* Testes do Financeiro e da importação de planilhas — dados sintéticos. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");

function ambiente() {
  const a = novoAmbiente();
  a.ana = a.criarConta({ usuario: "ana", nome: "Ana Sintética", senha: "segredo-ana", admin: true });
  a.fabi = a.criarConta({ usuario: "fabi", nome: "Fabi Sintética", senha: "segredo-fabi", financeiro: true });
  a.bia = a.criarConta({ usuario: "bia", nome: "Bia Sintética", senha: "segredo-bia", crm: true, agenda: true, entradas: true });
  a.sim.agora = Date.parse("2026-11-20T15:00:00Z");
  a.tk = a.entrar("fabi", "segredo-fabi");
  return a;
}

function aplicar(a, ops, tk) {
  const r = a.pedir("financeiro.aplicar", { operacoes: ops }, tk || a.tk);
  v.ok(r);
  return r.dados.resultados;
}

function um(a, op, tk) {
  const r = aplicar(a, [op], tk)[0];
  if (!r.ok) throw new Error("operação recusada: " + JSON.stringify(r.erro));
  return r;
}

function despesa(a, id, dados, extra) {
  return um(a, a.op("despesa.criar", Object.assign({ id, dados: Object.assign({ descricao: "Despesa " + id, valor: 10000, vencimento: "2026-11-25", categoriaId: "cat-aluguel" }, dados || {}) }, extra || {})));
}

/* =========================== Permissões =========================== */

teste("Financeiro: só quem tem a permissão (ou administra); Entradas não dá Financeiro; senha compartilhada não entra", () => {
  const a = ambiente();
  v.ok(a.pedir("financeiro.ler", {}, a.tk));
  v.ok(a.pedir("financeiro.ler", {}, a.entrar("ana", "segredo-ana")), "administradora entra");
  const tkBia = a.entrar("bia", "segredo-bia");
  v.erro(a.pedir("financeiro.ler", {}, tkBia), "sem_acesso", "quem tem Entradas não lê o Financeiro");
  v.erro(a.pedir("financeiro.resumo", {}, tkBia), "sem_acesso", "nem o resumo");
  v.erro(a.pedir("financeiro.aplicar", { operacoes: [a.op("despesa.criar", { id: "x1", dados: { descricao: "x", valor: 1, vencimento: "2026-11-01" } })] }, tkBia), "sem_acesso");
  v.erro(a.pedir("importacao.previa", { modulo: "financeiro", linhas: [{}] }, tkBia), "sem_acesso", "nem a importação");
  v.erro(a.pedir("sessao.entrarModulo", { modulo: "financeiro", senha: "qualquer" }), "dados_invalidos", "não existe senha compartilhada do Financeiro");
  const busca = v.ok(a.pedir("busca.global", { termo: "despesa" }, tkBia));
  v.falso(busca.procurouEm.financeiro, "a busca de quem não tem Financeiro não procura despesas");
  despesa(a, "d1");
  const b2 = v.ok(a.pedir("busca.global", { termo: "despesa" }, a.tk));
  v.verdade(b2.resultados.some((r) => r.modulo === "financeiro"), "quem tem Financeiro acha a despesa");
});

/* ======================== Pagamentos e estado ======================== */

teste("pagamento parcial: estado pendente → parcial → paga; valor acima do saldo é recusado; pagar é sempre explícito", () => {
  const a = ambiente();
  let r = despesa(a, "d1", { valor: 30000 });
  v.igual(r.entidade._estado, "pendente");
  r = um(a, a.op("pagamento.registrar", { despesaId: "d1", revBase: 1, dados: { id: "pg1", data: "2026-11-20", valor: 10000, meio: "pix" } }));
  v.igual(r.entidade._estado, "parcial");
  v.igual(r.entidade._saldo, 20000);
  const acima = aplicar(a, [a.op("pagamento.registrar", { despesaId: "d1", revBase: 2, dados: { id: "pg2", data: "2026-11-20", valor: 25000 } })])[0];
  v.verdade(!acima.ok && /saldo/.test(acima.erro.mensagem), "acima do saldo recusado");
  const futuro = aplicar(a, [a.op("pagamento.registrar", { despesaId: "d1", revBase: 2, dados: { id: "pg3", data: "2026-12-30", valor: 100 } })])[0];
  v.verdade(!futuro.ok && /previsão/.test(futuro.erro.mensagem), "pagamento com data futura é previsão, não pagamento");
  r = um(a, a.op("pagamento.registrar", { despesaId: "d1", revBase: 2, dados: { id: "pg4", data: "2026-11-20", valor: 20000 } }));
  v.igual(r.entidade._estado, "paga");
  /* passou o vencimento sem pagar: vencida, mas continua sem pagamento */
  despesa(a, "d2", { vencimento: "2026-11-10" });
  const lido = v.ok(a.pedir("financeiro.ler", {}, a.tk));
  const d2 = lido.despesas.find((d) => d.id === "d2");
  v.igual(d2._estado, "vencida");
  v.igual(d2._pago, 0, "vencer não paga nada");
});

teste("estorno: corrige com histórico (pagamento + estorno), não apaga; cancelar exige estornar antes", () => {
  const a = ambiente();
  despesa(a, "d1", { valor: 5000 });
  um(a, a.op("pagamento.registrar", { despesaId: "d1", revBase: 1, dados: { id: "pg1", data: "2026-11-19", valor: 5000 } }));
  const canc = aplicar(a, [a.op("despesa.cancelar", { id: "d1", revBase: 2, motivo: "lançada errada" })])[0];
  v.verdade(!canc.ok, "não cancela despesa com pagamento");
  const r = um(a, a.op("pagamento.estornar", { despesaId: "d1", revBase: 2, movimentoId: "pg1", dados: { id: "es1", data: "2026-11-20", notas: "valor errado" } }));
  v.igual(r.entidade._estado, "pendente");
  const dup = aplicar(a, [a.op("pagamento.estornar", { despesaId: "d1", revBase: 3, movimentoId: "pg1", dados: { id: "es2" } })])[0];
  v.verdade(!dup.ok, "não estorna duas vezes");
  const movs = a.linhas("fin_movimentos");
  v.igual(movs.map((m) => m.tipo), ["pagamento", "estorno"], "os dois ficam");
  v.verdade(a.linhas("sis_auditoria").some((e) => e.acao === "estornou" && e.entidadeId === "d1"));
  um(a, a.op("despesa.cancelar", { id: "d1", revBase: 3, motivo: "lançada errada" }));
});

teste("pagamento repetido (mesma operação, resposta perdida) não duplica", () => {
  const a = ambiente();
  despesa(a, "d1", { valor: 5000 });
  const op = a.op("pagamento.registrar", { despesaId: "d1", revBase: 1, dados: { id: "pg1", data: "2026-11-20", valor: 2000 } });
  um(a, op);
  const r2 = aplicar(a, [op])[0];
  v.verdade(r2.ok && r2.repetida, "reconhecida como repetição");
  v.igual(a.linhas("fin_movimentos").length, 1);
});

/* ============================ Parcelas ============================ */

teste("parcelamento: 100,00 em 3 = 33,34 + 33,33 + 33,33, cada parcela com identidade e vencimento; a compra não conta à parte", () => {
  const a = ambiente();
  const r = despesa(a, "comp", { descricao: "Autoclave", valor: 10000, vencimento: "2026-01-31", categoriaId: "cat-equipamentos" },
    { parcelamento: { quantidade: 3, primeiroVencimento: "2026-01-31", frequencia: "mensal" } });
  v.igual(r.entidades.map((e) => e.valor), [3334, 3333, 3333]);
  v.igual(r.entidades.map((e) => e.vencimento), ["2026-01-31", "2026-02-28", "2026-03-31"], "fim de mês guardando o dia original");
  v.igual(r.entidades.map((e) => e.id), ["comp-1", "comp-2", "comp-3"]);
  const linhas = a.linhas("fin_despesas");
  v.igual(linhas.length, 3, "só as parcelas são despesas");
  v.igual(linhas.reduce((s, d) => s + d.valor, 0), 10000, "soma exata");
  v.igual(a.linhas("fin_grupos")[0].valorTotal, 10000);
  /* mesma divisão, sempre */
  a.gs.reiniciarExecucao();
  v.igual(a.gs.dividirCentavos(10001, 4), [2501, 2500, 2500, 2500]);
  v.igual(a.gs.dividirCentavos(2, 3), [1, 1, 0]);
});

/* ========================== Recorrências ========================== */

teste("recorrência: dia 31 respeita o fim do mês; gerar de novo não duplica; prévia nunca é paga", () => {
  const a = ambiente();
  const r = um(a, a.op("recorrencia.criar", { id: "rec1", dados: { descricao: "Aluguel", valor: 250000, categoriaId: "cat-aluguel", frequencia: "mensal", inicio: "2026-10-31", quantidade: 6 }, gerarAte: "2027-01-31" }));
  v.igual(r.geradas, 4);
  let ds = a.linhas("fin_despesas").map((d) => d.vencimento).sort();
  v.igual(ds, ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]);
  const g = um(a, a.op("recorrencia.gerar", { id: "rec1", revBase: 1, ate: "2027-01-31" }));
  v.igual(g.geradas, 0, "repetir a geração não duplica");
  const g2 = um(a, a.op("recorrencia.gerar", { id: "rec1", revBase: 1, ate: "2027-12-31" }));
  v.igual(g2.geradas, 2, "só até a quantidade (6)");
  v.igual(a.linhas("fin_despesas").length, 6);
  v.igual(a.linhas("fin_movimentos").length, 0, "nenhuma ocorrência paga sozinha");
  a.gs.reiniciarExecucao();
  v.igual(a.gs.datasDaSerie("2024-01-31", "mensal", { quantidade: 3 }).map((x) => x.data), ["2024-01-31", "2024-02-29", "2024-03-31"], "ano bissexto");
});

teste("recorrência: 'esta e as seguintes' preserva ocorrência paga; encerrar cancela só as futuras sem pagamento", () => {
  const a = ambiente();
  um(a, a.op("recorrencia.criar", { id: "rec1", dados: { descricao: "Internet", valor: 10000, frequencia: "mensal", inicio: "2026-11-05", quantidade: 4 }, gerarAte: "2027-02-05" }));
  um(a, a.op("pagamento.registrar", { despesaId: "rec1-2", revBase: 1, dados: { id: "pg1", data: "2026-11-20", valor: 10000 } }));
  const alt = um(a, a.op("recorrencia.alterar", { id: "rec1", revBase: 1, aPartirDe: "2026-11-05", campos: { valor: 12000 } }));
  v.igual(alt.preservadas, 1);
  v.igual(alt.alteradas, 3);
  const porId = {};
  a.linhas("fin_despesas").forEach((d) => { porId[d.id] = d; });
  v.igual(porId["rec1-2"].valor, 10000, "a paga não mudou");
  v.igual(porId["rec1-3"].valor, 12000);
  const enc = um(a, a.op("recorrencia.encerrar", { id: "rec1", revBase: 2, fim: "2026-12-31" }));
  v.igual(enc.canceladas, 2, "janeiro e fevereiro: depois do fim e sem pagamento");
  a.linhas("fin_despesas").forEach((d) => { porId[d.id] = d; });
  v.verdade(porId["rec1-3"].cancelada && porId["rec1-4"].cancelada);
  v.falso(porId["rec1-1"].cancelada === true, "a de novembro, antes do fim, fica");
  v.falso(porId["rec1-2"].cancelada === true, "a paga fica");
});

/* ===================== Caixa · competência · previsão ===================== */

teste("resumo: caixa, competência e previsão são bases separadas; período anterior na mesma base; orçamento alerta", () => {
  const a = ambiente();
  despesa(a, "a1", { valor: 10000, vencimento: "2026-11-10", competencia: "2026-10" });
  despesa(a, "a2", { valor: 20000, vencimento: "2026-11-28" });
  despesa(a, "a3", { valor: 5000, vencimento: "2026-10-05" });
  um(a, a.op("pagamento.registrar", { despesaId: "a3", revBase: 1, dados: { id: "p3", data: "2026-11-02", valor: 5000 } }));
  um(a, a.op("pagamento.registrar", { despesaId: "a2", revBase: 1, dados: { id: "p2", data: "2026-11-20", valor: 5000 } }));
  um(a, a.op("orcamento.definir", { categoriaId: "cat-aluguel", mes: "2026-11", valor: 22000, alertaPct: 90 }));
  const tkAna = a.entrar("ana", "segredo-ana");
  v.ok(a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.criar", { id: "e1", dados: { nome: "Paciente", data: "2026-11-15",
    pagamentos: [{ metodo: "pix", valor: 40000, parcelas: 1 }, { metodo: "haver", valor: 3000, parcelas: 1 }] } })] }, tkAna));
  const r = v.ok(a.pedir("financeiro.resumo", { filtros: { de: "2026-11", ate: "2026-11" } }, a.tk));
  v.igual(r.atual.caixa, 10000, "caixa: pagamentos em novembro (a3 + parte de a2)");
  v.igual(r.atual.competencia, 20000, "competência: só a2 é de novembro (a1 é de outubro)");
  v.igual(r.atual.previsao, 25000, "previsão: saldo a pagar com vencimento em novembro (a1 inteiro + resto de a2)");
  v.igual(r.atual.vencidas.total, 10000, "a1 venceu sem pagamento");
  v.igual(r.anterior.periodo.de, "2026-10");
  v.igual(r.anterior.competencia, 15000, "outubro: a1 (competência) + a3");
  v.igual(r.atual.entradas.recebido, 40000);
  v.igual(r.atual.entradas.emHaver, 3000, "em haver fica pendente, fora do recebido");
  v.igual(r.atual.resultadoParcial.valor, 30000);
  v.verdade(/Não é lucro líquido/.test(r.atual.resultadoParcial.explicacao));
  v.falso(r.atual.saldo.confiavel, "sem saldo inicial, nada de saldo presumido");
  v.verdade(r.atual.alertasOrcamento.some((x) => x.categoriaId === "cat-aluguel" && x.usoPct >= 90));
  um(a, a.op("saldo.definir", { id: "s1", dados: { conta: "Banco", data: "2026-10-31", valor: 100000 } }));
  const r2 = v.ok(a.pedir("financeiro.resumo", { filtros: { de: "2026-11", ate: "2026-11" } }, a.tk));
  v.verdade(r2.atual.saldo.confiavel);
  v.igual(r2.atual.saldo.valor, 100000 + 40000 - 10000);
});

/* ============================ Precificação ============================ */

function fichaBase() {
  return { tipo: "procedimento", nome: "Limpeza de pele", precoAtual: 18000, dados: {
    itens: [{ insumoId: "i1", quantidade: "10", unidade: "ml" }], tempoMin: "60", maoDeObraHora: 4000,
    equipamentos: [{ nome: "Vapor", custoPorUso: 300 }], rateio: { modo: "por_hora", valor: 2000, categorias: ["cat-aluguel"] },
    taxaPagamentoPct: "3", comissaoPct: "10", impostosPct: "6", margemPct: "21" } };
}

teste("precificação: preço sugerido = C / (1 − r − m), com memória de cálculo; margem ≠ markup", () => {
  const a = ambiente();
  um(a, a.op("insumo.salvar", { id: "i1", dados: { nome: "Gel", unidadeCompra: "frasco", conteudo: "500", unidadeConteudo: "ml", valorEmbalagem: 5000, perdaPct: "10" } }));
  const r = um(a, a.op("ficha.salvar", { id: "f1", dados: fichaBase() }));
  const c = r.entidade._calculo;
  v.verdade(c.completo, JSON.stringify(c.faltando));
  /* gel: 50,00/500 ml × 10 ml × 1,1 = 1,10 · mão de obra 40,00 · vapor 3,00 → direto 44,10; rateio 20,00 → C = 64,10 */
  v.igual(c.custoDireto, 4410);
  v.igual(c.rateio, 2000);
  v.igual(c.custoTotal, 6410);
  v.igual(c.precoSugerido, Math.round(6410 / (1 - 0.19 - 0.21)));
  v.verdade(c.memoria.some((l) => /Preço sugerido/.test(l)), "memória de cálculo");
  v.verdade(c.noAtual.markup > 1 && c.noAtual.resultadoPct < 100, "markup (multiplicador) e margem (%) são números diferentes");
  /* simular desconto e cartão parcelado não muda a ficha */
  const s = v.ok(a.pedir("financeiro.simular", { fichaId: "f1", simulacao: { descontoPct: "10", taxaPagamentoPct: "5", parcelas: 3 } }, a.tk));
  v.igual(s.simulacao.preco, 16200);
  v.igual(s.simulacao.parcelas, 3);
  v.igual(a.linhas("fin_fichas")[0].rev, 1, "simulação não grava");
});

teste("precificação incompleta: campo vazio não vira zero, sem preço sugerido; denominador ≤ 0 bloqueia; aprovar exige completa", () => {
  const a = ambiente();
  um(a, a.op("insumo.salvar", { id: "i1", dados: { nome: "Gel", conteudo: "500", unidadeConteudo: "ml", valorEmbalagem: 5000 } }));
  const f = fichaBase();
  f.dados.impostosPct = "";
  f.dados.itens.push({ insumoId: "i1", quantidade: "2", unidade: "g" });
  const r = um(a, a.op("ficha.salvar", { id: "f1", dados: f }));
  const c = r.entidade._calculo;
  v.falso(c.completo);
  v.verdade(c.faltando.some((x) => /impostos/.test(x)), "impostos em branco é falta, não zero");
  v.verdade(c.faltando.some((x) => /não converte/.test(x)), "grama não converte para ml");
  v.verdade(c.precoSugerido === undefined);
  const ap = aplicar(a, [a.op("ficha.aprovar", { id: "f1", revBase: 1 })])[0];
  v.verdade(!ap.ok, "não aprova incompleta");
  const f2 = fichaBase(); f2.dados.margemPct = "85";
  const r2 = um(a, a.op("ficha.salvar", { id: "f1", revBase: 1, dados: f2 }));
  v.verdade(/não existe preço/.test(r2.entidade._calculo.bloqueio), "r + m ≥ 100% bloqueia");
  const f3 = fichaBase();
  const r3 = um(a, a.op("ficha.salvar", { id: "f1", revBase: 2, dados: f3 }));
  v.verdade(r3.entidade._calculo.avisos.length === 0);
  f3.dados.rateio.categorias = ["cat-materiais"];
  const r4 = um(a, a.op("ficha.salvar", { id: "f1", revBase: 3, dados: f3 }));
  v.verdade(r4.entidade._calculo.avisos.some((x) => /duas vezes/.test(x)), "rateio de Materiais com material direto avisa dupla contagem");
  const ap2 = um(a, a.op("ficha.aprovar", { id: "f1", revBase: 4 }));
  v.igual(ap2.versao, 1);
  v.igual(a.linhas("fin_fichas_versoes")[0].dados.insumos.i1.valorEmbalagem, 5000, "a versão aprovada guarda o retrato dos materiais");
});

teste("pacote: custo por composição; sessões ≠ parcelas", () => {
  const a = ambiente();
  um(a, a.op("insumo.salvar", { id: "i1", dados: { nome: "Gel", conteudo: "500", unidadeConteudo: "ml", valorEmbalagem: 5000, perdaPct: "10" } }));
  um(a, a.op("ficha.salvar", { id: "f1", dados: fichaBase() }));
  const r = um(a, a.op("ficha.salvar", { id: "pk", dados: { tipo: "pacote", nome: "Pacote 4 sessões", precoAtual: 60000,
    dados: { componentes: [{ fichaId: "f1", quantidade: "4" }], taxaPagamentoPct: "3", comissaoPct: "10", impostosPct: "6", margemPct: "15" } } }));
  const c = r.entidade._calculo;
  v.verdade(c.completo, JSON.stringify(c.faltando));
  v.igual(c.custoDireto, 4410 * 4);
  v.igual(c.rateio, 2000 * 4);
  const s = v.ok(a.pedir("financeiro.simular", { fichaId: "pk", simulacao: { parcelas: 10 } }, a.tk));
  v.igual(s.simulacao.parcelas, 10, "10 parcelas de pagamento num pacote de 4 sessões");
  v.igual(s.simulacao.valorParcela, 6000);
});

/* ============================ Importação ============================ */

teste("importação de despesas: prévia por linha, repetidas detectadas, lote com histórico, reenvio não duplica", () => {
  const a = ambiente();
  despesa(a, "ja", { descricao: "Conta de luz", valor: 31050, vencimento: "2026-11-15" });
  const linhas = [
    { descricao: "Conta de luz", valor: 31050, vencimento: "2026-11-15", categoria: "Energia" },
    { descricao: "Água", valor: 9000, vencimento: "2026-11-18", categoria: "agua", fornecedor: "Companhia Sintética" },
    { descricao: "", valor: 100, vencimento: "2026-11-18" },
    { descricao: "Água", valor: 9000, vencimento: "2026-11-18" },
    { descricao: "Software", valor: 12000, vencimento: "2026-11-02", pagoEm: "2026-11-02", categoria: "Inexistente" }
  ];
  const p = v.ok(a.pedir("importacao.previa", { modulo: "financeiro", linhas }, a.tk));
  v.igual(p.contagem, { total: 5, validas: 2, repetidas: 2, comErro: 1 });
  v.verdade(/já existe/.test(p.linhas[0].repetida));
  v.verdade(/linha 2/.test(p.linhas[3].repetida), "repetida dentro do próprio arquivo");
  v.verdade(p.linhas[1].avisos.some((x) => /fornecedor/.test(x)));
  v.verdade(p.linhas[4].avisos.some((x) => /categoria/.test(x)));
  v.igual(a.linhas("fin_despesas").length, 1, "prévia não grava");
  const pedido = { operacaoId: "imp-lote-000001", modulo: "financeiro", arquivo: "despesas.xlsx", planilha: "Plan1", mapeamento: { A: "descricao" }, linhas };
  const c = v.ok(a.pedir("importacao.confirmar", pedido, a.tk));
  v.igual([c.importadas, c.repetidas, c.erros], [2, 2, 1]);
  v.igual(a.linhas("fin_despesas").length, 3);
  v.igual(a.linhas("fin_movimentos").length, 1, "'pago em' explícito da planilha vira pagamento com evidência");
  v.verdade(/planilha/.test(a.linhas("fin_movimentos")[0].evidencia));
  v.igual(a.linhas("sis_importacoes").length, 1);
  const c2 = v.ok(a.pedir("importacao.confirmar", pedido, a.tk));
  v.verdade(c2.repetida, "mesmo lote de novo é reconhecido");
  v.igual(a.linhas("fin_despesas").length, 3, "nada duplicado");
  const h = v.ok(a.pedir("importacao.historico", { modulo: "financeiro" }, a.tk));
  v.igual(h.lotes[0].importadas, 2);
});

teste("importação de entradas: só administradora; sai com origem 'importacao'", () => {
  const a = ambiente();
  const tkBia = a.entrar("bia", "segredo-bia");
  const linhas = [{ nome: "Paciente Sintética", data: "2026-11-10", valor: 25000, metodo: "Crédito", parcelas: 2 }];
  v.erro(a.pedir("importacao.previa", { modulo: "entradas", linhas }, tkBia), "sem_permissao");
  const tkAna = a.entrar("ana", "segredo-ana");
  const c = v.ok(a.pedir("importacao.confirmar", { operacaoId: "imp-ent-000001", modulo: "entradas", arquivo: "e.csv", linhas }, tkAna));
  v.igual(c.importadas, 1);
  const e = v.ok(a.pedir("entradas.ler", {}, tkAna)).entradas[0];
  v.igual(e.origem, "importacao");
  v.igual(e.pagamentos, [{ metodo: "credito", valor: 25000, parcelas: 2 }]);
});

module.exports = () => executar("Financeiro");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
