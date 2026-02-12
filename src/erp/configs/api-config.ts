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
  const archivos = fs.readdirSync(__dirname);
  const jsonFile = archivos.find(file => file.endsWith('.json'));
  
  if (!jsonFile) {
    throw new Error('No se encontró ningún archivo JSON en el directorio');
  }

  const ruta = path.join(__dirname, jsonFile);
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

/* ============================================================
   Buscar Endpoints por Módulo y Acción
   ============================================================ */

/**
 * Busca endpoints filtrando por nombre de módulo y tipo de acción (CRUD)
 * @param config - Configuración completa cargada del JSON
 * @param nombreModulo - Nombre del módulo a buscar (ej: "Clinico")
 * @param accion - Tipo de acción CRUD ("leer", "crear", "actualizar", "eliminar")
 * @returns Array de endpoints que coinciden con el módulo y acción, o array vacío si no encuentra
 */
export function buscarEndpointsPorModuloYAccion(
  config: ConfiguracionAPI,
  nombreModulo: string,
  accion: "leer" | "crear" | "actualizar" | "eliminar"
): Endpoint[] {
  // Buscar el módulo por nombre
  const modulo = config.modulos.find(
    (mod) => mod.nombre.toLowerCase() === nombreModulo.toLowerCase()
  );

  // Si no existe el módulo, retornar array vacío
  if (!modulo) {
    return [];
  }

  // Retornar los endpoints de la acción solicitada
  return modulo[accion];
}

/* ============================================================
   Versión con más flexibilidad (acepta cualquier string y hace match)
   ============================================================ */

/**
 * Busca endpoints con coincidencia parcial en nombre de módulo y acción normalizada
 * @param config - Configuración completa
 * @param moduloStr - Texto a buscar en nombre del módulo (case insensitive)
 * @param accionStr - Texto a buscar en tipo de acción (leer, crear, actualizar, eliminar)
 * @returns Array de endpoints filtrados
 */
export function buscarEndpointsFlexible(
  config: ConfiguracionAPI,
  moduloStr: string,
  accionStr: string
): { modulo: string; accion: string; endpoints: Endpoint[] }[] {
  const resultado: { modulo: string; accion: string; endpoints: Endpoint[] }[] = [];
  
  // Normalizar la acción a buscar
  const accionNormalizada = accionStr.toLowerCase();
  const accionesValidas = ["leer", "crear", "actualizar", "eliminar"];
  
  // Encontrar qué acción CRUD coincide con el texto ingresado
  let accionEncontrada: "leer" | "crear" | "actualizar" | "eliminar" | null = null;
  
  for (const accion of accionesValidas) {
    if (accion.includes(accionNormalizada) || accionNormalizada.includes(accion)) {
      accionEncontrada = accion as any;
      break;
    }
  }
  
  if (!accionEncontrada) {
    return resultado; // No se reconoció la acción
  }
  
  // Buscar módulos que coincidan parcialmente
  const modulosCoincidentes = config.modulos.filter(mod => 
    mod.nombre.toLowerCase().includes(moduloStr.toLowerCase())
  );
  
  // Para cada módulo, extraer los endpoints de la acción encontrada
  for (const modulo of modulosCoincidentes) {
    if (modulo[accionEncontrada] && modulo[accionEncontrada].length > 0) {
      resultado.push({
        modulo: modulo.nombre,
        accion: accionEncontrada,
        endpoints: modulo[accionEncontrada]
      });
    }
  }
  
  return resultado;
}

/* ============================================================
   EJEMPLO DE USO
   ============================================================ */

// Ejemplo 1: Búsqueda exacta
export function ejemploUsoExacto() {
  const config = cargarConfiguracion();
  
  // Buscar todos los endpoints de "leer" en el módulo "Clinico"
  const endpointsClinicoLeer = buscarEndpointsPorModuloYAccion(
    config,
    "Clinico",
    "leer"
  );
  
  console.log(`Encontrados ${endpointsClinicoLeer.length} endpoints en Clinico/leer`);
  
  endpointsClinicoLeer.forEach(ep => {
    console.log(`- ${ep.nombreReferencia}: ${ep.endpoint}`);
  });
  
  return endpointsClinicoLeer;
}

// Ejemplo 2: Búsqueda flexible (útil cuando los strings vienen de entrada del usuario)
export function ejemploUsoFlexible() {
  const config = cargarConfiguracion();
  
  // Ejemplo: usuario escribe "clinic" y "lee"
  const resultados = buscarEndpointsFlexible(config, "clinic", "lee");
  
  resultados.forEach(item => {
    console.log(`Módulo: ${item.modulo}, Acción: ${item.accion}`);
    console.log(`Endpoints: ${item.endpoints.length}`);
  });
  
  return resultados;
}

/* ============================================================
   FUNCIÓN PRINCIPAL SOLICITADA
   ============================================================ */

/**
 * FUNCIÓN PRINCIPAL - Recibe 2 strings (módulo y acción) y retorna los endpoints
 * @param moduloStr - Nombre del módulo o texto parcial
 * @param accionStr - Acción a buscar (leer, eliminar, etc.) o texto parcial
 * @returns Objeto con los resultados de la búsqueda
 */
export function obtenerEndpointsPorModuloYAccion(
  moduloStr: string,
  accionStr: string
): {
  success: boolean;
  message: string;
  data?: {
    modulo: string;
    accion: string;
    endpoints: Endpoint[];
    empresa: string;
    baseUrl: string;
  }[];
  totalEndpoints?: number;
} {
  try {
    // 1. Cargar configuración
    const config = cargarConfiguracion();
    
    // 2. Normalizar entradas
    const moduloLower = moduloStr.toLowerCase();
    const accionLower = accionStr.toLowerCase();
    
    // 3. Mapeo de acciones posibles
    const mapaAcciones: Record<string, "leer" | "crear" | "actualizar" | "eliminar"> = {
      "leer": "leer",
      "lee": "leer",
      "read": "leer",
      "listar": "leer",
      "obtener": "leer",
      "crear": "crear",
      "create": "crear",
      "nuevo": "crear",
      "actualizar": "actualizar",
      "update": "actualizar",
      "editar": "actualizar",
      "eliminar": "eliminar",
      "delete": "eliminar",
      "borrar": "eliminar"
    };
    
    // 4. Determinar la acción exacta
    let accionExacta: "leer" | "crear" | "actualizar" | "eliminar" | null = null;
    
    // Buscar coincidencia en el mapa
    for (const [key, value] of Object.entries(mapaAcciones)) {
      if (key === accionLower || accionLower.includes(key) || key.includes(accionLower)) {
        accionExacta = value;
        break;
      }
    }
    
    if (!accionExacta) {
      return {
        success: false,
        message: `Acción '${accionStr}' no reconocida. Acciones válidas: leer, crear, actualizar, eliminar`,
        totalEndpoints: 0
      };
    }
    
    // 5. Buscar módulos que coincidan
    const modulosCoincidentes = config.modulos.filter(mod => 
      mod.nombre.toLowerCase().includes(moduloLower)
    );
    
    if (modulosCoincidentes.length === 0) {
      return {
        success: false,
        message: `No se encontró el módulo '${moduloStr}'`,
        totalEndpoints: 0
      };
    }
    
    // 6. Construir resultado
    const resultado = [];
    let totalEndpoints = 0;
    
    for (const modulo of modulosCoincidentes) {
      const endpoints = modulo[accionExacta];
      
      if (endpoints && endpoints.length > 0) {
        resultado.push({
          modulo: modulo.nombre,
          accion: accionExacta,
          endpoints: endpoints,
          empresa: config.empresa.nombre,
          baseUrl: config.empresa.baseUrl
        });
        
        totalEndpoints += endpoints.length;
      }
    }
    
    if (resultado.length === 0) {
      return {
        success: false,
        message: `El módulo '${moduloStr}' no tiene endpoints para la acción '${accionExacta}'`,
        totalEndpoints: 0
      };
    }
    
    return {
      success: true,
      message: `Se encontraron ${totalEndpoints} endpoints en ${resultado.length} módulo(s)`,
      data: resultado,
      totalEndpoints
    };
    
  } catch (error) {
    return {
      success: false,
      message: `Error al procesar la solicitud: ${error instanceof Error ? error.message : String(error)}`,
      totalEndpoints: 0
    };
  }
}
