import test from "node:test";
import assert from "node:assert/strict";
import { dailyProgressLines } from "../src/pdf-export.js";

test("daily PDF keeps only positive progress on visible active tasks",()=>{
  const tasks=[
    {id:"visible",key:"201:bedroom:paint",floorCode:"r2",active:true},
    {id:"hidden",key:"202:bedroom:paint",floorCode:"r2",active:false},
    {id:"decrease",key:"203:bathroom:tiling",floorCode:"r2",active:true},
  ];
  const history=[
    {room_task_id:"visible",before_state:{progress:20},after_state:{progress:40},created_at:"2026-09-28T08:00:00Z"},
    {room_task_id:"visible",before_state:{progress:40},after_state:{progress:55},created_at:"2026-09-28T12:00:00Z"},
    {room_task_id:"hidden",before_state:{progress:0},after_state:{progress:80},created_at:"2026-09-28T09:00:00Z"},
    {room_task_id:"decrease",before_state:{progress:60},after_state:{progress:50},created_at:"2026-09-28T10:00:00Z"},
  ];
  const lines=dailyProgressLines(history,tasks,(_zone,code)=>({group:"Finition",label:code}));
  assert.deepEqual(lines,[{
    taskId:"visible",room:201,floorCode:"r2",zone:"bedroom",group:"Finition",label:"paint",before:20,after:55,gain:35,
  }]);
});
