// ======= Persistencia =======
const API_LOAD = '/api/load-data';
const API_SAVE = '/api/save-data';

// ... (resto igual)

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
            console.log('Sin datos previos (404). Arrancando vacío.');
        }
    } catch (error) {
        console.log('Error cargando desde el servidor. Arranco vacío...', error);
    }
    render();
})();

// ...

async function saveState() {
    try {
        const response = await fetch(API_SAVE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        if (!response.ok) {
            console.error('Error al guardar datos (HTTP):', response.status);
        }
    } catch (error) {
        console.error('Error al guardar en el servidor:', error);
    }
}


function migrate(data) {
    return {
        capacityDaily: Number(data.capacityDaily) || 2.0,
        typeTimes: data.typeTimes || {},
        subjects: Array.isArray(data.subjects) ? data.subjects : []
    };
}

function render() {
    console.log('Render ejecutado. Materias:', state.subjects);
    // Si querés mostrar algo visual:
    const out = document.getElementById('subjects');
    if (out) {
        out.innerHTML = state.subjects.map(s => `<li>${s.name}</li>`).join('');
    }
}
