import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The upstream zlib decoder uses eval for two fixed Huffman lookup tables.
// Parse these constant data tables as JSON so the app keeps a CSP without unsafe-eval.
const safeToolkitTables = {
  name: 'amt-toolkit-static-tables', enforce: 'pre',
  transform(code, id) {
    if (!id.includes('ui-toolkit') || !id.endsWith('core.bundle.js')) return null;
    const parse = name => `JSON.parse(${name}.replace(/^\\s*\\(/, '').replace(/\\)\\s*$/, '').replace(/([{,]\\s*)(op|bits|val)\\s*:/g, '$1"$2":'))`;
    return { code: code.replaceAll('eval(lenfix_def)', parse('lenfix_def')).replaceAll('eval(distfix_def)', parse('distfix_def')), map: null };
  }
};
export default defineConfig({ base: './', plugins: [safeToolkitTables, react()], build: { sourcemap: false } });
