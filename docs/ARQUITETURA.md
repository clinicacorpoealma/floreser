# Arquitetura do Alveare / FloreSer (4.0.0)

Site estático no GitHub Pages + Google Apps Script + Google Sheets. Sem npm,
sem bundler, sem servidor pago. O volume (centenas de fichas, poucas pessoas
ao mesmo tempo) não justifica outra plataforma; a organização abaixo deixa
trocar o armazenamento um dia sem reescrever regras nem telas.

## Camadas

| Camada | Onde | Responsabilidade |
|---|---|---|
| Frontend compartilhado | `compartilhado/` | configuração (`config.js`), transporte (`rede.js`), sessão (`sessao.js`), motor de dados (`dados.js`), telas da conta (`auth.js`), conciliação (`sync.js`), auditoria, busca, tema, PWA, registro técnico, selo de atividade |
| Módulos | `index.html` + `portal/`, `crm/`, `agenda/`, `entradas/`, `admin/` | telas e regras de cada módulo; nenhum fala com o servidor sem passar pelo compartilhado |
| Backend — infraestrutura | `backend/00`–`10` | contrato e roteamento, tabelas, trava e diário, sessões, autorização, esquema |
| Backend — negócio | `backend/20`–`29` | regras puras e serviços de CRM, Agenda, Entradas, usuários, auditoria, lixeira, busca, diagnóstico |
| Migração e manutenção | `backend/40`, `backend/41` | schema 1 → 2, diagnóstico, backup, retorno, recuperação, integridade |
| Testes e ferramentas | `testes/`, `ferramentas/` | simulador do Apps Script, testes, servidor local, conferência de publicação, ensaio e medição |

As dependências descem: módulo → compartilhado → rede → servidor; no servidor,
serviço → regras → concorrência → tabelas → Sheets. Nenhuma regra de negócio
conhece linha ou coluna; nenhuma tela conhece o endereço do Apps Script.

## Uma gravação, do clique à planilha

1. A tela muda o estado em memória (como sempre) e chama `salvar()`.
2. O motor (`dados.js`) compara a última versão confirmada (a **base**) com a
   tela e gera **operações por entidade** — `lead.alterar` só com os campos
   que mudaram, `paciente.alterar` com as áreas, condições, máquinas e só o
   histórico novo, `entrada.alterar` com os pagamentos se mudaram. Cada uma
   leva a revisão de que partiu e um `operacaoId` estável.
3. `rede.js` manda o lote (`crm.aplicar`, `agenda.aplicar`, `entradas.aplicar`).
4. O servidor valida a sessão (sem trava), pega a trava, **refaz** qualquer
   operação interrompida, relê só o necessário, confere a revisão de cada
   entidade, calcula o **plano** (escritas repetíveis + auditoria), grava o
   plano no diário (`sis_operacoes`, estado `aplicando`), aplica as escritas
   (filhos primeiro, raiz por último), marca `aplicada` e solta a trava.
5. Cada operação volta com o próprio resultado: `ok` (revisão nova), `conflito`
   (com o estado atual daquela ficha) ou recusa. A base avança só para o
   retrato enviado — o que foi editado durante o envio continua pendente.
6. Conflito: o motor monta o **servidor sintético** (a base com as fichas em
   disputa como estão no servidor) e o módulo concilia com o `FloreSerSync` de
   sempre. Só aquelas fichas podem virar pergunta.

## Concorrência e recuperação

| Mecanismo | Problema que resolve |
|---|---|
| Trava do script (só na região crítica) | duas execuções escrevendo ao mesmo tempo |
| Revisão por entidade (`rev`) | gravar por cima de uma ficha que mudou; fichas diferentes não conflitam |
| `operacaoId` + `sis_operacoes` | a mesma intenção chegando duas vezes (resposta perdida); prova durável, cache só acelera |
| Diário (plano redo) | operação de várias abas interrompida no meio; a próxima execução termina antes de fazer qualquer outra coisa |
| Escrita filhos→raiz | leitura no meio vê a revisão antiga e a próxima gravação concilia |

Não é transação atômica: entre uma queda e a recuperação, uma leitura pode ver
a operação pela metade. Nenhuma gravação nova acontece antes da recuperação,
e uma leitura que encontra recuperação pendente espera a trava antes.

## Medição antes/depois

`node ferramentas/medir-antes-depois.js` — mesmas operações no backend 3.5.0 e
no 4.0.0, sobre os mesmos dados sintéticos (110 pacientes com 10 históricos,
50 leads, 130 entradas, 2.000 auditorias), no simulador:

| Operação | chamadas ao Sheets | chamadas com a trava | células escritas | células com a trava | bytes da resposta |
|---|---|---|---|---|---|
| Entrar com a conta | 4 → 6 | 4 → 5 | 15 → 40 | 29 → 71 | 309 → 476 |
| Retomar a sessão | 2 → 4 | 2 → **0** | 0 → 0 | 20 → 0 | 234 → 422 |
| Abrir a Agenda | 6 → 6 | 6 → **0** | 0 → 0 | 10.035 → 0 | 123.291 → 152.022 |
| Salvar uma paciente | 15 → 11 | 15 → 11 | **20.044 → 54** | 30.079 → 12.080 | 19 → 1.723 |
| Abrir o CRM | 5 → 4 | 5 → **0** | 0 → 0 | 890 → 0 | 17.239 → 17.919 |
| Salvar uma lead | 10 → 6 | 10 → 6 | **1.738 → 61** | 2.628 → 1.162 | 19 → 685 |
| Abrir as Entradas | 4 → 4 | 4 → **0** | 0 → 0 | 1.320 → 0 | 23.635 → 25.022 |
| Salvar uma entrada | 9 → 7 | 9 → 7 | **2.614 → 50** | 3.934 → 2.262 | 19 → 525 |
| Busca global | 11 → 6 | 11 → **0** | 0 → 0 | 12.205 → 0 | 1.280 → 1.516 |

Leituras deixaram de esperar gravações; gravações escrevem só as linhas
afetadas. A primeira abertura da Agenda depois de 30 min lê também os
cabeçalhos (18 chamadas); depois eles vêm do cache. As respostas cresceram
um pouco (ids do histórico, revisões, resultado por operação). O simulador
conta chamadas e células, não o tempo real do Google — confira no Apps
Script com `ligarDiagnostico()` (campo `diag` em cada resposta).

Melhoria possível, não feita: o planejamento de `paciente.alterar` ainda lê
as abas filhas inteiras dentro da trava (12 mil células no exemplo); ler só
as linhas daquela paciente (TextFinder) encurtaria a região crítica.

## Documentos

[API.md](API.md) · [ESQUEMA.md](ESQUEMA.md) · [SESSOES.md](SESSOES.md) ·
[PUBLICACAO.md](PUBLICACAO.md)
