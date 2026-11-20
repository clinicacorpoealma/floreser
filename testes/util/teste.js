/* Um executor de testes mínimo, sem dependências. */
"use strict";

const util = require("util");
const casos = [];

function teste(nome, fn) { casos.push({ nome, fn }); }

function falha(msg) { const e = new Error(msg); e.falhaDeTeste = true; throw e; }

const verifica = {
  igual(a, b, msg) {
    /* objetos do backend vêm de outro contexto (vm): compara pela estrutura */
    const norm = (x) => (x && typeof x === "object" ? JSON.parse(JSON.stringify(x)) : x);
    if (!util.isDeepStrictEqual(norm(a), norm(b))) falha((msg || "valores diferentes") + "\n      obtido:   " + util.inspect(a, { depth: 4 }) + "\n      esperado: " + util.inspect(b, { depth: 4 }));
  },
  verdade(v, msg) { if (!v) falha(msg || "esperava verdadeiro"); },
  falso(v, msg) { if (v) falha(msg || "esperava falso"); },
  erro(resp, codigo, msg) {
    if (!resp || resp.ok !== false || !resp.erro || resp.erro.codigo !== codigo) {
      falha((msg || "esperava erro " + codigo) + "\n      resposta: " + util.inspect(resp, { depth: 4 }));
    }
  },
  ok(resp, msg) {
    if (!resp || resp.ok !== true) falha((msg || "esperava ok") + "\n      resposta: " + util.inspect(resp, { depth: 5 }));
    return resp.dados;
  }
};

async function executar(titulo) {
  let ok = 0;
  const falhas = [];
  for (const c of casos) {
    try { await c.fn(); ok++; }
    catch (e) { falhas.push({ nome: c.nome, erro: e }); }
  }
  console.log("\n" + titulo + ": " + ok + "/" + casos.length + " ok");
  falhas.forEach((f) => console.log("  ✗ " + f.nome + "\n      " + (f.erro.falhaDeTeste ? f.erro.message : (f.erro.stack || f.erro))));
  casos.length = 0;
  return { ok, total: ok + falhas.length, falhas: falhas.length };
}

module.exports = { teste, verifica, executar };
