import { client } from "./cloud/workspace.js";
import type { Snapshot } from "./cloud/types.js";

export const BOH_FLOORS = [
  { code:"ss2", label:"SS-2", plan:"/projects/boh/ss2.png" },
  { code:"ss1", label:"SS-1", plan:"/projects/boh/ss1.png" },
  { code:"rdc", label:"RDC", plan:"/projects/boh/rdc.png" },
  { code:"n02", label:"N02", plan:"/projects/boh/n02.png" },
  { code:"n03", label:"N03", plan:"/projects/boh/n03.png" },
  { code:"n04", label:"N04", plan:"/projects/boh/n04.png" },
  { code:"n05", label:"N05", plan:"/projects/boh/n05.png" },
  { code:"n06", label:"N06", plan:"/projects/boh/n06.png" },
] as const;

export const BOH_FINISHES = [
  { code:"tile-dark-30", label:"Carreaux 30×30 gris foncé", color:"#ef8f9b" },
  { code:"tile-beige-60", label:"Carreaux 60×60 beige", color:"#e2df18" },
  { code:"tile-gray-30x60", label:"Carreaux 30×60 gris", color:"#22a748" },
  { code:"epoxy", label:"Peinture époxy", color:"#b8aa76" },
  { code:"parquet", label:"Parquet 120×20", color:"#102f2d" },
  { code:"stair-ceramic", label:"Escaliers - grès cérame antidérapant", color:"#fffbd0" },
  { code:"existing-marble", label:"Marbre existant - nettoyage et polissage", color:"#d5f7f7" },
] as const;

type MarkPoint=[number,number];
type ZoneStatus="done"|"progress"|"todo";
type ShapeKind="rectangle"|"polygon";
type MarkShape={kind:ShapeKind;status:ZoneStatus;points:MarkPoint[]};
type LegacyStroke={mode:"done"|"pending";size:number;points:MarkPoint[]};
type MarkItem=MarkShape|LegacyStroke;
type BohRow = { id:string; project_id:string; floor_code:string; floor_label:string; finish_code:string; finish_label:string; color:string; sort_order:number; progress:number; note:string; markup:MarkItem[]; version:number; confirmed_day?:string|null; confirmed_progress?:number };
type Draft = { progress:number; note:string; markup:MarkItem[] };
const byId = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const escapeHtml=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
let rows:BohRow[]=[];
let drafts:Record<string,Draft>={};
let activeFloor="rdc";
let snapshot:Snapshot|null=null;
let role="viewer";
let scale=1,panX=0,panY=0;
let markedRowId:string|null=null,markStatus:ZoneStatus="done",shapeKind:ShapeKind="rectangle",activeShape:MarkShape|null=null,polygonPoints:MarkPoint[]=[];
const pointers=new Map<number,{x:number;y:number}>();
let gesture:{distance:number;scale:number;midX:number;midY:number;panX:number;panY:number}|null=null;

function draftKey(){ return `muc-boh-drafts:${snapshot?.projectId || "guest"}:${snapshot?.userId || "guest"}`; }
function loadDrafts(){ try{drafts=JSON.parse(localStorage.getItem(draftKey()) || "{}");}catch{drafts={};} }
function persistDrafts(){ localStorage.setItem(draftKey(),JSON.stringify(drafts)); }
function safeMarkup(value:unknown):MarkItem[]{return Array.isArray(value)?value.filter((item):item is MarkItem=>Boolean(item&&typeof item==="object"&&Array.isArray((item as MarkItem).points)&&(("kind" in (item as object)&&["rectangle","polygon"].includes((item as MarkShape).kind)&&["done","progress","todo"].includes((item as MarkShape).status))||("mode" in (item as object)&&["done","pending"].includes((item as LegacyStroke).mode))))):[];}
function current(row:BohRow){const draft=drafts[row.id];return {progress:Number(draft?.progress??row.progress),note:draft?.note??row.note??"",markup:safeMarkup(draft?.markup??row.markup)};}
function editable(){ return Boolean(client && snapshot && role!=="viewer"); }
function message(value:string,error=false){ const node=byId("bohStatus");node.textContent=value;node.classList.toggle("error",error); }

function fallbackRows(projectId="guest"):BohRow[]{
  return BOH_FLOORS.flatMap((floor,floorIndex)=>BOH_FINISHES.map((finish,index)=>({id:`${floor.code}:${finish.code}`,project_id:projectId,floor_code:floor.code,floor_label:floor.label,finish_code:finish.code,finish_label:finish.label,color:finish.color,sort_order:floorIndex*10+index,progress:0,note:"",markup:[],version:1})));
}

function renderPlan(){
  const floor=BOH_FLOORS.find(item=>item.code===activeFloor)!;
  const image=byId<HTMLImageElement>("bohPlanImage");
  image.src=floor.plan; image.alt=`Plan de repérage des revêtements de sol BOH ${floor.label}`;
  byId("bohFloorTitle").textContent=`BOH - Carrelage · ${floor.label}`;
  markedRowId=null;closeMarkupTools();scale=1;panX=0;panY=0;applyTransform();renderMarkup();
}

function renderCards(){
  const floorRows=rows.filter(row=>row.floor_code===activeFloor).sort((a,b)=>a.sort_order-b.sort_order);
  const locked=!editable();
  byId("bohFinishList").innerHTML=floorRows.map(row=>{
    const value=current(row),dirty=Boolean(drafts[row.id]);
    return `<article class="boh-finish-card${dirty?" dirty":""}" data-boh-id="${row.id}"><header><span class="boh-finish-swatch" style="--finish:${row.color}"></span><strong>${escapeHtml(row.finish_label)}</strong><output>${value.progress} %</output></header><div class="progress-entry"><input type="range" min="0" max="100" step="1" value="${value.progress}" data-boh-progress ${locked?"disabled":""}><input type="number" min="0" max="100" value="${value.progress}" data-boh-number ${locked?"disabled":""}></div><div class="quick-progress">${[0,25,50,75,100].map(percent=>`<button type="button" data-boh-quick="${percent}" ${locked?"disabled":""}>${percent} %</button>`).join("")}</div><button type="button" class="boh-mark-trigger${markedRowId===row.id?" active":""}" data-boh-mark ${locked?"disabled":""}>Délimiter les zones sur le plan${value.markup.length?` · ${value.markup.length} zone(s)`:""}</button><label class="field"><span>Observation / justification</span><textarea rows="2" data-boh-note ${locked?"disabled":""} placeholder="Observation facultative ; obligatoire pour diminuer un ancien avancement.">${escapeHtml(value.note)}</textarea></label>${dirty?'<span class="boh-draft-badge">Modification locale</span>':""}</article>`;
  }).join("");
  const values=floorRows.map(row=>current(row).progress);
  const average=values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):0;
  byId("bohSummary").textContent=`Avancement moyen ${average} % · ${values.filter(value=>value===100).length}/${values.length} finitions terminées`;
  byId("bohDraftActions").hidden=!editable() || !Object.keys(drafts).length;
}

function setDraft(id:string,patch:Partial<Draft>,rerender=true){
  const row=rows.find(item=>item.id===id);if(!row)return;
  const value={...current(row),...patch};
  const sameMarkup=JSON.stringify(value.markup)===JSON.stringify(safeMarkup(row.markup));
  if(value.progress===Number(row.progress)&&value.note===(row.note||"")&&sameMarkup)delete drafts[id];else drafts[id]=value;
  persistDrafts();
  byId("bohDraftActions").hidden=!editable() || !Object.keys(drafts).length;
  if(rerender)renderCards();
}

async function refreshRows(){
  if(!client||!snapshot){rows=fallbackRows();message("Connectez-vous pour consulter l’avancement partagé.");renderCards();return;}
  message("Chargement de l’avancement BOH…");
  const {data,error}=await client.from("boh_progress").select("*").eq("project_id",snapshot.projectId).order("sort_order");
  if(error){rows=[];message(/boh_progress|schema cache/i.test(error.message)?"Le suivi BOH nécessite la migration Supabase 0021.":error.message,true);renderCards();return;}
  rows=(data||[]) as BohRow[];message("");renderCards();
}

export async function openBoh(nextSnapshot:Snapshot|null,nextRole:string){
  snapshot=nextSnapshot;role=nextRole;loadDrafts();
  const select=byId<HTMLSelectElement>("bohFloorSelect");
  select.innerHTML=BOH_FLOORS.map(floor=>`<option value="${floor.code}">${floor.label}</option>`).join("");
  activeFloor=sessionStorage.getItem("muc-boh-floor") || "rdc";
  if(!BOH_FLOORS.some(floor=>floor.code===activeFloor))activeFloor="rdc";
  select.value=activeFloor;renderPlan();await refreshRows();
}

async function saveDrafts(){
  if(!client||!snapshot||!editable())return;
  const entries=Object.entries(drafts);if(!entries.length)return;
  const button=byId<HTMLButtonElement>("confirmBohProgress");button.disabled=true;message(`Enregistrement de ${entries.length} modification(s)…`);
  try{
    for(const [id] of entries){
      const row=rows.find(item=>item.id===id);if(!row)continue;
      const value=current(row);
      const {data,error}=await client.rpc("submit_boh_progress",{p_area_id:id,p_base_version:row.version,p_progress:value.progress,p_note:value.note,p_markup:value.markup});
      if(error)throw error;
      const saved=Array.isArray(data)?data[0]:data;if(saved)Object.assign(row,saved);
      delete drafts[id];persistDrafts();
    }
    message("Avancement BOH enregistré et partagé.");renderCards();
  }catch(error){
    const raw=String((error as {message?:string})?.message||error);
    message(/correction_reason_required/.test(raw)?"Ajoutez une justification pour diminuer un avancement validé un jour précédent.":/version_conflict/.test(raw)?"Une autre personne a modifié cette zone. Rechargez le suivi BOH.":raw,true);
    await refreshRows();
  }finally{button.disabled=false;}
}

function applyTransform(){ byId("bohPlanLayer").style.transform=`translate(${panX}px,${panY}px) scale(${scale})`;byId("bohZoomValue").textContent=`${Math.round(scale*100)} %`; }
function fitPlan(){
  const viewport=byId("bohPlanViewport"),image=byId<HTMLImageElement>("bohPlanImage");if(!image.naturalWidth)return;
  scale=Math.min(viewport.clientWidth/image.naturalWidth,viewport.clientHeight/image.naturalHeight)*.96;
  panX=(viewport.clientWidth-image.naturalWidth*scale)/2;panY=(viewport.clientHeight-image.naturalHeight*scale)/2;applyTransform();
}
function zoomAt(next:number,x:number,y:number){const old=scale;scale=Math.max(.08,Math.min(3,next));panX=x-(x-panX)*(scale/old);panY=y-(y-panY)*(scale/old);applyTransform();}

function floorMarkup(){return rows.filter(row=>row.floor_code===activeFloor).flatMap(row=>current(row).markup);}
function markColors(status:ZoneStatus){return status==="done"?{fill:"rgba(21,148,71,.38)",stroke:"#087c36"}:status==="progress"?{fill:"rgba(238,138,34,.38)",stroke:"#c86808"}:{fill:"rgba(216,59,59,.35)",stroke:"#b51f2b"};}
function renderMarkup(extra:MarkShape|null=null){
  const canvas=byId<HTMLCanvasElement>("bohMarkupCanvas"),context=canvas.getContext("2d");if(!context)return;
  context.clearRect(0,0,canvas.width,canvas.height);
  for(const item of [...floorMarkup(),...(extra?[extra]:[])]){
    if(item.points.length<1)continue;
    context.beginPath();context.lineCap="round";context.lineJoin="round";
    if("mode" in item){
      context.lineWidth=Math.max(3,item.size*canvas.width);context.strokeStyle=item.mode==="done"?"rgba(21,148,71,.58)":"rgba(238,138,34,.58)";
      const [first,...rest]=item.points;context.moveTo(first[0]*canvas.width,first[1]*canvas.height);for(const point of rest)context.lineTo(point[0]*canvas.width,point[1]*canvas.height);context.stroke();continue;
    }
    const colors=markColors(item.status);context.lineWidth=Math.max(3,canvas.width*.0025);context.strokeStyle=colors.stroke;context.fillStyle=colors.fill;
    if(item.kind==="rectangle"&&item.points.length>=2){
      const [start,end]=item.points,x=start[0]*canvas.width,y=start[1]*canvas.height,w=(end[0]-start[0])*canvas.width,h=(end[1]-start[1])*canvas.height;context.rect(x,y,w,h);
    }else{
      const [first,...rest]=item.points;context.moveTo(first[0]*canvas.width,first[1]*canvas.height);for(const point of rest)context.lineTo(point[0]*canvas.width,point[1]*canvas.height);if(item!==extra)context.closePath();
    }
    if(item!==extra||item.kind==="rectangle")context.fill();context.stroke();
    if(item===extra&&item.kind==="polygon"){
      for(const point of item.points){context.beginPath();context.fillStyle=colors.stroke;context.arc(point[0]*canvas.width,point[1]*canvas.height,Math.max(5,canvas.width*.004),0,Math.PI*2);context.fill();}
    }
  }
}
function setupMarkupCanvas(){
  const image=byId<HTMLImageElement>("bohPlanImage"),layer=byId("bohPlanLayer"),canvas=byId<HTMLCanvasElement>("bohMarkupCanvas");if(!image.naturalWidth)return;
  layer.style.width=`${image.naturalWidth}px`;layer.style.height=`${image.naturalHeight}px`;
  canvas.width=1600;canvas.height=Math.round(1600*image.naturalHeight/image.naturalWidth);renderMarkup();
}
function setMarkStatus(next:ZoneStatus){
  markStatus=next;
  for(const [id,status] of [["bohMarkDone","done"],["bohMarkProgress","progress"],["bohMarkTodo","todo"]] as const){const button=byId<HTMLButtonElement>(id);const active=status===next;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));}
  if(activeShape)activeShape.status=next;renderMarkup(activeShape);
}
function setShapeKind(next:ShapeKind){
  shapeKind=next;activeShape=null;polygonPoints=[];
  for(const [id,kind] of [["bohShapeRectangle","rectangle"],["bohShapePolygon","polygon"]] as const){const button=byId<HTMLButtonElement>(id);const active=kind===next;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));}
  byId("bohClosePolygon").hidden=next!=="polygon";byId("bohMarkupHelp").textContent=next==="rectangle"?"Rectangle : posez un doigt, tirez puis relâchez.":"Polyligne : touchez chaque sommet, puis le premier point ou « Fermer le contour ».";renderMarkup();
}
function openMarkupTools(rowId:string){
  const row=rows.find(item=>item.id===rowId);if(!row||!editable())return;
  markedRowId=rowId;byId("bohMarkupTitle").textContent=`${row.floor_label} · ${row.finish_label}`;
  byId("bohMarkupTools").hidden=false;byId("bohPlanViewport").classList.add("marking");setMarkStatus("done");setShapeKind("rectangle");renderCards();renderMarkup();
}
function closeMarkupTools(){markedRowId=null;byId("bohMarkupTools").hidden=true;byId("bohPlanViewport")?.classList.remove("marking");activeShape=null;polygonPoints=[];}
function normalizedPoint(event:PointerEvent):MarkPoint{
  const rect=byId("bohPlanLayer").getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))];
}
function undoMarkup(clear=false){
  if(!markedRowId)return;const row=rows.find(item=>item.id===markedRowId);if(!row)return;
  if(activeShape||polygonPoints.length){activeShape=null;polygonPoints=[];renderMarkup();return;}
  const markup=current(row).markup;setDraft(row.id,{markup:clear?[]:markup.slice(0,-1)},false);renderMarkup();renderCards();
}
function saveShape(shape:MarkShape){
  if(!markedRowId)return;const row=rows.find(item=>item.id===markedRowId);if(!row)return;
  setDraft(row.id,{markup:[...current(row).markup,shape]},false);activeShape=null;polygonPoints=[];renderMarkup();renderCards();
}
function closePolygon(){
  if(polygonPoints.length<3){message("Ajoutez au moins trois points pour fermer la zone.",true);return;}
  saveShape({kind:"polygon",status:markStatus,points:[...polygonPoints]});message("Zone ajoutée. Validez pour la partager.");
}

byId("bohFloorSelect").addEventListener("change",event=>{activeFloor=(event.target as HTMLSelectElement).value;sessionStorage.setItem("muc-boh-floor",activeFloor);renderPlan();renderCards();});
byId("bohFinishList").addEventListener("input",event=>{
  const target=event.target as HTMLInputElement|HTMLTextAreaElement,card=target.closest<HTMLElement>("[data-boh-id]");if(!card)return;
  if(target.matches("[data-boh-progress],[data-boh-number]")){const progress=Math.max(0,Math.min(100,Number(target.value)||0));setDraft(card.dataset.bohId!,{progress},false);card.querySelectorAll<HTMLInputElement>("[data-boh-progress],[data-boh-number]").forEach(input=>input.value=String(progress));card.querySelector("output")!.textContent=progress+" %";}
  else if(target.matches("[data-boh-note]"))setDraft(card.dataset.bohId!,{note:target.value},false);
  const dirty=Boolean(drafts[card.dataset.bohId!]);card.classList.toggle("dirty",dirty);let badge=card.querySelector(".boh-draft-badge");if(dirty&&!badge){badge=document.createElement("span");badge.className="boh-draft-badge";badge.textContent="Modification locale";card.append(badge);}else if(!dirty)badge?.remove();
});
byId("bohFinishList").addEventListener("click",event=>{
  const target=event.target as HTMLElement,card=target.closest<HTMLElement>("[data-boh-id]");if(!card)return;
  const quick=target.closest<HTMLButtonElement>("[data-boh-quick]");if(quick){setDraft(card.dataset.bohId!,{progress:Number(quick.dataset.bohQuick)});return;}
  if(target.closest("[data-boh-mark]"))openMarkupTools(card.dataset.bohId!);
});
byId("confirmBohProgress").addEventListener("click",()=>void saveDrafts());
byId("cancelBohProgress").addEventListener("click",()=>{drafts={};persistDrafts();message("Modifications locales annulées.");renderCards();renderMarkup();});
byId("bohPlanImage").addEventListener("load",()=>requestAnimationFrame(()=>{setupMarkupCanvas();fitPlan();}));
byId("bohZoomIn").addEventListener("click",()=>zoomAt(scale*1.2,byId("bohPlanViewport").clientWidth/2,byId("bohPlanViewport").clientHeight/2));
byId("bohZoomOut").addEventListener("click",()=>zoomAt(scale/1.2,byId("bohPlanViewport").clientWidth/2,byId("bohPlanViewport").clientHeight/2));
byId("bohFitPlan").addEventListener("click",fitPlan);
byId("bohMarkDone").addEventListener("click",()=>setMarkStatus("done"));
byId("bohMarkProgress").addEventListener("click",()=>setMarkStatus("progress"));
byId("bohMarkTodo").addEventListener("click",()=>setMarkStatus("todo"));
byId("bohShapeRectangle").addEventListener("click",()=>setShapeKind("rectangle"));
byId("bohShapePolygon").addEventListener("click",()=>setShapeKind("polygon"));
byId("bohClosePolygon").addEventListener("click",closePolygon);
byId("bohMarkUndo").addEventListener("click",()=>undoMarkup());
byId("bohMarkClear").addEventListener("click",()=>undoMarkup(true));
byId("bohMarkClose").addEventListener("click",()=>{closeMarkupTools();renderCards();});
byId("bohPlanViewport").addEventListener("wheel",event=>{event.preventDefault();const rect=byId("bohPlanViewport").getBoundingClientRect();zoomAt(scale*(event.deltaY<0?1.12:.89),event.clientX-rect.left,event.clientY-rect.top);},{passive:false});
byId("bohPlanViewport").addEventListener("pointerdown",event=>{
  if(markedRowId&&event.target===byId("bohMarkupCanvas")){
    event.preventDefault();const point=normalizedPoint(event);
    if(shapeKind==="rectangle"){
      activeShape={kind:"rectangle",status:markStatus,points:[point,point]};renderMarkup(activeShape);byId("bohMarkupCanvas").setPointerCapture(event.pointerId);return;
    }
    if(polygonPoints.length>=3&&Math.hypot(point[0]-polygonPoints[0][0],point[1]-polygonPoints[0][1])<.05){closePolygon();return;}
    polygonPoints.push(point);activeShape={kind:"polygon",status:markStatus,points:[...polygonPoints]};renderMarkup(activeShape);return;
  }
  // Never capture taps made on the floating controls. Pointer capture on the
  // viewport retargets the following click on touch screens and made these
  // buttons appear unresponsive.
  if((event.target as HTMLElement).closest(".boh-markup-tools,.boh-zoom-controls,.boh-draft-actions,.boh-markup-legend"))return;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});byId("bohPlanViewport").setPointerCapture(event.pointerId);
});
byId("bohPlanViewport").addEventListener("pointermove",event=>{
  if(activeShape?.kind==="rectangle"){event.preventDefault();activeShape.points[1]=normalizedPoint(event);renderMarkup(activeShape);return;}
  const previous=pointers.get(event.pointerId);if(!previous)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const all=[...pointers.values()];
  if(all.length===1){panX+=event.clientX-previous.x;panY+=event.clientY-previous.y;applyTransform();gesture=null;return;}
  const [a,b]=all,distance=Math.hypot(a.x-b.x,a.y-b.y),midX=(a.x+b.x)/2,midY=(a.y+b.y)/2,rect=byId("bohPlanViewport").getBoundingClientRect();
  if(!gesture){gesture={distance,scale,midX,midY,panX,panY};return;}
  scale=Math.max(.08,Math.min(3,gesture.scale*distance/gesture.distance));
  panX=gesture.panX+(midX-gesture.midX)-(midX-rect.left-gesture.panX)*(scale/gesture.scale-1);
  panY=gesture.panY+(midY-gesture.midY)-(midY-rect.top-gesture.panY)*(scale/gesture.scale-1);applyTransform();
});
byId("bohPlanViewport").addEventListener("pointerup",event=>{
  if(activeShape?.kind==="rectangle"&&markedRowId){const [start,end]=activeShape.points;if(Math.hypot(end[0]-start[0],end[1]-start[1])>.004)saveShape(activeShape);else{activeShape=null;renderMarkup();}}
  pointers.delete(event.pointerId);gesture=null;
});
byId("bohPlanViewport").addEventListener("pointercancel",event=>{if(activeShape?.kind==="rectangle"){activeShape=null;renderMarkup();}pointers.delete(event.pointerId);gesture=null;});
