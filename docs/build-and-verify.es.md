---
type: Guide
title: Compilación y verificación
description: Entorno, los comandos npm, estructura de las pruebas, el bundle 3D y las sondas de extremo a extremo del árbol de recursos, la extensión de autoprueba en máquina real, empaquetado e instalación
tags: [build, test, verification, packaging]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Compilación y verificación

[English](build-and-verify.md) | [中文](build-and-verify.zh-CN.md) | **Español**

## Entorno

| Elemento | Requisito |
|---|---|
| Node.js / npm | **^22.22.2 / ^24.15.0 / >=26** (el rango que acepta `jsdom@30`); lo usan tsc, esbuild, mocha y vsce |
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
npm run package     # vsce package → wispkit-0.2.15.vsix
```

| Comando | Qué hace realmente |
|---|---|
| `compile` | dos etapas: `tsc -p ./` compila `src` a `out`; `node esbuild.mjs` empaqueta **8 bundles de webview** (`markdown` / `mermaid` / `html` / `image` / `video` / `xaml` / `readonly` / `graph3d`), formato `iife`, `platform: browser`, `target: es2020`, sin sourcemaps; solo `graph3d` activa `minify` (three.js es grande) |
| `lint` | `eslint src`, configurado en `eslint.config.mjs` (typescript-eslint 9) |
| `test` | ejecuta `compile` primero (las pruebas corren desde `out/`), luego `mocha "out/test/**/*.test.js"`. **Node puro, sin instancia de VS Code** |
| `package` | `vsce package`, que produce `wispkit-<version>.vsix` |

**Una trampa habitual**: `media/subtree.js` **no lo empaqueta esbuild**. La página referencia el archivo fuente directamente con `<script type="module" src="...subtree.js" nonce=...>`; las otras 8 entradas de front-end (incluidas `mermaid.js` / `graph3d.js`) referencian `media/dist/*.js`. Así que editar `subtree.js` no requiere `npm run compile`, pero editar cualquiera de las otras 8 sí — de lo contrario `media/dist/` conserva la copia antigua.

## CI

`.github/workflows/ci.yml` (GitHub Actions) se ejecuta en cada push y pull request sobre `windows-latest`, con los pasos en este orden fijo:

| Paso | Comando |
|---|---|
| 1 | `npm ci` |
| 2 | `npm run lint` |
| 3 | `npm run compile` |
| 4 | `npm test` |

`lint` debe ir antes de `test`: `npm test` vuelve a ejecutar `compile` y después las pruebas compiladas, así que un error de lint detectado tras el paso de pruebas parece un fallo de pruebas. Se usa `npm ci` en lugar de `npm install` para que se respete el lockfile versionado.

Node **22.22.2** es la versión mínima soportada y la CI la fija exactamente. ESLint 9 declara `^20.9.0` y `@vscode/vsce` declara `>=20`, pero `jsdom@30` (y su `undici`) solo acepta `^22.22.2 || ^24.15.0 || >=26`; en Node 20 la ejecución de pruebas muere al cargar jsdom (`Cannot read properties of undefined (reading 'bind')`).

El runner es Windows a propósito: varios contratos de prueba afirman semántica de rutas de Windows (letras de unidad, rutas UNC, separadores `\`). La extensión en sí es multiplataforma, pero la suite actual falla en un runner POSIX.

Para comprobar la vía negativa de la puerta en local: añade una variable local sin usar bajo `src/` y ejecuta `npm run lint`; debe salir con código distinto de cero antes de `compile` / `test`.

## Estructura de las pruebas

- Framework: **mocha** + **jsdom** (ambos en devDependencies).
- Ubicación: `src/test/*.test.ts` → compilado a `out/test/*.test.js`.
- Carácter: **pruebas de lógica pura, sin arrancar una instancia de VS Code**. Todo lo que toca la API de `vscode` está aislado en `*Provider.ts`, mientras que la lógica pura vive en archivos aparte (que no importan `vscode`) y por tanto se puede probar por unidad directamente.
- Actual: **62 archivos de prueba / 1059 casos** (`npm test` imprime `1059 passing`).

### Casos por archivo

Aquí no se duplica el desglose por archivo. Antes era una tabla mantenida a mano y había derivado
hasta cubrir 39 de 62 archivos, con varios recuentos obsoletos — exactamente el fallo que las reglas
de registro de [Pruebas y calidad](test-and-quality.md) existen para evitar. Regenéralo cuando lo
necesites:

```bash
npm test && npx mocha "out/test/**/*.test.js" --reporter json
```

Los totales de [Pruebas y calidad](test-and-quality.md) son el contrato; el desglose por archivo es
un diagnóstico.

### 3D bundle y sondas de extremo a extremo

| Elemento | Valor |
|---|---|
| Salida | `media/dist/graph3d.js` |
| Entrada fuente | `media/graph3d.js` (`import * as THREE`, `OrbitControls` y `src/graph3d/*`) |
| Minificación | esbuild `minify: true`; el único bundle de webview minificado |
| Tamaño actual | **unos 603 KB** (617.043 B; three.js ocupa la mayor parte y el tamaño cambia con el código) |
| Comprobación de empaquetado | el VSIX debe contener `extension/media/dist/graph3d.js`, `extension/media/graph3d.css`, `extension/out/graph3dProvider.js` y `extension/out/graph3d/*.js`; comprobar con `npx vsce ls \| Select-String graph3d` |

Las **sondas 3D de extremo a extremo en máquina real** están en `.selftest/e2e-graph3d/` (ignorado por `.gitignore`, no entra en el VSIX ni en el paquete npm). Arrancan VS Code 1.137.0 con `--user-data-dir` / `--extensions-dir` aislados y accionan clics derechos, clics y arrastres reales por CDP:

- Sondas: `probe-entry.mjs`, `probe-layout.mjs`, `probe-toolbar.mjs`, `probe-camera.mjs`, `probe-packaged.mjs`, `probe-packaged-palette.mjs`, `probe-console.mjs`, entre otras;
- Resultados: `probe-*.result.json`, `console-errors.json`; capturas `03`–`42`; el detalle punto por punto es `detail.md` en el mismo directorio;
- Cobertura: entrada por menú contextual / paleta, reapertura que solo revela, recuento en el título, selectores izquierdo/derecho, paneles 15%–85%, fusión / `Esc`, control de intervalo, actualización, restablecer vista, rotar con el botón izquierdo / desplazar con el derecho / zoom con rueda, adaptación al tamaño de ventana e instalación aislada del VSIX empaquetado;
- Resultado: sin excepciones en el host de la extensión ni en el webview; todas las comprobaciones de las sondas pasaron.

### Pruebas del árbol de recursos y comprobación del empaquetado

Los nueve archivos de prueba del árbol de recursos suman **94 casos** (ya incluidos en los 1059):

| Archivo de prueba | Casos | Cubre |
|---|---:|---|
| `resourceTreeStorage.test.ts` | 19 | resolución de la ubicación de almacenamiento, BOM UTF-8, rutas temporales, escritura atómica correcta y tres rutas de protección ante fallos |
| `resourceTreeModel.test.ts` | 16 | modelo de nodos, análisis y saneado, serialización, reasignación de ids, truncado por exceso de elementos y de profundidad |
| `resourceTreeSystemTerminal.test.ts` | 12 | el menú «abrir en terminal del sistema» por plataforma y su plan de lanzamiento (elevación en Windows, argv en macOS / Linux) |
| `resourceTreeExplorerSelection.test.ts` | 11 | normalización de argumentos para el menú contextual del Explorador y plan de alta masiva con selección múltiple |
| `resourceTreeFolderStateCache.test.ts` | 9 | caché de estado de carpetas: TTL, invalidación, tope LRU, límite de concurrencia y deduplicación de peticiones |
| `resourceTreePresentation.test.ts` | 9 | estado de carpeta, texto de descripción e información emergente, comandos de clic de grupo y carpeta |
| `resourceTreePaths.test.ts` | 8 | `${workspaceFolder}` / por nombre / por índice, rutas absolutas fuera del espacio de trabajo, tratamiento de mayúsculas |
| `resourceTreeProviderContract.test.ts` | 5 | contrato de IO del estado de carpetas: `getTreeItem` con caché, prefetch asíncrono, comandos registrados |
| `resourceTreeTransfer.test.ts` | 5 | planificación de importación, rechazo de archivos inválidos, resumen de advertencias, ida y vuelta de exportación / importación |
| **Total** | **94** | |

Las sondas de extremo a extremo en máquina real están en `.selftest/e2e-resource-tree/` (ignorado por `.gitignore`, no viaja en el VSIX): `probe-final.mjs` (60 puntos de registro), `probe-focused.mjs` (arrastre interno / detección de ciclos / subárbol) y `probe-persistence.mjs` (32 puntos). Cubren la barra de actividades y las pistas de árbol vacío, las seis entradas de la barra de título, añadir desde el menú contextual del Explorador, alta/renombrado/movimiento/borrado a profundidad arbitraria, arrastre interno y externo, rechazo de ciclos, apertura del panel de subárbol, el aviso al pulsar un grupo virtual, los tres estados de advertencia, la conservación del estado al actualizar, los avisos de borrado externo, el cambio de configuración, la actualización tras una edición externa, el JSON inválido que no se sobrescribe, importar / exportar / abrir JSON y la protección ante fallos de la escritura atómica, con 0 errores; capturas 01–32. Los espacios multitráiz se verificaron en máquina real el 2026-10-26 (sondas en `.selftest/e2e-resource-tree-multiroot/`; véase el punto 12 de limitaciones). Hueco conocido restante: en Session 0 los selectores nativos de archivos se verificaron con stubs de la API del host (la cadena de comandos y las escrituras en disco siguen usando el código real).

**Comprobación del empaquetado**: el VSIX debe contener `extension/out/resourceTreeProvider.js` y `extension/out/resourceTree/{model,paths,storage,storageCore,transfer,presentation}.js`; `extension/package.json` debe mostrar la vista `wispkit.resourceTree`, los 13 comandos `wispkit.resourceTree.*` y el evento de activación `onView:wispkit.resourceTree`. La gestión de recursos es un TreeView nativo y **no** tiene bundle de front-end ni recursos de media. Verificar con:

```powershell
npx vsce ls | Select-String resourceTree
```

`demo/**` sigue excluido por `.vscodeignore`, así que los materiales de `demo/R9-resource-tree` no se publican con la extensión.

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

> **El script de empaquetado reescribe los enlaces relativos a URL absolutas de Gitee**: los README trilingües introducen **enlaces relativos** como `README.zh-CN.md` y `docs/architecture.md`; `package.json` ya apunta `repository` a Gitee y el script pasa explícitamente `--baseContentUrl https://gitee.com/the50w/wispkit/blob/master --baseImagesUrl https://gitee.com/the50w/wispkit/raw/master`, de modo que esos enlaces siguen siendo pulsables en la página de detalles de la extensión. Cambia ambos flags a la vez si el repositorio se muda.
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

Salida actual: **173 entradas de contenido / 175 entradas de archivo, unos 1,73 MB** (`docs/` contiene 25 documentos Markdown junto con los tres README; la cifra crece a medida que se añade documentación).

Instalación local:

```powershell
code --install-extension .\wispkit-0.2.15.vsix --force
```

Tras instalar hay que **recargar la ventana** (o reiniciar VS Code) para que surta efecto. Para verificar que la instalación se actualizó de verdad, no te fíes solo de las marcas de tiempo — lee los archivos instalados y confirma que el cambio está dentro:

```powershell
$ext = "$env:USERPROFILE\.vscode\extensions\harrrry.wispkit-0.2.15"
Select-String -Path "$ext\media\markdown.css" -Pattern 'overflow: clip' -Quiet
```

## Disciplina de verificación

1. **Ejecutar `lint` + `test` para cualquier cambio de front-end**; cuando solo cambian reglas de clase CSS, vigila que la salida de esbuild siga sincronizada (`media/dist/`).
2. **Las aserciones deben morder el resultado, no «que la regla exista»**. El repositorio tiene aquí una lección real: una aserción de «se escribió una regla CSS en el archivo» pasaba mientras el fallo de render real se colaba; después las aserciones se cambiaron a «qué pasó en la escena tras el clic» (por ejemplo `pulsar Guardar envía realmente el cambio`, `los márgenes superior e inferior del control deslizante deben ser iguales`).
3. **Para cambios relacionados con el webview, preferir la autoprueba en máquina real** (`tools/selftest`) en lugar de ejecutar solo jsdom — jsdom ni ejecuta la CSP ni carga scripts de terceros.
4. **Tras instalar, leer los archivos para verificar**, no confiar en que `vsce package` haya terminado bien.
5. **Vigilar tanto el bundle como las sondas en cambios 3D**: tras editar `media/graph3d.js` / `src/graph3d/*`, volver a ejecutar `npm run compile`, confirmar que `media/dist/graph3d.js` se actualizó y volver a pasar las sondas de `.selftest/e2e-graph3d/` para entrada, paneles, fusión y cámara.
