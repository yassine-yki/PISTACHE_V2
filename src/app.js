import { CURRENT_FLOOR, emptyProject, projectDay, lockedProgress, taskGroup, tasksByZone } from "./model.js";
import { cleanDxfText, roomNumberFromText } from "./dxf-identification.js";
import { createProjectRepository } from "./repositories/index.js";
import { R2_ROOMS } from "./project-data.js";
import { PROJECT_CATALOG } from "./project-catalog.js";
import { cloudConfigured, login, logout, restoreWorkspace, resendConfirmation } from "./cloud/workspace.js";
import { editable } from "./cloud/types.js";



let activeProjectDefinition = null;
let projectRepository = null;
let project = emptyProject();
let saveQueue = Promise.resolve();
const guestModeKey = "pistache-guest-mode";
const localMode = !cloudConfigured || sessionStorage.getItem(guestModeKey) === "true";
let cloud = null;
let synchronizing = false;
let currentUser = null;
let accessReady = false;
let saving = false;
let adminPage = "dashboard";
let registrationMode = false;

function persistProject(key, correction = null, previousRecord = null) {
  if (!projectRepository && !cloud) return Promise.resolve();
  if(localMode) { if(!previousRecord?.draft && previousRecord) state.records[key].draftBefore={...previousRecord};state.records[key].draftJustified=Boolean(correction)||(state.records[key].draft&&state.records[key].draftJustified);state.records[key].draft=true; }
  const record = { ...state.records[key] };
  saving = true;
  document.querySelector("#saveStatus").textContent = "Enregistrement sur cet appareil…";
  saveQueue = saveQueue.then(async () => {
    if (localMode) {
      await projectRepository.save(project);
      document.querySelector("#saveStatus").textContent="Brouillon enregistré sur cet appareil — non partagé";
    } else {
      project=await cloud.enqueue(key,record,correction,previousRecord);
      state.records=project.floors[CURRENT_FLOOR].records;
      await renderSync();
    }
  }).catch(error => {
    if(previousRecord) state.records[key]=previousRecord;
    document.querySelector("#saveStatus").textContent="Non enregistré : "+error.message;
    state.progressRuleMessage=error.message;
  }).finally(()=>{saving=false;render();if(!localMode)queueMicrotask(()=>void syncCloud());});
  return saveQueue;
}

const roomDefinitions = new Map(R2_ROOMS.map((room) => [room.number, room]));
let rooms = R2_ROOMS;
const loggiaRooms = new Set([203, 206, 209, 210, 212, 214, 217, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236]);

const state = {
  selectedRoom: 203,
  selectedZone: "bedroom",
  selectedTask: "partitions",
  selectedType: "all",
  selectedBlock: "all",
  taskQuery: "",
  correctionAuthorization: null,
  correctionPanelOpen: false,
  progressRuleMessage: "",
  zoom: 100,
  panX: 16,
  panY: 16,
  planAspect: 1.676,
  dxfModel: null,
  importedTypes: {},
  records: project.floors[CURRENT_FLOOR].records,
};

const elements = {
  planContent: document.querySelector("#planContent"),
  planViewport: document.querySelector("#planViewport"),
  dxfPlan: document.querySelector("#dxfPlan"),
  planEmpty: document.querySelector("#planEmpty"),
  roomSelect: document.querySelector("#roomSelect"),
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
  projectDialog: document.querySelector("#projectDialog"),
  projectList: document.querySelector("#projectList"),
  projectSubtitle: document.querySelector("#projectSubtitle"),
  taskSearch: document.querySelector("#taskSearch"),
  taskLock: document.querySelector("#taskLock"),
  correctionTrigger: document.querySelector("#correctionTrigger"),
  correctionPanel: document.querySelector("#correctionPanel"),
  correctionReason: document.querySelector("#correctionReason"),
  correctionNote: document.querySelector("#correctionNote"),
  correctionError: document.querySelector("#correctionError"),
  authorizeCorrection: document.querySelector("#authorizeCorrection"),
  cancelCorrection: document.querySelector("#cancelCorrection"),
  correctionAuthorized: document.querySelector("#correctionAuthorized"),
  correctionHistory: document.querySelector("#correctionHistory"),
  progressRuleMessage: document.querySelector("#progressRuleMessage"),
};

function normalizedLayer(name) {
  return String(name || "").trim().toUpperCase();
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

function entitySvg(entity, detailBounds, blocks, ancestors = []) {
  if (entity.inPaperSpace) return "";
  if (entity.type === "INSERT" || entity.type === "DIMENSION") {
    const name = entity.type === "INSERT" ? entity.name : entity.block;
    const block = blocks[name];
    if (!block || ancestors.includes(name) || ancestors.length >= 8) return "";
    const content = (block.entities || []).map((part) => entitySvg(part, null, blocks, [...ancestors, name])).join("");
    if (!content) return "";
    if (entity.type === "DIMENSION") return `<g>${content}</g>`;
    const position = entity.position || { x: 0, y: 0 };
    const base = block.position || { x: 0, y: 0 };
    const mirror = entity.extrusionDirection?.z < 0 ? "scale(-1 1) " : "";
    const transform = `${mirror}translate(${numberValue(position.x)} ${numberValue(position.y)}) rotate(${numberValue(entity.rotation || 0)}) scale(${numberValue(entity.xScale || 1)} ${numberValue(entity.yScale || 1)}) translate(${numberValue(-base.x)} ${numberValue(-base.y)})`;
    return `<g transform="${transform}">${content}</g>`;
  }
  if (detailBounds && !boundsIntersect(entityBounds(entity), detailBounds)) return "";
  if (entity.type === "LINE") return `<path class="dxf-detail" d="${pointsPath(entity.vertices)}" />`;
  if (["LWPOLYLINE", "POLYLINE"].includes(entity.type)) return `<path class="dxf-detail" d="${pointsPath(entity.vertices, entity.shape)}" />`;
  if (["ARC", "CIRCLE"].includes(entity.type) && entity.center) return `<path class="dxf-detail" d="${pointsPath(curvedPoints(entity), entity.type === "CIRCLE")}" />`;
  if (entity.type === "SPLINE" && entity.controlPoints?.length) return `<path class="dxf-detail" d="${pointsPath(entity.controlPoints)}" />`;
  return "";
}

function layoutViewBounds(source) {
  const viewports = [...source.matchAll(/(?:^|\r?\n)\s*0\r?\nVIEWPORT\r?\n([\s\S]*?)(?=\r?\n\s*0\r?\n)/g)];
  for (const viewport of viewports) {
    const lines = viewport[1].split(/\r?\n/);
    const groups = new Map();
    for (let index = 0; index + 1 < lines.length; index += 2) {
      groups.set(Number(lines[index].trim()), Number(lines[index + 1].trim()));
    }
    const paperWidth = groups.get(40);
    const paperHeight = groups.get(41);
    const viewHeight = groups.get(45);
    const centerX = groups.get(12);
    const centerY = groups.get(22);
    if (groups.get(67) !== 1 || groups.get(69) <= 1 || !paperWidth || !paperHeight || !viewHeight || !Number.isFinite(centerX) || !Number.isFinite(centerY)) continue;
    if (Math.abs(groups.get(51) || 0) > 0.001) continue;
    const viewWidth = viewHeight * paperWidth / paperHeight;
    return {
      minX: centerX - viewWidth / 2,
      maxX: centerX + viewWidth / 2,
      minY: centerY - viewHeight / 2,
      maxY: centerY + viewHeight / 2,
    };
  }
  return null;
}

function buildDxfModel(dxf, layoutBounds = null) {
  const entities = (dxf.entities || []).filter((entity) => !entity.inPaperSpace);
  const roomShapes = entities.filter((entity) => normalizedLayer(entity.layer) === "CHAMBRE" && isPolygon(entity));
  const textEntities = entities
    .filter((entity) => normalizedLayer(entity.layer) === "A-AREA-IDEN" && ["TEXT", "MTEXT"].includes(entity.type))
    .map((entity) => ({ ...entity, point: entityPoint(entity), cleanText: cleanDxfText(entity.text) }))
    .filter((entity) => entity.point);
  const numberedTexts = [...new Map(textEntities.map((text) => {
    const number = roomNumberFromText(text.cleanText);
    return number >= 201 && number <= 240 ? [number, { ...text, roomNumber: number }] : [null, null];
  }).filter(([number]) => number)).values()].sort((first, second) => first.roomNumber - second.roomNumber);

  if (!numberedTexts.length) throw new Error("Aucun numéro CHAMBRE 201 à 240 trouvé dans A-AREA-IDEN");

  const rawBounds = boundsFromPoints(numberedTexts.map((text) => text.point));
  const width = rawBounds.maxX - rawBounds.minX;
  const height = rawBounds.maxY - rawBounds.minY;
  const padding = Math.max(2.5, Math.min(width, height) * 0.12);
  const labelBounds = {
    minX: rawBounds.minX - padding,
    maxX: rawBounds.maxX + padding,
    minY: rawBounds.minY - padding,
    maxY: rawBounds.maxY + padding,
  };
  const detailBounds = layoutBounds || labelBounds;

  const bathrooms = entities.filter((entity) => normalizedLayer(entity.layer) === "SDB" && isPolygon(entity));
  const loggias = entities.filter((entity) => normalizedLayer(entity.layer) === "LOGGIA" && isPolygon(entity));
  const loggiaLabels = entities
    .filter((entity) => ["A-AREA-IDEN", "LOGGIA"].includes(normalizedLayer(entity.layer)) && ["TEXT", "MTEXT"].includes(entity.type))
    .map((entity) => {
      const label = cleanDxfText(entity.text);
      const match = label.match(/^(?:(?:CHAMBRE|LOGGIA)\s*[-:]?\s*)?(\d{3})(?!\d)(?:$|\^J|\\P)/i);
      return { point: entityPoint(entity), number: match ? Number(match[1]) : null };
    })
    .filter((label) => label.point && label.number >= 201 && label.number <= 240);
  const loggiaItems = loggias.map((shape) => {
    const numbers = [...new Set(loggiaLabels.filter((label) => pointInPolygon(label.point, shape.vertices)).map((label) => label.number))];
    return { polygon: shape.vertices, number: numbers.length === 1 ? numbers[0] : null, center: polygonCenter(shape.vertices) };
  });
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

  const architecture = entities.map((entity) => entitySvg(entity, detailBounds, dxf.blocks || {})).join("");
  const annotations = textEntities
    .filter((entity) => boundsIntersect({ minX: entity.point.x, maxX: entity.point.x, minY: entity.point.y, maxY: entity.point.y }, detailBounds))
    .filter((entity) => !/^(?:CHAMBRE|LOGGIA)\s*\d{3}/i.test(entity.cleanText))
    .map((entity) => `<text class="dxf-annotation" x="${numberValue(entity.point.x)}" y="${numberValue(-entity.point.y)}" font-size="${numberValue(Math.max(0.32, entity.height || 0.2))}">${escapeSvgText(entity.cleanText)}</text>`).join("");
  return { dxf, rooms: detectedRooms, loggias: loggiaItems, bounds: detailBounds, architecture, annotations };
}

function escapeSvgText(value) {
  return String(value).replace(/\^J/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  const labels = model.rooms.map((room) => {
    const x = numberValue(room.labelPoint.x);
    const y = numberValue(-room.labelPoint.y);
    return `<g class="dxf-room-marker" data-room-marker data-room="${room.number}" role="button" tabindex="0" aria-label="Chambre ${room.number}">
      <circle class="dxf-room-hit" cx="${x}" cy="${y}" r="${numberValue(labelSize * 1.8)}" />
      <text class="dxf-label" x="${x}" y="${y}" font-size="${numberValue(labelSize)}" text-anchor="middle">${room.number}</text>
      <title>Chambre ${room.number}</title>
    </g>`;
  }).join("");
  elements.dxfPlan.innerHTML = `<g transform="scale(1 -1)">${model.architecture}</g><g id="dxfZoneLayer" transform="scale(1 -1)"></g><g>${model.annotations}${labels}</g><g id="dxfZoneLabels"></g>`;
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
  const labelLayer = document.querySelector("#dxfZoneLabels");
  if (!model || !layer || !labelLayer) return;
  if (state.selectedZone === "loggia") {
    layer.innerHTML = model.loggias.map((loggia) => {
      const assigned = loggia.number !== null;
      const task = state.selectedTask;
      const record = assigned && task ? getRecord(loggia.number, "loggia", task) : null;
      const zoneClass = (state.selectedType !== "all" || state.selectedBlock !== "all") && (!assigned || !roomMatchesFilters(loggia.number))
        ? "filtered-out" : record ? statusClass(record) : "unassigned";
      const selectedClass = assigned && loggia.number === state.selectedRoom ? " selected" : "";
      const roomAttribute = assigned ? ` data-room="${loggia.number}"` : "";
      const label = assigned ? `Loggia de la chambre ${loggia.number}` : "Loggia non attribuée";
      return `<path class="dxf-zone ${zoneClass}${selectedClass}"${roomAttribute} d="${pointsPath(loggia.polygon, true)}"><title>${label}</title></path>`;
    }).join("");
    const height = model.bounds.maxY - model.bounds.minY;
    const labelSize = Math.max(0.32, Math.min(0.55, height * 0.012));
    labelLayer.innerHTML = model.loggias.filter((loggia) => loggia.number !== null).map((loggia) =>
      `<text class="dxf-loggia-label${roomMatchesFilters(loggia.number) ? "" : " filtered-out"}" x="${numberValue(loggia.center.x)}" y="${numberValue(-loggia.center.y)}" font-size="${numberValue(labelSize)}" text-anchor="middle">${loggia.number}</text>`).join("");
    return;
  }
  labelLayer.innerHTML = "";
  layer.innerHTML = model.rooms.map((room) => {
    const task = state.selectedTask || currentTasks()[0]?.id;
    const record = task ? getRecord(room.number, state.selectedZone, task) : { progress: 0, blocked: false };
    const activeClass = room.number === state.selectedRoom ? " selected" : "";
    let paths = [];
    if (state.selectedZone === "bathroom") paths = room.bathrooms.map((polygon) => pointsPath(polygon, true));
    if (state.selectedZone === "bedroom" && room.polygon) paths = [`${pointsPath(room.polygon, true)} ${[...room.bathrooms, ...room.loggias].map((polygon) => pointsPath(polygon, true)).join(" ")}`];
    const zoneClass = roomMatchesFilters(room.number) ? statusClass(record) : "filtered-out";
    return paths.map((path) => `<path class="dxf-zone ${zoneClass}${activeClass}" data-room="${room.number}" d="${path}" fill-rule="evenodd"><title>Chambre ${room.number}</title></path>`).join("");
  }).join("");
}

function getRecord(room, zone, task) {
  return state.records[`${room}:${zone}:${task}`] || { progress: 0, blocked: false, note: "", startDate: "", endDate: "" };
}

function resetCorrectionState() {
  state.correctionAuthorization = null;
  state.correctionPanelOpen = false;
  state.progressRuleMessage = "";
  elements.correctionReason.value = "";
  elements.correctionNote.value = "";
  elements.correctionError.hidden = true;
}

function updateRecord(changes) {
  if (!canEditSelectedRoom() || saving) return;
  const key = `${state.selectedRoom}:${state.selectedZone}:${state.selectedTask}`;
  const current = getRecord(state.selectedRoom, state.selectedZone, state.selectedTask);
  state.records[key] = { ...current, ...changes };
  void persistProject(key, state.correctionAuthorization, current);
  render();
}

function updateProgress(value) {
  if (!canEditSelectedRoom() || saving) return;
  const progress = Math.max(0, Math.min(100, Number(value || 0)));
  const key = `${state.selectedRoom}:${state.selectedZone}:${state.selectedTask}`;
  const current = getRecord(state.selectedRoom, state.selectedZone, state.selectedTask);
  if (progress < lockedProgress(current) && !state.correctionAuthorization) {
    state.progressRuleMessage = current.progress >= 100
      ? "Une valeur validée un jour précédent nécessite une justification pour être diminuée."
      : "Cette diminution passe sous l’avancement validé un jour précédent. Justifiez la correction.";
    renderEditor();
    return;
  }
  const correction = progress < current.progress && state.correctionAuthorization ? {
    lastCorrectionReason: state.correctionAuthorization.reason,
    lastCorrectionNote: state.correctionAuthorization.note,
    correctedAt: new Date().toISOString(),
  } : {};
  state.records[key] = { ...current, ...correction, progress };
  const authorization = state.correctionAuthorization;
  if (progress < current.progress || progress >= 100) resetCorrectionState();
  else state.progressRuleMessage = "";
  void persistProject(key, authorization, current);
  elements.percentOutput.textContent = `${progress} %`;
  elements.percentInput.value = progress;
  elements.progressRange.value = progress;
  renderSummary();
  renderTaskList();
  renderDxfZones();
  renderEditor();
}

function roomAccessible(number) {
  const room=rooms.find(r=>r.number===number);
  if(!accessReady || !room)return false;
  if(localMode || currentUser?.role==="admin" || currentUser?.role==="viewer")return true;
  return cloud?.snapshot?.tasks.some(t=>t.key.startsWith(number+":") && editable(cloud.snapshot,currentUser.id,t.key)) || false;
}

function canEditSelectedRoom() {
  if(localMode)return true;
  return Boolean(cloud?.snapshot && editable(cloud.snapshot,currentUser?.id,
    state.selectedRoom+":"+state.selectedZone+":"+state.selectedTask,Boolean(state.correctionAuthorization)));
}

function roomTypeId(number) {
  const configuredType = rooms.find((room) => room.number === number)?.roomType;
  if (configuredType) return configuredType;
  const importedType = state.importedTypes[number] || "";
  if (/EXECUTIVE|EXÉCUTIVE/i.test(importedType)) return "executive";
  if (/JUNIOR|SUITE/i.test(importedType)) return "junior";
  if (/STANDARD/i.test(importedType)) return "standard";
  return "standard";
}

function roomType(number) {
  return { executive: "Exécutive", junior: "Junior Suite", standard: "Standard" }[roomTypeId(number)];
}

function roomMatchesType(number) {
  return state.selectedType === "all" || roomTypeId(number) === state.selectedType;
}

function roomMatchesBlock(number) {
  const blockId = rooms.find((room) => room.number === number)?.blockId;
  return state.selectedBlock === "all" || blockId === state.selectedBlock;
}

function roomMatchesFilters(number) {
  return roomAccessible(number) && roomMatchesType(number) && roomMatchesBlock(number);
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
    button.classList.toggle("filtered-out", state.selectedType !== "all" && button.dataset.type !== "all" && button.dataset.type !== state.selectedType);
    button.disabled = button.dataset.type !== "all" && !rooms.some((room) => roomMatchesBlock(room.number) && roomTypeId(room.number) === button.dataset.type);
  });
}

function renderBlockTabs() {
  document.querySelectorAll("[data-block]").forEach((button) => {
    button.classList.toggle("active", button.dataset.block === state.selectedBlock);
    button.classList.toggle("filtered-out", state.selectedBlock !== "all" && button.dataset.block !== "all" && button.dataset.block !== state.selectedBlock);
    button.disabled = (button.dataset.block !== "all" && !rooms.some((room) => room.blockId === button.dataset.block && roomMatchesType(room.number)));
  });
}

function renderRoomSelect() {
  const options = rooms.filter((room) => roomMatchesFilters(room.number));
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
  const groups = new Map();
  for (const task of tasks) {
    const group = taskGroup(state.selectedZone, task.sourceColumn);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(task);
  }
  elements.taskSelect.innerHTML = tasks.length ? [...groups.entries()].map(([group, groupTasks]) =>
    `<optgroup label="${group}">${groupTasks.map((task) => `<option value="${task.id}">${task.label}</option>`).join("")}</optgroup>`).join("")
    : '<option value="">Tâches à définir</option>';
  elements.taskSelect.disabled = !tasks.length;
  elements.taskSelect.value = state.selectedTask;
}

function filteredRooms() {
  return rooms.filter((room) => roomMatchesFilters(room.number) && (state.selectedZone !== "loggia" || loggiaRooms.has(room.number)));
}

function renderSummary() {
  const availableRooms = filteredRooms();
  const records = availableRooms.map((room) => getRecord(room.number, state.selectedZone, state.selectedTask));
  const done = records.filter((record) => record.progress >= 100).length;
  const inProgress = records.filter((record) => record.progress > 0 && record.progress < 100).length;
  const blocked = records.filter((record) => record.blocked).length;
  const notStarted = records.filter((record) => record.progress === 0).length;
  elements.summaryStrip.innerHTML = `<span class="summary-item"><strong>${availableRooms.length}</strong> ${state.selectedZone === "loggia" ? "loggias" : "chambres"}</span>
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
  // Keep the existing editor and its event listeners when rebuilding task rows.
  elements.taskList.after(elements.taskEditor);
  const expandedGroups=new Set([...elements.taskList.querySelectorAll("details[open]")].map(group=>group.dataset.group));
  if (!roomAccessible(state.selectedRoom)) {
    elements.taskList.innerHTML = '<div class="empty-state">Votre administrateur doit vous affecter une tâche pour commencer.</div>';
    elements.taskEditor.hidden = true;
    return;
  }
  const tasks = currentTasks();
  if (!tasks.length) {
    elements.taskList.innerHTML = '<div class="empty-state">Les tâches de la loggia seront ajoutées lors de la prochaine définition.</div>';
    elements.taskEditor.hidden = true;
    return;
  }
  elements.taskEditor.hidden = !currentUser;
  const query = state.taskQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const visibleTasks = tasks.filter((task) => task.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(query));
  const groups = new Map();
  for (const task of visibleTasks) {
    const group = taskGroup(state.selectedZone, task.sourceColumn);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(task);
  }
  elements.taskSearch.value = state.taskQuery;
  elements.taskList.innerHTML = groups.size ? [...groups.entries()].map(([group, groupTasks]) => `
    <details class="task-group" data-group="${group}" ${query || expandedGroups.has(group) || groupTasks.some(task=>task.id===state.selectedTask) ? "open" : ""}>
      <summary>${group}<span>${groupTasks.length}</span></summary>
      <div class="task-group-items">${groupTasks.map((task) => {
        const record = getRecord(state.selectedRoom, state.selectedZone, task.id);
        const active = task.id === state.selectedTask ? " active" : "";
        const complete = record.progress >= 100 ? " complete" : "";
        return `<button class="task-row${active}" type="button" data-task="${task.id}">
          <span class="task-name">${task.label}</span><span class="task-percent">${record.progress} %</span>
          ${record.blocked ? '<span class="blocked-tag">Bloquée</span>' : ""}
          <span class="task-track"><i class="${complete}" style="width:${record.progress}%"></i></span>
        </button>`;
      }).join("")}</div>
    </details>`).join("") : '<div class="empty-state">Aucune tâche trouvée.</div>';
  elements.taskList.querySelector(".task-row.active")?.after(elements.taskEditor);
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
  const correctionAuthorized = Boolean(state.correctionAuthorization);
  const locked = !canEditSelectedRoom() || saving;
  elements.taskLock.hidden = !locked;
  elements.correctionTrigger.hidden = (!canEditSelectedRoom() && currentUser?.role !== "admin") || record.progress <= 0 || correctionAuthorized || state.correctionPanelOpen;
  elements.correctionPanel.hidden = (!canEditSelectedRoom() && currentUser?.role !== "admin") || !state.correctionPanelOpen;
  elements.correctionAuthorized.hidden = !correctionAuthorized;
  elements.correctionAuthorized.textContent = correctionAuthorized
    ? `Correction autorisée : ${state.correctionAuthorization.reason === "input-error" ? "Erreur de saisie" : "Élément oublié ou ajouté"}`
    : "";
  elements.correctionHistory.hidden = !record.lastCorrectionReason;
  elements.correctionHistory.textContent = record.lastCorrectionReason
    ? `Dernière correction : ${record.lastCorrectionReason === "input-error" ? "Erreur de saisie" : "Élément oublié ou ajouté"} - ${record.lastCorrectionNote || "Sans détail"}`
    : "";
  elements.progressRuleMessage.hidden = !state.progressRuleMessage;
  elements.progressRuleMessage.textContent = state.progressRuleMessage;
  elements.progressRange.disabled = locked;
  elements.percentInput.disabled = locked;
  elements.blockedInput.disabled = locked;
  elements.noteInput.disabled = locked;
  elements.startDateInput.disabled = locked;
  elements.endDateInput.disabled = locked;
  document.querySelectorAll("[data-progress]").forEach((button) => { button.disabled = locked; });
}

function renderZoom() {
  elements.planContent.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom / 100})`;
  elements.zoomRange.value = state.zoom;
  elements.zoomValue.textContent = `${Math.round(state.zoom)} %`;
}

function renderRoomSelection() {
  elements.dxfPlan.querySelectorAll("[data-room-marker]").forEach((marker) => {
    const number = Number(marker.dataset.room);
    marker.classList.toggle("selected", number === state.selectedRoom);
    marker.classList.toggle("filtered-out", !roomMatchesFilters(number));
  });
}

function render() {
  normalizeTaskSelection();
  renderBlockTabs();
  renderTypeTabs();
  renderRoomSelect();
  renderZoneTabs();
  renderTaskSelect();
  renderSummary();
  renderRoomHeading();
  renderTaskList();
  renderEditor();
  renderDxfZones();
  renderRoomSelection();
  renderZoom();
  renderAccessShell();
}

function centerOnRoom(number) {
  const model = state.dxfModel;
  const room = model?.rooms.find((item) => item.number === number);
  if (!room) return;
  const width = model.bounds.maxX - model.bounds.minX;
  const height = model.bounds.maxY - model.bounds.minY;
  const planX = (room.labelPoint.x - model.bounds.minX) / width * elements.planContent.clientWidth;
  const planY = (model.bounds.maxY - room.labelPoint.y) / height * elements.planContent.clientHeight;
  state.zoom = Math.max(state.zoom, 170);
  const scale = state.zoom / 100;
  state.panX = elements.planViewport.clientWidth / 2 - planX * scale;
  state.panY = elements.planViewport.clientHeight / 2 - planY * scale;
  renderZoom();
}

function selectRoom(number, center = false) {
  if (!roomAccessible(number)) return;
  resetCorrectionState();
  state.selectedRoom = number;
  if (!roomMatchesType(number)) state.selectedType = "all";
  render();
  if (center) centerOnRoom(number);
  if (currentUser) localStorage.setItem(`pistache-room:${currentUser.id}`, String(number));
}

function setZone(zone) {
  resetCorrectionState();
  state.selectedZone = zone;
  state.taskQuery = "";
  normalizeTaskSelection();
  render();
}

function setType(type) {
  if (type !== "all" && !rooms.some((room) => roomMatchesBlock(room.number) && roomTypeId(room.number) === type)) return;
  resetCorrectionState();
  state.selectedType = type;
  const changedRoom = !roomMatchesFilters(state.selectedRoom);
  if (changedRoom) state.selectedRoom = rooms.find((room) => roomMatchesFilters(room.number))?.number ?? null;
  render();
}

function setBlock(block) {
  if (block !== "all" && !rooms.some((room) => room.blockId === block && roomMatchesType(room.number))) return;
  resetCorrectionState();
  state.selectedBlock = block;
  const changedRoom = !roomMatchesFilters(state.selectedRoom);
  if (changedRoom) state.selectedRoom = rooms.find((room) => roomMatchesFilters(room.number))?.number ?? null;
  render();
}

function setZoom(value, anchorX = elements.planViewport.clientWidth / 2, anchorY = elements.planViewport.clientHeight / 2) {
  const oldScale = state.zoom / 100;
  const nextZoom = Math.max(10, Math.min(400, Number(value)));
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
  state.zoom = Math.max(10, Math.floor(scale * 10) * 10);
  const fittedScale = state.zoom / 100;
  state.panX = (viewportWidth - planWidth * fittedScale) / 2;
  state.panY = (viewportHeight - planHeight * fittedScale) / 2;
  renderZoom();
}

document.addEventListener("click", (event) => {
  if (suppressPlanClick && event.target.closest("#planViewport")) {
    suppressPlanClick = false;
    return;
  }
  const typeButton = event.target.closest("[data-type]");
  if (typeButton) setType(typeButton.dataset.type);
  const blockButton = event.target.closest("[data-block]");
  if (blockButton) setBlock(blockButton.dataset.block);
  const zoneButton = event.target.closest("[data-zone]");
  if (zoneButton && !zoneButton.disabled) setZone(zoneButton.dataset.zone);
  const roomShape = event.target.closest("[data-room]");
  if (roomShape) selectRoom(Number(roomShape.dataset.room));
  const taskButton = event.target.closest("[data-task]");
  if (taskButton) { resetCorrectionState(); state.selectedTask = taskButton.dataset.task; render(); }
  const quickButton = event.target.closest("[data-progress]");
  if (quickButton) updateProgress(quickButton.dataset.progress);
});

document.addEventListener("keydown", (event) => {
  const marker = event.target.closest?.("[data-room-marker]");
  if (marker && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    selectRoom(Number(marker.dataset.room));
  }
});

elements.taskSelect.addEventListener("change", (event) => { resetCorrectionState(); state.selectedTask = event.target.value; render(); });
elements.taskSearch.addEventListener("input", (event) => {
  state.taskQuery = event.target.value;
  renderTaskList();
});
elements.correctionTrigger.addEventListener("click", () => {
  if (!canEditSelectedRoom() && currentUser?.role !== "admin") return;
  state.correctionPanelOpen = true;
  state.progressRuleMessage = "";
  elements.correctionError.hidden = true;
  renderEditor();
});
elements.authorizeCorrection.addEventListener("click", () => {
  if (!canEditSelectedRoom() && currentUser?.role !== "admin") return;
  const reason = elements.correctionReason.value;
  const note = elements.correctionNote.value.trim();
  if (!reason || !note) {
    elements.correctionError.textContent = "Choisissez un motif et décrivez la correction.";
    elements.correctionError.hidden = false;
    return;
  }
  state.correctionAuthorization = { reason, note };
  state.correctionPanelOpen = false;
  state.progressRuleMessage = "Vous pouvez maintenant saisir une valeur inférieure.";
  elements.correctionError.hidden = true;
  renderEditor();
});
elements.cancelCorrection.addEventListener("click", () => {
  resetCorrectionState();
  renderEditor();
});
elements.roomSelect.addEventListener("change", (event) => {
  selectRoom(Number(event.target.value), true);
});
elements.progressRange.addEventListener("change", (event) => {
  updateProgress(event.target.value);
});
elements.percentInput.addEventListener("change", (event) => updateProgress(event.target.value));
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
let suppressPlanClick = false;

elements.planViewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragState = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY, moved: false };
});

elements.planViewport.addEventListener("pointermove", (event) => {
  if (!dragState) return;
  const distance = Math.hypot(event.clientX - dragState.x, event.clientY - dragState.y);
  if (!dragState.moved && distance < 4) return;
  if (!dragState.moved) {
    dragState.moved = true;
    elements.planViewport.setPointerCapture(event.pointerId);
    elements.planViewport.classList.add("dragging");
  }
  state.panX = dragState.panX + event.clientX - dragState.x;
  state.panY = dragState.panY + event.clientY - dragState.y;
  renderZoom();
});

function stopDragging(event) {
  if (!dragState) return;
  if (elements.planViewport.hasPointerCapture(event.pointerId)) elements.planViewport.releasePointerCapture(event.pointerId);
  if (dragState.moved) {
    suppressPlanClick = true;
    window.setTimeout(() => { suppressPlanClick = false; }, 0);
  }
  dragState = null;
  elements.planViewport.classList.remove("dragging");
}

elements.planViewport.addEventListener("pointerup", stopDragging);
elements.planViewport.addEventListener("pointercancel", stopDragging);

async function loadDxfSource(source, name, size) {
  elements.importStatus.classList.remove("error");
  elements.importStatus.textContent = "Analyse du DXF...";
  await new Promise((resolve) => window.setTimeout(resolve, 20));

  try {
    const parser = new window.DxfParser();
    const dxf = parser.parseSync(source);
    const model = buildDxfModel(dxf, layoutViewBounds(source));
    state.dxfModel = model;
    state.importedTypes = Object.fromEntries(model.rooms.map((room) => [room.number, room.typeText]));
    rooms = model.rooms.map((room) => roomDefinitions.get(room.number) || {
      id: `r2-${room.number}`,
      floorId: CURRENT_FLOOR,
      number: room.number,
      blockId: null,
      roomType: "standard",
    });
    loggiaRooms.clear();
    model.loggias.filter((loggia) => loggia.number !== null).forEach((loggia) => loggiaRooms.add(loggia.number));
    state.selectedRoom = rooms[0].number;
    state.selectedType = "all";
    renderDxfBase();
    render();
    window.requestAnimationFrame(fitPlan);

    const bathroomCount = model.rooms.reduce((count, room) => count + room.bathrooms.length, 0);
    const loggiaCount = model.rooms.reduce((count, room) => count + room.loggias.length, 0);
    const metadata = { name, size, extension: "dxf", rooms: model.rooms.length, bathroomCount, loggiaCount };
    if (activeProjectDefinition) {
      localStorage.setItem(`suivi-hotel-import-meta:${activeProjectDefinition.id}`, JSON.stringify(metadata));
    }
    elements.importStatus.textContent = "";
    elements.importStatus.title = `${name} - ${bathroomCount} SDB - ${loggiaCount} loggias associées`;
  } catch (error) {
    console.error(error);
    elements.importStatus.textContent = error.message || "DXF illisible";
    elements.importStatus.classList.add("error");
  }
}

function clearPlan(message) {
  state.dxfModel = null;
  state.importedTypes = {};
  rooms = R2_ROOMS;
  loggiaRooms.clear();
  state.selectedRoom = rooms[0].number;
  state.selectedBlock = "all";
  state.selectedType = "all";
  state.selectedZone = "bedroom";
  state.selectedTask = "partitions";
  elements.dxfPlan.innerHTML = "";
  elements.planEmpty.hidden = false;
  elements.planEmpty.textContent = message;
  render();
}

async function loadConfiguredPlan(projectDefinition) {
  if (!projectDefinition.dxfPath) {
    clearPlan("Le plan DXF du R+2 n'est pas encore configuré pour ce projet.");
    elements.importStatus.textContent = "Plan R+2 à configurer";
    elements.importStatus.classList.add("error");
    return;
  }
  try {
    const response = await fetch(projectDefinition.dxfPath);
    if (!response.ok) throw new Error(`Plan introuvable (${response.status})`);
    const source = await response.text();
    const name = projectDefinition.dxfPath.split("/").at(-1) || "plan.dxf";
    await loadDxfSource(source, name, source.length);
  } catch (error) {
    console.error("Plan DXF du projet illisible", error);
    clearPlan("Le plan DXF configuré pour ce projet ne peut pas être chargé.");
    elements.importStatus.textContent = error instanceof Error ? error.message : "Plan DXF illisible";
    elements.importStatus.classList.add("error");
  }
}

async function openProject(projectId) {
  if(localMode) {
    const definition=PROJECT_CATALOG.find(p=>p.id===projectId);if(!definition)return;
    activeProjectDefinition=definition;
    projectRepository=createProjectRepository(localStorage,definition.id);
    project=await projectRepository.load();
  } else {
    project=await cloud.open(projectId);
    currentUser={...cloud.user,role:cloud.snapshot.role};
    activeProjectDefinition={...PROJECT_CATALOG[0],id:projectId,name:cloud.snapshot.name};
  }
  state.records=project.floors[CURRENT_FLOOR].records;
  elements.projectSubtitle.textContent=activeProjectDefinition.name+" — R+2";
  elements.projectDialog.close();
  accessReady=true;adminPage="dashboard";state.selectedBlock="all";state.selectedType="all";
  if(localMode || currentUser?.role==="admin") await loadConfiguredPlan(activeProjectDefinition);
  else {rooms=R2_ROOMS;state.dxfModel=null;elements.dxfPlan.innerHTML="";}
  state.selectedRoom=rooms.find(r=>roomAccessible(r.number))?.number ?? null;
  render();if(!localMode){await renderSync();void syncCloud();}
}

elements.projectList.innerHTML = PROJECT_CATALOG.map((definition) => `
  <button class="project-choice" type="button" data-project-id="${definition.id}">
    <strong>${definition.name}</strong>
    <span>${definition.description}</span>
  </button>`).join("");

elements.projectList.addEventListener("click", (event) => {
  const choice = event.target.closest("[data-project-id]");
  if (choice) void openProject(choice.dataset.projectId).catch(error => { const message=document.querySelector("#projectMessage"); if(message)message.textContent=error.message; });
});

elements.projectDialog.addEventListener("cancel", (event) => {
  if (!activeProjectDefinition) event.preventDefault();
});


function renderAccessShell() {
  const admin = currentUser?.role === "admin";
  document.body.dataset.role = localMode ? "admin" : !accessReady ? "signed-out" : currentUser?.role || "signed-out";
  document.querySelector("#mainWorkspace").hidden = !accessReady || (!localMode && admin && adminPage !== "dashboard");
  document.querySelector("#adminNavigation").hidden = !accessReady || !admin || localMode;
  document.querySelector("#adminTeam").hidden = !admin || adminPage !== "team" || localMode;
  document.querySelector("#adminActivity").hidden = !admin || adminPage !== "history" || localMode;
  document.querySelector("#profileButton").hidden = !accessReady || localMode;
  document.querySelector("#signInButton").hidden = !cloudConfigured || !localMode || !accessReady;
  document.querySelector("#syncButton").hidden = !cloud;
  document.querySelector("#draftActions").hidden=!accessReady || currentUser?.role==="viewer";
  document.querySelector("#sessionRole").textContent = localMode ? "Version locale" : admin ? "Administrateur" : currentUser?.role === "viewer" ? "Lecture seule" : "Intervenant";
  document.querySelectorAll("[data-admin-page]").forEach(b=>b.classList.toggle("active",b.dataset.adminPage===adminPage));
  const workerRooms=document.querySelector("#workerRooms");
  workerRooms.hidden=localMode || admin || !accessReady;
  if(!workerRooms.hidden) workerRooms.innerHTML=rooms.filter(r=>roomMatchesFilters(r.number)).map(r=>
    '<button type="button" data-room="'+r.number+'" class="worker-room '+(r.number===state.selectedRoom?'active':'')+'"><strong>Chambre '+r.number+'</strong><span>Bloc '+r.blockId+'</span></button>'
  ).join("") || '<p class="empty-state">Aucune tâche affectée pour le moment.</p>';
  if(!roomAccessible(state.selectedRoom)) { elements.roomTitle.textContent="En attente d'affectation"; elements.roomType.textContent=""; }
}
function showLogin(message="") {
  accessReady=false; renderAccessShell();
  setRegistrationMode(false);
  document.querySelector("#loginError").textContent=message;
  document.querySelector("#loginError").hidden=!message;
  document.querySelector("#loginPassword").value="";
  document.querySelector("#loginDialog").showModal();
}
async function chooseProject() {
  const projects=await cloud.projects();
  elements.projectList.innerHTML=projects.map(p=>'<button type="button" class="project-choice" data-project-id="'+escapeSvgText(p.id)+'"><strong>'+escapeSvgText(p.name)+'</strong><span>Ouvrir le projet partagé</span></button>').join("")
    + '<p>Pour rejoindre un projet, transmettez votre identifiant à son administrateur : <code>'+escapeSvgText(cloud.user.id)+'</code></p>'
    + '<button type="button" class="button secondary" id="createSharedProject">Créer un projet Mixed Use</button>'
    + '<p>Un nouveau projet démarre à 0 %. Les anciennes saisies locales ne sont pas importées automatiquement.</p><p id="projectMessage" role="status"></p>'
    + '<button type="button" class="text-button" id="projectLogout">Changer de compte</button>';
  elements.projectDialog.showModal();
  document.querySelector("#projectLogout").onclick=async()=>{await logout(); cloud=null;currentUser=null;state.records={};elements.projectDialog.close();showLogin();};
  document.querySelector("#createSharedProject").onclick=async(event)=>{
    event.target.disabled=true;
    try { const id=await cloud.createProject(); await openProject(id); }
    catch(error){document.querySelector("#projectMessage").textContent=error.message;event.target.disabled=false;}
  };
}
async function beginCloud(workspace) {
  cloud=workspace;
  currentUser={...cloud.user,role:"worker"};
  document.querySelector("#loginDialog").close();
  document.querySelector("#loginPassword").value="";
  await chooseProject();
}
function operationLabel(operation) {
  const [room,zone,code]=operation.key.split(":");
  const task=tasksByZone[zone]?.find(t=>t.id===code);
  return "Chambre "+room+" — "+(task?.label || code);
}
async function renderSync() {
  if(!cloud?.snapshot) return;
  const operations=await cloud.engine.operations(cloud.snapshot.projectId);
  const pending=operations.filter(o=>o.state==="pending").length;
  const drafts=operations.filter(o=>o.state==="draft").length;
  const problems=operations.filter(o=>o.state!=="pending"&&o.state!=="draft");
  document.querySelector("#saveStatus").textContent=problems.length ? problems.length+" modification(s) à examiner"
    : drafts ? drafts+" brouillon(s) sur cet appareil — non partagés"
    : pending ? pending+" modification(s) en attente de synchronisation"
    : navigator.onLine ? "Synchronisé" : "Hors connexion — copie locale";
  document.querySelector("#syncProblems").innerHTML=problems.map(o=>'<article class="activity-item"><strong>'+escapeSvgText(operationLabel(o))+'</strong><p>Votre saisie : '+o.payload.progress+' % — '+escapeSvgText(syncError(o.error))+'</p><p>'+escapeSvgText(o.payload.note)+'</p><button type="button" class="button secondary" data-discard-task="'+o.taskId+'">Conserver la valeur du serveur</button><p>Pour proposer une correction, conservez la valeur du serveur puis effectuez une nouvelle saisie autorisée.</p></article>').join("");
}
function syncError(code) {
  return ({assignment_changed:"L'affectation a changé.",version_conflict:"Une autre modification a été enregistrée.",
    permission_denied:"Vos droits ne permettent pas cette modification.",dependency_failed:"Une saisie précédente doit être résolue.",
    task_archived:"Cette tâche a été archivée.",invalid_payload:"La saisie n'est pas valide.",
    correction_required:"Une correction administrative est nécessaire."})[code] || code || "Modification refusée.";
}
async function syncCloud() {
  if(!cloud?.snapshot || synchronizing || !navigator.onLine) { await renderSync(); return; }
  const workspace=cloud; synchronizing=true;
  try {
    await saveQueue;
    await workspace.sync();
    if(cloud!==workspace) return;
    currentUser={...workspace.user,role:workspace.snapshot.role};
    project=await workspace.project();state.records=project.floors[CURRENT_FLOOR].records;
    if(!roomAccessible(state.selectedRoom)) state.selectedRoom=rooms.find(r=>roomAccessible(r.number))?.number ?? null;
    render(); await renderSync();
  } catch(error) {
    if(cloud===workspace) { currentUser={...workspace.user,role:workspace.snapshot.role}; render(); await renderSync(); document.querySelector("#saveStatus").textContent="Synchronisation en attente : "+error.message; }
  } finally { synchronizing=false; }
}
async function renderAdminPage() {
  if(!cloud || currentUser?.role!=="admin") return;
  if(adminPage==="team") {
    const snapshot=cloud.snapshot;
    document.querySelector("#teamList").innerHTML=snapshot.members.map(m=>
      '<article class="team-member"><div><h3>'+escapeSvgText(m.name)+'</h3><p>'+m.role+' — '+m.status+'</p></div></article>').join("");
    const scope=await cloud.assignmentScope();
    const activeFloors=scope.floors.filter(f=>!f.archived_at);
    document.querySelector("#assignmentBlocks").innerHTML='<legend>Étages et blocs</legend>'+activeFloors.map(f=>
      '<div class="assignment-floor"><strong>'+escapeSvgText(f.label)+'</strong>'+scope.blocks.filter(b=>b.floor_id===f.id&&!b.archived_at).map(b=>{
        const roomIds=new Set(scope.rooms.filter(r=>r.block_id===b.id&&!r.archived_at).map(r=>r.id));
        const taskIds=new Set(scope.tasks.filter(t=>roomIds.has(t.room_id)&&!t.archived_at).map(t=>t.id));
        const people=[...new Set(scope.assignments.filter(a=>!a.ended_at&&taskIds.has(a.room_task_id)).map(a=>snapshot.members.find(m=>m.user_id===a.assignee_id)?.name||"Intervenant"))];
        return '<label class="block-assignment"><input type="checkbox" name="assignmentBlock" value="'+b.id+'" '+(!taskIds.size?'disabled':'')+'><span>Bloc '+escapeSvgText(b.label)+'<small>'+escapeSvgText(people.join(', ')||'Non affecté')+' · '+taskIds.size+' tâches</small></span></label>';
      }).join('')+'</div>').join('');
    document.querySelector("#assignmentPerson").innerHTML='<option value="">Retirer les affectations</option>'+snapshot.members.filter(m=>m.status==="active"&&m.role!=="viewer").map(m=>'<option value="'+m.user_id+'">'+escapeSvgText(m.name)+'</option>').join('');
  } else if(adminPage==="history") {
    const history=await cloud.history();
    document.querySelector("#activityList").innerHTML=history.map(item=>{
      const task=cloud.snapshot.tasks.find(t=>t.id===item.room_task_id);
      const member=cloud.snapshot.members.find(m=>m.user_id===item.changed_by);
      return '<article class="activity-item"><strong>'+escapeSvgText(member?.name || "Import")+'</strong><p>'+escapeSvgText(task?.key || item.room_task_id)+' : '+item.before_state.progress+' % → '+item.after_state.progress+' %</p><small>'+new Date(item.created_at).toLocaleString("fr-FR")+'</small></article>';
    }).join("") || '<p class="empty-state">Aucune modification enregistrée.</p>';
  }
}
document.querySelector("#assignmentForm").onsubmit=async(event)=>{
  event.preventDefault();const button=event.currentTarget.querySelector("button");button.disabled=true;
  try {
    const blockIds=[...document.querySelectorAll('input[name="assignmentBlock"]:checked')].map(input=>input.value);
    if(!blockIds.length) throw new Error("Sélectionnez au moins un bloc dans un étage.");
    const count=await cloud.assignBlocks(blockIds,document.querySelector("#assignmentPerson").value||null);
    await renderAdminPage();
    document.querySelector("#teamMessage").textContent=count+" affectations de tâches mises à jour.";
  } catch(error){document.querySelector("#teamMessage").textContent=error.message;}finally{button.disabled=false;}
};
document.querySelector("#memberForm").onsubmit=async(event)=>{
  event.preventDefault();const button=event.currentTarget.querySelector("button");button.disabled=true;
  try {await cloud.member(document.querySelector("#memberId").value.trim(),document.querySelector("#memberRole").value,document.querySelector("#memberStatus").value);await renderAdminPage();document.querySelector("#teamMessage").textContent="Membre mis à jour.";}
  catch(error){document.querySelector("#teamMessage").textContent=error.message;}finally{button.disabled=false;}
};
document.querySelector("#adminNavigation").onclick=async(event)=>{
  const button=event.target.closest("[data-admin-page]");if(!button)return;
  adminPage=button.dataset.adminPage;renderAccessShell();
  try{await renderAdminPage();if(adminPage==="dashboard")requestAnimationFrame(fitPlan);}
  catch(error){document.querySelector("#saveStatus").textContent=error.message;}
};
document.querySelector("#profileButton").onclick=()=>{
  const user=cloud.user;
  document.querySelector("#profileMetadata").innerHTML='<dt>Nom</dt><dd>'+escapeSvgText(user.user_metadata?.display_name || user.email || "")+'</dd><dt>Identifiant à communiquer à votre administrateur</dt><dd>'+escapeSvgText(user.id)+'</dd><dt>Rôle dans ce projet</dt><dd>'+escapeSvgText(currentUser.role)+'</dd>';
  document.querySelector("#profileDialog").showModal();
};
document.querySelector("#closeProfile").onclick=()=>document.querySelector("#profileDialog").close();
document.querySelector("#logoutButton").onclick=async()=>{
  await saveQueue;
  const pending=cloud?.snapshot ? await cloud.engine.operations(cloud.snapshot.projectId) : [];
  if(pending.length && !confirm("Des modifications restent sur cet appareil. Elles seront conservées pour ce compte. Se déconnecter ?"))return;
  await logout();cloud=null;currentUser=null;state.records={};accessReady=false;
  document.querySelector("#profileDialog").close();showLogin();
};
document.querySelector("#continueAsGuest").onclick=()=>{
  sessionStorage.setItem(guestModeKey,"true");
  location.reload();
};
document.querySelector("#signInButton").onclick=async()=>{
  await saveQueue;
  sessionStorage.removeItem(guestModeKey);
  location.reload();
};
document.querySelector("#loginDialog").addEventListener("cancel",event=>event.preventDefault());
function setRegistrationMode(register) {
  registrationMode=register;
  document.querySelector("#loginForm").hidden=false;
  document.querySelector("#verifyAccount").hidden=true;
  document.querySelector("#loginError").hidden=true;
  document.querySelector("#loginTitle").textContent=register?"Créez votre compte.":"Retrouvez votre chantier.";
  document.querySelector("#loginDescription").textContent=register?"Inscrivez-vous pour rejoindre votre équipe et suivre votre chantier.":"Connectez-vous pour reprendre vos tâches et vos avancements.";
  document.querySelector("#loginNameField").hidden=!registrationMode;
  document.querySelector("#loginSubmit").textContent=registrationMode?"Créer mon compte":"Se connecter";
  document.querySelector("#toggleRegister").textContent=registrationMode?"J'ai déjà un compte":"Créer un compte";
  document.querySelector("#loginPassword").autocomplete=registrationMode?"new-password":"current-password";
}
let confirmationEmail="";
let resendAvailableAt=0;
document.querySelector("#toggleRegister").onclick=()=>setRegistrationMode(!registrationMode);
document.querySelector("#backToLogin").onclick=()=>{setRegistrationMode(false);document.querySelector("#loginPassword").focus();};
document.querySelector("#changeRegistrationEmail").onclick=()=>{setRegistrationMode(true);document.querySelector("#loginEmail").focus();};
document.querySelector("#resendConfirmation").onclick=async()=>{
  const button=document.querySelector("#resendConfirmation"), message=document.querySelector("#verificationMessage");
  message.hidden=false;message.classList.remove("error");
  if(Date.now()<resendAvailableAt){message.textContent="Patientez une minute entre deux demandes d’envoi.";return;}
  button.disabled=true;
  const email=confirmationEmail;
  try {
    await resendConfirmation(email);
    resendAvailableAt=Date.now()+60000;
    if(email===confirmationEmail) message.textContent="Nouvel envoi demandé. Consultez votre boîte de réception et vos courriers indésirables.";
  } catch(error) {
    if(email===confirmationEmail){message.textContent="Envoi impossible : "+error.message;message.classList.add("error");}
  } finally {button.disabled=false;}
};
document.querySelector("#loginForm").onsubmit=async(event)=>{
  event.preventDefault();const button=document.querySelector("#loginSubmit");button.disabled=true;
  const register=registrationMode;
  const email=document.querySelector("#loginEmail").value.trim();
  document.querySelector("#toggleRegister").disabled=true;
  document.querySelector("#loginError").hidden=true;
  button.textContent=register?"Création en cours…":"Connexion en cours…";
  try{
    const workspace=await login(email,document.querySelector("#loginPassword").value,
      register?document.querySelector("#loginName").value:undefined);
    if(workspace)await beginCloud(workspace);
    else if(register) {
      confirmationEmail=email;
      document.querySelector("#loginPassword").value="";
      document.querySelector("#loginForm").hidden=true;
      document.querySelector("#verifyAccount").hidden=false;
      document.querySelector("#verificationEmail").textContent=email;
      document.querySelector("#verificationMessage").hidden=true;
      document.querySelector("#loginTitle").textContent="Confirmez votre adresse e-mail.";
      document.querySelector("#loginDescription").textContent="Dernière étape pour accéder à votre chantier.";
      document.querySelector("#loginTitle").focus();
    } else {throw new Error("La connexion n’a pas pu être ouverte. Réessayez.");}
  }catch(error){document.querySelector("#loginError").textContent=error.message;document.querySelector("#loginError").hidden=false;}
  finally{button.disabled=false;button.textContent=registrationMode?"Créer mon compte":"Se connecter";document.querySelector("#toggleRegister").disabled=false;}
};
document.querySelector("#syncButton").onclick=()=>{document.querySelector("#syncDialog").showModal();void renderSync();};
document.querySelector("#closeSync").onclick=()=>document.querySelector("#syncDialog").close();
document.querySelector("#retrySync").onclick=()=>void syncCloud();
document.querySelector("#syncProblems").onclick=async(event)=>{
  const button=event.target.closest("[data-discard-task]");if(!button)return;
  if(!confirm("Conserver la valeur du serveur pour cette tâche ? Votre proposition restera archivée localement."))return;
  await cloud.exclusive(()=>cloud.engine.discard(cloud.snapshot.projectId,button.dataset.discardTask));
  project=await cloud.project();state.records=project.floors[CURRENT_FLOOR].records;render();await renderSync();
};
window.addEventListener("online",()=>void syncCloud());
window.addEventListener("offline",()=>void renderSync());
setInterval(()=>{if(document.visibilityState==="visible")void syncCloud();},30000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void syncCloud();});
async function initializeAccess() {
  renderAccessShell();
  if(localMode){currentUser={id:"local",role:"admin"};await openProject("mixed-use");return;}
  try{const workspace=await restoreWorkspace();if(workspace)await beginCloud(workspace);else showLogin();}
  catch(error){showLogin(error.message);}
}
void initializeAccess();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(error => console.error("Cache hors connexion indisponible", error));
}

// Presentation only: collapse secondary filters on narrow screens.
const compactLayout=window.matchMedia("(max-width: 820px)");
function updateFilterLayout() { document.querySelector("#secondaryFilters").open=!compactLayout.matches; }
compactLayout.addEventListener("change",updateFilterLayout);
updateFilterLayout();

document.querySelector("#confirmProgress").onclick=async()=>{
  await saveQueue;
  const button=document.querySelector("#confirmProgress");
  const count=localMode?Object.values(state.records).filter(r=>r.draft).length:(await cloud.engine.operations(cloud.snapshot.projectId)).filter(o=>o.state==="draft").length;
  if(!count){document.querySelector("#saveStatus").textContent="Aucun brouillon à valider.";return;}
  if(!confirm("Valider les "+count+" saisies de ce projet enregistrées sur cet appareil ? "+(localMode?"Elles resteront locales, car vous n’êtes pas connecté.":"Elles seront partagées avec l’équipe dès que la connexion le permettra.")))return;
  button.disabled=true;document.querySelector("#cancelProgress").disabled=true;saving=true;
  try{
    if(localMode){
      const next=structuredClone(project);
      for(const record of Object.values(next.floors[CURRENT_FLOOR].records))if(record.draft){
        if(record.progress<lockedProgress(record)&&!record.draftJustified)throw new Error("Justifiez les diminutions avant de valider.");
        record.lockedProgress=lockedProgress(record);record.confirmedProgress=record.progress;record.confirmedDay=projectDay();record.draft=false;record.draftJustified=false;delete record.draftBefore;
      }
      await projectRepository.save(next);project=next;state.records=next.floors[CURRENT_FLOOR].records;
      document.querySelector("#saveStatus").textContent="Saisies validées sur cet appareil — non partagées";
    }else{await cloud.confirmDrafts();await syncCloud();await renderSync();}
    render();
  }catch(error){document.querySelector("#saveStatus").textContent="Validation interrompue : "+error.message;}
  finally{button.disabled=false;document.querySelector("#cancelProgress").disabled=false;saving=false;renderEditor();}
};

document.querySelector("#cancelProgress").onclick=async()=>{
  await saveQueue;
  if(!confirm("Annuler les brouillons non validés de ce projet sur cet appareil ? Les saisies déjà validées seront conservées."))return;
  saving=true;
  document.querySelector("#confirmProgress").disabled=true;
  document.querySelector("#cancelProgress").disabled=true;
  try{
    if(localMode){
      const next=structuredClone(project);
      for(const [key,record] of Object.entries(next.floors[CURRENT_FLOOR].records))if(record.draft){
        if(!record.draftBefore)throw new Error("Un ancien brouillon ne possède pas de copie antérieure. Il est conservé pour éviter une perte de données.");
        next.floors[CURRENT_FLOOR].records[key]=record.draftBefore;
      }
      await projectRepository.save(next);project=next;
    }else{await cloud.cancelDrafts();project=await cloud.project();}
    state.records=project.floors[CURRENT_FLOOR].records;
    resetCorrectionState();render();
    document.querySelector("#saveStatus").textContent="Brouillons annulés — valeurs validées conservées";
  }catch(error){document.querySelector("#saveStatus").textContent=error.message;}
  finally{saving=false;document.querySelector("#confirmProgress").disabled=false;document.querySelector("#cancelProgress").disabled=false;renderEditor();}
};
