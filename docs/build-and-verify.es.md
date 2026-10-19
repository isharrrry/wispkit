---
type: Guide
title: Compilación y verificación
description: Entorno, los cuatro comandos npm, estructura de las pruebas, la extensión de autoprueba en máquina real, empaquetado e instalación
tags: [build, test, verification, packaging]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Compilación y verificación

[English](build-and-verify.md) | [中文](build-and-verify.zh-CN.md) | **Español**

## Entorno

| Elemento | Requisito |
|---|---|
| Node.js / npm | usado por tsc, esbuild, mocha y vsce |
| TypeScript | 5.7 (fijado en `devDependencies`) |
| VS Code | `engines.vscode: ^1.71.0`; versión medida **1.137.0** (Windows) |
| .NET | solo lo necesita la vista XAML: el **runtime .NET 10 Windows Desktop** (el renderizador depende del framework) |
| Plataforma | la extensión en sí es multiplataforma; el renderizador XAML y las sondas en máquina real se verificaron en Windows |

## Cuatro comandos

```bash
npm install
npm run compile     # tsc + esbuild
npm run lint        # eslint src
npm test            # primero compile, luego mocha
npm run package     # vsce package → wispkit-0.1.0.vsix
```

| Comando | Qué hace realmente |
|---|---|
| `compile` | dos etapas: `tsc -p ./` compila `src` a `out`; `node esbuild.mjs` empaqueta **4 bundles de webview** (`markdown` / `image` / `xaml` / `readonly`), formato `iife`, `platform: browser`, `target: es2020`, sin minificación, sin sourcemaps |
| `lint` | `eslint src`, configurado en `eslint.config.mjs` (typescript-eslint 9) |
| `test` | ejecuta `compile` primero (las pruebas corren desde `out/`), luego `mocha "out/test/**/*.test.js"`. **Node puro, sin instancia de VS Code** |
| `package` | `vsce package`, que produce `wispkit-<version>.vsix` |

**Una trampa habitual**: `media/subtree.js` **no lo empaqueta esbuild**. La página referencia el archivo fuente directamente con `<script type="module" src="...subtree.js" nonce=...>`; los otros 4 archivos de front-end referencian `media/dist/*.js`. Así que editar `subtree.js` no requiere `npm run compile`, pero editar cualquiera de los otros 4 sí — de lo contrario `media/dist/` conserva la copia antigua.

## Estructura de las pruebas

- Framework: **mocha** + **jsdom** (ambos en devDependencies).
- Ubicación: `src/test/*.test.ts` → compilado a `out/test/*.test.js`.
- Carácter: **pruebas de lógica pura, sin arrancar una instancia de VS Code**. Todo lo que toca la API de `vscode` está aislado en `*Provider.ts`, mientras que la lógica pura vive en archivos aparte (que no importan `vscode`) y por tanto se puede probar por unidad directamente.
- Actual: **20 archivos de prueba / 477 casos**.

### Casos por archivo

| Archivo de prueba | Casos | Cubre |
|---|---:|---|
| `markdownPage.test.ts` | 91 | HTML de la página Markdown, CSP, variables de tipografía, modo edición, ruta de guardado |
| `readonlyHighlight.test.ts` | 49 | el resaltador de sintaxis genérico de la vista de solo lectura (agrupación por lenguaje y colores para más de 60 extensiones) |
| `subtreeCore.test.ts` | 48 | definiciones y formato de columnas, ordenación, análisis de configuración, `Wispkit.json`, sustitución de marcadores |
| `xamlPage.test.ts` | 40 | estructura de la página XAML, superposición de resaltado, paneles |
| `subtreePage.test.ts` | 37 | HTML del panel de subárbol, variables de ancho de columna, render de iconos |
| `toc.test.ts` | 24 | construcción del árbol del índice, profundidad, seguimiento del resaltado |
| `xamlHighlight.test.ts` | 22 | resaltado de XAML / XAML.cs (los caracteres visibles permanecen idénticos) |
| `mediaParse.test.ts` | 20 | mapeo de índice de medio → posición en el origen |
| `readonly.test.ts` | 15 | estado y página del modo de solo lectura |
| `lightbox.test.ts` | 14 | modal a pantalla completa |
| `readonlyAssociations.test.ts` | 14 | planificación y aplicación de `editorAssociations` |
| `subtreeIconTheme.test.ts` | 14 | búsqueda de temas de iconos en cuatro niveles y fusión de iconos de lenguaje |
| `xamlRenderer.test.ts` | 14 | contrato de llamada al proceso renderizador |
| `panzoom.test.ts` | 13 | aritmética de zoom/desplazamiento |
| `xamlDefects.test.ts` | 13 | guardas de regresión de tres defectos XAML corregidos |
| `contextmenu.test.ts` | 12 | posicionamiento y detección de impacto del menú contextual |
| `contributions.test.ts` | 12 | agregación de `markdown.previewScripts` de terceros |
| `linkRewrite.test.ts` | 12 | reescritura de `vscode://file/` → `command:` |
| `htmlPage.test.ts` | 9 | envoltorio de la página HTML y CSP relajada |
| `render.test.ts` | 4 | entrada de la tubería de renderizado |

## Extensión de autoprueba en máquina real (`tools/selftest`)

`tools/selftest` no es un directorio de scripts sino una **extensión de autoprueba temporal** (`wispkit-selftest`, `private: true`, **no se distribuye en el VSIX**):

- `activationEvents: ["*"]`; ejecuta sus sondas en cuanto se activa.
- **Comprobaciones de render**: llama directamente a `markdown.api.render` y verifica el tipo devuelto, la longitud y si contiene `class="mermaid"` / `class="mxgraph"` / enlaces `command:`.
- **Sondas de página**: para las vistas `wispkit.markdown` / `wispkit.image` / `wispkit.html` inyecta un `<script>` con nonce antes de `</head>` e informa de los resultados un tiempo después de `load` (sondas de maquetación y de tema).
- **Configurable**: las variables de entorno `WISPKIT_SELFTEST_FIXTURE` / `WISPKIT_SELFTEST_IMAGE` / `WISPKIT_SELFTEST_HTML` eligen los fixtures, y `WISPKIT_SELFTEST_PROBE_MS` controla la espera (10000 ms por defecto, dejando tiempo para diagramas grandes de mermaid/drawio).

Cubre el punto ciego de las pruebas unitarias: **el render real dentro del webview, si la CSP deja pasar las cosas y si los scripts de terceros se ejecutan de verdad**. `.vscodeignore` ya excluye `tools/selftest/**`.

## Renderizador XAML (`tools/xaml-render`)

Un proyecto .NET aparte cuya salida viaja en el VSIX:

```powershell
cd tools\xaml-render
dotnet build -c Release
```

- **dependiente del framework** (unos cientos de KB); necesita el runtime .NET 10 Windows Desktop en tiempo de ejecución.
- La extensión y el renderizador están separados por un **límite de proceso**; el contrato está congelado como:
  ```text
  <renderer> render <in.xaml> <out.png> [--assembly <dll>]...
  ```
- La estrategia de renderizado y su cobertura están documentadas en [xaml-render/README.md](../tools/xaml-render/README.md) y [results-real.md](../tools/xaml-render/results-real.md).
- Tras cambiar el renderizador hay que volver a ejecutar `dotnet build -c Release` antes de empaquetar; de lo contrario el VSIX sigue llevando el binario antiguo.

## Empaquetado e instalación

```bash
npm run package
```

> **No quites `--baseContentUrl . --baseImagesUrl .` del script de empaquetado**: los README trilingües introducen **enlaces relativos** como `README.zh-CN.md` y `docs/architecture.md`, y el `package.json` de este repositorio no tiene campo `repository`. Sin esos dos flags `vsce` falla con
> `Couldn't detect the repository ... The link 'README.zh-CN.md' will be broken` y **aborta el empaquetado** (`--allow-missing-repository` no basta).
> Pasar `.` mantiene los enlaces relativos tal cual, así que siguen funcionando al abrir la página de detalles de la extensión localmente.

`.vscodeignore` excluye lo siguiente (lo que determina directamente el contenido del VSIX):

| Excluido | Motivo |
|---|---|
| `src/**`, `out/test/**`, `**/*.map` | fuentes y pruebas no entran en el paquete (en tiempo de ejecución solo se necesita `out/`) |
| `.vscode/**`, `.claude/**`, `tools/selftest/**`, `.selftest/**` | activos de desarrollo |
| `eslint.config.mjs`, `esbuild.mjs`, `tsconfig.json`, `*.vsix` | configuración de compilación |
| `tools/xaml-render/{obj,bin/Debug,publish,samples,out}/**`, `*.ps1`, `*.md`, `Program.cs`, `*.csproj` | solo se conserva la salida Release del renderizador |
| `demo/**` | los datos de demostración (unos 5 MB) no entran en el paquete |
| `panzoom.bak`, `contrib.bak` | copias de seguridad históricas |

Salida actual: **94 entradas / unos 1.1 MB** (26 entradas más que solo código: 19 archivos en `docs/`, 5 capturas, más `README.zh-CN.md` y `README.es.md`; y crecerá a medida que se añadan documentos).

Instalación local:

```powershell
& "D:\app\VSCodeEXE\bin\code.cmd" --install-extension .\wispkit-0.1.0.vsix --force
```

Tras instalar hay que **recargar la ventana** (o reiniciar VS Code) para que surta efecto. Para verificar que la instalación se actualizó de verdad, no te fíes solo de las marcas de tiempo — lee los archivos instalados y confirma que el cambio está dentro:

```powershell
$ext = "$env:USERPROFILE\.vscode\extensions\narnat.wispkit-0.1.0"
Select-String -Path "$ext\media\markdown.css" -Pattern 'overflow: clip' -Quiet
```

## Disciplina de verificación

1. **Ejecutar `lint` + `test` para cualquier cambio de front-end**; cuando solo cambian reglas de clase CSS, vigila que la salida de esbuild siga sincronizada (`media/dist/`).
2. **Las aserciones deben morder el resultado, no «que la regla exista»**. El repositorio tiene aquí una lección real: una aserción de «se escribió una regla CSS en el archivo» pasaba mientras el fallo de render real se colaba; después las aserciones se cambiaron a «qué pasó en la escena tras el clic» (por ejemplo `pulsar Guardar envía realmente el cambio`, `los márgenes superior e inferior del control deslizante deben ser iguales`).
3. **Para cambios relacionados con el webview, preferir la autoprueba en máquina real** (`tools/selftest`) en lugar de ejecutar solo jsdom — jsdom ni ejecuta la CSP ni carga scripts de terceros.
4. **Tras instalar, leer los archivos para verificar**, no confiar en que `vsce package` haya terminado bien.
