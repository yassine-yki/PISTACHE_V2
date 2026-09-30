export type DxfPoint={x:number;y:number};
export type LegendEntry={name:string;pattern:string;solid:boolean;colorIndex?:number;trueColor?:number;color:string;row:{top:number;bottom:number}};
export type LegendZone={id:string;level:string;layer:string;points:DxfPoint[];colorIndex?:number;trueColor?:number;color:string};
export type LegendDetection={entries:LegendEntry[];zones:LegendZone[]};

type Pair={code:string;value:string};
type RawEntity={type:string;pairs:Pair[]};
type Hatch={handle:string;layer:string;pattern:string;solid:boolean;colorIndex?:number;trueColor?:number;polygons:DxfPoint[][]};
type Box={minX:number;maxX:number;minY:number;maxY:number};

const first=(entity:RawEntity,code:string)=>entity.pairs.find(pair=>pair.code===code)?.value;
const numeric=(entity:RawEntity,code:string)=>{const value=Number(first(entity,code));return Number.isFinite(value)?value:undefined;};
const rgb=(trueColor?:number,colorIndex?:number)=>{
  if(Number.isFinite(trueColor)&&trueColor!==undefined)return `#${Math.max(0,trueColor).toString(16).padStart(6,"0").slice(-6)}`;
  const colors:Record<number,string>={1:"#d93636",2:"#e6bd24",3:"#2e9b50",4:"#32a6a6",5:"#3f65d4",6:"#a948b0",7:"#606763",8:"#888f8b",9:"#b9bfbc",10:"#ef5a5a",11:"#ff6464",18:"#7b402f",52:"#c8c3ad"};
  return colors[colorIndex||0]||"#397244";
};

function rawEntities(source:string){
  const lines=source.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").split("\n"),entities:RawEntity[]=[];
  let inEntities=false,current:RawEntity|null=null;
  for(let index=0;index<lines.length-1;index+=2){
    const code=lines[index].trim(),value=lines[index+1].trim();
    if(!inEntities&&code==="0"&&value.toUpperCase()==="SECTION"&&lines[index+2]?.trim()==="2"&&lines[index+3]?.trim().toUpperCase()==="ENTITIES"){inEntities=true;index+=2;continue;}
    if(!inEntities)continue;
    if(code==="0"&&value.toUpperCase()==="ENDSEC"){if(current)entities.push(current);break;}
    if(code==="0"){if(current)entities.push(current);current={type:value.toUpperCase(),pairs:[]};}else current?.pairs.push({code,value});
  }
  return entities;
}

function pairNumber(pairs:Pair[],code:string){const value=Number(pairs.find(pair=>pair.code===code)?.value);return Number.isFinite(value)?value:undefined;}
function arcPoints(center:DxfPoint,radius:number,startDegrees:number,endDegrees:number,counterClockwise:boolean){
  let start=startDegrees*Math.PI/180,end=endDegrees*Math.PI/180;if(counterClockwise&&end<start)end+=Math.PI*2;if(!counterClockwise&&end>start)end-=Math.PI*2;
  const length=end-start,steps=Math.max(6,Math.ceil(Math.abs(length)/(Math.PI/18)));return Array.from({length:steps+1},(_,index)=>({x:center.x+Math.cos(start+length*index/steps)*radius,y:center.y+Math.sin(start+length*index/steps)*radius}));
}
function boundaryPolygons(entity:RawEntity){
  const start=entity.pairs.findIndex(pair=>pair.code==="91");if(start<0)return [];
  const polygons:DxfPoint[][]=[];let index=start+1;
  while(index<entity.pairs.length){
    while(index<entity.pairs.length&&entity.pairs[index].code!=="92"&&entity.pairs[index].code!=="75")index++;
    if(index>=entity.pairs.length||entity.pairs[index].code==="75")break;
    const flags=Number(entity.pairs[index].value)||0,begin=++index;while(index<entity.pairs.length&&!['92','75'].includes(entity.pairs[index].code))index++;const pairs=entity.pairs.slice(begin,index),points:DxfPoint[]=[];
    if(flags&2){
      for(let cursor=0;cursor<pairs.length;cursor++)if(pairs[cursor].code==="10"&&pairs[cursor+1]?.code==="20")points.push({x:Number(pairs[cursor].value),y:Number(pairs[cursor+1].value)});
    }else{
      for(let cursor=0;cursor<pairs.length;cursor++)if(pairs[cursor].code==="72"){
        const type=Number(pairs[cursor].value),edge:Pair[]=[];cursor++;while(cursor<pairs.length&&pairs[cursor].code!=="72"){edge.push(pairs[cursor]);cursor++;}cursor--;
        if(type===1){const x=pairNumber(edge,"10"),y=pairNumber(edge,"20"),x2=pairNumber(edge,"11"),y2=pairNumber(edge,"21");if([x,y,x2,y2].every(Number.isFinite)){points.push({x:x!,y:y!});if(cursor>=pairs.length-1||pairs[cursor+1]?.code!=="72")points.push({x:x2!,y:y2!});}}
        if(type===2){const x=pairNumber(edge,"10"),y=pairNumber(edge,"20"),radius=pairNumber(edge,"40"),startAngle=pairNumber(edge,"50"),endAngle=pairNumber(edge,"51");if([x,y,radius,startAngle,endAngle].every(Number.isFinite))points.push(...arcPoints({x:x!,y:y!},radius!,startAngle!,endAngle!,pairNumber(edge,"73")!==0));}
      }
    }
    const cleaned=points.filter((point,position)=>position===0||Math.hypot(point.x-points[position-1].x,point.y-points[position-1].y)>1e-8);if(cleaned.length>3&&Math.hypot(cleaned[0].x-cleaned[cleaned.length-1].x,cleaned[0].y-cleaned[cleaned.length-1].y)<=1e-8)cleaned.pop();if(cleaned.length>=3)polygons.push(cleaned);
  }
  return polygons;
}
function area(points:DxfPoint[]){let sum=0;for(let index=0;index<points.length;index++){const next=points[(index+1)%points.length];sum+=points[index].x*next.y-next.x*points[index].y;}return Math.abs(sum/2);}
function center(points:DxfPoint[]){return {x:points.reduce((sum,point)=>sum+point.x,0)/points.length,y:points.reduce((sum,point)=>sum+point.y,0)/points.length};}
function parseHatches(source:string):Hatch[]{return rawEntities(source).filter(entity=>entity.type==="HATCH").map(entity=>({handle:first(entity,"5")||crypto.randomUUID(),layer:first(entity,"8")||"0",pattern:first(entity,"2")||"SOLID",solid:numeric(entity,"70")===1,colorIndex:numeric(entity,"62"),trueColor:numeric(entity,"420"),polygons:boundaryPolygons(entity)})).filter(hatch=>hatch.polygons.length);}

function entityPoints(entity:any):DxfPoint[]{return [...(entity.vertices||[]),...(entity.controlPoints||[]),...(entity.position?[entity.position]:[]),...(entity.startPoint?[entity.startPoint]:[]),...(entity.endPoint?[entity.endPoint]:[])].filter((point:any)=>Number.isFinite(point?.x)&&Number.isFinite(point?.y));}
function clean(value:string){return String(value||"").replace(/\\P/g," ").replace(/\\[A-Za-z][^;]*;/g,"").replace(/[{}]/g,"").replace(/\s+/g," ").trim();}
function bounds(points:DxfPoint[]):Box{return {minX:Math.min(...points.map(point=>point.x)),maxX:Math.max(...points.map(point=>point.x)),minY:Math.min(...points.map(point=>point.y)),maxY:Math.max(...points.map(point=>point.y))};}
function legendTable(model:any){
  const texts=(model?.entities||[]).filter((entity:any)=>["TEXT","MTEXT"].includes(entity.type)&&entityPoints(entity).length).map((entity:any)=>({text:clean(entity.text||entity.string),point:entityPoints(entity)[0]}));
  const title=texts.find((item:any)=>/L[ÉE]GENDE/i.test(item.text));if(!title)return null;
  const geometry=(model?.entities||[]).filter((entity:any)=>/LEGEND/i.test(String(entity.layer||""))).map((entity:any)=>entityPoints(entity)).filter((points:DxfPoint[])=>points.length>=2);
  if(!geometry.length)return null;const all=geometry.flat(),table=bounds(all),width=table.maxX-table.minX,height=table.maxY-table.minY;
  const horizontal=geometry.map((points:DxfPoint[])=>bounds(points)).filter((box:Box)=>box.maxX-box.minX>width*.65&&box.maxY-box.minY<height*.02).map((box:Box)=>(box.minY+box.maxY)/2);
  const rows=[...new Set(horizontal.map((value:number)=>value.toFixed(4)))].map(Number).sort((a:number,b:number)=>b-a);if(rows.length<3)return null;
  const vertical=geometry.map((points:DxfPoint[])=>bounds(points)).filter((box:Box)=>box.maxY-box.minY>height*.65&&box.maxX-box.minX<width*.02&&box.minX>table.minX+width*.08&&box.minX<table.maxX-width*.08).sort((a:Box,b:Box)=>a.minX-b.minX);
  const divider=vertical[0]?.minX??table.minX+width*.28;return {texts,table,divider,rows};
}
function floorHatch(hatch:Hatch){
  const layer=hatch.layer.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  if(/WALL|MUR|STRS|STRUCT|COLS|CEIL|PLAF/.test(layer))return false;
  return /FLOR|FLOOR|REVET|(^|[-_ ])SOL($|[-_ ])/.test(layer);
}
function matchScore(hatch:Hatch,entry:LegendEntry){
  if(hatch.solid!==entry.solid)return -1;let score=0;
  if(hatch.pattern.toUpperCase()===entry.pattern.toUpperCase())score+=5;
  if(Number.isFinite(entry.trueColor)&&hatch.trueColor===entry.trueColor)score+=5;
  if(Number.isFinite(entry.colorIndex)&&hatch.colorIndex===entry.colorIndex)score+=2;
  return score;
}

export function detectLegendHatchZones(source:string,model:any,level="NIVEAU"):LegendDetection{
  const hatches=parseHatches(source),table=legendTable(model);if(!table)return {entries:[],zones:[]};const entries:LegendEntry[]=[];
  for(let index=0;index<table.rows.length-1;index++){
    const top=table.rows[index],bottom=table.rows[index+1],description=table.texts.filter((item:any)=>item.point.x>=table.divider&&item.point.x<=table.table.maxX&&item.point.y<top&&item.point.y>bottom).sort((a:any,b:any)=>b.point.y-a.point.y).map((item:any)=>item.text).filter((text:string)=>text&&!/^(?:SYMBOLES|DESCRIPTIONS|L[ÉE]GENDE)/i.test(text)).join(" ");
    if(!description)continue;const symbol=hatches.filter(hatch=>hatch.polygons.some(polygon=>{const point=center(polygon);return point.x>=table.table.minX&&point.x<=table.divider&&point.y<top&&point.y>bottom;})).sort((a,b)=>Math.max(...b.polygons.map(area))-Math.max(...a.polygons.map(area)))[0];if(!symbol)continue;
    entries.push({name:description,pattern:symbol.pattern,solid:symbol.solid,colorIndex:symbol.colorIndex,trueColor:symbol.trueColor,color:rgb(symbol.trueColor,symbol.colorIndex),row:{top,bottom}});
  }
  const legendHandles=new Set(hatches.filter(hatch=>hatch.polygons.some(polygon=>{const point=center(polygon);return point.x>=table.table.minX&&point.x<=table.table.maxX&&point.y>=table.table.minY&&point.y<=table.table.maxY;})).map(hatch=>hatch.handle));
  const zones:LegendZone[]=[];for(const hatch of hatches){
    if(legendHandles.has(hatch.handle)||(hatch.solid&&!floorHatch(hatch))||(!hatch.solid&&hatch.layer!=="0"&&!floorHatch(hatch)))continue;
    const ranked=entries.map(entry=>({entry,score:matchScore(hatch,entry)})).sort((a,b)=>b.score-a.score),best=ranked[0];if(!best||best.score<2)continue;
    const polygon=[...hatch.polygons].sort((a,b)=>area(b)-area(a))[0];if(area(polygon)<=1e-8)continue;zones.push({id:`hatch-${hatch.handle}`,level,layer:best.entry.name,points:polygon,colorIndex:best.entry.colorIndex,trueColor:best.entry.trueColor,color:best.entry.color});
  }
  return {entries,zones};
}
