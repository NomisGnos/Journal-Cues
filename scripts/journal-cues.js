const MODULE_ID = "journal-cues";
const SOCKET_NAME = `module.${MODULE_ID}`;
const CUES_FLAG = "cues";
const APP_ID = "journal-cues-app";
const DEFAULT_ACTION_GAP_MS = 100;
const DEFAULT_MOVE_DURATION_MS = 650;
const WALL_INTERSECTION_EPSILON = 1;
const PATREON_URL = "https://patreon.com/nomisDM";

const EMBEDDED_DOCUMENTS = ["Token", "Wall", "Tile", "AmbientLight", "AmbientSound", "Region"];
const WORLD_DOCUMENTS = ["Actor", "Playlist", "PlaylistSound", "Macro", "RollTable"];
const RECORDED_HOOK_DOCUMENTS = [...EMBEDDED_DOCUMENTS, ...WORLD_DOCUMENTS];
const MOVABLE_DOCUMENTS = new Set(["Token", "Tile", "Region"]);
const VISIBILITY_DOCUMENTS = new Set(["Token", "Tile", "AmbientLight", "AmbientSound"]);
const PLAYLIST_SOUND_FIELDS = ["playing", "repeat", "volume", "pausedTime", "path"];
const TOKEN_RESTORE_FIELDS = ["x", "y", "elevation", "rotation", "hidden"];

let appInstance = null;
let refreshAppQueued = false;

function clone(value) {
  return foundry.utils.deepClone(value);
}

function flatten(value) {
  return foundry.utils.flattenObject(value ?? {});
}

function expand(value) {
  return foundry.utils.expandObject(value ?? {});
}

function getProperty(object, path) {
  return foundry.utils.getProperty(object, path);
}

function setProperty(object, path, value) {
  foundry.utils.setProperty(object, path, value);
  return object;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function isNoisePath(path) {
  const parts = String(path ?? "").split(".");
  return parts.includes("_stats")
    || parts.includes("seed")
    || parts.some((part) => part.startsWith("-="))
    || path === "_id"
    || path?.endsWith?.("._id");
}

function stripNoise(data) {
  const flat = flatten(data);
  for (const key of Object.keys(flat)) {
    if (isNoisePath(key)) delete flat[key];
  }
  return expand(flat);
}

function pickExistingFields(data, fields) {
  const output = {};
  for (const field of fields) {
    const value = getProperty(data, field);
    if (value !== undefined) setProperty(output, field, clone(value));
  }
  return output;
}

function plainText(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value ?? "");
  return (div.textContent || div.innerText || "").trim();
}

function randomId(prefix = "cue") {
  const id = foundry.utils.randomID(8);
  return `${prefix}-${id}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function playbackSleep(ms, runId) {
  const end = Date.now() + Math.max(0, Number(ms) || 0);
  while (Date.now() < end) {
    if (Playback.shouldStop(runId)) return false;
    await sleep(Math.min(100, end - Date.now()));
  }
  return !Playback.shouldStop(runId);
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.round(number);
}

function localize(key, fallback) {
  try {
    const value = game.i18n?.localize?.(key);
    return value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

function journalCueLabels() {
  return {
    controls: {
      cancel: localize("JournalCues.Controls.Cancel", "Cancel"),
      copy: localize("JournalCues.Controls.Copy", "Copy"),
      copyLink: localize("JournalCues.Controls.CopyLink", "Copy Journal Link"),
      delete: localize("JournalCues.Controls.Delete", "Delete"),
      attachWindow: localize("JournalCues.Controls.AttachWindow", "Attach Window"),
      collapseList: localize("JournalCues.Controls.CollapseList", "Collapse Cue List"),
      collapseSettings: localize("JournalCues.Controls.CollapseSettings", "Hide Settings"),
      detachWindow: localize("JournalCues.Controls.DetachWindow", "Detach Window"),
      darkMode: localize("JournalCues.Controls.DarkMode", "Dark Mode"),
      expandList: localize("JournalCues.Controls.ExpandList", "Expand Cue List"),
      expandSettings: localize("JournalCues.Controls.ExpandSettings", "Show Settings"),
      help: localize("JournalCues.Controls.Help", "Help"),
      lightMode: localize("JournalCues.Controls.LightMode", "Light Mode"),
      moveDown: localize("JournalCues.Controls.MoveDown", "Move Down"),
      moveUp: localize("JournalCues.Controls.MoveUp", "Move Up"),
      newCue: localize("JournalCues.Controls.NewCue", "Create New Cue"),
      options: localize("JournalCues.Controls.Options", "Options"),
      play: localize("JournalCues.Controls.Play", "Play"),
      record: localize("JournalCues.Controls.Record", "Record"),
      rename: localize("JournalCues.Controls.Rename", "Rename Cue"),
      remove: localize("JournalCues.Controls.Remove", "Remove"),
      restore: localize("JournalCues.Controls.Restore", "Restore"),
      save: localize("JournalCues.Controls.Save", "Save"),
      startRecording: localize("JournalCues.Controls.StartRecording", "Start Recording"),
      stop: localize("JournalCues.Controls.Stop", "Stop"),
      stopRecording: localize("JournalCues.Controls.StopRecording", "Stop Recording"),
      support: localize("JournalCues.Controls.Support", "Support Journal Cues")
    },
    empty: {
      noActions: localize("JournalCues.Empty.NoActions", "No actions in this cue yet."),
      noCues: localize("JournalCues.Empty.NoCues", "No cues stored on this scene yet."),
      noSelection: localize("JournalCues.Empty.NoSelection", "Select a cue, or create a new one.")
    },
    fields: {
      actionList: localize("JournalCues.Fields.ActionList", "Action List"),
      actionsJson: localize("JournalCues.Fields.ActionsJson", "Actions JSON"),
      cueSettings: localize("JournalCues.Fields.CueSettings", "Cue Settings"),
      defaultDelay: localize("JournalCues.Fields.DefaultDelay", "Default Delay Between Actions (ms)"),
      defaultDelayShort: localize("JournalCues.Fields.DefaultDelayShort", "Default Delay"),
      delay: localize("JournalCues.Fields.Delay", "Delay"),
      journalLink: localize("JournalCues.Fields.JournalLink", "Journal Link"),
      loop: localize("JournalCues.Fields.Loop", "Loop"),
      loopLimit: localize("JournalCues.Fields.LoopLimit", "Loop Limit"),
      name: localize("JournalCues.Fields.Name", "Name"),
      playbackOrigin: localize("JournalCues.Fields.PlaybackOrigin", "Playback Origin")
    },
    hints: {
      defaultDelay: localize("JournalCues.Hints.DefaultDelay", "Used after actions that do not set their own delay."),
      loopLimit: localize("JournalCues.Hints.LoopLimit", "Use 0 for unlimited repeats until stopped."),
      playbackOrigin: localize("JournalCues.Hints.PlaybackOrigin", "Recorded start makes repeatable scene beats. Current placement replays token movement relative to where the token is now.")
    },
    labels: {
      actions: localize("JournalCues.Labels.Actions", "actions"),
      actionsCaptured: localize("JournalCues.Labels.ActionsCaptured", "actions captured."),
      cueList: localize("JournalCues.Labels.CueList", "Cue List"),
      cues: localize("JournalCues.Labels.Cues", "cues")
    },
    options: {
      currentPlacement: localize("JournalCues.Options.CurrentPlacement", "Current placement"),
      enableLoop: localize("JournalCues.Options.EnableLoop", "Replay this cue in a loop"),
      recordedStart: localize("JournalCues.Options.RecordedStart", "Recorded start")
    },
    status: {
      done: localize("JournalCues.Status.Done", "Done"),
      loop: localize("JournalCues.Status.Loop", "loop"),
      next: localize("JournalCues.Status.Next", "Next"),
      now: localize("JournalCues.Status.Now", "Now"),
      paused: localize("JournalCues.Status.Paused", "Paused"),
      pausedAt: localize("JournalCues.Status.PausedAt", "paused at"),
      playing: localize("JournalCues.Status.Playing", "Playing"),
      recording: localize("JournalCues.Status.Recording", "Recording"),
      recordingInProgress: localize("JournalCues.Status.RecordingInProgress", "recording in progress")
    },
    tooltip: {
      showTarget: localize("JournalCues.Tooltip.ShowTarget", "Show target")
    }
  };
}

function defaultActionDelayMs() {
  try {
    return nonNegativeNumber(game.settings?.get?.(MODULE_ID, "defaultActionDelayMs"), DEFAULT_ACTION_GAP_MS);
  } catch {
    return DEFAULT_ACTION_GAP_MS;
  }
}

function cueDefaultDelayMs(cue) {
  return nonNegativeNumber(cue?.defaultDelayMs, defaultActionDelayMs());
}

function scene() {
  return canvas?.scene ?? game.scenes?.active ?? game.scenes?.current;
}

function normalizeCues(cues) {
  if (Array.isArray(cues)) return cues;
  if (cues && typeof cues === "object") return Object.values(cues);
  return [];
}

function cueLink(cue) {
  return `@Cue[${cue.id}]{${cue.name || cue.id}}`;
}

function subjectLabel(action, fallback = "document") {
  const label = String(action?.label || "").replace(/^[^:]+:\s*/, "").trim();
  return label || action?.name || action?.target || action?.token || action?.id || fallback;
}

function fieldLabel(path) {
  const labels = {
    "system.attributes.hp.value": "HP",
    "system.attributes.hp.temp": "Temp HP",
    "system.attributes.hp.max": "Max HP",
    "system.attributes.ac.value": "AC",
    "system.attributes.movement.walk": "Walk speed",
    hidden: "Hidden",
    x: "X",
    y: "Y",
    rotation: "Rotation",
    elevation: "Elevation"
  };
  return labels[path] ?? path.split(".").at(-1) ?? path;
}

function formatValue(value) {
  if (value == null) return "empty";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "object";
  const text = JSON.stringify(value);
  return text.length > 36 ? `${text.slice(0, 33)}...` : text;
}

function describeChanges(action) {
  const before = flatten(action.before ?? {});
  const after = flatten(action.after ?? action.update ?? {});
  const changedEntries = Object.entries(after)
    .filter(([key, value]) => !isNoisePath(key) && JSON.stringify(before[key]) !== JSON.stringify(value));
  const changes = changedEntries.slice(0, 4).map(([key, value]) => {
    const label = fieldLabel(key);
    return hasOwn(before, key)
      ? `${label} ${formatValue(before[key])} -> ${formatValue(value)}`
      : `set ${label} to ${formatValue(value)}`;
  });
  const extra = Math.max(0, changedEntries.length - changes.length);
  if (!changes.length) return "";
  return `${changes.join(", ")}${extra ? `, +${extra} more` : ""}`;
}

function summarizeAction(action, index = 0) {
  const prefix = `${index + 1}.`;
  if (!action) return `${prefix} Empty action`;
  switch (action.type) {
    case "moveToken":
      return `${prefix} Move token ${subjectLabel(action, "selected")} to ${formatPoint(action.to ?? action.waypoints?.at?.(-1))}`;
    case "door":
      return `${prefix} Set door ${action.walls ?? action.target ?? ""} ${action.state ?? ""}`.trim();
    case "visibility":
      return `${prefix} ${action.hidden ? "Hide" : "Show"} ${action.documentName ?? "document"} ${action.target ?? ""}`.trim();
    case "light":
      return `${prefix} Update light ${action.light ?? action.target ?? ""}`.trim();
    case "camera":
      return `${prefix} Camera to ${formatPoint(action.to ?? action.target ?? action)}`;
    case "image":
      return `${prefix} Show image ${action.title ?? action.src ?? ""}`.trim();
    case "audio":
      return `${prefix} Play audio ${action.src ?? ""}`.trim();
    case "playlist":
      return `${prefix} ${action.command === "stop" ? "Stop" : "Play"} playlist sound ${action.label ?? action.name ?? action.playlistSoundUuid ?? action.playlistUuid ?? ""}`.trim();
    case "macro":
      return `${prefix} Execute macro ${action.label ?? action.macroUuid ?? ""}`.trim();
    case "rollTable":
      return `${prefix} Draw ${action.number && action.number > 1 ? `${action.number} from ` : ""}roll table ${action.label ?? action.tableUuid ?? ""}`.trim();
    case "chatMessage":
      return `${prefix} Chat ${action.speaker?.alias ?? action.label ?? ""}: ${plainText(action.content ?? "").slice(0, 80)}`.trim();
    case "useDnd5eActivity":
      return `${prefix} Use D&D5e activity ${action.label ?? action.activityUuid ?? ""}${action.targetTokenUuids?.length ? ` (${action.targetTokenUuids.length} target${action.targetTokenUuids.length === 1 ? "" : "s"})` : ""}`.trim();
    case "portrait":
      return `${prefix} Portrait ${action.actor ?? action.actorUuid ?? ""}`.trim();
    case "ping":
      return `${prefix} Ping ${pingStyleLabel(action.style)} at ${formatPoint(action)}`.trim();
    case "wait":
      return `${prefix} Wait ${action.ms ?? action.duration ?? 500}ms`;
    case "document":
      return `${prefix} Update ${action.documentName ?? "document"} ${subjectLabel(action)}${describeChanges(action) ? `: ${describeChanges(action)}` : ""}`.trim();
    case "createDocument":
      return `${prefix} Create ${action.documentName ?? "document"}`;
    case "deleteDocument":
      return `${prefix} Delete ${action.documentName ?? "document"} ${action.idToDelete ?? ""}`.trim();
    default:
      return `${prefix} ${action.type ?? "Unknown action"}`;
  }
}

function actionLink(action) {
  if (!action) return null;
  if (action.type === "moveToken") {
    const target = action.token ?? action.target;
    if (!target || target === "selected") return null;
    return {
      documentName: "Token",
      target,
      sceneId: action.sceneId ?? scene()?.id,
      label: subjectLabel(action, "token"),
      icon: "fas fa-map-marker-alt"
    };
  }
  if (["document", "visibility", "light"].includes(action.type) && (action.target || action.light)) {
    return {
      documentName: action.documentName ?? (action.type === "light" ? "AmbientLight" : null),
      target: action.target ?? action.light,
      sceneId: action.sceneId ?? scene()?.id,
      label: subjectLabel(action, action.documentName ?? "document"),
      icon: action.documentName === "Actor" ? "fas fa-user" : "fas fa-map-marker-alt"
    };
  }
  return null;
}

function actionDisplay(action, index, defaultDelay) {
  const link = actionLink(action);
  const waitAfter = nonNegativeNumber(action.waitAfter, action?.type === "wait" ? 0 : defaultDelay);
  if (!link) {
    return {
      index,
      summary: summarizeAction(action, index),
      waitAfter
    };
  }

  const prefix = `${index + 1}.`;
  if (action.type === "moveToken") {
    return {
      index,
      beforeLink: `${prefix} Move token`,
      link,
      afterLink: `to ${formatPoint(action.to ?? action.waypoints?.at?.(-1))}`,
      waitAfter
    };
  }

  if (action.type === "document") {
    const changes = describeChanges(action);
    return {
      index,
      beforeLink: `${prefix} Update ${action.documentName ?? "document"}`,
      link,
      afterLink: changes ? `: ${changes}` : "",
      waitAfter
    };
  }

  return {
    index,
    beforeLink: `${prefix} ${summarizeAction(action, index).replace(`${prefix} `, "")}`,
    link,
    afterLink: "",
    waitAfter
  };
}

function formatPoint(point) {
  if (!point) return "";
  if (typeof point === "string") return point;
  if (Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) return `${Math.round(point.x)}, ${Math.round(point.y)}`;
  return "";
}

function pingStyleLabel(style) {
  const types = CONFIG.Canvas?.pings?.types ?? {};
  if (style === types.ALERT) return "alert";
  if (style === types.PULL) return "pull";
  return "pulse";
}

function currentPingOptions(options = {}) {
  const types = CONFIG.Canvas?.pings?.types ?? {};
  const isPull = !!game.keyboard?.isModifierActive?.("SHIFT");
  const isAlert = !!game.keyboard?.isModifierActive?.("ALT");
  let style = types.PULSE ?? "pulse";
  if (isPull) style = types.PULL ?? "pull";
  else if (isAlert) style = types.ALERT ?? "alert";
  return {
    pull: isPull,
    style,
    zoom: canvas?.stage?.scale?.x,
    ...(options ?? {})
  };
}

function selectedTokenUuids() {
  return (canvas.tokens?.controlled ?? []).map((token) => token.document?.uuid).filter(Boolean);
}

function targetedTokenUuids() {
  return Array.from(game.user?.targets ?? []).map((token) => token.document?.uuid).filter(Boolean);
}

function sortCues(cues) {
  return cues.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), game.i18n?.lang || undefined, { sensitivity: "base" }));
}

async function getCues(sc = scene()) {
  if (!sc) return [];
  return sortCues(normalizeCues(sc.getFlag(MODULE_ID, CUES_FLAG)).map((cue) => ({
    originMode: "recorded",
    defaultDelayMs: defaultActionDelayMs(),
    loopEnabled: false,
    loopLimit: 1,
    actions: [],
    snapshot: { entries: [] },
    ...cue
  })));
}

async function saveCues(cues, sc = scene()) {
  if (!sc) return;
  await sc.setFlag(MODULE_ID, CUES_FLAG, sortCues(cues));
  refreshApp();
}

async function getCue(cueId, sc = scene()) {
  const cues = await getCues(sc);
  return cues.find((cue) => cue.id === cueId) ?? null;
}

async function upsertCue(cue, sc = scene()) {
  const cues = await getCues(sc);
  const idx = cues.findIndex((existing) => existing.id === cue.id);
  const updated = {
    ...cue,
    updatedAt: Date.now()
  };
  if (idx >= 0) cues[idx] = updated;
  else cues.push(updated);
  await saveCues(cues, sc);
  return updated;
}

async function createCue(name = "New Cue", sc = scene()) {
  const cue = {
    id: randomId("cue"),
    name,
    originMode: "recorded",
    defaultDelayMs: defaultActionDelayMs(),
    loopEnabled: false,
    loopLimit: 1,
    actions: [],
    snapshot: { entries: [] },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await upsertCue(cue, sc);
  return cue;
}

async function deleteCue(cueId, sc = scene()) {
  const cues = await getCues(sc);
  await saveCues(cues.filter((cue) => cue.id !== cueId), sc);
}

function refreshApp() {
  if (!appInstance?.rendered || refreshAppQueued) return;
  refreshAppQueued = true;
  requestAnimationFrame(() => {
    refreshAppQueued = false;
    if (appInstance?.rendered) appInstance.render(false);
  });
}

function embeddedSceneFor(actionOrRef) {
  const sceneId = actionOrRef?.sceneId || scene()?.id;
  return game.scenes?.get(sceneId) ?? scene();
}

async function resolveDocument(ref, defaultDocumentName = null) {
  if (!ref) return null;
  if (typeof ref === "object" && ref.documentName && typeof ref.update === "function") return ref;

  if (typeof ref === "string" && ref.startsWith("tag:")) {
    const found = await resolveTargetDocuments(defaultDocumentName, ref);
    return found[0] ?? null;
  }

  const uuid = typeof ref === "string" ? ref : ref.uuid;
  if (typeof uuid === "string" && uuid.includes(".")) {
    try {
      const doc = await fromUuid(uuid);
      return doc?.document ?? doc ?? null;
    } catch {
      // Fall back to id lookup below.
    }
  }

  const documentName = defaultDocumentName ?? ref.documentName;
  const id = typeof ref === "string" ? ref : ref.id;
  if (!documentName || !id) return null;

  if (documentName === "Actor") return game.actors?.get(id) ?? null;
  if (documentName === "Playlist") return game.playlists?.get(id) ?? null;
  if (documentName === "PlaylistSound") {
    return game.playlists?.reduce((found, playlist) => found ?? playlist.sounds?.get(id), null) ?? null;
  }
  if (documentName === "Macro") return game.macros?.get(id) ?? null;
  if (documentName === "RollTable") return game.tables?.get(id) ?? null;
  if (documentName === "ChatMessage") return game.messages?.get(id) ?? null;
  const sc = embeddedSceneFor(ref);
  return sc?.getEmbeddedDocument?.(documentName, id) ?? null;
}

async function resolveTargetDocuments(documentName, target) {
  if (!target) return [];
  if (Array.isArray(target)) {
    const docs = [];
    for (const one of target) {
      const doc = await resolveDocument(one, documentName);
      if (doc) docs.push(doc);
    }
    return docs;
  }

  if (target === "selected" && documentName === "Token") {
    return (canvas.tokens?.controlled ?? []).map((token) => token.document);
  }

  if (typeof target === "string" && target.startsWith("tag:")) {
    const tag = target.slice(4).trim();
    if (!tag) return [];
    if (!game.modules.get("tagger")?.active || !globalThis.Tagger?.getByTag) {
      ui.notifications?.warn("Journal Cues: Tagger is not active, so tag targets cannot be resolved.");
      return [];
    }
    const found = globalThis.Tagger.getByTag(tag, { sceneId: embeddedSceneFor({})?.id }) ?? [];
    return found
      .map((entry) => entry.document ?? entry)
      .filter((doc) => !documentName || doc.documentName === documentName);
  }

  const doc = await resolveDocument(target, documentName);
  return doc ? [doc] : [];
}

function pickFields(doc, fields) {
  const data = {};
  for (const field of fields) {
    if (!field || isNoisePath(field)) continue;
    const value = getProperty(doc, field);
    setProperty(data, field, clone(value));
  }
  return data;
}

function afterFieldsFromChanges(doc, before, fields, flatChanges) {
  const data = {};
  for (const field of fields) {
    if (!field || isNoisePath(field)) continue;
    const value = hasOwn(flatChanges, field)
      ? flatChanges[field]
      : getProperty(doc, field) ?? getProperty(before, field);
    if (value !== undefined) setProperty(data, field, clone(value));
  }
  return data;
}

function updateDataFromFields(data) {
  return expand(flatten(data));
}

function snapshotEntry(doc, data, exists = true) {
  return {
    documentName: doc.documentName,
    id: doc.id,
    uuid: doc.uuid,
    sceneId: doc.parent?.documentName === "Scene" ? doc.parent.id : null,
    exists,
    data: clone(data)
  };
}

function chatMessageData(message) {
  const data = message.toObject ? message.toObject() : {};
  const keep = ["speaker", "content", "style", "type", "flavor", "rolls", "whisper", "blind", "sound", "emote"];
  const output = pickExistingFields(data, keep);
  delete output._id;
  return stripNoise(output);
}

function snapshotKeyForDoc(doc) {
  return `${doc.parent?.id ?? "world"}:${doc.documentName}:${doc.id}`;
}

function addSnapshotEntry(snapshot, entry, replace = false) {
  snapshot.entries ??= [];
  const key = `${entry.sceneId ?? "world"}:${entry.documentName}:${entry.id}`;
  const idx = snapshot.entries.findIndex((existing) => `${existing.sceneId ?? "world"}:${existing.documentName}:${existing.id}` === key);
  if (idx < 0) snapshot.entries.push(entry);
  else if (replace) snapshot.entries[idx] = entry;
  else {
    const existing = snapshot.entries[idx];
    const data = flatten(existing.data ?? {});
    for (const [field, value] of Object.entries(flatten(entry.data ?? {}))) {
      if (!hasOwn(data, field)) data[field] = clone(value);
    }
    snapshot.entries[idx] = {
      ...existing,
      uuid: existing.uuid ?? entry.uuid,
      data: expand(data)
    };
  }
}

function tokenRestoreDataFromAction(action) {
  const data = {};
  for (const source of [action.restoreTo, action.before]) {
    if (!source) continue;
    for (const field of TOKEN_RESTORE_FIELDS) {
      if (getProperty(data, field) !== undefined) continue;
      const value = getProperty(source, field);
      if (value !== undefined) setProperty(data, field, clone(value));
    }
  }

  const from = action.from ?? {};
  if (getProperty(data, "x") === undefined && Number.isFinite(Number(from.x))) data.x = Number(from.x);
  if (getProperty(data, "y") === undefined && Number.isFinite(Number(from.y))) data.y = Number(from.y);

  return Object.keys(flatten(data)).length ? data : null;
}

async function recordedStartSnapshot(cue) {
  const snapshot = clone(cue?.snapshot ?? { entries: [] });
  snapshot.entries ??= [];
  for (const action of cue?.actions ?? []) {
    if (action?.type !== "moveToken") continue;
    const restoreData = tokenRestoreDataFromAction(action);
    if (!restoreData) continue;
    const docs = await resolveTargetDocuments("Token", action.token ?? action.target);
    for (const doc of docs) addSnapshotEntry(snapshot, snapshotEntry(doc, restoreData));
  }
  return snapshot;
}

async function applySnapshot(snapshot, options = {}) {
  if (!snapshot?.entries?.length) return;
  const releaseSuppression = beginRecordingSuppression();
  try {
    for (const entry of snapshot.entries) {
      await applySnapshotEntry(entry, options);
    }
  } finally {
    releaseSuppression();
  }
}

async function applySnapshotEntry(entry, options = {}) {
  const doc = await resolveDocument(entry, entry.documentName);

  if (entry.exists === false) {
    if (doc) await deleteDocument(doc);
    return;
  }

  if (!doc) {
    if (entry.documentName !== "Actor" && entry.data?._id) {
      const sc = embeddedSceneFor(entry);
      await sc?.createEmbeddedDocuments?.(entry.documentName, [clone(entry.data)], { journalCues: true });
    }
    return;
  }

  await updateDocument(doc, updateDataFromFields(entry.data), options);
}

function updateOptionsFor(doc, options = {}) {
  const base = { journalCues: true, animate: false };
  if (doc?.documentName !== "Token" || !options.teleport) return base;
  return {
    ...base,
    animation: { duration: 0 },
    bypass: true,
    isPaste: true,
    tileTeleport: true,
    constrainOptions: {
      ignoreWalls: true,
      ignoreCost: true
    }
  };
}

async function updateDocument(doc, update, options = {}) {
  if (!doc || !update || !Object.keys(flatten(update)).length) return;
  if (WORLD_DOCUMENTS.includes(doc.documentName)) {
    await doc.update(update, { journalCues: true });
    return;
  }
  const parent = doc.parent?.documentName === "Scene" ? doc.parent : embeddedSceneFor(doc);
  await parent?.updateEmbeddedDocuments?.(doc.documentName, [{ _id: doc.id, ...update }], updateOptionsFor(doc, options));
}

async function createDocument(documentName, data, sc = scene()) {
  if (!sc || !documentName || !data) return;
  const existing = data._id ? sc.getEmbeddedDocument(documentName, data._id) : null;
  if (existing) return updateDocument(existing, data);
  await sc.createEmbeddedDocuments(documentName, [clone(data)], { journalCues: true });
}

async function deleteDocument(doc) {
  if (!doc) return;
  if (doc.documentName === "Actor") return;
  const parent = doc.parent?.documentName === "Scene" ? doc.parent : embeddedSceneFor(doc);
  await parent?.deleteEmbeddedDocuments?.(doc.documentName, [doc.id], { journalCues: true });
}

function movementFields(documentName, flatChanges) {
  const fields = new Set(Object.keys(flatChanges).filter((key) => key !== "_id"));
  if (documentName === "Token" && (fields.has("x") || fields.has("y"))) {
    fields.add("x");
    fields.add("y");
    fields.add("elevation");
    fields.add("rotation");
    fields.add("hidden");
  }
  if (documentName === "Tile" && (fields.has("x") || fields.has("y"))) {
    fields.add("x");
    fields.add("y");
    fields.add("width");
    fields.add("height");
    fields.add("rotation");
    fields.add("hidden");
  }
  if (documentName === "Region" && (fields.has("x") || fields.has("y") || fields.has("shapes"))) {
    fields.add("x");
    fields.add("y");
    fields.add("shapes");
  }
  if (documentName === "Wall" && fields.has("ds")) {
    fields.add("door");
    fields.add("ds");
  }
  return Array.from(fields).filter((field) => !isNoisePath(field));
}

function doorStateName(value) {
  const states = CONST.WALL_DOOR_STATES ?? {};
  const match = Object.entries(states).find(([, numeric]) => numeric === value);
  return (match?.[0] ?? value)?.toString().toLowerCase();
}

function doorStateValue(value) {
  if (typeof value === "number") return value;
  const states = CONST.WALL_DOOR_STATES ?? {};
  const key = String(value ?? "").toUpperCase();
  return states[key] ?? states.CLOSED;
}

function doorTypeValue(value) {
  if (typeof value === "number") return value;
  const types = CONST.WALL_DOOR_TYPES ?? {};
  const key = String(value ?? "").toUpperCase();
  return types[key] ?? value;
}

function playlistSoundUpdateAction(base, soundDoc, updateData = {}) {
  const update = pickExistingFields(stripNoise(updateData), PLAYLIST_SOUND_FIELDS);
  if (!Object.keys(flatten(update)).length) return null;
  const playing = getProperty(update, "playing");
  const playlist = soundDoc?.parent?.documentName === "Playlist" ? soundDoc.parent : null;
  return {
    ...base,
    type: "playlist",
    playlistUuid: playlist?.uuid ?? base.playlistUuid,
    playlistSoundId: soundDoc?.id ?? base.playlistSoundId,
    playlistSoundUuid: soundDoc?.uuid ?? base.playlistSoundUuid ?? base.target,
    command: playing === false ? "stop" : "play",
    loop: getProperty(update, "repeat"),
    volume: getProperty(update, "volume"),
    update,
    label: `Playlist Sound: ${soundDoc?.name || base.label || base.target}`
  };
}

function playlistSoundUpdateEntries(rawSounds) {
  if (Array.isArray(rawSounds)) {
    return rawSounds.map((entry) => ({
      id: entry?._id ?? entry?.id,
      update: entry
    }));
  }
  if (!rawSounds || typeof rawSounds !== "object") return [];
  return Object.entries(rawSounds).map(([key, entry]) => ({
    id: entry?._id ?? entry?.id ?? (!String(key).startsWith("-=") ? key : null),
    update: entry
  }));
}

function choosePlaylistSoundUpdate(rawSounds) {
  const candidates = playlistSoundUpdateEntries(rawSounds).filter(({ id, update }) =>
    id
    && update
    && typeof update === "object"
    && PLAYLIST_SOUND_FIELDS.some((field) => field in update)
  );
  return candidates.find(({ update }) => getProperty(update, "playing") === true)
    ?? candidates.find(({ update }) => getProperty(update, "playing") === false)
    ?? candidates[0]
    ?? null;
}

function playlistEmbeddedSoundAction(base, playlist, flatChanges) {
  const expanded = expand(flatChanges);
  const selected = choosePlaylistSoundUpdate(expanded.sounds);
  if (!selected) return null;

  const { id, update } = selected;
  const sound = playlist.sounds?.get(id);
  return playlistSoundUpdateAction({
    ...base,
    playlistUuid: playlist.uuid,
    playlistSoundId: id,
    target: sound?.uuid ?? id,
    label: `Playlist Sound: ${sound?.name || update.name || id}`
  }, sound, update);
}

function classifyUpdateAction(doc, before, after, flatChanges) {
  const documentName = doc.documentName;
  const base = {
    id: randomId("action"),
    documentName,
    sceneId: doc.parent?.documentName === "Scene" ? doc.parent.id : null,
    target: WORLD_DOCUMENTS.includes(documentName) ? (doc.uuid ?? doc.id) : doc.id,
    label: `${documentName}: ${doc.name || doc.id}`,
    before,
    after
  };

  if (documentName === "Token" && (hasOwn(flatChanges, "x") || hasOwn(flatChanges, "y"))) {
    const from = {
      x: Number(before.x ?? doc.x ?? 0),
      y: Number(before.y ?? doc.y ?? 0)
    };
    const to = {
      x: Number(hasOwn(flatChanges, "x") ? flatChanges.x : after.x ?? doc.x ?? from.x),
      y: Number(hasOwn(flatChanges, "y") ? flatChanges.y : after.y ?? doc.y ?? from.y)
    };
    if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;
    if (from.x === to.x && from.y === to.y) return null;

    return {
      ...base,
      after: {
        ...after,
        x: to.x,
        y: to.y
      },
      type: "moveToken",
      token: doc.id,
      from,
      to,
      restoreTo: pickExistingFields({ ...before, x: from.x, y: from.y }, TOKEN_RESTORE_FIELDS),
      waypoints: [to],
      duration: DEFAULT_MOVE_DURATION_MS,
      animate: true,
      autoPath: false,
      autoDoors: true,
      closeDoors: true
    };
  }

  if (documentName === "Wall" && "ds" in after) {
    return {
      ...base,
      type: "door",
      walls: [doc.id],
      state: doorStateName(after.ds),
      label: `Door: ${doorStateName(before.ds)} to ${doorStateName(after.ds)}`
    };
  }

  if (VISIBILITY_DOCUMENTS.has(documentName) && "hidden" in after && Object.keys(after).length <= 2) {
    return {
      ...base,
      type: "visibility",
      hidden: !!after.hidden
    };
  }

  if (documentName === "AmbientLight" && ("hidden" in after || Object.keys(flatChanges).some((key) => key.startsWith("config.")))) {
    return {
      ...base,
      type: "light",
      light: doc.id,
      update: updateDataFromFields(after)
    };
  }

  if (documentName === "Playlist") {
    const playlistAction = playlistEmbeddedSoundAction(base, doc, flatChanges);
    if (playlistAction) return playlistAction;
  }

  if (documentName === "PlaylistSound" && PLAYLIST_SOUND_FIELDS.some((field) => field in after)) {
    const playlistAction = playlistSoundUpdateAction(base, doc, after);
    if (playlistAction) return playlistAction;
  }

  return {
    ...base,
    type: "document",
    before: stripNoise(before),
    after: stripNoise(after),
    update: updateDataFromFields(stripNoise(after))
  };
}

const Recorder = {
  active: false,
  ignore: false,
  ignoreDepth: 0,
  cue: null,
  sceneId: null,
  append: false,
  actions: [],
  baseline: null,
  pending: new Map(),
  chatSuppression: 0,

  async start({ cueId = null, name = null, append = false } = {}) {
    if (!game.user?.isGM) {
      ui.notifications?.warn("Only a GM can record Journal Cues.");
      return;
    }
    if (!scene()) {
      ui.notifications?.warn("Journal Cues needs an active scene.");
      return;
    }
    if (Playback.active) {
      ui.notifications?.warn("Journal Cues: stop playback before recording.");
      return;
    }
    if (this.active) await this.stop();

    let cue = cueId ? await getCue(cueId) : null;
    if (!cue) {
      cue = await createCue(name || "New Cue");
    }

    this.active = true;
    this.cue = clone(cue);
    this.sceneId = scene().id;
    this.append = !!append;
    this.actions = append ? clone(cue.actions ?? []) : [];
    this.baseline = append ? clone(cue.snapshot ?? { entries: [] }) : { entries: [] };
    this.chatSuppression = 0;
    this.pending.clear();
    ui.notifications?.info(`Journal Cues: recording "${cue.name}".`);
    refreshApp();
    return this.cue;
  },

  async stop() {
    if (!this.active || !this.cue) return;
    const cue = {
      ...this.cue,
      actions: clone(this.actions),
      snapshot: clone(this.baseline),
      updatedAt: Date.now()
    };
    this.clear({ refresh: false });
    await upsertCue(cue);
    ui.notifications?.info(`Journal Cues: saved "${cue.name}" with ${cue.actions.length} actions.`);
    refreshApp();
    return cue;
  },

  cancel() {
    if (!this.active) return;
    const name = this.cue?.name || "cue";
    this.clear();
    ui.notifications?.info(`Journal Cues: canceled recording "${name}".`);
  },

  clear({ refresh = true } = {}) {
    this.active = false;
    this.cue = null;
    this.sceneId = null;
    this.append = false;
    this.actions = [];
    this.baseline = null;
    this.chatSuppression = 0;
    this.pending.clear();
    if (refresh) refreshApp();
  },

  rememberBaseline(doc, data, exists = true, replace = false) {
    if (!this.baseline) this.baseline = { entries: [] };
    addSnapshotEntry(this.baseline, snapshotEntry(doc, data, exists), replace);
  },

  recordAction(action) {
    if (!this.active || !action) return;
    this.actions.push({
      ...action,
      selectedTokenUuids: action.selectedTokenUuids ?? selectedTokenUuids(),
      targetTokenUuids: action.targetTokenUuids ?? targetedTokenUuids(),
      recordedAt: Date.now()
    });
    refreshApp();
  },

  preUpdate(doc, changes, options) {
    if (!this.active || this.ignore || options?.journalCues) return;
    if (!shouldRecordDocument(doc)) return;
    const flatChanges = flatten(changes);
    const fields = movementFields(doc.documentName, flatChanges);
    const before = pickFields(doc, fields);
    this.pending.set(snapshotKeyForDoc(doc), before);
    this.rememberBaseline(doc, before);
  },

  update(doc, changes, options) {
    if (!this.active || this.ignore || options?.journalCues) return;
    if (!shouldRecordDocument(doc)) return;
    const flatChanges = flatten(changes);
    const fields = movementFields(doc.documentName, flatChanges);
    if (!fields.length) return;
    const key = snapshotKeyForDoc(doc);
    const before = this.pending.get(key) ?? pickFields(doc, fields);
    this.pending.delete(key);
    const after = afterFieldsFromChanges(doc, before, fields, flatChanges);
    this.recordAction(classifyUpdateAction(doc, before, after, flatChanges));
  },

  create(doc, options) {
    if (!this.active || this.ignore || options?.journalCues) return;
    if (!shouldRecordDocument(doc)) return;
    const data = doc.toObject();
    this.rememberBaseline(doc, data, false);
    this.recordAction({
      id: randomId("action"),
      type: "createDocument",
      documentName: doc.documentName,
      sceneId: doc.parent?.documentName === "Scene" ? doc.parent.id : null,
      data,
      label: `Create ${doc.documentName}: ${doc.name || doc.id}`
    });
  },

  preDelete(doc, options) {
    if (!this.active || this.ignore || options?.journalCues) return;
    if (!shouldRecordDocument(doc)) return;
    const data = doc.toObject();
    this.rememberBaseline(doc, data, true, true);
    this.pending.set(snapshotKeyForDoc(doc), data);
  },

  delete(doc, options) {
    if (!this.active || this.ignore || options?.journalCues) return;
    if (!shouldRecordDocument(doc)) return;
    const data = this.pending.get(snapshotKeyForDoc(doc)) ?? doc.toObject();
    this.recordAction({
      id: randomId("action"),
      type: "deleteDocument",
      documentName: doc.documentName,
      sceneId: doc.parent?.documentName === "Scene" ? doc.parent.id : null,
      idToDelete: doc.id,
      data,
      label: `Delete ${doc.documentName}: ${doc.name || doc.id}`
    });
  },

  recordDnd5eActivity(activity) {
    if (!this.active || this.ignore) return;
    if (!activity?.uuid) return;
    this.recordAction({
      id: randomId("action"),
      type: "useDnd5eActivity",
      activityUuid: activity.uuid,
      itemUuid: activity.item?.uuid,
      actorUuid: activity.actor?.uuid ?? activity.item?.actor?.uuid,
      selectedTokenUuids: selectedTokenUuids(),
      targetTokenUuids: targetedTokenUuids(),
      label: `Use ${activity.item?.name || "item"}${activity.name ? `: ${activity.name}` : ""}`
    });
  },

  recordMacro(macro) {
    if (!this.active || this.ignore || !macro?.uuid) return;
    this.recordAction({
      id: randomId("action"),
      type: "macro",
      macroUuid: macro.uuid,
      label: `Macro: ${macro.name || macro.id}`
    });
  },

  recordRollTable(table, data = {}) {
    if (!this.active || this.ignore || !table?.uuid) return;
    this.recordAction({
      id: randomId("action"),
      type: "rollTable",
      tableUuid: table.uuid,
      number: data.number,
      recursive: data.recursive,
      displayChat: data.displayChat,
      rollMode: data.rollMode,
      label: `Roll Table: ${table.name || table.id}`
    });
  },

  recordChatMessage(message, options = {}) {
    if (!this.active || this.ignore || options?.journalCues || this.chatSuppression > 0) return;
    if (!message?.content && !message?.rolls?.length) return;
    this.recordAction({
      id: randomId("action"),
      type: "chatMessage",
      messageData: chatMessageData(message),
      speaker: clone(message.speaker ?? {}),
      content: message.content ?? "",
      style: message.style,
      chatBubble: !!options.chatBubble || [CONST.CHAT_MESSAGE_STYLES?.IC, CONST.CHAT_MESSAGE_STYLES?.EMOTE].includes(message.style),
      label: `Chat: ${message.alias || message.speaker?.alias || message.id}`
    });
  },

  recordPing(origin, options = {}) {
    if (!this.active || this.ignore || !origin) return;
    const point = {
      x: Number(origin.x),
      y: Number(origin.y)
    };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const pingOptions = currentPingOptions(options);
    this.recordAction({
      id: randomId("action"),
      type: "ping",
      x: point.x,
      y: point.y,
      style: pingOptions.style,
      pull: !!pingOptions.pull,
      zoom: pingOptions.zoom,
      label: `Ping: ${Math.round(point.x)}, ${Math.round(point.y)}`
    });
  }
};

const Playback = {
  sessions: new Map(),

  get active() {
    return Array.from(this.sessions.values()).some((session) => session.active);
  },

  get cueId() {
    return this.activeSessions()[0]?.cueId ?? this.sessions.values().next().value?.cueId ?? null;
  },

  get currentIndex() {
    return this.get(this.cueId)?.currentIndex ?? null;
  },

  get resumeIndex() {
    return this.get(this.cueId)?.resumeIndex ?? 0;
  },

  get stopRequested() {
    return !!this.get(this.cueId)?.stopRequested;
  },

  get loopIndex() {
    return this.get(this.cueId)?.loopIndex ?? 0;
  },

  get loopLimit() {
    return this.get(this.cueId)?.loopLimit ?? 1;
  },

  activeSessions() {
    return Array.from(this.sessions.values()).filter((session) => session.active);
  },

  get(cueId) {
    return cueId ? this.sessions.get(cueId) ?? null : null;
  },

  sessionForRun(runId) {
    if (!runId) return null;
    return Array.from(this.sessions.values()).find((session) => session.runId === runId) ?? null;
  },

  start(cueId, startIndex = 0, { loopLimit = 1 } = {}) {
    const existing = this.get(cueId);
    if (existing?.active) return null;
    const session = {
      cueId,
      active: true,
      currentIndex: null,
      resumeIndex: Math.max(0, Number(startIndex) || 0),
      stopRequested: false,
      runId: randomId("play"),
      loopIndex: 0,
      loopLimit: nonNegativeNumber(loopLimit, 1)
    };
    this.sessions.set(cueId, session);
    refreshApp();
    return session.runId;
  },

  setLoop(runId, loopIndex, loopLimit = null) {
    const session = this.sessionForRun(runId);
    if (!session) return;
    session.loopIndex = nonNegativeNumber(loopIndex, 0);
    session.loopLimit = loopLimit == null ? session.loopLimit : nonNegativeNumber(loopLimit, session.loopLimit);
    refreshApp();
  },

  setCurrent(runId, index) {
    const session = this.sessionForRun(runId);
    if (!session) return;
    session.currentIndex = index;
    refreshApp();
  },

  markCompleted(runId, index) {
    const session = this.sessionForRun(runId);
    if (!session) return;
    session.resumeIndex = Math.max(session.resumeIndex, index + 1);
    refreshApp();
  },

  requestStop(cueId = null) {
    const sessions = cueId ? [this.get(cueId)].filter(Boolean) : this.activeSessions();
    const activeSessions = sessions.filter((session) => session.active);
    if (!activeSessions.length) return false;
    for (const session of activeSessions) session.stopRequested = true;
    refreshApp();
    return true;
  },

  shouldStop(runId) {
    const session = this.sessionForRun(runId);
    return !session || !session.active || session.stopRequested;
  },

  finish(runId, { completed = false } = {}) {
    const session = this.sessionForRun(runId);
    if (!session) return;
    if (completed) {
      this.sessions.delete(session.cueId);
    } else {
      session.active = false;
      session.currentIndex = null;
      session.stopRequested = false;
      session.runId = null;
    }
    refreshApp();
  },

  clear(cueId = null) {
    if (cueId) this.sessions.delete(cueId);
    else this.sessions.clear();
    refreshApp();
  }
};

function shouldRecordDocument(doc) {
  if (!doc || !RECORDED_HOOK_DOCUMENTS.includes(doc.documentName)) return false;
  if (WORLD_DOCUMENTS.includes(doc.documentName)) return true;
  const parentScene = doc.parent?.documentName === "Scene" ? doc.parent : null;
  return !Recorder.sceneId || parentScene?.id === Recorder.sceneId;
}

async function playCue(cueId, { requestedBy = game.user?.id } = {}) {
  if (!game.user?.isGM) {
    requestGM("playCue", { cueId, sceneId: scene()?.id, requestedBy });
    return;
  }

  if (Recorder.active) {
    ui.notifications?.warn("Journal Cues: stop or cancel recording before playback.");
    return;
  }

  if (Playback.get(cueId)?.active) {
    ui.notifications?.warn("Journal Cues: that cue is already playing.");
    return;
  }

  const cue = await getCue(cueId);
  if (!cue) {
    ui.notifications?.warn(`Journal Cues: cue "${cueId}" was not found on this scene.`);
    return;
  }

  const actions = cue.actions ?? [];
  if (!actions.length) {
    ui.notifications?.warn("Journal Cues: this cue has no actions.");
    return;
  }
  const existingSession = Playback.get(cueId);
  let startIndex = existingSession ? nonNegativeNumber(existingSession.resumeIndex, 0) : 0;
  if (startIndex >= actions.length) startIndex = 0;
  const loopLimit = cue.loopEnabled ? nonNegativeNumber(cue.loopLimit, 0) : 1;
  const runId = Playback.start(cueId, startIndex, { loopLimit });
  if (!runId) return;

  const releaseSuppression = beginRecordingSuppression();
  let completed = false;
  try {
    let loopsCompleted = 0;
    let nextStartIndex = startIndex;
    while (!Playback.shouldStop(runId) && (loopLimit === 0 || loopsCompleted < loopLimit)) {
      Playback.setLoop(runId, loopsCompleted + 1, loopLimit);
      if (nextStartIndex === 0 && (cue.originMode ?? "recorded") === "recorded") {
        await applySnapshot(await recordedStartSnapshot(cue), { teleport: true });
      }

      for (let index = nextStartIndex; index < actions.length;) {
        if (Playback.shouldStop(runId)) break;
        const group = concurrentActionGroup(actions, index);
        Playback.setCurrent(runId, index);
        const results = await Promise.all(group.map((entry) => runAction(entry.action, cue, { runId })));
        for (const [groupIndex, actionCompleted] of results.entries()) {
          if (actionCompleted) Playback.markCompleted(runId, group[groupIndex].index);
        }
        if (results.some((result) => !result)) break;
        if (Playback.shouldStop(runId)) break;
        index += group.length;
      }

      const session = Playback.sessionForRun(runId);
      if (Playback.shouldStop(runId) || !session || session.resumeIndex < actions.length) break;
      loopsCompleted += 1;
      if (loopLimit === 0 || loopsCompleted < loopLimit) {
        session.resumeIndex = 0;
        nextStartIndex = 0;
      }
    }
    completed = !Playback.shouldStop(runId) && loopLimit !== 0 && loopsCompleted >= loopLimit;
  } catch (error) {
    console.error(`[${MODULE_ID}] cue playback failed`, cue, error);
    ui.notifications?.error(`Journal Cues: playback failed. See console for details.`);
  } finally {
    releaseSuppression();
    Playback.finish(runId, { completed });
  }
}

async function stopCue(cueId) {
  if (!game.user?.isGM) {
    requestGM("stopCue", { cueId, sceneId: scene()?.id });
    return;
  }
  if (!Playback.requestStop(cueId)) ui.notifications?.warn("Journal Cues: that cue is not currently playing.");
}

async function restoreRecordedStart(cueId) {
  if (!game.user?.isGM) {
    requestGM("restoreRecordedStart", { cueId, sceneId: scene()?.id });
    return;
  }
  const cue = await getCue(cueId);
  if (!cue) return;
  await applySnapshot(await recordedStartSnapshot(cue), { teleport: true });
  const playback = Playback.get(cueId);
  if (playback && !playback.active) Playback.clear(cueId);
}

function canRunActionConcurrently(action) {
  if (action?.type !== "moveToken" || action.parallel === false) return false;
  if (Number(action.waitBefore ?? 0) > 0) return false;
  if (Number(action.waitAfter ?? 0) > 0) return false;
  return true;
}

function concurrentMoveTargetKey(action) {
  const target = action.token ?? action.target ?? action.id;
  return Array.isArray(target) ? target.join("|") : String(target);
}

function concurrentActionGroup(actions, startIndex) {
  const first = actions[startIndex];
  if (!canRunActionConcurrently(first)) return [{ action: first, index: startIndex }];

  const group = [];
  const targetKeys = new Set();
  for (let index = startIndex; index < actions.length; index += 1) {
    const action = actions[index];
    if (!canRunActionConcurrently(action)) break;
    const key = concurrentMoveTargetKey(action);
    if (targetKeys.has(key)) break;
    targetKeys.add(key);
    group.push({ action, index });
  }
  return group.length ? group : [{ action: first, index: startIndex }];
}

async function runAction(action, cue, context = {}) {
  const waitBefore = Number(action.waitBefore ?? 0);
  if (waitBefore > 0 && !(await playbackSleep(waitBefore, context.runId))) return false;

  switch (action.type) {
    case "wait":
      if (!(await playbackSleep(action.ms ?? action.duration ?? 500, context.runId))) return false;
      break;
    case "moveToken":
      if (!(await runMoveToken(action, cue))) return false;
      break;
    case "door":
      await runDoorAction(action);
      break;
    case "visibility":
      await runVisibilityAction(action);
      break;
    case "light":
      await runLightAction(action);
      break;
    case "document":
      await runDocumentAction(action);
      break;
    case "createDocument":
      await createDocument(action.documentName, action.data, embeddedSceneFor(action));
      break;
    case "deleteDocument": {
      const doc = await resolveDocument({ documentName: action.documentName, id: action.idToDelete, sceneId: action.sceneId }, action.documentName);
      await deleteDocument(doc);
      break;
    }
    case "camera":
      await runLocalOrBroadcast(action);
      break;
    case "image":
      await runLocalOrBroadcast(action);
      break;
    case "audio":
      await runAudioAction(action);
      break;
    case "playlist":
      await runPlaylistAction(action);
      break;
    case "useDnd5eActivity":
      await runDnd5eActivity(action);
      break;
    case "macro":
      await runMacroAction(action);
      break;
    case "rollTable":
      await runRollTableAction(action);
      break;
    case "chatMessage":
      await runChatMessageAction(action);
      break;
    case "portrait":
      await runPortraitAction(action);
      break;
    case "ping":
      await runPingAction(action);
      break;
    default:
      console.warn(`[${MODULE_ID}] Unknown cue action type`, action);
  }

  const waitAfter = nonNegativeNumber(action.waitAfter, action.type === "wait" ? 0 : cueDefaultDelayMs(cue));
  if (waitAfter > 0) await playbackSleep(waitAfter, context.runId);
  return true;
}

async function runDocumentAction(action) {
  const docs = await resolveTargetDocuments(action.documentName, action.target);
  const update = action.update ?? updateDataFromFields(action.after ?? {});
  for (const doc of docs) await updateDocument(doc, update);
}

async function runVisibilityAction(action) {
  const docs = await resolveTargetDocuments(action.documentName, action.target);
  for (const doc of docs) await updateDocument(doc, { hidden: !!action.hidden });
}

async function runLightAction(action) {
  const docs = await resolveTargetDocuments("AmbientLight", action.light ?? action.target);
  const update = action.update ?? { hidden: action.hidden };
  for (const doc of docs) await updateDocument(doc, update);
}

async function runDoorAction(action) {
  const docs = await resolveTargetDocuments("Wall", action.walls ?? action.target);
  const update = {};
  if (action.state != null) update.ds = doorStateValue(action.state);
  if (action.doorType != null) update.door = doorTypeValue(action.doorType);
  if (!Object.keys(update).length) return;
  for (const doc of docs) await updateDocument(doc, update);
}

async function runAudioAction(action) {
  if (action.scope === "all" && game.user?.isGM) emitLocalAction(action);
  if (action.src) {
    const rawVolume = Number(action.volume ?? 0.8);
    foundry.audio.AudioHelper.play({
      src: action.src,
      volume: Math.max(0, Math.min(1, Number.isFinite(rawVolume) ? rawVolume : 0.8)),
      loop: !!action.loop
    }, false);
  }
}

async function resolvePlaylistActionDocument(action) {
  const playlist = action.playlistUuid
    ? await resolveDocument(action.playlistUuid, "Playlist")
    : null;
  if (playlist && action.playlistSoundId) {
    const sound = playlist.sounds?.get(action.playlistSoundId);
    if (sound) return sound;
  }
  if (action.playlistSoundUuid) {
    const sound = await resolveDocument(action.playlistSoundUuid, "PlaylistSound");
    if (sound) return sound;
  }
  if (action.playlistSoundId) {
    const sound = await resolveDocument({ documentName: "PlaylistSound", id: action.playlistSoundId });
    if (sound) return sound;
  }
  return playlist ?? (await resolveDocument(action.playlistUuid ?? action.uuid ?? action.target));
}

async function runPlaylistAction(action) {
  const doc = await resolvePlaylistActionDocument(action);
  if (!doc) return;
  const command = action.command ?? "play";
  if (doc.documentName === "Playlist") {
    if (command === "stop") await doc.stopAll();
    else if (command === "next") await doc.playNext();
    else if (command === "previous") await doc.playNext(null, { direction: -1 });
    else await doc.playAll({ volume: action.volume });
    return;
  }
  if (doc.documentName === "PlaylistSound") {
    if (action.update) await doc.update(action.update, { journalCues: true });
    else if (command === "stop") await doc.update({ playing: false, pausedTime: 0 }, { journalCues: true });
    else await doc.update({ playing: true, repeat: !!action.loop, volume: action.volume ?? doc.volume }, { journalCues: true });
  }
}

async function runDnd5eActivity(action) {
  await restoreControlledTokens(action.selectedTokenUuids);
  await restoreTokenTargets(action.targetTokenUuids);
  const activity = await resolveDocument(action.activityUuid);
  if (activity?.use) {
    await activity.use();
    return;
  }
  const item = await resolveDocument(action.itemUuid);
  if (item?.use) await item.use();
}

async function restoreTokenTargets(tokenUuids = []) {
  if (!Array.isArray(tokenUuids) || !tokenUuids.length) return;
  const targetIds = [];
  for (const uuid of tokenUuids) {
    const tokenDoc = await resolveDocument(uuid, "Token");
    if (tokenDoc?.id && tokenDoc.parent?.id === scene()?.id) targetIds.push(tokenDoc.id);
  }
  if (game.user?.updateTokenTargets) {
    game.user.updateTokenTargets(targetIds);
    game.user.broadcastActivity?.({ targets: targetIds });
    return;
  }
  for (const token of canvas.tokens?.placeables ?? []) token.setTarget(targetIds.includes(token.id), { releaseOthers: false, groupSelection: true });
}

async function restoreControlledTokens(tokenUuids = []) {
  if (!Array.isArray(tokenUuids) || !tokenUuids.length) return;
  canvas.tokens?.releaseAll?.();
  for (const uuid of tokenUuids) {
    const tokenDoc = await resolveDocument(uuid, "Token");
    tokenDoc?.object?.control?.({ releaseOthers: false });
  }
}

async function runMacroAction(action) {
  await restoreControlledTokens(action.selectedTokenUuids);
  await restoreTokenTargets(action.targetTokenUuids);
  const macro = await resolveDocument(action.macroUuid ?? action.uuid);
  if (!macro?.execute) {
    ui.notifications?.warn(`Journal Cues: macro was not found for "${action.label || action.macroUuid || action.uuid}".`);
    return;
  }
  try {
    await macro.execute(action.args ?? {});
  } catch (error) {
    console.warn(`[${MODULE_ID}] macro action failed`, action, error);
    ui.notifications?.warn(`Journal Cues: macro "${macro.name || macro.id}" failed. Continuing cue playback.`);
    if (action.stopOnError) throw error;
  }
}

async function runRollTableAction(action) {
  const table = await resolveDocument(action.tableUuid ?? action.uuid, "RollTable");
  if (!table) return;
  const options = {
    recursive: action.recursive !== false,
    displayChat: action.displayChat !== false,
    rollMode: action.rollMode
  };
  const number = nonNegativeNumber(action.number, 1);
  if (number > 1 && table.drawMany) await table.drawMany(number, options);
  else if (table.draw) await table.draw(options);
}

async function runChatMessageAction(action) {
  const data = stripNoise(action.messageData ?? {
    speaker: action.speaker,
    content: action.content,
    style: action.style
  });
  if (!data.content && !data.rolls?.length) return;
  const ChatMessageClass = CONFIG.ChatMessage?.documentClass ?? foundry.documents.ChatMessage;
  await ChatMessageClass.create(data, {
    journalCues: true,
    chatBubble: action.chatBubble !== false
  });
}

async function runPortraitAction(action) {
  const actor = await resolveDocument(action.actorUuid ?? action.actor, "Actor");
  if (!actor) return;

  if (game.modules.get("ginzzzu-portraits")?.active && globalThis.GinzzzuPortraits?.togglePortrait) {
    if (action.mode === "toggle" || action.shown == null) {
      await globalThis.GinzzzuPortraits.togglePortrait(actor);
    } else {
      await actor.update({ "flags.ginzzzu-portraits.portraitShown": !!action.shown }, { journalCues: true });
    }
    return;
  }

  if (action.image || actor.img) {
    await runLocalOrBroadcast({ type: "image", src: action.image || actor.img, title: action.title || actor.name, scope: action.scope });
  }
}

async function runPingAction(action) {
  if (!canvas?.ping) return;
  const x = Number(action.x ?? action.to?.x);
  const y = Number(action.y ?? action.to?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const options = {
    style: action.style,
    pull: !!action.pull,
    zoom: action.zoom,
    duration: action.duration,
    name: action.name
  };
  await canvas.ping(
    { x, y },
    Object.fromEntries(Object.entries(options).filter(([, value]) => value != null))
  );
}

async function runLocalOrBroadcast(action) {
  if (action.scope === "all" && game.user?.isGM) emitLocalAction(action);
  await runLocalAction(action);
}

async function runLocalAction(action) {
  if (action.type === "camera") {
    const target = await resolveDestination(action.to ?? action.target);
    const pan = {
      x: target?.x ?? action.x,
      y: target?.y ?? action.y,
      scale: action.scale,
      duration: action.duration ?? 500
    };
    await canvas.animatePan(Object.fromEntries(Object.entries(pan).filter(([, value]) => value != null)));
  } else if (action.type === "image") {
    const src = action.src ?? action.image;
    if (!src) return;
    if (globalThis.ImagePopout) new ImagePopout(src, { title: action.title || "Journal Cue" }).render(true);
    else {
      new Dialog({
        title: action.title || "Journal Cue",
        content: `<img src="${src}" style="max-width:100%;height:auto;">`,
        buttons: { close: { label: "Close" } }
      }).render(true);
    }
  } else if (action.type === "audio") {
    await runAudioAction({ ...action, scope: "local" });
  }
}

async function focusDocumentTarget({ documentName, target, sceneId }) {
  if (!documentName || !target) return;
  const ref = String(target).includes(".")
    ? target
    : { documentName, id: target, sceneId };
  const doc = await resolveDocument(ref, documentName);
  if (!doc) {
    ui.notifications?.warn("Journal Cues: target document was not found.");
    return;
  }

  if (doc.documentName === "Actor") {
    if (doc.sheet?.rendered) doc.sheet.bringToTop?.();
    else doc.sheet?.render(true);
    return;
  }

  if (doc.parent?.documentName === "Scene" && doc.parent.id !== scene()?.id) {
    ui.notifications?.warn("Journal Cues: that target is on another scene.");
    return;
  }

  const object = doc.object;
  if (doc.documentName === "Token" && object) {
    canvas.tokens?.releaseAll?.();
    object.control?.({ releaseOthers: true });
  }

  const point = object?.center
    ?? (Array.isArray(doc.c) ? { x: (doc.c[0] + doc.c[2]) / 2, y: (doc.c[1] + doc.c[3]) / 2 } : null)
    ?? {
      x: Number(doc.x ?? 0) + Number(doc.width ?? 0) / 2,
      y: Number(doc.y ?? 0) + Number(doc.height ?? 0) / 2
    };
  await canvas.animatePan({
    x: point.x,
    y: point.y,
    duration: 350
  });
}

let actionPreviewGraphic = null;
let actionPreviewToken = 0;

function actionPreviewLayer() {
  return canvas?.controls ?? canvas?.interface ?? canvas?.stage ?? null;
}

function clearActionPreview() {
  actionPreviewToken += 1;
  if (!actionPreviewGraphic) return;
  try {
    actionPreviewGraphic.parent?.removeChild?.(actionPreviewGraphic);
    actionPreviewGraphic.destroy?.({ children: true });
  } catch (error) {
    console.warn(`[${MODULE_ID}] failed to clear action preview`, error);
  }
  actionPreviewGraphic = null;
}

function drawPreviewMarker(graphic, point, { color = 0xc96c2c, radius = null } = {}) {
  if (!point) return;
  const size = Math.max(40, radius ?? ((canvas.grid?.size ?? canvas.scene?.grid?.size ?? 100) * 0.42));
  graphic.lineStyle(3, color, 0.95);
  graphic.beginFill(color, 0.14);
  graphic.drawCircle(point.x, point.y, size);
  graphic.endFill();
  graphic.moveTo(point.x - size * 0.6, point.y);
  graphic.lineTo(point.x + size * 0.6, point.y);
  graphic.moveTo(point.x, point.y - size * 0.6);
  graphic.lineTo(point.x, point.y + size * 0.6);
}

function documentPreviewPoint(doc) {
  const object = doc?.object;
  if (object?.center) return object.center;
  if (Array.isArray(doc?.c) && doc.c.length >= 4) {
    return { x: (Number(doc.c[0]) + Number(doc.c[2])) / 2, y: (Number(doc.c[1]) + Number(doc.c[3])) / 2 };
  }
  if (Number.isFinite(Number(doc?.x)) || Number.isFinite(Number(doc?.y))) {
    const size = canvas.grid?.size ?? canvas.scene?.grid?.size ?? 100;
    return {
      x: Number(doc.x ?? 0) + (Number(doc.width ?? 1) * size) / 2,
      y: Number(doc.y ?? 0) + (Number(doc.height ?? 1) * size) / 2
    };
  }
  return null;
}

async function showActionPreview(action) {
  clearActionPreview();
  if (!action || !canvas?.ready || !globalThis.PIXI) return;
  const token = ++actionPreviewToken;
  const layer = actionPreviewLayer();
  if (!layer?.addChild) return;
  const graphic = new PIXI.Graphics();
  graphic.name = `${MODULE_ID}-action-preview`;
  graphic.eventMode = "none";
  graphic.zIndex = 9999;
  const abandon = () => graphic.destroy?.({ children: true });

  try {
    if (action.type === "moveToken") {
      const tokens = await resolveTargetDocuments("Token", action.token ?? action.target);
      if (token !== actionPreviewToken) {
        abandon();
        return;
      }
      const targetToken = tokens[0];
      const from = targetToken ? tokenCenter(targetToken, action.from ?? targetToken) : action.from;
      const destination = await resolveDestination(action.to ?? action.waypoints?.at?.(-1));
      if (!from || !destination) {
        abandon();
        return;
      }
      const to = targetToken ? tokenCenter(targetToken, destination) : destination;
      graphic.lineStyle(4, 0x2f6f73, 0.9);
      graphic.moveTo(from.x, from.y);
      graphic.lineTo(to.x, to.y);
      drawPreviewMarker(graphic, from, { color: 0x2f6f73, radius: (canvas.grid?.size ?? 100) * 0.25 });
      drawPreviewMarker(graphic, to, { color: 0xc96c2c });
    } else if (action.type === "ping" || action.type === "camera") {
      const point = action.type === "ping"
        ? { x: Number(action.x), y: Number(action.y) }
        : await resolveDestination(action.to ?? action.target ?? action);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        abandon();
        return;
      }
      drawPreviewMarker(graphic, point, { color: action.type === "ping" ? 0xc96c2c : 0x3d7a45 });
    } else {
      const link = actionLink(action);
      if (!link) {
        abandon();
        return;
      }
      const doc = await resolveDocument({ documentName: link.documentName, id: link.target, sceneId: link.sceneId }, link.documentName);
      if (token !== actionPreviewToken) {
        abandon();
        return;
      }
      const point = documentPreviewPoint(doc);
      if (!point) {
        abandon();
        return;
      }
      drawPreviewMarker(graphic, point, { color: 0x3d7a45 });
    }

    if (token !== actionPreviewToken) {
      abandon();
      return;
    }
    layer.addChild(graphic);
    actionPreviewGraphic = graphic;
  } catch (error) {
    console.warn(`[${MODULE_ID}] failed to show action preview`, action, error);
    graphic.destroy?.({ children: true });
  }
}

function emitLocalAction(action) {
  game.socket?.emit(SOCKET_NAME, {
    type: "localAction",
    sceneId: scene()?.id,
    originUserId: game.user?.id,
    action
  });
}

async function runMoveToken(action, cue) {
  const tokens = await resolveTargetDocuments("Token", action.token ?? action.target);
  if (!tokens.length) {
    ui.notifications?.warn(`Journal Cues: token was not found for "${action.label || action.token || action.target}".`);
    return false;
  }
  const results = await Promise.all(tokens.map((token) => moveOneToken(token, action, cue)));
  return results.every(Boolean);
}

async function resolveDestination(destination) {
  if (!destination) return null;
  if (typeof destination === "object" && Number.isFinite(Number(destination.x)) && Number.isFinite(Number(destination.y))) {
    return { x: Number(destination.x), y: Number(destination.y) };
  }
  const doc = await resolveDocument(destination);
  if (!doc) return null;
  if (doc.documentName === "Token" || doc.documentName === "Tile" || doc.documentName === "AmbientLight" || doc.documentName === "AmbientSound" || doc.documentName === "Region") {
    return { x: Number(doc.x ?? 0), y: Number(doc.y ?? 0) };
  }
  return null;
}

async function moveOneToken(token, action, cue) {
  const mode = action.originMode ?? cue.originMode ?? "recorded";
  const recordedFrom = action.from ?? { x: token.x, y: token.y };
  const current = { x: token.x, y: token.y };
  const offset = mode === "current"
    ? { x: current.x - recordedFrom.x, y: current.y - recordedFrom.y }
    : { x: 0, y: 0 };

  if (mode === "recorded" && action.from && (action.teleportToFrom === true || action.forceFrom === true)) {
    await updateDocument(token, { x: action.from.x, y: action.from.y }, { teleport: true });
    await sleep(75);
  }

  let points = [];
  if (Array.isArray(action.waypoints) && action.waypoints.length) points = action.waypoints;
  else if (action.to) points = [action.to];

  const resolved = [];
  for (const point of points) {
    const dest = await resolveDestination(point);
    if (dest) resolved.push({ x: dest.x + offset.x, y: dest.y + offset.y });
  }
  if (!resolved.length) return true;

  for (const destination of resolved) {
    const path = action.autoPath
      ? findTokenPath(token, { x: token.x, y: token.y }, destination, action)
      : [destination];
    for (const step of path) {
      if (!(await moveTokenStep(token, step, action))) return false;
    }
  }
  return true;
}

async function moveTokenStep(token, destination, action) {
  const segment = segmentInfoForToken(token, { x: token.x, y: token.y }, destination, {
    allowDoors: !!action.autoDoors,
    allowSecretDoors: !!action.allowSecretDoors,
    allowLockedDoors: !!action.allowLockedDoors
  });
  if (segment.blocked) {
    ui.notifications?.warn(`Journal Cues: token movement blocked for ${token.name || token.id}.`);
    return false;
  }

  const opened = [];
  if (action.autoDoors && segment.doors.length) {
    for (const wall of segment.doors) {
      const doc = wallDocument(wall);
      if (!doc) continue;
      opened.push({ id: doc.id, ds: doc.ds });
      await updateDocument(doc, { ds: CONST.WALL_DOOR_STATES.OPEN });
    }
    await sleep(75);
  }

  let moved = false;
  try {
    moved = await moveTokenAnimated(token, destination, {
      ...action,
      ignoreFoundryWallConstraint: segment.crossedDoor
    });
  } finally {
    if (action.closeDoors) {
      for (const door of opened) {
        if (door.ds !== CONST.WALL_DOOR_STATES.OPEN) {
          const wall = embeddedSceneFor({})?.getEmbeddedDocument("Wall", door.id);
          if (wall) await updateDocument(wall, { ds: door.ds });
        }
      }
    }
  }
  return moved;
}

async function moveTokenAnimated(token, destination, action) {
  const x = Math.round(destination.x);
  const y = Math.round(destination.y);
  const duration = nonNegativeNumber(action.duration, DEFAULT_MOVE_DURATION_MS);
  const shouldAnimate = action.animate !== false;

  if (!shouldAnimate) {
    await updateDocument(token, { x, y });
    return true;
  }

  if (typeof token.move === "function") {
    try {
      const moveOptions = {
        journalCues: true,
        animate: true,
        animation: { duration },
        method: "api",
        autoRotate: false,
        showRuler: false
      };
      if (action.ignoreFoundryWallConstraint) moveOptions.constrainOptions = { ignoreWalls: true };

      const moved = await token.move({ x, y, explicit: true, checkpoint: true }, moveOptions);
      if (moved === false) {
        ui.notifications?.warn(`Journal Cues: token movement blocked for ${token.name || token.id}.`);
        return false;
      }
      await waitForTokenMovementAnimation(token, duration);
      return true;
    } catch (error) {
      console.warn(`[${MODULE_ID}] Token movement API failed`, error);
      ui.notifications?.warn(`Journal Cues: token movement failed for ${token.name || token.id}. Playback paused.`);
      return false;
    }
  }

  await updateDocument(token, { x, y });
  if (duration > 0) await sleep(duration);
  return true;
}

async function waitForTokenMovementAnimation(token, duration) {
  const promise = token.object?.movementAnimationPromise;
  if (!promise) {
    if (duration > 0) await sleep(duration);
    return;
  }

  try {
    await Promise.race([promise, sleep(Math.max(duration + 250, 250))]);
  } catch (error) {
    console.warn(`[${MODULE_ID}] Token movement animation ended with an error`, error);
  }
}

function tokenCenter(token, pos = token) {
  const size = canvas.grid?.size ?? canvas.scene?.grid?.size ?? 100;
  return {
    x: Number(pos.x ?? token.x) + (Number(token.width ?? 1) * size) / 2,
    y: Number(pos.y ?? token.y) + (Number(token.height ?? 1) * size) / 2
  };
}

function findTokenPath(token, start, end, action = {}) {
  const grid = canvas.grid?.size ?? canvas.scene?.grid?.size ?? 100;
  const margin = Math.max(8, Number(action.pathMargin ?? 20));
  const minX = Math.max(0, Math.floor((Math.min(start.x, end.x) / grid) - margin));
  const maxX = Math.ceil((Math.max(start.x, end.x) / grid) + margin);
  const minY = Math.max(0, Math.floor((Math.min(start.y, end.y) / grid) - margin));
  const maxY = Math.ceil((Math.max(start.y, end.y) / grid) + margin);

  const snap = (p) => ({ x: Math.round(p.x / grid), y: Math.round(p.y / grid) });
  const unsnap = (n) => ({ x: n.x * grid, y: n.y * grid });
  const startNode = snap(start);
  const endNode = snap(end);
  const key = (n) => `${n.x},${n.y}`;
  const heuristic = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const open = new Map([[key(startNode), { node: startNode, g: 0, f: heuristic(startNode, endNode), prev: null }]]);
  const closed = new Set();
  const nodes = new Map(open);
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  while (open.size) {
    let currentKey = null;
    let current = null;
    for (const [candidateKey, candidate] of open) {
      if (!current || candidate.f < current.f) {
        currentKey = candidateKey;
        current = candidate;
      }
    }
    if (!current) break;
    if (current.node.x === endNode.x && current.node.y === endNode.y) {
      const path = [];
      let cursor = current;
      while (cursor?.prev) {
        path.unshift(unsnap(cursor.node));
        cursor = cursor.prev;
      }
      path[path.length - 1] = end;
      return simplifyPath(token, start, path, action);
    }

    open.delete(currentKey);
    closed.add(currentKey);

    for (const [dx, dy] of dirs) {
      const next = { x: current.node.x + dx, y: current.node.y + dy };
      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) continue;
      const nextKey = key(next);
      if (closed.has(nextKey)) continue;

      const fromPos = unsnap(current.node);
      const toPos = unsnap(next);
      if (segmentInfoForToken(token, fromPos, toPos, {
        allowDoors: !!action.autoDoors,
        allowSecretDoors: !!action.allowSecretDoors,
        allowLockedDoors: !!action.allowLockedDoors
      }).blocked) continue;

      const cost = current.g + Math.hypot(dx, dy);
      const known = nodes.get(nextKey);
      if (!known || cost < known.g) {
        const record = { node: next, g: cost, f: cost + heuristic(next, endNode), prev: current };
        nodes.set(nextKey, record);
        open.set(nextKey, record);
      }
    }
  }

  return [end];
}

function simplifyPath(token, start, path, action) {
  if (path.length <= 2) return path;
  const simplified = [];
  let anchor = start;
  for (let i = 1; i < path.length; i++) {
    const candidate = path[i];
    const info = segmentInfoForToken(token, anchor, candidate, {
      allowDoors: !!action.autoDoors,
      allowSecretDoors: !!action.allowSecretDoors,
      allowLockedDoors: !!action.allowLockedDoors
    });
    if (info.blocked) {
      simplified.push(path[i - 1]);
      anchor = path[i - 1];
    }
  }
  simplified.push(path[path.length - 1]);
  return simplified;
}

function segmentInfoForToken(token, from, to, options = {}) {
  const a = tokenCenter(token, from);
  const b = tokenCenter(token, to);
  return segmentInfo(a, b, {
    ...options,
    levelId: options.levelId ?? tokenLevelId(token)
  });
}

function segmentInfo(a, b, options = {}) {
  const result = { blocked: false, doors: [], crossedDoor: false };
  const crossed = [];
  const walls = wallListForCollision();

  for (const wall of walls) {
    if (!wallAppliesToLevel(wall, options.levelId)) continue;
    if (!wallBlocksMovement(wall)) continue;
    const c = wallCoords(wall);
    if (c.length < 4) continue;
    const endpoints = [{ x: Number(c[0]), y: Number(c[1]) }, { x: Number(c[2]), y: Number(c[3]) }];
    const point = segmentIntersectionPoint(a, b, endpoints[0], endpoints[1]);
    if (!point) continue;
    crossed.push({ wall, point, endpoints });
  }

  const passableDoors = crossed.filter((entry) => wallIsPassableDoor(entry.wall, options));
  result.crossedDoor = passableDoors.length > 0;
  for (const entry of passableDoors) {
    const doc = wallDocument(entry.wall);
    if (doc?.ds !== CONST.WALL_DOOR_STATES.OPEN) result.doors.push(doc);
  }

  for (const entry of crossed) {
    if (wallIsPassableDoor(entry.wall, options)) continue;
    if (passableDoors.some((door) => wallSharesPassableDoorEndpoint(entry, door))) continue;
    result.blocked = true;
    result.blockingWall = wallDocument(entry.wall);
    return result;
  }
  return result;
}

function wallListForCollision() {
  const placeables = canvas?.walls?.placeables;
  if (Array.isArray(placeables) && placeables.length) return placeables;

  const walls = embeddedSceneFor({})?.walls;
  if (!walls) return [];
  if (Array.isArray(walls)) return walls;
  if (typeof walls.values === "function") return Array.from(walls.values());
  return Array.from(walls);
}

function wallDocument(wall) {
  return wall?.document ?? wall;
}

function wallCoords(wall) {
  const doc = wallDocument(wall);
  const coords = doc?.c ?? wall?.c ?? wall?.coords ?? [];
  return Array.isArray(coords) ? coords : [];
}

function wallBlocksMovement(wall) {
  const doc = wallDocument(wall);
  if (!doc) return false;
  const movementTypes = CONST.WALL_MOVEMENT_TYPES ?? {};
  if (doc.move === movementTypes.NONE) return false;
  return true;
}

function wallIsPassableDoor(wall, options = {}) {
  const doc = wallDocument(wall);
  if (!doc) return false;
  const types = CONST.WALL_DOOR_TYPES ?? {};
  const states = CONST.WALL_DOOR_STATES ?? {};
  if (doc.door == null || (doc.door !== types.DOOR && doc.door !== types.SECRET)) return false;
  if (doc.ds === states.OPEN) return true;
  if (!options.allowDoors) return false;
  if (doc.door === types.SECRET && !options.allowSecretDoors) return false;
  if (doc.ds === states.LOCKED && !options.allowLockedDoors) return false;
  return true;
}

function tokenLevelId(token) {
  const doc = token?.document ?? token;
  if (!doc) return null;
  return token?.level
    ?? doc?.level
    ?? getProperty(doc, "flags.levels.level")
    ?? getProperty(doc, "flags.levels.currentLevel")
    ?? null;
}

function wallAppliesToLevel(wall, levelId) {
  if (!levelId) return true;
  const doc = wallDocument(wall);
  const levels = doc?.levels;
  if (!levels) return true;
  if (Array.isArray(levels)) return !levels.length || levels.includes(levelId);
  if (typeof levels.size === "number" && levels.size === 0) return true;
  if (typeof levels.has === "function") return levels.has(levelId);
  return true;
}

function wallSharesPassableDoorEndpoint(blocker, door) {
  return door.endpoints.some((doorEndpoint) => (
    samePoint(blocker.point, doorEndpoint)
    && blocker.endpoints.some((blockerEndpoint) => samePoint(blockerEndpoint, doorEndpoint))
  ));
}

function samePoint(a, b, epsilon = WALL_INTERSECTION_EPSILON) {
  return Math.abs(Number(a?.x) - Number(b?.x)) <= epsilon
    && Math.abs(Number(a?.y) - Number(b?.y)) <= epsilon;
}

function segmentIntersectionPoint(a, b, c, d) {
  const points = [a, b, c, d];
  if (points.some((p) => !Number.isFinite(Number(p?.x)) || !Number.isFinite(Number(p?.y)))) return null;

  const ax = Number(a.x);
  const ay = Number(a.y);
  const bx = Number(b.x);
  const by = Number(b.y);
  const cx = Number(c.x);
  const cy = Number(c.y);
  const dx = Number(d.x);
  const dy = Number(d.y);
  const denominator = ((bx - ax) * (dy - cy)) - ((by - ay) * (dx - cx));

  if (Math.abs(denominator) > Number.EPSILON) {
    const t = (((cx - ax) * (dy - cy)) - ((cy - ay) * (dx - cx))) / denominator;
    const u = (((cx - ax) * (by - ay)) - ((cy - ay) * (bx - ax))) / denominator;
    if (t >= -Number.EPSILON && t <= 1 + Number.EPSILON && u >= -Number.EPSILON && u <= 1 + Number.EPSILON) {
      return { x: ax + (t * (bx - ax)), y: ay + (t * (by - ay)) };
    }
    return null;
  }

  for (const point of [a, b]) {
    if (pointOnSegment(c, point, d) && pointOnSegment(a, point, b)) return { x: Number(point.x), y: Number(point.y) };
  }
  for (const point of [c, d]) {
    if (pointOnSegment(a, point, b) && pointOnSegment(c, point, d)) return { x: Number(point.x), y: Number(point.y) };
  }
  return null;
}

function pointOnSegment(a, point, b, epsilon = WALL_INTERSECTION_EPSILON) {
  const px = Number(point.x);
  const py = Number(point.y);
  const ax = Number(a.x);
  const ay = Number(a.y);
  const bx = Number(b.x);
  const by = Number(b.y);
  const cross = ((px - ax) * (by - ay)) - ((py - ay) * (bx - ax));
  if (Math.abs(cross) > epsilon) return false;
  return px >= Math.min(ax, bx) - epsilon
    && px <= Math.max(ax, bx) + epsilon
    && py >= Math.min(ay, by) - epsilon
    && py <= Math.max(ay, by) + epsilon;
}

function segmentsIntersect(a, b, c, d) {
  return !!segmentIntersectionPoint(a, b, c, d);
}

function beginRecordingSuppression({ suppressChat = false } = {}) {
  Recorder.ignoreDepth = (Recorder.ignoreDepth ?? 0) + 1;
  Recorder.ignore = true;
  if (suppressChat) Recorder.chatSuppression += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (suppressChat) {
      Recorder.chatSuppression = Math.max(0, Recorder.chatSuppression - 1);
    }
    Recorder.ignoreDepth = Math.max(0, (Recorder.ignoreDepth ?? 0) - 1);
    Recorder.ignore = Recorder.ignoreDepth > 0;
  };
}

function runWithRecordingSuppressed(callback) {
  const release = beginRecordingSuppression({ suppressChat: true });
  try {
    const result = callback();
    if (result && typeof result.then === "function") return result.finally(release);
    release();
    return result;
  } catch (error) {
    release();
    throw error;
  }
}

function patchMacroRecording() {
  const MacroClass = CONFIG.Macro?.documentClass ?? foundry.documents?.Macro;
  if (!MacroClass?.prototype?.execute || MacroClass.prototype._journalCuesPatchedExecute) return;
  const original = MacroClass.prototype.execute;
  MacroClass.prototype.execute = function(scope = {}) {
    const shouldRecord = Recorder.active && !Recorder.ignore;
    if (shouldRecord) Recorder.recordMacro(this);
    return shouldRecord
      ? runWithRecordingSuppressed(() => original.call(this, scope))
      : original.call(this, scope);
  };
  Object.defineProperty(MacroClass.prototype, "_journalCuesPatchedExecute", { value: true, configurable: true });
}

function patchRollTableRecording() {
  const TableClass = CONFIG.RollTable?.documentClass ?? foundry.documents?.RollTable;
  if (!TableClass?.prototype || TableClass.prototype._journalCuesPatchedDraw) return;

  if (typeof TableClass.prototype.draw === "function") {
    const originalDraw = TableClass.prototype.draw;
    TableClass.prototype.draw = function(options = {}) {
      const shouldRecord = Recorder.active && !Recorder.ignore;
      if (shouldRecord) Recorder.recordRollTable(this, {
        recursive: options.recursive,
        displayChat: options.displayChat,
        rollMode: options.rollMode
      });
      return shouldRecord
        ? runWithRecordingSuppressed(() => originalDraw.call(this, options))
        : originalDraw.call(this, options);
    };
  }

  if (typeof TableClass.prototype.drawMany === "function") {
    const originalDrawMany = TableClass.prototype.drawMany;
    TableClass.prototype.drawMany = function(number, options = {}) {
      const shouldRecord = Recorder.active && !Recorder.ignore;
      if (shouldRecord) Recorder.recordRollTable(this, {
        number: nonNegativeNumber(number, 1),
        recursive: options.recursive,
        displayChat: options.displayChat,
        rollMode: options.rollMode
      });
      return shouldRecord
        ? runWithRecordingSuppressed(() => originalDrawMany.call(this, number, options))
        : originalDrawMany.call(this, number, options);
    };
  }

  Object.defineProperty(TableClass.prototype, "_journalCuesPatchedDraw", { value: true, configurable: true });
}

function patchPlaylistNaturalEndRecording() {
  const PlaylistClass = CONFIG.Playlist?.documentClass ?? foundry.documents?.Playlist;
  if (!PlaylistClass?.prototype?._onSoundEnd || PlaylistClass.prototype._journalCuesPatchedSoundEnd) return;
  const original = PlaylistClass.prototype._onSoundEnd;
  PlaylistClass.prototype._onSoundEnd = function(sound) {
    return Recorder.active && !Recorder.ignore
      ? runWithRecordingSuppressed(() => original.call(this, sound))
      : original.call(this, sound);
  };
  Object.defineProperty(PlaylistClass.prototype, "_journalCuesPatchedSoundEnd", { value: true, configurable: true });
}

function patchCanvasPingRecording() {
  if (!canvas?.ping || canvas._journalCuesPatchedPing) return;
  const originalPing = canvas.ping;
  canvas.ping = function(origin, options = {}) {
    const shouldRecord = Recorder.active && !Recorder.ignore;
    if (shouldRecord) Recorder.recordPing(origin, options);
    return shouldRecord
      ? runWithRecordingSuppressed(() => originalPing.call(this, origin, options))
      : originalPing.call(this, origin, options);
  };
  Object.defineProperty(canvas, "_journalCuesPatchedPing", { value: true, configurable: true });
}

function requestGM(type, payload) {
  const activeGM = game.users?.find((user) => user.active && user.isGM);
  if (!activeGM) {
    ui.notifications?.warn("Journal Cues needs an active GM client for that action.");
    return;
  }
  game.socket?.emit(SOCKET_NAME, { type, ...payload });
}

function registerHooks() {
  patchMacroRecording();
  patchRollTableRecording();
  patchPlaylistNaturalEndRecording();
  patchCanvasPingRecording();

  for (const documentName of RECORDED_HOOK_DOCUMENTS) {
    Hooks.on(`preUpdate${documentName}`, (doc, changes, options) => Recorder.preUpdate(doc, changes, options));
    Hooks.on(`update${documentName}`, (doc, changes, options) => Recorder.update(doc, changes, options));
    if (EMBEDDED_DOCUMENTS.includes(documentName)) {
      Hooks.on(`create${documentName}`, (doc, options) => Recorder.create(doc, options));
      Hooks.on(`preDelete${documentName}`, (doc, options) => Recorder.preDelete(doc, options));
      Hooks.on(`delete${documentName}`, (doc, options) => Recorder.delete(doc, options));
    }
  }

  Hooks.on("dnd5e.preUseActivity", (activity) => Recorder.recordDnd5eActivity(activity));
  Hooks.on("createChatMessage", (message, options) => Recorder.recordChatMessage(message, options));
  Hooks.on("canvasReady", () => patchCanvasPingRecording());
}

function registerSocket() {
  game.socket?.on(SOCKET_NAME, async (data) => {
    if (!data || (data.sceneId && data.sceneId !== scene()?.id)) return;
    if (data.type === "localAction") {
      if (data.originUserId === game.user?.id) return;
      await runLocalAction(data.action);
      return;
    }
    if (!game.user?.isGM) return;
    if (data.type === "playCue") await playCue(data.cueId, { requestedBy: data.requestedBy });
    else if (data.type === "stopCue") await stopCue(data.cueId);
    else if (data.type === "restoreRecordedStart") await restoreRecordedStart(data.cueId);
  });
}

function registerTextEnricher() {
  const enrichers = CONFIG?.TextEditor?.enrichers;
  if (!Array.isArray(enrichers)) return;
  const id = `${MODULE_ID}.cue`;
  if (enrichers.some((enricher) => enricher.id === id)) return;

  enrichers.push({
    id,
    pattern: /@Cue\[(?<id>[^\]]+)\](?:\{(?<label>[^}]+)\})?/g,
    enricher: async (match) => {
      const cueId = (match.groups?.id ?? match[1] ?? "").trim();
      const label = (match.groups?.label ?? match[2] ?? cueId).trim();
      const link = document.createElement("a");
      link.classList.add("content-link", "journal-cue-link");
      link.dataset.journalCueId = cueId;
      link.title = localize("JournalCues.Tooltip.PlayCue", "Play Journal Cue");
      const icon = document.createElement("i");
      icon.className = "fas fa-route";
      icon.setAttribute("aria-hidden", "true");
      link.append(icon, document.createTextNode(label));
      return link;
    }
  });
}

function registerClickHandler() {
  document.addEventListener("click", async (event) => {
    const link = event.target?.closest?.(".journal-cue-link[data-journal-cue-id]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    await playCue(link.dataset.journalCueId, { requestedBy: game.user?.id });
  });
}

function registerSettings() {
  game.settings.register(MODULE_ID, "defaultActionDelayMs", {
    name: localize("JournalCues.Settings.DefaultActionDelay.Name", "Default Action Delay"),
    hint: localize("JournalCues.Settings.DefaultActionDelay.Hint", "Default pause in milliseconds after each Journal Cue action when the action does not set its own delay."),
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_ACTION_GAP_MS
  });
  game.settings.register(MODULE_ID, "darkMode", {
    name: localize("JournalCues.Settings.DarkMode.Name", "Dark Mode"),
    hint: localize("JournalCues.Settings.DarkMode.Hint", "Use the darker Journal Cues window style on this client."),
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
}

function registerSceneControl() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const target = controls?.tokens ?? controls?.token ?? Object.values(controls ?? {})[0];
    if (!target?.tools) return;
    target.tools["journal-cues"] = {
      name: "journal-cues",
      title: localize("JournalCues.Title", "Journal Cues"),
      icon: "fas fa-route",
      button: true,
      visible: game.user?.isGM,
      onClick: () => openJournalCues()
    };
  });
}

function openJournalCues() {
  if (appInstance?.rendered) {
    appInstance.bringToTop();
    return appInstance;
  }
  appInstance = new JournalCuesApp();
  appInstance.render(true);
  return appInstance;
}

class JournalCuesApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: APP_ID,
      title: localize("JournalCues.Title", "Journal Cues"),
      template: `modules/${MODULE_ID}/templates/cues.hbs`,
      width: 840,
      height: 620,
      resizable: true,
      classes: ["journal-cues-window"]
    });
  }

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    const optionsButton = {
      label: "",
      tooltip: localize("JournalCues.Controls.Options", "Options"),
      class: "journal-cues-context",
      icon: "fas fa-ellipsis-v",
      onclick: (event) => this._toggleHeaderMenu(event)
    };
    buttons.unshift(optionsButton);
    return buttons;
  }

  constructor(options = {}) {
    super(options);
    this.selectedId = null;
    this._uiState = {};
    this._sidebarCollapsed = false;
    this._settingsExpanded = false;
    this._headerMenu = null;
    this._headerMenuDocument = null;
    this._headerMenuOutsideClick = null;
    this._detachedWindowId = null;
    this._attachedPosition = null;
    this._dragAction = null;
  }

  render(force = false, options = {}) {
    this._captureUiState();
    this._closeHeaderMenu();
    clearActionPreview();
    return super.render(force, options);
  }

  async close(options = {}) {
    this._closeHeaderMenu();
    clearActionPreview();
    const detachedWindowId = this._detachedWindowId;
    const detachedWindow = foundry.applications?.detached?.windows?.get(detachedWindowId)?.window;
    const result = await super.close(options);
    if (detachedWindowId) {
      foundry.applications?.detached?.windows?.get(detachedWindowId)?.applications?.delete?.(this._detachedApplicationKey());
      foundry.applications?.detached?.checkEmpty?.(detachedWindow);
      this._detachedWindowId = null;
    }
    return result;
  }

  bringToTop() {
    if (this._detachedWindowId) {
      this.element?.[0]?.ownerDocument?.defaultView?.focus?.();
      return;
    }
    return super.bringToTop();
  }

  _detachedApplicationKey() {
    return `${APP_ID}-${this.appId ?? this.id}`;
  }

  _syncDetachButton() {
    const button = this.element?.[0]?.querySelector?.(".header-button.journal-cues-detach");
    if (!button) return;
    const icon = button.querySelector("i");
    const tooltip = this._detachedWindowId
      ? localize("JournalCues.Controls.AttachWindow", "Attach Window")
      : localize("JournalCues.Controls.DetachWindow", "Detach Window");
    button.dataset.tooltip = tooltip;
    button.setAttribute("aria-label", tooltip);
    if (icon) icon.className = this._detachedWindowId ? "fa-solid fa-arrow-down-to-square" : "fa-solid fa-arrow-up-right-from-square";
  }

  _darkModeEnabled() {
    try {
      return !!game.settings?.get?.(MODULE_ID, "darkMode");
    } catch {
      return false;
    }
  }

  _applyDarkModeClass() {
    this.element?.toggleClass?.("journal-cues-dark", this._darkModeEnabled());
  }

  async _toggleDarkMode() {
    await game.settings?.set?.(MODULE_ID, "darkMode", !this._darkModeEnabled());
    this.render(false);
  }

  async _toggleDetachWindow(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (this._detachedWindowId) return this._attachWindow();
    return this._detachWindow(event?.currentTarget?.ownerDocument?.defaultView);
  }

  async _detachWindow(sourceWindow = window) {
    const manager = foundry.applications?.detached;
    const element = this.element?.[0];
    if (!manager?.openWindow || !element) {
      ui.notifications?.warn("Journal Cues: detached windows are not available in this Foundry version.");
      return;
    }

    const source = sourceWindow ?? element.ownerDocument?.defaultView ?? window;
    const rect = element.getBoundingClientRect();
    this._attachedPosition = { ...this.position };
    const position = {
      top: Math.max(0, source.screenY + (source.outerHeight - source.innerHeight) + rect.top - 62),
      left: Math.max(0, source.screenX + rect.left),
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height)
    };

    try {
      const win = await manager.openWindow({ id: `${APP_ID}-${this.appId}-detached`, position, source });
      win.document.adoptNode(element);
      win.document.body.append(element);
      this._detachedWindowId = win.id;
      manager.windows.get(win.id)?.applications?.set?.(this._detachedApplicationKey(), this);
      this.setPosition({ left: 0, top: 0, width: rect.width, height: rect.height });
      this._syncDetachButton();
    } catch (error) {
      console.warn(`[${MODULE_ID}] failed to detach window`, error);
      ui.notifications?.warn("Journal Cues: detached window could not be opened.");
    }
  }

  async _attachWindow() {
    const element = this.element?.[0];
    const manager = foundry.applications?.detached;
    const detachedWindowId = this._detachedWindowId;
    if (!element || !detachedWindowId) return;

    const detachedWindow = manager?.windows?.get(detachedWindowId)?.window ?? element.ownerDocument?.defaultView;
    document.adoptNode(element);
    document.body.append(element);
    manager?.windows?.get(detachedWindowId)?.applications?.delete?.(this._detachedApplicationKey());
    this._detachedWindowId = null;
    this.setPosition(this._attachedPosition ?? this.position);
    this._syncDetachButton();
    manager?.checkEmpty?.(detachedWindow);
  }

  _toggleHeaderMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const anchor = event?.currentTarget;
    if (this._headerMenu?.isConnected) {
      this._closeHeaderMenu();
      return;
    }

    this._closeHeaderMenu();
    const labels = journalCueLabels();
    const doc = anchor?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;
    const menu = doc.createElement("div");
    menu.className = `jc-header-menu${this._darkModeEnabled() ? " is-dark-mode" : ""}`;
    menu.setAttribute("role", "menu");

    const addButton = (label, icon, callback) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      const iconNode = doc.createElement("i");
      iconNode.className = icon;
      iconNode.setAttribute("aria-hidden", "true");
      const text = doc.createElement("span");
      text.textContent = label;
      button.append(iconNode, text);
      button.addEventListener("click", (clickEvent) => {
        clickEvent.preventDefault();
        this._closeHeaderMenu();
        callback(clickEvent);
      });
      menu.append(button);
    };

    addButton(labels.controls.help, "fas fa-question-circle", () => showHelpDialog());
    addButton(
      this._detachedWindowId ? labels.controls.attachWindow : labels.controls.detachWindow,
      this._detachedWindowId ? "fa-solid fa-arrow-down-to-square" : "fa-solid fa-arrow-up-right-from-square",
      (clickEvent) => this._toggleDetachWindow(clickEvent)
    );
    addButton(labels.controls.support, "fas fa-heart", () => openSupportPage());
    addButton(
      this._darkModeEnabled() ? labels.controls.lightMode : labels.controls.darkMode,
      this._darkModeEnabled() ? "fas fa-sun" : "fas fa-moon",
      () => this._toggleDarkMode()
    );

    doc.body.append(menu);
    const rect = anchor?.getBoundingClientRect?.();
    const menuRect = menu.getBoundingClientRect();
    const left = rect
      ? Math.max(8, Math.min(win.innerWidth - menuRect.width - 8, rect.right - menuRect.width))
      : Math.max(8, win.innerWidth - menuRect.width - 24);
    const top = rect
      ? Math.max(8, Math.min(win.innerHeight - menuRect.height - 8, rect.bottom + 6))
      : 48;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this._headerMenu = menu;
    this._headerMenuDocument = doc;
    this._headerMenuOutsideClick = (clickEvent) => {
      if (menu.contains(clickEvent.target) || anchor?.contains?.(clickEvent.target)) return;
      this._closeHeaderMenu();
    };
    win.setTimeout(() => doc.addEventListener("pointerdown", this._headerMenuOutsideClick, true), 0);
  }

  _closeHeaderMenu() {
    if (this._headerMenuOutsideClick) {
      (this._headerMenuDocument ?? document).removeEventListener("pointerdown", this._headerMenuOutsideClick, true);
      this._headerMenuOutsideClick = null;
    }
    this._headerMenu?.remove?.();
    this._headerMenu = null;
    this._headerMenuDocument = null;
  }

  _captureUiState() {
    const root = this.element?.[0];
    if (!root) return;
    this._uiState = {
      actionListScrollTop: root.querySelector(".jc-action-list")?.scrollTop ?? null,
      cueListScrollTop: root.querySelector(".jc-list-body")?.scrollTop ?? null,
      actionsJsonOpen: root.querySelector(".jc-json-details")?.open ?? false
    };
  }

  _restoreUiState(html) {
    const root = html?.[0] ?? this.element?.[0];
    if (!root || !this._uiState) return;
    const actionList = root.querySelector(".jc-action-list");
    if (actionList && this._uiState.actionListScrollTop != null) actionList.scrollTop = this._uiState.actionListScrollTop;
    const cueList = root.querySelector(".jc-list-body");
    if (cueList && this._uiState.cueListScrollTop != null) cueList.scrollTop = this._uiState.cueListScrollTop;
    const jsonDetails = root.querySelector(".jc-json-details");
    if (jsonDetails) jsonDetails.open = !!this._uiState.actionsJsonOpen;
  }

  async getData(options = {}) {
    const cues = await getCues();
    const labels = journalCueLabels();
    if (!this.selectedId && cues.length) this.selectedId = cues[0].id;
    let selected = cues.find((cue) => cue.id === this.selectedId) ?? null;
    if (!selected && cues.length) {
      selected = cues[0];
      this.selectedId = selected.id;
    }
    const selectedActions = Recorder.active && Recorder.cue?.id === selected?.id
      ? Recorder.actions
      : selected?.actions ?? [];
    const selectedDefaultDelay = cueDefaultDelayMs(selected);
    const selectedPlayback = Playback.get(selected?.id);
    return {
      cues: cues.map((cue) => {
        const recording = Recorder.active && Recorder.cue?.id === cue.id;
        const actionCount = recording ? Recorder.actions.length : cue.actions?.length ?? 0;
        const playback = Playback.get(cue.id);
        const playing = !!playback?.active;
        const paused = !!playback && !playback.active && playback.resumeIndex > 0;
        return {
          ...cue,
          selected: cue.id === this.selectedId,
          recording,
          playbackDisabled: Recorder.active,
          canRecord: !Recorder.active && !Playback.active,
          playing,
          paused,
          playbackLabel: playing
            ? `${labels.status.playing.toLocaleLowerCase()} ${Math.min(actionCount, (playback.currentIndex ?? 0) + 1)}/${actionCount}${playback.loopLimit !== 1 ? ` - ${labels.status.loop} ${playback.loopIndex}${playback.loopLimit ? `/${playback.loopLimit}` : ""}` : ""}`
            : paused ? `${labels.status.pausedAt} ${Math.min(actionCount, playback.resumeIndex + 1)}/${actionCount}` : "",
          actionCount,
          oneAction: actionCount === 1
        };
      }),
      selected: selected ? {
        ...selected,
        playing: !!selectedPlayback?.active,
        paused: !!selectedPlayback && !selectedPlayback.active && selectedPlayback.resumeIndex > 0,
        defaultDelayMs: selectedDefaultDelay,
        originRecorded: (selected.originMode ?? "recorded") === "recorded",
        originCurrent: selected.originMode === "current",
        loopEnabled: !!selected.loopEnabled,
        loopLimit: nonNegativeNumber(selected.loopLimit, 1),
        recording: Recorder.active && Recorder.cue?.id === selected.id,
        canRecord: !Recorder.active && !Playback.active,
        playbackDisabled: Recorder.active,
        actionsList: selectedActions.map((action, index) => {
          const row = actionDisplay(action, index, selectedDefaultDelay);
          let statusLabel = String(index + 1);
          let statusClass = "idle";
          if (selectedPlayback?.active && selectedPlayback.currentIndex === index) {
            statusLabel = labels.status.now;
            statusClass = selectedPlayback.stopRequested ? "stopping" : "running";
          } else if (selectedPlayback && index < selectedPlayback.resumeIndex) {
            statusLabel = labels.status.done;
            statusClass = "done";
          } else if (selectedPlayback && !selectedPlayback.active && selectedPlayback.resumeIndex === index && selectedPlayback.resumeIndex > 0) {
            statusLabel = labels.status.next;
            statusClass = "next";
          }
          return {
            ...row,
            statusLabel,
            statusClass
          };
        }),
        actionsJson: JSON.stringify(selectedActions, null, 2)
      } : null,
      labels,
      cueCount: cues.length,
      sidebarCollapsed: this._sidebarCollapsed,
      settingsExpanded: this._settingsExpanded,
      darkMode: this._darkModeEnabled(),
      recording: {
        active: Recorder.active,
        name: Recorder.cue?.name || "",
        actionCount: Recorder.actions.length,
        oneAction: Recorder.actions.length === 1
      },
      playback: {
        active: Playback.active,
        cueId: Playback.cueId,
        currentIndex: Playback.currentIndex,
        resumeIndex: Playback.resumeIndex,
        stopRequested: Playback.stopRequested,
        loopIndex: Playback.loopIndex,
        loopLimit: Playback.loopLimit,
        activeCount: Playback.activeSessions().length
      }
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._applyDarkModeClass();
    html.on("click", "[data-action]", this._onAction.bind(this));
    html.on("click", ".jc-document-link", this._onDocumentLink.bind(this));
    html.on("change", "[data-action-delay]", this._onDelayChange.bind(this));
    html.on("mouseenter", ".jc-action-row", this._onActionPreviewEnter.bind(this));
    html.on("mouseleave", ".jc-action-row", this._onActionPreviewLeave.bind(this));
    html.on("dragstart", ".jc-action-row", this._onActionDragStart.bind(this));
    html.on("dragover", ".jc-action-row", this._onActionDragOver.bind(this));
    html.on("dragleave", ".jc-action-row", this._onActionDragLeave.bind(this));
    html.on("drop", ".jc-action-row", this._onActionDrop.bind(this));
    html.on("dragend", ".jc-action-row", this._onActionDragEnd.bind(this));
    this._restoreUiState(html);
  }

  async _onDocumentLink(event) {
    event.preventDefault();
    event.stopPropagation();
    const link = event.currentTarget;
    await focusDocumentTarget({
      documentName: link.dataset.documentName,
      target: link.dataset.target,
      sceneId: link.dataset.sceneId
    });
  }

  async _onActionPreviewEnter(event) {
    const row = event.currentTarget;
    const index = Number(row.dataset.index);
    if (!Number.isInteger(index)) return;
    const cueId = row.dataset.cueId;
    const action = await this._actionForPreview(cueId, index);
    await showActionPreview(action);
  }

  _onActionPreviewLeave() {
    clearActionPreview();
  }

  async _actionForPreview(cueId, index) {
    if (!cueId || !Number.isInteger(index)) return null;
    if (Recorder.active && Recorder.cue?.id === cueId) return Recorder.actions?.[index] ?? null;
    const cue = await getCue(cueId);
    return cue?.actions?.[index] ?? null;
  }

  _onActionDragStart(event) {
    const original = event.originalEvent ?? event;
    if (original.target?.closest?.("button,input,select,textarea,a,summary")) {
      original.preventDefault();
      return;
    }
    const row = event.currentTarget;
    const index = Number(row.dataset.index);
    const cueId = row.dataset.cueId;
    if (!cueId || !Number.isInteger(index)) {
      original.preventDefault();
      return;
    }
    this._dragAction = { cueId, index };
    row.classList.add("dragging");
    clearActionPreview();
    original.dataTransfer?.setData?.("text/plain", JSON.stringify(this._dragAction));
    if (original.dataTransfer) original.dataTransfer.effectAllowed = "move";
  }

  _onActionDragOver(event) {
    const original = event.originalEvent ?? event;
    if (!this._dragAction) return;
    const row = event.currentTarget;
    if (row.dataset.cueId !== this._dragAction.cueId) return;
    original.preventDefault();
    if (original.dataTransfer) original.dataTransfer.dropEffect = "move";
    this._clearActionDropClasses();
    const rect = row.getBoundingClientRect();
    const after = original.clientY > rect.top + (rect.height / 2);
    row.classList.add(after ? "drag-over-after" : "drag-over-before");
  }

  _onActionDragLeave(event) {
    event.currentTarget.classList.remove("drag-over-before", "drag-over-after");
  }

  async _onActionDrop(event) {
    const original = event.originalEvent ?? event;
    if (!this._dragAction) return;
    const row = event.currentTarget;
    if (row.dataset.cueId !== this._dragAction.cueId) return;
    original.preventDefault();
    const targetIndex = Number(row.dataset.index);
    if (!Number.isInteger(targetIndex)) return;
    const rect = row.getBoundingClientRect();
    const insertIndex = targetIndex + (original.clientY > rect.top + (rect.height / 2) ? 1 : 0);
    const { cueId, index } = this._dragAction;
    this._dragAction = null;
    this._clearActionDropClasses();
    await this._reorderCueAction(cueId, index, insertIndex);
  }

  _onActionDragEnd() {
    this._dragAction = null;
    this._clearActionDropClasses();
  }

  _clearActionDropClasses() {
    this.element?.[0]?.querySelectorAll?.(".jc-action-row.dragging, .jc-action-row.drag-over-before, .jc-action-row.drag-over-after")
      ?.forEach((row) => row.classList.remove("dragging", "drag-over-before", "drag-over-after"));
  }

  async _onAction(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const action = button.dataset.action;
    const cueId = button.dataset.cueId ?? button.closest("[data-cue-id]")?.dataset.cueId;

    if (action === "toggle-list") {
      this._sidebarCollapsed = !this._sidebarCollapsed;
      this.render(false);
      return;
    }

    if (action === "toggle-settings") {
      this._settingsExpanded = !this._settingsExpanded;
      this.render(false);
      return;
    }

    if (action === "support") {
      openSupportPage();
      return;
    }

    if (action === "select") {
      if (this.selectedId !== cueId) this._settingsExpanded = false;
      this.selectedId = cueId;
      this.render(false);
      return;
    }

    if (cueId && !["action-remove", "action-up", "action-down", "save"].includes(action)) {
      this.selectedId = cueId;
    }

    if (action === "record-new") {
      if (Recorder.active) {
        ui.notifications?.warn("Journal Cues: stop or cancel the current recording before creating another cue.");
        return;
      }
      const name = await promptText(
        localize("JournalCues.Dialog.CreateTitle", "Create New Cue"),
        localize("JournalCues.Dialog.CueName", "Cue name"),
        localize("JournalCues.Dialog.NewCueDefault", "New Cue")
      );
      if (name) {
        const cue = await createCue(name);
        this.selectedId = cue.id;
        this.render(false);
      }
      return;
    }

    if (action === "help") {
      showHelpDialog();
      return;
    }

    if (action === "rename") {
      await this._renameCue(cueId);
      return;
    }

    if (action === "record-append") {
      if (Recorder.active) return;
      const cue = await Recorder.start({ cueId, append: true });
      this.selectedId = cue?.id ?? cueId;
      this.render(false);
      return;
    }

    if (action === "stop-recording") {
      const recordingId = Recorder.cue?.id;
      const cue = await Recorder.stop();
      this.selectedId = cue?.id ?? recordingId ?? this.selectedId;
      this.render(false);
      return;
    }

    if (action === "cancel-recording") {
      Recorder.cancel();
      return;
    }

    if (action === "save") {
      await this._saveCue(cueId);
      return;
    }

    if (action === "action-remove") {
      await this._removeCueAction(cueId, Number(button.dataset.index));
      return;
    }

    if (action === "action-up" || action === "action-down") {
      await this._moveCueAction(cueId, Number(button.dataset.index), action === "action-up" ? -1 : 1);
      return;
    }

    if (action === "play") {
      if (Recorder.active) {
        ui.notifications?.warn("Journal Cues: stop or cancel recording before playback.");
        return;
      }
      await playCue(cueId);
      return;
    }

    if (action === "stop-playback") {
      await stopCue(cueId);
      return;
    }

    if (action === "restore-recorded") {
      if (Recorder.active) return;
      await restoreRecordedStart(cueId);
      this.render(false);
      return;
    }

    if (action === "copy-link") {
      const cue = await getCue(cueId);
      if (cue) await copyToClipboard(cueLink(cue));
      this.render(false);
      return;
    }

    if (action === "delete") {
      const confirmed = await confirmDialog(
        localize("JournalCues.Dialog.DeleteTitle", "Delete Cue"),
        localize("JournalCues.Dialog.DeletePrompt", "Delete this cue from the scene?")
      );
      if (confirmed) {
        if (Recorder.active && Recorder.cue?.id === cueId) {
          const name = Recorder.cue?.name || "cue";
          Recorder.clear({ refresh: false });
          ui.notifications?.info(`Journal Cues: canceled recording "${name}" because the cue was deleted.`);
        }
        const playback = Playback.get(cueId);
        if (playback) {
          if (playback.active) Playback.requestStop(cueId);
          else Playback.clear(cueId);
        }
        await deleteCue(cueId);
        this.selectedId = null;
        this.render(false);
      }
    }
  }

  async _saveCue(cueId) {
    const form = this.element.find(`form.jc-form[data-cue-id="${cueId}"]`)[0];
    if (!form) return;
    const cue = await getCue(cueId);
    if (!cue) return;
    let actions;
    try {
      actions = JSON.parse(form.elements.actionsJson.value || "[]");
      if (!Array.isArray(actions)) throw new Error("Actions JSON must be an array.");
    } catch (error) {
      ui.notifications?.error(`Journal Cues: ${error.message}`);
      return;
    }
    const updatedCue = {
      ...cue,
      originMode: form.elements.originMode?.value || cue.originMode || "recorded",
      defaultDelayMs: form.elements.defaultDelayMs
        ? nonNegativeNumber(form.elements.defaultDelayMs.value, cueDefaultDelayMs(cue))
        : cueDefaultDelayMs(cue),
      loopEnabled: form.elements.loopEnabled ? !!form.elements.loopEnabled.checked : !!cue.loopEnabled,
      loopLimit: form.elements.loopLimit ? nonNegativeNumber(form.elements.loopLimit.value, 1) : nonNegativeNumber(cue.loopLimit, 1),
      actions
    };
    if (Recorder.active && Recorder.cue?.id === cueId) {
      Recorder.cue = {
        ...Recorder.cue,
        originMode: updatedCue.originMode,
        defaultDelayMs: updatedCue.defaultDelayMs,
        loopEnabled: updatedCue.loopEnabled,
        loopLimit: updatedCue.loopLimit
      };
      Recorder.actions = clone(actions);
    }
    await upsertCue(updatedCue);
  }

  async _renameCue(cueId) {
    const cue = await getCue(cueId);
    if (!cue) return;
    const name = await promptText(
      localize("JournalCues.Dialog.RenameTitle", "Rename Cue"),
      localize("JournalCues.Dialog.CueName", "Cue name"),
      cue.name || localize("JournalCues.Dialog.NewCueDefault", "New Cue")
    );
    if (!name || name === cue.name) return;
    if (Recorder.active && Recorder.cue?.id === cueId) {
      Recorder.cue = {
        ...Recorder.cue,
        name
      };
    }
    await upsertCue({ ...cue, name });
    this.selectedId = cueId;
    this.render(false);
  }

  async _onDelayChange(event) {
    const input = event.currentTarget;
    const cueId = input.dataset.cueId;
    const index = Number(input.dataset.index);
    if (Recorder.active && Recorder.cue?.id === cueId) {
      const actions = clone(Recorder.actions ?? []);
      if (!Number.isInteger(index) || index < 0 || index >= actions.length) return;
      actions[index] = {
        ...actions[index],
        waitAfter: nonNegativeNumber(input.value, cueDefaultDelayMs(Recorder.cue))
      };
      Recorder.actions = actions;
      refreshApp();
      return;
    }
    const cue = await getCue(cueId);
    if (!cue || !Number.isInteger(index)) return;
    const actions = clone(cue.actions ?? []);
    if (index < 0 || index >= actions.length) return;
    actions[index] = {
      ...actions[index],
      waitAfter: nonNegativeNumber(input.value, cueDefaultDelayMs(cue))
    };
    await upsertCue({ ...cue, actions });
  }

  async _removeCueAction(cueId, index) {
    const cue = await getCue(cueId);
    if (!cue || !Number.isInteger(index)) return;
    const actions = clone(cue.actions ?? []);
    if (index < 0 || index >= actions.length) return;
    actions.splice(index, 1);
    await upsertCue({ ...cue, actions });
  }

  async _moveCueAction(cueId, index, direction) {
    const cue = await getCue(cueId);
    if (!cue || !Number.isInteger(index)) return;
    const actions = clone(cue.actions ?? []);
    const next = index + direction;
    if (index < 0 || index >= actions.length || next < 0 || next >= actions.length) return;
    const [action] = actions.splice(index, 1);
    actions.splice(next, 0, action);
    await upsertCue({ ...cue, actions });
  }

  async _reorderCueAction(cueId, fromIndex, insertIndex) {
    if (!cueId || !Number.isInteger(fromIndex) || !Number.isInteger(insertIndex)) return;
    const reorder = (actions) => {
      const nextActions = clone(actions ?? []);
      if (fromIndex < 0 || fromIndex >= nextActions.length) return null;
      const boundedInsert = Math.max(0, Math.min(insertIndex, nextActions.length));
      let finalIndex = boundedInsert;
      if (fromIndex < boundedInsert) finalIndex -= 1;
      if (finalIndex === fromIndex) return null;
      const [action] = nextActions.splice(fromIndex, 1);
      nextActions.splice(finalIndex, 0, action);
      return nextActions;
    };

    if (Recorder.active && Recorder.cue?.id === cueId) {
      const actions = reorder(Recorder.actions);
      if (!actions) return;
      Recorder.actions = actions;
      this.selectedId = cueId;
      refreshApp();
      return;
    }

    const cue = await getCue(cueId);
    if (!cue) return;
    const actions = reorder(cue.actions);
    if (!actions) return;
    this.selectedId = cueId;
    await upsertCue({ ...cue, actions });
  }
}

function showHelpDialog() {
  const line = (labelKey, labelFallback, textKey, textFallback) =>
    `<p><strong>${localize(labelKey, labelFallback)}:</strong> ${localize(textKey, textFallback)}</p>`;
  new Dialog({
    title: localize("JournalCues.HelpTitle", "Journal Cues Help"),
    content: `<div class="jc-help">
      ${line("JournalCues.Help.Recording.Label", "Recording", "JournalCues.Help.Recording.Text", "Select a cue, click Start Recording, perform scene actions, then Stop or Cancel.")}
      ${line("JournalCues.Help.Playback.Label", "Playback", "JournalCues.Help.Playback.Text", "Play replays actions in order. Restore returns to the recorded starting state.")}
      ${line("JournalCues.Help.Movement.Label", "Movement", "JournalCues.Help.Movement.Text", "Recorded token movement replays recorded steps directly. Set <code>autoPath: true</code> in JSON only when you want Journal Cues to calculate a route around walls.")}
      ${line("JournalCues.Help.Doors.Label", "Doors", "JournalCues.Help.Doors.Text", "<code>autoDoors</code> allows passable doors to open during movement. <code>closeDoors</code> restores doors opened by that movement step.")}
      ${line("JournalCues.Help.Actions.Label", "Supported actions", "JournalCues.Help.Actions.Text", "Tokens, doors, walls, tiles, lights, sounds, regions, pings, chat messages, macros, roll tables, playlists, D&D5e activities, camera, images, audio, and portraits.")}
      ${line("JournalCues.Help.Links.Label", "Journal links", "JournalCues.Help.Links.Text", "Use <code>@Cue[cue-id]{Visible Text}</code> in a journal entry.")}
      ${line("JournalCues.Help.Loops.Label", "Loops", "JournalCues.Help.Loops.Text", "Enable Loop in the selected cue. A limit of <code>0</code> repeats until stopped.")}
    </div>`,
    buttons: {
      close: { label: localize("Close", "Close") }
    }
  }).render(true);
}

function openSupportPage() {
  const opened = globalThis.open?.(PATREON_URL, "_blank", "noopener");
  if (!opened) ui.notifications?.info(PATREON_URL);
}

async function promptText(title, label, initial = "") {
  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `<div class="form-group"><label>${label}</label><input type="text" name="value" value="${initial}"></div>`,
      buttons: {
        ok: {
          label: localize("OK", "OK"),
          callback: (html) => resolve(String(html.find("[name=value]").val() || "").trim())
        },
        cancel: {
          label: localize("Cancel", "Cancel"),
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

async function confirmDialog(title, content) {
  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `<p>${content}</p>`,
      buttons: {
        yes: { label: localize("Yes", "Yes"), callback: () => resolve(true) },
        no: { label: localize("No", "No"), callback: () => resolve(false) }
      },
      default: "no",
      close: () => resolve(false)
    }).render(true);
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    ui.notifications?.info("Journal Cues: link copied.");
  } catch {
    ui.notifications?.info(text);
  }
}

Hooks.once("init", () => {
  registerSettings();
  registerTextEnricher();
  registerSceneControl();
});

Hooks.once("ready", () => {
  registerHooks();
  registerSocket();
  registerClickHandler();
  game.modules.get(MODULE_ID).api = {
    open: openJournalCues,
    play: playCue,
    stop: stopCue,
    restoreRecordedStart,
    startRecording: (options = {}) => Recorder.start(options),
    stopRecording: () => Recorder.stop(),
    cancelRecording: () => Recorder.cancel(),
    getCues,
    upsertCue,
    deleteCue
  };
});
