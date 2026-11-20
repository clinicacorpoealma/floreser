/* Estoque no Financeiro (4.2.0) — dados sintéticos. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");

function ambiente() {
  const a = novoAmbiente();
  a.sim.agora = Date.parse("2026-11-20T15:00:00Z");
  a.criarConta({ usuario: "fabi", nome: "Fabi Sintética", senha: "segredo-fabi", financeiro: true });
  a.criarConta({ usuario: "bia", nome: "Bia Sintética", senha: "segredo-bia", entradas: true });
  a.tk = a.entrar("fabi", "segredo-fabi");
  return a;
}
function um(a, op) {
  const r = a.pedir("financeiro.aplicar", { operacoes: [a.op(op.tipo, op)] }, a.tk);
  const x = v.ok(r).resultados[0];
  if (!x.ok) throw new Error("recusado: " + JSON.stringify(x.erro));
  return x;
}
function importar(a, linhas, id) {
  return v.ok(a.pedir("importacao.confirmar", { operacaoId: id || "imp-est-" + Math.random().toString(36).slice(2, 12), modulo: "financeiro", tipo: "estoque",
    arquivo: "estoque.xlsx", mapeamento: { A: "codigo" }, linhas }, a.tk));
}
function estoque(a) { return v.ok(a.pedir("financeiro.estoque", {}, a.tk)); }

teste("permissão: estoque só com Financeiro; a fonte do Clinicorp aparece como 'sem acesso', com o que falta", () => {
  const a = ambiente();
  v.erro(a.pedir("financeiro.estoque", {}, a.entrar("bia", "segredo-bia")), "sem_acesso");
  const e = estoque(a);
  v.falso(e.fonte.clinicorp.disponivel);
  v.verdade(e.fonte.clinicorp.falta.some((x) => /saldo/.test(x)));
  v.igual(e.itens, [], "nada fictício");
});

teste("importação de retrato: quantidades fracionárias exatas, vazio = desconhecido (≠ esgotado), reimportar o mesmo dia não duplica", () => {
  const a = ambiente();
  const linhas = [
    { codigo: "GEL1", nome: "Gel condutor", unidade: "ML", quantidade: "1250,5", minimo: "2000", custoUnitario: 9, categoria: "Consumo" },
    { codigo: "LUV", nome: "Luva", unidade: "UN", quantidade: "0" },
    { codigo: "AGU", nome: "Agulha", unidade: "UN", quantidade: "" },
    { codigo: "SOR", nome: "Sérum", unidade: "ML", quantidade: "30.125", validade: "2026-12-01" }
  ];
  const r = importar(a, linhas, "imp-est-000001");
  v.igual(r.importadas, 4);
  let e = estoque(a);
  const por = {}; e.itens.forEach((i) => { por[i.codigo] = i; });
  v.igual(por.GEL1.saldo, "1250.5");
  v.igual(por.GEL1.unidadeConsumo, "ml", "ML do Clinicorp vira ml");
  v.igual(por.GEL1.situacao, "abaixo");
  v.igual(por.LUV.situacao, "esgotado");
  v.igual(por.AGU.saldo, null, "sem quantidade: desconhecido");
  v.igual(por.AGU.situacao, "desconhecido", "desconhecido não é esgotado");
  v.igual(por.SOR.saldo, "30.125", "três casas, sem erro de ponto flutuante");
  v.verdade(por.SOR.validadeProxima);
  v.verdade(e.reposicao.some((x) => x.id === por.GEL1.id && x.faltam === "749.5"));
  /* o mesmo arquivo, outro operacaoId, mesmo dia: retratos já existem */
  const r2 = importar(a, linhas);
  v.igual(r2.importadas, 1, "só a linha sem quantidade (que não gera retrato) passa de novo");
  v.igual(a.linhas("est_saldos").length, 3);
  /* outro dia: novo retrato; a diferença aparece como variação observada, sem inventar consumo */
  a.sim.agora = Date.parse("2026-11-22T15:00:00Z");
  importar(a, [{ codigo: "GEL1", nome: "Gel condutor", unidade: "ML", quantidade: "1000", custoUnitario: 9 }]);
  e = estoque(a);
  const gel = e.itens.find((i) => i.codigo === "GEL1");
  v.igual(gel.saldo, "1000");
  v.igual(gel.variacoes[0].variacao, "-250.5");
  v.igual(gel.movimentos, [], "nenhum movimento inventado");
});

teste("sem estoque duplo: item de fonte externa não recebe movimento nem tem saldo/custo editável; item só do Alveare sim, e não se mistura com o importado", () => {
  const a = ambiente();
  importar(a, [{ codigo: "GEL1", nome: "Gel", unidade: "ML", quantidade: "100" }]);
  const gel = estoque(a).itens[0];
  const mov = v.ok(a.pedir("financeiro.aplicar", { operacoes: [a.op("estoque.movimento", { itemId: gel.id, dados: { id: "mv-1xxxxxxx", tipo: "saida", quantidade: "10" } })] }, a.tk)).resultados[0];
  v.verdade(!mov.ok && /segundo saldo/.test(mov.erro.mensagem));
  const ed = v.ok(a.pedir("financeiro.aplicar", { operacoes: [a.op("estoque.item.salvar", { id: gel.id, revBase: gel._rev, dados: { custoUnitario: 1 } })] }, a.tk)).resultados[0];
  v.verdade(!ed.ok, "custo é da fonte");
  um(a, { tipo: "estoque.item.salvar", id: gel.id, revBase: gel._rev, dados: { minimo: "50", notas: "pedir com 15 dias" } });
  /* item local, com o MESMO código */
  um(a, { tipo: "estoque.item.salvar", id: "loc-gel", revBase: 0, dados: { nome: "Gel (amostra)", codigo: "GEL1", unidadeConsumo: "ml", minimo: "5" } });
  um(a, { tipo: "estoque.movimento", itemId: "loc-gel", dados: { id: "mv-2xxxxxxx", tipo: "contagem", quantidade: "12.5" } });
  a.sim.agora += 60000;
  um(a, { tipo: "estoque.movimento", itemId: "loc-gel", dados: { id: "mv-3xxxxxxx", tipo: "saida", quantidade: "2.25", motivo: "uso em atendimento" } });
  const p = v.ok(a.pedir("importacao.previa", { modulo: "financeiro", tipo: "estoque", linhas: [{ codigo: "GEL1", nome: "Gel", unidade: "ML", quantidade: "90" }] }, a.tk));
  v.verdade(p.linhas[0].avisos.some((x) => /não foi misturado/.test(x)));
  const e = estoque(a);
  v.igual(e.itens.find((i) => i.id === "loc-gel").saldo, "10.25");
  v.igual(e.itens.find((i) => i.id === gel.id).saldo, "100", "o importado continua com o saldo da fonte");
});

teste("conversão de unidade: caixa → ml pelo fator do item; unidade que não converte é erro, não chute", () => {
  const a = ambiente();
  importar(a, [{ codigo: "ALG", nome: "Algodão", unidade: "CX", quantidade: "2" }]);
  let item = estoque(a).itens[0];
  um(a, { tipo: "estoque.item.salvar", id: item.id, revBase: item._rev, dados: { unidadeConsumo: "un", fator: "200" } });
  a.sim.agora = Date.parse("2026-11-21T15:00:00Z");
  const p = v.ok(a.pedir("importacao.previa", { modulo: "financeiro", tipo: "estoque", linhas: [
    { codigo: "ALG", nome: "Algodão", unidade: "CX", quantidade: "1.5" },
    { codigo: "ALG", nome: "Algodão", unidade: "ML", quantidade: "3", local: "sala 2" }] }, a.tk));
  v.igual(p.linhas[0].registro.quantidade, "300", "1,5 caixa × 200 = 300 un");
  v.verdade(p.linhas[1].erros.some((x) => /não converte/.test(x)));
});

teste("estoque na precificação: custo atualizado recalcula, marca a ficha aprovada para revisão e não toca na versão aprovada nem no preço", () => {
  const a = ambiente();
  importar(a, [{ codigo: "GEL1", nome: "Gel", unidade: "ML", quantidade: "500", custoUnitario: 10 }]);
  const gel = estoque(a).itens[0];
  const usar = um(a, { tipo: "estoque.usarNaPrecificacao", itemId: gel.id });
  const ficha = { tipo: "procedimento", nome: "Limpeza", precoAtual: 15000, dados: { itens: [{ insumoId: usar.id, quantidade: "20", unidade: "ml" }],
    tempoMin: "60", maoDeObraHora: 4000, rateio: { modo: "nenhum" }, taxaPagamentoPct: "3", comissaoPct: "10", impostosPct: "6", margemPct: "20" } };
  const f = um(a, { tipo: "ficha.salvar", id: "f1", revBase: 0, dados: ficha });
  v.igual(f.entidade._calculo.materiais, 200, "20 ml × R$ 0,10");
  um(a, { tipo: "ficha.aprovar", id: "f1", revBase: 1 });
  a.sim.agora = Date.parse("2026-11-21T15:00:00Z");
  importar(a, [{ codigo: "GEL1", nome: "Gel", unidade: "ML", quantidade: "480", custoUnitario: 15 }]);
  const lido = v.ok(a.pedir("financeiro.ler", {}, a.tk));
  const f1 = lido.fichas.find((x) => x.id === "f1");
  v.igual(f1._calculo.materiais, 300, "o cálculo atual usa o custo novo");
  v.verdade(/mudou/.test(f1.revisar), "a ficha aprovada pede revisão");
  v.igual(f1.precoAtual, 15000, "preço não muda sozinho");
  v.igual(a.linhas("fin_fichas_versoes")[0].dados.insumos[usar.id].valorEmbalagem, 10, "a versão aprovada guarda o custo de então");
  v.igual(lido.insumos.find((i) => i.id === usar.id).custoFonte, "importacao", "custo identificado pela fonte");
  v.igual(a.linhas("fin_despesas").length, 0, "estoque e custo não viram despesa");
});

module.exports = () => executar("Estoque");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
