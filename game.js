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
        updateWaitScreen();
        const ws=document.getElementById('wait-screen');
        if(G.phase!=='waiting'&&ws&&ws.style.display!=='none'){
          ws.style.display='none';
          document.getElementById('game-board').style.display='flex';
        }
        if(G.tradeState)checkIncomingTrade();
        render();
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
  myName=(document.getElementById('player-name').value.trim()||'プレイヤー1').slice(0,8);
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
  myName=(document.getElementById('player-name').value.trim()||'プレイヤー?').slice(0,8);
  const code=(document.getElementById('room-code-input').value.trim()).toUpperCase();
  if(code.length!==4){alert('4文字のコードを入力してください');return;}
  const {data,error}=await supabaseClient.from('rooms').select('state').eq('code',code).single();
  if(error||!data){alert('ルームが見つかりません');return;}
  const st=data.state;
  if(st.phase!=='waiting'){alert('このルームはすでにゲーム中です');return;}
  if(st.players.length>=5){alert('満員です（最大5人）');return;}
  const seat=st.players.length;
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
  G.players.forEach(p=>{p.hand=deck.splice(0,5).map(c=>({...c}));});
  G.deck=deck;G.phase='reveal';G.turnOrder=[];G.curPos=0;
  G.turnsDone=0;G.selCards=[];G.tradeState=null;
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
function cardImgURL(suit,value){
  const s={spades:'スペード',hearts:'ハート',diamonds:'ダイヤ',clubs:'クラブ'}[suit];
  const n=value===14?1:value;
  return`${CARDS_URL}/${s}_${n}.png`;
}

// ===================== STATE =====================
let G={};

function cardHTML(c,opts={}){
  if(!c||opts.back)return`<div class="card sm back ${opts.extra||''}"></div>`;
  const rev=c.revealed?' rev':'';
  const sel=opts.sel?' sel':'';
  const clk=opts.click?' click':'';
  const sz=opts.sm?' sm':'';
  const fn=opts.fn?` onclick="${opts.fn}(${opts.idx})"`:''
  return`<div class="card${rev}${sel}${clk}${sz}"${fn}>
    <img src="${cardImgURL(c.suit,c.value)}" class="card-img" alt="${VD[c.value]}${SYM[c.suit]}" draggable="false">
  </div>`;
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
  G={
    online:false,
    phase:'reveal',
    players:Array.from({length:n},(_,i)=>({id:i,name:names[i],isHuman:i===0,hand:[]})),
    deck:shuffle(mkDeck()),
    turnOrder:[],
    curPos:0,
    turnsDone:0,
    selCards:[],
    tradeState:null,
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
  if(G.turnsDone>=G.players.length*2){doShowdown();return;}
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
      G.phase='showdown';
      pushState().then(()=>doShowdown());
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
  G.phase='human-draw';
  G.msg='捨てるカードをクリックしてください。';
  render();
}

function clickDiscard(i){
  const p=myPlayer();
  const was=p.hand[i].revealed;
  p.hand.splice(i,1);
  const nc=G.deck.shift();nc.revealed=was;
  p.hand.push(nc);
  G.msg=was?'開示カードを捨てたため、引いたカードも開示状態になります。':'カードを交換しました。';
  G.phase='turn-end';
  if(G.online){pushState().then(()=>{render();setTimeout(endTurn,1400);});}
  else{render();setTimeout(endTurn,1400);}
}

function cancelDraw(){G.phase='human-action';G.msg='あなたのターンです。行動を選んでください。';render();}

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
    h+=`</div></div><div class="ms"><label>提示するカード（1枚以上）：</label><div class="mc" id="mc"></div></div>`;
    h+=`<div class="mb"><button class="btn btn-ok" id="prop-btn" onclick="proposeToAI()" ${(!ts.targetIdx&&ts.targetIdx!==0)||ts.offerIdx.length===0?'disabled':''}>提案する</button>
    <button class="btn btn-cancel" onclick="cancelModal()">キャンセル</button></div>`;
    mb.innerHTML=h;
    let ch='';
    myPlayer().hand.forEach((c,i)=>{
      ch+=cardHTML(c,{click:true,sel:ts.offerIdx.includes(i),fn:'toggleOffer',idx:i});
    });
    document.getElementById('mc').innerHTML=ch;
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
  const h=myPlayer(),ai=G.players[ts.targetIdx];
  const hGive=ts.offerIdx.map(i=>({...h.hand[i]}));
  const aGive=ts.aiGive.map(i=>({...ai.hand[i]}));
  [...ts.offerIdx].sort((a,b)=>b-a).forEach(i=>h.hand.splice(i,1));
  [...ts.aiGive].sort((a,b)=>b-a).forEach(i=>ai.hand.splice(i,1));
  aGive.forEach(c=>h.hand.push(c));
  hGive.forEach(c=>ai.hand.push(c));
  closeModal();G.msg=`${ai.name} とカードを交換しました！`;G.phase='turn-end';render();
  setTimeout(endTurn,1300);
}

function execOnlineTrade(){
  const ts=G.tradeState;if(!ts||ts.phase!=='accepted')return;
  const proposer=G.players[ts.proposerIdx];
  const target=G.players[ts.targetIdx];
  const pGive=ts.offeredCards.map(c=>{const nc={...c};delete nc.origIdx;return nc;});
  const tGive=ts.giveCards||[];
  const pIdxs=ts.offeredCards.map(c=>c.origIdx).sort((a,b)=>b-a);
  pIdxs.forEach(i=>proposer.hand.splice(i,1));
  const tIdxs=(ts.giveIdx||[]).sort((a,b)=>b-a);
  tIdxs.forEach(i=>target.hand.splice(i,1));
  tGive.forEach(c=>proposer.hand.push(c));
  pGive.forEach(c=>target.hand.push(c));
  G.tradeState=null;G.msg='カード交換が完了しました！';G.phase='turn-end';
  closeModal();
  pushState().then(()=>{render();setTimeout(endTurn,1300);});
}

function tradeEnd(){closeModal();G.phase='turn-end';G.msg='提案が拒否されました。';render();setTimeout(endTurn,1200);}

// ===================== INCOMING TRADE (AI→human) =====================
function showIncoming(pi,cards,targetIdx){
  G.tradeState={phase:'incoming',proposerIdx:pi,targetIdx:targetIdx??myIdx,offeredCards:cards,giveIdx:[]};
  const pname=G.players[pi].name;
  openModal(`${pname} からの交換提案`);
  let ch=cards.map(c=>c.revealed?cardHTML(c):`<div class="card sm back"></div>`).join('');
  document.getElementById('modal-body').innerHTML=`
    <div class="ms"><label>${pname} が${cards.length}枚を提示しています：</label><div class="mc">${ch}</div></div>
    <p style="color:#8a7a6a;font-size:.82rem;text-align:center">承諾すると手札から${cards.length}枚選んで交換します。</p>
    <div class="mb">
      <button class="btn btn-accept" onclick="acceptIncoming()">承諾する</button>
      <button class="btn btn-reject" onclick="rejectIncoming()">拒否する</button>
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

function acceptIncoming(){
  const ts=G.tradeState;ts.phase='incoming-give';
  document.getElementById('modal-title').textContent='渡すカードを選んでください';
  renderIncomingGive();
}

function renderIncomingGive(){
  const ts=G.tradeState;
  let ch=myPlayer().hand.map((c,i)=>
    cardHTML(c,{click:true,sel:ts.giveIdx.includes(i),fn:'toggleGive',idx:i})
  ).join('');
  document.getElementById('modal-body').innerHTML=`
    <p style="color:#8a7a6a;font-size:.85rem;text-align:center;margin-bottom:10px">${ts.offeredCards.length}枚選んでください</p>
    <div class="mc">${ch}</div>
    <div class="mb"><button class="btn btn-ok" id="give-btn" onclick="execIncoming()" ${ts.giveIdx.length!==ts.offeredCards.length?'disabled':''}>交換する</button></div>`;
}

function toggleGive(i){
  const ts=G.tradeState;const x=ts.giveIdx.indexOf(i);
  if(x>=0)ts.giveIdx.splice(x,1);
  else if(ts.giveIdx.length<ts.offeredCards.length)ts.giveIdx.push(i);
  renderIncomingGive();
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
  const h=myPlayer(),ai=G.players[ts.proposerIdx];
  const hGive=ts.giveIdx.map(i=>({...h.hand[i]}));
  const aGive=ts.offeredCards.map(c=>{const nc={...c};delete nc.origIdx;return nc;});
  [...ts.giveIdx].sort((a,b)=>b-a).forEach(i=>h.hand.splice(i,1));
  const aiIdx=ts.offeredCards.map(c=>c.origIdx).sort((a,b)=>b-a);
  aiIdx.forEach(i=>ai.hand.splice(i,1));
  aGive.forEach(c=>h.hand.push(c));
  hGive.forEach(c=>ai.hand.push(c));
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
  // フラッシュ/ストレート1枚差なら必ずドロー、それ以外は70%でドロー
  if(G.deck.length>0&&(oneAway||Math.random()<0.7)){
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
  return{rank,name,tb};
}

function cmpHands(a,b){
  if(a.rank!==b.rank)return a.rank-b.rank;
  for(let i=0;i<a.tb.length;i++)if(a.tb[i]!==b.tb[i])return a.tb[i]-b.tb[i];
  return 0;
}

// ===================== SHOWDOWN =====================
function doShowdown(){
  G.phase='showdown';
  if(G.online)pushState();
  const res=G.players.map(p=>({p,e:evalHand(p.hand)}));
  res.sort((a,b)=>cmpHands(b.e,a.e));
  const top=res[0];
  const winners=res.filter(r=>cmpHands(r.e,top.e)===0);
  const wtxt=winners.length>1?`引き分け！（${winners.map(w=>w.p.name).join('・')}）`:`${top.p.name} の勝利！`;
  let h=`<h2>${wtxt}</h2>`;
  res.forEach((r,idx)=>{
    const isW=winners.some(w=>w.p.id===r.p.id);
    let ch=r.p.hand.map(c=>cardHTML(c)).join('');
    h+=`<div class="sdp${isW?' win':''}" style="animation-delay:${idx*0.15}s">
    <div class="sdp-name">${r.p.name}${isW?' ◆':''}</div>
    <div class="mc">${ch}</div><div class="sdp-role">${r.e.name}</div></div>`;
  });
  h+=`<button class="btn btn-ok" onclick="restart()" style="margin-top:20px">もう一度プレイ</button>`;
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
    G.phase==='showdown'?'':
    `ラウンド ${r}/2　│　${pn} のターン`;
  document.getElementById('deck-info').textContent=`山札: ${G.deck?G.deck.length:0}枚`;
}

function oppBoxHTML(p,active,pos){
  const nonRev=p.hand.filter(c=>!c.revealed);
  const rev=p.hand.filter(c=>c.revealed);
  const nrH=nonRev.map(c=>cardHTML(c,{sm:true,back:true})).join('');
  const rH=rev.map(c=>cardHTML(c,{sm:true})).join('');
  const cards=`<div class="hand-row rev-row">${rH}</div>
    <div class="hand-row">${nrH}</div>`;
  return`<div class="opp-box pos-${pos}${active?' active':''}">
    <div class="opp-name">${p.name}</div>
    <div class="opp-sum">${revSum(p)}</div>
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
  document.getElementById('player-sum').textContent=`開示カード合計: ${revSum(p)}`;
  const isRevPhase=G.phase==='reveal';
  const isDrawPhase=G.phase==='human-draw';
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
    rev.forEach(x=>{row2+=cardHTML(x.c,{click:isDrawPhase,fn:isDrawPhase?'clickDiscard':null,idx:x.i});});
    document.getElementById('player-hand').innerHTML=
      `<div class="hand-row rev-row">${row2}</div>`+
      `<div class="hand-row">${row1||'<span style="font-size:.75rem;color:#555">（なし）</span>'}</div>`;
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
      h=`<button class="btn btn-draw" onclick="selectDraw()" ${G.deck.length===0?'disabled':''}>① カードを引く</button>
      <button class="btn btn-trade" onclick="selectTrade()">② カードを交換提案</button>`;
    }
  }else if(G.phase==='human-draw'){
    h=`<span style="color:#8a7a6a;font-size:.9rem;letter-spacing:.05em">捨てるカードをクリック</span>
    <button class="btn btn-cancel" onclick="cancelDraw()">キャンセル</button>`;
  }
  a.innerHTML=h;
}

window.addEventListener('load',initSupabase);
window.addEventListener('beforeunload',()=>{if(roomChannel)roomChannel.untrack();});
