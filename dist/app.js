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

const rooms = [
  [201, 20.42, 83.15], [202, 23.93, 83.15], [203, 26.98, 83.15], [204, 33.39, 83.15],
  [205, 36.67, 83.15], [206, 39.84, 83.15], [207, 45.45, 83.15], [208, 48.69, 83.15],
  [209, 51.76, 83.15], [210, 59.85, 83.15], [211, 63.04, 84.03], [212, 69.27, 82.18],
  [213, 72.97, 82.09], [214, 82.28, 81.15], [215, 81.12, 68.31], [216, 80.49, 61.75],
  [217, 78.91, 54.46], [218, 37.33, 62.52], [219, 41.52, 62.52], [220, 45.45, 62.52],
  [221, 49.56, 62.52], [222, 53.48, 62.52], [223, 58.36, 53.35], [224, 58.36, 47.36],
  [225, 58.16, 40.01], [226, 58.16, 33.49], [227, 61.32, 16.70], [228, 57.55, 16.70],
  [229, 53.88, 16.70], [230, 50.63, 16.70], [231, 47.11, 16.70], [232, 43.76, 16.70],
  [233, 40.45, 16.70], [234, 37.25, 16.68], [235, 33.18, 14.70], [236, 26.80, 17.39],
  [237, 31.36, 33.49], [238, 31.28, 40.01], [239, 31.42, 46.83], [240, 31.35, 53.44],
].map(([number, x, y]) => ({ number, x, y }));

const roomByNumber = new Map(rooms.map((room) => [room.number, room]));
const juniorRooms = new Set([203, 206, 209, 210, 212, 217, 227, 235]);
const executiveRooms = new Set([214]);
const loggiaRooms = new Set([203, 206, 209, 210, 212, 214, 217, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236]);

const crop = { x0: 17, x1: 86.5, y0: 4, y1: 92 };
const toX = (value) => ((value - crop.x0) / (crop.x1 - crop.x0)) * 100;
const toY = (value) => ((value - crop.y0) / (crop.y1 - crop.y0)) * 100;
const toW = (value) => (value / (crop.x1 - crop.x0)) * 100;
const toH = (value) => (value / (crop.y1 - crop.y0)) * 100;

function makeRow(numbers, leftEdge, rightEdge, top, bottom, orientation) {
  const centers = numbers.map((number) => roomByNumber.get(number).x);
  return numbers.map((number, index) => {
    const left = index === 0 ? leftEdge : (centers[index - 1] + centers[index]) / 2;
    const right = index === numbers.length - 1 ? rightEdge : (centers[index] + centers[index + 1]) / 2;
    return [number, { x: toX(left), y: toY(top), w: toW(right - left), h: toH(bottom - top), orientation, angle: 0 }];
  });
}

function makeColumn(numbers, topEdge, bottomEdge, left, right, orientation) {
  const centers = numbers.map((number) => roomByNumber.get(number).y);
  return numbers.map((number, index) => {
    const top = index === 0 ? topEdge : (centers[index - 1] + centers[index]) / 2;
    const bottom = index === numbers.length - 1 ? bottomEdge : (centers[index] + centers[index + 1]) / 2;
    return [number, { x: toX(left), y: toY(top), w: toW(right - left), h: toH(bottom - top), orientation, angle: 0 }];
  });
}

const roomLayouts = new Map([
  ...makeRow([201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213], 18.4, 75.0, 72.4, 91.4, "south"),
  ...makeRow([236, 235, 234, 233, 232, 231, 230, 229, 228, 227], 24.2, 63.5, 5.0, 27.1, "north"),
  ...makeRow([218, 219, 220, 221, 222], 35.0, 55.4, 56.4, 69.5, "north"),
  ...makeColumn([237, 238, 239, 240], 29.2, 57.2, 26.0, 36.4, "east"),
  ...makeColumn([226, 225, 224, 223], 29.2, 57.2, 54.9, 62.9, "west"),
  [217, { x: toX(73.4), y: toY(47.0), w: toW(11.2), h: toH(13.2), orientation: "south", angle: 8 }],
  [216, { x: toX(75.2), y: toY(56.2), w: toW(10.4), h: toH(11.5), orientation: "south", angle: 10 }],
  [215, { x: toX(76.0), y: toY(64.0), w: toW(10.1), h: toH(11.5), orientation: "south", angle: 11 }],
  [214, { x: toX(75.3), y: toY(72.0), w: toW(11.4), h: toH(19.0), orientation: "south", angle: 12 }],
]);

const state = {
  selectedRoom: 203,
  selectedZone: "bathroom",
  selectedTask: "waterproofing",
  selectedType: "all",
  zoom: 100,
  records: loadRecords(),
};

const elements = {
  roomZones: document.querySelector("#roomZones"),
  planContent: document.querySelector("#planContent"),
  planViewport: document.querySelector("#planViewport"),
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
  renderRoomZones();
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

function statusClass(record) {
  if (!record) return "status-na";
  if (record.progress >= 100) return "status-green";
  if (record.progress > 0) return "status-orange";
  return "status-red";
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

function zonePart(zone, label, record) {
  const active = zone === state.selectedZone;
  const classes = ["zone-part", zone, active ? "active-zone" : "", active ? statusClass(record) : ""];
  return `<span class="${classes.filter(Boolean).join(" ")}"><small class="zone-label">${label}</small></span>`;
}

function renderRoomZones() {
  elements.roomZones.innerHTML = rooms.map((room) => {
    const layout = roomLayouts.get(room.number);
    if (!layout) return "";
    const hasLoggia = loggiaRooms.has(room.number);
    const hasSelectedZone = state.selectedZone !== "loggia" || hasLoggia;
    const record = hasSelectedZone && state.selectedTask ? getRecord(room.number, state.selectedZone, state.selectedTask) : null;
    const classes = ["room-boundary", layout.orientation, hasLoggia ? "has-loggia" : "", room.number === state.selectedRoom ? "selected" : "", roomMatchesType(room.number) ? "" : "filtered-out", hasSelectedZone ? "" : "zone-unavailable", record?.blocked ? "blocked" : ""];
    const label = hasSelectedZone
      ? `Chambre ${room.number}, ${roomType(room.number)}, ${record?.progress ?? 0} %${record?.blocked ? ", bloquée" : ""}`
      : `Chambre ${room.number}, ${roomType(room.number)}, sans loggia`;
    const style = `left:${layout.x}%;top:${layout.y}%;width:${layout.w}%;height:${layout.h}%;transform:rotate(${layout.angle}deg)`;
    return `<button class="${classes.filter(Boolean).join(" ")}" style="${style}" data-room="${room.number}" type="button" aria-label="${label}" title="${label}">
      ${zonePart("bathroom", "SDB", state.selectedZone === "bathroom" ? record : null)}
      ${zonePart("bedroom", "CH", state.selectedZone === "bedroom" ? record : null)}
      ${hasLoggia ? zonePart("loggia", "LG", state.selectedZone === "loggia" ? record : null) : ""}
      <span class="room-number">${room.number}</span>
    </button>`;
  }).join("");
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
  elements.planContent.style.width = `${state.zoom}%`;
  elements.zoomRange.value = state.zoom;
  elements.zoomValue.textContent = `${state.zoom} %`;
}

function render() {
  normalizeTaskSelection();
  renderTypeTabs();
  renderZoneTabs();
  renderTaskSelect();
  renderRoomZones();
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

function setZoom(value) {
  state.zoom = Math.max(50, Math.min(250, Number(value)));
  renderZoom();
}

function fitPlan() {
  const availableWidth = Math.max(1, elements.planViewport.clientWidth - 32);
  const availableHeight = Math.max(1, elements.planViewport.clientHeight - 32);
  const planHeightAtFullWidth = availableWidth / 1.676;
  const fittedZoom = Math.floor(Math.min(100, availableHeight / planHeightAtFullWidth * 100) / 10) * 10;
  setZoom(Math.max(50, fittedZoom));
  elements.planViewport.scrollTo({ top: 0, left: 0 });
}

document.addEventListener("click", (event) => {
  const typeButton = event.target.closest("[data-type]");
  if (typeButton) setType(typeButton.dataset.type);
  const zoneButton = event.target.closest("[data-zone]");
  if (zoneButton && !zoneButton.disabled) setZone(zoneButton.dataset.zone);
  const roomShape = event.target.closest("[data-room]");
  if (roomShape) {
    state.selectedRoom = Number(roomShape.dataset.room);
    if (state.selectedZone === "loggia" && !loggiaRooms.has(state.selectedRoom)) state.selectedZone = "bathroom";
    render();
  }
  const taskButton = event.target.closest("[data-task]");
  if (taskButton) { state.selectedTask = taskButton.dataset.task; render(); }
  const quickButton = event.target.closest("[data-progress]");
  if (quickButton) updateRecord({ progress: Number(quickButton.dataset.progress) });
});

elements.taskSelect.addEventListener("change", (event) => { state.selectedTask = event.target.value; render(); });
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
  if (!event.ctrlKey) return;
  event.preventDefault();
  setZoom(state.zoom + (event.deltaY < 0 ? 25 : -25));
}, { passive: false });

document.querySelector("#resetButton").addEventListener("click", () => {
  if (!window.confirm("Effacer tous les avancements enregistrés sur cet appareil ?")) return;
  state.records = {};
  localStorage.removeItem(STORAGE_KEY);
  render();
});

render();
window.requestAnimationFrame(fitPlan);
