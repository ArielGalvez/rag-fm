// src/index.ts
import { Pool } from 'pg';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// 1️⃣ Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 2️⃣ Inicializar cliente de Gemini
const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// 3️⃣ Función para generar embeddings usando Gemini
async function getEmbedding(text: string) {
  const resp = await gemini.embeddings.create({
    model: 'embed-gecko-001',
    input: text,
  });
  return resp.data[0].embedding;
}

// 4️⃣ Indexar documentos en PostgreSQL
async function addDocuments(docs: string[]) {
  for (const text of docs) {
    try {
      const embedding = await getEmbedding(text);
      await pool.query(
        `INSERT INTO documents (content, embedding) VALUES ($1, $2)`,
        [text, embedding]
      );
    } catch (err: any) {
      console.error('Error al generar embedding:', err);
    }
  }
}

// 5️⃣ Buscar documentos similares
async function searchSimilar(query: string, k = 3) {
  try {
    const embedding = await getEmbedding(query);
    const { rows } = await pool.query(
      `SELECT content, embedding <#> $1::vector AS distance
       FROM documents
       ORDER BY distance ASC
       LIMIT $2`,
      [embedding, k]
    );
    return rows.map((r) => r.content);
  } catch (err: any) {
    console.error('Error al buscar embeddings:', err);
    return [];
  }
}

// 6️⃣ Responder preguntas con contexto (RAG)
async function askQuestion(question: string) {
  const contextDocs = await searchSimilar(question, 3);
  if (contextDocs.length === 0) {
    console.log('⚠️ No hay contexto disponible.');
    return;
  }

  const context = contextDocs.join('\n');
  const prompt = `
Usa la siguiente información para responder la pregunta:

${context}

Pregunta: ${question}
Respuesta:
`;

  try {
    const response = await gemini.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    console.log('✅ Respuesta:', response.text);
  } catch (err: any) {
    console.error('Error al generar la respuesta:', err);
  }
}

// 7️⃣ Ejemplo de uso
(async () => {
  await addDocuments([
    'La capital de Bolivia es Sucre, pero la sede de gobierno está en La Paz.',
    'El lago Titicaca es el lago navegable más alto del mundo.',
    'El salar de Uyuni es el desierto de sal más grande del planeta.',
  ]);

  await askQuestion('¿Dónde está el salar más grande del mundo?');
})();
