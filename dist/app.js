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

const suiteRooms = new Set([203, 206, 209, 210, 212, 217, 227, 235]);
const executiveRooms = new Set([214]);
const loggiaRooms = new Set([203, 206, 209, 210, 212, 214, 217, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236]);

const state = {
  selectedRoom: 203,
  selectedZone: "bathroom",
  selectedTask: "waterproofing",
  zoom: 100,
  records: loadRecords(),
};

const elements = {
  markers: document.querySelector("#markers"),
  planContent: document.querySelector("#planContent"),
  taskSelect: document.querySelector("#taskSelect"),
  summaryStrip: document.querySelector("#summaryStrip"),
  roomTitle: document.querySelector("#roomTitle"),
  roomType: document.querySelector("#roomType"),
  taskList: document.querySelector("#taskList"),
  taskEditor: document.querySelector("#taskEditor"),
  editorTaskTitle: document.querySelector("#editorTaskTitle"),
  percentOutput: document.querySelector("#percentOutput"),
  progressRange: document.querySelector("#progressRange"),
  blockedInput: document.querySelector("#blockedInput"),
  noteInput: document.querySelector("#noteInput"),
  startDateInput: document.querySelector("#startDateInput"),
  endDateInput: document.querySelector("#endDateInput"),
  zoomValue: document.querySelector("#zoomValue"),
  saveState: document.querySelector("#saveState"),
};

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function getRecord(room, zone, task) {
  return state.records[`${room}:${zone}:${task}`] || {
    progress: 0,
    blocked: false,
    note: "",
    startDate: "",
    endDate: "",
  };
}

function updateRecord(changes) {
  const key = `${state.selectedRoom}:${state.selectedZone}:${state.selectedTask}`;
  state.records[key] = { ...getRecord(state.selectedRoom, state.selectedZone, state.selectedTask), ...changes };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
  elements.saveState.textContent = "Enregistré à l'instant";
  window.setTimeout(() => { elements.saveState.textContent = "Enregistré sur cet appareil"; }, 1400);
  render();
}

function roomType(number) {
  if (executiveRooms.has(number)) return "Suite exécutive";
  if (suiteRooms.has(number)) return "Suite";
  return "Standard";
}

function statusClass(record) {
  if (!record) return "status-na";
  if (record.progress >= 100) return "status-green";
  if (record.progress > 0) return "status-orange";
  return "status-red";
}

function currentTasks() {
  return tasksByZone[state.selectedZone];
}

function normalizeTaskSelection() {
  const tasks = currentTasks();
  if (tasks.length && !tasks.some((task) => task.id === state.selectedTask)) {
    state.selectedTask = tasks[0].id;
  }
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

function renderMarkers() {
  elements.markers.innerHTML = rooms.map((room) => {
    const hasZone = state.selectedZone !== "loggia" || loggiaRooms.has(room.number);
    const record = hasZone && state.selectedTask
      ? getRecord(room.number, state.selectedZone, state.selectedTask)
      : null;
    const selected = room.number === state.selectedRoom ? " selected" : "";
    const blocked = record?.blocked ? " blocked" : "";
    const label = hasZone
      ? `Chambre ${room.number}, ${record.progress} %${record.blocked ? ", bloquée" : ""}`
      : `Chambre ${room.number}, sans loggia`;
    return `<button class="room-marker ${statusClass(record)}${selected}${blocked}" style="left:${room.x}%;top:${room.y}%" data-room="${room.number}" type="button" aria-label="${label}" title="${label}">${room.number}</button>`;
  }).join("");
}

function renderSummary() {
  const availableRooms = rooms.filter((room) => state.selectedZone !== "loggia" || loggiaRooms.has(room.number));
  const records = availableRooms.map((room) => getRecord(room.number, state.selectedZone, state.selectedTask));
  const done = records.filter((record) => record.progress >= 100).length;
  const inProgress = records.filter((record) => record.progress > 0 && record.progress < 100).length;
  const blocked = records.filter((record) => record.blocked).length;
  const notStarted = records.filter((record) => record.progress === 0).length;
  elements.summaryStrip.innerHTML = `
    <span class="summary-item"><strong>${availableRooms.length}</strong> zones</span>
    <span class="summary-item"><i class="dot done"></i><strong>${done}</strong> terminées</span>
    <span class="summary-item"><i class="dot in-progress"></i><strong>${inProgress}</strong> en cours</span>
    <span class="summary-item"><i class="dot not-started"></i><strong>${notStarted}</strong> non commencées</span>
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
      <span class="task-name">${task.label}</span>
      <span class="task-percent">${record.progress} %</span>
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
  elements.progressRange.value = record.progress;
  elements.blockedInput.checked = record.blocked;
  elements.noteInput.value = record.note;
  elements.startDateInput.value = record.startDate;
  elements.endDateInput.value = record.endDate;
}

function renderZoom() {
  elements.planContent.style.width = `${state.zoom}%`;
  elements.zoomValue.textContent = `${state.zoom} %`;
}

function render() {
  normalizeTaskSelection();
  renderZoneTabs();
  renderTaskSelect();
  renderMarkers();
  renderSummary();
  renderRoomHeading();
  renderTaskList();
  renderEditor();
  renderZoom();
}

function setZone(zone) {
  if (zone === "loggia" && !loggiaRooms.has(state.selectedRoom)) {
    const firstLoggia = rooms.find((room) => loggiaRooms.has(room.number));
    state.selectedRoom = firstLoggia.number;
  }
  state.selectedZone = zone;
  normalizeTaskSelection();
  render();
}

document.addEventListener("click", (event) => {
  const zoneButton = event.target.closest("[data-zone]");
  if (zoneButton && !zoneButton.disabled) setZone(zoneButton.dataset.zone);

  const marker = event.target.closest("[data-room]");
  if (marker) {
    state.selectedRoom = Number(marker.dataset.room);
    if (state.selectedZone === "loggia" && !loggiaRooms.has(state.selectedRoom)) state.selectedZone = "bathroom";
    render();
  }

  const taskButton = event.target.closest("[data-task]");
  if (taskButton) {
    state.selectedTask = taskButton.dataset.task;
    render();
  }

  const quickButton = event.target.closest("[data-progress]");
  if (quickButton) updateRecord({ progress: Number(quickButton.dataset.progress) });
});

elements.taskSelect.addEventListener("change", (event) => {
  state.selectedTask = event.target.value;
  render();
});

elements.progressRange.addEventListener("input", (event) => {
  elements.percentOutput.textContent = `${event.target.value} %`;
});

elements.progressRange.addEventListener("change", (event) => updateRecord({ progress: Number(event.target.value) }));
elements.blockedInput.addEventListener("change", (event) => updateRecord({ blocked: event.target.checked }));
elements.noteInput.addEventListener("change", (event) => updateRecord({ note: event.target.value.trim() }));
elements.startDateInput.addEventListener("change", (event) => updateRecord({ startDate: event.target.value }));
elements.endDateInput.addEventListener("change", (event) => updateRecord({ endDate: event.target.value }));

document.querySelector("#zoomIn").addEventListener("click", () => {
  state.zoom = Math.min(200, state.zoom + 25);
  renderZoom();
});

document.querySelector("#zoomOut").addEventListener("click", () => {
  state.zoom = Math.max(75, state.zoom - 25);
  renderZoom();
});

document.querySelector("#resetButton").addEventListener("click", () => {
  if (!window.confirm("Effacer tous les avancements enregistrés sur cet appareil ?")) return;
  state.records = {};
  localStorage.removeItem(STORAGE_KEY);
  render();
});

render();
