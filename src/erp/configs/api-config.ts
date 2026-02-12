import * as fs from "fs";
import * as path from "path";

/* ============================================================
   Nombre del archivo JSON
   ============================================================ */

const archivoJSON = "empresa-config.json";

/* ============================================================
   Tipos Base
   ============================================================ */

export type TipoPrimitivo = "string" | "int" | "boolean" | "object";

export interface Empresa {
  nombre: string;
  baseUrl: string;
}

export interface PropiedadEstructura {
  nombre: string;
  tipo: "string" | "int" | "boolean";
  opcional: boolean;
}

export interface EstructuraParametro {
  esObjeto: boolean;
  esArray: boolean;
  propiedades: PropiedadEstructura[];
}

export interface Fuente {
  idReferencia: number;
  nombreReferencia: string;
}

export interface Parametro {
  nombre: string;
  tipo: TipoPrimitivo;
  obligatorio: boolean;
  opcional: boolean;
  fuente: Fuente;
  estructura?: EstructuraParametro;
}

export interface Endpoint {
  id: number;
  endpoint: string;
  nombreReferencia: string;
  descripcion: string;
  metodo: "GET" | "POST" | "PUT" | "DELETE";
  parametros: Parametro[];
}

export interface Modulo {
  nombre: string;
  crear: Endpoint[];
  leer: Endpoint[];
  actualizar: Endpoint[];
  eliminar: Endpoint[];
}

export interface ConfiguracionAPI {
  empresa: Empresa;
  modulos: Modulo[];
}

/* ============================================================
   Cargar JSON
   ============================================================ */

export function cargarConfiguracion(): ConfiguracionAPI {
  const ruta = path.join(__dirname, archivoJSON);

  if (!fs.existsSync(ruta)) {
    throw new Error(`Archivo no encontrado: ${ruta}`);
  }

  const contenido = fs.readFileSync(ruta, "utf-8");
  return JSON.parse(contenido) as ConfiguracionAPI;
}

/* ============================================================
   Buscar Endpoint por ID
   ============================================================ */

export function obtenerEndpointPorId(
  config: ConfiguracionAPI,
  endpointId: number
): Endpoint | null {
  for (const modulo of config.modulos) {
    for (const crud of ["crear", "leer", "actualizar", "eliminar"] as const) {
      const encontrado = modulo[crud].find(e => e.id === endpointId);
      if (encontrado) return encontrado;
    }
  }
  return null;
}

/* ============================================================
   Construir URL completa
   ============================================================ */

export function construirUrlCompleta(
  config: ConfiguracionAPI,
  endpoint: Endpoint
): string {
  return `${config.empresa.baseUrl}${endpoint.endpoint}`;
}

/* ============================================================
   Validación de Tipos
   ============================================================ */

function validarTipo(valor: any, tipo: string): boolean {
  if (tipo === "string") return typeof valor === "string";
  if (tipo === "int") return typeof valor === "number";
  if (tipo === "boolean") return typeof valor === "boolean";
  return false;
}

/* ============================================================
   Validar Estructura Interna de Objetos
   ============================================================ */

function validarEstructura(
  estructura: EstructuraParametro,
  valor: any
): string[] {
  const errores: string[] = [];

  if (estructura.esObjeto && typeof valor !== "object") {
    errores.push("Debe ser un objeto");
    return errores;
  }

  for (const propiedad of estructura.propiedades) {
    if (!propiedad.opcional && !(propiedad.nombre in valor)) {
      errores.push(`Falta propiedad ${propiedad.nombre}`);
      continue;
    }

    if (propiedad.nombre in valor) {
      const esValido = validarTipo(valor[propiedad.nombre], propiedad.tipo);
      if (!esValido) {
        errores.push(`Tipo incorrecto en propiedad ${propiedad.nombre}`);
      }
    }
  }

  return errores;
}

/* ============================================================
   Validar Payload Completo
   ============================================================ */

export function validarPayload(
  endpoint: Endpoint,
  payload: Record<string, any>
): {
  faltantes: string[];
  erroresTipo: string[];
  erroresEstructura: string[];
} {
  const faltantes: string[] = [];
  const erroresTipo: string[] = [];
  const erroresEstructura: string[] = [];

  for (const param of endpoint.parametros) {
    if (param.obligatorio && !(param.nombre in payload)) {
      faltantes.push(param.nombre);
      continue;
    }

    if (param.nombre in payload) {
      const valor = payload[param.nombre];

      if (param.tipo !== "object") {
        if (!validarTipo(valor, param.tipo)) {
          erroresTipo.push(param.nombre);
        }
      }

      if (param.tipo === "object" && param.estructura) {
        const errores = validarEstructura(param.estructura, valor);
        errores.forEach(e =>
          erroresEstructura.push(`${param.nombre}: ${e}`)
        );
      }
    }
  }

  return { faltantes, erroresTipo, erroresEstructura };
}

/* ============================================================
   Crear Objeto de Envío
   ============================================================ */

export interface RequestPreparado {
  url: string;
  metodo: string;
  body?: Record<string, any>;
}

export function prepararRequest(
  config: ConfiguracionAPI,
  endpointId: number,
  valores: Record<string, any>
): RequestPreparado {
  const endpoint = obtenerEndpointPorId(config, endpointId);

  if (!endpoint) {
    throw new Error("Endpoint no encontrado");
  }

  const validacion = validarPayload(endpoint, valores);

  if (
    validacion.faltantes.length ||
    validacion.erroresTipo.length ||
    validacion.erroresEstructura.length
  ) {
    throw new Error(
      JSON.stringify(validacion, null, 2)
    );
  }

  return {
    url: construirUrlCompleta(config, endpoint),
    metodo: endpoint.metodo,
    body: endpoint.metodo !== "GET" ? valores : undefined
  };
}