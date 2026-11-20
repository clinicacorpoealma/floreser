/* =====================================================================
   04_Sessoes — senhas, entrar, sair e conferir sessão
   ---------------------------------------------------------------------
   Uma tabela só (sis_sessoes) para os dois jeitos de entrar, com políticas
   diferentes, decididas AQUI e devolvidas ao navegador em cada resposta:

     conta    pessoa identificada. 30 dias sem uso vence; 180 dias é o
              teto absoluto. O prazo de inatividade é renovado pelo uso,
              no máximo uma escrita por hora.
     modulo   senha compartilhada de um módulo (e a do painel). Não diz
              quem é a pessoa. 30 minutos sem uso, 12 horas no máximo.

   O token viaja; a planilha guarda só o SHA-256 dele. Revogar é carimbar
   revogadoEm — a linha fica até a faxina, para o painel ver o histórico.

   O que NÃO derruba sessão: falta de acesso a um módulo (sem_acesso),
   servidor ocupado, erro passageiro. Só as respostas de categoria
   "autenticacao" fazem o navegador pedir login de novo.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Criptografia
   --------------------------------------------------------------------- */

function bytesParaHex(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}

function hexParaBytes(hex) {
  var t = String(hex || ""), bytes = [];
  for (var i = 0; i + 1 < t.length; i += 2) {
    var b = parseInt(t.substr(i, 2), 16);
    bytes.push(b > 127 ? b - 256 : b);
  }
  return bytes;
}

function sha256Hex(texto) {
  return bytesParaHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8));
}

/* Dois UUIDs do gerador seguro da plataforma, uniformizados pelo hash. */
function novoSegredoHex() {
  return sha256Hex(Utilities.getUuid() + "|" + Utilities.getUuid() + "|" + Date.now());
}

function novoId(prefixo) {
  return (prefixo || "") + Utilities.getUuid().replace(/-/g, "").slice(0, 16);
}

/* PBKDF2-HMAC-SHA256, um bloco de 32 bytes (RFC 8018). O Apps Script não
   traz PBKDF2 pronto, mas traz HMAC-SHA-256 — e PBKDF2 é HMAC repetido
   com XOR acumulado. */
function pbkdf2Hex(senha, saltHex, iteracoes, pimenta) {
  var chave = Utilities.newBlob(String(senha) + "|" + String(pimenta || "")).getBytes();
  var bloco = hexParaBytes(saltHex).concat([0, 0, 0, 1]);
  var u = Utilities.computeHmacSha256Signature(bloco, chave);
  var saida = u.slice();
  for (var i = 1; i < iteracoes; i++) {
    u = Utilities.computeHmacSha256Signature(u, chave);
    for (var j = 0; j < saida.length; j++) saida[j] = saida[j] ^ u[j];
  }
  return bytesParaHex(saida);
}

/* O esquema da 3.5.0, conferido como sempre foi. */
function derivarSenhaV1(senha, salt) {
  var atual = String(salt) + "|" + String(senha || "") + "|" + pimenta();
  for (var i = 0; i < SENHA_V1_RODADAS; i++) atual = sha256Hex(atual);
  return atual;
}

function pimenta() {
  var p = propriedade("FLORESER_PIMENTA", "");
  if (!p) falhar("instalacao_incompleta", "A pimenta das senhas não está configurada (FLORESER_PIMENTA).");
  return p;
}

function iguaisEmTempoConstante(a, b) {
  var x = String(a || ""), y = String(b || "");
  if (x.length !== y.length) return false;
  var d = 0;
  for (var i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function senhaConfere(u, senha) {
  if (!u || !u.senhaHash) return false;
  if (u.esquema === "pbkdf2") {
    return iguaisEmTempoConstante(u.senhaHash, pbkdf2Hex(senha, u.salt, Number(u.iteracoes) || SENHA_PBKDF2_ITERACOES, pimenta()));
  }
  return iguaisEmTempoConstante(u.senhaHash, derivarSenhaV1(senha, u.salt));
}

function derivarNova(senha) {
  var salt = novoSegredoHex().slice(0, 32);
  return { esquema: "pbkdf2", salt: salt, iteracoes: SENHA_PBKDF2_ITERACOES,
    senhaHash: pbkdf2Hex(senha, salt, SENHA_PBKDF2_ITERACOES, pimenta()) };
}

/* ---------------------------------------------------------------------
   Contas
   --------------------------------------------------------------------- */

function normalizarLogin(login) {
  return String(login || "").trim().toLowerCase();
}

function usuarioPorLogin(login) {
  var alvo = normalizarLogin(login);
  if (!alvo) return null;
  return lerTudo("sis_usuarios").filter(function (u) { return normalizarLogin(u.usuario) === alvo; })[0] || null;
}

function usuarioPorId(id) {
  return acharPorChave("sis_usuarios", String(id || ""));
}

function permissoesDe(u) {
  var admin = u.admin === true;
  return { crm: admin || u.crm === true, agenda: admin || u.agenda === true, entradas: admin || u.entradas === true };
}

function publicoDaConta(u, comFoto) {
  var p = { id: u.id, nome: u.nome, usuario: u.usuario, admin: u.admin === true, permissoes: permissoesDe(u) };
  if (comFoto) p.foto = fotoDoUsuario(u.id);
  return p;
}

/* ---------------------------------------------------------------------
   Bloqueio por tentativas — por login e por módulo
   --------------------------------------------------------------------- */

function conferirBloqueio(chave) {
  var ate = Number(propriedade("bloq." + chave, "0")) || 0;
  if (ate > Date.now()) {
    falhar("bloqueado", "Muitas tentativas erradas. Tente de novo em alguns minutos.",
      { minutos: Math.ceil((ate - Date.now()) / 60000) });
  }
}

function anotarFalha(chave) {
  var falhas = (Number(propriedade("falhas." + chave, "0")) || 0) + 1;
  if (falhas >= FALHAS_ATE_BLOQUEIO) {
    definirPropriedade("bloq." + chave, String(Date.now() + BLOQUEIO_MINUTOS * 60000));
    definirPropriedade("falhas." + chave, "0");
  } else {
    definirPropriedade("falhas." + chave, String(falhas));
  }
  return Math.max(0, FALHAS_ATE_BLOQUEIO - falhas);
}

function limparFalhas(chave) {
  if (propriedade("falhas." + chave, "0") !== "0") definirPropriedade("falhas." + chave, "0");
}

/* ---------------------------------------------------------------------
   Entrar
   --------------------------------------------------------------------- */

function acaoEntrar(ctx) {
  var login = normalizarLogin(ctx.dados.usuario);
  var senha = String(ctx.dados.senha || "");
  if (!login || !senha) falhar("credenciais", "Informe usuário e senha.");
  conferirBloqueio("u." + login);

  var u = usuarioPorLogin(login);
  var confere = u ? senhaConfere(u, senha) : (derivarSenhaV1(senha, "x"), false);
  if (!u || !confere || u.ativo !== true) {
    var restam = anotarFalha("u." + login);
    registrarTecnico("SECURITY", "LOGIN_USUARIO_FALHA", "Falha em @" + login + (u && u.ativo !== true ? " (inativo)" : ""));
    falhar("credenciais", "Usuário ou senha incorretos.", { restam: restam });
  }
  limparFalhas("u." + login);

  var opId = RE_OPERACAO.test(String(ctx.dados.operacaoId || "")) ? String(ctx.dados.operacaoId) : "";
  var saida = comTrava(function () {
    var atual = usuarioPorId(u.id);
    if (atual.esquema !== "pbkdf2") {
      /* a senha acabou de conferir: hora de trocar o esquema antigo pelo PBKDF2 */
      var nova = derivarNova(senha);
      /* o verificador antigo fica guardado até migracaoFinalizar(): é o que
         deixa voltar para a 3.5.0 sem trancar quem entrou depois da migração */
      if (!atual.legado || !atual.legado.senhaHashV1) atual.legado = { senhaHashV1: atual.senhaHash, saltV1: atual.salt };
      atual.esquema = nova.esquema; atual.salt = nova.salt; atual.iteracoes = nova.iteracoes; atual.senhaHash = nova.senhaHash;
    }
    atual.ultimoLogin = agoraISO();
    atualizar("sis_usuarios", [atual]);
    if (opId) revogarOrfas(atual.id, opId);
    var token = abrirSessao({ tipo: "conta", usuarioId: atual.id, modulo: "",
      credencialVersao: Number(atual.credencialVersao) || 0, operacaoId: opId, agente: ctx.cliente.agente });
    faxinaDeSessoes();
    return { token: token, usuario: atual };
  });

  registrarTecnico("SECURITY", "LOGIN_USUARIO_SUCESSO", "Entrou como @" + saida.usuario.usuario);
  var sessao = validarSessao(saida.token);
  return { token: saida.token, sessao: resumoDaSessao(sessao), conta: publicoDaConta(saida.usuario, true) };
}

function acaoEntrarModulo(ctx) {
  var modulo = String(ctx.dados.modulo || "");
  if (MODULOS_COM_SENHA.indexOf(modulo) < 0) falhar("dados_invalidos", "Módulo desconhecido.");
  if (!senhaDeModuloLigada(modulo)) {
    falhar("senha_modulo_desligada", "A senha compartilhada deste módulo foi desligada. Entre com a sua conta.");
  }
  conferirBloqueio("m." + modulo);
  if (propriedade("FLORESER_SENHA_" + modulo.toUpperCase(), "")) prepararSegredos();
  var guardada = null;
  try { guardada = JSON.parse(propriedade("FLORESER_SENHA_HASH_" + modulo.toUpperCase(), "null")); } catch (e) { }
  if (!guardada) falhar("instalacao_incompleta", "A senha deste módulo não está configurada.");

  var senha = String(ctx.dados.senha || "");
  var confere = iguaisEmTempoConstante(guardada.hash, pbkdf2Hex(senha, guardada.salt, guardada.iteracoes, ""));
  if (!confere) {
    var restam = anotarFalha("m." + modulo);
    registrarTecnico("SECURITY", "SENHA_RECUSADA", "Senha de " + modulo + " recusada.");
    falhar("credenciais", "Senha incorreta.", { restam: restam });
  }
  limparFalhas("m." + modulo);

  var token = comTrava(function () {
    return abrirSessao({ tipo: "modulo", usuarioId: "", modulo: modulo, credencialVersao: 0,
      operacaoId: "", agente: ctx.cliente.agente });
  });
  registrarTecnico("SECURITY", "SESSAO_ABERTA", "Sessão aberta em " + modulo + ".");
  return { token: token, sessao: resumoDaSessao(validarSessao(token)) };
}

function abrirSessao(o) {
  var token = novoSegredoHex() + novoSegredoHex().slice(0, 16);
  var agora = Date.now();
  var conta = o.tipo === "conta";
  inserir("sis_sessoes", [{
    tokenHash: sha256Hex(token), tipo: o.tipo, usuarioId: o.usuarioId, modulo: o.modulo,
    criadoEm: agora, ultimoUso: agora,
    expiraEm: agora + (conta ? SESSAO_CONTA_INATIVIDADE_MS : SESSAO_MODULO_INATIVIDADE_MS),
    expiraAbsoluto: agora + (conta ? SESSAO_CONTA_ABSOLUTO_MS : SESSAO_MODULO_ABSOLUTO_MS),
    revogadoEm: null, motivo: "", credencialVersao: o.credencialVersao || 0,
    operacaoId: o.operacaoId || "", agente: String(o.agente || "").slice(0, 60)
  }]);
  return token;
}

/* Login repetido porque a resposta se perdeu: a primeira sessão nunca
   chegou ao navegador. Ela é encerrada em vez de ficar órfã por 30 dias. */
function revogarOrfas(usuarioId, opId) {
  var limite = Date.now() - 10 * 60000;
  var orfas = lerTudo("sis_sessoes").filter(function (s) {
    return s.operacaoId === opId && s.usuarioId === usuarioId && !s.revogadoEm && Number(s.criadoEm) > limite;
  });
  orfas.forEach(function (s) { s.revogadoEm = Date.now(); s.motivo = "substituida"; });
  if (orfas.length) atualizar("sis_sessoes", orfas);
}

/* Linhas vencidas ou revogadas há mais de 30 dias saem, no máximo uma vez
   por dia. A tabela só cresceria, e cada validação sem cache a lê. */
function faxinaDeSessoes() {
  var hoje = hojeNaClinica();
  if (propriedade("faxina.sessoes", "") === hoje) return;
  var corte = Date.now() - SESSAO_LIMPAR_DEPOIS_MS;
  var velhas = lerTudo("sis_sessoes").filter(function (s) {
    var fim = s.revogadoEm || Math.min(Number(s.expiraEm) || 0, Number(s.expiraAbsoluto) || 0);
    return fim && fim < corte;
  });
  if (velhas.length) remover("sis_sessoes", velhas);
  definirPropriedade("faxina.sessoes", hoje);
}

/* ---------------------------------------------------------------------
   Conferir
   --------------------------------------------------------------------- */

function chaveDaSessaoNoCache(hash) { return "ses." + epoca() + "." + hash; }

function validarSessao(token) {
  var bruto = String(token || "");
  if (!bruto) falhar("sessao_ausente", "Entre para continuar.");
  var hash = sha256Hex(bruto);
  var agora = Date.now();

  var guardada = null;
  try {
    var c = CacheService.getScriptCache().get(chaveDaSessaoNoCache(hash));
    if (c) { guardada = JSON.parse(c); anotar("cache"); }
  } catch (e) { guardada = null; }

  if (!guardada) {
    var s = acharPorChave("sis_sessoes", hash);
    if (!s) falhar("sessao_invalida", "Esta sessão não é reconhecida. Entre de novo.");
    if (s.revogadoEm) falhar("sessao_revogada", "Esta sessão foi encerrada. Entre de novo.");
    guardada = { tokenHash: hash, tipo: s.tipo, usuarioId: s.usuarioId, modulo: s.modulo,
      expiraEm: Number(s.expiraEm), expiraAbsoluto: Number(s.expiraAbsoluto), ultimoUso: Number(s.ultimoUso),
      credencialVersao: Number(s.credencialVersao) || 0, usuario: null };
    if (s.tipo === "conta") {
      var u = usuarioPorId(s.usuarioId);
      if (!u) falhar("sessao_invalida", "A conta desta sessão não existe mais.");
      guardada.usuario = { id: u.id, nome: u.nome, usuario: u.usuario, ativo: u.ativo === true,
        admin: u.admin === true, crm: u.crm === true, agenda: u.agenda === true, entradas: u.entradas === true,
        credencialVersao: Number(u.credencialVersao) || 0 };
    }
    guardarSessaoNoCache(guardada);
  }

  /* o prazo vale contra o relógio de agora, venha a sessão de onde vier */
  if (agora > guardada.expiraEm || agora > guardada.expiraAbsoluto) {
    falhar("sessao_expirada", guardada.tipo === "conta"
      ? "Sua sessão expirou. Entre de novo para continuar."
      : "A sessão da senha do módulo expirou por inatividade. Informe a senha de novo.");
  }
  if (guardada.tipo === "conta") {
    if (!guardada.usuario.ativo) falhar("conta_inativa", "Esta conta foi desativada.");
    if (guardada.usuario.credencialVersao !== guardada.credencialVersao) {
      falhar("sessao_revogada", "A senha ou o acesso desta conta mudou. Entre de novo.");
    }
  }

  var intervalo = guardada.tipo === "conta" ? SESSAO_CONTA_RENOVAR_MS : SESSAO_MODULO_RENOVAR_MS;
  if (agora - guardada.ultimoUso > intervalo) renovarSessao(guardada, agora);
  return guardada;
}

function guardarSessaoNoCache(s) {
  try { CacheService.getScriptCache().put(chaveDaSessaoNoCache(s.tokenHash), JSON.stringify(s), SESSAO_CACHE_SEGUNDOS); }
  catch (e) { }
}

/* Renovar é escrever, e escrever pede a trava. Se ela estiver ocupada, a
   renovação fica para a próxima requisição: o prazo tem folga de sobra, e
   falhar uma leitura por causa disso seria derrubar sessão por nada. */
function renovarSessao(s, agora) {
  var fazer = function () {
    var linha = acharPorChave("sis_sessoes", s.tokenHash);
    if (!linha || linha.revogadoEm) return;
    var conta = linha.tipo === "conta";
    linha.ultimoUso = agora;
    linha.expiraEm = Math.min(Number(linha.expiraAbsoluto),
      agora + (conta ? SESSAO_CONTA_INATIVIDADE_MS : SESSAO_MODULO_INATIVIDADE_MS));
    atualizar("sis_sessoes", [linha]);
    s.ultimoUso = agora;
    s.expiraEm = Number(linha.expiraEm);
    guardarSessaoNoCache(s);
  };
  if (_NA_TRAVA) { fazer(); return; }
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(1500)) return;
  try { fazer(); SpreadsheetApp.flush(); }
  catch (e) { console.warn("renovação adiada: " + e); }
  finally { trava.releaseLock(); }
}

function resumoDaSessao(s) {
  return {
    tipo: s.tipo, modulo: s.modulo || "", contaId: s.usuarioId || "",
    expiraEm: new Date(s.expiraEm).toISOString(), expiraAbsoluto: new Date(s.expiraAbsoluto).toISOString()
  };
}

/* O site pergunta "quem sou eu, e posso abrir este módulo?". Não ter acesso
   ao módulo é resposta, não erro: a conta continua valendo no resto. */
function acaoConferirSessao(ctx) {
  var s = ctx.sessao;
  var modulo = String(ctx.dados.modulo || "");
  var r = { tipo: s.tipo, modulo: s.modulo || "" };
  if (s.tipo === "conta") {
    var u = usuarioPorId(s.usuarioId);
    r.conta = publicoDaConta(u, !!ctx.dados.comFoto);
    if (modulo) r.acessoModulo = MODULOS.indexOf(modulo) >= 0 && !!r.conta.permissoes[modulo];
  } else if (modulo) {
    r.acessoModulo = s.modulo === modulo;
  }
  return r;
}

/* Sair encerra ESTA sessão. Os outros aparelhos continuam. */
function acaoSair(ctx) {
  comTrava(function () {
    var linha = acharPorChave("sis_sessoes", ctx.sessao.tokenHash);
    if (linha && !linha.revogadoEm) {
      linha.revogadoEm = Date.now();
      linha.motivo = "saiu";
      atualizar("sis_sessoes", [linha]);
    }
  });
  try { CacheService.getScriptCache().remove(chaveDaSessaoNoCache(ctx.sessao.tokenHash)); } catch (e) { }
  registrarTecnico("SECURITY", ctx.sessao.tipo === "conta" ? "LOGOUT_USUARIO" : "SESSAO_ENCERRADA",
    "Sessão encerrada" + (ctx.sessao.modulo ? " em " + ctx.sessao.modulo : "") + ".");
  return { saiu: true };
}

/* Desativar, trocar senha ou mudar permissão: todas as sessões da conta
   acabam, e o cache inteiro é descartado pela época. */
function revogarSessoesDaConta(usuarioId, motivo) {
  var vivas = lerTudo("sis_sessoes").filter(function (s) { return s.usuarioId === usuarioId && !s.revogadoEm; });
  vivas.forEach(function (s) { s.revogadoEm = Date.now(); s.motivo = motivo; });
  if (vivas.length) atualizar("sis_sessoes", vivas);
  avancarEpoca();
  return vivas.length;
}
