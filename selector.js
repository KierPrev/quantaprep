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

    // Si no hay parámetro, verificar el entorno del servidor
    try {
        const response = await fetch('/api/environment', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            const env = await response.json();

            if (env.isStatic) {
                console.log('Servidor en entorno estático, usando LocalStorageStore');
                return new LocalStorageStore();
            } else {
                console.log('Servidor en entorno dinámico, usando HttpStore');
                return new HttpStore();
            }
        }
    } catch (error) {
        console.log('No se pudo obtener información del entorno, probando ping...');
    }

    // Fallback: probar ping tradicional
    try {
        const response = await fetch('/api/ping', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            console.log('Servidor disponible (ping), usando HttpStore');
            return new HttpStore();
        }
    } catch (error) {
        console.log('Servidor no disponible, usando LocalStorageStore');
    }

    // Fallback final a localStorage
    console.log('Usando LocalStorageStore (fallback final)');
    return new LocalStorageStore();
}
