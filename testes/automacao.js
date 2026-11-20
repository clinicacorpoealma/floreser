/* Sincronização operacional automática (4.2.0) — SIMULADA.
   O Clinicorp aqui é testes/util/clinicorp-falso.js: nenhum teste fala com a
   rede, e passar aqui não valida nada na conta real. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");
const { clinicorpFalso } = require("./util/clinicorp-falso");

const HOJE = "2026-11-20";

function pagamento(id, dia, valor, extra) {
  return Object.assign({ id, PaymentHeaderId: 500 + id, Amount: valor, DueDate: dia, ReceivedDate: dia, PaymentReceived: "X", PaymentConfirmed: "X",
    ConfirmedDate: dia, InstallmentNumber: "1", InstallmentsCount: "1", PaymentForm: "PIX", PatientId: 9001, PatientName: "Paciente Sintética Um",
    ReceiverBusinessId: 111, z_LastChange_Date: dia + "T12:00:00Z" }, extra || {});
}
function agendamento(id, dia, paciente, extra) {
  return Object.assign({ ItemType: "APPOINTMENT", id, date: dia + "T04:00:00.000Z", fromTime: "09:00", toTime: "10:00", Clinic_BusinessId: 111,
    Dentist_PersonId: 5, PatientName: "Paciente", StatusId: 1, z_LastChange_Date: HOJE + "T10:00:00Z", _paciente: paciente }, extra || {});
}

function ambiente() {
  const a = novoAmbiente();
  a.sim.agora = Date.parse(HOJE + "T15:00:00Z");
  a.criarConta({ usuario: "ana", nome: "Ana Sintética", senha: "segredo-ana", admin: true });
  a.criarConta({ usuario: "bia", nome: "Bia Sintética", senha: "segredo-bia", crm: true, agenda: true, entradas: true });
  a.criarConta({ usuario: "caio", nome: "Caio Sintético", senha: "segredo-caio", entradas: true });
  a.cc = clinicorpFalso();
  a.sim.http = a.cc.handler;
  a.sim.props.FLORESER_CLINICORP_USUARIO = "usuario-api-sintetico";
  a.sim.props.FLORESER_CLINICORP_TOKEN = "token-sintetico";
  a.painel = v.ok(a.pedir("sessao.entrarModulo", { modulo: "dev", senha: "senha-painel-teste" })).token;
  a.tkAna = a.entrar("ana", "segredo-ana");
  a.tkBia = a.entrar("bia", "segredo-bia");
  a.p = (acao, dados) => a.pedir("painel.integracao." + acao, dados || {}, a.painel);
  /* conexão primeiro (passo 1–2 do assistente): vínculos já nascem na conta certa */
  v.ok(a.p("configurar", { assinante: "assinante-sintetico", unidade: "111" }));
  a.n = 0;
  a.opId = () => "op-auto-" + (++a.n) + "-xxxxxxxx";
  return a;
}

/* o caminho do assistente: conexão → recomendada → áreas → prévia e
   importação inicial de cada recurso → ativar */
function assistente(a, extra) {
  v.ok(a.p("configurar", Object.assign({ assinante: "assinante-sintetico", unidade: "111", recomendada: true, areaPorProfissional: { 5: "facial" } }, extra || {})));
  ["recebimentos", "orcamentos", "agendamentos"].forEach((r) => {
    const prev = v.ok(a.p("executar", { recurso: r, modo: "previa", de: "2026-11-01", ate: "2026-12-31" }));
    v.igual(prev.estado, "concluida", "prévia de " + r);
    let imp = v.ok(a.p("executar", { recurso: r, modo: "importacao", de: "2026-11-01", ate: "2026-12-31", previaId: prev.id }));
    let voltas = 0;
    while (imp.estado === "interrompida" && voltas++ < 20) imp = v.ok(a.p("executar", { recurso: r, modo: "importacao", retomar: true, execucaoId: imp.id }));
    v.igual(imp.estado, "concluida", "importação de " + r);
  });
  return v.ok(a.p("ativar", { intervaloMin: 30 }));
}

function lead(a, id, dados) {
  const r = a.pedir("crm.aplicar", { operacoes: [a.op("lead.criar", { id, dados: Object.assign({ nome: "Lead " + id, etapa: "nao_responde", cadencia: "quente" }, dados || {}) })] }, a.tkAna);
  v.verdade(v.ok(r).resultados[0].ok, JSON.stringify(r.dados.resultados[0]));
}
function paciente(a, id, dados) {
  const r = a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id, dados: Object.assign({ nome: "Paciente " + id, criadoEm: "2026-10-01" }, dados || {}) })] }, a.tkAna);
  v.verdade(v.ok(r).resultados[0].ok, JSON.stringify(r.dados.resultados[0]));
}
function vincular(a, ext, localTipo, localId) {
  v.ok(a.p("vincular", { operacaoId: a.opId(), tipo: "paciente", externoId: ext, localTipo, localId }));
}

/* ============================== ponta a ponta ============================== */

teste("ponta a ponta: configurar uma vez, mudar a fonte, a rotina agendada atualiza os módulos sem ninguém abrir o painel", () => {
  const a = ambiente();
  lead(a, "L1", { etapa: "em_aberto", cadencia: "quente" });
  paciente(a, "P1", { crmLeadId: "L1", ciclos: { facial: { freq: 14, ultimo: "2026-11-10", agendamento: null, proximos: [] } } });
  vincular(a, "9001", "paciente", "P1");
  a.cc.pagamentos = [pagamento(1, "2026-11-12", 150)];
  a.cc.orcamentos = [{ id: 30, TreatmentId: 70, Status: "OPEN", CreateDate: "2026-11-05", Amount: 1200, PatientId: 9001, PatientName: "Paciente Sintética Um" }];
  a.cc.agendamentos = [agendamento(801, "2026-11-27", 9001)];
  const estado = assistente(a);
  v.igual(estado.intervaloMin, 30, "a rotina mostra o intervalo real");
  v.igual(a.sim.gatilhos.length, 1);
  /* o que já existia entrou na importação inicial */
  let ents = v.ok(a.pedir("entradas.ler", {}, a.tkAna)).entradas;
  v.igual(ents.length, 1, "recebimento recebido virou entrada");
  v.igual(ents[0].origem, "clinicorp");
  let p1 = v.ok(a.pedir("agenda.ler", {}, a.tkAna)).pacientes.find((p) => p.id === "P1");
  v.igual(p1.ciclos.facial.agendamento.data, "2026-11-27", "agendamento futuro da paciente vinculada entrou na série");
  /* --- a fonte muda; ninguém abre nada --- */
  a.cc.pagamentos.push(pagamento(2, "2026-11-19", 80.5, { PaymentForm: "Cartão de Crédito" }));
  a.cc.orcamentos[0].Status = "APPROVED"; a.cc.orcamentos[0].ApprovedDate = "2026-11-19";
  a.cc.agendamentos[0].date = "2026-11-29T04:00:00.000Z";
  a.cc.agendamentos.push(agendamento(802, "2026-12-10", 9001));
  a.gs.integracaoAgendada();
  ents = v.ok(a.pedir("entradas.ler", {}, a.tkAna)).entradas;
  v.igual(ents.length, 2, "recebimento novo entrou sozinho");
  v.igual(ents.find((e) => e.pagamentos[0].metodo === "credito").pagamentos[0].valor, 8050);
  const l1 = a.linhas("crm_leads").find((l) => l.id === "L1");
  v.igual(l1.etapa, "venda", "orçamento aprovado aplicado pelas regras do CRM (via paciente da Agenda ligada à lead)");
  v.verdade(!!l1.dtVenda);
  p1 = v.ok(a.pedir("agenda.ler", {}, a.tkAna)).pacientes.find((p) => p.id === "P1");
  v.igual([p1.ciclos.facial.agendamento.data].concat(p1.ciclos.facial.proximos), ["2026-11-29", "2026-12-10"], "remarcado e novo, sem duplicar");
  v.igual(a.linhas("int_pendencias").filter((p) => p.estado === "aberta").length, 0, "nada pediu atenção");
  /* rodar de novo sem mudança: nada muda, nada duplica */
  const antes = JSON.stringify([a.linhas("ent_entradas").length, a.linhas("agenda_agendamentos").length, a.linhas("sis_auditoria").length]);
  a.gs.integracaoAgendada();
  v.igual(JSON.stringify([a.linhas("ent_entradas").length, a.linhas("agenda_agendamentos").length, a.linhas("sis_auditoria").length]), antes);
  /* desmarcado no Clinicorp: sai da série, o resto fica */
  a.cc.agendamentos[1].Canceled = "X";
  a.gs.integracaoAgendada();
  p1 = v.ok(a.pedir("agenda.ler", {}, a.tkAna)).pacientes.find((p) => p.id === "P1");
  v.igual([p1.ciclos.facial.agendamento.data].concat(p1.ciclos.facial.proximos), ["2026-11-29"]);
  const rot = v.ok(a.p("estado")).ultimaRotina;
  v.verdade(rot && rot.aplicacao, "a rotina registra o que fez");
  v.verdade(a.linhas("int_execucoes").some((e) => e.origem === "agendada" && e.autor === "Sincronização agendada (Clinicorp)"));
});

/* ============================== exceções ============================== */

teste("uma exceção não segura a fila: forma desconhecida vira pendência só daquele recebimento", () => {
  const a = ambiente();
  a.cc.pagamentos = [pagamento(1, "2026-11-12", 100, { PaymentForm: "Permuta" }), pagamento(2, "2026-11-13", 200)];
  assistente(a);
  v.igual(a.linhas("ent_entradas").length, 1, "o recebimento bom entrou");
  const pend = a.linhas("int_pendencias").filter((p) => p.estado === "aberta");
  v.igual(pend.map((p) => p.tipo), ["dado_ausente"]);
});

teste("recebimento parecido com entrada manual: pergunta só sobre ele, na própria Entradas; a decisão vale para as próximas atualizações", () => {
  const a = ambiente();
  v.ok(a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.criar", { id: "e-man", dados: { nome: "Paciente", data: "2026-11-12", obs: "anotação local",
    pagamentos: [{ metodo: "pix", valor: 15000, parcelas: 1 }] } })] }, a.tkAna));
  a.cc.pagamentos = [pagamento(1, "2026-11-12", 150)];
  assistente(a);
  v.igual(a.linhas("ent_entradas").length, 1, "não criou em dobro");
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "entradas" }, a.tkBia));
  const pend = ctx.porLocal["e-man"].pendencias[0];
  v.igual(pend.tipo, "conciliacao", "a pendência aparece na própria entrada");
  const tkCaio = a.entrar("caio", "segredo-caio");
  v.erro(a.pedir("integracao.decidir", { modulo: "crm", operacaoId: a.opId(), id: pend.id, decisao: "vincular", entradaId: "e-man" }, tkCaio), "sem_acesso", "quem não tem CRM não decide como CRM");
  v.ok(a.pedir("integracao.decidir", { modulo: "entradas", operacaoId: a.opId(), id: pend.id, decisao: "vincular", entradaId: "e-man" }, tkCaio));
  /* o valor muda no Clinicorp: a entrada vinculada acompanha sozinha */
  a.cc.pagamentos[0].Amount = 160;
  a.gs.integracaoAgendada();
  const e = v.ok(a.pedir("entradas.ler", {}, a.tkAna)).entradas[0];
  v.igual(e.pagamentos[0].valor, 16000);
  v.igual(e.obs, "anotação local", "o que é do Alveare fica");
  v.verdade(a.linhas("sis_auditoria").some((x) => x.entidadeId === "e-man" && x.campo === "Valor" && x.contexto === "Clinicorp"), "com histórico");
  /* data e valor não se editam no Alveare; observação sim */
  const rev = e._rev;
  v.verdade(!v.ok(a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.alterar", { id: "e-man", revBase: rev, pagamentos: [{ metodo: "pix", valor: 1, parcelas: 1 }] })] }, a.tkAna)).resultados[0].ok);
  v.verdade(v.ok(a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.alterar", { id: "e-man", revBase: rev, campos: { obs: "outra" } })] }, a.tkAna)).resultados[0].ok);
  /* estorno no Clinicorp: marcado, não apagado; fora das somas do Financeiro */
  a.cc.pagamentos[0].PaymentReceived = ""; a.cc.pagamentos[0].PaymentConfirmed = "";
  v.ok(a.p("executar", { recurso: "recebimentos", modo: "importacao", de: "2026-11-01", ate: "2026-12-31" }));
  const e2 = v.ok(a.pedir("entradas.ler", {}, a.tkAna)).entradas[0];
  v.igual(e2.externoEstado, "estornado");
  const res = v.ok(a.pedir("financeiro.resumo", { filtros: { de: "2026-11", ate: "2026-11" } }, a.tkAna));
  v.igual(res.atual.entradas.recebido, 0, "estornado não conta como recebido");
});

teste("pacientes além do limite de uma execução: o cursor cobre todas nas continuações, e só então a consulta fica completa", () => {
  const a = ambiente();
  v.ok(a.p("configurar", { assinante: "assinante-sintetico", unidade: "111", recursos: { agendamentos: { modo: "importacao" } } }));
  for (let i = 0; i < 25; i++) {
    paciente(a, "P" + i);
    vincular(a, String(9100 + i), "paciente", "P" + i);
  }
  a.cc.agendamentos = [agendamento(900, "2026-11-25", 9124)];
  a.gs.CLINICORP_MAX_CHAMADAS = 8;
  const prev = v.ok(a.p("executar", { recurso: "agendamentos", modo: "previa", de: "2026-11-20", ate: "2026-11-30" }));
  v.igual(prev.estado, "interrompida", "o limite de chamadas interrompeu — não marcou como completa");
  let r = prev, voltas = 0;
  while (r.estado === "interrompida" && voltas++ < 20) r = v.ok(a.p("executar", { recurso: "agendamentos", modo: "previa", retomar: true, execucaoId: r.id }));
  v.igual(r.estado, "concluida");
  const consultadas = new Set(a.sim.chamadasHttp.filter((c) => c.caminho === "/appointment/list" && c.query.patientId).map((c) => c.query.patientId));
  v.igual(consultadas.size, 25, "todas as 25 pacientes, não só as primeiras");
  v.igual(r.contagens.pacientesConsultadas >= 1, true);
});

teste("trocar de conta ou unidade não mistura dados nem reaproveita checkpoint", () => {
  const a = ambiente();
  a.cc.pagamentos = [pagamento(1, "2026-11-12", 100)];
  assistente(a);
  v.verdade(a.linhas("int_externos").every((x) => x.id.indexOf("clinicorp:assinante-sintetico:") === 0), "identidade leva o assinante");
  const e1 = v.ok(a.p("estado"));
  v.verdade(!!e1.ultimas.recebimentos);
  v.ok(a.p("configurar", { unidade: "222" }));
  const e2 = v.ok(a.p("estado"));
  v.igual(Object.keys(e2.ultimas).length, 0, "pontos de retomada eram da outra unidade");
  v.erro(a.p("executar", { recurso: "recebimentos", modo: "importacao" }), "dados_invalidos", "incremental sem retomada da outra unidade");
  v.ok(a.p("configurar", { assinante: "outra-conta", unidade: "111" }));
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "entradas" }, a.tkBia));
  v.igual(Object.keys(ctx.porLocal).length, 0, "vínculos da outra conta não aparecem");
});

teste("Agenda: data que veio do Clinicorp não é apagada por edição local; envio de ação de agenda com resposta perdida é verificado", () => {
  const a = ambiente();
  paciente(a, "P1", { ciclos: { facial: { freq: 14, ultimo: "2026-11-10", agendamento: null, proximos: [] } } });
  vincular(a, "9001", "paciente", "P1");
  a.cc.agendamentos = [agendamento(801, "2026-11-27", 9001)];
  assistente(a, { envioAgenda: true });
  let p1 = v.ok(a.pedir("agenda.ler", {}, a.tkAna)).pacientes.find((p) => p.id === "P1");
  const tirar = a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.alterar", { id: "P1", revBase: p1._rev, ciclos: { facial: Object.assign({}, p1.ciclos.facial, { agendamento: null, proximos: [] }) } })] }, a.tkAna);
  v.verdade(!v.ok(tirar).resultados[0].ok && /Clinicorp/.test(tirar.dados.resultados[0].erro.mensagem), "recusado com o motivo");
  a.cc.acaoSomeResposta = true;
  const env = v.ok(a.pedir("integracao.enviar", { modulo: "agenda", acao: "desmarcar", externoId: "801", operacaoId: a.opId() }, a.tkBia));
  v.igual(env.passo.estado, "confirmado", "resposta perdida, mas a consulta do dia mostrou desmarcado");
  v.verdade(a.sim.chamadasHttp.every((c) => c.comTrava === false), "nada com a trava do script");
});

teste("credencial revogada pausa só a integração; falha temporária retoma sozinha na próxima rotina", () => {
  const a = ambiente();
  a.cc.pagamentos = [pagamento(1, "2026-11-12", 100)];
  assistente(a);
  a.cc.pagamentos.push(pagamento(2, "2026-11-19", 50));
  a.cc.falharEm = (p) => p.caminho === "/payment/list";
  a.gs.integracaoAgendada();
  v.igual(a.linhas("ent_entradas").length, 1, "indisponível: nada novo");
  a.cc.falharEm = null;
  a.gs.integracaoAgendada();
  v.igual(a.linhas("ent_entradas").length, 2, "na rotina seguinte, recuperou sozinho");
  a.cc.authRecusada = true;
  a.gs.integracaoAgendada();
  v.igual(v.ok(a.p("estado")).situacao, "suspensa");
  v.ok(a.pedir("entradas.ler", {}, a.tkBia), "a sessão de quem usa o Alveare continua");
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "entradas" }, a.tkBia));
  v.igual(ctx.estado.estado, "interrompida", "a tela diz 'conexão interrompida'");
});

teste("identidade: só sugere com nome E telefone; a decisão é tomada na lead e guardada", () => {
  const a = ambiente();
  lead(a, "L9", { nome: "Carla Sintética", whatsapp: "(65) 99999-0009", etapa: "em_aberto", cadencia: "quente" });
  lead(a, "L8", { nome: "Outra Pessoa", whatsapp: "(65) 99999-0009" });
  a.cc.orcamentos = [{ id: 31, TreatmentId: 71, Status: "OPEN", CreateDate: "2026-11-05", Amount: 900, PatientId: 9555, PatientName: "Carla Sintética", PatientMobilePhone: "65999990009" }];
  assistente(a);
  const ctx = v.ok(a.pedir("integracao.contexto", { modulo: "crm" }, a.tkBia));
  v.igual(ctx.porLocal.L9.pendencias[0].tipo, "identidade");
  v.falso(ctx.porLocal.L8 && ctx.porLocal.L8.pendencias, "telefone igual com outro nome não é prova");
  v.igual(a.linhas("int_vinculos").filter((x) => x.localId === "L9").length, 0, "nunca vincula sozinho");
  v.ok(a.pedir("integracao.decidir", { modulo: "crm", operacaoId: a.opId(), id: ctx.porLocal.L9.pendencias[0].id, decisao: "mesmo" }, a.tkBia));
  a.cc.orcamentos[0].Status = "APPROVED"; a.cc.orcamentos[0].ApprovedDate = "2026-11-19";
  a.gs.integracaoAgendada();
  v.igual(a.linhas("crm_leads").find((l) => l.id === "L9").etapa, "venda", "com o vínculo salvo, o próximo evento entra sozinho");
});

module.exports = () => executar("Automação (simulada)");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
