'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { auth } = require('../middleware/auth');
const { log }  = require('../logger');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  try {
    const result = await db.query(
      'SELECT id, email, password_hash, nombre, rol FROM usuarios WHERE email = $1 AND activo = TRUE',
      [String(email).toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const usuario = result.rows[0];
    const ok = await bcrypt.compare(password, usuario.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // Adjuntar usuario al req para el logger
    req.usuario = { id: usuario.id, email: usuario.email };
    await log(req, 'LOGIN', `Ingresó al sistema`);

    res.json({ token, nombre: usuario.nombre, rol: usuario.rol });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/cambiar-password
router.post('/cambiar-password', auth, async (req, res) => {
  const { password_actual, password_nuevo } = req.body || {};

  if (!password_actual || !password_nuevo) {
    return res.status(400).json({ error: 'Se requieren contraseña actual y nueva' });
  }
  if (password_nuevo.length < 8) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  }

  try {
    const result = await db.query(
      'SELECT id, password_hash FROM usuarios WHERE id = $1 AND activo = TRUE',
      [req.usuario.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const ok = await bcrypt.compare(password_actual, result.rows[0].password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    const nuevo_hash = await bcrypt.hash(password_nuevo, 12);
    await db.query(
      'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
      [nuevo_hash, req.usuario.id]
    );

    await log(req, 'CAMBIO_PASSWORD', 'Contraseña actualizada');
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] cambiar-password:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
