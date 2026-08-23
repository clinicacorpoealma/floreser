/* =====================================================================
   FloreSer · Corpo e Alma — tranca por inatividade
   ---------------------------------------------------------------------
   A senha de cada módulo abre a sessão daquela aba. Sem isto, a sessão
   fica aberta enquanto a aba existir: quem chegar depois no mesmo
   computador entra sem digitar nada.

   Aqui a sessão passa a ter prazo. Depois de um tempo sem ninguém mexer,
   a senha é esquecida e o portão volta. Também há o botão de trancar na
   hora, para quando ela sair da mesa de propósito.

   O relógio é guardado por aba (sessionStorage), então recarregar a
   página não zera a contagem — e voltar para a aba depois do prazo
   tranca na hora, sem esperar o próximo tique.
   ===================================================================== */

(function (global) {
  "use strict";

  /* Minutos parados até trancar. Um número só, aqui, para ser fácil mudar. */
  var MINUTOS = 15;

  var TIQUE = 30000;   // de quanto em quanto tempo o relógio é conferido
  var FOLGA = 20000;   // só regrava o "visto por último" a cada 20s

  var EVENTOS = ["mousedown", "keydown", "touchstart", "wheel", "focusin"];

  function tentar(f, padrao) {
    try {
      var v = f();
      return v === undefined || v === null || v === "" ? padrao : v;
    } catch (e) {
      return padrao;
    }
  }

  function ler(chave) {
    return Number(tentar(function () { return sessionStorage.getItem(chave); }, 0)) || 0;
  }

  function gravar(chave, valor) {
    tentar(function () { sessionStorage.setItem(chave, String(valor)); return true; }, false);
  }

  function apagar(chave) {
    tentar(function () { sessionStorage.removeItem(chave); return true; }, false);
  }

  /* opcoes: { nome, aoTrancar, minutos } — "nome" é só a etiqueta do módulo,
     usada para separar o relógio de um módulo do relógio do outro. */
  function vigiar(opcoes) {
    var chaveVisto = "floreser." + opcoes.nome + ".visto";
    var limite = (opcoes.minutos || MINUTOS) * 60000;
    var ligada = false;
    var relogio = null;
    var ultimoRegistro = 0;

    function marcar() {
      if (!ligada) return;
      var agora = Date.now();
      if (agora - ultimoRegistro < FOLGA) return;
      ultimoRegistro = agora;
      gravar(chaveVisto, agora);
    }

    function passouDoPrazo() {
      var visto = ler(chaveVisto);
      if (!visto) return false;
      return Date.now() - visto > limite;
    }

    function conferir() {
      if (ligada && passouDoPrazo()) trancar("prazo");
    }

    function trancar(motivo) {
      if (!ligada) return;
      ligada = false;
      clearInterval(relogio);
      relogio = null;
      apagar(chaveVisto);
      tentar(function () {
        if (global.FloreSerLogs) {
          global.FloreSerLogs.registrar("SESSAO_TRANCADA", {
            nivel: "SECURITY",
            mensagem: motivo === "prazo"
              ? "Sessão trancada depois de " + Math.round(limite / 60000) + " min parada"
              : "Sessão trancada por quem estava usando",
          });
        }
        return true;
      }, false);
      opcoes.aoTrancar(motivo);
    }

    function comecar() {
      ligada = true;
      ultimoRegistro = 0;
      marcar();
      clearInterval(relogio);
      relogio = setInterval(conferir, TIQUE);
    }

    EVENTOS.forEach(function (ev) {
      document.addEventListener(ev, marcar, { passive: true, capture: true });
    });

    /* Voltar para a aba é o momento mais provável de o prazo já ter
       estourado: confere antes de mostrar qualquer coisa. */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) conferir();
    });
    global.addEventListener("focus", conferir);

    return {
      comecar: comecar,
      trancarAgora: function () { trancar("pedido"); },
      /* usado no arranque, antes de aceitar a senha guardada da aba */
      expirou: passouDoPrazo,
      esquecer: function () { apagar(chaveVisto); },
      minutos: Math.round(limite / 60000),
    };
  }

  global.FloreSerSessao = { vigiar: vigiar, minutos: MINUTOS };
})(window);
