import { Pool } from 'pg';
import { OpenAIEmbeddings, OpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import dotenv from 'dotenv';

dotenv.config();

// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Inicializar modelo y embeddings
const model = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
});

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  // modelName: 'text-embedding-3-small',
});

// Función para indexar documentos
async function addDocuments(docs: string[]) {
  for (const text of docs) {
    try {
      const embedding = await embeddings.embedQuery(text);
      await pool.query(
        `INSERT INTO documents (content, embedding) VALUES ($1, $2)`,
        [text, embedding]
      );
    } catch (err: any) {
      if (
        err.name === 'InsufficientQuotaError' ||
        err.message.includes('429')
      ) {
        console.error(
          '❌ No se pudo generar el embedding: cuota de OpenAI agotada.'
        );
        return;
      }
      throw err;
    }
  }
}

// Función para buscar documentos relevantes
async function searchSimilar(query: string, k = 3) {
  try {
    const embedding = await embeddings.embedQuery(query);
    const { rows } = await pool.query(
      `SELECT content, embedding <#> $1::vector AS distance
       FROM documents
       ORDER BY distance ASC
       LIMIT $2`,
      [embedding, k]
    );
    return rows.map((r) => r.content);
  } catch (err: any) {
    if (err.name === 'InsufficientQuotaError' || err.message.includes('429')) {
      console.error(
        '❌ No se pudo buscar embeddings: cuota de OpenAI agotada.'
      );
      return [];
    }
    throw err;
  }
}

// Función para responder preguntas con RAG
async function askQuestion(question: string) {
  try {
    const contextDocs = await searchSimilar(question, 3);
    if (contextDocs.length === 0) {
      console.log('⚠️ No hay contexto disponible debido a la cuota de OpenAI.');
      return;
    }

    const context = contextDocs.join('\n');
    const prompt = ChatPromptTemplate.fromTemplate(`
    Usa la siguiente información para responder la pregunta:

    {context}

    Pregunta: {question}
    `);

    const input = await prompt.format({ context, question });

    const response = await model.invoke(input);
    console.log('✅ Respuesta:', response);
  } catch (err: any) {
    if (err.name === 'InsufficientQuotaError' || err.message.includes('429')) {
      console.error(
        '❌ No se pudo generar la respuesta: cuota de OpenAI agotada.'
      );
      return;
    }
    throw err;
  }
}

// Ejemplo de uso
(async () => {
  await addDocuments([
    'La capital de Bolivia es Sucre, pero la sede de gobierno está en La Paz.',
    'El lago Titicaca es el lago navegable más alto del mundo.',
    'El salar de Uyuni es el desierto de sal más grande del planeta.',
  ]);

  await askQuestion('¿Dónde está el salar más grande del mundo?');
})();
