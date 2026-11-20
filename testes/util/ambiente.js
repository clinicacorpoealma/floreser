/* Um backend instalado, em memória, com contas sintéticas. Nenhum dado real. */
"use strict";

const { carregarBackend, pedir } = require("../simulador/carregar");

let seq = 0;

function novoAmbiente(opcoes) {
  const o = opcoes || {};
  const { sim, gs } = carregarBackend(o);
  Object.assign(sim.props, {
    FLORESER_PIMENTA: "pimenta-sintetica-de-teste",
    FLORESER_SENHA_CRM: "senha-crm-teste", FLORESER_SENHA_AGENDA: "senha-agenda-teste",
    FLORESER_SENHA_ENTRADAS: "senha-entradas-teste", FLORESER_SENHA_DEV: "senha-painel-teste"
  });
  if (!o.semAbas) {
    gs.reiniciarExecucao();
    gs.prepararAbas();
  }
  const amb = {
    sim, gs,
    pedir(acao, dados, token, extra) {
      return pedir(gs, Object.assign({ v: 2, pedidoId: "p" + (++seq), acao, token: token || "", dados: dados || {}, cliente: { versao: "teste" } }, extra || {}));
    },
    criarConta(c) {
      gs.reiniciarExecucao();
      const s = gs.derivarNova(c.senha);
      const u = { id: c.id || "u" + (++seq), nome: c.nome || c.usuario, usuario: c.usuario, esquema: s.esquema,
        senhaHash: s.senhaHash, salt: s.salt, iteracoes: s.iteracoes, ativo: c.ativo !== false, admin: !!c.admin,
        crm: !!c.crm, agenda: !!c.agenda, entradas: !!c.entradas, financeiro: !!c.financeiro, credencialVersao: 1, criadoEm: new Date().toISOString(),
        criadoPor: "teste", ultimoLogin: null, alteradoEm: null, legado: null };
      gs.inserir("sis_usuarios", [u]);
      gs.reiniciarExecucao();
      return u;
    },
    entrar(usuario, senha, opId) {
      const r = amb.pedir("sessao.entrar", { usuario, senha, operacaoId: opId });
      if (!r.ok) throw new Error("login falhou: " + JSON.stringify(r.erro));
      return r.dados.token;
    },
    op(tipo, extra) { return Object.assign({ operacaoId: "op" + (++seq) + "xxxxxxxx", tipo }, extra || {}); },
    linhas(tabela) { gs.reiniciarExecucao(); return gs.lerTudo(tabela); }
  };
  return amb;
}

module.exports = { novoAmbiente };
