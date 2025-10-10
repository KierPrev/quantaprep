const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Servir archivos estáticos

// Ruta para guardar datos en el servidor
app.post('/api/save-data', (req, res) => {
    try {
        const data = req.body;

        // Validar que los datos tengan la estructura esperada
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Datos inválidos' });
        }

        // Crear el archivo JSON en el servidor
        const filePath = path.join(__dirname, 'data.json');
        const jsonData = JSON.stringify(data, null, 2);

        fs.writeFileSync(filePath, jsonData, 'utf8');

        console.log('Datos guardados en servidor:', filePath);
        res.json({ success: true, message: 'Datos guardados exitosamente' });

    } catch (error) {
        console.error('Error al guardar datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para cargar datos desde el servidor
app.get('/api/load-data', (req, res) => {
    try {
        const filePath = path.join(__dirname, 'data.json');

        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const jsonData = JSON.parse(data);
            res.json(jsonData);
        } else {
            res.status(404).json({ error: 'No se encontraron datos guardados' });
        }

    } catch (error) {
        console.error('Error al cargar datos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para obtener información del servidor
app.get('/api/info', (req, res) => {
    res.json({
        message: 'Servidor QuantaPrep funcionando',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`Servidor QuantaPrep ejecutándose en http://localhost:${PORT}`);
});
