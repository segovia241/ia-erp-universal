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
  private readonly accionesDisponibles = ["leer", "crear", "actualizar", "eliminar"] as const;
  type AccionCRUD = typeof this.accionesDisponibles[number];

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
   * Genera el system prompt dinámico con la ESTRUCTURA EXACTA de cada endpoint
   */
  private generarSystemPrompt(): string {
    const listaModulos = this.modulosDisponibles
      .map(mod => `   - ${mod}`)
      .join('\n');

    const contextoEndpoints = this.generarContextoEndpointsConEstructuraExacta();

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
ENDPOINTS DISPONIBLES CON SU ESTRUCTURA EXACTA DE PAYLOAD:
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
    // EL PAYLOAD DEBE SER EXACTAMENTE IGUAL A LA ESTRUCTURA MOSTRADA ARRIBA
    // NO inventes nombres de campos, USA LOS NOMBRES EXACTOS de los parámetros
    // RESPETA la estructura anidada de los objetos
  }
}

REGLAS CRÍTICAS - OBLIGATORIAS:
1. SIEMPRE debes seleccionar UN endpoint específico, NUNCA preguntar
2. El endpoint debe ser el MÁS RELEVANTE para lo que pide el usuario
3. El payload debe tener EXACTAMENTE la misma estructura que el endpoint requiere
4. NO inventes nombres de campos - USA los nombres exactos de los parámetros
5. Si el endpoint espera un objeto anidado, DEBES enviar ese objeto anidado
6. NUNCA devuelvas una lista de endpoints - SIEMPRE uno específico
7. NO agregues texto fuera del JSON

IMPORTANTE: 
- Respeta la estructura anidada de los objetos
- Usa los nombres de campos EXACTOS que aparecen en la descripción del endpoint
- Si el parámetro es un objeto, DEBE ir dentro de ese objeto
- Ejemplo: { "oEntity": { "T_Descripcion": "valor" } } NO { "apellido": "valor" }
`;
  }

  /**
   * Genera un string con TODOS los endpoints y su ESTRUCTURA EXACTA de payload
   */
  private generarContextoEndpointsConEstructuraExacta(): string {
    let contexto = '';
    
    for (const modulo of this.config.modulos) {
      contexto += `\n========== MÓDULO: ${modulo.nombre} ==========\n`;
      
      for (const accion of this.accionesDisponibles) {
        const endpoints = modulo[accion] as Endpoint[];
        if (endpoints && endpoints.length > 0) {
          contexto += `\n--- ACCIÓN: ${accion.toUpperCase()} ---\n`;
          endpoints.forEach((ep: Endpoint) => {
            contexto += `\n📌 ENDPOINT: ${ep.endpoint}\n`;
            contexto += `   Nombre: ${ep.nombreReferencia}\n`;
            contexto += `   Descripción: ${ep.descripcion}\n`;
            contexto += `   Método: ${ep.metodo}\n`;
            contexto += `\n   📦 ESTRUCTURA EXACTA DEL PAYLOAD:\n`;
            
            // Mostrar la estructura EXACTA que debe enviarse
            ep.parametros.forEach((param: any) => {
              if (param.estructura?.esObjeto) {
                contexto += `   {\n`;
                contexto += `     "${param.nombre}": {\n`;
                param.estructura.propiedades?.forEach((prop: any) => {
                  contexto += `       "${prop.nombre}": "${prop.tipo}"${prop.opcional ? ' (opcional)' : ' (obligatorio)'}\n`;
                });
                contexto += `     }\n`;
                contexto += `   }\n`;
                
                // EJEMPLO CONCRETO con valores de ejemplo
                contexto += `\n   ✅ EJEMPLO DE PAYLOAD CORRECTO:\n`;
                contexto += `   {\n`;
                contexto += `     "${param.nombre}": {\n`;
                param.estructura.propiedades?.forEach((prop: any, index: number) => {
                  let valorEjemplo = '';
                  if (prop.tipo === 'string') valorEjemplo = '"texto de búsqueda"';
                  if (prop.tipo === 'int') valorEjemplo = '123';
                  if (prop.tipo === 'boolean') valorEjemplo = 'false';
                  contexto += `       "${prop.nombre}": ${valorEjemplo}`;
                  if (index < param.estructura!.propiedades!.length - 1) contexto += `,`;
                  contexto += `\n`;
                });
                contexto += `     }\n`;
                contexto += `   }\n`;
                
              } else {
                contexto += `   {\n`;
                contexto += `     "${param.nombre}": "${param.tipo}"\n`;
                contexto += `   }\n`;
              }
            });
            contexto += `\n${'─'.repeat(80)}\n`;
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

    if (!this.accionesDisponibles.includes(accion as AccionCRUD)) {
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
      const endpoints = moduloConfig[accion] as Endpoint[];
      const endpoint = endpoints.find((ep: Endpoint) => ep.endpoint === ruta);
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

    // 5. Construir payload con la estructura correcta
    let payload = respuestaIA.payload;
    
    if (!payload || Object.keys(payload).length === 0) {
      payload = this.construirPayloadDesdeMensaje(endpoint, mensajeUsuario);
    } else {
      // Asegurar que el payload tenga la estructura correcta
      payload = this.normalizarPayload(endpoint, payload, mensajeUsuario);
    }

    // 6. Construir respuesta
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
   * Normaliza el payload para que tenga la estructura correcta según el endpoint
   */
  private normalizarPayload(endpoint: Endpoint, payloadRecibido: any, mensajeUsuario: string): any {
    const payloadNormalizado: any = {};
    
    endpoint.parametros.forEach((param: any) => {
      if (param.estructura?.esObjeto) {
        // Si el payload ya tiene el objeto, usarlo, si no crearlo
        payloadNormalizado[param.nombre] = payloadRecibido[param.nombre] || {};
        
        param.estructura.propiedades?.forEach((prop: any) => {
          // Si la propiedad ya existe en el payload recibido, mantenerla
          if (payloadRecibido[param.nombre]?.[prop.nombre]) {
            payloadNormalizado[param.nombre][prop.nombre] = payloadRecibido[param.nombre][prop.nombre];
          } else {
            // Si no, intentar extraerla del mensaje
            const valorExtraido = this.extraerValorDeMensaje(mensajeUsuario, prop.nombre);
            if (prop.tipo === 'string') {
              payloadNormalizado[param.nombre][prop.nombre] = valorExtraido !== null ? valorExtraido.toUpperCase() : '';
            } else if (prop.tipo === 'int') {
              const valorNumerico = valorExtraido ? parseInt(valorExtraido, 10) : 0;
              payloadNormalizado[param.nombre][prop.nombre] = isNaN(valorNumerico) ? 0 : valorNumerico;
            } else if (prop.tipo === 'boolean') {
              payloadNormalizado[param.nombre][prop.nombre] = false;
            }
          }
        });
      } else {
        // Parámetro simple
        if (payloadRecibido[param.nombre]) {
          payloadNormalizado[param.nombre] = payloadRecibido[param.nombre];
        } else {
          const valorExtraido = this.extraerValorDeMensaje(mensajeUsuario, param.nombre);
          if (param.tipo === 'string') {
            payloadNormalizado[param.nombre] = valorExtraido !== null ? valorExtraido : '';
          } else if (param.tipo === 'int') {
            const valorNumerico = valorExtraido ? parseInt(valExtraido, 10) : 0;
            payloadNormalizado[param.nombre] = isNaN(valorNumerico) ? 0 : valorNumerico;
          } else if (param.tipo === 'boolean') {
            payloadNormalizado[param.nombre] = false;
          }
        }
      }
    });
    
    return payloadNormalizado;
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
   * Construye un payload basado en el mensaje del usuario - CON ESTRUCTURA CORRECTA
   */
  private construirPayloadDesdeMensaje(endpoint: Endpoint, mensaje: string): any {
    const payload: any = {};
    
    endpoint.parametros.forEach((param: any) => {
      if (param.estructura?.esObjeto) {
        // Crear el objeto contenedor
        payload[param.nombre] = {};
        
        // Llenar las propiedades del objeto
        param.estructura.propiedades?.forEach((prop: any) => {
          const valorExtraido = this.extraerValorDeMensaje(mensaje, prop.nombre);
          
          if (prop.tipo === 'string') {
            payload[param.nombre][prop.nombre] = valorExtraido !== null 
              ? valorExtraido.toUpperCase() 
              : '';
          } else if (prop.tipo === 'int') {
            const valorNumerico = valorExtraido ? parseInt(valorExtraido, 10) : 0;
            payload[param.nombre][prop.nombre] = isNaN(valorNumerico) ? 0 : valorNumerico;
          } else if (prop.tipo === 'boolean') {
            payload[param.nombre][prop.nombre] = false;
          }
        });
      } else {
        // Parámetro simple
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
   * Extrae un valor del mensaje del usuario - MEJORADO
   */
  private extraerValorDeMensaje(mensaje: string, nombreCampo: string): string | null {
    const mensajeLower = mensaje.toLowerCase();
    
    // Para T_Descripcion, buscar específicamente después de "apellido", "paciente", etc.
    if (nombreCampo === 'T_Descripcion' || nombreCampo === 'str_nombres' || nombreCampo.includes('descripcion')) {
      const patronesDescripcion = [
        /apellido\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /paciente\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /cliente\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /nombre\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /medico\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
        /usuario\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
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