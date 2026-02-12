// services/deepseek-raw.service.ts
import axios from "axios";
import { IAResponseSchema } from "../../schemas/ia-response.schema";
import { 
  cargarConfiguracion,
  obtenerEndpointsPorModuloYAccion,
  validarPayload,
  Endpoint,
  ConfiguracionAPI
} from "../../../erp/configs/api-config";

export class DeepSeekRawService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private config: ConfiguracionAPI;
  private readonly modulosDisponibles: string[];
  private readonly accionesDisponibles = ["leer", "crear", "actualizar", "eliminar"];

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || "";
    this.baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1/chat/completions";
    
    try {
      this.config = cargarConfiguracion();
      this.modulosDisponibles = this.config.modulos.map(mod => mod.nombre);
    } catch (error) {
      console.error("Error cargando configuración de endpoints:", error);
      throw new Error("No se pudo cargar la configuración de endpoints");
    }
  }

  /**
   * Obtiene todos los endpoints de un módulo y acción específicos
   */
  private obtenerEndpointsPorModuloYAccion(modulo: string, accion: string): Endpoint[] {
    const resultado = obtenerEndpointsPorModuloYAccion(modulo, accion);
    if (resultado.success && resultado.data) {
      return resultado.data.flatMap(m => m.endpoints);
    }
    return [];
  }

  /**
   * Genera el system prompt dinámico con los módulos disponibles y SUS ENDPOINTS
   */
  private generarSystemPrompt(): string {
    const listaModulos = this.modulosDisponibles
      .map(mod => `   - ${mod}`)
      .join('\n');

    // Generar ejemplos de endpoints para que la IA aprenda a seleccionar
    const ejemplosEndpoints = this.generarEjemplosEndpoints();

    return `
Eres un asistente inteligente dentro de un ERP.
Tu función es ANALIZAR el mensaje del usuario y SELECCIONAR el endpoint MÁS RELEVANTE.

============================================================
MÓDULOS DISPONIBLES:
${listaModulos}
============================================================

ACCIONES CRUD:
- leer (listar, buscar, obtener, consultar)
- crear (nuevo, agregar, registrar)
- actualizar (modificar, editar, cambiar)
- eliminar (borrar, quitar, remover)

============================================================
EJEMPLOS DE ENDPOINTS POR MÓDULO Y ACCIÓN:
${ejemplosEndpoints}
============================================================

Tu respuesta DEBE ser JSON con esta estructura EXACTA:

{
  "tipo": "ACCION",
  "mensaje": "Respuesta natural al usuario indicando qué vas a hacer",
  "modulo": "Nombre EXACTO del módulo",
  "accion": "leer|crear|actualizar|eliminar",
  "endpoint": "Ruta completa del endpoint seleccionado",
  "method": "POST|GET|PUT|DELETE",
  "payload": {
    // Objeto con los parámetros exactos que espera el endpoint
    // Debes inferir los valores del mensaje del usuario
  }
}

REGLAS CRÍTICAS - OBLIGATORIAS:
1. SIEMPRE debes seleccionar UN endpoint específico, NUNCA preguntar
2. El endpoint debe ser el MÁS RELEVANTE para lo que pide el usuario
3. El payload debe coincidir EXACTAMENTE con la estructura del endpoint
4. Si el usuario no proporciona todos los parámetros, USA VALORES POR DEFECTO O VACÍOS
5. NUNCA devuelvas una lista de endpoints - SIEMPRE uno específico
6. NO agregues texto fuera del JSON

IMPORTANTE: Basado en el mensaje del usuario, DEBES seleccionar el endpoint más apropiado de los disponibles en el módulo indicado.
`;
  }

  /**
   * Genera ejemplos de endpoints para el prompt
   */
  private generarEjemplosEndpoints(): string {
    try {
      const ejemplos: string[] = [];
      
      // Tomar los primeros 2 módulos para ejemplos
      const modulosEjemplo = this.modulosDisponibles.slice(0, 2);
      
      for (const modulo of modulosEjemplo) {
        for (const accion of this.accionesDisponibles) {
          const endpoints = this.obtenerEndpointsPorModuloYAccion(modulo, accion);
          if (endpoints.length > 0) {
            const ep = endpoints[0]; // Tomar el primero como ejemplo
            ejemplos.push(`
Módulo: ${modulo}, Acción: ${accion}
- Endpoint: ${ep.endpoint}
- Method: ${ep.metodo}
- Parámetros: ${JSON.stringify(ep.parametros.map(p => p.nombre))}
- Estructura payload: ${JSON.stringify(this.generarPayloadEjemplo(ep))}
`);
          }
        }
      }
      
      return ejemplos.join('\n');
    } catch (error) {
      return "Ejemplos no disponibles";
    }
  }

  /**
   * Genera un payload de ejemplo para un endpoint
   */
  private generarPayloadEjemplo(endpoint: Endpoint): any {
    const payload: any = {};
    
    endpoint.parametros.forEach(param => {
      if (param.estructura?.esObjeto) {
        payload[param.nombre] = {};
        param.estructura.propiedades?.forEach(prop => {
          // Valores por defecto según tipo
          if (prop.tipo === 'string') {
            payload[param.nombre][prop.nombre] = 'ejemplo';
          } else if (prop.tipo === 'int') {
            payload[param.nombre][prop.nombre] = 0;
          } else if (prop.tipo === 'boolean') {
            payload[param.nombre][prop.nombre] = false;
          }
        });
      } else {
        if (param.tipo === 'string') {
          payload[param.nombre] = 'ejemplo';
        } else if (param.tipo === 'int') {
          payload[param.nombre] = 0;
        } else if (param.tipo === 'boolean') {
          payload[param.nombre] = false;
        }
      }
    });
    
    return payload;
  }

  async sendRawMessage(message: string): Promise<any> {
    const response = await axios.post(
      this.baseUrl,
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: this.generarSystemPrompt()
          },
          {
            role: "user",
            content: message
          }
        ],
        temperature: 0
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        }
      }
    );

    return response.data;
  }

  /**
   * Valida que el módulo exista en la configuración
   */
  private validarModulo(modulo: string): { valido: boolean; mensaje?: string } {
    if (!modulo) {
      return {
        valido: false,
        mensaje: `No especificaste un módulo. Módulos disponibles: ${this.modulosDisponibles.join(', ')}`
      };
    }

    const moduloExacto = this.modulosDisponibles.find(m => m === modulo);
    if (!moduloExacto) {
      return {
        valido: false,
        mensaje: `El módulo '${modulo}' no existe. Módulos disponibles: ${this.modulosDisponibles.join(', ')}`
      };
    }

    return { valido: true };
  }

  /**
   * Valida que el endpoint seleccionado exista en el módulo
   */
  private validarEndpointEnModulo(modulo: string, endpointPath: string): Endpoint | null {
    const endpoints = this.obtenerEndpointsPorModuloYAccion(modulo, "leer")
      .concat(this.obtenerEndpointsPorModuloYAccion(modulo, "crear"))
      .concat(this.obtenerEndpointsPorModuloYAccion(modulo, "actualizar"))
      .concat(this.obtenerEndpointsPorModuloYAccion(modulo, "eliminar"));
    
    return endpoints.find(ep => ep.endpoint === endpointPath) || null;
  }

  /**
   * Procesa una acción: valida módulo y endpoint seleccionado por la IA
   */
  private async procesarAccion(
    mensajeUsuario: string, 
    respuestaIA: IAResponseSchema
  ): Promise<IAResponseSchema> {
    
    // 1. Validar módulo
    if (!respuestaIA.modulo) {
      return {
        tipo: 'ACCION',
        mensaje: `¿En qué módulo deseas realizar esta acción?\nMódulos disponibles: ${this.modulosDisponibles.join(', ')}`,
        requiereFiltros: true
      };
    }

    const validacionModulo = this.validarModulo(respuestaIA.modulo);
    if (!validacionModulo.valido) {
      return {
        tipo: 'ACCION',
        mensaje: validacionModulo.mensaje!,
        requiereFiltros: true,
        modulo: respuestaIA.modulo
      };
    }

    // 2. Validar que la IA haya seleccionado un endpoint
    if (!respuestaIA.endpoint) {
      // Si la IA no seleccionó endpoint, tomamos el más relevante nosotros
      const endpoints = this.obtenerEndpointsPorModuloYAccion(respuestaIA.modulo, respuestaIA.accion || "leer");
      
      if (endpoints.length === 0) {
        return {
          tipo: 'ACCION',
          mensaje: `No encontré endpoints para ${respuestaIA.modulo}/${respuestaIA.accion || 'leer'}`,
          requiereFiltros: true,
          modulo: respuestaIA.modulo,
          accion: respuestaIA.accion
        };
      }

      // Seleccionar el endpoint más relevante basado en el mensaje
      const endpointSeleccionado = this.seleccionarEndpointRelevante(endpoints, mensajeUsuario);
      
      return {
        tipo: 'ACCION',
        mensaje: `Voy a ${respuestaIA.accion || 'buscar'} en ${respuestaIA.modulo}`,
        modulo: respuestaIA.modulo,
        accion: respuestaIA.accion || 'leer',
        endpoint: endpointSeleccionado.endpoint,
        method: endpointSeleccionado.metodo,
        payload: this.construirPayloadDesdeMensaje(endpointSeleccionado, mensajeUsuario),
        requiereFiltros: false,
        endpointId: endpointSeleccionado.id
      };
    }

    // 3. Validar que el endpoint existe en el módulo
    const endpointValido = this.validarEndpointEnModulo(respuestaIA.modulo, respuestaIA.endpoint);
    if (!endpointValido) {
      // Si el endpoint no es válido, tomamos el más relevante
      const endpoints = this.obtenerEndpointsPorModuloYAccion(respuestaIA.modulo, respuestaIA.accion || "leer");
      if (endpoints.length > 0) {
        const endpointSeleccionado = endpoints[0];
        return {
          tipo: 'ACCION',
          mensaje: respuestaIA.mensaje,
          modulo: respuestaIA.modulo,
          accion: respuestaIA.accion || 'leer',
          endpoint: endpointSeleccionado.endpoint,
          method: endpointSeleccionado.metodo,
          payload: respuestaIA.payload || this.construirPayloadDesdeMensaje(endpointSeleccionado, mensajeUsuario),
          requiereFiltros: false,
          endpointId: endpointSeleccionado.id
        };
      }
    }

    // 4. Validar el payload
    if (endpointValido) {
      const validacion = validarPayload(endpointValido, respuestaIA.payload || {});
      
      if (validacion.faltantes.length > 0 || validacion.erroresTipo.length > 0 || validacion.erroresEstructura.length > 0) {
        // En lugar de pedir filtros, completamos con valores vacíos
        const payloadCompleto = this.completarPayloadFaltante(endpointValido, respuestaIA.payload || {});
        
        return {
          tipo: 'ACCION',
          mensaje: `✅ ${respuestaIA.mensaje || `Voy a ${respuestaIA.accion} en ${respuestaIA.modulo}`}`,
          modulo: respuestaIA.modulo,
          accion: respuestaIA.accion,
          endpoint: endpointValido.endpoint,
          method: endpointValido.metodo,
          payload: payloadCompleto,
          requiereFiltros: false,
          endpointId: endpointValido.id
        };
      }
    }

    // 5. Todo está bien
    const urlCompleta = `${this.config.empresa.baseUrl}${respuestaIA.endpoint}`;
    
    return {
      tipo: 'ACCION',
      mensaje: `✅ ${respuestaIA.mensaje || `Voy a ${respuestaIA.accion} en ${respuestaIA.modulo}`}`,
      modulo: respuestaIA.modulo,
      accion: respuestaIA.accion,
      endpoint: respuestaIA.endpoint,
      urlCompleta: urlCompleta,
      payload: respuestaIA.payload,
      method: respuestaIA.method,
      requiereFiltros: false,
      endpointId: respuestaIA.endpointId
    };
  }

  /**
   * Selecciona el endpoint más relevante basado en el mensaje del usuario
   */
  private seleccionarEndpointRelevante(endpoints: Endpoint[], mensaje: string): Endpoint {
    // Priorizar endpoints que contengan palabras clave del mensaje
    const palabrasClave = mensaje.toLowerCase().split(' ');
    
    let mejorEndpoint = endpoints[0];
    let maxPuntaje = 0;
    
    for (const endpoint of endpoints) {
      let puntaje = 0;
      const descripcion = endpoint.descripcion.toLowerCase();
      const nombre = endpoint.nombreReferencia.toLowerCase();
      
      for (const palabra of palabrasClave) {
        if (descripcion.includes(palabra) || nombre.includes(palabra)) {
          puntaje++;
        }
      }
      
      // Dar prioridad a "Listar Pacientes" para búsquedas de pacientes
      if (nombre.includes('pacientes') && mensaje.toLowerCase().includes('paciente')) {
        puntaje += 5;
      }
      
      if (puntaje > maxPuntaje) {
        maxPuntaje = puntaje;
        mejorEndpoint = endpoint;
      }
    }
    
    return mejorEndpoint;
  }

  /**
   * Construye un payload basado en el mensaje del usuario
   */
  private construirPayloadDesdeMensaje(endpoint: Endpoint, mensaje: string): any {
    const payload: any = {};
    
    endpoint.parametros.forEach(param => {
      if (param.estructura?.esObjeto) {
        payload[param.nombre] = {};
        param.estructura.propiedades?.forEach(prop => {
          // Extraer el valor del mensaje si es posible
          const valorExtraido = this.extraerValorDeMensaje(mensaje, prop.nombre);
          
          if (prop.tipo === 'string') {
            payload[param.nombre][prop.nombre] = valorExtraido || '';
          } else if (prop.tipo === 'int') {
            payload[param.nombre][prop.nombre] = parseInt(valorExtraido) || 0;
          } else if (prop.tipo === 'boolean') {
            payload[param.nombre][prop.nombre] = false;
          }
        });
      } else {
        if (param.tipo === 'string') {
          payload[param.nombre] = this.extraerValorDeMensaje(mensaje, param.nombre) || '';
        } else if (param.tipo === 'int') {
          payload[param.nombre] = 0;
        } else if (param.tipo === 'boolean') {
          payload[param.nombre] = false;
        }
      }
    });
    
    return payload;
  }

  /**
   * Extrae un valor del mensaje del usuario
   */
  private extraerValorDeMensaje(mensaje: string, nombreCampo: string): string | null {
    // Buscar patrones como "apellido Perez", "nombre Juan", etc.
    const mensajeLower = mensaje.toLowerCase();
    const campoLower = nombreCampo.toLowerCase().replace('t_', '').replace('str_', '');
    
    // Patrones comunes
    const patrones = [
      new RegExp(`${campoLower}\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+)`, 'i'),
      new RegExp(`([a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+)\\s+${campoLower}`, 'i'),
      new RegExp(`con\\s+${campoLower}\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+)`, 'i'),
      new RegExp(`de\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+)`, 'i') // Capturar el último texto
    ];
    
    for (const patron of patrones) {
      const match = mensaje.match(patron);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  /**
   * Completa el payload con valores vacíos para campos faltantes
   */
  private completarPayloadFaltante(endpoint: Endpoint, payloadParcial: any): any {
    const payloadCompleto = { ...payloadParcial };
    
    endpoint.parametros.forEach(param => {
      if (!payloadCompleto[param.nombre]) {
        if (param.estructura?.esObjeto) {
          payloadCompleto[param.nombre] = {};
          param.estructura.propiedades?.forEach(prop => {
            if (!payloadCompleto[param.nombre][prop.nombre]) {
              if (prop.tipo === 'string') {
                payloadCompleto[param.nombre][prop.nombre] = '';
              } else if (prop.tipo === 'int') {
                payloadCompleto[param.nombre][prop.nombre] = 0;
              } else if (prop.tipo === 'boolean') {
                payloadCompleto[param.nombre][prop.nombre] = false;
              }
            }
          });
        } else {
          if (param.tipo === 'string') {
            payloadCompleto[param.nombre] = '';
          } else if (param.tipo === 'int') {
            payloadCompleto[param.nombre] = 0;
          } else if (param.tipo === 'boolean') {
            payloadCompleto[param.nombre] = false;
          }
        }
      }
    });
    
    return payloadCompleto;
  }

  async sendAndMapToSchema(message: string): Promise<IAResponseSchema> {
    // 1. Obtener respuesta de la IA
    const raw = await this.sendRawMessage(message);
    const content = raw?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Respuesta inválida de DeepSeek");
    }

    let respuestaInicial: IAResponseSchema;

    try {
      respuestaInicial = JSON.parse(content);
    } catch {
      throw new Error("DeepSeek no devolvió un JSON válido");
    }

    // 2. Si es conversación, devolver respuesta directamente
    if (respuestaInicial.tipo === 'CONVERSACION') {
      return {
        tipo: 'CONVERSACION',
        mensaje: respuestaInicial.mensaje
      };
    }

    // 3. Si es acción, procesar
    if (respuestaInicial.tipo === 'ACCION') {
      return await this.procesarAccion(message, respuestaInicial);
    }

    return respuestaInicial;
  }

  public getModulosDisponibles(): string[] {
    return [...this.modulosDisponibles];
  }

  public getInfoEmpresa(): { nombre: string; baseUrl: string } {
    return {
      nombre: this.config.empresa.nombre,
      baseUrl: this.config.empresa.baseUrl
    };
  }
}