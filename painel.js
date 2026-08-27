/* =====================================================================
   FloreSer · Corpo e Alma — painel de manutenção
   ---------------------------------------------------------------------
   Ferramenta interna de diagnóstico. A entrada é discreta, mas discrição
   não é proteção: nada aqui é mostrado antes de o Apps Script conferir a
   senha e devolver uma credencial temporária. A senha não existe neste
   arquivo, só viaja para o servidor.
   ===================================================================== */

(function (global) {
  "use strict";

  var URL_API = "https://script.google.com/macros/s/AKfycbzy9WCfP4l08dn2h2K34uEL6e0mqFBjVMugcHiTc0oUGmpS7gOJjbxs58CB87AoFUw-/exec";
  var CHAVE = "floreser.cred";
  var PACIENCIA = 8000;      // ms de tolerância entre um toque e o seguinte
  var POR_PAGINA = 50;

  var registrar = (global.FloreSerLogs && global.FloreSerLogs.registrar) || function () { };

  /* ---------------------------------------------------- utilidades */

  function esc(t) {
    return String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function tentar(f, padrao) {
    try {
      var v = f();
      return v === undefined || v === null || v === "" ? padrao : v;
    } catch (e) {
      return padrao;
    }
  }

  function credencial(valor) {
    if (valor === undefined) return tentar(function () { return sessionStorage.getItem(CHAVE); }, null);
    tentar(function () {
      if (valor === null) sessionStorage.removeItem(CHAVE);
      else sessionStorage.setItem(CHAVE, valor);
      return true;
    }, false);
  }

  function chamar(corpo) {
    return fetch(URL_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(corpo),
      redirect: "follow",
    }).then(function (r) { return r.json(); });
  }

  /* mostra "Não disponível" em vez de vazio, sem inventar valor */
  function valor(v, sufixo) {
    if (v === undefined || v === null || v === "" ) {
      return '<div class="val ausente">Não disponível</div>';
    }
    return '<div class="val">' + esc(v) + esc(sufixo || "") + "</div>";
  }

  function cartao(rotulo, v, classe) {
    return '<div class="cartao"><div class="rot">' + esc(rotulo) + "</div>" +
      (classe ? '<div class="val ' + classe + '">' + esc(v) + "</div>" : valor(v)) + "</div>";
  }

  function dataHora(iso) {
    if (!iso) return "";
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T?(\d{2})?:?(\d{2})?:?(\d{2})?/);
    if (!m) return String(iso);
    return m[3] + "/" + m[2] + "/" + m[1] + (m[4] ? " " + m[4] + ":" + m[5] + ":" + (m[6] || "00") : "");
  }

  function ambiente() {
    var h = tentar(function () { return location.hostname; }, "");
    if (!h) return "Arquivo local";
    if (h === "localhost" || h === "127.0.0.1") return "Teste local";
    if (h.indexOf("github.io") >= 0) return "Produção · GitHub Pages";
    return h;
  }

  function pesoDaPagina() {
    return tentar(function () {
      var recursos = performance.getEntriesByType("resource") || [];
      var nav = (performance.getEntriesByType("navigation") || [])[0];
      var total = (nav && nav.transferSize ? nav.transferSize : 0);
      recursos.forEach(function (r) { total += r.transferSize || 0; });
      return total ? Math.round(total / 1024) + " KB (aprox.)" : "";
    }, "");
  }

  /* ---------------------------------------------------- a entrada */

  var passo = 0;
  var prazo = null;

  function zerar() {
    passo = 0;
    if (prazo) { clearTimeout(prazo); prazo = null; }
  }

  function esperado() {
    return passo === 0 ? '#marca-titulo span[data-p="1"]'
      : passo === 1 ? '#marca-titulo span[data-p="2"]'
        : "#versao-atual";
  }

  document.addEventListener("click", function (e) {
    var alvo = e.target;
    if (!alvo || !alvo.matches) return;
    if (alvo.matches(esperado())) {
      passo++;
      if (prazo) clearTimeout(prazo);
      if (passo >= 3) {
        zerar();
        iniciar();
        return;
      }
      prazo = setTimeout(zerar, PACIENCIA);
      return;
    }
    zerar();
  });

  /* ---------------------------------------------------- autenticação */

  var dlgEntrada = null;

  function iniciar() {
    registrar("DEV_TENTATIVA", { nivel: "SECURITY", mensagem: "Entrada do painel solicitada" });
    var cred = credencial();
    if (cred) {
      abrirPainel();
      return;
    }
    pedirSenha();
  }

  function pedirSenha() {
    if (!dlgEntrada) {
      dlgEntrada = document.createElement("dialog");
      dlgEntrada.className = "entrada-tecnica";
      dlgEntrada.innerHTML =
        '<div class="janela-topo"><h2>Manutenção</h2>' +
        '<button class="fechar" type="button" data-sai="1" aria-label="Fechar">&#10005;</button></div>' +
        '<div class="janela-corpo"><p>Área técnica do sistema. Informe a senha de manutenção ' +
        "para continuar.</p>" +
        '<input type="password" id="cred-senha" autocomplete="off" placeholder="Senha de manutenção" ' +
        'enterkeyhint="go"><div class="aviso" id="cred-aviso"></div>' +
        '<button class="botao-cheio" id="cred-ok" type="button">Entrar</button></div>';
      document.body.appendChild(dlgEntrada);

      dlgEntrada.querySelector("[data-sai]").addEventListener("click", function () { fechar(dlgEntrada); });
      dlgEntrada.querySelector("#cred-ok").addEventListener("click", enviarSenha);
      dlgEntrada.querySelector("#cred-senha").addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") enviarSenha();
      });
    }
    dlgEntrada.querySelector("#cred-senha").value = "";
    dlgEntrada.querySelector("#cred-aviso").textContent = "";
    abrir(dlgEntrada);
    tentar(function () { dlgEntrada.querySelector("#cred-senha").focus(); return true; }, false);
  }

  function enviarSenha() {
    var campo = dlgEntrada.querySelector("#cred-senha");
    var aviso = dlgEntrada.querySelector("#cred-aviso");
    var botao = dlgEntrada.querySelector("#cred-ok");
    var senha = (campo.value || "").trim();
    if (!senha) { campo.focus(); return; }

    botao.disabled = true;
    botao.textContent = "Conferindo…";
    aviso.textContent = "";

    chamar({ acao: "dev_entrar", senha: senha }).then(function (r) {
      if (r && r.ok) {
        credencial(r.token);
        campo.value = "";
        fechar(dlgEntrada);
        abrirPainel();
        return;
      }
      if (r && r.erro === "bloqueado") {
        aviso.textContent = "Bloqueado por tentativas seguidas. Tente em " + (r.minutos || 15) + " min.";
      } else if (r && r.erro === "senha") {
        aviso.textContent = "Senha incorreta." + (r.restam ? " Restam " + r.restam + "." : "");
      } else {
        aviso.textContent = "Não foi possível falar com o servidor.";
      }
      campo.value = "";
      campo.focus();
    }).catch(function () {
      aviso.textContent = "Sem conexão com o servidor.";
    }).then(function () {
      botao.disabled = false;
      botao.textContent = "Entrar";
    });
  }

  /* ---------------------------------------------------- janelas */

  /* mesma ideia do portal: a rolagem segue o estado real das janelas */
  function sincronizarRolagem() {
    document.body.style.overflow = document.querySelector("dialog[open]") ? "hidden" : "";
  }

  function abrir(d) {
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    sincronizarRolagem();
  }

  function fechar(d) {
    if (typeof d.close === "function" && d.open) d.close();
    else d.removeAttribute("open");
    pararRelogio();
    sincronizarRolagem();
  }

  function pararRelogio() {
    if (relogio) { clearInterval(relogio); relogio = null; }
  }

  /* sair com ESC não passa por fechar(), então o acerto vem logo depois */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    setTimeout(function () {
      if (!document.querySelector("dialog[open]")) pararRelogio();
      sincronizarRolagem();
    }, 0);
  });

  /* ---------------------------------------------------- painel */

  var dlgPainel = null;
  var relogio = null;
  var base = { logs: [], sessoes: [], resumo: {} };
  var aba = "visao";

  /* Usuários: a lista vem do servidor a cada operação, então a tela nunca
     mostra permissão que o servidor não confirmou. */
  var usuarios = [];
  var buscaUsuario = "";
  var formUsuario = null;   // null | "novo" | {id:...} | {senha:id}
  var recadoUsuario = "";

  /* Lixeira: a lista vem do servidor a cada operação. */
  var lixeira = [];
  var lixeiraDias = 30;
  var filtroTipo = "todos";      // todos | crm | agenda | entradas
  var filtroPrazo = "todos";     // todos | ativos | expirados
  var buscaLixeira = "";
  var ordemLixeira = "recentes"; // recentes | antigos | prazo | nome
  var confirmandoLixeira = null; // {acao, item} enquanto a confirmação está aberta
  var recadoLixeira = "";
  var ordemDesc = true;
  var limite = POR_PAGINA;
  var selecionado = null;

  function abrirPainel() {
    if (!dlgPainel) montarPainel();
    abrir(dlgPainel);
    trocarAba("visao");
    carregar();
    pararRelogio();
    relogio = setInterval(function () {
      var el = document.getElementById("relogio");
      if (el) el.textContent = new Date().toLocaleTimeString("pt-BR");
    }, 1000);
  }

  function montarPainel() {
    dlgPainel = document.createElement("dialog");
    dlgPainel.className = "painel";
    dlgPainel.setAttribute("aria-label", "Painel de manutenção");
    dlgPainel.innerHTML =
      '<div class="janela-topo"><h2>Manutenção</h2>' +
      '<span class="selo" id="painel-selo"></span>' +
      '<button class="fechar" type="button" data-sai="1" aria-label="Fechar painel">&#10005;</button></div>' +
      '<div class="abas">' +
      '<button data-aba="visao" class="on">Visão geral</button>' +
      '<button data-aba="logs">Logs</button>' +
      '<button data-aba="acessos">Acessos</button>' +
      '<button data-aba="usuarios">Usu\u00e1rios</button>' +
      '<button data-aba="lixeira" id="aba-lixeira">Lixeira</button>' +
      '<button data-aba="sistema">Sistema</button>' +
      "</div>" +
      '<div class="janela-corpo" id="painel-corpo" tabindex="0"></div>';
    document.body.appendChild(dlgPainel);

    dlgPainel.querySelector("[data-sai]").addEventListener("click", function () {
      fechar(dlgPainel);
    });

    dlgPainel.addEventListener("close", function () {
      pararRelogio();
      sincronizarRolagem();
    });

    Array.prototype.forEach.call(dlgPainel.querySelectorAll("[data-aba]"), function (b) {
      b.addEventListener("click", function () { trocarAba(b.getAttribute("data-aba")); });
    });
  }

  function trocarAba(qual) {
    aba = qual;
    if (qual === "usuarios" && !usuarios.length) carregarUsuarios();
    if (qual === "lixeira") carregarLixeira();
    if (qual === "sistema") pedirEstadoPWA();
    Array.prototype.forEach.call(dlgPainel.querySelectorAll("[data-aba]"), function (b) {
      b.className = b.getAttribute("data-aba") === qual ? "on" : "";
    });
    desenhar();
  }

  function carregar() {
    var corpo = document.getElementById("painel-corpo");
    if (corpo && !base.logs.length) corpo.innerHTML = '<div class="vazio">Carregando registros…</div>';

    chamar({ acao: "dev_dados", token: credencial() }).then(function (r) {
      if (r && r.erro === "sessao") {
        credencial(null);
        fechar(dlgPainel);
        pedirSenha();
        return;
      }
      if (r && r.ok) {
        base = r.dados || base;
        desenhar();
        carregarLixeira();   /* a contagem da aba já aparece de cara */
        return;
      }
      base = { logs: [], sessoes: [], resumo: {} };
      desenhar("Não foi possível ler os registros no servidor.");
    }).catch(function () {
      desenhar("Sem conexão com o servidor. O painel está mostrando só o que este aparelho sabe.");
    });
  }

  function desenhar(recado) {
    var corpo = document.getElementById("painel-corpo");
    if (!corpo) return;
    var selo = document.getElementById("painel-selo");
    if (selo) selo.textContent = (base.resumo && base.resumo.servidor) ? "Servidor · " + base.resumo.servidor : "";

    var html = recado ? '<div class="nota-privacidade">' + esc(recado) + "</div>" : "";
    if (aba === "visao") html += visaoGeral();
    else if (aba === "logs") html += telaLogs();
    else if (aba === "acessos") html += telaAcessos();
    else if (aba === "usuarios") html += telaUsuarios();
    else if (aba === "lixeira") html += telaLixeira();
    else html += telaSistema();

    corpo.innerHTML = html;
    corpo.scrollTop = 0;
    ligarEventos();
    if (aba === "usuarios") ligarEventosUsuarios();
    if (aba === "lixeira") ligarEventosLixeira();
  }

  /* ---------------------------------------------------- visão geral */

  function visaoGeral() {
    var v = global.FLORESER || {};
    var atual = v.atual || {};
    var s = tentar(function () { return global.FloreSerLogs.sessao(); }, {});
    var e = tentar(function () { return global.FloreSerLogs.estado(); }, {});
    var arm = tentar(function () { return global.FloreSerLogs.armazenamento(); }, null);
    var resumo = base.resumo || {};

    var aberturas = (base.logs || []).filter(function (l) {
      return /_ABERTO$/.test(l.evento || "");
    }).length;

    var estadoApi = e.envio === "ok" ? "Respondendo"
      : e.envio === "erro" ? "Sem resposta"
        : (base.logs && base.logs.length ? "Respondendo" : "Sem envio ainda");

    return '<div class="titulo-secao">Versão publicada</div><div class="grade">' +
      cartao("Versão", "v" + (atual.versao || "?"), "destaque") +
      cartao("Codinome", atual.codinome) +
      cartao("Data da versão", atual.data) +
      cartao("Página atual", tentar(function () { return location.pathname.split("/").pop() || "index.html"; }, "")) +
      "</div>" +

      '<div class="titulo-secao">Agora</div><div class="grade">' +
      '<div class="cartao"><div class="rot">Horário do sistema</div>' +
      '<div class="val" id="relogio">' + esc(new Date().toLocaleTimeString("pt-BR")) + "</div></div>" +
      cartao("Horário do servidor", resumo.servidor) +
      cartao("Estado da API", estadoApi) +
      cartao("Ambiente", ambiente()) +
      "</div>" +

      '<div class="titulo-secao">Registros</div><div class="grade">' +
      cartao("Sessões registradas", String((base.sessoes || []).length), "destaque") +
      cartao("Aberturas registradas", String(aberturas), "destaque") +
      cartao("Eventos guardados", String((base.logs || []).length), "destaque") +
      cartao("Último acesso", dataHora(resumo.ultimoAcesso)) +
      "</div>" +

      '<div class="titulo-secao">Este aparelho</div><div class="grade">' +
      cartao("Armazenamento", arm ? (arm.local && arm.sessao ? "Disponível"
        : arm.local || arm.sessao ? "Parcial" : "Bloqueado") : "") +
      cartao("Peso da página", pesoDaPagina()) +
      cartao("Sessão", s.id) +
      cartao("User Agent", tentar(function () { return navigator.userAgent; }, "")) +
      "</div>" +

      '<div class="nota-privacidade">Os registros guardam identificadores sorteados, nunca nomes. ' +
      "Ficam na planilha por até " + esc(resumo.retencao || 90) + " dias e só aparecem aqui, " +
      "depois da senha de manutenção.</div>";
  }

  /* ---------------------------------------------------- logs */

  var filtros = { busca: "", nivel: "", pagina: "" };

  function logsFiltrados() {
    var lista = (base.logs || []).filter(function (l) {
      if (filtros.nivel && l.nivel !== filtros.nivel) return false;
      if (filtros.pagina && l.pagina !== filtros.pagina) return false;
      if (filtros.busca) {
        var alvo = ((l.evento || "") + " " + (l.mensagem || "") + " " + (l.versao || "")).toLowerCase();
        if (alvo.indexOf(filtros.busca.toLowerCase()) < 0) return false;
      }
      return true;
    });
    lista.sort(function (a, b) {
      var x = String(a.quando || ""), y = String(b.quando || "");
      return ordemDesc ? y.localeCompare(x) : x.localeCompare(y);
    });
    return lista;
  }

  function telaLogs() {
    var paginas = {};
    (base.logs || []).forEach(function (l) { if (l.pagina) paginas[l.pagina] = 1; });

    var lista = logsFiltrados();
    var mostrando = lista.slice(0, limite);

    var html = '<div class="ferramentas">' +
      '<input type="search" id="f-busca" placeholder="Pesquisar evento ou mensagem…" value="' +
      esc(filtros.busca) + '">' +
      '<select id="f-nivel"><option value="">Todos os níveis</option>' +
      ["INFO", "WARNING", "ERROR", "SECURITY"].map(function (n) {
        return '<option value="' + n + '"' + (filtros.nivel === n ? " selected" : "") + ">" + n + "</option>";
      }).join("") + "</select>" +
      '<select id="f-pagina"><option value="">Todas as páginas</option>' +
      Object.keys(paginas).sort().map(function (p) {
        return '<option value="' + esc(p) + '"' + (filtros.pagina === p ? " selected" : "") + ">" +
          esc(p) + "</option>";
      }).join("") + "</select>" +
      '<button class="btn-fino" id="f-ordem">' + (ordemDesc ? "Mais novos ▾" : "Mais antigos ▴") + "</button>" +
      '<button class="btn-fino" id="f-atualizar">Atualizar</button>' +
      '<button class="btn-fino perigo" id="f-limpar">Limpar</button>' +
      "</div>";

    if (!mostrando.length) {
      return html + '<div class="vazio">Nenhum registro para este filtro.</div>';
    }

    html += '<table class="tabela"><thead><tr>' +
      '<th class="ordenavel" id="th-data">Quando</th><th>Nível</th><th>Evento</th>' +
      "<th>Página</th><th>Mensagem</th></tr></thead><tbody>" +
      mostrando.map(function (l, i) {
        return '<tr data-linha="' + i + '">' +
          '<td class="quando">' + esc(dataHora(l.quando)) + "</td>" +
          '<td><span class="nivel ' + esc(l.nivel) + '">' + esc(l.nivel) + "</span></td>" +
          '<td class="evento">' + esc(l.evento) + "</td>" +
          "<td>" + esc(l.pagina) + "</td>" +
          "<td>" + esc(l.mensagem) + "</td></tr>";
      }).join("") + "</tbody></table>";

    if (lista.length > limite) {
      html += '<div style="text-align:center;margin-top:14px">' +
        '<button class="btn-fino" id="f-mais">Mostrar mais (' + (lista.length - limite) + " restantes)</button></div>";
    }

    if (selecionado) {
      html += '<div class="detalhe">' + esc(
        "ID:        " + selecionado.id + "\n" +
        "Quando:    " + dataHora(selecionado.quando) + "\n" +
        "Nível:     " + selecionado.nivel + "\n" +
        "Evento:    " + selecionado.evento + "\n" +
        "Página:    " + selecionado.pagina + "\n" +
        "Versão:    " + (selecionado.versao || "—") + "\n" +
        "Sessão:    " + (selecionado.sessao || "—") + "\n\n" +
        selecionado.mensagem) + "</div>";
    }

    return html;
  }

  /* ---------------------------------------------------- acessos */

  function blocoSessao(s, titulo) {
    function linha(rot, v) {
      return '<div class="cartao"><div class="rot">' + esc(rot) + "</div>" + valor(v) + "</div>";
    }
    return '<div class="sessao-bloco"><h4>' + esc(titulo || s.id) + "</h4>" +
      '<div class="resumo">' + esc(s.paginas || "1") + " página(s) · entrou por " +
      esc(s.entrada || "—") + " · " + esc(s.versao || "versão não registrada") + "</div>" +
      '<div class="grade">' +
      linha("Primeiro acesso", dataHora(s.primeiroAcesso)) +
      linha("Último acesso", dataHora(s.ultimoAcesso)) +
      linha("Página atual", s.atual) +
      linha("Origem", s.referrer) +
      linha("Navegador", s.navegador) +
      linha("Plataforma", s.plataforma) +
      linha("Idioma", s.idioma) +
      linha("Idiomas aceitos", s.idiomas) +
      linha("Cookies", s.cookies) +
      linha("Tela", s.tela) +
      linha("Janela", s.viewport) +
      linha("Densidade", s.dpr) +
      linha("Toque", s.toque) +
      linha("Tipo de aparelho", s.tipo) +
      linha("Fuso", s.fuso) +
      linha("Conexão", s.conexao) +
      linha("Memória", s.memoria) +
      linha("Processadores", s.nucleos) +
      linha("Não rastrear", s.dnt) +
      "</div></div>";
  }

  function telaAcessos() {
    var minha = tentar(function () { return global.FloreSerLogs.sessao(); }, null);
    var html = '<div class="nota-privacidade">Só o que o navegador entrega sem pedir permissão. ' +
      "Sem localização, sem câmera, sem microfone e sem identificação pessoal — o identificador " +
      "da sessão é sorteado.</div>";

    if (minha) html += '<div class="titulo-secao">Esta sessão</div>' + blocoSessao(minha, "Esta sessão · " + minha.id);

    var outras = (base.sessoes || []).filter(function (s) { return !minha || s.id !== minha.id; });
    html += '<div class="titulo-secao">Sessões registradas (' + outras.length + ")</div>";
    if (!outras.length) return html + '<div class="vazio">Nenhuma outra sessão registrada ainda.</div>';
    return html + outras.slice(0, 40).map(function (s) { return blocoSessao(s); }).join("");
  }

  /* ---------------------------------------------------- usuários */

  function carregarUsuarios(depois) {
    chamar({ acao: "usuarios_listar", token: credencial() }).then(function (r) {
      if (r && r.erro === "sessao") { credencial(null); fechar(dlgPainel); pedirSenha(); return; }
      usuarios = (r && r.ok && r.usuarios) ? r.usuarios : [];
      if (typeof depois === "function") depois();
      desenhar();
    }).catch(function () {
      recadoUsuario = "N\u00e3o foi poss\u00edvel falar com o servidor.";
      desenhar();
    });
  }

  function operarUsuario(corpo) {
    corpo.token = credencial();
    chamar(corpo).then(function (r) {
      if (r && r.erro === "sessao") { credencial(null); fechar(dlgPainel); pedirSenha(); return; }
      if (r && r.ok) {
        usuarios = r.usuarios || usuarios;
        formUsuario = null;
        fotoForm = { acao: "manter", dados: "" };
        /* o cadastro entrou, mas a foto pode ter sido recusada */
        recadoUsuario = r.aviso || "";
      } else {
        recadoUsuario = (r && r.mensagem) || "N\u00e3o foi poss\u00edvel concluir.";
      }
      desenhar();
    }).catch(function () {
      recadoUsuario = "Sem conex\u00e3o com o servidor.";
      desenhar();
    });
  }

  function selosDoUsuario(u) {
    var p = u.permissoes || {};
    var quais = [];
    if (p.crm) quais.push("CRM");
    if (p.agenda) quais.push("Agenda");
    if (p.entradas) quais.push("Entradas");
    if (!quais.length) quais.push("sem m\u00f3dulos");
    return quais.join(" &middot; ");
  }

  function caixa(nome, rotulo, marcado) {
    return '<label class="marcar"><input type="checkbox" data-campo="' + nome + '"' +
      (marcado ? " checked" : "") + "> " + rotulo + "</label>";
  }

  /* A foto escolhida vive aqui at\u00e9 a pessoa salvar: "manter" n\u00e1o mexe no
     que j\u00e1 existe, "trocar" leva a imagem nova e "remover" apaga a atual. */
  var fotoForm = { acao: "manter", dados: "" };

  function avatarDoPainel(u, px) {
    var tamanho = px || 40;
    var estilo = 'style="width:' + tamanho + "px;height:" + tamanho + 'px"';
    if (u && u.foto) {
      return '<img class="fs-avatar" ' + estilo + ' src="' + esc(u.foto) + '" alt="" aria-hidden="true">';
    }
    var letras = (global.FloreSerAuth && global.FloreSerAuth.iniciais)
      ? global.FloreSerAuth.iniciais(u && u.nome) : "?";
    return '<span class="fs-avatar fs-avatar-letras" ' + estilo + ' aria-hidden="true">' +
      esc(letras) + "</span>";
  }

  /* O que aparece no cart\u00e1o do formul\u00e1rio: a escolha da vez, se houver, e
     sen\u00e1o o que j\u00e1 est\u00e1 guardado para essa pessoa. */
  function fotoEmEdicao(u) {
    if (fotoForm.acao === "trocar") return { nome: u.nome, foto: fotoForm.dados };
    if (fotoForm.acao === "remover") return { nome: u.nome, foto: "" };
    return { nome: u.nome, foto: u.foto || "" };
  }

  function formularioUsuario() {
    var novo = formUsuario === "novo";
    var u = novo ? { permissoes: {} } : (formUsuario || {});
    var p = u.permissoes || {};
    var vendo = fotoEmEdicao(u);
    var temFoto = !!vendo.foto;
    return '<div class="form-usuario">' +
      '<div class="titulo-secao">' + (novo ? "Novo usu\u00e1rio" : "Editar usu\u00e1rio") + "</div>" +
      '<div class="campo-foto">' +
      '<div class="previa-foto">' + avatarDoPainel(vendo, 72) + "</div>" +
      '<div class="acoes-foto">' +
      '<div class="rotulo-foto">Foto de perfil</div>' +
      '<p class="dica-foto">Quadrada fica melhor. A imagem \u00e9 reduzida aqui mesmo, ' +
      "antes de subir.</p>" +
      '<input type="file" id="u-foto-arquivo" accept="image/png,image/jpeg,image/webp" hidden>' +
      '<div class="botoes-foto">' +
      '<button class="btn-fino" id="u-foto-escolher">' +
      (temFoto ? "Trocar foto" : "Escolher foto") + "</button>" +
      (temFoto ? '<button class="btn-fino perigo" id="u-foto-remover">Remover</button>' : "") +
      "</div></div></div>" +
      '<label class="rot">Nome<input id="u-nome" type="text" value="' + esc(u.nome || "") + '"></label>' +
      '<label class="rot">Usu\u00e1rio<input id="u-login" type="text" autocapitalize="none" ' +
      'spellcheck="false" value="' + esc(u.usuario || "") + '"></label>' +
      (novo
        ? '<label class="rot">Senha<input id="u-senha" type="password" autocomplete="new-password"></label>' +
          '<label class="rot">Confirmar senha<input id="u-senha2" type="password" autocomplete="new-password"></label>'
        : "") +
      '<div class="titulo-secao">Permiss\u00f5es</div>' +
      '<div class="marcadores">' +
      caixa("crm", "CRM", !!p.crm) +
      caixa("agenda", "Agenda", !!p.agenda) +
      caixa("entradas", "Entradas", !!p.entradas) +
      caixa("admin", "Administrador (abre todos)", !!u.admin) +
      "</div>" +
      (recadoUsuario ? '<div class="aviso-form">' + esc(recadoUsuario) + "</div>" : "") +
      '<div class="acoes-form">' +
      '<button class="btn-fino" id="u-salvar">' + (novo ? "Criar usu\u00e1rio" : "Salvar") + "</button>" +
      '<button class="btn-fino" id="u-cancelar">Cancelar</button>' +
      "</div></div>";
  }

  function formularioSenha() {
    var u = formUsuario.senha;
    return '<div class="form-usuario">' +
      '<div class="titulo-secao">Redefinir senha de ' + esc(u.nome) + "</div>" +
      '<label class="rot">Nova senha<input id="u-senha" type="password" autocomplete="new-password"></label>' +
      '<label class="rot">Confirmar nova senha<input id="u-senha2" type="password" autocomplete="new-password"></label>' +
      '<p class="nota-privacidade">A senha anterior deixa de funcionar na hora, e as sess\u00f5es ' +
      "abertas dessa pessoa s\u00e3o encerradas.</p>" +
      (recadoUsuario ? '<div class="aviso-form">' + esc(recadoUsuario) + "</div>" : "") +
      '<div class="acoes-form">' +
      '<button class="btn-fino" id="u-salvar-senha">Redefinir</button>' +
      '<button class="btn-fino" id="u-cancelar">Cancelar</button>' +
      "</div></div>";
  }

  function telaUsuarios() {
    if (formUsuario && formUsuario.senha) return formularioSenha();
    if (formUsuario) return formularioUsuario();

    var alvo = buscaUsuario.toLowerCase();
    var lista = usuarios.filter(function (u) {
      if (!alvo) return true;
      return (u.nome + " " + u.usuario).toLowerCase().indexOf(alvo) >= 0;
    });

    var html = '<div class="ferramentas">' +
      '<input type="search" id="u-busca" placeholder="Buscar usu\u00e1rio\u2026" value="' +
      esc(buscaUsuario) + '">' +
      '<button class="btn-fino" id="u-novo">+ Novo usu\u00e1rio</button>' +
      '<button class="btn-fino" id="u-atualizar">Atualizar</button>' +
      "</div>" +
      '<p class="nota-privacidade">Os usu\u00e1rios entram pelos m\u00f3dulos, no bot\u00e3o ' +
      "\u201cEntrar com usu\u00e1rio\u201d. A senha compartilhada de cada m\u00f3dulo continua " +
      "valendo do mesmo jeito. Senhas nunca s\u00e3o mostradas aqui \u2014 nem para mim.</p>";

    if (recadoUsuario) html += '<div class="aviso-form">' + esc(recadoUsuario) + "</div>";

    if (!lista.length) {
      return html + '<div class="vazio">' +
        (usuarios.length ? "Nenhum usu\u00e1rio com esse nome."
          : "Nenhum usu\u00e1rio cadastrado ainda. Crie o primeiro no bot\u00e3o acima.") +
        "</div>";
    }

    return html + lista.map(function (u) {
      return '<div class="cartao-usuario' + (u.ativo ? "" : " inativo") + '">' +
        '<div class="topo-usuario">' +
        avatarDoPainel(u, 40) +
        "<div><h4>" + esc(u.nome) + "</h4>" +
        '<div class="arroba">@' + esc(u.usuario) + (u.admin ? " &middot; administrador" : "") + "</div></div>" +
        '<span class="selo-status">' + (u.ativo ? "Ativo" : "Inativo") + "</span>" +
        "</div>" +
        '<div class="modulos-usuario">' + selosDoUsuario(u) + "</div>" +
        '<div class="ultimo-login">\u00daltimo login: ' +
        (u.ultimoLogin ? dataHora(u.ultimoLogin) : "nunca entrou") + "</div>" +
        '<div class="acoes-usuario">' +
        '<button class="btn-fino" data-editar="' + esc(u.id) + '">Editar</button>' +
        '<button class="btn-fino" data-senha="' + esc(u.id) + '">Redefinir senha</button>' +
        '<button class="btn-fino' + (u.ativo ? " perigo" : "") + '" data-status="' + esc(u.id) +
        '" data-ativo="' + (u.ativo ? "0" : "1") + '">' +
        (u.ativo ? "Desativar" : "Reativar") + "</button>" +
        "</div></div>";
    }).join("");
  }

  /* ---------- foto de perfil ----------
     A imagem sai do computador da pessoa e vai para a planilha, ent\u00e1o precisa
     ser pequena. Reduzimos aqui mesmo, antes de subir: corte quadrado pelo
     centro, 128 px de lado, JPEG. Uma foto de celular de 4 MB vira uns 8 KB,
     que cabem folgados numa c\u00e9lula. */
  var LADO_FOTO = 128;
  var QUALIDADE_FOTO = 0.82;
  var TETO_ARQUIVO = 12 * 1024 * 1024;

  function reduzirImagem(arquivo) {
    return new Promise(function (resolve, reject) {
      if (arquivo.size > TETO_ARQUIVO) {
        reject(new Error("O arquivo \u00e9 grande demais. Escolha uma imagem menor."));
        return;
      }
      var leitor = new FileReader();
      leitor.onerror = function () { reject(new Error("N\u00e1o foi poss\u00edvel ler o arquivo.")); };
      leitor.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("Esse arquivo n\u00e1o \u00e9 uma imagem v\u00e1lida.")); };
        img.onload = function () {
          try {
            var lado = Math.min(img.naturalWidth, img.naturalHeight);
            if (!lado) throw new Error("imagem vazia");
            var tela = document.createElement("canvas");
            tela.width = LADO_FOTO;
            tela.height = LADO_FOTO;
            var pincel = tela.getContext("2d");
            /* fundo branco: PNG com transpar\u00e9ncia n\u00e1o vira JPEG preto */
            pincel.fillStyle = "#FFFFFF";
            pincel.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
            pincel.drawImage(img,
              (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado,
              0, 0, LADO_FOTO, LADO_FOTO);
            resolve(tela.toDataURL("image/jpeg", QUALIDADE_FOTO));
          } catch (e) {
            reject(new Error("N\u00e1o foi poss\u00edvel preparar a imagem."));
          }
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arquivo);
    });
  }

  function ligarEventosFoto() {
    var campo = document.getElementById("u-foto-arquivo");
    var escolher = document.getElementById("u-foto-escolher");
    var remover = document.getElementById("u-foto-remover");

    if (escolher && campo) {
      escolher.addEventListener("click", function () { campo.click(); });
      campo.addEventListener("change", async function () {
        var arquivo = campo.files && campo.files[0];
        if (!arquivo) return;
        recadoUsuario = "";
        try {
          fotoForm = { acao: "trocar", dados: await reduzirImagem(arquivo) };
        } catch (e) {
          fotoForm = { acao: "manter", dados: "" };
          recadoUsuario = e.message;
        }
        desenhar();
      });
    }

    if (remover) remover.addEventListener("click", function () {
      fotoForm = { acao: "remover", dados: "" };
      recadoUsuario = "";
      desenhar();
    });
  }

  function acharUsuario(id) {
    var achados = usuarios.filter(function (u) { return u.id === id; });
    return achados.length ? achados[0] : null;
  }

  function lerFormulario() {
    var corpo = {
      nome: (document.getElementById("u-nome") || {}).value || "",
      usuario: (document.getElementById("u-login") || {}).value || "",
      fotoAcao: fotoForm.acao,
    };
    if (fotoForm.acao === "trocar") corpo.foto = fotoForm.dados;
    Array.prototype.forEach.call(dlgPainel.querySelectorAll("[data-campo]"), function (c) {
      corpo[c.getAttribute("data-campo")] = c.checked;
    });
    return corpo;
  }

  function senhasConferem() {
    var a = (document.getElementById("u-senha") || {}).value || "";
    var b = (document.getElementById("u-senha2") || {}).value || "";
    if (a.length < 6) { recadoUsuario = "A senha precisa de pelo menos 6 caracteres."; return null; }
    if (a !== b) { recadoUsuario = "As duas senhas n\u00e3o s\u00e3o iguais."; return null; }
    return a;
  }

  function ligarEventosUsuarios() {
    var busca = document.getElementById("u-busca");
    if (busca) {
      busca.addEventListener("input", function () {
        buscaUsuario = busca.value;
        var onde = busca.selectionStart;
        desenhar();
        var novo = document.getElementById("u-busca");
        if (novo) { novo.focus(); novo.setSelectionRange(onde, onde); }
      });
    }

    ligarEventosFoto();

    var novo = document.getElementById("u-novo");
    if (novo) novo.addEventListener("click", function () {
      formUsuario = "novo"; recadoUsuario = ""; fotoForm = { acao: "manter", dados: "" };
      desenhar();
    });

    var atualizar = document.getElementById("u-atualizar");
    if (atualizar) atualizar.addEventListener("click", function () { carregarUsuarios(); });

    var cancelar = document.getElementById("u-cancelar");
    if (cancelar) cancelar.addEventListener("click", function () {
      formUsuario = null; recadoUsuario = ""; fotoForm = { acao: "manter", dados: "" };
      desenhar();
    });

    var salvar = document.getElementById("u-salvar");
    if (salvar) salvar.addEventListener("click", function () {
      var corpo = lerFormulario();
      recadoUsuario = "";
      if (formUsuario === "novo") {
        var senha = senhasConferem();
        if (!senha) { desenhar(); return; }
        corpo.acao = "usuario_criar";
        corpo.senha = senha;
      } else {
        corpo.acao = "usuario_editar";
        corpo.id = formUsuario.id;
      }
      operarUsuario(corpo);
    });

    var salvarSenha = document.getElementById("u-salvar-senha");
    if (salvarSenha) salvarSenha.addEventListener("click", function () {
      recadoUsuario = "";
      var senha = senhasConferem();
      if (!senha) { desenhar(); return; }
      operarUsuario({ acao: "usuario_senha", id: formUsuario.senha.id, senha: senha });
    });

    Array.prototype.forEach.call(dlgPainel.querySelectorAll("[data-editar]"), function (b) {
      b.addEventListener("click", function () {
        formUsuario = acharUsuario(b.getAttribute("data-editar"));
        recadoUsuario = "";
        fotoForm = { acao: "manter", dados: "" };
        desenhar();
      });
    });

    Array.prototype.forEach.call(dlgPainel.querySelectorAll("[data-senha]"), function (b) {
      b.addEventListener("click", function () {
        formUsuario = { senha: acharUsuario(b.getAttribute("data-senha")) };
        recadoUsuario = "";
        desenhar();
      });
    });

    Array.prototype.forEach.call(dlgPainel.querySelectorAll("[data-status]"), function (b) {
      b.addEventListener("click", function () {
        var ativo = b.getAttribute("data-ativo") === "1";
        var u = acharUsuario(b.getAttribute("data-status"));
        if (!ativo && u && !confirm("Desativar " + u.nome +
          "? As sess\u00f5es abertas dessa pessoa ser\u00e3o encerradas.")) return;
        operarUsuario({ acao: "usuario_status", id: b.getAttribute("data-status"), ativo: ativo });
      });
    });
  }

  /* ---------------------------------------------------- lixeira */

  function carregarLixeira(depois) {
    chamar({ acao: "lixeira_listar", token: credencial() }).then(function (r) {
      if (r && r.erro === "sessao") { credencial(null); fechar(dlgPainel); pedirSenha(); return; }
      if (r && r.ok) {
        lixeira = r.itens || [];
        lixeiraDias = r.dias || lixeiraDias;
      }
      if (typeof depois === "function") depois();
      desenhar();
      marcarBadgeLixeira();
    }).catch(function () {
      recadoLixeira = "N\u00e3o foi poss\u00edvel falar com o servidor.";
      desenhar();
    });
  }

  function operarLixeira(corpo, aoTerminar) {
    corpo.token = credencial();
    chamar(corpo).then(function (r) {
      if (r && r.erro === "sessao") { credencial(null); fechar(dlgPainel); pedirSenha(); return; }
      if (r && r.ok) {
        if (r.lixeira) lixeira = r.lixeira;
        confirmandoLixeira = null;
        recadoLixeira = "";
        if (typeof aoTerminar === "function") aoTerminar(r);
      } else if (r && r.erro === "conflito") {
        confirmandoLixeira = { acao: "conflito", item: confirmandoLixeira && confirmandoLixeira.item,
          mensagem: r.mensagem || "Pode haver um registro parecido j\u00e1 ativo." };
      } else {
        recadoLixeira = "N\u00e3o foi poss\u00edvel concluir a opera\u00e7\u00e3o. Tente novamente.";
      }
      desenhar();
      marcarBadgeLixeira();
    }).catch(function () {
      recadoLixeira = "Sem conex\u00e3o com o servidor.";
      desenhar();
    });
  }

  function expirados() {
    return lixeira.filter(function (i) { return i.expirado; });
  }

  function marcarBadgeLixeira() {
    var b = document.getElementById("aba-lixeira");
    if (!b) return;
    b.textContent = lixeira.length ? "Lixeira (" + lixeira.length + ")" : "Lixeira";
  }

  var NOMES_TIPO = { crm: "CRM", agenda: "Agenda", entradas: "Entradas" };

  function prazoEmTexto(item) {
    if (item.expirado) return "Prazo de recupera\u00e7\u00e3o expirado";
    if (item.diasRestantes <= 1) return "Expira hoje";
    return "Expira em " + item.diasRestantes + " dias";
  }

  function confirmacaoLixeira() {
    var c = confirmandoLixeira;
    var i = c.item || {};

    if (c.acao === "restaurar") {
      return '<div class="form-usuario">' +
        '<div class="titulo-secao">Restaurar registro</div>' +
        "<p>Restaurar <strong>" + esc(i.titulo) + "</strong>?</p>" +
        '<p class="nota-privacidade">O registro volta a aparecer normalmente em ' +
        esc(NOMES_TIPO[i.tipo] || i.tipo) + ", com os mesmos dados e o mesmo identificador.</p>" +
        '<div class="acoes-form">' +
        '<button class="btn-fino" id="lx-ok">Restaurar</button>' +
        '<button class="btn-fino" id="lx-cancelar">Cancelar</button>' +
        "</div></div>";
    }

    if (c.acao === "conflito") {
      return '<div class="form-usuario">' +
        '<div class="titulo-secao">Poss\u00edvel conflito</div>' +
        '<div class="aviso-form">' + esc(c.mensagem) + "</div>" +
        '<p class="nota-privacidade">Restaurar assim mesmo deixa os dois registros ativos. ' +
        "Depois d\u00e1 para juntar ou mandar o repetido para a lixeira.</p>" +
        '<div class="acoes-form">' +
        '<button class="btn-fino perigo" id="lx-forcar">Restaurar mesmo assim</button>' +
        '<button class="btn-fino" id="lx-cancelar">Cancelar</button>' +
        "</div></div>";
    }

    if (c.acao === "excluir") {
      return '<div class="form-usuario">' +
        '<div class="titulo-secao perigo-titulo">Exclus\u00e3o definitiva</div>' +
        "<p><strong>" + esc(i.titulo) + "</strong> ser\u00e1 apagado permanentemente.</p>" +
        '<p class="nota-privacidade">Depois desta a\u00e7\u00e3o o registro n\u00e3o pode mais ser ' +
        "restaurado pela lixeira.</p>" +
        '<label class="rot">Digite EXCLUIR para confirmar<input id="lx-palavra" type="text" ' +
        'autocapitalize="characters" spellcheck="false"></label>' +
        (recadoLixeira ? '<div class="aviso-form">' + esc(recadoLixeira) + "</div>" : "") +
        '<div class="acoes-form">' +
        '<button class="btn-fino perigo" id="lx-ok">Excluir definitivamente</button>' +
        '<button class="btn-fino" id="lx-cancelar">Cancelar</button>' +
        "</div></div>";
    }

    /* limpar expirados */
    var contas = c.contas || {};
    return '<div class="form-usuario">' +
      '<div class="titulo-secao perigo-titulo">Limpar itens expirados</div>' +
      "<p>Existem <strong>" + (c.quantos || 0) + "</strong> registro(s) na lixeira h\u00e1 mais de " +
      lixeiraDias + " dias. Esta a\u00e7\u00e3o vai apag\u00e1-los permanentemente.</p>" +
      '<div class="modulos-usuario">CRM: ' + (contas.crm || 0) +
      " &middot; Agenda: " + (contas.agenda || 0) +
      " &middot; Entradas: " + (contas.entradas || 0) + "</div>" +
      '<label class="rot">Digite EXCLUIR para confirmar<input id="lx-palavra" type="text" ' +
      'autocapitalize="characters" spellcheck="false"></label>' +
      (recadoLixeira ? '<div class="aviso-form">' + esc(recadoLixeira) + "</div>" : "") +
      '<div class="acoes-form">' +
      '<button class="btn-fino perigo" id="lx-ok">Continuar</button>' +
      '<button class="btn-fino" id="lx-cancelar">Cancelar</button>' +
      "</div></div>";
  }

  function telaLixeira() {
    if (confirmandoLixeira) return confirmacaoLixeira();

    var vencidos = expirados().length;

    var html = '<div class="ferramentas">' +
      '<input type="search" id="lx-busca" placeholder="Buscar na lixeira\u2026" value="' +
      esc(buscaLixeira) + '">' +
      '<select id="lx-tipo">' +
      [["todos", "Todos os m\u00f3dulos"], ["crm", "CRM"], ["agenda", "Agenda"],
       ["entradas", "Entradas"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (filtroTipo === o[0] ? " selected" : "") + ">" +
          o[1] + "</option>";
      }).join("") + "</select>" +
      '<select id="lx-prazo">' +
      [["todos", "Todos os prazos"], ["ativos", "Dentro do prazo"], ["expirados", "Expirados"]]
        .map(function (o) {
          return '<option value="' + o[0] + '"' + (filtroPrazo === o[0] ? " selected" : "") + ">" +
            o[1] + "</option>";
        }).join("") + "</select>" +
      '<select id="lx-ordem">' +
      [["recentes", "Exclu\u00eddos recentemente"], ["antigos", "Exclu\u00eddos h\u00e1 mais tempo"],
       ["prazo", "Expira primeiro"], ["nome", "Nome"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (ordemLixeira === o[0] ? " selected" : "") + ">" +
          o[1] + "</option>";
      }).join("") + "</select>" +
      '<button class="btn-fino" id="lx-atualizar">Atualizar</button>' +
      (vencidos ? '<button class="btn-fino perigo" id="lx-limpar">Limpar expirados (' +
        vencidos + ")</button>" : "") +
      "</div>" +
      '<p class="nota-privacidade">O que \u00e9 exclu\u00eddo nos m\u00f3dulos vem parar aqui e pode ' +
      "voltar por " + lixeiraDias + " dias. Nada sai da lixeira sozinho: apagar de vez \u00e9 " +
      "sempre uma decis\u00e3o tomada nesta tela.</p>";

    if (recadoLixeira) html += '<div class="aviso-form">' + esc(recadoLixeira) + "</div>";

    var alvo = buscaLixeira.toLowerCase();
    var lista = lixeira.filter(function (i) {
      if (filtroTipo !== "todos" && i.tipo !== filtroTipo) return false;
      if (filtroPrazo === "ativos" && i.expirado) return false;
      if (filtroPrazo === "expirados" && !i.expirado) return false;
      if (!alvo) return true;
      return (i.titulo + " " + i.descricao + " " + i.excluidoPor + " " + i.motivo + " " +
        i.registroId).toLowerCase().indexOf(alvo) >= 0;
    });

    lista.sort(function (a, b) {
      if (ordemLixeira === "antigos") return a.excluidoEm - b.excluidoEm;
      /* dias inteiros empatam entre si; o instante da exclusão desempata */
      if (ordemLixeira === "prazo") return a.excluidoEm - b.excluidoEm;
      if (ordemLixeira === "nome") return String(a.titulo).localeCompare(String(b.titulo));
      return b.excluidoEm - a.excluidoEm;
    });

    if (!lista.length) {
      return html + '<div class="vazio">' +
        (lixeira.length ? "Nenhum registro com esse filtro." : "A lixeira est\u00e1 vazia.") +
        "</div>";
    }

    return html + lista.map(function (i) {
      return '<div class="cartao-usuario' + (i.expirado ? " inativo" : "") + '">' +
        '<div class="topo-usuario">' +
        "<div><h4>" + esc(i.titulo) + "</h4>" +
        '<div class="arroba">' + esc(i.descricao) + "</div></div>" +
        '<span class="selo-status">' + esc(NOMES_TIPO[i.tipo] || i.tipo) + "</span>" +
        "</div>" +
        '<div class="ultimo-login">Exclu\u00eddo em ' + dataHora(new Date(i.excluidoEm).toISOString()) +
        " &middot; por " + esc(i.excluidoPor || "\u2014") + "</div>" +
        (i.motivo ? '<div class="modulos-usuario">Motivo: ' + esc(i.motivo) + "</div>" : "") +
        '<div class="modulos-usuario' + (i.expirado ? " alerta-prazo" : "") + '">' +
        prazoEmTexto(i) + "</div>" +
        '<div class="acoes-usuario">' +
        '<button class="btn-fino" data-lx-restaurar="' + esc(i.id) + '">Restaurar</button>' +
        '<button class="btn-fino perigo" data-lx-excluir="' + esc(i.id) + '">Excluir definitivamente</button>' +
        "</div></div>";
    }).join("");
  }

  function acharNaLixeira(id) {
    var achados = lixeira.filter(function (i) { return i.id === id; });
    return achados.length ? achados[0] : null;
  }

  function ligarEventosLixeira() {
    var busca = document.getElementById("lx-busca");
    if (busca) {
      busca.addEventListener("input", function () {
        buscaLixeira = busca.value;
        var onde = busca.selectionStart;
        desenhar();
        var novo = document.getElementById("lx-busca");
        if (novo) { novo.focus(); novo.setSelectionRange(onde, onde); }
      });
    }

    [["lx-tipo", function (v) { filtroTipo = v; }],
     ["lx-prazo", function (v) { filtroPrazo = v; }],
     ["lx-ordem", function (v) { ordemLixeira = v; }]].forEach(function (par) {
      var el = document.getElementById(par[0]);
      if (el) el.addEventListener("change", function () { par[1](el.value); desenhar(); });
    });

    var atualizar = document.getElementById("lx-atualizar");
    if (atualizar) atualizar.addEventListener("click", function () { carregarLixeira(); });

    var limpar = document.getElementById("lx-limpar");
    if (limpar) limpar.addEventListener("click", function () {
      /* primeiro só conta, sem apagar nada */
      operarLixeira({ acao: "lixeira_limpar" }, function (r) {
        confirmandoLixeira = { acao: "limpar", quantos: r.quantos, contas: r.contas };
        desenhar();
      });
    });

    Array.prototype.forEach.call(dlgPainel.querySelectorAll("[data-lx-restaurar]"), function (b) {
      b.addEventListener("click", function () {
        confirmandoLixeira = { acao: "restaurar", item: acharNaLixeira(b.getAttribute("data-lx-restaurar")) };
        recadoLixeira = "";
        desenhar();
      });
    });

    Array.prototype.forEach.call(dlgPainel.querySelectorAll("[data-lx-excluir]"), function (b) {
      b.addEventListener("click", function () {
        confirmandoLixeira = { acao: "excluir", item: acharNaLixeira(b.getAttribute("data-lx-excluir")) };
        recadoLixeira = "";
        desenhar();
      });
    });

    var cancelar = document.getElementById("lx-cancelar");
    if (cancelar) cancelar.addEventListener("click", function () {
      confirmandoLixeira = null; recadoLixeira = ""; desenhar();
    });

    var forcar = document.getElementById("lx-forcar");
    if (forcar) forcar.addEventListener("click", function () {
      var i = confirmandoLixeira.item;
      operarLixeira({ acao: "lixeira_restaurar", id: i.id, forcar: true });
    });

    var ok = document.getElementById("lx-ok");
    if (ok) ok.addEventListener("click", function () {
      var c = confirmandoLixeira;
      if (c.acao === "restaurar") {
        operarLixeira({ acao: "lixeira_restaurar", id: c.item.id });
        return;
      }
      /* dupla confirmação: a palavra digitada */
      var palavra = (document.getElementById("lx-palavra") || {}).value || "";
      if (palavra.trim().toUpperCase() !== "EXCLUIR") {
        recadoLixeira = "Digite EXCLUIR para confirmar.";
        desenhar();
        return;
      }
      if (c.acao === "excluir") operarLixeira({ acao: "lixeira_excluir", id: c.item.id, confirmar: true });
      else operarLixeira({ acao: "lixeira_limpar", confirmar: true });
    });
  }

  /* ---------------------------------------------------- sistema */

  /* O que o Service Worker respondeu da última vez. A pergunta é assíncrona
     e a tela se desenha de uma vez, então guardamos a resposta e mandamos
     redesenhar quando ela chega. */
  var estadoPWA = null;
  var recadoPWA = "";

  function pedirEstadoPWA() {
    if (!global.Alveare || !global.Alveare.estadoTecnico) return;
    global.Alveare.estadoTecnico().then(function (e) {
      estadoPWA = e;
      if (aba === "sistema") desenhar();
    });
  }

  function telaSistema() {
    var s = tentar(function () { return global.FloreSerLogs.sessao(); }, {});
    var e = tentar(function () { return global.FloreSerLogs.estado(); }, {});
    var arm = tentar(function () { return global.FloreSerLogs.armazenamento(); }, null);
    var v = global.FLORESER || {};
    var atual = v.atual || {};
    var resumo = base.resumo || {};
    var p = estadoPWA || {
      suportado: "serviceWorker" in navigator, controlando: false,
      modo: "—", atualizacao: "—", conexao: navigator.onLine ? "online" : "offline",
      cache: "—", arquivos: 0,
    };

    return '<div class="titulo-secao">Navegador</div><div class="grade">' +
      cartao("Navegador", s.navegador) +
      cartao("Plataforma", s.plataforma) +
      cartao("Idioma", s.idioma) +
      cartao("Cookies", s.cookies) +
      cartao("Não rastrear", s.dnt) +
      cartao("User Agent", tentar(function () { return navigator.userAgent; }, "")) +
      "</div>" +

      '<div class="titulo-secao">Tela e aparelho</div><div class="grade">' +
      cartao("Tela", s.tela) +
      cartao("Janela", s.viewport) +
      cartao("Densidade", s.dpr) +
      cartao("Toque", s.toque) +
      cartao("Tipo", s.tipo) +
      cartao("Orientação", tentar(function () { return screen.orientation.type; }, "")) +
      "</div>" +

      '<div class="titulo-secao">Ambiente</div><div class="grade">' +
      cartao("Endereço", ambiente()) +
      cartao("Fuso", s.fuso) +
      cartao("Conexão", s.conexao) +
      cartao("Memória", s.memoria) +
      cartao("Processadores", s.nucleos) +
      cartao("Online", tentar(function () { return navigator.onLine ? "sim" : "não"; }, "")) +
      "</div>" +

      '<div class="titulo-secao">Site</div><div class="grade">' +
      cartao("Versão", "v" + (atual.versao || "?") + " — " + (atual.codinome || "")) +
      cartao("Publicada em", atual.data) +
      cartao("Peso da página", pesoDaPagina()) +
      cartao("Armazenamento", arm ? (arm.local && arm.sessao ? "Disponível"
        : arm.local || arm.sessao ? "Parcial" : "Bloqueado") : "") +
      cartao("Envios pendentes", String(e.pendentes === undefined ? "" : e.pendentes)) +
      cartao("Eventos enviados", String(e.enviados === undefined ? "" : e.enviados)) +
      "</div>" +

      '<div class="titulo-secao">Alveare (aplicativo)</div><div class="grade">' +
      cartao("Service Worker", !p.suportado ? "não suportado"
        : p.controlando ? "ativo" : "registrando…") +
      cartao("Modo", p.modo) +
      cartao("Conexão", p.conexao) +
      cartao("Atualização", p.atualizacao) +
      cartao("Cache", p.cache) +
      cartao("Arquivos guardados", String(p.arquivos)) +
      "</div>" +
      '<div class="acoes-form">' +
      '<button class="btn-fino" id="pwa-conferir">Conferir</button>' +
      '<button class="btn-fino perigo" id="pwa-limpar">Limpar cache do aplicativo</button>' +
      "</div>" +
      '<p class="nota-privacidade">Limpar o cache apaga só os arquivos guardados ' +
      "do aplicativo. Sessão, tema, foto e preferências não são tocadas — ninguém " +
      "sai do sistema por causa disso.</p>" +
      (recadoPWA ? '<div class="aviso-form">' + esc(recadoPWA) + "</div>" : "") +

      '<div class="titulo-secao">Planilha</div><div class="grade">' +
      cartao("Revisão do CRM", String(resumo.revCRM === undefined ? "" : resumo.revCRM)) +
      cartao("Revisão da agenda", String(resumo.revAgenda === undefined ? "" : resumo.revAgenda)) +
      cartao("Retenção", resumo.retencao ? resumo.retencao + " dias" : "") +
      cartao("Horário do servidor", resumo.servidor) +
      "</div>";
  }

  /* ---------------------------------------------------- eventos da tela */

  function ligarEventos() {
    var corpo = document.getElementById("painel-corpo");
    if (!corpo) return;

    function em(id, evento, f) {
      var el = corpo.querySelector(id);
      if (el) el.addEventListener(evento, f);
    }

    em("#f-busca", "input", function (ev) { filtros.busca = ev.target.value; limite = POR_PAGINA; desenhar(); });
    em("#f-nivel", "change", function (ev) { filtros.nivel = ev.target.value; limite = POR_PAGINA; desenhar(); });
    em("#f-pagina", "change", function (ev) { filtros.pagina = ev.target.value; limite = POR_PAGINA; desenhar(); });
    em("#f-ordem", "click", function () { ordemDesc = !ordemDesc; desenhar(); });
    em("#th-data", "click", function () { ordemDesc = !ordemDesc; desenhar(); });
    em("#f-mais", "click", function () { limite += POR_PAGINA; desenhar(); });
    em("#f-atualizar", "click", function () { selecionado = null; carregar(); });
    em("#f-limpar", "click", limpar);

    em("#pwa-conferir", "click", function () { recadoPWA = ""; pedirEstadoPWA(); });
    em("#pwa-limpar", "click", function () {
      if (!global.Alveare || !global.Alveare.limparCasca) return;
      recadoPWA = "Limpando…";
      desenhar();
      global.Alveare.limparCasca().then(function (deu) {
        recadoPWA = deu
          ? "Cache do aplicativo limpo. Os arquivos voltam a ser guardados no próximo acesso."
          : "Não foi possível limpar agora — o aplicativo ainda não está controlando esta aba.";
        estadoPWA = null;
        desenhar();
        pedirEstadoPWA();
      });
    });

    Array.prototype.forEach.call(corpo.querySelectorAll("[data-linha]"), function (tr) {
      tr.addEventListener("click", function () {
        var i = Number(tr.getAttribute("data-linha"));
        var lista = logsFiltrados().slice(0, limite);
        selecionado = (selecionado && lista[i] && selecionado.id === lista[i].id) ? null : lista[i];
        desenhar();
      });
    });
  }

  function limpar() {
    if (!global.confirm("Apagar todos os registros de log da planilha?\n\nO histórico de " +
      "diagnóstico é perdido e não tem como voltar. As sessões continuam.")) return;

    chamar({ acao: "dev_limpar", token: credencial(), alvo: "logs" }).then(function (r) {
      if (r && r.erro === "sessao") {
        credencial(null);
        fechar(dlgPainel);
        pedirSenha();
        return;
      }
      selecionado = null;
      carregar();
    }).catch(function () {
      desenhar("Não foi possível limpar agora: o servidor não respondeu.");
    });
  }
})(window);
