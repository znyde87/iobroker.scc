import react from '@vitejs/plugin-react';
import commonjs from 'vite-plugin-commonjs';
import vitetsConfigPaths from 'vite-tsconfig-paths';
import { federation } from '@module-federation/vite';
import { readFileSync } from 'node:fs';

const pack = JSON.parse(readFileSync('./package.json').toString());

const shared: Record<string, unknown> = {
  react: { singleton: true, requiredVersion: pack.dependencies?.react },
  'react-dom': { singleton: true, requiredVersion: pack.dependencies?.['react-dom'] },
};

export default {
  plugins: [
    federation({
      name: 'sccHouseFlow',
      filename: 'customWidgets.js',
      exposes: {
        './SccHouseFlowWidget': './src/SccHouseFlowWidget.tsx',
        './translations': './src/translations.ts',
      },
      shared,
    }),
    react(),
    vitetsConfigPaths(),
    commonjs(),
  ],
  base: './',
  build: {
    target: 'chrome89',
    outDir: './build',
    rollupOptions: {
      onwarn(warning: { code: string }, warn: (w: { code: string }) => void) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
};
