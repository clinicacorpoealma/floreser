# API do Apps Script — contrato v2

`POST <URL da implantação>` com `Content-Type: text/plain;charset=utf-8` (evita
o preflight `OPTIONS`, que o Apps Script não responde). O corpo é JSON.
O endereço mora só em `compartilhado/config.js`.

## Pedido

```json
{ "v": 2, "pedidoId": "pd-...", "acao": "crm.aplicar", "token": "...",
  "cliente": { "versao": "4.0.0", "agente": "Chrome · Windows" },
  "dados": { } }
```

Pedido sem `v` é tratado como site 3.5.0: recebe `{ ok:false, erro:"versao_cliente" }`
no formato antigo e **não consegue gravar** (só o registro técnico é aceito).

## Resposta (sempre HTTP 200)

```json
{ "ok": true, "v": 2, "pedidoId": "pd-...",
  "servidor": { "versao": "4.0.0", "api": 2, "schema": 2, "schemaAtivo": 2 },
  "dados": { }, "sessao": { "tipo": "conta", "expiraEm": "...Z", "expiraAbsoluto": "...Z", "contaId": "...", "modulo": "" } }
```

```json
{ "ok": false, "erro": { "codigo": "conflito", "categoria": "conflito", "mensagem": "...", "repetivel": false, "...": "detalhes" } }
```

Só `ok === true` é sucesso. O navegador nunca deduz sucesso da falta de erro.

## Categorias e códigos

| Categoria | Códigos | O que o navegador faz |
|---|---|---|
| autenticacao | `sessao_ausente` `sessao_invalida` `sessao_expirada` `sessao_revogada` `conta_inativa` `credenciais` `bloqueado` `senha_modulo_desligada` | pede entrar de novo (só esta categoria) — sem perder a tela |
| autorizacao | `sem_acesso` `sem_permissao` | explica; a sessão continua |
| validacao | `dados_invalidos` `acao_desconhecida` `operacao_divergente` `nao_encontrado` `sem_confirmacao` `na_lixeira` | mostra a recusa; não repete o mesmo conteúdo |
| conflito | `conflito` (com `rev` e `atual`) | concilia aquela ficha |
| versao | `versao_cliente` `versao_servidor` `manutencao` | pede recarregar / avisa / espera |
| indisponivel | `ocupado` `servidor_falhou` `instalacao_incompleta` e, no navegador, `sem_conexao` `prazo` `resposta_invalida` | repete leitura sozinho; gravação volta depois |
| incerto | `resultado_desconhecido` (só no navegador) | gravação que pode ter acontecido: repete o MESMO pedido |

## Ações

Públicas: `sistema.ping`, `sistema.versao` (versão, API, schema, schema ativo,
manutenção, capacidades, fuso), `diagnostico.registrar`, `sessao.entrar`
`{usuario, senha, operacaoId}`, `sessao.entrarModulo` `{modulo, senha}`.

Com sessão: `sessao.conferir` `{modulo?, comFoto?}` → `{tipo, conta?, acessoModulo?}`
(falta de acesso é resposta, não erro), `sessao.sair` (só esta sessão).

Leitura dos módulos: `crm.ler` → `{leads, dias, _revDias, contatos}` ·
`agenda.ler` → `{pacientes, categorias, followups, maquinas, vindas, criado, seedMaq, _revConfig}` ·
`entradas.ler` → `{entradas, podeAdministrar}`. Cada entidade raiz vem com `_rev`.

Gravação por operações — `{ operacoes: [{ operacaoId, tipo, id, revBase, ... }] }`,
até 50 por pedido, resultado um por um (um lote **não** é transação):

| Ação | Operações |
|---|---|
| `crm.aplicar` | `lead.criar {id, dados, contatos?}` · `lead.alterar {id, revBase, campos, contatos?}` · `lead.remover {id, motivo?}` · `contato.registrar {dados}` · `config.cadencias {revBase, dias}` |
| `agenda.aplicar` | `paciente.criar {id, dados}` · `paciente.alterar {id, revBase, campos?, ciclos?, condicoes?, maquinas?, historicoNovos?}` · `paciente.remover` · `followup|categoria|maquina|vinda .criar/.alterar/.remover` (vinda com `resp`) · `config.agenda {revBase, criado, seedMaq}` |
| `entradas.aplicar` | `entrada.criar {id, dados}` · `entrada.alterar {id, revBase, campos?, pagamentos?}` · `entrada.remover` (só administrador) |

Resultado de cada operação: `{operacaoId, ok, rev, entidade?, repetida?}` ou
`{operacaoId, ok:false, erro}`. `entidade` é a versão normalizada pelo
servidor (o navegador adota sem desfazer o que foi editado depois).

Outras: `crm.agendarNaAgenda {operacaoId, leadId, area, data, freq, confirmarPacienteId?, criarMesmoAssim?, atualizarData?, dataAnterior?}`
(exige CRM e Agenda; parecida por nome devolve `precisaDecidir` — nunca vincula
sozinho), `lixeira.mover {operacaoId, tipo, id, motivo}`, `lixeira.repetido`,
`auditoria.listar {modulo, entidade, entidadeId, inicio, quantos}`,
`busca.global {termo}` (só conta individual).

Painel (sessão da senha `dev`): `painel.dados`, `painel.limpar`,
`painel.sistema`, `painel.senhaModulo {modulo, ligada}`, `painel.usuarios.*`
(`listar` `criar` `editar` `status` `senha` `encerrarSessoes`),
`painel.lixeira.*` (`listar` `restaurar` `excluir` `limpar`), `painel.auditoria`.

## Idempotência

Cada intenção de gravação tem um `operacaoId` (8 a 80 caracteres
`[A-Za-z0-9_-]`), o mesmo em todas as repetições. A chave registrada liga o id
a **quem** pediu, **qual** ação e **qual** conteúdo: o mesmo id com outro
conteúdo, ou de outra pessoa, responde `operacao_divergente`. A prova fica em
`sis_operacoes` (o CacheService só acelera) por 30 dias. Repetição de algo já
aplicado volta `ok` com `repetida: true` e o resultado original — sem duplicar
cadastro, pagamento, contato, agendamento, histórico, auditoria nem lixeira.
O login também leva `operacaoId`: repetido, encerra a sessão órfã da primeira
tentativa.

## Diagnóstico

`ligarDiagnostico()` no editor: toda resposta ganha `diag` com chamadas ao
Sheets, leituras, escritas, células, tempo de trava (`travaMs`, `presaMs`) e
tempo total. Nunca conteúdo. O navegador guarda as últimas 40 chamadas em
`FloreSerRede.medicoes()` e registra falhas com o `pedidoId`, que o log do
servidor também carrega.
