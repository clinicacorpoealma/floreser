# Esquema de dados (schema 6)

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
| `ent_entradas` (raiz) | id | a entrada; `legado`; desde o schema 3, `origem` (vazio, `importacao`, `clinicorp`) e `loteId` |
| `ent_pagamentos` | id | cada forma de pagamento, com `ordem` e valor em dinheiro exato |
| `sis_usuarios` | id | contas; `esquema` `v1`/`pbkdf2`, `salt`, `iteracoes`, `credencialVersao`; `legado` guarda o verificador da 3.5.0 até `migracaoFinalizar()`; desde o schema 3, `financeiro` (permissão própria) |
| `sis_fotos` | usuarioId | foto (coluna pesada, fora da aba de contas) |
| `sis_sessoes` | tokenHash | sessões de conta e de senha de módulo (o token nunca é guardado) |
| `sis_operacoes` | operacaoId | idempotência e diário (plano, estado, resultado) |
| `sis_auditoria` | id | auditoria de negócio (só cresce) |
| `sis_lixeira` | id | registro excluído com os filhos, em JSON `versao: 2` |
| `sis_logs`, `sis_visitas` | id | log técnico e visitas (podados) |
| `sis_config` (raiz) | chave | `crm.cadencias`, `agenda.config` |
| `sis_migracoes` | id | etapas das migrações (`v1-para-v2:*`, `v2-para-v3:*`), com relatório |
| `sis_importacoes` | id | um lote de planilha importada: arquivo, aba, mapeamento, contagens, linhas recusadas |

### Financeiro (schema 3)

| Tabela | Chave | Conteúdo |
|---|---|---|
| `fin_categorias` (raiz) | id | categoria e subcategoria (`paiId`), ativa, ordem. Sem nenhuma gravada, a lista padrão aparece como sugestão |
| `fin_fornecedores` (raiz) | id | fornecedor |
| `fin_despesas` (raiz) | id | a obrigação: valor, `competencia` (AAAA-MM), vencimento, categoria, fornecedor, meio, conta, área, notas, cancelada; `grupoId`/`grupoTipo`/`sequencia` para parcela ou recorrência; `origem` (manual, recorrencia, importacao) e `loteId` |
| `fin_movimentos` | id | pagamento ou estorno (`estornaId`) de uma despesa — só cresce; muda a revisão da despesa |
| `fin_grupos` (raiz) | id | parcelamento (valor total, quantidade) ou recorrência (frequência, início, fim/quantidade, modelo, gerado até, encerrado) |
| `fin_orcamentos` (raiz) | id = `<categoria>@<mês>` | valor e alerta (%) |
| `fin_saldos` (raiz) | id | saldo inicial confiável: conta, data, valor |
| `fin_insumos` (raiz) | id | material: embalagem, conteúdo e unidade, valor, rendimento, perda |
| `fin_fichas` (raiz) | id | ficha de custo (`dados` em JSON), preço atual, versão aprovada |
| `fin_fichas_versoes` | id = `<ficha>@v<n>` | retrato imutável de uma versão aprovada |

### Integrações (schema 3)

| Tabela | Chave | Conteúdo |
|---|---|---|
| `int_vinculos` (raiz) | id = `clinicorp:<tipo>:<externo>:<tipoLocal>` | vínculo explícito: sistema, assinante, unidade, tipo, id externo, tipo e id local, estado, assinatura do último estado |
| `int_externos` (raiz) | id = `clinicorp:<tipo>:<externo>` | registro vindo do Clinicorp: `dados` normalizados (campos de lá preservados), assinatura, última alteração de lá, visto em, `ausenteDesde`, `complemento` local |
| `int_execucoes` | id | uma sincronização: recurso, modo (prévia/importação), estado, origem (manual/agendada), autor, período, `cursor` (retomada), contagens, erros |
| `int_pendencias` (raiz) | id (de uma chave única) | revisão: proposta de etapa, conciliação, divergência, vínculo pendente, resultado desconhecido |
| `int_passos` | id | escrita no Clinicorp: tipo, estado (enviando, confirmado, recusado, desconhecido...), tentativas, pedido sem CPF, resposta |

Relações (conferidas pela migração e por `conferirIntegridade()`): filhos da
paciente → `agenda_pacientes` (forte); pagamentos → `ent_entradas` (forte);
respostas → vindas (forte); contato → lead, `crmLeadId` → lead, categoria e
máquina → cadastros (fracas: podem apontar para algo na lixeira).
Desde o schema 3: movimentos → `fin_despesas` e versões → `fin_fichas`
(fortes); despesa → categoria, fornecedor e grupo (fracas).

### Estoque e automação (schema 4)

| Tabela / coluna | Conteúdo |
|---|---|
| `est_itens` (raiz) | item: nome, código, categoria, unidade de compra e de consumo, fator, mínimo, custo unitário e sua fonte, **origem** (`importacao`, `local`, `clinicorp`), local, notas |
| `est_saldos` (grande) | retrato: item, local, quantidade (texto, até 3 casas), lote, validade, custo, fonte, lote de importação, observado em |
| `est_movimentos` (grande) | só itens `local`: entrada/saída com quantidade, data, motivo, autor |
| `int_externos.aplicado` / `aplicadoEm` / `aplicacao` | fila de aplicação: a assinatura já aplicada, quando, e o resultado (tentativas, erro, estado) |
| `ent_entradas.externoEstado` | `estornado` quando o recebimento foi desfeito no Clinicorp |
| `fin_insumos.itemEstoqueId` / `custoFonte` | material ligado a um item do estoque |
| `fin_fichas.revisar` | aviso de que um custo usado mudou depois da aprovação |

Identidade dos registros externos: `clinicorp:<assinante>:<tipo>:<id>`.

### Vendas e execução (schema 5)

| Aba | Chave | Campos |
|---|---|---|
| `est_vendas` (raiz) | id | data, pacienteNome, pacienteRef, origem (manual/importacao), externoId, estado (ativa/cancelada), entregueEm, entradaId, descontoGeral, taxas, notas, loteId, criadoEm |
| `est_venda_itens` | id | vendaId (forte), itemId (fraca), quantidade, unidade, precoUnitario, desconto, custoUnitario, custoFonte, fichaId, devolvido, devolvidoRetorno |
| `exe_orcamentos` (raiz) | id | pacienteRef, pacienteNome, data, situacao, descontoGeral, notas, criadoEm |
| `exe_orcamento_itens` | id | orcamentoId (forte), procedimento, procedimentoRef, fichaId, quantidade, valorUnitario, desconto, ordem |
| `exe_execucoes` (raiz) | id | agendamentoTipo, agendamentoId, agendamentoData, pacienteRef, pacienteNome, procedimento, procedimentoRef, fichaId, quantidade, estado, orcamentoRef, itemRef, associacao, custoUnitario, custoFonte, valorUnitario, origem, loteId, criadoEm, autorNome, notas |

Colunas novas no fim (`COLUNAS_DESDE`, 5): `est_itens` modoSaldo, corteEm,
fichaId; `est_movimentos` origemTipo, origemId, custoUnitario, estornaId.
`pacienteRef` é `loc:<id da Agenda>` ou `clc:<id do Clinicorp>` (o vínculo
de paciente junta os dois). Quantidades em texto decimal, dinheiro em
centavos, como no resto.

### Planos (schema 6)

| Aba | Chave | Campos |
|---|---|---|
| `exe_conferencias` (raiz) | id (`classe:item:<ref>`, `classe:ref:<id do procedimento>`, `qtd:<plano>\|<procedimento>`) | tipo (classe/quantidade), alvo, valor, motivo, autorNome, criadoEm |
| `exe_trocas` (raiz) | id | pacienteRef, orcamentoRef, linhaChave, procedimentoOrigem, quantidadeOrigem, procedimentoSubstituto, procedimentoSubstitutoRef, fichaSubstitutoId, quantidadePrometida, precoOrigem, precoSubstituto, basePreco, diferencaCobrada, custoOrigem, custoSubstituto, baseCusto, data, agendamentoRef, estado (ativa/desfeita), motivo, observacaoOrigem, autorNome, criadoEm |
| `exe_creditos` (raiz) | id | pacienteRef, trocaId, valor, destinoRef, destinoDescricao, data, estado (ativo/estornado), motivo, autorNome, criadoEm |
| `exe_atendimentos` (raiz) | id (= referência do agendamento) | agendamentoTipo, agendamentoId, pacienteRef, previstos (json), observacao, marcador, profissional, interpretacao, observacaoInterpretada, observacaoLiberada, notas, origem (manual/importacao), loteId, autorNome, criadoEm |

Colunas novas no fim (`COLUNAS_DESDE`, 6): `exe_orcamento_itens.classe`;
`exe_execucoes` natureza, trocaId, valorReferencia, baseReferencia,
baseCusto. A geração de crédito não tem linha própria: sai da troca.

## Do schema 5 para o schema 6 (`backend/45_MigracaoV6.gs`)

Cria as quatro abas e as colunas; itens dos orçamentos do Alveare ganham
classe "tratamento"; execuções ganham a natureza que já tinham (com item →
`contratado`; sem item → vazio, "a decidir"). Confere linhas, dinheiro e o
realizado de cada item antes e depois. Retorno: `migracaoV6Retornar()`.

## Do schema 4 para o schema 5 (`backend/44_MigracaoV5.gs`)

Cria as cinco abas e as colunas; `modoSaldo` = `livro` para item local
(corte = última contagem existente) e `retrato` para importado; movimentos
antigos ganham `origemTipo: manual`; orçamentos do Clinicorp voltam à fila
(assinatura `reler:`) para serem relidos completos. Confere contagem de
linhas, somas de dinheiro e **o saldo de cada item** antes e depois. Retorno:
`migracaoV5Retornar()` (abas novas ficam).

## Do schema 3 para o schema 4 (`backend/43_MigracaoV4.gs`)

Cria as abas do estoque, acrescenta as colunas acima no fim, reescreve as
chaves de `int_externos`/`int_vinculos` com o assinante (mesmas linhas) e faz
a **reconciliação inicial**: o que já existe conta como aplicado;
recebimentos sem vínculo ficam como consulta (`aplicacao.estado.anterior`);
orçamentos guardam o status atual. Conferência: contagens e somas de dinheiro
iguais, sem chave repetida. Retorno: as chaves voltam ao formato da 4.1.0.

## Do schema 2 para o schema 3 (`backend/42_MigracaoV3.gs`)

Incremental: cria as abas novas e acrescenta `ent_entradas.origem`,
`ent_entradas.loteId` e `sis_usuarios.financeiro` **no fim** das abas. Nada
do schema 2 é reescrito; a conferência compara contagem e assinatura de cada
aba do schema 2 e a soma dos pagamentos, antes e depois. Antes da ativação,
as colunas novas podem faltar (`COLUNAS_DESDE`): são lidas como vazias e não
são escritas. Sessões e contas continuam onde estão.

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
