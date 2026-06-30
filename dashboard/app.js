'use strict';

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : '';  // misma origen en producción

function gau9App() {
  return {
    // ── Auth
    autenticado: false,
    token: null,
    usuario: null,
    loginForm: { email: '', password: '' },
    loginError: '',

    // ── UI
    vistaActual: 'inicio',
    cargando: false,
    errorGlobal: '',
    modal: null,
    formError: '',

    // ── Datos
    resumen: null,
    actividadReciente: [],
    actividad: [],
    presentismo: [],
    civiles: [],
    traslados: [],
    resultadosBusqueda: [],
    busquedaQ: '',
    filtroNivel: '',
    filtroBusqueda: '',
    cursos: [],
    alumnos: [],
    cursoExpandido: null,
    cargandoAlumnos: false,
    generandoCertificados: false,

    // ── Forms modales
    formTraslado: {},
    formRegreso: {},
    formCivil: {},
    formPassword: { actual: '', nueva: '', confirmar: '' },
    passwordOk: false,
    trasladoSeleccionado: null,
    civilSeleccionado: null,
    detallePersona: null,

    // ── Asistente IA
    asistenteAbierto: false,
    chatMensajes: [],
    chatHistorial: [],
    chatInput: '',
    chatCargando: false,

    // ────────────────────────────────────────────────────────────
    // Init
    // ────────────────────────────────────────────────────────────
    init() {
      const saved = localStorage.getItem('gau9_token');
      const savedUser = localStorage.getItem('gau9_user');
      if (saved && savedUser) {
        try {
          // Verificar expiración del token (JWT payload)
          const payload = JSON.parse(atob(saved.split('.')[1]));
          if (payload.exp * 1000 > Date.now()) {
            this.token = saved;
            this.usuario = JSON.parse(savedUser);
            this.autenticado = true;
            this.cargarVista();
          } else {
            this.cerrarSesionLocal();
          }
        } catch {
          this.cerrarSesionLocal();
        }
      }

      // Escuchar mensajes del Service Worker (sync background)
      navigator.serviceWorker?.addEventListener('message', (e) => {
        if (e.data?.tipo === 'sync-completado') {
          this.cargarVista();
        }
      });
    },

    // ────────────────────────────────────────────────────────────
    // Auth
    // ────────────────────────────────────────────────────────────
    async login() {
      this.loginError = '';
      this.cargando = true;
      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.loginForm),
        });
        const data = await res.json();
        if (!res.ok) {
          this.loginError = data.error || 'Error al ingresar';
          return;
        }
        this.token = data.token;
        this.usuario = { nombre: data.nombre, rol: data.rol };
        this.autenticado = true;
        localStorage.setItem('gau9_token', data.token);
        localStorage.setItem('gau9_user', JSON.stringify(this.usuario));
        this.cargarVista();
      } catch {
        this.loginError = 'No se pudo conectar con el servidor';
      } finally {
        this.cargando = false;
      }
    },

    logout() {
      // Limpiar cache del SW para que el próximo usuario no vea datos anteriores
      if ('caches' in window) {
        caches.delete('gau9-v1-api').catch(() => {});
      }
      this.cerrarSesionLocal();
      this.autenticado = false;
      this.resumen = null;
      this.actividadReciente = [];
      this.presentismo = [];
      this.civiles = [];
      this.traslados = [];
      this.loginForm = { email: '', password: '' };
      this.chatMensajes = [];
      this.chatHistorial = [];
      this.asistenteAbierto = false;
    },

    cerrarSesionLocal() {
      localStorage.removeItem('gau9_token');
      localStorage.removeItem('gau9_user');
      this.token = null;
      this.usuario = null;
    },

    // ────────────────────────────────────────────────────────────
    // API helpers
    // ────────────────────────────────────────────────────────────
    async apiGet(path) {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.status === 401) { this.logout(); throw new Error('Sesión expirada'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de servidor');
      return data;
    },

    async apiPost(path, body) {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.status === 401) { this.logout(); throw new Error('Sesión expirada'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de servidor');
      return data;
    },

    async apiPatch(path, body) {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.status === 401) { this.logout(); throw new Error('Sesión expirada'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de servidor');
      return data;
    },

    // ────────────────────────────────────────────────────────────
    // Navegación
    // ────────────────────────────────────────────────────────────
    cambiarVista(vista) {
      this.vistaActual = vista;
      this.errorGlobal = '';
      this.cargarVista();
    },

    cargarVista() {
      if (this.vistaActual === 'inicio')      this.cargarResumen();
      if (this.vistaActual === 'presentismo') this.cargarPresentismo();
      if (this.vistaActual === 'civiles')     this.cargarCiviles();
      if (this.vistaActual === 'traslados')   this.cargarTraslados();
      if (this.vistaActual === 'cursos')      this.cargarCursos();
    },

    // ────────────────────────────────────────────────────────────
    // Resumen / Inicio
    // ────────────────────────────────────────────────────────────
    async cargarResumen() {
      this.cargando = true;
      try {
        const [resumen, actividad, civilesHoy] = await Promise.all([
          this.apiGet('/api/dashboard/resumen'),
          this.apiGet('/api/actividad?limit=3'),
          this.apiGet('/api/civiles/hoy'),
        ]);
        this.resumen = resumen;
        this.actividadReciente = actividad;
        this.civiles = civilesHoy;
      } catch (err) {
        this.errorGlobal = err.message;
      } finally {
        this.cargando = false;
      }
    },

    horaActualizacion() {
      if (!this.resumen?.generado_en) return '';
      return new Date(this.resumen.generado_en).toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit',
      });
    },

    // ────────────────────────────────────────────────────────────
    // Presentismo
    // ────────────────────────────────────────────────────────────
    async cargarPresentismo() {
      this.cargando = true;
      try {
        this.presentismo = await this.apiGet('/api/presentismo/hoy');
      } catch (err) {
        this.errorGlobal = err.message;
      } finally {
        this.cargando = false;
      }
    },

    presentismoFiltrado() {
      let lista = this.presentismo;
      if (this.filtroNivel) lista = lista.filter(r => r.nivel === this.filtroNivel);
      if (this.filtroBusqueda.trim().length >= 2) {
        const q = this.filtroBusqueda.trim().toLowerCase();
        lista = lista.filter(r =>
          `${r.apellido_1} ${r.nombre}`.toLowerCase().includes(q) ||
          (r.ficha_conducta || '').includes(q)
        );
      }
      return lista;
    },

    // ────────────────────────────────────────────────────────────
    // Civiles
    // ────────────────────────────────────────────────────────────
    async cargarCiviles() {
      this.cargando = true;
      try {
        this.civiles = await this.apiGet('/api/civiles/hoy');
      } catch (err) {
        this.errorGlobal = err.message;
      } finally {
        this.cargando = false;
      }
    },

    abrirCancelarCivil(civil) {
      this.civilSeleccionado = civil;
      this.formCivil = { estado: '', observaciones: '' };
      this.formError = '';
      this.modal = 'cancelarCivil';
    },

    async guardarCancelacion() {
      this.formError = '';
      if (!this.formCivil.estado) {
        this.formError = 'Seleccionar estado';
        return;
      }
      this.cargando = true;
      try {
        await this.apiPatch(`/api/civiles/${this.civilSeleccionado.id}/estado`, this.formCivil);
        this.modal = null;
        await this.cargarCiviles();
      } catch (err) {
        this.formError = err.message;
      } finally {
        this.cargando = false;
      }
    },

    // ────────────────────────────────────────────────────────────
    // Traslados
    // ────────────────────────────────────────────────────────────
    async cargarTraslados() {
      this.cargando = true;
      try {
        this.traslados = await this.apiGet('/api/traslados/hoy');
      } catch (err) {
        this.errorGlobal = err.message;
      } finally {
        this.cargando = false;
      }
    },

    abrirNuevoTraslado() {
      this.formTraslado = {
        dni_interno: '', facultad: '', materia: '',
        modalidad: '', dni_oficial: '', hora_salida: '',
        horario_pautado: '', gdeba_nro: '', observaciones: '',
      };
      this.formError = '';
      this.modal = 'nuevoTraslado';
    },

    async guardarTraslado() {
      this.formError = '';
      if (!this.formTraslado.dni_interno) { this.formError = 'DNI requerido'; return; }
      if (!this.formTraslado.modalidad)   { this.formError = 'Modalidad requerida'; return; }
      if (!this.formTraslado.facultad)    { this.formError = 'Facultad/destino requerido'; return; }
      if (this.formTraslado.modalidad === 'SIN_GPS' && !this.formTraslado.dni_oficial) {
        this.formError = 'DNI del oficial requerido para traslado SIN GPS';
        return;
      }

      this.cargando = true;
      try {
        await this.apiPost('/api/traslados', this.formTraslado);
        this.modal = null;
        await this.cargarTraslados();
      } catch (err) {
        this.formError = err.message;

        // Guardar en cola offline si no hay conexión
        if (err.message.includes('Sin conexión') || err.message.includes('fetch')) {
          await this.encolarTrasladoOffline(this.formTraslado);
          this.modal = null;
          this.errorGlobal = 'Sin conexión — traslado guardado localmente y se sincronizará al reconectar';
        }
      } finally {
        this.cargando = false;
      }
    },

    abrirRegistrarRegreso(traslado) {
      this.trasladoSeleccionado = traslado;
      this.formRegreso = {
        hora_regreso: new Date().toTimeString().slice(0, 5),
        resultado: '',
        observaciones: '',
      };
      this.formError = '';
      this.modal = 'regreso';
    },

    async guardarRegreso() {
      this.formError = '';
      if (!this.formRegreso.resultado) { this.formError = 'Seleccionar resultado'; return; }
      if (this.formRegreso.resultado === 'NOVEDAD' && !this.formRegreso.observaciones) {
        this.formError = 'Las novedades requieren observaciones';
        return;
      }
      this.cargando = true;
      try {
        await this.apiPatch(`/api/traslados/${this.trasladoSeleccionado.id}/regreso`, this.formRegreso);
        this.modal = null;
        await this.cargarTraslados();
      } catch (err) {
        this.formError = err.message;
      } finally {
        this.cargando = false;
      }
    },

    // ────────────────────────────────────────────────────────────
    // Cursos
    // ────────────────────────────────────────────────────────────
    async cargarCursos() {
      this.cargando = true;
      this.cursoExpandido = null;
      this.alumnos = [];
      try {
        this.cursos = await this.apiGet('/api/cursos');
      } catch (err) {
        this.errorGlobal = err.message;
      } finally {
        this.cargando = false;
      }
    },

    async toggleAlumnos(cursoId) {
      if (this.cursoExpandido === cursoId) {
        this.cursoExpandido = null;
        this.alumnos = [];
        return;
      }
      this.cursoExpandido = cursoId;
      this.alumnos = [];
      this.cargandoAlumnos = true;
      try {
        this.alumnos = await this.apiGet(`/api/cursos/${cursoId}/alumnos`);
      } catch (err) {
        this.errorGlobal = err.message;
      } finally {
        this.cargandoAlumnos = false;
      }
    },

    async cambiarEstadoAlumno(alumno) {
      try {
        await this.apiPatch(`/api/cursos/inscripciones/${alumno.id}/estado`, {
          estado: alumno.estado,
        });
      } catch (err) {
        this.errorGlobal = `Error al actualizar estado: ${err.message}`;
      }
    },

    // ────────────────────────────────────────────────────────────
    // Certificados
    // ────────────────────────────────────────────────────────────
    async generarCertificados(curso) {
      this.generandoCertificados = true;
      try {
        await this.apiPost(`/api/cursos/${curso.id}/certificados`, {});
        const todos = await this.apiGet(`/api/cursos/${curso.id}/certificados`);
        for (const cert of todos) {
          await this.generarPDFCertificado(cert);
        }
        await this.cargarCursos();
      } catch (err) {
        this.errorGlobal = `Error al generar certificados: ${err.message}`;
      } finally {
        this.generandoCertificados = false;
      }
    },

    generarQRDataUrl(texto) {
      return new Promise((resolve, reject) => {
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
        document.body.appendChild(div);
        try {
          new QRCode(div, { text: texto, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
        } catch (err) {
          document.body.removeChild(div);
          reject(err);
          return;
        }
        setTimeout(() => {
          const canvas = div.querySelector('canvas');
          const dataUrl = canvas ? canvas.toDataURL('image/png') : null;
          document.body.removeChild(div);
          dataUrl ? resolve(dataUrl) : reject(new Error('No se pudo generar el QR'));
        }, 50);
      });
    },

    async generarPDFCertificado(cert) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const w = doc.internal.pageSize.getWidth();
      const h = doc.internal.pageSize.getHeight();

      // Borde institucional
      doc.setDrawColor(15, 31, 74);
      doc.setLineWidth(1.2);
      doc.rect(8, 8, w - 16, h - 16);
      doc.setLineWidth(0.3);
      doc.rect(11, 11, w - 22, h - 22);

      // Encabezado
      doc.setTextColor(15, 31, 74);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('COORDINACIÓN ACADÉMICA — UNIDAD 9', w / 2, 26, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('Servicio Penitenciario Bonaerense', w / 2, 32, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(201, 162, 39);
      doc.text('CERTIFICADO DE FINALIZACIÓN', w / 2, 52, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 60);
      doc.text('Se certifica que', w / 2, 67, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(15, 31, 74);
      doc.text(cert.nombre_completo, w / 2, 78, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 60);
      doc.text('ha completado satisfactoriamente el curso', w / 2, 89, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(15, 31, 74);
      doc.text(`"${cert.curso_nombre}"`, w / 2, 98, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      doc.text(
        `Período: ${this.fmtFechaSolo(cert.fecha_inicio)} al ${this.fmtFechaSolo(cert.fecha_fin)}`,
        w / 2, 107, { align: 'center' }
      );
      if (cert.docente_nombre) {
        doc.text(`Docente a cargo: ${cert.docente_nombre}`, w / 2, 114, { align: 'center' });
      }

      // Firmas
      const firmaY = h - 35;
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.2);
      doc.line(40, firmaY, 100, firmaY);
      doc.line(w - 100, firmaY, w - 40, firmaY);
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text('Coordinación Académica', 70, firmaY + 5, { align: 'center' });
      doc.text('Unidad 9 — SPB', w - 70, firmaY + 5, { align: 'center' });

      // QR + código de validación
      const urlVerificacion = `${window.location.origin}/verificar/${cert.codigo}`;
      const qrDataUrl = await this.generarQRDataUrl(urlVerificacion);
      doc.addImage(qrDataUrl, 'PNG', w - 38, h - 38, 24, 24);
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(cert.codigo, w - 26, h - 11, { align: 'center' });
      doc.text('Validar en gau-9.vercel.app/verificar', w - 26, h - 8, { align: 'center' });

      const nombreArchivo = `Certificado_${cert.nombre_completo.replace(/[,\s]+/g, '_')}_${cert.codigo}.pdf`;
      doc.save(nombreArchivo);
    },

    // ────────────────────────────────────────────────────────────
    // Búsqueda
    // ────────────────────────────────────────────────────────────
    async buscar() {
      if (this.busquedaQ.length < 2) {
        this.resultadosBusqueda = [];
        return;
      }
      this.cargando = true;
      try {
        this.resultadosBusqueda = await this.apiGet(
          `/api/buscar?q=${encodeURIComponent(this.busquedaQ)}`
        );
      } catch (err) {
        this.errorGlobal = err.message;
      } finally {
        this.cargando = false;
      }
    },

    async verDetalle(persona) {
      this.detallePersona = null;
      this.modal = 'detallePersona';
      try {
        this.detallePersona = await this.apiGet(`/api/personas/${persona.dni}`);
      } catch (err) {
        this.detallePersona = { ...persona, detalle: null };
      }
    },

    // ────────────────────────────────────────────────────────────
    // Actividad
    // ────────────────────────────────────────────────────────────
    async abrirActividad() {
      this.modal = 'actividad';
      try {
        this.actividad = await this.apiGet('/api/actividad?limit=100');
      } catch (err) {
        this.errorGlobal = err.message;
      }
    },

    iconoAccion(accion) {
      const map = {
        LOGIN:            '🔐',
        TRASLADO_NUEVO:   '🚗',
        TRASLADO_REGRESO: '✅',
        CIVIL_CANCELADO:  '🚫',
        CAMBIO_PASSWORD:  '🔑',
      };
      return map[accion] || '📝';
    },

    textoAccion(a) {
      const map = {
        LOGIN:            'Ingresó al sistema',
        TRASLADO_NUEVO:   `Nuevo traslado: ${a.detalle || ''}`,
        TRASLADO_REGRESO: `Regreso registrado: ${a.detalle || ''}`,
        CIVIL_CANCELADO:  `Civil cancelado: ${a.detalle || ''}`,
        CAMBIO_PASSWORD:  'Cambió su contraseña',
      };
      return map[a.accion] || a.accion;
    },

    formatearFecha(iso) {
      const d = new Date(iso);
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
        + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    },

    civilesPorRol() {
      const orden = ['DOCENTE', 'JUEZ', 'ABOGADO', 'ESTUDIANTE', 'CIVIL', 'OTRO'];
      const grupos = {};
      for (const c of this.civiles) {
        const rol = c.rol || 'OTRO';
        if (!grupos[rol]) grupos[rol] = [];
        grupos[rol].push(c);
      }
      return orden
        .filter(r => grupos[r]?.length)
        .map(r => ({ rol: r, items: grupos[r] }))
        .concat(
          Object.keys(grupos)
            .filter(r => !orden.includes(r) && grupos[r].length)
            .map(r => ({ rol: r, items: grupos[r] }))
        );
    },

    fmtFechaSolo(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },

    // ────────────────────────────────────────────────────────────
    // Cambiar contraseña
    // ────────────────────────────────────────────────────────────
    abrirCambioPassword() {
      this.formPassword = { actual: '', nueva: '', confirmar: '' };
      this.formError = '';
      this.passwordOk = false;
      this.modal = 'cambiarPassword';
    },

    async guardarPassword() {
      this.formError = '';
      this.passwordOk = false;
      if (this.formPassword.nueva !== this.formPassword.confirmar) {
        this.formError = 'Las contraseñas nuevas no coinciden';
        return;
      }
      if (this.formPassword.nueva.length < 8) {
        this.formError = 'La nueva contraseña debe tener al menos 8 caracteres';
        return;
      }
      this.cargando = true;
      try {
        await this.apiPost('/api/auth/cambiar-password', {
          password_actual: this.formPassword.actual,
          password_nuevo:  this.formPassword.nueva,
        });
        this.passwordOk = true;
        this.formPassword = { actual: '', nueva: '', confirmar: '' };
        setTimeout(() => { this.modal = null; this.passwordOk = false; }, 2000);
      } catch (err) {
        this.formError = err.message;
      } finally {
        this.cargando = false;
      }
    },

    // ────────────────────────────────────────────────────────────
    // Offline queue (IndexedDB)
    // ────────────────────────────────────────────────────────────
    async encolarTrasladoOffline(datos) {
      const db = await abrirDB();
      const tx = db.transaction('cola_traslados', 'readwrite');
      tx.objectStore('cola_traslados').add({ datos, ts: Date.now() });
    },

    // ────────────────────────────────────────────────────────────
    // Utils
    // ────────────────────────────────────────────────────────────
    hoyTexto() {
      return new Date().toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long',
      });
    },

    tipoBadge(tipo) {
      const map = {
        INTERNO: 'badge-pendiente',
        CIVIL: 'badge-activo',
        SPB: 'text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium',
      };
      return map[tipo] || 'badge-activo';
    },

    // ────────────────────────────────────────────────────────────
    // Dashboard visual helpers
    // ────────────────────────────────────────────────────────────
    totalPresentes() {
      if (!this.resumen) return 0;
      return (this.resumen.presentismo.primario.presentes || 0)
           + (this.resumen.presentismo.secundario.presentes || 0);
    },

    totalAlumnos() {
      if (!this.resumen) return 0;
      return (this.resumen.presentismo.primario.total || 0)
           + (this.resumen.presentismo.secundario.total || 0);
    },

    tasaAsistencia() {
      const total = this.totalAlumnos();
      if (total === 0) return 0;
      return Math.round((this.totalPresentes() / total) * 100);
    },

    // r=40 → circumference = 2 * π * 40 ≈ 251.33
    donutDash(presentes, total) {
      const circ = 251.33;
      if (!total || total === 0) return `0 ${circ}`;
      const filled = Math.min((presentes / total) * circ, circ);
      return `${filled.toFixed(2)} ${circ}`;
    },

    donutPct(presentes, total) {
      if (!total || total === 0) return 0;
      return Math.round((presentes / total) * 100);
    },

    donutColor(presentes, total) {
      const pct = (!total || total === 0) ? 0 : (presentes / total) * 100;
      if (pct >= 80) return 'var(--green-600)';
      if (pct >= 60) return 'var(--amber-600)';
      if (pct === 0)  return 'var(--slate-200)';
      return 'var(--red-600)';
    },

    trasladosCompletos() {
      if (!this.resumen) return 0;
      return (this.resumen.traslados.total || 0) - (this.resumen.traslados.pendientes || 0);
    },

    trasladosPct() {
      const total = this.resumen?.traslados?.total || 0;
      if (total === 0) return 0;
      return Math.round((this.trasladosCompletos() / total) * 100);
    },

    // ────────────────────────────────────────────────────────────
    // Asistente IA
    // ────────────────────────────────────────────────────────────
    abrirAsistente() {
      this.asistenteAbierto = true;
      this.$nextTick(() => this.scrollChatAbajo());
    },

    cerrarAsistente() {
      this.asistenteAbierto = false;
    },

    scrollChatAbajo() {
      const body = document.getElementById('chat-body');
      if (body) body.scrollTop = body.scrollHeight;
    },

    async enviarMensaje() {
      const texto = this.chatInput.trim();
      if (!texto || this.chatCargando) return;
      this.chatInput = '';

      this.chatMensajes.push({ rol: 'user', texto });
      this.chatMensajes.push({ rol: 'asst', texto: '', cargando: true });
      this.chatCargando = true;
      this.$nextTick(() => this.scrollChatAbajo());

      const historialParaApi = this.chatHistorial.slice();

      try {
        const response = await fetch(`${API_BASE}/api/asistente`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`,
          },
          body: JSON.stringify({ mensaje: texto, historial: historialParaApi }),
        });

        if (!response.ok) {
          let errMsg = 'Error del servidor';
          try { const e = await response.json(); errMsg = e.error || errMsg; } catch {}
          this.chatMensajes[this.chatMensajes.length - 1].texto = errMsg;
          this.chatMensajes[this.chatMensajes.length - 1].cargando = false;
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let textoCompleto = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') break;
            try {
              const parsed = JSON.parse(raw);
              if (parsed.text) {
                textoCompleto += parsed.text;
                this.chatMensajes[this.chatMensajes.length - 1].texto = textoCompleto;
                this.$nextTick(() => this.scrollChatAbajo());
              }
              if (parsed.error) {
                this.chatMensajes[this.chatMensajes.length - 1].texto = parsed.error;
              }
            } catch {}
          }
        }

        this.chatMensajes[this.chatMensajes.length - 1].cargando = false;

        // Actualizar historial para próximos turnos
        this.chatHistorial.push({ role: 'user', content: texto });
        this.chatHistorial.push({ role: 'assistant', content: textoCompleto });

        // Limitar historial a 20 turnos para no saturar tokens
        if (this.chatHistorial.length > 20) {
          this.chatHistorial = this.chatHistorial.slice(-20);
        }

      } catch {
        this.chatMensajes[this.chatMensajes.length - 1].texto = 'Sin conexión — intentá de nuevo';
        this.chatMensajes[this.chatMensajes.length - 1].cargando = false;
      } finally {
        this.chatCargando = false;
        this.$nextTick(() => this.scrollChatAbajo());
      }
    },

    usarSugerencia(texto) {
      this.chatInput = texto;
      this.enviarMensaje();
    },

    limpiarChat() {
      this.chatMensajes = [];
      this.chatHistorial = [];
    },

    renderMarkdown(texto) {
      const esc    = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const inline = s => s.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>');
      const isSep  = l => /^\|[\s\-:|]+\|$/.test(l.trim());

      const lines = texto.split('\n');
      let html = '';
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];

        // Tabla Markdown
        if (line.trim().startsWith('|')) {
          const tLines = [];
          while (i < lines.length && lines[i].trim().startsWith('|')) {
            tLines.push(lines[i]); i++;
          }
          const dataRows = tLines.filter(l => !isSep(l));
          if (dataRows.length >= 1) {
            const header = dataRows[0].split('|').slice(1,-1)
              .map(c => `<th>${inline(esc(c.trim()))}</th>`).join('');
            const body = dataRows.slice(1).map(row => {
              const cells = row.split('|').slice(1,-1)
                .map(c => `<td>${inline(esc(c.trim()))}</td>`).join('');
              return `<tr>${cells}</tr>`;
            }).join('');
            html += `<div class="chat-table-wrap"><table class="chat-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
          }
          continue;
        }

        // Lista
        if (/^[-*] /.test(line)) {
          const items = [];
          while (i < lines.length && /^[-*] /.test(lines[i])) {
            items.push(`<li>${inline(esc(lines[i].slice(2).trim()))}</li>`);
            i++;
          }
          html += `<ul>${items.join('')}</ul>`;
          continue;
        }

        // Línea vacía
        if (!line.trim()) { html += '<br>'; i++; continue; }

        // Texto normal
        html += inline(esc(line)) + '<br>';
        i++;
      }
      return html;
    },
  };
}

// ── IndexedDB para cola offline ──────────────────────────────────
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gau9', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('cola_traslados', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = ()  => reject(new Error('No se pudo abrir IndexedDB'));
  });
}
