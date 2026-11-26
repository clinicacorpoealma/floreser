/* Planos de tratamento, trocas, bônus e créditos (4.4.0) — dados fictícios.
   Um teste por critério de aceite. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");

function ambiente() {
  const a = novoAmbiente();
  a.sim.agora = Date.parse("2026-11-24T15:00:00Z");
  a.criarConta({ usuario: "fabi", nome: "Fabi Sintética", senha: "segredo-fabi", financeiro: true });
  a.tk = a.entrar("fabi", "segredo-fabi");
  a.gs.reiniciarExecucao();
  a.gs.alterarConfigClinicorp((c) => { c.statusAgenda = { 4: { nome: "4-Atendido", chave: "ATTENDED" }, 9: { nome: "Faltou", chave: "NO_SHOW" } }; c.profissionais = { 1: "Profissional Fictícia" }; });
  a.gs.inserir("agenda_pacientes", [{ id: "pa", nome: "Paciente Alfa" }, { id: "pb", nome: "Paciente Beta" }]);
  a.gs.inserir("int_vinculos", [{ id: "va", sistema: "clinicorp", assinante: "", tipo: "paciente", externoId: "PA", localTipo: "paciente", localId: "pa", estado: "ativo" }]);
  a.gs.reiniciarExecucao();
  return a;
}
const ext = (tipo, id, dados) => ({ id: "clinicorp::" + tipo + ":" + id, sistema: "clinicorp", assinante: "", tipo, externoId: id, dados, assinatura: "x" + id });
function inserir(a, tabela, linhas) { a.gs.reiniciarExecucao(); a.gs.inserir(tabela, linhas); a.gs.reiniciarExecucao(); }
function orcamento(a, id, data, procs, status) {
  inserir(a, "int_externos", [ext("orcamento", id, { status: status || "APPROVED", pacienteExternoId: "PA", pacienteNome: "Paciente Alfa", criadoEm: data, procedimentos: procs })]);
}
function atendimentos(a, lista) {
  inserir(a, "int_externos", lista.map((x) => ext("agendamento", x.id, Object.assign({ dia: x.dia, inicio: x.hora || "13:00", statusId: "4", profissionalId: "1",
    pacienteExternoId: "PA", pacienteNome: "Paciente Alfa" }, x.extra || {}))));
}
function historico(a, lista) { inserir(a, "agenda_historico", lista.map((x) => ({ id: x.id, pacienteId: x.p || "pa", tipo: "sessao", area: x.area || "facial", data: x.dia }))); }
function aplicar(a, op) { return v.ok(a.pedir("financeiro.aplicar", { operacoes: [a.op(op.tipo, op)] }, a.tk)).resultados[0]; }
function um(a, op) { const x = aplicar(a, op); if (!x.ok) throw new Error("recusado: " + JSON.stringify(x.erro)); return x; }
function ficha(a, pac, versao) { return v.ok(a.pedir("financeiro.pacientePlanos", { pacienteRef: pac || "loc:pa", versao: versao || "" }, a.tk)); }
function plano(a, ref, pac) { return ficha(a, pac).planos.find((p) => p.ref === ref); }
function linha(p, nome) { return p.linhas.find((l) => l.procedimento === nome); }
let seq = 0;
function registrar(a, ag, procedimento, extra) {
  const [tipo, ...resto] = ag.split(":");
  return um(a, { tipo: "exe.registrar", id: "ex-p" + (++seq) + "-t", dados: Object.assign({ agendamentoTipo: tipo, agendamentoId: resto.join(":"), procedimento, quantidade: "1" }, extra || {}) });
}
function fichaCusto(a, id, nome, ref, preco, custo) {
  um(a, { tipo: "ficha.salvar", id, revBase: 0, dados: { tipo: "procedimento", nome, precoAtual: preco, clinicorpProcedimentoId: ref || "",
    dados: custo === null ? {} : { tempoMin: "60", maoDeObraHora: custo, rateio: { modo: "nenhum" } } } });
}
const L = (id, ref, descricao, valorTabela, valor) => ({ id, ref, descricao, valorTabela, valor: valor === undefined ? valorTabela : valor });

teste("plano de R$ 6.034 e compra de cosméticos de R$ 195: a consulta mostra um plano e uma compra; o progresso não muda; o orçamento misto separa os itens", () => {
  const a = ambiente();
  orcamento(a, "T1", "2026-08-17", [L("1", "BIO", "Bioquântico FloreSer Facial", 40000), L("2", "BIO", "Bioquântico FloreSer Facial", 40000),
    L("3", "BIO", "Bioquântico FloreSer Facial", 40000), L("4", "BIO", "Bioquântico FloreSer Facial", 40000), L("5", "LIMP", "Limpeza Corpo e Alma", 44000),
    L("6", "CRIO", "Criofrequência Facial", 40000), L("7", "CRIO", "Criofrequência Facial", 40000), L("8", "PEEL", "FloreSer Peel", 25000)]);
  orcamento(a, "T2", "2026-08-27", [L("1", "COS1", "1x Tônico clareador fictício", 9500), L("2", "COS2", "1x Bálsamo iluminador fictício", 10000)]);
  const antes = plano(a, "clinicorp:T1").resumo;
  um(a, { tipo: "exe.conferencia", dados: { tipo: "classe", alvo: "ref:COS1", valor: "produto" } });
  um(a, { tipo: "exe.conferencia", dados: { tipo: "classe", alvo: "ref:COS2", valor: "produto" } });
  const f = ficha(a);
  v.igual(f.documentos.find((d) => d.ref === "clinicorp:T1").tipo, "plano");
  v.igual(f.documentos.find((d) => d.ref === "clinicorp:T2").tipo, "compra");
  v.igual(plano(a, "clinicorp:T1").resumo.contratadas, antes.contratadas, "a compra não mexe no progresso do plano");
  v.igual(plano(a, "clinicorp:T1").resumo.contratadas, "8");
  /* orçamento misto: o documento inteiro, com os itens classificados */
  orcamento(a, "T3", "2026-09-01", [L("1", "PEEL", "FloreSer Peel", 25000), L("2", "COS1", "1x Tônico clareador fictício", 9500)]);
  const p3 = plano(a, "clinicorp:T3");
  v.igual(p3.tipo.tipo, "plano");
  v.verdade(p3.tipo.misto, "documento misto");
  v.igual(p3.resumo.contratadas, "1", "só a unidade de tratamento entra no progresso");
  v.igual(p3.outrosItens.map((l) => l.classe), ["produto"], "o produto aparece no documento, fora do plano");
  /* a regra vale para o mesmo item identificado (pelo id do cadastro), sem perguntar de novo */
  v.igual(p3.outrosItens[0].classeFonte, "procedimento");
});

teste("quantidade: item com 4 explícito, ou quatro linhas de uma unidade, dão 4; quantidade agregada e linhas desdobradas não viram 16; texto sozinho fica a conferir", () => {
  const a = ambiente();
  um(a, { tipo: "exe.orcamento.salvar", id: "o-exp", revBase: 0, dados: { pacienteRef: "loc:pa", data: "2026-08-17", itens: [{ id: "i1", procedimento: "Revitalização Facial", quantidade: "4", valorUnitario: 30000 }] } });
  orcamento(a, "T-LIN", "2026-08-17", [1, 2, 3, 4].map((n) => L(String(n), "REV", "Revitalização Facial", 30000)));
  orcamento(a, "T-DUP", "2026-08-18", [1, 2, 3, 4].map((n) => L(String(n), "REV", "4 sessões de Revitalização Facial", 30000)));
  orcamento(a, "T-TXT", "2026-08-19", [L("1", "REV", "4 sessões de Revitalização Facial", 120000)]);
  v.igual(linha(plano(a, "local:o-exp"), "Revitalização Facial").contratado, "4");
  v.igual(linha(plano(a, "clinicorp:T-LIN"), "Revitalização Facial").contratado, "4");
  const dup = plano(a, "clinicorp:T-DUP").linhas[0];
  v.igual(dup.contratado, "4", "sem dezesseis sessões");
  v.falso(dup.aConferir);
  let txt = plano(a, "clinicorp:T-TXT");
  v.verdade(txt.linhas[0].aConferir, "quantidade lida no texto é apresentada para conferência");
  v.igual(txt.linhas[0].sugestao, "4");
  v.igual(txt.linhas[0].contratado, "1", "antes de conferir, não vira saldo");
  v.verdade(txt.pendencias.some((x) => x.tipo === "quantidade"));
  um(a, { tipo: "exe.conferencia", dados: { tipo: "quantidade", alvo: "clinicorp:T-TXT|r:REV", valor: "4", motivo: "conferido no contrato" } });
  txt = plano(a, "clinicorp:T-TXT");
  v.igual(txt.linhas[0].contratado, "4");
  v.igual(txt.linhas[0].contratadoFonte, "conferida");
  v.igual(txt.linhas[0].precoRef, 30000, "a referência por unidade sai do próprio item");
});

teste("dois planos ativos com o mesmo procedimento: o atendimento mostra os dois com saldo; a escolha resiste à nova sincronização; outro atendimento não a herda", () => {
  const a = ambiente();
  orcamento(a, "TA", "2026-08-01", [L("1", "BIO", "Bioquântico FloreSer Facial", 40000)]);
  orcamento(a, "TB", "2026-09-01", [L("1", "BIO", "Bioquântico FloreSer Facial", 40000), L("2", "BIO", "Bioquântico FloreSer Facial", 40000)]);
  atendimentos(a, [{ id: "A1", dia: "2026-09-10", extra: { previstos: [{ descricao: "Bioquântico FloreSer Facial", ref: "BIO" }] } },
    { id: "A2", dia: "2026-09-17", extra: { previstos: [{ descricao: "Bioquântico FloreSer Facial", ref: "BIO" }] } }]);
  const r = um(a, { tipo: "exe.atendimento.confirmar", agendamentoTipo: "clinicorp", agendamentoId: "A1" });
  v.igual(r.execucoes[0].associacao, "ambigua");
  let f = ficha(a);
  const pend = f.pendentes[0];
  v.igual(pend.candidatos.map((c) => [c.planoRef, c.disponivel]), [["clinicorp:TA", "1"], ["clinicorp:TB", "2"]], "os dois planos, com os saldos");
  um(a, { tipo: "exe.alterar", id: pend.id, revBase: pend._rev, campos: { itemRef: pend.candidatos[0].itemRef } });
  /* nova sincronização / reconfirmação / reimportação do MESMO atendimento */
  um(a, { tipo: "exe.atendimento.confirmar", agendamentoTipo: "clinicorp", agendamentoId: "A1" });
  v.ok(a.pedir("importacao.confirmar", { operacaoId: "imp-ex-planos-1", modulo: "financeiro", tipo: "execucoes", arquivo: "x.csv", mapeamento: {},
    linhas: [{ agendamento: "A1", codigo: "BIO", procedimento: "Bioquântico FloreSer Facial" }] }, a.tk));
  v.igual(a.linhas("exe_execucoes").length, 1, "nada duplicou");
  v.igual(plano(a, "clinicorp:TA").resumo.cumpridas, "1");
  v.igual(plano(a, "clinicorp:TB").resumo.cumpridas, "0", "só o plano escolhido reflete a execução");
  v.igual(plano(a, "clinicorp:TA").resumo.situacao, "concluido");
  /* atendimento posterior: o plano A acabou; não herda a escolha — vai ao único com saldo */
  const r2 = um(a, { tipo: "exe.atendimento.confirmar", agendamentoTipo: "clinicorp", agendamentoId: "A2" });
  v.igual(r2.execucoes[0].associacao, "automatica");
  v.igual(plano(a, "clinicorp:TB").resumo.cumpridas, "1");
  v.igual(plano(a, "clinicorp:TA").resumo.cumpridas, "1", "o plano finalizado não recebe o atendimento novo");
});

teste("FloreSer Peel com observação 'limpeza de pele' confirmado como troca; 'ácido mandélico 5 min' mantido como observação não gera nada", () => {
  const a = ambiente();
  orcamento(a, "T1", "2026-08-17", [L("1", "PEEL", "FloreSer Peel", 25000), L("2", "PEEL", "FloreSer Peel", 25000), L("3", "CRIO", "Criofrequência Facial", 40000)]);
  atendimentos(a, [{ id: "A11", dia: "2026-11-23", extra: { previstos: [{ descricao: "FloreSer Peel", ref: "PEEL" }], observacao: "limpeza de pele" } },
    { id: "A6", dia: "2026-09-23", extra: { previstos: [{ descricao: "Criofrequência Facial", ref: "CRIO" }], observacao: "Ácido mandélico 5 min" } }]);
  let f = ficha(a);
  const at11 = f.atendimentos.find((x) => x.ref === "clinicorp:A11");
  v.igual(at11.observacao, "limpeza de pele", "a observação original é guardada");
  v.verdade(at11.observacaoPendente);
  v.verdade(at11.aConfirmar);
  um(a, { tipo: "exe.troca.registrar", id: "tr-peel-limpeza", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:PEEL", quantidadeOrigem: "1",
    procedimentoSubstituto: "Limpeza de pele", quantidadePrometida: "1", precoSubstituto: 50000, agendamentoTipo: "clinicorp", agendamentoId: "A11", entregaQuantidade: "1",
    observacaoOrigem: "limpeza de pele" } });
  um(a, { tipo: "exe.atendimento.salvar", id: "clinicorp:A11", revBase: 0, dados: { interpretacao: "substituicao" } });
  /* o mandélico: confirmado como previsto, observação mantida */
  um(a, { tipo: "exe.atendimento.confirmar", agendamentoTipo: "clinicorp", agendamentoId: "A6" });
  um(a, { tipo: "exe.atendimento.salvar", id: "clinicorp:A6", revBase: 0, dados: { interpretacao: "observacao" } });
  const p = plano(a, "clinicorp:T1");
  v.igual(linha(p, "FloreSer Peel").substituida, "1", "uma unidade de Peel atendida por substituição");
  v.igual(linha(p, "FloreSer Peel").disponivel, "1");
  const exes = a.linhas("exe_execucoes");
  v.igual(exes.length, 2, "uma limpeza e uma criofrequência — o mandélico não vira execução");
  v.igual(exes.filter((e) => e.natureza === "substituicao").map((e) => e.procedimento), ["Limpeza de pele"]);
  v.igual(a.linhas("exe_trocas").length, 1);
  f = ficha(a);
  v.falso(f.atendimentos.find((x) => x.ref === "clinicorp:A6").observacaoPendente);
  v.falso(f.atendimentos.find((x) => x.ref === "clinicorp:A11").observacaoPendente);
  const pv = ficha(a, "loc:pa", "paciente");
  const textos = [].concat(...pv.planos[0].historico.map((h) => h.procedimentos.map((x) => x.texto)));
  v.verdade(textos.indexOf("Limpeza de pele em substituição a 1 FloreSer Peel") >= 0, JSON.stringify(textos));
  v.igual(p.trocas[0].valores.bonus, 25000, "R$ 500 − R$ 250, sem cobrança");
});

teste("troca de 1 Micropeeling por 3 Bioquânticos com só o primeiro entregue: original comprometido, 1 realizado, 2 disponíveis; reimportar preserva; a segunda entrega deixa 1", () => {
  const a = ambiente();
  orcamento(a, "T1", "2026-08-17", [L("1", "MICRO", "Micropeeling FloreSer", 60000), L("2", "MICRO", "Micropeeling FloreSer", 60000)]);
  atendimentos(a, [{ id: "B1", dia: "2026-10-01" }, { id: "B2", dia: "2026-10-08" }]);
  um(a, { tipo: "exe.troca.registrar", id: "tr-micro-bio", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:MICRO", quantidadeOrigem: "1",
    procedimentoSubstituto: "Bioquântico FloreSer Facial", procedimentoSubstitutoRef: "BIO", quantidadePrometida: "3", precoSubstituto: 20000,
    agendamentoTipo: "clinicorp", agendamentoId: "B1", entregaQuantidade: "1" } });
  const conferir = (restante, entregue) => {
    const p = plano(a, "clinicorp:T1");
    const l = linha(p, "Micropeeling FloreSer");
    v.igual(l.comprometida, "1", "o Micropeeling original fica comprometido");
    v.igual(l.disponivel, "1", "o outro Micropeeling segue livre");
    v.igual(p.trocas[0].entregue, entregue);
    v.igual(p.trocas[0].restante, restante);
    v.verdade(p.disponiveis.some((x) => x.porTroca && x.procedimento === "Bioquântico FloreSer Facial" && x.quantidade === restante));
  };
  conferir("2", "1");
  /* reimportar a primeira entrega */
  const imp = v.ok(a.pedir("importacao.confirmar", { operacaoId: "imp-ex-micro-1", modulo: "financeiro", tipo: "execucoes", arquivo: "x.csv", mapeamento: {},
    linhas: [{ agendamento: "B1", codigo: "BIO", procedimento: "Bioquântico FloreSer Facial" }] }, a.tk));
  v.igual(imp.importadas, 0);
  conferir("2", "1");
  /* uma reutilização da unidade comprometida é recusada */
  const outra = aplicar(a, { tipo: "exe.troca.registrar", id: "tr-micro-2", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:MICRO", quantidadeOrigem: "2",
    procedimentoSubstituto: "Gluco", quantidadePrometida: "2" } });
  v.verdade(!outra.ok && /livre/.test(outra.erro.mensagem));
  registrar(a, "clinicorp:B2", "Bioquântico FloreSer Facial", { procedimentoRef: "BIO", trocaId: "tr-micro-bio" });
  conferir("1", "2");
});

teste("Peel R$ 250 (custo 70) por limpeza R$ 500 (custo 110): bônus 250, custo da entrega 110, custo adicional 40; cobrando 100, bônus 150; custo desconhecido não impede o bônus", () => {
  const a = ambiente();
  fichaCusto(a, "f-peel", "FloreSer Peel", "PEEL", 25000, 7000);
  fichaCusto(a, "f-limp", "Limpeza de pele", "LIMPP", 50000, 11000);
  orcamento(a, "T1", "2026-08-17", [L("1", "PEEL", "FloreSer Peel", 25000), L("2", "PEEL", "FloreSer Peel", 25000), L("3", "PEEL", "FloreSer Peel", 25000)]);
  atendimentos(a, [{ id: "C1", dia: "2026-11-02" }, { id: "C2", dia: "2026-11-09" }]);
  um(a, { tipo: "exe.troca.registrar", id: "tr-c1", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:PEEL", procedimentoSubstituto: "Limpeza de pele",
    procedimentoSubstitutoRef: "LIMPP", agendamentoTipo: "clinicorp", agendamentoId: "C1", entregaQuantidade: "1" } });
  um(a, { tipo: "exe.troca.registrar", id: "tr-c2", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:PEEL", procedimentoSubstituto: "Limpeza de pele",
    procedimentoSubstitutoRef: "LIMPP", diferencaCobrada: 10000, agendamentoTipo: "clinicorp", agendamentoId: "C2", entregaQuantidade: "1" } });
  const p = plano(a, "clinicorp:T1");
  const t1 = p.trocas.find((t) => t.id === "tr-c1"), t2 = p.trocas.find((t) => t.id === "tr-c2");
  v.igual(t1.valores.bonus, 25000);
  v.igual(t1.valores.custoEntregue, 11000);
  v.igual(t1.valores.custoAdicional, 4000);
  v.verdade(/preço atual da ficha Limpeza de pele/.test(t1.basePreco), "a base do preço fica registrada");
  v.igual(t2.valores.bonus, 15000, "a clínica cobrou R$ 100 da diferença");
  v.igual(p.beneficios.bonus, 40000);
  v.igual(p.beneficios.custoEntregue, 22000);
  /* o mesmo, com o custo da limpeza desconhecido */
  const b = ambiente();
  fichaCusto(b, "f-peel", "FloreSer Peel", "PEEL", 25000, 7000);
  orcamento(b, "T1", "2026-08-17", [L("1", "PEEL", "FloreSer Peel", 25000)]);
  atendimentos(b, [{ id: "C1", dia: "2026-11-02" }]);
  um(b, { tipo: "exe.troca.registrar", id: "tr-c1", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:PEEL", procedimentoSubstituto: "Limpeza de pele",
    precoSubstituto: 50000, agendamentoTipo: "clinicorp", agendamentoId: "C1", entregaQuantidade: "1" } });
  const pb = plano(b, "clinicorp:T1");
  v.igual(pb.trocas[0].valores.bonus, 25000, "bônus continua calculável");
  v.igual(pb.trocas[0].valores.custoEntregue, null, "custo não informado");
  v.igual(pb.trocas[0].valores.custoAdicional, null);
  v.verdade(pb.beneficios.custoParcial, "total de custo sinalizado como parcial");
  /* sem referência de preço do substituto: pendente, sem bônus inventado */
  const c = ambiente();
  orcamento(c, "T1", "2026-08-17", [L("1", "PEEL", "FloreSer Peel", 25000)]);
  um(c, { tipo: "exe.troca.registrar", id: "tr-x", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:PEEL", procedimentoSubstituto: "Procedimento sem ficha" } });
  const pc = plano(c, "clinicorp:T1");
  v.verdade(pc.trocas[0].valores.pendente);
  v.igual(pc.trocas[0].valores.bonus, null);
  v.verdade(pc.pendencias.some((x) => x.tipo === "preco"));
});

teste("Blefaro R$ 1.000 por Bioquântico R$ 400: R$ 600 de crédito; usar R$ 200 com destino explícito deixa R$ 400; repetir não duplica geração nem uso", () => {
  const a = ambiente();
  orcamento(a, "T1", "2026-08-17", [L("1", "BLEF", "Blefaro Peel FloreSer", 100000)]);
  orcamento(a, "T2", "2026-10-01", [L("1", "REV", "Revitalização Facial", 30000)]);
  um(a, { tipo: "exe.troca.registrar", id: "tr-blef", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:BLEF", procedimentoSubstituto: "Bioquântico FloreSer Facial", precoSubstituto: 40000 } });
  let p = plano(a, "clinicorp:T1");
  v.igual(p.trocas[0].valores.credito, 60000);
  v.igual(p.trocas[0].valores.bonus, 0);
  const semDestino = aplicar(a, { tipo: "exe.credito.usar", id: "cr-0", dados: { trocaId: "tr-blef", valor: 20000 } });
  v.verdade(!semDestino.ok && /destino|para que/.test(semDestino.erro.mensagem));
  const op = a.op("exe.credito.usar", { id: "cr-1", dados: { trocaId: "tr-blef", valor: 20000, destinoRef: "clinicorp:T2", motivo: "abatido no plano novo" } });
  v.ok(a.pedir("financeiro.aplicar", { operacoes: [op] }, a.tk));
  v.ok(a.pedir("financeiro.aplicar", { operacoes: [op] }, a.tk));
  const demais = aplicar(a, { tipo: "exe.credito.usar", id: "cr-2", dados: { trocaId: "tr-blef", valor: 50000, destinoDescricao: "outro uso" } });
  v.verdade(!demais.ok, "não passa do saldo");
  /* "sincronizar de novo": a apuração é refeita do zero */
  p = plano(a, "clinicorp:T1");
  v.igual(p.trocas[0].creditoUsado, 20000);
  v.igual(p.trocas[0].creditoSaldo, 40000);
  v.igual(p.trocas[0].usos.length, 1);
  v.igual(a.linhas("exe_creditos").length, 1);
  v.igual(a.linhas("exe_trocas").length, 1);
  v.igual(ficha(a).beneficios.creditoSaldo, 40000, "total da paciente");
  v.igual(a.linhas("ent_pagamentos").length + a.linhas("fin_movimentos").length, 0, "crédito não é recebimento nem devolução em dinheiro");
});

teste("adicional de R$ 180 confirmado como gratuito: uma entrega e R$ 180 de bônus, unidades preservadas; só a evidência da entrega mostra excedente, sem gratuidade", () => {
  const a = ambiente();
  um(a, { tipo: "exe.orcamento.salvar", id: "o1", revBase: 0, dados: { pacienteRef: "loc:pa", data: "2026-08-17", situacao: "aprovado",
    itens: [{ id: "i1", procedimento: "Criofrequência Facial", quantidade: "2", valorUnitario: 40000 }] } });
  historico(a, [{ id: "h1", dia: "2026-09-01" }, { id: "h2", dia: "2026-09-08" }]);
  registrar(a, "agenda-hist:h1", "Massagem relaxante", { natureza: "gratuito", valorReferencia: 18000, orcamentoRef: "local:o1" });
  let p = plano(a, "local:o1");
  v.igual(p.beneficios.bonus, 18000);
  v.igual(p.resumo.contratadas, "2");
  v.igual(p.resumo.cumpridas, "0", "o bônus não consome unidade contratada");
  v.igual(p.resumo.procedimentos, "1");
  /* só a entrega, sem confirmação de gratuidade */
  const r = registrar(a, "agenda-hist:h2", "Drenagem", {});
  v.igual(r.natureza, "");
  p = plano(a, "local:o1");
  v.igual(p.beneficios.bonus, 18000, "nada de bônus atribuído sozinho");
  v.verdade(ficha(a).pendentes.some((x) => x.procedimento === "Drenagem"), "aparece para decidir (excedente/avulso)");
});

teste("plano de 15 unidades, 11 atendimentos, 12 procedimentos, 11 cumpridas: 73% e 4 restantes; a visita com dois procedimentos aparece junta; o excedente é visível", () => {
  const a = ambiente();
  um(a, { tipo: "exe.orcamento.salvar", id: "o15", revBase: 0, dados: { pacienteRef: "loc:pa", data: "2026-08-17", situacao: "aprovado", itens: [
    { id: "crio", procedimento: "Criofrequência Facial", procedimentoRef: "CRIO", quantidade: "2" },
    { id: "limp", procedimento: "Limpeza Corpo e Alma", procedimentoRef: "LIMP", quantidade: "1" },
    { id: "bio", procedimento: "Bioquântico FloreSer Facial", procedimentoRef: "BIO", quantidade: "4" },
    { id: "rev", procedimento: "Revitalização Facial", procedimentoRef: "REV", quantidade: "4" },
    { id: "peel", procedimento: "FloreSer Peel", procedimentoRef: "PEEL", quantidade: "4" }] } });
  const sessoes = [["s1", "2026-08-20", "LIMP"], ["s2", "2026-08-27", "REV"], ["s3", "2026-09-03", "BIO"], ["s4", "2026-09-10", "CRIO"], ["s5", "2026-09-17", "BIO"],
    ["s6", "2026-09-23", "CRIO"], ["s7", "2026-09-30", "BIO"], ["s8", "2026-10-14", "BIO"], ["s9", "2026-10-28", "REV"], ["s10", "2026-11-09", "PEEL"], ["s11", "2026-11-23", "PEEL"]];
  historico(a, sessoes.map((s) => ({ id: s[0], dia: s[1] })));
  const nomes = { LIMP: "Limpeza Corpo e Alma", REV: "Revitalização Facial", BIO: "Bioquântico FloreSer Facial", CRIO: "Criofrequência Facial", PEEL: "FloreSer Peel" };
  sessoes.forEach((s) => registrar(a, "agenda-hist:" + s[0], nomes[s[2]], { procedimentoRef: s[2] }));
  registrar(a, "agenda-hist:s10", nomes.BIO, { procedimentoRef: "BIO" });   // dois na mesma visita
  const p = plano(a, "local:o15");
  v.igual(p.resumo.atendimentos, 11);
  v.igual(p.resumo.procedimentos, "12");
  v.igual(p.resumo.contratadas, "15");
  v.igual(p.resumo.cumpridas, "11");
  v.igual(p.resumo.progresso, 73);
  v.igual(p.resumo.restante, "4");
  v.igual(linha(p, "Bioquântico FloreSer Facial").excedente, "1");
  const visita = p.historico.find((h) => h.data === "2026-11-09");
  v.igual(visita.execucoes.length, 2, "os dois procedimentos da mesma visita juntos");
  v.igual(p.disponiveis.map((x) => x.quantidade + " " + x.procedimento).sort(), ["2 FloreSer Peel", "2 Revitalização Facial"]);
  const pv = ficha(a, "loc:pa", "paciente").planos[0];
  v.igual(pv.progresso, 73);
  v.verdade(JSON.stringify(pv).indexOf("custo") < 0, "a versão da paciente não leva custo interno nos dados");
});

teste("execução corrigida de substituição para conforme previsto: histórico e motivo ficam, saldo e bônus se reconciliam, outros atendimentos não mudam, e nada é recriado", () => {
  const a = ambiente();
  orcamento(a, "T1", "2026-08-17", [L("1", "PEEL", "FloreSer Peel", 25000), L("2", "LIMPP", "Limpeza de pele", 50000), L("3", "CRIO", "Criofrequência Facial", 40000)]);
  atendimentos(a, [{ id: "D1", dia: "2026-11-23", extra: { previstos: [{ descricao: "FloreSer Peel", ref: "PEEL" }], observacao: "limpeza de pele" } },
    { id: "D0", dia: "2026-11-02", extra: { previstos: [{ descricao: "Criofrequência Facial", ref: "CRIO" }] } }]);
  um(a, { tipo: "exe.atendimento.confirmar", agendamentoTipo: "clinicorp", agendamentoId: "D0" });
  um(a, { tipo: "exe.troca.registrar", id: "tr-d1", dados: { orcamentoRef: "clinicorp:T1", linhaChave: "r:PEEL", procedimentoSubstituto: "Limpeza de pele",
    procedimentoSubstitutoRef: "LIMPP", precoSubstituto: 50000, agendamentoTipo: "clinicorp", agendamentoId: "D1", entregaQuantidade: "1" } });
  let p = plano(a, "clinicorp:T1");
  v.igual(linha(p, "FloreSer Peel").substituida, "1");
  v.igual(p.beneficios.bonus, 25000);
  const ex = a.linhas("exe_execucoes").find((e) => e.natureza === "substituicao");
  const semMotivo = aplicar(a, { tipo: "exe.alterar", id: ex.id, revBase: ex.rev, campos: { natureza: "contratado", itemRef: "clinicorp:T1:2" } });
  v.falso(semMotivo.ok, "correção pede motivo");
  um(a, { tipo: "exe.alterar", id: ex.id, revBase: ex.rev, campos: { natureza: "contratado", itemRef: "clinicorp:T1:2", motivo: "era a limpeza do próprio plano" } });
  p = plano(a, "clinicorp:T1");
  v.igual(linha(p, "FloreSer Peel").substituida, "0");
  v.igual(linha(p, "FloreSer Peel").disponivel, "1", "a unidade de Peel volta ao saldo");
  v.igual(linha(p, "Limpeza de pele").realizada, "1");
  v.igual(p.beneficios.bonus, 0, "o bônus da troca sai");
  v.igual(linha(p, "Criofrequência Facial").realizada, "1", "os outros atendimentos preservam os valores");
  v.igual(a.linhas("exe_trocas")[0].estado, "desfeita");
  v.verdade(a.linhas("sis_auditoria").some((x) => x.entidade === "execucao" && /era a limpeza/.test(x.motivo || x.detalhe || JSON.stringify(x))), "motivo no histórico");
  /* uma reimportação seguinte da mesma entrega não recria nada */
  const imp = v.ok(a.pedir("importacao.confirmar", { operacaoId: "imp-ex-d1", modulo: "financeiro", tipo: "execucoes", arquivo: "x.csv", mapeamento: {},
    linhas: [{ agendamento: "D1", codigo: "LIMPP", procedimento: "Limpeza de pele" }] }, a.tk));
  v.igual(imp.importadas, 0);
  v.igual(a.linhas("exe_trocas").filter((t) => t.estado !== "desfeita").length, 0);
  p = plano(a, "clinicorp:T1");
  v.igual(p.beneficios.bonus, 0, "o bônus anterior não volta");
  v.igual(a.linhas("exe_execucoes").filter((e) => e.estado !== "desfeito" && e.agendamentoId === "D1").length, 1);
});

teste("cancelamento, falta e remarcação ficam rastreáveis sem contar; a versão da paciente não carrega custo nem observação não liberada", () => {
  const a = ambiente();
  orcamento(a, "T1", "2026-08-17", [L("1", "CRIO", "Criofrequência Facial", 40000), L("2", "CRIO", "Criofrequência Facial", 40000)]);
  atendimentos(a, [{ id: "F1", dia: "2026-10-01", extra: { statusId: "9" } }, { id: "F2", dia: "2026-10-02", extra: { cancelado: true } },
    { id: "F3", dia: "2026-10-03", extra: { observacao: "nota interna sigilosa" } }]);
  v.falso(aplicar(a, { tipo: "exe.registrar", id: "ex-falta", dados: { agendamentoTipo: "clinicorp", agendamentoId: "F1", procedimento: "Criofrequência Facial" } }).ok);
  v.falso(aplicar(a, { tipo: "exe.registrar", id: "ex-canc", dados: { agendamentoTipo: "clinicorp", agendamentoId: "F2", procedimento: "Criofrequência Facial" } }).ok);
  registrar(a, "clinicorp:F3", "Criofrequência Facial", { procedimentoRef: "CRIO" });
  const f = ficha(a);
  v.verdade(f.atendimentos.some((x) => x.ref === "clinicorp:F1" && x.status.categoria === "falta"), "a falta aparece no histórico");
  v.igual(plano(a, "clinicorp:T1").resumo.atendimentos, 1);
  const pv = JSON.stringify(ficha(a, "loc:pa", "paciente"));
  v.verdade(pv.indexOf("sigilosa") < 0, "observação não liberada fica fora dos dados enviados");
  um(a, { tipo: "exe.atendimento.salvar", id: "clinicorp:F3", revBase: 0, dados: { observacaoLiberada: true } });
  v.verdade(JSON.stringify(ficha(a, "loc:pa", "paciente")).indexOf("sigilosa") >= 0, "liberada, aparece");
});

module.exports = () => executar("Planos");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
