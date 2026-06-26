'use strict';

const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = header.slice(7);
  try {
    req.user    = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = req.user;   // alias para el logger y rutas que usan req.usuario
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.rol !== 'ADMIN') {
    return res.status(403).json({ error: 'Requiere rol ADMIN' });
  }
  next();
}

module.exports = { auth, requireAdmin };
