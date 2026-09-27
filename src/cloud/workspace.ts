import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { CURRENT_FLOOR, emptyProject } from "../model.js";
import { OfflineStore } from "./offline-store.js";
import { SyncEngine } from "./sync.js";
import type { Snapshot, CloudTask, Operation, Receipt, Member } from "./types.js";

const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env || {};
const url = env.VITE_SUPABASE_URL || "";
const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const cloudConfigured = Boolean(url && publicKey);
const authStorageKey = "pistache-auth:" + url;
export const client: SupabaseClient | null = cloudConfigured ? createClient(url, publicKey, {
  auth: { storageKey: authStorageKey },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) },
}) : null;
const identityKey = "pistache-cloud-user:" + url;
export function networkError(error: any): boolean {
  return !navigator.onLine || error instanceof TypeError || /fetch|network|timeout|aborted/i.test(error?.message || "");
}
async function unwrap<T>(request: PromiseLike<{data: T; error: any}>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
}
async function allRows(table: string, projectId: string) {
  const pageSize=1000;
  const order=table === "project_members" ? "user_id" : "id";
  const firstRequest=client!.from(table).select("*",{count:"exact"}).eq("project_id",projectId).order(order).range(0,pageSize-1);
  const {data:first,error,count}=await firstRequest;
  if(error)throw new Error(error.message);
  const rows:any[]=[...(first || [])];
  if(count===null || count<=pageSize)return rows;
  const pages=await Promise.all(Array.from({length:Math.ceil(count/pageSize)-1},(_,index)=>{
    const offset=(index+1)*pageSize;
    return unwrap<any[] | null>(client!.from(table).select("*").eq("project_id",projectId).order(order).range(offset,offset+pageSize-1)).then(page=>page || []);
  }));
  for(const page of pages)rows.push(...page);
  return rows;
}
export class CloudWorkspace {
  snapshot?: Snapshot;
  readonly store: OfflineStore;
  readonly engine: SyncEngine;
  readonly namespace: string;
  constructor(readonly user: Pick<User, "id" | "email" | "user_metadata">) {
    this.namespace = url + ":" + user.id;
    this.store = new OfflineStore(this.namespace);
    const deviceKey = "pistache-device:" + url;
    let deviceId = localStorage.getItem(deviceKey);
    if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(deviceKey, deviceId); }
    this.engine = new SyncEngine(this.store, user.id, deviceId, async (operation: Operation) => {
      const { data } = await client!.auth.getSession();
      if (data.session?.user.id !== operation.userId) throw new Error("Reconnectez-vous au compte ayant saisi cette modification.");
      return await unwrap(client!.rpc("submit_progress", {
        p_operation_id: operation.id, p_task_id: operation.taskId, p_assignment_id: operation.assignmentId,
        p_device_id: operation.deviceId, p_base_version: operation.baseVersion,
        p_client_created_at: operation.createdAt, p_payload: operation.payload,
        p_depends_on_operation_id: operation.dependsOn,
      })) as Receipt;
    });
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (!navigator.locks) throw new Error("Ce navigateur ne prend pas en charge la synchronisation. Utilisez un navigateur récent.");
    return navigator.locks.request("pistache-sync:" + this.namespace, action);
  }
  async projects(): Promise<{id: string; name: string}[]> {
    const cached=(await this.store.all<Snapshot>("snapshots")).map(s=>({id:s.projectId,name:s.name}));
    if(cached.length)return cached;
    try {
      if (!navigator.onLine) throw new Error("offline");
      return await unwrap(client!.from("projects").select("id,name").is("archived_at", null).order("name")) as any;
    } catch (error) {
      if (!networkError(error)) throw error;
      return (await this.store.all<Snapshot>("snapshots")).map(s => ({id:s.projectId,name:s.name}));
    }
  }
  async people(): Promise<{id: string; name: string; email?: string}[]> {
    const profiles = await unwrap<any[] | null>(client!.from("profiles").select("id,display_name"));
    const rows = profiles ?? [];
    return rows.map(profile => ({
      id: profile.id,
      name: profile.display_name || profile.id,
    }));
  }
  async refresh(projectId: string) {
    const [project,memberships]=await Promise.all([
      unwrap<any>(client!.from("projects").select("*").eq("id",projectId).single()),
      allRows("project_members",projectId),
    ]);
    const own = memberships.find(m => m.user_id === this.user.id && m.status === "active");
    if (!own) throw new Error("Vous n'avez plus accès à ce projet.");
    const [rooms,types,tasks,assignments,floors,blocks,profiles]=await Promise.all([
      ...["rooms","task_types","room_tasks","task_assignments","floors","blocks"].map(t=>allRows(t,projectId)),
      unwrap<any[] | null>(client!.from("profiles").select("id,display_name")).then(rows=>rows || []),
    ]);
    const profileById=new Map(profiles.map((profile:any)=>[profile.id,profile]));
    const roomById=new Map(rooms.map(room=>[room.id,room]));
    const typeById=new Map(types.map(type=>[type.id,type]));
    const floorById=new Map(floors.map(floor=>[floor.id,floor]));
    const blockById=new Map(blocks.map(block=>[block.id,block]));
    const members: Member[] = memberships.map(m => ({...m,name:profileById.get(m.user_id)?.display_name || m.user_id}));
    const cloudTasks: CloudTask[] = tasks.flatMap(t => {
      const room = roomById.get(t.room_id), type=typeById.get(t.task_type_id);
      const floor=floorById.get(room?.floor_id), block=blockById.get(room?.block_id);
      if (!room || !type || !floor) return [];
      return [{ id:t.id,floorCode:floor.code,key:room.number+":"+type.zone+":"+type.code,version:Number(t.version),
        active:![project.archived_at,t.archived_at,room.archived_at,type.archived_at,floor.archived_at,block?.archived_at].some(Boolean),
        record:{confirmedDay:t.confirmed_day,confirmedProgress:t.progress,lockedProgress:t.locked_progress??t.progress,progress:t.progress,blocked:t.blocked,note:t.note,startDate:t.start_date||"",endDate:t.end_date||""} }];
    });
    // RLS and the RPC remain authoritative; this snapshot is only a UI/cache view.
    const snapshot: Snapshot = {projectId,name:project.name,userId:this.user.id,role:own.role,tasks:cloudTasks,taskTypes:types,
      assignments:assignments.filter(a=>!a.ended_at),members,cachedAt:new Date().toISOString()};
    await this.store.saveSnapshot(snapshot);
    this.snapshot=snapshot;
  }
  async open(projectId: string) {
    const cached=await this.store.snapshot(projectId);
    if(cached){this.snapshot=cached;return this.project();}
    await this.exclusive(async () => {
      try { if (!navigator.onLine) throw new Error("offline"); await this.refresh(projectId); }
      catch (error) {
        if (!networkError(error)) throw error;
        this.snapshot=await this.store.snapshot(projectId);
        if (!this.snapshot) throw new Error("Ouvrez ce projet une première fois avec une connexion Internet.");
      }
    });
    return this.project();
  }
  async project() {
    const project=emptyProject();
    if (this.snapshot) {
      const records = await this.engine.records(this.snapshot.projectId);
      const taskFloors = new Map(this.snapshot.tasks.map(task => [task.key, task.floorCode || CURRENT_FLOOR]));
      for (const [key, record] of Object.entries(records)) {
        const floor = taskFloors.get(key) || CURRENT_FLOOR;
        project.floors[floor] ||= { records: {} };
        project.floors[floor].records[key] = record;
      }
    }
    return project;
  }
  async enqueue(key: string, record: any, correction: any, previousRecord?: any) {
    if (!this.snapshot) throw new Error("Aucun projet ouvert.");
    const version = this.snapshot.tasks.find(t => t.key === key)?.version;
    return this.exclusive(async () => {
      await this.engine.enqueue(this.snapshot!.projectId,key,record,correction,previousRecord,version,true);
      return this.project();
    });
  }
  async cancelDrafts() {
    if(!this.snapshot) throw new Error("Aucun projet ouvert.");
    return this.exclusive(()=>this.engine.cancelDrafts(this.snapshot!.projectId));
  }
  async confirmDrafts() {
    if(!this.snapshot) throw new Error("Aucun projet ouvert.");
    return this.exclusive(()=>this.engine.confirmDrafts(this.snapshot!.projectId));
  }
  async sync() {
    if (!this.snapshot) return;
    const projectId=this.snapshot.projectId;
    await this.exclusive(async () => {
      try {
        await this.engine.flush(projectId);
        await this.refresh(projectId);
      } catch (error) {
        if (!networkError(error) && this.snapshot) {
          this.snapshot = { ...this.snapshot, role: "viewer", tasks: this.snapshot.tasks.map(t => ({ ...t, active: false })) };
          await this.store.saveSnapshot(this.snapshot);
        }
        throw error;
      }
    });
  }
  async assign(taskId: string, userId: string | null) {
    if (!navigator.onLine) throw new Error("Une connexion est nécessaire pour modifier les affectations.");
    await unwrap(client!.rpc("assign_task",{p_task_id:taskId,p_assignee_id:userId,p_reason:"Affectation depuis le tableau de bord"}));
    await this.exclusive(()=>this.refresh(this.snapshot!.projectId));
  }
  async member(userId: string, role: string, status = "active") {
    if (!navigator.onLine) throw new Error("Une connexion est nécessaire pour gérer les membres.");
    await unwrap(client!.rpc("set_project_member",{p_project_id:this.snapshot!.projectId,p_user_id:userId,p_role:role,p_status:status}));
    await this.exclusive(()=>this.refresh(this.snapshot!.projectId));
  }
  async manageTaskType(id: string, label: string, hidden: boolean, hiddenUsers: string[]) {
    if (!navigator.onLine) throw new Error("Une connexion est nécessaire pour gérer les tâches.");
    await unwrap(client!.rpc("manage_task_type",{p_id:id,p_label:label,p_hidden:hidden,p_hidden_user_ids:hiddenUsers}));
    await this.exclusive(()=>this.refresh(this.snapshot!.projectId));
  }
  async history() {
    return await unwrap(client!.from("progress_updates").select("*").eq("project_id",this.snapshot!.projectId).order("created_at",{ascending:false}).limit(80)) as any[];
  }
  async assignmentScope() {
    const projectId=this.snapshot!.projectId;
    const [floors,blocks,rooms,tasks,assignments]=await Promise.all(
      ["floors","blocks","rooms","room_tasks","task_assignments"].map(table=>allRows(table,projectId)));
    return {floors,blocks,rooms,tasks,assignments};
  }
  async assignBlocks(blockIds: string[], userId: string | null) {
    if (!navigator.onLine) throw new Error("Une connexion est nécessaire pour modifier les affectations.");
    const count=await unwrap(client!.rpc("assign_blocks",{p_project_id:this.snapshot!.projectId,p_block_ids:blockIds,p_assignee_id:userId}));
    await this.exclusive(()=>this.refresh(this.snapshot!.projectId));
    return count;
  }
  async assignFloors(floorIds: string[], userId: string | null) {
    if (!navigator.onLine) throw new Error("Une connexion est nécessaire pour modifier les affectations.");
    const count=await unwrap(client!.rpc("assign_floors",{p_project_id:this.snapshot!.projectId,p_floor_ids:floorIds,p_assignee_id:userId}));
    await this.exclusive(()=>this.refresh(this.snapshot!.projectId));
    return count;
  }
  async invitations() {
    return (await unwrap<any[] | null>(client!.from("account_invitations").select("id,role,created_at,expires_at,revoked_at,used_at,used_by").eq("project_id",this.snapshot!.projectId).order("created_at",{ascending:false}).limit(50))) || [];
  }
  async createInvitation(role: string) {
    const data=await unwrap<{id:string;token:string;expires_at:string} | null>(client!.rpc("create_account_invitation",{p_project_id:this.snapshot!.projectId,p_role:role}));
    if(!data)throw new Error("Invitation indisponible.");
    return data;
  }
  async revokeInvitation(id: string) {
    await unwrap(client!.rpc("revoke_account_invitation",{p_id:id}));
  }
  async createProject() {
    if (!navigator.onLine) throw new Error("Une connexion est nécessaire pour créer un projet.");
    return await unwrap(client!.rpc("create_mixed_use_project")) as string;
  }
}
export async function restoreWorkspace(): Promise<CloudWorkspace | null> {
  if (!client) return null;
  if (!navigator.onLine) {
    const saved=localStorage.getItem(identityKey);
    return saved ? new CloudWorkspace(JSON.parse(saved)) : null;
  }
  const {data,error}=await client.auth.getSession();
  if (error) {
    const saved=localStorage.getItem(identityKey);
    if (networkError(error) && saved) return new CloudWorkspace(JSON.parse(saved));
    throw error;
  }
  if (!data.session) { localStorage.removeItem(identityKey); return null; }
  const user={id:data.session.user.id,email:data.session.user.email,user_metadata:data.session.user.user_metadata};
  localStorage.setItem(identityKey,JSON.stringify(user));
  return new CloudWorkspace(user);
}
export async function login(identifier: string,password: string) {
  if (!client) throw new Error("Supabase n'est pas encore configuré.");
  const value=identifier.trim().toLowerCase();
  const email=value.includes("@")?value:value+"@users.pistache.invalid";
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error) throw error;
  client.auth.startAutoRefresh();
  return restoreWorkspace();
}
export async function acceptInvitation(token: string,username: string,password: string) {
  if(!client)throw new Error("Supabase n'est pas encore configuré.");
  const {data,error}=await client.functions.invoke("accept-invitation",{body:{token,username,password}});
  if(error) {
    let message="Création impossible. Vérifiez le lien ou contactez l’admin.";
    try { const body=await error.context?.json();if(body?.error)message=body.error; } catch {}
    throw new Error(message);
  }
  if(!data?.created)throw new Error(data?.error || "Création impossible.");
}
export async function logout() {
  if(client) {
    client.auth.stopAutoRefresh();
    if(navigator.onLine) await client.auth.signOut({scope:"local"});
  }
  localStorage.removeItem(authStorageKey);
  localStorage.removeItem(authStorageKey + "-user");
  localStorage.removeItem(identityKey);
}
