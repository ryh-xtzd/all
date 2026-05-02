const YEAR = 2026;
const START_DATE = toDateOnly(new Date("2026-03-13"));
const WORKOUT_TYPES = ["背", "胸", "腿"];

const BUILD_ID = "20260502a";
const NOTES_MD_FILE = "动作.md";


const WEIGHT_STORAGE_KEY = "fitness-weight-map-v1";
const SHIFT_STORAGE_KEY = "fitness-shift-map-v1";
const OVERRIDE_STORAGE_KEY = "fitness-override-map-v1";
const DEVICE_STORAGE_KEY = "fitness-device-id-v1";
const SYNC_KEY = "ryh-2026";

// Optional: enable Supabase by setting URL/ANON key and creating fitness_weights/fitness_shifts tables.
const SUPABASE_URL = "https://rdzmtrwjrnzkjtdxbqeq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_k_rASAwO7pnk4kdRPBLkJw___nqnYof";

let supabaseClient = null;
let visibleMonth = clampMonth(new Date().getMonth());
let weightMap = loadMap(WEIGHT_STORAGE_KEY);
let shiftMap = loadMap(SHIFT_STORAGE_KEY);
let overrideMap = loadMap(OVERRIDE_STORAGE_KEY);
let selectedDateKey = "";

const monthTitle = document.getElementById("monthTitle");
const calendarGrid = document.getElementById("calendarGrid");
const trainDaysEl = document.getElementById("trainDays");
const durationTextEl = document.getElementById("durationText");
const cloudStatusEl = document.getElementById("cloudStatus");
const todayTextEl = document.getElementById("todayText");

const calendarViewEl = document.getElementById("calendarView");
const notesViewEl = document.getElementById("notesView");
const openNotesBtn = document.getElementById("openNotesBtn");
const backToCalendarBtn = document.getElementById("backToCalendarBtn");
const notesContentEl = document.getElementById("notesContent");
const notesGroupButtons = Array.from(document.querySelectorAll("[data-notes-group]"));

const modal = document.getElementById("entryModal");
const modalTitle = document.getElementById("modalTitle");
const weightInput = document.getElementById("weightInput");
const shiftInput = document.getElementById("shiftInput");
const planSelect = document.getElementById("planSelect");
const customLabelField = document.getElementById("customLabelField");
const customLabelInput = document.getElementById("customLabelInput");
const closeModalBtn = document.getElementById("closeModal");
const saveEntryBtn = document.getElementById("saveEntry");
const clearEntryBtn = document.getElementById("clearEntry");

let notesMarkdownText = "";
let notesMarkdownPromise = null;

if (openNotesBtn) {
    openNotesBtn.addEventListener("click", () => {
        showNotesView();
        setNotesPlaceholder("请选择部位");
    });
}

if (backToCalendarBtn) {
    backToCalendarBtn.addEventListener("click", () => {
        showCalendarView();
    });
}

if (notesGroupButtons.length > 0) {
    notesGroupButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
            const group = btn.getAttribute("data-notes-group") || "";
            await showNotesGroup(group);
        });
    });
}

if (planSelect) {
    planSelect.addEventListener("change", syncPlanFieldVisibility);
}

document.getElementById("prevMonth").addEventListener("click", () => {
    visibleMonth = Math.max(0, visibleMonth - 1);
    render();
});

document.getElementById("nextMonth").addEventListener("click", () => {
    visibleMonth = Math.min(11, visibleMonth + 1);
    render();
});

closeModalBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
});

saveEntryBtn.addEventListener("click", async () => {
    if (!selectedDateKey) return;
    const weightValue = (weightInput.value || "").trim();
    const shiftValue = Math.max(0, Number.parseInt(shiftInput.value || "0", 10) || 0);
    const planMode = planSelect?.value || "plan";
    const customLabel = (customLabelInput?.value || "").trim();

    if (weightValue) {
        weightMap[selectedDateKey] = weightValue;
    } else {
        delete weightMap[selectedDateKey];
    }

    if (shiftValue > 0) {
        shiftMap[selectedDateKey] = String(shiftValue);
    } else {
        delete shiftMap[selectedDateKey];
    }

    const planned = getPlannedWorkoutInfo(fromKey(selectedDateKey));
    const autoShiftNextKey = applyOverrideForKey(selectedDateKey, planMode, customLabel, planned);

    saveMap(WEIGHT_STORAGE_KEY, weightMap);
    saveMap(SHIFT_STORAGE_KEY, shiftMap);
    saveMap(OVERRIDE_STORAGE_KEY, overrideMap);

    await persistEntry(selectedDateKey, weightValue, shiftValue);
    if (autoShiftNextKey) {
        await persistEntry(autoShiftNextKey, "", getShiftDaysForKey(autoShiftNextKey));
    }
    closeModal();
    render();
});

clearEntryBtn.addEventListener("click", async () => {
    if (!selectedDateKey) return;
    delete weightMap[selectedDateKey];
    delete shiftMap[selectedDateKey];
    delete overrideMap[selectedDateKey];
    saveMap(WEIGHT_STORAGE_KEY, weightMap);
    saveMap(SHIFT_STORAGE_KEY, shiftMap);
    saveMap(OVERRIDE_STORAGE_KEY, overrideMap);
    await persistEntry(selectedDateKey, "", 0, true);
    closeModal();
    render();
});

async function init() {
    setCloudStatus("云端：未启用");

    if (!window.supabase) {
        const loaded = await loadSupabaseSdk();
        if (!loaded) {
            setCloudStatus("云端：未加载", "error");
            render();
            return;
        }
    }

    if (isSupabaseEnabled()) {
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } catch (err) {
            setCloudStatus("云端：初始化失败", "error");
            render();
            return;
        }

        setCloudStatus("云端：连接中...");
        const ok = await hydrateFromRemote();
        setCloudStatus(ok ? "云端：已连接" : "云端：读取失败", ok ? "ok" : "error");
    } else {
        // Supabase not configured or SDK not ready; fall back to localStorage only.
        setCloudStatus("云端：未启用");
    }
    render();
}

function isSupabaseEnabled() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
}

function loadSupabaseSdk() {
    return new Promise((resolve) => {
        if (window.supabase) return resolve(true);
        const script = document.createElement("script");
        script.src = "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js";
        script.async = true;
        script.onload = () => resolve(Boolean(window.supabase));
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
}

function setCloudStatus(message, level = "") {
    if (!cloudStatusEl) return;
    cloudStatusEl.textContent = message;
    cloudStatusEl.classList.remove("ok", "error");
    if (level) cloudStatusEl.classList.add(level);
}

function shorten(text, maxLen = 120) {
    const s = String(text || "").trim();
    if (!s) return "";
    if (s.length <= maxLen) return s;
    return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

function formatErr(err) {
    if (!err) return "unknown";
    if (typeof err === "string") return err;
    if (err instanceof Error) return err.message || String(err);
    try {
        return JSON.stringify(err);
    } catch (_) {
        return String(err);
    }
}

function formatSupabaseError(error) {
    if (!error) return "";
    const parts = [];
    if (error.message) parts.push(error.message);
    if (error.code) parts.push(`code=${error.code}`);
    if (error.details) parts.push(`details=${error.details}`);
    if (error.hint) parts.push(`hint=${error.hint}`);
    if (error.status) parts.push(`status=${error.status}`);
    return parts.join(" | ") || String(error);
}

function render() {
    if (todayTextEl) {
        todayTextEl.textContent = `今日：${toKey(new Date())}`;
    }
    monthTitle.textContent = `${YEAR}年${visibleMonth + 1}月`;
    renderCalendar(YEAR, visibleMonth);
    renderStats();
}

function showNotesView() {
    if (calendarViewEl) calendarViewEl.classList.add("hidden");
    if (notesViewEl) notesViewEl.classList.remove("hidden");
    window.scrollTo(0, 0);
}

function showCalendarView() {
    if (notesViewEl) notesViewEl.classList.add("hidden");
    if (calendarViewEl) calendarViewEl.classList.remove("hidden");
    window.scrollTo(0, 0);
}

function setNotesPlaceholder(text) {
    if (!notesContentEl) return;
    notesContentEl.textContent = text;
}

async function showNotesGroup(group) {
    if (!notesContentEl) return;

    const normalizedGroup = String(group || "").trim();
    if (!normalizedGroup) {
        setNotesPlaceholder("请选择部位");
        return;
    }

    setNotesPlaceholder("加载中...");

    let mdText = "";
    try {
        mdText = await loadNotesMarkdown();
    } catch (_) {
        setNotesPlaceholder("加载失败，请稍后重试");
        return;
    }

    const section = getNotesGroupMarkdown(mdText, normalizedGroup);
    if (!section) {
        setNotesPlaceholder("未找到对应内容");
        return;
    }

    renderSimpleMarkdown(notesContentEl, section);
}

function normalizeNewlines(text) {
    return String(text || "").replace(/\r\n?/g, "\n");
}

async function loadNotesMarkdown() {
    if (notesMarkdownText) return notesMarkdownText;
    if (notesMarkdownPromise) return notesMarkdownPromise;

    const url = `${encodeURI(NOTES_MD_FILE)}?v=${encodeURIComponent(BUILD_ID)}`;
    notesMarkdownPromise = fetch(url)
        .then((res) => {
            if (!res.ok) {
                throw new Error(`fetch failed: ${res.status}`);
            }
            return res.text();
        })
        .then((text) => {
            notesMarkdownText = normalizeNewlines(text);
            return notesMarkdownText;
        })
        .finally(() => {
            // Keep the resolved text, but avoid holding a settled promise.
            notesMarkdownPromise = null;
        });

    return notesMarkdownPromise;
}

function sliceTopLevelSection(mdText, title) {
    const text = normalizeNewlines(mdText);
    const lines = text.split("\n");
    const header = `# ${title}`;
    let start = -1;

    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim() === header) {
            start = i;
            break;
        }
    }

    if (start < 0) return "";

    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
        if (lines[i].startsWith("# ")) {
            end = i;
            break;
        }
    }

    return lines.slice(start, end).join("\n").trim();
}

function getNotesGroupMarkdown(mdText, group) {
    switch (group) {
        case "back":
            return sliceTopLevelSection(mdText, "背");
        case "chest":
            return sliceTopLevelSection(mdText, "胸");
        case "leg":
            return sliceTopLevelSection(mdText, "腿");
        case "shoulder": {
            const parts = [
                sliceTopLevelSection(mdText, "肩后束"),
                sliceTopLevelSection(mdText, "肩前束"),
                sliceTopLevelSection(mdText, "肩中束"),
            ].filter(Boolean);
            return parts.join("\n\n");
        }
        default:
            return "";
    }
}

function renderSimpleMarkdown(containerEl, mdText) {
    if (!containerEl) return;
    containerEl.replaceChildren();

    const lines = normalizeNewlines(mdText).split("\n");
    let currentOl = null;

    const flushOl = () => {
        if (currentOl) {
            containerEl.appendChild(currentOl);
            currentOl = null;
        }
    };

    for (let i = 0; i < lines.length; i += 1) {
        const rawLine = lines[i];
        const line = rawLine.trimEnd();
        const trimmed = line.trim();

        if (!trimmed) {
            flushOl();
            continue;
        }

        if (trimmed.startsWith("# ")) {
            flushOl();
            const h = document.createElement("h3");
            h.textContent = trimmed.slice(2).trim();
            containerEl.appendChild(h);
            continue;
        }

        if (trimmed.startsWith("## ")) {
            flushOl();
            const h = document.createElement("h4");
            h.textContent = trimmed.slice(3).trim();
            containerEl.appendChild(h);
            continue;
        }

        const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
        if (orderedMatch) {
            if (!currentOl) currentOl = document.createElement("ol");
            const li = document.createElement("li");
            li.textContent = orderedMatch[1].trim();
            currentOl.appendChild(li);
            continue;
        }

        flushOl();
        const p = document.createElement("p");
        p.textContent = trimmed;
        containerEl.appendChild(p);
    }

    flushOl();
}

function renderCalendar(year, month) {
    calendarGrid.innerHTML = "";

    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingBlank = (firstDay.getDay() + 6) % 7;

    for (let i = 0; i < leadingBlank; i += 1) {
        const empty = document.createElement("div");
        empty.className = "day empty";
        calendarGrid.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d += 1) {
        const date = new Date(year, month, d);
        calendarGrid.appendChild(createDayCell(date));
    }

    const totalCells = leadingBlank + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailing; i += 1) {
        const empty = document.createElement("div");
        empty.className = "day empty";
        calendarGrid.appendChild(empty);
    }
}

function createDayCell(rawDate) {
    const date = toDateOnly(rawDate);
    const day = document.createElement("div");
    day.className = "day";

    const today = toDateOnly(new Date());
    const future = date > today;
    const info = getWorkoutInfo(date);

    if (isSameDate(date, today)) {
        day.classList.add("today");
    }

    if (future) {
        day.classList.add("future");
    } else if (info.kind === "train") {
        day.classList.add("train");
    } else {
        day.classList.add("rest");
    }

    const dateNum = document.createElement("div");
    dateNum.className = "date-num";
    dateNum.textContent = String(date.getDate());
    day.appendChild(dateNum);

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = info.label;
    day.appendChild(tag);

    const key = toKey(date);
    const weightValue = weightMap[key];
    if (weightValue) {
        const weight = document.createElement("div");
        weight.className = "weight";
        weight.textContent = `${weightValue}kg`;
        day.appendChild(weight);
    }

    day.style.cursor = "pointer";
    day.title = "记录体重或顺延训练";
    day.addEventListener("click", () => openModal(key));

    return day;
}

function getWorkoutInfo(date) {
    const key = toKey(date);
    const override = getOverrideForKey(key);
    if (override) return override;
    return getPlannedWorkoutInfo(date);
}

function getPlannedWorkoutInfo(date) {
    const d = toDateOnly(date);
    if (d < START_DATE) {
        return { kind: "rest", label: "未开始" };
    }

    if (isInShiftWindow(d)) {
        return { kind: "rest", label: "休息" };
    }

    const diffDays = daysBetween(START_DATE, applyTotalShift(d));
    const idx = mod(diffDays, 4);

    if (idx === 3) {
        return { kind: "rest", label: "休息" };
    }

    return { kind: "train", label: WORKOUT_TYPES[idx] };
}

function getOverrideForKey(key) {
    const raw = overrideMap[key];
    if (!raw || typeof raw !== "object") return null;
    const kind = raw.kind === "train" ? "train" : raw.kind === "rest" ? "rest" : "";
    if (!kind) return null;
    const label = typeof raw.label === "string" && raw.label.trim()
        ? raw.label.trim()
        : kind === "train"
            ? "训练"
            : "休息";
    return { kind, label };
}

function applyOverrideForKey(dateKey, planMode, customLabel, plannedInfo) {
    if (planMode === "plan") {
        delete overrideMap[dateKey];
        return "";
    }

    if (planMode === "rest") {
        overrideMap[dateKey] = { kind: "rest", label: "休息" };
        return "";
    }

    if (planMode === "train") {
        const label = customLabel || (plannedInfo?.kind === "train" ? plannedInfo.label : "训练");
        overrideMap[dateKey] = { kind: "train", label };

        if (plannedInfo?.kind === "rest") {
            const nextKey = toKey(addDays(fromKey(dateKey), 1));
            shiftMap[nextKey] = String(Math.max(getShiftDaysForKey(nextKey), 1));
            return nextKey;
        }
    }

    return "";
}

function renderStats() {
    const today = toDateOnly(new Date());
    const end = today;

    if (end < START_DATE) {
        trainDaysEl.textContent = "0 天";
        durationTextEl.textContent = "0 个月 0 天";
        return;
    }

    let trainDays = 0;
    const current = new Date(START_DATE);
    while (current <= end) {
        const info = getWorkoutInfo(current);
        if (info.kind === "train") {
            trainDays += 1;
        }
        current.setDate(current.getDate() + 1);
    }

    const duration = diffMonthsDaysInclusive(START_DATE, end);
    trainDaysEl.textContent = `${trainDays} 天`;
    durationTextEl.textContent = `${duration.months} 个月 ${duration.days} 天`;
}

function diffMonthsDaysInclusive(start, end) {
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() + 1);

    let months = 0;
    let cursor = new Date(start);

    while (true) {
        const next = new Date(cursor);
        next.setMonth(next.getMonth() + 1);
        if (next <= endInclusive) {
            cursor = next;
            months += 1;
        } else {
            break;
        }
    }

    const days = daysBetween(cursor, endInclusive);
    return { months, days };
}

function loadMap(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return {};
        return obj;
    } catch (_) {
        return {};
    }
}

function saveMap(storageKey, map) {
    localStorage.setItem(storageKey, JSON.stringify(map));
}

function toDateOnly(date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d;
}

function daysBetween(a, b) {
    const diff = toDateOnly(b).getTime() - toDateOnly(a).getTime();
    return Math.round(diff / 86400000);
}

function toKey(date) {
    const d = toDateOnly(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function fromKey(key) {
    const [y, m, d] = key.split("-").map((v) => Number.parseInt(v, 10));
    return toDateOnly(new Date(y, m - 1, d));
}

function mod(n, m) {
    return ((n % m) + m) % m;
}

function clampMonth(month) {
    if (month < 0) return 0;
    if (month > 11) return 11;
    return month;
}

function isSameDate(a, b) {
    return toKey(a) === toKey(b);
}

function getShiftDaysForKey(key) {
    const value = shiftMap[key];
    if (!value) return 0;
    return Math.max(0, Number.parseInt(value, 10) || 0);
}

function getTotalShiftDays(date) {
    const targetKey = toKey(date);
    return Object.keys(shiftMap).reduce((sum, key) => {
        if (key <= targetKey) {
            return sum + getShiftDaysForKey(key);
        }
        return sum;
    }, 0);
}

function isInShiftWindow(date) {
    const target = toDateOnly(date).getTime();
    return Object.entries(shiftMap).some(([key, value]) => {
        const days = Math.max(0, Number.parseInt(value, 10) || 0);
        if (days <= 0) return false;
        const start = fromKey(key).getTime();
        const end = addDays(fromKey(key), days - 1).getTime();
        return target >= start && target <= end;
    });
}

function applyTotalShift(date) {
    const totalShift = getTotalShiftDays(date);
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() - totalShift);
    return toDateOnly(shifted);
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return toDateOnly(d);
}

function openModal(dateKey) {
    selectedDateKey = dateKey;
    modalTitle.textContent = dateKey;
    weightInput.value = weightMap[dateKey] || "";
    shiftInput.value = shiftMap[dateKey] || "";

    const override = getOverrideForKey(dateKey);
    if (planSelect) {
        planSelect.value = override ? override.kind : "plan";
    }
    if (customLabelInput) {
        customLabelInput.value = override && override.kind === "train" ? override.label : "";
    }
    syncPlanFieldVisibility();

    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    selectedDateKey = "";
    weightInput.value = "";
    shiftInput.value = "";
    if (planSelect) planSelect.value = "plan";
    if (customLabelInput) customLabelInput.value = "";
    syncPlanFieldVisibility();
}

function syncPlanFieldVisibility() {
    if (!planSelect || !customLabelField) return;
    const showLabel = planSelect.value === "train";
    customLabelField.classList.toggle("hidden", !showLabel);
}

function getDeviceId() {
    if (SYNC_KEY && SYNC_KEY.trim()) {
        return SYNC_KEY.trim();
    }
    let id = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(DEVICE_STORAGE_KEY, id);
    }
    return id;
}

async function hydrateFromRemote() {
    if (!supabaseClient) return;
    const deviceId = getDeviceId();
    let weights = null;
    let shifts = null;
    let overrides = null;
    let weightError = null;
    let shiftError = null;
    let overrideError = null;
    let lastErrorText = "";

    try {
        const res = await supabaseClient
            .from("fitness_weights")
            .select("date, weight")
            .eq("device_id", deviceId);
        weights = res.data;
        weightError = res.error;
        if (res.error && !lastErrorText) lastErrorText = formatSupabaseError(res.error);
    } catch (err) {
        weightError = { message: formatErr(err) };
        if (!lastErrorText) lastErrorText = formatErr(err);
    }

    try {
        const res = await supabaseClient
            .from("fitness_shifts")
            .select("date, days")
            .eq("device_id", deviceId);
        shifts = res.data;
        shiftError = res.error;
        if (res.error && !lastErrorText) lastErrorText = formatSupabaseError(res.error);
    } catch (err) {
        shiftError = { message: formatErr(err) };
        if (!lastErrorText) lastErrorText = formatErr(err);
    }

    try {
        const res = await supabaseClient
            .from("fitness_overrides")
            .select("date, kind, label")
            .eq("device_id", deviceId);
        overrides = res.data;
        overrideError = res.error;
        if (res.error && !lastErrorText) lastErrorText = formatSupabaseError(res.error);
    } catch (err) {
        overrideError = { message: formatErr(err) };
        if (!lastErrorText) lastErrorText = formatErr(err);
    }

    if (weightError) {
        // Intentionally silent in UI.
    }

    if (shiftError) {
        // Intentionally silent in UI.
    }

    if (overrideError) {
        // Intentionally silent in UI.
    }

    const hadError = Boolean(weightError || shiftError || overrideError);

    if (Array.isArray(weights)) {
        weights.forEach((item) => {
            if (item?.date && item?.weight != null) {
                weightMap[item.date] = String(item.weight);
            }
        });
        saveMap(WEIGHT_STORAGE_KEY, weightMap);
    }

    if (Array.isArray(shifts)) {
        shifts.forEach((item) => {
            if (item?.date && item?.days != null) {
                shiftMap[item.date] = String(item.days);
            }
        });
        saveMap(SHIFT_STORAGE_KEY, shiftMap);
    }

    if (Array.isArray(overrides)) {
        overrides.forEach((item) => {
            const date = item?.date;
            const kind = item?.kind === "train" ? "train" : item?.kind === "rest" ? "rest" : "";
            if (!date || !kind) return;
            const label = typeof item?.label === "string" && item.label.trim()
                ? item.label.trim()
                : kind === "train"
                    ? "训练"
                    : "休息";
            overrideMap[date] = { kind, label };
        });
        saveMap(OVERRIDE_STORAGE_KEY, overrideMap);
    }

    if (hadError) {
        setCloudStatus(`云端：读取失败${lastErrorText ? `（${shorten(lastErrorText)}）` : ""}`, "error");
    }

    return !hadError;
}

async function persistEntry(dateKey, weightValue, shiftValue, forceDelete = false) {
    if (!supabaseClient) return;
    const deviceId = getDeviceId();

    let hadError = false;
    let lastErrorText = "";

    if (forceDelete || !weightValue) {
        try {
            const { error } = await supabaseClient
                .from("fitness_weights")
                .delete()
                .eq("device_id", deviceId)
                .eq("date", dateKey);
            if (error) {
                hadError = true;
                if (!lastErrorText) lastErrorText = formatSupabaseError(error);
            }
        } catch (err) {
            hadError = true;
            if (!lastErrorText) lastErrorText = formatErr(err);
        }
    } else {
        try {
            const { error } = await supabaseClient
                .from("fitness_weights")
                .upsert({ device_id: deviceId, date: dateKey, weight: Number(weightValue) }, { onConflict: "device_id,date" })
                .select("date");
            if (error) {
                hadError = true;
                if (!lastErrorText) lastErrorText = formatSupabaseError(error);
            }
        } catch (err) {
            hadError = true;
            if (!lastErrorText) lastErrorText = formatErr(err);
        }
    }

    if (forceDelete || !shiftValue) {
        try {
            const { error } = await supabaseClient
                .from("fitness_shifts")
                .delete()
                .eq("device_id", deviceId)
                .eq("date", dateKey);
            if (error) {
                hadError = true;
                if (!lastErrorText) lastErrorText = formatSupabaseError(error);
            }
        } catch (err) {
            hadError = true;
            if (!lastErrorText) lastErrorText = formatErr(err);
        }
    } else {
        try {
            const { error } = await supabaseClient
                .from("fitness_shifts")
                .upsert({ device_id: deviceId, date: dateKey, days: shiftValue }, { onConflict: "device_id,date" })
                .select("date");
            if (error) {
                hadError = true;
                if (!lastErrorText) lastErrorText = formatSupabaseError(error);
            }
        } catch (err) {
            hadError = true;
            if (!lastErrorText) lastErrorText = formatErr(err);
        }
    }

    const override = overrideMap[dateKey];
    const hasOverride = override && typeof override === "object" && (override.kind === "train" || override.kind === "rest");
    if (forceDelete || !hasOverride) {
        try {
            const { error } = await supabaseClient
                .from("fitness_overrides")
                .delete()
                .eq("device_id", deviceId)
                .eq("date", dateKey);
            if (error) {
                hadError = true;
                if (!lastErrorText) lastErrorText = formatSupabaseError(error);
            }
        } catch (err) {
            hadError = true;
            if (!lastErrorText) lastErrorText = formatErr(err);
        }
    } else {
        try {
            const label = typeof override.label === "string" && override.label.trim()
                ? override.label.trim()
                : override.kind === "train"
                    ? "训练"
                    : "休息";
            const { error } = await supabaseClient
                .from("fitness_overrides")
                .upsert({ device_id: deviceId, date: dateKey, kind: override.kind, label }, { onConflict: "device_id,date" })
                .select("date");
            if (error) {
                hadError = true;
                if (!lastErrorText) lastErrorText = formatSupabaseError(error);
            }
        } catch (err) {
            hadError = true;
            if (!lastErrorText) lastErrorText = formatErr(err);
        }
    }

    // Intentionally silent in UI. If needed, we can add a subtle indicator later.

    setCloudStatus(
        hadError
            ? `云端：同步失败${lastErrorText ? `（${shorten(lastErrorText)}）` : ""}`
            : "云端：已同步",
        hadError ? "error" : "ok"
    );
    return !hadError;
}

init();
