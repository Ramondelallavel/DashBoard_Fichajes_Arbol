import type { Role } from '../domain/types';

/**
 * Perfiles y permisos. Esta matriz la usan tanto la interfaz como el servidor, que es quien
 * hace cumplir los permisos en modo servidor. En modo local (sin servidor) el perfil se elige
 * en la barra superior solo para probar los permisos.
 */
export type Permission =
  | 'importar'
  | 'configurar'
  | 'configurar_capacidad'
  | 'revisar_alertas'
  | 'validar_relaciones'
  | 'exportar'
  | 'borrar_datos'
  | 'administrar_usuarios';

export const ROLE_LABEL: Record<Role, string> = {
  administrador: 'Administrador',
  planificador: 'Planificador',
  consulta: 'Consulta',
};

const MATRIX: Record<Role, Permission[]> = {
  administrador: ['importar', 'configurar', 'configurar_capacidad', 'revisar_alertas', 'validar_relaciones', 'exportar', 'borrar_datos', 'administrar_usuarios'],
  planificador: ['importar', 'configurar_capacidad', 'revisar_alertas', 'validar_relaciones', 'exportar'],
  consulta: ['exportar'],
};

export function can(role: Role, p: Permission): boolean {
  return MATRIX[role].includes(p);
}
