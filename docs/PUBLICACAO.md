# Publicação, migração, backup e retorno (4.0.0)

A 4.0.0 muda o servidor, o desenho da planilha e o site ao mesmo tempo. Ela
é publicada **uma vez**, numa janela curta de manutenção, nesta ordem:
servidor em manutenção → migração conferida → schema ativo → site → fim da
manutenção. Nada disto roda sozinho: cada passo é um clique ou uma função no
editor do Apps Script.

## 0. Antes de começar (no computador)

```
node testes/backend.js && node testes/migracao.js && node testes/frontend.js
node ferramentas/conferir-publicacao.js
```

Opcional, com um export recente da planilha (fora do repositório):
`node ferramentas/ensaiar-migracao-xlsx.js "C:/caminho/export.xlsx"` — mostra
contagens, somas em centavos e anomalias, sem escrever nada em lugar nenhum.

## 1. Ensaio numa cópia (recomendado)

1. Na planilha: **Arquivo → Fazer uma cópia** (a cópia leva o script junto).
2. No editor da **cópia**, com o código antigo ainda lá, cole e rode
   `transferirSegredosParaPropriedades` (ver passo 2.1).
3. Apague o `Codigo.gs` da cópia e crie um arquivo para cada `backend/*.gs`
   (mesmo nome, mesmo conteúdo). O `appsscript.json` é opcional.
4. Rode, nesta ordem, olhando o **Registro de execução**:
   `migracaoDiagnosticar()` (deve dizer "pronta") → `migracaoEnsaiar()` →
   `migracaoConferir()` (deve dizer "OK") → `migracaoAtivar()` →
   `conferirInstalacao()`.
5. Abra as abas novas (`agenda_pacientes`, `ent_pagamentos`...) e confira à
   vista algumas fichas conhecidas. Apague a cópia quando terminar.

## 2. Produção (janela de ~15 minutos, ninguém usando)

1. **Segredos.** No editor do projeto de produção, ainda com o `Codigo.gs`
   antigo, crie um arquivo temporário com isto e rode uma vez:

   ```js
   function transferirSegredosParaPropriedades() {
     PropertiesService.getScriptProperties().setProperties({
       FLORESER_PIMENTA: PIMENTA,
       FLORESER_SENHA_CRM: SENHA,
       FLORESER_SENHA_AGENDA: SENHA_AGENDA,
       FLORESER_SENHA_ENTRADAS: SENHA_ENTRADAS,
       FLORESER_SENHA_DEV: SENHA_DEV
     });
     Logger.log("Segredos copiados para as propriedades (valores não exibidos).");
   }
   ```

   Os valores não aparecem em lugar nenhum. As senhas viram hash na ativação
   (`prepararSegredos()`), e o texto é apagado das propriedades.
2. **Código.** Apague o `Codigo.gs` e o arquivo temporário; crie os arquivos
   de `backend/*.gs`. Guarde o `Codigo.gs` antigo no seu computador (ele tem
   as senhas — `backend/legado/`, fora do GitHub).
3. Rode `ligarManutencao()`. A partir daqui, nenhuma gravação é aceita.
4. **Implantar → Gerenciar implantações →** editar a implantação atual →
   **Versão: Nova versão** → Implantar. A URL continua a mesma. Sites antigos
   abertos recebem "O sistema foi atualizado. Recarregue a página" e não
   conseguem gravar.
5. `migracaoDiagnosticar()` → precisa dizer **pronta** (0 erros). Os avisos
   esperados: as colunas 6–10 de `Pacientes` sem nome (lidas pela posição).
6. `migracaoBackup()` → cópia privada da planilha no seu Drive, com uma aba
   `_propriedades` (as propriedades que não são segredo). Se o Google pedir
   permissão, autorize; se a cópia falhar, faça **Arquivo → Fazer uma cópia**
   e anote o endereço.
7. `migracaoExecutar()` → no fim, **CONFERÊNCIA: OK**. Se o tempo acabar no
   meio, rode de novo: ela continua de onde parou e pula o que já confere.
8. `migracaoAtivar()`.
9. **Site.** Publique os arquivos no GitHub. Os que mudaram de pasta saem da
   raiz: `auth.js`, `logs.js`, `pwa.js`, `sync.js`, `auditoria.js`,
   `busca.js`, `tema.js`, `painel.js`, `atividade-rede.js`,
   `atividade-rede.css`, `portal.js`, `portal.css` (agora em `compartilhado/`,
   `portal/` e `admin/`). Pelo GitHub Desktop isso vai sozinho; pela
   interface web, apague cada um e suba as pastas novas. `version.js` vai
   junto com o `index.html`, sempre.
10. `desligarManutencao()`.
11. **Conferir:** abra o site, entre com uma conta, abra os três módulos,
    salve uma alteração pequena e veja no painel → Sistema: v4.0.0, API 2,
    schema 2 ativo, operações pendentes "nenhuma". Quem estava conectado
    continua conectado.

## Backup — o que existe e o que não existe

- A planilha: `migracaoBackup()` e o histórico de versões do Google Drive.
- O export `.xlsx` é um **retrato** dos dados, não um backup do ambiente.
- Script Properties (senhas em hash, pimenta, épocas, flags): **não** estão na
  planilha. Os segredos continuam no `Codigo.gs` antigo, no seu computador;
  guarde-o num lugar privado. A aba `_propriedades` do backup lista os nomes.
- A implantação (versões do script): fica no Apps Script; a 3.5.0 continua lá
  como versão anterior.
- Nunca coloque export, backup, foto ou planilha preenchida no repositório
  (o `.gitignore` recusa `.xlsx` e `.csv`).

## Retorno para a 3.5.0

As abas da 3.5.0 ficam intactas desde a migração.

- **Logo depois, sem gravações importantes no schema 2:** Implantações →
  editar → escolha a versão anterior (3.5.0) → Implantar; republique o site
  anterior (o commit da 3.5.0); `FLORESER_SCHEMA_ATIVO` = `1`.
- **Com gravações no schema 2 que precisam voltar:** `ligarManutencao()` →
  `migracaoExportarParaV1()` (reescreve as abas da 3.5.0 a partir das novas,
  com o cabeçalho de `Pacientes` completo, e volta o verificador antigo das
  senhas) → reimplante a 3.5.0 e o site anterior → `desligarManutencao()`.
  Quem trocou de senha depois da migração precisa de senha nova pelo painel.

## Depois de algumas semanas estáveis

- `migracaoFinalizar()` — apaga os verificadores de senha da 3.5.0 guardados
  para o retorno. A partir daí, voltar exige senha nova para todo mundo.
- As abas antigas podem ser arquivadas (renomeadas com "(antigo)") ou
  apagadas, depois de um backup.
- `limparOperacoesAntigas()` de vez em quando (o diário guarda 30 dias).

## Publicações seguintes (4.0.x em diante)

1. Mudou o servidor? Cole os `.gs` alterados e **Nova versão** na mesma
   implantação — sempre antes do site, ou junto.
2. Acrescente a versão no topo do `CHANGELOG` (`version.js`) e, se mudou o
   backend, `VERSAO_PRODUTO` em `backend/00_Config.gs`.
3. `node ferramentas/preparar-publicacao.js` (carimbo da casca + conferência)
   — opcional, mas a conferência precisa dizer "Tudo confere".
4. Suba os arquivos. Quem tem o Alveare instalado recebe "Nova versão do
   Alveare disponível"; se houver alteração por salvar, a troca espera.

Mudou o contrato (API) ou o schema? Suba `VERSAO_API`/`VERSAO_SCHEMA`, o
`compat` do `version.js` e o `api` do `config.js` juntos, e escreva a
migração em `backend/40_Migracoes.gs` — com diagnóstico, ensaio, conferência
e retorno, como a desta versão.

## Testar localmente

`node testes/servidor-local.js` → `http://localhost:4180/floreser/` (o site
debaixo de uma pasta, como no GitHub Pages, com o backend real no simulador e
dados sintéticos; as contas de teste estão no próprio arquivo). Abrir pelo
disco (`file://`) foi preservado no desenho — todos os caminhos são relativos,
a raiz sai do `<script>` do `config.js` e o JSX do CRM segue dentro do
`index.html` —, mas não foi conferido num navegador nesta versão; confira uma
vez antes de contar com isso. Service Worker, só em `http://`.
