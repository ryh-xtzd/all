const YEAR = 2026;
const START_DATE = toDateOnly(new Date("2026-03-13"));
const WORKOUT_TYPES = ["背", "胸", "腿"];
const STORAGE_KEY = "fitness-completed-days-v1";

let visibleMonth = clampMonth(new Date().getMonth());
let completedDays = loadCompletedDays();

const monthTitle = document.getElementById("monthTitle");
const calendarGrid = document.getElementById("calendarGrid");
const actualCountEl = document.getElementById("actualCount");
const plannedCountEl = document.getElementById("plannedCount");
const durationTextEl = document.getElementById("durationText");

document.getElementById("prevMonth").addEventListener("click", () => {
    visibleMonth = Math.max(0, visibleMonth - 1);
    render();
});

document.getElementById("nextMonth").addEventListener("click", () => {
    visibleMonth = Math.min(11, visibleMonth + 1);
    render();
});

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

    const prevMonthDays = new Date(year, month, 0).getDate();

    for (let i = 0; i < leadingBlank; i += 1) {
        const dayNum = prevMonthDays - leadingBlank + i + 1;
        const date = new Date(year, month - 1, dayNum);
        calendarGrid.appendChild(createDayCell(date, true));
    }

    for (let d = 1; d <= daysInMonth; d += 1) {
        const date = new Date(year, month, d);
        calendarGrid.appendChild(createDayCell(date, false));
    }

    const currentCells = leadingBlank + daysInMonth;
    const trailing = (7 - (currentCells % 7)) % 7;

    for (let i = 1; i <= trailing; i += 1) {
        const date = new Date(year, month + 1, i);
        calendarGrid.appendChild(createDayCell(date, true));
    }
}

function createDayCell(rawDate, muted) {
    const date = toDateOnly(rawDate);
    const day = document.createElement("div");
    day.className = "day";
    if (muted) day.classList.add("muted");

    const today = toDateOnly(new Date());
    const future = date > today;
    const info = getWorkoutInfo(date);

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
    tag.textContent = info.kind === "train" ? info.label : "休息";
    day.appendChild(tag);

    const key = toKey(date);
    const canToggle = info.kind === "train" && !future && !muted;
    if (canToggle) {
        day.style.cursor = "pointer";
        day.title = "点击切换是否已完成训练";
        day.addEventListener("click", () => {
            if (completedDays.has(key)) {
                completedDays.delete(key);
            } else {
                completedDays.add(key);
            }
            saveCompletedDays(completedDays);
            render();
        });
    }

    if (completedDays.has(key)) {
        const check = document.createElement("div");
        check.className = "check";
        check.textContent = "已完成";
        day.appendChild(check);
    }

    return day;
}

function getWorkoutInfo(date) {
    const d = toDateOnly(date);
    if (d < START_DATE) {
        return { kind: "rest", label: "未开始" };
    }

    const diffDays = daysBetween(START_DATE, d);
    const idx = mod(diffDays, 4);

    if (idx === 3) {
        return { kind: "rest", label: "休息" };
    }

    return { kind: "train", label: WORKOUT_TYPES[idx] };
}

function renderStats() {
    const today = toDateOnly(new Date());
    const yearEnd = toDateOnly(new Date(YEAR, 11, 31));
    const end = today > yearEnd ? yearEnd : today;

    if (end < START_DATE) {
        actualCountEl.textContent = "0 天";
        plannedCountEl.textContent = "0 天";
        durationTextEl.textContent = "0 个月 0 天";
        return;
    }

    let planned = 0;
    let actual = 0;

    const current = new Date(START_DATE);
    while (current <= end) {
        const info = getWorkoutInfo(current);
        const key = toKey(current);

        if (info.kind === "train") {
            planned += 1;
            if (completedDays.has(key)) {
                actual += 1;
            }
        }

        current.setDate(current.getDate() + 1);
    }

    const duration = diffMonthsDaysInclusive(START_DATE, end);

    actualCountEl.textContent = `${actual} 天`;
    plannedCountEl.textContent = `${planned} 天`;
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

function loadCompletedDays() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.filter((v) => typeof v === "string"));
    } catch (_) {
        return new Set();
    }
}

function saveCompletedDays(set) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
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

function mod(n, m) {
    return ((n % m) + m) % m;
}

function clampMonth(month) {
    if (month < 0) return 0;
    if (month > 11) return 11;
    return month;
}

render();
