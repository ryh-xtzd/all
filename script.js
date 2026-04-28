const YEAR = 2026;
const START_DATE = toDateOnly(new Date("2026-03-13"));
const WORKOUT_TYPES = ["背", "胸", "腿"];


const WEIGHT_STORAGE_KEY = "fitness-weight-map-v1";
const SHIFT_STORAGE_KEY = "fitness-shift-map-v1";
const DEVICE_STORAGE_KEY = "fitness-device-id-v1";
const SYNC_KEY = "ryh-2026";

// Optional: enable Supabase by setting URL/ANON key and creating fitness_weights/fitness_shifts tables.
const SUPABASE_URL = "https://rdzmtrwjrnzkjtdxbqeq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_k_rASAwO7pnk4kdRPBLkJw___nqnYof";
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);

let supabaseClient = null;
let visibleMonth = clampMonth(new Date().getMonth());
let weightMap = loadMap(WEIGHT_STORAGE_KEY);
let shiftMap = loadMap(SHIFT_STORAGE_KEY);
let selectedDateKey = "";

const monthTitle = document.getElementById("monthTitle");
const calendarGrid = document.getElementById("calendarGrid");
const trainDaysEl = document.getElementById("trainDays");
const durationTextEl = document.getElementById("durationText");
const cloudStatusEl = document.getElementById("cloudStatus");

const modal = document.getElementById("entryModal");
const modalTitle = document.getElementById("modalTitle");
const weightInput = document.getElementById("weightInput");
const shiftInput = document.getElementById("shiftInput");
const closeModalBtn = document.getElementById("closeModal");
const saveEntryBtn = document.getElementById("saveEntry");
const clearEntryBtn = document.getElementById("clearEntry");

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

    saveMap(WEIGHT_STORAGE_KEY, weightMap);
    saveMap(SHIFT_STORAGE_KEY, shiftMap);

    await persistEntry(selectedDateKey, weightValue, shiftValue);
    closeModal();
    render();
});

clearEntryBtn.addEventListener("click", async () => {
    if (!selectedDateKey) return;
    delete weightMap[selectedDateKey];
    delete shiftMap[selectedDateKey];
    saveMap(WEIGHT_STORAGE_KEY, weightMap);
    saveMap(SHIFT_STORAGE_KEY, shiftMap);
    await persistEntry(selectedDateKey, "", 0, true);
    closeModal();
    render();
});

async function init() {
    if (SUPABASE_ENABLED) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        await testSupabase();
        await hydrateFromRemote();
    } else {
        setCloudStatus("云端：未连接", "error");
    }
    render();
}

function setCloudStatus(message, level = "") {
    if (!cloudStatusEl) return;
    cloudStatusEl.textContent = message;
    cloudStatusEl.classList.remove("ok", "error");
    if (level) cloudStatusEl.classList.add(level);
}

async function testSupabase() {
    try {
        const { error } = await supabaseClient
            .from("fitness_weights")
            .select("date")
            .limit(1);

        if (error) {
            setCloudStatus(`云端连接失败：${error.message}`, "error");
        } else {
            setCloudStatus("云端：已连接", "ok");
        }
    } catch (err) {
        setCloudStatus(`云端连接失败：${err.message}`, "error");
    }
}

function render() {
    monthTitle.textContent = `${YEAR}年${visibleMonth + 1}月`;
    renderCalendar(YEAR, visibleMonth);
    renderStats();
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
        weight.textContent = `${weightValue} kg`;
        day.appendChild(weight);
    }

    day.style.cursor = "pointer";
    day.title = "记录体重或顺延训练";
    day.addEventListener("click", () => openModal(key));

    return day;
}

function getWorkoutInfo(date) {
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
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    selectedDateKey = "";
    weightInput.value = "";
    shiftInput.value = "";
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
    const { data: weights, error: weightError } = await supabaseClient
        .from("fitness_weights")
        .select("date, weight")
        .eq("device_id", deviceId);
    const { data: shifts, error: shiftError } = await supabaseClient
        .from("fitness_shifts")
        .select("date, days")
        .eq("device_id", deviceId);

    if (weightError) {
        setCloudStatus(`云端读取失败：${weightError.message}`, "error");
    }

    if (shiftError) {
        setCloudStatus(`云端读取失败：${shiftError.message}`, "error");
    }

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
}

async function persistEntry(dateKey, weightValue, shiftValue, forceDelete = false) {
    if (!supabaseClient) return;
    const deviceId = getDeviceId();

    if (forceDelete || !weightValue) {
        const { error } = await supabaseClient
            .from("fitness_weights")
            .delete()
            .eq("device_id", deviceId)
            .eq("date", dateKey);
        if (error) setCloudStatus(`云端写入失败：${error.message}`, "error");
    } else {
        const { error } = await supabaseClient
            .from("fitness_weights")
            .upsert({ device_id: deviceId, date: dateKey, weight: Number(weightValue) }, { onConflict: "device_id,date" });
        if (error) setCloudStatus(`云端写入失败：${error.message}`, "error");
    }

    if (forceDelete || !shiftValue) {
        const { error } = await supabaseClient
            .from("fitness_shifts")
            .delete()
            .eq("device_id", deviceId)
            .eq("date", dateKey);
        if (error) setCloudStatus(`云端写入失败：${error.message}`, "error");
    } else {
        const { error } = await supabaseClient
            .from("fitness_shifts")
            .upsert({ device_id: deviceId, date: dateKey, days: shiftValue }, { onConflict: "device_id,date" });
        if (error) setCloudStatus(`云端写入失败：${error.message}`, "error");
    }
}

init();
