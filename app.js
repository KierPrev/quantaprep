// =========================
// QuantaPrep - app.js (completo, compatible con tu index.html)
// Mismo origen/puerto; sin carpeta public.
// =========================

// Endpoints (mismo servidor Express)
const API_LOAD = '/api/load-data';
const API_SAVE = '/api/save-data';

// ==== Defaults y estado ====
const DEFAULTS = {
    capacityDaily: 2.0,
    typeTimes: { 'TP': 1.7, 'Problemas': 1.2, 'Teoría': 2.0, 'Lectura': 0.8, 'Otro': 1.0 },
    difWeights: { baja: 1.0, media: 1.5, alta: 2.0 }
};

let state = {
    capacityDaily: DEFAULTS.capacityDaily,
    typeTimes: { ...DEFAULTS.typeTimes },
    subjects: []
};

// ==== Utils DOM/tiempo ====
const byId = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const uuid = () => Math.random().toString(36).slice(2, 9);

const fmtDDMMYY = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '--/--/--';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy}`;
};

const parseDDMMYY = (str) => {
    const parts = String(str || '').trim().split('-');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    const year = parts[2].length === 2 ? 2000 + y : y;
    if (![day, month, year].every(Number.isFinite)) return null;
    const dt = new Date(year, month, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) return null;
    return dt.toISOString().split('T')[0];
};

const daysUntil = (iso) => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = new Date(iso); d.setHours(0, 0, 0, 0);
    return Math.max(0, Math.ceil((d - t) / 86400000));
};

const parseTimeInput = (val, unit) => {
    const n = Number(val);
    if (!isFinite(n) || n <= 0) return 0;
    return unit === 'min' ? n / 60 : n;
};

// ==== Persistencia (debounce) ====
let saveTimer = null;
async function saveStateNow() {
    try {
        const r = await fetch(API_SAVE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        if (!r.ok) console.warn('⚠️ Error al guardar (HTTP):', r.status);
        else console.log('💾 Guardado OK');
    } catch (e) {
        console.warn('⚠️ No se pudo guardar en servidor:', e.message);
    }
}
function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveStateNow, 400);
}

// ==== Migración/normalización ====
function migrate(data) {
    return {
        capacityDaily: Number(data.capacityDaily) || DEFAULTS.capacityDaily,
        typeTimes: { ...DEFAULTS.typeTimes, ...(data.typeTimes || {}) },
        subjects: Array.isArray(data.subjects) ? data.subjects : []
    };
}

function setBackupInfo(txt) {
    const el = byId('backupInfo');
    if (el) el.textContent = txt || '';
}

// ==== Modelo de cálculo ====
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

function distributeHoursToday() {
    const subjects = state.subjects;
    const totalCapacity = state.capacityDaily;
    if (subjects.length === 0) return [];
    const riskWeights = { 'red': 3.0, 'amber': 1.5, 'green': 1.0 };
    let totalW = 0;
    const items = subjects.map(s => {
        const r = risk(s).color;
        const w = riskWeights[r];
        totalW += w;
        return { subject: s, weight: w, risk: r };
    });
    return items.map(it => {
        const prop = it.weight / totalW;
        const hours = prop * totalCapacity;
        const est = estimateHoursRemaining(it.subject).mid;
        return { subject: it.subject, hours: +Math.min(hours, est).toFixed(1), risk: it.risk };
    });
}

function partsText(s) {
    const done = s.parts.filter(p => (p.progress ?? 0) >= 1).length;
    return `${done}/${s.parts.length} temas`;
}

function sPartsDone(s) {
    return s.parts.filter(p => (p.progress ?? 0) >= 1).length;
}

function shortStatus(s) {
    const distributed = distributeHoursToday();
    const it = distributed.find(x => x.subject.id === s.id);
    const hours = it ? it.hours : 0;
    const r = risk(s).color;
    const icon = r === 'red' ? '🔻' : r === 'amber' ? '➖' : '✅';
    return `Hoy: ${hours.toFixed(1)} h · ${icon}`;
}

function quickAddHours(subject, hours) {
    subject.doneH = (subject.doneH ?? 0) + hours;
    const idx = subject.parts.findIndex(p => (p.progress ?? 0) < 1);
    if (idx >= 0) {
        const p = subject.parts[idx];
        const tType = state.typeTimes[p.type] ?? state.typeTimes['Otro'];
        const w = DEFAULTS.difWeights[p.diff] ?? 1.0;
        const estPart = tType * w || 1.0;
        p.progress = clamp((p.progress ?? 0) + (hours / estPart), 0, 1);
    }
}

// ==== Render ====
const examList = byId('examList');
const subjectsEl = byId('subjects');
const todayTotalEl = byId('todayTotal');
const capacityInput = byId('capacityInput');
const detailModal = byId('detailModal');
let currentId = null;

function sortSubjects(a, b) {
    const rank = { red: 0, amber: 1, green: 2 };
    const ra = rank[risk(a).color], rb = rank[risk(b).color];
    if (ra !== rb) return ra - rb;
    return daysUntil(a.examISO) - daysUntil(b.examISO);
}

function render() {
    // ordenar por riesgo/fecha
    state.subjects.sort(sortSubjects);

    // resumen exámenes
    if (examList) {
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
    }

    // total sugerido hoy
    const distributed = distributeHoursToday();
    const total = distributed.reduce((acc, it) => acc + it.hours, 0);
    if (todayTotalEl) todayTotalEl.textContent = `${total.toFixed(1)} h`;

    // materias
    if (subjectsEl) {
        subjectsEl.innerHTML = '';
        state.subjects.forEach(s => subjectsEl.appendChild(subjectRow(s)));
    }

    // input capacidad
    if (capacityInput) capacityInput.value = state.capacityDaily;
}

function subjectRow(subject) {
    const tpl = byId('subjectRow').content.cloneNode(true);
    const card = tpl.querySelector('.subject');
    card.setAttribute('data-id', subject.id);

    const dot = tpl.querySelector('.risk-dot');
    const nm = tpl.querySelector('.name');
    nm.textContent = subject.name;
    const r = risk(subject).color;
    dot.classList.add(r === 'red' ? 'risk-red' : r === 'amber' ? 'risk-amber' : 'risk-green');

    // segmentos con parcial
    const seg = tpl.querySelector('.segments');
    const total = Math.max(1, subject.parts.length);
    const totalProgress = subject.parts.reduce((sum, p) => sum + (p.progress ?? 0), 0);
    const filled = Math.floor(totalProgress);
    const partial = totalProgress - filled;

    for (let i = 0; i < total; i++) {
        const el = document.createElement('div');
        let cls = 'segment';
        if (i < filled) cls += ' filled';
        else if (i === filled && partial > 0) {
            cls += ' partial';
            el.style.setProperty('--progress-width', `${partial * 100}%`);
        }
        el.className = cls;
        seg.appendChild(el);
    }

    tpl.querySelector('.parts-text').textContent =
        `${sPartsDone(subject)}/${subject.parts.length} partes — ${fmtDDMMYY(subject.examISO)}`;
    tpl.querySelector('.today-text').textContent = shortStatus(subject);

    tpl.querySelectorAll('.quick').forEach(btn => {
        btn.addEventListener('click', () => {
            quickAddHours(subject, Number(btn.dataset.h));
            saveState(); render();
        });
    });

    tpl.querySelector('.menu').addEventListener('click', () => openDetail(subject.id));

    return card;
}

// ==== Detalle (modal) ====
function openDetail(id) {
    const s = state.subjects.find(x => x.id === id); if (!s) return;
    currentId = id;

    byId('detailTitle').textContent = s.name;
    byId('m-name').value = s.name;
    byId('m-date').value = fmtDDMMYY(s.examISO);
    updateETABox(s);
    byId('m-parts-count').textContent = s.parts.length;
    drawPartsList(s);

    try {
        if (typeof detailModal.showModal === 'function') detailModal.showModal();
        else detailModal.setAttribute('open', '');
    } catch {
        detailModal.setAttribute('open', '');
    }
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
                } else {
                    p[k] = inp.value;
                }
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

function newPart(name) { return { id: uuid(), name, type: 'TP', diff: 'media', progress: 0 }; }

// ==== Wire UI ====
function wireUI() {
    // "+ Nueva"
    const btnAdd = byId('btn-add');
    const newModal = byId('newModal');

    btnAdd?.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!newModal) return;
        byId('n-name').value = '';
        byId('n-date').value = '';
        byId('n-parts-count').textContent = '4';
        try {
            if (typeof newModal.showModal === 'function') newModal.showModal();
            else newModal.setAttribute('open', '');
        } catch {
            newModal.setAttribute('open', '');
        }
    });

    // Nuevo: inc/dec
    byId('n-parts-inc')?.addEventListener('click', () => {
        const el = byId('n-parts-count'); el.textContent = String(Math.min(12, Number(el.textContent || '4') + 1));
    });
    byId('n-parts-dec')?.addEventListener('click', () => {
        const el = byId('n-parts-count'); el.textContent = String(Math.max(1, Number(el.textContent || '4') - 1));
    });

    // Crear materia
    byId('createSubject')?.addEventListener('click', (e) => {
        e.preventDefault();
        const name = (byId('n-name').value || '').trim();
        const dateStr = byId('n-date').value || '';
        const partsN = Number(byId('n-parts-count').textContent || '4');
        if (!name || !dateStr) return;
        const iso = parseDDMMYY(dateStr);
        if (!iso) { alert('Fecha inválida (dd-mm-aa)'); return; }

        const s = { id: uuid(), name, examISO: iso, parts: [], doneH: 0 };
        for (let i = 1; i <= partsN; i++) s.parts.push(newPart(`Parte ${i}`));

        state.subjects.push(s);
        saveState();
        newModal?.close?.();
        render();
    });

    // Detalle: sumar tiempo exacto
    byId('m-time-add')?.addEventListener('click', () => {
        if (!currentId) return;
        const s = state.subjects.find(x => x.id === currentId);
        const val = byId('m-time-val').value;
        const unit = byId('m-time-unit').value;
        const hrs = parseTimeInput(val, unit);
        if (hrs <= 0 || hrs > 8) return;
        quickAddHours(s, hrs);
        byId('m-time-val').value = '';
        saveState(); updateETABox(s); render();
    });

    // Detalle: inc/dec partes
    byId('m-parts-inc')?.addEventListener('click', () => {
        if (!currentId) return;
        const s = state.subjects.find(x => x.id === currentId);
        s.parts.push(newPart(`Parte ${s.parts.length + 1}`));
        byId('m-parts-count').textContent = s.parts.length;
        saveState(); drawPartsList(s); updateETABox(s); render();
    });
    byId('m-parts-dec')?.addEventListener('click', () => {
        if (!currentId) return;
        const s = state.subjects.find(x => x.id === currentId);
        const done = s.parts.filter(p => (p.progress ?? 0) >= 1).length;
        if (s.parts.length > done) {
            s.parts.pop();
            byId('m-parts-count').textContent = s.parts.length;
            saveState(); drawPartsList(s); updateETABox(s); render();
        }
    });

    // Detalle: +Tema
    byId('addPart')?.addEventListener('click', () => {
        if (!currentId) return;
        const s = state.subjects.find(x => x.id === currentId);
        s.parts.push(newPart(`Parte ${s.parts.length + 1}`));
        byId('m-parts-count').textContent = s.parts.length;
        saveState(); drawPartsList(s); updateETABox(s); render();
    });

    // Detalle: Guardar materia
    byId('saveSubject')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!currentId) return;
        const s = state.subjects.find(x => x.id === currentId);
        s.name = byId('m-name').value.trim() || s.name;
        const iso = parseDDMMYY(byId('m-date').value);
        if (iso) s.examISO = iso;
        saveState(); render();
        detailModal?.close?.();
    });

    // Detalle: Borrar
    byId('deleteSubject')?.addEventListener('click', () => {
        if (!currentId) return;
        const idx = state.subjects.findIndex(x => x.id === currentId);
        if (idx >= 0 && confirm('¿Borrar esta materia?')) {
            state.subjects.splice(idx, 1);
            saveState(); render();
            detailModal?.close?.();
        }
    });

    // Cambio capacidad diaria
    capacityInput?.addEventListener('change', () => {
        const v = Number(capacityInput.value);
        if (isFinite(v) && v >= 0) { state.capacityDaily = v; saveState(); render(); }
    });

    // Guardar al salir
    window.addEventListener('beforeunload', () => { saveState(); });
}

// ==== Carga inicial ====
(async function init() {
    try {
        const r = await fetch(API_LOAD, { cache: 'no-store' });
        if (r.ok) {
            const data = await r.json();
            if (data && Array.isArray(data.subjects)) {
                state = migrate(data);
                setBackupInfo('Cargado desde el servidor (data.json)');
            }
        } else {
            console.log('Sin datos previos (HTTP', r.status, '). Arrancando vacío.');
            setBackupInfo('Sin datos previos. Guardá para crear data.json');
        }
    } catch (error) {
        console.log('Error cargando desde el servidor. Arranco vacío...', error);
        setBackupInfo('Servidor sin datos o offline. Usando estado vacío.');
    }
    wireUI();
    render();
})();
