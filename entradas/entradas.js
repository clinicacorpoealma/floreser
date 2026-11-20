/* =====================================================================
   FloreSer · Corpo e Alma — comportamento das Entradas
   ---------------------------------------------------------------------
   As entradas do dia, as formas de pagamento, os períodos e filtros, a
   exportação, a importação, a Lixeira, a auditoria, a sincronização com
   a planilha e a conciliação de conflitos.

   A apresentação fica no entradas.css; a estrutura, no index.html.

   Depende dos compartilhados (compartilhado/: config, rede, sessao, auth,
   sync, dados, auditoria) — por isso entra depois deles, no fim do <body>,
   com o markup já montado.

   Desde a 4.0.0 a gravação não leva mais a lista inteira: o motor de
   dados (compartilhado/dados.js) manda só as entradas que mudaram, cada
   uma com a revisão de que partiu. Neste aparelho não fica entrada
   nenhuma — só a data do último backup, por conta.
   ===================================================================== */

(function () {
  "use strict";

  /* ==========================================================
     1. Constantes
     ========================================================== */
  const METODOS = [
    { id: "debito",   label: "Débito"    },
    { id: "credito",  label: "Crédito"   },
    { id: "pix",      label: "Pix"       },
    { id: "dinheiro", label: "Dinheiro"  },
    { id: "boleto",   label: "Boleto"    },
    { id: "haver",    label: "Em haver"  }
  ];
  const METODO_BY_ID = Object.fromEntries(METODOS.map(m => [m.id, m]));

  /* Sugestões iniciais de "O que é" — protocolos do Método FloreSer */
  const SERVICOS_BASE = [
    "Bioquântico FloreSer Facial", "Blefaro Peel FloreSer", "Botox",
    "Criofrequência Facial", "FloreSer Peel", "Gluco", "Harmony F",
    "Harmony P", "Harmony Colo", "Laser Soprano", "Limpeza Corpo e Alma",
    "Micropeeling FloreSer", "Revitalização Facial", "Ultraformer MTP",
    "Bioquântico FloreSer Corporal", "Combo de Tratamento", "Criofrequência",
    "Csizer", "Drenagem Linfática Corporal", "Harmony Mãos", "Harmony Pernas",
    "Harmony Pescoço e Colo", "Heccus Turbo", "Manta Térmica + Esfoliação",
    "Massagem Relaxante", "VelaShape 2", "Avaliação", "Pacote de sessões"
  ];

  const DOW_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  /* O endereço do Apps Script mora em compartilhado/config.js. */
  const CHAVE_BACKUP = "floreser.entradas.backupEm.";
  /* a 3.5.0 guardava aqui a lista inteira, com nomes e valores */
  const CHAVE_CACHE_ANTIGA = "floreser.entradas.copia";

  /* ==========================================================
     2. Utilidades
     ========================================================== */
  const $ = s => document.querySelector(s);
  const el = id => document.getElementById(id);

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }
  function uid() {
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* --- datas (sempre locais, nunca UTC) --- */
  function toISO(d) {
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function fromISO(s) {
    const [y, m, d] = String(s).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  const todayISO = () => toISO(new Date());
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }
  function endOfWeek(d) { return addDays(startOfWeek(d), 6); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* --- dinheiro (armazenado em centavos) --- */
  function fmtBRL(cents) {
    return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function fmtNum(cents) {
    return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtShort(cents) {
    const v = cents / 100;
    const opt = Number.isInteger(v) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
                                    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    return '<span class="d-cur">R$ </span>' + v.toLocaleString("pt-BR", opt);
  }
  function centsFromMasked(str) {
    const digits = String(str || "").replace(/\D/g, "");
    return digits ? parseInt(digits, 10) : 0;
  }
  function entryTotal(e) {
    return e.pagamentos.reduce((s, p) => s + p.valor, 0);
  }

  /* ==========================================================
     3. Estado e persistência
     ========================================================== */
  let state = { version: 1, updatedAt: 0, backupEm: "", entradas: [] };

  let period = "mes";                 // dia | semana | mes
  let view = "calendario";            // calendario | lista
  let anchor = new Date();            // data de referência do período
  let selectedDay = todayISO();
  let methodFilter = new Set();
  let query = "";
  let openDays = new Set();

  function sanitize(raw) {
    const out = {
      version: 1,
      updatedAt: Number(raw && raw.updatedAt) || 0,
      backupEm: (raw && typeof raw.backupEm === "string") ? raw.backupEm : "",
      entradas: []
    };
    const list = (raw && Array.isArray(raw.entradas)) ? raw.entradas : [];
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      const pags = (Array.isArray(r.pagamentos) ? r.pagamentos : [])
        .map(p => ({
          metodo: METODO_BY_ID[p && p.metodo] ? p.metodo : "pix",
          valor: Math.max(0, Math.round(Number(p && p.valor) || 0)),
          parcelas: Math.min(12, Math.max(1, Math.round(Number(p && p.parcelas) || 1)))
        }));
      if (!pags.length) continue;
      out.entradas.push({
        id: String(r.id || uid()),
        nome: String(r.nome || "").trim(),
        data: /^\d{4}-\d{2}-\d{2}$/.test(r.data) ? r.data : todayISO(),
        descricao: String(r.descricao || "").trim(),
        obs: String(r.obs || "").trim(),
        pagamentos: pags,
        criadoEm: String(r.criadoEm || new Date().toISOString()),
        /* de onde veio (manual, importação, Clinicorp): só leitura, nunca sobe */
        _origem: String(r.origem || r._origem || ""),
        _rev: Number(r._rev) || 0
      });
    }
    return out;
  }

  /* --- o que fica neste aparelho: só a data do último backup, por conta.
         Entradas (nomes e valores) nunca vão para o disco do navegador; a
         cópia inteira que a 3.5.0 guardava é apagada na primeira abertura. --- */
  function donoDaCopia() {
    const S = window.FloreSerSessao;
    if (!S) return "anonimo";
    return S.contaId() || (S.tokenDoModulo("entradas") ? "senha-modulo" : "anonimo");
  }
  function readLocal() {
    try { localStorage.removeItem(CHAVE_CACHE_ANTIGA); } catch (e) { }
    try {
      const b = localStorage.getItem(CHAVE_BACKUP + donoDaCopia());
      return b ? { backupEm: b } : null;
    } catch (e) { return null; }
  }
  function writeLocal() {
    try { if (state.backupEm) localStorage.setItem(CHAVE_BACKUP + donoDaCopia(), state.backupEm); return true; }
    catch (e) { return false; }
  }

  /* --- conversa com a planilha ---
     A sessão é do compartilhado/sessao.js: a conta, se houver; senão a
     senha compartilhada desta aba. Quem decide se vale é o servidor. */
  let origemSessao = "senhaModulo";

  /* Quem administra vê as somas, exporta e exclui; quem não administra
     registra e confere as entradas. O sinal vem do servidor a cada leitura
     — nunca do que está guardado neste navegador — e começa desligado. A
     trava de verdade também está lá: excluir é recusado pelo servidor para
     quem não administra, com ou sem botão na tela. */
  let podeAdministrar = false;

  function aplicarPermissoes() {
    document.body.classList.toggle("sem-admin", !podeAdministrar);
    if (!podeAdministrar) {
      el("summary").innerHTML = "";
      el("dist").innerHTML = "";
      const dlg = el("exportDialog");
      if (dlg && dlg.open) dlg.close();
    }
  }

  function tokenAtual() { return window.FloreSerSessao ? FloreSerSessao.tokenPara("entradas") : ""; }

  /* Leituras repetem sozinhas quando o Google tropeça; gravações são do
     motor, que repete com o mesmo operacaoId. */
  function ler(acao, dados) { return FloreSerRede.chamar(acao, dados || {}, { token: tokenAtual(), leitura: true }); }

  /* a resposta no formato antigo, achatada, que a auditoria entende */
  function achatar(r) {
    if (!r.ok) return { ok: false, erro: r.erro };
    const saida = { ok: true };
    Object.keys(r.dados || {}).forEach(k => { saida[k] = r.dados[k]; });
    return saida;
  }

  const motor = FloreSerDados.criarSincronizador({
    modulo: "entradas",
    acao: "entradas.aplicar",
    token: tokenAtual,
    colecoes: {
      entradas: {
        criar: "entrada.criar", alterar: "entrada.alterar", remover: "entrada.remover",
        campos: ["nome", "data", "descricao", "obs"],
        /* valor e forma de pagamento sobem juntos, inteiros, quando mudam */
        extras: (b, l) => FloreSerSync.iguais(b.pagamentos, l.pagamentos) ? null : { pagamentos: FloreSerSync.copiar(l.pagamentos) },
        extrasCriacao: l => ({ criadoEm: l.criadoEm, pagamentos: FloreSerSync.copiar(l.pagamentos) })
      }
    }
  });

  async function carregar() {
    const r = await ler("entradas.ler");
    if (!r.ok) { const e = new Error(r.erro.codigo); e.resposta = r; throw e; }
    podeAdministrar = r.dados.podeAdministrar === true;
    aplicarPermissoes();
    const copia = readLocal();
    state = sanitize(r.dados || {});
    /* o que acabou de chegar é o que o servidor tem */
    motor.definirBase({ entradas: FloreSerSync.copiar(state.entradas) });
    BASE_ENTRADAS = motor.base();
    /* a data do último backup é deste aparelho, não da planilha */
    if (copia && copia.backupEm) state.backupEm = copia.backupEm;
  }

  /* --- indicador de salvamento ---
     Os três módulos mostram o mesmo estado com as mesmas palavras: quem
     monta e mantém o texto é o sync.js. Aqui fica só a tradução dos nomes
     internos deste módulo para os de lá, e o data-state que a bolinha do
     CSS usa para mudar de cor. */
  const ESTADO_SINC = {
    idle: "carregando", dirty: "pendente", saving: "salvando", saved: "salvo",
    offline: "offline", error: "erro", conflito: "conflito", expirado: "expirado",
  };
  let statusSinc = null, estadoAtual = "idle";

  function setStatus(s) {
    const box = el("saveStatus");
    if (!box) return;
    estadoAtual = s;
    box.dataset.state = s;

    if (!statusSinc) {
      statusSinc = FloreSerSync.criarStatus(el("saveText"), {});
      ligarStatusClicavel();
    }
    const estado = ESTADO_SINC[s] || "salvo";
    if (estado === "salvo" && !statusSinc.salvoEm()) statusSinc.salvoAgora();
    else statusSinc.definir(estado);
  }

  function marcarSalvo() {
    const box = el("saveStatus");
    if (box) box.dataset.state = "saved";
    estadoAtual = "saved";
    if (!statusSinc) { setStatus("saved"); return; }
    statusSinc.salvoAgora();
  }

  /* Com conflito adiado, tocar no indicador traz a resolução de volta. */
  function ligarStatusClicavel() {
    const box = el("saveStatus");
    if (!box || box.dataset.clicavel) return;
    box.dataset.clicavel = "1";
    box.style.cursor = "pointer";
    box.setAttribute("role", "button");
    box.setAttribute("tabindex", "0");
    const abrir = () => {
      if (estadoAtual !== "conflito" || FloreSerSync.conflitoAberto()) return;
      if (!FloreSerSync.reabrirConflito()) {
        /* Sem nada guardado: uma gravação nova traz o conflito de volta.
           O contador de merges zera junto — ele trava vaivém automático,
           e este toque é uma pessoa decidindo tentar de novo. */
        tentativasDeMerge = 0;
        conflitoPendente = false; precisaSalvar = true; enviar();
      }
    };
    box.addEventListener("click", abrir);
    box.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); }
    });
  }

  /* A tela responde na hora e o envio vai logo atrás, juntando alterações
     seguidas. Se a internet cair, continua tentando sozinho. */
  let precisaSalvar = false, emVoo = false, travado = false, tentativa = 0, timerEnvio = null;

  /* A última versão que o servidor confirmou. Numa disputa é ela que separa
     o que foi mexido aqui do que foi mexido lá. Só na memória. */
  let BASE_ENTRADAS = null;
  let conflitoPendente = false, tentativasDeMerge = 0;

  const ESQUEMA_ENTRADAS = { listas: { entradas: "id" }, ignorar: ["backupEm", "updatedAt"] };
  const ROTULOS_ENTRADAS = {
    campos: { nome: "Nome", data: "Data", descricao: "Procedimento",
      obs: "Observação", pagamentos: "Formas de pagamento", criadoEm: "Registrada em" },
  };

  function touch() {
    state.updatedAt = Date.now();
    writeLocal();
    salvar();
  }

  function salvar() {
    if (travado) return;
    /* com conflito aberto o envio para: mandar o estado em disputa por cima
       seria justamente o que se quer evitar */
    if (conflitoPendente) { precisaSalvar = true; setStatus("conflito"); return; }
    precisaSalvar = true;
    setStatus(tentativa ? "offline" : "dirty");
    clearTimeout(timerEnvio);
    timerEnvio = setTimeout(enviar, 350);
  }

  function agendarEnvio(ms) { clearTimeout(timerEnvio); timerEnvio = setTimeout(enviar, ms); }

  /* "Salvo" só aparece quando o servidor confirmou e nada sobrou para
     mandar — inclusive o que foi editado enquanto esta rodada voava. */
  async function enviar() {
    if (travado || emVoo || !precisaSalvar || conflitoPendente) return;
    emVoo = true;
    precisaSalvar = false;
    setStatus("saving");
    let r;
    try { r = await motor.enviar({ entradas: FloreSerSync.copiar(state.entradas) }); }
    catch (e) { r = { ok: false, transitorio: true }; }
    emVoo = false;

    if (r.ok) {
      tentativa = 0; tentativasDeMerge = 0;
      adotarCorrecoes(r.corrigidas);
      BASE_ENTRADAS = motor.base();
      if (precisaSalvar || motor.contar({ entradas: state.entradas })) { precisaSalvar = true; setStatus("dirty"); agendarEnvio(200); }
      else marcarSalvo();
      return;
    }
    if (r.sessaoPerdida) { precisaSalvar = true; setStatus("expirado"); pedirLoginDeNovo(); return; }
    if (r.semAcesso) {
      travado = true; setStatus("expirado");
      toast("Seu acesso a este módulo foi retirado. O que está na tela continua aqui, mas não sobe mais.");
      return;
    }
    if (r.contaTrocada) {
      travado = true; setStatus("error");
      toast("Outra conta entrou neste navegador. Recarregue a página para continuar com ela.");
      return;
    }
    if (r.versao && !(r.erro && r.erro.codigo === "manutencao")) {
      travado = true; setStatus("error");
      toast("O site e o servidor estão em versões diferentes. Recarregue a página — o que está na tela fica até lá.");
      return;
    }
    if (r.erros && r.erros.length) tratarRecusas(r.erros);
    if (r.conflitos && r.conflitos.length) { BASE_ENTRADAS = motor.base(); conflito({ dados: r.servidor }); return; }
    if (r.transitorio || r.versao) {
      precisaSalvar = true;
      tentativa++;
      const semRede = !navigator.onLine || (r.erro && r.erro.codigo === "sem_conexao");
      setStatus(semRede ? "offline" : "error");
      agendarEnvio(Math.min(60000, 2000 * tentativa));
      if (tentativa === 1) {
        toast(r.erro && r.erro.codigo === "manutencao" ? "O sistema está em manutenção — vou tentar de novo sozinho."
          : semRede ? "Sem conexão com a planilha — vou tentar de novo." : "Não consegui salvar agora — vou tentar de novo.");
      }
      return;
    }
    setStatus("error");
  }

  /* O servidor normalizou alguma entrada: a tela adota, sem desfazer o que
     foi editado depois do envio. */
  function adotarCorrecoes(lista) {
    if (!lista || !lista.length) return;
    lista.forEach(c => {
      const i = state.entradas.findIndex(e => e.id === c.id);
      if (i >= 0) state.entradas[i] = FloreSerDados.adotarCorrecao(state.entradas[i], c.enviado, c.servidor);
    });
    render();
  }

  /* Recusas por entrada. A exclusão de quem não administra volta para a
     lista (o servidor guardou a entrada); o resto fica na tela com o aviso. */
  function tratarRecusas(erros) {
    let voltaram = 0;
    erros.forEach(e => {
      if (e.codigo === "sem_permissao" && e.remocao && e.entidadeNaBase) {
        if (!state.entradas.some(x => x.id === e.id)) { state.entradas.push(e.entidadeNaBase); voltaram++; }
        return;
      }
      if (e.codigo === "na_lixeira") {
        state.entradas = state.entradas.filter(x => x.id !== e.id);
        motor.esquecer("entradas", e.id);
        toast("Uma entrada foi para a lixeira em outro aparelho e saiu desta lista.");
        return;
      }
      toast("O servidor recusou uma alteração: " + (e.mensagem || e.codigo) + " As outras foram salvas.");
    });
    if (voltaram) toast("Só administradores podem excluir entradas." + (voltaram === 1 ? " A entrada voltou para a lista." : " As entradas voltaram para a lista."));
    render();
  }

  /* A sessão acabou no meio do trabalho. Pede a entrada de novo POR CIMA da
     tela; o que não foi salvo continua aqui e sobe depois. */
  let pedindoLogin = false;
  async function pedirLoginDeNovo() {
    if (pedindoLogin) return;
    pedindoLogin = true;
    const conta = origemSessao === "usuario" || FloreSerSessao.temConta();
    const ok = conta ? !!(await FloreSerAuth.pedirNovamente("entradas")) : await pedirSenhaDoModulo();
    pedindoLogin = false;
    if (ok) { travado = false; precisaSalvar = true; agendarEnvio(0); }
    else toast("Sem entrar de novo, o que está na tela não sobe para a planilha.");
  }

  /* O servidor recusou por revisão diferente e mandou o estado atual dele
     junto. Comparamos as três versões: o que só um lado mexeu entra sozinho,
     e só o que os dois mexeram vira pergunta. Nada recarrega, nada se perde. */
  function conflito(resposta) {
    const servidor = resposta && resposta.dados;
    if (!servidor) {
      conflitoPendente = true; setStatus("conflito");
      toast("Outro aparelho alterou as entradas. Recarregue para ver a versão mais recente.");
      return;
    }

    const local = { entradas: FloreSerSync.copiar(state.entradas) };
    const base = BASE_ENTRADAS || local;
    const m = FloreSerSync.mesclar(base, local, servidor, ESQUEMA_ENTRADAS);

    anotarSync("SYNC_CONFLITO_DETECTADO",
      m.conflitos.length + " campo(s) em disputa, " + m.automaticos.length + " conciliado(s) sozinho");

    if (!m.conflitos.length) {
      anotarSync("SYNC_CONFLITO_AUTO_MESCLADO", m.automaticos.length + " alteração(ões)");
      aplicarMerge(m.estado, servidor);
      return;
    }

    conflitoPendente = true;
    setStatus("conflito");
    FloreSerSync.abrirConflito({
      conflitos: m.conflitos, automaticos: m.automaticos, rotulos: ROTULOS_ENTRADAS,
      aviso: "As entradas foram alteradas em outro aparelho enquanto você trabalhava. " +
        "O que não se cruzou já foi juntado; escolha o que fica no que sobrou.",
      aoResolver: function (escolhas) {
        const fim = FloreSerSync.aplicarEscolhas(m.estado, m.conflitos, escolhas, ESQUEMA_ENTRADAS);
        anotarSync("SYNC_CONFLITO_RESOLVIDO_MANUAL",
          escolhas.filter(function (e) { return e === "local"; }).length +
          " de " + escolhas.length + " campo(s) ficaram com a versão deste aparelho");
        conflitoPendente = false;
        aplicarMerge(fim, servidor);
      },
      aoCancelar: function () {
        setStatus("conflito");
        toast('Conflito guardado. Toque em "Conflito de alterações", no topo, para resolver.');
      },
    });
  }

  /* Conciliado: o servidor sintético (a base com as fichas como estão lá)
     vira a base, e o que sobrou de diferença sobe com as revisões novas. */
  function aplicarMerge(estado, servidor) {
    state.entradas = Array.isArray(estado.entradas) ? estado.entradas : [];
    motor.adotarServidor(servidor);
    BASE_ENTRADAS = motor.base();
    render();
    renderBackupNote();
    updateExportPreview();

    tentativasDeMerge++;
    if (tentativasDeMerge > 4) {
      conflitoPendente = true; setStatus("conflito");
      toast("Os dados continuam sendo alterados por outra pessoa. Revise antes de salvar.");
      return;
    }

    conflitoPendente = false;
    precisaSalvar = true;
    setStatus("saving");
    /* fora da pilha do envio atual, que ainda está com emVoo ligado */
    clearTimeout(timerEnvio);
    timerEnvio = setTimeout(enviar, 0);
  }

  function anotarSync(evento, mensagem) {
    const r = window.FloreSerLogs && window.FloreSerLogs.registrar;
    if (r) r(evento, { mensagem: "entradas · " + mensagem });
  }

  /* ==========================================================
     4. Dados derivados
     ========================================================== */
  function periodRange() {
    if (period === "dia") return { start: new Date(anchor), end: new Date(anchor) };
    if (period === "semana") return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }
  function periodLabel() {
    const { start, end } = periodRange();
    if (period === "dia") {
      return capitalize(start.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })).replace(".", "");
    }
    if (period === "semana") {
      const sameMonth = start.getMonth() === end.getMonth();
      const a = start.toLocaleDateString("pt-BR", sameMonth ? { day: "2-digit" } : { day: "2-digit", month: "short" });
      const b = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      return (a + " – " + b).replace(/\./g, "");
    }
    return capitalize(start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  }
  function shiftPeriod(dir) {
    if (period === "dia") anchor = addDays(anchor, dir);
    else if (period === "semana") anchor = addDays(anchor, 7 * dir);
    else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  }

  function matchesFilters(e) {
    if (methodFilter.size) {
      if (!e.pagamentos.some(p => methodFilter.has(p.metodo))) return false;
    }
    if (query) {
      const q = norm(query);
      const hay = norm(e.nome + " " + e.descricao + " " + e.obs);
      if (!hay.includes(q)) return false;
    }
    return true;
  }
  function entriesInRange(startISO, endISO) {
    return state.entradas
      .filter(e => e.data >= startISO && e.data <= endISO && matchesFilters(e))
      .sort((a, b) => (a.data === b.data ? (a.criadoEm < b.criadoEm ? -1 : 1) : (a.data < b.data ? 1 : -1)));
  }
  function periodEntries() {
    const { start, end } = periodRange();
    return entriesInRange(toISO(start), toISO(end));
  }
  function groupByDay(list) {
    const map = new Map();
    for (const e of list) {
      if (!map.has(e.data)) map.set(e.data, []);
      map.get(e.data).push(e);
    }
    return map;
  }

  /* nomes já usados — canônico por forma normalizada, mais recente vence */
  function nameIndex() {
    const map = new Map();
    const ordered = state.entradas.slice().sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : 1));
    for (const e of ordered) {
      const n = norm(e.nome);
      if (!n) continue;
      const prev = map.get(n);
      map.set(n, { label: e.nome, count: (prev ? prev.count : 0) + 1 });
    }
    return map;
  }
  function nameSuggestions() {
    return Array.from(nameIndex().values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
      .map(v => v.label);
  }
  function descSuggestions() {
    const seen = new Map();
    for (const s of SERVICOS_BASE) seen.set(norm(s), s);
    for (const e of state.entradas) {
      if (e.descricao) seen.set(norm(e.descricao), e.descricao);
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }
  function canonicalName(input) {
    const found = nameIndex().get(norm(input));
    return found ? found.label : String(input || "").trim();
  }

  /* ==========================================================
     5. Renderização
     ========================================================== */
  function renderSummary(list) {
    if (!podeAdministrar) { el("summary").innerHTML = ""; return; }
    const total = list.reduce((s, e) => s + entryTotal(e), 0);
    let haver = 0;
    for (const e of list) for (const p of e.pagamentos) if (p.metodo === "haver") haver += p.valor;
    const recebido = total - haver;
    const count = list.length;
    const ticket = count ? Math.round(total / count) : 0;

    el("summary").innerHTML = `
      <div class="stat is-accent">
        <span class="stat-label">Total do período</span>
        <span class="stat-value num"><small>R$</small>${esc(fmtNum(total))}</span>
        <span class="stat-note">${periodLabel()}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Recebido</span>
        <span class="stat-value num"><small>R$</small>${esc(fmtNum(recebido))}</span>
        <span class="stat-note">${total ? Math.round(recebido / total * 100) : 0}% do total</span>
      </div>
      <div class="stat is-haver">
        <span class="stat-label">Em haver</span>
        <span class="stat-value num"><small>R$</small>${esc(fmtNum(haver))}</span>
        <span class="stat-note">${haver ? "a receber" : "nada pendente"}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Entradas</span>
        <span class="stat-value num">${count}</span>
        <span class="stat-note">${count ? "ticket médio " + esc(fmtBRL(ticket)) : "nenhuma no período"}</span>
      </div>`;
  }

  function renderDist(list) {
    if (!podeAdministrar) { el("dist").innerHTML = ""; return; }
    const totals = {};
    let grand = 0;
    for (const e of list) for (const p of e.pagamentos) {
      totals[p.metodo] = (totals[p.metodo] || 0) + p.valor;
      grand += p.valor;
    }
    const rows = METODOS.map(m => ({ m, v: totals[m.id] || 0 })).filter(r => r.v > 0)
      .sort((a, b) => b.v - a.v);

    if (!grand) {
      el("dist").innerHTML = `<div class="dist-head"><span class="dist-title">Por forma de pagamento</span></div>
        <p class="dist-empty">Sem movimentos neste período.</p>`;
      return;
    }
    el("dist").innerHTML = `
      <div class="dist-head">
        <span class="dist-title">Por forma de pagamento</span>
        <span class="dist-item"><b class="num">${esc(fmtBRL(grand))}</b></span>
      </div>
      <div class="dist-bar">
        ${rows.map(r => `<span class="dist-seg" style="width:${(r.v / grand * 100).toFixed(2)}%;background:var(--m-${r.m.id}-dot)" title="${esc(r.m.label)}"></span>`).join("")}
      </div>
      <div class="dist-legend">
        ${rows.map(r => `<span class="dist-item"><i class="sw" style="background:var(--m-${r.m.id}-dot)"></i>${esc(r.m.label)} <b class="num">${esc(fmtBRL(r.v))}</b></span>`).join("")}
      </div>`;
  }

  function methodDots(e) {
    const ids = [];
    for (const p of e.pagamentos) if (!ids.includes(p.metodo)) ids.push(p.metodo);
    return ids.map(id => `<i style="background:var(--m-${id}-dot)"></i>`).join("");
  }

  function renderCalendar(byDay) {
    const { start, end } = periodRange();
    let days = [];
    let gridClass = "";
    if (period === "mes") {
      let d = startOfWeek(start);
      const last = endOfWeek(end);
      while (d <= last) { days.push(new Date(d)); d = addDays(d, 1); }
    } else if (period === "semana") {
      gridClass = " is-week";
      for (let i = 0; i < 7; i++) days.push(addDays(start, i));
    } else {
      gridClass = " is-day";
      days.push(new Date(start));
    }

    const monthIdx = start.getMonth();
    const today = todayISO();
    const cells = days.map(d => {
      const iso = toISO(d);
      const list = byDay.get(iso) || [];
      const total = list.reduce((s, e) => s + entryTotal(e), 0);
      const out = period === "mes" && d.getMonth() !== monthIdx;
      const cls = ["day"];
      if (out) cls.push("is-out");
      if (!list.length) cls.push("is-empty");
      if (iso === today) cls.push("is-today");
      if (iso === selectedDay) cls.push("is-selected");
      if (period === "dia") cls.push("is-day-view");
      const resumoDoDia = !list.length ? ", sem entradas"
        : podeAdministrar ? ", " + fmtBRL(total)
          : ", " + list.length + (list.length === 1 ? " entrada" : " entradas");
      return `<button type="button" class="${cls.join(" ")}" data-day="${iso}" aria-label="${esc(d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }))}${resumoDoDia}">
        <span class="d-num num">${d.getDate()}</span>
        ${list.length ? `<span class="d-dots">${methodDots({ pagamentos: list.flatMap(e => e.pagamentos) })}</span>` : ""}
        ${list.length && podeAdministrar ? `<span class="d-total num">${fmtShort(total)}</span>` : ""}
        ${list.length ? `<span class="d-count">${list.length} ${list.length === 1 ? "entrada" : "entradas"}</span>` : ""}
      </button>`;
    }).join("");

    const dow = period === "dia" ? "" :
      `<div class="cal-dow">${DOW_SHORT.map(x => `<span>${x}</span>`).join("")}</div>`;

    el("board").innerHTML = `<div class="cal">${dow}<div class="cal-grid${gridClass}">${cells}</div></div>`;
  }

  function payChip(p) {
    const m = METODO_BY_ID[p.metodo];
    return `<span class="chip" style="background:var(--m-${m.id}-bg);color:var(--m-${m.id}-fg)">
      <i class="sw"></i>${esc(m.label)}${p.parcelas > 1 ? ` <span class="chip-parc">${p.parcelas}x</span>` : ""}
      <span class="num" style="font-weight:600">${esc(fmtBRL(p.valor))}</span></span>`;
  }

  function entryHtml(e) {
    return `<article class="entry" data-id="${esc(e.id)}">
      <div class="entry-main">
        <div class="entry-top">
          <span class="entry-name">${esc(e.nome || "Sem nome")}</span>
          <span class="entry-value num">${esc(fmtBRL(entryTotal(e)))}</span>
        </div>
        ${e.descricao ? `<div class="entry-desc">${esc(e.descricao)}</div>` : ""}
        <div class="entry-pays">${e.pagamentos.map(payChip).join("")}</div>
        ${e.obs ? `<p class="entry-obs">${esc(e.obs)}</p>` : ""}
      </div>
      <div class="entry-actions">
        <button type="button" class="icon-btn" data-edit="${esc(e.id)}" title="Editar" aria-label="Editar entrada de ${esc(e.nome)}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.2 2.8 13.2 4.8 5.6 12.4 3 13l.6-2.6 7.6-7.6Z"/></svg>
        </button>
        ${podeAdministrar ? `<button type="button" class="icon-btn is-danger" data-del="${esc(e.id)}" title="Mover para a lixeira" aria-label="Excluir entrada de ${esc(e.nome)}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8"/></svg>
        </button>` : ""}
      </div>
    </article>`;
  }

  function dayCardHtml(iso, list, open) {
    const d = fromISO(iso);
    const total = list.reduce((s, e) => s + entryTotal(e), 0);
    return `<section class="day-card${open ? " is-open" : ""}" data-card="${iso}">
      <button type="button" class="day-card-head" data-toggle="${iso}" aria-expanded="${open}">
        <span class="dch-date">
          <span class="dch-day num">${d.getDate()} ${esc(d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""))}</span>
          <span class="dch-dow">${esc(d.toLocaleDateString("pt-BR", { weekday: "long" }))}</span>
        </span>
        <span class="dch-meta">
          <span class="dch-count">${list.length} ${list.length === 1 ? "entrada" : "entradas"}</span>
          ${podeAdministrar ? `<span class="dch-total num">${esc(fmtBRL(total))}</span>` : ""}
          <svg class="dch-caret" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 6 5 5 5-5"/></svg>
        </span>
      </button>
      <div class="day-card-body">${list.map(entryHtml).join("")}</div>
    </section>`;
  }

  function emptyHtml(title, msg) {
    return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(msg)}</p></div>`;
  }

  function renderPanel(byDay) {
    const panel = el("dayPanel");
    if (view === "calendario") {
      const list = byDay.get(selectedDay);
      if (!list || !list.length) {
        const d = fromISO(selectedDay);
        panel.innerHTML = emptyHtml(
          capitalize(d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })),
          "Nenhuma entrada neste dia. Clique em outro quadradinho do calendário ou registre uma nova entrada."
        );
      } else {
        panel.innerHTML = dayCardHtml(selectedDay, list, true);
      }
      return;
    }
    const isos = Array.from(byDay.keys()).sort().reverse();
    if (!isos.length) {
      panel.innerHTML = emptyHtml("Nada por aqui", "Nenhuma entrada no período com os filtros atuais.");
      return;
    }
    if (!openDays.size) openDays.add(isos[0]);
    panel.innerHTML = isos.map(iso => dayCardHtml(iso, byDay.get(iso), openDays.has(iso))).join("");
  }

  function renderMethodFilter() {
    el("methodFilter").innerHTML =
      `<span class="fl-label">Forma de pagamento</span>` +
      METODOS.map(m => `<button type="button" class="fchip" data-method="${m.id}" aria-pressed="${methodFilter.has(m.id)}">
        <i class="sw" style="background:var(--m-${m.id}-dot)"></i>${esc(m.label)}</button>`).join("") +
      (methodFilter.size ? `<button type="button" class="fchip-clear" id="clearMethods">limpar</button>` : "");
  }

  function render() {
    el("periodLabel").textContent = periodLabel();
    for (const b of el("periodSeg").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b.dataset.period === period));
    }
    for (const b of el("viewSeg").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
    }
    const list = periodEntries();
    const byDay = groupByDay(list);
    renderSummary(list);
    renderDist(list);
    renderMethodFilter();
    if (view === "calendario") {
      const { start, end } = periodRange();
      if (selectedDay < toISO(start) || selectedDay > toISO(end)) {
        const withEntries = Array.from(byDay.keys()).sort().reverse();
        selectedDay = withEntries[0] || toISO(period === "mes" && anchor.getMonth() === new Date().getMonth() ? new Date() : start);
      }
      renderCalendar(byDay);
    } else {
      el("board").innerHTML = "";
    }
    renderPanel(byDay);
  }

  /* ==========================================================
     6. Toast
     ========================================================== */
  let toastTimer = null;
  function toast(msg, actionLabel, action) {
    const t = el("toast");
    t.innerHTML = esc(msg) + (actionLabel
      ? ` <button type="button" id="toastAct" style="color:inherit;text-decoration:underline;text-underline-offset:3px;margin-left:8px;font-weight:600">${esc(actionLabel)}</button>`
      : "");
    t.classList.add("is-on");
    if (actionLabel) {
      el("toastAct").addEventListener("click", () => {
        t.classList.remove("is-on");
        if (action) action();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), actionLabel ? 6000 : 2600);
  }

  /* ==========================================================
     7. Autocomplete
     ========================================================== */
  function attachAutocomplete(input, listEl, getItems, hint) {
    let items = [], active = -1;

    function close() { listEl.classList.remove("is-open"); listEl.innerHTML = ""; active = -1; items = []; }

    function open() {
      if (input.dataset.noac === "1") { input.dataset.noac = ""; return; }
      const q = norm(input.value);
      const all = getItems();
      let matched;
      if (!q) {
        matched = all.slice(0, 8);
      } else {
        const starts = all.filter(s => norm(s).startsWith(q));
        const contains = all.filter(s => !norm(s).startsWith(q) && norm(s).includes(q));
        matched = starts.concat(contains).slice(0, 8);
        if (matched.length === 1 && norm(matched[0]) === q) { close(); return; }
      }
      if (!matched.length) { close(); return; }
      items = matched;
      active = -1;
      listEl.innerHTML = (hint ? `<div class="ac-hint">${esc(hint)}</div>` : "") + matched.map((s, i) => {
        const n = norm(s), pos = q ? n.indexOf(q) : -1;
        const label = pos >= 0
          ? esc(s.slice(0, pos)) + "<b>" + esc(s.slice(pos, pos + q.length)) + "</b>" + esc(s.slice(pos + q.length))
          : esc(s);
        return `<button type="button" class="ac-item" role="option" data-i="${i}">${label}</button>`;
      }).join("");
      listEl.classList.add("is-open");
    }

    function choose(i) {
      if (items[i] == null) return;
      input.value = items[i];
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      input.focus();
    }

    function paint() {
      listEl.querySelectorAll(".ac-item").forEach((n, i) => n.classList.toggle("is-active", i === active));
    }

    input.addEventListener("input", open);
    input.addEventListener("focus", open);
    input.addEventListener("blur", () => setTimeout(close, 140));
    input.addEventListener("keydown", ev => {
      if (!listEl.classList.contains("is-open")) {
        if (ev.key === "ArrowDown") { open(); ev.preventDefault(); }
        return;
      }
      if (ev.key === "ArrowDown") { active = (active + 1) % items.length; paint(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; paint(); ev.preventDefault(); }
      else if (ev.key === "Enter") { if (active >= 0) { choose(active); ev.preventDefault(); } }
      else if (ev.key === "Escape") { close(); ev.stopPropagation(); }
    });
    listEl.addEventListener("mousedown", ev => {
      const b = ev.target.closest(".ac-item");
      if (!b) return;
      ev.preventDefault();
      choose(Number(b.dataset.i));
    });
  }

  /* ==========================================================
     8. Diálogo de entrada
     ========================================================== */
  const entryDialog = el("entryDialog");
  let editingId = null;
  let splitMode = false;

  function payRowHtml(p) {
    const parcelas = Array.from({ length: 12 }, (_, i) => i + 1)
      .map(n => `<option value="${n}"${p.parcelas === n ? " selected" : ""}>${n === 1 ? "À vista" : n + "x"}</option>`).join("");
    return `<div class="pay-row${splitMode ? " is-split" : ""}">
      <select class="input pay-metodo" aria-label="Forma de pagamento">
        ${METODOS.map(m => `<option value="${m.id}"${p.metodo === m.id ? " selected" : ""}>${esc(m.label)}</option>`).join("")}
      </select>
      <select class="input pay-parcelas" aria-label="Parcelas">${parcelas}</select>
      <div class="money-wrap pay-valor">
        <span class="cur">R$</span>
        <input class="input pay-valor-input" inputmode="numeric" value="${p.valor ? esc(fmtNum(p.valor)) : ""}" placeholder="0,00" aria-label="Valor desta forma">
      </div>
      <button type="button" class="icon-btn is-danger pay-del" aria-label="Remover forma de pagamento">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>
      </button>
    </div>`;
  }

  function readPays() {
    return Array.from(el("paysList").querySelectorAll(".pay-row")).map(row => ({
      metodo: row.querySelector(".pay-metodo").value,
      parcelas: Number(row.querySelector(".pay-parcelas").value) || 1,
      valor: centsFromMasked(row.querySelector(".pay-valor-input").value)
    }));
  }

  function syncPays() {
    const rows = Array.from(el("paysList").querySelectorAll(".pay-row"));
    splitMode = rows.length > 1;
    rows.forEach(r => r.classList.toggle("is-split", splitMode));
    const valorInput = el("fValor");
    if (splitMode) {
      const sum = readPays().reduce((s, p) => s + p.valor, 0);
      valorInput.value = sum ? fmtNum(sum) : "";
      valorInput.readOnly = true;
      el("paysSum").textContent = "Total somado: " + fmtBRL(sum);
      el("labelValor").textContent = "Valor total (somado)";
      el("paysSum").classList.remove("is-off");
      el("btnAddPay").textContent = "+ Adicionar outra forma";
    } else {
      valorInput.readOnly = false;
      el("labelValor").textContent = "Valor";
      el("paysSum").textContent = "";
      el("btnAddPay").textContent = "+ Dividir em mais formas";
    }
  }

  function setPays(pags) {
    splitMode = pags.length > 1;
    el("paysList").innerHTML = pags.map(payRowHtml).join("");
    syncPays();
  }

  function openEntryDialog(entry) {
    editingId = entry ? entry.id : null;
    el("entryTitle").textContent = entry ? "Editar entrada" : "Nova entrada";
    el("btnSave").textContent = entry ? "Salvar alterações" : "Salvar entrada";
    el("btnDelete").style.display = entry && podeAdministrar ? "" : "none";
    el("btnDelete").disabled = false;
    el("confDelete").hidden = true;
    el("fMotivoLixeira").value = "";

    el("fNome").value = entry ? entry.nome : "";
    el("fValor").value = entry ? fmtNum(entryTotal(entry)) : "";
    el("fData").value = entry ? entry.data : (selectedDay || todayISO());
    el("fDesc").value = entry ? entry.descricao : "";
    el("fObs").value = entry ? entry.obs : "";
    setPays(entry ? entry.pagamentos.map(p => Object.assign({}, p)) : [{ metodo: "pix", parcelas: 1, valor: 0 }]);

    entryDialog.showModal();
    el("fNome").dataset.noac = "1";
    el("fNome").focus();
  }

  /* Abrir uma entrada pela busca não é editar. Esta tela mostra o que
     está guardado e o histórico de alterações — e não grava nada por ter
     sido aberta. Para mudar alguma coisa, o editor de sempre. */
  const detalheDialog = el("detalheDialog");
  let auditoriaMontada = null;

  function abrirDetalhe(id) {
    const e = (state.entradas || []).find(x => x.id === id);
    if (!e) return;

    const total = (e.pagamentos || []).reduce((t, p) => t + (Number(p.valor) || 0), 0);
    const formas = (e.pagamentos || []).map(p => {
      const m = METODO_BY_ID[p.metodo];
      const parc = Number(p.parcelas) || 1;
      return (m ? m.label : p.metodo) + (parc > 1 ? " " + parc + "x" : "") +
        " · " + fmtBRL(p.valor);
    }).join("<br>");

    el("detalheTitle").textContent = e.nome || "Entrada";
    el("detalheCorpo").innerHTML =
      '<div class="det-linha"><span class="det-rot">Data</span>' +
      '<span class="det-val">' + esc(fmtDataLonga(e.data)) + "</span></div>" +
      '<div class="det-linha"><span class="det-rot">Procedimento</span>' +
      '<span class="det-val">' + esc(e.descricao || "—") + "</span></div>" +
      '<div class="det-linha"><span class="det-rot">Valor</span>' +
      '<span class="det-val num">' + fmtBRL(total) + "</span></div>" +
      '<div class="det-linha"><span class="det-rot">Pagamento</span>' +
      '<span class="det-val">' + (formas || "—") + "</span></div>" +
      (e.obs ? '<div class="det-linha"><span class="det-rot">Observação</span>' +
        '<span class="det-val">' + esc(e.obs) + "</span></div>" : "") +
      (e._origem && e._origem !== "manual" ? '<div class="det-linha"><span class="det-rot">Origem</span>' +
        '<span class="det-val">' + esc({ importacao: "Importada de planilha", clinicorp: "Recebimento do Clinicorp" }[e._origem] || e._origem) + "</span></div>" : "") +
      '<div class="det-sec"><div class="det-sec-nome">Histórico de alterações</div>' +
      '<div id="detalheHistorico"></div></div>';

    /* contexto do Clinicorp (só leitura; a conciliação é no painel) */
    const blocoInt = window.FloreSerIntegracao ? FloreSerIntegracao.bloco("entradas", id) : null;
    if (blocoInt) el("detalheCorpo").insertBefore(blocoInt, el("detalheCorpo").querySelector(".det-sec"));

    if (detalheDialog.showModal) detalheDialog.showModal();
    else detalheDialog.setAttribute("open", "");

    if (window.FloreSerAuditoria) {
      auditoriaMontada = FloreSerAuditoria.montar(el("detalheHistorico"), {
        modulo: "entradas", entidade: "entrada", entidadeId: id,
        api: corpo => ler("auditoria.listar", { modulo: corpo.modulo, entidade: corpo.entidade,
          entidadeId: corpo.entidadeId, inicio: corpo.inicio, quantos: corpo.quantos }).then(achatar),
      });
    }
  }

  function fmtDataLonga(iso) {
    const p = String(iso || "").split("-");
    if (p.length !== 3) return iso || "—";
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return capitalize(d.toLocaleDateString("pt-BR",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  }

  function pedidoDaBarra(chave) {
    try {
      const v = new URLSearchParams(location.search).get(chave);
      return v ? String(v) : "";
    } catch (e) { return ""; }
  }

  function limparBarra() {
    /* sem isto, todo recarregamento reabriria a mesma ficha */
    try { history.replaceState(null, "", location.pathname); } catch (e) { }
  }

  function abrirEntradaPedida() {
    const id = pedidoDaBarra("entrada");
    if (!id) return;
    limparBarra();
    const e = (state.entradas || []).find(x => x.id === id);
    if (!e) { toast("A entrada deste link não existe mais."); return; }
    selectedDay = e.data;
    openDays.add(e.data);
    render();
    abrirDetalhe(id);
  }

  function submitEntry(ev) {
    ev.preventDefault();
    const nome = canonicalName(el("fNome").value);
    if (!nome) { el("fNome").focus(); return; }
    const data = el("fData").value || todayISO();
    let pags = readPays().filter(p => p.metodo);
    const total = centsFromMasked(el("fValor").value);

    if (pags.length <= 1) {
      pags = [{ metodo: pags[0] ? pags[0].metodo : "pix", parcelas: pags[0] ? pags[0].parcelas : 1, valor: total }];
    } else {
      pags = pags.filter(p => p.valor > 0);
      if (!pags.length) pags = [{ metodo: "pix", parcelas: 1, valor: total }];
    }
    if (pags.reduce((s, p) => s + p.valor, 0) <= 0) {
      el("fValor").focus();
      toast("Informe um valor maior que zero.");
      return;
    }

    const payload = {
      nome: nome,
      data: data,
      descricao: el("fDesc").value.trim(),
      obs: el("fObs").value.trim(),
      pagamentos: pags
    };

    conferirEntradaRepetida(payload, editingId, () => {
      if (editingId) {
        const i = state.entradas.findIndex(e => e.id === editingId);
        if (i >= 0) state.entradas[i] = Object.assign({}, state.entradas[i], payload);
        toast("Entrada atualizada.");
      } else {
        state.entradas.push(Object.assign({ id: uid(), criadoEm: new Date().toISOString() }, payload));
        toast("Entrada registrada.");
      }
      touch();
      selectedDay = data;
      openDays.add(data);
      entryDialog.close();
      render();
    });
  }

  /* Aqui a régua é bem mais alta que no CRM. A mesma pessoa faz o mesmo
     procedimento pelo mesmo preço todo mês, e duas sessões no mesmo dia
     acontecem. Só o conjunto inteiro — dia, nome, procedimento e valor —
     é indício de lançamento duplicado; nome igual sozinho não é nada. */
  function conferirEntradaRepetida(payload, id, seguir) {
    const soma = e => (e.pagamentos || []).reduce((t, p) => t + (Number(p.valor) || 0), 0);
    const candidato = {
      data: payload.data, nome: payload.nome,
      descricao: payload.descricao, total: soma(payload),
    };
    /* sem procedimento escrito, o conjunto deixa de ser forte o bastante */
    if (!candidato.descricao) { seguir(); return; }

    const comparaveis = state.entradas.map(e => ({
      id: e.id, data: e.data, nome: e.nome, descricao: e.descricao, total: soma(e),
    }));

    const achados = FloreSerSync.procurarRepetidos(candidato, comparaveis, {
      id: "id",
      ignorarId: id,
      criterios: [{
        forca: "forte", texto: "mesmo dia, nome, procedimento e valor",
        campos: [
          { campo: "data", como: "data" },
          { campo: "nome", como: "nome" },
          { campo: "descricao", como: "nome" },
          { campo: "total", como: "numero" },
        ],
      }],
    });
    if (!achados.length) { seguir(); return; }

    anotarSync("REPETIDO_AVISADO", achados.length + " entrada(s) idêntica(s) no mesmo dia");

    FloreSerSync.avisarRepetido({
      achados: achados,
      coisa: "lançamento", coisaPlural: "lançamentos",
      titulo: "Esta entrada já foi lançada",
      aviso: "Existe um lançamento igual em tudo — dia, nome, procedimento e valor. " +
        "Confira se não é o mesmo atendimento registrado duas vezes.",
      textoSeguir: id ? "Salvar mesmo assim" : "Registrar mesmo assim",
      rotulo: e => e.nome || "(sem nome)",
      detalhe: e => (e.data || "").split("-").reverse().join("/") + " · " +
        (e.descricao || "sem procedimento") + " · " + fmtBRL(e.total),
      aoSeguir: () => { anotarSync("REPETIDO_SEGUIU", "a pessoa optou por registrar assim mesmo"); seguir(); },
      aoCancelar: () => { },
    });
  }

  /* Mover para a lixeira é operação do servidor: ele tira a entrada e as
     formas de pagamento das abas, guarda tudo e devolve a revisão nova. Aqui
     só refletimos o que ele já fez — nada é reenviado, para o registro não
     voltar sozinho na próxima gravação. */
  async function deleteEntry(id, motivo) {
    if (!podeAdministrar) { toast("Só administradores podem excluir entradas."); return; }
    const i = state.entradas.findIndex(e => e.id === id);
    if (i < 0) return;
    const alvo = state.entradas[i];

    try {
      /* o mesmo operacaoId nas repetições: mover duas vezes não guarda duas */
      const r = await FloreSerRede.chamar("lixeira.mover",
        { tipo: "entradas", id: id, motivo: motivo || "", operacaoId: FloreSerRede.novoId("lx-") },
        { token: tokenAtual(), tentativas: 2, repetirIncerto: true });
      if (!r.ok) {
        toast(r.erro.codigo === "sem_acesso" ? "Você não possui acesso a este módulo."
          : r.erro.codigo === "sem_permissao" ? "Só administradores podem excluir entradas."
            : FloreSerAuth.recado(r));
        return;
      }
      motor.esquecer("entradas", id);
      BASE_ENTRADAS = motor.base();
      state.entradas = state.entradas.filter(e => e.id !== id);
      render();
      renderBackupNote();
      updateExportPreview();
      toast("Entrada de " + alvo.nome + " foi movida para a lixeira.");
    } catch (e) {
      toast("Não foi possível concluir a operação. Tente novamente.");
    }
  }

  /* ==========================================================
     9. Exportação CSV
     ========================================================== */
  const exportDialog = el("exportDialog");

  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(fromISOStr, toISOStr) {
    const list = state.entradas
      .filter(e => e.data >= fromISOStr && e.data <= toISOStr)
      .sort((a, b) => (a.data === b.data ? (a.criadoEm < b.criadoEm ? -1 : 1) : (a.data < b.data ? -1 : 1)));

    const head = ["Data", "Nome", "O que é", "Valor total", "Formas de pagamento", "Parcelas"]
      .concat(METODOS.map(m => m.label))
      .concat(["Observação"]);

    const lines = [head.map(csvCell).join(";")];
    const totals = {};
    let grand = 0;

    for (const e of list) {
      const t = entryTotal(e);
      grand += t;
      const porMetodo = {};
      for (const p of e.pagamentos) {
        porMetodo[p.metodo] = (porMetodo[p.metodo] || 0) + p.valor;
        totals[p.metodo] = (totals[p.metodo] || 0) + p.valor;
      }
      const formas = e.pagamentos
        .map(p => METODO_BY_ID[p.metodo].label + (p.parcelas > 1 ? " " + p.parcelas + "x" : "") + " R$ " + fmtNum(p.valor))
        .join(" + ");
      const parcelas = e.pagamentos.map(p => p.parcelas + "x").join(" + ");
      const row = [
        e.data.split("-").reverse().join("/"),
        e.nome, e.descricao, fmtNum(t), formas, parcelas
      ].concat(METODOS.map(m => (porMetodo[m.id] ? fmtNum(porMetodo[m.id]) : "")))
       .concat([e.obs]);
      lines.push(row.map(csvCell).join(";"));
    }

    const totalRow = ["TOTAL", "", "", fmtNum(grand), "", ""]
      .concat(METODOS.map(m => (totals[m.id] ? fmtNum(totals[m.id]) : "")))
      .concat([list.length + (list.length === 1 ? " entrada" : " entradas")]);
    lines.push("");
    lines.push(totalRow.map(csvCell).join(";"));

    return { csv: "\uFEFF" + lines.join("\r\n"), count: list.length, total: grand };
  }

  function updateExportPreview() {
    const de = el("expDe").value, ate = el("expAte").value;
    if (!de || !ate || de > ate) {
      el("exportPreview").innerHTML = `<span class="ep-note">Escolha um intervalo válido — a data inicial precisa vir antes da final.</span>`;
      el("btnDownloadCsv").disabled = true;
      el("btnCopyCsv").disabled = true;
      return;
    }
    const r = buildCsv(de, ate);
    el("exportPreview").innerHTML =
      `<span class="ep-total num">${esc(fmtBRL(r.total))}</span>
       <span class="ep-note">${r.count} ${r.count === 1 ? "entrada" : "entradas"} de ${esc(de.split("-").reverse().join("/"))} a ${esc(ate.split("-").reverse().join("/"))}</span>`;
    el("btnDownloadCsv").disabled = r.count === 0;
    el("btnCopyCsv").disabled = r.count === 0;
  }

  function applyPreset(kind) {
    const now = new Date();
    let a, b;
    if (kind === "periodo") { const r = periodRange(); a = r.start; b = r.end; }
    else if (kind === "mes") { a = startOfMonth(now); b = endOfMonth(now); }
    else if (kind === "mespassado") {
      const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      a = startOfMonth(p); b = endOfMonth(p);
    }
    else if (kind === "ano") { a = new Date(now.getFullYear(), 0, 1); b = new Date(now.getFullYear(), 11, 31); }
    else {
      const datas = state.entradas.map(e => e.data).sort();
      a = datas.length ? fromISO(datas[0]) : startOfMonth(now);
      b = datas.length ? fromISO(datas[datas.length - 1]) : endOfMonth(now);
    }
    el("expDe").value = toISO(a);
    el("expAte").value = toISO(b);
    updateExportPreview();
  }

  function triggerDownload(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime + ";charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      return true;
    } catch (e) { return false; }
  }

  function renderBackupNote() {
    const n = state.entradas.length;
    const last = state.backupEm ? new Date(state.backupEm) : null;
    el("backupNote").textContent =
      "As entradas ficam na planilha do Google, então elas não dependem deste aparelho. " +
      "O backup é uma cópia extra das " + n + (n === 1 ? " entrada" : " entradas") +
      " num arquivo .json — serve para guardar fora do Google ou para trazer entradas de outro lugar." +
      (last ? " Último backup: " + last.toLocaleDateString("pt-BR") + "." : "");
  }

  function baixarBackup() {
    if (!podeAdministrar) return;
    const ok = triggerDownload(
      "backup_entradas_" + todayISO() + ".json",
      JSON.stringify(state, null, 2),
      "application/json"
    );
    if (!ok) { toast("Não foi possível gerar o backup neste navegador."); return; }
    state.backupEm = new Date().toISOString();
    writeLocal();
    renderBackupNote();
    toast("Backup baixado.");
  }

  function restaurarBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let dados;
      try { dados = sanitize(JSON.parse(String(reader.result))); }
      catch (e) { toast("Arquivo inválido — escolha um backup .json gerado aqui."); return; }
      if (!dados.entradas.length) { toast("Esse backup não tem nenhuma entrada."); return; }
      const existentes = new Set(state.entradas.map(e => e.id));
      let novas = 0;
      for (const e of dados.entradas) {
        if (existentes.has(e.id)) continue;
        state.entradas.push(e);
        existentes.add(e.id);
        novas++;
      }
      touch();
      render();
      renderBackupNote();
      updateExportPreview();
      toast(novas
        ? novas + (novas === 1 ? " entrada restaurada." : " entradas restauradas.")
        : "Tudo desse backup já estava aqui.");
    };
    reader.onerror = () => toast("Não consegui ler o arquivo.");
    reader.readAsText(file);
  }

  function downloadCsv() {
    if (!podeAdministrar) return;
    const de = el("expDe").value, ate = el("expAte").value;
    const r = buildCsv(de, ate);
    const nome = "entradas_" + de + "_a_" + ate + ".csv";
    if (triggerDownload(nome, r.csv, "text/csv")) {
      toast("Planilha baixada: " + nome);
      return;
    }
    el("csvFallback").style.display = "block";
    el("csvText").value = r.csv;
    el("csvText").select();
    toast("Download bloqueado neste navegador — copie o texto abaixo.");
  }

  async function copyCsv() {
    if (!podeAdministrar) return;
    const r = buildCsv(el("expDe").value, el("expAte").value);
    try {
      await navigator.clipboard.writeText(r.csv);
      toast("Tabela copiada.");
    } catch (e) {
      el("csvFallback").style.display = "block";
      el("csvText").value = r.csv;
      el("csvText").select();
      toast("Copie o texto abaixo manualmente.");
    }
  }

  /* ==========================================================
     10. Eventos
     ========================================================== */
  function wire() {
    el("periodSeg").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-period]");
      if (!b) return;
      period = b.dataset.period;
      if (period === "dia") anchor = fromISO(selectedDay || todayISO());
      openDays = new Set();
      render();
    });
    el("viewSeg").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-view]");
      if (!b) return;
      view = b.dataset.view;
      render();
    });
    el("prevPeriod").addEventListener("click", () => { shiftPeriod(-1); openDays = new Set(); render(); });
    el("nextPeriod").addEventListener("click", () => { shiftPeriod(1); openDays = new Set(); render(); });
    el("btnToday").addEventListener("click", () => {
      anchor = new Date(); selectedDay = todayISO(); openDays = new Set(); render();
    });
    el("search").addEventListener("input", ev => { query = ev.target.value; render(); });

    el("methodFilter").addEventListener("click", ev => {
      const chip = ev.target.closest("[data-method]");
      if (chip) {
        const id = chip.dataset.method;
        if (methodFilter.has(id)) methodFilter.delete(id); else methodFilter.add(id);
        render();
        return;
      }
      if (ev.target.closest("#clearMethods")) { methodFilter.clear(); render(); }
    });

    el("board").addEventListener("click", ev => {
      const cell = ev.target.closest("[data-day]");
      if (!cell) return;
      selectedDay = cell.dataset.day;
      render();
      const panel = el("dayPanel");
      if (panel.firstElementChild) panel.firstElementChild.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    el("dayPanel").addEventListener("click", ev => {
      const toggle = ev.target.closest("[data-toggle]");
      if (toggle) {
        const iso = toggle.dataset.toggle;
        const card = toggle.closest(".day-card");
        const willOpen = !card.classList.contains("is-open");
        card.classList.toggle("is-open", willOpen);
        toggle.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) openDays.add(iso); else openDays.delete(iso);
        return;
      }
      const edit = ev.target.closest("[data-edit]");
      if (edit) {
        const e = state.entradas.find(x => x.id === edit.dataset.edit);
        if (e) openEntryDialog(e);
        return;
      }
      const del = ev.target.closest("[data-del]");
      if (del && podeAdministrar) {
        if (del.dataset.armed === "1") { deleteEntry(del.dataset.del); return; }
        del.dataset.armed = "1";
        del.title = "Clique de novo para mover para a lixeira";
        del.style.background = "var(--danger-soft)";
        del.style.color = "var(--danger)";
        setTimeout(() => {
          if (!del.isConnected) return;
          del.dataset.armed = "";
          del.title = "Mover para a lixeira";
          del.style.background = "";
          del.style.color = "";
        }, 3500);
      }
    });

    el("btnNew").addEventListener("click", () => openEntryDialog(null));
    el("entryClose").addEventListener("click", () => entryDialog.close());
    el("btnCancel").addEventListener("click", () => entryDialog.close());
    el("entryForm").addEventListener("submit", submitEntry);

    /* o botão só abre a pergunta; quem move é o painel abaixo dele */
    el("btnDelete").addEventListener("click", () => {
      if (!editingId || !podeAdministrar) return;
      el("confDelete").hidden = false;
      el("btnDelete").disabled = true;
      el("fMotivoLixeira").focus();
    });

    el("btnDeleteNo").addEventListener("click", () => {
      el("confDelete").hidden = true;
      el("btnDelete").disabled = false;
      el("fMotivoLixeira").value = "";
    });

    el("btnDeleteOk").addEventListener("click", () => {
      if (!editingId || !podeAdministrar) return;
      const id = editingId;
      const motivo = el("fMotivoLixeira").value.trim();
      entryDialog.close();
      deleteEntry(id, motivo);
    });

    el("btnAddPay").addEventListener("click", () => {
      const rows = el("paysList").querySelectorAll(".pay-row");
      const current = readPays();
      if (rows.length === 1) {
        const total = centsFromMasked(el("fValor").value);
        current[0].valor = total;
      }
      current.push({ metodo: "credito", parcelas: 1, valor: 0 });
      setPays(current);
    });

    el("paysList").addEventListener("click", ev => {
      const b = ev.target.closest(".pay-del");
      if (!b) return;
      const rows = Array.from(el("paysList").querySelectorAll(".pay-row"));
      if (rows.length <= 1) return;
      const idx = rows.indexOf(b.closest(".pay-row"));
      const cur = readPays();
      cur.splice(idx, 1);
      setPays(cur);
    });
    el("paysList").addEventListener("input", ev => {
      if (ev.target.classList.contains("pay-valor-input")) {
        maskMoney(ev.target);
        syncPays();
      }
    });
    el("paysList").addEventListener("change", syncPays);

    /* clicar no corpo da entrada abre o detalhe; os botões de editar e
       excluir continuam com o comportamento de sempre */
    el("dayPanel").addEventListener("click", ev => {
      if (ev.target.closest("[data-edit],[data-del]")) return;
      const cartao = ev.target.closest(".entry[data-id]");
      if (cartao) abrirDetalhe(cartao.getAttribute("data-id"));
    });

    el("fValor").addEventListener("input", ev => maskMoney(ev.target));

    el("btnExport").addEventListener("click", () => {
      if (!podeAdministrar) return;
      applyPreset("periodo");
      for (const p of el("exportPresets").querySelectorAll(".preset")) p.classList.toggle("is-on", p.dataset.preset === "periodo");
      el("csvFallback").style.display = "none";
      renderBackupNote();
      exportDialog.showModal();
    });
    el("exportClose").addEventListener("click", () => exportDialog.close());
    el("exportPresets").addEventListener("click", ev => {
      const b = ev.target.closest("[data-preset]");
      if (!b) return;
      for (const p of el("exportPresets").querySelectorAll(".preset")) p.classList.toggle("is-on", p === b);
      applyPreset(b.dataset.preset);
    });
    const clearPresets = () => {
      for (const p of el("exportPresets").querySelectorAll(".preset")) p.classList.remove("is-on");
    };
    el("expDe").addEventListener("change", () => { clearPresets(); updateExportPreview(); });
    el("expAte").addEventListener("change", () => { clearPresets(); updateExportPreview(); });
    el("btnDownloadCsv").addEventListener("click", downloadCsv);
    el("btnCopyCsv").addEventListener("click", copyCsv);
    el("btnBackup").addEventListener("click", baixarBackup);
    el("btnImport").addEventListener("click", () => el("fileImport").click());
    el("btnImportPlanilha").addEventListener("click", abrirImportacaoPlanilha);
    el("fileImport").addEventListener("change", ev => {
      const f = ev.target.files && ev.target.files[0];
      if (f) restaurarBackup(f);
      ev.target.value = "";
    });

    document.addEventListener("keydown", ev => {
      if (ev.key === "n" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const tag = (ev.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (entryDialog.open || exportDialog.open) return;
        ev.preventDefault();
        openEntryDialog(null);
      }
    });

    attachAutocomplete(el("fNome"), el("acNome"), nameSuggestions, "Já registrados");
    attachAutocomplete(el("fDesc"), el("acDesc"), descSuggestions, "Serviços");
  }

  /* Importar planilha (CSV/XLSX): a janela é a compartilhada
     (compartilhado/importacao.js). O servidor confere tudo de novo, acusa
     repetidas e guarda o lote; só administradores importam. */
  function abrirImportacaoPlanilha() {
    if (!window.FloreSerImportacao) { toast("A importação não carregou. Recarregue a página."); return; }
    if (exportDialog.open) exportDialog.close();
    FloreSerImportacao.abrir({
      modulo: "entradas", titulo: "Importar entradas", token: tokenAtual,
      campos: [
        { id: "nome", nome: "Nome", obrigatorio: true, tipo: "texto", apelidos: ["nome", "paciente", "cliente"] },
        { id: "data", nome: "Data", obrigatorio: true, tipo: "data", apelidos: ["data", "dia"] },
        { id: "valor", nome: "Valor", obrigatorio: true, tipo: "dinheiro", apelidos: ["valor", "total"] },
        { id: "metodo", nome: "Forma de pagamento", obrigatorio: true, tipo: "texto", apelidos: ["forma", "forma de pagamento", "metodo", "método", "pagamento"] },
        { id: "parcelas", nome: "Parcelas", tipo: "inteiro", apelidos: ["parcelas"] },
        { id: "descricao", nome: "Procedimento", tipo: "texto", apelidos: ["procedimento", "descricao", "descrição", "servico", "serviço"] },
        { id: "obs", nome: "Observação", tipo: "texto", apelidos: ["obs", "observacao", "observação"] }
      ],
      aoConcluir: async function () {
        try { await carregar(); render(); } catch (e) { toast("Importado. Recarregue a página para ver tudo."); }
      }
    });
  }

  function maskMoney(input) {
    const cents = centsFromMasked(input.value);
    const next = cents ? fmtNum(cents) : "";
    if (input.value !== next) input.value = next;
  }

  /* ==========================================================
     11. Boot
     ========================================================== */
  /* ==========================================================
     12. Entrada
     ========================================================== */
  const elPortao = el("portao");
  const elSenha = el("portao-senha");
  const elErro = el("portao-erro");
  const elBtnEntrar = el("portao-btn");

  const AVISO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 3.8 21 19.5H3L12 3.8Z"/>' +
    '<path d="M12 10v4M12 16.6v.4"/></svg>';

  function avisar(texto) {
    elErro.innerHTML = texto ? AVISO + "<span>" + esc(texto) + "</span>" : "";
  }

  function ocupado(ligado) {
    elBtnEntrar.disabled = ligado;
    elBtnEntrar.classList.toggle("carregando", ligado);
    elBtnEntrar.textContent = ligado ? "Conectando…" : "Entrar";
    elSenha.disabled = ligado;
  }

  /* Troca a senha compartilhada por uma sessão desta aba. A senha não fica
     guardada aqui nem é reenviada: daqui para a frente só o token viaja. */
  async function entrar(senha) {
    if (!senha) { elSenha.focus(); return; }
    ocupado(true);
    avisar("");
    const r = await FloreSerSessao.entrarModulo("entradas", senha);
    if (!r.ok) {
      avisar(FloreSerAuth.recado(r));
      elSenha.value = "";
      ocupado(false);
      elSenha.focus();
      return;
    }
    elSenha.value = "";
    if (reentrada) { concluirReentrada(true); return; }
    origemSessao = "senhaModulo";
    try { await carregar(); abrirApp(); }
    catch (e) { ocupado(false); avisar("Não foi possível carregar os dados agora. " + FloreSerAuth.recado(e.resposta)); }
  }

  /* volta com a sessão da senha desta aba; se ela já não valer, o portão fica */
  async function retomarModulo() {
    ocupado(true);
    try {
      await carregar();
      abrirApp();
    } catch (e) {
      ocupado(false);
      avisar(FloreSerAuth.recado(e.resposta));
      elSenha.focus();
    }
  }

  async function sair() {
    await FloreSerSessao.sairDoModulo("entradas");
    location.reload();
  }

  /* A senha do módulo venceu no meio do trabalho: o portão volta por cima
     da tela, e entrar de novo só retoma o envio — nada é recarregado. */
  let portaoGuardado = null, reentrada = null;
  function pedirSenhaDoModulo() {
    return new Promise(resolver => {
      if (!portaoGuardado) { resolver(false); return; }
      reentrada = resolver;
      document.body.appendChild(portaoGuardado);
      ocupado(false);
      avisar("A sessão da senha do módulo expirou. Informe a senha para salvar o que está na tela — nada foi perdido.");
      elSenha.focus();
    });
  }
  function concluirReentrada(ok) {
    const fim = reentrada;
    reentrada = null;
    if (portaoGuardado && portaoGuardado.parentNode) portaoGuardado.remove();
    ocupado(false);
    if (fim) fim(ok);
  }

  /* ---------- entrada por usuário ----------
     A tela é a mesma do portal, servida pelo auth.js. Daqui só dizemos qual
     módulo estamos pedindo e o que fazer quando a pessoa entrar — não existe
     segunda tela nem segunda sessão. Quem decide a permissão é o Apps Script,
     em toda leitura e gravação. */

  function abrirLoginDeUsuario() {
    avisar("");
    window.FloreSerAuth.abrirLogin({
      modulo: "entradas",
      aoEntrar: async function () {
        origemSessao = "usuario";
        if (reentrada) { concluirReentrada(true); return; }
        try { await carregar(); abrirApp(); }
        catch (e) { avisar("Não foi possível carregar os dados agora. " + FloreSerAuth.recado(e.resposta)); }
      },
    });
  }

  /* Volta com a sessão de usuário guardada neste navegador. A tela de
     espera é a do auth.js, a mesma dos três módulos: ela aparece antes da
     chamada e, se der errado, fica no lugar mostrando o motivo. */
  async function retomarUsuario() {
    const entrou = await window.FloreSerAuth.tentarRetomar("entradas", {
      aoPedirSenha() { elSenha.focus(); },
      aoEntrar() {
        origemSessao = "usuario";
        carregar().then(abrirApp).catch(e => {
          avisar("Não foi possível carregar os dados agora. " + FloreSerAuth.recado(e.resposta));
        });
      },
    });
    if (!entrou) return false;

    origemSessao = "usuario";
    try {
      await carregar();
      abrirApp();
      /* agora sim: o módulo está na tela, a espera acabou */
      window.FloreSerAuth.encerrarRetomada();
      return true;
    } catch (e) {
      /* a sessão valia; quem falhou foi a leitura dos dados */
      window.FloreSerAuth.atualizarRetomada({
        etapa: "erro", modulo: "entradas",
        mensagem: "Sua conta foi reconhecida, mas não foi possível carregar os dados. Tente de novo.",
        acoes: [{ texto: "Tentar novamente", fn() { location.reload(); } }],
      });
      return false;
    }
  }

  function abrirApp() {
    portaoGuardado = elPortao;
    elPortao.remove();
    document.body.style.overflow = "";
    /* a animação de entrada só faz sentido depois da senha, quando a tela
       aparece de verdade — antes disso ela rodaria escondida atrás do portão */
    document.body.classList.add("entrou");
    setStatus("saved");
    render();
    setTimeout(abrirEntradaPedida, 0);
    renderBackupNote();
    if (window.FloreSerIntegracao) FloreSerIntegracao.carregar("entradas", tokenAtual);
    if (origemSessao === "usuario" && window.FloreSerAuth) {
      window.FloreSerAuth.montarIdentidade(el("quemEsta"), function () { location.reload(); });
      const sair = el("btnSair");
      /* o CSS do topo vence o [hidden], então escondo pelo display mesmo */
      if (sair) sair.style.display = "none";   /* quem entrou como usuário sai pelo menu */
    }
    if (window.FloreSerLogs) {
      window.FloreSerLogs.registrar("ENTRADAS_ABERTO", {
        mensagem: "Entradas abertas com " + state.entradas.length + " registro(s)"
      });
    }
  }

  /* ==========================================================
     13. Boot
     ========================================================== */
  function boot() {
    document.body.style.overflow = "hidden";
    const versao = el("rodapeVersao");
    if (versao) versao.textContent = (window.FLORESER && window.FLORESER.rotulo) || "";
    el("fData").value = todayISO();
    wire();
    setStatus("idle");

    elBtnEntrar.addEventListener("click", () => entrar(elSenha.value.trim()));
    elSenha.addEventListener("keydown", ev => {
      if (ev.key === "Enter") entrar(elSenha.value.trim());
    });

    const elOlho = el("portao-olho");
    elOlho.addEventListener("click", () => {
      const estaVisivel = elSenha.type === "text";
      elSenha.type = estaVisivel ? "password" : "text";
      elOlho.classList.toggle("aberto", !estaVisivel);
      elOlho.setAttribute("aria-pressed", String(!estaVisivel));
      elOlho.setAttribute("aria-label", estaVisivel ? "Mostrar senha" : "Ocultar senha");
      elSenha.focus();
    });

    const btnSair = el("btnSair");
    if (btnSair) btnSair.addEventListener("click", sair);

    el("ir-usuario").addEventListener("click", abrirLoginDeUsuario);

    /* Ordem de tentativa: a sessão de usuário (que vale entre módulos) e,
       se não houver, a sessão da senha compartilhada desta aba.

       Quando existe usuário e a tentativa falha, paramos aqui de propósito:
       a tela do erro fica no ar. Deixar a sessão antiga da senha entrar por
       baixo esconderia o motivo. */
    (async function () {
      if (FloreSerSessao.temConta()) { await retomarUsuario(); return; }
      if (FloreSerSessao.tokenDoModulo("entradas")) retomarModulo(); else elSenha.focus();
    })();

    /* o servidor recusou a sessão em outra chamada, ou outra aba trocou a
       conta: o que está na tela fica, e a tela diz o que fazer */
    FloreSerSessao.ouvir(function (tipo) {
      if (!document.body.classList.contains("entrou")) return;
      if (tipo === "perdida") { setStatus("expirado"); if (precisaSalvar || emVoo || motor.contar({ entradas: state.entradas })) pedirLoginDeNovo(); }
      if (tipo === "trocou") toast("Outra conta entrou neste navegador. Recarregue a página para usar a conta nova.");
    });
  }

  /* Fechar a aba com algo por enviar apagaria o trabalho: o navegador
     pergunta antes. Conflito aberto também conta como pendência. */
  window.addEventListener("beforeunload", ev => {
    if (!travado && (precisaSalvar || emVoo || conflitoPendente)) {
      ev.preventDefault(); ev.returnValue = "";
    }
  });

  boot();
})();
