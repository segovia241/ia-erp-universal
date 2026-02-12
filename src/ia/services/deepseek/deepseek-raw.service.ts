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
   * Genera el system prompt dinámico con TODOS los endpoints disponibles
   */
  private generarSystemPrompt(): string {
    const listaModulos = this.modulosDisponibles
      .map(mod => `   - ${mod}`)
      .join('\n');

    // Generar contexto completo de todos los endpoints disponibles
    const contextoEndpoints = this.generarContextoEndpoints();

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
ENDPOINTS DISPONIBLES POR MÓDULO Y ACCIÓN:
${contextoEndpoints}
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
4. Usa la lista de ENDPOINTS DISPONIBLES arriba para seleccionar el más apropiado
5. NUNCA devuelvas una lista de endpoints - SIEMPRE uno específico
6. NO agregues texto fuera del JSON

IMPORTANTE: Basado en el mensaje del usuario, DEBES seleccionar el endpoint más apropiado de la lista de endpoints disponibles.
`;
  }

  /**
   * Genera un string con TODOS los endpoints disponibles para que la IA los conozca
   */
  private generarContextoEndpoints(): string {
    let contexto = '';
    
    for (const modulo of this.config.modulos) {
      contexto += `\n--- MÓDULO: ${modulo.nombre} ---\n`;
      
      for (const accion of this.accionesDisponibles) {
        const endpoints = modulo[accion];
        if (endpoints && endpoints.length > 0) {
          contexto += `\n[ACCIÓN: ${accion}]\n`;
          endpoints.forEach(ep => {
            contexto += `  • Endpoint: ${ep.endpoint}\n`;
            contexto += `    Nombre: ${ep.nombreReferencia}\n`;
            contexto += `    Descripción: ${ep.descripcion}\n`;
            contexto += `    Método: ${ep.metodo}\n`;
            contexto += `    Parámetros: ${JSON.stringify(ep.parametros.map(p => ({
              nombre: p.nombre,
              tipo: p.tipo,
              obligatorio: p.obligatorio,
              estructura: p.estructura
            })), null, 2)}\n\n`;
          });
        }
      }
    }
    
    return contexto;
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
   * Busca un endpoint por su ruta en un módulo específico
   */
  private buscarEndpointPorRuta(modulo: string, ruta: string): Endpoint | null {
    const moduloConfig = this.config.modulos.find(m => m.nombre === modulo);
    if (!moduloConfig) return null;

    for (const accion of this.accionesDisponibles) {
      const endpoint = moduloConfig[accion].find(ep => ep.endpoint === ruta);
      if (endpoint) return endpoint;
    }

    return null;
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
      respuestaIA.accion = 'leer';
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

    // 3. Verificar que el endpoint existe en el módulo
    let endpoint: Endpoint | null = null;
    
    if (respuestaIA.endpoint) {
      endpoint = this.buscarEndpointPorRuta(respuestaIA.modulo, respuestaIA.endpoint);
    }

    // 4. Si no hay endpoint válido, tomar el primero disponible
    if (!endpoint) {
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

      endpoint = endpoints[0];
    }

    // 5. Construir payload
    let payload = respuestaIA.payload;
    
    if (!payload || Object.keys(payload).length === 0) {
      payload = this.construirPayloadDesdeMensaje(endpoint, mensajeUsuario);
    }

    // 6. Validar payload (opcional - podemos omitir validación estricta)
    const validacion = validarPayload(endpoint, payload);
    
    // Completar campos faltantes con valores por defecto
    if (validacion.faltantes.length > 0 || validacion.erroresTipo.length > 0) {
      payload = this.completarPayloadFaltante(endpoint, payload);
    }

    // 7. Construir respuesta
    const urlCompleta = `${this.config.empresa.baseUrl}${endpoint.endpoint}`;
    
    return {
      tipo: 'ACCION',
      mensaje: `✅ ${respuestaIA.mensaje || `Voy a ${this.obtenerVerboAccion(respuestaIA.accion)} en ${respuestaIA.modulo}`}`,
      modulo: respuestaIA.modulo,
      accion: respuestaIA.accion,
      endpoint: endpoint.endpoint,
      urlCompleta: urlCompleta,
      payload: payload,
      method: endpoint.metodo,
      requiereFiltros: false,
      endpointId: endpoint.id
    };
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
   * Construye un payload basado en el mensaje del usuario
   */
  private construirPayloadDesdeMensaje(endpoint: Endpoint, mensaje: string): any {
    const payload: any = {};
    
    endpoint.parametros.forEach(param => {
      if (param.estructura?.esObjeto) {
        payload[param.nombre] = {};
        param.estructura.propiedades?.forEach(prop => {
          const valorExtraido = this.extraerValorDeMensaje(mensaje, prop.nombre);
          
          if (prop.tipo === 'string') {
            payload[param.nombre][prop.nombre] = valorExtraido !== null ? valorExtraido : '';
          } else if (prop.tipo === 'int') {
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
    
    return payload;
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
            if (prop.tipo === 'string') {
              payloadCompleto[param.nombre][prop.nombre] = '';
            } else if (prop.tipo === 'int') {
              payloadCompleto[param.nombre][prop.nombre] = 0;
            } else if (prop.tipo === 'boolean') {
              payloadCompleto[param.nombre][prop.nombre] = false;
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

  /**
   * Extrae un valor del mensaje del usuario
   */
  private extraerValorDeMensaje(mensaje: string, nombreCampo: string): string | null {
    const mensajeLower = mensaje.toLowerCase();
    const campoLower = nombreCampo.toLowerCase()
      .replace('t_', '')
      .replace('str_', '')
      .replace('_', '');
    
    // Patrones generales de extracción
    const patrones = [
      new RegExp(`${campoLower}\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\\s]+)`, 'i'),
      new RegExp(`([a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\\s]+)\\s+${campoLower}`, 'i'),
      new RegExp(`con\\s+${campoLower}\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\\s]+)`, 'i'),
      new RegExp(`de\\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\\s]+)`, 'i'),
      new RegExp(`:?\\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\\s]+)$`, 'i')
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