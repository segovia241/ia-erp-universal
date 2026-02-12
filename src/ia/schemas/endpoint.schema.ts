// schemas/endpoint.schema.ts
export interface EndpointParameter {
  nombre: string;
  tipo: string;
  obligatorio: boolean;
  opcional: boolean;
  fuente: {
    idReferencia: number;
    nombreReferencia: string;
  };
  estructura: {
    esObjeto: boolean;
    esArray: boolean;
    propiedades?: Array<{
      nombre: string;
      tipo: string;
      opcional: boolean;
    }>;
  };
}

export interface Endpoint {
  id: number;
  endpoint: string;
  nombreReferencia: string;
  descripcion: string;
  metodo: string;
  parametros: EndpointParameter[];
}

export interface IAResponseSchema {
  tipo: 'CONVERSACION' | 'ACCION';
  mensaje: string;
  
  // Campos para ACCION
  modulo?: string;
  accion?: 'leer' | 'crear' | 'actualizar' | 'eliminar';
  endpoint?: string;
  urlCompleta?: string;
  endpointId?: number;
  method?: string;
  payload?: any;
  
  // Campos para validación
  requiereFiltros?: boolean;
  filtrosFaltantes?: string[];
  endpointsDisponibles?: Endpoint[];
}
// schemas/filtros.schema.ts
export interface FiltrosUsuario {
  [key: string]: any;
}