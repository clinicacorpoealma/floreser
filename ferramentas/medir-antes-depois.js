/* =====================================================================
   Medição antes/depois — node ferramentas/medir-antes-depois.js
   ---------------------------------------------------------------------
   Roda as MESMAS operações no backend da 3.5.0 (backend/legado/, que só
   existe no computador de quem tem o código antigo — ele tem as senhas e
   não vai para o GitHub) e no backend novo, sobre os MESMOS dados
   sintéticos, no simulador do Apps Script. Conta:

     chamadas    leituras + escritas + buscas ao Sheets
     na trava    as que aconteceram com a trava do script segura — é isso
                 que faz as outras pessoas esperarem
     bytes       o tamanho da resposta que atravessa a rede

   O simulador não mede tempo real do Google; as contagens, sim, são as que
   o código faria. Sem o arquivo legado, só o backend novo é medido.
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { carregarBackend, pedir } = require("../testes/simulador/carregar");

const LEGADO = path.join(__dirname, "..", "backend", "legado");
const temLegado = fs.existsSync(LEGADO) && fs.readdirSync(LEGADO).some((f) => f.endsWith(".gs"));
const N = { pacientes: 110, leads: 50, entradas: 130, historicoPorPaciente: 10 };

function dia(n) { const d = new Date(Date.parse("2026-11-20T12:00:00Z") + n * 86400000); return d.toISOString().slice(0, 10); }

/* ---- os mesmos dados sintéticos, no formato da 3.5.0 ---- */
function abasLegadas(derivar) {
  const A = {};
  A.Usuarios = [["id", "nome", "usuario", "senhaHash", "salt", "ativo", "admin", "crm", "agenda", "entradas", "criadoEm", "criadoPor", "ultimoLogin", "alteradoEm"],
    ["u1med", "Medição", "medicao", derivar("senha-medicao", "0123456789abcdef0123456789abcdef"), "0123456789abcdef0123456789abcdef", "sim", "sim", "sim", "sim", "sim", "2026-08-01T09:00:00", "painel", "", "2026-08-01T09:00:00"]];
  A.Usuarios_Sessoes = [["tokenHash", "usuarioId", "criadoEm", "ultimoUso", "expiraEm", "revogado"]];
  A.Usuarios_Fotos = [["usuarioId", "foto", "atualizadoEm"]];
  A.Cadencias = [["id", "nome", "dias"], ["quente", "Quente", "2"], ["morno", "Morno", "5"], ["frio", "Frio", "15"], ["muito_frio", "Muito frio", "30"]];
  A.Leads = [["id", "nome", "whatsapp", "interesse", "observacoes", "etapa", "cadencia", "exCliente", "ultimoContato", "criadoEm", "dtConversa", "dtAgendamento", "dtComparecimento", "dtVenda", "dtReprovado", "origem", "dataAgendada"]];
  for (let i = 0; i < N.leads; i++) A.Leads.push(["l" + i, "Lead " + i, "65 9" + String(10000000 + i), "Facial", "", "conversando", "quente", "não", dia(-i % 9), dia(-30), dia(-29), "", "", "", "", "instagram", ""]);
  A.Leads_Contatos = [["id", "leadId", "data", "criadoEm", "autorTipo", "autorId", "autorNome"]];
  A.Pacientes = [["id", "nome", "categoriaId", "obs", "criadoEm", "arquivada", "arquivadaEm", "whatsapp", "origem", "crmLeadId"]];
  A.Pacientes_Ciclos = [["pacienteId", "area", "freq", "ultimo", "agendamentoData", "agendamentoFollowUp", "adiadaPara", "naoRespondeu", "proximos", "fimPrevisto", "aRemarcar"]];
  A.Pacientes_Historico = [["pacienteId", "tipo", "area", "data", "em", "fu", "maquina"]];
  for (let i = 0; i < N.pacientes; i++) {
    A.Pacientes.push(["p" + i, "Paciente " + i, "", "", dia(-60), "não", "", "", "", ""]);
    A.Pacientes_Ciclos.push(["p" + i, "facial", "14", dia(-10), dia(4 + (i % 10)), "não", "", "0", "", "", "0"]);
    for (let h = 0; h < N.historicoPorPaciente; h++) A.Pacientes_Historico.push(["p" + i, "sessao", "facial", dia(-14 * h), dia(-14 * h), "", ""]);
  }
  A.Pacientes_Categorias = [["id", "nome", "cor"]];
  A.Pacientes_Condicoes = [["id", "pacienteId", "texto", "inicio", "fim"]];
  A.Pacientes_Maquinas = [["pacienteId", "maquinaId"]];
  A.Pacientes_FollowUps = [["id", "pacienteId", "area", "data", "feito", "agendamentoData", "criadoEm", "feitoEm"]];
  A.Maquinas = [["id", "nome", "cadencia", "cor", "obs"], ["m1", "Soprano", "Mensal", "#3B6E6A", ""]];
  A.Maquinas_Vindas = [["id", "maquinaId", "data", "obs", "criadoEm"]];
  A.Maquinas_Respostas = [["vindaId", "pacienteId", "status", "em", "adiadaPara", "vezes"]];
  A.Entradas = [["id", "nome", "data", "descricao", "obs", "criadoEm"]];
  A.Entradas_Pagamentos = [["entradaId", "metodo", "valor", "parcelas"]];
  for (let i = 0; i < N.entradas; i++) {
    A.Entradas.push(["e" + i, "Cliente " + i, dia(-(i % 30)), "Limpeza", "", "2026-11-01T12:00:00.000Z"]);
    A.Entradas_Pagamentos.push(["e" + i, "pix", "350.00", "1"]);
  }
  A.Lixeira = [["id", "tipo", "registroId", "titulo", "descricao", "dados", "excluidoEm", "excluidoPor", "excluidoPorId", "motivo"]];
  A.Auditoria = [["id", "operacaoId", "em", "modulo", "entidade", "entidadeId", "acao", "campo", "antes", "depois", "autorTipo", "autorId", "autorNome", "contexto"]];
  for (let i = 0; i < 2000; i++) A.Auditoria.push(["au" + i, "op" + i, "2026-10-01T10:00:00", "agenda", "paciente", "p" + (i % N.pacientes), "alterou", "Nome", "a", "b", "usuario", "u1med", "Medição", ""]);
  A.Logs = [["id", "quando", "nivel", "evento", "pagina", "mensagem", "versao", "sessao"]];
  A.Sessoes = [["id", "primeiroAcesso", "ultimoAcesso"]];
  return A;
}

function escrever(sim, abas) {
  Object.keys(abas).forEach((nome) => {
    const linhas = abas[nome];
    const s = sim.planilha.getSheetByName(nome) || sim.planilha.insertSheet(nome);
    const largura = linhas[0].length;
    s.getRange(1, 1, linhas.length, largura).setNumberFormat("@").setValues(linhas.map((l) => l.concat(Array(largura - l.length).fill("")).map(String)));
  });
}

function medir(sim, fn) {
  sim.zerarContadores();
  const resposta = fn();
  const c = sim.contadores;
  const total = (c.ler || 0) + (c.escrever || 0) + (c.procurar || 0);
  const trava = (c.lerNaTrava || 0) + (c.escreverNaTrava || 0) + (c.procurarNaTrava || 0);
  return { chamadas: total, naTrava: trava, escritas: c.escrever || 0, celulasEscritas: c.celulasEscritas || 0,
    celulasNaTrava: (c.celulasLidasNaTrava || 0) + (c.celulasEscritasNaTrava || 0), bytes: JSON.stringify(resposta).length, resposta };
}

const resultados = {};
function anotar(lado, op, m) { (resultados[op] = resultados[op] || {})[lado] = m; }

/* ================= 3.5.0 ================= */
let pimentaLegada = null;
if (temLegado) {
  const A = carregarBackend({ dir: LEGADO });
  pimentaLegada = vm.runInContext("PIMENTA", A.gs);
  escrever(A.sim, abasLegadas((s, salt) => A.gs.derivarSenha(s, salt)));
  vm.runInContext("try { configurarPrimeiraVez(); } catch (e) {}", A.gs);
  const P = (corpo) => pedir(A.gs, corpo);
  const login = medir(A.sim, () => P({ acao: "login_usuario", usuario: "medicao", senha: "senha-medicao" }));
  anotar("antes", "Entrar com a conta", login);
  const tk = login.resposta.token;
  anotar("antes", "Retomar a sessão", medir(A.sim, () => P({ acao: "sessao_usuario", token: tk, modulo: "agenda" })));
  const ag = medir(A.sim, () => P({ acao: "ler_agenda", token: tk }));
  anotar("antes", "Abrir a Agenda", ag);
  const estado = ag.resposta.dados;
  estado.pacientes[5].obs = "mudou uma ficha";
  anotar("antes", "Salvar uma paciente", medir(A.sim, () => P({ acao: "salvar_agenda", token: tk, rev: ag.resposta.rev, dados: estado })));
  const crm = medir(A.sim, () => P({ acao: "ler", token: tk }));
  anotar("antes", "Abrir o CRM", crm);
  const dc = crm.resposta.dados;
  dc.leads[3].interesse = "Corporal";
  anotar("antes", "Salvar uma lead", medir(A.sim, () => P({ acao: "salvar", token: tk, rev: crm.resposta.rev, dados: dc })));
  const en = medir(A.sim, () => P({ acao: "ler_entradas", token: tk }));
  anotar("antes", "Abrir as Entradas", en);
  const de = en.resposta.dados;
  de.entradas[2].obs = "nota";
  anotar("antes", "Salvar uma entrada", medir(A.sim, () => P({ acao: "salvar_entradas", token: tk, rev: en.resposta.rev, dados: de })));
  anotar("antes", "Busca global", medir(A.sim, () => P({ acao: "busca_global", token: tk, termo: "paciente 7" })));
}

/* ================= 4.0.0 ================= */
{
  const B = carregarBackend({});
  B.sim.props.FLORESER_PIMENTA = pimentaLegada || "pimenta-de-medicao";
  B.sim.props.FLORESER_SENHA_CRM = "x-medicao"; B.sim.props.FLORESER_SENHA_AGENDA = "x-medicao";
  B.sim.props.FLORESER_SENHA_ENTRADAS = "x-medicao"; B.sim.props.FLORESER_SENHA_DEV = "x-medicao";
  B.gs.reiniciarExecucao();
  escrever(B.sim, abasLegadas((s, salt) => B.gs.derivarSenhaV1(s, salt)));
  B.gs.reiniciarExecucao(); B.gs.migracaoEnsaiar();
  B.gs.reiniciarExecucao(); B.gs.migracaoAtivar();
  let n = 0;
  const P = (acao, dados, token) => pedir(B.gs, { v: 2, pedidoId: "m" + (++n), acao, token: token || "", dados: dados || {} });
  /* a primeira entrada troca o hash para PBKDF2 — custo único, medido à parte */
  const primeira = medir(B.sim, () => P("sessao.entrar", { usuario: "medicao", senha: "senha-medicao", operacaoId: "medicao-login-1" }));
  const login = medir(B.sim, () => P("sessao.entrar", { usuario: "medicao", senha: "senha-medicao", operacaoId: "medicao-login-2" }));
  anotar("depois", "Entrar com a conta", login);
  const tk = login.resposta.dados.token;
  B.sim.esquecerCache();
  anotar("depois", "Retomar a sessão", medir(B.sim, () => P("sessao.conferir", { modulo: "agenda" }, tk)));
  anotar("depois", "Abrir a Agenda (cabeçalhos frios)", medir(B.sim, () => P("agenda.ler", {}, tk)));
  const ag = medir(B.sim, () => P("agenda.ler", {}, tk));
  anotar("depois", "Abrir a Agenda", ag);
  const p5 = ag.resposta.dados.pacientes[5];
  anotar("depois", "Salvar uma paciente", medir(B.sim, () => P("agenda.aplicar", { operacoes: [{ operacaoId: "medicao-op-pac", tipo: "paciente.alterar", id: p5.id, revBase: p5._rev, campos: { obs: "mudou uma ficha" } }] }, tk)));
  const crm = medir(B.sim, () => P("crm.ler", {}, tk));
  anotar("depois", "Abrir o CRM", crm);
  const l3 = crm.resposta.dados.leads[3];
  anotar("depois", "Salvar uma lead", medir(B.sim, () => P("crm.aplicar", { operacoes: [{ operacaoId: "medicao-op-lead", tipo: "lead.alterar", id: l3.id, revBase: l3._rev, campos: { interesse: "Corporal" } }] }, tk)));
  const en = medir(B.sim, () => P("entradas.ler", {}, tk));
  anotar("depois", "Abrir as Entradas", en);
  const e2 = en.resposta.dados.entradas[2];
  anotar("depois", "Salvar uma entrada", medir(B.sim, () => P("entradas.aplicar", { operacoes: [{ operacaoId: "medicao-op-ent", tipo: "entrada.alterar", id: e2.id, revBase: e2._rev, campos: { obs: "nota" } }] }, tk)));
  anotar("depois", "Busca global", medir(B.sim, () => P("busca.global", { termo: "paciente 7" }, tk)));
  resultados["(primeiro login: troca do hash)"] = { depois: primeira };
}

/* ---- tabela ---- */
const col = (m, k) => (m ? String(m[k]) : "—");
console.log("Dados: " + N.pacientes + " pacientes (" + N.historicoPorPaciente + " históricos cada), " + N.leads + " leads, " + N.entradas + " entradas, 2000 auditorias.");
console.log((temLegado ? "" : "(sem backend/legado: só a 4.0.0)\n") +
  "Operação                          | chamadas  | na trava  | células escritas | células com a trava | bytes da resposta");
Object.keys(resultados).forEach((op) => {
  const a = resultados[op].antes, d = resultados[op].depois;
  const par = (k, w) => (col(a, k) + " → " + col(d, k)).padEnd(w);
  console.log(op.padEnd(33) + " | " + par("chamadas", 9) + " | " + par("naTrava", 9) + " | " + par("celulasEscritas", 16) + " | " +
    par("celulasNaTrava", 19) + " | " + col(a, "bytes") + " → " + col(d, "bytes"));
});
