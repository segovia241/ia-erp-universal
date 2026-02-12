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
4. Si el usuario menciona "pacientes" USA el endpoint de Listar Pacientes
5. Si el usuario menciona "medicos" USA el endpoint de Listar Medicos
6. Si el usuario menciona "clientes" USA el endpoint de Buscar Cliente
7. NUNCA devuelvas una lista de endpoints - SIEMPRE uno específico
8. NO agregues texto fuera del JSON

IMPORTANTE: Basado en el mensaje del usuario, DEBES seleccionar el endpoint más apropiado de los disponibles en el módulo indicado.
`;
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
   * Valida que la acción sea válida
   */
  private validarAccion(accion: string): { valido: boolean; mensaje?: string } {
    if (!accion) {
      return {
        valido: false,
        mensaje: `No especificaste una acción. Acciones disponibles: ${this.accionesDisponibles.join(', ')}`
      };
    }

    if (!this.accionesDisponibles.includes(accion)) {
      return {
        valido: false,
        mensaje: `La acción '${accion}' no es válida. Acciones disponibles: ${this.accionesDisponibles.join(', ')}`
      };
    }

    return { valido: true };
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

    // 2. Validar acción
    if (!respuestaIA.accion) {
      respuestaIA.accion = 'leer'; // Por defecto
    }

    const validacionAccion = this.validarAccion(respuestaIA.accion);
    if (!validacionAccion.valido) {
      return {
        tipo: 'ACCION',
        mensaje: validacionAccion.mensaje!,
        requiereFiltros: true,
        modulo: respuestaIA.modulo,
        accion: respuestaIA.accion
      };
    }

    // 3. Si la IA no seleccionó endpoint, lo seleccionamos nosotros
    if (!respuestaIA.endpoint) {
      const endpoints = this.obtenerEndpointsPorModuloYAccion(respuestaIA.modulo, respuestaIA.accion);
      
      if (endpoints.length === 0) {
        return {
          tipo: 'ACCION',
          mensaje: `No encontré endpoints para ${respuestaIA.modulo}/${respuestaIA.accion}`,
          requiereFiltros: true,
          modulo: respuestaIA.modulo,
          accion: respuestaIA.accion
        };
      }

      const endpointSeleccionado = this.seleccionarEndpointRelevante(endpoints, mensajeUsuario);
      const payload = this.construirPayloadDesdeMensaje(endpointSeleccionado, mensajeUsuario);
      
      return {
        tipo: 'ACCION',
        mensaje: `✅ Voy a ${this.obtenerVerboAccion(respuestaIA.accion)} en ${respuestaIA.modulo}`,
        modulo: respuestaIA.modulo,
        accion: respuestaIA.accion,
        endpoint: endpointSeleccionado.endpoint,
        method: endpointSeleccionado.metodo,
        payload: payload,
        requiereFiltros: false,
        endpointId: endpointSeleccionado.id
      };
    }

    // 4. Si la IA seleccionó endpoint, verificamos que exista
    const todosEndpoints = this.obtenerTodosEndpointsPorModulo(respuestaIA.modulo);
    const endpointValido = todosEndpoints.find(ep => ep.endpoint === respuestaIA.endpoint);
    
    if (!endpointValido) {
      // Si el endpoint no es válido, tomamos el más relevante
      const endpoints = this.obtenerEndpointsPorModuloYAccion(respuestaIA.modulo, respuestaIA.accion);
      if (endpoints.length > 0) {
        const endpointSeleccionado = this.seleccionarEndpointRelevante(endpoints, mensajeUsuario);
        const payload = respuestaIA.payload || this.construirPayloadDesdeMensaje(endpointSeleccionado, mensajeUsuario);
        
        return {
          tipo: 'ACCION',
          mensaje: `✅ ${respuestaIA.mensaje || `Voy a ${this.obtenerVerboAccion(respuestaIA.accion)} en ${respuestaIA.modulo}`}`,
          modulo: respuestaIA.modulo,
          accion: respuestaIA.accion,
          endpoint: endpointSeleccionado.endpoint,
          method: endpointSeleccionado.metodo,
          payload: payload,
          requiereFiltros: false,
          endpointId: endpointSeleccionado.id
        };
      }
    }

    // 5. Todo está bien con el endpoint seleccionado por la IA
    const endpoint = endpointValido || await this.obtenerEndpointPorDefecto(respuestaIA.modulo, respuestaIA.accion);
    const urlCompleta = `${this.config.empresa.baseUrl}${endpoint.endpoint}`;
    
    return {
      tipo: 'ACCION',
      mensaje: `✅ ${respuestaIA.mensaje || `Voy a ${this.obtenerVerboAccion(respuestaIA.accion)} en ${respuestaIA.modulo}`}`,
      modulo: respuestaIA.modulo,
      accion: respuestaIA.accion,
      endpoint: endpoint.endpoint,
      urlCompleta: urlCompleta,
      payload: respuestaIA.payload || this.construirPayloadDesdeMensaje(endpoint, mensajeUsuario),
      method: endpoint.metodo,
      requiereFiltros: false,
      endpointId: endpoint.id
    };
  }

  /**
   * Obtiene todos los endpoints de un módulo (todas las acciones)
   */
  private obtenerTodosEndpointsPorModulo(modulo: string): Endpoint[] {
    let todos: Endpoint[] = [];
    for (const accion of this.accionesDisponibles) {
      todos = todos.concat(this.obtenerEndpointsPorModuloYAccion(modulo, accion));
    }
    return todos;
  }

  /**
   * Obtiene un endpoint por defecto para un módulo/acción
   */
  private async obtenerEndpointPorDefecto(modulo: string, accion: string): Promise<Endpoint> {
    const endpoints = this.obtenerEndpointsPorModuloYAccion(modulo, accion);
    if (endpoints.length === 0) {
      throw new Error(`No hay endpoints disponibles para ${modulo}/${accion}`);
    }
    return endpoints[0];
  }

  /**
   * Obtiene el verbo de acción para mensajes naturales
   */
  private obtenerVerboAccion(accion: string): string {
    const verbos: Record<string, string> = {
      'leer': 'listar',
      'crear': 'crear',
      'actualizar': 'actualizar',
      'eliminar': 'eliminar'
    };
    return verbos[accion] || accion;
  }

  /**
   * Selecciona el endpoint más relevante basado en el mensaje del usuario
   */
  private seleccionarEndpointRelevante(endpoints: Endpoint[], mensaje: string): Endpoint {
    const mensajeLower = mensaje.toLowerCase();
    
    // Priorizar endpoints específicos basados en palabras clave
    for (const endpoint of endpoints) {
      const nombre = endpoint.nombreReferencia.toLowerCase();
      const descripcion = endpoint.descripcion.toLowerCase();
      
      if (nombre.includes('pacientes') && mensajeLower.includes('paciente')) {
        return endpoint;
      }
      if (nombre.includes('medicos') && mensajeLower.includes('medico')) {
        return endpoint;
      }
      if (nombre.includes('clientes') && mensajeLower.includes('cliente')) {
        return endpoint;
      }
      if (nombre.includes('usuario') && mensajeLower.includes('usuario')) {
        return endpoint;
      }
      if (descripcion.includes('documento') && mensajeLower.includes('documento')) {
        return endpoint;
      }
    }
    
    // Si no hay coincidencia específica, devolver el primero
    return endpoints[0];
  }

  /**
   * Construye un payload basado en el mensaje del usuario
   */
  private construirPayloadDesdeMensaje(endpoint: Endpoint, mensaje: string): any {
    const payload: any = {};
    const mensajeLower = mensaje.toLowerCase();
    
    endpoint.parametros.forEach(param => {
      if (param.estructura?.esObjeto) {
        payload[param.nombre] = {};
        param.estructura.propiedades?.forEach(prop => {
          const valorExtraido = this.extraerValorDeMensaje(mensaje, prop.nombre);
          
          if (prop.tipo === 'string') {
            // Para string, usar el valor extraído o cadena vacía
            payload[param.nombre][prop.nombre] = valorExtraido !== null ? valorExtraido : '';
          } else if (prop.tipo === 'int') {
            // Para int, convertir a número o 0 si es null
            const valorNumerico = valorExtraido ? parseInt(valorExtraido, 10) : 0;
            payload[param.nombre][prop.nombre] = isNaN(valorNumerico) ? 0 : valorNumerico;
          } else if (prop.tipo === 'boolean') {
            payload[param.nombre][prop.nombre] = false;
          }
        });
      } else {
        if (param.tipo === 'string') {
          const valorExtraido = this.extraerValorDeMensaje(mensaje, param.nombre);
          payload[param.nombre] = valorExtraido !== null ? valorExtraido : '';
        } else if (param.tipo === 'int') {
          const valorExtraido = this.extraerValorDeMensaje(mensaje, param.nombre);
          const valorNumerico = valorExtraido ? parseInt(valorExtraido, 10) : 0;
          payload[param.nombre] = isNaN(valorNumerico) ? 0 : valorNumerico;
        } else if (param.tipo === 'boolean') {
          payload[param.nombre] = false;
        }
      }
    });
    
    // Si es el endpoint de Listar Pacientes y no se extrajo valor, usar el texto completo
    if (endpoint.nombreReferencia === 'Listar Pacientes' && 
        payload.oEntity && 
        payload.oEntity.T_Descripcion === '') {
      
      // Intentar extraer el apellido/nombre del mensaje
      const match = mensaje.match(/apellido\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i) || 
                   mensaje.match(/paciente\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i) ||
                   mensaje.match(/con\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i) ||
                   mensaje.match(/([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)$/i);
      
      if (match && match[1]) {
        payload.oEntity.T_Descripcion = match[1].trim().toUpperCase();
      }
    }
    
    return payload;
  }

  /**
   * Extrae un valor del mensaje del usuario
   */
  private extraerValorDeMensaje(mensaje: string, nombreCampo: string): string | null {
    const mensajeLower = mensaje.toLowerCase();
    const campoLower = nombreCampo.toLowerCase()
      .replace('t_', '')
      .replace('str_', '')
      .replace('_', '');
    
    // Patrones específicos para T_Descripcion (búsqueda de pacientes)
    if (nombreCampo === 'T_Descripcion') {
      const patronesDescripcion = [
        /apellido\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /paciente\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /nombre\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /con\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /buscar\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /listar\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i
      ];
      
      for (const patron of patronesDescripcion) {
        const match = mensaje.match(patron);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    }
    
    // Patrones generales
    const patrones = [
      new RegExp(`${campoLower}\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+)`, 'i'),
      new RegExp(`([a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+)\\s+${campoLower}`, 'i'),
      new RegExp(`con\\s+${campoLower}\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+)`, 'i'),
      new RegExp(`de\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+)`, 'i')
    ];
    
    for (const patron of patrones) {
      const match = mensaje.match(patron);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return null;
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