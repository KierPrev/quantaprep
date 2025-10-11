// =========================
// QuantaPrep - selector.js
// Selector automático de almacenamiento
// =========================

// ======= Función de selección automática =======
async function getStore() {
    const urlParams = new URLSearchParams(window.location.search);

    // Si hay parámetro explícito en la URL
    if (urlParams.has('mode')) {
        const mode = urlParams.get('mode');
        if (mode === 'local') {
            console.log('Usando LocalStorageStore (modo forzado)');
            return new LocalStorageStore();
        }
        if (mode === 'server') {
            console.log('Usando HttpStore (modo forzado)');
            return new HttpStore();
        }
    }

    // Si no hay parámetro, probar si el servidor está disponible
    try {
        const response = await fetch('/api/ping', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            console.log('Servidor disponible, usando HttpStore');
            return new HttpStore();
        }
    } catch (error) {
        console.log('Servidor no disponible, usando LocalStorageStore');
    }

    // Fallback a localStorage
    console.log('Usando LocalStorageStore (fallback)');
    return new LocalStorageStore();
}
