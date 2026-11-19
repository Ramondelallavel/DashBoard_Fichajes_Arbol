/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Modo normal: build multi-fichero para desplegar en un servidor web.
// Modo "artifact": build de un único HTML autocontenido (sin dependencias externas)
// que se publica como artefacto visualizable.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'artifact' ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  // En desarrollo, la API del servidor (npm run dev:server) se sirve en el puerto 3000
  server: { proxy: { '/api': 'http://localhost:3000' } },
  // La vista previa de la build no usa el proxy: sin servidor, la aplicación funciona en modo local
  preview: { proxy: {} },
  worker: { format: 'es' },
  build: {
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    chunkSizeWarningLimit: 2500,
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    // Zona horaria fija para que los cálculos de fechas sean reproducibles (hora local española, con cambio de horario)
    env: { TZ: 'Europe/Madrid' },
  },
}));
