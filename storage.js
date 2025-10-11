// =========================
// QuantaPrep - storage.js
// Adaptadores de almacenamiento
// =========================

// ======= LocalStorageStore =======
class LocalStorageStore {
    constructor() {
        this.key = 'quantaprep-data';
    }

    async load() {
        try {
            const stored = localStorage.getItem(this.key);
            if (stored) {
                return JSON.parse(stored);
            }
            return null;
        } catch (error) {
            console.error('Error cargando desde localStorage:', error);
            return null;
        }
    }

    async save(data) {
        try {
            localStorage.setItem(this.key, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Error guardando en localStorage:', error);
            return false;
        }
    }
}

// ======= HttpStore =======
class HttpStore {
    constructor() {
        this.baseUrl = '/api';
    }

    async load() {
        try {
            const response = await fetch(`${this.baseUrl}/data`);
            if (response.ok) {
                return await response.json();
            }
            return null;
        } catch (error) {
            console.error('Error cargando desde servidor:', error);
            return null;
        }
    }

    async save(data) {
        try {
            const response = await fetch(`${this.baseUrl}/data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.ok;
        } catch (error) {
            console.error('Error guardando en servidor:', error);
            return false;
        }
    }
}

// Exportar las clases para uso en selector.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LocalStorageStore, HttpStore };
}
