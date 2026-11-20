/* =====================================================================
   30_RegrasFinanceiro — as regras do Financeiro, sem planilha
   ---------------------------------------------------------------------
   Funções puras: recebem números e listas, devolvem números e listas. O
   serviço (31) lê e grava; os testes conferem estas uma a uma.

   · Dinheiro é inteiro em centavos. Parcelas somam o total exato: o resto
     da divisão vai, um centavo por vez, para as PRIMEIRAS parcelas.
   · Obrigação ≠ pagamento. A despesa diz quanto se deve e quando vence;
     o pagamento (movimento) diz quanto saiu e quando. Estado sai dos dois.
   · Nada fica "pago" sozinho: previsão e recorrência nunca viram pagamento.
   · Caixa (quando saiu), competência (a que mês pertence) e previsão (o
     que ainda vai sair) são três perguntas; nenhuma soma entra na outra.
   · Na precificação, campo vazio não é zero: falta é falta, e o preço
     sugerido não aparece até ela ser resolvida.
   ===================================================================== */

var FIN_CATEGORIAS_PADRAO = [
  ["cat-aluguel", "Aluguel"], ["cat-equipe", "Equipe"], ["cat-materiais", "Materiais"],
  ["cat-produtos", "Produtos"], ["cat-equipamentos", "Equipamentos"], ["cat-manutencao", "Manutenção"],
  ["cat-agua", "Água"], ["cat-energia", "Energia"], ["cat-marketing", "Marketing"],
  ["cat-sistemas", "Sistemas"], ["cat-servicos", "Serviços"]
];

/* Categorias que são custo direto de atendimento: rateá-las de novo como
   custo fixo contaria a mesma despesa duas vezes. */
var FIN_CATEGORIAS_DIRETAS = ["cat-materiais", "cat-produtos"];

var FIN_FREQUENCIAS = {
  semanal: { dias: 7, nome: "Semanal" }, quinzenal: { dias: 14, nome: "Quinzenal" },
  mensal: { meses: 1, nome: "Mensal" }, bimestral: { meses: 2, nome: "Bimestral" },
  trimestral: { meses: 3, nome: "Trimestral" }, semestral: { meses: 6, nome: "Semestral" },
  anual: { meses: 12, nome: "Anual" }
};

var FIN_MAX_OCORRENCIAS = 120;
var FIN_MAX_PARCELAS = 120;
var FIN_ESTADOS = { pendente: "Pendente", parcial: "Parcialmente paga", paga: "Paga", vencida: "Vencida", cancelada: "Cancelada" };
var RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ---------------------------------------------------------------------
   Datas de calendário (texto AAAA-MM-DD, sem fuso)
   --------------------------------------------------------------------- */

function finPartes(iso) { var p = String(iso).split("-").map(Number); return { a: p[0], m: p[1], d: p[2] }; }
function finDois(n) { return (n < 10 ? "0" : "") + n; }
function finISO(a, m, d) { return a + "-" + finDois(m) + "-" + finDois(d); }
function finUltimoDia(a, m) { return new Date(Date.UTC(a, m, 0)).getUTCDate(); }

function finSomarDias(iso, dias) {
  var p = finPartes(iso);
  var d = new Date(Date.UTC(p.a, p.m - 1, p.d + dias));
  return finISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/* Soma meses guardando o dia ORIGINAL da série: 31/01 → 28/02 → 31/03.
   O mês curto encurta só aquela data; a série não "escorrega". */
function finSomarMeses(iso, meses, diaOriginal) {
  var p = finPartes(iso);
  var total = (p.m - 1) + meses;
  var a = p.a + Math.floor(total / 12);
  var m = ((total % 12) + 12) % 12 + 1;
  var dia = Math.min(diaOriginal || p.d, finUltimoDia(a, m));
  return finISO(a, m, dia);
}

function competenciaDe(iso) { return String(iso || "").slice(0, 7); }

function mesValido(m) { return typeof m === "string" && RE_MES.test(m); }

function finSomarMesesAoMes(mes, n) {
  return finSomarMeses(mes + "-01", n, 1).slice(0, 7);
}

/* ---------------------------------------------------------------------
   Parcelas e recorrências
   --------------------------------------------------------------------- */

/* 100,00 em 3 → 33,34 + 33,33 + 33,33. Determinístico: sempre igual. */
function dividirCentavos(total, n) {
  total = Number(total); n = Number(n);
  if (!Number.isInteger(total) || total < 0) throw new Error("total inválido");
  if (!Number.isInteger(n) || n < 1) throw new Error("quantidade inválida");
  var base = Math.floor(total / n), resto = total - base * n, saida = [];
  for (var i = 0; i < n; i++) saida.push(base + (i < resto ? 1 : 0));
  return saida;
}

/* As datas de uma série: início, frequência e (fim OU quantidade).
   "ate" corta a geração (gerar só até um horizonte), sem mudar a série. */
function datasDaSerie(inicio, frequencia, opcoes) {
  var o = opcoes || {};
  var f = FIN_FREQUENCIAS[frequencia];
  if (!f) throw new Error("frequência desconhecida");
  if (!dataValida(inicio)) throw new Error("início inválido");
  var limite = Math.min(Number(o.quantidade) || FIN_MAX_OCORRENCIAS, FIN_MAX_OCORRENCIAS);
  var dia = finPartes(inicio).d, saida = [];
  for (var i = 0; i < limite; i++) {
    var d = f.dias ? finSomarDias(inicio, f.dias * i) : finSomarMeses(inicio, f.meses * i, dia);
    if (o.fim && d > o.fim) break;
    if (o.ate && d > o.ate) break;
    saida.push({ indice: i + 1, data: d });
  }
  return saida;
}

/* Parcelamento: cada parcela tem identidade, vencimento e valor; a soma é
   o total, centavo por centavo. A compra NÃO é contada à parte: quem
   conta são as parcelas. */
function planoDeParcelas(total, quantidade, primeiroVencimento, frequencia) {
  if (!Number.isInteger(Number(quantidade)) || quantidade < 1 || quantidade > FIN_MAX_PARCELAS) throw new Error("parcelas fora de 1 a " + FIN_MAX_PARCELAS);
  var valores = dividirCentavos(total, quantidade);
  var datas = datasDaSerie(primeiroVencimento, frequencia || "mensal", { quantidade: quantidade });
  return datas.map(function (d, i) { return { sequencia: i + 1, vencimento: d.data, valor: valores[i] }; });
}

/* ---------------------------------------------------------------------
   Estado de uma despesa
   --------------------------------------------------------------------- */

function totalPago(movimentos) {
  return (movimentos || []).reduce(function (t, m) {
    var v = Number(m.valor) || 0;
    return t + (m.tipo === "estorno" ? -v : v);
  }, 0);
}

function estadoDaDespesa(d, movimentos, hoje) {
  var pago = totalPago(movimentos);
  var valor = Number(d.valor) || 0;
  var saldo = Math.max(0, valor - pago);
  var vencida = !d.cancelada && saldo > 0 && !!d.vencimento && d.vencimento < hoje;
  var estado;
  if (d.cancelada) estado = "cancelada";
  else if (valor > 0 && pago >= valor) estado = "paga";
  else if (pago > 0) estado = "parcial";
  else if (vencida) estado = "vencida";
  else estado = "pendente";
  return { estado: estado, pago: pago, saldo: d.cancelada ? 0 : saldo, vencida: vencida, excedente: Math.max(0, pago - valor) };
}

/* ---------------------------------------------------------------------
   Números digitados (quantidade, porcentagem): "1,5", "1.5", "12"
   --------------------------------------------------------------------- */

function lerDecimal(bruto) {
  if (bruto === null || bruto === undefined) return null;
  if (typeof bruto === "number") return isFinite(bruto) ? bruto : null;
  var t = String(bruto).trim().replace(/\s/g, "");
  if (!t) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/* ---------------------------------------------------------------------
   Unidades
   --------------------------------------------------------------------- */

var FIN_UNIDADES = {
  mg: { grupo: "massa", fator: 0.001 }, g: { grupo: "massa", fator: 1 }, kg: { grupo: "massa", fator: 1000 },
  ml: { grupo: "volume", fator: 1 }, l: { grupo: "volume", fator: 1000 },
  un: { grupo: "unidade", fator: 1 }, cm: { grupo: "comprimento", fator: 1 }, m: { grupo: "comprimento", fator: 100 },
  uso: { grupo: "uso", fator: 1 }
};

function converterQuantidade(qtd, de, para) {
  var a = FIN_UNIDADES[de], b = FIN_UNIDADES[para];
  if (!a || !b || a.grupo !== b.grupo) return null;
  return qtd * a.fator / b.fator;
}

/* ---------------------------------------------------------------------
   Precificação
   ---------------------------------------------------------------------
   Base: todas as porcentagens (taxa de pagamento, comissão, impostos e
   margem desejada) são SOBRE O PREÇO. Só assim
       Preço sugerido = C / (1 − r − m)
   faz sentido, com C = custo direto + rateio por unidade.
   Margem (resultado ÷ preço) ≠ markup (preço ÷ custo): mostramos os dois,
   com o nome certo. */

function custoDoInsumo(insumo, quantidade, unidade, faltando, memoria, rotulo) {
  if (!insumo) { faltando.push(rotulo + ": material não encontrado"); return null; }
  var valor = Number(insumo.valorEmbalagem);
  if (insumo.valorEmbalagem === null || insumo.valorEmbalagem === undefined || !isFinite(valor)) {
    faltando.push(insumo.nome + ": valor da embalagem"); return null;
  }
  var perda = insumo.perdaPct === "" || insumo.perdaPct === null || insumo.perdaPct === undefined ? 0 : lerDecimal(insumo.perdaPct);
  if (perda === null || perda < 0 || perda >= 100) { faltando.push(insumo.nome + ": perda (%) inválida"); return null; }
  var unitario, qtdNaBase;
  if (unidade === "uso") {
    var rend = lerDecimal(insumo.rendimento);
    if (!rend || rend <= 0) { faltando.push(insumo.nome + ": rendimento (usos por embalagem)"); return null; }
    unitario = valor / rend; qtdNaBase = quantidade;
    memoria.push(insumo.nome + ": " + fmtCent(valor) + " ÷ " + rend + " usos × " + quantidade + " uso(s)" + (perda ? " × (1 + " + perda + "% de perda)" : ""));
  } else {
    var conteudo = lerDecimal(insumo.conteudo);
    if (!conteudo || conteudo <= 0 || !insumo.unidadeConteudo) { faltando.push(insumo.nome + ": conteúdo da embalagem"); return null; }
    qtdNaBase = converterQuantidade(quantidade, unidade, insumo.unidadeConteudo);
    if (qtdNaBase === null) { faltando.push(insumo.nome + ": a unidade " + unidade + " não converte para " + insumo.unidadeConteudo); return null; }
    unitario = valor / conteudo;
    memoria.push(insumo.nome + ": " + fmtCent(valor) + " ÷ " + conteudo + " " + insumo.unidadeConteudo + " × " +
      quantidade + " " + unidade + (unidade !== insumo.unidadeConteudo ? " (= " + arred(qtdNaBase, 4) + " " + insumo.unidadeConteudo + ")" : "") +
      (perda ? " × (1 + " + perda + "% de perda)" : ""));
  }
  return unitario * qtdNaBase * (1 + perda / 100);
}

function arred(n, casas) { var f = Math.pow(10, casas || 2); return Math.round(n * f) / f; }
function fmtCent(c) { return "R$ " + (Math.round(c) / 100).toFixed(2).replace(".", ","); }

function pctObrigatoria(dados, campo, rotulo, faltando) {
  var v = dados[campo];
  if (v === "" || v === null || v === undefined) { faltando.push(rotulo); return null; }
  var n = lerDecimal(v);
  if (n === null || n < 0 || n >= 100) { faltando.push(rotulo + " (número entre 0 e 99,99)"); return null; }
  return n / 100;
}

/* Custo de UMA ficha (procedimento/produto) ou de um pacote, por
   composição. fichas: mapa id → ficha (para pacotes), insumos: mapa. */
function calcularCustos(ficha, insumos, fichas, faltando, memoria, profundidade) {
  var d = ficha.dados || {};
  var tipo = ficha.tipo;
  if ((profundidade || 0) > 3) { faltando.push("pacote dentro de pacote demais"); return null; }
  if (tipo === "pacote") {
    var comp = Array.isArray(d.componentes) ? d.componentes : [];
    if (!comp.length) { faltando.push("componentes do pacote"); return null; }
    var direto = 0, rateio = 0;
    comp.forEach(function (c, i) {
      var f = fichas[c.fichaId];
      var q = lerDecimal(c.quantidade);
      if (!f) { faltando.push("componente " + (i + 1) + ": ficha não encontrada"); return; }
      if (f.tipo === "pacote" && f.id === ficha.id) { faltando.push("o pacote não pode conter a si mesmo"); return; }
      if (!q || q <= 0 || Math.floor(q) !== q) { faltando.push(f.nome + ": quantidade de sessões (inteiro)"); return; }
      var sub = calcularCustos(f, insumos, fichas, faltando, [], (profundidade || 0) + 1);
      if (!sub) return;
      direto += sub.direto * q; rateio += sub.rateio * q;
      memoria.push(f.nome + " × " + q + " sessão(ões): custo direto " + fmtCent(sub.direto * q) + ", rateio " + fmtCent(sub.rateio * q));
    });
    return { direto: direto, rateio: rateio, materiais: null, maoDeObra: null, equipamentos: null };
  }

  var materiais = 0;
  (Array.isArray(d.itens) ? d.itens : []).forEach(function (it, i) {
    var q = lerDecimal(it.quantidade);
    if (q === null || q <= 0) { faltando.push("material " + (i + 1) + ": quantidade"); return; }
    var c = custoDoInsumo(insumos[it.insumoId], q, String(it.unidade || ""), faltando, memoria, "material " + (i + 1));
    if (c !== null) materiais += c;
  });

  var tempo = d.tempoMin === "" || d.tempoMin === null || d.tempoMin === undefined ? null : lerDecimal(d.tempoMin);
  var precisaTempo = (d.maoDeObraHora !== null && d.maoDeObraHora !== undefined && d.maoDeObraHora !== "") ||
    (d.rateio && d.rateio.modo === "por_hora");
  if (precisaTempo && (tempo === null || tempo <= 0)) faltando.push("tempo do atendimento (minutos)");

  var maoDeObra = 0;
  if (d.maoDeObraHora !== null && d.maoDeObraHora !== undefined && d.maoDeObraHora !== "") {
    var hora = Number(d.maoDeObraHora);
    if (!Number.isInteger(hora) || hora < 0) faltando.push("custo da hora de mão de obra");
    else if (tempo) { maoDeObra = hora * tempo / 60; memoria.push("Mão de obra: " + fmtCent(hora) + "/h × " + tempo + " min"); }
  }

  var equipamentos = 0;
  (Array.isArray(d.equipamentos) ? d.equipamentos : []).forEach(function (e, i) {
    var v = Number(e.custoPorUso);
    if (e.custoPorUso === "" || e.custoPorUso === null || e.custoPorUso === undefined || !Number.isInteger(v) || v < 0) {
      faltando.push("equipamento " + (i + 1) + ": custo por uso"); return;
    }
    equipamentos += v;
    memoria.push("Equipamento " + (e.nome || (i + 1)) + ": " + fmtCent(v) + " por uso");
  });

  var rateio = 0;
  var r = d.rateio || { modo: "nenhum" };
  if (r.modo === "por_hora") {
    var vh = Number(r.valor);
    if (r.valor === "" || r.valor === null || r.valor === undefined || !Number.isInteger(vh) || vh < 0) faltando.push("rateio: custo fixo por hora");
    else if (tempo) { rateio = vh * tempo / 60; memoria.push("Rateio de custos fixos: " + fmtCent(vh) + "/h × " + tempo + " min" + (r.base ? " (" + r.base + ")" : "")); }
  } else if (r.modo === "por_atendimento") {
    var va = Number(r.valor);
    if (r.valor === "" || r.valor === null || r.valor === undefined || !Number.isInteger(va) || va < 0) faltando.push("rateio: custo fixo por atendimento");
    else { rateio = va; memoria.push("Rateio de custos fixos: " + fmtCent(va) + " por atendimento" + (r.base ? " (" + r.base + ")" : "")); }
  } else if (r.modo !== "nenhum" && r.modo !== undefined) {
    faltando.push("rateio: modo desconhecido");
  }

  if (materiais) memoria.push("Materiais: " + fmtCent(materiais));
  return { direto: materiais + maoDeObra + equipamentos, rateio: rateio, materiais: materiais, maoDeObra: maoDeObra, equipamentos: equipamentos };
}

/* Avisos de dupla contagem: o que está no custo direto não pode estar
   também nas categorias rateadas. */
function avisosDaFicha(ficha) {
  var d = ficha.dados || {}, avisos = [];
  var cats = (d.rateio && Array.isArray(d.rateio.categorias)) ? d.rateio.categorias : [];
  if ((d.itens || []).length && cats.some(function (c) { return FIN_CATEGORIAS_DIRETAS.indexOf(c) >= 0; })) {
    avisos.push("O rateio inclui Materiais/Produtos, que já entram como custo direto: a mesma despesa estaria contada duas vezes.");
  }
  if ((d.equipamentos || []).length && cats.indexOf("cat-equipamentos") >= 0) {
    avisos.push("O rateio inclui Equipamentos e a ficha já tem custo de equipamento por uso.");
  }
  if (d.maoDeObraHora && cats.indexOf("cat-equipe") >= 0) {
    avisos.push("O rateio inclui Equipe e a ficha já tem custo de mão de obra.");
  }
  return avisos;
}

/* Resultado de um preço praticado P com os mesmos percentuais. */
function avaliarPreco(P, custos, r) {
  var variaveis = P * r;
  var contribuicao = P - variaveis - custos.direto;
  var resultado = contribuicao - custos.rateio;
  return {
    preco: Math.round(P), variaveis: Math.round(variaveis),
    margemContribuicao: Math.round(contribuicao), margemContribuicaoPct: P > 0 ? arred(contribuicao / P * 100, 2) : null,
    resultado: Math.round(resultado), resultadoPct: P > 0 ? arred(resultado / P * 100, 2) : null,
    markup: (custos.direto + custos.rateio) > 0 ? arred(P / (custos.direto + custos.rateio), 3) : null
  };
}

function calcularFicha(ficha, insumos, fichas) {
  var faltando = [], memoria = [];
  var custos = calcularCustos(ficha, insumos || {}, fichas || {}, faltando, memoria, 0);
  var d = ficha.dados || {};
  var taxa = pctObrigatoria(d, "taxaPagamentoPct", "taxa da forma de pagamento (%)", faltando);
  var comissao = pctObrigatoria(d, "comissaoPct", "comissão (%)", faltando);
  var impostos = pctObrigatoria(d, "impostosPct", "impostos (%)", faltando);
  var margem = pctObrigatoria(d, "margemPct", "margem desejada (%)", faltando);
  var saida = { completo: false, faltando: faltando, memoria: memoria, avisos: avisosDaFicha(ficha), bloqueio: "" };
  if (custos) {
    saida.custoDireto = Math.round(custos.direto);
    saida.rateio = Math.round(custos.rateio);
    saida.custoTotal = Math.round(custos.direto + custos.rateio);
    saida.materiais = custos.materiais === null ? null : Math.round(custos.materiais);
    saida.maoDeObra = custos.maoDeObra === null ? null : Math.round(custos.maoDeObra);
    saida.equipamentos = custos.equipamentos === null ? null : Math.round(custos.equipamentos);
  }
  if (faltando.length || !custos) return saida;
  var r = taxa + comissao + impostos;
  var den = 1 - r - margem;
  saida.r = arred(r * 100, 4);
  saida.m = arred(margem * 100, 4);
  memoria.push("Percentuais sobre o preço: taxa " + arred(taxa * 100, 2) + "% + comissão " + arred(comissao * 100, 2) +
    "% + impostos " + arred(impostos * 100, 2) + "% = " + arred(r * 100, 2) + "%; margem desejada " + arred(margem * 100, 2) + "%");
  if (den <= 0) {
    saida.bloqueio = "Taxas, comissão, impostos e margem somam " + arred((r + margem) * 100, 2) + "% do preço: não existe preço que cubra isso.";
    return saida;
  }
  var C = custos.direto + custos.rateio;
  var sugerido = C / den;
  memoria.push("Preço sugerido = " + fmtCent(C) + " ÷ (1 − " + arred(r * 100, 2) + "% − " + arred(margem * 100, 2) + "%) = " + fmtCent(sugerido));
  saida.completo = true;
  saida.precoSugerido = Math.round(sugerido);
  saida.noSugerido = avaliarPreco(sugerido, custos, r);
  if (ficha.precoAtual !== null && ficha.precoAtual !== undefined && ficha.precoAtual !== "") {
    saida.noAtual = avaliarPreco(Number(ficha.precoAtual), custos, r);
  }
  return saida;
}

/* Simulação: desconto e forma de pagamento, sem tocar na ficha. */
function simularPreco(ficha, insumos, fichas, sim) {
  var base = calcularFicha(ficha, insumos, fichas);
  if (!base.completo) return { base: base, simulacao: null };
  var d = ficha.dados || {};
  var preco = sim.preco !== undefined && sim.preco !== null && sim.preco !== "" ? Number(sim.preco) :
    (ficha.precoAtual !== null && ficha.precoAtual !== undefined ? Number(ficha.precoAtual) : base.precoSugerido);
  var desconto = sim.descontoPct ? lerDecimal(sim.descontoPct) : 0;
  if (desconto === null || desconto < 0 || desconto >= 100) return { base: base, simulacao: null, erro: "Desconto inválido." };
  var taxa = sim.taxaPagamentoPct !== undefined && sim.taxaPagamentoPct !== "" && sim.taxaPagamentoPct !== null
    ? lerDecimal(sim.taxaPagamentoPct) : lerDecimal(d.taxaPagamentoPct);
  if (taxa === null || taxa < 0 || taxa >= 100) return { base: base, simulacao: null, erro: "Taxa inválida." };
  var P = preco * (1 - desconto / 100);
  var r = taxa / 100 + lerDecimal(d.comissaoPct) / 100 + lerDecimal(d.impostosPct) / 100;
  var custos = { direto: base.custoDireto, rateio: base.rateio };
  var parcelas = Number(sim.parcelas) || 1;
  var av = avaliarPreco(P, custos, r);
  av.parcelas = parcelas;
  av.valorParcela = parcelas > 0 ? dividirCentavos(Math.round(P), parcelas)[0] : null;
  av.descontoPct = desconto;
  av.taxaPct = taxa;
  return { base: base, simulacao: av };
}

/* ---------------------------------------------------------------------
   Resumo do período — caixa, competência, previsão
   ---------------------------------------------------------------------
   dados: { despesas, movimentos, grupos, orcamentos, saldos, entradas,
            categorias } já lidos; filtros: { de, ate (AAAA-MM), categoria,
            fornecedor, estado, area, origem }; hoje: AAAA-MM-DD. */

function mesesEntre(de, ate) {
  var saida = [], m = de, guarda = 0;
  while (m <= ate && guarda++ < 240) { saida.push(m); m = finSomarMesesAoMes(m, 1); }
  return saida;
}

function ultimoDiaDoMes(mes) { var p = mes.split("-").map(Number); return finISO(p[0], p[1], finUltimoDia(p[0], p[1])); }

function despesaPassaFiltro(d, est, f) {
  if (f.categoria && d.categoriaId !== f.categoria) return false;
  if (f.fornecedor && d.fornecedorId !== f.fornecedor) return false;
  if (f.area && (d.area || "") !== f.area) return false;
  if (f.origem && (d.origem || "manual") !== f.origem) return false;
  if (f.estado && est.estado !== f.estado && !(f.estado === "vencida" && est.vencida)) return false;
  return true;
}

function resumirFinanceiro(dados, filtros, hoje) {
  var f = filtros || {};
  var de = mesValido(f.de) ? f.de : competenciaDe(hoje);
  var ate = mesValido(f.ate) ? f.ate : de;
  if (ate < de) { var t = de; de = ate; ate = t; }
  var meses = mesesEntre(de, ate);
  var inicio = de + "-01", fim = ultimoDiaDoMes(ate);

  var movPor = {};
  (dados.movimentos || []).forEach(function (m) { (movPor[m.despesaId] = movPor[m.despesaId] || []).push(m); });

  var despesas = (dados.despesas || []).map(function (d) {
    var est = estadoDaDespesa(d, movPor[d.id], hoje);
    return { d: d, est: est };
  }).filter(function (x) { return despesaPassaFiltro(x.d, x.est, f); });

  var res = {
    periodo: { de: de, ate: ate, inicio: inicio, fim: fim, meses: meses.length },
    caixa: 0, competencia: 0, previsao: 0, projecaoRecorrencias: 0,
    vencidas: { total: 0, ids: [] }, proximas: { total: 0, ids: [] },
    porCategoria: {}, porMes: {}, idsCompetencia: [], idsCaixa: [], idsPrevisao: []
  };
  meses.forEach(function (m) { res.porMes[m] = { competencia: 0, caixa: 0, entradas: 0, orcado: 0 }; });
  var limiteProximas = finSomarDias(hoje, 7);
  var ids = {};
  despesas.forEach(function (x) { ids[x.d.id] = true; });

  despesas.forEach(function (x) {
    var d = x.d, est = x.est, cat = d.categoriaId || "sem-categoria";
    var c = res.porCategoria[cat] = res.porCategoria[cat] || { competencia: 0, caixa: 0, previsao: 0, orcado: 0 };
    if (!d.cancelada && d.competencia >= de && d.competencia <= ate) {
      res.competencia += Number(d.valor) || 0;
      c.competencia += Number(d.valor) || 0;
      if (res.porMes[d.competencia]) res.porMes[d.competencia].competencia += Number(d.valor) || 0;
      res.idsCompetencia.push(d.id);
    }
    if (!d.cancelada && est.saldo > 0 && d.vencimento && d.vencimento >= inicio && d.vencimento <= fim) {
      res.previsao += est.saldo; c.previsao += est.saldo; res.idsPrevisao.push(d.id);
    }
    if (est.vencida) { res.vencidas.total += est.saldo; res.vencidas.ids.push(d.id); }
    if (!d.cancelada && est.saldo > 0 && d.vencimento >= hoje && d.vencimento <= limiteProximas) {
      res.proximas.total += est.saldo; res.proximas.ids.push(d.id);
    }
  });

  /* caixa: pela data do pagamento (estorno subtrai na data dele) */
  var catDe = {};
  despesas.forEach(function (x) { catDe[x.d.id] = x.d.categoriaId || "sem-categoria"; });
  (dados.movimentos || []).forEach(function (m) {
    if (!ids[m.despesaId] || !m.data || m.data < inicio || m.data > fim) return;
    var v = (m.tipo === "estorno" ? -1 : 1) * (Number(m.valor) || 0);
    res.caixa += v;
    var c = res.porCategoria[catDe[m.despesaId]];
    if (c) c.caixa += v;
    var mes = competenciaDe(m.data);
    if (res.porMes[mes]) res.porMes[mes].caixa += v;
    if (res.idsCaixa.indexOf(m.despesaId) < 0) res.idsCaixa.push(m.despesaId);
  });

  /* recorrências ainda não geradas: projeção, à parte — nunca paga */
  (dados.grupos || []).forEach(function (g) {
    if (g.tipo !== "recorrencia" || g.encerrado) return;
    var modelo = g.modelo || {};
    if (f.categoria && modelo.categoriaId !== f.categoria) return;
    if (f.fornecedor && modelo.fornecedorId !== f.fornecedor) return;
    if (f.area && (modelo.area || "") !== f.area) return;
    if (f.origem && f.origem !== "recorrencia") return;
    if (f.estado && f.estado !== "pendente") return;
    var depois = g.geradoAte || "0000-00-00";
    datasDaSerie(g.inicio, g.frequencia, { fim: g.fim, quantidade: g.quantidade, ate: fim }).forEach(function (o) {
      if (o.data <= depois || o.data < inicio) return;
      res.projecaoRecorrencias += Number(modelo.valor) || 0;
    });
  });

  /* orçamento: por categoria e mês, contra a competência (mesma base) */
  var alertas = [];
  (dados.orcamentos || []).forEach(function (o) {
    if (o.mes < de || o.mes > ate) return;
    if (f.categoria && o.categoriaId !== f.categoria) return;
    var c = res.porCategoria[o.categoriaId] = res.porCategoria[o.categoriaId] || { competencia: 0, caixa: 0, previsao: 0, orcado: 0 };
    c.orcado += Number(o.valor) || 0;
    if (res.porMes[o.mes]) res.porMes[o.mes].orcado += Number(o.valor) || 0;
  });
  Object.keys(res.porCategoria).forEach(function (cat) {
    var c = res.porCategoria[cat];
    if (!c.orcado) return;
    var pct = c.competencia / c.orcado * 100;
    var limite = 100;
    (dados.orcamentos || []).forEach(function (o) { if (o.categoriaId === cat && o.alertaPct) limite = Math.min(limite, Number(o.alertaPct)); });
    c.usoPct = arred(pct, 1);
    if (pct >= limite) alertas.push({ categoriaId: cat, usoPct: arred(pct, 1), orcado: c.orcado, realizado: c.competencia, estourou: pct > 100 });
  });
  res.alertasOrcamento = alertas;

  /* entradas registradas no Alveare (caixa), com proveniência. "Em haver"
     é pendente: não entra como recebido. */
  var ent = { recebido: 0, emHaver: 0, quantidade: 0, porOrigem: {}, diasComRegistro: 0 };
  var dias = {};
  (dados.entradas || []).forEach(function (e) {
    if (!e.data || e.data < inicio || e.data > fim) return;
    /* estornado na origem (Clinicorp): não conta como recebido */
    if (e.estornada) { ent.estornadas = (ent.estornadas || 0) + 1; return; }
    var origem = e.origem || "manual";
    ent.quantidade++;
    ent.porOrigem[origem] = (ent.porOrigem[origem] || 0) + 1;
    dias[e.data] = true;
    (e.pagamentos || []).forEach(function (p) {
      var v = Number(p.valor) || 0;
      if (p.metodo === "haver") ent.emHaver += v;
      else { ent.recebido += v; var mes = competenciaDe(e.data); if (res.porMes[mes]) res.porMes[mes].entradas += v; }
    });
  });
  ent.diasComRegistro = Object.keys(dias).length;
  res.entradas = ent;
  res.resultadoParcial = {
    valor: ent.recebido - res.caixa,
    explicacao: "Entradas registradas no Alveare menos saídas pagas no período. Não é lucro líquido: não inclui o que não foi registrado, taxas descontadas na liquidação nem valores em haver."
  };

  /* saldo: só com um saldo inicial confiável na data ou antes do início */
  var saldos = (dados.saldos || []).filter(function (s) { return s.data && s.data <= inicio; })
    .sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  if (saldos.length) {
    var s0 = saldos[0];
    var entradasDesde = 0, saidasDesde = 0;
    (dados.entradas || []).forEach(function (e) {
      if (e.data >= s0.data && e.data <= fim) (e.pagamentos || []).forEach(function (p) { if (p.metodo !== "haver") entradasDesde += Number(p.valor) || 0; });
    });
    (dados.movimentos || []).forEach(function (m) {
      if (m.data >= s0.data && m.data <= fim) saidasDesde += (m.tipo === "estorno" ? -1 : 1) * (Number(m.valor) || 0);
    });
    res.saldo = { confiavel: true, base: { data: s0.data, conta: s0.conta, valor: s0.valor }, valor: (Number(s0.valor) || 0) + entradasDesde - saidasDesde,
      explicacao: "Saldo inicial de " + dataBR(s0.data) + " + entradas registradas − saídas pagas até " + dataBR(fim) + "." };
  } else {
    res.saldo = { confiavel: false, explicacao: "Sem saldo inicial confiável antes do período: o saldo não é calculado." };
  }

  return res;
}

/* Período equivalente anterior (mesmo número de meses, logo antes). */
function periodoAnterior(de, ate) {
  var n = mesesEntre(de, ate).length;
  return { de: finSomarMesesAoMes(de, -n), ate: finSomarMesesAoMes(de, -1) };
}
