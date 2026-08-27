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
      versao: "2.12.1",
      codinome: "UMBRAL",
      data: "27/08/2026",
      mudancas: {
        "Adicionado": [
          "Ao abrir o CRM, a Agenda ou as Entradas com sua conta já conectada, aparece uma tela dizendo que o sistema está entrando — com a sua foto e o seu nome — em vez de a tela de senha piscar enquanto isso."
        ],
        "Melhorado": [
          "Quando a entrada automática falha, o motivo agora fica na tela: sem acesso ao módulo, sessão expirada, usuário desativado, erro do servidor ou falta de conexão. Antes o erro sumia e parecia que nada tinha acontecido.",
          "Da mesma tela dá para seguir com a senha do módulo ou entrar com outra conta, e quando o problema é de conexão aparece um botão de tentar de novo.",
          "Uma sessão antiga da senha compartilhada não entra mais por baixo escondendo a falha da conta — quem escolhe o caminho é você."
        ],
        "Corrigido": [
          "A tela de entrada automática sumia e deixava o pedido de senha no lugar, sem erro nenhum, quando a conta era reconhecida mas os dados do módulo não carregavam. Agora ela fica no ar e explica o que houve.",
          "O CRM mostrava o funil vazio quando o servidor recusava a leitura, como se não houvesse leads. Agora avisa que não conseguiu carregar e lembra que os dados continuam na planilha."
        ],
        "Técnico": [
          "A tela de entrada automática é uma só, no auth.js, usada pelos três módulos. Ela só aparece quando existe sessão de usuário individual guardada, e respeita quem pediu menos animação no sistema."
        ]
      }
    },
    {
      versao: "2.11.1",
      codinome: "APRUMO",
      data: "27/08/2026",
      mudancas: {
        "Corrigido": [
          "Quando o servidor respondia com um erro dele, a tela de entrar dizia “não foi possível falar com o servidor” e mandava conferir a internet — que estava boa. Agora a mensagem diz que o erro veio do servidor e aponta o lugar certo.",
          "Uma resposta que não seja a esperada deixa de virar uma falha de conexão disfarçada: o motivo técnico fica registrado nos logs, para o painel de manutenção mostrar."
        ]
      }
    },
    {
      versao: "2.11.0",
      codinome: "CUMEEIRA",
      data: "27/08/2026",
      mudancas: {
        "Adicionado": [
          "O sistema agora pode ser instalado como aplicativo. No computador e no celular ele aparece com o nome Alveare e abre em janela própria, sem a barra do navegador.",
          "Botão “Instalar Alveare” no rodapé do portal, que aparece só quando o navegador realmente oferece a instalação.",
          "Atalhos para CRM, Agendamentos e Entradas direto no ícone do aplicativo, para quem quiser pular o portal.",
          "Aviso de “Você está offline” e de “Conexão restabelecida”, discreto, no rodapé da tela.",
          "Tela própria para quando a página pedida ainda não foi aberta nenhuma vez e não há conexão.",
          "Seção do aplicativo no painel de manutenção, com o estado do cache e o botão de limpá-lo."
        ],
        "Melhorado": [
          "Depois de aberto uma vez, o sistema abre sem internet: as telas aparecem, e só o que precisa do servidor é que espera a conexão voltar.",
          "Quando sai uma versão nova, o sistema avisa e troca quando você mandar — sem ninguém precisar limpar cache nem apertar Ctrl+F5.",
          "Nenhuma atualização entra no meio do que você está fazendo: ela espera você clicar em Atualizar."
        ],
        "Técnico": [
          "Alveare é só o nome do aplicativo instalado. Dentro dele o sistema continua sendo o FloreSer, com a mesma marca, as mesmas telas e o mesmo login.",
          "O aplicativo guarda a casca do sistema — telas, scripts e marca. Dado de paciente, de lead, de entrada e resposta de login nunca são guardados: cada chamada ao servidor vai pela rede, sempre.",
          "Os ícones do aplicativo usam a lótus da marca, inclusive nos formatos que o Android recorta em círculo."
        ]
      }
    },
    {
      versao: "2.10.1",
      codinome: "PEITORIL",
      data: "24/08/2026",
      mudancas: {
        "Corrigido": [
          "O menu que abre no seu nome ficava por trás dos quadrados dos módulos no portal.",
          "Na tela de entrar, os rótulos “Usuário” e “Senha” apareciam soltos acima dos campos — eram para ser lidos só por leitores de tela.",
          "A marca, o título e o subtítulo da tela de entrar saíam lado a lado em vez de empilhados.",
          "No CRM e nas Entradas o cartão de entrar saía mais largo do que devia e desencostado do centro da tela."
        ],
        "Visual": [
          "A tela de entrar por usuário ganhou o mesmo desenho do portão de cada módulo: cartão creme de cantos suaves, marca acima do nome, fio de sage separando, campos com anel de foco e botão cheio em teal.",
          "O olho da senha agora troca de cara ao mostrar e ocultar, como nos módulos.",
          "Os avisos de erro aparecem com o triângulo de atenção sobre fundo de alerta, no lugar do texto solto."
        ],
        "Técnico": [
          "As classes da tela de entrar e do menu passaram a ter nome próprio, para nunca esbarrarem no estilo de cada página."
        ]
      }
    },
    {
      versao: "2.10.0",
      codinome: "SOLEIRA",
      data: "24/08/2026",
      mudancas: {
        "Adicionado": [
          "Botão Entrar no canto superior direito do portal: dá para entrar com a sua conta antes de escolher o módulo.",
          "Depois de entrar, o canto mostra a sua foto e o seu nome, com um menu que lista os módulos liberados e o botão de sair.",
          "Foto de perfil: no painel de manutenção dá para escolher uma imagem do computador, ver como ficou antes de salvar, trocar depois e remover.",
          "Quem ainda não tem foto aparece com as iniciais num círculo, no portal, nos módulos e na lista de usuários."
        ],
        "Alterado": [
          "Estando logada no portal, entrar num módulo que a sua conta abre não pede mais senha nenhuma — o sistema reconhece você e entra direto.",
          "A sessão agora dura trinta dias de inatividade, em vez de sete, e o prazo recomeça a cada uso.",
          "Os cartões do portal marcam “Sem acesso” nos módulos que a sua conta não abre, antes de você bater na porta.",
          "“Entrar com usuário”, nos três módulos, abre a mesma tela de entrada do portal — antes cada módulo tinha a sua cópia."
        ],
        "Corrigido": [
          "Quem entrava como usuário via dois botões de sair na Agenda e nas Entradas; agora a saída é uma só, pelo menu do seu nome.",
          "O aviso de erro do formulário de usuários ficava sem fundo no tema claro."
        ],
        "Visual": [
          "A tela de entrar por usuário, o menu do seu nome e o avatar acompanham o tema claro e escuro em todas as páginas."
        ],
        "Técnico": [
          "As senhas continuam só no servidor: o navegador guarda apenas o token da sessão, o seu nome, a sua foto e a data do último uso.",
          "Entrar pelo portal não dá acesso a módulo nenhum por si: o servidor confere a permissão em toda leitura e gravação, e tirar um módulo de alguém corta o acesso na chamada seguinte.",
          "Aba Usuarios_Fotos nova na planilha, criada sozinha, com a imagem já reduzida a um quadrado de 128 px — uns 8 KB por pessoa."
        ]
      }
    },
    {
      versao: "2.9.0",
      codinome: "REBROTA",
      data: "24/08/2026",
      mudancas: {
        "Adicionado": [
          "Lixeira: o que você exclui no CRM, na Agenda e nas Entradas passa a ficar guardado por 30 dias antes de sumir de vez.",
          "Área de Lixeira no painel de manutenção, com busca, filtro por módulo e por prazo, e ordenação por data, por prazo ou por nome.",
          "Botão Restaurar em cada registro guardado: a ficha volta inteira, com o mesmo código e tudo o que dependia dela.",
          "Campo de motivo, opcional, na hora de excluir — fica registrado junto e ajuda a lembrar por que aquilo saiu.",
          "Botão “Limpar expirados” no painel, que mostra quantos venceram antes de apagar."
        ],
        "Alterado": [
          "Excluir agora é “mover para a lixeira” nos três módulos, com uma explicação do que acontece antes de confirmar.",
          "Uma paciente movida para a lixeira leva junto os ciclos, as condições, as máquinas, o histórico, os follow-ups e as respostas de vinda — e tudo volta junto na restauração.",
          "Uma entrada movida para a lixeira sai dos totais, dos gráficos e da exportação na hora, e volta a contar quando é restaurada.",
          "Apagar de vez virou uma decisão só do painel de manutenção, com a palavra EXCLUIR digitada por extenso."
        ],
        "Corrigido": [
          "Restaurar um registro cujo lugar já foi ocupado por outro agora avisa antes, em vez de criar dois cadastros iguais sem aviso.",
          "Os avisos em fundo cor de areia da Agenda ficavam quase ilegíveis no tema escuro; agora acompanham o tema."
        ],
        "Técnico": [
          "Aba Lixeira nova na planilha, criada sozinha na primeira vez, com o registro inteiro guardado e a assinatura de quem excluiu.",
          "Só o painel de manutenção apaga de vez ou limpa vencidos, e o servidor confere isso em toda chamada — esconder o botão não basta.",
          "Mover, restaurar e apagar de vez ficam registrados nos logs, com o nome de quem fez, sem levar junto os dados da ficha."
        ]
      }
    },
    {
      versao: "2.8.0",
      codinome: "CANTEIRO",
      data: "23/08/2026",
      mudancas: {
        "Adicionado": [
          "Entrada por usuário individual nos três módulos, no botão “Entrar com usuário” logo abaixo do campo de senha. Cada pessoa tem o seu login e só abre os módulos que você liberar.",
          "Área de Usuários no painel de manutenção: criar, editar, redefinir senha, desativar e reativar, com busca e a lista de quem entrou pela última vez.",
          "Depois de entrar como usuário, o nome aparece no alto da tela e abre um menu com os módulos liberados e o botão de sair."
        ],
        "Alterado": [
          "Quem entra por usuário continua entrando por sete dias sem precisar digitar de novo, mesmo fechando o navegador — o prazo é renovado a cada uso e só vence depois de sete dias parado.",
          "Entrar num módulo vale para os outros: quem tem acesso aos três passa de um para o outro sem nova senha.",
          "A senha compartilhada de cada módulo continua funcionando exatamente como antes, para quem preferir."
        ],
        "Técnico": [
          "As senhas dos usuários nunca são guardadas: a planilha grava só um resumo embaralhado, com tempero individual e do servidor, repetido milhares de vezes.",
          "O servidor confere a pessoa, o prazo e a permissão em toda leitura e gravação — tirar um módulo de alguém corta o acesso na chamada seguinte, e desativar ou trocar a senha encerra as sessões abertas.",
          "Duas abas novas na planilha, Usuarios e Usuarios_Sessoes, criadas sozinhas na primeira vez."
        ]
      }
    },
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
