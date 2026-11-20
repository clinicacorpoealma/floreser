/* =====================================================================
   Simulador do Google Apps Script para os testes (Node, sem dependências)
   ---------------------------------------------------------------------
   Imita o suficiente de SpreadsheetApp, LockService, CacheService,
   PropertiesService, Utilities e ContentService para o backend rodar
   inteiro em memória. Duas coisas do Sheets real que importam e que este
   simulador reproduz de propósito:

     · CONVERSÃO AUTOMÁTICA: texto gravado numa célula sem formato '@' que
       pareça número ou data vira número ou data — foi assim que a
       Auditoria da 3.5.0 perdeu "01/05/2026". getDisplayValues() devolve a
       data formatada; getValues() devolve o Date.
     · TRAVA DO SCRIPT: uma só; tryLock pode falhar (sim.travaOcupada).

   UrlFetchApp e ScriptApp são de mentira: sim.http(pedido) decide a
   resposta de cada chamada ao Clinicorp (nenhum teste fala com a rede), e
   sim.chamadasHttp guarda o que foi pedido — sem o cabeçalho de
   autorização, que nenhum teste precisa ler.

   E duas injeções para os testes de recuperação:
     · sim.falharEm = "gravar:crm_leads"  → a próxima escrita naquela aba
       lança erro DEPOIS de gravar (a execução "morre" no meio do plano);
     · sim.esquecerCache()                → o CacheService perde tudo.
   ===================================================================== */
"use strict";

const crypto = require("crypto");

function assinados(buf) { return Array.from(buf).map((b) => (b > 127 ? b - 256 : b)); }
function semSinal(arr) { return Buffer.from(arr.map((b) => (b + 256) % 256)); }
function paraBuffer(v) { return typeof v === "string" ? Buffer.from(v, "utf8") : semSinal(v); }

/* ---- datas com fuso, sem biblioteca ---- */
function partesNoFuso(data, fuso) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = {};
  f.formatToParts(data).forEach((x) => { p[x.type] = x.value; });
  return { y: p.year, M: p.month, d: p.day, H: p.hour === "24" ? "00" : p.hour, m: p.minute, s: p.second };
}

function formatarData(data, fuso, padrao) {
  const p = partesNoFuso(data, fuso);
  let saida = "", i = 0;
  while (i < padrao.length) {
    if (padrao[i] === "'") { const j = padrao.indexOf("'", i + 1); saida += padrao.slice(i + 1, j); i = j + 1; continue; }
    if (padrao.startsWith("yyyy", i)) { saida += p.y; i += 4; continue; }
    if (padrao.startsWith("MM", i)) { saida += p.M; i += 2; continue; }
    if (padrao.startsWith("dd", i)) { saida += p.d; i += 2; continue; }
    if (padrao.startsWith("HH", i)) { saida += p.H; i += 2; continue; }
    if (padrao.startsWith("mm", i)) { saida += p.m; i += 2; continue; }
    if (padrao.startsWith("ss", i)) { saida += p.s; i += 2; continue; }
    saida += padrao[i]; i++;
  }
  return saida;
}

/* hora de parede num fuso → Date */
function dataDaParede(ano, mes, dia, h, mi, s, fuso) {
  const palpite = Date.UTC(ano, mes - 1, dia, h, mi, s);
  const p = partesNoFuso(new Date(palpite), fuso);
  const comoUtc = Date.UTC(+p.y, +p.M - 1, +p.d, +p.H, +p.m, +p.s);
  return new Date(palpite + (palpite - comoUtc));
}

/* ---- planilha ---- */
class Faixa {
  constructor(aba, linha, coluna, nl, nc) { Object.assign(this, { aba, linha, coluna, nl, nc }); }
  _celulas(fn) {
    const saida = [];
    for (let r = 0; r < this.nl; r++) {
      const l = [];
      for (let c = 0; c < this.nc; c++) l.push(fn(this.linha - 1 + r, this.coluna - 1 + c));
      saida.push(l);
    }
    return saida;
  }
  getValues() { this.aba.sim.contar("ler"); this.aba.sim.somar("celulasLidas", this.nl * this.nc); return this._celulas((r, c) => this.aba.valor(r, c)); }
  getDisplayValues() { this.aba.sim.contar("ler"); this.aba.sim.somar("celulasLidas", this.nl * this.nc); return this._celulas((r, c) => this.aba.mostrado(r, c)); }
  setValues(valores) {
    this.aba.sim.contar("escrever");
    this.aba.sim.somar("celulasEscritas", this.nl * this.nc);
    if (valores.length !== this.nl || valores.some((l) => l.length !== this.nc)) throw new Error("setValues: dimensões erradas");
    valores.forEach((l, r) => l.forEach((v, c) => this.aba.gravar(this.linha - 1 + r, this.coluna - 1 + c, v)));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(f) { this._celulas((r, c) => this.aba.formatar(r, c, f)); return this; }
  clearContent() { this.aba.sim.contar("escrever"); this.aba.sim.somar("celulasEscritas", this.nl * this.nc); this._celulas((r, c) => this.aba.gravar(r, c, "", true)); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  getRow() { return this.linha; }
  createTextFinder(texto) {
    const faixa = this;
    const busca = { inteira: false, caixa: false };
    return {
      matchEntireCell(v) { busca.inteira = v; return this; },
      matchCase(v) { busca.caixa = v; return this; },
      findAll() {
        faixa.aba.sim.contar("procurar");
        const achados = [];
        for (let r = 0; r < faixa.nl; r++) for (let c = 0; c < faixa.nc; c++) {
          const v = faixa.aba.mostrado(faixa.linha - 1 + r, faixa.coluna - 1 + c);
          const a = busca.caixa ? v : v.toLowerCase(), b = busca.caixa ? texto : texto.toLowerCase();
          if (busca.inteira ? a === b : a.indexOf(b) >= 0) achados.push(new Faixa(faixa.aba, faixa.linha + r, faixa.coluna + c, 1, 1));
        }
        return achados;
      }
    };
  }
}

class Aba {
  constructor(planilha, nome) { this.planilha = planilha; this.sim = planilha.sim; this.nome = nome; this.v = []; this.f = []; }
  getName() { return this.nome; }
  setName(n) { this.nome = n; return this; }
  getLastRow() { for (let r = this.v.length - 1; r >= 0; r--) if ((this.v[r] || []).some((x) => x !== "" && x !== undefined && x !== null)) return r + 1; return 0; }
  getLastColumn() { let m = 0; this.v.forEach((l) => { for (let c = (l || []).length - 1; c >= 0; c--) if (l[c] !== "" && l[c] !== undefined && l[c] !== null) { m = Math.max(m, c + 1); break; } }); return m; }
  getMaxRows() { return Math.max(1000, this.v.length); }
  getRange(l, c, nl, nc) {
    if (typeof l === "string") throw new Error("A1 não suportado no simulador");
    if (l < 1 || c < 1 || (nl || 1) < 1 || (nc || 1) < 1) throw new Error("faixa inválida " + [l, c, nl, nc]);
    return new Faixa(this, l, c, nl || 1, nc || 1);
  }
  setFrozenRows() { return this; }
  deleteRows(l, n) { this.sim.contar("escrever"); this.v.splice(l - 1, n); this.f.splice(l - 1, n); }
  deleteRow(l) { this.deleteRows(l, 1); }
  appendRow(valores) { const l = this.getLastRow() + 1; valores.forEach((v, c) => this.gravar(l - 1, c, v)); return this; }
  valor(r, c) { const v = (this.v[r] || [])[c]; return v === undefined || v === null ? "" : v; }
  formatar(r, c, f) { this.f[r] = this.f[r] || []; this.f[r][c] = f; }
  formato(r, c) { return (this.f[r] || [])[c]; }
  gravar(r, c, v, limpar) {
    this.v[r] = this.v[r] || [];
    if (!limpar && typeof v === "string" && this.formato(r, c) !== "@") v = this.planilha.converter(v);
    this.v[r][c] = v;
  }
  mostrado(r, c) {
    const v = this.valor(r, c);
    if (v instanceof Date) {
      const hora = formatarData(v, this.planilha.fuso, "HH:mm:ss");
      return formatarData(v, this.planilha.fuso, hora === "00:00:00" ? "dd/MM/yyyy" : "dd/MM/yyyy HH:mm:ss");
    }
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return String(v);
  }
}

class Planilha {
  constructor(sim, id, fuso) { this.sim = sim; this.id = id; this.fuso = fuso || "America/Sao_Paulo"; this.abas = []; }
  getId() { return this.id; }
  getUrl() { return "https://docs.google.com/spreadsheets/d/" + this.id; }
  getSpreadsheetTimeZone() { return this.fuso; }
  getSheetByName(n) { return this.abas.find((a) => a.nome.toLowerCase() === String(n).toLowerCase()) || null; }
  getSheets() { return this.abas.slice(); }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error("Já existe uma aba chamada " + n);
    const a = new Aba(this, n); this.abas.push(a); return a;
  }
  copy(nome) {
    const p = new Planilha(this.sim, "copia-" + (++this.sim.seq), this.fuso);
    p.nome = nome;
    this.abas.forEach((a) => { const b = p.insertSheet(a.nome); b.v = a.v.map((l) => (l || []).slice()); b.f = a.f.map((l) => (l || []).slice()); });
    this.sim.planilhas[p.id] = p;
    return p;
  }
  /* O que o Sheets faz com texto digitado numa célula comum (locale pt-BR) */
  converter(t) {
    const s = t.trim();
    if (/^-?\d+(\.\d+)?$/.test(s) && !/^0\d/.test(s)) return Number(s);
    let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return dataDaParede(+m[3], +m[2], +m[1], 0, 0, 0, this.fuso);
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) return dataDaParede(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), this.fuso);
    return t;
  }
}

function criarSimulador(opcoes) {
  const o = opcoes || {};
  const sim = {
    seq: 0, planilhas: {}, props: {}, cache: new Map(), travaOcupada: false, comTrava: false,
    contadores: {}, falharEm: null, agora: null, logs: [],
    http: null, chamadasHttp: [], gatilhos: [],
    contar(t) {
      sim.contadores[t] = (sim.contadores[t] || 0) + 1;
      /* o que aconteceu com a trava do script segura: é o que faz os outros esperarem */
      if (sim.comTrava) sim.contadores[t + "NaTrava"] = (sim.contadores[t + "NaTrava"] || 0) + 1;
    },
    zerarContadores() { sim.contadores = {}; },
    somar(t, n) {
      sim.contadores[t] = (sim.contadores[t] || 0) + n;
      if (sim.comTrava) sim.contadores[t + "NaTrava"] = (sim.contadores[t + "NaTrava"] || 0) + n;
    },
    esquecerCache() { sim.cache.clear(); }
  };
  const principal = new Planilha(sim, "planilha-principal", o.fuso || "America/Sao_Paulo");
  sim.planilhas[principal.id] = principal;
  sim.planilha = principal;

  const agora = () => (sim.agora !== null ? sim.agora : Date.now());

  const globais = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => principal,
      openById: (id) => { if (!sim.planilhas[id]) throw new Error("planilha inexistente " + id); return sim.planilhas[id]; },
      flush: () => { }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (sim.travaOcupada || sim.comTrava) return false; sim.comTrava = true; return true; },
        waitLock: (ms) => { if (sim.travaOcupada || sim.comTrava) throw new Error("trava ocupada"); sim.comTrava = true; },
        releaseLock: () => { sim.comTrava = false; },
        hasLock: () => sim.comTrava
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = sim.cache.get(k); if (!e) return null; if (e.ate < agora()) { sim.cache.delete(k); return null; } return e.v; },
        put: (k, v, seg) => { if (String(v).length > 100000) throw new Error("valor grande demais para o cache"); sim.cache.set(k, { v: String(v), ate: agora() + (seg || 600) * 1000 }); },
        remove: (k) => sim.cache.delete(k),
        getAll: (ks) => { const r = {}; ks.forEach((k) => { const e = sim.cache.get(k); if (e) r[k] = e.v; }); return r; }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in sim.props ? sim.props[k] : null),
        setProperty: (k, v) => { if (String(v).length > 9216) throw new Error("Argument too large: value"); sim.props[k] = String(v); },
        deleteProperty: (k) => { delete sim.props[k]; },
        getProperties: () => Object.assign({}, sim.props),
        setProperties: (o) => { Object.keys(o).forEach((k) => { sim.props[k] = String(o[k]); }); }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (alg, texto) => assinados(crypto.createHash("sha256").update(paraBuffer(texto)).digest()),
      computeHmacSha256Signature: (valor, chave) => assinados(crypto.createHmac("sha256", paraBuffer(chave)).update(paraBuffer(valor)).digest()),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, fuso, padrao) => formatarData(d, fuso, padrao),
      newBlob: (t) => ({ getBytes: () => assinados(Buffer.from(String(t), "utf8")) }),
      base64Encode: (t) => Buffer.from(String(t), "utf8").toString("base64"),
      sleep: () => { }
    },
    ContentService: {
      MimeType: { JSON: "json", TEXT: "text" },
      createTextOutput: (t) => ({ conteudo: t, setMimeType() { return this; }, getContent() { return this.conteudo; } })
    },
    Logger: { log: (m) => { sim.logs.push(String(m)); } },
    UrlFetchApp: {
      fetch: (url, opcoes) => {
        const o = opcoes || {};
        const u = new URL(url);
        const query = {};
        u.searchParams.forEach((v, k) => { query[k] = v; });
        const pedido = { url, metodo: String(o.method || "get").toLowerCase(), caminho: u.pathname.replace(/^\/rest\/v1/, ""), query,
          corpo: o.payload ? JSON.parse(o.payload) : null, autorizacao: (o.headers || {}).Authorization || "", comTrava: sim.comTrava };
        sim.chamadasHttp.push(Object.assign({}, pedido, { autorizacao: pedido.autorizacao ? "(presente)" : "" }));
        if (!sim.http) throw new Error("rede indisponível no simulador");
        const r = sim.http(pedido);
        if (r && r.lancar) throw new Error(r.lancar);
        const status = r && r.status ? r.status : 200;
        const corpo = r && r.texto !== undefined ? r.texto : JSON.stringify(r && r.json !== undefined ? r.json : null);
        return { getResponseCode: () => status, getContentText: () => corpo };
      }
    },
    ScriptApp: {
      getProjectTriggers: () => sim.gatilhos.slice(),
      deleteTrigger: (t) => { sim.gatilhos = sim.gatilhos.filter((g) => g !== t); },
      newTrigger: (fn) => {
        const g = { fn, getHandlerFunction: () => fn };
        const b = { timeBased: () => b, everyHours: (h) => { g.horas = h; return b; }, everyDays: (d) => { g.dias = d; return b; },
          create: () => { sim.gatilhos.push(g); return g; } };
        return b;
      }
    },
    falhaSimulada: (onde) => {
      if (sim.falharEm && sim.falharEm === onde) { sim.falharEm = null; throw new Error("falha simulada em " + onde); }
    }
  };
  return { sim, globais };
}

module.exports = { criarSimulador, formatarData, dataDaParede };
