import { client } from "./cloud/workspace.js";
import { editable, type Snapshot } from "./cloud/types.js";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Context = { snapshot: Snapshot; userId: string; key: string; label: string };
let context: Context | null = null;
let busy = false;
let previewUrl = "";
const dialog = () => el<HTMLDialogElement>("taskPhotoDialog");
const status = (message: string) => { el("taskPhotoStatus").textContent = message; };

function errorMessage(error: unknown): string {
  const message = (error as { message?: string })?.message || "";
  if (/task_photos|bucket.*not found|schema cache/i.test(message))
    return "Les photos nécessitent la mise à jour Supabase (migration 0019).";
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

async function gallery(c: Context) {
  const task = c.snapshot.tasks.find(t => t.key === c.key);
  if (!client || !task) return;
  const { data, error } = await client.from("task_photos").select("*")
    .eq("project_id", c.snapshot.projectId).eq("room_task_id", task.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const cards = await Promise.all((data || []).map(async photo => {
    const card = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = photo.needs_review ? "? À vérifier" : "Photo de suivi";
    const info = document.createElement("p");
    const author = c.snapshot.members.find(m => m.user_id === photo.uploaded_by)?.name || "Membre";
    info.textContent = author + " · " + new Date(photo.created_at).toLocaleString("fr-FR");
    const caption = document.createElement("p"); caption.textContent = photo.caption;
    card.append(title, info, caption);
    const { data: url, error: urlError } = await client!.storage.from("task-photos").createSignedUrl(photo.storage_path, 3600);
    if (url && !urlError) {
      const link = document.createElement("a"); link.href = url.signedUrl; link.target = "_blank"; link.rel = "noopener";
      const img = document.createElement("img"); img.src = url.signedUrl; img.alt = photo.caption || c.label; img.loading = "lazy";
      link.append(img); card.append(link);
    } else { const message = document.createElement("p"); message.textContent = "Photo indisponible. Rouvrez cette fenêtre pour réessayer."; card.append(message); }
    return card;
  }));
  if (context !== c) return;
  el("taskPhotoGallery").replaceChildren(...cards);
  if (!cards.length) el("taskPhotoGallery").textContent = "Aucune photo pour cette sous-tâche.";
}

export async function openTaskPhotos(c: Context, review = false, readOnly = false) {
  if (busy) return;
  context = c;
  el<HTMLFormElement>("taskPhotoForm").reset();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
  el<HTMLImageElement>("taskPhotoPreview").hidden = true;
  el("taskPhotoForm").hidden = readOnly || !editable(c.snapshot, c.userId, c.key);
  el<HTMLInputElement>("taskPhotoReview").checked = review;
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
  const needsReview = el<HTMLInputElement>("taskPhotoReview").checked;
  const caption = el<HTMLTextAreaElement>("taskPhotoCaption").value.trim();
  busy = true;
  const controls = Array.from(dialog().querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>("input, button, textarea"));
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
      storage_path: path, needs_review: needsReview, caption
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

