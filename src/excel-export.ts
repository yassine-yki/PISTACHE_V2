import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { tasksByZone, type ProgressRecord } from "./model.js";

const TEMPLATE_PATH = "/mixed-use-avancement-template.xlsx";
const TRACKING_SHEET = "xl/worksheets/sheet2.xml";
const allTaskColumns = Object.values(tasksByZone).flatMap(tasks => tasks.map(task => task.sourceColumn));

export type ExcelProgressTask = { key: string; active: boolean; record: ProgressRecord };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cellPattern(reference: string): RegExp {
  return new RegExp(`<c\\b(?![^>]*\\/>)([^>]*\\br="${escapeRegex(reference)}"[^>]*)>[\\s\\S]*?<\\/c>`);
}

function setNumericCell(xml: string, reference: string, value: number): string {
  const pattern=cellPattern(reference);
  const emptyPattern=new RegExp(`<c\\b([^>]*\\br="${escapeRegex(reference)}"[^>]*)\\/>`);
  const target=pattern.test(xml) ? pattern : emptyPattern.test(xml) ? emptyPattern : null;
  if(!target) throw new Error(`Cellule Excel introuvable : ${reference}`);
  return xml.replace(target,(_match,attributes:string)=>{
    const numericAttributes=attributes.replace(/\s+t="[^"]*"/g,"");
    return `<c${numericAttributes}><v>${Number.isInteger(value) ? value : value.toFixed(4).replace(/0+$/,"")}</v></c>`;
  });
}

function numberText(value:number):string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/,"");
}

function setNumericCells(xml:string,values:Map<string,number>):string {
  const missing=new Set(values.keys());
  const result=xml.replace(/<c\b([^>]*?\br="([A-Z]+\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(match,attributes:string,reference:string)=>{
    const value=values.get(reference);
    if(value===undefined)return match;
    missing.delete(reference);
    return `<c${attributes.replace(/\s+t="[^"]*"/g,"")}><v>${numberText(value)}</v></c>`;
  });
  if(missing.size)throw new Error(`Cellules Excel introuvables : ${[...missing].slice(0,5).join(", ")}`);
  return result;
}

function appendRoom525(xml: string): string {
  if(/<c\b[^>]*\br="D\d+"[^>]*>\s*<v>525<\/v>/.test(xml)) return xml;
  const juniorSource=xml.match(/<row\b([^>]*\br="130"[^>]*)>([\s\S]*?)<\/row>/);
  const lastRow=xml.match(/<row\b[^>]*\br="132"[^>]*>[\s\S]*?<\/row>/);
  if(!juniorSource || !lastRow) throw new Error("Les lignes R+5 du modèle Excel sont introuvables.");
  const cloned=`<row${juniorSource[1].replace(/\br="130"/, 'r="133"')}>${juniorSource[2].replace(/([A-Z]+)130/g,"$1"+"133")}</row>`;
  const extended=xml.replace(lastRow[0],lastRow[0]+cloned).replace(/<dimension ref="A1:BT132"\/>/,'<dimension ref="A1:BT133"/>');
  return setNumericCell(extended,"D133",525);
}

function roomRows(xml: string): Map<number,number> {
  const result=new Map<number,number>();
  for(const match of xml.matchAll(/<c\b(?![^>]*\/>)([^>]*)>([\s\S]*?)<\/c>/g)) {
    const reference=match[1].match(/\br="D(\d+)"/);
    const value=match[2].match(/<v>(\d+)<\/v>/);
    if(reference&&value)result.set(Number(value[1]),Number(reference[1]));
  }
  return result;
}

function requestFullCalculation(xml: string): string {
  return xml.replace(/<calcPr\b([^>]*)\/>/,(_match,attributes:string)=>{
    const cleaned=attributes.replace(/\s+(calcMode|fullCalcOnLoad|forceFullCalc)="[^"]*"/g,"");
    return `<calcPr${cleaned} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`;
  });
}

export function buildProgressWorkbook(template: Uint8Array, tasks: ExcelProgressTask[]): Uint8Array {
  const files=unzipSync(template);
  if(!files[TRACKING_SHEET]) throw new Error("La feuille Suivi des Chambres est absente du modèle.");
  let sheet=appendRoom525(strFromU8(files[TRACKING_SHEET]));
  const rows=roomRows(sheet);
  if(!rows.has(525)) throw new Error("La chambre 525 n’a pas pu être ajoutée à l’export.");

  // Start with a clean export so stale values from the template can never be
  // mistaken for current application progress.
  const values=new Map<string,number>();
  for(const row of rows.values()) {
    for(const column of allTaskColumns) values.set(`${column}${row}`,0);
  }

  for(const task of tasks) {
    if(!task.active) continue;
    const [roomText,zone,code]=task.key.split(":");
    const row=rows.get(Number(roomText));
    const definition=tasksByZone[zone as keyof typeof tasksByZone]?.find(item=>item.id===code);
    if(!row || !definition) continue;
    values.set(`${definition.sourceColumn}${row}`,Math.max(0,Math.min(100,task.record.progress))/100);
  }
  sheet=setNumericCells(sheet,values);
  files[TRACKING_SHEET]=strToU8(sheet);

  // Extend formulas and chart sources to include the added R+5 room.
  for(const [name,content] of Object.entries(files)) {
    if(!name.endsWith(".xml") || name===TRACKING_SHEET) continue;
    let xml=strFromU8(content);
    if(xml.includes("$132")) xml=xml.replace(/\$132/g,"$133");
    if(name==="xl/workbook.xml") xml=requestFullCalculation(xml);
    files[name]=strToU8(xml);
  }
  files[TRACKING_SHEET]=strToU8(sheet.replace(/\$132/g,"$133"));
  return zipSync(files,{level:6});
}

export async function downloadProgressWorkbook(tasks: ExcelProgressTask[], date=new Date()): Promise<void> {
  const response=await fetch(TEMPLATE_PATH,{cache:"no-cache"});
  if(!response.ok) throw new Error(`Modèle Excel indisponible (${response.status}).`);
  const output=buildProgressWorkbook(new Uint8Array(await response.arrayBuffer()),tasks);
  const bytes=new Uint8Array(output.byteLength);bytes.set(output);
  const blob=new Blob([bytes.buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=`Projet-MUC-avancement-${new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Casablanca"}).format(date)}.xlsx`;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
