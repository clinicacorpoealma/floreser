# Integração com o Clinicorp (4.3.0)

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
| Confirmar / desmarcar | `POST /appointment/confirm_appointment`, `/cancel_appointment` — `subscriber_id`, `id` | **muda** · envio | um agendamento | resposta perdida → verificação pela consulta do dia (`Canceled`/`StatusId`); sem certeza, "ainda não confirmado" | implementadas (4.2.0), desligadas por padrão, testadas só com respostas simuladas |
| Solicitar agendamento online | `POST /appointment/create_online_scheduling` | **muda** · envio | uma **solicitação** | solicitação ≠ agendamento | **não implementada** |
| Orçamentos do período | `GET /estimates/list` — `subscriber_id*`, `from*`, `to*` (≤ 31 dias), `status`, `clinic_id` | leitura · consulta | um orçamento por tratamento: status, profissional, valor, desconto, procedimentos | o período filtra pela data do **desfecho** de cada status; só o desfecho atual; pode vir do cache (`Cached: true`); identidade estável = `TreatmentId` | implementada |
| Um orçamento | `GET /estimates/get` — `subscriber_id*`, `treatment_id*` | leitura · consulta | um orçamento | — | implementada |
| Recebimentos | `GET /payment/list` — `subscriber_id*`, `from*`, `to*`, `get_amount_with_discounts=X`, `date_type` (vazio = recebimento; `postDate`; `checkoutDate`) | leitura · consulta | uma parcela: valor, valor sem taxas (opcional), vencimento, recebido/confirmado e datas, forma, parcela, paciente, tratamento, checkout | **sem data de liquidação**; a especificação descreve o campo `id` como "id da especialidade" — unicidade por parcela a confirmar na conta real | implementada |
| Recibos | `GET /financial/list_receipt` | leitura | recibos | recibo é documento, não recebimento | não usada |
| Resumo financeiro | `GET /financial/list_summary` — `subscriber_id*`, `from*`, `to*`, `business_id` | leitura · consulta | totais do período | agregado: só conferência, nunca somado nem quebrado | implementada |
| Fluxo de caixa | `GET /financial/list_cash_flow` | leitura | agregado por forma | — | não usada |
| Campanhas do CRM | `GET /crm/list_active_campaigns` — `subscriber_id*` | leitura · consulta | nome, status, descrição | a descrição na especificação está trocada ("Lista todos os usuários") | implementada |
| Enviar lead para campanha | `POST /crm/add_leads` — `Name`, `Email`, `Phone`, `BoardName`, `Notes` | **muda** · envio | um lead | sem id na resposta e sem consulta de leads: envio perdido não é verificável pela API | implementada, desligada por padrão |
| **Estoque** (produtos, saldos, unidades, locais, lotes, movimentações) | **não existe** na especificação pública (conferida em 20/11/2026 nas duas URLs oficiais, 49 endereços) | — | — | precisa o Clinicorp liberar e documentar uma consulta; ver §Estoque | **sem acesso** — adaptador pronto, importação manual de arquivo enquanto isso |
| Ordem de compra | `POST /products/orders` — `clinic` (CNPJ), `orderCode`, `orderDate`, `products[code, name, quantity, unitPrice, unitOfMeasurement, expirationDate]` | **muda** · envio | uma ordem | ordem de compra não é mercadoria recebida nem conta paga; não lê saldo. O enum de unidades (UN, CX, ML, G, FA, AP...) é usado como referência no Estoque | não usada |
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


## 10. Funcionamento automático (4.2.0)

Antes da 4.2.0, a rotina agendada só atualizava as abas de integração;
vincular, importar e conciliar eram feitos no painel. Agora a etapa que
faltava existe: **consultar → normalizar → identificar → aplicar a política →
atualizar o módulo → registrar o resultado** (`backend/39_ClinicorpAplicacao.gs`).

### Configurar uma vez (painel → Integrações → Configurar)

1. **Conferir a conexão** (com descoberta do assinante se ele não for conhecido).
2. **Escolher a clínica** (unidade). Trocar depois recomeça daquela clínica.
3. **O que dá para trazer** — o que esta conta respondeu, e o estoque como
   "sem acesso".
4. **Como tratar os dados compartilhados** — opção recomendada *Usar o
   Clinicorp como fonte principal dos dados compartilhados*: recebimentos,
   orçamentos e agendamentos em modo **automático**, recebimento recebido vira
   entrada, orçamento aprovado/reprovado aplica a etapa pelas regras do CRM,
   reconsulta do último mês. Mapeamento **profissional → área** da Agenda
   (sem área, o agendamento fica só como contexto). Opcional: permitir
   confirmar/desmarcar agendamentos pela ficha.
5. **Trazer e revisar as correspondências iniciais** — prévia e importação
   dos últimos 60 dias (agendamentos: mais 60 à frente). Casos parecidos com
   lançamentos manuais viram pergunta na ficha, não duplicata.
6. **Ativar** — liga o gatilho de tempo (15 min a 1×/dia; padrão 30 min). Não
   é tempo real. Opcional: trazer também recebimentos importados antes da
   automação que ainda não viraram entrada.

Depois disso o painel mostra só *está funcionando? quando foi a última
rotina? quanto está na fila? o que pede atenção?* — e "Buscar novidades
agora".

### Política de aplicação

| Registro do Clinicorp | O que acontece sozinho | Quando pede uma pessoa |
|---|---|---|
| Recebimento recebido/confirmado, sem vínculo | vira **entrada** (`origem: clinicorp`, valor bruto, data do recebimento) e fica vinculado | há entrada manual do mesmo dia e valor sem vínculo (pergunta na entrada: "Vincular a este recebimento" / "É outro pagamento"); forma de pagamento sem equivalente |
| Recebimento vinculado que mudou | data e valor da entrada acompanham, com auditoria (`contexto: Clinicorp`) | entrada dividida em várias formas (conflito real) |
| Recebimento desfeito/estornado | entrada marcada `externoEstado: estornado`, fora das somas de Entradas e Financeiro; nada é apagado | — |
| Orçamento de paciente ligado a uma lead (vínculo direto, ou paciente da Agenda vinculada com `crmLeadId`) | status novo com regra **aplicar**: etapa pelas regras do CRM, só a partir das etapas de origem; regra **propor**: pergunta na lead | — |
| Orçamento de paciente sem lead | só contexto | nome **e** telefone (10 dígitos) batem com exatamente uma lead: "Este é o mesmo paciente?" na lead |
| Agendamento de paciente vinculada, profissional com área, de hoje em diante | entra/remarca/sai da série da área, por `planejarPaciente` (série, eco no CRM, auditoria) | a paciente não tem ciclo daquela área |
| Agendamento passado, sem área ou de paciente sem vínculo | só contexto | — |

Nunca: orçamento → recebimento; confirmação → comparecimento; comparecimento →
venda; data que passou → pagamento ou consumo de estoque; uma lead para cada
paciente.

### Representação única e campos do Clinicorp

Uma entrada vinculada **é** o recebimento (não há duas): data e valor/forma
são do Clinicorp e não se editam no Alveare (o servidor recusa e a tela mostra
só para leitura); nome, procedimento e observação são do Alveare. Na Agenda,
uma data que veio do Clinicorp não é apagada nem remarcada localmente (o
servidor recusa, com o motivo); ciclo, intervalo, áreas e histórico são do
Alveare. Proveniência: `int_vinculos` (identidade local ↔ externa),
`int_externos.dados` (último estado externo), `.complemento` (nota local),
`.aplicacao` (o que foi aplicado e quando), `sis_auditoria` (histórico).

### Fila, retomada e identidade

- **Fila persistente** = `int_externos` com `aplicado ≠ assinatura`. Cada
  registro é uma operação no diário com `operacaoId` derivado de
  (registro, assinatura): repetir não duplica. Falha → até 3 tentativas nas
  rotinas seguintes; depois, pendência. Uma falha não segura os outros.
- **Cursor das pacientes**: os agendamentos por paciente vinculada são
  consultados para **todas**, com o índice gravado na execução; limite de
  chamadas ou de tempo interrompe e a próxima execução continua. A consulta
  só fica "concluída" quando todas as janelas e pacientes foram cobertas.
- **Identidade com o assinante**: `clinicorp:<assinante>:<tipo>:<id>` (e o
  vínculo acrescenta `:<tipoLocal>`). Pontos de retomada guardam conta e
  unidade; trocar uma delas descarta checkpoints e não retoma execuções da
  outra.
- **Telas**: `compartilhado/integracao.js` relê o estado da planilha ao abrir,
  a cada 3 min com a aba visível e ao voltar para a aba; redesenha só o bloco
  da ficha, sem recarregar e sem mexer no que está sendo editado.

### Implementado · simulado · validado

| | Implementado | Testado com simulação | Validado na conta real |
|---|---|---|---|
| Leituras (recebimentos, orçamentos, agendamentos, pacientes, campanhas, procedimentos, resumo) | sim | sim | **não** (ver §8) |
| Aplicação automática nos módulos | sim | sim (`testes/automacao.js`, ponta a ponta) | **não** |
| Confirmar/desmarcar agendamento | sim | sim | **não** — nunca chamado na conta real |
| Criar paciente / enviar lead | sim (4.1.0) | sim | **não** |
| Criar agendamento | não (exige profissional/cadeira/horário que a Agenda não modela) | — | — |
| Estoque do Clinicorp | adaptador preparado, sem endpoint | — | **sem acesso** |

## 11. Estoque

**Verificado em 20/11/2026:** a especificação oficial (as duas URLs servem a
mesma, 49 endereços) não tem nenhuma consulta de produtos/insumos, saldos,
locais, lotes ou movimentações. O site do Clinicorp anuncia uma ferramenta de
Controle de Estoque, mas ela não está exposta na API pública. O único
endereço de produtos (`POST /products/orders`) cria ordem de compra — não lê
estoque, e ordem não é mercadoria recebida.

**O que o Alveare faz até lá:** Financeiro → Estoque com **importação manual**
do arquivo exportado (mapeamento salvo, reimportação idempotente por dia),
claramente identificada como manual, e itens **só do Alveare** para o que não
existe no Clinicorp. O adaptador (`est_itens.origem = clinicorp`,
`est_saldos.fonte = clinicorp`) está pronto para receber a consulta quando
existir. Não há sincronização fictícia.

**O que pedir ao Clinicorp (texto pronto, para a clínica enviar):**

> Usamos a API do Clinicorp (Usuário API/Token API da assinatura) e
> precisamos ler o estoque da clínica. A documentação pública
> (api.clinicorp.com/api-docs) não tem esse recurso. Vocês têm, ou podem
> liberar para a nossa assinatura, uma consulta documentada com:
> 1) lista de produtos/insumos com código, nome, categoria e unidade de
> medida; 2) saldo atual por clínica/local; 3) lotes e validade;
> 4) movimentações (entrada, consumo/baixa por procedimento, perda, ajuste)
> com data e origem; 5) custo unitário? Se existir exportação oficial
> periódica (arquivo), qual o formato?

Nada foi enviado ao suporte nem alterado na conta: isso fica com a clínica.

## 12. Vendas de produtos e execução de procedimentos (4.3.0)

Conferido na especificação oficial (OpenAPI 3.0.1, 49 caminhos, as duas URLs
idênticas) em 20/11/2026:

| Precisava | Existe na API? | O que há |
|---|---|---|
| vendas de produtos discriminadas (produto, quantidade, preço, desconto, entrega) | **não** | `/payment/list` é parcela de pagamento; `/financial/list_invoices` é nota fiscal; `POST /products/orders` cria pedido de compra (não lê vendas nem estoque) |
| saldo de estoque / movimentos | **não** | — (ver §11) |
| procedimentos realizados em cada agendamento | **não** | `/appointment/list` traz só `Session` (contagem de sessões, não é fonte) |
| vínculo agendamento ↔ orçamento | **não** | — |
| itens do orçamento | sim | `ProcedureList` com id, `Procedure_CharacteristicId`, valores, `Executed`/`ExecutedDate` (sem dizer em que agendamento), sem quantidade |
| status de agendamento com chave estável | sim | `/appointment/status_list` (`Type`, ex.: CONFIRMED) |

Na matriz: `vendas.produtos` e `execucao.procedimentos` com
`implementado: false` e a alternativa. Nada foi inventado nem lido da tela.

**Alternativas que funcionam hoje (não apresentadas como automáticas):**
venda registrada no Estoque ou relatório de vendas importado (mapeamento
salvo); procedimento registrado no agendamento ou relatório de execuções
importado (precisa do identificador do agendamento). Orçamentos e
agendamentos continuam vindo sozinhos pela sincronização, com retomada sem
duplicar, janela de reconsulta para correções e o limite de chamadas.

**O que pedir ao Clinicorp** (suporte/API), com essas palavras:
1. Endpoint de leitura de **vendas de produtos** com itens: produto (id e
   código), quantidade, unidade, preço unitário cobrado, desconto, data da
   venda, situação de entrega/retirada, paciente, e data de alteração (para
   buscar correções e cancelamentos).
2. Endpoint de **estoque**: produtos com código e unidade, saldo por unidade
   da clínica, lote/validade, movimentos com tipo e data, custo unitário.
3. Em `/appointment/list` (ou endpoint próprio): os **procedimentos
   realizados no agendamento**, com o id da linha do orçamento
   (`ProcedureList.id`/`TreatmentId`) e a quantidade.
4. Quantidade por linha de procedimento no orçamento.

Quando algo disso existir: conferir na especificação, acrescentar em
`CLINICORP_OPERACOES` (leitura, `implementado: true`), mapear para
`est_vendas`/`exe_execucoes` com origem `clinicorp` e identidade
`idDoExterno`, e testar contra o simulador antes da conta real.

**Testado vs. confirmado.** Vendas, livro do estoque, execução, associação e
as importações estão cobertos por testes com dados sintéticos e no servidor
local. Nada disso foi exercitado numa conta real do Clinicorp: a leitura dos
procedimentos completos do orçamento e da lista de status usa campos da
especificação, ainda não vistos numa resposta real (§8).
