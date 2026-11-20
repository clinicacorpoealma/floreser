/* =====================================================================
   10_Esquema — o desenho do banco (schema 4)
   ---------------------------------------------------------------------
   A fonte única das tabelas: nome da aba, chave, campos e tipos. A camada
   de tabelas (02) valida o cabeçalho real contra isto; a migração (40)
   constrói estas abas a partir das da 3.5.0; docs/ESQUEMA.md explica cada
   uma.

   Tipos: texto · data (AAAA-MM-DD, dia de calendário) · instante (ISO UTC)
          · inteiro · epoch (ms, só sessões) · dinheiro (centavos na lógica,
          "350.00" na planilha) · booleano ("sim"/"não") · json

   Entidades raiz levam rev · opId · atualizadoEm · atualizadoPor. Filhos
   (ciclos, agendamentos, condições, histórico, pagamentos, respostas)
   pertencem ao agregado e mudam com a revisão dele.

   "grande": aba que só cresce; procurar nela é pelo TextFinder, nunca
   lendo a aba inteira.

   "desde": a versão do schema em que a tabela (ou a coluna, em
   COLUNAS_DESDE) apareceu. A migração 2 → 3 (42_MigracaoV3) cria só o que
   tem "desde: 3"; nada do schema 2 é reescrito.
   ===================================================================== */

var CAMPOS_RAIZ = ["rev:inteiro", "opId:texto", "atualizadoEm:instante", "atualizadoPor:texto"];

var ESQUEMA = {
  crm_leads: { chave: ["id"], campos: ["id:texto", "nome:texto", "whatsapp:texto", "interesse:texto",
    "observacoes:texto", "etapa:texto", "cadencia:texto", "exCliente:booleano", "ultimoContato:data",
    "criadoEm:data", "dtConversa:data", "dtAgendamento:data", "dtComparecimento:data", "dtVenda:data",
    "dtReprovado:data", "origem:texto", "dataAgendada:data", "legado:json"], raiz: true },
  crm_contatos: { chave: ["id"], grande: true, campos: ["id:texto", "leadId:texto", "data:data",
    "criadoEm:instante", "autorTipo:texto", "autorId:texto", "autorNome:texto", "opId:texto"] },

  agenda_pacientes: { chave: ["id"], campos: ["id:texto", "nome:texto", "categoriaId:texto", "obs:texto",
    "criadoEm:data", "arquivada:booleano", "arquivadaEm:data", "whatsapp:texto", "origem:texto",
    "crmLeadId:texto", "legado:json"], raiz: true },
  agenda_ciclos: { chave: ["pacienteId", "area"], campos: ["pacienteId:texto", "area:texto", "freq:inteiro",
    "ultimo:data", "adiadaPara:data", "naoRespondeu:inteiro", "fimPrevisto:data", "aRemarcar:inteiro"] },
  agenda_agendamentos: { chave: ["id"], campos: ["id:texto", "pacienteId:texto", "area:texto", "data:data",
    "followUp:booleano", "criadoEm:instante"] },
  agenda_condicoes: { chave: ["id"], campos: ["id:texto", "pacienteId:texto", "texto:texto", "inicio:data", "fim:data"] },
  agenda_pac_maquinas: { chave: ["pacienteId", "maquinaId"], campos: ["pacienteId:texto", "maquinaId:texto"] },
  agenda_historico: { chave: ["id"], grande: true, campos: ["id:texto", "pacienteId:texto", "tipo:texto",
    "area:texto", "data:data", "em:data", "fu:data", "maquina:texto"] },
  agenda_followups: { chave: ["id"], campos: ["id:texto", "pacienteId:texto", "area:texto", "data:data",
    "feito:booleano", "agendamentoData:data", "criadoEm:data", "feitoEm:data"], raiz: true },
  agenda_categorias: { chave: ["id"], campos: ["id:texto", "nome:texto", "cor:texto"], raiz: true },
  agenda_maquinas: { chave: ["id"], campos: ["id:texto", "nome:texto", "cadencia:texto", "cor:texto", "obs:texto"], raiz: true },
  agenda_vindas: { chave: ["id"], campos: ["id:texto", "maquinaId:texto", "data:data", "obs:texto", "criadoEm:data"], raiz: true },
  agenda_respostas: { chave: ["vindaId", "pacienteId"], campos: ["vindaId:texto", "pacienteId:texto", "status:texto",
    "em:data", "adiadaPara:data", "vezes:inteiro"] },

  ent_entradas: { chave: ["id"], campos: ["id:texto", "nome:texto", "data:data", "descricao:texto", "obs:texto",
    "criadoEm:instante", "legado:json", "origem:texto", "loteId:texto", "externoEstado:texto"], raiz: true },
  ent_pagamentos: { chave: ["id"], campos: ["id:texto", "entradaId:texto", "ordem:inteiro", "metodo:texto",
    "valor:dinheiro", "parcelas:inteiro"] },

  sis_usuarios: { chave: ["id"], campos: ["id:texto", "nome:texto", "usuario:texto", "esquema:texto",
    "senhaHash:texto", "salt:texto", "iteracoes:inteiro", "ativo:booleano", "admin:booleano", "crm:booleano",
    "agenda:booleano", "entradas:booleano", "credencialVersao:inteiro", "criadoEm:instante", "criadoPor:texto",
    "ultimoLogin:instante", "alteradoEm:instante", "legado:json", "financeiro:booleano"] },
  sis_fotos: { chave: ["usuarioId"], campos: ["usuarioId:texto", "foto:texto", "atualizadoEm:instante"] },
  sis_sessoes: { chave: ["tokenHash"], campos: ["tokenHash:texto", "tipo:texto", "usuarioId:texto", "modulo:texto",
    "criadoEm:epoch", "ultimoUso:epoch", "expiraEm:epoch", "expiraAbsoluto:epoch", "revogadoEm:epoch",
    "motivo:texto", "credencialVersao:inteiro", "operacaoId:texto", "agente:texto"] },
  sis_operacoes: { chave: ["operacaoId"], grande: true, campos: ["operacaoId:texto", "chave:texto", "autorId:texto",
    "acao:texto", "estado:texto", "criadoEm:instante", "concluidoEm:instante", "plano:texto", "plano2:texto",
    "plano3:texto", "resultado:json", "pedidoId:texto"] },
  sis_auditoria: { chave: ["id"], grande: true, campos: ["id:texto", "operacaoId:texto", "em:instante", "modulo:texto",
    "entidade:texto", "entidadeId:texto", "acao:texto", "campo:texto", "antes:texto", "depois:texto",
    "autorTipo:texto", "autorId:texto", "autorNome:texto", "contexto:texto", "pedidoId:texto"] },
  sis_lixeira: { chave: ["id"], campos: ["id:texto", "tipo:texto", "registroId:texto", "titulo:texto",
    "descricao:texto", "dados:json", "excluidoEm:instante", "excluidoPor:texto", "excluidoPorId:texto", "motivo:texto"] },
  sis_logs: { chave: ["id"], grande: true, campos: ["id:texto", "quando:instante", "nivel:texto", "evento:texto",
    "pagina:texto", "mensagem:texto", "versao:texto", "sessao:texto", "pedidoId:texto"] },
  sis_visitas: { chave: ["id"], grande: true, campos: ["id:texto", "primeiroAcesso:texto", "ultimoAcesso:texto",
    "paginas:texto", "entrada:texto", "atual:texto", "referrer:texto", "versao:texto", "navegador:texto",
    "plataforma:texto", "idioma:texto", "idiomas:texto", "cookies:texto", "tela:texto", "viewport:texto",
    "dpr:texto", "toque:texto", "tipo:texto", "fuso:texto", "conexao:texto", "memoria:texto", "nucleos:texto", "dnt:texto"] },
  sis_config: { chave: ["chave"], campos: ["chave:texto", "valor:json"], raiz: true },
  sis_migracoes: { chave: ["id"], campos: ["id:texto", "versao:inteiro", "etapa:texto", "estado:texto",
    "iniciadoEm:instante", "concluidoEm:instante", "relatorio:json"] },
  sis_importacoes: { chave: ["id"], desde: 3, campos: ["id:texto", "modulo:texto", "arquivo:texto", "planilha:texto",
    "mapeamento:json", "total:inteiro", "importadas:inteiro", "repetidas:inteiro", "erros:inteiro", "detalhes:json",
    "estado:texto", "criadoEm:instante", "criadoPor:texto", "operacaoId:texto"] },

  /* ---- Financeiro (schema 3) ---- */
  fin_categorias: { chave: ["id"], desde: 3, campos: ["id:texto", "nome:texto", "paiId:texto", "ativa:booleano",
    "ordem:inteiro"], raiz: true },
  fin_fornecedores: { chave: ["id"], desde: 3, campos: ["id:texto", "nome:texto", "documento:texto", "contato:texto",
    "notas:texto", "ativo:booleano"], raiz: true },
  fin_despesas: { chave: ["id"], desde: 3, campos: ["id:texto", "descricao:texto", "categoriaId:texto",
    "fornecedorId:texto", "valor:dinheiro", "competencia:texto", "vencimento:data", "meio:texto", "conta:texto",
    "area:texto", "notas:texto", "cancelada:booleano", "canceladaEm:instante", "motivoCancelamento:texto",
    "grupoId:texto", "grupoTipo:texto", "sequencia:inteiro", "totalSequencia:inteiro", "origem:texto",
    "loteId:texto", "criadoEm:instante"], raiz: true },
  fin_movimentos: { chave: ["id"], desde: 3, campos: ["id:texto", "despesaId:texto", "tipo:texto", "data:data",
    "valor:dinheiro", "meio:texto", "conta:texto", "evidencia:texto", "notas:texto", "estornaId:texto",
    "criadoEm:instante", "autorNome:texto"] },
  fin_grupos: { chave: ["id"], desde: 3, campos: ["id:texto", "tipo:texto", "descricao:texto", "valorTotal:dinheiro",
    "quantidade:inteiro", "frequencia:texto", "inicio:data", "fim:data", "modelo:json", "geradoAte:data",
    "encerrado:booleano"], raiz: true },
  fin_orcamentos: { chave: ["id"], desde: 3, campos: ["id:texto", "categoriaId:texto", "mes:texto", "valor:dinheiro",
    "alertaPct:inteiro"], raiz: true },
  fin_saldos: { chave: ["id"], desde: 3, campos: ["id:texto", "conta:texto", "data:data", "valor:dinheiro",
    "notas:texto"], raiz: true },
  fin_insumos: { chave: ["id"], desde: 3, campos: ["id:texto", "nome:texto", "unidadeCompra:texto",
    "conteudo:texto", "unidadeConteudo:texto", "valorEmbalagem:dinheiro", "rendimento:texto", "perdaPct:texto",
    "notas:texto", "ativo:booleano", "itemEstoqueId:texto", "custoFonte:texto"], raiz: true },
  fin_fichas: { chave: ["id"], desde: 3, campos: ["id:texto", "tipo:texto", "nome:texto", "precoAtual:dinheiro",
    "dados:json", "versaoAprovada:inteiro", "clinicorpProcedimentoId:texto", "arquivada:booleano", "revisar:texto"], raiz: true },
  fin_fichas_versoes: { chave: ["id"], desde: 3, grande: true, campos: ["id:texto", "fichaId:texto", "versao:inteiro",
    "aprovadaEm:instante", "aprovadaPor:texto", "dados:json", "resultado:json"] },

  /* ---- Integrações (schema 3) ---- */
  int_vinculos: { chave: ["id"], desde: 3, campos: ["id:texto", "sistema:texto", "assinante:texto", "unidade:texto",
    "tipo:texto", "externoId:texto", "localTipo:texto", "localId:texto", "estado:texto", "assinatura:texto",
    "sincronizadoEm:instante", "criadoEm:instante", "criadoPor:texto"], raiz: true },
  int_externos: { chave: ["id"], desde: 3, campos: ["id:texto", "sistema:texto", "assinante:texto", "unidade:texto",
    "tipo:texto", "externoId:texto", "dados:json", "assinatura:texto", "alteradoExterno:texto", "vistoEm:instante",
    "ausenteDesde:instante", "complemento:json", "execucaoId:texto", "aplicado:texto", "aplicadoEm:instante",
    "aplicacao:json"], raiz: true },
  int_execucoes: { chave: ["id"], desde: 3, grande: true, campos: ["id:texto", "recurso:texto", "modo:texto",
    "estado:texto", "origem:texto", "autor:texto", "iniciadoEm:instante", "atualizadoEm:instante",
    "concluidoEm:instante", "de:data", "ate:data", "cursor:json", "contagens:json", "erros:json"] },
  int_pendencias: { chave: ["id"], desde: 3, campos: ["id:texto", "recurso:texto", "tipo:texto", "chave:texto",
    "externoId:texto", "localTipo:texto", "localId:texto", "resumo:texto", "detalhes:json", "estado:texto",
    "criadoEm:instante", "resolvidoEm:instante", "resolvidoPor:texto", "resolucao:texto"], raiz: true },
  /* ---- Estoque (schema 4) ----
     Quantidades são texto decimal ("12.5"), calculadas em milésimos
     inteiros (30_RegrasFinanceiro: qtdMil). Saldo é sempre um RETRATO com
     data e fonte; nunca um número solto. */
  est_itens: { chave: ["id"], desde: 4, campos: ["id:texto", "nome:texto", "codigo:texto", "categoria:texto",
    "unidadeCompra:texto", "unidadeConsumo:texto", "fator:texto", "minimo:texto", "custoUnitario:dinheiro",
    "custoFonte:texto", "origem:texto", "externoId:texto", "local:texto", "ativo:booleano", "notas:texto",
    "criadoEm:instante"], raiz: true },
  est_saldos: { chave: ["id"], desde: 4, grande: true, campos: ["id:texto", "itemId:texto", "local:texto",
    "quantidade:texto", "lote:texto", "validade:data", "custoUnitario:dinheiro", "fonte:texto", "loteImportacao:texto",
    "observadoEm:instante"] },
  est_movimentos: { chave: ["id"], desde: 4, grande: true, campos: ["id:texto", "itemId:texto", "tipo:texto",
    "quantidade:texto", "data:data", "motivo:texto", "criadoEm:instante", "autorNome:texto", "opId:texto"] },

  int_passos: { chave: ["id"], desde: 3, campos: ["id:texto", "operacaoId:texto", "tipo:texto", "estado:texto",
    "tentativas:inteiro", "pedido:json", "resposta:json", "localTipo:texto", "localId:texto", "externoId:texto",
    "criadoEm:instante", "atualizadoEm:instante", "autor:texto"] }
};

/* Colunas que o schema 3 acrescentou a tabelas do schema 2 (no fim da
   aba, sem mover nada). */
var COLUNAS_DESDE = {
  ent_entradas: { origem: 3, loteId: 3, externoEstado: 4 },
  sis_usuarios: { financeiro: 3 },
  fin_insumos: { itemEstoqueId: 4, custoFonte: 4 },
  fin_fichas: { revisar: 4 },
  int_externos: { aplicado: 4, aplicadoEm: 4, aplicacao: 4 }
};

/* Relações, conferidas pela migração e por conferirIntegridade().
   forte: o filho sem pai é erro. fraca: pode apontar para algo que foi
   para a lixeira ou nunca existiu (contato de lead excluída, por exemplo). */
var RELACOES_V2 = [
  { de: "crm_contatos", campo: "leadId", para: "crm_leads", forca: "fraca" },
  { de: "agenda_ciclos", campo: "pacienteId", para: "agenda_pacientes", forca: "forte" },
  { de: "agenda_agendamentos", campo: "pacienteId", para: "agenda_pacientes", forca: "forte" },
  { de: "agenda_condicoes", campo: "pacienteId", para: "agenda_pacientes", forca: "forte" },
  { de: "agenda_pac_maquinas", campo: "pacienteId", para: "agenda_pacientes", forca: "forte" },
  { de: "agenda_pac_maquinas", campo: "maquinaId", para: "agenda_maquinas", forca: "fraca" },
  { de: "agenda_historico", campo: "pacienteId", para: "agenda_pacientes", forca: "forte" },
  { de: "agenda_followups", campo: "pacienteId", para: "agenda_pacientes", forca: "forte" },
  { de: "agenda_pacientes", campo: "categoriaId", para: "agenda_categorias", forca: "fraca" },
  { de: "agenda_pacientes", campo: "crmLeadId", para: "crm_leads", forca: "fraca" },
  { de: "agenda_vindas", campo: "maquinaId", para: "agenda_maquinas", forca: "fraca" },
  { de: "agenda_respostas", campo: "vindaId", para: "agenda_vindas", forca: "forte" },
  { de: "agenda_respostas", campo: "pacienteId", para: "agenda_pacientes", forca: "fraca" },
  { de: "ent_pagamentos", campo: "entradaId", para: "ent_entradas", forca: "forte" },
  { de: "sis_fotos", campo: "usuarioId", para: "sis_usuarios", forca: "fraca" },
  { de: "sis_sessoes", campo: "usuarioId", para: "sis_usuarios", forca: "fraca" },
  { de: "fin_movimentos", campo: "despesaId", para: "fin_despesas", forca: "forte" },
  { de: "fin_despesas", campo: "categoriaId", para: "fin_categorias", forca: "fraca" },
  { de: "fin_despesas", campo: "fornecedorId", para: "fin_fornecedores", forca: "fraca" },
  { de: "fin_despesas", campo: "grupoId", para: "fin_grupos", forca: "fraca" },
  { de: "fin_categorias", campo: "paiId", para: "fin_categorias", forca: "fraca" },
  { de: "fin_orcamentos", campo: "categoriaId", para: "fin_categorias", forca: "fraca" },
  { de: "fin_fichas_versoes", campo: "fichaId", para: "fin_fichas", forca: "forte" },
  { de: "est_saldos", campo: "itemId", para: "est_itens", forca: "forte" },
  { de: "est_movimentos", campo: "itemId", para: "est_itens", forca: "forte" },
  { de: "fin_insumos", campo: "itemEstoqueId", para: "est_itens", forca: "fraca" }
];

var _DEFS = null;

function definicoes() {
  if (_DEFS) return _DEFS;
  _DEFS = {};
  Object.keys(ESQUEMA).forEach(function (nome) {
    var e = ESQUEMA[nome];
    var lista = e.campos.concat(e.raiz ? CAMPOS_RAIZ : []);
    _DEFS[nome] = {
      nome: nome, aba: nome, chave: e.chave, grande: !!e.grande, raiz: !!e.raiz, desde: e.desde || 2,
      campos: lista.map(function (s) { var p = s.split(":"); return { n: p[0], t: p[1] }; })
    };
  });
  return _DEFS;
}

function definicaoTabela(nome) {
  var d = definicoes()[nome];
  if (!d) throw new Error("tabela desconhecida: " + nome);
  return d;
}

function nomesDasTabelas() {
  return Object.keys(ESQUEMA);
}

/* Os campos de negócio de uma raiz — o que o navegador lê e pode mandar.
   Os técnicos (rev, opId, ...) e "legado" ficam de fora. */
function camposDeNegocio(nome) {
  return ESQUEMA[nome].campos.map(function (s) { return s.split(":")[0]; })
    .filter(function (n) { return n !== "legado"; });
}

/* Assinatura do esquema: muda quando muda o desenho, e invalida cabeçalhos
   guardados em cache por versões anteriores do código. */
function assinaturaDoEsquema() {
  return sha256Hex(JSON.stringify(ESQUEMA)).slice(0, 12);
}
