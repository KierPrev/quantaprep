const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_PATH = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname))); // ¡clave! servir desde la carpeta del server

// Helper: writeFile atomic
function writeJsonAtomic(filePath, dataObj) {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(dataObj, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
}

// Endpoint de ping para detección automática
app.get('/api/ping', (req, res) => {
    res.json({ ok: true });
});

// GET directo del JSON (mismo archivo que guardamos)
app.get('/data.json', (req, res) => {
    try {
        if (fs.existsSync(DATA_PATH)) {
            res.sendFile(DATA_PATH);
        } else {
            res.status(404).json({ error: 'No se encontraron datos guardados' });
        }
    } catch (err) {
        console.error('Error sirviendo data.json:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Cargar datos (API)
app.get('/api/data', (req, res) => {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const txt = fs.readFileSync(DATA_PATH, 'utf8');
            res.json(JSON.parse(txt));
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Error al cargar datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Guardar datos
app.post('/api/data', (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Datos inválidos' });
        }
        writeJsonAtomic(DATA_PATH, data);
        console.log('Datos guardados en:', DATA_PATH);
        res.json({ success: true });
    } catch (error) {
        console.error('Error al guardar datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Info
app.get('/api/info', (_req, res) => {
    res.json({
        message: 'Servidor QuantaPrep funcionando',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`Servidor QuantaPrep en http://localhost:${PORT}`);
    console.log('Base dir:', __dirname);
    console.log('DATA_PATH:', DATA_PATH);
});
