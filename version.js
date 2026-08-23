/* =====================================================================
   FloreSer · Corpo e Alma — fonte única de versão e changelog
   ---------------------------------------------------------------------
   Para lançar uma versão nova, acrescente UM registro no TOPO da lista
   CHANGELOG. A versão e o codinome mostrados no site saem sempre do
   primeiro registro daqui, então a tela e o histórico não têm como
   discordar.

   Formato: vX.Y.Z — CODINOME
     PATCH   X.Y.Z → X.Y.(Z+1)    correções, ajustes visuais, refinos
     MINOR   X.Y.Z → X.(Y+1).0    funcionalidades e telas novas
     MAJOR   X.Y.Z → (X+1).0.0    reformulações estruturais

   Ao subir MINOR, Z volta a 0. Ao subir MAJOR, Y e Z voltam a 0.
   O codinome tem uma palavra só, em maiúsculas, sem números, e não se
   repete. Data no formato DD/MM/AAAA, sempre a data real do lançamento.
   ===================================================================== */

(function (global) {
  "use strict";

  /* Mais recente primeiro. Use apenas categorias com conteúdo real. */
  var CHANGELOG = [
    {
      versao: "2.7.1",
      codinome: "ATALHO",
      data: "22/08/2026",
      mudancas: {
        "Alterado": [
          "Os endereços das telas ficaram mais curtos e sem `.html`: o CRM é `/crm/`, a agenda `/agenda/` e as entradas `/entradas/`. A página inicial continua na raiz."
        ],
        "Técnico": [
          "Cada módulo passou a morar numa pasta própria, e os arquivos compartilhados (marca, versão, registro e tema) continuam na raiz, chamados de um nível acima.",
          "Os endereços antigos terminados em `.html` continuam funcionando: quem tiver o link salvo é levado para o novo, com o que vier depois do endereço preservado."
        ]
      }
    },
    {
      versao: "2.7.0",
      codinome: "SENTINELA",
      data: "22/08/2026",
      mudancas: {
        "Alterado": [
          "A entrada nos módulos passou a funcionar por sessão: quem acerta a senha recebe uma credencial daquele aparelho, emitida pelo servidor. A senha deixa de ficar guardada no navegador e não é reenviada a cada consulta.",
          "A credencial vale só para o módulo em que a senha foi digitada: entrar no CRM não abre a agenda nem as entradas.",
          "Cada módulo bloqueia por 15 minutos depois de cinco senhas erradas, e o aviso mostra quantas tentativas restam."
        ],
        "Adicionado": [
          "Botão Sair no CRM, na agenda e nas entradas: encerra a sessão daquele aparelho, sem derrubar quem estiver usando em outro.",
          "A sessão expira sozinha depois de 30 minutos sem uso, e a senha é pedida de novo na volta."
        ],
        "Técnico": [
          "O servidor confere a credencial antes de devolver ou gravar qualquer dado; credencial inventada no navegador não abre nada.",
          "As sessões viraram uma tabela no servidor, uma linha por aparelho, em vez do espaço único que o painel de manutenção usava — ali, entrar num aparelho derrubava o outro."
        ]
      }
    },
    {
      versao: "2.6.1",
      codinome: "BRISA",
      data: "22/08/2026",
      mudancas: {
        "Corrigido": [
          "O seletor de tema continuava claro quando o site estava no escuro. Agora ele acompanha o tema como o resto da tela: fundo escuro, borda discreta e o ícone da opção em uso em teal claro."
        ],
        "Melhorado": [
          "Os ícones das opções não escolhidas ficaram um tom mais escuros no tema claro, para se enxergarem melhor."
        ]
      }
    },
    {
      versao: "2.6.0",
      codinome: "CREPÚSCULO",
      data: "22/08/2026",
      mudancas: {
        "Adicionado": [
          "Tema escuro em todas as telas — portal, CRM, agenda e entradas — desenhado para o escuro, com os mesmos tons da marca em vez de cores invertidas.",
          "Seletor de tema no canto da tela, com três opções: claro, escuro e automático. O botão da opção em uso fica destacado.",
          "No modo automático o site acompanha o tema do computador ou do celular, e muda junto na hora, sem precisar recarregar a página."
        ],
        "Melhorado": [
          "A escolha do tema fica guardada neste aparelho e volta sozinha na próxima vez que o site abrir — cada computador e celular tem a sua.",
          "A página já abre no tema certo, sem aquele lampejo claro antes de escurecer.",
          "Trocar de tema não recarrega a página nem apaga o que estiver preenchido: uma ficha aberta pela metade continua exatamente onde estava."
        ],
        "Técnico": [
          "As cores das quatro telas passaram a viver em variáveis CSS, num arquivo só (tema.js). Trocar de tema troca só o valor das variáveis, e criar um tema novo no futuro é acrescentar um bloco ali."
        ]
      }
    },
    {
      versao: "2.5.0",
      codinome: "ORVALHO",
      data: "22/08/2026",
      mudancas: {
        "Visual": [
          "As Entradas passaram por um acabamento geral: mais respiro entre as seções, cantos mais macios, sombras leves em duas camadas e a lótus da marca em marca-d’água ao fundo, como no portal.",
          "O total do período virou o número principal do resumo, maior que os outros três, para a leitura começar por ele.",
          "O dia de hoje no calendário ganhou um pingo discreto, além do fundo, e os quadradinhos sobem de leve ao passar o mouse."
        ],
        "Adicionado": [
          "Rodapé com a marca, a versão publicada e a volta para a tela inicial.",
          "Entrada suave da tela depois da senha, com as seções aparecendo em sequência — respeitando quem prefere menos movimento."
        ],
        "Melhorado": [
          "Textos de apoio, rótulos e legendas ficaram mais escuros e agora têm contraste de leitura de verdade, inclusive sobre o creme.",
          "Alvos maiores no celular nas setas de período, nos filtros e no rodapé, e valores alinhados em coluna com numeração tabular."
        ]
      }
    },
    {
      versao: "2.4.0",
      codinome: "VERTENTE",
      data: "22/08/2026",
      mudancas: {
        "Adicionado": [
          "Etapa “Em aberto”, para quem compareceu à consulta e ainda não deu resposta. Ela conta como comparecimento no funil e esfria de Quente até Muito frio.",
          "Cada faixa do funil virou botão: tocar nela abre a lista de quem está sendo contado ali, com a data em que aquela etapa aconteceu e a etapa atual da pessoa. Tocando no nome, abre a ficha.",
          "Origem do lead no cadastro — Instagram, Rádio, Vale-presente, Indicação, Google e Outros — e um gráfico de origem no funil, com contagem e porcentagem sobre os leads captados no período."
        ],
        "Alterado": [
          "Cada marco do funil passa a ser carimbado uma vez só, na data em que aconteceu, e nunca é reescrito: marcar como agendada carimba a conversa e o agendamento no mesmo dia, e o comparecimento semanas depois não duplica o agendamento.",
          "Só “Em aberto”, “Venda” e “Venda reprovada” carimbam comparecimento. “Não responde”, “Nurturing”, “Falta” e “Recusado” não mexem no funil.",
          "A importação de planilha reconhece a coluna de origem e converte sozinha as etapas antigas."
        ],
        "Removido": [
          "Etapa “Agendando”, que deixou de ser necessária: quem estava nela volta para “Conversando”.",
          "Etapa “Com orçamento”, que era a mesma coisa que “Em aberto”: quem estava nela passa para “Em aberto”, com a cadência mais larga."
        ],
        "Técnico": [
          "A planilha ganhou a coluna de origem no fim da aba de leads, acrescentada sem renomear a aba nem mexer nos cadastros que já existem."
        ]
      }
    },
    {
      versao: "2.3.0",
      codinome: "COLHEITA",
      data: "22/08/2026",
      mudancas: {
        "Adicionado": [
          "Módulo Entradas: registro do que entra, com nome, valor, data, o que é, forma de pagamento e observação — com senha própria, como o CRM e a agenda.",
          "Uma entrada pode ser dividida em várias formas de pagamento, cada uma com o seu valor e parcelamento, e o valor total passa a ser a soma das partes.",
          "Os dias aparecem em quadradinhos com o total de cada um; clicar abre as entradas daquele dia. Também dá para ver tudo em lista.",
          "Sugestão de nomes já registrados enquanto você digita, sem se importar com maiúsculas ou acentos, e sugestão dos tratamentos no campo “o que é”.",
          "Filtros por dia, semana e mês, por forma de pagamento e por nome ou serviço.",
          "Exportação da tabela de uma data a outra, em planilha que abre direto no Excel, com uma coluna por forma de pagamento e linha de total.",
          "Terceiro quadro na tela inicial, levando às Entradas."
        ],
        "Técnico": [
          "As entradas ficam na mesma planilha do Google que já guarda o CRM e a agenda, em duas abas novas, e por isso abrem iguais no computador e no celular.",
          "O valor é guardado em reais na planilha, para continuar legível para quem abrir a planilha direto.",
          "Se a internet cair, a alteração fica no aparelho e sobe sozinha quando a conexão voltar."
        ]
      }
    },
    {
      versao: "2.2.1",
      codinome: "PRUMO",
      data: "22/08/2026",
      mudancas: {
        "Corrigido": [
          "No painel de manutenção, a faixa das abas era espremida pelo conteúdo da aba aberta: os botões ficavam cortados e uma barra de rolagem aparecia por cima deles.",
          "O painel encolhia e crescia a cada troca de aba, e as abas mudavam de lugar embaixo do dedo. Agora a janela mantém o mesmo tamanho e só o conteúdo rola."
        ],
        "Melhorado": [
          "No celular as quatro abas do painel cabem na tela sem precisar arrastar a faixa para o lado.",
          "A aba escolhida pelo teclado passou a mostrar um realce visível."
        ]
      }
    },
    {
      versao: "2.2.0",
      codinome: "LIMIAR",
      data: "21/08/2026",
      mudancas: {
        "Visual": [
          "As telas de senha do CRM e da agenda foram refeitas com o mesmo desenho: fundo em teal profundo com a lótus ao fundo, cartão creme centrado, marca acima do nome do módulo e um fio sage separando o título do campo.",
          "O campo de senha ganhou ícone de cadeado, realce suave ao ser focado e cantos mais macios; o botão Entrar ganhou estados de repouso, hover e envio."
        ],
        "Adicionado": [
          "Botão discreto para mostrar e ocultar a senha, com rótulo lido por leitores de tela.",
          "Aviso de senha incorreta integrado ao cartão, com ícone e fundo suave, no lugar de uma linha solta de texto."
        ],
        "Melhorado": [
          "Enquanto o sistema confere a senha, o botão mostra um giro discreto e o campo fica bloqueado, deixando claro que algo está acontecendo.",
          "As duas telas ficaram melhores de usar no celular e por teclado, e a animação de entrada respeita quem prefere menos movimento."
        ]
      }
    },
    {
      versao: "2.1.0",
      codinome: "SERENO",
      data: "21/08/2026",
      mudancas: {
        "Corrigido": [
          "O painel de manutenção continuava desenhado por cima da tela inicial depois de fechado.",
          "O site às vezes abria numa versão antiga guardada pelo navegador, mesmo depois de a atualização já estar publicada."
        ],
        "Visual": [
          "CRM e agenda ganharam o mesmo acabamento do portal: cantos mais suaves, sombras leves, realce ao passar o mouse sobre os cartões e entrada tranquila das telas.",
          "O símbolo da marca passou a acompanhar o nome no cabeçalho do CRM."
        ],
        "Técnico": [
          "Os links internos levam o número da versão junto, e a tela inicial confere sozinha se o servidor já publicou uma versão mais nova."
        ]
      }
    },
    {
      versao: "2.0.0",
      codinome: "ALVORADA",
      data: "21/08/2026",
      mudancas: {
        "Adicionado": [
          "Aba Sobre na tela inicial, com a descrição do sistema, os dois módulos e a versão publicada.",
          "Painel de manutenção com visão geral, logs, acessos e informações técnicas, protegido por senha conferida no servidor.",
          "Registro técnico do que acontece no site — aberturas, saídas para o CRM e para a agenda, erros de JavaScript e falhas de comunicação — guardado na planilha para facilitar o diagnóstico."
        ],
        "Visual": [
          "Portal redesenhado: cabeçalho com a marca e a data por extenso, cartões de acesso com mais informação, rodapé estruturado e entrada suave dos elementos.",
          "Detalhe da lótus em marca-d'água ao fundo, sombras leves e transições mais calmas."
        ],
        "Técnico": [
          "Duas abas novas na planilha, Logs e Sessoes, com limite de linhas e descarte automático depois de 90 dias.",
          "A entrada do painel bloqueia por 15 minutos após cinco tentativas seguidas, e a credencial expira em 30 minutos.",
          "Os registros guardam identificadores sorteados e só o que o navegador informa sem pedir permissão — sem localização, câmera ou microfone."
        ],
        "Performance": [
          "O registro técnico envia em lotes, alguns segundos depois de a página abrir, para não atrasar o carregamento."
        ]
      }
    },
    {
      versao: "1.2.0",
      codinome: "POUSIO",
      data: "20/08/2026",
      mudancas: {
        "Adicionado": [
          "Arquivar paciente: quando o plano acaba, ela sai do Dashboard, do quadro semanal e das listas de máquina, mas ciclos, condições, observações e histórico ficam guardados.",
          "Sub-aba Arquivadas na tela de Pacientes, com botão de restaurar que devolve tudo de uma vez."
        ],
        "Alterado": [
          "Marcar Facial, Corporal e Capilar deixou de ser obrigatório: quem só faz máquina é cadastrada sem nenhum ciclo e aparece na lista com o selo “Só máquinas”.",
          "Ao arquivar, os follow-ups pendentes daquela paciente são removidos, para não voltarem atrasados meses depois — o aviso de confirmação diz quantos são.",
          "O rodapé da agenda passou a contar pacientes ativas e arquivadas separadamente."
        ],
        "Técnico": [
          "A aba Pacientes ganhou as colunas de arquivamento, acrescentadas à planilha que já existe sem mexer nas linhas nem renomear abas."
        ]
      }
    },
    {
      versao: "1.1.0",
      codinome: "SEIVA",
      data: "18/08/2026",
      mudancas: {
        "Adicionado": [
          "Máquinas temporárias na agenda: você cadastra as datas em que o Soprano e o Harmony vêm, e a lista das pacientes daquela máquina abre sozinha 14 dias antes.",
          "Opção “próxima vinda” para a paciente que não consegue vir no dia da máquina — ela volta automaticamente na data seguinte que você cadastrar.",
          "Ciclos separados por área na agenda: Facial, Corporal e Capilar, cada um com o seu prazo e o seu agendamento.",
          "Três etapas novas no funil do CRM: Nurturing, Recusado e Venda reprovada."
        ],
        "Alterado": [
          "Quem estiver em condição no dia da vinda da máquina sai da lista e entra na fila da próxima, com um aviso dizendo o motivo.",
          "A etapa “Reprovado” virou “Recusado”; os leads que já estavam marcados assim são convertidos sozinhos."
        ],
        "Técnico": [
          "A planilha ganhou abas para ciclos, máquinas, vindas e respostas. Os dados no formato anterior são convertidos na primeira abertura e as abas antigas ficam guardadas."
        ]
      }
    },
    {
      versao: "1.0.0",
      codinome: "RAIZ",
      data: "14/08/2026",
      mudancas: {
        "Adicionado": [
          "Indicador de versão permanente na tela inicial e histórico de versões acessível por ela.",
          "Página inicial reunindo o CRM e os agendamentos em um só endereço.",
          "CRM com funil comercial: etapas, cadência por etapa, marcação de ex-cliente e arquivo de vendas e reprovados.",
          "Agenda das pacientes sincronizada com a planilha do Google, com senha própria."
        ],
        "Técnico": [
          "Versão, codinome e histórico passam a viver em um arquivo único (version.js), consumido pela tela inicial."
        ]
      }
    }
  ];

  /* Ordem em que as categorias aparecem no histórico. */
  var CATEGORIAS = ["Adicionado", "Alterado", "Melhorado", "Corrigido",
    "Removido", "Visual", "Conteúdo", "Performance", "Técnico"];

  var atual = CHANGELOG[0];

  global.FLORESER = {
    changelog: CHANGELOG,
    categorias: CATEGORIAS,
    atual: atual,
    rotulo: "v" + atual.versao + " — " + atual.codinome
  };
})(window);
