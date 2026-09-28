import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { buildProgressWorkbook } from "../src/excel-export.js";

function numericCell(xml:string,reference:string):number {
  const escaped=reference.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const match=xml.match(new RegExp(`<c\\b[^>]*\\br="${escaped}"[^>]*>[\\s\\S]*?<v>([^<]+)<\\/v>[\\s\\S]*?<\\/c>`));
  if(!match)throw new Error(`Missing ${reference}`);
  return Number(match[1]);
}

test("Excel export preserves the template and writes current progress for every floor",async()=>{
  const template=new Uint8Array(await readFile(join(process.cwd(),"public","mixed-use-avancement-template.xlsx")));
  const input=unzipSync(template);
  const output=unzipSync(buildProgressWorkbook(template,[
    {key:"201:bathroom:plumbing-supply",active:true,record:{progress:54,blocked:false,note:"",startDate:"",endDate:""}},
    {key:"201:bedroom:partitions",active:true,record:{progress:25,blocked:false,note:"",startDate:"",endDate:""}},
    {key:"525:bedroom:joinery",active:true,record:{progress:80,blocked:false,note:"",startDate:"",endDate:""}},
  ]));
  const xml=strFromU8(output["xl/worksheets/sheet2.xml"]);
  assert.equal(numericCell(xml,"E5"),0.54);
  assert.equal(numericCell(xml,"AN5"),0.25);
  assert.equal(numericCell(xml,"D133"),525);
  assert.equal(numericCell(xml,"BT133"),0.8);
  assert.match(xml,/E\$5:E\$133/);
  for(const name of Object.keys(input))assert.ok(output[name],`preserved ${name}`);
  assert.equal(Object.keys(output).filter(name=>name.startsWith("xl/charts/")).length,
    Object.keys(input).filter(name=>name.startsWith("xl/charts/")).length);
});
