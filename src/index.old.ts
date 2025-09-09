import { GoogleGenerativeAI } from '@google/generative-ai';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const pgClient = new Client({ connectionString: process.env.DATABASE_URL });

export async function getEmbedding(text: string) {
  const model = genAI.getGenerativeModel({ model: 'embedding-001' });
  const embedding = await model.embedContent(text);
  return embedding.embedding.values;
}

// Función para insertar documentos de prueba
async function seedDocuments() {
  // await pgClient.connect();

  const existing = await pgClient.query('SELECT COUNT(*) FROM documents');
  if (parseInt(existing.rows[0].count) > 0) {
    console.log('Ya existen documentos. Saltando seed...');
    return;
  }

  console.log('Insertando documentos de prueba...');

  const docs = [
    {
      content: 'El Dr. Pérez atiende de lunes a viernes de 9:00 a 12:00 y de 15:00 a 18:00.',
    },
    {
      content: 'El Dr. López atiende únicamente los sábados de 10:00 a 13:00.',
    },
    {
      content: 'Las citas deben reservarse con al menos 24 horas de anticipación.',
    },
  ];

  for (const doc of docs) {
    const embedding = await getEmbedding(doc.content);

    // Convertir a formato pgvector "[x,y,z]"
    const vectorParam = `[${embedding.join(',')}]`;

    await pgClient.query(
      'INSERT INTO documents (content, embedding) VALUES ($1, $2)',
      [doc.content, vectorParam]
    );
  }

  console.log('Documentos de prueba insertados ✅');
}

async function runRAG(query: string) {
  // await pgClient.connect();

  // 1. Crear embedding con Gemini
  const queryEmbedding = await getEmbedding(query);

  // 🔥 Convertir array a formato pgvector "[x,y,z]"
  const vectorParam = `[${queryEmbedding.join(',')}]`;

  // 2. Buscar documentos similares en PostgreSQL (pgvector)
  const searchQuery = `
    SELECT content
    FROM documents
    ORDER BY embedding <-> $1
    LIMIT 3;
  `;
  const result = await pgClient.query(searchQuery, [vectorParam]);
  console.log(result.rows);
  
  const context = result.rows.map((r) => r.content).join('\n');

  console.log(context);
  

  // 3. Generar respuesta con Gemini (sin role/parts)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const completion = await model.generateContent(
    `Pregunta: ${query}\n\nContexto:\n${context}`
  );

  console.log('Respuesta:', completion.response.text());

  // await pgClient.end();
}

// 🔥 Ejecutar
async function main() {
  await pgClient.connect(); // Conectar solo una vez
  // await seedDocuments();
  await runRAG('¿Cuál es el horario del Dr. Pérez?');
  await pgClient.end(); // Cerrar al final
}

main().catch(console.error);
