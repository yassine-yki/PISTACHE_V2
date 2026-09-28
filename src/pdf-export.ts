import type { jsPDF } from "jspdf";

export type DailyProgressLine = {
  taskId:string;
  room:number;
  floorCode:string;
  zone:string;
  group:string;
  label:string;
  before:number;
  after:number;
  gain:number;
};

export type DailyHistoryItem = {
  room_task_id:string;
  before_state?:{progress?:number};
  after_state?:{progress?:number};
  created_at:string;
};

export type DailyTask = {id:string;key:string;floorCode?:string;active:boolean};

export function dailyProgressLines(
  history:DailyHistoryItem[],
  tasks:DailyTask[],
  describe:(zone:string,code:string)=>{group:string;label:string}|null,
):DailyProgressLine[] {
  const taskById=new Map(tasks.filter(task=>task.active).map(task=>[task.id,task]));
  const changes=new Map<string,{before:number;after:number}>();
  for(const item of [...history].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))) {
    const task=taskById.get(item.room_task_id);if(!task)continue;
    const before=Number(item.before_state?.progress ?? 0);
    const after=Number(item.after_state?.progress ?? before);
    const current=changes.get(task.id);
    if(current)current.after=after;
    else changes.set(task.id,{before,after});
  }
  const lines:DailyProgressLine[]=[];
  for(const [taskId,change] of changes) {
    const task=taskById.get(taskId);if(!task)continue;
    const [roomText,zone,code]=task.key.split(":");
    const description=describe(zone,code);if(!description)continue;
    const before=Math.max(0,Math.min(100,change.before));
    const after=Math.max(0,Math.min(100,change.after));
    if(after<=before)continue;
    lines.push({taskId,room:Number(roomText),floorCode:task.floorCode || "",zone,
      group:description.group,label:description.label,before,after,gain:after-before});
  }
  return lines.sort((a,b)=>a.floorCode.localeCompare(b.floorCode,"fr",{numeric:true})||a.room-b.room
    || a.zone.localeCompare(b.zone,"fr")||a.group.localeCompare(b.group,"fr")||a.label.localeCompare(b.label,"fr"));
}

export type DailyFloorReport = {code:string;label:string;planSvg:string;lines:DailyProgressLine[]};

function safeText(value:unknown):string {
  return String(value ?? "").replace(/[\u2010-\u2015]/g,"-");
}

async function svgPng(svg:string):Promise<string> {
  const blob=new Blob([svg],{type:"image/svg+xml;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  try {
    const image=new Image();
    image.src=url;
    await image.decode();
    const maxWidth=2200;
    const ratio=Math.min(1,maxWidth/Math.max(1,image.naturalWidth));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const context=canvas.getContext("2d");
    if(!context)throw new Error("Le plan ne peut pas être converti en image.");
    context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL("image/png",0.94);
  } finally { URL.revokeObjectURL(url); }
}

function drawHeader(pdf:jsPDF,dateLabel:string,floorLabel:string,continued=false):number {
  pdf.setFillColor(39,83,47);pdf.rect(0,0,297,18,"F");
  pdf.setTextColor(255,255,255);pdf.setFont("helvetica","bold");pdf.setFontSize(15);
  pdf.text("MUC - Avancement journalier",12,11.5);
  pdf.setFont("helvetica","normal");pdf.setFontSize(9);pdf.text(dateLabel,285,11.2,{align:"right"});
  pdf.setTextColor(26,42,33);pdf.setFont("helvetica","bold");pdf.setFontSize(13);
  pdf.text(`${floorLabel}${continued ? " - suite" : ""}`,12,27);
  return 32;
}

function drawTableHeader(pdf:jsPDF,y:number):number {
  const titles=["Chambre","Zone","Tâche","Sous-tâche","Hier","Actuel","Gain"];
  const widths=[22,25,58,100,22,22,24];
  let x=12;pdf.setFillColor(232,239,231);pdf.rect(12,y,273,8,"F");
  pdf.setTextColor(31,57,39);pdf.setFont("helvetica","bold");pdf.setFontSize(7.6);
  titles.forEach((title,index)=>{pdf.text(title,x+2,y+5.2);x+=widths[index];});
  return y+8;
}

function drawRows(pdf:jsPDF,lines:DailyProgressLine[],startIndex:number,y:number,dateLabel:string,floorLabel:string):{index:number;y:number} {
  const widths=[22,25,58,100,22,22,24];
  let index=startIndex;
  while(index<lines.length) {
    const line=lines[index];
    const values=[String(line.room),line.zone==="bathroom"?"Salle de bain":line.zone==="bedroom"?"Chambre":"Loggia",
      line.group,line.label,`${line.before} %`,`${line.after} %`,`+${line.gain} %`];
    const wrapped=values.map((value,column)=>pdf.splitTextToSize(safeText(value),widths[column]-4) as string[]);
    const rowHeight=Math.max(8,Math.max(...wrapped.map(parts=>parts.length))*3.6+3);
    if(y+rowHeight>197) {
      pdf.addPage();y=drawTableHeader(pdf,drawHeader(pdf,dateLabel,floorLabel,true));
    }
    if(index%2===1){pdf.setFillColor(248,250,247);pdf.rect(12,y,273,rowHeight,"F");}
    pdf.setDrawColor(218,225,220);pdf.line(12,y+rowHeight,285,y+rowHeight);
    let x=12;pdf.setTextColor(35,45,39);pdf.setFont("helvetica",columnFont(values));pdf.setFontSize(7.4);
    wrapped.forEach((parts,column)=>{pdf.setFont("helvetica",column===6?"bold":"normal");pdf.text(parts,x+2,y+4.5);x+=widths[column];});
    y+=rowHeight;index++;
  }
  return {index,y};
}

function columnFont(_values:string[]):"normal" { return "normal"; }

export async function downloadDailyProgressPdf(date:Date,floors:DailyFloorReport[]):Promise<void> {
  const {jsPDF}=await import("jspdf");
  const pdf=new jsPDF({orientation:"landscape",unit:"mm",format:"a4",compress:true});
  const dateLabel=new Intl.DateTimeFormat("fr-FR",{timeZone:"Africa/Casablanca",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(date);
  for(let floorIndex=0;floorIndex<floors.length;floorIndex++) {
    if(floorIndex)pdf.addPage();
    const floor=floors[floorIndex];drawHeader(pdf,dateLabel,floor.label);
    pdf.setDrawColor(207,218,210);pdf.setFillColor(255,255,255);pdf.roundedRect(12,32,273,102,2,2,"FD");
    const plan=await svgPng(floor.planSvg);
    const properties=pdf.getImageProperties(plan);
    const ratio=Math.min(267/properties.width,96/properties.height);
    const width=properties.width*ratio,height=properties.height*ratio;
    pdf.addImage(plan,"PNG",12+(273-width)/2,35+(96-height)/2,width,height,undefined,"FAST");
    pdf.setFont("helvetica","bold");pdf.setFontSize(10);pdf.setTextColor(31,57,39);
    pdf.text("Avancement réalisé aujourd’hui",12,142);
    if(!floor.lines.length) {
      pdf.setFont("helvetica","normal");pdf.setFontSize(9);pdf.setTextColor(91,105,97);
      pdf.text("Aucune progression positive enregistrée aujourd’hui sur les tâches visibles.",12,151);
    } else {
      const y=drawTableHeader(pdf,146);
      drawRows(pdf,floor.lines,0,y,dateLabel,floor.label);
    }
  }
  const pages=pdf.getNumberOfPages();
  for(let page=1;page<=pages;page++) {
    pdf.setPage(page);pdf.setFont("helvetica","normal");pdf.setFontSize(7);pdf.setTextColor(105,115,109);
    pdf.text(`Projet MUC - ${dateLabel}`,12,205);pdf.text(`Page ${page} / ${pages}`,285,205,{align:"right"});
  }
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Casablanca",year:"numeric",month:"2-digit",day:"2-digit"})
    .formatToParts(date).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  pdf.save(`Projet-MUC-avancement-journalier-${parts.year}-${parts.month}-${parts.day}.pdf`);
}
