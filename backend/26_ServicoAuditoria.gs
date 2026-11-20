/* =====================================================================
   26_ServicoAuditoria — quem mudou esta ficha, o quê, quando
   ---------------------------------------------------------------------
   Auditoria de NEGÓCIO (sis_auditoria) não é log técnico (sis_logs). Ela
   responde a pergunta de quem usa a clínica e só cresce. O autor sai da
   sessão, nunca do navegador. Os valores são guardados já em português
   ("Conversando", "R$ 350,00"), como texto — o '@' impede o Sheets de
   transformar "01/05/2026" em data.

   Os eventos entram no MESMO plano da operação que os causou: se a
   gravação não aconteceu, não há histórico; se aconteceu, há.
   ===================================================================== */

var MAX_TEXTO_AUDITORIA = 300;
var BLOCO_AUDITORIA = 500;
var TETO_VARREDURA = 4000;

/* ---- vocabulário comum ---- */

function vazio(v) {
  return v === undefined || v === null || v === "" || (typeof v === "number" && isNaN(v));
}

/* 350 e "350.00" são o mesmo valor; "" e null, a mesma ausência. */
function mesmoValor(a, b) {
  if (vazio(a) && vazio(b)) return true;
  if (vazio(a) !== vazio(b)) return false;
  if (typeof a === "boolean" || typeof b === "boolean") return !!a === !!b;
  var na = Number(a), nb = Number(b);
  if (String(a).trim() !== "" && String(b).trim() !== "" && isFinite(na) && isFinite(nb)) return na === nb;
  return String(a).trim() === String(b).trim();
}

function dataBR(iso) {
  var t = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t || "—";
  return t.slice(8, 10) + "/" + t.slice(5, 7) + "/" + t.slice(0, 4);
}

/* o mesmo formato da 3.5.0 ("R$ 1234,50"), para o histórico não mudar de cara */
function dinheiroBR(centavos) {
  return "R$ " + centavosParaTexto(Number(centavos) || 0).replace(".", ",");
}

function ouTraco(v) { return vazio(v) ? "—" : String(v); }

function soDigitos(bruto) {
  var so = String(bruto == null ? "" : bruto).replace(/[^0-9]/g, "");
  if (so.length > 11 && so.indexOf("55") === 0) {
    var sem = so.slice(2);
    if (sem.length === 10 || sem.length === 11) return sem;
  }
  return so;
}

function chaveDeNome(bruto) {
  return String(bruto == null ? "" : bruto).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function cortar(t) {
  var v = String(t === undefined || t === null ? "" : t);
  return v.length > MAX_TEXTO_AUDITORIA ? v.slice(0, MAX_TEXTO_AUDITORIA - 1) + "…" : v;
}

function evento(modulo, entidade, entidadeId, acao, campo, antes, depois, contexto) {
  return { modulo: modulo, entidade: entidade, entidadeId: entidadeId, acao: acao, campo: campo || "",
    antes: antes === undefined ? "" : antes, depois: depois === undefined ? "" : depois, contexto: contexto || "" };
}

function escritasDeAuditoria(ctx, eventos, operacaoId) {
  var quem = assinaturaDe(ctx.auth);
  var em = agoraISO();
  return (eventos || []).filter(Boolean).map(function (e) {
    return { t: "inserir", tabela: "sis_auditoria", registro: {
      id: novoId("au"), operacaoId: operacaoId, em: em, modulo: e.modulo, entidade: e.entidade,
      entidadeId: String(e.entidadeId), acao: e.acao, campo: cortar(e.campo), antes: cortar(e.antes),
      depois: cortar(e.depois), autorTipo: quem.tipo, autorId: quem.id, autorNome: quem.nome,
      contexto: cortar(e.contexto), pedidoId: ctx.pedidoId || "" } };
  });
}

function eventoPublico(e) {
  return { operacaoId: e.operacaoId, em: e.em, acao: e.acao, campo: e.campo, antes: e.antes, depois: e.depois,
    autorTipo: e.autorTipo, autorNome: e.autorNome, contexto: e.contexto };
}

/* ---- leitura: uma ficha ----
   O próprio Sheets procura o id na coluna (TextFinder); só as linhas
   achadas atravessam a ponte. Conferir o módulo é o que impede quem tem o
   CRM de ler a auditoria de uma paciente pedindo o id dela. */
function auditoriaListar(ctx) {
  var d = ctx.dados;
  var modulo = String(d.modulo || ""), entidade = String(d.entidade || ""), entidadeId = String(d.entidadeId || "");
  var inicio = Math.max(0, Number(d.inicio) || 0);
  var quantos = Math.min(100, Math.max(1, Number(d.quantos) || 20));
  if (!modulo || !entidadeId) falhar("dados_invalidos", "Informe o módulo e a ficha.");
  var linhas = linhasCom("sis_auditoria", "entidadeId", entidadeId)
    .filter(function (e) { return e.modulo === modulo && (!entidade || e.entidade === entidade); })
    .reverse();
  return { eventos: linhas.slice(inicio, inicio + quantos).map(eventoPublico), total: linhas.length,
    temMais: inicio + quantos < linhas.length };
}

/* ---- leitura: visão geral do painel, de trás para a frente ---- */
function auditoriaGeral(ctx) {
  var d = ctx.dados;
  var modulo = String(d.modulo || ""), autor = String(d.autor || "").toLowerCase();
  var busca = chaveDeNome(d.busca || ""), de = String(d.de || ""), ate = String(d.ate || "");
  var inicio = Math.max(0, Number(d.inicio) || 0), quantos = Math.min(100, Math.max(1, Number(d.quantos) || 40));
  var t = tabela("sis_auditoria");
  var fim = ultimaLinha(t), eventos = [], passados = 0, varridas = 0;
  var fuso = fusoDaClinica();
  while (fim >= 2 && eventos.length < quantos && varridas < TETO_VARREDURA) {
    var comeco = Math.max(2, fim - BLOCO_AUDITORIA + 1);
    var numeros = [];
    for (var n = comeco; n <= fim; n++) numeros.push(n);
    var bloco = lerLinhasNumeradas(t, numeros);
    varridas += numeros.length;
    for (var k = bloco.length - 1; k >= 0 && eventos.length < quantos; k--) {
      var e = bloco[k];
      var dia = e.em ? Utilities.formatDate(new Date(e.em), fuso, "yyyy-MM-dd") : "";
      if (modulo && e.modulo !== modulo) continue;
      if (autor && String(e.autorNome || "").toLowerCase().indexOf(autor) < 0) continue;
      if (de && dia < de) continue;
      if (ate && dia > ate) continue;
      if (busca && chaveDeNome([e.campo, e.antes, e.depois, e.contexto, e.entidadeId].join(" ")).indexOf(busca) < 0) continue;
      passados++;
      if (passados <= inicio) continue;
      eventos.push({ id: e.id, operacaoId: e.operacaoId, em: e.em, modulo: e.modulo, entidade: e.entidade,
        entidadeId: e.entidadeId, acao: e.acao, campo: e.campo, antes: e.antes, depois: e.depois,
        autorTipo: e.autorTipo, autorId: e.autorId, autorNome: e.autorNome, contexto: e.contexto });
    }
    fim = comeco - 1;
  }
  return { eventos: eventos, trouxe: eventos.length, temMais: eventos.length === quantos && fim >= 2, varreuTudo: fim < 2 };
}

/* ---- exclusão definitiva: a ficha não continua viva aqui dentro ---- */
function apagarAuditoriaDaEntidade(modulo, entidadeId) {
  var alvo = linhasCom("sis_auditoria", "entidadeId", entidadeId).filter(function (e) { return e.modulo === modulo; });
  if (alvo.length) remover("sis_auditoria", alvo);
  return alvo.length;
}
