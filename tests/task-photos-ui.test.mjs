import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(await readFile(new URL("../src/task-photos.ts",import.meta.url),"utf8"), {
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const types = ts.transpileModule(await readFile(new URL("../src/cloud/types.ts",import.meta.url),"utf8"), {
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;

function harness({role="admin",assigned=false,insertError=false,uploadError=false}={}) {
 const elements=new Map(), events=[], rows=[];
 class Element {
  hidden=false; checked=false; disabled=false; value=""; files=[]; children=[]; handlers={};
  addEventListener(name,handler){this.handlers[name]=handler;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  reset(){get("taskPhotoFile").files=[];get("taskPhotoCaption").value="";get("taskPhotoReview").checked=false;}
  showModal(){this.open=true;} close(){this.open=false;this.handlers.close?.();}
  querySelectorAll(){return [get("taskPhotoFile"),get("taskPhotoCaption"),get("taskPhotoReview"),get("publishTaskPhoto"),get("closeTaskPhotos")];}
 }
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const document={getElementById:get,createElement(tag){
  const element=new Element();
  if(tag==="canvas"){element.getContext=()=>({fillRect(){},drawImage(){}});element.toBlob=callback=>callback(new Blob(["jpeg"],{type:"image/jpeg"}));}
  return element;
 }};
 const client={
  from(table){assert.equal(table,"task_photos");return {
   select(){return {eq(){return this;},order:async()=>({data:rows})};},
   async insert(row){events.push(["insert",row]);if(insertError)return {error:{message:"denied"}};rows.push({...row,created_at:"2026-09-28T10:00:00Z"});return {error:null};}
  };},
  storage:{from(bucket){assert.equal(bucket,"task-photos");return {
   async upload(path,blob){events.push(["upload",path,blob.type]);return {error:uploadError?{message:"offline"}:null};},
   async remove(paths){events.push(["cleanup",paths]);return {error:null};},
   async createSignedUrl(){return {data:{signedUrl:"https://example.invalid/photo.jpg"}};}
  };}}
 };
 const typeExports={};
 vm.runInNewContext(types,{exports:typeExports});
 const exports={};
 vm.runInNewContext(source,{exports,require:name=>name.includes("workspace")?{client}:typeExports,
 document,URL:{createObjectURL:()=>"blob:test",revokeObjectURL(){}},
 createImageBitmap:async()=>({width:2000,height:1000,close(){}}),Blob,crypto:{randomUUID:()=>"photo-id"},console});
 const context={snapshot:{projectId:"project",userId:"user",role,tasks:[{id:"task",key:"201:bedroom:partitions",active:true}],
 members:[{user_id:"user",name:"Intervenant"}],assignments:assigned?[{room_task_id:"task",assignee_id:"user",ended_at:null}]:[]},
 userId:"user",key:"201:bedroom:partitions",label:"R+2 · Chambre 201 · Cloisons chambre"};
 return {get,events,rows,context,open:exports.openTaskPhotos,submit:()=>get("taskPhotoForm").handlers.submit({preventDefault(){}})};
}

test("review photo publishes captured task, caption and review flag, then refreshes gallery",async()=>{
 const h=harness();await h.open(h.context,true);
 assert.equal(h.get("taskPhotoReview").checked,true);
 h.get("taskPhotoFile").files=[{type:"image/png"}];
 h.get("taskPhotoCaption").value="<script>test</script>";
 await h.submit();
 assert.deepEqual(h.events.map(e=>e[0]),["upload","insert"]);
 const row=h.rows[0];
 assert.equal(row.room_task_id,"task");assert.equal(row.needs_review,true);
 assert.equal(row.caption,"<script>test</script>");
 assert.equal("progress" in row,false);
 assert.equal(h.get("taskPhotoGallery").children.length,1);
 assert.equal(h.get("taskPhotoGallery").children[0].children[2].textContent,"<script>test</script>");
 assert.match(h.get("taskPhotoStatus").textContent,/Photo partagée/);
 assert.equal(h.get("taskPhotoFile").files.length,0);
});

test("ordinary photo and assigned worker are supported; viewers and unassigned workers cannot send",async()=>{
 for(const [role,assigned,allowed] of [["worker",true,true],["worker",false,false],["viewer",true,false]]) {
  const h=harness({role,assigned});await h.open(h.context);
  assert.equal(h.get("taskPhotoForm").hidden,!allowed);
  h.get("taskPhotoFile").files=[{type:"image/jpeg"}];await h.submit();
  assert.equal(h.rows.length,allowed?1:0);
  if(allowed)assert.equal(h.rows[0].needs_review,false);
 }
});

test("failed upload keeps the file for retry and never inserts metadata",async()=>{
 const h=harness({uploadError:true});await h.open(h.context,true);
 h.get("taskPhotoFile").files=[{type:"image/jpeg"}];await h.submit();
 assert.deepEqual(h.events.map(e=>e[0]),["upload"]);
 assert.equal(h.get("taskPhotoFile").files.length,1);
 assert.equal(h.get("publishTaskPhoto").disabled,false);
 assert.match(h.get("taskPhotoStatus").textContent,/Impossible/);
});

test("failed metadata insert cleans up the orphan upload and preserves the selected photo",async()=>{
 const h=harness({insertError:true});await h.open(h.context,true);
 h.get("taskPhotoFile").files=[{type:"image/jpeg"}];await h.submit();
 assert.deepEqual(h.events.map(e=>e[0]),["upload","insert","cleanup"]);
 assert.equal(h.get("taskPhotoFile").files.length,1);
});

test("unsupported files cannot be uploaded",async()=>{
 const h=harness();await h.open(h.context);
 h.get("taskPhotoFile").files=[{type:"application/pdf"}];await h.submit();
 assert.equal(h.events.length,0);
 assert.match(h.get("taskPhotoStatus").textContent,/JPEG, PNG ou WebP/);
});
