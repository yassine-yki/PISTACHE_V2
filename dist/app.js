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

let rooms = Array.from({ length: 40 }, (_, index) => ({ number: 201 + index }));
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
  planAspect: 1.676,
  dxfModel: null,
  importedTypes: {},
  records: loadRecords(),
};

const elements = {
  planContent: document.querySelector("#planContent"),
  planViewport: document.querySelector("#planViewport"),
  dxfPlan: document.querySelector("#dxfPlan"),
  planEmpty: document.querySelector("#planEmpty"),
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

function normalizedLayer(name) {
  return String(name || "").trim().toUpperCase();
}

function cleanDxfText(value) {
  return String(value || "")
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function entityPoint(entity) {
  return entity.position || entity.startPoint || entity.vertices?.[0] || null;
}

function isPolygon(entity) {
  if (!["LWPOLYLINE", "POLYLINE"].includes(entity.type) || !entity.vertices?.length) return false;
  if (entity.shape) return true;
  const first = entity.vertices[0];
  const last = entity.vertices.at(-1);
  return Math.hypot(first.x - last.x, first.y - last.y) < 0.05;
}

function pointInPolygon(point, vertices) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const currentPoint = vertices[index];
    const previousPoint = vertices[previous];
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonCenter(vertices) {
  return vertices.reduce((center, point) => ({ x: center.x + point.x / vertices.length, y: center.y + point.y / vertices.length }), { x: 0, y: 0 });
}

function boundsFromPoints(points) {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function entityBounds(entity) {
  if (entity.vertices?.length) return boundsFromPoints(entity.vertices);
  if (entity.controlPoints?.length) return boundsFromPoints(entity.controlPoints);
  if (entity.center && Number.isFinite(entity.radius)) {
    return { minX: entity.center.x - entity.radius, maxX: entity.center.x + entity.radius, minY: entity.center.y - entity.radius, maxY: entity.center.y + entity.radius };
  }
  return null;
}

function boundsIntersect(first, second) {
  return first && first.maxX >= second.minX && first.minX <= second.maxX && first.maxY >= second.minY && first.minY <= second.maxY;
}

function numberValue(value) {
  return Number(value).toFixed(4).replace(/\.0+$/, "");
}

function pointsPath(points, close = false) {
  if (!points?.length) return "";
  return `M ${points.map((point) => `${numberValue(point.x)} ${numberValue(point.y)}`).join(" L ")}${close ? " Z" : ""}`;
}

function curvedPoints(entity) {
  const start = entity.type === "CIRCLE" ? 0 : entity.startAngle || 0;
  let length = entity.type === "CIRCLE" ? Math.PI * 2 : entity.angleLength;
  if (!Number.isFinite(length) || length <= 0) length += Math.PI * 2;
  const segments = Math.max(12, Math.ceil(Math.abs(length) / (Math.PI / 18)));
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = start + length * index / segments;
    return { x: entity.center.x + Math.cos(angle) * entity.radius, y: entity.center.y + Math.sin(angle) * entity.radius };
  });
}

function entitySvg(entity, detailBounds) {
  if (entity.inPaperSpace || !boundsIntersect(entityBounds(entity), detailBounds)) return "";
  if (entity.type === "LINE") return `<path class="dxf-detail" d="${pointsPath(entity.vertices)}" />`;
  if (["LWPOLYLINE", "POLYLINE"].includes(entity.type)) return `<path class="dxf-detail" d="${pointsPath(entity.vertices, entity.shape)}" />`;
  if (["ARC", "CIRCLE"].includes(entity.type) && entity.center) return `<path class="dxf-detail" d="${pointsPath(curvedPoints(entity), entity.type === "CIRCLE")}" />`;
  if (entity.type === "SPLINE" && entity.controlPoints?.length) return `<path class="dxf-detail" d="${pointsPath(entity.controlPoints)}" />`;
  return "";
}

function buildDxfModel(dxf) {
  const entities = (dxf.entities || []).filter((entity) => !entity.inPaperSpace);
  const roomShapes = entities.filter((entity) => normalizedLayer(entity.layer) === "CHAMBRE" && isPolygon(entity));
  const textEntities = entities
    .filter((entity) => normalizedLayer(entity.layer) === "A-AREA-IDEN" && ["TEXT", "MTEXT"].includes(entity.type))
    .map((entity) => ({ ...entity, point: entityPoint(entity), cleanText: cleanDxfText(entity.text) }))
    .filter((entity) => entity.point);
  const numberedTexts = [...new Map(textEntities.map((text) => {
    const match = text.cleanText.match(/CHAMBRE\s*[-:]?\s*(\d{3})/i);
    const number = match ? Number(match[1]) : null;
    return number >= 201 && number <= 240 ? [number, { ...text, roomNumber: number }] : [null, null];
  }).filter(([number]) => number)).values()].sort((first, second) => first.roomNumber - second.roomNumber);

  if (!numberedTexts.length) throw new Error("Aucun numéro CHAMBRE 201 à 240 trouvé dans A-AREA-IDEN");

  const rawBounds = boundsFromPoints(numberedTexts.map((text) => text.point));
  const width = rawBounds.maxX - rawBounds.minX;
  const height = rawBounds.maxY - rawBounds.minY;
  const padding = Math.max(2.5, Math.min(width, height) * 0.12);
  const detailBounds = {
    minX: rawBounds.minX - padding,
    maxX: rawBounds.maxX + padding,
    minY: rawBounds.minY - padding,
    maxY: rawBounds.maxY + padding,
  };

  const bathrooms = entities.filter((entity) => normalizedLayer(entity.layer) === "SDB" && isPolygon(entity));
  const loggias = entities.filter((entity) => normalizedLayer(entity.layer) === "LOGGIA" && isPolygon(entity));
  const typeTexts = textEntities.filter((text) => /STANDARD|JUNIOR|EXECUTIVE|EXÉCUTIVE|SUITE/i.test(text.cleanText));

  const detectedRooms = numberedTexts.map((numberText) => {
    const polygonEntity = roomShapes.find((shape) => pointInPolygon(numberText.point, shape.vertices));
    const nearestType = typeTexts
      .map((text) => ({ text, distance: Math.hypot(text.point.x - numberText.point.x, text.point.y - numberText.point.y) }))
      .sort((first, second) => first.distance - second.distance)[0];
    const polygon = polygonEntity?.vertices || null;
    return {
      number: numberText.roomNumber,
      typeText: nearestType?.distance < 2 ? nearestType.text.cleanText : "",
      polygon,
      center: polygon ? polygonCenter(polygon) : numberText.point,
      labelPoint: numberText.point,
      bathrooms: polygon ? bathrooms.filter((shape) => pointInPolygon(polygonCenter(shape.vertices), polygon)).map((shape) => shape.vertices) : [],
      loggias: polygon ? loggias.filter((shape) => pointInPolygon(polygonCenter(shape.vertices), polygon)).map((shape) => shape.vertices) : [],
    };
  });

  const architecture = entities.map((entity) => entitySvg(entity, detailBounds)).join("");
  return { dxf, rooms: detectedRooms, bounds: detailBounds, architecture };
}

function renderDxfBase() {
  const model = state.dxfModel;
  if (!model) return;
  const width = model.bounds.maxX - model.bounds.minX;
  const height = model.bounds.maxY - model.bounds.minY;
  state.planAspect = width / height;
  elements.planContent.style.setProperty("--plan-aspect", state.planAspect);
  elements.dxfPlan.setAttribute("viewBox", `${numberValue(model.bounds.minX)} ${numberValue(-model.bounds.maxY)} ${numberValue(width)} ${numberValue(height)}`);
  const labelSize = Math.max(0.32, Math.min(0.55, height * 0.012));
  const labels = model.rooms.map((room) => `<text class="dxf-label" x="${numberValue(room.labelPoint.x)}" y="${numberValue(-room.labelPoint.y)}" font-size="${numberValue(labelSize)}" text-anchor="middle">${room.number}</text>`).join("");
  elements.dxfPlan.innerHTML = `<g transform="scale(1 -1)">${model.architecture}</g><g id="dxfZoneLayer" transform="scale(1 -1)"></g><g>${labels}</g>`;
  elements.planEmpty.hidden = true;
}

function statusClass(record) {
  if (record.blocked) return "status-blocked";
  if (record.progress >= 100) return "status-done";
  if (record.progress > 0) return "status-in-progress";
  return "status-not-started";
}

function renderDxfZones() {
  const model = state.dxfModel;
  const layer = document.querySelector("#dxfZoneLayer");
  if (!model || !layer) return;
  layer.innerHTML = model.rooms.map((room) => {
    const task = state.selectedTask || currentTasks()[0]?.id;
    const record = task ? getRecord(room.number, state.selectedZone, task) : { progress: 0, blocked: false };
    const activeClass = room.number === state.selectedRoom ? " selected" : "";
    let paths = [];
    if (state.selectedZone === "bathroom") paths = room.bathrooms.map((polygon) => pointsPath(polygon, true));
    if (state.selectedZone === "loggia") paths = room.loggias.map((polygon) => pointsPath(polygon, true));
    if (state.selectedZone === "bedroom" && room.polygon) paths = [`${pointsPath(room.polygon, true)} ${[...room.bathrooms, ...room.loggias].map((polygon) => pointsPath(polygon, true)).join(" ")}`];
    return paths.map((path) => `<path class="dxf-zone ${statusClass(record)}${activeClass}" data-room="${room.number}" d="${path}" fill-rule="evenodd"><title>Chambre ${room.number}</title></path>`).join("");
  }).join("");
}

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
  renderDxfZones();
}

function roomTypeId(number) {
  const importedType = state.importedTypes[number] || "";
  if (/EXECUTIVE|EXÉCUTIVE/i.test(importedType)) return "executive";
  if (/JUNIOR|SUITE/i.test(importedType)) return "junior";
  if (/STANDARD/i.test(importedType)) return "standard";
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
  document.querySelectorAll("[data-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.type === state.selectedType);
    button.disabled = button.dataset.type !== "all" && !rooms.some((room) => roomTypeId(room.number) === button.dataset.type);
  });
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
  renderDxfZones();
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
  if (type !== "all" && !rooms.some((room) => roomTypeId(room.number) === type)) return;
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
  const planHeight = planWidth / state.planAspect;
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
  const roomShape = event.target.closest("[data-room]");
  if (roomShape) {
    state.selectedRoom = Number(roomShape.dataset.room);
    render();
  }
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

  if (extension !== "dxf") {
    elements.importStatus.textContent = "Utilisez un fichier DXF";
    elements.importStatus.classList.add("error");
    return;
  }

  elements.importStatus.textContent = "Analyse du DXF...";
  await new Promise((resolve) => window.setTimeout(resolve, 20));

  try {
    const parser = new window.DxfParser();
    const dxf = parser.parseSync(await file.text());
    const model = buildDxfModel(dxf);
    state.dxfModel = model;
    state.importedTypes = Object.fromEntries(model.rooms.map((room) => [room.number, room.typeText]));
    rooms = model.rooms.map((room) => ({ number: room.number }));
    loggiaRooms.clear();
    model.rooms.filter((room) => room.loggias.length).forEach((room) => loggiaRooms.add(room.number));
    state.selectedRoom = rooms[0].number;
    state.selectedType = "all";
    if (state.selectedZone === "loggia" && !loggiaRooms.has(state.selectedRoom)) state.selectedZone = "bathroom";
    renderDxfBase();
    render();
    window.requestAnimationFrame(fitPlan);

    const bathroomCount = model.rooms.reduce((count, room) => count + room.bathrooms.length, 0);
    const loggiaCount = model.rooms.reduce((count, room) => count + room.loggias.length, 0);
    const metadata = { name: file.name, size: file.size, extension, rooms: model.rooms.length, bathroomCount, loggiaCount };
    localStorage.setItem("suivi-hotel-import-meta", JSON.stringify(metadata));
    elements.importStatus.textContent = `${model.rooms.length} chambres chargées`;
    elements.importStatus.title = `${file.name} - ${bathroomCount} SDB - ${loggiaCount} loggias associées`;
  } catch (error) {
    console.error(error);
    elements.importStatus.textContent = error.message || "DXF illisible";
    elements.importStatus.classList.add("error");
  }
});

document.querySelector("#resetButton").addEventListener("click", () => {
  if (!window.confirm("Effacer tous les avancements enregistrés sur cet appareil ?")) return;
  state.records = {};
  localStorage.removeItem(STORAGE_KEY);
  render();
});

render();
window.requestAnimationFrame(fitPlan);
