# Site interno — FloreSer · Corpo e Alma

Site estático servido pelo GitHub Pages, sem build, falando com um Google
Apps Script que guarda tudo numa planilha do Google. O portal fica na raiz e
cada módulo mora numa pasta, para o endereço não mostrar `.html`:
`/`, `/crm/`, `/agenda/`, `/entradas/`.

Documentação completa em `docs/`: [ARQUITETURA](docs/ARQUITETURA.md),
[API](docs/API.md), [ESQUEMA](docs/ESQUEMA.md), [SESSOES](docs/SESSOES.md),
[PUBLICACAO](docs/PUBLICACAO.md). Leia o documento da área antes de mexer nela.

## Onde cada coisa mora

**Uma responsabilidade por arquivo, e três camadas separadas:** o HTML diz o
que a página *é*, o CSS diz como ela *se parece*, o JS diz como ela *se
comporta*. Nenhum dos três volta a morar dentro do outro.

### Raiz (endereços públicos e o que precisa ficar na raiz)

| Arquivo | Papel |
|---|---|
| `index.html` | portal: os três quadrados (CRM, Agendamentos, Entradas), o rodapé e as duas janelas |
| `crm.html` `agenda.html` `entradas.html` | atalhos de uma linha para os endereços antigos |
| `version.js` | **fonte única** dos metadados de lançamento: versão, codinome, changelog, `compat` (API e schema que o site espera) e `casca` (cache da PWA). O Service Worker importa este arquivo; ele não pode depender de `window` |
| `service-worker.js` | cache da casca; **um só**, na raiz, para todo o Alveare |
| `manifest.webmanifest` · `offline.html` · `icons/` · `logo.png` · `favicon.png` | aplicativo instalável e marca |

### `compartilhado/` — o frontend comum

| Arquivo | Papel |
|---|---|
| `config.js` | **o endereço do Apps Script, num lugar só**; a raiz do site; a versão do contrato (`api`) |
| `tema.js` | tema claro/escuro/automático |
| `rede.js` | `FloreSerRede` — o único caminho até o servidor: envelope v2, prazo, repetição de leitura, leituras iguais viram uma, categorias de erro, avisa a sessão |
| `sessao.js` | `FloreSerSessao` — guarda e confere a sessão (conta e senha de módulo), comparar antes de apagar, eventos entre abas |
| `dados.js` | `FloreSerDados` — motor de sincronização: operações por entidade a partir da base confirmada, conflito localizado, reenvio com o mesmo `operacaoId` |
| `auth.js` | `FloreSerAuth` — só interface: caixa de entrar, retomada, quem está, `pedirNovamente` |
| `sync.js` | `FloreSerSync` — conciliação de três vias, repetidos, indicador de salvamento, `temPendencias` |
| `auditoria.js` · `busca.js` | histórico da ficha · busca global |
| `pwa.js` | registra o Service Worker, instalar, versão nova (espera o "salvo"), conexão |
| `logs.js` | registro técnico (telemetria), com envio próprio |
| `atividade-rede.js` / `.css` | o selo que mostra quando o sistema fala com a planilha |

### Módulos

| Arquivo | Papel |
|---|---|
| `portal/portal.css` · `portal/portal.js` | apresentação e comportamento do portal (o CSS também veste o painel) |
| `admin/painel.js` | painel de manutenção (entrada discreta + senha `dev` no servidor) |
| `crm/index.html` | casca do CRM, as bibliotecas e a aplicação React em JSX — que fica aqui dentro de propósito, ver abaixo |
| `crm/crm.css` | paleta `--crm-*`, portão `.pt-*`, resumos, fila do Comercial 2, ficha, diálogos (`.crm-dialogo-*`, `.crm-botao`) |
| `crm/crm-core.js` | a ponte do JSX com o compartilhado: `window.storage` sobre o motor, `chamarAPI` (tradução das chamadas antigas), `motorCRM` |
| `agenda/index.html` · `agenda.css` · `agenda.js` | Agenda (as seis `@font-face` locais ficam no CSS) |
| `entradas/index.html` · `entradas.css` · `entradas.js` | Entradas |

### Backend, testes e ferramentas

| Pasta | Papel |
|---|---|
| `backend/` | Apps Script (V8), **sem segredo nenhum**: `00_Config` · `01_Http` (contrato e rotas) · `02_Tabelas` (acesso às abas, tipos) · `03_Concorrencia` (trava, revisão, operações, diário) · `04_Sessoes` · `05_Autorizacao` · `10_Esquema` · `20`–`29` regras e serviços · `40_Migracoes` · `41_Manutencao` |
| `backend/legado/` | o `Codigo.gs` da 3.5.0, com as senhas — **só no computador, fora do GitHub** |
| `testes/` | simulador do Apps Script, testes (`backend.js`, `migracao.js`, `frontend.js`), servidor local |
| `ferramentas/` | `conferir-publicacao.js`, `preparar-publicacao.js`, `ensaiar-migracao-xlsx.js`, `medir-antes-depois.js` |
| `vendor/` | bibliotecas de terceiros, **intocadas**: `xlsx.full.min.js` (SheetJS 0.18.5) |
| `assets/fonts/` | as seis WOFF2 da marca |

### As regras

Páginas dos módulos estão um nível abaixo da raiz: chamam o resto com `../`
(`../compartilhado/rede.js`, `../logo.png`), e a volta para o portal é
`href="../"`. CSS que muda de pasta leva os `url()` junto. Nada de caminho
absoluto — o site mora em `/floreser/`.

**Código compartilhado vai para `compartilhado/`; código de um módulo fica na
pasta dele.** Arquivo compartilhado novo só quando a responsabilidade é mesmo
de todos — nada de `utils.js` para juntar funções sem parentesco.

**Nenhum módulo fala com o servidor sem `FloreSerRede`, e nenhum guarda token
sem `FloreSerSessao`.** O endereço do Apps Script só existe em
`compartilhado/config.js` (a conferência de publicação recusa outro lugar).

**Não devolva CSS nem JavaScript para dentro do HTML**, e não gere markup
estrutural por `innerHTML` só para encurtar o HTML.

**Não edite nada dentro de `vendor/`.**

O projeto continua **sem build**: HTML, CSS e JavaScript clássicos, globais
controlados (`window.FLORESER`, `FLORESER_CONFIG`, `FloreSerRede`,
`FloreSerSessao`, `FloreSerDados`, `FloreSerAuth`, `FloreSerSync`,
`FloreSerAuditoria`, `FloreSerBusca`, `FloreSerLogs`, `FloreSerAtividade`) e o
Babel Standalone só no CRM. Sem npm, sem bundler, sem ES modules. Os testes e
ferramentas rodam com `node` puro, sem dependências.

**A ordem dos `<script>` importa:** `compartilhado/tema.js` primeiro, no
`<head>`; depois `version.js`, `config.js`, `atividade-rede.js`, `logs.js`,
`rede.js`, `pwa.js`, `sessao.js`, `auth.js` e, nos módulos, `sync.js`,
`dados.js`, `auditoria.js`; o script do módulo por último, no fim do `<body>`.
Nenhum leva `defer`/`async`, exceto `admin/painel.js` (sempre teve `defer`).
Toda página leva `<meta name="floreser-estrutura" content="2">` — sem ela o
`version.js` entende que é uma página velha em cache e recarrega uma vez.

### O CRM é a exceção, e por um motivo concreto

**O JSX do CRM mora dentro do `crm/index.html`, e deve continuar lá.** O
Babel Standalone busca `<script type="text/babel" src>` por XHR, e o Chrome
bloqueia XHR entre arquivos locais: por `file://` o CRM abriria em branco.
O `crm.css` e o `crm-core.js` são separados porque entram por `<link>` e
`<script src>` comuns. O `crm-core.js` é **clássico** de propósito: roda antes
do bloco compilado.

## Os dados

O desenho das abas é o **schema 2** (`backend/10_Esquema.gs`,
[ESQUEMA](docs/ESQUEMA.md)): uma aba por entidade, id estável, cabeçalho manda,
tipos conferidos, tudo gravado como texto. Datas de calendário `AAAA-MM-DD`;
instantes em UTC; dinheiro em **centavos inteiros** na lógica e `"350.00"` na
planilha, convertido por texto. As abas da 3.5.0 ficam intactas para retorno.

**Salvar não manda o módulo inteiro.** O motor (`compartilhado/dados.js`)
compara a base confirmada com a tela e manda operações por entidade, cada uma
com a revisão de que partiu e um `operacaoId` estável. Conflito é por ficha.
Ao mexer no estado de um módulo:
- coleção nova com id próprio entra **no motor do módulo** (`colecoes`) e no
  esquema de conciliação (`ESQUEMA_CRM`, `ESQUEMA_AGENDA`, `ESQUEMA_ENTRADAS`);
  fora deles, a lista vira um campo só;
- campo novo de uma entidade entra na lista `campos` do motor, no esquema do
  backend e na validação da operação no serviço — campo fora da lista é
  recusado pelo servidor;
- regra de negócio nova é conferida **no servidor** (serviço + regras puras),
  não só na tela.

### O estado do CRM

O CRM grava três partes: `leads`, `dias` (intervalos das cadências, em
`sis_config`) e `contatos`. `contatos` são eventos `{ id, leadId, data,
criadoEm }`, um por toque em "Contatei". **A única origem é
`registrarContato`**, e é daí que sai "contatos feitos hoje". Não calcule isso
por `ultimoContato`. `data` é o dia local de `hojeISO()`, nunca
`toISOString()`. O evento sobe **dentro da operação da lead** que mudou junto
(`anexarEm`). No servidor, `crm_contatos` só cresce: acrescenta ids que não
conhece, nunca apaga, carimba o autor pela sessão, fica fora da auditoria da
ficha e da exclusão definitiva da lead. A leitura devolve os últimos 62 dias.

### Comercial 1, Comercial 2 e as etapas

**Quem cuida da lead sai da etapa, sempre** — `comercialDaEtapa()` no site e
`comercialDaEtapaCRM()` no servidor. Não grave "responsável" na lead (o
servidor recusa o campo).

| Etapa | Fila |
|---|---|
| Não responde, Conversando, Nurturing, Falta, Em aberto | Comercial 1 — trabalha por cadência, com "Contatei" |
| Agendado, Fazer orçamento | Comercial 2 — sem cadência: prioridade e data do atendimento |
| Venda, Venda reprovada, Recusado | Arquivo |

**Fazer orçamento ≠ Em aberto.** Fazer orçamento = compareceu e o orçamento
*ainda precisa ser preparado*. Em aberto = o orçamento *já existe e foi
apresentado*. A antiga `com_orcamento` vira Em aberto — nunca Fazer orçamento
(também na migração).

**`dtAgendamento` ≠ `dataAgendada`.** `dtAgendamento` é o marco do dia em que
a lead *foi agendada*; `dataAgendada` é o dia em que a pessoa *vem à
clínica*. Nunca deduza uma da outra.

- Toda troca de etapa passa por `aplicarEtapa()` (site) e é conferida por
  `conferirLeadCRM()` (servidor): cadência só onde a etapa tem; marcos até o
  nível da etapa; entrar em Agendado exige a data do atendimento; Falta não
  carimba nada nem apaga `dtAgendamento`/`dataAgendada`; comparecimento
  existente não é reescrito por troca de etapa.
- Depois do dia do atendimento, a ficha oferece só `DESFECHOS_DO_ATENDIMENTO`;
  o seletor mostra `PROXIMAS_ETAPAS`; a lista inteira é "Corrigir etapa".
- A fila do Comercial 2 é `situacaoComercial2()` + `FILA_COMERCIAL2` +
  `compararComercial2()`. `situacao()` é só da cadência.
- Num conflito, a etapa é **uma** pergunta e arrasta `CAMPOS_DA_ETAPA` do lado
  escolhido — `amarrarEtapas()`.

### A Agenda e o CRM

**A Agenda é a fonte operacional dos atendimentos; o CRM guarda só o
atendimento comercial inicial** (`dataAgendada`).

- Cada área tem `agendamento` (o **próximo**) e `proximos`. No schema 2 cada
  data é uma linha de `agenda_agendamentos`, com identidade; o mais cedo é o
  próximo (`arrumarSerie()` no site, `arrumarSerieAgenda()` no servidor).
- A série é uma lista de datas pelo calendário (`D.add`), nunca milissegundos.
- Intervalos: inteiro de **1 a 365** dias; a quinzena é **14**.
- Fim previsto e sessões a remarcar como sempre (`situacaoTratamento()`).
- O histórico só cresce: cada item ganha id no estado vivo
  (`garantirIdsDoHistorico`) e só os novos sobem (`historicoNovos`).
- `maturar()` transforma em sessão pelo relógio e **nunca** confirma presença
  no CRM.
- No servidor, a ponte Agenda → CRM (`ecoDaPacienteNoCRM`) só olha leads
  **em Agendado**, pelo vínculo `crmLeadId` (nunca pelo nome), só mexe na
  `dataAgendada`, e entra na **mesma operação** da paciente.
- CRM → Agenda: `crm.agendarNaAgenda` (exige as duas permissões; parecida
  por nome pede decisão — vínculo só explícito). O CRM grava primeiro e só
  leva a data à Agenda com a gravação confirmada.

### Quem administra

**Administrador é só a conta marcada como `admin` no painel** —
`eAdministrador(auth)`. A senha compartilhada de um módulo nunca administra.
Nas Entradas, quem não administra registra, edita e confere, mas não vê
somas, não exporta e não exclui. A tela decide por `podeAdministrar` (vem de
cada `entradas.ler`); a trava de verdade é do servidor: `entrada.remover` e
`lixeira.mover` de entrada são recusados (`sem_permissao`) e vão para o log
de segurança (`EXCLUSAO_NEGADA`). Nas Entradas não fica entrada nenhuma no
disco do navegador — só a data do último backup, por conta.

## Sessões

[SESSOES](docs/SESSOES.md) tem o diagnóstico e a política. O essencial:
- conta individual é o caminho principal (30 dias sem uso, 180 de teto);
  senha compartilhada é transição (30 min, por aba) e pode ser desligada por
  módulo no painel;
- quem decide é o servidor; **só uma resposta de categoria `autenticacao`
  apaga a sessão, e só se o token ainda for o guardado**;
- sem acesso, ocupado, sem rede, prazo, versão: a sessão fica;
- sessão perdida no meio do trabalho: entrar de novo por cima da tela, sem
  perder o que não foi salvo; nada vai para o disco;
- sem polling; atualização e limpeza de cache não tocam na sessão.

## O selo de atividade

`compartilhado/atividade-rede.js` mostra, no canto inferior esquerdo, quando
há conversa com o Apps Script. É **instrumentado na camada compartilhada**:
`FloreSerRede.chamar` abre e fecha a operação em volta da chamada inteira
(repetições incluídas). O registro técnico fica de fora (tem envio próprio).
- **Atividade não é garantia.** "Alterações salvas" só quando o rodapé do
  módulo (`FloreSerSync.criarStatus`) diz `salvo`.
- **Sucesso se confirma lendo a resposta:** só `ok === true`; o erro v2 vem
  como `{ codigo, categoria }` e o selo lê o código.
- **Falha não some sozinha.**
Nada do que aparece ali tem nome, valor, token ou resposta do servidor.

A **auditoria de negócio** (`sis_auditoria`) responde "quem mudou esta ficha";
o **log técnico** (`sis_logs`) é erro, rede, sessão e segurança. Não misture.
A auditoria entra no mesmo plano da operação que a causou.

## O backend

O código do Apps Script **vive no repositório** (`backend/`) e não tem
segredo: senhas de módulo (em hash PBKDF2), a pimenta das senhas de conta e o
id da planilha moram nas **Script Properties** (`FLORESER_*`, ver
`00_Config.gs`). Nunca escreva um segredo num `.gs` — a conferência de
publicação procura. O Apps Script não tem import nem pasta: todos os `.gs`
dividem um escopo global, e nenhum executa código no carregamento além de
declarar constantes literais e funções.

Toda gravação passa por `executarOperacoes` (03): trava curta, revisão por
entidade, plano repetível no diário, filhos antes da raiz. Leituras não pegam
a trava. Mudança de várias abas sem diário não entra.

Rodar os testes: `node testes/backend.js`, `node testes/migracao.js`,
`node testes/frontend.js`. Servidor local: `node testes/servidor-local.js`
(`http://localhost:4180/floreser/`, backend real no simulador, dados
sintéticos). Nunca use dado real em teste nem no repositório.

No painel de manutenção vale uma exceção à tipografia: valores técnicos, IDs
e linhas de log usam fonte monoespaçada. O resto do site continua só com
Cormorant e Montserrat.

Cada módulo tem a sua senha compartilhada e o seu portão de entrada — os três
com o mesmo desenho: fundo teal profundo, cartão creme de 400 px, marca acima
do nome do módulo, campo com cadeado e olho.

Identidade visual: teal `#3B6E6A`, teal claro `#5A9490`, sage `#C9D3CA`, creme
`#F5F0EB`, taupe `#A39384`, carvão `#2D2D2D`. Títulos em Cormorant Garamond,
texto em Montserrat. **Sem emojis** — use símbolos e ícones em traço fino.
Taupe sobre creme não alcança contraste em textos pequenos; use teal ou carvão.

---

## REGRA PERMANENTE: versionamento e changelog

**Toda alteração neste projeto passa por esta regra, mesmo quando o pedido não
mencionar versão nem changelog.**

### Quatro versões, quatro perguntas

| O quê | Onde | Quando muda |
|---|---|---|
| Versão do produto | topo do `CHANGELOG` no `version.js` (e `VERSAO_PRODUTO` no `backend/00_Config.gs`, se o backend mudou) | toda alteração que a pessoa vê |
| Contrato da API | `VERSAO_API` (backend), `compat.api` (`version.js`), `api` (`config.js`) — os três juntos | mudança incompatível de pedido/resposta |
| Schema dos dados | `VERSAO_SCHEMA` (backend), `compat.schema` + uma migração em `40_Migracoes.gs` | mudança no desenho das abas |
| Casca da PWA | `casca` no `version.js` = versão + carimbo (`ferramentas/preparar-publicacao.js`) | sozinha, com a versão |

`version.js` é a fonte única: a tela lê `rotulo`, o histórico sai de
`changelog`, o Service Worker tira dali o nome do cache. **Nunca escreva um
número de versão à mão em outro arquivo** além dos listados acima.

Para lançar: acrescente **um** registro no topo do array `CHANGELOG`, e rode
`node ferramentas/preparar-publicacao.js` (ou ao menos
`conferir-publicacao.js`, que precisa dizer "Tudo confere").

### Formato

`vX.Y.Z — CODINOME`

| Nível | Incremento | Quando |
|---|---|---|
| PATCH | `X.Y.Z → X.Y.(Z+1)` | correções, ajustes visuais, responsividade, refinos internos, textos |
| MINOR | `X.Y.Z → X.(Y+1).0` | funcionalidades, telas, sistemas e melhorias relevantes |
| MAJOR | `X.Y.Z → (X+1).0.0` | reformulações estruturais, mudanças incompatíveis, nova fase do projeto |

Ao subir MINOR, `Z` volta a `0`. Ao subir MAJOR, `Y` e `Z` voltam a `0`. Três
segmentos, só números, sem pular números.

### Codinome

Uma palavra, em MAIÚSCULAS, sem números e sem espaços. Não repita. Coerente
com a marca — natureza, florescimento, cuidado, luz — ou com a atualização.

**Já usados:** RAIZ, SEIVA, POUSIO, ALVORADA, SERENO, LIMIAR, PRUMO, COLHEITA, VERTENTE, ORVALHO, CREPÚSCULO, BRISA, SENTINELA, ATALHO, CANTEIRO, REBROTA, SOLEIRA, PEITORIL, CUMEEIRA, APRUMO, UMBRAL, VERTEDOURO, PARAPEITO, TRAVESSA, VIGA, AZIMUTE, ORVALHADA, PENUMBRA, SOLSTÍCIO, ENSEADA, REMANSO, CLAREIRA, ALICERCE, CULTIVO, POLINIZAÇÃO, SEBE, COMPASSO, TRILHA, FAROL, COLMEIA.

### Changelog

Mais recente primeiro. Cada registro tem versão, codinome, data real em
`DD/MM/AAAA` e as mudanças por categoria, nesta ordem: Adicionado, Alterado,
Melhorado, Corrigido, Removido, Visual, Conteúdo, Performance, Técnico.
**Não crie categoria vazia.** Descrições do ponto de vista de quem usa.

### Como decidir

Decida sozinho entre PATCH, MINOR e MAJOR. Agrupe a tarefa em **uma única
versão**. Mudança que não muda nada para quem usa (só teste, ferramenta,
documentação) não incrementa.

### Antes de dar a tarefa por encerrada

1. `node ferramentas/conferir-publicacao.js` diz "Tudo confere".
2. Os testes (`testes/*.js`) passam.
3. O codinome não se repete; os números inferiores zeraram quando devido.
4. A data é a de hoje; o changelog vai do mais novo para o mais antigo.
5. Versão e histórico legíveis no desktop e no celular.

---

## Alveare — o aplicativo instalável

**Alveare é o nome do aplicativo; FloreSer é o sistema.** Nunca troque
`FloreSer` por `Alveare` na interface — o nome do aplicativo só aparece no
botão "Instalar Alveare" e no aviso de versão nova.

O site é publicado em `https://clinicacorpoealma.github.io/floreser/`, que
**não é a raiz do domínio**: dentro do manifest e do Service Worker tudo é
relativo (`./`, `registration.scope`, a raiz vem do `config.js`). **A única
exceção** é o `id` do manifest, `/floreser/`, que precisa ser fixo.

### O que entra no cache e o que nunca entra

O Service Worker guarda a **casca** em duas listas: `ESSENCIAIS` (páginas,
`version.js`, todo o `compartilhado/`, portal, painel, o `.css` e o `.js` de
cada módulo, o SheetJS, a marca — instalados com `addAll`: ou entra tudo, ou
a versão nova não instala) e `OPCIONAIS` (fontes e ícones). Guarda também
React, ReactDOM e Babel do cdnjs, por endereço exato.

**Arquivo local novo de que a interface dependa vai para `ESSENCIAIS`** — a
conferência de publicação acusa o que faltar. O nome do cache sai da versão
no `version.js`: não há mais número para subir à mão.

**Nunca** entram no cache: chamadas ao Apps Script, `POST`, endereços de fora
que não sejam aquelas bibliotecas ou as fontes do Google. Dado da clínica
nunca vai para o cache nem para o disco.

Estratégias: **rede primeiro** para as páginas e o `version.js`; **guardado
enquanto atualiza** para o resto. Versão nova: o aviso "Nova versão do
Alveare disponível"; se a página tem alteração pendente, a troca espera o
"salvo" (`FloreSerSync.temPendencias`).

### Testar

Service Worker só em `https://` ou `localhost`. Use
`node testes/servidor-local.js` (o site em `/floreser/`, como no GitHub
Pages). Em Ferramentas do desenvolvedor → Application: o Manifest diz Alveare,
o Service Worker aparece ativo com escopo em `/floreser/`, e o Cache Storage
tem `alveare-casca-<versão>` sem nenhuma resposta do Apps Script. O painel →
Sistema tem "Limpar cache do aplicativo" (não mexe em sessão, tema nem foto) e
mostra versão, API e schema do servidor.

---

## Ao publicar

[PUBLICACAO](docs/PUBLICACAO.md) tem o passo a passo, inclusive a migração da
4.0.0, backup e retorno. Em toda publicação: **o Apps Script antes do site, ou
junto** (Nova versão na mesma implantação); `version.js` sempre junto com o
`index.html`; e a conferência dizendo "Tudo confere".
