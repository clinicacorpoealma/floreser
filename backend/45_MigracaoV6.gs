/* =====================================================================
   45_MigracaoV6 — do schema 5 (4.3.0) para o schema 6 (4.4.0)
   ---------------------------------------------------------------------
   Incremental: nada é apagado nem reescrito além do necessário.
     · cria exe_conferencias, exe_trocas, exe_creditos, exe_atendimentos;
     · acrescenta no fim: exe_orcamento_itens.classe e
       exe_execucoes.natureza/trocaId/valorReferencia/baseReferencia/baseCusto;
     · itens dos orçamentos do Alveare ganham classe "tratamento" (era o
       único uso possível na 4.3.0);
     · cada execução ganha a natureza que já tinha na prática: ligada a um
       item → "conforme o plano"; sem item → "a decidir" (vazio). Nenhuma
       vira bônus, avulso ou substituição sozinha.
   Confere contagem de linhas, somas de dinheiro e, por orçamento, o
   realizado antes e depois.

   migracaoV6Diagnosticar() → migracaoV6Backup() → migracaoV6Executar()
   → migracaoV6Ativar();  retorno: migracaoV6Retornar().
   ===================================================================== */

var MIGRACAO_V6 = "v5-para-v6";

function registrarEtapaV6(etapa, estado, relatorio) {
  var id = MIGRACAO_V6 + ":" + etapa;
  var atual = acharPorChave("sis_migracoes", id);
  gravarPorChave("sis_migracoes", { id: id, versao: 6, etapa: etapa, estado: estado,
    iniciadoEm: atual && atual.iniciadoEm ? atual.iniciadoEm : agoraISO(), concluidoEm: estado === "concluida" ? agoraISO() : null,
    relatorio: relatorio || null });
}

function retratoV5() {
  var T = {}, abas = {};
  tabelasDoSchema(5).forEach(function (n) {
    delete _TAB[n];
    try { CacheService.getScriptCache().remove(chaveDoCabecalho(definicaoTabela(n))); } catch (e) { }
    T[n] = lerTudo(n);
    abas[n] = T[n].length;
  });
  var soma = function (lista, campo) { return lista.reduce(function (t, x) { return t + (Number(x[campo]) || 0); }, 0); };
  /* realizado por item, como a 4.3.0 contava */
  var realizado = {};
  T.exe_execucoes.forEach(function (e) {
    if (e.estado !== "realizado" || !e.itemRef) return;
    realizado[e.itemRef] = (realizado[e.itemRef] || 0) + (qtdMil(e.quantidade) || 0);
  });
  return { T: T, abas: abas, realizado: realizado, dinheiro: { ent_pagamentos: soma(T.ent_pagamentos, "valor"), fin_despesas: soma(T.fin_despesas, "valor"),
    fin_movimentos: soma(T.fin_movimentos, "valor") } };
}

function migracaoV6Diagnosticar() {
  reiniciarExecucao();
  var rel = novoRelatorio();
  if (schemaAtivo() !== 5) rel.erros.push("O schema ativo é " + schemaAtivo() + "; esta migração parte do schema 5 (4.3.0).");
  var r = null;
  try { r = retratoV5(); validarV2(r.T, rel); } catch (e) { rel.erros.push("Leitura do schema 5 falhou: " + (e.mensagem || e.message || e)); }
  var linhas = ["MIGRAÇÃO v5 → v6 — " + (rel.erros.length ? "BLOQUEADA" : "pronta")];
  rel.erros.forEach(function (e) { linhas.push("  erro · " + e); });
  rel.avisos.slice(0, 20).forEach(function (e) { linhas.push("  aviso · " + e); });
  if (r) {
    var comItem = r.T.exe_execucoes.filter(function (e) { return e.itemRef; }).length;
    linhas.push("Execuções: " + r.T.exe_execucoes.length + " — " + comItem + " ligadas a um item ficam \"conforme o plano\"; as outras ficam \"a decidir\".");
    linhas.push("Orçamentos do Alveare: " + r.T.exe_orcamentos.length + " — os itens passam a ser classificados como tratamento.");
  }
  Logger.log(linhas.join("\n"));
  return { erros: rel.erros, avisos: rel.avisos };
}

function migracaoV6Backup() { return migracaoBackup("4.4.0", "FLORESER_BACKUP_V6_ID"); }
function migracaoV6Ensaiar() { return executarMigracaoV6({ ensaio: true }); }
function migracaoV6Executar() { return executarMigracaoV6({ ensaio: false }); }

function executarMigracaoV6(opcoes) {
  reiniciarExecucao();
  if (schemaAtivo() !== 5) throw new Error("O schema ativo é " + schemaAtivo() + ": esta migração parte do schema 5.");
  if (!opcoes.ensaio && !emManutencao()) throw new Error("Ligue a manutenção antes (ligarManutencao()).");
  if (!opcoes.ensaio && !propriedade("FLORESER_BACKUP_V6_ID", "")) throw new Error("Rode migracaoV6Backup() antes.");
  var antes = retratoV5();
  var rel = novoRelatorio();
  validarV2(antes.T, rel);
  if (rel.erros.length) { registrarEtapaV6("execucao", "bloqueada", { erros: rel.erros }); throw new Error("Migração bloqueada: " + rel.erros.join(" | ")); }
  registrarEtapaV6("execucao", "em_andamento", { abas: antes.abas, dinheiro: antes.dinheiro });
  tabelasDoSchema(6).forEach(function (n) { if (definicaoTabela(n).desde === 6 || COLUNAS_DESDE[n]) garantirAbaDoEsquema(n); });
  avancarEpoca();
  esquecerTabelas();

  var itens = lerTudo("exe_orcamento_itens").filter(function (i) { return !i.classe; }).map(function (i) { var c = copiaLimpa(i); c._linha = i._linha; c.classe = "tratamento"; return c; });
  if (itens.length) atualizar("exe_orcamento_itens", itens);
  var exes = lerTudo("exe_execucoes").filter(function (e) { return !e.natureza; }).map(function (e) {
    var c = copiaLimpa(e); c._linha = e._linha;
    c.natureza = e.itemRef ? "contratado" : "";
    c.trocaId = ""; c.baseCusto = e.custoFonte ? (e.custoFonte === "estimativa" ? "ficha (estimativa, gravada na 4.3.0)" : e.custoFonte) : "";
    return c;
  });
  if (exes.length) atualizar("exe_execucoes", exes);
  esquecerTabelas();

  var depois = retratoV5();
  var diferencas = [];
  Object.keys(antes.abas).forEach(function (n) {
    if (["sis_migracoes", "sis_logs", "sis_visitas"].indexOf(n) >= 0) return;
    if (antes.abas[n] !== depois.abas[n]) diferencas.push(n + " (" + antes.abas[n] + " → " + depois.abas[n] + ")");
  });
  Object.keys(antes.dinheiro).forEach(function (k) { if (antes.dinheiro[k] !== depois.dinheiro[k]) diferencas.push("soma de " + k); });
  Object.keys(antes.realizado).forEach(function (k) { if (antes.realizado[k] !== depois.realizado[k]) diferencas.push("realizado do item " + k); });
  var faltam = [];
  tabelasDoSchema(6).forEach(function (n) {
    try { delete _TAB[n]; var t = tabela(n); definicaoTabela(n).campos.forEach(function (c) { if (t.nomes.indexOf(c.n) < 0) faltam.push(n + "." + c.n); }); }
    catch (e) { faltam.push(n + " (" + (e.mensagem || e.message) + ")"); }
  });
  var ok = !diferencas.length && !faltam.length;
  var relatorio = { ok: ok, diferencas: diferencas, faltam: faltam, ensaio: !!opcoes.ensaio, itens: itens.length, execucoes: exes.length };
  registrarEtapaV6("execucao", ok ? "concluida" : "falhou", relatorio);
  Logger.log("MIGRAÇÃO v5 → v6 " + (opcoes.ensaio ? "(ENSAIO) " : "") + "— CONFERÊNCIA: " + (ok ? "OK" : "FALHOU") +
    (diferencas.length ? "\nDiferenças: " + diferencas.join(", ") : "") + (faltam.length ? "\nFaltando: " + faltam.join(", ") : ""));
  return relatorio;
}

function migracaoV6Ativar() {
  reiniciarExecucao();
  var etapa = acharPorChave("sis_migracoes", MIGRACAO_V6 + ":execucao");
  if (!etapa || etapa.estado !== "concluida") throw new Error("A conferência não passou: rode migracaoV6Executar().");
  if (schemaAtivo() !== 5) throw new Error("O schema ativo é " + schemaAtivo() + ".");
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "6");
  registrarEtapaV6("ativacao", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 6 ativo. Desligue a manutenção e publique o site 4.4.0.");
  return { ativo: 6 };
}

/* Volta para a 4.3.0: abas e colunas novas ficam (a 4.3.0 as ignora).
   Trocas, créditos e conferências ficam guardados para quando voltar. */
function migracaoV6Retornar() {
  reiniciarExecucao();
  if (schemaAtivo() !== 6) throw new Error("O schema 6 não está ativo.");
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "5");
  registrarEtapaV6("retorno", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 5 de novo. Reimplante a 4.3.0 e o site 4.3.0. Trocas, créditos e conferências ficam nas abas novas.");
  return { ativo: 5 };
}
