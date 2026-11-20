# Financeiro (4.1.0)

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
