# Integração com o Clinicorp (4.1.0)

A integração é **central**: mora no backend (`backend/35`–`38`) e é
administrada no painel → **Integrações**. CRM, Agenda e Entradas só mostram
contexto (origem, vínculo, estado de sincronização), lido da planilha — o
Clinicorp nunca é chamado para desenhar uma tela.

> **Validação.** Tudo o que está aqui foi construído a partir da
> especificação publicada e testado contra um Clinicorp **simulado**
> (`testes/integracao.js`, `testes/util/clinicorp-falso.js`). Nada foi
> chamado na conta real durante o desenvolvimento, e nenhuma escrita
> (paciente, lead, agendamento) foi feita para testar. A seção
> "Validação com a conta real" diz o que conferir no primeiro uso.

## 1. O contrato verificado

Fonte: a especificação OpenAPI 3.0.1 servida em
<https://api.clinicorp.com/api-docs/> (lida em 20/11/2026), 49 endereços.

- Base: `https://api.clinicorp.com/rest/v1`.
- Autenticação: **HTTP Basic** — usuário = "Usuário API", senha = "Token
  API" (Gerenciar Assinatura → Acesso Externo e Integrações → Integrações).
  O esquema se chama `bearerAuth` na especificação, mas é declarado com
  `scheme: basic`; seguimos o declarado.
- `subscriber_id` (assinante) é obrigatório na maioria das consultas; em
  conta única o token já identifica o assinante.
- Webhooks: **nenhum documentado**. Não há recebimento de eventos.
- Erros documentados: `{ Error, Message }`; 400 = parâmetro faltando,
  401 = não autorizado.

## 2. Matriz de capacidades

"Efeito" é se a operação **muda** algo no Clinicorp — não sai do verbo HTTP.
A mesma tabela está em `backend/35_ClinicorpContrato.gs`
(`CLINICORP_OPERACOES`) e no painel → Integrações → Matriz, com a coluna de
verificação desta conta.

| Operação pretendida | Endpoint e parâmetros verificados | Efeito · direção | Granularidade | Limitações e pendências | Estado |
|---|---|---|---|---|---|
| Descobrir o assinante | `GET /group/list_subscribers` e `/group/list_subscribers_clinics` — sem parâmetros | leitura · consulta | Namespace e SubscriberBussinessUID | não diz qual campo é o `subscriber_id`; o teste completo confirma | implementada |
| Testar conexão / listar clínicas | `GET /business/list` — `subscriber_id*` | leitura · consulta | uma linha por clínica | — | implementada |
| Profissionais | `GET /professional/list_all_professionals` — `fromOnlineScheduling` | leitura · consulta | id e nome (o CPF que vem é descartado) | sem unidade do profissional | implementada |
| Buscar **um** paciente | `GET /patient/get` — `subscriber_id*`, `PatientId`, `OtherDocumentId` (CPF), `Phone`, `Email`, `Name` | leitura · consulta | um paciente | **não existe listagem de pacientes**; nome pode achar homônimo — nunca usado para vincular | implementada |
| Criar paciente | `POST /patient/create` — `Name`, `MobilePhone`, `Email`, `BirthDate`, `OtherDocumentId`, `Notes`, `IgnoreSameName` | **muda** · envio | um paciente | a resposta documentada **não traz o id**: o vínculo é confirmado por `/patient/get` (telefone/e-mail); CPF repetido é recusado; sem idempotência documentada | implementada, desligada por padrão |
| Agenda do período | `GET /appointment/list` — `from*`, `to*`, `subscriber_id`, `businessId`, `patientId`, `includeCanceled=X`, `includeDeleted=X`, `includeAssigns=X` | leitura · consulta | um item por agendamento: data (UTC), `fromTime`/`toTime`, profissional, clínica, status, última alteração | resposta documentada **sem id do paciente e sem procedimento**: a paciente só é atribuída pela consulta filtrada por `patientId` de uma paciente já vinculada | implementada |
| Status de agendamento | `GET /appointment/status_list` — `subscriber_id*` | leitura · consulta | id, descrição, `Type` (chave estável) | — | implementada |
| Agendamentos de um paciente | `GET /patient/list_appointments` — `PatientId*` | leitura · consulta | id, data, horários | redundante com `/appointment/list?patientId` | não usada |
| Criar agendamento | `POST /appointment/create_appointment_by_api` | **muda** · envio | agendamento definitivo | sem ambiente de teste; criar agendamento real só para testar é proibido | **não implementada** |
| Mudar status | `GET /appointment/change_status` — `id*`, `status_id*` | **muda** · envio | um ou vários agendamentos | é GET e muda dados | **não implementada** |
| Confirmar / cancelar | `POST /appointment/confirm_appointment`, `/cancel_appointment` | **muda** · envio | um agendamento | — | **não implementadas** |
| Solicitar agendamento online | `POST /appointment/create_online_scheduling` | **muda** · envio | uma **solicitação** | solicitação ≠ agendamento | **não implementada** |
| Orçamentos do período | `GET /estimates/list` — `subscriber_id*`, `from*`, `to*` (≤ 31 dias), `status`, `clinic_id` | leitura · consulta | um orçamento por tratamento: status, profissional, valor, desconto, procedimentos | o período filtra pela data do **desfecho** de cada status; só o desfecho atual; pode vir do cache (`Cached: true`); identidade estável = `TreatmentId` | implementada |
| Um orçamento | `GET /estimates/get` — `subscriber_id*`, `treatment_id*` | leitura · consulta | um orçamento | — | implementada |
| Recebimentos | `GET /payment/list` — `subscriber_id*`, `from*`, `to*`, `get_amount_with_discounts=X`, `date_type` (vazio = recebimento; `postDate`; `checkoutDate`) | leitura · consulta | uma parcela: valor, valor sem taxas (opcional), vencimento, recebido/confirmado e datas, forma, parcela, paciente, tratamento, checkout | **sem data de liquidação**; a especificação descreve o campo `id` como "id da especialidade" — unicidade por parcela a confirmar na conta real | implementada |
| Recibos | `GET /financial/list_receipt` | leitura | recibos | recibo é documento, não recebimento | não usada |
| Resumo financeiro | `GET /financial/list_summary` — `subscriber_id*`, `from*`, `to*`, `business_id` | leitura · consulta | totais do período | agregado: só conferência, nunca somado nem quebrado | implementada |
| Fluxo de caixa | `GET /financial/list_cash_flow` | leitura | agregado por forma | — | não usada |
| Campanhas do CRM | `GET /crm/list_active_campaigns` — `subscriber_id*` | leitura · consulta | nome, status, descrição | a descrição na especificação está trocada ("Lista todos os usuários") | implementada |
| Enviar lead para campanha | `POST /crm/add_leads` — `Name`, `Email`, `Phone`, `BoardName`, `Notes` | **muda** · envio | um lead | sem id na resposta e sem consulta de leads: envio perdido não é verificável pela API | implementada, desligada por padrão |
| Catálogo de procedimentos | `GET /procedures/list` | leitura · consulta | nome, especialidade, tabela | **sem preço**; o Alveare nunca altera preço no Clinicorp | implementada |

Fora do escopo (documentados, sem uso): analytics, vendas por especialidade,
metas, faturamento por plano de saúde, notas fiscais, aniversariantes,
cadeiras, usuários, horários disponíveis, migração, upload de arquivo e
ordens de compra.

## 3. Configuração

1. **Credenciais** — só no editor do Apps Script: Configurações do projeto →
   Propriedades do script:
   - `FLORESER_CLINICORP_USUARIO` = o Usuário API;
   - `FLORESER_CLINICORP_TOKEN` = o Token API.

   Nunca a senha de login de uma pessoa. O painel só mostra "definidas" ou
   "faltando"; nenhuma resposta, log, exportação ou backup leva os valores
   (`migracaoBackup` lista o nome com "(segredo — não copiado)").
2. **Autorização do Google** — a primeira vez, rode qualquer função no
   editor (por exemplo `conferirInstalacao`) e autorize: o script passa a
   pedir "conectar a serviço externo" (UrlFetchApp) e, se usar o
   agendamento, "gerenciar gatilhos".
3. **Painel → Integrações → Conexão**: não sabe o assinante? Deixe vazio e clique em **Testar conexão** — o Alveare pergunta ao Clinicorp e mostra os identificadores da conta para você escolher. Depois: assinante (`subscriber_id`) e unidade
   (id numérico da clínica; a lista aparece depois do teste) → **Testar
   conexão**. O teste chama cada leitura uma vez, com a menor janela, e diz
   quantas responderam. Escrita nunca é chamada para testar.
4. **Recursos**: ligue um por um. Só aparecem os modos implementados:
   desligado · só consulta · consulta e importação · consulta e envio.
5. **Sincronizar**: prévia → importar (a primeira importação de cada recurso
   exige a prévia concluída do mesmo período).
6. **Agendamento** (opcional): 1, 2, 4, 6, 12 ou 24 h.

A configuração não secreta fica em `FLORESER_CLINICORP_CONFIG` (JSON):
assinante, unidade, modos, regras de orçamento, janela de reconsulta,
frequência, suspensão e o resultado do último teste.

## 4. Propriedade dos dados e mapeamentos

| Dado | Dono | No Alveare |
|---|---|---|
| Cadência, contatos, funil (Comercial 1/2) | Alveare (CRM) | `crm_leads`, `crm_contatos` |
| Orçamentos | Clinicorp | `int_externos` tipo `orcamento`; contexto na ficha da lead vinculada |
| Agendamentos | Clinicorp | `int_externos` tipo `agendamento` (campos de lá preservados: id, dia, hora, profissional, unidade, status, última alteração; `precisao` hora/dia); contexto na ficha da paciente vinculada. A Agenda do Alveare continua a fonte operacional |
| Recebimentos | Clinicorp | `int_externos` tipo `recebimento`; conciliáveis com `ent_entradas` |
| Despesas, composições de custo | Alveare (Financeiro) | `fin_*` |
| Nota/categoria local de um registro externo | Alveare | `int_externos.complemento` — nunca apagado por uma atualização |

**Vínculos** (`int_vinculos`): sistema, assinante, unidade, tipo, id externo,
tipo e id local, estado, assinatura do último estado sincronizado. Sempre
explícitos, feitos por uma pessoa: o Alveare **nunca vincula por nome**. Um
registro externo tem no máximo um vínculo ativo por tipo de ficha; uma
ficha, no máximo um registro de cada tipo.

**Orçamento → CRM**: mapeamento explícito evento → ação, por status
(`APPROVED` → Venda, `REJECTED` → Venda reprovada, `OPEN` → Em aberto), com
regra "só contexto" (padrão) ou "propor". "Propor" abre uma pendência; uma
pessoa aplica, e aplicar passa por `conferirLeadCRM` — a lead precisa estar
numa etapa de origem permitida, e os marcos saem das regras do CRM.

Nunca: orçamento → recebimento; confirmação → comparecimento;
comparecimento → venda; sessão vencida → pagamento. Atualização de
agendamento no Clinicorp não altera CRM nem Agenda.

**Recebimento → Entradas**: três caminhos, todos explícitos — só consultar
(padrão), vincular a uma entrada existente, ou importar como entrada nova
(`origem: clinicorp`, valor **bruto** da parcela — a taxa da maquininha não
é descontada de novo; data = recebimento/confirmação; forma pelo nome ou
escolhida). Recebimento ainda não recebido não vira entrada. Parecido com
entradas do mesmo dia e valor → pendência de conciliação, nunca vínculo
automático. Recebimento vinculado que muda no Clinicorp → pendência de
divergência; a entrada do Alveare não muda.

## 5. Sincronização

- **Janelas** de até 31 dias; cada janela gravada é um ponto de retomada
  (`int_execucoes.cursor`). Um pedido do painel trabalha ~22 s e volta; o
  painel continua sozinho, janela por janela. O gatilho agendado trabalha
  até 4 min.
- **Exclusão mútua por recurso**: `FLORESER_INT_TRAVA_<RECURSO>`, com prazo
  de 7 min (uma execução que morreu não prende ninguém).
- **Incremental**: da última data importada menos a janela de reconsulta
  (padrão 7 dias) até hoje (+60 dias para agendamentos).
- **Por registro**: novo, alterado (assinatura diferente), igual, ausente.
  **Ausência numa resposta filtrada não é exclusão**: o registro fica, com
  `ausenteDesde`. Para orçamentos nem isso — o dia do filtro muda com o
  status.
- **Gravação**: cada pedaço (≤ 80 KB) é uma operação no diário, com
  `operacaoId` derivado do conteúdo — repetir o mesmo pedaço é reconhecido.
- **Fora da trava**: nenhuma chamada ao Clinicorp com a trava do script
  (conferido no código e nos testes). Leituras repetem em falha de rede/5xx
  (1 s, 3 s); 429 interrompe e guarda o ponto.
- **Ciclos**: importar nunca dispara envio; pendência tem chave única (uma
  resolvida não reabre); o mesmo dado de novo não gera nada; envio de lead
  para a mesma campanha não se repete sem "reenviar".
- **Identidade da rotina agendada**: "Sincronização agendada (Clinicorp)"
  (`sistema:clinicorp`), escopo = recursos em modo importação, só abas de
  integração. Nunca cria entrada, lead ou agendamento.

## 6. Escrita no Clinicorp e recuperação

Criar paciente e enviar lead são pedidos explícitos do painel, só com o
recurso em modo envio. Cada um vira um **passo** (`int_passos`):

```
enviando → confirmado | confirmado_sem_id | recusado | desconhecido | abandonado
```

- O passo é aberto (trava curta), a chamada sai **fora da trava**, e o
  resultado é gravado numa operação do diário (passo + vínculo + auditoria).
- Sem resposta clara (rede caiu, 5xx, resposta ilegível) depois do envio:
  **resultado desconhecido** + pendência. O mesmo `operacaoId` de novo
  responde "incerto" e **não reenvia**.
- Em Pendências: **Verificar** (criar paciente: procura por telefone/e-mail e
  vincula se achar exatamente um), **Confirmar à mão** (depois de conferir no
  Clinicorp; opcionalmente com o id), **Reenviar** (decisão explícita, com
  aviso de que a API não garante não duplicar) ou **Abandonar**.
- Envio de lead perdido não é verificável pela API (não há consulta de leads):
  só confirmação manual.
- O CPF digitado para criar um paciente vai só no pedido ao Clinicorp; não é
  guardado.

## 7. Falhas

| O que acontece | O que o Alveare faz |
|---|---|
| 401/403 do Clinicorp | suspende a integração, registra `SECURITY · CLINICORP_AUTENTICACAO`, o painel mostra o aviso; **ninguém é desconectado do Alveare** (os códigos `integracao_*` nunca são da categoria `autenticacao`). Corrigir a credencial e testar de novo tira a suspensão |
| 429 | interrompe a execução e guarda o ponto |
| rede / 5xx em leitura | repete 2 vezes; depois, interrompe e guarda o ponto |
| rede / 5xx depois de uma escrita | resultado desconhecido (ver 6) |
| suspender / desconectar | desconectar desliga recursos e agendamento; **nada importado é apagado**, vínculos ficam |

## 8. Validação com a conta real (pendente)

Estes pontos só a conta real responde. Faça na ordem, olhando o painel:

1. Teste de conexão: as 9 leituras respondem? A lista de unidades aparece?
2. `/payment/list`: o `id` é único por parcela? (A especificação o descreve
   como "id da especialidade".) Compare a prévia de um mês com o relatório de
   recebimentos do Clinicorp.
3. `/appointment/list`: a resposta traz algum campo de paciente (`PatientId`
   ou `Patient_PersonId`)? Se trouxer, o adaptador já usa; se não, a
   atribuição continua pela consulta filtrada das pacientes vinculadas.
4. `/appointment/list`: o campo `date` vem em UTC como documentado? Confira
   o dia de um agendamento perto da meia-noite.
5. `/estimates/list`: o valor (`Amount`) já vem com desconto ou não? Compare
   uma ficha.
6. `/patient/get`: busca por telefone aceita o formato com DDD sem DDI?
7. Só depois, se quiser escrita: ligue Pacientes em envio e crie **um**
   paciente real que de fato precisava existir. Confira o vínculo.

Até lá, a matriz mostra as escritas como "documentada — nunca exercitada".

## 9. Retorno

Desligar a integração: painel → Desconectar, e apagar as duas propriedades
de credencial no editor. O que foi importado continua nas abas `int_*` e
pode ser ignorado. Voltar para a 4.0.0 está em [PUBLICACAO](PUBLICACAO.md).
