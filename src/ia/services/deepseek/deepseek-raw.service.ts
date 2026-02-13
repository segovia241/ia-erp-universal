// src/ia/services/deepseek/deepseek-raw.service.ts
import axios from "axios";
import { IAResponseSchema } from "../../schemas/ia-response.schema";
import {
    cargarConfiguracion,
    obtenerEndpointsPorModuloYAccion,
    validarPayload
} from "../../../erp/configs/api-config";
import {
    Endpoint,
    ConfiguracionAPI,
    ModuloConAcciones,
    AccionCRUD
} from "./api-config.types";

export class DeepSeekRawService {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private config: ConfiguracionAPI;
    private readonly modulosDisponibles: string[];
    private readonly accionesDisponibles: AccionCRUD[] = ["leer", "crear", "actualizar", "eliminar"];

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
    private obtenerEndpointsPorModuloYAccion(modulo: string, accion: AccionCRUD): Endpoint[] {
        const resultado = obtenerEndpointsPorModuloYAccion(modulo, accion);
        if (resultado.success && resultado.data) {
            return resultado.data.flatMap(m => m.endpoints);
        }
        return [];
    }

    /**
     * Genera el system prompt dinámico con la ESTRUCTURA EXACTA de cada endpoint
     * LA IA es la única responsable de entender y extraer valores
     */
    private generarSystemPrompt(): string {
        const listaModulos = this.modulosDisponibles
            .map(mod => `   - ${mod}`)
            .join('\n');

        const contextoEndpoints = this.generarContextoEndpoints();

        return `
Eres un asistente inteligente dentro de un ERP.
Tu función es CLASIFICAR cada mensaje en CONVERSACION o ACCION.

============================================================
MÓDULOS DISPONIBLES:
${listaModulos}
============================================================

CLASIFICACIÓN DE MENSAJES:

1. CONVERSACION - Cuando el usuario:
   - Pregunta por los módulos disponibles
   - Saluda (hola, buenos días, qué tal)
   - Pregunta cómo estás
   - Pregunta qué puedes hacer
   - Agradece
   - Se despide
   - Pide ayuda general
   - EJEMPLOS: "hola", "qué módulos hay", "módulos disponibles", "qué puedes hacer", "gracias", "chao"

2. ACCION - Cuando el usuario:
   - Quiere listar, buscar, crear, actualizar o eliminar datos de negocio
   - Menciona entidades de negocio (pacientes, médicos, clientes, usuarios, documentos, monedas, formas de pago, etc.)
   - Especifica un módulo Y una operación CRUD
   - EJEMPLOS: "listar pacientes", "crear usuario", "buscar cliente", "obtener monedas"

============================================================
REGLAS CRÍTICAS DE CLASIFICACIÓN:

❌ SI el usuario pregunta por los MÓDULOS DISPONIBLES:
   - Es CONVERSACION, NUNCA ACCION
   - NO selecciones un endpoint
   - SOLO responde con la lista de módulos

✅ SOLO clasifica como ACCION si el usuario pide una operación de negocio específica

============================================================
ENDPOINTS DISPONIBLES (SOLO PARA ACCIONES DE NEGOCIO):

${contextoEndpoints}
============================================================

⚠️ INSTRUCCIONES CRÍTICAS PARA ACCIONES:

1. **TÚ eres responsable de ENTENDER el mensaje del usuario**
2. **TÚ debes EXTRAER los valores del mensaje**
3. **TÚ debes CONSTRUIR el payload con la estructura exacta**

📌 EJEMPLO DE RESPUESTA CORRECTA:

Usuario: "listame pacientes"
{
  "tipo": "ACCION",
  "mensaje": "Voy a listar los pacientes para ti",
  "modulo": "Clinico",
  "accion": "leer",
  "endpoint": "/Servicios/Clinico/WCF_Tsm_Pacientes.svc/F_Listar_Autocomplete",
  "method": "POST",
  "payload": {
    "oEntity": {
      "T_Descripcion": ""  // Vacío = listar todos
    }
  }
}

Usuario: "buscar paciente Juan Pérez"
{
  "tipo": "ACCION",
  "mensaje": "Buscaré al paciente Juan Pérez",
  "modulo": "Clinico",
  "accion": "leer",
  "endpoint": "/Servicios/Clinico/WCF_Tsm_Pacientes.svc/F_Listar_Autocomplete",
  "method": "POST",
  "payload": {
    "oEntity": {
      "T_Descripcion": "JUAN PÉREZ"  // Valor extraído del mensaje
    }
  }
}

============================================================
RESPUESTA ESPERADA:

--- PARA CONVERSACION ---
{
  "tipo": "CONVERSACION",
  "mensaje": "Tu respuesta amigable al usuario"
}

--- PARA ACCION ---
{
  "tipo": "ACCION",
  "mensaje": "Respuesta natural al usuario indicando qué vas a hacer",
  "modulo": "Nombre EXACTO del módulo",
  "accion": "leer|crear|actualizar|eliminar",
  "endpoint": "Ruta COMPLETA del endpoint seleccionado",
  "method": "POST|GET|PUT|DELETE",
  "payload": {
    // ✅ TÚ debes construir la estructura EXACTA según la configuración
    // ✅ TÚ debes extraer los valores del mensaje del usuario
    // ✅ Si no hay valor para un campo, usa valor por defecto ("" para string, 0 para int, false para boolean)
  }
}

============================================================
REGLAS OBLIGATORIAS:
1. SIEMPRE debes incluir payload en las ACCIONES
2. El payload debe tener la ESTRUCTURA EXACTA definida en la configuración
3. Debes EXTRAER los valores del mensaje del usuario
4. Si no hay valor para un campo, usa valor por defecto
5. NUNCA agregues texto fuera del JSON
6. SI no entiendes el mensaje, responde CONVERSACION pidiendo aclaración
`;
    }

    /**
     * Genera un string con TODOS los endpoints y su ESTRUCTURA EXACTA de payload
     * SIN hardcodeo - SOLO muestra la configuración real
     */
    private generarContextoEndpoints(): string {
        let contexto = '';

        for (const modulo of this.config.modulos) {
            const moduloConAcciones = modulo as ModuloConAcciones;
            contexto += `\n========== MÓDULO: ${modulo.nombre} ==========\n`;

            for (const accion of this.accionesDisponibles) {
                const endpoints = moduloConAcciones[accion];
                if (endpoints && endpoints.length > 0) {
                    contexto += `\n--- ACCIÓN: ${accion.toUpperCase()} ---\n`;
                    endpoints.forEach((ep: Endpoint) => {
                        contexto += `\n📍 ENDPOINT: ${ep.endpoint}\n`;
                        contexto += `   Nombre: ${ep.nombreReferencia}\n`;
                        contexto += `   Descripción: ${ep.descripcion}\n`;
                        contexto += `   Método: ${ep.metodo}\n`;
                        contexto += `\n   📦 ESTRUCTURA EXACTA DEL PAYLOAD:\n`;

                        // Mostrar la estructura EXACTA que DEBE construir la IA
                        ep.parametros.forEach((param: any) => {
                            if (param.estructura?.esObjeto) {
                                contexto += `   {\n`;
                                contexto += `     "${param.nombre}": {\n`;
                                param.estructura.propiedades?.forEach((prop: any) => {
                                    const valorPorDefecto = this.obtenerValorPorDefecto(prop.tipo);
                                    contexto += `       "${prop.nombre}": ${valorPorDefecto}  // ${prop.tipo}${prop.opcional ? ' (opcional)' : ' (obligatorio)'}\n`;
                                });
                                contexto += `     }\n`;
                                contexto += `   }\n`;
                            } else {
                                const valorPorDefecto = this.obtenerValorPorDefecto(param.tipo);
                                contexto += `   { "${param.nombre}": ${valorPorDefecto} }  // ${param.tipo}\n`;
                            }
                        });
                        contexto += `\n${'─'.repeat(80)}\n`;
                    });
                }
            }
        }

        return contexto;
    }

    /**
     * Obtiene el valor por defecto según el tipo de dato
     */
    private obtenerValorPorDefecto(tipo: string): string {
        switch (tipo?.toLowerCase()) {
            case 'string':
                return '""';
            case 'int':
            case 'number':
                return '0';
            case 'boolean':
                return 'false';
            case 'object':
                return '{}';
            case 'array':
                return '[]';
            default:
                return 'null';
        }
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
        const moduloConfig = this.config.modulos.find(m => m.nombre === modulo) as ModuloConAcciones | undefined;
        if (!moduloConfig) return null;

        for (const accion of this.accionesDisponibles) {
            const endpoints = moduloConfig[accion];
            const endpoint = endpoints.find((ep: Endpoint) => ep.endpoint === ruta);
            if (endpoint) return endpoint;
        }

        return null;
    }

    /**
     * Procesa una acción - AHORA LA IA ES RESPONSABLE DEL PAYLOAD COMPLETO
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
            const endpoints = this.obtenerEndpointsPorModuloYAccion(
                respuestaIA.modulo,
                respuestaIA.accion as AccionCRUD
            );

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

        // 5. ✅ VALIDAR que la IA haya enviado payload
        if (!respuestaIA.payload || Object.keys(respuestaIA.payload).length === 0) {
            return {
                tipo: 'ACCION',
                mensaje: `No pude determinar los filtros de búsqueda. ¿Qué específicamente quieres buscar en ${respuestaIA.modulo}?`,
                requiereFiltros: true,
                modulo: respuestaIA.modulo,
                accion: respuestaIA.accion,
                endpoint: endpoint.endpoint,
                method: endpoint.metodo
            };
        }

        // 6. ✅ VALIDAR que el payload tenga la estructura correcta
        const validacionPayload = this.validarEstructuraPayload(endpoint, respuestaIA.payload);
        if (!validacionPayload.valido) {
            return {
                tipo: 'ACCION',
                mensaje: validacionPayload.mensaje,
                requiereFiltros: true,
                modulo: respuestaIA.modulo,
                accion: respuestaIA.accion,
                endpoint: endpoint.endpoint,
                method: endpoint.metodo,
                payload: respuestaIA.payload
            };
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
            payload: respuestaIA.payload,  // ✅ USAMOS EL PAYLOAD DE LA IA
            method: endpoint.metodo,
            requiereFiltros: false,
            endpointId: endpoint.id
        };
    }

    /**
     * Valida que el payload tenga la estructura correcta según el endpoint
     */
    private validarEstructuraPayload(endpoint: Endpoint, payload: any): { valido: boolean; mensaje: string } {
        if (!payload) {
            return {
                valido: false,
                mensaje: "El payload no puede estar vacío"
            };
        }

        for (const param of endpoint.parametros) {
            if (param.estructura?.esObjeto) {
                // Validar que exista el objeto contenedor
                if (!payload[param.nombre]) {
                    return {
                        valido: false,
                        mensaje: `El payload debe incluir '${param.nombre}' como objeto contenedor`
                    };
                }

                // Validar propiedades obligatorias
                for (const prop of param.estructura.propiedades || []) {
                    if (!prop.opcional && payload[param.nombre][prop.nombre] === undefined) {
                        return {
                            valido: false,
                            mensaje: `El campo '${prop.nombre}' es obligatorio en ${param.nombre}`
                        };
                    }
                }
            } else {
                // Parámetro simple
                if (!param.opcional && payload[param.nombre] === undefined) {
                    return {
                        valido: false,
                        mensaje: `El campo '${param.nombre}' es obligatorio`
                    };
                }
            }
        }

        return { valido: true, mensaje: "Estructura válida" };
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