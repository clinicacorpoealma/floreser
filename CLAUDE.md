# Site interno — FloreSer · Corpo e Alma

Site estático servido pelo GitHub Pages, sem build. Quatro páginas soltas na raiz,
cada uma abrindo direto no navegador.

| Arquivo | Papel |
|---|---|
| `index.html` | portal: três quadrados (CRM, Agendamentos e Entradas), versão e histórico |
| `crm.html` | CRM comercial (React + Babel via CDN), funil e cadências |
| `agenda.html` | agenda das pacientes (JS puro, fontes e SheetJS embutidos) |
| `entradas.html` | entradas por dia, formas de pagamento, filtros e exportação (JS puro) |
| `version.js` | **fonte única** de versão, codinome e changelog |
| `logs.js` | registro técnico compartilhado pelas páginas |
| `painel.js` | painel de manutenção do portal (entrada discreta + senha no servidor) |
| `logo.png` / `favicon.png` | marca |

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

**Já usados:** RAIZ, SEIVA, POUSIO, ALVORADA, SERENO, LIMIAR, PRUMO, COLHEITA, VERTENTE, ORVALHO.

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

## Ao publicar

A Vania sobe os arquivos pela interface do GitHub. Sempre que `version.js` mudar,
ele precisa ir junto com o `index.html` — senão o site mostra a versão anterior.
