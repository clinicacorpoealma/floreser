/* =====================================================================
   20_RegrasCRM — as regras do funil, conferidas no servidor
   ---------------------------------------------------------------------
   As mesmas regras do crm/index.html, agora também aqui: o navegador
   calcula para responder na hora; o servidor confere antes de gravar.
   Funções puras — sem planilha — e por isso testadas uma a uma em
   testes/regras-backend.js.

   · Quem cuida da lead SAI DA ETAPA (comercialDaEtapaCRM). Nada de gravar
     "responsável": seriam duas verdades.
   · Fazer orçamento ≠ Em aberto. A antiga com_orcamento era Em aberto.
   · dtAgendamento (o dia em que foi agendada, marco do funil) ≠
     dataAgendada (o dia em que a pessoa vem). Nunca uma sai da outra.
   · Entrar em Agendado exige a data do atendimento.
   · Falta não carimba nada e não apaga dtAgendamento nem dataAgendada.
   · Etapa sem cadência não guarda cadência.
   ===================================================================== */

var ETAPAS_CRM = {
  nao_responde: { nome: "Não responde", cadencias: ["quente", "morno", "frio", "muito_frio"], nivel: null, comercial: 1 },
  conversando: { nome: "Conversando", cadencias: ["quente"], nivel: 1, comercial: 1 },
  nurturing: { nome: "Nurturing", cadencias: ["frio", "muito_frio"], nivel: null, comercial: 1 },
  agendado: { nome: "Agendado", cadencias: [], nivel: 2, comercial: 2 },
  falta: { nome: "Falta", cadencias: ["quente"], nivel: null, comercial: 1 },
  fazer_orcamento: { nome: "Fazer orçamento", cadencias: [], nivel: 3, comercial: 2 },
  em_aberto: { nome: "Em aberto", cadencias: ["quente", "morno", "frio", "muito_frio"], nivel: 3, comercial: 1 },
  venda: { nome: "Venda", cadencias: [], nivel: 4, comercial: null, arquivo: true },
  venda_reprovada: { nome: "Venda reprovada", cadencias: [], nivel: 3, comercial: null, arquivo: true, encerra: true },
  recusado: { nome: "Recusado", cadencias: [], nivel: null, comercial: null, arquivo: true, encerra: true }
};

/* nível para automações nunca rebaixarem uma lead (integração com a Agenda) */
var NIVEL_ETAPA_CRM = { nao_responde: 0, nurturing: 0, falta: 0, conversando: 1, agendado: 2,
  fazer_orcamento: 3, em_aberto: 3, venda_reprovada: 3, venda: 4, recusado: 0 };

var MARCOS_CRM = [null, "dtConversa", "dtAgendamento", "dtComparecimento", "dtVenda"];
var CADENCIAS_CRM = { quente: "Quente", morno: "Morno", frio: "Frio", muito_frio: "Muito frio" };
var CADENCIAS_PADRAO_DIAS = { quente: 2, morno: 5, frio: 15, muito_frio: 30 };
var ORIGENS_CRM = { instagram: "Instagram", radio: "Rádio", vale_presente: "Vale-presente",
  indicacao: "Indicação", google: "Google", outros: "Outros" };

/* Etapas antigas que ainda podem aparecer em dado velho. */
var ETAPAS_MIGRADAS = { reprovado: "recusado", com_orcamento: "em_aberto", agendando: "conversando" };

var CAMPOS_LEAD = {
  nome: { tipo: "texto", max: 200 }, whatsapp: { tipo: "texto", max: 40 },
  interesse: { tipo: "texto", max: 500 }, observacoes: { tipo: "texto", max: 8000 },
  etapa: { tipo: "texto", max: 40 }, cadencia: { tipo: "texto", max: 20 },
  exCliente: { tipo: "booleano" }, ultimoContato: { tipo: "data" }, criadoEm: { tipo: "data" },
  dtConversa: { tipo: "data" }, dtAgendamento: { tipo: "data" }, dtComparecimento: { tipo: "data" },
  dtVenda: { tipo: "data" }, dtReprovado: { tipo: "data" }, origem: { tipo: "texto", max: 40 },
  dataAgendada: { tipo: "data" }
};

function comercialDaEtapaCRM(etapa) {
  return (ETAPAS_CRM[etapa] || {}).comercial || null;
}

function cadenciaValidaCRM(etapa, cadencia) {
  var permitidas = (ETAPAS_CRM[etapa] || { cadencias: [] }).cadencias;
  if (!permitidas.length) return "";
  return permitidas.indexOf(cadencia) >= 0 ? cadencia : permitidas[0];
}

/* Valida e normaliza um conjunto de campos vindos do navegador. Campo fora
   da lista é recusado — inclusive "responsavel". */
function validarCampos(campos, regras, onde) {
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) falhar("dados_invalidos", "Campos ausentes em " + onde + ".");
  var saida = {};
  Object.keys(campos).forEach(function (k) {
    var r = regras[k];
    if (!r) falhar("dados_invalidos", "Campo não permitido: " + k + ".", { campo: k });
    var v = campos[k];
    if (r.tipo === "texto") {
      v = v === null || v === undefined ? "" : String(v);
      if (v.length > r.max) falhar("dados_invalidos", "O campo " + k + " ficou longo demais.", { campo: k });
    } else if (r.tipo === "data") {
      if (v === "" || v === null || v === undefined) v = null;
      else if (!dataValida(String(v))) falhar("dados_invalidos", "Data inválida em " + k + ".", { campo: k });
    } else if (r.tipo === "booleano") {
      if (v !== true && v !== false) falhar("dados_invalidos", "Valor inválido em " + k + ".", { campo: k });
    } else if (r.tipo === "inteiro") {
      if (v === "" || v === null || v === undefined) v = null;
      else if (!Number.isInteger(Number(v))) falhar("dados_invalidos", "Número inválido em " + k + ".", { campo: k });
      else v = Number(v);
    }
    saida[k] = v;
  });
  return saida;
}

/* Confere a lead depois da mudança e devolve a versão corrigida.
   antes: null numa criação. hoje: o dia na clínica. */
function conferirLeadCRM(antes, depois, hoje) {
  var l = {};
  Object.keys(depois).forEach(function (k) { l[k] = depois[k]; });
  if (ETAPAS_MIGRADAS[l.etapa]) l.etapa = ETAPAS_MIGRADAS[l.etapa];
  if (!l.etapa) l.etapa = "nao_responde";
  if (!ETAPAS_CRM[l.etapa]) falhar("dados_invalidos", "Etapa desconhecida: " + l.etapa + ".", { campo: "etapa" });
  if (!String(l.nome || "").trim()) falhar("dados_invalidos", "A lead precisa de um nome.", { campo: "nome" });
  if (l.origem && !ORIGENS_CRM[l.origem] && (!antes || l.origem !== antes.origem)) {
    falhar("dados_invalidos", "Origem desconhecida.", { campo: "origem" });
  }

  var etapa = ETAPAS_CRM[l.etapa];
  var mudouEtapa = !antes || antes.etapa !== l.etapa;

  /* etapa sem cadência não guarda cadência; com cadência, uma das dela */
  l.cadencia = cadenciaValidaCRM(l.etapa, l.cadencia);

  if (mudouEtapa) {
    if (l.etapa === "agendado" && !l.dataAgendada) {
      falhar("dados_invalidos", "Agendado precisa da data do atendimento.", { campo: "dataAgendada" });
    }
    if (l.etapa === "falta" && antes) {
      /* faltar não apaga que houve um agendamento */
      if (!l.dtAgendamento && antes.dtAgendamento) l.dtAgendamento = antes.dtAgendamento;
      if (!l.dataAgendada && antes.dataAgendada) l.dataAgendada = antes.dataAgendada;
    }
    if (antes && antes.dtComparecimento && l.dtComparecimento !== antes.dtComparecimento && l.etapa !== antes.etapa) {
      /* comparecimento que existia nunca é reescrito por troca de etapa */
      l.dtComparecimento = antes.dtComparecimento;
    }
    /* os marcos até o nível da etapa nova existem — quem não tinha, ganha hoje */
    if (etapa.nivel) {
      for (var i = 1; i <= etapa.nivel; i++) if (!l[MARCOS_CRM[i]]) l[MARCOS_CRM[i]] = hoje;
    }
    if (etapa.encerra && !l.dtReprovado) l.dtReprovado = hoje;
  }
  return l;
}

/* ---------------------------------------------------------------------
   A auditoria de uma lead: frases, não JSON
   --------------------------------------------------------------------- */

var CAMPOS_AUDITORIA_LEAD = [
  { chave: "nome", rotulo: "Nome" }, { chave: "whatsapp", rotulo: "WhatsApp" },
  { chave: "interesse", rotulo: "Interesse" }, { chave: "observacoes", rotulo: "Observações" },
  { chave: "etapa", rotulo: "Etapa do funil", tabela: "etapas" },
  { chave: "cadencia", rotulo: "Cadência", tabela: "cadencias" },
  { chave: "origem", rotulo: "Origem", tabela: "origens" },
  { chave: "exCliente", rotulo: "Ex-cliente", booleano: true },
  { chave: "ultimoContato", rotulo: "Último contato", data: true },
  { chave: "dataAgendada", rotulo: "Data do atendimento", data: true },
  { chave: "dtConversa", rotulo: "1ª conversa", data: true },
  { chave: "dtAgendamento", rotulo: "Agendou em", data: true },
  { chave: "dtComparecimento", rotulo: "Comparecimento", data: true },
  { chave: "dtVenda", rotulo: "Venda", data: true },
  { chave: "dtReprovado", rotulo: "Reprovada em", data: true }
];

function nomeEtapa(id) { return (ETAPAS_CRM[id] || {}).nome || (id ? String(id) : "—"); }

function mostrarCampoLead(def, v) {
  if (def.tabela === "etapas") return nomeEtapa(v);
  if (def.tabela === "cadencias") return CADENCIAS_CRM[v] || (v ? String(v) : "—");
  if (def.tabela === "origens") return ORIGENS_CRM[v] || (v ? String(v) : "—");
  if (def.booleano) return v ? "sim" : "não";
  if (def.data) return dataBR(v);
  return ouTraco(v);
}

function eventosLead(antes, depois) {
  var id = depois.id, ev = [];
  if (!antes) {
    ev.push(evento("crm", "lead", id, "criou", "", "", ouTraco(depois.nome)));
    if (!vazio(depois.origem)) ev.push(evento("crm", "lead", id, "criou_detalhe", "Origem", "", ORIGENS_CRM[depois.origem] || depois.origem));
    if (!vazio(depois.whatsapp)) ev.push(evento("crm", "lead", id, "criou_detalhe", "WhatsApp", "", String(depois.whatsapp)));
    return ev;
  }
  CAMPOS_AUDITORIA_LEAD.forEach(function (def) {
    var a = antes[def.chave], b = depois[def.chave];
    if (def.booleano ? (!!a === !!b) : mesmoValor(a, b)) return;
    var acao = def.chave === "ultimoContato" && !vazio(b) ? "contato" : "alterou";
    ev.push(evento("crm", "lead", id, acao, def.rotulo, mostrarCampoLead(def, a), mostrarCampoLead(def, b)));
  });
  return ev;
}
