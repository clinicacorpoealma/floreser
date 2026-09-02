/* =====================================================================
   FloreSer · Corpo e Alma — infraestrutura do CRM
   ---------------------------------------------------------------------
   O endereço do Apps Script, o token de sessão deste aparelho, a saída e o
   adaptador window.storage que a aplicação React usa para ler e gravar.

   Script CLÁSSICO, de propósito: ele roda no instante em que o navegador
   passa por ele, antes de o Babel compilar qualquer coisa. O crm.js, que é
   compilado, só roda depois — e encontra tudo daqui pronto. Trazer este
   código para dentro do crm.js atrasaria window.storage para depois do
   DOMContentLoaded sem ganho nenhum.
   ===================================================================== */

/* Endereco do Apps Script publicado (o mesmo que atende a agenda) */
var URL_API = "https://script.google.com/macros/s/AKfycbzy9WCfP4l08dn2h2K34uEL6e0mqFBjVMugcHiTc0oUGmpS7gOJjbxs58CB87AoFUw-/exec";

/* O que fica guardado neste aparelho é um token de sessão, não a senha:
   ele é emitido pelo servidor, vale só para o CRM, expira sozinho por
   inatividade e pode ser cancelado sem afetar nenhum outro aparelho. */
var CHAVE_TOKEN = "floreser.crm.sessao";
var SESSAO = { token: "", rev: 0 };

/* de onde veio a sessão: a senha do módulo ou um usuário individual */
var ORIGEM_SESSAO = { tipo: "senhaModulo" };

function guardarToken(x) { try { sessionStorage.setItem(CHAVE_TOKEN, x); } catch (e) { } }
function tokenGuardado() { try { return sessionStorage.getItem(CHAVE_TOKEN) || ""; } catch (e) { return ""; } }
function esquecerToken() { try { sessionStorage.removeItem(CHAVE_TOKEN); } catch (e) { } }

async function sairDoCRM() {
  var token = SESSAO.token;
  esquecerToken();
  SESSAO.token = "";
  try { await chamarAPI({ acao: "sair", token: token }); } catch (e) { /* segue assim mesmo */ }
  location.reload();
}

/* Ler pode ser repetido sem consequência; gravar, não — quem grava tem a
   revisão em mãos e cuida do próprio reenvio. O que se ganha aqui é o
   tropeço do redirecionamento do Apps Script, que devolve 404 de vez em
   quando sem nada estar errado. */
async function chamarAPI(dados) {
  if (window.FloreSerRede) {
    var soLeitura = String((dados && dados.acao) || "").indexOf("ler") === 0 ||
      dados.acao === "repetido_na_lixeira";
    return await window.FloreSerRede.postar(dados, { repetir: soLeitura });
  }
  var resposta = await fetch(URL_API, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(dados),
    redirect: "follow",
  });
  return await resposta.json();
}

/* Adaptador: o app continua usando window.storage,
   mas por baixo tudo vai para a planilha do Google. */
window.storage = {
  async get(chave) {
    var r = await chamarAPI({ acao: "ler", token: SESSAO.token });
    if (!r.ok) throw new Error(r.erro || "falha ao ler");
    SESSAO.rev = r.rev;
    return { key: chave, value: JSON.stringify(r.dados), shared: false };
  },
  async set(chave, valor) {
    var r = await chamarAPI({
      acao: "salvar",
      token: SESSAO.token,
      rev: SESSAO.rev,
      dados: JSON.parse(valor),
    });
    if (!r.ok) {
      if (r.erro === "conflito") {
        /* Não recarrego: isso jogaria fora o que a pessoa acabou de
           fazer. O erro leva junto o estado atual do servidor, e quem
           chamou concilia as duas versões. */
        var conflito = new Error("conflito");
        conflito.conflito = true;
        conflito.rev = r.rev;
        conflito.dados = r.dados;
        throw conflito;
      }
      if (r.erro === "sessao" || r.erro === "expirada" || r.erro === "inativo") esquecerToken();
      /* Nem sessão vencida nem acesso retirado recarregam a página: o que
         a pessoa acabou de escrever some junto. A tela avisa e o texto
         continua aqui até ela entrar de novo. */
      var falha = new Error(r.erro || "falha ao salvar");
      falha.motivo = r.erro || "";
      throw falha;
    }
    SESSAO.rev = r.rev;
    return { key: chave, value: valor, shared: false };
  },
  async delete(chave) { return { key: chave, deleted: true, shared: false }; },
  async list() { return { keys: [], shared: false }; },
};
  
