// =========================
// QuantaPrep - app.js (completo)
// =========================

// ======= Persistencia (API) =======
const API_LOAD = '/api/load-data';
const API_SAVE = '/api/save-data';

// ======= Defaults y Estado =======
const DEFAULTS = {
    capacityDaily: 2.0,
    typeTimes: { 'TP': 1.5, 'Problemas': 1.2, 'Teoría': 1.0, 'Lectura': 0.8, 'Otro': 1.0 },
    difWeights: { baja: 1.0, media: 1.5, alta: 2.0 }
};

let state = {
    capacityDaily: DEFAULTS.capacityDaily,
    typeTimes: { ...DEFAULTS.typeTimes },
    subjects: []
};

// ======= Util =======
const byId = (id) => document.getElementById(id);
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const uuid = () => Math.random().toString(36).slice(2, 9);

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
    const month = parseInt(parts[1], 10) - 1; // 0-indexed
    const year = (() => {
        const y = parseInt(parts[2], 10);
        if (isNaN(y)) return NaN;
        // si viene 2 dígitos, asumimos 20xx
        return parts[2].length === 2 ? 2000 + y : y;
    })();

    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return date.toISOString().split('T')[0];
};

const daysUntil = (iso) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(iso); d.setHours(0, 0, 0, 0);
    return Math.max(0, Math.ceil((d - today) / (1000 * 60 * 60 * 24)));
};

const parseTimeInput = (val, unit) => {
    const n = Number(val);
    if (!isFinite(n) || n <= 0) return 0;
    return unit === 'min' ? n / 60 : n;
};

// ======= Carga inicial =======
(async function init() {
    try {
        const response = await fetch(API_LOAD);
        if (response.ok) {
            const data = await response.json();
            if (data && Array.isArray(data.subjects)) {
                state = migrate(data);
                setBackupInfo('Cargado desde el servidor (data.json)');
            }
        } else {
            console.log('Sin datos previos (HTTP', response.status, '). Arrancando vacío.');
        }
    } catch (error) {
        console.log('Error cargando desde el servidor. Arranco vacío...', error);
    }
    wireUI(); // engancha listeners luego de que el DOM está disponible
    render();
})();

function migrate(data) {
    return {
        capacityDaily: Number(data.capacityDaily) || DEFAULTS.capacityDaily,
        typeTimes: { ...DEFAULTS.typeTimes, ...(data.typeTimes || {}) },
        subjects: Array.isArray(data.subjects) ? data.subjects : []
    };
}

async function saveState() {
    try {
        const response = await fetch(API_SAVE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        if (!response.ok) console.error('Error al guardar datos (HTTP):', response.status);
    } catch (error) {
        console.error('Error al guardar en el servidor:', error);
    }
}

// ======= Sistema de Retroalimentación Inteligente =======
function emaUpdate(type, tReal, alpha = 0.3) {
    const prev = state.typeTimes[type] ?? DEFAULTS.typeTimes['Otro'];
    const next = (1 - alpha) * prev + alpha * tReal;
    state.typeTimes[type] = clamp(next, 0.25, 6);

    // Registrar el tiempo real para análisis histórico
    if (!state.performanceHistory) state.performanceHistory = {};
    if (!state.performanceHistory[type]) state.performanceHistory[type] = [];

    state.performanceHistory[type].push({
        timestamp: new Date().toISOString(),
        estimated: prev,
        actual: tReal,
        ratio: tReal / prev
    });

    // Mantener solo los últimos 50 registros por tipo
    if (state.performanceHistory[type].length > 50) {
        state.performanceHistory[type] = state.performanceHistory[type].slice(-50);
    }
}

// Nueva función para calcular confianza en las estimaciones
function getEstimationConfidence(type) {
    if (!state.performanceHistory || !state.performanceHistory[type]) {
        return { confidence: 0.5, samples: 0, avgRatio: 1.0 };
    }

    const history = state.performanceHistory[type];
    if (history.length < 3) {
        return { confidence: 0.5, samples: history.length, avgRatio: 1.0 };
    }

    // Calcular la variabilidad de los ratios (actual/estimado)
    const ratios = history.map(h => h.ratio);
    const avgRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
    const variance = ratios.reduce((sum, r) => sum + Math.pow(r - avgRatio, 2), 0) / ratios.length;

    // La confianza es inversamente proporcional a la variabilidad
    // Más muestras = más confianza, menos variabilidad = más confianza
    const baseConfidence = Math.max(0.1, 1 - Math.sqrt(variance));
    const sampleFactor = Math.min(1, history.length / 20); // Máxima confianza con 20 muestras
    const confidence = baseConfidence * sampleFactor;

    return {
        confidence: Math.round(confidence * 100) / 100,
        samples: history.length,
        avgRatio: Math.round(avgRatio * 100) / 100
    };
}

// Función mejorada para estimar horas que considera la confianza
function smartEstimateHoursRemaining(subject) {
    const w = DEFAULTS.difWeights;
    let rem = 0;
    let totalConfidence = 0;
    let confidenceSamples = 0;

    subject.parts.forEach(p => {
        const tType = state.typeTimes[p.type] ?? state.typeTimes['Otro'];
        const confidence = getEstimationConfidence(p.type);

        // Ajustar estimación basada en el rendimiento histórico
        const adjustedTime = tType * (confidence.avgRatio || 1.0);
        const partHours = (adjustedTime * (w[p.diff] ?? 1.0)) * (1 - (p.progress ?? 0));

        rem += partHours;
        totalConfidence += confidence.confidence;
        confidenceSamples++;
    });

    const avgConfidence = confidenceSamples > 0 ? totalConfidence / confidenceSamples : 0.5;

    // Ajustar el rango de estimación basado en la confianza
    // Menos confianza = rango más amplio
    const confidenceFactor = 1 - avgConfidence; // 0 = alta confianza, 0.5 = baja confianza
    const range = 0.15 + (confidenceFactor * 0.35); // 15% a 50% de rango

    return {
        lo: +(rem * (1 - range)).toFixed(1),
        mid: +rem.toFixed(1),
        hi: +(rem * (1 + range)).toFixed(1),
        confidence: Math.round(avgConfidence * 100) / 100
    };
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
    const est = smartEstimateHoursRemaining(subject).mid;
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
    let totalWeight = 0;

    const subjectWeights = subjects.map(subject => {
        const r = risk(subject).color;
        const weight = riskWeights[r];
        totalWeight += weight;
        return { subject, weight, risk: r };
    });

    return subjectWeights.map(item => {
        const proportion = item.weight / totalWeight;
        const hours = proportion * totalCapacity;
        const est = smartEstimateHoursRemaining(item.subject).mid;
        const finalHours = Math.min(hours, est);
        return { subject: item.subject, hours: +finalHours.toFixed(1), risk: item.risk };
    });
}

function shortStatus(s) {
    const distributedHours = distributeHoursToday();
    const subjectHours = distributedHours.find(item => item.subject.id === s.id);
    const hours = subjectHours ? subjectHours.hours : 0;
    const r = risk(s).color;
    const icon = r === 'red' ? '🔻' : r === 'amber' ? '➖' : '✅';
    return `Hoy: ${hours.toFixed(1)} h  ·  ${icon}`;
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

    if (capacityInput) capacityInput.value = state.capacityDaily;

    // Próximos exámenes
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

    // Total sugerido hoy
    const distributed = distributeHoursToday();
    const total = distributed.reduce((acc, it) => acc + it.hours, 0);
    if (todayTotalEl) todayTotalEl.textContent = `${total.toFixed(1)} h`;

    // Lista de materias
    if (subjectsEl) {
        subjectsEl.innerHTML = '';
        state.subjects.forEach(s => subjectsEl.appendChild(subjectRow(s)));
    }

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
    const filledSegments = Math.floor(totalProgress);
    const partialProgress = totalProgress - filledSegments;

    for (let i = 0; i < total; i++) {
        const el = document.createElement('div');
        let className = 'segment';
        if (i < filledSegments) {
            className += ' filled';
        } else if (i === filledSegments && partialProgress > 0) {
            className += ' partial';
            el.style.setProperty('--progress-width', `${partialProgress * 100}%`);
        }
        el.className = className;
        seg.appendChild(el);
    }

    tpl.querySelector('.parts-text').textContent = `${sPartsDone(subject)}/${subject.parts.length} partes — ${fmtDDMMYY(subject.examISO)}`;
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

function sPartsDone(s) {
    return s.parts.filter(p => (p.progress ?? 0) >= 1).length;
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
        emaUpdate(p.type, hours);
    }
}

// ======= Detalle (modal editar) =======
const detailModal = byId('detailModal');
let currentId = null;

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
    const est = smartEstimateHoursRemaining(s);
    const confidenceText = est.confidence > 0.7 ? "✓" : est.confidence > 0.4 ? "~" : "?";
    byId('m-eta').textContent = `Faltan: ${est.lo}–${est.hi} h ${confidenceText}`;
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

// Botones del modal detalle (se enganchan en wireUI)

// ======= Nueva materia (modal nuevo) =======
function newPart(name) { return { id: uuid(), name, type: 'TP', diff: 'media', progress: 0 }; }

// ======= Wire UI (listeners robustos) =======
function wireUI() {
    // "+ Nueva"
    const btnAdd = byId('btn-add');
    const newModal = byId('newModal');

    if (btnAdd) {
        btnAdd.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (!newModal) { console.error('No se encontró #newModal en el DOM'); return; }
            const nameEl = byId('n-name');
            const dateEl = byId('n-date');
            const partsEl = byId('n-parts-count');
            if (nameEl) nameEl.value = '';
            if (dateEl) dateEl.value = '';
            if (partsEl) partsEl.textContent = '4';
            try {
                if (typeof newModal.showModal === 'function') newModal.showModal();
                else newModal.setAttribute('open', '');
            } catch (e) {
                console.error('Error al abrir el modal Nuevo:', e);
                newModal.setAttribute('open', '');
            }
        });
    }

    // Inc/Dec en modal Nuevo
    byId('n-parts-inc')?.addEventListener('click', () => {
        const el = byId('n-parts-count'); if (!el) return;
        el.textContent = String(Math.min(12, Number(el.textContent || '4') + 1));
    });
    byId('n-parts-dec')?.addEventListener('click', () => {
        const el = byId('n-parts-count'); if (!el) return;
        el.textContent = String(Math.max(1, Number(el.textContent || '4') - 1));
    });

    // Crear materia
    byId('createSubject')?.addEventListener('click', (e) => {
        try {
            e.preventDefault();
            const name = (byId('n-name')?.value || '').trim();
            const dateStr = byId('n-date')?.value || '';
            const partsN = Number(byId('n-parts-count')?.textContent || '4');
            if (!name || !dateStr) return;

            const isoDate = parseDDMMYY(dateStr);
            if (!isoDate) { alert('Por favor ingresa una fecha válida en formato dd-mm-aa'); return; }

            const subject = { id: uuid(), name, examISO: isoDate, parts: [], doneH: 0 };
            for (let i = 1; i <= partsN; i++) subject.parts.push(newPart(`Parte ${i}`));

            state.subjects.push(subject);
            saveState();
            newModal?.close?.();
            render();
        } catch (err) {
            console.error('Error creando materia:', err);
        }
    });

    // Modal Detalle: botones
    byId('m-time-add')?.addEventListener('click', () => {
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

    // Botón "+ Tema" en detalle
    byId('addPart')?.addEventListener('click', () => {
        if (!currentId) return;
        const s = state.subjects.find(x => x.id === currentId);
        s.parts.push(newPart(`Parte ${s.parts.length + 1}`));
        byId('m-parts-count').textContent = s.parts.length;
        saveState(); drawPartsList(s); updateETABox(s); render();
    });

    // Guardar materia (detalle)
    byId('saveSubject')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!currentId) return;
        const s = state.subjects.find(x => x.id === currentId);
        s.name = byId('m-name').value.trim() || s.name;

        const dateStr = byId('m-date').value;
        const isoDate = parseDDMMYY(dateStr);
        if (isoDate) s.examISO = isoDate;

        saveState(); render();
        detailModal?.close?.();
    });

    // Borrar materia
    byId('deleteSubject')?.addEventListener('click', () => {
        if (!currentId) return;
        const idx = state.subjects.findIndex(x => x.id === currentId);
        if (idx >= 0 && confirm('¿Borrar esta materia?')) {
            state.subjects.splice(idx, 1);
            saveState(); render();
            detailModal?.close?.();
        }
    });

    // Cambio de capacidad diaria
    capacityInput?.addEventListener('change', () => {
        const v = Number(capacityInput.value);
        if (isFinite(v) && v >= 0) { state.capacityDaily = v; saveState(); render(); }
    });

    // Guardar al salir
    window.addEventListener('beforeunload', () => { saveState(); });
}

// ======= Miscelánea =======
function setBackupInfo(txt) {
    // Oculto para no distraer
    byId('backupInfo').textContent = '';
}
