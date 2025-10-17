// =========================
// QuantaPrep - server.js (mismo directorio)
// =========================
const express = require('express');
const fs = require('fs');
const path = require('path');
// CORS no es necesario si frontend y API están en el mismo origen/puerto
// const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_PATH = process.env.DATA_FILE || path.join(__dirname, 'data.json');

app.use(express.json({ limit: '2mb' }));
// app.use(cors({ origin: true }));

// No-cache para rutas de datos
app.use(['/api', '/data.json'], (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// Servir estáticos desde este mismo directorio
app.use(express.static(__dirname));

// Helpers
function ensureJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(
            filePath,
            JSON.stringify({ subjects: [], typeTimes: {}, capacityDaily: 2.0 }, null, 2),
            'utf8'
        );
    }
}
function writeJsonAtomic(filePath, dataObj) {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dataObj, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

// GET directo del JSON
app.get('/data.json', (req, res) => {
    try {
        ensureJsonFile(DATA_PATH);
        res.sendFile(DATA_PATH);
    } catch (err) {
        console.error('Error sirviendo data.json:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Guardar datos
app.post('/api/save-data', (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Datos inválidos' });
        }
        ensureJsonFile(DATA_PATH);
        writeJsonAtomic(DATA_PATH, data);
        console.log('💾 Datos guardados en:', DATA_PATH);
        res.json({ success: true });
    } catch (error) {
        console.error('Error al guardar datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Cargar datos (API)
app.get('/api/load-data', (req, res) => {
    try {
        ensureJsonFile(DATA_PATH);
        const txt = fs.readFileSync(DATA_PATH, 'utf8');
        const obj = txt && txt.trim() ? JSON.parse(txt) : {};
        const safe = {
            capacityDaily: Number(obj.capacityDaily) || 2.0,
            typeTimes: {
                'TP': 1.5, 'Problemas': 1.2, 'Teoría': 1.0, 'Lectura': 0.8, 'Otro': 1.0,
                ...(obj.typeTimes || {})
            },
            subjects: Array.isArray(obj.subjects) ? obj.subjects : []
        };
        res.json(safe);
    } catch (error) {
        console.error('Error al cargar datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Info
app.get('/api/info', (_req, res) => {
    res.json({
        message: 'Servidor QuantaPrep funcionando',
        version: '1.1.0',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor QuantaPrep en http://localhost:${PORT}`);
    console.log('📁 Base dir:', __dirname);
    console.log('💾 DATA_PATH:', DATA_PATH);
});
