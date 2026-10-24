// Envoltorio simple de IndexedDB con promesas y manejo de errores.
const DB_NOMBRE = 'agenda-nail';
const DB_VERSION = 1;

export const STORES = {
  clientas: 'clientas',
  servicios: 'servicios',
  turnos: 'turnos',
  ajustes: 'ajustes',
};

let dbPromesa = null;

export class ErrorDB extends Error {
  constructor(mensaje, causa) {
    super(mensaje);
    this.name = 'ErrorDB';
    this.causa = causa;
  }
}

function abrir() {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new ErrorDB('Tu navegador no permite guardar datos (IndexedDB no disponible).'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    } catch (e) {
      reject(new ErrorDB('No se pudo abrir la base de datos.', e));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.clientas)) {
        const s = db.createObjectStore(STORES.clientas, { keyPath: 'id' });
        s.createIndex('nombre', 'nombreBusqueda');
      }
      if (!db.objectStoreNames.contains(STORES.servicios)) {
        db.createObjectStore(STORES.servicios, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.turnos)) {
        const s = db.createObjectStore(STORES.turnos, { keyPath: 'id' });
        s.createIndex('fecha', 'fecha');
        s.createIndex('clientaId', 'clientaId');
      }
      if (!db.objectStoreNames.contains(STORES.ajustes)) {
        db.createObjectStore(STORES.ajustes, { keyPath: 'clave' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      dbPromesa = null;
      reject(new ErrorDB('No se pudo abrir la base de datos.', req.error));
    };
    req.onblocked = () => {
      reject(new ErrorDB('La base de datos está bloqueada. Cierra otras pestañas de la app.'));
    };
  });
  return dbPromesa;
}

function promesaDeRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function conStore(nombre, modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    let resultado;
    let tx;
    try {
      tx = db.transaction(nombre, modo);
    } catch (e) {
      reject(new ErrorDB('No se pudo acceder a los datos.', e));
      return;
    }
    const store = tx.objectStore(nombre);
    Promise.resolve(fn(store))
      .then((r) => { resultado = r; })
      .catch((e) => {
        try { tx.abort(); } catch (_) { /* ya terminada */ }
        reject(new ErrorDB('Error al procesar los datos.', e));
      });
    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => reject(new ErrorDB(mensajeDeError(tx.error), tx.error));
    tx.onabort = () => reject(new ErrorDB(mensajeDeError(tx.error), tx.error));
  });
}

function mensajeDeError(err) {
  if (err && err.name === 'QuotaExceededError') return 'No hay espacio suficiente para guardar los datos.';
  return 'No se pudieron guardar o leer los datos.';
}

export function nuevoId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const db = {
  abrir,
  todos(store) {
    return conStore(store, 'readonly', (s) => promesaDeRequest(s.getAll()));
  },
  obtener(store, id) {
    return conStore(store, 'readonly', (s) => promesaDeRequest(s.get(id)));
  },
  porIndice(store, indice, valor) {
    return conStore(store, 'readonly', (s) => promesaDeRequest(s.index(indice).getAll(valor)));
  },
  guardar(store, obj) {
    return conStore(store, 'readwrite', (s) => promesaDeRequest(s.put(obj))).then(() => obj);
  },
  guardarVarios(store, objs) {
    return conStore(store, 'readwrite', (s) => Promise.all(objs.map((o) => promesaDeRequest(s.put(o))))).then(() => objs);
  },
  borrar(store, id) {
    return conStore(store, 'readwrite', (s) => promesaDeRequest(s.delete(id)));
  },
  async ajuste(clave) {
    const r = await this.obtener(STORES.ajustes, clave);
    return r ? r.valor : undefined;
  },
  guardarAjuste(clave, valor) {
    return this.guardar(STORES.ajustes, { clave, valor });
  },
};
