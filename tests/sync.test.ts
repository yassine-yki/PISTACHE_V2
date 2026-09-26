import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { OfflineStore } from "../src/cloud/offline-store.js";
import { SyncEngine } from "../src/cloud/sync.js";
import { editable, type Snapshot, type Receipt } from "../src/cloud/types.js";
const record=(progress=0)=>({progress,blocked:false,note:"",startDate:"",endDate:""});
const snapshot=():Snapshot=>({projectId:"p",name:"Projet",userId:"alice",role:"worker",cachedAt:new Date().toISOString(),
  tasks:[{id:"t1",key:"201:bedroom:paint",version:2,record:record(),active:true},
    {id:"t2",key:"201:bathroom:paint",version:2,record:record(),active:true}],
  assignments:[{id:"a1",room_task_id:"t1",assignee_id:"alice",ended_at:null},
    {id:"a2",room_task_id:"t2",assignee_id:"bob",ended_at:null}],members:[]});
test("only the assigned room task can be edited, even within the same chamber",()=>{
  const s=snapshot();
  assert.equal(editable(s,"alice","201:bedroom:paint"),true);
  assert.equal(editable(s,"alice","201:bathroom:paint"),false);
  assert.equal(editable(s,"bob","201:bathroom:paint"),false);
  s.role="viewer";assert.equal(editable(s,"alice","201:bedroom:paint"),false);
  s.role="admin";assert.equal(editable(s,"alice","201:bathroom:paint"),false);
  assert.equal(editable(s,"alice","201:bathroom:paint",true),true);
});
test("offline edits survive reopening and send a versioned dependency chain",async()=>{
  const namespace=crypto.randomUUID();let store=new OfflineStore(namespace);await store.saveSnapshot(snapshot());
  let calls=0;
  let engine=new SyncEngine(store,"alice","device",async o=>{calls++;return {status:"accepted",result_version:o.baseVersion+1,error_code:null};});
  const first=await engine.enqueue("p","201:bedroom:paint",record(20));
  const second=await engine.enqueue("p","201:bedroom:paint",record(40));
  assert.equal(calls,0);assert.equal(second.dependsOn,first.id);assert.equal(second.baseVersion,3);
  await store.close();store=new OfflineStore(namespace);
  engine=new SyncEngine(store,"alice","device",async o=>{calls++;return {status:"accepted",result_version:o.baseVersion+1,error_code:null};});
  assert.equal((await engine.records("p"))["201:bedroom:paint"].progress,40);
  await engine.flush("p");
  assert.equal(calls,2);assert.equal((await engine.operations("p")).length,0);
  assert.equal((await store.snapshot("p"))!.tasks[0].version,4);
  assert.equal((await engine.records("p"))["201:bedroom:paint"].progress,40);
  await store.close();
});
test("a lost confirmation retries the exact same operation without duplicate effects",async()=>{
  const store=new OfflineStore(crypto.randomUUID());await store.saveSnapshot(snapshot());
  const receipts=new Map<string,Receipt>();let effects=0;let lost=true;
  const engine=new SyncEngine(store,"alice","device",async o=>{
    if(!receipts.has(o.id)){effects++;receipts.set(o.id,{status:"accepted",result_version:o.baseVersion+1,error_code:null});}
    if(lost){lost=false;throw new Error("connection lost");}return receipts.get(o.id)!;
  });
  const queued=await engine.enqueue("p","201:bedroom:paint",record(60));
  await assert.rejects(engine.flush("p"),/connection lost/);
  assert.equal((await engine.operations("p"))[0].id,queued.id);
  await engine.flush("p");assert.equal(effects,1);assert.equal((await engine.operations("p")).length,0);
  await store.close();
});
test("reassignment keeps rejected work visible and blocks its dependent edits",async()=>{
  const store=new OfflineStore(crypto.randomUUID());await store.saveSnapshot(snapshot());let calls=0;
  const engine=new SyncEngine(store,"alice","device",async()=>{calls++;return {status:"rejected",result_version:null,error_code:"assignment_changed"};});
  await engine.enqueue("p","201:bedroom:paint",record(30));
  await engine.enqueue("p","201:bedroom:paint",record(50));
  await engine.flush("p");const operations=await engine.operations("p");
  assert.equal(calls,1);assert.ok(operations.every(o=>o.state==="rejected"));
  assert.equal((await engine.records("p"))["201:bedroom:paint"].progress,0);
  await assert.rejects(engine.enqueue("p","201:bedroom:paint",record(70)),/conflit/);
  await engine.discard("p","t1");
  assert.equal((await engine.operations("p")).length,0);
  assert.equal((await store.all("operations")).length,2);
  await store.close();
});
test("separate accounts have separate caches and outboxes",async()=>{
  const root=crypto.randomUUID(),alice=new OfflineStore(root+":alice"),bob=new OfflineStore(root+":bob");
  await alice.saveSnapshot(snapshot());const engine=new SyncEngine(alice,"alice","device",async()=>{throw Error("offline");});
  await engine.enqueue("p","201:bedroom:paint",record(25));
  assert.equal(await bob.snapshot("p"),undefined);assert.equal((await bob.all("operations")).length,0);
  await assert.rejects(new SyncEngine(alice,"bob","device",async()=>{throw Error("unused");}).enqueue("p","201:bedroom:paint",record(10)),/affectée/);
  await alice.close();await bob.close();
});

test("an edit from a stale tab cannot silently use the newer cached version",async()=>{
  const store=new OfflineStore(crypto.randomUUID());const s=snapshot();await store.saveSnapshot(s);
  const engine=new SyncEngine(store,"alice","device",async()=>{throw Error("unused");});
  s.tasks[0].version=3;s.tasks[0].record=record(20);await store.saveSnapshot(s);
  await assert.rejects(engine.enqueue("p","201:bedroom:paint",record(30),null,record(0),2),/autre onglet/);
  assert.equal((await engine.operations("p")).length,0);await store.close();
});

test("private drafts survive reload, collapse edits and cannot flush before global confirmation",async()=>{
  const namespace=crypto.randomUUID();let store=new OfflineStore(namespace);await store.saveSnapshot(snapshot());
  let calls=0;
  const submit=async(o:any)=>{calls++;return {status:"accepted" as const,result_version:o.baseVersion+1,error_code:null};};
  let engine=new SyncEngine(store,"alice","device",submit);
  const first=await engine.enqueue("p","201:bedroom:paint",record(80),null,undefined,undefined,true);
  await engine.enqueue("p","201:bedroom:paint",record(20),null,undefined,undefined,true);
  assert.equal((await engine.operations("p")).length,1);
  assert.equal((await engine.operations("p"))[0].id,first.id);
  await engine.flush("p");assert.equal(calls,0);
  await store.close();store=new OfflineStore(namespace);engine=new SyncEngine(store,"alice","device",submit);
  assert.equal((await engine.records("p"))["201:bedroom:paint"].progress,20);
  await engine.flush("p");assert.equal(calls,0);
  assert.equal(await engine.confirmDrafts("p"),1);
  await engine.enqueue("p","201:bedroom:paint",record(50),null,undefined,undefined,true);
  await engine.flush("p");assert.equal(calls,1);
  assert.equal((await engine.operations("p"))[0].state,"draft");
  assert.equal((await engine.records("p"))["201:bedroom:paint"].progress,50);
  await store.close();
});

test("cancel removes only private drafts and preserves confirmed pending submissions",async()=>{
  const store=new OfflineStore(crypto.randomUUID());await store.saveSnapshot(snapshot());
  const engine=new SyncEngine(store,"alice","device",async o=>({status:"accepted",result_version:o.baseVersion+1,error_code:null}));
  await engine.enqueue("p","201:bedroom:paint",record(20),null,undefined,undefined,true);
  await engine.confirmDrafts("p");
  await engine.enqueue("p","201:bedroom:paint",record(70),null,undefined,undefined,true);
  await engine.cancelDrafts("p");
  assert.equal((await engine.operations("p")).length,1);
  assert.equal((await engine.operations("p"))[0].state,"pending");
  assert.equal((await engine.records("p"))["201:bedroom:paint"].progress,20);
  await store.close();
});
