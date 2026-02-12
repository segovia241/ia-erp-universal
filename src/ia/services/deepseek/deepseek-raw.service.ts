// services/deepseek-raw.service.ts
import axios from "axios";
import { IAResponseSchema } from "../../schemas/endpoint.schema";
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
   * Genera el system prompt dinámico con los módulos disponibles
   */
  private generarSystemPrompt(): string {
    const listaModulos = this.modulosDisponibles
      .map(mod => `   - ${mod}`)
      .join('\n');

    return `
Eres un asistente inteligente dentro de un ERP.
Debes clasificar cada mensaje en uno de estos dos tipos:

1. CONVERSACION: Cuando el usuario solo quiere hablar, saludar, preguntar cómo estás, o cualquier consulta que NO requiera ejecutar una acción en el sistema.
   Ejemplos: "hola", "cómo estás?", "qué puedes hacer?", "gracias"

2. ACCION: Cuando el usuario quiere realizar una operación, consultar datos, modificar información, o cualquier solicitud que requiera usar un endpoint del sistema.
   Ejemplos: "listar pacientes", "buscar citas de mañana", "crear nuevo paciente"

============================================================
MÓDULOS DISPONIBLES EN EL SISTEMA:
${listaModulos}

SOLO puedes usar estos nombres de módulos, exactamente como están escritos.
============================================================

ACCIONES CRUD DISPONIBLES:
   - leer
   - crear
   - actualizar
   - eliminar

Tu respuesta DEBE ser estrictamente JSON con esta estructura:

{
  "tipo": "CONVERSACION" | "ACCION",
  "mensaje": "Tu respuesta amigable al usuario",
  "modulo": "solo si es ACCION, el nombre EXACTO del módulo de la lista disponible",
  "accion": "solo si es ACCION, la acción CRUD (leer|crear|actualizar|eliminar)",
  "payload": { 
    /* solo si es ACCION, los datos inferidos del mensaje 
       Ejemplo: { "oEntity": { "T_Descripcion": "Pérez" } } 
    */
  }
}

REGLAS CRÍTICAS:
1. Si es CONVERSACION: SOLO enviar tipo y mensaje
2. Si es ACCION: 
   - El módulo DEBE ser exactamente uno de la lista proporcionada
   - La acción DEBE ser exactamente: leer, crear, actualizar o eliminar
   - El payload debe contener los parámetros inferidos del mensaje
3. Si el usuario no especifica un módulo, pregúntale cuál módulo necesita
4. Si el usuario menciona un módulo que no está en la lista, indícale que no está disponible
5. NO agregues explicaciones, texto adicional ni código fuera del JSON

IMPORTANTE: Los nombres de los módulos deben ser escritos EXACTAMENTE como aparecen en la lista.
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
   * Formatea los errores de validación en un mensaje amigable para el usuario
   */
  private formatearErroresValidacion(
    endpoint: Endpoint,
    validacion: { faltantes: string[]; erroresTipo: string[]; erroresEstructura: string[] }
  ): string {
    const mensajes: string[] = [];

    if (validacion.faltantes.length > 0) {
      mensajes.push(`❌ Faltan parámetros obligatorios: ${validacion.faltantes.join(', ')}`);
    }

    if (validacion.erroresTipo.length > 0) {
      mensajes.push(`❌ Tipo de dato incorrecto en: ${validacion.erroresTipo.join(', ')}`);
    }

    if (validacion.erroresEstructura.length > 0) {
      mensajes.push(`❌ Errores en estructura: ${validacion.erroresEstructura.join(', ')}`);
    }

    // Agregar ayuda sobre los parámetros esperados
    mensajes.push('\n📋 Parámetros esperados:');
    endpoint.parametros.forEach(param => {
      const obligatorio = param.obligatorio ? '🔴 Obligatorio' : '🟢 Opcional';
      mensajes.push(`  - ${param.nombre} (${param.tipo}) ${obligatorio}`);
      
      if (param.estructura?.esObjeto && param.estructura.propiedades) {
        param.estructura.propiedades.forEach(prop => {
          const propObligatorio = prop.opcional ? 'opcional' : 'obligatorio';
          mensajes.push(`    • ${prop.nombre}: ${prop.tipo} (${propObligatorio})`);
        });
      }
    });

    return mensajes.join('\n');
  }

  /**
   * Procesa una acción: valida módulo, busca endpoints y valida payload
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
        requiereFiltros: true,
        accion: respuestaIA.accion
      };
    }

    const validacionModulo = this.validarModulo(respuestaIA.modulo);
    if (!validacionModulo.valido) {
      return {
        tipo: 'ACCION',
        mensaje: validacionModulo.mensaje!,
        requiereFiltros: true,
        modulo: respuestaIA.modulo,
        accion: respuestaIA.accion
      };
    }

    // 2. Validar acción
    const validacionAccion = this.validarAccion(respuestaIA.accion!);
    if (!validacionAccion.valido) {
      return {
        tipo: 'ACCION',
        mensaje: validacionAccion.mensaje!,
        requiereFiltros: true,
        modulo: respuestaIA.modulo,
        accion: respuestaIA.accion
      };
    }

    // 3. Buscar endpoints usando la función real
    const resultadoBusqueda = obtenerEndpointsPorModuloYAccion(
      respuestaIA.modulo,
      respuestaIA.accion!
    );

    if (!resultadoBusqueda.success) {
      return {
        tipo: 'ACCION',
        mensaje: resultadoBusqueda.message,
        requiereFiltros: true,
        modulo: respuestaIA.modulo,
        accion: respuestaIA.accion
      };
    }

    // 4. Si encontramos múltiples endpoints, necesitamos más información
    if (resultadoBusqueda.totalEndpoints && resultadoBusqueda.totalEndpoints > 1) {
      const modulosEncontrados = resultadoBusqueda.data || [];
      const listaEndpoints = modulosEncontrados
        .flatMap(m => m.endpoints)
        .map((ep, index) => `  ${index + 1}. ${ep.nombreReferencia}: ${ep.descripcion}`)
        .join('\n');

      return {
        tipo: 'ACCION',
        mensaje: `En el módulo **${respuestaIA.modulo}** encontré varias operaciones de **${respuestaIA.accion}**:\n\n${listaEndpoints}\n\n¿Cuál de ellas deseas realizar? (responde con el número o nombre)`,
        requiereFiltros: true,
        modulo: respuestaIA.modulo,
        accion: respuestaIA.accion,
        endpointsDisponibles: modulosEncontrados.flatMap(m => m.endpoints)
      };
    }

    // 5. Tenemos un endpoint específico
    const endpoint = resultadoBusqueda.data![0].endpoints[0];
    
    // 6. Validar el payload contra los parámetros del endpoint
    const validacion = validarPayload(endpoint, respuestaIA.payload || {});

    // 7. Si hay errores de validación
    if (validacion.faltantes.length > 0 || 
        validacion.erroresTipo.length > 0 || 
        validacion.erroresEstructura.length > 0) {
      
      const mensajeError = this.formatearErroresValidacion(endpoint, validacion);
      
      return {
        tipo: 'ACCION',
        mensaje: `⚠️ No puedo ejecutar la acción en **${respuestaIA.modulo}** porque faltan datos o son incorrectos:\n\n${mensajeError}`,
        endpoint: endpoint.endpoint,
        method: endpoint.metodo,
        requiereFiltros: true,
        filtrosFaltantes: [...validacion.faltantes, ...validacion.erroresTipo, ...validacion.erroresEstructura],
        modulo: respuestaIA.modulo,
        accion: respuestaIA.accion,
        endpointId: endpoint.id
      };
    }

    // 8. Todo está bien, podemos ejecutar la acción
    const urlCompleta = `${this.config.empresa.baseUrl}${endpoint.endpoint}`;
    
    return {
      tipo: 'ACCION',
      mensaje: `✅ **${respuestaIA.modulo}**: ${respuestaIA.mensaje || `Voy a ${respuestaIA.accion} los datos`}`,
      endpoint: endpoint.endpoint,
      urlCompleta: urlCompleta,
      payload: respuestaIA.payload,
      method: endpoint.metodo,
      requiereFiltros: false,
      modulo: respuestaIA.modulo,
      accion: respuestaIA.accion,
      endpointId: endpoint.id
    };
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

    // 3. Si es acción, procesar con la configuración real
    if (respuestaInicial.tipo === 'ACCION') {
      return await this.procesarAccion(message, respuestaInicial);
    }

    return respuestaInicial;
  }

  /**
   * Método para obtener la lista de módulos disponibles
   */
  public getModulosDisponibles(): string[] {
    return [...this.modulosDisponibles];
  }

  /**
   * Método para obtener información de la empresa
   */
  public getInfoEmpresa(): { nombre: string; baseUrl: string } {
    return {
      nombre: this.config.empresa.nombre,
      baseUrl: this.config.empresa.baseUrl
    };
  }
}