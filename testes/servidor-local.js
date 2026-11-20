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

const PORTA = Number(process.argv[2]) || 4180;
const BASE = "/floreser/";
const RAIZ = path.join(__dirname, "..");

/* ---- contas e dados de teste ---- */
const CONTAS_DE_TESTE = [
  { usuario: "teste.admin", nome: "Admin de Teste", senha: "senha-teste-admin", admin: true },
  { usuario: "teste.equipe", nome: "Equipe de Teste", senha: "senha-teste-equipe", crm: true, agenda: true, entradas: true },
  { usuario: "teste.crm", nome: "Só CRM de Teste", senha: "senha-teste-crm", crm: true }
];

const amb = novoAmbiente();
CONTAS_DE_TESTE.forEach((c) => amb.criarConta(c));
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
