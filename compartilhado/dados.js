/* =====================================================================
   FloreSer · Corpo e Alma — motor de sincronização por entidade
   ---------------------------------------------------------------------
   Os módulos continuam com o estado deles na memória (state, leads,
   entradas) e com a regra de negócio deles. O que mudou é o que vai para
   o servidor: em vez do módulo inteiro, as OPERAÇÕES que levam a última
   versão confirmada (a base) até o que está na tela — uma por entidade,
   cada uma com a revisão de que partiu.

     base     o que o servidor confirmou (por entidade, com _rev)
     local    o que está na tela agora
     enviar   gera as operações base→local, manda, e:
                · ok        a entidade passa para a base com a revisão nova
                · conflito  só aquela entidade; o módulo recebe um "servidor
                            sintético" (base + as fichas como estão lá) e
                            concilia com o FloreSerSync de sempre
                · incerto   a resposta se perdeu: o MESMO pedido, com os
                            MESMOS operacaoId, vai de novo — o servidor
                            reconhece o que já aplicou

   Edições feitas durante o envio continuam na tela e na diferença: a base
   só avança para o retrato que foi enviado, nunca para a tela.

   Nada aqui vai para disco. Rascunho não sai da memória desta aba.
   ===================================================================== */

(function (global) {
  "use strict";

  var LOTE = 25;

  function copiar(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
  function iguais(a, b) { return global.FloreSerSync.iguais(a, b); }
  function canonico(v) { return global.FloreSerSync.canonico(v); }

  function indexar(lista, chave) {
    var m = {};
    (lista || []).forEach(function (x) { if (x && x[chave] !== undefined && x[chave] !== null && x[chave] !== "") m[String(x[chave])] = x; });
    return m;
  }

  function semTecnicos(o) {
    var c = {};
    Object.keys(o || {}).forEach(function (k) { if (k.charAt(0) !== "_") c[k] = o[k]; });
    return c;
  }

  function criarSincronizador(def) {
    var base = null;
    var contaDaBase = "";
    var pendentes = {};    /* chave → { assinatura, operacaoId } */
    var recusadas = {};    /* chave → assinatura recusada pelo servidor */
    var fila = Promise.resolve();

    function chaveDe(nome, id) { return nome + ":" + id; }

    /* ---- diferença de uma entidade ---- */
    function diferenca(cfg, b, l) {
      if (cfg.diferenca) return cfg.diferenca(b, l);
      var campos = {}, mudou = false;
      (cfg.campos || []).forEach(function (k) {
        /* campo ausente na tela não é "apagado": é campo que esta tela não conhece */
        if (l[k] === undefined) return;
        if (!iguais(b[k], l[k])) { campos[k] = copiar(l[k]); mudou = true; }
      });
      var extras = cfg.extras ? cfg.extras(b, l) : null;
      if (!mudou && !extras) return null;
      var saida = {};
      if (mudou) saida.campos = campos;
      if (extras) Object.keys(extras).forEach(function (k) { saida[k] = extras[k]; });
      return saida;
    }

    function dadosDeCriacao(cfg, l) {
      if (cfg.criacao) return cfg.criacao(l);
      var d = {};
      (cfg.campos || []).forEach(function (k) { if (l[k] !== undefined) d[k] = copiar(l[k]); });
      if (cfg.extrasCriacao) { var e = cfg.extrasCriacao(l); Object.keys(e).forEach(function (k) { d[k] = e[k]; }); }
      return { dados: d };
    }

    /* ---- todas as operações base → local ---- */
    function gerar(local) {
      if (def.preparar) def.preparar(local, base);
      var ops = [];
      Object.keys(def.colecoes || {}).forEach(function (nome) {
        var cfg = def.colecoes[nome];
        var chave = cfg.chave || "id";
        var B = indexar(base[nome], chave), L = indexar(local[nome], chave);
        Object.keys(L).forEach(function (id) {
          var l = L[id], b = B[id];
          var op = null;
          if (!b) {
            op = { tipo: cfg.criar, id: id };
            var dc = dadosDeCriacao(cfg, l);
            Object.keys(dc).forEach(function (k) { op[k] = dc[k]; });
          } else if (!cfg.soAcrescenta) {
            var d = diferenca(cfg, b, l);
            if (d) {
              op = { tipo: cfg.alterar, id: id, revBase: Number(b._rev) || 0 };
              Object.keys(d).forEach(function (k) { op[k] = d[k]; });
            }
          }
          if (op) ops.push({ chave: chaveDe(nome, id), nome: nome, id: id, op: op, retrato: copiar(l) });
        });
        if (cfg.remover && !cfg.soAcrescenta) {
          Object.keys(B).forEach(function (id) {
            if (L[id]) return;
            ops.push({ chave: chaveDe(nome, id), nome: nome, id: id, remocao: true,
              op: { tipo: cfg.remover, id: id, revBase: Number(B[id]._rev) || 0 } });
          });
        }
      });
      Object.keys(def.valores || {}).forEach(function (nome) {
        var cfg = def.valores[nome];
        if (iguais(base[nome], local[nome])) return;
        var op = { tipo: cfg.tipo, revBase: Number(base[cfg.rev]) || 0 };
        var p = cfg.payload(local);
        Object.keys(p).forEach(function (k) { op[k] = p[k]; });
        ops.push({ chave: "valor:" + nome, nome: nome, valor: true, op: op, retrato: copiar(local[nome]) });
      });

      /* "Contatei": o evento sobe junto com a ficha que mudou na mesma hora */
      Object.keys(def.colecoes || {}).forEach(function (nome) {
        var cfg = def.colecoes[nome];
        if (!cfg.anexarEm) return;
        ops = ops.filter(function (x) {
          if (x.nome !== nome || x.remocao) return true;
          var dono = ops.filter(function (y) { return y.nome === cfg.anexarEm.colecao && y.id === String(x.retrato[cfg.anexarEm.campo]) && !y.remocao; })[0];
          if (!dono) return true;
          (dono.op[cfg.anexarEm.como] = dono.op[cfg.anexarEm.como] || []).push(x.op.dados);
          (dono.inclui = dono.inclui || []).push({ nome: nome, retrato: x.retrato });
          return false;
        });
      });

      /* operacaoId estável: o mesmo conteúdo, o mesmo id — até ter resposta */
      ops.forEach(function (x) {
        var assinatura = canonico(x.op);
        x.assinatura = assinatura;
        var p = pendentes[x.chave];
        x.op.operacaoId = p && p.assinatura === assinatura ? p.operacaoId : global.FloreSerRede.novoId("op-" + (def.modulo || "") + "-");
        pendentes[x.chave] = { assinatura: assinatura, operacaoId: x.op.operacaoId };
      });
      return ops.filter(function (x) { return recusadas[x.chave] !== x.assinatura; });
    }

    /* ---- uma resposta de operação aplicada na base ---- */
    function confirmar(x, res, corrigidas) {
      delete pendentes[x.chave];
      delete recusadas[x.chave];
      if (x.valor) {
        base[x.nome] = copiar(x.retrato);
        base[def.valores[x.nome].rev] = res.rev;
        return;
      }
      var cfg = def.colecoes[x.nome];
      var chave = cfg.chave || "id";
      var lista = base[x.nome] = base[x.nome] || [];
      var i = lista.findIndex(function (e) { return String(e[chave]) === x.id; });
      if (x.remocao) { if (i >= 0) lista.splice(i, 1); return; }
      var nova = copiar(x.retrato);
      if (res.rev !== undefined) nova._rev = res.rev;
      if (res.entidade) {
        /* o servidor normalizou algo (um marco carimbado, a série reordenada):
           a base fica com a versão dele, e o módulo é avisado */
        var doServidor = copiar(res.entidade);
        if (!iguais(semTecnicos(doServidor), semTecnicos(nova))) corrigidas.push({ colecao: x.nome, id: x.id, enviado: nova, servidor: doServidor });
        nova = Object.assign(nova, doServidor);
      }
      if (i >= 0) lista[i] = nova; else lista.push(nova);
      (x.inclui || []).forEach(function (inc) {
        var outra = base[inc.nome] = base[inc.nome] || [];
        if (!outra.some(function (e) { return e.id === inc.retrato.id; })) outra.push(copiar(inc.retrato));
      });
    }

    /* ---- enviar: uma rodada por vez ---- */
    function rodada(local) {
      if (!base) return Promise.resolve({ ok: false, semBase: true });
      var conta = global.FloreSerSessao ? global.FloreSerSessao.contaId() : "";
      if (contaDaBase && conta && conta !== contaDaBase) return Promise.resolve({ ok: false, contaTrocada: true });
      var ops = gerar(local);
      var resultado = { ok: true, enviadas: 0, conflitos: [], erros: [], corrigidas: [], servidor: null };
      if (!ops.length) return Promise.resolve(resultado);

      var lotes = [];
      for (var i = 0; i < ops.length; i += LOTE) lotes.push(ops.slice(i, i + LOTE));

      var cadeia = Promise.resolve(true);
      lotes.forEach(function (lote) {
        cadeia = cadeia.then(function (seguir) {
          if (!seguir) return false;
          return global.FloreSerRede.chamar(def.acao, { operacoes: lote.map(function (x) { return x.op; }) }, { token: def.token() })
            .then(function (r) {
              if (!r.ok) {
                var cat = r.erro.categoria;
                resultado.ok = false;
                resultado.erro = r.erro;
                if (cat === "autenticacao") resultado.sessaoPerdida = true;
                else if (cat === "autorizacao") resultado.semAcesso = true;
                else if (cat === "versao") resultado.versao = true;
                else if (cat === "incerto" || cat === "indisponivel") resultado.transitorio = true;
                return false;
              }
              (r.dados.resultados || []).forEach(function (res, k) {
                var x = lote[k];
                if (!x) return;
                if (res.ok) { resultado.enviadas++; confirmar(x, res, resultado.corrigidas); return; }
                var e = res.erro || {};
                if (e.codigo === "conflito") {
                  delete pendentes[x.chave];
                  resultado.conflitos.push({ colecao: x.nome, id: x.id, valor: !!x.valor, atual: e.atual === undefined ? null : e.atual, rev: e.rev });
                  return;
                }
                if (e.categoria === "indisponivel" || e.categoria === "incerto") { resultado.transitorio = true; resultado.ok = false; return; }
                delete pendentes[x.chave];
                recusadas[x.chave] = x.assinatura;
                resultado.ok = false;
                resultado.erros.push({ colecao: x.nome, id: x.id, codigo: e.codigo, mensagem: e.mensagem, campo: e.campo,
                  remocao: !!x.remocao, entidadeNaBase: x.remocao ? copiar((indexar(base[x.nome], (def.colecoes[x.nome] || {}).chave || "id"))[x.id]) : null });
              });
              return true;
            });
        });
      });

      return cadeia.then(function () {
        if (resultado.conflitos.length) {
          resultado.ok = false;
          resultado.servidor = sintetico(resultado.conflitos);
        }
        return resultado;
      });
    }

    /* A base com as fichas em disputa trocadas pela versão do servidor: é
       contra isso que o módulo concilia. Só as fichas em conflito diferem
       da base, e só elas podem virar pergunta. */
    function sintetico(conflitos) {
      var s = copiar(base);
      conflitos.forEach(function (c) {
        if (c.valor) {
          s[c.colecao] = copiar(c.atual);
          s[def.valores[c.colecao].rev] = c.rev;
          return;
        }
        var chave = (def.colecoes[c.colecao] || {}).chave || "id";
        var lista = s[c.colecao] = s[c.colecao] || [];
        var i = lista.findIndex(function (e) { return String(e[chave]) === c.id; });
        if (c.atual) { if (i >= 0) lista[i] = copiar(c.atual); else lista.push(copiar(c.atual)); }
        else if (i >= 0) lista.splice(i, 1);
      });
      return s;
    }

    return {
      definirBase: function (estado) {
        base = copiar(estado);
        contaDaBase = global.FloreSerSessao ? global.FloreSerSessao.contaId() : "";
        pendentes = {};
        recusadas = {};
      },
      /* depois de conciliar: o servidor sintético passa a ser a base */
      adotarServidor: function (estado) { base = copiar(estado); },
      base: function () { return copiar(base); },
      temBase: function () { return !!base; },
      enviar: function (local) {
        var retrato = copiar(local);
        var vez = fila.then(function () { return rodada(retrato); });
        fila = vez.catch(function () { });
        return vez;
      },
      /* quantas operações sairiam agora (para o rodapé dizer "pendente") */
      contar: function (local) {
        if (!base) return 0;
        var guardadas = JSON.stringify(pendentes);
        var n = gerar(copiar(local)).length;
        pendentes = JSON.parse(guardadas);
        return n;
      },
      /* uma entidade que mudou por outra via (lixeira, integração) */
      esquecer: function (colecao, id) {
        var chave = (def.colecoes[colecao] || {}).chave || "id";
        base[colecao] = (base[colecao] || []).filter(function (e) { return String(e[chave]) !== String(id); });
      },
      definirEntidade: function (colecao, entidade) {
        var chave = (def.colecoes[colecao] || {}).chave || "id";
        var lista = base[colecao] = base[colecao] || [];
        var i = lista.findIndex(function (e) { return String(e[chave]) === String(entidade[chave]); });
        if (i >= 0) lista[i] = copiar(entidade); else lista.push(copiar(entidade));
      },
      /* recusas não se repetem sozinhas; isto as libera (ex.: depois de recarregar) */
      esquecerRecusas: function () { recusadas = {}; }
    };
  }

  /* Edições feitas durante o envio continuam valendo: só os campos que
     ainda estão como foram enviados recebem a versão normalizada. */
  function adotarCorrecao(atual, enviado, servidor) {
    var saida = copiar(atual);
    Object.keys(servidor || {}).forEach(function (k) {
      if (k.charAt(0) === "_") { saida[k] = servidor[k]; return; }
      if (iguais(atual[k], enviado[k]) && !iguais(enviado[k], servidor[k])) saida[k] = copiar(servidor[k]);
    });
    return saida;
  }

  global.FloreSerDados = { criarSincronizador: criarSincronizador, adotarCorrecao: adotarCorrecao };
})(window);
