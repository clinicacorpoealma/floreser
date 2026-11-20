/* =====================================================================
   35_ClinicorpContrato — o que a API do Clinicorp oferece, verificado
   ---------------------------------------------------------------------
   Fonte: especificação OpenAPI 3.0.1 publicada em
   https://api.clinicorp.com/api-docs/ (lida em 20/11/2026; base
   https://api.clinicorp.com/rest/v1, autenticação HTTP Basic: usuário =
   "Usuário API", senha = "Token API" — o esquema se chama bearerAuth, mas
   é declarado como scheme "basic", e é isso que seguimos).

   Esta tabela é a matriz de capacidades (docs/CLINICORP.md mostra a
   mesma, por extenso). Regras dela:
   · "efeito" diz se a operação MUDA algo no Clinicorp — e não sai do verbo
     HTTP: /appointment/change_status é GET e muda o status.
   · Só entra em uso o que tem implementado: true. Operação documentada e
     não implementada aparece na matriz com o motivo.
   · Uma leitura só é "verificada" depois de responder com sucesso nesta
     conta (integracao.testar). Escrita nunca é exercitada para testar:
     ela é "documentada, não verificada" até o primeiro uso real autorizado.
   · Não existe listagem completa de pacientes: só a busca de UM paciente.
   · Webhooks: nenhum documentado. Não há recebimento de eventos.
   ===================================================================== */

var CLINICORP_BASE = "https://api.clinicorp.com/rest/v1";

var CLINICORP_OPERACOES = {
  "assinantes.listar": { metodo: "get", caminho: "/group/list_subscribers", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: [], granularidade: "Namespace e SubscriberBussinessUID da conta (ou das unidades da franquia)",
    limitacoes: "Não pede o assinante: serve para descobrir o subscriber_id quando ele não é conhecido. A especificação não diz qual dos dois campos é o subscriber_id; o teste de conexão confirma." },
  "clinicas.listar": { metodo: "get", caminho: "/group/list_subscribers_clinics", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: [], granularidade: "nome, endereço e identificadores das clínicas da conta", limitacoes: "Não pede o assinante; usado só na descoberta." },
  "unidades.listar": { metodo: "get", caminho: "/business/list", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["subscriber_id*"], granularidade: "uma linha por clínica do assinante (id, nome, endereço)",
    limitacoes: "Serve também de teste de conexão: pede só o assinante." },
  "profissionais.listar": { metodo: "get", caminho: "/professional/list_all_professionals", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["fromOnlineScheduling"], granularidade: "id e nome de cada profissional (o CPF que vem junto é descartado)",
    limitacoes: "Não informa a unidade do profissional." },
  "pacientes.buscar": { metodo: "get", caminho: "/patient/get", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["subscriber_id*", "PatientId", "OtherDocumentId", "Phone", "Email", "Name"], granularidade: "UM paciente por consulta",
    limitacoes: "Não há listagem de pacientes. Busca por nome pode achar homônimo: o Alveare nunca vincula por nome; vínculo só é confirmado por uma pessoa." },
  "pacientes.criar": { metodo: "post", caminho: "/patient/create", efeito: "mutacao", direcao: "envio", implementado: true,
    parametros: ["subscriber_id", "Name", "BirthDate", "Sex", "Email", "MobilePhone", "DocumentId", "OtherDocumentId", "Notes", "IgnoreSameName"],
    granularidade: "cria um paciente",
    limitacoes: "A resposta documentada não traz o id do paciente: o vínculo é confirmado em seguida por /patient/get (telefone/e-mail). CPF repetido é recusado pelo Clinicorp. Sem idempotência documentada: resposta perdida vira \"resultado desconhecido\"." },
  "agendamentos.listar": { metodo: "get", caminho: "/appointment/list", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["from*", "to*", "subscriber_id", "businessId", "patientId", "includeAssigns", "includeCanceled", "includeDeleted"],
    granularidade: "um item por agendamento (data UTC, hora inicial/final, profissional, clínica, status, última alteração)",
    limitacoes: "A resposta documentada não traz o id do paciente nem o procedimento: o vínculo com a paciente só sai da consulta filtrada por patientId de uma paciente já vinculada. Desmarcados e excluídos só vêm com includeCanceled/includeDeleted=X." },
  "agendamentos.status": { metodo: "get", caminho: "/appointment/status_list", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["subscriber_id*"], granularidade: "id, descrição e Type (chave estável entre clínicas) de cada status", limitacoes: "" },
  "agendamentos.daPaciente": { metodo: "get", caminho: "/patient/list_appointments", efeito: "leitura", direcao: "consulta", implementado: false,
    parametros: ["PatientId*"], granularidade: "id, data e horários dos agendamentos de um paciente",
    limitacoes: "Não usado: /appointment/list com patientId traz os mesmos itens com status e última alteração." },
  "agendamentos.criar": { metodo: "post", caminho: "/appointment/create_appointment_by_api", efeito: "mutacao", direcao: "envio", implementado: false,
    parametros: ["Patient_PersonId", "fromTime", "toTime", "date", "Clinic_BusinessId", "Dentist_PersonId", "CategoryId"],
    granularidade: "cria um agendamento definitivo",
    limitacoes: "Não implementado nesta versão: não há ambiente de teste do Clinicorp e criar agendamento real só para testar está proibido. A Agenda do Alveare continua a fonte operacional." },
  "agendamentos.mudarStatus": { metodo: "get", caminho: "/appointment/change_status", efeito: "mutacao", direcao: "envio", implementado: false,
    parametros: ["id*", "status_id*"], granularidade: "muda o status de um ou vários agendamentos",
    limitacoes: "É GET, mas MUDA dados. Não implementado: nenhuma chamada a este endereço sai do Alveare." },
  "agendamentos.confirmar": { metodo: "post", caminho: "/appointment/confirm_appointment", efeito: "mutacao", direcao: "envio", implementado: false,
    parametros: ["subscriber_id", "id"], granularidade: "confirma um agendamento", limitacoes: "Não implementado." },
  "agendamentos.cancelar": { metodo: "post", caminho: "/appointment/cancel_appointment", efeito: "mutacao", direcao: "envio", implementado: false,
    parametros: ["subscriber_id", "id"], granularidade: "cancela um agendamento", limitacoes: "Não implementado." },
  "agendamentos.solicitar": { metodo: "post", caminho: "/appointment/create_online_scheduling", efeito: "mutacao", direcao: "envio", implementado: false,
    parametros: ["CodeLink", "PatientName", "date", "fromTime", "toTime"], granularidade: "cria uma SOLICITAÇÃO de agendamento online",
    limitacoes: "Solicitação não é agendamento definitivo. Não implementado." },
  "orcamentos.listar": { metodo: "get", caminho: "/estimates/list", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["subscriber_id*", "from*", "to*", "status", "clinic_id"], granularidade: "um orçamento por tratamento, com status, profissional, valor, desconto e procedimentos",
    limitacoes: "Janela de no máximo 31 dias. O período filtra pela data do DESFECHO de cada status (aberto: criação; aprovado: aprovação; reprovado: reprovação; follow-up: data agendada do retorno). Só o desfecho atual — sem histórico. Resposta pode vir do cache do Clinicorp (Cached: true). Identidade estável: TreatmentId." },
  "orcamentos.obter": { metodo: "get", caminho: "/estimates/get", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["subscriber_id*", "treatment_id*"], granularidade: "um orçamento", limitacoes: "" },
  "recebimentos.listar": { metodo: "get", caminho: "/payment/list", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["subscriber_id*", "from*", "to*", "include_total_amount", "get_amount_with_discounts", "date_type"],
    granularidade: "um item por parcela de pagamento: valor, valor com desconto de taxas (opcional), vencimento, recebido/confirmado e datas, forma, parcela, paciente, tratamento",
    limitacoes: "Sem data de liquidação bancária: lançamento em cartão não prova crédito na conta. O filtro padrão é a data de RECEBIMENTO (date_type vazio); postDate = criação; checkoutDate = pagamento. A descrição do campo id na especificação diz \"id da especialidade\" — a unicidade por parcela precisa ser confirmada com a conta real." },
  "recibos.listar": { metodo: "get", caminho: "/financial/list_receipt", efeito: "leitura", direcao: "consulta", implementado: false,
    parametros: ["subscriber_id*", "from*", "to*", "business_id"], granularidade: "recibos emitidos",
    limitacoes: "Não usado para conciliação: recibo é documento, não recebimento; /payment/list é a fonte dos recebimentos." },
  "financeiro.resumo": { metodo: "get", caminho: "/financial/list_summary", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["subscriber_id*", "from*", "to*", "business_id"], granularidade: "totais do período (vendas, receitas, despesas)",
    limitacoes: "Agregado: só para consulta e conferência. Nunca é somado ao Financeiro do Alveare nem quebrado em despesas." },
  "financeiro.fluxo": { metodo: "get", caminho: "/financial/list_cash_flow", efeito: "leitura", direcao: "consulta", implementado: false,
    parametros: ["subscriber_id*", "from*", "to*", "business_id*"], granularidade: "entradas/saídas agregadas por forma", limitacoes: "Agregado; não usado nesta versão." },
  "crm.campanhas": { metodo: "get", caminho: "/crm/list_active_campaigns", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: ["subscriber_id*"], granularidade: "nome, status e descrição das campanhas ativas",
    limitacoes: "A descrição na especificação está trocada (\"Lista todos os usuários\"); o retorno documentado é de campanhas." },
  "crm.enviarLead": { metodo: "post", caminho: "/crm/add_leads", efeito: "mutacao", direcao: "envio", implementado: true,
    parametros: ["subscriber_id", "Name", "Email", "Phone", "BoardName", "Notes"], granularidade: "acrescenta UM lead a uma campanha (BoardName)",
    limitacoes: "A resposta não traz id do lead, e não existe consulta de leads do CRM do Clinicorp: um envio com resposta perdida não pode ser verificado pela API e vai para revisão manual." },
  "procedimentos.listar": { metodo: "get", caminho: "/procedures/list", efeito: "leitura", direcao: "consulta", implementado: true,
    parametros: [], granularidade: "procedimentos das tabelas de preço (nome, especialidade, tabela)",
    limitacoes: "Sem preço no retorno documentado. Ajuda opcional na Precificação; o Alveare nunca altera preço no Clinicorp." }
};

/* Recursos de sincronização: o que pode ser ligado no painel, e em que
   modo. Só aparecem modos implementados. */
var CLINICORP_RECURSOS = {
  orcamentos: { nome: "Orçamentos", operacao: "orcamentos.listar", tipo: "orcamento", modos: ["desligado", "consulta", "importacao"],
    janelaMaxDias: 31, modulos: ["crm"], futuroDias: 0 },
  agendamentos: { nome: "Agendamentos", operacao: "agendamentos.listar", tipo: "agendamento", modos: ["desligado", "consulta", "importacao"],
    janelaMaxDias: 31, modulos: ["agenda"], futuroDias: 60 },
  recebimentos: { nome: "Recebimentos", operacao: "recebimentos.listar", tipo: "recebimento", modos: ["desligado", "consulta", "importacao"],
    janelaMaxDias: 31, modulos: ["entradas", "financeiro"], futuroDias: 0 },
  pacientes: { nome: "Pacientes", operacao: "pacientes.buscar", tipo: "paciente", modos: ["desligado", "consulta", "envio"],
    janelaMaxDias: 0, modulos: ["crm", "agenda"], semLote: true },
  crm: { nome: "CRM (campanhas)", operacao: "crm.campanhas", tipo: "campanha", modos: ["desligado", "consulta", "envio"],
    janelaMaxDias: 0, modulos: ["crm"], semLote: true },
  catalogo: { nome: "Procedimentos (catálogo)", operacao: "procedimentos.listar", tipo: "procedimento", modos: ["desligado", "consulta"],
    janelaMaxDias: 0, modulos: ["financeiro"], semLote: true },
  resumo: { nome: "Resumo financeiro", operacao: "financeiro.resumo", tipo: "resumo", modos: ["desligado", "consulta"],
    janelaMaxDias: 31, modulos: ["financeiro"], semLote: true }
};

/* Eventos de orçamento que podem virar proposta no CRM. Nunca uma ação
   automática: a proposta é uma pendência que uma pessoa aplica, e aplicar
   passa por conferirLeadCRM. */
var CLINICORP_EVENTOS_ORCAMENTO = {
  APPROVED: { nome: "Orçamento aprovado", etapas: ["venda"], de: ["em_aberto", "fazer_orcamento"] },
  REJECTED: { nome: "Orçamento reprovado", etapas: ["venda_reprovada"], de: ["em_aberto", "fazer_orcamento"] },
  OPEN: { nome: "Orçamento em aberto", etapas: ["em_aberto"], de: ["fazer_orcamento"] }
};

/* ---------------------------------------------------------------------
   Adaptadores: a resposta do Clinicorp no formato do Alveare
   ---------------------------------------------------------------------
   Dinheiro chega como número decimal (1234.5) e vira centavos pelo texto
   com duas casas — nunca por multiplicação solta. Datas "AAAA-MM-DD"
   continuam dia de calendário; instantes continuam instantes. Campo que
   o Clinicorp não manda fica null: nada é deduzido. */

function centavosDoClinicorp(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  if (!isFinite(n)) return null;
  return textoParaCentavos(n.toFixed(2));
}

function diaDoClinicorp(v) {
  if (!v) return null;
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    /* "2026-06-01T03:00:00.000Z" é meia-noite de um fuso: o dia de
       calendário sai do fuso da clínica, não do UTC */
    if (s.length > 10 && /T\d{2}:\d{2}/.test(s)) {
      var d = new Date(s);
      if (!isNaN(d.getTime())) return Utilities.formatDate(d, fusoDaClinica(), "yyyy-MM-dd");
    }
    return s.slice(0, 10);
  }
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
  return null;
}

function marcadoX(v) { return String(v || "").toUpperCase() === "X"; }
function idExterno(v) { return v === null || v === undefined || v === "" ? "" : String(v); }

function normalizarAgendamento(it) {
  if (!it || (it.ItemType && it.ItemType !== "APPOINTMENT")) return null;
  var hora = it.fromTime ? String(it.fromTime) : "";
  return {
    externoId: idExterno(it.id), dia: diaDoClinicorp(it.date) || diaDoClinicorp(it.AtomicDate),
    dataOriginal: it.date ? String(it.date) : "", inicio: hora, fim: it.toTime ? String(it.toTime) : "",
    precisao: hora ? "hora" : "dia", profissionalId: idExterno(it.Dentist_PersonId), unidade: idExterno(it.Clinic_BusinessId),
    statusId: idExterno(it.StatusId), cancelado: marcadoX(it.Canceled), excluido: marcadoX(it.Deleted),
    pacienteNome: String(it.PatientName || "").slice(0, 200),
    /* não documentado na resposta: usado só se vier */
    pacienteExternoId: idExterno(it.PatientId || it.Patient_PersonId),
    procedimento: String(it.Procedures || "").slice(0, 300), sessoes: it.Session === undefined ? null : Number(it.Session),
    alteradoExterno: it.z_LastChange_Date ? String(it.z_LastChange_Date) : ""
  };
}

function normalizarOrcamento(e) {
  if (!e) return null;
  var procs = Array.isArray(e.ProcedureList) ? e.ProcedureList : [];
  return {
    externoId: idExterno(e.TreatmentId || e.id), idDoPlano: idExterno(e.id), status: String(e.Status || ""),
    valor: centavosDoClinicorp(e.Amount), descontoValor: centavosDoClinicorp(e.DiscountAmount),
    descontoPct: e.DiscountPercentage === undefined || e.DiscountPercentage === null ? null : Number(e.DiscountPercentage),
    criadoEm: diaDoClinicorp(e.CreateDate), emitidoEm: diaDoClinicorp(e.Date), aprovadoEm: diaDoClinicorp(e.ApprovedDate),
    reprovadoEm: diaDoClinicorp(e.RejectedDate), followUpEm: diaDoClinicorp(e.FollowUpDate),
    unidade: idExterno(e.BusinessId), profissionalId: idExterno(e.ProfessionalId), profissional: String(e.ProfessionalName || "").slice(0, 120),
    pacienteExternoId: idExterno(e.PatientId), pacienteNome: String(e.PatientName || "").slice(0, 200),
    procedimentos: procs.slice(0, 40).map(function (p) {
      return { descricao: String(p.OperationDescription || "").slice(0, 160), valor: centavosDoClinicorp(p.FinalAmount !== undefined ? p.FinalAmount : p.Amount),
        executado: marcadoX(p.Executed), naoAprovado: marcadoX(p.NotApproved), excluido: marcadoX(p.Deleted) };
    }),
    cacheado: e.Cached === true, alteradoExterno: e.LastChange_Date ? String(e.LastChange_Date) : ""
  };
}

function normalizarRecebimento(p, comLiquido) {
  if (!p) return null;
  return {
    externoId: idExterno(p.id), checkoutId: idExterno(p.PaymentHeaderId), forma: String(p.PaymentForm || "").slice(0, 60),
    valor: centavosDoClinicorp(p.Amount),
    /* só existe quando pedido (get_amount_with_discounts=X): o valor já sem
       as taxas da forma de pagamento. Nunca descontamos taxa de novo. */
    valorSemTaxas: comLiquido ? centavosDoClinicorp(p.AmountWithDiscounts) : null,
    totalDoLancamento: centavosDoClinicorp(p.TotalPostAmount),
    parcela: p.InstallmentNumber === undefined ? null : String(p.InstallmentNumber),
    parcelas: p.InstallmentsCount === undefined ? null : String(p.InstallmentsCount),
    vencimento: diaDoClinicorp(p.DueDate), lancadoEm: diaDoClinicorp(p.PostDate), pagoEm: diaDoClinicorp(p.CheckOutDate || p.PaymentDate),
    recebido: marcadoX(p.PaymentReceived), recebidoEm: diaDoClinicorp(p.ReceivedDate),
    confirmado: marcadoX(p.PaymentConfirmed), confirmadoEm: diaDoClinicorp(p.ConfirmedDate),
    liquidacao: null,
    pacienteExternoId: idExterno(p.PatientId), pacienteNome: String(p.PatientName || "").slice(0, 200),
    tratamentoId: idExterno(p.TreatmentId), unidade: idExterno(p.ReceiverBusinessId),
    alteradoExterno: p.z_LastChange_Date ? String(p.z_LastChange_Date) : ""
  };
}

function normalizarPaciente(p) {
  if (!p || (p.PatientId === undefined && p.id === undefined)) return null;
  return { externoId: idExterno(p.PatientId || p.id), nome: String(p.Name || "").slice(0, 200), email: String(p.Email || "").slice(0, 160),
    telefone: String(p.Phone || p.MobilePhone || "").slice(0, 40), situacao: String(p.Status || "").slice(0, 40),
    nascimento: diaDoClinicorp(p.BirthDate) };
}

function normalizarSimples(tipo, x) {
  if (!x) return null;
  if (tipo === "unidade") return { externoId: idExterno(x.id), nome: String(x.BusinessName || x.Name || "").slice(0, 160) };
  if (tipo === "profissional") return { externoId: idExterno(x.id), nome: String(x.name || x.Name || "").slice(0, 160) };
  if (tipo === "campanha") return { externoId: String(x.Name || "").slice(0, 160), nome: String(x.Name || "").slice(0, 160),
    situacao: String(x.Status || ""), descricao: String(x.Description || "").slice(0, 300) };
  if (tipo === "procedimento") return { externoId: idExterno(x.id), nome: String(x.ProcedureName || "").slice(0, 160),
    especialidade: String(x.ProcedureExpertiseName || "").slice(0, 120), tabela: String(x.PriceListName || "").slice(0, 120) };
  if (tipo === "status") return { externoId: idExterno(x.id), nome: String(x.Description || "").slice(0, 80), chave: String(x.Type || "") };
  return null;
}

function assinaturaExterna(normalizado) {
  return sha256Hex(canonico(normalizado)).slice(0, 20);
}
