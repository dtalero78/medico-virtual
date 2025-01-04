const { createServer } = require('http');
const next = require('next');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

console.log('🔑 OPENAI_API_KEY:', process.env.OPENAI_API_KEY);

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ Validación de claves necesarias
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY no está configurada.');
  process.exit(1);
}

// ✅ Configurar conexión PostgreSQL con SSL
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: parseInt(process.env.PG_PORT, 10),
  ssl: {
    rejectUnauthorized: false, // Permite certificados autofirmados (Render lo necesita)
  },
});

// ✅ Verificar la conexión a la base de datos
(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Conexión exitosa a PostgreSQL');
    client.release();
  } catch (err) {
    console.error('❌ Error al conectar con PostgreSQL:', err.message);
    process.exit(1);
  }
})();

// ✅ Función para obtener parámetros de la URL
/**
 * Extrae el valor de un parámetro específico de una URL.
 * @param {string} url - La URL de la cual extraer el parámetro.
 * @param {string} param - El nombre del parámetro que queremos obtener.
 * @returns {string|null} - El valor del parámetro o null si no existe.
 */
function getParamFromUrl(url, param) {
  try {
    const parsedUrl = new URL(url, 'http://localhost');
    const value = parsedUrl.searchParams.get(param);
    console.log(`🔑 Parámetro '${param}' obtenido: ${value}`);
    return value;
  } catch (error) {
    console.warn('⚠️ Error al analizar la URL:', error.message);
    return null;
  }
}

// 🛠️ Inicializar el servidor
app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // ✅ Inicializar WebSocket Server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    console.log('🔄 Conexión WebSocket establecida con el cliente.');

    let openAIConnection = null;

    // ✅ Capturar el parámetro `ref` usando la función
    const userId = getParamFromUrl(req.url, 'ref') || 'd4ecfa34-dd35-47a0-9e33-525443218d6f';
    console.log(`🔑 userId final: ${userId}`);

    // ✅ Buscar datos en la base de datos
    const fetchUserData = async (id) => {
      try {
        console.log(`🔍 Buscando datos del usuario con ID: ${id}`);
        const result = await pool.query('SELECT * FROM usuarios WHERE idgeneral = $1', [id]);

        if (result.rows.length === 0) {
          console.warn(`⚠️ Usuario con ID ${id} no encontrado.`);
          ws.send(JSON.stringify({ error: 'Usuario no encontrado' }));
          return null;
        }

        const userData = result.rows[0];
        console.log('✅ Datos crudos de la base de datos:', userData);

        let encuestaSalud = 'Desconocido';
        let antecedentesFamiliares = 'Sin información';

        try {
          encuestaSalud = JSON.parse(userData.encuestasalud.replace(/{/g, '[').replace(/}/g, ']')) || [];
          antecedentesFamiliares = JSON.parse(userData.antecedentesfamiliares.replace(/{/g, '[').replace(/}/g, ']')) || [];
        } catch (parseError) {
          console.warn('⚠️ Error al parsear campos JSON:', parseError.message);
        }

        return {
          primerNombre: userData.primernombre || 'Desconocido',
          profesionUOficio: userData.profesionuoficio || 'Desconocido',
          encuestaSalud: Array.isArray(encuestaSalud) ? encuestaSalud.join(', ') : encuestaSalud,
          antecedentesFamiliares: Array.isArray(antecedentesFamiliares) ? antecedentesFamiliares.join(', ') : antecedentesFamiliares,
        };
      } catch (error) {
        console.error('❌ Error al obtener datos de la base de datos:', error.message);
        ws.send(JSON.stringify({ error: 'Error en la base de datos' }));
        return null;
      }
    };

    // ✅ Establecer conexión con OpenAI
    const connectToOpenAI = (userData) => {
      openAIConnection = new WebSocket('wss://api.openai.com/v1/realtime/sessions', {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      });

      openAIConnection.on('open', () => {
        console.log('✅ Conexión WebSocket establecida con OpenAI.');

        const sessionUpdate = {
          input_audio_format: 'ulaw',
          output_audio_format: 'ulaw',
          voice: 'coral',
          instructions: `
            Eres el Dr. Juan Reátiga, médico ocupacional de BSL. Sé concreto. No hables tanto.
            El paciente se llama ${userData.primerNombre || 'Desconocido'}.
            Profesión u oficio: ${userData.profesionUOficio || 'Desconocido'}.
            Encuesta de salud: ${userData.encuestaSalud || 'Desconocido'}.
            Antecedentes familiares: ${userData.antecedentesFamiliares || 'Sin información'}.
          `,
        };

        openAIConnection.send(JSON.stringify(sessionUpdate));
      });
    };

    // ✅ Iniciar conexión con datos del usuario
    (async () => {
      const userData = await fetchUserData(userId);
      if (userData) {
        ws.send(JSON.stringify({
          event: 'userData',
          data: userData,
        }));
        connectToOpenAI(userData);
      }
    })();

    ws.on('close', (code, reason) => {
      console.warn(`❌ Conexión WebSocket con el cliente cerrada. Código: ${code}, Razón: ${reason}`);
      if (openAIConnection && openAIConnection.readyState === WebSocket.OPEN) {
        openAIConnection.close();
      }
    });
  });

  // ✅ Iniciar el servidor
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, (err) => {
    if (err) {
      console.error('❌ Error al iniciar el servidor:', err.message);
      process.exit(1);
    }
    console.log(`✅ Servidor escuchando en http://localhost:${PORT}`);
  });
});
