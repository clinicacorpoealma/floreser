/* =====================================================================
   Conferência antes de publicar — node ferramentas/conferir-publicacao.js
   ---------------------------------------------------------------------
   Não muda nada. Confere o que costuma dar errado numa publicação feita à
   mão, e sai com código 1 se houver erro:

     · changelog: versão no formato, codinome único em maiúsculas, data,
       categorias válidas e não vazias, ordem decrescente;
     · versões: o topo do changelog = VERSAO_PRODUTO do backend; a API que
       o site fala (version.js e config.js) = VERSAO_API do backend; o
       schema esperado = VERSAO_SCHEMA;
     · casca da PWA: todo script e estilo local das páginas está no
       ESSENCIAIS do service-worker.js, e todo item do precache existe;
     · caminhos: nada absoluto nas páginas e no manifest (o site mora em
       /floreser/), e toda página tem a marca de estrutura;
     · o endereço do Apps Script só no compartilhado/config.js;
     · nenhum segredo no backend;
     · o carimbo da casca no version.js, se houver, bate com os arquivos.
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");
const existe = (p) => fs.existsSync(path.join(RAIZ, p));
const erros = [], avisos = [];
const erro = (m) => erros.push(m), aviso = (m) => avisos.push(m);

/* ---- version.js ---- */
const contexto = { window: {}, self: {} };
vm.createContext(contexto);
vm.runInContext(ler("version.js"), contexto);
const F = contexto.window.FLORESER;
const CATEGORIAS = F.categorias;
const vistos = {};
let anterior = null;
F.changelog.forEach((r, i) => {
  const onde = "changelog[" + i + "] " + r.versao;
  if (!/^\d+\.\d+\.\d+$/.test(r.versao)) erro(onde + ": versão fora do formato X.Y.Z");
  if (!/^[A-ZÀ-Ý]+$/.test(r.codinome)) erro(onde + ": codinome precisa ser uma palavra em maiúsculas");
  if (vistos[r.codinome]) erro(onde + ": codinome repetido (" + r.codinome + ")");
  vistos[r.codinome] = true;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(r.data)) erro(onde + ": data fora do formato DD/MM/AAAA");
  Object.keys(r.mudancas || {}).forEach((c) => {
    if (CATEGORIAS.indexOf(c) < 0) erro(onde + ": categoria desconhecida " + c);
    if (!(r.mudancas[c] || []).length) erro(onde + ": categoria vazia " + c);
  });
  const n = r.versao.split(".").map(Number);
  if (anterior) {
    const a = anterior;
    const maior = n[0] < a[0] || (n[0] === a[0] && (n[1] < a[1] || (n[1] === a[1] && n[2] < a[2])));
    if (!maior) erro(onde + ": o changelog precisa estar do mais novo para o mais antigo");
  }
  anterior = n;
});
const topo = F.changelog[0];

/* ---- versões entre site e backend ---- */
const backend = fs.readdirSync(path.join(RAIZ, "backend")).filter((f) => f.endsWith(".gs")).map((f) => ler("backend/" + f)).join("\n");
const constante = (nome) => { const m = new RegExp("var " + nome + " = \"?([\\w.]+)\"?;").exec(backend); return m ? m[1] : null; };
if (constante("VERSAO_PRODUTO") !== topo.versao) erro("VERSAO_PRODUTO do backend (" + constante("VERSAO_PRODUTO") + ") ≠ topo do changelog (" + topo.versao + ")");
const config = ler("compartilhado/config.js");
const apiDoSite = (/api: (\d+),/.exec(config) || [])[1];
if (String(F.compat.api) !== constante("VERSAO_API")) erro("compat.api do version.js (" + F.compat.api + ") ≠ VERSAO_API do backend (" + constante("VERSAO_API") + ")");
if (apiDoSite !== constante("VERSAO_API")) erro("api do config.js (" + apiDoSite + ") ≠ VERSAO_API do backend");
if (String(F.compat.schema) !== constante("VERSAO_SCHEMA")) erro("compat.schema do version.js ≠ VERSAO_SCHEMA do backend");

/* ---- páginas, precache e caminhos ---- */
const sw = ler("service-worker.js");
const listaDoSw = (nome) => {
  const m = new RegExp("const " + nome + " = \\[([\\s\\S]*?)\\];").exec(sw);
  return m ? (m[1].match(/RAIZ(?: \+ "([^"]*)")?/g) || []).map((x) => (/"([^"]*)"/.exec(x) || [, ""])[1]) : [];
};
const essenciais = listaDoSw("ESSENCIAIS"), opcionais = listaDoSw("OPCIONAIS");
essenciais.concat(opcionais).forEach((p) => {
  const alvo = p === "" ? "index.html" : p.endsWith("/") ? p + "index.html" : p;
  if (!existe(alvo)) erro("precache aponta para um arquivo que não existe: " + (p || "(raiz)"));
});
const PAGINAS = ["index.html", "crm/index.html", "agenda/index.html", "entradas/index.html"];
PAGINAS.forEach((pagina) => {
  const html = ler(pagina);
  const dir = path.posix.dirname(pagina);
  if (html.indexOf('name="floreser-estrutura"') < 0) erro(pagina + ": falta <meta name=\"floreser-estrutura\">");
  const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  refs.forEach((r) => {
    if (/^(https?:)?\/\//.test(r) || r.startsWith("data:")) return;
    if (r.startsWith("/")) { erro(pagina + ": caminho absoluto " + r + " quebra debaixo de /floreser/"); return; }
    const local = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, r));
    if (!existe(local)) erro(pagina + ": referência a arquivo inexistente " + r);
    if (/\.(js|css)$/.test(local) && essenciais.indexOf(local) < 0) erro(pagina + ": " + local + " não está no ESSENCIAIS do service-worker.js");
  });
});
const manifest = JSON.parse(ler("manifest.webmanifest"));
["start_url", "scope"].forEach((k) => { if (manifest[k] && manifest[k].startsWith("/")) erro("manifest." + k + " é absoluto"); });
(manifest.icons || []).forEach((i) => { if (i.src.startsWith("/")) erro("ícone absoluto no manifest: " + i.src); if (!existe(i.src.replace(/^\.\//, ""))) erro("ícone inexistente: " + i.src); });

/* ---- endereço da API num lugar só ---- */
const varrer = (dir, ext) => fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((d) => {
  const p = path.posix.join(dir, d.name);
  if (d.isDirectory()) return ["vendor", "backend", "testes", "ferramentas", "docs", ".git", ".claude", "node_modules", "assets", "icons"].includes(d.name) ? [] : varrer(p, ext);
  return ext.test(d.name) ? [p] : [];
});
varrer(".", /\.(js|html)$/).forEach((p) => {
  if (p === "compartilhado/config.js") return;
  if (/script\.google\.com\/macros/.test(ler(p))) erro(p + ": o endereço do Apps Script deve morar só em compartilhado/config.js");
});

/* ---- segredos no backend ---- */
fs.readdirSync(path.join(RAIZ, "backend")).filter((f) => f.endsWith(".gs")).forEach((f) => {
  const t = ler("backend/" + f);
  if (/\b(PIMENTA|SENHA[A-Z_]*)\s*=\s*"[^"]{6,}"/.test(t)) erro("backend/" + f + ": parece ter uma senha ou pimenta escrita no código");
  if (/"[0-9a-f]{40,}"/.test(t)) aviso("backend/" + f + ": tem um texto hexadecimal longo — confira se não é segredo");
});

/* ---- carimbo da casca ---- */
const carimbo = (/var CARIMBO_CASCA = "([^"]*)";/.exec(ler("version.js")) || [])[1];
const calculado = carimboDaCasca(essenciais);
if (carimbo && carimbo !== calculado) erro("o carimbo da casca no version.js (" + carimbo + ") não bate com os arquivos (" + calculado + "): rode node ferramentas/preparar-publicacao.js");
if (!carimbo) aviso("sem carimbo da casca no version.js: o cache troca só pela versão (rode preparar-publicacao.js para carimbar)");

function carimboDaCasca(lista) {
  const h = crypto.createHash("sha256");
  lista.filter((p) => p !== "version.js").forEach((p) => {
    const alvo = p === "" ? "index.html" : p.endsWith("/") ? p + "index.html" : p;
    if (existe(alvo)) h.update(alvo + "\0").update(fs.readFileSync(path.join(RAIZ, alvo)));
  });
  return h.digest("hex").slice(0, 10);
}

module.exports = { carimboDaCasca, essenciais };

if (require.main === module) {
  console.log("Conferência da publicação — v" + topo.versao + " " + topo.codinome);
  avisos.forEach((a) => console.log("  aviso: " + a));
  erros.forEach((e) => console.log("  ERRO:  " + e));
  console.log(erros.length ? erros.length + " erro(s). Não publique ainda." : "Tudo confere.");
  process.exit(erros.length ? 1 : 0);
}
