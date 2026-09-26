import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// PostgreSQL réel en WASM, sans serveur distant. Seul le contexte Auth Supabase est simulé.
// Ne couvre pas PostgREST, Storage, Realtime ou la concurrence entre plusieurs connexions.
test('PISTACHE schema, RLS and transactional RPCs', async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const first = async (sql, params = []) => (await query(sql, params))[0];
  const login = async (user, role = 'authenticated') => {
    await db.exec('reset role');
    await query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
    await db.exec(`set role ${role}`);
  };
  const reject = async (sql, params, pattern) => assert.rejects(query(sql, params), pattern);
  const admin = randomUUID(), worker = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
  const device = randomUUID();
  const payload = (progress, extra = {}) => ({ progress, blocked: false, note: 'test', start_date: null, end_date: null, ...extra });
  const operation = (task, assignment, version, body, extra = {}) => ({
    id: randomUUID(), task, assignment, device, version, time: '2026-09-24T12:00:00Z', body, dependency: null, ...extra,
  });
  const submit = (o) => first('select * from public.submit_progress($1,$2,$3,$4,$5,$6,$7,$8)',
    [o.id, o.task, o.assignment, o.device, o.version, o.time, JSON.stringify(o.body), o.dependency]);
  let project, otherProject, floor, otherFloor, room, room2, type, task, assignment, accepted, reassigned;

  await t.test('migration runs unchanged and profiles are created for existing and new users', async () => {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
    `);
    await query('insert into auth.users(id) values ($1)', [admin]);
    await db.exec(await readFile(new URL('../supabase/migrations/0001_initial_schema.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0002_create_mixed_use.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0003_assign_blocks.sql', import.meta.url), 'utf8'));
    for (const id of [worker, viewer, outsider]) await query('insert into auth.users(id) values ($1)', [id]);
    assert.equal((await query('select * from public.profiles')).length, 4);
    const tables = await query("select relname, relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'");
    assert.equal(tables.length, 13);
    assert.ok(tables.every((table) => table.relrowsecurity));
  });
  await t.test('project creation bootstraps admin; membership changes require an admin', async () => {
    await login(admin);
    project = (await first("select public.create_project('Mixed Use') as id")).id;
    otherProject = (await first("select public.create_project('Other') as id")).id;
    assert.equal((await first('select role from public.project_members where project_id=$1', [project])).role, 'admin');
    for (const [id, role] of [[worker, 'worker'], [viewer, 'viewer']]) {
      await query('select public.set_project_member($1,$2,$3,$4)', [project, id, role, 'active']);
    }
    await reject('select public.set_project_member($1,$2,$3,$4)', [project, admin, 'worker', 'active'], /last_admin_required/);
    await login(worker);
    await reject('select public.set_project_member($1,$2,$3,$4)', [project, worker, 'admin', 'active'], /project_admin_required/);
    await reject("update public.project_members set role='admin' where user_id=$1", [worker], /permission denied/);
  });
  await t.test('task creation works in both directions and restoration preserves progress', async () => {
    await login(admin);
    floor = (await first("insert into public.floors(project_id,code,label) values ($1,'r2','R+2') returning id", [project])).id;
    otherFloor = (await first("insert into public.floors(project_id,code,label) values ($1,'r2','R+2') returning id", [otherProject])).id;
    room = (await first("insert into public.rooms(project_id,floor_id,number) values ($1,$2,'201') returning id", [project, floor])).id;
    type = (await first("insert into public.task_types(project_id,code,label,zone) values ($1,'paint','Peinture','bedroom') returning id", [project])).id;
    task = (await first('select id from public.room_tasks where room_id=$1', [room])).id;
    room2 = (await first("insert into public.rooms(project_id,floor_id,number) values ($1,$2,'202') returning id", [project, floor])).id;
    assert.equal((await query('select * from public.room_tasks where project_id=$1', [project])).length, 2);
    await query('update public.rooms set archived_at=now() where id=$1', [room]);
    await query('update public.rooms set archived_at=null where id=$1', [room]);
    assert.equal((await query('select * from public.room_tasks where project_id=$1', [project])).length, 2);
  });
  await t.test('cross-project and cross-floor references are rejected', async () => {
    await reject("insert into public.rooms(project_id,floor_id,number) values ($1,$2,'999')", [project, otherFloor], /foreign key/);
    const floor2 = (await first("insert into public.floors(project_id,code,label) values ($1,'r3','R+3') returning id", [project])).id;
    const block = (await first("insert into public.blocks(project_id,floor_id,code,label) values ($1,$2,'A','A') returning id", [project, floor2])).id;
    await reject('update public.rooms set block_id=$1 where id=$2', [block, room], /foreign key/);
    await reject('update public.rooms set project_id=$1 where id=$2', [otherProject, room], /permission denied/);
  });
  await t.test('workers, viewers and outsiders have isolated read access and no direct task writes', async () => {
    for (const user of [worker, viewer]) {
      await login(user);
      assert.equal((await query('select * from public.projects')).length, 1);
      assert.equal((await query('select * from public.profiles')).length, 3);
      await reject('update public.room_tasks set progress=80 where id=$1', [task], /permission denied/);
      await reject('insert into public.floors(project_id,code,label) values ($1,\'bad\',\'bad\')', [project], /project_admin_required|row-level security/);
    }
    await login(outsider);
    for (const name of ['projects', 'project_members', 'floors', 'rooms', 'room_tasks', 'task_assignments', 'sync_operations', 'progress_updates']) {
      assert.equal((await query(`select * from public.${name}`)).length, 0, name);
    }
    await assert.rejects(submit(operation(task, null, 1, payload(10))), /project_access_denied/);
    await login(null, 'anon');
    await reject('select * from public.projects', [], /permission denied/);
    await reject("select public.create_project('bad')", [], /permission denied/);
  });
  await t.test('assignment is admin-only and increments task version', async () => {
    await login(worker);
    await reject('select public.assign_task($1,$2)', [task, worker], /project_admin_required/);
    await login(admin);
    await reject('select public.assign_task($1,$2)', [task, viewer], /active_worker_required/);
    assignment = (await first('select public.assign_task($1,$2) as id', [task, worker])).id;
    assert.equal(Number((await first('select version from public.room_tasks where id=$1', [task])).version), 2);
  });
  await t.test('accepted submission updates state, version, author and full history atomically', async () => {
    await login(worker);
    accepted = operation(task, assignment, 2, payload(60));
    assert.equal((await submit(accepted)).status, 'accepted');
    const current = await first('select * from public.room_tasks where id=$1', [task]);
    assert.equal(current.progress, 60);
    assert.equal(Number(current.version), 3);
    assert.equal(current.updated_by, worker);
    const history = await first('select * from public.progress_updates where operation_id=$1', [accepted.id]);
    assert.equal(history.before_state.progress, 0);
    assert.equal(history.after_state.progress, 60);
    assert.equal(history.changed_by, worker);
  });
  await t.test('retries are idempotent and changed envelopes cannot reuse operation IDs', async () => {
    assert.equal((await submit(accepted)).status, 'accepted');
    assert.equal((await query('select * from public.progress_updates')).length, 1);
    for (const change of [{ body: payload(70) }, { device: randomUUID() }, { version: 3 }, { assignment: null }]) {
      await assert.rejects(submit({ ...accepted, ...change }), /operation_id_reused/);
    }
  });
  await t.test('stale versions, malformed payloads and unauthorized corrections do not change progress', async () => {
    assert.equal((await submit(operation(task, assignment, 2, payload(70)))).error_code, 'version_conflict');
    for (const body of [payload(101), payload(60.5), payload(70, { progress: null }), payload(70, { blocked: null }),
      payload(70, { start_date: '2026-09-25', end_date: '2026-09-24' }), payload(70, { start_date: '2026-02-30' }),
      payload(70, { author: admin }), { progress: 70 }]) {
      assert.equal((await submit(operation(task, assignment, 3, body))).error_code, 'invalid_payload');
    }
    assert.equal((await submit(operation(task, assignment, 3, payload(50)))).error_code, 'correction_required');
    assert.equal((await submit(operation(task, assignment, 3, payload(50, { correction_reason: 'input-error', correction_note: 'test' })))).error_code, 'permission_denied');
    assert.equal((await first('select progress from public.room_tasks where id=$1', [task])).progress, 60);
    assert.equal((await query('select * from public.progress_updates')).length, 1);
  });
  await t.test('history write failure rolls back both task state and synchronization result', async () => {
    await db.exec('reset role');
    await db.exec('create trigger force_history_failure before insert on public.progress_updates for each row execute function private.immutable_history()');
    await login(worker);
    const failed = operation(task, assignment, 3, payload(70));
    await assert.rejects(submit(failed), /history_is_immutable/);
    assert.equal((await query('select * from public.sync_operations where id=$1', [failed.id])).length, 0);
    const current = await first('select progress, version from public.room_tasks where id=$1', [task]);
    assert.equal(current.progress, 60);
    assert.equal(Number(current.version), 3);
    await db.exec('reset role');
    await db.exec('drop trigger force_history_failure on public.progress_updates');
    await login(worker);
  });
  await t.test('offline dependencies can be retried after their predecessor is received', async () => {
    const predecessor = operation(task, assignment, 3, payload(70));
    const next = operation(task, assignment, 4, payload(80), { dependency: predecessor.id });
    await assert.rejects(submit(next), /dependency_pending/);
    assert.equal((await query('select * from public.sync_operations where id=$1', [next.id])).length, 0);
    assert.equal((await submit(predecessor)).status, 'accepted');
    assert.equal((await submit(next)).status, 'accepted');
    assert.equal(Number((await first('select version from public.room_tasks where id=$1', [task])).version), 5);
  });
  await t.test('reassignment closes history and rejects stale offline assignments', async () => {
    await login(admin);
    reassigned = (await first('select public.assign_task($1,$2) as id', [task, admin])).id;
    assert.ok((await first('select ended_at from public.task_assignments where id=$1', [assignment])).ended_at);
    assert.equal((await query('select * from public.task_assignments where room_task_id=$1 and ended_at is null', [task])).length, 1);
    await db.exec('reset role');
    await reject('insert into public.task_assignments(project_id,room_task_id,assignee_id,assigned_by) values ($1,$2,$3,$4)', [project, task, worker, admin], /task_assignments_one_active_idx/);
    await login(worker);
    assert.equal((await submit(operation(task, assignment, 5, payload(90)))).error_code, 'assignment_changed');
    assert.equal((await submit(operation(task, reassigned, 6, payload(90)))).error_code, 'assignment_changed');
  });
  await t.test('admin correction needs an explanation; completed tasks are protected', async () => {
    await login(admin);
    assert.equal((await submit(operation(task, null, 6, payload(50, { correction_reason: 'input-error', correction_note: ' ' })))).error_code, 'invalid_payload');
    assert.equal((await submit(operation(task, null, 6, payload(50, { correction_reason: 'input-error', correction_note: 'Saisie corrigée' })))).status, 'accepted');
    assert.equal((await submit(operation(task, reassigned, 7, payload(100)))).status, 'accepted');
    assert.equal((await submit(operation(task, reassigned, 8, payload(100, { note: 'changed' })))).error_code, 'correction_required');
  });
  await t.test('archival prevents submissions and restoration preserves state', async () => {
    await query('update public.rooms set archived_at=now() where id=$1', [room]);
    assert.equal((await submit(operation(task, null, 8, payload(90, { correction_reason: 'scope-change', correction_note: 'test' })))).error_code, 'task_archived');
    await reject('select public.assign_task($1,$2)', [task, worker], /task_archived/);
    await query('update public.rooms set archived_at=null where id=$1', [room]);
    assert.equal((await first('select progress from public.room_tasks where id=$1', [task])).progress, 100);
    assert.equal((await query('select * from public.room_tasks where room_id=$1', [room])).length, 1);
  });
  await t.test('deactivation closes assignments, increments versions and removes access', async () => {
    await query('select public.assign_task($1,$2)', [task, worker]);
    const before = Number((await first('select version from public.room_tasks where id=$1', [task])).version);
    await query('select public.set_project_member($1,$2,$3,$4)', [project, worker, 'worker', 'inactive']);
    assert.equal(Number((await first('select version from public.room_tasks where id=$1', [task])).version), before + 1);
    assert.equal((await query('select * from public.task_assignments where room_task_id=$1 and ended_at is null', [task])).length, 0);
    await login(worker);
    assert.equal((await query('select * from public.room_tasks')).length, 0);
    await assert.rejects(submit(accepted), /project_access_denied/);
  });
  await t.test('history and synchronization outcomes are immutable, including for maintenance writes', async () => {
    await login(admin);
    await reject('delete from public.rooms where id=$1', [room], /permission denied/);
    await reject('update public.progress_updates set after_state=\'{}\'', [], /permission denied/);
    await db.exec('reset role');
    await reject('update public.progress_updates set after_state=\'{}\'', [], /history_is_immutable/);
    await reject('delete from public.sync_operations', [], /history_is_immutable/);
    await reject('insert into public.task_assignments(project_id,room_task_id,assignee_id,assigned_by) values ($1,$2,$3,$4)', [otherProject, task, admin, admin], /foreign key/);
  });
  await t.test('Mixed Use setup creates 40 rooms, 70 types and 2800 independent tasks', async () => {
    await login(admin);
    const seeded=(await first('select public.create_mixed_use_project() as id')).id;
    assert.equal((await query('select * from public.rooms where project_id=$1',[seeded])).length,40);
    assert.equal((await query('select * from public.task_types where project_id=$1',[seeded])).length,70);
    const tasks=await query('select * from public.room_tasks where project_id=$1',[seeded]);
    assert.equal(tasks.length,2800);
    assert.ok(tasks.every(t=>t.progress===0));
    await query('select public.set_project_member($1,$2,$3,$4)',[seeded,worker,'worker','active']);
    await query('select public.set_project_member($1,$2,$3,$4)',[seeded,outsider,'worker','active']);
    const firstTask=tasks[0],sameRoom=tasks.find(t=>t.room_id===firstTask.room_id&&t.id!==firstTask.id);
    const firstAssignment=(await first('select public.assign_task($1,$2) as id',[firstTask.id,worker])).id;
    const secondAssignment=(await first('select public.assign_task($1,$2) as id',[sameRoom.id,outsider])).id;
    await login(worker);
    assert.equal((await submit(operation(firstTask.id,firstAssignment,2,payload(30)))).status,'accepted');
    assert.equal((await submit(operation(sameRoom.id,secondAssignment,2,payload(40)))).error_code,'assignment_changed');
    assert.equal((await first('select progress from public.room_tasks where id=$1',[sameRoom.id])).progress,0);
  });

  await t.test('block assignments span floors, preserve other blocks and enforce permissions atomically', async () => {
    await login(admin);
    const p=(await first("select public.create_project('Multi-floor') as id")).id;
    await query('select public.set_project_member($1,$2,$3,$4)',[p,worker,'worker','active']);
    const blocks=[];
    for(const code of ['r1','r2','r3']) {
      const f=(await first('insert into public.floors(project_id,code,label) values ($1,$2,$2) returning id',[p,code])).id;
      const b=(await first("insert into public.blocks(project_id,floor_id,code,label) values ($1,$2,'A','A') returning id",[p,f])).id;
      blocks.push(b);
      await query("insert into public.rooms(project_id,floor_id,block_id,number) values ($1,$2,$3,'101')",[p,f,b]);
    }
    await query("insert into public.task_types(project_id,code,label,zone) values ($1,'paint','Peinture','bedroom')",[p]);
    assert.equal((await first('select public.assign_blocks($1,$2,$3) as count',[p,blocks.slice(0,2),worker])).count,2);
    assert.equal((await first('select public.assign_blocks($1,$2,$3) as count',[p,blocks.slice(0,2),worker])).count,0);
    assert.equal((await first('select count(*)::int as n from public.task_assignments where project_id=$1 and ended_at is null',[p])).n,2);
    await reject('select public.assign_blocks($1,$2,$3)',[p,[blocks[2],randomUUID()],admin],/invalid_block/);
    assert.equal((await first('select count(*)::int as n from public.task_assignments where project_id=$1 and ended_at is null',[p])).n,2);
    await reject('select public.assign_blocks($1,$2,$3)',[p,[],worker],/blocks_required/);
    await login(worker);
    await reject('select public.assign_blocks($1,$2,$3)',[p,blocks,worker],/project_admin_required/);
    await login(admin);
    assert.equal((await first('select public.assign_blocks($1,$2,$3) as count',[p,[blocks[0]],null])).count,1);
    assert.equal((await first('select count(*)::int as n from public.task_assignments where project_id=$1 and ended_at is null',[p])).n,1);
  });

  await t.test('confirmed daily progress permits same-day decreases and requires worker justification on later days',async()=>{
    await db.exec('reset role');
    await db.exec(await readFile(new URL('../supabase/migrations/0004_confirmed_progress.sql',import.meta.url),'utf8'));
    await login(admin);
    const p=(await first("select public.create_project('Daily') as id")).id;
    await query('select public.set_project_member($1,$2,$3,$4)',[p,worker,'worker','active']);
    const f=(await first("insert into public.floors(project_id,code,label) values ($1,'r2','R+2') returning id",[p])).id;
    await query("insert into public.rooms(project_id,floor_id,number) values ($1,$2,'201')",[p,f]);
    await query("insert into public.task_types(project_id,code,label,zone) values ($1,'paint','Peinture','bedroom')",[p]);
    const taskId=(await first('select id from public.room_tasks where project_id=$1',[p])).id;
    const assignment=(await first('select public.assign_task($1,$2) as id',[taskId,worker])).id;
    await login(worker);
    const send=async(progress,extra={})=>{
      const version=Number((await first('select version from public.room_tasks where id=$1',[taskId])).version);
      return submit(operation(taskId,assignment,version,payload(progress,extra)));
    };
    assert.equal((await send(80)).status,'accepted');
    assert.equal((await send(50)).status,'accepted');
    await db.exec('reset role');
    await query("update public.room_tasks set confirmed_day=(now() at time zone 'Africa/Casablanca')::date-1 where id=$1",[taskId]);
    await login(worker);
    assert.equal((await send(40)).error_code,'correction_required');
    assert.equal((await send(70)).status,'accepted');
    assert.equal((await send(45)).error_code,'correction_required');
    assert.equal((await send(40,{correction_reason:'input-error',correction_note:'Mesure vérifiée sur place'})).status,'accepted');
  });

});
