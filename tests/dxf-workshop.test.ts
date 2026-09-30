import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { appendWorkshopLayers, detectClosedSpaces, sanitizeLayerName } from "../src/dxf-workshop.js";

type ParserConstructor = new () => { parseSync(source: string): { entities: Array<{ type: string; layer?: string; shape?: boolean; vertices?: unknown[] }> } | null };
const DxfParser = createRequire(import.meta.url)("dxf-parser") as ParserConstructor;

const emptyDxf = [
  "0", "SECTION", "2", "HEADER", "0", "ENDSEC",
  "0", "SECTION", "2", "TABLES",
  "0", "TABLE", "2", "LAYER", "70", "1",
  "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
  "0", "ENDTAB", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF", "",
].join("\n");

test("creates an AutoCAD layer and a closed polyline for a delimited space", () => {
  const exported = appendWorkshopLayers(emptyDxf, [{
    id: "zone-1", level: "R+2", layer: "Carrelage 60/60",
    points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }],
  }]);

  const parsed = new DxfParser().parseSync(exported);
  assert.ok(parsed);
  const contour = parsed.entities.find(entity => entity.type === "LWPOLYLINE");
  assert.equal(contour?.layer, "Carrelage 60-60");
  assert.equal(contour?.shape, true);
  assert.equal(contour?.vertices?.length, 4);
  assert.match(exported, /0\r\nLAYER\r\n2\r\nCarrelage 60-60/);
});

test("sanitizes characters forbidden in AutoCAD layer names", () => {
  assert.equal(sanitizeLayerName("  Couloir / BOH:*  "), "Couloir - BOH--");
  assert.equal(sanitizeLayerName(""), "ZONE");
});

test("automatically detects named closed spaces and their nearest levels", () => {
  const rectangle=(x:number,y:number,layer:string)=>({type:"LWPOLYLINE",layer,shape:true,vertices:[{x,y},{x:x+8,y},{x:x+8,y:y+5},{x,y:y+5}]});
  const model={entities:[
    rectangle(0,0,"ZONE"),rectangle(100,0,"SDB"),
    {type:"MTEXT",text:"R+2",position:{x:-2,y:7}},
    {type:"MTEXT",text:"CHAMBRE 201",position:{x:4,y:2}},
    {type:"MTEXT",text:"R+3",position:{x:98,y:7}},
    {type:"MTEXT",text:"Salle de bain",position:{x:104,y:2}},
  ]};

  const result=detectClosedSpaces(model);
  assert.equal(result.zones.length,2);
  assert.deepEqual(result.levels,["R+2","R+3"]);
  assert.deepEqual(result.zones.map(zone=>[zone.level,zone.layer]),[["R+2","Chambre"],["R+3","Salle de bain"]]);
});

test("ignores open geometry and unnamed technical contours", () => {
  const result=detectClosedSpaces({entities:[
    {type:"LWPOLYLINE",layer:"MURS",vertices:[{x:0,y:0},{x:5,y:0},{x:5,y:5}]},
    {type:"LWPOLYLINE",layer:"0",shape:true,vertices:[{x:10,y:0},{x:15,y:0},{x:15,y:5},{x:10,y:5}]},
  ]});
  assert.equal(result.zones.length,0);
});
