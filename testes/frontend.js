/* Testes da camada compartilhada do navegador (rede, sessão, motor de
   dados) ligada ao backend REAL no simulador. Cada "aba" é um contexto
   isolado com o próprio sessionStorage; o localStorage é do "navegador". */
"use strict";

const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");
const { teste, verifica: v, executar } = require("./util/teste");
const { novoAmbiente } = require("./util/ambiente");

const RAIZ = path.join(__dirname, "..");
const ARQUIVOS = ["version.js", "compartilhado/config.js", "compartilhado/rede.js", "compartilhado/sync.js",
  "compartilhado/sessao.js", "compartilhado/dados.js"];
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms || 0));

function armazenamento(navegador, nome) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { const antes = m.get(k); m.set(k, String(v)); if (navegador && nome === "local") navegador.avisar(k, antes, String(v)); },
    removeItem: (k) => { const antes = m.get(k); m.delete(k); if (navegador && nome === "local") navegador.avisar(k, antes, null); },
    get length() { return m.size; }, _m: m
  };
}

/* Um navegador: um backend, uma rede controlável, um localStorage, várias abas. */
function novoNavegador(amb) {
  const nav = {
    amb, abas: [], modo: "normal", segurando: false, fila: [], pedidos: [],
    avisar(chave, antes, depois) {
      nav.abas.forEach((a) => { if (a !== nav.emEscrita) a.disparar("storage", { key: chave, oldValue: antes, newValue: depois }); });
    }
  };
  nav.local = armazenamento(nav, "local");
  nav.responder = (corpo) => {
    const texto = amb.gs.doPost({ postData: { contents: corpo } }).getContent();
    return texto;
  };
  nav.fetch = (url, op) => new Promise((resolve, reject) => {
    const corpo = op.body;
    nav.pedidos.push(JSON.parse(corpo));
    const executar = () => {
      if (op.signal && op.signal.aborted) { const e = new Error("abortado"); e.name = "AbortError"; reject(e); return; }
      if (nav.modo === "semRede") { reject(new TypeError("Failed to fetch")); return; }
      if (nav.modo === "404antes") { resolve({ ok: false, status: 404, text: () => Promise.resolve("<html>Not Found</html>") }); return; }
      if (nav.modo === "trava") { if (op.signal) op.signal.addEventListener("abort", () => { const e = new Error("abortado"); e.name = "AbortError"; reject(e); }); return; }
      const texto = nav.responder(corpo);
      if (nav.modo === "perderResposta") { resolve({ ok: false, status: 404, text: () => Promise.resolve("<html>Página não encontrada</html>") }); return; }
      if (nav.modo === "servidorAntigo") { resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: false, erro: "acao_desconhecida" })) }); return; }
      resolve({ ok: true, status: 200, text: () => Promise.resolve(texto) });
    };
    if (nav.segurando) nav.fila.push(executar); else setTimeout(executar, 0);
  });
  nav.soltar = () => { const f = nav.fila.splice(0); f.forEach((x) => x()); };
  nav.novaAba = () => {
    const ouvintes = {};
    const sessionStorage = armazenamento(null, "sessao");
    const ctx = {
      console, Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, TypeError, Map, Set, URL,
      Uint8Array, AbortController,
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 20)), clearTimeout,
      crypto: webcrypto,
      localStorage: nav.local, sessionStorage,
      fetch: nav.fetch,
      navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0", onLine: true },
      matchMedia: () => ({ matches: false }),
      location: { href: "http://localhost/floreser/", pathname: "/floreser/", hostname: "localhost" },
      document: {
        currentScript: null, visibilityState: "visible", documentElement: { setAttribute() { }, classList: { add() { }, remove() { } } },
        addEventListener: (t, fn) => { (ouvintes["doc:" + t] = ouvintes["doc:" + t] || []).push(fn); },
        createElement: () => ({ style: {}, setAttribute() { }, appendChild() { }, classList: { add() { }, remove() { }, toggle() { } } }),
        head: { appendChild() { } }, body: { appendChild() { }, classList: { add() { }, remove() { } } },
        querySelector: () => null
      },
      addEventListener: (t, fn) => { (ouvintes[t] = ouvintes[t] || []).push(fn); }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    ARQUIVOS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(RAIZ, f), "utf8"), ctx, { filename: f }));
    const aba = {
      ctx, sessao: ctx.FloreSerSessao, rede: ctx.FloreSerRede, dados: ctx.FloreSerDados, sync: ctx.FloreSerSync,
      eventos: [],
      disparar: (t, e) => (ouvintes[t] || []).forEach((fn) => fn(e)),
      voltar: () => (ouvintes["doc:visibilitychange"] || []).forEach((fn) => fn())
    };
    aba.sessao.ouvir((tipo, d) => aba.eventos.push(tipo));
    nav.abas.push(aba);
    return aba;
  };
  return nav;
}

function cenario() {
  const amb = novoAmbiente();
  amb.criarConta({ usuario: "bia", nome: "Bia", senha: "segredo-bia", crm: true, agenda: true, entradas: true });
  amb.criarConta({ usuario: "caio", nome: "Caio", senha: "segredo-caio", crm: true });
  const nav = novoNavegador(amb);
  return { amb, nav, aba: nav.novaAba() };
}

/* ============================ Sessão ============================ */

teste("entrar guarda o token da conta e o perfil; recarregar a aba continua autenticado", async () => {
  const { nav, aba } = cenario();
  const r = await aba.sessao.entrar("bia", "segredo-bia");
  v.verdade(r.ok);
  v.verdade(!!aba.sessao.token());
  v.igual(aba.sessao.conta().nome, "Bia");
  const recarregada = nav.novaAba();
  v.igual(recarregada.sessao.token(), aba.sessao.token(), "outra aba (ou recarga) usa a mesma sessão");
  const c = await recarregada.sessao.conferir({ modulo: "agenda" });
  v.verdade(c.ok && c.acessoModulo === true);
});

teste("a sessão da 3.5.0 guardada no navegador é adotada, e as chaves antigas somem", async () => {
  const { amb, nav } = cenario();
  const tk = amb.entrar("bia", "segredo-bia");
  nav.local.setItem("floreser.usuario.sessao", tk);
  nav.local.setItem("floreser.usuario.perfil", JSON.stringify({ id: "x", nome: "Bia" }));
  nav.local.setItem("floreser.usuario.atividade", String(Date.now() - 40 * 86400000));
  const aba = nav.novaAba();
  v.igual(aba.sessao.token(), tk);
  v.igual(nav.local.getItem("floreser.usuario.sessao"), null);
  const c = await aba.sessao.conferir({ forcar: true });
  v.verdade(c.ok, "atividade local antiga não derruba nada: quem decide é o servidor");
});

teste("resposta atrasada de um token antigo não apaga a sessão de quem acabou de entrar", async () => {
  const { amb, nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  const velho = aba.sessao.token();
  amb.pedir("sessao.sair", {}, velho);
  amb.sim.esquecerCache();
  nav.segurando = true;
  const conferencia = aba.sessao.conferir({ forcar: true });
  await espera(5);
  nav.segurando = false;
  const novo = await aba.sessao.entrar("bia", "segredo-bia");
  v.verdade(novo.ok);
  const tokenNovo = aba.sessao.token();
  nav.soltar();
  const c = await conferencia;
  v.igual(c.ok, false, "o token velho foi recusado");
  v.igual(aba.sessao.token(), tokenNovo, "e a sessão nova continua");
});

teste("sem rede, 404 do redirecionamento e servidor ocupado não derrubam a sessão", async () => {
  const { amb, nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  nav.modo = "semRede";
  let c = await aba.sessao.conferir({ forcar: true });
  v.verdade(!c.ok && c.temporario);
  nav.modo = "404antes";
  c = await aba.sessao.conferir({ forcar: true });
  v.verdade(!c.ok && c.temporario);
  nav.modo = "normal";
  amb.sim.travaOcupada = true;
  c = await aba.sessao.conferir({ forcar: true });
  v.verdade(c.ok, "conferir não precisa da trava");
  amb.sim.travaOcupada = false;
  v.verdade(!!aba.sessao.token());
  v.igual(aba.eventos.indexOf("perdida"), -1);
});

teste("leitura que falha passageira é repetida sozinha e dá certo", async () => {
  const { nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  let vez = 0;
  const original = nav.fetch;
  aba.ctx.fetch = (u, o) => (++vez === 1 ? Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("x") }) : original(u, o));
  const r = await aba.rede.chamar("crm.ler", {}, { token: aba.sessao.token(), leitura: true });
  v.verdade(r.ok);
  v.igual(vez, 2);
});

teste("sem acesso a um módulo é resposta, não queda: a conta segue nos outros", async () => {
  const { nav } = cenario();
  const aba = nav.novaAba();
  await aba.sessao.entrar("caio", "segredo-caio");
  const r = await aba.rede.chamar("agenda.ler", {}, { token: aba.sessao.token(), leitura: true });
  v.igual(r.erro.codigo, "sem_acesso");
  v.igual(r.erro.categoria, "autorizacao");
  v.verdade(!!aba.sessao.token());
  v.verdade((await aba.rede.chamar("crm.ler", {}, { token: aba.sessao.token(), leitura: true })).ok);
});

teste("sessão encerrada de verdade no servidor: avisa 'perdida' e apaga só ela", async () => {
  const { amb, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  amb.pedir("sessao.sair", {}, aba.sessao.token());
  amb.sim.esquecerCache();
  await aba.rede.chamar("crm.ler", {}, { token: aba.sessao.token(), leitura: true });
  v.igual(aba.sessao.token(), "");
  v.verdade(aba.eventos.indexOf("perdida") >= 0);
});

teste("várias abas: sair numa avisa as outras; entrar com outra conta é 'trocou'", async () => {
  const { nav, aba } = cenario();
  const outra = nav.novaAba();
  await aba.sessao.entrar("bia", "segredo-bia");
  v.verdade(outra.eventos.indexOf("entrou") >= 0);
  await aba.sessao.entrar("caio", "segredo-caio");
  v.verdade(outra.eventos.indexOf("trocou") >= 0, "a outra aba sabe que a conta mudou");
  await aba.sessao.sair();
  v.verdade(outra.eventos.indexOf("saiu") >= 0);
  v.igual(outra.sessao.token(), "");
});

teste("conferências simultâneas viram uma só; confirmação recente dispensa o servidor", async () => {
  const { nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  nav.pedidos.length = 0;
  await Promise.all([aba.sessao.conferir({ forcar: true }), aba.sessao.conferir({ forcar: true }), aba.sessao.conferir({ forcar: true })]);
  v.igual(nav.pedidos.filter((p) => p.acao === "sessao.conferir").length, 1);
  await aba.sessao.conferir();
  v.igual(nav.pedidos.filter((p) => p.acao === "sessao.conferir").length, 1, "dentro de 5 minutos, sem pedido");
});

teste("servidor na versão anterior: erro de versão, sessão intacta", async () => {
  const { nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  nav.modo = "servidorAntigo";
  const r = await aba.rede.chamar("crm.ler", {}, { token: aba.sessao.token(), leitura: true });
  v.igual(r.erro.codigo, "versao_servidor");
  v.verdade(!!aba.sessao.token());
});

teste("gravação sem resposta no prazo é 'resultado desconhecido', nunca 'falhou'", async () => {
  const { nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  nav.modo = "trava";
  const r = await aba.rede.chamar("crm.aplicar", { operacoes: [] }, { token: aba.sessao.token(), prazoMs: 30 });
  v.igual(r.erro.codigo, "resultado_desconhecido");
  v.igual(r.erro.categoria, "incerto");
});

/* ============================ Motor de dados ============================ */

const COLECOES_CRM = {
  leads: { criar: "lead.criar", alterar: "lead.alterar", remover: "lead.remover",
    campos: ["nome", "whatsapp", "interesse", "observacoes", "etapa", "cadencia", "exCliente", "ultimoContato", "criadoEm",
      "dtConversa", "dtAgendamento", "dtComparecimento", "dtVenda", "dtReprovado", "origem", "dataAgendada"] },
  contatos: { criar: "contato.registrar", soAcrescenta: true,
    criacao: (c) => ({ dados: { id: c.id, leadId: c.leadId, data: c.data, criadoEm: c.criadoEm } }),
    anexarEm: { colecao: "leads", campo: "leadId", como: "contatos" } }
};

async function motorCRM(aba) {
  const motor = aba.dados.criarSincronizador({ modulo: "crm", acao: "crm.aplicar", colecoes: COLECOES_CRM,
    valores: { dias: { tipo: "config.cadencias", rev: "_revDias", payload: (l) => ({ dias: l.dias }) } },
    token: () => aba.sessao.tokenPara("crm") });
  const r = await aba.rede.chamar("crm.ler", {}, { token: aba.sessao.token(), leitura: true });
  const estado = r.dados;
  motor.definirBase(estado);
  return { motor, estado: JSON.parse(JSON.stringify(estado)) };
}

teste("motor: uma lead nova e um contato vão como operações; 'Contatei' sobe junto com a ficha", async () => {
  const { nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  const { motor, estado } = await motorCRM(aba);
  estado.leads.push({ id: "l1", nome: "Lead Um", etapa: "nao_responde", cadencia: "quente", exCliente: false });
  let r = await motor.enviar(estado);
  v.verdade(r.ok && r.enviadas === 1, JSON.stringify(r));
  const lead = estado.leads[0];
  lead.ultimoContato = "2026-11-19";
  estado.contatos.push({ id: "contato-motor-1", leadId: "l1", data: "2026-11-19", criadoEm: new Date().toISOString() });
  nav.pedidos.length = 0;
  r = await motor.enviar(estado);
  v.verdade(r.ok);
  const ops = nav.pedidos[0].dados.operacoes;
  v.igual(ops.length, 1, "o contato foi anexado à operação da lead");
  v.igual(ops[0].contatos.length, 1);
  v.igual(motor.contar(estado), 0, "nada pendente");
  v.igual(motor.base().leads[0]._rev, 2);
});

teste("motor: duas pessoas, duas leads diferentes — sem conflito; a mesma lead — conflito localizado e conciliação", async () => {
  const { nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  const a1 = await motorCRM(aba);
  a1.estado.leads.push({ id: "l1", nome: "Um", etapa: "nao_responde", cadencia: "quente" }, { id: "l2", nome: "Dois", etapa: "nao_responde", cadencia: "quente" });
  await a1.motor.enviar(a1.estado);
  const outra = nav.novaAba();
  const a2 = await motorCRM(outra);
  a1.estado.leads[0].interesse = "Facial";
  a2.estado.leads[1].interesse = "Corporal";
  const p1 = await a1.motor.enviar(a1.estado);
  v.verdade(p1.ok, "primeira: " + JSON.stringify(p1));
  const p2 = await a2.motor.enviar(a2.estado);
  v.verdade(p2.ok, "entidades independentes não conflitam: " + JSON.stringify(p2));
  /* agora a mesma lead nos dois lados */
  a1.estado.leads[0].observacoes = "nota daqui";
  a2.estado.leads[0].etapa = "conversando";
  const p3 = await a1.motor.enviar(a1.estado);
  v.verdade(p3.ok, "terceira: " + JSON.stringify(p3));
  const r = await a2.motor.enviar(a2.estado);
  v.igual(r.conflitos.length, 1);
  v.igual(r.conflitos[0].id, "l1");
  const m = outra.sync.mesclar(a2.motor.base(), a2.estado, r.servidor, { listas: { leads: "id", contatos: "id" } });
  v.igual(m.conflitos.length, 0, "campos diferentes: concilia sozinho");
  a2.motor.adotarServidor(r.servidor);
  a2.estado = m.estado;
  const p4 = await a2.motor.enviar(a2.estado);
  v.verdade(p4.ok, "depois de conciliar: " + JSON.stringify(p4));
  const final = (await aba.rede.chamar("crm.ler", {}, { token: aba.sessao.token(), leitura: true })).dados.leads.find((l) => l.id === "l1");
  v.igual([final.observacoes, final.etapa, final.interesse], ["nota daqui", "conversando", "Facial"]);
});

teste("motor: resposta perdida — o reenvio leva os mesmos operacaoId e nada duplica", async () => {
  const { amb, nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  const { motor, estado } = await motorCRM(aba);
  estado.leads.push({ id: "l1", nome: "Um", etapa: "nao_responde", cadencia: "quente" });
  nav.modo = "perderResposta";
  const r1 = await motor.enviar(estado);
  v.verdade(!r1.ok && r1.transitorio);
  const id1 = nav.pedidos[nav.pedidos.length - 1].dados.operacoes[0].operacaoId;
  nav.modo = "normal";
  const r2 = await motor.enviar(estado);
  v.verdade(r2.ok);
  v.igual(nav.pedidos[nav.pedidos.length - 1].dados.operacoes[0].operacaoId, id1, "mesmo id");
  v.igual(amb.linhas("crm_leads").length, 1);
  v.igual(amb.linhas("sis_auditoria").filter((e) => e.acao === "criou").length, 1);
});

teste("motor: o que foi editado durante o envio continua pendente", async () => {
  const { nav, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  const { motor, estado } = await motorCRM(aba);
  estado.leads.push({ id: "l1", nome: "Um", etapa: "nao_responde", cadencia: "quente" });
  nav.segurando = true;
  const envio = motor.enviar(estado);
  await espera(5);
  estado.leads[0].interesse = "editado durante o envio";
  nav.soltar();
  nav.segurando = false;
  v.verdade((await envio).ok);
  v.igual(motor.contar(estado), 1, "a edição nova não foi engolida pela confirmação");
});

teste("motor: outra conta entrou nesta aba — nada é enviado em nome dela", async () => {
  const { aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  const { motor, estado } = await motorCRM(aba);
  await aba.sessao.entrar("caio", "segredo-caio");
  estado.leads.push({ id: "l1", nome: "Um", etapa: "nao_responde", cadencia: "quente" });
  const r = await motor.enviar(estado);
  v.verdade(r.contaTrocada);
});

teste("motor: sessão perdida no meio do trabalho preserva o que está na tela", async () => {
  const { amb, aba } = cenario();
  await aba.sessao.entrar("bia", "segredo-bia");
  const { motor, estado } = await motorCRM(aba);
  amb.pedir("sessao.sair", {}, aba.sessao.token());
  amb.sim.esquecerCache();
  estado.leads.push({ id: "l1", nome: "Um", etapa: "nao_responde", cadencia: "quente" });
  const r = await motor.enviar(estado);
  v.verdade(r.sessaoPerdida);
  v.igual(motor.contar(estado), 1, "a alteração continua pendente");
  await aba.sessao.entrar("bia", "segredo-bia");
  v.verdade((await motor.enviar(estado)).ok, "depois de entrar de novo, sobe");
});

module.exports = () => executar("Frontend");
if (require.main === module) module.exports().then((r) => process.exit(r.falhas ? 1 : 0));
