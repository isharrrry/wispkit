---
type: Guide
title: Restricciones de prueba y calidad
description: Objetivos de calidad que no son negociables, los niveles de prueba y sus puntos ciegos, qué cuenta como evidencia, la puerta de integración, las mediciones registradas, la clasificación de defectos y el riesgo residual
tags: [test, quality, verification, defects, risk]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T10:20:00+08:00 }
---

# Restricciones de prueba y calidad

[English](test-and-quality.md) | [中文](test-and-quality.zh-CN.md) | **Español**

> Cómo se decide que esta extensión es suficientemente buena: los objetivos que no se pueden
> negociar, qué puede ver cada nivel de prueba, qué evidencia se acepta, cuándo puede integrarse un
> cambio, cómo se registran los números y dónde reside el riesgo que se asume conscientemente.

## Estado de este documento

Este archivo es la mitad de calidad del contrato. [`requirements.md`](requirements.md) establece qué
debe cumplirse; este archivo establece cómo se demuestra y qué cuenta como aprobado. Si ambos
discrepan, prevalece el requisito y este archivo está equivocado.

## 1. Alcance y reparto del trabajo

| Documento | Responde |
| :--- | :--- |
| [`requirements.md`](requirements.md) | Qué debe hacer la extensión, por número de requisito, y qué no promete |
| [`build-and-verify.md`](build-and-verify.md) | Qué comandos existen, qué hace cada uno, la estructura de las pruebas y los pasos de empaquetado |
| [`limitations.md`](limitations.md) | Qué no se puede hacer y qué nunca se ha verificado |
| **este archivo** | Cómo se demuestra el trabajo, cuándo puede integrarse y cómo se registra la evidencia |

Los comandos se documentan en `build-and-verify.md` y aquí solo se referencian. Repetir un comando en
dos lugares es cómo un documento empieza a mentir sobre un comando que cambió.

## 2. Objetivos de calidad y restricciones duras

| # | Objetivo | Se impone mediante |
| :--- | :--- | :--- |
| **QO-1** | **Nunca modificar VS Code.** No se parchea ningún archivo fuera de este repositorio y ningún comportamiento depende de un parche. | Solo nueve registros de `CustomEditorProvider` y vistas aportadas; el entregable es un VSIX que no contiene nada más que esta extensión |
| **QO-2** | **Seguridad de contenido estricta.** Nada dentro de un webview puede cargar un recurso remoto ni ejecutar script en línea sin nonce. | La CSP estricta de cada página webview, verificada en las pruebas de página |
| **QO-3** | **Solo lectura significa no cargado.** El modo de solo lectura lee un presupuesto de bytes y no crea ningún documento de texto. | Las aserciones de truncamiento y de «no se crea documento» en las pruebas unitarias |
| **QO-4** | **Sin dependencias de ejecución de terceros.** La capa del host de extensión es TypeScript puro sobre el Node incluido. | La lista de dependencias del manifiesto; el único requisito nativo es el tiempo de ejecución de .NET que necesita la vista XAML |
| **QO-5** | **El mínimo de plataforma es un contrato.** Nada puede usar una API más reciente que el mínimo declarado en `engines.vscode`. | Compilación contra las definiciones de tipo del mínimo; una API más nueva no compila |
| **QO-6** | **Etiquetas honestas.** Todo lo no verificado se escribe como no verificado. | La lista residual de §10, `limitations.md` y las limitaciones conocidas del README |

Un cambio que compre una función gastando cualquiera de estos objetivos se rechaza sin importar cuán
verde esté la suite.

## 3. Niveles de prueba y qué puede ver cada uno

| Nivel | Ejercita | Puede demostrar | No puede ver |
| :--- | :--- | :--- | :--- |
| **T1 — Lógica pura** | Lógica mediante mocha en Node simple. Todo lo que toca la API del editor se aísla en un archivo aparte para que el resto pueda probarse sin una instancia. | Generación de HTML, texto de CSP, construcción de árboles, resolución de enlaces, análisis de configuración, formateo, resaltado | Renderizado real; si la CSP bloquea algo de verdad; si un script de terceros se ejecuta |
| **T2 — Salida del front-end** | Las páginas webview generadas inspeccionadas como datos | Que una página contiene los elementos, nonces y atributos que debería | Si el navegador hace algo sensato con ellos |
| **T3 — Sonda en máquina real** | Una extensión temporal de autoprueba dentro de una ventana real de VS Code, con espera configurable e inyecciones a nivel de página | Renderizado real, si la CSP deja pasar las cosas, si los scripts aportados se ejecutan realmente, comportamiento de gestos y diseño | Todo lo que la sonda no instrumenta; no se ejecuta en cada cambio |
| **T4 — Repetición de muestras** | Las muestras `demo/R<n>-*` abiertas a mano o por sonda | Que un escenario documentado sigue comportándose como se documentó | Escenarios sin muestra |
| **T5 — Consistencia** | Comprobaciones entre idiomas y de enlaces sobre el conjunto de documentación | Que las tres versiones de idioma siguen siendo equivalentes y que no hay enlaces rotos | Si el contenido es verdadero |
| **T6 — CI** | Una copia limpia en un solo runner | Que la puerta es reproducible desde cero | El comportamiento de plataforma en runners que no se usan |

El punto ciego decisivo: **T1 se ejecuta en jsdom, que no aplica CSP ni carga scripts de terceros.**
Por lo tanto, cualquier afirmación sobre política de seguridad o scripts aportados debe llegar a T3, o
bien etiquetarse como no verificada. Esta es la frontera más importante de toda la tabla.

## 4. Qué cuenta como evidencia

| Se acepta | Por qué |
| :--- | :--- |
| Una aserción sobre lo que ocurrió después de una interacción | Se pone en rojo cuando el comportamiento es incorrecto |
| Un resultado de sonda citado con sus números medidos | Se puede repetir y reproducir |
| Una aserción de rechazo para una configuración inválida | Se pone en rojo en el momento en que el analizador empieza a aceptarla |
| Un recuento impreso por el ejecutor, citado literalmente | Es recalculable |

| Se rechaza | Por qué |
| :--- | :--- |
| «La regla existe» / «el estilo se escribió» | Este repositorio ya pagó una vez por esta lección |
| Una captura de pantalla en lugar de una aserción | No es repetible ni comparable |
| «El comando salió con 0» sin la línea del recuento | El código de salida no lleva el número que importa |
| Un número copiado de un documento antiguo | Eso es memoria, no medición |

La primera fila de la segunda tabla no es hipotética. Una aserción de que una regla de estilo se había
escrito en la página pasó mientras el defecto de renderizado que debía detectar se colaba intacto. La
regla que la sustituyó: **afirmar lo que hizo la escena, no lo que dice el archivo**. Cada prueba
nueva se revisa contra esa frase.

## 5. Suficiencia

1. Cada requisito de `requirements.md` alcanza al menos un nivel de §3, y la cobertura se nombra en §7.
2. Cada afirmación sobre un webview —renderizado, seguridad de contenido, scripts aportados, gestos—
   se ejerce en T3 o se registra en §10 como no verificada. Un resultado de T1 por sí solo nunca basta.
3. Cada escenario documentado dispone de una muestra `demo/R<n>-*` con la que repetirse, o está marcado
   como carente de ella.
4. Cada analizador de entrada externa (archivos de configuración, marcadores de herramientas, JSON en
   disco) tiene un caso de rechazo además de su camino feliz.
5. El número de casos que reporta el ejecutor es igual al número de casos diseñados. Un caso omitido o
   descartado en silencio no es un aprobado.

El porcentaje de cobertura no es aquí un criterio de suficiencia. No distingue una prueba que afirma un
resultado de una prueba que solo ejecutó una línea, y esa distinción es exactamente la que ha quemado a
este repositorio.

## 6. Entorno

| Elemento | Requisito | Nota |
| :--- | :--- | :--- |
| Node.js | El rango que acepta la pila de pruebas, con la versión mínima soportada fijada en CI | El mínimo lo impone la implementación del DOM usada en las pruebas, no la extensión |
| VS Code | El mínimo declarado en `engines.vscode` | En la verificación en máquina real se midió una versión más reciente; ambas quedan registradas en `build-and-verify.md` |
| .NET | Tiempo de ejecución **10 Windows Desktop**, solo para la vista XAML | Renderizador dependiente del marco; las otras seis vistas no necesitan nada nativo |
| Runner de CI | Windows, a propósito | Varios contratos de prueba afirman semántica de rutas de Windows, de modo que un runner POSIX falla aunque la extensión sea multiplataforma |
| Orden de la puerta | Instalar, lint, compilar, probar — fijo | Lint va antes de prueba porque el comando de prueba vuelve a compilar; un fallo de lint descubierto después se reporta como fallo de prueba |

`build-and-verify.md` es el dueño de las versiones exactas y del cuerpo de los comandos. Esta tabla
registra solo aquello de lo que depende el argumento de calidad.

## 7. Trazabilidad

Los números de requisito viven en `requirements.md`; los directorios de muestra son la evidencia
repetible. Esta tabla asigna por nombre para no tener que copiar números a un segundo documento.

| Capacidad | Requisito | Niveles | Evidencia repetible |
| :--- | :--- | :--- | :--- |
| Los scripts de vista previa aportados se ejecutan bajo la política estricta | R1 | T1, T2, T3 | `demo/R1-injection` |
| Navegación por tabla de contenidos y resaltado de seguimiento | R2 | T1, T2, T4 | `demo/R2-toc` |
| Zoom y desplazamiento de Mermaid | R3 | T1, T3, T4 | `demo/R3-mermaid` |
| Zoom de imagen con rueda y desplazamiento con arrastre derecho | R4 | T1, T3, T4 | `demo/R4-image` |
| Enrutado de enlaces internos y números de línea | R5 | T1, T2, T4 | `demo/R5-jump` |
| Renderizado XAML en paralelo y escritura de vuelta | R6 | T1, T3 | `demo/R6-xaml` (primera generación), `demo/R12-xaml` (segunda generación) |
| Navegación 3D de gráficos | R8 | T1, T2, T3 | `demo/R8-graph3d` |
| Gestión de recursos personalizada | R9 | T1, T2, T3 | `demo/R9-resource-tree` |
| Modo global de solo lectura | R10 | T1, T2 | `demo/R10-readonly` |
| Panel de subárbol | R11 | T1, T2 | `demo/R11-subtree` |
| Vista independiente de archivos Mermaid | R13 | T1, T2, T4 | `demo/R8-graph3d/04-standalone.mmd` |
| Reproducción de vídeo dentro del editor | R14 | T1, T3 | sonda en ventana real; sin directorio de muestra |
| Edición de párrafos en el lugar en la vista Markdown | R15 | T1, T3 | sonda en ventana real; sin directorio de muestra |
| Búsqueda en el documento en la vista Markdown | R16 | T1, T2, T3 | sonda en ventana real; sin directorio de muestra |
| Zoom del cuerpo en la vista Markdown | R17 | T1, T3 | sonda en ventana real; sin directorio de muestra |
| Superficie localizada de la extensión | R18 | T1, T5 | los archivos de localización del manifiesto |
| Política de seguridad de contenido | transversal | T1, T2, T3 | afirmada en las pruebas de página; verificada en una ventana real |
| Equivalencia de la documentación | transversal | T5 | este conjunto de documentación |

Hay dos excepciones de numeración deliberadas que deben sobrevivir a cualquier reescritura de esta
tabla: **`R7` está retirado y no aparece en ningún sitio** — se dejó vacante en lugar de reasignarse
cuando la capacidad a la que estaba asignado se dividió en dos — y **`R12` no es una capacidad
propia**; nombra el conjunto de muestras de segunda generación de `R6` y por lo tanto pertenece a la
columna de evidencia, no a una fila.

La trazabilidad inversa es la misma tabla leída hacia arriba: una prueba que no puede nombrar la
capacidad que protege no pertenece a la suite.

## 8. Criterios de entrada y salida

**Entrada.** Dependencias instaladas desde el archivo de bloqueo comprometido y compilación producida
a partir de las fuentes actuales. Las pruebas se ejecutan contra la salida compilada, de modo que un
recompilado olvidado prueba en silencio el código de ayer.

**Salida.** Todos los pasos, en este orden, sin cortocircuito:

| Paso | Qué es | Aprueba cuando |
| :--- | :--- | :--- |
| 1 | Instalación desde el archivo de bloqueo | Termina sin modificar el archivo de bloqueo |
| 2 | Lint | Sale con cero |
| 3 | Compilación | Ambas etapas tienen éxito; los paquetes del front-end se regeneran |
| 4 | Pruebas | Cero fallos y el total de casos reportado coincide con §9 |

**Sin aprobación condicional.** Una puerta que falla se reporta como fallida, con el paso y la línea
del recuento. No hay un paso de «reintentar hasta que salga verde», y una prueba conocida como
inestable es un defecto de §10.

## 9. Registros

Reglas de registro:

1. Un número debe ser recalculable a partir de un comando escrito en un entorno escrito. De lo
   contrario se elimina en lugar de matizarse.
2. Un registro lleva la fecha, la versión del tiempo de ejecución y la línea impresa del recuento.
3. Cuando un número cambia, el documento que lo posee cambia en el mismo commit.

Registrado el **2026-11-06** con Node **v24.16.0**, versión del paquete **0.2.12**:

| Medición | Comando | Resultado |
| :--- | :--- | :--- |
| Lint | `npm run lint` | Sale con cero, sin hallazgos |
| Casos | `npm test` | **1149 passing**, 0 fallos, 7 s de reloj |
| Archivos de prueba | Contados en el árbol de fuentes | **70 archivos de prueba** |
| Plataforma | — | Windows, máquina local de desarrollo |
| Contenido del VSIX | `npm run package` | **172 archivos, 1.71 MB** (`wispkit-0.2.12.vsix`) |

**Una discrepancia que este registro encontró al principio y ya está resuelta.**
`build-and-verify.md` indicaba **57 archivos de prueba / 952 casos**, cifras anteriores al trabajo de
3D, árbol de recursos y edición en el lugar. Se alineó con los recuentos de arriba en el mismo cambio
que añadió este archivo.

## 10. Defectos y problemas residuales

| Severidad | Definición | Ejemplo de la clase |
| :--- | :--- | :--- |
| **Crítica** | Un webview escapa de su política de contenido, o la extensión modifica estado fuera de su propio espacio de trabajo | Una página que carga un script remoto |
| **Grave** | Un comportamiento visible es incorrecto, o un paso de la puerta no impone lo que afirma | Una prueba que afirma que se escribió una regla en lugar de que se aplicó |
| **General** | Comportamiento correcto, documentación o registro incorrectos | Un recuento desactualizado en un documento |

Problemas residuales abiertos:

| # | Problema | Severidad | Estado |
| :--- | :--- | :--- | :--- |
| R-1 | `build-and-verify.md` arrastraba recuentos desactualizados (57 archivos / 952 casos) | General | Cerrado — alineado con los números de §9 en el mismo cambio |
| R-2 | jsdom no aplica ninguna política de contenido ni carga scripts de terceros, por lo que T1 no puede demostrar ninguna afirmación de seguridad | Grave | Aceptado — esas afirmaciones exigen T3 y así se etiquetan |
| R-3 | El renderizador XAML es una instantánea estática sin contexto de datos ni bucle de mensajes; un host Blazor en blanco es correcto, no un fallo | Grave | Aceptado — documentado como limitación, no como defecto |
| R-4 | El runner de CI es solo Windows; el comportamiento POSIX no tiene evidencia automatizada | Grave | Aceptado — registrado como riesgo en §11 |
| R-5 | Las sondas en máquina real no forman parte de la puerta; se ejecutan cuando un cambio de webview lo necesita | Grave | Aceptado — T3 es un acto deliberado, no automático |

R-3 y R-4 también aparecen en las limitaciones conocidas del README y en `limitations.md`. Cuando
estas listas discrepan, la afirmación más estricta es la autoritativa hasta que una de ellas se
corrija.

## 11. Riesgos

| Riesgo | Impacto | Mitigación actual | No mitigado |
| :--- | :--- | :--- | :--- |
| Una afirmación de seguridad se apoya en jsdom | Una regresión de política se publica sin ser notada | Sondas en ventana real para todo lo que toca CSP o scripts aportados; en caso contrario la afirmación se etiqueta como no verificada | Las sondas no son automáticas |
| La semántica de rutas difiere en otra plataforma | Usuarios que no usan Windows encuentran fallos que la puerta no ve | El código evita rutas absolutas y usa el manejo de URI del editor | Sin CI en otra plataforma |
| El renderizador XAML es una dependencia externa de tiempo de ejecución | La vista XAML no hace nada sin .NET 10 Windows Desktop | El renderizador se distribuye en el VSIX como dependencia de ejecución; el fallo se reporta, no se silencia | El tiempo de ejecución no puede empaquetarse |
| Un webview no puede revertir sus propias URL de recursos a rutas | Host y webview pueden discrepar sobre qué elemento se quiere decir | El host relee la ruta del texto del documento; las imágenes reciben una comprobación cruzada adicional por atributo | Los medios se identifican solo por índice y tipo, así que una página obsoleta puede apuntar mal |
| La documentación se desvía de los números | Los lectores confían en cifras obsoletas | Las reglas de registro de §9 | Depende de la disciplina de cambio; R-1 muestra que puede resbalar |
| Una muestra se toma por una prueba | «Funciona en la demo» sustituye a una aserción | Cada escenario tiene una muestra `demo/R<n>-*` *y* una prueba cuando es probable | La repetición manual sigue siendo manual |

## 12. Protocolo de cambio

| Si cambias… | También debes actualizar… | Porque… |
| :--- | :--- | :--- |
| Cualquier comportamiento cubierto por un requisito | La entrada correspondiente en `requirements.md` | El requisito es la autoridad; este archivo solo lo demuestra |
| Cualquier prueba, paso de la puerta o comando | §6, §8 y §9 de este archivo, y `build-and-verify.md` | Dos documentos sostienen la puerta; deben moverse juntos |
| Cualquier número medido | §9 de este archivo y `build-and-verify.md` | Los números duplicados divergen en silencio |
| La política o la carga de scripts de un webview | §3 y §4 de este archivo, más un resultado de sonda en ventana real | T1 no puede ver esta clase de cambio |
| Qué está verificado y qué no | §10 de este archivo, `limitations.md`, limitaciones conocidas del README | Tres listas describen el mismo riesgo residual |
| Una muestra | §7 de este archivo | El inventario de evidencia repetible forma parte del registro |
| Cualquier documento | Sus versiones china **y** española, en el mismo cambio | Un documento en un solo idioma es un defecto |

## Apéndice — Estructura de referencia y qué se omitió

El esqueleto de secciones de este documento se adapta de un paquete de registros de calidad GJB
(STP / STD / STR, ensayos de tipo, calibración metrológica, seguridad eléctrica y un conjunto de
registros de diseño 9001C). Las secciones siguientes se omitieron por completo, porque describen
entregables de hardware que no tienen objeto observable para una extensión de VS Code:

| Sección omitida | Por qué no aplica |
| :--- | :--- |
| Entorno de hardware (temperatura, humedad, alimentación, bastidor) | El entregable es un VSIX; el entorno de ejecución es el VS Code del propio usuario |
| Ensayos de tipo, cribado por estrés ambiental, emisión e inmunidad EMC | No hay entidad física ni emisión electromagnética |
| Calibración metrológica, cadena de trazabilidad, incertidumbre de medida | No hay instrumento de medida; la exactitud la garantizan las aserciones, no los instrumentos |
| Seguridad eléctrica, puesta a tierra, rigidez dieléctrica | La misma razón |
| Revisión, verificación, validación y registro de cambios de diseño (9001C 8.3) | Repositorio de un solo mantenedor, sin revisor independiente; ese papel lo asumen la puerta del §8 y el protocolo de cambio del §12 |
| Planificación y personal (STP §5.2 / 5.3) | No existen cronograma ni asignación de roles que registrar |

Las secciones que se conservaron y se reescribieron en clave de software son: alcance, niveles y
tipos de prueba, entorno de prueba, inventario de ítems de prueba (trazabilidad del §7), criterios de
entrada y salida, trazabilidad de requisitos, registros de prueba, tratamiento de defectos y fallos,
y riesgo.

Esta nota existe para que una omisión deliberada no se confunda con un capítulo que falta.
