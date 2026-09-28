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

function harness({role="admin",assigned=false,insertError=false,uploadError=false,seed=[]}={}) {
 const elements=new Map(), events=[], rows=[...seed];
 class Element {
  hidden=false; checked=false; disabled=false; value=""; files=[]; children=[]; handlers={};
  addEventListener(name,handler){this.handlers[name]=handler;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  reset(){get("taskPhotoFile").files=[];get("taskPhotoCaption").value="";}
  showModal(){this.open=true;} close(){this.open=false;this.handlers.close?.();}
  querySelectorAll(){return [get("taskPhotoFile"),get("taskPhotoCaption"),get("taskPhotoType"),get("publishTaskPhoto"),get("closeTaskPhotos")];}
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
 Option:class {constructor(text,value){this.textContent=text;this.value=value;}},
 createImageBitmap:async()=>({width:2000,height:1000,close(){}}),Blob,crypto:{randomUUID:()=>"photo-id"},console});
 const context={snapshot:{projectId:"project",userId:"user",role,tasks:[{id:"task",key:"201:bedroom:partitions",floorCode:"r2",active:true}],
 taskTypes:[{id:"type",code:"partitions",zone:"bedroom",label:"Cloisons chambre",group_label:"Cloisons"}],
 members:[{user_id:"user",name:"Intervenant"}],assignments:assigned?[{room_task_id:"task",assignee_id:"user",ended_at:null}]:[]},
 userId:"user",key:"201:bedroom:partitions",label:"R+2 · Chambre 201 · Cloisons chambre"};
 return {get,events,rows,context,open:exports.openTaskPhotos,openProject:exports.openProjectPhotos,submit:()=>get("taskPhotoForm").handlers.submit({preventDefault(){}})};
}

test("photo publishes captured task and caption, then refreshes gallery",async()=>{
 const h=harness();await h.open(h.context);
 h.get("taskPhotoFile").files=[{type:"image/png"}];
 h.get("taskPhotoType").value="issue";
 h.get("taskPhotoCaption").value="<script>test</script>";
 await h.submit();
 assert.deepEqual(h.events.map(e=>e[0]),["upload","insert"]);
 const row=h.rows[0];
 assert.equal(row.room_task_id,"task");assert.equal(row.needs_review,false);
 assert.equal(row.photo_type,"issue");
 assert.equal(row.caption,"<script>test</script>");
 assert.equal("progress" in row,false);
 assert.equal(h.get("taskPhotoGallery").children.length,1);
 assert.equal(h.get("taskPhotoGallery").children[0].children[2].textContent,"<script>test</script>");
 assert.match(h.get("taskPhotoStatus").textContent,/Photo partagée/);
 assert.equal(h.get("taskPhotoFile").files.length,0);
});

test("ordinary photo and assigned worker are supported; viewers and unassigned workers cannot send",async()=>{
 for(const [role,assigned,allowed] of [["worker",true,true],["worker",false,false],["viewer",true,false]]) {
  const h=harness({role,assigned});await h.open(h.context, false);
  assert.equal(h.get("taskPhotoForm").hidden,!allowed);
  h.get("taskPhotoCaption").value="Photo de suivi";
  h.get("taskPhotoFile").files=[{type:"image/jpeg"}];await h.submit();
  assert.equal(h.rows.length,allowed?1:0);
  if(allowed)assert.equal(h.rows[0].needs_review,false);
 }
});

test("failed upload keeps the file for retry and never inserts metadata",async()=>{
 const h=harness({uploadError:true});await h.open(h.context);
 h.get("taskPhotoCaption").value="Photo en échec";
 h.get("taskPhotoFile").files=[{type:"image/jpeg"}];await h.submit();
 assert.deepEqual(h.events.map(e=>e[0]),["upload"]);
 assert.equal(h.get("taskPhotoFile").files.length,1);
 assert.equal(h.get("publishTaskPhoto").disabled,false);
 assert.match(h.get("taskPhotoStatus").textContent,/Impossible/);
});

test("failed metadata insert cleans up the orphan upload and preserves the selected photo",async()=>{
 const h=harness({insertError:true});await h.open(h.context);
 h.get("taskPhotoCaption").value="Photo en échec";
 h.get("taskPhotoFile").files=[{type:"image/jpeg"}];await h.submit();
 assert.deepEqual(h.events.map(e=>e[0]),["upload","insert","cleanup"]);
 assert.equal(h.get("taskPhotoFile").files.length,1);
});

test("unsupported files cannot be uploaded",async()=>{
 const h=harness();await h.open(h.context);
 h.get("taskPhotoCaption").value="Mauvais fichier";
 h.get("taskPhotoFile").files=[{type:"application/pdf"}];await h.submit();
 assert.equal(h.events.length,0);
 assert.match(h.get("taskPhotoStatus").textContent,/JPEG, PNG ou WebP/);
});

test("a description is required before upload",async()=>{
 const h=harness();await h.open(h.context);
 h.get("taskPhotoFile").files=[{type:"image/jpeg"}];await h.submit();
 assert.equal(h.events.length,0);
 assert.match(h.get("taskPhotoStatus").textContent,/description/);
});

test("the project gallery shows the photo category and its task relationship",async()=>{
 const h=harness({seed:[{id:"photo",room_task_id:"task",uploaded_by:"user",storage_path:"task/user/photo.jpg",caption:"Défaut à corriger",created_at:"2026-09-28T10:00:00Z",photo_type:"issue"}]});
 await h.openProject(h.context.snapshot,{r2:"R+2"});
 assert.equal(h.get("projectPhotoGallery").children.length,1);
 const card=h.get("projectPhotoGallery").children[0];
 assert.equal(card.children[0].children[0].textContent,"R+2 · Chambre 201");
 assert.equal(card.children[0].children[1].textContent,"Problème à traiter");
 assert.match(card.children[3].children[0].textContent,/Chambre · Cloisons · Cloisons chambre/);
 assert.equal(h.get("projectPhotoStatus").textContent,"1 photo affichée");
});
