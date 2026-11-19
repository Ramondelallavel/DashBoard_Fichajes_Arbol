import type { Role } from '../domain/types';

/**
 * Perfiles y permisos. En esta versión no hay servidor de autenticación: el perfil se elige
 * localmente para probar los permisos. La matriz está preparada para conectarse a un
 * proveedor de identidad (OIDC/SSO) sin cambiar la interfaz.
 */
export type Permission =
  | 'importar'
  | 'configurar'
  | 'configurar_capacidad'
  | 'revisar_alertas'
  | 'validar_relaciones'
  | 'exportar'
  | 'borrar_datos';

export const ROLE_LABEL: Record<Role, string> = {
  administrador: 'Administrador',
  planificador: 'Planificador',
  consulta: 'Consulta',
};

const MATRIX: Record<Role, Permission[]> = {
  administrador: ['importar', 'configurar', 'configurar_capacidad', 'revisar_alertas', 'validar_relaciones', 'exportar', 'borrar_datos'],
  planificador: ['importar', 'configurar_capacidad', 'revisar_alertas', 'validar_relaciones', 'exportar'],
  consulta: ['exportar'],
};

export function can(role: Role, p: Permission): boolean {
  return MATRIX[role].includes(p);
}
