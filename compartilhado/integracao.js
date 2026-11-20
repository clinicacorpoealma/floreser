/* =====================================================================
   FloreSer · Corpo e Alma — o Clinicorp dentro dos módulos
   ---------------------------------------------------------------------
   FloreSerIntegracao.carregar(modulo, token)  → Promise<contexto | null>
   FloreSerIntegracao.de(modulo, localId)      → o que se sabe desta ficha
   FloreSerIntegracao.bloco(modulo, localId)   → um <div> pronto (com as
                                                 decisões da ficha), ou null
   FloreSerIntegracao.selo(modulo)             → <span> "Atualizado há 5 min"…
   FloreSerIntegracao.ouvir(fn)                → chamado a cada atualização
   FloreSerIntegracao.atualizar(modulo)        → lê de novo (sem cache)

   Tudo vem de integracao.contexto, que lê a PLANILHA: o Clinicorp nunca é
   chamado para desenhar uma tela. O trabalho de sincronizar é da rotina do
   servidor (gatilho de tempo); aqui a tela só relê o estado local:
   ao abrir, a cada 3 minutos com a aba visível, e ao voltar para a aba.
   Reler não recarrega a página nem toca no que está sendo editado — quem
   ouve decide o que redesenhar.

   Decisões que pertencem à ficha ("Este é o mesmo paciente", "Vincular a
   este recebimento"...) são tomadas aqui, com a consequência explicada
   antes, e ficam guardadas no servidor para os próximos eventos.

   Se falhar, o módulo segue sem contexto e o último estado conhecido fica
   na tela (a integração é complemento, nunca condição para trabalhar).
   ===================================================================== */
(function (global) {
  "use strict";

  var RELER_MS = 3 * 60000;
  var cache = {};
  var ouvintes = [];
  var tokens = {};

  function novoId(p) { return global.FloreSerRede && global.FloreSerRede.novoId ? global.FloreSerRede.novoId(p) : p + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function tokenDe(modulo) { var t = tokens[modulo]; return typeof t === "function" ? t() : t; }

  function ler(modulo) {
    var c = cache[modulo] = cache[modulo] || { dados: null, lidoEm: 0 };
    if (c.emVoo) return c.emVoo;
    c.emVoo = global.FloreSerRede.chamar("integracao.contexto", { modulo: modulo }, { token: tokenDe(modulo), leitura: true, semSelo: true })
      .then(function (r) {
        c.emVoo = null;
        if (r && r.ok) { c.dados = r.dados; c.lidoEm = Date.now(); c.falhou = false; }
        else c.falhou = true;   /* o último estado conhecido continua */
        avisar(modulo);
        return c.dados;
      })
      .catch(function () { c.emVoo = null; c.falhou = true; avisar(modulo); return c.dados; });
    return c.emVoo;
  }

  function carregar(modulo, token) {
    tokens[modulo] = token;
    var c = cache[modulo];
    if (c && c.dados && Date.now() - c.lidoEm < RELER_MS) return Promise.resolve(c.dados);
    vigiar(modulo);
    return ler(modulo);
  }

  function atualizar(modulo) { return ler(modulo); }

  var vigiados = {};
  function vigiar(modulo) {
    if (vigiados[modulo]) return;
    vigiados[modulo] = true;
    setInterval(function () { if (document.visibilityState === "visible") ler(modulo); }, RELER_MS);
    document.addEventListener("visibilitychange", function () {
      var c = cache[modulo];
      if (document.visibilityState === "visible" && (!c || Date.now() - c.lidoEm > 60000)) ler(modulo);
    });
  }

  /* devolve a função que para de ouvir (para quem monta e desmonta) */
  function ouvir(fn) { ouvintes.push(fn); return function () { ouvintes = ouvintes.filter(function (f) { return f !== fn; }); }; }
  function avisar(modulo) {
    ouvintes.forEach(function (fn) { try { fn(modulo); } catch (e) { } });
    Array.prototype.forEach.call(document.querySelectorAll(".fs-int-selo[data-modulo='" + modulo + "']"), function (s) { pintarSelo(s, modulo); });
  }

  function de(modulo, localId) {
    var c = cache[modulo];
    return c && c.dados && c.dados.porLocal ? c.dados.porLocal[localId] || null : null;
  }

  function estado(modulo) { var c = cache[modulo]; return c && c.dados ? c.dados.estado : null; }
  function situacao(modulo) { var e = estado(modulo); return e ? e.situacao : ""; }

  function brl(c) { if (c === null || c === undefined) return "valor não informado"; return "R$ " + (Math.round(Number(c)) / 100).toFixed(2).replace(".", ","); }
  function dataBR(iso) { if (!iso) return "—"; var p = String(iso).slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso; }
  function quando(iso) { if (!iso) return ""; var d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  function haQuanto(iso) {
    if (!iso) return "";
    var min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 2) return "agora há pouco";
    if (min < 60) return "há " + min + " min";
    var h = Math.round(min / 60);
    return h < 24 ? "há " + h + " h" : "em " + quando(iso);
  }

  function el(tag, classe, texto) { var e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; }

  /* ---------------- o selo: "Está atualizado?" ---------------- */

  var TEXTOS_ESTADO = { atualizado: "Clinicorp: atualizado", atualizando: "Clinicorp: atualizando", aguardando_envio: "Clinicorp: aguardando envio",
    atencao: "Clinicorp: precisa da sua atenção", interrompida: "Clinicorp: conexão interrompida", nao_configurada: "" };

  function selo(modulo) {
    var s = el("span", "fs-int-selo");
    s.setAttribute("data-modulo", modulo);
    s.setAttribute("role", "status");
    pintarSelo(s, modulo);
    return s;
  }

  function pintarSelo(s, modulo) {
    var e = estado(modulo);
    var c = cache[modulo] || {};
    if (!e || e.estado === "nao_configurada") { s.hidden = true; return; }
    s.hidden = false;
    var texto = TEXTOS_ESTADO[e.estado] || "Clinicorp";
    if (e.estado === "atualizado" && e.atualizadoEm) texto = "Clinicorp: atualizado " + haQuanto(e.atualizadoEm);
    if (e.estado === "atencao") texto += " (" + e.atencao + ")";
    s.textContent = texto;
    s.setAttribute("data-estado", e.estado);
    s.title = (e.intervaloMin ? "O Alveare consulta o Clinicorp a cada " + (e.intervaloMin < 60 ? e.intervaloMin + " minutos" : e.intervaloMin / 60 + " h") +
      " (não é em tempo real). " : "Atualização automática desligada. ") + (c.falhou ? "Não deu para reler o estado agora; mostrando o último conhecido." : "");
  }

  /* ---------------- decisões na ficha ---------------- */

  var DECISOES = {
    identidade: [
      { decisao: "mesmo", texto: "Este é o mesmo paciente", consequencia: "Os orçamentos e agendamentos desse paciente do Clinicorp passam a aparecer nesta ficha, e os próximos chegam sozinhos." },
      { decisao: "nao", texto: "Não é a mesma pessoa", consequencia: "O Alveare não vai mais sugerir este paciente para esta ficha." }],
    proposta_etapa: [
      { decisao: "aplicar", texto: "Mudar a etapa", consequencia: "A etapa muda pelas regras do CRM (marcos e cadência)." },
      { decisao: "ignorar", texto: "Manter como está", consequencia: "Nada muda no CRM." }],
    conciliacao: [
      { decisao: "vincular", texto: "Vincular a este recebimento", consequencia: "Esta entrada passa a ser este recebimento do Clinicorp: data e valor acompanham o Clinicorp; observação e procedimento continuam seus. Não é criada outra entrada.", entrada: true },
      { decisao: "importar", texto: "É outro pagamento", consequencia: "O recebimento do Clinicorp vira uma entrada nova, separada desta." }],
    divergencia: [{ decisao: "ciente", texto: "Ciente", consequencia: "A pendência some; ajuste a entrada se precisar." }],
    dado_ausente: [
      { decisao: "tentar", texto: "Já ajustei — tentar de novo", consequencia: "O Alveare aplica de novo os agendamentos do Clinicorp desta paciente." },
      { decisao: "ignorar", texto: "Deixar como contexto", consequencia: "O agendamento continua só como informação." }]
  };

  function decidir(modulo, pendencia, opcao, localId, aoTerminar) {
    if (!global.confirm(opcao.texto + "?\n\n" + opcao.consequencia)) return;
    var dados = { modulo: modulo, operacaoId: novoId("dec-"), id: pendencia.id, decisao: opcao.decisao };
    if (opcao.entrada) dados.entradaId = localId;
    global.FloreSerRede.chamar("integracao.decidir", dados, { token: tokenDe(modulo) }).then(function (r) {
      if (!r.ok) { global.alert(r.erro && r.erro.mensagem ? r.erro.mensagem : "Não deu para registrar agora. Tente de novo."); return; }
      ler(modulo).then(function () { if (aoTerminar) aoTerminar(); });
    });
  }

  function enviar(modulo, acao, externoId, rotulo) {
    if (!global.confirm(rotulo + " no Clinicorp?\n\nÉ uma alteração real na agenda do Clinicorp. Se a resposta se perder, o Alveare confere antes de qualquer reenvio.")) return;
    global.FloreSerRede.chamar("integracao.enviar", { modulo: modulo, acao: acao, externoId: externoId, operacaoId: novoId("env-") }, { token: tokenDe(modulo) })
      .then(function (r) {
        if (!r.ok) { global.alert(r.erro && r.erro.mensagem ? r.erro.mensagem : "Não foi enviado."); return; }
        var est = r.dados.passo ? r.dados.passo.estado : "";
        global.alert(est === "confirmado" ? "Feito no Clinicorp. A Agenda acompanha na próxima atualização." : "Enviado, mas ainda não confirmado — o Alveare não reenvia sozinho; confira no Clinicorp.");
        ler(modulo);
      });
  }

  var STATUS_ORC = { OPEN: "em aberto", APPROVED: "aprovado", REJECTED: "reprovado", REJECTED_OPPORTUNITY: "alternativa descartada", FOLLOWUP: "em follow-up" };

  /* O bloco "Clinicorp" da ficha: o que veio de lá, o estado, e as decisões
     que são desta ficha. */
  function bloco(modulo, localId, aoMudar) {
    var x = de(modulo, localId);
    if (!x) return null;
    var b = el("div", "fs-int");
    b.appendChild(el("div", "fs-int-titulo", "Clinicorp"));
    var linhas = [];
    if (modulo === "crm") {
      if (x.pacienteId) linhas.push("Mesmo paciente do Clinicorp" + (x.via === "paciente" ? " (pela ficha da Agenda)" : "") + ".");
      (x.orcamentos || []).forEach(function (o) {
        linhas.push("Orçamento " + (STATUS_ORC[o.status] || o.status) + " · " + brl(o.valor) + (o.procedimentos && o.procedimentos.length ? " · " + o.procedimentos.join(", ") : "") +
          (o.aprovadoEm ? " · aprovado em " + dataBR(o.aprovadoEm) : o.reprovadoEm ? " · reprovado em " + dataBR(o.reprovadoEm) : "") + (o.ausenteDesde ? " · não veio na última consulta" : ""));
      });
      (x.envios || []).forEach(function (e) { linhas.push("Enviada para a campanha \"" + e.campanha + "\" · " + e.estado + (e.em ? " · " + quando(e.em) : "")); });
      if (x.orcamentos && !x.orcamentos.length && x.pacienteId) linhas.push("Nenhum orçamento deste paciente no Clinicorp até agora.");
    } else if (modulo === "agenda") {
      if (x.pacienteId) linhas.push("Mesma paciente do Clinicorp. Datas marcadas com ◆ vêm de lá: remarque ou desmarque no Clinicorp.");
      (x.agendamentos || []).slice(-8).forEach(function (a) {
        var linha = el("div", "fs-int-linha", (a.naAgenda ? "◆ " : "") + dataBR(a.dia) + (a.precisao === "hora" && a.inicio ? " " + a.inicio + (a.fim ? "–" + a.fim : "") : " (sem horário)") +
          (a.procedimento ? " · " + a.procedimento : "") + (a.cancelado ? " · desmarcado" : "") + (a.excluido ? " · excluído" : "") +
          (a.ausenteDesde ? " · não veio na última consulta" : "") + (!a.naAgenda && a.situacaoLocal && !a.cancelado ? " · " + a.situacaoLocal : ""));
        var e = estado(modulo);
        if (e && e.envioAgenda && !a.cancelado && !a.excluido && a.dia >= new Date().toISOString().slice(0, 10)) {
          var conf = el("button", "fs-int-btn", "Confirmar no Clinicorp"); conf.type = "button";
          conf.addEventListener("click", function () { enviar(modulo, "confirmar", a.externoId, "Confirmar o agendamento de " + dataBR(a.dia)); });
          var desm = el("button", "fs-int-btn", "Desmarcar no Clinicorp"); desm.type = "button";
          desm.addEventListener("click", function () { enviar(modulo, "desmarcar", a.externoId, "Desmarcar o agendamento de " + dataBR(a.dia)); });
          linha.appendChild(conf); linha.appendChild(desm);
        }
        b.appendChild(linha);
      });
      (x.envios || []).filter(function (e) { return e.estado !== "confirmado"; }).forEach(function (e) {
        linhas.push("Envio ao Clinicorp " + (e.estado === "desconhecido" ? "ainda não confirmado — confira lá" : e.estado) + " (" + quando(e.em) + ").");
      });
    } else if (modulo === "entradas") {
      if (x.recebimentoId) {
        linhas.push("Recebimento do Clinicorp" + (x.forma ? " · " + x.forma : "") + " · " + brl(x.valor) + " · " +
          (x.recebido ? "recebido" + (x.recebidoEm ? " em " + dataBR(x.recebidoEm) : "") : "não consta como recebido") + (x.confirmado ? " · confirmado" : "") + ".");
        if (x.vencimento) linhas.push("Vencimento: " + dataBR(x.vencimento) + ".");
        linhas.push("Liquidação bancária: não informada pelo Clinicorp.");
        linhas.push("Data e valor acompanham o Clinicorp; observação e procedimento são seus.");
      }
    }
    linhas.forEach(function (t) { b.appendChild(el("div", "fs-int-linha", t)); });
    (x.pendencias || []).forEach(function (p) {
      var caixa = el("div", "fs-int-pendencia");
      caixa.appendChild(el("div", "fs-int-pend-texto", p.resumo));
      var acoes = el("div", "fs-int-acoes");
      (DECISOES[p.tipo] || []).forEach(function (op) {
        var btn = el("button", "fs-int-btn" + (op === DECISOES[p.tipo][0] ? " fs-int-btn-principal" : ""), op.texto);
        btn.type = "button";
        btn.title = op.consequencia;
        btn.addEventListener("click", function () { decidir(modulo, p, op, localId, aoMudar); });
        acoes.appendChild(btn);
      });
      caixa.appendChild(acoes);
      b.appendChild(caixa);
    });
    var e2 = estado(modulo);
    b.appendChild(el("div", "fs-int-pe", (e2 && e2.atualizadoEm ? "Atualizado " + haQuanto(e2.atualizadoEm) + "." : "") +
      (e2 && e2.estado === "interrompida" ? " Conexão com o Clinicorp interrompida: mostrando o último estado conhecido." : "")));
    return b;
  }

  global.FloreSerIntegracao = { carregar: carregar, atualizar: atualizar, de: de, bloco: bloco, selo: selo, ouvir: ouvir, situacao: situacao, estado: estado };
})(window);
