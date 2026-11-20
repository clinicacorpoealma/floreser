/* =====================================================================
   Ensaio local da migração a partir de um export .xlsx da planilha
   ---------------------------------------------------------------------
   node ferramentas/ensaiar-migracao-xlsx.js "caminho/do/export.xlsx"

   Carrega o export no simulador do Apps Script (testes/simulador), roda
   o diagnóstico e o ensaio REAIS do backend e imprime a reconciliação:
   contagens, somas em centavos, anomalias e avisos. Imprime ids e nomes de
   coluna; nunca nomes de pessoas, telefones ou valores individuais.

   O export é um retrato: as células que o Sheets converteu em data chegam
   aqui como número de série e são devolvidas ao Date equivalente. As Script
   Properties não vêm no .xlsx — a pimenta usada aqui é fictícia, e por isso
   este ensaio não confere senhas.

   NÃO coloque o export dentro do repositório. Ele contém dados reais.
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { carregarBackend } = require("../testes/simulador/carregar");
const { dataDaParede } = require("../testes/simulador/apps-script");

const arquivo = process.argv[2];
if (!arquivo || !fs.existsSync(arquivo)) {
  console.error("Uso: node ferramentas/ensaiar-migracao-xlsx.js caminho/do/export.xlsx");
  process.exit(2);
}
const raizRepo = path.join(__dirname, "..");
if (path.resolve(arquivo).startsWith(raizRepo + path.sep)) {
  console.error("O export está dentro do repositório. Mova-o para fora antes (ele contém dados reais).");
  process.exit(2);
}

const XLSX = require(path.join(raizRepo, "vendor", "xlsx.full.min.js"));
const fuso = process.argv[3] || "America/Sao_Paulo";
const { sim, gs } = carregarBackend({ fuso });
sim.props.FLORESER_PIMENTA = "pimenta-ficticia-do-ensaio";
sim.props.FLORESER_FUSO = "America/Cuiaba";

const wb = XLSX.read(fs.readFileSync(arquivo), { type: "buffer" });
const doSerial = (n) => {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  return dataDaParede(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), fuso);
};
wb.SheetNames.forEach((nome) => {
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: "" });
  if (!linhas.length) return;
  const aba = sim.planilha.insertSheet(nome);
  const largura = Math.max(...linhas.map((l) => l.length));
  linhas.forEach((l, r) => {
    for (let c = 0; c < largura; c++) {
      const v = l[c] === undefined ? "" : l[c];
      aba.formatar(r, c, "@");
      /* número no export = célula que o Sheets tinha convertido (data) */
      if (typeof v === "number" && r > 0 && v > 20000 && v < 80000) { aba.v[r] = aba.v[r] || []; aba.v[r][c] = doSerial(v); aba.formatar(r, c, "auto"); }
      else aba.gravar(r, c, typeof v === "number" ? String(v) : v);
    }
  });
});

gs.reiniciarExecucao();
const rel = gs.migracaoDiagnosticar();
console.log(gs.resumoDoRelatorio(rel));
if (rel.erros.length) { console.log("\nEnsaio interrompido: há erros bloqueantes."); process.exit(1); }

gs.reiniciarExecucao();
const t0 = Date.now();
const r = gs.migracaoEnsaiar();
console.log("\nEnsaio: " + r.feitas.length + " abas escritas em " + (Date.now() - t0) + " ms (simulador).");
console.log("Conferência: " + (r.conferencia.ok ? "OK" : "FALHOU") + (r.conferencia.problemas.length ? "\n  " + r.conferencia.problemas.join("\n  ") : ""));
console.log("Soma dos pagamentos relida: " + r.conferencia.somaPagamentos + " centavos");

/* reconciliação por entrada: o total de cada uma, antes e depois */
gs.reiniciarExecucao();
const antes = {};
(XLSX.utils.sheet_to_json(wb.Sheets.Entradas_Pagamentos, { header: 1, raw: false, defval: "" }).slice(1)).forEach((l) => {
  if (!l[0]) return;
  antes[l[0]] = (antes[l[0]] || 0) + gs.textoParaCentavos(l[2]);
});
const depois = {};
gs.lerTudo("ent_pagamentos").forEach((p) => { depois[p.entradaId] = (depois[p.entradaId] || 0) + p.valor; });
const divergentes = Object.keys(Object.assign({}, antes, depois)).filter((k) => antes[k] !== depois[k]);
console.log("Entradas com total divergente: " + divergentes.length + " de " + Object.keys(antes).length);
process.exit(r.conferencia.ok && !divergentes.length ? 0 : 1);
