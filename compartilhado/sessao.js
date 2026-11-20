/* =====================================================================
   FloreSer · Corpo e Alma — a sessão neste navegador
   ---------------------------------------------------------------------
   Quem decide se a sessão vale é o servidor. Este arquivo só guarda o
   token, repete o que o servidor disse sobre ele e avisa quem precisa.

   CONTA (o caminho principal): token em localStorage, compartilhado pelas
   abas e pelos módulos, sobrevive a recarregar e a fechar o navegador. O
   prazo que vale é o que o servidor devolve (expiraEm) — nunca um relógio
   de atividade deste aparelho.

   SENHA DO MÓDULO (transição): token em sessionStorage, por aba e por
   módulo, como sempre foi. Expira em 30 minutos sem uso, no servidor.

   As regras que derrubavam sessão à toa e que este arquivo impede:
     · só uma resposta de categoria "autenticacao" apaga a sessão — e só
       se o token que ela recusou ainda for o token guardado. Uma resposta
       atrasada de um token antigo não apaga a sessão de quem acabou de
       entrar (comparar antes de apagar);
     · sem acesso a um módulo, servidor ocupado, sem rede, prazo, versão:
       a sessão fica;
     · conferências simultâneas viram uma só; com confirmação recente,
       nenhuma;
     · nada de conferir de tempos em tempos: só ao voltar para a aba ou
       ao voltar a conexão, se passou tempo desde a última confirmação.

   Eventos (FloreSerSessao.ouvir): "entrou", "saiu", "perdida" (o servidor
   recusou — peça login sem jogar fora o que está na tela), "trocou" (outra
   aba entrou com outra conta), "atualizada".
   ===================================================================== */

(function (global) {
  "use strict";

  var CHAVE = "floreser.sessao.v2";
  var CHAVE_PERFIL = "floreser.perfil.v2";
  var CONFIRMACAO_VALE_MS = 5 * 60000;
  var RECONFERIR_AO_VOLTAR_MS = 10 * 60000;

  function tentar(f, padrao) { try { var v = f(); return v === undefined ? padrao : v; } catch (e) { return padrao; } }
  function lerJSON(area, chave) { return tentar(function () { return JSON.parse(global[area].getItem(chave)); }, null); }
  function gravarJSON(area, chave, valor) {
    tentar(function () {
      if (valor === null || valor === undefined) global[area].removeItem(chave);
      else global[area].setItem(chave, JSON.stringify(valor));
    }, null);
  }
  function chaveModulo(m) { return "floreser.sessao.modulo." + m; }

  var memoria = lerJSON("localStorage", CHAVE);
  if (memoria && !memoria.token) memoria = null;
  var ouvintes = [];
  var conferindo = null;

  /* ---- a sessão da 3.5.0 continua: o servidor migrou a linha dela ---- */
  (function adotarLegado() {
    var tk = tentar(function () { return localStorage.getItem("floreser.usuario.sessao"); }, null);
    if (!memoria && tk) {
      var p = lerJSON("localStorage", "floreser.usuario.perfil");
      memoria = { token: tk, contaId: (p && p.id) || "", expiraEm: null, expiraAbsoluto: null, confirmadaEm: 0, geracao: geracao(), adotada: true };
      gravarJSON("localStorage", CHAVE, memoria);
      if (p) gravarJSON("localStorage", CHAVE_PERFIL, p);
    }
    ["floreser.usuario.sessao", "floreser.usuario.perfil", "floreser.usuario.atividade"].forEach(function (k) {
      tentar(function () { localStorage.removeItem(k); }, null);
    });
    /* tokens da senha compartilhada da 3.5.0 não valem no servidor novo */
    ["floreser.crm.sessao", "floreser.agenda.sessao", "floreser.entradas.sessao", "floreser.painel.sessao"].forEach(function (k) {
      tentar(function () { sessionStorage.removeItem(k); }, null);
    });
  })();

  function geracao() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function emitir(tipo, dados) {
    ouvintes.slice().forEach(function (fn) { tentar(function () { fn(tipo, dados); }, null); });
  }

  function guardar(s) { memoria = s; gravarJSON("localStorage", CHAVE, s); }

  function perfil() { return memoria ? lerJSON("localStorage", CHAVE_PERFIL) : null; }

  function guardarPerfil(conta) {
    if (!conta) { gravarJSON("localStorage", CHAVE_PERFIL, null); return; }
    var atual = lerJSON("localStorage", CHAVE_PERFIL) || {};
    gravarJSON("localStorage", CHAVE_PERFIL, {
      id: conta.id, nome: conta.nome, usuario: conta.usuario, admin: !!conta.admin,
      permissoes: conta.permissoes || {}, foto: conta.foto !== undefined ? conta.foto : (atual.id === conta.id ? atual.foto || "" : "")
    });
  }

  /* ---------------------------------------------------------------------
     Entrar e sair
     --------------------------------------------------------------------- */

  function entrar(usuario, senha) {
    /* O mesmo operacaoId nas repetições: se a primeira resposta se perdeu,
       o servidor encerra a sessão que nunca chegou aqui. */
    var opId = global.FloreSerRede.novoId("login-");
    return global.FloreSerRede.chamar("sessao.entrar", { usuario: usuario, senha: senha, operacaoId: opId },
      { tentativas: 2, repetirIncerto: true }).then(function (r) {
        if (r.ok) {
          var d = r.dados;
          var antes = memoria && memoria.contaId;
          guardar({ token: d.token, contaId: d.conta.id, expiraEm: d.sessao.expiraEm, expiraAbsoluto: d.sessao.expiraAbsoluto,
            confirmadaEm: Date.now(), geracao: geracao() });
          guardarPerfil(d.conta);
          emitir("entrou", { conta: d.conta, trocouDeConta: !!antes && antes !== d.conta.id });
        }
        return r;
      });
  }

  function entrarModulo(modulo, senha) {
    return global.FloreSerRede.chamar("sessao.entrarModulo", { modulo: modulo, senha: senha }, {}).then(function (r) {
      if (r.ok) {
        gravarJSON("sessionStorage", chaveModulo(modulo), { token: r.dados.token, expiraEm: r.dados.sessao.expiraEm,
          expiraAbsoluto: r.dados.sessao.expiraAbsoluto });
      }
      return r;
    });
  }

  /* Sair encerra a sessão DESTE aparelho no servidor. Os outros continuam. */
  function sair() {
    var tk = memoria && memoria.token;
    guardar(null);
    guardarPerfil(null);
    emitir("saiu", {});
    if (!tk) return Promise.resolve({ ok: true });
    return global.FloreSerRede.chamar("sessao.sair", {}, { token: tk, semSelo: true }).catch(function () { return { ok: false }; });
  }

  function sairDoModulo(modulo) {
    var m = lerJSON("sessionStorage", chaveModulo(modulo));
    gravarJSON("sessionStorage", chaveModulo(modulo), null);
    if (!m || !m.token) return Promise.resolve({ ok: true });
    return global.FloreSerRede.chamar("sessao.sair", {}, { token: m.token, semSelo: true }).catch(function () { return { ok: false }; });
  }

  /* ---------------------------------------------------------------------
     Conferir — uma conferência por vez, e só quando faz falta
     --------------------------------------------------------------------- */

  function conferir(opcoes) {
    var o = opcoes || {};
    if (!memoria) return Promise.resolve({ ok: false, semSessao: true });
    var p = perfil();
    var recente = memoria.confirmadaEm && Date.now() - memoria.confirmadaEm < CONFIRMACAO_VALE_MS;
    if (!o.forcar && recente && p) {
      var acesso = o.modulo ? !!(p.permissoes || {})[o.modulo] : undefined;
      return Promise.resolve({ ok: true, doCache: true, conta: p, acessoModulo: acesso });
    }
    if (conferindo) return conferindo;
    var tokenUsado = memoria.token;
    conferindo = global.FloreSerRede.chamar("sessao.conferir", { modulo: o.modulo || "", comFoto: !!o.comFoto },
      { token: tokenUsado, leitura: true }).then(function (r) {
        conferindo = null;
        if (r.ok) {
          if (memoria && memoria.token === tokenUsado) {
            memoria.confirmadaEm = Date.now();
            if (r.dados.conta) memoria.contaId = r.dados.conta.id;
            guardar(memoria);
            if (r.dados.conta) guardarPerfil(r.dados.conta);
            emitir("atualizada", { conta: r.dados.conta });
          }
          return { ok: true, conta: r.dados.conta, acessoModulo: r.dados.acessoModulo };
        }
        /* a perda, se foi perda, já passou pelo ouvinte da rede */
        return { ok: false, erro: r.erro, temporario: r.erro.categoria !== "autenticacao" };
      });
    return conferindo;
  }

  /* ---------------------------------------------------------------------
     O que a rede ouviu do servidor sobre um token
     --------------------------------------------------------------------- */

  global.FloreSerRede.aoSessao(function (tipo, tokenUsado, info) {
    if (memoria && memoria.token === tokenUsado) {
      if (tipo === "validade") {
        memoria.expiraEm = info.expiraEm;
        memoria.expiraAbsoluto = info.expiraAbsoluto;
        memoria.confirmadaEm = Date.now();
        guardar(memoria);
      } else if (tipo === "perdida") {
        guardar(null);
        emitir("perdida", { erro: info });
      }
      return;
    }
    /* senha de módulo: a mesma regra, por módulo */
    ["crm", "agenda", "entradas", "dev"].forEach(function (m) {
      var s = lerJSON("sessionStorage", chaveModulo(m));
      if (!s || s.token !== tokenUsado) return;
      if (tipo === "validade") { s.expiraEm = info.expiraEm; gravarJSON("sessionStorage", chaveModulo(m), s); }
      else { gravarJSON("sessionStorage", chaveModulo(m), null); emitir("perdida", { erro: info, modulo: m }); }
    });
    /* tokenUsado diferente do guardado: resposta de uma sessão que já não
       é a desta aba. Nada é apagado. */
  });

  /* ---- outra aba entrou, saiu ou trocou de conta ---- */
  tentar(function () {
    global.addEventListener("storage", function (e) {
      if (e.key !== CHAVE) return;
      var antes = memoria;
      memoria = lerJSON("localStorage", CHAVE);
      if (memoria && !memoria.token) memoria = null;
      if (!memoria && antes) emitir("saiu", { outraAba: true });
      else if (memoria && antes && antes.contaId && memoria.contaId !== antes.contaId) emitir("trocou", { conta: perfil() });
      else if (memoria && (!antes || antes.token !== memoria.token)) emitir("entrou", { conta: perfil(), outraAba: true });
    });
  }, null);

  /* ---- voltar para a aba ou voltar a conexão: confere se passou tempo ---- */
  function aoVoltar() {
    if (!memoria) return;
    if (Date.now() - (memoria.confirmadaEm || 0) < RECONFERIR_AO_VOLTAR_MS) return;
    conferir({ forcar: true });
  }
  tentar(function () {
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") aoVoltar(); });
    global.addEventListener("online", aoVoltar);
  }, null);

  global.FloreSerSessao = {
    /* conta */
    token: function () { return memoria ? memoria.token : ""; },
    contaId: function () { return memoria ? memoria.contaId || "" : ""; },
    conta: perfil,
    validade: function () { return memoria ? { expiraEm: memoria.expiraEm, expiraAbsoluto: memoria.expiraAbsoluto, confirmadaEm: memoria.confirmadaEm } : null; },
    temConta: function () { return !!memoria; },
    entrar: entrar,
    sair: sair,
    conferir: conferir,
    /* senha do módulo */
    entrarModulo: entrarModulo,
    sairDoModulo: sairDoModulo,
    tokenDoModulo: function (m) { var s = lerJSON("sessionStorage", chaveModulo(m)); return s ? s.token : ""; },
    /* o token que vale para um módulo: a conta, se houver; senão a senha dele */
    tokenPara: function (m) {
      if (memoria) return memoria.token;
      var s = lerJSON("sessionStorage", chaveModulo(m));
      return s ? s.token : "";
    },
    tipoPara: function (m) { return memoria ? "conta" : (lerJSON("sessionStorage", chaveModulo(m)) ? "modulo" : ""); },
    ouvir: function (fn) { ouvintes.push(fn); return function () { ouvintes = ouvintes.filter(function (x) { return x !== fn; }); }; }
  };
})(window);
