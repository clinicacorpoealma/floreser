/* =====================================================================
   43_MigracaoV4 — do schema 3 (4.1.0) para o schema 4 (4.2.0)
   ---------------------------------------------------------------------
   Incremental, como a 2 → 3: nada do que existe é apagado.
     · cria est_itens, est_saldos, est_movimentos;
     · acrescenta no fim: ent_entradas.externoEstado, fin_insumos.itemEstoqueId
       e .custoFonte, fin_fichas.revisar, int_externos.aplicado/aplicadoEm/
       aplicacao;
     · identidade dos registros e vínculos do Clinicorp passa a levar o
       ASSINANTE (clinicorp:<assinante>:<tipo>:<id>) — as linhas são as
       mesmas, só a chave é reescrita;
     · RECONCILIAÇÃO INICIAL: o que já foi importado é marcado como
       "aplicado" no estado em que está. Recebimentos sem vínculo ficam
       como consulta (anterior: true) — a automação não cria entrada por
       cima de um lançamento manual. Orçamentos guardam o status atual, para
       só um status NOVO disparar regra. Agendamentos voltam à fila só
       quando o modo automático for ligado (o assistente).

   Rodadas à mão (docs/PUBLICACAO.md §4.2.0):
     migracaoV4Diagnosticar() → migracaoV4Backup() → migracaoV4Executar()
     → migracaoV4Ativar();  retorno: migracaoV4Retornar().
   ===================================================================== */

var MIGRACAO_V4 = "v3-para-v4";

function registrarEtapaV4(etapa, estado, relatorio) {
  var id = MIGRACAO_V4 + ":" + etapa;
  var atual = acharPorChave("sis_migracoes", id);
  gravarPorChave("sis_migracoes", { id: id, versao: 4, etapa: etapa, estado: estado,
    iniciadoEm: atual && atual.iniciadoEm ? atual.iniciadoEm : agoraISO(), concluidoEm: estado === "concluida" ? agoraISO() : null,
    relatorio: relatorio || null });
}

function retratoV3() {
  var T = {}, abas = {};
  tabelasDoSchema(3).forEach(function (n) {
    delete _TAB[n];
    try { CacheService.getScriptCache().remove(chaveDoCabecalho(definicaoTabela(n))); } catch (e) { }
    T[n] = lerTudo(n);
    abas[n] = T[n].length;
  });
  var soma = function (lista, campo) { return lista.reduce(function (t, x) { return t + (Number(x[campo]) || 0); }, 0); };
  return { T: T, abas: abas, dinheiro: { ent_pagamentos: soma(T.ent_pagamentos, "valor"), fin_despesas: soma(T.fin_despesas, "valor"),
    fin_movimentos: soma(T.fin_movimentos, "valor") } };
}

/* clinicorp:<tipo>:<id>[:<local>]  →  clinicorp:<assinante>:<tipo>:<id>[:<local>] */
function chaveComAssinante(id, assinante) {
  var p = String(id).split(":");
  if (p[0] !== "clinicorp" || !assinante) return id;
  var tipos = ["paciente", "orcamento", "agendamento", "recebimento", "procedimento", "campanha", "resumo", "estoque"];
  if (tipos.indexOf(p[1]) < 0) return id;          // já tem assinante
  return ["clinicorp", assinante].concat(p.slice(1)).join(":");
}

function chaveSemAssinante(id, assinante) {
  var p = String(id).split(":");
  if (p[0] !== "clinicorp" || !assinante || p[1] !== assinante) return id;
  return ["clinicorp"].concat(p.slice(2)).join(":");
}

function migracaoV4Diagnosticar() {
  reiniciarExecucao();
  var rel = novoRelatorio();
  if (schemaAtivo() !== 3) rel.erros.push("O schema ativo é " + schemaAtivo() + "; esta migração parte do schema 3 (4.1.0).");
  var r = null;
  try { r = retratoV3(); validarV2(r.T, rel); } catch (e) { rel.erros.push("Leitura do schema 3 falhou: " + (e.mensagem || e.message || e)); }
  var semAssinante = r ? r.T.int_externos.filter(function (x) { return !x.assinante; }).length : 0;
  if (semAssinante) rel.avisos.push(semAssinante + " registro(s) externo(s) sem assinante: ficam com a chave antiga.");
  var reconc = r ? {
    recebimentosComoConsulta: r.T.int_externos.filter(function (x) { return x.tipo === "recebimento"; }).length -
      r.T.int_vinculos.filter(function (v) { return v.estado === "ativo" && v.tipo === "recebimento"; }).length,
    orcamentos: r.T.int_externos.filter(function (x) { return x.tipo === "orcamento"; }).length,
    agendamentos: r.T.int_externos.filter(function (x) { return x.tipo === "agendamento"; }).length
  } : null;
  var linhas = ["MIGRAÇÃO v3 → v4 — " + (rel.erros.length ? "BLOQUEADA" : "pronta")];
  rel.erros.forEach(function (e) { linhas.push("  erro · " + e); });
  rel.avisos.slice(0, 20).forEach(function (e) { linhas.push("  aviso · " + e); });
  if (r) {
    linhas.push("Dinheiro (conferido de novo depois): entradas " + centavosParaTexto(r.dinheiro.ent_pagamentos) + " · despesas " +
      centavosParaTexto(r.dinheiro.fin_despesas) + " · pagamentos de despesas " + centavosParaTexto(r.dinheiro.fin_movimentos));
    linhas.push("Reconciliação: " + reconc.recebimentosComoConsulta + " recebimento(s) sem vínculo ficam como consulta (não viram entrada sozinhos); " +
      reconc.orcamentos + " orçamento(s) guardam o status atual; " + reconc.agendamentos + " agendamento(s) entram na fila quando o automático for ligado.");
  }
  Logger.log(linhas.join("\n"));
  return { erros: rel.erros, avisos: rel.avisos, dinheiro: r ? r.dinheiro : null, reconciliacao: reconc };
}

function migracaoV4Backup() { return migracaoBackup("4.2.0", "FLORESER_BACKUP_V4_ID"); }
function migracaoV4Ensaiar() { return executarMigracaoV4({ ensaio: true }); }
function migracaoV4Executar() { return executarMigracaoV4({ ensaio: false }); }

function executarMigracaoV4(opcoes) {
  reiniciarExecucao();
  if (schemaAtivo() !== 3) throw new Error("O schema ativo é " + schemaAtivo() + ": esta migração parte do schema 3.");
  if (!opcoes.ensaio && !emManutencao()) throw new Error("Ligue a manutenção antes (ligarManutencao()).");
  if (!opcoes.ensaio && !propriedade("FLORESER_BACKUP_V4_ID", "")) throw new Error("Rode migracaoV4Backup() antes.");
  var antes = retratoV3();
  var rel = novoRelatorio();
  validarV2(antes.T, rel);
  if (rel.erros.length) { registrarEtapaV4("execucao", "bloqueada", { erros: rel.erros }); throw new Error("Migração bloqueada: " + rel.erros.join(" | ")); }
  registrarEtapaV4("execucao", "em_andamento", { abas: antes.abas, dinheiro: antes.dinheiro });

  tabelasDoSchema(4).forEach(function (n) { if (definicaoTabela(n).desde === 4 || COLUNAS_DESDE[n]) garantirAbaDoEsquema(n); });
  avancarEpoca();
  esquecerTabelas();

  /* chaves com assinante + reconciliação inicial, linha a linha */
  var vinculos = lerTudo("int_vinculos");
  var vinculado = {};
  vinculos.forEach(function (v) { if (v.estado === "ativo") vinculado[v.tipo + ":" + v.externoId] = true; });
  var vNovos = vinculos.map(function (v) { var c = copiaLimpa(v); c._linha = v._linha; c.id = chaveComAssinante(v.id, v.assinante); return c; });
  if (vNovos.length) atualizar("int_vinculos", vNovos);
  var externos = lerTudo("int_externos");
  var xNovos = externos.map(function (x) {
    var c = copiaLimpa(x); c._linha = x._linha;
    c.id = chaveComAssinante(x.id, x.assinante);
    if (x.tipo === "recebimento") {
      c.aplicado = x.assinatura; c.aplicadoEm = agoraISO();
      c.aplicacao = { assinatura: x.assinatura, tentativas: 0, resultado: "reconciliacao", estado: vinculado["recebimento:" + x.externoId] ? {} : { anterior: true } };
    } else if (x.tipo === "orcamento") {
      c.aplicado = x.assinatura; c.aplicadoEm = agoraISO();
      c.aplicacao = { assinatura: x.assinatura, tentativas: 0, resultado: "reconciliacao", estado: { status: x.dados ? x.dados.status : "" } };
    } else if (x.tipo !== "agendamento") {
      c.aplicado = x.assinatura;
    }
    return c;
  });
  if (xNovos.length) atualizar("int_externos", xNovos);
  /* pontos de retomada passam a dizer de que conta e unidade são */
  _PROPS = null;
  var cfg = configClinicorp();
  Object.keys(cfg.ultimas || {}).forEach(function (k) { if (cfg.ultimas[k].contexto === undefined) cfg.ultimas[k].contexto = contextoDaConta(cfg); });
  salvarConfigClinicorp(cfg);
  esquecerTabelas();

  var depois = retratoV3();
  var diferencas = [];
  Object.keys(antes.abas).forEach(function (n) {
    if (["sis_migracoes", "sis_logs", "sis_visitas"].indexOf(n) >= 0) return;
    if (antes.abas[n] !== depois.abas[n]) diferencas.push(n + " (" + antes.abas[n] + " → " + depois.abas[n] + ")");
  });
  Object.keys(antes.dinheiro).forEach(function (k) { if (antes.dinheiro[k] !== depois.dinheiro[k]) diferencas.push("soma de " + k); });
  var ids = {};
  depois.T.int_externos.forEach(function (x) { if (ids[x.id]) diferencas.push("chave repetida " + x.id); ids[x.id] = true; });
  var faltam = [];
  tabelasDoSchema(4).forEach(function (n) {
    try { delete _TAB[n]; var t = tabela(n); definicaoTabela(n).campos.forEach(function (c) { if (t.nomes.indexOf(c.n) < 0) faltam.push(n + "." + c.n); }); }
    catch (e) { faltam.push(n + " (" + (e.mensagem || e.message) + ")"); }
  });
  var ok = !diferencas.length && !faltam.length;
  var relatorio = { ok: ok, diferencas: diferencas, faltam: faltam, dinheiro: depois.dinheiro, ensaio: !!opcoes.ensaio,
    reconciliados: xNovos.filter(function (x) { return x.aplicado; }).length };
  registrarEtapaV4("execucao", ok ? "concluida" : "falhou", relatorio);
  Logger.log("MIGRAÇÃO v3 → v4 " + (opcoes.ensaio ? "(ENSAIO) " : "") + "— CONFERÊNCIA: " + (ok ? "OK" : "FALHOU") +
    (diferencas.length ? "\nDiferenças: " + diferencas.join(", ") : "") + (faltam.length ? "\nFaltando: " + faltam.join(", ") : ""));
  return relatorio;
}

function migracaoV4Ativar() {
  reiniciarExecucao();
  var etapa = acharPorChave("sis_migracoes", MIGRACAO_V4 + ":execucao");
  if (!etapa || etapa.estado !== "concluida") throw new Error("A conferência não passou: rode migracaoV4Executar().");
  if (schemaAtivo() !== 3) throw new Error("O schema ativo é " + schemaAtivo() + ".");
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "4");
  registrarEtapaV4("ativacao", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 4 ativo. Desligue a manutenção e publique o site 4.2.0. A automação só liga pelo assistente (painel → Integrações).");
  return { ativo: 4 };
}

/* Volta para a 4.1.0: as chaves voltam ao formato antigo (a 4.1.0 procura
   assim); abas e colunas novas ficam, ignoradas. */
function migracaoV4Retornar() {
  reiniciarExecucao();
  if (schemaAtivo() !== 4) throw new Error("O schema 4 não está ativo.");
  var g = gatilhoAgendado();
  if (g) try { ScriptApp.deleteTrigger(g); } catch (e) { }
  ["int_vinculos", "int_externos"].forEach(function (n) {
    var linhas = lerTudo(n).map(function (x) { var c = copiaLimpa(x); c._linha = x._linha; c.id = chaveSemAssinante(x.id, x.assinante); return c; });
    if (linhas.length) atualizar(n, linhas);
  });
  definirPropriedade("FLORESER_SCHEMA_ATIVO", "3");
  registrarEtapaV4("retorno", "concluida", { em: agoraISO() });
  avancarEpoca();
  Logger.log("Schema 3 de novo. Reimplante a 4.1.0 e o site 4.1.0. O Estoque e as marcas de aplicação ficam nas abas, sem uso.");
  return { ativo: 3 };
}
