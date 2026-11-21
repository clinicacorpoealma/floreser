/* =====================================================================
   FloreSer · Corpo e Alma — backend (Google Apps Script)
   00_Config — versões, prazos e configuração privada
   ---------------------------------------------------------------------
   Este arquivo NÃO guarda segredo nenhum. Senhas dos módulos, a pimenta
   das senhas e o id da planilha moram nas Script Properties do projeto
   (Configurações do projeto → Propriedades do script). O código pode ir
   para o GitHub; as propriedades, nunca.

     FLORESER_PIMENTA           obrigatória. A mesma "pimenta" que a 3.5.0
                                tinha no código: sem ela nenhuma senha de
                                conta confere. Nunca troque depois de definida.
     FLORESER_SENHA_<MODULO>    senha compartilhada em texto (CRM, AGENDA,
                                ENTRADAS, DEV). Só existe até a primeira
                                execução: prepararSegredos() troca cada uma
                                por FLORESER_SENHA_HASH_<MODULO> e apaga o texto.
     FLORESER_PLANILHA_ID       opcional. Sem ela vale a planilha à qual o
                                script está vinculado.
     FLORESER_FUSO              opcional. Fuso da clínica; padrão America/Cuiaba.
     FLORESER_MANUTENCAO        "sim" recusa toda gravação (migração final).
     FLORESER_SENHA_MODULO_<M>  "nao" desliga a senha compartilhada do módulo.
     FLORESER_CLINICORP_USUARIO o "Usuário API" do Clinicorp (Gerenciar
                                Assinatura → Acesso Externo e Integrações).
     FLORESER_CLINICORP_TOKEN   o "Token API" do Clinicorp. Os dois são
                                segredos: só no editor, nunca pelo site, e
                                nenhuma resposta, log ou exportação os mostra.
     FLORESER_CLINICORP_CONFIG  configuração não secreta da integração
                                (assinante, unidade, recursos, modos,
                                frequência), editada pelo painel → Integrações.

   Arquivos do backend, na ordem em que dependem uns dos outros:
     00_Config · 01_Http · 02_Tabelas · 03_Concorrencia · 04_Sessoes ·
     05_Autorizacao · 10_Esquema · 20_RegrasCRM · 21_ServicoCRM ·
     22_RegrasAgenda · 23_ServicoAgenda · 24_ServicoEntradas ·
     25_ServicoUsuarios · 26_ServicoAuditoria · 27_ServicoLixeira ·
     28_ServicoBusca · 29_ServicoDiagnostico · 30_RegrasFinanceiro ·
     31_ServicoFinanceiro · 32_ServicoImportacao · 35_ClinicorpContrato ·
     33_ServicoEstoque · 36_ClinicorpCliente · 37_ServicoIntegracao ·
     38_ClinicorpRecursos · 39_ClinicorpAplicacao · 40_Migracoes ·
     41_Manutencao · 42_MigracaoV3 · 43_MigracaoV4 · 34_ServicoExecucao ·
     44_MigracaoV5 (vendas ficam em 33_ServicoEstoque: são o livro do estoque)
   Nenhum deles executa código no carregamento além de declarar constantes
   literais e funções: a ordem dos arquivos no editor não importa.
   ===================================================================== */

/* ---- Versões ----
   Quatro números diferentes, para quatro perguntas diferentes:
     VERSAO_PRODUTO  a do changelog (version.js) — o que a pessoa vê;
     VERSAO_API      o contrato de pedidos e respostas;
     VERSAO_SCHEMA   o desenho das abas que este código sabe ler;
     o identificador da casca da PWA, que sai do version.js no navegador.
   ferramentas/conferir-publicacao.js confere que VERSAO_PRODUTO bate com
   o topo do changelog e que VERSAO_API bate com o que o site espera. */
var VERSAO_PRODUTO = "4.3.0";
var VERSAO_API = 2;
var VERSAO_SCHEMA = 5;

/* Capacidades que o site pode perguntar antes de usar. Uma ação nova
   entra aqui junto com a rota. */
var CAPACIDADES = [
  "operacoes-por-entidade", "operacao-idempotente", "sessao-unificada",
  "conflito-localizado", "lixeira", "auditoria", "busca-global", "crm-agenda",
  "financeiro", "importacao-planilha", "integracao-clinicorp", "integracao-automatica", "estoque", "vendas", "orcamentos-execucao"
];

var FUSO_PADRAO = "America/Cuiaba";

/* ---- Prazos de sessão (ver docs/SESSOES.md) ---- */
var SESSAO_CONTA_INATIVIDADE_MS = 30 * 86400000;   // 30 dias sem uso
var SESSAO_CONTA_ABSOLUTO_MS = 180 * 86400000;     // teto, mesmo com uso
var SESSAO_CONTA_RENOVAR_MS = 3600000;             // regrava no máximo 1×/hora
var SESSAO_MODULO_INATIVIDADE_MS = 30 * 60000;     // senha compartilhada: 30 min
var SESSAO_MODULO_ABSOLUTO_MS = 12 * 3600000;      // e no máximo 12 h
var SESSAO_MODULO_RENOVAR_MS = 5 * 60000;
var SESSAO_CACHE_SEGUNDOS = 120;
var SESSAO_LIMPAR_DEPOIS_MS = 30 * 86400000;       // linhas vencidas somem depois disso

var FALHAS_ATE_BLOQUEIO = 5;
var BLOQUEIO_MINUTOS = 15;

/* ---- Senhas de conta ----
   v1 é o esquema da 3.5.0 (2000 voltas de SHA-256 com salt e pimenta).
   Ele continua conferindo; no primeiro login certo a senha é derivada de
   novo em PBKDF2-HMAC-SHA256, um esquema reconhecido. */
var SENHA_V1_RODADAS = 2000;
var SENHA_PBKDF2_ITERACOES = 10000;

/* ---- Limites ---- */
var ESPERA_TRAVA_MS = 15000;
var MAX_OPERACOES_POR_PEDIDO = 50;
var MAX_CELULA = 45000;
var LIMITE_FOTO = 24000;
var DIAS_LIXEIRA = 30;
var DIAS_CONTATOS_NA_TELA = 62;
var DIAS_OPERACOES_GUARDADAS = 30;

/* O Financeiro não tem senha compartilhada: só conta individual com a
   permissão "financeiro" (ou administradora) entra nele. */
var MODULOS = ["crm", "agenda", "entradas", "financeiro"];
var MODULOS_COM_SENHA = ["crm", "agenda", "entradas", "dev"];

/* ---------------------------------------------------------------------
   Propriedades: lidas uma vez por execução
   --------------------------------------------------------------------- */

var _PROPS = null;

function propriedades() {
  if (_PROPS === null) {
    try { _PROPS = PropertiesService.getScriptProperties().getProperties() || {}; }
    catch (e) { _PROPS = {}; }
  }
  return _PROPS;
}

function propriedade(chave, padrao) {
  var v = propriedades()[chave];
  return v === undefined || v === null || v === "" ? padrao : v;
}

function definirPropriedade(chave, valor) {
  var p = PropertiesService.getScriptProperties();
  if (valor === null || valor === undefined) {
    p.deleteProperty(chave);
    if (_PROPS) delete _PROPS[chave];
  } else {
    p.setProperty(chave, String(valor));
    if (_PROPS) _PROPS[chave] = String(valor);
  }
}

/* Uma requisição nova começa do zero: o simulador dos testes reaproveita
   o escopo global, e o Apps Script não garante o contrário. */
function reiniciarExecucao() {
  _PROPS = null;
  if (typeof esquecerTabelas === "function") esquecerTabelas();
  if (typeof reiniciarMedidor === "function") reiniciarMedidor();
  if (typeof reiniciarClinicorp === "function") reiniciarClinicorp();
}

function fusoDaClinica() {
  return propriedade("FLORESER_FUSO", FUSO_PADRAO);
}

function emManutencao() {
  return propriedade("FLORESER_MANUTENCAO", "") === "sim";
}

function schemaAtivo() {
  return Number(propriedade("FLORESER_SCHEMA_ATIVO", "1")) || 1;
}

function senhaDeModuloLigada(modulo) {
  return propriedade("FLORESER_SENHA_MODULO_" + String(modulo).toUpperCase(), "sim") !== "nao";
}

/* ---- Época ----
   Número carimbado em toda entrada de cache que dependa de identidade ou
   permissão. Revogar, desativar ou trocar senha avança a época e derruba
   todas as entradas de uma vez — o CacheService não deixa procurar chaves. */
function epoca() {
  return String(propriedade("FLORESER_EPOCA", "1"));
}

function avancarEpoca() {
  definirPropriedade("FLORESER_EPOCA", String((Number(epoca()) || 1) + 1));
}

/* ---- Segredos ----
   A senha compartilhada chega como texto (copiada da 3.5.0, ver
   docs/PUBLICACAO.md) e sai daqui como hash. Rodar de novo não faz nada. */
function prepararSegredos() {
  var props = PropertiesService.getScriptProperties();
  var todas = props.getProperties();
  var trocadas = [];
  MODULOS_COM_SENHA.forEach(function (m) {
    var chave = "FLORESER_SENHA_" + m.toUpperCase();
    var texto = todas[chave];
    if (!texto) return;
    var salt = novoSegredoHex().slice(0, 32);
    props.setProperty("FLORESER_SENHA_HASH_" + m.toUpperCase(),
      JSON.stringify({ esquema: "pbkdf2", salt: salt, iteracoes: SENHA_PBKDF2_ITERACOES,
        hash: pbkdf2Hex(texto, salt, SENHA_PBKDF2_ITERACOES, "") }));
    props.deleteProperty(chave);
    trocadas.push(m);
  });
  _PROPS = null;
  return trocadas;
}

/* Diz o que falta, sem nunca mostrar valor nenhum. */
function segredosFaltando() {
  var faltam = [];
  if (!propriedade("FLORESER_PIMENTA", "")) faltam.push("FLORESER_PIMENTA");
  MODULOS_COM_SENHA.forEach(function (m) {
    var M = m.toUpperCase();
    if (!propriedade("FLORESER_SENHA_HASH_" + M, "") && !propriedade("FLORESER_SENHA_" + M, "")) {
      faltam.push("FLORESER_SENHA_" + M);
    }
  });
  return faltam;
}
