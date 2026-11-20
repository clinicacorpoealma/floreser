/* =====================================================================
   25_ServicoUsuarios — contas e fotos (só pelo painel de manutenção)
   ---------------------------------------------------------------------
   Senha nova sempre em PBKDF2. Mudar permissão vale na próxima requisição
   (a época derruba o cache); trocar senha ou desativar encerra todas as
   sessões da conta (credencialVersao sobe) — inclusive as que estiverem no
   cache de algum servidor do Google.
   ===================================================================== */

var TIPOS_FOTO = ["data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,"];

function fotoDoUsuario(usuarioId) {
  var f = acharPorChave("sis_fotos", String(usuarioId || ""));
  return f ? String(f.foto || "") : "";
}

function fotoAceitavel(dados) {
  var t = String(dados || "");
  if (!t || t.length > LIMITE_FOTO) return false;
  return TIPOS_FOTO.some(function (p) { return t.indexOf(p) === 0; });
}

function contaParaPainel(u, fotos) {
  return { id: u.id, nome: u.nome, usuario: u.usuario, ativo: u.ativo === true, admin: u.admin === true,
    permissoes: permissoesDe(u), foto: fotos[u.id] || "", ultimoLogin: u.ultimoLogin || "", criadoEm: u.criadoEm || "",
    esquemaSenha: u.esquema || "v1" };
}

function usuariosListar() {
  var fotos = {};
  lerTudo("sis_fotos").forEach(function (f) { fotos[f.usuarioId] = f.foto; });
  return { usuarios: lerTudo("sis_usuarios").map(function (u) { return contaParaPainel(u, fotos); }) };
}

function validarLoginNovo(login, idQueFica) {
  var alvo = normalizarLogin(login);
  if (!/^[a-z0-9._-]{3,24}$/.test(alvo)) {
    falhar("dados_invalidos", "O login aceita de 3 a 24 caracteres, entre letras, números, ponto, hífen e sublinhado.");
  }
  var existente = usuarioPorLogin(alvo);
  if (existente && existente.id !== String(idQueFica || "")) falhar("dados_invalidos", "Já existe alguém com esse login.");
  return alvo;
}

function aplicarFotoNaConta(usuarioId, d) {
  var acao = String(d.fotoAcao || "manter");
  if (acao === "remover") { removerPorChave("sis_fotos", usuarioId); return ""; }
  if (acao !== "trocar") return "";
  if (!fotoAceitavel(d.foto)) return "A imagem não foi aceita. Escolha um arquivo de imagem menor.";
  gravarPorChave("sis_fotos", { usuarioId: usuarioId, foto: String(d.foto), atualizadoEm: agoraISO() });
  return "";
}

function usuariosCriar(ctx) {
  var d = ctx.dados;
  var nome = String(d.nome || "").trim();
  if (!nome) falhar("dados_invalidos", "Informe o nome.");
  var senha = String(d.senha || "");
  if (senha.length < 6) falhar("dados_invalidos", "A senha precisa de pelo menos 6 caracteres.");
  var aviso = comTrava(function () {
    var login = validarLoginNovo(d.usuario, "");
    var s = derivarNova(senha);
    var u = { id: novoId("u"), nome: nome, usuario: login, esquema: s.esquema, senhaHash: s.senhaHash, salt: s.salt,
      iteracoes: s.iteracoes, ativo: true, admin: !!d.admin, crm: !!d.crm, agenda: !!d.agenda, entradas: !!d.entradas,
      credencialVersao: 1, criadoEm: agoraISO(), criadoPor: "painel", ultimoLogin: null, alteradoEm: agoraISO() };
    inserir("sis_usuarios", [u]);
    registrarTecnico("SECURITY", "USUARIO_CRIADO", "Usuário @" + login + " criado pelo painel.");
    return aplicarFotoNaConta(u.id, d);
  });
  var r = usuariosListar();
  if (aviso) r.aviso = aviso;
  return r;
}

function usuariosEditar(ctx) {
  var d = ctx.dados;
  var nome = String(d.nome || "").trim();
  if (!nome) falhar("dados_invalidos", "Informe o nome.");
  var problema = comTrava(function () {
    var u = usuarioPorId(d.id);
    if (!u) falhar("nao_encontrado", "Usuário não encontrado.");
    var login = validarLoginNovo(d.usuario, u.id);
    var mudouAcesso = u.admin !== !!d.admin || u.crm !== !!d.crm || u.agenda !== !!d.agenda || u.entradas !== !!d.entradas;
    u.nome = nome; u.usuario = login; u.admin = !!d.admin; u.crm = !!d.crm; u.agenda = !!d.agenda; u.entradas = !!d.entradas;
    u.alteradoEm = agoraISO();
    atualizar("sis_usuarios", [u]);
    if (mudouAcesso) avancarEpoca();
    registrarTecnico("SECURITY", "USUARIO_EDITADO", "Usuário @" + login + " editado pelo painel.");
    return aplicarFotoNaConta(u.id, d);
  });
  if (problema) falhar("dados_invalidos", problema);
  return usuariosListar();
}

function usuariosStatus(ctx) {
  var d = ctx.dados;
  comTrava(function () {
    var u = usuarioPorId(d.id);
    if (!u) falhar("nao_encontrado", "Usuário não encontrado.");
    u.ativo = !!d.ativo;
    u.alteradoEm = agoraISO();
    if (!u.ativo) u.credencialVersao = (Number(u.credencialVersao) || 0) + 1;
    atualizar("sis_usuarios", [u]);
    if (!u.ativo) revogarSessoesDaConta(u.id, "desativada"); else avancarEpoca();
    registrarTecnico("SECURITY", u.ativo ? "USUARIO_REATIVADO" : "USUARIO_DESATIVADO", "Usuário @" + u.usuario + (u.ativo ? " reativado." : " desativado."));
  });
  return usuariosListar();
}

function usuariosSenha(ctx) {
  var d = ctx.dados;
  var senha = String(d.senha || "");
  if (senha.length < 6) falhar("dados_invalidos", "A senha precisa de pelo menos 6 caracteres.");
  comTrava(function () {
    var u = usuarioPorId(d.id);
    if (!u) falhar("nao_encontrado", "Usuário não encontrado.");
    var s = derivarNova(senha);
    u.esquema = s.esquema; u.salt = s.salt; u.iteracoes = s.iteracoes; u.senhaHash = s.senhaHash;
    /* senha trocada: o verificador antigo não pode continuar valendo nem
       numa volta para a 3.5.0 — a troca pode ter sido por vazamento */
    u.legado = null;
    u.credencialVersao = (Number(u.credencialVersao) || 0) + 1;
    u.alteradoEm = agoraISO();
    atualizar("sis_usuarios", [u]);
    revogarSessoesDaConta(u.id, "senha_redefinida");
    registrarTecnico("SECURITY", "SENHA_USUARIO_REDEFINIDA", "Senha de @" + u.usuario + " redefinida pelo painel.");
  });
  return usuariosListar();
}

/* "Sair de todos os aparelhos", pedido pelo painel: a ação explícita que
   derruba as outras sessões de uma conta. */
function usuariosEncerrarSessoes(ctx) {
  var n = comTrava(function () {
    var u = usuarioPorId(ctx.dados.id);
    if (!u) falhar("nao_encontrado", "Usuário não encontrado.");
    u.credencialVersao = (Number(u.credencialVersao) || 0) + 1;
    atualizar("sis_usuarios", [u]);
    return revogarSessoesDaConta(u.id, "encerradas_pelo_painel");
  });
  registrarTecnico("SECURITY", "SESSOES_ENCERRADAS", n + " sessão(ões) encerrada(s) pelo painel.");
  return { encerradas: n };
}
