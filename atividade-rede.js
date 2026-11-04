/* =====================================================================
   FloreSer · Corpo e Alma — indicador de atividade com a planilha
   ---------------------------------------------------------------------
   Um selo, igual nas quatro telas, que diz quando o sistema está falando
   com o Apps Script e quando terminou. Quem avisa não é cada botão: a
   camada de rede compartilhada (FloreSerRede.postar, no logs.js) abre e
   fecha uma operação aqui, e o painel de manutenção faz o mesmo na
   chamada direta dele. Assim nenhuma tela precisa se lembrar de ligar e
   desligar nada.

   Três ideias sustentam o arquivo:

   1. ATIVIDADE NÃO É GARANTIA. "O pedido foi" e "está guardado na
      planilha" são coisas diferentes. Quem sabe a segunda é o rodapé do
      módulo, pelo FloreSerSync.criarStatus. Este selo lê esse estado e
      nunca o contradiz: "Alterações salvas" só sai quando o rodapé diz
      salvo. Se ainda há coisa pendente, o texto é "Envio concluído".

   2. SUCESSO SE CONFIRMA LENDO A RESPOSTA. O Apps Script responde 200
      com ok:false em conflito, sessão vencida e acesso negado. Só vale
      como sucesso o que vem com ok verdadeiro; sem o campo, a operação
      termina sem alarde e sem check verde.

   3. FALHA NÃO SOME SOZINHA. Uma operação que deu certo depois não apaga
      a que falhou antes: o aviso fica até a pessoa dispensar, ou até
      outra operação do mesmo tipo dar certo — aí o problema passou.

   Nada do que aparece aqui tem nome de paciente, valor, token ou resposta
   do servidor: só o tipo da operação.
   ===================================================================== */

(function (global) {
  "use strict";

  /* Tempo mínimo do "trabalhando" na tela. Operação de 80 ms acenderia e
     apagaria antes de alguém ler. Isto não atrasa a chamada nem a
     resposta: só segura o desenho. */
  var MIN_VISIVEL = 420;
  var SUCESSO_NA_TELA = 2600;   /* a confirmação em destaque */
  var DEMORA = 6000;            /* até dizer que o servidor está demorando */

  function tentar(f, padrao) {
    try { return f(); } catch (e) { return padrao; }
  }

  /* ---------- o que cada ação do Apps Script é ----------
     tipo decide o texto do fim; verbo, o texto de enquanto corre. O que
     não estiver aqui vira uma consulta genérica — nunca uma gravação,
     para o selo não prometer salvamento que não houve. */
  var ACOES = {
    ler: ["leitura", "Consultando"],
    ler_agenda: ["leitura", "Consultando"],
    ler_entradas: ["leitura", "Consultando"],
    salvar: ["gravacao", "Salvando"],
    salvar_agenda: ["gravacao", "Salvando"],
    salvar_entradas: ["gravacao", "Salvando"],
    crm_agenda_agendar: ["gravacao", "Salvando"],
    lixeira_mover: ["gravacao", "Salvando"],
    lixeira_restaurar: ["gravacao", "Salvando"],
    lixeira_excluir: ["gravacao", "Salvando"],
    lixeira_limpar: ["gravacao", "Salvando"],
    entrar: ["sessao", "Entrando"],
    dev_entrar: ["sessao", "Entrando"],
    login_usuario: ["sessao", "Entrando"],
    logout_usuario: ["sessao", "Saindo"],
    sair: ["sessao", "Saindo"],
    sessao_usuario: ["sessao", "Conferindo o acesso"],
    busca_global: ["leitura", "Buscando"],
    auditoria_listar: ["leitura", "Consultando o histórico"],
    auditoria_geral: ["leitura", "Consultando o histórico"],
    repetido_na_lixeira: ["leitura", "Conferindo"],
    lixeira_listar: ["leitura", "Consultando"],
    dev_dados: ["leitura", "Consultando"],
    dev_limpar: ["gravacao", "Limpando"],
    usuarios_listar: ["leitura", "Consultando"],
    usuario_criar: ["gravacao", "Salvando"],
    usuario_editar: ["gravacao", "Salvando"],
    usuario_status: ["gravacao", "Salvando"],
    usuario_senha: ["gravacao", "Salvando"],
  };

  function classificar(acao) {
    var a = ACOES[String(acao || "")];
    return { tipo: a ? a[0] : "leitura", verbo: a ? a[1] : "Consultando" };
  }

  /* ---------- estado ----------
     Nada aqui depende do DOM existir: uma chamada pode sair antes de a
     página terminar de montar, e o desenho acontece quando der. */
  var emVoo = {};               /* id -> { tipo, verbo, inicio } */
  var quantos = 0;
  var proximoId = 1;

  var falha = null;             /* { tipo, texto, detalhe } — não some sozinha */
  var sucesso = null;           /* { texto, detalhe } — some depois de uns segundos */
  var modulo = "";              /* o que o rodapé do módulo diz */

  var ativoDesde = 0;
  var timerSucesso = null, timerMinimo = null, timerDemora = null;
  var pintado = "";             /* a última assinatura desenhada */

  var caixa = null, elIcone = null, elTexto = null, elDetalhe = null;

  /* ---------- ícones, em traço fino como o resto do site ---------- */
  var ICONES = {
    gira: '<svg class="fsat-gira" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M8 1.6a6.4 6.4 0 1 1-6.4 6.4" /></svg>',
    ok: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.4" /><path d="m5.2 8.2 2 2 3.6-4" /></svg>',
    alerta: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 2.2 14.6 13.6H1.4L8 2.2Z" /><path d="M8 6.6v3.1M8 11.8v.1" /></svg>',
    relogio: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.4" /><path d="M8 4.4V8l2.4 1.4" /></svg>',
  };

  /* ---------- o que o rodapé do módulo diz ----------
     Os mesmos nomes do sync.js. "salvo" e "carregando" não pedem nada de
     ninguém, então não aparecem aqui — quem mostra isso é o rodapé. */
  var DO_MODULO = {
    pendente: { icone: "relogio", tom: "", texto: "Alterações pendentes",
      detalhe: "Ainda não foram enviadas para a planilha." },
    salvando: { icone: "gira", tom: "", texto: "Salvando…", detalhe: "" },
    offline: { icone: "alerta", tom: "alerta", texto: "Sem conexão",
      detalhe: "As alterações ficam neste aparelho e sobem quando a conexão voltar." },
    erro: { icone: "alerta", tom: "alerta", texto: "Não foi possível salvar",
      detalhe: "As alterações continuam aqui." },
    conflito: { icone: "alerta", tom: "alerta", texto: "Conflito de alterações",
      detalhe: "Resolva para voltar a salvar." },
    expirado: { icone: "alerta", tom: "alerta", texto: "Sessão expirada",
      detalhe: "Entre novamente para voltar a salvar." },
    semAcesso: { icone: "alerta", tom: "alerta", texto: "Acesso removido",
      detalhe: "Fale com quem administra o sistema." },
  };

  /* ---------- desenho ---------- */

  function montar() {
    if (caixa || !global.document || !document.body) return false;
    caixa = document.createElement("div");
    caixa.className = "fsat";
    caixa.setAttribute("role", "status");
    caixa.setAttribute("aria-live", "polite");
    caixa.setAttribute("data-estado", "repouso");
    caixa.innerHTML =
      '<span class="fsat-icone"></span>' +
      '<span class="fsat-texto"><span class="fsat-frase"></span>' +
      '<span class="fsat-detalhe"></span></span>' +
      '<button type="button" class="fsat-fechar" aria-label="Dispensar aviso">' +
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>';
    elIcone = caixa.querySelector(".fsat-icone");
    elTexto = caixa.querySelector(".fsat-frase");
    elDetalhe = caixa.querySelector(".fsat-detalhe");
    caixa.querySelector(".fsat-fechar").addEventListener("click", function () {
      falha = null;
      pintar();
    });
    document.body.appendChild(caixa);
    desviarDoAviso();
    return true;
  }

  /* O que mostrar agora, em ordem de urgência: o que está acontecendo,
     depois o que deu errado e ninguém resolveu, depois o que o módulo
     cobra, e por último a confirmação do que acabou de dar certo. */
  function quadro() {
    if (quantos > 0) {
      var unico = null, misturado = false;
      for (var id in emVoo) {
        if (!Object.prototype.hasOwnProperty.call(emVoo, id)) continue;
        if (unico === null) unico = emVoo[id];
        else if (emVoo[id].verbo !== unico.verbo) misturado = true;
      }
      var demorando = unico && (Date.now() - unico.inicio) >= DEMORA;
      return {
        chave: "ativo",
        icone: "gira",
        tom: "",
        texto: quantos > 1
          ? (misturado ? quantos + " operações em andamento" : unico.verbo + "… (" + quantos + ")")
          : unico.verbo + "…",
        /* a frase de demora não quer dizer que falhou: só que ainda corre */
        detalhe: demorando ? "O servidor está demorando…" : "",
        /* contador e relógio mudam sozinhos: não merecem anúncio novo */
        silencioso: true,
      };
    }

    if (falha) {
      return { chave: "falha:" + falha.texto, icone: "alerta", tom: "alerta",
        texto: falha.texto, detalhe: falha.detalhe, fechavel: true };
    }

    var m = DO_MODULO[modulo];
    if (m) {
      return { chave: "modulo:" + modulo, icone: m.icone, tom: m.tom,
        texto: m.texto, detalhe: m.detalhe };
    }

    if (sucesso) {
      return { chave: "ok:" + sucesso.texto, icone: "ok", tom: "",
        texto: sucesso.texto, detalhe: sucesso.detalhe || "" };
    }

    return { chave: "repouso" };
  }

  function pintar() {
    if (!caixa && !montar()) return;

    var q = quadro();

    /* o "trabalhando" fica um instante na tela mesmo que a resposta venha
       antes — e isso nunca segura a chamada, só o desenho */
    if (q.chave === "repouso" || q.chave.indexOf("ok:") === 0) {
      var falta = ativoDesde ? MIN_VISIVEL - (Date.now() - ativoDesde) : 0;
      if (falta > 0 && pintado === "ativo") {
        clearTimeout(timerMinimo);
        timerMinimo = setTimeout(pintar, falta);
        return;
      }
    }

    if (q.chave === "repouso") {
      caixa.setAttribute("data-estado", "repouso");
      caixa.removeAttribute("data-fechavel");
      caixa.removeAttribute("aria-live");
      pintado = "repouso";
      return;
    }

    var mudou = q.chave !== pintado;
    /* leitor de tela só é interrompido por notícia de verdade */
    if (mudou && !q.silencioso) caixa.setAttribute("aria-live", "polite");
    else if (!mudou || q.silencioso) caixa.removeAttribute("aria-live");

    elIcone.innerHTML = ICONES[q.icone] || "";
    elTexto.textContent = q.texto;
    elDetalhe.textContent = q.detalhe || "";
    elDetalhe.style.display = q.detalhe ? "" : "none";
    caixa.setAttribute("data-estado", q.chave.split(":")[0]);
    caixa.setAttribute("data-tom", q.tom || "");
    caixa.setAttribute("data-fechavel", q.fechavel ? "sim" : "nao");
    pintado = q.chave;

    /* enquanto corre, o relógio da demora precisa de um empurrão */
    clearTimeout(timerDemora);
    if (q.chave === "ativo" && !q.detalhe) {
      timerDemora = setTimeout(pintar, DEMORA);
    }
  }

  /* ---------- abrir e fechar uma operação ---------- */

  /* iniciar(acao) devolve o controle de UMA operação. Ela se encerra uma
     vez só: o primeiro ok/falhou/fim manda, e os seguintes não fazem
     nada — nem quando a chamada estoura no meio. */
  function iniciar(acao) {
    var info = classificar(acao);
    var id = "op" + (proximoId++);
    var vivo = true;

    emVoo[id] = { tipo: info.tipo, verbo: info.verbo, inicio: Date.now() };
    quantos++;
    if (quantos === 1) ativoDesde = Date.now();
    pintar();

    function encerrar() {
      if (!vivo) return false;
      vivo = false;
      delete emVoo[id];
      quantos = Math.max(0, quantos - 1);
      if (!quantos) clearTimeout(timerDemora);
      return true;
    }

    return {
      tipo: info.tipo,

      /* deu certo de verdade: a resposta foi lida e o contrato bateu */
      ok: function (texto, detalhe, modesto) {
        if (!encerrar()) return;
        /* o problema de antes passou: a mesma coisa funcionou agora */
        if (falha && falha.tipo === info.tipo) falha = null;
        sucesso = { texto: texto || "Concluído", detalhe: detalhe || "",
          tipo: info.tipo, modesto: !!modesto };
        clearTimeout(timerSucesso);
        timerSucesso = setTimeout(function () { sucesso = null; pintar(); },
          SUCESSO_NA_TELA + Math.max(0, MIN_VISIVEL - (Date.now() - ativoDesde)));
        pintar();
      },

      /* não deu, e isso fica na tela até alguém resolver ou dispensar */
      falhou: function (texto, detalhe) {
        if (!encerrar()) return;
        sucesso = null;
        clearTimeout(timerSucesso);
        falha = { tipo: info.tipo, texto: texto || "Falha na operação", detalhe: detalhe || "" };
        pintar();
      },

      /* terminou sem dar para afirmar nada: nem check verde, nem alarme */
      fim: function () {
        if (!encerrar()) return;
        pintar();
      },
    };
  }

  /* ---------- a resposta do Apps Script ----------
     200 não quer dizer que deu certo: conflito, sessão vencida e acesso
     negado chegam com ok:false. Quem tiver uma resposta na mão entrega
     ela aqui e o selo decide o que dizer. */
  var MOTIVOS = {
    conflito: ["Conflito de alterações", "Alguém alterou os mesmos dados."],
    sessao: ["Sessão expirada", "Entre novamente para continuar."],
    expirada: ["Sessão expirada", "Entre novamente para continuar."],
    inativo: ["Acesso inativo", "Fale com quem administra o sistema."],
    sem_acesso: ["Acesso negado", "Você não tem acesso a este módulo."],
    sem_permissao: ["Permissão insuficiente", "Esta ação é de administrador."],
    senha: ["Senha incorreta", ""],
    credenciais: ["Usuário ou senha incorretos", ""],
    bloqueado: ["Acesso bloqueado por tentativas", ""],
    ocupado: ["O servidor está ocupado", "Tente de novo em instantes."],
    servidor_falhou: ["O servidor não respondeu", "Nada foi alterado."],
  };

  var FIM_BOM = {
    leitura: "Consulta concluída",
    sessao: "Acesso confirmado",
  };

  function concluir(op, resposta) {
    if (!op) return resposta;

    /* resposta que não é objeto: a chamada voltou, mas não dá para dizer
       que deu certo */
    if (!resposta || typeof resposta !== "object") { op.fim(); return resposta; }

    if (resposta.ok === false) {
      var m = MOTIVOS[String(resposta.erro || "")] || ["Falha na operação", ""];
      op.falhou(m[0], m[1]);
      return resposta;
    }

    if (resposta.ok === true) {
      if (op.tipo === "gravacao") {
        /* "Alterações salvas" é promessa de persistência, e quem garante
           isso é o rodapé do módulo. Com coisa ainda na fila — inclusive
           o que foi editado durante esta chamada — o texto é mais modesto. */
        var guardado = modulo === "salvo" || modulo === "";
        op.ok(guardado ? "Alterações salvas" : "Envio concluído",
          guardado ? "" : "Ainda há alterações a enviar.",
          /* enquanto o rodapé não confirmar, esta confirmação é modesta —
             e vira a definitiva se a confirmação chegar logo em seguida */
          !guardado);
      } else {
        op.ok(FIM_BOM[op.tipo] || "Concluído");
      }
      return resposta;
    }

    /* sem o campo ok: contrato não confirmado, então nada de check verde */
    op.fim();
    return resposta;
  }

  /* ---------- o que o rodapé do módulo está dizendo ----------
     Chamado pelo FloreSerSync.criarStatus. Aqui não existe lógica de
     salvamento nenhuma: o selo só repete o que o módulo concluiu. */
  function estadoDoModulo(novo) {
    if (novo === modulo) return;
    modulo = String(novo || "");
    /* o módulo confirmou a gravação: o aviso de falha de gravação
       cumpriu o papel dele e pode sair */
    if (modulo === "salvo" && falha && falha.tipo === "gravacao") falha = null;
    /* a gravação tinha terminado sem o rodapé confirmar, e agora ele
       confirmou: a confirmação modesta vira a definitiva, em vez de ficar
       na tela dizendo que ainda falta enviar */
    if (modulo === "salvo" && sucesso && sucesso.modesto && sucesso.tipo === "gravacao") {
      sucesso = { texto: "Alterações salvas", detalhe: "", tipo: "gravacao", modesto: false };
    }
    pintar();
  }

  function falhaDeRede(op, erro) {
    var semRede = (erro instanceof TypeError) ||
      tentar(function () { return !navigator.onLine; }, false);
    op.falhou(semRede ? "Sem conexão com o servidor" : "Falha na operação",
      semRede ? "As alterações continuam neste aparelho." : "Tente de novo.");
  }

  global.FloreSerAtividade = {
    iniciar: iniciar,
    concluir: concluir,
    falhaDeRede: falhaDeRede,
    estadoDoModulo: estadoDoModulo,
    /* só para a bancada de teste conferir o que está na tela */
    estado: function () {
      return { emVoo: quantos, falha: falha, sucesso: sucesso, modulo: modulo, pintado: pintado };
    },
  };

  /* ---------- sair da frente do aviso do Alveare ----------
     O pwa.js mostra a faixa de versão nova e de conexão no mesmo canto de
     baixo, e no celular ela ocupa a largura toda e empilha os botões — a
     altura varia com o texto. Em vez de chutar um valor, o selo mede a
     faixa e se coloca acima dela. Sem faixa na tela, volta ao lugar. */
  function desviarDoAviso() {
    if (!caixa) return;
    var aviso = tentar(function () { return document.querySelector(".pwa-aviso"); }, null);
    if (!aviso) { caixa.style.bottom = ""; return; }
    var r = tentar(function () { return aviso.getBoundingClientRect(); }, null);
    if (!r || !r.height) { caixa.style.bottom = ""; return; }
    caixa.style.bottom = Math.round(global.innerHeight - r.top + 12) + "px";
  }

  function vigiarAviso() {
    if (!global.document || !document.body || !global.MutationObserver) return;
    tentar(function () {
      new MutationObserver(desviarDoAviso)
        .observe(document.body, { childList: true, subtree: true });
      global.addEventListener("resize", desviarDoAviso);
      return true;
    }, false);
  }

  /* a página pode não estar pronta quando a primeira chamada sair */
  if (global.document && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { pintar(); vigiarAviso(); });
  } else {
    vigiarAviso();
  }
})(window);
