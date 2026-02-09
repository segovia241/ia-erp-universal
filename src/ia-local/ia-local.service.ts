import { ERPConfigEndpoint, ERPConfigService } from "../erp/erp-config.service";
import { IALocalInput, IALocalOutput } from "./types";
import { ConfigLoader } from "./config-loader-core";
import { ConfigMapping } from "./config-mapping";
import { calculateSimilarity } from "./utils";

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
    
    const { accion: mejorAccion, puntuacion: puntuacionAccion } = this.configLoader.detectarMejorAccion(msgNormalizada);
    
    const puntuacionAccionConfig = this.configLoader.getPuntuacionAccion();
    const accionFinal = puntuacionAccion >= puntuacionAccionConfig.umbralMinimo ? mejorAccion : this.configLoader.getAccionPorDefecto();
    const puntuacionFinal = puntuacionAccion >= puntuacionAccionConfig.umbralMinimo ? puntuacionAccion : 1.0;
    
    const modulos = input.context.permisos.modulos;
    const candidates = modulos.map(mod => {
      const puntuacionModulo = this.configLoader.calcularPuntuacionModulo(msgNormalizada, mod);
      const puntuacionModuloConfig = this.configLoader.getPuntuacionModulo();
      
      if (puntuacionModulo < puntuacionModuloConfig.umbralMinimo) {
        return { module: mod, action: accionFinal as "CREATE" | "READ" | "UPDATE" | "DELETE", score: 0 };
      }
      
      const scoreTotal = puntuacionModulo + puntuacionFinal;
      return { module: mod, action: accionFinal as "CREATE" | "READ" | "UPDATE" | "DELETE", score: scoreTotal };
    });

    candidates.sort((a, b) => b.score - a.score);
    const mejor = candidates[0];
    
    const umbralMinimo = this.configLoader.getUmbralMinimoConfianza();
    if (mejor && mejor.score >= umbralMinimo) {
      return { module: mejor.module, action: mejor.action };
    }
    
    return { 
      module: this.configLoader.getModuloPorDefecto(), 
      action: this.configLoader.getAccionPorDefecto() as "CREATE" | "READ" | "UPDATE" | "DELETE" 
    };
  }

  private calcularRelevanciaMensaje(texto: string, modulo: string, accion: string): number {
    const textoLower = texto.toLowerCase();
    
    const palabrasClaveModulo = this.configLoader.getPalabrasClaveModulo(modulo);
    const palabrasRelacionadasModulo = this.configLoader.getPalabrasRelacionadasModulo(modulo);
    const palabrasClaveAccion = this.configLoader.getPalabrasClaveAccion(accion);
    const sinonimosAccion = this.configLoader.getSinonimosAccion(accion);
    
    const palabrasRelevantes = [
      ...palabrasClaveModulo,
      ...palabrasRelacionadasModulo,
      ...palabrasClaveAccion,
      ...sinonimosAccion
    ].map(p => p.toLowerCase());
    
    const palabrasMensaje = textoLower.split(/\s+/)
      .filter(w => w.length > 2)
      .filter(w => !this.esPalabraVacia(w));
    
    if (palabrasMensaje.length === 0) return 0;
    
    if (this.contienePalabrasIrrelevantesParaERP(textoLower)) {
      return 0.0;
    }
    
    let palabrasRelevantesEncontradas = 0;
    
    palabrasMensaje.forEach(palabra => {
      const esRelevante = palabrasRelevantes.some(relevante => 
        relevante === palabra || 
        relevante.includes(palabra) || 
        palabra.includes(relevante)
      );
      
      if (esRelevante) {
        palabrasRelevantesEncontradas++;
      }
    });
    
    const proporcionRelevantes = palabrasRelevantesEncontradas / palabrasMensaje.length;
    
    if (proporcionRelevantes < 0.6) {
      return proporcionRelevantes * 0.2;
    }
    
    return proporcionRelevantes;
  }

  private contienePalabrasIrrelevantesParaERP(texto: string): boolean {
    const palabrasIrrelevantesERP = [
      "gemini", "gpt", "chatgpt", "openai", "llm", "ia", "inteligencia", "artificial",
      "juegos", "jugar", "videojuego", "diversion", "entretenimiento",
      "abrir", "usar", "llamar", "invocar", "ejecutar", "correr", "probar", "testear",
      "endpoint", "api", "url", "enlace", "link", "direccion", "ruta"
    ];
    
    return palabrasIrrelevantesERP.some(palabra => texto.includes(palabra));
  }

  private esPalabraVacia(palabra: string): boolean {
    const palabrasVaciasConfig = this.configLoader.getPalabrasVacias();
    return palabrasVaciasConfig.includes(palabra.toLowerCase());
  }

  interpretEndpoint(input: IALocalInput, module: string, action: "CREATE" | "READ" | "UPDATE" | "DELETE") {
    const msgNormalizada = this.configLoader.normalizarTexto(input.message);
    const endpoints = this.erpConfigService.getEndpoints(input.context.erp, module, action);
    if (!endpoints || endpoints.length === 0) throw new Error(`No hay endpoints para ${module}/${action}`);

    const scoredEndpoints = endpoints.map(ep => {
      const intentText = this.configLoader.normalizarTexto(ep.intencion || "");
      const descText = this.configLoader.normalizarTexto(ep.descripcion || "");
      
      const intentMatch = calculateSimilarity(msgNormalizada, intentText);
      const descMatch = calculateSimilarity(msgNormalizada, descText);
      const keywordScore = this.calcularKeywordScoreUsandoConfig(msgNormalizada, descText, module, action);
      const endpointMatch = this.calcularCoincidenciaEndpointCorregida(msgNormalizada, ep.endpoint, module, action);
      const relevanciaScore = this.calcularRelevanciaMensaje(msgNormalizada, module, action);
      
      const pesoIntencion = 0.15;
      const pesoDescripcion = 0.15;
      const pesoKeywords = 0.15;
      const pesoEndpoint = 0.15;
      const pesoRelevancia = 0.40;
      
      const puntuacionConfig = this.configLoader.getPuntuacionAccion();
      const scoreIntencion = intentMatch * pesoIntencion * puntuacionConfig.coincidenciaExacta;
      const scoreDescripcion = descMatch * pesoDescripcion * puntuacionConfig.coincidenciaExacta;
      const scoreKeywords = keywordScore * pesoKeywords * puntuacionConfig.coincidenciaPalabraCompleta;
      const scoreEndpoint = endpointMatch * pesoEndpoint * puntuacionConfig.expresionTipica;
      const scoreRelevancia = relevanciaScore * pesoRelevancia;
      
      const scoreTotal = Math.min(scoreIntencion + scoreDescripcion + scoreKeywords + scoreEndpoint + scoreRelevancia, 1.0);
      
      return { endpoint: ep, score: scoreTotal };
    });

    scoredEndpoints.sort((a, b) => b.score - a.score);
    const mejorEndpoint = scoredEndpoints[0];
    
    const umbralEndpoint = this.configLoader.getUmbralMinimoConfianza();
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

  private calcularCoincidenciaEndpointCorregida(texto: string, endpoint: string, modulo: string, accion: string): number {
    const textoLower = texto.toLowerCase();
    const endpointLower = endpoint.toLowerCase();
    
    const palabrasClaveModulo = this.configLoader.getPalabrasClaveModulo(modulo);
    const palabrasRelacionadasModulo = this.configLoader.getPalabrasRelacionadasModulo(modulo);
    const palabrasClaveAccion = this.configLoader.getPalabrasClaveAccion(accion);
    const sinonimosAccion = this.configLoader.getSinonimosAccion(accion);
    
    const palabrasRelevantes = [
      ...palabrasClaveModulo,
      ...palabrasRelacionadasModulo,
      ...palabrasClaveAccion,
      ...sinonimosAccion
    ].map(p => p.toLowerCase());
    
    const partesEndpoint = endpointLower.split(/[\/\-_]/)
      .filter(part => part.length > 2)
      .filter(part => !this.esPalabraTecnica(part));
    
    if (partesEndpoint.length === 0) return 0;
    
    let coincidenciasSignificativas = 0;
    
    partesEndpoint.forEach(parte => {
      const estaEnTexto = textoLower.includes(parte);
      const esPalabraRelevante = palabrasRelevantes.some(palabra => 
        palabra === parte || 
        palabra.includes(parte) || 
        parte.includes(palabra)
      );
      
      if (estaEnTexto && esPalabraRelevante) {
        coincidenciasSignificativas += 1.0;
      } else if (estaEnTexto) {
        coincidenciasSignificativas += 0.1;
      }
    });
    
    const score = coincidenciasSignificativas / Math.max(1, partesEndpoint.length);
    return Math.min(score, 1.0);
  }

  private esPalabraTecnica(palabra: string): boolean {
    const tecnicas = ['api', 'v1', 'v2', 'v3', 'rest', 'json', 'xml', 'http', 'https', 'www'];
    return tecnicas.includes(palabra.toLowerCase());
  }

  private calcularKeywordScoreUsandoConfig(texto: string, descripcion: string, modulo: string, accion: string): number {
    if (!descripcion || descripcion.trim().length === 0) return 0;
    
    const textoLower = texto.toLowerCase();
    const descLower = descripcion.toLowerCase();
    
    const palabrasClaveModulo = this.configLoader.getPalabrasClaveModulo(modulo);
    const palabrasRelacionadasModulo = this.configLoader.getPalabrasRelacionadasModulo(modulo);
    const palabrasClaveAccion = this.configLoader.getPalabrasClaveAccion(accion);
    const sinonimosAccion = this.configLoader.getSinonimosAccion(accion);
    
    const palabrasRelevantes = [
      ...palabrasClaveModulo,
      ...palabrasRelacionadasModulo,
      ...palabrasClaveAccion,
      ...sinonimosAccion
    ].map(p => p.toLowerCase());
    
    if (palabrasRelevantes.length === 0) return 0;
    
    const palabrasDesc = descLower.split(/\s+/).filter(w => w.length > 2);
    
    let coincidencias = 0;
    
    palabrasRelevantes.forEach(palabra => {
      if (palabrasDesc.includes(palabra)) {
        coincidencias += 2.0;
      }
      else if (palabrasDesc.some(pDesc => pDesc.includes(palabra) || palabra.includes(pDesc))) {
        coincidencias += 1.0;
      }
    });
    
    const maxEsperado = palabrasRelevantes.length * 2;
    return Math.min(coincidencias / Math.max(1, maxEsperado), 1);
  }

  async interpret(input: IALocalInput): Promise<IALocalOutput> {
    try {
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
    } catch (error: any) {
      throw error;
    }
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
