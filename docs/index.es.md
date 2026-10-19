---
type: Guide
title: Índice de documentación
description: Mapa de temas, puntos de entrada y reglas de escritura de la documentación de Wispkit
tags: [documentation, index]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-10-18T00:03:57+08:00 }
---

# Documentación de Wispkit

[English](index.md) | [中文](index.zh-CN.md) | **Español**

> Volver al [README del repositorio](../README.es.md). Cada tema siguiente existe en tres idiomas.

## Temas

| Tema | Versiones de idioma | Qué cubre |
|---|---|---|
| Arquitectura | [English](architecture.md) · [中文](architecture.zh-CN.md) · [Español](architecture.es.md) | Tres capas (host de la extensión / webview / front-end compartido), la responsabilidad de cada módulo, un flujo de datos completo y las razones de diseño del editor personalizado |
| Vistas e interacción | [English](views-and-interaction.md) · [中文](views-and-interaction.zh-CN.md) · [Español](views-and-interaction.es.md) | Los cinco editores personalizados y el panel de subárbol: tipos de vista, composición de la interfaz, gestos y atajos, contratos de mensajes |
| Configuración | [English](configuration.md) · [中文](configuration.zh-CN.md) · [Español](configuration.es.md) | Referencia a nivel de campo de los trece ajustes, `.WispkitView/Wispkit.json`, marcadores de herramientas y modos de ejecución |
| Compilación y verificación | [English](build-and-verify.md) · [中文](build-and-verify.zh-CN.md) · [Español](build-and-verify.es.md) | Entorno, los cuatro comandos npm, la estructura de pruebas (477 casos), sondas en máquina real, empaquetado e instalación |
| Limitaciones conocidas | [English](limitations.md) · [中文](limitations.zh-CN.md) · [Español](limitations.es.md) | Lo que la extensión no puede hacer, por qué existe cada límite y lo que nunca se ha verificado |
| Notas de desarrollo | [中文](development-notes.zh-CN.md) (solo chino) | Cómo se construyó la extensión paso a paso — primero la prueba de humo, luego la lógica pura — y cada tropiezo real, con síntoma, causa raíz y solución |

## Por dónde empezar

| Quieres… | Ve a |
|---|---|
| Instalarla y probar las funciones principales | [README → Inicio rápido](../README.es.md#inicio-rápido) |
| Entender por qué hay cinco editores personalizados | [Arquitectura → Capas](architecture.es.md#capas) |
| Añadir una vista o cambiar un gesto | [Vistas e interacción](views-and-interaction.es.md) |
| Cambiar un ajuste o añadir una herramienta propia | [Configuración](configuration.es.md) |
| Compilar, ejecutar las pruebas o reproducir una medición | [Compilación y verificación](build-and-verify.es.md) |
| Confirmar si algo está soportado antes de depender de ello | [Limitaciones conocidas](limitations.es.md) |

## Sobre estos documentos

1. **Los números provienen de ejecuciones reales y son recalculables.** El recuento de pruebas, el tamaño del VSIX y los resultados medidos se reproducen con los comandos de [Compilación y verificación](build-and-verify.es.md).
2. **Los tres idiomas cambian juntos.** Cualquier edición de un tema se aplica al archivo inglés, chino y español en el mismo cambio; las variantes de idioma son traducciones fieles, no resúmenes.
3. **Lo no verificado se etiqueta como tal.** Todo lo que no se ejercitó en un VS Code real se marca explícitamente en [Limitaciones conocidas](limitations.es.md) en lugar de presentarse como una garantía de diseño.
