# 🚀 PROMPT Y ESPECIFICACIÓN TÉCNICA MAESTRA: **VSLingo**

> **Propósito:** Entregar este documento a un modelo LLM o agente dev para implementar el proyecto **VSLingo** desde cero durante la Hackathon de Código Facilito / AWS.

---

## 📌 1. Información General del Producto

* **Nombre del Proyecto:** **VSLingo**
* **Tagline:** *The Code-Editor Interface for Mastering Developer English.*
* **Filosofía del Producto:** "Al grano, sin ruido". Cero juegos, sin diamantes, sin rachas ni recompensas infantiles. Práctica directa, quirúrgica y profesional para desarrolladores de software hispanohablantes.
* **Modelo Económico / Pricing:** Plan básico de **$1.99 USD / mes** que ofrece hasta 30 minutos de práctica diaria por usuario con un **>60% de margen de ganancia limpia** gracias al stack de voz híper optimizado.
* **Estrategia Hackathon AWS:** Implementación nativa de **AWS Polly Neural** (`boto3`) para maximizar la puntuación del jurado de AWS.

---

## 🛠️ 2. Stack Tecnológico & Infraestructura

| Capa | Tecnología | Despliegue | Rol en la Aplicación |
| :--- | :--- | :--- | :--- |
| **Frontend** | React 18 + Vite + TailwindCSS | **Vercel** | UI fluida inspirada en VS Code (Dark Mode), Audio Waveform Canvas y WebSockets. |
| **Backend** | FastAPI (Python 3.11+) | **VPS propio (4GB RAM)** | Servidor de WebSockets, orquestador del pipeline asíncrono con `asyncio.Queue`. |
| **STT (Audio $\rightarrow$ Texto)** | **Groq Whisper** (`whisper-large-v3-turbo`) | API (Groq) | Transcripción de voz a texto en ~150ms con máxima precisión en inglés técnico. |
| **LLM (Inteligencia)** | **OpenRouter API** (`deepseek-chat` / `llama-3.3-70b` / `gemini-flash`) | API (OpenRouter) | Conversación y generación de feedback `git diff` en modo streaming. |
| **TTS (Texto $\rightarrow$ Voz)** | **AWS Polly Neural** (`boto3`) / **Microsoft Azure** (`edge-tts`) | API / Lib Python | Engine de Voz Conmutable (AWS Polly 🟠 vs Edge-TTS 🔵). |

---

## ⚙️ 3. Arquitectura del Backend: Pipeline de 3 Colas (`asyncio.Queue`)

El backend en FastAPI debe implementar un pipeline desacoplado en streaming de 3 colas asíncronas para lograr una latencia total de **< 1 segundo**:

```
[ Cliente WebSocket (Browser Mic) ]
             │
             │ (Audio Chunks / WebM)
             ▼
 ┌──────────────────────────────────────────────────────────┐
 │ ETAPA 1: STT Consumer Worker                             │
 │ • Recibe audio del WS -> Llama Groq Whisper API (150ms)  │
 │ • Pone el texto transcrito en `text_queue`               │
 └───────────────────────────┬──────────────────────────────┘
                             │
                             ▼
 ┌──────────────────────────────────────────────────────────┐
 │ ETAPA 2: LLM Consumer Worker                             │
 │ • Lee de `text_queue` -> Llama OpenRouter (stream=True)  │
 │ • Pone cada oración generada en `tts_queue`              │
 └───────────────────────────┬──────────────────────────────┘
                             │
                             ▼
 ┌──────────────────────────────────────────────────────────┐
 │ ETAPA 3: TTS Consumer Worker                             │
 │ • Lee oraciones de `tts_queue`                          │
 │ • Llama a AWS Polly (o Edge-TTS según selector en UI)    │
 │ • Devuelve bytes de audio en streaming por WebSocket     │
 └───────────────────────────┬──────────────────────────────┘
                             │
                             ▼
[ Cliente WebSocket (Browser Speaker) ]
```

---

## 📦 4. Módulos de la Aplicación (MVP)

### 🎙️ Módulo 1: **Voice Studio (Conversación por Voz en Tiempo Real)**
* **Escenarios Seleccionables:**
  * ☕ *Daily Standup Simulator* (Explica qué hiciste ayer, hoy y tus bloqueos).
  * 🏗️ *System Design & Tech Interview* (Explica decisiones de arquitectura, DBs, caching).
  * 💼 *Salary & Offer Negotiation* (Practica negociar salarios en USD con un recruiter).
* **UI Feedback `git diff`:**
  * **Lo que dijiste (Rojo):** `"Yesterday I fix the query in the database."`
  * **Sugerencia Nativa Dev (Verde):** `"Yesterday I optimized the database query bottleneck."`
  * **Vocabulario Clave:** `query optimization`, `bottleneck`.

### ✍️ Módulo 2: **Tech Writing Studio (Refactor de Texto)**
* **Propósito:** El usuario escribe o pega un borrador de mensaje para Slack, descripción de Pull Request en GitHub o Email.
* **Procesamiento:** OpenRouter analiza el texto, corrige la sintaxis y sugiere vocabulario técnico más profesional.
* **Reproductor Audio HD:** Botón de reproducción de voz con **AWS Polly Neural** / **Edge-TTS** para escuchar cómo suena la versión corregida con pronunciación nativa.

### 📺 Módulo 3: **Video Lab (Estudio con Vídeos Técnicos)**
* **Propósito:** Pega una URL de YouTube (Tech Talks, Demos de conferencias).
* **Procesamiento:** Extrae la transcripción, genera un glosario de términos dev y ejercicios interactivos de escucha/pronunciación sobre las frases del vídeo.

---

## 🎨 5. Guía de Diseño Visual (VS Code Aesthetic)

* **Tema Base:** Dark Mode IDE (`#0f172a` Slate/Zinc oscuro).
* **Paleta de Acentos:** 
  * Cyan Neón (`#06b6d4`) para acciones primarias.
  * Violeta (`#8b5cf6`) para estados activos e inteligencia de IA.
  * Naranja AWS (`#ff9900`) para indicar el uso del motor **AWS Polly**.
* **Componentes Clave de UI:**
  * **Activity Bar (Sidebar Izquierda):** Navegación entre Módulos + **Selector de Motor de Voz (AWS Polly 🟠 vs Edge-TTS 🔵)**.
  * **Editor Area:** Visualización de conversaciones y textos en tarjetas tipo Diff de Git.
  * **Bottom Panel (Console):** Visualizador de ondas de sonido (*Canvas Audio Waveform*) en tiempo real mientras el usuario habla.

---

## 📋 6. Criterios de Aceptación para Desarrollo

1. **Repo Limpio:** Proyecto creado desde cero con estructura limpia: `/frontend` (Vite React) y `/backend` (FastAPI).
2. **WebSocket Estable:** Conexión bidireccional continua sin pérdidas de audio.
3. **Selector de Voz Funcional:** Permitir cambiar en caliente entre AWS Polly y Edge-TTS desde la barra de configuración.
4. **Despliegue Exitoso:** Frontend activo en **Vercel** y Backend en **VPS** respondiendo correctamente.
