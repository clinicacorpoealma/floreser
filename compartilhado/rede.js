/* =====================================================================
   FloreSer · Corpo e Alma — transporte (a única conversa com o servidor)
   ---------------------------------------------------------------------
   FloreSerRede.chamar(acao, dados, opcoes) → Promise<resposta>

   Toda resposta tem o mesmo formato, venha do servidor ou daqui:
     { ok: true, dados, sessao?, servidor }
     { ok: false, erro: { codigo, categoria, mensagem, repetivel, ... } }

   As categorias dizem o que fazer, e só uma pede login de novo:
     autenticacao   a sessão acabou de verdade (o servidor disse)
     autorizacao    a conta não alcança isto — a sessão continua valendo
     validacao      o pedido foi recusado como está
     conflito       outra pessoa mudou a mesma ficha
     versao         site ou servidor desatualizado, ou manutenção
     indisponivel   ocupado, sem conexão, prazo, resposta estranha
     incerto        GRAVAÇÃO que pode ter acontecido: a resposta se perdeu.
                    Nunca vira "falhou" nem segunda gravação: quem gravou
                    repete o MESMO pedido, com o mesmo operacaoId, e o
                    servidor reconhece a repetição.

   opcoes: { token, leitura, prazoMs, tentativas, repetirIncerto, semSelo }
     leitura: true  → pode repetir sozinho (até 3×, espera crescente) e
                      leituras iguais simultâneas viram uma só.
     gravação       → uma tentativa; quem chama decide (o motor de dados
                      repete com o mesmo operacaoId).

   O selo de atividade (atividade-rede.js) abre e fecha AQUI, em volta da
   chamada inteira, repetições incluídas.
   ===================================================================== */

(function (global) {
  "use strict";

  var C = global.FLORESER_CONFIG || { api: 2, prazoLeituraMs: 30000, prazoGravacaoMs: 45000 };

  var CATEGORIA = {
    sessao_ausente: "autenticacao", sessao_invalida: "autenticacao", sessao_expirada: "autenticacao",
    sessao_revogada: "autenticacao", conta_inativa: "autenticacao", credenciais: "autenticacao",
    bloqueado: "autenticacao", senha_modulo_desligada: "autenticacao",
    sem_acesso: "autorizacao", sem_permissao: "autorizacao",
    dados_invalidos: "validacao", acao_desconhecida: "validacao", operacao_divergente: "validacao",
    nao_encontrado: "validacao", sem_confirmacao: "validacao", na_lixeira: "validacao",
    conflito: "conflito",
    versao_cliente: "versao", versao_servidor: "versao", manutencao: "versao",
    ocupado: "indisponivel", servidor_falhou: "indisponivel", instalacao_incompleta: "indisponivel",
    sem_conexao: "indisponivel", prazo: "indisponivel", resposta_invalida: "indisponivel",
    resultado_desconhecido: "incerto"
  };

  var emVoo = {};
  var medicoes = [];
  var servidor = null;
  var ouvintesSessao = [];

  function tentar(f, padrao) { try { return f(); } catch (e) { return padrao; } }
  function dormir(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  function novoId(prefixo) {
    var aleatorio = tentar(function () {
      var b = new Uint8Array(8);
      global.crypto.getRandomValues(b);
      return Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    }, Math.random().toString(36).slice(2, 12));
    return (prefixo || "") + Date.now().toString(36) + aleatorio;
  }

  function erro(codigo, mensagem, extra) {
    var e = { codigo: codigo, categoria: CATEGORIA[codigo] || "indisponivel", mensagem: mensagem || "" };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    e.repetivel = e.categoria === "indisponivel" && codigo !== "instalacao_incompleta";
    return { ok: false, erro: e };
  }

  /* Um resumo do aparelho para o painel reconhecer a sessão ("Chrome ·
     Android"). Nada que identifique a pessoa. */
  function agente() {
    var ua = tentar(function () { return navigator.userAgent; }, "");
    var nav = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
    var so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    var app = tentar(function () { return global.matchMedia("(display-mode: standalone)").matches; }, false);
    return [nav, so, app ? "app" : ""].filter(Boolean).join(" · ");
  }

  function resumoDaPagina(texto) {
    return String(texto || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, 160);
  }

  /* ---------------------------------------------------------------------
     Uma tentativa
     --------------------------------------------------------------------- */
  function umaTentativa(corpo, prazoMs, gravacao) {
    var controle = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controle) controle.abort(); }, prazoMs);
    var status = 0;
    return fetch(C.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(corpo),
      redirect: "follow",
      cache: "no-store",
      signal: controle ? controle.signal : undefined
    }).then(function (resposta) {
      status = resposta.status;
      return resposta.text().then(function (texto) { return { http: resposta, texto: texto }; });
    }).then(function (x) {
      clearTimeout(timer);
      var dados = tentar(function () { return JSON.parse(x.texto); }, null);
      if (!x.http.ok || !dados || typeof dados !== "object") {
        /* O 404 do Apps Script costuma vir do SEGUNDO salto (o redirecionamento
           para googleusercontent): o script já rodou e a resposta se perdeu.
           Numa leitura, repete; numa gravação, o resultado é desconhecido. */
        return gravacao
          ? erro("resultado_desconhecido", "A resposta do servidor se perdeu.", { status: status })
          : erro("resposta_invalida", "Resposta inesperada do servidor.", { status: status, detalhe: resumoDaPagina(x.texto) });
      }
      if (dados.metodo === "use POST") {
        /* chegou como GET: o redirecionamento trocou o método */
        return gravacao ? erro("resultado_desconhecido", "O pedido chegou incompleto ao servidor.")
          : erro("resposta_invalida", "O pedido chegou incompleto ao servidor.");
      }
      if (dados.v === undefined) {
        return erro("versao_servidor", "O servidor ainda está na versão anterior. Avise quem administra o sistema.");
      }
      if (Number(dados.v) !== Number(C.api)) {
        return erro("versao_servidor", "O servidor fala outra versão da API (" + dados.v + ").");
      }
      if (dados.servidor) servidor = dados.servidor;
      if (dados.ok === false && dados.erro && !dados.erro.categoria) dados.erro.categoria = CATEGORIA[dados.erro.codigo] || "indisponivel";
      return dados;
    }, function (falha) {
      clearTimeout(timer);
      var estourou = falha && falha.name === "AbortError";
      if (gravacao) {
        return erro("resultado_desconhecido", estourou
          ? "O servidor não respondeu a tempo; a gravação pode ter acontecido."
          : "A conexão caiu durante o envio.", { semConexao: !estourou });
      }
      return estourou ? erro("prazo", "O servidor demorou demais.") : erro("sem_conexao", "Sem conexão com o servidor.");
    });
  }

  /* ---------------------------------------------------------------------
     Chamar
     --------------------------------------------------------------------- */
  function chamar(acao, dados, opcoes) {
    var o = opcoes || {};
    var gravacao = !o.leitura;
    var chave = o.leitura ? acao + "|" + (o.token || "") + "|" + JSON.stringify(dados || {}) : null;
    if (chave && emVoo[chave]) return emVoo[chave];

    var corpo = { v: C.api, pedidoId: novoId("pd-"), acao: acao, token: o.token || "",
      cliente: { versao: C.versao || "", agente: agente() }, dados: dados || {} };

    var p = (async function () {
      var selo = o.semSelo ? null : tentar(function () { return global.FloreSerAtividade ? global.FloreSerAtividade.iniciar(acao) : null; }, null);
      var tentativas = o.tentativas || (o.leitura ? 3 : 1);
      var esperas = [700, 2000, 4000];
      var inicio = Date.now(), r = null, feitas = 0;
      for (var i = 0; i < tentativas; i++) {
        if (i > 0) await dormir(esperas[i - 1] + Math.floor(Math.random() * 400));
        feitas++;
        r = await umaTentativa(corpo, o.prazoMs || (o.leitura ? C.prazoLeituraMs : C.prazoGravacaoMs), gravacao);
        var repete = r.ok === false && r.erro && (r.erro.repetivel || (o.repetirIncerto && r.erro.categoria === "incerto"));
        if (!repete) break;
      }
      anotar(acao, corpo.pedidoId, Date.now() - inicio, r, feitas);
      avisarSessao(o.token, r);
      if (selo) tentar(function () { global.FloreSerAtividade.concluir(selo, r); }, null);
      return r;
    })();

    if (chave) {
      emVoo[chave] = p;
      p.then(function () { delete emVoo[chave]; }, function () { delete emVoo[chave]; });
    }
    return p;
  }

  /* A sessão fica sabendo do que o servidor disse sobre ela — com o token
     que foi USADO no pedido. Uma resposta atrasada de um token antigo não
     consegue apagar a sessão nova (ver sessao.js: compara antes de apagar). */
  function avisarSessao(token, r) {
    if (!token || !r) return;
    var tipo = null, info = null;
    if (r.sessao) { tipo = "validade"; info = r.sessao; }
    if (r.ok === false && r.erro && r.erro.categoria === "autenticacao" && r.erro.codigo !== "credenciais" && r.erro.codigo !== "bloqueado") {
      tipo = "perdida"; info = r.erro;
    }
    if (!tipo) return;
    ouvintesSessao.forEach(function (fn) { tentar(function () { fn(tipo, token, info); }, null); });
  }

  function anotar(acao, pedidoId, ms, r, feitas) {
    var m = { acao: acao, pedidoId: pedidoId, ms: ms, ok: !!(r && r.ok), codigo: r && r.erro ? r.erro.codigo : "",
      tentativas: feitas, quando: new Date().toISOString() };
    medicoes.push(m);
    if (medicoes.length > 40) medicoes.shift();
    var registrar = tentar(function () { return global.FloreSerLogs && global.FloreSerLogs.registrar; }, null);
    if (!registrar) return;
    if (r && r.ok === false && ["indisponivel", "incerto", "versao"].indexOf(r.erro.categoria) >= 0) {
      registrar("REDE_FALHA", { nivel: r.erro.categoria === "versao" ? "WARNING" : "ERROR", pedidoId: pedidoId,
        mensagem: acao + " · " + r.erro.codigo + (r.erro.status ? " (" + r.erro.status + ")" : "") + " · " + feitas + " tentativa(s) · " + ms + " ms" });
    } else if (r && r.ok && feitas > 1) {
      registrar("REDE_REPETIU", { pedidoId: pedidoId, mensagem: acao + " respondeu na tentativa " + feitas });
    }
  }

  global.FloreSerRede = {
    chamar: chamar,
    novoId: novoId,
    categoria: function (codigo) { return CATEGORIA[codigo] || "indisponivel"; },
    erro: erro,
    servidor: function () { return servidor; },
    medicoes: function () { return medicoes.slice(); },
    aoSessao: function (fn) { ouvintesSessao.push(fn); },
    enderecoDaApi: function () { return C.apiUrl; }
  };
})(window);
