# Esquema de dados (schema 2)

A fonte é `backend/10_Esquema.gs`. Cada tabela é uma aba com o mesmo nome; a
linha 1 é o cabeçalho, e **o cabeçalho manda** — a posição de cada campo sai
do nome. Coluna obrigatória ausente responde `instalacao_incompleta`; coluna
desconhecida é preservada e regravada como estava. Tudo é gravado como texto
(`'@'`), para o Sheets não converter "01/05/2026" em data nem "007" em 7.

## Tipos e conversões (`backend/02_Tabelas.gs`)

| Tipo | Na planilha | Na lógica | Ausente / vazio |
|---|---|---|---|
| texto | texto | string | `""` |
| data | `AAAA-MM-DD` (dia de calendário, sem fuso) | string validada | célula vazia = `null` |
| instante | ISO 8601 UTC (`...Z`) | string ISO | `null` |
| inteiro / epoch | dígitos | número | `null` (≠ 0) |
| dinheiro | `"1234.50"` (duas casas) | **centavos inteiros**, convertidos por texto, nunca por ponto flutuante | `null` (≠ 0) |
| booleano | `sim` / `não` | `true` / `false` | `null` (≠ falso) |
| json | texto JSON (≤ 45.000 caracteres) | objeto | `null` |

Datas da clínica (atendimento, último contato, criação de lead) são dias de
calendário. Instantes (auditoria, sessões, logs, operações) são UTC. Horas
gravadas sem fuso pela 3.5.0 são lidas como hora local de `FLORESER_FUSO`
(padrão `America/Cuiaba`), calculando o deslocamento do próprio fuso — sem
supor -04:00.

## Tabelas

Entidades **raiz** levam `rev` (revisão), `opId` (operação que a produziu),
`atualizadoEm`, `atualizadoPor`. Filhos pertencem ao agregado e mudam com a
revisão dele.

| Tabela | Chave | Conteúdo |
|---|---|---|
| `crm_leads` (raiz) | id | a lead; `legado` guarda valores fora do tipo vindos da 3.5.0 |
| `crm_contatos` | id | um evento por "Contatei" (só cresce; autor pela sessão) |
| `agenda_pacientes` (raiz) | id | a paciente; `crmLeadId` só por vínculo explícito; `legado` |
| `agenda_ciclos` | pacienteId + area | intervalo, último, adiada, não respondeu, fim previsto, a remarcar |
| `agenda_agendamentos` | id (único por paciente+área+data) | cada atendimento marcado, com identidade; o mais cedo é o "próximo" |
| `agenda_condicoes` | id | condição com período |
| `agenda_pac_maquinas` | pacienteId + maquinaId | máquinas da paciente |
| `agenda_historico` | id | o histórico do tratamento (só cresce) |
| `agenda_followups` (raiz) | id | follow-ups |
| `agenda_categorias`, `agenda_maquinas`, `agenda_vindas` (raiz) | id | cadastros da Agenda |
| `agenda_respostas` | vindaId + pacienteId | respostas de uma vinda de máquina |
| `ent_entradas` (raiz) | id | a entrada; `legado` |
| `ent_pagamentos` | id | cada forma de pagamento, com `ordem` e valor em dinheiro exato |
| `sis_usuarios` | id | contas; `esquema` `v1`/`pbkdf2`, `salt`, `iteracoes`, `credencialVersao`; `legado` guarda o verificador da 3.5.0 até `migracaoFinalizar()` |
| `sis_fotos` | usuarioId | foto (coluna pesada, fora da aba de contas) |
| `sis_sessoes` | tokenHash | sessões de conta e de senha de módulo (o token nunca é guardado) |
| `sis_operacoes` | operacaoId | idempotência e diário (plano, estado, resultado) |
| `sis_auditoria` | id | auditoria de negócio (só cresce) |
| `sis_lixeira` | id | registro excluído com os filhos, em JSON `versao: 2` |
| `sis_logs`, `sis_visitas` | id | log técnico e visitas (podados) |
| `sis_config` (raiz) | chave | `crm.cadencias`, `agenda.config` |
| `sis_migracoes` | id | etapas da migração, com assinatura e relatório |

Relações (conferidas pela migração e por `conferirIntegridade()`): filhos da
paciente → `agenda_pacientes` (forte); pagamentos → `ent_entradas` (forte);
respostas → vindas (forte); contato → lead, `crmLeadId` → lead, categoria e
máquina → cadastros (fracas: podem apontar para algo na lixeira).

## Da 3.5.0 para o schema 2 (`backend/40_Migracoes.gs`)

| Antes | Depois |
|---|---|
| `Leads`, `Cadencias` | `crm_leads`, `sis_config.crm.cadencias`; etapas antigas (`com_orcamento` → Em aberto, nunca Fazer orçamento) |
| `Leads_Contatos` | `crm_contatos` (instante com fuso convertido para UTC) |
| `Pacientes` | `agenda_pacientes` — lida **por posição**, como a 3.5.0: na planilha real as colunas 6–10 estão sem nome no cabeçalho, mas têm os dados; a 11ª coluna (resíduo de gravação antiga, sem nome) vai para `legado.colunasExtras`, sem interpretação |
| `Pacientes_Ciclos` (`agendamentoData`, `agendamentoFollowUp`, `proximos` "d1, d2") | `agenda_ciclos` + uma linha por data em `agenda_agendamentos` |
| `Pacientes_Historico` (sem id) | `agenda_historico` com id derivado (determinístico) |
| `Entradas_Pagamentos` (sem id) | `ent_pagamentos` com id derivado e `ordem`; soma reconciliada centavo a centavo |
| `Usuarios`, `Usuarios_Sessoes`, `Usuarios_Fotos` | `sis_usuarios` (esquema `v1`), `sis_sessoes` (só as vivas; o token antigo continua valendo), `sis_fotos` |
| `Auditoria` (células convertidas pelo Sheets) | `sis_auditoria`: data convertida volta ao texto gravado (`dd/MM/aaaa`), instante volta à hora local → UTC |
| `Lixeira` (JSON da 3.5.0) | `sis_lixeira` com o conteúdo convertido para o schema 2 |
| `Logs`, `Sessoes` | `sis_logs`, `sis_visitas` |
| Script Properties `agenda_criado`, `agenda_seedmaq` | `sis_config.agenda.config` |

Nada é inventado: valor fora do tipo vira anomalia no relatório e fica em
`legado`; órfão em relação forte ou chave repetida bloqueia a migração.
