/* Migração schema 1 (3.5.0) → schema 2, numa planilha legada SINTÉTICA
   que imita as particularidades encontradas no export real. */
"use strict";

const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");
const { pedir } = require("./simulador/carregar");

/* escreve uma aba como a 3.5.0: cabeçalho e linhas; '@' em tudo, exceto
   quando "converter" — aí o simulador faz o que o Sheets faz */
function aba(sim, nome, cabecalho, linhas, opcoes) {
  const o = opcoes || {};
  const s = sim.planilha.insertSheet(nome);
  const largura = Math.max(cabecalho.length, ...linhas.map((l) => l.length), 1);
  const cab = cabecalho.concat(Array(largura - cabecalho.length).fill(""));
  s.getRange(1, 1, 1, largura).setValues([cab]);
  if (!linhas.length) return s;
  const corpo = linhas.map((l) => l.concat(Array(largura - l.length).fill("")).map(String));
  const faixa = s.getRange(2, 1, corpo.length, largura);
  if (!o.converter) faixa.setNumberFormat("@");
  faixa.setValues(corpo);
  return s;
}

function planilhaLegada(a, opcoes) {
  const o = opcoes || {};
  const s = a.sim;
  const g = a.gs;
  /* conta antiga: hash v1 com a mesma pimenta das propriedades */
  g.reiniciarExecucao();
  const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const hash = g.derivarSenhaV1("senha-da-conta-antiga", salt);
  aba(s, "Usuarios", ["id", "nome", "usuario", "senhaHash", "salt", "ativo", "admin", "crm", "agenda", "entradas", "criadoEm", "criadoPor", "ultimoLogin", "alteradoEm"],
    [["u1aa", "Pessoa Um", "pessoa1", hash, salt, "sim", "não", "sim", "sim", "sim", "2026-08-20T09:00:00", "painel", "2026-11-18T08:00:00", "2026-08-20T09:00:00"]]);
  const agora = Date.now();
  const tokenAntigo = "11111111-2222-3333-4444-555555555555.66666666-7777-8888-9999-000000000000";
  aba(s, "Usuarios_Sessoes", ["tokenHash", "usuarioId", "criadoEm", "ultimoUso", "expiraEm", "revogado"], [
    [g.sha256Hex(tokenAntigo), "u1aa", agora - 5 * 86400000, agora - 86400000, agora + 29 * 86400000, "não"],
    [g.sha256Hex("vencido"), "u1aa", agora - 90 * 86400000, agora - 60 * 86400000, agora - 30 * 86400000, "não"]]);
  aba(s, "Usuarios_Fotos", ["usuarioId", "foto", "atualizadoEm"], [["u1aa", "data:image/png;base64,AAAA", "2026-08-21T10:00:00"]]);
  aba(s, "Cadencias", ["id", "nome", "dias"], [["quente", "Quente", "3"], ["morno", "Morno", "5"], ["frio", "Frio", "15"], ["muito_frio", "Muito frio", "30"]]);
  aba(s, "Leads", ["id", "nome", "whatsapp", "interesse", "observacoes", "etapa", "cadencia", "exCliente", "ultimoContato", "criadoEm", "dtConversa", "dtAgendamento", "dtComparecimento", "dtVenda", "dtReprovado", "origem", "dataAgendada"], [
    ["l1", "Lead Um", "65 9999-0001", "Facial", "", "agendado", "", "não", "2026-11-10", "2026-11-01", "2026-11-02", "2026-11-10", "", "", "", "instagram", "2026-11-25"],
    ["l2", "Lead Dois", "", "", "", "com_orcamento", "morno", "sim", "2026-11-05", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-10", "", "", "", ""]]);
  aba(s, "Leads_Contatos", ["id", "leadId", "data", "criadoEm", "autorTipo", "autorId", "autorNome"], [
    ["c_20261110_abcdef12", "l1", "2026-11-10", "2026-11-10T09:30:00-04:00", "usuario", "u1aa", "Pessoa Um"],
    ["c_20261001_zzzzzz99", "lead-excluida", "2026-10-01", "2026-10-01T10:00:00-04:00", "usuario", "u1aa", "Pessoa Um"]]);
  /* Pacientes como na planilha real: colunas 6–10 sem nome e uma 11ª residual */
  aba(s, "Pacientes", ["id", "nome", "categoriaId", "obs", "criadoEm"], [
    ["p1", "Paciente Um", "cat1", "", "2026-09-01", "não", "", "65 98888-0001", "instagram", "l1", "2026-03-15"],
    ["p2", "Paciente Dois", "", "obs", "2026-09-02", "sim", "2026-10-01", "", "", "", "2026-03-16"],
    ["p3", "Paciente Três", "cat1", "", "2026-09-03", "não", "", "", "", ""]]);
  aba(s, "Pacientes_Ciclos", ["pacienteId", "area", "freq", "ultimo", "agendamentoData", "agendamentoFollowUp", "adiadaPara", "naoRespondeu", "proximos", "fimPrevisto", "aRemarcar"], [
    ["p1", "facial", "14", "2026-11-11", "2026-11-25", "sim", "", "0", "2026-12-09, 2026-12-23", "2026-12-23", "1"],
    ["p2", "corporal", "21", "2026-09-10", "", "", "", "2", "", "", "0"],
    ["p3", "capilar", "30", "", "2026-12-01", "não", "", "0", "", "", "0"]]);
  aba(s, "Pacientes_Categorias", ["id", "nome", "cor"], [["cat1", "VIP", "#3B6E6A"]]);
  aba(s, "Pacientes_Condicoes", ["id", "pacienteId", "texto", "inicio", "fim"], [["cd1", "p1", "Gestante", "2026-09-01", "2027-05-01"]]);
  aba(s, "Pacientes_Maquinas", ["pacienteId", "maquinaId"], [["p1", "m1"], ["p1", "m1"]]);
  aba(s, "Pacientes_FollowUps", ["id", "pacienteId", "area", "data", "feito", "agendamentoData", "criadoEm", "feitoEm"], [["f1", "p1", "facial", "2026-11-24", "não", "2026-11-25", "2026-11-20", ""]]);
  aba(s, "Pacientes_Historico", ["pacienteId", "tipo", "area", "data", "em", "fu", "maquina"], [
    ["p1", "agendou", "facial", "2026-11-25", "2026-11-11", "", ""], ["p1", "agendou", "facial", "2026-11-25", "2026-11-11", "", ""],
    ["p2", "sessao", "2026-09-10", "2026-09-10", "2026-09-10", "", ""]]);
  aba(s, "Maquinas", ["id", "nome", "cadencia", "cor", "obs"], [["m1", "Soprano", "Mensal", "#3B6E6A", ""]]);
  aba(s, "Maquinas_Vindas", ["id", "maquinaId", "data", "obs", "criadoEm"], [["v1", "m1", "2026-11-30", "", "2026-11-01"]]);
  aba(s, "Maquinas_Respostas", ["vindaId", "pacienteId", "status", "em", "adiadaPara", "vezes"], [["v1", "p1", "confirmou", "2026-11-02", "", ""]]);
  aba(s, "Entradas", ["id", "nome", "data", "descricao", "obs", "criadoEm"], [
    ["e1", "Cliente Um", "2026-11-18", "Limpeza", "", "2026-11-18T13:00:00.000Z"], ["e2", "Cliente Dois", "2026-11-19", "Peeling", "", "2026-11-19T14:00:00.000Z"]]);
  aba(s, "Entradas_Pagamentos", ["entradaId", "metodo", "valor", "parcelas"], [
    ["e1", "pix", "350.00", "1"], ["e1", "credito", "0.29", "3"], ["e2", "dinheiro", "1234.50", "1"]].concat(o.orfao ? [["e9", "pix", "10.00", "1"]] : []));
  aba(s, "Lixeira", ["id", "tipo", "registroId", "titulo", "descricao", "dados", "excluidoEm", "excluidoPor", "excluidoPorId", "motivo"], [
    ["lx1", "entradas", "e7", "Cliente Sete", "Entrada · 2026-10-01 · R$ 80.00",
      JSON.stringify({ entrada: { id: "e7", nome: "Cliente Sete", data: "2026-10-01", descricao: "", obs: "", criadoEm: "2026-10-01T10:00:00.000Z" }, pagamentos: [{ entradaId: "e7", metodo: "pix", valor: "80.00", parcelas: "1" }] }),
      String(agora - 3 * 86400000), "Pessoa Um", "u1aa", "duplicada"]]);
  /* Auditoria SEM '@': o Sheets converte a data e o instante, como na planilha real */
  aba(s, "Auditoria", ["id", "operacaoId", "em", "modulo", "entidade", "entidadeId", "acao", "campo", "antes", "depois", "autorTipo", "autorId", "autorNome", "contexto"], [
    ["au1", "op1", "2026-08-31T08:29:29", "crm", "lead", "l1", "alterou", "Último contato", "01/05/2026", "10/11/2026", "usuario", "u1aa", "Pessoa Um", ""],
    ["au2", "op2", "2026-09-01T10:00:00", "entradas", "entrada", "e1", "alterou", "Valor", "R$ 300,00", "R$ 350,00", "usuario", "u1aa", "Pessoa Um", ""]], { converter: true });
  aba(s, "Logs", ["id", "quando", "nivel", "evento", "pagina", "mensagem", "versao", "sessao"], [["lg1", "2026-11-01T10:00:00", "INFO", "INDEX_ABERTO", "index.html", "Portal aberto", "v3.5.0", "S1"]]);
  aba(s, "Sessoes", ["id", "primeiroAcesso", "ultimoAcesso", "paginas", "entrada", "atual", "referrer", "versao", "navegador", "plataforma", "idioma", "idiomas", "cookies", "tela", "viewport", "dpr", "toque", "tipo", "fuso", "conexao", "memoria", "nucleos", "dnt"], [["S1", "x", "y"]]);
  s.props.agenda_criado = "2026-08-01";
  s.props.agenda_seedmaq = "sim";
  return { tokenAntigo };
}

function ambienteLegado(opcoes) {
  const a = novoAmbiente({ semAbas: true, fuso: "America/Sao_Paulo" });
  a.sim.props.FLORESER_FUSO = "America/Cuiaba";
  const extra = planilhaLegada(a, opcoes);
  a.gs.reiniciarExecucao();
  return Object.assign(a, extra);
}

teste("diagnóstico não escreve nada e não acusa erro numa planilha íntegra", () => {
  const a = ambienteLegado();
  const abas = a.sim.planilha.getSheets().length;
  const r = a.gs.migracaoDiagnosticar();
  v.igual(r.erros, []);
  v.igual(a.sim.planilha.getSheets().length, abas, "nenhuma aba criada");
  v.verdade(r.avisos.some((x) => /Pacientes/.test(x) && /posição/.test(x)), "o cabeçalho incompleto é apontado");
  v.igual(r.contagens.agenda_pacientes, 3);
  v.igual(r.contagens.ent_pagamentos, 3);
  v.igual(r.somas.pagamentosV1, 35000 + 29 + 123450);
  v.igual(r.crmLeadIds, 1);
  v.verdade(r.anomalias.pacientes_coluna_sem_nome.quantas === 2);
});

teste("órfão em relação forte bloqueia a migração", () => {
  const a = ambienteLegado({ orfao: true });
  const r = a.gs.migracaoDiagnosticar();
  v.verdade(r.erros.some((e) => /ent_pagamentos\.entradaId/.test(e)));
  let lancou = false;
  try { a.gs.migracaoEnsaiar(); } catch (e) { lancou = /bloqueada/.test(e.message); }
  v.verdade(lancou);
});

teste("migração para valer exige manutenção e backup", () => {
  const a = ambienteLegado();
  let msg = "";
  try { a.gs.migracaoExecutar(); } catch (e) { msg = e.message; }
  v.verdade(/MANUTENCAO/.test(msg));
  a.sim.props.FLORESER_MANUTENCAO = "sim";
  try { a.gs.migracaoExecutar(); } catch (e) { msg = e.message; }
  v.verdade(/migracaoBackup/.test(msg));
  const b = a.gs.migracaoBackup();
  v.verdade(!!a.sim.planilhas[b.id], "cópia privada criada");
  const props = a.sim.planilhas[b.id].getSheetByName("_propriedades").getRange(1, 1, 30, 2).getValues();
  v.verdade(props.some((l) => l[0] === "FLORESER_PIMENTA" && /não copiado/.test(l[1])), "segredo não vai para o backup");
  const r = a.gs.migracaoExecutar();
  v.verdade(r.conferencia.ok, JSON.stringify(r.conferencia.problemas));
});

teste("ensaio constrói o schema 2 fiel ao legado: colunas sem nome, série, dinheiro, auditoria e instantes", () => {
  const a = ambienteLegado();
  const r = a.gs.migracaoEnsaiar();
  v.verdade(r.conferencia.ok, JSON.stringify(r.conferencia.problemas));
  const pacs = a.linhas("agenda_pacientes");
  const p1 = pacs.find((p) => p.id === "p1"), p2 = pacs.find((p) => p.id === "p2");
  v.igual([p1.arquivada, p1.whatsapp, p1.origem, p1.crmLeadId], [false, "65 98888-0001", "instagram", "l1"]);
  v.igual([p2.arquivada, p2.arquivadaEm], [true, "2026-10-01"]);
  v.igual(p1.legado.colunasExtras, { coluna11: "2026-03-15" }, "a 11ª coluna é preservada, sem interpretação");
  v.igual(pacs.find((p) => p.id === "p3").crmLeadId, "", "nenhum vínculo inventado");
  const ags = a.linhas("agenda_agendamentos").filter((x) => x.pacienteId === "p1").map((x) => [x.data, x.followUp]);
  v.igual(ags, [["2026-11-25", true], ["2026-12-09", false], ["2026-12-23", false]]);
  v.igual(a.linhas("agenda_pac_maquinas").length, 1, "par repetido entra uma vez");
  v.igual(a.linhas("agenda_historico").length, 3, "histórico idêntico em duas linhas continua sendo dois eventos");
  v.igual(a.linhas("ent_pagamentos").map((p) => p.valor), [35000, 29, 123450]);
  const au = a.linhas("sis_auditoria");
  v.igual(au[0].antes, "01/05/2026", "a data que o Sheets converteu volta ao texto gravado");
  v.igual(au[0].em, "2026-08-31T12:29:29.000Z", "hora local de Cuiabá (-04:00) vira o instante certo");
  v.igual(au[1].antes, "R$ 300,00");
  v.igual(a.linhas("crm_contatos")[0].criadoEm, "2026-11-10T13:30:00.000Z");
  const leads = a.linhas("crm_leads");
  v.igual(leads.find((l) => l.id === "l2").etapa, "em_aberto", "com_orcamento → Em aberto, nunca Fazer orçamento");
  v.igual(leads.find((l) => l.id === "l1").dataAgendada, "2026-11-25");
  v.igual(a.linhas("sis_sessoes").length, 1, "só a sessão viva passa");
  const lx = a.linhas("sis_lixeira")[0];
  v.igual(lx.dados.versao, 2);
  v.igual(lx.dados.filhos.ent_pagamentos[0].valor, 8000);
  v.igual(a.linhas("sis_config").find((c) => c.chave === "crm.cadencias").valor.quente, 3);
  v.igual(a.linhas("sis_config").find((c) => c.chave === "agenda.config").valor, { criado: "2026-08-01", seedMaq: true });
});

teste("rodar de novo é seguro: as abas iguais são puladas e o resultado é o mesmo", () => {
  const a = ambienteLegado();
  a.gs.migracaoEnsaiar();
  const antes = JSON.stringify(a.linhas("agenda_agendamentos"));
  const r = a.gs.migracaoEnsaiar();
  v.verdade(r.puladas.length > 15, "puladas: " + r.puladas.length);
  v.igual(JSON.stringify(a.linhas("agenda_agendamentos")), antes);
});

teste("depois de ativar: a conta antiga entra com a senha antiga, e a sessão aberta na 3.5.0 continua valendo", () => {
  const a = ambienteLegado();
  a.gs.migracaoEnsaiar();
  a.gs.migracaoAtivar();
  a.gs.migracaoV3Ensaiar();
  a.gs.migracaoV3Ativar();
  a.gs.migracaoV4Ensaiar();
  a.gs.migracaoV4Ativar();
  a.gs.migracaoV5Ensaiar();
  a.gs.migracaoV5Ativar();
  const r = a.pedir("crm.ler", {}, a.tokenAntigo);
  const d = v.ok(r, "token da 3.5.0 aceito");
  v.igual(d.leads.length, 2);
  const tk = a.entrar("pessoa1", "senha-da-conta-antiga");
  v.verdade(!!tk);
  v.igual(a.linhas("sis_usuarios")[0].esquema, "pbkdf2");
  v.verdade(!("FLORESER_SENHA_CRM" in a.sim.props), "senhas de módulo viraram hash na ativação");
  const ag = v.ok(a.pedir("agenda.ler", {}, tk));
  const p1 = ag.pacientes.find((p) => p.id === "p1");
  v.igual(p1.ciclos.facial.proximos, ["2026-12-09", "2026-12-23"]);
  v.igual(p1.ciclos.facial.aRemarcar, 1);
  const ent = v.ok(a.pedir("entradas.ler", {}, tk));
  v.igual(ent.entradas.map((e) => e.pagamentos.reduce((s, p) => s + p.valor, 0)), [35029, 123450]);
});

teste("retorno: exportar para a 3.5.0 reescreve as abas antigas (com o cabeçalho certo) a partir do schema 2", () => {
  const a = ambienteLegado();
  a.gs.migracaoEnsaiar();
  a.gs.migracaoAtivar();
  a.gs.migracaoV3Ensaiar();
  a.gs.migracaoV3Ativar();
  a.gs.migracaoV4Ensaiar();
  a.gs.migracaoV4Ativar();
  a.gs.migracaoV5Ensaiar();
  a.gs.migracaoV5Ativar();
  const tk = a.entrar("pessoa1", "senha-da-conta-antiga");
  a.pedir("entradas.aplicar", { operacoes: [a.op("entrada.criar", { id: "e3", dados: { nome: "Depois", data: "2026-11-20", pagamentos: [{ metodo: "pix", valor: 1000, parcelas: 1 }] } })] }, tk);
  a.sim.props.FLORESER_MANUTENCAO = "sim";
  a.gs.reiniciarExecucao();
  a.gs.migracaoExportarParaV1();
  const pac = a.sim.planilha.getSheetByName("Pacientes").getRange(1, 1, 2, 10).getDisplayValues();
  v.igual(pac[0][9], "crmLeadId", "cabeçalho completo de novo");
  const pags = a.sim.planilha.getSheetByName("Entradas_Pagamentos").getDisplayValues ? null : null;
  void pags;
  const linhasPag = a.sim.planilha.getSheetByName("Entradas_Pagamentos").getRange(2, 1, 4, 4).getDisplayValues();
  v.verdade(linhasPag.some((l) => l[0] === "e3" && l[2] === "10.00"), "a gravação feita no schema 2 volta junto");
  const u = a.sim.planilha.getSheetByName("Usuarios").getRange(2, 1, 1, 5).getDisplayValues()[0];
  a.gs.reiniciarExecucao();
  v.igual(u[3], a.gs.derivarSenhaV1("senha-da-conta-antiga", u[4]), "o verificador antigo volta para a 3.5.0");
  v.igual(a.sim.props.FLORESER_SCHEMA_ATIVO, "1");
});


/* ======================= schema 2 → schema 3 ======================= */

function ambienteV2() {
  const a = ambienteLegado();
  a.gs.migracaoEnsaiar();
  a.gs.migracaoAtivar();
  a.gs.reiniciarExecucao();
  return a;
}

teste("v2 → v3: diagnóstico não escreve, valida relações e soma o dinheiro", () => {
  const a = ambienteV2();
  const abasAntes = a.sim.planilha.getSheets().map((s) => s.getName()).join(",");
  a.sim.zerarContadores();
  const r = a.gs.migracaoV3Diagnosticar();
  v.igual(r.erros, [], "pronta");
  v.igual(a.sim.contadores.escrever || 0, 0, "nada escrito");
  v.igual(a.sim.planilha.getSheets().map((s) => s.getName()).join(","), abasAntes);
  v.verdade(r.plano.abasNovas.indexOf("fin_despesas") >= 0 && r.plano.abasNovas.indexOf("int_vinculos") >= 0);
  v.igual(r.dinheiro.ent_pagamentos, 35029 + 123450);
});

teste("v2 → v3: exige manutenção e backup; a 3.5.0 nunca roda de novo", () => {
  const a = ambienteV2();
  let erro = "";
  try { a.gs.migracaoV3Executar(); } catch (e) { erro = e.message; }
  v.verdade(/manutenção/.test(erro), erro);
  a.sim.props.FLORESER_MANUTENCAO = "sim";
  a.gs.reiniciarExecucao();
  try { a.gs.migracaoV3Executar(); } catch (e) { erro = e.message; }
  v.verdade(/Backup/i.test(erro), erro);
  try { a.gs.migracaoExecutar(); } catch (e) { erro = e.message; }
  v.verdade(/já está ativo/.test(erro), "a migração da 3.5.0 se recusa com o schema 2 ativo: " + erro);
});

teste("v2 → v3: preserva dados, dinheiro e sessões; quem estava conectado continua", () => {
  const a = ambienteV2();
  const tk = a.tokenAntigo;
  const leadsAntes = JSON.stringify(a.linhas("crm_leads").map((l) => [l.id, l.nome, l.etapa]));
  a.sim.props.FLORESER_MANUTENCAO = "sim";
  a.gs.reiniciarExecucao();
  a.gs.migracaoV3Backup();
  const rel = a.gs.migracaoV3Executar();
  v.verdade(rel.ok, "conferência OK: " + JSON.stringify(rel));
  a.gs.migracaoV3Ativar();
  a.gs.migracaoV4Backup();
  a.gs.migracaoV4Executar();
  a.gs.migracaoV4Ativar();
  a.gs.migracaoV5Backup();
  a.gs.migracaoV5Executar();
  a.gs.migracaoV5Ativar();
  delete a.sim.props.FLORESER_MANUTENCAO;
  a.gs.reiniciarExecucao();
  const ent = v.ok(a.pedir("entradas.ler", {}, tk), "a sessão aberta no schema 2 continua valendo");
  v.igual(ent.entradas.reduce((s, e) => s + e.pagamentos.reduce((t, p) => t + p.valor, 0), 0), 35029 + 123450);
  v.igual(JSON.stringify(a.linhas("crm_leads").map((l) => [l.id, l.nome, l.etapa])), leadsAntes);
  v.erro(a.pedir("financeiro.ler", {}, tk), "sem_acesso", "conta sem a permissão nova não entra no Financeiro");
  /* rodar de novo não faz nada: o schema 4 já está ativo */
  let erro = "";
  try { a.gs.migracaoV3Executar(); } catch (e) { erro = e.message; }
  v.verdade(/parte do schema 2/.test(erro), erro);
});

teste("v2 → v3: retorno volta a dizer schema 2 sem apagar nada", () => {
  const a = ambienteV2();
  a.gs.migracaoV3Ensaiar();
  a.gs.migracaoV3Ativar();
  a.gs.reiniciarExecucao();
  a.gs.migracaoV3Retornar();
  v.igual(a.sim.props.FLORESER_SCHEMA_ATIVO, "2");
  v.verdade(!!a.sim.planilha.getSheetByName("fin_despesas"), "as abas novas ficam");
});

/* ======================= schema 3 → schema 4 ======================= */

function ambienteV3ComIntegracao() {
  const a = ambienteV2();
  a.gs.migracaoV3Ensaiar();
  a.gs.migracaoV3Ativar();
  a.gs.reiniciarExecucao();
  /* um passado de 4.1.0: registros e vínculos com a chave antiga */
  a.gs.inserir("int_externos", [
    { id: "clinicorp:recebimento:1", sistema: "clinicorp", assinante: "ass", unidade: "", tipo: "recebimento", externoId: "1", dados: { valor: 1000, recebido: true },
      assinatura: "s1", alteradoExterno: "", vistoEm: null, ausenteDesde: null, complemento: { notas: "conferido" }, execucaoId: "", rev: 1, opId: "", atualizadoEm: null, atualizadoPor: "" },
    { id: "clinicorp:recebimento:2", sistema: "clinicorp", assinante: "ass", unidade: "", tipo: "recebimento", externoId: "2", dados: { valor: 2000, recebido: true },
      assinatura: "s2", alteradoExterno: "", vistoEm: null, ausenteDesde: null, complemento: null, execucaoId: "", rev: 1, opId: "", atualizadoEm: null, atualizadoPor: "" },
    { id: "clinicorp:orcamento:7", sistema: "clinicorp", assinante: "ass", unidade: "", tipo: "orcamento", externoId: "7", dados: { status: "OPEN" },
      assinatura: "s3", alteradoExterno: "", vistoEm: null, ausenteDesde: null, complemento: null, execucaoId: "", rev: 1, opId: "", atualizadoEm: null, atualizadoPor: "" }]);
  a.gs.inserir("int_vinculos", [{ id: "clinicorp:recebimento:1:entrada", sistema: "clinicorp", assinante: "ass", unidade: "", tipo: "recebimento", externoId: "1",
    localTipo: "entrada", localId: "e1", estado: "ativo", assinatura: "s1", sincronizadoEm: null, criadoEm: null, criadoPor: "", rev: 1, opId: "", atualizadoEm: null, atualizadoPor: "" }]);
  a.gs.reiniciarExecucao();
  return a;
}

teste("v3 → v4 → v5: chaves ganham o assinante, a reconciliação evita recriar, e o estoque ganha o modo de saldo sem mudar saldo", () => {
  const a = ambienteV3ComIntegracao();
  const d = a.gs.migracaoV4Diagnosticar();
  v.igual(d.erros, []);
  v.igual(d.reconciliacao.recebimentosComoConsulta, 1);
  const rel = a.gs.migracaoV4Ensaiar();
  v.verdade(rel.ok, JSON.stringify(rel));
  a.gs.migracaoV4Ativar();
  const ext = a.linhas("int_externos");
  v.igual(ext.map((x) => x.id).sort(), ["clinicorp:ass:orcamento:7", "clinicorp:ass:recebimento:1", "clinicorp:ass:recebimento:2"]);
  v.igual(ext.find((x) => x.externoId === "1").complemento.notas, "conferido", "complemento local preservado");
  v.verdade(ext.every((x) => x.aplicado === x.assinatura), "tudo o que já existia conta como aplicado");
  v.verdade(ext.find((x) => x.externoId === "2").aplicacao.estado.anterior, "recebimento sem vínculo fica como consulta");
  v.igual(ext.find((x) => x.externoId === "7").aplicacao.estado.status, "OPEN", "orçamento guarda o status atual");
  v.igual(a.linhas("int_vinculos")[0].id, "clinicorp:ass:recebimento:1:entrada");
  v.verdade(!!a.sim.planilha.getSheetByName("est_itens"), "abas do estoque criadas");
  a.gs.reiniciarExecucao();
  /* v4 → v5: estoque ganha o modo de saldo sem mudar saldo nenhum */
  a.gs.inserir("est_itens", [
    { id: "loc1", nome: "Local", codigo: "", origem: "local", unidadeConsumo: "un", ativo: true, rev: 1 },
    { id: "imp1", nome: "Importado", codigo: "X", origem: "importacao", unidadeConsumo: "un", ativo: true, rev: 1 }]);
  a.gs.inserir("est_saldos", [
    { id: "ct-1", itemId: "loc1", local: "", quantidade: "10", fonte: "contagem", observadoEm: "2026-11-10T12:00:00.000Z" },
    { id: "im-1", itemId: "imp1", local: "", quantidade: "4.5", fonte: "importacao", observadoEm: "2026-11-10T12:00:00.000Z" }]);
  a.gs.inserir("est_movimentos", [{ id: "mv-1", itemId: "loc1", tipo: "saida", quantidade: "2", data: "2026-11-12", criadoEm: "2026-11-12T12:00:00.000Z" }]);
  a.gs.reiniciarExecucao();
  const r5 = a.gs.migracaoV5Ensaiar();
  v.verdade(r5.ok, JSON.stringify(r5));
  a.gs.migracaoV5Ativar();
  const itens5 = a.linhas("est_itens");
  v.igual(itens5.find((i) => i.id === "loc1").modoSaldo, "livro");
  v.igual(itens5.find((i) => i.id === "loc1").corteEm, "2026-11-10T12:00:00.000Z", "o corte é a contagem que já existia");
  v.igual(itens5.find((i) => i.id === "imp1").modoSaldo, "retrato");
  v.igual(a.linhas("int_externos").find((x) => x.tipo === "orcamento").assinatura.indexOf("reler:"), 0, "orçamento volta à fila para ser relido completo");
  a.gs.reiniciarExecucao();
  a.gs.migracaoV5Retornar();
  a.gs.reiniciarExecucao();
  a.gs.migracaoV4Retornar();
  v.igual(a.linhas("int_externos").map((x) => x.id).sort(), ["clinicorp:orcamento:7", "clinicorp:recebimento:1", "clinicorp:recebimento:2"], "retorno devolve as chaves da 4.1.0");
});

module.exports = () => executar("Migração");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
