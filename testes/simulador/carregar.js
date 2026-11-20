/* Carrega o backend (backend/*.gs) num contexto isolado, como o Apps Script
   faz: todos os arquivos no mesmo escopo global, em ordem de nome. */
"use strict";

const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { criarSimulador } = require("./apps-script");

/* Relógio controlável: Date.now() e new Date() obedecem a sim.agora. */
const DataReal = Date;
let relogio = null;
class DataControlada extends DataReal {
  constructor(...a) { if (a.length === 0 && relogio !== null) super(relogio()); else super(...a); }
  static now() { return relogio !== null ? relogio() : DataReal.now(); }
}
global.Date = DataControlada;

function carregarBackend(opcoes) {
  const o = opcoes || {};
  const { sim, globais } = criarSimulador(o);
  relogio = () => (sim.agora !== null ? sim.agora : DataReal.now());
  const contexto = vm.createContext(Object.assign({ console: o.silencioso === false ? console : { log() { }, warn() { }, error() { } },
    Date: DataControlada }, globais));
  const dir = o.dir || path.join(__dirname, "..", "..", "backend");
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith(".gs")).sort();
  arquivos.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), contexto, { filename: f }));
  return { sim, gs: contexto, arquivos };
}

/* Uma requisição HTTP ao doPost, como o navegador faria. */
function pedir(gs, corpo) {
  const saida = gs.doPost({ postData: { contents: JSON.stringify(corpo) } });
  return JSON.parse(saida.getContent());
}

module.exports = { carregarBackend, pedir, DataReal };
