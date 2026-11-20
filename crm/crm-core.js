/* =====================================================================
   FloreSer · Corpo e Alma — infraestrutura do CRM
   ---------------------------------------------------------------------
   A ponte entre a aplicação React (o JSX inline no index.html) e a camada
   compartilhada: sessão (compartilhado/sessao.js), transporte
   (compartilhado/rede.js) e o motor de dados (compartilhado/dados.js).

   Script CLÁSSICO, de propósito: ele roda no instante em que o navegador
   passa por ele, antes de o Babel compilar o JSX — que encontra tudo daqui
   pronto. O endereço do Apps Script não mora mais aqui: está em
   compartilhado/config.js, o lugar único.

   window.storage continua com a mesma cara para o JSX, mas por baixo:
     get  → crm.ler
     set  → o motor compara com a última versão confirmada e manda só as
            leads, os contatos e os intervalos que mudaram, cada um com a
            revisão de que partiu. Conflito vem localizado, com o "servidor
            sintético" para o JSX conciliar como sempre conciliou.
   ===================================================================== */

/* de onde veio a sessão: a senha do módulo ou um usuário individual */
var ORIGEM_SESSAO = { tipo: "senhaModulo" };

function tokenAtual() { return window.FloreSerSessao ? FloreSerSessao.tokenPara("crm") : ""; }

/* Compatibilidade com o JSX: SESSAO.token sempre diz o token que vale
   agora; atribuir a ele não faz nada (quem guarda é o sessao.js). */
var SESSAO = {
  get token() { return tokenAtual(); },
  set token(valor) { /* a sessão mora no compartilhado/sessao.js */ },
  rev: 0
};

async function sairDoCRM() {
  await FloreSerSessao.sairDoModulo("crm");
  location.reload();
}

/* A resposta no formato antigo, achatada: o JSX compara r.erro com um
   código ("sem_acesso"), e o resto dos campos vem no primeiro nível. */
function achatarResposta(r) {
  if (!r.ok) return { ok: false, erro: r.erro.codigo, categoria: r.erro.categoria, mensagem: r.erro.mensagem, erroInfo: r.erro };
  var saida = { ok: true };
  Object.keys(r.dados || {}).forEach(function (k) { saida[k] = r.dados[k]; });
  return saida;
}

/* As chamadas que o JSX ainda faz no formato antigo, traduzidas para a API
   v2. Gravações ganham um operacaoId por pedido: a repetição automática
   (resposta perdida) é reconhecida pelo servidor e não aplica duas vezes. */
var ACOES_CRM_V2 = {
  crm_agenda_agendar: { acao: "crm.agendarNaAgenda", gravacao: true },
  lixeira_mover: { acao: "lixeira.mover", gravacao: true },
  repetido_na_lixeira: { acao: "lixeira.repetido" },
  auditoria_listar: { acao: "auditoria.listar" }
};

async function chamarAPI(corpo) {
  var mapa = ACOES_CRM_V2[corpo.acao] || { acao: corpo.acao, gravacao: false };
  var dados = {};
  Object.keys(corpo).forEach(function (k) { if (k !== "acao" && k !== "token") dados[k] = corpo[k]; });
  if (mapa.gravacao && !dados.operacaoId) dados.operacaoId = FloreSerRede.novoId("crm-");
  var r = await FloreSerRede.chamar(mapa.acao, dados, mapa.gravacao
    ? { token: tokenAtual(), tentativas: 2, repetirIncerto: true }
    : { token: tokenAtual(), leitura: true });
  return achatarResposta(r);
}

/* ---- o motor do CRM: leads, contatos e os intervalos das cadências ---- */
var motorCRM = FloreSerDados.criarSincronizador({
  modulo: "crm",
  acao: "crm.aplicar",
  token: tokenAtual,
  colecoes: {
    leads: {
      criar: "lead.criar", alterar: "lead.alterar", remover: "lead.remover",
      campos: ["nome", "whatsapp", "interesse", "observacoes", "etapa", "cadencia", "exCliente", "ultimoContato",
        "criadoEm", "dtConversa", "dtAgendamento", "dtComparecimento", "dtVenda", "dtReprovado", "origem", "dataAgendada"]
    },
    /* "Contatei": o evento sobe dentro da operação da lead que mudou junto */
    contatos: {
      criar: "contato.registrar", soAcrescenta: true,
      criacao: function (c) { return { dados: { id: c.id, leadId: c.leadId, data: c.data, criadoEm: c.criadoEm } }; },
      anexarEm: { colecao: "leads", campo: "leadId", como: "contatos" }
    }
  },
  valores: { dias: { tipo: "config.cadencias", rev: "_revDias", payload: function (l) { return { dias: l.dias }; } } }
});

function erroDoMotor(r) {
  var e = new Error((r.erro && r.erro.codigo) || "falha ao salvar");
  if (r.conflitos && r.conflitos.length) { e.conflito = true; e.dados = r.servidor; return e; }
  if (r.sessaoPerdida) { e.motivo = "sessao"; return e; }
  if (r.semAcesso) { e.motivo = "sem_acesso"; return e; }
  if (r.contaTrocada) { e.motivo = "conta_trocada"; return e; }
  if (r.versao && !(r.erro && r.erro.codigo === "manutencao")) { e.motivo = "versao"; return e; }
  if (r.transitorio || r.versao) { e.motivo = "transitorio"; e.semRede = !!(r.erro && r.erro.codigo === "sem_conexao"); return e; }
  e.motivo = "recusado";
  e.erros = r.erros || [];
  return e;
}

/* Adaptador: o app continua usando window.storage. */
window.storage = {
  async get(chave) {
    var r = await FloreSerRede.chamar("crm.ler", {}, { token: tokenAtual(), leitura: true });
    if (!r.ok) { var e = new Error(r.erro.codigo); e.motivo = r.erro.codigo; e.categoria = r.erro.categoria; throw e; }
    return { key: chave, value: JSON.stringify(r.dados), shared: false };
  },
  async set(chave, valor) {
    var r = await motorCRM.enviar(JSON.parse(valor));
    if (!r.ok) throw erroDoMotor(r);
    return { key: chave, value: valor, shared: false, corrigidas: r.corrigidas || [] };
  },
  async delete(chave) { return { key: chave, deleted: true, shared: false }; },
  async list() { return { keys: [], shared: false }; },
};
