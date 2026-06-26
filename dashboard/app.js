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

    // ── Forms modales
    formTraslado: {},
    formRegreso: {},
    formCivil: {},
    formPassword: { actual: '', nueva: '', confirmar: '' },
    passwordOk: false,
    trasladoSeleccionado: null,
    civilSeleccionado: null,

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
    },

    // ────────────────────────────────────────────────────────────
    // Resumen / Inicio
    // ────────────────────────────────────────────────────────────
    async cargarResumen() {
      this.cargando = true;
      try {
        const [resumen, actividad] = await Promise.all([
          this.apiGet('/api/dashboard/resumen'),
          this.apiGet('/api/actividad?limit=5'),
        ]);
        this.resumen = resumen;
        this.actividadReciente = actividad;
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
      if (!this.filtroNivel) return this.presentismo;
      return this.presentismo.filter(r => r.nivel === this.filtroNivel);
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

    verDetalle(persona) {
      // Por ahora solo muestra en alert básico. En Fase 2 se expande a vista dedicada.
      const info = [
        `${persona.apellido_1}, ${persona.nombre}`,
        `DNI: ${persona.dni}`,
        `Tipo: ${persona.tipo}`,
        persona.ficha_conducta ? `FC: ${persona.ficha_conducta}` : null,
        persona.pabellon ? `Pabellón: ${persona.pabellon}` : null,
        persona.nivel_educativo ? `Nivel: ${persona.nivel_educativo}` : null,
      ].filter(Boolean).join('\n');
      alert(info);
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
