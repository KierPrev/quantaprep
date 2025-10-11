const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_PATH = path.join(__dirname, 'data.json');

// Detectar si estamos en un entorno estático (como GitHub Pages)
function isStaticEnvironment() {
    // Variables de entorno comunes en hosting estático
    if (process.env.GITHUB_PAGES || process.env.NETLIFY || process.env.VERCEL) {
        return true;
    }

    // Verificar si tenemos permisos de escritura en el directorio actual
    try {
        const testFile = path.join(__dirname, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return false; // Si podemos escribir, no es estático
    } catch (error) {
        return true; // Si no podemos escribir, probablemente es estático
    }
}

// Cargar datos desde data.json si existe
function loadInitialData() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const data = fs.readFileSync(DATA_PATH, 'utf8');
            const parsedData = JSON.parse(data);
            console.log('✓ data.json cargado exitosamente');
            return parsedData;
        } else {
            console.log('ℹ️  No se encontró data.json, iniciando con datos vacíos');
            return {};
        }
    } catch (error) {
        console.error('✗ Error cargando data.json:', error.message);
        return {};
    }
}

// Estado inicial del servidor
const isStatic = isStaticEnvironment();
const initialData = loadInitialData();

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

// Info del servidor
app.get('/api/info', (_req, res) => {
    res.json({
        message: 'Servidor QuantaPrep funcionando',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: isStatic ? 'static' : 'dynamic',
        dataLoaded: Object.keys(initialData).length > 0
    });
});

// Endpoint para información del entorno
app.get('/api/environment', (_req, res) => {
    res.json({
        isStatic: isStatic,
        canPersistData: !isStatic,
        dataJsonExists: fs.existsSync(DATA_PATH),
        dataJsonLoaded: Object.keys(initialData).length > 0,
        dataPath: DATA_PATH
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Servidor QuantaPrep iniciado en http://localhost:${PORT}`);
    console.log('📁 Base dir:', __dirname);
    console.log('💾 DATA_PATH:', DATA_PATH);
    console.log('🌐 Entorno:', isStatic ? 'ESTÁTICO (como GitHub Pages)' : 'DINÁMICO (puede persistir datos)');
    console.log('📊 data.json:', fs.existsSync(DATA_PATH) ? 'ENCONTRADO y cargado' : 'NO ENCONTRADO');
    console.log('💿 Datos iniciales cargados:', Object.keys(initialData).length > 0 ? 'SÍ' : 'NO');
    console.log('─────────────────────────────────────────────\n');
});
