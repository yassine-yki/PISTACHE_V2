import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { cleanDxfText, findRoomNumbers, roomNumberFromText, type DxfRoomText } from "../src/dxf-identification.js";

type ParserConstructor = new () => { parseSync(source: string): { entities: unknown[] } | null };
const DxfParser = createRequire(import.meta.url)("dxf-parser") as ParserConstructor;

test("reads chamber labels on the required DXF layer", () => {
  assert.equal(roomNumberFromText("CHAMBRE 214"), 214);
  assert.equal(roomNumberFromText("CHAMBRE 240\\PSTANDARD"), 240);
  assert.equal(roomNumberFromText("LOGGIA 214"), null);
  assert.equal(cleanDxfText("CHAMBRE 214\\P SUITE EXECUTIVE"), "CHAMBRE 214 SUITE EXECUTIVE");
  assert.deepEqual(findRoomNumbers([
    { layer: "A-AREA-IDEN", type: "MTEXT", text: "CHAMBRE 214" },
    { layer: "LOGGIA", type: "TEXT", text: "CHAMBRE 215" },
  ]), [214]);
});

const dxfPath = process.env.R2_DXF || join(process.cwd(), "public/projects/mixed-use/r2/suivi.dxf");
test("finds all 40 R+2 rooms in the real DXF", { skip: !existsSync(dxfPath) }, () => {
  const dxf = new DxfParser().parseSync(readFileSync(dxfPath, "utf8"));
  assert.ok(dxf);
  const numbers = findRoomNumbers(dxf.entities as unknown as DxfRoomText[]);
  assert.deepEqual(numbers, Array.from({ length: 40 }, (_, index) => 201 + index));
});
for (const [floor,number] of [["r4",417],["r5",517]] as const) {
  test(`room ${number} has a recognized tracking contour in the real DXF`,()=>{
    const source=readFileSync(join(process.cwd(),"src/app.js"),"utf8");
    const body=source.slice(source.indexOf("function isPolygon("),source.indexOf("function pointInPolygon("));
    const isPolygon=new Function("normalizedLayer",body+";return isPolygon;")((layer:string)=>layer.trim().toUpperCase());
    const entities=new DxfParser().parseSync(readFileSync(join(process.cwd(),`public/projects/mixed-use/${floor}/suivi.dxf`),"utf8"))!.entities as any[];
    const label=entities.find(e=>roomNumberFromText(e.text||"")===number);
    const point=label.position||label.startPoint;
    const contains=(vertices:any[])=>{let inside=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++) {const a=vertices[i],b=vertices[j];if(((a.y>point.y)!==(b.y>point.y))&&(point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x))inside=!inside;}return inside;};
    assert.ok(entities.some(e=>e.layer?.toUpperCase()==="CHAMBRE"&&isPolygon(e)&&contains(e.vertices)));
  });
}
