/* =====================================================================
   34_ServicoExecucao — Orçamentos, planos e execução, dentro do Financeiro
   ---------------------------------------------------------------------
   Responde, por paciente e plano: o que ela CONTRATOU, o que RECEBEU em
   cada atendimento e o que ainda pode AGENDAR ou usar como crédito.

   ENTIDADES (cada uma com identidade própria):
     documento   o orçamento de origem (Clinicorp ou Alveare). Pode ser
                 misto: seus itens são classificados em tratamento,
                 produto ou avulso (exe_conferencias, classe).
     plano       os itens de TRATAMENTO de um documento. Só eles entram no
                 progresso. Cada contratação é um plano, mesmo repetindo
                 procedimento de um plano anterior.
     linha       um procedimento do plano, com a quantidade contratada e a
                 origem dela: quantidade explícita (Alveare), linhas que
                 valem uma unidade cada (Clinicorp), ou quantidade lida no
                 texto — essa fica "a conferir" até alguém confirmar.
     atendimento o agendamento identificado (Clinicorp, Agenda), com
                 profissional, situação, previstos e observação original;
                 o complemento do Alveare (exe_atendimentos) guarda o que a
                 API não traz e a interpretação confirmada da observação.
     execução    o procedimento ENTREGUE num atendimento (exe_execucoes),
                 com a natureza: conforme o plano · em substituição ·
                 bônus (gratuito) · avulso · a decidir.
     troca       compromisso registrado uma vez (exe_trocas): N unidades
                 de uma linha trocadas por M de outro procedimento, com
                 preços e custos de referência gravados na data.
     crédito     gerado pela troca para algo mais barato; as UTILIZAÇÕES
                 ficam em exe_creditos, sempre com destino explícito.

   REGRA CENTRAL. Realização só existe em execução ligada a agendamento
   identificado. Nunca contam: contador do Controle de Sessões, o campo
   Session, o "Executed" do orçamento, pagamento, aprovação, data que
   passou. Cancelamento e falta ficam no histórico sem contar.

   UMA APURAÇÃO (apurarModelo). Lista, ficha da paciente, plano, versão
   para a paciente e associação automática saem do mesmo cálculo; corrigir
   um fato uma vez muda histórico, progresso e saldos juntos.

   ASSOCIAÇÃO. Automática só quando inequívoca: o código do procedimento
   tem saldo em UM só plano (ou, sem saldo, existe UM só plano em andamento
   com ele — vira excedente visível). Dois planos, ou só o nome parecido →
   a pessoa escolhe, no próprio atendimento, vendo os saldos. A escolha fica
   naquela execução (e uma nova sincronização ou importação do MESMO
   atendimento a preserva); um atendimento novo não herda a escolha — ela
   aparece só como sugestão.

   BÔNUS E CRÉDITO (valoresDaTroca). Valores de venda de referência das
   quantidades totais: substituto mais caro → bônus = diferença − o que foi
   cobrado; mais barato → crédito = diferença. Sem referência identificável
   → pendente de conferência (nunca rateio inventado). Custos pela ficha
   aplicável à data (versão aprovada; senão a ficha atual, marcada como
   estimativa); custo desconhecido → "não informado".
   ===================================================================== */

var EXE_ESTADOS = { previsto: "Previsto", realizado: "Realizado", desfeito: "Desfeito" };
var EXE_STATUS_AGENDA = { agendado: "Agendado", confirmado: "Confirmado", compareceu: "Compareceu", falta: "Falta", cancelado: "Cancelado" };
var EXE_NATUREZAS = { contratado: "Conforme o plano", substituicao: "Em substituição", gratuito: "Bônus", avulso: "Avulso" };
var EXE_CLASSES = { tratamento: "Plano de tratamento", produto: "Produto", avulso: "Atendimento avulso" };
var EXE_INTERPRETACOES = { observacao: "Mantida como observação", substituicao: "Substituição", complemento: "Complemento", bonus: "Bônus" };

function numOuNull(v) { return v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v); }

/* ---------------- pacientes: uma chave para as duas origens ---------------- */

function mapaDePacientes(c) {
  var porExterno = {}, porLocal = {};
  lerTudo("int_vinculos").forEach(function (v) {
    if (v.estado !== "ativo" || v.tipo !== "paciente" || v.localTipo !== "paciente" || (v.assinante || "") !== (c.assinante || "")) return;
    porExterno[v.externoId] = v.localId; porLocal[v.localId] = v.externoId;
  });
  var nomes = {};
  lerTudo("agenda_pacientes").forEach(function (p) { nomes[p.id] = p.nome || ""; });
  return {
    deExterno: function (ext) { return porExterno[ext] ? "loc:" + porExterno[ext] : "clc:" + ext; },
    deLocal: function (pid) { return "loc:" + pid; },
    nome: function (ref, padrao) { return ref.indexOf("loc:") === 0 ? (nomes[ref.slice(4)] || padrao || "") : (padrao || ""); }
  };
}

/* ---------------- status do agendamento ---------------- */

function categoriaDoStatus(statusId, c) {
  var manual = (c.categoriaStatus || {})[statusId];
  if (manual && EXE_STATUS_AGENDA[manual]) return manual;
  var st = (c.statusAgenda || {})[statusId];
  if (!st) return "";
  var t = (String(st.chave || "") + " " + String(st.nome || "")).toUpperCase();
  if (/CONFIRM/.test(t)) return "confirmado";
  if (/NO_?SHOW|MISS|FALT|AUSEN/.test(t)) return "falta";
  if (/CANCEL|DESMARC/.test(t)) return "cancelado";
  if (/ATTEND|ATEND|FINISH|CONCLU|COMPARE|PRESEN/.test(t)) return "compareceu";
  return "";
}

function statusDoAgendamento(a, c) {
  if (a.excluido) return { categoria: "cancelado", descricao: "excluído no Clinicorp" };
  if (a.cancelado) return { categoria: "cancelado", descricao: "desmarcado no Clinicorp" };
  var st = (c.statusAgenda || {})[a.statusId];
  var cat = categoriaDoStatus(a.statusId, c);
  return { categoria: cat || "agendado", descricao: st ? st.nome : (a.statusId ? "status " + a.statusId : "sem status"), conferir: !cat && !!a.statusId };
}

/* ---------------- atendimentos ---------------- */

/* Previstos de um agendamento do Clinicorp: Procedures NÃO é documentado
   em /appointment/list; usado só se vier. Previsto não é realização. */
function previstosDoClinicorp(a) {
  if (Array.isArray(a.previstos) && a.previstos.length) return a.previstos;
  return String(a.procedimento || "").split(/\s*[,;]\s*/).filter(Boolean).map(function (d) { return { descricao: d.slice(0, 160), ref: "" }; });
}

function agendamentosConhecidos(c, pac) {
  var lista = {};
  var nomes = c.profissionais || {};
  lerTudo("int_externos").forEach(function (x) {
    if (x.tipo !== "agendamento" || (x.assinante || "") !== (c.assinante || "") || !x.dados) return;
    var a = x.dados;
    var prev = previstosDoClinicorp(a);
    lista["clinicorp:" + x.externoId] = { ref: "clinicorp:" + x.externoId, tipo: "clinicorp", id: x.externoId, data: a.dia, hora: a.inicio || "",
      pacienteRef: a.pacienteExternoId ? pac.deExterno(a.pacienteExternoId) : "", pacienteNome: a.pacienteNome || "",
      profissionalId: a.profissionalId || "", profissional: nomes[a.profissionalId] || "", status: statusDoAgendamento(a, c),
      previstos: prev, previstosFonte: prev.length ? "clinicorp" : "", observacao: a.observacao || "", observacaoFonte: a.observacao ? "clinicorp" : "",
      area: (c.areaPorProfissional || {})[a.profissionalId] || "", procedimentoTexto: a.procedimento || "" };
  });
  var hoje = hojeNaClinica();
  lerTudo("agenda_agendamentos").forEach(function (g) {
    lista["agenda:" + g.id] = { ref: "agenda:" + g.id, tipo: "agenda", id: g.id, data: g.data, hora: "", pacienteRef: pac.deLocal(g.pacienteId),
      pacienteNome: pac.nome(pac.deLocal(g.pacienteId)), area: g.area || "", profissional: "", previstos: [], previstosFonte: "", observacao: "", observacaoFonte: "",
      status: { categoria: "agendado", descricao: g.data < hoje ? "na Agenda, data passada" : "na Agenda" } };
  });
  /* sessões já vividas na Agenda (tipo "sessao"): agendamento que existiu,
     marcado pelo relógio — não é prova de presença nem de procedimento */
  lerTudo("agenda_historico").forEach(function (h) {
    if (!h.data || h.tipo !== "sessao") return;
    lista["agenda-hist:" + h.id] = { ref: "agenda-hist:" + h.id, tipo: "agenda-hist", id: h.id, data: h.data, hora: "", pacienteRef: pac.deLocal(h.pacienteId),
      pacienteNome: pac.nome(pac.deLocal(h.pacienteId)), area: h.area || "", profissional: "", previstos: [], previstosFonte: "", observacao: "", observacaoFonte: "",
      status: { categoria: "agendado", descricao: "sessão da Agenda" } };
  });
  /* complemento do Alveare: o que a API não traz e a leitura confirmada.
     A origem tem precedência; o relatório completa, sem apagar a origem. */
  lerTudo("exe_atendimentos").forEach(function (x) {
    var a = lista[x.id];
    if (!a) return;
    var prevC = Array.isArray(x.previstos) ? x.previstos : [];
    if (prevC.length) {
      if (!a.previstos.length) { a.previstos = prevC; a.previstosFonte = x.origem === "importacao" ? "relatorio" : "alveare"; }
      else a.previstosComplemento = prevC;
    }
    if (x.observacao) {
      if (!a.observacao) { a.observacao = x.observacao; a.observacaoFonte = x.origem === "importacao" ? "relatorio" : "alveare"; }
      else if (x.observacao !== a.observacao) a.observacaoComplemento = x.observacao;
    }
    if (x.profissional && !a.profissional) a.profissional = x.profissional;
    a.marcador = x.marcador || "";
    a.interpretacao = x.interpretacao || "";
    a.observacaoInterpretada = x.observacaoInterpretada || "";
    a.observacaoLiberada = x.observacaoLiberada === true;
    a.notas = x.notas || "";
    a._revAtendimento = Number(x.rev) || 0;
  });
  return lista;
}

/* ---------------- documentos (orçamentos) e linhas do plano ---------------- */

/* "4 sessões de X", "1x Produto", "X (4 sessões)" → 4 / 1. Só sugestão:
   quantidade lida em texto é apresentada para conferência. */
function quantidadeDoTexto(t) {
  var s = String(t || "").toLowerCase();
  var m = s.match(/^\s*(\d{1,3})\s*(?:x|×|sess|unidade|aplica)/) || s.match(/(\d{1,3})\s*sess/);
  var n = m ? Number(m[1]) : null;
  return n && n > 0 && n <= 200 ? n : null;
}

function chaveDoProcedimento(i) { return i.procedimentoRef ? "r:" + i.procedimentoRef : "n:" + chaveDeNome(i.procedimento); }

function orcamentosConhecidos(c, pac) {
  var lista = {};
  lerTudo("int_externos").forEach(function (x) {
    if (x.tipo !== "orcamento" || (x.assinante || "") !== (c.assinante || "") || !x.dados) return;
    var o = x.dados;
    var ref = "clinicorp:" + x.externoId;
    lista[ref] = { ref: ref, origem: "clinicorp", id: x.externoId, data: o.criadoEm || o.emitidoEm || "", aprovadoEm: o.aprovadoEm || "", situacao: o.status || "",
      pacienteRef: o.pacienteExternoId ? pac.deExterno(o.pacienteExternoId) : "clc:?", pacienteNome: o.pacienteNome || "",
      desconto: o.descontoValor, valor: o.valor, profissional: o.profissional || "",
      itens: (o.procedimentos || []).filter(function (p) { return !p.excluido; }).map(function (p, k) {
        return { ref: ref + ":" + (p.id || k), procedimento: p.descricao || "", procedimentoRef: p.ref ? String(p.ref) : "", quantidade: "1",
          valorTabela: p.valorTabela === undefined ? null : p.valorTabela, valorAcordado: p.valor === undefined ? null : p.valor,
          naoAprovado: !!p.naoAprovado, executadoNoClinicorp: !!p.executado, executadoEm: p.executadoEm || null, classe: "" };
      }), procedimentosIncompletos: !!o.procedimentosIncompletos };
  });
  var porOrc = agrupar(lerTudo("exe_orcamento_itens"), "orcamentoId");
  lerTudo("exe_orcamentos").forEach(function (o) {
    var ref = "local:" + o.id;
    lista[ref] = { ref: ref, origem: "local", id: o.id, data: o.data || "", aprovadoEm: "", situacao: o.situacao || "aberto", pacienteRef: o.pacienteRef || "",
      pacienteNome: pac.nome(o.pacienteRef || "", o.pacienteNome), desconto: o.descontoGeral, _rev: Number(o.rev) || 0, notas: o.notas || "",
      itens: (porOrc[o.id] || []).sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); }).map(function (i) {
        var q = qtdMil(i.quantidade) || 0;
        var total = i.valorUnitario === null || i.valorUnitario === undefined ? null : Math.round(Number(i.valorUnitario) * q / 1000) - (Number(i.desconto) || 0);
        return { ref: ref + ":" + i.id, id: i.id, procedimento: i.procedimento, procedimentoRef: i.procedimentoRef || "", fichaId: i.fichaId || "",
          quantidade: i.quantidade, valorTabela: i.valorUnitario, valorAcordado: total, desconto: i.desconto, classe: i.classe || "tratamento" };
      }) };
  });
  return lista;
}

function conferenciasPorId() { return mapaPorId(lerTudo("exe_conferencias")); }

/* Classe de um item: a escolha para AQUELE item > a regra do procedimento
   (pelo id do cadastro, identificação segura) > o tipo da ficha ligada >
   a classe gravada no orçamento do Alveare > a confirmar. Nome sozinho não
   classifica. */
function classificador(conf) {
  var fichasPorRef = {}, fichasPorId = {};
  lerTudo("fin_fichas").forEach(function (f) { fichasPorId[f.id] = f; if (f.clinicorpProcedimentoId) fichasPorRef[String(f.clinicorpProcedimentoId)] = f; });
  var deFicha = function (f) { return f ? (f.tipo === "produto" ? "produto" : "tratamento") : ""; };
  return function (i) {
    var a = conf["classe:item:" + i.ref];
    if (a && EXE_CLASSES[a.valor]) return { classe: a.valor, fonte: "item" };
    if (i.classe && EXE_CLASSES[i.classe]) return { classe: i.classe, fonte: "orcamento" };
    var b = i.procedimentoRef ? conf["classe:ref:" + i.procedimentoRef] : null;
    if (b && EXE_CLASSES[b.valor]) return { classe: b.valor, fonte: "procedimento" };
    var f = (i.fichaId && fichasPorId[i.fichaId]) || (i.procedimentoRef && fichasPorRef[i.procedimentoRef]) || null;
    if (f) return { classe: deFicha(f), fonte: "ficha" };
    return { classe: "", fonte: "" };
  };
}

/* Quantidade contratada de uma linha, com a origem. Nunca soma a
   quantidade do texto com as linhas desdobradas (sem 4 × 4 = 16). */
function quantidadeDaLinha(l, o, conf) {
  l.aConferir = false; l.sugestao = null;
  if (o.origem === "local") { l.contratado = l.qtdExplicita; l.contratadoFonte = "orcamento"; }
  else {
    var ts = l.textos.filter(function (t) { return t !== null; });
    l.contratado = l.n * 1000; l.contratadoFonte = "linhas";
    if (ts.length) {
      var todosIguaisAoN = l.textos.every(function (t) { return t === l.n; });
      var umPorLinha = l.textos.every(function (t) { return t === null || t === 1; });
      if (!todosIguaisAoN && !umPorLinha) {
        l.aConferir = true;
        l.sugestao = Math.max.apply(null, ts) * 1000;
      }
    }
  }
  var cf = conf["qtd:" + o.ref + "|" + l.chave];
  if (cf && qtdMil(cf.valor)) {
    l.contratado = qtdMil(cf.valor); l.contratadoFonte = "conferida"; l.aConferir = false; l.conferidaPor = cf.autorNome || "";
  }
  l.precoRef = l.tabelaConhecida && l.contratado && !l.aConferir ? Math.round(l.valorTabela * 1000 / l.contratado) : null;
  l.precoRefBase = l.precoRef === null ? (l.aConferir ? "quantidade a conferir" : "sem valor de tabela no orçamento") :
    (o.origem === "local" ? "valor do item no orçamento do Alveare" : "valor de tabela do orçamento " + o.id + " (antes de desconto)");
  l.acordadoUnit = l.acordadoConhecido && l.contratado && !l.aConferir ? Math.round(l.valorAcordado * 1000 / l.contratado) : null;
}

function montarDocumentos(c, pac) {
  var orcs = orcamentosConhecidos(c, pac);
  var conf = conferenciasPorId();
  var classe = classificador(conf);
  var docs = {};
  Object.keys(orcs).forEach(function (k) {
    var o = orcs[k];
    var linhas = [], porChave = {}, fora = [];
    o.itens.forEach(function (i) {
      if (i.naoAprovado) { fora.push({ ref: i.ref, procedimento: i.procedimento, motivo: "fora da aprovação" }); return; }
      var chave = chaveDoProcedimento(i);
      var l = porChave[chave];
      if (!l) {
        var cl = classe(i);
        l = porChave[chave] = { chave: chave, docRef: o.ref, procedimento: i.procedimento, procedimentoRef: i.procedimentoRef, classe: cl.classe, classeFonte: cl.fonte,
          itens: [], ref: i.ref, id: i.id || "", fichaId: i.fichaId || "", n: 0, qtdExplicita: 0, textos: [], valorTabela: 0, tabelaConhecida: true,
          valorAcordado: 0, acordadoConhecido: true, executadoNoClinicorp: false, executadoEm: null };
        linhas.push(l);
      }
      var q = qtdMil(i.quantidade) || 0;
      l.itens.push(i.ref); l.n++; l.qtdExplicita += q;
      l.textos.push(quantidadeDoTexto(i.procedimento));
      if (i.valorTabela === null || i.valorTabela === undefined) l.tabelaConhecida = false;
      else l.valorTabela += o.origem === "local" ? Math.round(Number(i.valorTabela) * q / 1000) : Number(i.valorTabela);
      if (i.valorAcordado === null || i.valorAcordado === undefined) l.acordadoConhecido = false; else l.valorAcordado += Number(i.valorAcordado);
      if (i.executadoNoClinicorp) { l.executadoNoClinicorp = true; l.executadoEm = i.executadoEm || l.executadoEm; }
      if (!l.fichaId && i.fichaId) l.fichaId = i.fichaId;
    });
    linhas.forEach(function (l) { quantidadeDaLinha(l, o, conf); });
    var d = {};
    Object.keys(o).forEach(function (x) { d[x] = o[x]; });
    d.linhas = linhas; d.fora = fora;
    d.cancelado = /REJECTED|CANCEL|recusado|cancelado/i.test(o.situacao || "");
    docs[o.ref] = d;
  });
  return docs;
}

function ehTratamento(l) { return l.classe === "tratamento" || !l.classe; }

/* ---------------- fichas: custo e preço na data ---------------- */

var _FICHAS_DATA = null;
function fichasParaData() {
  if (_FICHAS_DATA && _FICHAS_DATA.epoca === _TAB) return _FICHAS_DATA;
  var fichas = lerTudo("fin_fichas");
  var porRef = {};
  fichas.forEach(function (f) { if (f.clinicorpProcedimentoId) porRef[String(f.clinicorpProcedimentoId)] = f; });
  _FICHAS_DATA = { epoca: _TAB, fichas: mapaPorId(fichas), porRef: porRef, versoes: agrupar(lerTudo("fin_fichas_versoes"), "fichaId"), insumos: null };
  return _FICHAS_DATA;
}

function fichaDe(fichaId, ref) {
  var F = fichasParaData();
  return (fichaId && F.fichas[fichaId]) || (ref && F.porRef[String(ref)]) || null;
}

function versaoNaData(fichaId, dia) {
  var vs = (fichasParaData().versoes[fichaId] || []).filter(function (v) { return String(v.aprovadaEm || "").slice(0, 10) <= dia; });
  vs.sort(function (a, b) { return (Number(a.versao) || 0) - (Number(b.versao) || 0); });
  return vs.length ? vs[vs.length - 1] : null;
}

/* Custo unitário pela ficha APLICÁVEL À DATA: a versão aprovada em vigor
   naquele dia; sem ela, a ficha atual (estimativa). Sem ficha ou sem
   custo: null — "não informado". */
function custoNaData(fichaId, ref, dia) {
  var f = fichaDe(fichaId, ref);
  if (!f) return { fichaId: "", custo: null, fonte: "", base: "sem ficha de custo" };
  var v = versaoNaData(f.id, dia);
  if (v && v.resultado && v.resultado.custoTotal !== undefined && v.resultado.custoTotal !== null) {
    return { fichaId: f.id, custo: Number(v.resultado.custoTotal), fonte: "ficha", base: "ficha " + f.nome + ", versão aprovada v" + v.versao };
  }
  var F = fichasParaData();
  if (!F.insumos) F.insumos = mapaPorId(lerTudo("fin_insumos"));
  var calc = calcularFicha(f, F.insumos, F.fichas);
  if (calc.custoTotal === undefined || calc.custoTotal === null) return { fichaId: f.id, custo: null, fonte: "", base: "ficha " + f.nome + " sem custo completo" };
  return { fichaId: f.id, custo: calc.custoTotal, fonte: "estimativa", base: "ficha " + f.nome + " atual (estimativa)" };
}

function precoNaData(fichaId, ref, dia) {
  var f = fichaDe(fichaId, ref);
  if (!f) return { preco: null, base: "" };
  var v = versaoNaData(f.id, dia);
  if (v && v.dados && v.dados.precoAtual !== null && v.dados.precoAtual !== undefined && v.dados.precoAtual !== "") return { preco: Number(v.dados.precoAtual), base: "preço da ficha " + f.nome + " (versão v" + v.versao + ")" };
  if (f.precoAtual !== null && f.precoAtual !== undefined && f.precoAtual !== "") return { preco: Number(f.precoAtual), base: "preço atual da ficha " + f.nome };
  return { preco: null, base: "" };
}

/* compatível com a 4.3.0 */
function custoDaFicha(e) { var x = custoNaData(e.fichaId, e.procedimentoRef, e.agendamentoData || hojeNaClinica()); return { fichaId: x.fichaId, custo: x.custo, fonte: x.fonte }; }

/* ---------------- bônus e crédito de uma troca ---------------- */

function valoresDaTroca(t, entregueMil) {
  var qo = qtdMil(t.quantidadeOrigem) || 0, qs = qtdMil(t.quantidadePrometida) || 0;
  var po = numOuNull(t.precoOrigem), ps = numOuNull(t.precoSubstituto);
  var vo = po === null ? null : Math.round(po * qo / 1000), vs = ps === null ? null : Math.round(ps * qs / 1000);
  var cobrado = Number(t.diferencaCobrada) || 0;
  var r = { valorOrigem: vo, valorSubstituto: vs, cobrado: cobrado, bonus: null, credito: null, pendente: vo === null || vs === null };
  if (!r.pendente) {
    var dif = vs - vo;
    r.bonus = dif > 0 ? Math.max(0, dif - cobrado) : 0;
    r.credito = dif < 0 ? -dif : 0;
  }
  var co = numOuNull(t.custoOrigem), cs = numOuNull(t.custoSubstituto);
  r.custoEntregue = cs === null ? null : Math.round(cs * (entregueMil || 0) / 1000);
  r.custoAdicional = cs === null || co === null ? null : Math.round(cs * qs / 1000) - Math.round(co * qo / 1000);
  return r;
}

/* ---------------- a apuração (uma só) ---------------- */

function naturezaDe(e) {
  if (e.natureza && (EXE_NATUREZAS[e.natureza] || e.natureza === "pendente")) return e.natureza === "pendente" ? "" : e.natureza;
  return e.itemRef ? "contratado" : "";
}

function execucaoProcedimento(e, ag, conta, nat) {
  return { id: e.id, agendamentoRef: e.agendamentoTipo + ":" + e.agendamentoId, agendamentoTipo: e.agendamentoTipo, agendamentoId: e.agendamentoId,
    agendamentoData: e.agendamentoData, agendamentoHora: ag ? ag.hora : "", agendamentoStatus: ag ? ag.status : null, profissional: ag ? ag.profissional || "" : "",
    pacienteRef: e.pacienteRef, pacienteNome: e.pacienteNome, procedimento: e.procedimento, procedimentoRef: e.procedimentoRef, fichaId: e.fichaId,
    quantidade: e.quantidade, estado: e.estado, orcamentoRef: e.orcamentoRef, itemRef: e.itemRef, associacao: e.associacao,
    natureza: nat === undefined ? naturezaDe(e) : nat, trocaId: e.trocaId || "", valorReferencia: numOuNull(e.valorReferencia), baseReferencia: e.baseReferencia || "",
    custoUnitario: numOuNull(e.custoUnitario), custoFonte: e.custoFonte || "", baseCusto: e.baseCusto || "",
    valorUnitario: numOuNull(e.valorUnitario), origem: e.origem, conta: conta, notas: e.notas, _rev: Number(e.rev) || 0 };
}

function apurarModelo(c) {
  _FICHAS_DATA = null;
  var pac = mapaDePacientes(c);
  var ags = agendamentosConhecidos(c, pac);
  var docs = montarDocumentos(c, pac);
  var hoje = hojeNaClinica();
  var linhaDoItem = {};
  Object.keys(docs).forEach(function (k) {
    docs[k].linhas.forEach(function (l) {
      l.realizada = 0; l.agendada = 0; l.execucoes = []; l.trocas = [];
      l.itens.forEach(function (r) { linhaDoItem[r] = l; });
    });
  });
  var trocas = {};
  lerTudo("exe_trocas").forEach(function (t) { trocas[t.id] = { reg: t, ativa: t.estado !== "desfeita", entregue: 0, agendado: 0, execucoes: [] }; });
  var porAg = {}, pendentes = [], avulsos = [], gratuitos = [], todas = [];
  lerTudo("exe_execucoes").forEach(function (e) {
    var agRef = e.agendamentoTipo + ":" + e.agendamentoId;
    var ag = ags[agRef] || null;
    var cat = ag ? ag.status.categoria : null;
    var conta = e.estado === "realizado" && cat !== "cancelado" && cat !== "falta";
    var prevista = e.estado === "previsto" && cat !== "cancelado" && cat !== "falta" && (e.agendamentoData || "") >= hoje;
    var nat = naturezaDe(e);
    var pub = execucaoProcedimento(e, ag, conta, nat);
    pub.planoRef = "";
    (porAg[agRef] = porAg[agRef] || []).push(pub);
    todas.push(pub);
    if (e.estado === "desfeito") return;
    var q = qtdMil(e.quantidade) || 0;
    if (nat === "substituicao") {
      var t = trocas[e.trocaId];
      if (t && t.ativa) { if (conta) t.entregue += q; if (prevista) t.agendado += q; t.execucoes.push(pub); pub.planoRef = t.reg.orcamentoRef; return; }
      pendentes.push(pub); return;
    }
    if (nat === "contratado") {
      var l = linhaDoItem[e.itemRef];
      if (l) { if (conta) l.realizada += q; if (prevista) l.agendada += q; l.execucoes.push(pub); pub.planoRef = l.docRef; return; }
    }
    if (nat === "gratuito") { pub.planoRef = e.orcamentoRef && docs[e.orcamentoRef] ? e.orcamentoRef : ""; gratuitos.push(pub); return; }
    if (nat === "avulso") { avulsos.push(pub); return; }
    pendentes.push(pub);
  });
  Object.keys(trocas).forEach(function (id) {
    var t = trocas[id];
    t.prometida = qtdMil(t.reg.quantidadePrometida) || 0;
    t.origemQtd = qtdMil(t.reg.quantidadeOrigem) || 0;
    t.completa = t.entregue >= t.prometida;
    t.restante = Math.max(0, t.prometida - t.entregue);
    if (!t.ativa) return;
    var d = docs[t.reg.orcamentoRef];
    var l = d ? d.linhas.filter(function (x) { return x.chave === t.reg.linhaChave; })[0] : null;
    t.linha = l || null;
    if (l) l.trocas.push(t);
  });
  /* números de cada linha */
  Object.keys(docs).forEach(function (k) {
    docs[k].linhas.forEach(function (l) {
      var C = l.contratado || 0;
      l.substituida = 0; l.comprometida = 0;
      l.trocas.forEach(function (t) { if (t.completa) l.substituida += t.origemQtd; else l.comprometida += t.origemQtd; });
      var usado = l.realizada + l.substituida + l.comprometida;
      l.cumprida = Math.min(C, l.realizada + l.substituida);
      l.disponivel = Math.max(0, C - usado);
      l.excedente = Math.max(0, usado - C);
      l.restante = Math.max(0, C - l.cumprida);
    });
  });
  /* créditos usados */
  var usos = agrupar(lerTudo("exe_creditos").filter(function (u) { return u.estado !== "estornado"; }), "trocaId");
  var todosUsos = lerTudo("exe_creditos");
  return { pac: pac, ags: ags, docs: docs, trocas: trocas, porAg: porAg, pendentes: pendentes, avulsos: avulsos, gratuitos: gratuitos, todas: todas,
    usos: usos, todosUsos: todosUsos, hoje: hoje, linhaDoItem: linhaDoItem };
}

/* Resumo de um plano (os itens de tratamento de um documento). */
function resumoDoPlano(M, d) {
  var linhas = d.linhas.filter(ehTratamento);
  var r = { ref: d.ref, contratadas: 0, cumpridas: 0, restante: 0, excedente: 0, disponivel: 0, agendada: 0, valorAcordado: 0, valorRealizado: 0,
    valorConhecido: true, atendimentos: 0, procedimentos: 0, primeiroAtendimento: null, pendencias: [] };
  var ags = {}, datas = [];
  var contar = function (e) { if (!e.conta) return; ags[e.agendamentoRef] = true; r.procedimentos += qtdMil(e.quantidade) || 0; datas.push(e.agendamentoData); };
  linhas.forEach(function (l) {
    var C = l.contratado || 0;
    r.contratadas += C; r.cumpridas += l.cumprida; r.restante += l.restante; r.excedente += l.excedente; r.disponivel += l.disponivel; r.agendada += l.agendada;
    if (l.acordadoConhecido) {
      r.valorAcordado += l.valorAcordado;
      r.valorRealizado += C ? Math.round(l.valorAcordado * l.cumprida / C) : 0;
    } else r.valorConhecido = false;
    l.execucoes.forEach(contar);
    if (l.aConferir) r.pendencias.push({ tipo: "quantidade", chave: l.chave, texto: l.procedimento + ": confira a quantidade contratada (o texto sugere " + qtdTexto(l.sugestao) + ")." });
    if (!l.classe) r.pendencias.push({ tipo: "classe", chave: l.chave, texto: l.procedimento + ": confirme se é tratamento, produto ou avulso." });
  });
  Object.keys(M.trocas).forEach(function (id) {
    var t = M.trocas[id];
    if (!t.ativa || t.reg.orcamentoRef !== d.ref) return;
    t.execucoes.forEach(contar);
    if (valoresDaTroca(t.reg, t.entregue).pendente) r.pendencias.push({ tipo: "preco", trocaId: id, texto: "Troca " + t.reg.procedimentoOrigem + " → " + t.reg.procedimentoSubstituto + ": falta valor de referência para calcular bônus ou crédito." });
  });
  M.gratuitos.forEach(function (e) { if (e.planoRef === d.ref) contar(e); });
  r.atendimentos = Object.keys(ags).length;
  datas.sort();
  r.primeiroAtendimento = datas[0] || null;
  r.progresso = r.contratadas ? Math.round(r.cumpridas * 100 / r.contratadas) : 0;
  var direitos = Object.keys(M.trocas).filter(function (id) { var t = M.trocas[id]; return t.ativa && t.reg.orcamentoRef === d.ref && t.restante > 0; });
  r.direitosPendentes = direitos.length;
  r.situacao = d.cancelado ? "cancelado" : (r.restante === 0 && !direitos.length && linhas.length ? "concluido" : "andamento");
  return r;
}

function tipoDoDocumento(d) {
  var t = d.linhas.some(ehTratamento), p = d.linhas.some(function (l) { return l.classe === "produto"; }), a = d.linhas.some(function (l) { return l.classe === "avulso"; });
  return { tipo: t ? "plano" : p ? "compra" : a ? "avulso" : "vazio", misto: (t ? 1 : 0) + (p ? 1 : 0) + (a ? 1 : 0) > 1, temProdutos: p, temAvulsos: a,
    aClassificar: d.linhas.some(function (l) { return !l.classe; }) };
}

/* Candidatos para uma execução sem plano: linhas dos planos da mesma
   paciente com o mesmo procedimento (código ou nome), com o saldo. */
function candidatosNoModelo(M, e) {
  var saida = [];
  Object.keys(M.docs).forEach(function (k) {
    var d = M.docs[k];
    if (d.pacienteRef !== e.pacienteRef || d.cancelado) return;
    d.linhas.forEach(function (l) {
      if (!ehTratamento(l)) return;
      var porRef = !!(e.procedimentoRef && l.procedimentoRef && String(e.procedimentoRef) === String(l.procedimentoRef));
      var porNome = !porRef && chaveDeNome(e.procedimento) && chaveDeNome(e.procedimento) === chaveDeNome(l.procedimento);
      if (!porRef && !porNome) return;
      saida.push({ planoRef: d.ref, planoId: d.id, origem: d.origem, planoData: d.data, itemRef: l.ref, linhaChave: l.chave, procedimento: l.procedimento,
        porRef: porRef, disponivel: qtdTexto(l.disponivel), contratado: qtdTexto(l.contratado || 0), dispMil: l.disponivel });
    });
  });
  return saida.sort(function (a, b) { return (b.porRef ? 1 : 0) - (a.porRef ? 1 : 0) || String(a.planoData).localeCompare(String(b.planoData)); });
}

/* Associação automática, só quando inequívoca. Nunca copia a escolha de
   outro atendimento: ela vira, no máximo, sugestão. */
function associarNoModelo(M, e) {
  if (e.itemRef) return { itemRef: e.itemRef, orcamentoRef: e.orcamentoRef, associacao: "informada" };
  var cands = candidatosNoModelo(M, e);
  var porRef = cands.filter(function (x) { return x.porRef; });
  var comSaldo = porRef.filter(function (x) { return x.dispMil > 0; });
  var planos = function (l) { var m = {}; l.forEach(function (x) { m[x.planoRef] = true; }); return Object.keys(m); };
  if (comSaldo.length && planos(comSaldo).length === 1) return { itemRef: comSaldo[0].itemRef, orcamentoRef: comSaldo[0].planoRef, associacao: "automatica" };
  if (!comSaldo.length && porRef.length) {
    /* sem saldo em lugar nenhum: se UM só plano em andamento tem o
       procedimento, entra nele como excedente visível */
    var andamento = porRef.filter(function (x) { return resumoDoPlano(M, M.docs[x.planoRef]).situacao === "andamento"; });
    if (planos(andamento).length === 1 && planos(porRef).length === planos(andamento).length) {
      return { itemRef: andamento[0].itemRef, orcamentoRef: andamento[0].planoRef, associacao: "automatica" };
    }
  }
  if (!cands.length) return { itemRef: "", orcamentoRef: "", associacao: "sem_orcamento" };
  return { itemRef: "", orcamentoRef: "", associacao: porRef.length ? "ambigua" : "sugerida" };
}

/* Escolha anterior da mesma paciente e procedimento — mostrada como
   sugestão num atendimento NOVO, nunca aplicada sozinha. */
function sugestaoAnterior(M, e) {
  var ant = M.todas.filter(function (x) { return x.id !== e.id && x.pacienteRef === e.pacienteRef && x.itemRef && x.estado !== "desfeito" &&
    ["informada", "confirmada"].indexOf(x.associacao) >= 0 && (e.procedimentoRef ? x.procedimentoRef === e.procedimentoRef : chaveDeNome(x.procedimento) === chaveDeNome(e.procedimento)); })
    .sort(function (a, b) { return String(a.agendamentoData).localeCompare(String(b.agendamentoData)); }).pop();
  return ant ? ant.itemRef : "";
}

/* Atendimento público: previsto, realizado, observação e pendências. */
function atendimentoPublico(M, a) {
  var exes = M.porAg[a.ref] || [];
  var validas = exes.filter(function (e) { return e.estado !== "desfeito"; });
  var obs = a.observacao || "";
  var cat = a.status.categoria;
  var passado = a.data && a.data <= M.hoje;
  var r = { ref: a.ref, tipo: a.tipo, id: a.id, data: a.data, hora: a.hora || "", status: a.status, profissional: a.profissional || "", area: a.area || "",
    pacienteRef: a.pacienteRef, pacienteNome: a.pacienteNome, previstos: a.previstos || [], previstosFonte: a.previstosFonte || "",
    previstosComplemento: a.previstosComplemento || null, observacao: obs, observacaoFonte: a.observacaoFonte || "", observacaoComplemento: a.observacaoComplemento || "",
    marcador: a.marcador || "", interpretacao: a.interpretacao || "", observacaoInterpretada: a.observacaoInterpretada || "", observacaoLiberada: !!a.observacaoLiberada,
    notas: a.notas || "", _revAtendimento: a._revAtendimento || 0, execucoes: exes };
  r.contaComoAtendimento = validas.some(function (e) { return e.conta; });
  r.aConfirmar = passado && cat !== "cancelado" && cat !== "falta" && !validas.length;
  r.observacaoPendente = !!obs && (!r.interpretacao || r.observacaoInterpretada !== obs);
  /* a origem mudou depois de uma confirmação "conforme previsto"? */
  var chavesPrev = {};
  (a.previstos || []).forEach(function (p) { chavesPrev[chaveDoProcedimento({ procedimentoRef: p.ref, procedimento: p.descricao })] = true; });
  r.divergencia = a.previstosFonte === "clinicorp" && validas.some(function (e) { return e.origem === "confirmacao" && !chavesPrev[chaveDoProcedimento(e)]; });
  var planos = {};
  validas.forEach(function (e) { if (e.planoRef) planos[e.planoRef] = true; });
  r.planos = Object.keys(planos);
  return r;
}

function linhaPublica(l) {
  return { chave: l.chave, ref: l.ref, refs: l.itens, id: l.id, procedimento: l.procedimento, procedimentoRef: l.procedimentoRef, fichaId: l.fichaId,
    classe: l.classe, classeFonte: l.classeFonte, linhasNaOrigem: l.n,
    contratado: qtdTexto(l.contratado || 0), contratadoFonte: l.contratadoFonte, aConferir: l.aConferir, sugestao: l.sugestao === null ? null : qtdTexto(l.sugestao),
    realizada: qtdTexto(l.realizada), substituida: qtdTexto(l.substituida), comprometida: qtdTexto(l.comprometida), disponivel: qtdTexto(l.disponivel),
    excedente: qtdTexto(l.excedente), cumprida: qtdTexto(l.cumprida), restante: qtdTexto(l.restante), agendada: qtdTexto(l.agendada),
    precoRef: l.precoRef, precoRefBase: l.precoRefBase, valorAcordado: l.acordadoConhecido ? l.valorAcordado : null, valorTabela: l.tabelaConhecida ? l.valorTabela : null,
    executadoNoClinicorp: l.executadoNoClinicorp, executadoEm: l.executadoEm, execucoes: l.execucoes };
}

function trocaPublica(M, t) {
  var v = valoresDaTroca(t.reg, t.entregue);
  var usos = (M.usos[t.reg.id] || []);
  var usado = usos.reduce(function (s, u) { return s + (Number(u.valor) || 0); }, 0);
  var reg = t.reg;
  return { id: reg.id, estado: reg.estado || "ativa", ativa: t.ativa, orcamentoRef: reg.orcamentoRef, linhaChave: reg.linhaChave, data: reg.data, agendamentoRef: reg.agendamentoRef || "",
    procedimentoOrigem: reg.procedimentoOrigem, quantidadeOrigem: reg.quantidadeOrigem, procedimentoSubstituto: reg.procedimentoSubstituto,
    procedimentoSubstitutoRef: reg.procedimentoSubstitutoRef || "", fichaSubstitutoId: reg.fichaSubstitutoId || "", quantidadePrometida: reg.quantidadePrometida,
    entregue: qtdTexto(t.entregue), restante: qtdTexto(t.restante), agendado: qtdTexto(t.agendado), completa: t.completa,
    precoOrigem: numOuNull(reg.precoOrigem), precoSubstituto: numOuNull(reg.precoSubstituto), basePreco: reg.basePreco || "", custoOrigem: numOuNull(reg.custoOrigem),
    custoSubstituto: numOuNull(reg.custoSubstituto), baseCusto: reg.baseCusto || "", observacaoOrigem: reg.observacaoOrigem || "", motivo: reg.motivo || "",
    autorNome: reg.autorNome || "", criadoEm: reg.criadoEm, valores: v, creditoUsado: usado, creditoSaldo: v.credito === null ? null : v.credito - usado,
    usos: (M.todosUsos || []).filter(function (u) { return u.trocaId === reg.id; }).map(function (u) { return { id: u.id, valor: Number(u.valor) || 0, destinoRef: u.destinoRef || "",
      destinoDescricao: u.destinoDescricao || "", data: u.data, estado: u.estado || "ativo", motivo: u.motivo || "", autorNome: u.autorNome || "", _rev: Number(u.rev) || 0 }; }),
    execucoes: t.execucoes, _rev: Number(reg.rev) || 0 };
}

function gratuitoPublico(e) {
  var q = qtdMil(e.quantidade) || 0;
  return { execucao: e, procedimento: e.procedimento, quantidade: e.quantidade, data: e.agendamentoData, agendamentoRef: e.agendamentoRef, planoRef: e.planoRef,
    bonus: e.valorReferencia === null ? null : Math.round(e.valorReferencia * q / 1000), baseReferencia: e.baseReferencia,
    custo: e.custoUnitario === null ? null : Math.round(e.custoUnitario * q / 1000), conta: e.conta };
}

/* Benefícios de um conjunto de trocas e bônus: valores comerciais e custos
   em campos distintos; total de custo parcial quando falta algum. */
function totaisDeBeneficio(trocas, gratuitos) {
  var t = { bonus: 0, bonusPendente: 0, credito: 0, creditoUsado: 0, creditoSaldo: 0, custoEntregue: 0, custoAdicional: 0, custoParcial: false, cobrado: 0,
    custoEntregueConhecido: false, custoAdicionalConhecido: false };
  trocas.forEach(function (x) {
    if (!x.ativa) return;
    var v = x.valores;
    if (v.pendente) t.bonusPendente++; else { t.bonus += v.bonus; t.credito += v.credito; }
    t.cobrado += v.cobrado;
    t.creditoUsado += x.creditoUsado;
    if (v.custoEntregue === null) t.custoParcial = true; else { t.custoEntregue += v.custoEntregue; t.custoEntregueConhecido = true; }
    if (v.custoAdicional === null) t.custoParcial = true; else { t.custoAdicional += v.custoAdicional; t.custoAdicionalConhecido = true; }
  });
  gratuitos.forEach(function (g) {
    if (!g.conta) return;
    if (g.bonus === null) t.bonusPendente++; else t.bonus += g.bonus;
    if (g.custo === null) t.custoParcial = true; else { t.custoEntregue += g.custo; t.custoEntregueConhecido = true; }
  });
  t.creditoSaldo = t.credito - t.creditoUsado;
  return t;
}

/* O plano inteiro, na ordem da tela: resumo, contratado × realizado,
   histórico por atendimento, bônus e créditos. */
function planoDetalhado(M, d) {
  var r = resumoDoPlano(M, d);
  var tipo = tipoDoDocumento(d);
  var trocas = Object.keys(M.trocas).filter(function (id) { return M.trocas[id].reg.orcamentoRef === d.ref; }).map(function (id) { return trocaPublica(M, M.trocas[id]); });
  var gratuitos = M.gratuitos.filter(function (e) { return e.planoRef === d.ref; }).map(gratuitoPublico);
  var linhas = d.linhas.filter(ehTratamento).map(linhaPublica);
  var disponiveis = [];
  linhas.forEach(function (l) { if (qtdMil(l.disponivel) > 0) disponiveis.push({ procedimento: l.procedimento, quantidade: l.disponivel, porTroca: false, aConferir: l.aConferir }); });
  trocas.forEach(function (t) { if (t.ativa && qtdMil(t.restante) > 0) disponiveis.push({ procedimento: t.procedimentoSubstituto, quantidade: t.restante, porTroca: true, trocaId: t.id,
    origem: qtdTexto(qtdMil(t.quantidadeOrigem)) + " " + t.procedimentoOrigem }); });
  var refsAg = {};
  linhas.forEach(function (l) { l.execucoes.forEach(function (e) { refsAg[e.agendamentoRef] = true; }); });
  trocas.forEach(function (t) { t.execucoes.forEach(function (e) { refsAg[e.agendamentoRef] = true; }); });
  gratuitos.forEach(function (g) { refsAg[g.agendamentoRef] = true; });
  var historico = Object.keys(refsAg).map(function (k) { return M.ags[k] ? atendimentoPublico(M, M.ags[k]) : null; }).filter(Boolean)
    .sort(function (a, b) { return String(a.data + a.hora).localeCompare(String(b.data + b.hora)); });
  M.pendentes.forEach(function (e) {
    if (candidatosNoModelo(M, e).some(function (x) { return x.planoRef === d.ref; })) r.pendencias.push({ tipo: "associacao", execucaoId: e.id, texto: e.procedimento + " em " + dataBR(e.agendamentoData) + ": escolha a que plano pertence." });
  });
  historico.forEach(function (a) { if (a.observacaoPendente) r.pendencias.push({ tipo: "observacao", agendamentoRef: a.ref, texto: "Atendimento de " + dataBR(a.data) + ": confirme a leitura da observação “" + a.observacao.slice(0, 60) + "”." }); });
  return { ref: d.ref, origem: d.origem, id: d.id, data: d.data, inicio: d.aprovadoEm || d.data, situacaoOrigem: d.situacao, pacienteRef: d.pacienteRef, pacienteNome: d.pacienteNome,
    profissional: d.profissional || "", notas: d.notas || "", _rev: d._rev, tipo: tipo, procedimentosIncompletos: !!d.procedimentosIncompletos,
    resumo: { inicio: d.aprovadoEm || d.data, primeiroAtendimento: r.primeiroAtendimento, situacao: r.situacao, atendimentos: r.atendimentos, procedimentos: qtdTexto(r.procedimentos),
      contratadas: qtdTexto(r.contratadas), cumpridas: qtdTexto(r.cumpridas), restante: qtdTexto(r.restante), excedente: qtdTexto(r.excedente), progresso: r.progresso,
      disponivel: qtdTexto(r.disponivel), agendada: qtdTexto(r.agendada), valorAcordado: r.valorConhecido ? r.valorAcordado : null, valorRealizado: r.valorConhecido ? r.valorRealizado : null,
      pendencias: r.pendencias.length },
    pendencias: r.pendencias, linhas: linhas, disponiveis: disponiveis, historico: historico, trocas: trocas, gratuitos: gratuitos,
    beneficios: totaisDeBeneficio(trocas, gratuitos),
    outrosItens: d.linhas.filter(function (l) { return !ehTratamento(l); }).map(linhaPublica), foraDaAprovacao: d.fora };
}

/* ---------------- a lista (aba Orçamentos e execução) ---------------- */

function apurar(c, filtros) {
  var M = apurarModelo(c);
  var f = filtros || {};
  var busca = chaveDeNome(f.busca || "");
  var saida = Object.keys(M.docs).map(function (k) {
    var d = M.docs[k];
    var r = resumoDoPlano(M, d);
    var tipo = tipoDoDocumento(d);
    var itens = d.linhas.filter(ehTratamento).map(function (l) {
      var p = linhaPublica(l);
      p.orcada = p.contratado; p.valorAcordado = l.acordadoConhecido ? l.valorAcordado : null;
      return p;
    });
    var datasExec = [];
    itens.forEach(function (i) { i.execucoes.forEach(function (e) { if (e.conta) datasExec.push(e.agendamentoData); }); });
    return { ref: d.ref, origem: d.origem, id: d.id, data: d.data, situacao: d.situacao, pacienteRef: d.pacienteRef, pacienteNome: d.pacienteNome,
      desconto: d.desconto, valorTotal: d.valor === undefined ? null : d.valor, profissional: d.profissional || "", itens: itens, notas: d.notas || "",
      _rev: d._rev, procedimentosIncompletos: d.procedimentosIncompletos, tipo: tipo.tipo, misto: tipo.misto, aClassificar: tipo.aClassificar,
      situacaoPlano: r.situacao, progresso: r.progresso, pendencias: r.pendencias.length,
      totais: { orcada: qtdTexto(r.contratadas), realizada: qtdTexto(itens.reduce(function (s, i) { return s + (qtdMil(i.realizada) || 0); }, 0)),
        agendada: qtdTexto(r.agendada), restante: qtdTexto(r.restante), excedente: qtdTexto(r.excedente), cumprida: qtdTexto(r.cumpridas), disponivel: qtdTexto(r.disponivel),
        valorAcordado: r.valorConhecido ? r.valorAcordado : null, valorRealizado: r.valorConhecido ? r.valorRealizado : null },
      datasExecucao: datasExec.sort() };
  }).filter(function (o) {
    if (busca && chaveDeNome(o.pacienteNome).indexOf(busca) < 0 && chaveDeNome(o.id).indexOf(busca) < 0) return false;
    if (f.situacao === "pendente" && Number(o.totais.restante) <= 0) return false;
    if (f.situacao === "concluido" && Number(o.totais.restante) > 0) return false;
    if (f.situacao === "excedente" && Number(o.totais.excedente) <= 0) return false;
    if (f.de || f.ate) {
      var de = f.de || "0000-00-00", ate = f.ate || "9999-12-31";
      if (f.base === "execucao") return o.datasExecucao.some(function (x) { return x >= de && x <= ate; });
      return o.data >= de && o.data <= ate;
    }
    return true;
  }).sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
  var pendentes = M.pendentes.map(function (e) {
    var x = Object.assign({}, e);
    x.candidatos = candidatosNoModelo(M, e);
    x.sugestao = sugestaoAnterior(M, e);
    return x;
  });
  var agendamentos = Object.keys(M.ags).filter(function (k) { return M.porAg[k] || M.ags[k].tipo !== "agenda-hist"; }).map(function (k) {
    var a = M.ags[k];
    return Object.assign({}, a, { execucoes: M.porAg[k] || [] });
  }).sort(function (a, b) { return String(b.data + b.hora).localeCompare(String(a.data + a.hora)); });
  return { orcamentos: saida, agendamentos: agendamentos.slice(0, 400),
    semOrcamento: pendentes.concat(M.avulsos).concat(M.gratuitos.filter(function (g) { return !g.planoRef; })),
    pendentes: pendentes.filter(function (e) { return e.associacao === "ambigua" || e.associacao === "sugerida"; }),
    avulsos: M.avulsos, estados: EXE_ESTADOS, statusAgenda: EXE_STATUS_AGENDA, naturezas: EXE_NATUREZAS, classes: EXE_CLASSES, interpretacoes: EXE_INTERPRETACOES };
}

function listaDePacientes(r) {
  var vistos = {}, pacientes = [];
  lerTudo("agenda_pacientes").forEach(function (p) {
    if (p.arquivada) return;
    vistos["loc:" + p.id] = true; pacientes.push({ ref: "loc:" + p.id, nome: p.nome || "(sem nome)" });
  });
  r.agendamentos.concat(r.orcamentos).forEach(function (x) {
    if (!x.pacienteRef || vistos[x.pacienteRef] || x.pacienteRef === "clc:?") return;
    vistos[x.pacienteRef] = true; pacientes.push({ ref: x.pacienteRef, nome: (x.pacienteNome || "(sem nome)") + " · Clinicorp, sem vínculo" });
  });
  return pacientes.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
}

function financeiroOrcamentosExecucao(ctx) {
  return lerComConsistencia(function () {
    var c = configClinicorp();
    var r = apurar(c, (ctx.dados || {}).filtros || {});
    r.hoje = hojeNaClinica();
    r.pacientes = listaDePacientes(r);
    r.fonte = { clinicorp: situacaoClinicorp(c), execucaoAutomatica: false,
      falta: "A API do Clinicorp não informa quais procedimentos foram realizados em cada agendamento, nem o vínculo do agendamento com o orçamento. Por isso a execução é registrada aqui (ou por relatório importado)." };
    return r;
  });
}

/* ---------------- a ficha da paciente ---------------- */

function financeiroPacientePlanos(ctx) {
  return lerComConsistencia(function () {
    var d0 = ctx.dados || {};
    var ref = String(d0.pacienteRef || "");
    if (!/^(loc|clc):/.test(ref)) falhar("dados_invalidos", "Escolha a paciente.", { campo: "pacienteRef" });
    var paraPaciente = d0.versao === "paciente";
    var c = configClinicorp();
    var M = apurarModelo(c);
    var docs = Object.keys(M.docs).map(function (k) { return M.docs[k]; }).filter(function (d) { return d.pacienteRef === ref; });
    var nome = M.pac.nome(ref, (docs[0] && docs[0].pacienteNome) || "");
    var planos = docs.map(function (d) { return planoDetalhado(M, d); });
    var documentos = planos.map(function (p) {
      return { ref: p.ref, origem: p.origem, id: p.id, data: p.data, inicio: p.inicio, tipo: p.tipo.tipo, misto: p.tipo.misto, temProdutos: p.tipo.temProdutos,
        aClassificar: p.tipo.aClassificar, situacao: p.resumo.situacao, situacaoOrigem: p.situacaoOrigem, progresso: p.resumo.progresso, contratadas: p.resumo.contratadas,
        cumpridas: p.resumo.cumpridas, restante: p.resumo.restante, pendencias: p.resumo.pendencias,
        resumoItens: p.linhas.concat(p.outrosItens).slice(0, 6).map(function (l) { return qtdTexto(qtdMil(l.contratado)) + "× " + l.procedimento; }) };
    });
    var atendimentos = Object.keys(M.ags).filter(function (k) { return M.ags[k].pacienteRef === ref; }).map(function (k) { return atendimentoPublico(M, M.ags[k]); })
      .filter(function (a) { return a.tipo !== "agenda-hist" || a.execucoes.length || a.aConfirmar; })
      .sort(function (a, b) { return String(b.data + b.hora).localeCompare(String(a.data + a.hora)); });
    var pendentes = M.pendentes.filter(function (e) { return e.pacienteRef === ref; }).map(function (e) {
      var x = Object.assign({}, e); x.candidatos = candidatosNoModelo(M, e); x.sugestao = sugestaoAnterior(M, e); return x;
    });
    var todasTrocas = [], todosGratuitos = [];
    planos.forEach(function (p) { todasTrocas = todasTrocas.concat(p.trocas); todosGratuitos = todosGratuitos.concat(p.gratuitos); });
    todosGratuitos = todosGratuitos.concat(M.gratuitos.filter(function (g) { return g.pacienteRef === ref && !g.planoRef; }).map(gratuitoPublico));
    var r = { paciente: { ref: ref, nome: nome }, hoje: M.hoje, documentos: documentos, planos: planos, atendimentos: atendimentos, pendentes: pendentes,
      avulsos: M.avulsos.filter(function (e) { return e.pacienteRef === ref; }), beneficios: totaisDeBeneficio(todasTrocas, todosGratuitos),
      gratuitosSemPlano: todosGratuitos.filter(function (g) { return !g.planoRef; }),
      naturezas: EXE_NATUREZAS, classes: EXE_CLASSES, interpretacoes: EXE_INTERPRETACOES, statusAgenda: EXE_STATUS_AGENDA };
    return paraPaciente ? versaoParaPaciente(r) : r;
  });
}

/* Versão para apresentar ou imprimir: progresso, histórico liberado e
   direitos disponíveis. Custos, valores internos, notas e observação não
   liberada ficam FORA dos dados enviados — não só da tela. */
function versaoParaPaciente(r) {
  var planos = r.planos.filter(function (p) { return p.tipo.tipo === "plano" && p.resumo.situacao !== "cancelado"; }).map(function (p) {
    var historico = p.historico.map(function (a) {
      return { data: a.data, area: a.area, profissional: a.profissional,
        procedimentos: a.execucoes.filter(function (e) { return e.conta && e.planoRef === p.ref; }).map(function (e) {
          var t = e.trocaId ? p.trocas.filter(function (x) { return x.id === e.trocaId; })[0] : null;
          return { procedimento: e.procedimento, quantidade: e.quantidade, natureza: e.natureza,
            texto: e.natureza === "substituicao" && t ? e.procedimento + " em substituição a " + qtdTexto(qtdMil(t.quantidadeOrigem)) + " " + t.procedimentoOrigem :
              e.natureza === "gratuito" ? e.procedimento + " (bônus)" : e.procedimento };
        }), observacao: a.observacaoLiberada ? a.observacao : "" };
    }).filter(function (a) { return a.procedimentos.length; });
    return { id: p.id, inicio: p.resumo.inicio, situacao: p.resumo.situacao, atendimentos: p.resumo.atendimentos, procedimentos: p.resumo.procedimentos,
      contratadas: p.resumo.contratadas, cumpridas: p.resumo.cumpridas, restante: p.resumo.restante, progresso: p.resumo.progresso,
      linhas: p.linhas.map(function (l) { return { procedimento: l.procedimento, contratado: l.contratado, realizada: l.realizada, substituida: l.substituida,
        comprometida: l.comprometida, disponivel: l.disponivel, excedente: l.excedente }; }),
      trocas: p.trocas.filter(function (t) { return t.ativa; }).map(function (t) { return { texto: qtdTexto(qtdMil(t.quantidadeOrigem)) + " " + t.procedimentoOrigem + " por " +
        qtdTexto(qtdMil(t.quantidadePrometida)) + " " + t.procedimentoSubstituto, entregue: t.entregue, restante: t.restante }; }),
      bonus: p.gratuitos.filter(function (g) { return g.conta; }).map(function (g) { return { procedimento: g.procedimento, quantidade: g.quantidade, data: g.data }; }),
      disponiveis: p.disponiveis.map(function (x) { return { procedimento: x.procedimento, quantidade: x.quantidade, porTroca: x.porTroca }; }),
      historico: historico };
  });
  var credito = r.beneficios.creditoSaldo;
  return { versao: "paciente", paciente: { nome: r.paciente.nome }, emitidoEm: r.hoje, planos: planos, creditoDisponivel: credito > 0 ? credito : 0 };
}

/* ---------------- operações ---------------- */

var CAMPOS_EXECUCAO = { procedimento: { tipo: "texto", max: 160 }, procedimentoRef: { tipo: "texto", max: 60 }, fichaId: { tipo: "texto", max: 80 },
  quantidade: { tipo: "decimal" }, notas: { tipo: "texto", max: 1000 } };

/* Já existe execução válida deste procedimento neste atendimento? (por
   qualquer via: tela, confirmação, relatório, de qualquer versão) */
function execucaoExistente(agRef, chave, excetoId) {
  return lerTudo("exe_execucoes").filter(function (x) {
    return x.id !== excetoId && x.estado !== "desfeito" && x.agendamentoTipo + ":" + x.agendamentoId === agRef && chaveDoProcedimento(x) === chave;
  })[0] || null;
}

function idDeExecucao(agRef, chave) { return "ex-" + sha256Hex(agRef + "|" + chave).slice(0, 24); }

function agendamentoValido(ag, estado) {
  if (!ag) falhar("dados_invalidos", "Agendamento não encontrado: a execução precisa estar ligada a um agendamento da Agenda ou do Clinicorp.", { campo: "agendamentoId" });
  if (estado === "realizado" && ag.data > hojeNaClinica()) falhar("dados_invalidos", "Este agendamento ainda não aconteceu: registre como previsto.");
  if (estado === "realizado" && (ag.status.categoria === "cancelado" || ag.status.categoria === "falta")) {
    falhar("dados_invalidos", "Este agendamento está como " + EXE_STATUS_AGENDA[ag.status.categoria].toLowerCase() + ": não dá para registrar procedimento realizado nele.");
  }
}

function planejarExecucao(ctx, op, Mpronto) {
  var id = idValido(op.id, "execução");
  var ja = acharPorChave("exe_execucoes", id);
  if (ja) return { escritas: [], resultado: { id: id, rev: Number(ja.rev) || 0, jaExistia: true, associacao: ja.associacao } };
  var d = op.dados || {};
  var c = configClinicorp();
  var M = Mpronto || apurarModelo(c);
  var tipo = String(d.agendamentoTipo || ""), agId = String(d.agendamentoId || "");
  var agRef = tipo + ":" + agId;
  var ag = M.ags[agRef];
  var estado = String(d.estado || "realizado");
  if (["previsto", "realizado"].indexOf(estado) < 0) falhar("dados_invalidos", "Estado: previsto ou realizado.");
  agendamentoValido(ag, estado);
  var campos = validarCamposFin({ procedimento: d.procedimento, procedimentoRef: d.procedimentoRef, fichaId: d.fichaId, quantidade: d.quantidade || "1", notas: d.notas }, CAMPOS_EXECUCAO, "execução");
  if (!String(campos.procedimento || "").trim()) falhar("dados_invalidos", "Informe o procedimento.", { campo: "procedimento" });
  if (!qtdMil(campos.quantidade)) falhar("dados_invalidos", "Quantidade inválida.", { campo: "quantidade" });
  var chave = chaveDoProcedimento({ procedimentoRef: campos.procedimentoRef, procedimento: campos.procedimento });
  var existente = execucaoExistente(agRef, chave, id);
  if (existente) {
    if (op.origem && op.origem !== "manual") return { escritas: [], resultado: { id: existente.id, rev: Number(existente.rev) || 0, jaExistia: true, associacao: existente.associacao } };
    falhar("dados_invalidos", "Este procedimento já está registrado neste atendimento: corrija a quantidade do registro existente.", { campo: "procedimento" });
  }
  var e = { id: id, agendamentoTipo: tipo, agendamentoId: agId, agendamentoData: ag.data, pacienteRef: ag.pacienteRef || String(d.pacienteRef || ""),
    pacienteNome: ag.pacienteNome || String(d.pacienteNome || ""), procedimento: campos.procedimento, procedimentoRef: campos.procedimentoRef || "",
    fichaId: campos.fichaId || "", quantidade: campos.quantidade, estado: estado, orcamentoRef: "", itemRef: String(d.itemRef || ""),
    origem: String(op.origem || "manual"), loteId: String(op.loteId || ""), criadoEm: agoraISO(), autorNome: assinaturaDe(ctx.auth).nome, notas: campos.notas || "",
    natureza: "", trocaId: "", valorReferencia: null, baseReferencia: "" };
  if (!e.pacienteRef) falhar("dados_invalidos", "Este agendamento do Clinicorp ainda não tem paciente identificada: vincule a paciente antes.", { campo: "agendamentoId" });
  var natureza = String(d.natureza || "");
  if (natureza && ["contratado", "gratuito", "avulso"].indexOf(natureza) < 0) falhar("dados_invalidos", "Natureza desconhecida (substituição se registra pela troca).");
  var as;
  if (d.trocaId) {
    /* entrega de um direito de troca num atendimento posterior */
    var tr = M.trocas[String(d.trocaId)];
    if (!tr || !tr.ativa || tr.reg.pacienteRef !== e.pacienteRef) falhar("dados_invalidos", "Troca não encontrada para esta paciente.", { campo: "trocaId" });
    if (estado === "realizado" && tr.entregue + (qtdMil(campos.quantidade) || 0) > tr.prometida) {
      falhar("dados_invalidos", "Esta troca prometeu " + qtdTexto(tr.prometida) + " e já entregou " + qtdTexto(tr.entregue) + ".", { campo: "quantidade" });
    }
    e.trocaId = tr.reg.id; e.itemRef = "";
    if (!e.fichaId && tr.reg.fichaSubstitutoId) e.fichaId = tr.reg.fichaSubstitutoId;
    as = { itemRef: "", orcamentoRef: tr.reg.orcamentoRef, associacao: "informada" };
    natureza = "substituicao";
  } else if (e.itemRef) {
    var l = M.linhaDoItem[e.itemRef];
    if (!l) falhar("dados_invalidos", "Item do plano não encontrado.", { campo: "itemRef" });
    if (M.docs[l.docRef].pacienteRef !== e.pacienteRef) falhar("dados_invalidos", "Este orçamento é de outra paciente.", { campo: "itemRef" });
    as = { itemRef: l.ref, orcamentoRef: l.docRef, associacao: "informada" };
    natureza = "contratado";
  } else if (natureza === "gratuito" || natureza === "avulso") {
    as = { itemRef: "", orcamentoRef: "", associacao: natureza === "avulso" ? "avulso" : "informada" };
    if (natureza === "gratuito" && d.orcamentoRef) {
      if (!M.docs[d.orcamentoRef] || M.docs[d.orcamentoRef].pacienteRef !== e.pacienteRef) falhar("dados_invalidos", "Plano não encontrado para esta paciente.", { campo: "orcamentoRef" });
      as.orcamentoRef = String(d.orcamentoRef);
    }
  } else {
    as = associarNoModelo(M, e);
    natureza = as.itemRef ? "contratado" : "";
  }
  e.itemRef = as.itemRef; e.orcamentoRef = as.orcamentoRef; e.associacao = as.associacao; e.natureza = natureza;
  var linha = e.itemRef ? M.linhaDoItem[e.itemRef] : null;
  e.valorUnitario = linha ? linha.acordadoUnit : null;
  if (!e.fichaId && linha && linha.fichaId) e.fichaId = linha.fichaId;
  var custo = custoNaData(e.fichaId, e.procedimentoRef, ag.data);
  e.fichaId = e.fichaId || custo.fichaId; e.custoUnitario = custo.custo; e.custoFonte = custo.fonte; e.baseCusto = custo.base;
  if (natureza === "gratuito") referenciaDoBonus(e, d, ag.data);
  var reg = carimbar(registroCompleto("exe_execucoes", e, null), 1, ctx, op.operacaoId);
  var ev = [evento("financeiro", "execucao", id, "criou", EXE_ESTADOS[estado], "", e.procedimento + " × " + qtdTexto(qtdMil(e.quantidade)) + " em " + dataBR(ag.data) +
    (natureza ? " (" + EXE_NATUREZAS[natureza].toLowerCase() + ")" : " (a decidir)"), as.associacao)];
  return { escritas: [{ t: "gravar", tabela: "exe_execucoes", registro: reg }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId)),
    resultado: { id: id, rev: 1, associacao: as.associacao, natureza: natureza } };
}

/* Valor de referência de um adicional GRATUITO: o informado, ou o preço da
   ficha aplicável à data. Sem nenhum: pendente (bônus não calculado). */
function referenciaDoBonus(e, d, dia) {
  var v = numOuNull(d.valorReferencia);
  if (v !== null) {
    if (!Number.isInteger(v) || v < 0) falhar("dados_invalidos", "Valor de referência inválido.", { campo: "valorReferencia" });
    e.valorReferencia = v; e.baseReferencia = "informado em " + dataBR(hojeNaClinica());
    return;
  }
  var p = precoNaData(e.fichaId, e.procedimentoRef, dia);
  e.valorReferencia = p.preco; e.baseReferencia = p.preco === null ? "sem preço de referência (a conferir)" : p.base;
}

/* Corrigir uma execução. Correção do que já foi confirmado exige motivo;
   escolher o plano de uma execução pendente, não. O histórico fica na
   auditoria; desfeito não some. */
function planejarAlterarExecucao(ctx, op) {
  var id = idValido(op.id, "execução");
  var atual = acharPorChave("exe_execucoes", id);
  if (!atual) falhar("conflito", "Esta execução não existe mais.", { rev: 0, atual: null, removida: true });
  conferirRevisao(atual, op.revBase, function (r) { return execucaoProcedimento(r, null, false); });
  var d = op.campos || {};
  var c = configClinicorp();
  var M = apurarModelo(c);
  var novo = copiaLimpa(atual);
  var natAtual = naturezaDe(atual);
  var pendente = !natAtual && ["ambigua", "sugerida", "sem_orcamento", ""].indexOf(atual.associacao || "") >= 0;
  var motivo = String(d.motivo || "").trim().slice(0, 300);
  var ev = [], extra = [];
  var exigeMotivo = false;
  if (d.estado !== undefined && d.estado !== atual.estado) {
    if (["previsto", "realizado", "desfeito"].indexOf(d.estado) < 0) falhar("dados_invalidos", "Estado inválido.");
    if (d.estado === "realizado") agendamentoValido(M.ags[atual.agendamentoTipo + ":" + atual.agendamentoId] || { data: atual.agendamentoData, status: { categoria: "agendado" } }, "realizado");
    if (atual.estado === "realizado") exigeMotivo = true;
    ev.push(evento("financeiro", "execucao", id, "alterou", "Situação", EXE_ESTADOS[atual.estado], EXE_ESTADOS[d.estado], motivo));
    novo.estado = d.estado;
  }
  if (d.quantidade !== undefined) {
    var q = qtdMil(d.quantidade);
    if (!q || q < 0) falhar("dados_invalidos", "Quantidade inválida.", { campo: "quantidade" });
    if (qtdTexto(q) !== atual.quantidade) {
      if (atual.estado === "realizado") exigeMotivo = true;
      ev.push(evento("financeiro", "execucao", id, "alterou", "Quantidade", atual.quantidade, qtdTexto(q), motivo)); novo.quantidade = qtdTexto(q);
    }
  }
  var natNova = d.natureza !== undefined ? String(d.natureza) : d.itemRef !== undefined ? (d.itemRef ? "contratado" : "") : natAtual;
  if (natNova && !EXE_NATUREZAS[natNova]) falhar("dados_invalidos", "Natureza desconhecida.");
  if (natNova === "substituicao" && natAtual !== "substituicao") {
    var tr = M.trocas[String(d.trocaId || "")];
    if (!tr || !tr.ativa || tr.reg.pacienteRef !== atual.pacienteRef) falhar("dados_invalidos", "Escolha a troca que esta entrega atende.", { campo: "trocaId" });
    novo.trocaId = tr.reg.id; novo.itemRef = ""; novo.orcamentoRef = tr.reg.orcamentoRef; novo.associacao = "informada";
  }
  if (natNova === "contratado") {
    var itemRef = d.itemRef !== undefined ? String(d.itemRef || "") : atual.itemRef;
    var l = itemRef ? M.linhaDoItem[itemRef] : null;
    if (!l) falhar("dados_invalidos", "Escolha o item do plano.", { campo: "itemRef" });
    if (M.docs[l.docRef].pacienteRef !== atual.pacienteRef) falhar("dados_invalidos", "Este orçamento é de outra paciente.");
    if (itemRef !== atual.itemRef || natAtual !== "contratado") {
      novo.itemRef = l.ref; novo.orcamentoRef = l.docRef; novo.associacao = "confirmada"; novo.trocaId = "";
      novo.valorUnitario = l.acordadoUnit;
      if (!novo.fichaId && l.fichaId) novo.fichaId = l.fichaId;
      ev.push(evento("financeiro", "execucao", id, "alterou", "Plano", atual.itemRef || "sem plano", l.ref, motivo));
      if (!pendente) exigeMotivo = true;
    }
  }
  if (natNova === "avulso" || natNova === "") {
    if (natAtual !== natNova || atual.itemRef) {
      novo.itemRef = ""; novo.orcamentoRef = ""; novo.trocaId = ""; novo.associacao = natNova === "avulso" ? "avulso" : "sem_orcamento";
      if (!pendente) exigeMotivo = true;
    }
  }
  if (natNova === "gratuito") {
    if (natAtual !== "gratuito") { novo.itemRef = ""; novo.trocaId = ""; novo.associacao = "informada"; if (!pendente) exigeMotivo = true; }
    if (d.orcamentoRef !== undefined) {
      if (d.orcamentoRef && (!M.docs[d.orcamentoRef] || M.docs[d.orcamentoRef].pacienteRef !== atual.pacienteRef)) falhar("dados_invalidos", "Plano não encontrado para esta paciente.");
      novo.orcamentoRef = String(d.orcamentoRef || "");
    } else if (natAtual !== "gratuito") novo.orcamentoRef = atual.orcamentoRef || "";
    if (d.valorReferencia !== undefined || natAtual !== "gratuito") referenciaDoBonus(novo, d, atual.agendamentoData);
  }
  if (natNova !== natAtual) ev.push(evento("financeiro", "execucao", id, "alterou", "Natureza", EXE_NATUREZAS[natAtual] || "a decidir", EXE_NATUREZAS[natNova] || "a decidir", motivo));
  novo.natureza = natNova;
  /* saiu de "em substituição": a troca perde esta entrega; se não sobra
     nenhuma entrega, a troca é desfeita junto (bônus e crédito somem da
     apuração; utilizações de crédito ficam rastreáveis) */
  if (natAtual === "substituicao" && (natNova !== "substituicao" || novo.estado === "desfeito")) {
    var t = M.trocas[atual.trocaId];
    if (t && t.ativa) {
      var outras = lerTudo("exe_execucoes").filter(function (x) { return x.trocaId === t.reg.id && x.id !== id && x.estado !== "desfeito"; });
      if (!outras.length) {
        var rt = copiaLimpa(t.reg); rt.estado = "desfeita"; rt.motivo = "correção da entrega de " + dataBR(atual.agendamentoData) + (motivo ? ": " + motivo : "");
        carimbar(rt, (Number(t.reg.rev) || 0) + 1, ctx, op.operacaoId);
        extra.push({ t: "gravar", tabela: "exe_trocas", registro: rt });
        ev.push(evento("financeiro", "troca", t.reg.id, "desfez", "Troca", t.reg.procedimentoOrigem + " → " + t.reg.procedimentoSubstituto, "desfeita", rt.motivo));
      }
    }
    if (natNova !== "substituicao") novo.trocaId = "";
  }
  if (exigeMotivo && !motivo) falhar("dados_invalidos", "Diga o motivo da correção: ela fica no histórico.", { campo: "motivo" });
  if (d.notas !== undefined) novo.notas = String(d.notas || "").slice(0, 1000);
  if (!ev.length && novo.notas === atual.notas) return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0 } };
  var rev = (Number(atual.rev) || 0) + 1;
  carimbar(novo, rev, ctx, op.operacaoId);
  return { escritas: extra.concat([{ t: "gravar", tabela: "exe_execucoes", registro: novo }]).concat(escritasDeAuditoria(ctx, ev, op.operacaoId)), resultado: { id: id, rev: rev } };
}

/* Confirmar um atendimento conforme previsto: uma execução por
   procedimento previsto, com id do atendimento + procedimento (repetir,
   reimportar ou confirmar de outra via não duplica). */
function planejarConfirmarAtendimento(ctx, op) {
  var c = configClinicorp();
  var M = apurarModelo(c);
  var agRef = String(op.agendamentoTipo || "") + ":" + String(op.agendamentoId || "");
  var ag = M.ags[agRef];
  agendamentoValido(ag, "realizado");
  var lista = Array.isArray(op.procedimentos) && op.procedimentos.length ? op.procedimentos : ag.previstos;
  if (!lista || !lista.length) falhar("dados_invalidos", "Este atendimento não tem procedimentos previstos: registre o que foi feito.");
  var escritas = [], resultados = [];
  lista.forEach(function (p, k) {
    var desc = String(p.descricao || p.procedimento || "").trim();
    if (!desc) return;
    var chave = chaveDoProcedimento({ procedimentoRef: p.ref || "", procedimento: desc });
    var r = planejarExecucao(ctx, { operacaoId: op.operacaoId + "|" + k, id: idDeExecucao(agRef, chave), origem: "confirmacao",
      dados: { agendamentoTipo: ag.tipo, agendamentoId: ag.id, procedimento: desc, procedimentoRef: p.ref || "", quantidade: p.quantidade || "1" } }, M);
    escritas = escritas.concat(r.escritas);
    resultados.push(r.resultado);
  });
  return { escritas: escritas, resultado: { agendamentoRef: agRef, execucoes: resultados } };
}

/* Complemento e interpretação de um atendimento. */
function planejarAtendimento(ctx, op) {
  var agRef = String(op.id || "");
  var c = configClinicorp();
  var pac = mapaDePacientes(c);
  var ags = agendamentosConhecidos(c, pac);
  var ag = ags[agRef];
  if (!ag) falhar("dados_invalidos", "Agendamento não encontrado.");
  var atual = acharPorChave("exe_atendimentos", agRef);
  if (atual) conferirRevisao(atual, op.revBase, function (r) { return publicoDe("exe_atendimentos", r); });
  var d = op.dados || {};
  var reg = atual ? copiaLimpa(atual) : { id: agRef, agendamentoTipo: ag.tipo, agendamentoId: ag.id, pacienteRef: ag.pacienteRef, previstos: [], observacao: "", marcador: "",
    profissional: "", interpretacao: "", observacaoInterpretada: "", observacaoLiberada: false, notas: "", origem: String(op.origem || "manual"), loteId: String(op.loteId || ""),
    autorNome: assinaturaDe(ctx.auth).nome, criadoEm: agoraISO() };
  var ev = [];
  var muda = function (campo, valor, rotulo) {
    if (canonico(reg[campo]) === canonico(valor)) return;
    ev.push(evento("financeiro", "atendimento", agRef, "alterou", rotulo, typeof reg[campo] === "string" ? reg[campo] : canonico(reg[campo] || ""), typeof valor === "string" ? valor : canonico(valor), String(d.motivo || "")));
    reg[campo] = valor;
  };
  if (Array.isArray(d.previstos)) {
    muda("previstos", d.previstos.slice(0, 20).map(function (p) { return { descricao: String(p.descricao || "").slice(0, 160), ref: String(p.ref || "").slice(0, 60), quantidade: p.quantidade ? String(p.quantidade) : undefined }; })
      .filter(function (p) { return p.descricao; }), "Previstos");
  }
  ["observacao", "marcador", "profissional", "notas"].forEach(function (k) { if (d[k] !== undefined) muda(k, String(d[k] || "").slice(0, k === "observacao" || k === "notas" ? 1000 : 120), k); });
  if (d.observacaoLiberada !== undefined) muda("observacaoLiberada", d.observacaoLiberada === true, "Observação na versão da paciente");
  if (d.interpretacao !== undefined) {
    var it = String(d.interpretacao || "");
    if (it && !EXE_INTERPRETACOES[it]) falhar("dados_invalidos", "Interpretação desconhecida.");
    muda("interpretacao", it, "Leitura da observação");
    var textoAtual = ag.observacao || reg.observacao || "";
    reg.observacaoInterpretada = it ? textoAtual : "";
  }
  if (op.origem === "importacao" && atual && atual.origem === "manual") reg.origem = "manual";
  if (!ev.length && atual) return { escritas: [], resultado: { id: agRef, rev: Number(atual.rev) || 0 } };
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  carimbar(reg, rev, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "exe_atendimentos", registro: reg }].concat(escritasDeAuditoria(ctx, ev, op.operacaoId)), resultado: { id: agRef, rev: rev } };
}

/* Troca: N unidades de uma linha do plano por M de outro procedimento.
   Registrada uma vez; a unidade original fica comprometida (não volta ao
   saldo livre); cada entrega é uma execução no atendimento em que
   aconteceu. Preços e custos de referência ficam gravados. */
function planejarTroca(ctx, op) {
  var id = idValido(op.id, "troca");
  var ja = acharPorChave("exe_trocas", id);
  if (ja) return { escritas: [], resultado: { id: id, rev: Number(ja.rev) || 0, jaExistia: true } };
  var d = op.dados || {};
  var c = configClinicorp();
  var M = apurarModelo(c);
  var doc = M.docs[String(d.orcamentoRef || "")];
  if (!doc) falhar("dados_invalidos", "Plano não encontrado.", { campo: "orcamentoRef" });
  if (doc.cancelado) falhar("dados_invalidos", "Este plano está cancelado na origem.");
  var linha = doc.linhas.filter(function (l) { return l.chave === String(d.linhaChave || ""); })[0];
  if (!linha || !ehTratamento(linha)) falhar("dados_invalidos", "Escolha o procedimento do plano que será trocado.", { campo: "linhaChave" });
  var qo = qtdMil(d.quantidadeOrigem || "1"), qs = qtdMil(d.quantidadePrometida || "1");
  if (!qo || qo < 0) falhar("dados_invalidos", "Quantidade de origem inválida.", { campo: "quantidadeOrigem" });
  if (!qs || qs < 0) falhar("dados_invalidos", "Quantidade prometida inválida.", { campo: "quantidadePrometida" });
  var substituirExe = d.substituirExecucaoId ? acharPorChave("exe_execucoes", String(d.substituirExecucaoId)) : null;
  var livre = linha.disponivel + (substituirExe && substituirExe.itemRef && M.linhaDoItem[substituirExe.itemRef] === linha && substituirExe.estado === "realizado" ? (qtdMil(substituirExe.quantidade) || 0) : 0);
  if (qo > livre) falhar("dados_invalidos", "Só há " + qtdTexto(livre) + " " + linha.procedimento + " livre(s) neste plano para trocar.", { campo: "quantidadeOrigem" });
  var subst = String(d.procedimentoSubstituto || "").trim().slice(0, 160);
  if (!subst) falhar("dados_invalidos", "Informe o procedimento substituto.", { campo: "procedimentoSubstituto" });
  var dia = String(d.data || hojeNaClinica());
  if (!dataValida(dia)) falhar("dados_invalidos", "Data inválida.", { campo: "data" });
  var quem = assinaturaDe(ctx.auth);
  var t = { id: id, pacienteRef: doc.pacienteRef, orcamentoRef: doc.ref, linhaChave: linha.chave, procedimentoOrigem: linha.procedimento, quantidadeOrigem: qtdTexto(qo),
    procedimentoSubstituto: subst, procedimentoSubstitutoRef: String(d.procedimentoSubstitutoRef || "").slice(0, 60), fichaSubstitutoId: String(d.fichaSubstitutoId || "").slice(0, 80),
    quantidadePrometida: qtdTexto(qs), data: dia, agendamentoRef: "", estado: "ativa", motivo: String(d.motivo || "").slice(0, 300),
    observacaoOrigem: String(d.observacaoOrigem || "").slice(0, 300), autorNome: quem.nome, criadoEm: agoraISO() };
  /* referências de preço: a do item do plano e a do substituto */
  var bases = [];
  var po = numOuNull(d.precoOrigem), ps = numOuNull(d.precoSubstituto);
  if (po !== null) bases.push("origem informada"); else { po = linha.precoRef; bases.push("origem: " + linha.precoRefBase); }
  if (ps !== null) bases.push("substituto informado"); else {
    var p = precoNaData(t.fichaSubstitutoId, t.procedimentoSubstitutoRef, dia);
    ps = p.preco; bases.push("substituto: " + (p.base || "sem preço de referência"));
  }
  [po, ps].forEach(function (v) { if (v !== null && (!Number.isInteger(v) || v < 0)) falhar("dados_invalidos", "Preço de referência inválido."); });
  t.precoOrigem = po; t.precoSubstituto = ps; t.basePreco = bases.join(" · ") + " · em " + dataBR(dia);
  var cobrado = numOuNull(d.diferencaCobrada) || 0;
  if (!Number.isInteger(cobrado) || cobrado < 0) falhar("dados_invalidos", "Diferença cobrada inválida.", { campo: "diferencaCobrada" });
  if (cobrado && po !== null && ps !== null) {
    var dif = Math.round(ps * qs / 1000) - Math.round(po * qo / 1000);
    if (dif <= 0) falhar("dados_invalidos", "O substituto não é mais caro: não há diferença a cobrar (gera crédito).", { campo: "diferencaCobrada" });
    if (cobrado > dif) falhar("dados_invalidos", "A cobrança passa da diferença (" + dinheiroBR(dif) + ").", { campo: "diferencaCobrada" });
  }
  t.diferencaCobrada = cobrado;
  var co = custoNaData(linha.fichaId, linha.procedimentoRef, dia), cs = custoNaData(t.fichaSubstitutoId, t.procedimentoSubstitutoRef, dia);
  t.custoOrigem = co.custo; t.custoSubstituto = cs.custo; t.baseCusto = "origem: " + co.base + " · substituto: " + cs.base;
  if (!t.fichaSubstitutoId && cs.fichaId) t.fichaSubstitutoId = cs.fichaId;
  var escritas = [], ev = [];
  /* a entrega deste atendimento, se houver */
  var entregaQ = qtdMil(d.entregaQuantidade || "");
  if (d.agendamentoTipo && d.agendamentoId) {
    var agRef = String(d.agendamentoTipo) + ":" + String(d.agendamentoId);
    var ag = M.ags[agRef];
    if (!ag) falhar("dados_invalidos", "Agendamento não encontrado.");
    if (ag.pacienteRef !== doc.pacienteRef) falhar("dados_invalidos", "Este atendimento é de outra paciente.");
    t.agendamentoRef = agRef;
    if (entregaQ) {
      agendamentoValido(ag, "realizado");
      if (entregaQ > qs) falhar("dados_invalidos", "A entrega passa do prometido.", { campo: "entregaQuantidade" });
      var chave = chaveDoProcedimento({ procedimentoRef: t.procedimentoSubstitutoRef, procedimento: subst });
      var ex = execucaoExistente(agRef, chave, "");
      var custoE = custoNaData(t.fichaSubstitutoId, t.procedimentoSubstitutoRef, ag.data);
      if (ex) {
        var nx = copiaLimpa(ex);
        nx.natureza = "substituicao"; nx.trocaId = id; nx.itemRef = ""; nx.orcamentoRef = doc.ref; nx.associacao = "informada"; nx.quantidade = qtdTexto(entregaQ);
        carimbar(nx, (Number(ex.rev) || 0) + 1, ctx, op.operacaoId);
        escritas.push({ t: "gravar", tabela: "exe_execucoes", registro: nx });
        ev.push(evento("financeiro", "execucao", ex.id, "alterou", "Natureza", EXE_NATUREZAS[naturezaDe(ex)] || "a decidir", EXE_NATUREZAS.substituicao, "troca " + id));
      } else {
        var e = { id: idDeExecucao(agRef, chave), agendamentoTipo: ag.tipo, agendamentoId: ag.id, agendamentoData: ag.data, pacienteRef: ag.pacienteRef, pacienteNome: ag.pacienteNome,
          procedimento: subst, procedimentoRef: t.procedimentoSubstitutoRef, fichaId: t.fichaSubstitutoId || custoE.fichaId, quantidade: qtdTexto(entregaQ), estado: "realizado",
          orcamentoRef: doc.ref, itemRef: "", associacao: "informada", custoUnitario: custoE.custo, custoFonte: custoE.fonte, baseCusto: custoE.base, valorUnitario: null,
          origem: "troca", loteId: "", criadoEm: agoraISO(), autorNome: quem.nome, notas: "", natureza: "substituicao", trocaId: id, valorReferencia: null, baseReferencia: "" };
        escritas.push({ t: "gravar", tabela: "exe_execucoes", registro: carimbar(registroCompleto("exe_execucoes", e, null), 1, ctx, op.operacaoId) });
        ev.push(evento("financeiro", "execucao", e.id, "criou", "Realizado", "", subst + " em substituição a " + qtdTexto(qo) + " " + linha.procedimento, "troca"));
      }
    }
  }
  /* o procedimento original registrado neste atendimento não aconteceu */
  if (substituirExe && substituirExe.estado !== "desfeito") {
    if (substituirExe.pacienteRef !== doc.pacienteRef) falhar("dados_invalidos", "Execução de outra paciente.");
    var sx = copiaLimpa(substituirExe);
    sx.estado = "desfeito"; sx.notas = (sx.notas ? sx.notas + " · " : "") + "substituída pela troca " + id;
    carimbar(sx, (Number(substituirExe.rev) || 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "exe_execucoes", registro: sx });
    ev.push(evento("financeiro", "execucao", sx.id, "alterou", "Situação", "Realizado", "Desfeito", "substituído por " + subst));
  }
  var reg = carimbar(registroCompleto("exe_trocas", t, null), 1, ctx, op.operacaoId);
  ev.unshift(evento("financeiro", "troca", id, "criou", "Troca", "", qtdTexto(qo) + " " + linha.procedimento + " → " + qtdTexto(qs) + " " + subst, t.motivo));
  return { escritas: [{ t: "gravar", tabela: "exe_trocas", registro: reg }].concat(escritas).concat(escritasDeAuditoria(ctx, ev, op.operacaoId)), resultado: { id: id, rev: 1 } };
}

function planejarDesfazerTroca(ctx, op) {
  var id = idValido(op.id, "troca");
  var atual = acharPorChave("exe_trocas", id);
  if (!atual) falhar("conflito", "Esta troca não existe mais.", { rev: 0, atual: null, removida: true });
  conferirRevisao(atual, op.revBase, function (r) { return publicoDe("exe_trocas", r); });
  if (atual.estado === "desfeita") return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0 } };
  var motivo = String(op.motivo || "").trim().slice(0, 300);
  if (!motivo) falhar("dados_invalidos", "Diga o motivo: ele fica no histórico.", { campo: "motivo" });
  var reg = copiaLimpa(atual); reg.estado = "desfeita"; reg.motivo = motivo;
  carimbar(reg, (Number(atual.rev) || 0) + 1, ctx, op.operacaoId);
  var escritas = [{ t: "gravar", tabela: "exe_trocas", registro: reg }];
  var ev = [evento("financeiro", "troca", id, "desfez", "Troca", atual.procedimentoOrigem + " → " + atual.procedimentoSubstituto, "desfeita", motivo)];
  /* as entregas voltam a pedir decisão (não somem nem viram outra coisa sozinhas) */
  lerTudo("exe_execucoes").forEach(function (x) {
    if (x.trocaId !== id || x.estado === "desfeito") return;
    var n = copiaLimpa(x); n.natureza = ""; n.trocaId = ""; n.orcamentoRef = ""; n.itemRef = ""; n.associacao = "sem_orcamento";
    carimbar(n, (Number(x.rev) || 0) + 1, ctx, op.operacaoId);
    escritas.push({ t: "gravar", tabela: "exe_execucoes", registro: n });
    ev.push(evento("financeiro", "execucao", x.id, "alterou", "Natureza", EXE_NATUREZAS.substituicao, "a decidir", "troca desfeita"));
  });
  return { escritas: escritas.concat(escritasDeAuditoria(ctx, ev, op.operacaoId)), resultado: { id: id, rev: Number(reg.rev) } };
}

/* Utilizar crédito: destino explícito, nunca acima do saldo. Crédito não é
   dinheiro: não vira recebimento nem devolução. */
function planejarUsarCredito(ctx, op) {
  var id = idValido(op.id, "utilização de crédito");
  var ja = acharPorChave("exe_creditos", id);
  if (ja) return { escritas: [], resultado: { id: id, rev: Number(ja.rev) || 0, jaExistia: true } };
  var d = op.dados || {};
  var M = apurarModelo(configClinicorp());
  var t = M.trocas[String(d.trocaId || "")];
  if (!t || !t.ativa) falhar("dados_invalidos", "Crédito não encontrado (a troca de origem não existe ou foi desfeita).", { campo: "trocaId" });
  var pub = trocaPublica(M, t);
  if (pub.valores.credito === null) falhar("dados_invalidos", "O crédito desta troca está pendente de conferência de preço.");
  var valor = numOuNull(d.valor);
  if (valor === null || !Number.isInteger(valor) || valor <= 0) falhar("dados_invalidos", "Valor inválido.", { campo: "valor" });
  if (valor > pub.creditoSaldo) falhar("dados_invalidos", "O saldo deste crédito é " + dinheiroBR(Math.max(0, pub.creditoSaldo)) + ".", { campo: "valor" });
  var destinoRef = String(d.destinoRef || ""), destinoDescricao = String(d.destinoDescricao || "").trim().slice(0, 200);
  if (destinoRef) {
    if (!M.docs[destinoRef] || M.docs[destinoRef].pacienteRef !== t.reg.pacienteRef) falhar("dados_invalidos", "O plano de destino não é desta paciente.", { campo: "destinoRef" });
  } else if (!destinoDescricao) falhar("dados_invalidos", "Diga para que o crédito será usado (o plano de destino ou uma descrição).", { campo: "destinoRef" });
  var dia = String(d.data || hojeNaClinica());
  if (!dataValida(dia)) falhar("dados_invalidos", "Data inválida.", { campo: "data" });
  var u = { id: id, pacienteRef: t.reg.pacienteRef, trocaId: t.reg.id, valor: valor, destinoRef: destinoRef, destinoDescricao: destinoDescricao, data: dia, estado: "ativo",
    motivo: String(d.motivo || "").slice(0, 300), autorNome: assinaturaDe(ctx.auth).nome, criadoEm: agoraISO() };
  var reg = carimbar(registroCompleto("exe_creditos", u, null), 1, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "exe_creditos", registro: reg }].concat(escritasDeAuditoria(ctx,
    [evento("financeiro", "credito", id, "criou", "Uso de crédito", "", dinheiroBR(valor) + " → " + (destinoRef || destinoDescricao), u.motivo)], op.operacaoId)), resultado: { id: id, rev: 1 } };
}

function planejarEstornarCredito(ctx, op) {
  var id = idValido(op.id, "utilização de crédito");
  var atual = acharPorChave("exe_creditos", id);
  if (!atual) falhar("conflito", "Esta utilização não existe mais.", { rev: 0, atual: null, removida: true });
  conferirRevisao(atual, op.revBase, function (r) { return publicoDe("exe_creditos", r); });
  if (atual.estado === "estornado") return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0 } };
  var motivo = String(op.motivo || "").trim().slice(0, 300);
  if (!motivo) falhar("dados_invalidos", "Diga o motivo do estorno.", { campo: "motivo" });
  var reg = copiaLimpa(atual); reg.estado = "estornado"; reg.motivo = motivo;
  carimbar(reg, (Number(atual.rev) || 0) + 1, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "exe_creditos", registro: reg }].concat(escritasDeAuditoria(ctx,
    [evento("financeiro", "credito", id, "estornou", "Uso de crédito", dinheiroBR(Number(atual.valor) || 0), "estornado", motivo)], op.operacaoId)), resultado: { id: id, rev: Number(reg.rev) } };
}

/* Conferência: classe de um item (do item ou do procedimento inteiro,
   pelo id do cadastro) e quantidade contratada de uma linha do plano. */
function planejarConferencia(ctx, op) {
  var d = op.dados || {};
  var tipo = String(d.tipo || ""), alvo = String(d.alvo || "");
  var id;
  if (tipo === "classe") {
    if (!/^(item|ref):.+/.test(alvo)) falhar("dados_invalidos", "Classificação: escolha o item ou o procedimento.");
    if (d.valor && !EXE_CLASSES[d.valor]) falhar("dados_invalidos", "Classe desconhecida.");
    id = "classe:" + alvo;
  } else if (tipo === "quantidade") {
    if (!/^(local|clinicorp):.+\|.+/.test(alvo)) falhar("dados_invalidos", "Quantidade: escolha a linha do plano.");
    if (!qtdMil(d.valor) || qtdMil(d.valor) < 0) falhar("dados_invalidos", "Quantidade inválida.", { campo: "valor" });
    id = "qtd:" + alvo;
  } else falhar("dados_invalidos", "Conferência: classe ou quantidade.");
  var atual = acharPorChave("exe_conferencias", id);
  var valor = tipo === "quantidade" ? qtdTexto(qtdMil(d.valor)) : String(d.valor || "");
  if (atual && atual.valor === valor) return { escritas: [], resultado: { id: id, rev: Number(atual.rev) || 0 } };
  var reg = { id: id, tipo: tipo, alvo: alvo, valor: valor, motivo: String(d.motivo || "").slice(0, 300), autorNome: assinaturaDe(ctx.auth).nome, criadoEm: agoraISO() };
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var r = carimbar(registroCompleto("exe_conferencias", reg, atual), rev, ctx, op.operacaoId);
  return { escritas: [{ t: "gravar", tabela: "exe_conferencias", registro: r }].concat(escritasDeAuditoria(ctx,
    [evento("financeiro", "conferencia", id, atual ? "alterou" : "criou", tipo === "classe" ? "Classe" : "Quantidade contratada", atual ? atual.valor : "", valor, reg.motivo)], op.operacaoId)),
    resultado: { id: id, rev: rev } };
}

/* Orçamento local (o que não vem do Clinicorp). Orçamento do Clinicorp é
   só leitura aqui: muda lá, e a próxima sincronização traz. */
function planejarOrcamentoLocal(ctx, op) {
  var id = idValido(op.id, "orçamento");
  var atual = acharPorChave("exe_orcamentos", id);
  var itensAntes = atual ? lerTudo("exe_orcamento_itens").filter(function (i) { return i.orcamentoId === id; }) : [];
  if (atual) conferirRevisao(atual, op.revBase, function (r) { return publicoDe("exe_orcamentos", r); });
  else if (Number(op.revBase || 0) !== 0) falhar("conflito", "Este orçamento não existe mais.", { rev: 0, atual: null, removida: true });
  var d = op.dados || {};
  var o = { id: id, pacienteRef: String(d.pacienteRef || (atual && atual.pacienteRef) || ""), pacienteNome: String(d.pacienteNome || (atual && atual.pacienteNome) || "").slice(0, 200),
    data: String(d.data || (atual && atual.data) || hojeNaClinica()), situacao: String(d.situacao || (atual && atual.situacao) || "aberto"),
    descontoGeral: d.descontoGeral === undefined ? (atual ? atual.descontoGeral : null) : (d.descontoGeral === "" || d.descontoGeral === null ? null : Number(d.descontoGeral)),
    notas: String(d.notas === undefined ? (atual ? atual.notas : "") : d.notas).slice(0, 2000), criadoEm: atual ? atual.criadoEm : agoraISO() };
  if (!/^(loc|clc):/.test(o.pacienteRef)) falhar("dados_invalidos", "Escolha a paciente.", { campo: "pacienteRef" });
  if (!dataValida(o.data)) falhar("dados_invalidos", "Data inválida.", { campo: "data" });
  if (["aberto", "aprovado", "recusado", "cancelado", "concluido"].indexOf(o.situacao) < 0) falhar("dados_invalidos", "Situação desconhecida.");
  var escritas = [], vistos = {};
  (Array.isArray(d.itens) ? d.itens : []).forEach(function (x, k) {
    var iid = idValido(x.id || (id + "-" + (k + 1)), "item");
    vistos[iid] = true;
    var q = qtdMil(x.quantidade || "1");
    if (!q || q < 0) falhar("dados_invalidos", "Quantidade inválida no item " + (k + 1) + ".");
    if (!String(x.procedimento || "").trim()) falhar("dados_invalidos", "Procedimento vazio no item " + (k + 1) + ".");
    var vu = x.valorUnitario === "" || x.valorUnitario === null || x.valorUnitario === undefined ? null : Number(x.valorUnitario);
    if (vu !== null && (!Number.isInteger(vu) || vu < 0)) falhar("dados_invalidos", "Valor inválido no item " + (k + 1) + ".");
    var classe = String(x.classe || "tratamento");
    if (!EXE_CLASSES[classe]) falhar("dados_invalidos", "Classe inválida no item " + (k + 1) + ".");
    escritas.push({ t: "gravar", tabela: "exe_orcamento_itens", registro: { id: iid, orcamentoId: id, procedimento: String(x.procedimento).slice(0, 160),
      procedimentoRef: String(x.procedimentoRef || "").slice(0, 60), fichaId: String(x.fichaId || "").slice(0, 80), quantidade: qtdTexto(q),
      valorUnitario: vu, desconto: x.desconto ? Number(x.desconto) : null, ordem: k, classe: classe } });
  });
  if (!escritas.length) falhar("dados_invalidos", "O orçamento precisa de ao menos um procedimento.");
  itensAntes.forEach(function (i) {
    if (vistos[i.id]) return;
    if (lerTudo("exe_execucoes").some(function (e) { return e.itemRef === "local:" + id + ":" + i.id && e.estado !== "desfeito"; })) {
      falhar("dados_invalidos", "O item \"" + i.procedimento + "\" já tem execução registrada: desfaça ou reassocie antes de tirá-lo.");
    }
    escritas.push({ t: "remover", tabela: "exe_orcamento_itens", chave: [i.id] });
  });
  var rev = (atual ? Number(atual.rev) || 0 : 0) + 1;
  var reg = carimbar(registroCompleto("exe_orcamentos", o, atual), rev, ctx, op.operacaoId);
  escritas = escritas.concat(escritasDeAuditoria(ctx, [evento("financeiro", "orcamento-local", id, atual ? "alterou" : "criou", "Orçamento", "", o.pacienteNome + " · " + escritas.length + " item(ns)")], op.operacaoId));
  escritas.push({ t: "gravar", tabela: "exe_orcamentos", registro: reg });
  return { escritas: escritas, resultado: { id: id, rev: rev } };
}

/* Preço praticado de uma ficha: vendas do produto ligado e execuções do
   procedimento, cada uma com o custo e o valor GRAVADOS no registro. */
function financeiroPrecosPraticados(ctx) {
  return lerComConsistencia(function () {
    var fichaId = idValido((ctx.dados || {}).fichaId, "ficha");
    var ficha = acharPorChave("fin_fichas", fichaId);
    if (!ficha) falhar("nao_encontrado", "Ficha não encontrada.");
    var linhas = [];
    var itensEst = mapaPorId(lerTudo("est_itens"));
    var vendas = mapaPorId(lerTudo("est_vendas"));
    var porVenda = agrupar(lerTudo("est_venda_itens"), "vendaId");
    Object.keys(porVenda).forEach(function (vid) {
      var v = vendas[vid];
      if (!v || v.estado === "cancelada") return;
      var t = totaisDaVenda(v, porVenda[vid]);
      porVenda[vid].forEach(function (i, k) {
        var ligado = i.fichaId === fichaId || (itensEst[i.itemId] && itensEst[i.itemId].fichaId === fichaId);
        if (!ligado) return;
        var l = t.linhas[k];
        linhas.push({ tipo: "venda", data: v.data, quantidade: l.quantidade, custoUnitario: l.custoUnitario, custoFonte: l.custoFonte, custoTotal: l.custoTotal,
          precoUnitario: i.precoUnitario, desconto: l.desconto + l.descontoGeral, vendido: l.vendido, diferenca: l.diferenca, paciente: v.pacienteNome || "", ref: vid });
      });
    });
    lerTudo("exe_execucoes").forEach(function (e) {
      if (e.estado !== "realizado" || e.fichaId !== fichaId || naturezaDe(e) === "gratuito") return;
      var q = qtdMil(e.quantidade) || 0;
      var valor = e.valorUnitario === null || e.valorUnitario === undefined ? null : Math.round(Number(e.valorUnitario) * q / 1000);
      var custo = e.custoUnitario === null || e.custoUnitario === undefined ? null : Math.round(Number(e.custoUnitario) * q / 1000);
      linhas.push({ tipo: "execucao", data: e.agendamentoData, quantidade: e.quantidade, custoUnitario: e.custoUnitario, custoFonte: e.custoFonte, custoTotal: custo,
        precoUnitario: e.valorUnitario, desconto: null, vendido: valor, diferenca: valor === null || custo === null ? null : valor - custo, paciente: e.pacienteNome, ref: e.id });
    });
    linhas.sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
    var soma = { quantidade: 0, vendido: 0, custo: 0, desconhecido: 0, semValor: 0 };
    linhas.forEach(function (l) {
      soma.quantidade += qtdMil(l.quantidade) || 0;
      if (l.vendido === null) soma.semValor++; else soma.vendido += l.vendido;
      if (l.custoTotal === null) soma.desconhecido++; else soma.custo += l.custoTotal;
    });
    var precos = linhas.filter(function (l) { return l.precoUnitario !== null && l.precoUnitario !== undefined; }).map(function (l) { return Number(l.precoUnitario); });
    return { fichaId: fichaId, precoPadrao: ficha.precoAtual, linhas: linhas.slice(0, 300),
      resumo: { quantidade: qtdTexto(soma.quantidade), vendido: soma.vendido, custo: soma.desconhecido ? null : soma.custo,
        diferenca: soma.desconhecido || soma.semValor ? null : soma.vendido - soma.custo, linhasSemCusto: soma.desconhecido, linhasSemValor: soma.semValor,
        menorPreco: precos.length ? Math.min.apply(null, precos) : null, maiorPreco: precos.length ? Math.max.apply(null, precos) : null },
      aviso: "Diferença = valor vendido − custo gravado em cada registro. Antes de taxas (quando não informadas) e de despesas fixas: não é lucro líquido." };
  });
}
