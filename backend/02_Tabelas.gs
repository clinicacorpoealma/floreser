/* =====================================================================
   02_Tabelas — acesso às abas, sem regra de negócio
   ---------------------------------------------------------------------
   Tudo o que toca o Sheets passa por aqui. Os serviços falam em registros
   ({ id, nome, rev, ... }) e nunca em linha, coluna ou célula. Trocar a
   planilha por outro armazenamento um dia é trocar este arquivo e o
   esquema; regras e telas não sabem onde os dados moram.

   Quatro decisões:

   1. O CABEÇALHO MANDA. A posição de cada campo sai do nome na linha 1,
      nunca da ordem declarada. Coluna obrigatória ausente responde
      instalacao_incompleta — ler a coluna vizinha seria pior que não ler.
      Colunas que o esquema não conhece são preservadas (_extras) e
      regravadas como estavam.

   2. UM TIPO, UMA CONVERSÃO. Texto, data de calendário, instante, inteiro,
      dinheiro, booleano e JSON têm uma função de ida e uma de volta, aqui.
      Ausente (null) ≠ vazio ("") ≠ zero ≠ falso.

   3. TUDO É GRAVADO COMO TEXTO ('@'). Sem isso o Sheets converte "01/05/2026"
      em data e "007" em 7 — foi o que aconteceu com a Auditoria da 3.5.0.

   4. SÓ AS LINHAS AFETADAS. Nada de limpar a aba e reescrever: inserir
      acrescenta, atualizar regrava as linhas daquele registro, remover
      apaga as linhas dele (de baixo para cima).
   ===================================================================== */

var _TAB = {};
var _PLANILHA = null;
var _FUSO_PLANILHA = null;
var CABECALHO_CACHE_SEGUNDOS = 1800;

function esquecerTabelas() {
  _TAB = {};
  _PLANILHA = null;
  _FUSO_PLANILHA = null;
}

/* Dentro da trava toda leitura precisa ser fresca: outra execução pode
   ter mexido entre a leitura de fora e a obtenção da trava. O cabeçalho
   continua valendo; as linhas, não. */
function esquecerLinhas() {
  Object.keys(_TAB).forEach(function (n) { _TAB[n].linhas = null; _TAB[n].indice = null; _TAB[n].ultima = null; });
}

function planilha() {
  if (_PLANILHA) return _PLANILHA;
  var id = propriedade("FLORESER_PLANILHA_ID", "");
  _PLANILHA = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  anotar("sheets");
  return _PLANILHA;
}

function fusoDaPlanilha() {
  if (_FUSO_PLANILHA === null) {
    try { _FUSO_PLANILHA = planilha().getSpreadsheetTimeZone() || fusoDaClinica(); }
    catch (e) { _FUSO_PLANILHA = fusoDaClinica(); }
  }
  return _FUSO_PLANILHA;
}

/* ---------------------------------------------------------------------
   Tipos
   --------------------------------------------------------------------- */

var RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(v) {
  if (typeof v !== "string" || !RE_DATA.test(v)) return false;
  var p = v.split("-").map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

/* Dinheiro: centavos inteiros na lógica; na planilha, texto decimal com
   duas casas ("350.00"), legível para quem abre a aba. A conversão é por
   texto, nunca por ponto flutuante: "0.29" vira 29, não 28.999… */
function textoParaCentavos(bruto) {
  if (bruto === null || bruto === undefined || bruto === "") return null;
  if (typeof bruto === "number") return isFinite(bruto) ? Math.round(bruto * 100) : null;
  var t = String(bruto).trim().replace(/^R\$\s*/, "");
  /* "1.234,56" (pt-BR) e "1234.56" (planilha) */
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  var m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  var centavos = Number(m[2]) * 100 + Number(((m[3] || "") + "00").slice(0, 2));
  return m[1] === "-" ? -centavos : centavos;
}

function centavosParaTexto(c) {
  if (c === null || c === undefined || c === "") return "";
  var n = Math.round(Number(c));
  if (!isFinite(n)) return "";
  var neg = n < 0;
  n = Math.abs(n);
  var reais = Math.floor(n / 100), cent = n % 100;
  return (neg ? "-" : "") + reais + "." + (cent < 10 ? "0" : "") + cent;
}

function lerValor(tipo, bruto) {
  var vazio = bruto === null || bruto === undefined || bruto === "";
  switch (tipo) {
    case "texto":
      if (vazio) return "";
      if (bruto instanceof Date) return Utilities.formatDate(bruto, fusoDaPlanilha(), "yyyy-MM-dd'T'HH:mm:ss");
      return String(bruto);
    case "data":
      if (vazio) return null;
      if (bruto instanceof Date) return Utilities.formatDate(bruto, fusoDaPlanilha(), "yyyy-MM-dd");
      var s = String(bruto).trim();
      return dataValida(s) ? s : null;
    case "instante":
      if (vazio) return null;
      if (bruto instanceof Date) return bruto.toISOString();
      if (typeof bruto === "number") return new Date(bruto).toISOString();
      var t = String(bruto).trim();
      if (/^\d{12,14}$/.test(t)) return new Date(Number(t)).toISOString();
      var d = new Date(t);
      return isNaN(d.getTime()) ? null : d.toISOString();
    case "inteiro":
    case "epoch":
      if (vazio) return null;
      if (typeof bruto === "number") return Math.trunc(bruto);
      var n = String(bruto).trim();
      return /^-?\d+$/.test(n) ? Number(n) : null;
    case "dinheiro":
      return vazio ? null : textoParaCentavos(bruto);
    case "booleano":
      if (vazio) return null;
      if (bruto === true || bruto === false) return bruto;
      var b = String(bruto).trim().toLowerCase();
      if (b === "sim" || b === "true" || b === "1" || b === "x") return true;
      if (b === "não" || b === "nao" || b === "false" || b === "0") return false;
      return null;
    case "json":
      if (vazio) return null;
      try { return JSON.parse(String(bruto)); } catch (e) { return null; }
  }
  return vazio ? "" : String(bruto);
}

function escreverValor(tipo, valor, campo) {
  if (valor === null || valor === undefined) return "";
  switch (tipo) {
    case "texto": return String(valor);
    case "data": return dataValida(String(valor)) ? String(valor) : "";
    case "instante":
      var d = valor instanceof Date ? valor : new Date(valor);
      return isNaN(d.getTime()) ? "" : d.toISOString();
    case "inteiro":
    case "epoch":
      var n = Number(valor);
      return isFinite(n) ? String(Math.trunc(n)) : "";
    case "dinheiro": return centavosParaTexto(valor);
    case "booleano": return valor === true ? "sim" : valor === false ? "não" : "";
    case "json":
      var j = JSON.stringify(valor);
      if (j.length > MAX_CELULA) falhar("dados_invalidos", "O campo " + campo + " passou do tamanho de uma célula.", { campo: campo });
      return j;
  }
  return String(valor);
}

/* ---------------------------------------------------------------------
   Tabela: cabeçalho e linhas
   --------------------------------------------------------------------- */

function tabela(nome) {
  if (_TAB[nome]) return _TAB[nome];
  var def = definicaoTabela(nome);
  var sheet = planilha().getSheetByName(def.aba);
  anotar("sheets");
  if (!sheet) falhar("instalacao_incompleta", "Falta a aba " + def.aba + ".", { aba: def.aba });

  var nomes = cabecalhoGuardado(def);
  if (!nomes) {
    var largura = sheet.getLastColumn();
    anotar("sheets");
    nomes = largura ? sheet.getRange(1, 1, 1, largura).getValues()[0].map(function (v) { return String(v).trim(); }) : [];
    anotar("sheets"); anotar("leituras");
    guardarCabecalho(def, nomes);
  }

  var cab = {};
  nomes.forEach(function (n, i) { if (n && cab[n] === undefined) cab[n] = i; });
  var faltam = def.campos.filter(function (c) { return cab[c.n] === undefined; }).map(function (c) { return c.n; });
  if (faltam.length) {
    falhar("instalacao_incompleta", "A aba " + def.aba + " está sem as colunas: " + faltam.join(", ") + ".",
      { aba: def.aba, faltam: faltam });
  }
  var tipos = {};
  def.campos.forEach(function (c) { tipos[c.n] = c.t; });

  _TAB[nome] = { nome: nome, def: def, sheet: sheet, nomes: nomes, cab: cab, tipos: tipos,
    largura: nomes.length, linhas: null, indice: null, ultima: null };
  return _TAB[nome];
}

function chaveDoCabecalho(def) {
  return "cab." + epoca() + "." + VERSAO_SCHEMA + "." + def.aba;
}

function cabecalhoGuardado(def) {
  try {
    var v = CacheService.getScriptCache().get(chaveDoCabecalho(def));
    if (v) { anotar("cache"); return JSON.parse(v); }
  } catch (e) { }
  return null;
}

function guardarCabecalho(def, nomes) {
  try { CacheService.getScriptCache().put(chaveDoCabecalho(def), JSON.stringify(nomes), CABECALHO_CACHE_SEGUNDOS); }
  catch (e) { }
}

function ultimaLinha(t) {
  if (t.ultima === null) {
    t.ultima = t.sheet.getLastRow();
    anotar("sheets");
  }
  return t.ultima;
}

function montarRegistro(t, linha, numero) {
  var r = { _linha: numero };
  t.def.campos.forEach(function (c) { r[c.n] = lerValor(c.t, linha[t.cab[c.n]]); });
  var extras = null;
  t.nomes.forEach(function (n, i) {
    if (t.tipos[n] !== undefined) return;
    var v = linha[i];
    if (v === "" || v === null || v === undefined) return;
    extras = extras || {};
    extras[n || ("#" + (i + 1))] = v instanceof Date ? v.toISOString() : String(v);
  });
  if (extras) r._extras = extras;
  return r;
}

function linhaVazia(linha) {
  for (var i = 0; i < linha.length; i++) {
    if (linha[i] !== "" && linha[i] !== null && linha[i] !== undefined) return false;
  }
  return true;
}

/* Todas as linhas. As abas deste sistema têm centenas de linhas, não
   centenas de milhares: ler tudo de uma vez (uma chamada) é mais barato
   que procurar linha a linha. A aba de auditoria e a de operações, que só
   crescem, têm leituras próprias (lerUltimas, linhasCom). */
function lerTudo(nome) {
  var t = tabela(nome);
  if (t.linhas) return t.linhas;
  var ultima = ultimaLinha(t);
  var lista = [];
  if (ultima >= 2 && t.largura) {
    var valores = t.sheet.getRange(2, 1, ultima - 1, t.largura).getValues();
    anotar("sheets"); anotar("leituras"); anotar("celulas", valores.length * t.largura);
    for (var i = 0; i < valores.length; i++) {
      if (linhaVazia(valores[i])) continue;
      lista.push(montarRegistro(t, valores[i], i + 2));
    }
  }
  t.linhas = lista;
  t.indice = null;
  return lista;
}

function chaveDe(def, r) {
  return def.chave.map(function (k) { return String(r[k] === null || r[k] === undefined ? "" : r[k]); }).join("\u0001");
}

function indice(nome) {
  var t = tabela(nome);
  if (t.indice) return t.indice;
  var mapa = {};
  lerTudo(nome).forEach(function (r) { mapa[chaveDe(t.def, r)] = r; });
  t.indice = mapa;
  return mapa;
}

/* acharPorChave("crm_leads", "abc") ou acharPorChave("agenda_ciclos", ["p1", "facial"]) */
function acharPorChave(nome, chave) {
  var partes = Array.isArray(chave) ? chave : [chave];
  return indice(nome)[partes.map(String).join("\u0001")] || null;
}

function filtrar(nome, campo, valor) {
  var alvo = String(valor);
  return lerTudo(nome).filter(function (r) { return String(r[campo]) === alvo; });
}

/* As últimas n linhas, de baixo para cima — para abas que só crescem. */
function lerUltimas(nome, n) {
  var t = tabela(nome);
  var ultima = ultimaLinha(t);
  if (ultima < 2) return [];
  var comeco = Math.max(2, ultima - n + 1);
  var valores = t.sheet.getRange(comeco, 1, ultima - comeco + 1, t.largura).getValues();
  anotar("sheets"); anotar("leituras"); anotar("celulas", valores.length * t.largura);
  var lista = [];
  for (var i = valores.length - 1; i >= 0; i--) {
    if (!linhaVazia(valores[i])) lista.push(montarRegistro(t, valores[i], comeco + i));
  }
  return lista;
}

/* Linhas cujo campo vale exatamente "valor", procuradas pelo próprio
   Sheets (TextFinder na coluna): nada da aba atravessa a ponte além das
   linhas achadas. */
function linhasCom(nome, campo, valor) {
  var t = tabela(nome);
  var ultima = ultimaLinha(t);
  if (ultima < 2 || !String(valor)) return [];
  var achados = t.sheet.getRange(2, t.cab[campo] + 1, ultima - 1, 1)
    .createTextFinder(String(valor)).matchEntireCell(true).matchCase(true).findAll();
  anotar("sheets");
  var numeros = achados.map(function (r) { return r.getRow(); }).sort(function (a, b) { return a - b; });
  return lerLinhasNumeradas(t, numeros);
}

function lerLinhasNumeradas(t, numeros) {
  var lista = [];
  var i = 0;
  while (i < numeros.length) {
    var j = i;
    while (j + 1 < numeros.length && numeros[j + 1] === numeros[j] + 1) j++;
    var valores = t.sheet.getRange(numeros[i], 1, numeros[j] - numeros[i] + 1, t.largura).getValues();
    anotar("sheets"); anotar("leituras"); anotar("celulas", valores.length * t.largura);
    for (var k = 0; k < valores.length; k++) {
      if (!linhaVazia(valores[k])) lista.push(montarRegistro(t, valores[k], numeros[i] + k));
    }
    i = j + 1;
  }
  return lista;
}

/* Uma coluna só, para descobrir quais registros interessam sem arrastar
   as colunas pesadas. */
function lerColuna(nome, campo) {
  var t = tabela(nome);
  var ultima = ultimaLinha(t);
  if (ultima < 2) return [];
  var valores = t.sheet.getRange(2, t.cab[campo] + 1, ultima - 1, 1).getValues();
  anotar("sheets"); anotar("leituras"); anotar("celulas", valores.length);
  return valores.map(function (v, i) { return { linha: i + 2, valor: lerValor(t.tipos[campo], v[0]) }; });
}

/* ---------------------------------------------------------------------
   Escrita
   --------------------------------------------------------------------- */

function linhaParaGravar(t, r) {
  var saida = new Array(t.largura);
  for (var i = 0; i < t.largura; i++) {
    var n = t.nomes[i];
    if (t.tipos[n] !== undefined) saida[i] = escreverValor(t.tipos[n], r[n], n);
    else saida[i] = (r._extras && r._extras[n || ("#" + (i + 1))]) || "";
  }
  return saida;
}

function gravarFaixa(t, primeira, linhas) {
  var faixa = t.sheet.getRange(primeira, 1, linhas.length, t.largura);
  faixa.setNumberFormat("@");
  faixa.setValues(linhas);
  anotar("sheets", 2); anotar("escritas"); anotar("celulas", linhas.length * t.largura);
  if (typeof falhaSimulada === "function") falhaSimulada("gravar:" + t.nome);
}

function inserir(nome, registros) {
  if (!registros.length) return;
  var t = tabela(nome);
  var primeira = ultimaLinha(t) + 1;
  gravarFaixa(t, primeira, registros.map(function (r) { return linhaParaGravar(t, r); }));
  t.ultima = primeira + registros.length - 1;
  registros.forEach(function (r, i) {
    r._linha = primeira + i;
    if (t.linhas) t.linhas.push(r);
    if (t.indice) t.indice[chaveDe(t.def, r)] = r;
  });
}

/* Regrava registros que vieram de lerTudo/linhasCom (têm _linha). Linhas
   seguidas viram uma chamada só. */
function atualizar(nome, registros) {
  if (!registros.length) return;
  var t = tabela(nome);
  var ordenados = registros.slice().sort(function (a, b) { return a._linha - b._linha; });
  ordenados.forEach(function (r) {
    if (!r._linha) throw new Error("atualizar sem _linha em " + nome);
    if (r._parcial) throw new Error("registro parcial não pode ser regravado em " + nome);
  });
  var i = 0;
  while (i < ordenados.length) {
    var j = i;
    while (j + 1 < ordenados.length && ordenados[j + 1]._linha === ordenados[j]._linha + 1) j++;
    gravarFaixa(t, ordenados[i]._linha, ordenados.slice(i, j + 1).map(function (r) { return linhaParaGravar(t, r); }));
    i = j + 1;
  }
}

/* Apaga as linhas, de baixo para cima, em faixas seguidas. Apagar desloca
   o que está embaixo: os números de linha guardados nesta execução deixam
   de valer, e a próxima leitura desta aba é refeita. */
function remover(nome, registros) {
  if (!registros.length) return;
  var t = tabela(nome);
  var linhas = registros.map(function (r) { return r._linha; }).filter(Boolean)
    .sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < linhas.length) {
    var j = i;
    while (j + 1 < linhas.length && linhas[j + 1] === linhas[j] - 1) j++;
    t.sheet.deleteRows(linhas[j], linhas[i] - linhas[j] + 1);
    anotar("sheets"); anotar("escritas");
    i = j + 1;
  }
  t.linhas = null; t.indice = null; t.ultima = null;
}

/* Grava por chave: atualiza se existe, insere se não. É a primitiva do
   diário de operações — repetir dá o mesmo resultado. */
function gravarPorChave(nome, registro) {
  var t = tabela(nome);
  var atual = acharPorChave(nome, t.def.chave.map(function (k) { return registro[k]; }));
  if (atual) {
    var copia = {};
    Object.keys(registro).forEach(function (k) { copia[k] = registro[k]; });
    copia._linha = atual._linha;
    if (atual._extras && !copia._extras) copia._extras = atual._extras;
    atualizar(nome, [copia]);
    t.def.campos.forEach(function (c) { if (copia[c.n] !== undefined) atual[c.n] = copia[c.n]; });
  } else {
    inserir(nome, [registro]);
  }
}

function removerPorChave(nome, chave) {
  var atual = acharPorChave(nome, chave);
  if (atual) remover(nome, [atual]);
}

/* ---------------------------------------------------------------------
   Criação das abas (setup e migração)
   --------------------------------------------------------------------- */

/* Cria a aba com o cabeçalho do esquema; numa aba que já existe, só
   acrescenta as colunas que faltam, NO FIM — nunca move dado de lugar. */
function garantirAbaDoEsquema(nome) {
  var def = definicaoTabela(nome);
  var ss = planilha();
  var sheet = ss.getSheetByName(def.aba);
  var nomes = def.campos.map(function (c) { return c.n; });
  if (!sheet) {
    sheet = ss.insertSheet(def.aba);
    var cab = sheet.getRange(1, 1, 1, nomes.length);
    cab.setValues([nomes]);
    cab.setFontWeight("bold").setBackground("#3B6E6A").setFontColor("#F5F0EB");
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, Math.max(2, sheet.getMaxRows()), nomes.length).setNumberFormat("@");
  } else {
    var largura = sheet.getLastColumn();
    var atuais = largura ? sheet.getRange(1, 1, 1, largura).getValues()[0].map(function (v) { return String(v).trim(); }) : [];
    var faltam = nomes.filter(function (n) { return atuais.indexOf(n) < 0; });
    if (faltam.length) {
      var nova = sheet.getRange(1, largura + 1, 1, faltam.length);
      nova.setValues([faltam]);
      nova.setFontWeight("bold").setBackground("#3B6E6A").setFontColor("#F5F0EB");
    }
  }
  try { CacheService.getScriptCache().remove(chaveDoCabecalho(def)); } catch (e) { }
  delete _TAB[nome];
  return sheet;
}

/* ---------------------------------------------------------------------
   Datas e instantes da clínica
   --------------------------------------------------------------------- */

function agoraISO() {
  return new Date().toISOString();
}

/* O dia de hoje NA CLÍNICA, não no servidor do Google. */
function hojeNaClinica() {
  return Utilities.formatDate(new Date(), fusoDaClinica(), "yyyy-MM-dd");
}

/* "2026-08-31T08:29:29", sem fuso, como a 3.5.0 gravava: é hora local da
   clínica. Devolve o instante correto em UTC. */
function instanteDeHoraLocal(texto) {
  var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(texto || "").trim());
  if (!m) return null;
  var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  /* descobre o deslocamento do fuso naquele instante (sem supor -04:00) */
  var palpite = new Date(utc);
  var local = Utilities.formatDate(palpite, fusoDaClinica(), "yyyy-MM-dd'T'HH:mm:ss");
  var l = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(local);
  var comoUtc = Date.UTC(+l[1], +l[2] - 1, +l[3], +l[4], +l[5], +l[6]);
  return new Date(utc + (utc - comoUtc)).toISOString();
}
