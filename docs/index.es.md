---
type: Guide
title: Índice de documentación
description: Mapa de temas, puntos de entrada y reglas de escritura de la documentación de Wispkit
tags: [documentation, index]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T15:50:00+08:00 }
---

# Documentación de Wispkit

[English](index.md) | [中文](index.zh-CN.md) | **Español**

> Volver al [README del repositorio](../README.es.md). Cada tema siguiente existe en tres idiomas.

## Temas

| Tema | Versiones de idioma | Qué cubre |
|---|---|---|
| Requisitos y criterios de aceptación | [English](requirements.md) · [中文](requirements.zh-CN.md) · [Español](requirements.es.md) | El contrato autorizado: cada capacidad entregada bajo un número `R`, sus criterios de aceptación en forma CUANDO/ENTONCES, las restricciones transversales, la lista diferida y el protocolo de cambio que siguen todos los demás documentos |
| Restricciones de prueba y calidad | [English](test-and-quality.md) · [中文](test-and-quality.zh-CN.md) · [Español](test-and-quality.es.md) | Objetivos de calidad que no son negociables, qué puede y qué no puede ver cada nivel de prueba, qué evidencia se acepta, los criterios de entrada y salida de la puerta, las mediciones registradas, la clasificación de defectos y el riesgo residual |
| Arquitectura | [English](architecture.md) · [中文](architecture.zh-CN.md) · [Español](architecture.es.md) | Tres capas (host de la extensión / webview / front-end compartido), la responsabilidad de cada módulo, un flujo de datos completo, el reparto host/webview del 3D y las razones de diseño del editor personalizado |
| Vistas e interacción | [English](views-and-interaction.md) · [中文](views-and-interaction.zh-CN.md) · [Español](views-and-interaction.es.md) | Los nueve editores personalizados, la gestión de recursos personalizada, el panel de subárbol y el panel de visualización 3D: tipos de vista, composición de la interfaz, gestos y atajos, contratos de mensajes |
| Visualización 3D | [English](views-and-interaction.md#3d-graph-browsing-wispkitgraph3d) · [中文](views-and-interaction.zh-CN.md#3d-可视化浏览wispkitgraph3d) · [Español](views-and-interaction.es.md#navegación-3d-de-gráficos-wispkitgraph3d) | Clic derecho en un Markdown para abrir el panel 3D: comparación izquierda/derecha, fusión de nodos homónimos, gestos de cámara y reglas de nombres de elementos |
| Gestión de recursos personalizada | [English](views-and-interaction.md#custom-resource-management-wispkitresourcetree) · [中文](views-and-interaction.zh-CN.md#自定义资源管理wispkitresourcetree) · [Español](views-and-interaction.es.md#gestión-de-recursos-personalizada-wispkitresourcetree) | Vista de la barra de actividades: grupo virtual vs carpeta, profundidad arbitraria, comandos del título / menú contextual, arrastre interno y externo, clic para abrir el subárbol, almacenamiento JSON y actualización |
| Accesos directos y ejecutables de Windows | [English](views-and-interaction.md#shell-shortcut-view-wispkitshelllink) · [中文](views-and-interaction.zh-CN.md#快捷方式属性页wispkitshelllink) · [Español](views-and-interaction.es.md#vista-de-acceso-directo-wispkitshelllink) | Páginas de propiedades para archivos `.lnk` y `.exe`: qué registra el acceso directo, la estructura PE, los cuatro ajustes de apertura y edición y los seis comandos contextuales |
| Configuración | [English](configuration.md) · [中文](configuration.zh-CN.md) · [Español](configuration.es.md) | Referencia a nivel de campo de los dieciocho ajustes, `.WispkitView/Wispkit.json`, marcadores de herramientas y modos de ejecución |
| Compilación y verificación | [English](build-and-verify.md) · [中文](build-and-verify.zh-CN.md) · [Español](build-and-verify.es.md) | Entorno, los comandos npm, la estructura de pruebas (1149 casos / 70 archivos), el bundle 3D y las sondas del árbol de recursos en máquina real, empaquetado e instalación |
| Limitaciones conocidas | [English](limitations.md) · [中文](limitations.zh-CN.md) · [Español](limitations.es.md) | Lo que la extensión no puede hacer, por qué existe cada límite (incluida la cobertura de diagramas 3D, los límites de los árboles ASCII, los topes 200 / 600 y los límites de disco / concurrencia / multitráiz del árbol de recursos) y lo que nunca se ha verificado |
| Notas de desarrollo | [中文](development-notes.zh-CN.md) (solo chino) | Cómo se construyó la extensión paso a paso — primero la prueba de humo, luego la lógica pura — y cada tropiezo real, con síntoma, causa raíz y solución |

## Por dónde empezar

| Quieres… | Ve a |
|---|---|
| Comprobar qué se promete realmente y cómo se juzga | [Requisitos y criterios de aceptación](requirements.es.md) |
| Saber si un cambio es suficientemente bueno y qué puerta debe pasar | [Restricciones de prueba y calidad](test-and-quality.es.md) |
| Instalarla y probar las funciones principales | [README → Inicio rápido](../README.es.md#inicio-rápido) |
| Entender por qué hay nueve editores personalizados | [Arquitectura → Capas](architecture.es.md#capas) |
| Añadir una vista o cambiar un gesto | [Vistas e interacción](views-and-interaction.es.md) |
| Comparar o fusionar en 3D árboles Mermaid / ASCII de un Markdown | [Vistas e interacción → Navegación 3D de gráficos](views-and-interaction.es.md#navegación-3d-de-gráficos-wispkitgraph3d) |
| Organizar carpetas de uso frecuente en un árbol de recursos propio | [Vistas e interacción → Gestión de recursos personalizada](views-and-interaction.es.md#gestión-de-recursos-personalizada-wispkitresourcetree) |
| Inspeccionar un acceso directo o un ejecutable de Windows sin ejecutarlo | [Vistas e interacción → Vista de acceso directo](views-and-interaction.es.md#vista-de-acceso-directo-wispkitshelllink) |
| Cambiar un ajuste o añadir una herramienta propia | [Configuración](configuration.es.md) |
| Compilar, ejecutar las pruebas o reproducir una medición | [Compilación y verificación](build-and-verify.es.md) |
| Confirmar si algo está soportado antes de depender de ello | [Limitaciones conocidas](limitations.es.md) |
| Cambiar un comportamiento y averiguar qué más tiene que moverse con él | [Requisitos → Protocolo de cambio](requirements.es.md#7-protocolo-de-cambio) |

## Sobre estos documentos

1. **La página de requisitos es la autoridad; cada otro tema es su desarrollo.** [Requisitos y criterios de aceptación](requirements.es.md) declara qué debe hacer la extensión. Arquitectura, vistas e interacción, configuración y la nota de compilación explican cómo se realiza una capacidad y cómo se reproduce una medición; donde uno de ellos contradiga la página de requisitos, gana la página de requisitos y ese documento es defectuoso.
2. **Los números provienen de ejecuciones reales y son recalculables.** El recuento de pruebas, el tamaño del VSIX y los resultados medidos se reproducen con los comandos de [Compilación y verificación](build-and-verify.es.md).
3. **Los tres idiomas cambian juntos.** Cualquier edición de un tema se aplica al archivo inglés, chino y español en el mismo cambio; las variantes de idioma son traducciones fieles, no resúmenes.
4. **Lo no verificado se etiqueta como tal.** Todo lo que no se ejercitó en un VS Code real se marca explícitamente en [Limitaciones conocidas](limitations.es.md) en lugar de presentarse como una garantía de diseño.
