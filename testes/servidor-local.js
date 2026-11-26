/* =====================================================================
   Servidor local de desenvolvimento — o site e o backend, sem o Google
   ---------------------------------------------------------------------
   node testes/servidor-local.js [porta]

     http://localhost:4180/floreser/          o site, debaixo de uma pasta
                                              (como no GitHub Pages: um
                                              caminho absoluto esquecido
                                              quebra aqui, não na publicação)
     POST /floreser/__api                     o backend REAL (backend/*.gs)
                                              rodando no simulador do Apps
                                              Script, em memória

   O compartilhado/config.js é servido com o endereço da API trocado pelo
   local — o arquivo no disco não muda. Os dados são SINTÉTICOS e somem ao
   parar o servidor. As contas e senhas abaixo são de teste e só existem
   aqui.
   ===================================================================== */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { novoAmbiente } = require("./util/ambiente");
const { clinicorpFalso } = require("./util/clinicorp-falso");

const PORTA = Number(process.argv[2]) || 4180;
const BASE = "/floreser/";
const RAIZ = path.join(__dirname, "..");

/* ---- contas e dados de teste ---- */
const CONTAS_DE_TESTE = [
  { usuario: "teste.admin", nome: "Admin de Teste", senha: "senha-teste-admin", admin: true },
  { usuario: "teste.equipe", nome: "Equipe de Teste", senha: "senha-teste-equipe", crm: true, agenda: true, entradas: true },
  { usuario: "teste.crm", nome: "Só CRM de Teste", senha: "senha-teste-crm", crm: true },
  { usuario: "teste.financeiro", nome: "Financeiro de Teste", senha: "senha-teste-financeiro", financeiro: true }
];

const amb = novoAmbiente();
CONTAS_DE_TESTE.forEach((c) => amb.criarConta(c));

/* Um Clinicorp SIMULADO, com dados sintéticos, para exercitar o painel →
   Integrações sem rede. As "credenciais" são marcadores falsos: este
   servidor nunca fala com o Clinicorp de verdade. */
const clinicorp = clinicorpFalso();
amb.sim.http = clinicorp.handler;
amb.sim.props.FLORESER_CLINICORP_USUARIO = "usuario-simulado";
amb.sim.props.FLORESER_CLINICORP_TOKEN = "token-simulado";
(function () {
  const hoje = new Date();
  const dia = (n) => new Date(hoje.getTime() + n * 86400000).toISOString().slice(0, 10);
  clinicorp.pagamentos = [1, 2, 3].map((i) => ({ id: 700 + i, PaymentHeaderId: 800 + i, Amount: 150 * i + 0.5, AmountWithDiscounts: (150 * i + 0.5) * 0.97,
    DueDate: dia(-i * 3), ReceivedDate: dia(-i * 3), PaymentReceived: "X", PaymentConfirmed: "X", ConfirmedDate: dia(-i * 3), InstallmentNumber: "1",
    InstallmentsCount: "1", PaymentForm: i === 2 ? "PIX" : "Cartão de Crédito", PatientId: 9001, PatientName: "Paciente Sintética Um", ReceiverBusinessId: 111,
    z_LastChange_Date: dia(-i * 3) + "T12:00:00Z" }));
  clinicorp.orcamentos = [{ id: 3001, TreatmentId: 70, Status: "APPROVED", CreateDate: dia(-10), ApprovedDate: dia(-2), Amount: 1200, PatientId: 9001,
    PatientName: "Paciente Sintética Um", ProfessionalName: "Profissional Sintético", ProcedureList: [{ OperationDescription: "Limpeza de pele", FinalAmount: 1200 }] }];
  clinicorp.agendamentos = [{ ItemType: "APPOINTMENT", id: 801, date: dia(3) + "T04:00:00.000Z", fromTime: "09:00", toTime: "10:00", Clinic_BusinessId: 111,
    Dentist_PersonId: 5, PatientName: "Paciente Sintética Um", StatusId: 1, z_LastChange_Date: dia(-1) + "T10:00:00Z", _paciente: 9001 }];
})();
semear();

function semear() {
  const tk = amb.entrar("teste.equipe", "senha-teste-equipe");
  const hoje = new Date();
  const dia = (n) => { const d = new Date(hoje.getTime() + n * 86400000); return d.toISOString().slice(0, 10); };
  const ops = (lista) => ({ operacoes: lista.map((o, i) => Object.assign({ operacaoId: "semente-" + o.tipo.replace(/\W/g, "") + "-" + i + "-" + Date.now() }, o)) });
  amb.pedir("crm.aplicar", ops([
    { tipo: "lead.criar", id: "lead-ana", dados: { nome: "Ana Exemplo", whatsapp: "65 99999-0001", interesse: "Facial", etapa: "conversando", cadencia: "quente", origem: "instagram", ultimoContato: dia(-3) } },
    { tipo: "lead.criar", id: "lead-bruno", dados: { nome: "Bruno Exemplo", whatsapp: "65 99999-0002", etapa: "agendado", dataAgendada: dia(2), cadencia: "" } },
    { tipo: "lead.criar", id: "lead-carla", dados: { nome: "Carla Exemplo", etapa: "nao_responde", cadencia: "morno", ultimoContato: dia(-10) } }
  ]), tk);
  amb.pedir("agenda.aplicar", ops([
    { tipo: "categoria.criar", id: "cat-vip", dados: { nome: "VIP", cor: "#3B6E6A" } },
    { tipo: "paciente.criar", id: "pac-dora", dados: { nome: "Dora Exemplo", categoriaId: "cat-vip", criadoEm: dia(-40),
      ciclos: { facial: { freq: 14, ultimo: dia(-12), agendamento: { data: dia(2), temFollowUp: false }, proximos: [dia(16), dia(30)], aRemarcar: 0 } },
      condicoes: [], maquinas: [], historico: [{ id: "hist-semente-1", tipo: "agendou", area: "facial", data: dia(2), em: dia(-12) }] } },
    { tipo: "paciente.criar", id: "pac-eva", dados: { nome: "Eva Exemplo", criadoEm: dia(-20),
      ciclos: { corporal: { freq: 21, ultimo: dia(-25), agendamento: null, proximos: [] } }, condicoes: [], maquinas: [], historico: [] } }
  ]), tk);
  amb.pedir("entradas.aplicar", ops([
    { tipo: "entrada.criar", id: "ent-1", dados: { nome: "Dora Exemplo", data: dia(0), descricao: "Limpeza Corpo e Alma", pagamentos: [{ metodo: "pix", valor: 35000, parcelas: 1 }] } },
    { tipo: "entrada.criar", id: "ent-2", dados: { nome: "Eva Exemplo", data: dia(-1), descricao: "Drenagem", pagamentos: [{ metodo: "credito", valor: 48050, parcelas: 3 }] } }
  ]), tk);
  amb.pedir("sessao.sair", {}, tk);

  /* Financeiro: algumas despesas, uma recorrência, um material e uma ficha */
  const tf = amb.entrar("teste.financeiro", "senha-teste-financeiro");
  amb.pedir("financeiro.aplicar", ops([
    { tipo: "despesa.criar", id: "dp-aluguel", dados: { descricao: "Aluguel da sala", valor: 320000, vencimento: dia(-5), categoriaId: "cat-aluguel", meio: "Boleto" } },
    { tipo: "despesa.criar", id: "dp-energia", dados: { descricao: "Energia", valor: 41870, vencimento: dia(4), categoriaId: "cat-energia" } },
    { tipo: "despesa.criar", id: "dp-autoclave", dados: { descricao: "Autoclave", valor: 450000, vencimento: dia(10), categoriaId: "cat-equipamentos" },
      parcelamento: { quantidade: 3, primeiroVencimento: dia(10), frequencia: "mensal" } },
    { tipo: "recorrencia.criar", id: "rc-sistema", dados: { descricao: "Sistema de gestão", valor: 19990, categoriaId: "cat-sistemas", frequencia: "mensal", inicio: dia(-20) } },
    { tipo: "insumo.salvar", id: "in-gel", dados: { nome: "Gel condutor", unidadeCompra: "frasco", conteudo: "500", unidadeConteudo: "ml", valorEmbalagem: 4500, perdaPct: "5" } },
    { tipo: "orcamento.definir", categoriaId: "cat-aluguel", mes: dia(0).slice(0, 7), valor: 330000, alertaPct: 90 }
  ]), tf);
  amb.pedir("financeiro.aplicar", ops([
    { tipo: "pagamento.registrar", despesaId: "dp-aluguel", revBase: 1, dados: { id: "pg-semente-1", data: dia(-4), valor: 200000, meio: "PIX" } },
    { tipo: "ficha.salvar", id: "fc-limpeza", revBase: 0, dados: { tipo: "procedimento", nome: "Limpeza de pele", precoAtual: 18000, dados: {
      itens: [{ insumoId: "in-gel", quantidade: "15", unidade: "ml" }], tempoMin: "60", maoDeObraHora: 4000, equipamentos: [{ nome: "Vapor de ozônio", custoPorUso: 250 }],
      rateio: { modo: "por_hora", valor: 2200, base: "custos fixos ÷ horas produtivas", categorias: ["cat-aluguel", "cat-energia"] },
      taxaPagamentoPct: "3", comissaoPct: "10", impostosPct: "6", margemPct: "" } } }
  ]), tf);
  /* Estoque: um retrato importado (manual) e um item só do Alveare */
  amb.pedir("importacao.confirmar", { operacaoId: "semente-estoque-0001", modulo: "financeiro", tipo: "estoque", arquivo: "estoque-exemplo.csv",
    mapeamento: { nome: "A — Produto", quantidade: "B — Saldo" }, linhas: [
      { codigo: "GEL500", nome: "Gel condutor", unidade: "ML", quantidade: "1250.5", minimo: "2000", custoUnitario: 9, categoria: "Consumo", local: "Sala 1" },
      { codigo: "LUVA-M", nome: "Luva de procedimento M", unidade: "UN", quantidade: "0", minimo: "100", categoria: "Descartáveis" },
      { codigo: "SER-VC", nome: "Sérum vitamina C", unidade: "ML", quantidade: "30.125", validade: dia(12), custoUnitario: 120, categoria: "Ativos" },
      { codigo: "AGU-30", nome: "Agulha 30G", unidade: "UN", quantidade: "", categoria: "Descartáveis" }] }, tf);
  amb.pedir("financeiro.aplicar", ops([{ tipo: "estoque.item.salvar", id: "est-amostras", revBase: 0, dados: { nome: "Amostras de brinde", unidadeConsumo: "un", unidadeCompra: "un", minimo: "10" } }]), tf);

  /* Vendas (4.3.0): o exemplo de 10 a R$ 30, duas vendas entregues e uma a confirmar */
  amb.pedir("financeiro.aplicar", ops([
    { tipo: "ficha.salvar", id: "fc-serum", revBase: 0, dados: { tipo: "produto", nome: "Sérum sintético (revenda)", precoAtual: 5000, dados: {} } },
    { tipo: "estoque.item.salvar", id: "est-serum", revBase: 0, dados: { nome: "Sérum sintético (revenda)", codigo: "SER-REV", unidadeConsumo: "un", unidadeCompra: "un", minimo: "3", fichaId: "fc-serum" } }
  ]), tf);
  amb.pedir("financeiro.aplicar", ops([{ tipo: "estoque.movimento", itemId: "est-serum", dados: { id: "mv-semente-serum", tipo: "entrada", quantidade: "10", custoUnitario: 3000, data: dia(-6) } }]), tf);
  amb.pedir("financeiro.aplicar", ops([
    { tipo: "venda.salvar", id: "vd-semente-1", revBase: 0, dados: { data: dia(-3), entregueEm: dia(-3), pacienteNome: "Dora Exemplo", itens: [{ itemId: "est-serum", quantidade: "2", precoUnitario: 5000 }] } },
    { tipo: "venda.salvar", id: "vd-semente-2", revBase: 0, dados: { data: dia(-1), entregueEm: dia(-1), pacienteNome: "Eva Exemplo", itens: [{ itemId: "est-serum", quantidade: "1", precoUnitario: 4500 }] } },
    { tipo: "venda.salvar", id: "vd-semente-3", revBase: 0, dados: { data: dia(0), pacienteNome: "Dora Exemplo", itens: [{ itemId: "est-serum", quantidade: "1", precoUnitario: 5000 }, { itemId: "est-amostras", quantidade: "2", precoUnitario: 0 }] } }
  ]), tf);

  /* Orçamentos e execução: sessões já vividas na Agenda, um orçamento do Alveare e registros */
  amb.gs.reiniciarExecucao();
  amb.gs.inserir("agenda_historico", [
    { id: "hist-semente-s1", pacienteId: "pac-dora", tipo: "sessao", area: "facial", data: dia(-26) },
    { id: "hist-semente-s2", pacienteId: "pac-dora", tipo: "sessao", area: "facial", data: dia(-12) },
    { id: "hist-semente-s3", pacienteId: "pac-dora", tipo: "sessao", area: "corporal", data: dia(-12) }]);
  amb.gs.reiniciarExecucao();
  amb.pedir("financeiro.aplicar", ops([{ tipo: "exe.orcamento.salvar", id: "orc-semente-dora", revBase: 0, dados: { pacienteRef: "loc:pac-dora", data: dia(-30), situacao: "aprovado",
    itens: [{ id: "it-limpeza", procedimento: "Limpeza de pele", procedimentoRef: "LIMP", fichaId: "fc-limpeza", quantidade: "4", valorUnitario: 18000 },
      { id: "it-drenagem", procedimento: "Drenagem", procedimentoRef: "DREN", quantidade: "2", valorUnitario: 15000 }] } }]), tf);
  const agFuturo = amb.gs.lerTudo("agenda_agendamentos").filter((g) => g.pacienteId === "pac-dora").sort((a, b) => a.data.localeCompare(b.data))[0];
  amb.pedir("financeiro.aplicar", ops([
    { tipo: "exe.registrar", id: "ex-semente-1", dados: { agendamentoTipo: "agenda-hist", agendamentoId: "hist-semente-s1", procedimento: "Limpeza de pele", procedimentoRef: "LIMP" } },
    { tipo: "exe.registrar", id: "ex-semente-2", dados: { agendamentoTipo: "agenda-hist", agendamentoId: "hist-semente-s2", procedimento: "Limpeza de pele", procedimentoRef: "LIMP" } },
    { tipo: "exe.registrar", id: "ex-semente-3", dados: { agendamentoTipo: "agenda-hist", agendamentoId: "hist-semente-s3", procedimento: "Drenagem", procedimentoRef: "DREN" } },
    { tipo: "exe.registrar", id: "ex-semente-4", dados: { agendamentoTipo: "agenda-hist", agendamentoId: "hist-semente-s2", procedimento: "Peeling químico" } }
  ].concat(agFuturo ? [{ tipo: "exe.registrar", id: "ex-semente-5", dados: { agendamentoTipo: "agenda", agendamentoId: agFuturo.id, procedimento: "Limpeza de pele", procedimentoRef: "LIMP", estado: "previsto" } }] : [])), tf);
  /* Planos (4.4.0): uma observação a ler, uma troca com entrega parcial e um bônus */
  amb.pedir("financeiro.aplicar", ops([
    { tipo: "exe.atendimento.salvar", id: "agenda-hist:hist-semente-s2", revBase: 0, dados: { observacao: "pele sensível, ácido mandélico 5 min" } },
    { tipo: "exe.troca.registrar", id: "tr-semente-1", dados: { orcamentoRef: "local:orc-semente-dora", linhaChave: "r:DREN", quantidadeOrigem: "1",
      procedimentoSubstituto: "Massagem relaxante", quantidadePrometida: "2", precoSubstituto: 12000, agendamentoTipo: "agenda-hist", agendamentoId: "hist-semente-s3",
      entregaQuantidade: "1", substituirExecucaoId: "ex-semente-3", motivo: "pedido da paciente" } }
  ]), tf);
  amb.pedir("financeiro.aplicar", ops([
    { tipo: "exe.registrar", id: "ex-semente-6", dados: { agendamentoTipo: "agenda-hist", agendamentoId: "hist-semente-s1", procedimento: "Hidratação facial", natureza: "gratuito",
      valorReferencia: 9000, orcamentoRef: "local:orc-semente-dora" } }
  ]), tf);
  amb.pedir("sessao.sair", {}, tf);
}

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

function servirArquivo(req, res, relativo) {
  let alvo = path.normalize(path.join(RAIZ, relativo));
  if (!alvo.startsWith(RAIZ)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(alvo) && fs.statSync(alvo).isDirectory()) {
    if (!req.url.split("?")[0].endsWith("/")) { res.writeHead(301, { Location: req.url.split("?")[0] + "/" }); res.end(); return; }
    alvo = path.join(alvo, "index.html");
  }
  if (!fs.existsSync(alvo)) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404: " + relativo); return; }
  let conteudo = fs.readFileSync(alvo);
  if (relativo.replace(/\\/g, "/") === "compartilhado/config.js") {
    conteudo = Buffer.from(conteudo.toString("utf8").replace(/var API_URL = "[^"]*";/, 'var API_URL = "http://localhost:' + PORTA + BASE + '__api";'));
  }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(alvo)] || "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(conteudo);
}

http.createServer((req, res) => {
  const caminho = decodeURIComponent(req.url.split("?")[0]);
  if (caminho === "/" ) { res.writeHead(302, { Location: BASE }); res.end(); return; }
  if (!caminho.startsWith(BASE)) { res.writeHead(404); res.end("O site mora em " + BASE); return; }
  if (caminho === BASE + "__api") {
    if (req.method !== "POST") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(amb.gs.doGet().getContent()); return; }
    let corpo = "";
    req.on("data", (c) => { corpo += c; });
    req.on("end", () => {
      let texto;
      try { amb.gs.reiniciarExecucao(); texto = amb.gs.doPost({ postData: { contents: corpo } }).getContent(); }
      catch (e) { texto = JSON.stringify({ ok: false, erro: { codigo: "servidor_falhou" } }); console.error(e); }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(texto);
    });
    return;
  }
  servirArquivo(req, res, caminho.slice(BASE.length) || "index.html");
}).listen(PORTA, () => {
  console.log("FloreSer local em http://localhost:" + PORTA + BASE + " (backend simulado, dados sintéticos)");
});
