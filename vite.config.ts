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
