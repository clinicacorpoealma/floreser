/* =====================================================================
   41_Manutencao — rodadas à mão no editor do Apps Script
   ---------------------------------------------------------------------
   Nenhuma destas funções está no roteamento: só quem abre o editor do
   projeto (a dona da planilha) consegue chamá-las. Nenhuma imprime senha,
   token, hash ou dado de paciente.

     conferirInstalacao()     o que falta: abas, colunas, segredos, schema
     prepararAbas()           instalação nova: cria as abas do schema 2
     definirSenhaDeModulo()   troca a senha compartilhada de um módulo
     ligarManutencao() / desligarManutencao()
     ligarDiagnostico() / desligarDiagnostico()
     recuperarOperacoesAgora()  refaz operações interrompidas
     conferirOperacoes()      lista operações em estado anormal
     limparOperacoesAntigas() apaga o diário com mais de 30 dias
     conferirIntegridade()    relações e chaves do schema 2, ao vivo
   ===================================================================== */

function conferirInstalacao() {
  reiniciarExecucao();
  var linhas = ["FloreSer " + VERSAO_PRODUTO + " · API " + VERSAO_API + " · schema " + VERSAO_SCHEMA +
    " (ativo: " + schemaAtivo() + ")" + (emManutencao() ? " · EM MANUTENÇÃO" : "")];
  var faltam = segredosFaltando();
  linhas.push(faltam.length ? "Segredos faltando: " + faltam.join(", ") : "Segredos: todos definidos (valores não exibidos).");
  nomesDasTabelas().forEach(function (n) {
    try {
      delete _TAB[n];
      try { CacheService.getScriptCache().remove(chaveDoCabecalho(definicaoTabela(n))); } catch (e) { }
      var t = tabela(n);
      var extras = t.nomes.filter(function (x) { return x && t.tipos[x] === undefined; });
      linhas.push("  ok  " + n + (extras.length ? "  (colunas a mais, preservadas: " + extras.join(", ") + ")" : ""));
    } catch (e) {
      linhas.push("  !!  " + n + ": " + (e.mensagem || e.message || e));
    }
  });
  linhas.push("Operações pendentes: " + (propriedade("FLORESER_OPS_PENDENTES", "") ? "SIM — rode recuperarOperacoesAgora()" : "nenhuma"));
  avancarEpoca();
  Logger.log(linhas.join("\n"));
  return linhas.join("\n");
}

/* Planilha nova, sem dado nenhum. Para a planilha da 3.5.0 use a migração. */
function prepararAbas() {
  reiniciarExecucao();
  nomesDasTabelas().forEach(function (n) { garantirAbaDoEsquema(n); });
  if (!acharPorChave("sis_config", "crm.cadencias")) {
    inserir("sis_config", [{ chave: "crm.cadencias", valor: CADENCIAS_PADRAO_DIAS, rev: 1, opId: "setup", atualizadoEm: agoraISO(), atualizadoPor: "setup" }]);
  }
  prepararSegredos();
  if (schemaAtivo() < VERSAO_SCHEMA && !lerTudo("sis_usuarios").length) definirPropriedade("FLORESER_SCHEMA_ATIVO", String(VERSAO_SCHEMA));
  avancarEpoca();
  return conferirInstalacao();
}

/* definirSenhaDeModulo("crm", "nova senha") — a senha vira hash na hora;
   o texto não fica guardado em lugar nenhum. */
function definirSenhaDeModulo(modulo, senha) {
  if (MODULOS_COM_SENHA.indexOf(modulo) < 0) throw new Error("Módulo desconhecido: " + modulo);
  if (String(senha || "").length < 6) throw new Error("Use pelo menos 6 caracteres.");
  definirPropriedade("FLORESER_SENHA_" + modulo.toUpperCase(), String(senha));
  prepararSegredos();
  return "Senha de " + modulo + " trocada.";
}

function ligarManutencao() { definirPropriedade("FLORESER_MANUTENCAO", "sim"); return "Manutenção LIGADA: nenhuma gravação é aceita."; }
function desligarManutencao() { definirPropriedade("FLORESER_MANUTENCAO", null); return "Manutenção desligada."; }
function ligarDiagnostico() { definirPropriedade("FLORESER_DIAGNOSTICO", "sim"); return "Diagnóstico ligado: cada resposta leva o campo diag."; }
function desligarDiagnostico() { definirPropriedade("FLORESER_DIAGNOSTICO", null); return "Diagnóstico desligado."; }

function recuperarOperacoesAgora() {
  reiniciarExecucao();
  definirPropriedade("FLORESER_OPS_PENDENTES", "manual");
  var n = 0;
  comTrava(function () { n = 0; });
  var linhas = conferirOperacoes();
  return "Recuperação concluída. " + linhas;
}

function conferirOperacoes() {
  reiniciarExecucao();
  var anormais = lerUltimas("sis_operacoes", 2000).filter(function (o) { return o.estado !== "aplicada"; });
  var texto = anormais.length
    ? anormais.map(function (o) { return o.operacaoId + " · " + o.acao + " · " + o.estado + " · " + o.criadoEm; }).join("\n")
    : "Nenhuma operação em estado anormal.";
  Logger.log(texto);
  return texto;
}

function limparOperacoesAntigas() {
  reiniciarExecucao();
  var corte = Date.now() - DIAS_OPERACOES_GUARDADAS * 86400000;
  return comTrava(function () {
    var velhas = lerTudo("sis_operacoes").filter(function (o) {
      return o.estado === "aplicada" && o.concluidoEm && new Date(o.concluidoEm).getTime() < corte;
    });
    if (velhas.length) remover("sis_operacoes", velhas);
    return velhas.length + " operação(ões) antiga(s) removida(s) do diário.";
  });
}

function conferirIntegridade() {
  reiniciarExecucao();
  var T = {};
  nomesDasTabelas().forEach(function (n) { T[n] = lerTudo(n); });
  var rel = novoRelatorio();
  validarV2(T, rel);
  var texto = "Erros:\n" + (rel.erros.join("\n") || "nenhum") + "\nAvisos:\n" + (rel.avisos.join("\n") || "nenhum");
  Logger.log(texto);
  return rel;
}
