/* =====================================================================
   28_ServicoBusca — uma pergunta, três módulos
   ---------------------------------------------------------------------
   Só para contas individuais: somar três senhas compartilhadas para
   fingir uma visão geral daria a quem tem uma delas um caminho para as
   outras. Onde procurar sai das permissões reais da conta. A resposta é
   magra de propósito — título, subtítulo e id — para a busca não virar
   uma porta lateral para ler fichas inteiras.
   ===================================================================== */

var MAX_POR_MODULO = 8;
var MAX_BUSCA_TOTAL = 24;
var MIN_TERMO_BUSCA = 2;

function buscaGlobal(ctx) {
  var bruto = String(ctx.dados.termo || "").trim();
  if (bruto.length < MIN_TERMO_BUSCA) return { resultados: [], curto: true };
  var permissoes = permissoesDe(ctx.sessao.usuario);
  var termo = chaveDeNome(bruto), digitos = soDigitos(bruto), porTelefone = digitos.length >= 4;
  var combina = function (t) { return chaveDeNome(t).indexOf(termo) >= 0; };
  var resultados = [];

  return lerComConsistencia(function () {
    if (permissoes.crm) {
      var n = 0;
      lerTudo("crm_leads").forEach(function (l) {
        if (n >= MAX_POR_MODULO) return;
        if (!(combina(l.nome) || combina(l.interesse) || combina(l.origem) || (porTelefone && soDigitos(l.whatsapp).indexOf(digitos) >= 0))) return;
        var cad = l.etapa === "agendado"
          ? (vazio(l.dataAgendada) ? "sem data do atendimento" : "atendimento " + dataBR(l.dataAgendada))
          : (CADENCIAS_CRM[l.cadencia] || "");
        var arquivada = !!(ETAPAS_CRM[l.etapa] || {}).arquivo;
        resultados.push({ modulo: "crm", tipo: "lead", id: l.id, titulo: l.nome || "(sem nome)",
          subtitulo: [nomeEtapa(l.etapa), cad, arquivada ? "Arquivo" : ""].filter(String).join(" · "), arquivado: arquivada });
        n++;
      });
    }
    if (permissoes.agenda) {
      var cats = {};
      lerTudo("agenda_categorias").forEach(function (c) { cats[c.id] = c.nome; });
      var ag = agrupar(lerTudo("agenda_agendamentos"), "pacienteId");
      var ciclos = agrupar(lerTudo("agenda_ciclos"), "pacienteId");
      var m = 0;
      lerTudo("agenda_pacientes").forEach(function (p) {
        if (m >= MAX_POR_MODULO) return;
        if (!(combina(p.nome) || (porTelefone && soDigitos(p.whatsapp).indexOf(digitos) >= 0) || combina(cats[p.categoriaId] || ""))) return;
        var proxima = (ag[p.id] || []).map(function (a) { return a.data; }).filter(Boolean).sort()[0] || "";
        var areas = (ciclos[p.id] || []).map(function (c) { return AREAS_NOME[c.area]; }).filter(Boolean);
        resultados.push({ modulo: "agenda", tipo: "paciente", id: p.id, titulo: p.nome || "(sem nome)",
          subtitulo: [areas.join(", "), proxima ? "próxima " + dataBR(proxima) : "", p.arquivada ? "Arquivada" : ""].filter(String).join(" · "),
          arquivado: p.arquivada === true, vinculado: !!p.crmLeadId });
        m++;
      });
    }
    if (permissoes.entradas) {
      var pags = agrupar(lerTudo("ent_pagamentos"), "entradaId");
      var k = 0;
      lerTudo("ent_entradas").slice().sort(function (a, b) { return String(b.data || "").localeCompare(String(a.data || "")); })
        .forEach(function (e) {
          if (k >= MAX_POR_MODULO) return;
          if (!(combina(e.nome) || combina(e.descricao))) return;
          resultados.push({ modulo: "entradas", tipo: "entrada", id: e.id, titulo: e.nome || "(sem nome)",
            subtitulo: [dinheiroBR(totalPagamentos(pags[e.id] || [])), dataBR(e.data)].filter(String).join(" · "), arquivado: false });
          k++;
        });
    }
    return { resultados: resultados.slice(0, MAX_BUSCA_TOTAL),
      procurouEm: { crm: !!permissoes.crm, agenda: !!permissoes.agenda, entradas: !!permissoes.entradas } };
  });
}
