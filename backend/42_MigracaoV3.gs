/* =====================================================================
   42_MigracaoV3 — do schema 2 (4.0.0) para o schema 3 (4.1.0)
   ---------------------------------------------------------------------
   Incremental: NADA do schema 2 é reescrito. Acrescenta as abas novas do
   Financeiro, das importações e das integrações, e três colunas no fim de
   abas que já existem (ent_entradas.origem, ent_entradas.loteId,
   sis_usuarios.financeiro). Sessões, contas e dados continuam onde estão:
   quem estava conectado continua conectado.

   Rodadas À MÃO, no editor, nesta ordem (docs/PUBLICACAO.md):
     migracaoV3Diagnosticar()  lê, valida relações, soma o dinheiro e diz
                               o que vai criar. NÃO escreve nada.
     migracaoV3Backup()        cópia privada da planilha (como na 4.0.0)
     migracaoV3Ensaiar()       o mesmo que executar, sem exigir manutenção
                               — para uma CÓPIA da planilha
     migracaoV3Executar()      cria abas e colunas e confere (exige
                               manutenção e backup)
     migracaoV3Ativar()        liga o schema 3 (só com a conferência OK)
     migracaoV3Retornar()      volta a dizer "schema 2" (reimplante a 4.0.0)

   A migração da 3.5.0 (40_Migracoes) NÃO roda de novo: ela se recusa com
   o schema 2 ativo, e esta aqui exige o schema 2 ativo.
   ===================================================================== */

var MIGRACAO_V3 = "v2-para-v3";

function registrarEtapaV3(etapa, estado, relatorio) {
  var id = MIGRACAO_V3 + ":" + etapa;
  var atual = acharPorChave("sis_migracoes", id);
  gravarPorChave("sis_migracoes", { id: id, versao: 3, etapa: etapa, estado: estado,
    iniciadoEm: atual && atual.iniciadoEm ? atual.iniciadoEm : agoraISO(), concluidoEm: estado === "concluida" ? agoraISO() : null,
    relatorio: relatorio || null });
}

function tabelasDoSchema(versao) {
  return nomesDasTabelas().filter(function (n) { return definicaoTabela(n).desde <= versao; });
}

/* Retrato do schema 2: contagem e assinatura de cada aba, e as somas de
   dinheiro. A execução compara o mesmo retrato depois. */
function retratoV2() {
  var T = {}, abas = {};
  tabelasDoSchema(2).forEach(function (n) {
    delete _TAB[n];
    try { CacheService.getScriptCache().remove(chaveDoCabecalho(definicaoTabela(n))); } catch (e) { }
    T[n] = lerTudo(n);
    abas[n] = { linhas: T[n].length, assinatura: assinaturaDasLinhas(n, T[n].map(function (r) {
      var c = {}; definicaoTabela(n).campos.forEach(function (f) { if (!(COLUNAS_DESDE[n] && COLUNAS_DESDE[n][f.n])) c[f.n] = r[f.n]; }); return c;
    })) };
  });
  var pagamentos = T.ent_pagamentos.reduce(function (t, p) { return t + (Number(p.valor) || 0); }, 0);
  return { T: T, abas: abas, dinheiro: { ent_pagamentos: pagamentos, quantidade: T.ent_pagamentos.length },
    sessoesVivas: T.sis_sessoes.filter(function (s) { return !s.revogadoEm && Number(s.expiraEm) > Date.now(); }).length };
}

function planoV3() {
  var ss = planilha();
  var abasNovas = tabelasDoSchema(3).filter(function (n) { return definicaoTabela(n).desde === 3 && !ss.getSheetByName(definicaoTabela(n).aba); });
  var colunas = [];
  Object.keys(COLUNAS_DESDE).forEach(function (n) {
    var sheet = ss.getSheetByName(definicaoTabela(n).aba);
    if (!sheet) return;
    var larg = sheet.getLastColumn();
    var nomes = larg ? sheet.getRange(1, 1, 1, larg).getValues()[0].map(function (v) { return String(v).trim(); }) : [];
    Object.keys(COLUNAS_DESDE[n]).forEach(function (col) { if (nomes.indexOf(col) < 0) colunas.push(n + "." + col); });
  });
  return { abasNovas: abasNovas, colunas: colunas };
}

function migracaoV3Diagnosticar() {
  reiniciarExecucao();
  var rel = novoRelatorio();
  var ativo = schemaAtivo();
  if (ativo !== 2) rel.erros.push("O schema ativo é " + ativo + "; esta migração parte do schema 2." + (ativo < 2 ? " Faça antes a migração da 4.0.0." : " Ela já foi feita."));
  var r = null;
  try { r = retratoV2(); } catch (e) { rel.erros.push("Leitura do schema 2 falhou: " + (e.mensagem || e.message || e)); }
  if (r) validarV2(r.T, rel);
  var plano = planoV3();
  var relatorio = { erros: rel.erros, avisos: rel.avisos, plano: plano,
    abas: r ? r.abas : null, dinheiro: r ? r.dinheiro : null, sessoesVivas: r ? r.sessoesVivas : null };
  var linhas = ["MIGRAÇÃO v2 → v3 — " + (rel.erros.length ? "BLOQUEADA" : "pronta")];
  linhas.push("Erros (" + rel.erros.length + "):");
  rel.erros.forEach(function (e) { linhas.push("  · " + e); });
  linhas.push("Avisos (" + rel.avisos.length + "):");
  rel.avisos.slice(0, 30).forEach(function (e) { linhas.push("  · " + e); });
  linhas.push("Abas a criar: " + (plano.abasNovas.join(", ") || "nenhuma"));
  linhas.push("Colunas a acrescentar (no fim): " + (plano.colunas.join(", ") || "nenhuma"));
  if (r) {
    linhas.push("Pagamentos das Entradas: " + r.dinheiro.quantidade + " linhas, " + centavosParaTexto(r.dinheiro.ent_pagamentos) + " (conferido de novo depois)");
    linhas.push("Sessões vivas (continuam valendo): " + r.sessoesVivas);
  }
  Logger.log(linhas.join("\n"));
  return relatorio;
}

function migracaoV3Backup() {
  return migracaoBackup("4.1.0", "FLORESER_BACKUP_V3_ID");
}

function migracaoV3Ensaiar() { return executarMigracaoV3({ ensaio: true }); }
function migracaoV3Executar() { return executarMigracaoV3({ ensaio: false }); }

function executarMigracaoV3(opcoes) {
  reiniciarExecucao();
  if (schemaAtivo() !== 2) throw new Error("O schema ativo é " + schemaAtivo() + ": esta migração parte do schema 2.");
  if (!opcoes.ensaio && !emManutencao()) throw new Error("Ligue a manutenção antes (ligarManutencao()).");
  if (!opcoes.ensaio && !propriedade("FLORESER_BACKUP_V3_ID", "")) throw new Error("Rode migracaoV3Backup() antes.");
  var antes = retratoV2();
  var rel = novoRelatorio();
  validarV2(antes.T, rel);
  if (rel.erros.length) {
    registrarEtapaV3("execucao", "bloqueada", { erros: rel.erros });
    throw new Error("Migração bloqueada: " + rel.erros.join(" | "));
  }
  registrarEtapaV3("execucao", "em_andamento", { antes: antes.abas, dinheiro: antes.dinheiro });
  var plano = planoV3();
  /* abas novas e colunas novas — garantirAbaDoEsquema só ACRESCENTA */
  tabelasDoSchema(3).forEach(function (n) {
    if (definicaoTabela(n).desde === 3 || COLUNAS_DESDE[n]) garantirAbaDoEsquema(n);
  });
  avancarEpoca();
  esquecerTabelas();

  /* conferência: o schema 2 continua idêntico, o dinheiro também */
  var depois = retratoV2();
  var diferencas = [];
  Object.keys(antes.abas).forEach(function (n) {
    /* o registro da própria migração e os logs mudam durante ela */
    if (["sis_migracoes", "sis_logs", "sis_visitas"].indexOf(n) >= 0) return;
    var a = antes.abas[n], b = depois.abas[n];
    if (!b || a.linhas !== b.linhas || a.assinatura !== b.assinatura) diferencas.push(n);
  });
  if (antes.dinheiro.ent_pagamentos !== depois.dinheiro.ent_pagamentos || antes.dinheiro.quantidade !== depois.dinheiro.quantidade) diferencas.push("soma dos pagamentos");
  var faltam = [];
  tabelasDoSchema(3).forEach(function (n) {
    try {
      delete _TAB[n];
      var t = tabela(n);
      var nomes = t.nomes;
      definicaoTabela(n).campos.forEach(function (c) { if (nomes.indexOf(c.n) < 0) faltam.push(n + "." + c.n); });
    } catch (e) { faltam.push(n + " (" + (e.mensagem || e.message) + ")"); }
  });
  var ok = !diferencas.length && !faltam.length;
  var relatorio = { ok: ok, criadas: plano.abasNovas, colunas: plano.colunas, diferencas: diferencas, faltam: faltam,
    dinheiro: depois.dinheiro, ensaio: !!opcoes.ensaio };
  registrarEtapaV3("execucao", ok ? "concluida" : "falhou", relatorio);
  Logger.log("MIGRAÇÃO v2 → v3 " + (opcoes.ensaio ? "(ENSAIO) " : "") + "— CONFERÊNCIA: " + (ok ? "OK" : "FALHOU") +
    "\nAbas criadas: " + (plano.abasNovas.join(", ") || "nenhuma") + "\nColunas: " + (plano.colunas.join(", ") || "nenhuma") +
    (diferencas.length ? "\nDiferenças no schema 2: " + diferencas.join(", ") : "") + (faltam.length ? "\nFaltando: " + faltam.join(", ") : ""));
  return relatorio;
}

function migracaoV3Ativar() {
  reiniciarExecucao();
  var etapa = acharPorChave("sis_migracoes", MIGRACAO_V3 + ":execucao");
  if (!etapa || etapa.estado !== "concluida") throw new Error("A conferência não passou: rode migracaoV3Executar().");
  if (schemaAtivo() !== 2) throw new Error("O schema ativo é " + schemaAtivo() + ".");
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "3");
  registrarEtapaV3("ativacao", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 3 ativo. Desligue a manutenção (desligarManutencao()) e publique o site 4.1.0.");
  return { ativo: 3 };
}

/* Voltar para a 4.0.0: as abas novas e as colunas novas ficam onde estão
   (a 4.0.0 preserva colunas que não conhece). Nada é apagado. */
function migracaoV3Retornar() {
  reiniciarExecucao();
  if (schemaAtivo() !== 3) throw new Error("O schema 3 não está ativo.");
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "2");
  registrarEtapaV3("retorno", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 2 de novo. Reimplante a versão 4.0.0 do script e publique o site 4.0.0. O que foi gravado no Financeiro e nas integrações fica nas abas novas.");
  return { ativo: 2 };
}
