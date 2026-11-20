/* =====================================================================
   05_Autorizacao — quem pode o quê
   ---------------------------------------------------------------------
   A permissão é lida da conta a cada requisição (ou do cache de dois
   minutos, que a época derruba quando o painel muda alguém). Nada do que
   o navegador diz sobre si mesmo conta.

   Administrador é só a conta marcada como admin no painel. A senha
   compartilhada de um módulo nunca administra: ela não diz quem é.
   ===================================================================== */

function authDaSessao(s, modulo) {
  if (s.tipo === "conta") {
    return { tipo: "usuario", usuarioId: s.usuario.id, usuarioNome: s.usuario.nome,
      modulo: modulo, admin: s.usuario.admin === true };
  }
  return { tipo: "senhaModulo", modulo: s.modulo, usuarioId: "", usuarioNome: "", admin: false };
}

/* Todas as permissões pedidas, ou nenhuma. Falta de acesso é sem_acesso:
   a sessão continua valendo para os outros módulos. */
function autorizarModulos(s, modulos) {
  modulos.forEach(function (m) {
    if (MODULOS.indexOf(m) < 0) falhar("dados_invalidos", "Módulo desconhecido.");
    var pode = s.tipo === "conta" ? permissoesDe(s.usuario)[m] : s.modulo === m;
    if (!pode) {
      if (s.tipo === "conta") registrarTecnico("SECURITY", "ACESSO_NEGADO", "@" + s.usuario.usuario + " sem permissão em " + m + ".");
      falhar("sem_acesso", "Esta conta não tem acesso a " + nomeDoModulo(m) + ".", { modulo: m });
    }
  });
  return authDaSessao(s, modulos[0]);
}

function autorizarPainel(s) {
  if (s.tipo !== "modulo" || s.modulo !== "dev") falhar("sem_acesso", "O painel de manutenção pede a senha dele.");
}

function eAdministrador(auth) {
  return !!(auth && auth.tipo === "usuario" && auth.admin);
}

function nomeDoModulo(m) {
  return { crm: "CRM", agenda: "Agenda", entradas: "Entradas", dev: "Painel" }[m] || m;
}

/* Quem fez, no formato da auditoria. */
function assinaturaDe(auth) {
  if (auth && auth.tipo === "usuario") return { tipo: "usuario", nome: auth.usuarioNome || "Usuário", id: auth.usuarioId || "" };
  if (auth && auth.modulo === "dev") return { tipo: "senhaModulo", nome: "Painel de manutenção", id: "" };
  return { tipo: "senhaModulo", nome: "Acesso compartilhado " + nomeDoModulo((auth || {}).modulo || ""), id: "" };
}
