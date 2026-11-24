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
const PTYPES=["food","litter","other"];

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
const TABLES=["p_pets","p_weights","p_periods","p_visits","p_notes","p_meds","p_schemes","p_runs","p_steps","p_blocks"];
let S=null,user=null,tab=ls.get("tab","today"),petId=ls.get("pet",null),busy=0;
const ok=r=>{if(r.error)throw r.error;return r.data};
// база молча отдаёт не больше 1000 строк за запрос — берём порциями (как callAll в «Задачах»)
const PAGE=1000;
async function all(make){
  const out=[];
  for(let i=0;;i+=PAGE){const r=await make().range(i,i+PAGE-1);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<PAGE)return out}
}
async function load(){
  try{
    const from=addDays(today(),-90);
    const [rows,tasks,sections]=await Promise.all([
      Promise.all(TABLES.map(t=>all(()=>sb.from(t).select("*").order("id")))),
      all(()=>sb.from("tasks").select("*").not("pet","is",null).order("id")),
      all(()=>sb.from("sections").select("id,name,paused,space").order("id")),
    ]);
    // отметки — только задач питомцев (не всех задач), по 100 задач в запросе, чтобы адрес не был длинным
    const ids=tasks.map(t=>t.id),parts=[];
    for(let i=0;i<ids.length;i+=100)parts.push(ids.slice(i,i+100));
    const logs=(await Promise.all(parts.map(p=>all(()=>sb.from("task_log").select("*").in("task_id",p).gte("day",from).order("id"))))).flat();
    const d={};TABLES.forEach((t,i)=>d[t.slice(2)]=rows[i]);
    d.tasks=tasks;d.logs=logs;d.sections=sections;
    S=d;render();return true;
  }catch(e){
    console.error(e);
    const m=String(e&&e.message||""),net=!navigator.onLine||/fetch|network|load failed/i.test(m);
    const noDb=!net&&(e.code==="42P01"||e.code==="PGRST205"||/does not exist|schema cache/i.test(m));
    if(S&&!noDb){toast(net?"Нет связи с базой — показано последнее загруженное":"Не удалось обновить: "+m);return}
    main.innerHTML=noDb
      ?`<div class="empty"><b>База ещё не готова</b>Нужно один раз запустить в Supabase → SQL Editor сначала <code>016_early.sql</code> из «Задач», потом <code>001_pets.sql</code> и <code>003_use.sql</code> отсюда.<br><small>${esc(m)}</small></div>`
      :`<div class="empty"><b>${net?"Нет связи с базой":"Не удалось загрузить"}</b>${net?"Проверь интернет.":`<small>${esc(m)}</small>`}<br><button class="btn pri" data-act="retry">Повторить</button></div>`;
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
  for(const x of S.visits){if(x.task_id)m.set(x.task_id,{type:"visit",x});if(x.prep_task)m.set(x.prep_task,{type:"prep",x})}
  for(const x of S.runs)if(x.prep_task)m.set(x.prep_task,{type:"preprun",x});
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
  const icon=o?{med:"💊",step:"💉",visit:"🏥",prep:"📞",preprun:"📞",period:"🥣",bday:"🎂"}[o.type]:isDaily(t)?"🧽":"🔔";
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
  let h="",r="";
  if(late.length)h+=`<div class="alarm"><div class="ah">⚠ Пора! Не сделано вовремя: ${late.length}</div>${late.map(t=>taskRow(t,own)).join("")}</div>`;
  else if(!now.length)h+=`<div class="allgood">Всё сделано — ${esc(P().name)} доволен 🐾</div>`;
  h+=`<section class="sec"><div class="sh">Сегодня<span class="sp"><button class="btn sm" data-act="newtask">＋ Задача</button></span></div>
    ${now.length||doneToday.length?`<div class="list">${now.map(t=>taskRow(t,own)).join("")}${doneToday.map(t=>taskRow(t,own,{done:true})).join("")}</div>`:`<div class="empty">На сегодня ничего нет.</div>`}</section>`;
  if(soon.length)r+=`<section class="sec"><h2>Скоро (30 дней)</h2><div class="list">${soon.map(t=>taskRow(t,own)).join("")}</div></section>`;
  r+=`<section class="sec"><h2>Уход: регулярные дела</h2>
    ${care.length?`<div class="list">${care.map(t=>`<button class="row" data-task="${t.id}"><span class="ic">${isDaily(t)?"🧽":"🔁"}</span><span class="tx"><span class="nm">${esc(t.title)}</span><span class="meta">${esc(repeatLabel(t))}${t.due_date?" · следующий раз "+fmtShort(t.due_date):""}</span></span></button>`).join("")}</div>`:""}</section>`;
  main.innerHTML=`<div class="c2"><div class="ca">${h}</div><div class="ca">${r}</div></div>`;
}

function taskModal(t){
  const own=owners().get(t?.id);
  if(own&&own.type!=="bday")return ownedModal(t,own);
  const e=t?{...t}:{title:"",due_date:today(),repeat_unit:"day",repeat_every:1,repeat_from:"due",remind_at:null,remind_days:null};
  const fancy=t&&(t.repeat_unit==="cycle"||(t.repeat_weekdays||[]).length);   // такой повтор настраивается только в «Задачах»
  let mode=!e.repeat_unit?"once":isDaily(e)?"daily":"repeat";
  openModal(`<h2>${t?"Задача":"Новая задача"}</h2>
    <div class="fld"><label for="tt">Что сделать</label><input id="tt" value="${esc(e.title)}" placeholder="Помыть миски"></div>
    ${fancy?`<div class="hint">Повтор: ${esc(repeatLabel(e))}</div>`:`
    <div class="seg" id="tm">${[["once","Один раз"],["daily","Каждый день"],["repeat","Повтор"]].map(([k,v])=>`<button data-m="${k}" aria-pressed="${k===mode}">${v}</button>`).join("")}</div>
    <div class="grid3" id="trep"><div class="fld"><label for="tn">Раз в</label><input id="tn" type="number" min="1" value="${e.repeat_every||1}"></div>
      <div class="fld"><label for="tu">&nbsp;</label><select id="tu">${[["day","дней"],["week","недель"],["month","месяцев"],["year","лет"]].map(([k,v])=>`<option value="${k}"${e.repeat_unit===k?" selected":""}>${v}</option>`).join("")}</select></div>
      <div class="fld"><label for="tf">Считать от</label><select id="tf"><option value="due">срока</option><option value="done"${e.repeat_from==="done"?" selected":""}>выполнения</option></select></div></div>`}
    <div class="grid3"><div class="fld"><label for="td">${mode==="once"?"Срок":"Следующий раз"}</label><input id="td" type="date" value="${e.due_date||""}"></div>
      <div class="fld"><label for="ta">Напомнить в</label><input id="ta" type="time" value="${(e.remind_at||"").slice(0,5)}"></div>
      <div class="fld"><label for="tr">И за, дней</label><input id="tr" type="number" min="0" max="60" placeholder="—" value="${e.remind_days||""}"></div></div>
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
  const vax=o.type==="step"||o.type==="preprun"?isVax(S.schemes.find(sc=>sc.id===(o.type==="step"?S.runs.find(r=>r.id===o.x.run_id):o.x)?.scheme_id)):false;
  const proc=vax?"Здоровье → Прививки":"Здоровье → Процедуры и лекарства";
  const where={med:"Здоровье → Процедуры и лекарства",step:proc,preprun:proc,visit:"Здоровье → Ветклиника",prep:"Здоровье → Ветклиника",period:"Что используем"}[o.type];
  const ll=lastLog(t.id);
  openModal(`<h2>${esc(t.title)}</h2>
    <dl class="kv"><dt>Срок</dt><dd>${t.due_date?fmt(t.due_date):"—"}${t.done_on?" · сделано "+fmt(t.done_on):""}</dd>${t.repeat_unit?`<dt>Повтор</dt><dd>${esc(repeatLabel(t))}${t.repeat_until?" по "+fmt(t.repeat_until):""}</dd>`:""}</dl>
    <div class="hint">Из раздела «${where}»</div>
    <div class="fld"><label for="od">Сделано в день</label><input id="od" type="date" value="${today()}"></div>
    <div class="mact">${ll&&ll.status==="done"?`<button class="btn left" id="oundo">Снять последнюю отметку</button>`:""}<button class="btn" data-close>Закрыть</button>${t.done_on?"":`<button class="btn pri" id="odone">✓ Сделано</button>`}</div>`,m=>{
    const d=m.querySelector("#odone");if(d)d.onclick=()=>{const day=m.querySelector("#od").value||today();closeModal();complete(t,day)};
    const u=m.querySelector("#oundo");if(u)u.onclick=()=>{closeModal();undo(t)};
  });
}

/* ===== Здоровье ===== */
let hTab=ls.get("htab","vet");
// схемы прививок живут на «Прививках», остальные — на «Процедурах и лекарствах»
const isVax=sc=>!!sc&&/вакцин|привив/i.test(sc.name+" "+(sc.steps||[]).map(x=>x.t).join(" "));
// вкладка скрыта, пока не включена в ⚙; идёт курс лекарства — видна сама, чтобы он не потерялся
const procShown=()=>!!P().show_proc||mine(S.meds).some(x=>(x.stopped_on||x.end_on)>=today());
function renderHealth(){
  const tabs=[["vet","🏥 Ветклиника"],["vax","💉 Прививки"]];
  if(procShown())tabs.push(["pr","💊 Процедуры и лекарства"]);
  const cur=tabs.some(t=>t[0]===hTab)?hTab:"vet";
  main.innerHTML=`<div class="seg">${tabs.map(([k,v])=>`<button data-htab="${k}" aria-pressed="${k===cur}">${v}</button>`).join("")}</div>`+{vet:vetHTML,vax:vaxHTML,pr:prHTML}[cur]();
}
function vaxHTML(){
  const vs=mine(S.visits).filter(x=>x.vax_complex||x.vax_rabies||/привив|вакцин/i.test(x.reason||"")&&!/рекоменд|назнач|подготов|узнать/i.test(x.reason||"")).sort((a,b)=>b.day.localeCompare(a.day));
  let h=`<button class="add" data-act="newvax">＋ Прививка</button>`;
  h+=vs.length?`<div class="list"><div class="vx h"><span>Дата</span><span>Комплексная</span><span>Бешенство</span><span>Клиника</span></div>${vs.map(x=>`<button class="vx" data-visit="${x.id}"><b>${fmt(x.day)}</b><span data-l="Комплексная">${esc(x.vax_complex||"—")}</span><span data-l="Бешенство">${esc(x.vax_rabies||"—")}</span><span class="meta">${esc(x.clinic||"")}</span></button>`).join("")}</div>`:`<div class="empty">Прививок пока нет</div>`;
  return h+`<section class="sec"><h2>Подготовка к прививке</h2>${schemesHTML(isVax)}</section>`;
}
function prHTML(){
  return `<section class="sec"><h2>💊 Лекарства</h2>${medsHTML()}</section><section class="sec"><h2>🔁 Схемы процедур</h2>${schemesHTML(sc=>!isVax(sc))}</section>`;
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
    <span class="tx" data-step="${s.id}"><span class="nm">${esc(s.title)}</span><span class="meta">${s.done_on?"сделано "+fmt(s.done_on):(s.gap&&s.idx?`через ${plural(s.gap,"день","дня","дней")} после предыдущего · `:"")+(due?"до "+fmt(due):"")}${!s.task_id&&!s.done_on?" · задачи нет":""}</span></span>
    ${s.done_on?"":dueBadge(due,sc?.remind_days??7)}</div>`;
}
function schemesHTML(which){
  const scs=mine(S.schemes).filter(which).sort((a,b)=>(a.ord||0)-(b.ord||0)||a.created_at.localeCompare(b.created_at));
  let h=``;
  h+=`<div class="cards">`;
  for(const sc of scs){
    const rs=runsOf(sc),cur=rs.find(r=>!runDone(r))||null,past=rs.filter(r=>r!==cur);
    h+=`<div class="card"><div class="ch"><span class="tx"><h3>${esc(sc.name)}</h3><span class="meta">${(sc.steps||[]).length} шаг. ${sc.repeat_months?"· круг каждые "+sc.repeat_months+" мес.":""} · напомнить за ${sc.remind_days} дн.${sc.prep_days?" · записаться за "+sc.prep_days+" дн.":""}</span></span>
      <button class="icon" data-scheme="${sc.id}" aria-label="Изменить схему">✎</button></div>
      ${cur?`<div class="steps">${stepsOf(cur).map(s=>stepHTML(s,sc)).join("")}</div>
        <div class="btns"><button class="btn sm ghost" data-runmove="${cur.id}">Сдвинуть начало (${fmtShort(cur.start_on)})</button><button class="btn sm ghost danger" data-rundel="${cur.id}">Убрать этот круг</button></div>`
      :`<button class="add" data-runnew="${sc.id}">▶ Начать${past.length?" новый круг":""}</button>`}
      ${past.length?`<details class="past"><summary>История: ${plural(past.length,"круг","круга","кругов")}</summary>${past.map(r=>`<div class="meta" style="margin-bottom:6px"><b>${fmt(r.start_on)}</b>: ${stepsOf(r).map(s=>esc(s.title)+" — "+(s.done_on?fmtShort(s.done_on):"не сделано")).join("; ")}</div>`).join("")}</details>`:""}
    </div>`;
  }
  h+=`</div><button class="add" data-act="${which===isVax?"newvaxscheme":"newscheme"}">＋ Новая схема</button>`;
  return h;
}
function schemeModal(sc,vax){
  const e=sc?{...sc,steps:(sc.steps||[]).map(s=>({...s}))}:vax?{name:"Вакцинация",steps:[{t:"От блох",gap:0},{t:"От глистов",gap:""},{t:"Прививка",gap:""}],repeat_months:12,remind_days:7,prep_days:30}:{name:"",steps:[{t:"",gap:0}],repeat_months:"",remind_days:7,prep_days:0};
  openModal(`<h2>${sc?"Схема":"Новая схема"}</h2>
    <div class="fld"><label for="sn">Название</label><input id="sn" value="${esc(e.name)}"></div>
    <div class="fld"><span class="lb">Шаги</span><div id="srows" style="display:flex;flex-direction:column;gap:6px"></div>
      <button class="add" id="sadd">＋ Шаг</button></div>
    <div class="grid3"><div class="fld"><label for="sm">Новый круг через, мес.</label><input id="sm" type="number" min="0" max="60" placeholder="не повторять" value="${e.repeat_months||""}"></div>
      <div class="fld"><label for="sr">Напомнить за, дней</label><input id="sr" type="number" min="0" max="60" value="${e.remind_days??7}"></div>
      <div class="fld"><label for="sp">Записаться за, дней</label><input id="sp" type="number" min="0" max="180" placeholder="—" value="${e.prep_days||""}"></div></div>
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
      const row={name,steps,repeat_months:Math.round(num(m.querySelector("#sm").value)||0)||null,remind_days:Math.max(0,Math.round(num(m.querySelector("#sr").value)??7)),prep_days:prepDays(m.querySelector("#sp").value)};
      closeModal();
      save(sc?upd("p_schemes",sc.id,row):ins("p_schemes",{...row,pet_id:P().id}),"Схема сохранена");
    };
  });
}
const prepDays=v=>Math.min(180,Math.max(0,Math.round(num(v)||0)));
function dateAsk(title,def,fn,label="Дата"){
  openModal(`<h2>${title}</h2><div class="fld"><label for="dq">${label}</label><input id="dq" type="date" value="${def}"></div>
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
  dateAsk("✓ "+esc(s.title),today(),day=>{if(t)complete(t,day);else save(upd("p_steps",s.id,{done_on:day}),"Отмечено ✓")},"Когда сделано");
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
    ${active?`<div class="bar" title="дано ${given} из ${c.doses}"><i style="width:${pct}%"></i></div><span class="meta">Дано ${given} из ${c.doses}</span>`:""}
    ${active?`<div class="btns"><button class="btn sm ghost" data-medstop="${x.id}">⏹ Закончить сегодня</button></div>`:""}</div>`;
}
function medsHTML(){
  const ms=mine(S.meds).sort((a,b)=>b.start_on.localeCompare(a.start_on)),t0=today();
  const live=x=>(x.stopped_on||x.end_on)>=t0;
  const act=ms.filter(live),past=ms.filter(x=>!live(x));
  let h=`<button class="add" data-act="newmed">＋ Лекарство</button>`;
  h+=act.length?`<div class="cards">${act.map(x=>medHTML(x,true)).join("")}</div>`:`<div class="empty">Сейчас ничего не даём 🎉</div>`;
  if(past.length)h+=`<section class="sec"><h2>История курсов</h2><div class="cards">${past.map(x=>medHTML(x,false)).join("")}</div></section>`;
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
    <div class="grid2"><div class="fld"><label for="ms">Давать с</label><input id="ms" type="date" value="${e.start_on}"></div>
      <div class="fld"><label for="mdn">На сколько дней</label><input id="mdn" type="number" min="1" max="730" value="${daysBetween(e.start_on,e.end_on)+1}"></div>
      <div class="fld"><label for="me">По включительно</label><input id="me" type="date" value="${e.end_on}"></div>
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
    const days=()=>Math.round(num(v("#mdn"))||0);
    const toEnd=()=>{if(v("#ms")&&days()>0)m.querySelector("#me").value=addDays(v("#ms"),days()-1);calc()};
    m.querySelector("#ms").oninput=m.querySelector("#mdn").oninput=toEnd;
    m.querySelector("#me").oninput=()=>{const n=v("#ms")&&v("#me")?daysBetween(v("#ms"),v("#me"))+1:0;if(n>0)m.querySelector("#mdn").value=n;calc()};
    ["#ma","#mu","#mev"].forEach(id=>m.querySelector(id).oninput=calc);
    // щелчок по числу выделяет его целиком: иначе «0,3» дописывалось к «1»
    ["#ma","#mt","#mdn","#mev"].forEach(id=>m.querySelector(id).addEventListener("focus",ev=>setTimeout(()=>ev.target.select(),0)));
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
  let h=`<button class="add" data-act="newvisit">＋ Приём</button>`,y="";
  if(!vs.length)return h+`<div class="empty">Дневник пуст</div>`;
  for(const x of vs){
    const yy=x.day.slice(0,4);
    if(yy!==y){h+=`${y?"</div></section>":""}<section class="sec"><h2>${yy}</h2><div class="list">`;y=yy}
    const n=x.next_on?daysBetween(today(),x.next_on):null;
    h+=`<button class="vrow" data-visit="${x.id}"><span><span class="d">${fmt(x.day)}</span>${x.clinic?`<span class="meta">${esc(x.clinic)}</span>`:""}</span><span class="nm">${esc(x.reason||"приём")}</span>
      <span class="vt">${x.done?`<span><i>Сделали</i>${esc(x.done)}</span>`:""}${x.prescribed?`<span><i>Назначили</i>${esc(x.prescribed)}</span>`:""}${x.next_on?`<span><i>Следующий</i>${fmt(x.next_on)}${x.next_why?" — "+esc(x.next_why):""} ${n>=0&&n<=14?dueBadge(x.next_on,14):""}</span>`:""}${x.note?`<span class="meta">${esc(x.note)}</span>`:""}</span></button>`;
  }
  return h+"</div></section>";
}
function visitModal(x,pre){
  const last=mine(S.visits).sort((a,b)=>b.day.localeCompare(a.day))[0];
  const e=x||{day:today(),clinic:last?.clinic||"",reason:"",done:"",prescribed:"",next_on:"",next_why:"",note:"",prep_days:30,...pre};
  openModal(`<h2>${x?"Приём":"Новый приём"}</h2>
    <div class="grid2"><div class="fld"><label for="vd">Дата</label><input id="vd" type="date" value="${e.day}"></div>
      <div class="fld"><label for="vc">Клиника, врач</label><input id="vc" value="${esc(e.clinic||"")}"></div></div>
    <div class="fld"><label for="vr">Зачем пришли</label><input id="vr" value="${esc(e.reason||"")}" placeholder="Прививка, анализ крови…"></div>
    <div class="fld"><label for="vdn">Что сделали по факту</label><textarea id="vdn">${esc(e.done||"")}</textarea></div>
    <div class="fld"><label for="vp">Что назначили</label><textarea id="vp">${esc(e.prescribed||"")}</textarea></div>
    <div class="grid2"><div class="fld"><label for="vxc">Прививка комплексная</label><input id="vxc" value="${esc(e.vax_complex||"")}"></div>
      <div class="fld"><label for="vxr">Прививка от бешенства</label><input id="vxr" value="${esc(e.vax_rabies||"")}"></div></div>
    <div class="grid2"><div class="fld"><label for="vn">Следующий приём</label><input id="vn" type="date" value="${e.next_on||""}"></div>
      <div class="fld"><label for="vpd">Записаться за, дней</label><input id="vpd" type="number" min="0" max="180" placeholder="—" value="${e.prep_days||""}"></div></div>
    <div class="btns">${[["w2","через 2 недели"],["1","через месяц"],["6","через полгода"]].map(([k,t])=>`<button type="button" class="btn sm" data-next="${k}">${t}</button>`).join("")}</div>
    <div class="fld"><label for="vw">Зачем следующий</label><input id="vw" value="${esc(e.next_why||"")}"></div>
    <div class="fld"><label for="vo">Заметка</label><textarea id="vo">${esc(e.note||"")}</textarea></div>
    <div class="mact">${x?`<button class="btn danger left" id="vdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="vsave">Сохранить</button></div>`,m=>{
    m.classList.add("fixed");
    const v=id=>m.querySelector(id).value.trim()||null;
    m.querySelectorAll("[data-next]").forEach(b=>b.onclick=()=>{const d=m.querySelector("#vd").value||today(),k=b.dataset.next;
      m.querySelector("#vn").value=k==="w2"?addDays(d,14):addMonths(d,+k);m.dataset.dirty="1"});
    if(x)armDelete(m.querySelector("#vdel"),"Удалить запись?",()=>{closeModal();save(rm("p_visits",x.id),"Удалено")});
    m.querySelector("#vsave").onclick=()=>{
      const row={day:v("#vd")||today(),clinic:v("#vc"),reason:v("#vr"),done:v("#vdn"),prescribed:v("#vp"),next_on:v("#vn"),next_why:v("#vw"),note:v("#vo"),vax_complex:v("#vxc"),vax_rabies:v("#vxr"),prep_days:prepDays(m.querySelector("#vpd").value)};
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
// ширина графика — по ширине страницы (1 единица = 1 пиксель, подписи не мельчают); ось X — по датам
const MON=["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
function chartWidth(){const cs=getComputedStyle(main);return Math.max(280,main.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-18)}
function chartSVG(p,fl){
  const from=addDays(today(),-365);let pts=wRange==="all"?fl:fl.filter(x=>x.w.day>=from);
  if(pts.length<2)pts=fl.slice(-12);if(pts.length<1)return"";
  const W=chartWidth(),H=W>700?300:230,L=44,R=14,T=12,B=30;
  const vals=pts.map(x=>x.kg).concat([+p.w_min||null,+p.w_max||null].filter(Boolean));
  let lo=Math.floor((Math.min(...vals)-.1)*4)/4,hi=Math.ceil((Math.max(...vals)+.1)*4)/4;
  // по X — время: месяц без взвешиваний занимает своё место
  let d0=pts[0].w.day,d1=pts[pts.length-1].w.day;
  if(wRange!=="all"&&daysBetween(from,d0)>0)d0=from;
  if(d0===d1){d0=addDays(d0,-15);d1=addDays(d1,15)}
  const span=daysBetween(d0,d1);
  const X=d=>L+daysBetween(d0,d)/span*(W-L-R),Y=v=>T+(hi-v)*(H-T-B)/(hi-lo);
  let s=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="График веса">`;
  // сетка и подписи веса: шаг 0,25 или 0,5 кг
  const ys=(hi-lo)>1.6?.5:.25;
  for(let v=Math.ceil(lo/ys)*ys;v<=hi+1e-9;v+=ys)s+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L-8}" y="${Y(v)+4}" text-anchor="end">${n2(Math.round(v*100)/100)}</text>`;
  if(p.w_min&&p.w_max)s+=`<rect class="band" x="${L}" y="${Y(Math.min(+p.w_max,hi))}" width="${W-L-R}" height="${Y(Math.max(+p.w_min,lo))-Y(Math.min(+p.w_max,hi))}"/>`;
  if(p.w_norm)s+=`<line class="norm" x1="${L}" x2="${W-R}" y1="${Y(+p.w_norm)}" y2="${Y(+p.w_norm)}"/>`;
  // подписи месяцев: шаг 1/2/3/6/12 мес., чтобы между ними было ≥ 64 px
  const months=span/30.44,fit=Math.max(1,Math.floor((W-L-R)/64));
  const mstep=[1,2,3,6,12,24].find(k=>months/k<=fit)||24;
  let m=parse(d0);m=new Date(m.getFullYear(),m.getMonth()+1,1);
  while(m.getMonth()%mstep)m.setMonth(m.getMonth()+1);
  let prevY=null;
  for(;iso(m)<=d1;m.setMonth(m.getMonth()+mstep)){
    const x=X(iso(m)),y=m.getFullYear();
    const lab=mstep>=12?String(y):(m.getMonth()===0||prevY===null?MON[m.getMonth()]+" "+String(y).slice(2):MON[m.getMonth()]);prevY=y;
    s+=`<line class="grid${m.getMonth()===0?" yr":""}" x1="${x}" x2="${x}" y1="${T}" y2="${H-B}"/><text x="${x}" y="${H-9}" text-anchor="middle">${lab}</text>`;
  }
  s+=`<polyline class="ln" points="${pts.map(x=>X(x.w.day).toFixed(1)+","+Y(x.kg).toFixed(1)).join(" ")}"/>`;
  const r=W/pts.length<14?3.5:5;
  pts.forEach(x=>s+=`<circle class="pt${x.out||x.jump?" bad":x.grow?" grow":""}" cx="${X(x.w.day).toFixed(1)}" cy="${Y(x.kg).toFixed(1)}" r="${r}"><title>${fmt(x.w.day)}: ${n2(x.kg)} кг</title></circle>`);
  return s+"</svg>";
}
let resizeT=null;
addEventListener("resize",()=>{clearTimeout(resizeT);resizeT=setTimeout(()=>{if(S&&tab==="weight"&&!$("#modalRoot").innerHTML)render()},150)});
let wRange=ls.get("wrange","year");
function renderWeight(){
  const p=P(),fl=wFlags(p,wOf()),last=fl[fl.length-1];
  let h=`<div class="card"><div class="ch"><span class="tx">${last?`<span class="big">${n2(last.kg)} кг</span><span class="meta">${fmt(last.w.day)}${last.d!==null?` · ${last.d>0?"+":""}${last.d} г с прошлого раза`:""}</span>`:`<span class="nm">Взвешиваний пока нет</span>`}</span>
    <button class="btn pri" data-act="newweight">＋ Взвесить</button></div>
    ${last&&(last.out||last.jump)?`<div class="d-bad">⚠ ${last.out?"Вес вне обычной зоны ("+n2(+p.w_min)+"–"+n2(+p.w_max)+" кг)":"Вес резко изменился"} — стоит показать врачу.</div>`:""}</div>`;
  if(fl.length)h+=`<div class="chart"><div class="seg" style="margin:0 4px 8px">${[["year","За год"],["all","За всё время"]].map(([k,v])=>`<button data-wrange="${k}" aria-pressed="${k===wRange}">${v}</button>`).join("")}</div>${chartSVG(p,fl)}</div>`;
  if(fl.length)h+=`<section class="sec"><h2>Все взвешивания</h2><div class="list wl">${[...fl].reverse().map(x=>`<button class="row" data-weight="${x.w.id}"><span class="tx"><span class="nm">${n2(x.kg)} кг</span><span class="meta">${fmt(x.w.day)}${x.w.note?" · "+esc(x.w.note):""}</span></span>
    ${x.d!==null?`<span class="${x.jump?"d-bad":x.d>0?"d-up":"meta"}">${x.d>0?"+":""}${x.d} г</span>`:""}${x.out?`<span class="badge b-late">вне зоны</span>`:""}${x.grow?`<span class="badge b-date">растёт</span>`:""}</button>`).join("")}</div></section>`;
  main.innerHTML=h;
}
function weightDoubt(row,w){
  const out=[];
  if(row.day>today())out.push("Дата в будущем: "+fmt(row.day));
  const me={...row,id:"new",created_at:"9"},list=wOf().filter(x=>!w||x.id!==w.id).concat(me).sort((a,b)=>a.day.localeCompare(b.day)||a.created_at.localeCompare(b.created_at));
  const fl=wFlags(P(),list),i=fl.findIndex(x=>x.w===me),f=fl[i],prev=fl[i-1];
  if(prev&&(f.jump||Math.abs(f.d)>prev.kg*300&&!f.grow))out.push(`${f.d>0?"+":"−"}${Math.abs(f.d)} г с ${fmt(prev.w.day)} (было ${n2(prev.kg)} кг)`);
  return out.join(" · ");
}
function weightModal(w){
  const e=w||{day:today(),kg:"",note:""};
  openModal(`<h2>${w?"Взвешивание":"Взвесить"}</h2>
    <div class="grid2"><div class="fld"><label for="wd">Дата</label><input id="wd" type="date" value="${e.day}"></div>
      <div class="fld"><label for="wk">Вес, кг</label><input id="wk" inputmode="decimal" value="${e.kg?n2(+e.kg):""}" placeholder="4,5 или 4520"></div></div>
    <div class="fld"><label for="wn">Заметка</label><input id="wn" value="${esc(e.note||"")}"></div>
    <div class="d-bad small" id="ww">&nbsp;</div>
    <div class="mact">${w?`<button class="btn danger left" id="wdel">Удалить</button>`:""}<button class="btn" data-close>Отмена</button><button class="btn pri" id="wsave">Сохранить</button></div>`,m=>{
    m.querySelector("#wk").focus();
    if(w)armDelete(m.querySelector("#wdel"),"Удалить?",()=>{closeModal();save(rm("p_weights",w.id),"Удалено")});
    const sv=m.querySelector("#wsave");let asked="",askedAt=0;
    ["#wd","#wk"].forEach(id=>m.querySelector(id).addEventListener("input",()=>{if(!asked)return;asked="";m.querySelector("#ww").textContent="\u00a0";sv.textContent="Сохранить"}));
    const go=()=>{
      let kg=num(m.querySelector("#wk").value);if(!kg)return m.querySelector("#wk").focus();
      if(kg>100)kg=kg/1000;   // ввели в граммах
      const row={day:m.querySelector("#wd").value||today(),kg,note:m.querySelector("#wn").value.trim()||null};
      // странный вес или дата в будущем — спросить до записи, второе нажатие записывает
      const why=weightDoubt(row,w);
      if(why&&asked!==why){asked=why;askedAt=Date.now();m.querySelector("#ww").textContent=why;sv.textContent="Всё равно записать";return}
      if(why&&Date.now()-askedAt<800)return;
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

/* ===== Что используем — use.js ===== */
let use=null;
const U=()=>use||(use=makeUse({esc,fmt,today,addDays,daysBetween,plural,dueBadge,mine,P,openModal,closeModal,armDelete,toast,save,ins,upd,rm,wr,sb,$,S:()=>S}));
function renderFood(){U().render(main)}

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
  let r=`<section class="sec"><div class="sh">📝 Заметки<span class="sp"><button class="btn sm" data-act="newnote">＋ Заметка</button></span></div>
    ${ns.length?`<div class="list">${ns.map(x=>`<button class="row" data-note="${x.id}"><span class="tx"><span class="nm">${x.pinned?"📌 ":""}${esc(x.title)}</span>${x.body?`<span class="meta" style="white-space:pre-wrap">${esc(x.body.length>220?x.body.slice(0,220)+"…":x.body)}</span>`:""}</span></button>`).join("")}</div>`
    :`<div class="empty">Пока пусто</div>`}</section>`;
  const free=Object.keys(KINDS).filter(k=>!S.pets.some(x=>x.kind===k));
  if(free.length)r+=`<section class="sec"><h2>Другие питомцы</h2><div class="btns">${free.map(k=>`<button class="add" data-newpet="${k}">＋ ${KINDS[k].icon} ${KINDS[k].name}</button>`).join("")}</div></section>`;
  main.innerHTML=`<div class="c2"><div class="ca">${h}</div><div class="ca">${r}</div></div>`;
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
  ["Уведомления","Пуши на телефон включаются в «Задачах» (⚙ → «Уведомления»): все напоминания отсюда приходят оттуда. Новая задача отсюда появляется и в «Задачах» — в разделе «Питомцы», со значком питомца; отметили здесь — отмечено и там. Повтор, который здесь не настроить, меняется в «Задачах». Задачи, созданные из лекарств, схем, приёмов или корма, меняются там, откуда созданы."],
  ["Загрузка из файла","⚙ → «Загрузить из файла»: файл готовит Claude — вес, приёмы у врача, корм, заметки для выбранного питомца. Что уже есть, не задваивается. Загруженные раньше приёмы обновляются, только если ты их не меняла. «Скачать копию» — сохранить всё в файл."],
  ["Профиль","Имя, вид, порода, день рождения и заметки (что любит и не любит, важное про здоровье). День рождения попадает в «Задачи» ежегодным событием; имя — то же, что у значка питомца в «Задачах»."],
  ["Сегодня","Красная плашка — то, что пора было сделать, а не сделано. Ниже — дела на сегодня, «Скоро» на 30 дней вперёд (жёлтым — когда уже пора готовиться) и регулярный уход. Щелчок по названию — изменить."],
  ["Снять отметку","Отметила по ошибке: сегодняшнее — нажми ✓ ещё раз у зачёркнутой строки; задачу из лекарства, приёма или схемы — щёлкни по названию → «Снять последнюю отметку»; сделанный шаг схемы — щёлкни по нему → «Снять отметку»."],
  ["Задача «Записаться»","За 30 дней до следующего приёма или до прививки в «Задачах» появляется «Записаться: …» и висит, пока не отметишь. На сам день — своя задача. Сколько дней — поле «Записаться за, дней» у приёма и у схемы; пусто — не нужна. Если до срока уже меньше, задача не создаётся."],
  ["Ветклиника","Дневник приёмов по годам: зачем пришли, что сделали по факту, что назначили. Щелчок по строке — открыть. «Следующий приём» сразу становится задачей; «через полгода» и другие кнопки считают от даты приёма. В скобках после лекарства — от чего его обычно применяют, это не диагноз."],
  ["Прививки","Все прививки по датам. Это те же приёмы ветклиники: прививка записана в приёме, поэтому ничего не задваивается. Ниже — схема подготовки: цепочка шагов, например: от блох → через 5 дней от глистов → через 10 дней прививка (интервалы — как скажет врач). «Начать» — каждому шагу появляется задача. Отметила шаг позже или раньше (по кружку или названию) — сроки следующих сдвигаются сами. Сдвинула начало — сдвинутся несделанные. После последнего шага новый круг ставится сам через заданное число месяцев. Изменения схемы касаются новых кругов."],
  ["Процедуры и лекарства","Вкладка скрыта, пока не нужна: включается в ⚙ галочкой, данные не теряются. Идёт курс лекарства — она видна сама. Лекарство: с какого числа и на сколько дней (или по какое число включительно), сколько за раз, сколько раз в день и раз в сколько дней. Приложение само считает дни, приёмы и сколько всего нужно. Каждый приём — задача с напоминанием в своё время; после последнего дня она закончится сама. «Закончить сегодня» — если врач отменил раньше. «Дано» считается по отметкам за последние 90 дней. Там же — другие схемы процедур, они работают как схема прививки."],
  ["Вес","Записываешь вес (можно в граммах: 4520). Зелёная полоса на графике — обычная зона, пунктир — обычный вес; зона и порог скачка меняются в профиле. Красная точка — вне зоны или скачок больше порога меньше чем за полтора месяца. Первый год (от дня рождения) — рост: серые точки без предупреждений. Резкий скачок или дату в будущем приложение переспросит до записи. Если в «Задачах» есть задача «Взвесить…», она отметится сама."],
  ["Что используем","Корм, наполнитель и свои блоки («＋ Создать блок», ✎ — переименовать или удалить пустой). У записи — картинка, бренд, даты «с … по …» («по» пусто — значит сейчас), когда куплено, заметка. Перенести в другой блок — поле «Блок». Новый корм или наполнитель закрывает прежний днём раньше; в своих блоках несколько средств живут рядом. «Проверить до» — у корма, назначенного на срок: за неделю придёт задача спросить врача. Корм закончили или сменили раньше — несделанная задача сама уйдёт из «Задач», об этом предупредит строка в окне."],
  ["Ошибки","Если что-то сломалось, программа сама записывает это на устройство: «Ошибки: N» внизу этой справки. Там время и место сбоя, отказы базы и когда не было связи. «Скопировать» — и прислать Claude. Данных питомца, почты и паролей в журнале нет. Хранится 30 последних ошибок за 30 дней, у каждого устройства свои; одинаковые складываются в одну строку «×2». Программа не открылась совсем — внизу пустого экрана появится полоска «Программа не запустилась» с той же кнопкой."],
  ["Версия","Номер версии — внизу этой справки (дата и время выкладки). Если приложение давно открыто, а на сайте вышла новая версия, вверху появится «Есть новая версия» — нажми «Обновить»."],
];
function openHelp(){openModal(`<h2>Справка</h2><div class="help">${HELP.map(([t,x])=>`<details><summary>${t}</summary><p>${x}</p></details>`).join("")}</div>
  <div class="mact"><span class="left ver">${verText()}</span>${window.ERRLOG?ERRLOG.button():""}<button class="btn" data-close>Закрыть</button></div>`,m=>m.classList.add("fixed"))}
function openGear(){openModal(`<h2>Настройки</h2>
  <p class="meta" style="margin:0">${esc(user.email||"")}</p>
  <div class="btns"><button class="btn" id="imp">📁 Загрузить из файла</button><button class="btn" id="exp">💾 Скачать копию</button></div>
  <input type="file" id="impf" accept=".json,application/json" hidden>
  ${P()?`<label class="optl"><input type="checkbox" id="shp"${P().show_proc?" checked":""}> Процедуры и лекарства</label>`:""}
  <div class="mact"><button class="btn left danger" id="out">Выйти</button><button class="btn" data-close>Закрыть</button></div>`,m=>{
  m.querySelector("#out").onclick=()=>{closeModal();sb.auth.signOut()};
  m.querySelector("#exp").onclick=exportFile;
  const shp=m.querySelector("#shp");if(shp)shp.onchange=()=>save(upd("p_pets",P().id,{show_proc:shp.checked}),shp.checked?"Вкладка в «Здоровье» включена":"Вкладка скрыта");
  const f=m.querySelector("#impf");
  m.querySelector("#imp").onclick=()=>{if(!P())return toast("Сначала создай профиль");f.click()};
  f.onchange=async()=>{const file=f.files[0];if(!file)return;
    try{const d=JSON.parse(await file.text());closeModal();await importData(d)}catch(e){toast("Не удалось прочитать файл: "+e.message)}};
})}
/* загрузка из файла: {weights:[{day,kg,note}], visits:[{day,clinic,reason,done,prescribed,note,vax_complex,vax_rabies,was}], periods:[{type,block,name,brand,…}], notes:[{title,body}]}
   Уже загруженный приём обновляется, только если поле сейчас такое же, как в was (Юля его не меняла); прививки — только в пустые поля. */
async function importData(d){
  if(!await load())return;   // сверяем со свежим: на экране могло быть старое (правила с телефона)
  const p=P(),key=(...a)=>a.map(x=>String(x??"").trim().toLowerCase()).join("|"),same=(a,b)=>String(a??"").replace(/\r/g,"").trim()===String(b??"").replace(/\r/g,"").trim();
  const have={w:new Set(mine(S.weights).map(x=>key(x.day,(+x.kg).toFixed(3)))),
    p:new Set(mine(S.periods).map(x=>key(x.type,x.name,x.start_on))),n:new Set(mine(S.notes).map(x=>key(x.title)))};
  const isDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||"");
  const W=(d.weights||[]).filter(x=>isDay(x.day)&&num(x.kg)>0).map(x=>({pet_id:p.id,day:x.day,kg:num(x.kg)>100?num(x.kg)/1000:num(x.kg),note:x.note||null})).filter(x=>!have.w.has(key(x.day,x.kg.toFixed(3))));
  const fv=(d.visits||[]).filter(x=>isDay(x.day)),V=[],VU=[];let kept=0;
  for(const x of fv){
    // тот же приём: день и причина; причину могли переписать — тогда единственный приём этого дня
    const onDay=mine(S.visits).filter(v=>v.day===x.day);
    const e=onDay.find(v=>key(v.reason)===key(x.reason))||(onDay.length===1&&fv.filter(y=>y.day===x.day).length===1?onDay[0]:null);
    if(!e){
      // следующий приём ставим, только если он ещё впереди (иначе получится старая задача)
      V.push({pet_id:p.id,day:x.day,clinic:x.clinic||null,reason:x.reason||null,done:x.done||null,prescribed:x.prescribed||null,note:x.note||null,vax_complex:x.vax_complex||null,vax_rabies:x.vax_rabies||null,
        next_on:isDay(x.next_on)&&x.next_on>=today()?x.next_on:null,next_why:x.next_why||null,prep_days:x.prep_days??30});
      continue;
    }
    const patch={};let touched=false;
    for(const f of ["clinic","reason","done","prescribed","note"])if(x.was&&f in x.was&&!same(e[f],x[f])){if(same(e[f],x.was[f]))patch[f]=x[f]||null;else touched=true}
    for(const f of ["vax_complex","vax_rabies"])if(x[f]&&!e[f])patch[f]=x[f];
    if(touched)kept++;
    if(Object.keys(patch).length)VU.push([e.id,patch]);
  }
  const PR=(d.periods||[]).filter(x=>x.name&&PTYPES.includes(x.type||"food")).map(x=>({row:{pet_id:p.id,type:x.type||"food",name:x.name,brand:x.brand||null,bought_on:isDay(x.bought_on)?x.bought_on:null,reason:x.reason||null,start_on:isDay(x.start_on)?x.start_on:null,end_on:isDay(x.end_on)?x.end_on:null,
    check_on:isDay(x.check_on)&&x.check_on>=today()?x.check_on:null,note:x.note||null},block:x.block})).filter(x=>!have.p.has(key(x.row.type,x.row.name,x.row.start_on)));
  const N=(d.notes||[]).filter(x=>x.title).map(x=>({pet_id:p.id,title:x.title,body:x.body||null,pinned:!!x.pinned})).filter(x=>!have.n.has(key(x.title)));
  const bday=!p.birthday&&isDay(d.pet?.birthday)?d.pet.birthday:null;
  const total=W.length+V.length+PR.length+N.length+(bday?1:0);
  const left=kept?`, не тронуто (менялись у тебя): ${kept}`:"";
  if(!total&&!VU.length)return toast("Новых записей в файле нет — всё уже загружено"+left,6000);
  if(!confirm(`Загрузить для «${p.name}»: взвешиваний ${W.length}, приёмов ${V.length}, корм и средства ${PR.length}, заметок ${N.length}${bday?", день рождения "+fmt(bday):""}${VU.length?"; обновить приёмов "+VU.length:""}${left}?`))return;
  const put=(t,rows)=>rows.length?wr(sb.from(t).insert(rows)):null;
  await save((async()=>{
    const ids=new Map();
    for(const b of new Set(PR.filter(x=>x.row.type==="other"&&x.block).map(x=>x.block)))ids.set(b,await U().blockId(b));
    // ряды с одинаковым набором полей — иначе база ругается
    const rows=PR.map(x=>({...x.row,block_id:ids.get(x.block)||null}));
    await Promise.all([put("p_weights",W),put("p_visits",V),put("p_periods",rows),put("p_notes",N),bday?upd("p_pets",p.id,{birthday:bday}):null,...VU.map(([id,r])=>upd("p_visits",id,r))]);
    toast(`Загружено: ${total}, обновлено приёмов: ${VU.length}${left}`,6000);
  })());
}
function exportFile(){
  const p=P();if(!p)return;
  const pick=(rows,f)=>mine(rows).map(x=>Object.fromEntries(f.map(k=>[k,x[k]])));
  const d={pet:{name:p.name,kind:p.kind,birthday:p.birthday,sex:p.sex,breed:p.breed,color:p.color,chip:p.chip,notes:p.notes},
    weights:pick(S.weights,["day","kg","note"]),visits:pick(S.visits,["day","clinic","reason","done","prescribed","next_on","next_why","prep_days","vax_complex","vax_rabies","note"]),
    periods:mine(S.periods).map(x=>({...Object.fromEntries(["type","name","brand","reason","start_on","end_on","check_on","bought_on","note"].map(k=>[k,x[k]])),block:U().blockOf(x)?.name||null})),notes:pick(S.notes,["title","body","pinned"]),
    meds:pick(S.meds,["name","unit","amount","times","every_days","start_on","end_on","stopped_on","reason","note"]),
    schemes:pick(S.schemes,["name","steps","repeat_months","remind_days","prep_days"])};
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
  // набрала что-то — щелчок мимо окна его не закрывает (терялся текст), Esc спрашивает
  m.addEventListener("input",()=>m.dataset.dirty="1");
  ov.addEventListener("click",e=>{if(e.target.closest("[data-close]")||(e.target===ov&&!m.dataset.dirty))closeModal()});
  document.addEventListener("keydown",escClose);
  init&&init(m);fitModal(m);return m;
}
/* Окно .fixed — высота по содержимому, замеренная при открытии (а не 760 px с пустым местом внизу).
   Дальше от нажатий не меняется: поле «по расписанию» держит место через visibility, лишнее прокручивается внутри. */
function fitModal(m){
  if(!m.classList.contains("fixed"))return;
  m.style.height="auto";
  m.style.height=Math.min(m.scrollHeight+2,innerHeight-12)+"px";
}
let checkLock=0;
function escClose(e){
  if(e.key!=="Escape")return;
  const m=$("#modalRoot .modal");
  if(m&&m.dataset.dirty&&!confirm("Закрыть без сохранения?"))return;
  closeModal();
}
function closeModal(){$("#modalRoot").innerHTML="";document.removeEventListener("keydown",escClose)}
// второе нажатие — не раньше 0,8 с: двойной щелчок по «Удалить» удалял сразу
function armDelete(btn,text,fn){btn.onclick=()=>{if(btn.dataset.armed){if(Date.now()-btn.dataset.armed>800)fn();return}btn.dataset.armed=Date.now();btn.textContent=text;btn.classList.add("armed")}}
let tt=null;
function toast(msg,ms){let el=$(".toast");if(!el){el=document.createElement("div");el.className="toast";el.setAttribute("role","status");document.body.appendChild(el)}el.textContent=msg;clearTimeout(tt);tt=setTimeout(()=>el.remove(),ms||(/^Не удалось/.test(msg)?7000:2600))}

/* ---------- щелчки ---------- */
const byId=(list,id)=>list.find(x=>x.id===id);
document.addEventListener("click",e=>{
  const b=e.target.closest("button,[data-task],[data-step]");if(!b)return;
  const d=b.dataset;
  if(d.act==="retry"){if(!b.disabled){b.disabled=true;b.textContent="Пробую…";setTimeout(load,600)}return}
  if(!S)return;
  if(d.tab){tab=d.tab;ls.set("tab",tab);render();scrollTo(0,0);return}
  if(d.pet){petId=d.pet;ls.set("pet",petId);render();return}
  if(d.wrange){wRange=d.wrange;ls.set("wrange",wRange);render();return}
  if(d.htab){hTab=d.htab;ls.set("htab",hTab);render();return}
  if(b.id==="help")return openHelp();
  if(b.id==="gear")return openGear();
  // ✓ / снять: после отметки строка уезжает, и второй быстрый щелчок попадал в соседнюю задачу — 0,8 с ✓ не нажимается
  if(d.done||d.undo){if(Date.now()<checkLock)return;checkLock=Date.now()+800}
  if(d.done){const t=byId(S.tasks,d.done);if(t)complete(t);return}
  if(d.undo){const t=byId(S.tasks,d.undo);if(t)undo(t);return}
  if(d.task){const t=byId(S.tasks,d.task);if(t)taskModal(t);return}
  if(d.step)return stepClick(d.step);
  if(d.scheme)return schemeModal(byId(S.schemes,d.scheme));
  if(d.runnew){const sc=byId(S.schemes,d.runnew);return dateAsk("Начать: "+esc(sc.name),today(),day=>save(ins("p_runs",{pet_id:P().id,scheme_id:sc.id,name:sc.name,start_on:day}),"Круг начат — шаги в «Задачах»"),"Дата первого шага")}
  if(d.runmove){const r=byId(S.runs,d.runmove);return dateAsk("Начало круга",r.start_on,day=>save(upd("p_runs",r.id,{start_on:day}),"Сроки пересчитаны"),"Дата первого шага")}
  if(d.rundel){const r=byId(S.runs,d.rundel);if(confirm("Убрать этот круг? Несделанные задачи удалятся."))save(rm("p_runs",r.id),"Убрано");return}
  if(d.med)return medModal(byId(S.meds,d.med));
  if(d.medstop){const x=byId(S.meds,d.medstop);if(confirm("Закончить курс «"+x.name+"» сегодня?"))save(upd("p_meds",x.id,{stopped_on:today()<x.start_on?x.start_on:today()}),"Курс закончен");return}
  if(d.visit)return visitModal(byId(S.visits,d.visit));
  if(d.weight)return weightModal(byId(S.weights,d.weight));
  if(d.period){const x=byId(S.periods,d.period);return U().periodModal(x,x.type)}
  if(d.newperiod)return U().periodModal(null,d.newperiod,d.blk);
  if(d.block)return U().blockModal(byId(S.blocks,d.block));
  if(d.note)return noteModal(byId(S.notes,d.note));
  if(d.newpet){const k=d.newpet,name=prompt("Как зовут?",user.user_metadata?.pets?.[k]||"");if(name&&name.trim())createPet(k,name.trim());return}
  switch(d.act){
    case"newtask":return taskModal(null);
    case"newscheme":return schemeModal(null);
    case"newvaxscheme":return schemeModal(null,true);
    case"newvax":return visitModal(null,{reason:"Прививка"});
    case"newblock":return U().blockModal(null);
    case"newmed":return medModal(null);
    case"newvisit":return visitModal(null);
    case"newweight":return weightModal(null);
    case"newnote":return noteModal(null);
    case"editpet":return petModal(P());
  }
});
// у кнопок-значков при наведении — подсказка с названием
document.addEventListener("mouseover",e=>{const b=e.target.closest("[aria-label]");if(b&&!b.title)b.title=b.getAttribute("aria-label")});

if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(e=>console.error(e));
})();

// Версия на экране и сверка с сайтом (ревизия 22.11.2026). Номер — в version.js: каждая выкладка ставит новый
// (крючок перед коммитом не пустит изменение docs/ без него). На сайте новее — полоска «Есть новая версия».
const verText=()=>"Версия "+(window.APP_VERSION||"?");
async function checkVersion(){
  if(!window.APP_VERSION||document.getElementById("updBar"))return;
  try{
    const m=(await (await fetch("version.js",{cache:"no-cache"})).text()).match(/APP_VERSION\s*=\s*"([^"]+)"/);
    if(!m||m[1]===window.APP_VERSION)return;
    const b=document.createElement("div");b.id="updBar";b.className="upd-bar";
    b.innerHTML='Есть новая версия <button type="button">Обновить</button>';
    b.querySelector("button").onclick=()=>location.reload();
    document.body.appendChild(b);
  }catch(e){}
}
checkVersion();
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkVersion()});
