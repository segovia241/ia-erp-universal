import { ERPConfigEndpoint, ERPConfigService } from "../erp/erp-config.service";
import { IALocalInput, IALocalOutput } from "./types";
import { ConfigLoader } from "./config-loader-core";
import { ConfigMapping } from "./config-mapping";
import { calculateSimilarity, getKeywordScore } from "./utils";

export class IALocalService {
  private erpConfigService = new ERPConfigService();
  private configLoader: ConfigLoader;

  constructor(config?: ConfigMapping) {
    this.configLoader = config ? new ConfigLoader(config) : this.loadConfigFromFile();
  }

  private loadConfigFromFile(): ConfigLoader {
    try {
      const fs = require('fs');
      const path = require('path');

      const configPath = path.join(__dirname, 'config-mapping.json');
      if (!configPath) return this.createFallbackConfig();

      const configData = fs.readFileSync(configPath, 'utf-8');
      const config: ConfigMapping = JSON.parse(configData);
      return new ConfigLoader(config);
    } catch {
      return this.createFallbackConfig();
    }
  }

  private createFallbackConfig(): ConfigLoader {
    return new ConfigLoader({
      version: "1.0.0-fallback",
      settings: {
        umbralMinimoConfianza: 0.2
      },
      normalizacion: {
        correccionesOrtograficas: {},
        eliminarPalabras: [],
        palabrasVacias: []
      },
      vocabulario: {
        modulos: {},
        acciones: {}
      },
      patrones: {
        detectarAccion: {},
        detectarModulo: {},
        extraerParametros: {}
      },
      puntuacion: {
        modulo: {
          coincidenciaExacta: 1,
          coincidenciaPalabraCompleta: 1,
          coincidenciaParcial: 0.5,
          palabraRelacionada: 0.2,
          umbralMinimo: 0.5
        },
        accion: {
          coincidenciaExacta: 1,
          coincidenciaPalabraCompleta: 1,
          coincidenciaParcial: 0.5,
          expresionTipica: 0.5,
          umbralMinimo: 0.5
        }
      },
      defaults: {
        moduloPorDefecto: "VENTAS",
        accionPorDefecto: "READ"
      }
    });
  }

  interpretModuleCRUD(input: IALocalInput): { module: string; action: "CREATE" | "READ" | "UPDATE" | "DELETE" } {
    const msgNormalizada = this.configLoader.normalizarTexto(input.message);
    
    // Usar el detectarMejorAccion del ConfigLoader que ya está configurado
    const { accion: mejorAccion, puntuacion: puntuacionAccion } = this.configLoader.detectarMejorAccion(msgNormalizada);
    
    const modulos = input.context.permisos.modulos;
    const candidates = modulos.map(mod => {
      const puntuacionModulo = this.configLoader.calcularPuntuacionModulo(msgNormalizada, mod);
      const scoreTotal = puntuacionModulo + puntuacionAccion;
      
      return { module: mod, action: mejorAccion as "CREATE" | "READ" | "UPDATE" | "DELETE", score: scoreTotal };
    });

    candidates.sort((a, b) => b.score - a.score);
    const mejor = candidates[0];
    if (mejor.score >= this.configLoader.getUmbralMinimoConfianza()) {
      return { module: mejor.module, action: mejor.action };
    }
    throw new Error(`No se pudo detectar módulo/acción. Mejor score: ${mejor?.score || 0}`);
  }

  interpretEndpoint(input: IALocalInput, module: string, action: "CREATE" | "READ" | "UPDATE" | "DELETE") {
    const msgNormalizada = this.configLoader.normalizarTexto(input.message);
    const endpoints = this.erpConfigService.getEndpoints(input.context.erp, module, action);
    if (!endpoints || endpoints.length === 0) throw new Error(`No hay endpoints para ${module}/${action}`);

    const scoredEndpoints = endpoints.map(ep => {
      // Normalizar textos
      const intentText = this.configLoader.normalizarTexto(ep.intencion || "");
      const descText = this.configLoader.normalizarTexto(ep.descripcion || "");
      
      // Calcular similitudes básicas
      const intentMatch = calculateSimilarity(msgNormalizada, intentText);
      const descMatch = calculateSimilarity(msgNormalizada, descText);
      
      // Calcular coincidencia de palabras clave considerando sinónimos
      const keywordScore = this.calcularKeywordScoreConSinonimos(msgNormalizada, descText);
      
      // Ponderaciones ajustadas (más peso a keywords y descripción)
      const pesoIntencion = 0.3;    // Reducido
      const pesoDescripcion = 0.4;  // Mantenido  
      const pesoKeywords = 0.3;     // Aumentado
      
      const scoreTotal = intentMatch * pesoIntencion + 
                        descMatch * pesoDescripcion + 
                        keywordScore * pesoKeywords;
      
      return { endpoint: ep, score: scoreTotal };
    });

    scoredEndpoints.sort((a, b) => b.score - a.score);
    const mejorEndpoint = scoredEndpoints[0];
    
    // Umbral ajustado basado en la configuración
    const umbralEndpoint = 0.2;
    if (mejorEndpoint.score < umbralEndpoint) {
      throw new Error(`No se encontró endpoint con suficiente coincidencia`);
    }

    const payload = { ...mejorEndpoint.endpoint.payload };
    Object.keys(payload).forEach(key => {
      const valorExtraido = this.configLoader.extraerParametro(msgNormalizada, key);
      if (valorExtraido) payload[key] = valorExtraido;
    });

    return { 
      endpoint: mejorEndpoint.endpoint.endpoint, 
      payload, 
      endpointConfig: mejorEndpoint.endpoint, 
      confidence: mejorEndpoint.score 
    };
  }

  private calcularKeywordScoreConSinonimos(texto: string, descripcion: string): number {
    // Normalizar y dividir en palabras
    const textoPalabras = texto.split(/\s+/).filter(w => w.length > 2);
    const descPalabras = descripcion.split(/\s+/).filter(w => w.length > 2);
    
    if (descPalabras.length === 0) return 0;
    
    let coincidencias = 0;
    
    // Buscar coincidencias directas
    textoPalabras.forEach(palabra => {
      if (descPalabras.includes(palabra)) {
        coincidencias++;
      }
    });
    
    // También considerar coincidencias parciales (para casos como "ids" -> "IDs")
    textoPalabras.forEach(palabra => {
      descPalabras.forEach(descPalabra => {
        if (palabra.includes(descPalabra) || descPalabra.includes(palabra)) {
          coincidencias += 0.5;
        }
      });
    });
    
    // Normalizar el score
    return Math.min(coincidencias / Math.max(1, descPalabras.length), 1);
  }

  async interpret(input: IALocalInput): Promise<IALocalOutput> {
    const { module, action } = this.interpretModuleCRUD(input);
    const { endpoint, payload, endpointConfig, confidence } = this.interpretEndpoint(input, module, action);
    return { 
      module, 
      action, 
      endpoint, 
      payload, 
      preview: endpointConfig.tipo_salida === "preview" ? payload : {}, 
      method: endpointConfig.metodo as "GET" | "POST" | "PUT" | "DELETE", 
      endpointConfig, 
      confidence 
    };
  }
}

export function createIALocalService(configPath?: string): IALocalService {
  try {
    if (configPath) {
      const fs = require('fs');
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config: ConfigMapping = JSON.parse(configData);
      return new IALocalService(config);
    }
  } catch {}
  return new IALocalService();
}