/* =====================================================================
   FloreSer · Corpo e Alma — contexto das integrações nos módulos
   ---------------------------------------------------------------------
   FloreSerIntegracao.carregar(modulo, token) → Promise<contexto | null>
   FloreSerIntegracao.de(modulo, localId)     → o que se sabe desta ficha
   FloreSerIntegracao.bloco(modulo, localId)  → um <div> pronto, ou null
   FloreSerIntegracao.situacao(modulo)        → "ativa" | "suspensa" | ...

   Os módulos só MOSTRAM contexto: origem, vínculo e estado de
   sincronização. Tudo vem de integracao.contexto, que lê a planilha — o
   Clinicorp nunca é chamado para desenhar uma tela. Vincular, importar e
   conciliar acontecem no painel → Integrações.

   Uma leitura por módulo aberto; se falhar, o módulo segue sem contexto
   (a integração é complemento, nunca condição para trabalhar). O estilo
   do bloco mora em compartilhado/integracao.css, ligado em cada página.
   ===================================================================== */
(function (global) {
  "use strict";

  var cache = {};

  function carregar(modulo, token) {
    if (cache[modulo] && cache[modulo].promessa) return cache[modulo].promessa;
    var c = cache[modulo] = { dados: null };
    c.promessa = global.FloreSerRede.chamar("integracao.contexto", { modulo: modulo }, { token: typeof token === "function" ? token() : token, leitura: true, semSelo: true })
      .then(function (r) { c.dados = r && r.ok ? r.dados : null; return c.dados; })
      .catch(function () { return null; });
    return c.promessa;
  }

  function de(modulo, localId) {
    var c = cache[modulo];
    return c && c.dados && c.dados.porLocal ? c.dados.porLocal[localId] || null : null;
  }

  function situacao(modulo) {
    var c = cache[modulo];
    return c && c.dados && c.dados.estado ? c.dados.estado.situacao : "";
  }

  function brl(c) { if (c === null || c === undefined) return "valor não informado"; return "R$ " + (Math.round(Number(c)) / 100).toFixed(2).replace(".", ","); }
  function dataBR(iso) { if (!iso) return "—"; var p = String(iso).slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso; }
  function quando(iso) { if (!iso) return ""; var d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }

  function el(tag, classe, texto) { var e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; }

  var STATUS_ORC = { OPEN: "em aberto", APPROVED: "aprovado", REJECTED: "reprovado", REJECTED_OPPORTUNITY: "alternativa descartada", FOLLOWUP: "em follow-up" };

  /* Um bloco discreto, com as classes fs-int-* (estilo próprio, abaixo). */
  function bloco(modulo, localId) {
    var x = de(modulo, localId);
    if (!x) return null;
    var b = el("div", "fs-int");
    b.appendChild(el("div", "fs-int-titulo", "Clinicorp"));
    var linhas = [];
    if (modulo === "crm") {
      if (x.pacienteId) linhas.push("Vinculada ao paciente " + x.pacienteId + (x.desde ? " desde " + dataBR(x.desde) : "") + ".");
      (x.orcamentos || []).forEach(function (o) {
        linhas.push("Orçamento " + (STATUS_ORC[o.status] || o.status) + " · " + brl(o.valor) + (o.procedimentos && o.procedimentos.length ? " · " + o.procedimentos.join(", ") : "") +
          (o.aprovadoEm ? " · aprovado em " + dataBR(o.aprovadoEm) : o.reprovadoEm ? " · reprovado em " + dataBR(o.reprovadoEm) : "") + (o.ausenteDesde ? " · não veio na última consulta" : ""));
      });
      (x.envios || []).forEach(function (e) { linhas.push("Enviada para a campanha \"" + e.campanha + "\" · " + e.estado + (e.em ? " · " + quando(e.em) : "")); });
      if (x.orcamentos && !x.orcamentos.length && x.pacienteId) linhas.push("Nenhum orçamento importado para este paciente.");
    } else if (modulo === "agenda") {
      if (x.pacienteId) linhas.push("Vinculada ao paciente " + x.pacienteId + ".");
      (x.agendamentos || []).slice(-6).forEach(function (a) {
        linhas.push(dataBR(a.dia) + (a.precisao === "hora" && a.inicio ? " " + a.inicio + (a.fim ? "–" + a.fim : "") : " (sem horário)") +
          (a.procedimento ? " · " + a.procedimento : "") + (a.cancelado ? " · desmarcado" : "") + (a.excluido ? " · excluído" : "") + (a.ausenteDesde ? " · não veio na última consulta" : ""));
      });
      if (x.agendamentos && !x.agendamentos.length) linhas.push("Nenhum agendamento importado para este paciente.");
    } else if (modulo === "entradas") {
      linhas.push("Recebimento " + x.recebimentoId + (x.forma ? " · " + x.forma : "") + " · " + brl(x.valor) + " · " +
        (x.recebido ? "recebido" + (x.recebidoEm ? " em " + dataBR(x.recebidoEm) : "") : "não consta como recebido") + (x.confirmado ? " · confirmado" : "") + ".");
      linhas.push("Liquidação bancária: não informada pelo Clinicorp.");
      if (x.divergente) linhas.push("Mudou no Clinicorp depois do vínculo — conferir no painel.");
    }
    linhas.forEach(function (t) { b.appendChild(el("div", "fs-int-linha", t)); });
    var sit = situacao(modulo);
    b.appendChild(el("div", "fs-int-pe", "Só contexto: alterações são feitas no painel → Integrações." + (sit === "suspensa" ? " A integração está suspensa." : "") +
      (x.vistoEm ? " Sincronizado " + quando(x.vistoEm) + "." : "")));
    return b;
  }

  global.FloreSerIntegracao = { carregar: carregar, de: de, bloco: bloco, situacao: situacao };
})(window);
