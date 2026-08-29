/* =====================================================================
   FloreSer · Corpo e Alma — histórico de alterações
   ---------------------------------------------------------------------
   Isto não é o log técnico. O painel de manutenção continua guardando
   erro, rede, sessão e segurança — coisa de quem conserta o sistema.
   Aqui é outra pergunta, a de quem usa a clínica: quem mexeu nesta ficha,
   o que mudou, quando, do que para o quê.

   Os três módulos mostram a mesma coisa do mesmo jeito, com o mesmo
   arquivo. Nada é calculado aqui: o servidor já manda a frase pronta, em
   português, porque é ele quem sabe quem fez — o navegador não tem como
   provar isso e não deve nem tentar.

   A lista não vem inteira. Chega quando a ficha abre, vinte por vez, com
   "Ver mais" para quem quiser cavar.
   ===================================================================== */

(function (global) {
  "use strict";

  /* ---------------------------------------------------------- aparência */

  var ESTILO = [
    ":root{",
    "  --au-texto:#2D2D2D; --au-suave:#6E655C; --au-teal:#3B6E6A;",
    "  --au-linha:#E2DED7; --au-fio:#C9D3CA; --au-selo:#E7EEEB;",
    "  --au-alerta:#A8452F;",
    "}",
    ':root[data-tema="escuro"]{',
    "  --au-texto:#E9E3DB; --au-suave:#B4ADA3; --au-teal:#7FB8B2;",
    "  --au-linha:#33403E; --au-fio:#3C5A56; --au-selo:#2A514D;",
    "  --au-alerta:#E79B82;",
    "}",

    ".au-lista,.au-lista *{box-sizing:border-box}",
    ".au-lista{font-family:'Montserrat',Calibri,system-ui,-apple-system,sans-serif;",
    "  color:var(--au-texto);font-size:13px;line-height:1.5}",

    /* o fio vertical que costura os acontecimentos */
    ".au-op{position:relative;padding:0 0 18px 20px;border-left:1px solid var(--au-linha)}",
    ".au-op:last-child{border-left-color:transparent;padding-bottom:2px}",
    ".au-op::before{content:'';position:absolute;left:-4.5px;top:5px;width:8px;height:8px;",
    "  border-radius:50%;background:var(--au-fio)}",
    ".au-op.au-forte::before{background:var(--au-teal)}",

    ".au-quando{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:7px}",
    ".au-data{font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;",
    "  font-weight:600;color:var(--au-teal)}",
    ".au-quem{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--au-suave)}",
    ".au-contexto{font-size:11px;color:var(--au-suave);font-style:italic}",

    ".au-titulo{font-size:13.5px;margin-bottom:5px}",
    ".au-campos{display:flex;flex-direction:column;gap:5px}",
    ".au-campo{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}",
    ".au-rot{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;",
    "  color:var(--au-suave);min-width:96px}",
    ".au-valores{flex:1 1 200px;min-width:0;word-break:break-word}",
    ".au-antes{color:var(--au-suave);text-decoration:line-through;",
    "  text-decoration-color:var(--au-fio)}",
    ".au-seta{color:var(--au-suave);margin:0 6px}",

    ".au-vazio,.au-erro{font-size:12.5px;color:var(--au-suave);padding:4px 0}",
    ".au-erro{color:var(--au-alerta)}",
    ".au-carregando{font-size:12.5px;color:var(--au-suave);padding:4px 0}",

    ".au-mais{margin-top:6px;border:1px solid var(--au-linha);background:none;",
    "  color:var(--au-teal);font:inherit;font-size:10.5px;letter-spacing:.14em;",
    "  text-transform:uppercase;padding:8px 15px;border-radius:999px;cursor:pointer;",
    "  transition:border-color .16s ease}",
    ".au-mais:hover{border-color:var(--au-teal)}",
    ".au-mais:focus-visible{outline:2px solid var(--au-teal);outline-offset:2px}",
    ".au-mais[disabled]{opacity:.6;cursor:default}",
  ].join("\n");

  var folhaPosta = false;
  function porEstilo() {
    if (folhaPosta || document.getElementById("au-estilo")) { folhaPosta = true; return; }
    var f = document.createElement("style");
    f.id = "au-estilo";
    f.textContent = ESTILO;
    (document.head || document.documentElement).appendChild(f);
    folhaPosta = true;
  }

  function esc(t) {
    return String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------------------------------------------------------- as frases
     O servidor manda ação, campo e valores. Aqui só se escolhe o verbo —
     e "registrou contato" é bem mais útil do que "alterou Último contato". */

  var VERBOS = {
    criou: "criou",
    criou_detalhe: "criou",
    alterou: "alterou a ficha",
    contato: "registrou contato",
    removeu: "removeu o registro",
    lixeira: "moveu para a lixeira",
    restaurou: "restaurou o registro",
    arquivou: "arquivou a ficha",
    restaurou_ficha: "reativou a ficha",
    adicionou: "alterou a ficha",
    retirou: "alterou a ficha",
    agendou: "marcou um agendamento",
    desmarcou: "desfez um agendamento",
    integrou: "integrou à Agenda",
    vinculou: "criou o vínculo",
    criou_do_crm: "criou a partir do CRM",
  };

  /* Uma operação pode ter várias linhas. O título vem da ação mais
     significativa do grupo — criar manda em alterar, integrar manda em
     tudo, porque é isso que a pessoa lembra ter feito. */
  var PESO = {
    criou: 90, criou_do_crm: 88, integrou: 86, vinculou: 84,
    lixeira: 80, restaurou: 78, removeu: 76,
    arquivou: 70, restaurou_ficha: 68,
    agendou: 60, desmarcou: 58, contato: 50,
    alterou: 10, adicionou: 10, retirou: 10, criou_detalhe: 5,
  };

  function acaoPrincipal(eventos) {
    var melhor = eventos[0];
    eventos.forEach(function (e) {
      if ((PESO[e.acao] || 0) > (PESO[melhor.acao] || 0)) melhor = e;
    });
    return melhor;
  }

  function quandoLegivel(iso) {
    var t = String(iso || "");
    var d = new Date(t);
    if (isNaN(d.getTime())) return t.slice(0, 16).replace("T", " · ");
    var dia = String(d.getDate()).padStart(2, "0");
    var mes = String(d.getMonth() + 1).padStart(2, "0");
    var hora = String(d.getHours()).padStart(2, "0");
    var min = String(d.getMinutes()).padStart(2, "0");
    var ano = d.getFullYear();
    var hoje = new Date();
    /* dentro do mesmo ano o ano só ocupa espaço */
    var data = (ano === hoje.getFullYear()) ? dia + "/" + mes : dia + "/" + mes + "/" + ano;
    return data + " · " + hora + ":" + min;
  }

  /* ------------------------------------------------------------ montar */

  /* montar(elemento, opcoes)
       opcoes = { modulo, entidade, entidadeId, api(corpo) -> Promise,
                  quantos, aoFalhar(msg) } */
  function montar(elemento, opcoes) {
    porEstilo();
    var o = opcoes || {};
    if (!elemento) return null;

    var porPagina = o.quantos || 20;
    var carregados = [];
    var inicio = 0;
    var temMais = false;
    var ocupado = false;

    elemento.className = "au-lista";
    elemento.innerHTML = '<div class="au-carregando">Carregando o histórico…</div>';

    function desenhar() {
      if (!carregados.length) {
        elemento.innerHTML =
          '<div class="au-vazio">Nada registrado ainda. As alterações a partir de agora ' +
          "aparecem aqui.</div>";
        return;
      }

      /* agrupa por operação, preservando a ordem que veio */
      var grupos = [];
      var porOp = {};
      carregados.forEach(function (e) {
        var chave = e.operacaoId || ("solto-" + grupos.length);
        if (!porOp[chave]) {
          porOp[chave] = { chave: chave, eventos: [] };
          grupos.push(porOp[chave]);
        }
        porOp[chave].eventos.push(e);
      });

      var html = grupos.map(function (g) {
        var principal = acaoPrincipal(g.eventos);
        var verbo = VERBOS[principal.acao] || "alterou a ficha";
        var forte = (PESO[principal.acao] || 0) >= 50;

        /* o nome de quem fez vira o sujeito: "Amanda alterou a ficha" */
        var quem = principal.autorNome || "Alguém";
        var titulo = esc(quem) + " " + esc(verbo);
        if (principal.acao === "criou" && principal.depois) {
          titulo += " · " + esc(principal.depois);
        }

        var linhas = g.eventos.filter(function (e) {
          return e.campo && (e.antes || e.depois);
        }).map(function (e) {
          var valores;
          if (e.antes && e.depois) {
            valores = '<span class="au-antes">' + esc(e.antes) + "</span>" +
              '<span class="au-seta">&rarr;</span>' + esc(e.depois);
          } else if (e.depois) {
            valores = esc(e.depois);
          } else {
            valores = '<span class="au-antes">' + esc(e.antes) + "</span>";
          }
          return '<div class="au-campo"><span class="au-rot">' + esc(e.campo) + "</span>" +
            '<span class="au-valores">' + valores + "</span></div>";
        }).join("");

        var contexto = "";
        g.eventos.forEach(function (e) {
          if (e.contexto && !contexto) contexto = e.contexto;
        });

        return '<div class="au-op' + (forte ? " au-forte" : "") + '">' +
          '<div class="au-quando">' +
          '<span class="au-data">' + esc(quandoLegivel(principal.em)) + "</span>" +
          (contexto ? '<span class="au-contexto">' + esc(contexto) + "</span>" : "") +
          "</div>" +
          '<div class="au-titulo">' + titulo + "</div>" +
          (linhas ? '<div class="au-campos">' + linhas + "</div>" : "") +
          "</div>";
      }).join("");

      if (temMais) {
        html += '<button type="button" class="au-mais">Ver mais</button>';
      }

      elemento.innerHTML = html;

      var botao = elemento.querySelector(".au-mais");
      if (botao) {
        botao.addEventListener("click", function () {
          botao.disabled = true;
          botao.textContent = "Carregando…";
          buscar();
        });
      }
    }

    function buscar() {
      if (ocupado) return;
      ocupado = true;

      o.api({
        acao: "auditoria_listar",
        modulo: o.modulo,
        entidade: o.entidade,
        entidadeId: o.entidadeId,
        inicio: inicio,
        quantos: porPagina,
      }).then(function (r) {
        ocupado = false;
        if (!r || !r.ok) {
          /* nada de lista vazia fingindo que não houve alteração nenhuma */
          var motivo = (r && r.erro === "sem_acesso")
            ? "Sua conta não tem acesso ao histórico deste módulo."
            : "Não foi possível carregar o histórico agora.";
          elemento.innerHTML = '<div class="au-erro">' + esc(motivo) + "</div>";
          if (typeof o.aoFalhar === "function") o.aoFalhar(motivo);
          return;
        }
        carregados = carregados.concat(r.eventos || []);
        inicio += porPagina;
        temMais = !!r.temMais;
        desenhar();
      }).catch(function () {
        ocupado = false;
        elemento.innerHTML =
          '<div class="au-erro">Não foi possível carregar o histórico. ' +
          "Verifique a conexão.</div>";
      });
    }

    buscar();

    return {
      recarregar: function () {
        carregados = []; inicio = 0; temMais = false;
        elemento.innerHTML = '<div class="au-carregando">Carregando o histórico…</div>';
        buscar();
      },
    };
  }

  global.FloreSerAuditoria = { montar: montar, quandoLegivel: quandoLegivel };
})(window);
