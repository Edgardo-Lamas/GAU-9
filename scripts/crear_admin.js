'use strict';

// Script de setup: crea el primer usuario ADMIN en Supabase.
// Uso: node scripts/crear_admin.js

require('dotenv').config();
const readline = require('readline');
const bcrypt   = require('bcryptjs');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('user:password')) {
  console.error('\n❌  Completá DATABASE_URL en el archivo .env antes de ejecutar este script.\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function preguntar(texto) {
  return new Promise(resolve => rl.question(texto, resolve));
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  GAU-9 — Crear usuario administrador');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const nombre    = (await preguntar('Nombre completo:  ')).trim();
  const email     = (await preguntar('Email:            ')).trim().toLowerCase();
  const password  = (await preguntar('Contraseña:       ')).trim();
  const confirmar = (await preguntar('Confirmar clave:  ')).trim();
  rl.close();

  if (!nombre || !email || !password) {
    console.error('\n❌  Todos los campos son requeridos.\n');
    process.exit(1);
  }
  if (password !== confirmar) {
    console.error('\n❌  Las contraseñas no coinciden.\n');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('\n❌  La contraseña debe tener al menos 8 caracteres.\n');
    process.exit(1);
  }

  console.log('\n🔐  Generando hash de contraseña…');
  const hash = await bcrypt.hash(password, 12);

  console.log('🗄️   Conectando a Supabase…');
  const client = await pool.connect();

  try {
    // Verificar si ya existe
    const existe = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      console.error(`\n❌  Ya existe un usuario con el email ${email}.\n`);
      process.exit(1);
    }

    const result = await client.query(`
      INSERT INTO usuarios (email, password_hash, nombre, rol)
      VALUES ($1, $2, $3, 'ADMIN')
      RETURNING id, email, nombre, rol
    `, [email, hash, nombre]);

    const u = result.rows[0];
    console.log('\n✅  Usuario creado exitosamente:');
    console.log(`    Nombre: ${u.nombre}`);
    console.log(`    Email:  ${u.email}`);
    console.log(`    Rol:    ${u.rol}`);
    console.log(`    ID:     ${u.id}`);
    console.log('\nYa podés iniciar sesión en el dashboard.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('\n❌  Error:', err.message, '\n');
  process.exit(1);
});
