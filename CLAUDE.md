# Site interno — FloreSer · Corpo e Alma

Site estático servido pelo GitHub Pages, sem build. O portal fica na raiz e
cada módulo mora numa pasta, para o endereço não mostrar `.html`:
`/`, `/crm/`, `/agenda/`, `/entradas/`.

| Arquivo | Papel |
|---|---|
| `index.html` | portal: três quadrados (CRM, Agendamentos e Entradas), versão e histórico |
| `crm/index.html` | CRM comercial (React + Babel via CDN), funil e cadências |
| `agenda/index.html` | agenda das pacientes (JS puro, fontes e SheetJS embutidos) |
| `entradas/index.html` | entradas por dia, formas de pagamento, filtros e exportação (JS puro) |
| `crm.html` `agenda.html` `entradas.html` | atalhos de uma linha para os endereços antigos |
| `version.js` | **fonte única** de versão, codinome e changelog |
| `logs.js` | registro técnico compartilhado pelas páginas |
| `tema.js` | tema claro/escuro/automático: paleta, seletor e preferência local |
| `auth.js` | conta de usuário: tela de entrar, sessão de 30 dias, avatar e menu |
| `painel.js` | painel de manutenção do portal (entrada discreta + senha no servidor) |
| `sync.js` | conciliação de conflitos, detector de cadastro repetido e indicador de estado |
| `auditoria.js` | histórico de alterações mostrado dentro de cada ficha |
| `busca.js` | busca global do portal, por cima dos três módulos |
| `pwa.js` | camada do aplicativo: registra o Service Worker, oferece instalar, avisa de versão nova e de conexão |
| `service-worker.js` | cache da casca do sistema; **um só**, na raiz, para todo o Alveare |
| `manifest.webmanifest` | identidade do aplicativo instalado: nome Alveare, ícones, atalhos |
| `offline.html` | tela de sem conexão, sem nenhuma dependência externa |
| `icons/` | ícones do aplicativo, gerados a partir de `logo.png` |
| `logo.png` / `favicon.png` | marca |

Os arquivos compartilhados ficam **sempre na raiz**. Como as páginas dos módulos
estão um nível abaixo, elas os chamam com `../` — `../logo.png`, `../tema.js`.
Página nova dentro de pasta segue a mesma regra, e a volta para o portal é
`href="../"`, nunca `index.html`.

A **auditoria de negócio** vive na aba `Auditoria` e responde "quem mudou esta
ficha, o quê, quando". Ela é separada do **log técnico** das abas `Logs` e
`Sessoes`, que continua sendo erro, rede, sessão e segurança. Não misture os
dois: a pergunta de quem usa a clínica não é a de quem conserta o sistema.

Os três sistemas guardam dados numa planilha do Google através de um Apps Script
publicado como app da Web. O código do Apps Script **não vive neste repositório** —
ele contém as senhas e fica só no computador da Vania e no editor do Apps Script.

No painel de manutenção vale uma exceção à tipografia: valores técnicos, IDs e
linhas de log usam fonte monoespaçada, porque coluna alinhada se lê melhor. O
resto do site continua só com Cormorant e Montserrat.

Cada módulo tem a sua própria senha, conferida no Apps Script, e o seu próprio
portão de entrada — os três seguem o mesmo desenho: fundo teal profundo, cartão
creme de 400 px, marca acima do nome do módulo, campo com cadeado e olho.

Identidade visual: teal `#3B6E6A`, teal claro `#5A9490`, sage `#C9D3CA`, creme
`#F5F0EB`, taupe `#A39384`, carvão `#2D2D2D`. Títulos em Cormorant Garamond,
texto em Montserrat. **Sem emojis** — use símbolos e ícones em traço fino.
Atenção: taupe sobre creme não alcança contraste de leitura em textos pequenos;
nesses casos use teal ou carvão.

---

## REGRA PERMANENTE: versionamento e changelog

**Toda alteração neste projeto passa por esta regra, mesmo quando o pedido não
mencionar versão nem changelog.**

### Fonte única da verdade

`version.js` é o único lugar onde a versão existe. Ele exporta `window.FLORESER`
com `changelog`, `categorias`, `atual` e `rotulo`. A tela lê `rotulo` e monta o
histórico a partir de `changelog`, então tela e histórico não têm como divergir.
**Nunca escreva um número de versão à mão em outro arquivo.**

Para lançar: acrescente **um** registro no topo do array `CHANGELOG`.

### Formato

`vX.Y.Z — CODINOME`

| Nível | Incremento | Quando |
|---|---|---|
| PATCH | `X.Y.Z → X.Y.(Z+1)` | correções, ajustes visuais, responsividade, refinos internos, textos |
| MINOR | `X.Y.Z → X.(Y+1).0` | funcionalidades, telas, sistemas e melhorias relevantes |
| MAJOR | `X.Y.Z → (X+1).0.0` | reformulações estruturais, mudanças incompatíveis, nova fase do projeto |

Ao subir MINOR, `Z` volta a `0`. Ao subir MAJOR, `Y` e `Z` voltam a `0`. Nunca
carregue os números de baixo para a versão nova (`v1.4.7 → v1.5.0`, jamais
`v1.5.7`). Três segmentos, só números, sem letras, sem pular números.

### Codinome

Uma palavra, em MAIÚSCULAS, sem números e sem espaços. Não repita codinomes já
usados. Escolha algo coerente com a marca — natureza, florescimento, cuidado,
luz — ou que resuma a atualização. O codinome não interfere na numeração.

**Já usados:** RAIZ, SEIVA, POUSIO, ALVORADA, SERENO, LIMIAR, PRUMO, COLHEITA, VERTENTE, ORVALHO, CREPÚSCULO, BRISA, SENTINELA, ATALHO, CANTEIRO, REBROTA, SOLEIRA, PEITORIL, CUMEEIRA, APRUMO, UMBRAL, VERTEDOURO, PARAPEITO, TRAVESSA, VIGA, AZIMUTE, ORVALHADA, PENUMBRA, SOLSTÍCIO, ENSEADA, REMANSO.

### Changelog

Mais recente primeiro, sempre. Cada registro tem versão, codinome, data real do
lançamento em `DD/MM/AAAA` e as mudanças agrupadas por categoria. Categorias
disponíveis, nesta ordem de exibição: Adicionado, Alterado, Melhorado, Corrigido,
Removido, Visual, Conteúdo, Performance, Técnico. **Não crie categoria vazia.**

Descrições curtas, claras e úteis, do ponto de vista de quem usa o site. Nada de
"ajustes", "mudanças diversas" ou "update geral". Prefira "Corrigido o problema
que impedia o histórico de abrir no celular".

### Como decidir

Decida sozinho entre PATCH, MINOR e MAJOR — não pergunte. Agrupe todas as
alterações de uma mesma tarefa em **uma única versão**, classificada pela
mudança mais relevante do conjunto. Não gere uma versão por microalteração. Se a
alteração não muda nada para quem usa o site (só ferramenta de teste local,
documentação fora do repositório), não incremente.

### Antes de dar a tarefa por encerrada

1. A versão exibida na tela confere com a do topo do changelog.
2. O codinome confere e não é repetido.
3. Os números inferiores foram zerados quando devido.
4. A data é a data real de hoje.
5. As entradas estão da mais nova para a mais antiga.
6. Versão e histórico continuam legíveis no desktop e no celular.
7. Não sobrou nenhuma referência de versão antiga espalhada pelo projeto.

---

## Alveare — o aplicativo instalável

**Alveare é o nome do aplicativo; FloreSer é o sistema.** O que aparece no
Menu Iniciar, na tela do celular e na loja do navegador é *Alveare*. O que
aparece dentro da janela continua sendo o *FloreSer*, com a mesma marca e as
mesmas telas. Nunca troque `FloreSer` por `Alveare` na interface — a única
tela onde o nome do aplicativo aparece é o botão "Instalar Alveare" e o aviso
de versão nova.

O site é publicado em `https://clinicacorpoealma.github.io/floreser/`, que
**não é a raiz do domínio**. Por isso, dentro do manifest e do Service Worker,
tudo é relativo:

- o `manifest.webmanifest` usa `./`, `./crm/`, `./icons/…`;
- o `pwa.js` descobre a raiz pelo próprio `<script src>`, como o `logs.js`;
- o `service-worker.js` descobre a raiz por `registration.scope`.

**A única exceção** é o `id` do manifest, que vale `/floreser/`. O `id` é
resolvido a partir da origem do domínio, não do manifest, e precisa ser fixo
para o navegador reconhecer que a atualização continua sendo o mesmo
aplicativo. Se o repositório mudar de nome, esse valor muda junto — e o
sistema operacional passará a ver um aplicativo novo.

### O que entra no cache e o que nunca entra

O Service Worker guarda a **casca**: HTML das quatro páginas, os scripts da
raiz, a marca, os ícones e a `offline.html`. Guarda também, por endereço
exato, as quatro bibliotecas que o CRM carrega do cdnjs (React, ReactDOM,
Babel e SheetJS) — sem elas o CRM não desenha nada offline.

**Nunca** entram no cache: qualquer chamada ao Apps Script, qualquer `POST`,
qualquer endereço de fora que não seja uma dessas bibliotecas ou as fontes do
Google. Login, sessão, pacientes, leads, entradas e lixeira passam sempre pela
rede. Se a rede falhar, quem avisa é a tela do módulo, com a mensagem de
sempre — o cache nunca responde no lugar do servidor.

Estratégias: **rede primeiro** para as páginas e para o `version.js` (para
ninguém ficar preso numa versão velha) e **guardado enquanto atualiza** para o
resto.

### Publicar uma versão nova

Suba os arquivos como sempre. Quem já tem o Alveare instalado recebe o aviso
"Nova versão do Alveare disponível" e troca ao clicar em Atualizar — a página
recarrega uma vez e pronto. Ninguém precisa limpar cache nem apertar Ctrl+F5.

Se você mudar a **lista de arquivos** do precache no `service-worker.js`, suba
o número em `CACHE_ATUAL` (`alveare-casca-1` → `alveare-casca-2`). Esse número
é técnico e não aparece para ninguém: a versão que a tela mostra continua
saindo só do `version.js`.

### Testar

O Service Worker só funciona em `https://` ou em `localhost`/`127.0.0.1` —
abrir o arquivo direto do disco (`file://`) não serve. Para testar igual ao
GitHub Pages, sirva o projeto **debaixo de uma pasta**, não na raiz: assim um
caminho absoluto esquecido quebra no teste, e não na publicação.

No navegador, em Ferramentas do desenvolvedor → Application:

- **Manifest** — precisa dizer Alveare, com os quatro ícones e os três atalhos;
- **Service Workers** — precisa aparecer ativo, com escopo terminando em `/floreser/`;
- **Cache Storage** — precisa existir `alveare-casca-…` com a casca dentro, e
  **nenhuma** resposta do Apps Script.

Para começar do zero durante o desenvolvimento: Application → Service Workers →
Unregister, e Cache Storage → apagar o `alveare-casca-…`. O painel de
manutenção também tem, na aba Sistema, o botão "Limpar cache do aplicativo" —
ele apaga só os arquivos guardados e **não** mexe em sessão, tema nem foto.

---

## Ao publicar

A Vania sobe os arquivos pela interface do GitHub. Sempre que `version.js` mudar,
ele precisa ir junto com o `index.html` — senão o site mostra a versão anterior.
