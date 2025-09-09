import { GoogleGenerativeAI } from '@google/generative-ai';
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const pgClient = new Client({ connectionString: process.env.DATABASE_URL });

// Crear embedding de texto
async function getEmbedding(text: string) {
  const model = genAI.getGenerativeModel({ model: 'embedding-001' });
  const embedding = await model.embedContent(text);
  return embedding.embedding.values;
}

// Insertar anuncios
async function insertProduct(title: string, description: string) {
  const embedding = await getEmbedding(`${title} ${description}`);
  await pgClient.query(
    'INSERT INTO products (title, description, embedding) VALUES ($1, $2, $3)',
    [title, description, `[${embedding.join(',')}]`]
  );
}

// Buscar anuncios similares
async function searchProducts(query: string, limit = 3) {
  const queryEmbedding = await getEmbedding(query);
  const vectorParam = `[${queryEmbedding.join(',')}]`;

  const result = await pgClient.query(
    `
    SELECT title, description
    FROM products
    ORDER BY embedding <-> $1
    LIMIT $2
    `,
    [vectorParam, limit]
  );

  return result.rows;
}

// Función RAG: responder preguntas usando anuncios como contexto
async function runRAG(query: string) {
  const contextRows = await searchProducts(query);
  const context = contextRows.map(r => `${r.title}: ${r.description}`).join('\n');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const completion = await model.generateContent(
    `Pregunta: ${query}\n\nContexto:\n${context}`
  );

  console.log('Respuesta RAG:', completion.response.text());
}

// Main
async function main() {
  await pgClient.connect();

  // Crear tabla si no existe
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      title TEXT,
      description TEXT,
      embedding vector(768)
    );
  `);

  // Insertar anuncios de ejemplo
  await insertProduct('Bicicleta de montaña', 'Bicicleta usada en buen estado, ideal para rutas difíciles');
  await insertProduct('Laptop gamer', 'Laptop potente con RTX 3060, perfecta para juegos');
  await insertProduct('Ropa deportiva', 'Conjunto de entrenamiento cómodo y ligero');

  console.log('Productos insertados ✅');

  // Ejecutar búsqueda RAG
  await runRAG('Quiero una computadora para juegos');
  await runRAG('Busco ropa para entrenar');

  await pgClient.end();
}

main().catch(console.error);
