// schemas/ia-response.schema.ts
import { Endpoint } from "../../erp/configs/api-config";

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
  endpointsDisponibles?: Endpoint[]; // Ahora usa el tipo de api-config
}