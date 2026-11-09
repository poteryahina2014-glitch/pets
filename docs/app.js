(function(){
"use strict";
/* «Питомцы»: всё про питомцев. Данные — таблицы p_* в общем Supabase; напоминания — задачи «Задач» (tasks.pet).
   Задачи по лекарствам, схемам, ветклинике и корму создают триггеры базы (001_pets.sql), приложение только отмечает их. */
const $=s=>document.querySelector(s);
const main=$("#main");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls={get(k,d){try{const v=localStorage.getItem("pets:"+k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem("pets:"+k,JSON.stringify(v))}catch(e){}}};
const KINDS={cat:{icon:"🐱",name:"Кот",def:"Котик"},bird:{icon:"🦜",name:"Птица",def:"Попугай"}};
const UNITS=["табл.","г","мл","капли","шт.","пипетка"];
const PTYPES={food:{name:"Корм",icon:"🥣"},litter:{name:"Наполнитель",icon:"🪣"},other:{name:"Другое",icon:"📌"}};

/* ---------- даты: строки 'YYYY-MM-DD' в местном времени ---------- */
const pad=n=>String(n).padStart(2,"0");
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const today=()=>iso(new Date());
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
const daysBetween=(a,b)=>Math.round((parse(b)-parse(a))/864e5);
const fmt=s=>s?`${s.slice(8,10)}.${s.slice(5,7)}.${s.slice(0,4)}`:"";
const fmtShort=s=>{if(!s)return"";const y=s.slice(0,4)===today().slice(0,4);return y?`${s.slice(8,10)}.${s.slice(5,7)}`:fmt(s)};
function plural(n,a,b,c){const m=Math.abs(n)%10,h=Math.abs(n)%100;return n+" "+(m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c)}
const num=v=>{const x=parseFloat(String(v??"").replace(",","."));return isFinite(x)?x:null};
const n2=x=>String(Math.round(x*1000)/1000).replace(".",",");
function age(b){
  if(!b)return"";const t=parse(today()),d=parse(b);
  let m=(t.getFullYear()-d.getFullYear())*12+t.getMonth()-d.getMonth();if(t.getDate()<d.getDate())m--;
  if(m<0)return"";const y=Math.floor(m/12),r=m%12;
  return [y?plural(y,"год","года","лет"):"",r?plural(r,"месяц","месяца","месяцев"):""].filter(Boolean).join(" ")||"меньше месяца";
}
function dueBadge(d,soonDays){
  if(!d)return"";const n=daysBetween(today(),d);
  if(n<0)return `<span class="badge b-late">просрочено ${plural(-n,"день","дня","дней")}</span>`;
  if(n===0)return `<span class="badge b-now">сегодня</span>`;
  if(n===1)return `<span class="badge ${soonDays?"b-soon":"b-date"}">завтра</span>`;
  return `<span class="badge ${n<=(soonDays||0)?"b-soon":"b-date"}">${n<=14?"через "+plural(n,"день","дня","дней"):fmtShort(d)}</span>`;
}

/* ---------- база ---------- */
const sb=supabase.createClient(CONFIG.url,CONFIG.key);
const TABLES=["p_pets","p_weights","p_periods","p_visits","p_notes","p_meds","p_schemes","p_runs","p_steps"];
let S=null,user=null,tab=ls.get("tab","today"),petId=ls.get("pet",null),busy=0;
const ok=r=>{if(r.error)throw r.error;return r.data};
async function load(){
  try{
    const from=addDays(today(),-90);
    const rs=await Promise.all([
      ...TABLES.map(t=>sb.from(t).select("*")),
      sb.from("tasks").select("*").not("pet","is",null),
      sb.from("task_log").select("*").gte("day",from),
      sb.from("sections").select("id,name,paused,space"),
    ]);
    const bad=rs.find(r=>r.error);if(bad)throw bad.error;
    const d={};TABLES.forEach((t,i)=>d[t.slice(2)]=rs[i].data);
    d.tasks=rs[TABLES.length].data;d.logs=rs[TABLES.length+1].data;d.sections=rs[TABLES.length+2].data;
    S=d;render();
  }catch(e){
    console.error(e);
    main.innerHTML=`<div class="empty"><b>База ещё не готова</b>Нужно один раз запустить в Supabase → SQL Editor сначала <code>016_early.sql</code> из «Задач», потом <code>001_pets.sql</code>.<br><small>${esc(e.message||"")}</small></div>`;
  }
}
// записать и перечитать всё: многое за нас меняют триггеры базы
async function save(p,msg){
  busy++;
  try{await p;if(msg)toast(msg)}
  catch(e){console.error(e);toast("Не удалось сохранить"+(e&&e.message?": "+e.message:" — проверь интернет"))}
  finally{busy--;await load()}
}
const wr=(q)=>q.then(ok);
const ins=(t,row)=>wr(sb.from(t).insert(row).select().single());
const upd=(t,id,row)=>wr(sb.from(t).update(row).eq("id",id));
const rm=(t,id)=>wr(sb.from(t).delete().eq("id",id));

let channel=null,reloadT=null;
function listen(){
  if(channel)return;
  channel=sb.channel("pets");
  [...TABLES,"tasks","task_log"].forEach(t=>channel.on("postgres_changes",{event:"*",schema:"public",table:t},()=>{
    clearTimeout(reloadT);reloadT=setTimeout(()=>{if(!busy)load()},600);
  }));
  channel.subscribe();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&user)load()});

/* ---------- вход: тот же аккаунт, что в «Задачах» ---------- */
function renderLogin(msg="",err=false){
  $("#top").hidden=true;
  main.innerHTML=`<form class="acard" id="login">
    <h2>🐾 Питомцы</h2>
    <p class="meta" style="text-align:center;margin:0">Вход тот же, что в «Задачах».</p>
    <div class="fld"><label for="email">Почта</label><input id="email" type="email" autocomplete="email" required></div>
    <div class="fld"><label for="pass">Пароль</label><input id="pass" type="password" autocomplete="current-password" required></div>
    <button class="btn pri" type="submit">Войти</button>
    ${msg?`<p class="meta" style="margin:0;${err?"color:var(--danger)":""}">${esc(msg)}</p>`:""}
  </form>`;
  $("#login").addEventListener("submit",async e=>{
    e.preventDefault();
    const {error}=await sb.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#pass").value});
    if(error)renderLogin(/invalid login/i.test(error.message)?"Неверная почта или пароль":error.message,true);
  });
}
sb.auth.onAuthStateChange((ev,session)=>{
  const was=user&&user.id;user=session?session.user:null;
  if(!user){S=null;renderLogin();return}
  $("#top").hidden=false;
  if(was!==user.id)setTimeout(()=>{load();listen()},0);
});

/* ---------- питомец и его задачи ---------- */
const pets=()=>[...S.pets].sort((a,b)=>(a.ord||0)-(b.ord||0)||a.created_at.localeCompare(b.created_at));
function P(){const ps=pets();return ps.find(p=>p.id===petId)||ps[0]||null}
const mine=rows=>{const p=P();return p?rows.filter(r=>r.pet_id===p.id):[]};
const paused=()=>new Set(S.sections.filter(s=>s.paused).map(s=>s.id));
const petSection=()=>{const s=S.sections.find(s=>/^питомц/i.test(s.name)&&(s.space||"personal")==="personal");return s?s.id:null};
// чья задача: лекарство, шаг схемы, ветклиника, корм, день рождения — или обычная (уход)
function owners(){
  const m=new Map();
  for(const x of S.meds)for(const id of x.task_ids||[])m.set(id,{type:"med",x});
  for(const x of S.steps)if(x.task_id)m.set(x.task_id,{type:"step",x});
  for(const x of S.visits)if(x.task_id)m.set(x.task_id,{type:"visit",x});
  for(const x of S.periods)if(x.task_id)m.set(x.task_id,{type:"period",x});
  for(const x of S.pets)if(x.bday_task)m.set(x.bday_task,{type:"bday",x});
  return m;
}
function petTasks(all){
  const p=P();if(!p)return[];const off=paused();
  return S.tasks.filter(t=>(t.pet===p.kind||t.pet==="both")&&t.kind!=="event"&&t.kind!=="occasion"&&!off.has(t.section_id)&&(all||(!t.done_on&&t.due_date)));
}
const isDaily=t=>t.repeat_unit==="day"&&(t.repeat_every||1)===1;
function repeatLabel(t){
  const n=t.repeat_every||1,u=t.repeat_unit;if(!u)return"";
  if(u==="cycle")return"по циклу";
  if(u==="day")return n===1?"каждый день":`раз в ${plural(n,"день","дня","дней")}`;
  if(u==="week"){const wd=(t.repeat_weekdays||[]).map(d=>["пн","вт","ср","чт","пт","сб","вс"][d-1]).join(", ");return (n===1?"каждую неделю":`раз в ${n} нед.`)+(wd?": "+wd:"")}
  if(u==="month")return n===1?"каждый месяц":`раз в ${n} мес.`;
  return n===1?"каждый год":`раз в ${plural(n,"год","года","лет")}`;
}
const logsOf=id=>S.logs.filter(l=>l.task_id===id);
const lastLog=id=>logsOf(id).sort((a,b)=>b.id-a.id)[0];
const lateCount=()=>petTasks().filter(t=>t.due_date<today()).length;

async function complete(t,day){
  await save(wr(sb.rpc("complete_task",{p_task:t.id,p_done_on:day||(t.due_date<today()&&t.kind==="habit"?t.due_date:today())})),"Отмечено ✓");
}
async function undo(t){await save(wr(sb.rpc("undo_last",{p_task:t.id})),"Отметка снята")}

/* ---------- отрисовка ---------- */
function render(){
  if(!user||!S)return;
  const p=P();
  if(p&&p.id!==petId){petId=p.id;ls.set("pet",petId)}
  document.querySelectorAll(".tabs button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.tab===tab));
  $("#petIcon").textContent=p?KINDS[p.kind].icon:"🐾";
  $("#petName").textContent=p?p.name:"Питомцы";
  const ps=pets();
  $("#petSwitch").innerHTML=ps.length>1?ps.map(x=>`<button data-pet="${x.id}" aria-pressed="${x.id===p.id}" aria-label="${esc(x.name)}">${KINDS[x.kind].icon}</button>`).join(""):"";
  const n=p?lateCount():0;$("#cntLate").hidden=!n;$("#cntLate").textContent=n;
  if(!p)return renderFirst();
  ({today:renderToday,health:renderHealth,weight:renderWeight,food:renderFood,profile:renderProfile}[tab]||renderToday)();
}

function renderFirst(){
  const names=user.user_metadata?.pets||{};
  main.innerHTML=`<div class="acard"><h2>🐾 Первый питомец</h2>
    <p class="meta" style="margin:0;text-align:center">Создадим профиль. Остальное заполняется потом.</p>
    <div class="fld"><label>Кто</label><div class="seg" id="fk">${Object.entries(KINDS).map(([k,v])=>`<button data-k="${k}" aria-pressed="${k==="cat"}">${v.icon} ${v.name}</button>`).join("")}</div></div>
    <div class="fld"><label for="fn">Имя</label><input id="fn" value="${esc(names.cat||"")}"></div>
    <button class="btn pri" id="fgo">Создать</button></div>`;
  let k="cat";
  main.querySelectorAll("#fk button").forEach(b=>b.onclick=()=>{k=b.dataset.k;main.querySelectorAll("#fk button").forEach(x=>x.setAttribute("aria-pressed",x===b));$("#fn").value=names[k]||""});
  $("#fgo").onclick=()=>{const name=$("#fn").value.trim();if(!name)return $("#fn").focus();createPet(k,name)};
}
async function createPet(kind,name){
  const def=kind==="cat"?{w_min:4,w_norm:4.5,w_max:5,w_jump:300}:{};
  await save(ins("p_pets",{kind,name,...def}).then(r=>{petId=r.id;ls.set("pet",r.id);return syncName(kind,name)}),"Профиль создан");
}
// имя питомца — то же, что в «Задачах» (user_metadata.pets)
async function syncName(kind,name){
  const pets={...(user.user_metadata?.pets||{}),[kind]:name};
  if(user.user_metadata?.pets?.[kind]===name)return;
  const {data}=await sb.auth.updateUser({data:{pets}});if(data&&data.user)user=data.user;
}

/* ===== Сегодня ===== */
function taskRow(t,own,opts={}){
  const o=own.get(t.id);
  const icon=o?{med:"💊",step:"💉",visit:"🏥",period:"🥣",bday:"🎂"}[o.type]:isDaily(t)?"🧽":"🔔";
  const meta=[repeatLabel(t),t.remind_at?"🔔 "+t.remind_at.slice(0,5):""].filter(Boolean).join(" · ");
  const done=opts.done;
  return `<div class="row${done?" done":""}"><button class="ck${done?" on":""}" data-${done?"undo":"done"}="${t.id}" aria-label="${done?"Снять отметку":"Сделано"}">✓</button>
    <span class="tx click" data-task="${t.id}" style="cursor:pointer"><span class="nm">${esc(t.title)}</span>${meta?`<span class="meta">${esc(meta)}</span>`:""}</span>
    ${done?"":dueBadge(t.due_date,t.remind_days||7)}</div>`;
}
function renderToday(){
  const own=owners(),t0=today(),all=petTasks();
  const late=all.filter(t=>t.due_date<t0).sort((a,b)=>a.due_date.localeCompare(b.due_date));
  const now=all.filter(t=>t.due_date===t0);
  const soon=all.filter(t=>t.due_date>t0&&daysBetween(t0,t.due_date)<=30&&!isDaily(t)&&own.get(t.id)?.type!=="med").sort((a,b)=>a.due_date.localeCompare(b.due_date));
  const ids=new Set(petTasks(true).map(t=>t.id));
  const doneToday=[];const seen=new Set();
  for(const l of [...S.logs].sort((a,b)=>b.id-a.id))if(l.status==="done"&&l.done_on===t0&&ids.has(l.task_id)&&!seen.has(l.task_id)){seen.add(l.task_id);const t=S.tasks.find(x=>x.id===l.task_id);if(t&&!now.includes(t))doneToday.push(t)}
  const care=petTasks(true).filter(t=>t.repeat_unit&&!t.done_on&&!own.has(t.id)).sort((a,b)=>(a.due_date||"").localeCompare(b.due_date||""));
  let h="";
  if(late.length)h+=`<div class="alarm"><div class="ah">⚠ Пора! Не сделано вовремя: ${late.length}</div>${late.map(t=>taskRow(t,own)).join("")}</div>`;
  else if(!now.length)h+=`<div class="allgood">Всё сделано — ${esc(P().name)} доволен 🐾</div>`;
  h+=`<section class="sec"><div class="sh">Сегодня<span class="sp"><button class="btn sm" data-act="newtask">＋ Задача</button></span></div>
    ${now.length||doneToday.length?`<div class="list">${now.map(t=>taskRow(t,own)).join("")}${doneToday.map(t=>taskRow(t,own,{done:true})).join("")}</div>`:`<div class="empty">На сегодня ничего нет.</div>`}</section>`;
  if(soon.length)h+=`<section class="sec"><h2>Скоро (30 дней)</h2><div class="list">${soon.map(t=>taskRow(t,own)).join("")}</div></section>`;
  h+=`<section class="sec"><h2>Уход: регулярные дела</h2>
    ${care.length?`<div class="list">${care.map(t=>`<button class="row" data-task="${t.id}"><span class="ic">${isDaily(t)?"🧽":"🔁"}</span><span class="tx"><span class="nm">${esc(t.title)}</span><span class="meta">${esc(repeatLabel(t))}${t.due_date?" · следующий раз "+fmtShort(t.due_date):""}</span></span></button>`).join("")}</div>`:""}
    <div class="hint">Это те же задачи, что в «Задачах» с пометкой ${KINDS[P().kind].icon}: отметили здесь — отмечено и там.</div></section>`;
  main.innerHTML=h;
}

function taskModal(t){
  const own=owners().get(t?.id);
  if(own&&own.type!=="bday")return ownedModal(t,own);
  const e=t?{...t}:{title:"",due_date:today(),repeat_unit:"day",repeat_every:1,repeat_from:"due",remind_at:null,remind_days:null};
  const fancy=t&&(t.repeat_unit==="cycle"||(t.repeat_weekdays||[]).length);   // такой повтор настраивается только в «Задачах»
  let mode=!e.repeat_unit?"once":isDaily(e)?"daily":"repeat";
  openModal(`<h2>${t?"Задача":"Новая задача"}</h2>
    <div class="fld"><label for="tt">Что сделать</label><input id="tt" value="${esc(e.title)}" placeholder="Помыть миски"></div>
    ${fancy?`<div class="hint">Повтор: ${esc(repeatLabel(e))}. Такой повтор меняется в «Задачах».</div>`:`
    <div class="seg" id="tm">${[["once","Один раз"],["daily","Каждый день"],["repeat","Повтор"]].map(([k,v])=>`<button data-m="${k}" aria-pressed="${k===mode}">${v}</button>`).join("")}</div>
    <div class="grid3" id="trep"><div class="fld"><label for="tn">Раз в</label><input id="tn" type="number" min="1" value="${e.repeat_every||1}"></div>
      <div class="fld"><label for="tu">&nbsp;</label><select id="tu">${[["day","дней"],["week","недель"],["month","месяцев"],["year","лет"]].map(([k,v])=>`<option value="${k}"${e.repeat_unit===k?" selected":""}>${v}</option>`).join("")}</select></div>
      <div class="fld"><label for="tf">Считать от</label><select id="tf"><option value="due">срока</option><option value="done"${e.repeat_from==="done"?" selected":""}>выполнения</option></select></div></div>`}
    <div class="grid3"><div class="fld"><label for="td">${mode==="once"?"Срок":"Следующий раз"}</label><input id="td" type="date" value="${e.due_date||""}"></div>
      <div class="fld"><label for="ta">Напомнить в</label><input id="ta" type="time" value="${(e.remind_at||"").slice(0,5)}"></div>
      <div class="fld"><label for="tr">И за, дней</label><input id="tr" type="number" min="0" max="60" placeholder="—" value="${e.remind_days||""}"></div></div>
    <div class="hint">Задача появится и в «Задачах» (раздел «Питомцы», значок ${KINDS[P().kind].icon}).</div>
    <div class="mact">${t?`<button class="btn danger left" id="tdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="tsave">Сохранить</button></div>`,m=>{
    m.classList.add("fixed");
    const sync=()=>{const r=m.querySelector("#trep");if(r)r.style.visibility=mode==="repeat"?"visible":"hidden";m.querySelector("label[for=td]").textContent=mode==="once"?"Срок":"Следующий раз"};
    m.querySelectorAll("#tm button").forEach(b=>b.onclick=()=>{mode=b.dataset.m;m.querySelectorAll("#tm button").forEach(x=>x.setAttribute("aria-pressed",x===b));sync()});sync();
    m.querySelector("#tt").focus();
    if(t)armDelete(m.querySelector("#tdel"),"Удалить совсем?",()=>{closeModal();save(rm("tasks",t.id),"Удалено")});
    m.querySelector("#tsave").onclick=()=>{
      const title=m.querySelector("#tt").value.trim();if(!title)return m.querySelector("#tt").focus();
      const row={title,due_date:m.querySelector("#td").value||(mode==="once"?null:today()),remind_at:m.querySelector("#ta").value||null,remind_days:Math.round(num(m.querySelector("#tr").value)||0)||null};
      if(t&&row.remind_at!==((t.remind_at||"").slice(0,5)||null))row.reminded_on=null;
      if(t&&row.due_date!==t.due_date)row.early_on=null;
      if(!fancy){
        if(mode==="once")Object.assign(row,{repeat_unit:null,repeat_every:null,kind:"task"});
        else if(mode==="daily")Object.assign(row,{repeat_unit:"day",repeat_every:1,repeat_from:"due",kind:"habit"});
        else Object.assign(row,{repeat_unit:m.querySelector("#tu").value,repeat_every:Math.max(1,Math.round(num(m.querySelector("#tn").value)||1)),repeat_from:m.querySelector("#tf").value,kind:"task"});
      }
      closeModal();
      if(t)save(upd("tasks",t.id,row),"Сохранено");
      else save(ins("tasks",{...row,pet:P().kind,section_id:petSection(),space:"personal"}),"Задача добавлена");
    };
  });
}
// задача из лекарства / схемы / приёма: тут только отметить, остальное — в своём разделе
function ownedModal(t,o){
  const where={med:"Здоровье → Лекарства",step:"Здоровье → Процедуры",visit:"Здоровье → Ветклиника",period:"Питание"}[o.type];
  const ll=lastLog(t.id);
  openModal(`<h2>${esc(t.title)}</h2>
    <dl class="kv"><dt>Срок</dt><dd>${t.due_date?fmt(t.due_date):"—"}${t.done_on?" · сделано "+fmt(t.done_on):""}</dd>${t.repeat_unit?`<dt>Повтор</dt><dd>${esc(repeatLabel(t))}${t.repeat_until?" по "+fmt(t.repeat_until):""}</dd>`:""}</dl>
    <div class="hint">Эта задача создана из раздела «${where}» — сроки меняются там.</div>
    <div class="fld"><label for="od">Сделано в день</label><input id="od" type="date" value="${today()}"></div>
    <div class="mact">${ll&&ll.status==="done"?`<button class="btn left" id="oundo">Снять последнюю отметку</button>`:""}<button class="btn" data-close>Закрыть</button>${t.done_on?"":`<button class="btn pri" id="odone">✓ Сделано</button>`}</div>`,m=>{
    const d=m.querySelector("#odone");if(d)d.onclick=()=>{const day=m.querySelector("#od").value||today();closeModal();complete(t,day)};
    const u=m.querySelector("#oundo");if(u)u.onclick=()=>{closeModal();undo(t)};
  });
}

/* ===== Здоровье ===== */
let hTab=ls.get("htab","proc");
function renderHealth(){
  const seg=`<div class="seg">${[["proc","💉 Процедуры"],["meds","💊 Лекарства"],["vet","🏥 Ветклиника"]].map(([k,v])=>`<button data-htab="${k}" aria-pressed="${k===hTab}">${v}</button>`).join("")}</div>`;
  main.innerHTML=seg+({proc:procHTML,meds:medsHTML,vet:vetHTML}[hTab]||procHTML)();
}

/* --- схемы процедур --- */
function runsOf(sc){return S.runs.filter(r=>r.scheme_id===sc.id).sort((a,b)=>b.start_on.localeCompare(a.start_on))}
const stepsOf=r=>S.steps.filter(s=>s.run_id===r.id).sort((a,b)=>a.idx-b.idx);
const runDone=r=>{const st=stepsOf(r);return st.length&&st.every(s=>s.done_on)};
function stepHTML(s,sc){
  const t=S.tasks.find(x=>x.id===s.task_id);
  const due=s.done_on?null:(t&&t.due_date)||s.due_on;
  const n=due?daysBetween(today(),due):null;
  const cls=s.done_on?"done":n!==null&&n<0?"late":n!==null&&n<=(sc?.remind_days??7)?"soon":"";
  return `<div class="step ${cls}"><button class="dot" data-step="${s.id}" aria-label="${s.done_on?"Сделано":"Отметить"}">${s.done_on?"✓":s.idx+1}</button>
    <span class="tx"><span class="nm">${esc(s.title)}</span><span class="meta">${s.done_on?"сделано "+fmt(s.done_on):(s.gap&&s.idx?`через ${plural(s.gap,"день","дня","дней")} после предыдущего · `:"")+(due?"до "+fmt(due):"")}${!s.task_id&&!s.done_on?" · задачи нет":""}</span></span>
    ${s.done_on?"":dueBadge(due,sc?.remind_days??7)}</div>`;
}
function procHTML(){
  const scs=mine(S.schemes).sort((a,b)=>(a.ord||0)-(b.ord||0)||a.created_at.localeCompare(b.created_at));
  let h=`<div class="hint">Цепочка процедур: например, от блох → через N дней от глистов → через N дней прививка. Срок следующего шага считается от дня, когда сделан предыдущий. Интервалы — как скажет врач.</div>`;
  for(const sc of scs){
    const rs=runsOf(sc),cur=rs.find(r=>!runDone(r))||null,past=rs.filter(r=>r!==cur);
    h+=`<div class="card"><div class="ch"><span class="tx"><h3>${esc(sc.name)}</h3><span class="meta">${(sc.steps||[]).length} шаг. ${sc.repeat_months?"· круг каждые "+sc.repeat_months+" мес.":""} · напомнить за ${sc.remind_days} дн.</span></span>
      <button class="icon" data-scheme="${sc.id}" aria-label="Изменить схему">✎</button></div>
      ${cur?`<div class="steps">${stepsOf(cur).map(s=>stepHTML(s,sc)).join("")}</div>
        <div class="btns"><button class="btn sm ghost" data-runmove="${cur.id}">Сдвинуть начало (${fmtShort(cur.start_on)})</button><button class="btn sm ghost danger" data-rundel="${cur.id}">Убрать этот круг</button></div>`
      :`<button class="add" data-runnew="${sc.id}">▶ Начать${past.length?" новый круг":""}</button>`}
      ${past.length?`<details class="past"><summary>История: ${plural(past.length,"круг","круга","кругов")}</summary>${past.map(r=>`<div class="meta" style="margin-bottom:6px"><b>${fmt(r.start_on)}</b>: ${stepsOf(r).map(s=>esc(s.title)+" — "+(s.done_on?fmtShort(s.done_on):"не сделано")).join("; ")}</div>`).join("")}</details>`:""}
    </div>`;
  }
  h+=`<button class="add" data-act="newscheme">＋ Новая схема</button>`;
  return h;
}
function schemeModal(sc){
  const e=sc?{...sc,steps:(sc.steps||[]).map(s=>({...s}))}:{name:"Вакцинация",steps:[{t:"От блох",gap:0},{t:"От глистов",gap:""},{t:"Прививка",gap:""}],repeat_months:12,remind_days:7};
  openModal(`<h2>${sc?"Схема":"Новая схема"}</h2>
    <div class="fld"><label for="sn">Название</label><input id="sn" value="${esc(e.name)}"></div>
    <div class="fld"><span class="lb">Шаги (через сколько дней после предыдущего)</span><div id="srows" style="display:flex;flex-direction:column;gap:6px"></div>
      <button class="add" id="sadd">＋ Шаг</button></div>
    <div class="grid2"><div class="fld"><label for="sm">Повторять круг каждые, мес.</label><input id="sm" type="number" min="0" max="60" placeholder="не повторять" value="${e.repeat_months||""}"></div>
      <div class="fld"><label for="sr">Напомнить за, дней</label><input id="sr" type="number" min="0" max="60" value="${e.remind_days??7}"></div></div>
    <div class="hint">Новый круг начнётся сам: последний шаг — через столько месяцев после того, как сделан последний шаг сейчас. Изменения схемы касаются новых кругов.</div>
    <div class="mact">${sc?`<button class="btn danger left" id="sdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="ssave">Сохранить</button></div>`,m=>{
    m.classList.add("fixed");
    const rows=m.querySelector("#srows");
    const draw=()=>{rows.innerHTML=e.steps.map((s,i)=>`<div class="srow"><span class="n">${i+1}</span><input data-i="${i}" data-f="t" value="${esc(s.t)}" placeholder="Что сделать">
      ${i?`<input data-i="${i}" data-f="gap" type="number" min="0" placeholder="дней" value="${s.gap??""}">`:`<span class="meta">первый</span>`}<button class="icon" data-x="${i}" aria-label="Убрать шаг">✕</button></div>`).join("");
      rows.querySelectorAll("input").forEach(inp=>inp.oninput=()=>{e.steps[+inp.dataset.i][inp.dataset.f]=inp.value});
      rows.querySelectorAll("[data-x]").forEach(b=>b.onclick=()=>{e.steps.splice(+b.dataset.x,1);draw()});};
    draw();
    m.querySelector("#sadd").onclick=()=>{e.steps.push({t:"",gap:""});draw();rows.querySelector(".srow:last-child input").focus()};
    if(sc)armDelete(m.querySelector("#sdel"),"Удалить схему и её круги?",()=>{closeModal();save(Promise.all(S.runs.filter(r=>r.scheme_id===sc.id).map(r=>rm("p_runs",r.id))).then(()=>rm("p_schemes",sc.id)),"Схема удалена")});
    m.querySelector("#ssave").onclick=()=>{
      const name=m.querySelector("#sn").value.trim();if(!name)return m.querySelector("#sn").focus();
      const steps=e.steps.filter(s=>String(s.t).trim()).map((s,i)=>({t:String(s.t).trim(),gap:i?Math.round(num(s.gap)??-1):0}));
      if(!steps.length)return toast("Нужен хотя бы один шаг");
      if(steps.some(s=>s.gap<0))return toast("Укажи у каждого шага, через сколько дней");
      const row={name,steps,repeat_months:Math.round(num(m.querySelector("#sm").value)||0)||null,remind_days:Math.max(0,Math.round(num(m.querySelector("#sr").value)??7))};
      closeModal();
      save(sc?upd("p_schemes",sc.id,row):ins("p_schemes",{...row,pet_id:P().id}),"Схема сохранена");
    };
  });
}
function dateAsk(title,def,fn,extra=""){
  openModal(`<h2>${title}</h2><div class="fld"><label for="dq">Дата</label><input id="dq" type="date" value="${def}"></div>${extra}
    <div class="mact"><button class="btn" data-close>Отмена</button><button class="btn pri" id="dok">OK</button></div>`,m=>{
    m.querySelector("#dok").onclick=()=>{const v=m.querySelector("#dq").value;if(!v)return;closeModal();fn(v)};
  });
}
function stepClick(id){
  const s=S.steps.find(x=>x.id===id);if(!s)return;
  const t=S.tasks.find(x=>x.id===s.task_id);
  if(s.done_on){
    openModal(`<h2>${esc(s.title)}</h2><p class="meta" style="margin:0">Сделано ${fmt(s.done_on)}.</p>
      <div class="mact"><button class="btn left" id="su">Снять отметку</button><button class="btn" data-close>Закрыть</button></div>`,m=>{
      m.querySelector("#su").onclick=()=>{closeModal();
        const ll=t&&lastLog(t.id);
        if(t&&ll&&ll.status==="done")undo(t);else if(t)save(upd("tasks",t.id,{done_on:null}),"Отметка снята");else save(upd("p_steps",s.id,{done_on:null}),"Отметка снята")};
    });
    return;
  }
  dateAsk("✓ "+esc(s.title),today(),day=>{if(t)complete(t,day);else save(upd("p_steps",s.id,{done_on:day}),"Отмечено ✓")},`<p class="meta" style="margin:0">Когда сделано — от этой даты посчитается следующий шаг.</p>`);
}

/* --- лекарства --- */
function course(e){
  const ok=e.start_on&&e.end_on&&e.end_on>=e.start_on;
  const days=ok?daysBetween(e.start_on,e.end_on)+1:0;
  const every=Math.max(1,Math.round(num(e.every_days)||1));
  const doseDays=ok?Math.floor((days-1)/every)+1:0;
  const per=(e.times||[]).length||1,amt=num(e.amount)||0;
  return {days,doseDays,doses:doseDays*per,total:doseDays*per*amt};
}
function medDays(x){const out=[];const until=x.stopped_on&&x.stopped_on<x.end_on?x.stopped_on:x.end_on;for(let d=x.start_on;d<=until;d=addDays(d,x.every_days))out.push(d);return out}
function medHTML(x,active){
  const c=course(x),ids=x.task_ids||[];
  const given=S.logs.filter(l=>ids.includes(l.task_id)&&l.status==="done").length;
  const until=x.stopped_on&&x.stopped_on<x.end_on?x.stopped_on:x.end_on;
  const pct=c.doses?Math.min(100,Math.round(given/c.doses*100)):0;
  return `<div class="card"><div class="ch"><span class="ic" style="font-size:22px">💊</span><span class="tx"><h3>${esc(x.name)}</h3>
    <span class="meta">${n2(x.amount)} ${esc(x.unit)} × ${(x.times||[]).length} р. в день (${(x.times||[]).join(", ")})${x.every_days>1?" · раз в "+plural(x.every_days,"день","дня","дней"):""}</span>
    <span class="meta">${fmt(x.start_on)} — ${fmt(until)}${x.stopped_on?" (закончили раньше)":""}${x.reason?" · "+esc(x.reason):""}</span></span>
    <button class="icon" data-med="${x.id}" aria-label="Изменить">✎</button></div>
    <div class="calc"><div><b>${c.days}</b><span>${plural(c.days,"день","дня","дней").replace(/^\d+ /,"")} курса</span></div><div><b>${c.doses}</b><span>приёмов</span></div><div><b>${n2(c.total)}</b><span>${esc(x.unit)} всего</span></div></div>
    ${active?`<div class="bar" title="дано ${given} из ${c.doses}"><i style="width:${pct}%"></i></div><span class="meta">Дано ${given} из ${c.doses} (отметки за последние 90 дней)</span>`:""}
    ${active?`<div class="btns"><button class="btn sm ghost" data-medstop="${x.id}">⏹ Закончить сегодня</button></div>`:""}</div>`;
}
function medsHTML(){
  const ms=mine(S.meds).sort((a,b)=>b.start_on.localeCompare(a.start_on)),t0=today();
  const live=x=>(x.stopped_on||x.end_on)>=t0;
  const act=ms.filter(live),past=ms.filter(x=>!live(x));
  let h=`<button class="add" data-act="newmed">＋ Лекарство</button>`;
  h+=act.length?act.map(x=>medHTML(x,true)).join(""):`<div class="empty">Сейчас ничего не даём 🎉</div>`;
  if(past.length)h+=`<section class="sec"><h2>История курсов</h2>${past.map(x=>medHTML(x,false)).join("")}</section>`;
  return h;
}
function medModal(x){
  const e=x?{...x,times:[...(x.times||[])]}:{name:"",unit:"табл.",amount:1,times:["09:00"],every_days:1,start_on:today(),end_on:addDays(today(),6),reason:"",note:""};
  const defTimes=["09:00","21:00","15:00","12:00","18:00","06:00"];
  openModal(`<h2>${x?"Лекарство":"Новое лекарство"}</h2>
    <div class="fld"><label for="mn">Название и дозировка</label><input id="mn" value="${esc(e.name)}" placeholder="Синулокс 50 мг"></div>
    <div class="grid3"><div class="fld"><label for="ma">Сколько за раз</label><input id="ma" inputmode="decimal" value="${n2(e.amount)}"></div>
      <div class="fld"><label for="mu">В чём</label><input id="mu" list="units" value="${esc(e.unit)}"><datalist id="units">${UNITS.map(u=>`<option value="${u}">`).join("")}</datalist></div>
      <div class="fld"><label for="mt">Раз в день</label><input id="mt" type="number" min="1" max="6" value="${e.times.length}"></div></div>
    <div class="fld"><span class="lb">Во сколько (напоминание)</span><div class="times" id="mtimes"></div></div>
    <div class="grid3"><div class="fld"><label for="ms">Давать с</label><input id="ms" type="date" value="${e.start_on}"></div>
      <div class="fld"><label for="me">По (вкл.)</label><input id="me" type="date" value="${e.end_on}"></div>
      <div class="fld"><label for="mev">Раз в, дней</label><input id="mev" type="number" min="1" max="60" value="${e.every_days}"></div></div>
    <div class="calc" id="mcalc"></div>
    <div class="fld"><label for="mr">Зачем / кто назначил</label><input id="mr" value="${esc(e.reason||"")}"></div>
    <div class="fld"><label for="mo">Заметка</label><textarea id="mo">${esc(e.note||"")}</textarea></div>
    <div class="mact">${x?`<button class="btn danger left" id="mdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="msave">Сохранить</button></div>`,m=>{
    m.classList.add("fixed");
    const v=id=>m.querySelector(id).value;
    const drawTimes=()=>{
      const n=Math.min(6,Math.max(1,Math.round(num(v("#mt"))||1)));
      while(e.times.length<n)e.times.push(defTimes.find(t=>!e.times.includes(t))||"09:00");
      e.times.length=n;
      m.querySelector("#mtimes").innerHTML=e.times.map((t,i)=>`<input type="time" data-i="${i}" value="${t}">`).join("");
      m.querySelectorAll("#mtimes input").forEach(inp=>inp.oninput=()=>{e.times[+inp.dataset.i]=inp.value});
    };
    const calc=()=>{
      const c=course({start_on:v("#ms"),end_on:v("#me"),every_days:v("#mev"),times:e.times,amount:v("#ma")});
      m.querySelector("#mcalc").innerHTML=`<div><b>${c.days}</b><span>дней курса</span></div><div><b>${c.doses}</b><span>приёмов</span></div><div><b>${n2(c.total)}</b><span>${esc(v("#mu")||"")} всего</span></div>`;
    };
    m.querySelector("#mt").oninput=()=>{drawTimes();calc()};
    ["#ma","#mu","#ms","#me","#mev"].forEach(id=>m.querySelector(id).oninput=calc);
    drawTimes();calc();
    if(x)armDelete(m.querySelector("#mdel"),"Удалить курс и его историю?",()=>{closeModal();save(rm("p_meds",x.id),"Удалено")});
    m.querySelector("#msave").onclick=()=>{
      const row={name:v("#mn").trim(),unit:v("#mu").trim()||"табл.",amount:num(v("#ma")),times:[...new Set(e.times.filter(Boolean))].sort(),
        every_days:Math.max(1,Math.round(num(v("#mev"))||1)),start_on:v("#ms"),end_on:v("#me"),reason:v("#mr").trim()||null,note:v("#mo").trim()||null};
      if(!row.name)return m.querySelector("#mn").focus();
      if(!(row.amount>0))return toast("Сколько давать за раз?");
      if(!row.start_on||!row.end_on||row.end_on<row.start_on)return toast("Проверь даты: «по» не раньше «с»");
      if(x&&x.stopped_on&&row.end_on>x.stopped_on)row.stopped_on=null;
      closeModal();
      save(x?upd("p_meds",x.id,row):ins("p_meds",{...row,pet_id:P().id}),"Сохранено — приёмы появятся в «Задачах»");
    };
  });
}

/* --- ветклиника --- */
function vetHTML(){
  const vs=mine(S.visits).sort((a,b)=>b.day.localeCompare(a.day));
  let h=`<button class="add" data-act="newvisit">＋ Приём</button>`;
  if(!vs.length)return h+`<div class="empty"><b>Дневник пуст</b>Записывай: зачем пришли, что сделали по факту, что назначили.</div>`;
  h+=vs.map(x=>`<div class="card"><div class="ch"><span class="ic" style="font-size:22px">🏥</span><span class="tx"><h3>${fmt(x.day)} — ${esc(x.reason||"приём")}</h3>${x.clinic?`<span class="meta">${esc(x.clinic)}</span>`:""}</span>
    <button class="icon" data-visit="${x.id}" aria-label="Изменить">✎</button></div>
    ${x.done||x.prescribed||x.next_on||x.note?`<dl class="kv">${x.done?`<dt>Сделали</dt><dd>${esc(x.done)}</dd>`:""}${x.prescribed?`<dt>Назначили</dt><dd>${esc(x.prescribed)}</dd>`:""}${x.next_on?`<dt>Следующий</dt><dd>${fmt(x.next_on)}${x.next_why?" — "+esc(x.next_why):""} ${x.next_on>=today()?dueBadge(x.next_on,7):""}</dd>`:""}${x.note?`<dt>Заметка</dt><dd>${esc(x.note)}</dd>`:""}</dl>`:""}</div>`).join("");
  return h;
}
function visitModal(x){
  const last=mine(S.visits).sort((a,b)=>b.day.localeCompare(a.day))[0];
  const e=x||{day:today(),clinic:last?.clinic||"",reason:"",done:"",prescribed:"",next_on:"",next_why:"",note:""};
  openModal(`<h2>${x?"Приём":"Новый приём"}</h2>
    <div class="grid2"><div class="fld"><label for="vd">Дата</label><input id="vd" type="date" value="${e.day}"></div>
      <div class="fld"><label for="vc">Клиника, врач</label><input id="vc" value="${esc(e.clinic||"")}"></div></div>
    <div class="fld"><label for="vr">Зачем пришли</label><input id="vr" value="${esc(e.reason||"")}" placeholder="Прививка, анализ крови…"></div>
    <div class="fld"><label for="vdn">Что сделали по факту</label><textarea id="vdn">${esc(e.done||"")}</textarea></div>
    <div class="fld"><label for="vp">Что назначили</label><textarea id="vp">${esc(e.prescribed||"")}</textarea></div>
    <div class="grid2"><div class="fld"><label for="vn">Следующий приём</label><input id="vn" type="date" value="${e.next_on||""}"></div>
      <div class="fld"><label for="vw">Зачем</label><input id="vw" value="${esc(e.next_why||"")}"></div></div>
    <div class="fld"><label for="vo">Заметка</label><textarea id="vo">${esc(e.note||"")}</textarea></div>
    <div class="mact">${x?`<button class="btn danger left" id="vdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="vsave">Сохранить</button></div>`,m=>{
    m.classList.add("fixed");
    const v=id=>m.querySelector(id).value.trim()||null;
    if(x)armDelete(m.querySelector("#vdel"),"Удалить запись?",()=>{closeModal();save(rm("p_visits",x.id),"Удалено")});
    m.querySelector("#vsave").onclick=()=>{
      const row={day:v("#vd")||today(),clinic:v("#vc"),reason:v("#vr"),done:v("#vdn"),prescribed:v("#vp"),next_on:v("#vn"),next_why:v("#vw"),note:v("#vo")};
      closeModal();save(x?upd("p_visits",x.id,row):ins("p_visits",{...row,pet_id:P().id}),row.next_on?"Сохранено — следующий приём в «Задачах»":"Сохранено");
    };
  });
}

/* ===== Вес ===== */
const ADULT=12;   // с скольких месяцев вес считается взрослым
function addMonths(s,n){const d=parse(s),t=new Date(d.getFullYear(),d.getMonth()+n,1);t.setDate(Math.min(d.getDate(),new Date(t.getFullYear(),t.getMonth()+1,0).getDate()));return iso(t)}
const wOf=()=>mine(S.weights).sort((a,b)=>a.day.localeCompare(b.day)||a.created_at.localeCompare(b.created_at));
function wFlags(p,list){
  // вне зелёной зоны или скачок больше порога (г) от прошлого взвешивания.
  // Пока растёт — не предупреждаем: до года (ADULT месяцев от дня рождения), без дня рождения — пока ни разу не дорос до нижней границы.
  const adult=p.birthday?addMonths(p.birthday,ADULT):null;
  let grown=!p.w_min;
  return list.map((w,i)=>{const kg=+w.kg,prev=i?+list[i-1].kg:null;
    let g=grown;if(kg>=+p.w_min)grown=true;
    if(adult)g=w.day>=adult;
    const out=g&&((p.w_min&&kg<+p.w_min)||(p.w_max&&kg>+p.w_max));
    const d=prev===null?null:Math.round((kg-prev)*1000);
    // скачок — только между взвешиваниями не дальше 45 дней (за полгода +400 г — не тревога)
    const near=prev!==null&&daysBetween(list[i-1].day,w.day)<=45;
    return {w,kg,d,out,grow:!g,jump:g&&near&&p.w_jump&&Math.abs(d)>p.w_jump}});
}
function chartSVG(p,fl){
  const from=addDays(today(),-365);let pts=wRange==="all"?fl:fl.filter(x=>x.w.day>=from);
  if(pts.length<2)pts=fl.slice(-12);if(pts.length<1)return"";
  const long=pts[pts.length-1].w.day.slice(0,4)!==pts[0].w.day.slice(0,4)&&wRange==="all";
  const W=640,H=260,L=60,R=14,T=14,B=36;
  const vals=pts.map(x=>x.kg).concat([+p.w_min||null,+p.w_max||null].filter(Boolean));
  let lo=Math.min(...vals),hi=Math.max(...vals);const pad=Math.max(.15,(hi-lo)*.15);lo-=pad;hi+=pad;
  const X=i=>pts.length===1?(L+W-R)/2:L+i*(W-L-R)/(pts.length-1),Y=v=>T+(hi-v)*(H-T-B)/(hi-lo);
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="График веса">`;
  if(p.w_min&&p.w_max)s+=`<rect class="band" x="${L}" y="${Y(+p.w_max)}" width="${W-L-R}" height="${Y(+p.w_min)-Y(+p.w_max)}" rx="4"/>`;
  if(p.w_norm)s+=`<line class="norm" x1="${L}" x2="${W-R}" y1="${Y(+p.w_norm)}" y2="${Y(+p.w_norm)}"/>`;
  const ticks=[lo+pad,(lo+hi)/2,hi-pad];
  ticks.forEach(v=>s+=`<text x="${L-6}" y="${Y(v)+4}" text-anchor="end">${n2(Math.round(v*10)/10)}</text>`);
  s+=`<polyline class="ln" points="${pts.map((x,i)=>X(i)+","+Y(x.kg)).join(" ")}"/>`;
  pts.forEach((x,i)=>s+=`<circle class="pt${x.out||x.jump?" bad":x.grow?" grow":""}" cx="${X(i)}" cy="${Y(x.kg)}" r="${pts.length>30?5:7}"><title>${fmt(x.w.day)}: ${n2(x.kg)} кг</title></circle>`);
  const step=Math.max(1,Math.ceil(pts.length/6));
  pts.forEach((x,i)=>{if(i%step===0||i===pts.length-1)s+=`<text x="${X(i)}" y="${H-6}" text-anchor="middle">${long?x.w.day.slice(5,7)+"."+x.w.day.slice(2,4):x.w.day.slice(8,10)+"."+x.w.day.slice(5,7)}</text>`});
  return s+"</svg>";
}
let wRange=ls.get("wrange","year");
function renderWeight(){
  const p=P(),fl=wFlags(p,wOf()),last=fl[fl.length-1];
  let h=`<div class="card"><div class="ch"><span class="tx">${last?`<span class="big">${n2(last.kg)} кг</span><span class="meta">${fmt(last.w.day)}${last.d!==null?` · ${last.d>0?"+":""}${last.d} г с прошлого раза`:""}</span>`:`<span class="nm">Взвешиваний пока нет</span>`}</span>
    <button class="btn pri" data-act="newweight">＋ Взвесить</button></div>
    ${last&&(last.out||last.jump)?`<div class="d-bad">⚠ ${last.out?"Вес вне обычной зоны ("+n2(+p.w_min)+"–"+n2(+p.w_max)+" кг)":"Вес резко изменился"} — стоит показать врачу.</div>`:""}
    <span class="meta">${p.birthday?`До ${ADULT} месяцев (до ${fmt(addMonths(p.birthday,ADULT))}) — рост, серые точки, без предупреждений. `:""}Зелёная зона: ${p.w_min?n2(+p.w_min):"—"}–${p.w_max?n2(+p.w_max):"—"} кг, обычный вес ${p.w_norm?n2(+p.w_norm):"—"} кг, предупреждать при скачке больше ${p.w_jump||"—"} г за месяц (меняется в профиле).</span></div>`;
  if(fl.length)h+=`<div class="chart"><div class="seg" style="margin:0 4px 8px">${[["year","За год"],["all","За всё время"]].map(([k,v])=>`<button data-wrange="${k}" aria-pressed="${k===wRange}">${v}</button>`).join("")}</div>${chartSVG(p,fl)}</div>`;
  if(fl.length)h+=`<section class="sec"><h2>Все взвешивания</h2><div class="list">${[...fl].reverse().map(x=>`<button class="row" data-weight="${x.w.id}"><span class="tx"><span class="nm">${n2(x.kg)} кг</span><span class="meta">${fmt(x.w.day)}${x.w.note?" · "+esc(x.w.note):""}</span></span>
    ${x.d!==null?`<span class="${x.jump?"d-bad":x.d>0?"d-up":"meta"}">${x.d>0?"+":""}${x.d} г</span>`:""}${x.out?`<span class="badge b-late">вне зоны</span>`:""}${x.grow?`<span class="badge b-date">растёт</span>`:""}</button>`).join("")}</div></section>`;
  main.innerHTML=h;
}
function weightModal(w){
  const e=w||{day:today(),kg:"",note:""};
  openModal(`<h2>${w?"Взвешивание":"Взвесить"}</h2>
    <div class="grid2"><div class="fld"><label for="wd">Дата</label><input id="wd" type="date" value="${e.day}"></div>
      <div class="fld"><label for="wk">Вес, кг</label><input id="wk" inputmode="decimal" value="${e.kg?n2(+e.kg):""}" placeholder="4,5 или 4520"></div></div>
    <div class="fld"><label for="wn">Заметка</label><input id="wn" value="${esc(e.note||"")}"></div>
    <div class="mact">${w?`<button class="btn danger left" id="wdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="wsave">Сохранить</button></div>`,m=>{
    m.querySelector("#wk").focus();
    if(w)armDelete(m.querySelector("#wdel"),"Удалить?",()=>{closeModal();save(rm("p_weights",w.id),"Удалено")});
    const go=()=>{
      let kg=num(m.querySelector("#wk").value);if(!kg)return m.querySelector("#wk").focus();
      if(kg>100)kg=kg/1000;   // ввели в граммах
      const row={day:m.querySelector("#wd").value||today(),kg,note:m.querySelector("#wn").value.trim()||null};
      closeModal();
      if(w)return save(upd("p_weights",w.id,row),"Сохранено");
      // задачу «Взвесить …» в «Задачах» отмечаем сами
      const t=petTasks().find(t=>/взвес/i.test(t.title)&&daysBetween(row.day,t.due_date)<=5);
      save(ins("p_weights",{...row,pet_id:P().id}).then(()=>t&&sb.rpc("complete_task",{p_task:t.id,p_done_on:row.day}).then(ok)),t?"Записано, «"+t.title+"» отмечено ✓":"Записано");
    };
    m.querySelector("#wsave").onclick=go;
    m.querySelector("#wk").addEventListener("keydown",ev=>{if(ev.key==="Enter")go()});
  });
}

/* ===== Питание и быт ===== */
function renderFood(){
  const ps=mine(S.periods),t0=today();
  let h="";
  for(const [type,info] of Object.entries(PTYPES)){
    const list=ps.filter(x=>x.type===type).sort((a,b)=>(b.start_on||"").localeCompare(a.start_on||""));
    const cur=list.filter(x=>!x.end_on||x.end_on>=t0),past=list.filter(x=>!cur.includes(x));
    h+=`<section class="sec"><div class="sh">${info.icon} ${info.name}<span class="sp"><button class="btn sm" data-newperiod="${type}">＋ ${type==="food"?"Новый корм":type==="litter"?"Новый наполнитель":"Добавить"}</button></span></div>`;
    if(!list.length){h+=`<div class="empty">Пока не записано.</div></section>`;continue}
    h+=`<div class="list">${cur.map(x=>periodRow(x,true)).join("")}${past.map(x=>periodRow(x,false)).join("")}</div>`;
    if(list.length>1)h+=timeline(list);
    h+=`</section>`;
  }
  main.innerHTML=h;
}
function periodRow(x,cur){
  const len=x.start_on?daysBetween(x.start_on,x.end_on||today()):null;
  const dur=len===null?"":len>=60?Math.round(len/30.4)+" мес.":plural(len,"день","дня","дней");
  return `<button class="row" data-period="${x.id}"><span class="tx"><span class="nm">${esc(x.name)}</span>
    <span class="meta">${x.start_on?"с "+fmt(x.start_on):""}${x.end_on?" по "+fmt(x.end_on):cur?" — сейчас":""}${dur?" · "+dur:""}${x.reason?" · "+esc(x.reason):""}</span>
    ${x.check_on&&!x.end_on?`<span class="meta">Проверить до ${fmt(x.check_on)} (задача в «Задачах»)</span>`:""}</span>
    ${cur?`<span class="badge b-ok">сейчас</span>`:""}${x.check_on&&!x.end_on?dueBadge(x.check_on,30):""}</button>`;
}
function timeline(list){
  const st=list.filter(x=>x.start_on);if(st.length<2)return"";
  const a=st.map(x=>x.start_on).sort()[0],b=today(),span=Math.max(1,daysBetween(a,b));
  return `<div class="tl" aria-label="Когда что было">${[...st].reverse().map(x=>{const l=daysBetween(a,x.start_on)/span*100,w=Math.max(1.5,daysBetween(x.start_on,x.end_on||b)/span*100);
    return `<div class="t" title="${esc(x.name)}: ${fmt(x.start_on)} — ${x.end_on?fmt(x.end_on):"сейчас"}"><i class="${x.end_on?"":"now"}" style="left:${l}%;width:${Math.min(w,100-l)}%"></i><span>${esc(x.name)}</span></div>`}).join("")}
    <span class="meta">${fmt(a)} — сегодня</span></div>`;
}
function periodModal(x,type){
  const e=x||{type,name:"",reason:"",start_on:today(),end_on:"",check_on:"",note:""};
  const prev=x?null:mine(S.periods).find(p=>p.type===type&&!p.end_on);
  openModal(`<h2>${PTYPES[e.type].icon} ${x?esc(PTYPES[e.type].name):"Новый: "+PTYPES[e.type].name.toLowerCase()}</h2>
    <div class="fld"><label for="pn">Название</label><input id="pn" value="${esc(e.name)}"></div>
    <div class="fld"><label for="pr">Почему / кто назначил</label><input id="pr" value="${esc(e.reason||"")}" placeholder="${e.type==="food"?"лечебный, назначил врач":""}"></div>
    <div class="grid3"><div class="fld"><label for="ps">С</label><input id="ps" type="date" value="${e.start_on||""}"></div>
      <div class="fld"><label for="pe">По</label><input id="pe" type="date" value="${e.end_on||""}"></div>
      <div class="fld"><label for="pc">Проверить до</label><input id="pc" type="date" value="${e.check_on||""}"></div></div>
    <div class="hint">«По» пусто — значит сейчас. «Проверить до» — если назначено на срок: за неделю придёт задача ${e.type==="food"?"«спросить врача, продолжать ли»":"«проверить»"}.</div>
    ${prev?`<div class="hint">Прежний «${esc(prev.name)}» закончится днём раньше начала нового.</div>`:""}
    <div class="fld"><label for="po">Заметка</label><textarea id="po">${esc(e.note||"")}</textarea></div>
    <div class="mact">${x?`<button class="btn danger left" id="pdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="psave">Сохранить</button></div>`,m=>{
    m.querySelector("#pn").focus();
    const v=id=>m.querySelector(id).value.trim()||null;
    if(x)armDelete(m.querySelector("#pdel"),"Удалить запись?",()=>{closeModal();save(rm("p_periods",x.id),"Удалено")});
    m.querySelector("#psave").onclick=()=>{
      const row={name:v("#pn"),reason:v("#pr"),start_on:v("#ps"),end_on:v("#pe"),check_on:v("#pc"),note:v("#po")};
      if(!row.name)return m.querySelector("#pn").focus();
      if(row.end_on&&row.start_on&&row.end_on<row.start_on)return toast("«По» раньше «С»");
      closeModal();
      if(x)return save(upd("p_periods",x.id,row),"Сохранено");
      const close=prev&&row.start_on?upd("p_periods",prev.id,{end_on:addDays(row.start_on,-1)<(prev.start_on||"")?prev.start_on:addDays(row.start_on,-1)}):Promise.resolve();
      save(close.then(()=>ins("p_periods",{...row,type:e.type,pet_id:P().id})),"Сохранено");
    };
  });
}

/* ===== Профиль и заметки ===== */
function renderProfile(){
  const p=P(),ns=mine(S.notes).sort((a,b)=>(b.pinned-a.pinned)||b.updated_at.localeCompare(a.updated_at));
  const fields=[["Вид",KINDS[p.kind].name],["День рождения",p.birthday?fmt(p.birthday)+" · "+age(p.birthday):""],["Пол",p.sex],["Порода",p.breed],["Окрас",p.color],["Чип",p.chip],
    ["Вес",p.w_min||p.w_max?`зона ${n2(+p.w_min||0)}–${n2(+p.w_max||0)} кг, обычный ${n2(+p.w_norm||0)} кг`:""]].filter(f=>f[1]);
  let h=`<div class="card"><div class="ch"><span class="ic" style="font-size:30px;width:56px;height:56px;border-radius:16px;background:var(--accent-soft);display:grid;place-items:center">${KINDS[p.kind].icon}</span>
    <span class="tx"><h3 style="font-size:20px">${esc(p.name)}</h3>${p.birthday?`<span class="meta">${age(p.birthday)}</span>`:""}</span>
    <button class="icon" data-act="editpet" aria-label="Изменить профиль">✎</button></div>
    <dl class="kv">${fields.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${p.notes?`<div style="white-space:pre-wrap">${esc(p.notes)}</div>`:""}</div>`;
  h+=`<section class="sec"><div class="sh">📝 Заметки<span class="sp"><button class="btn sm" data-act="newnote">＋ Заметка</button></span></div>
    ${ns.length?`<div class="list">${ns.map(x=>`<button class="row" data-note="${x.id}"><span class="tx"><span class="nm">${x.pinned?"📌 ":""}${esc(x.title)}</span>${x.body?`<span class="meta" style="white-space:pre-wrap">${esc(x.body.length>220?x.body.slice(0,220)+"…":x.body)}</span>`:""}</span></button>`).join("")}</div>`
    :`<div class="empty">Привычки, что любит и не любит, важное про здоровье.</div>`}</section>`;
  const free=Object.keys(KINDS).filter(k=>!S.pets.some(x=>x.kind===k));
  if(free.length)h+=`<section class="sec"><h2>Другие питомцы</h2><div class="btns">${free.map(k=>`<button class="add" data-newpet="${k}">＋ ${KINDS[k].icon} ${KINDS[k].name}</button>`).join("")}</div></section>`;
  main.innerHTML=h;
}
function petModal(p){
  openModal(`<h2>${KINDS[p.kind].icon} Профиль</h2>
    <div class="grid2"><div class="fld"><label for="an">Имя</label><input id="an" value="${esc(p.name)}"></div>
      <div class="fld"><label for="ab">День рождения</label><input id="ab" type="date" value="${p.birthday||""}"></div></div>
    <div class="grid3"><div class="fld"><label for="as">Пол</label><input id="as" value="${esc(p.sex||"")}"></div>
      <div class="fld"><label for="abr">Порода</label><input id="abr" value="${esc(p.breed||"")}"></div>
      <div class="fld"><label for="ac">Окрас</label><input id="ac" value="${esc(p.color||"")}"></div></div>
    <div class="fld"><label for="ach">Чип / клеймо</label><input id="ach" value="${esc(p.chip||"")}"></div>
    <div class="grid2"><div class="fld"><label for="wmin">Вес не ниже, кг</label><input id="wmin" inputmode="decimal" value="${p.w_min?n2(+p.w_min):""}"></div>
      <div class="fld"><label for="wmax">Вес не выше, кг</label><input id="wmax" inputmode="decimal" value="${p.w_max?n2(+p.w_max):""}"></div>
      <div class="fld"><label for="wnorm">Обычный вес, кг</label><input id="wnorm" inputmode="decimal" value="${p.w_norm?n2(+p.w_norm):""}"></div>
      <div class="fld"><label for="wj">Скачок больше, г</label><input id="wj" type="number" min="0" value="${p.w_jump||""}"></div></div>
    <div class="fld"><label for="ao">О питомце</label><textarea id="ao">${esc(p.notes||"")}</textarea></div>
    <div class="hint">День рождения попадёт в «Задачи» ежегодным событием. Имя — то же, что у ${KINDS[p.kind].icon} в «Задачах».</div>
    <div class="mact"><button class="btn danger left" id="adel">Удалить</button><button class="btn" data-close>Отмена</button><button class="btn pri" id="asave">Сохранить</button></div>`,m=>{
    m.classList.add("fixed");
    const v=id=>m.querySelector(id).value.trim()||null;
    armDelete(m.querySelector("#adel"),"Удалить профиль и ВСЮ историю?",()=>{closeModal();save(rm("p_pets",p.id),"Профиль удалён")});
    m.querySelector("#asave").onclick=()=>{
      const row={name:v("#an")||p.name,birthday:v("#ab"),sex:v("#as"),breed:v("#abr"),color:v("#ac"),chip:v("#ach"),notes:v("#ao"),
        w_min:num(v("#wmin")),w_max:num(v("#wmax")),w_norm:num(v("#wnorm")),w_jump:Math.round(num(v("#wj"))||0)||null};
      closeModal();save(upd("p_pets",p.id,row).then(()=>syncName(p.kind,row.name)),"Сохранено");
    };
  });
}
function noteModal(x){
  const e=x||{title:"",body:"",pinned:false};
  openModal(`<h2>${x?"Заметка":"Новая заметка"}</h2>
    <div class="fld"><label for="nt">Заголовок</label><input id="nt" value="${esc(e.title)}"></div>
    <div class="fld"><label for="nb">Текст</label><textarea id="nb" style="min-height:160px">${esc(e.body||"")}</textarea></div>
    <label class="meta" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="np"${e.pinned?" checked":""}> 📌 Закрепить сверху</label>
    <div class="mact">${x?`<button class="btn danger left" id="ndel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="nsave">Сохранить</button></div>`,m=>{
    m.querySelector("#nt").focus();
    if(x)armDelete(m.querySelector("#ndel"),"Удалить?",()=>{closeModal();save(rm("p_notes",x.id),"Удалено")});
    m.querySelector("#nsave").onclick=()=>{
      const row={title:m.querySelector("#nt").value.trim(),body:m.querySelector("#nb").value.trim()||null,pinned:m.querySelector("#np").checked,updated_at:new Date().toISOString()};
      if(!row.title)return m.querySelector("#nt").focus();
      closeModal();save(x?upd("p_notes",x.id,row):ins("p_notes",{...row,pet_id:P().id}),"Сохранено");
    };
  });
}

/* ---------- справка и настройки ---------- */
const HELP=[
  ["Как это связано с «Задачами»","Все напоминания живут в «Задачах»: там же пуши на телефон и утренняя проверка. Задачи с пометкой питомца видны в обоих приложениях — это одна и та же задача, отметили в одном месте — отмечено и в другом. Новые задачи отсюда попадают в раздел «Питомцы»."],
  ["Сегодня","Красная плашка — то, что пора было сделать, а не сделано. Ниже — дела на сегодня, «Скоро» на 30 дней вперёд (жёлтым — когда уже пора готовиться) и регулярный уход. Щелчок по названию — изменить."],
  ["Лекарства","Пишешь: с какого по какое число давать (включительно), сколько за раз, сколько раз в день и раз в сколько дней. Приложение само считает дни курса, число приёмов и сколько всего таблеток или миллилитров нужно. Каждый приём — задача с напоминанием в своё время; после последнего дня она закончится сама. «Закончить сегодня» — если врач отменил раньше."],
  ["Процедуры (схемы)","Цепочка шагов, например: от блох → через 7 дней от глистов → через 10 дней прививка (интервалы — как скажет врач). Начинаешь круг — каждому шагу появляется задача. Отметила шаг позже или раньше — сроки следующих сдвигаются сами. После последнего шага новый круг ставится сам через заданное число месяцев. Напоминание приходит за N дней."],
  ["Ветклиника","Дневник приёмов по датам: зачем пришли, что сделали по факту, что назначили. «Следующий приём» сразу становится задачей с напоминанием за неделю."],
  ["Вес","Записываешь вес (можно в граммах: 4520). Зелёная полоса на графике — обычная зона, пунктир — обычный вес. Красная точка — вне зоны или скачок больше порога меньше чем за полтора месяца. Первый год (от дня рождения) — рост: серые точки без предупреждений. Если в «Задачах» есть задача «Взвесить…», она отметится сама."],
  ["Питание","Корм, наполнитель и другое — периодами «с … по …». Начинаешь новый корм — прежний закрывается днём раньше. «Проверить до» — для назначенного на срок: за неделю придёт задача спросить врача."],
];
function openHelp(){openModal(`<h2>Справка</h2><div class="help">${HELP.map(([t,x])=>`<details><summary>${t}</summary><p>${x}</p></details>`).join("")}</div>
  <div class="mact"><button class="btn" data-close>Закрыть</button></div>`,m=>m.classList.add("fixed"))}
function openGear(){openModal(`<h2>Настройки</h2>
  <p class="meta" style="margin:0">${esc(user.email||"")}</p>
  <div class="hint">Пуши на телефон включаются в «Задачах» (⚙ → «Уведомления»): все напоминания отсюда приходят оттуда.</div>
  <div class="btns"><button class="btn" id="imp">📁 Загрузить из файла</button><button class="btn" id="exp">💾 Скачать копию</button></div>
  <p class="meta" style="margin:0">Файл готовит Claude: вес, приёмы у врача, корм, заметки — для питомца «${esc(P()?.name||"")}». Что уже есть, не задваивается.</p>
  <input type="file" id="impf" accept=".json,application/json" hidden>
  <div class="mact"><button class="btn left danger" id="out">Выйти</button><button class="btn" data-close>Закрыть</button></div>`,m=>{
  m.querySelector("#out").onclick=()=>{closeModal();sb.auth.signOut()};
  m.querySelector("#exp").onclick=exportFile;
  const f=m.querySelector("#impf");
  m.querySelector("#imp").onclick=()=>{if(!P())return toast("Сначала создай профиль");f.click()};
  f.onchange=async()=>{const file=f.files[0];if(!file)return;
    try{const d=JSON.parse(await file.text());closeModal();await importData(d)}catch(e){toast("Не удалось прочитать файл: "+e.message)}};
})}
// загрузка из файла: {weights:[{day,kg,note}], visits:[{day,clinic,reason,done,prescribed,note}], periods:[{type,name,reason,start_on,end_on,note}], notes:[{title,body}]}
async function importData(d){
  const p=P(),key=(...a)=>a.map(x=>String(x??"").trim().toLowerCase()).join("|");
  const have={w:new Set(mine(S.weights).map(x=>key(x.day,(+x.kg).toFixed(3)))),v:new Set(mine(S.visits).map(x=>key(x.day,x.reason))),
    p:new Set(mine(S.periods).map(x=>key(x.type,x.name,x.start_on))),n:new Set(mine(S.notes).map(x=>key(x.title)))};
  const isDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||"");
  const W=(d.weights||[]).filter(x=>isDay(x.day)&&num(x.kg)>0).map(x=>({pet_id:p.id,day:x.day,kg:num(x.kg)>100?num(x.kg)/1000:num(x.kg),note:x.note||null})).filter(x=>!have.w.has(key(x.day,x.kg.toFixed(3))));
  // следующий приём ставим, только если он ещё впереди (иначе получится старая задача)
  const V=(d.visits||[]).filter(x=>isDay(x.day)).map(x=>({pet_id:p.id,day:x.day,clinic:x.clinic||null,reason:x.reason||null,done:x.done||null,prescribed:x.prescribed||null,note:x.note||null,
    next_on:isDay(x.next_on)&&x.next_on>=today()?x.next_on:null,next_why:x.next_why||null})).filter(x=>!have.v.has(key(x.day,x.reason)));
  const PR=(d.periods||[]).filter(x=>x.name&&PTYPES[x.type||"food"]).map(x=>({pet_id:p.id,type:x.type||"food",name:x.name,reason:x.reason||null,start_on:isDay(x.start_on)?x.start_on:null,end_on:isDay(x.end_on)?x.end_on:null,
    check_on:isDay(x.check_on)&&x.check_on>=today()?x.check_on:null,note:x.note||null})).filter(x=>!have.p.has(key(x.type,x.name,x.start_on)));
  const N=(d.notes||[]).filter(x=>x.title).map(x=>({pet_id:p.id,title:x.title,body:x.body||null,pinned:!!x.pinned})).filter(x=>!have.n.has(key(x.title)));
  const bday=!p.birthday&&isDay(d.pet?.birthday)?d.pet.birthday:null;
  const total=W.length+V.length+PR.length+N.length+(bday?1:0);
  if(!total)return toast("Новых записей в файле нет — всё уже загружено");
  if(!confirm(`Загрузить для «${p.name}»: взвешиваний ${W.length}, приёмов ${V.length}, корм/быт ${PR.length}, заметок ${N.length}${bday?", день рождения "+fmt(bday):""}?`))return;
  const put=(t,rows)=>rows.length?wr(sb.from(t).insert(rows)):null;
  await save(Promise.all([put("p_weights",W),put("p_visits",V),put("p_periods",PR),put("p_notes",N),bday?upd("p_pets",p.id,{birthday:bday}):null]),"Загружено: "+total);
}
function exportFile(){
  const p=P();if(!p)return;
  const pick=(rows,f)=>mine(rows).map(x=>Object.fromEntries(f.map(k=>[k,x[k]])));
  const d={pet:{name:p.name,kind:p.kind,birthday:p.birthday,sex:p.sex,breed:p.breed,color:p.color,chip:p.chip,notes:p.notes},
    weights:pick(S.weights,["day","kg","note"]),visits:pick(S.visits,["day","clinic","reason","done","prescribed","next_on","next_why","note"]),
    periods:pick(S.periods,["type","name","reason","start_on","end_on","check_on","note"]),notes:pick(S.notes,["title","body","pinned"]),
    meds:pick(S.meds,["name","unit","amount","times","every_days","start_on","end_on","stopped_on","reason","note"]),
    schemes:pick(S.schemes,["name","steps","repeat_months","remind_days"])};
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,1)],{type:"application/json"}));
  a.download=`питомцы-${p.name}-${today()}.json`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

/* ---------- окна ---------- */
function openModal(html,init){
  const root=$("#modalRoot");
  root.innerHTML=`<div class="ov"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const ov=root.firstChild,m=ov.firstChild;
  ov.addEventListener("click",e=>{if(e.target===ov||e.target.closest("[data-close]"))closeModal()});
  document.addEventListener("keydown",escClose);
  init&&init(m);return m;
}
function escClose(e){if(e.key==="Escape")closeModal()}
function closeModal(){$("#modalRoot").innerHTML="";document.removeEventListener("keydown",escClose)}
function armDelete(btn,text,fn){btn.onclick=()=>{if(btn.dataset.armed){fn();return}btn.dataset.armed="1";btn.textContent=text;btn.classList.add("pri")}}
let tt=null;
function toast(msg){let el=$(".toast");if(!el){el=document.createElement("div");el.className="toast";el.setAttribute("role","status");document.body.appendChild(el)}el.textContent=msg;clearTimeout(tt);tt=setTimeout(()=>el.remove(),/^Не удалось/.test(msg)?7000:2600)}

/* ---------- щелчки ---------- */
const byId=(list,id)=>list.find(x=>x.id===id);
document.addEventListener("click",e=>{
  const b=e.target.closest("button,[data-task]");if(!b||!S)return;
  const d=b.dataset;
  if(d.tab){tab=d.tab;ls.set("tab",tab);render();scrollTo(0,0);return}
  if(d.pet){petId=d.pet;ls.set("pet",petId);render();return}
  if(d.wrange){wRange=d.wrange;ls.set("wrange",wRange);render();return}
  if(d.htab){hTab=d.htab;ls.set("htab",hTab);render();return}
  if(b.id==="help")return openHelp();
  if(b.id==="gear")return openGear();
  if(d.done){const t=byId(S.tasks,d.done);if(t)complete(t);return}
  if(d.undo){const t=byId(S.tasks,d.undo);if(t)undo(t);return}
  if(d.task){const t=byId(S.tasks,d.task);if(t)taskModal(t);return}
  if(d.step)return stepClick(d.step);
  if(d.scheme)return schemeModal(byId(S.schemes,d.scheme));
  if(d.runnew){const sc=byId(S.schemes,d.runnew);return dateAsk("Начать: "+esc(sc.name),today(),day=>save(ins("p_runs",{pet_id:P().id,scheme_id:sc.id,name:sc.name,start_on:day}),"Круг начат — шаги в «Задачах»"),`<p class="meta" style="margin:0">Дата первого шага.</p>`)}
  if(d.runmove){const r=byId(S.runs,d.runmove);return dateAsk("Начало круга",r.start_on,day=>save(upd("p_runs",r.id,{start_on:day}),"Сроки пересчитаны"),`<p class="meta" style="margin:0">Несделанные шаги сдвинутся.</p>`)}
  if(d.rundel){const r=byId(S.runs,d.rundel);if(confirm("Убрать этот круг? Несделанные задачи удалятся."))save(rm("p_runs",r.id),"Убрано");return}
  if(d.med)return medModal(byId(S.meds,d.med));
  if(d.medstop){const x=byId(S.meds,d.medstop);if(confirm("Закончить курс «"+x.name+"» сегодня?"))save(upd("p_meds",x.id,{stopped_on:today()<x.start_on?x.start_on:today()}),"Курс закончен");return}
  if(d.visit)return visitModal(byId(S.visits,d.visit));
  if(d.weight)return weightModal(byId(S.weights,d.weight));
  if(d.period){const x=byId(S.periods,d.period);return periodModal(x,x.type)}
  if(d.newperiod)return periodModal(null,d.newperiod);
  if(d.note)return noteModal(byId(S.notes,d.note));
  if(d.newpet){const k=d.newpet,name=prompt("Как зовут?",user.user_metadata?.pets?.[k]||"");if(name&&name.trim())createPet(k,name.trim());return}
  switch(d.act){
    case"newtask":return taskModal(null);
    case"newscheme":return schemeModal(null);
    case"newmed":return medModal(null);
    case"newvisit":return visitModal(null);
    case"newweight":return weightModal(null);
    case"newnote":return noteModal(null);
    case"editpet":return petModal(P());
  }
});
// у кнопок-значков при наведении — подсказка с названием
document.addEventListener("mouseover",e=>{const b=e.target.closest("[aria-label]");if(b&&!b.title)b.title=b.getAttribute("aria-label")});

if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
