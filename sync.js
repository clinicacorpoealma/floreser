/* =====================================================================
   FloreSer · Corpo e Alma — conciliação de alterações concorrentes
   ---------------------------------------------------------------------
   Duas pessoas mexem no sistema ao mesmo tempo. Uma salva primeiro, e a
   revisão do servidor muda. Quando a segunda tenta salvar, o servidor
   recusa — e é aí que este arquivo entra.

   Antes, cada módulo mostrava um alert e recarregava a página. Isso jogava
   fora exatamente a alteração que a pessoa acabara de fazer. Aqui a
   conversa é outra:

     BASE      o que o servidor confirmou da última vez
     LOCAL     o que está nesta tela agora
     SERVIDOR  o que está lá agora, depois da gravação da outra pessoa

   Com as três versões dá para separar o que cada lado mexeu. Campo que só
   um lado tocou entra sem perguntar nada. Campo que os dois tocaram, para
   valores diferentes, é o único que precisa de gente para decidir.

   Nada aqui é guardado em disco: a BASE vive na memória da página, e só
   durante a sessão. Dado de paciente, de lead e de dinheiro não passa por
   cache nenhum por causa desta funcionalidade.
   ===================================================================== */

(function (global) {
  "use strict";

  /* ---------- comparação ----------
     Antes de dizer que dois valores são diferentes, é preciso comparar
     como gente compara. "350" e 350 são o mesmo dinheiro; uma lista com as
     mesmas coisas na mesma ordem é a mesma lista. Sem isto o sistema
     acusaria conflito onde não há nenhum. */

  function ehVazio(v) {
    return v === undefined || v === null || v === "";
  }

  function canonico(v) {
    if (ehVazio(v)) return "";
    if (typeof v === "number") return "n:" + v;
    if (typeof v === "boolean") return "b:" + v;

    if (typeof v === "string") {
      var t = v.trim();
      /* número escrito como texto conta como número */
      if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return "n:" + Number(t);
      return "s:" + t;
    }

    if (Array.isArray(v)) {
      return "a:[" + v.map(canonico).join(",") + "]";
    }

    if (typeof v === "object") {
      /* chaves em ordem: a mesma informação tem sempre a mesma assinatura */
      var chaves = Object.keys(v).filter(function (k) { return !ehVazio(v[k]); }).sort();
      return "o:{" + chaves.map(function (k) {
        return k + ":" + canonico(v[k]);
      }).join(",") + "}";
    }

    return "s:" + String(v);
  }

  function iguais(a, b) {
    return canonico(a) === canonico(b);
  }

  function copiar(v) {
    if (v === undefined || v === null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  /* ---------- merge de três vias, campo a campo ----------
     Devolve o registro conciliado e a lista de campos que os dois lados
     mudaram para valores diferentes. */

  function mesclarRegistro(base, local, servidor) {
    var saida = copiar(servidor) || {};
    var conflitos = [];

    var campos = {};
    [base, local, servidor].forEach(function (r) {
      if (r) Object.keys(r).forEach(function (k) { campos[k] = true; });
    });

    Object.keys(campos).forEach(function (campo) {
      var b = base ? base[campo] : undefined;
      var l = local ? local[campo] : undefined;
      var s = servidor ? servidor[campo] : undefined;

      var mudouAqui = !iguais(b, l);
      var mudouLa = !iguais(b, s);

      if (!mudouAqui) { saida[campo] = copiar(s); return; }   // só o servidor mexeu
      if (!mudouLa) { saida[campo] = copiar(l); return; }     // só nós mexemos
      if (iguais(l, s)) { saida[campo] = copiar(s); return; } // os dois, para o mesmo valor

      /* os dois mexeram, para valores diferentes: só gente resolve */
      saida[campo] = copiar(s);
      conflitos.push({ campo: campo, base: copiar(b), local: copiar(l), servidor: copiar(s) });
    });

    return { registro: saida, conflitos: conflitos };
  }

  /* ---------- merge de uma lista de registros ----------
     Sempre por id. Comparar por posição faria o sistema achar que a Maria
     virou o João porque alguém inseriu alguém antes dela. */

  function indexar(lista, chave) {
    var mapa = {};
    (lista || []).forEach(function (r) {
      if (r && r[chave] !== undefined && r[chave] !== null) mapa[String(r[chave])] = r;
    });
    return mapa;
  }

  function mesclarLista(base, local, servidor, chave, nomeDaLista) {
    var B = indexar(base, chave), L = indexar(local, chave), S = indexar(servidor, chave);
    var ids = {};
    [B, L, S].forEach(function (m) { Object.keys(m).forEach(function (id) { ids[id] = true; }); });

    var saida = [];
    var conflitos = [];
    var automaticos = [];

    Object.keys(ids).forEach(function (id) {
      var b = B[id], l = L[id], s = S[id];
      var existiaAntes = !!b;

      /* --- registro novo --- */
      if (!existiaAntes) {
        if (l && !s) { saida.push(copiar(l)); automaticos.push({ tipo: "criado_aqui", lista: nomeDaLista, id: id }); return; }
        if (!l && s) { saida.push(copiar(s)); automaticos.push({ tipo: "criado_la", lista: nomeDaLista, id: id }); return; }
        /* o mesmo id nasceu dos dois lados: concilia campo a campo */
        var n = mesclarRegistro({}, l, s);
        saida.push(n.registro);
        n.conflitos.forEach(function (c) {
          conflitos.push(comContexto(c, nomeDaLista, id, l, s));
        });
        return;
      }

      /* --- sumiu de algum lado --- */
      if (!l && !s) return;                       // os dois tiraram: fica fora

      if (!s) {
        /* saiu no servidor. Se aqui ninguém mexeu, some — foi a lixeira ou
           uma exclusão de alguém, e ressuscitar seria desfazer. Se aqui
           houve edição, a pessoa precisa saber. */
        if (iguais(b, l)) { automaticos.push({ tipo: "removido_la", lista: nomeDaLista, id: id }); return; }
        conflitos.push({
          tipo: "removido_no_servidor", lista: nomeDaLista, id: id,
          rotuloRegistro: nomeDe(l), local: copiar(l), servidor: null,
        });
        return;
      }

      if (!l) {
        /* saiu daqui. Se lá ninguém mexeu, some. Se mexeram, perguntamos. */
        if (iguais(b, s)) { automaticos.push({ tipo: "removido_aqui", lista: nomeDaLista, id: id }); return; }
        conflitos.push({
          tipo: "removido_aqui_editado_la", lista: nomeDaLista, id: id,
          rotuloRegistro: nomeDe(s), local: null, servidor: copiar(s),
        });
        saida.push(copiar(s));
        return;
      }

      /* --- existe dos dois lados --- */
      var m = mesclarRegistro(b, l, s);
      saida.push(m.registro);
      if (m.conflitos.length) {
        m.conflitos.forEach(function (c) {
          conflitos.push(comContexto(c, nomeDaLista, id, l, s));
        });
      } else if (!iguais(l, s)) {
        automaticos.push({ tipo: "mesclado", lista: nomeDaLista, id: id });
      }
    });

    return { lista: saida, conflitos: conflitos, automaticos: automaticos };
  }

  function comContexto(c, lista, id, local, servidor) {
    c.tipo = "campo";
    c.lista = lista;
    c.id = id;
    c.rotuloRegistro = nomeDe(local) || nomeDe(servidor) || id;
    return c;
  }

  function nomeDe(r) {
    if (!r) return "";
    return r.nome || r.titulo || r.descricao || "";
  }

  /* ---------- merge do estado inteiro ----------
     esquema: { listas: { leads:"id", ... }, ignorar:["backupEm"] } */

  function mesclar(base, local, servidor, esquema) {
    var e = esquema || {};
    var listas = e.listas || {};
    var ignorar = e.ignorar || [];

    var saida = copiar(servidor) || {};
    var conflitos = [];
    var automaticos = [];

    Object.keys(listas).forEach(function (nome) {
      var r = mesclarLista(
        (base || {})[nome], (local || {})[nome], (servidor || {})[nome],
        listas[nome], nome
      );
      saida[nome] = r.lista;
      conflitos = conflitos.concat(r.conflitos);
      automaticos = automaticos.concat(r.automaticos);
    });

    /* o que sobra do estado — objetos de configuração, marcas de data —
       segue a mesma regra de três vias, campo a campo */
    var resto = {};
    [base, local, servidor].forEach(function (o) {
      if (!o) return;
      Object.keys(o).forEach(function (k) {
        if (listas[k] || ignorar.indexOf(k) >= 0) return;
        resto[k] = true;
      });
    });

    Object.keys(resto).forEach(function (campo) {
      var b = (base || {})[campo], l = (local || {})[campo], s = (servidor || {})[campo];
      if (ehObjeto(b) || ehObjeto(l) || ehObjeto(s)) {
        var mm = mesclarRegistro(b || {}, l || {}, s || {});
        saida[campo] = mm.registro;
        mm.conflitos.forEach(function (c) {
          c.tipo = "campo"; c.lista = campo; c.id = ""; c.rotuloRegistro = "";
          conflitos.push(c);
        });
        return;
      }
      var mudouAqui = !iguais(b, l), mudouLa = !iguais(b, s);
      if (!mudouAqui) { saida[campo] = copiar(s); return; }
      if (!mudouLa) { saida[campo] = copiar(l); return; }
      if (iguais(l, s)) { saida[campo] = copiar(s); return; }
      saida[campo] = copiar(s);
      conflitos.push({
        tipo: "campo", lista: "", id: "", rotuloRegistro: "",
        campo: campo, base: copiar(b), local: copiar(l), servidor: copiar(s),
      });
    });

    return { estado: saida, conflitos: conflitos, automaticos: automaticos };
  }

  function pegar(o, k) { return o ? o[k] : undefined; }
  function ehObjeto(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  /* Aplica as escolhas da pessoa sobre o resultado do merge. Cada escolha é
     "local" ou "servidor" para um conflito específico. */
  function aplicarEscolhas(estado, conflitos, escolhas, esquema) {
    var saida = copiar(estado);
    var listas = (esquema || {}).listas || {};

    conflitos.forEach(function (c, i) {
      var escolha = escolhas[i] || "servidor";
      if (escolha !== "local") return;

      if (c.tipo === "campo") {
        if (!c.lista || !listas[c.lista]) {
          if (c.lista) {
            saida[c.lista] = saida[c.lista] || {};
            saida[c.lista][c.campo] = copiar(c.local);
          } else {
            saida[c.campo] = copiar(c.local);
          }
          return;
        }
        var chave = listas[c.lista];
        var lista = saida[c.lista] || [];
        for (var j = 0; j < lista.length; j++) {
          if (String(lista[j][chave]) === String(c.id)) {
            lista[j][c.campo] = copiar(c.local);
            break;
          }
        }
        return;
      }

      if (c.tipo === "removido_no_servidor") {
        /* trazer de volta o que a outra pessoa tirou é decisão consciente */
        var ch = listas[c.lista];
        saida[c.lista] = saida[c.lista] || [];
        var jaTem = saida[c.lista].some(function (r) { return String(r[ch]) === String(c.id); });
        if (!jaTem) saida[c.lista].push(copiar(c.local));
        return;
      }

      if (c.tipo === "removido_aqui_editado_la") {
        /* manter a remoção que foi feita aqui */
        var k2 = listas[c.lista];
        saida[c.lista] = (saida[c.lista] || []).filter(function (r) {
          return String(r[k2]) !== String(c.id);
        });
      }
    });

    return saida;
  }

  /* ---------- telefone ----------
     O mesmo número aparece escrito de cinco jeitos. Para procurar cadastro
     repetido, o que vale é o número, não a pontuação. */

  function telefone(bruto) {
    var so = String(bruto === undefined || bruto === null ? "" : bruto).replace(/\D+/g, "");
    if (!so) return "";

    /* 55 na frente de um número brasileiro completo é código do país */
    if (so.length > 11 && so.indexOf("55") === 0) {
      var sem = so.slice(2);
      if (sem.length === 10 || sem.length === 11) return sem;
    }
    return so;
  }

  /* ---------- nome ----------
     Maiúsculas, acentos e espaços a mais não fazem duas pessoas diferentes. */

  function nomeChave(bruto) {
    return String(bruto === undefined || bruto === null ? "" : bruto)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ---------- "salvo há X" ----------
     Sem chamada ao servidor: só o relógio desta página. */

  function haQuanto(quando) {
    if (!quando) return "";
    var s = Math.max(0, Math.round((Date.now() - quando) / 1000));
    if (s < 5) return "agora";
    if (s < 60) return "há " + s + " s";
    var m = Math.round(s / 60);
    if (m < 60) return "há " + m + (m === 1 ? " min" : " min");
    var d = new Date(quando);
    return "às " + String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");
  }


  /* =================================================================
     A tela do conflito
     -----------------------------------------------------------------
     Mesmo vocabulário do resto do sistema: cartão creme, Cormorant no
     título, Montserrat no texto, teal no que decide. Paleta própria,
     porque o CRM não fala a mesma língua de tokens das outras páginas.
     ================================================================= */

  var ESTILO = [
    ":root{",
    "  --sy-fundo:#FFFFFF; --sy-texto:#2D2D2D; --sy-suave:#6E655C;",
    "  --sy-teal:#3B6E6A; --sy-linha:#E2DED7; --sy-sobre-teal:#F5F0EB;",
    "  --sy-teal-hover:#5A9490; --sy-suave-bg:#F5F0EB; --sy-alerta:#A8452F;",
    "  --sy-alerta-bg:#F6EBE4; --sy-selo:#E7EEEB; --sy-fio:#C9D3CA;",
    "}",
    ':root[data-tema="escuro"]{',
    "  --sy-fundo:#1E2927; --sy-texto:#E9E3DB; --sy-suave:#B4ADA3;",
    "  --sy-teal:#7FB8B2; --sy-linha:#33403E; --sy-sobre-teal:#12201E;",
    "  --sy-teal-hover:#93C6C0; --sy-suave-bg:#141C1B; --sy-alerta:#E79B82;",
    "  --sy-alerta-bg:#3A241D; --sy-selo:#2A514D; --sy-fio:#3C5A56;",
    "}",

    ".sy-fundo,.sy-fundo *{box-sizing:border-box}",

    /* Enquanto uma tela nossa está por cima, o que está atrás não rola.
       Marca própria, e não style inline: os módulos escrevem no mesmo
       atributo para segurar a rolagem atrás do portão, e devolver um valor
       velho deixava a página travada. */
    "html.sy-sem-rolagem,body.sy-sem-rolagem{overflow:hidden !important}",
    ".sy-fundo{position:fixed;inset:0;z-index:2147481000;display:flex;",
    "  align-items:center;justify-content:center;padding:20px;",
    "  background:rgba(12,24,22,.62);overflow-y:auto;overflow-x:hidden;",
    "  font-family:'Montserrat',Calibri,system-ui,-apple-system,sans-serif}",

    ".sy-cartao{position:relative;width:min(620px,100%);max-height:calc(100vh - 40px);",
    "  display:flex;flex-direction:column;border-radius:16px;overflow:hidden;",
    "  background:var(--sy-fundo);color:var(--sy-texto);",
    "  border:1px solid var(--sy-linha);",
    "  box-shadow:0 1px 2px rgba(20,40,38,.10), 0 24px 60px rgba(10,20,18,.45);",
    "  animation:sy-surge .32s cubic-bezier(.2,.8,.2,1) both}",
    "@keyframes sy-surge{from{opacity:0;transform:translateY(12px)}}",
    "@media (prefers-reduced-motion:reduce){.sy-cartao{animation:none}}",

    ".sy-topo{flex:0 0 auto;padding:26px 28px 18px;border-bottom:1px solid var(--sy-linha)}",
    ".sy-topo h2{margin:0;font-family:'Cormorant Garamond',Georgia,serif;",
    "  font-weight:600;font-size:25px;line-height:1.15;color:var(--sy-teal)}",
    ".sy-topo p{margin:8px 0 0;font-size:13px;line-height:1.55;color:var(--sy-suave);max-width:52ch}",
    ".sy-resumo{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px}",
    ".sy-resumo span{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;",
    "  padding:4px 9px;border-radius:999px;background:var(--sy-selo);color:var(--sy-teal)}",

    ".sy-corpo{flex:1 1 auto;overflow-y:auto;padding:6px 28px 8px}",

    ".sy-item{padding:18px 0;border-bottom:1px solid var(--sy-linha)}",
    ".sy-item:last-child{border-bottom:none}",
    ".sy-quem{font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;line-height:1.2}",
    ".sy-campo{margin-top:2px;font-size:9.5px;letter-spacing:.16em;",
    "  text-transform:uppercase;color:var(--sy-suave)}",
    ".sy-nota{margin-top:8px;font-size:12.5px;line-height:1.5;color:var(--sy-suave)}",

    ".sy-lados{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}",
    "@media (max-width:560px){.sy-lados{grid-template-columns:1fr}}",
    ".sy-lado{border:1.5px solid var(--sy-linha);border-radius:10px;padding:11px 13px;",
    "  cursor:pointer;text-align:left;background:none;color:inherit;font:inherit;",
    "  transition:border-color .16s ease, background .16s ease}",
    ".sy-lado:hover{border-color:var(--sy-teal)}",
    ".sy-lado:focus-visible{outline:2px solid var(--sy-teal);outline-offset:2px}",
    ".sy-lado[aria-pressed=\"true\"]{border-color:var(--sy-teal);background:var(--sy-selo)}",
    ".sy-lado .sy-de{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;",
    "  color:var(--sy-suave);display:flex;align-items:center;gap:6px}",
    ".sy-lado .sy-valor{margin-top:5px;font-size:14px;line-height:1.45;word-break:break-word}",
    ".sy-lado .sy-marca{width:13px;height:13px;border-radius:50%;flex:0 0 auto;",
    "  border:1.5px solid var(--sy-linha)}",
    ".sy-lado[aria-pressed=\"true\"] .sy-marca{border-color:var(--sy-teal);",
    "  background:var(--sy-teal);box-shadow:inset 0 0 0 2.5px var(--sy-fundo)}",

    ".sy-pe{flex:0 0 auto;display:flex;gap:9px;justify-content:flex-end;flex-wrap:wrap;",
    "  padding:16px 28px 20px;border-top:1px solid var(--sy-linha);background:var(--sy-fundo)}",
    ".sy-pe button{border:none;border-radius:10px;cursor:pointer;font:inherit;",
    "  font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;",
    "  padding:11px 17px;transition:background .16s ease, color .16s ease}",
    ".sy-pe .sy-ok{background:var(--sy-teal);color:var(--sy-sobre-teal)}",
    ".sy-pe .sy-ok:hover{background:var(--sy-teal-hover)}",
    ".sy-pe .sy-secundario{background:none;color:var(--sy-texto);",
    "  border:1.5px solid var(--sy-linha)}",
    ".sy-pe .sy-secundario:hover{border-color:var(--sy-teal);color:var(--sy-teal)}",
    ".sy-pe button:focus-visible{outline:2px solid var(--sy-teal);outline-offset:2px}",
    "@media (max-width:560px){.sy-pe{flex-direction:column-reverse}",
    "  .sy-pe button{width:100%}}",
  ].join("\n");

  var estiloPosto = false;
  function porEstilo() {
    if (estiloPosto) return;
    estiloPosto = true;
    var f = document.createElement("style");
    f.id = "sync-estilo";
    f.textContent = ESTILO;
    (document.head || document.documentElement).appendChild(f);
  }

  function esc(t) {
    return String(t === undefined || t === null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* Valor em português, não em JSON. rotulos.valores traduz códigos como
     "nao_responde"; o resto vira uma descrição curta e honesta. */
  function paraGente(valor, campo, rotulos) {
    var r = rotulos || {};
    var mapa = (r.valores || {})[campo];
    if (mapa && !ehVazio(valor) && mapa[String(valor)]) return mapa[String(valor)];

    if (ehVazio(valor)) return "(vazio)";
    if (typeof valor === "boolean") return valor ? "sim" : "não";
    if (typeof valor === "number" || typeof valor === "string") {
      var t = String(valor);
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        var p = t.split("-");
        return p[2] + "/" + p[1] + "/" + p[0];
      }
      return t;
    }
    if (Array.isArray(valor)) {
      return valor.length + (valor.length === 1 ? " item" : " itens");
    }
    if (typeof valor === "object") {
      var ks = Object.keys(valor).filter(function (k) { return !ehVazio(valor[k]); });
      return ks.length ? "conjunto com " + ks.length + (ks.length === 1 ? " informação" : " informações")
        : "(vazio)";
    }
    return String(valor);
  }

  function rotuloDoCampo(campo, rotulos) {
    var r = (rotulos || {}).campos || {};
    if (r[campo]) return r[campo];
    /* sem tradução: pelo menos não mostra o nome cru grudado */
    return String(campo)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }


  /* =================================================================
     Cadastro repetido
     -----------------------------------------------------------------
     Duas pessoas diferentes podem ter o mesmo nome; a mesma pessoa
     escreve o telefone de cinco jeitos. Por isso há duas forças:

       forte  — o mesmo WhatsApp, ou um conjunto que só coincide de
                propósito. Vale parar e perguntar.
       fraca  — só o nome. Vale avisar, nunca impedir.

     Quem decide o que é forte e o que é fraco é o módulo, com regras.
     Este arquivo só sabe comparar.
     ================================================================= */

  /* Normaliza um valor conforme o jeito de comparar pedido pela regra. */
  function normalizarPara(valor, como) {
    if (como === "telefone") return telefone(valor);
    if (como === "nome") return nomeChave(valor);
    if (como === "data") {
      var t = String(valor === undefined || valor === null ? "" : valor).trim();
      /* dd/mm/aaaa e aaaa-mm-dd são a mesma data escrita de dois jeitos */
      var br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (br) return br[3] + "-" + br[2] + "-" + br[1];
      return t.slice(0, 10);
    }
    if (como === "numero") {
      var n = Number(String(valor).replace(/[^\d,.-]/g, "").replace(",", "."));
      return isFinite(n) ? String(n) : "";
    }
    return nomeChave(valor);
  }

  /* Um critério casa quando TODOS os seus campos batem e nenhum está
     vazio: comparar dois vazios acharia repetido em tudo que falta. */
  function criterioCasa(a, b, criterio) {
    var campos = criterio.campos || [];
    for (var i = 0; i < campos.length; i++) {
      var c = campos[i];
      var va = normalizarPara(pegar(a, c.campo), c.como);
      var vb = normalizarPara(pegar(b, c.campo), c.como);
      if (!va || !vb || va !== vb) return false;
    }
    return campos.length > 0;
  }

  /* procurarRepetidos(candidato, lista, regras)
       regras = { id, ignorarId, criterios: [{ forca, texto, campos:[{campo,como}] }],
                  situacao(registro) → "arquivada" | "na lixeira" | "" }
     Devolve [{ registro, forca, motivo, situacao }], os fortes primeiro. */
  function procurarRepetidos(candidato, lista, regras) {
    var r = regras || {};
    var chave = r.id || "id";
    var criterios = r.criterios || [];
    var achados = [];

    (lista || []).forEach(function (item) {
      if (!item) return;
      /* ao editar, o próprio registro não é repetição de si mesmo */
      if (r.ignorarId !== undefined && r.ignorarId !== null &&
        String(item[chave]) === String(r.ignorarId)) return;

      var melhor = null;
      criterios.forEach(function (c) {
        if (melhor && melhor.forca === "forte") return;
        if (!criterioCasa(candidato, item, c)) return;
        if (!melhor || c.forca === "forte") {
          melhor = { forca: c.forca || "fraca", motivo: c.texto || "dados iguais" };
        }
      });

      if (melhor) {
        achados.push({
          registro: item,
          forca: melhor.forca,
          motivo: melhor.motivo,
          situacao: typeof r.situacao === "function" ? (r.situacao(item) || "") : "",
        });
      }
    });

    achados.sort(function (a, b) {
      if (a.forca === b.forca) return 0;
      return a.forca === "forte" ? -1 : 1;
    });
    return achados;
  }

  /* Importação de planilha: separa o que entra do que já existe — e também
     pega repetição dentro da própria planilha, que é a mais comum. */
  function analisarImportacao(novos, existentes, regras) {
    var r = regras || {};
    var entram = [], repetidos = [];
    var jaVistos = (existentes || []).slice();

    (novos || []).forEach(function (novo, i) {
      var achados = procurarRepetidos(novo, jaVistos, r);
      var fortes = achados.filter(function (a) { return a.forca === "forte"; });
      if (fortes.length) {
        repetidos.push({ linha: i + 1, registro: novo, achado: fortes[0] });
        return;
      }
      entram.push(novo);
      /* entra na lista de comparação: duas linhas iguais na mesma planilha
         não podem virar dois cadastros */
      jaVistos.push(novo);
    });

    return { entram: entram, repetidos: repetidos };
  }

  /* ----------------------------------------------------------------
     A tela do aviso. Nunca bloqueia sozinha: quem decide é a pessoa.
     avisarRepetido({ titulo, aviso, achados, rotulo(registro), detalhe(registro),
                      textoSeguir, aoVer(registro), aoSeguir(), aoCancelar() })
     ---------------------------------------------------------------- */

  var telaRepetido = null;
  var focoAntesRepetido = null;

  function avisarRepetido(opcoes) {
    porEstilo();
    fecharRepetido();

    var o = opcoes || {};
    var achados = o.achados || [];
    if (!achados.length) return null;

    var forte = achados.some(function (a) { return a.forca === "forte"; });
    focoAntesRepetido = document.activeElement;

    telaRepetido = document.createElement("div");
    telaRepetido.className = "sy-fundo";
    telaRepetido.setAttribute("role", "dialog");
    telaRepetido.setAttribute("aria-modal", "true");
    telaRepetido.setAttribute("aria-label", o.titulo || "Cadastro parecido");

    /* "cadastro" serve para pessoa; um lançamento financeiro pede outra
       palavra, e quem sabe qual é o módulo */
    var coisa = o.coisa || "cadastro";
    var plural = o.coisaPlural || (coisa + "s");
    var selo = forte
      ? (achados.length === 1 ? "1 " + coisa + " igual" : achados.length + " " + plural + " iguais")
      : (achados.length === 1 ? "1 " + coisa + " parecido" : achados.length + " " + plural + " parecidos");

    telaRepetido.innerHTML =
      '<div class="sy-cartao">' +
      '<div class="sy-topo">' +
      "<h2>" + esc(o.titulo || (forte ? "Este cadastro já existe" : "Cadastro parecido")) + "</h2>" +
      "<p>" + esc(o.aviso || (forte
        ? "Encontrei um cadastro com os mesmos dados. Veja se é a mesma pessoa antes de criar outro."
        : "Encontrei alguém com nome parecido. Pode ser outra pessoa — confira antes de seguir.")) + "</p>" +
      '<div class="sy-resumo"><span>' + esc(selo) + "</span></div>" +
      "</div>" +
      '<div class="sy-corpo"></div>' +
      '<div class="sy-pe">' +
      '<button type="button" class="sy-secundario" data-rp="cancelar">Cancelar</button>' +
      '<button type="button" class="sy-ok" data-rp="seguir">' +
      esc(o.textoSeguir || "Cadastrar mesmo assim") + "</button>" +
      "</div></div>";

    var corpo = telaRepetido.querySelector(".sy-corpo");

    achados.forEach(function (a, i) {
      var item = document.createElement("div");
      item.className = "sy-item";

      var nome = typeof o.rotulo === "function"
        ? o.rotulo(a.registro) : (a.registro && a.registro.nome) || "(sem nome)";
      var detalhe = typeof o.detalhe === "function" ? (o.detalhe(a.registro) || "") : "";

      var nota = a.motivo;
      if (a.situacao) nota += " · " + a.situacao;

      item.innerHTML =
        '<div class="sy-quem">' + esc(nome) + "</div>" +
        '<div class="sy-campo">' + esc(nota) + "</div>" +
        (detalhe ? '<div class="sy-nota">' + esc(detalhe) + "</div>" : "") +
        /* achado sem ficha (o que está na lixeira, por exemplo) não
           oferece "Ver ficha": não há para onde ir */
        (typeof o.aoVer === "function" && a.podeAbrir !== false
          ? '<div class="sy-lados"><button type="button" class="sy-lado" data-rp="ver" ' +
          'data-i="' + i + '"><span class="sy-de">Abrir</span>' +
          '<span class="sy-valor">Ver ficha</span></button></div>'
          : "");

      corpo.appendChild(item);
    });

    telaRepetido.addEventListener("click", function (ev) {
      var alvo = ev.target.closest && ev.target.closest("[data-rp]");
      if (!alvo) return;
      var qual = alvo.getAttribute("data-rp");

      if (qual === "ver") {
        var i = Number(alvo.getAttribute("data-i"));
        fecharRepetido();
        if (typeof o.aoVer === "function") o.aoVer(achados[i].registro);
        return;
      }
      if (qual === "cancelar") {
        fecharRepetido();
        if (typeof o.aoCancelar === "function") o.aoCancelar();
        return;
      }
      fecharRepetido();
      if (typeof o.aoSeguir === "function") o.aoSeguir();
    });

    telaRepetido.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        fecharRepetido();
        if (typeof o.aoCancelar === "function") o.aoCancelar();
        return;
      }
      if (ev.key !== "Tab") return;
      var focaveis = telaRepetido.querySelectorAll("button");
      if (!focaveis.length) return;
      var pri = focaveis[0], ult = focaveis[focaveis.length - 1];
      if (ev.shiftKey && document.activeElement === pri) { ev.preventDefault(); ult.focus(); }
      else if (!ev.shiftKey && document.activeElement === ult) { ev.preventDefault(); pri.focus(); }
    });

    document.body.appendChild(telaRepetido);
    travarRolagem();
    /* o foco começa em Cancelar: a saída sem estrago é a mais provável */
    var inicio = telaRepetido.querySelector('[data-rp="cancelar"]');
    if (inicio) inicio.focus();

    return telaRepetido;
  }

  function fecharRepetido() {
    if (telaRepetido && telaRepetido.parentNode) {
      telaRepetido.parentNode.removeChild(telaRepetido);
    }
    telaRepetido = null;
    if (!telaConflito) soltarRolagem();
    if (focoAntesRepetido && focoAntesRepetido.focus) {
      try { focoAntesRepetido.focus(); } catch (e) { }
    }
    focoAntesRepetido = null;
  }

  var telaConflito = null;
  var focoAntes = null;

  /* O que ficou por resolver quando a pessoa escolheu "Resolver depois".
     Guardado para que o módulo possa reabrir a mesma tela, com as mesmas
     escolhas já marcadas, sem ter de disputar a revisão de novo. */
  var conflitoGuardado = null;

  /* opcoes: { modulo, conflitos, automaticos, rotulos, aoResolver(escolhas),
               aoCancelar() } */
  function abrirConflito(opcoes) {
    porEstilo();
    fecharConflito();

    var o = opcoes || {};
    var conflitos = o.conflitos || [];
    var escolhas = (o.escolhas && o.escolhas.length === conflitos.length)
      ? o.escolhas.slice()
      : conflitos.map(function () { return "servidor"; });
    conflitoGuardado = o;

    focoAntes = document.activeElement;

    telaConflito = document.createElement("div");
    telaConflito.className = "sy-fundo";
    telaConflito.setAttribute("role", "dialog");
    telaConflito.setAttribute("aria-modal", "true");
    telaConflito.setAttribute("aria-label", "Alterações em conflito");

    var quantos = conflitos.length;
    var selos = [];
    if ((o.automaticos || []).length) {
      selos.push((o.automaticos.length) + " conciliado" +
        (o.automaticos.length === 1 ? "" : "s") + " sozinho");
    }
    selos.push(quantos + (quantos === 1 ? " precisa de você" : " precisam de você"));

    telaConflito.innerHTML =
      '<div class="sy-cartao">' +
      '<div class="sy-topo">' +
      "<h2>Alterações em conflito</h2>" +
      "<p>" + esc(o.aviso || "Estes dados mudaram em outro aparelho enquanto você trabalhava. " +
        "O que não se cruzou já foi juntado; escolha o que fica no que sobrou.") + "</p>" +
      '<div class="sy-resumo">' + selos.map(function (t) {
        return "<span>" + esc(t) + "</span>";
      }).join("") + "</div>" +
      "</div>" +
      '<div class="sy-corpo"></div>' +
      '<div class="sy-pe">' +
      '<button type="button" class="sy-secundario" data-sy="cancelar">Resolver depois</button>' +
      '<button type="button" class="sy-secundario" data-sy="tudo-local">Manter tudo o meu</button>' +
      '<button type="button" class="sy-ok" data-sy="aplicar">Aplicar escolhas</button>' +
      "</div></div>";

    var corpo = telaConflito.querySelector(".sy-corpo");

    conflitos.forEach(function (c, i) {
      var item = document.createElement("div");
      item.className = "sy-item";

      var titulo = c.rotuloRegistro || "";
      var cabeca = titulo ? '<div class="sy-quem">' + esc(titulo) + "</div>" : "";

      if (c.tipo === "removido_no_servidor") {
        item.innerHTML = cabeca +
          '<div class="sy-nota">Este registro foi removido em outro aparelho enquanto ' +
          "você o editava. Suas alterações continuam aqui.</div>" +
          '<div class="sy-lados">' +
          lado("servidor", "Manter a remoção", "O registro sai, como foi feito lá.", i) +
          lado("local", "Trazer de volta", "Volta com o que você editou.", i) +
          "</div>";
      } else if (c.tipo === "removido_aqui_editado_la") {
        item.innerHTML = cabeca +
          '<div class="sy-nota">Você removeu este registro aqui, mas ele foi alterado ' +
          "em outro aparelho.</div>" +
          '<div class="sy-lados">' +
          lado("servidor", "Manter o registro", "Fica, com a alteração de lá.", i) +
          lado("local", "Manter a remoção", "Sai, como você fez.", i) +
          "</div>";
      } else {
        item.innerHTML = cabeca +
          '<div class="sy-campo">' + esc(rotuloDoCampo(c.campo, o.rotulos)) + "</div>" +
          '<div class="sy-lados">' +
          lado("servidor", "No servidor", paraGente(c.servidor, c.campo, o.rotulos), i) +
          lado("local", "Neste aparelho", paraGente(c.local, c.campo, o.rotulos), i) +
          "</div>";
      }

      corpo.appendChild(item);
    });

    /* o lado marcado sai de escolhas, para a tela reabrir do jeito que
       ficou quando a pessoa adiou a decisão */
    function lado(qual, de, valor, i) {
      return '<button type="button" class="sy-lado" data-i="' + i + '" data-qual="' + qual +
        '" aria-pressed="' + (escolhas[i] === qual ? "true" : "false") + '">' +
        '<span class="sy-de"><span class="sy-marca"></span>' + esc(de) + "</span>" +
        '<span class="sy-valor">' + esc(valor) + "</span></button>";
    }

    telaConflito.addEventListener("click", function (ev) {
      var botao = ev.target.closest && ev.target.closest(".sy-lado");
      if (botao) {
        var i = Number(botao.getAttribute("data-i"));
        escolhas[i] = botao.getAttribute("data-qual");
        Array.prototype.forEach.call(
          telaConflito.querySelectorAll('.sy-lado[data-i="' + i + '"]'),
          function (b) {
            b.setAttribute("aria-pressed", b === botao ? "true" : "false");
          }
        );
        return;
      }

      var acao = ev.target.closest && ev.target.closest("[data-sy]");
      if (!acao) return;
      var qual = acao.getAttribute("data-sy");

      if (qual === "cancelar") {
        /* nada se perde: as escolhas voltam iguais quando reabrir */
        conflitoGuardado = o;
        o.escolhas = escolhas.slice();
        fecharConflito();
        if (typeof o.aoCancelar === "function") o.aoCancelar();
        return;
      }
      if (qual === "tudo-local") {
        escolhas = conflitos.map(function () { return "local"; });
      }
      var finais = escolhas.slice();
      conflitoGuardado = null;
      fecharConflito();
      if (typeof o.aoResolver === "function") o.aoResolver(finais);
    });

    /* o foco não sai do cartão enquanto a decisão não é tomada */
    telaConflito.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        fecharConflito();
        if (typeof o.aoCancelar === "function") o.aoCancelar();
        return;
      }
      if (ev.key !== "Tab") return;
      var focaveis = telaConflito.querySelectorAll("button");
      if (!focaveis.length) return;
      var primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
      if (ev.shiftKey && document.activeElement === primeiro) {
        ev.preventDefault(); ultimo.focus();
      } else if (!ev.shiftKey && document.activeElement === ultimo) {
        ev.preventDefault(); primeiro.focus();
      }
    });

    document.body.appendChild(telaConflito);
    travarRolagem();
    var alvo = telaConflito.querySelector(".sy-lado") ||
      telaConflito.querySelector('[data-sy="aplicar"]');
    if (alvo) alvo.focus();

    return telaConflito;
  }

  function fecharConflito() {
    if (telaConflito && telaConflito.parentNode) {
      telaConflito.parentNode.removeChild(telaConflito);
    }
    telaConflito = null;
    if (!telaRepetido) soltarRolagem();
    if (focoAntes && focoAntes.focus) { try { focoAntes.focus(); } catch (e) { } }
    focoAntes = null;
  }

  function conflitoAberto() { return !!telaConflito; }

  var MARCA_TRAVA = "sy-sem-rolagem";

  function travarRolagem() {
    document.body.classList.add(MARCA_TRAVA);
    document.documentElement.classList.add(MARCA_TRAVA);
  }

  function soltarRolagem() {
    document.body.classList.remove(MARCA_TRAVA);
    document.documentElement.classList.remove(MARCA_TRAVA);
  }

  /* Há um conflito adiado esperando decisão? */
  function conflitoGuardadoExiste() { return !!conflitoGuardado; }

  /* Reabre o conflito adiado, com as escolhas de antes. Devolve false se não
     havia nada guardado — assim o módulo sabe que não tem o que mostrar. */
  function reabrirConflito() {
    if (telaConflito || !conflitoGuardado) return false;
    abrirConflito(conflitoGuardado);
    return true;
  }

  /* O módulo desiste do conflito guardado (resolveu por outro caminho). */
  function esquecerConflito() { conflitoGuardado = null; }

  /* =================================================================
     O indicador de estado
     -----------------------------------------------------------------
     Um só modelo para os três módulos, com o texto sempre presente —
     nunca só a cor. O "salvo há X" se atualiza sozinho, sem falar com o
     servidor e sem repetir o anúncio para o leitor de tela.
     ================================================================= */

  var TEXTOS = {
    carregando: "Carregando",
    salvo: "Salvo",
    pendente: "Alterações pendentes",
    salvando: "Salvando…",
    offline: "Sem conexão",
    erro: "Não foi possível salvar",
    conflito: "Conflito de alterações",
    expirado: "Sessão expirada",
    semAcesso: "Acesso removido",
  };

  var DETALHES = {
    salvo: "Tudo o que está aqui já está guardado na planilha.",
    pendente: "Ainda não foram enviadas para a planilha.",
    salvando: "Enviando as alterações para a planilha.",
    offline: "As alterações ficam neste aparelho e sobem quando a conexão voltar.",
    erro: "O servidor recusou a gravação. As alterações continuam aqui.",
    conflito: "Alguém alterou os mesmos dados. Resolva para voltar a salvar.",
    expirado: "Recarregue a página e entre novamente para voltar a salvar.",
    semAcesso: "Seu acesso a este módulo foi retirado.",
  };

  /* criarStatus(elemento, { extra() }) → { definir(estado), salvoAgora(), estado() } */
  function criarStatus(elemento, opcoes) {
    var o = opcoes || {};
    var estadoAtual = "carregando";
    var salvoEm = 0;
    var timer = null;

    function extra() {
      try { return o.extra ? String(o.extra() || "") : ""; } catch (e) { return ""; }
    }

    function texto() {
      if (estadoAtual === "salvo" && salvoEm) {
        var q = haQuanto(salvoEm);
        return q === "agora" ? "Salvo agora" : "Salvo " + q;
      }
      return TEXTOS[estadoAtual] || estadoAtual;
    }

    function pintar() {
      if (!elemento) return;
      var t = texto();
      var mais = extra();
      elemento.textContent = mais ? t + " · " + mais : t;
      elemento.setAttribute("data-sync", estadoAtual);
      var d = DETALHES[estadoAtual] || "";
      if (estadoAtual === "salvo" && salvoEm) {
        var h = new Date(salvoEm);
        d = "Última sincronização às " +
          String(h.getHours()).padStart(2, "0") + ":" +
          String(h.getMinutes()).padStart(2, "0") + ":" +
          String(h.getSeconds()).padStart(2, "0") + ". " + DETALHES.salvo;
      }
      elemento.title = d;
    }

    function definir(novo) {
      var mudou = novo !== estadoAtual;
      estadoAtual = novo;
      /* Só um estado novo merece anúncio. Sem isto o leitor de tela leria
         "salvo há 9 s", "salvo há 10 s"… sem parar. */
      if (elemento) {
        if (mudou) elemento.setAttribute("aria-live", "polite");
        else elemento.removeAttribute("aria-live");
      }
      pintar();
    }

    function salvoAgora() {
      salvoEm = Date.now();
      definir("salvo");
    }

    /* o texto do tempo anda sozinho, sem tocar em aria-live */
    timer = setInterval(function () {
      if (estadoAtual === "salvo" && salvoEm) {
        if (elemento) elemento.removeAttribute("aria-live");
        pintar();
      }
    }, 5000);

    pintar();

    return {
      definir: definir,
      salvoAgora: salvoAgora,
      estado: function () { return estadoAtual; },
      salvoEm: function () { return salvoEm; },
      atualizar: pintar,
      parar: function () { clearInterval(timer); },
    };
  }

  global.FloreSerSync = {
    iguais: iguais,
    canonico: canonico,
    copiar: copiar,
    mesclar: mesclar,
    mesclarLista: mesclarLista,
    mesclarRegistro: mesclarRegistro,
    aplicarEscolhas: aplicarEscolhas,
    telefone: telefone,
    nomeChave: nomeChave,
    procurarRepetidos: procurarRepetidos,
    analisarImportacao: analisarImportacao,
    avisarRepetido: avisarRepetido,
    fecharRepetido: fecharRepetido,
    haQuanto: haQuanto,
    abrirConflito: abrirConflito,
    fecharConflito: fecharConflito,
    conflitoAberto: conflitoAberto,
    conflitoGuardado: conflitoGuardadoExiste,
    reabrirConflito: reabrirConflito,
    esquecerConflito: esquecerConflito,
    criarStatus: criarStatus,
    paraGente: paraGente,
    rotuloDoCampo: rotuloDoCampo,
  };
})(window);
