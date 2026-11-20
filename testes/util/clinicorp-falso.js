/* Um Clinicorp de mentira, no formato da especificação publicada
   (https://api.clinicorp.com/api-docs/), com dados SINTÉTICOS. Responde no
   lugar da rede pelo sim.http do simulador: nenhum teste e nenhum servidor
   local fala com o Clinicorp de verdade. */
"use strict";

function clinicorpFalso() {
  const st = {
    authRecusada: false, falharEm: null, acaoSomeResposta: false, criarSomeResposta: false, enviarSomeResposta: false,
    pacientes: [{ PatientId: 9001, Name: "Paciente Sintética Um", Phone: "65999990001", Email: "um@exemplo.test" }],
    orcamentos: [], agendamentos: [], pagamentos: [],
    campanhas: [{ Name: "Campanha Sintética", Status: "A", Description: "" }]
  };
  const entre = (d, de, ate) => d && d.slice(0, 10) >= de && d.slice(0, 10) <= ate;
  st.handler = (p) => {
    if (st.authRecusada) return { status: 401, json: { Error: 1, Message: "Unauthorized" } };
    if (st.falharEm && st.falharEm(p)) return { status: 503, texto: "indisponível" };
    const q = p.query;
    switch (p.caminho) {
      case "/group/list_subscribers": return { json: { SubscriberBussinessUID: "uid-sintetico-1", Namespace: "assinante-sintetico" } };
      case "/group/list_subscribers_clinics": return { json: [{ Name: "Clínica Sintética", SubscriberBussinessUID: "uid-sintetico-1", CompanyId: 1 }] };
      case "/business/list": return { json: [{ id: 111, CompanyId: 1, BusinessName: "Clínica Sintética", Name: "Sintética" }] };
      case "/professional/list_all_professionals": return { json: [{ id: 5, name: "Profissional Sintético", cpf: "00000000000" }] };
      case "/appointment/status_list": return { json: [{ id: 1, Description: "Agendado", Type: "SCHEDULED" }] };
      case "/estimates/list": return { json: st.orcamentos.filter((o) => entre(o.Status === "APPROVED" ? o.ApprovedDate : o.CreateDate, q.from, q.to)) };
      case "/appointment/list": return { json: st.agendamentos
        .filter((a) => entre(a.date, q.from, q.to) && (!q.patientId || String(a._paciente) === q.patientId))
        .map((a) => { const c = Object.assign({}, a); delete c._paciente; return c; }) };
      case "/payment/list": return { json: st.pagamentos.filter((x) => entre(x.ReceivedDate, q.from, q.to)) };
      case "/crm/list_active_campaigns": return { json: st.campanhas };
      case "/procedures/list": return { json: [{ id: 77, ProcedureName: "Limpeza de pele", ProcedureExpertiseName: "Estética", PriceListName: "Padrão" }] };
      case "/financial/list_summary": return { json: { From: q.from, To: q.to, BusinessId: 111, TotalSales: 1000.5, TotalIncome: 900, TotalExpenses: 400, Type: "S", values: [] } };
      case "/patient/get": {
        const achado = st.pacientes.filter((x) => (q.Phone && x.Phone === q.Phone) || (q.Email && x.Email === q.Email) || (q.PatientId && String(x.PatientId) === q.PatientId));
        return { json: achado.length === 1 ? achado[0] : (achado.length ? achado : {}) };
      }
      case "/patient/create": {
        st.pacientes.push({ PatientId: 9000 + st.pacientes.length + 1, Name: p.corpo.Name, Phone: p.corpo.MobilePhone, Email: p.corpo.Email || "" });
        if (st.criarSomeResposta) return { lancar: "Timeout: a resposta se perdeu" };
        return { json: { Name: p.corpo.Name } };
      }
      case "/appointment/confirm_appointment":
      case "/appointment/cancel_appointment": {
        const ag = st.agendamentos.find((a) => String(a.id) === String(p.corpo.id));
        if (!ag) return { status: 400, json: { Error: 1, Message: "não encontrado" } };
        if (p.caminho.indexOf("cancel") >= 0) ag.Canceled = "X"; else ag.StatusId = 2;
        if (st.acaoSomeResposta) return { lancar: "Timeout" };
        return { json: [{ id: ag.id, StatusId: ag.StatusId }] };
      }
      case "/crm/add_leads":
        if (st.enviarSomeResposta) return { lancar: "Timeout" };
        return { json: { Message: "Lead adicionado", Error: 0 } };
    }
    return { status: 400, json: { Error: 1, Message: "desconhecido " + p.caminho } };
  };
  return st;
}

module.exports = { clinicorpFalso };
