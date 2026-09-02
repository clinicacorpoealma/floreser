/* =====================================================================
   FloreSer · Corpo e Alma — comportamento da Agenda
   ---------------------------------------------------------------------
   As pacientes, os ciclos de retorno por área, os agendamentos, os
   follow-ups, as condições, as máquinas e suas vindas, o arquivamento, o
   histórico, a auditoria, a integração com o CRM, a exportação e a
   importação em Excel, a sincronização com a planilha e a conciliação de
   conflitos.

   A apresentação fica no agenda.css; a estrutura, no index.html.

   Depende, nesta ordem, de tema.js, version.js, logs.js, pwa.js, auth.js,
   sync.js, auditoria.js e do SheetJS em vendor/ — e por isso entra depois
   de todos eles, no mesmo ponto do documento onde o <script> estava: no
   fim do <body>, com o markup já montado.
   ===================================================================== */

'use strict';

/* ==========================================================
   ÍCONES (traço fino, conforme manual)
   ========================================================== */
const SVG = (d,sz,extra)=>'<svg width="'+(sz||14)+'" height="'+(sz||14)+'" viewBox="0 0 24 24" '+
  'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" '+
  'stroke-linejoin="round"'+(extra||'')+'>'+d+'</svg>';
const I = {
  cal:  s=>SVG('<rect x="3" y="4.5" width="18" height="16" rx="1.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',s),
  clock:s=>SVG('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',s),
  check:s=>SVG('<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',s),
  x:    s=>SVG('<path d="M6 6l12 12M18 6L6 18"/>',s),
  plus: s=>SVG('<path d="M12 5v14M5 12h14"/>',s),
  edit: s=>SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',s),
  trash:s=>SVG('<path d="M3.5 6.5h17M9 6.5V4.2A1.2 1.2 0 0 1 10.2 3h3.6A1.2 1.2 0 0 1 15 4.2v2.3"/><path d="M5.5 6.5 6.8 20a1.2 1.2 0 0 0 1.2 1h8a1.2 1.2 0 0 0 1.2-1L18.5 6.5"/>',s),
  warn: s=>SVG('<path d="M12 3.8 21.2 20H2.8L12 3.8Z"/><path d="M12 10v4.2M12 17.3v.1"/>',s),
  info: s=>SVG('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 8v.1"/>',s),
  user: s=>SVG('<path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6"/><circle cx="12" cy="7.5" r="3.8"/>',s),
  loop: s=>SVG('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5V7h-3.5"/>',s),
  bell: s=>SVG('<path d="M18 9a6 6 0 1 0-12 0c0 5-2.2 6.5-2.2 6.5h16.4S18 14 18 9Z"/><path d="M10.2 19a2 2 0 0 0 3.6 0"/>',s),
  plane:s=>SVG('<path d="M20.5 3.5c.8.8-.4 3-2.2 4.9L15 11.8l1.4 7.2-1.6 1.6-3-6.2-3.2 3.2.3 2.6-1.2 1.2-1.5-3.1-3.1-1.5 1.2-1.2 2.6.3L10 13.4l-6.2-3 1.6-1.6L12.6 10l3.2-3.3c1.9-1.8 4-3 4.7-2.2Z"/>',s),
  down: s=>SVG('<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M5 19h14"/>',s),
  up:   s=>SVG('<path d="M12 19V8m0 0-4 4m4-4 4 4"/><path d="M5 4h14"/>',s),
  eye:  s=>SVG('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',s),
  lupa: s=>SVG('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',s),
  caixa:s=>SVG('<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M4.8 9v9.5A1.5 1.5 0 0 0 6.3 20h11.4a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',s),
  volta:s=>SVG('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 3.5V7h3.5"/>',s),
  maq:  s=>SVG('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3.4M12 17.8v3.4M4.7 4.7l2.4 2.4M16.9 16.9l2.4 2.4M2.8 12h3.4M17.8 12h3.4M4.7 19.3l2.4-2.4M16.9 7.1l2.4-2.4"/>',s),
  rosto:s=>SVG('<circle cx="12" cy="12" r="8.6"/><path d="M9 10.2v.1M15 10.2v.1M8.8 14.6c.9 1.2 1.9 1.8 3.2 1.8s2.3-.6 3.2-1.8"/>',s),
  corpo:s=>SVG('<circle cx="12" cy="4.6" r="2"/><path d="M12 7v7M12 14l-2.6 6.4M12 14l2.6 6.4M6.6 9.2 12 10.4l5.4-1.2"/>',s),
  cabelo:s=>SVG('<path d="M5.5 13.5C5.5 8.2 8.4 4.5 12 4.5s6.5 3.7 6.5 9"/><path d="M8 13c0-3.4 1.6-5.6 4-5.6s4 2.2 4 5.6"/><path d="M5.5 13.5c0 3.4-.7 5.4-2 6M18.5 13.5c0 3.4.7 5.4 2 6"/>',s)
};

/* ==========================================================
   DATAS  (strings AAAA-MM-DD, sempre no fuso local)
   ========================================================== */
const p2 = n=>(n<10?'0':'')+n;
const DIAS  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const DIAS3 = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
               'setembro','outubro','novembro','dezembro'];
const D = {
  hoje(){ return D.s(new Date()); },
  s(d){ return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); },
  o(s){ const a=String(s).split('-'); return new Date(+a[0],+a[1]-1,+a[2],12,0,0); },
  add(s,n){ const d=D.o(s); d.setDate(d.getDate()+n); return D.s(d); },
  dif(a,b){ return Math.round((D.o(b)-D.o(a))/864e5); },
  br(s){ if(!s) return '—'; const a=s.split('-'); return a[2]+'/'+a[1]+'/'+a[0]; },
  brc(s){ if(!s) return '—'; const a=s.split('-'); return a[2]+'/'+a[1]; },
  dow(s){ return DIAS[D.o(s).getDay()]; },
  dow3(s){ return DIAS3[D.o(s).getDay()]; },
  longa(s){ const d=D.o(s); return d.getDate()+' de '+MESES[d.getMonth()]+' de '+d.getFullYear(); },
  ok(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s||''); }
};
function relativo(alvo,hoje){
  const n=D.dif(hoje,alvo);
  if(n===0) return 'hoje';
  if(n===1) return 'amanhã';
  if(n===-1) return 'ontem';
  if(n>1)  return 'em '+n+' dias';
  return 'há '+(-n)+' dias';
}

/* ==========================================================
   ÁREAS DE TRATAMENTO
   ----------------------------------------------------------
   Cada paciente pode ter um ciclo próprio em cada área —
   Facial de 15 dias e Corporal de 7, por exemplo — ou ter
   apenas uma delas.
   ========================================================== */
const AREAS=[
  {k:'facial',  nome:'Facial',  cor:'#3B6E6A', ic:I.rosto},
  {k:'corporal',nome:'Corporal',cor:'#B08968', ic:I.corpo},
  {k:'capilar', nome:'Capilar', cor:'#8C9A72', ic:I.cabelo}
];
const AREAK=AREAS.map(a=>a.k);

/* As mesmas origens do CRM, para uma paciente que veio de lá manter o
   rótulo que já tinha. Lista curta e igual dos dois lados. */
const ORIGENS=[
  {id:'instagram',nome:'Instagram'},
  {id:'radio',nome:'Rádio'},
  {id:'vale_presente',nome:'Vale-presente'},
  {id:'indicacao',nome:'Indicação'},
  {id:'google',nome:'Google'},
  {id:'outros',nome:'Outros'}
];
function nomeOrigem(id){ const o=ORIGENS.find(x=>x.id===id); return o?o.nome:''; }
function area(k){ return AREAS.find(a=>a.k===k)||{k:k,nome:k,cor:'#A39384',ic:I.info}; }

/* ==========================================================
   ESTADO E ARMAZENAMENTO
   ========================================================== */
/* Endereco do Apps Script publicado (o mesmo que atende o CRM) */
var URL_API = "https://script.google.com/macros/s/AKfycbzy9WCfP4l08dn2h2K34uEL6e0mqFBjVMugcHiTc0oUGmpS7gOJjbxs58CB87AoFUw-/exec";

/* O que fica guardado neste aparelho é um token de sessão, não a senha:
   ele é emitido pelo servidor, vale só para a agenda, expira sozinho por
   inatividade e pode ser cancelado sem afetar nenhum outro aparelho. */
const CHAVE_TOKEN='floreser.agenda.sessao';
const SESSAO={token:'',rev:0};
let state = {pacientes:[], categorias:[], followups:[], maquinas:[], vindas:[],
             criado:null, seedMaq:false};

function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

/* Ler pode ser repetido sem consequência; gravar, não — quem grava tem a
   revisão em mãos e cuida do próprio reenvio. O que se ganha aqui é o
   tropeço do redirecionamento do Apps Script, que devolve 404 de vez em
   quando sem nada estar errado. */
async function api(dados){
  if(window.FloreSerRede){
    const so_leitura = String(dados&&dados.acao||'').indexOf('ler')===0;
    return await window.FloreSerRede.postar(dados,{repetir:so_leitura});
  }
  const resposta=await fetch(URL_API,{
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify(dados),
    redirect:'follow'
  });
  return await resposta.json();
}

async function carregar(){
  const r=await api({acao:'ler_agenda',token:SESSAO.token});
  if(!r.ok) throw new Error(r.erro||'falha');
  SESSAO.rev=r.rev;
  const o=r.dados||{};
  state.pacientes  = Array.isArray(o.pacientes)?o.pacientes:[];
  state.categorias = Array.isArray(o.categorias)?o.categorias:[];
  state.followups  = Array.isArray(o.followups)?o.followups:[];
  state.maquinas   = Array.isArray(o.maquinas)?o.maquinas:[];
  state.vindas     = Array.isArray(o.vindas)?o.vindas:[];
  state.seedMaq    = !!o.seedMaq;
  state.criado     = o.criado||D.hoje();
  const primeiraVez = !o.criado || !o.seedMaq;
  state.pacientes.forEach(normalizar);
  state.vindas.forEach(v=>{ v.resp=v.resp||{}; });
  state.followups.forEach(f=>{ if(!f.area) f.area=(areasDe(pac(f.pacienteId)||{})[0])||'facial'; });
  /* o que acabou de chegar é, por definição, o que o servidor tem */
  guardarBase();
  if(!state.seedMaq && !state.maquinas.length){
    state.maquinas=[
      {id:uid(),nome:'Soprano',cadencia:'A cada 3 meses',cor:'#3B6E6A',obs:''},
      {id:uid(),nome:'Harmony',cadencia:'Mensal',cor:'#B08968',obs:''}];
    state.seedMaq=true;
  }
  /* primeira vez: registra a data de inicio e as maquinas que ja vem cadastradas */
  if(primeiraVez) salvar();
}
function normCiclo(c){
  if(!c) return null;
  return {freq:[7,15,30].indexOf(+c.freq)>=0?+c.freq:7,
    ultimo:D.ok(c.ultimo)?c.ultimo:null,
    agendamento:(c.agendamento&&D.ok(c.agendamento.data))?c.agendamento:null,
    adiadaPara:D.ok(c.adiadaPara)?c.adiadaPara:null,
    naoRespondeu:+c.naoRespondeu||0};
}
function normalizar(p){
  p.id=p.id||uid();
  p.nome=String(p.nome||'').trim();
  p.categoriaId=p.categoriaId||null;
  p.obs=p.obs||'';
  p.condicoes=Array.isArray(p.condicoes)?p.condicoes:[];
  p.maquinas=Array.isArray(p.maquinas)?p.maquinas:[];
  p.historico=Array.isArray(p.historico)?p.historico:[];
  p.criadoEm=p.criadoEm||D.hoje();
  p.arquivada=!!p.arquivada;
  p.arquivadaEm=D.ok(p.arquivadaEm)?p.arquivadaEm:null;
  /* cadastro antigo não tem estes três: vazio, sem migração nenhuma */
  p.whatsapp=p.whatsapp||'';
  p.origem=p.origem||'';
  p.crmLeadId=p.crmLeadId||'';
  /* migração do formato antigo (um ciclo único) para ciclos por área */
  if(!p.ciclos||typeof p.ciclos!=='object'){
    p.ciclos={facial:null,corporal:null,capilar:null};
    if(p.freq||p.ultimoAgendamento||p.agendamento){
      p.ciclos.facial={freq:p.freq||7,ultimo:p.ultimoAgendamento||null,
        agendamento:p.agendamento||null,adiadaPara:p.adiadaPara||null,
        naoRespondeu:p.naoRespondeu||0};
    }
  }
  AREAK.forEach(k=>{ p.ciclos[k]=normCiclo(p.ciclos[k]); });
  delete p.freq; delete p.ultimoAgendamento; delete p.agendamento;
  delete p.adiadaPara; delete p.naoRespondeu;
  return p;
}
function novoCiclo(freq,ultimo){
  return {freq:freq,ultimo:ultimo||null,agendamento:null,adiadaPara:null,naoRespondeu:0};
}
/* ---------- Gravação na planilha ----------
   A tela responde na hora e o envio acontece logo atrás, agrupando
   alterações seguidas. Se a internet cair, continua tentando sozinho. */
let sinc='ok';                      // ok - salvando - erro - conflito
let precisaSalvar=false, emVoo=false, travado=false, tentativa=0, timerEnvio=null;

/* A última versão que o servidor confirmou. É ela que diz, na hora de um
   conflito, o que foi mexido aqui e o que foi mexido lá. Vive só na
   memória desta página: nada disto vai para cache nenhum. */
let BASE=null;
let conflitoPendente=false, tentativasDeMerge=0;

const ESQUEMA_AGENDA={ listas:{ pacientes:'id', categorias:'id', followups:'id',
  maquinas:'id', vindas:'id' } };

const ROTULOS_AGENDA={
  campos:{ nome:'Nome', obs:'Observação', ciclos:'Ciclos', condicoes:'Condições',
    maquinas:'Máquinas', historico:'Histórico', arquivada:'Arquivada',
    arquivadaEm:'Arquivada em', criadoEm:'Cadastrada em', data:'Data',
    feito:'Feito', area:'Área', pacienteId:'Paciente', cor:'Cor',
    cadencia:'Cadência', resp:'Respostas' },
  valores:{ area:{ facial:'Facial', corporal:'Corporal', capilar:'Capilar' } },
};

function guardarBase(){ BASE=FloreSerSync.copiar(state); }

function salvar(){
  if(travado) return;
  /* Com conflito aberto o envio para: mandar o estado em disputa por cima
     seria justamente o que se quer evitar. */
  if(conflitoPendente){ precisaSalvar=true; statusRodape(); return; }
  precisaSalvar=true;
  if(sinc!=='erro') sinc='pendente';
  statusRodape();
  clearTimeout(timerEnvio);
  timerEnvio=setTimeout(enviar,350);
}

/* Uma gravação leva a agenda inteira e demora o que a rede demorar. Quem
   edita rápido mexe em outra ficha antes de a anterior voltar — e é aí que
   o rodapé mentia: ele dizia "salvo" no instante em que a resposta chegava,
   sem olhar se algo novo tinha entrado na fila enquanto isso. A pessoa via
   "salvo", fechava a aba e levava um susto com o aviso do navegador.

   Agora o envio anuncia que está no ar, e "salvo" só aparece quando não
   sobrou nada para mandar. */
async function enviar(){
  if(travado||emVoo||!precisaSalvar||conflitoPendente) return;
  emVoo=true; precisaSalvar=false;
  sinc='salvando'; statusRodape();
  const instantaneo=JSON.parse(JSON.stringify(state));
  let deuCerto=false;
  try{
    const r=await api({acao:'salvar_agenda',token:SESSAO.token,rev:SESSAO.rev,dados:instantaneo});
    if(!r.ok){
      if(r.erro==='conflito'){ conflito(r); return; }
      /* não recarrego sozinho: o que estiver aberto agora seria perdido */
      if(r.erro==='sem_acesso'){ travado=true; sinc='erro'; statusRodape();
        toast('Seu acesso a este módulo foi retirado. Recarregue a página.',true); return; }
      if(r.erro==='sessao'||r.erro==='expirada'||r.erro==='inativo'){
        travado=true; sinc='erro'; esquecerToken(); statusRodape();
        toast('Sua sessão expirou. Recarregue a página e informe a senha.',true); return; }
      throw new Error(r.erro||'falha');
    }
    SESSAO.rev=r.rev; tentativa=0; tentativasDeMerge=0; deuCerto=true;
    /* só agora o que está na tela virou o que o servidor tem */
    BASE=instantaneo;
    /* mas "o que o servidor tem" só é "o que está na tela" se nada entrou
       na fila enquanto esta gravação voava */
    if(precisaSalvar){ sinc='pendente'; }
    else { sinc='ok'; if(statusSinc) statusSinc.salvoAgora(); }
  }catch(e){
    precisaSalvar=true; tentativa++; sinc='offline';
    clearTimeout(timerEnvio);
    timerEnvio=setTimeout(enviar, Math.min(20000,2000*tentativa));
    if(tentativa===1) toast('Sem conexão com a planilha — vou tentar de novo.',true);
  }finally{
    emVoo=false;
    statusRodape();
    /* Quem reagenda é o resultado desta gravação, não a cor do rodapé. A
       condição antiga era sinc==='ok', e ela deixou de valer no momento em
       que "salvo" passou a depender da fila: com alteração pendente o
       estado é 'pendente', e o reenvio nunca teria saído. Erro e conflito
       têm caminho próprio e não passam por aqui. */
    if(deuCerto&&precisaSalvar&&!travado&&!conflitoPendente){
      clearTimeout(timerEnvio); timerEnvio=setTimeout(enviar,200);
    }
  }
}

/* O servidor recusou por revisão diferente e mandou junto o estado atual
   dele. Aqui comparamos as três versões: o que só um lado mexeu entra
   sozinho, e só o que os dois mexeram vira pergunta. Nada é recarregado,
   nada é jogado fora. */
async function conflito(resposta){
  const servidor = resposta && resposta.dados;
  if(!servidor){
    /* sem os dados não dá para comparar com segurança */
    sinc='erro'; conflitoPendente=true; statusRodape();
    toast('Outro aparelho alterou os dados. Recarregue para ver a versão mais recente.',true);
    return;
  }

  const local = FloreSerSync.copiar(state);
  const base  = BASE || local;
  const m = FloreSerSync.mesclar(base, local, servidor, ESQUEMA_AGENDA);

  registrarSync('SYNC_CONFLITO_DETECTADO',
    m.conflitos.length+' campo(s) em disputa, '+m.automaticos.length+' conciliado(s) sozinho');

  if(!m.conflitos.length){
    /* nada se cruzou: junta e reenvia com a revisão nova */
    registrarSync('SYNC_CONFLITO_AUTO_MESCLADO', m.automaticos.length+' alteração(ões)');
    await aplicarMerge(m.estado, resposta.rev);
    return;
  }

  conflitoPendente=true; sinc='conflito'; statusRodape();
  FloreSerSync.abrirConflito({
    conflitos:m.conflitos, automaticos:m.automaticos, rotulos:ROTULOS_AGENDA,
    aviso:'A agenda foi alterada em outro aparelho enquanto você trabalhava. '+
      'O que não se cruzou já foi juntado; escolha o que fica no que sobrou.',
    aoResolver: async function(escolhas){
      const fim = FloreSerSync.aplicarEscolhas(m.estado, m.conflitos, escolhas, ESQUEMA_AGENDA);
      const doMeu = escolhas.filter(e=>e==='local').length;
      registrarSync('SYNC_CONFLITO_RESOLVIDO_MANUAL',
        doMeu+' de '+escolhas.length+' campo(s) ficaram com a versão deste aparelho');
      conflitoPendente=false;
      await aplicarMerge(fim, resposta.rev);
    },
    aoCancelar: function(){
      /* fica em conflito, sem perder nada, e dá para reabrir */
      sinc='conflito'; statusRodape();
      toast('Conflito guardado. Toque em "Conflito de alterações", no rodapé, para resolver.');
    },
  });
}

/* Aplica o estado conciliado e tenta gravar com a revisão que o servidor
   informou. Se alguém salvar de novo nesse meio-tempo, recomeça — com
   limite, para não virar laço. */
async function aplicarMerge(estado, rev){
  state = estado;
  SESSAO.rev = rev;
  normalizarTudo();
  tudo();

  tentativasDeMerge++;
  if(tentativasDeMerge>4){
    conflitoPendente=true; sinc='conflito'; statusRodape();
    toast('Os dados continuam sendo alterados por outra pessoa. Revise antes de salvar.',true);
    return;
  }

  conflitoPendente=false;
  precisaSalvar=true; sinc='salvando'; statusRodape();
  /* Chamar enviar() aqui não adiantaria: esta função roda de dentro do
     próprio enviar(), com emVoo ainda ligado, e a chamada voltaria sem
     fazer nada. O envio vai para a fila e sai quando a atual terminar. */
  clearTimeout(timerEnvio);
  timerEnvio=setTimeout(enviar,0);
}

/* depois de um merge, as listas precisam voltar ao formato que a tela espera */
function normalizarTudo(){
  state.pacientes=Array.isArray(state.pacientes)?state.pacientes:[];
  state.categorias=Array.isArray(state.categorias)?state.categorias:[];
  state.followups=Array.isArray(state.followups)?state.followups:[];
  state.maquinas=Array.isArray(state.maquinas)?state.maquinas:[];
  state.vindas=Array.isArray(state.vindas)?state.vindas:[];
  state.pacientes.forEach(normalizar);
  state.vindas.forEach(v=>{ v.resp=v.resp||{}; });
}

function registrarSync(evento, mensagem){
  const r = window.FloreSerLogs && window.FloreSerLogs.registrar;
  if(r) r(evento,{ mensagem: 'agenda · '+mensagem });
}

/* O indicador vem do sync.js e é o mesmo dos três módulos. O rodapé
   continua contando as pacientes, porque essa informação é útil ali. */
let statusSinc=null;

function contagemDoRodape(){
  const arq=arquivadas().length;
  return ativas().length+' pacientes ativas'+(arq?' · '+arq+' arquivadas':'');
}

function statusRodape(){
  const el=document.getElementById('foot-status');
  if(!el) return;
  if(!statusSinc){
    statusSinc=FloreSerSync.criarStatus(el,{ extra:contagemDoRodape });
    /* com conflito guardado, tocar no rodapé reabre a resolução */
    el.style.cursor='pointer';
    el.addEventListener('click',function(){
      if(sinc!=='conflito'||FloreSerSync.conflitoAberto()) return;
      if(!FloreSerSync.reabrirConflito()){
        /* Sem nada guardado: uma gravação nova traz o conflito de volta.
           O contador de merges também zera — ele existe para travar um
           vaivém automático, e este toque é uma pessoa decidindo tentar
           outra vez. Sem zerar, a tentativa seguinte esbarraria no limite
           e o rodapé viraria um botão que não faz nada. */
        tentativasDeMerge=0;
        precisaSalvar=true; conflitoPendente=false; enviar();
      }
    });
  }

  const mapa={ ok:'salvo', salvando:'salvando', pendente:'pendente',
    offline:'offline', erro:'erro', conflito:'conflito' };
  let estado=mapa[sinc]||'salvo';
  if(travado) estado = sinc==='erro' ? 'expirado' : estado;
  if(estado==='salvo'&&!statusSinc.salvoEm()) statusSinc.salvoAgora();
  else statusSinc.definir(estado);
  el.style.color = (estado==='erro'||estado==='conflito'||estado==='expirado')
    ? 'var(--alerta)' : '';
}

/* Evita fechar a aba com alteração ainda nao enviada */
window.addEventListener('beforeunload',e=>{
  if(!travado&&(precisaSalvar||emVoo||conflitoPendente)){ e.preventDefault(); e.returnValue=''; }
});

/* ==========================================================
   CONSULTAS BÁSICAS
   ========================================================== */
function pac(id){ return state.pacientes.find(p=>p.id===id)||null; }
function ativas(){ return state.pacientes.filter(p=>!p.arquivada); }
function arquivadas(){ return state.pacientes.filter(p=>p.arquivada); }
function cat(id){ return state.categorias.find(c=>c.id===id)||null; }
function ciclo(p,k){ return (p&&p.ciclos&&p.ciclos[k])||null; }
function areasDe(p){ return AREAK.filter(k=>ciclo(p,k)); }
function fuPendentes(){
  return state.followups.filter(f=>{ const p=pac(f.pacienteId); return !f.feito&&p&&!p.arquivada; });
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,
  m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* ==========================================================
   MOTOR DE PRAZOS (por área)
   ========================================================== */
function condEm(p,data){
  return (p.condicoes||[]).find(c=>D.ok(c.inicio)&&D.ok(c.fim)&&data>=c.inicio&&data<=c.fim)||null;
}
function empurrar(p,data){
  let cond=null,g=0,d=data;
  while(g++<24){ const c=condEm(p,d); if(!c) break; cond=c; d=D.add(c.fim,1); }
  return {data:d,cond:cond};
}
/*
  Estados de um ciclo:
    agendado     — sessão marcada para data futura
    sessao_hoje  — a sessão marcada é hoje
    pendente     — precisa ser agendada (aparece no Dashboard)
    aguardando   — dentro do ciclo, ainda não chegou a hora
*/
function resolver(p,k,hoje){
  const c=ciclo(p,k); if(!c) return null;
  const r={area:k,freq:c.freq,estado:'',prazo:null,aparece:null,cond:null,atraso:0,
           primeiro:!c.ultimo&&!c.agendamento};

  if(c.agendamento && c.agendamento.data>=hoje){
    r.estado = c.agendamento.data===hoje?'sessao_hoje':'agendado';
    r.prazo  = c.agendamento.data;
    return r;
  }
  let prazo,aparece;
  if(!c.ultimo){ prazo=hoje; aparece=hoje; }
  else { prazo=D.add(c.ultimo,c.freq); aparece=D.add(prazo,-1); }

  const emp=empurrar(p,prazo);
  if(emp.cond){ r.cond=emp.cond; prazo=emp.data; aparece=D.add(prazo,-1); }
  else {
    const ch=condEm(p,hoje);
    if(ch && aparece<=hoje){ r.cond=ch; aparece=D.add(ch.fim,1);
      if(prazo<aparece) prazo=aparece; }
  }
  if(c.adiadaPara && c.adiadaPara>aparece) aparece=c.adiadaPara;

  r.prazo=prazo; r.aparece=aparece;
  r.estado = aparece<=hoje?'pendente':'aguardando';
  if(c.ultimo && hoje>prazo) r.atraso=D.dif(prazo,hoje);
  return r;
}
/* Fecha automaticamente ciclos cuja sessão já passou */
function maturar(){
  const hoje=D.hoje(); let mudou=false;
  state.pacientes.forEach(p=>{
    AREAK.forEach(k=>{
      const c=ciclo(p,k); if(!c) return;
      if(c.agendamento && c.agendamento.data<hoje){
        c.ultimo=c.agendamento.data;
        p.historico.push({tipo:'sessao',area:k,data:c.agendamento.data,em:hoje});
        c.agendamento=null; c.adiadaPara=null; c.naoRespondeu=0;
        mudou=true;
      }
      if(c.adiadaPara && c.adiadaPara<hoje){ c.adiadaPara=null; mudou=true; }
    });
  });
  if(mudou) salvar();
}

/* ==========================================================
   MÁQUINAS TEMPORÁRIAS
   ----------------------------------------------------------
   Equipamentos que vêm de fora, ficam um dia e não têm data
   fixa. A lista de agendamento de cada vinda abre sozinha
   14 dias antes da data prevista.
   ========================================================== */
const ANTECEDENCIA=14;

function maq(id){ return state.maquinas.find(m=>m.id===id)||null; }
function abreEm(v){ return D.add(v.data,-ANTECEDENCIA); }
function vindaAberta(v,hoje){ return v.data>=hoje && hoje>=abreEm(v); }
function vindasAbertas(hoje){
  return state.vindas.filter(v=>maq(v.maquinaId)&&vindaAberta(v,hoje))
    .sort((a,b)=>a.data.localeCompare(b.data));
}
function vindasDa(mid,futurasSo){
  const hoje=D.hoje();
  return state.vindas.filter(v=>v.maquinaId===mid&&(!futurasSo||v.data>=hoje))
    .sort((a,b)=>a.data.localeCompare(b.data));
}
function proximaVindaApos(mid,data){
  return state.vindas.filter(v=>v.maquinaId===mid&&v.data>data)
    .sort((a,b)=>a.data.localeCompare(b.data))[0]||null;
}
function pacientesDaMaquina(mid){
  return state.pacientes.filter(p=>!p.arquivada&&(p.maquinas||[]).indexOf(mid)>=0)
    .sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
}
function statusMaq(v,p,hoje){
  const r=(v.resp||{})[p.id]||null;
  if(r&&r.status==='agendada') return {tipo:'agendada',r:r,cond:condEm(p,v.data)};
  if(r&&r.status==='proxima')  return {tipo:'proxima',r:r};
  const c=condEm(p,v.data);
  if(c) return {tipo:'cond',cond:c};
  if(r&&r.status==='nao_respondeu'&&r.adiadaPara&&r.adiadaPara>hoje)
    return {tipo:'adiada',r:r};
  return {tipo:'pendente',r:r};
}
function grupoVinda(v,hoje){
  const g={v:v,m:maq(v.maquinaId),pendentes:[],agendadas:[],proximas:[],conds:[],adiadas:[],total:0};
  pacientesDaMaquina(v.maquinaId).forEach(p=>{
    const s=statusMaq(v,p,hoje); g.total++;
    ({agendada:g.agendadas,proxima:g.proximas,cond:g.conds,
      adiada:g.adiadas,pendente:g.pendentes})[s.tipo].push({p:p,s:s});
  });
  return g;
}
function maqPendentes(hoje){
  const grupos=vindasAbertas(hoje).map(v=>grupoVinda(v,hoje));
  return {grupos:grupos,total:grupos.reduce((n,g)=>n+g.pendentes.length,0)};
}
function mrSet(vid,pid,obj){
  const v=state.vindas.find(x=>x.id===vid); if(!v) return null;
  v.resp=v.resp||{};
  if(obj===null) delete v.resp[pid]; else v.resp[pid]=obj;
  return v;
}
function mrConfirmar(vid,pid){
  const v=mrSet(vid,pid,{status:'agendada',em:D.hoje()});
  if(!v) return;
  const p=pac(pid), m=maq(v.maquinaId);
  if(p) p.historico.push({tipo:'maq_agendou',data:v.data,em:D.hoje(),maquina:m?m.nome:''});
  salvar(); tudo();
  toast(p.nome+' confirmada para '+(m?m.nome:'a máquina')+' em '+D.br(v.data)+'.');
}
function mrNaoRespondeu(vid,pid){
  const v=state.vindas.find(x=>x.id===vid); if(!v) return;
  const ant=(v.resp||{})[pid];
  mrSet(vid,pid,{status:'nao_respondeu',adiadaPara:D.add(D.hoje(),1),em:D.hoje(),
    vezes:((ant&&ant.vezes)||0)+1});
  salvar(); tudo();
  toast(pac(pid).nome+' volta para esta lista amanhã.');
}
function mrProxima(vid,pid){
  const v=state.vindas.find(x=>x.id===vid); if(!v) return;
  const m=maq(v.maquinaId);
  const prox=proximaVindaApos(v.maquinaId,v.data);
  mrSet(vid,pid,{status:'proxima',em:D.hoje()});
  const p=pac(pid);
  if(p) p.historico.push({tipo:'maq_proxima',data:v.data,em:D.hoje(),maquina:m?m.nome:''});
  salvar(); tudo();
  toast(p.nome+(prox
    ? ' fica para a próxima vinda, em '+D.br(prox.data)+'.'
    : ' fica para a próxima vinda de '+(m?m.nome:'')+' — cadastre a data quando souber.'));
}

/* ==========================================================
   PEÇAS DE INTERFACE
   ========================================================== */
function selArea(k,c,semFreq){
  const a=area(k);
  return '<span class="badge cat" style="background:'+a.cor+'22"><i style="background:'+a.cor+
    '"></i>'+a.nome+(c&&!semFreq?' &middot; '+c.freq+' dias':'')+'</span>';
}
function selCiclos(p){
  const as=areasDe(p);
  if(!as.length) return '<span class="badge soft">'+((p.maquinas||[]).length
    ?'Só máquinas':'Sem ciclo')+'</span>';
  return as.map(k=>selArea(k,ciclo(p,k))).join('');
}
function selCat(p){
  const c=cat(p.categoriaId); if(!c) return '';
  return '<span class="badge cat" style="background:'+c.cor+'22"><i style="background:'+
    c.cor+'"></i>'+esc(c.nome)+'</span>';
}
function selMaqs(p){
  return (p.maquinas||[]).map(mid=>{ const m=maq(mid); return m?seloMaq(m):''; }).join('');
}
function seloMaq(m,extra){
  return '<span class="badge cat" style="background:'+m.cor+'22"><i style="background:'+
    m.cor+'"></i>'+esc(m.nome)+(extra||'')+'</span>';
}
function selCond(p,hoje){
  const c=condEm(p,hoje); if(!c) return '';
  return '<span class="badge warn">'+I.plane(11)+' '+esc(c.texto||'Indisponível')+
    ' até '+D.brc(c.fim)+'</span>';
}
function linha(icone,txt){
  return '<div class="row">'+icone+'<div>'+txt+'</div></div>';
}
function avisoCond(r){
  if(!r||!r.cond) return '';
  return '<div class="note warn" style="margin-top:13px;padding:11px 13px;font-size:12px">'+
    I.warn(14)+'<div><b>Prazo adiado automaticamente.</b> '+esc(r.cond.texto||'Indisponível')+
    ' de '+D.brc(r.cond.inicio)+' a '+D.brc(r.cond.fim)+
    ' — novo alvo em '+D.br(r.prazo)+'.</div></div>';
}
function vazio(marca,titulo,texto,botao){
  return '<div class="empty"><div class="mk">'+marca+'</div><h4>'+titulo+'</h4><p>'+texto+'</p>'+
    (botao||'')+'</div>';
}
function bloco(titulo,contagem,itens,dica,accent){
  return '<div class="block'+(accent?' accent':'')+'"><div class="block-head"><h3>'+titulo+'</h3>'+
    (contagem!=null?'<span class="count">'+contagem+'</span>':'')+
    (dica?'<span class="hint">'+dica+'</span>':'')+
    '</div>'+itens+'</div>';
}
function stat(n,rot,cls){
  return '<div class="stat '+(cls||'')+'"><b>'+n+'</b><span>'+rot+'</span></div>';
}

/* ---------- Cartão: ciclo pendente de agendamento ---------- */
function cardPend(o,hoje){
  const p=o.p,k=o.k,r=o.r,c=ciclo(p,k),a=area(k);
  const atraso=r.atraso>0;
  let selos=selArea(k,c)+selCat(p);
  if(r.primeiro) selos+='<span class="badge first">'+I.plus(11)+' Primeiro agendamento</span>';
  else if(atraso) selos+='<span class="badge late">'+I.warn(11)+' '+r.atraso+
    (r.atraso===1?' dia de atraso':' dias de atraso')+'</span>';
  else selos+='<span class="badge due">'+I.cal(11)+' Prazo '+D.brc(r.prazo)+'</span>';
  if(c.naoRespondeu>0) selos+='<span class="badge soft">Sem resposta '+c.naoRespondeu+'&times;</span>';
  selos+=selCond(p,hoje);

  let corpo='';
  if(r.primeiro){
    corpo+=linha(a.ic(13),'Ciclo <b>'+a.nome.toLowerCase()+'</b> de '+c.freq+
      ' dias — ainda sem histórico.');
  } else {
    corpo+=linha(I.cal(13),'Prazo de retorno em <b>'+D.br(r.prazo)+'</b> · '+relativo(r.prazo,hoje));
    corpo+=linha(a.ic(13),a.nome+' · último atendimento em '+D.br(c.ultimo)+
      ' · ciclo de '+c.freq+' dias');
  }
  const outras=areasDe(p).filter(x=>x!==k);
  if(outras.length) corpo+=linha(I.info(13),'Também faz '+outras.map(x=>area(x).nome+
    ' ('+ciclo(p,x).freq+'d)').join(' e ')+'.');

  return '<div class="card '+(atraso?'flag':(r.primeiro?'first':''))+
    '" style="border-left:3px solid '+a.cor+'">'+
    '<div class="card-top"><div class="card-name">'+esc(p.nome)+'</div></div>'+
    '<div class="card-meta">'+selos+'</div>'+
    '<div class="card-body">'+corpo+'</div>'+
    avisoCond(r)+
    (p.obs?'<div class="card-obs">'+esc(p.obs)+'</div>':'')+
    '<div class="card-acts">'+
      '<button class="btn p" data-act="agendar" data-id="'+p.id+'" data-a="'+k+'">'+
        I.cal(13)+' Agendado para dia…</button>'+
      '<button class="btn g" data-act="naoresp" data-id="'+p.id+'" data-a="'+k+'">'+
        I.x(13)+' Não respondeu</button>'+
      '<button class="btn q" data-act="ver" data-id="'+p.id+'" title="Ver ficha">'+I.eye(14)+'</button>'+
    '</div></div>';
}

/* ---------- Cartão: follow-up ---------- */
function cardFU(f,hoje){
  const p=pac(f.pacienteId); if(!p) return '';
  const dias=D.dif(f.data,hoje);
  const a=area(f.area||areasDe(p)[0]||'facial');
  const selo = dias>0
    ? '<span class="badge late">'+I.warn(11)+' '+dias+(dias===1?' dia atrás':' dias atrás')+'</span>'
    : '<span class="badge due">'+I.bell(11)+' Follow-up de hoje</span>';
  return '<div class="card flag">'+
    '<div class="card-top"><div class="card-name">'+esc(p.nome)+'</div></div>'+
    '<div class="card-meta">'+selo+selArea(a.k,null,true)+selCat(p)+selCond(p,hoje)+'</div>'+
    '<div class="card-body">'+
      linha(I.bell(13),'Follow-up marcado para <b>'+D.br(f.data)+'</b>')+
      (f.agendamentoData?linha(I.cal(13),'Referente à sessão '+a.nome.toLowerCase()+' de '+
        D.br(f.agendamentoData)):'')+
    '</div>'+
    (p.obs?'<div class="card-obs">'+esc(p.obs)+'</div>':'')+
    '<div class="card-acts">'+
      '<button class="btn p" data-act="fu-feito" data-id="'+f.id+'">'+I.check(13)+' Follow-up feito</button>'+
      '<button class="btn g" data-act="fu-adiar" data-id="'+f.id+'">'+I.clock(13)+' Adiar 1 dia</button>'+
      '<button class="btn q" data-act="fu-remover" data-id="'+f.id+'" title="Remover">'+I.trash(14)+'</button>'+
    '</div></div>';
}

/* ---------- Cartão: sessão marcada ---------- */
function cardSessao(o,hoje){
  const p=o.p,k=o.k,c=ciclo(p,k),a=area(k),ag=c.agendamento;
  const fu=state.followups.find(f=>f.pacienteId===p.id&&f.area===k&&!f.feito);
  return '<div class="card" style="border-left:3px solid '+a.cor+'">'+
    '<div class="card-top"><div class="card-name">'+esc(p.nome)+'</div></div>'+
    '<div class="card-meta">'+
      '<span class="badge ok">'+I.check(11)+' '+(ag.data===hoje?'Sessão hoje':'Agendada')+'</span>'+
      selArea(k,c)+selCat(p)+
      (fu?'<span class="badge soft">'+I.bell(11)+' Follow-up '+D.brc(fu.data)+'</span>':'')+
    '</div>'+
    '<div class="card-body">'+
      linha(I.cal(13),'<b>'+D.br(ag.data)+'</b> · '+D.dow(ag.data)+' · '+relativo(ag.data,hoje))+
      (fu?linha(I.bell(13),'Follow-up em '+D.br(fu.data)+' · '+relativo(fu.data,hoje))
         :linha(I.info(13),'Sem follow-up definido'))+
    '</div>'+
    (p.obs?'<div class="card-obs">'+esc(p.obs)+'</div>':'')+
    '<div class="card-acts">'+
      '<button class="btn g" data-act="agendar" data-id="'+p.id+'" data-a="'+k+'">'+
        I.edit(13)+' Alterar</button>'+
      '<button class="btn q" data-act="desmarcar" data-id="'+p.id+'" data-a="'+k+'">'+
        I.x(14)+' Desmarcar</button>'+
    '</div></div>';
}

/* ---------- Cartão: paciente pendente numa vinda de máquina ---------- */
function cardMaqPend(o,v,m,hoje){
  const p=o.p, r=o.s.r;
  const prox=proximaVindaApos(m.id,v.data);
  const dias=D.dif(hoje,v.data);
  let selos=seloMaq(m)+selCiclos(p)+selCat(p);
  if(r&&r.status==='nao_respondeu')
    selos+='<span class="badge soft">Sem resposta '+(r.vezes||1)+'&times;</span>';
  return '<div class="card" style="border-left:3px solid '+m.cor+'">'+
    '<div class="card-top"><div class="card-name">'+esc(p.nome)+'</div></div>'+
    '<div class="card-meta">'+selos+'</div>'+
    '<div class="card-body">'+
      linha(I.maq(13),'<b>'+esc(m.nome)+'</b> vem em <b>'+D.br(v.data)+'</b> · '+
        D.dow(v.data)+' · '+(dias===0?'hoje':relativo(v.data,hoje)))+
      (v.obs?linha(I.info(13),esc(v.obs)):'')+
    '</div>'+
    (p.obs?'<div class="card-obs">'+esc(p.obs)+'</div>':'')+
    '<div class="card-acts">'+
      '<button class="btn p" data-act="mr-conf" data-v="'+v.id+'" data-id="'+p.id+'">'+
        I.check(13)+' Confirmar para '+D.brc(v.data)+'</button>'+
      '<button class="btn g" data-act="mr-nresp" data-v="'+v.id+'" data-id="'+p.id+'">'+
        I.x(13)+' Não respondeu</button>'+
      '<button class="btn g" data-act="mr-prox" data-v="'+v.id+'" data-id="'+p.id+'" title="'+
        (prox?'Próxima vinda em '+D.br(prox.data):'Ainda sem próxima data cadastrada')+'">'+
        I.loop(13)+' Próxima vinda</button>'+
      '<button class="btn q" data-act="ver" data-id="'+p.id+'" title="Ficha">'+I.eye(14)+'</button>'+
    '</div></div>';
}

/* ==========================================================
   DASHBOARD
   ========================================================== */
function coletar(hoje){
  const out={pendentes:[],primeiros:[],aguardando:[],agendadas:[],sessoesHoje:[],mapa:{}};
  ativas().forEach(p=>{
    areasDe(p).forEach(k=>{
      const r=resolver(p,k,hoje);
      out.mapa[p.id+'|'+k]=r;
      const o={p:p,k:k,r:r};
      if(r.estado==='pendente') (r.primeiro?out.primeiros:out.pendentes).push(o);
      else if(r.estado==='sessao_hoje') out.sessoesHoje.push(o);
      else if(r.estado==='agendado') out.agendadas.push(o);
      else out.aguardando.push(o);
    });
  });
  const ord=(a,b)=>(b.r.atraso-a.r.atraso)||a.r.prazo.localeCompare(b.r.prazo)||
    a.p.nome.localeCompare(b.p.nome,'pt-BR');
  out.pendentes.sort(ord);
  out.primeiros.sort((a,b)=>a.p.nome.localeCompare(b.p.nome,'pt-BR'));
  out.fuHoje=fuPendentes().filter(f=>f.data<=hoje).sort((a,b)=>a.data.localeCompare(b.data));
  return out;
}

function blocoMaquinas(hoje){
  const mp=maqPendentes(hoje);
  if(!mp.grupos.length) return '';
  let out='';
  mp.grupos.forEach(g=>{
    const v=g.v,m=g.m;
    const dias=D.dif(hoje,v.data);
    const quando = dias===0?'chega hoje':(dias===1?'chega amanhã':'chega em '+dias+' dias');
    const resumo=[];
    if(g.agendadas.length) resumo.push('<b>'+g.agendadas.length+'</b> confirmada'+
      (g.agendadas.length>1?'s':'')+': '+g.agendadas.map(x=>esc(x.p.nome)).join(', '));
    if(g.proximas.length) resumo.push('<b>'+g.proximas.length+'</b> para a próxima vinda: '+
      g.proximas.map(x=>esc(x.p.nome)).join(', '));
    if(g.conds.length) resumo.push('<b>'+g.conds.length+'</b> em condição no dia, '+
      'passaram para a próxima vinda: '+g.conds.map(x=>esc(x.p.nome)+' ('+
      esc(x.s.cond.texto)+')').join(', '));
    if(g.adiadas.length) resumo.push('<b>'+g.adiadas.length+'</b> sem resposta, '+
      'volta'+(g.adiadas.length>1?'m':'')+' amanhã: '+g.adiadas.map(x=>esc(x.p.nome)).join(', '));

    const corpo = g.pendentes.length
      ? '<div class="grid">'+g.pendentes.map(o=>cardMaqPend(o,v,m,hoje)).join('')+'</div>'
      : vazio('&#10003;','Todas resolvidas para esta vinda',
          'Ninguém mais precisa ser contatado para a vinda de '+esc(m.nome)+' em '+D.br(v.data)+'.');

    out+='<div class="block"><div class="block-head">'+
      '<h3>'+esc(m.nome)+' &middot; '+D.br(v.data)+'</h3>'+
      '<span class="count">'+quando+'</span>'+
      '<span class="hint">'+g.pendentes.length+' de '+g.total+' a agendar &middot; lista aberta desde '+
      D.br(abreEm(v))+'</span></div>'+
      corpo+
      (resumo.length?'<div class="note info" style="margin-top:16px">'+I.info(15)+'<div>'+
        resumo.join('<br>')+'</div></div>':'')+
      '</div>';
  });
  return out;
}

function renderDash(){
  const hoje=D.hoje(), c=coletar(hoje);
  const fim=D.add(hoje,6);
  const naSemana = c.pendentes.length+c.primeiros.length+
    c.aguardando.filter(o=>o.r.aparece<=fim).length;
  const fuSemana = fuPendentes().filter(f=>f.data<=fim).length;
  const mp=maqPendentes(hoje);
  const aAgendar=c.pendentes.length+c.primeiros.length;

  document.getElementById('stats').innerHTML =
    stat(aAgendar,'A agendar hoje',aAgendar?'al':'hi')+
    stat(c.fuHoje.length,'Follow-ups hoje',c.fuHoje.length?'al':'')+
    stat(c.sessoesHoje.length,'Sessões hoje','hi')+
    stat(naSemana,'A agendar na semana','')+
    stat(fuSemana,'Follow-ups na semana','')+
    (mp.grupos.length?stat(mp.total,'Máquinas a confirmar',mp.total?'al':''):'')+
    stat(ativas().length,'Pacientes ativas','');
  document.getElementById('pill-dash').textContent = aAgendar+c.fuHoje.length+mp.total;
  document.getElementById('pill-pac').textContent = ativas().length;
  document.getElementById('pill-maq').textContent = vindasAbertas(hoje).length;

  /* ---- HOJE ---- */
  let h='';
  if(!ativas().length){
    h = vazio('&#10047;', arquivadas().length?'Nenhuma paciente ativa no momento'
      :'Nenhuma paciente cadastrada ainda',
      'Comece cadastrando as pacientes que precisam ser agendadas, ou importe sua planilha do Excel.',
      '<button class="btn p" data-act="ir-nova">'+I.plus(13)+' Cadastrar primeira paciente</button> '+
      '<button class="btn g" data-act="ir-imp">'+I.up(13)+' Importar do Excel</button>');
  } else {
    if(c.fuHoje.length)
      h+=bloco('Follow-ups de hoje',c.fuHoje.length+(c.fuHoje.length===1?' contato':' contatos'),
        '<div class="grid">'+c.fuHoje.map(f=>cardFU(f,hoje)).join('')+'</div>',
        'Marque como feito para encerrar',true);

    h+=blocoMaquinas(hoje);

    if(c.primeiros.length)
      h+=bloco('Primeiro agendamento',c.primeiros.length+(c.primeiros.length===1?' ciclo':' ciclos'),
        '<div class="grid">'+c.primeiros.map(o=>cardPend(o,hoje)).join('')+'</div>',
        'Lista inicial — ainda sem histórico');

    h+=bloco('Retornos a agendar',
      c.pendentes.length+(c.pendentes.length===1?' ciclo':' ciclos'),
      c.pendentes.length
        ? '<div class="grid">'+c.pendentes.map(o=>cardPend(o,hoje)).join('')+'</div>'
        : vazio('&#10003;','Tudo em dia por hoje',
            'Nenhum retorno vence hoje ou amanhã. As próximas pacientes aparecem aqui um dia antes do prazo — dê uma olhada na aba Semana para se antecipar.'),
      'Aparecem um dia antes do prazo');

    if(c.sessoesHoje.length)
      h+=bloco('Sessões de hoje',c.sessoesHoje.length+' na agenda',
        '<div class="grid">'+c.sessoesHoje.map(o=>cardSessao(o,hoje)).join('')+'</div>');

    if(c.agendadas.length)
      h+=bloco('Já agendadas',c.agendadas.length+' à frente',
        '<div class="grid">'+c.agendadas
          .sort((a,b)=>ciclo(a.p,a.k).agendamento.data.localeCompare(ciclo(b.p,b.k).agendamento.data))
          .map(o=>cardSessao(o,hoje)).join('')+'</div>',
        'Saem daqui sozinhas depois da sessão');
  }
  document.getElementById('view-hoje').innerHTML=h;

  /* ---- SEMANA ---- */
  let dias='';
  for(let i=0;i<7;i++){
    const d=D.add(hoje,i); let chips='';
    ativas().forEach(p=>{
      areasDe(p).forEach(k=>{
        const r=c.mapa[p.id+'|'+k]; if(!r) return;
        const a=area(k);
        if(r.estado==='pendente'&&i===0)
          chips+=chip(p.id,p.nome,a.nome+' · '+(r.atraso>0?r.atraso+'d de atraso'
            :(r.primeiro?'1º agendamento':'prazo '+D.brc(r.prazo))),
            r.atraso>0?'late':'',a.cor);
        else if(r.estado==='aguardando'&&r.aparece===d)
          chips+=chip(p.id,p.nome,a.nome+' · prazo '+D.brc(r.prazo)+
            (r.cond?' · adiado':(ciclo(p,k).adiadaPara===d?' · não respondeu':'')),'',a.cor);
        else if((r.estado==='agendado'||r.estado==='sessao_hoje')&&r.prazo===d)
          chips+=chip(p.id,p.nome,a.nome+' · sessão marcada','ses',a.cor);
      });
    });
    fuPendentes().forEach(f=>{
      const p=pac(f.pacienteId);
      if(f.data===d||(i===0&&f.data<hoje))
        chips+=chip(p.id,p.nome,'follow-up'+(f.data<hoje?' atrasado':''),'fu');
    });
    state.vindas.forEach(v=>{
      const m=maq(v.maquinaId);
      if(m&&v.data===d) chips+='<button class="chip" style="border-left-color:'+m.cor+
        '" data-act="ir-maq"><span class="cn">'+esc(m.nome)+
        '</span><span class="ck">vinda da máquina</span></button>';
    });
    dias+='<div class="day'+(i===0?' today':'')+'"><div class="day-head">'+
      '<div class="dw">'+D.dow3(d)+(i===0?' · hoje':'')+'</div><div class="dn">'+D.brc(d)+'</div></div>'+
      '<div class="day-body">'+(chips||'<div class="day-empty">—</div>')+'</div></div>';
  }
  document.getElementById('view-semana').innerHTML=
    '<div class="note info" style="margin-bottom:22px">'+I.info(15)+
    '<div>Os sete dias a partir de hoje. Cada ciclo aparece no dia em que entra na lista de '+
    'agendamento — ou seja, <b>um dia antes do prazo dele</b>. Uma paciente com Facial e Corporal '+
    'aparece duas vezes, cada uma no seu prazo. Clique num nome para abrir a ficha.</div></div>'+
    '<div class="week">'+dias+'</div>'+
    legendaSemana();
}
function chip(id,nome,tipo,cls,cor){
  return '<button class="chip '+(cls||'')+'"'+(cor?' style="border-left-color:'+cor+'"':'')+
    ' data-act="ver" data-id="'+id+'">'+
    '<span class="cn">'+esc(nome)+'</span><span class="ck">'+esc(tipo)+'</span></button>';
}
function legendaSemana(){
  const it=(cor,t)=>'<span style="display:inline-flex;align-items:center;gap:7px;font-size:11px;'+
    'font-weight:300;color:var(--taupe)"><i style="width:12px;height:3px;background:'+cor+
    ';display:block;border-radius:2px"></i>'+t+'</span>';
  return '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:18px">'+
    AREAS.map(a=>it(a.cor,a.nome)).join('')+
    it('var(--alerta)','Em atraso')+it('var(--taupe)','Follow-up')+'</div>';
}

/* ==========================================================
   ESTADO DA INTERFACE
   ========================================================== */
const ui={pg:'dash',sub:'hoje',pacSub:'todas',editId:null,busca:'',condTmp:[]};

/* ==========================================================
   PACIENTES
   ========================================================== */
function renderPacSub(){
  const viv=ativas(), arq=arquivadas();
  let h='<button data-ps="todas" class="'+(ui.pacSub==='todas'?'on':'')+'">'+I.user(13)+
    ' Todas <span style="opacity:.65">'+viv.length+'</span></button>';
  state.categorias.forEach(c=>{
    const n=viv.filter(p=>p.categoriaId===c.id).length;
    h+='<button data-ps="'+c.id+'" class="'+(ui.pacSub===c.id?'on':'')+'">'+
      '<i style="width:8px;height:8px;border-radius:50%;background:'+c.cor+';display:block"></i>'+
      esc(c.nome)+' <span style="opacity:.65">'+n+'</span></button>';
  });
  const sc=viv.filter(p=>!cat(p.categoriaId)).length;
  if(sc&&state.categorias.length)
    h+='<button data-ps="sem" class="'+(ui.pacSub==='sem'?'on':'')+'">Sem categoria '+
      '<span style="opacity:.65">'+sc+'</span></button>';
  if(arq.length)
    h+='<button data-ps="arquivadas" class="'+(ui.pacSub==='arquivadas'?'on':'')+'">'+
      I.caixa(13)+' Arquivadas <span style="opacity:.65">'+arq.length+'</span></button>';
  h+='<span class="sep"></span>';
  h+='<button data-ps="nova" class="'+(ui.pacSub==='nova'?'on':'')+'">'+I.plus(13)+' Nova paciente</button>';
  document.getElementById('pac-sub').innerHTML=h;
}

/* resumo textual da situação mais urgente entre os ciclos */
function situacaoPac(p,hoje){
  if(p.arquivada) return {html:'<span class="badge soft">Arquivada'+
    (p.arquivadaEm?' em '+D.brc(p.arquivadaEm):'')+'</span>',prazo:null};
  const rs=areasDe(p).map(k=>({k:k,r:resolver(p,k,hoje)}));
  if(!rs.length) return {html:(p.maquinas||[]).length
    ? '<span class="badge soft">'+I.maq(11)+' Só máquinas</span>'
    : '<span class="badge soft">Sem ciclo</span>',prazo:null};
  const peso=o=>o.r.estado==='pendente'?(o.r.atraso>0?0:1):(o.r.estado==='sessao_hoje'?2:
    (o.r.estado==='agendado'?3:4));
  rs.sort((a,b)=>peso(a)-peso(b)||(b.r.atraso-a.r.atraso)||
    String(a.r.aparece||a.r.prazo).localeCompare(String(b.r.aparece||b.r.prazo)));
  const o=rs[0], a=area(o.k);
  let s;
  if(o.r.estado==='pendente') s=o.r.atraso>0
    ? '<span class="badge late">'+a.nome+' · '+o.r.atraso+'d de atraso</span>'
    : (o.r.primeiro?'<span class="badge first">'+a.nome+' · primeiro</span>'
                   :'<span class="badge due">'+a.nome+' · a agendar</span>');
  else if(o.r.estado==='sessao_hoje') s='<span class="badge ok">'+a.nome+' · hoje</span>';
  else if(o.r.estado==='agendado') s='<span class="badge ok">'+a.nome+' · '+D.brc(o.r.prazo)+'</span>';
  else s='<span class="badge soft">'+a.nome+' · aparece '+D.brc(o.r.aparece)+'</span>';
  const prox=rs.slice().sort((x,y)=>String(x.r.prazo).localeCompare(String(y.r.prazo)))[0];
  return {html:s,prazo:prox.r.prazo,prazoArea:area(prox.k).nome};
}

function renderPac(){
  renderPacSub();
  const alvo=document.getElementById('pac-view');
  if(ui.pacSub==='nova'){ alvo.innerHTML=formPaciente(ui.editId?pac(ui.editId):null); ligarForm(); return; }
  const hoje=D.hoje();
  const arqv=ui.pacSub==='arquivadas';
  let lista=arqv?arquivadas():ativas();
  if(ui.pacSub==='sem') lista=lista.filter(p=>!cat(p.categoriaId));
  else if(!arqv&&ui.pacSub!=='todas') lista=lista.filter(p=>p.categoriaId===ui.pacSub);
  if(ui.busca){ const q=ui.busca.toLowerCase();
    lista=lista.filter(p=>p.nome.toLowerCase().indexOf(q)>=0||(p.obs||'').toLowerCase().indexOf(q)>=0); }
  lista.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));

  let topo2='';
  const topo='<div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap">'+
    '<div style="position:relative;flex:1;min-width:220px;max-width:340px">'+
    '<input type="text" id="pac-busca" placeholder="Buscar por nome ou observação" value="'+
    esc(ui.busca)+'" style="padding-left:38px">'+
    '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--taupe)">'+
    I.lupa(15)+'</span></div>'+
    '<span class="hintx">'+lista.length+(lista.length===1?' paciente':' pacientes')+'</span></div>';

  if(!lista.length){
    alvo.innerHTML=topo+vazio('&#10047;',
      arqv?'Nenhuma paciente arquivada':(state.pacientes.length?'Nenhuma paciente neste filtro'
        :'Nenhuma paciente cadastrada'),
      arqv?'Quando um plano acabar, arquive a paciente aqui — a ficha inteira fica guardada.'
        :(state.pacientes.length?'Tente outra categoria ou limpe a busca.'
        :'Cadastre uma paciente ou importe sua planilha do Excel.'),
      (state.pacientes.length||arqv)?'':'<button class="btn p" data-act="ir-nova">'+I.plus(13)+
      ' Cadastrar paciente</button>');
    ligarBusca(); return;
  }
  if(arqv) topo2='<div class="note info" style="margin-bottom:20px">'+I.info(15)+
    '<div>Pacientes arquivadas somem do Dashboard, do quadro semanal e das listas de máquina, '+
    'mas continuam aqui com ciclos, condições e histórico intactos. Restaure quando ela voltar.</div></div>';

  let linhas='';
  lista.forEach(p=>{
    const sit=situacaoPac(p,hoje);
    const c=cat(p.categoriaId);
    const nc=(p.condicoes||[]).length;
    linhas+='<tr'+(p.arquivada?' style="opacity:.62"':'')+'><td><span class="nm">'+esc(p.nome)+'</span>'+
      (nc?' <span class="badge warn" title="'+nc+' condição(ões)">'+I.plane(11)+' '+nc+'</span>':'')+
      (p.obs?'<div style="font-size:11.5px;font-weight:300;color:var(--taupe);margin-top:2px;'+
        'max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(p.obs)+'</div>':'')+
      '</td>'+
      '<td>'+selCiclos(p)+'</td>'+
      '<td>'+(c?'<span class="badge cat" style="background:'+c.cor+'22"><i style="background:'+
        c.cor+'"></i>'+esc(c.nome)+'</span>':'<span style="color:var(--linha-forte)">—</span>')+'</td>'+
      '<td>'+sit.html+'</td>'+
      '<td>'+(sit.prazo?D.br(sit.prazo)+'<div style="font-size:10.5px;color:var(--taupe)">'+
        sit.prazoArea+'</div>':'<span style="color:var(--linha-forte)">—</span>')+'</td>'+
      '<td>'+((p.maquinas||[]).length?selMaqs(p):'<span style="color:var(--linha-forte)">—</span>')+'</td>'+
      '<td class="acts">'+
        '<button class="btn q sm" data-act="ver" data-id="'+p.id+'" title="Ficha">'+I.eye(14)+'</button>'+
        '<button class="btn q sm" data-act="editar" data-id="'+p.id+'" title="Editar">'+I.edit(14)+'</button>'+
        (p.arquivada
          ? '<button class="btn q sm" data-act="restaurar" data-id="'+p.id+
            '" title="Restaurar paciente">'+I.volta(14)+'</button>'
          : '<button class="btn q sm" data-act="arquivar" data-id="'+p.id+'" title="Arquivar">'+
            I.caixa(14)+'</button>')+
        '<button class="btn q sm" data-act="excluir" data-id="'+p.id+'" title="Excluir">'+I.trash(14)+'</button>'+
      '</td></tr>';
  });
  alvo.innerHTML=topo+topo2+'<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr>'+
    '<th>Paciente</th><th>Ciclos</th><th>Categoria</th><th>Situação</th>'+
    '<th>Próximo prazo</th><th>Máquinas</th><th></th>'+
    '</tr></thead><tbody>'+linhas+'</tbody></table></div></div>';
  ligarBusca();
}
function ligarBusca(){
  const b=document.getElementById('pac-busca'); if(!b) return;
  b.addEventListener('input',()=>{ ui.busca=b.value; const pos=b.selectionStart;
    renderPac(); const n=document.getElementById('pac-busca');
    if(n){ n.focus(); n.setSelectionRange(pos,pos);} });
}

/* ---------- Formulário de paciente ---------- */
function formPaciente(p){
  const ed=!!p;
  ui.condTmp = ed ? JSON.parse(JSON.stringify(p.condicoes||[])) : [];
  const opts='<option value="">— sem categoria —</option>'+state.categorias.map(c=>
    '<option value="'+c.id+'"'+(ed&&p.categoriaId===c.id?' selected':'')+'>'+esc(c.nome)+'</option>').join('');

  const blocosArea=AREAS.map(a=>{
    const c=ed?ciclo(p,a.k):null;
    const on=!!c || (!ed&&a.k==='facial');
    const f=c?c.freq:15;
    const rad=[7,15,30].map(n=>'<label class="'+(f===n?'on':'')+'" data-freq="'+n+'">'+
      '<input type="radio" name="freq-'+a.k+'" value="'+n+'"'+(f===n?' checked':'')+
      '><b>'+n+'</b>dias</label>').join('');
    return '<div class="area-box'+(on?' on':'')+'" data-k="'+a.k+'">'+
      '<label class="area-top"><input type="checkbox" data-ak="'+a.k+'"'+(on?' checked':'')+'>'+
        '<span class="ai" style="background:'+a.cor+'">'+a.ic(15)+'</span>'+
        '<span class="an">'+a.nome+'</span></label>'+
      '<div class="area-cfg"'+(on?'':' style="display:none"')+'>'+
        '<div class="fgrid">'+
          '<div class="field full"><label style="font-size:9.5px">Ela vem a cada</label>'+
            '<div class="radios" data-rk="'+a.k+'">'+rad+'</div></div>'+
          '<div class="field full"><label style="font-size:9.5px" for="f-ult-'+a.k+
            '">Último atendimento '+a.nome.toLowerCase()+' <span class="opt">(opcional)</span></label>'+
            '<input type="date" id="f-ult-'+a.k+'" value="'+((c&&c.ultimo)||'')+'">'+
            '<span class="hintx">Em branco = entra já na lista de quem precisa agendar.</span></div>'+
        '</div>'+
      '</div></div>';
  }).join('');

  return '<div class="form" id="form-pac">'+
    '<h3 class="serif" style="font-size:25px;font-weight:600;color:var(--teal-deep);margin-bottom:26px">'+
      (ed?'Editar '+esc(p.nome):'Nova paciente')+'</h3>'+
    '<div class="fgrid">'+
      '<div class="field full"><label for="f-nome">Nome da paciente</label>'+
        '<input type="text" id="f-nome" maxlength="80" placeholder="Nome completo" value="'+
        (ed?esc(p.nome):'')+'"></div>'+
      '<div class="field full"><label>Ciclos de retorno</label>'+
        '<span class="hintx" style="margin-bottom:6px">Marque as áreas que ela faz — cada uma tem '+
        'o próprio intervalo. Pode ser só uma, ou Facial de 15 dias e Corporal de 7. '+
        '<b style="font-weight:500">Pode deixar todas desmarcadas</b> — quem só vem nas máquinas '+
        'temporárias não precisa de ciclo.</span>'+
        '<div class="areas" id="f-areas">'+blocosArea+'</div></div>'+
      '<div class="field"><label for="f-cat">Categoria</label><select id="f-cat">'+opts+'</select>'+
        '<span class="hintx">Só organiza a lista — não muda prazos.</span></div>'+
      '<div class="field"><label for="f-zap">WhatsApp <span class="opt">(opcional)</span></label>'+
        '<input id="f-zap" type="tel" inputmode="tel" placeholder="(54) 99999-9999" value="'+
        (ed?esc(p.whatsapp||''):'')+'">'+
        '<span class="hintx">Ajuda a reconhecer quem já está cadastrada e a ligar com o CRM.</span></div>'+
      '<div class="field"><label for="f-origem">Origem <span class="opt">(opcional)</span></label>'+
        '<select id="f-origem"><option value="">— não informada —</option>'+
        ORIGENS.map(o=>'<option value="'+o.id+'"'+
          (ed&&p.origem===o.id?' selected':'')+'>'+esc(o.nome)+'</option>').join('')+
        '</select></div>'+
      (state.maquinas.length
        ? '<div class="field"><label>Máquinas temporárias <span class="opt">(opcional)</span></label>'+
          '<div class="maq-checks" id="f-maq">'+state.maquinas.map(m=>{
            const on=ed&&(p.maquinas||[]).indexOf(m.id)>=0;
            return '<label class="'+(on?'on':'')+'"><input type="checkbox" value="'+m.id+'"'+
              (on?' checked':'')+'><i style="background:'+m.cor+'"></i>'+esc(m.nome)+'</label>';
          }).join('')+'</div>'+
          '<span class="hintx">Entra na lista dessas máquinas 14 dias antes de cada vinda.</span></div>'
        : '<div class="field"></div>')+
      '<div class="field full"><label for="f-obs">Observações <span class="opt">(opcional)</span></label>'+
        '<textarea id="f-obs" placeholder="Preferências, sensibilidades, o que combinaram na última sessão…">'+
        (ed?esc(p.obs):'')+'</textarea></div>'+
      '<div class="field full">'+
        '<label class="check'+(ui.condTmp.length?' on':'')+'" id="f-tem-cond-w">'+
          '<input type="checkbox" id="f-tem-cond"'+(ui.condTmp.length?' checked':'')+'>'+
          '<span>Esta paciente tem condições a considerar'+
          '<b>Períodos em que ela fica indisponível — viagem, evento, recuperação. '+
          'O sistema adia os prazos dela automaticamente.</b></span></label>'+
        '<div id="f-cond-box" style="margin-top:16px;'+(ui.condTmp.length?'':'display:none')+'"></div>'+
      '</div>'+
    '</div>'+
    '<div class="form-acts">'+
      '<button class="btn p" data-act="salvar-pac">'+I.check(13)+' '+
        (ed?'Salvar alterações':'Cadastrar paciente')+'</button>'+
      '<button class="btn g" data-act="cancelar-pac">Cancelar</button>'+
      (ed?'<span style="flex:1"></span>'+
        (p.arquivada
          ? '<button class="btn g" data-act="restaurar" data-id="'+p.id+'">'+I.volta(13)+
            ' Restaurar</button>'
          : '<button class="btn q" data-act="arquivar" data-id="'+p.id+'">'+I.caixa(14)+
            ' Arquivar</button>')+
        '<button class="btn q" data-act="excluir" data-id="'+p.id+'">'+
        I.trash(14)+' Excluir</button>':'')+
    '</div></div>';
}
function renderCond(){
  const box=document.getElementById('f-cond-box'); if(!box) return;
  const mini='font-size:9.5px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--taupe)';
  let h='<div class="cond-list">';
  if(!ui.condTmp.length) h+='<span class="hintx">Nenhuma condição adicionada.</span>';
  ui.condTmp.forEach((c,i)=>{
    h+='<div class="cond">'+
      '<div class="field"><span style="'+mini+'">Condição</span>'+
        '<input type="text" data-ci="'+i+'" data-cf="texto" maxlength="60" '+
        'placeholder="Ex.: viagem, evento, recuperação" value="'+esc(c.texto||'')+'"></div>'+
      '<div class="field"><span style="'+mini+'">Indisponível de</span>'+
        '<input type="date" data-ci="'+i+'" data-cf="inicio" value="'+(c.inicio||'')+'"></div>'+
      '<div class="field"><span style="'+mini+'">até</span>'+
        '<input type="date" data-ci="'+i+'" data-cf="fim" value="'+(c.fim||'')+'"></div>'+
      '<button class="btn q del" data-act="cond-del" data-i="'+i+'" title="Remover">'+I.trash(15)+'</button>'+
      '</div>';
  });
  h+='</div><button class="btn g sm" data-act="cond-add" style="margin-top:14px">'+I.plus(12)+
    ' Adicionar condição</button>';
  box.innerHTML=h;
  box.querySelectorAll('input[data-ci]').forEach(inp=>{
    inp.addEventListener('input',()=>{ ui.condTmp[+inp.dataset.ci][inp.dataset.cf]=inp.value; });
  });
}
function ligarForm(){
  renderCond();
  document.querySelectorAll('#f-areas .radios').forEach(fr=>{
    fr.querySelectorAll('label').forEach(l=>l.addEventListener('click',()=>{
      fr.querySelectorAll('label').forEach(x=>x.classList.remove('on')); l.classList.add('on');
    }));
  });
  document.querySelectorAll('#f-areas input[data-ak]').forEach(cb=>{
    cb.addEventListener('change',()=>{
      const box=cb.closest('.area-box');
      box.classList.toggle('on',cb.checked);
      box.querySelector('.area-cfg').style.display=cb.checked?'':'none';
    });
  });
  const fm=document.getElementById('f-maq');
  if(fm) fm.querySelectorAll('label').forEach(l=>{
    const cb=l.querySelector('input');
    cb.addEventListener('change',()=>l.classList.toggle('on',cb.checked));
  });
  const tc=document.getElementById('f-tem-cond');
  tc.addEventListener('change',()=>{
    document.getElementById('f-tem-cond-w').classList.toggle('on',tc.checked);
    document.getElementById('f-cond-box').style.display=tc.checked?'':'none';
    if(tc.checked&&!ui.condTmp.length){ ui.condTmp.push({texto:'',inicio:'',fim:''}); renderCond(); }
  });
  document.getElementById('f-nome').focus();
}
function salvarPaciente(){
  const nome=document.getElementById('f-nome').value.trim();
  if(!nome){ toast('Dê um nome à paciente para continuar.',true);
    document.getElementById('f-nome').focus(); return; }
  const hoje=D.hoje();
  const antigo=ui.editId?pac(ui.editId):null;
  const ciclos={facial:null,corporal:null,capilar:null};
  for(const a of AREAS){
    const cb=document.querySelector('#f-areas input[data-ak="'+a.k+'"]');
    if(!cb||!cb.checked) continue;
    const freq=+document.querySelector('#f-areas .radios[data-rk="'+a.k+'"] label.on').dataset.freq;
    const ult=document.getElementById('f-ult-'+a.k).value||null;
    if(ult&&ult>hoje){ toast('O último atendimento '+a.nome.toLowerCase()+
      ' não pode estar no futuro.',true); return; }
    const ant=antigo?ciclo(antigo,a.k):null;
    ciclos[a.k]= ant
      ? {freq:freq,ultimo:ult,agendamento:ant.agendamento,adiadaPara:ant.adiadaPara,
         naoRespondeu:ant.naoRespondeu}
      : novoCiclo(freq,ult);
  }
  const catId=document.getElementById('f-cat').value||null;
  const obs=document.getElementById('f-obs').value.trim();
  const zap=(document.getElementById('f-zap')||{}).value||'';
  const origem=(document.getElementById('f-origem')||{}).value||'';
  const maqs=[].slice.call(document.querySelectorAll('#f-maq input:checked')).map(x=>x.value);
  const temCond=document.getElementById('f-tem-cond').checked;
  const conds=[];
  if(temCond){
    for(const c of ui.condTmp){
      const t=(c.texto||'').trim();
      if(!t&&!c.inicio&&!c.fim) continue;
      if(!c.inicio||!c.fim){ toast('Preencha as duas datas da condição “'+(t||'sem nome')+'”.',true); return; }
      if(c.fim<c.inicio){ toast('Na condição “'+(t||'sem nome')+'”, a data final é anterior à inicial.',true); return; }
      conds.push({id:c.id||uid(),texto:t||'Indisponível',inicio:c.inicio,fim:c.fim});
    }
  }
  /* Nome repetido não impede mais o cadastro: duas Marias Silva existem, e
     bloquear obrigava a inventar "Maria Silva 2". Agora a tela mostra quem
     já está lá e a pessoa decide. */
  conferirNomeRepetido(nome, antigo, ()=>{
    if(antigo){
      antigo.nome=nome; antigo.categoriaId=catId; antigo.obs=obs; antigo.condicoes=conds;
      antigo.maquinas=maqs; antigo.ciclos=ciclos;
      antigo.whatsapp=zap.trim(); antigo.origem=origem;
      AREAK.forEach(k=>{ if(!ciclos[k])
        state.followups=state.followups.filter(f=>!(f.pacienteId===antigo.id&&f.area===k&&!f.feito)); });
      toast('Ficha de '+nome+' atualizada.');
    } else {
      state.pacientes.push(normalizar({id:uid(),nome:nome,ciclos:ciclos,categoriaId:catId,obs:obs,
        condicoes:conds,maquinas:maqs,historico:[],criadoEm:hoje,
        whatsapp:zap.trim(),origem:origem}));
      toast(nome+' cadastrada.');
    }
    ui.editId=null; ui.pacSub='todas'; salvar(); tudo();
  }, zap);
}

/* A agenda não guarda telefone, então só o nome pode indicar repetição — e
   nome é indício fraco. Por isso o aviso é aviso, nunca barreira. */
function conferirNomeRepetido(nome, antigo, seguir, zap){
  zap = zap || '';
  const mudouOQueImporta = !antigo ||
    FloreSerSync.nomeChave(antigo.nome)!==FloreSerSync.nomeChave(nome) ||
    FloreSerSync.telefone(antigo.whatsapp)!==FloreSerSync.telefone(zap);
  if(!mudouOQueImporta){ seguir(); return; }

  /* agora que a paciente pode ter telefone, ele é o indício forte —
     a mesma régua do CRM. Nome continua sendo indício fraco. */
  const achados = FloreSerSync.procurarRepetidos({nome:nome,whatsapp:zap}, state.pacientes, {
    id:'id',
    ignorarId: antigo ? antigo.id : null,
    criterios:[
      {forca:'forte',texto:'mesmo WhatsApp',campos:[{campo:'whatsapp',como:'telefone'}]},
      {forca:'fraca',texto:'mesmo nome',campos:[{campo:'nome',como:'nome'}]}
    ],
    situacao: p => p.arquivada ? 'ficha arquivada' : '',
  });
  if(!achados.length){ seguir(); return; }

  registrarSync('REPETIDO_AVISADO', achados.length+' paciente(s) com o mesmo nome');

  FloreSerSync.avisarRepetido({
    achados: achados,
    titulo:'Já existe uma paciente com esse nome',
    aviso:'Pode ser a mesma pessoa, ou outra com nome igual. Veja a ficha antes de decidir.',
    textoSeguir: antigo ? 'Salvar mesmo assim' : 'Cadastrar mesmo assim',
    rotulo: p => p.nome,
    detalhe: p => {
      const c = p.categoriaId ? (state.categorias.find(x=>x.id===p.categoriaId)||{}).nome : '';
      const areas = AREAK.filter(k=>p.ciclos&&p.ciclos[k]).length;
      return [c, areas? areas+(areas===1?' área ativa':' áreas ativas') : 'sem área ativa',
        p.criadoEm? 'cadastrada em '+D.br(p.criadoEm) : ''].filter(Boolean).join(' · ');
    },
    aoVer: p => { ui.editId=null; ui.pacSub='todas'; renderPac(); modalFicha(p.id); },
    aoSeguir: ()=>{ registrarSync('REPETIDO_SEGUIU','a pessoa optou por cadastrar assim mesmo'); seguir(); },
    aoCancelar: ()=>{},
  });
}

/* ==========================================================
   CATEGORIAS
   ========================================================== */
const PALETA=['#3B6E6A','#5A9490','#C9D3CA','#A39384','#8C9A72','#B08968','#7E8BA3','#A8623F'];
let corEscolhida=PALETA[0];
function renderSwatches(){
  const el=document.getElementById('cat-swatches');
  el.innerHTML=PALETA.map(c=>'<button class="swatch'+(c===corEscolhida?' on':'')+
    '" data-cor="'+c+'" style="background:'+c+'" title="'+c+'"></button>').join('')+
    '<input type="color" id="cat-cor-livre" value="'+corEscolhida+'" title="Cor livre">';
  el.querySelectorAll('.swatch').forEach(b=>b.addEventListener('click',()=>{
    corEscolhida=b.dataset.cor; renderSwatches(); }));
  document.getElementById('cat-cor-livre').addEventListener('input',e=>{
    corEscolhida=e.target.value;
    el.querySelectorAll('.swatch').forEach(x=>x.classList.remove('on'));
  });
}
function renderCat(){
  renderSwatches();
  document.getElementById('cat-count').textContent=
    state.categorias.length?state.categorias.length+(state.categorias.length===1?' criada':' criadas'):'';
  const el=document.getElementById('cat-list');
  if(!state.categorias.length){
    el.innerHTML=vazio('&#10047;','Nenhuma categoria ainda',
      'Categorias são só uma forma de organizar a lista — pele madura, pós-parto, noivas, o que fizer sentido para você.');
    return;
  }
  el.innerHTML='<div class="cats">'+state.categorias.map(c=>{
    const n=state.pacientes.filter(p=>p.categoriaId===c.id).length;
    return '<div class="cat-card"><span class="dot" style="background:'+c.cor+'"></span>'+
      '<div class="ct"><b>'+esc(c.nome)+'</b><span>'+n+(n===1?' paciente':' pacientes')+'</span></div>'+
      '<button class="btn q" data-act="cat-editar" data-id="'+c.id+'" title="Renomear">'+I.edit(14)+'</button>'+
      '<button class="btn q" data-act="cat-excluir" data-id="'+c.id+'" title="Excluir">'+I.trash(14)+'</button>'+
      '</div>';
  }).join('')+'</div>';
}
function addCategoria(){
  const inp=document.getElementById('cat-nome'); const nome=inp.value.trim();
  if(!nome){ toast('Escreva o nome da categoria.',true); inp.focus(); return; }
  if(state.categorias.some(c=>c.nome.toLowerCase()===nome.toLowerCase())){
    toast('Essa categoria já existe.',true); return; }
  state.categorias.push({id:uid(),nome:nome,cor:corEscolhida});
  inp.value=''; salvar(); toast('Categoria “'+nome+'” criada.'); tudo();
}

/* ==========================================================
   PÁGINA — MÁQUINAS TEMPORÁRIAS
   ========================================================== */
let corMaq=PALETA[0];
function pintaSwatchMaq(){
  document.querySelectorAll('#nm-cor .swatch').forEach(s=>
    s.classList.toggle('on',s.dataset.cor===corMaq));
  const l=document.getElementById('nm-cor-livre'); if(l) l.value=corMaq;
}
function swatchesHTML(id,cor){
  return '<div class="swatches" id="'+id+'">'+PALETA.map(c=>'<button class="swatch'+
    (c===cor?' on':'')+'" data-act="maq-cor" data-cor="'+c+'" style="background:'+c+
    '"></button>').join('')+'<input type="color" id="'+id+'-livre" value="'+cor+'"></div>';
}
function cardVinda(v,hoje,passada){
  const m=maq(v.maquinaId); if(!m) return '';
  const g=grupoVinda(v,hoje);
  const aberta=vindaAberta(v,hoje);
  const abre=abreEm(v);
  let sub;
  if(passada) sub='Já aconteceu &middot; '+relativo(v.data,hoje);
  else if(v.data===hoje) sub='A máquina chega hoje';
  else if(aberta) sub='Lista aberta desde '+D.br(abre)+' &middot; '+relativo(v.data,hoje);
  else sub='A lista de agendamento abre em '+D.br(abre)+' &middot; '+relativo(abre,hoje);

  const conta=(n,rot)=>'<div><b>'+n+'</b>'+rot+'</div>';
  let corpo='<div class="conta">'+
    conta(g.total,'marcadas na máquina')+
    conta(g.agendadas.length,'confirmadas')+
    (passada?'':conta(g.pendentes.length+g.adiadas.length,'a agendar'))+
    conta(g.proximas.length,'para a próxima')+
    conta(g.conds.length,'em condição')+'</div>';
  const nomes=(rot,arr,fn)=>arr.length
    ? '<div class="nomes"><b>'+rot+':</b> '+arr.map(fn||(x=>esc(x.p.nome))).join(', ')+'</div>' : '';
  corpo+=nomes('Confirmadas',g.agendadas);
  if(!passada) corpo+=nomes(aberta?'A agendar':'Serão chamadas quando a lista abrir',g.pendentes);
  corpo+=nomes('Sem resposta, voltam amanhã',g.adiadas);
  corpo+=nomes('Ficam para a próxima vinda',g.proximas);
  corpo+=nomes('Em condição no dia',g.conds,x=>esc(x.p.nome)+' ('+esc(x.s.cond.texto)+')');
  if(!g.total) corpo+='<div class="nomes">Nenhuma paciente está marcada para esta máquina ainda.</div>';

  return '<div class="vinda'+(passada||!aberta?' fechada':'')+'">'+
    '<div class="vinda-head">'+
      '<span class="mk" style="background:'+m.cor+'">'+I.maq(19)+'</span>'+
      '<div class="vt"><b>'+esc(m.nome)+' &middot; '+D.br(v.data)+'</b>'+
        '<span>'+D.dow(v.data)+' &middot; '+sub+(v.obs?' &middot; '+esc(v.obs):'')+'</span></div>'+
      (aberta&&!passada?'<span class="badge due">'+I.bell(11)+' Lista aberta</span>':'')+
      '<button class="btn g sm" data-act="maq-pac" data-id="'+m.id+'">'+I.user(12)+' Pacientes</button>'+
      (passada?'':'<button class="btn q sm" data-act="vinda-editar" data-id="'+v.id+
        '" title="Mudar data">'+I.edit(14)+'</button>')+
      '<button class="btn q sm" data-act="vinda-excluir" data-id="'+v.id+'" title="Excluir">'+
        I.trash(14)+'</button>'+
    '</div>'+
    '<div class="vinda-body">'+corpo+'</div></div>';
}
function renderMaq(){
  const el=document.getElementById('maq-view'); if(!el) return;
  const hoje=D.hoje();
  const validas=state.vindas.filter(v=>maq(v.maquinaId));
  const futuras=validas.filter(v=>v.data>=hoje).sort((a,b)=>a.data.localeCompare(b.data));
  const passadas=validas.filter(v=>v.data<hoje).sort((a,b)=>b.data.localeCompare(a.data));
  let h='';
  if(state.maquinas.length){
    h+='<div class="form" style="max-width:100%;margin-bottom:40px">'+
      '<h3 class="serif" style="font-size:22px;font-weight:600;color:var(--teal-deep);'+
      'margin-bottom:22px">Cadastrar uma vinda</h3>'+
      '<div class="fgrid">'+
        '<div class="field"><label for="v-maq">Máquina</label><select id="v-maq">'+
          state.maquinas.map(m=>'<option value="'+m.id+'">'+esc(m.nome)+'</option>').join('')+
          '</select></div>'+
        '<div class="field"><label for="v-data">Data prevista</label>'+
          '<input type="date" id="v-data" min="'+hoje+'"></div>'+
        '<div class="field full"><label for="v-obs">Observação <span class="opt">(opcional)</span></label>'+
          '<input type="text" id="v-obs" maxlength="80" '+
          'placeholder="Ex.: chega de manhã e sai no fim do dia"></div>'+
      '</div>'+
      '<div class="form-acts"><button class="btn p" data-act="vinda-add">'+I.plus(13)+
        ' Adicionar data</button>'+
        '<span class="hintx">A lista de agendamento abre sozinha 14 dias antes da data.</span>'+
      '</div></div>';
  }
  h+='<div class="block"><div class="block-head"><h3>Próximas vindas</h3>'+
    '<span class="count">'+(futuras.length?futuras.length+(futuras.length===1?' agendada':' agendadas')
      :'nenhuma')+'</span></div>'+
    (futuras.length?futuras.map(v=>cardVinda(v,hoje,false)).join('')
      :vazio('&#10047;','Nenhuma data cadastrada',
        state.maquinas.length
          ? 'Assim que souber quando a máquina vem, cadastre a data acima. Duas semanas antes, as pacientes marcadas aparecem no Dashboard.'
          : 'Cadastre primeiro uma máquina, logo abaixo.'))+
    '</div>';

  h+='<div class="block"><div class="block-head"><h3>Máquinas</h3>'+
    '<span class="count">'+state.maquinas.length+(state.maquinas.length===1?' cadastrada':' cadastradas')+
    '</span></div>';
  if(state.maquinas.length){
    h+='<div class="maqs">'+state.maquinas.map(m=>{
      const n=pacientesDaMaquina(m.id).length;
      const pv=vindasDa(m.id,true)[0];
      return '<div class="maq-card">'+
        '<div class="mc-top"><span class="dot" style="background:'+m.cor+'">'+I.maq(16)+'</span>'+
        '<b>'+esc(m.nome)+'</b></div>'+
        '<div class="mc-info">'+esc(m.cadencia||'sem periodicidade fixa')+'<br>'+
        n+(n===1?' paciente marcada':' pacientes marcadas')+'<br>'+
        (pv?'próxima vinda em '+D.br(pv.data):'sem data cadastrada')+'</div>'+
        '<div class="mc-acts">'+
        '<button class="btn g sm" data-act="maq-pac" data-id="'+m.id+'">'+I.user(12)+
          ' Pacientes</button><span style="flex:1"></span>'+
        '<button class="btn q sm" data-act="maq-editar" data-id="'+m.id+'" title="Editar">'+
          I.edit(14)+'</button>'+
        '<button class="btn q sm" data-act="maq-excluir" data-id="'+m.id+'" title="Excluir">'+
          I.trash(14)+'</button></div></div>';
    }).join('')+'</div>';
  }
  h+='<div class="form"><div class="fgrid">'+
    '<div class="field"><label for="nm-nome">Nova máquina</label>'+
      '<input type="text" id="nm-nome" maxlength="40" placeholder="Nome do equipamento"></div>'+
    '<div class="field"><label for="nm-cad">Periodicidade <span class="opt">(informativo)</span></label>'+
      '<input type="text" id="nm-cad" maxlength="40" placeholder="Ex.: mensal, a cada 3 meses"></div>'+
    '<div class="field full"><label>Cor</label>'+swatchesHTML('nm-cor',corMaq)+'</div>'+
    '</div><div class="form-acts">'+
    '<button class="btn p" data-act="maq-add">'+I.plus(13)+' Cadastrar máquina</button>'+
    '<span class="hintx">A cor identifica a máquina nos cartões e no quadro semanal.</span>'+
    '</div></div></div>';

  if(passadas.length){
    h+='<div class="block"><div class="block-head"><h3>Vindas anteriores</h3>'+
      '<span class="count">'+passadas.length+'</span></div>'+
      passadas.slice(0,8).map(v=>cardVinda(v,hoje,true)).join('')+'</div>';
  }
  el.innerHTML=h;
}
function modalPacMaq(mid){
  const m=maq(mid); if(!m) return;
  const lista=ativas().sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  abrir(cabecaModal('Pacientes de '+esc(m.nome),
    'Marque quem deve ser chamada toda vez que esta máquina vier')+
    '<div class="modal-body">'+
      (lista.length
        ? '<div class="field" style="margin-bottom:16px">'+
          '<input type="text" id="pm-busca" placeholder="Buscar por nome"></div>'+
          '<div class="sel-list" id="pm-list">'+lista.map(p=>{
            const on=(p.maquinas||[]).indexOf(mid)>=0;
            return '<label class="sel-item" data-nome="'+esc(p.nome.toLowerCase())+'">'+
              '<input type="checkbox" value="'+p.id+'"'+(on?' checked':'')+'>'+
              '<span class="si-n">'+esc(p.nome)+'</span>'+selCiclos(p)+selCat(p)+'</label>';
          }).join('')+'</div>'
        : '<span class="hintx">Nenhuma paciente cadastrada ainda.</span>')+
    '</div>'+
    '<div class="modal-foot">'+
      (lista.length?'<button class="btn q" data-act="pm-todas">Marcar todas</button>'+
        '<button class="btn q" data-act="pm-nenhuma">Desmarcar todas</button><span class="sep"></span>':'')+
      '<button class="btn g" data-act="fechar">Cancelar</button>'+
      (lista.length?'<button class="btn p" data-act="pm-salvar" data-id="'+mid+'">'+I.check(13)+
        ' Salvar</button>':'')+
    '</div>',true);
  const b=document.getElementById('pm-busca');
  if(b) b.addEventListener('input',()=>{
    const q=b.value.toLowerCase();
    document.querySelectorAll('#pm-list .sel-item').forEach(it=>{
      it.style.display=it.dataset.nome.indexOf(q)>=0?'':'none';
    });
  });
}
function salvarPacMaq(mid){
  const marcados={};
  document.querySelectorAll('#pm-list input:checked').forEach(x=>marcados[x.value]=1);
  let n=0;
  state.pacientes.forEach(p=>{
    const tem=(p.maquinas||[]).indexOf(mid)>=0;
    if(marcados[p.id]&&!tem) p.maquinas=(p.maquinas||[]).concat([mid]);
    else if(!marcados[p.id]&&tem) p.maquinas=(p.maquinas||[]).filter(x=>x!==mid);
    if((p.maquinas||[]).indexOf(mid)>=0) n++;
  });
  salvar(); fechar(); tudo();
  toast(n+(n===1?' paciente marcada':' pacientes marcadas')+' para '+maq(mid).nome+'.');
}
function addMaquina(){
  const nome=(document.getElementById('nm-nome').value||'').trim();
  if(!nome){ toast('Dê um nome à máquina.',true); return; }
  if(state.maquinas.some(m=>m.nome.toLowerCase()===nome.toLowerCase())){
    toast('Já existe uma máquina com esse nome.',true); return; }
  state.maquinas.push({id:uid(),nome:nome,
    cadencia:(document.getElementById('nm-cad').value||'').trim(),cor:corMaq,obs:''});
  state.seedMaq=true; salvar(); tudo(); toast('Máquina “'+nome+'” cadastrada.');
}
function addVinda(){
  const mid=document.getElementById('v-maq').value;
  const data=document.getElementById('v-data').value;
  const obs=(document.getElementById('v-obs').value||'').trim();
  if(!maq(mid)){ toast('Escolha a máquina.',true); return; }
  if(!D.ok(data)){ toast('Escolha a data prevista da vinda.',true); return; }
  if(data<D.hoje()){ toast('Essa data já passou.',true); return; }
  if(state.vindas.some(v=>v.maquinaId===mid&&v.data===data)){
    toast('Essa vinda já está cadastrada.',true); return; }
  state.vindas.push({id:uid(),maquinaId:mid,data:data,obs:obs,resp:{},criadoEm:D.hoje()});
  salvar(); tudo();
  const dias=D.dif(D.hoje(),data);
  toast(maq(mid).nome+' em '+D.br(data)+' — a lista abre em '+D.br(D.add(data,-ANTECEDENCIA))+
    (dias<=ANTECEDENCIA?' (já está aberta)':'')+'.');
}

/* ==========================================================
   MODAIS
   ========================================================== */
const overlay=document.getElementById('overlay'), modalEl=document.getElementById('modal');
function abrir(html,wide){ modalEl.className='modal'+(wide?' wide':''); modalEl.innerHTML=html;
  overlay.classList.add('on'); }
function fechar(){ overlay.classList.remove('on'); modalEl.innerHTML=''; }
overlay.addEventListener('click',e=>{ if(e.target===overlay) fechar(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') fechar(); });

function cabecaModal(titulo,sub){
  return '<div class="modal-head"><div style="flex:1"><h3>'+titulo+'</h3>'+
    (sub?'<p>'+sub+'</p>':'')+'</div>'+
    '<button class="x" data-act="fechar">'+I.x(20)+'</button></div>';
}

/* ---------- Agendar ---------- */
function modalAgendar(id,k){
  const p=pac(id); if(!p) return;
  const c=ciclo(p,k); if(!c) return;
  const hoje=D.hoje(), r=resolver(p,k,hoje), a=area(k);
  const atual=c.agendamento;
  const fuAtual=state.followups.find(f=>f.pacienteId===p.id&&f.area===k&&!f.feito);
  const sugerida=atual?atual.data:(r.prazo&&r.prazo>=hoje?r.prazo:hoje);
  const temFU=!!(atual&&fuAtual);
  const fuData=fuAtual?fuAtual.data:D.add(sugerida,2);
  abrir(cabecaModal((atual?'Alterar agendamento':'Agendado para dia…'),
      esc(p.nome)+' &middot; '+a.nome+' &middot; ciclo de '+c.freq+' dias')+
    '<div class="modal-body">'+
      (r.primeiro?'':'<div class="note info" style="margin-bottom:20px">'+I.info(15)+
        '<div>Último atendimento '+a.nome.toLowerCase()+' em <b>'+D.br(c.ultimo)+'</b>. '+
        'O prazo calculado é <b>'+D.br(r.prazo)+'</b>'+(r.cond?' (já adiado por “'+
        esc(r.cond.texto)+'”)':'')+'.</div></div>')+
      '<div class="fgrid one">'+
        '<div class="field"><label for="m-data">Data do agendamento</label>'+
          '<input type="date" id="m-data" value="'+sugerida+'"></div>'+
        '<div id="m-aviso"></div>'+
        '<div class="field"><label class="check'+(temFU?' on':'')+'" id="m-fu-w">'+
          '<input type="checkbox" id="m-fu"'+(temFU?' checked':'')+'>'+
          '<span>Com follow-up<b>Um contato de acompanhamento depois da sessão. '+
          'Aparece no Dashboard no dia marcado.</b></span></label></div>'+
        '<div class="field" id="m-fu-box" style="'+(temFU?'':'display:none')+'">'+
          '<label for="m-fud">Dia do follow-up</label>'+
          '<input type="date" id="m-fud" value="'+fuData+'">'+
          '<span class="hintx">Precisa ser depois da data do agendamento.</span></div>'+
      '</div>'+
    '</div>'+
    '<div class="modal-foot">'+
      (atual?'<button class="btn q" data-act="desmarcar" data-id="'+p.id+'" data-a="'+k+'">'+
        I.x(13)+' Desmarcar</button><span class="sep"></span>':'')+
      '<button class="btn g" data-act="fechar">Cancelar</button>'+
      '<button class="btn p" data-act="confirmar-agenda" data-id="'+p.id+'" data-a="'+k+'">'+
      I.check(13)+' Confirmar</button>'+
    '</div>');
  const dt=document.getElementById('m-data'),fu=document.getElementById('m-fu'),
        fud=document.getElementById('m-fud'),box=document.getElementById('m-fu-box'),
        av=document.getElementById('m-aviso');
  function checar(){
    let h=''; const d=dt.value;
    if(d){
      const cd=condEm(p,d);
      if(cd) h+='<div class="note warn">'+I.warn(15)+'<div><b>Atenção:</b> '+esc(cd.texto)+
        ' — ela está indisponível de '+D.br(cd.inicio)+' a '+D.br(cd.fim)+'.</div></div>';
      if(d<hoje) h+='<div class="note info" style="margin-top:10px">'+I.info(15)+
        '<div>Data no passado: o ciclo '+a.nome.toLowerCase()+
        ' será recontado a partir dela.</div></div>';
    }
    if(fu.checked&&d){ fud.min=D.add(d,1); if(fud.value&&fud.value<=d) fud.value=D.add(d,2); }
    if(fu.checked&&fud.value&&d){
      const c2=condEm(p,fud.value);
      if(c2) h+='<div class="note warn" style="margin-top:10px">'+I.warn(15)+
        '<div>O follow-up cai dentro de “'+esc(c2.texto)+'”.</div></div>';
    }
    av.innerHTML=h;
  }
  dt.addEventListener('input',checar);
  fud.addEventListener('input',checar);
  fu.addEventListener('change',()=>{
    box.style.display=fu.checked?'':'none';
    document.getElementById('m-fu-w').classList.toggle('on',fu.checked);
    if(fu.checked&&(!fud.value||fud.value<=dt.value)) fud.value=D.add(dt.value||hoje,2);
    checar();
  });
  checar();
}
function confirmarAgenda(id,k){
  const p=pac(id), c=ciclo(p,k); if(!c) return;
  const d=document.getElementById('m-data').value;
  if(!D.ok(d)){ toast('Escolha a data do agendamento.',true); return; }
  const temFU=document.getElementById('m-fu').checked;
  const fud=document.getElementById('m-fud').value;
  if(temFU){
    if(!D.ok(fud)){ toast('Escolha o dia do follow-up.',true); return; }
    if(fud<=d){ toast('O follow-up precisa ser depois do agendamento.',true); return; }
  }
  c.agendamento={data:d,temFollowUp:temFU};
  c.adiadaPara=null; c.naoRespondeu=0;
  p.historico.push({tipo:'agendou',area:k,data:d,em:D.hoje(),fu:temFU?fud:null});
  state.followups=state.followups.filter(f=>!(f.pacienteId===p.id&&f.area===k&&!f.feito));
  if(temFU) state.followups.push({id:uid(),pacienteId:p.id,area:k,data:fud,feito:false,
    agendamentoData:d,criadoEm:D.hoje()});
  salvar(); fechar(); tudo();
  toast(p.nome+' — '+area(k).nome.toLowerCase()+' agendado para '+D.br(d)+
    (temFU?' · follow-up em '+D.br(fud):''));
}
function naoRespondeu(id,k){
  const p=pac(id), c=ciclo(p,k); if(!c) return;
  const hoje=D.hoje();
  c.adiadaPara=D.add(hoje,1);
  c.naoRespondeu=(c.naoRespondeu||0)+1;
  p.historico.push({tipo:'nao_respondeu',area:k,data:hoje,em:hoje});
  salvar(); tudo();
  toast(p.nome+' ('+area(k).nome.toLowerCase()+') volta para a lista amanhã ('+
    D.br(c.adiadaPara)+').');
}
function desmarcar(id,k){
  const p=pac(id), c=ciclo(p,k); if(!c) return;
  c.agendamento=null;
  state.followups=state.followups.filter(f=>!(f.pacienteId===p.id&&f.area===k&&!f.feito));
  p.historico.push({tipo:'desmarcou',area:k,data:D.hoje(),em:D.hoje()});
  salvar(); fechar(); tudo();
  toast('Agendamento '+area(k).nome.toLowerCase()+' de '+p.nome+' desfeito.');
}

/* ---------- Ficha ---------- */
function modalFicha(id){
  const p=pac(id); if(!p) return;
  const hoje=D.hoje(), c=cat(p.categoriaId);
  const bl=(t,corpo)=>'<div style="margin-top:22px"><div style="font-size:10px;font-weight:600;'+
    'letter-spacing:.16em;text-transform:uppercase;color:var(--taupe);padding-bottom:8px;'+
    'margin-bottom:12px;border-bottom:1px solid var(--linha)">'+t+'</div>'+corpo+'</div>';

  const sitGeral=situacaoPac(p,hoje);
  let ciclosHTML='';
  areasDe(p).forEach(k=>{
    const cc=ciclo(p,k), r=resolver(p,k,hoje), a=area(k);
    let sit;
    if(r.estado==='pendente') sit=r.atraso>0?'precisa ser agendada — '+r.atraso+' dia(s) de atraso'
      :(r.primeiro?'aguardando o primeiro agendamento':'precisa ser agendada');
    else if(r.estado==='sessao_hoje') sit='sessão marcada para hoje';
    else if(r.estado==='agendado') sit='agendada para '+D.br(r.prazo)+' · '+relativo(r.prazo,hoje);
    else sit='no ciclo — volta à lista em '+D.br(r.aparece)+' ('+relativo(r.aparece,hoje)+')';
    ciclosHTML+='<div style="border:1px solid var(--linha);border-left:3px solid '+a.cor+
      ';border-radius:2px;padding:14px 16px;margin-bottom:10px">'+
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">'+
      '<b style="font-family:var(--serif);font-size:18px;font-weight:600">'+a.nome+'</b>'+
      '<span class="badge freq">'+I.loop(11)+' '+cc.freq+' dias</span>'+
      (cc.naoRespondeu>0?'<span class="badge soft">Sem resposta '+cc.naoRespondeu+'&times;</span>':'')+
      '<span style="flex:1"></span>'+
      '<button class="btn g sm" data-act="agendar" data-id="'+p.id+'" data-a="'+k+'">'+
        I.cal(12)+' Agendar</button></div>'+
      '<div class="card-body" style="margin:0">'+
        linha(I.cal(13),'Último atendimento: <b>'+(cc.ultimo?D.br(cc.ultimo):'—')+'</b>')+
        linha(I.cal(13),'Próximo prazo: <b>'+(r.prazo?D.br(r.prazo):'—')+'</b> — '+sit)+
      '</div>'+avisoCond(r)+'</div>';
  });
  if(!ciclosHTML) ciclosHTML='<span class="hintx">Nenhum ciclo cadastrado.</span>';

  let hist='<span class="hintx">Nada registrado ainda.</span>';
  if(p.historico.length){
    hist='<div style="display:flex;flex-direction:column;gap:8px">'+
      p.historico.slice().reverse().slice(0,14).map(x=>{
        const rot={sessao:'Sessão realizada',agendou:'Agendamento marcado',
          nao_respondeu:'Não respondeu',desmarcou:'Agendamento desfeito',
          fu:'Follow-up feito',importado:'Importada da planilha',
          maq_agendou:'Confirmada na máquina',maq_proxima:'Adiada para a próxima vinda',
          arquivou:'Paciente arquivada',restaurou:'Paciente restaurada'}[x.tipo]||x.tipo;
        const det=x.area?' · '+area(x.area).nome:(x.maquina?' · '+esc(x.maquina):'');
        return '<div style="display:flex;gap:12px;font-size:12.5px;align-items:baseline">'+
          '<span style="font-family:var(--serif);font-size:14px;font-weight:600;color:var(--teal);'+
          'min-width:86px">'+D.br(x.data)+'</span><span style="font-weight:300">'+rot+det+
          (x.fu?' · follow-up '+D.br(x.fu):'')+'</span></div>';
      }).join('')+'</div>';
  }
  let conds='<span class="hintx">Nenhuma condição registrada.</span>';
  if((p.condicoes||[]).length){
    conds=(p.condicoes||[]).slice().sort((a,b)=>a.inicio.localeCompare(b.inicio)).map(x=>{
      const ativa=hoje>=x.inicio&&hoje<=x.fim, passada=hoje>x.fim;
      return '<div class="cond-item" style="margin-bottom:8px;'+(passada?'opacity:.5;':'')+
        (ativa?'border-left-color:var(--alerta)':'')+'">'+I.plane(15)+
        '<div class="ci-t"><b>'+esc(x.texto)+'</b><span>'+D.br(x.inicio)+' a '+D.br(x.fim)+
        (ativa?' · em curso':(passada?' · encerrada':' · '+relativo(x.inicio,hoje)))+'</span></div></div>';
    }).join('');
  }
  const fu=state.followups.filter(f=>f.pacienteId===p.id).sort((a,b)=>b.data.localeCompare(a.data));

  abrir(cabecaModal(esc(p.nome),p.arquivada?'Ficha arquivada':'Ficha completa')+
    '<div class="modal-body">'+
      (p.arquivada?'<div class="note info" style="margin-bottom:18px">'+I.caixa(15)+
        '<div><b>Paciente arquivada'+(p.arquivadaEm?' em '+D.br(p.arquivadaEm):'')+'.</b> '+
        'Ela não aparece no Dashboard nem nas listas de máquina. Tudo aqui foi preservado — '+
        'é só restaurar quando ela voltar.</div></div>':'')+
      '<div class="card-meta">'+sitGeral.html+selCat(p)+selMaqs(p)+selCond(p,hoje)+
        (p.crmLeadId?'<span class="badge soft" title="Esta paciente veio de uma lead do CRM">'+
          'Vinculada ao CRM</span>':'')+'</div>'+
      ((p.whatsapp||p.origem)
        ? '<div class="card-body" style="margin:14px 0 0">'+
          (p.whatsapp?linha(I.info(13),'WhatsApp: <b>'+esc(p.whatsapp)+'</b>'):'')+
          (p.origem?linha(I.info(13),'Origem: <b>'+esc(nomeOrigem(p.origem)||p.origem)+'</b>'):'')+
          '</div>'
        : '')+
      bl('Ciclos',ciclosHTML)+
      bl('Observações',p.obs?'<div class="card-obs" style="margin:0">'+esc(p.obs)+'</div>'
        :'<span class="hintx">Sem observações.</span>')+
      bl('Condições',conds)+
      bl('Máquinas temporárias',(p.maquinas||[]).length
        ? '<div class="card-meta" style="margin:0">'+(p.maquinas||[]).map(mid=>{
            const m=maq(mid); if(!m) return '';
            const pv=vindasDa(mid,true)[0];
            return seloMaq(m,pv?' &middot; '+D.brc(pv.data):' &middot; sem data');
          }).join('')+'</div>'
        : '<span class="hintx">Não está marcada para nenhuma máquina temporária.</span>')+
      bl('Follow-ups',fu.length?'<div style="display:flex;flex-direction:column;gap:8px">'+
        fu.slice(0,8).map(f=>'<div style="display:flex;gap:12px;font-size:12.5px;align-items:baseline">'+
        '<span style="font-family:var(--serif);font-size:14px;font-weight:600;color:'+
        (f.feito?'var(--taupe)':'var(--teal)')+';min-width:86px">'+D.br(f.data)+'</span>'+
        '<span style="font-weight:300">'+(f.feito?'feito':'pendente')+
        (f.area?' · '+area(f.area).nome:'')+'</span></div>').join('')+'</div>'
        :'<span class="hintx">Nenhum follow-up.</span>')+
      bl('Histórico da agenda',hist)+
      bl('Alterações','<div id="ficha-auditoria"></div>')+
    '</div>'+
    '<div class="modal-foot">'+
      '<button class="btn q" data-act="excluir" data-id="'+p.id+'">'+I.trash(14)+' Excluir</button>'+
      '<span class="sep"></span>'+
      (p.arquivada
        ? '<button class="btn p" data-act="restaurar" data-id="'+p.id+'">'+I.volta(13)+
          ' Restaurar paciente</button>'
        : '<button class="btn g" data-act="arquivar" data-id="'+p.id+'">'+I.caixa(13)+
          ' Arquivar</button>'+
          '<button class="btn p" data-act="editar" data-id="'+p.id+'">'+I.edit(13)+
          ' Editar ficha</button>')+
    '</div>',true);

  /* O histórico da agenda conta o tratamento; este conta quem mexeu na
     ficha. São perguntas diferentes, então ficam em seções diferentes. */
  const caixaAud=document.getElementById('ficha-auditoria');
  if(caixaAud && window.FloreSerAuditoria){
    FloreSerAuditoria.montar(caixaAud,{
      modulo:'agenda', entidade:'paciente', entidadeId:p.id,
      api: corpo => api(Object.assign({token:SESSAO.token}, corpo)),
    });
  }
}

/* ---------- abrir a ficha que a busca do portal pediu ---------- */
function pedidoDaBarra(chave){
  try{
    const v=new URLSearchParams(location.search).get(chave);
    return v?String(v):'';
  }catch(e){ return ''; }
}

function limparBarra(){
  /* sem isto, todo recarregamento reabriria a mesma ficha */
  try{ history.replaceState(null,'',location.pathname); }catch(e){}
}

function abrirFichaPedida(){
  const id=pedidoDaBarra('paciente');
  if(!id) return;
  limparBarra();
  /* vale para arquivada também: a ficha é a mesma */
  if(!pac(id)){ toast('A paciente deste link não está mais na agenda.',true); return; }
  modalFicha(id);
}

/* ---------- Confirmação ---------- */
let pendenteFn=null;
/* Mover para a lixeira é operação do servidor: ele tira a paciente das abas,
   guarda a ficha inteira e devolve a revisão nova. Aqui só acompanhamos o
   que ele já fez, para a tela não ficar mostrando quem saiu. */
async function paraLixeira(id,nome,motivo){
  try{
    const r=await api({acao:'lixeira_mover',token:SESSAO.token,tipo:'agenda',id:id,motivo:motivo||''});
    if(!r||!r.ok){
      if(r&&r.erro==='sem_acesso'){ toast('Você não possui acesso a este módulo.',true); return; }
      toast('Não foi possível concluir a operação. Tente novamente.',true); return;
    }
    if(typeof r.rev==='number') SESSAO.rev=r.rev;
    state.pacientes=state.pacientes.filter(x=>x.id!==id);
    state.followups=state.followups.filter(f=>f.pacienteId!==id);
    state.vindas.forEach(v=>{ if(v.resp) delete v.resp[id]; });
    if(ui.editId===id){ ui.editId=null; ui.pacSub='todas'; }
    tudo();
    toast(nome+' foi movida para a lixeira.');
  }catch(e){
    toast('Não foi possível concluir a operação. Tente novamente.',true);
  }
}

function confirmar(titulo,texto,rotulo,fn){
  pendenteFn=fn;
  abrir(cabecaModal(titulo)+
    '<div class="modal-body"><div class="note warn">'+I.warn(15)+'<div>'+texto+'</div></div></div>'+
    '<div class="modal-foot"><button class="btn g" data-act="fechar">Cancelar</button>'+
    '<button class="btn p" data-act="confirmou" style="background:var(--alerta)">'+rotulo+
    '</button></div>');
}

/* ==========================================================
   IMPORTAR DO EXCEL
   ========================================================== */
const COLS={
  nome:['nome','paciente','nome da paciente','nome completo','cliente','nome do paciente'],
  facial:['facial','ciclo facial','facial (dias)','rosto'],
  corporal:['corporal','ciclo corporal','corporal (dias)','corpo'],
  capilar:['capilar','ciclo capilar','capilar (dias)','cabelo'],
  freq:['frequencia','frequência','intervalo','dias','periodicidade','retorno','ciclo'],
  cat :['categoria','categorias','grupo','tipo','classificacao','classificação'],
  maq :['maquinas','máquinas','maquina','máquina','equipamento','equipamentos','aparelho','aparelhos'],
  ult :['ultimo atendimento','último atendimento','ultimo agendamento','último agendamento',
        'ultima sessao','última sessão','data','ultima visita','última visita'],
  obs :['observacoes','observações','observacao','observação','obs','notas','nota','anotacoes']
};
function normH(s){
  return String(s==null?'':s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ');
}
function parseFreqOpt(v){
  const s=String(v==null?'':v).trim();
  if(!s) return null;
  if(/^(nao|não|n|-|x)$/i.test(s)) return null;
  const m=s.match(/\d+/); if(!m) return null;
  const n=+m[0]; if(!n) return null;
  return [7,15,30].reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a,7);
}
function parseData(v){
  if(v==null||v==='') return null;
  if(v instanceof Date&&!isNaN(v)) return D.s(v);
  if(typeof v==='number'&&v>20000&&v<80000){
    const dt=new Date(Math.round((v-25569)*864e5));
    if(!isNaN(dt)) return dt.getUTCFullYear()+'-'+p2(dt.getUTCMonth()+1)+'-'+p2(dt.getUTCDate());
  }
  const s=String(v).trim();
  let m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(m){ let y=+m[3]; if(y<100) y+=2000; return y+'-'+p2(+m[2])+'-'+p2(+m[1]); }
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return m[1]+'-'+p2(+m[2])+'-'+p2(+m[3]);
  return null;
}
let impPend=null;
function baixarModelo(){
  const aoa=[
    ['Nome','Facial','Corporal','Capilar','Categoria','Máquinas','Último atendimento','Observações'],
    ['Exemplo — apague esta linha',15,7,'','Pele madura','Soprano, Harmony','01/01/2026',
     'Pele sensível, prefere manhã'],
    ['Exemplo — apague esta linha','',30,'','','','','Só corporal, ainda sem histórico']
  ];
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[{wch:34},{wch:10},{wch:11},{wch:10},{wch:18},{wch:22},{wch:20},{wch:44}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Pacientes');
  XLSX.writeFile(wb,'Modelo_Pacientes_FloreSer.xlsx');
  toast('Planilha modelo baixada.');
}
function lerArquivo(file){
  const rd=new FileReader();
  rd.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',blankrows:false});
      processarAOA(aoa,file.name);
    }catch(err){
      document.getElementById('imp-res').innerHTML='<div class="note warn">'+I.warn(15)+
        '<div>Não consegui ler este arquivo. Verifique se é um .xlsx, .xls ou .csv válido.</div></div>';
    }
  };
  rd.readAsArrayBuffer(file);
}
function mapear(row){
  if(!Array.isArray(row)) return null;
  const m={nome:null,facial:null,corporal:null,capilar:null,freq:null,cat:null,maq:null,
           ult:null,obs:null};
  row.forEach((cel,j)=>{
    const h=normH(cel); if(!h) return;
    for(const k in COLS){
      if(m[k]==null&&COLS[k].some(a=>h===a||h.indexOf(a)===0)){ m[k]=j; return; }
    }
  });
  return m.nome!=null?m:null;
}
function processarAOA(aoa,nomeArq){
  const alvo=document.getElementById('imp-res');
  let hi=-1,mapa=null;
  for(let i=0;i<Math.min(aoa.length,12);i++){
    const m=mapear(aoa[i]);
    if(m&&m.nome!=null){ hi=i; mapa=m; break; }
  }
  if(hi<0){
    alvo.innerHTML='<div class="note warn">'+I.warn(15)+'<div><b>Não encontrei a coluna de nomes.</b> '+
      'Baixe a planilha modelo acima e use os mesmos títulos de coluna na primeira linha.</div></div>';
    return;
  }
  const linhas=[];
  for(let i=hi+1;i<aoa.length;i++){
    const r=aoa[i]; if(!r) continue;
    const nome=String(r[mapa.nome]==null?'':r[mapa.nome]).trim();
    if(!nome||/^exemplo/i.test(nome)) continue;
    const cic={};
    AREAK.forEach(k=>{ cic[k]=mapa[k]!=null?parseFreqOpt(r[mapa[k]]):null; });
    if(!AREAK.some(k=>cic[k])&&mapa.freq!=null){
      const leg=parseFreqOpt(r[mapa.freq]);
      if(leg) cic.facial=leg;
    }
    const it={nome:nome,ciclos:cic,
      catNome:mapa.cat!=null?String(r[mapa.cat]||'').trim():'',
      maqNomes:mapa.maq!=null?String(r[mapa.maq]||'').split(/[,;\/|]/)
        .map(s=>s.trim()).filter(Boolean):[],
      ult:mapa.ult!=null?parseData(r[mapa.ult]):null,
      obs:mapa.obs!=null?String(r[mapa.obs]||'').trim():''};
    if(it.ult&&it.ult>D.hoje()){ it.aviso='data futura ignorada'; it.ult=null; }
    const ex=state.pacientes.find(p=>p.nome.toLowerCase()===nome.toLowerCase());
    it.acao=ex?'atualizar':'nova'; it.exId=ex?ex.id:null;
    linhas.push(it);
  }
  if(!linhas.length){
    alvo.innerHTML='<div class="note warn">'+I.warn(15)+
      '<div>Encontrei o cabeçalho, mas nenhuma linha com nome preenchido.</div></div>';
    return;
  }
  impPend=linhas;
  const novas=linhas.filter(l=>l.acao==='nova').length;
  const rot={nome:'Nome',facial:'Facial',corporal:'Corporal',capilar:'Capilar',
    freq:'Frequência',cat:'Categoria',maq:'Máquinas',ult:'Último atendimento',obs:'Observações'};
  const encontradas=Object.keys(mapa).filter(k=>mapa[k]!=null).map(k=>rot[k]).join(' · ');
  alvo.innerHTML='<div class="note info" style="margin-bottom:18px">'+I.info(15)+
    '<div><b>'+esc(nomeArq)+'</b> — '+linhas.length+' linhas lidas · '+novas+' novas · '+
    (linhas.length-novas)+' já cadastradas.<br>Colunas reconhecidas: '+encontradas+'</div></div>'+
    '<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Nome</th>'+
    '<th>Ciclos</th><th>Categoria</th><th>Máquinas</th><th>Último atend.</th>'+
    '<th>Observações</th><th>Situação</th></tr></thead><tbody>'+
    linhas.slice(0,80).map(l=>'<tr><td><span class="nm">'+esc(l.nome)+'</span></td>'+
      '<td>'+(AREAK.some(k=>l.ciclos[k])
        ? AREAK.filter(k=>l.ciclos[k]).map(k=>'<span class="badge cat" style="background:'+
          area(k).cor+'22"><i style="background:'+area(k).cor+'"></i>'+area(k).nome+' '+
          l.ciclos[k]+'d</span>').join(' ')
        : '<span class="badge soft">'+(l.maqNomes.length?'Só máquinas':'Sem ciclo')+'</span>')+'</td>'+
      '<td>'+(l.catNome?esc(l.catNome):'—')+'</td>'+
      '<td>'+(l.maqNomes.length?esc(l.maqNomes.join(', ')):'—')+'</td>'+
      '<td>'+(l.ult?D.br(l.ult):'—')+'</td>'+
      '<td style="max-width:230px;font-weight:300;font-size:12.5px">'+(esc(l.obs)||'—')+'</td>'+
      '<td>'+(l.acao==='nova'?'<span class="badge ok">Nova</span>'
        :'<span class="badge soft">Atualizar</span>')+
      (l.aviso?' <span class="badge warn">'+l.aviso+'</span>':'')+'</td></tr>').join('')+
    '</tbody></table></div></div>'+
    (linhas.length>80?'<span class="hintx">Mostrando as 80 primeiras — todas as '+linhas.length+
      ' serão importadas.</span>':'')+
    '<div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">'+
    '<button class="btn p" data-act="imp-confirmar">'+I.check(13)+' Importar '+linhas.length+
    (linhas.length===1?' paciente':' pacientes')+'</button>'+
    '<button class="btn g" data-act="imp-cancelar">Cancelar</button></div>';
}
function confirmarImport(){
  if(!impPend) return;
  let novas=0,upd=0;
  impPend.forEach(l=>{
    let catId=null;
    if(l.catNome){
      let c=state.categorias.find(x=>x.nome.toLowerCase()===l.catNome.toLowerCase());
      if(!c){ c={id:uid(),nome:l.catNome,cor:PALETA[state.categorias.length%PALETA.length]};
        state.categorias.push(c); }
      catId=c.id;
    }
    const mids=[];
    l.maqNomes.forEach(n=>{
      let m=state.maquinas.find(x=>x.nome.toLowerCase()===n.toLowerCase());
      if(!m){ m={id:uid(),nome:n,cadencia:'',cor:PALETA[state.maquinas.length%PALETA.length],obs:''};
        state.maquinas.push(m); state.seedMaq=true; }
      if(mids.indexOf(m.id)<0) mids.push(m.id);
    });
    if(l.exId){
      const p=pac(l.exId);
      if(catId) p.categoriaId=catId;
      if(l.obs) p.obs=l.obs;
      if(mids.length) p.maquinas=mids;
      AREAK.forEach(k=>{
        if(!l.ciclos[k]) return;
        const ant=ciclo(p,k);
        if(ant){ ant.freq=l.ciclos[k]; if(l.ult) ant.ultimo=l.ult; }
        else p.ciclos[k]=novoCiclo(l.ciclos[k],l.ult);
      });
      upd++;
    } else {
      const cic={facial:null,corporal:null,capilar:null};
      AREAK.forEach(k=>{ if(l.ciclos[k]) cic[k]=novoCiclo(l.ciclos[k],l.ult); });
      state.pacientes.push(normalizar({id:uid(),nome:l.nome,ciclos:cic,categoriaId:catId,
        obs:l.obs,condicoes:[],maquinas:mids,
        historico:[{tipo:'importado',data:D.hoje(),em:D.hoje()}],criadoEm:D.hoje()}));
      novas++;
    }
  });
  impPend=null; salvar(); tudo();
  document.getElementById('imp-res').innerHTML='<div class="note info">'+I.check(15)+
    '<div><b>Importação concluída.</b> '+novas+' nova(s) e '+upd+' atualizada(s). '+
    'Veja a aba Pacientes.</div></div>';
  toast('Importação concluída: '+novas+' novas, '+upd+' atualizadas.');
}

/* ==========================================================
   DADOS E BACKUP
   ========================================================== */
function renderDados(){
  const el=document.getElementById('dados-view');
  const fuP=fuPendentes().length;
  el.innerHTML=
    (sinc!=='erro'
      ? '<div class="note info" style="margin-bottom:26px">'+I.check(15)+'<div><b>Sincronizado.</b> '+
        'Cada alteração vai para a planilha do Google em segundos, e você vê a mesma lista no '+
        'celular e no computador. Para consultar ou baixar, abra a planilha — mas evite editá-la '+
        'à mão enquanto alguém estiver usando a agenda.</div></div>'
      : '<div class="note warn" style="margin-bottom:26px">'+I.warn(15)+'<div><b>Sem conexão com a '+
        'planilha.</b> Suas alterações estão guardadas nesta aba e sobem sozinhas assim que a internet '+
        'voltar. Não feche a página até o rodapé voltar a dizer “Sincronizado”.</div></div>')+
    '<div class="stats">'+stat(ativas().length,'Pacientes ativas','hi')+
      stat(arquivadas().length,'Arquivadas','')+
      stat(state.categorias.length,'Categorias','')+
      stat(state.maquinas.length,'Máquinas','')+
      stat(fuP,'Follow-ups pendentes','')+
      stat(state.criado?D.brc(state.criado):'—','Em uso desde','')+'</div>'+
    '<div class="block"><div class="block-head"><h3>Backup</h3></div>'+
      '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
      '<button class="btn p" data-act="exp-json">'+I.down(13)+' Exportar backup (.json)</button>'+
      '<button class="btn g" data-act="imp-json">'+I.up(13)+' Restaurar backup</button>'+
      '<button class="btn g" data-act="exp-xlsx">'+I.down(13)+' Exportar pacientes (.xlsx)</button>'+
      '<input type="file" id="file-json" accept=".json" style="display:none"></div>'+
      '<p class="hintx" style="margin-top:14px;max-width:600px">O backup .json guarda tudo — '+
      'pacientes, ciclos, categorias, condições, follow-ups, máquinas e histórico. '+
      'Restaurar substitui os dados atuais.</p>'+
    '</div>'+
    (!state.pacientes.length
      ? '<div class="block"><div class="block-head"><h3>Conhecer o sistema</h3></div>'+
        '<button class="btn g" data-act="demo">'+I.eye(13)+' Carregar exemplo de demonstração</button>'+
        '<p class="hintx" style="margin-top:14px;max-width:600px">Cria algumas pacientes fictícias '+
        'em situações diferentes — atrasada, com dois ciclos, viajando, com follow-up, marcada '+
        'para máquina — para você ver como o Dashboard se comporta. Depois use “Apagar tudo”.</p></div>'
      : '')+
    '<div class="block"><div class="block-head"><h3>Apagar</h3></div>'+
      '<button class="btn q" data-act="zerar" style="border:1px solid var(--linha);padding:9px 17px">'+
      I.trash(14)+' Apagar tudo</button>'+
      '<p class="hintx" style="margin-top:14px">Remove todas as pacientes, categorias, máquinas e '+
      'histórico da planilha. Não tem como desfazer.</p></div>';
}
function baixar(nome,conteudo,tipo){
  const b=new Blob([conteudo],{type:tipo||'application/octet-stream'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b); a.download=nome;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},400);
}
function expJson(){
  baixar('backup_agenda_floreser_'+D.hoje()+'.json',JSON.stringify(state,null,2),'application/json');
  toast('Backup exportado.');
}
function expXlsx(){
  const hoje=D.hoje();
  const aoa=[['Nome','Facial','Último facial','Corporal','Último corporal','Capilar',
              'Último capilar','Categoria','Máquinas','Próximo prazo','Situação',
              'Condições','Observações']];
  state.pacientes.slice().sort((a,b)=>
    (a.arquivada?1:0)-(b.arquivada?1:0)||a.nome.localeCompare(b.nome,'pt-BR')).forEach(p=>{
    const c=cat(p.categoriaId), s=situacaoPac(p,hoje);
    const cel=k=>{ const cc=ciclo(p,k); return cc?cc.freq:''; };
    const ult=k=>{ const cc=ciclo(p,k); return cc&&cc.ultimo?D.br(cc.ultimo):''; };
    const sitTxt=String(s.html).replace(/<[^>]+>/g,'');
    aoa.push([p.nome,cel('facial'),ult('facial'),cel('corporal'),ult('corporal'),
      cel('capilar'),ult('capilar'),c?c.nome:'',
      (p.maquinas||[]).map(mid=>{const m=maq(mid);return m?m.nome:'';}).filter(Boolean).join(', '),
      s.prazo?D.br(s.prazo):'',sitTxt,
      (p.condicoes||[]).map(x=>x.texto+' ('+D.br(x.inicio)+'–'+D.br(x.fim)+')').join(' | '),p.obs]);
  });
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[{wch:28},{wch:8},{wch:14},{wch:10},{wch:15},{wch:9},{wch:14},{wch:16},
    {wch:20},{wch:14},{wch:22},{wch:30},{wch:40}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Pacientes');
  XLSX.writeFile(wb,'Pacientes_FloreSer_'+D.hoje()+'.xlsx');
  toast('Planilha exportada.');
}
function restaurar(file){
  const rd=new FileReader();
  rd.onload=e=>{
    try{
      const o=JSON.parse(e.target.result);
      if(!o||!Array.isArray(o.pacientes)) throw 0;
      state.pacientes=o.pacientes.map(normalizar);
      state.categorias=Array.isArray(o.categorias)?o.categorias:[];
      state.followups=Array.isArray(o.followups)?o.followups:[];
      state.maquinas=Array.isArray(o.maquinas)?o.maquinas:[];
      state.vindas=Array.isArray(o.vindas)?o.vindas:[];
      state.vindas.forEach(v=>{ v.resp=v.resp||{}; });
      state.seedMaq=!!o.seedMaq; state.criado=o.criado||D.hoje();
      salvar(); maturar(); tudo(); toast('Backup restaurado: '+state.pacientes.length+' pacientes.');
    }catch(err){ toast('Arquivo de backup inválido.',true); }
  };
  rd.readAsText(file);
}
function demo(){
  const h=D.hoje();
  const cs=[{id:uid(),nome:'Pele madura',cor:'#3B6E6A'},
            {id:uid(),nome:'Pós-parto',cor:'#B08968'},
            {id:uid(),nome:'Manutenção',cor:'#8C9A72'}];
  state.categorias=cs;
  if(state.maquinas.length<2)
    state.maquinas=[{id:uid(),nome:'Soprano',cadencia:'A cada 3 meses',cor:'#3B6E6A',obs:''},
                    {id:uid(),nome:'Harmony',cadencia:'Mensal',cor:'#B08968',obs:''}];
  const mk=(nome,ci,ciclos,obs,cond)=>normalizar({id:uid(),nome:nome,
    categoriaId:cs[ci]?cs[ci].id:null,obs:obs||'',condicoes:cond||[],maquinas:[],
    ciclos:ciclos,historico:[],criadoEm:h});
  const C=(f,u)=>novoCiclo(f,u);
  state.pacientes=[
    mk('Ana Paula',0,{facial:C(7,D.add(h,-9)),corporal:C(30,D.add(h,-5)),capilar:null},
      'Voltou a fazer o protocolo facial completo.'),
    mk('Beatriz M.',1,{facial:null,corporal:C(15,D.add(h,-14)),capilar:null},
      'Prefere horários de manhã.'),
    mk('Carolina R.',2,{facial:C(7,D.add(h,-6)),corporal:null,capilar:C(30,D.add(h,-10))},
      'Pele sensível — intervalo curto.'),
    mk('Denise F.',0,{facial:C(30,D.add(h,-30)),corporal:null,capilar:null},
      'Retorno mensal de manutenção.'),
    mk('Elisa T.',1,{facial:null,corporal:C(15,D.add(h,-2)),capilar:null},'Em série de sessões.'),
    mk('Fernanda L.',0,{facial:C(7,null),corporal:null,capilar:C(30,null)},
      'Primeira vez — indicação de cliente.'),
    mk('Gabriela S.',2,{facial:C(15,D.add(h,-13)),corporal:null,capilar:null},'Viagem marcada.',
      [{id:uid(),texto:'Viagem de trabalho',inicio:D.add(h,1),fim:D.add(h,6)}]),
    mk('Helena V.',0,{facial:null,corporal:null,capilar:C(30,D.add(h,-28))},
      'Evento da filha no fim do mês.',
      [{id:uid(),texto:'Casamento da filha',inicio:D.add(h,3),fim:D.add(h,4)}])
  ];
  const P=state.pacientes, sop=state.maquinas[0], har=state.maquinas[1];
  [0,2,4,6].forEach(i=>P[i].maquinas=[sop.id]);
  [1,3,6,7].forEach(i=>P[i].maquinas=(P[i].maquinas||[]).concat([har.id]));
  /* Beatriz já agendada, com follow-up */
  ciclo(P[1],'corporal').agendamento={data:D.add(h,2),temFollowUp:true};
  state.followups=[{id:uid(),pacienteId:P[1].id,area:'corporal',data:D.add(h,5),feito:false,
    agendamentoData:D.add(h,2),criadoEm:h}];
  /* Carolina com follow-up vencendo hoje */
  state.followups.push({id:uid(),pacienteId:P[2].id,area:'facial',data:h,feito:false,
    agendamentoData:D.add(h,-6),criadoEm:h});
  ciclo(P[3],'facial').naoRespondeu=2;
  /* vindas de máquina */
  const vHar={id:uid(),maquinaId:har.id,data:D.add(h,5),obs:'Chega de manhã, sai no fim do dia',
    resp:{},criadoEm:h};
  vHar.resp[P[1].id]={status:'agendada',em:h};
  state.vindas=[vHar,
    {id:uid(),maquinaId:sop.id,data:D.add(h,26),obs:'',resp:{},criadoEm:h},
    {id:uid(),maquinaId:har.id,data:D.add(h,-20),obs:'',resp:{},criadoEm:h}];
  /* exclusiva das máquinas — nenhum ciclo de retorno */
  const iso=mk('Isadora M.',2,{facial:null,corporal:null,capilar:null},
    'Só faz as máquinas quando elas vêm — sem pacote na clínica.');
  iso.maquinas=[sop.id,har.id];
  /* arquivada — plano encerrado */
  const joa=mk('Joana R.',1,{facial:null,corporal:novoCiclo(15,D.add(h,-62)),capilar:null},
    'Plano encerrado. Falou em voltar depois das férias.');
  joa.arquivada=true; joa.arquivadaEm=D.add(h,-12);
  joa.historico.push({tipo:'arquivou',data:D.add(h,-12),em:D.add(h,-12)});
  state.pacientes.push(iso,joa);
  state.seedMaq=true;
  salvar(); maturar(); tudo();
  toast('Exemplo carregado — veja o Dashboard.');
}

/* ==========================================================
   AVISOS RÁPIDOS
   ========================================================== */
let toastT=null;
function toast(msg,alerta){
  const el=document.getElementById('toast');
  el.innerHTML=(alerta?I.warn(15):I.check(15))+'<span>'+msg+'</span>';
  el.style.background=alerta?'#8A4A2C':'var(--teal-deep)';
  el.classList.add('on');
  clearTimeout(toastT);
  toastT=setTimeout(()=>el.classList.remove('on'),4200);
}

/* ==========================================================
   NAVEGAÇÃO
   ========================================================== */
function irPara(pg){
  ui.pg=pg;
  document.querySelectorAll('.page').forEach(s=>s.classList.remove('on'));
  document.getElementById('pg-'+pg).classList.add('on');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('on',b.dataset.pg===pg));
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('.nav button').forEach(b=>
  b.addEventListener('click',()=>irPara(b.dataset.pg)));
document.getElementById('dash-sub').addEventListener('click',e=>{
  const b=e.target.closest('button[data-sub]'); if(!b) return;
  ui.sub=b.dataset.sub;
  document.querySelectorAll('#dash-sub button').forEach(x=>x.classList.toggle('on',x===b));
  document.getElementById('view-hoje').style.display=ui.sub==='hoje'?'':'none';
  document.getElementById('view-semana').style.display=ui.sub==='semana'?'':'none';
});
document.getElementById('pac-sub').addEventListener('click',e=>{
  const b=e.target.closest('button[data-ps]'); if(!b) return;
  if(b.dataset.ps!=='nova') ui.editId=null;
  ui.pacSub=b.dataset.ps; renderPac();
});
document.getElementById('cat-add').addEventListener('click',addCategoria);
document.getElementById('cat-nome').addEventListener('keydown',e=>{
  if(e.key==='Enter') addCategoria(); });

/* ==========================================================
   AÇÕES (delegação)
   ========================================================== */
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]'); if(!b) return;
  const a=b.dataset.act, id=b.dataset.id, ar=b.dataset.a;
  switch(a){
    case 'fechar': fechar(); break;
    case 'confirmou': {
      const f=pendenteFn; pendenteFn=null;
      /* o campo some quando a janela fecha: leio antes */
      const campo=document.getElementById('motivo-lixeira');
      const motivo=campo?campo.value.trim():'';
      fechar(); if(f) f(motivo); break; }
    case 'agendar': modalAgendar(id,ar); break;
    case 'confirmar-agenda': confirmarAgenda(id,ar); break;
    case 'naoresp': naoRespondeu(id,ar); break;
    case 'desmarcar': desmarcar(id,ar); break;
    case 'ver': modalFicha(id); break;
    case 'editar':
      fechar(); ui.editId=id; ui.pacSub='nova'; irPara('pac'); renderPac(); break;
    case 'excluir': {
      const p=pac(id); if(!p) break;
      confirmar('Mover '+esc(p.nome)+' para a lixeira?',
        'A ficha sai das listas, das contagens e dos follow-ups, e pode ser restaurada '+
        'pelo painel de manutenção durante 30 dias. Os ciclos, as condições e o histórico '+
        'vão junto e voltam junto.'+
        '<label class="motivo-lixeira">Motivo (opcional)'+
        '<input id="motivo-lixeira" type="text" maxlength="120" '+
        'placeholder="Cadastro duplicado, criado por engano…"></label>',
        'Mover para lixeira',(motivo)=>{ paraLixeira(id,p.nome,motivo); });
      break; }
    case 'fu-feito': {
      const f=state.followups.find(x=>x.id===id); if(!f) break;
      f.feito=true; f.feitoEm=D.hoje();
      const p=pac(f.pacienteId);
      if(p) p.historico.push({tipo:'fu',area:f.area,data:f.data,em:D.hoje()});
      salvar(); tudo(); toast('Follow-up de '+(p?p.nome:'')+' concluído.'); break; }
    case 'fu-adiar': {
      const f=state.followups.find(x=>x.id===id); if(!f) break;
      f.data=D.add(D.hoje(),1); salvar(); tudo();
      toast('Follow-up adiado para '+D.br(f.data)+'.'); break; }
    case 'fu-remover': {
      const f=state.followups.find(x=>x.id===id); if(!f) break;
      state.followups=state.followups.filter(x=>x.id!==id); salvar(); tudo();
      toast('Follow-up removido.'); break; }
    case 'arquivar': {
      const p=pac(id); if(!p) break;
      const nfu=state.followups.filter(x=>x.pacienteId===id&&!x.feito).length;
      confirmar('Arquivar '+esc(p.nome)+'?',
        'Ela sai do Dashboard, do quadro semanal e das listas de máquina. Os ciclos, as condições '+
        'e o histórico ficam guardados — é só restaurar quando ela voltar.'+
        (nfu?' O'+(nfu>1?'s '+nfu+' follow-ups pendentes serão removidos':
          ' follow-up pendente será removido')+'.':''),
        'Arquivar',()=>{
          p.arquivada=true; p.arquivadaEm=D.hoje();
          p.historico.push({tipo:'arquivou',data:D.hoje(),em:D.hoje()});
          state.followups=state.followups.filter(x=>!(x.pacienteId===id&&!x.feito));
          if(ui.editId===id){ ui.editId=null; ui.pacSub='arquivadas'; }
          fechar(); salvar(); tudo(); toast(p.nome+' arquivada.');
        });
      break; }
    case 'restaurar': {
      const p=pac(id); if(!p) break;
      p.arquivada=false; p.arquivadaEm=null;
      p.historico.push({tipo:'restaurou',data:D.hoje(),em:D.hoje()});
      if(ui.pacSub==='arquivadas'&&!arquivadas().length) ui.pacSub='todas';
      fechar(); salvar(); tudo();
      toast(p.nome+' voltou para a lista ativa.');
      break; }
    case 'salvar-pac': salvarPaciente(); break;
    case 'cancelar-pac': ui.editId=null; ui.pacSub='todas'; renderPac(); break;
    case 'cond-add': ui.condTmp.push({texto:'',inicio:'',fim:''}); renderCond(); break;
    case 'cond-del': ui.condTmp.splice(+b.dataset.i,1); renderCond(); break;
    case 'ir-nova': fechar(); ui.editId=null; ui.pacSub='nova'; irPara('pac'); renderPac(); break;
    case 'ir-imp': irPara('imp'); break;
    case 'ir-maq': fechar(); irPara('maq'); break;
    case 'cat-editar': {
      const c=cat(id); if(!c) break;
      corEscolhida=c.cor;
      abrir(cabecaModal('Editar categoria')+
        '<div class="modal-body"><div class="fgrid one">'+
        '<div class="field"><label for="ec-nome">Nome</label>'+
        '<input type="text" id="ec-nome" value="'+esc(c.nome)+'" maxlength="40"></div>'+
        '<div class="field"><label>Cor</label><div class="swatches" id="ec-sw"></div></div>'+
        '</div></div><div class="modal-foot">'+
        '<button class="btn g" data-act="fechar">Cancelar</button>'+
        '<button class="btn p" data-act="cat-salvar" data-id="'+id+'">'+I.check(13)+
        ' Salvar</button></div>');
      const sw=document.getElementById('ec-sw');
      const pinta=()=>{ sw.innerHTML=PALETA.map(x=>'<button class="swatch'+
        (x===corEscolhida?' on':'')+'" data-cor="'+x+'" style="background:'+x+'"></button>').join('')+
        '<input type="color" id="ec-livre" value="'+corEscolhida+'">';
        sw.querySelectorAll('.swatch').forEach(s=>s.addEventListener('click',ev=>{
          ev.preventDefault(); corEscolhida=s.dataset.cor; pinta(); }));
        document.getElementById('ec-livre').addEventListener('input',ev=>{
          corEscolhida=ev.target.value;
          sw.querySelectorAll('.swatch').forEach(x=>x.classList.remove('on')); }); };
      pinta(); break; }
    case 'cat-salvar': {
      const c=cat(id); if(!c) break;
      const n=document.getElementById('ec-nome').value.trim();
      if(!n){ toast('A categoria precisa de um nome.',true); break; }
      c.nome=n; c.cor=corEscolhida; salvar(); fechar(); tudo(); toast('Categoria atualizada.'); break; }
    case 'cat-excluir': {
      const c=cat(id); if(!c) break;
      const n=state.pacientes.filter(p=>p.categoriaId===id).length;
      confirmar('Excluir a categoria “'+esc(c.nome)+'”?',
        n?('As '+n+' paciente(s) desta categoria continuam cadastradas — apenas ficam sem categoria.')
         :'Nenhuma paciente usa esta categoria.','Excluir categoria',()=>{
          state.categorias=state.categorias.filter(x=>x.id!==id);
          state.pacientes.forEach(p=>{ if(p.categoriaId===id) p.categoriaId=null; });
          if(ui.pacSub===id) ui.pacSub='todas';
          salvar(); tudo(); toast('Categoria excluída.');
        });
      break; }
    case 'maq-cor': corMaq=b.dataset.cor; pintaSwatchMaq(); break;
    case 'maq-add': addMaquina(); break;
    case 'vinda-add': addVinda(); break;
    case 'maq-pac': modalPacMaq(id); break;
    case 'pm-salvar': salvarPacMaq(id); break;
    case 'pm-todas': document.querySelectorAll('#pm-list .sel-item').forEach(it=>{
        if(it.style.display!=='none') it.querySelector('input').checked=true; }); break;
    case 'pm-nenhuma': document.querySelectorAll('#pm-list input').forEach(x=>x.checked=false); break;
    case 'mr-conf': mrConfirmar(b.dataset.v,id); break;
    case 'mr-nresp': mrNaoRespondeu(b.dataset.v,id); break;
    case 'mr-prox': mrProxima(b.dataset.v,id); break;
    case 'maq-editar': {
      const m=maq(id); if(!m) break;
      corMaq=m.cor;
      abrir(cabecaModal('Editar máquina')+
        '<div class="modal-body"><div class="fgrid one">'+
        '<div class="field"><label for="em-nome">Nome</label>'+
        '<input type="text" id="em-nome" maxlength="40" value="'+esc(m.nome)+'"></div>'+
        '<div class="field"><label for="em-cad">Periodicidade</label>'+
        '<input type="text" id="em-cad" maxlength="40" value="'+esc(m.cadencia||'')+'"></div>'+
        '<div class="field"><label>Cor</label>'+swatchesHTML('nm-cor',corMaq)+'</div>'+
        '</div></div><div class="modal-foot">'+
        '<button class="btn g" data-act="fechar">Cancelar</button>'+
        '<button class="btn p" data-act="maq-salvar" data-id="'+id+'">'+I.check(13)+
        ' Salvar</button></div>');
      break; }
    case 'maq-salvar': {
      const m=maq(id); if(!m) break;
      const n=(document.getElementById('em-nome').value||'').trim();
      if(!n){ toast('A máquina precisa de um nome.',true); break; }
      m.nome=n; m.cadencia=(document.getElementById('em-cad').value||'').trim(); m.cor=corMaq;
      salvar(); fechar(); tudo(); toast('Máquina atualizada.'); break; }
    case 'maq-excluir': {
      const m=maq(id); if(!m) break;
      const nv=state.vindas.filter(v=>v.maquinaId===id).length;
      const np=pacientesDaMaquina(id).length;
      confirmar('Excluir a máquina “'+esc(m.nome)+'”?',
        'Serão apagadas '+nv+' data(s) de vinda. As '+np+' paciente(s) continuam cadastradas — '+
        'apenas deixam de ser chamadas para esta máquina.','Excluir máquina',()=>{
          state.maquinas=state.maquinas.filter(x=>x.id!==id);
          state.vindas=state.vindas.filter(v=>v.maquinaId!==id);
          state.pacientes.forEach(p=>{ p.maquinas=(p.maquinas||[]).filter(x=>x!==id); });
          salvar(); tudo(); toast('Máquina excluída.');
        });
      break; }
    case 'vinda-editar': {
      const v=state.vindas.find(x=>x.id===id); if(!v) break;
      const m=maq(v.maquinaId);
      abrir(cabecaModal('Mudar a data',esc(m?m.nome:'')+' &middot; hoje marcada para '+D.br(v.data))+
        '<div class="modal-body"><div class="fgrid one">'+
        '<div class="field"><label for="ev-data">Nova data prevista</label>'+
        '<input type="date" id="ev-data" value="'+v.data+'"></div>'+
        '<div class="field"><label for="ev-obs">Observação</label>'+
        '<input type="text" id="ev-obs" maxlength="80" value="'+esc(v.obs||'')+'"></div>'+
        '</div><div class="note info" style="margin-top:16px">'+I.info(15)+
        '<div>As respostas já dadas (confirmadas, próxima vinda) são mantidas.</div></div></div>'+
        '<div class="modal-foot"><button class="btn g" data-act="fechar">Cancelar</button>'+
        '<button class="btn p" data-act="vinda-salvar" data-id="'+id+'">'+I.check(13)+
        ' Salvar</button></div>');
      break; }
    case 'vinda-salvar': {
      const v=state.vindas.find(x=>x.id===id); if(!v) break;
      const d=document.getElementById('ev-data').value;
      if(!D.ok(d)){ toast('Escolha a nova data.',true); break; }
      v.data=d; v.obs=(document.getElementById('ev-obs').value||'').trim();
      salvar(); fechar(); tudo(); toast('Data atualizada para '+D.br(d)+'.'); break; }
    case 'vinda-excluir': {
      const v=state.vindas.find(x=>x.id===id); if(!v) break;
      const m=maq(v.maquinaId);
      confirmar('Excluir esta vinda?',
        (m?esc(m.nome):'Máquina')+' em '+D.br(v.data)+'. As respostas registradas para ela '+
        'também serão apagadas.','Excluir vinda',()=>{
          state.vindas=state.vindas.filter(x=>x.id!==id);
          salvar(); tudo(); toast('Vinda removida.');
        });
      break; }
    case 'imp-modelo': baixarModelo(); break;
    case 'imp-confirmar': confirmarImport(); break;
    case 'imp-cancelar': impPend=null; document.getElementById('imp-res').innerHTML='';
      document.getElementById('file').value=''; break;
    case 'exp-json': expJson(); break;
    case 'exp-xlsx': expXlsx(); break;
    case 'imp-json': document.getElementById('file-json').click(); break;
    case 'demo': demo(); irPara('dash'); break;
    case 'zerar':
      confirmar('Apagar tudo?','Todas as pacientes, categorias, máquinas, vindas, follow-ups e '+
        'histórico serão removidos da planilha, em todos os aparelhos. Exporte um backup antes se tiver dúvida.',
        'Apagar tudo',()=>{
        state.pacientes=[]; state.categorias=[]; state.followups=[];
        state.maquinas=[]; state.vindas=[]; state.seedMaq=true;
        ui.pacSub='todas'; ui.editId=null; salvar(); tudo(); toast('Tudo apagado.');
      });
      break;
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='file-json'&&e.target.files[0]){ restaurar(e.target.files[0]); e.target.value=''; }
});
document.addEventListener('input',e=>{
  if(e.target.id==='nm-cor-livre'){ corMaq=e.target.value;
    document.querySelectorAll('#nm-cor .swatch').forEach(s=>s.classList.remove('on')); }
});

/* ==========================================================
   IMPORTAÇÃO — ÁREA DE ARQUIVO
   ========================================================== */
const drop=document.getElementById('drop'), file=document.getElementById('file');
drop.addEventListener('click',()=>file.click());
file.addEventListener('change',()=>{ if(file.files[0]) lerArquivo(file.files[0]); });
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{
  e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{
  e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop',e=>{
  const f=e.dataTransfer.files[0]; if(f) lerArquivo(f);
});

/* ==========================================================
   INÍCIO
   ========================================================== */
function cabecalhoData(){
  const h=D.hoje();
  document.getElementById('hoje-txt').innerHTML=D.longa(h)+'<span>'+D.dow(h)+'</span>';
}
function tudo(){ maturar(); cabecalhoData(); renderDash(); renderPac(); renderCat();
  renderMaq(); renderDados(); statusRodape(); }

/* ==========================================================
   ENTRADA
   ========================================================== */
const elPortao=document.getElementById('portao');
const elSenha =document.getElementById('portao-senha');
const elErro  =document.getElementById('portao-erro');
const elBtn   =document.getElementById('portao-btn');

/* de onde veio a sessão desta aba: a senha do módulo ou um usuário */
let origemSessao='senhaModulo';

document.body.style.overflow='hidden';

/* sessionStorage: vale para esta aba, neste navegador, neste aparelho */
function guardarToken(x){ try{ sessionStorage.setItem(CHAVE_TOKEN,x); }catch(e){} }
function tokenGuardado(){ try{ return sessionStorage.getItem(CHAVE_TOKEN)||''; }catch(e){ return ''; } }
function esquecerToken(){ try{ sessionStorage.removeItem(CHAVE_TOKEN); }catch(e){} }

const AVISO='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '+
  'stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 3.8 21 19.5H3L12 3.8Z"/>'+
  '<path d="M12 10v4M12 16.6v.4"/></svg>';

function avisar(texto){
  elErro.innerHTML = texto ? AVISO+'<span>'+texto+'</span>' : '';
}

function ocupado(ligado){
  elBtn.disabled=ligado; elBtn.classList.toggle('carregando',ligado);
  elBtn.textContent=ligado?'Conectando…':'Entrar'; elSenha.disabled=ligado;
}

/* Troca a senha por um token de sessão. A senha não fica guardada aqui nem
   é reenviada depois: daqui para a frente só o token viaja. */
async function entrar(senha){
  if(!senha){ elSenha.focus(); return; }
  ocupado(true); avisar('');
  try{
    const r=await api({acao:'entrar',modulo:'agenda',senha:senha});
    if(!r.ok){
      if(r.erro==='bloqueado'){
        avisar('Muitas tentativas erradas. Tente de novo em '+(r.minutos||15)+' minutos.');
      } else if(r.erro==='senha'){
        avisar('Senha incorreta. Confira e tente de novo.'+
          (r.restam?' Restam '+r.restam+' tentativas.':''));
      } else {
        avisar('Não foi possível falar com a planilha. Confira sua internet.');
      }
      elSenha.value=''; ocupado(false); elSenha.focus(); return;
    }
    SESSAO.token=r.token;
    guardarToken(r.token);
    await carregar();
    abrirApp();
  }catch(e){
    const erro=String(e&&e.message||e);
    avisar(erro==='ocupado'
      ? 'A planilha está ocupada. Tente de novo em instantes.'
      : 'Não foi possível falar com a planilha. Confira sua internet.');
    elSenha.value=''; ocupado(false); elSenha.focus();
  }
}

/* volta com o token guardado; se ele já não valer, o portão reaparece */
async function retomar(token){
  ocupado(true);
  SESSAO.token=token;
  try{
    await carregar();
    abrirApp();
  }catch(e){
    esquecerToken(); SESSAO.token=''; ocupado(false);
    if(String(e&&e.message||e)==='sessao') avisar('Sua sessão expirou. Informe a senha de novo.');
    elSenha.focus();
  }
}

async function sair(){
  const token=SESSAO.token;
  esquecerToken(); SESSAO.token='';
  try{ await api({acao:'sair',token:token}); }catch(e){ /* segue assim mesmo */ }
  location.reload();
}

/* ---------- entrada por usuário ----------
   A tela é a mesma do portal, servida pelo auth.js. Daqui só dizemos qual
   módulo estamos pedindo e o que fazer quando a pessoa entrar — não existe
   segunda tela nem segunda sessão. Quem decide a permissão é o Apps Script,
   em toda leitura e gravação. */

function abrirLoginDeUsuario(){
  avisar('');
  window.FloreSerAuth.abrirLogin({
    modulo:'agenda',
    aoEntrar: async function(r){
      SESSAO.token=r.token;
      origemSessao='usuario';
      try{ await carregar(); abrirApp(); }
      catch(e){ avisar('Não foi possível carregar os dados. Tente de novo.'); }
    },
  });
}

/* Volta com a sessão de usuário guardada neste navegador. A tela de
   espera é a do auth.js, a mesma dos três módulos: ela aparece antes da
   chamada e, se der errado, fica no lugar mostrando o motivo. */
async function retomarUsuario(){
  const entrou = await window.FloreSerAuth.tentarRetomar('agenda', {
    aoPedirSenha(){ elSenha.focus(); },
    aoEntrar(r){
      SESSAO.token=r.token;
      origemSessao='usuario';
      carregar().then(abrirApp).catch(()=>{
        avisar('Não foi possível carregar os dados. Tente de novo.');
      });
    },
  });
  if(!entrou) return false;

  SESSAO.token=window.FloreSerAuth.token();
  origemSessao='usuario';
  try{
    await carregar();
    abrirApp();
    /* agora sim: o módulo está na tela, a espera acabou */
    window.FloreSerAuth.encerrarRetomada();
    return true;
  }catch(e){
    /* a sessão valia; quem falhou foi a leitura dos dados */
    window.FloreSerAuth.atualizarRetomada({
      etapa:'erro', modulo:'agenda',
      mensagem:'Sua conta foi reconhecida, mas não foi possível carregar os dados. Tente de novo.',
      acoes:[{texto:'Tentar novamente',fn(){ location.reload(); }}],
    });
    return false;
  }
}

function abrirApp(){
  elPortao.remove();
  document.body.style.overflow='';
  setTimeout(abrirFichaPedida,0);
  if(origemSessao==='usuario' && window.FloreSerAuth){
    window.FloreSerAuth.montarIdentidade(document.getElementById('quemEsta'),
      function(){ location.reload(); });
    const sair=document.getElementById('btn-sair');
    /* o CSS do topo vence o [hidden], então escondo pelo display mesmo */
    if(sair) sair.style.display='none';   /* quem entrou como usuário sai pelo menu */
  }
  maturar();
  tudo();

  /* Se o site ficar aberto e o dia virar, tudo se recalcula sozinho */
  let diaAtual=D.hoje();
  setInterval(()=>{
    const h=D.hoje();
    if(h!==diaAtual){ diaAtual=h; tudo(); toast('Novo dia — a lista foi atualizada.'); }
  },60000);
}

elBtn.addEventListener('click',()=>entrar(elSenha.value.trim()));
elSenha.addEventListener('keydown',e=>{ if(e.key==='Enter') entrar(elSenha.value.trim()); });

const elOlho=document.getElementById('portao-olho');
elOlho.addEventListener('click',()=>{
  const estaVisivel = elSenha.type==='text';
  elSenha.type = estaVisivel ? 'password' : 'text';
  elOlho.classList.toggle('aberto', !estaVisivel);
  elOlho.setAttribute('aria-pressed', String(!estaVisivel));
  elOlho.setAttribute('aria-label', estaVisivel ? 'Mostrar senha' : 'Ocultar senha');
  elSenha.focus();
});

const btnSair=document.getElementById('btn-sair');
if(btnSair) btnSair.addEventListener('click',sair);

document.getElementById('ir-usuario').addEventListener('click',abrirLoginDeUsuario);

/* Ordem de tentativa: a sessão de usuário (que vale entre módulos) e, se
   não houver, a sessão da senha compartilhada desta aba.

   Quando existe usuário e a tentativa falha, paramos aqui de propósito: a
   tela do erro fica no ar. Deixar a sessão antiga da senha entrar por baixo
   esconderia o motivo, e a pessoa nunca saberia que a conta dela não abre
   este módulo. */
(async function(){
  if(window.FloreSerAuth && window.FloreSerAuth.token()){
    await retomarUsuario();
    return;
  }
  const guardado=tokenGuardado();
  if(guardado) retomar(guardado); else elSenha.focus();
})();
