import { client } from "./cloud/workspace.js";
import { editable, type Snapshot } from "./cloud/types.js";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Context = { snapshot: Snapshot; userId: string; key: string; label: string };
type PhotoRow = { id: string; room_task_id: string; uploaded_by: string; storage_path: string; caption: string; created_at: string; photo_type?: string; needs_review?: boolean };
let context: Context | null = null;
let busy = false;
let previewUrl = "";
let projectRows: PhotoRow[] = [];
let projectSnapshot: Snapshot | null = null;
let projectFloorLabels: Record<string, string> = {};
const dialog = () => el<HTMLDialogElement>("taskPhotoDialog");
const status = (message: string) => { el("taskPhotoStatus").textContent = message; };
const photoKinds: Record<string, string> = { followup: "Suivi / information", issue: "Problème à traiter", obstruction: "Encombrement" };
const photoKind = (photo: PhotoRow) => photo.photo_type || (photo.needs_review ? "issue" : "followup");

function errorMessage(error: unknown): string {
  const message = (error as { message?: string })?.message || "";
  if (/photo_type|task_photos|bucket.*not found|schema cache/i.test(message))
    return "Les photos nécessitent les mises à jour Supabase 0019 et 0020.";
  return "Impossible de partager ou charger les photos. Vérifiez votre connexion puis réessayez.";
}

async function jpeg(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("unsupported");
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "white"; drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .85));
    if (!blob || blob.size > 5242880) throw new Error("unsupported");
    return blob;
  } finally { bitmap.close(); }
}

async function signedPhoto(photo: PhotoRow, label: string, details = "") {
  const card = document.createElement("article");
  card.className = "project-photo-card";
  const header = document.createElement("header");
  const title = document.createElement("strong"); title.textContent = label;
  const kind = document.createElement("span");
  const kindCode = photoKind(photo); kind.className = "photo-kind " + kindCode; kind.textContent = photoKinds[kindCode] || "Suivi / information";
  header.append(title, kind);
  const caption = document.createElement("p"); caption.textContent = photo.caption || "Sans description";
  const link = document.createElement("a"); link.target = "_blank"; link.rel = "noopener";
  const image = document.createElement("img"); image.alt = photo.caption || label; image.loading = "lazy";
  link.append(image);
  const footer = document.createElement("footer");
  const author = projectSnapshot?.members.find(m => m.user_id === photo.uploaded_by)?.name || "Membre";
  const relation = document.createElement("span"); relation.textContent = details;
  const byline = document.createElement("span"); byline.textContent = author + " · " + new Date(photo.created_at).toLocaleString("fr-FR");
  footer.append(relation, byline); card.append(header, link, caption, footer);
  const { data: url, error } = await client!.storage.from("task-photos").createSignedUrl(photo.storage_path, 3600);
  if (url && !error) { link.href = url.signedUrl; image.src = url.signedUrl; }
  else { link.replaceChildren(); link.textContent = "Photo momentanément indisponible"; }
  return card;
}

async function gallery(c: Context) {
  const task = c.snapshot.tasks.find(t => t.key === c.key);
  if (!client || !task) return;
  const { data, error } = await client.from("task_photos").select("*")
    .eq("project_id", c.snapshot.projectId).eq("room_task_id", task.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  projectSnapshot = c.snapshot;
  const cards = await Promise.all(((data || []) as PhotoRow[]).map(photo => signedPhoto(photo, photoKinds[photoKind(photo)] || "Photo de suivi")));
  if (context !== c) return;
  el("taskPhotoGallery").replaceChildren(...cards);
  if (!cards.length) el("taskPhotoGallery").textContent = "Aucune photo pour cette sous-tâche.";
}

function photoDetails(snapshot: Snapshot, photo: PhotoRow) {
  const task = snapshot.tasks.find(item => item.id === photo.room_task_id);
  if (!task) return null;
  const [room, zone, code] = task.key.split(":");
  const type = snapshot.taskTypes?.find(item => item.zone === zone && item.code === code);
  const floor = projectFloorLabels[task.floorCode || ""] || task.floorCode?.toUpperCase() || "Étage inconnu";
  const zoneLabel = zone === "bathroom" ? "Salle de bain" : "Chambre";
  return { floorCode: task.floorCode || "", floor, room, zoneLabel, task: type?.label || code, group: type?.group_label || "Tâche" };
}

async function renderProjectGallery() {
  if (!projectSnapshot) return;
  const kind = el<HTMLSelectElement>("projectPhotoType").value;
  const floor = el<HTMLSelectElement>("projectPhotoFloor").value;
  const search = el<HTMLInputElement>("projectPhotoSearch").value.trim().toLocaleLowerCase("fr");
  const selected = projectRows.filter(photo => {
    const details = photoDetails(projectSnapshot!, photo);
    if (!details || (kind !== "all" && photoKind(photo) !== kind) || (floor !== "all" && details.floorCode !== floor)) return false;
    return !search || [details.floor, details.room, details.zoneLabel, details.group, details.task, photo.caption].join(" ").toLocaleLowerCase("fr").includes(search);
  });
  el("projectPhotoStatus").textContent = selected.length + " photo" + (selected.length > 1 ? "s" : "") + " affichée" + (selected.length > 1 ? "s" : "");
  const cards = await Promise.all(selected.map(photo => {
    const details = photoDetails(projectSnapshot!, photo)!;
    return signedPhoto(photo, details.floor + " · Chambre " + details.room, details.zoneLabel + " · " + details.group + " · " + details.task);
  }));
  el("projectPhotoGallery").replaceChildren(...cards);
  if (!cards.length) el("projectPhotoGallery").textContent = "Aucune photo ne correspond aux filtres.";
}

export async function openProjectPhotos(snapshot: Snapshot, floorLabels: Record<string, string>) {
  if (!client) return;
  projectSnapshot = snapshot; projectFloorLabels = floorLabels;
  el<HTMLSelectElement>("projectPhotoType").value = "all";
  el<HTMLInputElement>("projectPhotoSearch").value = "";
  const floorSelect = el<HTMLSelectElement>("projectPhotoFloor");
  floorSelect.replaceChildren(new Option("Tous les étages", "all"), ...Object.entries(floorLabels).map(([value, label]) => new Option(label, value)));
  floorSelect.value = "all";
  el("projectPhotoGallery").replaceChildren(); el("projectPhotoStatus").textContent = "Chargement des photos…";
  const { data, error } = await client.from("task_photos").select("*").eq("project_id", snapshot.projectId).order("created_at", { ascending: false });
  if (error) { el("projectPhotoStatus").textContent = errorMessage(error); return; }
  projectRows = (data || []) as PhotoRow[];
  await renderProjectGallery();
}

export async function openTaskPhotos(c: Context, readOnly = false) {
  if (busy) return;
  context = c;
  el<HTMLFormElement>("taskPhotoForm").reset();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
  el<HTMLImageElement>("taskPhotoPreview").hidden = true;
  el("taskPhotoForm").hidden = readOnly || !editable(c.snapshot, c.userId, c.key);
  el("taskPhotoContext").textContent = c.label;
  el("taskPhotoGallery").replaceChildren();
  status("Chargement des photos…");
  dialog().showModal();
  try { await gallery(c); if (context === c) status(""); }
  catch (error) { if (context === c) status(errorMessage(error)); }
}

el("taskPhotoFile").addEventListener("change", () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const file = el<HTMLInputElement>("taskPhotoFile").files?.[0];
  const preview = el<HTMLImageElement>("taskPhotoPreview");
  preview.hidden = !file;
  if (file) { previewUrl = URL.createObjectURL(file); preview.src = previewUrl; }
});
el("closeTaskPhotos").addEventListener("click", () => { if (!busy) dialog().close(); });
dialog().addEventListener("cancel", event => { if (busy) event.preventDefault(); });
dialog().addEventListener("close", () => {
  context = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
  el<HTMLFormElement>("taskPhotoForm").reset();
});
el("taskPhotoForm").addEventListener("submit", async event => {
  event.preventDefault();
  const c = context;
  const file = el<HTMLInputElement>("taskPhotoFile").files?.[0];
  if (busy || !client || !c || !file || !editable(c.snapshot, c.userId, c.key)) return;
  const task = c.snapshot.tasks.find(t => t.key === c.key)!;
  const caption = el<HTMLTextAreaElement>("taskPhotoCaption").value.trim();
  const photoType = el<HTMLSelectElement>("taskPhotoType").value || "followup";
  if (!caption) { status("Ajoutez une description pour expliquer la photo."); return; }
  busy = true;
  const controls = Array.from(dialog().querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>("input, button, textarea, select"));
  controls.forEach(control => control.disabled = true);
  status("Envoi de la photo…");
  try {
    const blob = await jpeg(file);
    const id = crypto.randomUUID();
    const path = task.id + "/" + c.userId + "/" + id + ".jpg";
    const uploaded = await client.storage.from("task-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (uploaded.error) throw uploaded.error;
    const inserted = await client.from("task_photos").insert({
      id, project_id: c.snapshot.projectId, room_task_id: task.id, uploaded_by: c.userId,
      storage_path: path, needs_review: false, photo_type: photoType, caption
    });
    if (inserted.error) {
      await client.storage.from("task-photos").remove([path]);
      throw inserted.error;
    }
    el<HTMLFormElement>("taskPhotoForm").reset();
    el<HTMLImageElement>("taskPhotoPreview").hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    status("Photo partagée. L’avancement reste inchangé.");
    try { await gallery(c); } catch { status("Photo partagée. Rouvrez la fenêtre pour actualiser les photos."); }
  } catch (error) {
    status((error as Error)?.message === "unsupported" ? "Choisissez une photo JPEG, PNG ou WebP valide." : errorMessage(error));
  } finally { busy = false; controls.forEach(control => control.disabled = false); }
});

for (const id of ["projectPhotoType", "projectPhotoFloor", "projectPhotoSearch"])
  el(id).addEventListener(id === "projectPhotoSearch" ? "input" : "change", () => void renderProjectGallery());

