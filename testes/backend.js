/* Testes do backend no simulador do Apps Script — dados sintéticos. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");

const DIA = 86400000;

function ambienteComContas() {
  const a = novoAmbiente();
  a.ana = a.criarConta({ usuario: "ana", nome: "Ana Sintética", senha: "segredo-ana", admin: true });
  a.bia = a.criarConta({ usuario: "bia", nome: "Bia Sintética", senha: "segredo-bia", crm: true, agenda: true, entradas: true });
  a.caio = a.criarConta({ usuario: "caio", nome: "Caio Sintético", senha: "segredo-caio", crm: true });
  return a;
}

function criarLead(a, tk, id, dados) {
  const r = a.pedir("crm.aplicar", { operacoes: [a.op("lead.criar", { id, dados: Object.assign({ nome: "Lead " + id, etapa: "nao_responde", cadencia: "quente" }, dados || {}) })] }, tk);
  v.ok(r);
  v.verdade(r.dados.resultados[0].ok, "criação da lead " + id + ": " + JSON.stringify(r.dados.resultados[0]));
  return r.dados.resultados[0];
}

function alterarLead(a, tk, id, revBase, campos, extra) {
  return a.pedir("crm.aplicar", { operacoes: [a.op("lead.alterar", Object.assign({ id, revBase, campos }, extra || {}))] }, tk);
}

/* ============================ Sessões ============================ */

teste("login guarda só o hash do token e devolve a validade definida pelo servidor", () => {
  const a = ambienteComContas();
  const r = a.pedir("sessao.entrar", { usuario: "bia", senha: "segredo-bia" });
  const d = v.ok(r);
  v.verdade(d.token.length >= 64);
  v.igual(d.sessao.tipo, "conta");
  v.verdade(new Date(d.sessao.expiraEm) > new Date(), "expiraEm no futuro");
  v.verdade(new Date(d.sessao.expiraAbsoluto) > new Date(d.sessao.expiraEm), "teto absoluto depois da inatividade");
  const linhas = a.linhas("sis_sessoes");
  v.igual(linhas.length, 1);
  v.verdade(linhas[0].tokenHash !== d.token && linhas[0].tokenHash.length === 64, "a planilha guarda o hash");
  v.igual(d.conta.permissoes, { crm: true, agenda: true, entradas: true, financeiro: false }, "Entradas não dá Financeiro");
});

teste("senha errada conta tentativas e bloqueia na quinta", () => {
  const a = ambienteComContas();
  let r;
  for (let i = 0; i < 4; i++) { r = a.pedir("sessao.entrar", { usuario: "bia", senha: "errada" }); v.erro(r, "credenciais"); }
  v.igual(r.erro.restam, 1);
  r = a.pedir("sessao.entrar", { usuario: "bia", senha: "errada" });
  v.erro(r, "credenciais");
  r = a.pedir("sessao.entrar", { usuario: "bia", senha: "segredo-bia" });
  v.erro(r, "bloqueado");
  v.verdade(r.erro.minutos > 0);
});

teste("conta do esquema antigo (v1) entra com a senha de sempre e passa a PBKDF2, guardando o verificador antigo", () => {
  const a = ambienteComContas();
  a.gs.reiniciarExecucao();
  const salt = "0123456789abcdef0123456789abcdef";
  a.gs.inserir("sis_usuarios", [{ id: "uv1", nome: "Antiga", usuario: "antiga", esquema: "v1", senhaHash: a.gs.derivarSenhaV1("senha-velha", salt),
    salt, iteracoes: null, ativo: true, admin: false, crm: true, agenda: false, entradas: false, credencialVersao: 1, legado: null }]);
  const tk = a.entrar("antiga", "senha-velha");
  v.verdade(!!tk);
  const u = a.linhas("sis_usuarios").find((x) => x.id === "uv1");
  v.igual(u.esquema, "pbkdf2");
  v.igual(u.legado.saltV1, salt, "verificador antigo guardado para um eventual retorno");
  v.verdade(!!a.entrar("antiga", "senha-velha"), "entra de novo, agora pelo PBKDF2");
  v.erro(a.pedir("sessao.entrar", { usuario: "antiga", senha: "outra" }), "credenciais");
});

teste("uso renova o prazo (no máximo uma escrita por hora) e inatividade de 30 dias vence", () => {
  const a = ambienteComContas();
  const t0 = Date.parse("2026-11-01T12:00:00Z");
  a.sim.agora = t0;
  const tk = a.entrar("bia", "segredo-bia");
  a.sim.agora = t0 + 2 * 3600000;
  const r = a.pedir("crm.ler", {}, tk);
  v.ok(r);
  v.igual(Date.parse(r.sessao.expiraEm), t0 + 2 * 3600000 + 30 * DIA, "prazo empurrado pelo uso");
  a.sim.agora = t0 + 2 * 3600000 + 31 * DIA;
  a.sim.esquecerCache();
  v.erro(a.pedir("crm.ler", {}, tk), "sessao_expirada");
  a.sim.agora = null;
});

teste("o teto absoluto de 180 dias vale mesmo com uso contínuo", () => {
  const a = ambienteComContas();
  const t0 = Date.parse("2026-01-01T12:00:00Z");
  a.sim.agora = t0;
  const tk = a.entrar("bia", "segredo-bia");
  for (let d = 20; d < 180; d += 20) { a.sim.agora = t0 + d * DIA; v.ok(a.pedir("crm.ler", {}, tk), "dia " + d); }
  a.sim.agora = t0 + 181 * DIA;
  v.erro(a.pedir("crm.ler", {}, tk), "sessao_expirada");
  a.sim.agora = null;
});

teste("sair encerra só esta sessão; o outro aparelho continua", () => {
  const a = ambienteComContas();
  const celular = a.entrar("bia", "segredo-bia");
  const computador = a.entrar("bia", "segredo-bia");
  v.ok(a.pedir("sessao.sair", {}, celular));
  v.erro(a.pedir("crm.ler", {}, celular), "sessao_revogada");
  v.ok(a.pedir("crm.ler", {}, computador), "o outro aparelho segue");
});

teste("desativar a conta derruba a sessão na hora, mesmo com o cache quente", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  v.ok(a.pedir("crm.ler", {}, tk));
  const painel = v.ok(a.pedir("sessao.entrarModulo", { modulo: "dev", senha: "senha-painel-teste" })).token;
  v.ok(a.pedir("painel.usuarios.status", { id: a.bia.id, ativo: false }, painel));
  const r = a.pedir("crm.ler", {}, tk);
  v.verdade(r.ok === false && r.erro.categoria === "autenticacao", "pede login de novo: " + JSON.stringify(r.erro));
});

teste("trocar a senha encerra as sessões antigas; mudar permissão não encerra, só restringe", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  const painel = v.ok(a.pedir("sessao.entrarModulo", { modulo: "dev", senha: "senha-painel-teste" })).token;
  v.ok(a.pedir("painel.usuarios.editar", { id: a.bia.id, nome: "Bia", usuario: "bia", crm: true, agenda: false, entradas: true }, painel));
  const semAgenda = a.pedir("agenda.ler", {}, tk);
  v.erro(semAgenda, "sem_acesso");
  v.igual(semAgenda.erro.categoria, "autorizacao", "falta de acesso não é falha de autenticação");
  v.ok(a.pedir("crm.ler", {}, tk), "a conta continua valendo no CRM");
  const conf = v.ok(a.pedir("sessao.conferir", { modulo: "agenda" }, tk));
  v.igual(conf.acessoModulo, false);
  v.ok(a.pedir("painel.usuarios.senha", { id: a.bia.id, senha: "nova-senha-bia" }, painel));
  v.erro(a.pedir("crm.ler", {}, tk), "sessao_revogada");
  v.verdade(!!a.entrar("bia", "nova-senha-bia"));
});

teste("servidor ocupado não derruba leitura nem sessão (renovação fica para depois)", () => {
  const a = ambienteComContas();
  const t0 = Date.now();
  a.sim.agora = t0;
  const tk = a.entrar("bia", "segredo-bia");
  a.sim.agora = t0 + 3 * 3600000;
  a.sim.travaOcupada = true;
  v.ok(a.pedir("crm.ler", {}, tk), "leitura não espera a trava");
  const r = a.pedir("crm.aplicar", { operacoes: [a.op("lead.criar", { id: "x1", dados: { nome: "X" } })] }, tk);
  v.erro(r, "ocupado");
  v.igual(r.erro.categoria, "indisponivel");
  v.verdade(r.erro.repetivel, "o navegador sabe que pode repetir");
  a.sim.travaOcupada = false;
  a.sim.agora = null;
});

teste("cache esquecido não muda nada: a planilha é a fonte da sessão", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  a.sim.esquecerCache();
  v.ok(a.pedir("crm.ler", {}, tk));
});

teste("login repetido com o mesmo operacaoId encerra a sessão órfã da primeira tentativa", () => {
  const a = ambienteComContas();
  a.entrar("bia", "segredo-bia", "login-repetido-1");
  const segundo = a.entrar("bia", "segredo-bia", "login-repetido-1");
  const vivas = a.linhas("sis_sessoes").filter((s) => !s.revogadoEm);
  v.igual(vivas.length, 1);
  v.igual(a.linhas("sis_sessoes").find((s) => s.revogadoEm).motivo, "substituida");
  v.ok(a.pedir("crm.ler", {}, segundo));
});

teste("senha compartilhada: só o módulo dela, 30 minutos de inatividade, e pode ser desligada", () => {
  const a = ambienteComContas();
  const t0 = Date.now();
  a.sim.agora = t0;
  const d = v.ok(a.pedir("sessao.entrarModulo", { modulo: "crm", senha: "senha-crm-teste" }));
  v.igual(d.sessao.tipo, "modulo");
  v.ok(a.pedir("crm.ler", {}, d.token));
  v.erro(a.pedir("agenda.ler", {}, d.token), "sem_acesso");
  v.erro(a.pedir("busca.global", { termo: "ab" }, d.token), "sem_acesso");
  a.sim.agora = t0 + 20 * 60000;
  v.ok(a.pedir("crm.ler", {}, d.token), "uso dentro do prazo renova");
  a.sim.agora = t0 + 20 * 60000 + 31 * 60000;
  a.sim.esquecerCache();
  v.erro(a.pedir("crm.ler", {}, d.token), "sessao_expirada");
  v.erro(a.pedir("sessao.entrarModulo", { modulo: "crm", senha: "errada" }), "credenciais");
  const painel = v.ok(a.pedir("sessao.entrarModulo", { modulo: "dev", senha: "senha-painel-teste" })).token;
  v.ok(a.pedir("painel.senhaModulo", { modulo: "crm", ligada: false }, painel));
  v.erro(a.pedir("sessao.entrarModulo", { modulo: "crm", senha: "senha-crm-teste" }), "senha_modulo_desligada");
  a.sim.agora = null;
});

teste("a senha do módulo nunca fica em texto nas propriedades", () => {
  const a = ambienteComContas();
  v.verdade(!("FLORESER_SENHA_CRM" in a.sim.props), "texto apagado");
  v.verdade(JSON.parse(a.sim.props.FLORESER_SENHA_HASH_CRM).esquema === "pbkdf2");
});

/* ============================ CRM ============================ */

teste("alterar uma lead grava só ela, sobe a revisão dela e gera auditoria com autor do servidor", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  criarLead(a, tk, "l1"); criarLead(a, tk, "l2");
  const antesL2 = JSON.stringify(a.linhas("crm_leads").find((l) => l.id === "l2"));
  const r = alterarLead(a, tk, "l1", 1, { interesse: "Facial", autorNome: "Falso" });
  v.erro({ ok: false, erro: r.dados.resultados[0].erro }, "dados_invalidos", "campo fora da lista é recusado");
  const r2 = alterarLead(a, tk, "l1", 1, { interesse: "Facial" });
  v.igual(r2.dados.resultados[0].rev, 2);
  v.igual(JSON.stringify(a.linhas("crm_leads").find((l) => l.id === "l2")), antesL2, "a outra lead não foi tocada");
  const au = a.linhas("sis_auditoria").filter((e) => e.entidadeId === "l1" && e.acao === "alterou");
  v.igual(au.length, 1);
  v.igual(au[0].autorNome, "Bia Sintética");
  v.igual(au[0].depois, "Facial");
});

teste("edições independentes em duas leads, a partir da mesma leitura, não conflitam", () => {
  const a = ambienteComContas();
  const t1 = a.entrar("bia", "segredo-bia"), t2 = a.entrar("ana", "segredo-ana");
  criarLead(a, t1, "l1"); criarLead(a, t1, "l2");
  v.verdade(alterarLead(a, t1, "l1", 1, { interesse: "A" }).dados.resultados[0].ok);
  v.verdade(alterarLead(a, t2, "l2", 1, { interesse: "B" }).dados.resultados[0].ok, "revisão por entidade");
});

teste("a mesma lead mudada nos dois lados é conflito, com o estado atual para conciliar", () => {
  const a = ambienteComContas();
  const t1 = a.entrar("bia", "segredo-bia"), t2 = a.entrar("ana", "segredo-ana");
  criarLead(a, t1, "l1");
  alterarLead(a, t1, "l1", 1, { interesse: "Corporal" });
  const r = alterarLead(a, t2, "l1", 1, { observacoes: "nota" }).dados.resultados[0];
  v.igual(r.ok, false);
  v.igual(r.erro.codigo, "conflito");
  v.igual(r.erro.rev, 2);
  v.igual(r.erro.atual.interesse, "Corporal");
});

teste("resposta perdida: o mesmo pedido de novo não duplica nada", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  criarLead(a, tk, "l1");
  const op = a.op("lead.alterar", { id: "l1", revBase: 1, campos: { interesse: "Capilar" },
    contatos: [{ id: "contato-0001", leadId: "l1", data: "2026-11-19", criadoEm: "2026-11-19T12:00:00Z" }] });
  const r1 = a.pedir("crm.aplicar", { operacoes: [op] }, tk).dados.resultados[0];
  const r2 = a.pedir("crm.aplicar", { operacoes: [op] }, tk).dados.resultados[0];
  v.verdade(r1.ok && r2.ok);
  v.verdade(r2.repetida, "reconhecida como repetição");
  v.igual(r2.rev, 2);
  v.igual(a.linhas("crm_contatos").length, 1);
  v.igual(a.linhas("sis_auditoria").filter((e) => e.entidadeId === "l1" && e.acao !== "criou" && e.acao !== "criou_detalhe").length, 1);
  a.sim.esquecerCache();
  const r3 = a.pedir("crm.aplicar", { operacoes: [op] }, tk).dados.resultados[0];
  v.verdade(r3.repetida, "a prova sobrevive à perda do cache");
});

teste("o mesmo operacaoId com outro conteúdo é erro explícito", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  criarLead(a, tk, "l1");
  const op = a.op("lead.alterar", { id: "l1", revBase: 1, campos: { interesse: "A" } });
  v.verdade(a.pedir("crm.aplicar", { operacoes: [op] }, tk).dados.resultados[0].ok);
  const outro = Object.assign({}, op, { campos: { interesse: "B" } });
  v.igual(a.pedir("crm.aplicar", { operacoes: [outro] }, tk).dados.resultados[0].erro.codigo, "operacao_divergente");
  const caio = a.entrar("caio", "segredo-caio");
  v.igual(a.pedir("crm.aplicar", { operacoes: [op] }, caio).dados.resultados[0].erro.codigo, "operacao_divergente", "outra pessoa não reaproveita o id");
});

teste("queda entre escritas: a próxima execução termina o plano, e o reenvio não duplica auditoria", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  criarLead(a, tk, "l1");
  const op = a.op("lead.alterar", { id: "l1", revBase: 1, campos: { etapa: "conversando" },
    contatos: [{ id: "contato-queda-1", leadId: "l1", data: "2026-11-19" }] });
  a.sim.falharEm = "gravar:crm_leads";
  const r1 = a.pedir("crm.aplicar", { operacoes: [op] }, tk);
  v.erro(r1, "servidor_falhou", "a execução morreu no meio");
  v.igual(a.linhas("sis_operacoes").find((o) => o.operacaoId === op.operacaoId).estado, "aplicando");
  const r2 = a.pedir("crm.aplicar", { operacoes: [op] }, tk).dados.resultados[0];
  v.verdade(r2.ok && r2.repetida, "recuperada e reconhecida: " + JSON.stringify(r2));
  const lead = a.linhas("crm_leads").find((l) => l.id === "l1");
  v.igual(lead.etapa, "conversando");
  v.igual(lead.rev, 2);
  v.igual(a.linhas("crm_contatos").length, 1);
  v.igual(a.linhas("sis_auditoria").filter((e) => e.campo === "Etapa do funil").length, 1);
  v.igual(a.linhas("sis_operacoes").find((o) => o.operacaoId === op.operacaoId).estado, "aplicada");
  v.verdade(!a.sim.props.FLORESER_OPS_PENDENTES);
});

teste("regras do funil conferidas no servidor", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  criarLead(a, tk, "l1");
  let r = alterarLead(a, tk, "l1", 1, { etapa: "agendado" }).dados.resultados[0];
  v.igual(r.erro.codigo, "dados_invalidos", "Agendado sem data do atendimento");
  r = alterarLead(a, tk, "l1", 1, { etapa: "agendado", dataAgendada: "2026-12-01", cadencia: "quente" }).dados.resultados[0];
  v.igual(r.entidade.cadencia, "", "etapa sem cadência não guarda cadência");
  v.verdade(!!r.entidade.dtAgendamento && !!r.entidade.dtConversa, "marcos carimbados");
  v.igual(r.entidade.dataAgendada, "2026-12-01", "dataAgendada ≠ dtAgendamento");
  r = alterarLead(a, tk, "l1", 2, { etapa: "falta", dtAgendamento: "", dataAgendada: "" }).dados.resultados[0];
  v.verdade(!!r.entidade.dtAgendamento && r.entidade.dataAgendada === "2026-12-01", "Falta não apaga o agendamento");
  v.igual(r.entidade.cadencia, "quente", "volta ao Comercial 1 na mais quente");
  r = alterarLead(a, tk, "l1", 3, { responsavel: "Comercial 2" }).dados.resultados[0];
  v.igual(r.erro.codigo, "dados_invalidos", "responsável nunca é gravado");
  const regras = a.gs;
  v.igual(regras.comercialDaEtapaCRM("fazer_orcamento"), 2);
  v.igual(regras.comercialDaEtapaCRM("em_aberto"), 1);
  v.igual(regras.ETAPAS_MIGRADAS.com_orcamento, "em_aberto", "com_orcamento nunca vira Fazer orçamento");
});

teste("contatos só crescem e o autor sai da sessão", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  criarLead(a, tk, "l1");
  const c = { id: "contato-unico-9", leadId: "l1", data: "2026-11-19", autorNome: "Falsa" };
  v.verdade(a.pedir("crm.aplicar", { operacoes: [a.op("contato.registrar", { dados: c })] }, tk).dados.resultados[0].ok);
  v.verdade(a.pedir("crm.aplicar", { operacoes: [a.op("contato.registrar", { dados: c })] }, tk).dados.resultados[0].ok);
  const lista = a.linhas("crm_contatos");
  v.igual(lista.length, 1);
  v.igual(lista[0].autorNome, "Bia Sintética");
  const ler = v.ok(a.pedir("crm.ler", {}, tk));
  v.igual(ler.contatos.length, 1);
});

/* ============================ Agenda ============================ */

function pacienteBase(id, extra) {
  return Object.assign({ nome: "Paciente " + id, ciclos: { facial: { freq: 14, ultimo: "2026-11-01", agendamento: { data: "2026-11-25", temFollowUp: true },
    proximos: ["2026-12-09", "2026-12-23"], aRemarcar: 0 } }, condicoes: [], maquinas: [],
    historico: [{ id: "hist-" + id + "-1", tipo: "agendou", area: "facial", data: "2026-11-25", em: "2026-11-10" }] }, extra || {});
}

teste("paciente: remarcar uma data da série mexe só naquela linha de agendamento", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  v.verdade(a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id: "p1", dados: pacienteBase("p1") })] }, tk).dados.resultados[0].ok);
  const antes = a.linhas("agenda_agendamentos");
  v.igual(antes.length, 3);
  const idDe = (d) => antes.find((x) => x.data === d).id;
  const r = a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.alterar", { id: "p1", revBase: 1,
    ciclos: { facial: { freq: 14, ultimo: "2026-11-01", agendamento: { data: "2026-11-25", temFollowUp: true }, proximos: ["2026-12-10", "2026-12-23"], aRemarcar: 0 } },
    historicoNovos: [{ id: "hist-p1-2", tipo: "reagendou", area: "facial", data: "2026-12-10", em: "2026-11-19" }] })] }, tk).dados.resultados[0];
  v.verdade(r.ok, JSON.stringify(r));
  const depois = a.linhas("agenda_agendamentos");
  v.igual(depois.find((x) => x.data === "2026-11-25").id, idDe("2026-11-25"), "a primeira manteve a identidade");
  v.igual(depois.find((x) => x.data === "2026-12-23").id, idDe("2026-12-23"));
  v.verdade(!depois.find((x) => x.data === "2026-12-09") && !!depois.find((x) => x.data === "2026-12-10"));
  v.igual(a.linhas("agenda_historico").length, 2);
  const lido = v.ok(a.pedir("agenda.ler", {}, tk)).pacientes[0];
  v.igual(lido.ciclos.facial.proximos, ["2026-12-10", "2026-12-23"]);
  v.igual(lido.ciclos.facial.agendamento, { data: "2026-11-25", temFollowUp: true });
  v.igual(lido._rev, 2);
});

teste("série: o próximo é sempre o mais cedo; intervalo fora de 1 a 365 é recusado", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  const dados = pacienteBase("p2", { ciclos: { facial: { freq: 7, agendamento: { data: "2026-12-20", temFollowUp: false }, proximos: ["2026-12-06", "2026-12-13"] } } });
  const r = a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id: "p2", dados })] }, tk).dados.resultados[0];
  v.igual(r.entidade.ciclos.facial.agendamento.data, "2026-12-06");
  v.igual(r.entidade.ciclos.facial.proximos, ["2026-12-13", "2026-12-20"]);
  v.igual(r.entidade.ciclos.facial.fimPrevisto, "2026-12-20");
  const ruim = pacienteBase("p3", { ciclos: { facial: { freq: 366 } } });
  v.igual(a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id: "p3", dados: ruim })] }, tk).dados.resultados[0].erro.codigo, "dados_invalidos");
  const personalizado = pacienteBase("p4", { ciclos: { facial: { freq: 15 } } });
  v.verdade(a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id: "p4", dados: personalizado })] }, tk).dados.resultados[0].ok, "15 é um intervalo personalizado válido");
});

teste("Agenda → CRM: remarcar acompanha a lead em Agendado; sessão pela passagem do dia não confirma nada", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  criarLead(a, tk, "l9", { etapa: "agendado", dataAgendada: "2026-11-25", cadencia: "" });
  a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id: "p9", dados: pacienteBase("p9", { crmLeadId: "l9" }) })] }, tk);
  let r = a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.alterar", { id: "p9", revBase: 1,
    ciclos: { facial: { freq: 14, ultimo: "2026-11-01", agendamento: { data: "2026-11-27", temFollowUp: false }, proximos: ["2026-12-09", "2026-12-23"] } },
    historicoNovos: [{ id: "hist-p9-re", tipo: "reagendou", area: "facial", data: "2026-11-27", em: "2026-11-19" }] })] }, tk).dados.resultados[0];
  v.verdade(r.ok && r.crm && r.crm.leadId === "l9", "eco no resultado");
  let lead = a.linhas("crm_leads").find((l) => l.id === "l9");
  v.igual(lead.dataAgendada, "2026-11-27");
  const op = a.linhas("sis_auditoria").filter((e) => e.entidadeId === "l9" && e.campo === "Data do atendimento");
  v.igual(op.length, 1);
  v.verdade(op[0].contexto.indexOf("Agenda → CRM") >= 0);
  /* maturar: o dia passou, virou sessão; a próxima da série assume */
  r = a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.alterar", { id: "p9", revBase: 2,
    ciclos: { facial: { freq: 14, ultimo: "2026-11-27", agendamento: { data: "2026-12-09", temFollowUp: false }, proximos: ["2026-12-23"] } },
    historicoNovos: [{ id: "hist-p9-se", tipo: "sessao", area: "facial", data: "2026-11-27", em: "2026-11-28" }] })] }, tk).dados.resultados[0];
  v.verdade(r.ok && !r.crm, "nenhum eco");
  lead = a.linhas("crm_leads").find((l) => l.id === "l9");
  v.igual(lead.dataAgendada, "2026-11-27");
  v.igual(lead.etapa, "agendado", "nem comparecimento nem Fazer orçamento");
  v.verdade(!lead.dtComparecimento);
});

teste("CRM → Agenda: vínculo só explícito; parecida por nome pede decisão; exige as duas permissões", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  criarLead(a, tk, "l5", { nome: "Maria Teste", whatsapp: "65 98888-7777" });
  a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id: "p5", dados: pacienteBase("p5", { nome: "Maria Teste" }) })] }, tk);
  let d = v.ok(a.pedir("crm.agendarNaAgenda", { operacaoId: "agendar-op-0001", leadId: "l5", area: "facial", data: "2026-12-02", freq: 21 }, tk));
  v.verdade(d.precisaDecidir && d.parecidas[0].id === "p5", "parecida por nome não é vinculada sozinha");
  v.igual(a.linhas("agenda_pacientes").find((p) => p.id === "p5").crmLeadId, "");
  d = v.ok(a.pedir("crm.agendarNaAgenda", { operacaoId: "agendar-op-0002", leadId: "l5", area: "facial", data: "2026-12-02", freq: 21, confirmarPacienteId: "p5" }, tk));
  v.verdade(d.vinculado && d.agendou);
  v.igual(a.linhas("agenda_pacientes").find((p) => p.id === "p5").crmLeadId, "l5");
  const lead = a.linhas("crm_leads").find((l) => l.id === "l5");
  v.igual(lead.etapa, "agendado");
  v.igual(lead.dataAgendada, "2026-12-02");
  const caio = a.entrar("caio", "segredo-caio");
  v.erro(a.pedir("crm.agendarNaAgenda", { operacaoId: "agendar-op-0003", leadId: "l5", data: "2026-12-03" }, caio), "sem_acesso");
  const ops = a.linhas("sis_auditoria").filter((e) => e.operacaoId === "agendar-op-0002");
  v.verdade(ops.some((e) => e.modulo === "crm") && ops.some((e) => e.modulo === "agenda"), "os dois lados com o mesmo operacaoId");
});

/* ============================ Entradas ============================ */

teste("dinheiro exato: centavos na lógica, '350.00' na planilha, sem ponto flutuante", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  const pags = [{ metodo: "pix", valor: 29, parcelas: 1 }, { metodo: "credito", valor: 123456789, parcelas: 3 }];
  const r = a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.criar", { id: "e1", dados: { nome: "Cliente", data: "2026-11-19", descricao: "Limpeza", pagamentos: pags } })] }, tk).dados.resultados[0];
  v.verdade(r.ok, JSON.stringify(r));
  const brutos = a.sim.planilha.getSheetByName("ent_pagamentos").getRange(2, 1, 2, 6).getValues().map((l) => l[4]);
  v.igual(brutos, ["0.29", "1234567.89"]);
  const lido = v.ok(a.pedir("entradas.ler", {}, tk));
  v.igual(lido.entradas[0].pagamentos.map((p) => p.valor), [29, 123456789]);
  v.igual(lido.podeAdministrar, false);
  v.igual(a.gs.textoParaCentavos("1.234,56"), 123456);
  v.igual(a.gs.textoParaCentavos("0.1"), 10);
  v.igual(a.gs.centavosParaTexto(5), "0.05");
});

teste("quem não administra não exclui entrada (recusa no servidor + log de segurança); admin exclui e o painel restaura", () => {
  const a = ambienteComContas();
  const bia = a.entrar("bia", "segredo-bia"), ana = a.entrar("ana", "segredo-ana");
  a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.criar", { id: "e2", dados: { nome: "Cliente", data: "2026-11-19", pagamentos: [{ metodo: "dinheiro", valor: 5000, parcelas: 1 }] } })] }, bia);
  const r = a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.remover", { id: "e2" })] }, bia).dados.resultados[0];
  v.igual(r.erro.codigo, "sem_permissao");
  v.verdade(a.linhas("sis_logs").some((l) => l.evento === "EXCLUSAO_NEGADA"));
  v.erro(a.pedir("lixeira.mover", { tipo: "entradas", id: "e2", operacaoId: "lixo-op-0001" }, bia), "sem_permissao");
  v.igual(v.ok(a.pedir("entradas.ler", {}, ana)).podeAdministrar, true);
  v.verdade(a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.remover", { id: "e2", motivo: "teste" })] }, ana).dados.resultados[0].ok);
  v.igual(a.linhas("ent_entradas").length, 0);
  v.igual(a.linhas("ent_pagamentos").length, 0);
  const painel = v.ok(a.pedir("sessao.entrarModulo", { modulo: "dev", senha: "senha-painel-teste" })).token;
  const item = v.ok(a.pedir("painel.lixeira.listar", {}, painel)).itens[0];
  v.ok(a.pedir("painel.lixeira.restaurar", { id: item.id }, painel));
  const volta = v.ok(a.pedir("entradas.ler", {}, ana)).entradas[0];
  v.igual(volta.pagamentos, [{ metodo: "dinheiro", valor: 5000, parcelas: 1 }]);
  v.igual(volta._rev, 2);
});

/* ============================ Lixeira ============================ */

teste("paciente na lixeira leva os filhos; exclusão definitiva apaga a auditoria dela", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  a.pedir("agenda.aplicar", { operacoes: [a.op("paciente.criar", { id: "p7", dados: pacienteBase("p7", { condicoes: [{ id: "c1", texto: "Gestante", inicio: "2026-11-01", fim: "2027-06-01" }] }) })] }, tk);
  v.ok(a.pedir("lixeira.mover", { tipo: "agenda", id: "p7", motivo: "duplicada", operacaoId: "lixo-op-p7" }, tk));
  v.igual(a.linhas("agenda_agendamentos").length, 0);
  v.igual(a.linhas("agenda_condicoes").length, 0);
  v.ok(a.pedir("lixeira.mover", { tipo: "agenda", id: "p7", motivo: "duplicada", operacaoId: "lixo-op-p7" }, tk), "repetir é seguro");
  const painel = v.ok(a.pedir("sessao.entrarModulo", { modulo: "dev", senha: "senha-painel-teste" })).token;
  const item = v.ok(a.pedir("painel.lixeira.listar", {}, painel)).itens[0];
  v.ok(a.pedir("painel.lixeira.restaurar", { id: item.id }, painel));
  v.igual(a.linhas("agenda_agendamentos").length, 3);
  v.ok(a.pedir("lixeira.mover", { tipo: "agenda", id: "p7", operacaoId: "lixo-op-p7b" }, tk));
  const item2 = v.ok(a.pedir("painel.lixeira.listar", {}, painel)).itens[0];
  v.erro(a.pedir("painel.lixeira.excluir", { id: item2.id }, painel), "sem_confirmacao");
  v.ok(a.pedir("painel.lixeira.excluir", { id: item2.id, confirmar: true }, painel));
  v.igual(a.linhas("sis_auditoria").filter((e) => e.entidadeId === "p7").length, 0);
});

/* ============================ Contrato e versão ============================ */

teste("site antigo (sem v) recebe recado no formato antigo e não consegue gravar", () => {
  const a = ambienteComContas();
  const { pedir } = require("./simulador/carregar");
  const r = pedir(a.gs, { acao: "salvar_agenda", token: "x", rev: 1, dados: { pacientes: [] } });
  v.igual(r.ok, false);
  v.igual(r.erro, "versao_cliente");
  v.igual(pedir(a.gs, { acao: "registrar", app: "floreser", logs: [] }).ok, true, "o registro técnico continua aceito");
});

teste("versão errada da API, manutenção e schema inativo têm respostas próprias", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  v.erro(a.pedir("crm.ler", {}, tk, { v: 1 }), "versao_cliente");
  a.sim.props.FLORESER_MANUTENCAO = "sim";
  v.erro(a.pedir("crm.ler", {}, tk), "manutencao");
  const ver = v.ok(a.pedir("sistema.versao", {}));
  v.igual(ver.manutencao, true);
  v.igual(ver.api, 2);
  delete a.sim.props.FLORESER_MANUTENCAO;
  a.sim.props.FLORESER_SCHEMA_ATIVO = "1";
  v.erro(a.pedir("crm.ler", {}, tk), "manutencao");
});

teste("toda resposta diz versão do servidor, API e schema; nenhuma traz token ou hash fora do login", () => {
  const a = ambienteComContas();
  const tk = a.entrar("bia", "segredo-bia");
  const r = a.pedir("crm.ler", {}, tk);
  v.igual(r.servidor.api, 2);
  v.igual(r.servidor.schema, 3);
  const texto = JSON.stringify(r);
  v.falso(texto.indexOf(tk) >= 0, "o token não volta");
  v.falso(/senhaHash|"salt"/.test(texto));
});

module.exports = () => executar("Backend");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
