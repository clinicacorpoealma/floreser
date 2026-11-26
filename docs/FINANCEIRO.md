# Financeiro (4.4.0)

Módulo em `financeiro/` (estrutura, aparência e comportamento separados),
regras puras em `backend/30_RegrasFinanceiro.gs`, serviço em
`backend/31_ServicoFinanceiro.gs`, importação em
`backend/32_ServicoImportacao.gs` + `compartilhado/importacao.js`.

## Quem entra

- Permissão **financeiro** marcada no painel → Usuários, ou conta
  administradora. Ter Entradas não dá Financeiro.
- Não existe senha compartilhada do Financeiro (`MODULOS_COM_SENHA` não o
  inclui): o portão só oferece a conta individual.
- O servidor confere em toda ação (`modulo: ["financeiro"]` nas rotas),
  inclusive no resumo, na simulação, na importação e na busca global, que só
  procura despesas para quem tem a permissão.

## Despesas

- **Obrigação ≠ pagamento.** `fin_despesas` diz quanto se deve, a que mês
  pertence (competência) e quando vence; `fin_movimentos` guarda cada
  pagamento e cada estorno. O estado sai dos dois: pendente · parcialmente
  paga · paga · vencida · cancelada.
- **Pagar é sempre explícito** (`pagamento.registrar`): data não futura,
  valor até o saldo. Nada vira pago por data, recorrência ou previsão.
- **Correção** = estorno (o pagamento continua no histórico, com o estorno ao
  lado) + novo pagamento. Cancelar exige estornar antes. Tudo com auditoria.
- **Parcelamento**: um grupo (`fin_grupos`) e uma despesa por parcela, com id
  `<grupo>-<n>`, vencimento próprio e valor exato — o resto da divisão vai,
  um centavo por vez, para as primeiras parcelas (100,00 em 3 = 33,34 +
  33,33 + 33,33). A compra não é contada à parte. Competência por parcela
  (padrão) ou toda na da compra.
- **Recorrência**: frequência (semanal, quinzenal, mensal, bimestral,
  trimestral, semestral, anual), início e fim ou quantidade. Fim de mês:
  guarda o dia original (31/01 → 28/02 → 31/03). As ocorrências são criadas
  até 3 meses à frente (ou até a data pedida, no máximo 24 meses) e geradas
  de novo sem duplicar (id `<grupo>-<índice>`). "Esta e as seguintes" muda o
  modelo e as ocorrências sem pagamento; paga ou cancelada fica como está.
  Encerrar cancela só as futuras sem pagamento. O que ainda não foi gerado
  aparece na Visão geral como **projeção**, à parte.

## Visão geral

Calculada no servidor (`financeiro.resumo`), na mesma base para o período e
para a comparação (o período anterior de mesmo tamanho):

| Número | Base |
|---|---|
| Saídas pagas (caixa) | pagamentos − estornos pela data do pagamento |
| Competência | despesas não canceladas cujo mês de competência cai no período |
| A pagar no período | saldo em aberto com vencimento no período (+ projeção de recorrências, à parte) |
| Vencidas / próximos 7 dias | saldo em aberto por vencimento |
| Entradas registradas | `ent_entradas` do período, com proveniência (manual, importação, Clinicorp); "em haver" fica fora do recebido |
| Resultado parcial | entradas registradas − saídas pagas, **com a explicação de que não é lucro líquido** |
| Saldo | só com um saldo inicial confiável (conta, data, valor) na data ou antes do início do período; sem ele, "não calculado" |

Filtros: período, categoria, fornecedor, estado, área, origem. Cada cartão
abre as despesas que o compõem. Orçamento mensal por categoria, contra a
competência, com alerta na porcentagem escolhida.

Valores do Clinicorp (resumo financeiro, recebimentos sem vínculo) aparecem
num bloco à parte, "só para conferência": nunca somados nem quebrados em
despesas.

## Estoque (4.2.0)

Aba **Estoque** (`backend/33_ServicoEstoque.gs`). Responde: o que tenho,
quanto, desde quando se sabe, o que falta.

- **Fonte.** O Clinicorp ainda não dá acesso ao estoque pela API (ver
  [CLINICORP.md §11](CLINICORP.md)). Enquanto isso: **importação manual** do
  arquivo exportado (nome, código, quantidade, unidade, categoria, mínimo,
  custo, local, lote, validade, data do retrato), com o mapeamento da última
  importação reaproveitado; e itens **só do Alveare**, marcados assim.
- **Saldo é retrato.** Cada importação grava um retrato por item/local/lote
  com data (`est_saldos`); o saldo atual é o último. Quantidade vazia =
  **desconhecido** (não é zero); zero = esgotado; retrato com mais de 7 dias
  aparece como antigo. Entre retratos só se mostra a **variação observada** —
  nada de inventar compra, consumo ou perda.
- **Sem estoque duplo.** Item de fonte externa não tem nome/código/custo/saldo
  editáveis no Alveare (só unidade de consumo, fator, mínimo, ficha e notas) e
  só recebe movimento depois de "Assumir o saldo no Alveare" (ver abaixo).
  Nada dá
  baixa por agendamento; ordem de compra não é mercadoria; compra recebida não
  é conta paga (a despesa continua em Despesas, separada).
- **Quantidades** em milésimos inteiros (até 3 casas), sem ponto flutuante.
  Conversões só entre unidades compatíveis (ml/l, g/kg/mg, cm/m) ou pelo
  **fator** do item (ex.: 1 CX = 200 un); o que não converte é erro, não chute.
  Unidades do Clinicorp (UN, ML, G, CX, FA, AP...) aceitas.
- **Indicadores**: esgotados, abaixo do mínimo, validade em até 30 dias,
  desconhecidos; **lista de reposição** (quanto falta para o mínimo); detalhe
  do item com saldo por local/lote, custo e histórico disponível.
- **Precificação.** "Usar na precificação" cria/atualiza o material da ficha
  com unidade de consumo e custo do item (`fin_insumos.itemEstoqueId`,
  `custoFonte`: importação ou estimativa local). Quando o custo muda, o
  cálculo atual acompanha, fichas com versão aprovada ganham o aviso
  **revisar**, e versões aprovadas e preços não mudam. Composição (consumo
  estimado) ≠ consumo registrado ≠ compra ≠ pagamento: nada disso vira
  despesa.

## Vendas, saldo único e custo histórico (4.3.0)

**Um saldo por item, com a origem à vista** (`est_itens.modoSaldo`):

| Modo | De onde vem o saldo | Venda registrada no Alveare |
|---|---|---|
| `retrato` | último arquivo importado (ou o Clinicorp, quando houver acesso) | **não** desconta: a fonte já reflete a saída; fica para valor vendido e custo |
| `livro` | contagem com **corte** (`corteEm`, data e hora) + movimentos efetivos depois dele | desconta na **saída confirmada** |

- Item só do Alveare é `livro`. Passar de `retrato` para `livro` é explícito
  ("Assumir o saldo no Alveare"), **sempre por uma contagem**; arquivos
  importados depois viram só registro. "Voltar ao saldo do arquivo" faz o
  caminho inverso, com o livro guardado como histórico. Nunca há dois saldos
  concorrentes.
- **Corte.** Movimento datado antes do dia do corte não conta; no próprio dia,
  só o registrado depois da contagem. Assim, venda histórica importada depois
  da contagem entra no histórico e no resultado **sem descontar de novo**.
- **Movimentos** (`est_movimentos`): entrada (compra recebida, com custo),
  venda, devolução com retorno físico, perda, consumo de material, ajuste
  (+/−), e **estorno** (`estornaId`) para corrigir sem apagar. Consumo nunca
  sai de agendamento. Saldo negativo aparece como "Saldo negativo" (falta
  entrada ou contagem), nunca como esgotado.

**Venda** (`est_vendas` + `est_venda_itens`): data, paciente, origem
(manual/importação), itens discriminados (produto, quantidade, unidade, preço
realmente cobrado, desconto), desconto geral, taxas (se conhecidas), notas.

- A **baixa acompanha a saída efetiva**: só venda ativa com `entregueEm`, e só
  item em `livro`. Orçamento, agendamento ou pagamento não são prova de saída;
  recebimento nunca vira venda. Parcelas e formas de pagamento são das
  Entradas: **uma venda = uma saída por item**.
- **Reprocessar não desconta duas vezes**: cada item da venda tem um
  movimento ativo (`origemId = venda|item`). Salvar de novo igual não muda
  nada; mudar quantidade, produto ou data de saída gera **estorno + movimento
  novo**; cancelar estorna tudo (inclusive a devolução já contada).
- **Devolução** diminui o vendido; só **repõe** o estoque com
  `retornoFisico` (e item em `livro`).
- **Desconto geral** é rateado pelos itens na proporção do valor líquido de
  cada um (critério explícito), para dar o vendido por produto.
- **Custo gravado no item da venda** (`custoUnitario` + `custoFonte`), na
  primeira gravação:
  1. `compra` — custo médio ponderado móvel das entradas do livro até o dia
     da venda (comprovado);
  2. `importacao` — custo informado pela fonte;
  3. `estimativa` — custo digitado no cadastro;
  4. vazio — **não informado** (nunca zero; a diferença fica em branco).
  Mudar o custo depois não reescreve o resultado de vendas passadas.
- **Diferença = vendido − custo gravado**, antes de taxas (quando não
  informadas) e de despesas fixas. Não é lucro, e a tela diz isso.
- Exemplo conferido em teste: 10 unidades a R$ 30; 2 vendidas a R$ 50 e 1 a
  R$ 45 → saldo 7, vendido R$ 145, custo R$ 90, diferença R$ 55.
- **Relatório de vendas** (importação `tipo: vendas`): produto pelo código
  ou nome exato (sem produto cadastrado, a linha é recusada); linhas da mesma
  venda (coluna "venda", ou data + paciente) viram uma venda; a coluna
  "entregue" (sim/x/data) confirma a saída — sem ela, a venda entra sem baixa.
  Reimportar igual não muda nada; diferente, corrige com estorno.

**Preço praticado** (`financeiro.precosPraticados`, dentro da ficha): vendas
do produto ligado (`est_itens.fichaId`) e execuções realizadas com a ficha,
cada linha com data, quantidade, custo unitário e total, preço, desconto,
vendido, diferença; resumo com menor/maior preço e linhas sem custo ou valor.

## Orçamentos e execução (4.3.0)

Aba **Orçamentos e execução** (`backend/34_ServicoExecucao.gs`). Por
paciente e orçamento: orçado, agendado, realizado, restante, excedente, valor
acordado e valor realizado (valor acordado por unidade × realizado até o
orçado; excedente sem preço inventado). O recebido fica nas Entradas.

- **Realizado = registro de execução (`exe_execucoes`) ligado a um
  agendamento identificado**: `clinicorp:<id>` (agendamento sincronizado),
  `agenda:<id>` (agenda_agendamentos) ou `agenda-hist:<id>` (sessão do
  histórico da Agenda, tipo `sessao`). Nunca é fonte: contador de sessões,
  sessões contratadas, aprovação do orçamento, pagamento, data que passou, nem
  o "Executado" do orçamento no Clinicorp (aparece só como conferência).
- Estados da execução: `previsto` · `realizado` · `desfeito` (fica no
  histórico, não conta). Status do agendamento: agendado · confirmado ·
  compareceu · falta · cancelado (do `Type` da lista de status do Clinicorp,
  corrigível por `categoriaStatus`). Presença não prova procedimento.
  Realizado é recusado em agendamento futuro, cancelado ou com falta; se o
  status mudar depois para falta/cancelado, a execução deixa de contar.
- Um agendamento pode ter vários procedimentos; um item pode ser feito em
  vários agendamentos; dois agendamentos no mesmo dia são distintos.
- **Orçamentos**: do Clinicorp (cada linha de procedimento = 1 unidade, a API
  não traz quantidade; linhas iguais do mesmo orçamento formam um conjunto) e
  do Alveare (`exe_orcamentos`, com quantidade e valor unitário).
- **Associação**: ver "Planos de tratamento" abaixo (desde a 4.4.0 a escolha
  feita num atendimento não é mais copiada para um atendimento novo).
- O filtro de período diz a base: data do orçamento ou data de execução.
- Custo e valor acordado ficam **gravados** na execução (custo da ficha:
  estimativa).
- **Relatório de execuções** (importação `tipo: execucoes`): exige o
  identificador do agendamento; recusa agendamento desconhecido, futuro,
  cancelado, com falta ou sem paciente identificada.

## Planos de tratamento, trocas, bônus e créditos (4.4.0)

Em **Orçamentos e execução**, escolher a paciente abre a ficha dela: planos
em andamento primeiro, depois compras de produtos, avulsos e itens a
classificar, e os planos finalizados (com datas e histórico). Cada plano
responde três perguntas — o que ela contratou, o que recebeu em cada
atendimento e o que ainda pode agendar ou usar como crédito.

**Entidades** (`backend/34_ServicoExecucao.gs`): documento (orçamento de
origem) · plano (os itens de **tratamento** do documento) · linha (um
procedimento do plano) · atendimento (agendamento identificado + complemento
em `exe_atendimentos`) · execução (`exe_execucoes`, com a natureza) · troca
(`exe_trocas`) · utilização de crédito (`exe_creditos`). Tudo sai de **uma
apuração** (`apurarModelo`): lista, ficha, plano e versão para a paciente.

- **Classe dos itens**: tratamento, produto ou avulso. A escolha para aquele
  item > a regra do procedimento (pelo id do cadastro, `classe:ref:<id>`,
  definida uma vez) > o tipo da ficha ligada > a classe do orçamento do
  Alveare. Sem classe: conta como tratamento, com pendência "classificar".
  Só tratamento entra no progresso; documento misto mostra os outros itens à
  parte.
- **Quantidade contratada**, com a origem: quantidade explícita (Alveare);
  linhas de uma unidade cada (Clinicorp); quantidade agregada no texto com
  linhas desdobradas (4 linhas "4 sessões de…") = 4, nunca 16; quantidade só
  no texto (1 linha "4 sessões de…") fica **a conferir** e vale 1 até alguém
  confirmar (`exe_conferencias`, `qtd:<plano>|<procedimento>`).
- **Natureza da execução**: conforme o plano · em substituição (de uma
  troca) · bônus (adicional gratuito) · avulso confirmado · a decidir. A
  decidir é pendência, diferente de avulso.
- **Associação automática só quando inequívoca**: saldo em um só plano pelo
  código do procedimento; ou, sem saldo em nenhum, um só plano em andamento
  com ele (entra como excedente visível). Dois planos ou só nome parecido →
  a pessoa escolhe no próprio atendimento, vendo os saldos. A escolha fica na
  execução daquele atendimento (reimportar, reconfirmar ou sincronizar o
  mesmo atendimento a preserva); **um atendimento novo não herda** — vira só
  sugestão. Plano finalizado não recebe atendimento novo.
- **Números de cada linha**: contratado C; realizado conforme previsto R;
  atendido por substituição S (trocas completamente entregues); comprometido
  em troca P (trocas com entrega pendente); disponível = C − R − S − P;
  excedente = o que passa de C; cumprido = min(C, R + S). Progresso =
  cumpridas ÷ contratadas. Bônus não consome unidade contratada.
- **Resumo**: início (aprovação ou data do orçamento), primeiro atendimento,
  situação (em andamento · concluído · cancelado na origem), atendimentos
  distintos, procedimentos entregues, progresso, restante e pendências.
  Pagamento, tempo ou orçamento novo não encerram um plano.
- **Troca** (`exe.troca.registrar`): registrada uma vez, com linha e
  quantidade de origem, substituto e quantidade prometida. A unidade
  original sai do saldo livre na hora (não pode ser trocada de novo); cada
  entrega é uma execução "em substituição" no atendimento em que aconteceu
  (`trocaId`), até o prometido. A troca mostra prometido, entregue e
  disponível; o disponível aparece em "Pode agendar".
- **Bônus e crédito** (`valoresDaTroca`), pelos valores de venda de
  referência das quantidades totais, gravados na troca com a base e a data:
  substituto mais caro → bônus = diferença − cobrado; mais barato → crédito
  = diferença. A referência da origem é o valor de tabela do próprio item
  (antes de desconto); a do substituto, o preço da ficha na data (versão
  aprovada em vigor) ou o informado. Sem referência → pendente de
  conferência; nada é rateado por igual entre procedimentos diferentes.
  Adicional gratuito confirmado = bônus pelo valor de referência.
- **Custos**, separados do valor comercial: custo das entregas e custo
  adicional da troca (custo prometido do substituto − custo da origem), pela
  ficha aplicável à data — versão aprovada; senão a ficha atual, marcada
  como estimativa. Custo desconhecido = "não informado", e o total é
  sinalizado como parcial.
- **Crédito**: a geração sai da troca (uma troca, uma geração); cada uso
  (`exe.credito.usar`) exige destino explícito (plano ou descrição) e nunca
  passa do saldo; estorno com motivo. Crédito não é recebimento nem
  devolução em dinheiro. Desfazer a troca tira o crédito da apuração; usos
  já feitos ficam rastreáveis (o saldo negativo aparece como alerta).
- **Observação do atendimento**: a original fica guardada; a leitura
  confirmada (manter como observação · substituição · complemento · bônus)
  fica ao lado (`exe_atendimentos.interpretacao`). Texto nunca vira execução
  ou dinheiro sozinho.
- **Confirmar como previsto**: um clique cria uma execução por procedimento
  previsto (id do atendimento + procedimento: repetir não duplica).
- **Correção** de entrega já confirmada exige motivo (fica na auditoria).
  Tirar uma entrega de "em substituição" desfaz a troca quando não sobra
  outra entrega: a unidade volta ao plano e o bônus sai. Nada disso é
  recriado por sincronização ou reimportação.
- **Versão para a paciente** (`financeiro.pacientePlanos` com
  `versao: "paciente"`): progresso, histórico das entregas do plano,
  disponíveis, trocas e bônus em texto, crédito disponível. Custos, valores
  internos, notas e observação não liberada (`observacaoLiberada`) ficam fora
  dos **dados enviados**, não só da tela. Impressão pela própria página.
- **Relatórios**: o de execuções soma linhas repetidas do mesmo atendimento
  e procedimento e reconhece o que já foi registrado por outra via; o de
  agendamentos da paciente (`tipo: atendimentos`, importado da ficha, com
  `contexto.pacienteRef`) completa previstos, observação, marcador e
  profissional, casando por data e horário com um único agendamento dela —
  previsto não é realização.

## Precificação

Ficha de custo de procedimento, produto ou pacote (`fin_fichas`), com
materiais (`fin_insumos`: embalagem, conteúdo e unidade, rendimento em usos,
perda), tempo, mão de obra por hora, equipamentos (custo por uso), rateio dos
custos fixos (por hora, por atendimento ou nenhum — explícito, com a
anotação de onde vem o valor e as categorias incluídas), e os percentuais
sobre o preço: taxa da forma de pagamento, comissão, impostos e margem.

```
C = custo direto (materiais + mão de obra + equipamentos) + rateio
r = taxa + comissão + impostos          (todos sobre o preço)
m = margem desejada                       (sobre o preço)
Preço sugerido = C / (1 − r − m)          só se 1 − r − m > 0
```

- Campo em branco **não é zero**: a ficha lista o que falta, e o preço
  sugerido só aparece com tudo preenchido. Zero é digitado.
- Conversão de unidade (mg/g/kg, ml/l, cm/m, un, uso); unidade que não
  converte é falta, não erro silencioso.
- Avisos de dupla contagem: Materiais/Produtos no rateio com material direto;
  Equipamentos no rateio com custo por uso; Equipe no rateio com mão de obra.
- Resultado: custo direto, rateio, preço sugerido, margem de contribuição,
  resultado depois do rateio, **margem** (resultado ÷ preço) e **markup**
  (preço ÷ custo) — dois números, com o nome certo. Memória de cálculo linha
  a linha.
- Simulação de desconto, taxa da forma e parcelas, **sem gravar**.
- Pacote por composição (fichas × sessões); sessões ≠ parcelas de pagamento.
- **Aprovar** guarda uma versão imutável (`fin_fichas_versoes`) com a
  composição, o retrato dos materiais e o resultado.
- Catálogo do Clinicorp (se consultado) aparece como sugestão no campo
  "Procedimento no Clinicorp". O Alveare nunca altera preço no Clinicorp.

## Importação de planilha (CSV/XLSX)

Reutilizável (`FloreSerImportacao.abrir`), hoje no Financeiro (despesas) e
nas Entradas (só administradores). Passos: arquivo → aba → colunas → como ler
datas (dia/mês/ano, mês/dia/ano, ano-mês-dia) e dinheiro (vírgula ou ponto)
→ prévia linha a linha conferida pelo servidor (erros, avisos, repetidas no
que já existe e dentro do arquivo, com "importar mesmo assim") → confirmar.
Cada confirmação é um lote em `sis_importacoes`, numa operação do diário; o
mesmo lote de novo não duplica. Na planilha de despesas, a coluna "pago em"
só vira pagamento porque a planilha diz que foi pago — e o pagamento leva
essa evidência. Nenhum formato de exportação do Clinicorp é suposto.

## Testes

`node testes/financeiro.js`: permissões, pagamento parcial, estorno,
repetição, parcelas e centavos, recorrência com fim de mês e geração
repetida, "esta e as seguintes", caixa/competência/previsão, orçamento,
saldo, precificação completa e incompleta, pacote, importação de despesas e
de entradas.
`node testes/vendas.js`: o exemplo 10 × R$ 30, venda com vários produtos e
desconto rateado, reprocessamento e parcelas sem baixa dupla, saída a
confirmar, contagem com corte e histórico, retrato × livro, correção,
devolução e cancelamento, custo desconhecido e custo que muda, preço
praticado.
`node testes/planos.js`: os critérios de aceite dos planos — plano e compra
separados, quantidade explícita × linhas × texto, dois planos e escolha
preservada, troca Peel/limpeza e observação mantida, troca parcial 1 → 3,
bônus/custos com e sem cobrança, crédito e uso, adicional gratuito, plano de
15 unidades (73%), correção de substituição, falta/cancelamento e versão
para a paciente.
`node testes/execucao.js`: nada vira realizado sozinho, parcial em vários
agendamentos, vários procedimentos num agendamento e dois no mesmo dia,
cancelamento/falta/correção, sem orçamento e excedente, associação ambígua e
reaproveitada, filtro por base, relatório importado.
