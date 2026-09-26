import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../supabase/functions/accept-invitation/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function setup(inv={expires_at:new Date(Date.now()+60000).toISOString(),used_at:null,revoked_at:null}){
 let handler,created;
 const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:inv})})})}),auth:{admin:{createUser:async args=>{created=args;return {error:null};}}}};
 vm.runInNewContext(code,{Deno:{env:{get:()=> 'server-only'},serve:fn=>{handler=fn;}},createClient:()=>admin,Response,Request,TextEncoder,crypto:webcrypto});
 return {send:body=>handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)})),created:()=>created};
}
test('invitation endpoint creates a confirmed username account with protected invitation metadata',async()=>{
 const api=setup();const r=await api.send({token:'a'.repeat(64),username:'Test.User',password:'password123',role:'admin'});
 assert.equal(r.status,200);assert.equal(api.created().email,'test.user@users.pistache.invalid');assert.equal(api.created().email_confirm,true);
 assert.equal(api.created().app_metadata.role,undefined);assert.equal(api.created().app_metadata.invitation_hash.length,64);
});
test('used invitations and malformed credentials never create an account',async()=>{
 const used=setup({used_at:'today'});assert.equal((await used.send({token:'a'.repeat(64),username:'person',password:'password123'})).status,400);assert.equal(used.created(),undefined);
 const invalid=setup();assert.equal((await invalid.send({token:'bad',username:'person',password:'password123'})).status,400);assert.equal(invalid.created(),undefined);
});
