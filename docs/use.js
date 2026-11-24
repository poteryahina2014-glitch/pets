/* «Что используем»: корм, наполнитель и свои блоки (p_periods, p_blocks), картинки (p_pics).
   Подключается до app.js; app.js вызывает makeUse(c) и передаёт общие функции. */
window.makeUse=function(c){
"use strict";
const {esc,fmt,today,addDays,daysBetween,plural,dueBadge,mine,P,openModal,closeModal,armDelete,toast,save,ins,upd,rm,wr,sb,$}=c;
const BASE={food:{name:"Корм",icon:"🥣"},litter:{name:"Наполнитель",icon:"🪣"}};
const blocks=()=>mine(c.S().blocks).sort((a,b)=>(a.ord||0)-(b.ord||0)||a.created_at.localeCompare(b.created_at));
const blockOf=x=>c.S().blocks.find(b=>b.id===x.block_id);
const groupName=x=>BASE[x.type]?BASE[x.type]:(b=>b?{name:b.name,icon:esc(b.icon||"📦")}:{name:"Без блока",icon:"📦"})(blockOf(x));

/* ---------- картинки: грузятся один раз, по надобности ---------- */
const pics=new Map();let picBusy=false;
async function loadPics(){
  const need=[...new Set(mine(c.S().periods).map(x=>x.pic_id).filter(id=>id&&!pics.has(id)))];
  if(!need.length||picBusy)return;
  picBusy=true;
  try{
    for(let i=0;i<need.length;i+=20){
      const part=need.slice(i,i+20),r=await sb.from("p_pics").select("id,data").in("id",part).order("id");
      if(r.error)throw r.error;
      part.forEach(id=>pics.set(id,""));
      r.data.forEach(x=>pics.set(x.id,x.data));
    }
    document.querySelectorAll("[data-pic]").forEach(el=>{const d=pics.get(el.dataset.pic);if(d)el.innerHTML=img(d)});
  }catch(e){console.error(e)}finally{picBusy=false}
}
const img=d=>/^data:image\//.test(d||"")?`<img src="${esc(d)}" alt="">`:"";
function picHTML(x,icon){const d=x.pic_id&&pics.get(x.pic_id);return `<span class="pic"${x.pic_id?` data-pic="${x.pic_id}"`:""}>${d?img(d):icon}</span>`}
// уменьшить до 400 px и ~60 КБ, чтобы помещалось в базу
function shrink(file){
  return new Promise((res,rej)=>{
    const url=URL.createObjectURL(file),im=new Image();
    im.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("не картинка"))};
    im.onload=()=>{
      const k=Math.min(1,400/Math.max(im.width,im.height)),cv=document.createElement("canvas");
      cv.width=Math.max(1,Math.round(im.width*k));cv.height=Math.max(1,Math.round(im.height*k));
      const g=cv.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,cv.width,cv.height);g.drawImage(im,0,0,cv.width,cv.height);
      URL.revokeObjectURL(url);
      let q=.85,d=cv.toDataURL("image/jpeg",q);
      while(d.length>90000&&q>.4){q-=.15;d=cv.toDataURL("image/jpeg",q)}
      res(d);
    };
    im.src=url;
  });
}

/* ---------- экран ---------- */
function render(main){
  const ps=mine(c.S().periods),t0=today();
  const groups=[{type:"food",...BASE.food},{type:"litter",...BASE.litter},...blocks().map(b=>({type:"other",block:b,name:b.name,icon:esc(b.icon||"📦")}))];
  if(ps.some(x=>x.type==="other"&&!blockOf(x)))groups.push({type:"other",block:null,name:"Без блока",icon:"📦"});
  let h="";
  for(const g of groups){
    const list=ps.filter(x=>x.type===g.type&&(g.type!=="other"||(blockOf(x)||null)===g.block)).sort((a,b)=>(b.start_on||"").localeCompare(a.start_on||""));
    const cur=list.filter(x=>!x.end_on||x.end_on>=t0),past=list.filter(x=>!cur.includes(x));
    h+=`<section class="sec"><div class="sh"><span class="sn">${g.icon} ${esc(g.name)}</span>${g.block?`<button class="icon" data-block="${g.block.id}" aria-label="Изменить блок">✎</button>`:""}
      ${g.type!=="other"||g.block?`<span class="sp"><button class="btn sm" data-newperiod="${g.type}" data-blk="${g.block?g.block.id:""}">＋ Добавить</button></span>`:""}</div>`;
    h+=list.length?`<div class="list">${cur.map(x=>row(x,true,g.icon)).join("")}${past.map(x=>row(x,false,g.icon)).join("")}</div>${g.type==="other"?"":timeline(list)}`:`<div class="empty">Пока не записано</div>`;
    h+=`</section>`;
  }
  main.innerHTML=`<div class="c3">${h}</div><button class="add" data-act="newblock">＋ Создать блок</button>`;
  loadPics();
}
function row(x,cur,icon){
  const len=x.start_on?daysBetween(x.start_on,x.end_on||today()):null;
  const dur=!len?"":len>=60?Math.round(len/30.4)+" мес.":plural(len,"день","дня","дней");
  const when=x.start_on?(x.end_on===x.start_on?fmt(x.start_on):`с ${fmt(x.start_on)}${x.end_on?" по "+fmt(x.end_on):cur?" — сейчас":""}`):x.end_on?"по "+fmt(x.end_on):"";
  const line=[when,dur,esc(x.reason||"")].filter(Boolean).join(" · ");
  const chk=x.type==="food"&&x.check_on?(x.end_on?(x.end_on<x.check_on?`Проверить до ${fmt(x.check_on)} — снято, закончен раньше`:""):`Проверить до ${fmt(x.check_on)}`):"";
  const line2=[x.bought_on?"Куплено "+fmt(x.bought_on):"",chk].filter(Boolean).join(" · ");
  return `<button class="row it" data-period="${x.id}">${picHTML(x,icon)}<span class="tx"><span class="nm">${esc(x.name)}</span>
    ${x.brand?`<span class="meta"><b>${esc(x.brand)}</b></span>`:""}${line?`<span class="meta">${line}</span>`:""}${line2?`<span class="meta">${line2}</span>`:""}${x.note?`<span class="meta">${esc(x.note)}</span>`:""}</span>
    <span class="bd">${cur&&x.start_on?`<span class="badge b-ok">сейчас</span>`:""}${x.type==="food"&&x.check_on&&!x.end_on&&daysBetween(today(),x.check_on)<=14?dueBadge(x.check_on,30):""}</span></button>`;
}
function timeline(list){
  const st=list.filter(x=>x.start_on);if(st.length<2)return"";
  const a=st.map(x=>x.start_on).sort()[0],b=today(),span=Math.max(1,daysBetween(a,b));
  return `<div class="tl" aria-label="Когда что было">${[...st].reverse().map(x=>{const l=daysBetween(a,x.start_on)/span*100,w=Math.max(1.5,daysBetween(x.start_on,x.end_on||b)/span*100);
    return `<div class="t" title="${esc(x.name)}: ${fmt(x.start_on)} — ${x.end_on?fmt(x.end_on):"сейчас"}"><i class="${x.end_on?"":"now"}" style="left:${Math.min(l,98.5)}%;width:${Math.min(w,100-Math.min(l,98.5))}%"></i><span>${esc(x.name)}</span></div>`}).join("")}
    <span class="meta">${fmt(a)} — сегодня</span></div>`;
}

/* ---------- запись ---------- */
const openTask=x=>{const t=x&&x.task_id&&c.S().tasks.find(t=>t.id===x.task_id);return t&&!t.done_on?t:null};
function periodModal(x,type,blk){
  const e=x||{type,block_id:blk||null,name:"",brand:"",reason:"",start_on:today(),end_on:"",check_on:"",bought_on:"",note:""};
  const food=e.type==="food",own=e.type==="other",g=groupName(e);
  // новый корм или наполнитель закрывает прежний; в своём блоке несколько средств живут рядом
  const prev=x||own?null:mine(c.S().periods).find(p=>p.type===e.type&&!p.end_on);
  let pic=e.pic_id?pics.get(e.pic_id)||"":"",picNew=null,picOff=false;
  openModal(`<h2>${g.icon} ${esc(g.name)}</h2>
    <div class="picrow"><div class="picbox"><button type="button" class="pic big-pic" id="ppic" aria-label="Выбрать картинку"></button><button type="button" class="btn sm ghost" id="ppx">✕ Убрать</button><input type="file" id="pfile" accept="image/*" hidden></div>
      <div class="picf"><div class="fld"><label for="pn">Название</label><input id="pn" value="${esc(e.name)}"></div>
      <div class="fld"><label for="pb">Бренд</label><input id="pb" value="${esc(e.brand||"")}"></div></div></div>
    <div class="${food?"grid2":"grid3"}"><div class="fld"><label for="ps">С</label><input id="ps" type="date" value="${e.start_on||""}"></div>
      <div class="fld"><label for="pe">По</label><input id="pe" type="date" value="${e.end_on||""}"></div>
      <div class="fld"><label for="pbo">Куплено</label><input id="pbo" type="date" value="${e.bought_on||""}"></div>
      ${food?`<div class="fld"><label for="pc">Проверить до</label><input id="pc" type="date" value="${e.check_on||""}"></div>`:""}</div>
    ${food?`<div class="d-bad small" id="pw">&nbsp;</div>`:""}
    <div class="fld"><label for="pr">Почему / кто назначил</label><input id="pr" value="${esc(e.reason||"")}" placeholder="${food?"лечебный, назначил врач":""}"></div>
    ${own?`<div class="fld"><label for="pg">Блок</label><select id="pg">${blocks().map(b=>`<option value="${b.id}"${b.id===e.block_id?" selected":""}>${esc((b.icon||"📦")+" "+b.name)}</option>`).join("")}${blockOf(e)?"":`<option value="" selected>Без блока</option>`}</select></div>`:""}
    <div class="fld"><label for="po">Заметка</label><textarea id="po">${esc(e.note||"")}</textarea></div>
    <div class="mact">${x?`<button class="btn danger left" id="pdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="psave">Сохранить</button></div>`,m=>{
    m.classList.add("fixed");
    const v=id=>m.querySelector(id).value.trim()||null;
    const drawPic=()=>{m.querySelector("#ppic").innerHTML=pic?img(pic):g.icon;m.querySelector("#ppx").style.visibility=pic?"visible":"hidden"};drawPic();
    const f=m.querySelector("#pfile");
    m.querySelector("#ppic").onclick=()=>f.click();
    f.onchange=async()=>{if(!f.files[0])return;try{pic=picNew=await shrink(f.files[0]);picOff=false;m.dataset.dirty="1";drawPic()}catch(err){toast("Не удалось прочитать картинку")}f.value=""};
    m.querySelector("#ppx").onclick=()=>{pic="";picNew=null;picOff=true;m.dataset.dirty="1";drawPic()};
    // что станет с задачей «спросить врача»: корм закончен — несделанная задача уходит (триггер базы)
    if(food){
      const warn=()=>{const t=x?(m.querySelector("#pe").value?openTask(x):null):(m.querySelector("#ps").value?openTask(prev):null),w=m.querySelector("#pw");
        w.textContent=t?`Задача «${t.title}»${t.due_date?" ("+fmt(t.due_date)+")":""} уйдёт из «Задач»`:" "};
      ["#ps","#pe"].forEach(id=>m.querySelector(id).addEventListener("input",warn));warn();
    }
    m.querySelector("#pn").focus();
    const dropPic=id=>id?rm("p_pics",id):null;
    if(x)armDelete(m.querySelector("#pdel"),"Удалить запись?",()=>{closeModal();save(rm("p_periods",x.id).then(()=>dropPic(x.pic_id)),"Удалено")});
    m.querySelector("#psave").onclick=()=>{
      const rw={name:v("#pn"),brand:v("#pb"),reason:v("#pr"),start_on:v("#ps"),end_on:v("#pe"),bought_on:v("#pbo"),note:v("#po")};
      if(food)rw.check_on=v("#pc");
      if(own)rw.block_id=v("#pg");
      if(!rw.name)return m.querySelector("#pn").focus();
      if(rw.end_on&&rw.start_on&&rw.end_on<rw.start_on)return toast("«По» раньше «С»");
      closeModal();
      save((async()=>{
        if(picNew){const p=await ins("p_pics",{pet_id:P().id,data:picNew});pics.set(p.id,picNew);rw.pic_id=p.id}
        else if(picOff)rw.pic_id=null;
        if(x)await upd("p_periods",x.id,rw);
        else{
          if(prev&&rw.start_on){const d=addDays(rw.start_on,-1);await upd("p_periods",prev.id,{end_on:d<(prev.start_on||"")?prev.start_on:d})}
          await ins("p_periods",{...rw,type:e.type,pet_id:P().id});
        }
        if(x&&x.pic_id&&"pic_id" in rw&&rw.pic_id!==x.pic_id)await dropPic(x.pic_id);
      })(),"Сохранено");
    };
  });
}
function blockModal(b){
  openModal(`<h2>${b?"Блок":"Новый блок"}</h2>
    <div class="blk"><div class="fld"><label for="bi">Значок</label><input id="bi" maxlength="8" value="${esc(b?b.icon||"":"📦")}"></div>
      <div class="fld"><label for="bn">Название</label><input id="bn" value="${esc(b?b.name:"")}"></div></div>
    <div class="mact">${b?`<button class="btn danger left" id="bdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="bsave">Сохранить</button></div>`,m=>{
    m.querySelector("#bn").focus();
    if(b){
      const n=c.S().periods.filter(x=>x.block_id===b.id).length;
      if(n)m.querySelector("#bdel").onclick=()=>toast(`В блоке ${plural(n,"запись","записи","записей")} — сначала перенеси или удали их`,5000);
      else armDelete(m.querySelector("#bdel"),"Удалить блок?",()=>{closeModal();save(rm("p_blocks",b.id),"Блок удалён")});
    }
    m.querySelector("#bsave").onclick=()=>{
      const name=m.querySelector("#bn").value.trim();if(!name)return m.querySelector("#bn").focus();
      const low=name.toLowerCase();
      if(low==="корм"||low==="наполнитель"||blocks().some(k=>k!==b&&k.name.toLowerCase()===low))return toast("Такой блок уже есть");
      const rw={name,icon:m.querySelector("#bi").value.trim()||"📦"};
      closeModal();
      save(b?upd("p_blocks",b.id,rw):ins("p_blocks",{...rw,pet_id:P().id,ord:Math.max(0,...blocks().map(k=>k.ord||0))+1}),"Сохранено");
    };
  });
}
// для загрузки из файла: номер блока по названию, нет — создать
async function blockId(name){
  const n=String(name||"").trim();if(!n)return null;
  const b=blocks().find(k=>k.name.toLowerCase()===n.toLowerCase());
  return b?b.id:(await ins("p_blocks",{name:n,icon:"📦",pet_id:P().id,ord:Math.max(0,...blocks().map(k=>k.ord||0))+1})).id;
}
return {render,periodModal,blockModal,blockOf,blockId};
};
