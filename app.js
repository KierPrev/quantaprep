// ======= Persistencia =======
const LS_KEY = 'quantaprepV1';

// Respaldo automático en OPFS (Origin Private File System)
const OPFS_FILE = 'quanta-respaldo.json';
let opfsAvailable = !!(navigator.storage && navigator.storage.getDirectory);

// Archivo JSON local para guardar datos
const LOCAL_DATA_FILE = 'data.json';

// ======= Defaults y Estado =======
const DEFAULTS = {
    capacityDaily: 2.0,
    typeTimes: { 'TP': 1.5, 'Problemas': 1.2, 'Teoría': 1.0, 'Lectura': 0.8, 'Otro': 1.0 },
    difWeights: { baja: 1.0, media: 1.3, alta: 1.7 }
};

let state = { capacityDaily: DEFAULTS.capacityDaily, typeTimes: { ...DEFAULTS.typeTimes }, subjects: [] };

// ======= Util =======
const byId = (id) => document.getElementById(id);
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const fmtDDMMYY = (iso) => {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy}`;
};

const parseDDMMYY = (str) => {
    const parts = str.split('-');
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // months are 0-indexed
    const year = parseInt(parts[2], 10) + 2000; // assume 20xx for 2-digit years

    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

    const date = new Date(year, month, day);
    if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
        return null; // invalid date
    }

    return date.toISOString().split('T')[0]; // return ISO format for storage
};
const daysUntil = (iso) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(iso); d.setHours(0, 0, 0, 0);
    return Math.max(0, Math.ceil((d - today) / (1000 * 60 * 60 * 24)));
};
const uuid = () => Math.random().toString(36).slice(2, 9);
const parseTimeInput = (val, unit) => {
    const n = Number(val); if (!isFinite(n) || n <= 0) return 0;
    return unit === 'min' ? n / 60 : n;
};

// ======= OPFS helpers =======
async function opfsWrite(jsonStr) {
    try {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle(OPFS_FILE, { create: true });
        const w = await fh.createWritable();
        await w.write(new Blob([jsonStr], { type: 'application/json' }));
        await w.close();
        return true;
    } catch { return false; }
}
async function opfsRead() {
    try {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle(OPFS_FILE);
        const file = await fh.getFile();
        const text = await file.text();
        return JSON.parse(text);
    } catch { return null; }
}

// ======= Servidor JSON helpers =======
async function saveToServer() {
    try {
        const response = await fetch('/api/save-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(state)
        });

        if (response.ok) {
            const result = await response.json();
            console.log('Datos guardados en servidor:', result.message);
            return true;
        } else {
            console.error('Error del servidor al guardar datos');
            return false;
        }
    } catch (error) {
        console.error('Error al guardar en servidor:', error);
        return false;
    }
}

async function loadFromServer() {
    try {
        const response = await fetch('/api/load-data');

        if (response.ok) {
            const data = await response.json();
            return data;
        } else if (response.status === 404) {
            console.log('No se encontraron datos en el servidor');
            return null;
        } else {
            console.error('Error del servidor al cargar datos');
            return null;
        }
    } catch (error) {
        console.error('Error al cargar desde servidor:', error);
        return null;
    }
}


// ======= Carga inicial =======
(async function init() {
    // 1) Intentar cargar desde archivo JSON local
    let loaded = false;
    try {
        const response = await fetch(LOCAL_DATA_FILE);
        if (response.ok) {
            const data = await response.json();
            if (data && Array.isArray(data.subjects)) {
                state = migrate(data);
                loaded = true;
                setBackupInfo('Cargado desde archivo local data.json');
            }
        }
    } catch (error) {
        console.log('No se encontró archivo data.json local, continuando con otros métodos...');
    }

    // 2) Si no hubo archivo JSON válido, intentar OPFS
    if (!loaded && opfsAvailable) {
        const data = await opfsRead();
        if (data && Array.isArray(data.subjects)) {
            state = migrate(data);
            loaded = true;
            setBackupInfo('Respaldando en archivo local (OPFS).');
        } else {
            setBackupInfo('Creando respaldo local (OPFS) al guardar cambios…');
        }
    } else if (!loaded) {
        setBackupInfo('Respaldo en localStorage (tu navegador).');
    }

    // 3) Si no hubo OPFS válido, intentar localStorage
    if (!loaded) {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            try { state = migrate(JSON.parse(raw)); } catch { }
        }
    }

    render();
})();

function migrate(data) {
    // Asegurar campos presentes
    return {
        capacityDaily: Number(data.capacityDaily) || DEFAULTS.capacityDaily,
        typeTimes: { ...DEFAULTS.typeTimes, ...(data.typeTimes || {}) },
        subjects: Array.isArray(data.subjects) ? data.subjects : []
    };
}

async function saveState() {
    const json = JSON.stringify(state);
    localStorage.setItem(LS_KEY, json);
    if (opfsAvailable) { await opfsWrite(json); }

    // Guardar automáticamente en el servidor
    await saveToServer();
}

// ======= Modelo de cálculo =======
function emaUpdate(type, tReal, alpha = 0.3) {
    const prev = state.typeTimes[type] ?? DEFAULTS.typeTimes['Otro'];
    const next = (1 - alpha) * prev + alpha * tReal;
    state.typeTimes[type] = clamp(next, 0.25, 6);
}
function estimateHoursRemaining(subject) {
    const w = DEFAULTS.difWeights;
    let rem = 0;
    subject.parts.forEach(p => {
        const tType = state.typeTimes[p.type] ?? state.typeTimes['Otro'];
        rem += (tType * (w[p.diff] ?? 1.0)) * (1 - (p.progress ?? 0));
    });
    return { lo: +(rem * 0.85).toFixed(1), mid: +rem.toFixed(1), hi: +(rem * 1.25).toFixed(1) };
}
function risk(subject) {
    const d = Math.max(1, daysUntil(subject.examISO));
    const est = estimateHoursRemaining(subject).mid;
    const cap = Math.max(0.25, state.capacityDaily);
    const R = est / (d * cap);
    let color = 'green'; if (R > 1.2) color = 'red'; else if (R > 0.8) color = 'amber';
    return { R, color };
}
function todaySuggestion(subject) {
    const est = estimateHoursRemaining(subject).mid;
    const r = risk(subject).color;

    // Pesos más pronunciados para la distribución por estado
    const weight = r === 'red' ? 2.0 : r === 'amber' ? 1.3 : 0.7;

    // Calcular la sugerencia base
    let suggestion = Math.min(est, weight * state.capacityDaily);

    // Asegurar que las materias rojas tengan al menos un mínimo
    if (r === 'red' && suggestion < 0.5) {
        suggestion = 0.5;
    }

    return +suggestion.toFixed(1);
}

// Nueva función para distribuir las horas de hoy de manera proporcional al riesgo
function distributeHoursToday() {
    const subjects = state.subjects;
    const totalCapacity = state.capacityDaily;

    if (subjects.length === 0) return [];

    // Calcular pesos basados en el riesgo
    const riskWeights = {
        'red': 3.0,
        'amber': 1.5,
        'green': 1.0
    };

    // Calcular el total de pesos
    let totalWeight = 0;
    const subjectWeights = subjects.map(subject => {
        const r = risk(subject).color;
        const weight = riskWeights[r];
        totalWeight += weight;
        return { subject, weight, risk: r };
    });

    // Distribuir horas proporcionalmente
    const distributedHours = subjectWeights.map(item => {
        const proportion = item.weight / totalWeight;
        const hours = proportion * totalCapacity;

        // Limitar por las horas estimadas restantes
        const est = estimateHoursRemaining(item.subject).mid;
        const finalHours = Math.min(hours, est);

        return {
            subject: item.subject,
            hours: +finalHours.toFixed(1),
            risk: item.risk
        };
    });

    return distributedHours;
}
function shortStatus(s) {
    const t = todaySuggestion(s);
    const r = risk(s).color;
    const icon = r === 'red' ? '🔻' : r === 'amber' ? '➖' : '✅';
    return `Hoy: ${t.toFixed(1)} h  ·  ${icon}`;
}
function sortSubjects(a, b) {
    const rank = { red: 0, amber: 1, green: 2 };
    const ra = rank[risk(a).color], rb = rank[risk(b).color];
    if (ra !== rb) return ra - rb;
    return daysUntil(a.examISO) - daysUntil(b.examISO);
}

// ======= Render =======
const examList = byId('examList');
const subjectsEl = byId('subjects');
const todayTotalEl = byId('todayTotal');
const capacityInput = byId('capacityInput');

function render() {
    // ordenar por riesgo/fecha
    state.subjects.sort(sortSubjects);

    capacityInput.value = state.capacityDaily;

    // Exámenes próximos
    examList.innerHTML = '';
    state.subjects.forEach(s => {
        const li = document.createElement('li');
        const d = daysUntil(s.examISO);
        const est = estimateHoursRemaining(s);
        const color = risk(s).color;
        li.innerHTML = `
      <div class="exam-item-left">
        <span class="dot ${color === 'red' ? 'red' : color === 'amber' ? 'amber' : 'green'}"></span>
        <strong>${fmtDDMMYY(s.examISO)} — ${s.name}</strong>
        <span class="small">(${d}d)</span>
      </div>
      <span class="small">${partsText(s)} · Est. ${est.lo}–${est.hi} h</span>
    `;
        examList.appendChild(li);
    });

    // Hoy total sugerido usando distribución proporcional por riesgo
    const distributedHours = distributeHoursToday();
    const total = distributedHours.reduce((acc, item) => acc + item.hours, 0);
    todayTotalEl.textContent = `${total.toFixed(1)} h`;

    // Actualizar las sugerencias de hoy con la distribución proporcional
    distributedHours.forEach(item => {
        // Actualizar la sugerencia de hoy para esta materia
        const subjectEl = subjectsEl.querySelector(`[data-id="${item.subject.id}"]`);
        if (subjectEl) {
            const todayText = subjectEl.querySelector('.today-text');
            if (todayText) {
                const icon = item.risk === 'red' ? '🔻' : item.risk === 'amber' ? '➖' : '✅';
                todayText.textContent = `Hoy: ${item.hours.toFixed(1)} h  ·  ${icon}`;
            }
        }
    });

    // Lista materias
    subjectsEl.innerHTML = '';
    state.subjects.forEach(s => subjectsEl.appendChild(subjectRow(s)));

    // Guardar después de render por si se recalcularon cosas
    saveState();
}

function partsText(s) {
    const done = s.parts.filter(p => (p.progress ?? 0) >= 1).length;
    return `${done}/${s.parts.length} temas`;
}
function subjectRow(subject) {
    const tpl = byId('subjectRow').content.cloneNode(true);
    const card = tpl.querySelector('.subject');
    card.setAttribute('data-id', subject.id); // Agregar ID para identificarla

    const dot = tpl.querySelector('.risk-dot');
    const nm = tpl.querySelector('.name');
    nm.textContent = subject.name;
    const r = risk(subject).color;
    dot.classList.add(r === 'red' ? 'risk-red' : r === 'amber' ? 'risk-amber' : 'risk-green');

    // segmentos
    const seg = tpl.querySelector('.segments');
    const total = Math.max(1, subject.parts.length);
    const done = subject.parts.filter(p => (p.progress ?? 0) >= 1).length;
    for (let i = 0; i < total; i++) {
        const el = document.createElement('div');
        el.className = 'segment' + (i < done ? ' filled' : '');
        seg.appendChild(el);
    }

    tpl.querySelector('.parts-text').textContent = `${done}/${total} partes — ${fmtDDMMYY(subject.examISO)}`;
    tpl.querySelector('.today-text').textContent = shortStatus(subject);

    tpl.querySelectorAll('.quick').forEach(btn => {
        btn.addEventListener('click', () => {
            quickAddHours(subject, Number(btn.dataset.h));
            render();
        });
    });

    tpl.querySelector('.menu').addEventListener('click', () => openDetail(subject.id));

    return card;
}

function quickAddHours(subject, hours) {
    subject.doneH = (subject.doneH ?? 0) + hours;
    // asignar a la primera parte no completa
    const idx = subject.parts.findIndex(p => (p.progress ?? 0) < 1);
    if (idx >= 0) {
        const p = subject.parts[idx];
        const tType = state.typeTimes[p.type] ?? state.typeTimes['Otro'];
        const w = DEFAULTS.difWeights[p.diff] ?? 1.0;
        const estPart = tType * w || 1.0;
        p.progress = clamp((p.progress ?? 0) + (hours / estPart), 0, 1);
        emaUpdate(p.type, hours);
    }
}

// ======= Detalle =======
const detailModal = byId('detailModal');
let currentId = null;

function openDetail(id) {
    const s = state.subjects.find(x => x.id === id); if (!s) return;
    currentId = id;

    byId('detailTitle').textContent = s.name;
    byId('m-name').value = s.name;
    byId('m-date').value = fmtDDMMYY(s.examISO); // show in dd-mm-aa format
    updateETABox(s);
    byId('m-parts-count').textContent = s.parts.length;
    drawPartsList(s);

    detailModal.showModal();
}
function updateETABox(s) {
    const est = estimateHoursRemaining(s);
    byId('m-eta').textContent = `Faltan: ${est.lo}–${est.hi} h`;
}
function drawPartsList(subject) {
    const ul = byId('partsList'); ul.innerHTML = '';
    subject.parts.forEach((p, i) => {
        const li = document.createElement('li');
        li.className = 'part-row';
        li.innerHTML = `
      <input type="text" value="${p.name}" data-k="name" />
      <select data-k="type">
        ${['TP', 'Problemas', 'Teoría', 'Lectura', 'Otro'].map(t => `<option value="${t}" ${p.type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select data-k="diff">
        ${['baja', 'media', 'alta'].map(d => `<option value="${d}" ${p.diff === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <div class="mini-bar"><div class="mini-fill" style="transform:scaleX(${clamp(p.progress ?? 0, 0, 1)})"></div></div>
      <input type="number" min="0" max="100" step="5" value="${Math.round((p.progress ?? 0) * 100)}" data-k="progress" style="width:5rem" />%
      <button class="ghost" data-act="del">Eliminar</button>
    `;
        li.querySelectorAll('input,select').forEach(inp => {
            inp.addEventListener('input', () => {
                const k = inp.dataset.k;
                if (k === 'progress') {
                    p.progress = clamp(Number(inp.value) / 100, 0, 1);
                    li.querySelector('.mini-fill').style.transform = `scaleX(${p.progress})`;
                } else { p[k] = inp.value; }
                saveState(); updateETABox(subject);
            });
        });
        li.querySelector('[data-act="del"]').addEventListener('click', () => {
            subject.parts.splice(i, 1);
            byId('m-parts-count').textContent = subject.parts.length;
            saveState(); drawPartsList(subject); updateETABox(subject); render();
        });
        ul.appendChild(li);
    });
}

byId('m-time-add').addEventListener('click', () => {
    if (!currentId) return;
    const s = state.subjects.find(x => x.id === currentId);
    const val = byId('m-time-val').value;
    const unit = byId('m-time-unit').value;
    const hrs = parseTimeInput(val, unit);
    if (hrs <= 0 || hrs > 8) return;
    quickAddHours(s, hrs);
    byId('m-time-val').value = '';
    updateETABox(s); render();
});

byId('m-parts-inc').addEventListener('click', () => {
    if (!currentId) return;
    const s = state.subjects.find(x => x.id === currentId);
    s.parts.push(newPart(`Parte ${s.parts.length + 1}`));
    byId('m-parts-count').textContent = s.parts.length;
    saveState(); drawPartsList(s); updateETABox(s); render();
});
byId('m-parts-dec').addEventListener('click', () => {
    if (!currentId) return;
    const s = state.subjects.find(x => x.id === currentId);
    const done = s.parts.filter(p => (p.progress ?? 0) >= 1).length;
    if (s.parts.length > done) {
        s.parts.pop();
        byId('m-parts-count').textContent = s.parts.length;
        saveState(); drawPartsList(s); updateETABox(s); render();
    }
});

byId('saveSubject').addEventListener('click', (e) => {
    e.preventDefault();
    if (!currentId) return;
    const s = state.subjects.find(x => x.id === currentId);
    s.name = byId('m-name').value.trim() || s.name;

    // Parse dd-mm-aa format to ISO
    const dateStr = byId('m-date').value;
    const isoDate = parseDDMMYY(dateStr);
    if (isoDate) {
        s.examISO = isoDate;
    }

    saveState(); render(); detailModal.close();
});
byId('deleteSubject').addEventListener('click', () => {
    if (!currentId) return;
    const idx = state.subjects.findIndex(x => x.id === currentId);
    if (idx >= 0 && confirm('¿Borrar esta materia?')) {
        state.subjects.splice(idx, 1);
        saveState(); render(); detailModal.close();
    }
});

// ======= Nueva materia (simplificado) =======
const newModal = byId('newModal');
byId('btn-add').addEventListener('click', () => {
    byId('n-name').value = ''; byId('n-date').value = '';
    byId('n-parts-count').textContent = '4';
    newModal.showModal();
});
byId('n-parts-inc').addEventListener('click', () => {
    const el = byId('n-parts-count'); el.textContent = String(Math.min(12, Number(el.textContent) + 1));
});
byId('n-parts-dec').addEventListener('click', () => {
    const el = byId('n-parts-count'); el.textContent = String(Math.max(1, Number(el.textContent) - 1));
});

byId('createSubject').addEventListener('click', (e) => {
    e.preventDefault();
    const name = byId('n-name').value.trim();
    const dateStr = byId('n-date').value;
    const partsN = Number(byId('n-parts-count').textContent);
    if (!name || !dateStr) return;

    // Parse dd-mm-aa format to ISO
    const isoDate = parseDDMMYY(dateStr);
    if (!isoDate) {
        alert('Por favor ingresa una fecha válida en formato dd-mm-aa');
        return;
    }

    const subject = { id: uuid(), name, examISO: isoDate, parts: [], doneH: 0 };
    for (let i = 1; i <= partsN; i++) subject.parts.push(newPart(`Parte ${i}`));

    state.subjects.push(subject);
    saveState(); newModal.close(); render();
});

// ======= Helpers =======
function newPart(name) { return { id: uuid(), name, type: 'TP', diff: 'media', progress: 0 }; }
capacityInput.addEventListener('change', () => {
    const v = Number(capacityInput.value);
    if (isFinite(v) && v >= 0) { state.capacityDaily = v; saveState(); render(); }
});


function setBackupInfo(txt) {
    // Don't show backup info to keep it simple for kids
    byId('backupInfo').textContent = '';
}
window.addEventListener('beforeunload', () => { saveState(); });
