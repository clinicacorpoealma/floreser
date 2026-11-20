# Sessões — diagnóstico e política (4.0.0)

## Por que as sessões caíam (evidência do export de 19/11/2026)

Os registros técnicos (aba Logs, 27/08 a 19/11) e a aba de sessões mostraram:

1. **Trava global em toda requisição.** A 3.5.0 pegava a trava do script no
   começo de `doPost` — leituras, conferência de sessão e até telemetria —, e
   cada gravação limpava e reescrevia abas inteiras. Com duas pessoas
   salvando, quem só abria um módulo esperava até 20 s; o segundo salto do
   Apps Script (o redirecionamento para googleusercontent) estourava com 404,
   ou a resposta era `ocupado`. Ex.: 05/10, três 404 seguidos na retomada e,
   em 22 s, dois logins novos — com o token ainda válido.
2. **A tela de falha da retomada oferecia "Entrar com senha / outra conta"**
   mesmo em erro passageiro. Para quem usa, parecia logout.
3. **Falta de acesso a um módulo** empurrava a pessoa a sair e entrar (16/10:
   `sem_acesso` no CRM → logout → login → senha errada → login).
4. **Corrida:** `retomar()` apagava o token GUARDADO ao receber `sessao` de um
   token antigo — uma resposta atrasada podia apagar a sessão nova.
5. **Atividade local** (`venceuLocalmente()`) decidia sozinha que 30 dias
   tinham passado, sem perguntar ao servidor, que renovava pelo uso.
6. **Login repetido em 404** criava sessões órfãs (pares no mesmo minuto).
7. **A tabela de sessões era reescrita inteira** a cada login/logout.
8. **Senha do módulo:** token por aba, 30 min de inatividade (por desenho), e
   o mapa de sessões numa única Script Property regravada a cada pedido.
9. O defeito de `revogado: "não"` (corrigido na 3.2.0) explica as quedas de
   agosto e setembro, não as de outubro e novembro.

## Política entregue

| | Conta individual (caminho principal) | Senha compartilhada (transição) |
|---|---|---|
| Onde fica no navegador | `localStorage` (`floreser.sessao.v2`), todas as abas e módulos | `sessionStorage`, por aba e por módulo |
| Inatividade | 30 dias, renovados pelo uso (no máximo uma escrita por hora) | 30 minutos (renovação a cada 5 min de uso) |
| Teto absoluto | 180 dias — depois, senha de novo | 12 horas |
| Quem decide | o servidor (`sis_sessoes`), devolvendo `expiraEm` e `expiraAbsoluto` em cada resposta | idem |
| Sair | encerra só esta sessão; outros aparelhos continuam | idem |
| Desativar conta / trocar senha | `credencialVersao` sobe e todas as sessões da conta acabam, inclusive no cache (época) | — |
| Mudar permissão | vale na próxima requisição; não derruba a sessão | — |
| "Sair de todos os aparelhos" | ação explícita do painel (`painel.usuarios.encerrarSessoes`) | — |

O token tem 320 bits do gerador da plataforma; a planilha guarda só o
SHA-256. O cache de sessão (120 s) é auxiliar e carimbado com a época: sem
ele, a planilha responde igual.

## Regras do navegador (`compartilhado/sessao.js`, `rede.js`, `auth.js`)

- Só uma resposta de categoria `autenticacao` apaga a sessão, e só se o
  token recusado ainda for o guardado (comparar antes de apagar).
- `sem_acesso`, `ocupado`, sem rede, prazo, 404, resposta inválida, versão,
  manutenção: a sessão fica. A retomada tenta de novo sozinha (0 s, 1,5 s,
  4 s) e, se persistir, oferece "Tentar novamente" — não "entrar de novo".
- Conferências simultâneas viram uma; confirmação dos últimos 5 min dispensa
  o servidor; a primeira leitura do módulo também confirma a sessão.
- Nada de polling: confere de novo só ao voltar para a aba ou à conexão, se
  passaram 10 min desde a última confirmação.
- Outra aba entrou, saiu ou trocou de conta: evento `storage` → as abas
  acompanham. O motor de dados se recusa a enviar alterações de uma conta em
  nome de outra (`contaTrocada`).
- Sessão acabou no meio do trabalho: a caixa de entrar (ou a senha do módulo)
  aparece **por cima** da tela; o que não foi salvo fica na memória e sobe
  logo depois. Nada é gravado em disco.
- Atualização do Alveare e "Limpar cache do aplicativo" não tocam em sessão.
- A sessão aberta na 3.5.0 (`floreser.usuario.sessao`) é adotada na primeira
  abertura da 4.0.0: o servidor migrou a linha dela.
- Senha nunca é guardada; não existe login silencioso.

## Transição da senha compartilhada

A senha de cada módulo continua funcionando (agora conferida contra um hash
PBKDF2 nas Script Properties). O portão mostra a conta como caminho principal
e a senha do módulo como alternativa. No painel → Sistema, cada senha pode ser
**desligada**: quem já entrou por ela segue até a sessão vencer (≤ 30 min sem
uso); entradas novas respondem `senha_modulo_desligada`. A senha compartilhada
nunca vira conta, nem administradora, nem sessão permanente.

## Referência

Adaptado das recomendações do OWASP Session Management Cheat Sheet (tokens
aleatórios longos, hash no servidor, expiração por inatividade e absoluta
definidas no servidor, revogação no logout e na troca de credencial,
invalidação por evento) ao ambiente real: site estático no GitHub Pages (sem
cookie de sessão próprio, por isso token em armazenamento local por origem) e
Apps Script (sem servidor persistente, por isso tabela + cache com época).
