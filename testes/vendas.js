/* Vendas de produtos, livro do estoque e custo histórico (4.3.0) — dados sintéticos. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");

function ambiente() {
  const a = novoAmbiente();
  a.sim.agora = Date.parse("2026-11-20T15:00:00Z");
  a.criarConta({ usuario: "fabi", nome: "Fabi Sintética", senha: "segredo-fabi", financeiro: true });
  a.tk = a.entrar("fabi", "segredo-fabi");
  return a;
}
function aplicar(a, op) {
  return v.ok(a.pedir("financeiro.aplicar", { operacoes: [a.op(op.tipo, op)] }, a.tk)).resultados[0];
}
function um(a, op) {
  const x = aplicar(a, op);
  if (!x.ok) throw new Error("recusado: " + JSON.stringify(x.erro));
  return x;
}
function estoque(a) { return v.ok(a.pedir("financeiro.estoque", {}, a.tk)); }
function item(a, id) { return estoque(a).itens.find((i) => i.id === id); }
function depois(a, min) { a.sim.agora += (min || 1) * 60000; }
function produto(a, id, nome, extra) {
  um(a, { tipo: "estoque.item.salvar", id, revBase: 0, dados: Object.assign({ nome, codigo: id.toUpperCase(), unidadeConsumo: "un" }, extra || {}) });
}
function entrada(a, itemId, mid, qtd, custo, data) {
  depois(a);
  return um(a, { tipo: "estoque.movimento", itemId, dados: { id: mid, tipo: "entrada", quantidade: qtd, custoUnitario: custo, data } });
}
function vender(a, id, dados, revBase) {
  depois(a);
  return um(a, { tipo: "venda.salvar", id, revBase: revBase || 0, dados });
}
function importarVendas(a, linhas, opId) {
  depois(a);
  return v.ok(a.pedir("importacao.confirmar", { operacaoId: opId || "imp-vd-" + Math.random().toString(36).slice(2, 12), modulo: "financeiro", tipo: "vendas",
    arquivo: "vendas.xlsx", mapeamento: { A: "data" }, linhas }, a.tk));
}

teste("o exemplo: 10 a R$ 30; 2 a R$ 50 e 1 a R$ 45 → saldo 7, vendido R$ 145, custo R$ 90, diferença R$ 55", () => {
  const a = ambiente();
  produto(a, "serum", "Sérum sintético");
  entrada(a, "serum", "mv-ent-0001", "10", 3000);
  v.igual(item(a, "serum").custoMedio, 3000, "custo comprovado pela compra");
  vender(a, "vd-000001", { data: "2026-11-20", entregueEm: "2026-11-20", pacienteNome: "Paciente A", itens: [{ itemId: "serum", quantidade: "2", precoUnitario: 5000 }] });
  vender(a, "vd-000002", { data: "2026-11-20", entregueEm: "2026-11-20", pacienteNome: "Paciente B", itens: [{ itemId: "serum", quantidade: "1", precoUnitario: 4500 }] });
  const s = item(a, "serum");
  v.igual(s.saldo, "7");
  v.igual(s.vendas.quantidade, "3");
  v.igual(s.vendas.vendido, 14500);
  v.igual(s.vendas.custoTotal, 9000);
  v.igual(s.vendas.diferenca, 5500);
  v.verdade(s.vendas.vendas.every((x) => x.custoFonte === "compra"), "custo comprovado, não estimado");
  v.verdade(/Calculado no Alveare/.test(s.origemSaldo));
});

teste("venda com vários produtos e preços diferentes: desconto geral rateado pelo valor; cada produto baixa o seu", () => {
  const a = ambiente();
  produto(a, "p1", "Produto 1"); produto(a, "p2", "Produto 2");
  entrada(a, "p1", "mv-p1-00001", "5", 1000);
  entrada(a, "p2", "mv-p2-00001", "5", 2000);
  const r = vender(a, "vd-multi-01", { data: "2026-11-20", entregueEm: "2026-11-20", descontoGeral: 1000, itens: [
    { itemId: "p1", quantidade: "2", precoUnitario: 3000 },              // 6000
    { itemId: "p2", quantidade: "1", precoUnitario: 4000, desconto: 0 }   // 4000
  ] });
  const t = r.entidade._totais;
  v.igual(t.linhas[0].descontoGeral, 600, "60% do valor → 60% do desconto");
  v.igual(t.linhas[1].descontoGeral, 400);
  v.igual(t.vendido, 9000);
  v.igual(t.custo, 4000);
  v.igual(t.diferenca, 5000);
  v.igual(item(a, "p1").saldo, "3");
  v.igual(item(a, "p2").saldo, "4");
});

teste("reprocessar e parcelar: a mesma venda salva de novo, ou paga em várias vezes, baixa uma vez só", () => {
  const a = ambiente();
  produto(a, "p1", "Produto 1");
  entrada(a, "p1", "mv-p1-00001", "10", 1000);
  const dados = { data: "2026-11-20", entregueEm: "2026-11-20", itens: [{ id: "vd-rep-01-a", itemId: "p1", quantidade: "3", precoUnitario: 2000 }] };
  const r1 = vender(a, "vd-rep-01", dados);
  /* a mesma operação reenviada (mesmo operacaoId) e a mesma venda salva de novo */
  const op = a.op("venda.salvar", { id: "vd-rep-01", revBase: r1.rev, dados });
  v.ok(a.pedir("financeiro.aplicar", { operacoes: [op] }, a.tk));
  v.ok(a.pedir("financeiro.aplicar", { operacoes: [op] }, a.tk));
  v.igual(item(a, "p1").saldo, "7");
  v.igual(a.linhas("est_movimentos").filter((m) => m.tipo === "venda").length, 1, "um movimento de venda");
  /* parcelas são das Entradas: a venda não ganha uma saída por parcela */
  v.igual(a.linhas("ent_pagamentos").length, 0);
  /* relatório importado duas vezes */
  const linhas = [{ venda: "R-77", data: "2026-11-20", codigo: "P1", quantidade: "2", precoUnitario: 2500, entregue: "sim" }];
  importarVendas(a, linhas);
  importarVendas(a, linhas);
  v.igual(item(a, "p1").saldo, "5", "reimportar não desconta de novo");
  v.igual(a.linhas("est_vendas").length, 2);
});

teste("sem saída confirmada não baixa; recebimento não é venda; confirmar a saída baixa depois", () => {
  const a = ambiente();
  produto(a, "p1", "Produto 1");
  entrada(a, "p1", "mv-p1-00001", "4", 1000);
  const r = vender(a, "vd-pend-01", { data: "2026-11-20", itens: [{ itemId: "p1", quantidade: "1", precoUnitario: 2000 }] });
  let e = estoque(a);
  v.igual(e.itens[0].saldo, "4", "pagamento, orçamento ou venda sem entrega não tiram do estoque");
  v.igual(e.saidasAConfirmar, ["vd-pend-01"]);
  depois(a);
  um(a, { tipo: "venda.confirmarSaida", id: "vd-pend-01", revBase: r.rev, data: "2026-11-20" });
  e = estoque(a);
  v.igual(e.itens[0].saldo, "3");
  v.igual(e.saidasAConfirmar, []);
  /* importação sem a coluna "entregue": entra, avisa e não baixa */
  const p = v.ok(a.pedir("importacao.previa", { modulo: "financeiro", tipo: "vendas", linhas: [{ data: "2026-11-20", codigo: "P1", quantidade: "1", precoUnitario: 2000 }] }, a.tk));
  v.verdade(p.linhas[0].avisos.some((x) => /sem confirmação de saída/.test(x)));
  v.verdade(v.ok(a.pedir("importacao.previa", { modulo: "financeiro", tipo: "vendas", linhas: [{ data: "2026-11-20", produto: "Inexistente", quantidade: "1", precoUnitario: 1 }] }, a.tk))
    .linhas[0].erros.some((x) => /não cadastrado/.test(x)), "produto desconhecido não vira item inventado");
});

teste("contagem com corte e depois o histórico: vendas antigas não descontam de novo; as posteriores sim", () => {
  const a = ambiente();
  produto(a, "p1", "Produto 1");
  depois(a);
  um(a, { tipo: "estoque.movimento", itemId: "p1", dados: { id: "ct-0000001", tipo: "contagem", quantidade: "20", custoUnitario: 1500 } });
  importarVendas(a, [
    { venda: "H-1", data: "2026-11-01", codigo: "P1", quantidade: "5", precoUnitario: 3000, entregue: "sim" },   // antes do corte
    { venda: "H-2", data: "2026-11-10", codigo: "P1", quantidade: "2", precoUnitario: 3000, entregue: "sim" }    // antes do corte
  ]);
  let s = item(a, "p1");
  v.igual(s.saldo, "20", "a contagem já reflete as vendas de antes dela");
  v.igual(s.vendas.quantidade, "7", "mas as vendas entram no histórico e no resultado");
  a.sim.agora = Date.parse("2026-11-21T15:00:00Z");
  importarVendas(a, [{ venda: "N-1", data: "2026-11-21", codigo: "P1", quantidade: "3", precoUnitario: 3000, entregue: "sim" }]);
  s = item(a, "p1");
  v.igual(s.saldo, "17");
  v.verdade(s.movimentos.filter((m) => m.tipo === "venda" && !m.conta).length === 2, "as históricas aparecem como fora do saldo");
  v.verdade(/contagem de 20\/11\/2026/.test(s.origemSaldo));
});

teste("item importado (retrato): venda não baixa (a fonte já reflete); assumir no Alveare troca o saldo de vez, sem dois saldos", () => {
  const a = ambiente();
  v.ok(a.pedir("importacao.confirmar", { operacaoId: "imp-est-000001", modulo: "financeiro", tipo: "estoque", arquivo: "estoque.xlsx", mapeamento: {},
    linhas: [{ codigo: "GEL", nome: "Gel", unidade: "UN", quantidade: "10", custoUnitario: 800 }] }, a.tk));
  const gel = estoque(a).itens[0];
  v.igual(gel.modoSaldo, "retrato");
  vender(a, "vd-ret-01", { data: "2026-11-20", entregueEm: "2026-11-20", itens: [{ itemId: gel.id, quantidade: "2", precoUnitario: 2000 }] });
  v.igual(item(a, gel.id).saldo, "10", "o próximo arquivo traz a saída");
  v.igual(item(a, gel.id).vendas.vendas[0].custoFonte, "importacao", "custo da fonte, identificado");
  /* novo arquivo da fonte com 8: continua um saldo só */
  a.sim.agora = Date.parse("2026-11-21T15:00:00Z");
  v.ok(a.pedir("importacao.confirmar", { operacaoId: "imp-est-000002", modulo: "financeiro", tipo: "estoque", arquivo: "estoque.xlsx", mapeamento: {},
    linhas: [{ codigo: "GEL", nome: "Gel", unidade: "UN", quantidade: "8", custoUnitario: 800 }] }, a.tk));
  v.igual(item(a, gel.id).saldo, "8");
  /* assumir: contagem com corte; daqui em diante, o Alveare calcula */
  depois(a);
  um(a, { tipo: "estoque.movimento", itemId: gel.id, dados: { id: "ct-assumir1", tipo: "contagem", quantidade: "8" } });
  vender(a, "vd-ret-02", { data: "2026-11-21", entregueEm: "2026-11-21", itens: [{ itemId: gel.id, quantidade: "1", precoUnitario: 2000 }] });
  v.igual(item(a, gel.id).saldo, "7");
  v.igual(item(a, gel.id).modoSaldo, "livro");
  /* um arquivo novo da fonte não compete com o livro */
  a.sim.agora = Date.parse("2026-11-22T15:00:00Z");
  v.ok(a.pedir("importacao.confirmar", { operacaoId: "imp-est-000003", modulo: "financeiro", tipo: "estoque", arquivo: "estoque.xlsx", mapeamento: {},
    linhas: [{ codigo: "GEL", nome: "Gel", unidade: "UN", quantidade: "50", custoUnitario: 800 }] }, a.tk));
  v.igual(item(a, gel.id).saldo, "7", "o arquivo vira só registro enquanto o saldo é do Alveare");
  /* voltar ao retrato: o saldo volta a ser o da fonte, o livro fica como histórico */
  um(a, { tipo: "estoque.voltarAoRetrato", itemId: gel.id });
  v.igual(item(a, gel.id).saldo, "50");
});

teste("correção e devolução: mudar a quantidade estorna e refaz; devolução só repõe com retorno físico; cancelar desfaz tudo uma vez", () => {
  const a = ambiente();
  produto(a, "p1", "Produto 1");
  entrada(a, "p1", "mv-p1-00001", "10", 1000);
  let r = vender(a, "vd-cor-01", { data: "2026-11-20", entregueEm: "2026-11-20", itens: [{ id: "vd-cor-01-a", itemId: "p1", quantidade: "3", precoUnitario: 2000 }] });
  r = vender(a, "vd-cor-01", { data: "2026-11-20", entregueEm: "2026-11-20", itens: [{ id: "vd-cor-01-a", itemId: "p1", quantidade: "4", precoUnitario: 2000 }] }, r.rev);
  v.igual(item(a, "p1").saldo, "6");
  const movs = a.linhas("est_movimentos");
  v.igual(movs.filter((m) => m.tipo === "estorno").length, 1, "o movimento antigo fica, estornado");
  v.igual(movs.filter((m) => m.tipo === "venda").length, 2);
  depois(a);
  um(a, { tipo: "venda.devolver", id: "vd-cor-01", revBase: r.rev, vendaItemId: "vd-cor-01-a", quantidade: "1", retornoFisico: false, motivo: "reclamação" });
  v.igual(item(a, "p1").saldo, "6", "sem retorno físico, o estoque não muda");
  let v1 = estoque(a).vendas.find((x) => x.id === "vd-cor-01");
  v.igual(v1._totais.vendido, 6000, "o vendido cai");
  depois(a);
  um(a, { tipo: "venda.devolver", id: "vd-cor-01", revBase: v1._rev, vendaItemId: "vd-cor-01-a", quantidade: "1", retornoFisico: true });
  v.igual(item(a, "p1").saldo, "7", "com retorno físico, repõe");
  v1 = estoque(a).vendas.find((x) => x.id === "vd-cor-01");
  const dev = aplicar(a, { tipo: "venda.devolver", id: "vd-cor-01", revBase: v1._rev, vendaItemId: "vd-cor-01-a", quantidade: "3", retornoFisico: true });
  v.falso(dev.ok, "não se devolve mais do que se vendeu");
  depois(a);
  um(a, { tipo: "venda.cancelar", id: "vd-cor-01", revBase: v1._rev, motivo: "erro de lançamento" });
  v.igual(item(a, "p1").saldo, "10", "cancelar devolve o que saiu, sem contar a devolução duas vezes");
  v.igual(estoque(a).itens[0].vendas, null, "venda cancelada não entra no resultado");
  v.verdade(a.linhas("sis_auditoria").some((x) => x.entidade === "venda" && x.acao === "cancelou"));
});

teste("custo desconhecido e custo que muda depois: 'não informado' (nunca zero); a venda guarda o custo de então", () => {
  const a = ambiente();
  produto(a, "p1", "Produto 1");
  depois(a);
  um(a, { tipo: "estoque.movimento", itemId: "p1", dados: { id: "mv-semcusto", tipo: "entrada", quantidade: "5" } });
  vender(a, "vd-cus-01", { data: "2026-11-20", entregueEm: "2026-11-20", itens: [{ itemId: "p1", quantidade: "1", precoUnitario: 3000 }] });
  let s = item(a, "p1");
  v.igual(s.vendas.vendas[0].custoTotal, null);
  v.igual(s.vendas.diferenca, null, "sem custo, sem diferença inventada");
  v.igual(s.vendas.custoDesconhecido, "1");
  /* custo estimado no cadastro: identificado como estimativa */
  um(a, { tipo: "estoque.item.salvar", id: "p1", revBase: s._rev, dados: { custoUnitario: 1200 } });
  vender(a, "vd-cus-02", { data: "2026-11-20", entregueEm: "2026-11-20", itens: [{ itemId: "p1", quantidade: "1", precoUnitario: 3000 }] });
  s = item(a, "p1");
  const v2 = s.vendas.vendas.find((x) => x.vendaId === "vd-cus-02");
  v.igual(v2.custoUnitario, 1200);
  v.igual(v2.custoFonte, "estimativa");
  /* compra nova com custo: as vendas antigas não mudam */
  a.sim.agora = Date.parse("2026-11-21T15:00:00Z");
  entrada(a, "p1", "mv-p1-comp2", "10", 2000, "2026-11-21");
  s = item(a, "p1");
  v.igual(s.vendas.vendas.find((x) => x.vendaId === "vd-cus-02").custoUnitario, 1200, "custo histórico gravado no registro");
  v.igual(s.vendas.vendas.find((x) => x.vendaId === "vd-cus-01").custoTotal, null);
});

teste("preço praticado da ficha: vendas do produto ligado, com custo, desconto e diferença; nunca 'lucro'", () => {
  const a = ambiente();
  produto(a, "p1", "Produto 1");
  entrada(a, "p1", "mv-p1-00001", "10", 3000);
  um(a, { tipo: "ficha.salvar", id: "f-prod", revBase: 0, dados: { tipo: "produto", nome: "Sérum", precoAtual: 5000, dados: {} } });
  const s = item(a, "p1");
  um(a, { tipo: "estoque.item.salvar", id: "p1", revBase: s._rev, dados: { fichaId: "f-prod" } });
  vender(a, "vd-pp-01", { data: "2026-11-20", entregueEm: "2026-11-20", itens: [{ itemId: "p1", quantidade: "2", precoUnitario: 5000 }] });
  vender(a, "vd-pp-02", { data: "2026-11-20", entregueEm: "2026-11-20", itens: [{ itemId: "p1", quantidade: "1", precoUnitario: 5000, desconto: 500 }] });
  const pp = v.ok(a.pedir("financeiro.precosPraticados", { fichaId: "f-prod" }, a.tk));
  v.igual(pp.linhas.length, 2);
  v.igual(pp.resumo.vendido, 14500);
  v.igual(pp.resumo.custo, 9000);
  v.igual(pp.resumo.diferenca, 5500);
  v.igual(pp.precoPadrao, 5000);
  v.verdade(/não é lucro líquido/.test(pp.aviso));
  v.igual(pp.linhas.find((l) => l.ref === "vd-pp-02").desconto, 500);
});

module.exports = () => executar("Vendas");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
