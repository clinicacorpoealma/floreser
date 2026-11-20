/* =====================================================================
   10_Esquema — o desenho do banco (schema v2)
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
   ===================================================================== */

var CAMPOS_RAIZ = ["rev:inteiro", "opId:texto", "atualizadoEm:instante", "atualizadoPor:texto"];

var ESQUEMA_V2 = {
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
    "criadoEm:instante", "legado:json"], raiz: true },
  ent_pagamentos: { chave: ["id"], campos: ["id:texto", "entradaId:texto", "ordem:inteiro", "metodo:texto",
    "valor:dinheiro", "parcelas:inteiro"] },

  sis_usuarios: { chave: ["id"], campos: ["id:texto", "nome:texto", "usuario:texto", "esquema:texto",
    "senhaHash:texto", "salt:texto", "iteracoes:inteiro", "ativo:booleano", "admin:booleano", "crm:booleano",
    "agenda:booleano", "entradas:booleano", "credencialVersao:inteiro", "criadoEm:instante", "criadoPor:texto",
    "ultimoLogin:instante", "alteradoEm:instante", "legado:json"] },
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
    "iniciadoEm:instante", "concluidoEm:instante", "relatorio:json"] }
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
  { de: "sis_sessoes", campo: "usuarioId", para: "sis_usuarios", forca: "fraca" }
];

var _DEFS = null;

function definicoes() {
  if (_DEFS) return _DEFS;
  _DEFS = {};
  Object.keys(ESQUEMA_V2).forEach(function (nome) {
    var e = ESQUEMA_V2[nome];
    var lista = e.campos.concat(e.raiz ? CAMPOS_RAIZ : []);
    _DEFS[nome] = {
      nome: nome, aba: nome, chave: e.chave, grande: !!e.grande, raiz: !!e.raiz,
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
  return Object.keys(ESQUEMA_V2);
}

/* Os campos de negócio de uma raiz — o que o navegador lê e pode mandar.
   Os técnicos (rev, opId, ...) e "legado" ficam de fora. */
function camposDeNegocio(nome) {
  return ESQUEMA_V2[nome].campos.map(function (s) { return s.split(":")[0]; })
    .filter(function (n) { return n !== "legado"; });
}

/* Assinatura do esquema: muda quando muda o desenho, e invalida cabeçalhos
   guardados em cache por versões anteriores do código. */
function assinaturaDoEsquema() {
  return sha256Hex(JSON.stringify(ESQUEMA_V2)).slice(0, 12);
}
