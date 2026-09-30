type Point={x:number;y:number};
type Zone={id:string;level:string;layer:string;points:Point[]};
type WorkshopDraft={fileName:string;levels:string[];layers:string[];zones:Zone[]};
type Bounds={minX:number;minY:number;maxX:number;maxY:number};

declare global { interface Window { DxfParser:new()=>{parseSync:(source:string)=>any}; } }

const byId=<T extends Element=HTMLElement>(id:string)=>document.getElementById(id) as unknown as T;
const escapeHtml=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const numberValue=(value:number)=>Number(value).toFixed(4).replace(/\.0+$/,"");
let projectId="mixed-use",canEdit=false,initialized=false,source="",fileName="",dxf:any=null;
let levels=["NIVEAU"],layers:string[]=[],zones:Zone[]=[],activePoints:Point[]=[],tool:"draw"|"pan"="draw";
let bounds:Bounds={minX:0,minY:0,maxX:100,maxY:100},view={x:0,y:-100,width:100,height:100};
let panStart:{x:number;y:number;viewX:number;viewY:number}|null=null;

function draftKey(){return `muc-dxf-workshop:${projectId}`;}
function loadDraft(){fileName="";levels=["NIVEAU"];layers=[];zones=[];activePoints=[];try{const saved=JSON.parse(localStorage.getItem(draftKey())||"null") as WorkshopDraft|null;if(saved){fileName=saved.fileName||"";levels=saved.levels?.length?saved.levels:["NIVEAU"];layers=saved.layers||[];zones=saved.zones||[];}}catch{/* Brouillon illisible ignoré. */}}
function persist(){localStorage.setItem(draftKey(),JSON.stringify({fileName,levels,layers,zones} satisfies WorkshopDraft));}
function message(value:string,error=false){const node=byId("workshopStatus");node.textContent=value;node.classList.toggle("error",error);}
function colorFor(value:string){let hash=0;for(const char of value)hash=(hash*31+char.charCodeAt(0))>>>0;return `hsl(${hash%360} 58% 46%)`;}
function cleanText(entity:any){return String(entity.text||entity.string||entity.value||"").replace(/\\P/g," ").replace(/[{}]/g,"").trim();}
function entityPoint(entity:any){return entity.position||entity.startPoint||entity.vertices?.[0]||null;}
function allPoints(model:any):Point[]{
  const result:Point[]=[];
  const visit=(entities:any[],depth=0)=>{if(depth>6)return;for(const entity of entities||[]){
    for(const point of entity.vertices||entity.controlPoints||[])if(Number.isFinite(point.x)&&Number.isFinite(point.y))result.push({x:point.x,y:point.y});
    if(entity.center&&Number.isFinite(entity.radius))result.push({x:entity.center.x-entity.radius,y:entity.center.y-entity.radius},{x:entity.center.x+entity.radius,y:entity.center.y+entity.radius});
    const point=entityPoint(entity);if(point&&Number.isFinite(point.x)&&Number.isFinite(point.y))result.push({x:point.x,y:point.y});
    if(entity.type==="INSERT"&&model.blocks?.[entity.name])visit(model.blocks[entity.name].entities,depth+1);
  }};visit(model.entities);return result;
}
function computeBounds(model:any):Bounds{
  const headerMin=model.header?.$EXTMIN,headerMax=model.header?.$EXTMAX;
  if(headerMin&&headerMax&&Number.isFinite(headerMin.x)&&Number.isFinite(headerMax.x)&&headerMax.x>headerMin.x&&headerMax.y>headerMin.y)return {minX:headerMin.x,minY:headerMin.y,maxX:headerMax.x,maxY:headerMax.y};
  const points=allPoints(model);if(!points.length)return {minX:0,minY:0,maxX:100,maxY:100};
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  const padding=Math.max(maxX-minX,maxY-minY)*.02||1;return {minX:minX-padding,minY:minY-padding,maxX:maxX+padding,maxY:maxY+padding};
}
function pointsPath(points:Point[],close=false){return points.length?`M ${points.map(point=>`${numberValue(point.x)} ${numberValue(point.y)}`).join(" L ")}${close?" Z":""}`:"";}
function curvedPoints(entity:any){const start=entity.type==="CIRCLE"?0:entity.startAngle||0;let length=entity.type==="CIRCLE"?Math.PI*2:entity.angleLength;if(!Number.isFinite(length)||length<=0)length+=Math.PI*2;const segments=Math.max(18,Math.ceil(Math.abs(length)/(Math.PI/24)));return Array.from({length:segments+1},(_,index)=>({x:entity.center.x+Math.cos(start+length*index/segments)*entity.radius,y:entity.center.y+Math.sin(start+length*index/segments)*entity.radius}));}
function entitySvg(entity:any,blocks:any,ancestors:string[]=[]):string{
  if(entity.inPaperSpace)return "";
  if(entity.type==="INSERT"||entity.type==="DIMENSION"){
    const name=entity.type==="INSERT"?entity.name:entity.block,block=blocks?.[name];if(!block||ancestors.includes(name)||ancestors.length>6)return "";
    const content=(block.entities||[]).map((part:any)=>entitySvg(part,blocks,[...ancestors,name])).join("");if(!content)return "";
    if(entity.type==="DIMENSION")return `<g>${content}</g>`;
    const position=entity.position||{x:0,y:0},base=block.position||{x:0,y:0};
    return `<g transform="translate(${numberValue(position.x)} ${numberValue(position.y)}) rotate(${numberValue(entity.rotation||0)}) scale(${numberValue(entity.xScale||1)} ${numberValue(entity.yScale||1)}) translate(${numberValue(-base.x)} ${numberValue(-base.y)})">${content}</g>`;
  }
  if(entity.type==="LINE")return `<path d="${pointsPath(entity.vertices||[])}"/>`;
  if(["LWPOLYLINE","POLYLINE"].includes(entity.type))return `<path d="${pointsPath(entity.vertices||[],Boolean(entity.shape))}"/>`;
  if(["ARC","CIRCLE"].includes(entity.type)&&entity.center)return `<path d="${pointsPath(curvedPoints(entity),entity.type==="CIRCLE")}"/>`;
  if(entity.type==="SPLINE"&&entity.controlPoints?.length)return `<path d="${pointsPath(entity.controlPoints)}"/>`;
  return "";
}
function renderSvg(){
  const svg=byId<SVGSVGElement>("workshopSvg");svg.setAttribute("viewBox",`${view.x} ${view.y} ${view.width} ${view.height}`);
  if(!dxf){svg.innerHTML="";byId("workshopEmpty").hidden=false;return;}
  byId("workshopEmpty").hidden=true;
  const architecture=(dxf.entities||[]).map((entity:any)=>entitySvg(entity,dxf.blocks||{})).join("");
  const texts=(dxf.entities||[]).filter((entity:any)=>["TEXT","MTEXT"].includes(entity.type)&&entityPoint(entity)).map((entity:any)=>{const point=entityPoint(entity),text=cleanText(entity);return text?`<text x="${numberValue(point.x)}" y="${numberValue(-point.y)}">${escapeHtml(text)}</text>`:"";}).join("");
  const saved=zones.map(zone=>`<path class="workshop-zone" style="--zone:${colorFor(zone.layer)}" d="${pointsPath(zone.points,true)}"><title>${escapeHtml(zone.level)} · ${escapeHtml(zone.layer)}</title></path>`).join("");
  const active=activePoints.length?`<path class="workshop-active-zone" d="${pointsPath(activePoints)}"/>${activePoints.map((point,index)=>`<circle data-active-point="${index}" cx="${numberValue(point.x)}" cy="${numberValue(point.y)}" r="${numberValue(Math.max(view.width,view.height)*.004)}"/>`).join("")}`:"";
  svg.innerHTML=`<g class="workshop-architecture" transform="scale(1 -1)">${architecture}</g><g class="workshop-zones" transform="scale(1 -1)">${saved}${active}</g><g class="workshop-texts">${texts}</g>`;
}
function renderControls(){
  const level=byId<HTMLSelectElement>("workshopLevel"),layer=byId<HTMLSelectElement>("workshopLayer");
  const selectedLevel=level.value||levels[0],selectedLayer=layer.value;
  level.innerHTML=levels.map(item=>`<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");level.value=levels.includes(selectedLevel)?selectedLevel:levels[0];
  layer.innerHTML=layers.length?layers.map(item=>`<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join(""):'<option value="">Ajoutez un élément de légende</option>';if(layers.includes(selectedLayer))layer.value=selectedLayer;
  byId("workshopZoneList").innerHTML=zones.length?zones.map((zone,index)=>`<article><i style="--zone:${colorFor(zone.layer)}"></i><span><strong>${escapeHtml(zone.layer)}</strong><small>${escapeHtml(zone.level)} · ${zone.points.length} sommets</small></span><button type="button" data-workshop-delete="${index}">Supprimer</button></article>`).join(""):'<p class="access-hint">Aucun contour fermé.</p>';
  byId("workshopPlanTitle").textContent=fileName||"Aucun plan importé";byId("workshopPlanSummary").textContent=`${zones.length} contour(s) · ${layers.length} calque(s)`;
  byId("workshopDraw").classList.toggle("active",tool==="draw");byId("workshopPan").classList.toggle("active",tool==="pan");
  byId("workshopSvg").classList.toggle("panning",tool==="pan");
}
function render(){renderControls();renderSvg();}
function fit(){view={x:bounds.minX,y:-bounds.maxY,width:Math.max(1,bounds.maxX-bounds.minX),height:Math.max(1,bounds.maxY-bounds.minY)};renderSvg();}
function svgPoint(event:PointerEvent){const svg=byId<SVGSVGElement>("workshopSvg"),matrix=svg.getScreenCTM();if(!matrix)return null;const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:point.x,y:-point.y};}
function closeContour(){
  if(activePoints.length<3){message("Ajoutez au moins trois points avant de fermer le contour.",true);return;}
  const layer=byId<HTMLSelectElement>("workshopLayer").value,level=byId<HTMLSelectElement>("workshopLevel").value;
  if(!layer){message("Choisissez d’abord un élément de légende.",true);return;}
  zones.push({id:crypto.randomUUID(),level,layer,points:[...activePoints]});activePoints=[];persist();render();message(`Contour ajouté au calque « ${layer} » (${level}).`);
}
function sanitizeLayerName(value:string){return value.normalize("NFC").replace(/[<>\\/:;?*|="]/g,"-").replace(/\s+/g," ").trim().slice(0,255)||"ZONE";}
function layerRecord(name:string){return `0\nLAYER\n2\n${name}\n70\n0\n62\n3\n6\nCONTINUOUS\n`;}
function polylineRecord(zone:Zone){const name=sanitizeLayerName(zone.layer);return `0\nLWPOLYLINE\n8\n${name}\n90\n${zone.points.length}\n70\n1\n${zone.points.map(point=>`10\n${numberValue(point.x)}\n20\n${numberValue(point.y)}\n`).join("")}`;}
export function appendWorkshopLayers(original:string,inputZones:Zone[]){
  let result=original.replace(/\r\n/g,"\n"),names=[...new Set(inputZones.map(zone=>sanitizeLayerName(zone.layer)))];
  const layerEntries=names.map(layerRecord).join("");
  if(/\n0\nTABLE\n2\nLAYER\n/i.test(result))result=result.replace(/(\n0\nTABLE\n2\nLAYER\n[\s\S]*?)(\n0\nENDTAB)/i,`$1\n${layerEntries.trimEnd()}$2`);
  const marker=/\n0\nSECTION\n2\nENTITIES\n/i.exec(result);if(!marker)throw new Error("La section ENTITIES du DXF est introuvable.");
  const end=result.indexOf("0\nENDSEC",marker.index+marker[0].length);if(end<0)throw new Error("La fin de la section ENTITIES est introuvable.");
  result=result.slice(0,end)+inputZones.map(polylineRecord).join("")+result.slice(end);return result.replace(/\n/g,"\r\n");
}
function download(content:string,type:string,name:string){const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([content],{type}));link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
function detectMetadata(){
  const texts:string[]=(dxf.entities||[]).filter((entity:any)=>["TEXT","MTEXT"].includes(entity.type)).map(cleanText).filter((text:string)=>text.length>=2&&text.length<=120);
  const detectedLevels=[...new Set(texts.map((text:string)=>text.match(/\b(?:SS\s*-?\s*\d+|RDC|R\s*\+\s*\d+|N(?:IVEAU)?\s*0?\d+)\b/i)?.[0]?.replace(/\s+/g,"").toUpperCase()).filter(Boolean))] as string[];
  if(detectedLevels.length)levels=[...new Set([...levels,...detectedLevels])];
  const suggestions:string[]=[...new Set<string>(texts.filter((text:string)=>!/^\d+(?:[.,]\d+)?$/.test(text)&&!detectedLevels.includes(text.toUpperCase())))].sort((a,b)=>a.localeCompare(b,"fr",{numeric:true})).slice(0,250);
  byId("workshopDetectedTexts").innerHTML=suggestions.map(text=>`<option value="${escapeHtml(text)}"></option>`).join("");
}
async function importFile(file:File){
  if(!file.name.toLowerCase().endsWith(".dxf")){message("Exportez d’abord le plan AutoCAD au format DXF.",true);return;}
  source=await file.text();try{dxf=new window.DxfParser().parseSync(source);if(!dxf)throw new Error("DXF vide");fileName=file.name;bounds=computeBounds(dxf);fit();detectMetadata();persist();render();message("DXF chargé. Ajoutez les noms de la légende puis dessinez les contours fermés.");}catch(error){dxf=null;message(`DXF illisible : ${error instanceof Error?error.message:String(error)}`,true);render();}
}
function initialize(){
  if(initialized)return;initialized=true;
  byId<HTMLInputElement>("workshopFile").addEventListener("change",event=>{const file=(event.target as HTMLInputElement).files?.[0];if(file)void importFile(file);});
  byId("workshopAddLevel").addEventListener("submit",event=>{event.preventDefault();const input=byId<HTMLInputElement>("workshopLevelName"),value=input.value.trim();if(value&&!levels.includes(value)){levels.push(value);input.value="";persist();renderControls();}});
  byId("workshopAddLegend").addEventListener("submit",event=>{event.preventDefault();const input=byId<HTMLInputElement>("workshopLegendName"),value=input.value.trim();if(value&&!layers.includes(value)){layers.push(value);input.value="";persist();renderControls();byId<HTMLSelectElement>("workshopLayer").value=value;}});
  byId("workshopDraw").addEventListener("click",()=>{tool="draw";renderControls();});byId("workshopPan").addEventListener("click",()=>{tool="pan";renderControls();});
  byId("workshopClose").addEventListener("click",closeContour);byId("workshopUndoPoint").addEventListener("click",()=>{activePoints.pop();renderSvg();});
  byId("workshopDeleteZone").addEventListener("click",()=>{if(zones.length){zones.pop();persist();render();message("Dernier contour supprimé.");}});
  byId("workshopClear").addEventListener("click",()=>{if(zones.length&&confirm("Supprimer tous les contours de ce brouillon ?")){zones=[];activePoints=[];persist();render();message("Tous les contours ont été supprimés.");}});
  byId("workshopZoneList").addEventListener("click",event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>("[data-workshop-delete]");if(!button)return;zones.splice(Number(button.dataset.workshopDelete),1);persist();render();message("Contour supprimé.");});
  byId("workshopExportDxf").addEventListener("click",()=>{if(!source)return message("Importez le DXF original avant l’export.",true);if(!zones.length)return message("Dessinez au moins un contour fermé.",true);try{download(appendWorkshopLayers(source,zones),"application/dxf",`${fileName.replace(/\.dxf$/i,"")}-calques.dxf`);message("DXF exporté avec les calques de la légende.");}catch(error){message(error instanceof Error?error.message:String(error),true);}});
  byId("workshopExportJson").addEventListener("click",()=>download(JSON.stringify({fileName,levels,layers,zones},null,2),"application/json",`${fileName.replace(/\.dxf$/i,"")||"plan"}-delimitations.json`));
  const svg=byId<SVGSVGElement>("workshopSvg");svg.addEventListener("pointerdown",event=>{if(!dxf||!canEdit)return;if(tool==="pan"){panStart={x:event.clientX,y:event.clientY,viewX:view.x,viewY:view.y};svg.setPointerCapture(event.pointerId);return;}const point=svgPoint(event);if(!point)return;const threshold=Math.max(view.width,view.height)*.015;if(activePoints.length>=3&&Math.hypot(point.x-activePoints[0].x,point.y-activePoints[0].y)<threshold)return closeContour();activePoints.push(point);renderSvg();message(`${activePoints.length} point(s). Touchez le premier point ou « Fermer le contour ».`);});
  svg.addEventListener("pointermove",event=>{if(!panStart||tool!=="pan")return;view.x=panStart.viewX-(event.clientX-panStart.x)*view.width/svg.clientWidth;view.y=panStart.viewY-(event.clientY-panStart.y)*view.height/svg.clientHeight;renderSvg();});
  const stopPan=()=>{panStart=null;};svg.addEventListener("pointerup",stopPan);svg.addEventListener("pointercancel",stopPan);
  svg.addEventListener("wheel",event=>{if(!dxf)return;event.preventDefault();const factor=event.deltaY>0?1.15:.87,point=svgPoint(event as unknown as PointerEvent);if(!point)return;const cursorY=-point.y,rx=(point.x-view.x)/view.width,ry=(cursorY-view.y)/view.height;view.width*=factor;view.height*=factor;view.x=point.x-rx*view.width;view.y=cursorY-ry*view.height;renderSvg();},{passive:false});
}

export function openDxfWorkshop(nextProjectId:string,editable:boolean){projectId=nextProjectId;canEdit=editable;initialize();loadDraft();render();message(fileName?"Réimportez le DXF original pour continuer ou exporter le brouillon.":"Importez un fichier DXF pour commencer.");}

export {sanitizeLayerName};
