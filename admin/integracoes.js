/* =====================================================================
   FloreSer · Corpo e Alma — painel → Integrações (Clinicorp)
   ---------------------------------------------------------------------
   A área central da integração. O painel (admin/painel.js) desenha a aba
   chamando FloreSerPainelIntegracoes.tela() e liga os eventos com
   .ligar(corpo, ferramentas). Segue o desenho do painel: HTML em texto,
   com tudo o que vem do servidor passando por esc().

   Nada aqui guarda ou mostra credencial: o Usuário API e o Token API ficam
   nas Script Properties, digitados no editor do Apps Script. A tela só diz
   se estão definidos.

   Partes: Conexão · Recursos · Sincronizar · Pendências · Registros ·
   Vínculos · Matriz de capacidades.
   ===================================================================== */
(function (global) {
  "use strict";

  var F = null;               // { chamar(acao, dados) → Promise<resposta v2>, redesenhar(), esc(), novoId() }
  var sub = "conexao";
  var estado = null, recado = "", ocupado = false;
  var pendencias = null, externos = null, locais = null, achadosClinicorp = null;
  var previas = {}, ultimoResultado = {};
  var filtroExternos = { tipo: "recebimento", semVinculo: true };

  function esc(t) { return F.esc(t === undefined || t === null ? "" : String(t)); }
  function brl(c) { if (c === null || c === undefined || c === "") return "—"; var n = Math.round(Number(c)); return "R$ " + (n / 100).toFixed(2).replace(".", ","); }
  function dataBR(iso) { if (!iso) return "—"; var p = String(iso).slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso; }
  function quando(iso) { if (!iso) return "—"; var d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toLocaleString("pt-BR"); }
  function hojeISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function diasAtras(n) { var d = new Date(Date.now() - n * 86400000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function recadoDe(r) { return (r && r.erro && r.erro.mensagem) || "Sem conexão com o servidor."; }

  var SITUACAO = { ativa: "Configurada", suspensa: "Suspensa", desconectada: "Desconectada", nao_configurada: "Não configurada" };
  var MODO = { desligado: "Desligado", consulta: "Só consulta", importacao: "Consulta e importação", envio: "Consulta e envio" };
  var VERIF = { verificada: "verificada nesta conta", falhou: "falhou no teste", nao_verificada: "ainda não testada",
    documentada_nao_verificada: "escrita documentada — nunca exercitada para testar", nao_implementada: "não implementada" };

  async function carregar() {
    ocupado = true;
    var r = await F.chamar("painel.integracao.estado", {});
    ocupado = false;
    if (r.ok) { estado = r.dados; recado = ""; } else recado = recadoDe(r);
    if (sub === "pendencias") await carregarPendencias();
    if (sub === "registros") await carregarExternos();
    F.redesenhar();
  }
  async function carregarPendencias() { var r = await F.chamar("painel.integracao.pendencias", {}); pendencias = r.ok ? r.dados : null; if (!r.ok) recado = recadoDe(r); }
  async function carregarExternos() { var r = await F.chamar("painel.integracao.externos", filtroExternos); externos = r.ok ? r.dados : null; if (!r.ok) recado = recadoDe(r); }

  /* ------------------------------------------------------------ telas */

  function tela() {
    if (!estado) return '<div class="vazio">' + (recado ? esc(recado) : "Carregando a integração…") + "</div>";
    var e = estado;
    var subs = [["conexao", "Conexão"], ["recursos", "Recursos"], ["sincronizar", "Sincronizar"],
      ["pendencias", "Pendências" + (e.pendenciasAbertas + e.passosIncertos ? " (" + (e.pendenciasAbertas + e.passosIncertos) + ")" : "")],
      ["registros", "Registros"], ["vinculos", "Vínculos"], ["matriz", "Matriz"]];
    var html = '<div class="int-sub">' + subs.map(function (s) {
      return '<button type="button" data-int-sub="' + s[0] + '" class="' + (sub === s[0] ? "on" : "") + '">' + esc(s[1]) + "</button>"; }).join("") + "</div>";
    if (e.situacao === "suspensa" && e.suspensa) {
      html += '<div class="aviso-form">Integração suspensa em ' + esc(quando(e.suspensa.em)) + ": " + esc(e.suspensa.mensagem || e.suspensa.motivo) +
        ". Nenhuma sessão do Alveare foi afetada. Confira o Usuário API e o Token API nas propriedades do script e rode o teste de conexão.</div>";
    }
    if (recado) html += '<div class="aviso-form">' + esc(recado) + "</div>";
    html += ({ conexao: telaConexao, recursos: telaRecursos, sincronizar: telaSincronizar, pendencias: telaPendencias,
      registros: telaRegistros, vinculos: telaVinculos, matriz: telaMatriz }[sub] || telaConexao)();
    return html;
  }

  function telaConexao() {
    var e = estado, c = e.config;
    var html = '<div class="grade">' +
      '<div class="cartao"><div class="rot">Situação</div><div class="val">' + esc(SITUACAO[e.situacao] || e.situacao) + "</div></div>" +
      '<div class="cartao"><div class="rot">Credenciais</div><div class="val">' + (e.credenciais ? "definidas" : "faltando") + "</div></div>" +
      '<div class="cartao"><div class="rot">Último teste</div><div class="val">' + esc(e.verificadaEm ? quando(e.verificadaEm) : "nunca") + "</div></div>" +
      '<div class="cartao"><div class="rot">Agendamento</div><div class="val">' + esc(e.agendamento ? "a cada " + e.agendamento.frequenciaHoras + " h" : "manual") + "</div></div></div>";
    if (!e.credenciais) {
      html += '<p class="nota-privacidade">Para ligar: no editor do Apps Script, Configurações do projeto → Propriedades do script, crie ' +
        "<b>FLORESER_CLINICORP_USUARIO</b> (o “Usuário API”) e <b>FLORESER_CLINICORP_TOKEN</b> (o “Token API”), que ficam no Clinicorp em " +
        "Gerenciar Assinatura → Acesso Externo e Integrações. Nunca a senha de login de uma pessoa. As credenciais não passam por este painel.</p>";
    }
    html += '<div class="titulo-secao">Assinante e unidade</div><div class="ferramentas">' +
      '<label class="rot">Assinante (subscriber_id)<input id="int-assinante" type="text" value="' + esc(c.assinante) + '" autocomplete="off"></label>' +
      '<label class="rot">Unidade (id da clínica)<input id="int-unidade" type="text" inputmode="numeric" value="' + esc(c.unidade) + '" list="int-unidades"></label>' +
      '<datalist id="int-unidades">' + ((e.teste && e.teste.unidades) || []).map(function (u) { return '<option value="' + esc(u.externoId) + '">' + esc(u.nome) + "</option>"; }).join("") + "</datalist>" +
      '<button class="btn-fino" id="int-salvar-conexao">Salvar</button>' +
      '<button class="btn-fino" id="int-testar"' + (ocupado ? " disabled" : "") + ">Testar conexão</button></div>";
    if (e.descoberta) {
      var d = e.descoberta;
      html += '<div class="titulo-secao">Assinante encontrado na sua conta</div>';
      if (d.candidatos.length) {
        html += '<p class="nota-privacidade">O Clinicorp devolveu estes identificadores. Clique em um: ele é salvo como assinante e o teste completo roda em seguida. Se o teste falhar, tente o outro.</p>' +
          '<div class="ferramentas">' + d.candidatos.map(function (c) {
            return '<button class="btn-fino" data-int-usar="' + esc(c.valor) + '">Usar ' + esc(c.valor) + " <small>(" + esc(c.rotulo) + ")</small></button>"; }).join("") + "</div>";
      } else {
        html += '<p class="nota-privacidade">O Clinicorp não devolveu nenhum identificador' + (d.erro ? " (" + esc(d.erro) + ")" : "") +
          ". Confira o Usuário API e o Token API, ou tente o nome da conta que aparece no endereço do Clinicorp.</p>";
      }
    }
    if (!c.assinante && !e.descoberta) {
      html += '<p class="nota-privacidade">Não sabe o assinante (subscriber_id)? Deixe o campo vazio e clique em Testar conexão: o Alveare pergunta ao Clinicorp.</p>';
    }
    if (e.teste) {
      html += '<p class="nota-privacidade">' + (e.teste.conectou ? "Conectou. " : "Não conectou. ") + e.teste.verificadas + " de " + e.teste.total +
        " leituras responderam. Conectar não prova tudo: veja na Matriz o que foi verificado. Nenhuma escrita foi feita para testar.</p>";
    }
    html += '<div class="titulo-secao">Sincronização periódica (opcional)</div><div class="ferramentas"><select id="int-frequencia">' +
      [0, 1, 2, 4, 6, 12, 24].map(function (h) { return '<option value="' + h + '"' + (Number(c.frequenciaHoras || 0) === h ? " selected" : "") + ">" + (h ? "a cada " + h + " h" : "desligada") + "</option>"; }).join("") +
      '</select><button class="btn-fino" id="int-agendar">Aplicar</button></div>' +
      '<p class="nota-privacidade">A rotina agendada roda com a identidade “Sincronização agendada (Clinicorp)”, só importa recursos em modo importação (depois da primeira importação manual) e nunca cria entrada, lead ou agendamento.</p>';
    html += '<div class="titulo-secao">Interromper</div><div class="ferramentas">' +
      (e.situacao === "suspensa" || e.situacao === "desconectada"
        ? '<button class="btn-fino" data-int-suspender="retomar">Retomar</button>'
        : '<button class="btn-fino" data-int-suspender="suspender">Suspender</button>') +
      '<button class="btn-fino perigo" data-int-suspender="desconectar">Desconectar</button></div>' +
      '<p class="nota-privacidade">Desconectar desliga todos os recursos e o agendamento. Nada importado é apagado; os vínculos ficam. Para remover as credenciais, apague as propriedades no editor.</p>';
    return html;
  }

  function telaRecursos() {
    var e = estado, c = e.config;
    var html = '<p class="nota-privacidade">Só aparecem os modos implementados para cada recurso. Leituras primeiro; envio ao Clinicorp só quando ligado aqui, e cada envio é uma ação explícita.</p>' +
      '<table class="tabela"><thead><tr><th>Recurso</th><th>Módulos</th><th>Modo</th></tr></thead><tbody>' +
      e.recursos.map(function (r) {
        return "<tr><td>" + esc(r.nome) + "</td><td>" + esc(r.modulos.join(", ")) + '</td><td><select data-int-recurso="' + esc(r.id) + '">' +
          r.modos.map(function (m) { return '<option value="' + m + '"' + (r.modo === m ? " selected" : "") + ">" + esc(MODO[m] || m) + "</option>"; }).join("") + "</select></td></tr>";
      }).join("") + "</tbody></table>";
    html += '<div class="titulo-secao">Orçamentos → CRM</div><p class="nota-privacidade">“Propor” abre uma pendência para uma pessoa aplicar no CRM, passando pelas regras do funil. Nunca é automático. Orçamento nunca vira recebimento.</p>' +
      '<table class="tabela"><thead><tr><th>Evento no Clinicorp</th><th>Etapa proposta</th><th>Regra</th></tr></thead><tbody>' +
      e.eventosOrcamento.map(function (ev) {
        return "<tr><td>" + esc(ev.nome) + "</td><td>" + esc(ev.etapa) + '</td><td><select data-int-evento="' + esc(ev.status) + '">' +
          '<option value="contexto"' + (ev.regra === "contexto" ? " selected" : "") + ">Só contexto</option>" +
          '<option value="propor"' + (ev.regra === "propor" ? " selected" : "") + ">Propor no CRM</option></select></td></tr>";
      }).join("") + "</tbody></table>";
    html += '<div class="titulo-secao">Detalhes</div><div class="ferramentas">' +
      '<label class="rot">Reconsultar os últimos (dias)<input id="int-janela" type="number" min="0" max="31" value="' + esc(c.janelaReconsultaDias) + '"></label>' +
      '<label class="rot">Recebimentos filtrados por<select id="int-recebimentos-por">' +
      [["", "data de recebimento"], ["postDate", "data de lançamento"], ["checkoutDate", "data de pagamento"]].map(function (o) {
        return '<option value="' + o[0] + '"' + ((c.recebimentosPor || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
      '<label class="rot">Campanha padrão do CRM<input id="int-campanha" type="text" value="' + esc(c.campanhaPadrao) + '"></label>' +
      '<label class="marcar"><input type="checkbox" id="int-sem-taxas"' + (c.valorSemTaxas ? " checked" : "") + "> Trazer também o valor sem as taxas (só consulta; a entrada usa o valor bruto)</label>" +
      '<button class="btn-fino" id="int-salvar-recursos">Salvar recursos</button></div>';
    return html;
  }

  function telaSincronizar() {
    var e = estado;
    var lotes = e.recursos.filter(function (r) { return r.lote || r.id === "catalogo" || r.id === "crm"; });
    var html = '<p class="nota-privacidade">A primeira importação de cada recurso exige a prévia do mesmo período. Depois, sem datas, vale o incremental: da última data importada menos a janela de reconsulta. Uma sincronização longa continua sozinha, janela por janela; se for interrompida, o ponto fica guardado.</p>';
    lotes.forEach(function (r) {
      var res = ultimoResultado[r.id];
      var prim = !(e.ultimas || {})[r.id];
      html += '<div class="cartao-usuario"><div class="topo-usuario"><b>' + esc(r.nome) + "</b> · " + esc(MODO[r.modo] || r.modo) +
        ((e.ultimas || {})[r.id] ? " · importado até " + esc(dataBR(e.ultimas[r.id].ate)) : " · nunca importado") + (r.travado ? " · em andamento" : "") + "</div>";
      if (r.modo !== "desligado") {
        html += '<div class="ferramentas">' + (r.lote ? '<input type="date" data-int-de="' + esc(r.id) + '" value="' + esc(diasAtras(30)) + '">' +
          '<input type="date" data-int-ate="' + esc(r.id) + '" value="' + esc(hojeISO()) + '">' : "") +
          '<button class="btn-fino" data-int-previa="' + esc(r.id) + '"' + (ocupado ? " disabled" : "") + ">Prévia</button>" +
          ((r.modo === "importacao" || !r.lote) ? '<button class="btn-fino" data-int-importar="' + esc(r.id) + '"' + (ocupado || (prim && r.lote && !previas[r.id]) ? " disabled" : "") + ">" +
            (prim && r.lote ? "Importar o período da prévia" : "Importar") + "</button>" : "") +
          (r.lote && !prim && r.modo === "importacao" ? '<button class="btn-fino" data-int-incremental="' + esc(r.id) + '"' + (ocupado ? " disabled" : "") + ">Atualizar (incremental)</button>" : "") +
          "</div>";
      }
      if (res) html += resumoExecucao(res);
      html += "</div>";
    });
    html += '<div class="titulo-secao">Histórico</div><table class="tabela"><thead><tr><th>Quando</th><th>Recurso</th><th>Modo</th><th>Período</th><th>Situação</th><th>Contagens</th></tr></thead><tbody>' +
      (e.execucoes || []).map(function (x) {
        var c = x.contagens || {};
        return "<tr><td>" + esc(quando(x.iniciadoEm)) + "<br><small>" + esc(x.autor) + (x.origem === "agendada" ? " · agendada" : "") + "</small></td><td>" + esc(x.recurso) + "</td><td>" + esc(x.modo) +
          "</td><td>" + esc(dataBR(x.de)) + " a " + esc(dataBR(x.ate)) + "</td><td>" + esc(x.estado) + (x.erros && x.erros.length ? "<br><small>" + esc(x.erros[x.erros.length - 1].mensagem) + "</small>" : "") +
          "</td><td>" + esc((c.novos || 0) + " novos · " + (c.alterados || 0) + " alterados · " + (c.iguais || 0) + " iguais" + (c.ausentes ? " · " + c.ausentes + " ausentes" : "") + (c.pendencias ? " · " + c.pendencias + " pendência(s)" : "")) + "</td></tr>";
      }).join("") + "</tbody></table>";
    return html;
  }

  function resumoExecucao(x) {
    var c = x.contagens || {};
    var html = '<p class="nota-privacidade">' + esc(x.modo === "previa" ? "Prévia" : "Importação") + " " + esc(x.estado) + " (" + esc(dataBR(x.de)) + " a " + esc(dataBR(x.ate)) +
      ", " + (x.janelas || "?") + " janela(s)): " + (c.recebidos || 0) + " recebido(s) do Clinicorp — " + (c.novos || 0) + " novo(s), " + (c.alterados || 0) + " alterado(s), " +
      (c.iguais || 0) + " igual(is)" + (c.ausentes ? ", " + c.ausentes + " ausente(s) da resposta (não é exclusão)" : "") + (c.pendencias ? ", " + c.pendencias + " pendência(s)" : "") + ".";
    if (x.erros && x.erros.length) html += " Último problema: " + esc(x.erros[x.erros.length - 1].mensagem) + ".";
    html += "</p>";
    if (x.amostra && x.amostra.length) html += '<ul class="int-amostra">' + x.amostra.map(function (a) { return "<li>" + esc(a.texto) + "</li>"; }).join("") + "</ul>";
    return html;
  }

  function telaPendencias() {
    if (!pendencias) return '<div class="vazio">Carregando pendências…</div>';
    var html = "";
    if (pendencias.passos.length) {
      html += '<div class="titulo-secao">Envios ao Clinicorp sem resultado claro</div>';
      pendencias.passos.forEach(function (p) {
        html += '<div class="cartao-usuario"><div class="topo-usuario"><b>' + esc(p.tipo === "pacientes.criar" ? "Criar paciente" : "Enviar lead para campanha") + "</b> · " + esc(p.estado) +
          " · " + esc(quando(p.atualizadoEm)) + " · tentativa " + esc(p.tentativas) + "</div>" +
          '<p class="nota-privacidade">' + esc(p.pedido ? [p.pedido.nome, p.pedido.campanha].filter(Boolean).join(" · ") : "") + (p.resposta && p.resposta.mensagem ? " — " + esc(p.resposta.mensagem) : "") + "</p>" +
          '<div class="ferramentas">' + (p.tipo === "pacientes.criar" && p.estado !== "confirmado_sem_id" ? '<button class="btn-fino" data-int-passo="verificar" data-id="' + esc(p.id) + '">Verificar no Clinicorp</button>' : "") +
          '<input type="text" placeholder="id do paciente (opcional)" data-int-passo-ext="' + esc(p.id) + '">' +
          '<button class="btn-fino" data-int-passo="confirmar" data-id="' + esc(p.id) + '">Confirmar à mão</button>' +
          '<button class="btn-fino" data-int-passo="reenviar" data-id="' + esc(p.id) + '">Reenviar</button>' +
          '<button class="btn-fino perigo" data-int-passo="abandonar" data-id="' + esc(p.id) + '">Abandonar</button></div></div>';
      });
    }
    html += '<div class="titulo-secao">Pendências abertas</div>';
    if (!pendencias.pendencias.length) return html + '<div class="vazio">Nenhuma pendência aberta.</div>';
    pendencias.pendencias.forEach(function (p) {
      var acoes = "";
      if (p.tipo === "proposta_etapa") acoes = '<button class="btn-fino" data-int-resolver="aplicar" data-id="' + esc(p.id) + '">Aplicar no CRM</button>';
      if (p.tipo === "conciliacao") {
        var cands = (p.detalhes && p.detalhes.candidatas) || [];
        acoes = '<select data-int-candidata="' + esc(p.id) + '">' + cands.map(function (c) { return '<option value="' + esc(c) + '">entrada ' + esc(c) + "</option>"; }).join("") + "</select>" +
          '<button class="btn-fino" data-int-resolver="vincular" data-id="' + esc(p.id) + '">Vincular</button>' +
          '<select data-int-metodo="' + esc(p.id) + '"><option value="">forma: automática</option><option value="credito">Crédito</option><option value="debito">Débito</option><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="boleto">Boleto</option></select>' +
          '<button class="btn-fino" data-int-resolver="importar" data-id="' + esc(p.id) + '">Importar como nova entrada</button>';
      }
      if (p.tipo === "divergencia") acoes = '<button class="btn-fino" data-int-resolver="ciente" data-id="' + esc(p.id) + '">Ciente</button><button class="btn-fino perigo" data-int-resolver="desvincular" data-id="' + esc(p.id) + '">Desfazer vínculo</button>';
      if (p.tipo === "vinculo_pendente") acoes = '<input type="text" placeholder="id do paciente" data-int-ext="' + esc(p.id) + '"><button class="btn-fino" data-int-resolver="vincular" data-id="' + esc(p.id) + '">Vincular</button>';
      html += '<div class="cartao-usuario"><div class="topo-usuario"><b>' + esc(p.tipo.replace("_", " ")) + "</b> · " + esc(quando(p.criadoEm)) + "</div>" +
        '<p class="nota-privacidade">' + esc(p.resumo) + "</p>" + '<div class="ferramentas">' + acoes +
        (p.tipo !== "resultado_desconhecido" ? '<button class="btn-fino" data-int-resolver="ignorar" data-id="' + esc(p.id) + '">Ignorar</button>' : "") + "</div></div>";
    });
    return html;
  }

  function telaRegistros() {
    var html = '<div class="ferramentas"><select id="int-ext-tipo">' +
      [["recebimento", "Recebimentos"], ["orcamento", "Orçamentos"], ["agendamento", "Agendamentos"], ["procedimento", "Procedimentos"], ["campanha", "Campanhas"], ["resumo", "Resumos"]].map(function (t) {
        return '<option value="' + t[0] + '"' + (filtroExternos.tipo === t[0] ? " selected" : "") + ">" + t[1] + "</option>"; }).join("") +
      '</select><label class="marcar"><input type="checkbox" id="int-ext-sem"' + (filtroExternos.semVinculo ? " checked" : "") + "> só sem vínculo</label>" +
      '<button class="btn-fino" id="int-ext-atualizar">Atualizar</button></div>' +
      '<p class="nota-privacidade">Registros vindos do Clinicorp, com os campos de lá preservados. A nota local é do Alveare e sobrevive às atualizações. Ausente da resposta não quer dizer excluído.</p>';
    if (!externos) return html + '<div class="vazio">Carregando…</div>';
    if (!externos.externos.length) return html + '<div class="vazio">Nada aqui.</div>';
    html += '<table class="tabela"><thead><tr><th>Registro</th><th>Detalhes</th><th>Vínculo</th><th></th></tr></thead><tbody>';
    externos.externos.forEach(function (x) {
      var d = x.dados || {}, titulo = "", det = "";
      if (x.tipo === "recebimento") { titulo = (d.pacienteNome || "paciente") + " · " + brl(d.valor); det = [d.forma, d.recebido ? "recebido " + dataBR(d.recebidoEm) : "não recebido", d.confirmado ? "confirmado" : "", d.parcela ? "parcela " + d.parcela + (d.parcelas ? "/" + d.parcelas : "") : "", "liquidação: não informada"].filter(Boolean).join(" · "); }
      else if (x.tipo === "orcamento") { titulo = (d.pacienteNome || "paciente") + " · " + d.status + " · " + brl(d.valor); det = (d.procedimentos || []).map(function (p) { return p.descricao; }).slice(0, 4).join(", "); }
      else if (x.tipo === "agendamento") { titulo = dataBR(d.dia) + (d.inicio ? " " + d.inicio + "–" + d.fim : " (dia inteiro)") + " · " + (d.pacienteNome || ""); det = [d.cancelado ? "desmarcado" : "", d.excluido ? "excluído" : "", d.pacienteExternoId ? "paciente " + d.pacienteExternoId : "paciente não identificado"].filter(Boolean).join(" · "); }
      else { titulo = d.nome || x.externoId; det = d.especialidade || d.descricao || (d.vendas !== undefined ? "vendas " + brl(d.vendas) + " · despesas " + brl(d.despesas) : ""); }
      if (x.ausenteDesde) det += " · ausente da resposta desde " + quando(x.ausenteDesde);
      var acoes = "";
      if (x.tipo === "recebimento" && !x.vinculo) {
        acoes = '<button class="btn-fino" data-int-rec-importar="' + esc(x.externoId) + '">Importar como entrada</button>' +
          '<input type="text" placeholder="id da entrada" data-int-rec-entrada="' + esc(x.externoId) + '"><button class="btn-fino" data-int-rec-vincular="' + esc(x.externoId) + '">Vincular</button>';
      }
      acoes += '<input type="text" placeholder="nota local" value="' + esc((x.complemento || {}).notas || "") + '" data-int-nota="' + esc(x.id) + '" data-rev="' + esc(x._rev) + '">';
      html += "<tr><td>" + esc(titulo) + "<br><small>id " + esc(x.externoId) + "</small></td><td>" + esc(det) + "</td><td>" +
        esc(x.vinculo ? x.vinculo.localTipo + " " + x.vinculo.localId : "—") + "</td><td>" + acoes + "</td></tr>";
    });
    return html + "</tbody></table>" + (externos.total > externos.externos.length ? '<p class="nota-privacidade">Mostrando ' + externos.externos.length + " de " + externos.total + ".</p>" : "");
  }

  function telaVinculos() {
    var e = estado;
    var pacientesModo = (e.recursos.filter(function (r) { return r.id === "pacientes"; })[0] || {}).modo;
    var crmModo = (e.recursos.filter(function (r) { return r.id === "crm"; })[0] || {}).modo;
    var html = '<p class="nota-privacidade">Vínculos são sempre explícitos: o Alveare nunca liga uma lead ou paciente a um cadastro do Clinicorp pelo nome. Procure no Clinicorp por id, telefone, e-mail ou CPF, confira e vincule.</p>' +
      '<div class="titulo-secao">1. Ficha do Alveare</div><div class="ferramentas"><select id="int-loc-tipo"><option value="lead">Lead do CRM</option><option value="paciente">Paciente da Agenda</option></select>' +
      '<input type="search" id="int-loc-busca" placeholder="nome ou telefone"><button class="btn-fino" id="int-loc-buscar">Buscar</button></div>';
    if (locais) {
      html += locais.length ? '<table class="tabela"><tbody>' + locais.map(function (l) {
        return '<tr><td><label class="marcar"><input type="radio" name="int-loc" value="' + esc(l.id) + '"> ' + esc(l.nome) + "</label></td><td>" + esc(l.detalhe) + "</td><td>" +
          esc(l.vinculo ? "vinculada: " + l.vinculo : "") + "</td></tr>"; }).join("") + "</tbody></table>" : '<div class="vazio">Nenhuma ficha encontrada.</div>';
    }
    html += '<div class="titulo-secao">2. Paciente no Clinicorp</div>';
    if (pacientesModo === "desligado") html += '<p class="nota-privacidade">Ligue Pacientes (consulta) em Recursos para buscar no Clinicorp. Sem isso, informe o id do paciente à mão.</p>';
    else html += '<div class="ferramentas"><select id="int-pac-criterio"><option value="telefone">Telefone</option><option value="email">E-mail</option><option value="id">Id do paciente</option><option value="cpf">CPF</option></select>' +
      '<input type="text" id="int-pac-valor" autocomplete="off"><button class="btn-fino" id="int-pac-buscar">Buscar no Clinicorp</button></div>';
    if (achadosClinicorp) {
      html += achadosClinicorp.length ? '<table class="tabela"><tbody>' + achadosClinicorp.map(function (p) {
        return '<tr><td><label class="marcar"><input type="radio" name="int-pac" value="' + esc(p.externoId) + '"> ' + esc(p.nome) + "</label></td><td>" + esc([p.telefone, p.email, p.nascimento ? dataBR(p.nascimento) : ""].filter(Boolean).join(" · ")) + "</td><td>id " + esc(p.externoId) + "</td></tr>"; }).join("") + "</tbody></table>"
        : '<div class="vazio">Nenhum paciente com esse dado no Clinicorp.</div>';
    }
    html += '<div class="ferramentas"><input type="text" id="int-pac-manual" placeholder="ou o id do paciente à mão"><button class="btn-fino" id="int-vincular">Vincular</button></div>';
    html += '<div class="titulo-secao">Enviar ao Clinicorp (lead selecionada acima)</div>';
    html += '<div class="ferramentas">' +
      (pacientesModo === "envio" ? '<input type="email" id="int-env-email" placeholder="e-mail (opcional)"><input type="text" id="int-env-cpf" placeholder="CPF (opcional, não é guardado)"><button class="btn-fino" id="int-criar-paciente">Criar paciente no Clinicorp</button>' :
        '<span class="nota-privacidade">Criar paciente exige Pacientes em “Consulta e envio”.</span>') +
      (crmModo === "envio" ? '<input type="text" id="int-env-campanha" placeholder="campanha" value="' + esc(e.config.campanhaPadrao || "") + '"><button class="btn-fino" id="int-enviar-lead">Enviar lead para a campanha</button>' :
        '<span class="nota-privacidade">Enviar lead exige CRM (campanhas) em “Consulta e envio”.</span>') + "</div>" +
      '<p class="nota-privacidade">Cada envio é registrado em passos. Se a resposta se perder, fica “resultado desconhecido” e não é reenviado sem uma decisão em Pendências.</p>';
    return html;
  }

  function telaMatriz() {
    return '<p class="nota-privacidade">O que a API do Clinicorp oferece, conforme a especificação publicada, e o que foi verificado nesta conta. “Efeito” não sai do verbo HTTP: há GET que muda dados.</p>' +
      '<table class="tabela"><thead><tr><th>Operação</th><th>Endereço</th><th>Efeito · direção</th><th>Granularidade</th><th>Limitações</th><th>Verificação</th></tr></thead><tbody>' +
      estado.matriz.map(function (m) {
        return "<tr><td>" + esc(m.id) + "</td><td><code>" + esc(m.metodo + " " + m.caminho) + "</code><br><small>" + esc(m.parametros.join(", ")) + "</small></td><td>" +
          esc((m.efeito === "mutacao" ? "muda dados" : "leitura") + " · " + m.direcao) + "</td><td>" + esc(m.granularidade) + "</td><td>" + esc(m.limitacoes) + "</td><td>" +
          esc(VERIF[m.verificacao] || m.verificacao) + (m.verificadaEm ? "<br><small>" + esc(quando(m.verificadaEm)) + "</small>" : "") + (m.detalhe ? "<br><small>" + esc(m.detalhe) + "</small>" : "") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* ------------------------------------------------------------ ações */

  async function acao(acaoServidor, dados, depois) {
    ocupado = true; recado = ""; F.redesenhar();
    var r = await F.chamar(acaoServidor, dados);
    ocupado = false;
    if (!r.ok) { recado = recadoDe(r); F.redesenhar(); return null; }
    if (depois) await depois(r.dados);
    await carregar();
    return r.dados;
  }

  async function sincronizar(recurso, modo, extra) {
    ocupado = true; recado = ""; F.redesenhar();
    var dados = Object.assign({ recurso: recurso, modo: modo }, extra || {});
    var r = await F.chamar("painel.integracao.executar", dados);
    /* interrompida pelo tempo do pedido: continua sozinha, janela por janela */
    var voltas = 0;
    while (r.ok && r.dados.estado === "interrompida" && voltas++ < 40 &&
      !(r.dados.erros || []).some(function (e) { return e.tipo === "limite" || e.tipo === "indisponivel" || e.tipo === "autenticacao"; })) {
      ultimoResultado[recurso] = r.dados; F.redesenhar();
      r = await F.chamar("painel.integracao.executar", { recurso: recurso, modo: modo, retomar: true, execucaoId: r.dados.id });
    }
    ocupado = false;
    if (!r.ok) { recado = recadoDe(r); F.redesenhar(); return; }
    ultimoResultado[recurso] = r.dados;
    if (modo === "previa" && r.dados.estado === "concluida") previas[recurso] = r.dados;
    await carregar();
  }

  function valorDe(corpo, sel) { var x = corpo.querySelector(sel); return x ? x.value : ""; }

  function ligar(corpo) {
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-sub]"), function (b) {
      b.addEventListener("click", async function () {
        sub = b.getAttribute("data-int-sub");
        F.redesenhar();
        if (sub === "pendencias") { await carregarPendencias(); F.redesenhar(); }
        if (sub === "registros") { await carregarExternos(); F.redesenhar(); }
      });
    });
    var on = function (id, fn) { var x = corpo.querySelector("#" + id); if (x) x.addEventListener("click", fn); };
    on("int-salvar-conexao", function () { acao("painel.integracao.configurar", { assinante: valorDe(corpo, "#int-assinante").trim(), unidade: valorDe(corpo, "#int-unidade").trim() }); });
    on("int-testar", function () {
      ocupado = true; F.redesenhar();
      F.chamar("painel.integracao.testar", {}).then(function (r) { ocupado = false; if (r.ok) { estado = r.dados; recado = ""; } else recado = recadoDe(r); F.redesenhar(); });
    });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-usar]"), function (b) {
      b.addEventListener("click", async function () {
        ocupado = true; F.redesenhar();
        var r = await F.chamar("painel.integracao.configurar", { assinante: b.getAttribute("data-int-usar") });
        if (!r.ok) { ocupado = false; recado = recadoDe(r); F.redesenhar(); return; }
        var t = await F.chamar("painel.integracao.testar", {});
        ocupado = false;
        if (t.ok) { estado = t.dados; recado = ""; } else recado = recadoDe(t);
        F.redesenhar();
      });
    });
    on("int-agendar", function () { acao("painel.integracao.agendar", { frequenciaHoras: Number(valorDe(corpo, "#int-frequencia")) }); });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-suspender]"), function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-int-suspender");
        if (a === "desconectar" && !global.confirm("Desconectar o Clinicorp? Todos os recursos são desligados; nada importado é apagado.")) return;
        acao("painel.integracao.suspender", { acao: a });
      });
    });
    on("int-salvar-recursos", function () {
      var recursos = {}, eventos = {};
      Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-recurso]"), function (s) { recursos[s.getAttribute("data-int-recurso")] = { modo: s.value }; });
      Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-evento]"), function (s) { eventos[s.getAttribute("data-int-evento")] = s.value; });
      acao("painel.integracao.configurar", { recursos: recursos, eventosOrcamento: eventos, janelaReconsultaDias: Number(valorDe(corpo, "#int-janela")) || 0,
        recebimentosPor: valorDe(corpo, "#int-recebimentos-por"), campanhaPadrao: valorDe(corpo, "#int-campanha").trim(),
        valorSemTaxas: !!(corpo.querySelector("#int-sem-taxas") || {}).checked });
    });
    var periodo = function (r) { var de = corpo.querySelector('[data-int-de="' + r + '"]'), ate = corpo.querySelector('[data-int-ate="' + r + '"]'); return de ? { de: de.value, ate: ate.value } : {}; };
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-previa]"), function (b) {
      b.addEventListener("click", function () { var r = b.getAttribute("data-int-previa"); sincronizar(r, "previa", periodo(r)); });
    });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-importar]"), function (b) {
      b.addEventListener("click", function () {
        var r = b.getAttribute("data-int-importar"), p = previas[r];
        var extra = p ? { de: p.de, ate: p.ate, previaId: p.id } : periodo(r);
        if (p && !global.confirm("Importar " + r + " de " + dataBR(p.de) + " a " + dataBR(p.ate) + "? A prévia mostrou " + ((p.contagens || {}).novos || 0) + " novo(s) e " + ((p.contagens || {}).alterados || 0) + " alterado(s).")) return;
        sincronizar(r, "importacao", extra);
      });
    });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-incremental]"), function (b) {
      b.addEventListener("click", function () { sincronizar(b.getAttribute("data-int-incremental"), "importacao", {}); });
    });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-resolver]"), function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id"), decisao = b.getAttribute("data-int-resolver");
        var dados = { operacaoId: F.novoId("int-"), id: id, decisao: decisao };
        if (decisao === "vincular") { var c = corpo.querySelector('[data-int-candidata="' + id + '"]'); if (c) dados.entradaId = c.value; var x = corpo.querySelector('[data-int-ext="' + id + '"]'); if (x) dados.externoId = x.value.trim(); }
        if (decisao === "importar") { var m = corpo.querySelector('[data-int-metodo="' + id + '"]'); if (m && m.value) dados.metodo = m.value; }
        acao("painel.integracao.resolver", dados, carregarPendencias);
      });
    });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-passo]"), function (b) {
      b.addEventListener("click", function () {
        var d = b.getAttribute("data-int-passo"), id = b.getAttribute("data-id");
        if (d === "reenviar" && !global.confirm("Reenviar ao Clinicorp? Confira antes que o primeiro envio não chegou — a API não garante que não vai duplicar.")) return;
        var ext = corpo.querySelector('[data-int-passo-ext="' + id + '"]');
        acao("painel.integracao.decidirPasso", { passoId: id, decisao: d, externoId: ext ? ext.value.trim() : "" }, function (r) { if (r && r.mensagem) recado = r.mensagem; return carregarPendencias(); });
      });
    });
    on("int-ext-atualizar", async function () {
      filtroExternos = { tipo: valorDe(corpo, "#int-ext-tipo"), semVinculo: !!(corpo.querySelector("#int-ext-sem") || {}).checked };
      await carregarExternos(); F.redesenhar();
    });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-rec-importar]"), function (b) {
      b.addEventListener("click", function () { acao("painel.integracao.reconciliar", { operacaoId: F.novoId("int-"), acao: "importar", externoId: b.getAttribute("data-int-rec-importar") }, carregarExternos); });
    });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-rec-vincular]"), function (b) {
      b.addEventListener("click", function () {
        var ext = b.getAttribute("data-int-rec-vincular"), alvo = corpo.querySelector('[data-int-rec-entrada="' + ext + '"]');
        acao("painel.integracao.reconciliar", { operacaoId: F.novoId("int-"), acao: "vincular", externoId: ext, entradaId: alvo ? alvo.value.trim() : "" }, carregarExternos);
      });
    });
    Array.prototype.forEach.call(corpo.querySelectorAll("[data-int-nota]"), function (inp) {
      inp.addEventListener("change", function () {
        acao("painel.integracao.complemento", { operacaoId: F.novoId("int-"), id: inp.getAttribute("data-int-nota"), revBase: Number(inp.getAttribute("data-rev")), complemento: { notas: inp.value } }, carregarExternos);
      });
    });
    on("int-loc-buscar", async function () {
      var r = await F.chamar("painel.integracao.locais", { tipo: valorDe(corpo, "#int-loc-tipo"), busca: valorDe(corpo, "#int-loc-busca") });
      locais = r.ok ? r.dados.locais : []; if (!r.ok) recado = recadoDe(r); F.redesenhar();
    });
    on("int-pac-buscar", async function () {
      ocupado = true; F.redesenhar();
      var r = await F.chamar("painel.integracao.buscarPaciente", { criterio: valorDe(corpo, "#int-pac-criterio"), valor: valorDe(corpo, "#int-pac-valor") });
      ocupado = false; achadosClinicorp = r.ok ? r.dados.pacientes : null; recado = r.ok ? "" : recadoDe(r); F.redesenhar();
    });
    var localEscolhido = function () { var x = corpo.querySelector('input[name="int-loc"]:checked'); return x ? x.value : ""; };
    on("int-vincular", function () {
      var pac = corpo.querySelector('input[name="int-pac"]:checked');
      var ext = valorDe(corpo, "#int-pac-manual").trim() || (pac ? pac.value : "");
      var local = localEscolhido();
      if (!local || !ext) { recado = "Escolha a ficha do Alveare e o paciente do Clinicorp."; F.redesenhar(); return; }
      acao("painel.integracao.vincular", { operacaoId: F.novoId("int-"), tipo: "paciente", externoId: ext, localTipo: valorDe(corpo, "#int-loc-tipo") || "lead", localId: local },
        function () { recado = "Vínculo criado."; locais = null; achadosClinicorp = null; });
    });
    on("int-criar-paciente", function () {
      var local = localEscolhido();
      if (!local || valorDe(corpo, "#int-loc-tipo") !== "lead") { recado = "Escolha uma lead do CRM acima."; F.redesenhar(); return; }
      if (!global.confirm("Criar este paciente no Clinicorp? É uma escrita real na conta da clínica.")) return;
      acao("painel.integracao.criarPaciente", { operacaoId: F.novoId("int-"), leadId: local, email: valorDe(corpo, "#int-env-email"), cpf: valorDe(corpo, "#int-env-cpf") },
        function (r) { recado = "Resultado: " + (r.passo ? r.passo.estado : "?") + "."; });
    });
    on("int-enviar-lead", function () {
      var local = localEscolhido();
      if (!local || valorDe(corpo, "#int-loc-tipo") !== "lead") { recado = "Escolha uma lead do CRM acima."; F.redesenhar(); return; }
      if (!global.confirm("Enviar esta lead para a campanha no Clinicorp? É uma escrita real na conta da clínica.")) return;
      acao("painel.integracao.enviarLead", { operacaoId: F.novoId("int-"), leadId: local, campanha: valorDe(corpo, "#int-env-campanha") },
        function (r) { recado = "Resultado: " + (r.passo ? r.passo.estado : "?") + "."; });
    });
  }

  global.FloreSerPainelIntegracoes = {
    iniciar: function (ferramentas) { F = ferramentas; },
    carregar: carregar,
    tela: tela,
    ligar: ligar
  };
})(window);
