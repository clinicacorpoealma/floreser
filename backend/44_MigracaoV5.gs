/* =====================================================================
   44_MigracaoV5 — do schema 4 (4.2.0) para o schema 5 (4.3.0)
   ---------------------------------------------------------------------
   Incremental: nada é apagado.
     · cria est_vendas, est_venda_itens, exe_orcamentos,
       exe_orcamento_itens, exe_execucoes;
     · acrescenta no fim: est_itens.modoSaldo/corteEm/fichaId e
       est_movimentos.origemTipo/origemId/custoUnitario/estornaId;
     · define o modo de saldo de cada item que já existe, mantendo o saldo
       que a tela mostrava: item só do Alveare → livro (o corte é a última
       contagem que ele tinha); item importado → retrato da fonte;
     · orçamentos do Clinicorp já guardados voltam à fila para serem
       relidos com os procedimentos completos na próxima sincronização
       (a assinatura muda; vínculos e complementos ficam).

   migracaoV5Diagnosticar() → migracaoV5Backup() → migracaoV5Executar()
   → migracaoV5Ativar();  retorno: migracaoV5Retornar().
   ===================================================================== */

var MIGRACAO_V5 = "v4-para-v5";

function registrarEtapaV5(etapa, estado, relatorio) {
  var id = MIGRACAO_V5 + ":" + etapa;
  var atual = acharPorChave("sis_migracoes", id);
  gravarPorChave("sis_migracoes", { id: id, versao: 5, etapa: etapa, estado: estado,
    iniciadoEm: atual && atual.iniciadoEm ? atual.iniciadoEm : agoraISO(), concluidoEm: estado === "concluida" ? agoraISO() : null,
    relatorio: relatorio || null });
}

function retratoV4() {
  var T = {}, abas = {};
  tabelasDoSchema(4).forEach(function (n) {
    delete _TAB[n];
    try { CacheService.getScriptCache().remove(chaveDoCabecalho(definicaoTabela(n))); } catch (e) { }
    T[n] = lerTudo(n);
    abas[n] = T[n].length;
  });
  var soma = function (lista, campo) { return lista.reduce(function (t, x) { return t + (Number(x[campo]) || 0); }, 0); };
  /* o saldo que a tela mostrava de cada item, para conferir depois */
  var porItem = agrupar(T.est_saldos, "itemId"), movs = agrupar(T.est_movimentos, "itemId");
  var saldos = {};
  T.est_itens.forEach(function (i) {
    var ss = (porItem[i.id] || []).slice().sort(function (a, b) { return String(a.observadoEm).localeCompare(String(b.observadoEm)); });
    saldos[i.id] = retratoDoItem(i, ss, movs[i.id] || []).mil;
  });
  return { T: T, abas: abas, saldos: saldos, dinheiro: { ent_pagamentos: soma(T.ent_pagamentos, "valor"), fin_despesas: soma(T.fin_despesas, "valor"),
    fin_movimentos: soma(T.fin_movimentos, "valor") } };
}

function migracaoV5Diagnosticar() {
  reiniciarExecucao();
  var rel = novoRelatorio();
  if (schemaAtivo() !== 4) rel.erros.push("O schema ativo é " + schemaAtivo() + "; esta migração parte do schema 4 (4.2.0).");
  var r = null;
  try { r = retratoV4(); validarV2(r.T, rel); } catch (e) { rel.erros.push("Leitura do schema 4 falhou: " + (e.mensagem || e.message || e)); }
  var linhas = ["MIGRAÇÃO v4 → v5 — " + (rel.erros.length ? "BLOQUEADA" : "pronta")];
  rel.erros.forEach(function (e) { linhas.push("  erro · " + e); });
  rel.avisos.slice(0, 20).forEach(function (e) { linhas.push("  aviso · " + e); });
  if (r) {
    var locais = r.T.est_itens.filter(function (i) { return i.origem === "local"; }).length;
    linhas.push("Estoque: " + r.T.est_itens.length + " item(ns) — " + locais + " só do Alveare passam a \"saldo calculado no Alveare\"; os importados continuam com o saldo do arquivo. Nenhum saldo muda.");
    linhas.push("Orçamentos do Clinicorp: " + r.T.int_externos.filter(function (x) { return x.tipo === "orcamento"; }).length + " serão relidos com os procedimentos completos.");
  }
  Logger.log(linhas.join("\n"));
  return { erros: rel.erros, avisos: rel.avisos };
}

function migracaoV5Backup() { return migracaoBackup("4.3.0", "FLORESER_BACKUP_V5_ID"); }
function migracaoV5Ensaiar() { return executarMigracaoV5({ ensaio: true }); }
function migracaoV5Executar() { return executarMigracaoV5({ ensaio: false }); }

function executarMigracaoV5(opcoes) {
  reiniciarExecucao();
  if (schemaAtivo() !== 4) throw new Error("O schema ativo é " + schemaAtivo() + ": esta migração parte do schema 4.");
  if (!opcoes.ensaio && !emManutencao()) throw new Error("Ligue a manutenção antes (ligarManutencao()).");
  if (!opcoes.ensaio && !propriedade("FLORESER_BACKUP_V5_ID", "")) throw new Error("Rode migracaoV5Backup() antes.");
  var antes = retratoV4();
  var rel = novoRelatorio();
  validarV2(antes.T, rel);
  if (rel.erros.length) { registrarEtapaV5("execucao", "bloqueada", { erros: rel.erros }); throw new Error("Migração bloqueada: " + rel.erros.join(" | ")); }
  registrarEtapaV5("execucao", "em_andamento", { abas: antes.abas, dinheiro: antes.dinheiro });
  tabelasDoSchema(5).forEach(function (n) { if (definicaoTabela(n).desde === 5 || COLUNAS_DESDE[n]) garantirAbaDoEsquema(n); });
  avancarEpoca();
  esquecerTabelas();

  /* modo do saldo de cada item, preservando o saldo que já aparecia */
  var porItem = agrupar(lerTudo("est_saldos"), "itemId");
  var itens = lerTudo("est_itens").map(function (i) {
    var c = copiaLimpa(i); c._linha = i._linha;
    if (!c.modoSaldo) {
      c.modoSaldo = i.origem === "local" ? "livro" : "retrato";
      if (c.modoSaldo === "livro" && !c.corteEm) {
        var contagens = (porItem[i.id] || []).filter(function (s) { return s.fonte === "contagem"; })
          .sort(function (a, b) { return String(a.observadoEm).localeCompare(String(b.observadoEm)); });
        c.corteEm = contagens.length ? contagens[contagens.length - 1].observadoEm : null;
      }
    }
    return c;
  });
  if (itens.length) atualizar("est_itens", itens);
  /* movimentos da 4.2.0: manuais */
  var movs = lerTudo("est_movimentos").filter(function (m) { return !m.origemTipo; }).map(function (m) { var c = copiaLimpa(m); c._linha = m._linha; c.origemTipo = "manual"; return c; });
  if (movs.length) atualizar("est_movimentos", movs);
  /* orçamentos do Clinicorp: relidos na próxima sincronização */
  var orcs = lerTudo("int_externos").filter(function (x) { return x.tipo === "orcamento"; }).map(function (x) {
    var c = copiaLimpa(x); c._linha = x._linha; c.assinatura = "reler:" + String(x.assinatura || "").slice(0, 12); return c;
  });
  if (orcs.length) atualizar("int_externos", orcs);
  esquecerTabelas();

  var depois = retratoV4();
  var diferencas = [];
  Object.keys(antes.abas).forEach(function (n) {
    if (["sis_migracoes", "sis_logs", "sis_visitas"].indexOf(n) >= 0) return;
    if (antes.abas[n] !== depois.abas[n]) diferencas.push(n + " (" + antes.abas[n] + " → " + depois.abas[n] + ")");
  });
  Object.keys(antes.dinheiro).forEach(function (k) { if (antes.dinheiro[k] !== depois.dinheiro[k]) diferencas.push("soma de " + k); });
  Object.keys(antes.saldos).forEach(function (k) { if (antes.saldos[k] !== depois.saldos[k]) diferencas.push("saldo do item " + k); });
  var faltam = [];
  tabelasDoSchema(5).forEach(function (n) {
    try { delete _TAB[n]; var t = tabela(n); definicaoTabela(n).campos.forEach(function (c) { if (t.nomes.indexOf(c.n) < 0) faltam.push(n + "." + c.n); }); }
    catch (e) { faltam.push(n + " (" + (e.mensagem || e.message) + ")"); }
  });
  var ok = !diferencas.length && !faltam.length;
  var relatorio = { ok: ok, diferencas: diferencas, faltam: faltam, ensaio: !!opcoes.ensaio, itens: itens.length, orcamentosParaReler: orcs.length };
  registrarEtapaV5("execucao", ok ? "concluida" : "falhou", relatorio);
  Logger.log("MIGRAÇÃO v4 → v5 " + (opcoes.ensaio ? "(ENSAIO) " : "") + "— CONFERÊNCIA: " + (ok ? "OK" : "FALHOU") +
    (diferencas.length ? "\nDiferenças: " + diferencas.join(", ") : "") + (faltam.length ? "\nFaltando: " + faltam.join(", ") : ""));
  return relatorio;
}

function migracaoV5Ativar() {
  reiniciarExecucao();
  var etapa = acharPorChave("sis_migracoes", MIGRACAO_V5 + ":execucao");
  if (!etapa || etapa.estado !== "concluida") throw new Error("A conferência não passou: rode migracaoV5Executar().");
  if (schemaAtivo() !== 4) throw new Error("O schema ativo é " + schemaAtivo() + ".");
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "5");
  registrarEtapaV5("ativacao", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 5 ativo. Desligue a manutenção e publique o site 4.3.0.");
  return { ativo: 5 };
}

/* Volta para a 4.2.0: abas e colunas novas ficam (a 4.2.0 as ignora). */
function migracaoV5Retornar() {
  reiniciarExecucao();
  if (schemaAtivo() !== 5) throw new Error("O schema 5 não está ativo.");
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "4");
  registrarEtapaV5("retorno", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 4 de novo. Reimplante a 4.2.0 e o site 4.2.0. Vendas e execuções ficam guardadas nas abas novas.");
  return { ativo: 4 };
}
