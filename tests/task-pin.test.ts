import test from "node:test";
import assert from "node:assert/strict";
import {findPinnedTask} from "../src/task-pin.js";

test("keeps a shared task selected when switching zones",()=>{
  const result=findPinnedTask({id:"false-ceiling",label:"Structure faux plafond",group:"Faux plafond chambre"},[
    {id:"floor-screed",label:"Chape / forme de pente",group:"Chape"},
    {id:"false-ceiling",label:"Structure faux plafond",group:"Faux plafond SDB"},
  ]);
  assert.equal(result?.id,"false-ceiling");
});

test("maps bedroom screed to the single bathroom task in the same group",()=>{
  const result=findPinnedTask({id:"screed",label:"Chape chambre",group:"Chape"},[
    {id:"plumbing-supply",label:"Passage EF/EC",group:"Plomberie sol"},
    {id:"floor-screed",label:"Chape / forme de pente",group:"Chape"},
  ]);
  assert.equal(result?.id,"floor-screed");
});

test("does not select the first unrelated task",()=>{
  const result=findPinnedTask({id:"paint",label:"Peinture chambre",group:"Peinture"},[
    {id:"plumbing-supply",label:"Passage EF/EC",group:"Plomberie sol"},
  ]);
  assert.equal(result,null);
});
