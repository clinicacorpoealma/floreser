/* Testes da integração com o Clinicorp — SIMULADOS.
   Nenhum teste fala com a rede: sim.http responde no lugar da API, no
   formato da especificação publicada. Passar aqui NÃO prova nada sobre a
   conta real; isso é a validação descrita em docs/CLINICORP.md. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");
const { clinicorpFalso } = require("./util/clinicorp-falso");

const TOKEN_FALSO = "token-sintetico-de-teste-xyz";

function ambiente(opcoes) {
  const o = opcoes || {};
  const a = novoAmbiente();
  a.sim.agora = Date.parse("2026-11-20T15:00:00Z");
  a.ana = a.criarConta({ usuario: "ana", nome: "Ana Sintética", senha: "segredo-ana", admin: true });
  a.bia = a.criarConta({ usuario: "bia", nome: "Bia Sintética", senha: "segredo-bia", crm: true, agenda: true, entradas: true });
  a.cc = clinicorpFalso();
  a.sim.http = a.cc.handler;
  if (!o.semCredenciais) {
    a.sim.props.FLORESER_CLINICORP_USUARIO = "usuario-api-sintetico";
    a.sim.props.FLORESER_CLINICORP_TOKEN = TOKEN_FALSO;
  }
  const r = a.pedir("sessao.entrarModulo", { modulo: "dev", senha: "senha-painel-teste" });
  a.painel = v.ok(r).token;
  a.tkAna = a.entrar("ana", "segredo-ana");
  a.tkBia = a.entrar("bia", "segredo-bia");
  a.p = (acao, dados) => a.pedir("painel.integracao." + acao, dados || {}, a.painel);
  a.n = 0;
  a.opId = () => "op-teste-" + (++a.n) + "-xxxxxxxx";
  return a;
}

function configurar(a, recursos, extra) {
  return v.ok(a.p("configurar", Object.assign({ assinante: "assinante-sintetico", unidade: "111", recursos }, extra || {})));
}

function criarLead(a, id, dados) {
  const r = a.pedir("crm.aplicar", { operacoes: [a.op("lead.criar", { id, dados: Object.assign({ nome: "Lead " + id, etapa: "nao_responde", cadencia: "quente" }, dados || {}) })] }, a.tkAna);
  v.ok(r); v.verdade(r.dados.resultados[0].ok, JSON.stringify(r.dados.resultados[0]));
}

/* ====================== Configuração e teste ====================== */

teste("sem credenciais: 'não configurada', nenhuma chamada sai, e os módulos só mostram esse estado", () => {
  const a = ambiente({ semCredenciais: true });
  const e = v.ok(a.p("estado"));
  v.igual(e.situacao, "nao_configurada");
  v.falso(e.credenciais);
  v.erro(a.p("testar"), "integracao_nao_configurada");
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "crm" }, a.tkBia));
  v.igual(ctx.estado.situacao, "nao_configurada");
  v.igual(a.sim.chamadasHttp.length, 0, "nenhuma chamada ao Clinicorp");
});

teste("teste de conexão: verifica cada LEITURA uma vez; escrita nunca é chamada; a credencial não aparece em lugar nenhum", () => {
  const a = ambiente();
  configurar(a, {});
  const r = v.ok(a.p("testar"));
  v.verdade(r.teste.conectou);
  v.igual(r.teste.verificadas, r.teste.total);
  const porId = {};
  r.matriz.forEach((m) => { porId[m.id] = m; });
  v.igual(porId["orcamentos.listar"].verificacao, "verificada");
  v.igual(porId["pacientes.criar"].verificacao, "documentada_nao_verificada", "escrita nunca é exercitada para testar");
  v.igual(porId["agendamentos.mudarStatus"].efeito, "mutacao", "GET que muda dados é mutação");
  v.igual(porId["agendamentos.mudarStatus"].verificacao, "nao_implementada");
  v.verdade(a.sim.chamadasHttp.every((c) => c.metodo === "get"), "só GET no teste");
  v.falso(a.sim.chamadasHttp.some((c) => /change_status|confirm|cancel|create/.test(c.caminho)), "nenhum endereço que muda dados");
  v.verdade(a.sim.chamadasHttp.every((c) => c.autorizacao === "(presente)"), "Basic em todas");
  const tudo = JSON.stringify(r) + JSON.stringify(a.linhas("sis_logs")) + JSON.stringify(a.linhas("int_execucoes"));
  v.falso(tudo.indexOf(TOKEN_FALSO) >= 0, "o token não volta, não vai para log");
  v.falso(tudo.indexOf("usuario-api-sintetico") >= 0, "o usuário da API também não");
  v.verdade(a.sim.chamadasHttp.every((c) => c.comTrava === false), "nenhuma chamada ao Clinicorp com a trava do script");
});

teste("401 do Clinicorp: suspende a integração e avisa o administrador, sem derrubar a sessão de ninguém no Alveare", () => {
  const a = ambiente();
  configurar(a, { recebimentos: { modo: "importacao" } });
  a.cc.authRecusada = true;
  const r = a.p("executar", { recurso: "recebimentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" });
  const d = v.ok(r, "o lote termina e registra a falha");
  v.igual(d.estado, "falhou");
  v.verdade(r.sessao && r.sessao.tipo === "modulo", "a sessão do painel segue");
  const e = v.ok(a.p("estado"));
  v.igual(e.situacao, "suspensa");
  v.verdade(a.linhas("sis_logs").some((l) => l.nivel === "SECURITY" && l.evento === "CLINICORP_AUTENTICACAO"));
  const r2 = a.p("executar", { recurso: "recebimentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" });
  v.erro(r2, "integracao_suspensa");
  v.igual(r2.erro.categoria, "validacao", "nunca 'autenticacao': o navegador não pede login por causa do Clinicorp");
  v.ok(a.pedir("crm.ler", {}, a.tkBia), "quem usa o CRM continua conectado");
  v.ok(a.pedir("integracao.contexto", { modulo: "entradas" }, a.tkBia));
  /* credencial corrigida: o teste de conexão tira a suspensão */
  a.cc.authRecusada = false;
  v.ok(a.p("testar"));
  v.igual(v.ok(a.p("estado")).situacao, "ativa");
});

/* ============================ Sincronização ============================ */

function pagamento(id, dia, valor, extra) {
  return Object.assign({ id, PaymentHeaderId: 500 + id, Amount: valor, AmountWithDiscounts: valor * 0.97, DueDate: dia, ReceivedDate: dia,
    PaymentReceived: "X", PaymentConfirmed: "X", ConfirmedDate: dia, InstallmentNumber: "1", InstallmentsCount: "1",
    PaymentForm: "Cartão de Crédito", PatientId: 9001, PatientName: "Paciente Sintética Um", TreatmentId: 70, ReceiverBusinessId: 111,
    z_LastChange_Date: dia + "T12:00:00Z" }, extra || {});
}

teste("primeira importação exige prévia; janelas com retomada depois de falha; reimportar não duplica", () => {
  const a = ambiente();
  configurar(a, { recebimentos: { modo: "importacao" } });
  a.cc.pagamentos = [pagamento(1, "2026-09-05", 100), pagamento(2, "2026-10-10", 250.5), pagamento(3, "2026-11-15", 80)];
  v.erro(a.p("executar", { recurso: "recebimentos", modo: "importacao", de: "2026-09-01", ate: "2026-11-20" }), "sem_confirmacao");
  const prev = v.ok(a.p("executar", { recurso: "recebimentos", modo: "previa", de: "2026-09-01", ate: "2026-11-20" }));
  v.igual(prev.estado, "concluida");
  v.igual(prev.contagens.novos, 3);
  v.igual(prev.janelas, 3, "janelas de até 31 dias");
  v.igual(a.linhas("int_externos").length, 0, "prévia não grava registros");
  /* a segunda janela falha (503 nas três tentativas): para e guarda o ponto */
  a.cc.falharEm = (p) => p.caminho === "/payment/list" && p.query.from === "2026-10-02";
  const imp = v.ok(a.p("executar", { recurso: "recebimentos", modo: "importacao", de: "2026-09-01", ate: "2026-11-20", previaId: prev.id }));
  v.igual(imp.estado, "interrompida");
  v.igual(imp.cursor.janela, 1, "a primeira janela ficou gravada");
  v.igual(a.linhas("int_externos").length, 1);
  a.cc.falharEm = null;
  const fim = v.ok(a.p("executar", { recurso: "recebimentos", modo: "importacao", retomar: true, execucaoId: imp.id }));
  v.igual(fim.estado, "concluida");
  const ext = a.linhas("int_externos");
  v.igual(ext.length, 3);
  const r2 = ext.find((x) => x.externoId === "2").dados;
  v.igual(r2.valor, 25050, "dinheiro em centavos pelo texto");
  v.igual(r2.valorSemTaxas, null, "valor sem taxas só quando pedido");
  v.igual(r2.liquidacao, null, "liquidação não é inventada");
  /* incremental: de novo, nada novo */
  const inc = v.ok(a.p("executar", { recurso: "recebimentos", modo: "importacao" }));
  v.igual(inc.contagens.novos, 0);
  v.igual(a.linhas("int_externos").length, 3, "reimportar não duplica");
  v.igual(v.ok(a.p("estado")).ultimas.recebimentos.ate, "2026-11-20");
  v.verdade(a.sim.chamadasHttp.every((c) => c.comTrava === false));
});

teste("exclusão mútua: uma sincronização do mesmo recurso por vez", () => {
  const a = ambiente();
  configurar(a, { recebimentos: { modo: "importacao" } });
  a.sim.props.FLORESER_INT_TRAVA_RECEBIMENTOS = JSON.stringify({ execucaoId: "outra", ate: a.sim.agora + 60000 });
  v.erro(a.p("executar", { recurso: "recebimentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" }), "ocupado");
  a.sim.agora += 8 * 60000;
  v.ok(a.p("executar", { recurso: "recebimentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" }), "trava vencida não prende ninguém");
});

function importarRecebimentos(a) {
  const prev = v.ok(a.p("executar", { recurso: "recebimentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" }));
  return v.ok(a.p("executar", { recurso: "recebimentos", modo: "importacao", de: "2026-11-01", ate: "2026-11-20", previaId: prev.id }));
}

teste("recebimento parecido com duas entradas vira pendência; nunca vínculo automático; vincular/importar explícitos não duplicam", () => {
  const a = ambiente();
  configurar(a, { recebimentos: { modo: "importacao" } });
  ["e1", "e2"].forEach((id) => v.ok(a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.criar", { id, dados: { nome: "Paciente " + id, data: "2026-11-10",
    pagamentos: [{ metodo: "credito", valor: 15000, parcelas: 1 }] } })] }, a.tkAna)));
  a.cc.pagamentos = [pagamento(10, "2026-11-10", 150), pagamento(11, "2026-11-12", 99.9), pagamento(12, "2026-11-13", 50, { PaymentReceived: "", PaymentConfirmed: "", ReceivedDate: "2026-11-13" })];
  importarRecebimentos(a);
  v.igual(a.linhas("int_vinculos").length, 0, "nada vinculado sozinho");
  const pend = v.ok(a.p("pendencias")).pendencias;
  const conc = pend.find((p) => p.tipo === "conciliacao");
  v.igual(conc.detalhes.candidatas.sort(), ["e1", "e2"]);
  v.ok(a.p("resolver", { operacaoId: a.opId(), id: conc.id, decisao: "vincular", entradaId: "e2" }));
  v.igual(a.linhas("int_vinculos").length, 1);
  v.erro(a.p("reconciliar", { operacaoId: a.opId(), acao: "importar", externoId: "10" }), "dados_invalidos", "vinculado não importa de novo");
  const imp = v.ok(a.p("reconciliar", { operacaoId: a.opId(), acao: "importar", externoId: "11" }));
  v.verdade(/^clc-/.test(imp.entradaId));
  const imp2 = a.p("reconciliar", { operacaoId: a.opId(), acao: "importar", externoId: "11" });
  v.erro(imp2, "dados_invalidos", "a mesma importação de novo é recusada");
  v.erro(a.p("reconciliar", { operacaoId: a.opId(), acao: "importar", externoId: "12" }), "dados_invalidos", "ainda não recebido: só consulta");
  const ents = v.ok(a.pedir("entradas.ler", {}, a.tkAna)).entradas;
  v.igual(ents.length, 3);
  const nova = ents.find((e) => e.id === imp.entradaId);
  v.igual(nova.origem, "clinicorp");
  v.igual(nova.pagamentos, [{ metodo: "credito", valor: 9990, parcelas: 1 }], "valor bruto; taxa não descontada de novo");
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "entradas" }, a.tkBia));
  v.verdade(ctx.porLocal.e2 && ctx.porLocal.e2.recebimentoId === "10", "a Entradas mostra o vínculo como contexto");
  v.igual(ctx.porLocal.e2.liquidacao, null);
  /* o recebimento muda no Clinicorp: a entrada não muda, abre divergência */
  a.cc.pagamentos[0].Amount = 140;
  v.ok(a.p("executar", { recurso: "recebimentos", modo: "importacao", de: "2026-11-01", ate: "2026-11-20" }));
  v.verdade(v.ok(a.p("pendencias")).pendencias.some((p) => p.tipo === "divergencia" && p.localId === "e2"));
  const e2 = v.ok(a.pedir("entradas.ler", {}, a.tkAna)).entradas.find((e) => e.id === "e2");
  v.igual(e2.pagamentos[0].valor, 15000, "a entrada do Alveare fica como estava");
});

teste("orçamento aprovado: proposta (se configurado), aplicada pelas regras do CRM; rodar de novo não repropõe", () => {
  const a = ambiente();
  configurar(a, { orcamentos: { modo: "importacao" } }, { eventosOrcamento: { APPROVED: "propor" } });
  criarLead(a, "L1", { etapa: "em_aberto", cadencia: "quente" });
  v.ok(a.p("vincular", { operacaoId: a.opId(), tipo: "paciente", externoId: "9001", localTipo: "lead", localId: "L1" }));
  a.cc.orcamentos = [{ id: 3001, TreatmentId: 70, Status: "APPROVED", CreateDate: "2026-11-01", ApprovedDate: "2026-11-18", Amount: 1200, PatientId: 9001,
    PatientName: "Paciente Sintética Um", ProfessionalName: "Profissional Sintético", ProcedureList: [{ OperationDescription: "Limpeza de pele", FinalAmount: 1200 }] }];
  const prev = v.ok(a.p("executar", { recurso: "orcamentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" }));
  v.igual(prev.contagens.pendencias, 1);
  v.ok(a.p("executar", { recurso: "orcamentos", modo: "importacao", de: "2026-11-01", ate: "2026-11-20", previaId: prev.id }));
  let pend = v.ok(a.p("pendencias")).pendencias.filter((p) => p.tipo === "proposta_etapa");
  v.igual(pend.length, 1);
  v.igual(a.linhas("crm_leads")[0].etapa, "em_aberto", "importar não muda o funil");
  v.ok(a.p("resolver", { operacaoId: a.opId(), id: pend[0].id, decisao: "aplicar" }));
  const lead = a.linhas("crm_leads")[0];
  v.igual(lead.etapa, "venda");
  v.verdade(!!lead.dtVenda, "conferirLeadCRM carimbou o marco");
  v.verdade(a.linhas("sis_auditoria").some((e) => e.entidadeId === "L1" && /Clinicorp/.test(e.contexto)));
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "crm" }, a.tkBia));
  v.igual(ctx.porLocal.L1.orcamentos[0].status, "APPROVED");
  /* ciclo: mesmo dado de novo não abre nada; resolvida não reabre */
  v.ok(a.p("executar", { recurso: "orcamentos", modo: "importacao" }));
  pend = v.ok(a.p("pendencias", { estado: "" })).pendencias.filter((p) => p.tipo === "proposta_etapa");
  v.igual(pend.length, 1, "nenhuma proposta nova");
  /* regra padrão (contexto): só contexto, nenhuma proposta */
  const b = ambiente();
  configurar(b, { orcamentos: { modo: "importacao" } });
  criarLead(b, "L1", { etapa: "em_aberto", cadencia: "quente" });
  v.ok(b.p("vincular", { operacaoId: b.opId(), tipo: "paciente", externoId: "9001", localTipo: "lead", localId: "L1" }));
  b.cc.orcamentos = a.cc.orcamentos;
  const pv = v.ok(b.p("executar", { recurso: "orcamentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" }));
  v.igual(pv.contagens.pendencias, 0);
});

teste("proposta não se aplica se a lead já saiu da etapa de origem (regras do CRM decidem)", () => {
  const a = ambiente();
  configurar(a, { orcamentos: { modo: "importacao" } }, { eventosOrcamento: { APPROVED: "propor" } });
  criarLead(a, "L1", { etapa: "em_aberto", cadencia: "quente" });
  v.ok(a.p("vincular", { operacaoId: a.opId(), tipo: "paciente", externoId: "9001", localTipo: "lead", localId: "L1" }));
  a.cc.orcamentos = [{ id: 1, TreatmentId: 71, Status: "APPROVED", ApprovedDate: "2026-11-18", Amount: 500, PatientId: 9001 }];
  const prev = v.ok(a.p("executar", { recurso: "orcamentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" }));
  v.ok(a.p("executar", { recurso: "orcamentos", modo: "importacao", de: "2026-11-01", ate: "2026-11-20", previaId: prev.id }));
  const lead = a.linhas("crm_leads")[0];
  v.ok(a.pedir("crm.aplicar", { operacoes: [a.op("lead.alterar", { id: "L1", revBase: lead.rev, campos: { etapa: "recusado" } })] }, a.tkAna));
  const pend = v.ok(a.p("pendencias")).pendencias.find((p) => p.tipo === "proposta_etapa");
  v.erro(a.p("resolver", { operacaoId: a.opId(), id: pend.id, decisao: "aplicar" }), "dados_invalidos");
  v.igual(a.linhas("crm_leads")[0].etapa, "recusado");
});

teste("agendamento atualizado no Clinicorp não altera CRM nem Agenda; ausência na resposta não é exclusão", () => {
  const a = ambiente();
  configurar(a, { agendamentos: { modo: "importacao" } });
  criarLead(a, "L1", { etapa: "agendado", dataAgendada: "2026-11-25" });
  v.ok(a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id: "P1", dados: { nome: "Paciente Sintética Um", crmLeadId: "L1" } })] }, a.tkAna));
  v.ok(a.p("vincular", { operacaoId: a.opId(), tipo: "paciente", externoId: "9001", localTipo: "paciente", localId: "P1" }));
  a.cc.agendamentos = [
    { ItemType: "APPOINTMENT", id: 801, date: "2026-11-26T04:00:00.000Z", fromTime: "09:00", toTime: "10:00", Clinic_BusinessId: 111, Dentist_PersonId: 5,
      PatientName: "Paciente Sintética Um", StatusId: 1, z_LastChange_Date: "2026-11-19T10:00:00Z", _paciente: 9001 },
    { ItemType: "APPOINTMENT", id: 802, date: "2026-11-27T04:00:00.000Z", fromTime: "14:00", toTime: "15:00", Clinic_BusinessId: 111, PatientName: "Outra Pessoa", StatusId: 1, _paciente: 9002 },
    { ItemType: "ASSIGN", id: 803, AtomicDate: 20261127, fromTime: "12:00", toTime: "13:00", Name: "Almoço" }
  ];
  const crmAntes = JSON.stringify(a.linhas("crm_leads").map((l) => [l.etapa, l.dataAgendada, l.rev]));
  const agAntes = JSON.stringify(a.linhas("agenda_agendamentos")) + JSON.stringify(a.linhas("agenda_pacientes").map((p) => p.rev));
  const prev = v.ok(a.p("executar", { recurso: "agendamentos", modo: "previa", de: "2026-11-20", ate: "2026-11-30" }));
  v.ok(a.p("executar", { recurso: "agendamentos", modo: "importacao", de: "2026-11-20", ate: "2026-11-30", previaId: prev.id }));
  let ext = a.linhas("int_externos");
  v.igual(ext.length, 2, "compromisso (ASSIGN) não é agendamento de paciente");
  const ag801 = ext.find((x) => x.externoId === "801").dados;
  v.igual(ag801.dia, "2026-11-26", "dia de calendário pelo fuso da clínica, não pelo UTC");
  v.igual(ag801.precisao, "hora");
  v.igual(ag801.pacienteExternoId, "9001", "atribuído pela consulta filtrada da paciente vinculada");
  v.igual(ext.find((x) => x.externoId === "802").dados.pacienteExternoId, "", "sem vínculo, sem paciente — nunca pelo nome");
  /* remarcado no Clinicorp */
  a.cc.agendamentos[0].date = "2026-11-28T04:00:00.000Z";
  a.cc.agendamentos[0].z_LastChange_Date = "2026-11-20T11:00:00Z";
  const r2 = v.ok(a.p("executar", { recurso: "agendamentos", modo: "importacao", de: "2026-11-20", ate: "2026-11-30" }));
  v.igual(r2.contagens.alterados, 1);
  v.igual(JSON.stringify(a.linhas("crm_leads").map((l) => [l.etapa, l.dataAgendada, l.rev])), crmAntes, "o CRM não mudou");
  v.igual(JSON.stringify(a.linhas("agenda_agendamentos")) + JSON.stringify(a.linhas("agenda_pacientes").map((p) => p.rev)), agAntes, "a Agenda não mudou");
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "agenda" }, a.tkBia));
  v.igual(ctx.porLocal.P1.agendamentos.map((x) => x.dia), ["2026-11-28"], "a Agenda vê o agendamento externo como contexto");
  /* some da resposta: fica, marcado como ausente */
  a.cc.agendamentos.splice(1, 1);
  const r3 = v.ok(a.p("executar", { recurso: "agendamentos", modo: "importacao", de: "2026-11-20", ate: "2026-11-30" }));
  v.igual(r3.contagens.ausentes, 1);
  ext = a.linhas("int_externos");
  v.igual(ext.length, 2, "nada apagado");
  v.verdade(!!ext.find((x) => x.externoId === "802").ausenteDesde);
});

teste("complemento local sobrevive à atualização do Clinicorp; edição local concorrente conflita pela revisão", () => {
  const a = ambiente();
  configurar(a, { recebimentos: { modo: "importacao" } });
  a.cc.pagamentos = [pagamento(20, "2026-11-10", 300)];
  importarRecebimentos(a);
  const x = a.linhas("int_externos")[0];
  v.ok(a.p("complemento", { operacaoId: a.opId(), id: x.id, revBase: x.rev, complemento: { notas: "conferido com o extrato", categoria: "cartão" } }));
  a.cc.pagamentos[0].PaymentConfirmed = "";
  v.ok(a.p("executar", { recurso: "recebimentos", modo: "importacao", de: "2026-11-01", ate: "2026-11-20" }));
  const y = a.linhas("int_externos")[0];
  v.igual(y.complemento.notas, "conferido com o extrato", "complemento preservado");
  v.igual(y.dados.confirmado, false, "o dado externo atualizou");
  v.erro(a.p("complemento", { operacaoId: a.opId(), id: x.id, revBase: x.rev + 1, complemento: { notas: "outra" } }), "conflito");
});

/* ============================ Escrita no Clinicorp ============================ */

teste("resposta perdida depois de criar o paciente: resultado desconhecido, reenvio bloqueado; verificar acha e vincula", () => {
  const a = ambiente();
  configurar(a, { pacientes: { modo: "envio" } });
  criarLead(a, "L2", { nome: "Lead Nova Sintética", whatsapp: "65 99999-0042" });
  a.cc.criarSomeResposta = true;
  const opId = a.opId();
  const r = v.ok(a.p("criarPaciente", { operacaoId: opId, leadId: "L2", cpf: "12345678900" }));
  v.igual(r.passo.estado, "desconhecido");
  v.igual(a.cc.pacientes.length, 2, "no Clinicorp o paciente foi criado (só a resposta se perdeu)");
  v.falso(JSON.stringify(a.linhas("int_passos")).indexOf("12345678900") >= 0, "CPF não é guardado");
  v.verdade(v.ok(a.p("pendencias")).pendencias.some((p) => p.tipo === "resultado_desconhecido"));
  const de = a.p("criarPaciente", { operacaoId: opId, leadId: "L2" });
  v.erro(de, "integracao_incerta", "não reenvia sozinho");
  v.igual(a.sim.chamadasHttp.filter((c) => c.caminho === "/patient/create").length, 1, "uma criação só");
  const ver = v.ok(a.p("decidirPasso", { passoId: r.passo.id, decisao: "verificar" }));
  v.verdade(ver.encontrado);
  v.igual(ver.passo.estado, "confirmado");
  const vinc = a.linhas("int_vinculos").find((x) => x.localId === "L2");
  v.igual(vinc.externoId, "9002");
  v.igual(v.ok(a.p("pendencias")).pendencias.filter((p) => p.tipo === "resultado_desconhecido").length, 0, "pendência resolvida");
  v.verdade(a.sim.chamadasHttp.every((c) => c.comTrava === false));
});

teste("criar paciente com resposta normal vincula pelo telefone; repetir a operação não cria de novo", () => {
  const a = ambiente();
  configurar(a, { pacientes: { modo: "envio" } });
  criarLead(a, "L3", { nome: "Lead Três", whatsapp: "65 98888-0003" });
  const opId = a.opId();
  const r = v.ok(a.p("criarPaciente", { operacaoId: opId, leadId: "L3" }));
  v.igual(r.passo.estado, "confirmado");
  const r2 = v.ok(a.p("criarPaciente", { operacaoId: opId, leadId: "L3" }));
  v.verdade(r2.repetida);
  v.igual(a.sim.chamadasHttp.filter((c) => c.caminho === "/patient/create").length, 1);
  v.erro(a.p("criarPaciente", { operacaoId: a.opId(), leadId: "L3" }), "dados_invalidos", "lead já vinculada");
  v.erro(a.p("buscarPaciente", { criterio: "nome", valor: "Lead" }), "dados_invalidos", "busca por nome não é usada para vincular");
});

teste("envio de lead para campanha: só em modo envio; perdido não se verifica pela API → confirmação manual", () => {
  const a = ambiente();
  configurar(a, { crm: { modo: "consulta" } });
  criarLead(a, "L4", { whatsapp: "65 97777-0004" });
  v.erro(a.p("enviarLead", { operacaoId: a.opId(), leadId: "L4", campanha: "Campanha Sintética" }), "dados_invalidos", "consulta não envia");
  configurar(a, { crm: { modo: "envio" } });
  a.cc.enviarSomeResposta = true;
  const r = v.ok(a.p("enviarLead", { operacaoId: a.opId(), leadId: "L4", campanha: "Campanha Sintética" }));
  v.igual(r.passo.estado, "desconhecido");
  v.erro(a.p("decidirPasso", { passoId: r.passo.id, decisao: "verificar" }), "dados_invalidos");
  const c = v.ok(a.p("decidirPasso", { passoId: r.passo.id, decisao: "confirmar" }));
  v.igual(c.passo.estado, "confirmado");
  a.cc.enviarSomeResposta = false;
  v.erro(a.p("enviarLead", { operacaoId: a.opId(), leadId: "L4", campanha: "Campanha Sintética" }), "dados_invalidos", "mesma campanha não repete sem 'reenviar'");
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "crm" }, a.tkBia));
  v.igual(ctx.porLocal.L4.envios[0].estado, "confirmado");
});

/* ============================ Agendada e desconectar ============================ */

teste("sincronização agendada: identidade técnica auditável, só importa — nunca cria entrada", () => {
  const a = ambiente();
  configurar(a, { recebimentos: { modo: "importacao" } });
  a.cc.pagamentos = [pagamento(30, "2026-11-10", 100)];
  importarRecebimentos(a);
  v.ok(a.p("agendar", { frequenciaHoras: 6 }));
  v.igual(a.sim.gatilhos.length, 1);
  a.cc.pagamentos.push(pagamento(31, "2026-11-19", 200));
  a.gs.integracaoAgendada();
  const ex = a.linhas("int_execucoes").pop();
  v.igual(ex.origem, "agendada");
  v.igual(ex.autor, "Sincronização agendada (Clinicorp)");
  v.igual(a.linhas("int_externos").length, 2);
  v.igual(a.linhas("ent_entradas").length, 0, "nenhuma entrada criada pela rotina");
  v.ok(a.p("agendar", { frequenciaHoras: 0 }));
  v.igual(a.sim.gatilhos.length, 0);
});

teste("desconectar não apaga dados importados nem vínculos", () => {
  const a = ambiente();
  configurar(a, { recebimentos: { modo: "importacao" } });
  a.cc.pagamentos = [pagamento(40, "2026-11-10", 100)];
  importarRecebimentos(a);
  v.ok(a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.criar", { id: "e9", dados: { nome: "X", data: "2026-11-10", pagamentos: [{ metodo: "pix", valor: 1, parcelas: 1 }] } })] }, a.tkAna));
  v.ok(a.p("reconciliar", { operacaoId: a.opId(), acao: "vincular", externoId: "40", entradaId: "e9" }));
  const e = v.ok(a.p("suspender", { acao: "desconectar" }));
  v.igual(e.situacao, "desconectada");
  v.verdade(e.recursos.every((r) => r.modo === "desligado"));
  v.igual(a.linhas("int_externos").length, 1);
  v.igual(a.linhas("int_vinculos").filter((x) => x.estado === "ativo").length, 1);
  v.erro(a.p("executar", { recurso: "recebimentos", modo: "previa", de: "2026-11-01", ate: "2026-11-20" }), "integracao_suspensa");
});

module.exports = () => executar("Integração (simulada)");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
