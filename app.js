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
    typeTimes: { 'TP': 3.0, 'Problemas': 1.5, 'Teoría': 3.5, 'Lectura': 1.0, 'Otro': 1.0 },
    difWeights: { baja: 1.0, media: 2.0, alta: 3.0 }
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
    // Parse the YYYY-MM-DD string directly without timezone conversion
    if (!iso || typeof iso !== 'string') return '--/--/--';

    const parts = iso.split('-');
    if (parts.length !== 3) return '--/--/--';

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    if (![year, month, day].every(Number.isFinite)) return '--/--/--';

    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    const yy = String(year).slice(-2);
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

    // Create date in local timezone and format as YYYY-MM-DD without timezone conversion
    const dt = new Date(year, month, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) return null;

    // Format as YYYY-MM-DD without timezone issues
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
let storageMode = 'server'; // 'server' | 'localStorage'

// Función para guardar en localStorage
function saveToLocalStorage(data) {
    try {
        localStorage.setItem('quantaprep-data', JSON.stringify(data));
        console.log('💾 Guardado en localStorage');
        return true;
    } catch (e) {
        console.warn('⚠️ Error al guardar en localStorage:', e.message);
        return false;
    }
}

// Función para cargar desde localStorage
function loadFromLocalStorage() {
    try {
        const stored = localStorage.getItem('quantaprep-data');
        if (stored) {
            const data = JSON.parse(stored);
            console.log('📂 Cargado desde localStorage');
            return data;
        }
    } catch (e) {
        console.warn('⚠️ Error al cargar desde localStorage:', e.message);
    }
    return null;
}

// Función para verificar si el servidor está disponible
async function isServerAvailable() {
    try {
        const response = await fetch(API_LOAD, {
            method: 'HEAD',
            cache: 'no-store',
            timeout: 3000
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

// Guardar estado con fallback
async function saveStateNow() {
    // Primero intentar guardar en servidor
    try {
        const r = await fetch(API_SAVE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        if (r.ok) {
            console.log('💾 Guardado en servidor (data.json)');
            storageMode = 'server';
            return;
        }
    } catch (e) {
        console.warn('⚠️ No se pudo guardar en servidor:', e.message);
    }

    // Fallback a localStorage
    if (saveToLocalStorage(state)) {
        storageMode = 'localStorage';
    } else {
        console.error('❌ No se pudo guardar en ningún almacenamiento');
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


// ==== Modelo de cálculo ====
function estimateHoursRemaining(subject) {
    // FÓRMULA: Horas_restantes = Σ [ (Tiempo_tipo × Peso_dificultad) × (1 - Progreso) ]
    // Tiempo_tipo: TP=3.0h, Problemas=1.5h, Teoría=3.5h, Lectura=1.0h, Otro=1.0h
    // Peso_dificultad: baja=1.0, media=2.0, alta=3.0
    // Progreso: 0 a 1 (0% a 100%)

    // IMPLEMENTACIÓN: Para cada parte, calcular: (tiempo_tipo × peso_dificultad) × (1 - progreso)
    let totalHours = 0;
    subject.parts.forEach(part => {
        const tiempoTipo = state.typeTimes[part.type] ?? state.typeTimes['Otro'];
        const pesoDificultad = DEFAULTS.difWeights[part.diff] ?? 1.0;
        const progreso = part.progress ?? 0;

        // FÓRMULA APLICADA: (tiempo_tipo × peso_dificultad) × (1 - progreso)
        totalHours += (tiempoTipo * pesoDificultad) * (1 - progreso);
    });

    // Rango estimado: ±15% del valor medio
    return {
        lo: +(totalHours * 0.85).toFixed(1),
        mid: +totalHours.toFixed(1),
        hi: +(totalHours * 1.25).toFixed(1)
    };
}


function risk(subject, distributedHours = null) {
    const diasHastaExamen = Math.max(1, daysUntil(subject.examISO));
    const horasRestantes = estimateHoursRemaining(subject).mid;

    // Use distributed hours if provided, otherwise fall back to daily capacity
    let capacidad;
    if (distributedHours !== null && distributedHours > 0) {
        capacidad = distributedHours;
    } else {
        capacidad = Math.max(0.25, state.capacityDaily);
    }

    // FÓRMULA DE RIESGO: Horas_restantes / (Días_hasta_examen × Capacidad_diaria)
    // Si R > 1.2: rojo (no hay suficiente tiempo)
    // Si R > 0.8: ámbar (apretado)
    // Sino: verde (suficiente tiempo)
    const R = horasRestantes / (diasHastaExamen * capacidad);

    let color = 'green';
    if (R > 1.2) color = 'red';
    else if (R > 0.8) color = 'amber';

    return { R, color };
}

function distributeHoursToday() {
    const subjects = state.subjects;
    const totalCapacity = state.capacityDaily;
    if (subjects.length === 0) return [];

    // MODIFICACIÓN: Aumentar el umbral de urgencia y prioridad
    const urgentSubjects = subjects.filter(s => daysUntil(s.examISO) <= 5); // Aumentar a 5 días
    if (urgentSubjects.length > 0) {
        // Sort urgent subjects by days until exam (today first)
        urgentSubjects.sort((a, b) => daysUntil(a.examISO) - daysUntil(b.examISO));

        // MODIFICACIÓN: Dar MÁS prioridad a lo urgente - 90% para urgentes
        const urgentCapacity = Math.min(totalCapacity * 0.9, totalCapacity); // 90% para urgentes
        const normalCapacity = totalCapacity - urgentCapacity;

        // Calcular distribución entre urgentes
        const urgentDistribution = distributeAmongUrgent(urgentSubjects, urgentCapacity);

        // Si hay capacidad restante, distribuir entre materias normales
        if (normalCapacity > 0 && subjects.length > urgentSubjects.length) {
            const normalSubjects = subjects.filter(s => daysUntil(s.examISO) > 5);
            const normalDistribution = distributeAmongNormal(normalSubjects, normalCapacity);
            return [...urgentDistribution, ...normalDistribution];
        }

        return urgentDistribution;
    }

    // No urgent subjects, use original logic
    const riskWeights = { 'red': 3.0, 'amber': 1.5, 'green': 1.0 };
    let totalW = 0;
    const items = subjects.map(s => {
        // For initial distribution, use total capacity since we don't have distributed hours yet
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

// Nueva función: Distribuir entre materias urgentes
function distributeAmongUrgent(urgentSubjects, capacity) {
    // Dar más peso a las materias más urgentes
    let totalWeight = 0;
    const weightedSubjects = urgentSubjects.map(s => {
        const daysLeft = daysUntil(s.examISO);
        const weight = 1 / (daysLeft + 1); // Más peso a menos días
        totalWeight += weight;
        return { subject: s, weight, daysLeft };
    });

    return weightedSubjects.map(ws => {
        const prop = ws.weight / totalWeight;
        const hours = prop * capacity;
        const est = estimateHoursRemaining(ws.subject).mid;
        return {
            subject: ws.subject,
            hours: +Math.min(hours, est).toFixed(1),
            risk: risk(ws.subject, hours).color
        };
    });
}

// Nueva función: Distribuir entre materias normales
function distributeAmongNormal(normalSubjects, capacity) {
    const riskWeights = { 'red': 3.0, 'amber': 1.5, 'green': 1.0 };
    let totalW = 0;
    const items = normalSubjects.map(s => {
        const r = risk(s).color;
        const w = riskWeights[r];
        totalW += w;
        return { subject: s, weight: w, risk: r };
    });

    return items.map(it => {
        const prop = it.weight / totalW;
        const hours = prop * capacity;
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
    const r = risk(s, hours).color;
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
const subjectsEl = byId('subjects');
const todayTotalEl = byId('todayTotal');
const capacityInput = byId('capacityInput');
const detailModal = byId('detailModal');
let currentId = null;

function sortSubjects(a, b) {
    const rank = { red: 0, amber: 1, green: 2 };
    // Get distributed hours for correct risk calculation
    const distributed = distributeHoursToday();
    const hoursA = distributed.find(x => x.subject.id === a.id)?.hours || 0;
    const hoursB = distributed.find(x => x.subject.id === b.id)?.hours || 0;
    const ra = rank[risk(a, hoursA).color], rb = rank[risk(b, hoursB).color];
    if (ra !== rb) return ra - rb;
    return daysUntil(a.examISO) - daysUntil(b.examISO);
}

function render() {
    // ordenar por riesgo/fecha
    state.subjects.sort(sortSubjects);

    // resumen exámenes - removido, ahora solo en las tarjetas individuales

    // total mínimo necesario para completar todo al 100%
    const totalMinHours = state.subjects.reduce((acc, s) => {
        const est = estimateHoursRemaining(s);
        return acc + est.mid;
    }, 0);
    if (todayTotalEl) todayTotalEl.textContent = `${totalMinHours.toFixed(1)} h`;

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

    // Get distributed hours for this subject to calculate correct risk
    const distributed = distributeHoursToday();
    const it = distributed.find(x => x.subject.id === subject.id);
    const hours = it ? it.hours : 0;
    const r = risk(subject, hours).color;
    dot.classList.add(r === 'red' ? 'risk-red' : r === 'amber' ? 'risk-amber' : 'risk-green');

    // segmentos con parcial y nombres
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
        el.textContent = subject.parts[i]?.name || `Parte ${i + 1}`;
        el.title = subject.parts[i]?.name || `Parte ${i + 1}`; // tooltip

        // Double click to edit part name
        el.addEventListener('dblclick', () => {
            const currentName = subject.parts[i]?.name || `Parte ${i + 1}`;
            const newName = prompt('Editar nombre de la parte:', currentName);
            if (newName !== null && newName.trim() !== '') {
                if (subject.parts[i]) {
                    subject.parts[i].name = newName.trim();
                } else {
                    subject.parts[i] = { name: newName.trim(), type: 'TP', diff: 'media', progress: 0 };
                }
                saveState();
                render();
            }
        });

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
    // Primero intentar cargar desde servidor
    try {
        const r = await fetch(API_LOAD, { cache: 'no-store' });
        if (r.ok) {
            const data = await r.json();
            if (data && Array.isArray(data.subjects)) {
                state = migrate(data);
                storageMode = 'server';
                wireUI();
                render();
                return;
            }
        }
    } catch (error) {
        console.log('Servidor no disponible:', error.message);
    }

    // Fallback: intentar cargar desde localStorage
    const localData = loadFromLocalStorage();
    if (localData && Array.isArray(localData.subjects)) {
        state = migrate(localData);
        storageMode = 'localStorage';
        console.log('📂 Usando datos de localStorage');
    } else {
        // Sin datos en ningún almacenamiento
        console.log('Sin datos previos. Arrancando vacío.');
    }

    wireUI();
    render();
})();
