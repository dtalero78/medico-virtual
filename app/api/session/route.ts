import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    console.log("✅ Iniciando sesión API OpenAI...");

    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY no está configurada");
      throw new Error("OPENAI_API_KEY is not set");
    }

    // ✅ Obtener datos desde el cliente si están disponibles
    const body = await request.json();
    let { primerNombre, profesionUOficio, encuestaSalud, antecedentesFamiliares } = body;

    if (!primerNombre || !profesionUOficio || !encuestaSalud || !antecedentesFamiliares) {
      console.warn('⚠️ Datos no proporcionados desde el cliente. Consultando la base de datos...');
      const dbResponse = await fetch('https://base-datos-render.onrender.com/usuarios', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!dbResponse.ok) {
        const errorText = await dbResponse.text();
        console.error('❌ Error al obtener datos de la base de datos:', errorText);
        throw new Error(`Error al obtener datos de la base de datos: ${errorText}`);
      }

      const patientData = await dbResponse.json();

      primerNombre = patientData.primerNombre || "Desconocido";
      profesionUOficio = patientData.profesionUOficio || "Desconocido";
      encuestaSalud = patientData.encuestaSalud || "Desconocido";
      antecedentesFamiliares = patientData.antecedentesFamiliares || "Sin información";
    }

    console.log("✅ Datos finales enviados a OpenAI:", { primerNombre, profesionUOficio, encuestaSalud, antecedentesFamiliares });

    // ✅ Llamar a OpenAI con datos de la base de datos o cliente
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "coral",
        instructions: `
          Habla con acento colombiano. Eres el sistema de asesoría médica de BSL. Saluda por el nombre. Sé concreto. No hables tanto. No respondas preguntas que no sean relacionadas con la consulta médica de este paciente
          El paciente se llama ${primerNombre}.
          Profesión u oficio: ${profesionUOficio}.
          Encuesta de salud: ${encuestaSalud}.
          Antecedentes familiares: ${antecedentesFamiliares}.
          Las preguntas deben ser:
          1. ¿Cual fue tu último trabajo y por cuánto tiempo lo has tenido?
          2. ¿Cómo está conformado tu núcleo familiar?
          3. Pregúntale por lo que escribió en la encuesta de salud y los antecedentes familiares
          Entre cada pregunta espera a que la persona responda
          Al final da dos consejos médicos ocupacionales muy cortos teniendo en cuenta la profesión u oficio (mencióna cual es la profesión)
          Despídete diciendo que ya vamos a emitir el certicicado y que a su whatsapp le llega el mensaje de aprobación
    
        `,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error de la API OpenAI:', errorText);
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (!data.client_secret?.value) {
      console.error("❌ No se recibió un token válido desde OpenAI.");
      throw new Error("No se recibió un token válido desde OpenAI.");
    }

    console.log("✅ Token obtenido correctamente:", data.client_secret.value);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error) {
      console.error("❌ Error en el endpoint /api/session:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      console.error("❌ Error desconocido en el endpoint /api/session:", error);
      return NextResponse.json({ error: "Error desconocido" }, { status: 500 });
    }
  }
}
