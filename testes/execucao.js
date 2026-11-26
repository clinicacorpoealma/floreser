/* Orçamentos e execução (4.3.0) — dados sintéticos.
   Execução só nasce de registro ligado a agendamento identificado. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");

function ambiente() {
  const a = novoAmbiente();
  a.sim.agora = Date.parse("2026-11-20T15:00:00Z");
  a.criarConta({ usuario: "fabi", nome: "Fabi Sintética", senha: "segredo-fabi", financeiro: true });
  a.tk = a.entrar("fabi", "segredo-fabi");
  a.gs.reiniciarExecucao();
  a.gs.inserir("agenda_pacientes", [{ id: "pac1", nome: "Paciente Um" }, { id: "pac2", nome: "Paciente Dois" }]);
  a.gs.inserir("agenda_historico", [
    { id: "h1", pacienteId: "pac1", tipo: "sessao", area: "facial", data: "2026-11-03" },
    { id: "h2", pacienteId: "pac1", tipo: "sessao", area: "facial", data: "2026-11-10" },
    { id: "h3", pacienteId: "pac1", tipo: "sessao", area: "facial", data: "2026-11-17" },
    /* dois agendamentos distintos no mesmo dia */
    { id: "h4", pacienteId: "pac1", tipo: "sessao", area: "facial", data: "2026-11-18" },
    { id: "h5", pacienteId: "pac1", tipo: "sessao", area: "corporal", data: "2026-11-18" },
    { id: "h6", pacienteId: "pac1", tipo: "sessao", area: "facial", data: "2026-11-19" },
    { id: "h9", pacienteId: "pac2", tipo: "sessao", area: "facial", data: "2026-11-12" }]);
  a.gs.inserir("agenda_agendamentos", [{ id: "g1", pacienteId: "pac1", area: "facial", data: "2026-11-27" }]);
  a.gs.reiniciarExecucao();
  return a;
}
function aplicar(a, op) { return v.ok(a.pedir("financeiro.aplicar", { operacoes: [a.op(op.tipo, op)] }, a.tk)).resultados[0]; }
function um(a, op) {
  const x = aplicar(a, op);
  if (!x.ok) throw new Error("recusado: " + JSON.stringify(x.erro));
  return x;
}
function painel(a, filtros) { return v.ok(a.pedir("financeiro.orcamentosExecucao", { filtros: filtros || {} }, a.tk)); }
function orc(a, ref, filtros) { return painel(a, filtros).orcamentos.find((o) => o.ref === ref); }
let seq = 0;
function registrar(a, ag, procedimento, extra) {
  const [tipo, id] = ag.split(":");
  return um(a, { tipo: "exe.registrar", id: "ex-" + (++seq) + "-teste", dados: Object.assign({ agendamentoTipo: tipo, agendamentoId: id, procedimento, quantidade: "1" }, extra || {}) });
}
function orcamentoLaser(a, qtd) {
  um(a, { tipo: "exe.orcamento.salvar", id: "orc-laser", revBase: 0, dados: { pacienteRef: "loc:pac1", data: "2026-11-01", situacao: "aprovado",
    itens: [{ id: "it-laser", procedimento: "Laser facial", procedimentoRef: "LAS", quantidade: qtd || "4", valorUnitario: 20000 },
      { id: "it-peel", procedimento: "Peeling", procedimentoRef: "PEE", quantidade: "1", valorUnitario: 15000 }] } });
}
/* Clinicorp: paciente vinculada, orçamento e agendamentos já sincronizados */
function comClinicorp(a) {
  a.gs.reiniciarExecucao();
  a.gs.alterarConfigClinicorp((c) => { c.statusAgenda = { 1: { nome: "Confirmado", chave: "CONFIRMED" }, 2: { nome: "Faltou", chave: "NO_SHOW" } }; });
  a.gs.inserir("int_vinculos", [{ id: "vp1", sistema: "clinicorp", assinante: "", tipo: "paciente", externoId: "P1", localTipo: "paciente", localId: "pac1", estado: "ativo" }]);
  const ext = (tipo, id, dados) => ({ id: "clinicorp::" + tipo + ":" + id, sistema: "clinicorp", assinante: "", tipo, externoId: id, dados, assinatura: "x" });
  a.gs.inserir("int_externos", [
    ext("orcamento", "T1", { status: "APPROVED", pacienteExternoId: "P1", pacienteNome: "Paciente Um", criadoEm: "2026-10-20", valor: 60000,
      procedimentos: [{ id: "L1", ref: "77", descricao: "Laser facial", valor: 20000, executado: true, executadoEm: "2026-11-01" },
        { id: "L2", ref: "77", descricao: "Laser facial", valor: 20000 }, { id: "L3", ref: "77", descricao: "Laser facial", valor: 20000 }] }),
    ext("agendamento", "A1", { dia: "2026-11-14", inicio: "10:00", statusId: "1", pacienteExternoId: "P1", pacienteNome: "Paciente Um" }),
    ext("agendamento", "A2", { dia: "2026-11-15", inicio: "10:00", statusId: "2", pacienteExternoId: "P1", pacienteNome: "Paciente Um" }),
    ext("agendamento", "A3", { dia: "2026-11-16", inicio: "10:00", cancelado: true, pacienteExternoId: "P1", pacienteNome: "Paciente Um" }),
    ext("agendamento", "A4", { dia: "2026-11-16", inicio: "15:00", statusId: "1", pacienteExternoId: "P1", pacienteNome: "Paciente Um" }),
    ext("agendamento", "A9", { dia: "2026-11-16", inicio: "16:00", statusId: "1", pacienteNome: "Sem vínculo" })]);
  a.gs.reiniciarExecucao();
}

teste("nada vira realizado sozinho: orçamento aprovado, 'Executado' do Clinicorp e data passada não contam", () => {
  const a = ambiente();
  comClinicorp(a);
  const o = orc(a, "clinicorp:T1");
  v.igual(o.totais.orcada, "3", "cada linha do orçamento do Clinicorp é uma unidade");
  v.igual(o.totais.realizada, "0");
  v.igual(o.totais.restante, "3");
  v.verdade(o.itens[0].executadoNoClinicorp, "o marcador aparece só como conferência");
  const p = painel(a);
  v.falso(p.fonte.execucaoAutomatica);
  v.verdade(/não informa quais procedimentos/.test(p.fonte.falta));
  v.igual(a.linhas("exe_execucoes").length, 0);
});

teste("orçamento realizado parcialmente em vários agendamentos, com o previsto à parte e o valor realizado proporcional", () => {
  const a = ambiente();
  orcamentoLaser(a);
  v.igual(registrar(a, "agenda-hist:h1", "Laser facial", { procedimentoRef: "LAS" }).associacao, "automatica", "um item só com este código");
  registrar(a, "agenda-hist:h2", "Laser facial", { procedimentoRef: "LAS" });
  registrar(a, "agenda:g1", "Laser facial", { procedimentoRef: "LAS", estado: "previsto" });
  const o = orc(a, "local:orc-laser");
  const laser = o.itens.find((i) => i.id === "it-laser");
  v.igual(laser.realizada, "2");
  v.igual(laser.agendada, "1");
  v.igual(laser.restante, "2");
  v.igual(o.totais.valorAcordado, 95000);
  v.igual(o.totais.valorRealizado, 40000, "2 de 4 × R$ 200, separado do recebido");
  /* realizado num agendamento futuro é recusado */
  const fut = aplicar(a, { tipo: "exe.registrar", id: "ex-futuro-01", dados: { agendamentoTipo: "agenda", agendamentoId: "g1", procedimento: "Laser facial", estado: "realizado" } });
  v.falso(fut.ok);
  v.verdade(/ainda não aconteceu/.test(fut.erro.mensagem));
  /* sem agendamento identificado, não existe execução */
  const sem = aplicar(a, { tipo: "exe.registrar", id: "ex-semag-01", dados: { agendamentoTipo: "agenda", agendamentoId: "nao-existe", procedimento: "Laser facial" } });
  v.falso(sem.ok);
});

teste("vários procedimentos no mesmo agendamento e dois agendamentos no mesmo dia contam separados", () => {
  const a = ambiente();
  orcamentoLaser(a);
  registrar(a, "agenda-hist:h3", "Laser facial", { procedimentoRef: "LAS" });
  registrar(a, "agenda-hist:h3", "Peeling", { procedimentoRef: "PEE" });
  registrar(a, "agenda-hist:h4", "Laser facial", { procedimentoRef: "LAS" });
  registrar(a, "agenda-hist:h5", "Laser facial", { procedimentoRef: "LAS" });
  const p = painel(a);
  const o = p.orcamentos.find((x) => x.ref === "local:orc-laser");
  v.igual(o.itens.find((i) => i.id === "it-laser").realizada, "3");
  v.igual(o.itens.find((i) => i.id === "it-peel").realizada, "1");
  v.igual(p.agendamentos.find((x) => x.ref === "agenda-hist:h3").execucoes.length, 2, "um agendamento, dois procedimentos");
  const mesmoDia = p.agendamentos.filter((x) => x.data === "2026-11-18");
  v.igual(mesmoDia.length, 2, "dois agendamentos no mesmo dia são distintos");
  v.verdade(mesmoDia.every((x) => x.execucoes.length === 1));
});

teste("cancelamento, falta e correção: cancelado/falta recusam realizado; desfazer e mudar quantidade recalculam com histórico", () => {
  const a = ambiente();
  comClinicorp(a);
  const canc = aplicar(a, { tipo: "exe.registrar", id: "ex-canc-001", dados: { agendamentoTipo: "clinicorp", agendamentoId: "A3", procedimento: "Laser facial" } });
  v.verdade(!canc.ok && /cancelado/.test(canc.erro.mensagem));
  const falta = aplicar(a, { tipo: "exe.registrar", id: "ex-falta-01", dados: { agendamentoTipo: "clinicorp", agendamentoId: "A2", procedimento: "Laser facial" } });
  v.verdade(!falta.ok && /falta/.test(falta.erro.mensagem), "presença/ausência vem do status; falta não tem procedimento");
  const semPac = aplicar(a, { tipo: "exe.registrar", id: "ex-sempac-1", dados: { agendamentoTipo: "clinicorp", agendamentoId: "A9", procedimento: "Laser facial" } });
  v.verdade(!semPac.ok && /paciente/.test(semPac.erro.mensagem));
  /* confirmado (presença) não prova procedimento: só o registro conta */
  v.igual(orc(a, "clinicorp:T1").totais.realizada, "0");
  const r = registrar(a, "clinicorp:A1", "Laser facial", { procedimentoRef: "77", quantidade: "2" });
  v.igual(r.associacao, "automatica");
  v.igual(orc(a, "clinicorp:T1").totais.realizada, "2");
  /* o status muda depois para falta: a execução fica no histórico e deixa de contar */
  a.gs.reiniciarExecucao();
  a.gs.alterarConfigClinicorp((c) => { c.categoriaStatus = { 1: "falta" }; });
  let o = orc(a, "clinicorp:T1");
  v.igual(o.totais.realizada, "0");
  v.falso(o.itens.find((i) => i.execucoes.length).execucoes[0].conta);
  a.gs.reiniciarExecucao();
  a.gs.alterarConfigClinicorp((c) => { c.categoriaStatus = {}; });
  /* correção de quantidade e desfazer */
  v.falso(aplicar(a, { tipo: "exe.alterar", id: r.id, revBase: 1, campos: { quantidade: "1" } }).ok, "corrigir o que já foi confirmado pede motivo");
  um(a, { tipo: "exe.alterar", id: r.id, revBase: 1, campos: { quantidade: "1", motivo: "lançado em dobro" } });
  v.igual(orc(a, "clinicorp:T1").totais.realizada, "1");
  um(a, { tipo: "exe.alterar", id: r.id, revBase: 2, campos: { estado: "desfeito", motivo: "lançado no agendamento errado" } });
  o = orc(a, "clinicorp:T1");
  v.igual(o.totais.realizada, "0");
  v.igual(a.linhas("exe_execucoes").length, 1, "desfeito não some");
  v.verdade(a.linhas("sis_auditoria").filter((x) => x.entidade === "execucao").length >= 3, "histórico das correções");
});

teste("execução sem orçamento e excedente: aparecem à parte, sem preço inventado", () => {
  const a = ambiente();
  orcamentoLaser(a, "2");
  registrar(a, "agenda-hist:h1", "Laser facial", { procedimentoRef: "LAS" });
  registrar(a, "agenda-hist:h2", "Laser facial", { procedimentoRef: "LAS" });
  /* o item já está completo, mas o plano (ainda com Peeling) é o único em
     andamento com Laser: a terceira entra nele como excedente visível */
  const r3 = registrar(a, "agenda-hist:h3", "Laser facial", { procedimentoRef: "LAS" });
  v.igual(r3.associacao, "automatica");
  const o = orc(a, "local:orc-laser");
  const laser = o.itens.find((i) => i.id === "it-laser");
  v.igual(laser.realizada, "3");
  v.igual(laser.restante, "0");
  v.igual(laser.excedente, "1");
  v.igual(o.totais.valorRealizado, 40000, "o excedente não ganha valor inventado");
  v.igual(o.totais.excedente, "1");
  const s = registrar(a, "agenda-hist:h6", "Drenagem", {});
  v.igual(s.associacao, "sem_orcamento");
  v.verdade(painel(a).semOrcamento.some((x) => x.procedimento === "Drenagem"));
  v.igual(painel(a, { situacao: "excedente" }).orcamentos.length, 1);
});

teste("associação: dois orçamentos possíveis → a pessoa escolhe; um atendimento novo não herda a escolha (só sugestão); nome igual sozinho nunca decide", () => {
  const a = ambiente();
  comClinicorp(a);
  um(a, { tipo: "exe.orcamento.salvar", id: "orc-dup", revBase: 0, dados: { pacienteRef: "loc:pac1", data: "2026-11-05",
    itens: [{ id: "i1", procedimento: "Laser facial", procedimentoRef: "77", quantidade: "2", valorUnitario: 18000 }] } });
  const r = registrar(a, "clinicorp:A1", "Laser facial", { procedimentoRef: "77" });
  v.igual(r.associacao, "ambigua");
  v.verdade(painel(a).pendentes.some((x) => x.id === r.id));
  um(a, { tipo: "exe.alterar", id: r.id, revBase: 1, campos: { itemRef: "local:orc-dup:i1" } });
  v.igual(a.linhas("exe_execucoes").find((x) => x.id === r.id).associacao, "confirmada");
  const r2 = registrar(a, "clinicorp:A4", "Laser facial", { procedimentoRef: "77" });
  v.igual(r2.associacao, "ambigua", "outro atendimento: a escolha anterior não é copiada");
  v.igual(painel(a).pendentes.find((x) => x.id === r2.id).sugestao, "local:orc-dup:i1", "aparece como sugestão");
  um(a, { tipo: "exe.alterar", id: r2.id, revBase: 1, campos: { itemRef: "local:orc-dup:i1" } });
  v.igual(orc(a, "local:orc-dup").totais.realizada, "2");
  v.igual(orc(a, "clinicorp:T1").totais.realizada, "0");
  /* só o nome igual, sem código: sugere, não decide */
  const b = ambiente();
  um(b, { tipo: "exe.orcamento.salvar", id: "orc-nome", revBase: 0, dados: { pacienteRef: "loc:pac1", data: "2026-11-05",
    itens: [{ id: "i1", procedimento: "Limpeza de pele", quantidade: "1" }] } });
  v.igual(registrar(b, "agenda-hist:h1", "Limpeza de pele", {}).associacao, "sugerida");
  v.igual(orc(b, "local:orc-nome").totais.realizada, "0");
  /* orçamento de outra paciente é recusado */
  const outra = aplicar(b, { tipo: "exe.registrar", id: "ex-outra-01", dados: { agendamentoTipo: "agenda-hist", agendamentoId: "h9", procedimento: "Limpeza de pele", itemRef: "local:orc-nome:i1" } });
  v.verdade(!outra.ok && /outra paciente/.test(outra.erro.mensagem));
});

teste("filtro de período diz a base: data do orçamento ou data da execução", () => {
  const a = ambiente();
  orcamentoLaser(a);
  registrar(a, "agenda-hist:h3", "Laser facial", { procedimentoRef: "LAS" });
  v.igual(painel(a, { de: "2026-11-15", ate: "2026-11-30", base: "orcamento" }).orcamentos.length, 0, "orçado em 01/11");
  v.igual(painel(a, { de: "2026-11-15", ate: "2026-11-30", base: "execucao" }).orcamentos.length, 1, "realizado em 17/11");
  v.igual(painel(a, { de: "2026-11-01", ate: "2026-11-05", base: "orcamento" }).orcamentos.length, 1);
});

teste("relatório de execuções importado: exige agendamento conhecido; reimportar não duplica; preço praticado da ficha", () => {
  const a = ambiente();
  orcamentoLaser(a);
  um(a, { tipo: "ficha.salvar", id: "f-laser", revBase: 0, dados: { tipo: "procedimento", nome: "Laser facial", precoAtual: 20000, clinicorpProcedimentoId: "LAS",
    dados: { tempoMin: "30", maoDeObraHora: 6000, rateio: { modo: "nenhum" } } } });
  const linhas = [{ agendamento: "h1", codigo: "LAS", procedimento: "Laser facial", quantidade: "1" },
    { agendamento: "h2", codigo: "LAS", procedimento: "Laser facial" },
    { agendamento: "xx-desconhecido", procedimento: "Laser facial" },
    { agendamento: "g1", procedimento: "Laser facial" }];
  const p = v.ok(a.pedir("importacao.previa", { modulo: "financeiro", tipo: "execucoes", linhas }, a.tk));
  v.verdade(p.linhas[2].erros.some((x) => /não encontrado/.test(x)));
  v.verdade(p.linhas[3].erros.some((x) => /ainda não aconteceu/.test(x)));
  const conf = () => v.ok(a.pedir("importacao.confirmar", { operacaoId: "imp-ex-" + Math.random().toString(36).slice(2, 12), modulo: "financeiro", tipo: "execucoes",
    arquivo: "execucoes.csv", mapeamento: {}, linhas: linhas.slice(0, 2) }, a.tk));
  conf();
  conf();
  v.igual(a.linhas("exe_execucoes").length, 2, "reimportar não duplica");
  v.igual(orc(a, "local:orc-laser").itens.find((i) => i.id === "it-laser").realizada, "2");
  const pp = v.ok(a.pedir("financeiro.precosPraticados", { fichaId: "f-laser" }, a.tk));
  v.igual(pp.linhas.length, 2);
  v.igual(pp.linhas[0].precoUnitario, 20000, "valor acordado gravado na execução");
  v.igual(pp.linhas[0].custoUnitario, 3000, "custo estimado pela ficha (30 min × R$ 60/h)");
  v.igual(pp.linhas[0].custoFonte, "estimativa");
  v.igual(pp.resumo.diferenca, 34000);
});

module.exports = () => executar("Execução");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
