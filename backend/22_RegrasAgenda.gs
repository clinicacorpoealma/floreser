/* =====================================================================
   22_RegrasAgenda — séries, intervalos e a ponte com o CRM (regras puras)
   ---------------------------------------------------------------------
   · A Agenda é a fonte operacional dos atendimentos. Cada área tem o
     PRÓXIMO atendimento (agendamento) e os seguintes da série (proximos).
     arrumarSerieAgenda() garante que o próximo é sempre o mais cedo — a
     mesma regra de arrumarSerie() no agenda.js.
   · Intervalos: inteiro de 1 a 365 dias. A quinzena é 14.
   · fimPrevisto e aRemarcar medem o atraso do tratamento.
   · maturar() (no navegador) transforma em sessão o atendimento cujo dia
     passou, pelo relógio. Isso NUNCA confirma presença no CRM.
   · A ponte Agenda → CRM só olha leads EM AGENDADO, pelo vínculo
     crmLeadId (nunca pelo nome), e só mexe na dataAgendada.
   ===================================================================== */

var AREAS_AGENDA = ["facial", "corporal", "capilar"];
var AREAS_NOME = { facial: "Facial", corporal: "Corporal", capilar: "Capilar" };
var INTERVALO_MAX = 365;
var FREQ_PADRAO_AGENDA = 21;

function intervaloValido(n) { return Number.isInteger(n) && n >= 1 && n <= INTERVALO_MAX; }

function datasValidasOrdenadas(lista) {
  var vistas = {};
  return (Array.isArray(lista) ? lista : []).map(function (d) { return String(d || "").trim(); })
    .filter(function (d) { if (!dataValida(d) || vistas[d]) return false; vistas[d] = true; return true; })
    .sort();
}

/* O próximo é sempre o mais cedo; os seguintes, em ordem e sem repetir. */
function arrumarSerieAgenda(c) {
  if (!c) return c;
  var vistos = {};
  if (c.agendamento) vistos[c.agendamento.data] = true;
  var lista = datasValidasOrdenadas(c.proximos).filter(function (d) { return !vistos[d]; });
  if (!c.agendamento && lista.length) {
    c.agendamento = { data: lista.shift(), temFollowUp: false };
  } else if (c.agendamento && lista.length && lista[0] < c.agendamento.data) {
    lista.push(c.agendamento.data); lista.sort();
    var primeiro = lista.shift();
    lista = lista.filter(function (d) { return d !== primeiro; });
    c.agendamento = { data: primeiro, temFollowUp: false };
  }
  c.proximos = lista;
  if (!c.fimPrevisto && c.agendamento && lista.length) c.fimPrevisto = lista[lista.length - 1];
  if (!c.agendamento && !(c.aRemarcar > 0)) c.fimPrevisto = null;
  return c;
}

/* Valida o ciclo de uma área vindo do navegador e devolve a forma normal. */
function validarCiclo(c, area) {
  if (c === null) return null;
  if (!c || typeof c !== "object") falhar("dados_invalidos", "Ciclo inválido em " + area + ".");
  var freq = Number(c.freq);
  if (!intervaloValido(freq)) falhar("dados_invalidos", "Intervalo fora de 1 a " + INTERVALO_MAX + " dias em " + area + ".", { campo: "freq" });
  var data = function (v, nome) {
    if (v === null || v === undefined || v === "") return null;
    if (!dataValida(String(v))) falhar("dados_invalidos", "Data inválida em " + area + " (" + nome + ").");
    return String(v);
  };
  var ag = c.agendamento && c.agendamento.data ? { data: data(c.agendamento.data, "agendamento"), temFollowUp: !!c.agendamento.temFollowUp } : null;
  var n = function (v) { var x = Math.round(Number(v) || 0); return x < 0 ? 0 : x; };
  return arrumarSerieAgenda({
    freq: freq, ultimo: data(c.ultimo, "último"), agendamento: ag,
    proximos: datasValidasOrdenadas(c.proximos), fimPrevisto: data(c.fimPrevisto, "fim previsto"),
    aRemarcar: n(c.aRemarcar), adiadaPara: data(c.adiadaPara, "adiada"), naoRespondeu: n(c.naoRespondeu)
  });
}

function marcadasDoCiclo(c) {
  if (!c || !c.agendamento) return [];
  return [c.agendamento.data].concat(c.proximos || []);
}

/* ---------------------------------------------------------------------
   Agenda → CRM: o que mudou nos agendamentos de uma paciente vinculada
   ---------------------------------------------------------------------
   Devolve a nova dataAgendada da lead, ou undefined se nada deve mudar.
     remarcou   o agendamento que tinha a data do CRM mudou de dia
     desmarcou  esse agendamento foi desfeito: a lead fica sem data
     agendou    a lead estava sem data e ganhou um agendamento
   Sessão pela passagem do dia, mais de um candidato ou lead fora de
   Agendado: nada muda. */
function ecoDaPacienteNoCRM(antes, depois, lead) {
  if (!lead || lead.etapa !== "agendado" || !depois || !depois.crmLeadId) return undefined;
  var dataDe = function (p, k) { var c = ((p || {}).ciclos || {})[k]; return c && c.agendamento ? String(c.agendamento.data || "") : ""; };
  var conta = function (p, tipo, k, data) {
    return ((p || {}).historico || []).filter(function (h) {
      return h.tipo === tipo && h.area === k && (data === undefined || String(h.data) === data);
    }).length;
  };
  var mudancas = [];
  AREAS_AGENDA.forEach(function (k) {
    var de = dataDe(antes, k), para = dataDe(depois, k);
    if (de === para) return;
    if (de && conta(depois, "sessao", k, de) > conta(antes, "sessao", k, de)) return;   /* virou sessão */
    var desmarcou = conta(depois, "desmarcou", k) > conta(antes, "desmarcou", k);
    if (para) mudancas.push({ de: de, para: para, tipo: !de ? "agendou" : desmarcou ? "assumiu" : "remarcou" });
    else if (desmarcou) mudancas.push({ de: de, para: "", tipo: "desmarcou" });
  });
  if (!mudancas.length) return undefined;
  var atual = String(lead.dataAgendada || "");
  var certas = mudancas.filter(function (m) { return atual ? m.de === atual : m.tipo !== "desmarcou"; });
  if (certas.length !== 1 || certas[0].para === atual) return undefined;
  return { data: certas[0].para, tipo: certas[0].tipo, antes: atual };
}

var CONTEXTO_DO_ECO = {
  desmarcou: "agendamento desfeito na Agenda",
  assumiu: "desmarcado na Agenda; o atendimento seguinte da série assumiu",
  remarcou: "remarcado na Agenda",
  agendou: "agendado na Agenda"
};

/* ---------------------------------------------------------------------
   Auditoria da paciente — uma frase por mudança
   --------------------------------------------------------------------- */

var CAMPOS_AUDITORIA_PACIENTE = [
  { chave: "nome", rotulo: "Nome" }, { chave: "obs", rotulo: "Observações" },
  { chave: "whatsapp", rotulo: "WhatsApp" }, { chave: "origem", rotulo: "Origem", origem: true }
];

function eventosPaciente(antes, depois, nomes) {
  var id = depois.id, ev = [];
  var E = function (acao, campo, a, b, ctxt) { ev.push(evento("agenda", "paciente", id, acao, campo, a, b, ctxt)); };
  if (!antes) { E("criou", "", "", ouTraco(depois.nome)); return ev; }

  CAMPOS_AUDITORIA_PACIENTE.forEach(function (def) {
    var a = antes[def.chave], b = depois[def.chave];
    if (mesmoValor(a, b)) return;
    E("alterou", def.rotulo, def.origem ? (ORIGENS_CRM[a] || ouTraco(a)) : ouTraco(a), def.origem ? (ORIGENS_CRM[b] || ouTraco(b)) : ouTraco(b));
  });
  if (!mesmoValor(antes.categoriaId, depois.categoriaId)) {
    E("alterou", "Categoria", nomes.categoria(antes.categoriaId), nomes.categoria(depois.categoriaId));
  }
  if (!!antes.arquivada !== !!depois.arquivada) E(depois.arquivada ? "arquivou" : "restaurou_ficha", "", "", "");

  AREAS_AGENDA.forEach(function (k) {
    var ca = (antes.ciclos || {})[k], cb = (depois.ciclos || {})[k], nome = AREAS_NOME[k];
    if (!ca && cb) { E("alterou", "Ciclo " + nome, "—", cb.freq + " dias"); return; }
    if (ca && !cb) { E("alterou", "Ciclo " + nome, ca.freq + " dias", "—"); return; }
    if (!ca || !cb) return;
    if (!mesmoValor(ca.freq, cb.freq)) E("alterou", "Ciclo " + nome, ca.freq + " dias", cb.freq + " dias");
    if (!mesmoValor(ca.ultimo, cb.ultimo)) E("alterou", "Último atendimento " + nome, dataBR(ca.ultimo), dataBR(cb.ultimo));
    var agA = (ca.agendamento || {}).data, agB = (cb.agendamento || {}).data;
    if (!mesmoValor(agA, agB)) {
      var virouSessao = !vazio(agA) && mesmoValor(cb.ultimo, agA) && !mesmoValor(ca.ultimo, agA);
      var seguinteAssumiu = !vazio(agA) && !vazio(agB) && !virouSessao &&
        (ca.proximos || [])[0] === agB && (cb.proximos || []).indexOf(agA) < 0;
      E(virouSessao ? "alterou" : seguinteAssumiu ? "desmarcou" : (agB ? "agendou" : "desmarcou"),
        "Agendamento " + nome, dataBR(agA), dataBR(agB),
        virouSessao ? "sessão de " + dataBR(agA) + " registrada pela passagem do dia"
          : seguinteAssumiu ? "desmarcado · o seguinte da série passou a ser o próximo" : "");
    }
    var pendA = Number(ca.aRemarcar) || 0, pendB = Number(cb.aRemarcar) || 0;
    if (pendA !== pendB) E(pendB > pendA ? "desmarcou" : "alterou", "Sessões a remarcar " + nome, String(pendA), String(pendB));
    if (!mesmoValor(ca.fimPrevisto, cb.fimPrevisto) && !vazio(cb.fimPrevisto)) {
      E("alterou", "Fim previsto " + nome, dataBR(ca.fimPrevisto), dataBR(cb.fimPrevisto));
    }
    var serieA = ca.proximos || [], serieB = cb.proximos || [];
    var soSubiu = serieA.length && serieA[0] === agB && serieA.slice(1).join() === serieB.join();
    if (serieA.join() !== serieB.join() && !soSubiu) {
      var mostrar = function (l) { return l.length ? l.map(dataBR).join(", ") : "—"; };
      E(serieB.length > serieA.length ? "agendou" : serieB.length < serieA.length ? "desmarcou" : "alterou",
        "Série " + nome, mostrar(serieA), mostrar(serieB));
    }
  });

  var maqA = (antes.maquinas || []).map(String), maqB = (depois.maquinas || []).map(String);
  maqB.forEach(function (m) { if (maqA.indexOf(m) < 0) E("adicionou", "Máquina", "", nomes.maquina(m)); });
  maqA.forEach(function (m) { if (maqB.indexOf(m) < 0) E("retirou", "Máquina", nomes.maquina(m), ""); });

  var rot = function (c) { return ouTraco(c.texto) + " de " + dataBR(c.inicio) + " a " + dataBR(c.fim); };
  var condA = {}, condB = {};
  (antes.condicoes || []).forEach(function (c) { condA[c.id] = c; });
  (depois.condicoes || []).forEach(function (c) { condB[c.id] = c; });
  Object.keys(condB).forEach(function (cid) {
    if (!condA[cid]) E("adicionou", "Condição", "", rot(condB[cid]));
    else if (rot(condA[cid]) !== rot(condB[cid])) E("alterou", "Condição", rot(condA[cid]), rot(condB[cid]));
  });
  Object.keys(condA).forEach(function (cid) { if (!condB[cid]) E("retirou", "Condição", rot(condA[cid]), ""); });
  return ev;
}
