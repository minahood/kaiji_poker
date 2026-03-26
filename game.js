// ===================== SUPABASE =====================
const SUPABASE_URL='https://bpefqgeiicomijaysxhu.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwZWZxZ2VpaWNvbWlqYXlzeGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MjY1MjEsImV4cCI6MjA5MDAwMjUyMX0.MYxA8lsQMBI3Yc5ZcMu35rEOnf5pdZ0BoP0xuMT2gg4';
let supabaseClient=null,myPlayerId=null,myIdx=0,myName='あなた',roomChannel=null;

function initSupabase(){
  if(typeof window.supabase==='undefined')return;
  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  myPlayerId=localStorage.getItem('kaiji_pid')||crypto.randomUUID();
  localStorage.setItem('kaiji_pid',myPlayerId);
}

function myPlayer(){return G.players?G.players[myIdx]:null;}

function isMyTurn(){
  if(!G.online)return true;
  if(!G.turnOrder||G.turnOrder.length===0)return false;
  const idx=G.turnOrder[G.curPos%G.turnOrder.length];
  return G.playerIds&&G.playerIds[idx]===myPlayerId;
}

async function pushState(){
  if(!G.online||!supabaseClient)return;
  await supabaseClient.from('rooms').update({state:G}).eq('code',G.roomCode);
}

function subscribeRoom(code){
  if(!supabaseClient)return;
  roomChannel=supabaseClient.channel(`room-${code}`);
  roomChannel
    .on('postgres_changes',
      {event:'UPDATE',schema:'public',table:'rooms',filter:`code=eq.${code}`},
      (payload)=>{
        const localSel=[...G.selCards||[]];
        G=payload.new.state;
        G.selCards=localSel;
        myIdx=G.playerIds?G.playerIds.indexOf(myPlayerId):0;
        if(G.phase==='disbanded'){showStartScreen();return;}
        updateWaitScreen();
        const ws=document.getElementById('wait-screen');
        if(G.phase!=='waiting'&&ws&&ws.style.display!=='none'){
          ws.style.display='none';
          document.getElementById('game-board').style.display='flex';
        }
        if(G.tradeState)checkIncomingTrade();
        const gb=document.getElementById('game-board');
        if(gb)gb.classList.add('no-anim');
        // Close showdown if new round started
        const sdBg=document.getElementById('sd-bg');
        if(G.phase==='reveal'&&sdBg&&sdBg.classList.contains('on'))sdBg.classList.remove('on');
        render();
        setTimeout(()=>{
          if(gb)gb.classList.remove('no-anim');
          if(G.phase==='showdown'&&sdBg&&!sdBg.classList.contains('on'))doShowdown();
        },0);
      }
    )
    .on('presence',{event:'leave'},({leftPresences})=>{
      if(!G.playerIds||G.phase!=='waiting')return;
      leftPresences.forEach(pr=>{
        const idx=G.playerIds.indexOf(pr.playerId);
        if(idx<0)return;
        G.players.splice(idx,1);
        G.playerIds.splice(idx,1);
        G.revealReady.splice(idx,1);
        // IDを詰め直す
        G.players.forEach((p,i)=>{p.id=i;});
        myIdx=G.playerIds.indexOf(myPlayerId);
        if(myIdx===0)pushState();
        updateWaitScreen();
      });
    })
    .subscribe(async(status)=>{
      if(status==='SUBSCRIBED')await roomChannel.track({playerId:myPlayerId});
    });
}

function checkIncomingTrade(){
  if(!G.online||!G.tradeState)return;
  const ts=G.tradeState;
  const mb=document.getElementById('modal-bg');
  if(ts.phase==='pending'&&G.playerIds[ts.targetIdx]===myPlayerId
    &&(!mb||!mb.classList.contains('on'))){
    showIncoming(ts.proposerIdx,ts.offeredCards,ts.targetIdx);
  }
  if(ts.phase==='accepted'&&G.playerIds[ts.proposerIdx]===myPlayerId){
    execOnlineTrade();
  }
  if(ts.phase==='rejected'&&G.playerIds[ts.proposerIdx]===myPlayerId){
    closeModal();G.tradeState=null;G.phase='turn-end';
    G.msg='提案が拒否されました。';render();setTimeout(endTurn,1200);
  }
}

// ===================== ROOM UI =====================
function showOnlineScreen(){
  document.getElementById('start-screen').style.display='none';
  const os=document.getElementById('online-screen');
  os.style.display='flex';os.style.flexDirection='column';
}

function showStartScreen(){
  ['online-screen','wait-screen','game-board'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
  const ss=document.getElementById('start-screen');
  ss.style.display='flex';ss.style.flexDirection='column';
  if(supabaseClient)supabaseClient.removeAllChannels();
  G={};myIdx=0;
}

function showWaitScreen(code){
  document.getElementById('online-screen').style.display='none';
  const ws=document.getElementById('wait-screen');
  ws.style.display='flex';ws.style.flexDirection='column';
  document.getElementById('wait-code').textContent=code;
  updateWaitScreen();
}

function updateWaitScreen(){
  const ws=document.getElementById('wait-screen');
  if(!ws||ws.style.display==='none')return;
  const pl=G.players||[];
  document.getElementById('wait-players').innerHTML=
    pl.map(p=>`<div class="wait-player">● ${p.name}</div>`).join('');
  const isHost=myIdx===0;
  const btn=document.getElementById('start-btn');
  if(btn)btn.style.display=(isHost&&pl.length>=2)?'block':'none';
  const msg=document.getElementById('wait-msg');
  if(msg)msg.textContent=isHost
    ?'他のプレイヤーを待っています...'
    :'ホストがゲームを開始するまで待ってください...';
}

async function createRoom(){
  if(!supabaseClient){alert('Supabase未接続');return;}
  myName=(document.getElementById('player-name').value.trim()||'ルームマスター').slice(0,8);
  const code=(Math.random().toString(36).slice(2,6)).toUpperCase();
  const state={online:true,roomCode:code,phase:'waiting',
    players:[{id:0,name:myName,isHuman:true,hand:[]}],
    playerIds:[myPlayerId],revealReady:[false],
    deck:[],turnOrder:[],curPos:0,turnsDone:0,selCards:[],tradeState:null,msg:''};
  const {error}=await supabaseClient.from('rooms').insert({code,state});
  if(error){alert('ルーム作成エラー: '+error.message);return;}
  G=state;myIdx=0;
  subscribeRoom(code);
  showWaitScreen(code);
}

async function joinRoomByInput(){
  if(!supabaseClient){alert('Supabase未接続');return;}
  const code=(document.getElementById('room-code-input').value.trim()).toUpperCase();
  if(code.length!==4){alert('4文字のコードを入力してください');return;}
  const {data,error}=await supabaseClient.from('rooms').select('state').eq('code',code).single();
  if(error||!data){alert('ルームが見つかりません');return;}
  const st=data.state;
  if(st.phase!=='waiting'){alert('このルームはすでにゲーム中です');return;}
  if(st.players.length>=5){alert('満員です（最大5人）');return;}
  const seat=st.players.length;
  myName=(document.getElementById('player-name').value.trim()||`プレイヤー${seat}`).slice(0,8);
  st.players.push({id:seat,name:myName,isHuman:true,hand:[]});
  st.playerIds.push(myPlayerId);
  st.revealReady.push(false);
  await supabaseClient.from('rooms').update({state:st}).eq('code',code);
  G=st;myIdx=seat;
  subscribeRoom(code);
  showWaitScreen(code);
}

async function startOnlineGame(){
  if(myIdx!==0){alert('ホストのみ開始できます');return;}
  const deck=shuffle(mkDeck());
  const n=G.players.length;
  G.players.forEach(p=>{
    if(p.chips===undefined)p.chips=7;
    p.chips=Math.max(0,p.chips-1);
    p.hand=deck.splice(0,5).map(c=>({...c}));
  });
  G.deck=deck;G.phase='reveal';G.turnOrder=[];G.curPos=0;
  G.turnsDone=0;G.pot=n;G.selCards=[];G.tradeState=null;G.bettingState=null;
  G.revealReady=G.players.map(()=>false);
  G.msg='手札から2枚クリックして開示するカードを選んでください';
  await pushState();
  document.getElementById('wait-screen').style.display='none';
  document.getElementById('game-board').style.display='flex';
  render();
}

// ===================== CONSTANTS =====================
const SUITS=['spades','hearts','diamonds','clubs'];
const SYM={spades:'♠',hearts:'♥',diamonds:'♦',clubs:'♣'};
const COL={spades:'blk',hearts:'red',diamonds:'red',clubs:'blk'};
const VD={2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A'};

const CARDS_URL='https://bpefqgeiicomijaysxhu.supabase.co/storage/v1/object/public/cards';
const CHIPS_URL='https://bpefqgeiicomijaysxhu.supabase.co/storage/v1/object/public/chips/chip_red.png';
function chipDisp(n){return`<img src="${CHIPS_URL}" class="chip-img" alt="チップ"> × ${n}`;}
function cardImgURL(suit,value){
  const s={spades:'spade',hearts:'heart',diamonds:'dia',clubs:'club'}[suit];
  const n=value===14?1:value;
  return`${CARDS_URL}/${s}_${n}.png`;
}

// ===================== STATE =====================
let G={};
let pendingDealIn=[];

function cardHTML(c,opts={}){
  if(!c||opts.back)return`<div class="card sm back ${opts.extra||''}"></div>`;
  const rev=c.revealed?' rev':'';
  const sel=opts.sel?' sel':'';
  const clk=opts.click?' click':'';
  const sz=opts.sm?' sm':'';
  const extra=opts.extra?` ${opts.extra}`:'';
  const fn=opts.fn?` onclick="${opts.fn}(${opts.idx})"`:''
  const hidx=opts.idx!==undefined?` data-hidx="${opts.idx}"`:''
  return`<div class="card${rev}${sel}${clk}${sz}${extra}"${fn}${hidx}>
    <img src="${cardImgURL(c.suit,c.value)}" class="card-img" alt="${VD[c.value]}${SYM[c.suit]}" draggable="false">
  </div>`;
}

function flyOutCards(hidxList){
  const ph=document.getElementById('player-hand');
  if(!ph)return;
  hidxList.forEach(hidx=>{
    const el=ph.querySelector(`[data-hidx="${hidx}"]`);
    if(!el)return;
    const r=el.getBoundingClientRect();
    const cl=el.cloneNode(true);
    cl.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;pointer-events:none;z-index:9999;animation:dealOut 0.3s ease-in both`;
    document.body.appendChild(cl);
    setTimeout(()=>cl.remove(),350);
  });
}

// ===================== DECK =====================
function mkDeck(){
  const d=[];
  for(const s of SUITS)for(let v=2;v<=14;v++)d.push({suit:s,value:v,revealed:false});
  return d;
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a;}

// ===================== INIT =====================
function startGame(n){
  myIdx=0;
  const names=['あなた','カズヤ','リョウ','ハル','ユキ'];
  const players=Array.from({length:n},(_,i)=>({id:i,name:names[i],isHuman:i===0,hand:[],chips:7}));
  players.forEach(p=>p.chips-=1);
  G={
    online:false,
    phase:'reveal',
    players,
    deck:shuffle(mkDeck()),
    turnOrder:[],
    curPos:0,
    turnsDone:0,
    pot:n,
    selCards:[],
    tradeState:null,
    bettingState:null,
    msg:''
  };
  G.players.forEach(p=>{p.hand=G.deck.splice(0,5).map(c=>({...c}));});
  document.getElementById('start-screen').style.display='none';
  ['online-screen','wait-screen'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
  document.getElementById('game-board').style.display='flex';
  G.msg='あなたの手札から2枚クリックして開示するカードを選んでください';
  render();
}

// ===================== REVEAL =====================
function aiReveal(p){
  const sorted=[...p.hand].map((c,i)=>({c,i})).sort((a,b)=>a.c.value-b.c.value);
  p.hand[sorted[0].i].revealed=true;
  p.hand[sorted[1].i].revealed=true;
}

function revSum(p){return p.hand.filter(c=>c.revealed).reduce((s,c)=>s+c.value,0);}

function clickReveal(i){
  const idx=G.selCards.indexOf(i);
  if(idx>=0)G.selCards.splice(idx,1);
  else if(G.selCards.length<2)G.selCards.push(i);
  render();
}

async function confirmReveal(){
  if(G.selCards.length!==2)return;
  if(G.online){
    const savedSel=[...G.selCards];
    const {data}=await supabaseClient.from('rooms').select('state').eq('code',G.roomCode).single();
    if(data){G=data.state;myIdx=G.playerIds.indexOf(myPlayerId);}
    G.selCards=savedSel;
  }
  G.selCards.forEach(i=>{myPlayer().hand[i].revealed=true;});
  G.selCards=[];
  if(G.online){
    G.revealReady[myIdx]=true;
    if(G.revealReady.every(r=>r)){
      G.players.filter(p=>!p.isHuman).forEach(p=>aiReveal(p));
      const sorted=[...G.players].map((p,i)=>({p,i,s:revSum(p)})).sort((a,b)=>a.s-b.s||a.i-b.i);
      G.turnOrder=sorted.map(x=>x.i);
      G.phase='human-action';
      const pi=curPlayerIdx();
      G.msg=`【ラウンド1】${G.players[pi].name} のターンです`;
    }else{
      G.msg='他のプレイヤーの開示を待っています...';
    }
    await pushState();
    render();
  }else{
    G.players.filter(p=>!p.isHuman).forEach(p=>aiReveal(p));
    const sorted=[...G.players].map((p,i)=>({p,i,s:revSum(p)})).sort((a,b)=>a.s-b.s||a.i-b.i);
    G.turnOrder=sorted.map(x=>x.i);
    G.phase='turn-start';
    nextTurn();
  }
}

// ===================== TURNS =====================
function curPlayerIdx(){return G.turnOrder[G.curPos%G.turnOrder.length];}

function nextTurn(){
  if(G.turnsDone>=G.players.length*2){startBetting();return;}
  const pi=curPlayerIdx();
  const p=G.players[pi];
  const r=Math.floor(G.turnsDone/G.players.length)+1;
  if(G.online){
    G.phase='human-action';
    G.msg=isMyTurn()
      ?`【ラウンド${r}】あなたのターンです。行動を選んでください。`
      :`【ラウンド${r}】${p.name} のターンです...`;
    render();
  }else if(p.isHuman){
    G.phase='human-action';
    G.msg=`【ラウンド${r}】あなたのターンです。行動を選んでください。`;
    render();
  }else{
    G.phase='ai-turn';
    G.msg=`【ラウンド${r}】${p.name} のターンです...`;
    render();
    setTimeout(()=>aiTurn(pi),1100);
  }
}

function endTurn(){
  G.turnsDone++;G.curPos++;G.selCards=[];G.tradeState=null;
  if(G.online){
    if(G.turnsDone>=G.players.length*2){
      startBetting();
    }else{
      const pi=curPlayerIdx();
      const r=Math.floor(G.turnsDone/G.players.length)+1;
      G.phase='human-action';
      G.msg=`【ラウンド${r}】${G.players[pi].name} のターンです`;
      pushState().then(()=>render());
    }
  }else{
    nextTurn();
  }
}

// ===================== DRAW =====================
function selectDraw(){
  if(G.deck.length===0){G.msg='山札が空です。トレードを選んでください。';render();return;}
  G.phase='human-draw-pick';
  G.msg='交換枚数を選んでください。';
  render();
}

function selectDraw1(){
  G.phase='human-draw';
  G.msg='捨てるカードをクリックしてください。';
  render();
}

function selectDraw2(){
  G.selDiscard=[];
  G.phase='human-draw2';
  G.msg='捨てる開示カードを2枚クリックしてください。';
  render();
}

function clickDiscard(i){
  flyOutCards([i]);
  const p=myPlayer();
  const round=Math.floor(G.turnsDone/G.players.length)+1;
  if(round===2){p.chips=Math.max(0,(p.chips||0)-1);G.pot=(G.pot||0)+1;}
  const was=p.hand[i].revealed;
  p.hand.splice(i,1);
  const nc=G.deck.shift();nc.revealed=was;
  p.hand.push(nc);
  pendingDealIn=[p.hand.length-1];
  G.msg=was?'開示カードを捨てたため、引いたカードも開示状態になります。':'カードを交換しました。';
  G.phase='turn-end';
  if(G.online){pushState().then(()=>{render();setTimeout(endTurn,1400);});}
  else{render();setTimeout(endTurn,1400);}
}

function clickDiscard2(i){
  const x=(G.selDiscard||[]).indexOf(i);
  if(x>=0)G.selDiscard.splice(x,1);
  else if((G.selDiscard||[]).length<2)G.selDiscard.push(i);
  render();
}

function confirmDiscard2(){
  if(!G.selDiscard||G.selDiscard.length!==2)return;
  const p=myPlayer();
  const round=Math.floor(G.turnsDone/G.players.length)+1;
  if(round===2){p.chips=Math.max(0,(p.chips||0)-2);G.pot=(G.pot||0)+2;}
  flyOutCards(G.selDiscard);
  [...G.selDiscard].sort((a,b)=>b-a).forEach(i=>p.hand.splice(i,1));
  const nc1=G.deck.shift();nc1.revealed=true;
  const nc2=G.deck.shift();nc2.revealed=true;
  p.hand.push(nc1);p.hand.push(nc2);
  pendingDealIn=[p.hand.length-2,p.hand.length-1];
  G.selDiscard=[];
  G.msg='開示カード2枚を交換しました。';
  G.phase='turn-end';
  if(G.online){pushState().then(()=>{render();setTimeout(endTurn,1400);});}
  else{render();setTimeout(endTurn,1400);}
}

function cancelDraw(){G.selDiscard=[];G.phase='human-action';G.msg='あなたのターンです。行動を選んでください。';render();}

// ===================== TRADE (human→AI) =====================
function selectTrade(){
  G.phase='human-trade';
  G.tradeState={phase:'pick',targetIdx:null,offerIdx:[]};
  openModal('カード交換の提案');renderModal();
}

function openModal(title){
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-bg').classList.add('on');
}
function closeModal(){document.getElementById('modal-bg').classList.remove('on');}

function renderModal(){
  const ts=G.tradeState;if(!ts)return;
  const mb=document.getElementById('modal-body');
  if(ts.phase==='pick'){
    let h=`<div class="ms"><label>交換する相手：</label><div>`;
    G.players.filter(p=>G.online?p.id!==myPlayer().id:!p.isHuman).forEach(p=>{
      h+=`<button class="tgt-btn${ts.targetIdx===p.id?' on':''}" onclick="pickTarget(${p.id})">${p.name}</button>`;
    });
    h+=`</div></div><div class="ms"><label>提示するカード（1枚以上）：</label><div class="incoming-hand" id="mc"></div></div>`;
    h+=`<div class="mb"><button class="btn btn-ok" id="prop-btn" onclick="proposeToAI()" ${(!ts.targetIdx&&ts.targetIdx!==0)||ts.offerIdx.length===0?'disabled':''}>提案する</button>
    <button class="btn btn-cancel" onclick="cancelModal()">キャンセル</button></div>`;
    mb.innerHTML=h;
    let row1='',row2='';
    myPlayer().hand.forEach((c,i)=>{
      const h=cardHTML(c,{click:true,sel:ts.offerIdx.includes(i),fn:'toggleOffer',idx:i});
      if(c.revealed)row2+=h;else row1+=h;
    });
    document.getElementById('mc').innerHTML=
      `<div class="hand-row rev-row">${row2}</div><div class="hand-row">${row1}</div>`;
  }else if(ts.phase==='deciding'){
    mb.innerHTML=`<p style="text-align:center;font-size:1.1rem">${G.players[ts.targetIdx].name} が考えています...</p>`;
  }else if(ts.phase==='rejected'){
    mb.innerHTML=`<p style="text-align:center;color:#e06060;font-size:1.1rem">${G.players[ts.targetIdx].name} に拒否されました。</p>
    <div class="mb"><button class="btn btn-ok" onclick="tradeEnd()">OK</button></div>`;
  }else if(ts.phase==='accepted'){
    const ai=G.players[ts.targetIdx];
    const got=ts.aiGive.map(i=>ai.hand[i]);
    let ch=got.map(c=>cardHTML(c)).join('');
    mb.innerHTML=`<p style="text-align:center;color:#6abd6a;font-size:1.05rem">${ai.name} が承諾しました！</p>
    <p style="color:#8a7a6a;font-size:.85rem;text-align:center;margin:8px 0">${ai.name} が渡すカード：</p>
    <div class="mc">${ch}</div>
    <div class="mb"><button class="btn btn-ok" onclick="execTrade()">交換する</button></div>`;
  }
}

function pickTarget(id){G.tradeState.targetIdx=id;renderModal();}
function toggleOffer(i){
  const ts=G.tradeState;const x=ts.offerIdx.indexOf(i);
  if(x>=0)ts.offerIdx.splice(x,1);else ts.offerIdx.push(i);
  renderModal();
}
function cancelModal(){closeModal();G.tradeState=null;G.phase='human-action';G.msg='あなたのターンです。';render();}

function proposeToAI(){
  const ts=G.tradeState;if(!ts||ts.targetIdx===null||ts.offerIdx.length===0)return;
  if(G.online){
    const offered=ts.offerIdx.map(i=>({...myPlayer().hand[i],origIdx:i}));
    G.tradeState={phase:'pending',proposerIdx:myIdx,targetIdx:ts.targetIdx,
      offeredCards:offered,giveIdx:[]};
    G.msg=`${G.players[ts.targetIdx].name} に交換を提案しています...`;
    closeModal();
    pushState().then(()=>render());
    return;
  }
  ts.phase='deciding';renderModal();
  setTimeout(()=>{
    const ai=G.players[ts.targetIdx];
    const offered=ts.offerIdx.map(i=>myPlayer().hand[i]);
    const accept=aiAccept(ai,offered);
    if(accept){
      ts.aiGive=aiPickGive(ai,ts.offerIdx.length);
      ts.phase='accepted';renderModal();
    }else{ts.phase='rejected';renderModal();}
  },1400);
}

function execTrade(){
  const ts=G.tradeState;
  flyOutCards(ts.offerIdx);
  const h=myPlayer(),ai=G.players[ts.targetIdx];
  const hGive=ts.offerIdx.map(i=>({...h.hand[i]}));
  const aGive=ts.aiGive.map(i=>({...ai.hand[i]}));
  [...ts.offerIdx].sort((a,b)=>b-a).forEach(i=>h.hand.splice(i,1));
  [...ts.aiGive].sort((a,b)=>b-a).forEach(i=>ai.hand.splice(i,1));
  aGive.forEach(c=>h.hand.push(c));
  hGive.forEach(c=>ai.hand.push(c));
  pendingDealIn=Array.from({length:aGive.length},(_,k)=>h.hand.length-aGive.length+k);
  closeModal();G.msg=`${ai.name} とカードを交換しました！`;G.phase='turn-end';render();
  setTimeout(endTurn,1300);
}

function execOnlineTrade(){
  const ts=G.tradeState;if(!ts||ts.phase!=='accepted')return;
  const isProposer=G.playerIds[ts.proposerIdx]===myPlayerId;
  const proposer=G.players[ts.proposerIdx];
  const target=G.players[ts.targetIdx];
  const pGive=ts.offeredCards.map(c=>{const nc={...c};delete nc.origIdx;return nc;});
  const tGive=ts.giveCards||[];
  if(isProposer)flyOutCards(ts.offeredCards.map(c=>c.origIdx));
  const pIdxs=ts.offeredCards.map(c=>c.origIdx).sort((a,b)=>b-a);
  pIdxs.forEach(i=>proposer.hand.splice(i,1));
  const tIdxs=(ts.giveIdx||[]).sort((a,b)=>b-a);
  tIdxs.forEach(i=>target.hand.splice(i,1));
  tGive.forEach(c=>proposer.hand.push(c));
  pGive.forEach(c=>target.hand.push(c));
  const newIdxs=isProposer&&tGive.length>0
    ?Array.from({length:tGive.length},(_,k)=>proposer.hand.length-tGive.length+k):[];
  G.tradeState=null;G.msg='カード交換が完了しました！';G.phase='turn-end';
  closeModal();
  pushState().then(()=>{
    render();
    if(newIdxs.length>0){
      const ph=document.getElementById('player-hand');
      newIdxs.forEach(hidx=>{const el=ph&&ph.querySelector(`[data-hidx="${hidx}"]`);if(el)el.classList.add('deal-in');});
    }
    setTimeout(endTurn,1300);
  });
}

function tradeEnd(){closeModal();G.phase='turn-end';G.msg='提案が拒否されました。';render();setTimeout(endTurn,1200);}

// ===================== INCOMING TRADE (AI→human) =====================
function showIncoming(pi,cards,targetIdx){
  G.tradeState={phase:'incoming',proposerIdx:pi,targetIdx:targetIdx??myIdx,offeredCards:cards,giveIdx:[]};
  openModal(`${G.players[pi].name} からの交換提案`);
  renderIncomingModal();
}

function renderIncomingModal(){
  const ts=G.tradeState;
  const pname=G.players[ts.proposerIdx].name;
  const n=ts.offeredCards.length;
  let offered=ts.offeredCards.map(c=>c.revealed?cardHTML(c):`<div class="card sm back"></div>`).join('');
  const p=myPlayer();
  let row1='',row2='';
  p.hand.forEach((c,i)=>{
    const sel=ts.giveIdx.includes(i);
    const h=cardHTML(c,{click:true,sel,fn:'toggleGive',idx:i});
    if(c.revealed)row2+=h;else row1+=h;
  });
  const ok=ts.giveIdx.length===n;
  document.getElementById('modal-body').innerHTML=`
    <div class="ms"><label>${pname} が提示するカード：</label>
      <div class="mc">${offered}</div></div>
    <div class="ms"><label>渡すカードを${n}枚選んでください：</label>
      <div class="incoming-hand">
        <div class="hand-row rev-row">${row2}</div>
        <div class="hand-row">${row1}</div>
      </div></div>
    <div class="mb">
      <button class="btn btn-ok" onclick="execIncoming()" ${ok?'':'disabled'}>交換</button>
      <button class="btn btn-reject" onclick="rejectIncoming()">拒否</button>
    </div>`;
}

function rejectIncoming(){
  if(G.online){
    G.tradeState={...G.tradeState,phase:'rejected'};
    closeModal();G.msg='交換を拒否しました。';render();
    pushState();
    return;
  }
  closeModal();G.msg='交換を拒否しました。';G.phase='turn-end';render();setTimeout(endTurn,1200);
}

function toggleGive(i){
  const ts=G.tradeState;const x=ts.giveIdx.indexOf(i);
  if(x>=0)ts.giveIdx.splice(x,1);
  else if(ts.giveIdx.length<ts.offeredCards.length)ts.giveIdx.push(i);
  renderIncomingModal();
}

function execIncoming(){
  const ts=G.tradeState;
  if(G.online){
    const giveCards=ts.giveIdx.map(i=>({...myPlayer().hand[i]}));
    G.tradeState={...ts,phase:'accepted',giveCards,giveIdx:ts.giveIdx};
    closeModal();G.msg='交換を承諾しました。交換結果を待っています...';
    pushState().then(()=>render());
    return;
  }
  flyOutCards(ts.giveIdx);
  const h=myPlayer(),ai=G.players[ts.proposerIdx];
  const hGive=ts.giveIdx.map(i=>({...h.hand[i]}));
  const aGive=ts.offeredCards.map(c=>{const nc={...c};delete nc.origIdx;return nc;});
  [...ts.giveIdx].sort((a,b)=>b-a).forEach(i=>h.hand.splice(i,1));
  const aiIdx=ts.offeredCards.map(c=>c.origIdx).sort((a,b)=>b-a);
  aiIdx.forEach(i=>ai.hand.splice(i,1));
  aGive.forEach(c=>h.hand.push(c));
  hGive.forEach(c=>ai.hand.push(c));
  pendingDealIn=Array.from({length:aGive.length},(_,k)=>h.hand.length-aGive.length+k);
  closeModal();G.msg=`${ai.name} とカードを交換しました！`;G.phase='turn-end';render();
  setTimeout(endTurn,1300);
}

// ===================== AI LOGIC =====================

// フラッシュ/ストレートまであと1枚かを判定
function aiIsOneAway(hand){
  // フラッシュ：同スートが4枚
  const sc={};hand.forEach(c=>{sc[c.suit]=(sc[c.suit]||0)+1;});
  if(Object.values(sc).some(n=>n===4))return true;
  // ストレート：4枚が連続
  const sorted=hand.map(c=>c.value).sort((a,b)=>a-b);
  for(let skip=0;skip<5;skip++){
    const sub=sorted.filter((_,k)=>k!==skip);
    const uniq=[...new Set(sub)].sort((a,b)=>a-b);
    if(uniq.length===4&&isConsecutive4(uniq))return true;
  }
  return false;
}

function isConsecutive4(v){
  if(v[3]-v[0]===3)return true;
  // A-2-3-4（エースローのストレート候補）
  if(v[0]===2&&v[1]===3&&v[2]===4&&v[3]===14)return true;
  return false;
}

// 捨てるカードを戦略的に選ぶ
function aiPickDiscard(hand){
  // 1. フラッシュまであと1枚 → スートが合わない1枚を捨てる
  const suitMap={};
  hand.forEach((c,i)=>{(suitMap[c.suit]=suitMap[c.suit]||[]).push(i);});
  for(const idxs of Object.values(suitMap)){
    if(idxs.length===4)return hand.findIndex((_,i)=>!idxs.includes(i));
  }

  // 2. ストレートまであと1枚 → 外れの1枚を捨てる
  const sorted=hand.map((c,i)=>({v:c.value,i})).sort((a,b)=>a.v-b.v);
  for(let skip=0;skip<5;skip++){
    const sub=sorted.filter((_,k)=>k!==skip).map(x=>x.v);
    const uniq=[...new Set(sub)].sort((a,b)=>a-b);
    if(uniq.length===4&&isConsecutive4(uniq))return sorted[skip].i;
  }

  // 3. スリーカード・フルハウス狙い → ペア・トリプル以外の最低値カードを捨てる
  const cnt={};hand.forEach(c=>{cnt[c.value]=(cnt[c.value]||0)+1;});
  const singles=hand.map((c,i)=>({c,i})).filter(x=>cnt[x.c.value]===1);
  if(singles.length>0)return singles.sort((a,b)=>a.c.value-b.c.value)[0].i;

  // フォールバック：最低値カードを捨てる
  return hand.map((c,i)=>({c,i})).sort((a,b)=>a.c.value-b.c.value)[0].i;
}

function aiTurn(pi){
  const p=G.players[pi];
  const discIdx=aiPickDiscard(p.hand);
  const oneAway=aiIsOneAway(p.hand);
  const round=Math.floor(G.turnsDone/G.players.length)+1;
  const revIdxs=p.hand.map((c,i)=>({c,i})).filter(x=>x.c.revealed).map(x=>x.i);
  const can2draw=G.deck.length>=2&&revIdxs.length>=2&&(round!==2||(p.chips||0)>=2);
  // 開示カード2枚が低値なら2枚交換（30%、1枚差完成中は使わない）
  if(can2draw&&!oneAway&&Math.random()<0.3){
    if(round===2){p.chips=Math.max(0,(p.chips||0)-2);G.pot=(G.pot||0)+2;}
    const toDiscard=revIdxs.slice(0,2).sort((a,b)=>b-a);
    toDiscard.forEach(i=>p.hand.splice(i,1));
    const nc1=G.deck.shift();nc1.revealed=true;
    const nc2=G.deck.shift();nc2.revealed=true;
    p.hand.push(nc1);p.hand.push(nc2);
    G.msg=`${p.name} が開示カード2枚を交換しました。`;G.phase='turn-end';render();
    setTimeout(endTurn,900);
  // フラッシュ/ストレート1枚差なら必ずドロー、それ以外は70%でドロー
  }else if(G.deck.length>0&&(oneAway||Math.random()<0.7)){
    if(round===2){p.chips=Math.max(0,(p.chips||0)-1);G.pot=(G.pot||0)+1;}
    const was=p.hand[discIdx].revealed;
    p.hand.splice(discIdx,1);
    const nc=G.deck.shift();nc.revealed=was;p.hand.push(nc);
    G.msg=`${p.name} がカードを1枚交換しました。`;G.phase='turn-end';render();
    setTimeout(endTurn,900);
  }else{
    const nonRev=p.hand.map((c,i)=>({c,i})).filter(x=>!x.c.revealed).sort((a,b)=>a.c.value-b.c.value);
    if(nonRev.length>0){
      const cnt=Math.min(nonRev.length,Math.random()<0.6?1:2);
      const offerIdxs=nonRev.slice(0,cnt).map(x=>x.i);
      const cards=offerIdxs.map(i=>({...p.hand[i],origIdx:i}));
      G.msg=`${p.name} があなたに交換を提案しています...`;render();
      setTimeout(()=>showIncoming(pi,cards),600);
    }else{
      if(G.deck.length>0){
        const di=aiPickDiscard(p.hand);
        const was=p.hand[di].revealed;p.hand.splice(di,1);
        const nc=G.deck.shift();nc.revealed=was;p.hand.push(nc);
      }
      G.msg=`${p.name} がカードを交換しました。`;G.phase='turn-end';render();
      setTimeout(endTurn,900);
    }
  }
}

function aiAccept(ai,offered){
  if(offered.some(c=>c.revealed))return Math.random()<0.75;
  return Math.random()<0.4;
}

function aiPickGive(ai,cnt){
  return ai.hand.map((c,i)=>({c,i})).sort((a,b)=>a.c.value-b.c.value).slice(0,cnt).map(x=>x.i);
}

// ===================== POKER EVAL =====================
function evalHand(cards){
  const vals=cards.map(c=>c.value).sort((a,b)=>a-b);
  const suits=cards.map(c=>c.suit);
  const isFlush=suits.every(s=>s===suits[0]);
  const uniq=[...new Set(vals)];
  let isStraight=false;
  if(uniq.length===5){
    if(vals[4]-vals[0]===4)isStraight=true;
    if(vals.join(',')===`2,3,4,5,14`)isStraight=true;
  }
  const cnt={};vals.forEach(v=>cnt[v]=(cnt[v]||0)+1);
  const grp=Object.entries(cnt).map(([v,c])=>({v:+v,c})).sort((a,b)=>b.c-a.c||b.v-a.v);
  const g=grp.map(x=>x.c);
  let rank,name;
  if(isFlush&&isStraight&&vals[4]===14&&vals[3]===13){rank=9;name='ロイヤルフラッシュ';}
  else if(isFlush&&isStraight){rank=8;name='ストレートフラッシュ';}
  else if(g[0]===4){rank=7;name='フォーカード';}
  else if(g[0]===3&&g[1]===2){rank=6;name='フルハウス';}
  else if(isFlush){rank=5;name='フラッシュ';}
  else if(isStraight){rank=4;name='ストレート';}
  else if(g[0]===3){rank=3;name='スリーカード';}
  else if(g[0]===2&&g[1]===2){rank=2;name='ツーペア';}
  else if(g[0]===2){rank=1;name='ワンペア';}
  else{rank=0;name='ハイカード';}
  const tb=grp.flatMap(x=>Array(x.c).fill(x.v));
  // Determine which card indices form the ranked combination
  let keyIdx;
  if(rank>=4){
    keyIdx=[0,1,2,3,4];
  }else if(rank===7){// four of a kind
    const kv=grp[0].v;
    keyIdx=cards.map((c,i)=>c.value===kv?i:-1).filter(i=>i>=0);
  }else if(rank===3){// three of a kind
    const kv=grp[0].v;
    keyIdx=cards.map((c,i)=>c.value===kv?i:-1).filter(i=>i>=0);
  }else if(rank===2){// two pair
    const kv1=grp[0].v,kv2=grp[1].v;
    keyIdx=cards.map((c,i)=>(c.value===kv1||c.value===kv2)?i:-1).filter(i=>i>=0);
  }else if(rank===1){// one pair
    const kv=grp[0].v;
    keyIdx=cards.map((c,i)=>c.value===kv?i:-1).filter(i=>i>=0);
  }else{// high card: just the top card
    const kv=grp[0].v;
    const idx=cards.map((c,i)=>c.value===kv?i:-1).filter(i=>i>=0);
    keyIdx=[idx[0]];
  }
  return{rank,name,tb,keyIdx};
}

function cmpHands(a,b){
  if(a.rank!==b.rank)return a.rank-b.rank;
  for(let i=0;i<a.tb.length;i++)if(a.tb[i]!==b.tb[i])return a.tb[i]-b.tb[i];
  return 0;
}

// ===================== SHOWDOWN =====================
const SUIT_STR={spades:4,hearts:3,diamonds:2,clubs:1};
function sortedHandHTML(hand,e){
  const sortFn=(a,b)=>a.c.value-b.c.value||SUIT_STR[b.c.suit]-SUIT_STR[a.c.suit];
  const ki=e&&e.keyIdx?e.keyIdx:[];
  const key=hand.map((c,i)=>({c,i})).filter(x=>ki.includes(x.i));
  const kick=hand.map((c,i)=>({c,i})).filter(x=>!ki.includes(x.i));
  key.sort(sortFn);kick.sort(sortFn);
  const keyH=key.map(x=>cardHTML(x.c)).join('');
  const kickH=kick.map(x=>cardHTML(x.c,{extra:'kicker'})).join('');
  return keyH+(kick.length>0?`<span class="kicker-sep"></span>${kickH}`:'');
}
function doShowdown(){
  G.phase='showdown';
  if(G.online)pushState();
  // Distribute pot to winner(s)
  const foldedIdx=G.bettingState?G.bettingState.foldedIdx:[];
  const activePlayers=G.players.filter(p=>!foldedIdx.includes(p.id));
  const evalPlayers=activePlayers.length>1?activePlayers:G.players;
  const res=evalPlayers.map(p=>({p,e:evalHand(p.hand)}));
  res.sort((a,b)=>cmpHands(b.e,a.e));
  const top=res[0];
  const winners=res.filter(r=>cmpHands(r.e,top.e)===0);
  const potWon=G.pot||0;
  const share=Math.floor(potWon/winners.length);
  winners.forEach(w=>{w.p.chips=(w.p.chips||0)+share;});
  if(potWon%winners.length>0)winners[0].p.chips++;
  G.pot=0;
  const wtxt=winners.length>1?`引き分け！（${winners.map(w=>w.p.name).join('・')}）`:`${top.p.name} の勝利！`;
  let h=`<h2>${wtxt}</h2>`;
  h+=`<div style="text-align:center;color:var(--gold-dim);font-size:0.85rem;margin-bottom:14px">ポット ${potWon}チップを獲得</div>`;
  res.forEach((r,idx)=>{
    const isW=winners.some(w=>w.p.id===r.p.id);
    let ch=sortedHandHTML(r.p.hand,r.e);
    h+=`<div class="sdp${isW?' win':''}" style="animation-delay:${idx*0.15}s">
    <div class="sdp-name">${r.p.name}${isW?' ◆':''} <span class="sd-chips">${chipDisp(r.p.chips)}</span></div>
    <div class="mc">${ch}</div><div class="sdp-role">${r.e.name}</div></div>`;
  });
  if(!G.online){
    const stillIn=G.players.filter(p=>(p.chips||0)>0);
    if(stillIn.length<=1){
      const gw=stillIn[0];
      h+=`<div style="text-align:center;font-size:1.1rem;color:var(--gold);margin:16px 0">${gw?gw.name+'の完全勝利！':'引き分け'}</div>`;
      h+=`<button class="btn btn-ok" onclick="restart()" style="margin-top:12px">タイトルへ戻る</button>`;
    }else{
      h+=`<button class="btn btn-ok" onclick="startNextRound()" style="margin-top:20px">次のゲームへ</button>`;
    }
  }else{
    h+=`<button class="btn btn-ok" onclick="restart()" style="margin-top:20px">終了</button>`;
  }
  document.getElementById('sd').innerHTML=h;
  document.getElementById('sd-bg').classList.add('on');
}

function restart(){
  document.getElementById('sd-bg').classList.remove('on');
  document.getElementById('game-board').style.display='none';
  if(G.online&&supabaseClient)supabaseClient.removeAllChannels();
  G={};myIdx=0;
  const ss=document.getElementById('start-screen');
  ss.style.display='flex';ss.style.flexDirection='column';
}

function disbandRoom(){
  if(!confirm('ルームを解散しますか？'))return;
  if(G.online){
    G.phase='disbanded';
    G.msg='ルームマスターがゲームを解散しました。';
    pushState().then(()=>showStartScreen());
  }else{
    showStartScreen();
  }
}

function startNextRound(){
  document.getElementById('sd-bg').classList.remove('on');
  // Eliminate 0-coin players
  G.players=G.players.filter(p=>(p.chips||0)>0);
  if(G.players.length<=1){
    const gw=G.players[0];
    G.phase='game-over';G.msg=gw?`${gw.name}の完全勝利！`:'引き分け';
    render();return;
  }
  // Re-index
  G.players.forEach((p,i)=>{p.id=i;if(!G.online)p.isHuman=(i===0);});
  myIdx=G.online?G.playerIds.indexOf(myPlayerId):0;
  // Ante
  G.pot=0;
  G.players.forEach(p=>{const ante=Math.min(1,(p.chips||0));p.chips=(p.chips||0)-ante;G.pot+=ante;});
  // Re-deal
  const deck=shuffle(mkDeck());
  G.players.forEach(p=>{p.hand=deck.splice(0,5).map(c=>({...c,revealed:false}));});
  G.deck=deck;G.phase='reveal';G.turnOrder=[];G.curPos=0;
  G.turnsDone=0;G.selCards=[];G.tradeState=null;G.bettingState=null;
  G.revealReady=G.players.map(()=>false);
  G.msg='手札から2枚クリックして開示するカードを選んでください';
  if(G.online)pushState();
  render();
}

// ===================== BETTING =====================
function startBetting(){
  G.bettingState={phase:'betting',order:[...G.turnOrder],pos:0,currentBet:0,foldedIdx:[],calledIdx:[]};
  G.phase='betting';
  G.msg='ベッティングラウンド';
  if(G.online){pushState();}
  else{advanceBetting();}
}

function advanceBetting(){
  const bs=G.bettingState;
  // Skip folded players
  let safety=0;
  while(bs.foldedIdx.includes(bs.order[bs.pos%bs.order.length])&&safety++<bs.order.length){bs.pos++;}
  const active=bs.order.filter(i=>!bs.foldedIdx.includes(i));
  if(active.length<=1||isRoundComplete()){endBetting();return;}
  const pi=bs.order[bs.pos%bs.order.length];
  G.msg=`${G.players[pi].name} のベット番です`;
  render();
  if(!G.players[pi].isHuman){setTimeout(()=>aiBettingTurn(pi),800);}
}

function isRoundComplete(){
  const bs=G.bettingState;
  const active=bs.order.filter(i=>!bs.foldedIdx.includes(i));
  return active.every(i=>bs.calledIdx.includes(i));
}

function bettingCheck(){processBetAction(myIdx,'check');}
function bettingCall(){processBetAction(myIdx,'call');}
function bettingFold(){processBetAction(myIdx,'fold');}
function bettingRaise(){
  const amt=parseInt(document.getElementById('raise-input')?.value)||1;
  processBetAction(myIdx,'raise',amt);
}

function processBetAction(pi,action,amount=0){
  const bs=G.bettingState;
  const p=G.players[pi];
  if(action==='check'){
    bs.calledIdx.push(pi);
  }else if(action==='call'){
    const pay=Math.min(bs.currentBet,(p.chips||0));
    p.chips=(p.chips||0)-pay;G.pot=(G.pot||0)+pay;
    bs.calledIdx.push(pi);
  }else if(action==='raise'){
    const active=bs.order.filter(i=>!bs.foldedIdx.includes(i));
    const maxRaise=Math.max(...active.map(i=>(G.players[i].chips||0)));
    const raise=Math.min(Math.max(1,amount),maxRaise);
    const pay=Math.min(raise,(p.chips||0));
    p.chips=(p.chips||0)-pay;G.pot=(G.pot||0)+pay;
    bs.currentBet=raise;
    bs.calledIdx=[pi];
  }else if(action==='fold'){
    bs.foldedIdx.push(pi);
    bs.calledIdx.push(pi);
  }
  bs.pos++;
  // Skip folded for next pos
  let safety=0;
  while(bs.foldedIdx.includes(bs.order[bs.pos%bs.order.length])&&safety++<bs.order.length){bs.pos++;}
  const active=bs.order.filter(i=>!bs.foldedIdx.includes(i));
  if(active.length<=1||isRoundComplete()){
    endBetting();
    if(G.online)pushState();
    return;
  }
  if(G.online){
    const nextPi=bs.order[bs.pos%bs.order.length];
    G.msg=`${G.players[nextPi].name} のベット番です`;
    pushState().then(()=>render());
  }else{
    advanceBetting();
  }
}

function aiBettingTurn(pi){
  const bs=G.bettingState;
  if(bs.currentBet===0){processBetAction(pi,'check');}
  else if((G.players[pi].chips||0)<=0){processBetAction(pi,'fold');}
  else{processBetAction(pi,'call');}
}

function endBetting(){
  G.bettingState.phase='done';
  doShowdown();
}

// ===================== POSITION =====================
function getPos(pid){
  const n=G.players.length,ai=pid-1;
  if(n===2)return'top';
  if(n===3)return ai===0?'left':'right';
  if(n===4){if(ai===0)return'top';if(ai===1)return'left';return'right';}
  if(ai===0)return'topleft';if(ai===1)return'topright';if(ai===2)return'left';return'right';
}

function getOppPos(idx,n){
  // idx: 0-based opponent index, n: number of opponents
  if(n===1)return'top';
  if(n===2)return idx===0?'left':'right';
  if(n===3){if(idx===0)return'top';if(idx===1)return'left';return'right';}
  if(idx===0)return'topleft';if(idx===1)return'topright';if(idx===2)return'left';return'right';
}

// ===================== RENDER =====================
function render(){
  renderOpponents();renderPlayer();renderActions();
  document.getElementById('msg').textContent=G.msg;
  const r=Math.min(Math.floor(G.turnsDone/G.players.length)+1,2);
  const pi=G.turnOrder.length?G.turnOrder[G.curPos%G.turnOrder.length]:-1;
  const pn=pi>=0?G.players[pi].name:'';
  document.getElementById('turn-info').textContent=
    G.phase==='reveal'?'── 開示フェーズ ──':
    G.phase==='betting'?'── ベッティングラウンド ──':
    G.phase==='showdown'?'':
    `ラウンド ${r}/2　│　${pn} のターン`;
  document.getElementById('deck-info').textContent=`山札: ${G.deck?G.deck.length:0}枚`;
  const potEl=document.getElementById('pot-info');
  if(potEl)potEl.textContent=(G.pot||0)>0?`ポット: ${G.pot}チップ`:'';
  const rc=document.getElementById('room-ctrl');
  if(rc)rc.innerHTML=myIdx===0?`<button class="btn btn-disband" onclick="disbandRoom()">ルームを解散</button>`:'';
}
}

function oppBoxHTML(p,active,pos){
  const nonRev=p.hand.filter(c=>!c.revealed);
  const rev=p.hand.filter(c=>c.revealed);
  const nrH=nonRev.map(c=>cardHTML(c,{sm:true,back:true})).join('');
  const rH=rev.map(c=>cardHTML(c,{sm:true})).join('');
  const cards=`<div class="hand-row rev-row">${rH}</div>
    <div class="hand-row">${nrH}</div>`;
  const chipsDisp=p.chips!==undefined?`<div class="opp-chips">${chipDisp(p.chips)}</div>`:'';
  return`<div class="opp-box pos-${pos}${active?' active':''}">
    <div class="opp-name">${p.name}</div>
    <div class="opp-sum">${revSum(p)}</div>
    ${chipsDisp}
    ${cards}
  </div>`;
}

function renderOpponents(){
  if(!G.players)return;
  const me=myPlayer();
  const pi=G.turnOrder.length?G.turnOrder[G.curPos%G.turnOrder.length]:-1;
  const zones={top:'',topleft:'',topright:'',left:'',right:''};
  const opponents=G.online&&me
    ?G.players.filter(p=>p.id!==me.id)
    :G.players.filter(p=>!p.isHuman);
  const n=G.players.length;
  opponents.forEach((p,idx)=>{
    const posIdx=G.online?((p.id-myIdx+n)%n-1):p.id-1;
    const pos=getOppPos(posIdx,opponents.length);
    const active=p.id===pi&&(G.online?true:['ai-turn','turn-end'].includes(G.phase));
    zones[pos]+=oppBoxHTML(p,active&&p.id===pi,pos);
  });
  const topH=zones.top||(zones.topleft||zones.topright
    ?`<div style="display:flex;gap:12px;justify-content:center">${zones.topleft}${zones.topright}</div>`:'');
  document.getElementById('top-zone').innerHTML=topH;
  document.getElementById('left-zone').innerHTML=zones.left;
  document.getElementById('right-zone').innerHTML=zones.right;
}

function renderPlayer(){
  const p=myPlayer();if(!p)return;
  const chipsStr=p.chips!==undefined?`　　${chipDisp(p.chips)}`:'';
  document.getElementById('player-sum').innerHTML=`開示カード合計: ${revSum(p)}${chipsStr}`;
  const isRevPhase=G.phase==='reveal';
  const isDrawPhase=G.phase==='human-draw';
  const isDraw2Phase=G.phase==='human-draw2';
  const selDiscard=G.selDiscard||[];
  let row1='',row2='';
  if(isRevPhase){
    p.hand.forEach((c,i)=>{
      const sel=G.selCards.includes(i);
      const h=cardHTML(c,{click:true,sel,fn:'clickReveal',idx:i});
      if(sel)row2+=h;else row1+=h;
    });
    document.getElementById('player-hand').innerHTML=
      `<div class="hand-row rev-row">${row2}</div>`+
      `<div class="hand-row">${row1}</div>`;
  }else{
    const nonRev=p.hand.map((c,i)=>({c,i})).filter(x=>!x.c.revealed);
    const rev=p.hand.map((c,i)=>({c,i})).filter(x=>x.c.revealed);
    nonRev.forEach(x=>{row1+=cardHTML(x.c,{click:isDrawPhase,fn:isDrawPhase?'clickDiscard':null,idx:x.i});});
    rev.forEach(x=>{
      const sel=isDraw2Phase&&selDiscard.includes(x.i);
      row2+=cardHTML(x.c,{click:isDrawPhase||isDraw2Phase,sel,fn:isDraw2Phase?'clickDiscard2':isDrawPhase?'clickDiscard':null,idx:x.i});
    });
    document.getElementById('player-hand').innerHTML=
      `<div class="hand-row rev-row">${row2}</div>`+
      `<div class="hand-row">${row1||'<span style="font-size:.75rem;color:#555">（なし）</span>'}</div>`;
  }
  if(pendingDealIn.length>0){
    const ph=document.getElementById('player-hand');
    pendingDealIn.forEach(hidx=>{const el=ph.querySelector(`[data-hidx="${hidx}"]`);if(el)el.classList.add('deal-in');});
    pendingDealIn=[];
  }
}

function renderActions(){
  const a=document.getElementById('action-area');
  let h='';
  if(G.phase==='reveal'){
    if(G.online&&G.revealReady&&G.revealReady[myIdx]){
      h=`<span style="color:var(--text-dim)">他のプレイヤーの開示を待っています...</span>`;
    }else{
      const n=G.selCards.length;
      h=`<button class="btn btn-ok" onclick="confirmReveal()" ${n!==2?'disabled':''}>${n}/2枚選択 → 開示確定</button>`;
    }
  }else if(G.phase==='human-action'){
    if(G.online&&!isMyTurn()){
      h=`<span style="color:var(--text-dim)">相手のターンを待っています...</span>`;
    }else{
      const round=Math.floor(G.turnsDone/G.players.length)+1;
      const cantDraw=G.deck.length===0||(round===2&&(myPlayer().chips||0)<=0);
      const drawLabel=round===2?'① カードを引く (-1チップ)':'① カードを引く';
      h=`<button class="btn btn-draw" onclick="selectDraw()" ${cantDraw?'disabled':''}>${drawLabel}</button>
      <button class="btn btn-trade" onclick="selectTrade()">② カードを交換提案</button>`;
    }
  }else if(G.phase==='betting'){
    const bs=G.bettingState;
    const pi=bs.order[bs.pos%bs.order.length];
    if(G.online&&G.playerIds[pi]!==myPlayerId){
      h=`<span style="color:var(--text-dim)">相手のベットを待っています...</span>`;
    }else if(!G.online&&!G.players[pi].isHuman){
      h=`<span style="color:var(--text-dim)">${G.players[pi].name} が考えています...</span>`;
    }else{
      const p=myPlayer();
      const active=bs.order.filter(i=>!bs.foldedIdx.includes(i));
      const maxRaise=active.length>0?Math.max(...active.map(i=>(G.players[i].chips||0))):0;
      h=`<button class="btn btn-cancel" onclick="bettingFold()">フォールド</button>
      ${bs.currentBet===0
        ?`<button class="btn btn-ok" onclick="bettingCheck()">チェック</button>`
        :`<button class="btn btn-ok" onclick="bettingCall()" ${(p.chips||0)>0?'':'disabled'}>コール (${Math.min(bs.currentBet,(p.chips||0))}チップ)</button>`}
      <div class="raise-ctrl">
        <input id="raise-input" type="number" class="raise-amt" min="1" max="${maxRaise}" value="1">
        <button class="btn btn-raise" onclick="bettingRaise()" ${maxRaise>0?'':'disabled'}>レイズ</button>
      </div>`;
    }
  }else if(G.phase==='human-draw-pick'){
    const round=Math.floor(G.turnsDone/G.players.length)+1;
    const p=myPlayer();
    const revCount=p.hand.filter(c=>c.revealed).length;
    const can2=G.deck.length>=2&&revCount>=2&&(round!==2||(p.chips||0)>=2);
    const cost2=round===2?' (-2チップ)':'';
    const cost1=round===2?' (-1チップ)':'';
    h=`<button class="btn btn-draw" onclick="selectDraw1()">1枚交換${cost1}</button>
    <button class="btn btn-draw" onclick="selectDraw2()" ${can2?'':'disabled'}>開示2枚交換${cost2}</button>
    <button class="btn btn-cancel" onclick="cancelDraw()">キャンセル</button>`;
  }else if(G.phase==='human-draw'){
    h=`<span style="color:#8a7a6a;font-size:.9rem;letter-spacing:.05em">捨てるカードをクリック</span>
    <button class="btn btn-cancel" onclick="cancelDraw()">キャンセル</button>`;
  }else if(G.phase==='human-draw2'){
    const n=(G.selDiscard||[]).length;
    h=`<span style="color:#8a7a6a;font-size:.9rem">開示カードを${n}/2枚選択中</span>
    <button class="btn btn-ok" onclick="confirmDiscard2()" ${n===2?'':'disabled'}>交換する</button>
    <button class="btn btn-cancel" onclick="cancelDraw()">キャンセル</button>`;
  }
  a.innerHTML=h;
}

window.addEventListener('load',initSupabase);
window.addEventListener('beforeunload',()=>{if(roomChannel)roomChannel.untrack();});
