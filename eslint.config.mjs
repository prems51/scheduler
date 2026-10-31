// ESLint flat config for the Timetable Manager.
// Zones:
//   * desktop-shared/ + timetable-core.js + scripts/ + tests/ — Node (also run
//     inside Electron's main process), no DOM, no React.
//   * src/main/ + src/preload/ — Node (Electron main + preload).
//   * src/renderer/ — browser + React (react-hooks; hooks are enabled there,
//     because the renderer is the only React code in this project).
// Issues 2/4/5 core requirement: no-undef and no-unused-vars are ERRORS, so a
// bug like the round-3 `response is not defined` can never ship again.
import pluginReactHooks from 'eslint-plugin-react-hooks'
import pluginReact from 'eslint-plugin-react'

export default [
  {
    // Global ignores: in-build output, dependencies, scratch folders.
    ignores: ['out/**', 'node_modules/**', '.freebuff/**', 'screenshots/**', 'pdf-check/**', '.tmp-*/**', '*.tmp', '.sample-html.json']
  },
  {
    // Files never linted for undefined globals: fixtures against real Electron.
    files: ['tests/electron/*.mjs', 'tests/**/electron/*.mjs'],
    languageOptions: {
      globals: {
        app: 'readonly',
        BrowserWindow: 'readonly',
        ipcMain: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly'
      }
    }
  },
  {
    // Node zone: scripts (one-off scaffolding), engine and shared code that
    // both processes import, and tests (vitest provides describe/it/expect).
    files: ['scripts/**/*.js', 'scripts/**/*.mjs', 'desktop-shared/**/*.js', 'timetable-core.js', 'tests/**/*.js', 'tests/**/*.mjs', '*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        // scripts/*.js are genuine CommonJS (they run before the bundler).
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        __filename: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    // Electron main + preload: also Node-ish, but they additionally read
    // Electron's global `app`/`BrowserWindow`/`ipcMain` imports.
    files: ['src/main/**/*.js', 'src/preload/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        window: 'readonly', // preload actually runs with a window context.
        document: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    // Renderer: browser + React.
    files: ['src/renderer/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        requestAnimationFrame: 'readonly',
        CustomEvent: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        URL: 'readonly'
      }
    },
    plugins: {
      'react-hooks': pluginReactHooks,
      react: pluginReact
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    // Build helpers of every kind
    files: ['electron.vite.config.mjs', 'vitest.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        __dirname: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'error'
    }
  }
]
