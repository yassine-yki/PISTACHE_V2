const STORAGE_KEY = "suivi-hotel-r2-v1";

const tasksByZone = {
  bathroom: [
    { id: "waterproofing", label: "Étanchéité SDB" },
    { id: "water-test", label: "Test de mise en eau" },
    { id: "wall-covering", label: "Revêtement mural" },
    { id: "floor-covering", label: "Revêtement de sol" },
    { id: "false-ceiling", label: "Faux plafond" },
    { id: "aluminium", label: "Menuiserie aluminium" },
    { id: "woodwork", label: "Menuiserie bois" },
  ],
  bedroom: [
    { id: "partitions", label: "Cloisons" },
    { id: "false-ceiling", label: "Faux plafond" },
    { id: "paint", label: "Peinture" },
  ],
  loggia: [],
};

const rooms = Array.from({ length: 40 }, (_, index) => ({ number: 201 + index }));
const juniorRooms = new Set([203, 206, 209, 210, 212, 217, 227, 235]);
const executiveRooms = new Set([214]);
const loggiaRooms = new Set([203, 206, 209, 210, 212, 214, 217, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236]);

const state = {
  selectedRoom: 203,
  selectedZone: "bathroom",
  selectedTask: "waterproofing",
  selectedType: "all",
  zoom: 100,
  panX: 16,
  panY: 16,
  records: loadRecords(),
};

const elements = {
  planContent: document.querySelector("#planContent"),
  planViewport: document.querySelector("#planViewport"),
  roomSelect: document.querySelector("#roomSelect"),
  dwgInput: document.querySelector("#dwgInput"),
  importStatus: document.querySelector("#importStatus"),
  taskSelect: document.querySelector("#taskSelect"),
  summaryStrip: document.querySelector("#summaryStrip"),
  roomTitle: document.querySelector("#roomTitle"),
  roomType: document.querySelector("#roomType"),
  taskList: document.querySelector("#taskList"),
  taskEditor: document.querySelector("#taskEditor"),
  editorTaskTitle: document.querySelector("#editorTaskTitle"),
  percentOutput: document.querySelector("#percentOutput"),
  percentInput: document.querySelector("#percentInput"),
  progressRange: document.querySelector("#progressRange"),
  blockedInput: document.querySelector("#blockedInput"),
  noteInput: document.querySelector("#noteInput"),
  startDateInput: document.querySelector("#startDateInput"),
  endDateInput: document.querySelector("#endDateInput"),
  zoomRange: document.querySelector("#zoomRange"),
  zoomValue: document.querySelector("#zoomValue"),
  saveState: document.querySelector("#saveState"),
};

function loadRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function getRecord(room, zone, task) {
  return state.records[`${room}:${zone}:${task}`] || { progress: 0, blocked: false, note: "", startDate: "", endDate: "" };
}

function updateRecord(changes) {
  const key = `${state.selectedRoom}:${state.selectedZone}:${state.selectedTask}`;
  state.records[key] = { ...getRecord(state.selectedRoom, state.selectedZone, state.selectedTask), ...changes };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
  elements.saveState.textContent = "Enregistré à l'instant";
  window.setTimeout(() => { elements.saveState.textContent = "Enregistré sur cet appareil"; }, 1400);
  render();
}

function updateProgress(value) {
  const progress = Math.max(0, Math.min(100, Number(value || 0)));
  const key = `${state.selectedRoom}:${state.selectedZone}:${state.selectedTask}`;
  state.records[key] = { ...getRecord(state.selectedRoom, state.selectedZone, state.selectedTask), progress };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
  elements.percentOutput.textContent = `${progress} %`;
  elements.percentInput.value = progress;
  elements.progressRange.value = progress;
  elements.saveState.textContent = "Enregistré à l'instant";
  window.setTimeout(() => { elements.saveState.textContent = "Enregistré sur cet appareil"; }, 1400);
  renderSummary();
  renderTaskList();
}

function roomTypeId(number) {
  if (executiveRooms.has(number)) return "executive";
  if (juniorRooms.has(number)) return "junior";
  return "standard";
}

function roomType(number) {
  return { executive: "Exécutive", junior: "Junior Suite", standard: "Standard" }[roomTypeId(number)];
}

function roomMatchesType(number) {
  return state.selectedType === "all" || roomTypeId(number) === state.selectedType;
}

function currentTasks() { return tasksByZone[state.selectedZone]; }

function normalizeTaskSelection() {
  const tasks = currentTasks();
  if (!tasks.length) {
    state.selectedTask = "";
    return;
  }
  if (tasks.length && !tasks.some((task) => task.id === state.selectedTask)) state.selectedTask = tasks[0].id;
}

function renderTypeTabs() {
  document.querySelectorAll("[data-type]").forEach((button) => button.classList.toggle("active", button.dataset.type === state.selectedType));
}

function renderRoomSelect() {
  const options = rooms.filter((room) => roomMatchesType(room.number));
  elements.roomSelect.innerHTML = options.map((room) => `<option value="${room.number}">${room.number} - ${roomType(room.number)}</option>`).join("");
  elements.roomSelect.value = String(state.selectedRoom);
}

function renderZoneTabs() {
  document.querySelectorAll("[data-zone]").forEach((button) => {
    const zone = button.dataset.zone;
    button.classList.toggle("active", zone === state.selectedZone);
    if (button.closest("#detailZoneTabs") && zone === "loggia") {
      button.disabled = !loggiaRooms.has(state.selectedRoom);
      button.title = button.disabled ? "Cette chambre n'a pas de loggia" : "";
    }
  });
}

function renderTaskSelect() {
  const tasks = currentTasks();
  elements.taskSelect.innerHTML = tasks.length
    ? tasks.map((task) => `<option value="${task.id}">${task.label}</option>`).join("")
    : '<option value="">Tâches à définir</option>';
  elements.taskSelect.disabled = !tasks.length;
  elements.taskSelect.value = state.selectedTask;
}

function filteredRooms() {
  return rooms.filter((room) => roomMatchesType(room.number) && (state.selectedZone !== "loggia" || loggiaRooms.has(room.number)));
}

function renderSummary() {
  const availableRooms = filteredRooms();
  if (!state.selectedTask) {
    elements.summaryStrip.innerHTML = `<span class="summary-item"><strong>${availableRooms.length}</strong> loggias</span><span class="summary-item">Tâches à définir</span>`;
    return;
  }
  const records = availableRooms.map((room) => getRecord(room.number, state.selectedZone, state.selectedTask));
  const done = records.filter((record) => record.progress >= 100).length;
  const inProgress = records.filter((record) => record.progress > 0 && record.progress < 100).length;
  const blocked = records.filter((record) => record.blocked).length;
  const notStarted = records.filter((record) => record.progress === 0).length;
  elements.summaryStrip.innerHTML = `<span class="summary-item"><strong>${availableRooms.length}</strong> chambres</span>
    <span class="summary-item"><strong>${done}</strong> terminées</span>
    <span class="summary-item"><strong>${inProgress}</strong> en cours</span>
    <span class="summary-item"><strong>${notStarted}</strong> non commencées</span>
    <span class="summary-item"><strong>${blocked}</strong> bloquées</span>`;
}

function renderRoomHeading() {
  elements.roomTitle.textContent = `Chambre ${state.selectedRoom}`;
  elements.roomType.textContent = roomType(state.selectedRoom);
}

function renderTaskList() {
  const tasks = currentTasks();
  if (!tasks.length) {
    elements.taskList.innerHTML = '<div class="empty-state">Les tâches de la loggia seront ajoutées lors de la prochaine définition.</div>';
    elements.taskEditor.hidden = true;
    return;
  }
  elements.taskEditor.hidden = false;
  elements.taskList.innerHTML = tasks.map((task) => {
    const record = getRecord(state.selectedRoom, state.selectedZone, task.id);
    const active = task.id === state.selectedTask ? " active" : "";
    const complete = record.progress >= 100 ? " complete" : "";
    return `<button class="task-row${active}" type="button" data-task="${task.id}">
      <span class="task-name">${task.label}</span><span class="task-percent">${record.progress} %</span>
      ${record.blocked ? '<span class="blocked-tag">Bloquée</span>' : ""}
      <span class="task-track"><i class="${complete}" style="width:${record.progress}%"></i></span>
    </button>`;
  }).join("");
}

function renderEditor() {
  const task = currentTasks().find((item) => item.id === state.selectedTask);
  if (!task) return;
  const record = getRecord(state.selectedRoom, state.selectedZone, state.selectedTask);
  elements.editorTaskTitle.textContent = task.label;
  elements.percentOutput.textContent = `${record.progress} %`;
  elements.percentInput.value = record.progress;
  elements.progressRange.value = record.progress;
  elements.blockedInput.checked = record.blocked;
  elements.noteInput.value = record.note;
  elements.startDateInput.value = record.startDate;
  elements.endDateInput.value = record.endDate;
}

function renderZoom() {
  elements.planContent.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom / 100})`;
  elements.zoomRange.value = state.zoom;
  elements.zoomValue.textContent = `${Math.round(state.zoom)} %`;
}

function render() {
  normalizeTaskSelection();
  renderTypeTabs();
  renderRoomSelect();
  renderZoneTabs();
  renderTaskSelect();
  renderSummary();
  renderRoomHeading();
  renderTaskList();
  renderEditor();
  renderZoom();
}

function setZone(zone) {
  if (zone === "loggia" && !loggiaRooms.has(state.selectedRoom)) {
    const firstLoggia = filteredRooms().find((room) => loggiaRooms.has(room.number)) || rooms.find((room) => loggiaRooms.has(room.number));
    state.selectedRoom = firstLoggia.number;
  }
  state.selectedZone = zone;
  normalizeTaskSelection();
  render();
}

function setType(type) {
  state.selectedType = type;
  if (!roomMatchesType(state.selectedRoom)) state.selectedRoom = rooms.find((room) => roomMatchesType(room.number)).number;
  if (state.selectedZone === "loggia" && !loggiaRooms.has(state.selectedRoom)) state.selectedZone = "bathroom";
  render();
}

function setZoom(value, anchorX = elements.planViewport.clientWidth / 2, anchorY = elements.planViewport.clientHeight / 2) {
  const oldScale = state.zoom / 100;
  const nextZoom = Math.max(50, Math.min(400, Number(value)));
  const newScale = nextZoom / 100;
  state.panX = anchorX - ((anchorX - state.panX) * newScale / oldScale);
  state.panY = anchorY - ((anchorY - state.panY) * newScale / oldScale);
  state.zoom = nextZoom;
  renderZoom();
}

function fitPlan() {
  const viewportWidth = elements.planViewport.clientWidth;
  const viewportHeight = elements.planViewport.clientHeight;
  const planWidth = Math.max(1, viewportWidth - 32);
  const planHeight = planWidth / 1.676;
  const scale = Math.min(1, (viewportWidth - 32) / planWidth, (viewportHeight - 32) / planHeight);
  state.zoom = Math.max(50, Math.floor(scale * 10) * 10);
  const fittedScale = state.zoom / 100;
  state.panX = (viewportWidth - planWidth * fittedScale) / 2;
  state.panY = (viewportHeight - planHeight * fittedScale) / 2;
  renderZoom();
}

document.addEventListener("click", (event) => {
  const typeButton = event.target.closest("[data-type]");
  if (typeButton) setType(typeButton.dataset.type);
  const zoneButton = event.target.closest("[data-zone]");
  if (zoneButton && !zoneButton.disabled) setZone(zoneButton.dataset.zone);
  const taskButton = event.target.closest("[data-task]");
  if (taskButton) { state.selectedTask = taskButton.dataset.task; render(); }
  const quickButton = event.target.closest("[data-progress]");
  if (quickButton) updateRecord({ progress: Number(quickButton.dataset.progress) });
});

elements.taskSelect.addEventListener("change", (event) => { state.selectedTask = event.target.value; render(); });
elements.roomSelect.addEventListener("change", (event) => {
  state.selectedRoom = Number(event.target.value);
  if (state.selectedZone === "loggia" && !loggiaRooms.has(state.selectedRoom)) state.selectedZone = "bathroom";
  render();
});
elements.progressRange.addEventListener("input", (event) => {
  updateProgress(event.target.value);
});
elements.percentInput.addEventListener("input", (event) => updateProgress(event.target.value));
elements.blockedInput.addEventListener("change", (event) => updateRecord({ blocked: event.target.checked }));
elements.noteInput.addEventListener("change", (event) => updateRecord({ note: event.target.value.trim() }));
elements.startDateInput.addEventListener("change", (event) => updateRecord({ startDate: event.target.value }));
elements.endDateInput.addEventListener("change", (event) => updateRecord({ endDate: event.target.value }));
document.querySelector("#zoomIn").addEventListener("click", () => setZoom(state.zoom + 25));
document.querySelector("#zoomOut").addEventListener("click", () => setZoom(state.zoom - 25));
document.querySelector("#fitPlan").addEventListener("click", fitPlan);
elements.zoomRange.addEventListener("input", (event) => setZoom(event.target.value));
elements.planViewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = elements.planViewport.getBoundingClientRect();
  setZoom(state.zoom + (event.deltaY < 0 ? 20 : -20), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });

let dragState = null;

elements.planViewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragState = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
  elements.planViewport.setPointerCapture(event.pointerId);
  elements.planViewport.classList.add("dragging");
});

elements.planViewport.addEventListener("pointermove", (event) => {
  if (!dragState) return;
  state.panX = dragState.panX + event.clientX - dragState.x;
  state.panY = dragState.panY + event.clientY - dragState.y;
  renderZoom();
});

function stopDragging(event) {
  if (!dragState) return;
  if (elements.planViewport.hasPointerCapture(event.pointerId)) elements.planViewport.releasePointerCapture(event.pointerId);
  dragState = null;
  elements.planViewport.classList.remove("dragging");
}

elements.planViewport.addEventListener("pointerup", stopDragging);
elements.planViewport.addEventListener("pointercancel", stopDragging);

elements.dwgInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const extension = file.name.split(".").pop().toLowerCase();
  elements.importStatus.classList.remove("error");

  if (!["dwg", "dxf"].includes(extension)) {
    elements.importStatus.textContent = "Format non pris en charge";
    elements.importStatus.classList.add("error");
    return;
  }

  if (extension === "dwg") {
    const header = new TextDecoder("ascii").decode(await file.slice(0, 6).arrayBuffer());
    if (!header.startsWith("AC10")) {
      elements.importStatus.textContent = "Fichier DWG non reconnu";
      elements.importStatus.classList.add("error");
      return;
    }
  }

  const metadata = {
    name: file.name,
    size: file.size,
    extension,
    layers: ["CHAMBRE", "SDB", "LOGGIA"],
  };
  localStorage.setItem("suivi-hotel-import-meta", JSON.stringify(metadata));
  elements.importStatus.textContent = `${file.name} sélectionné`;
  elements.importStatus.title = "Calques attendus : CHAMBRE, SDB, LOGGIA";
});

document.querySelector("#resetButton").addEventListener("click", () => {
  if (!window.confirm("Effacer tous les avancements enregistrés sur cet appareil ?")) return;
  state.records = {};
  localStorage.removeItem(STORAGE_KEY);
  render();
});

render();
window.requestAnimationFrame(fitPlan);
