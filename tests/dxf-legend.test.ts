import test from "node:test";
import assert from "node:assert/strict";
import { detectLegendHatchZones } from "../src/dxf-legend.js";

const line=(x1:number,y1:number,x2:number,y2:number)=>({type:"LINE",layer:"SHT-LEGEND",vertices:[{x:x1,y:y1},{x:x2,y:y2}]});
function hatch(handle:string,x:number,y:number){return [
  "0","HATCH","5",handle,"8","A-FLOR-PATT","62","11","420","16737380","100","AcDbHatch","10","0","20","0","30","0","2","NET","70","0","71","0","91","1","92","1","93","4",
  "72","1","10",String(x),"20",String(y),"11",String(x+1),"21",String(y),
  "72","1","10",String(x+1),"20",String(y),"11",String(x+1),"21",String(y+1),
  "72","1","10",String(x+1),"20",String(y+1),"11",String(x),"21",String(y+1),
  "72","1","10",String(x),"20",String(y+1),"11",String(x),"21",String(y),
  "97","0","75","1","76","1","52","0","41","1","77","0","78","0","98","1","10",String(x+.5),"20",String(y+.5),
];}

test("reads the legend hatch design and finds matching plan areas",()=>{
  const source=["0","SECTION","2","ENTITIES",...hatch("LEGEND",.5,8.2),...hatch("PLAN",20,2),"0","ENDSEC","0","EOF",""] .join("\n");
  const model={entities:[
    line(0,10,10,10),line(0,9,10,9),line(0,8,10,8),line(0,7,10,7),line(0,7,0,10),line(2,7,2,10),line(10,7,10,10),
    {type:"MTEXT",layer:"TEXT",text:"LÉGENDE DES REVÊTEMENTS",position:{x:3,y:9.5}},
    {type:"MTEXT",layer:"TEXT",text:"Carreaux rouges",position:{x:3,y:8.5}},
  ]};
  const result=detectLegendHatchZones(source,model,"RDC");
  assert.equal(result.entries.length,1);
  assert.equal(result.entries[0].name,"Carreaux rouges");
  assert.equal(result.entries[0].pattern,"NET");
  assert.equal(result.zones.length,1);
  assert.equal(result.zones[0].layer,"Carreaux rouges");
  assert.equal(result.zones[0].level,"RDC");
  assert.equal(result.zones[0].points.length,4);
});
